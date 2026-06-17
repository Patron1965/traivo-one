import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Filter, Eye, Loader2, Layers } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";
import {
  ConditionFilterRow,
  type ConditionFilter,
} from "@/components/orderkoncept/shared/ConditionFilter";
import { ObjectHierarchyTree } from "@/components/objectTree/ObjectHierarchyTree";

export type { ConditionFilter };

interface PreviewResult {
  total: number;
  /** Antal objekt som ligger under de valda gren-rötterna (serverberäknat). */
  descendants: number;
  matched: number;
  sample: { id: string; name: string; objectNumber: string | null; address: string | null }[];
}

interface Step4Props {
  /** ADR v3: valda gren-ROT-objekt-id:n. Hela grenen (underobjekt) följer med. */
  targetObjectIds: Set<string>;
  onToggleObject: (id: string) => void;
  filters: ConditionFilter[];
  onFiltersChange: (filters: ConditionFilter[]) => void;
}

export default function Step4Inspection({
  targetObjectIds,
  onToggleObject,
  filters,
  onFiltersChange,
}: Step4Props) {
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  // Steg 4 visar bara STRUKTUR (antal objekt i vald gren) — inte artikelträffar,
  // uppgifter, tid eller ekonomi (det beräknas i ett senare steg). Därför skickas
  // inga villkor in: `total` = hela subträdet för de valda grenarna.
  const previewMutation = useMutation<PreviewResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/condition-preview", {
        objectIds: Array.from(targetObjectIds),
      });
      return res.json();
    },
  });

  const addFilter = () =>
    onFiltersChange([...filters, { metadataKey: "", operator: "equals", filterValue: "" }]);

  const updateFilter = (i: number, patch: Partial<ConditionFilter>) =>
    onFiltersChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const removeFilter = (i: number) =>
    onFiltersChange(filters.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-6" data-testid="step4-inspection">

      {/* ── Objekthierarki ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Objekthierarki{" "}
          <Badge variant="secondary" className="text-xs">
            {targetObjectIds.size} valda grenar
          </Badge>
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Navigera hierarkin och välj objekt eller grenar att inkludera. Klicka på ett objekt
          eller bocka i rutan för att välja det och hela dess underträd. Underobjekt som följer
          med markeras "via förälder".
        </p>

        {/* Objekt/gren-selektion (ADR v3) — ersätter kluster-targeting.
            objectSelectionMode härleds internt från selectedObjectIds + onToggleObject. */}
        <ObjectHierarchyTree
          selectedObjectIds={targetObjectIds}
          onToggleObject={onToggleObject}
          height={360}
        />
      </div>

      {/* ── Villkorsfilter ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Filter className="h-4 w-4" /> Villkorsfilter
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={addFilter}
            data-testid="button-add-filter"
          >
            <Plus className="h-4 w-4 mr-1" /> Lägg till villkor
          </Button>
        </div>
        {filters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Inga villkor — alla objekt i valda grenar inkluderas.
          </p>
        ) : (
          <div className="space-y-2">
            {filters.map((f, i) => (
              <ConditionFilterRow
                key={i}
                filter={f}
                index={i}
                definitions={definitions}
                onChange={(patch) => updateFilter(i, patch)}
                onRemove={() => removeFilter(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Struktur (antal objekt i vald gren) ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Objekt i vald struktur
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={targetObjectIds.size === 0 || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
              data-testid="button-preview-structure"
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Förhandsvisa
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {previewMutation.data ? (
            <>
              <p className="mb-1" data-testid="text-structure-count">
                <strong>{previewMutation.data.total}</strong> objekt i vald struktur.
              </p>
              <p
                className="mb-2 text-xs text-muted-foreground"
                data-testid="text-structure-breakdown"
              >
                {targetObjectIds.size} valda grenar · {previewMutation.data.descendants}{" "}
                underliggande objekt
              </p>
              {previewMutation.data.sample.length > 0 && (
                <ScrollArea className="h-40 border rounded-md">
                  <div className="divide-y">
                    {previewMutation.data.sample.map((o) => (
                      <div
                        key={o.id}
                        className="px-3 py-1.5 text-xs flex justify-between"
                        data-testid={`preview-item-${o.id}`}
                      >
                        <span>
                          {o.name}
                          {o.objectNumber ? ` (${o.objectNumber})` : ""}
                        </span>
                        <span className="text-muted-foreground">{o.address}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Välj objekt eller grenar och tryck Förhandsvisa för att se hur många objekt som ingår
              i vald struktur.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
