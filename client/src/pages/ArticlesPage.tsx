import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTerminology } from "@/hooks/use-terminology";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  FileText,
  Pencil,
  Trash2,
  Filter,
  Clock,
  DollarSign,
  Package,
  ChevronDown,
  ChevronUp,
  List,
  LayoutGrid,
  Link,
  Building2,
  Building,
  Home,
  Box,
  Trash,
  Key,
  Target,
  CheckCircle2,
  Database,
  MoreHorizontal,
  X,
  XCircle,
  CircleCheck,
  CircleX,
  ChevronLeft,
  ChevronRight,
  LinkIcon,
  Beaker,
  AlertTriangle,
  Tag,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Article, ServiceObject, MetadataDefinition, ArticleTypeDefinition, AssociationCondition } from "@shared/schema";
import { useUpload } from "@/hooks/use-upload";
import { deriveIsPreTask } from "@/lib/article-pre-task";
import { QueryState } from "@/components/QueryState";
import { FortnoxArticleNumberField } from "@/components/articles/FortnoxArticleNumberField";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpTooltip, PageHelp } from "@/components/ui/help-tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

// Fallback om registret ännu inte hunnit laddas (eller är tomt). Riktiga
// alternativ hämtas per-tenant från /api/article-types (Task #834).
const DEFAULT_ARTICLE_TYPE_OPTIONS = [
  { value: "tjanst", label: "Tjänst" },
  { value: "felanmalan", label: "Felanmälan" },
  { value: "kontroll", label: "Kontroll" },
  { value: "vara", label: "Vara" },
  { value: "beroende", label: "Beroende" },
];

const objectTypeOptions = [
  { value: "all", label: "Alla objekttyper" },
  { value: "omrade", label: "Område" },
  { value: "fastighet", label: "Fastighet" },
  { value: "serviceboende", label: "Serviceboende" },
  { value: "rum", label: "Rum" },
  { value: "soprum", label: "Soprum" },
  { value: "kok", label: "Kök" },
  { value: "uj_hushallsavfall", label: "UJ Hushållsavfall" },
  { value: "matavfall", label: "Matavfall" },
  { value: "atervinning", label: "Återvinning" },
];

const objectTypeLabels: Record<string, string> = Object.fromEntries(
  objectTypeOptions.map(t => [t.value, t.label])
);

const hookLevelOptions = [
  { value: "none", label: "Ingen fasthakning" },
  { value: "koncern", label: "Koncern" },
  { value: "brf", label: "BRF" },
  { value: "fastighet", label: "Fastighet" },
  { value: "rum", label: "Rum" },
  { value: "karl", label: "Alla objekt (T100)" },
  { value: "karl_mat", label: "Matavfallskärl (K100 Dekal)" },
  { value: "karl_rest", label: "Restavfallskärl" },
  { value: "karl_plast", label: "Plastkärl" },
  { value: "kod", label: "Objekt med accesskod (KOD10)" },
];

const hookLevelLabels: Record<string, string> = Object.fromEntries(
  hookLevelOptions.filter(o => o.value !== "none").map(o => [o.value, o.label])
);

interface HookConditions {
  container_type?: string;
  requires_access_code?: boolean;
  min_volume?: number;
  max_volume?: number;
}

interface ArticleFormData {
  articleNumber: string;
  name: string;
  description: string;
  articleType: string;
  hookLevel: string;
  hookConditions: HookConditions;
  objectTypes: string[];
  productionTime: number;
  cost: number;
  listPrice: number;
  unit: string;
  status: string;
  fetchMetadataCode: string;
  leaveMetadataCode: string;
  leaveMetadataFormat: string;
  maxPerAddress: number | null;
  associationLabel: string;
  associationValue: string;
  associationOperator: string;
  associationRules: AssociationCondition[];
  fetchMetadataLabel: string;
  fetchMetadataLabelFormat: string;
  canUpdateMetadata: boolean;
  updateMetadataLabel: string;
  updateMetadataFormat: string;
  showPreviousValue: boolean;
  isInfoCarrier: boolean;
  limitationType: string;
  quantityMode: string;
  quantityMetadataField: string;
  quantityUnit: string;
  groupSize: number;
  offsetMinutes: number;
  leadTimeDays: number | null;
  requiresAcknowledgment: boolean;
  dependencyCriticality: string;
  isStructure: boolean;
  isComponent: boolean;
  defaultMetadataAssociation: string;
  stockLocation: string;
  supplierNumbers: string[];
  replacementArticleId: string;
  externInfoUrl: string;
  externInfoDescription: string;
  externInfoFileUrl: string;
}

interface ComponentDraft {
  id?: string;
  childArticleId: string;
  quantityMode: "follows_parent" | "fixed";
  quantity: number;
  isMandatory: boolean;
  notes: string;
}

const emptyFormData: ArticleFormData = {
  articleNumber: "",
  name: "",
  description: "",
  articleType: "tjanst",
  hookLevel: "",
  hookConditions: {},
  objectTypes: [],
  productionTime: 15,
  cost: 0,
  listPrice: 0,
  unit: "st",
  status: "aktiv",
  fetchMetadataCode: "",
  leaveMetadataCode: "",
  leaveMetadataFormat: "",
  maxPerAddress: null,
  associationLabel: "",
  associationValue: "",
  associationOperator: "equals",
  associationRules: [],
  fetchMetadataLabel: "",
  fetchMetadataLabelFormat: "",
  canUpdateMetadata: false,
  updateMetadataLabel: "",
  updateMetadataFormat: "",
  showPreviousValue: false,
  isInfoCarrier: false,
  limitationType: "unlimited",
  quantityMode: "per_styck",
  quantityMetadataField: "",
  quantityUnit: "",
  groupSize: 1,
  offsetMinutes: 0,
  leadTimeDays: null,
  requiresAcknowledgment: false,
  dependencyCriticality: "critical",
  isStructure: false,
  isComponent: false,
  defaultMetadataAssociation: "",
  stockLocation: "",
  supplierNumbers: [],
  replacementArticleId: "",
  externInfoUrl: "",
  externInfoDescription: "",
  externInfoFileUrl: "",
};

// Status-livscykel: aktiv → utgående → utgått. Legacy "active"/"inactive" stöds
// fortfarande (visas men nya artiklar använder de svenska värdena).
const ARTICLE_STATUS_OPTIONS = [
  { value: "aktiv", label: "Aktiv" },
  { value: "utgående", label: "Utgående" },
  { value: "utgått", label: "Utgått" },
] as const;

function articleStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "aktiv":
    case "active": return "Aktiv";
    case "utgående": return "Utgående";
    case "utgått": return "Utgått";
    case "inactive": return "Inaktiv";
    default: return status || "Aktiv";
  }
}

function articleStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "utgått": return "border-destructive text-destructive";
    case "utgående": return "border-warning text-warning";
    case "inactive": return "text-muted-foreground";
    default: return "";
  }
}

function FormSection({
  title,
  icon,
  description,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/50 rounded-md"
          data-testid={testId}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-4 pt-1">
        {description && <p className="mb-3 text-xs text-muted-foreground">{description}</p>}
        <div className="space-y-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ArticlesPage() {
  const { toast } = useToast();
  const { t } = useTerminology();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [objectTypeFilter, setObjectTypeFilter] = useState<string>("all");
  const [hookLevelFilter, setHookLevelFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "hooks">("list");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [articleToDelete, setArticleToDelete] = useState<Article | null>(null);
  const [formData, setFormData] = useState<ArticleFormData>(emptyFormData);
  // Task #837: Fortnox-koppling. `fortnoxArticleNumber` skickas till backend bara
  // när `fortnoxLinkTouched` är true (val ur Fortnox, eller fritext som bryter länken),
  // så att en oförändrad redigering inte råkar radera en befintlig koppling.
  const [fortnoxArticleNumber, setFortnoxArticleNumber] = useState<string | null>(null);
  const [fortnoxLinkTouched, setFortnoxLinkTouched] = useState(false);
  const [showDiscontinued, setShowDiscontinued] = useState(false);
  const [supplierNumberInput, setSupplierNumberInput] = useState("");
  const [debouncedArticleNumber, setDebouncedArticleNumber] = useState("");
  const [offsetValueInput, setOffsetValueInput] = useState<string>("0");
  const [offsetUnit, setOffsetUnit] = useState<"minutes" | "days">("minutes");
  const [offsetType, setOffsetType] = useState<"before" | "same" | "after">("same");
  const computeOffsetMinutes = (
    unit: "minutes" | "days",
    type: "before" | "same" | "after",
    magnitudeStr: string,
  ): number => {
    if (type === "same") return 0;
    const mag = Math.abs(parseInt(magnitudeStr, 10) || 0);
    const minutes = unit === "days" ? mag * 1440 : mag;
    return type === "before" ? -minutes : minutes;
  };
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [assocTestResult, setAssocTestResult] = useState<{ matchCount: number; matches: Array<{ objectId: string; objectName: string; objectAddress: string; metadataValue: string | null }>; labelFound: boolean; labelName?: string } | null>(null);
  const [assocTestLoading, setAssocTestLoading] = useState(false);
  const [componentDraft, setComponentDraft] = useState<ComponentDraft[]>([]);
  const [originalComponents, setOriginalComponents] = useState<{ id: string; childArticleId: string }[]>([]);
  const ITEMS_PER_PAGE = 25;

  const { data: articles = [], isLoading, isError, error: articlesError, refetch: refetchArticles } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", "lookup"],
  });

  const { data: metadataTypes = [] } = useQuery<{ id: string; namn: string; datatyp: string }[]>({
    queryKey: ["/api/metadata/types"],
  });

  // Task #834: artikeltyper kommer från ett per-tenant register. Faller tillbaka
  // på systemstandarderna om registret ännu inte laddats.
  const { data: articleTypeDefs = [] } = useQuery<ArticleTypeDefinition[]>({
    queryKey: ["/api/article-types"],
  });
  const articleTypeOptions = useMemo(
    () => (articleTypeDefs.length > 0
      ? articleTypeDefs.map((d) => ({ value: d.key, label: d.label }))
      : DEFAULT_ARTICLE_TYPE_OPTIONS),
    [articleTypeDefs],
  );
  const articleTypeLabels = useMemo(
    () => Object.fromEntries(articleTypeOptions.map((t) => [t.value, t.label])) as Record<string, string>,
    [articleTypeOptions],
  );

  // Task #834: filuppladdning för extern info (säkerhetsdatablad m.m.) via det
  // delade upload-flödet (request-url → PUT → confirm sätter tenant-ACL).
  const { uploadFile: uploadExternFile, isUploading: externFileUploading } = useUpload({
    onSuccess: (res) => {
      setFormData((prev) => ({ ...prev, externInfoFileUrl: res.objectPath }));
      toast({ title: "Fil uppladdad", description: "Den externa filen har sparats." });
    },
    onError: (err) => {
      toast({ title: "Uppladdning misslyckades", description: err.message, variant: "destructive" });
    },
  });

  const { data: metadataDefinitions = [] } = useQuery<MetadataDefinition[]>({
    queryKey: ["/api/metadata-definitions"],
  });

  const metadataDefinitionLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of metadataDefinitions) {
      map.set(d.fieldKey, d.fieldLabel);
    }
    return map;
  }, [metadataDefinitions]);

  // Task #682: varna när en metadatareferens redan är kopplad till en annan
  // ordertyp/artikel (undvik generiska fältkollisioner, t.ex. antal vs antal_matavfall).
  const [metadataLinkWarnings, setMetadataLinkWarnings] = useState<{ fetch: string | null; leave: string | null }>({ fetch: null, leave: null });

  const checkMetadataReferenceUsage = useCallback(async (namn: string, which: "fetch" | "leave") => {
    if (!namn) {
      setMetadataLinkWarnings(prev => ({ ...prev, [which]: null }));
      return;
    }
    const katalog = metadataTypes.find(t => t.namn === namn);
    if (!katalog) {
      setMetadataLinkWarnings(prev => ({ ...prev, [which]: null }));
      return;
    }
    try {
      const res = await fetch(`/api/metadata-link-usage/${encodeURIComponent(katalog.id)}`, { credentials: "include" });
      if (!res.ok) return;
      const usage = await res.json();
      const articleUsage = (usage.articles || []).filter((a: any) => a.id !== editingArticle?.id);
      const parts: string[] = [];
      if (usage.orderTypes?.length) parts.push(`ordertyp(er): ${usage.orderTypes.join(", ")}`);
      if (articleUsage.length) parts.push(`artikel(ar): ${articleUsage.map((a: any) => a.name).join(", ")}`);
      setMetadataLinkWarnings(prev => ({
        ...prev,
        [which]: parts.length ? `Referensen "${namn}" används redan av ${parts.join("; ")}. Risk för generiska fältkollisioner — överväg en mer specifik referens.` : null,
      }));
    } catch {
      // best-effort
    }
  }, [metadataTypes, editingArticle?.id]);

  const { data: metadataLabels = [] } = useQuery<{ id: string; namn: string; beteckning: string | null; datatyp: string }[]>({
    queryKey: ["/api/metadata-labels"],
    select: (data: any[]) => data.map((d: any) => ({ id: d.id, namn: d.namn, beteckning: d.beteckning, datatyp: d.datatyp })),
  });

  const handleTestAssociation = async () => {
    if (!formData.associationLabel || !formData.associationValue) return;
    setAssocTestLoading(true);
    setAssocTestResult(null);
    try {
      const artId = editingArticle?.id || "new";
      const res = await fetch(`/api/articles/${artId}/test-association`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          label: formData.associationLabel,
          value: formData.associationValue,
          operator: formData.associationOperator,
        }),
      });
      if (res.ok) {
        setAssocTestResult(await res.json());
      }
    } catch { /* ignore */ }
    setAssocTestLoading(false);
  };

  const { data: applicableArticles = [], isLoading: isLoadingApplicable } = useQuery<Article[]>({
    queryKey: ["/api/objects", selectedObjectId, "applicable-articles"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${selectedObjectId}/applicable-articles`);
      if (!res.ok) throw new Error("Failed to fetch applicable articles");
      return res.json();
    },
    enabled: !!selectedObjectId && testDialogOpen,
  });

  useEffect(() => {
    const trimmed = formData.articleNumber.trim();
    const handle = setTimeout(() => setDebouncedArticleNumber(trimmed), 350);
    return () => clearTimeout(handle);
  }, [formData.articleNumber]);

  const { data: articleNumberCheck } = useQuery<{ available: boolean; reason?: string; existingId?: string; existingName?: string }>({
    queryKey: ["/api/articles/validate-number", debouncedArticleNumber, editingArticle?.id ?? ""],
    queryFn: async () => {
      const params = new URLSearchParams({ number: debouncedArticleNumber });
      if (editingArticle?.id) params.set("excludeId", editingArticle.id);
      const res = await fetch(`/api/articles/validate-number?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte validera artikelnummer");
      return res.json();
    },
    enabled: dialogOpen && debouncedArticleNumber.length > 0,
  });

  const articleNumberDuplicate =
    !!articleNumberCheck &&
    articleNumberCheck.available === false &&
    articleNumberCheck.reason === "duplicate" &&
    debouncedArticleNumber === formData.articleNumber.trim();

  // Strukturartikel (BOM): synka draft-komponenter mot servern efter att artikeln
  // skapats/uppdaterats. Nyskapade artiklar har inget parentId förrän de finns,
  // därför skjuts barn-POST upp tills create lyckats.
  const reconcileComponents = async (
    parentId: string,
    draft: ComponentDraft[],
    originals: { id: string; childArticleId: string }[],
  ) => {
    const draftIds = new Set(draft.filter((d) => d.id).map((d) => d.id as string));
    for (const o of originals) {
      if (!draftIds.has(o.id)) {
        await apiRequest("DELETE", `/api/articles/${parentId}/components/${o.id}`);
      }
    }
    for (let i = 0; i < draft.length; i++) {
      const d = draft[i];
      if (!d.childArticleId) continue;
      const payload = {
        childArticleId: d.childArticleId,
        quantity: d.quantityMode === "follows_parent" ? 1 : (Number.isFinite(d.quantity) && d.quantity > 0 ? d.quantity : 1),
        quantityFormula: d.quantityMode === "follows_parent" ? "follows_parent" : null,
        isMandatory: d.isMandatory,
        notes: d.notes || null,
        sortOrder: i,
      };
      if (d.id) {
        await apiRequest("PATCH", `/api/articles/${parentId}/components/${d.id}`, payload);
      } else {
        await apiRequest("POST", `/api/articles/${parentId}/components`, payload);
      }
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: Partial<ArticleFormData>) => {
      const res = await apiRequest("POST", "/api/articles", data);
      const created = await res.json();
      if (data.isStructure && created?.id) {
        await reconcileComponents(created.id, componentDraft, []);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Artikel skapad", description: "Artikeln har lagts till." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa artikel", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ArticleFormData> }) => {
      const res = await apiRequest("PATCH", `/api/articles/${id}`, data);
      const updated = await res.json();
      await reconcileComponents(id, data.isStructure ? componentDraft : [], originalComponents);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Artikel uppdaterad", description: "Artikeln har uppdaterats." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte uppdatera artikel", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/articles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      setDeleteDialogOpen(false);
      setArticleToDelete(null);
      toast({ title: "Artikel borttagen", description: "Artikeln har tagits bort." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort artikel", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData(emptyFormData);
    setOffsetValueInput("0");
    setOffsetUnit("minutes");
    setOffsetType("same");
    setEditingArticle(null);
    setComponentDraft([]);
    setOriginalComponents([]);
    setFortnoxArticleNumber(null);
    setFortnoxLinkTouched(false);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (article: Article) => {
    setEditingArticle(article);
    // Lämna Fortnox-kopplingen orörd om användaren inte rör fältet (untouched).
    setFortnoxArticleNumber(null);
    setFortnoxLinkTouched(false);
    setFormData({
      articleNumber: article.articleNumber,
      name: article.name,
      description: article.description || "",
      articleType: article.articleType,
      hookLevel: article.hookLevel || "",
      hookConditions: (article.hookConditions as HookConditions) || {},
      objectTypes: article.objectTypes || [],
      productionTime: article.articleType === "vara" ? 0 : (article.productionTime ?? 15),
      cost: article.cost || 0,
      listPrice: article.listPrice || 0,
      unit: article.unit || "st",
      status: article.status || "active",
      fetchMetadataCode: article.fetchMetadataCode || "",
      leaveMetadataCode: article.leaveMetadataCode || "",
      leaveMetadataFormat: article.leaveMetadataFormat || "",
      maxPerAddress: article.maxPerAddress ?? null,
      associationLabel: article.associationLabel || "",
      associationValue: article.associationValue || "",
      associationOperator: article.associationOperator || "equals",
      associationRules: Array.isArray(article.associationRules) ? (article.associationRules as AssociationCondition[]) : [],
      fetchMetadataLabel: article.fetchMetadataLabel || "",
      fetchMetadataLabelFormat: article.fetchMetadataLabelFormat || "",
      canUpdateMetadata: article.canUpdateMetadata || false,
      updateMetadataLabel: article.updateMetadataLabel || "",
      updateMetadataFormat: article.updateMetadataFormat || "",
      showPreviousValue: article.showPreviousValue || false,
      isInfoCarrier: article.isInfoCarrier || false,
      limitationType: article.limitationType || "unlimited",
      // Normalisera äldre lägen till per_styck (samma beteende) — alternativet finns inte längre i UI.
      quantityMode: (article.quantityMode === "use_object_quantity" || article.quantityMode === "configurable" || !article.quantityMode)
        ? "per_styck"
        : article.quantityMode,
      quantityMetadataField: article.quantityMetadataField || "",
      quantityUnit: article.quantityUnit || "",
      groupSize: article.groupSize ?? 1,
      offsetMinutes: article.offsetMinutes ?? 0,
      leadTimeDays: (article as any).leadTimeDays ?? null,
      requiresAcknowledgment: (article as any).requiresAcknowledgment ?? false,
      dependencyCriticality: (article as any).dependencyCriticality ?? "critical",
      isStructure: (article as any).isStructure ?? false,
      isComponent: (article as any).isComponent ?? false,
      defaultMetadataAssociation: article.defaultMetadataAssociation || "",
      stockLocation: article.stockLocation || "",
      supplierNumbers: article.supplierNumbers || [],
      replacementArticleId: article.replacementArticleId || "",
      externInfoUrl: article.externInfoUrl || "",
      externInfoDescription: article.externInfoDescription || "",
      externInfoFileUrl: (article as any).externInfoFileUrl || "",
    });
    {
      const om = article.offsetMinutes ?? 0;
      const type: "before" | "same" | "after" = om < 0 ? "before" : om > 0 ? "after" : "same";
      const absMin = Math.abs(om);
      const useDays = absMin !== 0 && absMin % 1440 === 0;
      setOffsetType(type);
      setOffsetUnit(useDays ? "days" : "minutes");
      setOffsetValueInput(String(type === "same" ? 0 : useDays ? absMin / 1440 : absMin));
    }
    setComponentDraft([]);
    setOriginalComponents([]);
    if ((article as any).isStructure) {
      apiRequest("GET", `/api/articles/${article.id}/components`)
        .then((res) => res.json())
        .then((rows: any[]) => {
          const sorted = [...rows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          setComponentDraft(sorted.map((r) => ({
            id: r.id,
            childArticleId: r.childArticleId,
            quantityMode: r.quantityFormula === "follows_parent" ? "follows_parent" : "fixed",
            quantity: typeof r.quantity === "number" ? r.quantity : 1,
            isMandatory: r.isMandatory ?? true,
            notes: r.notes || "",
          })));
          setOriginalComponents(sorted.map((r) => ({ id: r.id, childArticleId: r.childArticleId })));
        })
        .catch(() => {
          toast({ title: "Kunde inte läsa strukturkomponenter", variant: "destructive" });
        });
    }
    setDialogOpen(true);
  };

  // Task #835: multi-AND metadata-villkor (Association). Icke-metadata-villkor
  // (hook_level/object_type) bevaras orörda i associationRules — endast migrerade
  // legacy-data, ej redigerbara i UI:t men får inte tappas vid spar.
  type MetadataCondition = Extract<AssociationCondition, { source: "metadata" }>;
  const metadataConditions = formData.associationRules.filter(
    (c): c is MetadataCondition => c.source === "metadata",
  );
  const writeMetadataConditions = (next: MetadataCondition[]) => {
    setFormData(prev => ({
      ...prev,
      associationRules: [...prev.associationRules.filter(c => c.source !== "metadata"), ...next],
    }));
  };
  const addMetadataCondition = () =>
    writeMetadataConditions([...metadataConditions, { source: "metadata", label: "", operator: "equals", value: "" }]);
  const updateMetadataCondition = (idx: number, patch: Partial<MetadataCondition>) =>
    writeMetadataConditions(metadataConditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeMetadataCondition = (idx: number) =>
    writeMetadataConditions(metadataConditions.filter((_, i) => i !== idx));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.articleNumber.trim() || !formData.name.trim()) {
      toast({ title: "Fyll i obligatoriska fält", description: "Artikelnummer och namn krävs innan du sparar.", variant: "destructive" });
      return;
    }

    if (articleNumberDuplicate) {
      toast({ title: "Artikelnummer används redan", description: "Välj ett unikt artikelnummer innan du sparar.", variant: "destructive" });
      return;
    }

    if (externFileUploading) {
      toast({ title: "Vänta på uppladdning", description: "Den externa filen laddas fortfarande upp.", variant: "destructive" });
      return;
    }

    if (formData.isStructure) {
      const rows = componentDraft;
      if (rows.some((d) => !d.childArticleId)) {
        toast({ title: "Ofullständig komponent", description: "Välj en artikel för varje komponentrad eller ta bort tomma rader.", variant: "destructive" });
        return;
      }
      const ids = rows.map((d) => d.childArticleId);
      if (new Set(ids).size !== ids.length) {
        toast({ title: "Dubblerad komponent", description: "Samma artikel får bara förekomma en gång i strukturen.", variant: "destructive" });
        return;
      }
    }

    const payload: Partial<ArticleFormData> & { fortnoxArticleNumber?: string | null } = { ...formData };
    if (fortnoxLinkTouched) {
      payload.fortnoxArticleNumber = fortnoxArticleNumber;
    }
    if (editingArticle) {
      updateMutation.mutate({ id: editingArticle.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const filteredArticles = useMemo(() => {
    return articles.filter(article => {
      const matchesSearch = 
        article.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.articleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (article.description?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesType = typeFilter === "all" || article.articleType === typeFilter;
      
      const matchesObjectType = objectTypeFilter === "all" || 
        (article.objectTypes && article.objectTypes.includes(objectTypeFilter));
      
      const matchesHookLevel = hookLevelFilter === "all" || 
        (hookLevelFilter === "none" ? !article.hookLevel : article.hookLevel === hookLevelFilter);

      const matchesStatus = showDiscontinued || article.status !== "utgått";

      return matchesSearch && matchesType && matchesObjectType && matchesHookLevel && matchesStatus;
    });
  }, [articles, searchQuery, typeFilter, objectTypeFilter, hookLevelFilter, showDiscontinued]);

  const totalPages = Math.max(1, Math.ceil(filteredArticles.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedArticles = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    return filteredArticles.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredArticles, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, typeFilter, objectTypeFilter, hookLevelFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages]);

  const activeFilterCount = [
    typeFilter !== "all" ? 1 : 0,
    objectTypeFilter !== "all" ? 1 : 0,
    hookLevelFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearAllFilters = () => {
    setTypeFilter("all");
    setObjectTypeFilter("all");
    setHookLevelFilter("all");
  };

  const quickStats = useMemo(() => {
    const activeCount = articles.filter(a => a.status === "active").length;
    const inactiveCount = articles.filter(a => a.status !== "active").length;
    const withHook = articles.filter(a => a.hookLevel).length;
    const typeCounts: Record<string, number> = {};
    for (const a of articles) {
      const label = articleTypeLabels[a.articleType] || a.articleType;
      typeCounts[label] = (typeCounts[label] || 0) + 1;
    }
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return { activeCount, inactiveCount, withHook, topTypes };
  }, [articles]);

  const formatPrice = (price: number | null | undefined) => {
    if (price === null || price === undefined) return "-";
    return `${price.toFixed(2)} kr`;
  };

  const formatTime = (minutes: number | null | undefined) => {
    if (minutes === null || minutes === undefined) return "-";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <PageHeader
          icon={Package}
          title={t("article_plural")}
          description="Produkter och tjänster som kan läggas på ordrar"
          testId="text-page-title"
        >
          <Button onClick={openCreateDialog} data-testid="button-create-article">
            <Plus className="h-4 w-4 mr-2" />
            Ny artikel
          </Button>
        </PageHeader>
        <div className="flex items-center gap-3 flex-wrap">
          {quickStats.topTypes.map(([label, count]) => (
            <Badge key={label} variant="secondary" className="text-xs font-normal" data-testid={`badge-stat-type-${label}`}>
              {count} {label}
            </Badge>
          ))}
          {quickStats.activeCount > 0 && (
            <Badge variant="outline" className="text-xs font-normal gap-1 text-chart-2 border-chart-2/30">
              <CircleCheck className="h-3 w-3" />
              {quickStats.activeCount} aktiva
            </Badge>
          )}
          {quickStats.inactiveCount > 0 && (
            <Badge variant="outline" className="text-xs font-normal gap-1 text-muted-foreground">
              <CircleX className="h-3 w-3" />
              {quickStats.inactiveCount} inaktiva
            </Badge>
          )}
          {quickStats.withHook > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-xs font-normal gap-1 cursor-help">
                  <Link className="h-3 w-3" />
                  {quickStats.withHook} med fasthakning
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Artiklar kopplade till en hierarkinivå</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-[400px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Sök ${t("article_plural").toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-article"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
            data-testid="button-toggle-filters"
          >
            <Filter className="h-4 w-4" />
            Filter
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                {activeFilterCount}
              </Badge>
            )}
            {showFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1 text-muted-foreground" data-testid="button-clear-filters">
              <XCircle className="h-4 w-4" />
              Rensa filter
            </Button>
          )}
          <div className="flex items-center border rounded-md">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("list")}
                  data-testid="button-view-list"
                >
                  <List className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Listvy</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "hooks" ? "secondary" : "ghost"}
                  size="icon"
                  onClick={() => setViewMode("hooks")}
                  data-testid="button-view-hooks"
                >
                  <Link className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Fasthakningsvy</p></TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-discontinued"
              checked={showDiscontinued}
              onCheckedChange={setShowDiscontinued}
              data-testid="switch-show-discontinued"
            />
            <Label htmlFor="show-discontinued" className="text-sm whitespace-nowrap cursor-pointer">Visa utgångna</Label>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={() => setTestDialogOpen(true)}
                data-testid="button-test-hook"
              >
                <Target className="h-4 w-4 mr-2" />
                Testa
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Testa vilka artiklar som gäller för ett objekt</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {typeFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setTypeFilter("all")} data-testid="badge-filter-type">
                Typ: {articleTypeLabels[typeFilter] || typeFilter}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {objectTypeFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setObjectTypeFilter("all")} data-testid="badge-filter-object-type">
                Objekttyp: {objectTypeLabels[objectTypeFilter] || objectTypeFilter}
                <X className="h-3 w-3" />
              </Badge>
            )}
            {hookLevelFilter !== "all" && (
              <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setHookLevelFilter("all")} data-testid="badge-filter-hook-level">
                Fasthakning: {hookLevelFilter === "none" ? "Utan fasthakning" : (hookLevelLabels[hookLevelFilter] || hookLevelFilter)}
                <X className="h-3 w-3" />
              </Badge>
            )}
          </div>
        )}

        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Artikeltyp:</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla typer</SelectItem>
                  {articleTypeOptions.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Objekttyp:</Label>
              <Select value={objectTypeFilter} onValueChange={setObjectTypeFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-object-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {objectTypeOptions.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Fasthakning:</Label>
              <Select value={hookLevelFilter} onValueChange={setHookLevelFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-hook-level-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla</SelectItem>
                  <SelectItem value="none">Utan fasthakning</SelectItem>
                  {hookLevelOptions.filter(o => o.value !== "none").map(level => (
                    <SelectItem key={level.value} value={level.value}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={!isLoading && !isError && articles.length === 0}
        error={articlesError instanceof Error ? articlesError : null}
        onRetry={() => refetchArticles()}
        loadingVariant="skeleton-rows"
        skeletonRows={6}
        emptyTitle="Inga artiklar ännu"
        emptyDescription="Skapa en ny artikel eller importera artiklar från Fortnox för att komma igång."
        emptyAction={
          <Button onClick={openCreateDialog} data-testid="button-create-article-empty">
            <Plus className="h-4 w-4 mr-2" />
            Ny artikel
          </Button>
        }
      >
      {viewMode === "hooks" ? (
        <div className="flex-1 overflow-auto">
          <div className="grid gap-4">
            {[
              { level: "koncern", label: "Koncern", icon: Building2, description: "Artiklar som gäller på organisationsnivå" },
              { level: "brf", label: "BRF", icon: Building, description: "Artiklar för bostadsrättsföreningar" },
              { level: "fastighet", label: "Fastighet", icon: Home, description: "Artiklar på fastighetsnivå" },
              { level: "rum", label: "Rum", icon: Box, description: "Artiklar för rum (soprum, kök, etc.)" },
              { level: "karl", label: "Alla objekt", icon: Trash, description: "Gäller alla objekttyper (T100)" },
              { level: "karl_mat", label: "Matavfall", icon: Trash, description: "Endast matavfallskärl (K100 Dekal)" },
              { level: "karl_rest", label: "Restavfall", icon: Trash, description: "Endast restavfallskärl" },
              { level: "karl_plast", label: "Plast", icon: Trash, description: "Endast plastkärl" },
              { level: "kod", label: "Accesskod", icon: Key, description: "Objekt med portkod (KOD10)" },
            ].map(({ level, label, icon: Icon, description }) => {
              const levelArticles = articles.filter(a => a.hookLevel === level);
              if (levelArticles.length === 0) return null;
              
              return (
                <Card key={level} data-testid={`card-hook-level-${level}`}>
                  <CardHeader className="flex flex-row items-center gap-3 pb-2">
                    <div className="p-2 rounded-md bg-muted">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{label}</CardTitle>
                      <p className="text-sm text-muted-foreground">{description}</p>
                    </div>
                    <Badge variant="secondary">{levelArticles.length} artiklar</Badge>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-2">
                      {levelArticles.map(article => (
                        <Badge
                          key={article.id}
                          variant="outline"
                          className="cursor-pointer hover-elevate"
                          onClick={() => openEditDialog(article)}
                          data-testid={`badge-article-${article.id}`}
                        >
                          <span className="font-mono text-xs mr-1">{article.articleNumber}</span>
                          {article.name}
                          {article.defaultMetadataAssociation && (
                            <span
                              className="ml-1.5 inline-flex items-center gap-0.5 border-l pl-1.5 text-xs text-muted-foreground"
                              data-testid={`badge-default-metadata-${article.id}`}
                            >
                              <Tag className="h-3 w-3" />
                              {metadataDefinitionLabels.get(article.defaultMetadataAssociation) || article.defaultMetadataAssociation}
                            </span>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            
            {articles.filter(a => !a.hookLevel).length > 0 && (
              <Card className="border-dashed" data-testid="card-no-hook">
                <CardHeader className="flex flex-row items-center gap-3 pb-2">
                  <div className="p-2 rounded-md bg-muted/50">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base text-muted-foreground">Utan fasthakning</CardTitle>
                    <p className="text-sm text-muted-foreground">Artiklar som inte är kopplade till en hierarkinivå</p>
                  </div>
                  <Badge variant="outline">{articles.filter(a => !a.hookLevel).length} artiklar</Badge>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {articles.filter(a => !a.hookLevel).slice(0, 20).map(article => (
                      <Badge
                        key={article.id}
                        variant="outline"
                        className="cursor-pointer hover-elevate text-muted-foreground"
                        onClick={() => openEditDialog(article)}
                        data-testid={`badge-article-${article.id}`}
                      >
                        <span className="font-mono text-xs mr-1">{article.articleNumber}</span>
                        {article.name}
                        {article.defaultMetadataAssociation && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-0.5 border-l pl-1.5 text-xs"
                            data-testid={`badge-default-metadata-${article.id}`}
                          >
                            <Tag className="h-3 w-3" />
                            {metadataDefinitionLabels.get(article.defaultMetadataAssociation) || article.defaultMetadataAssociation}
                          </span>
                        )}
                      </Badge>
                    ))}
                    {articles.filter(a => !a.hookLevel).length > 20 && (
                      <Badge variant="outline" className="text-muted-foreground">
                        +{articles.filter(a => !a.hookLevel).length - 20} fler...
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
            <CardTitle className="text-lg">
              {filteredArticles.length === articles.length
                ? `${articles.length} artiklar`
                : `${filteredArticles.length} av ${articles.length} artiklar`}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artikelnr</TableHead>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Fasthakning</TableHead>
                <TableHead className="text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>Tid</span>
                  </div>
                </TableHead>
                <TableHead className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <DollarSign className="h-4 w-4" />
                    <span>Listpris</span>
                  </div>
                </TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredArticles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Inga artiklar hittades</p>
                    {searchQuery && <p className="text-sm">Prova att ändra sökningen</p>}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedArticles.map((article) => (
                  <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                    <TableCell className="font-mono text-sm">
                      {article.articleNumber}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{article.name}</span>
                          {deriveIsPreTask(article) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="secondary" className="gap-1 text-[10px] shrink-0 cursor-help" data-testid={`badge-pre-task-${article.id}`}>
                                  <Clock className="h-3 w-3" /> Föruppgift
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Deriveras automatiskt till en föruppgift (typ "beroende" eller negativ offset)</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        {article.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                            {article.description}
                          </div>
                        )}
                        {article.defaultMetadataAssociation && (
                          <Badge
                            variant="outline"
                            className="mt-1 gap-1 font-normal text-xs"
                            data-testid={`badge-default-metadata-${article.id}`}
                          >
                            <Tag className="h-3 w-3" />
                            {metadataDefinitionLabels.get(article.defaultMetadataAssociation) || article.defaultMetadataAssociation}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {articleTypeLabels[article.articleType] || article.articleType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {article.hookLevel ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="cursor-help">
                              {hookLevelLabels[article.hookLevel] || article.hookLevel}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>Artikeln hakar fast på nivå: {hookLevelLabels[article.hookLevel] || article.hookLevel}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-xs">Ingen</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {formatTime(article.productionTime)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPrice(article.listPrice)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={article.status === "utgått" ? "outline" : (article.status === "active" || article.status === "aktiv" || !article.status) ? "default" : "outline"}
                        className={articleStatusBadgeClass(article.status)}
                        data-testid={`badge-status-${article.id}`}
                      >
                        {articleStatusLabel(article.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(article)}
                              data-testid={`button-edit-article-${article.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Redigera</p></TooltipContent>
                        </Tooltip>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-more-article-${article.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedObjectId("");
                                setTestDialogOpen(true);
                              }}
                              data-testid={`menu-test-article-${article.id}`}
                            >
                              <Target className="h-4 w-4 mr-2" />
                              Testa fasthakning
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                setArticleToDelete(article);
                                setDeleteDialogOpen(true);
                              }}
                              data-testid={`menu-delete-article-${article.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Ta bort artikel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </CardContent>
          {totalPages > 1 && viewMode === "list" && (
            <div className="flex items-center justify-between border-t px-6 py-3" data-testid="pagination-articles">
              <span className="text-sm text-muted-foreground">
                Visar {(safePage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(safePage * ITEMS_PER_PAGE, filteredArticles.length)} av {filteredArticles.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  data-testid="button-prev-page-articles"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Föregående
                </Button>
                <span className="text-sm px-2">
                  Sida {safePage} av {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  data-testid="button-next-page-articles"
                >
                  Nästa
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
      </QueryState>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingArticle ? "Redigera artikel" : "Ny artikel"}
            </DialogTitle>
            <DialogDescription>
              {editingArticle ? "Uppdatera artikelinformation" : "Lägg till en ny artikel i systemet"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <FormSection title="Grundinformation" icon={<Package className="h-4 w-4" />} defaultOpen testId="section-grundinfo">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="articleNumber">Artikelnummer <span className="text-destructive">*</span></Label>
                  <FortnoxArticleNumberField
                    value={formData.articleNumber}
                    onChange={(v) => {
                      setFormData(prev => ({ ...prev, articleNumber: v }));
                      setFortnoxLinkTouched(true);
                      setFortnoxArticleNumber(prev => (prev === v ? prev : null));
                    }}
                    onSelectFortnox={(a) => {
                      setFormData(prev => ({
                        ...prev,
                        articleNumber: a.articleNumber,
                        name: prev.name.trim() ? prev.name : a.description,
                      }));
                      setFortnoxArticleNumber(a.articleNumber);
                      setFortnoxLinkTouched(true);
                    }}
                    invalid={articleNumberDuplicate}
                  />
                  {articleNumberDuplicate ? (
                    <p className="text-xs text-destructive flex items-start gap-1" data-testid="error-article-number-duplicate">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Artikelnumret används redan{articleNumberCheck?.existingName ? ` av "${articleNumberCheck.existingName}"` : ""}.</span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Sök i Fortnox eller skriv fritext — måste vara unikt per organisation.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="articleType">Artikeltyp</Label>
                  <Select
                    value={formData.articleType}
                    onValueChange={(value) => setFormData({ ...formData, articleType: value, ...(value === "vara" ? { productionTime: 0 } : {}) })}
                  >
                    <SelectTrigger data-testid="select-article-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {articleTypeOptions.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                      {formData.articleType && !articleTypeOptions.some(t => t.value === formData.articleType) && (
                        <SelectItem value={formData.articleType}>
                          {formData.articleType} (arkiverad)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Namn <span className="text-destructive">*</span></Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.slice(0, 50) })}
                  placeholder="Kärltömning 240L"
                  required
                  maxLength={50}
                  data-testid="input-article-name"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Kundbeskrivning — syns på fakturor och följesedlar.
                  </p>
                  <span
                    className={`text-xs tabular-nums ${formData.name.length >= 50 ? "text-warning" : "text-muted-foreground"}`}
                    data-testid="text-name-char-count"
                  >
                    {formData.name.length}/50
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Beskrivning</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Intern info för medarbetare, t.ex. specialinstruktioner eller verktyg..."
                  rows={3}
                  data-testid="input-article-description"
                />
                <p className="text-xs text-muted-foreground">
                  Intern information för fältarbetare (visas ej för kund).
                </p>
              </div>

              </FormSection>
              <FormSection title="Extern info & leverantör" icon={<FileText className="h-4 w-4" />} testId="section-extern">
              <div className="space-y-2">
                <Label htmlFor="externInfoUrl">Extern info — länk</Label>
                <Input
                  id="externInfoUrl"
                  type="url"
                  value={formData.externInfoUrl}
                  onChange={(e) => setFormData({ ...formData, externInfoUrl: e.target.value })}
                  placeholder="https://..."
                  data-testid="input-extern-info-url"
                />
                <Textarea
                  id="externInfoDescription"
                  value={formData.externInfoDescription}
                  onChange={(e) => setFormData({ ...formData, externInfoDescription: e.target.value })}
                  placeholder="Beskrivning av den externa länken (t.ex. produktblad, säkerhetsdatablad)..."
                  rows={2}
                  data-testid="input-extern-info-description"
                />
                <p className="text-xs text-muted-foreground">
                  Länk till extern information (t.ex. produktblad eller säkerhetsdatablad) med en kort beskrivning.
                </p>

                <div className="pt-1 space-y-2">
                  <Label htmlFor="externInfoFile" className="text-sm">Eller ladda upp fil (PDF, bild)</Label>
                  {formData.externInfoFileUrl ? (
                    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" data-testid="row-extern-info-file">
                      <a
                        href={formData.externInfoFileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-primary hover:underline truncate"
                        data-testid="link-extern-info-file"
                      >
                        <FileText className="h-4 w-4 shrink-0" />
                        <span className="truncate">Öppna uppladdad fil</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, externInfoFileUrl: "" })}
                        className="ml-2 text-muted-foreground hover:text-destructive shrink-0"
                        data-testid="button-remove-extern-info-file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <Input
                      id="externInfoFile"
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={externFileUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadExternFile(file);
                        e.target.value = "";
                      }}
                      data-testid="input-extern-info-file"
                    />
                  )}
                  {externFileUploading && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Laddar upp...
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="supplierNumberInput">Leverantörsnummer</Label>
                <div className="flex gap-2">
                  <Input
                    id="supplierNumberInput"
                    value={supplierNumberInput}
                    onChange={(e) => setSupplierNumberInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = supplierNumberInput.trim();
                        if (v && !formData.supplierNumbers.includes(v)) {
                          setFormData({ ...formData, supplierNumbers: [...formData.supplierNumbers, v] });
                        }
                        setSupplierNumberInput("");
                      }
                    }}
                    placeholder="Lägg till leverantörsnummer och tryck Enter"
                    data-testid="input-supplier-number"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const v = supplierNumberInput.trim();
                      if (v && !formData.supplierNumbers.includes(v)) {
                        setFormData({ ...formData, supplierNumbers: [...formData.supplierNumbers, v] });
                      }
                      setSupplierNumberInput("");
                    }}
                    data-testid="button-add-supplier-number"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {formData.supplierNumbers.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {formData.supplierNumbers.map((sn, i) => (
                      <Badge key={`${sn}-${i}`} variant="secondary" className="gap-1" data-testid={`badge-supplier-number-${i}`}>
                        <span className="font-mono text-xs">{sn}</span>
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, supplierNumbers: formData.supplierNumbers.filter((_, idx) => idx !== i) })}
                          className="ml-0.5 hover:text-destructive"
                          data-testid={`button-remove-supplier-number-${i}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Artikelns nummer hos olika leverantörer (valfritt, flera tillåtna).</p>
              </div>

              </FormSection>
              <FormSection title="Pris & kvantitet" icon={<DollarSign className="h-4 w-4" />} testId="section-pris">
              <div className="grid grid-cols-3 gap-4">
                {formData.articleType === "vara" ? (
                  <div className="space-y-2">
                    <Label htmlFor="stockLocation">Lagerplats</Label>
                    <Input
                      id="stockLocation"
                      value={formData.stockLocation}
                      onChange={(e) => setFormData({ ...formData, stockLocation: e.target.value })}
                      placeholder="t.ex. Lager A, hylla 3"
                      data-testid="input-stock-location"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="productionTime">Produktionstid (min)</Label>
                    <Input
                      id="productionTime"
                      type="number"
                      min="0"
                      value={formData.productionTime}
                      onChange={(e) => setFormData({ ...formData, productionTime: parseInt(e.target.value) || 0 })}
                      data-testid="input-production-time"
                    />
                  </div>
                )}
                {isAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="cost">Kostnad (kr)</Label>
                    <Input
                      id="cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.cost ? (formData.cost / 100).toString() : ""}
                      placeholder="0.00"
                      onChange={(e) => {
                        const v = e.target.value;
                        setFormData({ ...formData, cost: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                      }}
                      data-testid="input-cost"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="listPrice">Listpris (kr)</Label>
                  <Input
                    id="listPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.listPrice ? (formData.listPrice / 100).toString() : ""}
                    placeholder="0.00"
                    onChange={(e) => {
                      const v = e.target.value;
                      setFormData({ ...formData, listPrice: v === "" ? 0 : Math.round(parseFloat(v) * 100) || 0 });
                    }}
                    data-testid="input-list-price"
                  />
                </div>
              </div>
              {isAdmin && (() => {
                const marginOre = (formData.listPrice || 0) - (formData.cost || 0);
                const marginKr = (marginOre / 100).toFixed(2);
                const marginPct = formData.listPrice > 0
                  ? Math.round((marginOre / formData.listPrice) * 1000) / 10
                  : null;
                const positive = marginOre >= 0;
                return (
                  <div
                    className={`rounded-md border px-3 py-2 text-sm flex items-center justify-between ${
                      positive
                        ? "bg-chart-2/10 dark:bg-chart-2/15 border-chart-2/20 dark:border-chart-2/90 text-chart-2"
                        : "bg-destructive/10 dark:bg-destructive/15 border-destructive/20 dark:border-destructive/90 text-destructive"
                    }`}
                    data-testid="text-article-margin"
                  >
                    <span className="font-medium">Marginal per enhet</span>
                    <span className="font-mono">
                      {positive ? "+" : ""}{marginKr} kr
                      {marginPct !== null && (
                        <span className="ml-2 opacity-80">({marginPct}%)</span>
                      )}
                    </span>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <Label htmlFor="quantityMode">Kvantitetsläge</Label>
                <Select
                  value={formData.quantityMode}
                  onValueChange={(value) => setFormData({ ...formData, quantityMode: value })}
                >
                  <SelectTrigger id="quantityMode" data-testid="select-quantity-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_styck">Per styck — multipliceras med objektets antal</SelectItem>
                    <SelectItem value="single_per_task">En per uppdrag (alltid 1)</SelectItem>
                    <SelectItem value="group">Grupp — fast multipel (gruppstorlek)</SelectItem>
                    <SelectItem value="matches_field">Matchar metadatafält — antal från objektets metadata</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Avgör hur många enheter som skapas när artikeln expanderas: <strong>Per styck</strong> = objektets antal (t.ex. 45 kärl × 150 kr), <strong>En per uppdrag</strong> = alltid 1 (t.ex. fotodokumentation, telefonavisering), <strong>Grupp</strong> = fast multipel, <strong>Matchar metadatafält</strong> = antalet hämtas från objektets metadata.
                </p>
                {formData.quantityMode === "group" && (
                  <div className="space-y-2 pt-1" data-testid="field-group-size">
                    <Label htmlFor="groupSize" className="text-sm">Gruppstorlek</Label>
                    <Input
                      id="groupSize"
                      type="number"
                      min="1"
                      value={formData.groupSize}
                      onChange={(e) => setFormData({ ...formData, groupSize: Math.max(1, parseInt(e.target.value) || 1) })}
                      data-testid="input-group-size"
                    />
                    <p className="text-xs text-muted-foreground">Fast antal enheter per uppdrag (minst 1).</p>
                  </div>
                )}
                {formData.quantityMode === "matches_field" && (
                  <div className="grid grid-cols-2 gap-4 pt-1" data-testid="field-matches-field">
                    <div className="space-y-2">
                      <Label htmlFor="quantityMetadataField" className="text-sm">Metadatafält (antal)</Label>
                      <Select
                        value={formData.quantityMetadataField || "_none"}
                        onValueChange={(v) => setFormData({ ...formData, quantityMetadataField: v === "_none" ? "" : v })}
                      >
                        <SelectTrigger id="quantityMetadataField" data-testid="select-quantity-metadata-field">
                          <SelectValue placeholder="Välj metadatafält" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">Välj metadatafält</SelectItem>
                          {metadataTypes.map(t => (
                            <SelectItem key={t.id} value={t.namn}>{t.namn} ({t.datatyp})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Antalet läses från objektets värde för detta fält.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quantityUnit" className="text-sm">Enhet (valfritt)</Label>
                      <Input
                        id="quantityUnit"
                        value={formData.quantityUnit}
                        onChange={(e) => setFormData({ ...formData, quantityUnit: e.target.value })}
                        placeholder="t.ex. m², kg, st"
                        data-testid="input-quantity-unit"
                      />
                      <p className="text-xs text-muted-foreground">Visas tillsammans med antalet.</p>
                    </div>
                  </div>
                )}
                {formData.quantityMode === "matches_field" && !formData.quantityMetadataField && (
                  <p className="text-xs text-warning flex items-start gap-1" data-testid="warning-matches-field-missing">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Välj ett metadatafält — annars faller antalet tillbaka på objektets standardantal.</span>
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <Label>Offsettid</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="offsetUnit" className="text-sm text-muted-foreground">Enhet</Label>
                    <Select
                      value={offsetUnit}
                      onValueChange={(v) => {
                        const unit = v as "minutes" | "days";
                        setOffsetUnit(unit);
                        setFormData(prev => ({ ...prev, offsetMinutes: computeOffsetMinutes(unit, offsetType, offsetValueInput) }));
                      }}
                    >
                      <SelectTrigger id="offsetUnit" data-testid="select-offset-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">Minuter</SelectItem>
                        <SelectItem value="days">Dagar</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="offsetValue" className="text-sm text-muted-foreground">Värde</Label>
                    <Input
                      id="offsetValue"
                      type="number"
                      min="0"
                      step="1"
                      value={offsetValueInput}
                      disabled={offsetType === "same"}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setOffsetValueInput(raw);
                        setFormData(prev => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, offsetType, raw) }));
                      }}
                      onBlur={() => {
                        const mag = Math.abs(parseInt(offsetValueInput, 10) || 0);
                        setOffsetValueInput(String(mag));
                        setFormData(prev => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, offsetType, String(mag)) }));
                      }}
                      data-testid="input-offset-value"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Typ</Label>
                  <div className="flex flex-col gap-2">
                    {([
                      { value: "before", label: "Före huvudjobb (negativ)" },
                      { value: "same", label: "Samtidigt (0)" },
                      { value: "after", label: "Efter huvudjobb (positiv)" },
                    ] as const).map(opt => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="offsetType"
                          value={opt.value}
                          checked={offsetType === opt.value}
                          onChange={() => {
                            setOffsetType(opt.value);
                            setFormData(prev => ({ ...prev, offsetMinutes: computeOffsetMinutes(offsetUnit, opt.value, offsetValueInput) }));
                          }}
                          data-testid={`radio-offset-type-${opt.value}`}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Styr <strong>när</strong> uppgiften utförs relativt huvudjobbet. <strong>Före</strong> = förberedande uppgift (t.ex. telefonavisering 2 timmar innan). <strong>Samtidigt</strong> = vid schemalagt tillfälle. <strong>Efter</strong> = uppföljande uppgift efter huvudjobbet. När orderkonceptet expanderas skapas en separat uppgift kopplad till huvudjobbet (sparas som {formData.offsetMinutes} min). Leveranstid från leverantör anges separat som <strong>Ledtid</strong> nedan.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="leadTimeDays">Ledtid (leverans, dagar)</Label>
                <Input
                  id="leadTimeDays"
                  type="number"
                  min="0"
                  step="1"
                  value={formData.leadTimeDays ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    setFormData({ ...formData, leadTimeDays: raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0) });
                  }}
                  data-testid="input-lead-time-days"
                />
                <p className="text-xs text-muted-foreground">
                  Leverantörens leveranstid i dagar (t.ex. materialartikel som måste beställas i förväg). Vid orderkoncept-expansion används ledtiden för att beställa/förbereda i tid innan huvudjobbet och systemet varnar om ledtiden inte hinner före leveransdatumet. Lämna tomt om ledtid inte är relevant.
                </p>
              </div>

              {formData.articleType === "beroende" && (
                <div className="space-y-3 rounded-md border border-border p-3" data-testid="section-dependency">
                  <Label className="text-sm font-medium">Beroendeartikel</Label>
                  <label className="flex items-start gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={formData.requiresAcknowledgment}
                      onChange={(e) => setFormData({ ...formData, requiresAcknowledgment: e.target.checked })}
                      data-testid="checkbox-requires-acknowledgment"
                    />
                    <span>Kräver kvittens — beroendets tillgänglighet måste bekräftas innan huvuduppgiften kan utföras. Systemet varnar om kvittens saknas.</span>
                  </label>
                  <div className="space-y-2">
                    <Label htmlFor="dependencyCriticality" className="text-sm text-muted-foreground">Kritiskhet</Label>
                    <Select
                      value={formData.dependencyCriticality || "critical"}
                      onValueChange={(v) => setFormData({ ...formData, dependencyCriticality: v })}
                    >
                      <SelectTrigger id="dependencyCriticality" data-testid="select-dependency-criticality">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Kritisk (blockerar huvuduppgiften)</SelectItem>
                        <SelectItem value="skippable">Kan strykas (varning men blockerar ej)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Styr hur hårt ett okvitterat beroende påverkar huvuduppgiften. Skalan är utbyggbar för framtida graderade nivåer.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3 rounded-md border border-border p-3" data-testid="section-structure">
                <label className="flex items-start gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={formData.isStructure}
                    onChange={(e) => setFormData({ ...formData, isStructure: e.target.checked })}
                    data-testid="checkbox-is-structure"
                  />
                  <span><strong>Strukturartikel</strong> — artikeln består av flera underartiklar (BOM). Varje underartikel blir en delkomponent/deluppgift.</span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={formData.isComponent}
                    onChange={(e) => setFormData({ ...formData, isComponent: e.target.checked })}
                    data-testid="checkbox-is-component"
                  />
                  <span>Kan användas som komponent i strukturartiklar.</span>
                </label>

                {formData.isStructure && (
                  <div className="space-y-3 border-t border-border pt-3" data-testid="structure-components-editor">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Komponenter (underartiklar)</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setComponentDraft((prev) => [...prev, { childArticleId: "", quantityMode: "follows_parent", quantity: 1, isMandatory: true, notes: "" }])}
                        data-testid="button-add-component"
                      >
                        Lägg till komponent
                      </Button>
                    </div>

                    {formData.quantityMode !== "per_styck" && componentDraft.some((d) => d.quantityMode === "fixed") && (
                      <p className="text-xs text-warning" data-testid="warning-quantity-base">
                        Huvudartikeln skalar antal via metadata, men en eller flera komponenter har fast antal — dessa följer inte huvudartikelns antal. Sätt "Följer huvudartikel" om de ska skala med.
                      </p>
                    )}

                    {componentDraft.length === 0 && (
                      <p className="text-xs text-muted-foreground">Inga komponenter ännu. Lägg till minst en underartikel.</p>
                    )}

                    {componentDraft.map((row, idx) => {
                      const selectableArticles = articles.filter((a) =>
                        a.id !== editingArticle?.id &&
                        !(a as any).isStructure &&
                        (a.id === row.childArticleId || !componentDraft.some((other, oi) => oi !== idx && other.childArticleId === a.id))
                      );
                      const patch = (p: Partial<ComponentDraft>) => setComponentDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...p } : r)));
                      return (
                        <div key={idx} className="space-y-2 rounded-md border border-border p-2" data-testid={`component-row-${idx}`}>
                          <div className="flex items-center gap-2">
                            <Select value={row.childArticleId || undefined} onValueChange={(v) => patch({ childArticleId: v })}>
                              <SelectTrigger className="flex-1" data-testid={`select-component-article-${idx}`}>
                                <SelectValue placeholder="Välj underartikel" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectableArticles.map((a) => (
                                  <SelectItem key={a.id} value={a.id}>{a.articleNumber} – {a.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => setComponentDraft((prev) => prev.filter((_, i) => i !== idx))}
                              data-testid={`button-remove-component-${idx}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <Select value={row.quantityMode} onValueChange={(v) => patch({ quantityMode: v as ComponentDraft["quantityMode"] })}>
                              <SelectTrigger className="w-56" data-testid={`select-component-qtymode-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="follows_parent">Följer huvudartikel</SelectItem>
                                <SelectItem value="fixed">Eget antal</SelectItem>
                              </SelectContent>
                            </Select>
                            {row.quantityMode === "fixed" && (
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                className="w-28"
                                value={row.quantity}
                                onChange={(e) => patch({ quantity: parseFloat(e.target.value) || 0 })}
                                data-testid={`input-component-qty-${idx}`}
                              />
                            )}
                            <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                              <input
                                type="checkbox"
                                checked={row.isMandatory}
                                onChange={(e) => patch({ isMandatory: e.target.checked })}
                                data-testid={`checkbox-component-mandatory-${idx}`}
                              />
                              Obligatorisk
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultMetadataAssociation">Förvalt metadatafält (Hakar fast på)</Label>
                <Select
                  value={formData.defaultMetadataAssociation || "__none__"}
                  onValueChange={(v) => setFormData({ ...formData, defaultMetadataAssociation: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger id="defaultMetadataAssociation" data-testid="select-default-metadata-assoc">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {metadataDefinitions.map((d) => (
                      <SelectItem key={d.id} value={d.fieldKey}>{d.fieldLabel}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Föreslås automatiskt som "Hakar fast på"-koppling när artikeln läggs till i ett orderkoncept (Steg 6).
                </p>
              </div>

              </FormSection>
              <FormSection title="Enhet & ersättning" icon={<Package className="h-4 w-4" />} testId="section-enhet">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unit">Enhet</Label>
                  <Input
                    id="unit"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="st"
                    data-testid="input-unit"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value, ...(value !== "utgått" ? { replacementArticleId: "" } : {}) })}
                  >
                    <SelectTrigger data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ARTICLE_STATUS_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                      {(formData.status === "active" || formData.status === "inactive") && (
                        <SelectItem value={formData.status}>
                          {formData.status === "active" ? "Aktiv (äldre)" : "Inaktiv (äldre)"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.status === "utgått" && (
                <div className="space-y-2" data-testid="field-replacement-article">
                  <Label htmlFor="replacementArticleId">Ersättningsartikel</Label>
                  <Select
                    value={formData.replacementArticleId || "_none"}
                    onValueChange={(v) => setFormData({ ...formData, replacementArticleId: v === "_none" ? "" : v })}
                  >
                    <SelectTrigger id="replacementArticleId" data-testid="select-replacement-article">
                      <SelectValue placeholder="Välj ersättningsartikel" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Ingen</SelectItem>
                      {articles
                        .filter(a => a.id !== editingArticle?.id && a.status !== "utgått")
                        .map(a => (
                          <SelectItem key={a.id} value={a.id}>
                            <span className="font-mono text-xs mr-1">{a.articleNumber}</span>{a.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    När en utgången artikel läggs till på en order används ersättningsartikeln automatiskt.
                  </p>
                </div>
              )}

              </FormSection>
              <FormSection title="Metadata-koppling" icon={<Database className="h-4 w-4" />} description="Koppla artikeln till metadata som hämtas/lämnas vid utförande" testId="section-metadata">

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Hämta metadata (fetchMetadataCode)</Label>
                  <Select
                    value={formData.fetchMetadataCode || "_none"}
                    onValueChange={(v) => {
                      const next = v === "_none" ? "" : v;
                      setFormData({ ...formData, fetchMetadataCode: next });
                      checkMetadataReferenceUsage(next, "fetch");
                    }}
                  >
                    <SelectTrigger data-testid="select-fetch-metadata">
                      <SelectValue placeholder="Ingen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Ingen</SelectItem>
                      {metadataTypes.map(t => (
                        <SelectItem key={t.id} value={t.namn}>{t.namn} ({t.datatyp})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Metadata som visas för utföraren vid start</p>
                  {metadataLinkWarnings.fetch && (
                    <p className="text-xs text-warning flex items-start gap-1" data-testid="warning-fetch-metadata-link">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{metadataLinkWarnings.fetch}</span>
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Lämna metadata (leaveMetadataCode)</Label>
                  <Select
                    value={formData.leaveMetadataCode || "_none"}
                    onValueChange={(v) => {
                      const next = v === "_none" ? "" : v;
                      setFormData({ ...formData, leaveMetadataCode: next });
                      checkMetadataReferenceUsage(next, "leave");
                    }}
                  >
                    <SelectTrigger data-testid="select-leave-metadata">
                      <SelectValue placeholder="Ingen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Ingen</SelectItem>
                      {metadataTypes.map(t => (
                        <SelectItem key={t.id} value={t.namn}>{t.namn} ({t.datatyp})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Metadata som skrivs tillbaka efter utförande</p>
                  {metadataLinkWarnings.leave && (
                    <p className="text-xs text-warning flex items-start gap-1" data-testid="warning-leave-metadata-link">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>{metadataLinkWarnings.leave}</span>
                    </p>
                  )}
                </div>
              </div>

              {formData.leaveMetadataCode && (
                <div className="space-y-2">
                  <Label>Lämna-format</Label>
                  <Select
                    value={formData.leaveMetadataFormat || "value"}
                    onValueChange={(v) => setFormData({ ...formData, leaveMetadataFormat: v })}
                  >
                    <SelectTrigger data-testid="select-leave-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="value">Värde (direkt input)</SelectItem>
                      <SelectItem value="timestamp">Tidsstämpel (automatisk)</SelectItem>
                      <SelectItem value="boolean_true">Flagga: Ja</SelectItem>
                      <SelectItem value="counter_increment">Räknare: +1</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Hur metadata-värdet skapas vid utförande</p>
                </div>
              )}

              <div className="border-t pt-4 mt-2">
                <p className="text-sm font-medium">Fält-etiketter (visning & uppdatering i fält)</p>
                <p className="text-xs text-muted-foreground">Etiketter som fältarbetaren ser och kan uppdatera vid utförande.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Hämta etikett (visa för fältarbetare)</Label>
                  <Select
                    value={formData.fetchMetadataLabel || "_none"}
                    onValueChange={(v) => setFormData({ ...formData, fetchMetadataLabel: v === "_none" ? "" : v })}
                  >
                    <SelectTrigger data-testid="select-fetch-metadata-label">
                      <SelectValue placeholder="Ingen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">Ingen</SelectItem>
                      {metadataLabels.map(ml => (
                        <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                          {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Visningsformat</Label>
                  <Select
                    value={formData.fetchMetadataLabelFormat || "text"}
                    onValueChange={(v) => setFormData({ ...formData, fetchMetadataLabelFormat: v })}
                    disabled={!formData.fetchMetadataLabel}
                  >
                    <SelectTrigger data-testid="select-fetch-label-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Fritext</SelectItem>
                      <SelectItem value="dropdown">Dropdown</SelectItem>
                      <SelectItem value="checkbox">Checkbox</SelectItem>
                      <SelectItem value="number">Nummer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.canUpdateMetadata}
                    onChange={(e) => setFormData({ ...formData, canUpdateMetadata: e.target.checked })}
                    className="rounded border-gray-300"
                    data-testid="checkbox-can-update-metadata"
                  />
                  <span className="text-sm">Fältarbetare kan uppdatera metadata</span>
                </label>
              </div>

              {formData.canUpdateMetadata && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Uppdatera etikett</Label>
                    <Select
                      value={formData.updateMetadataLabel || "_none"}
                      onValueChange={(v) => setFormData({ ...formData, updateMetadataLabel: v === "_none" ? "" : v })}
                    >
                      <SelectTrigger data-testid="select-update-metadata-label">
                        <SelectValue placeholder="Ingen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Samma som hämta-etikett</SelectItem>
                        {metadataLabels.map(ml => (
                          <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                            {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Uppdateringsformat</Label>
                    <Select
                      value={formData.updateMetadataFormat || "value"}
                      onValueChange={(v) => setFormData({ ...formData, updateMetadataFormat: v })}
                    >
                      <SelectTrigger data-testid="select-update-format">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="value">Värde (direkt input)</SelectItem>
                        <SelectItem value="ok_ej_ok">OK / EJ OK</SelectItem>
                        <SelectItem value="timestamp">Tidsstämpel (automatisk)</SelectItem>
                        <SelectItem value="counter_increment">Räknare: +1</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {formData.canUpdateMetadata && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.showPreviousValue}
                    onChange={(e) => setFormData({ ...formData, showPreviousValue: e.target.checked })}
                    className="rounded border-gray-300"
                    data-testid="checkbox-show-previous-value"
                  />
                  <span className="text-sm">Visa föregående värde för fältarbetare</span>
                </label>
              )}

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isInfoCarrier}
                    onChange={(e) => setFormData({ ...formData, isInfoCarrier: e.target.checked })}
                    className="rounded border-gray-300"
                    data-testid="checkbox-is-info-carrier"
                  />
                  <span className="text-sm">Blindartikel (informationsbärare)</span>
                </label>
                <HelpTooltip content="Blindartiklar visas som info-kort i fältappen utan utförande-steg" />
              </div>

              <div className="space-y-2">
                <Label>Begränsningstyp</Label>
                <Select
                  value={formData.limitationType || "unlimited"}
                  onValueChange={(v) => setFormData({ ...formData, limitationType: v })}
                >
                  <SelectTrigger data-testid="select-limitation-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unlimited">Obegränsad</SelectItem>
                    <SelectItem value="one_per_address">En gång per adress</SelectItem>
                    <SelectItem value="one_per_object">En gång per objekt</SelectItem>
                    <SelectItem value="one_per_customer">En gång per kund</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Styr hur ofta denna artikel får utföras</p>
              </div>

              </FormSection>
              <FormSection title="Association (tvåstegsfilter)" icon={<LinkIcon className="h-4 w-4" />} description="Haka fast artikeln på objekt vars metadata uppfyller ALLA villkor (OCH-logik)" testId="section-association">

              <div className="space-y-3">
                {metadataConditions.length === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-association-rules">
                    Inga villkor. Artikeln hakar inte fast automatiskt via metadata.
                  </p>
                )}

                {metadataConditions.map((cond, idx) => {
                  const needsValue = cond.operator !== "has_value";
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-3 rounded-md border bg-muted/30"
                      data-testid={`row-association-rule-${idx}`}
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">Metadatafält</Label>
                        <Select
                          value={cond.label || "_none"}
                          onValueChange={(v) => updateMetadataCondition(idx, { label: v === "_none" ? "" : v })}
                        >
                          <SelectTrigger data-testid={`select-association-label-${idx}`}>
                            <SelectValue placeholder="Välj fält" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">Välj fält</SelectItem>
                            {metadataLabels.map(ml => (
                              <SelectItem key={ml.id} value={ml.beteckning || ml.namn}>
                                {ml.beteckning ? `${ml.beteckning} — ${ml.namn}` : ml.namn}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Operator</Label>
                        <Select
                          value={cond.operator || "equals"}
                          onValueChange={(v) => updateMetadataCondition(idx, { operator: v as MetadataCondition["operator"] })}
                        >
                          <SelectTrigger data-testid={`select-association-operator-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="equals">Lika med</SelectItem>
                            <SelectItem value="greater">Större än</SelectItem>
                            <SelectItem value="less">Mindre än</SelectItem>
                            <SelectItem value="has_value">Fältet har ett värde</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Värde</Label>
                        <Input
                          value={cond.value ?? ""}
                          disabled={!needsValue}
                          onChange={(e) => updateMetadataCondition(idx, { value: e.target.value })}
                          placeholder={needsValue ? "t.ex. Matavfall, 240" : "—"}
                          data-testid={`input-association-value-${idx}`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeMetadataCondition(idx)}
                        data-testid={`btn-remove-association-rule-${idx}`}
                        aria-label="Ta bort villkor"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMetadataCondition}
                  data-testid="btn-add-association-rule"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Lägg till villkor
                </Button>

                <div className="space-y-2 pt-2">
                  <Label htmlFor="maxPerAddress">Max antal per adress</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="maxPerAddress"
                      type="number"
                      min={1}
                      placeholder="Obegränsat"
                      value={formData.maxPerAddress ?? ""}
                      onChange={(e) => setFormData({
                        ...formData,
                        maxPerAddress: e.target.value ? parseInt(e.target.value) : null,
                      })}
                      className="w-32"
                      data-testid="input-max-per-address"
                    />
                    <span className="text-xs text-muted-foreground">
                      {formData.maxPerAddress ? `Max ${formData.maxPerAddress} per adress` : "Ingen begränsning"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    T.ex. etablering = 1 per adress, tvätt = obegränsad
                  </p>
                </div>
              </div>

              </FormSection>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { resetForm(); setDialogOpen(false); }}
              >
                Avbryt
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending || articleNumberDuplicate}
                data-testid="button-submit-article"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingArticle ? "Spara ändringar" : "Skapa artikel"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort artikel?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort artikeln "{articleToDelete?.name}"?
              Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => articleToDelete && deleteMutation.mutate(articleToDelete.id)}
              className="bg-destructive/15 text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={testDialogOpen} onOpenChange={(open) => { 
        setTestDialogOpen(open); 
        if (!open) setSelectedObjectId(""); 
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Testa artikelfasthakning</DialogTitle>
            <DialogDescription>
              Välj ett objekt för att se vilka artiklar som gäller baserat på hierarkinivå och villkor
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Välj objekt att testa</Label>
              <Select value={selectedObjectId} onValueChange={setSelectedObjectId}>
                <SelectTrigger data-testid="select-test-object">
                  <SelectValue placeholder="Sök och välj objekt..." />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="h-[200px]">
                    {objects.map(obj => (
                      <SelectItem key={obj.id} value={obj.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{obj.hierarchyLevel || "fastighet"}</span>
                          <span>{obj.name}</span>
                          <span className="text-muted-foreground text-xs">({obj.objectType})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            {selectedObjectId && (
              <div className="space-y-3">
                {(() => {
                  const selectedObj = objects.find(o => o.id === selectedObjectId);
                  if (!selectedObj) return null;
                  return (
                    <Card className="bg-muted/30">
                      <CardContent className="pt-4">
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-muted-foreground">Namn:</span> {selectedObj.name}</div>
                          <div><span className="text-muted-foreground">Typ:</span> {selectedObj.objectType}</div>
                          <div><span className="text-muted-foreground">Hierarkinivå:</span> {selectedObj.hierarchyLevel || "Inte definierad"}</div>
                          <div><span className="text-muted-foreground">Accesskod:</span> {selectedObj.accessCode || "Ingen"}</div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-chart-2" />
                    Giltiga artiklar ({applicableArticles.length})
                  </Label>
                  {isLoadingApplicable ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : applicableArticles.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="pt-4 text-center text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Inga artiklar matchar detta objekt</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-2">
                        {applicableArticles.map(article => (
                          <Card key={article.id} className="p-3" data-testid={`card-applicable-article-${article.id}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">{article.articleNumber}</span>
                                  <span className="font-medium">{article.name}</span>
                                </div>
                                {article.hookLevel && (
                                  <Badge variant="outline" className="mt-1">
                                    {hookLevelLabels[article.hookLevel] || article.hookLevel}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-right text-sm">
                                <div>{formatPrice(article.listPrice)}</div>
                                <div className="text-muted-foreground">{formatTime(article.productionTime)}</div>
                              </div>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              Stäng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
