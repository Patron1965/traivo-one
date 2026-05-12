import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Loader2, Truck, Car, Fuel, Wrench, AlertTriangle, CheckCircle2,
  Plus, Search, Calendar, Gauge, TrendingUp, Clock,
  ChevronRight, ChevronDown, BarChart3, DollarSign, Activity
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryState } from "@/components/QueryState";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, differenceInDays, addDays, isPast, isFuture } from "date-fns";
import { sv } from "date-fns/locale";
import { formatSek } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, LineChart, Line, PieChart, Pie, Cell, Legend
} from "recharts";
import type { Vehicle } from "@shared/schema";
import { MAINTENANCE_TYPE_LABELS } from "@shared/schema";

interface FuelLog {
  id: string;
  vehicleId: string;
  date: string;
  liters: number;
  costSek: number | null;
  pricePerLiter: number | null;
  fuelType: string | null;
  odometerReading: number | null;
  fullTank: boolean | null;
  station: string | null;
  notes: string | null;
  createdAt: string;
}

interface MaintenanceLog {
  id: string;
  vehicleId: string;
  date: string;
  maintenanceType: string;
  description: string;
  costSek: number | null;
  odometerReading: number | null;
  workshop: string | null;
  nextMaintenanceDate: string | null;
  nextMaintenanceOdometer: number | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

const VEHICLE_ICONS: Record<string, typeof Truck> = {
  bil: Car,
  lastbil: Truck,
  minibuss: Truck,
  slamsugare: Truck,
  kranfordon: Truck,
};

const FUEL_LABELS: Record<string, string> = {
  diesel: "Diesel",
  bensin: "Bensin",
  el: "El",
  hybrid: "Hybrid",
  hvo: "HVO",
};

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

const formatCurrency = (amount: number) => formatSek(amount);

function getServiceStatus(vehicle: Vehicle): { label: string; color: string; urgency: number } {
  if (!vehicle.nextServiceDate) return { label: "Ej planerad", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", urgency: 0 };
  const daysUntil = differenceInDays(new Date(vehicle.nextServiceDate), new Date());
  if (daysUntil < 0) return { label: `${Math.abs(daysUntil)} dagar försenad`, color: "bg-destructive/15 text-destructive dark:bg-destructive/15", urgency: 3 };
  if (daysUntil <= 14) return { label: `Om ${daysUntil} dagar`, color: "bg-chart-3/15 text-chart-3 dark:bg-chart-3/15", urgency: 2 };
  if (daysUntil <= 30) return { label: `Om ${daysUntil} dagar`, color: "bg-chart-1/15 text-chart-1 dark:bg-chart-1/15", urgency: 1 };
  return { label: format(new Date(vehicle.nextServiceDate), "d MMM yyyy", { locale: sv }), color: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15", urgency: 0 };
}

function getInspectionStatus(vehicle: Vehicle): { label: string; color: string } {
  if (!vehicle.inspectionDate) return { label: "Ej registrerad", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };
  const daysUntil = differenceInDays(new Date(vehicle.inspectionDate), new Date());
  if (daysUntil < 0) return { label: "Utgången", color: "bg-destructive/15 text-destructive dark:bg-destructive/15" };
  if (daysUntil <= 30) return { label: `Om ${daysUntil} dagar`, color: "bg-chart-3/15 text-chart-3 dark:bg-chart-3/15" };
  return { label: format(new Date(vehicle.inspectionDate), "d MMM yyyy", { locale: sv }), color: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15" };
}

export default function FleetManagementPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<string>("all");
  const [fuelDialogOpen, setFuelDialogOpen] = useState(false);
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null);

  const [fuelForm, setFuelForm] = useState({
    vehicleId: "", date: format(new Date(), "yyyy-MM-dd"), liters: "",
    costSek: "", pricePerLiter: "", fuelType: "diesel",
    odometerReading: "", fullTank: true, station: "", notes: "",
  });

  const [maintenanceForm, setMaintenanceForm] = useState({
    vehicleId: "", date: format(new Date(), "yyyy-MM-dd"),
    maintenanceType: "service", description: "", costSek: "",
    odometerReading: "", workshop: "", nextMaintenanceDate: "", notes: "",
  });

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  const {
    data: fuelLogs = [],
    isLoading: loadingFuel,
    isError: fuelIsError,
    error: fuelError,
    refetch: refetchFuel,
  } = useQuery<FuelLog[]>({
    queryKey: ["/api/fuel-logs"],
  });

  const {
    data: maintenanceLogs = [],
    isLoading: loadingMaintenance,
    isError: maintenanceIsError,
    error: maintenanceError,
    refetch: refetchMaintenance,
  } = useQuery<MaintenanceLog[]>({
    queryKey: ["/api/maintenance-logs"],
  });

  const createFuelMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/fuel-logs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-logs"] });
      setFuelDialogOpen(false);
      toast({ title: "Tankning registrerad" });
    },
    onError: (error: Error) => toast({ title: "Kunde inte registrera tankning", description: error.message, variant: "destructive" }),
  });

  const createMaintenanceMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/maintenance-logs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-logs"] });
      setMaintenanceDialogOpen(false);
      toast({ title: "Underhåll registrerat" });
    },
    onError: (error: Error) => toast({ title: "Kunde inte registrera underhåll", description: error.message, variant: "destructive" }),
  });

  const vehicleMap = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);

  const activeVehicles = useMemo(() => vehicles.filter(v => v.status === "active"), [vehicles]);

  const filteredVehicles = useMemo(() => {
    if (!searchQuery) return activeVehicles;
    const q = searchQuery.toLowerCase();
    return activeVehicles.filter(v =>
      v.name.toLowerCase().includes(q) || v.registrationNumber.toLowerCase().includes(q)
    );
  }, [activeVehicles, searchQuery]);

  const kpis = useMemo(() => {
    const overdueService = activeVehicles.filter(v => v.nextServiceDate && isPast(new Date(v.nextServiceDate))).length;
    const upcomingService = activeVehicles.filter(v => {
      if (!v.nextServiceDate) return false;
      const d = new Date(v.nextServiceDate);
      return isFuture(d) && differenceInDays(d, new Date()) <= 30;
    }).length;
    const totalFuelCost = fuelLogs.reduce((s, l) => s + (l.costSek || 0), 0);
    const totalFuelLiters = fuelLogs.reduce((s, l) => s + l.liters, 0);
    const totalMaintenanceCost = maintenanceLogs.reduce((s, l) => s + (l.costSek || 0), 0);
    const overdueInspection = activeVehicles.filter(v => v.inspectionDate && isPast(new Date(v.inspectionDate))).length;
    return { overdueService, upcomingService, totalFuelCost, totalFuelLiters, totalMaintenanceCost, vehicleCount: activeVehicles.length, overdueInspection };
  }, [activeVehicles, fuelLogs, maintenanceLogs]);

  const fuelByVehicle = useMemo(() => {
    const map: Record<string, { liters: number; cost: number; name: string }> = {};
    for (const log of fuelLogs) {
      const v = vehicleMap.get(log.vehicleId);
      if (!map[log.vehicleId]) map[log.vehicleId] = { liters: 0, cost: 0, name: v?.name || "Okänt" };
      map[log.vehicleId].liters += log.liters;
      map[log.vehicleId].cost += log.costSek || 0;
    }
    return Object.entries(map).map(([id, d]) => ({ vehicleId: id, ...d })).sort((a, b) => b.cost - a.cost);
  }, [fuelLogs, vehicleMap]);

  const fuelByMonth = useMemo(() => {
    const map: Record<string, { month: string; liters: number; cost: number }> = {};
    for (const log of fuelLogs) {
      const m = format(new Date(log.date), "yyyy-MM");
      if (!map[m]) map[m] = { month: m, liters: 0, cost: 0 };
      map[m].liters += log.liters;
      map[m].cost += log.costSek || 0;
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [fuelLogs]);

  const fuelByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const log of fuelLogs) {
      const t = log.fuelType || "diesel";
      map[t] = (map[t] || 0) + log.liters;
    }
    return Object.entries(map).map(([type, liters]) => ({ name: FUEL_LABELS[type] || type, value: liters }));
  }, [fuelLogs]);

  const maintenanceByType = useMemo(() => {
    const map: Record<string, { count: number; cost: number }> = {};
    for (const log of maintenanceLogs) {
      if (!map[log.maintenanceType]) map[log.maintenanceType] = { count: 0, cost: 0 };
      map[log.maintenanceType].count++;
      map[log.maintenanceType].cost += log.costSek || 0;
    }
    return Object.entries(map).map(([type, d]) => ({
      name: MAINTENANCE_TYPE_LABELS[type] || type,
      ...d,
    }));
  }, [maintenanceLogs]);

  const filteredFuelLogs = useMemo(() => {
    if (selectedVehicle === "all") return fuelLogs;
    return fuelLogs.filter(l => l.vehicleId === selectedVehicle);
  }, [fuelLogs, selectedVehicle]);

  const filteredMaintenanceLogs = useMemo(() => {
    if (selectedVehicle === "all") return maintenanceLogs;
    return maintenanceLogs.filter(l => l.vehicleId === selectedVehicle);
  }, [maintenanceLogs, selectedVehicle]);

  const handleSubmitFuel = () => {
    if (!fuelForm.vehicleId || !fuelForm.liters) {
      toast({ title: "Fyll i fordon och antal liter", variant: "destructive" });
      return;
    }
    createFuelMutation.mutate({
      vehicleId: fuelForm.vehicleId,
      date: new Date(fuelForm.date).toISOString(),
      liters: parseFloat(fuelForm.liters),
      costSek: fuelForm.costSek ? parseFloat(fuelForm.costSek) : null,
      pricePerLiter: fuelForm.pricePerLiter ? parseFloat(fuelForm.pricePerLiter) : null,
      fuelType: fuelForm.fuelType,
      odometerReading: fuelForm.odometerReading ? parseInt(fuelForm.odometerReading) : null,
      fullTank: fuelForm.fullTank,
      station: fuelForm.station || null,
      notes: fuelForm.notes || null,
    });
  };

  const handleSubmitMaintenance = () => {
    if (!maintenanceForm.vehicleId || !maintenanceForm.description) {
      toast({ title: "Fyll i fordon och beskrivning", variant: "destructive" });
      return;
    }
    createMaintenanceMutation.mutate({
      vehicleId: maintenanceForm.vehicleId,
      date: new Date(maintenanceForm.date).toISOString(),
      maintenanceType: maintenanceForm.maintenanceType,
      description: maintenanceForm.description,
      costSek: maintenanceForm.costSek ? parseFloat(maintenanceForm.costSek) : null,
      odometerReading: maintenanceForm.odometerReading ? parseInt(maintenanceForm.odometerReading) : null,
      workshop: maintenanceForm.workshop || null,
      nextMaintenanceDate: maintenanceForm.nextMaintenanceDate ? new Date(maintenanceForm.nextMaintenanceDate).toISOString() : null,
      notes: maintenanceForm.notes || null,
      status: "completed",
    });
  };

  const sortedByServiceUrgency = useMemo(() => {
    return [...filteredVehicles].sort((a, b) => {
      const sa = getServiceStatus(a);
      const sb = getServiceStatus(b);
      return sb.urgency - sa.urgency;
    });
  }, [filteredVehicles]);

  if (loadingVehicles) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" data-testid="fleet-management-page">
      <div className="p-6">
        <PageHeader icon={Truck} title="Fleethantering" description="Fordonsöversikt, underhåll och bränsleuppföljning" testId="text-page-title">
          {activeVehicles.length > 0 && (
            <Badge variant="secondary" className="text-xs font-normal">
              {activeVehicles.length} aktiva fordon
            </Badge>
          )}
          {kpis.overdueService > 0 && (
            <Badge variant="outline" className="text-xs font-normal text-destructive border-destructive/30 gap-1">
              <AlertTriangle className="h-3 w-3 text-chart-4" />
              {kpis.overdueService} försenad service
            </Badge>
          )}
          {kpis.overdueInspection > 0 && (
            <Badge variant="outline" className="text-xs font-normal text-chart-4 border-chart-4/30 gap-1">
              <AlertTriangle className="h-3 w-3 text-chart-4" />
              {kpis.overdueInspection} utgången besiktning
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" onClick={() => { setFuelForm(f => ({ ...f, vehicleId: "" })); setFuelDialogOpen(true); }} data-testid="button-add-fuel">
                <Fuel className="h-4 w-4 mr-1" /> Registrera tankning
              </Button>
            </TooltipTrigger>
            <TooltipContent>Lägg till en ny tankningspost</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => { setMaintenanceForm(f => ({ ...f, vehicleId: "" })); setMaintenanceDialogOpen(true); }} data-testid="button-add-maintenance">
                <Wrench className="h-4 w-4 mr-1" /> Registrera underhåll
              </Button>
            </TooltipTrigger>
            <TooltipContent>Registrera service eller reparation</TooltipContent>
          </Tooltip>
        </PageHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 mt-6">
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="hover-elevate cursor-help" data-testid="card-kpi-vehicles">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Truck className="h-4 w-4" /> Aktiva fordon
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-kpi-vehicle-count">{kpis.vehicleCount}</div>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>Antal fordon med status aktiv</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="hover-elevate cursor-help" data-testid="card-kpi-service-alerts">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <AlertTriangle className="h-4 w-4 text-chart-4" /> Servicevarningar
                  </div>
                  <div className="text-2xl font-bold text-destructive" data-testid="text-kpi-overdue">{kpis.overdueService}</div>
                  <p className="text-xs text-muted-foreground">{kpis.upcomingService} kommande (30 dagar)</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>Fordon med försenad eller kommande service</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="hover-elevate cursor-help" data-testid="card-kpi-fuel-cost">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Fuel className="h-4 w-4" /> Bränslekostnad
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-kpi-fuel-cost">{formatCurrency(kpis.totalFuelCost)}</div>
                  <p className="text-xs text-muted-foreground">{Math.round(kpis.totalFuelLiters)} liter totalt</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>Total bränslekostnad för alla fordon</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card className="hover-elevate cursor-help" data-testid="card-kpi-maintenance-cost">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                    <Wrench className="h-4 w-4" /> Underhållskostnad
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-kpi-maintenance-cost">{formatCurrency(kpis.totalMaintenanceCost)}</div>
                  <p className="text-xs text-muted-foreground">{maintenanceLogs.length} poster totalt</p>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent>Total kostnad för service och reparationer</TooltipContent>
          </Tooltip>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4" data-testid="tabs-fleet">
            <TabsTrigger value="overview" data-testid="tab-overview">
              <Truck className="h-4 w-4 mr-1" /> Fordonsöversikt
            </TabsTrigger>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance">
              <Wrench className="h-4 w-4 mr-1" /> Underhåll
              {kpis.overdueService > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">{kpis.overdueService}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="fuel" data-testid="tab-fuel">
              <Fuel className="h-4 w-4 mr-1" /> Bränsle
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Sök fordon..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search-vehicles" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredVehicles.map(vehicle => {
                const Icon = VEHICLE_ICONS[vehicle.vehicleType] || Truck;
                const serviceStatus = getServiceStatus(vehicle);
                const inspectionStatus = getInspectionStatus(vehicle);
                const vehicleFuelLogs = fuelLogs.filter(l => l.vehicleId === vehicle.id);
                const totalFuel = vehicleFuelLogs.reduce((s, l) => s + l.liters, 0);
                const totalFuelCost = vehicleFuelLogs.reduce((s, l) => s + (l.costSek || 0), 0);
                const vehicleMaintenanceLogs = maintenanceLogs.filter(l => l.vehicleId === vehicle.id);

                return (
                  <Card key={vehicle.id} className="hover-elevate" data-testid={`card-vehicle-${vehicle.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Icon className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-base" data-testid={`text-vehicle-name-${vehicle.id}`}>{vehicle.name}</CardTitle>
                            <p className="text-sm text-muted-foreground">{vehicle.registrationNumber}</p>
                          </div>
                        </div>
                        <Badge variant="outline">{FUEL_LABELS[vehicle.fuelType || "diesel"] || vehicle.fuelType}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Mätarställning:</span>
                          <span className="ml-1 font-medium">{vehicle.currentMileage ? `${vehicle.currentMileage.toLocaleString("sv-SE")} km` : "-"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Kapacitet:</span>
                          <span className="ml-1 font-medium">{vehicle.capacityTons ? `${vehicle.capacityTons} ton` : "-"}</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Service:</span>
                          <Badge className={serviceStatus.color} data-testid={`badge-service-${vehicle.id}`}>{serviceStatus.label}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Besiktning:</span>
                          <Badge className={inspectionStatus.color} data-testid={`badge-inspection-${vehicle.id}`}>{inspectionStatus.label}</Badge>
                        </div>
                      </div>

                      <Separator />
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div>
                          <div className="font-bold text-sm">{Math.round(totalFuel)}</div>
                          <span className="text-muted-foreground">Liter</span>
                        </div>
                        <div>
                          <div className="font-bold text-sm">{formatCurrency(totalFuelCost)}</div>
                          <span className="text-muted-foreground">Bränsle</span>
                        </div>
                        <div>
                          <div className="font-bold text-sm">{vehicleMaintenanceLogs.length}</div>
                          <span className="text-muted-foreground">Underhåll</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {filteredVehicles.length === 0 && (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    icon={Truck}
                    title="Inga fordon registrerade"
                    description="Registrera fordon för att spåra underhåll, bränsleförbrukning och fordonshistorik"
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="maintenance">
            <div className="grid gap-4 md:grid-cols-2 mb-6">
              <Card className="hover-elevate" data-testid="card-maintenance-alerts">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" /> Serviceplanering
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[300px] overflow-y-auto">
                    <div className="space-y-2">
                      {sortedByServiceUrgency.map(vehicle => {
                        const status = getServiceStatus(vehicle);
                        if (status.urgency === 0) return null;
                        return (
                          <div key={vehicle.id} className="flex items-center justify-between p-2 border rounded-md" data-testid={`row-service-alert-${vehicle.id}`}>
                            <div>
                              <span className="font-medium">{vehicle.name}</span>
                              <span className="text-sm text-muted-foreground ml-2">{vehicle.registrationNumber}</span>
                            </div>
                            <Badge className={status.color}>{status.label}</Badge>
                          </div>
                        );
                      })}
                      {sortedByServiceUrgency.every(v => getServiceStatus(v).urgency === 0) && (
                        <div className="text-center py-4 text-muted-foreground text-sm">
                          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-chart-2" />
                          Alla fordon har aktuell service
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="hover-elevate" data-testid="card-maintenance-by-type">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Underhåll per typ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {maintenanceByType.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={maintenanceByType}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <RechartsTooltip />
                        <Bar dataKey="count" fill="#3b82f6" name="Antal" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">Ingen underhållsdata</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Underhållshistorik</CardTitle>
                  <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                    <SelectTrigger className="w-[200px]" data-testid="select-maintenance-vehicle">
                      <SelectValue placeholder="Alla fordon" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alla fordon</SelectItem>
                      {activeVehicles.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.name} ({v.registrationNumber})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <QueryState
                  isLoading={loadingMaintenance}
                  isError={maintenanceIsError}
                  isEmpty={filteredMaintenanceLogs.length === 0}
                  error={maintenanceError as { message?: string } | null}
                  onRetry={() => refetchMaintenance()}
                  loadingVariant="skeleton-rows"
                  skeletonRows={5}
                  emptyTitle="Inga underhållsposter"
                  emptyDescription={
                    selectedVehicle === "all"
                      ? "Registrera service eller reparationer för att bygga upp historiken."
                      : "Inga underhållsposter för det valda fordonet."
                  }
                  emptyAction={
                    <Button variant="outline" onClick={() => { setMaintenanceForm(f => ({ ...f, vehicleId: "" })); setMaintenanceDialogOpen(true); }} data-testid="button-add-maintenance-empty">
                      <Wrench className="h-4 w-4 mr-1" /> Registrera underhåll
                    </Button>
                  }
                >
                  <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Datum</TableHead>
                          <TableHead>Fordon</TableHead>
                          <TableHead>Typ</TableHead>
                          <TableHead>Beskrivning</TableHead>
                          <TableHead>Verkstad</TableHead>
                          <TableHead className="text-right">Kostnad</TableHead>
                          <TableHead className="text-right">Mätare</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMaintenanceLogs.map(log => (
                          <TableRow key={log.id} data-testid={`row-maintenance-${log.id}`}>
                            <TableCell>{format(new Date(log.date), "d MMM yyyy", { locale: sv })}</TableCell>
                            <TableCell className="font-medium">{vehicleMap.get(log.vehicleId)?.name || "-"}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{MAINTENANCE_TYPE_LABELS[log.maintenanceType] || log.maintenanceType}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">{log.description}</TableCell>
                            <TableCell className="text-muted-foreground">{log.workshop || "-"}</TableCell>
                            <TableCell className="text-right font-medium">{log.costSek != null ? formatCurrency(log.costSek) : "-"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {log.odometerReading ? `${log.odometerReading.toLocaleString("sv-SE")} km` : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fuel">
            <div className="grid gap-4 md:grid-cols-2 mb-6">
              <Card className="hover-elevate" data-testid="card-fuel-trend">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> Bränsleförbrukning per månad
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {fuelByMonth.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={fuelByMonth}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => { const [y, m] = v.split("-"); return `${m}/${y.slice(2)}`; }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <RechartsTooltip formatter={(v: number) => [`${Math.round(v)} l`, "Liter"]} />
                        <Bar dataKey="liters" fill="#3b82f6" name="Liter" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">Ingen bränsledata</div>
                  )}
                </CardContent>
              </Card>

              <Card className="hover-elevate" data-testid="card-fuel-by-type">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Fuel className="h-4 w-4" /> Fördelning per drivmedel
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {fuelByType.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={fuelByType} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                          {fuelByType.map((_, idx) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip formatter={(v: number) => [`${Math.round(v)} l`, "Liter"]} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">Ingen bränsledata</div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-fuel-by-vehicle">
              <CardHeader>
                <CardTitle className="text-base">Bränsle per fordon</CardTitle>
              </CardHeader>
              <CardContent>
                {fuelByVehicle.length > 0 ? (
                  <ResponsiveContainer width="100%" height={Math.max(200, fuelByVehicle.length * 40)}>
                    <BarChart data={fuelByVehicle} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                      <RechartsTooltip formatter={(v: number) => [`${Math.round(v)} l`, "Liter"]} />
                      <Bar dataKey="liters" fill="#10b981" name="Liter" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">Ingen bränsledata registrerad</div>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Tankningshistorik</CardTitle>
                  <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
                    <SelectTrigger className="w-[200px]" data-testid="select-fuel-vehicle">
                      <SelectValue placeholder="Alla fordon" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alla fordon</SelectItem>
                      {activeVehicles.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.name} ({v.registrationNumber})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <QueryState
                  isLoading={loadingFuel}
                  isError={fuelIsError}
                  isEmpty={filteredFuelLogs.length === 0}
                  error={fuelError as { message?: string } | null}
                  onRetry={() => refetchFuel()}
                  loadingVariant="skeleton-rows"
                  skeletonRows={5}
                  emptyTitle="Inga tankningsposter"
                  emptyDescription={
                    selectedVehicle === "all"
                      ? "Registrera tankningar för att följa bränsleförbrukning över tid."
                      : "Inga tankningsposter för det valda fordonet."
                  }
                  emptyAction={
                    <Button variant="outline" onClick={() => { setFuelForm(f => ({ ...f, vehicleId: "" })); setFuelDialogOpen(true); }} data-testid="button-add-fuel-empty">
                      <Fuel className="h-4 w-4 mr-1" /> Registrera tankning
                    </Button>
                  }
                >
                  <div className="max-h-[400px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Datum</TableHead>
                          <TableHead>Fordon</TableHead>
                          <TableHead>Drivmedel</TableHead>
                          <TableHead className="text-right">Liter</TableHead>
                          <TableHead className="text-right">Kostnad</TableHead>
                          <TableHead className="text-right">kr/liter</TableHead>
                          <TableHead className="text-right">Mätare</TableHead>
                          <TableHead>Station</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredFuelLogs.map(log => (
                          <TableRow key={log.id} data-testid={`row-fuel-${log.id}`}>
                            <TableCell>{format(new Date(log.date), "d MMM yyyy", { locale: sv })}</TableCell>
                            <TableCell className="font-medium">{vehicleMap.get(log.vehicleId)?.name || "-"}</TableCell>
                            <TableCell>{FUEL_LABELS[log.fuelType || "diesel"] || log.fuelType}</TableCell>
                            <TableCell className="text-right">{log.liters.toFixed(1)}</TableCell>
                            <TableCell className="text-right font-medium">{log.costSek != null ? formatCurrency(log.costSek) : "-"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {log.pricePerLiter != null ? `${log.pricePerLiter.toFixed(2)}` : "-"}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {log.odometerReading ? `${log.odometerReading.toLocaleString("sv-SE")} km` : "-"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{log.station || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </QueryState>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={fuelDialogOpen} onOpenChange={setFuelDialogOpen}>
        <DialogContent data-testid="dialog-add-fuel">
          <DialogHeader>
            <DialogTitle>Registrera tankning</DialogTitle>
            <DialogDescription>Lägg till en ny bränslelogg</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-sm font-medium">Fordon *</label>
              <Select value={fuelForm.vehicleId} onValueChange={v => setFuelForm(f => ({ ...f, vehicleId: v }))}>
                <SelectTrigger data-testid="select-fuel-form-vehicle">
                  <SelectValue placeholder="Välj fordon" />
                </SelectTrigger>
                <SelectContent>
                  {activeVehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name} ({v.registrationNumber})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Datum *</label>
                <Input type="date" value={fuelForm.date} onChange={e => setFuelForm(f => ({ ...f, date: e.target.value }))} data-testid="input-fuel-date" />
              </div>
              <div>
                <label className="text-sm font-medium">Drivmedel</label>
                <Select value={fuelForm.fuelType} onValueChange={v => setFuelForm(f => ({ ...f, fuelType: v }))}>
                  <SelectTrigger data-testid="select-fuel-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="bensin">Bensin</SelectItem>
                    <SelectItem value="el">El</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                    <SelectItem value="hvo">HVO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium">Liter *</label>
                <Input type="number" step="0.1" value={fuelForm.liters} onChange={e => setFuelForm(f => ({ ...f, liters: e.target.value }))} data-testid="input-fuel-liters" />
              </div>
              <div>
                <label className="text-sm font-medium">Kostnad (kr)</label>
                <Input type="number" step="1" value={fuelForm.costSek} onChange={e => setFuelForm(f => ({ ...f, costSek: e.target.value }))} data-testid="input-fuel-cost" />
              </div>
              <div>
                <label className="text-sm font-medium">kr/liter</label>
                <Input type="number" step="0.01" value={fuelForm.pricePerLiter} onChange={e => setFuelForm(f => ({ ...f, pricePerLiter: e.target.value }))} data-testid="input-fuel-price" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Mätarställning</label>
                <Input type="number" value={fuelForm.odometerReading} onChange={e => setFuelForm(f => ({ ...f, odometerReading: e.target.value }))} data-testid="input-fuel-odometer" />
              </div>
              <div>
                <label className="text-sm font-medium">Station</label>
                <Input value={fuelForm.station} onChange={e => setFuelForm(f => ({ ...f, station: e.target.value }))} data-testid="input-fuel-station" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFuelDialogOpen(false)} data-testid="button-cancel-fuel">Avbryt</Button>
            <Button onClick={handleSubmitFuel} disabled={createFuelMutation.isPending} data-testid="button-submit-fuel">
              {createFuelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Fuel className="h-4 w-4 mr-1" />}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={maintenanceDialogOpen} onOpenChange={setMaintenanceDialogOpen}>
        <DialogContent data-testid="dialog-add-maintenance">
          <DialogHeader>
            <DialogTitle>Registrera underhåll</DialogTitle>
            <DialogDescription>Lägg till en ny underhållspost</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-sm font-medium">Fordon *</label>
              <Select value={maintenanceForm.vehicleId} onValueChange={v => setMaintenanceForm(f => ({ ...f, vehicleId: v }))}>
                <SelectTrigger data-testid="select-maintenance-form-vehicle">
                  <SelectValue placeholder="Välj fordon" />
                </SelectTrigger>
                <SelectContent>
                  {activeVehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name} ({v.registrationNumber})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Datum *</label>
                <Input type="date" value={maintenanceForm.date} onChange={e => setMaintenanceForm(f => ({ ...f, date: e.target.value }))} data-testid="input-maintenance-date" />
              </div>
              <div>
                <label className="text-sm font-medium">Typ</label>
                <Select value={maintenanceForm.maintenanceType} onValueChange={v => setMaintenanceForm(f => ({ ...f, maintenanceType: v }))}>
                  <SelectTrigger data-testid="select-maintenance-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="reparation">Reparation</SelectItem>
                    <SelectItem value="besiktning">Besiktning</SelectItem>
                    <SelectItem value="dack">Däckbyte</SelectItem>
                    <SelectItem value="olja">Oljebyte</SelectItem>
                    <SelectItem value="bromsar">Bromsar</SelectItem>
                    <SelectItem value="annat">Annat</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Beskrivning *</label>
              <Input value={maintenanceForm.description} onChange={e => setMaintenanceForm(f => ({ ...f, description: e.target.value }))} placeholder="Beskriv utfört arbete" data-testid="input-maintenance-description" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium">Kostnad (kr)</label>
                <Input type="number" value={maintenanceForm.costSek} onChange={e => setMaintenanceForm(f => ({ ...f, costSek: e.target.value }))} data-testid="input-maintenance-cost" />
              </div>
              <div>
                <label className="text-sm font-medium">Mätarställning</label>
                <Input type="number" value={maintenanceForm.odometerReading} onChange={e => setMaintenanceForm(f => ({ ...f, odometerReading: e.target.value }))} data-testid="input-maintenance-odometer" />
              </div>
              <div>
                <label className="text-sm font-medium">Verkstad</label>
                <Input value={maintenanceForm.workshop} onChange={e => setMaintenanceForm(f => ({ ...f, workshop: e.target.value }))} data-testid="input-maintenance-workshop" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Nästa planerade service</label>
              <Input type="date" value={maintenanceForm.nextMaintenanceDate} onChange={e => setMaintenanceForm(f => ({ ...f, nextMaintenanceDate: e.target.value }))} data-testid="input-maintenance-next-date" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaintenanceDialogOpen(false)} data-testid="button-cancel-maintenance">Avbryt</Button>
            <Button onClick={handleSubmitMaintenance} disabled={createMaintenanceMutation.isPending} data-testid="button-submit-maintenance">
              {createMaintenanceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wrench className="h-4 w-4 mr-1" />}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
