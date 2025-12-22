import { useState, useMemo } from "react";
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
  Filter,
  Clock,
  DollarSign,
  Package,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Article } from "@shared/schema";

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

interface ArticleFormData {
  articleNumber: string;
  name: string;
  description: string;
  articleType: string;
  objectTypes: string[];
  productionTime: number;
  cost: number;
  listPrice: number;
  unit: string;
  status: string;
}

const emptyFormData: ArticleFormData = {
  articleNumber: "",
  name: "",
  description: "",
  articleType: "tjanst",
  objectTypes: [],
  productionTime: 15,
  cost: 0,
  listPrice: 0,
  unit: "st",
  status: "active",
};

export default function ArticlesPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [objectTypeFilter, setObjectTypeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [articleToDelete, setArticleToDelete] = useState<Article | null>(null);
  const [formData, setFormData] = useState<ArticleFormData>(emptyFormData);
  const [showFilters, setShowFilters] = useState(false);

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
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
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa artikeln.", variant: "destructive" });
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
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte uppdatera artikeln.", variant: "destructive" });
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
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort artikeln.", variant: "destructive" });
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
      objectTypes: article.objectTypes || [],
      productionTime: article.productionTime || 15,
      cost: article.cost || 0,
      listPrice: article.listPrice || 0,
      unit: article.unit || "st",
      status: article.status || "active",
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
      
      return matchesSearch && matchesType && matchesObjectType;
    });
  }, [articles, searchQuery, typeFilter, objectTypeFilter]);

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
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Artiklar</h1>
            <p className="text-muted-foreground">
              Hantera artiklar, tjänster och produkter
            </p>
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
              placeholder="Sök artikel..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-article"
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
          </div>
        )}
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <CardTitle className="text-lg">
            {filteredArticles.length} artiklar
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artikelnr</TableHead>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
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
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Inga artiklar hittades</p>
                    {searchQuery && <p className="text-sm">Prova att ändra sökningen</p>}
                  </TableCell>
                </TableRow>
              ) : (
                filteredArticles.map((article) => (
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
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(article)}
                          data-testid={`button-edit-article-${article.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setArticleToDelete(article);
                            setDeleteDialogOpen(true);
                          }}
                          data-testid={`button-delete-article-${article.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
    </div>
  );
}
