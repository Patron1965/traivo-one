import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { QueryErrorState } from "@/components/ErrorBoundary";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import type { Cluster, Team } from "@shared/schema";

const SLA_LEVELS = [
  { value: "standard", label: "Standard", color: "bg-muted text-muted-foreground" },
  { value: "premium", label: "Premium", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  { value: "enterprise", label: "Enterprise", color: "bg-purple-500/20 text-purple-700 dark:text-purple-300" },
];

interface ClusterFormData {
  name: string;
  description: string;
  centerLatitude: string;
  centerLongitude: string;
  radiusKm: string;
  postalCodes: string;
  slaLevel: string;
  primaryTeamId: string;
}

const emptyFormData: ClusterFormData = {
  name: "",
  description: "",
  centerLatitude: "",
  centerLongitude: "",
  radiusKm: "5",
  postalCodes: "",
  slaLevel: "standard",
  primaryTeamId: "",
};

interface ClusterWithStats extends Cluster {
  objectCount: number;
  activeOrders: number;
  monthlyValue: number;
  avgSetupTime: number;
}

export default function ClustersPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<Cluster | null>(null);
  const [clusterToDelete, setClusterToDelete] = useState<Cluster | null>(null);
  const [formData, setFormData] = useState<ClusterFormData>(emptyFormData);

  const { data: clusters = [], isLoading, error } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Cluster>) => apiRequest("POST", "/api/clusters", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      setDialogOpen(false);
      setFormData(emptyFormData);
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
      setFormData(emptyFormData);
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
    setFormData(emptyFormData);
    setDialogOpen(true);
  };

  const handleOpenEdit = (cluster: Cluster) => {
    setEditingCluster(cluster);
    setFormData({
      name: cluster.name,
      description: cluster.description || "",
      centerLatitude: cluster.centerLatitude?.toString() || "",
      centerLongitude: cluster.centerLongitude?.toString() || "",
      radiusKm: cluster.radiusKm?.toString() || "5",
      postalCodes: cluster.postalCodes?.join(", ") || "",
      slaLevel: cluster.slaLevel || "standard",
      primaryTeamId: cluster.primaryTeamId || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      name: formData.name,
      description: formData.description || null,
      centerLatitude: formData.centerLatitude ? parseFloat(formData.centerLatitude) : null,
      centerLongitude: formData.centerLongitude ? parseFloat(formData.centerLongitude) : null,
      radiusKm: formData.radiusKm ? parseFloat(formData.radiusKm) : null,
      postalCodes: formData.postalCodes
        ? formData.postalCodes.split(",").map((s) => s.trim()).filter(Boolean)
        : null,
      slaLevel: formData.slaLevel,
      primaryTeamId: formData.primaryTeamId || null,
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
    const team = teams.find((t) => t.id === teamId);
    return team?.name || null;
  };

  const filteredClusters = clusters.filter((cluster) =>
    cluster.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <h1 className="text-2xl font-semibold">Kluster</h1>
          <p className="text-muted-foreground">
            Geografiska kluster - navet i verksamheten
          </p>
        </div>
        <Button onClick={handleOpenCreate} data-testid="button-create-cluster">
          <Plus className="mr-2 h-4 w-4" />
          Nytt Kluster
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök kluster..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-clusters"
          />
        </div>
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
              Skapa ditt första kluster för att organisera objekt geografiskt
            </p>
            <Button onClick={handleOpenCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Skapa Kluster
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredClusters.map((cluster) => {
            const sla = getSlaInfo(cluster.slaLevel);
            const teamName = getTeamName(cluster.primaryTeamId);
            return (
              <Card
                key={cluster.id}
                className="hover-elevate cursor-pointer"
                data-testid={`card-cluster-${cluster.id}`}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{cluster.name}</CardTitle>
                    {cluster.description && (
                      <p className="text-sm text-muted-foreground truncate mt-1">
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

                  {(teamName || cluster.postalCodes?.length) && (
                    <div className="flex flex-wrap gap-2">
                      {teamName && (
                        <Badge variant="outline">
                          <Users className="h-3 w-3 mr-1" />
                          {teamName}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(cluster);
                      }}
                      data-testid={`button-delete-${cluster.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="flex-1" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/clusters/${cluster.id}`)}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingCluster ? "Redigera Kluster" : "Nytt Kluster"}
            </DialogTitle>
            <DialogDescription>
              {editingCluster
                ? "Uppdatera klusterinformation"
                : "Skapa ett nytt geografiskt kluster"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Namn</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="t.ex. Södermalm Centrum"
                data-testid="input-cluster-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Beskrivning</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Beskriv klustret..."
                rows={2}
                data-testid="input-cluster-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="latitude">Latitud (centrum)</Label>
                <Input
                  id="latitude"
                  type="number"
                  step="any"
                  value={formData.centerLatitude}
                  onChange={(e) => setFormData({ ...formData, centerLatitude: e.target.value })}
                  placeholder="59.3293"
                  data-testid="input-cluster-latitude"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="longitude">Longitud (centrum)</Label>
                <Input
                  id="longitude"
                  type="number"
                  step="any"
                  value={formData.centerLongitude}
                  onChange={(e) => setFormData({ ...formData, centerLongitude: e.target.value })}
                  placeholder="18.0686"
                  data-testid="input-cluster-longitude"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="radius">Radie (km)</Label>
              <Input
                id="radius"
                type="number"
                step="0.1"
                value={formData.radiusKm}
                onChange={(e) => setFormData({ ...formData, radiusKm: e.target.value })}
                placeholder="5"
                data-testid="input-cluster-radius"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="postalCodes">Postnummer (kommaseparerade)</Label>
              <Input
                id="postalCodes"
                value={formData.postalCodes}
                onChange={(e) => setFormData({ ...formData, postalCodes: e.target.value })}
                placeholder="15131, 15132, 15133"
                data-testid="input-cluster-postalcodes"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SLA-nivå</Label>
                <Select
                  value={formData.slaLevel}
                  onValueChange={(value) => setFormData({ ...formData, slaLevel: value })}
                >
                  <SelectTrigger data-testid="select-cluster-sla">
                    <SelectValue placeholder="Välj nivå" />
                  </SelectTrigger>
                  <SelectContent>
                    {SLA_LEVELS.map((sla) => (
                      <SelectItem key={sla.value} value={sla.value}>
                        {sla.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Ansvarigt team</Label>
                <Select
                  value={formData.primaryTeamId}
                  onValueChange={(value) => setFormData({ ...formData, primaryTeamId: value })}
                >
                  <SelectTrigger data-testid="select-cluster-team">
                    <SelectValue placeholder="Välj team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Inget team</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-cluster"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingCluster ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
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
