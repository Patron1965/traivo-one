// Task #619: expanderbar visning av "släktnamn" (hierarkiskt visningsnamn) per
// förälderkedja. Visar primär kedja som default och alternativa släktnamn när
// objektet har flera föräldrar (object_parents). Sökvägen visas i sin helhet
// (rot → objekt) utan hård avkortning när användaren expanderar.
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Network, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
}

const CONTEXT_LABELS: Record<string, string> = {
  primary: "Primär",
  billing: "Fakturering",
  operational: "Drift",
  ownership: "Ägare",
};

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
}: {
  objectId: string;
  enabled?: boolean;
}) {
  const { data, isLoading } = useQuery<ObjectDisplayNamesData>({
    queryKey: ["/api/objects", objectId, "display-names"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/display-names`);
      if (!res.ok) return { primary: "", chains: [] };
      return res.json();
    },
    enabled,
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

  return (
    <div className="space-y-3" data-testid={`display-names-${objectId}`}>
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
              <div className="flex items-center gap-2">
                <span className="text-sm">{c.name || "—"}</span>
                {c.relationContext && (
                  <Badge variant="secondary" className="text-xs">
                    {CONTEXT_LABELS[c.relationContext] ?? c.relationContext}
                  </Badge>
                )}
              </div>
              <PathBreadcrumb path={c.path} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
