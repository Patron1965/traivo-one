import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Plus, Search, Phone, MapPin, Loader2, Pencil, Trash2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Resource } from "@shared/schema";

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
};

export default function ResourcesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
  const [formData, setFormData] = useState<ResourceFormData>(emptyFormData);

  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

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
    });
    setDialogOpen(true);
  };

  const openDeleteDialog = (resource: Resource) => {
    setResourceToDelete(resource);
    setDeleteDialogOpen(true);
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

  const filteredResources = resources.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.phone || "").includes(searchQuery)
  );

  const isPending = createMutation.isPending || updateMutation.isPending;

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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Sök resurser..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          data-testid="input-search-resources"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredResources.map((resource) => (
          <Card
            key={resource.id}
            className="group"
            data-testid={`resource-card-${resource.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="text-sm">
                    {resource.initials || resource.name.split(" ").map(n => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="font-semibold truncate">{resource.name}</h3>
                    <div className="flex items-center gap-1">
                      <Badge variant={resource.status === "active" ? "secondary" : "outline"}>
                        {resource.status === "active" ? "Aktiv" : "Inaktiv"}
                      </Badge>
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
                      <span>0 av {resource.weeklyHours || 40}h</span>
                    </div>
                    <Progress value={0} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
