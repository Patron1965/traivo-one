import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Loader2, Route, Clock, MapPin, TrendingUp, ChevronDown, ChevronUp,
  Settings2, Play, Eye, Calendar, CheckCircle2, XCircle, AlertTriangle,
  Info, ArrowRight,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface VRPRouteStop {
  orderId: string;
  orderTitle: string;
  sequence: number;
  arrivalSeconds?: number;
  serviceMinutes: number;
  waitingMinutes: number;
  location: { lat: number; lng: number };
  isBreak?: boolean;
  breakDurationMinutes?: number;
}

interface VRPRoute {
  resourceId: string;
  resourceName: string;
  stops: VRPRouteStop[];
  totalDurationMinutes: number;
  totalDistanceKm: number;
  totalServiceMinutes: number;
  efficiency: number;
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
  constraintsApplied?: string[];
  error?: string;
}

interface AsyncJobResponse {
  jobId: string;
  status: "queued";
  orderCount: number;
}

interface JobStatus {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  result?: VRPResult;
  error?: string;
  attempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface ConstraintOptions {
  respectTimeWindows: boolean;
  respectSkills: boolean;
  respectCapacity: boolean;
  respectDependencies: boolean;
}

interface RouteOptimizationPanelProps {
  selectedDate: string;
}

function isAsyncResponse(data: unknown): data is AsyncJobResponse {
  return typeof data === "object" && data !== null && "jobId" in data && "status" in data;
}

export function RouteOptimizationPanel({ selectedDate }: RouteOptimizationPanelProps) {
  const [vrpResult, setVrpResult] = useState<VRPResult | null>(null);
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  const [showConstraints, setShowConstraints] = useState(false);
  const [isSimulation, setIsSimulation] = useState(false);
  const [constraints, setConstraints] = useState<ConstraintOptions>({
    respectTimeWindows: true,
    respectSkills: true,
    respectCapacity: false,
    respectDependencies: true,
  });
  const [asyncJobId, setAsyncJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [multiDayMode, setMultiDayMode] = useState(false);
  const [multiDayDays, setMultiDayDays] = useState(5);
  const [multiDayResults, setMultiDayResults] = useState<Array<{ date: string; result: VRPResult }>>([]);
  const [multiDayRunning, setMultiDayRunning] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollJobStatus = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setAsyncJobId(jobId);
    setJobStatus("queued");
    setJobProgress(0);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai/optimization-job/${jobId}`);
        if (!res.ok) return;
        const data: JobStatus = await res.json();
        setJobProgress(data.progress);
        setJobStatus(data.status);

        if (data.status === "completed" && data.result) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setVrpResult(data.result);
          setAsyncJobId(null);
          toast({ title: "Optimering klar", description: `${data.result.summary.assignedOrders} ordrar tilldelade` });
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setAsyncJobId(null);
          toast({ title: "Optimering misslyckades", description: data.error || "Okänt fel", variant: "destructive" });
        }
      } catch {
      }
    }, 2000);
  }, [toast]);

  const optimizeVRPMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/optimize-vrp", {
        date: selectedDate,
        constraints,
      });
      return response.json();
    },
    onSuccess: (data: VRPResult | AsyncJobResponse) => {
      if (isAsyncResponse(data)) {
        pollJobStatus(data.jobId);
        toast({ title: "Stor optimering köad", description: `${data.orderCount} ordrar — körs i bakgrunden` });
      } else {
        setVrpResult(data);
        if (!data.success) {
          toast({ title: "Varning", description: data.error || "Optimering kunde inte slutföras", variant: "destructive" });
        }
      }
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte starta optimering", variant: "destructive" });
    },
  });

  const runMultiDay = useCallback(async () => {
    setMultiDayRunning(true);
    setMultiDayResults([]);
    const results: Array<{ date: string; result: VRPResult }> = [];

    const startDate = new Date(selectedDate);
    for (let i = 0; i < multiDayDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const dateStr = d.toISOString().split("T")[0];

      try {
        const response = await apiRequest("POST", "/api/ai/optimize-vrp", {
          date: dateStr,
          constraints,
        });
        const data = await response.json();

        if (!isAsyncResponse(data)) {
          results.push({ date: dateStr, result: data });
          setMultiDayResults([...results]);
        }
      } catch {
        results.push({
          date: dateStr,
          result: {
            success: false, routes: [],
            unassignedOrders: [],
            summary: { totalOrders: 0, assignedOrders: 0, totalDurationMinutes: 0, totalDistanceKm: 0, avgEfficiency: 0 },
            error: "Optimering misslyckades",
          },
        });
        setMultiDayResults([...results]);
      }
    }

    setMultiDayRunning(false);
    toast({ title: "Flerdagsplanering klar", description: `${results.length} dagar optimerade` });
  }, [selectedDate, multiDayDays, constraints, toast]);

  const toggleRoute = (key: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const constraintLabels: Record<string, string> = {
    respectTimeWindows: "Tidsfönster",
    respectSkills: "Kompetens",
    respectCapacity: "Kapacitet",
    respectDependencies: "Beroenden",
  };

  const activeConstraintCount = Object.values(constraints).filter(Boolean).length;
  const isRunning = optimizeVRPMutation.isPending || !!asyncJobId || multiDayRunning;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Route className="h-5 w-5 text-blue-500" />
          VRP-ruttoptimering
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 overflow-auto">
        <Collapsible open={showConstraints} onOpenChange={setShowConstraints}>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between" data-testid="button-toggle-constraints">
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Optimeringsinställningar
              </span>
              <Badge variant="secondary" className="text-xs">{activeConstraintCount} aktiva</Badge>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 pt-3">
              {(Object.keys(constraints) as Array<keyof ConstraintOptions>).map((key) => (
                <div key={key} className="flex items-center justify-between" data-testid={`constraint-${key}`}>
                  <Label className="text-xs cursor-pointer" htmlFor={`constraint-${key}`}>{constraintLabels[key]}</Label>
                  <Switch
                    id={`constraint-${key}`}
                    checked={constraints[key]}
                    onCheckedChange={(checked) => setConstraints((prev) => ({ ...prev, [key]: checked }))}
                    data-testid={`switch-${key}`}
                  />
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between" data-testid="toggle-simulation">
                <Label className="text-xs cursor-pointer flex items-center gap-1" htmlFor="simulation-mode">
                  <Eye className="h-3 w-3" />
                  Vad-om simulering
                </Label>
                <Switch id="simulation-mode" checked={isSimulation} onCheckedChange={setIsSimulation} data-testid="switch-simulation" />
              </div>
              <div className="flex items-center justify-between" data-testid="toggle-multiday">
                <Label className="text-xs cursor-pointer flex items-center gap-1" htmlFor="multiday-mode">
                  <Calendar className="h-3 w-3" />
                  Flerdagsplanering
                </Label>
                <Switch id="multiday-mode" checked={multiDayMode} onCheckedChange={setMultiDayMode} data-testid="switch-multiday" />
              </div>
              {multiDayMode && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Dagar:</Label>
                  <div className="flex gap-1">
                    {[3, 5, 7].map((n) => (
                      <Button
                        key={n}
                        size="sm"
                        variant={multiDayDays === n ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        onClick={() => setMultiDayDays(n)}
                        data-testid={`button-days-${n}`}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {!multiDayMode ? (
          <Button
            onClick={() => optimizeVRPMutation.mutate()}
            disabled={isRunning}
            className="w-full"
            data-testid="button-optimize-vrp"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : isSimulation ? (
              <Eye className="h-4 w-4 mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isSimulation ? "Simulera" : "Optimera"} {selectedDate}
          </Button>
        ) : (
          <Button
            onClick={runMultiDay}
            disabled={isRunning}
            className="w-full"
            data-testid="button-optimize-multiday"
          >
            {multiDayRunning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Calendar className="h-4 w-4 mr-2" />
            )}
            Optimera {multiDayDays} dagar från {selectedDate}
          </Button>
        )}

        {asyncJobId && (
          <Card className="p-3 bg-blue-500/10 border-blue-500/30" data-testid="card-async-progress">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-sm font-medium">
                {jobStatus === "queued" ? "Köad..." : "Optimerar..."}
              </span>
              <Badge variant="secondary" className="text-xs ml-auto">{jobProgress}%</Badge>
            </div>
            <Progress value={jobProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">Stor optimering körs i bakgrunden</p>
          </Card>
        )}

        {isSimulation && vrpResult && (
          <Card className="p-3 bg-amber-500/10 border-amber-500/30" data-testid="card-simulation-banner">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Simuleringsresultat — inga ändringar sparade</span>
            </div>
          </Card>
        )}

        {!multiDayMode && !asyncJobId && !isRunning && !vrpResult && (
          <div className="text-center py-6 text-muted-foreground">
            <Route className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">VRP-optimering med constraints</p>
            <p className="text-xs mt-1">Geoapify Route Planner med tidsfönster, kompetens & beroenden</p>
          </div>
        )}

        {!multiDayMode && vrpResult && (
          <VRPResultView
            result={vrpResult}
            expandedRoutes={expandedRoutes}
            toggleRoute={toggleRoute}
            formatTime={formatTime}
            isSimulation={isSimulation}
          />
        )}

        {multiDayMode && multiDayResults.length > 0 && (
          <MultiDayResultView results={multiDayResults} formatTime={formatTime} />
        )}
      </CardContent>
    </Card>
  );
}

function VRPResultView({
  result, expandedRoutes, toggleRoute, formatTime, isSimulation,
}: {
  result: VRPResult;
  expandedRoutes: Set<string>;
  toggleRoute: (key: string) => void;
  formatTime: (m: number) => string;
  isSimulation: boolean;
}) {
  return (
    <div className="space-y-3">
      <Card className="p-3 bg-muted/50" data-testid="card-vrp-summary">
        <div className="grid grid-cols-2 gap-2 text-center mb-2">
          <div>
            <div className="text-lg font-semibold" data-testid="text-assigned-orders">
              {result.summary.assignedOrders}/{result.summary.totalOrders}
            </div>
            <div className="text-[10px] text-muted-foreground">ordrar tilldelade</div>
          </div>
          <div>
            <div className="text-lg font-semibold" data-testid="text-total-distance">
              {result.summary.totalDistanceKm.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground">km totalt</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{formatTime(result.summary.totalDurationMinutes)}</div>
            <div className="text-[10px] text-muted-foreground">total tid</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{Math.round(result.summary.avgEfficiency)}%</div>
            <div className="text-[10px] text-muted-foreground">effektivitet</div>
          </div>
        </div>

        {result.constraintsApplied && result.constraintsApplied.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2" data-testid="constraints-applied">
            {result.constraintsApplied.map((c) => (
              <Badge key={c} variant="outline" className="text-[10px]">
                <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                {c}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {result.unassignedOrders.length > 0 && (
        <Card className="p-3 bg-red-500/10 border-red-500/30" data-testid="card-unassigned">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-xs font-medium">{result.unassignedOrders.length} ej tilldelade</span>
          </div>
          <div className="space-y-1">
            {result.unassignedOrders.slice(0, 5).map((u) => (
              <div key={u.orderId} className="text-xs text-muted-foreground flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                <span className="truncate">{u.orderId}</span>
                <span className="text-[10px]">— {u.reason}</span>
              </div>
            ))}
            {result.unassignedOrders.length > 5 && (
              <p className="text-[10px] text-muted-foreground">...och {result.unassignedOrders.length - 5} till</p>
            )}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {result.routes.map((route) => {
          const key = route.resourceId;
          const isExpanded = expandedRoutes.has(key);

          return (
            <Collapsible key={key} open={isExpanded}>
              <Card className="p-3">
                <CollapsibleTrigger asChild>
                  <button
                    className="w-full flex items-center justify-between text-left"
                    onClick={() => toggleRoute(key)}
                    data-testid={`vrp-route-toggle-${route.resourceId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{route.resourceName}</span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {route.stops.filter((s) => !s.isBreak).length} stopp
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(route.totalDurationMinutes)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {route.totalDistanceKm.toFixed(1)} km
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <Progress value={route.efficiency} className="w-16 h-2" />
                        <span className="text-xs text-muted-foreground">{Math.round(route.efficiency)}%</span>
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <p className="text-xs font-medium flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      Beslutsspår
                    </p>
                    <div className="space-y-1">
                      {route.stops.map((stop, idx) => (
                        <div key={`${stop.orderId}-${idx}`} className="flex items-center gap-2 text-xs">
                          {stop.isBreak ? (
                            <>
                              <Badge variant="secondary" className="h-5 px-1 text-[10px] shrink-0">Rast</Badge>
                              <span className="text-muted-foreground">{stop.breakDurationMinutes || 30} min</span>
                            </>
                          ) : (
                            <>
                              <Badge variant="outline" className="h-5 w-5 p-0 flex items-center justify-center shrink-0">
                                {stop.sequence}
                              </Badge>
                              <span className="truncate flex-1">{stop.orderTitle || stop.orderId}</span>
                              <span className="text-muted-foreground shrink-0">{stop.serviceMinutes}m</span>
                              {stop.waitingMinutes > 0 && (
                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                  väntar {stop.waitingMinutes}m
                                </Badge>
                              )}
                              {stop.arrivalSeconds !== undefined && (
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {Math.floor(stop.arrivalSeconds / 3600).toString().padStart(2, "0")}:
                                  {Math.floor((stop.arrivalSeconds % 3600) / 60).toString().padStart(2, "0")}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <TrendingUp className="h-3 w-3" />
                      Service: {formatTime(route.totalServiceMinutes)} | Total: {formatTime(route.totalDurationMinutes)}
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

function MultiDayResultView({
  results,
  formatTime,
}: {
  results: Array<{ date: string; result: VRPResult }>;
  formatTime: (m: number) => string;
}) {
  const totalAssigned = results.reduce((s, r) => s + r.result.summary.assignedOrders, 0);
  const totalOrders = results.reduce((s, r) => s + r.result.summary.totalOrders, 0);
  const totalDistanceKm = results.reduce((s, r) => s + r.result.summary.totalDistanceKm, 0);
  const totalDuration = results.reduce((s, r) => s + r.result.summary.totalDurationMinutes, 0);

  return (
    <div className="space-y-3" data-testid="multiday-results">
      <Card className="p-3 bg-muted/50">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">Veckosammanfattning</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div>
            <div className="text-lg font-semibold">{totalAssigned}/{totalOrders}</div>
            <div className="text-[10px] text-muted-foreground">ordrar totalt</div>
          </div>
          <div>
            <div className="text-lg font-semibold">{totalDistanceKm.toFixed(0)} km</div>
            <div className="text-[10px] text-muted-foreground">total körsträcka</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-2 text-center">
          Total tid: {formatTime(totalDuration)} | {results.length} dagar
        </div>
      </Card>

      {results.map(({ date, result }) => (
        <Card key={date} className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <span className="text-sm font-medium">{date}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{result.summary.assignedOrders}/{result.summary.totalOrders}</span>
              <ArrowRight className="h-3 w-3" />
              <span>{result.summary.totalDistanceKm.toFixed(1)} km</span>
            </div>
          </div>
          {result.routes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {result.routes.map((r) => (
                <Badge key={r.resourceId} variant="secondary" className="text-[10px]">
                  {r.resourceName}: {r.stops.filter((s) => !s.isBreak).length} stopp
                </Badge>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
