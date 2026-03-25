import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTerminology } from "@/hooks/use-terminology";
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
};

export default function ArticlesPage() {
  const { toast } = useToast();
  const { t } = useTerminology();
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
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [assocTestResult, setAssocTestResult] = useState<{ matchCount: number; matches: Array<{ objectId: string; objectName: string; objectAddress: string; metadataValue: string | null }>; labelFound: boolean; labelName?: string } | null>(null);
  const [assocTestLoading, setAssocTestLoading] = useState(false);
  const ITEMS_PER_PAGE = 25;

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: metadataTypes = [] } = useQuery<{ id: string; namn: string; datatyp: string }[]>({
    queryKey: ["/api/metadata/types"],
  });

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
      toast({ title: "Fel", description: error.message, variant: "destructive" });
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
      toast({ title: "Fel", description: error.message, variant: "destructive" });
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
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData(emptyFormData);
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
      fetchMetadataCode: (article as any).fetchMetadataCode || "",
      leaveMetadataCode: (article as any).leaveMetadataCode || "",
      leaveMetadataFormat: (article as any).leaveMetadataFormat || "",
      maxPerAddress: (article as any).maxPerAddress ?? null,
      associationLabel: (article as any).associationLabel || "",
      associationValue: (article as any).associationValue || "",
      associationOperator: (article as any).associationOperator || "equals",
    });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">{t("article_plural")}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground">
                Produkter och tjänster som kan läggas på ordrar
              </span>
              {quickStats.topTypes.map(([label, count]) => (
                <Badge key={label} variant="secondary" className="text-xs font-normal" data-testid={`badge-stat-type-${label}`}>
                  {count} {label}
                </Badge>
              ))}
              {quickStats.activeCount > 0 && (
                <Badge variant="outline" className="text-xs font-normal gap-1 text-green-600 border-green-300">
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
          </div>
          <Button onClick={openCreateDialog} data-testid="button-create-article">
            <Plus className="h-4 w-4 mr-2" />
            Ny artikel
          </Button>
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
                <div className="space-y-2">
                  <Label htmlFor="cost">Kostnad (öre)</Label>
                  <Input
                    id="cost"
                    type="number"
                    min="0"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: parseInt(e.target.value) || 0 })}
                    data-testid="input-cost"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="listPrice">Listpris (öre)</Label>
                  <Input
                    id="listPrice"
                    type="number"
                    min="0"
                    value={formData.listPrice}
                    onChange={(e) => setFormData({ ...formData, listPrice: parseInt(e.target.value) || 0 })}
                    data-testid="input-list-price"
                  />
                </div>
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
                    onValueChange={(v) => setFormData({ ...formData, fetchMetadataCode: v === "_none" ? "" : v })}
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
                </div>
                <div className="space-y-2">
                  <Label>Lämna metadata (leaveMetadataCode)</Label>
                  <Select
                    value={formData.leaveMetadataCode || "_none"}
                    onValueChange={(v) => setFormData({ ...formData, leaveMetadataCode: v === "_none" ? "" : v })}
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
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
