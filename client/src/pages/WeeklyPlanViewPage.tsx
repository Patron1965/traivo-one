import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  addDays,
  format,
} from "date-fns";
import { sv } from "date-fns/locale";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Lock,
  MapPin,
  Moon,
  Palmtree,
  Plus,
  RefreshCw,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Check,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatSekFromOre, formatSek } from "@/lib/format";
import {
  getTimeCategoryStyle,
  getWarningSeverityStyle,
  TIME_CATEGORY_ORDER,
  TIME_CATEGORY_STYLES,
  type TimeCategoryKey,
} from "@/lib/weekly-plan-categories";
import type {
  WeeklyPlan,
  WeeklyPlanTask,
  PersonalTask,
  TravelTimeEntry,
  WeeklyPlanWarning,
} from "@shared/schema";

const WEEK_TOTAL_MINUTES = 168 * 60;
const HOUR_PX = 26;
const DAY_LABELS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

interface Team {
  id: string;
  name: string;
  color: string | null;
}

interface WeeklyPlanDetail extends WeeklyPlan {
  tasks: WeeklyPlanTask[];
  personalTasks: PersonalTask[];
  travelEntries: TravelTimeEntry[];
  warnings: WeeklyPlanWarning[];
}

interface ScheduleBlock {
  id: string;
  kind: "task" | "personal";
  category: TimeCategoryKey | string;
  title: string;
  date: string | null;
  startMinutes: number | null;
  durationMinutes: number;
  locked: boolean;
  locationName: string | null;
}

// ---------------------------------------------------------------------------
// Tidshjälpare
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHHMM(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function localDateString(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localMinutes(iso: string | Date): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function toIso(date: string, minutes: number): string {
  return new Date(`${date}T${minutesToHHMM(minutes)}:00`).toISOString();
}

function formatHours(minutes: number | null | undefined): string {
  if (minutes == null) return "0 h";
  return `${(minutes / 60).toFixed(1)} h`;
}

function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null) return "–";
  return `${(ratio * 100).toFixed(0)} %`;
}

// ---------------------------------------------------------------------------
// Normalisering av plan-block
// ---------------------------------------------------------------------------

function taskToBlock(t: WeeklyPlanTask): ScheduleBlock {
  let date: string | null = t.plannedDate ?? null;
  let startMinutes: number | null = null;
  if (t.plannedStartTime) {
    date = date ?? localDateString(t.plannedStartTime);
    startMinutes = localMinutes(t.plannedStartTime);
  }
  let duration = t.productionMinutes ?? 0;
  if (!duration && t.plannedStartTime && t.plannedEndTime) {
    duration = Math.max(
      0,
      Math.round((new Date(t.plannedEndTime).getTime() - new Date(t.plannedStartTime).getTime()) / 60000),
    );
  }
  return {
    id: t.id,
    kind: "task",
    category: "production",
    title: t.notes?.trim() || "Produktion",
    date,
    startMinutes,
    durationMinutes: duration || 60,
    locked: Boolean(t.locked),
    locationName: null,
  };
}

function personalToBlock(pt: PersonalTask): ScheduleBlock {
  let date: string | null = pt.plannedDate ?? null;
  let startMinutes: number | null = null;
  if (pt.startAt) {
    date = date ?? localDateString(pt.startAt);
    startMinutes = localMinutes(pt.startAt);
  }
  let duration = pt.durationMinutes ?? 0;
  if (!duration && pt.startAt && pt.endAt) {
    duration = Math.max(
      0,
      Math.round((new Date(pt.endAt).getTime() - new Date(pt.startAt).getTime()) / 60000),
    );
  }
  const style = getTimeCategoryStyle(pt.timeCategory);
  return {
    id: pt.id,
    kind: "personal",
    category: pt.timeCategory,
    title: pt.title?.trim() || style.label,
    date,
    startMinutes,
    durationMinutes: duration || 30,
    locked: false,
    locationName: pt.locationName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sida
// ---------------------------------------------------------------------------

export default function WeeklyPlanViewPage() {
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);
  const [teamId, setTeamId] = useState<string>("");
  const [year, setYear] = useState<number>(getISOWeekYear(now));
  const [week, setWeek] = useState<number>(getISOWeek(now));
  const [editing, setEditing] = useState<ScheduleBlock | null>(null);

  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const effectiveTeamId = teamId || teams[0]?.id || "";

  const listKey = `/api/weekly-plans?teamId=${effectiveTeamId}&year=${year}&week=${week}`;
  const { data: planList, isLoading: listLoading } = useQuery<WeeklyPlan[]>({
    queryKey: [listKey],
    enabled: !!effectiveTeamId,
  });

  const planId = planList?.[0]?.id;
  const detailKey = planId ? `/api/weekly-plans/${planId}` : "";
  const { data: plan, isLoading: detailLoading } = useQuery<WeeklyPlanDetail>({
    queryKey: [detailKey],
    enabled: !!planId,
  });

  const weekStart = useMemo(() => {
    let d = setISOWeekYear(now, year);
    d = setISOWeek(d, week);
    return startOfISOWeek(d);
  }, [now, year, week]);

  const dayDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => localDateString(addDays(weekStart, i))),
    [weekStart],
  );

  const blocks = useMemo<ScheduleBlock[]>(() => {
    if (!plan) return [];
    return [
      ...(plan.tasks ?? []).map(taskToBlock),
      ...(plan.personalTasks ?? []).map(personalToBlock),
    ];
  }, [plan]);

  const invalidatePlan = () => {
    if (detailKey) queryClient.invalidateQueries({ queryKey: [detailKey] });
    queryClient.invalidateQueries({ queryKey: [listKey] });
  };

  const createPlan = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/weekly-plans", {
        teamId: effectiveTeamId,
        year,
        weekNumber: week,
        status: "draft",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [listKey] });
      toast({ title: "Veckoplan skapad" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte skapa veckoplan", description: e.message, variant: "destructive" }),
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/weekly-plans/${planId}/recompute`, { recomputeTravel: true });
      return res.json();
    },
    onSuccess: () => {
      invalidatePlan();
      toast({ title: "Planen omräknad" });
    },
    onError: (e: Error) => toast({ title: "Omräkning misslyckades", description: e.message, variant: "destructive" }),
  });

  const moveBlock = useMutation({
    mutationFn: async (vars: { block: ScheduleBlock; date: string; startMinutes: number; duration: number }) => {
      const { block, date, startMinutes, duration } = vars;
      const start = toIso(date, startMinutes);
      const end = toIso(date, startMinutes + duration);
      if (block.kind === "task") {
        await apiRequest("PATCH", `/api/weekly-plan-tasks/${block.id}`, {
          plannedDate: date,
          plannedStartTime: start,
          plannedEndTime: end,
        });
      } else {
        await apiRequest("PATCH", `/api/personal-tasks/${block.id}`, {
          plannedDate: date,
          startAt: start,
          endAt: end,
          durationMinutes: duration,
        });
      }
    },
    onSuccess: () => {
      invalidatePlan();
      setEditing(null);
      toast({ title: "Block uppdaterat" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte spara block", description: e.message, variant: "destructive" }),
  });

  const resolveWarning = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/weekly-plan-warnings/${id}/resolve`, {});
    },
    onSuccess: () => {
      invalidatePlan();
      toast({ title: "Varning åtgärdad" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte åtgärda varning", description: e.message, variant: "destructive" }),
  });

  const shiftWeek = (delta: number) => {
    let d = setISOWeekYear(now, year);
    d = setISOWeek(d, week);
    d = addDays(d, delta * 7);
    setYear(getISOWeekYear(d));
    setWeek(getISOWeek(d));
  };

  const handleDropOnDay = (date: string, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const block = blocks.find((b) => b.id === id);
    if (!block || block.locked) return;
    if (block.date === date) return;
    moveBlock.mutate({
      block,
      date,
      startMinutes: block.startMinutes ?? 8 * 60,
      duration: block.durationMinutes,
    });
  };

  const kpi = (plan?.metadata as Record<string, any> | null)?.kpi ?? {};
  const weekTotalMinutes: number = kpi.weekTotalMinutes ?? 0;
  const within168h: boolean = kpi.within168h ?? weekTotalMinutes <= WEEK_TOTAL_MINUTES;

  const restNight = plan?.personalTasks?.find((p) => p.timeCategory === "rest_night");
  const restWeekend = plan?.personalTasks?.find((p) => p.timeCategory === "rest_weekend");

  const activeWarnings = (plan?.warnings ?? []).filter((w) => !w.resolved);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
        <PageHeader icon={CalendarRange} title="Grovplanering" testId="text-page-title" />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={effectiveTeamId} onValueChange={setTeamId} disabled={teamsLoading}>
            <SelectTrigger className="w-48" data-testid="select-team">
              <SelectValue placeholder="Välj team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id} data-testid={`option-team-${t.id}`}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 rounded-md border border-border px-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => shiftWeek(-1)} data-testid="button-prev-week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums px-1" data-testid="text-week-label">
              v.{week} {year}
            </span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => shiftWeek(1)} data-testid="button-next-week">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {planId && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => recompute.mutate()}
              disabled={recompute.isPending}
              data-testid="button-recompute"
            >
              <RefreshCw className={`h-4 w-4 ${recompute.isPending ? "animate-spin" : ""}`} />
              Räkna om
            </Button>
          )}
        </div>
      </div>

      <p className="px-4 pt-1 text-sm text-muted-foreground">
        {format(weekStart, "d MMM", { locale: sv })} – {format(addDays(weekStart, 6), "d MMM yyyy", { locale: sv })}
      </p>

      <div className="p-4 space-y-4">
        {(listLoading || (planId && detailLoading)) && (
          <div className="space-y-4" data-testid="loading-plan">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-96" />
          </div>
        )}

        {!effectiveTeamId && !teamsLoading && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground" data-testid="empty-no-team">
              Inga team hittades. Skapa ett team för att planera veckan.
            </CardContent>
          </Card>
        )}

        {effectiveTeamId && !listLoading && !planId && (
          <Card>
            <CardContent className="py-10 flex flex-col items-center gap-3" data-testid="empty-no-plan">
              <CalendarRange className="h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">Ingen veckoplan finns för valt team och vecka.</p>
              <Button onClick={() => createPlan.mutate()} disabled={createPlan.isPending} className="gap-1.5" data-testid="button-create-plan">
                <Plus className="h-4 w-4" />
                Skapa veckoplan
              </Button>
            </CardContent>
          </Card>
        )}

        {plan && (
          <>
            {/* Toppkort: platser */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <PlaceCard
                icon={MapPin}
                title="Utgångsplats"
                value={
                  plan.startLocationLat != null && plan.startLocationLng != null
                    ? `${plan.startLocationLat.toFixed(4)}, ${plan.startLocationLng.toFixed(4)}`
                    : "Ej angiven"
                }
                testId="card-start-location"
              />
              <PlaceCard
                icon={Moon}
                title="Nattvila"
                value={restNight?.locationName || plan.restLocation || "Ej angiven"}
                testId="card-night-rest"
              />
              <PlaceCard
                icon={Palmtree}
                title="Helgvila"
                value={
                  restWeekend?.locationName ||
                  (restWeekend?.startAt
                    ? `Start ${format(new Date(restWeekend.startAt), "EEEE HH:mm", { locale: sv })}`
                    : "Ej angiven")
                }
                testId="card-weekend-rest"
              />
            </div>

            {/* KPI-paneler */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <KpiCard label="Producerade timmar" value={formatHours(plan.totalProductionMinutes)} testId="kpi-produced-hours" />
              <KpiCard label="Ordervärde" value={formatSekFromOre(plan.totalValue)} testId="kpi-order-value" />
              <KpiCard label="Produktivitet" value={`${formatSek(kpi.productivity ?? 0)}/h`} testId="kpi-productivity" />
              <KpiCard label="Planeringsgrad" value={formatPercent(kpi.planningRate)} testId="kpi-planning-rate" />
              <KpiCard label="Utnyttjandegrad" value={formatPercent(plan.utilizationRate)} testId="kpi-utilization-rate" />
              <KpiCard label="Debiteringsgrad" value={formatPercent(kpi.billingRate)} testId="kpi-billing-rate" />
              <KpiCard label="Reseandel" value={formatPercent(kpi.travelShare)} testId="kpi-travel-share" />
              <KpiCard label="Estimerade km" value={`${(kpi.estimatedKm ?? 0).toFixed(0)} km`} testId="kpi-estimated-km" />
              <KpiCard label="Resekostnad" value={formatSekFromOre(plan.totalTravelCost)} testId="kpi-travel-cost" />
              <KpiCard label="CO₂" value={`${(kpi.estimatedCo2Kg ?? 0).toFixed(1)} kg`} testId="kpi-co2" />
            </div>

            {/* 168h-summering */}
            <Summary168
              weekTotalMinutes={weekTotalMinutes}
              within168h={within168h}
              segments={TIME_CATEGORY_ORDER.map((key) => ({
                key,
                minutes: categoryMinutes(plan, key),
              }))}
            />

            {/* Veckokalender */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Veckoschema</CardTitle>
              </CardHeader>
              <CardContent>
                <WeekCalendar
                  dayDates={dayDates}
                  blocks={blocks}
                  onDropOnDay={handleDropOnDay}
                  onSelectBlock={(b) => setEditing(b)}
                />
                <Legend />
              </CardContent>
            </Card>

            {/* Varningar */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  Varningar
                  {activeWarnings.length > 0 && (
                    <Badge variant="outline" data-testid="badge-warning-count">{activeWarnings.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2" data-testid="list-warnings">
                {(plan.warnings ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="empty-warnings">Inga varningar.</p>
                )}
                {(plan.warnings ?? [])
                  .slice()
                  .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
                  .map((w) => (
                    <WarningRow
                      key={w.id}
                      warning={w}
                      onResolve={() => resolveWarning.mutate(w.id)}
                      resolving={resolveWarning.isPending}
                    />
                  ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <BlockEditDialog
        block={editing}
        onClose={() => setEditing(null)}
        onSave={(date, startMinutes, duration) =>
          editing && moveBlock.mutate({ block: editing, date, startMinutes, duration })
        }
        saving={moveBlock.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hjälpfunktioner för summering
// ---------------------------------------------------------------------------

function categoryMinutes(plan: WeeklyPlanDetail, key: TimeCategoryKey): number {
  switch (key) {
    case "production":
      return plan.totalProductionMinutes ?? 0;
    case "travel_between_jobs":
      return plan.totalTravelMinutes ?? 0;
    case "travel_commute":
      return plan.totalCommuteMinutes ?? 0;
    case "break_meal":
      return plan.totalBreakMinutes ?? 0;
    case "personal_time":
      return plan.totalPersonalMinutes ?? 0;
    case "rest_night":
      return ((plan.metadata as Record<string, any> | null)?.kpi?.totalRestNightMinutes) ?? 0;
    case "rest_weekend":
      return ((plan.metadata as Record<string, any> | null)?.kpi?.totalRestWeekendMinutes) ?? 0;
    case "overtime":
      return plan.totalOvertimeMinutes ?? 0;
    default:
      return 0;
  }
}

function severityRank(s: string): number {
  return { error: 0, warning: 1, info: 2, ok: 3 }[s as "error"] ?? 4;
}

// ---------------------------------------------------------------------------
// Delkomponenter
// ---------------------------------------------------------------------------

function PlaceCard({ icon: Icon, title, value, testId }: { icon: typeof MapPin; title: string; value: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="rounded-md bg-muted p-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-sm font-medium truncate" title={value}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums" data-testid={`${testId}-value`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Summary168({
  weekTotalMinutes,
  within168h,
  segments,
}: {
  weekTotalMinutes: number;
  within168h: boolean;
  segments: { key: TimeCategoryKey; minutes: number }[];
}) {
  const unallocated = Math.max(0, WEEK_TOTAL_MINUTES - weekTotalMinutes);
  return (
    <Card data-testid="summary-168h">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span>168-timmars summering</span>
          <span className="flex items-center gap-2 text-sm font-normal">
            <span className="tabular-nums" data-testid="text-week-total">
              {(weekTotalMinutes / 60).toFixed(1)} / 168 h
            </span>
            {within168h ? (
              <Badge className="bg-chart-2/15 text-chart-2 border border-chart-2/30" data-testid="badge-168-ok">
                Inom 168h
              </Badge>
            ) : (
              <Badge className="bg-destructive/15 text-destructive border border-destructive/30" data-testid="badge-168-over">
                Överskrider 168h
              </Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-6 w-full overflow-hidden rounded-md bg-muted" data-testid="bar-168h">
          {segments
            .filter((s) => s.minutes > 0)
            .map((s) => {
              const style = TIME_CATEGORY_STYLES[s.key];
              const pct = (s.minutes / WEEK_TOTAL_MINUTES) * 100;
              return (
                <div
                  key={s.key}
                  className={style.bar}
                  style={{ width: `${pct}%` }}
                  title={`${style.label}: ${(s.minutes / 60).toFixed(1)} h`}
                  data-testid={`bar-segment-${s.key}`}
                />
              );
            })}
          {unallocated > 0 && (
            <div
              className="bg-transparent"
              style={{ width: `${(unallocated / WEEK_TOTAL_MINUTES) * 100}%` }}
              title={`Ej allokerad: ${(unallocated / 60).toFixed(1)} h`}
            />
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="text-unallocated">
          Ej allokerad tid: {(unallocated / 60).toFixed(1)} h
        </p>
      </CardContent>
    </Card>
  );
}

function WeekCalendar({
  dayDates,
  blocks,
  onDropOnDay,
  onSelectBlock,
}: {
  dayDates: string[];
  blocks: ScheduleBlock[];
  onDropOnDay: (date: string, e: React.DragEvent) => void;
  onSelectBlock: (b: ScheduleBlock) => void;
}) {
  const hourMarks = Array.from({ length: 13 }, (_, i) => i * 2); // 0,2,...,24
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[760px]">
        {/* Tidsgutter */}
        <div className="w-12 shrink-0 pt-7">
          <div className="relative" style={{ height: `${24 * HOUR_PX}px` }}>
            {hourMarks.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 text-[10px] text-muted-foreground -translate-y-1/2"
                style={{ top: `${h * HOUR_PX}px` }}
              >
                {pad2(h)}:00
              </div>
            ))}
          </div>
        </div>

        {/* Dagkolumner */}
        {dayDates.map((date, idx) => {
          const dayBlocks = blocks.filter((b) => b.date === date);
          const timed = dayBlocks.filter((b) => b.startMinutes != null);
          const untimed = dayBlocks.filter((b) => b.startMinutes == null);
          return (
            <div
              key={date}
              className="flex-1 min-w-[96px] border-l border-border"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnDay(date, e)}
              data-testid={`day-column-${idx}`}
            >
              <div className="h-7 flex flex-col items-center justify-center border-b border-border">
                <span className="text-xs font-medium">{DAY_LABELS[idx]}</span>
                <span className="text-[10px] text-muted-foreground">{date.slice(5)}</span>
              </div>
              <div className="relative bg-muted/20" style={{ height: `${24 * HOUR_PX}px` }}>
                {hourMarks.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/40"
                    style={{ top: `${h * HOUR_PX}px` }}
                  />
                ))}
                {timed.map((b) => {
                  const style = getTimeCategoryStyle(b.category);
                  const top = (b.startMinutes! / 60) * HOUR_PX;
                  const height = Math.max((b.durationMinutes / 60) * HOUR_PX, 16);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      draggable={!b.locked}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", b.id)}
                      onClick={() => onSelectBlock(b)}
                      className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-left text-[10px] leading-tight overflow-hidden ${style.block} ${b.locked ? "cursor-not-allowed" : "cursor-grab hover-elevate"}`}
                      style={{ top: `${top}px`, height: `${height}px` }}
                      title={`${b.title} • ${minutesToHHMM(b.startMinutes!)}–${minutesToHHMM(b.startMinutes! + b.durationMinutes)}`}
                      data-testid={`block-${b.id}`}
                    >
                      <span className="flex items-center gap-0.5 font-medium truncate">
                        {b.locked && <Lock className="h-2.5 w-2.5 shrink-0" />}
                        {b.title}
                      </span>
                      {height > 26 && (
                        <span className="block opacity-80">{minutesToHHMM(b.startMinutes!)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {untimed.length > 0 && (
                <div className="space-y-1 p-1 border-t border-border">
                  {untimed.map((b) => {
                    const style = getTimeCategoryStyle(b.category);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        draggable={!b.locked}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", b.id)}
                        onClick={() => onSelectBlock(b)}
                        className={`w-full rounded px-1 py-0.5 text-left text-[10px] ${style.block} ${b.locked ? "cursor-not-allowed" : "cursor-grab hover-elevate"}`}
                        data-testid={`block-${b.id}`}
                      >
                        <span className="flex items-center gap-0.5 truncate">
                          {b.locked && <Lock className="h-2.5 w-2.5 shrink-0" />}
                          {b.title} ({formatHours(b.durationMinutes)})
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1" data-testid="legend">
      {TIME_CATEGORY_ORDER.map((key) => {
        const style = TIME_CATEGORY_STYLES[key];
        return (
          <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-sm ${style.dot}`} />
            {style.label}
          </span>
        );
      })}
    </div>
  );
}

function WarningRow({
  warning,
  onResolve,
  resolving,
}: {
  warning: WeeklyPlanWarning;
  onResolve: () => void;
  resolving: boolean;
}) {
  const style = getWarningSeverityStyle(warning.severity);
  const Icon =
    warning.severity === "error"
      ? XCircle
      : warning.severity === "warning"
        ? AlertTriangle
        : warning.severity === "ok"
          ? CheckCircle2
          : Info;
  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2 ${style.className} ${warning.resolved ? "opacity-50" : ""}`}
      data-testid={`warning-${warning.id}`}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{warning.message}</p>
        {warning.code && <p className="text-[10px] opacity-70">{warning.code}</p>}
      </div>
      {!warning.resolved && warning.severity !== "ok" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={onResolve}
          disabled={resolving}
          data-testid={`button-resolve-${warning.id}`}
        >
          <Check className="h-3 w-3" />
          Åtgärda
        </Button>
      )}
    </div>
  );
}

function BlockEditDialog({
  block,
  onClose,
  onSave,
  saving,
}: {
  block: ScheduleBlock | null;
  onClose: () => void;
  onSave: (date: string, startMinutes: number, duration: number) => void;
  saving: boolean;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [duration, setDuration] = useState("60");

  // Synka state när ett nytt block väljs.
  useEffect(() => {
    if (block) {
      setDate(block.date ?? "");
      setTime(block.startMinutes != null ? minutesToHHMM(block.startMinutes) : "08:00");
      setDuration(String(block.durationMinutes));
    }
  }, [block]);

  const open = !!block;
  const locked = block?.locked ?? false;

  const handleSave = () => {
    if (!date) return;
    const [h, m] = time.split(":").map((n) => parseInt(n, 10));
    const startMinutes = (h || 0) * 60 + (m || 0);
    const dur = Math.max(1, parseInt(duration, 10) || 0);
    onSave(date, startMinutes, dur);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-edit-block">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {locked && <Lock className="h-4 w-4" />}
            {block ? getTimeCategoryStyle(block.category).label : "Block"}
          </DialogTitle>
          <DialogDescription>
            {locked
              ? "Detta block är låst och kan inte flyttas eller ändras."
              : "Ändra dag, starttid och längd. Sparas och triggar serveromräkning."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="block-date">Dag</Label>
            <Input id="block-date" type="date" value={date} disabled={locked} onChange={(e) => setDate(e.target.value)} data-testid="input-block-date" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="block-time">Starttid</Label>
              <Input id="block-time" type="time" value={time} disabled={locked} onChange={(e) => setTime(e.target.value)} data-testid="input-block-time" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="block-duration">Längd (min)</Label>
              <Input id="block-duration" type="number" min={1} value={duration} disabled={locked} onChange={(e) => setDuration(e.target.value)} data-testid="input-block-duration" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit">Avbryt</Button>
          <Button onClick={handleSave} disabled={locked || saving || !date} data-testid="button-save-block">
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
