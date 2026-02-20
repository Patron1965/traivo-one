import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Filter,
  Eye,
  Calendar,
  CreditCard,
  RefreshCw,
  Check,
  X,
  Clock,
  Package,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { OrderConcept, Cluster, Article, ConceptFilter, DeliveryScheduleEntry } from "@shared/schema";
import { ORDER_CONCEPT_SCENARIO_LABELS, BILLING_FREQUENCY_LABELS } from "@shared/schema";
import { PageHelp } from "@/components/ui/help-tooltip";

const scenarioOptions = [
  { value: "avrop", label: "Avrop (engång)", desc: "Manuellt eller vid behov" },
  { value: "schema", label: "Schema (leveransplan)", desc: "Återkommande med tidsfönster" },
  { value: "abonnemang", label: "Abonnemang (fast avgift)", desc: "Fast månadsavgift per enhet" },
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
  { value: "in_list", label: "Finns i lista" },
  { value: "exists", label: "Finns" },
  { value: "not_exists", label: "Finns inte" },
];

const weekdayLabels = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];

interface FormData {
  name: string;
  description: string;
  targetClusterId: string;
  articleId: string;
  crossPollinationField: string;
  aggregationLevel: string;
  scenario: string;
  scheduleType: string;
  intervalDays: number;
  priority: string;
  rollingMonths: number;
  minDaysBetween: number;
  monthlyFee: number;
  billingFrequency: string;
  contractLockMonths: number;
  subscriptionMetadataField: string;
  deliverySchedule: DeliveryScheduleEntry[];
}

interface FilterFormData {
  metadataKey: string;
  operator: string;
  filterValue: string;
  targetLevel: string;
  priority: number;
}

interface PreviewData {
  objectsMatched: number;
  totalFilters: number;
  items: Array<{
    objectId: string;
    objectName: string;
    address: string;
    quantity: number;
    articleName: string;
    estimatedDuration: number;
    estimatedValue: number;
  }>;
  schedulePreview: Array<{ date: string; objectCount: number }>;
  subscriptionCalc?: {
    totalUnits: number;
    monthlyTotal: number;
    yearlyTotal: number;
  };
}

const defaultForm: FormData = {
  name: "",
  description: "",
  targetClusterId: "",
  articleId: "",
  crossPollinationField: "",
  aggregationLevel: "",
  scenario: "avrop",
  scheduleType: "once",
  intervalDays: 0,
  priority: "normal",
  rollingMonths: 3,
  minDaysBetween: 0,
  monthlyFee: 0,
  billingFrequency: "monthly",
  contractLockMonths: 0,
  subscriptionMetadataField: "",
  deliverySchedule: [],
};

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
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("alla");
  const [formData, setFormData] = useState<FormData>({ ...defaultForm });
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

  const { data: articlesList = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: selectedFilters = [] } = useQuery<ConceptFilter[]>({
    queryKey: ["/api/order-concepts", selectedConceptId, "filters"],
    enabled: !!selectedConceptId,
  });

  const previewMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/order-concepts/${id}/preview`),
  });

  const previewData = previewMutation.data as PreviewData | undefined;
  const previewLoading = previewMutation.isPending;

  const createMutation = useMutation({
    mutationFn: (data: Partial<OrderConcept>) => apiRequest("POST", "/api/order-concepts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      setIsDialogOpen(false);
      setFormData({ ...defaultForm });
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
      setFormData({ ...defaultForm });
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

  const runRollingMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/order-concepts/${id}/run-rolling`),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      toast({
        title: "Rullande schema kört",
        description: response.message || `Genererade ${response.assignmentsCreated} uppgifter`,
      });
    },
    onError: () => {
      toast({ title: "Kunde inte köra rullande schema", variant: "destructive" });
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

  const handleEdit = (concept: OrderConcept) => {
    setEditingConcept(concept);
    const schedule = (concept.deliverySchedule as DeliveryScheduleEntry[] | null) || [];
    setFormData({
      name: concept.name,
      description: concept.description || "",
      targetClusterId: concept.targetClusterId || "",
      articleId: concept.articleId || "",
      crossPollinationField: concept.crossPollinationField || "",
      aggregationLevel: concept.aggregationLevel || "",
      scenario: (concept as any).scenario || "avrop",
      scheduleType: concept.scheduleType,
      intervalDays: concept.intervalDays || 0,
      priority: concept.priority || "normal",
      rollingMonths: (concept as any).rollingMonths || 3,
      minDaysBetween: (concept as any).minDaysBetween || 0,
      monthlyFee: (concept as any).monthlyFee || 0,
      billingFrequency: (concept as any).billingFrequency || "monthly",
      contractLockMonths: (concept as any).contractLockMonths || 0,
      subscriptionMetadataField: (concept as any).subscriptionMetadataField || "",
      deliverySchedule: schedule,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    const submitData: any = {
      name: formData.name,
      description: formData.description || null,
      targetClusterId: formData.targetClusterId || null,
      articleId: formData.articleId || null,
      crossPollinationField: formData.crossPollinationField || null,
      aggregationLevel: formData.aggregationLevel || null,
      scenario: formData.scenario,
      scheduleType: formData.scenario === "schema" ? "recurring" : formData.scenario === "abonnemang" ? "subscription" : "once",
      priority: formData.priority,
      rollingMonths: formData.rollingMonths || 3,
      minDaysBetween: formData.minDaysBetween || null,
      deliverySchedule: formData.deliverySchedule.length > 0 ? formData.deliverySchedule : null,
      monthlyFee: formData.scenario === "abonnemang" ? formData.monthlyFee : null,
      billingFrequency: formData.scenario === "abonnemang" ? formData.billingFrequency : null,
      contractLockMonths: formData.scenario === "abonnemang" ? (formData.contractLockMonths || null) : null,
      subscriptionMetadataField: formData.scenario === "abonnemang" ? (formData.subscriptionMetadataField || null) : null,
    };

    if (editingConcept) {
      updateMutation.mutate({ id: editingConcept.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handlePreview = (concept: OrderConcept) => {
    previewMutation.mutate(concept.id);
    setPreviewDialogOpen(true);
  };

  const handleAddScheduleEntry = () => {
    setFormData({
      ...formData,
      deliverySchedule: [
        ...formData.deliverySchedule,
        { month: 0, weekNumber: 1, weekday: 1, timeWindowStart: "08:00", timeWindowEnd: "12:00" },
      ],
    });
  };

  const handleRemoveScheduleEntry = (index: number) => {
    const updated = [...formData.deliverySchedule];
    updated.splice(index, 1);
    setFormData({ ...formData, deliverySchedule: updated });
  };

  const updateScheduleEntry = (index: number, field: keyof DeliveryScheduleEntry, value: any) => {
    const updated = [...formData.deliverySchedule];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, deliverySchedule: updated });
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

  const filteredConcepts = concepts.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchTerm.toLowerCase());
    if (activeTab === "alla") return matchesSearch;
    return matchesSearch && (c as any).scenario === activeTab;
  });

  const scenarioCounts = {
    alla: concepts.length,
    avrop: concepts.filter((c) => (c as any).scenario === "avrop" || !(c as any).scenario).length,
    schema: concepts.filter((c) => (c as any).scenario === "schema").length,
    abonnemang: concepts.filter((c) => (c as any).scenario === "abonnemang").length,
  };

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
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Orderkoncept</h1>
          <p className="text-muted-foreground">
            Automatisera ordrar: avrop, schemalagda leveranser och abonnemang
          </p>
        </div>
        <PageHelp
          title="Orderkoncept"
          description="Orderkoncept definierar hur arbetsordrar genereras automatiskt. Välj scenario: Avrop (engångsorder), Schema (återkommande med leveransplan) eller Abonnemang (fast månadsavgift med automatisk kalkyl)."
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card data-testid="stat-avrop">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
              <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{scenarioCounts.avrop}</div>
              <div className="text-sm text-muted-foreground">Avrop</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-schema">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
              <Calendar className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{scenarioCounts.schema}</div>
              <div className="text-sm text-muted-foreground">Schema</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-abonnemang">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
              <CreditCard className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{scenarioCounts.abonnemang}</div>
              <div className="text-sm text-muted-foreground">Abonnemang</div>
            </div>
          </CardContent>
        </Card>
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
        <Button onClick={() => { setEditingConcept(null); setFormData({ ...defaultForm }); setIsDialogOpen(true); }} data-testid="button-add-concept">
          <Plus className="h-4 w-4 mr-2" />
          Nytt koncept
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-scenario">
          <TabsTrigger value="alla">Alla ({scenarioCounts.alla})</TabsTrigger>
          <TabsTrigger value="avrop">Avrop ({scenarioCounts.avrop})</TabsTrigger>
          <TabsTrigger value="schema">Schema ({scenarioCounts.schema})</TabsTrigger>
          <TabsTrigger value="abonnemang">Abonnemang ({scenarioCounts.abonnemang})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Kluster</TableHead>
                <TableHead>Artikel</TableHead>
                <TableHead>Prioritet</TableHead>
                <TableHead>Senast körd</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredConcepts.map((concept) => {
                const scenario = (concept as any).scenario || "avrop";
                return (
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
                      <Badge
                        variant={scenario === "abonnemang" ? "default" : scenario === "schema" ? "secondary" : "outline"}
                        data-testid={`badge-scenario-${concept.id}`}
                      >
                        {ORDER_CONCEPT_SCENARIO_LABELS[scenario as keyof typeof ORDER_CONCEPT_SCENARIO_LABELS] || scenario}
                      </Badge>
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
                          {articlesList.find((a) => a.id === concept.articleId)?.name || "Okänd"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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
                          onClick={() => handlePreview(concept)}
                          title="Förhandsgranska"
                          data-testid={`button-preview-${concept.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {scenario === "schema" ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => runRollingMutation.mutate(concept.id)}
                            title="Kör rullande schema"
                            disabled={runRollingMutation.isPending}
                            data-testid={`button-run-rolling-${concept.id}`}
                          >
                            <RefreshCw className={`h-4 w-4 ${runRollingMutation.isPending ? "animate-spin" : ""}`} />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => { setConceptToExecute(concept); setScheduledDate(""); setExecuteDialogOpen(true); }}
                            title="Kör koncept"
                            data-testid={`button-execute-${concept.id}`}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
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
                          onClick={() => { setConceptToDelete(concept.id); setDeleteConfirmOpen(true); }}
                          data-testid={`button-delete-${concept.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingConcept ? "Redigera orderkoncept" : "Skapa orderkoncept"}</DialogTitle>
            <DialogDescription>
              Definiera regler för automatisk uppgiftsgenerering
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
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

            <div className="space-y-2">
              <Label>Scenario *</Label>
              <div className="grid grid-cols-3 gap-3">
                {scenarioOptions.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, scenario: s.value })}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      formData.scenario === s.value
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                    data-testid={`button-scenario-${s.value}`}
                  >
                    <div className="font-medium text-sm">{s.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.desc}</div>
                  </button>
                ))}
              </div>
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
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
                    {articlesList.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Korsbefruktningsfält</Label>
                <Input
                  value={formData.crossPollinationField}
                  onChange={(e) => setFormData({ ...formData, crossPollinationField: e.target.value })}
                  placeholder="T.ex. antal_karl"
                  data-testid="input-cross-pollination"
                />
              </div>
            </div>

            {/* Schema-specific fields */}
            {formData.scenario === "schema" && (
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Leveransschema
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Rullande månader</Label>
                      <Input
                        type="number"
                        value={formData.rollingMonths}
                        onChange={(e) => setFormData({ ...formData, rollingMonths: parseInt(e.target.value) || 3 })}
                        min={1}
                        max={12}
                        data-testid="input-rolling-months"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Min dagar mellan besök</Label>
                      <Input
                        type="number"
                        value={formData.minDaysBetween}
                        onChange={(e) => setFormData({ ...formData, minDaysBetween: parseInt(e.target.value) || 0 })}
                        min={0}
                        data-testid="input-min-days"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Tidsfönster</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddScheduleEntry}
                        data-testid="button-add-schedule"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Lägg till
                      </Button>
                    </div>

                    {formData.deliverySchedule.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-3">
                        Inga tidsfönster definierade. Klicka "Lägg till" för att börja.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {formData.deliverySchedule.map((entry, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
                            <Select
                              value={String(entry.month)}
                              onValueChange={(v) => updateScheduleEntry(idx, "month", parseInt(v))}
                            >
                              <SelectTrigger className="w-24" data-testid={`select-schedule-month-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">Alla mån</SelectItem>
                                {monthLabels.map((m, i) => (
                                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={String(entry.weekNumber)}
                              onValueChange={(v) => updateScheduleEntry(idx, "weekNumber", parseInt(v))}
                            >
                              <SelectTrigger className="w-20" data-testid={`select-schedule-week-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[1, 2, 3, 4, 5].map((w) => (
                                  <SelectItem key={w} value={String(w)}>V{w}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={String(entry.weekday)}
                              onValueChange={(v) => updateScheduleEntry(idx, "weekday", parseInt(v))}
                            >
                              <SelectTrigger className="w-20" data-testid={`select-schedule-weekday-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {weekdayLabels.map((d, i) => (
                                  <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="time"
                              value={entry.timeWindowStart || "08:00"}
                              onChange={(e) => updateScheduleEntry(idx, "timeWindowStart", e.target.value)}
                              className="w-24"
                              data-testid={`input-schedule-start-${idx}`}
                            />
                            <span className="text-muted-foreground">-</span>
                            <Input
                              type="time"
                              value={entry.timeWindowEnd || "12:00"}
                              onChange={(e) => updateScheduleEntry(idx, "timeWindowEnd", e.target.value)}
                              className="w-24"
                              data-testid={`input-schedule-end-${idx}`}
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => handleRemoveScheduleEntry(idx)}
                              data-testid={`button-remove-schedule-${idx}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Abonnemang-specific fields */}
            {formData.scenario === "abonnemang" && (
              <Card className="border-purple-200 dark:border-purple-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Abonnemangsinställningar
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Månadsavgift per enhet (SEK)</Label>
                      <Input
                        type="number"
                        value={formData.monthlyFee}
                        onChange={(e) => setFormData({ ...formData, monthlyFee: parseFloat(e.target.value) || 0 })}
                        min={0}
                        step={0.01}
                        data-testid="input-monthly-fee"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Faktureringsfrekvens</Label>
                      <Select
                        value={formData.billingFrequency}
                        onValueChange={(v) => setFormData({ ...formData, billingFrequency: v })}
                      >
                        <SelectTrigger data-testid="select-billing-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Månadsvis</SelectItem>
                          <SelectItem value="quarterly">Kvartalsvis</SelectItem>
                          <SelectItem value="yearly">Årsvis</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Bindningstid (månader)</Label>
                      <Input
                        type="number"
                        value={formData.contractLockMonths}
                        onChange={(e) => setFormData({ ...formData, contractLockMonths: parseInt(e.target.value) || 0 })}
                        min={0}
                        data-testid="input-contract-lock"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Metadatafält för antal</Label>
                      <Input
                        value={formData.subscriptionMetadataField}
                        onChange={(e) => setFormData({ ...formData, subscriptionMetadataField: e.target.value })}
                        placeholder="T.ex. antal_karl"
                        data-testid="input-subscription-metadata"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
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

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Förhandsgranskning</DialogTitle>
            <DialogDescription>
              Resultat av att köra orderkoncept (inga uppgifter skapas)
            </DialogDescription>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : previewData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold" data-testid="text-preview-matched">{previewData.objectsMatched}</div>
                    <div className="text-sm text-muted-foreground">Matchande objekt</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold">{previewData.totalFilters}</div>
                    <div className="text-sm text-muted-foreground">Aktiva filter</div>
                  </CardContent>
                </Card>
              </div>

              {previewData.subscriptionCalc && (
                <Card className="border-purple-200 dark:border-purple-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Abonnemangskalkyl</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-xl font-bold">{previewData.subscriptionCalc.totalUnits}</div>
                        <div className="text-xs text-muted-foreground">Enheter totalt</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-green-600">{previewData.subscriptionCalc.monthlyTotal.toLocaleString("sv-SE")} kr</div>
                        <div className="text-xs text-muted-foreground">Månadsintäkt</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-green-600">{previewData.subscriptionCalc.yearlyTotal.toLocaleString("sv-SE")} kr</div>
                        <div className="text-xs text-muted-foreground">Årsintäkt</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {previewData.schedulePreview.length > 0 && (
                <Card className="border-green-200 dark:border-green-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Leveranstidslinje</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {previewData.schedulePreview.slice(0, 10).map((entry, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm py-1 border-b last:border-b-0">
                          <span className="font-mono">
                            {new Date(entry.date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                          </span>
                          <Badge variant="outline">{entry.objectCount} objekt</Badge>
                        </div>
                      ))}
                      {previewData.schedulePreview.length > 10 && (
                        <p className="text-xs text-muted-foreground text-center pt-2">
                          ... och {previewData.schedulePreview.length - 10} fler leveranser
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {previewData.items.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Objekt</TableHead>
                      <TableHead>Adress</TableHead>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right">Antal</TableHead>
                      <TableHead className="text-right">Tid (min)</TableHead>
                      <TableHead className="text-right">Värde (kr)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.items.slice(0, 20).map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.objectName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{item.address || "-"}</TableCell>
                        <TableCell>{item.articleName}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{item.estimatedDuration}</TableCell>
                        <TableCell className="text-right">{item.estimatedValue.toLocaleString("sv-SE")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">Ingen data tillgänglig</p>
          )}
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
                      <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
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
                placeholder="Värde att matcha mot"
                data-testid="input-filter-value"
              />
            </div>
            <Button onClick={handleAddFilter} disabled={!filterForm.metadataKey} data-testid="button-add-filter">
              <Plus className="h-4 w-4 mr-2" />
              Lägg till filter
            </Button>

            {selectedFilters.length > 0 && (
              <div className="space-y-2">
                <Label>Aktiva filter</Label>
                {selectedFilters.map((filter) => (
                  <div key={filter.id} className="flex items-center justify-between p-2 border rounded-md">
                    <div className="text-sm">
                      <span className="font-mono font-medium">{filter.metadataKey}</span>
                      <span className="mx-2 text-muted-foreground">
                        {filterOperatorOptions.find((o) => o.value === filter.operator)?.label}
                      </span>
                      <span className="font-mono">{JSON.stringify(filter.filterValue)}</span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        selectedConceptId &&
                        deleteFilterMutation.mutate({ conceptId: selectedConceptId, filterId: filter.id })
                      }
                      data-testid={`button-delete-filter-${filter.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Radera orderkoncept?</AlertDialogTitle>
            <AlertDialogDescription>
              Denna åtgärd kan inte ångras. Konceptet och dess filter raderas permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (conceptToDelete) deleteMutation.mutate(conceptToDelete);
                setDeleteConfirmOpen(false);
              }}
              data-testid="button-confirm-delete"
            >
              Radera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
