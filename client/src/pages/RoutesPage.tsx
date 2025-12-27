import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RouteMap } from "@/components/RouteMap";
import { AICard } from "@/components/AICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, TrendingUp, Clock, MapPin, Route as RouteIcon, Truck, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Cluster } from "@shared/schema";

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

export default function RoutesPage() {
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [selectedCluster, setSelectedCluster] = useState<string>("all");
  const [vrpResult, setVrpResult] = useState<VRPResult | null>(null);
  const { toast } = useToast();

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const vrpMutation = useMutation({
    mutationFn: async () => {
      const body: { date?: string; clusterId?: string } = {};
      if (selectedDate) body.date = selectedDate;
      if (selectedCluster && selectedCluster !== "all") body.clusterId = selectedCluster;
      
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

  return (
    <div className="h-full p-6 flex flex-col gap-4 overflow-auto">
      <div>
        <h1 className="text-2xl font-semibold">Ruttplanering</h1>
        <p className="text-sm text-muted-foreground">Optimera dagens rutter och minimera körtid</p>
      </div>
      
      <AICard
        title="AI Ruttoptimering"
        variant="compact"
        defaultExpanded={false}
        insights={[
          { type: "optimization", title: "Ruttoptimering", description: "AI kan optimera ordningen på stopp för att minimera körtid" },
          { type: "suggestion", title: "Bränslebesparingar", description: "Föreslå ruttändringar som sparar bränsle och minskar utsläpp" },
          { type: "info", title: "Trafikprognoser", description: "Anpassa rutter baserat på förväntad trafik och väderförhållanden" },
        ]}
      />

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
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="vrp-summary-grid">
                    <div className="bg-muted rounded-md p-3 text-center" data-testid="stat-assigned-orders">
                      <div className="text-xl font-semibold">{vrpResult.summary.assignedOrders}</div>
                      <div className="text-xs text-muted-foreground">Tilldelade ordrar</div>
                    </div>
                    <div className="bg-muted rounded-md p-3 text-center" data-testid="stat-routes-count">
                      <div className="text-xl font-semibold">{vrpResult.routes.length}</div>
                      <div className="text-xs text-muted-foreground">Rutter</div>
                    </div>
                    <div className="bg-muted rounded-md p-3 text-center" data-testid="stat-total-duration">
                      <div className="text-xl font-semibold flex items-center justify-center gap-1">
                        <Clock className="h-4 w-4" />
                        {vrpResult.summary.totalDurationMinutes}
                      </div>
                      <div className="text-xs text-muted-foreground">Total tid (min)</div>
                    </div>
                    <div className="bg-muted rounded-md p-3 text-center" data-testid="stat-total-distance">
                      <div className="text-xl font-semibold flex items-center justify-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {vrpResult.summary.totalDistanceKm}
                      </div>
                      <div className="text-xs text-muted-foreground">Total distans (km)</div>
                    </div>
                    <div className="bg-muted rounded-md p-3 text-center" data-testid="stat-efficiency">
                      <div className="text-xl font-semibold flex items-center justify-center gap-1">
                        <TrendingUp className="h-4 w-4" />
                        {vrpResult.summary.avgEfficiency}%
                      </div>
                      <div className="text-xs text-muted-foreground">Effektivitet</div>
                    </div>
                  </div>

                  {vrpResult.unassignedOrders.length > 0 && (
                    <div className="text-sm text-orange-600 dark:text-orange-400">
                      {vrpResult.unassignedOrders.length} ordrar kunde inte tilldelas
                    </div>
                  )}

                  <div className="space-y-3" data-testid="vrp-routes-list">
                    {vrpResult.routes.map((route, idx) => (
                      <Card key={route.resourceId || idx} className="p-3" data-testid={`vrp-route-${route.resourceId || idx}`}>
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium text-sm" data-testid={`text-resource-${route.resourceId || idx}`}>
                              {route.resourceName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
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
