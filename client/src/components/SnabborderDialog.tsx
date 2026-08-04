import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  Package,
  PencilLine,
  Hash,
  Check,
  User,
} from "lucide-react";
import { apiRequest, queryClient, versionedUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatSekFromOre } from "@/lib/format";

// ── Typer ────────────────────────────────────────────────────────────────
interface CustomerOption {
  id: string;
  name: string;
  customerNumber?: string | null;
}

interface ArticleOption {
  id: string;
  name: string;
  articleNumber?: string | null;
  unit?: string | null;
  listPrice?: number | null; // öre
  productionTime?: number | null; // minuter
}

interface DraftLine {
  id: string;
  articleId: string | null; // null = fritextrad
  label: string | null; // "ART-001 · Namn" för artikelrader
  unit: string | null;
  listPriceOre: number | null; // artikelrad: listpris/enhet i öre
  description: string; // fritext / notering
  unitPriceKr: number; // fritextrad: pris/enhet i kronor
  quantity: number;
}

interface SnabborderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectId: string;
  objectName?: string | null;
  objectNumber?: string | null;
  /** Objektets primära betalare — förvald kund (redigerbar). */
  defaultCustomerId?: string | null;
}

export function SnabborderDialog({
  open,
  onOpenChange,
  objectId,
  objectName,
  objectNumber,
  defaultCustomerId,
}: SnabborderDialogProps) {
  const { toast } = useToast();

  const objectLabel = objectName && objectName !== "0" ? objectName : objectNumber || "objekt";

  // ── Formulärstate ──────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  const [kundreferens, setKundreferens] = useState("");
  const [varReferens, setVarReferens] = useState("");
  const [ertOrdernr, setErtOrdernr] = useState("");
  const [leveranstid, setLeveranstid] = useState("");

  const [articleSearch, setArticleSearch] = useState("");
  const [debouncedArticle, setDebouncedArticle] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [submitting, setSubmitting] = useState(false);

  // Återställ när dialogen öppnas/stängs.
  useEffect(() => {
    if (open) {
      setTitle(`Snabborder – ${objectLabel}`);
      setSelectedCustomer(null);
      setChangingCustomer(false);
      setCustomerSearch("");
      setKundreferens("");
      setVarReferens("");
      setErtOrdernr("");
      setLeveranstid("");
      setArticleSearch("");
      setDebouncedArticle("");
      setLines([]);
    }
    // objectLabel avsiktligt utanför deps: ska bara sättas vid öppning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce artikel-sök.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedArticle(articleSearch), 250);
    return () => clearTimeout(t);
  }, [articleSearch]);

  // ── Queries ────────────────────────────────────────────────────────────
  const { data: nextOrderNumber } = useQuery<{ orderNumber: string }>({
    queryKey: ["/api/work-orders/next-order-number", open],
    queryFn: async () => {
      const res = await fetch(versionedUrl("/api/work-orders/next-order-number"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Kunde inte hämta ordernummer");
      return (await res.json()) as { orderNumber: string };
    },
    enabled: open,
    staleTime: 0,
  });

  const { data: customers = [] } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers", "snabborder-customers"],
    queryFn: async () => {
      const res = await fetch(versionedUrl("/api/customers"), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta kunder");
      return (await res.json()) as CustomerOption[];
    },
    enabled: open,
    staleTime: 30000,
  });

  // Förvälj objektets primära betalare när kundlistan laddats.
  useEffect(() => {
    if (!open || selectedCustomer || !defaultCustomerId || customers.length === 0) return;
    const match = customers.find((c) => c.id === defaultCustomerId);
    if (match) setSelectedCustomer(match);
  }, [open, customers, defaultCustomerId, selectedCustomer]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          (c.customerNumber ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [customers, customerSearch]);

  const { data: articleResults = [], isFetching: articlesFetching } = useQuery<ArticleOption[]>({
    queryKey: ["/api/articles", "snabborder-article-search", debouncedArticle],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (debouncedArticle.trim()) params.set("search", debouncedArticle.trim());
      const res = await fetch(versionedUrl(`/api/articles?${params.toString()}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Kunde inte hämta artiklar");
      const data = await res.json();
      return (Array.isArray(data) ? data : data?.data ?? []) as ArticleOption[];
    },
    enabled: open && debouncedArticle.trim().length > 0,
    staleTime: 15000,
  });

  // ── Radhantering ───────────────────────────────────────────────────────
  const addArticleLine = (a: ArticleOption) => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        articleId: a.id,
        label: `${a.articleNumber ? a.articleNumber + " · " : ""}${a.name}`,
        unit: a.unit ?? "st",
        listPriceOre: a.listPrice ?? 0,
        description: "",
        unitPriceKr: 0,
        quantity: 1,
      },
    ]);
    setArticleSearch("");
    setDebouncedArticle("");
  };

  const addFreeTextLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        articleId: null,
        label: null,
        unit: "st",
        listPriceOre: null,
        description: "",
        unitPriceKr: 0,
        quantity: 1,
      },
    ]);
  };

  const updateLine = (id: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const lineTotalOre = (l: DraftLine): number => {
    const perUnit = l.articleId ? l.listPriceOre ?? 0 : Math.round(l.unitPriceKr * 100);
    return perUnit * l.quantity;
  };

  const totalOre = useMemo(() => lines.reduce((s, l) => s + lineTotalOre(l), 0), [lines]);

  // ── Validering ─────────────────────────────────────────────────────────
  const trimmedTitle = title.trim();
  const canSubmit =
    !!trimmedTitle &&
    !!selectedCustomer &&
    lines.length > 0 &&
    lines.every((l) => (l.articleId ? true : l.description.trim().length > 0)) &&
    !submitting;

  // ── Skapa ──────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!canSubmit || !selectedCustomer) return;
    setSubmitting(true);
    try {
      const linePayloads = lines.map((l) => {
        if (l.articleId) {
          return {
            articleId: l.articleId,
            quantity: l.quantity,
            notes: l.description.trim() || undefined,
          };
        }
        return {
          description: l.description.trim(),
          quantity: l.quantity,
          unitPrice: Math.round(l.unitPriceKr * 100),
        };
      });

      const workOrder: Record<string, unknown> = {
        title: trimmedTitle,
        orderType: "service",
        objectId,
        customerId: selectedCustomer.id,
      };
      if (leveranstid) workOrder.desiredDeliveryStart = leveranstid;
      if (kundreferens.trim()) workOrder.frozenCustomerReference = kundreferens.trim();
      if (varReferens.trim()) workOrder.frozenOurReference = varReferens.trim();
      if (ertOrdernr.trim()) workOrder.frozenCustomerInvoiceReference = ertOrdernr.trim();

      // Task #1369: ursprung stämplas vid skapandet — snabborder.
      workOrder.sourceType = "snabborder";
      const res = await apiRequest("POST", "/api/work-orders/with-lines", {
        workOrder,
        assignOrderNumber: true,
        lines: linePayloads,
      });
      const wo = await res.json();

      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });

      toast({
        title: "Snabborder skapad",
        description: wo?.orderNumber
          ? `Ordernummer ${wo.orderNumber} · ${objectLabel}`
          : `Order skapad för ${objectLabel}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Kunde inte skapa snabbordern",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-snabborder">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="h-5 w-5 text-primary" />
            Snabborder
            {nextOrderNumber?.orderNumber && (
              <Badge variant="outline" className="ml-1 font-mono gap-1" data-testid="badge-next-order-number">
                <Hash className="h-3 w-3" />
                {nextOrderNumber.orderNumber}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Snabb direktorder för {objectLabel} — blir fakturaunderlag direkt. Ordernumret tilldelas
            automatiskt vid skapande.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="space-y-5">
            {/* Titel */}
            <div className="space-y-1.5">
              <Label htmlFor="snabborder-title">Ordertitel</Label>
              <Input
                id="snabborder-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Kort beskrivning av ordern"
                data-testid="input-snabborder-title"
              />
            </div>

            {/* Kund */}
            <div className="space-y-1.5">
              <Label>Kund (beställare)</Label>
              {selectedCustomer && !changingCustomer ? (
                <div className="flex items-center justify-between rounded-md border p-2.5" data-testid="selected-customer">
                  <span className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{selectedCustomer.name}</span>
                    {selectedCustomer.customerNumber && (
                      <span className="text-muted-foreground font-mono text-xs">
                        {selectedCustomer.customerNumber}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setChangingCustomer(true)}
                    data-testid="button-change-customer"
                  >
                    Byt kund
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Sök kund på namn eller kundnummer"
                      data-testid="input-customer-search"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                    {filteredCustomers.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">Inga kunder hittades.</div>
                    ) : (
                      filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setChangingCustomer(false);
                            setCustomerSearch("");
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                          data-testid={`option-customer-${c.id}`}
                        >
                          <span className="font-medium">{c.name}</span>
                          {c.customerNumber && (
                            <span className="text-muted-foreground font-mono text-xs">{c.customerNumber}</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Fakturareferenser */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Fakturahuvud</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="snabborder-kundreferens">Er referens (kundreferens)</Label>
                  <Input
                    id="snabborder-kundreferens"
                    value={kundreferens}
                    onChange={(e) => setKundreferens(e.target.value)}
                    placeholder="Kundens referens"
                    data-testid="input-snabborder-kundreferens"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="snabborder-varreferens">Vår referens</Label>
                  <Input
                    id="snabborder-varreferens"
                    value={varReferens}
                    onChange={(e) => setVarReferens(e.target.value)}
                    placeholder="Egen referens"
                    data-testid="input-snabborder-varreferens"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="snabborder-ertordernr">Ert ordernr</Label>
                  <Input
                    id="snabborder-ertordernr"
                    value={ertOrdernr}
                    onChange={(e) => setErtOrdernr(e.target.value)}
                    placeholder="Kundens ordernummer"
                    data-testid="input-snabborder-ertordernr"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="snabborder-leveranstid">Leveranstid (önskad)</Label>
                  <Input
                    id="snabborder-leveranstid"
                    type="datetime-local"
                    value={leveranstid}
                    onChange={(e) => setLeveranstid(e.target.value)}
                    data-testid="input-snabborder-leveranstid"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Orderrader */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Orderrader</p>
                <Button variant="outline" size="sm" onClick={addFreeTextLine} data-testid="button-add-freetext-line">
                  <Plus className="h-4 w-4 mr-1" /> Fritextrad
                </Button>
              </div>

              {/* Artikel-sök */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={articleSearch}
                  onChange={(e) => setArticleSearch(e.target.value)}
                  placeholder="Sök artikel på artikelnummer eller namn"
                  data-testid="input-article-search"
                />
                {debouncedArticle.trim().length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-md border bg-popover shadow-md divide-y">
                    {articlesFetching ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Söker…
                      </div>
                    ) : articleResults.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">Inga artiklar hittades.</div>
                    ) : (
                      articleResults.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => addArticleLine(a)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                          data-testid={`option-article-${a.id}`}
                        >
                          <span className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {a.articleNumber && (
                              <span className="font-mono text-xs text-muted-foreground">{a.articleNumber}</span>
                            )}
                            <span className="font-medium">{a.name}</span>
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {formatSekFromOre(a.listPrice ?? 0)}/{a.unit || "st"}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Radlista */}
              {lines.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Inga rader ännu. Sök en artikel eller lägg till en fritextrad.
                </p>
              ) : (
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div
                      key={l.id}
                      className="flex flex-wrap items-start gap-2 rounded-md border p-2.5"
                      data-testid={`line-${l.id}`}
                    >
                      <div className="flex-1 min-w-[180px] space-y-1.5">
                        {l.articleId ? (
                          <>
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                              {l.label}
                            </div>
                            <Input
                              value={l.description}
                              onChange={(e) => updateLine(l.id, { description: e.target.value })}
                              placeholder="Fri text (valfri notering)"
                              className="h-8 text-sm"
                              data-testid={`input-line-notes-${l.id}`}
                            />
                          </>
                        ) : (
                          <Textarea
                            value={l.description}
                            onChange={(e) => updateLine(l.id, { description: e.target.value })}
                            placeholder="Fri text (beskrivning av raden)"
                            className="min-h-[38px] text-sm"
                            data-testid={`input-line-description-${l.id}`}
                          />
                        )}
                      </div>

                      <div className="w-16 space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Antal</Label>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(l.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })
                          }
                          className="h-8 text-sm"
                          data-testid={`input-line-quantity-${l.id}`}
                        />
                      </div>

                      {l.articleId ? (
                        <div className="w-24 space-y-1.5">
                          <Label className="text-xs text-muted-foreground">á-pris</Label>
                          <div className="flex h-8 items-center text-sm" data-testid={`text-line-price-${l.id}`}>
                            {formatSekFromOre(l.listPriceOre ?? 0)}
                          </div>
                        </div>
                      ) : (
                        <div className="w-24 space-y-1.5">
                          <Label className="text-xs text-muted-foreground">á-pris (kr)</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={l.unitPriceKr}
                            onChange={(e) =>
                              updateLine(l.id, { unitPriceKr: Math.max(0, parseFloat(e.target.value) || 0) })
                            }
                            className="h-8 text-sm"
                            data-testid={`input-line-unitprice-${l.id}`}
                          />
                        </div>
                      )}

                      <div className="w-24 space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Summa</Label>
                        <div className="flex h-8 items-center text-sm font-medium" data-testid={`text-line-total-${l.id}`}>
                          {formatSekFromOre(lineTotalOre(l))}
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 mt-5 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(l.id)}
                        data-testid={`button-remove-line-${l.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="mt-2 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground" data-testid="text-snabborder-total">
            Totalt: <span className="font-semibold text-foreground">{formatSekFromOre(totalOre)}</span>
            {lines.length > 0 && ` · ${lines.length} rad(er)`}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} data-testid="button-cancel-snabborder">
              Avbryt
            </Button>
            <Button onClick={handleCreate} disabled={!canSubmit} data-testid="button-create-snabborder">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Skapar…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-1" /> Skapa snabborder
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SnabborderDialog;
