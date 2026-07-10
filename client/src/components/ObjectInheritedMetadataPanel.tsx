import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  isPhotoDatatyp,
  parseCompositeSubfields,
  PhotoGalleryView,
  ContactCardsView,
} from "@/components/MetadataCatalog";

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
  katalog?: { namn: string; datatyp?: string | null; area?: string | null; visasIKarusell?: boolean | null } | null;
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

  // Task #1218: fält markerade "visas ej i karusell" döljs även här — paritet med
  // objekt-360-karusellen (tekniska/interna fält visas inte i presentationsytorna).
  const all = useMemo(
    () => (data?.metadata ?? []).filter((m) => m.katalog?.visasIKarusell !== false),
    [data],
  );
  const inherited = useMemo(() => all.filter((m) => m.source === "inherited"), [all]);
  const blocked = useMemo(
    () => all.filter((m) => m.source === "local" && m.stoppaVidareArvning === true),
    [all],
  );

  // Task #971: gruppera per katalog så multi-värdes-kataloger (foto/kontakt med
  // allowDuplicates) visas som ETT galleri/kortset i läs-läge istället för en rad
  // per värde.
  const inheritedGroups = useMemo(() => {
    const map = new Map<string, MetadataEntry[]>();
    for (const m of inherited) {
      const k = m.metadataKatalogId;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.values());
  }, [inherited]);
  const blockedGroups = useMemo(() => {
    const map = new Map<string, MetadataEntry[]>();
    for (const m of blocked) {
      const k = m.metadataKatalogId;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return Array.from(map.values());
  }, [blocked]);

  // Typmedveten läs-rendering: galleri för foto, kontaktkort för sammansatt json,
  // annars text.
  const renderValue = (entries: MetadataEntry[], testIdBase: string) => {
    const datatyp = entries[0]?.katalog?.datatyp ?? null;
    if (isPhotoDatatyp(datatyp)) {
      const items = entries
        .map((e) => ({
          id: e.id,
          url: e.vardeString ?? "",
          label: e.katalog?.namn ?? undefined,
          source: "inherited" as const,
        }))
        .filter((it) => it.url);
      if (items.length > 0) return <PhotoGalleryView items={items} testIdBase={testIdBase} />;
    }
    if (datatyp === "json") {
      const cards = entries
        .map((e) => {
          const subfields = parseCompositeSubfields(e.vardeJson);
          return subfields ? { id: e.id, subfields, source: "inherited" as const } : null;
        })
        .filter(
          (c): c is { id: string; subfields: Array<{ key: string; value: string }>; source: "inherited" } =>
            c != null,
        );
      if (cards.length > 0) return <ContactCardsView cards={cards} testIdBase={testIdBase} />;
    }
    return (
      <p className="text-sm text-muted-foreground truncate" data-testid={`${testIdBase}-text`}>
        {entries.map((e) => displayValue(e)).join(", ")}
      </p>
    );
  };

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
      {inheritedGroups.map((group) => {
        const m = group[0];
        const datatyp = m.katalog?.datatyp ?? null;
        const isCatalog = group.length > 1 || isPhotoDatatyp(datatyp) || datatyp === "json";
        return (
          <div
            key={m.metadataKatalogId}
            className={`flex items-start justify-between gap-2 rounded-md border p-2 ${isCatalog ? "sm:col-span-2" : ""}`}
            data-testid={`inherited-field-${m.metadataKatalogId}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium truncate">{m.katalog?.namn}</p>
                {group.length > 1 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                    data-testid={`inherited-count-${m.metadataKatalogId}`}
                  >
                    {group.length}
                  </Badge>
                )}
              </div>
              <div className="mt-1">{renderValue(group, `inherited-value-${m.metadataKatalogId}`)}</div>
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
              onClick={() => group.forEach((e) => blockMutation.mutate(e))}
              data-testid={`button-block-inheritance-${m.metadataKatalogId}`}
            >
              <Ban className="h-3.5 w-3.5 mr-1" /> Blockera
            </Button>
          </div>
        );
      })}
      {blockedGroups.map((group) => {
        const m = group[0];
        const datatyp = m.katalog?.datatyp ?? null;
        const isCatalog = group.length > 1 || isPhotoDatatyp(datatyp) || datatyp === "json";
        return (
          <div
            key={m.metadataKatalogId}
            className={`flex items-start justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 ${isCatalog ? "sm:col-span-2" : ""}`}
            data-testid={`blocked-field-${m.metadataKatalogId}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium truncate">{m.katalog?.namn}</p>
                {group.length > 1 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {group.length}
                  </Badge>
                )}
              </div>
              <div className="mt-1">{renderValue(group, `blocked-value-${m.metadataKatalogId}`)}</div>
              <Badge variant="outline" className="mt-1 text-xs border-warning text-warning">Blockerad nedåt</Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              disabled={unblockMutation.isPending}
              onClick={() => group.forEach((e) => unblockMutation.mutate(e))}
              data-testid={`button-unblock-inheritance-${m.metadataKatalogId}`}
            >
              <Undo2 className="h-3.5 w-3.5 mr-1" /> Tillåt
            </Button>
          </div>
        );
      })}
    </div>
  );
}
