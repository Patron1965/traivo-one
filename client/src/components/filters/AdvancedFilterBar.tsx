/**
 * Task #1240 — Generisk avancerad filter-rad + sparade/delade filter, byggd på
 * den delade filtermotorn (shared/filter-engine.ts). Avsedd att återanvändas
 * av alla ytor (uppgiftsnav, objektnav, portal, utförarapp, administration) —
 * skicka in fields (fältkatalog för ytan) och scope (för persistens av sparade
 * filter). Motorn evalueras klient-side via evaluateFilterGroup i anropande vy.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Filter as FilterIcon, Save, Share2, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  emptyFilterGroup,
  visibleFieldsForRole,
  type FilterCondition,
  type FilterFieldDef,
  type FilterGroup,
  type FilterOperator,
  type SavedFilterScope,
} from "@shared/filter-engine";

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "är",
  neq: "är inte",
  contains: "innehåller",
  not_contains: "innehåller inte",
  gt: "större än",
  gte: "större eller lika med",
  lt: "mindre än",
  lte: "mindre eller lika med",
  between: "mellan",
  in: "en av",
  not_in: "ingen av",
  is_empty: "är tom",
  is_not_empty: "är ifylld",
};

const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  text: ["contains", "not_contains", "eq", "neq", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "is_empty"],
  boolean: ["eq"],
  select: ["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"],
  multiselect: ["in", "not_in", "is_empty", "is_not_empty"],
};

const SHARE_ROLE_OPTIONS = ["owner", "admin", "planner", "technician", "user", "viewer"] as const;

interface SavedFilterRow {
  id: string;
  name: string;
  definition: { group: FilterGroup };
  isShared: boolean;
  userId: string;
}

interface AdvancedFilterBarProps<TRow> {
  scope: SavedFilterScope;
  fields: FilterFieldDef<TRow>[];
  value: FilterGroup;
  onChange: (group: FilterGroup) => void;
}

export function AdvancedFilterBar<TRow>({ scope, fields, value, onChange }: AdvancedFilterBarProps<TRow>) {
  const { toast } = useToast();
  const { user } = useAuth() as { user?: { role?: string | null } };
  const role = user?.role ?? null;
  const visibleFields = visibleFieldsForRole(fields, role);
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [shareRoles, setShareRoles] = useState<string[]>([]);

  const toggleShareRole = (r: string, checked: boolean) =>
    setShareRoles((prev) => (checked ? [...prev, r] : prev.filter((x) => x !== r)));

  const { data: savedFilters = [] } = useQuery<SavedFilterRow[]>({
    queryKey: ["/api/saved-filters", scope],
    queryFn: async () =>
      (await apiRequest("GET", `/api/saved-filters?scope=${scope}`)).json(),
  });

  const saveMutation = useMutation({
    mutationFn: async (params: { name: string; isShared: boolean; roles: string[] }) =>
      (
        await apiRequest("POST", "/api/saved-filters", {
          scope,
          name: params.name,
          definition: { scope, name: params.name, group: value },
          isShared: params.isShared,
          // Tom roles-lista = synligt för alla delade-mottagare (se filterRoutes.ts);
          // en icke-tom lista begränsar delningen till dessa roller.
          roles: params.isShared ? params.roles : [],
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters", scope] });
      toast({ title: "Filtret sparades" });
      setSaveName("");
      setShareRoles([]);
    },
    onError: (err: Error) =>
      toast({ title: "Kunde inte spara filtret", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/saved-filters/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/saved-filters", scope] }),
  });

  const addCondition = () => {
    const first = visibleFields[0];
    if (!first) return;
    const cond: FilterCondition = {
      field: first.key,
      operator: OPERATORS_BY_TYPE[first.type]?.[0] ?? "eq",
      value: "",
    };
    onChange({ ...value, conditions: [...value.conditions, cond] });
  };

  const updateCondition = (idx: number, patch: Partial<FilterCondition>) => {
    const conditions = value.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ ...value, conditions });
  };

  const removeCondition = (idx: number) => {
    onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== idx) });
  };

  const activeCount = value.conditions.length;

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="advanced-filter-bar">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="button-advanced-filter">
            <FilterIcon className="h-4 w-4 mr-2" />
            Avancerat filter
            {activeCount > 0 && (
              <Badge variant="secondary" className="ml-2" data-testid="badge-advanced-filter-count">
                {activeCount}
              </Badge>
            )}
            <ChevronDown className="h-3 w-3 ml-1" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[520px] p-4" align="start" data-testid="popover-advanced-filter">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase text-muted-foreground">Villkor ({value.combinator === "and" ? "alla" : "något"} måste stämma)</Label>
              <Select value={value.combinator} onValueChange={(v) => onChange({ ...value, combinator: v as "and" | "or" })}>
                <SelectTrigger className="w-28 h-8" data-testid="select-filter-combinator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">Alla (OCH)</SelectItem>
                  <SelectItem value="or">Något (ELLER)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {value.conditions.map((cond, idx) => {
              const def = visibleFields.find((f) => f.key === cond.field);
              const ops = OPERATORS_BY_TYPE[def?.type ?? "text"];
              return (
                <div key={idx} className="flex items-center gap-2" data-testid={`row-filter-condition-${idx}`}>
                  <Select value={cond.field} onValueChange={(v) => updateCondition(idx, { field: v, value: "" })}>
                    <SelectTrigger className="w-40 h-8" data-testid={`select-filter-field-${idx}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleFields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={cond.operator} onValueChange={(v) => updateCondition(idx, { operator: v as FilterOperator })}>
                    <SelectTrigger className="w-40 h-8" data-testid={`select-filter-operator-${idx}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ops.map((op) => (
                        <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(cond.operator === "in" || cond.operator === "not_in") && (
                    <Input
                      className="h-8 flex-1"
                      placeholder="Värde 1, värde 2, ..."
                      value={Array.isArray(cond.value) ? cond.value.join(", ") : ""}
                      onChange={(e) =>
                        updateCondition(idx, {
                          value: e.target.value
                            .split(",")
                            .map((v) => v.trim())
                            .filter((v) => v.length > 0),
                        })
                      }
                      data-testid={`input-filter-value-${idx}`}
                    />
                  )}
                  {cond.operator === "between" && (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        className="h-8"
                        placeholder="Från"
                        value={Array.isArray(cond.value) ? String(cond.value[0] ?? "") : ""}
                        onChange={(e) => {
                          const to = Array.isArray(cond.value) ? cond.value[1] ?? "" : "";
                          updateCondition(idx, { value: [e.target.value, to] });
                        }}
                        data-testid={`input-filter-value-from-${idx}`}
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input
                        className="h-8"
                        placeholder="Till"
                        value={Array.isArray(cond.value) ? String(cond.value[1] ?? "") : ""}
                        onChange={(e) => {
                          const from = Array.isArray(cond.value) ? cond.value[0] ?? "" : "";
                          updateCondition(idx, { value: [from, e.target.value] });
                        }}
                        data-testid={`input-filter-value-to-${idx}`}
                      />
                    </div>
                  )}
                  {cond.operator !== "is_empty" &&
                    cond.operator !== "is_not_empty" &&
                    cond.operator !== "in" &&
                    cond.operator !== "not_in" &&
                    cond.operator !== "between" && (
                      <Input
                        className="h-8 flex-1"
                        value={typeof cond.value === "string" || typeof cond.value === "number" ? String(cond.value) : ""}
                        onChange={(e) => updateCondition(idx, { value: e.target.value })}
                        data-testid={`input-filter-value-${idx}`}
                      />
                    )}
                  <Button variant="ghost" size="icon" onClick={() => removeCondition(idx)} data-testid={`button-remove-condition-${idx}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}

            <Button variant="outline" size="sm" onClick={addCondition} data-testid="button-add-condition">
              <Plus className="h-4 w-4 mr-2" /> Lägg till villkor
            </Button>

            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs uppercase text-muted-foreground">Spara filter</Label>
              <div className="flex items-center gap-3 flex-wrap">
                {SHARE_ROLE_OPTIONS.map((r) => (
                  <label key={r} className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`label-share-role-${r}`}>
                    <Checkbox
                      checked={shareRoles.includes(r)}
                      onCheckedChange={(checked) => toggleShareRole(r, checked === true)}
                      data-testid={`checkbox-share-role-${r}`}
                    />
                    {r}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {shareRoles.length === 0
                  ? "Ingen roll vald = delas med alla roller"
                  : `Delas endast med: ${shareRoles.join(", ")}`}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Namn på filtret"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  className="h-8"
                  data-testid="input-save-filter-name"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!saveName || saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ name: saveName, isShared: false, roles: [] })}
                  data-testid="button-save-filter"
                >
                  <Save className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!saveName || saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ name: saveName, isShared: true, roles: shareRoles })}
                  data-testid="button-save-filter-shared"
                  title={shareRoles.length > 0 ? `Dela med roller: ${shareRoles.join(", ")}` : "Dela med alla i verksamheten"}
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {savedFilters.length > 0 && (
        <Select
          onValueChange={(id) => {
            const found = savedFilters.find((f) => f.id === id);
            if (found?.definition?.group) onChange(found.definition.group);
          }}
        >
          <SelectTrigger className="w-52 h-8" data-testid="select-saved-filter">
            <SelectValue placeholder="Sparade filter" />
          </SelectTrigger>
          <SelectContent>
            {savedFilters.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}{f.isShared ? " (delat)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilterGroup())} data-testid="button-clear-advanced-filter">
          Rensa
        </Button>
      )}
    </div>
  );
}
