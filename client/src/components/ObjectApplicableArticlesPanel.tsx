import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ServiceObject, Article } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, Loader2, Clock, DollarSign, Link2 } from "lucide-react";

interface ObjectApplicableArticlesPanelProps {
  object: ServiceObject;
}

const hookLevelLabels: Record<string, string> = {
  koncern: "Koncern",
  brf: "BRF",
  fastighet: "Fastighet",
  rum: "Rum",
  karl: "Alla kärl",
  karl_mat: "Matavfallskärl",
  karl_rest: "Restavfallskärl",
  karl_plast: "Plastkärl",
  kod: "Accesskod",
};

const articleTypeLabels: Record<string, string> = {
  tjanst: "Tjänst",
  felanmalan: "Felanmälan",
  kontroll: "Kontroll",
  vara: "Vara",
  beroende: "Beroende",
};

export function ObjectApplicableArticlesPanel({ object }: ObjectApplicableArticlesPanelProps) {
  const [open, setOpen] = useState(false);

  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: [`/api/objects/${object.id}/applicable-articles`],
    enabled: open,
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          data-testid={`button-applicable-articles-${object.id}`}
        >
          <Link2 className="h-4 w-4 mr-1" />
          Artiklar
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Fasthakade artiklar
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            Artiklar som automatiskt tillämpas på detta objekt baserat på objekttyp och hierarki.
          </p>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Inga fasthakade artiklar</p>
              <p className="text-xs mt-1">
                Lägg till artiklar med hookLevel som matchar detta objekt.
              </p>
            </div>
          ) : (
            articles.map((article) => (
              <div
                key={article.id}
                className="p-3 border rounded-md bg-card"
                data-testid={`article-card-${article.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-medium text-sm">{article.name}</p>
                    <p className="text-xs text-muted-foreground">{article.articleNumber}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {article.hookLevel && (
                      <Badge variant="secondary" className="text-xs">
                        {hookLevelLabels[article.hookLevel] || article.hookLevel}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      {articleTypeLabels[article.articleType] || article.articleType}
                    </Badge>
                  </div>
                </div>
                
                {article.description && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {article.description}
                  </p>
                )}

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {(article.productionTime ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {article.productionTime} min
                    </span>
                  )}
                  {(article.listPrice ?? 0) > 0 && (
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {article.listPrice} kr
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            <strong>Objekttyp:</strong> {object.objectType || "-"}
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Hierarkinivå:</strong> {object.hierarchyLevel || "-"}
          </p>
          {object.accessCode && (
            <p className="text-xs text-muted-foreground">
              <strong>Accesskod:</strong> {object.accessCode}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
