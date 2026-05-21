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
}

interface DailyKpis {
  date: string;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  completionRate: number;
  avgTimePerTaskMinutes: number;
  activeResources: number;
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

interface ZoneBreakpoints {
  loss: number;
  breakEven: number;
  target: number;
}

const DEFAULT_ZONES: ZoneBreakpoints = { loss: 85, breakEven: 90, target: 100 };
const ZONE_STORAGE_KEY = "traivo_unit_manager_zones";

function loadStoredZones(): ZoneBreakpoints {
  try {
    const raw = localStorage.getItem(ZONE_STORAGE_KEY);
    if (!raw) return DEFAULT_ZONES;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.loss === "number" &&
      typeof parsed?.breakEven === "number" &&
      typeof parsed?.target === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_ZONES;
}

function persistZones(zones: ZoneBreakpoints) {
  try {
    localStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify(zones));
  } catch {
    // ignore
  }
}

function classifyZone(value: number, zones: ZoneBreakpoints) {
  if (value < zones.loss) return "loss" as const;
  if (value < zones.breakEven) return "warning" as const;
  if (value < zones.target) return "breakEven" as const;
  return "profit" as const;
}

function zoneLabel(zone: ReturnType<typeof classifyZone>): string {
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

function zoneBarClass(zone: ReturnType<typeof classifyZone>): string {
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
  zone: ReturnType<typeof classifyZone>,
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

  const [zones, setZones] = useState<ZoneBreakpoints>(() => loadStoredZones());

  const updateZone = (field: keyof ZoneBreakpoints, value: number) => {
    const next = { ...zones, [field]: value };
    setZones(next);
    persistZones(next);
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

  const resourceKpis = useMemo<ResourceKpi[]>(() => {
    const list = daily?.resourceKpis ?? [];
    return [...list]
      .filter((r) => r.totalTasks > 0)
      .sort((a, b) => b.totalTasks - a.totalTasks);
  }, [daily]);

  const breakEvenData = useMemo(
    () =>
      resourceKpis.map((r) => ({
        name: r.resourceName,
        completed: r.completedTasks,
        planned: r.totalTasks,
      })),
    [resourceKpis],
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
        zones={zones}
      />

      <BreakEvenPanel
        loading={dailyLoading}
        data={breakEvenData}
        zones={zones}
        onZoneChange={updateZone}
        planningParamCount={planningParams?.length ?? 0}
      />

      <PlanVsOutcomePanel
        loading={dailyLoading || weeklyLoading}
        resourceKpis={resourceKpis}
        weekly={weekly}
        zones={zones}
      />

      <AnomalyProcessPanel />
    </div>
  );
}

function ProductionGoalsPanel({
  loading,
  resourceKpis,
  zones,
}: {
  loading: boolean;
  resourceKpis: ResourceKpi[];
  zones: ZoneBreakpoints;
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
              Per resurs. Mål = {zones.target} stopp, break-even = {zones.breakEven}, kritiskt = {zones.loss}.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resourceKpis.map((r) => {
            const stopsProgress =
              zones.target > 0
                ? Math.min(100, Math.round((r.completedTasks / zones.target) * 100))
                : 0;
            const zone = classifyZone(r.completedTasks, zones);
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
                      <span className="text-muted-foreground"> / {zones.target}</span>
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
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BreakEvenPanel({
  loading,
  data,
  zones,
  onZoneChange,
  planningParamCount,
}: {
  loading: boolean;
  data: { name: string; completed: number; planned: number }[];
  zones: ZoneBreakpoints;
  onZoneChange: (field: keyof ZoneBreakpoints, value: number) => void;
  planningParamCount: number;
}) {
  const totals = useMemo(() => {
    const completed = data.reduce((s, d) => s + d.completed, 0);
    const planned = data.reduce((s, d) => s + d.planned, 0);
    const breakEvenTotal = zones.breakEven * data.length;
    return { completed, planned, breakEvenTotal };
  }, [data, zones]);

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
              {zones.loss} stopp = förlust · {zones.breakEven} = nollresultat ·{" "}
              {zones.target}+ = vinst. Trösklarna sparas lokalt per användare.
              {planningParamCount > 0
                ? ` ${planningParamCount} planeringsparametrar finns för objekt-specifika undantag.`
                : ""}
            </CardDescription>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <Label htmlFor="zone-loss" className="text-xs">
                Förlust &lt;
              </Label>
              <Input
                id="zone-loss"
                type="number"
                value={zones.loss}
                onChange={(e) => onZoneChange("loss", Number(e.target.value) || 0)}
                className="h-8 w-20"
                data-testid="input-zone-loss"
              />
            </div>
            <div>
              <Label htmlFor="zone-break" className="text-xs">
                Break-even
              </Label>
              <Input
                id="zone-break"
                type="number"
                value={zones.breakEven}
                onChange={(e) =>
                  onZoneChange("breakEven", Number(e.target.value) || 0)
                }
                className="h-8 w-20"
                data-testid="input-zone-break"
              />
            </div>
            <div>
              <Label htmlFor="zone-target" className="text-xs">
                Mål
              </Label>
              <Input
                id="zone-target"
                type="number"
                value={zones.target}
                onChange={(e) =>
                  onZoneChange("target", Number(e.target.value) || 0)
                }
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
                    formatter={(value: number, key: string) =>
                      key === "completed"
                        ? [`${value} stopp`, "Utfört"]
                        : [`${value} stopp`, "Planerat"]
                    }
                  />
                  <ReferenceLine
                    y={zones.loss}
                    stroke="hsl(var(--destructive))"
                    strokeDasharray="4 4"
                    label={{ value: `Förlust ${zones.loss}`, fontSize: 11, fill: "hsl(var(--destructive))", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={zones.breakEven}
                    stroke="hsl(var(--warning))"
                    strokeDasharray="4 4"
                    label={{ value: `Break-even ${zones.breakEven}`, fontSize: 11, fill: "hsl(var(--warning))", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={zones.target}
                    stroke="hsl(var(--chart-2))"
                    strokeDasharray="4 4"
                    label={{ value: `Mål ${zones.target}`, fontSize: 11, fill: "hsl(var(--chart-2))", position: "insideTopLeft" }}
                  />
                  <Bar dataKey="completed" radius={[4, 4, 0, 0]}>
                    {data.map((d, i) => (
                      <Cell key={i} fill={zoneBarClass(classifyZone(d.completed, zones))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
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
                  Break-even ({data.length} resurser)
                </p>
                <p className="text-xl font-semibold">{totals.breakEvenTotal}</p>
              </div>
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
  zones,
}: {
  loading: boolean;
  resourceKpis: ResourceKpi[];
  weekly: WeeklyKpis | undefined;
  zones: ZoneBreakpoints;
}) {
  return (
    <Card data-testid="card-plan-vs-outcome">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-chart-1" />
          Plan vs utfall
        </CardTitle>
        <CardDescription>
          Per resurs idag, samt veckotrend mot föregående vecka.
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
                  <TableHead className="text-right">Plan</TableHead>
                  <TableHead className="text-right">Utfört</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead className="text-right">Mot mål</TableHead>
                  <TableHead className="text-right">Snittid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resourceKpis.map((r) => {
                  const diff = r.completedTasks - r.totalTasks;
                  const goalDiff = r.completedTasks - zones.target;
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
    description: "Hög allvarsgrad och förseningar &gt; 2h hanteras först.",
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
