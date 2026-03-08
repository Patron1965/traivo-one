import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Trash2, Package } from "lucide-react";
import type { Article } from "@shared/schema";

interface ConceptArticle {
  id: string;
  articleId: string;
  quantity: number;
  unitPrice: number | null;
  priceOverride: boolean;
  article?: Article;
}

interface Step6Props {
  conceptArticles: ConceptArticle[];
  onAddArticle: (articleId: string, quantity: number, unitPrice: number | null) => void;
  onRemoveArticle: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
}

export default function Step6Articles({
  conceptArticles,
  onAddArticle,
  onRemoveArticle,
  onUpdateQuantity,
}: Step6Props) {
  const [search, setSearch] = useState("");

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const filteredArticles = useMemo(() => {
    if (!search) return [];
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
        {search && filteredArticles.length > 0 && (
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
                    onAddArticle(article.id, 1, null);
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
                return (
                  <div key={ca.id} className="flex items-center gap-3 p-3" data-testid={`article-row-${ca.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {ca.article?.name || "Okänd artikel"}
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
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
