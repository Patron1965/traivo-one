import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ArrowRight, Clock, Check, X, RefreshCw, Zap, Calendar, Route, MapPin, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

interface AutoScheduleResult {
  assignments: ScheduleAssignment[];
  summary: string;
  totalOrdersScheduled: number;
  estimatedEfficiency: number;
}

interface RouteStop {
  workOrderId: string;
  objectId: string;
  objectName: string;
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
  const [activeTab, setActiveTab] = useState<"auto-schedule" | "routes" | "suggestions">("auto-schedule");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const currentDate = selectedDate || weekStart;

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

  const applyScheduleMutation = useMutation({
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

  const dismissSuggestion = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
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
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-purple-500" />
            AI Planeringsassistent
          </CardTitle>
        </div>
        <div className="flex gap-1 pt-2">
          <Button
            size="sm"
            variant={activeTab === "auto-schedule" ? "default" : "ghost"}
            onClick={() => setActiveTab("auto-schedule")}
            className="text-xs"
            data-testid="tab-auto-schedule"
          >
            <Zap className="h-3 w-3 mr-1" />
            Auto-schema
          </Button>
          <Button
            size="sm"
            variant={activeTab === "routes" ? "default" : "ghost"}
            onClick={() => setActiveTab("routes")}
            className="text-xs"
            data-testid="tab-routes"
          >
            <Route className="h-3 w-3 mr-1" />
            Rutter
          </Button>
          <Button
            size="sm"
            variant={activeTab === "suggestions" ? "default" : "ghost"}
            onClick={() => setActiveTab("suggestions")}
            className="text-xs"
            data-testid="tab-suggestions"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Förslag
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 overflow-auto">
        {activeTab === "auto-schedule" && (
          <>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => autoScheduleMutation.mutate()}
                disabled={autoScheduleMutation.isPending}
                className="flex-1"
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
              <div className="space-y-4">
                <Card className="p-3 bg-muted/50">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Effektivitet</span>
                      <span className="text-sm text-muted-foreground">{autoScheduleResult.estimatedEfficiency}%</span>
                    </div>
                    <Progress value={autoScheduleResult.estimatedEfficiency} className="h-2" />
                    <p className="text-xs text-muted-foreground">{autoScheduleResult.summary}</p>
                  </div>
                </Card>

                {autoScheduleResult.assignments.length > 0 && (
                  <>
                    <div className="text-sm font-medium">
                      {autoScheduleResult.assignments.length} ordrar att schemalägga:
                    </div>
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {autoScheduleResult.assignments.map((assignment) => (
                        <Card key={assignment.workOrderId} className="p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-mono truncate">{assignment.workOrderId.slice(0, 8)}...</p>
                              <p className="text-xs text-muted-foreground truncate">{assignment.reason}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Badge variant="outline" className="text-xs">
                                {assignment.scheduledDate}
                              </Badge>
                              <Badge 
                                variant="secondary" 
                                className={`text-xs ${assignment.confidence >= 80 ? "bg-green-500/20" : assignment.confidence >= 60 ? "bg-yellow-500/20" : "bg-orange-500/20"}`}
                              >
                                {assignment.confidence}%
                              </Badge>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => applyScheduleMutation.mutate(autoScheduleResult.assignments)}
                        disabled={applyScheduleMutation.isPending}
                        className="flex-1"
                        data-testid="button-apply-auto-schedule"
                      >
                        {applyScheduleMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Check className="h-4 w-4 mr-2" />
                        )}
                        Tillämpa alla ({autoScheduleResult.assignments.length})
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setAutoScheduleResult(null)}
                        disabled={applyScheduleMutation.isPending}
                        data-testid="button-cancel-auto-schedule"
                      >
                        Avbryt
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "routes" && (
          <>
            <Button
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
                              <div className="pt-2 text-xs text-muted-foreground">
                                Total arbetstid: {formatTime(route.totalWorkTime)}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    );
                  })}
                </div>
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
      </CardContent>
    </Card>
  );
}
