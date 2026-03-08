import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Wand2, Link2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Article, ServiceObject } from "@shared/schema";

interface ConceptArticle {
  id: string;
  articleId: string;
  quantity: number;
  article?: Article;
}

interface ConceptObject {
  id: string;
  objectId: string;
  object?: ServiceObject;
}

interface Mapping {
  id: string;
  orderConceptArticleId: string;
  orderConceptObjectId: string;
  quantity: number;
}

interface Step7Props {
  conceptId: string;
  conceptArticles: ConceptArticle[];
  conceptObjects: ConceptObject[];
  mappings: Mapping[];
  onMappingsUpdated: () => void;
}

export default function Step7ArticleMapping({
  conceptId,
  conceptArticles,
  conceptObjects,
  mappings,
  onMappingsUpdated,
}: Step7Props) {
  const { data: articles = [] } = useQuery<Article[]>({ queryKey: ["/api/articles"] });
  const { data: allObjects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });

  const enrichedArticles = useMemo(() => {
    return conceptArticles.map(ca => ({
      ...ca,
      article: articles.find(a => a.id === ca.articleId),
    }));
  }, [conceptArticles, articles]);

  const enrichedObjects = useMemo(() => {
    return conceptObjects.map(co => ({
      ...co,
      object: allObjects.find(o => o.id === co.objectId),
    }));
  }, [conceptObjects, allObjects]);

  const mappingsByArticle = useMemo(() => {
    const map = new Map<string, Mapping[]>();
    for (const m of mappings) {
      const existing = map.get(m.orderConceptArticleId) || [];
      existing.push(m);
      map.set(m.orderConceptArticleId, existing);
    }
    return map;
  }, [mappings]);

  const autoMapMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/order-concepts/${conceptId}/article-mappings/auto`);
    },
    onSuccess: () => {
      onMappingsUpdated();
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts", conceptId] });
    },
  });

  return (
    <div className="space-y-4" data-testid="step7-article-mapping">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Artikelkopplingar</h3>
          <p className="text-xs text-muted-foreground">
            Koppla artiklar till objekt. Automatisk koppling mappar alla artiklar till alla inkluderade objekt.
          </p>
        </div>
        <Button
          onClick={() => autoMapMutation.mutate()}
          disabled={autoMapMutation.isPending}
          data-testid="button-auto-map"
        >
          {autoMapMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4 mr-2" />
          )}
          Automatisk koppling
        </Button>
      </div>

      <ScrollArea className="h-[400px] border rounded-md">
        {enrichedArticles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Inga artiklar tillagda. Gå tillbaka till steg 6.
          </div>
        ) : (
          <div className="divide-y">
            {enrichedArticles.map(ca => {
              const articleMappings = mappingsByArticle.get(ca.id) || [];
              return (
                <div key={ca.id} className="p-3" data-testid={`mapping-article-${ca.id}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      {ca.article?.name || "Okänd artikel"}
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {articleMappings.length} kopplingar
                    </Badge>
                  </div>
                  {articleMappings.length > 0 ? (
                    <div className="ml-6 space-y-1">
                      {articleMappings.map(m => {
                        const obj = enrichedObjects.find(o => o.id === m.orderConceptObjectId);
                        return (
                          <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span>{obj?.object?.name || "Okänt objekt"}</span>
                            <span className="text-muted-foreground">x{m.quantity}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="ml-6 text-xs text-muted-foreground">
                      Inga kopplingar. Klicka "Automatisk koppling" ovan.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {mappings.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Totalt {mappings.length} kopplingar mellan {enrichedArticles.length} artiklar och {enrichedObjects.length} objekt
        </div>
      )}
    </div>
  );
}
