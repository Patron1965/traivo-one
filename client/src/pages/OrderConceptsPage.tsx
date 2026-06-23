import { useState } from "react";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrderFilterBar } from "@/components/orders/OrderFilterBar";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  Link2,
  FileText,
  History,
  ArrowRight,
  ArrowLeft,
  Lightbulb,
  ScanSearch,
  Receipt,
  Boxes,
  Building2,
  ClipboardList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { OrderConcept, Cluster, Article, ConceptFilter, DeliveryScheduleEntry } from "@shared/schema";
import { ORDER_CONCEPT_SCENARIO_LABELS, BILLING_FREQUENCY_LABELS } from "@shared/schema";
import { PageHelp, HelpTooltip } from "@/components/ui/help-tooltip";
import { ChainTracePanel } from "@/components/ChainTracePanel";

const scenarioOptions = [
  { value: "avrop", label: "Avrop (engång)", desc: "Manuellt eller vid behov", help: "Genererar en enskild order direkt eller vid behov — används för ad hoc-tjänster som inte är schemalagda." },
  { value: "schema", label: "Schema (leveransplan)", desc: "Återkommande med tidsfönster", help: "Skapar ordrar automatiskt enligt en leveransplan, t.ex. 'första måndagen varje månad' — perfekt för regelbundna besök." },
  { value: "abonnemang", label: "Abonnemang (fast avgift)", desc: "Fast månadsavgift per enhet", help: "Fast månadsavgift oavsett antal besök. Systemet beräknar kostnaden per enhet baserat på vald frekvens och prislista." },
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
  washesPerYear: number;
  pricePerUnit: number;
  monthlyFee: number;
  billingFrequency: string;
  contractLockMonths: number;
  subscriptionMetadataField: string;
  deliveryTimeMetadataField: string;
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
    // Task #1057: avgiften beräknas dynamiskt från uppgifternas ordervärde.
    matchedObjects: number;
    monthlyTotal: number;
    yearlyTotal: number;
    computed: boolean;
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
  washesPerYear: 0,
  pricePerUnit: 0,
  monthlyFee: 0,
  billingFrequency: "monthly",
  contractLockMonths: 0,
  subscriptionMetadataField: "",
  deliveryTimeMetadataField: "",
  deliverySchedule: [],
};

export default function OrderConceptsPage() {
  const [, navigate] = useLocation();
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
  const [depTemplateDialogOpen, setDepTemplateDialogOpen] = useState(false);
  const [invoiceRuleDialogOpen, setInvoiceRuleDialogOpen] = useState(false);
  const [runLogsDialogOpen, setRunLogsDialogOpen] = useState(false);
  const [chainTraceWorkOrderId, setChainTraceWorkOrderId] = useState<string | null>(null);
  const [assignmentsConceptId, setAssignmentsConceptId] = useState<string | null>(null);
  const [selectedConceptForPhase2, setSelectedConceptForPhase2] = useState<string | null>(null);
  const [detectChangesDialogOpen, setDetectChangesDialogOpen] = useState(false);
  const [invoicingStatusDialogOpen, setInvoicingStatusDialogOpen] = useState(false);
  const [selectedConceptForFas4, setSelectedConceptForFas4] = useState<string | null>(null);
  const [depTemplateForm, setDepTemplateForm] = useState({
    sourceArticleId: "",
    dependentArticleId: "",
    dependencyType: "before",
    offsetHours: 24,
    autoGenerate: true,
  });
  const [invoiceRuleForm, setInvoiceRuleForm] = useState({
    name: "",
    billingType: "per_task",
    headerMetadataField: "",
    lineMetadataField: "",
    priceField: "",
    quantityField: "",
  });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa orderkoncept", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte köra orderkoncept", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte köra rullande schema", description: error.message, variant: "destructive" });
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

  const selectedConceptArticleId = selectedConceptForPhase2
    ? concepts.find((c) => c.id === selectedConceptForPhase2)?.articleId || undefined
    : undefined;

  const depTemplatesQueryKey = selectedConceptArticleId
    ? `/api/task-dependency-templates?articleId=${selectedConceptArticleId}`
    : "/api/task-dependency-templates";

  const { data: depTemplates = [] } = useQuery<any[]>({
    queryKey: [depTemplatesQueryKey],
    enabled: !!selectedConceptArticleId && depTemplateDialogOpen,
  });

  const invoiceRulesQueryKey = selectedConceptForPhase2
    ? `/api/invoice-rules?orderConceptId=${selectedConceptForPhase2}`
    : "/api/invoice-rules";

  const { data: invoiceRules = [] } = useQuery<any[]>({
    queryKey: [invoiceRulesQueryKey],
    enabled: !!selectedConceptForPhase2 && invoiceRuleDialogOpen,
  });

  const runLogsQueryKey = selectedConceptForPhase2
    ? `/api/order-concept-run-logs?orderConceptId=${selectedConceptForPhase2}`
    : "/api/order-concept-run-logs";

  const { data: runLogs = [] } = useQuery<any[]>({
    queryKey: [runLogsQueryKey],
    enabled: !!selectedConceptForPhase2 && runLogsDialogOpen,
  });

  const createDepTemplateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/task-dependency-templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [depTemplatesQueryKey] });
      setDepTemplateForm({ sourceArticleId: "", dependentArticleId: "", dependencyType: "before", offsetHours: 24, autoGenerate: true });
      toast({ title: "Beroendemall skapad" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa beroendemall", description: error.message, variant: "destructive" });
    },
  });

  const deleteDepTemplateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/task-dependency-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [depTemplatesQueryKey] });
      toast({ title: "Beroendemall raderad" });
    },
  });

  const createInvoiceRuleMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/invoice-rules", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [invoiceRulesQueryKey] });
      setInvoiceRuleForm({ name: "", billingType: "per_task", headerMetadataField: "", lineMetadataField: "", priceField: "", quantityField: "" });
      toast({ title: "Fakturaregel skapad" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa fakturaregel", description: error.message, variant: "destructive" });
    },
  });

  const deleteInvoiceRuleMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/invoice-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [invoiceRulesQueryKey] });
      toast({ title: "Fakturaregel raderad" });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/order-concepts/${id}/rerun`),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      queryClient.invalidateQueries({ queryKey: [runLogsQueryKey] });
      toast({
        title: "Omkörning klar",
        description: response.message || "Ändringar detekterade och loggade",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte köra om koncept", description: error.message, variant: "destructive" });
    },
  });

  const detectChangesMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/order-concepts/${id}/detect-changes`),
    onError: (error: Error) => {
      toast({ title: "Kunde inte detektera ändringar", description: error.message, variant: "destructive" });
    },
  });

  const detectChangesData = detectChangesMutation.data as any;

  const invoicingStatusQueryKey = selectedConceptForFas4
    ? ["/api/order-concepts", selectedConceptForFas4, "invoicing-status"]
    : null;

  const { data: invoicingStatus, isLoading: invoicingStatusLoading } = useQuery<any>({
    queryKey: invoicingStatusQueryKey!,
    queryFn: async () => {
      const res = await fetch(`/api/order-concepts/${selectedConceptForFas4}/invoicing-status`);
      if (!res.ok) throw new Error("Kunde inte hämta faktureringsstatus");
      return res.json();
    },
    enabled: !!selectedConceptForFas4 && invoicingStatusDialogOpen,
  });

  // Task #857: uppgifter + objekt som ett orderkoncept genererat (för djuplänkning
  // orderkoncept → uppgift → objekt).
  const { data: conceptAssignments, isLoading: conceptAssignmentsLoading } = useQuery<{
    assignments: Array<{ id: string; title: string; status: string; scheduledDate?: string | null; quantity?: number | null; objectId?: string | null; objectName?: string | null; objectNumber?: string | null }>;
    objects: Array<{ id: string; name?: string | null; address?: string | null; objectNumber?: string | null; assignmentCount: number }>;
  }>({
    queryKey: ["/api/order-concepts", assignmentsConceptId, "assignments"],
    queryFn: async () => {
      const res = await fetch(`/api/order-concepts/${assignmentsConceptId}/assignments`);
      if (!res.ok) throw new Error("Kunde inte hämta uppgifter");
      return res.json();
    },
    enabled: !!assignmentsConceptId,
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
      washesPerYear: (concept as any).washesPerYear || 0,
      pricePerUnit: (concept as any).pricePerUnit || 0,
      monthlyFee: (concept as any).monthlyFee || 0,
      billingFrequency: (concept as any).billingFrequency || "monthly",
      contractLockMonths: (concept as any).contractLockMonths || 0,
      subscriptionMetadataField: (concept as any).subscriptionMetadataField || "",
      deliveryTimeMetadataField: (concept as any).deliveryTimeMetadataField || "",
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
      washesPerYear: formData.scenario === "abonnemang" ? (formData.washesPerYear || null) : null,
      pricePerUnit: formData.scenario === "abonnemang" ? (formData.pricePerUnit || null) : null,
      monthlyFee: formData.scenario === "abonnemang" ? formData.monthlyFee : null,
      billingFrequency: formData.scenario === "abonnemang" ? formData.billingFrequency : null,
      contractLockMonths: formData.scenario === "abonnemang" ? (formData.contractLockMonths || null) : null,
      subscriptionMetadataField: formData.scenario === "abonnemang" ? (formData.subscriptionMetadataField || null) : null,
      deliveryTimeMetadataField: formData.deliveryTimeMetadataField || null,
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
    // Task #1056: UI grupperar nu avrop + schema (+ legacy/tomt) under "Efterfakturering".
    // Abonnemang är fortsatt sin egen kategori.
    if (activeTab === "efterfakturering") return matchesSearch && (c as any).scenario !== "abonnemang";
    return matchesSearch && (c as any).scenario === activeTab;
  });

  const scenarioCounts = {
    alla: concepts.length,
    efterfakturering: concepts.filter((c) => (c as any).scenario !== "abonnemang").length,
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
      <PageHeader
        icon={Lightbulb}
        title="Orderkoncept"
        description="Automatisera ordrar: efterfakturering eller abonnemang"
        testId="text-page-title"
      >
        <PageHelp
          title="Orderkoncept"
          description="Orderkoncept definierar hur arbetsordrar genereras automatiskt. Välj faktureringsmetod: Efterfakturering (arbetet faktureras i efterhand enligt vald frekvens) eller Abonnemang (fast avgift per enhet med automatisk kalkyl)."
        />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4">
        <Card data-testid="stat-efterfakturering">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-1/15 dark:bg-chart-1/15">
              <Package className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <div className="text-2xl font-bold">{scenarioCounts.efterfakturering}</div>
              <div className="text-sm text-muted-foreground">Efterfakturering</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-abonnemang">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-5/15 dark:bg-chart-5/15">
              <CreditCard className="h-5 w-5 text-chart-5" />
            </div>
            <div>
              <div className="text-2xl font-bold">{scenarioCounts.abonnemang}</div>
              <div className="text-sm text-muted-foreground">Abonnemang</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <OrderFilterBar
            search={searchTerm}
            onSearchChange={setSearchTerm}
            placeholder="Sök orderkoncept..."
            testIdPrefix="search-concepts"
            searchTestId="input-search-concepts"
          />
        </div>
        <Button onClick={() => navigate("/order-concepts/new")} data-testid="button-add-concept">
          <Plus className="h-4 w-4 mr-2" />
          Nytt koncept (Wizard)
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-scenario">
          <TabsTrigger value="alla">Alla ({scenarioCounts.alla})</TabsTrigger>
          <TabsTrigger value="efterfakturering">Efterfakturering ({scenarioCounts.efterfakturering})</TabsTrigger>
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handlePreview(concept)}
                              data-testid={`button-preview-${concept.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Förhandsgranska</TooltipContent>
                        </Tooltip>
                        {scenario === "schema" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => runRollingMutation.mutate(concept.id)}
                                disabled={runRollingMutation.isPending}
                                data-testid={`button-run-rolling-${concept.id}`}
                              >
                                <RefreshCw className={`h-4 w-4 ${runRollingMutation.isPending ? "animate-spin" : ""}`} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Kör rullande schema</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => { setConceptToExecute(concept); setScheduledDate(""); setExecuteDialogOpen(true); }}
                                data-testid={`button-execute-${concept.id}`}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Kör koncept</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => { setSelectedConceptForPhase2(concept.id); rerunMutation.mutate(concept.id); }}
                              disabled={rerunMutation.isPending}
                              data-testid={`button-rerun-${concept.id}`}
                            >
                              <RefreshCw className={`h-4 w-4 text-chart-4 ${rerunMutation.isPending ? "animate-spin" : ""}`} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Kör om (detektera ändringar)</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleManageFilters(concept.id)}
                              data-testid={`button-filters-${concept.id}`}
                            >
                              <Filter className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Hantera filter</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => { setSelectedConceptForPhase2(concept.id); setDepTemplateDialogOpen(true); }}
                              data-testid={`button-dep-templates-${concept.id}`}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Beroendemallar</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => { setSelectedConceptForPhase2(concept.id); setInvoiceRuleDialogOpen(true); }}
                              data-testid={`button-invoice-rules-${concept.id}`}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Fakturaregler</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => { setSelectedConceptForPhase2(concept.id); setRunLogsDialogOpen(true); }}
                              data-testid={`button-run-logs-${concept.id}`}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Körhistorik</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/chain-trace/by-concept/${concept.id}`);
                                  if (res.ok) {
                                    const data = await res.json();
                                    if (data.workOrderId) {
                                      setChainTraceWorkOrderId(data.workOrderId);
                                    } else {
                                      toast({ title: "Ingen arbetsorder", description: "Inga ordrar har genererats från detta koncept ännu." });
                                    }
                                  }
                                } catch {
                                  toast({ title: "Fel", description: "Kunde inte hämta kedjedata", variant: "destructive" });
                                }
                              }}
                              data-testid={`button-chain-trace-${concept.id}`}
                            >
                              <Link2 className="h-4 w-4 text-[#4A9B9B]" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Spåra kedja</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setAssignmentsConceptId(concept.id)}
                              data-testid={`button-concept-assignments-${concept.id}`}
                            >
                              <Boxes className="h-4 w-4 text-chart-1" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Uppgifter &amp; objekt</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setSelectedConceptForFas4(concept.id);
                                setDetectChangesDialogOpen(true);
                                detectChangesMutation.reset();
                              }}
                              data-testid={`button-detect-changes-${concept.id}`}
                            >
                              <ScanSearch className="h-4 w-4 text-chart-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Identifiera ändringar</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setSelectedConceptForFas4(concept.id);
                                setInvoicingStatusDialogOpen(true);
                              }}
                              data-testid={`button-invoicing-status-${concept.id}`}
                            >
                              <Receipt className="h-4 w-4 text-chart-2" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Faktureringssynk</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => navigate(`/order-concepts/${concept.id}/edit`)}
                              data-testid={`button-edit-${concept.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Redigera</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => { setConceptToDelete(concept.id); setDeleteConfirmOpen(true); }}
                              data-testid={`button-delete-${concept.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Ta bort</TooltipContent>
                        </Tooltip>
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
                    <div className="font-medium text-sm">{s.label} <HelpTooltip content={s.help} /></div>
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
              <Card className="border-chart-2/20 dark:border-chart-2/80">
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

            {/* Task #901 (B8): metadatastyrd leveranstid (gäller avrop + schema) */}
            {(formData.scenario === "avrop" || formData.scenario === "schema") && (
              <Card className="border-chart-4/20 dark:border-chart-4/80">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Leveranstid från metadata
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label>Metadatafält för leveranstid</Label>
                  <Input
                    value={formData.deliveryTimeMetadataField}
                    onChange={(e) => setFormData({ ...formData, deliveryTimeMetadataField: e.target.value })}
                    placeholder="T.ex. tömningstid"
                    data-testid="input-delivery-time-metadata"
                  />
                  <p className="text-sm text-muted-foreground">
                    Ange metadatatypens namn (t.ex. "tömningstid"). Vid körning hämtas leveranstiden
                    från objektets metadatavärde (datum eller datum + tid). Saknas värdet eller är det
                    ogiltigt används det schemalagda datumet istället.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Abonnemang-specific fields */}
            {formData.scenario === "abonnemang" && (
              <Card className="border-chart-5/20 dark:border-chart-5/80">
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
                      <Label>Tvättar per år</Label>
                      <Input
                        type="number"
                        value={formData.washesPerYear}
                        onChange={(e) => setFormData({ ...formData, washesPerYear: parseInt(e.target.value) || 0 })}
                        min={0}
                        data-testid="input-washes-per-year"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pris per enhet (SEK)</Label>
                      <Input
                        type="number"
                        value={formData.pricePerUnit}
                        onChange={(e) => setFormData({ ...formData, pricePerUnit: parseFloat(e.target.value) || 0 })}
                        min={0}
                        step={0.01}
                        data-testid="input-price-per-unit"
                      />
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
                <Card className="border-chart-5/20 dark:border-chart-5/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Abonnemangskalkyl</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-xl font-bold">{previewData.subscriptionCalc.matchedObjects}</div>
                        <div className="text-xs text-muted-foreground">Matchande objekt</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-chart-2">{previewData.subscriptionCalc.monthlyTotal.toLocaleString("sv-SE")} kr</div>
                        <div className="text-xs text-muted-foreground">Beräknad avgift (period)</div>
                      </div>
                      <div>
                        <div className="text-xl font-bold text-chart-2">{previewData.subscriptionCalc.yearlyTotal.toLocaleString("sv-SE")} kr</div>
                        <div className="text-xs text-muted-foreground">Årsintäkt</div>
                      </div>
                    </div>
                    {!previewData.subscriptionCalc.computed && (
                      <p className="text-xs text-warning mt-2" data-testid="text-subscription-not-computed">
                        Avgiften kan inte beräknas — koppla minst en artikel med pris till konceptets uppgifter.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {(previewData.schedulePreview?.length ?? 0) > 0 && (
                <Card className="border-chart-2/20 dark:border-chart-2/80">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Leveranstidslinje</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {previewData.schedulePreview!.slice(0, 10).map((entry, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm py-1 border-b last:border-b-0">
                          <span className="font-mono">
                            {new Date(entry.date).toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" })}
                          </span>
                          <Badge variant="outline">{entry.objectCount} objekt</Badge>
                        </div>
                      ))}
                      {(previewData.schedulePreview?.length ?? 0) > 10 && (
                        <p className="text-xs text-muted-foreground text-center pt-2">
                          ... och {previewData.schedulePreview!.length - 10} fler leveranser
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {(previewData.items?.length ?? 0) > 0 && (
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
                    {(previewData.items || []).slice(0, 20).map((item, idx) => (
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

      {/* Dependency Templates Dialog */}
      <Dialog open={depTemplateDialogOpen} onOpenChange={setDepTemplateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Beroendemallar
            </DialogTitle>
            <DialogDescription>
              Definiera beroenden mellan artiklar för automatisk uppgiftsgenerering
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Källa (artikel) *</Label>
                <Select
                  value={depTemplateForm.sourceArticleId || "__none__"}
                  onValueChange={(v) => setDepTemplateForm({ ...depTemplateForm, sourceArticleId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-dep-source">
                    <SelectValue placeholder="Välj artikel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Välj artikel</SelectItem>
                    {articlesList.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Beroende (artikel) *</Label>
                <Select
                  value={depTemplateForm.dependentArticleId || "__none__"}
                  onValueChange={(v) => setDepTemplateForm({ ...depTemplateForm, dependentArticleId: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger data-testid="select-dep-dependent">
                    <SelectValue placeholder="Välj artikel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Välj artikel</SelectItem>
                    {articlesList.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Typ</Label>
                <Select
                  value={depTemplateForm.dependencyType}
                  onValueChange={(v) => setDepTemplateForm({ ...depTemplateForm, dependencyType: v })}
                >
                  <SelectTrigger data-testid="select-dep-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before">Före</SelectItem>
                    <SelectItem value="after">Efter</SelectItem>
                    <SelectItem value="same_day">Samma dag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Offset (timmar)</Label>
                <Input
                  type="number"
                  value={depTemplateForm.offsetHours}
                  onChange={(e) => setDepTemplateForm({ ...depTemplateForm, offsetHours: parseInt(e.target.value) || 0 })}
                  min={0}
                  data-testid="input-dep-offset"
                />
              </div>
            </div>
            <Button
              onClick={() => {
                if (!depTemplateForm.sourceArticleId || !depTemplateForm.dependentArticleId) return;
                createDepTemplateMutation.mutate({
                  articleId: depTemplateForm.sourceArticleId,
                  dependentArticleId: depTemplateForm.dependentArticleId,
                  dependencyType: depTemplateForm.dependencyType,
                  timeOffsetHours: depTemplateForm.offsetHours,
                  isMandatory: true,
                });
              }}
              disabled={!depTemplateForm.sourceArticleId || !depTemplateForm.dependentArticleId || createDepTemplateMutation.isPending}
              data-testid="button-add-dep-template"
            >
              {createDepTemplateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Lägg till mall
            </Button>

            {depTemplates.length > 0 && (
              <div className="space-y-2">
                <Label>Befintliga mallar</Label>
                {depTemplates.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{articlesList.find((a) => a.id === t.articleId)?.name || t.articleId}</Badge>
                      {t.dependencyType === "before" ? <ArrowRight className="h-3 w-3" /> : t.dependencyType === "after" ? <ArrowLeft className="h-3 w-3" /> : <span className="text-xs">=</span>}
                      <Badge variant="secondary">{articlesList.find((a) => a.id === t.dependentArticleId)?.name || t.dependentArticleId}</Badge>
                      <span className="text-muted-foreground">({t.timeOffsetHours}h)</span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteDepTemplateMutation.mutate(t.id)}
                      data-testid={`button-delete-dep-${t.id}`}
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

      {/* Invoice Rules Dialog */}
      <Dialog open={invoiceRuleDialogOpen} onOpenChange={setInvoiceRuleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Fakturaregler
            </DialogTitle>
            <DialogDescription>
              Konfigurera hur fakturering sker för detta orderkoncept
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Regelnamn *</Label>
              <Input
                value={invoiceRuleForm.name}
                onChange={(e) => setInvoiceRuleForm({ ...invoiceRuleForm, name: e.target.value })}
                placeholder="T.ex. Standardfaktura"
                data-testid="input-invoice-rule-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Faktureringstyp</Label>
                <Select
                  value={invoiceRuleForm.billingType}
                  onValueChange={(v) => setInvoiceRuleForm({ ...invoiceRuleForm, billingType: v })}
                >
                  <SelectTrigger data-testid="select-billing-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_task">Per uppgift</SelectItem>
                    <SelectItem value="per_room">Per rum</SelectItem>
                    <SelectItem value="per_area">Per yta</SelectItem>
                    <SelectItem value="monthly">Månadsvis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Prisfält (metadata)</Label>
                <Input
                  value={invoiceRuleForm.priceField}
                  onChange={(e) => setInvoiceRuleForm({ ...invoiceRuleForm, priceField: e.target.value })}
                  placeholder="T.ex. pris_per_karl"
                  data-testid="input-price-field"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Rubrikfält (metadata)</Label>
                <Input
                  value={invoiceRuleForm.headerMetadataField}
                  onChange={(e) => setInvoiceRuleForm({ ...invoiceRuleForm, headerMetadataField: e.target.value })}
                  placeholder="T.ex. kund_referens"
                  data-testid="input-header-field"
                />
              </div>
              <div className="space-y-2">
                <Label>Radfält (metadata)</Label>
                <Input
                  value={invoiceRuleForm.lineMetadataField}
                  onChange={(e) => setInvoiceRuleForm({ ...invoiceRuleForm, lineMetadataField: e.target.value })}
                  placeholder="T.ex. artikel_beskrivning"
                  data-testid="input-line-field"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Antalfält (metadata)</Label>
              <Input
                value={invoiceRuleForm.quantityField}
                onChange={(e) => setInvoiceRuleForm({ ...invoiceRuleForm, quantityField: e.target.value })}
                placeholder="T.ex. antal_karl"
                data-testid="input-quantity-field"
              />
            </div>
            <Button
              onClick={() => {
                if (!invoiceRuleForm.name || !selectedConceptForPhase2) return;
                createInvoiceRuleMutation.mutate({
                  orderConceptId: selectedConceptForPhase2,
                  name: invoiceRuleForm.name,
                  billingType: invoiceRuleForm.billingType,
                  headerMetadataField: invoiceRuleForm.headerMetadataField || null,
                  lineMetadataField: invoiceRuleForm.lineMetadataField || null,
                  priceField: invoiceRuleForm.priceField || null,
                  quantityField: invoiceRuleForm.quantityField || null,
                });
              }}
              disabled={!invoiceRuleForm.name || createInvoiceRuleMutation.isPending}
              data-testid="button-add-invoice-rule"
            >
              {createInvoiceRuleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Lägg till regel
            </Button>

            {invoiceRules.length > 0 && (
              <div className="space-y-2">
                <Label>Befintliga regler</Label>
                {invoiceRules.map((rule: any) => (
                  <div key={rule.id} className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
                    <div className="text-sm">
                      <div className="font-medium">{rule.name}</div>
                      <div className="text-muted-foreground">
                        {rule.billingType === "per_task" ? "Per uppgift" : rule.billingType === "per_room" ? "Per rum" : rule.billingType === "per_area" ? "Per yta" : "Månadsvis"}
                        {rule.priceField && <span> · Pris: {rule.priceField}</span>}
                        {rule.quantityField && <span> · Antal: {rule.quantityField}</span>}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteInvoiceRuleMutation.mutate(rule.id)}
                      data-testid={`button-delete-rule-${rule.id}`}
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

      {/* Run Logs Dialog */}
      <Dialog open={runLogsDialogOpen} onOpenChange={setRunLogsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Körhistorik
            </DialogTitle>
            <DialogDescription>
              Logg över körningar och detekterade ändringar
            </DialogDescription>
          </DialogHeader>
          {runLogs.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Ingen körhistorik finns</p>
          ) : (
            <div className="space-y-3">
              {runLogs.map((log: any) => (
                <Card key={log.id} className="border-muted">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={log.runType === "rerun" ? "default" : "secondary"}>
                          {log.runType === "rerun" ? "Omkörning" : log.runType === "rolling" ? "Rullande" : "Initial"}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString("sv-SE")}
                        </span>
                      </div>
                      <Badge variant="outline">
                        {log.objectsProcessed || 0} objekt
                      </Badge>
                    </div>
                    {log.changesDetected && typeof log.changesDetected === "object" && (
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        {(log.changesDetected as any).newObjects > 0 && (
                          <div className="text-xs p-2 bg-chart-2/10 dark:bg-chart-2/15 rounded text-chart-2">
                            +{(log.changesDetected as any).newObjects} nya objekt
                          </div>
                        )}
                        {(log.changesDetected as any).removedObjects > 0 && (
                          <div className="text-xs p-2 bg-destructive/10 dark:bg-destructive/15 rounded text-destructive">
                            -{(log.changesDetected as any).removedObjects} borttagna
                          </div>
                        )}
                        {(log.changesDetected as any).quantityChanges > 0 && (
                          <div className="text-xs p-2 bg-chart-4/10 dark:bg-chart-4/15 rounded text-chart-4">
                            ~{(log.changesDetected as any).quantityChanges} ändringar
                          </div>
                        )}
                        {(log.changesDetected as any).newScheduleEntries > 0 && (
                          <div className="text-xs p-2 bg-chart-1/10 dark:bg-chart-1/15 rounded text-chart-1">
                            +{(log.changesDetected as any).newScheduleEntries} nya scheman
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Identifiera ändringar (Fas 4) */}
      <Dialog open={detectChangesDialogOpen} onOpenChange={(o) => { setDetectChangesDialogOpen(o); if (!o) detectChangesMutation.reset(); }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanSearch className="h-5 w-5" />
              Identifiera ändringar
            </DialogTitle>
            <DialogDescription>
              Jämför konceptets nuvarande objektlista mot de filter och kluster som finns konfigurerade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!detectChangesData ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-sm text-muted-foreground text-center">
                  Klicka "Analysera" för att se vilka objekt som tillkommit eller tagits bort sedan senaste körning.
                </p>
                <Button
                  onClick={() => { if (selectedConceptForFas4) detectChangesMutation.mutate(selectedConceptForFas4); }}
                  disabled={detectChangesMutation.isPending}
                  data-testid="button-run-detect-changes"
                >
                  {detectChangesMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analyserar...</>
                    : <><ScanSearch className="h-4 w-4 mr-2" />Analysera</>}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 rounded-lg bg-chart-2/10 dark:bg-chart-2/15">
                    <div className="text-2xl font-bold text-chart-2" data-testid="detect-added-count">
                      +{detectChangesData.summary?.addedCount ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Nya objekt</div>
                  </div>
                  <div className="p-3 rounded-lg bg-destructive/10 dark:bg-destructive/15">
                    <div className="text-2xl font-bold text-destructive" data-testid="detect-removed-count">
                      -{detectChangesData.summary?.removedCount ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Borttagna</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/40">
                    <div className="text-2xl font-bold" data-testid="detect-unchanged-count">
                      {detectChangesData.summary?.unchangedCount ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Oförändrade</div>
                  </div>
                </div>

                {!detectChangesData.hasChanges && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-chart-2/10 dark:bg-chart-2/15 text-chart-2 text-sm">
                    <Check className="h-4 w-4 shrink-0" />
                    Inga ändringar hittades — konceptet är uppdaterat.
                  </div>
                )}

                {detectChangesData.added?.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-chart-2">Nya objekt ({detectChangesData.added.length})</Label>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {detectChangesData.added.map((o: any) => (
                        <div key={o.id} className="flex items-start gap-2 text-xs p-2 rounded bg-chart-2/5 dark:bg-chart-2/10">
                          <span className="text-chart-2 font-bold">+</span>
                          <div>
                            <div className="font-medium">{o.name}</div>
                            {o.address && <div className="text-muted-foreground">{o.address}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detectChangesData.removed?.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-destructive">Borttagna objekt ({detectChangesData.removed.length})</Label>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {detectChangesData.removed.map((o: any) => (
                        <div key={o.id} className="flex items-start gap-2 text-xs p-2 rounded bg-destructive/5 dark:bg-destructive/10">
                          <span className="text-destructive font-bold">−</span>
                          <div className="font-medium">{o.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    Totalt matchande nu: {detectChangesData.totalMatchingNow ?? 0} objekt
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { if (selectedConceptForFas4) detectChangesMutation.mutate(selectedConceptForFas4); }}
                    disabled={detectChangesMutation.isPending}
                    data-testid="button-rerun-detect-changes"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${detectChangesMutation.isPending ? "animate-spin" : ""}`} />
                    Kör igen
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Faktureringssynk (Fas 4) */}
      <Dialog open={invoicingStatusDialogOpen} onOpenChange={setInvoicingStatusDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Faktureringssynk
            </DialogTitle>
            <DialogDescription>
              Faktureringsstatus för uppdrag genererade av detta orderkoncept.
            </DialogDescription>
          </DialogHeader>
          {invoicingStatusLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : invoicingStatus ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-lg border text-center">
                  <div className="text-3xl font-bold" data-testid="inv-total">{invoicingStatus.totalAssignments}</div>
                  <div className="text-xs text-muted-foreground mt-1">Totalt genererade uppdrag</div>
                </div>
                <div className="p-4 rounded-lg border text-center">
                  <div className="text-3xl font-bold text-chart-2" data-testid="inv-invoiced">{invoicingStatus.invoicedCount}</div>
                  <div className="text-xs text-muted-foreground mt-1">Fakturerade</div>
                </div>
              </div>

              {invoicingStatus.completedNotInvoiced > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 dark:bg-warning/15 text-warning text-sm" data-testid="inv-pending-warning">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>{invoicingStatus.completedNotInvoiced} slutförda uppdrag saknar fakturering</span>
                </div>
              )}

              {Object.keys(invoicingStatus.statusCounts || {}).length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">Uppdrag per status</Label>
                  <div className="space-y-1">
                    {Object.entries(invoicingStatus.statusCounts as Record<string, number>).map(([status, count]) => (
                      <div key={status} className="flex items-center justify-between text-sm py-1.5 px-3 rounded bg-muted/40">
                        <span className="text-muted-foreground capitalize">
                          {status === "not_planned" ? "Ej planerat" :
                           status === "planned_rough" ? "Grovplanerat" :
                           status === "planned_fine" ? "Finplanerat" :
                           status === "in_progress" ? "Pågår" :
                           status === "completed" ? "Slutfört" :
                           status === "cancelled" ? "Avbokat" : status}
                        </span>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs">Fortnox-integration</Label>
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  invoicingStatus.fortnoxConnected
                    ? "bg-chart-2/10 dark:bg-chart-2/15 text-chart-2"
                    : "bg-muted/40 text-muted-foreground"
                }`}>
                  {invoicingStatus.fortnoxConnected
                    ? <><Check className="h-4 w-4 shrink-0" />Fortnox är anslutet</>
                    : <><X className="h-4 w-4 shrink-0" />Fortnox är inte anslutet</>}
                </div>
                {invoicingStatus.priceListId && (
                  <p className="text-xs text-muted-foreground">Prislista konfigurerad — frozen-prislogik aktiveras vid faktureringsexport.</p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => navigate("/invoices")} data-testid="button-go-invoices">
                  <Receipt className="h-4 w-4 mr-2" />
                  Öppna fakturering
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">Ingen data tillgänglig.</p>
          )}
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

      {/* Task #857: orderkoncept → uppgifter + objekt djuplänkning */}
      <Dialog open={!!assignmentsConceptId} onOpenChange={(open) => { if (!open) setAssignmentsConceptId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-concept-assignments">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5" /> Genererade uppgifter &amp; objekt
            </DialogTitle>
            <DialogDescription>
              Uppgifter som detta orderkoncept genererat och de objekt de hänger på. Klicka på ett objekt för att navigera dit.
            </DialogDescription>
          </DialogHeader>
          {conceptAssignmentsLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Objekt
                  <Badge variant="secondary" className="text-xs">{conceptAssignments?.objects.length ?? 0}</Badge>
                </h4>
                {conceptAssignments && conceptAssignments.objects.length > 0 ? (
                  <div className="space-y-2">
                    {conceptAssignments.objects.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => { setAssignmentsConceptId(null); navigate(`/objects/${o.id}`); }}
                        className="w-full text-left rounded-lg border border-border p-3 hover-elevate"
                        data-testid={`link-concept-object-${o.id}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{o.name || "Okänt objekt"}</div>
                            {(o.objectNumber || o.address) && (
                              <div className="text-xs text-muted-foreground truncate">
                                {[o.objectNumber, o.address].filter(Boolean).join(" · ")}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-xs">{o.assignmentCount} uppgift{o.assignmentCount === 1 ? "" : "er"}</Badge>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="empty-concept-objects">Inga objekt kopplade ännu.</p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" /> Uppgifter
                  <Badge variant="secondary" className="text-xs">{conceptAssignments?.assignments.length ?? 0}</Badge>
                </h4>
                {conceptAssignments && conceptAssignments.assignments.length > 0 ? (
                  <div className="space-y-2">
                    {conceptAssignments.assignments.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-lg border border-border p-3"
                        data-testid={`concept-assignment-row-${a.id}`}
                      >
                        <div className="text-sm font-medium">{a.title}</div>
                        <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          {a.objectName && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3 w-3" />{a.objectName}
                            </span>
                          )}
                          {a.scheduledDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />{new Date(a.scheduledDate).toLocaleDateString("sv-SE")}
                            </span>
                          )}
                          {typeof a.quantity === "number" && a.quantity > 0 && <span>{a.quantity} st</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="empty-concept-assignments">Inga uppgifter genererade ännu.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ChainTracePanel
        workOrderId={chainTraceWorkOrderId}
        open={!!chainTraceWorkOrderId}
        onClose={() => setChainTraceWorkOrderId(null)}
      />
    </div>
  );
}
