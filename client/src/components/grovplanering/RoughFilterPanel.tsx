import { useState } from "react";
import { Link } from "wouter";
import { addWeeks, addMonths } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useExecutionCodes } from "@/hooks/use-execution-codes";
import {
  ConditionFilterList,
  OBJECT_CONDITION_OPERATORS,
  type ConditionFilter,
  type ConditionField,
} from "@/components/orderkoncept/shared/ConditionFilter";
import {
  ROUGH_STATUS_ORDER,
  ROUGH_STATUS_META,
  weekLabel,
  monthLabel,
  type PeriodMode,
  type RoughStatus,
} from "@/lib/rough-planning";

// Uppgiftsnavet: vilket datumfält perioden filtrerar på (matchar serverns
// GRID_DATE_FIELDS i server/grovplanering-grid.ts).
export type GridDateField = "onskad" | "skapad" | "planerad" | "utford";

export const DATE_FIELD_OPTIONS: { value: GridDateField; label: string }[] = [
  { value: "onskad", label: "Önskad leveranstid" },
  { value: "skapad", label: "Skapad" },
  { value: "planerad", label: "Planerat fönster" },
  { value: "utford", label: "Utförd" },
];

export interface FilterState {
  districtIds: string[];
  teamIds: string[];
  postalCode: string;
  city: string;
  periodMode: PeriodMode;
  anchor: string; // yyyy-MM-dd
  rangeFrom: string;
  rangeTo: string;
  taskTypes: string[];
  statuses: RoughStatus[];
  executionCodes: string[];
  // Uppgiftsnavet: valbart datumfält + tidskod/kund/resurs-filter.
  dateField: GridDateField;
  timeCodes: string[];
  customerIds: string[];
  resourceIds: string[];
  // Task #1410: objekturval via metadatavillkor — samma villkorsrader och
  // delade motor (shared/condition-matching) som objektlistans fördjupade filter.
  conditions: ConditionFilter[];
}

export function createDefaultFilter(): FilterState {
  const today = new Date();
  return {
    districtIds: [],
    teamIds: [],
    postalCode: "",
    city: "",
    periodMode: "vecka",
    anchor: today.toISOString().slice(0, 10),
    rangeFrom: "",
    rangeTo: "",
    taskTypes: [],
    statuses: [],
    executionCodes: [],
    dateField: "onskad",
    timeCodes: [],
    customerIds: [],
    resourceIds: [],
    conditions: [],
  };
}

interface DistrictOption {
  id: string;
  name: string;
}

interface TaskTypeOption {
  key: string;
  label: string;
}

interface RoughFilterPanelProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  districts: DistrictOption[];
  teams: DistrictOption[];
  cities: string[];
  onApply: () => void;
  onClear: () => void;
  isFetching: boolean;
}

const NO_CITY = "__all__";

// Återanvändbar flervals-plockare (select + borttagbara taggar) för registerdrivna
// filter (tidskod/kund/resurs) — samma interaktionsmönster som distrikt/team.
function MultiPick({
  label,
  placeholder,
  testId,
  selected,
  options,
  labelFor,
  onChange,
}: {
  label: string;
  placeholder: string;
  testId: string;
  selected: string[];
  options: { value: string; label: string }[];
  labelFor: (v: string) => string;
  onChange: (next: string[]) => void;
}) {
  const available = options.filter((o) => !selected.includes(o.value));
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Select
        value=""
        onValueChange={(v) => onChange([...selected, v])}
        disabled={available.length === 0}
      >
        <SelectTrigger data-testid={`select-${testId}-filter`}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {available.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.map((v) => (
            <Badge
              key={v}
              variant="secondary"
              className="gap-1"
              data-testid={`tag-${testId}-${v}`}
            >
              {labelFor(v)}
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== v))}
                className="rounded-sm hover-elevate"
                aria-label={`Ta bort ${labelFor(v)}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function RoughFilterPanel({
  value,
  onChange,
  districts,
  teams,
  cities,
  onApply,
  onClear,
  isFetching,
}: RoughFilterPanelProps) {
  const patch = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  const anchorDate = new Date(value.anchor);
  const [showMore, setShowMore] = useState(false);

  // Task #1110: utförandekoder från registret (+ legacy-värden som redan är valda).
  const { options: executionCodeOptions, labelFor: executionCodeLabel } =
    useExecutionCodes(value.executionCodes);

  // Uppgiftstyper kommer enbart från det per-tenant registret
  // (/api/reference/task-types). Backend returnerar tenantens egna typer, eller — för
  // ännu oseedade tenants — de rimliga standardtyperna. Ingen hårdkodad klient-fallback:
  // en sådan kunde visa typer som inte existerar för tenanten och göra filtret
  // missvisande (Task #980).
  const { data: taskTypeData, isLoading: taskTypesLoading } = useQuery<
    TaskTypeOption[]
  >({
    queryKey: ["/api/reference/task-types"],
  });
  const taskTypeOptions: TaskTypeOption[] = taskTypeData ?? [];

  // Task #1410: objekturvalets fältkälla = den svenska metadata-katalogen
  // (samma som objektlistans fördjupade filter). Nyckeln är katalogens `namn` —
  // serverns buildObjectMetadataMap nycklar värden på namn/beteckning/punkt-
  // notation, så namn resolvar alltid.
  const { data: metadataCatalog = [] } = useQuery<{ namn: string }[]>({
    queryKey: ["/api/metadata/types"],
    staleTime: 5 * 60 * 1000,
  });
  const conditionFields: ConditionField[] = metadataCatalog.map((t) => ({
    value: t.namn,
    label: t.namn,
  }));

  // Uppgiftsnavet: register-källor för tidskod-, kund- och resursfiltren.
  const { data: timeCodeDefs = [] } = useQuery<{ key: string; label: string; deletedAt: string | null }[]>({
    queryKey: ["/api/time-codes"],
    staleTime: 5 * 60 * 1000,
  });
  const timeCodeOptions = timeCodeDefs.filter((t) => !t.deletedAt);
  const timeCodeLabel = (key: string) =>
    timeCodeOptions.find((t) => t.key === key)?.label ?? key;

  const { data: customerData = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/customers"],
    staleTime: 5 * 60 * 1000,
  });
  // /api/customers utan params ger bar array (dubbel svarsform — se memory).
  const customerOptions = Array.isArray(customerData) ? customerData : [];
  const customerLabel = (id: string) =>
    customerOptions.find((c) => c.id === id)?.name ?? id;

  const { data: resourceData = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/resources"],
    staleTime: 5 * 60 * 1000,
  });
  const resourceOptions = Array.isArray(resourceData) ? resourceData : [];
  const resourceLabel = (id: string) =>
    resourceOptions.find((r) => r.id === id)?.name ?? id;

  const toggleArray = <T extends string>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  const availableDistricts = districts.filter(
    (d) => !value.districtIds.includes(d.id),
  );
  const selectedDistricts = districts.filter((d) =>
    value.districtIds.includes(d.id),
  );
  const availableTeams = teams.filter((t) => !value.teamIds.includes(t.id));
  const selectedTeams = teams.filter((t) => value.teamIds.includes(t.id));

  const stepAnchor = (delta: number) => {
    const next =
      value.periodMode === "manad"
        ? addMonths(anchorDate, delta)
        : addWeeks(anchorDate, delta);
    patch({ anchor: next.toISOString().slice(0, 10) });
  };

  return (
    <Card data-testid="panel-rough-filters">
      <CardContent className="space-y-5 p-4">
        {/* Geografi */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Distrikt</Label>
            <Select
              value=""
              onValueChange={(id) =>
                patch({ districtIds: [...value.districtIds, id] })
              }
              disabled={availableDistricts.length === 0}
            >
              <SelectTrigger data-testid="select-district">
                <SelectValue placeholder="Lägg till distrikt" />
              </SelectTrigger>
              <SelectContent>
                {availableDistricts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedDistricts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedDistricts.map((d) => (
                  <Badge
                    key={d.id}
                    variant="secondary"
                    className="gap-1"
                    data-testid={`tag-district-${d.id}`}
                  >
                    {d.name}
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          districtIds: value.districtIds.filter((x) => x !== d.id),
                        })
                      }
                      className="rounded-sm hover-elevate"
                      aria-label={`Ta bort ${d.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="filter-postal">
              Postnummer
            </Label>
            <Input
              id="filter-postal"
              value={value.postalCode}
              onChange={(e) => patch({ postalCode: e.target.value })}
              placeholder="t.ex. 802"
              data-testid="input-postal"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Ort</Label>
            <Select
              value={value.city || NO_CITY}
              onValueChange={(v) => patch({ city: v === NO_CITY ? "" : v })}
            >
              <SelectTrigger data-testid="select-city">
                <SelectValue placeholder="Alla orter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CITY}>Alla orter</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tidsperiod — valbart datumfält (Uppgiftsnavet) */}
        <div className="space-y-2">
          <Label className="text-xs">Tidsperiod</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={value.dateField}
              onValueChange={(v) => patch({ dateField: v as GridDateField })}
            >
              <SelectTrigger className="w-[190px]" data-testid="select-date-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FIELD_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tabs
              value={value.periodMode}
              onValueChange={(v) => patch({ periodMode: v as PeriodMode })}
            >
              <TabsList>
                <TabsTrigger value="manad" data-testid="tab-period-manad">
                  Månad
                </TabsTrigger>
                <TabsTrigger value="vecka" data-testid="tab-period-vecka">
                  Vecka
                </TabsTrigger>
                <TabsTrigger value="intervall" data-testid="tab-period-intervall">
                  Datumintervall
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {value.periodMode !== "intervall" ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => stepAnchor(-1)}
                  data-testid="button-period-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span
                  className="min-w-[140px] text-center text-sm font-medium tabular-nums"
                  data-testid="text-period-anchor"
                >
                  {value.periodMode === "manad"
                    ? monthLabel(anchorDate)
                    : weekLabel(anchorDate)}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => stepAnchor(1)}
                  data-testid="button-period-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={value.rangeFrom}
                  onChange={(e) => patch({ rangeFrom: e.target.value })}
                  className="w-40"
                  data-testid="input-range-from"
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="date"
                  value={value.rangeTo}
                  onChange={(e) => patch({ rangeTo: e.target.value })}
                  className="w-40"
                  data-testid="input-range-to"
                />
              </div>
            )}
          </div>
        </div>

        {/* Uppgiftstyp + status */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Uppgiftstyp</Label>
              <Link
                href="/task-types"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="link-manage-task-types"
              >
                <Settings2 className="h-3 w-3" />
                Hantera
              </Link>
            </div>
            {taskTypesLoading ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-tasktypes-loading"
              >
                Laddar uppgiftstyper…
              </p>
            ) : taskTypeOptions.length === 0 ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-tasktypes-empty"
              >
                Inga uppgiftstyper i registret.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {taskTypeOptions.map((t) => (
                  <label
                    key={t.key}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`check-tasktype-${t.key}`}
                  >
                    <Checkbox
                      checked={value.taskTypes.includes(t.key)}
                      onCheckedChange={() =>
                        patch({ taskTypes: toggleArray(value.taskTypes, t.key) })
                      }
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Uppgiftsstatus</Label>
            <div className="grid grid-cols-2 gap-2">
              {ROUGH_STATUS_ORDER.map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-2 text-sm"
                  data-testid={`check-status-${s}`}
                >
                  <Checkbox
                    checked={value.statuses.includes(s)}
                    onCheckedChange={() =>
                      patch({ statuses: toggleArray(value.statuses, s) })
                    }
                  />
                  <span
                    className={
                      "inline-block h-2.5 w-2.5 rounded-full " +
                      ROUGH_STATUS_META[s].dot
                    }
                  />
                  {ROUGH_STATUS_META[s].label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Fler filter — utökade alternativ (team m.m.), dolt som standard */}
        {showMore && (
          <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">Team</Label>
            <Select
              value=""
              onValueChange={(id) =>
                patch({ teamIds: [...value.teamIds, id] })
              }
              disabled={availableTeams.length === 0}
            >
              <SelectTrigger data-testid="select-team-filter">
                <SelectValue placeholder="Lägg till team" />
              </SelectTrigger>
              <SelectContent>
                {availableTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTeams.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedTeams.map((t) => (
                  <Badge
                    key={t.id}
                    variant="secondary"
                    className="gap-1"
                    data-testid={`tag-team-${t.id}`}
                  >
                    {t.name}
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          teamIds: value.teamIds.filter((x) => x !== t.id),
                        })
                      }
                      className="rounded-sm hover-elevate"
                      aria-label={`Ta bort ${t.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Utförandekod</Label>
            <Select
              value=""
              onValueChange={(code) =>
                patch({ executionCodes: [...value.executionCodes, code] })
              }
              disabled={executionCodeOptions.every((o) =>
                value.executionCodes.includes(o.value),
              )}
            >
              <SelectTrigger data-testid="select-execution-code-filter">
                <SelectValue placeholder="Lägg till utförandekod" />
              </SelectTrigger>
              <SelectContent>
                {executionCodeOptions
                  .filter((o) => !value.executionCodes.includes(o.value))
                  .map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {value.executionCodes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {value.executionCodes.map((code) => (
                  <Badge
                    key={code}
                    variant="secondary"
                    className="gap-1"
                    data-testid={`tag-execution-code-${code}`}
                  >
                    {executionCodeLabel(code)}
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          executionCodes: value.executionCodes.filter(
                            (x) => x !== code,
                          ),
                        })
                      }
                      className="rounded-sm hover-elevate"
                      aria-label={`Ta bort ${executionCodeLabel(code)}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Uppgiftsnavet: tidskod, kund och tilldelad resurs */}
          <MultiPick
            label="Tidskod"
            placeholder="Lägg till tidskod"
            testId="time-code"
            selected={value.timeCodes}
            options={timeCodeOptions.map((t) => ({ value: t.key, label: t.label }))}
            labelFor={timeCodeLabel}
            onChange={(timeCodes) => patch({ timeCodes })}
          />
          <MultiPick
            label="Kund"
            placeholder="Lägg till kund"
            testId="customer"
            selected={value.customerIds}
            options={customerOptions.map((c) => ({ value: c.id, label: c.name }))}
            labelFor={customerLabel}
            onChange={(customerIds) => patch({ customerIds })}
          />
          <MultiPick
            label="Tilldelad resurs"
            placeholder="Lägg till resurs"
            testId="resource"
            selected={value.resourceIds}
            options={resourceOptions.map((r) => ({ value: r.id, label: r.name }))}
            labelFor={resourceLabel}
            onChange={(resourceIds) => patch({ resourceIds })}
          />
          </div>
        )}

        {/* Objekturval via metadatavillkor (Task #1410) — samma villkorsrader och
            delade matchningsmotor som objektlistans fördjupade filter. */}
        {showMore && (
          <div className="space-y-2" data-testid="section-object-conditions">
            <Label className="text-xs">Objekturval (metadata)</Label>
            <ConditionFilterList
              filters={value.conditions}
              fields={conditionFields}
              onChange={(conditions) => patch({ conditions })}
              operators={OBJECT_CONDITION_OPERATORS}
              emptyText="Inga metadatavillkor — alla objekt inkluderas."
              fieldPlaceholder="Metadatafält"
              addTestId="button-add-object-condition"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            data-testid="button-toggle-more-filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Fler filter
            <ChevronDown
              className={
                "h-4 w-4 transition-transform " + (showMore ? "rotate-180" : "")
              }
            />
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClear}
              data-testid="button-clear-filters"
            >
              Rensa filter
            </Button>
            <Button
              type="button"
              onClick={onApply}
              disabled={isFetching}
              data-testid="button-apply-filters"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Filter className="h-4 w-4" />
              )}
              Filtrera
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
