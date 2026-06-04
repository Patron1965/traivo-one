import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Trash2, Package, MapPin } from "lucide-react";
import type { Article, MetadataDefinition, TaskCategory } from "@shared/schema";
import { TASK_CATEGORY_LABELS, TASK_CATEGORIES } from "@shared/schema";

export interface ConceptArticleRow {
  id: string;
  articleId: string;
  quantity: number;
  unitPrice: number | null;
  taskCategory?: TaskCategory | null;
  metadataAssociation?: string | null;
  metadataCorrespondence?: string | null;
  isPreTask?: boolean | null;
  dependencyOffsetMinutes?: number | null;
}

interface Step6Props {
  conceptArticles: ConceptArticleRow[];
  articles: Article[];
  onAddArticle: (articleId: string, quantity: number, unitPrice: number | null, taskCategory: TaskCategory) => void;
  onRemoveArticle: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onUpdateArticleField: (id: string, patch: Partial<ConceptArticleRow>) => void;
}

const NONE = "__none__";

export default function Step6Tasks({
  conceptArticles,
  articles,
  onAddArticle,
  onRemoveArticle,
  onUpdateQuantity,
  onUpdateArticleField,
}: Step6Props) {
  const [search, setSearch] = useState("");
  const [pendingCategory, setPendingCategory] = useState<TaskCategory>("field");
  const { data: definitions = [] } = useQuery<MetadataDefinition[]>({ queryKey: ["/api/metadata-definitions"] });

  const filteredArticles = useMemo(() => {
    if (!search) return articles.slice(0, 15);
    const q = search.toLowerCase();
    return articles
      .filter((a) => a.name.toLowerCase().includes(q) || (a.articleNumber && a.articleNumber.toLowerCase().includes(q)))
      .slice(0, 15);
  }, [articles, search]);

  const addedIds = new Set(conceptArticles.map((ca) => ca.articleId));

  const rows = useMemo(
    () => conceptArticles.map((ca) => ({ ...ca, article: articles.find((a) => a.id === ca.articleId) })),
    [conceptArticles, articles],
  );

  return (
    <div className="space-y-4" data-testid="step6-tasks">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2">
        <div>
          <Label className="text-sm font-medium mb-1 block">Sök artikel/uppgift</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Sök på namn eller nummer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-article-search" />
          </div>
        </div>
        <div>
          <Label className="text-sm font-medium mb-1 block">Uppgiftstyp</Label>
          <Select value={pendingCategory} onValueChange={(v) => setPendingCategory(v as TaskCategory)}>
            <SelectTrigger data-testid="select-task-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TASK_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{TASK_CATEGORY_LABELS[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filteredArticles.length > 0 && (
        <div className="border rounded-md max-h-60 overflow-y-auto bg-popover">
          {filteredArticles.map((article) => (
            <div key={article.id} className="flex items-center justify-between px-3 py-2 hover:bg-accent text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{article.name}</span>
                {article.articleNumber && <span className="text-xs text-muted-foreground">({article.articleNumber})</span>}
                {article.isGeotagged && (
                  <Badge variant="outline" className="gap-1 text-[10px]"><MapPin className="h-3 w-3" /> Geotaggad</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={addedIds.has(article.id)}
                onClick={() => { onAddArticle(article.id, 1, null, pendingCategory); setSearch(""); }}
                data-testid={`button-add-article-${article.id}`}
              >
                {addedIds.has(article.id) ? <span className="text-xs">Tillagd</span> : <><Plus className="h-4 w-4 mr-1" /> Lägg till</>}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium mb-2">Valda uppgifter ({rows.length})</h3>
        <ScrollArea className="h-[400px] border rounded-md">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <Package className="h-8 w-8" />
              <p className="text-sm">Inga uppgifter tillagda.</p>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((ca) => {
                const price = ca.unitPrice ?? ca.article?.listPrice ?? 0;
                return (
                  <div key={ca.id} className="p-3 space-y-2" data-testid={`article-row-${ca.id}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate flex items-center gap-2">
                          {ca.article?.name || "Okänd artikel"}
                          {ca.article?.isGeotagged && (
                            <Badge variant="outline" className="gap-1 text-[10px]"><MapPin className="h-3 w-3" /> Geotaggad</Badge>
                          )}
                          {ca.isPreTask && <Badge variant="secondary" className="text-[10px]">Föruppgift</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{price} kr/st</div>
                      </div>
                      <Input
                        type="number"
                        min={1}
                        value={ca.quantity}
                        onChange={(e) => onUpdateQuantity(ca.id, parseInt(e.target.value) || 1)}
                        className="w-20 h-8 text-sm"
                        data-testid={`input-quantity-${ca.id}`}
                      />
                      <Button variant="ghost" size="sm" onClick={() => onRemoveArticle(ca.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive" data-testid={`button-remove-article-${ca.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-1">
                      <div>
                        <Label className="text-[11px] text-muted-foreground mb-0.5 block">Hakar fast på (metadata)</Label>
                        <Select
                          value={ca.metadataAssociation || NONE}
                          onValueChange={(v) => onUpdateArticleField(ca.id, { metadataAssociation: v === NONE ? null : v })}
                        >
                          <SelectTrigger className="h-8 text-xs" data-testid={`select-assoc-${ca.id}`}><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>—</SelectItem>
                            {definitions.map((d) => <SelectItem key={d.id} value={d.fieldKey}>{d.fieldLabel}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[11px] text-muted-foreground mb-0.5 block">Antal styrs av (metadata)</Label>
                        <Select
                          value={ca.metadataCorrespondence || NONE}
                          onValueChange={(v) => onUpdateArticleField(ca.id, { metadataCorrespondence: v === NONE ? null : v })}
                        >
                          <SelectTrigger className="h-8 text-xs" data-testid={`select-corr-${ca.id}`}><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>—</SelectItem>
                            {definitions.map((d) => <SelectItem key={d.id} value={d.fieldKey}>{d.fieldLabel}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pl-1">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <Checkbox
                          checked={!!ca.isPreTask}
                          onCheckedChange={(v) => onUpdateArticleField(ca.id, { isPreTask: !!v })}
                          data-testid={`checkbox-pretask-${ca.id}`}
                        />
                        Föruppgift (plock/beställning/föravisering)
                      </label>
                      {ca.isPreTask && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">Offset (min, negativt = före):</span>
                          <Input
                            type="number"
                            value={ca.dependencyOffsetMinutes ?? ""}
                            onChange={(e) => onUpdateArticleField(ca.id, { dependencyOffsetMinutes: e.target.value === "" ? null : parseInt(e.target.value) })}
                            className="w-24 h-7 text-xs"
                            placeholder="-2880"
                            data-testid={`input-offset-${ca.id}`}
                          />
                        </div>
                      )}
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
