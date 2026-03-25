import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import {
  Target, TrendingUp, TrendingDown, Clock, AlertTriangle, CheckCircle2,
  ArrowUpRight, ArrowDownRight, Minus, BarChart3, Users, Gauge, Zap, Loader2
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend, Cell, PieChart, Pie, ComposedChart, Area
} from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CHART_COLORS = ["#1B4B6B", "#4A9B9B", "#7DBFB0", "#6B7C8C", "#E8F4F8"];
const REASON_LABELS: Record<string, string> = {
  locked_gate: "Låst grind",
  no_access: "Ingen tillgång",
  wrong_equipment: "Fel utrustning",
  customer_absent: "Kund ej hemma",
  weather: "Väder",
  vehicle_breakdown: "Fordonsfel",
  okänd: "Ej angiven orsak",
};

interface OverviewKPI {
  totalWithActual: number;
  maeMinutes: number;
  meanDeviationPct: number;
  mape: number;
  within15pct: number;
  over30pct: number;
  under30pct: number;
  accuracyRate: number;
  prevMape: number;
  mapeTrend: number;
}

interface WeeklyAccuracy {
  year: number;
  week: number;
  count: number;
  avg_estimated: number;
  avg_actual: number;
  avg_delta: number;
  avg_deviation_pct: number;
}

interface ArticleAccuracy {
  article_id: string;
  article_name: string;
  article_number: string;
  article_type: string;
  standard_time: number;
  sample_count: number;
  avg_estimated: number;
  avg_actual: number;
  avg_delta_min: number;
  avg_deviation_pct: number;
  stddev_actual: number;
  median_actual: number;
}

interface ResourceAccuracy {
  resource_id: string;
  resource_name: string;
  sample_count: number;
  avg_estimated: number;
  avg_actual: number;
  avg_delta_min: number;
  avg_deviation_pct: number;
}

interface CarryOverData {
  reasons: Array<{ reason: string; count: number; avg_planned_duration: number }>;
  totalIncomplete: number;
  totalScheduled: number;
}

interface SuggestedDuration {
  article_id: string;
  article_name: string;
  article_number: string;
  current_standard: number;
  sample_count: number;
  rolling_avg: number;
  median_actual: number;
  suggested_duration: number;
  current_deviation_pct: number;
}

export function PredictionAccuracyTab() {
  const [dateRange, setDateRange] = useState("30");
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: kpis, isLoading: kpisLoading } = useQuery<OverviewKPI>({
    queryKey: ["/api/feedback-loop/overview-kpis", dateRange],
    queryFn: () => fetch(`/api/feedback-loop/overview-kpis?days=${dateRange}`).then(r => r.json()),
  });

  const { data: weeklyData, isLoading: weeklyLoading } = useQuery<WeeklyAccuracy[]>({
    queryKey: ["/api/feedback-loop/service-accuracy"],
    queryFn: () => fetch("/api/feedback-loop/service-accuracy?weeks=12").then(r => r.json()),
  });

  const { data: articleData, isLoading: articleLoading } = useQuery<ArticleAccuracy[]>({
    queryKey: ["/api/feedback-loop/article-accuracy", dateRange],
    queryFn: () => fetch(`/api/feedback-loop/article-accuracy?days=${dateRange}`).then(r => r.json()),
  });

  const { data: resourceData } = useQuery<ResourceAccuracy[]>({
    queryKey: ["/api/feedback-loop/resource-accuracy", dateRange],
    queryFn: () => fetch(`/api/feedback-loop/resource-accuracy?days=${dateRange}`).then(r => r.json()),
  });

  const { data: carryOver } = useQuery<CarryOverData>({
    queryKey: ["/api/feedback-loop/carry-over", dateRange],
    queryFn: () => fetch(`/api/feedback-loop/carry-over?days=${dateRange}`).then(r => r.json()),
  });

  const { data: suggestedDurations } = useQuery<SuggestedDuration[]>({
    queryKey: ["/api/feedback-loop/suggested-durations"],
  });

  const applyDuration = useMutation({
    mutationFn: async ({ articleId, newDuration }: { articleId: string; newDuration: number }) => {
      return apiRequest("POST", `/api/feedback-loop/apply-duration/${articleId}`, { newDuration });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback-loop/suggested-durations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback-loop/article-accuracy"] });
      toast({ title: "Servicetid uppdaterad", description: "Ny standardtid sparad." });
    },
  });

  const weeklyChartData = useMemo(() =>
    (weeklyData || []).map(w => ({
      label: `v${w.week}`,
      estimated: w.avg_estimated,
      actual: w.avg_actual,
      deviation: parseFloat(String(w.avg_deviation_pct)),
      count: w.count,
    })),
  [weeklyData]);

  const articleChartData = useMemo(() =>
    (articleData || []).slice(0, 10).map(a => ({
      name: a.article_name.length > 20 ? a.article_name.slice(0, 20) + "…" : a.article_name,
      delta: a.avg_delta_min,
      deviation: parseFloat(String(a.avg_deviation_pct)),
      samples: a.sample_count,
    })),
  [articleData]);

  const carryOverPieData = useMemo(() =>
    (carryOver?.reasons || []).map(r => ({
      name: REASON_LABELS[r.reason] || r.reason,
      value: r.count,
    })),
  [carryOver]);

  if (kpisLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const completionRate = carryOver
    ? carryOver.totalScheduled > 0
      ? Math.round(((carryOver.totalScheduled - carryOver.totalIncomplete) / carryOver.totalScheduled) * 100)
      : 100
    : 0;

  return (
    <div className="space-y-4" data-testid="prediction-accuracy-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Prediktionsnoggrannhet</h3>
          <p className="text-sm text-muted-foreground">Beräknad vs faktisk servicetid och carry-over-analys</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[160px]" data-testid="select-date-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Senaste 7 dagar</SelectItem>
              <SelectItem value="30">Senaste 30 dagar</SelectItem>
              <SelectItem value="90">Senaste 90 dagar</SelectItem>
            </SelectContent>
          </Select>
          {(suggestedDurations || []).length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => setAdjustDialogOpen(true)}
              data-testid="button-adjust-durations"
            >
              <Zap className="h-4 w-4 mr-1" />
              Justera servicetider ({suggestedDurations?.length})
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPISmall
          title="Noggrannhet"
          value={`${kpis?.accuracyRate || 0}%`}
          subtitle="inom ±15%"
          icon={<Target className="h-4 w-4 text-primary" />}
          data-testid="kpi-accuracy-rate"
        />
        <KPISmall
          title="MAPE"
          value={`${kpis?.mape || 0}%`}
          subtitle={kpis?.mapeTrend !== undefined && kpis.mapeTrend !== 0
            ? `${kpis.mapeTrend > 0 ? "+" : ""}${kpis.mapeTrend.toFixed(1)}% vs föreg.`
            : "snittavvikelse"}
          trend={kpis?.mapeTrend !== undefined ? (kpis.mapeTrend > 0 ? "up" : kpis.mapeTrend < 0 ? "down" : "flat") : "flat"}
          trendGood={kpis?.mapeTrend !== undefined ? kpis.mapeTrend <= 0 : true}
          icon={<Gauge className="h-4 w-4 text-orange-500" />}
          data-testid="kpi-mape"
        />
        <KPISmall
          title="Medelfel"
          value={`${kpis?.maeMinutes || 0} min`}
          subtitle={`${kpis?.totalWithActual || 0} mätningar`}
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          data-testid="kpi-mae"
        />
        <KPISmall
          title="Slutförandegrad"
          value={`${completionRate}%`}
          subtitle={`${carryOver?.totalIncomplete || 0} oavslutade`}
          icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          data-testid="kpi-completion"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Veckovis noggrannhet
            </CardTitle>
            <CardDescription>Genomsnittlig beräknad vs faktisk servicetid per vecka</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyLoading ? (
              <div className="h-[280px] flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : weeklyChartData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Ingen data tillgänglig. Slutför ordrar med faktisk tid för att se trender.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={weeklyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis yAxisId="min" fontSize={12} label={{ value: "min", angle: -90, position: "insideLeft" }} />
                  <YAxis yAxisId="pct" orientation="right" fontSize={12} label={{ value: "%", angle: 90, position: "insideRight" }} />
                  <RechartsTooltip formatter={(val: any, name: string) =>
                    [name === "deviation" ? `${val}%` : `${val} min`, name === "estimated" ? "Beräknad" : name === "actual" ? "Faktisk" : "Avvikelse"]}
                  />
                  <Legend formatter={(val) => val === "estimated" ? "Beräknad" : val === "actual" ? "Faktisk" : "Avvikelse %"} />
                  <Bar yAxisId="min" dataKey="estimated" fill="#1B4B6B" opacity={0.7} />
                  <Bar yAxisId="min" dataKey="actual" fill="#4A9B9B" />
                  <Line yAxisId="pct" type="monotone" dataKey="deviation" stroke="#E57373" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Avvikelse per artikeltyp
            </CardTitle>
            <CardDescription>Topp 10 artiklar med störst avvikelse</CardDescription>
          </CardHeader>
          <CardContent>
            {articleLoading ? (
              <div className="h-[280px] flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : articleChartData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Minst 3 slutförda ordrar per artikeltyp krävs.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={articleChartData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" fontSize={12} label={{ value: "min", position: "insideBottom", offset: -5 }} />
                  <YAxis type="category" dataKey="name" width={120} fontSize={11} />
                  <RechartsTooltip formatter={(val: any) => [`${val} min`, "Snittavvikelse"]} />
                  <Bar dataKey="delta" radius={[0, 4, 4, 0]}>
                    {articleChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.delta > 0 ? "#E57373" : "#4CAF50"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Noggrannhet per resurs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {(resourceData || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Ingen data</p>
                ) : (
                  (resourceData || []).map(r => (
                    <div key={r.resource_id} className="flex items-center gap-3 p-2 border rounded-lg" data-testid={`resource-accuracy-${r.resource_id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{r.resource_name}</p>
                        <p className="text-xs text-muted-foreground">{r.sample_count} ordrar</p>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <div className="text-right">
                          <span className="text-muted-foreground">Ber: </span>{r.avg_estimated}m
                        </div>
                        <div className="text-right">
                          <span className="text-muted-foreground">Fakt: </span>{r.avg_actual}m
                        </div>
                        <Badge variant={Math.abs(parseFloat(String(r.avg_deviation_pct))) < 15 ? "default" : "destructive"}>
                          {parseFloat(String(r.avg_deviation_pct)) > 0 ? "+" : ""}{parseFloat(String(r.avg_deviation_pct))}%
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Carry-over-analys
            </CardTitle>
            <CardDescription>Vanligaste orsaker till oavslutade jobb</CardDescription>
          </CardHeader>
          <CardContent>
            {carryOverPieData.length === 0 ? (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                Inga oavslutade jobb under perioden.
              </div>
            ) : (
              <div className="flex gap-4">
                <ResponsiveContainer width="50%" height={260}>
                  <PieChart>
                    <Pie data={carryOverPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false} fontSize={10}>
                      {carryOverPieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2 pt-4">
                  {(carryOver?.reasons || []).map((r, i) => (
                    <div key={r.reason} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span>{REASON_LABELS[r.reason] || r.reason}</span>
                      </div>
                      <span className="font-medium">{r.count} st</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 mt-2 text-sm font-medium">
                    Totalt: {carryOver?.totalIncomplete || 0} av {carryOver?.totalScheduled || 0}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AdjustDurationsDialog
        open={adjustDialogOpen}
        onOpenChange={setAdjustDialogOpen}
        suggestions={suggestedDurations || []}
        onApply={(articleId, duration) => applyDuration.mutate({ articleId, newDuration: duration })}
        isApplying={applyDuration.isPending}
      />
    </div>
  );
}

function KPISmall({ title, value, subtitle, icon, trend, trendGood, ...props }: {
  title: string; value: string; subtitle: string; icon: React.ReactNode;
  trend?: "up" | "down" | "flat"; trendGood?: boolean; "data-testid"?: string;
}) {
  return (
    <Card data-testid={props["data-testid"]}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs font-medium text-muted-foreground uppercase">{title}</span>
          {trend && trend !== "flat" && (
            trend === "down"
              ? <ArrowDownRight className={`h-3 w-3 ${trendGood ? "text-green-500" : "text-red-500"}`} />
              : <ArrowUpRight className={`h-3 w-3 ${trendGood ? "text-green-500" : "text-red-500"}`} />
          )}
        </div>
        <p className="text-xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function AdjustDurationsDialog({ open, onOpenChange, suggestions, onApply, isApplying }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suggestions: SuggestedDuration[];
  onApply: (articleId: string, duration: number) => void;
  isApplying: boolean;
}) {
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const handleApply = (articleId: string, duration: number) => {
    onApply(articleId, duration);
    setApplied(prev => new Set([...prev, articleId]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Justera servicetider</DialogTitle>
          <DialogDescription>
            Baserat på senaste 30 dagarnas data föreslås justerade standardtider.
            Granska och godkänn varje förslag individuellt.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-3 pr-4">
            {suggestions.map(s => {
              const isAppliedItem = applied.has(s.article_id);
              const diff = s.suggested_duration - (s.current_standard || 0);
              return (
                <div key={s.article_id} className={`border rounded-lg p-3 ${isAppliedItem ? "opacity-50" : ""}`} data-testid={`suggestion-${s.article_id}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{s.article_name}</p>
                      <p className="text-xs text-muted-foreground">Art.nr: {s.article_number} | {s.sample_count} mätningar</p>
                    </div>
                    <Button
                      size="sm"
                      variant={isAppliedItem ? "outline" : "default"}
                      disabled={isAppliedItem || isApplying}
                      onClick={() => handleApply(s.article_id, s.suggested_duration)}
                      data-testid={`button-apply-${s.article_id}`}
                    >
                      {isAppliedItem ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1" /> Tillämpad</>
                      ) : (
                        "Godkänn"
                      )}
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Nuvarande: </span>
                      <span className="font-medium">{s.current_standard || 0} min</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Föreslaget: </span>
                      <span className="font-bold text-primary">{s.suggested_duration} min</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ändring: </span>
                      <span className={`font-medium ${diff > 0 ? "text-orange-600" : "text-green-600"}`}>
                        {diff > 0 ? "+" : ""}{diff} min
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                      <span>Snitt: {s.rolling_avg} min</span>
                      <span>Median: {s.median_actual} min</span>
                      <span>Avvikelse: {parseFloat(String(s.current_deviation_pct))}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {suggestions.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Inga justeringar att föreslå just nu. Alla standardtider stämmer väl överens med faktisk data.
              </p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-adjust">Stäng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
