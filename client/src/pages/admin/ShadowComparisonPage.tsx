import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Download, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface DeltaStats {
  median: number | null;
  p95: number | null;
  absMedian: number | null;
  absP95: number | null;
  count: number;
}

interface OperationSummary {
  operation: string;
  total: number;
  shadowOk: number;
  shadowFailed: number;
  failureRatePct: number;
  primaryLatency: { medianMs: number | null; p95Ms: number | null };
  shadowLatency: { medianMs: number | null; p95Ms: number | null };
  deltas: Record<string, DeltaStats>;
  cost: {
    pricePer1k: number | null;
    sampleCount: number;
    projected30d: number;
    fullVolume30d: number;
    estimatedCostUsd30d: number | null;
    sampleRate: number | null;
  };
}

interface ShadowTrendBucket {
  bucketStart: string;
  operation: string;
  total: number;
  shadowOk: number;
  shadowFailed: number;
  failureRatePct: number;
  distanceKmAbsP95: number | null;
  estimatedCostUsd: number | null;
}

interface ShadowTrendResult {
  windowDays: number;
  bucket: "day" | "week";
  sampleRate: number | null;
  operations: string[];
  buckets: ShadowTrendBucket[];
}

interface ShadowReportSummary {
  windowDays: number;
  since: string;
  totalRows: number;
  primaryProviders: string[];
  shadowProviders: string[];
  sampleRate: number | null;
  thresholds: { failureRatePct: number; distanceP95Km: number };
  alerts: Array<{
    severity: "warning" | "critical";
    operation: string;
    metric: string;
    value: number;
    threshold: number;
    message: string;
  }>;
  operations: OperationSummary[];
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("sv-SE");
}

export default function ShadowComparisonPage() {
  const { toast } = useToast();
  const [days, setDays] = useState<7 | 30>(7);

  const summaryQuery = useQuery<ShadowReportSummary>({
    queryKey: ["/api/admin/shadow-comparison/summary", { days }],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/shadow-comparison/summary?days=${days}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as ShadowReportSummary;
    },
  });

  const trendQuery = useQuery<ShadowTrendResult>({
    queryKey: ["/api/admin/shadow-comparison/trend", { days }],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/shadow-comparison/trend?days=${days}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return (await res.json()) as ShadowTrendResult;
    },
  });

  const handleExport = async () => {
    try {
      const res = await fetch(
        `/api/admin/shadow-comparison/export.csv?days=${days}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shadow-comparison-${days}d.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "CSV-export misslyckades",
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const summary = summaryQuery.data;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Kartleverantör — jämförelse
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Löpande jämförelse mellan nuvarande och alternativ kartleverantör.
            Visar avvikelser, volym och en grov kostnadsuppskattning innan vi
            byter leverantör. Endast plattformsägare ser denna vy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={String(days)} onValueChange={(v) => setDays(v === "30" ? 30 : 7)}>
            <TabsList>
              <TabsTrigger value="7" data-testid="tab-window-7d">7 dagar</TabsTrigger>
              <TabsTrigger value="30" data-testid="tab-window-30d">30 dagar</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              summaryQuery.refetch();
              trendQuery.refetch();
            }}
            disabled={summaryQuery.isFetching || trendQuery.isFetching}
            data-testid="button-refresh"
            title="Uppdatera"
          >
            {summaryQuery.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button onClick={handleExport} data-testid="button-export-csv">
            <Download className="h-4 w-4 mr-2" />
            Exportera CSV
          </Button>
        </div>
      </div>

      {summaryQuery.isLoading && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Laddar jämförelsedata…
          </CardContent>
        </Card>
      )}

      {summaryQuery.error && (
        <Alert variant="destructive" data-testid="alert-load-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Kunde inte ladda jämförelserapporten</AlertTitle>
          <AlertDescription>
            {summaryQuery.error instanceof Error
              ? summaryQuery.error.message
              : String(summaryQuery.error)}
          </AlertDescription>
        </Alert>
      )}

      {summary && (
        <>
          {summary.alerts.length > 0 && (
            <div className="space-y-2" data-testid="alerts-list">
              {summary.alerts.map((a, i) => (
                <Alert
                  key={`${a.operation}-${a.metric}-${i}`}
                  variant={a.severity === "critical" ? "destructive" : "default"}
                  data-testid={`alert-${a.operation}-${a.metric}`}
                >
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    {a.severity === "critical" ? "Kritisk avvikelse" : "Varning"}
                    {" — "}
                    {a.operation}
                  </AlertTitle>
                  <AlertDescription>{a.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Översikt</CardTitle>
              <CardDescription>
                Fönster: senaste {summary.windowDays} dagar · sedan{" "}
                {new Date(summary.since).toLocaleString("sv-SE")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <Stat label="Totalt rader" value={summary.totalRows.toLocaleString("sv-SE")} testId="stat-total" />
              <Stat
                label="Urvalsfrekvens"
                value={
                  summary.sampleRate != null
                    ? `${(summary.sampleRate * 100).toFixed(1)}%`
                    : "ej satt"
                }
                testId="stat-sample-rate"
              />
              <Stat
                label="Nuvarande"
                value={summary.primaryProviders.join(", ") || "—"}
                testId="stat-primary"
              />
              <Stat
                label="Alternativ"
                value={summary.shadowProviders.join(", ") || "—"}
                testId="stat-shadow"
              />
            </CardContent>
            <CardContent className="text-xs text-muted-foreground">
              Tröskelvärden: fel hos alternativ leverantör &gt; {summary.thresholds.failureRatePct}% ·
              |Δ distans| p95 &gt; {summary.thresholds.distanceP95Km} km. Konfigurera via
              env <code>MAP_SHADOW_ERROR_THRESHOLD_PCT</code> /{" "}
              <code>MAP_SHADOW_DISTANCE_P95_KM</code>.
            </CardContent>
          </Card>

          <ShadowTrendCharts
            trend={trendQuery.data}
            loading={trendQuery.isLoading}
            error={trendQuery.error}
          />

          {summary.totalRows === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Inga jämförelserader i fönstret. Säkerställ att{" "}
                <code>MAP_SHADOW_SAMPLE_RATE</code> &gt; 0 och att en
                alternativ leverantör är konfigurerad.
              </CardContent>
            </Card>
          ) : (
            <>
              {summary.operations.map((op) => (
                <OperationCard
                  key={op.operation}
                  op={op}
                  failureThresholdPct={summary.thresholds.failureRatePct}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                Notera: fel-andels-larm utlöses först när en operation har
                minst 20 jämförelserader i fönstret — annars är urvalet för litet
                för att vara meningsfullt och larmen undertrycks.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold mt-1" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function OperationCard({
  op,
  failureThresholdPct,
}: {
  op: OperationSummary;
  failureThresholdPct: number;
}) {
  const deltaKeys = Object.keys(op.deltas);
  const cost = op.cost;
  const overThreshold = op.failureRatePct > failureThresholdPct;
  return (
    <Card data-testid={`card-operation-${op.operation}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="capitalize">{op.operation}</CardTitle>
            <CardDescription>
              {op.total.toLocaleString("sv-SE")} rader · {op.shadowOk} ok ·{" "}
              {op.shadowFailed} fel
            </CardDescription>
          </div>
          <Badge
            variant={overThreshold ? "destructive" : "secondary"}
            data-testid={`badge-failure-${op.operation}`}
            title={`Tröskel: ${failureThresholdPct}%`}
          >
            Fel-andel {fmt(op.failureRatePct, 1)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="text-sm">
            <p className="font-medium mb-1">Latens (nuvarande)</p>
            <p className="text-muted-foreground">
              median {fmtInt(op.primaryLatency.medianMs)} ms · p95{" "}
              {fmtInt(op.primaryLatency.p95Ms)} ms
            </p>
          </div>
          <div className="text-sm">
            <p className="font-medium mb-1">Latens (alternativ)</p>
            <p className="text-muted-foreground">
              median {fmtInt(op.shadowLatency.medianMs)} ms · p95{" "}
              {fmtInt(op.shadowLatency.p95Ms)} ms
            </p>
          </div>
        </div>

        {deltaKeys.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Delta</th>
                  <th className="py-2 pr-4 text-right">median</th>
                  <th className="py-2 pr-4 text-right">p95</th>
                  <th className="py-2 pr-4 text-right">|Δ| median</th>
                  <th className="py-2 pr-4 text-right">|Δ| p95</th>
                  <th className="py-2 pr-4 text-right">n</th>
                </tr>
              </thead>
              <tbody>
                {deltaKeys.map((k) => {
                  const d = op.deltas[k];
                  return (
                    <tr key={k} className="border-b" data-testid={`row-delta-${op.operation}-${k}`}>
                      <td className="py-2 pr-4 font-mono text-xs">{k}</td>
                      <td className="py-2 pr-4 text-right">{fmt(d.median)}</td>
                      <td className="py-2 pr-4 text-right">{fmt(d.p95)}</td>
                      <td className="py-2 pr-4 text-right">{fmt(d.absMedian)}</td>
                      <td className="py-2 pr-4 text-right">{fmt(d.absP95)}</td>
                      <td className="py-2 pr-4 text-right">{d.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded border p-3 text-sm bg-muted/30">
          <p className="font-medium mb-1">Kostnadsprojektion (grov)</p>
          {cost.pricePer1k == null || cost.pricePer1k === 0 ? (
            <p className="text-muted-foreground">
              Pris ej modellerad för {op.operation}.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Sample: {cost.sampleCount.toLocaleString("sv-SE")} → projicerat{" "}
              {fmtInt(cost.projected30d)} sample/30d → full volym{" "}
              {fmtInt(cost.fullVolume30d)} →{" "}
              <strong data-testid={`text-cost-${op.operation}`}>
                ~${fmt(cost.estimatedCostUsd30d, 2)}/månad
              </strong>{" "}
              @ ${cost.pricePer1k}/1k
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const TREND_COLORS = ["#1B4B6B", "#4A9B9B", "#7DBFB0", "#6B7C8C", "#2C3E50"];

type TrendMetric = "shadowOk" | "failureRatePct" | "distanceKmAbsP95" | "estimatedCostUsd";

interface ChartSpec {
  metric: TrendMetric;
  title: string;
  description: string;
  unit: string;
  digits: number;
  testId: string;
}

const CHART_SPECS: ChartSpec[] = [
  {
    metric: "estimatedCostUsd",
    title: "Projicerad kostnad",
    description: "Skattat USD per period (full volym, justerat för urvalsfrekvens)",
    unit: "$",
    digits: 2,
    testId: "chart-trend-cost",
  },
  {
    metric: "shadowOk",
    title: "Volym (lyckade anrop)",
    description: "Antal lyckade anrop per period",
    unit: "",
    digits: 0,
    testId: "chart-trend-volume",
  },
  {
    metric: "failureRatePct",
    title: "Fel-andel",
    description: "Andel jämförelseanrop som misslyckades (%)",
    unit: "%",
    digits: 1,
    testId: "chart-trend-failure",
  },
  {
    metric: "distanceKmAbsP95",
    title: "|Δ distans| p95",
    description: "Avvikelse mot primär leverantör i km (p95)",
    unit: " km",
    digits: 2,
    testId: "chart-trend-distance",
  },
];

function formatBucketLabel(iso: string, granularity: "day" | "week"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (granularity === "day") {
    return d.toLocaleDateString("sv-SE", { month: "2-digit", day: "2-digit" });
  }
  // ISO week number (UTC)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `v.${week}`;
}

function ShadowTrendCharts({
  trend,
  loading,
  error,
}: {
  trend: ShadowTrendResult | undefined;
  loading: boolean;
  error: unknown;
}) {
  const granularity = trend?.bucket ?? "day";

  const { periods, ops, totalsByMetric } = useMemo(() => {
    if (!trend) {
      return {
        periods: [] as string[],
        ops: [] as string[],
        totalsByMetric: {} as Record<TrendMetric, number>,
      };
    }
    const periodSet = new Set<string>();
    for (const b of trend.buckets) periodSet.add(b.bucketStart);
    const periods = Array.from(periodSet).sort();
    const ops = trend.operations;
    const totals: Record<TrendMetric, number> = {
      shadowOk: 0,
      failureRatePct: 0,
      distanceKmAbsP95: 0,
      estimatedCostUsd: 0,
    };
    for (const b of trend.buckets) {
      totals.shadowOk += b.shadowOk;
      if (b.estimatedCostUsd != null) totals.estimatedCostUsd += b.estimatedCostUsd;
      if (b.distanceKmAbsP95 != null) totals.distanceKmAbsP95 += b.distanceKmAbsP95;
      totals.failureRatePct += b.failureRatePct;
    }
    return { periods, ops, totalsByMetric: totals };
  }, [trend]);

  if (loading) {
    return (
      <Card data-testid="card-trend-loading">
        <CardContent className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Laddar trend…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" data-testid="alert-trend-error">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Kunde inte ladda trend</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : String(error)}
        </AlertDescription>
      </Alert>
    );
  }

  if (!trend || trend.buckets.length === 0) {
    return null;
  }

  const buildSeries = (metric: TrendMetric) =>
    periods.map((p) => {
      const row: Record<string, string | number | null> = {
        period: formatBucketLabel(p, granularity),
        bucketStart: p,
      };
      for (const op of ops) {
        const bucket = trend.buckets.find(
          (b) => b.bucketStart === p && b.operation === op,
        );
        const v = bucket ? (bucket[metric] as number | null) : null;
        row[op] = v == null || !Number.isFinite(v) ? null : v;
      }
      return row;
    });

  return (
    <Card data-testid="card-trend">
      <CardHeader>
        <CardTitle>Kostnads- och kvalitetstrend</CardTitle>
        <CardDescription>
          Per {granularity === "day" ? "dag" : "vecka"} över valt fönster (
          {trend.windowDays} dagar). Linjerna visar respektive operation.
          {trend.sampleRate == null && (
            <>
              {" "}Urvalsfrekvens är inte satt — kostnad antar 100% trafik.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        {CHART_SPECS.map((spec) => {
          const data = buildSeries(spec.metric);
          const showChart = totalsByMetric[spec.metric] > 0 || spec.metric === "failureRatePct";
          return (
            <div key={spec.metric} data-testid={spec.testId}>
              <p className="font-medium text-sm">{spec.title}</p>
              <p className="text-xs text-muted-foreground mb-2">{spec.description}</p>
              <div className="h-56 w-full">
                {showChart ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="period"
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        className="fill-muted-foreground"
                        tickFormatter={(v) =>
                          typeof v === "number"
                            ? `${spec.unit === "$" ? "$" : ""}${v.toFixed(spec.digits === 0 ? 0 : Math.min(spec.digits, 1))}${spec.unit !== "$" ? spec.unit : ""}`
                            : String(v)
                        }
                        width={56}
                      />
                      <Tooltip
                        formatter={(value: number | string) => {
                          if (typeof value !== "number" || !Number.isFinite(value)) return "—";
                          return spec.unit === "$"
                            ? `$${value.toFixed(spec.digits)}`
                            : `${value.toFixed(spec.digits)}${spec.unit}`;
                        }}
                        labelFormatter={(label) => String(label)}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {ops.map((op, i) => (
                        <Line
                          key={op}
                          type="monotone"
                          dataKey={op}
                          stroke={TREND_COLORS[i % TREND_COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    Ingen data för denna mätetal i fönstret.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
