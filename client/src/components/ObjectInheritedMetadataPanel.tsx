import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MetadataEntry {
  id: string;
  metadataKatalogId: string;
  source: "local" | "inherited" | "computed";
  stoppaVidareArvning?: boolean | null;
  arvsNedat?: boolean | null;
  vardeString?: string | null;
  vardeInteger?: number | null;
  vardeDecimal?: string | number | null;
  vardeBoolean?: boolean | null;
  vardeDatetime?: string | null;
  vardeJson?: unknown;
  vardeReferens?: string | null;
  fromObject?: { id: string; namn: string; level: number } | null;
  katalog?: { namn: string; datatyp?: string | null; area?: string | null } | null;
}

function displayValue(m: MetadataEntry): string {
  if (m.vardeString != null) return m.vardeString;
  if (m.vardeInteger != null) return String(m.vardeInteger);
  if (m.vardeDecimal != null) return String(m.vardeDecimal);
  if (m.vardeBoolean != null) return m.vardeBoolean ? "Ja" : "Nej";
  if (m.vardeDatetime) return new Date(m.vardeDatetime).toLocaleDateString("sv-SE");
  if (m.vardeJson != null) return JSON.stringify(m.vardeJson);
  if (m.vardeReferens != null) return m.vardeReferens;
  return "—";
}

function rawValue(m: MetadataEntry): unknown {
  if (m.vardeString != null) return m.vardeString;
  if (m.vardeInteger != null) return m.vardeInteger;
  if (m.vardeDecimal != null) return m.vardeDecimal;
  if (m.vardeBoolean != null) return m.vardeBoolean;
  if (m.vardeDatetime != null) return m.vardeDatetime;
  if (m.vardeJson != null) return m.vardeJson;
  if (m.vardeReferens != null) return m.vardeReferens;
  return "";
}

interface Props {
  objectId: string;
}

export function ObjectInheritedMetadataPanel({ objectId }: Props) {
  const { toast } = useToast();
  const queryKey = ["/api/metadata/objects", objectId];

  const { data, isLoading } = useQuery<{ metadata: MetadataEntry[] }>({
    queryKey,
    enabled: !!objectId,
  });

  const all = data?.metadata ?? [];
  const inherited = useMemo(() => all.filter((m) => m.source === "inherited"), [all]);
  const blocked = useMemo(
    () => all.filter((m) => m.source === "local" && m.stoppaVidareArvning === true),
    [all],
  );

  // Blockera ett ärvt fält: materialisera ett lokalt värde (kopia) och sätt
  // stoppaVidareArvning=true så det inte ärvs vidare nedåt till barn. Svenska
  // metadata-systemet (samma datapath som formuläret använder).
  const blockMutation = useMutation({
    mutationFn: async (entry: MetadataEntry) => {
      const created = await apiRequest("POST", "/api/metadata/", {
        objektId: objectId,
        metadataTypNamn: entry.katalog?.namn,
        varde: rawValue(entry),
        arvsNedat: false,
      }).then((r) => r.json());
      try {
        await apiRequest("PATCH", `/api/metadata/${created.id}/inheritance`, {
          stoppaVidareArvning: true,
        });
      } catch (err) {
        // Kompensera: misslyckas PATCH efter att POST skapat en lokal rad skulle
        // den raden bli en osynlig föräldralös post (varken ärvd eller blockerad).
        // Ta bort den så block-operationen blir atomisk ur användarens vy.
        await apiRequest("DELETE", `/api/metadata/${created.id}`).catch(() => {});
        throw err;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Nedärvning blockerad", description: "Fältet ärvs inte längre vidare till underordnade objekt." });
    },
    onError: (e: Error) => toast({ title: "Kunde inte blockera", description: e.message, variant: "destructive" }),
  });

  // Tillåt nedärvning igen: ta bort den lokala blockerings-raden så att det
  // ärvda värdet flödar nedåt på nytt.
  const unblockMutation = useMutation({
    mutationFn: async (entry: MetadataEntry) => {
      await apiRequest("DELETE", `/api/metadata/${entry.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Nedärvning tillåten", description: "Fältet ärvs åter nedåt till underordnade objekt." });
    },
    onError: (e: Error) => toast({ title: "Kunde inte återställa", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid="loading-inherited-metadata">
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar ärvd metadata...
      </div>
    );
  }

  if (inherited.length === 0 && blocked.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2" data-testid="text-no-inherited-metadata">
        Inga ärvda metadatafält. Värden som sätts på överordnade objekt visas här.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="grid-inherited-metadata">
      {inherited.map((m) => (
        <div
          key={m.metadataKatalogId}
          className="flex items-start justify-between gap-2 rounded-md border p-2"
          data-testid={`inherited-field-${m.metadataKatalogId}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{m.katalog?.namn}</p>
            <p className="text-sm text-muted-foreground truncate">{displayValue(m)}</p>
            {m.fromObject?.namn && (
              <Badge variant="secondary" className="mt-1 text-xs">Ärvd från {m.fromObject.namn}</Badge>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            disabled={blockMutation.isPending}
            onClick={() => blockMutation.mutate(m)}
            data-testid={`button-block-inheritance-${m.metadataKatalogId}`}
          >
            <Ban className="h-3.5 w-3.5 mr-1" /> Blockera
          </Button>
        </div>
      ))}
      {blocked.map((m) => (
        <div
          key={m.metadataKatalogId}
          className="flex items-start justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 p-2"
          data-testid={`blocked-field-${m.metadataKatalogId}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{m.katalog?.namn}</p>
            <p className="text-sm text-muted-foreground truncate">{displayValue(m)}</p>
            <Badge variant="outline" className="mt-1 text-xs border-warning text-warning">Blockerad nedåt</Badge>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={unblockMutation.isPending}
            onClick={() => unblockMutation.mutate(m)}
            data-testid={`button-unblock-inheritance-${m.metadataKatalogId}`}
          >
            <Undo2 className="h-3.5 w-3.5 mr-1" /> Tillåt
          </Button>
        </div>
      ))}
    </div>
  );
}
