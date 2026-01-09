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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  Play,
  Layers,
  Filter,
  Calendar,
  Target,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { OrderConcept, Cluster, Article, ConceptFilter } from "@shared/schema";
import { PageHelp } from "@/components/ui/help-tooltip";

const scheduleTypeOptions = [
  { value: "once", label: "Engång" },
  { value: "recurring", label: "Återkommande" },
  { value: "subscription", label: "Abonnemang" },
];

const priorityOptions = [
  { value: "low", label: "Låg" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Hög" },
  { value: "urgent", label: "Brådskande" },
];

const filterOperatorOptions = [
  { value: "equals", label: "Lika med" },
  { value: "not_equals", label: "Ej lika med" },
  { value: "contains", label: "Innehåller" },
  { value: "starts_with", label: "Börjar med" },
  { value: "greater_than", label: "Större än" },
  { value: "less_than", label: "Mindre än" },
  { value: "exists", label: "Finns" },
  { value: "not_exists", label: "Finns inte" },
];

interface FormData {
  name: string;
  description: string;
  targetClusterId: string;
  articleId: string;
  crossPollinationField: string;
  aggregationLevel: string;
  scheduleType: string;
  intervalDays: number;
  priority: string;
}

interface FilterFormData {
  metadataKey: string;
  operator: string;
  filterValue: string;
  targetLevel: string;
  priority: number;
}

export default function OrderConceptsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConcept, setEditingConcept] = useState<OrderConcept | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [conceptToDelete, setConceptToDelete] = useState<string | null>(null);
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [conceptToExecute, setConceptToExecute] = useState<OrderConcept | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    description: "",
    targetClusterId: "",
    articleId: "",
    crossPollinationField: "",
    aggregationLevel: "",
    scheduleType: "once",
    intervalDays: 0,
    priority: "normal",
  });
  const [filterForm, setFilterForm] = useState<FilterFormData>({
    metadataKey: "",
    operator: "equals",
    filterValue: "",
    targetLevel: "",
    priority: 1,
  });

  const { toast } = useToast();

  const { data: concepts = [], isLoading } = useQuery<OrderConcept[]>({
    queryKey: ["/api/order-concepts"],
  });

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: selectedFilters = [] } = useQuery<ConceptFilter[]>({
    queryKey: ["/api/order-concepts", selectedConceptId, "filters"],
    enabled: !!selectedConceptId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<OrderConcept>) => apiRequest("POST", "/api/order-concepts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Orderkoncept skapat" });
    },
    onError: () => {
      toast({ title: "Kunde inte skapa orderkoncept", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OrderConcept> }) =>
      apiRequest("PATCH", `/api/order-concepts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      setIsDialogOpen(false);
      setEditingConcept(null);
      resetForm();
      toast({ title: "Orderkoncept uppdaterat" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/order-concepts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      toast({ title: "Orderkoncept raderat" });
    },
  });

  const executeMutation = useMutation({
    mutationFn: ({ id, scheduledDate }: { id: string; scheduledDate?: string }) =>
      apiRequest("POST", `/api/order-concepts/${id}/execute`, { scheduledDate }),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      setExecuteDialogOpen(false);
      setConceptToExecute(null);
      toast({
        title: "Orderkoncept kört",
        description: `Skapade ${response.assignmentsCreated} uppgifter`,
      });
    },
    onError: () => {
      toast({ title: "Kunde inte köra orderkoncept", variant: "destructive" });
    },
  });

  const addFilterMutation = useMutation({
    mutationFn: ({ conceptId, data }: { conceptId: string; data: Partial<ConceptFilter> }) =>
      apiRequest("POST", `/api/order-concepts/${conceptId}/filters`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts", selectedConceptId, "filters"] });
      setFilterForm({ metadataKey: "", operator: "equals", filterValue: "", targetLevel: "", priority: 1 });
      toast({ title: "Filter tillagt" });
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: ({ conceptId, filterId }: { conceptId: string; filterId: string }) =>
      apiRequest("DELETE", `/api/order-concepts/${conceptId}/filters/${filterId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts", selectedConceptId, "filters"] });
      toast({ title: "Filter borttaget" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      targetClusterId: "",
      articleId: "",
      crossPollinationField: "",
      aggregationLevel: "",
      scheduleType: "once",
      intervalDays: 0,
      priority: "normal",
    });
  };

  const handleEdit = (concept: OrderConcept) => {
    setEditingConcept(concept);
    setFormData({
      name: concept.name,
      description: concept.description || "",
      targetClusterId: concept.targetClusterId || "",
      articleId: concept.articleId || "",
      crossPollinationField: concept.crossPollinationField || "",
      aggregationLevel: concept.aggregationLevel || "",
      scheduleType: concept.scheduleType,
      intervalDays: concept.intervalDays || 0,
      priority: concept.priority || "normal",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    const submitData = {
      ...formData,
      targetClusterId: formData.targetClusterId || null,
      articleId: formData.articleId || null,
      crossPollinationField: formData.crossPollinationField || null,
      aggregationLevel: formData.aggregationLevel || null,
      intervalDays: formData.intervalDays || null,
    };

    if (editingConcept) {
      updateMutation.mutate({ id: editingConcept.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleExecute = (concept: OrderConcept) => {
    setConceptToExecute(concept);
    setScheduledDate("");
    setExecuteDialogOpen(true);
  };

  const handleManageFilters = (conceptId: string) => {
    setSelectedConceptId(conceptId);
    setFilterDialogOpen(true);
  };

  const handleAddFilter = () => {
    if (!selectedConceptId || !filterForm.metadataKey) return;
    addFilterMutation.mutate({
      conceptId: selectedConceptId,
      data: {
        metadataKey: filterForm.metadataKey,
        operator: filterForm.operator,
        filterValue: filterForm.filterValue,
        targetLevel: filterForm.targetLevel || null,
        priority: filterForm.priority,
      },
    });
  };

  const filteredConcepts = concepts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-concepts">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Orderkoncept</h1>
          <p className="text-muted-foreground">
            Definiera intelligenta arbetsordergeneratorer
          </p>
        </div>
        <PageHelp
          title="Orderkoncept"
          description="Orderkoncept är regler för att automatiskt generera uppgifter baserat på objektfilter och korsbefruktning. Peka in ett koncept på ett kluster så söker det nedåt i hierarkin efter matchande objekt."
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök orderkoncept..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-concepts"
          />
        </div>
        <Button onClick={() => setIsDialogOpen(true)} data-testid="button-add-concept">
          <Plus className="h-4 w-4 mr-2" />
          Nytt koncept
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Kluster</TableHead>
                <TableHead>Artikel</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Prioritet</TableHead>
                <TableHead>Senast körd</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredConcepts.map((concept) => (
                <TableRow key={concept.id} data-testid={`row-concept-${concept.id}`}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{concept.name}</div>
                      {concept.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-xs">
                          {concept.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {concept.targetClusterId ? (
                      <Badge variant="outline">
                        {clusters.find((c) => c.id === concept.targetClusterId)?.name || "Okänt"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">Alla objekt</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {concept.articleId ? (
                      <Badge variant="secondary">
                        {articles.find((a) => a.id === concept.articleId)?.name || "Okänd"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={concept.scheduleType === "recurring" ? "default" : "outline"}>
                      {scheduleTypeOptions.find((s) => s.value === concept.scheduleType)?.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        concept.priority === "urgent"
                          ? "destructive"
                          : concept.priority === "high"
                          ? "default"
                          : "outline"
                      }
                    >
                      {priorityOptions.find((p) => p.value === concept.priority)?.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {concept.lastRunDate ? (
                      new Date(concept.lastRunDate).toLocaleDateString("sv-SE")
                    ) : (
                      <span className="text-muted-foreground">Aldrig</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleExecute(concept)}
                        title="Kör koncept"
                        data-testid={`button-execute-${concept.id}`}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleManageFilters(concept.id)}
                        title="Hantera filter"
                        data-testid={`button-filters-${concept.id}`}
                      >
                        <Filter className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleEdit(concept)}
                        data-testid={`button-edit-${concept.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setConceptToDelete(concept.id);
                          setDeleteConfirmOpen(true);
                        }}
                        data-testid={`button-delete-${concept.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredConcepts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {searchTerm ? "Inga orderkoncept matchade sökningen" : "Inga orderkoncept skapade än"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingConcept ? "Redigera orderkoncept" : "Skapa orderkoncept"}</DialogTitle>
            <DialogDescription>
              Definiera regler för automatisk uppgiftsgenerering
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Namn *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="T.ex. Veckotömning matavfall"
                data-testid="input-concept-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Beskrivning</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Beskriv vad konceptet gör..."
                data-testid="input-concept-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Målkluster</Label>
                <Select
                  value={formData.targetClusterId || "__none__"}
                  onValueChange={(v) => setFormData({ ...formData, targetClusterId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-target-cluster">
                    <SelectValue placeholder="Alla objekt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Alla objekt</SelectItem>
                    {clusters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Artikel</Label>
                <Select
                  value={formData.articleId || "__none__"}
                  onValueChange={(v) => setFormData({ ...formData, articleId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-article">
                    <SelectValue placeholder="Välj artikel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Ingen artikel</SelectItem>
                    {articles.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Schematyp</Label>
                <Select
                  value={formData.scheduleType}
                  onValueChange={(v) => setFormData({ ...formData, scheduleType: v })}
                >
                  <SelectTrigger data-testid="select-schedule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scheduleTypeOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Prioritet</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(v) => setFormData({ ...formData, priority: v })}
                >
                  <SelectTrigger data-testid="select-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formData.scheduleType === "recurring" && (
              <div className="space-y-2">
                <Label>Intervall (dagar)</Label>
                <Input
                  type="number"
                  value={formData.intervalDays}
                  onChange={(e) => setFormData({ ...formData, intervalDays: parseInt(e.target.value) || 0 })}
                  data-testid="input-interval-days"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Korsbefruktningsfält</Label>
              <Input
                value={formData.crossPollinationField}
                onChange={(e) => setFormData({ ...formData, crossPollinationField: e.target.value })}
                placeholder="T.ex. containerCount (för att multiplicera uppgifter)"
                data-testid="input-cross-pollination"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-concept"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editingConcept ? "Spara" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execute Dialog */}
      <Dialog open={executeDialogOpen} onOpenChange={setExecuteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kör orderkoncept</DialogTitle>
            <DialogDescription>
              Generera uppgifter från "{conceptToExecute?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Schemalagd datum (valfritt)</Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                data-testid="input-scheduled-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExecuteDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() =>
                conceptToExecute &&
                executeMutation.mutate({
                  id: conceptToExecute.id,
                  scheduledDate: scheduledDate || undefined,
                })
              }
              disabled={executeMutation.isPending}
              data-testid="button-confirm-execute"
            >
              {executeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Kör
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filter Dialog */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Hantera filter</DialogTitle>
            <DialogDescription>
              Definiera vilka objekt som ska matchas
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Metadatanyckel *</Label>
                <Input
                  value={filterForm.metadataKey}
                  onChange={(e) => setFilterForm({ ...filterForm, metadataKey: e.target.value })}
                  placeholder="T.ex. objectType"
                  data-testid="input-filter-key"
                />
              </div>
              <div className="space-y-2">
                <Label>Operator</Label>
                <Select
                  value={filterForm.operator}
                  onValueChange={(v) => setFilterForm({ ...filterForm, operator: v })}
                >
                  <SelectTrigger data-testid="select-filter-operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOperatorOptions.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Värde</Label>
              <Input
                value={filterForm.filterValue}
                onChange={(e) => setFilterForm({ ...filterForm, filterValue: e.target.value })}
                placeholder="T.ex. matavfall"
                data-testid="input-filter-value"
              />
            </div>
            <Button onClick={handleAddFilter} disabled={!filterForm.metadataKey} data-testid="button-add-filter">
              <Plus className="h-4 w-4 mr-2" />
              Lägg till filter
            </Button>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nyckel</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Värde</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedFilters.map((filter) => (
                    <TableRow key={filter.id}>
                      <TableCell>{filter.metadataKey}</TableCell>
                      <TableCell>{filterOperatorOptions.find((o) => o.value === filter.operator)?.label}</TableCell>
                      <TableCell>{JSON.stringify(filter.filterValue)}</TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            selectedConceptId &&
                            deleteFilterMutation.mutate({ conceptId: selectedConceptId, filterId: filter.id })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {selectedFilters.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Inga filter definierade (matchar alla objekt)
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setFilterDialogOpen(false)}>Stäng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Radera orderkoncept?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta raderar orderkonceptet permanent. Befintliga uppgifter påverkas inte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (conceptToDelete) {
                  deleteMutation.mutate(conceptToDelete);
                  setDeleteConfirmOpen(false);
                }
              }}
            >
              Radera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
