import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Sparkles, 
  Brain, 
  Zap, 
  TrendingUp, 
  Calendar, 
  Route, 
  AlertTriangle,
  Lightbulb,
  Clock,
  RefreshCw,
  Send,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Users,
  Truck,
  CloudSun,
  Target,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Settings,
  MessageSquare
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format, startOfWeek, addDays } from "date-fns";
import { sv } from "date-fns/locale";

interface WeatherImpact {
  date: string;
  impactLevel: "none" | "low" | "medium" | "high" | "severe";
  capacityMultiplier: number;
  reason: string;
  recommendations: string[];
}

interface PredictiveInsight {
  type: string;
  title: string;
  description: string;
  confidence: number;
  recommendation: string;
}

interface MaintenanceAlert {
  resourceId: string;
  resourceName: string;
  type: string;
  urgency: "low" | "medium" | "high";
  message: string;
  recommendation: string;
}

interface ProactiveTip {
  id: string;
  category: string;
  title: string;
  description: string;
  impact: string;
  actionable: boolean;
}

interface KPIsData {
  completionRate?: number;
  avgSetupTimeMinutes?: number;
  delayedOrdersPercent?: number;
  resourceEfficiency?: Record<string, { utilizationPercent: number }>;
}

interface PredictiveData {
  insights: PredictiveInsight[];
  summary: string;
}

interface MaintenanceData {
  alerts: MaintenanceAlert[];
  summary: string;
}

interface SetupInsightsData {
  insights: Array<{ objectName?: string; clusterId?: string; avgSetupTime: number; trend?: string }>;
  recommendations: string[];
}

interface WeatherData {
  impacts: WeatherImpact[];
  recommendations: string[];
}

export default function AIAssistantPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["kpis", "weather"]));
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 6), "yyyy-MM-dd");

  const kpisQuery = useQuery({
    queryKey: ["/api/ai/kpis"],
  });

  const predictiveQuery = useQuery({
    queryKey: ["/api/ai/predictive-planning"],
    refetchInterval: 5 * 60 * 1000,
  });

  const maintenanceQuery = useQuery({
    queryKey: ["/api/ai/predictive-maintenance"],
    refetchInterval: 10 * 60 * 1000,
  });

  const tipsQuery = useQuery({
    queryKey: ["/api/ai/proactive-tips"],
    refetchInterval: 10 * 60 * 1000,
  });

  const setupInsightsQuery = useQuery({
    queryKey: ["/api/ai/setup-insights"],
  });

  const weatherQuery = useQuery({
    queryKey: ["/api/ai/route-recommendations", weekStart],
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", "/api/ai/chat", {
        message,
        context: "planning_assistant",
      });
      return response.json();
    },
    onSuccess: (data) => {
      setChatHistory(prev => [
        ...prev,
        { role: "assistant", content: data.response || data.message }
      ]);
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte skicka meddelande till AI-assistenten.",
        variant: "destructive",
      });
    },
  });

  const autoScheduleMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/auto-schedule", {
        weekStart,
        weekEnd,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Schemaläggning klar",
        description: `${data.totalOrdersScheduled} ordrar schemalagda med ${data.estimatedEfficiency}% effektivitet.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte generera schemaläggning.",
        variant: "destructive",
      });
    },
  });

  const suggestionsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/planning-suggestions", {
        weekStart,
        weekEnd,
      });
      return response.json();
    },
  });

  const handleSendChat = () => {
    if (!chatMessage.trim()) return;
    setChatHistory(prev => [...prev, { role: "user", content: chatMessage }]);
    chatMutation.mutate(chatMessage);
    setChatMessage("");
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const kpis = (kpisQuery.data || {}) as KPIsData;
  const predictiveData = (predictiveQuery.data || { insights: [], summary: "" }) as PredictiveData;
  const maintenanceData = (maintenanceQuery.data || { alerts: [], summary: "" }) as MaintenanceData;
  const tips = (tipsQuery.data || []) as ProactiveTip[];
  const setupInsights = (setupInsightsQuery.data || { insights: [], recommendations: [] }) as SetupInsightsData;
  const weatherData = (weatherQuery.data || { impacts: [], recommendations: [] }) as WeatherData;

  const getImpactColor = (level: string) => {
    switch (level) {
      case "severe": return "bg-red-500/20 text-red-700 dark:text-red-300";
      case "high": return "bg-orange-500/20 text-orange-700 dark:text-orange-300";
      case "medium": return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300";
      case "low": return "bg-blue-500/20 text-blue-700 dark:text-blue-300";
      default: return "bg-green-500/20 text-green-700 dark:text-green-300";
    }
  };

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-500" />
            AI-Assistent
          </h1>
          <p className="text-muted-foreground">
            Intelligent planering och rekommendationer för din verksamhet
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/ai"] });
              toast({ title: "Uppdaterar AI-data..." });
            }}
            data-testid="button-refresh-ai"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Uppdatera
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview" data-testid="tab-ai-overview">
            <BarChart3 className="h-4 w-4 mr-2" />
            Översikt
          </TabsTrigger>
          <TabsTrigger value="scheduling" data-testid="tab-ai-scheduling">
            <Calendar className="h-4 w-4 mr-2" />
            Schemaläggning
          </TabsTrigger>
          <TabsTrigger value="predictions" data-testid="tab-ai-predictions">
            <TrendingUp className="h-4 w-4 mr-2" />
            Prediktioner
          </TabsTrigger>
          <TabsTrigger value="recommendations" data-testid="tab-ai-recommendations">
            <Lightbulb className="h-4 w-4 mr-2" />
            Rekommendationer
          </TabsTrigger>
          <TabsTrigger value="chat" data-testid="tab-ai-chat">
            <MessageSquare className="h-4 w-4 mr-2" />
            Chat
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-gradient-to-br from-purple-500/10 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-purple-500" />
                  Effektivitet
                </CardTitle>
              </CardHeader>
              <CardContent>
                {kpisQuery.isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">{kpis.completionRate || 0}%</div>
                    <p className="text-xs text-muted-foreground">Genomförda ordrar (30d)</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-500/10 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  Ställtid
                </CardTitle>
              </CardHeader>
              <CardContent>
                {kpisQuery.isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">{kpis.avgSetupTimeMinutes || 0} min</div>
                    <p className="text-xs text-muted-foreground">Genomsnittlig ställtid</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-green-500/10 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-green-500" />
                  Resursutnyttjande
                </CardTitle>
              </CardHeader>
              <CardContent>
                {kpisQuery.isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {Object.values(kpis.resourceEfficiency || {}).length > 0
                        ? Math.round(
                            Object.values(kpis.resourceEfficiency || {}).reduce(
                              (sum: number, r: any) => sum + (r.utilizationPercent || 0),
                              0
                            ) / Object.values(kpis.resourceEfficiency || {}).length
                          )
                        : 0}%
                    </div>
                    <p className="text-xs text-muted-foreground">Genomsnittlig beläggning</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-amber-500/10 to-transparent">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Förseningar
                </CardTitle>
              </CardHeader>
              <CardContent>
                {kpisQuery.isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">{kpis.delayedOrdersPercent || 0}%</div>
                    <p className="text-xs text-muted-foreground">Försenade ordrar</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Collapsible open={expandedSections.has("weather")}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover-elevate" onClick={() => toggleSection("weather")}>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <CloudSun className="h-5 w-5 text-blue-500" />
                        Väderprognos & Påverkan
                      </CardTitle>
                      {expandedSections.has("weather") ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    {weatherQuery.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : weatherData.impacts?.length > 0 ? (
                      <div className="space-y-2">
                        {weatherData.impacts.slice(0, 5).map((impact: WeatherImpact, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium">{impact.date}</span>
                              <Badge className={getImpactColor(impact.impactLevel)}>
                                {impact.impactLevel === "none" ? "Normal" : impact.impactLevel}
                              </Badge>
                            </div>
                            <div className="text-right">
                              <span className="text-sm">{Math.round(impact.capacityMultiplier * 100)}% kapacitet</span>
                              <p className="text-xs text-muted-foreground">{impact.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">Inga väderprognoser tillgängliga</p>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={expandedSections.has("maintenance")}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover-elevate" onClick={() => toggleSection("maintenance")}>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Truck className="h-5 w-5 text-orange-500" />
                        Underhållsbehov
                        {maintenanceData.alerts?.length > 0 && (
                          <Badge variant="secondary">{maintenanceData.alerts.length}</Badge>
                        )}
                      </CardTitle>
                      {expandedSections.has("maintenance") ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    {maintenanceQuery.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                      </div>
                    ) : maintenanceData.alerts?.length > 0 ? (
                      <div className="space-y-2">
                        {maintenanceData.alerts.slice(0, 4).map((alert: MaintenanceAlert, idx: number) => (
                          <div key={idx} className="p-2 rounded-md bg-muted/50">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">{alert.resourceName}</span>
                              <Badge variant={alert.urgency === "high" ? "destructive" : "secondary"}>
                                {alert.urgency}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-sm">Inga underhållsvarningar</span>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {tips.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  Proaktiva Tips
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 md:grid-cols-2">
                  {tips.slice(0, 4).map((tip: ProactiveTip) => (
                    <div key={tip.id} className="p-3 rounded-md bg-muted/50 border">
                      <div className="flex items-start gap-2">
                        <Zap className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium text-sm">{tip.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{tip.description}</p>
                          {tip.impact && (
                            <p className="text-xs text-green-600 mt-1">Effekt: {tip.impact}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="scheduling" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-purple-500" />
                  Auto-schemaläggning
                </CardTitle>
                <CardDescription>
                  Låt AI optimera schemaläggningen för veckan {weekStart} - {weekEnd}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  className="w-full"
                  onClick={() => autoScheduleMutation.mutate()}
                  disabled={autoScheduleMutation.isPending}
                  data-testid="button-run-auto-schedule"
                >
                  {autoScheduleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  Schemalägg automatiskt
                </Button>
                <p className="text-xs text-muted-foreground">
                  AI analyserar oschemalagda ordrar och placerar dem optimalt baserat på kluster, 
                  resurskapacitet, tidsfönster och väderprognos.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Route className="h-5 w-5 text-blue-500" />
                  Ruttoptimering
                </CardTitle>
                <CardDescription>
                  Optimera körordningen för att spara tid och bränsle
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    toast({
                      title: "Ruttoptimering",
                      description: "Använd WeekPlanner-vyn för detaljerad ruttoptimering per dag.",
                    });
                  }}
                  data-testid="button-route-optimize"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Optimera rutter
                </Button>
                <p className="text-xs text-muted-foreground">
                  Beräknar optimala körrutter baserat på geografisk gruppering och tidseffektivitet.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-500" />
                AI-förslag för planering
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                onClick={() => suggestionsMutation.mutate()}
                disabled={suggestionsMutation.isPending}
                className="mb-4"
                data-testid="button-get-suggestions"
              >
                {suggestionsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Brain className="h-4 w-4 mr-2" />
                )}
                Generera förslag
              </Button>

              {suggestionsMutation.data && Array.isArray(suggestionsMutation.data) && (
                <div className="space-y-2">
                  {suggestionsMutation.data.map((suggestion: any) => (
                    <div key={suggestion.id} className="p-3 rounded-md bg-muted/50 border">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{suggestion.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{suggestion.description}</p>
                          {suggestion.impact && (
                            <p className="text-xs text-green-600 mt-1">{suggestion.impact}</p>
                          )}
                        </div>
                        <Badge variant={suggestion.priority === "high" ? "destructive" : "secondary"}>
                          {suggestion.priority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!suggestionsMutation.data && !suggestionsMutation.isPending && (
                <p className="text-muted-foreground text-sm">
                  Klicka på knappen för att få AI-genererade förslag för att förbättra planeringen.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="predictions" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                Prediktiv planering
              </CardTitle>
              <CardDescription>
                AI-baserade insikter för framtida planering
              </CardDescription>
            </CardHeader>
            <CardContent>
              {predictiveQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : predictiveData.insights?.length > 0 ? (
                <div className="space-y-3">
                  {predictiveData.insights.map((insight: PredictiveInsight, idx: number) => (
                    <div key={idx} className="p-3 rounded-md bg-muted/50 border">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{insight.title}</p>
                            <Badge variant="outline">{insight.type}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                          {insight.recommendation && (
                            <div className="flex items-center gap-1 mt-2 text-xs text-primary">
                              <ArrowRight className="h-3 w-3" />
                              <span>{insight.recommendation}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <div className="text-lg font-bold">{insight.confidence}%</div>
                          <p className="text-xs text-muted-foreground">konfidens</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Inga prediktiva insikter tillgängliga just nu. Mer historisk data behövs.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-blue-500" />
                Ställtidsinsikter
              </CardTitle>
            </CardHeader>
            <CardContent>
              {setupInsightsQuery.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : setupInsights.insights?.length > 0 ? (
                <div className="space-y-2">
                  {setupInsights.insights.slice(0, 5).map((insight: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                      <span className="text-sm">{insight.objectName || insight.clusterId}</span>
                      <div className="text-right">
                        <span className="text-sm font-medium">{insight.avgSetupTime} min</span>
                        {insight.trend && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {insight.trend}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Inga ställtidsinsikter tillgängliga.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-500" />
                Proaktiva rekommendationer
              </CardTitle>
              <CardDescription>
                AI-genererade förslag för att förbättra verksamheten
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tipsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : tips.length > 0 ? (
                <div className="space-y-3">
                  {tips.map((tip: ProactiveTip) => (
                    <div key={tip.id} className="p-4 rounded-md bg-muted/50 border">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-md bg-yellow-500/20">
                          <Zap className="h-4 w-4 text-yellow-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{tip.title}</p>
                            <Badge variant="outline" className="text-xs">{tip.category}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{tip.description}</p>
                          {tip.impact && (
                            <p className="text-sm text-green-600 mt-2">
                              Förväntad effekt: {tip.impact}
                            </p>
                          )}
                        </div>
                        {tip.actionable && (
                          <Button size="sm" variant="outline">
                            Genomför
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-2" />
                  <p className="text-muted-foreground">
                    Inga aktuella rekommendationer. Allt ser bra ut!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {weatherData.recommendations?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CloudSun className="h-5 w-5 text-blue-500" />
                  Väderbaserade rekommendationer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {weatherData.recommendations.map((rec: string, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 p-2 rounded-md bg-blue-500/10">
                      <ArrowRight className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-sm">{rec}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="chat" className="space-y-4">
          <Card className="h-[600px] flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-purple-500" />
                Prata med AI-assistenten
              </CardTitle>
              <CardDescription>
                Ställ frågor om planering, få förslag eller analysera data
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <div className="flex-1 overflow-auto p-4 bg-muted/30 rounded-md mb-4 space-y-3">
                {chatHistory.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Brain className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Börja en konversation med AI-assistenten</p>
                    <p className="text-xs mt-1">Exempel: "Hur ser arbetsbelastningen ut nästa vecka?"</p>
                  </div>
                ) : (
                  chatHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] p-3 rounded-lg ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))
                )}
                {chatMutation.isPending && (
                  <div className="flex justify-start">
                    <div className="bg-muted p-3 rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Textarea
                  placeholder="Skriv din fråga här..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  className="flex-1"
                  rows={2}
                  data-testid="input-ai-chat"
                />
                <Button
                  onClick={handleSendChat}
                  disabled={!chatMessage.trim() || chatMutation.isPending}
                  data-testid="button-send-ai-chat"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
