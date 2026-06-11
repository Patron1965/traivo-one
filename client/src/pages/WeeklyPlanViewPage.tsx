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
  Home,
  Plus,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Check,
  Briefcase,
  Car,
  Utensils,
  Clock,
  Gauge,
  TrendingUp,
  Banknote,
  Package,
  Receipt,
  Percent,
  Timer,
  Route,
  Leaf,
  Map as MapIcon,
  Navigation,
  ExternalLink,
  Pencil,
  Save,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronUp,
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
import { useLocation } from "wouter";
import { RouteDayMap, type RouteMapJob, type RouteMapCommute } from "@/components/ui/map";
import {
  UnplannedPanel,
  CANDIDATE_DND_KEY,
  type WeeklyPlanCandidate,
} from "@/components/weeklyplan/UnplannedPanel";

const WEEK_TOTAL_MINUTES = 168 * 60;
const HOUR_PX = 28;

type IconType = typeof MapPin;

/** Ikon per tidskategori — används i tidsblock. */
const CATEGORY_ICON: Record<string, IconType> = {
  production: Briefcase,
  travel_between_jobs: Car,
  travel_commute: Car,
  break_meal: Utensils,
  personal_time: Clock,
  rest_night: Moon,
  rest_weekend: Home,
  overtime: AlertTriangle,
};

interface Team {
  id: string;
  name: string;
  color: string | null;
}

/** Work-order-uppgift berikad av detalj-endpointen (namn, värde, plats). */
interface EnrichedTask extends WeeklyPlanTask {
  name: string | null;
  value: number; // öre
  lat: number | null;
  lng: number | null;
  objectId: string | null;
  locationName: string | null;
}

interface WeeklyPlanDetail extends WeeklyPlan {
  tasks: EnrichedTask[];
  personalTasks: PersonalTask[];
  travelEntries: TravelTimeEntry[];
  warnings: WeeklyPlanWarning[];
  taskCount: number;
  objectCount: number;
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

/** Svenskt tal med komma som decimaltecken och blanksteg som tusentalsavgränsare. */
function svDecimal(n: number | null | undefined, digits = 2): string {
  return (n ?? 0).toLocaleString("sv-SE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Timmar med svenskt decimaltecken, t.ex. "22,00 h". */
function formatHoursDec(minutes: number | null | undefined, digits = 2): string {
  return `${svDecimal((minutes ?? 0) / 60, digits)} h`;
}

function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null) return "–";
  const pct = ratio * 100;
  const digits = Number.isInteger(pct) ? 0 : 1;
  return `${svDecimal(pct, digits)} %`;
}

/** "08:00 – 12:00" för ett block med känd starttid. */
function blockTimeRange(b: ScheduleBlock): string | null {
  if (b.startMinutes == null) return null;
  return `${minutesToHHMM(b.startMinutes)} – ${minutesToHHMM(b.startMinutes + b.durationMinutes)}`;
}

// ---------------------------------------------------------------------------
// Normalisering av plan-block
// ---------------------------------------------------------------------------

function taskToBlock(t: EnrichedTask): ScheduleBlock {
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
    title: t.name?.trim() || t.notes?.trim() || "Produktion",
    date,
    startMinutes,
    durationMinutes: duration || 60,
    locked: Boolean(t.locked),
    locationName: t.locationName ?? null,
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
  const initialTeamId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("teamId") ?? "";
  }, []);
  const [teamId, setTeamId] = useState<string>(initialTeamId);
  const [year, setYear] = useState<number>(getISOWeekYear(now));
  const [week, setWeek] = useState<number>(getISOWeek(now));
  const [editing, setEditing] = useState<ScheduleBlock | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [egentidId, setEgentidId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [, setLocation] = useLocation();

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

  const candidatesKey = planId ? `/api/weekly-plans/${planId}/candidates` : "";
  const { data: candidates = [], isLoading: candidatesLoading } = useQuery<WeeklyPlanCandidate[]>({
    queryKey: [candidatesKey],
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
    if (candidatesKey) queryClient.invalidateQueries({ queryKey: [candidatesKey] });
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

  const addCandidates = useMutation({
    mutationFn: async (vars: { ids: string[]; date: string }) => {
      let added = 0;
      let firstError: string | null = null;
      for (const taskId of vars.ids) {
        try {
          await apiRequest("POST", `/api/weekly-plans/${planId}/tasks`, {
            taskId,
            teamId: effectiveTeamId,
            plannedDate: vars.date,
          });
          added++;
        } catch (err) {
          if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        }
      }
      return { added, total: vars.ids.length, firstError };
    },
    onSuccess: (res) => {
      if (res.added === 0) {
        toast({
          title: "Kunde inte lägga till jobb",
          description: res.firstError ?? undefined,
          variant: "destructive",
        });
        return;
      }
      if (res.added < res.total) {
        toast({
          title: `${res.added} av ${res.total} jobb tillagda`,
          description: res.firstError ?? "Vissa jobb kunde inte läggas till.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: res.total > 1 ? `${res.total} jobb tillagda i planen` : "Jobb tillagt i planen" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte lägga till jobb", description: e.message, variant: "destructive" }),
    // Refresh both plan and candidate lists regardless of partial failure so the
    // panel never shows already-added jobs as still unplanned.
    onSettled: () => invalidatePlan(),
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
    // Ny kandidat från "Ej planerade" — har egen payload-nyckel.
    const candidateRaw = e.dataTransfer.getData(CANDIDATE_DND_KEY);
    if (candidateRaw) {
      try {
        const parsed = JSON.parse(candidateRaw) as { id?: string };
        if (parsed?.id) addCandidates.mutate({ ids: [parsed.id], date });
      } catch {
        /* ogiltig payload — ignorera */
      }
      return;
    }
    // Annars: flytt av befintligt block.
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
  const lastCalculatedAt: string | null = (plan?.metadata as Record<string, any> | null)?.lastCalculatedAt ?? null;

  const effectiveTeam = teams.find((t) => t.id === effectiveTeamId);
  const teamName = effectiveTeam?.name ?? "Team";

  const restNight = plan?.personalTasks?.find((p) => p.timeCategory === "rest_night");
  const restWeekend = plan?.personalTasks?.find((p) => p.timeCategory === "rest_weekend");

  const activeWarnings = (plan?.warnings ?? []).filter((w) => !w.resolved);
  const selectedDayLabel = selectedDay
    ? format(new Date(`${selectedDay}T00:00:00`), "EEEE d MMM", { locale: sv })
    : null;

  // Serverberäknade nyckeltal — använd berikat antal från detalj-endpointen.
  const taskCount = plan?.taskCount ?? plan?.tasks?.length ?? 0;
  const objectCount = plan?.objectCount ?? 0;

  // Restid = restid mellan jobb + pendling (commute).
  const travelMinutes = categoryMinutes(plan, "travel_between_jobs") + categoryMinutes(plan, "travel_commute");
  const productionMinutes = plan?.totalProductionMinutes ?? 0;

  // Ordervärde-tabellens underlag (berikade uppgifter).
  const orderTasks = (plan?.tasks ?? []).filter((t) => (t.value ?? 0) > 0 || (t.name ?? "").trim().length > 0);
  const orderValueTotal = orderTasks.reduce((sum, t) => sum + (t.value ?? 0), 0);
  const orderMinutesTotal = orderTasks.reduce((sum, t) => sum + (t.productionMinutes ?? 0), 0);

  // Planerad arbetstid (rubrik). Föredra KPI-fältet, fall tillbaka på produktion.
  const plannedWorkMinutes: number =
    kpi.workedMinutes ?? (kpi.workedHours != null ? kpi.workedHours * 60 : null) ?? productionMinutes;

  const donutSegments = TIME_CATEGORY_ORDER.map((key) => ({
    key,
    minutes: categoryMinutes(plan, key),
  })).filter((s) => s.minutes > 0);
  const donutTotal = donutSegments.reduce((sum, s) => sum + s.minutes, 0);

  // --- Dagval för karta & dagsdetalj -------------------------------------
  // Förvald dag: dagens datum om det ligger i veckan, annars veckans måndag.
  useEffect(() => {
    if (dayDates.length === 0) return;
    if (selectedDay && dayDates.includes(selectedDay)) return;
    const today = localDateString(now);
    setSelectedDay(dayDates.includes(today) ? today : dayDates[0]);
  }, [dayDates, now, selectedDay]);

  // Nollställ markering/redigering när dagen byts.
  useEffect(() => {
    setSelectedBlockId(null);
    setEgentidId(null);
  }, [selectedDay]);

  // Dagens produktionsuppgifter i tidsordning (för pins & numrering).
  const dayTasks = useMemo<EnrichedTask[]>(() => {
    if (!plan || !selectedDay) return [];
    return (plan.tasks ?? [])
      .filter((t) => {
        const d = t.plannedDate ?? (t.plannedStartTime ? localDateString(t.plannedStartTime) : null);
        return d === selectedDay;
      })
      .sort((a, b) => {
        const am = a.plannedStartTime ? localMinutes(a.plannedStartTime) : (a.sequence ?? 0);
        const bm = b.plannedStartTime ? localMinutes(b.plannedStartTime) : (b.sequence ?? 0);
        return am - bm;
      });
  }, [plan, selectedDay]);

  // Uppgifter med koordinater = numrerade pins på kartan.
  const dayJobs = useMemo(
    () => dayTasks.filter((t) => t.lat != null && t.lng != null),
    [dayTasks],
  );

  const jobNumberById = useMemo(() => {
    const m = new Map<string, number>();
    dayJobs.forEach((t, i) => m.set(t.id, i + 1));
    return m;
  }, [dayJobs]);

  const taskByBlockId = useMemo(() => {
    const m = new Map<string, EnrichedTask>();
    dayTasks.forEach((t) => m.set(t.id, t));
    return m;
  }, [dayTasks]);

  const personalById = useMemo(() => {
    const m = new Map<string, PersonalTask>();
    (plan?.personalTasks ?? []).forEach((pt) => m.set(pt.id, pt));
    return m;
  }, [plan]);

  // Inställelse-/återresa-linjer med från/till-koordinater.
  const dayCommutes = useMemo(() => {
    if (!plan || !selectedDay) return [];
    return (plan.personalTasks ?? []).filter((pt) => {
      const d = pt.plannedDate ?? (pt.startAt ? localDateString(pt.startAt) : null);
      return (
        d === selectedDay &&
        pt.isCommute &&
        pt.fromLat != null &&
        pt.fromLng != null &&
        pt.toLat != null &&
        pt.toLng != null
      );
    });
  }, [plan, selectedDay]);

  // Dagens block i sekvens (tidssatta först, sedan otidsatta).
  const daySequence = useMemo(() => {
    const dayBlocks = blocks.filter((b) => b.date === selectedDay);
    const timed = dayBlocks
      .filter((b) => b.startMinutes != null)
      .sort((a, b) => a.startMinutes! - b.startMinutes!);
    const untimed = dayBlocks.filter((b) => b.startMinutes == null);
    return [...timed, ...untimed];
  }, [blocks, selectedDay]);

  const saveEgentid = useMutation({
    mutationFn: async (vars: {
      id: string;
      date: string;
      startMinutes: number;
      endMinutes: number;
      locationName: string;
      title: string;
    }) => {
      const start = toIso(vars.date, vars.startMinutes);
      const end = toIso(vars.date, vars.endMinutes);
      const duration = Math.max(1, vars.endMinutes - vars.startMinutes);
      await apiRequest("PATCH", `/api/personal-tasks/${vars.id}`, {
        startAt: start,
        endAt: end,
        durationMinutes: duration,
        locationName: vars.locationName.trim() || null,
        title: vars.title.trim() || "Egentid",
      });
    },
    onSuccess: () => {
      invalidatePlan();
      setEgentidId(null);
      toast({ title: "Egentid uppdaterad" });
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte spara egentid", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          icon={CalendarRange}
          title={`Veckoschema – ${teamName.toUpperCase()}`}
          testId="text-page-title"
        />
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
              title="Räknar om schemat: restid, nyckeltal och varningar för planerade block. Fördelar inte oplanerade jobb automatiskt."
              data-testid="button-recompute"
            >
              {recompute.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Automatisk veckoplanering
            </Button>
          )}
        </div>
      </div>

      {plan ? (
        <div className="px-4 pt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5" data-testid="text-week-range">
              <CalendarRange className="h-4 w-4 shrink-0" />
              v.{week} {year} ({format(weekStart, "d", { locale: sv })}–{format(addDays(weekStart, 6), "d MMMM", { locale: sv })})
            </span>
            <span className="flex items-center gap-1.5" data-testid="text-schema-period">
              <Clock className="h-4 w-4 shrink-0" />
              Schema period: Mån 00:00 – Sön 24:00 (168 h)
            </span>
            <span className="flex items-center gap-1.5" data-testid="text-planned-work">
              Planerad arbetstid:{" "}
              <strong className="text-foreground tabular-nums">{formatHoursDec(plannedWorkMinutes, 1)}</strong>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <PlaceCard
              icon={Moon}
              title="Nattvila"
              value={restNight?.locationName || plan.restLocation || "Ej angiven"}
              testId="card-night-rest"
            />
            <PlaceCard
              icon={Home}
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
        </div>
      ) : (
        <p className="px-4 pt-1 text-sm text-muted-foreground">
          {format(weekStart, "d MMM", { locale: sv })} – {format(addDays(weekStart, 6), "d MMM yyyy", { locale: sv })}
        </p>
      )}

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
            {/* Bilaga C: tre kolumner [Ej planerade | Kalender | Ruttoptimerad tur] */}
            <div className="flex items-stretch gap-3">
              {/* VÄNSTER — Ej planerade */}
              {leftCollapsed ? (
                <button
                  type="button"
                  onClick={() => setLeftCollapsed(false)}
                  className="shrink-0 w-9 rounded-md border border-border bg-card flex flex-col items-center gap-2 py-2 hover-elevate"
                  title="Visa Ej planerade"
                  data-testid="rail-expand-left"
                >
                  <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
                    Ej planerade{candidates.length > 0 ? ` (${candidates.length})` : ""}
                  </span>
                </button>
              ) : (
                <Card className="shrink-0 w-72 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-2 py-1 border-b border-border shrink-0">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Ej planerade{candidates.length > 0 ? ` (${candidates.length})` : ""}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setLeftCollapsed(true)}
                      title="Dölj panel"
                      data-testid="rail-collapse-left"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 min-h-0">
                    <UnplannedPanel
                      candidates={candidates}
                      loading={candidatesLoading}
                      selectedDayLabel={selectedDayLabel}
                      onAddCandidates={(ids) =>
                        selectedDay && addCandidates.mutate({ ids, date: selectedDay })
                      }
                      addPending={addCandidates.isPending}
                    />
                  </div>
                </Card>
              )}

              {/* MITTEN — veckoschema 168h (växer) */}
              <Card className="flex-1 min-w-0">
                <CardContent className="pt-6">
                  <WeekCalendar
                    dayDates={dayDates}
                    blocks={blocks}
                    selectedDay={selectedDay}
                    onSelectDay={setSelectedDay}
                    onDropOnDay={handleDropOnDay}
                    onSelectBlock={(b) => setEditing(b)}
                  />
                  <Legend />
                </CardContent>
              </Card>

              {/* HÖGER — Ruttoptimerad tur (karta + dagsdetalj) */}
              {rightCollapsed ? (
                <button
                  type="button"
                  onClick={() => setRightCollapsed(false)}
                  className="shrink-0 w-9 rounded-md border border-border bg-card flex flex-col items-center gap-2 py-2 hover-elevate"
                  title="Visa karta och dagsdetalj"
                  data-testid="rail-expand-right"
                >
                  <PanelRightOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium [writing-mode:vertical-rl] whitespace-nowrap">
                    Karta &amp; rutt
                  </span>
                </button>
              ) : (
                <div className="shrink-0 w-96 flex flex-col gap-3">
                  <Card className="flex flex-col flex-1 min-h-0">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <MapIcon className="h-4 w-4" />
                          Karta – jobb &amp; rutt
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setRightCollapsed(true)}
                          title="Dölj panel"
                          data-testid="rail-collapse-right"
                        >
                          <PanelRightClose className="h-4 w-4" />
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <WeeklyRouteMap
                        jobs={dayJobs}
                        commutes={dayCommutes}
                        selectedBlockId={selectedBlockId}
                        onSelectJob={(id) => setSelectedBlockId(id)}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2" data-testid="text-day-detail-title">
                        <Briefcase className="h-4 w-4" />
                        Jobb –{" "}
                        {selectedDay
                          ? format(new Date(`${selectedDay}T00:00:00`), "EEEE d MMMM", { locale: sv })
                          : "—"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DayDetailPanel
                        selectedDay={selectedDay}
                        sequence={daySequence}
                        jobNumberById={jobNumberById}
                        taskByBlockId={taskByBlockId}
                        personalById={personalById}
                        selectedBlockId={selectedBlockId}
                        onSelectBlock={setSelectedBlockId}
                        onOpenJob={(taskId) => setLocation(`/work-orders/${taskId}`)}
                        onMoveBlock={(b) => setEditing(b)}
                        egentidId={egentidId}
                        onEditEgentid={setEgentidId}
                        onCancelEgentid={() => setEgentidId(null)}
                        onSaveEgentid={(vars) => saveEgentid.mutate(vars)}
                        saving={saveEgentid.isPending}
                      />
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>

            {/* Bottenpaneler: tidssummering, ordervärde, produktion, resor, varningar */}
            <div data-testid="section-bottom">
              <button
                type="button"
                onClick={() => setBottomCollapsed((v) => !v)}
                className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 hover-elevate"
                data-testid="toggle-bottom"
              >
                <span className="text-sm font-semibold">Summering &amp; nyckeltal</span>
                {bottomCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
              {!bottomCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-10 gap-4 mt-3">
              {/* Tidssummering (donut) */}
              <Card className="md:col-span-1 xl:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span>Tidssummering</span>
                    {within168h ? (
                      <Badge className="bg-chart-2/15 text-chart-2 border border-chart-2/30" data-testid="badge-168-ok">
                        Inom 168 h
                      </Badge>
                    ) : (
                      <Badge className="bg-destructive/15 text-destructive border border-destructive/30" data-testid="badge-168-over">
                        Över 168 h
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                  <Donut segments={donutSegments} total={donutTotal} />
                  <ul className="w-full space-y-1.5" data-testid="list-time-summary">
                    {donutSegments.map((s) => {
                      const style = getTimeCategoryStyle(s.key);
                      const pct = donutTotal > 0 ? (s.minutes / donutTotal) * 100 : 0;
                      return (
                        <li
                          key={s.key}
                          className="flex items-center justify-between gap-2 text-xs"
                          data-testid={`time-summary-${s.key}`}
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${style.dot}`} />
                            <span className="truncate">{style.label}</span>
                          </span>
                          <span className="tabular-nums shrink-0 text-muted-foreground">
                            {svDecimal(s.minutes / 60)} h · {svDecimal(pct, 0)} %
                          </span>
                        </li>
                      );
                    })}
                    <li className="flex items-center justify-between gap-2 text-xs font-semibold border-t border-border pt-1.5 mt-1.5">
                      <span>Summa</span>
                      <span className="tabular-nums" data-testid="text-time-summary-total">
                        {svDecimal(donutTotal / 60)} h · 100 %
                      </span>
                    </li>
                  </ul>
                </CardContent>
              </Card>

              {/* Ordervärde */}
              <Card className="md:col-span-1 xl:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ordervärde</CardTitle>
                </CardHeader>
                <CardContent>
                  {orderTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="empty-order-value">
                      Inga uppdrag med ordervärde.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid="table-order-value">
                        <thead>
                          <tr className="text-muted-foreground text-left">
                            <th className="font-medium pb-1.5">Uppdrag</th>
                            <th className="font-medium pb-1.5 text-right">Värde</th>
                            <th className="font-medium pb-1.5 text-right">Tid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderTasks.map((t) => (
                            <tr key={t.id} className="border-t border-border/60" data-testid={`row-order-${t.id}`}>
                              <td className="py-1.5 pr-2 min-w-0">
                                <span className="block truncate font-medium" title={t.name ?? undefined}>
                                  {t.name?.trim() || "Uppdrag"}
                                </span>
                                {t.locationName && (
                                  <span className="block truncate text-muted-foreground">{t.locationName}</span>
                                )}
                              </td>
                              <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                                {formatSekFromOre(t.value ?? 0)}
                              </td>
                              <td className="py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                                {svDecimal((t.productionMinutes ?? 0) / 60)} h
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border font-semibold">
                            <td className="pt-1.5">Totalt</td>
                            <td className="pt-1.5 text-right tabular-nums whitespace-nowrap" data-testid="text-order-value-total">
                              {formatSekFromOre(orderValueTotal)}
                            </td>
                            <td className="pt-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                              {svDecimal(orderMinutesTotal / 60)} h
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Produktion */}
              <Card className="md:col-span-1 xl:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Produktion</CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border/60">
                  <KpiRow icon={Clock} label="Producerade timmar" value={formatHoursDec(productionMinutes)} testId="kpi-produced-hours" />
                  <KpiRow icon={Gauge} label="Planeringsgrad" value={formatPercent(kpi.planningRate)} testId="kpi-planning-rate" />
                  <KpiRow icon={TrendingUp} label="Utnyttjandegrad" value={formatPercent(plan.utilizationRate ?? kpi.utilizationRate)} testId="kpi-utilization-rate" />
                  <KpiRow icon={Banknote} label="Produktivitet" value={`${formatSek(kpi.productivity ?? 0)}/h`} testId="kpi-productivity" />
                  <KpiRow icon={Briefcase} label="Antal uppdrag" value={`${svDecimal(taskCount, 0)} st`} testId="kpi-task-count" />
                  <KpiRow icon={Package} label="Antal objekt" value={`${svDecimal(objectCount, 0)} st`} testId="kpi-object-count" />
                  <KpiRow icon={Receipt} label="Debiteringsgrad" value={formatPercent(kpi.billingRate)} testId="kpi-billing-rate" />
                </CardContent>
              </Card>

              {/* Resor */}
              <Card className="md:col-span-1 xl:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Resor</CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border/60">
                  <KpiRow icon={Route} label="Total restid" value={formatHoursDec(travelMinutes)} testId="kpi-travel-total" />
                  <KpiRow icon={Percent} label="Andel restid" value={formatPercent(kpi.travelShare)} testId="kpi-travel-share" />
                  <KpiRow
                    icon={Timer}
                    label="Restid per uppdrag"
                    value={taskCount > 0 ? formatHoursDec(travelMinutes / taskCount) : "–"}
                    testId="kpi-travel-per-task"
                  />
                  <KpiRow icon={Car} label="Körda km (est.)" value={`${svDecimal(kpi.estimatedKm ?? 0, 0)} km`} testId="kpi-estimated-km" />
                  <KpiRow icon={Banknote} label="Resekostnad (est.)" value={formatSekFromOre(plan.totalTravelCost)} testId="kpi-travel-cost" />
                  <KpiRow icon={Leaf} label="CO₂-påverkan (est.)" value={`${svDecimal(kpi.estimatedCo2Kg ?? 0, 0)} kg`} testId="kpi-co2" />
                </CardContent>
              </Card>

              {/* Varningar */}
              <Card className="md:col-span-1 xl:col-span-2">
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
                </div>
              )}
            </div>

            {/* Fotnot */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
              <span data-testid="text-footer-note">
                Schemat omfattar {formatHoursDec(plannedWorkMinutes, 1)} planerad arbetstid inom veckans 168 timmar.
              </span>
              <span data-testid="text-last-calculated">
                Senast uppdaterad:{" "}
                {lastCalculatedAt ? format(new Date(lastCalculatedAt), "d MMM yyyy HH:mm", { locale: sv }) : "–"}
              </span>
            </div>
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

function categoryMinutes(plan: WeeklyPlanDetail | undefined, key: TimeCategoryKey): number {
  if (!plan) return 0;
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

function KpiRow({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: IconType;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5" data-testid={testId}>
      <span className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums shrink-0" data-testid={`${testId}-value`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Donut-diagram över veckans tidsfördelning. Segmenten ritas med
 * `currentColor` + tema-token (`style.text`) så att inga råa färger används.
 */
function Donut({
  segments,
  total,
}: {
  segments: { key: TimeCategoryKey; minutes: number }[];
  total: number;
}) {
  const size = 168;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const denom = Math.max(total, 1);
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }} data-testid="donut-time">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} stroke="currentColor" className="text-muted" />
        {segments.map((s) => {
          const style = getTimeCategoryStyle(s.key);
          const len = (s.minutes / denom) * circumference;
          const el = (
            <circle
              key={s.key}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              strokeWidth={stroke}
              stroke="currentColor"
              className={style.text}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-muted-foreground">Totalt</span>
        <span className="text-2xl font-semibold tabular-nums" data-testid="text-donut-total">
          {svDecimal(total / 60, 0)} h
        </span>
      </div>
    </div>
  );
}

function WeekCalendar({
  dayDates,
  blocks,
  selectedDay,
  onSelectDay,
  onDropOnDay,
  onSelectBlock,
}: {
  dayDates: string[];
  blocks: ScheduleBlock[];
  selectedDay: string | null;
  onSelectDay: (date: string) => void;
  onDropOnDay: (date: string, e: React.DragEvent) => void;
  onSelectBlock: (b: ScheduleBlock) => void;
}) {
  const hourMarks = Array.from({ length: 13 }, (_, i) => i * 2); // 0,2,...,24
  const HEADER_H = 64;
  const gutter = (side: "left" | "right") => (
    <div className={`w-12 shrink-0 ${side === "left" ? "" : "border-l border-border"}`}>
      <div style={{ height: `${HEADER_H}px` }} className="border-b border-border" />
      <div className="relative" style={{ height: `${24 * HOUR_PX}px` }}>
        {hourMarks.map((h) => (
          <div
            key={h}
            className="absolute left-0 right-0 text-[10px] text-muted-foreground -translate-y-1/2 text-center"
            style={{ top: `${h * HOUR_PX}px` }}
          >
            {pad2(h)}:00
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[920px]">
        {gutter("left")}

        {/* Dagkolumner */}
        {dayDates.map((date, idx) => {
          const dayDate = new Date(`${date}T00:00:00`);
          const dayBlocks = blocks.filter((b) => b.date === date);
          const timed = dayBlocks.filter((b) => b.startMinutes != null);
          const untimed = dayBlocks.filter((b) => b.startMinutes == null);
          const isWeekend = idx >= 5;
          return (
            <div
              key={date}
              className="flex-1 min-w-[116px] border-l border-border"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnDay(date, e)}
              data-testid={`day-column-${idx}`}
            >
              <button
                type="button"
                onClick={() => onSelectDay(date)}
                className={`w-full flex flex-col items-center justify-center gap-0.5 py-1.5 leading-tight border-b transition-colors hover-elevate ${
                  selectedDay === date
                    ? "border-primary bg-primary/10"
                    : `border-border ${isWeekend ? "bg-muted/40" : ""}`
                }`}
                style={{ height: `${HEADER_H}px` }}
                data-testid={`button-select-day-${idx}`}
                aria-pressed={selectedDay === date}
              >
                <span
                  className={`text-xs font-semibold uppercase tracking-wide leading-tight ${selectedDay === date ? "text-primary" : ""}`}
                  data-testid={`day-name-${idx}`}
                >
                  {format(dayDate, "EEEE", { locale: sv })}
                </span>
                <span className="text-[11px] text-muted-foreground uppercase leading-tight">
                  {format(dayDate, "d MMMM", { locale: sv })}
                </span>
                <span className="text-[10px] text-muted-foreground/70 leading-tight">(24 h)</span>
              </button>
              <div className={`relative ${isWeekend ? "bg-muted/30" : "bg-muted/10"}`} style={{ height: `${24 * HOUR_PX}px` }}>
                {hourMarks.map((h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/40"
                    style={{ top: `${h * HOUR_PX}px` }}
                  />
                ))}
                {timed.map((b) => {
                  const style = getTimeCategoryStyle(b.category);
                  const Icon = CATEGORY_ICON[b.category] ?? Briefcase;
                  const top = (b.startMinutes! / 60) * HOUR_PX;
                  const height = Math.max((b.durationMinutes / 60) * HOUR_PX, 18);
                  const range = blockTimeRange(b);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      draggable={!b.locked}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", b.id)}
                      onClick={() => onSelectBlock(b)}
                      className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-left text-[10px] leading-tight overflow-hidden ${style.block} ${b.locked ? "cursor-not-allowed" : "cursor-grab hover-elevate"}`}
                      style={{ top: `${top}px`, height: `${height}px` }}
                      title={`${b.title}${range ? ` • ${range}` : ""}${b.locationName ? ` • ${b.locationName}` : ""}`}
                      data-testid={`block-${b.id}`}
                    >
                      {height >= 42 && range && (
                        <span className="block tabular-nums opacity-80">{range}</span>
                      )}
                      <span className="flex items-center gap-1 font-medium truncate">
                        {b.locked ? <Lock className="h-3 w-3 shrink-0" /> : <Icon className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{b.title}</span>
                      </span>
                      {b.locationName && height >= 58 && (
                        <span className="flex items-center gap-1 opacity-80 truncate">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{b.locationName}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {untimed.length > 0 && (
                <div className="space-y-1 p-1 border-t border-border">
                  {untimed.map((b) => {
                    const style = getTimeCategoryStyle(b.category);
                    const Icon = CATEGORY_ICON[b.category] ?? Briefcase;
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
                        <span className="flex items-center gap-1 truncate">
                          {b.locked ? <Lock className="h-3 w-3 shrink-0" /> : <Icon className="h-3 w-3 shrink-0" />}
                          <span className="truncate">{b.title} ({formatHours(b.durationMinutes)})</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {gutter("right")}
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

// ---------------------------------------------------------------------------
// Karta – jobb & rutt
// ---------------------------------------------------------------------------

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function WeeklyRouteMap({
  jobs,
  commutes,
  selectedBlockId,
  onSelectJob,
}: {
  jobs: EnrichedTask[];
  commutes: PersonalTask[];
  selectedBlockId: string | null;
  onSelectJob: (id: string) => void;
}) {
  const mapJobs = useMemo<RouteMapJob[]>(
    () =>
      jobs.map((t) => ({
        id: t.id,
        lat: t.lat as number,
        lng: t.lng as number,
        label: t.name?.trim() || "Produktion",
        locationName: t.locationName,
        timeLabel: t.plannedStartTime ? minutesToHHMM(localMinutes(t.plannedStartTime)) : null,
      })),
    [jobs],
  );
  const mapCommutes = useMemo<RouteMapCommute[]>(
    () =>
      commutes.map((c) => ({
        id: c.id,
        positions: [
          [c.fromLat as number, c.fromLng as number],
          [c.toLat as number, c.toLng as number],
        ] as [number, number][],
      })),
    [commutes],
  );
  return (
    <RouteDayMap
      jobs={mapJobs}
      commutes={mapCommutes}
      selectedJobId={selectedBlockId}
      onSelectJob={onSelectJob}
      testId="map-weekly-route"
    />
  );
}

// ---------------------------------------------------------------------------
// Dagsdetalj – jobbsekvens + justera egentid
// ---------------------------------------------------------------------------

function DayDetailPanel({
  selectedDay,
  sequence,
  jobNumberById,
  taskByBlockId,
  personalById,
  selectedBlockId,
  onSelectBlock,
  onOpenJob,
  onMoveBlock,
  egentidId,
  onEditEgentid,
  onCancelEgentid,
  onSaveEgentid,
  saving,
}: {
  selectedDay: string | null;
  sequence: ScheduleBlock[];
  jobNumberById: Map<string, number>;
  taskByBlockId: Map<string, EnrichedTask>;
  personalById: Map<string, PersonalTask>;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onOpenJob: (taskId: string) => void;
  onMoveBlock: (b: ScheduleBlock) => void;
  egentidId: string | null;
  onEditEgentid: (id: string) => void;
  onCancelEgentid: () => void;
  onSaveEgentid: (vars: {
    id: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    locationName: string;
    title: string;
  }) => void;
  saving: boolean;
}) {
  if (!selectedDay) {
    return <p className="text-sm text-muted-foreground">Välj en dag i kalendern.</p>;
  }
  if (sequence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-day-empty">
        Inga block planerade denna dag.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sequence.map((b) => {
        const range = blockTimeRange(b);

        // Produktionsjobb
        if (b.kind === "task") {
          const num = jobNumberById.get(b.id);
          const task = taskByBlockId.get(b.id);
          const selected = selectedBlockId === b.id;
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectBlock(b.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectBlock(b.id);
                }
              }}
              className={`rounded-md border p-2.5 cursor-pointer hover-elevate ${
                selected ? "border-primary bg-primary/5" : "border-border"
              }`}
              data-testid={`job-row-${b.id}`}
            >
              <div className="flex items-start gap-2.5">
                {num != null ? (
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums"
                    data-testid={`job-number-${b.id}`}
                  >
                    {num}
                  </span>
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Briefcase className="h-3 w-3" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{b.title}</span>
                    {b.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </div>
                  {range && (
                    <div className="text-xs text-muted-foreground tabular-nums">{range}</div>
                  )}
                  {b.locationName && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{b.locationName}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={!task?.taskId}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (task?.taskId) onOpenJob(task.taskId);
                  }}
                  data-testid={`button-open-job-${b.id}`}
                >
                  <ExternalLink className="h-3 w-3" />
                  Öppna jobb
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={b.locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveBlock(b);
                  }}
                  data-testid={`button-move-job-${b.id}`}
                >
                  <Navigation className="h-3 w-3" />
                  Flytta jobb
                </Button>
              </div>
            </div>
          );
        }

        // Egentid – inline-justering
        if (b.category === "personal_time") {
          const pt = personalById.get(b.id);
          const editing = egentidId === b.id;
          return (
            <div key={b.id} className="rounded-md border border-border p-2.5" data-testid={`egentid-row-${b.id}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{b.title}</span>
                  {range && <span className="text-xs text-muted-foreground tabular-nums">{range}</span>}
                </div>
                {!editing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => onEditEgentid(b.id)}
                    data-testid={`button-edit-egentid-${b.id}`}
                  >
                    <Pencil className="h-3 w-3" />
                    Justera
                  </Button>
                )}
              </div>
              {editing && pt && (
                <EgentidEditor
                  task={pt}
                  date={selectedDay}
                  saving={saving}
                  onCancel={onCancelEgentid}
                  onSave={onSaveEgentid}
                />
              )}
            </div>
          );
        }

        // Övriga block (restid, rast, vila, övertid …)
        const Icon = CATEGORY_ICON[b.category] ?? Clock;
        return (
          <div
            key={b.id}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs text-muted-foreground"
            data-testid={`other-row-${b.id}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{b.title}</span>
            {range && <span className="ml-auto tabular-nums">{range}</span>}
          </div>
        );
      })}
    </div>
  );
}

function EgentidEditor({
  task,
  date,
  saving,
  onCancel,
  onSave,
}: {
  task: PersonalTask;
  date: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (vars: {
    id: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    locationName: string;
    title: string;
  }) => void;
}) {
  const initialStart = task.startAt ? minutesToHHMM(localMinutes(task.startAt)) : "08:00";
  const initialEnd = task.endAt
    ? minutesToHHMM(localMinutes(task.endAt))
    : minutesToHHMM(hhmmToMinutes(initialStart) + (task.durationMinutes ?? 30));
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [plats, setPlats] = useState(task.locationName ?? "");
  const [orsak, setOrsak] = useState(task.title ?? "");

  const startMinutes = hhmmToMinutes(start);
  const endMinutes = hhmmToMinutes(end);
  const invalid = endMinutes <= startMinutes;

  return (
    <div className="mt-2.5 space-y-2.5 border-t border-border pt-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Justera egentid</p>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <Label htmlFor={`egentid-start-${task.id}`} className="text-xs">
            Start
          </Label>
          <Input
            id={`egentid-start-${task.id}`}
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            data-testid={`input-egentid-start-${task.id}`}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`egentid-end-${task.id}`} className="text-xs">
            Slut
          </Label>
          <Input
            id={`egentid-end-${task.id}`}
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            data-testid={`input-egentid-end-${task.id}`}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`egentid-plats-${task.id}`} className="text-xs">
          Plats
        </Label>
        <Input
          id={`egentid-plats-${task.id}`}
          value={plats}
          onChange={(e) => setPlats(e.target.value)}
          placeholder="Valfri plats"
          data-testid={`input-egentid-plats-${task.id}`}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`egentid-orsak-${task.id}`} className="text-xs">
          Orsak
        </Label>
        <Input
          id={`egentid-orsak-${task.id}`}
          value={orsak}
          onChange={(e) => setOrsak(e.target.value)}
          placeholder="t.ex. Egen tid"
          data-testid={`input-egentid-orsak-${task.id}`}
        />
      </div>
      {invalid && <p className="text-xs text-destructive">Sluttiden måste vara efter starttiden.</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={onCancel} data-testid={`button-cancel-egentid-${task.id}`}>
          <X className="h-3 w-3" />
          Avbryt
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={saving || invalid}
          onClick={() =>
            onSave({ id: task.id, date, startMinutes, endMinutes, locationName: plats, title: orsak })
          }
          data-testid={`button-save-egentid-${task.id}`}
        >
          <Save className="h-3 w-3" />
          Spara
        </Button>
      </div>
    </div>
  );
}
