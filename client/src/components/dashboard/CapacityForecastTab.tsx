import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  Download,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Loader2,
  ArrowRight,
  CalendarDays,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ClusterWeek {
  weekStart: string;
  demandHours: number;
  capacityHours: number;
  gapHours: number;
  weatherMultiplier: number;
}

interface ClusterForecast {
  clusterId: string;
  clusterName: string;
  weeks: ClusterWeek[];
  totalDemand: number;
  totalCapacity: number;
  totalGap: number;
}

interface RebalanceSuggestion {
  fromClusterId: string;
  fromClusterName: string;
  toClusterId: string;
  toClusterName: string;
  weekStart: string;
  weekStartEnd?: string;
  fteShift: number;
  hours: number;
}

interface ForecastResponse {
  windowWeeks: number;
  computedAt: string;
  clusters: ClusterForecast[];
  understaffed: ClusterForecast[];
  overstaffed: ClusterForecast[];
  suggestions: RebalanceSuggestion[];
}

function isoWeekNumber(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function formatWeekLabel(iso: string): string {
  return `v.${isoWeekNumber(iso)}`;
}

export function CapacityForecastTab() {
  const [windowWeeks, setWindowWeeks] = useState<number>(12);
  const [selectedClusterId, setSelectedClusterId] = useState<string | "all">("all");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const { toast } = useToast();

  const { data, isLoading, isError, refetch } = useQuery<ForecastResponse>({
    queryKey: ["/api/capacity-forecast", windowWeeks],
    queryFn: async () => {
      const r = await fetch(`/api/capacity-forecast?weeks=${windowWeeks}`, { credentials: "include" });
      if (!r.ok) throw new Error("Kunde inte hämta prognos");
      return r.json();
    },
  });

  const recompute = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/capacity-forecast/recompute", { weeks: windowWeeks });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/capacity-forecast"] });
      toast({ title: "Prognos uppdaterad", description: "Kapacitetsprognosen har räknats om." });
    },
    onError: () => toast({ title: "Kunde inte räkna om", variant: "destructive" }),
  });

  const aiSummaryMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/capacity-forecast/ai-summary", { weeks: windowWeeks });
      return res.json() as Promise<{ summary: string }>;
    },
    onSuccess: (d) => setAiSummary(d.summary),
    onError: () => toast({ title: "AI-sammanfattning misslyckades", variant: "destructive" }),
  });

  const handlePdfExport = () => {
    window.open(`/api/capacity-forecast/pdf?weeks=${windowWeeks}`, "_blank");
  };

  if (isLoading) {
    return (
      <div className="space-y-4 mt-4" data-testid="capacity-forecast-loading">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="mt-4" data-testid="capacity-forecast-error">
        <CardContent className="py-8 text-center text-muted-foreground space-y-3">
          <p>Kunde inte hämta kapacitetsprognosen.</p>
          <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-forecast">
            <RefreshCw className="h-4 w-4 mr-2" /> Försök igen
          </Button>
        </CardContent>
      </Card>
    );
  }

  const visibleClusters = selectedClusterId === "all" ? data.clusters : data.clusters.filter(c => c.clusterId === selectedClusterId);

  // Build aggregated chart data
  const chartData = (visibleClusters[0]?.weeks ?? []).map((w, idx) => {
    const sumDemand = visibleClusters.reduce((s, c) => s + (c.weeks[idx]?.demandHours ?? 0), 0);
    const sumCapacity = visibleClusters.reduce((s, c) => s + (c.weeks[idx]?.capacityHours ?? 0), 0);
    const sumGap = sumDemand - sumCapacity;
    return {
      week: formatWeekLabel(w.weekStart),
      Efterfrågan: Math.round(sumDemand * 10) / 10,
      Kapacitet: Math.round(sumCapacity * 10) / 10,
      Gap: Math.round(sumGap * 10) / 10,
    };
  });

  return (
    <div className="space-y-4 mt-4" data-testid="capacity-forecast-tab">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Select value={String(windowWeeks)} onValueChange={(v) => setWindowWeeks(Number(v))}>
            <SelectTrigger className="w-[160px]" data-testid="select-forecast-window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="8">8 veckor</SelectItem>
              <SelectItem value="12">12 veckor</SelectItem>
              <SelectItem value="26">26 veckor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select value={selectedClusterId} onValueChange={setSelectedClusterId}>
          <SelectTrigger className="w-[220px]" data-testid="select-forecast-cluster">
            <SelectValue placeholder="Alla kluster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla kluster (summerat)</SelectItem>
            {data.clusters.map(c => (
              <SelectItem key={c.clusterId} value={c.clusterId}>{c.clusterName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
            data-testid="button-recompute-forecast"
          >
            {recompute.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Räkna om
          </Button>
          <Button variant="outline" size="sm" onClick={handlePdfExport} data-testid="button-pdf-forecast">
            <Download className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="text-forecast-computed-at">
        Senast beräknad: {new Date(data.computedAt).toLocaleString("sv-SE")}
      </p>

      <Card data-testid="card-forecast-chart">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Efterfrågan vs kapacitet — {selectedClusterId === "all" ? "alla kluster" : visibleClusters[0]?.clusterName}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis label={{ value: "Timmar", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Efterfrågan" fill="#3b82f6" />
                <Bar dataKey="Kapacitet" fill="#22c55e" />
                <Line type="monotone" dataKey="Gap" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-understaffed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-destructive" />
              Mest underbemannade kluster
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.understaffed.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Inga underbemannade kluster — bra balans!</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kluster</TableHead>
                    <TableHead className="text-right">Brist (h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.understaffed.map(c => (
                    <TableRow key={c.clusterId} data-testid={`row-understaffed-${c.clusterId}`}>
                      <TableCell className="font-medium">{c.clusterName}</TableCell>
                      <TableCell className="text-right text-destructive font-mono">
                        +{c.totalGap.toFixed(1)}h
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-overstaffed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-chart-2" />
              Mest överbemannade kluster
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.overstaffed.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Inga överbemannade kluster.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kluster</TableHead>
                    <TableHead className="text-right">Överskott (h)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.overstaffed.map(c => (
                    <TableRow key={c.clusterId} data-testid={`row-overstaffed-${c.clusterId}`}>
                      <TableCell className="font-medium">{c.clusterName}</TableCell>
                      <TableCell className="text-right text-chart-2 font-mono">
                        {Math.abs(c.totalGap).toFixed(1)}h
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-suggestions">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Föreslagna omflyttningar</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => aiSummaryMutation.mutate()}
            disabled={aiSummaryMutation.isPending || data.suggestions.length === 0}
            data-testid="button-ai-summary"
          >
            {aiSummaryMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            AI-sammanfattning
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Inga omflyttningar behövs — kapaciteten är balanserad.</p>
          ) : (
            <ul className="space-y-2">
              {data.suggestions.map((s, i) => {
                const weekText = s.weekStartEnd && s.weekStartEnd !== s.weekStart
                  ? `v.${isoWeekNumber(s.weekStart)}–v.${isoWeekNumber(s.weekStartEnd)}`
                  : `v.${isoWeekNumber(s.weekStart)}`;
                return (
                  <li
                    key={`${s.fromClusterId}-${s.toClusterId}-${i}`}
                    className="flex items-center gap-3 p-3 bg-muted/40 rounded-md"
                    data-testid={`suggestion-${i}`}
                  >
                    <Badge variant="outline">{weekText}</Badge>
                    <span className="font-medium">{s.fromClusterName}</span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{s.toClusterName}</span>
                    <span className="ml-auto text-sm font-mono">
                      {s.fteShift.toFixed(2)} FTE ({s.hours.toFixed(1)}h)
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {aiSummary && (
            <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-md text-sm" data-testid="text-ai-summary">
              <div className="flex items-center gap-2 mb-1 font-medium">
                <Sparkles className="h-4 w-4" /> AI-sammanfattning
              </div>
              <p className="whitespace-pre-line">{aiSummary}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-cluster-details">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per kluster — totalvärden för perioden</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kluster</TableHead>
                <TableHead className="text-right">Efterfrågan</TableHead>
                <TableHead className="text-right">Kapacitet</TableHead>
                <TableHead className="text-right">Gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.clusters.map(c => (
                <TableRow key={c.clusterId} data-testid={`row-cluster-${c.clusterId}`}>
                  <TableCell className="font-medium">{c.clusterName}</TableCell>
                  <TableCell className="text-right font-mono">{c.totalDemand.toFixed(1)}h</TableCell>
                  <TableCell className="text-right font-mono">{c.totalCapacity.toFixed(1)}h</TableCell>
                  <TableCell className={`text-right font-mono ${c.totalGap > 0 ? "text-destructive" : c.totalGap < 0 ? "text-chart-2" : ""}`}>
                    {c.totalGap > 0 ? "+" : ""}{c.totalGap.toFixed(1)}h
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
