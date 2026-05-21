import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  ListChecks,
  Loader2,
  Package,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnomalyAlerts } from "@/components/AnomalyAlerts";
import { useAuth } from "@/hooks/use-auth";
import { isPlannerRole } from "@/lib/role-config";

interface ResourceKpi {
  resourceId: string;
  resourceName: string;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  avgTimeMinutes: number;
  plannedContainers?: number;
  completedContainers?: number;
  deviationCount?: number;
  weeklyHours?: number | null;
  efficiencyFactor?: number | null;
}

interface DailyKpis {
  date: string;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  completionRate: number;
  avgTimePerTaskMinutes: number;
  activeResources: number;
  totalDeviations?: number;
  totalContainersPlanned?: number;
  totalContainersCompleted?: number;
  resourceKpis: ResourceKpi[];
}

interface WeeklyKpis {
  weekStart: string;
  weekEnd: string;
  current: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    avgTimeMinutes: number;
  };
  previous: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    avgTimeMinutes: number;
  };
  trends: {
    tasksDelta: number;
    completionRateDelta: number;
    avgTimeDelta: number;
  };
}

interface ResourceConfig {
  id: string;
  name: string;
  weeklyHours: number | null;
  efficiencyFactor: number | null;
}

interface ZonePercents {
  lossPct: number;
  breakEvenPct: number;
  targetPct: number;
}

const DEFAULT_PCT: ZonePercents = { lossPct: 85, breakEvenPct: 90, targetPct: 100 };
const DEFAULT_STOPS_PER_HOUR = 12.5; // 40h/v → 8h/dag → 100 stopp/dag (matchar "100 kärl")
const PCT_STORAGE_KEY = "traivo_unit_manager_zone_pct";
const STOPS_PER_HOUR_KEY = "traivo_unit_manager_stops_per_hour";

function loadStoredPct(): ZonePercents {
  try {
    const raw = localStorage.getItem(PCT_STORAGE_KEY);
    if (!raw) return DEFAULT_PCT;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.lossPct === "number" &&
      typeof parsed?.breakEvenPct === "number" &&
      typeof parsed?.targetPct === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_PCT;
}

function loadStoredStopsPerHour(): number {
  try {
    const raw = localStorage.getItem(STOPS_PER_HOUR_KEY);
    if (!raw) return DEFAULT_STOPS_PER_HOUR;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // ignore
  }
  return DEFAULT_STOPS_PER_HOUR;
}

function persistPct(pct: ZonePercents) {
  try {
    localStorage.setItem(PCT_STORAGE_KEY, JSON.stringify(pct));
  } catch {
    // ignore
  }
}

function persistStopsPerHour(n: number) {
  try {
    localStorage.setItem(STOPS_PER_HOUR_KEY, String(n));
  } catch {
    // ignore
  }
}

interface ResourceTarget {
  dailyTarget: number;
  lossThreshold: number;
  breakEvenThreshold: number;
  targetThreshold: number;
}

function computeResourceTarget(
  weeklyHours: number | null | undefined,
  efficiencyFactor: number | null | undefined,
  stopsPerHour: number,
  pct: ZonePercents,
): ResourceTarget {
  const hours = weeklyHours && weeklyHours > 0 ? weeklyHours : 40;
  const eff = efficiencyFactor && efficiencyFactor > 0 ? efficiencyFactor : 1.0;
  const dailyTarget = Math.max(1, Math.round((hours / 5) * stopsPerHour * eff));
  return {
    dailyTarget,
    lossThreshold: Math.round((pct.lossPct / 100) * dailyTarget),
    breakEvenThreshold: Math.round((pct.breakEvenPct / 100) * dailyTarget),
    targetThreshold: Math.round((pct.targetPct / 100) * dailyTarget),
  };
}

type ZoneKind = "loss" | "warning" | "breakEven" | "profit";

function classifyZone(value: number, t: ResourceTarget): ZoneKind {
  if (value < t.lossThreshold) return "loss";
  if (value < t.breakEvenThreshold) return "warning";
  if (value < t.targetThreshold) return "breakEven";
  return "profit";
}

function zoneLabel(zone: ZoneKind): string {
  switch (zone) {
    case "loss":
      return "Förlust";
    case "warning":
      return "Under break-even";
    case "breakEven":
      return "Break-even";
    case "profit":
      return "Vinst";
  }
}

function zoneBarClass(zone: ZoneKind): string {
  switch (zone) {
    case "loss":
      return "hsl(var(--destructive))";
    case "warning":
      return "hsl(var(--warning))";
    case "breakEven":
      return "hsl(var(--chart-4))";
    case "profit":
      return "hsl(var(--chart-2))";
  }
}

function zoneBadgeVariant(
  zone: ZoneKind,
): { variant: "destructive" | "secondary" | "default" | "outline"; className?: string } {
  switch (zone) {
    case "loss":
      return { variant: "destructive" };
    case "warning":
      return {
        variant: "outline",
        className: "border-warning/50 bg-warning/15 text-warning-foreground",
      };
    case "breakEven":
      return { variant: "secondary" };
    case "profit":
      return { variant: "default", className: "bg-chart-2 text-white" };
  }
}

function deltaColor(delta: number): string {
  if (delta > 0) return "text-chart-2";
  if (delta < 0) return "text-destructive";
  return "text-muted-foreground";
}

interface PlanningParameter {
  id: string;
  customerId?: string | null;
  objectId?: string | null;
  slaLevel?: string | null;
  maxDaysToComplete?: number | null;
}

export default function UnitManagerPage() {
  const { user } = useAuth();
  const role = (user as any)?.role as string | undefined;
  const today = useMemo(() => new Date(), []);
  const dateStr = format(today, "yyyy-MM-dd");

  const [pct, setPct] = useState<ZonePercents>(() => loadStoredPct());
  const [stopsPerHour, setStopsPerHour] = useState<number>(() => loadStoredStopsPerHour());

  const updatePct = (field: keyof ZonePercents, value: number) => {
    const next = { ...pct, [field]: value };
    setPct(next);
    persistPct(next);
  };

  const updateStopsPerHour = (value: number) => {
    setStopsPerHour(value);
    persistStopsPerHour(value);
  };

  const { data: daily, isLoading: dailyLoading } = useQuery<DailyKpis>({
    queryKey: [`/api/kpis/daily?date=${dateStr}`],
    staleTime: 30_000,
  });

  const { data: weekly, isLoading: weeklyLoading } = useQuery<WeeklyKpis>({
    queryKey: ["/api/kpis/weekly"],
    staleTime: 60_000,
  });

  const { data: planningParams } = useQuery<PlanningParameter[]>({
    queryKey: ["/api/planning-parameters"],
    staleTime: 5 * 60_000,
  });

  const { data: resources } = useQuery<ResourceConfig[]>({
    queryKey: ["/api/resources"],
    staleTime: 5 * 60_000,
  });

  const resourceConfigById = useMemo(() => {
    const map = new Map<string, ResourceConfig>();
    (resources ?? []).forEach((r) => map.set(r.id, r));
    return map;
  }, [resources]);

  const resourceKpis = useMemo<ResourceKpi[]>(() => {
    const list = daily?.resourceKpis ?? [];
    return [...list]
      .filter((r) => r.totalTasks > 0)
      .sort((a, b) => b.totalTasks - a.totalTasks);
  }, [daily]);

  const targetByResource = useMemo(() => {
    const map = new Map<string, ResourceTarget>();
    for (const r of resourceKpis) {
      const cfg = resourceConfigById.get(r.resourceId);
      // Föredra resurs-konfig (DB) → faller tillbaka på inlämnad weeklyHours
      // från KPI-svaret (också från DB) → sista utvägen: defaults.
      const hours = cfg?.weeklyHours ?? r.weeklyHours ?? null;
      const eff = cfg?.efficiencyFactor ?? r.efficiencyFactor ?? null;
      map.set(r.resourceId, computeResourceTarget(hours, eff, stopsPerHour, pct));
    }
    return map;
  }, [resourceKpis, resourceConfigById, stopsPerHour, pct]);

  const breakEvenData = useMemo(
    () =>
      resourceKpis.map((r) => {
        const t = targetByResource.get(r.resourceId)!;
        return {
          resourceId: r.resourceId,
          name: r.resourceName,
          completed: r.completedTasks,
          planned: r.totalTasks,
          dailyTarget: t.dailyTarget,
          loss: t.lossThreshold,
          breakEven: t.breakEvenThreshold,
          target: t.targetThreshold,
          pctOfTarget:
            t.dailyTarget > 0
              ? Math.round((r.completedTasks / t.dailyTarget) * 100)
              : 0,
        };
      }),
    [resourceKpis, targetByResource],
  );

  const isPlanner = isPlannerRole(role);

  if (!isPlanner) {
    return (
      <div className="container mx-auto py-10">
        <Card>
          <CardHeader>
            <CardTitle>Enhetsansvarig-vy</CardTitle>
            <CardDescription>
              Den här vyn är begränsad till roller med planeringsansvar
              (ägare, admin, planerare).
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-4 sm:px-6 space-y-6" data-testid="page-unit-manager">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Gauge className="h-6 w-6 text-primary" />
            Enhetsansvarig
          </h1>
          <p className="text-sm text-muted-foreground">
            Dagsproduktion, break-even och avvikelser på ett ställe —{" "}
            {format(today, "EEEE d MMMM yyyy", { locale: sv })}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/control-tower">
            <Button variant="outline" size="sm" data-testid="link-control-tower">
              <Activity className="h-4 w-4 mr-2" />
              Kontrollpanel
            </Button>
          </Link>
          <Link href="/planner">
            <Button variant="outline" size="sm" data-testid="link-planner">
              <ClipboardList className="h-4 w-4 mr-2" />
              Veckoplanering
            </Button>
          </Link>
        </div>
      </header>

      <ProductionGoalsPanel
        loading={dailyLoading}
        resourceKpis={resourceKpis}
        targetByResource={targetByResource}
      />

      <BreakEvenPanel
        loading={dailyLoading}
        data={breakEvenData}
        pct={pct}
        onPctChange={updatePct}
        stopsPerHour={stopsPerHour}
        onStopsPerHourChange={updateStopsPerHour}
        planningParamCount={planningParams?.length ?? 0}
        resourceConfigsKnown={(resources?.length ?? 0) > 0}
      />

      <WeeklyBreakEvenPanel
        loading={weeklyLoading}
        weekly={weekly}
        resources={resources ?? []}
        stopsPerHour={stopsPerHour}
        pct={pct}
      />

      <PlanVsOutcomePanel
        loading={dailyLoading || weeklyLoading}
        resourceKpis={resourceKpis}
        weekly={weekly}
        targetByResource={targetByResource}
      />

      <AnomalyProcessPanel />
    </div>
  );
}

function ProductionGoalsPanel({
  loading,
  resourceKpis,
  targetByResource,
}: {
  loading: boolean;
  resourceKpis: ResourceKpi[];
  targetByResource: Map<string, ResourceTarget>;
}) {
  if (loading) {
    return (
      <Card data-testid="card-production-goals-loading">
        <CardHeader>
          <Skeleton className="h-6 w-64" />
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (resourceKpis.length === 0) {
    return (
      <Card data-testid="card-production-goals-empty">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Dagens produktion mot mål
          </CardTitle>
          <CardDescription>Inga resurser har planerade jobb idag.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="card-production-goals">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Dagens produktion mot mål
            </CardTitle>
            <CardDescription>
              Per resurs. Dagsmål härleds från resursens veckotimmar (DB) ×
              stopp/timme. Tröskelzoner från konfigurerade procentnivåer.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resourceKpis.map((r) => {
            const t = targetByResource.get(r.resourceId)!;
            const stopsProgress = Math.min(
              100,
              Math.round((r.completedTasks / t.dailyTarget) * 100),
            );
            const zone = classifyZone(r.completedTasks, t);
            const planPct =
              r.totalTasks > 0
                ? Math.round((r.completedTasks / r.totalTasks) * 100)
                : 0;
            return (
              <div
                key={r.resourceId}
                className="rounded-lg border bg-card p-4 space-y-3"
                data-testid={`resource-goal-${r.resourceId}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{r.resourceName}</p>
                  {(() => {
                    const b = zoneBadgeVariant(zone);
                    return (
                      <Badge
                        variant={b.variant}
                        className={b.className}
                        data-testid={`badge-zone-${r.resourceId}`}
                      >
                        {zoneLabel(zone)}
                      </Badge>
                    );
                  })()}
                </div>
                <div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Stopp idag</span>
                    <span className="font-semibold">
                      {r.completedTasks}
                      <span className="text-muted-foreground"> / {t.dailyTarget}</span>
                    </span>
                  </div>
                  <Progress value={stopsProgress} className="h-2 mt-1.5" />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Plan: {r.completedTasks}/{r.totalTasks} ({planPct}%)
                  </span>
                  <span>Snittid: {r.avgTimeMinutes} min</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    Tröskel: {t.lossThreshold}/{t.breakEvenThreshold}/{t.targetThreshold}
                  </span>
                  {typeof r.deviationCount === "number" && r.deviationCount > 0 && (
                    <span className="text-warning-foreground">
                      {r.deviationCount} avvikelse{r.deviationCount === 1 ? "" : "r"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface BreakEvenDatum {
  resourceId: string;
  name: string;
  completed: number;
  planned: number;
  dailyTarget: number;
  loss: number;
  breakEven: number;
  target: number;
  pctOfTarget: number;
}

function BreakEvenPanel({
  loading,
  data,
  pct,
  onPctChange,
  stopsPerHour,
  onStopsPerHourChange,
  planningParamCount,
  resourceConfigsKnown,
}: {
  loading: boolean;
  data: BreakEvenDatum[];
  pct: ZonePercents;
  onPctChange: (field: keyof ZonePercents, value: number) => void;
  stopsPerHour: number;
  onStopsPerHourChange: (value: number) => void;
  planningParamCount: number;
  resourceConfigsKnown: boolean;
}) {
  const totals = useMemo(() => {
    const completed = data.reduce((s, d) => s + d.completed, 0);
    const planned = data.reduce((s, d) => s + d.planned, 0);
    const breakEvenTotal = data.reduce((s, d) => s + d.breakEven, 0);
    const targetTotal = data.reduce((s, d) => s + d.target, 0);
    return { completed, planned, breakEvenTotal, targetTotal };
  }, [data]);

  return (
    <Card data-testid="card-break-even">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-chart-2" />
              Break-even per resurs
            </CardTitle>
            <CardDescription>
              Tröskelzoner: {pct.lossPct}% = förlust · {pct.breakEvenPct}% = nollresultat ·
              {" "}{pct.targetPct}%+ = vinst. Per-resurs-mål härleds från
              {" "}<span className="font-medium">resources.weeklyHours</span> (DB) ×
              {" "}stopp/timme.
              {!resourceConfigsKnown && " Resurskonfiguration ej laddad — använder defaultvärden tills /api/resources svarar."}
              {planningParamCount > 0
                ? ` ${planningParamCount} planeringsparametrar finns för objekt-specifika undantag.`
                : ""}
            </CardDescription>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div>
              <Label htmlFor="stops-per-hour" className="text-xs">
                Stopp/timme
              </Label>
              <Input
                id="stops-per-hour"
                type="number"
                step="0.5"
                value={stopsPerHour}
                onChange={(e) => onStopsPerHourChange(Number(e.target.value) || 0)}
                className="h-8 w-20"
                data-testid="input-stops-per-hour"
              />
            </div>
            <div>
              <Label htmlFor="zone-loss" className="text-xs">
                Förlust %
              </Label>
              <Input
                id="zone-loss"
                type="number"
                value={pct.lossPct}
                onChange={(e) => onPctChange("lossPct", Number(e.target.value) || 0)}
                className="h-8 w-20"
                data-testid="input-zone-loss"
              />
            </div>
            <div>
              <Label htmlFor="zone-break" className="text-xs">
                Break-even %
              </Label>
              <Input
                id="zone-break"
                type="number"
                value={pct.breakEvenPct}
                onChange={(e) => onPctChange("breakEvenPct", Number(e.target.value) || 0)}
                className="h-8 w-20"
                data-testid="input-zone-break"
              />
            </div>
            <div>
              <Label htmlFor="zone-target" className="text-xs">
                Mål %
              </Label>
              <Input
                id="zone-target"
                type="number"
                value={pct.targetPct}
                onChange={(e) => onPctChange("targetPct", Number(e.target.value) || 0)}
                className="h-8 w-20"
                data-testid="input-zone-target"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : data.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Ingen produktion registrerad idag — break-even-kurvan visas när resurser börjar rapportera stopp.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number, key: string, item: any) => {
                      const d = item?.payload as BreakEvenDatum | undefined;
                      if (key === "completed") {
                        return [
                          `${value} stopp (${d?.pctOfTarget ?? 0}% av mål ${d?.dailyTarget ?? "?"})`,
                          "Utfört",
                        ];
                      }
                      return [`${value} stopp`, "Planerat"];
                    }}
                  />
                  <Bar dataKey="target" fill="hsl(var(--chart-2) / 0.15)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="completed" radius={[4, 4, 0, 0]}>
                    {data.map((d, i) => {
                      const t: ResourceTarget = {
                        dailyTarget: d.dailyTarget,
                        lossThreshold: d.loss,
                        breakEvenThreshold: d.breakEven,
                        targetThreshold: d.target,
                      };
                      return <Cell key={i} fill={zoneBarClass(classifyZone(d.completed, t))} />;
                    })}
                  </Bar>
                  <ReferenceLine
                    y={
                      data.length > 0
                        ? Math.round(data.reduce((s, d) => s + d.loss, 0) / data.length)
                        : 0
                    }
                    stroke="hsl(var(--destructive))"
                    strokeDasharray="4 4"
                    label={{ value: `Snitt förlust ${pct.lossPct}%`, fontSize: 11, fill: "hsl(var(--destructive))", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={
                      data.length > 0
                        ? Math.round(data.reduce((s, d) => s + d.breakEven, 0) / data.length)
                        : 0
                    }
                    stroke="hsl(var(--warning))"
                    strokeDasharray="4 4"
                    label={{ value: `Snitt break-even ${pct.breakEvenPct}%`, fontSize: 11, fill: "hsl(var(--warning))", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={
                      data.length > 0
                        ? Math.round(data.reduce((s, d) => s + d.target, 0) / data.length)
                        : 0
                    }
                    stroke="hsl(var(--chart-2))"
                    strokeDasharray="4 4"
                    label={{ value: `Snitt mål ${pct.targetPct}%`, fontSize: 11, fill: "hsl(var(--chart-2))", position: "insideTopLeft" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md border p-3" data-testid="stat-total-completed">
                <p className="text-xs text-muted-foreground">Utfört totalt</p>
                <p className="text-xl font-semibold">{totals.completed}</p>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-total-planned">
                <p className="text-xs text-muted-foreground">Planerat totalt</p>
                <p className="text-xl font-semibold">{totals.planned}</p>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-break-even-total">
                <p className="text-xs text-muted-foreground">
                  Break-even-summa ({data.length} resurser)
                </p>
                <p className="text-xl font-semibold">{totals.breakEvenTotal}</p>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-target-total">
                <p className="text-xs text-muted-foreground">Målsumma idag</p>
                <p className="text-xl font-semibold">{totals.targetTotal}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklyBreakEvenPanel({
  loading,
  weekly,
  resources,
  stopsPerHour,
  pct,
}: {
  loading: boolean;
  weekly: WeeklyKpis | undefined;
  resources: ResourceConfig[];
  stopsPerHour: number;
  pct: ZonePercents;
}) {
  const aggregate = useMemo(() => {
    let weeklyBreakEven = 0;
    let weeklyTarget = 0;
    for (const r of resources) {
      const t = computeResourceTarget(r.weeklyHours, r.efficiencyFactor, stopsPerHour, pct);
      weeklyBreakEven += t.breakEvenThreshold * 5;
      weeklyTarget += t.dailyTarget * 5;
    }
    return { weeklyBreakEven, weeklyTarget };
  }, [resources, stopsPerHour, pct]);

  const completed = weekly?.current.completedTasks ?? 0;
  const pctOfBreakEven = aggregate.weeklyBreakEven > 0
    ? Math.round((completed / aggregate.weeklyBreakEven) * 100)
    : 0;
  const pctOfTarget = aggregate.weeklyTarget > 0
    ? Math.round((completed / aggregate.weeklyTarget) * 100)
    : 0;

  const zoneKind: ZoneKind = (() => {
    if (aggregate.weeklyBreakEven <= 0) return "warning";
    if (completed < aggregate.weeklyBreakEven * (pct.lossPct / pct.breakEvenPct)) return "loss";
    if (completed < aggregate.weeklyBreakEven) return "warning";
    if (completed < aggregate.weeklyTarget) return "breakEven";
    return "profit";
  })();
  const badge = zoneBadgeVariant(zoneKind);

  return (
    <Card data-testid="card-weekly-break-even">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-chart-2" />
          Veckans break-even
        </CardTitle>
        <CardDescription>
          Aggregat över hela enheten. Vecko-break-even = summa(break-even-tröskel × 5) per resurs. Veckomål = summa(dagsmål × 5).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-4 items-start">
            <div className="rounded-md border p-3" data-testid="stat-weekly-completed">
              <p className="text-xs text-muted-foreground">Utfört (denna vecka)</p>
              <p className="text-2xl font-semibold">{completed}</p>
              <Badge
                variant={badge.variant}
                className={`mt-1 ${badge.className ?? ""}`}
                data-testid="badge-weekly-zone"
              >
                {zoneLabel(zoneKind)}
              </Badge>
            </div>
            <div className="rounded-md border p-3" data-testid="stat-weekly-break-even">
              <p className="text-xs text-muted-foreground">Break-even (vecka)</p>
              <p className="text-2xl font-semibold">{aggregate.weeklyBreakEven}</p>
              <p className="text-xs text-muted-foreground mt-1">{pctOfBreakEven}% uppnått</p>
            </div>
            <div className="rounded-md border p-3" data-testid="stat-weekly-target">
              <p className="text-xs text-muted-foreground">Mål (vecka)</p>
              <p className="text-2xl font-semibold">{aggregate.weeklyTarget}</p>
              <p className="text-xs text-muted-foreground mt-1">{pctOfTarget}% uppnått</p>
            </div>
            <div className="rounded-md border p-3" data-testid="stat-weekly-progress">
              <p className="text-xs text-muted-foreground">Veckoprogress mot break-even</p>
              <Progress value={Math.min(100, pctOfBreakEven)} className="h-2 mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {Math.max(0, aggregate.weeklyBreakEven - completed)} stopp kvar
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanVsOutcomePanel({
  loading,
  resourceKpis,
  weekly,
  targetByResource,
}: {
  loading: boolean;
  resourceKpis: ResourceKpi[];
  weekly: WeeklyKpis | undefined;
  targetByResource: Map<string, ResourceTarget>;
}) {
  return (
    <Card data-testid="card-plan-vs-outcome">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-chart-1" />
          Plan vs utfall
        </CardTitle>
        <CardDescription>
          Per resurs idag — stopp, kärl och avvikelser — samt veckotrend mot föregående vecka.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <Skeleton className="h-44 w-full" />
        ) : resourceKpis.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ingen planering idag — inga rader att jämföra.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resurs</TableHead>
                  <TableHead className="text-right">Stopp plan</TableHead>
                  <TableHead className="text-right">Stopp utfört</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead className="text-right">Mot mål</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      Kärl plan
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Kärl utfört</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Avvikelser
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Snittid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resourceKpis.map((r) => {
                  const t = targetByResource.get(r.resourceId)!;
                  const diff = r.completedTasks - r.totalTasks;
                  const goalDiff = r.completedTasks - t.dailyTarget;
                  return (
                    <TableRow key={r.resourceId} data-testid={`row-plan-vs-outcome-${r.resourceId}`}>
                      <TableCell className="font-medium">{r.resourceName}</TableCell>
                      <TableCell className="text-right">{r.totalTasks}</TableCell>
                      <TableCell className="text-right">{r.completedTasks}</TableCell>
                      <TableCell className={`text-right font-medium ${deltaColor(diff)}`}>
                        {diff > 0 ? `+${diff}` : diff}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${deltaColor(goalDiff)}`}>
                        {goalDiff > 0 ? `+${goalDiff}` : goalDiff}
                      </TableCell>
                      <TableCell className="text-right">{r.plannedContainers ?? 0}</TableCell>
                      <TableCell className="text-right">{r.completedContainers ?? 0}</TableCell>
                      <TableCell className="text-right">
                        {r.deviationCount && r.deviationCount > 0 ? (
                          <span className="text-warning-foreground font-medium">
                            {r.deviationCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{r.avgTimeMinutes} min</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {weekly && (
          <div className="grid gap-3 sm:grid-cols-3" data-testid="weekly-trend">
            <WeeklyTrendCard
              title="Totala uppdrag (vecka)"
              current={weekly.current.totalTasks}
              delta={weekly.trends.tasksDelta}
              suffix=""
            />
            <WeeklyTrendCard
              title="Genomförandegrad"
              current={weekly.current.completionRate}
              delta={weekly.trends.completionRateDelta}
              suffix="%"
            />
            <WeeklyTrendCard
              title="Snittid per stopp"
              current={weekly.current.avgTimeMinutes}
              delta={weekly.trends.avgTimeDelta}
              suffix=" min"
              invertColor
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklyTrendCard({
  title,
  current,
  delta,
  suffix,
  invertColor = false,
}: {
  title: string;
  current: number;
  delta: number;
  suffix: string;
  invertColor?: boolean;
}) {
  const effectiveDelta = invertColor ? -delta : delta;
  const color = deltaColor(effectiveDelta);
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Activity;
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold mt-1">
        {current}
        <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
      </p>
      <p className={`text-xs mt-1 flex items-center gap-1 ${color}`}>
        <Icon className="h-3 w-3" />
        {delta > 0 ? `+${delta}` : delta}
        {suffix} mot föregående vecka
      </p>
    </div>
  );
}

const ANOMALY_STEPS = [
  {
    key: "identify",
    label: "Identifiera",
    icon: Search,
    description: "Anomaly-monitor flaggar ställtider, kostnader och omöjliga ordrar automatiskt.",
  },
  {
    key: "analyze",
    label: "Analysera",
    icon: Sparkles,
    description: "Expandera en avvikelse för AI-förklaring av troliga orsaker.",
  },
  {
    key: "prioritize",
    label: "Prioritera",
    icon: AlertTriangle,
    description: "Hög allvarsgrad och förseningar > 2h hanteras först.",
  },
  {
    key: "act",
    label: "Åtgärda",
    icon: Wrench,
    description: "Öppna ordern, justera planeringen eller skicka tekniker för åtgärd.",
  },
] as const;

function AnomalyProcessPanel() {
  const { data: liveCheck, isLoading } = useQuery<{
    timestamp: string;
    alertCount: number;
  }>({
    queryKey: ["/api/system/anomalies/check"],
    staleTime: 60_000,
    retry: false,
  });

  return (
    <Card data-testid="card-anomaly-process">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Avvikelseprocess
            </CardTitle>
            <CardDescription>
              Fyra steg: identifiera, analysera, prioritera, åtgärda.
              {liveCheck
                ? ` ${liveCheck.alertCount} öppna avvikelser från senaste körning.`
                : ""}
            </CardDescription>
          </div>
          <Link href="/setup-analysis">
            <Button variant="ghost" size="sm" data-testid="link-setup-analysis">
              Detaljanalys
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ANOMALY_STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <li
                key={step.key}
                className="rounded-md border bg-muted/30 p-3"
                data-testid={`anomaly-step-${step.key}`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold">
                    {idx + 1}
                  </span>
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">{step.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {step.description}
                </p>
              </li>
            );
          })}
        </ol>

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Hämtar senaste avvikelser…
          </div>
        )}

        <AnomalyAlerts />

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-chart-2" />
          När en avvikelse är åtgärdad markeras den som klar i källordern — listan uppdateras automatiskt.
          <Link href="/control-tower" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
            Heatmap <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
