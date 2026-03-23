import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTerminology } from "@/hooks/use-terminology";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  MapPin,
  Loader2,
  Pencil,
  Trash2,
  Package,
  FileText,
  Clock,
  DollarSign,
  RefreshCw,
  ChevronRight,
  Target,
  Users,
  List,
  Map,
  MoreHorizontal,
  Sparkles,
  Layers,
} from "lucide-react";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { QueryErrorState } from "@/components/ErrorBoundary";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { AddressSearch } from "@/components/AddressSearch";
import { AICard } from "@/components/AICard";
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Cluster, Team, Customer } from "@shared/schema";
import { useMapConfig } from "@/hooks/use-map-config";

const SLA_LEVELS = [
  { value: "standard", label: "Standard", color: "bg-muted text-muted-foreground" },
  { value: "premium", label: "Premium", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  { value: "enterprise", label: "Enterprise", color: "bg-purple-500/20 text-purple-700 dark:text-purple-300" },
];

const SLA_COLORS: Record<string, string> = {
  standard: "#6b7280",
  premium: "#3b82f6",
  enterprise: "#a855f7",
};

const PERIODICITY_OPTIONS = [
  { value: "dag", label: "Dagligen" },
  { value: "vecka", label: "Varje vecka" },
  { value: "varannan_vecka", label: "Varannan vecka" },
  { value: "manad", label: "Varje månad" },
  { value: "kvartal", label: "Varje kvartal" },
  { value: "halvår", label: "Varje halvår" },
  { value: "år", label: "Varje år" },
];

const TIME_SLOT_OPTIONS = [
  { value: "07:00-09:00", label: "Tidig morgon (07-09)" },
  { value: "09:00-12:00", label: "Förmiddag (09-12)" },
  { value: "12:00-15:00", label: "Eftermiddag (12-15)" },
  { value: "15:00-18:00", label: "Sen eftermiddag (15-18)" },
  { value: "heldag", label: "Heldag" },
];

const COLOR_PRESETS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
];

const clusterFormSchema = z.object({
  name: z.string().min(1, "Namn krävs"),
  description: z.string().optional(),
  rootCustomerId: z.string().optional(),
  centerLatitude: z.string().optional(),
  centerLongitude: z.string().optional(),
  radiusKm: z.string().optional(),
  postalCodes: z.string().optional(),
  slaLevel: z.string().default("standard"),
  primaryTeamId: z.string().optional(),
  defaultPeriodicity: z.string().default("vecka"),
  defaultPreferredTime: z.string().optional(),
  color: z.string().default("#3B82F6"),
});

type ClusterFormValues = z.infer<typeof clusterFormSchema>;

const createClusterIcon = (color: string) => {
  return L.divIcon({
    className: "custom-cluster-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 14px;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    "><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

interface MapFitBoundsProps {
  clusters: Cluster[];
}

function MapFitBounds({ clusters }: MapFitBoundsProps) {
  const map = useMap();
  
  useEffect(() => {
    const positions = clusters
      .filter(c => c.centerLatitude && c.centerLongitude)
      .map(c => L.latLng(c.centerLatitude!, c.centerLongitude!));
    
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 11 });
    } else {
      map.setView([59.3293, 18.0686], 10);
    }
  }, [map, clusters]);
  
  return null;
}

export default function ClustersPage() {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const { t } = useTerminology();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null);
  const [clusterToDelete, setClusterToDelete] = useState<Cluster | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);

  const form = useForm<ClusterFormValues>({
    resolver: zodResolver(clusterFormSchema),
    defaultValues: {
      name: "",
      description: "",
      rootCustomerId: "",
      centerLatitude: "",
      centerLongitude: "",
      radiusKm: "5",
      postalCodes: "",
      slaLevel: "standard",
      primaryTeamId: "",
      defaultPeriodicity: "vecka",
      defaultPreferredTime: "",
      color: "#3B82F6",
    },
  });

  const { data: clusters = [], isLoading, error } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Cluster>) => apiRequest("POST", "/api/clusters", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Kluster skapat", description: "Klustret har lagts till" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa kluster", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Cluster> }) =>
      apiRequest("PATCH", `/api/clusters/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      setDialogOpen(false);
      setEditingCluster(null);
      form.reset();
      toast({ title: "Kluster uppdaterat", description: "Ändringar har sparats" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte uppdatera kluster", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/clusters/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      setDeleteDialogOpen(false);
      setClusterToDelete(null);
      toast({ title: "Kluster borttaget", description: "Klustret har tagits bort" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort kluster", variant: "destructive" });
    },
  });

  const refreshCacheMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/clusters/${id}/refresh-cache`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      toast({ title: "Cache uppdaterad", description: "Klusterstatistik har uppdaterats" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte uppdatera cache", variant: "destructive" });
    },
  });

  const handleOpenCreate = () => {
    setEditingCluster(null);
    form.reset({
      name: "",
      description: "",
      rootCustomerId: "",
      centerLatitude: "",
      centerLongitude: "",
      radiusKm: "5",
      postalCodes: "",
      slaLevel: "standard",
      primaryTeamId: "",
      defaultPeriodicity: "vecka",
      defaultPreferredTime: "",
      color: "#3B82F6",
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (cluster: Cluster) => {
    setEditingCluster(cluster);
    form.reset({
      name: cluster.name,
      description: cluster.description || "",
      rootCustomerId: (cluster as any).rootCustomerId || "",
      centerLatitude: cluster.centerLatitude?.toString() || "",
      centerLongitude: cluster.centerLongitude?.toString() || "",
      radiusKm: cluster.radiusKm?.toString() || "5",
      postalCodes: cluster.postalCodes?.join(", ") || "",
      slaLevel: cluster.slaLevel || "standard",
      primaryTeamId: cluster.primaryTeamId || "",
      defaultPeriodicity: cluster.defaultPeriodicity || "vecka",
      defaultPreferredTime: cluster.defaultPreferredTime || "",
      color: cluster.color || "#3B82F6",
    });
    setDialogOpen(true);
  };

  const onSubmit = (values: ClusterFormValues) => {
    const payload = {
      name: values.name,
      description: values.description || null,
      rootCustomerId: values.rootCustomerId === "none" ? null : values.rootCustomerId || null,
      centerLatitude: values.centerLatitude ? parseFloat(values.centerLatitude) : null,
      centerLongitude: values.centerLongitude ? parseFloat(values.centerLongitude) : null,
      radiusKm: values.radiusKm ? parseFloat(values.radiusKm) : null,
      postalCodes: values.postalCodes
        ? values.postalCodes.split(",").map((s) => s.trim()).filter(Boolean)
        : null,
      slaLevel: values.slaLevel,
      primaryTeamId: values.primaryTeamId === "none" ? null : values.primaryTeamId || null,
      defaultPeriodicity: values.defaultPeriodicity || "vecka",
      defaultPreferredTime: values.defaultPreferredTime === "none" ? null : values.defaultPreferredTime || null,
      color: values.color || "#3B82F6",
    };

    if (editingCluster) {
      updateMutation.mutate({ id: editingCluster.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (cluster: Cluster) => {
    setClusterToDelete(cluster);
    setDeleteDialogOpen(true);
  };

  const getSlaInfo = (level: string | null) => {
    return SLA_LEVELS.find((s) => s.value === level) || SLA_LEVELS[0];
  };

  const getTeamName = (teamId: string | null) => {
    if (!teamId) return null;
    const team = (teams || []).find((t) => t.id === teamId);
    return team?.name || null;
  };

  const getCustomerName = (customerId: string | null) => {
    if (!customerId) return null;
    const customer = (customers || []).find((c) => c.id === customerId);
    return customer?.name || null;
  };

  const filteredClusters = (clusters || []).filter((cluster) =>
    cluster.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const clustersWithCoordinates = useMemo(() => 
    filteredClusters.filter(c => c.centerLatitude && c.centerLongitude),
    [filteredClusters]
  );

  const selectedCluster = selectedClusterId 
    ? (clusters || []).find(c => c.id === selectedClusterId) 
    : null;

  const quickStats = useMemo(() => {
    const total = clusters.length;
    const totalObjects = clusters.reduce((sum, c) => sum + (c.cachedObjectCount ?? 0), 0);
    const totalOrders = clusters.reduce((sum, c) => sum + (c.cachedActiveOrders ?? 0), 0);
    const slaCounts: Record<string, number> = {};
    for (const c of clusters) {
      const sla = c.slaLevel || "standard";
      slaCounts[sla] = (slaCounts[sla] || 0) + 1;
    }
    const withCoords = clusters.filter(c => c.centerLatitude && c.centerLongitude).length;
    return { total, totalObjects, totalOrders, slaCounts, withCoords };
  }, [clusters]);

  if (error) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kunde inte ladda kluster" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("cluster_plural")}</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">
              Kundhierarkier med dataärvning - navet i verksamheten
              <HelpTooltip content="Kluster grupperar objekt geografiskt för att optimera rutter och planering. Varje kluster kan ha eget team, SLA-nivå och servicefrekvens." />
            </span>
            {quickStats.total > 0 && (
              <Badge variant="secondary" className="text-xs font-normal gap-1">
                <Layers className="h-3 w-3" />
                {quickStats.total} kluster
              </Badge>
            )}
            {quickStats.totalObjects > 0 && (
              <Badge variant="outline" className="text-xs font-normal gap-1">
                <Package className="h-3 w-3" />
                {quickStats.totalObjects.toLocaleString("sv")} objekt totalt
              </Badge>
            )}
            {quickStats.totalOrders > 0 && (
              <Badge variant="outline" className="text-xs font-normal gap-1">
                <FileText className="h-3 w-3" />
                {quickStats.totalOrders} aktiva ordrar
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/auto-cluster")} data-testid="button-auto-cluster">
            <Sparkles className="mr-2 h-4 w-4" />
            Auto-klustring
          </Button>
          <Button onClick={handleOpenCreate} data-testid="button-create-cluster">
            <Plus className="mr-2 h-4 w-4" />
            Nytt Kluster
          </Button>
        </div>
      </div>

      <AICard
        title="AI Klusteranalys"
        variant="compact"
        defaultExpanded={false}
        insights={[
          { type: "optimization", title: "Hierarkioptimering", description: "AI kan analysera kundhierarkier och föreslå bättre strukturer" },
          { type: "suggestion", title: "Ärvningsanalys", description: "Identifiera objekt som saknar ärvd data" },
          { type: "info", title: "Automatisk ärvning", description: "Bearbeta ärvning för alla objekt i klustret" },
        ]}
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Sök ${t("cluster_plural").toLowerCase()}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-clusters"
          />
        </div>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "map")}>
          <TabsList>
            <TabsTrigger value="list" data-testid="tab-list">
              <List className="h-4 w-4 mr-1" />
              Lista
            </TabsTrigger>
            <TabsTrigger value="map" data-testid="tab-map">
              <Map className="h-4 w-4 mr-1" />
              Karta
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredClusters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Inga kluster</h3>
            <p className="text-muted-foreground mb-4">
              Skapa ditt första kluster för att bygga kundhierarkier med dataärvning
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button onClick={handleOpenCreate} data-testid="button-create-cluster-empty">
                <Plus className="mr-2 h-4 w-4" />
                Skapa Kluster
              </Button>
              <Button variant="outline" onClick={() => navigate("/auto-cluster")} data-testid="button-auto-cluster-empty">
                <Sparkles className="mr-2 h-4 w-4" />
                Auto-klustring
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : viewMode === "map" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="overflow-hidden">
              <CardContent className="p-0 h-[600px]">
                <MapContainer
                  center={[59.3293, 18.0686]}
                  zoom={10}
                  style={{ height: "100%", width: "100%" }}
                  scrollWheelZoom={true}
                >
                  <TileLayer
                    attribution={mapConfig.attribution}
                    url={mapConfig.tileUrl}
                  />
                  <MapFitBounds clusters={clustersWithCoordinates} />
                  {clustersWithCoordinates.map((cluster) => {
                    const color = cluster.color || SLA_COLORS[cluster.slaLevel || "standard"] || SLA_COLORS.standard;
                    return (
                      <div key={cluster.id}>
                        {cluster.radiusKm && (
                          <Circle
                            center={[cluster.centerLatitude!, cluster.centerLongitude!]}
                            radius={Math.min(cluster.radiusKm, 100) * 1000}
                            pathOptions={{
                              color: color,
                              fillColor: color,
                              fillOpacity: 0.15,
                              weight: 2,
                            }}
                          />
                        )}
                        <Marker
                          position={[cluster.centerLatitude!, cluster.centerLongitude!]}
                          icon={createClusterIcon(color)}
                          eventHandlers={{
                            click: () => setSelectedClusterId(cluster.id),
                          }}
                        >
                          <Popup>
                            <div className="min-w-[200px]">
                              <h3 className="font-semibold">{cluster.name}</h3>
                              {cluster.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {cluster.description}
                                </p>
                              )}
                              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                <div>{cluster.cachedObjectCount || 0} objekt</div>
                                <div>{cluster.cachedActiveOrders || 0} ordrar</div>
                              </div>
                              <Button
                                size="sm"
                                className="mt-3 w-full"
                                onClick={() => navigate(`/clusters/${cluster.id}`)}
                              >
                                Visa detaljer
                              </Button>
                            </div>
                          </Popup>
                        </Marker>
                      </div>
                    );
                  })}
                </MapContainer>
              </CardContent>
            </Card>
          </div>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {filteredClusters.map((cluster) => {
              const sla = getSlaInfo(cluster.slaLevel);
              const isSelected = cluster.id === selectedClusterId;
              return (
                <Card
                  key={cluster.id}
                  className={`cursor-pointer hover-elevate ${isSelected ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedClusterId(cluster.id)}
                  data-testid={`card-cluster-${cluster.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{cluster.name}</p>
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                          <span>{cluster.cachedObjectCount || 0} objekt</span>
                          <span className="text-xs">|</span>
                          <span>{cluster.cachedActiveOrders || 0} ordrar</span>
                        </div>
                      </div>
                      <Badge className={sla.color} variant="secondary">
                        {sla.label}
                      </Badge>
                    </div>
                    {isSelected && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(cluster);
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Redigera
                        </Button>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/clusters/${cluster.id}`);
                          }}
                        >
                          Visa snöret
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredClusters.map((cluster) => {
            const sla = getSlaInfo(cluster.slaLevel);
            const teamName = getTeamName(cluster.primaryTeamId);
            const customerName = getCustomerName(cluster.rootCustomerId || null);
            return (
              <Card
                key={cluster.id}
                className="hover-elevate cursor-pointer"
                data-testid={`card-cluster-${cluster.id}`}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: cluster.color || "#3B82F6" }}
                      />
                      {cluster.name}
                    </CardTitle>
                    {customerName && (
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        Rotkund: {customerName}
                      </p>
                    )}
                    {cluster.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {cluster.description}
                      </p>
                    )}
                  </div>
                  <Badge className={sla.color} variant="secondary">
                    {sla.label}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span>{cluster.cachedObjectCount ?? 0} objekt</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span>{cluster.cachedActiveOrders ?? 0} aktiva</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{cluster.cachedAvgSetupTime ?? 0} min snitt</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {(cluster.cachedMonthlyValue ?? 0).toLocaleString("sv-SE")} kr/mån
                      </span>
                    </div>
                  </div>

                  {(teamName || cluster.postalCodes?.length || cluster.defaultPeriodicity) && (
                    <div className="flex flex-wrap gap-2">
                      {teamName && (
                        <Badge variant="outline">
                          <Users className="h-3 w-3 mr-1" />
                          {teamName}
                        </Badge>
                      )}
                      {cluster.defaultPeriodicity && cluster.defaultPeriodicity !== "vecka" && (
                        <Badge variant="secondary">
                          <Clock className="h-3 w-3 mr-1" />
                          {PERIODICITY_OPTIONS.find(p => p.value === cluster.defaultPeriodicity)?.label || cluster.defaultPeriodicity}
                        </Badge>
                      )}
                      {cluster.postalCodes?.slice(0, 3).map((pc) => (
                        <Badge key={pc} variant="secondary">
                          <MapPin className="h-3 w-3 mr-1" />
                          {pc}
                        </Badge>
                      ))}
                      {cluster.postalCodes && cluster.postalCodes.length > 3 && (
                        <Badge variant="secondary">+{cluster.postalCodes.length - 3}</Badge>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshCacheMutation.mutate(cluster.id);
                          }}
                          disabled={refreshCacheMutation.isPending}
                          data-testid={`button-refresh-${cluster.id}`}
                        >
                          <RefreshCw
                            className={`h-4 w-4 ${refreshCacheMutation.isPending ? "animate-spin" : ""}`}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Uppdatera statistik</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(cluster);
                          }}
                          data-testid={`button-edit-${cluster.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Redigera</p></TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost" onClick={(e) => e.stopPropagation()} data-testid={`button-more-${cluster.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => navigate(`/clusters/${cluster.id}`)}>
                          <ChevronRight className="h-4 w-4 mr-2" />
                          Visa detaljer
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(cluster)}
                          data-testid={`menu-delete-${cluster.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Ta bort kluster
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/clusters/${cluster.id}`);
                      }}
                      data-testid={`button-view-${cluster.id}`}
                    >
                      Visa snöret
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCluster ? "Redigera Kluster" : "Nytt Kluster"}
            </DialogTitle>
            <DialogDescription>
              {editingCluster
                ? "Uppdatera klusterinformation och kundhierarki"
                : "Skapa ett nytt kluster med kundhierarki och dataärvning"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="t.ex. Södermalm Centrum"
                        data-testid="input-cluster-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Beskrivning</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Beskriv klustret..."
                        rows={2}
                        data-testid="input-cluster-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rootCustomerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rotkund (hierarkitopp)</FormLabel>
                    <Select
                      value={field.value || "none"}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-root-customer">
                          <SelectValue placeholder="Välj kund som äger hierarkin" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Ingen kund vald</SelectItem>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Kunden som sitter högst upp i hierarkin. Data ärvs nedåt.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">
                  Geografisk data (valfritt - för ruttoptimering)
                </p>
              </div>

              <div>
                <FormLabel className="mb-2 block">Sök adress (centrum)</FormLabel>
                <AddressSearch
                  placeholder="Börja skriva en adress..."
                  onSelect={(result) => {
                    form.setValue("centerLatitude", result.lat.toString());
                    form.setValue("centerLongitude", result.lon.toString());
                    if (result.postalCode) {
                      const currentPostalCodes = form.getValues("postalCodes");
                      if (!currentPostalCodes?.includes(result.postalCode)) {
                        form.setValue(
                          "postalCodes",
                          currentPostalCodes
                            ? `${currentPostalCodes}, ${result.postalCode}`
                            : result.postalCode
                        );
                      }
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Sök efter en adress för att automatiskt fylla i koordinater
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="centerLatitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Latitud (centrum)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="any"
                          placeholder="59.3293"
                          data-testid="input-cluster-latitude"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="centerLongitude"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Longitud (centrum)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="any"
                          placeholder="18.0686"
                          data-testid="input-cluster-longitude"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="radiusKm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Radie (km)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.1"
                        placeholder="5"
                        data-testid="input-cluster-radius"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="postalCodes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Postnummer (kommaseparerade)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="15131, 15132, 15133"
                        data-testid="input-cluster-postalcodes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">
                  Service- och planeringsinställningar
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="defaultPeriodicity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Servicefrekvens</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-cluster-periodicity">
                            <SelectValue placeholder="Välj frekvens" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PERIODICITY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Standardfrekvens för nya objekt i klustret
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="defaultPreferredTime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Föredragen servicetid</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || "none"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-cluster-preferred-time">
                            <SelectValue placeholder="Välj tidsfönster" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Ingen preferens</SelectItem>
                          {TIME_SLOT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Ärvs till nya objekt om inget annat anges
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="slaLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SLA-nivå</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-cluster-sla">
                            <SelectValue placeholder="Välj nivå" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SLA_LEVELS.map((sla) => (
                            <SelectItem key={sla.value} value={sla.value}>
                              {sla.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Klusterfärg</FormLabel>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-8 h-8 rounded border shrink-0"
                          style={{ backgroundColor: field.value }}
                        />
                        <div className="flex flex-wrap gap-1">
                          {COLOR_PRESETS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => field.onChange(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                                field.value === c ? "border-foreground scale-125" : "border-transparent"
                              }`}
                              style={{ backgroundColor: c }}
                              data-testid={`color-preset-${c.replace("#", "")}`}
                            />
                          ))}
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="border-t pt-4 mt-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">
                  Teamkoppling
                </p>
              </div>

              <FormField
                control={form.control}
                name="primaryTeamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ansvarigt team</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || "none"}>
                      <FormControl>
                        <SelectTrigger data-testid="select-cluster-team">
                          <SelectValue placeholder="Välj team" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">Inget team</SelectItem>
                        {teams.length > 0 ? (
                          teams.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="no-teams" disabled>
                            Inga team skapade ännu
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Kan sättas senare. Skapa först användare och resurser under Användarhantering, sedan team, och koppla teamet här.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Avbryt
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-cluster"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingCluster ? "Spara" : "Skapa"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort kluster?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort klustret "{clusterToDelete?.name}"? Objekt
              och ordrar kopplade till klustret kommer inte att tas bort men förlorar sin
              klustertillhörighet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clusterToDelete && deleteMutation.mutate(clusterToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
