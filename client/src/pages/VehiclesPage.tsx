import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  Truck,
  Car,
  Wrench,
  Fuel,
  AlertTriangle,
  CheckCircle,
  Settings,
  MoreHorizontal,
  BarChart3,
  CalendarClock,
  Gauge,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, differenceInDays } from "date-fns";
import { sv } from "date-fns/locale";
import type { Vehicle, Equipment } from "@shared/schema";

const vehicleTypeOptions = [
  { value: "bil", label: "Personbil", icon: Car },
  { value: "lastbil", label: "Lastbil", icon: Truck },
  { value: "minibuss", label: "Minibuss", icon: Truck },
  { value: "slamsugare", label: "Slamsugare", icon: Truck },
  { value: "kranfordon", label: "Kranfordon", icon: Truck },
];

const fuelTypeOptions = [
  { value: "diesel", label: "Diesel" },
  { value: "bensin", label: "Bensin" },
  { value: "el", label: "El" },
  { value: "hybrid", label: "Hybrid" },
  { value: "hvo", label: "HVO" },
];

const equipmentTypeOptions = [
  { value: "verktyg", label: "Verktyg" },
  { value: "maskin", label: "Maskin" },
  { value: "fordonsutrustning", label: "Fordonsutrustning" },
  { value: "sakerhet", label: "Säkerhetsutrustning" },
];

const vehicleFormSchema = z.object({
  registrationNumber: z.string().min(1, "Registreringsnummer krävs"),
  name: z.string().min(1, "Namn krävs"),
  vehicleType: z.string().default("bil"),
  capacityTons: z.string().optional(),
  capacityVolume: z.string().optional(),
  costCenter: z.string().optional(),
  fuelType: z.string().default("diesel"),
  serviceIntervalDays: z.coerce.number().default(90),
  notes: z.string().optional(),
  status: z.string().default("active"),
});

const equipmentFormSchema = z.object({
  name: z.string().min(1, "Namn krävs"),
  inventoryNumber: z.string().optional(),
  equipmentType: z.string().default("verktyg"),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  costCenter: z.string().optional(),
  notes: z.string().optional(),
  status: z.string().default("active"),
});

type VehicleFormValues = z.infer<typeof vehicleFormSchema>;
type EquipmentFormValues = z.infer<typeof equipmentFormSchema>;

export default function VehiclesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("vehicles");
  const [searchQuery, setSearchQuery] = useState("");
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false);
  const [equipmentDialogOpen, setEquipmentDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{ type: "vehicle" | "equipment"; id: string; name: string } | null>(null);

  const vehicleForm = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: {
      registrationNumber: "",
      name: "",
      vehicleType: "bil",
      capacityTons: "",
      capacityVolume: "",
      costCenter: "",
      fuelType: "diesel",
      serviceIntervalDays: 90,
      notes: "",
      status: "active",
    },
  });

  const equipmentForm = useForm<EquipmentFormValues>({
    resolver: zodResolver(equipmentFormSchema),
    defaultValues: {
      name: "",
      inventoryNumber: "",
      equipmentType: "verktyg",
      manufacturer: "",
      model: "",
      costCenter: "",
      notes: "",
      status: "active",
    },
  });

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  const { data: equipment = [], isLoading: loadingEquipment } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  const createVehicleMutation = useMutation({
    mutationFn: (data: VehicleFormValues) => {
      const payload = {
        ...data,
        capacityTons: data.capacityTons ? parseFloat(data.capacityTons) : null,
        capacityVolume: data.capacityVolume ? parseFloat(data.capacityVolume) : null,
        tenantId: "default-tenant",
      };
      return apiRequest("POST", "/api/vehicles", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setVehicleDialogOpen(false);
      vehicleForm.reset();
      toast({ title: "Fordon skapat", description: "Fordonet har lagts till." });
    },
    onError: (error: Error) => toast({ title: "Fel", description: error.message, variant: "destructive" }),
  });

  const updateVehicleMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: VehicleFormValues }) => {
      const payload = {
        ...data,
        capacityTons: data.capacityTons ? parseFloat(data.capacityTons) : null,
        capacityVolume: data.capacityVolume ? parseFloat(data.capacityVolume) : null,
      };
      return apiRequest("PATCH", `/api/vehicles/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setVehicleDialogOpen(false);
      setEditingVehicle(null);
      vehicleForm.reset();
      toast({ title: "Fordon uppdaterat" });
    },
    onError: (error: Error) => toast({ title: "Fel", description: error.message, variant: "destructive" }),
  });

  const deleteVehicleMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/vehicles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      toast({ title: "Fordon borttaget" });
    },
    onError: (error: Error) => toast({ title: "Fel", description: error.message, variant: "destructive" }),
  });

  const createEquipmentMutation = useMutation({
    mutationFn: (data: EquipmentFormValues) => {
      const payload = {
        ...data,
        tenantId: "default-tenant",
      };
      return apiRequest("POST", "/api/equipment", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setEquipmentDialogOpen(false);
      equipmentForm.reset();
      toast({ title: "Utrustning skapad", description: "Utrustningen har lagts till." });
    },
    onError: (error: Error) => toast({ title: "Fel", description: error.message, variant: "destructive" }),
  });

  const updateEquipmentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EquipmentFormValues }) =>
      apiRequest("PATCH", `/api/equipment/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setEquipmentDialogOpen(false);
      setEditingEquipment(null);
      equipmentForm.reset();
      toast({ title: "Utrustning uppdaterad" });
    },
    onError: (error: Error) => toast({ title: "Fel", description: error.message, variant: "destructive" }),
  });

  const deleteEquipmentMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/equipment/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      toast({ title: "Utrustning borttagen" });
    },
    onError: (error: Error) => toast({ title: "Fel", description: error.message, variant: "destructive" }),
  });

  const filteredVehicles = useMemo(() => {
    if (!searchQuery) return vehicles;
    const query = searchQuery.toLowerCase();
    return vehicles.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.registrationNumber.toLowerCase().includes(query)
    );
  }, [vehicles, searchQuery]);

  const filteredEquipment = useMemo(() => {
    if (!searchQuery) return equipment;
    const query = searchQuery.toLowerCase();
    return equipment.filter(
      (e) =>
        e.name.toLowerCase().includes(query) ||
        (e.inventoryNumber && e.inventoryNumber.toLowerCase().includes(query))
    );
  }, [equipment, searchQuery]);

  const handleEditVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    vehicleForm.reset({
      registrationNumber: vehicle.registrationNumber,
      name: vehicle.name,
      vehicleType: vehicle.vehicleType,
      capacityTons: vehicle.capacityTons?.toString() || "",
      capacityVolume: vehicle.capacityVolume?.toString() || "",
      costCenter: vehicle.costCenter || "",
      fuelType: vehicle.fuelType || "diesel",
      serviceIntervalDays: vehicle.serviceIntervalDays || 90,
      notes: vehicle.notes || "",
      status: vehicle.status,
    });
    setVehicleDialogOpen(true);
  };

  const handleEditEquipment = (eq: Equipment) => {
    setEditingEquipment(eq);
    equipmentForm.reset({
      name: eq.name,
      inventoryNumber: eq.inventoryNumber || "",
      equipmentType: eq.equipmentType,
      manufacturer: eq.manufacturer || "",
      model: eq.model || "",
      costCenter: eq.costCenter || "",
      notes: eq.notes || "",
      status: eq.status,
    });
    setEquipmentDialogOpen(true);
  };

  const onSubmitVehicle = (data: VehicleFormValues) => {
    if (editingVehicle) {
      updateVehicleMutation.mutate({ id: editingVehicle.id, data });
    } else {
      createVehicleMutation.mutate(data);
    }
  };

  const onSubmitEquipment = (data: EquipmentFormValues) => {
    if (editingEquipment) {
      updateEquipmentMutation.mutate({ id: editingEquipment.id, data });
    } else {
      createEquipmentMutation.mutate(data);
    }
  };

  const handleDelete = () => {
    if (!itemToDelete) return;
    if (itemToDelete.type === "vehicle") {
      deleteVehicleMutation.mutate(itemToDelete.id);
    } else {
      deleteEquipmentMutation.mutate(itemToDelete.id);
    }
  };

  const getServiceStatus = (vehicle: Vehicle) => {
    if (!vehicle.nextServiceDate) return { status: "unknown", label: "Okänt" };
    const nextService = new Date(vehicle.nextServiceDate);
    const today = new Date();
    const daysUntil = differenceInDays(nextService, today);

    if (daysUntil < 0) return { status: "overdue", label: `${Math.abs(daysUntil)} dagar försenad` };
    if (daysUntil <= 14) return { status: "soon", label: `${daysUntil} dagar kvar` };
    return { status: "ok", label: format(nextService, "d MMM yyyy", { locale: sv }) };
  };

  const isLoading = loadingVehicles || loadingEquipment;

  const fleetStats = useMemo(() => {
    const activeVehicles = vehicles.filter(v => v.status === "active");
    let serviceOverdue = 0;
    let serviceSoon = 0;
    let serviceOk = 0;
    for (const v of activeVehicles) {
      const s = getServiceStatus(v);
      if (s.status === "overdue") serviceOverdue++;
      else if (s.status === "soon") serviceSoon++;
      else if (s.status === "ok") serviceOk++;
    }
    return {
      total: vehicles.length,
      active: activeVehicles.length,
      equipmentCount: equipment.length,
      serviceOverdue,
      serviceSoon,
      serviceOk,
    };
  }, [vehicles, equipment]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Fordonspark och Utrustning</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">Hantera fordon, maskiner och verktyg</span>
            {fleetStats.active > 0 && (
              <Badge variant="secondary" className="text-xs font-normal gap-1">
                <Truck className="h-3 w-3" />
                {fleetStats.active} aktiva fordon
              </Badge>
            )}
            {fleetStats.serviceOverdue > 0 && (
              <Badge variant="outline" className="text-xs font-normal gap-1 text-red-600 border-red-300">
                <CircleAlert className="h-3 w-3" />
                {fleetStats.serviceOverdue} service försenad
              </Badge>
            )}
            {fleetStats.serviceSoon > 0 && (
              <Badge variant="outline" className="text-xs font-normal gap-1 text-amber-600 border-amber-300">
                <AlertTriangle className="h-3 w-3" />
                {fleetStats.serviceSoon} service snart
              </Badge>
            )}
            {fleetStats.serviceOk > 0 && fleetStats.serviceOverdue === 0 && fleetStats.serviceSoon === 0 && (
              <Badge variant="outline" className="text-xs font-normal gap-1 text-green-600 border-green-300">
                <CircleCheck className="h-3 w-3" />
                Alla servade
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[200px]"
              data-testid="input-search"
            />
          </div>
          <Link href="/fleet">
            <Button variant="outline" size="sm" data-testid="button-fleet-dashboard">
              <BarChart3 className="h-4 w-4 mr-2" />
              Fordonsdashboard
            </Button>
          </Link>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="vehicles" data-testid="tab-vehicles">
            <Truck className="h-4 w-4 mr-2" />
            Fordon ({vehicles.length})
          </TabsTrigger>
          <TabsTrigger value="equipment" data-testid="tab-equipment">
            <Wrench className="h-4 w-4 mr-2" />
            Utrustning ({equipment.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                setEditingVehicle(null);
                vehicleForm.reset();
                setVehicleDialogOpen(true);
              }}
              data-testid="button-add-vehicle"
            >
              <Plus className="h-4 w-4 mr-2" />
              Lägg till fordon
            </Button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredVehicles.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Inga fordon registrerade</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredVehicles.map((vehicle) => {
                const TypeIcon = vehicleTypeOptions.find((t) => t.value === vehicle.vehicleType)?.icon || Truck;
                const serviceStatus = getServiceStatus(vehicle);

                return (
                  <Card key={vehicle.id} className="overflow-visible" data-testid={`card-vehicle-${vehicle.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-md bg-primary/10">
                            <TypeIcon className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-base">{vehicle.name}</CardTitle>
                            <p className="text-sm text-muted-foreground font-mono">
                              {vehicle.registrationNumber}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant={vehicle.status === "active" ? "default" : "secondary"}>
                            {vehicle.status === "active" ? "Aktiv" : "Inaktiv"}
                          </Badge>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleEditVehicle(vehicle)}
                                data-testid={`button-edit-vehicle-${vehicle.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Redigera</p></TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-more-vehicle-${vehicle.id}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href="/fleet">
                                  <BarChart3 className="h-4 w-4 mr-2" />
                                  Bränsle & underhåll
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  setItemToDelete({ type: "vehicle", id: vehicle.id, name: vehicle.name });
                                  setDeleteDialogOpen(true);
                                }}
                                data-testid={`menu-delete-vehicle-${vehicle.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Ta bort fordon
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Fuel className="h-3 w-3" />
                          {fuelTypeOptions.find((f) => f.value === vehicle.fuelType)?.label || vehicle.fuelType}
                        </span>
                        {vehicle.capacityTons && (
                          <span>{vehicle.capacityTons} ton</span>
                        )}
                        {vehicle.costCenter && (
                          <Badge variant="outline" className="text-[10px]">{vehicle.costCenter}</Badge>
                        )}
                      </div>

                      <Separator />

                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Settings className="h-3 w-3" />
                            Nästa service
                          </span>
                          <span className="flex items-center gap-1">
                            {serviceStatus.status === "overdue" && <AlertTriangle className="h-3 w-3 text-red-500" />}
                            {serviceStatus.status === "soon" && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                            {serviceStatus.status === "ok" && <CheckCircle className="h-3 w-3 text-green-500" />}
                            <span className={serviceStatus.status === "overdue" ? "text-red-500 font-medium" : serviceStatus.status === "soon" ? "text-amber-500" : ""}>
                              {serviceStatus.status === "unknown" ? "Ej planerad" : serviceStatus.label}
                            </span>
                          </span>
                        </div>
                        {vehicle.odometerReading && (
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <Gauge className="h-3 w-3" />
                              Mätarställning
                            </span>
                            <span>{vehicle.odometerReading.toLocaleString("sv")} km</span>
                          </div>
                        )}
                        {vehicle.inspectionDate && (
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <CalendarClock className="h-3 w-3" />
                              Besiktning
                            </span>
                            <span>{format(new Date(vehicle.inspectionDate), "d MMM yyyy", { locale: sv })}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="equipment" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                setEditingEquipment(null);
                equipmentForm.reset();
                setEquipmentDialogOpen(true);
              }}
              data-testid="button-add-equipment"
            >
              <Plus className="h-4 w-4 mr-2" />
              Lägg till utrustning
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEquipment.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Ingen utrustning registrerad</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEquipment.map((eq) => (
                <Card key={eq.id} className="overflow-visible" data-testid={`card-equipment-${eq.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{eq.name}</CardTitle>
                        {eq.inventoryNumber && (
                          <p className="text-sm text-muted-foreground font-mono">
                            {eq.inventoryNumber}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant={eq.status === "active" ? "default" : "secondary"}>
                          {eq.status === "active" ? "Aktiv" : "Inaktiv"}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditEquipment(eq)}
                              data-testid={`button-edit-equipment-${eq.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Redigera</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setItemToDelete({ type: "equipment", id: eq.id, name: eq.name });
                                setDeleteDialogOpen(true);
                              }}
                              data-testid={`button-delete-equipment-${eq.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Ta bort</p></TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      {equipmentTypeOptions.find((t) => t.value === eq.equipmentType)?.label || eq.equipmentType}
                    </div>
                    {(eq.manufacturer || eq.model) && (
                      <div className="text-sm">
                        {eq.manufacturer} {eq.model}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Vehicle Dialog */}
      <Dialog open={vehicleDialogOpen} onOpenChange={setVehicleDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingVehicle ? "Redigera fordon" : "Lägg till fordon"}</DialogTitle>
            <DialogDescription>
              {editingVehicle ? "Uppdatera fordonets uppgifter" : "Registrera ett nytt fordon"}
            </DialogDescription>
          </DialogHeader>
          <Form {...vehicleForm}>
            <form onSubmit={vehicleForm.handleSubmit(onSubmitVehicle)} className="space-y-4">
              <FormField
                control={vehicleForm.control}
                name="registrationNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Registreringsnummer</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        placeholder="ABC123"
                        data-testid="input-reg-number"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={vehicleForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn/Beskrivning</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Sopbil 1" data-testid="input-vehicle-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={vehicleForm.control}
                  name="vehicleType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fordonstyp</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-vehicle-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {vehicleTypeOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={vehicleForm.control}
                  name="fuelType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Drivmedel</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-fuel-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {fuelTypeOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={vehicleForm.control}
                  name="capacityTons"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kapacitet (ton)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.1"
                          placeholder="3.5"
                          data-testid="input-capacity-tons"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={vehicleForm.control}
                  name="costCenter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kostnadsställe</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="KS-001" data-testid="input-cost-center" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={vehicleForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-vehicle-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Aktiv</SelectItem>
                        <SelectItem value="inactive">Inaktiv</SelectItem>
                        <SelectItem value="service">I service</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setVehicleDialogOpen(false)}>
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={createVehicleMutation.isPending || updateVehicleMutation.isPending}
                  data-testid="button-save-vehicle"
                >
                  {(createVehicleMutation.isPending || updateVehicleMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingVehicle ? "Uppdatera" : "Lägg till"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Equipment Dialog */}
      <Dialog open={equipmentDialogOpen} onOpenChange={setEquipmentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEquipment ? "Redigera utrustning" : "Lägg till utrustning"}</DialogTitle>
            <DialogDescription>
              {editingEquipment ? "Uppdatera utrustningens uppgifter" : "Registrera ny utrustning"}
            </DialogDescription>
          </DialogHeader>
          <Form {...equipmentForm}>
            <form onSubmit={equipmentForm.handleSubmit(onSubmitEquipment)} className="space-y-4">
              <FormField
                control={equipmentForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Högtryckstvätt" data-testid="input-equipment-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={equipmentForm.control}
                  name="inventoryNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inventarienummer</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="INV-001" data-testid="input-inventory-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={equipmentForm.control}
                  name="equipmentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Typ</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-equipment-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {equipmentTypeOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={equipmentForm.control}
                  name="manufacturer"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tillverkare</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Kärcher" data-testid="input-manufacturer" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={equipmentForm.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Modell</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="K5" data-testid="input-model" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={equipmentForm.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-equipment-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Aktiv</SelectItem>
                        <SelectItem value="inactive">Inaktiv</SelectItem>
                        <SelectItem value="repair">Reparation</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEquipmentDialogOpen(false)}>
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={createEquipmentMutation.isPending || updateEquipmentMutation.isPending}
                  data-testid="button-save-equipment"
                >
                  {(createEquipmentMutation.isPending || updateEquipmentMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {editingEquipment ? "Uppdatera" : "Lägg till"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bekräfta borttagning</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort {itemToDelete?.type === "vehicle" ? "fordonet" : "utrustningen"}{" "}
              <strong>{itemToDelete?.name}</strong>? Detta går inte att ångra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
