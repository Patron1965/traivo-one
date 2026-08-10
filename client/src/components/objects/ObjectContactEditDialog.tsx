import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Task #1440: kontaktpersonen redigeras direkt i det konsoliderade kontakt-
// kortet. Underfälten (Namn/Titel/Telefon/E-post) är vanliga metadatavärden i
// området "kontakt" — redigering går via de generella metadata-endpointsen:
//   - befintligt värde  → PUT  /api/metadata/:vardenId
//   - saknat underfält  → POST /api/metadata (katalognamn från servern)
//   - tömt underfält    → ARKIVERING (DELETE /api/metadata/objects/:oid/field/
//     :katalogId) — aldrig hård radering: värdet döljs men historiken bevaras
// Fälttyp/konfiguration styrs enbart av den centrala metadata-definitionen.

export interface ContactSubfieldRef {
  vardenId: string | null;
  katalogNamn: string | null;
  katalogId: string | null;
  inherited: boolean;
  fromObjectName: string | null;
}

export interface EditableContact {
  id: string;
  /** Task #1459: explicit grupp-nyckel som binder ihop personens underfält.
   *  Finns nyckeln kan saknade underfält kompletteras rad-säkert även när
   *  objektet har flera kontakter (POST med gruppNyckel). */
  gruppNyckel?: string | null;
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  inherited?: boolean;
  fields?: {
    namn: ContactSubfieldRef;
    titel: ContactSubfieldRef;
    telefon: ContactSubfieldRef;
    epost: ContactSubfieldRef;
  };
}

const SUBFIELDS = [
  { key: "namn", label: "Namn", contactKey: "name" },
  { key: "titel", label: "Titel", contactKey: "role" },
  { key: "telefon", label: "Telefon", contactKey: "phone" },
  { key: "epost", label: "E-post", contactKey: "email" },
] as const;

export function ObjectContactEditDialog({
  objectId,
  contact,
  open,
  onOpenChange,
  structuralEditsSafe = true,
}: {
  objectId: string;
  contact: EditableContact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Kontakter paras ihop per underfälts-index. När objektet har FLERA kontakter
   * kan ett nyskapat/arkiverat underfält hamna på fel kontakt (index-omparning).
   * Då tillåts endast redigering av BEFINTLIGA värden (PUT per varden-id är
   * rad-exakt); lägga till saknade underfält eller tömma görs bara när objektet
   * har exakt en kontakt.
   */
  structuralEditsSafe?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setValues({
        namn: contact.name ?? "",
        titel: contact.role ?? "",
        telefon: contact.phone ?? "",
        epost: contact.email ?? "",
      });
    }
  }, [open, contact]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const sf of SUBFIELDS) {
        const ref = contact.fields?.[sf.key];
        const oldVal = ((contact as any)[sf.contactKey] ?? "").trim();
        const newVal = (values[sf.key] ?? "").trim();
        if (newVal === oldVal) continue;
        // Ärvda värden redigeras vid källan — hoppa över (inputen är låst).
        if (ref?.inherited) continue;
        // Strukturella ändringar: att LÄGGA TILL ett saknat underfält är säkert
        // när kontakten har en explicit grupp-nyckel (raden stämplas med nyckeln
        // och paras deterministiskt, Task #1459) eller när objektet bara har en
        // kontakt. Tömning (fält-nivå-arkivering) är fortsatt bara säker med en
        // kontakt — den träffar hela fältet, inte en enskild rad.
        const addSafe = structuralEditsSafe || !!contact.gruppNyckel;
        const clearSafe = structuralEditsSafe;
        if ((!ref?.vardenId && newVal && !addSafe) || (ref?.vardenId && !newVal && !clearSafe)) {
          throw new Error(
            `${sf.label} kan inte ${ref?.vardenId ? "tömmas" : "läggas till"} här när objektet har flera kontakter — redigera fältet via metadatavyn.`,
          );
        }
        if (ref?.vardenId && newVal) {
          const res = await fetch(`/api/metadata/${ref.vardenId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ varde: newVal }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.message || body?.error || `Kunde inte uppdatera ${sf.label}`);
          }
        } else if (ref?.vardenId && !newVal) {
          // Tömning = ARKIVERING (bevarar historik) — aldrig hård radering.
          if (!ref.katalogId) {
            throw new Error(`Kan inte arkivera ${sf.label}: fältets katalog-id saknas`);
          }
          const res = await fetch(`/api/metadata/objects/${objectId}/field/${ref.katalogId}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.message || body?.error || `Kunde inte tömma ${sf.label}`);
          }
        } else if (!ref?.vardenId && newVal) {
          if (!ref?.katalogNamn) {
            throw new Error(`Metadatafältet för ${sf.label} saknas i katalogen`);
          }
          const res = await fetch(`/api/metadata`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              objektId: objectId,
              metadataTypNamn: ref.katalogNamn,
              varde: newVal,
              // Task #1459: stämpla raden med personens grupp-nyckel så att
              // kompletteringen hamnar hos rätt kontakt (aldrig index-parning).
              gruppNyckel: contact.gruppNyckel ?? undefined,
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.message || body?.error || `Kunde inte lägga till ${sf.label}`);
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Kontakt uppdaterad" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara kontakten", description: error.message, variant: "destructive" });
      // Delvis genomförda ändringar kan finnas — uppdatera vyn.
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid={`dialog-edit-contact-${contact.id}`}>
        <DialogHeader>
          <DialogTitle>Redigera kontakt</DialogTitle>
          <DialogDescription>
            Värdena sparas som kontakt-metadata på objektet. Fälttyp och konfiguration
            styrs av den centrala metadatauppsättningen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {SUBFIELDS.map((sf) => {
            const ref = contact.fields?.[sf.key];
            const locked = !!ref?.inherited;
            const structurallyLocked =
              !structuralEditsSafe && !contact.gruppNyckel && !ref?.vardenId && !locked;
            return (
              <div key={sf.key} className="space-y-1">
                <Label htmlFor={`contact-${sf.key}`}>{sf.label}</Label>
                <Input
                  id={`contact-${sf.key}`}
                  value={values[sf.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [sf.key]: e.target.value }))}
                  disabled={locked || structurallyLocked}
                  data-testid={`input-contact-${sf.key}`}
                />
                {locked && (
                  <p className="text-xs text-muted-foreground">
                    Ärvt värde{ref?.fromObjectName ? ` från ${ref.fromObjectName}` : ""} — redigeras vid källan.
                  </p>
                )}
                {structurallyLocked && (
                  <p className="text-xs text-muted-foreground">
                    Kan inte läggas till här när objektet har flera kontakter — redigera via metadatavyn.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-contact-edit">
            Avbryt
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-contact-edit"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
