import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { ServiceObject, Article } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package, Loader2, Clock, DollarSign, Link2, Plus, X, Pencil, Check, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ResolvedArticlePrice {
  articleId: string;
  articleNumber: string;
  name: string;
  articleType: string;
  hookLevel: string | null;
  productionTime: number;
  listPrice: number;
  resolvedPrice: number;
  priceSource: string;
  priceListName: string | null;
  isManual: boolean;
  objectArticleId: string | null;
  overridePrice: number | null;
}

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

const priceSourceLabels: Record<string, string> = {
  listpris: "Listpris",
  prislista: "Prislista",
  objektpris: "Objektpris",
};

export function ObjectApplicableArticlesPanel({ object }: ObjectApplicableArticlesPanelProps) {
  const [open, setOpen] = useState(false);
  const [showAddArticle, setShowAddArticle] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState("");
  const { toast } = useToast();

  const queryKey = [`/api/objects/${object.id}/article-prices`];

  const { data: articlePrices = [], isLoading } = useQuery<ResolvedArticlePrice[]>({
    queryKey,
    enabled: open,
  });

  const { data: allArticles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
    enabled: open && showAddArticle,
  });

  const availableArticles = allArticles.filter(
    a => !a.deletedAt && !articlePrices.some(ap => ap.articleId === a.id)
  );

  const addArticleMutation = useMutation({
    mutationFn: async (articleId: string) => {
      await apiRequest("POST", `/api/objects/${object.id}/articles`, { articleId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setSelectedArticleId("");
      setShowAddArticle(false);
      toast({ title: "Artikel tillagd" });
    },
    onError: () => {
      toast({ title: "Kunde inte lägga till artikel", variant: "destructive" });
    },
  });

  const removeArticleMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await apiRequest("DELETE", `/api/objects/${object.id}/articles/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Artikel borttagen" });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort artikel", variant: "destructive" });
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: async ({ linkId, overridePrice }: { linkId: string; overridePrice: number | null }) => {
      await apiRequest("PATCH", `/api/objects/${object.id}/articles/${linkId}`, { overridePrice });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingPriceId(null);
      toast({ title: "Pris uppdaterat" });
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera pris", variant: "destructive" });
    },
  });

  const handleSavePrice = useCallback(async (ap: ResolvedArticlePrice) => {
    const val = editPriceValue.trim();
    const price = val === "" ? null : parseInt(val, 10);
    if (val !== "" && isNaN(price!)) return;

    if (ap.objectArticleId) {
      updatePriceMutation.mutate({ linkId: ap.objectArticleId, overridePrice: price });
    } else {
      try {
        await apiRequest("POST", `/api/objects/${object.id}/articles`, { articleId: ap.articleId, overridePrice: price });
        queryClient.invalidateQueries({ queryKey });
        setEditingPriceId(null);
        toast({ title: "Pris uppdaterat" });
      } catch {
        toast({ title: "Kunde inte spara pris", variant: "destructive" });
      }
    }
  }, [editPriceValue, updatePriceMutation, object.id, queryKey, toast]);

  const handleResetPrice = useCallback(async (ap: ResolvedArticlePrice) => {
    if (!ap.objectArticleId) return;
    if (ap.isManual) {
      updatePriceMutation.mutate({ linkId: ap.objectArticleId, overridePrice: null });
    } else {
      try {
        await apiRequest("DELETE", `/api/objects/${object.id}/articles/${ap.objectArticleId}`);
        queryClient.invalidateQueries({ queryKey });
        toast({ title: "Pris återställt" });
      } catch {
        toast({ title: "Kunde inte återställa pris", variant: "destructive" });
      }
    }
  }, [updatePriceMutation, object.id, queryKey, toast]);

  const handleAddArticle = useCallback(() => {
    if (!selectedArticleId) return;
    addArticleMutation.mutate(selectedArticleId);
  }, [selectedArticleId, addArticleMutation]);

  const autoArticles = articlePrices.filter(ap => !ap.isManual);
  const manualArticles = articlePrices.filter(ap => ap.isManual);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              data-testid={`button-applicable-articles-${object.id}`}
            >
              <Link2 className="h-4 w-4" />
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent><p>Artiklar & Priser</p></TooltipContent>
      </Tooltip>

      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Artiklar & Priser
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {object.name} — artiklar med upplösta priser
          </p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : articlePrices.length === 0 && !showAddArticle ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Inga artiklar kopplade</p>
              <p className="text-xs mt-1">
                Artiklar fasthakade via hierarki eller manuellt tillagda visas här.
              </p>
            </div>
          ) : (
            <>
              {autoArticles.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Fasthakade artiklar ({autoArticles.length})
                  </h4>
                  <div className="space-y-2">
                    {autoArticles.map(ap => (
                      <ArticleRow
                        key={ap.articleId}
                        ap={ap}
                        editingPriceId={editingPriceId}
                        editPriceValue={editPriceValue}
                        onStartEdit={(id, price) => { setEditingPriceId(id); setEditPriceValue(String(price)); }}
                        onCancelEdit={() => setEditingPriceId(null)}
                        onSavePrice={() => handleSavePrice(ap)}
                        onResetPrice={() => handleResetPrice(ap)}
                        onEditPriceChange={setEditPriceValue}
                        onRemove={null}
                      />
                    ))}
                  </div>
                </div>
              )}

              {manualArticles.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Manuellt tillagda ({manualArticles.length})
                  </h4>
                  <div className="space-y-2">
                    {manualArticles.map(ap => (
                      <ArticleRow
                        key={ap.articleId}
                        ap={ap}
                        editingPriceId={editingPriceId}
                        editPriceValue={editPriceValue}
                        onStartEdit={(id, price) => { setEditingPriceId(id); setEditPriceValue(String(price)); }}
                        onCancelEdit={() => setEditingPriceId(null)}
                        onSavePrice={() => handleSavePrice(ap)}
                        onResetPrice={() => handleResetPrice(ap)}
                        onEditPriceChange={setEditPriceValue}
                        onRemove={(linkId) => removeArticleMutation.mutate(linkId)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {showAddArticle ? (
            <div className="p-3 border rounded-md bg-card space-y-3" data-testid="add-article-form">
              <p className="text-sm font-medium">Lägg till artikel</p>
              <Select value={selectedArticleId} onValueChange={setSelectedArticleId}>
                <SelectTrigger data-testid="select-article">
                  <SelectValue placeholder="Välj artikel..." />
                </SelectTrigger>
                <SelectContent>
                  {availableArticles.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.articleNumber} — {a.name}
                    </SelectItem>
                  ))}
                  {availableArticles.length === 0 && (
                    <div className="p-2 text-xs text-muted-foreground text-center">
                      Inga fler artiklar tillgängliga
                    </div>
                  )}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddArticle}
                  disabled={!selectedArticleId || addArticleMutation.isPending}
                  data-testid="button-confirm-add-article"
                >
                  {addArticleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                  Lägg till
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowAddArticle(false); setSelectedArticleId(""); }} data-testid="button-cancel-add-article">
                  Avbryt
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowAddArticle(true)}
              data-testid="button-add-article"
            >
              <Plus className="h-4 w-4 mr-1" />
              Lägg till artikel
            </Button>
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

function ArticleRow({
  ap,
  editingPriceId,
  editPriceValue,
  onStartEdit,
  onCancelEdit,
  onSavePrice,
  onResetPrice,
  onEditPriceChange,
  onRemove,
}: {
  ap: ResolvedArticlePrice;
  editingPriceId: string | null;
  editPriceValue: string;
  onStartEdit: (id: string, price: number) => void;
  onCancelEdit: () => void;
  onSavePrice: () => void;
  onResetPrice: () => void;
  onEditPriceChange: (val: string) => void;
  onRemove: ((linkId: string) => void) | null;
}) {
  const isEditing = editingPriceId === ap.articleId;

  return (
    <div className="p-3 border rounded-md bg-card" data-testid={`article-price-card-${ap.articleId}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{ap.name}</p>
          <p className="text-xs text-muted-foreground">{ap.articleNumber}</p>
        </div>
        <div className="flex flex-wrap gap-1 shrink-0">
          {ap.isManual && (
            <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              Manuell
            </Badge>
          )}
          {!ap.isManual && ap.hookLevel && (
            <Badge variant="secondary" className="text-xs">
              {hookLevelLabels[ap.hookLevel] || ap.hookLevel}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {articleTypeLabels[ap.articleType] || ap.articleType}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {ap.productionTime > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {ap.productionTime} min
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={editPriceValue}
                onChange={e => onEditPriceChange(e.target.value)}
                className="w-20 h-7 text-xs"
                autoFocus
                data-testid={`input-price-${ap.articleId}`}
                onKeyDown={e => { if (e.key === 'Enter') onSavePrice(); if (e.key === 'Escape') onCancelEdit(); }}
              />
              <span className="text-xs text-muted-foreground">kr</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onSavePrice} data-testid={`button-save-price-${ap.articleId}`}>
                <Check className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onCancelEdit}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <div className="text-right">
                {ap.overridePrice != null && (
                  <span className="text-xs text-muted-foreground line-through mr-1">{ap.listPrice} kr</span>
                )}
                <span className="text-sm font-medium flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {ap.resolvedPrice} kr
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {priceSourceLabels[ap.priceSource] || ap.priceSource}
                  {ap.priceListName && ` (${ap.priceListName})`}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => onStartEdit(ap.articleId, ap.resolvedPrice)}
                    data-testid={`button-edit-price-${ap.articleId}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Överskrid pris</p></TooltipContent>
              </Tooltip>
              {ap.overridePrice != null && ap.objectArticleId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={onResetPrice}
                      data-testid={`button-reset-price-${ap.articleId}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Återställ standardpris</p></TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {onRemove && ap.objectArticleId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => onRemove(ap.objectArticleId!)}
                  data-testid={`button-remove-article-${ap.articleId}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Ta bort artikel</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
