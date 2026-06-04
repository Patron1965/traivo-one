import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Trash2, Layers, Filter, Eye, Loader2 } from "lucide-react";
import type { Cluster, MetadataDefinition } from "@shared/schema";

export interface ConditionFilter {
  metadataKey: string;
  operator: string;
  filterValue: unknown;
}

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

const OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: "equals", label: "är lika med" },
  { value: "not_equals", label: "är inte lika med" },
  { value: "contains", label: "innehåller" },
  { value: "starts_with", label: "börjar med" },
  { value: "greater_than", label: "större än" },
  { value: "less_than", label: "mindre än" },
  { value: "exists", label: "finns", noValue: true },
  { value: "not_exists", label: "saknas", noValue: true },
];

export default function Step4Inspection({
  targetClusterIds,
  onToggleCluster,
  filters,
  onFiltersChange,
}: Step4Props) {
  const [search, setSearch] = useState("");
  const { data: clusters = [] } = useQuery<Cluster[]>({ queryKey: ["/api/clusters"] });
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({ queryKey: ["/api/metadata-definitions"] });

  const filteredClusters = useMemo(() => {
    if (!search) return clusters;
    const q = search.toLowerCase();
    return clusters.filter((c) => c.name.toLowerCase().includes(q));
  }, [clusters, search]);

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

  const removeFilter = (i: number) => onFiltersChange(filters.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-6" data-testid="step4-inspection">
      <div>
        <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4" /> Kluster ({targetClusterIds.size} valda)
        </h3>
        <div className="relative mb-2 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök kluster..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-cluster-search"
          />
        </div>
        <ScrollArea className="h-56 border rounded-md">
          {filteredClusters.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">Inga kluster hittades.</p>
          ) : (
            <div className="divide-y">
              {filteredClusters.map((c) => {
                const selected = targetClusterIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onToggleCluster(c.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover-elevate flex items-center justify-between ${selected ? "bg-accent" : ""}`}
                    data-testid={`button-toggle-cluster-${c.id}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color || "#888" }} />
                      {c.name}
                    </span>
                    {selected && <Badge variant="secondary" className="text-[10px]">Vald</Badge>}
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Filter className="h-4 w-4" /> Villkorsfilter
          </h3>
          <Button variant="outline" size="sm" onClick={addFilter} data-testid="button-add-filter">
            <Plus className="h-4 w-4 mr-1" /> Lägg till villkor
          </Button>
        </div>
        {filters.length === 0 ? (
          <p className="text-sm text-muted-foreground">Inga villkor — alla objekt i valda kluster inkluderas.</p>
        ) : (
          <div className="space-y-2">
            {filters.map((f, i) => {
              const op = OPERATORS.find((o) => o.value === f.operator);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`filter-row-${i}`}>
                  <Select value={f.metadataKey} onValueChange={(v) => updateFilter(i, { metadataKey: v })}>
                    <SelectTrigger className="w-[200px]" data-testid={`select-filter-key-${i}`}>
                      <SelectValue placeholder="Metadatafält" />
                    </SelectTrigger>
                    <SelectContent>
                      {definitions.map((d) => (
                        <SelectItem key={d.id} value={d.fieldKey}>{d.fieldLabel}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={f.operator} onValueChange={(v) => updateFilter(i, { operator: v })}>
                    <SelectTrigger className="w-[150px]" data-testid={`select-filter-operator-${i}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!op?.noValue && (
                    <Input
                      placeholder="Värde"
                      value={String(f.filterValue ?? "")}
                      onChange={(e) => updateFilter(i, { filterValue: e.target.value })}
                      className="w-[160px]"
                      data-testid={`input-filter-value-${i}`}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFilter(i)}
                    className="h-9 w-9 p-0 text-destructive hover:text-destructive"
                    data-testid={`button-remove-filter-${i}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2"><Eye className="h-4 w-4" /> Förhandsvisning</span>
            <Button
              variant="outline"
              size="sm"
              disabled={targetClusterIds.size === 0 || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
              data-testid="button-preview-conditions"
            >
              {previewMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Förhandsvisa
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {previewMutation.data ? (
            <>
              <p className="mb-2" data-testid="text-preview-count">
                <strong>{previewMutation.data.matched}</strong> av {previewMutation.data.total} objekt matchar.
              </p>
              {previewMutation.data.sample.length > 0 && (
                <ScrollArea className="h-40 border rounded-md">
                  <div className="divide-y">
                    {previewMutation.data.sample.map((o) => (
                      <div key={o.id} className="px-3 py-1.5 text-xs flex justify-between">
                        <span>{o.name}{o.objectNumber ? ` (${o.objectNumber})` : ""}</span>
                        <span className="text-muted-foreground">{o.address}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Välj kluster och tryck Förhandsvisa för att se hur många objekt som matchar.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
