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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  Building2,
  Home,
  Package,
  PencilLine,
  Check,
  Clock,
  AlertTriangle,
  Info,
} from "lucide-react";
import { apiRequest, queryClient, versionedUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatSekFromOre } from "@/lib/format";

// ── Typer ────────────────────────────────────────────────────────────────
interface ObjectOption {
  id: string;
  name: string;
  objectNumber?: string | null;
  displayName?: string | null;
}

interface ClusterOption {
  id: string;
  name: string;
}

interface ArticleOption {
  id: string;
  name: string;
  unit?: string | null;
  listPrice?: number | null; // öre
  productionTime?: number | null; // minuter
}

interface CustomerOption {
  id: string;
  name: string;
  customerNumber?: string | null;
}

interface WorkOrderOption {
  id: string;
  title: string;
  customerId?: string | null;
  customerName?: string | null;
}

interface ArticleLine {
  articleId: string;
  name: string;
  unit: string;
  listPriceOre: number;
  productionMinutes: number;
  quantity: number;
}

interface FreeTextLine {
  id: string;
  description: string;
  unitPriceKr: number;
  productionMinutes: number;
  quantity: number;
}

type Mode = "tillagg" | "ny";
type Coupling = "objekt" | "kluster" | "ingen";

interface EnkelUppgiftWizardProps {
  open: boolean;
  onClose: () => void;
  // Förifyllt objekt (t.ex. när en utförare trycker "+" på ett objekt i fält).
  presetObjectId?: string | null;
  presetObjectName?: string | null;
  onCreated?: (workOrderId: string) => void;
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const STEP_TITLES = [
  "Tillägg eller ny uppgift",
  "Kund",
  "Koppling till objekt",
  "Önskad leveranstid",
  "Artiklar & fritext",
  "Sammanfattning",
];

export function EnkelUppgiftWizard({
  open,
  onClose,
  presetObjectId,
  presetObjectName,
  onCreated,
}: EnkelUppgiftWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Steg 1
  const [mode, setMode] = useState<Mode | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<WorkOrderOption | null>(null);

  // Steg 2
  const [kundType, setKundType] = useState<"extern" | "intern">("extern");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);

  // Steg 3
  const [coupling, setCoupling] = useState<Coupling>("objekt");
  const [objectSearch, setObjectSearch] = useState("");
  const [selectedObject, setSelectedObject] = useState<ObjectOption | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterOption | null>(null);

  // Steg 4
  const [deliveryStart, setDeliveryStart] = useState("");
  const [deliveryEnd, setDeliveryEnd] = useState("");

  // Steg 5
  const [articleSearch, setArticleSearch] = useState("");
  const [articleLines, setArticleLines] = useState<ArticleLine[]>([]);
  const [freeTextLines, setFreeTextLines] = useState<FreeTextLine[]>([]);

  // Steg 6
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [plannedNotes, setPlannedNotes] = useState("");

  const debouncedOrder = useDebounced(orderSearch);
  const debouncedCustomer = useDebounced(customerSearch);
  const debouncedObject = useDebounced(objectSearch);
  const debouncedArticle = useDebounced(articleSearch);

  // Reset vid stängning
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setMode(null);
    setOrderSearch("");
    setSelectedOrder(null);
    setKundType("extern");
    setCustomerSearch("");
    setSelectedCustomer(null);
    setObjectSearch("");
    setDeliveryStart("");
    setDeliveryEnd("");
    setArticleSearch("");
    setArticleLines([]);
    setFreeTextLines([]);
    setTitle("");
    setDescription("");
    setPlannedNotes("");
    if (presetObjectId) {
      setCoupling("objekt");
      setSelectedObject({ id: presetObjectId, name: presetObjectName || "Valt objekt", displayName: presetObjectName });
    } else {
      setCoupling("objekt");
      setSelectedObject(null);
    }
    setSelectedCluster(null);
  }, [open, presetObjectId, presetObjectName]);

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: orderResults, isFetching: ordersFetching } = useQuery<WorkOrderOption[]>({
    queryKey: ["/api/work-orders", "enkel-order-search", debouncedOrder],
    queryFn: async () => {
      const params = new URLSearchParams({ allDates: "true", includeUnscheduled: "true", limit: "20" });
      if (debouncedOrder.trim()) params.set("search", debouncedOrder.trim());
      const res = await fetch(versionedUrl(`/api/work-orders?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta order");
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.data ?? []);
      return list as WorkOrderOption[];
    },
    enabled: open && step === 0 && mode === "tillagg" && debouncedOrder.trim().length > 0,
    staleTime: 15000,
  });

  const { data: customerResults, isFetching: customersFetching } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers", "enkel-customer-search", debouncedCustomer],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/customers`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta kunder");
      const data = (await res.json()) as CustomerOption[];
      const q = debouncedCustomer.trim().toLowerCase();
      if (!q) return data.slice(0, 30);
      return data
        .filter((c) => c.name?.toLowerCase().includes(q) || (c.customerNumber ?? "").toLowerCase().includes(q))
        .slice(0, 30);
    },
    enabled: open && step === 1 && kundType === "extern",
    staleTime: 30000,
  });

  const { data: objectResults, isFetching: objectsFetching } = useQuery<ObjectOption[]>({
    queryKey: ["/api/objects/tree", "enkel-object-search", debouncedObject],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedObject.trim()) params.set("search", debouncedObject.trim());
      const res = await fetch(versionedUrl(`/api/objects/tree?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta objekt");
      return (await res.json()) as ObjectOption[];
    },
    enabled: open && step === 2 && coupling === "objekt" && debouncedObject.trim().length > 0,
    staleTime: 30000,
  });

  const { data: clusterResults } = useQuery<ClusterOption[]>({
    queryKey: ["/api/clusters", "enkel-clusters"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/clusters`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta kluster");
      return (await res.json()) as ClusterOption[];
    },
    enabled: open && step === 2 && coupling === "kluster",
    staleTime: 60000,
  });

  const { data: articleResults, isFetching: articlesFetching } = useQuery<ArticleOption[]>({
    queryKey: ["/api/articles", "enkel-article-search", debouncedArticle],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (debouncedArticle.trim()) params.set("search", debouncedArticle.trim());
      const res = await fetch(versionedUrl(`/api/articles?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta artiklar");
      const data = await res.json();
      return (Array.isArray(data) ? data : (data?.data ?? [])) as ArticleOption[];
    },
    enabled: open && step === 4 && debouncedArticle.trim().length > 0,
    staleTime: 15000,
  });

  // ── Beräkningar ──────────────────────────────────────────────────────
  const totalPriceOre = useMemo(() => {
    const articleTotal = articleLines.reduce((s, l) => s + l.listPriceOre * l.quantity, 0);
    const freeTextTotal = freeTextLines.reduce((s, l) => s + Math.round(l.unitPriceKr * 100) * l.quantity, 0);
    return articleTotal + freeTextTotal;
  }, [articleLines, freeTextLines]);

  const totalMinutes = useMemo(() => {
    const articleMin = articleLines.reduce((s, l) => s + l.productionMinutes * l.quantity, 0);
    const freeMin = freeTextLines.reduce((s, l) => s + l.productionMinutes * l.quantity, 0);
    return articleMin + freeMin;
  }, [articleLines, freeTextLines]);

  const derivedTitle = useMemo(() => {
    if (title.trim()) return title.trim();
    if (articleLines.length > 0) return articleLines[0].name;
    if (freeTextLines.length > 0 && freeTextLines[0].description.trim()) return freeTextLines[0].description.trim();
    return "Enkel uppgift";
  }, [title, articleLines, freeTextLines]);

  const hasLines = articleLines.length > 0 || freeTextLines.some((l) => l.description.trim());

  // ── Steg-navigering ──────────────────────────────────────────────────
  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return mode === "ny" || (mode === "tillagg" && !!selectedOrder);
      case 1:
        // Kund valfritt. I tillägg-läge ärvs kund — gå alltid vidare.
        return true;
      case 2:
        if (coupling === "objekt") return !!selectedObject;
        if (coupling === "kluster") return !!selectedCluster;
        return true; // ingen koppling
      case 3:
        return true; // leveranstid valfri
      case 4:
        return hasLines;
      default:
        return true;
    }
  }, [step, mode, selectedOrder, coupling, selectedObject, selectedCluster, hasLines]);

  // I tillägg-läge ärvs kund, koppling och leveranstid från ordern → hoppa över steg 1, 2 & 3.
  const skipStep = (s: number) => mode === "tillagg" && (s === 1 || s === 2 || s === 3);

  const goNext = () => {
    let next = step + 1;
    while (next < STEP_TITLES.length && skipStep(next)) next += 1;
    setStep(Math.min(next, STEP_TITLES.length - 1));
  };
  const goBack = () => {
    let prev = step - 1;
    while (prev > 0 && skipStep(prev)) prev -= 1;
    setStep(Math.max(prev, 0));
  };

  // ── Artikel/fritext-hantering ────────────────────────────────────────
  const addArticle = (a: ArticleOption) => {
    setArticleLines((prev) => {
      const existing = prev.find((l) => l.articleId === a.id);
      if (existing) {
        return prev.map((l) => (l.articleId === a.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          articleId: a.id,
          name: a.name,
          unit: a.unit || "st",
          listPriceOre: a.listPrice ?? 0,
          productionMinutes: a.productionTime ?? 0,
          quantity: 1,
        },
      ];
    });
  };

  const updateArticleQty = (articleId: string, qty: number) =>
    setArticleLines((prev) => prev.map((l) => (l.articleId === articleId ? { ...l, quantity: Math.max(1, qty) } : l)));
  const removeArticle = (articleId: string) =>
    setArticleLines((prev) => prev.filter((l) => l.articleId !== articleId));

  const addFreeText = () =>
    setFreeTextLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), description: "", unitPriceKr: 0, productionMinutes: 0, quantity: 1 },
    ]);
  const updateFreeText = (id: string, patch: Partial<FreeTextLine>) =>
    setFreeTextLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeFreeText = (id: string) => setFreeTextLines((prev) => prev.filter((l) => l.id !== id));

  // ── Skapa ────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setSubmitting(true);
    try {
      // Bygg rad-payload (artikel + fritext) en gång.
      const linePayloads = [
        ...articleLines.map((line) => ({
          articleId: line.articleId,
          quantity: line.quantity,
        })),
        ...freeTextLines
          .filter((line) => line.description.trim())
          .map((line) => ({
            description: line.description.trim(),
            unitPrice: Math.round(line.unitPriceKr * 100),
            productionMinutes: line.productionMinutes,
            quantity: line.quantity,
          })),
      ];

      let workOrderId: string;

      if (mode === "tillagg" && selectedOrder) {
        // Tillägg på befintlig order: ordern finns redan, posta bara raderna.
        // Ordern återskapas aldrig vid omförsök, så vi undviker dubbletter.
        workOrderId = selectedOrder.id;
        let lineFailures = 0;
        for (const line of linePayloads) {
          try {
            await apiRequest("POST", `/api/work-orders/${workOrderId}/lines`, line);
          } catch {
            lineFailures += 1;
          }
        }
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "lines"] });

        if (lineFailures > 0) {
          toast({
            title: "Uppgiften skapades med varning",
            description: `${lineFailures} rad(er) kunde inte läggas till. Öppna uppgiften och lägg till dem manuellt.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Uppgift tillagd på order", description: derivedTitle });
        }
      } else {
        // Ny uppgift: skapa work order + alla rader atomiskt i ETT anrop. Backend
        // kör allt i en DB-transaktion — om något felar skapas ingen partiell order.
        const workOrderPayload: Record<string, unknown> = {
          title: derivedTitle,
          orderType: "service",
        };
        if (kundType === "extern" && selectedCustomer) workOrderPayload.customerId = selectedCustomer.id;
        if (coupling === "objekt" && selectedObject) workOrderPayload.objectId = selectedObject.id;
        if (coupling === "kluster" && selectedCluster) workOrderPayload.clusterId = selectedCluster.id;
        if (deliveryStart) workOrderPayload.desiredDeliveryStart = deliveryStart;
        if (deliveryEnd) workOrderPayload.desiredDeliveryEnd = deliveryEnd;
        if (description.trim()) workOrderPayload.description = description.trim();
        if (plannedNotes.trim()) workOrderPayload.plannedNotes = plannedNotes.trim();

        const res = await apiRequest("POST", "/api/work-orders/with-lines", {
          workOrder: workOrderPayload,
          lines: linePayloads,
        });
        const wo = await res.json();
        workOrderId = wo.id;

        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "lines"] });

        toast({ title: "Enkel uppgift skapad", description: derivedTitle });
      }

      onCreated?.(workOrderId);
      onClose();
    } catch (err) {
      // Inget partiellt WO skapas (atomiskt skapande / tillägg på befintlig order),
      // så det är säkert att försöka igen.
      toast({
        title: "Kunde inte skapa uppgiften",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" data-testid="dialog-enkel-uppgift">
        <DialogHeader>
          <DialogTitle data-testid="text-enkel-uppgift-title">Skapa enkel uppgift</DialogTitle>
          <DialogDescription>
            Steg {step + 1} av {STEP_TITLES.length}: {STEP_TITLES[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Stegindikator */}
        <div className="flex items-center gap-1.5" data-testid="enkel-uppgift-steps">
          {STEP_TITLES.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        <ScrollArea className="flex-1 -mx-1 px-1">
          <div className="py-2 space-y-4">
            {/* ── STEG 1 ── */}
            {step === 0 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Är detta ett tillägg på en befintlig order?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMode("tillagg")}
                    className={`rounded-lg border p-4 text-left transition hover-elevate ${mode === "tillagg" ? "border-primary bg-primary/5" : ""}`}
                    data-testid="button-mode-tillagg"
                  >
                    <Check className="h-5 w-5 mb-2 text-primary" />
                    <div className="font-medium text-sm">Ja, tillägg på befintlig order</div>
                    <div className="text-xs text-muted-foreground mt-1">Kund &amp; prislista ärvs</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("ny")}
                    className={`rounded-lg border p-4 text-left transition hover-elevate ${mode === "ny" ? "border-primary bg-primary/5" : ""}`}
                    data-testid="button-mode-ny"
                  >
                    <Plus className="h-5 w-5 mb-2 text-primary" />
                    <div className="font-medium text-sm">Ny uppgift (fristående)</div>
                    <div className="text-xs text-muted-foreground mt-1">Välj kund &amp; objekt</div>
                  </button>
                </div>

                {mode === "tillagg" && (
                  <div className="space-y-2">
                    <Label>Sök befintlig order</Label>
                    <div className="flex items-center gap-2 rounded-md border px-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                        placeholder="Sök order på namn..."
                        className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
                        data-testid="input-order-search"
                      />
                    </div>
                    {selectedOrder ? (
                      <Alert data-testid="alert-selected-order">
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          <div className="font-medium">{selectedOrder.title}</div>
                          {selectedOrder.customerName && (
                            <div className="text-xs text-muted-foreground">
                              Kund: {selectedOrder.customerName} (ärvs, ej redigerbar)
                            </div>
                          )}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="rounded-md border divide-y max-h-48 overflow-auto">
                        {ordersFetching && (
                          <div className="p-3 text-center text-xs text-muted-foreground">Laddar...</div>
                        )}
                        {!ordersFetching && (orderResults || []).map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => setSelectedOrder(o)}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                            data-testid={`option-order-${o.id}`}
                          >
                            <div className="font-medium truncate">{o.title}</div>
                            {o.customerName && (
                              <div className="text-xs text-muted-foreground truncate">{o.customerName}</div>
                            )}
                          </button>
                        ))}
                        {!ordersFetching && debouncedOrder.trim() && (orderResults || []).length === 0 && (
                          <div className="p-3 text-center text-xs text-muted-foreground">Inga order matchar</div>
                        )}
                        {!debouncedOrder.trim() && (
                          <div className="p-3 text-center text-xs text-muted-foreground">Skriv för att söka</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── STEG 2: Kund ── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setKundType("extern")}
                    className={`rounded-lg border p-4 text-left transition hover-elevate ${kundType === "extern" ? "border-primary bg-primary/5" : ""}`}
                    data-testid="button-kund-extern"
                  >
                    <Building2 className="h-5 w-5 mb-2 text-primary" />
                    <div className="font-medium text-sm">Extern (faktureras)</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setKundType("intern"); setSelectedCustomer(null); }}
                    className={`rounded-lg border p-4 text-left transition hover-elevate ${kundType === "intern" ? "border-primary bg-primary/5" : ""}`}
                    data-testid="button-kund-intern"
                  >
                    <Home className="h-5 w-5 mb-2 text-primary" />
                    <div className="font-medium text-sm">Intern (Kinab)</div>
                  </button>
                </div>

                {kundType === "extern" && (
                  <div className="space-y-2">
                    <Label>Kund (valfritt)</Label>
                    <div className="flex items-center gap-2 rounded-md border px-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Sök kund..."
                        className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
                        data-testid="input-customer-search"
                      />
                    </div>
                    <div className="rounded-md border divide-y max-h-48 overflow-auto">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomer(null)}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                        data-testid="option-customer-none"
                      >
                        <span className="text-muted-foreground">Ingen kund (behandlas som intern)</span>
                        {selectedCustomer === null && <Check className="h-4 w-4" />}
                      </button>
                      {customersFetching && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Laddar...</div>
                      )}
                      {(customerResults || []).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCustomer(c)}
                          className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                          data-testid={`option-customer-${c.id}`}
                        >
                          <span className="truncate">
                            {c.name}
                            {c.customerNumber && (
                              <span className="text-muted-foreground"> (#{c.customerNumber})</span>
                            )}
                          </span>
                          {selectedCustomer?.id === c.id && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Väljs ingen kund behandlas uppgiften som intern.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── STEG 3: Objekt/kluster ── */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  {(["objekt", "kluster", "ingen"] as Coupling[]).map((c) => (
                    <Button
                      key={c}
                      type="button"
                      variant={coupling === c ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCoupling(c)}
                      data-testid={`button-coupling-${c}`}
                    >
                      {c === "objekt" ? "Objekt" : c === "kluster" ? "Kluster" : "Ingen koppling"}
                    </Button>
                  ))}
                </div>

                {coupling === "objekt" && (
                  <div className="space-y-2">
                    <Label>Sök objekt (visar släktnamn)</Label>
                    <div className="flex items-center gap-2 rounded-md border px-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        value={objectSearch}
                        onChange={(e) => setObjectSearch(e.target.value)}
                        placeholder="Sök på namn, adress eller objektnummer..."
                        className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
                        data-testid="input-object-search"
                      />
                    </div>
                    {selectedObject && (
                      <Alert data-testid="alert-selected-object">
                        <Package className="h-4 w-4" />
                        <AlertDescription>
                          <div className="font-medium">{selectedObject.name}</div>
                          {selectedObject.displayName && selectedObject.displayName !== selectedObject.name && (
                            <div className="text-xs text-muted-foreground">{selectedObject.displayName}</div>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="rounded-md border divide-y max-h-48 overflow-auto">
                      {objectsFetching && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Laddar...</div>
                      )}
                      {!objectsFetching && (objectResults || []).map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setSelectedObject(o)}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                          data-testid={`option-object-${o.id}`}
                        >
                          <div className="font-medium truncate">
                            {o.name}
                            {o.objectNumber && <span className="text-muted-foreground font-normal"> (#{o.objectNumber})</span>}
                          </div>
                          {o.displayName && o.displayName !== o.name && (
                            <div className="text-xs text-muted-foreground truncate">{o.displayName}</div>
                          )}
                        </button>
                      ))}
                      {!objectsFetching && debouncedObject.trim() && (objectResults || []).length === 0 && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Inga objekt matchar</div>
                      )}
                      {!debouncedObject.trim() && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Skriv för att söka</div>
                      )}
                    </div>
                    <Alert variant="default" className="border-warning/40">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        Geografiska uppdrag kräver ett kopplat objekt.
                      </AlertDescription>
                    </Alert>
                  </div>
                )}

                {coupling === "kluster" && (
                  <div className="space-y-2">
                    <Label>Välj kluster</Label>
                    <div className="rounded-md border divide-y max-h-48 overflow-auto">
                      {(clusterResults || []).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCluster(c)}
                          className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                          data-testid={`option-cluster-${c.id}`}
                        >
                          <span className="truncate">{c.name}</span>
                          {selectedCluster?.id === c.id && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      ))}
                      {(clusterResults || []).length === 0 && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Inga kluster</div>
                      )}
                    </div>
                    {selectedCluster && (
                      <Alert variant="default" className="border-warning/40" data-testid="alert-cluster-guard">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Uppgiften gäller endast detta kluster och multipliceras inte nedåt i hierarkin.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                {coupling === "ingen" && (
                  <Alert data-testid="alert-coupling-none">
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Uppgiften skapas utan objektkoppling (endast internt). Geografiska uppdrag kräver objekt.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* ── STEG 4: Leveranstid ── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Startdatum/-tid (valfritt)</Label>
                    <Input
                      type="datetime-local"
                      value={deliveryStart}
                      onChange={(e) => setDeliveryStart(e.target.value)}
                      data-testid="input-delivery-start"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Slutdatum/-tid (valfritt)</Label>
                    <Input
                      type="datetime-local"
                      value={deliveryEnd}
                      onChange={(e) => setDeliveryEnd(e.target.value)}
                      data-testid="input-delivery-end"
                    />
                  </div>
                </div>
                <Alert>
                  <Clock className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Lämnas tomt = "Ska göras så snart som möjligt".
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {/* ── STEG 5: Artiklar & fritext ── */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Sök bland artiklar</Label>
                  <div className="flex items-center gap-2 rounded-md border px-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      value={articleSearch}
                      onChange={(e) => setArticleSearch(e.target.value)}
                      placeholder="Sök artikel..."
                      className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
                      data-testid="input-article-search"
                    />
                  </div>
                  {debouncedArticle.trim() && (
                    <div className="rounded-md border divide-y max-h-40 overflow-auto">
                      {articlesFetching && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Laddar...</div>
                      )}
                      {!articlesFetching && (articleResults || []).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => addArticle(a)}
                          className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                          data-testid={`option-article-${a.id}`}
                        >
                          <span className="truncate">
                            {a.name}
                            <span className="text-muted-foreground"> · {formatSekFromOre(a.listPrice ?? 0)}/{a.unit || "st"}</span>
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-primary" />
                        </button>
                      ))}
                      {!articlesFetching && (articleResults || []).length === 0 && (
                        <div className="p-3 text-center text-xs text-muted-foreground">Inga artiklar matchar</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Valda artiklar */}
                {articleLines.length > 0 && (
                  <div className="space-y-2">
                    <Label>Valda artiklar</Label>
                    {articleLines.map((l) => (
                      <div
                        key={l.articleId}
                        className="flex items-center gap-2 rounded-md border p-2"
                        data-testid={`line-article-${l.articleId}`}
                      >
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{l.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatSekFromOre(l.listPriceOre)}/{l.unit} · {l.productionMinutes} min/{l.unit}
                          </div>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => updateArticleQty(l.articleId, parseInt(e.target.value) || 1)}
                          className="w-16 h-8"
                          data-testid={`input-article-qty-${l.articleId}`}
                        />
                        <div className="w-20 text-right text-sm font-medium">
                          {formatSekFromOre(l.listPriceOre * l.quantity)}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => removeArticle(l.articleId)}
                          data-testid={`button-remove-article-${l.articleId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Fritext / blindgångare */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Fritext (blindgångare)</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addFreeText}
                      data-testid="button-add-freetext"
                    >
                      <PencilLine className="h-4 w-4 mr-1" /> Lägg till fritext
                    </Button>
                  </div>
                  {freeTextLines.map((l) => (
                    <div key={l.id} className="space-y-2 rounded-md border p-2" data-testid={`line-freetext-${l.id}`}>
                      <Textarea
                        value={l.description}
                        onChange={(e) => updateFreeText(l.id, { description: e.target.value })}
                        placeholder="Beskrivning av uppgift..."
                        rows={2}
                        data-testid={`input-freetext-desc-${l.id}`}
                      />
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Label className="text-xs">Antal</Label>
                          <Input
                            type="number"
                            min={1}
                            value={l.quantity}
                            onChange={(e) => updateFreeText(l.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                            className="h-8"
                            data-testid={`input-freetext-qty-${l.id}`}
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs">Pris (kr/st)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={l.unitPriceKr}
                            onChange={(e) => updateFreeText(l.id, { unitPriceKr: Math.max(0, parseFloat(e.target.value) || 0) })}
                            className="h-8"
                            data-testid={`input-freetext-price-${l.id}`}
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs">Tid (min/st)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={l.productionMinutes}
                            onChange={(e) => updateFreeText(l.id, { productionMinutes: Math.max(0, parseInt(e.target.value) || 0) })}
                            className="h-8"
                            data-testid={`input-freetext-min-${l.id}`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 mt-4 shrink-0"
                          onClick={() => removeFreeText(l.id)}
                          data-testid={`button-remove-freetext-${l.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />
                <div className="flex items-center justify-between text-sm font-medium" data-testid="text-line-totals">
                  <span>Totalt</span>
                  <span>
                    {formatSekFromOre(totalPriceOre)} · ~{totalMinutes} min
                  </span>
                </div>
              </div>
            )}

            {/* ── STEG 6: Sammanfattning ── */}
            {step === 5 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Uppgiftsnamn</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={derivedTitle}
                    data-testid="input-title"
                  />
                </div>

                <div className="rounded-md border divide-y text-sm" data-testid="summary-enkel-uppgift">
                  <SummaryRow label="Uppgift" value={derivedTitle} />
                  <SummaryRow
                    label="Kund"
                    value={
                      mode === "tillagg"
                        ? selectedOrder?.customerName || "Ärvs från order"
                        : kundType === "intern" || !selectedCustomer
                          ? "Intern (Kinab)"
                          : selectedCustomer.name
                    }
                  />
                  <SummaryRow
                    label="Koppling"
                    value={
                      mode === "tillagg"
                        ? selectedOrder?.title || "Order"
                        : coupling === "objekt"
                          ? selectedObject?.displayName || selectedObject?.name || "—"
                          : coupling === "kluster"
                            ? selectedCluster?.name || "—"
                            : "Ingen koppling (internt)"
                    }
                  />
                  {mode === "tillagg" && selectedOrder && (
                    <SummaryRow label="Order" value={`${selectedOrder.title} (tillägg)`} />
                  )}
                  <SummaryRow label="Pris" value={formatSekFromOre(totalPriceOre)} />
                  <SummaryRow label="Tid" value={`~${totalMinutes} min`} />
                  <SummaryRow
                    label="Leverans"
                    value={mode === "tillagg" ? "Ärvs från order" : deliveryStart ? deliveryStart.replace("T", " ") : "Omedelbart"}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Beskrivning (valfritt)</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="Beskrivning..."
                    data-testid="input-description"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Meddelande till utföraren (valfritt)</Label>
                  <Textarea
                    value={plannedNotes}
                    onChange={(e) => setPlannedNotes(e.target.value)}
                    rows={2}
                    placeholder="Meddelande..."
                    data-testid="input-planned-notes"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {articleLines.map((l) => (
                    <Badge key={l.articleId} variant="secondary" data-testid={`badge-summary-article-${l.articleId}`}>
                      {l.name} ×{l.quantity}
                    </Badge>
                  ))}
                  {freeTextLines.filter((l) => l.description.trim()).map((l) => (
                    <Badge key={l.id} variant="outline" data-testid={`badge-summary-freetext-${l.id}`}>
                      {l.description.slice(0, 24)} ×{l.quantity}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={step === 0 ? onClose : goBack}
            disabled={submitting}
            data-testid="button-back"
          >
            {step === 0 ? "Avbryt" : "Tillbaka"}
          </Button>
          {step < STEP_TITLES.length - 1 ? (
            <Button type="button" onClick={goNext} disabled={!canProceed} data-testid="button-next">
              Nästa
            </Button>
          ) : (
            <Button type="button" onClick={handleCreate} disabled={submitting || !hasLines} data-testid="button-create">
              {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Skapa uppgift
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
