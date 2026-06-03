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
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Article, ServiceObject } from "@shared/schema";
import { QueryState } from "@/components/QueryState";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { HelpTooltip, PageHelp } from "@/components/ui/help-tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

const articleTypeOptions = [
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

const articleTypeLabels: Record<string, string> = Object.fromEntries(
  articleTypeOptions.map(t => [t.value, t.label])
);

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
  fetchMetadataLabel: string;
  fetchMetadataLabelFormat: string;
  canUpdateMetadata: boolean;
  updateMetadataLabel: string;
  updateMetadataFormat: string;
  showPreviousValue: boolean;
  isInfoCarrier: boolean;
  limitationType: string;
  quantityMode: string;
  offsetMinutes: number;
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
  status: "active",
  fetchMetadataCode: "",
  leaveMetadataCode: "",
  leaveMetadataFormat: "",
  maxPerAddress: null,
  associationLabel: "",
  associationValue: "",
  associationOperator: "equals",
  fetchMetadataLabel: "",
  fetchMetadataLabelFormat: "",
  canUpdateMetadata: false,
  updateMetadataLabel: "",
  updateMetadataFormat: "",
  showPreviousValue: false,
  isInfoCarrier: false,
  limitationType: "unlimited",
  quantityMode: "use_object_quantity",
  offsetMinutes: 0,
};

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
  const [offsetMinutesInput, setOffsetMinutesInput] = useState<string>("0");
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [assocTestResult, setAssocTestResult] = useState<{ matchCount: number; matches: Array<{ objectId: string; objectName: string; objectAddress: string; metadataValue: string | null }>; labelFound: boolean; labelName?: string } | null>(null);
  const [assocTestLoading, setAssocTestLoading] = useState(false);
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

  const createMutation = useMutation({
    mutationFn: async (data: Partial<ArticleFormData>) => {
      return apiRequest("POST", "/api/articles", data);
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
      return apiRequest("PATCH", `/api/articles/${id}`, data);
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
    setOffsetMinutesInput("0");
    setEditingArticle(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (article: Article) => {
    setEditingArticle(article);
    setFormData({
      articleNumber: article.articleNumber,
      name: article.name,
      description: article.description || "",
      articleType: article.articleType,
      hookLevel: article.hookLevel || "",
      hookConditions: (article.hookConditions as HookConditions) || {},
      objectTypes: article.objectTypes || [],
      productionTime: article.productionTime || 15,
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
      fetchMetadataLabel: article.fetchMetadataLabel || "",
      fetchMetadataLabelFormat: article.fetchMetadataLabelFormat || "",
      canUpdateMetadata: article.canUpdateMetadata || false,
      updateMetadataLabel: article.updateMetadataLabel || "",
      updateMetadataFormat: article.updateMetadataFormat || "",
      showPreviousValue: article.showPreviousValue || false,
      isInfoCarrier: article.isInfoCarrier || false,
      limitationType: article.limitationType || "unlimited",
      quantityMode: article.quantityMode || "use_object_quantity",
      offsetMinutes: article.offsetMinutes ?? 0,
    });
    setOffsetMinutesInput(String(article.offsetMinutes ?? 0));
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingArticle) {
      updateMutation.mutate({ id: editingArticle.id, data: formData });
    } else {
      createMutation.mutate(formData);
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
      
      return matchesSearch && matchesType && matchesObjectType && matchesHookLevel;
    });
  }, [articles, searchQuery, typeFilter, objectTypeFilter, hookLevelFilter]);

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
                        <div className="font-medium">{article.name}</div>
                        {article.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                            {article.description}
                          </div>
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
                      <Badge variant={article.status === "active" ? "default" : "outline"}>
                        {article.status === "active" ? "Aktiv" : "Inaktiv"}
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="articleNumber">Artikelnummer</Label>
                  <Input
                    id="articleNumber"
                    value={formData.articleNumber}
                    onChange={(e) => setFormData({ ...formData, articleNumber: e.target.value })}
                    placeholder="ART-001"
                    required
                    data-testid="input-article-number"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="articleType">Artikeltyp</Label>
                  <Select
                    value={formData.articleType}
                    onValueChange={(value) => setFormData({ ...formData, articleType: value })}
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
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hookLevel" className="flex items-center gap-1">
                  Fasthakning
                  <HelpTooltip content="Fasthakning bestämmer på vilken nivå artikeln automatiskt föreslås. Välj t.ex. 'Objekt' för att artikeln ska föreslås på alla objekt." />
                </Label>
                <Select
                  value={formData.hookLevel}
                  onValueChange={(value) => setFormData({ ...formData, hookLevel: value, hookConditions: {} })}
                >
                  <SelectTrigger data-testid="select-hook-level">
                    <SelectValue placeholder="Välj nivå" />
                  </SelectTrigger>
                  <SelectContent>
                    {hookLevelOptions.map(level => (
                      <SelectItem key={level.value} value={level.value}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Bestämmer på vilken hierarkinivå artikeln hakar fast och genererar ordrar
                </p>
              </div>

              {formData.hookLevel && formData.hookLevel.startsWith("karl") && (
                <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                  <Label className="text-sm font-medium">Villkor för fasthakning</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="containerType" className="text-sm">Objekttyp</Label>
                      <Select
                        value={formData.hookConditions.container_type || "all"}
                        onValueChange={(value) => setFormData({
                          ...formData,
                          hookConditions: { ...formData.hookConditions, container_type: value === "all" ? undefined : value }
                        })}
                      >
                        <SelectTrigger data-testid="select-container-type-condition">
                          <SelectValue placeholder="Alla kärltyper" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alla kärltyper</SelectItem>
                          <SelectItem value="matavfall">Matavfall</SelectItem>
                          <SelectItem value="restavfall">Restavfall</SelectItem>
                          <SelectItem value="plastemballage">Plast</SelectItem>
                          <SelectItem value="atervinning">Återvinning</SelectItem>
                          <SelectItem value="uj_hushallsavfall">UJ Hushållsavfall</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minVolume" className="text-sm">Min volym (L)</Label>
                      <Input
                        id="minVolume"
                        type="number"
                        min="0"
                        placeholder="Ingen gräns"
                        value={formData.hookConditions.min_volume || ""}
                        onChange={(e) => setFormData({
                          ...formData,
                          hookConditions: { 
                            ...formData.hookConditions, 
                            min_volume: e.target.value ? parseInt(e.target.value) : undefined 
                          }
                        })}
                        data-testid="input-min-volume"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formData.hookLevel === "kod" && (
                <div className="space-y-2 p-3 rounded-md border bg-muted/30">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="requiresAccessCode"
                      checked={formData.hookConditions.requires_access_code || false}
                      onChange={(e) => setFormData({
                        ...formData,
                        hookConditions: { ...formData.hookConditions, requires_access_code: e.target.checked }
                      })}
                      className="rounded"
                      data-testid="checkbox-requires-access-code"
                    />
                    <Label htmlFor="requiresAccessCode" className="text-sm cursor-pointer">
                      Kräver att objektet har en accesskod
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Artikeln kommer endast att gälla för objekt som har en registrerad accesskod (t.ex. portkod)
                  </p>
                </div>
              )}

              {formData.hookLevel && formData.hookLevel !== "" && (
                <div className="space-y-2 p-3 rounded-md border bg-muted/30">
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
                        maxPerAddress: e.target.value ? parseInt(e.target.value) : null 
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
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Namn</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Kärltömning 240L"
                  required
                  data-testid="input-article-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Beskrivning</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Beskriv artikeln..."
                  rows={3}
                  data-testid="input-article-description"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
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
                {isAdmin && (
                  <div className="space-y-2">
                    <Label htmlFor="cost">Kostnad (kr)</Label>
                    <Input
                      id="cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.cost ? (formData.cost / 100).toString() : ""}
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
                    <SelectItem value="use_object_quantity">Multiplicera med objektets antal (standard)</SelectItem>
                    <SelectItem value="single_per_task">En per uppdrag (alltid 1)</SelectItem>
                    <SelectItem value="configurable">Konfigurerbar per orderkoncept</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Avgör om artikelns pris/tid multipliceras med objektets antal (t.ex. 45 kärl × 150 kr) eller alltid räknas som 1 per uppdrag (t.ex. fotodokumentation, telefonavisering, nyckelhämtning).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="offsetMinutes">Offsettid (minuter relativt huvudjobb)</Label>
                <Input
                  id="offsetMinutes"
                  type="number"
                  step="1"
                  value={offsetMinutesInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setOffsetMinutesInput(raw);
                    if (raw === "" || raw === "-") return;
                    const parsed = parseInt(raw, 10);
                    if (!Number.isNaN(parsed)) {
                      setFormData(prev => ({ ...prev, offsetMinutes: parsed }));
                    }
                  }}
                  onBlur={() => {
                    const parsed = parseInt(offsetMinutesInput, 10);
                    const normalized = Number.isNaN(parsed) ? 0 : parsed;
                    setFormData(prev => ({ ...prev, offsetMinutes: normalized }));
                    setOffsetMinutesInput(String(normalized));
                  }}
                  data-testid="input-offset-minutes"
                />
                <p className="text-xs text-muted-foreground">
                  Negativt värde = utförs <strong>före</strong> huvudjobbet (t.ex. -120 = telefonavisering 2 timmar innan, -2400 = nyckelhämtning 40 timmar innan). 0 = samtidigt med huvudjobbet. Positivt = efter. När orderkonceptet expanderas skapas en separat förberedande uppgift kopplad till huvudjobbet.
                </p>
              </div>

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
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger data-testid="select-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktiv</SelectItem>
                      <SelectItem value="inactive">Inaktiv</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Metadata-koppling
                </h4>
                <p className="text-xs text-muted-foreground">
                  Koppla artikeln till metadata som hämtas/lämnas vid utförande
                </p>
              </div>

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

              <Separator />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Etikett-koppling (Kinab)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Koppla artikeln till metadata-etiketter för hämtning/uppdatering i fält
                </p>
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
                      <SelectItem value="ok_ej_ok">OK / EJ OK</SelectItem>
                      <SelectItem value="number">Numeriskt</SelectItem>
                      <SelectItem value="date">Datum</SelectItem>
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

              <Separator />
              <div className="space-y-1">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  Association (tvåstegsfilter)
                </h4>
                <p className="text-xs text-muted-foreground">
                  Koppla artikeln till objekt via metadata-etikett och värde
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Etikett (beteckning)</Label>
                  <Select
                    value={formData.associationLabel || "_none"}
                    onValueChange={(v) => {
                      setFormData({ ...formData, associationLabel: v === "_none" ? "" : v });
                      setAssocTestResult(null);
                    }}
                  >
                    <SelectTrigger data-testid="select-association-label">
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
                  <Label>Värde att matcha</Label>
                  <Input
                    value={formData.associationValue}
                    onChange={(e) => {
                      setFormData({ ...formData, associationValue: e.target.value });
                      setAssocTestResult(null);
                    }}
                    placeholder="t.ex. Ja, Matavfall"
                    data-testid="input-association-value"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Operator</Label>
                  <Select
                    value={formData.associationOperator || "equals"}
                    onValueChange={(v) => {
                      setFormData({ ...formData, associationOperator: v });
                      setAssocTestResult(null);
                    }}
                  >
                    <SelectTrigger data-testid="select-association-operator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Lika med</SelectItem>
                      <SelectItem value="contains">Innehåller</SelectItem>
                      <SelectItem value="starts_with">Börjar med</SelectItem>
                      <SelectItem value="not_equals">Inte lika med</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.associationLabel && formData.associationValue && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestAssociation}
                    disabled={assocTestLoading}
                    data-testid="btn-test-association"
                  >
                    {assocTestLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Beaker className="h-4 w-4 mr-1" />}
                    Testa koppling
                  </Button>

                  {assocTestResult && (
                    <div className="rounded-md border p-3 text-sm space-y-2">
                      {!assocTestResult.labelFound ? (
                        <p className="text-destructive">Etiketten hittades inte i metadata-katalogen.</p>
                      ) : (
                        <>
                          <p className="font-medium">
                            {assocTestResult.matchCount} objekt matchar
                            {assocTestResult.labelName && <span className="text-muted-foreground ml-1">({assocTestResult.labelName})</span>}
                          </p>
                          {assocTestResult.matches.length > 0 && (
                            <div className="max-h-32 overflow-y-auto space-y-1">
                              {assocTestResult.matches.map((m) => (
                                <div key={m.objectId} className="flex items-center gap-2 text-xs">
                                  <Badge variant="outline" className="font-mono text-xs">{m.metadataValue}</Badge>
                                  <span>{m.objectName}</span>
                                  {m.objectAddress && <span className="text-muted-foreground">— {m.objectAddress}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <Label>Objekttyper (vad artikeln kan utföras på)</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-md border bg-muted/30">
                  {objectTypeOptions.filter(t => t.value !== "all").map(type => (
                    <Badge
                      key={type.value}
                      variant={formData.objectTypes.includes(type.value) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => {
                        const newTypes = formData.objectTypes.includes(type.value)
                          ? formData.objectTypes.filter(t => t !== type.value)
                          : [...formData.objectTypes, type.value];
                        setFormData({ ...formData, objectTypes: newTypes });
                      }}
                      data-testid={`badge-object-type-${type.value}`}
                    >
                      {type.label}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Klicka för att välja/avmarkera objekttyper
                </p>
              </div>
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
                disabled={createMutation.isPending || updateMutation.isPending}
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
