import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Route, Clock, MapPin, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface RouteStop {
  workOrderId: string;
  objectId: string;
  objectName: string;
  latitude: number;
  longitude: number;
  estimatedDuration: number;
  priority: string;
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
  originalOrder: string[];
  optimizedOrder: string[];
}

interface DayRouteOptimization {
  date: string;
  routes: OptimizedRoute[];
  totalSavings: number;
  summary: string;
}

interface RouteOptimizationPanelProps {
  selectedDate: string;
}

export function RouteOptimizationPanel({ selectedDate }: RouteOptimizationPanelProps) {
  const [result, setResult] = useState<DayRouteOptimization | null>(null);
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const optimizeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/optimize-routes", {
        date: selectedDate,
      });
      return response.json();
    },
    onSuccess: (data: DayRouteOptimization) => {
      setResult(data);
      if (data.routes.length === 0) {
        toast({
          title: "Inga rutter att optimera",
          description: "Det finns inga schemalagda ordrar med koordinater för detta datum.",
        });
      }
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte optimera rutter. Försök igen.",
        variant: "destructive",
      });
    },
  });

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
        <CardTitle className="flex items-center gap-2 text-base">
          <Route className="h-5 w-5 text-blue-500" />
          Ruttoptimering
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 overflow-auto">
        <Button
          onClick={() => optimizeMutation.mutate()}
          disabled={optimizeMutation.isPending}
          className="w-full"
          data-testid="button-optimize-routes"
        >
          {optimizeMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <TrendingUp className="h-4 w-4 mr-2" />
          )}
          Optimera rutter för {selectedDate}
        </Button>

        {optimizeMutation.isPending && (
          <div className="text-center py-6">
            <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">Beräknar optimala rutter...</p>
          </div>
        )}

        {!result && !optimizeMutation.isPending && (
          <div className="text-center py-6 text-muted-foreground">
            <Route className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Optimera körordningen för dagens arbetsordrar</p>
            <p className="text-xs mt-1">Minskar körtid genom geografisk gruppering</p>
          </div>
        )}

        {result && result.routes.length > 0 && (
          <div className="space-y-3">
            <Card className="p-3 bg-muted/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Resultat</span>
                {result.totalSavings > 0 && (
                  <Badge variant="secondary" className="bg-green-500/20 text-green-700 dark:text-green-300">
                    ~{formatTime(result.totalSavings)} sparad
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{result.summary}</p>
            </Card>

            <div className="space-y-2">
              {result.routes.map((route) => {
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
                              <Progress 
                                value={route.optimizationScore} 
                                className="w-16 h-2" 
                              />
                              <span className="text-xs text-muted-foreground">{route.optimizationScore}%</span>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </div>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <p className="text-xs font-medium">Optimerad körordning:</p>
                          <div className="space-y-1">
                            {route.stops.map((stop, idx) => (
                              <div 
                                key={stop.workOrderId}
                                className="flex items-center gap-2 text-xs"
                              >
                                <Badge variant="outline" className="h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                  {idx + 1}
                                </Badge>
                                <span className="truncate flex-1">{stop.objectName}</span>
                                <span className="text-muted-foreground shrink-0">
                                  {stop.estimatedDuration} min
                                </span>
                              </div>
                            ))}
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
      </CardContent>
    </Card>
  );
}
