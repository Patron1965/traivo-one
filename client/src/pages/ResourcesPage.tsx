import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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
  Phone,
  MapPin,
  Loader2,
  Pencil,
  Trash2,
  Mail,
  Calendar,
  Clock,
  Filter,
  CalendarOff,
  ChevronDown,
  ChevronUp,
  Wrench,
  X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, startOfWeek, endOfWeek, addDays, isWithinInterval, parseISO } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrder, Article, ResourceArticle } from "@shared/schema";

const competencyOptions = [
  { value: "karltomning", label: "Kärltömning" },
  { value: "grovsopor", label: "Grovsopor" },
  { value: "matavfall", label: "Matavfall" },
  { value: "atervinning", label: "Återvinning" },
  { value: "farligt_avfall", label: "Farligt avfall" },
  { value: "adr_certified", label: "ADR-certifierad" },
  { value: "c_korkort", label: "C-körkort" },
  { value: "ce_korkort", label: "CE-körkort" },
];

const competencyLabels: Record<string, string> = Object.fromEntries(
  competencyOptions.map(c => [c.value, c.label])
);

const availabilityOptions = [
  { value: "available", label: "Tillgänglig", color: "bg-green-500" },
  { value: "vacation", label: "Semester", color: "bg-blue-500" },
  { value: "sick", label: "Sjuk", color: "bg-red-500" },
  { value: "training", label: "Utbildning", color: "bg-yellow-500" },
  { value: "other", label: "Annat", color: "bg-gray-500" },
];

interface ResourceFormData {
  name: string;
  initials: string;
  resourceType: string;
  phone: string;
  email: string;
  homeLocation: string;
  weeklyHours: number;
  competencies: string[];
  status: string;
  availability: Record<string, string>;
}

const emptyFormData: ResourceFormData = {
  name: "",
  initials: "",
  resourceType: "person",
  phone: "",
  email: "",
  homeLocation: "",
  weeklyHours: 40,
  competencies: [],
  status: "active",
  availability: {},
};

export default function ResourcesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [competencyFilter, setCompetencyFilter] = useState<string>("all");
  const [availabilityFilter, setAvailabilityFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [availabilityDialogOpen, setAvailabilityDialogOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [formData, setFormData] = useState<ResourceFormData>(emptyFormData);
  const [showFilters, setShowFilters] = useState(false);
  const [tidsverkDialogOpen, setTidsverkDialogOpen] = useState(false);
  const [tidsverkResource, setTidsverkResource] = useState<Resource | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [efficiencyFactor, setEfficiencyFactor] = useState<number>(1.0);
  const [productionTimeOverride, setProductionTimeOverride] = useState<number | null>(null);

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: allWorkOrders = [] } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: objects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/objects"],
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: resourceArticles = [] } = useQuery<ResourceArticle[]>({
    queryKey: [`/api/resources/${tidsverkResource?.id}/articles`],
    enabled: !!tidsverkResource,
  });

  const objectMap = useMemo(() => 
    new Map(objects.map(o => [o.id, o.name])),
    [objects]
  );

  const articleMap = useMemo(() =>
    new Map(articles.map(a => [a.id, a])),
    [articles]
  );

  const availableArticles = useMemo(() => {
    const assignedIds = new Set(resourceArticles.map(ra => ra.articleId));
    return articles.filter(a => !assignedIds.has(a.id) && a.status === "active");
  }, [articles, resourceArticles]);

  const weekWorkOrders = useMemo(() => {
    return allWorkOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      const date = new Date(wo.scheduledDate);
      return isWithinInterval(date, { start: weekStart, end: weekEnd });
    });
  }, [allWorkOrders, weekStart, weekEnd]);

  const resourceWorkloads = useMemo(() => {
    const workloads = new Map<string, number>();
    weekWorkOrders.forEach(wo => {
      if (wo.resourceId) {
        const current = workloads.get(wo.resourceId) || 0;
        workloads.set(wo.resourceId, current + (wo.estimatedDuration || 60));
      }
    });
    return workloads;
  }, [weekWorkOrders]);

  const getResourceWorkOrders = (resourceId: string) => {
    return weekWorkOrders.filter(wo => wo.resourceId === resourceId);
  };

  const getCurrentAvailability = (resource: Resource): string => {
    const availability = (resource.availability || {}) as Record<string, string>;
    const todayKey = format(today, "yyyy-MM-dd");
    return availability[todayKey] || "available";
  };

  const createMutation = useMutation({
    mutationFn: async (data: ResourceFormData) => {
      return apiRequest("POST", "/api/resources", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({ title: "Resurs skapad" });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Fel vid skapande", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ResourceFormData> }) => {
      return apiRequest("PATCH", `/api/resources/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({ title: "Resurs uppdaterad" });
      closeDialog();
      setAvailabilityDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Fel vid uppdatering", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/resources/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({ title: "Resurs borttagen" });
      setDeleteDialogOpen(false);
      setResourceToDelete(null);
    },
    onError: () => {
      toast({ title: "Fel vid borttagning", variant: "destructive" });
    },
  });

  const createTidsverkMutation = useMutation({
    mutationFn: async (data: { resourceId: string; articleId: string; efficiencyFactor: number; productionTime?: number }) => {
      return apiRequest("POST", `/api/resources/${data.resourceId}/articles`, {
        articleId: data.articleId,
        efficiencyFactor: data.efficiencyFactor,
        productionTime: data.productionTime,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/resources/${variables.resourceId}/articles`] });
      toast({ title: "Tidsverk tillagt" });
      setSelectedArticleId("");
      setEfficiencyFactor(1.0);
      setProductionTimeOverride(null);
    },
    onError: () => {
      toast({ title: "Kunde inte lägga till tidsverk", variant: "destructive" });
    },
  });

  const deleteTidsverkMutation = useMutation({
    mutationFn: async (data: { id: string; resourceId: string }) => {
      return apiRequest("DELETE", `/api/resource-articles/${data.id}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/resources/${variables.resourceId}/articles`] });
      toast({ title: "Tidsverk borttaget" });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort tidsverk", variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingResource(null);
    setFormData(emptyFormData);
  };

  const openCreateDialog = () => {
    setEditingResource(null);
    setFormData(emptyFormData);
    setDialogOpen(true);
  };

  const openEditDialog = (resource: Resource) => {
    setEditingResource(resource);
    setFormData({
      name: resource.name,
      initials: resource.initials || "",
      resourceType: resource.resourceType,
      phone: resource.phone || "",
      email: resource.email || "",
      homeLocation: resource.homeLocation || "",
      weeklyHours: resource.weeklyHours || 40,
      competencies: resource.competencies || [],
      status: resource.status,
      availability: (resource.availability || {}) as Record<string, string>,
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (resource: Resource) => {
    setResourceToDelete(resource);
    setDeleteDialogOpen(true);
  };

  const openScheduleDialog = (resource: Resource) => {
    setSelectedResource(resource);
    setScheduleDialogOpen(true);
  };

  const openAvailabilityDialog = (resource: Resource) => {
    setSelectedResource(resource);
    setFormData({
      ...emptyFormData,
      availability: (resource.availability || {}) as Record<string, string>,
    });
    setAvailabilityDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast({ title: "Namn krävs", variant: "destructive" });
      return;
    }
    if (editingResource) {
      updateMutation.mutate({ id: editingResource.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleCompetencyToggle = (competency: string) => {
    setFormData(prev => ({
      ...prev,
      competencies: prev.competencies.includes(competency)
        ? prev.competencies.filter(c => c !== competency)
        : [...prev.competencies, competency],
    }));
  };

  const handleAvailabilityChange = (date: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      availability: {
        ...prev.availability,
        [date]: value,
      },
    }));
  };

  const saveAvailability = () => {
    if (selectedResource) {
      updateMutation.mutate({
        id: selectedResource.id,
        data: { availability: formData.availability },
      });
    }
  };

  const openTidsverkDialog = (resource: Resource) => {
    setTidsverkResource(resource);
    setSelectedArticleId("");
    setEfficiencyFactor(1.0);
    setProductionTimeOverride(null);
    setTidsverkDialogOpen(true);
  };

  const handleAddTidsverk = () => {
    if (!selectedArticleId || !tidsverkResource) {
      toast({ title: "Välj en artikel", variant: "destructive" });
      return;
    }
    createTidsverkMutation.mutate({
      resourceId: tidsverkResource.id,
      articleId: selectedArticleId,
      efficiencyFactor,
      productionTime: productionTimeOverride ?? undefined,
    });
  };

  const filteredResources = useMemo(() => {
    return resources.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.phone || "").includes(searchQuery);

      const matchesCompetency = competencyFilter === "all" ||
        (r.competencies || []).includes(competencyFilter);

      const currentAvail = getCurrentAvailability(r);
      const matchesAvailability = availabilityFilter === "all" ||
        currentAvail === availabilityFilter;

      return matchesSearch && matchesCompetency && matchesAvailability;
    });
  }, [resources, searchQuery, competencyFilter, availabilityFilter]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

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
          <h1 className="text-2xl font-semibold">Resurser</h1>
          <p className="text-sm text-muted-foreground">{resources.length} tekniker registrerade</p>
        </div>
        <Button onClick={openCreateDialog} data-testid="button-add-resource">
          <Plus className="h-4 w-4 mr-2" />
          Lägg till resurs
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök resurser..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-resources"
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
                  <Label className="text-sm text-muted-foreground">Kompetens</Label>
                  <Select value={competencyFilter} onValueChange={setCompetencyFilter}>
                    <SelectTrigger className="w-48" data-testid="select-competency-filter">
                      <SelectValue placeholder="Alla kompetenser" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alla kompetenser</SelectItem>
                      {competencyOptions.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Tillgänglighet</Label>
                  <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
                    <SelectTrigger className="w-48" data-testid="select-availability-filter">
                      <SelectValue placeholder="Alla" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alla</SelectItem>
                      {availabilityOptions.map(a => (
                        <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredResources.map((resource) => {
          const workloadMinutes = resourceWorkloads.get(resource.id) || 0;
          const workloadHours = Math.round(workloadMinutes / 60 * 10) / 10;
          const weeklyHours = resource.weeklyHours || 40;
          const workloadPercent = weeklyHours > 0 
            ? Math.min(100, Math.round((workloadMinutes / 60) / weeklyHours * 100))
            : 0;
          const currentAvail = getCurrentAvailability(resource);
          const availOption = availabilityOptions.find(a => a.value === currentAvail);
          const resourceJobs = getResourceWorkOrders(resource.id);

          return (
            <Card
              key={resource.id}
              className="group"
              data-testid={`resource-card-${resource.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="relative">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="text-sm">
                        {resource.initials || resource.name.split(" ").map(n => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    {currentAvail !== "available" && (
                      <div
                        className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-background ${availOption?.color || "bg-gray-500"}`}
                        title={availOption?.label}
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-semibold truncate">{resource.name}</h3>
                      <div className="flex items-center gap-1">
                        <Badge variant={resource.status === "active" ? "secondary" : "outline"}>
                          {resource.status === "active" ? "Aktiv" : "Inaktiv"}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                openTidsverkDialog(resource);
                              }}
                              data-testid={`button-tidsverk-resource-${resource.id}`}
                            >
                              <Wrench className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Hantera tidsverk</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                openScheduleDialog(resource);
                              }}
                              data-testid={`button-schedule-resource-${resource.id}`}
                            >
                              <Calendar className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Visa schema</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAvailabilityDialog(resource);
                              }}
                              data-testid={`button-availability-resource-${resource.id}`}
                            >
                              <CalendarOff className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Ange frånvaro</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(resource);
                              }}
                              data-testid={`button-edit-resource-${resource.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Redigera</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDeleteDialog(resource);
                              }}
                              data-testid={`button-delete-resource-${resource.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Ta bort</p></TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-muted-foreground mb-3">
                      {resource.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3" />
                          <span>{resource.phone}</span>
                        </div>
                      )}
                      {resource.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">{resource.email}</span>
                        </div>
                      )}
                      {resource.homeLocation && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3" />
                          <span>{resource.homeLocation}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1 mb-3">
                      {(resource.competencies || []).slice(0, 3).map((comp) => (
                        <Badge key={comp} variant="outline" className="text-[10px]">
                          {competencyLabels[comp] || comp}
                        </Badge>
                      ))}
                      {(resource.competencies || []).length > 3 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{(resource.competencies || []).length - 3}
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Veckobeläggning</span>
                        <span className={workloadPercent > 90 ? "text-destructive font-medium" : ""}>
                          {workloadHours} av {weeklyHours}h ({workloadPercent}%)
                        </span>
                      </div>
                      <Progress
                        value={workloadPercent}
                        className={workloadPercent > 90 ? "[&>div]:bg-destructive" : ""}
                      />
                      {resourceJobs.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {resourceJobs.length} jobb denna vecka
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredResources.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Inga resurser hittades</p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingResource ? "Redigera resurs" : "Lägg till resurs"}
            </DialogTitle>
            <DialogDescription>
              {editingResource ? "Uppdatera resursinformation" : "Fyll i information om den nya resursen"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Namn *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Anna Andersson"
                  data-testid="input-resource-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="initials">Initialer</Label>
                <Input
                  id="initials"
                  value={formData.initials}
                  onChange={(e) => setFormData(prev => ({ ...prev, initials: e.target.value.toUpperCase() }))}
                  placeholder="AA"
                  maxLength={3}
                  data-testid="input-resource-initials"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+46701234567"
                  data-testid="input-resource-phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-post</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="anna@kinab.se"
                  data-testid="input-resource-email"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="homeLocation">Hemort</Label>
                <Input
                  id="homeLocation"
                  value={formData.homeLocation}
                  onChange={(e) => setFormData(prev => ({ ...prev, homeLocation: e.target.value }))}
                  placeholder="Södertälje"
                  data-testid="input-resource-location"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="weeklyHours">Veckotimmar</Label>
                <Input
                  id="weeklyHours"
                  type="number"
                  value={formData.weeklyHours}
                  onChange={(e) => setFormData(prev => ({ ...prev, weeklyHours: parseInt(e.target.value) || 40 }))}
                  min={0}
                  max={60}
                  data-testid="input-resource-hours"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="resourceType">Typ</Label>
                <Select
                  value={formData.resourceType}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, resourceType: v }))}
                >
                  <SelectTrigger data-testid="select-resource-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="person">Person</SelectItem>
                    <SelectItem value="vehicle">Fordon</SelectItem>
                    <SelectItem value="equipment">Utrustning</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}
                >
                  <SelectTrigger data-testid="select-resource-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktiv</SelectItem>
                    <SelectItem value="inactive">Inaktiv</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Kompetenser</Label>
              <div className="grid grid-cols-2 gap-2">
                {competencyOptions.map((comp) => (
                  <div key={comp.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`comp-${comp.value}`}
                      checked={formData.competencies.includes(comp.value)}
                      onCheckedChange={() => handleCompetencyToggle(comp.value)}
                      data-testid={`checkbox-competency-${comp.value}`}
                    />
                    <Label htmlFor={`comp-${comp.value}`} className="text-sm font-normal cursor-pointer">
                      {comp.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Avbryt
            </Button>
            <Button onClick={handleSubmit} disabled={isPending} data-testid="button-save-resource">
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingResource ? "Spara" : "Lägg till"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Schema för {selectedResource?.name}
            </DialogTitle>
            <DialogDescription>
              Vecka {format(weekStart, "w", { locale: sv })}: {format(weekStart, "d MMM", { locale: sv })} - {format(weekEnd, "d MMM yyyy", { locale: sv })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {selectedResource && (
              <>
                {weekDays.map(day => {
                  const dayJobs = getResourceWorkOrders(selectedResource.id).filter(wo => {
                    if (!wo.scheduledDate) return false;
                    const woDate = new Date(wo.scheduledDate);
                    return format(woDate, "yyyy-MM-dd") === format(day, "yyyy-MM-dd");
                  });
                  const dayName = format(day, "EEEE", { locale: sv });
                  const dayDate = format(day, "d/M");

                  return (
                    <div key={day.toISOString()}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium capitalize">{dayName}</span>
                        <span className="text-sm text-muted-foreground">{dayDate}</span>
                        <Badge variant="outline" className="text-xs">
                          {dayJobs.length} jobb
                        </Badge>
                      </div>
                      {dayJobs.length > 0 ? (
                        <div className="space-y-2 ml-4">
                          {dayJobs.map(job => (
                            <div
                              key={job.id}
                              className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                            >
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{job.scheduledStartTime || "—"}</span>
                              <span className="text-sm flex-1">{job.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {objectMap.get(job.objectId) || "—"}
                              </span>
                              <Badge
                                variant={
                                  job.status === "completed" ? "secondary" :
                                    job.status === "in_progress" ? "default" : "outline"
                                }
                                className="text-xs"
                              >
                                {job.status === "completed" ? "Klar" :
                                  job.status === "in_progress" ? "Pågår" :
                                    job.status === "scheduled" ? "Schemalagt" : job.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground ml-4">Inga jobb</p>
                      )}
                      <Separator className="mt-3" />
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleDialogOpen(false)}>
              Stäng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={availabilityDialogOpen} onOpenChange={setAvailabilityDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Tillgänglighet för {selectedResource?.name}
            </DialogTitle>
            <DialogDescription>
              Markera ledighet och frånvaro för kommande dagar
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {weekDays.map(day => {
              const dateKey = format(day, "yyyy-MM-dd");
              const currentValue = formData.availability[dateKey] || "available";
              const dayName = format(day, "EEEE", { locale: sv });
              const dayDate = format(day, "d/M");

              return (
                <div key={dateKey} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize w-24">{dayName}</span>
                    <span className="text-sm text-muted-foreground">{dayDate}</span>
                  </div>
                  <Select
                    value={currentValue}
                    onValueChange={(v) => handleAvailabilityChange(dateKey, v)}
                  >
                    <SelectTrigger className="w-40" data-testid={`select-availability-${dateKey}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availabilityOptions.map(a => (
                        <SelectItem key={a.value} value={a.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${a.color}`} />
                            {a.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAvailabilityDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={saveAvailability}
              disabled={updateMutation.isPending}
              data-testid="button-save-availability"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tidsverkDialogOpen} onOpenChange={setTidsverkDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Tidsverk för {tidsverkResource?.name}
            </DialogTitle>
            <DialogDescription>
              Hantera vilka artiklar denna resurs kan utföra och dess effektivitet
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-4 items-end flex-wrap">
              <div className="flex-1 min-w-[200px] space-y-2">
                <Label>Artikel</Label>
                <Select value={selectedArticleId} onValueChange={setSelectedArticleId}>
                  <SelectTrigger data-testid="select-tidsverk-article">
                    <SelectValue placeholder="Välj artikel..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableArticles.map(article => (
                      <SelectItem key={article.id} value={article.id}>
                        {article.articleNumber} - {article.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32 space-y-2">
                <Label>Effektivitet</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="3.0"
                  value={efficiencyFactor}
                  onChange={(e) => setEfficiencyFactor(parseFloat(e.target.value) || 1.0)}
                  data-testid="input-tidsverk-efficiency"
                />
              </div>
              <div className="w-32 space-y-2">
                <Label>Tid (min)</Label>
                <Input
                  type="number"
                  min="0"
                  placeholder="Standard"
                  value={productionTimeOverride ?? ""}
                  onChange={(e) => setProductionTimeOverride(e.target.value ? parseInt(e.target.value) : null)}
                  data-testid="input-tidsverk-time"
                />
              </div>
              <Button
                onClick={handleAddTidsverk}
                disabled={!selectedArticleId || createTidsverkMutation.isPending}
                data-testid="button-add-tidsverk"
              >
                {createTidsverkMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Tilldelade artiklar ({resourceArticles.length})
              </Label>
              {resourceArticles.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Inga artiklar tilldelade ännu
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {resourceArticles.map(ra => {
                    const article = articleMap.get(ra.articleId);
                    return (
                      <div
                        key={ra.id}
                        className="flex items-center justify-between gap-4 p-3 rounded-md bg-muted/50"
                        data-testid={`tidsverk-item-${ra.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {article?.articleNumber || "?"} - {article?.name || "Okänd artikel"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Effektivitet: {ra.efficiencyFactor}x | 
                            Tid: {ra.productionTime ?? article?.productionTime ?? "—"} min
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {article?.articleType || "—"}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => tidsverkResource && deleteTidsverkMutation.mutate({ id: ra.id, resourceId: tidsverkResource.id })}
                          disabled={deleteTidsverkMutation.isPending}
                          data-testid={`button-delete-tidsverk-${ra.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTidsverkDialogOpen(false)}>
              Stäng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort resurs?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort {resourceToDelete?.name}?
              Detta kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resourceToDelete && deleteMutation.mutate(resourceToDelete.id)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete-resource"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
