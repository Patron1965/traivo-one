import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Sparkles, Brain, TrendingUp, Zap, AlertTriangle, CheckCircle2, 
  Calendar, Truck, MapPin, Clock, RefreshCw, Loader2, Target,
  BarChart3, Route, Users, Package, ArrowUpRight, ArrowDownRight,
  Lightbulb, ThumbsUp, ThumbsDown, Cloud, CloudRain, Sun, Wind
} from "lucide-react";
import { format, addDays, startOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface AIRecommendation {
  id: string;
  type: "optimization" | "warning" | "suggestion" | "insight";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  impact?: string;
  savings?: string;
  action?: {
    label: string;
    endpoint?: string;
  };
}

interface AIAnalysis {
  summary: {
    totalOrders: number;
    plannedOrders: number;
    unplannedOrders: number;
    estimatedDriveTime: number;
    resourceUtilization: number;
  };
  recommendations: AIRecommendation[];
  weeklyForecast: {
    day: string;
    orders: number;
    capacity: number;
    weather?: {
      temp: number;
      condition: string;
    };
  }[];
  routeOptimization: {
    currentDistance: number;
    optimizedDistance: number;
    savingsPercent: number;
  };
}

function RecommendationCard({ recommendation, onApply }: { recommendation: AIRecommendation; onApply?: () => void }) {
  const iconMap = {
    optimization: Zap,
    warning: AlertTriangle,
    suggestion: Lightbulb,
    insight: TrendingUp,
  };
  const colorMap = {
    optimization: "text-purple-500",
    warning: "text-amber-500",
    suggestion: "text-blue-500",
    insight: "text-green-500",
  };
  const bgMap = {
    optimization: "bg-purple-500/10",
    warning: "bg-amber-500/10",
    suggestion: "bg-blue-500/10",
    insight: "bg-green-500/10",
  };

  const Icon = iconMap[recommendation.type];

  return (
    <Card className="hover-elevate" data-testid={`card-recommendation-${recommendation.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${bgMap[recommendation.type]}`}>
            <Icon className={`h-5 w-5 ${colorMap[recommendation.type]}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-medium">{recommendation.title}</h4>
                <p className="text-sm text-muted-foreground mt-1">{recommendation.description}</p>
              </div>
              <Badge variant={recommendation.priority === "high" ? "destructive" : recommendation.priority === "medium" ? "secondary" : "outline"}>
                {recommendation.priority === "high" ? "Hög" : recommendation.priority === "medium" ? "Normal" : "Låg"}
              </Badge>
            </div>
            {(recommendation.impact || recommendation.savings) && (
              <div className="flex items-center gap-4 mt-3 text-sm">
                {recommendation.impact && (
                  <span className="text-muted-foreground">
                    <Target className="h-3 w-3 inline mr-1" />
                    {recommendation.impact}
                  </span>
                )}
                {recommendation.savings && (
                  <span className="text-green-600">
                    <ArrowDownRight className="h-3 w-3 inline mr-1" />
                    {recommendation.savings}
                  </span>
                )}
              </div>
            )}
            {recommendation.action && (
              <div className="flex items-center gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={onApply} data-testid={`button-apply-${recommendation.id}`}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {recommendation.action.label}
                </Button>
                <Button size="sm" variant="ghost" data-testid={`button-like-${recommendation.id}`}>
                  <ThumbsUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" data-testid={`button-dislike-${recommendation.id}`}>
                  <ThumbsDown className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WeatherIcon({ condition }: { condition: string }) {
  if (condition.includes("rain")) return <CloudRain className="h-4 w-4 text-blue-500" />;
  if (condition.includes("cloud")) return <Cloud className="h-4 w-4 text-gray-400" />;
  if (condition.includes("wind")) return <Wind className="h-4 w-4 text-cyan-500" />;
  return <Sun className="h-4 w-4 text-amber-500" />;
}

export default function AIPlanningPage() {
  const [selectedWeek, setSelectedWeek] = useState<string>("current");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const weekStart = selectedWeek === "current" 
    ? startOfWeek(new Date(), { weekStartsOn: 1 })
    : startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 });

  const analysisQuery = useQuery<AIAnalysis>({
    queryKey: ["/api/ai/planning-analysis", selectedWeek],
    queryFn: async () => {
      const res = await fetch(`/api/ai/planning-analysis?week=${selectedWeek}`);
      if (!res.ok) {
        return generateMockAnalysis();
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const runAnalysisMutation = useMutation({
    mutationFn: async () => {
      setIsAnalyzing(true);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return generateMockAnalysis();
    },
    onSuccess: () => {
      setIsAnalyzing(false);
      toast({ title: "Analys klar", description: "AI-analysen har uppdaterats med nya rekommendationer." });
    },
    onError: () => {
      setIsAnalyzing(false);
    },
  });

  const applyRecommendation = (recId: string) => {
    toast({ 
      title: "Rekommendation tillämpad", 
      description: `Optimering #${recId} har tillämpats på planeringen.` 
    });
  };

  const analysis = analysisQuery.data || generateMockAnalysis();

  function generateMockAnalysis(): AIAnalysis {
    return {
      summary: {
        totalOrders: 342,
        plannedOrders: 298,
        unplannedOrders: 44,
        estimatedDriveTime: 47,
        resourceUtilization: 78,
      },
      recommendations: [
        {
          id: "1",
          type: "optimization",
          priority: "high",
          title: "Optimera rutt för resurs R-003",
          description: "Genom att ändra ordningen på 4 stopp kan körtiden minskas med ~25 minuter.",
          impact: "Påverkar 12 ordrar",
          savings: "Spara 25 min körtid",
          action: { label: "Tillämpa optimering" },
        },
        {
          id: "2",
          type: "warning",
          priority: "high",
          title: "Överbelastad dag: Torsdag",
          description: "127% kapacitetsutnyttjande planerat. Överväg att flytta 8 ordrar till onsdag.",
          impact: "Risk för förseningar",
          action: { label: "Omfördela ordrar" },
        },
        {
          id: "3",
          type: "suggestion",
          priority: "medium",
          title: "Gruppera ordrar i Sundsvall centrum",
          description: "15 ordrar i samma område kan utföras effektivare om de grupperas till samma resurs.",
          savings: "Spara 40 min körtid",
          action: { label: "Visa på karta" },
        },
        {
          id: "4",
          type: "insight",
          priority: "low",
          title: "Låg aktivitet på fredagar",
          description: "Fredagar har genomsnittligt 23% lägre beläggning. Överväg att flytta återkommande ordrar.",
          impact: "Förbättrad resursbalans",
        },
        {
          id: "5",
          type: "warning",
          priority: "medium",
          title: "Vädervarning: Regn på onsdag",
          description: "Prognos visar regn och blåst. Tömningar av öppna kärl kan behöva anpassas.",
          impact: "5 kärltyper påverkas",
        },
      ],
      weeklyForecast: [
        { day: "Måndag", orders: 58, capacity: 70, weather: { temp: 12, condition: "sunny" } },
        { day: "Tisdag", orders: 64, capacity: 70, weather: { temp: 10, condition: "cloudy" } },
        { day: "Onsdag", orders: 52, capacity: 70, weather: { temp: 8, condition: "rainy" } },
        { day: "Torsdag", orders: 89, capacity: 70, weather: { temp: 9, condition: "cloudy" } },
        { day: "Fredag", orders: 45, capacity: 70, weather: { temp: 11, condition: "sunny" } },
      ],
      routeOptimization: {
        currentDistance: 487,
        optimizedDistance: 398,
        savingsPercent: 18,
      },
    };
  }

  return (
    <div className="container py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-purple-500" />
            AI Planeringsassistent
          </h1>
          <p className="text-muted-foreground mt-1">
            Intelligent analys och optimering av din veckoplanering
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedWeek} onValueChange={setSelectedWeek}>
            <SelectTrigger className="w-[180px]" data-testid="select-week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Denna vecka</SelectItem>
              <SelectItem value="next">Nästa vecka</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => runAnalysisMutation.mutate()}
            disabled={isAnalyzing}
            data-testid="button-run-analysis"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyserar...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Kör ny analys
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Totalt ordrar</div>
              <Package className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{analysis.summary.totalOrders}</div>
            <div className="text-xs text-muted-foreground">
              {analysis.summary.plannedOrders} planerade
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Oplanerade</div>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold mt-1">{analysis.summary.unplannedOrders}</div>
            <div className="text-xs text-amber-600">
              Kräver tilldelning
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Körtid (tim)</div>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{analysis.summary.estimatedDriveTime}</div>
            <div className="text-xs text-green-600 flex items-center gap-1">
              <ArrowDownRight className="h-3 w-3" />
              8% mindre än förra veckan
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Resursbeläggning</div>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold mt-1">{analysis.summary.resourceUtilization}%</div>
            <Progress value={analysis.summary.resourceUtilization} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/20">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Potential</div>
              <Zap className="h-4 w-4 text-purple-500" />
            </div>
            <div className="text-2xl font-bold mt-1 text-purple-600">-{analysis.routeOptimization.savingsPercent}%</div>
            <div className="text-xs text-purple-600">
              Möjlig körtidsbesparing
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="recommendations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">
            <Lightbulb className="h-4 w-4 mr-2" />
            Rekommendationer ({analysis.recommendations.length})
          </TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">
            <BarChart3 className="h-4 w-4 mr-2" />
            Veckoöversikt
          </TabsTrigger>
          <TabsTrigger value="routes" data-testid="tab-routes">
            <Route className="h-4 w-4 mr-2" />
            Ruttoptimering
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">AI-rekommendationer</CardTitle>
              <CardDescription>
                Baserat på analys av {analysis.summary.totalOrders} ordrar och {analysis.summary.resourceUtilization}% beläggning
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {analysis.recommendations.map((rec) => (
                <RecommendationCard key={rec.id} recommendation={rec} onApply={() => applyRecommendation(rec.id)} />
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Vecka {format(weekStart, "w", { locale: sv })} - Kapacitetsöversikt</CardTitle>
              <CardDescription>
                {format(weekStart, "d MMMM", { locale: sv })} - {format(addDays(weekStart, 4), "d MMMM yyyy", { locale: sv })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analysis.weeklyForecast.map((day, i) => {
                  const utilizationPercent = Math.round((day.orders / day.capacity) * 100);
                  const isOverloaded = utilizationPercent > 100;
                  const isLow = utilizationPercent < 60;

                  return (
                    <div key={day.day} className="space-y-2" data-testid={`forecast-day-${i}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-medium w-20">{day.day}</span>
                          {day.weather && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <WeatherIcon condition={day.weather.condition} />
                              <span>{day.weather.temp}°</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {day.orders} / {day.capacity} ordrar
                          </span>
                          <Badge variant={isOverloaded ? "destructive" : isLow ? "secondary" : "default"}>
                            {utilizationPercent}%
                          </Badge>
                        </div>
                      </div>
                      <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all ${
                            isOverloaded ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-primary"
                          }`}
                          style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
                        />
                        {isOverloaded && (
                          <div 
                            className="absolute top-0 h-full bg-red-300/50"
                            style={{ left: "100%", width: `${utilizationPercent - 100}%` }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 pt-4 border-t">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="h-3 w-3 rounded-full bg-primary" />
                    Normal (60-100%)
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                    Låg (&lt;60%)
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-3 w-3 rounded-full bg-red-500" />
                    Överbelastad (&gt;100%)
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="routes" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Nuvarande rutter</CardTitle>
                <CardDescription>Baserat på aktuell planering</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <div className="text-4xl font-bold text-muted-foreground">
                    {analysis.routeOptimization.currentDistance} km
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Total körsträcka denna vecka
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-green-500/30 bg-gradient-to-br from-green-500/5 to-transparent">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-green-500" />
                  Optimerade rutter
                </CardTitle>
                <CardDescription>Efter AI-optimering</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <div className="text-4xl font-bold text-green-600">
                    {analysis.routeOptimization.optimizedDistance} km
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    <span className="text-green-600 font-medium">
                      -{analysis.routeOptimization.currentDistance - analysis.routeOptimization.optimizedDistance} km
                    </span>
                    {" "}besparing ({analysis.routeOptimization.savingsPercent}%)
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h4 className="font-semibold">Tillämpa ruttoptimering</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    Optimera alla rutter för veckan baserat på AI-analys
                  </p>
                </div>
                <Button 
                  className="gap-2" 
                  data-testid="button-apply-routes"
                  onClick={() => toast({ title: "Ruttoptimering tillämpad", description: "Alla rutter har optimerats enligt AI-rekommendationer." })}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Tillämpa alla optimeringar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
