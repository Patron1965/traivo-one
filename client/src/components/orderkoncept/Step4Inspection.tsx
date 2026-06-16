import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Filter, Eye, Loader2, Layers, FlaskConical, Check, X } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";
import {
  ConditionFilterRow,
  CONDITION_OPERATORS,
  type ConditionFilter,
} from "@/components/orderkoncept/shared/ConditionFilter";
import { ObjectHierarchyTree } from "@/components/objectTree/ObjectHierarchyTree";
import { ObjectParentCombobox } from "@/components/ObjectParentCombobox";

export type { ConditionFilter };

interface PreviewResult {
  total: number;
  matched: number;
  sample: { id: string; name: string; objectNumber: string | null; address: string | null }[];
}

interface ConditionTestRow {
  metadataKey: string;
  operator: string;
  filterValue: unknown;
  actualValue: unknown;
  passed: boolean;
}

interface ConditionTestResult {
  objectId: string;
  objectName: string;
  objectNumber: string | null;
  address: string | null;
  matched: boolean;
  inTargetScope: boolean | null;
  wouldExpand: boolean;
  results: ConditionTestRow[];
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

  const previewMutation = useMutation<PreviewResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/condition-preview", {
        objectIds: Array.from(targetObjectIds),
        filters: filters.filter((f) => f.metadataKey),
      });
      return res.json();
    },
  });

  // ── Villkorstest mot enskilt objekt ──────────────────────────────────────
  const [testObjectId, setTestObjectId] = useState<string | null>(null);
  const [testObjectLabel, setTestObjectLabel] = useState<string | null>(null);

  const testMutation = useMutation<ConditionTestResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/order-concepts/condition-test", {
        objectId: testObjectId,
        objectIds: Array.from(targetObjectIds),
        filters: filters.filter((f) => f.metadataKey),
      });
      return res.json();
    },
  });

  // Töm tidigare testresultat när villkor eller inpekning ändras — annars kan
  // panelen visa ett inaktuellt utfall som inte längre speglar filtren.
  const filtersSignature = JSON.stringify(filters);
  const scopeSignature = Array.from(targetObjectIds).sort().join(",");
  useEffect(() => {
    testMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersSignature, scopeSignature]);

  const operatorLabel = (op: string) =>
    CONDITION_OPERATORS.find((o) => o.value === op)?.label ?? op;
  const operatorNoValue = (op: string) =>
    CONDITION_OPERATORS.find((o) => o.value === op)?.noValue ?? false;
  const fieldLabel = (key: string) =>
    definitions.find((d) => d.fieldKey === key)?.fieldLabel ?? key;
  const formatVal = (v: unknown): string => {
    if (v === null || v === undefined || v === "") return "(tomt)";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const activeFilterCount = filters.filter((f) => f.metadataKey).length;

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
              disabled={targetObjectIds.size === 0 || previewMutation.isPending}
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
              Välj objekt eller grenar och tryck Förhandsvisa för att se hur många konkreta objekt
              som matchar.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Villkorstest mot enskilt objekt ──────────────────────────────────── */}
      <Card data-testid="condition-test-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4" /> Villkorstest mot enskilt objekt
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <p className="text-muted-foreground text-xs">
            Välj ett objekt och testa det aktuella filtersetet mot just det objektet — se vilka
            villkor som matchar respektive fallerar, med objektets faktiska värde. Samma logik som
            förhandsvisningen och den faktiska expansionen.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <ObjectParentCombobox
              value={testObjectId}
              valueLabel={testObjectLabel}
              onChange={(id, option) => {
                setTestObjectId(id);
                setTestObjectLabel(
                  option ? `${option.name}${option.objectNumber ? ` (#${option.objectNumber})` : ""}` : null,
                );
                testMutation.reset();
              }}
              placeholder="Välj objekt att testa..."
              emptyOptionLabel="Inget objekt"
              className="w-[360px]"
              testId="combobox-test-object"
            />
            <Button
              size="sm"
              disabled={!testObjectId || testMutation.isPending}
              onClick={() => testMutation.mutate()}
              data-testid="button-run-condition-test"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Testa villkor
            </Button>
          </div>

          {testMutation.isError && (
            <p className="text-destructive text-xs" data-testid="text-test-error">
              {(testMutation.error as Error)?.message ?? "Testet kunde inte köras."}
            </p>
          )}

          {testMutation.data && (
            <div className="space-y-3" data-testid="condition-test-result">
              {/* Sammanfattning */}
              <div className="flex flex-wrap items-center gap-2">
                {testMutation.data.wouldExpand ? (
                  <Badge data-testid="badge-test-verdict">Skulle inkluderas</Badge>
                ) : (
                  <Badge variant="secondary" data-testid="badge-test-verdict">
                    Skulle inte inkluderas
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {testMutation.data.objectName}
                  {testMutation.data.objectNumber ? ` (#${testMutation.data.objectNumber})` : ""}
                </span>
              </div>

              <div className="grid gap-1 text-xs">
                {testMutation.data.inTargetScope !== null && (
                  <div className="flex items-center gap-2" data-testid="row-test-scope">
                    {testMutation.data.inTargetScope ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-destructive" />
                    )}
                    <span>
                      Ingår i vald inpekning:{" "}
                      <strong>{testMutation.data.inTargetScope ? "Ja" : "Nej"}</strong>
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2" data-testid="row-test-matched">
                  {testMutation.data.matched ? (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span>
                    Matchar villkoren:{" "}
                    <strong>{testMutation.data.matched ? "Ja" : "Nej"}</strong>
                    {activeFilterCount === 0 ? " (inga villkor satta)" : ""}
                  </span>
                </div>
              </div>

              {/* Per-villkor */}
              {testMutation.data.results.length > 0 && (
                <div className="border rounded-md divide-y">
                  {testMutation.data.results.map((r, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 flex items-start gap-2 text-xs"
                      data-testid={`test-condition-row-${i}`}
                    >
                      {r.passed ? (
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div>
                          <strong>{fieldLabel(r.metadataKey)}</strong>{" "}
                          {operatorLabel(r.operator)}
                          {!operatorNoValue(r.operator) && (
                            <> "{formatVal(r.filterValue)}"</>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          Objektets värde: {formatVal(r.actualValue)}
                        </div>
                      </div>
                      <Badge
                        variant={r.passed ? "secondary" : "destructive"}
                        className="text-[10px] shrink-0"
                      >
                        {r.passed ? "Matchar" : "Fallerar"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
