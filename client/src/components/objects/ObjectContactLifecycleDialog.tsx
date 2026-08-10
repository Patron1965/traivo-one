import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Archive, Trash2, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { EditableContact } from "./ObjectContactEditDialog";

// Task #1468: tre SEPARATA livscykelflöden för en kontakt på objektsidan, med
// egna bekräftelsedialoger som tydligt förklarar vad respektive åtgärd gör:
//
//   - RADERA (permanent, admin): rad-exakt hård radering per underfälts
//     varden-id (DELETE /api/metadata/:id). Servern SPÄRRAR (409 USE_ARCHIVE)
//     när fältet har verklig ändringshistorik eller kopplingar — dialogen
//     erbjuder då arkivering istället.
//   - ARKIVERA: fält-nivå-arkivering (DELETE /api/metadata/objects/:oid/
//     field/:katalogId) — kontakten döljs men all historik bevaras och kan
//     återställas. Fält-endpointen träffar HELA fältet på objektet, därför är
//     åtgärden bara säker när objektet har exakt en kontakt (samma
//     konvention som tömning i redigeringsdialogen).
//   - ANONYMISERA (oåterkallelig, admin): GDPR-skrubbning per underfält
//     (POST .../anonymize {confirm:true}) — värden förstörs i alla kopior men
//     uppgiftshistoriken bevaras strukturellt. Interimsnummer omfattas aldrig
//     (serverspärr 403) och ingår inte heller i kontaktens underfält.
//     Anonymiseringen träffar även arkiverade rader för fältet på objektet →
//     samma en-kontakt-gate som arkivering.

export type ContactLifecycleAction = "delete" | "archive" | "anonymize";

const SUBFIELD_KEYS = ["namn", "titel", "telefon", "epost"] as const;
const SUBFIELD_LABELS: Record<(typeof SUBFIELD_KEYS)[number], string> = {
  namn: "Namn",
  titel: "Titel",
  telefon: "Telefon",
  epost: "E-post",
};

async function readError(res: Response): Promise<{ message: string; code?: string }> {
  const body = await res.json().catch(() => null);
  return {
    message: body?.message || body?.error || `Åtgärden misslyckades (${res.status})`,
    code: body?.code,
  };
}

export function ObjectContactLifecycleDialog({
  objectId,
  contact,
  action,
  open,
  onOpenChange,
  archiveSafe,
}: {
  objectId: string;
  contact: EditableContact;
  action: ContactLifecycleAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fält-nivå-åtgärder (arkivera/anonymisera) träffar hela fältet på
   *  objektet — bara säkert när objektet har exakt en kontakt. */
  archiveSafe: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Radering spärrad av servern (409 USE_ARCHIVE) → visa arkiverings-erbjudande.
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) setBlockedMessage(null);
  }, [open, action]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
  };

  /** Lokala (icke-ärvda) underfält med referenser. */
  const localRefs = SUBFIELD_KEYS.flatMap((key) => {
    const ref = contact.fields?.[key];
    if (!ref || ref.inherited) return [];
    return [{ key, label: SUBFIELD_LABELS[key], ref }];
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Rad-exakt hård radering per varden-id. Vid 409 (historik/kopplingar)
      // avbryts flödet och arkivering erbjuds istället; redan raderade
      // underfält är då borta (arkiveringen täcker resten).
      for (const { label, ref } of localRefs) {
        if (!ref.vardenId) continue;
        const res = await fetch(`/api/metadata/${ref.vardenId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (res.status === 409) {
          const err = await readError(res);
          const blocked = new Error(err.message);
          (blocked as any).useArchive = true;
          throw blocked;
        }
        if (!res.ok) {
          const err = await readError(res);
          throw new Error(`${label}: ${err.message}`);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Kontakt raderad permanent" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      invalidate();
      if ((error as any).useArchive) {
        setBlockedMessage(error.message);
      } else {
        toast({ title: "Kunde inte radera kontakten", description: error.message, variant: "destructive" });
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      for (const { label, ref } of localRefs) {
        if (!ref.vardenId || !ref.katalogId) continue;
        const res = await fetch(`/api/metadata/objects/${objectId}/field/${ref.katalogId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ metod: "kontakt-arkivering" }),
        });
        if (!res.ok) {
          const err = await readError(res);
          throw new Error(`${label}: ${err.message}`);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "Kontakt arkiverad",
        description: "Kontakten är dold men all historik bevaras och kan återställas.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      invalidate();
      toast({ title: "Kunde inte arkivera kontakten", description: error.message, variant: "destructive" });
    },
  });

  const anonymizeMutation = useMutation({
    mutationFn: async () => {
      for (const { label, ref } of localRefs) {
        if (!ref.vardenId || !ref.katalogId) continue;
        const res = await fetch(`/api/metadata/objects/${objectId}/field/${ref.katalogId}/anonymize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ confirm: true }),
        });
        if (!res.ok) {
          const err = await readError(res);
          throw new Error(`${label}: ${err.message}`);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "Kontakt anonymiserad",
        description: "Personuppgifterna är oåterkalleligt borttagna. Uppgiftshistoriken bevaras.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      invalidate();
      toast({ title: "Kunde inte anonymisera kontakten", description: error.message, variant: "destructive" });
    },
  });

  const pending = deleteMutation.isPending || archiveMutation.isPending || anonymizeMutation.isPending;
  const contactLabel = contact.name?.trim() || "kontakten";

  // ---- Dialoginnehåll per åtgärd ----
  let title: string;
  let description: ReactNode;
  let confirmLabel: string;
  let confirmVariant: "destructive" | "default" = "destructive";
  let onConfirm: () => void;
  let confirmDisabled = false;

  if (action === "delete" && blockedMessage) {
    title = "Radering spärrad — arkivera istället?";
    description = (
      <>
        <span className="block">{blockedMessage}</span>
        <span className="block mt-2">
          Arkivering döljer kontakten men bevarar all historik och kan återställas.
        </span>
        {!archiveSafe && (
          <span className="block mt-2 text-destructive">
            Objektet har flera kontakter — arkivering på fält-nivå skulle träffa alla
            kontakter. Arkivera fältet via metadatavyn istället.
          </span>
        )}
      </>
    );
    confirmLabel = "Arkivera kontakten";
    confirmVariant = "default";
    onConfirm = () => archiveMutation.mutate();
    confirmDisabled = !archiveSafe;
  } else if (action === "delete") {
    title = "Radera kontakt permanent?";
    description = (
      <>
        <span className="block">
          {`Detta raderar ${contactLabel}s underfält (namn, titel, telefon, e-post) permanent
          från objektet — värden OCH historik försvinner och kan inte återställas.`}
        </span>
        <span className="block mt-2">
          Har kontakten verklig ändringshistorik eller kopplingar spärras raderingen och
          arkivering erbjuds istället.
        </span>
      </>
    );
    confirmLabel = "Radera permanent";
    onConfirm = () => deleteMutation.mutate();
  } else if (action === "archive") {
    title = "Arkivera kontakt?";
    description = (
      <>
        <span className="block">
          {`${contactLabel.charAt(0).toUpperCase()}${contactLabel.slice(1)} blir inaktiv och döljs
          från objektet, men alla värden och all historik bevaras. Kontakten kan återställas
          från arkivet.`}
        </span>
      </>
    );
    confirmLabel = "Arkivera";
    confirmVariant = "default";
    onConfirm = () => archiveMutation.mutate();
  } else {
    title = "Anonymisera kontakt (GDPR)?";
    description = (
      <>
        <span className="block">
          Personuppgifterna (namn, titel, telefon, e-post) förstörs oåterkalleligt i alla
          lagringsplatser. Uppgiftshistoriken bevaras strukturellt — vem/när loggas, men
          aldrig vad.
        </span>
        <span className="block mt-2">
          Interimsnummer omfattas aldrig av anonymisering och lämnas alltid orört.
        </span>
        <span className="block mt-2 font-medium text-destructive">
          Åtgärden kan inte ångras.
        </span>
      </>
    );
    confirmLabel = "Anonymisera oåterkalleligt";
    onConfirm = () => anonymizeMutation.mutate();
  }

  const actionIcon =
    action === "delete" ? <Trash2 className="h-4 w-4 mr-1.5" />
    : action === "archive" ? <Archive className="h-4 w-4 mr-1.5" />
    : <EyeOff className="h-4 w-4 mr-1.5" />;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <AlertDialogContent data-testid={`dialog-contact-${action}-${contact.id}`}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-contact-lifecycle"
          >
            Avbryt
          </Button>
          <Button
            variant={confirmVariant}
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
            data-testid={`button-confirm-contact-${blockedMessage ? "archive-fallback" : action}`}
          >
            {pending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : actionIcon}
            {blockedMessage ? "Arkivera kontakten" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
