import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, TrendingUp, TrendingDown, ChevronRight, Loader2, Bell } from "lucide-react";
import { Link } from "wouter";

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

interface SetupTimeAnalysisResult {
  insights: SetupTimeInsight[];
  overallAccuracy: number;
  totalLogsAnalyzed: number;
  objectsWithSufficientData: number;
  summary: string;
}

export function AnomalyAlerts() {
  const { data: analysis, isLoading } = useQuery<SetupTimeAnalysisResult>({
    queryKey: ["/api/ai/setup-insights"],
    staleTime: 5 * 60 * 1000,
  });

  const criticalAlerts = analysis?.insights.filter(
    i => (i.type === "drift" || i.type === "anomaly") && i.severity === "high"
  ) || [];

  const warningAlerts = analysis?.insights.filter(
    i => (i.type === "drift" || i.type === "anomaly") && i.severity === "medium"
  ) || [];

  const totalAlerts = criticalAlerts.length + warningAlerts.length;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Anomali-varningar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (totalAlerts === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Anomali-varningar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm">
            Inga avvikelser upptäckta
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-destructive/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Anomali-varningar
            <Badge variant="destructive" className="ml-1">
              {totalAlerts}
            </Badge>
          </CardTitle>
          <Link href="/setup-analysis">
            <Button variant="ghost" size="sm" data-testid="button-view-all-anomalies">
              Visa alla
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="h-[200px]">
          <div className="space-y-2">
            {criticalAlerts.slice(0, 3).map((alert) => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
            {warningAlerts.slice(0, 3 - criticalAlerts.length).map((alert) => (
              <AlertItem key={alert.id} alert={alert} />
            ))}
            {totalAlerts > 3 && (
              <div className="text-center pt-2">
                <span className="text-xs text-muted-foreground">
                  +{totalAlerts - 3} fler varningar
                </span>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function AlertItem({ alert }: { alert: SetupTimeInsight }) {
  const isOverestimate = alert.actualAverage && alert.currentEstimate && 
    alert.actualAverage < alert.currentEstimate;
  
  return (
    <div 
      className={`p-3 rounded-md border ${
        alert.severity === "high" 
          ? "bg-destructive/5 border-destructive/20" 
          : "bg-yellow-500/5 border-yellow-500/20"
      }`}
      data-testid={`alert-item-${alert.id}`}
    >
      <div className="flex items-start gap-2">
        {isOverestimate ? (
          <TrendingDown className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
        ) : (
          <TrendingUp className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {alert.objectName || "Okänt objekt"}
            </span>
            <Badge 
              variant="outline" 
              className={`text-xs ${
                alert.severity === "high" 
                  ? "border-destructive/50 text-destructive" 
                  : "border-yellow-500/50 text-yellow-600"
              }`}
            >
              {alert.severity === "high" ? "Kritisk" : "Varning"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Estimat: {alert.currentEstimate} min → Faktiskt: {alert.actualAverage?.toFixed(0)} min
          </p>
          {alert.clusterName && (
            <p className="text-xs text-muted-foreground">
              Kluster: {alert.clusterName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
