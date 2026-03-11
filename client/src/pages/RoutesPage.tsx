import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RouteMap } from "@/components/RouteMap";
import { OptimizedRouteMap } from "@/components/OptimizedRouteMap";
import { AICard } from "@/components/AICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, TrendingUp, Clock, MapPin, Route as RouteIcon, Truck, AlertCircle, Check, Map, Cloud, CloudRain, Wind, Thermometer, Lightbulb } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Cluster } from "@shared/schema";

interface Recommendation {
  type: "weather" | "optimization" | "capacity" | "historical";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionable?: string;
}

interface RouteRecommendations {
  date: string;
  weather: {
    temperature: number;
    precipitation: number;
    windSpeed: number;
    description: string;
    impact: string;
    capacityMultiplier: number;
  } | null;
  statistics: {
    totalOrders: number;
    assignedOrders: number;
    activeResources: number;
    avgDurationMinutes: number;
  };
  recommendations: Recommendation[];
  summary: string;
}

interface VRPRoute {
  resourceId: string;
  resourceName: string;
  stops: Array<{
    orderId: string;
    orderTitle: string;
    sequence: number;
    serviceMinutes: number;
    waitingMinutes: number;
    location: { lat: number; lng: number };
  }>;
  totalDurationMinutes: number;
  totalDistanceKm: number;
  totalServiceMinutes: number;
  efficiency: number;
  geometry?: string;
}

interface VRPResult {
  success: boolean;
  routes: VRPRoute[];
  unassignedOrders: Array<{ orderId: string; reason: string }>;
  summary: {
    totalOrders: number;
    assignedOrders: number;
    totalDurationMinutes: number;
    totalDistanceKm: number;
    avgEfficiency: number;
  };
  error?: string;
}

interface CurrentRouteStats {
  totalOrders: number;
  totalDurationMinutes: number;
  totalDistanceKm: number;
  avgEfficiency: number;
  resourceCount: number;
}

export default function RoutesPage() {
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [selectedCluster, setSelectedCluster] = useState<string>("all");
  const [vrpResult, setVrpResult] = useState<VRPResult | null>(null);
  const [currentStats, setCurrentStats] = useState<CurrentRouteStats | null>(null);
  const [selectedRouteForMap, setSelectedRouteForMap] = useState<VRPRoute | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const { toast } = useToast();

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const { data: recommendations, isLoading: recommendationsLoading } = useQuery<RouteRecommendations>({
    queryKey: ["/api/ai/route-recommendations", selectedDate],
    queryFn: async () => {
      const response = await fetch(`/api/ai/route-recommendations?date=${selectedDate}`);
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const vrpMutation = useMutation({
    mutationFn: async () => {
      const body: { date?: string; clusterId?: string } = {};
      if (selectedDate) body.date = selectedDate;
      if (selectedCluster && selectedCluster !== "all") body.clusterId = selectedCluster;

      try {
        const statsRes = await apiRequest("GET", `/api/ai/route-recommendations?date=${selectedDate}`);
        const statsData = await statsRes.json();
        if (statsData?.statistics) {
          setCurrentStats({
            totalOrders: statsData.statistics.totalOrders || 0,
            totalDurationMinutes: (statsData.statistics.totalOrders || 0) * (statsData.statistics.avgDurationMinutes || 60),
            totalDistanceKm: Math.round((statsData.statistics.totalOrders || 0) * 3.5),
            avgEfficiency: statsData.statistics.totalOrders > 0 ? 65 : 0,
            resourceCount: statsData.statistics.activeResources || 0,
          });
        }
      } catch {
        setCurrentStats(null);
      }
      
      const response = await apiRequest("POST", "/api/ai/optimize-vrp", body);
      return response.json() as Promise<VRPResult>;
    },
    onSuccess: (data) => {
      setVrpResult(data);
      if (data.success) {
        toast({
          title: "Ruttoptimering klar",
          description: `${data.summary.assignedOrders} av ${data.summary.totalOrders} ordrar tilldelade med ${data.summary.avgEfficiency}% effektivitet`,
        });
      } else {
        toast({
          title: "Optimering misslyckades",
          description: data.error || "Något gick fel",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Fel vid optimering",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (routes: VRPRoute[]) => {
      const payload = {
        routes: routes.map(r => ({
          resourceId: r.resourceId,
          stops: r.stops.map(s => ({
            orderId: s.orderId,
            sequence: s.sequence,
          })),
        })),
      };
      const response = await apiRequest("POST", "/api/ai/optimize-vrp/apply", payload);
      return response.json();
    },
    onSuccess: (data: { applied: number; total: number; message: string }) => {
      toast({
        title: "Optimering tillämpad",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Fel vid tillämpning",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="h-full p-6 flex flex-col gap-4 overflow-auto">
      <div>
        <h1 className="text-2xl font-semibold">Ruttplanering</h1>
        <p className="text-sm text-muted-foreground">Optimera dagens rutter och minimera körtid</p>
      </div>
      
      {recommendations && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recommendations.weather && (
            <Card className="hover-elevate" data-testid="card-weather-info">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {recommendations.weather.precipitation > 5 ? (
                    <CloudRain className="h-4 w-4 text-blue-500" />
                  ) : (
                    <Cloud className="h-4 w-4 text-muted-foreground" />
                  )}
                  Väder {selectedDate}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Thermometer className="h-3 w-3" />
                    {Math.round(recommendations.weather.temperature)}°C
                  </span>
                  <span className="flex items-center gap-1">
                    <CloudRain className="h-3 w-3" />
                    {recommendations.weather.precipitation} mm
                  </span>
                  <span className="flex items-center gap-1">
                    <Wind className="h-3 w-3" />
                    {Math.round(recommendations.weather.windSpeed)} m/s
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{recommendations.weather.description}</p>
                {recommendations.weather.impact !== "none" && (
                  <Badge 
                    variant={recommendations.weather.impact === "severe" || recommendations.weather.impact === "high" ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    Kapacitet: {Math.round(recommendations.weather.capacityMultiplier * 100)}%
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}
          
          {recommendations?.recommendations?.length > 0 && (
            <Card className="hover-elevate" data-testid="card-ai-recommendations">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  AI-rekommendationer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {recommendations.recommendations.slice(0, 3).map((rec, idx) => (
                  <div key={idx} className="text-sm border-l-2 pl-2" style={{
                    borderColor: rec.priority === "high" ? "hsl(var(--destructive))" 
                      : rec.priority === "medium" ? "hsl(var(--chart-3))" 
                      : "hsl(var(--muted-foreground))"
                  }}>
                    <p className="font-medium">{rec.title}</p>
                    <p className="text-xs text-muted-foreground">{rec.description}</p>
                    {rec.actionable && (
                      <Badge variant="outline" className="text-xs mt-1">{rec.actionable}</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            VRP-optimering (VROOM)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Datum</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-[160px]"
                data-testid="input-vrp-date"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Kluster</label>
              <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                <SelectTrigger className="w-[180px]" data-testid="select-vrp-cluster">
                  <SelectValue placeholder="Alla kluster" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla kluster</SelectItem>
                  {clusters.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => vrpMutation.mutate()}
                  disabled={vrpMutation.isPending}
                  data-testid="button-run-vrp"
                >
                  {vrpMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RouteIcon className="h-4 w-4 mr-2" />
                  )}
                  Kör VRP-optimering
                </Button>
              </TooltipTrigger>
              <TooltipContent>Optimera rutter med VROOM-algoritmen</TooltipContent>
            </Tooltip>
          </div>

          {vrpResult && (
            <div className="space-y-4">
              {!vrpResult.success ? (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {vrpResult.error}
                </div>
              ) : (
                <>
                  {currentStats && (
                    <Card className="border-dashed" data-testid="route-comparison">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <RouteIcon className="h-4 w-4" />
                          Före / Efter jämförelse
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nuvarande</p>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Ordrar</span>
                                <span>{currentStats.totalOrders}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Tid</span>
                                <span>{currentStats.totalDurationMinutes} min</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Distans</span>
                                <span>{currentStats.totalDistanceKm} km</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Effektivitet</span>
                                <span>{currentStats.avgEfficiency}%</span>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2 border-l pl-4">
                            <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Optimerad</p>
                            <div className="space-y-1.5 text-sm">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Ordrar</span>
                                <span>{vrpResult.summary.assignedOrders}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Tid</span>
                                <span className="font-medium">
                                  {vrpResult.summary.totalDurationMinutes} min
                                  {currentStats.totalDurationMinutes > vrpResult.summary.totalDurationMinutes && (
                                    <Badge variant="secondary" className="ml-1 text-[10px] text-green-600">
                                      -{currentStats.totalDurationMinutes - vrpResult.summary.totalDurationMinutes} min
                                    </Badge>
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Distans</span>
                                <span className="font-medium">
                                  {vrpResult.summary.totalDistanceKm} km
                                  {currentStats.totalDistanceKm > vrpResult.summary.totalDistanceKm && (
                                    <Badge variant="secondary" className="ml-1 text-[10px] text-green-600">
                                      -{currentStats.totalDistanceKm - vrpResult.summary.totalDistanceKm} km
                                    </Badge>
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Effektivitet</span>
                                <span className="font-medium">
                                  {vrpResult.summary.avgEfficiency}%
                                  {vrpResult.summary.avgEfficiency > currentStats.avgEfficiency && (
                                    <Badge variant="secondary" className="ml-1 text-[10px] text-green-600">
                                      +{vrpResult.summary.avgEfficiency - currentStats.avgEfficiency}%
                                    </Badge>
                                  )}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="vrp-summary-grid">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-muted rounded-md p-3 text-center hover-elevate cursor-help" data-testid="stat-assigned-orders">
                          <div className="text-xl font-semibold">{vrpResult.summary.assignedOrders}</div>
                          <div className="text-xs text-muted-foreground">Tilldelade ordrar</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Antal ordrar som tilldelades en rutt</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-muted rounded-md p-3 text-center hover-elevate cursor-help" data-testid="stat-routes-count">
                          <div className="text-xl font-semibold">{vrpResult.routes.length}</div>
                          <div className="text-xs text-muted-foreground">Rutter</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Antal genererade rutter</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-muted rounded-md p-3 text-center hover-elevate cursor-help" data-testid="stat-total-duration">
                          <div className="text-xl font-semibold flex items-center justify-center gap-1">
                            <Clock className="h-4 w-4" />
                            {vrpResult.summary.totalDurationMinutes}
                          </div>
                          <div className="text-xs text-muted-foreground">Total tid (min)</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Total tid inkl. körning och service</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-muted rounded-md p-3 text-center hover-elevate cursor-help" data-testid="stat-total-distance">
                          <div className="text-xl font-semibold flex items-center justify-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {vrpResult.summary.totalDistanceKm}
                          </div>
                          <div className="text-xs text-muted-foreground">Total distans (km)</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Total körsträcka för alla rutter</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-muted rounded-md p-3 text-center hover-elevate cursor-help" data-testid="stat-efficiency">
                          <div className="text-xl font-semibold flex items-center justify-center gap-1">
                            <TrendingUp className="h-4 w-4" />
                            {vrpResult.summary.avgEfficiency}%
                          </div>
                          <div className="text-xs text-muted-foreground">Effektivitet</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>Andel arbetsminuter av total tid</TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {vrpResult.unassignedOrders.length > 0 && (
                      <div className="text-sm text-orange-600 dark:text-orange-400">
                        {vrpResult.unassignedOrders.length} ordrar kunde inte tilldelas
                      </div>
                    )}
                    <div className="flex-1" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={() => applyMutation.mutate(vrpResult.routes)}
                          disabled={applyMutation.isPending || vrpResult.routes.length === 0}
                          variant="default"
                          data-testid="button-apply-vrp"
                        >
                          {applyMutation.isPending ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4 mr-2" />
                          )}
                          Tillämpa optimering
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Spara de optimerade rutterna till planeringen</TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="space-y-3" data-testid="vrp-routes-list">
                    {vrpResult.routes.map((route, idx) => (
                      <Card key={route.resourceId || idx} className="p-3 hover-elevate" data-testid={`vrp-route-${route.resourceId || idx}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium text-sm" data-testid={`text-resource-${route.resourceId || idx}`}>
                              {route.resourceName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setSelectedRouteForMap(selectedRouteForMap?.resourceId === route.resourceId ? null : route)}
                                  data-testid={`button-show-map-${route.resourceId || idx}`}
                                >
                                  <Map className="h-3 w-3 mr-1" />
                                  {selectedRouteForMap?.resourceId === route.resourceId ? "Dölj karta" : "Visa karta"}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Visa rutten på kartan</TooltipContent>
                            </Tooltip>
                            <Badge variant="secondary" className="text-xs no-default-hover-elevate">
                              {route.stops.length} stopp
                            </Badge>
                            <Badge variant="outline" className="text-xs no-default-hover-elevate">
                              {route.totalDistanceKm} km
                            </Badge>
                            <Badge variant="outline" className="text-xs no-default-hover-elevate">
                              {route.efficiency}% eff
                            </Badge>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                          {route.stops.map((stop, stopIdx) => (
                            <span key={stop.orderId} className="flex items-center gap-1" data-testid={`stop-${stop.orderId}`}>
                              <span className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded text-[10px]">
                                {stopIdx + 1}
                              </span>
                              <span className="truncate max-w-[120px]">{stop.orderTitle}</span>
                              {stopIdx < route.stops.length - 1 && <span className="mx-1">-</span>}
                            </span>
                          ))}
                        </div>
                        {selectedRouteForMap?.resourceId === route.resourceId && (
                          <div className="mt-3">
                            <OptimizedRouteMap
                              stops={route.stops.map(s => ({
                                workOrderId: s.orderId,
                                objectId: s.orderId,
                                objectName: s.orderTitle,
                                latitude: s.location.lat,
                                longitude: s.location.lng,
                                estimatedDuration: s.serviceMinutes,
                              }))}
                              resourceName={route.resourceName}
                              onClose={() => setSelectedRouteForMap(null)}
                              expanded={mapExpanded}
                              onToggleExpand={() => setMapExpanded(!mapExpanded)}
                            />
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      <div className="flex-1 min-h-[400px]">
        <RouteMap />
      </div>
    </div>
  );
}
