import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  Plus, Search, FileText, Calendar, Loader2, Building2, 
  AlertTriangle, TrendingUp, Edit, Trash2, MapPin, Filter,
  ChevronDown, ChevronUp, Clock
} from "lucide-react";
import { format, differenceInDays, isPast, isFuture } from "date-fns";
import { sv } from "date-fns/locale";
import type { Procurement, Customer, ServiceObject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const statusLabels: Record<string, string> = {
  draft: "Utkast",
  submitted: "Skickad",
  won: "Vunnen",
  lost: "Förlorad",
};

const statusColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  submitted: "secondary",
  won: "default",
  lost: "destructive",
};

const objectTypeLabels: Record<string, string> = {
  omrade: "Område",
  fastighet: "Fastighet",
  serviceboende: "Serviceboende",
  rum: "Rum",
  soprum: "Soprum",
  kok: "Kök",
  uj_hushallsavfall: "UJ Hushållsavfall",
  matafall: "Matavfall",
  atervinning: "Återvinning",
};

export default function ProcurementsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showObjectsDialog, setShowObjectsDialog] = useState(false);
  const [selectedProcurement, setSelectedProcurement] = useState<Procurement | null>(null);
  const [editingProcurement, setEditingProcurement] = useState<Partial<Procurement>>({});
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [newProcurement, setNewProcurement] = useState({
    title: "",
    referenceNumber: "",
    description: "",
    customerId: "",
    estimatedValue: 0,
    deadline: "",
    estimatedHoursPerWeek: 0,
  });
  const { toast } = useToast();

  const { data: procurements = [], isLoading } = useQuery<Procurement[]>({
    queryKey: ["/api/procurements"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const [objectSearch, setObjectSearch] = useState("");
  const [debouncedObjectSearch, setDebouncedObjectSearch] = useState("");

  // Debounce object search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedObjectSearch(objectSearch), 300);
    return () => clearTimeout(timer);
  }, [objectSearch]);

  // Only fetch objects with search (paginated)
  const { data: objectSearchResults = [], isLoading: loadingObjects } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", { search: debouncedObjectSearch, limit: 50 }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedObjectSearch) params.set("search", debouncedObjectSearch);
      params.set("limit", "50");
      const res = await fetch(`/api/objects?${params}`);
      return res.json();
    },
    enabled: showObjectsDialog,
  });

  // Fetch selected objects by IDs (batch approach with dedicated endpoint)
  const { data: selectedObjects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects/selected", selectedObjectIds.join(",")],
    queryFn: async () => {
      if (selectedObjectIds.length === 0) return [];
      const params = new URLSearchParams();
      params.set("ids", selectedObjectIds.join(","));
      const res = await fetch(`/api/objects?${params}`);
      return res.json();
    },
    enabled: showObjectsDialog && selectedObjectIds.length > 0,
    staleTime: 60000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newProcurement) => {
      return apiRequest("POST", "/api/procurements", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurements"] });
      setShowCreateDialog(false);
      setNewProcurement({ title: "", referenceNumber: "", description: "", customerId: "", estimatedValue: 0, deadline: "", estimatedHoursPerWeek: 0 });
      toast({ title: "Upphandling skapad", description: "Den nya upphandlingen har lagts till." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Procurement> }) => {
      return apiRequest("PATCH", `/api/procurements/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurements"] });
      setShowEditDialog(false);
      setShowObjectsDialog(false);
      setSelectedProcurement(null);
      toast({ title: "Upphandling uppdaterad" });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/procurements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurements"] });
      setShowEditDialog(false);
      setSelectedProcurement(null);
      toast({ title: "Upphandling borttagen" });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: Record<string, unknown> = { status };
      if (status === "submitted") updates.submittedAt = new Date().toISOString();
      if (status === "won") updates.wonAt = new Date().toISOString();
      if (status === "lost") updates.lostAt = new Date().toISOString();
      return apiRequest("PATCH", `/api/procurements/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurements"] });
      toast({ title: "Status uppdaterad" });
    },
  });

  const filteredProcurements = useMemo(() => {
    return procurements.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.referenceNumber?.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [procurements, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const total = procurements.length;
    const draft = procurements.filter(p => p.status === "draft").length;
    const submitted = procurements.filter(p => p.status === "submitted").length;
    const won = procurements.filter(p => p.status === "won").length;
    const lost = procurements.filter(p => p.status === "lost").length;
    const decided = won + lost;
    const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;
    const totalValue = procurements.reduce((sum, p) => sum + (p.estimatedValue || 0), 0);
    const wonValue = procurements.filter(p => p.status === "won").reduce((sum, p) => sum + (p.estimatedValue || 0), 0);
    return { total, draft, submitted, won, lost, winRate, totalValue, wonValue };
  }, [procurements]);

  const deadlineWarnings = useMemo(() => {
    return procurements
      .filter(p => p.deadline && p.status === "draft" && isFuture(new Date(p.deadline)))
      .map(p => ({
        ...p,
        daysLeft: differenceInDays(new Date(p.deadline!), new Date())
      }))
      .filter(p => p.daysLeft <= 7)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [procurements]);

  const overdueDeadlines = useMemo(() => {
    return procurements.filter(p => 
      p.deadline && 
      p.status === "draft" && 
      isPast(new Date(p.deadline))
    );
  }, [procurements]);

  const openEditDialog = (procurement: Procurement) => {
    setSelectedProcurement(procurement);
    setEditingProcurement({
      title: procurement.title,
      referenceNumber: procurement.referenceNumber || "",
      description: procurement.description || "",
      customerId: procurement.customerId || "",
      estimatedValue: procurement.estimatedValue || 0,
      deadline: procurement.deadline ? format(new Date(procurement.deadline), "yyyy-MM-dd") as unknown as Date : undefined,
      estimatedHoursPerWeek: procurement.estimatedHoursPerWeek || 0,
      notes: procurement.notes || "",
    });
    setShowEditDialog(true);
  };

  const openObjectsDialog = (procurement: Procurement) => {
    setSelectedProcurement(procurement);
    setSelectedObjectIds(procurement.objectIds || []);
    setShowObjectsDialog(true);
  };

  const saveObjects = () => {
    if (!selectedProcurement) return;
    
    const totalContainers = selectedObjectIds.reduce((sum, id) => {
      const obj = objectMapForCalc.get(id);
      if (!obj) return sum;
      return sum + (obj.containerCount || 0) + (obj.containerCountK2 || 0) + 
             (obj.containerCountK3 || 0) + (obj.containerCountK4 || 0);
    }, 0);

    updateMutation.mutate({
      id: selectedProcurement.id,
      data: {
        objectIds: selectedObjectIds,
        containerCountTotal: totalContainers,
      }
    });
  };

  // Combine search results with selected objects for display (show all, not just top-level)
  const displayObjects = useMemo(() => {
    const combined = new Map<string, ServiceObject>();
    selectedObjects.forEach(o => combined.set(o.id, o));
    objectSearchResults.forEach(o => combined.set(o.id, o));
    return Array.from(combined.values());
  }, [selectedObjects, objectSearchResults]);

  // Combined object map for accurate container calculations
  const objectMapForCalc = useMemo(() => {
    const map = new Map<string, ServiceObject>();
    selectedObjects.forEach(o => map.set(o.id, o));
    objectSearchResults.forEach(o => map.set(o.id, o));
    return map;
  }, [selectedObjects, objectSearchResults]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Upphandlingar</h1>
          <p className="text-sm text-muted-foreground">{procurements.length} upphandlingar</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-add-procurement">
          <Plus className="h-4 w-4 mr-2" />
          Ny upphandling
        </Button>
      </div>

      {(deadlineWarnings.length > 0 || overdueDeadlines.length > 0) && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-700 dark:text-amber-400">Deadline-varningar</p>
                {overdueDeadlines.length > 0 && (
                  <p className="text-sm text-destructive">
                    {overdueDeadlines.length} upphandling(ar) har passerat deadline!
                  </p>
                )}
                {deadlineWarnings.map(p => (
                  <p key={p.id} className="text-sm text-muted-foreground">
                    <span className="font-medium">{p.title}</span>: {p.daysLeft} dag(ar) kvar
                  </p>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground">Totalt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.draft}</div>
            <div className="text-xs text-muted-foreground">Utkast</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{stats.submitted}</div>
            <div className="text-xs text-muted-foreground">Skickade</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.won}</div>
            <div className="text-xs text-muted-foreground">Vunna</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.lost}</div>
            <div className="text-xs text-muted-foreground">Förlorade</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{stats.winRate}%</span>
            </div>
            <div className="text-xs text-muted-foreground">Vinstfrekvens</div>
          </CardContent>
        </Card>
      </div>

      {stats.wonValue > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm text-muted-foreground">Totalt vunnet värde</p>
                <p className="text-xl font-bold">{stats.wonValue.toLocaleString("sv-SE")} kr</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Totalt pipeline-värde</p>
                <p className="text-xl font-bold">{stats.totalValue.toLocaleString("sv-SE")} kr</p>
              </div>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm text-muted-foreground mb-1">Vunnet av totalt</p>
                <Progress 
                  value={stats.totalValue > 0 ? (stats.wonValue / stats.totalValue) * 100 : 0} 
                  className="h-2"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Sök upphandlingar..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-procurements"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-4 w-4 mr-2" />
            Filter
            {showFilters ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
          </Button>
        </div>

        {showFilters && (
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-48" data-testid="select-status-filter">
                      <SelectValue placeholder="Alla statusar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alla statusar</SelectItem>
                      <SelectItem value="draft">Utkast</SelectItem>
                      <SelectItem value="submitted">Skickade</SelectItem>
                      <SelectItem value="won">Vunna</SelectItem>
                      <SelectItem value="lost">Förlorade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredProcurements.map((procurement) => {
          const customer = customers.find(c => c.id === procurement.customerId);
          const isOverdue = procurement.deadline && procurement.status === "draft" && isPast(new Date(procurement.deadline));
          const objectCount = procurement.objectIds?.length || 0;
          
          return (
            <Card 
              key={procurement.id}
              className={`group ${isOverdue ? "border-destructive/50" : ""}`}
              data-testid={`procurement-card-${procurement.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base truncate">{procurement.title}</CardTitle>
                  <div className="flex items-center gap-1">
                    <Badge variant={statusColors[procurement.status]}>
                      {statusLabels[procurement.status] || procurement.status}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEditDialog(procurement)}
                      data-testid={`button-edit-${procurement.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {procurement.referenceNumber && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    <span>{procurement.referenceNumber}</span>
                  </div>
                )}
                {customer && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <span>{customer.name}</span>
                  </div>
                )}
                {procurement.deadline && (
                  <div className={`flex items-center gap-2 text-sm ${isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    <Calendar className="h-4 w-4" />
                    <span>
                      Deadline: {format(new Date(procurement.deadline), "d MMM yyyy", { locale: sv })}
                      {isOverdue && " (Passerad!)"}
                    </span>
                  </div>
                )}
                
                <div className="flex items-center gap-4 flex-wrap">
                  {procurement.estimatedValue ? (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Värde: </span>
                      <span className="font-medium">{procurement.estimatedValue.toLocaleString("sv-SE")} kr</span>
                    </div>
                  ) : null}
                  {procurement.estimatedHoursPerWeek ? (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{procurement.estimatedHoursPerWeek}h/vecka</span>
                    </div>
                  ) : null}
                </div>

                <div 
                  className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover-elevate p-2 -mx-2 rounded-md"
                  onClick={() => openObjectsDialog(procurement)}
                  data-testid={`button-objects-${procurement.id}`}
                >
                  <MapPin className="h-4 w-4" />
                  <span>
                    {objectCount > 0 
                      ? `${objectCount} objekt (${procurement.containerCountTotal || 0} kärl)`
                      : "Lägg till objekt..."
                    }
                  </span>
                </div>

                {procurement.status === "draft" && (
                  <div className="flex gap-2 pt-2">
                    <Button 
                      size="sm" 
                      onClick={() => updateStatusMutation.mutate({ id: procurement.id, status: "submitted" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-submit-${procurement.id}`}
                    >
                      Skicka in
                    </Button>
                  </div>
                )}
                {procurement.status === "submitted" && (
                  <div className="flex gap-2 pt-2">
                    <Button 
                      size="sm" 
                      variant="default"
                      onClick={() => updateStatusMutation.mutate({ id: procurement.id, status: "won" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-won-${procurement.id}`}
                    >
                      Vunnen
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => updateStatusMutation.mutate({ id: procurement.id, status: "lost" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid={`button-lost-${procurement.id}`}
                    >
                      Förlorad
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredProcurements.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Inga upphandlingar hittades</p>
          <p className="text-sm mt-1">Klicka på &quot;Ny upphandling&quot; för att skapa en</p>
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ny upphandling</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Titel</Label>
              <Input
                id="title"
                value={newProcurement.title}
                onChange={(e) => setNewProcurement({ ...newProcurement, title: e.target.value })}
                placeholder="T.ex. Avfallshantering Område Nord"
                data-testid="input-procurement-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referenceNumber">Referensnummer</Label>
              <Input
                id="referenceNumber"
                value={newProcurement.referenceNumber}
                onChange={(e) => setNewProcurement({ ...newProcurement, referenceNumber: e.target.value })}
                placeholder="T.ex. UPH-2024-001"
                data-testid="input-procurement-reference"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customer">Kund</Label>
              <Select
                value={newProcurement.customerId}
                onValueChange={(value) => setNewProcurement({ ...newProcurement, customerId: value })}
              >
                <SelectTrigger data-testid="select-procurement-customer">
                  <SelectValue placeholder="Välj kund..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="estimatedValue">Uppskattat värde (kr)</Label>
                <Input
                  id="estimatedValue"
                  type="number"
                  value={newProcurement.estimatedValue || ""}
                  onChange={(e) => setNewProcurement({ ...newProcurement, estimatedValue: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                  data-testid="input-procurement-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimatedHours">Timmar/vecka</Label>
                <Input
                  id="estimatedHours"
                  type="number"
                  value={newProcurement.estimatedHoursPerWeek || ""}
                  onChange={(e) => setNewProcurement({ ...newProcurement, estimatedHoursPerWeek: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                  data-testid="input-procurement-hours"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deadline">Deadline</Label>
              <Input
                id="deadline"
                type="date"
                value={newProcurement.deadline}
                onChange={(e) => setNewProcurement({ ...newProcurement, deadline: e.target.value })}
                data-testid="input-procurement-deadline"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Beskrivning</Label>
              <Textarea
                id="description"
                value={newProcurement.description}
                onChange={(e) => setNewProcurement({ ...newProcurement, description: e.target.value })}
                placeholder="Beskriv upphandlingen..."
                data-testid="input-procurement-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Avbryt
            </Button>
            <Button 
              onClick={() => createMutation.mutate(newProcurement)}
              disabled={!newProcurement.title || createMutation.isPending}
              data-testid="button-save-procurement"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spara"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redigera upphandling</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Titel</Label>
              <Input
                id="edit-title"
                value={editingProcurement.title || ""}
                onChange={(e) => setEditingProcurement({ ...editingProcurement, title: e.target.value })}
                data-testid="input-edit-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-referenceNumber">Referensnummer</Label>
              <Input
                id="edit-referenceNumber"
                value={editingProcurement.referenceNumber || ""}
                onChange={(e) => setEditingProcurement({ ...editingProcurement, referenceNumber: e.target.value })}
                data-testid="input-edit-reference"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-customer">Kund</Label>
              <Select
                value={editingProcurement.customerId || ""}
                onValueChange={(value) => setEditingProcurement({ ...editingProcurement, customerId: value })}
              >
                <SelectTrigger data-testid="select-edit-customer">
                  <SelectValue placeholder="Välj kund..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-estimatedValue">Uppskattat värde (kr)</Label>
                <Input
                  id="edit-estimatedValue"
                  type="number"
                  value={editingProcurement.estimatedValue || ""}
                  onChange={(e) => setEditingProcurement({ ...editingProcurement, estimatedValue: parseInt(e.target.value) || 0 })}
                  data-testid="input-edit-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-estimatedHours">Timmar/vecka</Label>
                <Input
                  id="edit-estimatedHours"
                  type="number"
                  value={editingProcurement.estimatedHoursPerWeek || ""}
                  onChange={(e) => setEditingProcurement({ ...editingProcurement, estimatedHoursPerWeek: parseInt(e.target.value) || 0 })}
                  data-testid="input-edit-hours"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-deadline">Deadline</Label>
              <Input
                id="edit-deadline"
                type="date"
                value={editingProcurement.deadline ? (typeof editingProcurement.deadline === 'string' ? editingProcurement.deadline : format(new Date(editingProcurement.deadline), "yyyy-MM-dd")) : ""}
                onChange={(e) => setEditingProcurement({ ...editingProcurement, deadline: e.target.value as unknown as Date })}
                data-testid="input-edit-deadline"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Beskrivning</Label>
              <Textarea
                id="edit-description"
                value={editingProcurement.description || ""}
                onChange={(e) => setEditingProcurement({ ...editingProcurement, description: e.target.value })}
                data-testid="input-edit-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Anteckningar</Label>
              <Textarea
                id="edit-notes"
                value={editingProcurement.notes || ""}
                onChange={(e) => setEditingProcurement({ ...editingProcurement, notes: e.target.value })}
                data-testid="input-edit-notes"
              />
            </div>
          </div>
          <DialogFooter className="flex justify-between gap-2">
            <Button 
              variant="destructive" 
              onClick={() => selectedProcurement && deleteMutation.mutate(selectedProcurement.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-procurement"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Ta bort
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                Avbryt
              </Button>
              <Button 
                onClick={() => {
                  if (!selectedProcurement) return;
                  const deadlineValue = editingProcurement.deadline;
                  const deadlineStr = deadlineValue 
                    ? (typeof deadlineValue === 'string' ? deadlineValue : format(new Date(deadlineValue), "yyyy-MM-dd"))
                    : null;
                  updateMutation.mutate({ 
                    id: selectedProcurement.id, 
                    data: {
                      ...editingProcurement,
                      deadline: deadlineStr,
                    } as Partial<Procurement>
                  });
                }}
                disabled={updateMutation.isPending || !editingProcurement.title}
                data-testid="button-update-procurement"
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spara"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showObjectsDialog} onOpenChange={(open) => {
        setShowObjectsDialog(open);
        if (!open) setObjectSearch("");
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Koppla objekt till upphandling</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök objekt..."
                value={objectSearch}
                onChange={(e) => setObjectSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-objects"
              />
            </div>
            <ScrollArea className="h-[400px] pr-4">
              {loadingObjects ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : displayObjects.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  {objectSearch ? "Inga objekt matchar sökningen" : "Sök för att hitta objekt"}
                </p>
              ) : (
                <div className="space-y-2">
                  {displayObjects.map((obj) => {
                    const isSelected = selectedObjectIds.includes(obj.id);
                    const containerTotal = (obj.containerCount || 0) + (obj.containerCountK2 || 0) + 
                                          (obj.containerCountK3 || 0) + (obj.containerCountK4 || 0);
                    
                    return (
                      <div 
                        key={obj.id}
                        className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedObjectIds(selectedObjectIds.filter(id => id !== obj.id));
                          } else {
                            setSelectedObjectIds([...selectedObjectIds, obj.id]);
                          }
                        }}
                      >
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedObjectIds([...selectedObjectIds, obj.id]);
                            } else {
                              setSelectedObjectIds(selectedObjectIds.filter(id => id !== obj.id));
                            }
                          }}
                          data-testid={`checkbox-object-${obj.id}`}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{obj.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {objectTypeLabels[obj.objectType] || obj.objectType}
                            </Badge>
                          </div>
                          {obj.address && (
                            <p className="text-sm text-muted-foreground">{obj.address}, {obj.city}</p>
                          )}
                        </div>
                        {containerTotal > 0 && (
                          <span className="text-sm text-muted-foreground">{containerTotal} kärl</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Valda: {selectedObjectIds.length} objekt, totalt {
                  selectedObjectIds.reduce((sum, id) => {
                    const obj = objectMapForCalc.get(id);
                    if (!obj) return sum;
                    return sum + (obj.containerCount || 0) + (obj.containerCountK2 || 0) + 
                           (obj.containerCountK3 || 0) + (obj.containerCountK4 || 0);
                  }, 0)
                } kärl
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowObjectsDialog(false)}>
              Avbryt
            </Button>
            <Button 
              onClick={saveObjects}
              disabled={updateMutation.isPending}
              data-testid="button-save-objects"
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spara objekt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
