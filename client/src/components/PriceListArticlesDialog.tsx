import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Loader2, Trash2, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { QueryState } from "@/components/QueryState";
import { formatSekFromOre } from "@/lib/format";
import type { PriceList, PriceListArticle, Article } from "@shared/schema";

interface PriceListArticlesDialogProps {
  priceList: PriceList | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Hanterar artikelrader (line items) på EN prislista: lista, lägg till, redigera
 * pris och ta bort. Priser lagras i öre i databasen men matas in och visas i
 * kronor (se client/src/lib/format.ts — formatSekFromOre / *100-konvertering).
 */
export function PriceListArticlesDialog({ priceList, open, onOpenChange }: PriceListArticlesDialogProps) {
  const { toast } = useToast();
  const priceListId = priceList?.id ?? null;

  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [toDelete, setToDelete] = useState<PriceListArticle | null>(null);

  const {
    data: lineItems = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<PriceListArticle[]>({
    queryKey: ["/api/price-lists", priceListId, "articles"],
    enabled: open && !!priceListId,
  });

  const { data: allArticles = [], isLoading: isArticlesLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
    enabled: open,
  });

  const articleMap = useMemo(
    () => new Map(allArticles.map((a) => [a.id, a])),
    [allArticles],
  );

  const usedArticleIds = useMemo(
    () => new Set(lineItems.map((li) => li.articleId)),
    [lineItems],
  );

  const availableArticles = useMemo(
    () => allArticles.filter((a) => !usedArticleIds.has(a.id)),
    [allArticles, usedArticleIds],
  );

  // Tillåt inte tillägg förrän både radlistan och artikellistan laddats utan fel —
  // annars är usedArticleIds tom under laddning och en redan tillagd artikel kan
  // läggas till igen (dubblettpris, ingen unik-constraint i DB).
  const addReady = !isLoading && !isError && !isArticlesLoading;

  const invalidateLineItems = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/price-lists", priceListId, "articles"] });

  const parseKrToOre = (value: string): number | null => {
    const n = parseFloat(value.replace(",", "."));
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };

  const addMutation = useMutation({
    mutationFn: async ({ articleId, priceOre }: { articleId: string; priceOre: number }) =>
      apiRequest("POST", `/api/price-lists/${priceListId}/articles`, { articleId, price: priceOre }),
    onSuccess: () => {
      invalidateLineItems();
      setSelectedArticleId("");
      setNewPrice("");
      toast({ title: "Artikel tillagd", description: "Artikeln har lagts till i prislistan." });
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte lägga till artikel", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, priceOre }: { id: string; priceOre: number }) =>
      apiRequest("PATCH", `/api/price-list-articles/${id}`, { price: priceOre }),
    onSuccess: () => {
      invalidateLineItems();
      setEditingId(null);
      setEditPrice("");
      toast({ title: "Pris uppdaterat", description: "Artikelpriset har sparats." });
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte uppdatera pris", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/price-list-articles/${id}`),
    onSuccess: () => {
      invalidateLineItems();
      setToDelete(null);
      toast({ title: "Artikel borttagen", description: "Artikeln har tagits bort från prislistan." });
    },
    onError: (e: Error) =>
      toast({ title: "Kunde inte ta bort artikel", description: e.message, variant: "destructive" }),
  });

  const handleSelectArticle = (articleId: string) => {
    setSelectedArticleId(articleId);
    const article = articleMap.get(articleId);
    if (article && !newPrice) {
      setNewPrice(article.listPrice ? (article.listPrice / 100).toString() : "");
    }
  };

  const handleAdd = () => {
    if (!addReady) return;
    if (!selectedArticleId) {
      toast({ title: "Välj en artikel", description: "Du måste välja en artikel att lägga till.", variant: "destructive" });
      return;
    }
    const priceOre = parseKrToOre(newPrice);
    if (priceOre === null) {
      toast({ title: "Ogiltigt pris", description: "Ange ett giltigt pris i kronor.", variant: "destructive" });
      return;
    }
    addMutation.mutate({ articleId: selectedArticleId, priceOre });
  };

  const startEdit = (li: PriceListArticle) => {
    setEditingId(li.id);
    setEditPrice((li.price / 100).toString());
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPrice("");
  };

  const saveEdit = (li: PriceListArticle) => {
    const priceOre = parseKrToOre(editPrice);
    if (priceOre === null) {
      toast({ title: "Ogiltigt pris", description: "Ange ett giltigt pris i kronor.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id: li.id, priceOre });
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedArticleId("");
      setNewPrice("");
      cancelEdit();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-price-list-articles">
        <DialogHeader>
          <DialogTitle>Artiklar i {priceList?.name}</DialogTitle>
          <DialogDescription>
            Lägg till artiklar och sätt deras pris i denna prislista. Priser anges i kronor.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-md border p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="select-add-article">Artikel</Label>
            <Select value={selectedArticleId} onValueChange={handleSelectArticle} disabled={!addReady}>
              <SelectTrigger id="select-add-article" data-testid="select-add-article">
                <SelectValue
                  placeholder={
                    !addReady ? "Laddar…" : availableArticles.length ? "Välj artikel" : "Alla artiklar tillagda"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableArticles.map((a) => (
                  <SelectItem key={a.id} value={a.id} data-testid={`option-article-${a.id}`}>
                    {a.articleNumber ? `${a.articleNumber} – ${a.name}` : a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-2 sm:w-40">
            <Label htmlFor="input-add-price">Pris (kr)</Label>
            <Input
              id="input-add-price"
              type="number"
              min="0"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="0"
              disabled={!addReady}
              data-testid="input-add-price"
            />
          </div>
          <Button
            onClick={handleAdd}
            disabled={addMutation.isPending || !addReady || !availableArticles.length}
            data-testid="button-add-article"
          >
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Lägg till
          </Button>
        </div>

        <QueryState
          isLoading={isLoading}
          isError={isError}
          isEmpty={lineItems.length === 0}
          error={error as { message?: string } | null}
          onRetry={() => refetch()}
          emptyTitle="Inga artiklar i prislistan"
          emptyDescription="Lägg till en artikel ovan för att börja prissätta."
          loadingVariant="skeleton-rows"
          skeletonRows={4}
        >
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Artikel</TableHead>
                <TableHead className="text-right">Pris</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((li) => {
                const article = articleMap.get(li.articleId);
                const isEditing = editingId === li.id;
                return (
                  <TableRow key={li.id} data-testid={`row-pla-${li.id}`}>
                    <TableCell>
                      <div className="font-medium" data-testid={`text-pla-name-${li.id}`}>
                        {article?.name ?? "Okänd artikel"}
                      </div>
                      {article?.articleNumber && (
                        <div className="text-xs text-muted-foreground">{article.articleNumber}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-28 ml-auto text-right"
                          data-testid={`input-edit-price-${li.id}`}
                        />
                      ) : (
                        <span data-testid={`text-pla-price-${li.id}`}>{formatSekFromOre(li.price)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => saveEdit(li)}
                              disabled={updateMutation.isPending}
                              title="Spara"
                              aria-label="Spara pris"
                              data-testid={`button-save-pla-${li.id}`}
                            >
                              {updateMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={cancelEdit}
                              title="Avbryt"
                              aria-label="Avbryt redigering"
                              data-testid={`button-cancel-pla-${li.id}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEdit(li)}
                              title="Redigera pris"
                              aria-label="Redigera pris"
                              data-testid={`button-edit-pla-${li.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setToDelete(li)}
                              title="Ta bort"
                              aria-label="Ta bort artikel"
                              data-testid={`button-delete-pla-${li.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </QueryState>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} data-testid="button-close-articles">
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort artikel?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort "
              {toDelete ? articleMap.get(toDelete.articleId)?.name ?? "artikeln" : ""}" från prislistan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-pla">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}
              className="bg-destructive/15 text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-pla"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
