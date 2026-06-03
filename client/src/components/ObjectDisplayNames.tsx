// Task #619: expanderbar visning av "släktnamn" (hierarkiskt visningsnamn) per
// förälderkedja. Visar primär kedja som default och alternativa släktnamn när
// objektet har flera föräldrar (object_parents). Sökvägen visas i sin helhet
// (rot → objekt) utan hård avkortning när användaren expanderar.
// Task #634: språkväljare — välj visningsspråk (namn_sv/namn_en/…) med fallback
// till det interna namnet. Påverkar enbart visningen, aldrig kolumn E.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, Languages, Network, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DisplayNameChain {
  parentId: string | null;
  relationContext: string | null;
  isPrimary: boolean;
  name: string;
  path: { id: string; name: string; level: string }[];
}

interface ObjectDisplayNamesData {
  primary: string;
  chains: DisplayNameChain[];
  language?: string;
  translations?: Record<string, string>;
  languages?: string[];
}

const CONTEXT_LABELS: Record<string, string> = {
  primary: "Primär",
  billing: "Fakturering",
  operational: "Drift",
  ownership: "Ägare",
};

// Visningsnamn för en ISO-språkkod (faller tillbaka till versal kod).
const LANGUAGE_LABELS: Record<string, string> = {
  sv: "Svenska",
  en: "English",
  fi: "Suomi",
  no: "Norsk",
  da: "Dansk",
  de: "Deutsch",
};

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

function PathBreadcrumb({ path }: { path: { id: string; name: string; level: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="display-name-path">
      {path.map((node, idx) => (
        <span key={node.id} className="flex items-center gap-1">
          <span
            className={`text-xs ${idx === path.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}`}
          >
            {node.name || "—"}
          </span>
          {idx < path.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
        </span>
      ))}
    </div>
  );
}

export function ObjectDisplayNames({
  objectId,
  enabled = true,
  allowSetPrimary = false,
}: {
  objectId: string;
  enabled?: boolean;
  // Task #626: visa "Gör till primär"-åtgärd på alternativa släktnamn. Av som
  // standard (t.ex. i mobilvyn) — slås på i web-vyer där byte är önskvärt.
  allowSetPrimary?: boolean;
}) {
  const { toast } = useToast();
  // "" = internt namn (kolumn E); annars vald språkkod.
  const [language, setLanguage] = useState<string>("");
  // Task #669: bekräfta innan primär förälder byts (påverkar metadata-/fält-arv).
  const [pendingPrimary, setPendingPrimary] = useState<DisplayNameChain | null>(null);

  const { data, isLoading } = useQuery<ObjectDisplayNamesData>({
    queryKey: ["/api/objects", objectId, "display-names", language],
    queryFn: async () => {
      const qs = language ? `?language=${encodeURIComponent(language)}` : "";
      const res = await fetch(`/api/objects/${objectId}/display-names${qs}`);
      if (!res.ok) return { primary: "", chains: [] };
      return res.json();
    },
    enabled,
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (parentId: string) => {
      await apiRequest("PATCH", `/api/objects/${objectId}/primary-parent`, { parentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "display-names"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "parents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Primär förälder uppdaterad" });
      setPendingPrimary(null);
    },
    onError: () => {
      toast({ title: "Kunde inte byta primär förälder", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground" data-testid="display-names-loading">Laddar släktnamn…</p>;
  }
  if (!data || data.chains.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="display-names-empty">
        Inget hierarkiskt släktnamn (slå på i tenant-inställningar eller saknar förälder).
      </p>
    );
  }

  const primary = data.chains.find(c => c.isPrimary) ?? data.chains[0];
  const alternatives = data.chains.filter(c => c !== primary);
  const availableLanguages = data.languages ?? [];

  return (
    <div className="space-y-3" data-testid={`display-names-${objectId}`}>
      {availableLanguages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="language-selector">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground mr-1">
            <Languages className="h-3 w-3" />
            Visningsspråk
          </span>
          <Button
            type="button"
            size="sm"
            variant={language === "" ? "default" : "outline"}
            className="h-6 px-2 text-xs"
            onClick={() => setLanguage("")}
            data-testid="button-language-internal"
          >
            Internt
          </Button>
          {availableLanguages.map((lang) => (
            <Button
              key={lang}
              type="button"
              size="sm"
              variant={language === lang ? "default" : "outline"}
              className="h-6 px-2 text-xs"
              onClick={() => setLanguage(lang)}
              data-testid={`button-language-${lang}`}
            >
              {languageLabel(lang)}
            </Button>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-chart-3/40 bg-chart-3/10 p-3 space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-chart-3">
          <Star className="h-3 w-3" />
          Primärt släktnamn
        </div>
        <p className="text-sm font-medium" data-testid="text-primary-display-name">{primary.name || "—"}</p>
        <PathBreadcrumb path={primary.path} />
      </div>

      {alternatives.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Network className="h-3 w-3" />
            Alternativa släktnamn ({alternatives.length})
          </div>
          {alternatives.map((c, idx) => (
            <div key={`${c.parentId}-${idx}`} className="rounded-lg border bg-muted/40 p-3 space-y-1" data-testid={`alt-display-name-${idx}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{c.name || "—"}</span>
                  {c.relationContext && (
                    <Badge variant="secondary" className="text-xs">
                      {CONTEXT_LABELS[c.relationContext] ?? c.relationContext}
                    </Badge>
                  )}
                </div>
                {allowSetPrimary && c.parentId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => setPendingPrimary(c)}
                    disabled={setPrimaryMutation.isPending}
                    data-testid={`button-set-primary-display-${idx}`}
                  >
                    <Star className="mr-1 h-3 w-3" />
                    Gör till primär
                  </Button>
                )}
              </div>
              <PathBreadcrumb path={c.path} />
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={pendingPrimary !== null}
        onOpenChange={(open) => {
          if (!open && !setPrimaryMutation.isPending) setPendingPrimary(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-set-primary">
          <AlertDialogHeader>
            <AlertDialogTitle>Byta primär förälder?</AlertDialogTitle>
            <AlertDialogDescription>
              Du är på väg att göra{" "}
              <span className="font-medium text-foreground">{pendingPrimary?.name || "—"}</span>{" "}
              till objektets primära förälder. Metadata- och fältarv (t.ex. portkod, nyckel
              och access-info) räknas alltid om från den primära föräldern och kommer att
              uppdateras enligt den nya kedjan. Tidigare nedärvda värden kan ändras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={setPrimaryMutation.isPending}
              data-testid="button-cancel-set-primary"
            >
              Avbryt
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingPrimary?.parentId) {
                  setPrimaryMutation.mutate(pendingPrimary.parentId);
                }
              }}
              disabled={setPrimaryMutation.isPending}
              data-testid="button-confirm-set-primary"
            >
              {setPrimaryMutation.isPending ? "Byter…" : "Gör till primär"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
