import { useState, useRef, useEffect, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, ArrowRight, Clock, Check, X, RefreshCw, Zap, Calendar, Route, MapPin, TrendingUp, ChevronDown, ChevronUp, Map, AlertTriangle, MessageSquare, Send, User, Bot } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { OptimizedRouteMap } from "./OptimizedRouteMap";
import { ScheduleDiffView } from "./ScheduleDiffView";

interface PlanningSuggestion {
  id: string;
  type: "move" | "swap" | "balance" | "warning";
  title: string;
  description: string;
  impact: string;
  workOrderId?: string;
  fromResourceId?: string;
  toResourceId?: string;
  fromDate?: string;
  toDate?: string;
  estimatedTimeSaved?: number;
  priority: "high" | "medium" | "low";
}

interface ScheduleAssignment {
  workOrderId: string;
  resourceId: string;
  scheduledDate: string;
  reason: string;
  confidence: number;
}

interface DecisionTraceSummary {
  totalDrivingChange: number;
  totalSetupChange: number;
  workloadBalanceScore: number;
  riskScore: number;
  totalOrdersScheduled: number;
  estimatedEfficiency: number;
  baselineDrivingMinutes: number;
  baselineSetupMinutes: number;
  baselineOvertimeMinutes: number;
  proposedOvertimeMinutes: number;
  baselineWorkloadBalance: number;
  baselineRiskScore: number;
}

interface DecisionTraceMove {
  workOrderId: string;
  workOrderTitle: string;
  from: { resourceId: string | null; resourceName: string | null; day: string | null; startTime: string | null };
  to: { resourceId: string; resourceName: string; day: string; startTime: string | null };
  reasons: string[];
  constraintStatus: "valid" | "warning" | "violation";
  confidence: number;
}

interface ConstraintViolation {
  type: "hard" | "soft";
  category: string;
  severity: "critical" | "warning";
  workOrderId: string;
  resourceId?: string;
  description: string;
}

interface AutoScheduleResult {
  assignments: ScheduleAssignment[];
  summary: string;
  totalOrdersScheduled: number;
  estimatedEfficiency: number;
  decisionTrace?: {
    summary: DecisionTraceSummary;
    moves: DecisionTraceMove[];
    constraintViolations: ConstraintViolation[];
    riskFactors: string[];
  };
}

interface RouteStop {
  workOrderId: string;
  objectId: string;
  objectName: string;
  latitude?: number;
  longitude?: number;
  estimatedDuration: number;
}

interface OptimizedRoute {
  resourceId: string;
  resourceName: string;
  date: string;
  stops: RouteStop[];
  totalDriveTime: number;
  totalWorkTime: number;
  totalDistance: number;
  optimizationScore: number;
  originalDriveTime: number;
  originalDistance: number;
  timeSaved: number;
  distanceSaved: number;
  estimatedFuelSaved: number;
  estimatedCostSaved: number;
}

interface DayRouteOptimization {
  date: string;
  routes: OptimizedRoute[];
  totalSavings: number;
  totalDistanceSaved: number;
  totalFuelSaved: number;
  totalCostSaved: number;
  summary: string;
}

interface WorkloadWarning {
  id: string;
  type: "overload" | "underload" | "imbalance" | "peak";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  affectedResourceId?: string;
  affectedResourceName?: string;
  affectedDate?: string;
  suggestion: string;
}

interface WorkloadAnalysis {
  warnings: WorkloadWarning[];
  overallBalance: number;
  summary: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  data?: {
    orders?: Array<{ id: string; title: string; status: string; resourceName?: string; scheduledDate?: string }>;
    resources?: Array<{ id: string; name: string; orderCount: number }>;
  };
  suggestedActions?: Array<{
    label: string;
    action: string;
    params: Record<string, unknown>;
  }>;
  followUpQuestions?: string[];
  timestamp: Date;
}

interface AISuggestionsPanelProps {
  weekStart: string;
  weekEnd: string;
  selectedDate?: string;
  onApplySuggestion?: (suggestion: PlanningSuggestion) => void;
  onScheduleApplied?: () => void;
}

const priorityColors: Record<string, string> = {
  high: "bg-red-500/20 text-red-700 dark:text-red-300",
  medium: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  low: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
};

const typeIcons: Record<string, string> = {
  move: "Flytta",
  swap: "Byt",
  balance: "Balansera",
  warning: "Varning",
};

export function AISuggestionsPanel({ weekStart, weekEnd, selectedDate, onApplySuggestion, onScheduleApplied }: AISuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<PlanningSuggestion[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [autoScheduleResult, setAutoScheduleResult] = useState<AutoScheduleResult | null>(null);
  const [routeResult, setRouteResult] = useState<DayRouteOptimization | null>(null);
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [showMapForRoute, setShowMapForRoute] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [workloadAnalysis, setWorkloadAnalysis] = useState<WorkloadAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState<"auto-schedule" | "routes" | "suggestions" | "varningar" | "chat">("chat");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hej! Jag är din AI-planeringsassistent. Du kan ställa frågor på naturligt språk, t.ex. \"Visa alla försenade ordrar\" eller \"Vilken resurs har minst arbete?\"",
      followUpQuestions: ["Visa alla ordrar denna vecka", "Vilka resurser har flest ordrar?", "Finns det oschemalagda ordrar?"],
      timestamp: new Date()
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const currentDate = selectedDate || weekStart;
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/planning-suggestions", {
        weekStart,
        weekEnd,
      });
      return response.json();
    },
    onSuccess: (data: PlanningSuggestion[]) => {
      setSuggestions(data);
      setAppliedIds(new Set());
      if (data.length === 0) {
        toast({
          title: "Inga förslag",
          description: "Planeringen ser bra ut just nu!",
        });
      }
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte generera AI-förslag. Försök igen.",
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
    onSuccess: (data: AutoScheduleResult) => {
      setAutoScheduleResult(data);
      if (data.totalOrdersScheduled === 0) {
        toast({
          title: "Inga oschemalagda ordrar",
          description: "Alla ordrar är redan schemalagda!",
        });
      }
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte generera schemaläggning. Försök igen.",
        variant: "destructive",
      });
    },
  });

  const applyScheduleAllMutation = useMutation({
    mutationFn: async (assignments: ScheduleAssignment[]) => {
      const response = await apiRequest("POST", "/api/ai/auto-schedule/apply", {
        assignments: assignments.map(a => ({
          workOrderId: a.workOrderId,
          resourceId: a.resourceId,
          scheduledDate: a.scheduledDate,
        })),
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Schemaläggning tillämpad",
        description: `${data.applied} av ${data.total} ordrar schemalagda.`,
      });
      setAutoScheduleResult(null);
      onScheduleApplied?.();
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte tillämpa schemaläggningen.",
        variant: "destructive",
      });
    },
  });

  const applySingleMoveMutation = useMutation({
    mutationFn: async (assignment: ScheduleAssignment) => {
      const response = await apiRequest("POST", "/api/ai/auto-schedule/apply", {
        assignments: [{
          workOrderId: assignment.workOrderId,
          resourceId: assignment.resourceId,
          scheduledDate: assignment.scheduledDate,
        }],
      });
      const data = await response.json();
      return { ...data, appliedWorkOrderId: assignment.workOrderId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Order schemalagd",
        description: `1 order tillämpad.`,
      });
      setAutoScheduleResult(prev => {
        if (!prev) return null;
        const newAssignments = prev.assignments.filter(a => a.workOrderId !== data.appliedWorkOrderId);
        const newTrace = prev.decisionTrace ? {
          ...prev.decisionTrace,
          moves: prev.decisionTrace.moves.filter(m => m.workOrderId !== data.appliedWorkOrderId),
        } : undefined;
        if (newAssignments.length === 0) return null;
        return { ...prev, assignments: newAssignments, decisionTrace: newTrace };
      });
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte tillämpa ordern.",
        variant: "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (suggestion: PlanningSuggestion) => {
      if (suggestion.workOrderId && suggestion.toResourceId && suggestion.toDate) {
        await apiRequest("PATCH", `/api/work-orders/${suggestion.workOrderId}`, {
          resourceId: suggestion.toResourceId,
          scheduledDate: suggestion.toDate,
        });
      }
      return suggestion;
    },
    onSuccess: (suggestion) => {
      setAppliedIds((prev) => new Set(Array.from(prev).concat(suggestion.id)));
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Förslag tillämpat",
        description: suggestion.title,
      });
      onApplySuggestion?.(suggestion);
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte tillämpa förslaget.",
        variant: "destructive",
      });
    },
  });

  const routeOptimizeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/optimize-routes", {
        date: currentDate,
      });
      return response.json();
    },
    onSuccess: (data: DayRouteOptimization) => {
      setRouteResult(data);
      if (data.routes.length === 0) {
        toast({
          title: "Inga rutter att optimera",
          description: "Inga ordrar med koordinater hittades.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte optimera rutter.",
        variant: "destructive",
      });
    },
  });

  const workloadMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/workload-analysis", {
        weekStart,
        weekEnd,
      });
      return response.json();
    },
    onSuccess: (data: WorkloadAnalysis) => {
      setWorkloadAnalysis(data);
      if (data.warnings.length === 0) {
        toast({
          title: "Ingen obalans",
          description: "Arbetsbelastningen är välbalanserad!",
        });
      }
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte analysera arbetsbelastning.",
        variant: "destructive",
      });
    },
  });

  const dismissSuggestion = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  const chatMutation = useMutation({
    mutationFn: async (query: string) => {
      const response = await apiRequest("POST", "/api/ai/planner-chat", {
        query,
        weekStart,
        weekEnd,
      });
      return response.json();
    },
    onSuccess: (data) => {
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: data.message,
        data: data.data,
        suggestedActions: data.suggestedActions,
        followUpQuestions: data.followUpQuestions,
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, assistantMessage]);
    },
    onError: () => {
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: "Ett fel uppstod. Försök igen.",
        followUpQuestions: ["Visa alla ordrar", "Vilka resurser finns?"],
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, errorMessage]);
    },
  });

  const executeActionMutation = useMutation({
    mutationFn: async (params: { action: string; params: Record<string, unknown> }) => {
      const response = await apiRequest("POST", "/api/ai/planner-chat/execute", {
        action: params.action,
        ...params.params,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      const confirmMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, confirmMessage]);
      toast({
        title: "Åtgärd utförd",
        description: data.message,
      });
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte utföra åtgärden.",
        variant: "destructive",
      });
    },
  });

  const handleChatSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatMutation.isPending) return;
    
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: chatInput,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, userMessage]);
    chatMutation.mutate(chatInput);
    setChatInput("");
  };

  const handleFollowUpQuestion = (question: string) => {
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: question,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, userMessage]);
    chatMutation.mutate(question);
  };

  const toggleRoute = (resourceId: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      return next;
    });
  };

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <Card className="h-full flex flex-col border-0 rounded-none shadow-none">
      <CardHeader className="pb-3 pt-2">
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant={activeTab === "auto-schedule" ? "default" : "ghost"}
            onClick={() => setActiveTab("auto-schedule")}
            className="text-xs whitespace-nowrap"
            data-testid="tab-auto-schedule"
          >
            <Zap className="h-3 w-3 mr-1" />
            Auto-schema
          </Button>
          <Button
            size="sm"
            variant={activeTab === "routes" ? "default" : "ghost"}
            onClick={() => setActiveTab("routes")}
            className="text-xs whitespace-nowrap"
            data-testid="tab-routes"
          >
            <Route className="h-3 w-3 mr-1" />
            Rutter
          </Button>
          <Button
            size="sm"
            variant={activeTab === "suggestions" ? "default" : "ghost"}
            onClick={() => setActiveTab("suggestions")}
            className="text-xs whitespace-nowrap"
            data-testid="tab-suggestions"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Förslag
          </Button>
          <Button
            size="sm"
            variant={activeTab === "varningar" ? "default" : "ghost"}
            onClick={() => setActiveTab("varningar")}
            className="text-xs whitespace-nowrap"
            data-testid="tab-varningar"
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Varningar
            {workloadAnalysis && workloadAnalysis.warnings.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                {workloadAnalysis.warnings.length}
              </Badge>
            )}
          </Button>
          <Button
            size="sm"
            variant={activeTab === "chat" ? "default" : "ghost"}
            onClick={() => setActiveTab("chat")}
            className="text-xs whitespace-nowrap"
            data-testid="tab-chat"
          >
            <MessageSquare className="h-3 w-3 mr-1" />
            AI Chatt
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 overflow-auto">
        {activeTab === "auto-schedule" && (
          <>
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => autoScheduleMutation.mutate()}
                disabled={autoScheduleMutation.isPending}
                className="w-full"
                data-testid="button-auto-schedule"
              >
                {autoScheduleMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Zap className="h-4 w-4 mr-2" />
                )}
                Schemalägg automatiskt
              </Button>
            </div>

            {autoScheduleMutation.isPending && (
              <div className="text-center py-6">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-purple-500" />
                <p className="text-sm text-muted-foreground">AI optimerar schemaläggning...</p>
              </div>
            )}

            {!autoScheduleResult && !autoScheduleMutation.isPending && (
              <div className="text-center py-6 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Klicka för att automatiskt schemalägga oschemalagda ordrar</p>
                <p className="text-xs mt-1">AI placerar ordrar baserat på kluster, kapacitet och prioritet</p>
              </div>
            )}

            {autoScheduleResult && (
              <ScheduleDiffView
                assignments={autoScheduleResult.assignments}
                summary={autoScheduleResult.summary}
                totalOrdersScheduled={autoScheduleResult.totalOrdersScheduled}
                estimatedEfficiency={autoScheduleResult.estimatedEfficiency}
                decisionTrace={autoScheduleResult.decisionTrace}
                onApplyAll={(assignments) => applyScheduleAllMutation.mutate(assignments)}
                onApplySingle={(assignment) => applySingleMoveMutation.mutate(assignment)}
                onRejectSingle={(workOrderId) => {
                  setAutoScheduleResult(prev => {
                    if (!prev) return prev;
                    const newAssignments = prev.assignments.filter(a => a.workOrderId !== workOrderId);
                    if (newAssignments.length === 0) return null;
                    return {
                      ...prev,
                      assignments: newAssignments,
                      totalOrdersScheduled: newAssignments.length,
                      decisionTrace: prev.decisionTrace ? {
                        ...prev.decisionTrace,
                        moves: prev.decisionTrace.moves.filter(m => m.workOrderId !== workOrderId),
                      } : undefined,
                    };
                  });
                }}
                onCancel={() => setAutoScheduleResult(null)}
                isApplying={applyScheduleAllMutation.isPending || applySingleMoveMutation.isPending}
              />
            )}
          </>
        )}

        {activeTab === "routes" && (
          <>
            <Button
              variant="outline"
              onClick={() => routeOptimizeMutation.mutate()}
              disabled={routeOptimizeMutation.isPending}
              className="w-full"
              data-testid="button-optimize-routes"
            >
              {routeOptimizeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <TrendingUp className="h-4 w-4 mr-2" />
              )}
              Optimera rutter för {currentDate}
            </Button>

            {routeOptimizeMutation.isPending && (
              <div className="text-center py-6">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-blue-500" />
                <p className="text-sm text-muted-foreground">Beräknar optimala rutter...</p>
              </div>
            )}

            {!routeResult && !routeOptimizeMutation.isPending && (
              <div className="text-center py-6 text-muted-foreground">
                <Route className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Optimera körordningen för dagens ordrar</p>
                <p className="text-xs mt-1">Minskar körtid genom geografisk gruppering</p>
              </div>
            )}

            {routeResult && routeResult.routes.length > 0 && (
              <div className="space-y-3">
                <Card className="p-3 bg-green-500/10 border-green-500/20">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-green-700 dark:text-green-300">Optimering klar</span>
                    {routeResult.totalCostSaved > 0 && (
                      <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">
                        ~{routeResult.totalCostSaved} kr sparad
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold">{formatTime(routeResult.totalSavings)}</p>
                      <p className="text-xs text-muted-foreground">tid sparad</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{routeResult.totalDistanceSaved} km</p>
                      <p className="text-xs text-muted-foreground">mindre körning</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{routeResult.totalFuelSaved} L</p>
                      <p className="text-xs text-muted-foreground">bränsle sparad</p>
                    </div>
                  </div>
                </Card>

                <div className="space-y-2">
                  {routeResult.routes.map((route) => {
                    const isExpanded = expandedRoutes.has(route.resourceId);
                    
                    return (
                      <Collapsible key={route.resourceId} open={isExpanded}>
                        <Card className="p-3">
                          <CollapsibleTrigger asChild>
                            <button
                              className="w-full flex items-center justify-between text-left"
                              onClick={() => toggleRoute(route.resourceId)}
                              data-testid={`route-toggle-${route.resourceId}`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm truncate">{route.resourceName}</span>
                                  <Badge variant="outline" className="text-xs shrink-0">
                                    {route.stops.length} stopp
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatTime(route.totalDriveTime)} kör
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {route.totalDistance} km
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right">
                                  <Progress value={route.optimizationScore} className="w-16 h-2" />
                                  <span className="text-xs text-muted-foreground">{route.optimizationScore}%</span>
                                </div>
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </div>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="mt-3 pt-3 border-t space-y-3">
                              {route.timeSaved > 0 && (
                                <div className="p-2 rounded bg-green-500/10 text-xs">
                                  <div className="flex items-center justify-between">
                                    <span>Före: {formatTime(route.originalDriveTime)}, {route.originalDistance} km</span>
                                    <ArrowRight className="h-3 w-3" />
                                    <span className="font-medium text-green-700 dark:text-green-300">
                                      Nu: {formatTime(route.totalDriveTime)}, {route.totalDistance} km
                                    </span>
                                  </div>
                                  <p className="text-green-600 dark:text-green-400 mt-1">
                                    Sparar {formatTime(route.timeSaved)} och {route.distanceSaved} km (~{route.estimatedCostSaved} kr)
                                  </p>
                                </div>
                              )}
                              <div>
                                <p className="text-xs font-medium mb-2">Optimerad körordning:</p>
                                <div className="space-y-1">
                                  {route.stops.map((stop, idx) => (
                                    <div key={stop.workOrderId} className="flex items-center gap-2 text-xs">
                                      <Badge variant="outline" className="h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                        {idx + 1}
                                      </Badge>
                                      <span className="truncate flex-1">{stop.objectName}</span>
                                      <span className="text-muted-foreground shrink-0">{stop.estimatedDuration} min</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="pt-2 flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">
                                  Total arbetstid: {formatTime(route.totalWorkTime)}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setShowMapForRoute(route.resourceId)}
                                  data-testid={`button-show-map-${route.resourceId}`}
                                >
                                  <Map className="h-3 w-3 mr-1" />
                                  Visa karta
                                </Button>
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    );
                  })}
                </div>

                {showMapForRoute && (
                  <div className="mt-3">
                    {(() => {
                      const selectedRoute = routeResult.routes.find(r => r.resourceId === showMapForRoute);
                      if (!selectedRoute) return null;
                      return (
                        <OptimizedRouteMap
                          stops={selectedRoute.stops}
                          resourceName={selectedRoute.resourceName}
                          onClose={() => setShowMapForRoute(null)}
                          expanded={mapExpanded}
                          onToggleExpand={() => setMapExpanded(!mapExpanded)}
                        />
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "suggestions" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="w-full"
              data-testid="button-generate-ai-suggestions"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Analysera planering
            </Button>

            {suggestions.length === 0 && !generateMutation.isPending && (
              <div className="text-center py-6 text-muted-foreground">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Klicka för AI-drivna planeringsförslag</p>
              </div>
            )}

            {generateMutation.isPending && (
              <div className="text-center py-6">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-purple-500" />
                <p className="text-sm text-muted-foreground">Analyserar planering...</p>
              </div>
            )}

            {suggestions.map((suggestion) => {
              const isApplied = appliedIds.has(suggestion.id);
              const canApply = suggestion.workOrderId && suggestion.toResourceId && suggestion.toDate;

              return (
                <Card
                  key={suggestion.id}
                  className={`p-3 ${isApplied ? "opacity-50" : ""}`}
                  data-testid={`ai-suggestion-${suggestion.id}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {typeIcons[suggestion.type]}
                        </Badge>
                        <Badge className={`text-xs ${priorityColors[suggestion.priority]}`}>
                          {suggestion.priority === "high" ? "Hög" : suggestion.priority === "medium" ? "Medium" : "Låg"}
                        </Badge>
                      </div>
                      {!isApplied && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => dismissSuggestion(suggestion.id)}
                          data-testid={`button-dismiss-${suggestion.id}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>

                    <div>
                      <h4 className="font-medium text-sm">{suggestion.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1">{suggestion.description}</p>
                    </div>

                    {suggestion.impact && (
                      <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <Clock className="h-3 w-3" />
                        {suggestion.impact}
                      </div>
                    )}

                    {suggestion.fromDate && suggestion.toDate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>{suggestion.fromDate}</span>
                        <ArrowRight className="h-3 w-3" />
                        <span>{suggestion.toDate}</span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      {isApplied ? (
                        <Badge variant="secondary" className="text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          Tillämpat
                        </Badge>
                      ) : canApply ? (
                        <Button
                          size="sm"
                          onClick={() => applyMutation.mutate(suggestion)}
                          disabled={applyMutation.isPending}
                          data-testid={`button-apply-${suggestion.id}`}
                        >
                          {applyMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Tillämpa
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Manuell åtgärd krävs
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </>
        )}

        {activeTab === "varningar" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => workloadMutation.mutate()}
              disabled={workloadMutation.isPending}
              className="w-full"
              data-testid="button-analyze-workload"
            >
              {workloadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <AlertTriangle className="h-4 w-4 mr-2" />
              )}
              Analysera arbetsbelastning
            </Button>

            {workloadMutation.isPending && (
              <div className="text-center py-6">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-orange-500" />
                <p className="text-sm text-muted-foreground">Analyserar balans...</p>
              </div>
            )}

            {!workloadMutation.isPending && !workloadAnalysis && (
              <div className="text-center py-6 text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Klicka för att hitta obalanser i planeringen</p>
              </div>
            )}

            {workloadAnalysis && (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <span className="text-sm font-medium">Balanspoäng</span>
                  <div className="flex items-center gap-2">
                    <Progress value={workloadAnalysis.overallBalance} className="w-16 h-2" />
                    <span className={`text-sm font-bold ${
                      workloadAnalysis.overallBalance >= 80 ? "text-green-600 dark:text-green-400" :
                      workloadAnalysis.overallBalance >= 50 ? "text-yellow-600 dark:text-yellow-400" :
                      "text-red-600 dark:text-red-400"
                    }`}>
                      {workloadAnalysis.overallBalance}%
                    </span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{workloadAnalysis.summary}</p>

                {workloadAnalysis.warnings.length === 0 ? (
                  <div className="text-center py-4 text-green-600 dark:text-green-400">
                    <Check className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">Planeringen är välbalanserad!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workloadAnalysis.warnings.map((warning) => (
                      <Card key={warning.id} className="p-3" data-testid={`warning-${warning.id}`}>
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge 
                                variant={warning.severity === "high" ? "destructive" : "outline"}
                                className="text-xs"
                              >
                                {warning.severity === "high" ? "Allvarlig" : 
                                 warning.severity === "medium" ? "Medel" : "Mindre"}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {warning.type === "overload" ? "Överbelastning" :
                                 warning.type === "underload" ? "Underbelastning" :
                                 warning.type === "imbalance" ? "Obalans" : "Topptryck"}
                              </Badge>
                            </div>
                          </div>

                          <div>
                            <h4 className="font-medium text-sm">{warning.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{warning.description}</p>
                          </div>

                          {warning.affectedDate && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {warning.affectedDate}
                            </div>
                          )}

                          <div className="p-2 rounded bg-blue-500/10 text-xs text-blue-700 dark:text-blue-300">
                            <strong>Förslag:</strong> {warning.suggestion}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "chat" && (
          <div className="flex flex-col h-[calc(100vh-280px)] min-h-[300px]">
            <div className="flex-1 overflow-y-auto space-y-3 pr-2">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`chat-message-${msg.id}`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-3 w-3 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg p-3 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    
                    {msg.data?.orders && msg.data.orders.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.data.orders.slice(0, 5).map((order) => (
                          <div
                            key={order.id}
                            className="text-xs p-2 rounded bg-background/50 flex items-center gap-2"
                          >
                            <Calendar className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{order.title}</span>
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              {order.status}
                            </Badge>
                          </div>
                        ))}
                        {msg.data.orders.length > 5 && (
                          <p className="text-xs text-muted-foreground">
                            +{msg.data.orders.length - 5} till...
                          </p>
                        )}
                      </div>
                    )}
                    
                    {msg.data?.resources && msg.data.resources.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.data.resources.map((resource) => (
                          <div
                            key={resource.id}
                            className="text-xs p-2 rounded bg-background/50 flex items-center justify-between"
                          >
                            <span>{resource.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {resource.orderCount} ordrar
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {msg.suggestedActions.map((action, idx) => (
                          <Button
                            key={idx}
                            size="sm"
                            variant="default"
                            className="text-xs"
                            onClick={() => executeActionMutation.mutate({ action: action.action, params: action.params })}
                            disabled={executeActionMutation.isPending}
                            data-testid={`chat-action-${idx}`}
                          >
                            {executeActionMutation.isPending ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Zap className="h-3 w-3 mr-1" />
                            )}
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    )}

                    {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {msg.followUpQuestions.map((q, idx) => (
                          <Button
                            key={idx}
                            size="sm"
                            variant="ghost"
                            className="text-xs h-auto py-1"
                            onClick={() => handleFollowUpQuestion(q)}
                            disabled={chatMutation.isPending}
                            data-testid={`chat-followup-${idx}`}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <User className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="flex gap-2 justify-start">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg p-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            
            <form onSubmit={handleChatSubmit} className="mt-3 flex gap-2" data-testid="chat-form">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ställ en fråga om planeringen..."
                className="flex-1 text-sm"
                disabled={chatMutation.isPending}
                data-testid="chat-input"
              />
              <Button
                type="submit"
                size="icon"
                disabled={!chatInput.trim() || chatMutation.isPending}
                data-testid="chat-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
