import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RouteMap } from "@/components/RouteMap";
import { OptimizedRouteMap } from "@/components/OptimizedRouteMap";
import { AICard } from "@/components/AICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, TrendingUp, Clock, MapPin, Route as RouteIcon, Truck, AlertCircle, AlertTriangle, Check, Map, CloudRain, Wind, Thermometer, Monitor } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
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

interface CurrentRouteJob {
  resourceName: string;
  resourceId: string;
  orders: Array<{ title: string; address: string }>;
}

export default function RoutesPage() {
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [selectedCluster, setSelectedCluster] = useState<string>("all");
  const [vrpResult, setVrpResult] = useState<VRPResult | null>(null);
  const [currentStats, setCurrentStats] = useState<CurrentRouteStats | null>(null);
  const [currentRoutes, setCurrentRoutes] = useState<CurrentRouteJob[]>([]);
  const [selectedRouteForMap, setSelectedRouteForMap] = useState<VRPRoute | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [, setLocation] = useLocation();
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

  const pollForResult = async (jobId: string): Promise<VRPResult> => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const res = await fetch(`/api/ai/optimization-job/${jobId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta optimeringsstatus");
      const job = await res.json();
      if (job.status === "completed" && job.result) {
        return job.result as VRPResult;
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Optimering misslyckades");
      }
    }
    throw new Error("Optimering tog för lång tid");
  };

  const vrpMutation = useMutation({
    mutationFn: async () => {
      const body: { date?: string; clusterId?: string } = {};
      if (selectedDate) body.date = selectedDate;
      if (selectedCluster && selectedCluster !== "all") body.clusterId = selectedCluster;

      try {
        const statsRes = await apiRequest("GET", `/api/ai/route-recommendations?date=${selectedDate}`);
        const statsData = await statsRes.json();
        if (statsData?.statistics) {
          const routeStats = statsData.currentRouteStats;
          setCurrentStats({
            totalOrders: statsData.statistics.totalOrders || 0,
            totalDurationMinutes: routeStats?.totalDurationMinutes ?? 0,
            totalDistanceKm: routeStats?.totalDistanceKm ?? 0,
            avgEfficiency: routeStats?.avgEfficiency ?? 0,
            resourceCount: statsData.statistics.activeResources || 0,
          });
        }
        if (statsData?.currentRoutes && Array.isArray(statsData.currentRoutes)) {
          setCurrentRoutes(statsData.currentRoutes.map((cr: { resourceId: string; resourceName: string; orders: Array<{ title: string; address: string }> }) => ({
            resourceId: cr.resourceId,
            resourceName: cr.resourceName,
            orders: cr.orders || [],
          })));
        }
      } catch {
        setCurrentStats(null);
        setCurrentRoutes([]);
      }
      
      const response = await apiRequest("POST", "/api/ai/optimize-vrp", body);
      const data = await response.json();

      if (data.jobId && data.status === "queued") {
        return pollForResult(data.jobId);
      }

      return data as VRPResult;
    },
    onSuccess: (data) => {
      setVrpResult(data);
      if (data.success) {
        toast({
          title: "Ruttoptimering klar",
          description: `${data.summary.assignedOrders} av ${data.summary.totalOrders} ordrar tilldelade med ${data.summary.avgEfficiency}% effektivitet`,
          duration: 10000,
        });
      } else {
        toast({
          title: "Optimering misslyckades",
          description: data.error || "Något gick fel",
          variant: "destructive",
          duration: 15000,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Fel vid optimering",
        description: error.message,
        variant: "destructive",
        duration: 15000,
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
      <PageHeader icon={RouteIcon} title="Ruttplanering">
        <Input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-[150px] h-9"
          data-testid="input-vrp-date"
        />
        <Select value={selectedCluster} onValueChange={setSelectedCluster}>
          <SelectTrigger className="w-[160px] h-9" data-testid="select-vrp-cluster">
            <SelectValue placeholder="Alla kluster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla kluster</SelectItem>
            {clusters.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => vrpMutation.mutate()}
              disabled={vrpMutation.isPending}
              size="sm"
              data-testid="button-run-vrp"
            >
              {vrpMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RouteIcon className="h-4 w-4 mr-2" />
              )}
              Kör optimering
            </Button>
          </TooltipTrigger>
          <TooltipContent>Optimera dagens rutter</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={() => window.open("/monitor/popout", "traivo-monitor", "width=1200,height=800,menubar=no,toolbar=no,location=no,status=no")}
              data-testid="button-popout-monitor"
            >
              <Monitor className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Öppna kartövervakning i eget fönster</TooltipContent>
        </Tooltip>
      </PageHeader>

      {recommendations && recommendations.weather && recommendations.weather.impact !== "none" && (
        <div className={`flex items-center gap-3 px-3 py-2 rounded-md border-l-4 ${
          recommendations.weather.impact === "severe" || recommendations.weather.impact === "high" 
            ? "border-l-destructive bg-destructive/10 dark:bg-destructive/15" 
            : "border-l-chart-3 bg-chart-3/10 dark:bg-chart-3/15"
        }`} data-testid="card-weather-warning">
          <AlertTriangle className={`h-4 w-4 shrink-0 ${
            recommendations.weather.impact === "severe" || recommendations.weather.impact === "high"
              ? "text-destructive"
              : "text-chart-4"
          }`} />
          <span className="text-sm">
            {Math.round(recommendations.weather.temperature)}°C, {recommendations.weather.precipitation} mm, {Math.round(recommendations.weather.windSpeed)} m/s — {recommendations.weather.description}
          </span>
          <Badge 
            variant={recommendations.weather.impact === "severe" || recommendations.weather.impact === "high" ? "destructive" : "secondary"}
            className="text-xs ml-auto shrink-0"
          >
            Kapacitet: {Math.round(recommendations.weather.capacityMultiplier * 100)}%
          </Badge>
        </div>
      )}

          {vrpResult && (
            <div className="space-y-4">
              {!vrpResult.success ? (
                <div className="flex items-start gap-2 text-destructive text-sm p-3 bg-destructive/10 dark:bg-destructive/15 rounded-md border border-destructive/20 dark:border-destructive/80">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="break-words">{vrpResult.error}</span>
                </div>
              ) : (
                <>
                  {(currentStats || currentRoutes.length > 0) && (
                    <Card className="border-dashed" data-testid="route-comparison">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <RouteIcon className="h-4 w-4" />
                          Före / Efter jämförelse
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {currentStats && (
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
                                  <span>{currentStats.totalDurationMinutes > 0 ? `${currentStats.totalDurationMinutes} min` : "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Distans</span>
                                  <span>{currentStats.totalDistanceKm > 0 ? `${currentStats.totalDistanceKm} km` : "—"}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Effektivitet</span>
                                  <span>{currentStats.avgEfficiency > 0 ? `${currentStats.avgEfficiency}%` : "—"}</span>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-2 border-l pl-4">
                              <p className="text-xs font-medium text-chart-2 uppercase tracking-wide">Optimerad</p>
                              <div className="space-y-1.5 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Ordrar</span>
                                  <span>{vrpResult.summary.assignedOrders}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Tid</span>
                                  <span className="font-medium">
                                    {vrpResult.summary.totalDurationMinutes} min
                                    {currentStats.totalDurationMinutes > 0 && currentStats.totalDurationMinutes > vrpResult.summary.totalDurationMinutes && (
                                      <Badge variant="secondary" className="ml-1 text-[10px] text-chart-2">
                                        -{currentStats.totalDurationMinutes - vrpResult.summary.totalDurationMinutes} min
                                      </Badge>
                                    )}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Distans</span>
                                  <span className="font-medium">
                                    {vrpResult.summary.totalDistanceKm} km
                                    {currentStats.totalDistanceKm > 0 && currentStats.totalDistanceKm > vrpResult.summary.totalDistanceKm && (
                                      <Badge variant="secondary" className="ml-1 text-[10px] text-chart-2">
                                        -{Math.round((currentStats.totalDistanceKm - vrpResult.summary.totalDistanceKm) * 10) / 10} km
                                      </Badge>
                                    )}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Effektivitet</span>
                                  <span className="font-medium">
                                    {vrpResult.summary.avgEfficiency}%
                                    {currentStats.avgEfficiency > 0 && vrpResult.summary.avgEfficiency > currentStats.avgEfficiency && (
                                      <Badge variant="secondary" className="ml-1 text-[10px] text-chart-2">
                                        +{vrpResult.summary.avgEfficiency - currentStats.avgEfficiency}%
                                      </Badge>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {currentRoutes.length > 0 && (
                          <div className="grid grid-cols-2 gap-4 border-t pt-3">
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nuvarande ordning</p>
                              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                {currentRoutes.map(cr => (
                                  <div key={cr.resourceId} className="text-xs">
                                    <div className="font-medium flex items-center gap-1 mb-0.5">
                                      <Truck className="h-3 w-3 text-muted-foreground" />
                                      {cr.resourceName}
                                      <Badge variant="outline" className="text-[10px] ml-auto">{cr.orders.length} stopp</Badge>
                                    </div>
                                    <div className="flex flex-wrap gap-0.5">
                                      {cr.orders.map((o, i) => (
                                        <span key={i} className="text-muted-foreground">
                                          <span className="bg-muted px-1 py-0.5 rounded text-[10px]">{i + 1}</span>
                                          <span className="truncate max-w-[80px] inline-block align-middle ml-0.5">{o.title}</span>
                                          {i < cr.orders.length - 1 && <span className="mx-0.5">→</span>}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2 border-l pl-4">
                              <p className="text-xs font-medium text-chart-2 uppercase tracking-wide">Optimerad ordning</p>
                              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                {vrpResult.routes.map((route, idx) => (
                                  <div key={route.resourceId || idx} className="text-xs">
                                    <div className="font-medium flex items-center gap-1 mb-0.5">
                                      <Truck className="h-3 w-3 text-chart-2" />
                                      {route.resourceName}
                                      <Badge variant="outline" className="text-[10px] ml-auto">{route.stops.length} stopp</Badge>
                                    </div>
                                    <div className="flex flex-wrap gap-0.5">
                                      {route.stops.map((stop, i) => (
                                        <span key={stop.orderId} className="text-muted-foreground">
                                          <span className="bg-chart-2/15 dark:bg-chart-2/15 text-chart-2 px-1 py-0.5 rounded text-[10px]">{i + 1}</span>
                                          <span className="truncate max-w-[80px] inline-block align-middle ml-0.5">{stop.orderTitle}</span>
                                          {i < route.stops.length - 1 && <span className="mx-0.5">→</span>}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
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
                      <div className="text-sm text-chart-4">
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
                              <Link
                                href={`/work-orders/${stop.orderId}`}
                                className="truncate max-w-[120px] hover:text-foreground hover:underline"
                                data-testid={`link-open-order-${stop.orderId}`}
                              >
                                {stop.orderTitle}
                              </Link>
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
      
      <div className="flex-1">
        <RouteMap initialDate={selectedDate} onNavigate={(jobId) => setLocation(`/work-orders/${jobId}`)} />
      </div>
    </div>
  );
}
