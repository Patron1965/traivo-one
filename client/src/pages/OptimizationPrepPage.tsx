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
  Loader2
} from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, isWithinInterval, parseISO } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrder, Resource, ServiceObject } from "@shared/schema";

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

  const { data: workOrders = [], isLoading: loadingOrders } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: resources = [], isLoading: loadingResources } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: objects = [], isLoading: loadingObjects } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const weekOrders = useMemo(() => {
    return workOrders.filter(order => {
      if (!order.scheduledDate) return false;
      const orderDate = typeof order.scheduledDate === 'string' 
        ? parseISO(order.scheduledDate) 
        : order.scheduledDate;
      return isWithinInterval(orderDate, { start: selectedWeek, end: weekEnd });
    });
  }, [workOrders, selectedWeek, weekEnd]);

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
            Skicka veckodata till Nordic Routing optimeringstjänst
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
