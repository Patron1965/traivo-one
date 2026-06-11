import { addWeeks, addMonths } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
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
import {
  ROUGH_STATUS_ORDER,
  ROUGH_STATUS_META,
  TASK_TYPE_OPTIONS,
  weekLabel,
  monthLabel,
  type PeriodMode,
  type RoughStatus,
} from "@/lib/rough-planning";

export interface FilterState {
  districtIds: string[];
  postalCode: string;
  city: string;
  periodMode: PeriodMode;
  anchor: string; // yyyy-MM-dd
  rangeFrom: string;
  rangeTo: string;
  taskTypes: string[];
  statuses: RoughStatus[];
}

export function createDefaultFilter(): FilterState {
  const today = new Date();
  return {
    districtIds: [],
    postalCode: "",
    city: "",
    periodMode: "vecka",
    anchor: today.toISOString().slice(0, 10),
    rangeFrom: "",
    rangeTo: "",
    taskTypes: [],
    statuses: [],
  };
}

interface DistrictOption {
  id: string;
  name: string;
}

interface RoughFilterPanelProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  districts: DistrictOption[];
  cities: string[];
  onApply: () => void;
  onClear: () => void;
  isFetching: boolean;
}

const NO_CITY = "__all__";

export function RoughFilterPanel({
  value,
  onChange,
  districts,
  cities,
  onApply,
  onClear,
  isFetching,
}: RoughFilterPanelProps) {
  const patch = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  const anchorDate = new Date(value.anchor);

  const toggleArray = <T extends string>(arr: T[], item: T): T[] =>
    arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];

  const availableDistricts = districts.filter(
    (d) => !value.districtIds.includes(d.id),
  );
  const selectedDistricts = districts.filter((d) =>
    value.districtIds.includes(d.id),
  );

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

        {/* Tidsperiod */}
        <div className="space-y-2">
          <Label className="text-xs">Tidsperiod (önskad leveranstid)</Label>
          <div className="flex flex-wrap items-center gap-3">
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
            <Label className="text-xs">Uppgiftstyp</Label>
            <div className="grid grid-cols-2 gap-2">
              {TASK_TYPE_OPTIONS.map((t) => (
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

        <div className="flex items-center justify-end gap-2 border-t pt-3">
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
      </CardContent>
    </Card>
  );
}
