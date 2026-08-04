import { useCallback, useEffect, useMemo, useState } from "react";
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
  CalendarClock,
  Layers,
  X,
  User,
  Phone,
  Truck,
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

interface ResourceOption {
  id: string;
  name: string;
  initials?: string | null;
  status?: string | null;
}

interface Placement {
  resourceId: string;
  resourceName: string;
  scheduledDate: string; // yyyy-mm-dd
  scheduledStartTime?: string; // HH:MM
}

type Mode = "tillagg" | "ny";
type Coupling = "objekt" | "ingen";

// G7: obundna uppgiftsmallar — snabbskapa fristående uppgifter utan objekt-/klusterkoppling.
const UNBOUND_TASK_TEMPLATES: Array<{
  key: string;
  title: string;
  description: string;
  icon: typeof Phone;
}> = [
  {
    key: "telefonsamtal",
    title: "Telefonsamtal",
    description: "Ring kund/kontakt och stäm av ärendet.",
    icon: Phone,
  },
  {
    key: "fordonskontroll",
    title: "Fordonskontroll",
    description: "Kontrollera fordonets skick (däck, vätskor, belysning).",
    icon: Truck,
  },
];

interface DraftPayload {
  mode: Mode | null;
  selectedOrder: WorkOrderOption | null;
  kundType: "extern" | "intern";
  selectedCustomer: CustomerOption | null;
  coupling: Coupling;
  selectedObject: ObjectOption | null;
  deliveryStart: string;
  deliveryEnd: string;
  articleLines: ArticleLine[];
  freeTextLines: FreeTextLine[];
  title: string;
  description: string;
  plannedNotes: string;
  placement: Placement | null;
}

interface BatchDraft extends DraftPayload {
  draftId: string;
  derivedTitle: string;
  totalPriceOre: number;
  totalMinutes: number;
}

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

  // Steg 6 – direkt-schemaläggning (valfri)
  const [placementEnabled, setPlacementEnabled] = useState(false);
  const [placementResource, setPlacementResource] = useState<ResourceOption | null>(null);
  const [placementResourceSearch, setPlacementResourceSearch] = useState("");
  const [placementDate, setPlacementDate] = useState("");
  const [placementTime, setPlacementTime] = useState("");

  // Batch – flera uppgifter byggs upp och skapas i ett svep
  const [batchDrafts, setBatchDrafts] = useState<BatchDraft[]>([]);

  const debouncedResource = useDebounced(placementResourceSearch);
  const debouncedOrder = useDebounced(orderSearch);
  const debouncedCustomer = useDebounced(customerSearch);
  const debouncedObject = useDebounced(objectSearch);
  const debouncedArticle = useDebounced(articleSearch);

  // Nollställ alla formulärfält till ett rent utgångsläge (rör ej batch-listan).
  const resetForm = useCallback(() => {
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
    setPlacementEnabled(false);
    setPlacementResource(null);
    setPlacementResourceSearch("");
    setPlacementDate("");
    setPlacementTime("");
    if (presetObjectId) {
      setCoupling("objekt");
      setSelectedObject({ id: presetObjectId, name: presetObjectName || "Valt objekt", displayName: presetObjectName });
    } else {
      setCoupling("objekt");
      setSelectedObject(null);
    }
  }, [presetObjectId, presetObjectName]);

  // Reset vid öppning (rensar även batch-listan så varje session börjar tomt).
  useEffect(() => {
    if (!open) return;
    resetForm();
    setBatchDrafts([]);
  }, [open, resetForm]);

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

  const { data: resourceResults, isFetching: resourcesFetching } = useQuery<ResourceOption[]>({
    queryKey: ["/api/resources", "enkel-placement"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/resources`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta resurser");
      return (await res.json()) as ResourceOption[];
    },
    enabled: open && step === 5 && placementEnabled,
    staleTime: 60000,
  });

  const filteredResources = useMemo(() => {
    const list = (resourceResults || []).filter((r) => (r.status ?? "active") !== "inactive");
    const q = debouncedResource.trim().toLowerCase();
    if (!q) return list.slice(0, 30);
    return list
      .filter((r) => r.name?.toLowerCase().includes(q) || (r.initials ?? "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [resourceResults, debouncedResource]);

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
        return true; // ingen koppling
      case 3:
        return true; // leveranstid valfri
      case 4:
        return hasLines;
      default:
        return true;
    }
  }, [step, mode, selectedOrder, coupling, selectedObject, hasLines]);

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

  // ── Direkt-schemaläggning ────────────────────────────────────────────
  const currentPlacement = useMemo<Placement | null>(() => {
    if (!placementEnabled || !placementResource || !placementDate) return null;
    return {
      resourceId: placementResource.id,
      resourceName: placementResource.name,
      scheduledDate: placementDate,
      scheduledStartTime: placementTime || undefined,
    };
  }, [placementEnabled, placementResource, placementDate, placementTime]);

  // ── Draft-hantering (batch) ──────────────────────────────────────────
  const buildCurrentDraft = useCallback((): DraftPayload => ({
    mode,
    selectedOrder,
    kundType,
    selectedCustomer,
    coupling,
    selectedObject,
    deliveryStart,
    deliveryEnd,
    articleLines,
    freeTextLines,
    title,
    description,
    plannedNotes,
    placement: currentPlacement,
  }), [mode, selectedOrder, kundType, selectedCustomer, coupling, selectedObject, deliveryStart, deliveryEnd, articleLines, freeTextLines, title, description, plannedNotes, currentPlacement]);

  const addCurrentToBatch = useCallback(() => {
    if (!hasLines) return;
    const draft: BatchDraft = {
      ...buildCurrentDraft(),
      draftId: crypto.randomUUID(),
      derivedTitle,
      totalPriceOre,
      totalMinutes,
    };
    setBatchDrafts((prev) => [...prev, draft]);
    resetForm();
  }, [hasLines, buildCurrentDraft, derivedTitle, totalPriceOre, totalMinutes, resetForm]);

  const removeDraft = useCallback((draftId: string) => {
    setBatchDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
  }, []);

  // ── Skapa ────────────────────────────────────────────────────────────
  // Skapar EN uppgift utifrån en draft. Returnerar antal misslyckade rader.
  // Order-skapandet sker en gång; rader och placering är best-effort så att
  // en redan skapad order aldrig dubbleras vid delfel.
  const createOne = async (draft: DraftPayload): Promise<{ workOrderId: string; lineFailures: number; placementFailed: boolean }> => {
    let workOrderId: string;
    const draftTitle =
      draft.title.trim() ||
      draft.articleLines[0]?.name ||
      draft.freeTextLines.find((l) => l.description.trim())?.description.trim() ||
      "Enkel uppgift";

    // Bygg rad-payload (artikel + fritext) en gång.
    const linePayloads = [
      ...draft.articleLines.map((line) => ({
        articleId: line.articleId,
        quantity: line.quantity,
      })),
      ...draft.freeTextLines
        .filter((line) => line.description.trim())
        .map((line) => ({
          description: line.description.trim(),
          unitPrice: Math.round(line.unitPriceKr * 100),
          productionMinutes: line.productionMinutes,
          quantity: line.quantity,
        })),
    ];

    let lineFailures = 0;

    if (draft.mode === "tillagg" && draft.selectedOrder) {
      // Tillägg på befintlig order: ordern finns redan, posta bara raderna.
      // Ordern återskapas aldrig vid omförsök, så vi undviker dubbletter.
      workOrderId = draft.selectedOrder.id;
      for (const line of linePayloads) {
        try {
          await apiRequest("POST", `/api/work-orders/${workOrderId}/lines`, line);
        } catch {
          lineFailures += 1;
        }
      }
    } else {
      // Ny uppgift: skapa work order + alla rader atomiskt i ETT anrop. Backend
      // kör allt i en DB-transaktion — om något felar skapas ingen partiell order.
      const payload: Record<string, unknown> = {
        title: draftTitle,
        orderType: "service",
      };
      if (draft.kundType === "extern" && draft.selectedCustomer) payload.customerId = draft.selectedCustomer.id;
      if (draft.coupling === "objekt" && draft.selectedObject) payload.objectId = draft.selectedObject.id;
      if (draft.deliveryStart) payload.desiredDeliveryStart = draft.deliveryStart;
      if (draft.deliveryEnd) payload.desiredDeliveryEnd = draft.deliveryEnd;
      if (draft.description.trim()) payload.description = draft.description.trim();
      if (draft.plannedNotes.trim()) payload.plannedNotes = draft.plannedNotes.trim();

      const woRes = await apiRequest("POST", "/api/work-orders/with-lines", {
        workOrder: payload,
        lines: linePayloads,
      });
      const wo = await woRes.json();
      workOrderId = wo.id;
    }

    // Direkt-schemaläggning: schemalägg direkt på vald resurs/dag (best-effort).
    let placementFailed = false;
    if (draft.placement) {
      try {
        const placePayload: Record<string, unknown> = {
          resourceId: draft.placement.resourceId,
          scheduledDate: draft.placement.scheduledDate,
          orderStatus: "planerad_resurs",
        };
        if (draft.placement.scheduledStartTime) placePayload.scheduledStartTime = draft.placement.scheduledStartTime;
        await apiRequest("PATCH", `/api/work-orders/${workOrderId}`, placePayload);
      } catch {
        placementFailed = true;
      }
    }

    return { workOrderId, lineFailures, placementFailed };
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const draft = buildCurrentDraft();
      const { workOrderId, lineFailures, placementFailed } = await createOne(draft);

      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "lines"] });

      if (lineFailures > 0 || placementFailed) {
        const parts: string[] = [];
        if (lineFailures > 0) parts.push(`${lineFailures} rad(er) kunde inte läggas till`);
        if (placementFailed) parts.push("schemaläggningen misslyckades");
        toast({
          title: "Uppgiften skapades med varning",
          description: `${parts.join(" och ")}. Öppna uppgiften och åtgärda manuellt.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: draft.mode === "tillagg" ? "Uppgift tillagd på order" : "Enkel uppgift skapad",
          description: draft.placement ? `${derivedTitle} · schemalagd` : derivedTitle,
        });
      }

      onCreated?.(workOrderId);
      onClose();
    } catch (err) {
      // Inget partiellt WO skapas (atomiskt skapande via /with-lines eller tillägg
      // på befintlig order), så det är säkert att försöka igen.
      toast({
        title: "Kunde inte skapa uppgiften",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Skapar/kvitterar alla batch-drafts (plus aktuell om den har rader) i ett svep.
  const handleCreateAll = async () => {
    const drafts: DraftPayload[] = [...batchDrafts];
    if (hasLines) drafts.push(buildCurrentDraft());
    if (drafts.length === 0) return;

    setSubmitting(true);
    let created = 0;
    let failed = 0;
    let totalLineFailures = 0;
    let placementFailures = 0;
    let lastWorkOrderId: string | null = null;

    for (const draft of drafts) {
      try {
        const { workOrderId, lineFailures, placementFailed } = await createOne(draft);
        created += 1;
        totalLineFailures += lineFailures;
        if (placementFailed) placementFailures += 1;
        lastWorkOrderId = workOrderId;
        onCreated?.(workOrderId);
      } catch {
        failed += 1;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    if (lastWorkOrderId) {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", lastWorkOrderId, "lines"] });
    }

    const warnings: string[] = [];
    if (failed > 0) warnings.push(`${failed} kunde inte skapas`);
    if (totalLineFailures > 0) warnings.push(`${totalLineFailures} rad(er) misslyckades`);
    if (placementFailures > 0) warnings.push(`${placementFailures} placering(ar) misslyckades`);

    if (warnings.length > 0) {
      toast({
        title: created > 0 ? `${created} uppgift(er) skapade med varning` : "Kunde inte skapa uppgifterna",
        description: warnings.join(", "),
        variant: "destructive",
      });
    } else {
      toast({
        title: `${created} uppgifter skapade`,
        description: "Alla uppgifter kvitterades i ett svep.",
      });
    }

    setSubmitting(false);
    if (created > 0) onClose();
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

        {/* Batch-kö: uppgifter som byggts upp och skapas i ett svep */}
        {batchDrafts.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-2 space-y-1.5" data-testid="batch-queue">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              {batchDrafts.length} uppgift(er) i kön — skapas tillsammans
            </div>
            <div className="space-y-1 max-h-28 overflow-auto">
              {batchDrafts.map((d) => (
                <div
                  key={d.draftId}
                  className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs"
                  data-testid={`batch-item-${d.draftId}`}
                >
                  <span className="truncate">
                    {d.derivedTitle}
                    <span className="text-muted-foreground"> · {formatSekFromOre(d.totalPriceOre)} · ~{d.totalMinutes} min</span>
                    {d.placement && (
                      <span className="text-muted-foreground"> · {d.placement.resourceName}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => removeDraft(d.draftId)}
                    data-testid={`button-remove-draft-${d.draftId}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

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

                {mode === "ny" && (
                  <div className="space-y-2" data-testid="section-task-templates">
                    <Label className="text-xs text-muted-foreground">Snabbmallar (utan koppling)</Label>
                    <div className="flex flex-wrap gap-2">
                      {UNBOUND_TASK_TEMPLATES.map((tpl) => {
                        const Icon = tpl.icon;
                        const active = coupling === "ingen" && title === tpl.title;
                        return (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => {
                              setMode("ny");
                              setCoupling("ingen");
                              setSelectedObject(null);
                                                        setTitle(tpl.title);
                              setDescription(tpl.description);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition hover-elevate ${active ? "border-primary bg-primary/5 text-primary" : ""}`}
                            data-testid={`button-template-${tpl.key}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {tpl.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

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
                  {(["objekt", "ingen"] as Coupling[]).map((c) => (
                    <Button
                      key={c}
                      type="button"
                      variant={coupling === c ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCoupling(c)}
                      data-testid={`button-coupling-${c}`}
                    >
                      {c === "objekt" ? "Objekt" : "Ingen koppling"}
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
                      {/* Task #1088: servern cappar sökningen på 200 träffar — visa
                          tydligt att listan är avkortad så användaren förfinar. */}
                      {!objectsFetching && (objectResults || []).length >= 200 && (
                        <div className="p-3 text-center text-xs text-muted-foreground" data-testid="text-object-search-truncated">
                          Fler träffar kan finnas — förfina sökningen för att hitta rätt objekt.
                        </div>
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

                {/* Direkt-schemaläggning: schemalägg direkt på en resurs/dag */}
                <Separator />
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setPlacementEnabled((v) => !v)}
                    className={`w-full rounded-lg border p-3 text-left transition hover-elevate ${placementEnabled ? "border-primary bg-primary/5" : ""}`}
                    data-testid="button-toggle-placement"
                  >
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">Schemalägg direkt (valfritt)</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Schemalägg uppgiften på en resurs i stället för att lägga den bland oplanerade.
                        </div>
                      </div>
                      <div className={`h-4 w-4 rounded-full border shrink-0 ${placementEnabled ? "bg-primary border-primary" : ""}`}>
                        {placementEnabled && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    </div>
                  </button>

                  {placementEnabled && (
                    <div className="space-y-3 rounded-md border p-3" data-testid="placement-panel">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Resurs</Label>
                        {placementResource ? (
                          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                            <span className="flex items-center gap-2 truncate">
                              <User className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="truncate" data-testid="text-selected-resource">{placementResource.name}</span>
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => { setPlacementResource(null); setPlacementResourceSearch(""); }}
                              data-testid="button-clear-resource"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2 rounded-md border px-2">
                              <Search className="h-4 w-4 text-muted-foreground" />
                              <Input
                                value={placementResourceSearch}
                                onChange={(e) => setPlacementResourceSearch(e.target.value)}
                                placeholder="Sök resurs..."
                                className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
                                data-testid="input-resource-search"
                              />
                            </div>
                            <div className="rounded-md border divide-y max-h-40 overflow-auto">
                              {resourcesFetching && (
                                <div className="p-3 text-center text-xs text-muted-foreground">Laddar...</div>
                              )}
                              {!resourcesFetching && filteredResources.map((r) => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => setPlacementResource(r)}
                                  className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                                  data-testid={`option-resource-${r.id}`}
                                >
                                  {r.name}
                                </button>
                              ))}
                              {!resourcesFetching && filteredResources.length === 0 && (
                                <div className="p-3 text-center text-xs text-muted-foreground">Inga resurser</div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-xs">Dag</Label>
                          <Input
                            type="date"
                            value={placementDate}
                            onChange={(e) => setPlacementDate(e.target.value)}
                            data-testid="input-placement-date"
                          />
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <Label className="text-xs">Starttid (valfri)</Label>
                          <Input
                            type="time"
                            value={placementTime}
                            onChange={(e) => setPlacementTime(e.target.value)}
                            data-testid="input-placement-time"
                          />
                        </div>
                      </div>
                      {placementEnabled && (!placementResource || !placementDate) && (
                        <p className="text-xs text-muted-foreground" data-testid="text-placement-hint">
                          Välj resurs och dag för att placera direkt — annars skapas uppgiften oplanerad.
                        </p>
                      )}
                    </div>
                  )}
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={addCurrentToBatch}
                disabled={submitting || !hasLines}
                data-testid="button-add-to-batch"
              >
                <Layers className="h-4 w-4 mr-1" />
                Lägg till fler
              </Button>
              {batchDrafts.length > 0 ? (
                <Button
                  type="button"
                  onClick={handleCreateAll}
                  disabled={submitting || (batchDrafts.length === 0 && !hasLines)}
                  data-testid="button-create-all"
                >
                  {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Skapa alla ({batchDrafts.length + (hasLines ? 1 : 0)})
                </Button>
              ) : (
                <Button type="button" onClick={handleCreate} disabled={submitting || !hasLines} data-testid="button-create">
                  {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Skapa uppgift
                </Button>
              )}
            </div>
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
