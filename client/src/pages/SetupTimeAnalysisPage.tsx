import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Loader2, Timer, TrendingUp, TrendingDown, AlertTriangle, 
  CheckCircle, Target, RefreshCw, Sparkles, Clock
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SetupTimeInsight {
  id: string;
  type: "drift" | "anomaly" | "improvement" | "reliable" | "suggestion";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  objectId?: string;
  objectName?: string;
  clusterId?: string;
  clusterName?: string;
  currentEstimate?: number;
  actualAverage?: number;
  sampleSize?: number;
  suggestion?: string;
}

interface RecommendedUpdate {
  objectId: string;
  objectName: string;
  currentEstimate: number;
  suggestedEstimate: number;
  reason: string;
}

interface SetupTimeAnalysisResult {
  insights: SetupTimeInsight[];
  overallAccuracy: number;
  totalLogsAnalyzed: number;
  objectsWithSufficientData: number;
  summary: string;
  recommendedUpdates: RecommendedUpdate[];
}

const severityColors: Record<string, string> = {
  high: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
  medium: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  low: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
};

const typeIcons: Record<string, typeof Timer> = {
  drift: TrendingUp,
  anomaly: AlertTriangle,
  improvement: Sparkles,
  reliable: CheckCircle,
  suggestion: Target,
};

export default function SetupTimeAnalysisPage() {
  const { toast } = useToast();

  const { data: analysis, isLoading, refetch } = useQuery<SetupTimeAnalysisResult>({
    queryKey: ["/api/ai/setup-insights"],
  });

  const applyUpdatesMutation = useMutation({
    mutationFn: async (updates: RecommendedUpdate[]) => {
      return apiRequest("POST", "/api/ai/apply-setup-updates", { updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/setup-insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ 
        title: "Uppdateringar tillämpade", 
        description: "Objektens estimat har uppdaterats baserat på historisk data." 
      });
    },
    onError: () => {
      toast({ 
        title: "Fel", 
        description: "Kunde inte tillämpa uppdateringar.", 
        variant: "destructive" 
      });
    },
  });

  const driftInsights = useMemo(() => 
    analysis?.insights.filter(i => i.type === "drift") || [], 
    [analysis]
  );

  const reliableInsights = useMemo(() => 
    analysis?.insights.filter(i => i.type === "reliable") || [], 
    [analysis]
  );

  const anomalyInsights = useMemo(() => 
    analysis?.insights.filter(i => i.type === "anomaly") || [], 
    [analysis]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const accuracy = analysis?.overallAccuracy ?? 100;
  const accuracyColor = accuracy >= 80 ? "text-green-600" : accuracy >= 50 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Ställtidsanalys</h1>
          <p className="text-muted-foreground">AI-driven analys av faktiska ställtider vs estimat</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-analysis">
          <RefreshCw className="h-4 w-4 mr-2" />
          Uppdatera
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-accuracy">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Estimeringsprecision</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${accuracyColor}`}>{accuracy}%</div>
            <Progress value={accuracy} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card data-testid="card-logs-analyzed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Loggar analyserade</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analysis?.totalLogsAnalyzed || 0}</div>
            <p className="text-xs text-muted-foreground">Totalt antal ställtidsloggar</p>
          </CardContent>
        </Card>

        <Card data-testid="card-objects-with-data">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Objekt med tillräcklig data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analysis?.objectsWithSufficientData || 0}</div>
            <p className="text-xs text-muted-foreground">Minst 3 mätningar</p>
          </CardContent>
        </Card>

        <Card data-testid="card-updates-needed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Föreslagna uppdateringar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analysis?.recommendedUpdates.length || 0}</div>
            {(analysis?.recommendedUpdates.length || 0) > 0 && (
              <Button 
                size="sm" 
                className="mt-2 w-full"
                onClick={() => applyUpdatesMutation.mutate(analysis?.recommendedUpdates || [])}
                disabled={applyUpdatesMutation.isPending}
                data-testid="button-apply-updates"
              >
                {applyUpdatesMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Tillämpa alla
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {analysis?.summary && (
        <Card className="bg-muted/50">
          <CardContent className="pt-4">
            <p className="text-sm">{analysis.summary}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Estimat som behöver justeras
            </CardTitle>
            <CardDescription>
              Objekt där faktisk tid avviker mer än 20% från estimat
            </CardDescription>
          </CardHeader>
          <CardContent>
            {driftInsights.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Alla estimat är inom tolerans</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {driftInsights.map((insight) => {
                    const Icon = typeIcons[insight.type] || Timer;
                    return (
                      <div
                        key={insight.id}
                        className={`p-3 rounded-md border ${severityColors[insight.severity]}`}
                        data-testid={`insight-${insight.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <Icon className="h-4 w-4 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{insight.title}</span>
                              <Badge variant="outline" className="text-xs">
                                {insight.sampleSize} mätningar
                              </Badge>
                            </div>
                            <p className="text-xs opacity-80">{insight.description}</p>
                            {insight.suggestion && (
                              <p className="text-xs mt-1 font-medium">{insight.suggestion}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Pålitliga objekt
            </CardTitle>
            <CardDescription>
              Objekt med stabil och förutsägbar ställtid
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reliableInsights.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Samla in mer data för pålitlighetsanalys</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-3">
                  {reliableInsights.map((insight) => (
                    <div
                      key={insight.id}
                      className="p-3 rounded-md border bg-green-500/5 border-green-200 dark:border-green-800"
                      data-testid={`insight-${insight.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <CheckCircle className="h-4 w-4 mt-0.5 text-green-600" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-sm">{insight.objectName}</span>
                          <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {anomalyInsights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Avvikande mätningar
            </CardTitle>
            <CardDescription>
              Objekt med enstaka mätningar som avviker kraftigt
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {anomalyInsights.map((insight) => (
                <div
                  key={insight.id}
                  className={`p-3 rounded-md border ${severityColors[insight.severity]}`}
                  data-testid={`insight-${insight.id}`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                    <div>
                      <span className="font-medium text-sm">{insight.title}</span>
                      <p className="text-xs opacity-80 mt-1">{insight.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(analysis?.recommendedUpdates.length || 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Detaljerade uppdateringsförslag
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analysis?.recommendedUpdates.map((update) => (
                <div 
                  key={update.objectId}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                  data-testid={`update-${update.objectId}`}
                >
                  <div className="flex-1">
                    <span className="font-medium">{update.objectName}</span>
                    <p className="text-xs text-muted-foreground mt-1">{update.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{update.currentEstimate} min</span>
                    <TrendingUp className="h-4 w-4" />
                    <span className="font-medium text-green-600">{update.suggestedEstimate} min</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
