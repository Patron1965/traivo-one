import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, TrendingUp, TrendingDown, ChevronRight, ChevronDown, Loader2, Bell, Clock, DollarSign, Sparkles, Lightbulb, AlertCircle, Ban, MapPin } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder } from "@shared/schema";
import { IMPOSSIBLE_REASON_LABELS } from "@shared/schema";

const CACHE_KEY_PREFIX = "nordfield_anomaly_explanation_";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getCacheKey(anomalyType: string, id: string): string {
  return `${anomalyType}:${id}`;
}

function getStorageKey(cacheKey: string): string {
  return `${CACHE_KEY_PREFIX}${cacheKey}`;
}

function getCachedExplanation(cacheKey: string): AnomalyExplanation | null {
  try {
    const raw = localStorage.getItem(getStorageKey(cacheKey));
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(getStorageKey(cacheKey));
      return null;
    }
    return data as AnomalyExplanation;
  } catch {
    return null;
  }
}

function setCachedExplanation(cacheKey: string, data: AnomalyExplanation): void {
  try {
    localStorage.setItem(getStorageKey(cacheKey), JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
  }
}

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

interface CostAnomaly {
  orderId: string;
  title: string;
  cost: number;
  avgCost: number;
  deviation: number;
}

interface SetupTimeAnomaly {
  objectId: string;
  objectName?: string;
  avgMinutes: number;
  count: number;
  deviationPercent: number;
}

interface PlanningKPIs {
  costAnomalies: CostAnomaly[];
  anomalousSetupTimes: SetupTimeAnomaly[];
  avgSetupTimeMinutes: number;
}

interface AnomalyExplanation {
  explanation: string;
  possibleCauses: string[];
  recommendations: string[];
  severity: "low" | "medium" | "high";
}

export function AnomalyAlerts() {
  const { data: analysis, isLoading: setupLoading } = useQuery<SetupTimeAnalysisResult>({
    queryKey: ["/api/ai/setup-insights"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: kpis, isLoading: kpisLoading } = useQuery<PlanningKPIs>({
    queryKey: ["/api/ai/kpis"],
    staleTime: 5 * 60 * 1000,
  });

  const { data: workOrders = [], isLoading: ordersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
    staleTime: 60 * 1000,
  });

  const impossibleOrders = workOrders.filter(wo => wo.orderStatus === "omojlig");

  const criticalAlerts = analysis?.insights.filter(
    i => (i.type === "drift" || i.type === "anomaly") && i.severity === "high"
  ) || [];

  const warningAlerts = analysis?.insights.filter(
    i => (i.type === "drift" || i.type === "anomaly") && i.severity === "medium"
  ) || [];

  const setupAlertCount = criticalAlerts.length + warningAlerts.length;
  const costAnomalies = kpis?.costAnomalies || [];
  const totalAlerts = setupAlertCount + costAnomalies.length + impossibleOrders.length;

  const isLoading = setupLoading || kpisLoading || ordersLoading;

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
        <div className="flex items-center justify-between gap-2 flex-wrap">
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
        <Tabs defaultValue="setup" className="w-full">
          <TabsList className="w-full mb-2">
            <TabsTrigger value="setup" className="flex-1 gap-1" data-testid="tab-setup-anomalies">
              <Clock className="h-3 w-3" />
              Ställtider
              {setupAlertCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1 no-default-hover-elevate">
                  {setupAlertCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="cost" className="flex-1 gap-1" data-testid="tab-cost-anomalies">
              <DollarSign className="h-3 w-3" />
              Kostnader
              {costAnomalies.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1 no-default-hover-elevate">
                  {costAnomalies.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="impossible" className="flex-1 gap-1" data-testid="tab-impossible-orders">
              <Ban className="h-3 w-3" />
              Omöjliga
              {impossibleOrders.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1 no-default-hover-elevate">
                  {impossibleOrders.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="mt-0">
            <ScrollArea className="h-[180px]">
              <div className="space-y-2">
                {criticalAlerts.slice(0, 3).map((alert) => (
                  <AlertItem key={alert.id} alert={alert} />
                ))}
                {warningAlerts.slice(0, 3 - criticalAlerts.length).map((alert) => (
                  <AlertItem key={alert.id} alert={alert} />
                ))}
                {setupAlertCount === 0 && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Inga ställtidsavvikelser
                  </div>
                )}
                {setupAlertCount > 3 && (
                  <div className="text-center pt-2">
                    <span className="text-xs text-muted-foreground">
                      +{setupAlertCount - 3} fler varningar
                    </span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="cost" className="mt-0">
            <ScrollArea className="h-[180px]">
              <div className="space-y-2">
                {costAnomalies.slice(0, 5).map((anomaly) => (
                  <CostAnomalyItem key={anomaly.orderId} anomaly={anomaly} />
                ))}
                {costAnomalies.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Inga kostnadsavvikelser
                  </div>
                )}
                {costAnomalies.length > 5 && (
                  <div className="text-center pt-2">
                    <span className="text-xs text-muted-foreground">
                      +{costAnomalies.length - 5} fler avvikelser
                    </span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="impossible" className="mt-0">
            <ScrollArea className="h-[180px]">
              <div className="space-y-2">
                {impossibleOrders.slice(0, 5).map((order) => (
                  <ImpossibleOrderItem key={order.id} order={order} />
                ))}
                {impossibleOrders.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Inga omöjliga ordrar
                  </div>
                )}
                {impossibleOrders.length > 5 && (
                  <div className="text-center pt-2">
                    <span className="text-xs text-muted-foreground">
                      +{impossibleOrders.length - 5} fler ordrar
                    </span>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CostAnomalyItem({ anomaly }: { anomaly: CostAnomaly }) {
  const [isOpen, setIsOpen] = useState(false);
  const cacheKey = getCacheKey("cost", anomaly.orderId);
  const [explanation, setExplanation] = useState<AnomalyExplanation | null>(
    () => getCachedExplanation(cacheKey)
  );

  const explainMutation = useMutation({
    mutationFn: async () => {
      const cached = getCachedExplanation(cacheKey);
      if (cached) return cached;
      
      const res = await apiRequest("POST", "/api/ai/explain-anomaly", {
        anomalyType: "cost",
        context: {
          orderTitle: anomaly.title,
          avgCost: anomaly.avgCost,
          actualCost: anomaly.cost,
          deviation: anomaly.deviation
        }
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCachedExplanation(cacheKey, data);
      setExplanation(data);
    }
  });

  const handleExpand = () => {
    if (!isOpen && !explanation && !explainMutation.isPending) {
      explainMutation.mutate();
    }
    setIsOpen(!isOpen);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div 
        className="p-3 rounded-md border bg-yellow-500/5 border-yellow-500/20"
        data-testid={`cost-anomaly-${anomaly.orderId}`}
      >
        <div className="flex items-start gap-2">
          <TrendingUp className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">
                {anomaly.title}
              </span>
              <Badge 
                variant="outline" 
                className="text-xs border-yellow-500/50 text-yellow-600"
              >
                +{anomaly.deviation}%
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Värde: {anomaly.cost.toLocaleString()} kr (snitt: {anomaly.avgCost.toLocaleString()} kr)
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 flex-shrink-0"
              onClick={handleExpand}
              data-testid={`button-explain-cost-${anomaly.orderId}`}
            >
              {explainMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          {explanation && (
            <ExplanationContent explanation={explanation} />
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ImpossibleOrderItem({ order }: { order: WorkOrder }) {
  const reasonLabel = order.impossibleReason 
    ? IMPOSSIBLE_REASON_LABELS[order.impossibleReason as keyof typeof IMPOSSIBLE_REASON_LABELS] 
    : "Okänd anledning";
  
  const formattedDate = order.impossibleAt 
    ? new Date(order.impossibleAt).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })
    : "";

  return (
    <div 
      className="p-3 rounded-md border bg-orange-500/5 border-orange-500/20"
      data-testid={`impossible-order-${order.id}`}
    >
      <div className="flex items-start gap-2">
        <Ban className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {order.title || `Order ${order.id.slice(0, 8)}`}
            </span>
            <Badge 
              variant="outline" 
              className="text-xs border-orange-500/50 text-orange-600"
            >
              {reasonLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
            {formattedDate && <span>{formattedDate}</span>}
            {order.impossibleReasonText && (
              <span className="truncate max-w-[200px]">{order.impossibleReasonText}</span>
            )}
          </div>
        </div>
        <Link href={`/orders/${order.id}`}>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 flex-shrink-0"
            data-testid={`button-view-order-${order.id}`}
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function AlertItem({ alert }: { alert: SetupTimeInsight }) {
  const [isOpen, setIsOpen] = useState(false);
  const cacheKey = getCacheKey("setup_time", alert.id);
  const [explanation, setExplanation] = useState<AnomalyExplanation | null>(
    () => getCachedExplanation(cacheKey)
  );
  const isOverestimate = alert.actualAverage && alert.currentEstimate && 
    alert.actualAverage < alert.currentEstimate;

  const explainMutation = useMutation({
    mutationFn: async () => {
      const cached = getCachedExplanation(cacheKey);
      if (cached) return cached;
      
      const res = await apiRequest("POST", "/api/ai/explain-anomaly", {
        anomalyType: "setup_time",
        context: {
          objectName: alert.objectName,
          clusterName: alert.clusterName,
          expected: alert.currentEstimate,
          actual: alert.actualAverage,
          deviation: alert.actualAverage && alert.currentEstimate 
            ? Math.round(((alert.actualAverage - alert.currentEstimate) / alert.currentEstimate) * 100)
            : 0
        }
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCachedExplanation(cacheKey, data);
      setExplanation(data);
    }
  });

  const handleExpand = () => {
    if (!isOpen && !explanation && !explainMutation.isPending) {
      explainMutation.mutate();
    }
    setIsOpen(!isOpen);
  };
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
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
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 flex-shrink-0"
              onClick={handleExpand}
              data-testid={`button-explain-setup-${alert.id}`}
            >
              {explainMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          {explanation && (
            <ExplanationContent explanation={explanation} />
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ExplanationContent({ explanation }: { explanation: AnomalyExplanation }) {
  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
        <p className="text-xs">{explanation.explanation}</p>
      </div>
      
      {explanation.possibleCauses.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3" />
            Möjliga orsaker:
          </div>
          <ul className="text-xs space-y-0.5 ml-4">
            {explanation.possibleCauses.map((cause, i) => (
              <li key={i} className="list-disc">{cause}</li>
            ))}
          </ul>
        </div>
      )}
      
      {explanation.recommendations.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lightbulb className="h-3 w-3" />
            Rekommendationer:
          </div>
          <ul className="text-xs space-y-0.5 ml-4">
            {explanation.recommendations.map((rec, i) => (
              <li key={i} className="list-disc">{rec}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
