import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Trash2,
  Loader2,
  Package,
  PencilLine,
  ShoppingCart,
  Building2,
  MapPin,
  ChevronDown,
  ChevronRight,
  Info,
  Check,
  User,
  X,
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
}

interface ObjectHit {
  id: string;
  name: string;
  objectNumber?: string | null;
  address?: string | null;
}

interface DraftLine {
  id: string;
  articleId: string | null; // null = fritextrad
  label: string | null; // "Namn" för artikelrader
  articleNumber: string | null;
  unit: string | null;
  listPriceOre: number | null; // artikelrad: listpris/enhet i öre
  description: string; // fritext / notering
  unitPriceKr: number; // fritextrad: pris/enhet i kronor
  quantity: number;
}

/** En grupp i orderbyggaren: ordernivå (objectId=null) eller ett objekt. */
interface DraftGroup {
  id: string;
  objectId: string | null;
  label: string; // "Orderrad (utan objekt)" eller objektets namn/adress
  lines: DraftLine[];
}

type DeliveryPrinciple = "manual" | "objekt" | null;

const ORDER_LEVEL_GROUP_ID = "__order-level__";
const DRAFT_STORAGE_KEY = "snabborder-utkast-v1";

interface DraftState {
  step: number;
  customer: CustomerOption | null;
  deliveryDate: string;
  deliveryTimeFrom: string;
  deliveryTimeTo: string;
  kundreferens: string;
  varReferens: string;
  fakturaref1: string;
  fakturaref2: string;
  ovrigReferens: string;
  fakturatext: string;
  internKommentar: string;
  principle: DeliveryPrinciple;
  adressrad1: string;
  adressrad2: string;
  postnummer: string;
  ort: string;
  land: string;
  groups: DraftGroup[];
}

function emptyGroups(): DraftGroup[] {
  return [{ id: ORDER_LEVEL_GROUP_ID, objectId: null, label: "Orderrad (utan objekt)", lines: [] }];
}

const STEPS = [
  { n: 1, label: "Orderhuvud" },
  { n: 2, label: "Orderinnehåll" },
  { n: 3, label: "Bekräfta" },
] as const;

export default function SnabborderPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // ── Formulärstate ──────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  // Kundbyte medan objektgrupper finns kräver bekräftelse (objekten tillhör
  // den gamla kunden och måste tas bort — kund↔objekt-integritet).
  const [pendingCustomerSwitch, setPendingCustomerSwitch] = useState<CustomerOption | null>(null);

  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTimeFrom, setDeliveryTimeFrom] = useState("");
  const [deliveryTimeTo, setDeliveryTimeTo] = useState("");
  const [kundreferens, setKundreferens] = useState("");
  const [varReferens, setVarReferens] = useState("");
  const [fakturaref1, setFakturaref1] = useState("");
  const [fakturaref2, setFakturaref2] = useState("");
  const [ovrigReferens, setOvrigReferens] = useState("");
  const [fakturatext, setFakturatext] = useState("");
  const [internKommentar, setInternKommentar] = useState("");

  const [principle, setPrinciple] = useState<DeliveryPrinciple>(null);
  const [principleSwitchTarget, setPrincipleSwitchTarget] = useState<DeliveryPrinciple>(null);
  const [adressrad1, setAdressrad1] = useState("");
  const [adressrad2, setAdressrad2] = useState("");
  const [postnummer, setPostnummer] = useState("");
  const [ort, setOrt] = useState("");
  const [land, setLand] = useState("Sverige");

  const [groups, setGroups] = useState<DraftGroup[]>(emptyGroups);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addTargetGroupId, setAddTargetGroupId] = useState<string>(ORDER_LEVEL_GROUP_ID);

  // Artikel-/objektväljare
  const [articlePickerOpen, setArticlePickerOpen] = useState(false);
  const [articleSearch, setArticleSearch] = useState("");
  const [debouncedArticle, setDebouncedArticle] = useState("");
  const [objectPickerOpen, setObjectPickerOpen] = useState(false);
  const [objectSearch, setObjectSearch] = useState("");
  const [debouncedObject, setDebouncedObject] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [createdOrders, setCreatedOrders] = useState<Array<{ id: string; orderNumber: string | null; label: string }>>([]);
  const [done, setDone] = useState(false);
  const [draftBanner, setDraftBanner] = useState(false);
  const prefillDone = useRef(false);

  // ── Utkast (localStorage) ──────────────────────────────────────────────
  const snapshot = (): DraftState => ({
    step, customer, deliveryDate, deliveryTimeFrom, deliveryTimeTo,
    kundreferens, varReferens, fakturaref1, fakturaref2, ovrigReferens,
    fakturatext, internKommentar, principle,
    adressrad1, adressrad2, postnummer, ort, land, groups,
  });

  const restore = (d: DraftState) => {
    // Steg 1+2 är en gemensam redigeringssida — normalisera äldre utkast med step=2.
    setStep((d.step || 1) >= 3 ? 3 : 1);
    setCustomer(d.customer ?? null);
    setDeliveryDate(d.deliveryDate ?? "");
    setDeliveryTimeFrom(d.deliveryTimeFrom ?? "");
    setDeliveryTimeTo(d.deliveryTimeTo ?? "");
    setKundreferens(d.kundreferens ?? "");
    setVarReferens(d.varReferens ?? "");
    setFakturaref1(d.fakturaref1 ?? "");
    setFakturaref2(d.fakturaref2 ?? "");
    setOvrigReferens(d.ovrigReferens ?? "");
    setFakturatext(d.fakturatext ?? "");
    setInternKommentar(d.internKommentar ?? "");
    setPrinciple(d.principle ?? null);
    setAdressrad1(d.adressrad1 ?? "");
    setAdressrad2(d.adressrad2 ?? "");
    setPostnummer(d.postnummer ?? "");
    setOrt(d.ort ?? "");
    setLand(d.land ?? "Sverige");
    setGroups(Array.isArray(d.groups) && d.groups.length > 0 ? d.groups : emptyGroups());
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot()));
      toast({ title: "Utkast sparat", description: "Du kan återuppta snabbordern senare från den här sidan." });
    } catch {
      toast({ title: "Kunde inte spara utkast", variant: "destructive" });
    }
  };

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* noop */ }
  };

  // Förifyllning från objektvyn (?customerId=&objectId=&objectName=&objectNumber=)
  // har företräde framför sparat utkast.
  useEffect(() => {
    if (prefillDone.current) return;
    prefillDone.current = true;
    const params = new URLSearchParams(window.location.search);
    const objectId = params.get("objectId");
    const customerId = params.get("customerId");
    if (objectId) {
      const label = params.get("objectName") || params.get("objectNumber") || "Objekt";
      setPrinciple("objekt");
      const gid = crypto.randomUUID();
      setGroups([...emptyGroups(), { id: gid, objectId, label, lines: [] }]);
      setAddTargetGroupId(gid);
      if (customerId) setPendingCustomerId(customerId);
      return;
    }
    if (customerId) setPendingCustomerId(customerId);
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) setDraftBanner(true);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pendingCustomerId, setPendingCustomerId] = useState<string | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────
  const { data: customers = [] } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers", "snabborder-customers"],
    queryFn: async () => {
      const res = await fetch(versionedUrl("/api/customers"), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta kunder");
      return (await res.json()) as CustomerOption[];
    },
    staleTime: 30000,
  });

  // Lös förifylld kund när kundlistan finns.
  useEffect(() => {
    if (!pendingCustomerId || customer || customers.length === 0) return;
    const match = customers.find((c) => c.id === pendingCustomerId);
    if (match) setCustomer(match);
    setPendingCustomerId(null);
  }, [pendingCustomerId, customer, customers]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers
      .filter((c) => c.name?.toLowerCase().includes(q) || (c.customerNumber ?? "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [customers, customerSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedArticle(articleSearch), 250);
    return () => clearTimeout(t);
  }, [articleSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedObject(objectSearch), 250);
    return () => clearTimeout(t);
  }, [objectSearch]);

  const { data: articleResults = [], isFetching: articlesFetching } = useQuery<ArticleOption[]>({
    queryKey: ["/api/articles", "snabborder-article-search", debouncedArticle],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (debouncedArticle.trim()) params.set("search", debouncedArticle.trim());
      const res = await fetch(versionedUrl(`/api/articles?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta artiklar");
      const data = await res.json();
      return (Array.isArray(data) ? data : data?.data ?? []) as ArticleOption[];
    },
    enabled: articlePickerOpen && debouncedArticle.trim().length > 0,
    staleTime: 15000,
  });

  const { data: objectHits = [], isFetching: objectsFetching } = useQuery<ObjectHit[]>({
    queryKey: ["/api/customers", customer?.id, "objects", "snabborder-search", debouncedObject],
    queryFn: async () => {
      const res = await fetch(
        versionedUrl(`/api/customers/${encodeURIComponent(customer!.id)}/objects/search?q=${encodeURIComponent(debouncedObject.trim())}&limit=30`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Kunde inte söka objekt");
      return (await res.json()) as ObjectHit[];
    },
    enabled: objectPickerOpen && !!customer && debouncedObject.trim().length > 0,
    staleTime: 15000,
  });

  // ── Innehålls-/principlogik ────────────────────────────────────────────
  const hasContent = useMemo(
    () => groups.some((g) => g.lines.length > 0) || groups.some((g) => g.objectId !== null),
    [groups],
  );

  const hasManualAddress = !!(adressrad1.trim() || postnummer.trim() || ort.trim());

  const requestPrinciple = (p: Exclude<DeliveryPrinciple, null>) => {
    if (principle === p) return;
    // Låst efter påbörjat innehåll som är knutet till principen (spec §7).
    const conflicting =
      (p === "manual" && groups.some((g) => g.objectId !== null)) ||
      (p === "objekt" && hasManualAddress);
    if (principle !== null && conflicting) {
      setPrincipleSwitchTarget(p);
      return;
    }
    setPrinciple(p);
  };

  const confirmPrincipleSwitch = () => {
    const p = principleSwitchTarget;
    setPrincipleSwitchTarget(null);
    if (!p) return;
    if (p === "manual") {
      // Ta bort objektgrupper — deras rader flyttas till ordernivå.
      setGroups((prev) => {
        const orderLevel = prev.find((g) => g.objectId === null) ?? emptyGroups()[0];
        const orphanLines = prev.filter((g) => g.objectId !== null).flatMap((g) => g.lines);
        return [{ ...orderLevel, lines: [...orderLevel.lines, ...orphanLines] }];
      });
      setAddTargetGroupId(ORDER_LEVEL_GROUP_ID);
    } else {
      setAdressrad1(""); setAdressrad2(""); setPostnummer(""); setOrt("");
      setAddTargetGroupId(ORDER_LEVEL_GROUP_ID);
    }
    setPrinciple(p);
  };

  // ── Radhantering ───────────────────────────────────────────────────────
  const addLineToGroup = (groupId: string, line: DraftLine) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, lines: [...g.lines, line] } : g)));
  };

  const addArticleLine = (a: ArticleOption) => {
    addLineToGroup(addTargetGroupId, {
      id: crypto.randomUUID(),
      articleId: a.id,
      label: a.name,
      articleNumber: a.articleNumber ?? null,
      unit: a.unit ?? "st",
      listPriceOre: a.listPrice ?? 0,
      description: "",
      unitPriceKr: 0,
      quantity: 1,
    });
    setArticleSearch("");
    setDebouncedArticle("");
    setArticlePickerOpen(false);
  };

  const addFreeTextLine = () => {
    addLineToGroup(addTargetGroupId, {
      id: crypto.randomUUID(),
      articleId: null,
      label: null,
      articleNumber: null,
      unit: "st",
      listPriceOre: null,
      description: "",
      unitPriceKr: 0,
      quantity: 1,
    });
  };

  const addObjectGroup = (o: ObjectHit) => {
    if (groups.some((g) => g.objectId === o.id)) {
      toast({ title: "Objektet är redan tillagt", description: o.name });
      setObjectPickerOpen(false);
      return;
    }
    const gid = crypto.randomUUID();
    setGroups((prev) => [...prev, {
      id: gid,
      objectId: o.id,
      label: [o.name, o.address].filter(Boolean).join(", "),
      lines: [],
    }]);
    setAddTargetGroupId(gid);
    setObjectSearch("");
    setDebouncedObject("");
    setObjectPickerOpen(false);
  };

  const updateLine = (groupId: string, lineId: string, patch: Partial<DraftLine>) => {
    setGroups((prev) => prev.map((g) =>
      g.id === groupId ? { ...g, lines: g.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) } : g,
    ));
  };

  const removeLine = (groupId: string, lineId: string) => {
    setGroups((prev) => prev.map((g) =>
      g.id === groupId ? { ...g, lines: g.lines.filter((l) => l.id !== lineId) } : g,
    ));
  };

  const removeGroup = (groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId || g.objectId === null));
    if (addTargetGroupId === groupId) setAddTargetGroupId(ORDER_LEVEL_GROUP_ID);
  };

  const lineTotalOre = (l: DraftLine): number => {
    const perUnit = l.articleId ? l.listPriceOre ?? 0 : Math.round(l.unitPriceKr * 100);
    return perUnit * l.quantity;
  };

  const totalOre = useMemo(
    () => groups.reduce((s, g) => s + g.lines.reduce((s2, l) => s2 + lineTotalOre(l), 0), 0),
    [groups],
  );

  const allLines = useMemo(() => groups.flatMap((g) => g.lines), [groups]);

  const selectCustomer = (c: CustomerOption) => {
    if (customer && customer.id !== c.id && groups.some((g) => g.objectId !== null)) {
      setPendingCustomerSwitch(c);
      return;
    }
    setCustomer(c);
    setCustomerOpen(false);
    setCustomerSearch("");
  };

  const confirmCustomerSwitch = () => {
    const c = pendingCustomerSwitch;
    setPendingCustomerSwitch(null);
    if (!c) return;
    // Ta bort objektgrupper (de tillhör den gamla kunden); ordernivå-rader behålls.
    setGroups((prev) => prev.filter((g) => g.objectId === null));
    setAddTargetGroupId(ORDER_LEVEL_GROUP_ID);
    setCustomer(c);
    setCustomerOpen(false);
    setCustomerSearch("");
  };

  // ── Validering ─────────────────────────────────────────────────────────
  const manualAddressValid = !!(adressrad1.trim() && postnummer.trim() && ort.trim());
  const headerValid = !!customer && principle !== null && (principle !== "manual" || manualAddressValid);
  const contentValid =
    allLines.length > 0 &&
    allLines.every((l) => (l.articleId ? true : l.description.trim().length > 0));
  const canSave = headerValid && contentValid && !submitting;

  const validationHints: string[] = [];
  if (!customer) validationHints.push("Välj kund");
  if (principle === null) validationHints.push("Välj leveransprincip");
  if (principle === "manual" && !manualAddressValid) validationHints.push("Ange leveransadress (adressrad 1, postnummer och ort)");
  if (allLines.length === 0) validationHints.push("Lägg till minst en orderrad");
  if (allLines.some((l) => !l.articleId && !l.description.trim())) validationHints.push("Fritextrader måste ha text");

  // ── Spara order ────────────────────────────────────────────────────────
  const buildNotes = (): string | undefined => {
    const parts: string[] = [];
    if (principle === "manual" && hasManualAddress) {
      const addr = [adressrad1.trim(), adressrad2.trim(), [postnummer.trim(), ort.trim()].filter(Boolean).join(" "), land.trim()]
        .filter(Boolean).join(", ");
      parts.push(`Leveransadress: ${addr}`);
    }
    if (ovrigReferens.trim()) parts.push(`Övrig referens: ${ovrigReferens.trim()}`);
    if (internKommentar.trim()) parts.push(internKommentar.trim());
    return parts.length > 0 ? parts.join("\n") : undefined;
  };

  const buildDesiredWindow = (): { start?: string; end?: string } => {
    if (!deliveryDate) return {};
    const start = `${deliveryDate}T${deliveryTimeFrom || "08:00"}:00`;
    const end = deliveryTimeTo ? `${deliveryDate}T${deliveryTimeTo}:00` : undefined;
    return { start, end };
  };

  const handleSaveOrder = async () => {
    if (!canSave || !customer) {
      if (validationHints.length > 0) {
        toast({ title: "Ordern är inte komplett", description: validationHints.join(" · "), variant: "destructive" });
      }
      return;
    }
    setSubmitting(true);

    // En arbetsorder per objekt + en för ordernivå-rader (wizard create-then-append:
    // per-order try/catch så ett radfel aldrig skapar dubblett-parent; lyckade
    // grupper töms ur formuläret så en omkörning inte skapar dubbletter).
    const jobs = groups
      .filter((g) => g.lines.length > 0)
      .map((g) => ({ group: g }));

    const window = buildDesiredWindow();
    const notes = buildNotes();
    // Task #1517: skicka manuell leveransadress strukturerat (inte bara som
    // notes-text) så servern kan geokoda den till uppgiftskoordinater och
    // Fortnox-underlag kan läsa den strukturerat.
    const deliveryAddress = principle === "manual" && hasManualAddress
      ? {
          adressrad1: adressrad1.trim(),
          adressrad2: adressrad2.trim() || undefined,
          postnummer: postnummer.trim(),
          ort: ort.trim(),
          land: land.trim() || undefined,
        }
      : undefined;
    const created: Array<{ id: string; orderNumber: string | null; label: string }> = [];
    const failures: string[] = [];

    for (const { group } of jobs) {
      const linePayloads = group.lines.map((l) => {
        if (l.articleId) {
          return { articleId: l.articleId, quantity: l.quantity, notes: l.description.trim() || undefined };
        }
        return { description: l.description.trim(), quantity: l.quantity, unitPrice: Math.round(l.unitPriceKr * 100) };
      });

      const workOrder: Record<string, unknown> = {
        title: group.objectId ? `Snabborder – ${group.label.split(",")[0]}` : `Snabborder – ${customer.name}`,
        orderType: "service",
        customerId: customer.id,
        sourceType: "snabborder",
      };
      if (group.objectId) workOrder.objectId = group.objectId;
      if (window.start) workOrder.desiredDeliveryStart = window.start;
      if (window.end) workOrder.desiredDeliveryEnd = window.end;
      if (kundreferens.trim()) workOrder.frozenCustomerReference = kundreferens.trim();
      if (varReferens.trim()) workOrder.frozenOurReference = varReferens.trim();
      if (fakturaref1.trim()) workOrder.frozenCustomerInvoiceReference = fakturaref1.trim();
      if (fakturaref2.trim()) workOrder.externalReference = fakturaref2.trim();
      if (fakturatext.trim()) workOrder.description = fakturatext.trim();
      if (notes) workOrder.notes = notes;

      try {
        const res = await apiRequest("POST", "/api/work-orders/with-lines", {
          workOrder,
          assignOrderNumber: true,
          lines: linePayloads,
          ...(deliveryAddress ? { deliveryAddress } : {}),
        });
        const wo = await res.json();
        created.push({ id: wo.id, orderNumber: wo.orderNumber ?? null, label: group.objectId ? group.label : "Utan objekt" });
        // Töm lyckad grupp så en eventuell omkörning inte dubbelskapar
        // (wizard create-then-append: ett radfel i nästa grupp får inte
        // köra om redan skapade ordrar).
        setGroups((prev) => prev
          .map((g) => (g.id === group.id ? { ...g, lines: [] } : g))
          .filter((g) => g.objectId === null || g.lines.length > 0));
      } catch (err) {
        failures.push(`${group.objectId ? group.label : "Utan objekt"}: ${err instanceof Error ? err.message : "Okänt fel"}`);
      }
    }

    setSubmitting(false);

    if (created.length > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
    }

    if (failures.length > 0) {
      toast({
        title: created.length > 0 ? "Delvis sparad" : "Kunde inte spara snabbordern",
        description: failures.join(" · "),
        variant: "destructive",
      });
      if (created.length > 0) setCreatedOrders((prev) => [...prev, ...created]);
      return;
    }

    clearDraft();
    setCreatedOrders(created);
    setDone(true);
  };

  const resetForm = () => {
    setStep(1);
    setCustomer(null);
    setDeliveryDate(""); setDeliveryTimeFrom(""); setDeliveryTimeTo("");
    setKundreferens(""); setVarReferens(""); setFakturaref1(""); setFakturaref2("");
    setOvrigReferens(""); setFakturatext(""); setInternKommentar("");
    setPrinciple(null);
    setAdressrad1(""); setAdressrad2(""); setPostnummer(""); setOrt(""); setLand("Sverige");
    setGroups(emptyGroups());
    setAddTargetGroupId(ORDER_LEVEL_GROUP_ID);
    setCreatedOrders([]);
    setDone(false);
  };

  // ── Render: klar-läge ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            <h1 className="text-2xl font-semibold" data-testid="text-snabborder-done">Snabborder sparad</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Uppgifterna skapas från artiklarna och levereras till Uppgiftsnavet. Systemets motorer
            beräknar och uppdaterar optimal tid, rutt m.m.
          </p>
          <div className="rounded-lg border divide-y mb-6">
            {createdOrders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => navigate(`/work-orders/${o.id}`)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent"
                data-testid={`link-created-order-${o.id}`}
              >
                <span className="text-sm font-medium">{o.orderNumber ?? "Order"}</span>
                <span className="text-sm text-muted-foreground truncate ml-3">{o.label}</span>
              </button>
            ))}
          </div>
          <Button onClick={resetForm} data-testid="button-new-snabborder">
            <Plus className="h-4 w-4 mr-1" /> Ny snabborder
          </Button>
        </div>
      </div>
    );
  }

  // ── Render: wizard ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Sidhuvud + stegindikator + knapprad */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <ShoppingCart className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight" data-testid="text-snabborder-title">Snabborder</h1>
              <p className="text-xs text-muted-foreground truncate">
                Skapa en order manuellt. Artiklar skapar uppgifter som levereras till Uppgiftsnavet.
                Du kan arbeta med eller utan objekt.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 mx-auto" data-testid="snabborder-steps">
            {STEPS.map((s, i) => {
              // Steg 1+2 redigeras på samma sida (mockupens layout): båda är
              // aktiva när formuläret visas; steg 3 är bekräftelse-läget.
              const isActive = step < 3 ? s.n <= 2 : s.n === 3;
              const isDone = step === 3 && s.n <= 2;
              return (
              <div key={s.n} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setStep(s.n <= 2 ? 1 : 3)}
                  // Bekräfta kräver giltigt orderhuvud + innehåll.
                  disabled={s.n === 3 && (!headerValid || !contentValid)}
                  className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid={`step-${s.n}`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isActive ? "bg-primary text-primary-foreground"
                        : isDone ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? <Check className="h-3.5 w-3.5" /> : s.n}
                  </span>
                  <span className={`text-xs ${isActive ? "font-medium" : "text-muted-foreground"}`}>{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <div className="w-6 h-px bg-border mx-1" />}
              </div>
            );})}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => window.history.back()} data-testid="button-snabborder-cancel">
              Avbryt
            </Button>
            <Button variant="outline" size="sm" onClick={saveDraft} data-testid="button-snabborder-save-draft">
              Spara utkast
            </Button>
            <Button size="sm" onClick={handleSaveOrder} disabled={!canSave} data-testid="button-snabborder-save-order">
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Spara order
            </Button>
          </div>
        </div>

        {draftBanner && (
          <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3" data-testid="banner-snabborder-draft">
            <span className="text-sm flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" /> Det finns ett sparat utkast.
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  try {
                    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
                    if (raw) restore(JSON.parse(raw) as DraftState);
                  } catch { /* noop */ }
                  setDraftBanner(false);
                }}
                data-testid="button-resume-draft"
              >
                Återuppta
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => { clearDraft(); setDraftBanner(false); }}
                data-testid="button-discard-draft"
              >
                <X className="h-4 w-4" /> Släng
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-start gap-6">
        <div className="flex-1 min-w-0">
        {/* ============== ORDERHUVUD + ORDERINNEHÅLL (en sida, enligt mockup) ============== */}
        {step < 3 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-5">
                <h2 className="text-sm font-semibold">Orderhuvud</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-4">
                  {/* Kolumn 1: Kund + referenser + fakturatext */}
                  <div className="space-y-4 min-w-0">
                  {/* Kund */}
                  <div className="space-y-1.5">
                    <Label>Kund <span className="text-destructive">*</span></Label>
                    {customer && !customerOpen ? (
                      <div className="flex items-center justify-between rounded-md border px-3 py-2" data-testid="selected-customer">
                        <span className="flex items-center gap-2 text-sm min-w-0">
                          <User className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{customer.name}</span>
                          {customer.customerNumber && (
                            <span className="text-muted-foreground font-mono text-xs shrink-0">{customer.customerNumber}</span>
                          )}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setCustomerOpen(true)} data-testid="button-change-customer">
                          Byt
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
                                onClick={() => selectCustomer(c)}
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

                  <div className="space-y-1.5">
                    <Label htmlFor="sb-kundreferens">Kundens referens</Label>
                    <Input id="sb-kundreferens" value={kundreferens} onChange={(e) => setKundreferens(e.target.value)} placeholder="T.ex. beställning via telefon" data-testid="input-kundreferens" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-varreferens">Vår referens</Label>
                    <Input id="sb-varreferens" value={varReferens} onChange={(e) => setVarReferens(e.target.value)} data-testid="input-varreferens" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-fakturatext">Fakturatext (fri text till order/faktura)</Label>
                    <Textarea id="sb-fakturatext" value={fakturatext} onChange={(e) => setFakturatext(e.target.value)} rows={3} placeholder="Fritext som följer med till Fortnox ovanför orderraderna" data-testid="input-fakturatext" />
                  </div>
                  </div>

                  {/* Kolumn 2: leveransfönster + fakturareferenser */}
                  <div className="space-y-4 min-w-0">
                  {/* Leveransdatum/-tid */}
                  <div className="space-y-1.5">
                    <Label>Önskat leveransdatum / leveranstid</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="flex-1 min-w-[8.5rem]" data-testid="input-delivery-date" />
                      <Input type="time" value={deliveryTimeFrom} onChange={(e) => setDeliveryTimeFrom(e.target.value)} className="w-[6.5rem]" data-testid="input-delivery-time-from" />
                      <Input type="time" value={deliveryTimeTo} onChange={(e) => setDeliveryTimeTo(e.target.value)} className="w-[6.5rem]" data-testid="input-delivery-time-to" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-fakturaref1">Fakturareferens 1</Label>
                    <Input id="sb-fakturaref1" value={fakturaref1} onChange={(e) => setFakturaref1(e.target.value)} data-testid="input-fakturaref1" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-fakturaref2">Fakturareferens 2</Label>
                    <Input id="sb-fakturaref2" value={fakturaref2} onChange={(e) => setFakturaref2(e.target.value)} data-testid="input-fakturaref2" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sb-ovrigreferens">Övrig referens / information</Label>
                    <Input id="sb-ovrigreferens" value={ovrigReferens} onChange={(e) => setOvrigReferens(e.target.value)} placeholder="Ex. avtal, ordernr hos kund etc." data-testid="input-ovrigreferens" />
                  </div>
                  </div>

                  {/* Kolumn 3: leveransprincip + intern kommentar */}
                  <div className="space-y-4 min-w-0">
                  {/* Leveransprincip */}
                  <div className="space-y-1.5">
                    <Label>Leveransprincip <span className="text-destructive">*</span></Label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={principle === "manual" ? "default" : "outline"}
                        size="sm"
                        className="flex-1 basis-[12rem] justify-start"
                        onClick={() => requestPrinciple("manual")}
                        data-testid="button-principle-manual"
                      >
                        <MapPin className="h-3.5 w-3.5 mr-1 shrink-0" /> Manuell leveransadress
                      </Button>
                      <Button
                        type="button"
                        variant={principle === "objekt" ? "default" : "outline"}
                        size="sm"
                        className="flex-1 basis-[12rem] justify-start"
                        onClick={() => requestPrinciple("objekt")}
                        data-testid="button-principle-objekt"
                      >
                        <Building2 className="h-3.5 w-3.5 mr-1 shrink-0" /> Kundens objekt
                      </Button>
                    </div>
                    {principle === "objekt" && (
                      <p className="text-xs text-muted-foreground flex items-start gap-1.5 rounded-md border bg-muted/40 px-2.5 py-2">
                        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        Du har valt att använda kundens objekt. Alla artiklar läggs under valda objekt.
                      </p>
                    )}
                    {principle === null && (
                      <p className="text-xs text-muted-foreground">
                        Välj hur leveransen ska hanteras. Principen kan inte ändras när du börjat bygga orderinnehållet.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sb-kommentar">Kommentar (intern)</Label>
                    <Textarea id="sb-kommentar" value={internKommentar} onChange={(e) => setInternKommentar(e.target.value)} rows={3} placeholder="Syns endast internt i Traivo" data-testid="input-intern-kommentar" />
                  </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Manuell leveransadress */}
            {principle === "manual" && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h2 className="text-sm font-semibold">Leveransadress (vid manuell leveransadress)</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div className="space-y-1.5 lg:col-span-1">
                      <Label htmlFor="sb-adr1">Adressrad 1</Label>
                      <Input id="sb-adr1" value={adressrad1} onChange={(e) => setAdressrad1(e.target.value)} data-testid="input-adressrad1" />
                    </div>
                    <div className="space-y-1.5 lg:col-span-1">
                      <Label htmlFor="sb-adr2">Adressrad 2</Label>
                      <Input id="sb-adr2" value={adressrad2} onChange={(e) => setAdressrad2(e.target.value)} data-testid="input-adressrad2" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sb-postnr">Postnummer</Label>
                      <Input id="sb-postnr" value={postnummer} onChange={(e) => setPostnummer(e.target.value)} data-testid="input-postnummer" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sb-ort">Ort</Label>
                      <Input id="sb-ort" value={ort} onChange={(e) => setOrt(e.target.value)} data-testid="input-ort" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sb-land">Land</Label>
                      <Input id="sb-land" value={land} onChange={(e) => setLand(e.target.value)} data-testid="input-land" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Orderbyggaren (samma sida, enligt mockup) */}
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {/* modal={false}: menyn öppnar modala dialoger (artikel-/objektväljare).
                      Med default modal-läge krockar menyns scroll-/fokuslås med dialogens,
                      och när dialogen stängs lämnas ett kvarhängande lås som gör knappen "frusen". */}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" data-testid="button-add-menu">
                        <Plus className="h-4 w-4 mr-1" /> Lägg till <ChevronDown className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={() => {
                          // Låt menyn stänga klart innan dialogen öppnas så att
                          // två Radix-primitiver inte hanterar fokus/lås samtidigt.
                          setTimeout(() => setArticlePickerOpen(true), 0);
                        }}
                        data-testid="menu-add-article"
                      >
                        <Package className="h-4 w-4 mr-2" />
                        <div>
                          <div className="text-sm">Artikel</div>
                          <div className="text-xs text-muted-foreground">Lägg till artikelrad</div>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={addFreeTextLine} data-testid="menu-add-freetext">
                        <PencilLine className="h-4 w-4 mr-2" />
                        <div>
                          <div className="text-sm">Fritextrad</div>
                          <div className="text-xs text-muted-foreground">Lägg till fritextrad</div>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          if (!customer) { toast({ title: "Välj kund först", variant: "destructive" }); return; }
                          if (principle === "manual") {
                            setPrincipleSwitchTarget("objekt");
                            return;
                          }
                          if (principle === null) setPrinciple("objekt");
                          setTimeout(() => setObjectPickerOpen(true), 0);
                        }}
                        data-testid="menu-add-object"
                      >
                        <Building2 className="h-4 w-4 mr-2" />
                        <div>
                          <div className="text-sm">Bygg objekt</div>
                          <div className="text-xs text-muted-foreground">Välj ett objekt hos kunden</div>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCollapsed(new Set())} data-testid="button-expand-all">
                      Expandera alla
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setCollapsed(new Set(groups.map((g) => g.id)))}
                      data-testid="button-collapse-all"
                    >
                      Minimera alla
                    </Button>
                  </div>
                </div>

                {/* Riktningshjälp: vart hamnar nästa rad? */}
                {groups.length > 1 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" />
                    Nya rader läggs under: <span className="font-medium">
                      {groups.find((g) => g.id === addTargetGroupId)?.objectId
                        ? groups.find((g) => g.id === addTargetGroupId)?.label
                        : "Orderrad (utan objekt)"}
                    </span> — klicka på en grupp för att byta.
                  </p>
                )}

                {/* Tabell: kolumnrubriker enligt mockup */}
                <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                <div className="grid grid-cols-[minmax(0,1fr)_7rem_5rem_3.5rem_6rem_7rem_2.25rem] items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground" data-testid="orderbuilder-table-header">
                  <span>Typ / Beskrivning</span>
                  <span>Artikelnummer</span>
                  <span className="text-right">Antal</span>
                  <span>Enhet</span>
                  <span className="text-right">Pris</span>
                  <span className="text-right">Summa</span>
                  <span />
                </div>

                {/* Grupper */}
                <div className="space-y-3 mt-2">
                  {groups.map((group) => {
                    const isOrderLevel = group.objectId === null;
                    const isCollapsed = collapsed.has(group.id);
                    if (isOrderLevel && group.lines.length === 0 && groups.length > 1) {
                      // Dölj tom ordernivå-grupp när objektgrupper finns (objektprincip).
                      if (principle === "objekt") return null;
                    }
                    return (
                      <div
                        key={group.id}
                        className={`rounded-lg border ${addTargetGroupId === group.id ? "border-primary/50" : "border-border"}`}
                        data-testid={`group-${isOrderLevel ? "order-level" : group.objectId}`}
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 rounded-t-lg"
                          onClick={() => setAddTargetGroupId(group.id)}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                                return next;
                              });
                            }}
                            data-testid={`button-toggle-group-${group.id}`}
                          >
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          {isOrderLevel ? (
                            <span className="text-sm font-medium text-muted-foreground">Orderrad (utan objekt)</span>
                          ) : (
                            <span className="text-sm font-medium flex items-center gap-1.5 min-w-0">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">Objekt: {group.label}</span>
                            </span>
                          )}
                          <Badge variant="secondary" className="text-[10px]">{group.lines.length}</Badge>
                          {!isOrderLevel && (
                            <Button
                              variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs"
                              onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                              data-testid={`button-remove-group-${group.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> Radera objekt
                            </Button>
                          )}
                        </div>

                        {!isCollapsed && (
                          <div className="border-t divide-y">
                            {group.lines.length === 0 ? (
                              <div className="px-4 py-3 text-sm text-muted-foreground">
                                Inga rader ännu. Använd "+ Lägg till" ovan.
                              </div>
                            ) : (
                              group.lines.map((l) => (
                                <div
                                  key={l.id}
                                  className="grid grid-cols-[minmax(0,1fr)_7rem_5rem_3.5rem_6rem_7rem_2.25rem] items-center gap-2 px-3 py-2"
                                  data-testid={`line-${l.id}`}
                                >
                                  {/* Typ / Beskrivning (indragen under gruppen) */}
                                  <div className="flex items-center gap-2 min-w-0 pl-5">
                                    {l.articleId ? (
                                      <>
                                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="text-sm truncate">
                                          <span className="font-medium">Artikel:</span> {l.label}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <PencilLine className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="text-sm font-medium shrink-0">Fritext:</span>
                                        <Input
                                          className="h-8 text-sm"
                                          value={l.description}
                                          onChange={(e) => updateLine(group.id, l.id, { description: e.target.value })}
                                          placeholder="Fritext…"
                                          data-testid={`input-line-text-${l.id}`}
                                        />
                                      </>
                                    )}
                                  </div>
                                  {/* Artikelnummer */}
                                  <span className="text-xs font-mono text-muted-foreground truncate">
                                    {l.articleNumber ?? ""}
                                  </span>
                                  {/* Antal */}
                                  <Input
                                    type="number"
                                    min={1}
                                    className="h-8 text-sm text-right"
                                    value={l.quantity}
                                    onChange={(e) => updateLine(group.id, l.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                                    data-testid={`input-line-qty-${l.id}`}
                                  />
                                  {/* Enhet */}
                                  <span className="text-xs text-muted-foreground">{l.unit || "st"}</span>
                                  {/* Pris */}
                                  {l.articleId ? (
                                    <span className="text-sm text-right tabular-nums">{formatSekFromOre(l.listPriceOre ?? 0)}</span>
                                  ) : (
                                    <Input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      className="h-8 text-sm text-right"
                                      value={l.unitPriceKr || ""}
                                      onChange={(e) => updateLine(group.id, l.id, { unitPriceKr: parseFloat(e.target.value) || 0 })}
                                      placeholder="Pris kr"
                                      data-testid={`input-line-price-${l.id}`}
                                    />
                                  )}
                                  {/* Summa */}
                                  <span className="text-sm font-medium text-right tabular-nums" data-testid={`text-line-sum-${l.id}`}>
                                    {formatSekFromOre(lineTotalOre(l))}
                                  </span>
                                  {/* Radera */}
                                  <Button
                                    variant="ghost" size="sm" className="h-8 w-8 p-0"
                                    onClick={() => removeLine(group.id, l.id)}
                                    data-testid={`button-remove-line-${l.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>
                </div>

                <Separator />
                <div className="flex justify-end items-center gap-3">
                  <span className="text-sm text-muted-foreground">Summa exkl. moms</span>
                  <span className="text-lg font-semibold tabular-nums" data-testid="text-order-total">{formatSekFromOre(totalOre)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={() => setStep(3)} disabled={!headerValid || !contentValid} data-testid="button-next-step3">
                Nästa: Bekräfta <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ============== STEG 3: BEKRÄFTA ============== */}
        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-5">
                <h2 className="text-sm font-semibold">Bekräfta ordern</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                  <div><span className="text-muted-foreground">Kund:</span> <span className="font-medium">{customer?.name ?? "—"}</span></div>
                  <div>
                    <span className="text-muted-foreground">Leverans:</span>{" "}
                    <span className="font-medium">
                      {deliveryDate ? `${deliveryDate}${deliveryTimeFrom ? ` ${deliveryTimeFrom}` : ""}${deliveryTimeTo ? `–${deliveryTimeTo}` : ""}` : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Leveransprincip:</span>{" "}
                    <span className="font-medium">{principle === "manual" ? "Manuell leveransadress" : principle === "objekt" ? "Kundens objekt" : "—"}</span>
                  </div>
                  {kundreferens && <div><span className="text-muted-foreground">Kundens referens:</span> {kundreferens}</div>}
                  {varReferens && <div><span className="text-muted-foreground">Vår referens:</span> {varReferens}</div>}
                  {fakturaref1 && <div><span className="text-muted-foreground">Fakturareferens 1:</span> {fakturaref1}</div>}
                  {fakturaref2 && <div><span className="text-muted-foreground">Fakturareferens 2:</span> {fakturaref2}</div>}
                  {ovrigReferens && <div><span className="text-muted-foreground">Övrig referens:</span> {ovrigReferens}</div>}
                  {principle === "manual" && hasManualAddress && (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">Leveransadress:</span>{" "}
                      {[adressrad1, adressrad2, [postnummer, ort].filter(Boolean).join(" "), land].filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>

                {fakturatext && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Fakturatext:</span>
                    <p className="mt-1 rounded-md border bg-muted/40 px-3 py-2 whitespace-pre-wrap">{fakturatext}</p>
                  </div>
                )}

                <Separator />

                {/* Hierarki */}
                <div className="space-y-3">
                  {groups.filter((g) => g.lines.length > 0).map((group) => (
                    <div key={group.id} className="rounded-lg border">
                      <div className="px-3 py-2 text-sm font-medium border-b bg-muted/30">
                        {group.objectId ? `Objekt: ${group.label}` : "Orderrad (utan objekt)"}
                      </div>
                      <div className="divide-y">
                        {group.lines.map((l) => (
                          <div key={l.id} className="px-3 py-1.5 flex items-center justify-between text-sm">
                            <span className="truncate min-w-0">
                              {l.articleId ? l.label : `Fritext: ${l.description || "—"}`}
                              {l.articleNumber && <span className="ml-2 text-xs font-mono text-muted-foreground">{l.articleNumber}</span>}
                            </span>
                            <span className="tabular-nums text-muted-foreground shrink-0 ml-3">
                              {l.quantity} {l.unit || "st"} · {formatSekFromOre(lineTotalOre(l))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end items-center gap-3">
                  <span className="text-sm text-muted-foreground">Summa exkl. moms</span>
                  <span className="text-lg font-semibold tabular-nums">{formatSekFromOre(totalOre)}</span>
                </div>

                {validationHints.length > 0 && (
                  <p className="text-sm text-destructive" data-testid="text-validation-hints">{validationHints.join(" · ")}</p>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} data-testid="button-back-step2">Tillbaka</Button>
              <Button onClick={handleSaveOrder} disabled={!canSave} data-testid="button-confirm-save">
                {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Spara order
              </Button>
            </div>
          </div>
        )}

        {/* Info-remsa + flödesremsa (enligt mockup) */}
        <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-lg border bg-primary/5 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2" data-testid="strip-save-info">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>
              När du sparar ordern skapas uppgifter från alla artiklar och levereras till Uppgiftsnavet.
              Uppgifterna innehåller automatiskt de data som kommer från kund, objekt, artikel och orderhuvud.
              Systemets motorer beräknar och uppdaterar t.ex. optimal tid, rutt, status och andra datafält.
            </span>
          </div>
          <div className="rounded-lg border px-4 py-3" data-testid="strip-next-steps">
            <p className="text-xs font-semibold mb-2">Nästa steg efter att ordern sparats</p>
            <div className="flex flex-wrap items-start gap-x-2 gap-y-3">
              {[
                { icon: Package, label: "Artiklar skapar uppgifter" },
                { icon: ShoppingCart, label: "Uppgifter till Uppgiftsnavet" },
                { icon: Loader2, label: "Motorer beräknar optimal tid, rutt m.m." },
                { icon: MapPin, label: "Planering och utförande" },
                { icon: Check, label: "Uppföljning och fakturering" },
              ].map((s, i, arr) => (
                <div key={s.label} className="flex items-start gap-2">
                  <div className="flex flex-col items-center w-20 text-center">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 mb-1">
                      <s.icon className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-[10px] leading-tight text-muted-foreground">{s.label}</span>
                  </div>
                  {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground mt-2" />}
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>

        {/* Hjälppanel (breda skärmar) */}
        <aside className="hidden xl:block w-64 shrink-0 space-y-4 sticky top-6" data-testid="snabborder-help-panel">
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs space-y-1.5">
            <p className="font-semibold">Leveransprincip</p>
            <p className="text-muted-foreground">Välj hur leveransen ska hanteras på denna order.</p>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">Manuell leveransadress</span> — du anger adress här.</p>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">Kundens objekt</span> — du väljer ett eller flera objekt som innehåller adress och metadata.</p>
            <p className="text-muted-foreground">Principen kan inte ändras när du har börjat bygga orderinnehållet.</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs space-y-1.5">
            <p className="font-semibold">+ Lägg till</p>
            <p className="text-muted-foreground">Bygg ordern med tre val:</p>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">Artikel</span> — lägg till en artikelrad.</p>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">Fritextrad</span> — fri text på ordernivå.</p>
            <p className="text-muted-foreground"><span className="font-medium text-foreground">Objekt</span> — välj ett av kundens objekt. Artiklar som läggs därefter hamnar under detta objekt tills nästa objekt skapas.</p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs space-y-1.5">
            <p className="font-semibold">Hierarki och struktur</p>
            <p className="text-muted-foreground">Rader utan objekt ligger på ordernivå.</p>
            <p className="text-muted-foreground">Artiklar under ett objekt hör till det objektets adress och metadata.</p>
            <p className="text-muted-foreground">Flera objekt kan läggas på samma order.</p>
          </div>
        </aside>
        </div>
      </div>

      {/* ── Artikelväljare ── */}
      <Dialog open={articlePickerOpen} onOpenChange={setArticlePickerOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-article-picker">
          <DialogHeader>
            <DialogTitle>Lägg till artikel</DialogTitle>
            <DialogDescription>
              Raden läggs under {groups.find((g) => g.id === addTargetGroupId)?.objectId
                ? `objektet ${groups.find((g) => g.id === addTargetGroupId)?.label}`
                : "ordernivån (utan objekt)"}.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              autoFocus
              value={articleSearch}
              onChange={(e) => setArticleSearch(e.target.value)}
              placeholder="Sök artikel på artikelnummer eller namn"
              data-testid="input-article-search"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {debouncedArticle.trim().length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Skriv för att söka.</div>
            ) : articlesFetching ? (
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
                  <span className="flex items-center gap-2 min-w-0">
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    {a.articleNumber && <span className="font-mono text-xs text-muted-foreground shrink-0">{a.articleNumber}</span>}
                    <span className="font-medium truncate">{a.name}</span>
                  </span>
                  <span className="text-muted-foreground text-xs shrink-0 ml-2">
                    {formatSekFromOre(a.listPrice ?? 0)}/{a.unit || "st"}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Objektväljare ── */}
      <Dialog open={objectPickerOpen} onOpenChange={setObjectPickerOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-object-picker">
          <DialogHeader>
            <DialogTitle>Bygg objekt</DialogTitle>
            <DialogDescription>
              Välj ett av {customer?.name ?? "kundens"} objekt. Artiklar som läggs därefter hamnar under
              objektet tills nästa objekt skapas.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              autoFocus
              value={objectSearch}
              onChange={(e) => setObjectSearch(e.target.value)}
              placeholder="Sök objekt på namn eller objektnummer"
              data-testid="input-object-search"
            />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
            {debouncedObject.trim().length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Skriv för att söka bland kundens objekt.</div>
            ) : objectsFetching ? (
              <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Söker…
              </div>
            ) : objectHits.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Inga objekt matchade sökningen.</div>
            ) : (
              objectHits.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => addObjectGroup(o)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  data-testid={`option-object-${o.id}`}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0">
                    <span className="font-medium block truncate">{o.name}</span>
                    <span className="text-xs text-muted-foreground block truncate">
                      {[o.objectNumber, o.address].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Kundbyte med objektgrupper ── */}
      <Dialog open={pendingCustomerSwitch !== null} onOpenChange={(v) => !v && setPendingCustomerSwitch(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-customer-switch">
          <DialogHeader>
            <DialogTitle>Byta kund?</DialogTitle>
            <DialogDescription>
              Orderinnehållet innehåller objekt som tillhör {customer?.name ?? "den nuvarande kunden"}.
              Om du byter till {pendingCustomerSwitch?.name ?? "en annan kund"} tas objektgrupperna och
              deras rader bort. Rader utan objekt behålls.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingCustomerSwitch(null)} data-testid="button-cancel-customer-switch">
              Avbryt
            </Button>
            <Button onClick={confirmCustomerSwitch} data-testid="button-confirm-customer-switch">
              Byt kund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Principkonflikt (spec §7) ── */}
      <Dialog open={principleSwitchTarget !== null} onOpenChange={(v) => !v && setPrincipleSwitchTarget(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-principle-conflict">
          <DialogHeader>
            <DialogTitle>Byta leveransprincip?</DialogTitle>
            <DialogDescription>
              {principleSwitchTarget === "objekt"
                ? "Ordern använder redan en manuell leveransadress. Vill du istället använda kundens objekt och objektens adresser? Den manuella adressen tas bort."
                : "Ordern använder redan kundens objekt. Vill du istället ange en manuell leveransadress? Objektgrupperna tas bort och deras rader flyttas till ordernivån."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrincipleSwitchTarget(null)} data-testid="button-cancel-principle-switch">
              Avbryt
            </Button>
            <Button onClick={confirmPrincipleSwitch} data-testid="button-confirm-principle-switch">
              Byt princip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
