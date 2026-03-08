import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Truck, 
  MapPin, 
  Clock, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Send,
  RefreshCw,
  FileCheck,
  Loader2,
  Building2,
  Key,
  Keyboard,
  DoorOpen,
  Users,
  Package,
  PieChart
} from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { sv } from "date-fns/locale";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import type { WorkOrderWithObject, Resource, ServiceObject, Customer } from "@shared/schema";

type OptimizationStatus = "idle" | "validating" | "ready" | "sending" | "optimizing" | "completed" | "error";

interface ValidationResult {
  category: string;
  label: string;
  status: "ok" | "warning" | "error";
  count: number;
  total: number;
  message: string;
}

export default function OptimizationPrepPage() {
  const [selectedWeek, setSelectedWeek] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [optimizationStatus, setOptimizationStatus] = useState<OptimizationStatus>("idle");

  const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
  const weekNumber = format(selectedWeek, "w", { locale: sv });

  // Formatera datum för API-filtrering
  const startDateParam = format(selectedWeek, "yyyy-MM-dd");
  const endDateParam = format(weekEnd, "yyyy-MM-dd");

  const { data: weekOrders = [], isLoading: loadingOrders } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", { startDate: startDateParam, endDate: endDateParam }],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders?startDate=${startDateParam}&endDate=${endDateParam}&includeUnscheduled=false`);
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return res.json();
    },
  });

  const { data: resources = [], isLoading: loadingResources } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Hämta endast objekt som refereras i veckans arbetsordrar
  const weekOrderObjectIds = useMemo(() => {
    return weekOrders.map(o => o.objectId).filter(Boolean);
  }, [weekOrders]);

  const { data: objects = [], isLoading: loadingObjects } = useObjectsByIds(weekOrderObjectIds);

  const activeResources = useMemo(() => {
    return resources.filter(r => r.status === "active");
  }, [resources]);

  const validationResults = useMemo((): ValidationResult[] => {
    const objectsWithCoords = objects.filter(o => o.latitude && o.longitude);
    const objectsWithAccess = objects.filter(o => o.accessType);
    const assignedOrders = weekOrders.filter(o => o.resourceId);
    const ordersWithDuration = weekOrders.filter(o => o.estimatedDuration && o.estimatedDuration > 0);

    return [
      {
        category: "geocoding",
        label: "Geokodade objekt",
        status: objectsWithCoords.length === objects.length ? "ok" : objectsWithCoords.length > objects.length * 0.8 ? "warning" : "error",
        count: objectsWithCoords.length,
        total: objects.length,
        message: objectsWithCoords.length === objects.length 
          ? "Alla objekt har koordinater" 
          : `${objects.length - objectsWithCoords.length} objekt saknar koordinater`
      },
      {
        category: "access",
        label: "Tillgångsinformation",
        status: objectsWithAccess.length === objects.length ? "ok" : objectsWithAccess.length > objects.length * 0.5 ? "warning" : "error",
        count: objectsWithAccess.length,
        total: objects.length,
        message: objectsWithAccess.length === objects.length 
          ? "Alla objekt har tillgångstyp" 
          : `${objects.length - objectsWithAccess.length} objekt saknar tillgångsinfo`
      },
      {
        category: "assignment",
        label: "Tilldelade jobb",
        status: assignedOrders.length === weekOrders.length ? "ok" : assignedOrders.length > 0 ? "warning" : weekOrders.length > 0 ? "error" : "ok",
        count: assignedOrders.length,
        total: weekOrders.length,
        message: assignedOrders.length === weekOrders.length 
          ? "Alla jobb är tilldelade" 
          : assignedOrders.length > 0
            ? `${weekOrders.length - assignedOrders.length} jobb utan tilldelning (kan tilldelas av optimeraren)`
            : weekOrders.length > 0 ? "Inga jobb är tilldelade" : "Inga jobb denna vecka"
      },
      {
        category: "duration",
        label: "Tidsuppskattningar",
        status: ordersWithDuration.length === weekOrders.length ? "ok" : ordersWithDuration.length > weekOrders.length * 0.8 ? "warning" : "error",
        count: ordersWithDuration.length,
        total: weekOrders.length,
        message: ordersWithDuration.length === weekOrders.length 
          ? "Alla jobb har tidsuppskattning" 
          : `${weekOrders.length - ordersWithDuration.length} jobb saknar tidsuppskattning`
      },
      {
        category: "resources",
        label: "Aktiva resurser",
        status: activeResources.length >= 1 ? "ok" : "error",
        count: activeResources.length,
        total: resources.length,
        message: activeResources.length >= 1 
          ? `${activeResources.length} resurser tillgängliga` 
          : "Inga aktiva resurser"
      }
    ];
  }, [objects, weekOrders, activeResources, resources]);

  const overallReadiness = useMemo(() => {
    const errors = validationResults.filter(v => v.status === "error").length;
    const warnings = validationResults.filter(v => v.status === "warning").length;
    if (errors > 0) return { status: "error", message: "Data behöver åtgärdas innan optimering" };
    if (warnings > 0) return { status: "warning", message: "Data kan förbättras men optimering är möjlig" };
    return { status: "ok", message: "All data är redo för optimering" };
  }, [validationResults]);

  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const customerDistribution = useMemo(() => {
    const dist: Record<string, { name: string; count: number; hours: number }> = {};
    weekOrders.forEach(order => {
      const obj = objectMap.get(order.objectId);
      const customer = obj ? customerMap.get(obj.customerId) : null;
      const custId = customer?.id || "unknown";
      const custName = customer?.name || (obj ? "Okänd kund" : "Saknar objekt");
      if (!dist[custId]) {
        dist[custId] = { name: custName, count: 0, hours: 0 };
      }
      dist[custId].count += 1;
      dist[custId].hours += (order.estimatedDuration || 60) / 60;
    });
    return Object.values(dist).sort((a, b) => b.count - a.count);
  }, [weekOrders, objectMap, customerMap]);

  const accessTypeDistribution = useMemo(() => {
    const dist: Record<string, number> = {};
    weekOrders.forEach(order => {
      const obj = objectMap.get(order.objectId);
      const accessType = obj?.accessType || "open";
      dist[accessType] = (dist[accessType] || 0) + 1;
    });
    return dist;
  }, [weekOrders, objectMap]);

  const containerSummary = useMemo(() => {
    let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
    const uniqueObjects = new Set(weekOrders.map(o => o.objectId));
    uniqueObjects.forEach(objId => {
      const obj = objectMap.get(objId);
      if (obj) {
        k1 += obj.containerCount || 0;
        k2 += obj.containerCountK2 || 0;
        k3 += obj.containerCountK3 || 0;
        k4 += obj.containerCountK4 || 0;
      }
    });
    return { k1, k2, k3, k4, total: k1 + k2 + k3 + k4 };
  }, [weekOrders, objectMap]);

  const accessTypeLabels: Record<string, { label: string; icon: typeof Key; color: string }> = {
    open: { label: "Öppen", icon: DoorOpen, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
    code: { label: "Kod", icon: Keyboard, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
    key: { label: "Nyckel", icon: Key, color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
    meeting: { label: "Möte", icon: Users, color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400" },
  };

  const handlePreviousWeek = () => setSelectedWeek(prev => subWeeks(prev, 1));
  const handleNextWeek = () => setSelectedWeek(prev => addWeeks(prev, 1));

  const handleValidate = async () => {
    setOptimizationStatus("validating");
    await new Promise(resolve => setTimeout(resolve, 1500));
    setOptimizationStatus("ready");
  };

  const handleSendToOptimization = async () => {
    setOptimizationStatus("sending");
    await new Promise(resolve => setTimeout(resolve, 1000));
    setOptimizationStatus("optimizing");
    await new Promise(resolve => setTimeout(resolve, 3000));
    setOptimizationStatus("completed");
  };

  const isLoading = loadingOrders || loadingResources || loadingObjects;

  const getStatusIcon = (status: "ok" | "warning" | "error") => {
    switch (status) {
      case "ok": return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />;
      case "error": return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Inför Optimering</h1>
          <p className="text-muted-foreground">Förbered och validera data för veckooptimering</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">Välj vecka</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="icon" 
                onClick={handlePreviousWeek}
                data-testid="button-prev-week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[200px] text-center">
                <span className="font-medium" data-testid="text-week-number">
                  Vecka {weekNumber}
                </span>
                <span className="text-muted-foreground ml-2 text-sm">
                  {format(selectedWeek, "d MMM", { locale: sv })} - {format(weekEnd, "d MMM yyyy", { locale: sv })}
                </span>
              </div>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={handleNextWeek}
                data-testid="button-next-week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Jobb denna vecka</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold" data-testid="text-week-jobs-count">
                {weekOrders.length}
              </div>
            )}
            <p className="text-sm text-muted-foreground">arbetsordrar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Unika objekt</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold" data-testid="text-unique-objects">
                {new Set(weekOrders.map(o => o.objectId)).size}
              </div>
            )}
            <p className="text-sm text-muted-foreground">besöksplatser</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Total arbetstid</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold" data-testid="text-total-hours">
                {Math.round(weekOrders.reduce((sum, o) => sum + (o.estimatedDuration || 60), 0) / 60)}h
              </div>
            )}
            <p className="text-sm text-muted-foreground">beräknad tid</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Fördelning per kund</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : customerDistribution.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga jobb denna vecka</p>
            ) : (
              <div className="space-y-3">
                {customerDistribution.map((cust, idx) => {
                  const maxCount = Math.max(customerDistribution[0]?.count || 1, 1);
                  const percent = Math.min((cust.count / maxCount) * 100, 100);
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate max-w-[180px]">{cust.name}</span>
                        <span className="text-muted-foreground">
                          {cust.count} jobb ({cust.hours.toFixed(1)}h)
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <PieChart className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Tillgångstyper & Kärl</CardTitle>
              </div>
              {containerSummary.total > 0 && (
                <Badge variant="secondary" className="text-xs">
                  <Package className="h-3 w-3 mr-1" />
                  {containerSummary.total} kärl totalt
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(accessTypeDistribution).length === 0 ? (
                <p className="text-sm text-muted-foreground">Inga jobb denna vecka</p>
              ) : (
                Object.entries(accessTypeDistribution).map(([type, count]) => {
                  if (count === 0) return null;
                  const config = accessTypeLabels[type] || { 
                    label: type.charAt(0).toUpperCase() + type.slice(1), 
                    icon: DoorOpen, 
                    color: "bg-muted text-foreground" 
                  };
                  const Icon = config.icon;
                  return (
                    <div 
                      key={type} 
                      className={`flex items-center gap-2 px-3 py-2 rounded-md ${config.color}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{config.label}</span>
                      <span className="text-sm font-bold">{count}</span>
                    </div>
                  );
                })
              )}
            </div>

            {containerSummary.total > 0 && (
              <>
                <Separator />
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2 bg-muted rounded-md">
                    <div className="text-lg font-semibold">{containerSummary.k1}</div>
                    <div className="text-[10px] text-muted-foreground">K1 Standard</div>
                  </div>
                  <div className="p-2 bg-muted rounded-md">
                    <div className="text-lg font-semibold">{containerSummary.k2}</div>
                    <div className="text-[10px] text-muted-foreground">K2 Pant</div>
                  </div>
                  <div className="p-2 bg-muted rounded-md">
                    <div className="text-lg font-semibold">{containerSummary.k3}</div>
                    <div className="text-[10px] text-muted-foreground">K3 Mat</div>
                  </div>
                  <div className="p-2 bg-muted rounded-md">
                    <div className="text-lg font-semibold">{containerSummary.k4}</div>
                    <div className="text-[10px] text-muted-foreground">K4 Övrigt</div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Datavalidering
              </CardTitle>
              <CardDescription>Kontrollerar datakvalitet före optimering</CardDescription>
            </div>
            <Badge 
              variant={overallReadiness.status === "ok" ? "default" : overallReadiness.status === "warning" ? "secondary" : "destructive"}
              data-testid="badge-readiness-status"
            >
              {overallReadiness.message}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {validationResults.map((result) => (
            <div key={result.category} className="flex items-center gap-4">
              {getStatusIcon(result.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-sm">{result.label}</span>
                  <span className="text-sm text-muted-foreground">
                    {result.count}/{result.total}
                  </span>
                </div>
                <Progress 
                  value={result.total > 0 ? (result.count / result.total) * 100 : 0} 
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground mt-1">{result.message}</p>
              </div>
            </div>
          ))}

          <Separator className="my-4" />

          <div className="bg-muted/50 rounded-md p-4">
            <p className="text-sm text-muted-foreground mb-2">
              <strong>DataClean-integration:</strong> För avancerad datavalidering och datarensning 
              kan du använda vår DataClean-tjänst som automatiskt korrigerar adresser, 
              geokodning och formatering.
            </p>
            <Button variant="outline" size="sm" disabled>
              Öppna DataClean (kommer snart)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Skicka till optimering
          </CardTitle>
          <CardDescription>
            Skicka veckodata till Nordfield optimeringstjänst
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            {optimizationStatus === "idle" && (
              <Button onClick={handleValidate} data-testid="button-validate">
                <RefreshCw className="h-4 w-4 mr-2" />
                Validera data
              </Button>
            )}

            {optimizationStatus === "validating" && (
              <Button disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Validerar...
              </Button>
            )}

            {optimizationStatus === "ready" && (
              <>
                <Button 
                  onClick={handleSendToOptimization} 
                  disabled={overallReadiness.status === "error"}
                  data-testid="button-send-optimization"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Skicka till optimering
                </Button>
                <span className="text-sm text-muted-foreground">
                  {weekOrders.length} jobb, {activeResources.length} resurser
                </span>
              </>
            )}

            {optimizationStatus === "sending" && (
              <Button disabled>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Skickar data...
              </Button>
            )}

            {optimizationStatus === "optimizing" && (
              <div className="space-y-2 w-full max-w-md">
                <Button disabled className="w-full">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Optimerar rutt (kan ta några minuter)...
                </Button>
                <Progress value={66} className="h-2" />
              </div>
            )}

            {optimizationStatus === "completed" && (
              <div className="space-y-3 w-full">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Optimering slutförd!</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Resultatet är tillgängligt i Ruttplanering-vyn.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <a href="/routes">Visa optimerad rutt</a>
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => setOptimizationStatus("idle")}
                  >
                    Börja om
                  </Button>
                </div>
              </div>
            )}

            {optimizationStatus === "error" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">Optimering misslyckades</span>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => setOptimizationStatus("idle")}
                >
                  Försök igen
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
