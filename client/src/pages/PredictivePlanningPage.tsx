import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, Users, Calendar, BarChart3, Brain } from "lucide-react";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from "recharts";

interface VolumeForecast {
  clusterId: string;
  clusterName: string;
  weekNumber: number;
  year: number;
  predictedOrders: number;
  predictedMinutes: number;
  historicalAverage: number;
  trend: "increasing" | "decreasing" | "stable";
  confidence: number;
  suggestedResources: number;
}

interface PredictiveRecommendation {
  id: string;
  type: "capacity_warning" | "resource_suggestion" | "trend_alert" | "optimization";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  clusterId?: string;
  clusterName?: string;
  actionable: boolean;
}

interface PredictivePlanningResult {
  forecasts: VolumeForecast[];
  recommendations: PredictiveRecommendation[];
  summary: string;
  dataQuality: "high" | "medium" | "low";
  weeksAnalyzed: number;
}

export default function PredictivePlanningPage() {
  const [weeksAhead, setWeeksAhead] = useState("4");

  const { data, isLoading, error } = useQuery<PredictivePlanningResult>({
    queryKey: ["/api/ai/predictive-planning", weeksAhead],
    queryFn: async () => {
      const res = await fetch(`/api/ai/predictive-planning?weeksAhead=${weeksAhead}`);
      if (!res.ok) throw new Error("Kunde inte hämta prognoser");
      return res.json();
    }
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Kunde inte ladda prognoser</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const forecasts = data?.forecasts || [];
  const recommendations = data?.recommendations || [];

  const clusterIds = Array.from(new Set(forecasts.map(f => f.clusterId)));
  const chartData = clusterIds.length > 0 ? 
    forecasts.filter(f => f.clusterId === clusterIds[0]).map(f => ({
      week: `V${f.weekNumber}`,
      ordrar: f.predictedOrders,
      timmar: Math.round(f.predictedMinutes / 60),
      resurser: f.suggestedResources
    })) : [];

  const clusterSummary = clusterIds.map(clusterId => {
    const clusterForecasts = forecasts.filter(f => f.clusterId === clusterId);
    const first = clusterForecasts[0];
    const totalPredicted = clusterForecasts.reduce((sum, f) => sum + f.predictedOrders, 0);
    return {
      clusterId,
      clusterName: first?.clusterName || clusterId,
      trend: first?.trend || "stable",
      totalPredicted,
      avgResources: clusterForecasts.length > 0 ? Math.round(clusterForecasts.reduce((sum, f) => sum + f.suggestedResources, 0) / clusterForecasts.length) : 0,
      confidence: first?.confidence || 0
    };
  });

  const TrendIcon = ({ trend }: { trend: string }) => {
    if (trend === "increasing") return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend === "decreasing") return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high": return "destructive";
      case "medium": return "secondary";
      default: return "outline";
    }
  };

  const getDataQualityLabel = (quality: string) => {
    switch (quality) {
      case "high": return "Hög";
      case "medium": return "Medel";
      default: return "Låg";
    }
  };

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Prediktiv Planering</h1>
          <p className="text-muted-foreground">AI-drivna volymprognoser och resursförslag</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Prognos:</span>
          <Select value={weeksAhead} onValueChange={setWeeksAhead}>
            <SelectTrigger className="w-32" data-testid="select-weeks-ahead">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2 veckor</SelectItem>
              <SelectItem value="4">4 veckor</SelectItem>
              <SelectItem value="8">8 veckor</SelectItem>
              <SelectItem value="12">12 veckor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Kluster analyserade</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-clusters-count">{clusterIds.length}</div>
            <p className="text-xs text-muted-foreground">med tillräcklig data</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Datakvalitet</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-data-quality">
              {getDataQualityLabel(data?.dataQuality || "low")}
            </div>
            <p className="text-xs text-muted-foreground">{data?.weeksAnalyzed || 0} veckors historik</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prognoser</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-forecasts-count">{forecasts.length}</div>
            <p className="text-xs text-muted-foreground">för kommande veckor</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rekommendationer</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-recommendations-count">{recommendations.length}</div>
            <p className="text-xs text-muted-foreground">
              {recommendations.filter(r => r.severity === "high").length} kritiska
            </p>
          </CardContent>
        </Card>
      </div>

      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Rekommendationer
            </CardTitle>
            <CardDescription>AI-genererade förslag baserat på historiska mönster</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map(rec => (
                <div 
                  key={rec.id} 
                  className="flex flex-wrap items-start justify-between gap-3 p-3 rounded-md bg-muted/50"
                  data-testid={`recommendation-${rec.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={getSeverityColor(rec.severity) as any}>
                        {rec.severity === "high" ? "Kritisk" : rec.severity === "medium" ? "Varning" : "Info"}
                      </Badge>
                      <span className="font-medium">{rec.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{rec.description}</p>
                  </div>
                  {rec.clusterName && (
                    <Badge variant="outline">{rec.clusterName}</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {chartData.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Orderprognos</CardTitle>
              <CardDescription>Förväntat antal ordrar per vecka</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="week" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="ordrar" stroke="hsl(var(--primary))" strokeWidth={2} name="Ordrar" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Resursbehov</CardTitle>
              <CardDescription>Föreslaget antal resurser per vecka</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="week" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="resurser" fill="hsl(var(--primary))" name="Resurser" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Klusteröversikt
          </CardTitle>
          <CardDescription>Prognoser per kluster</CardDescription>
        </CardHeader>
        <CardContent>
          {clusterSummary.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Otillräcklig historisk data. Minst 2 veckors orderhistorik per kluster krävs för prognoser.
            </p>
          ) : (
            <div className="space-y-3">
              {clusterSummary.map(cluster => (
                <div 
                  key={cluster.clusterId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-md bg-muted/50"
                  data-testid={`cluster-forecast-${cluster.clusterId}`}
                >
                  <div className="flex items-center gap-3">
                    <TrendIcon trend={cluster.trend} />
                    <div>
                      <div className="font-medium">{cluster.clusterName}</div>
                      <div className="text-sm text-muted-foreground">
                        Trend: {cluster.trend === "increasing" ? "Ökande" : cluster.trend === "decreasing" ? "Minskande" : "Stabil"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div className="text-center">
                      <div className="font-medium">{cluster.totalPredicted}</div>
                      <div className="text-muted-foreground">ordrar</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">{cluster.avgResources}</div>
                      <div className="text-muted-foreground">resurser</div>
                    </div>
                    <div className="text-center">
                      <div className="font-medium">{cluster.confidence}%</div>
                      <div className="text-muted-foreground">konfidens</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data?.summary && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground" data-testid="text-summary">{data.summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
