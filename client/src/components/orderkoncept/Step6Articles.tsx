import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Trash2, Package, Info, ClipboardList, Truck, Briefcase } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Article, TaskCategory } from "@shared/schema";
import { TASK_CATEGORY_LABELS, TASK_CATEGORIES } from "@shared/schema";

type QuantityMode = "use_object_quantity" | "single_per_task";

interface ConceptArticle {
  id: string;
  articleId: string;
  quantity: number;
  unitPrice: number | null;
  priceOverride: boolean;
  quantityModeOverride?: string | null;
  taskCategory?: TaskCategory | null;
  article?: Article;
}

interface Step6Props {
  conceptArticles: ConceptArticle[];
  onAddArticle: (articleId: string, quantity: number, unitPrice: number | null, taskCategory: TaskCategory) => void;
  onRemoveArticle: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onUpdateQuantityMode?: (id: string, mode: QuantityMode | null) => void;
}

const CATEGORY_ICONS: Record<TaskCategory, typeof Briefcase> = {
  field: Briefcase,
  admin: ClipboardList,
  logistics: Truck,
};

export default function Step6Articles({
  conceptArticles,
  onAddArticle,
  onRemoveArticle,
  onUpdateQuantity,
  onUpdateQuantityMode,
}: Step6Props) {
  const [search, setSearch] = useState("");
  const [pendingCategory, setPendingCategory] = useState<TaskCategory>("field");

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const filteredArticles = useMemo(() => {
    if (!search) return articles.slice(0, 15);
    const q = search.toLowerCase();
    return articles.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.articleNumber && a.articleNumber.toLowerCase().includes(q))
    ).slice(0, 15);
  }, [articles, search]);

  const addedArticleIds = new Set(conceptArticles.map(ca => ca.articleId));

  const enrichedArticles = useMemo(() => {
    return conceptArticles.map(ca => ({
      ...ca,
      article: articles.find(a => a.id === ca.articleId),
    }));
  }, [conceptArticles, articles]);

  const totalValue = enrichedArticles.reduce((sum, ca) => {
    const price = ca.unitPrice ?? ca.article?.listPrice ?? 0;
    return sum + price * (ca.quantity || 1);
  }, 0);

  return (
    <div className="space-y-4" data-testid="step6-articles">
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2">
          <div>
            <label className="text-sm font-medium mb-1 block">Sök artikel</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök på artikelnamn eller nummer..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-article-search"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Uppgiftstyp för nästa artikel</label>
            <Select value={pendingCategory} onValueChange={(v) => setPendingCategory(v as TaskCategory)}>
              <SelectTrigger data-testid="select-task-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_CATEGORIES.map(c => {
                  const Icon = CATEGORY_ICONS[c];
                  return (
                    <SelectItem key={c} value={c} data-testid={`option-task-category-${c}`}>
                      <span className="inline-flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" />
                        {TASK_CATEGORY_LABELS[c]}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Administrativa/logistik-uppgifter skapas utan koppling till objekt och hoppas över i ruttoptimering.
            </p>
          </div>
        </div>
        {filteredArticles.length > 0 && (
          <div className="border rounded-md mt-1 max-h-60 overflow-y-auto bg-popover">
            {filteredArticles.map(article => (
              <div
                key={article.id}
                className="flex items-center justify-between px-3 py-2 hover:bg-accent text-sm"
              >
                <div>
                  <span className="font-medium">{article.name}</span>
                  {article.articleNumber && (
                    <span className="text-xs text-muted-foreground ml-2">({article.articleNumber})</span>
                  )}
                  {article.listPrice != null && (
                    <span className="text-xs text-muted-foreground ml-2">{article.listPrice} kr</span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={addedArticleIds.has(article.id)}
                  onClick={() => {
                    onAddArticle(article.id, 1, null, pendingCategory);
                    setSearch("");
                  }}
                  data-testid={`button-add-article-${article.id}`}
                >
                  {addedArticleIds.has(article.id) ? (
                    <span className="text-xs">Tillagd</span>
                  ) : (
                    <><Plus className="h-4 w-4 mr-1" /> Lägg till</>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Valda artiklar ({enrichedArticles.length})</h3>
          <span className="text-sm text-muted-foreground">
            Totalt: {totalValue.toLocaleString("sv-SE")} kr
          </span>
        </div>
        <ScrollArea className="h-[350px] border rounded-md">
          {enrichedArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Package className="h-8 w-8" />
              <p className="text-sm">Inga artiklar tillagda. Sök och lägg till artiklar ovan.</p>
            </div>
          ) : (
            <div className="divide-y">
              {enrichedArticles.map(ca => {
                const price = ca.unitPrice ?? ca.article?.listPrice ?? 0;
                const lineTotal = price * (ca.quantity || 1);
                const articleMode = (ca.article?.quantityMode as QuantityMode | null | undefined) || "use_object_quantity";
                const effectiveMode: QuantityMode = (ca.quantityModeOverride as QuantityMode | null) || articleMode;
                const selectValue = ca.quantityModeOverride ? `override:${ca.quantityModeOverride}` : "default";
                const cat: TaskCategory = (ca.taskCategory as TaskCategory) || "field";
                const CatIcon = CATEGORY_ICONS[cat];
                return (
                  <div key={ca.id} className="p-3 space-y-2" data-testid={`article-row-${ca.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate flex items-center gap-2">
                          {ca.article?.name || "Okänd artikel"}
                          {cat !== "field" && (
                            <Badge variant="outline" className="gap-1" data-testid={`badge-category-${ca.id}`}>
                              <CatIcon className="h-3 w-3" />
                              {TASK_CATEGORY_LABELS[cat]}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {ca.article?.articleNumber && <span>{ca.article.articleNumber}</span>}
                          <span>{price} kr/st</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          value={ca.quantity}
                          onChange={(e) => onUpdateQuantity(ca.id, parseInt(e.target.value) || 1)}
                          className="w-20 h-8 text-sm"
                          data-testid={`input-quantity-${ca.id}`}
                        />
                        <Badge variant="secondary" className="whitespace-nowrap">
                          {lineTotal.toLocaleString("sv-SE")} kr
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onRemoveArticle(ca.id)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          data-testid={`button-remove-article-${ca.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {onUpdateQuantityMode && (
                      <div className="flex items-center gap-2 pl-1 text-xs">
                        <span className="text-muted-foreground whitespace-nowrap">Kvantitetsläge:</span>
                        <Select
                          value={selectValue}
                          onValueChange={(v) => {
                            if (v === "default") onUpdateQuantityMode(ca.id, null);
                            else if (v === "override:single_per_task") onUpdateQuantityMode(ca.id, "single_per_task");
                            else if (v === "override:use_object_quantity") onUpdateQuantityMode(ca.id, "use_object_quantity");
                          }}
                        >
                          <SelectTrigger className="h-7 w-[260px] text-xs" data-testid={`select-quantity-mode-${ca.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">
                              Använd artikelns standard ({articleMode === "single_per_task" ? "En per uppdrag" : "Multiplicera med objektets antal"})
                            </SelectItem>
                            <SelectItem value="override:use_object_quantity">Tvinga: Multiplicera med objektets antal</SelectItem>
                            <SelectItem value="override:single_per_task">Tvinga: En per uppdrag</SelectItem>
                          </SelectContent>
                        </Select>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">
                              <p><strong>Multiplicera med objektets antal:</strong> kvantiteten hämtas från objektets metadata (t.ex. antal kärl eller m²). Pris och tid skalar därefter.</p>
                              <p className="mt-1"><strong>En per uppdrag:</strong> sätter alltid 1 oavsett objektets antal — passar fotodokumentation, telefonavisering, nyckelhämtning och liknande.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {effectiveMode === "single_per_task" && (
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">1 per uppdrag</Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
