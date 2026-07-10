import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
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
import { ConditionFilterList, type ConditionField } from "@/components/orderkoncept/shared/ConditionFilter";
import { applyConditionFilters, CONDITION_OPERATORS, type ConditionFilter } from "@shared/condition-matching";
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
  internalDescription: string;
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
  leaveMetadataRequired: boolean;
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
  operatorCanUpdateQuantity: boolean;
  freeMetadataUpdate: boolean;
  quantityMetadataField: string;
  quantityUnit: string;
  groupSize: number;
  offsetMinutes: number;
  leadTimeDays: number | null;
  requiresAcknowledgment: boolean;
  dependencyCriticality: string;
  isStructure: boolean;
  isComponent: boolean;
  isGeoDependent: boolean;
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
  internalDescription: "",
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
  leaveMetadataRequired: false,
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
  operatorCanUpdateQuantity: false,
  freeMetadataUpdate: false,
  quantityMetadataField: "",
  quantityUnit: "",
  groupSize: 1,
  offsetMinutes: 0,
  leadTimeDays: null,
  requiresAcknowledgment: false,
  dependencyCriticality: "critical",
  isStructure: false,
  isComponent: false,
  isGeoDependent: true,
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
  const [, navigate] = useLocation();
  const { t } = useTerminology();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [conditionFilters, setConditionFilters] = useState<ConditionFilter[]>([]);
  const [hookLevelFilter, setHookLevelFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "hooks">("list");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [articleToDelete, setArticleToDelete] = useState<Article | null>(null);
  const [showDiscontinued, setShowDiscontinued] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 25;

  const { data: articles = [], isLoading, isError, error: articlesError, refetch: refetchArticles } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", "lookup"],
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



  const { data: applicableArticles = [], isLoading: isLoadingApplicable } = useQuery<Article[]>({
    queryKey: ["/api/objects", selectedObjectId, "applicable-articles"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${selectedObjectId}/applicable-articles`);
      if (!res.ok) throw new Error("Failed to fetch applicable articles");
      return res.json();
    },
    enabled: !!selectedObjectId && testDialogOpen,
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


  // Task #940: villkorsfält för artikellistan = distinkta metadata-labels från
  // artiklarnas matchningsregler (associationRules, source="metadata") + legacy
  // associationLabel. Artiklar bär MATCHNINGSREGLER (svensk katalog-label), inte
  // metadatavärden — därför härleds fälten från reglerna, inte metadatadefinitioner.
  const articleConditionFields = useMemo<ConditionField[]>(() => {
    const labels = new Set<string>();
    for (const a of articles) {
      for (const r of ((a.associationRules ?? []) as AssociationCondition[])) {
        if (r.source === "metadata" && r.label) labels.add(r.label);
      }
      if (a.associationLabel) labels.add(a.associationLabel);
    }
    return Array.from(labels).sort((x, y) => x.localeCompare(y, "sv")).map(l => ({ value: l, label: l }));
  }, [articles]);

  // Resolverar en artikels regel-värde för en given katalog-label (villkorets metadataKey).
  const getArticleMatchValue = (article: Article, label: string): unknown => {
    for (const r of ((article.associationRules ?? []) as AssociationCondition[])) {
      if (r.source === "metadata" && r.label === label) return r.value ?? "";
    }
    if (article.associationLabel === label) return article.associationValue ?? "";
    return undefined;
  };

  const activeConditions = useMemo(() => conditionFilters.filter(f => f.metadataKey), [conditionFilters]);

  const filteredArticles = useMemo(() => {
    const base = articles.filter(article => {
      const matchesSearch = 
        article.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        article.articleNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (article.description?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesType = typeFilter === "all" || article.articleType === typeFilter;
      
      const matchesHookLevel = hookLevelFilter === "all" || 
        (hookLevelFilter === "none" ? !article.hookLevel : article.hookLevel === hookLevelFilter);

      const matchesStatus = showDiscontinued || article.status !== "utgått";

      return matchesSearch && matchesType && matchesHookLevel && matchesStatus;
    });
    // Delad matchning (samma som orderkoncept-förhandsvisningen).
    return applyConditionFilters(base, conditionFilters, getArticleMatchValue);
  }, [articles, searchQuery, typeFilter, conditionFilters, hookLevelFilter, showDiscontinued]);

  const totalPages = Math.max(1, Math.ceil(filteredArticles.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedArticles = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    return filteredArticles.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredArticles, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, typeFilter, conditionFilters, hookLevelFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages]);

  const activeFilterCount = [
    typeFilter !== "all" ? 1 : 0,
    activeConditions.length,
    hookLevelFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearAllFilters = () => {
    setTypeFilter("all");
    setConditionFilters([]);
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
          <Button onClick={() => navigate("/articles/new")} data-testid="button-create-article">
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
            {conditionFilters.map((f, i) => f.metadataKey ? (
              <Badge key={`cond-${i}`} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setConditionFilters(conditionFilters.filter((_, idx) => idx !== i))} data-testid={`badge-filter-condition-${i}`}>
                {f.metadataKey}
                {" "}{(CONDITION_OPERATORS.find(o => o.value === f.operator)?.label ?? f.operator)}
                {CONDITION_OPERATORS.find(o => o.value === f.operator)?.noValue ? "" : ` ${String(f.filterValue ?? "")}`}
                <X className="h-3 w-3" />
              </Badge>
            ) : null)}
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
            <div className="w-full space-y-2">
              <Label className="text-sm flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" /> Villkorsfilter (matchningsregler)
              </Label>
              <p className="text-xs text-muted-foreground">
                Matcha artiklar på deras matchningsregler — samma matchning som orderkoncept-förhandsvisningen.
              </p>
              <ConditionFilterList
                filters={conditionFilters}
                fields={articleConditionFields}
                onChange={setConditionFilters}
                fieldPlaceholder="Matchningsfält"
                emptyText="Inga villkor — alla artiklar visas."
                addTestId="button-add-condition-article"
              />
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
          <Button onClick={() => navigate("/articles/new")} data-testid="button-create-article-empty">
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
                          onClick={() => navigate(`/articles/${article.id}/edit`)}
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
                        onClick={() => navigate(`/articles/${article.id}/edit`)}
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
                              onClick={() => navigate(`/articles/${article.id}/edit`)}
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
