import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Filter, Eye, Loader2, Layers } from "lucide-react";
import type { Cluster, MetadataDefinition } from "@shared/schema";
import {
  ConditionFilterRow,
  type ConditionFilter,
} from "@/components/orderkoncept/shared/ConditionFilter";
import { ObjectHierarchyTree } from "@/components/objectTree/ObjectHierarchyTree";

export type { ConditionFilter };

interface PreviewResult {
  total: number;
  matched: number;
  sample: { id: string; name: string; objectNumber: string | null; address: string | null }[];
}

interface Step4Props {
  targetClusterIds: Set<string>;
  onToggleCluster: (id: string) => void;
  filters: ConditionFilter[];
  onFiltersChange: (filters: ConditionFilter[]) => void;
}

export default function Step4Inspection({
  targetClusterIds,
  onToggleCluster,
  filters,
  onFiltersChange,
}: Step4Props) {
  const { data: clusters = [] } = useQuery<Cluster[]>({ queryKey: ["/api/clusters"] });
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const clusterColors = useMemo(
    () => new Map(clusters.map((c) => [c.id, c.color ?? "#888"])),
    [clusters],
  );

  const previewMutation = useMutation<PreviewResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/condition-preview", {
        clusterIds: Array.from(targetClusterIds),
        filters: filters.filter((f) => f.metadataKey),
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

      {/* ── Filhierarki ─────────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Filhierarki{" "}
          <Badge variant="secondary" className="text-xs">
            {targetClusterIds.size} valda kluster
          </Badge>
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Navigera hierarkin och välj kluster att inkludera. Klicka på ett objekt eller bocka i
          rutan vid ett objekt för att välja hela dess kluster.
        </p>

        {/* Same tree view as ClusterTreeExplorer (arbetsbilden) */}
        <ObjectHierarchyTree
          selectedClusterIds={targetClusterIds}
          onToggleCluster={onToggleCluster}
          clusterColors={clusterColors}
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
            Inga villkor — alla objekt i valda kluster inkluderas.
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

      {/* ── Förhandsvisning ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Förhandsvisning
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={targetClusterIds.size === 0 || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
              data-testid="button-preview-conditions"
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
              <p className="mb-2" data-testid="text-preview-count">
                <strong>{previewMutation.data.matched}</strong> av{" "}
                {previewMutation.data.total} konkreta objekt matchar.
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
              Välj kluster och tryck Förhandsvisa för att se hur många konkreta objekt som matchar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
