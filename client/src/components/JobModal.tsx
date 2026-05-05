import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarIcon, Loader2, Check, Package, Anchor, X, MessageSquare, Receipt, AlertTriangle, Search, Sun, Sunset } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Customer, ServiceObject, Article, PriceList } from "@shared/schema";
import { ARTICLE_HOOK_LEVEL_LABELS } from "@shared/schema";
import { BillingCustomerDialog } from "@/components/BillingCustomerDialog";

interface JobModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (data: JobFormData) => void;
}

type TimeOfDayPreference = "any" | "morning" | "afternoon";

interface JobFormData {
  title: string;
  description: string;
  plannedNotes: string;
  customerId: string;
  objectId: string;
  priority: string;
  desiredDeliveryStart: Date | undefined;
  desiredDeliveryEnd: Date | undefined;
  timeOfDayPreference: TimeOfDayPreference;
  priceListId: string;
}

const EMPTY_FORM: JobFormData = {
  title: "",
  description: "",
  plannedNotes: "",
  customerId: "",
  objectId: "",
  priority: "normal",
  desiredDeliveryStart: undefined,
  desiredDeliveryEnd: undefined,
  timeOfDayPreference: "any",
  priceListId: "",
};

export function JobModal({ open, onClose, onSubmit }: JobModalProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<JobFormData>(EMPTY_FORM);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPopoverOpen, setObjectPopoverOpen] = useState(false);
  const [selectedObjectName, setSelectedObjectName] = useState("");
  const [showBillingDialog, setShowBillingDialog] = useState(false);
  const [pendingObjectId, setPendingObjectId] = useState("");
  const [selectedArticleIds, setSelectedArticleIds] = useState<Set<string>>(new Set());

  const [fromPopoverOpen, setFromPopoverOpen] = useState(false);
  const [toPopoverOpen, setToPopoverOpen] = useState(false);

  const [autoSelectedPriceListId, setAutoSelectedPriceListId] = useState<string>("");
  const [pendingPriceListId, setPendingPriceListId] = useState<string | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 50);
    const q = customerSearch.toLowerCase();
    return customers.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [customers, customerSearch]);

  const selectedCustomerName = useMemo(() => {
    if (!formData.customerId) return "";
    return customers.find(c => c.id === formData.customerId)?.name || "";
  }, [customers, formData.customerId]);

  const objectSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (objectSearch.length >= 2) {
      params.set("search", objectSearch);
    }
    if (formData.customerId) {
      params.set("customerId", formData.customerId);
    }
    return params.toString();
  }, [objectSearch, formData.customerId]);

  const { data: objectsResponse, isLoading: objectsLoading } = useQuery<{ objects: ServiceObject[], total: number }>({
    queryKey: ["/api/objects", objectSearchParams],
    queryFn: async () => {
      const res = await fetch(`/api/objects?${objectSearchParams}`);
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: objectSearch.length >= 2 || !!formData.customerId,
  });

  const objects = objectsResponse?.objects || [];
  const objectsTotal = objectsResponse?.total ?? objects.length;

  const { data: priceLists = [] } = useQuery<PriceList[]>({
    queryKey: ["/api/price-lists"],
  });

  const activePriceLists = useMemo(
    () => priceLists.filter(pl => pl.status === "active" && !pl.deletedAt),
    [priceLists],
  );

  // Auto-välj prislista när kund ändras: rabattbrev > kundunik (sorterat efter prioritet desc).
  // Om ingen kundkopplad prislista finns — eller om den auto-valda försvinner — återställs
  // formData.priceListId till "" så att backend faller tillbaka på generell/listpris.
  useEffect(() => {
    if (!formData.customerId) {
      setAutoSelectedPriceListId("");
      setFormData(prev => (prev.priceListId ? { ...prev, priceListId: "" } : prev));
      return;
    }
    const customerLists = activePriceLists.filter(pl => pl.customerId === formData.customerId);
    if (customerLists.length === 0) {
      setAutoSelectedPriceListId("");
      setFormData(prev => (prev.priceListId ? { ...prev, priceListId: "" } : prev));
      return;
    }
    const sorted = [...customerLists].sort((a, b) => {
      const typeRank = (t: string) => (t === "rabattbrev" ? 2 : t === "kundunik" ? 1 : 0);
      const ta = typeRank(a.priceListType);
      const tb = typeRank(b.priceListType);
      if (ta !== tb) return tb - ta;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });
    const auto = sorted[0];
    setAutoSelectedPriceListId(auto.id);
    setFormData(prev => ({ ...prev, priceListId: auto.id }));
  }, [formData.customerId, activePriceLists]);

  // Skydd mot stale priceListId om den valda prislistan försvinner (inaktiveras/raderas).
  // Hela kontrollen ligger inuti den funktionella setFormData så vi alltid läser den
  // senaste queue-uppdaterade `prev` — inte en stale closure-värde. Det undviker race
  // med auto-effekten ovan när både `customerId` och `activePriceLists` ändras i samma
  // commit (annars kunde detta effect rensa det auto-värde som auto-effekten precis satt).
  useEffect(() => {
    setFormData(prev => {
      if (!prev.priceListId) return prev;
      if (!activePriceLists.some(pl => pl.id === prev.priceListId)) {
        return { ...prev, priceListId: "" };
      }
      return prev;
    });
  }, [activePriceLists]);

  const autoSelectedPriceList = useMemo(
    () => activePriceLists.find(pl => pl.id === autoSelectedPriceListId) || null,
    [activePriceLists, autoSelectedPriceListId],
  );

  const pendingPriceList = useMemo(
    () => (pendingPriceListId ? activePriceLists.find(pl => pl.id === pendingPriceListId) || null : null),
    [activePriceLists, pendingPriceListId],
  );

  const handlePriceListChange = (newValue: string) => {
    const newId = newValue === "auto" ? "" : newValue;
    if (autoSelectedPriceListId && newId !== autoSelectedPriceListId) {
      setPendingPriceListId(newId || "__auto__");
      return;
    }
    setFormData(prev => ({ ...prev, priceListId: newId }));
  };

  const confirmPriceListChange = () => {
    if (pendingPriceListId === null) return;
    const newId = pendingPriceListId === "__auto__" ? "" : pendingPriceListId;
    setFormData(prev => ({ ...prev, priceListId: newId }));
    setPendingPriceListId(null);
  };

  const cancelPriceListChange = () => {
    setPendingPriceListId(null);
  };

  const { data: applicableArticles = [], isLoading: articlesLoading } = useQuery<Article[]>({
    queryKey: ["/api/objects", formData.objectId, "applicable-articles"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${formData.objectId}/applicable-articles`);
      if (!res.ok) throw new Error("Failed to fetch applicable articles");
      return res.json();
    },
    enabled: !!formData.objectId,
  });

  const toggleArticle = (articleId: string) => {
    setSelectedArticleIds(prev => {
      const next = new Set(prev);
      if (next.has(articleId)) {
        next.delete(articleId);
      } else {
        next.add(articleId);
      }
      return next;
    });
  };

  const createWorkOrderMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description: string;
      plannedNotes: string;
      customerId: string;
      objectId: string;
      priority: string;
      desiredDeliveryStart: Date | null;
      desiredDeliveryEnd: Date | null;
      articlesToAdd: Array<{ id: string; name: string; price: number | null }>;
      priceListId: string;
      metadata?: Record<string, unknown>;
    }) => {
      const { articlesToAdd, priceListId, metadata, ...orderData } = data;
      const payload: Record<string, unknown> = {
        ...orderData,
        plannedNotes: orderData.plannedNotes || null,
      };
      if (metadata && Object.keys(metadata).length > 0) {
        payload.metadata = metadata;
      }
      const response = await apiRequest("POST", "/api/work-orders", payload);
      const workOrder = response as unknown as { id: string };

      if (articlesToAdd.length > 0 && workOrder.id) {
        for (const article of articlesToAdd) {
          const linePayload: Record<string, unknown> = {
            articleId: article.id,
            quantity: 1,
          };
          if (priceListId) {
            linePayload.priceListId = priceListId;
          }
          await apiRequest("POST", `/api/work-orders/${workOrder.id}/lines`, linePayload);
        }
      }

      return { workOrder, articleCount: articlesToAdd.length };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-order-lines"] });
      const message = result.articleCount > 0
        ? `Jobbet har skapats med ${result.articleCount} fasthakade artiklar. Tilldela team och tider i planeringen.`
        : "Jobbet har skapats. Tilldela team och tider i planeringen.";
      toast({ title: "Jobb skapat", description: message });
      handleClose();
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa jobb", description: error.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setFormData(EMPTY_FORM);
    setObjectSearch("");
    setSelectedObjectName("");
    setSelectedArticleIds(new Set());
    setAutoSelectedPriceListId("");
    setPendingPriceListId(null);
    setFromPopoverOpen(false);
    setToPopoverOpen(false);
    onClose();
  };

  const dateRangeError = useMemo(() => {
    if (!formData.desiredDeliveryStart || !formData.desiredDeliveryEnd) return null;
    if (formData.desiredDeliveryEnd < formData.desiredDeliveryStart) {
      return "Senaste datum ligger före tidigaste — kontrollera ordningen.";
    }
    return null;
  }, [formData.desiredDeliveryStart, formData.desiredDeliveryEnd]);

  const handleSubmit = () => {
    if (!formData.title || !formData.customerId || !formData.objectId) {
      toast({ title: "Saknade uppgifter", description: "Fyll i titel, kund och objekt.", variant: "destructive" });
      return;
    }
    if (dateRangeError) {
      toast({ title: "Kontrollera datum", description: dateRangeError, variant: "destructive" });
      return;
    }

    const articlesToAdd = applicableArticles
      .filter(a => selectedArticleIds.has(a.id))
      .map(a => ({ id: a.id, name: a.name, price: a.listPrice }));

    // Auto-fyll så att Från och Till alltid är symmetriska:
    // - Bara Från → Till = Från (samma dag)
    // - Bara Till → Från = Till (samma dag, så vi inte sparar ofullständig period)
    // - Båda satta → använd som de är
    const start = formData.desiredDeliveryStart ?? formData.desiredDeliveryEnd ?? null;
    const end = formData.desiredDeliveryEnd ?? formData.desiredDeliveryStart ?? null;

    const metadata: Record<string, unknown> = {};
    if (formData.timeOfDayPreference !== "any") {
      metadata.timeOfDayPreference = formData.timeOfDayPreference;
    }

    createWorkOrderMutation.mutate({
      title: formData.title,
      description: formData.description,
      plannedNotes: formData.plannedNotes,
      customerId: formData.customerId,
      objectId: formData.objectId,
      priority: formData.priority,
      desiredDeliveryStart: start,
      desiredDeliveryEnd: end,
      articlesToAdd,
      priceListId: formData.priceListId,
      metadata,
    });

    onSubmit?.(formData);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nytt jobb</DialogTitle>
          <DialogDescription>
            Fyll i det som är känt nu. Team, tider och uppgifter läggs till i planeringen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Jobbnamn</Label>
            <Input
              id="title"
              placeholder="T.ex. Årlig service"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              data-testid="input-job-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 relative">
              <Label>Kund</Label>
              <div className="relative">
                <div className="flex items-center border rounded-md bg-background">
                  <Search className="ml-3 h-4 w-4 shrink-0 opacity-50" />
                  <input
                    className="flex h-9 w-full bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
                    placeholder={selectedCustomerName || "Sök kund..."}
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      if (!customerPopoverOpen) setCustomerPopoverOpen(true);
                    }}
                    onFocus={() => setCustomerPopoverOpen(true)}
                    onBlur={() => setTimeout(() => setCustomerPopoverOpen(false), 150)}
                    data-testid="select-customer"
                  />
                  {formData.customerId && (
                    <button
                      type="button"
                      className="mr-2 opacity-50 hover:opacity-100"
                      onClick={() => {
                        setFormData({ ...formData, customerId: "", objectId: "" });
                        setSelectedObjectName("");
                        setCustomerSearch("");
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {customerPopoverOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="max-h-[200px] overflow-y-auto">
                      {filteredCustomers.length === 0 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">Ingen kund hittad</div>
                      ) : (
                        <div className="p-1">
                          {filteredCustomers.map(c => (
                            <button
                              key={c.id}
                              type="button"
                              className={cn(
                                "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                formData.customerId === c.id && "bg-accent",
                              )}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                setFormData({ ...formData, customerId: c.id, objectId: "" });
                                setSelectedObjectName("");
                                setObjectSearch("");
                                setCustomerPopoverOpen(false);
                                setCustomerSearch("");
                              }}
                              data-testid={`option-customer-${c.id}`}
                            >
                              <Check className={cn("mr-2 h-4 w-4 shrink-0", formData.customerId === c.id ? "opacity-100" : "opacity-0")} />
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {!customerSearch && customers.length > 50 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t">
                          Visar 50 av {customers.length} — skriv för att söka
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 relative">
              <Label>Objekt</Label>
              <div className="relative">
                <div className="flex items-center border rounded-md bg-background">
                  <Search className="ml-3 h-4 w-4 shrink-0 opacity-50" />
                  <input
                    className="flex h-9 w-full bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
                    placeholder={selectedObjectName || "Sök objekt..."}
                    value={objectSearch}
                    onChange={(e) => {
                      setObjectSearch(e.target.value);
                      if (!objectPopoverOpen) setObjectPopoverOpen(true);
                    }}
                    onFocus={() => setObjectPopoverOpen(true)}
                    onBlur={() => setTimeout(() => setObjectPopoverOpen(false), 200)}
                    data-testid="select-object"
                  />
                  {formData.objectId && (
                    <button
                      type="button"
                      className="mr-2 opacity-50 hover:opacity-100"
                      onClick={() => {
                        setFormData({ ...formData, objectId: "" });
                        setSelectedObjectName("");
                        setObjectSearch("");
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {objectPopoverOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="max-h-[220px] overflow-y-auto">
                      {!formData.customerId && objectSearch.length < 2 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                          Välj kund eller skriv minst 2 tecken
                        </div>
                      ) : objectsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : objects.length === 0 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">Inget objekt hittat</div>
                      ) : (
                        <div className="p-1">
                          {objects.map(obj => (
                            <button
                              key={obj.id}
                              type="button"
                              className={cn(
                                "relative flex w-full cursor-pointer select-none items-start rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                formData.objectId === obj.id && "bg-accent",
                              )}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={async () => {
                                setSelectedObjectName(obj.name);
                                setObjectPopoverOpen(false);
                                setObjectSearch("");
                                try {
                                  const res = await fetch(`/api/objects/${obj.id}/billing-customers`);
                                  if (res.ok) {
                                    const billing = await res.json() as { multiPayer?: boolean; defaultCustomerId?: string | null };
                                    if (billing?.multiPayer) {
                                      // Sätt objectId direkt så den persisteras även om dialogen avbryts;
                                      // BillingCustomerDialog uppdaterar bara customerId vid bekräftelse.
                                      setFormData(prev => ({ ...prev, objectId: obj.id }));
                                      setPendingObjectId(obj.id);
                                      setShowBillingDialog(true);
                                      return;
                                    }
                                    if (billing?.defaultCustomerId) {
                                      setFormData(prev => ({ ...prev, objectId: obj.id, customerId: billing.defaultCustomerId as string }));
                                      return;
                                    }
                                  }
                                  setFormData(prev => ({ ...prev, objectId: obj.id }));
                                } catch {
                                  setFormData(prev => ({ ...prev, objectId: obj.id }));
                                }
                              }}
                              data-testid={`option-object-${obj.id}`}
                            >
                              <Check className={cn("mr-2 h-4 w-4 shrink-0 mt-0.5", formData.objectId === obj.id ? "opacity-100" : "opacity-0")} />
                              <div className="flex flex-col items-start">
                                <span>{obj.name}</span>
                                {obj.address && (
                                  <span className="text-xs text-muted-foreground">{obj.address}</span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {!objectsLoading && objects.length > 0 && objectsTotal > objects.length && (
                        <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t">
                          Visar {objects.length} av {objectsTotal} — förfina sökningen
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Prioritet</Label>
            <Select
              value={formData.priority}
              onValueChange={(v) => setFormData({ ...formData, priority: v })}
            >
              <SelectTrigger data-testid="select-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Låg</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">Hög</SelectItem>
                <SelectItem value="urgent">Akut</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarIcon className="h-3.5 w-3.5" />
              Önskad leveranstid
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <Popover open={fromPopoverOpen} onOpenChange={setFromPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="button-select-desired-start"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {formData.desiredDeliveryStart
                        ? format(formData.desiredDeliveryStart, "PPP", { locale: sv })
                        : "Från"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.desiredDeliveryStart}
                    onSelect={(d) => {
                      setFormData(prev => ({ ...prev, desiredDeliveryStart: d }));
                      setFromPopoverOpen(false);
                    }}
                    locale={sv}
                  />
                  {formData.desiredDeliveryStart && (
                    <div className="p-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setFormData(prev => ({ ...prev, desiredDeliveryStart: undefined }))}
                        data-testid="button-clear-desired-start"
                      >
                        Rensa
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
              <Popover open={toPopoverOpen} onOpenChange={setToPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="button-select-desired-end"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {formData.desiredDeliveryEnd
                        ? format(formData.desiredDeliveryEnd, "PPP", { locale: sv })
                        : formData.desiredDeliveryStart
                          ? "Samma dag"
                          : "Till"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.desiredDeliveryEnd}
                    onSelect={(d) => {
                      setFormData(prev => ({ ...prev, desiredDeliveryEnd: d }));
                      setToPopoverOpen(false);
                    }}
                    locale={sv}
                  />
                  {formData.desiredDeliveryEnd && (
                    <div className="p-2 border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => setFormData(prev => ({ ...prev, desiredDeliveryEnd: undefined }))}
                        data-testid="button-clear-desired-end"
                      >
                        Rensa
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <Select
              value={formData.timeOfDayPreference}
              onValueChange={(v) => setFormData({ ...formData, timeOfDayPreference: v as TimeOfDayPreference })}
            >
              <SelectTrigger data-testid="select-time-of-day" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Hela dagen</SelectItem>
                <SelectItem value="morning">
                  <span className="flex items-center gap-2">
                    <Sun className="h-3.5 w-3.5" /> Förmiddag
                  </span>
                </SelectItem>
                <SelectItem value="afternoon">
                  <span className="flex items-center gap-2">
                    <Sunset className="h-3.5 w-3.5" /> Eftermiddag
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {dateRangeError && (
              <p className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1" data-testid="text-date-range-error">
                <AlertTriangle className="h-3 w-3" />
                {dateRangeError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Mjuk preferens. Lämnar du bara Från eller bara Till tom används samma dag — perioden sparas alltid med både start och slut.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5" />
              Prislista
            </Label>
            <Select
              value={formData.priceListId || "auto"}
              onValueChange={handlePriceListChange}
            >
              <SelectTrigger data-testid="select-price-list">
                <SelectValue placeholder="Automatisk (standard)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatisk (standard)</SelectItem>
                {activePriceLists.map(pl => (
                  <SelectItem key={pl.id} value={pl.id} data-testid={`option-price-list-${pl.id}`}>
                    <span className="flex items-center gap-2">
                      {pl.name}
                      <Badge variant="outline" className="text-[10px] ml-1">
                        {pl.priceListType === "generell" ? "Generell" : pl.priceListType === "kundunik" ? "Kundunik" : "Rabattbrev"}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {autoSelectedPriceList && formData.priceListId === autoSelectedPriceListId && (
              <p className="text-xs text-muted-foreground" data-testid="text-pricelist-auto">
                Vald automatiskt från kunden: <span className="font-medium">{autoSelectedPriceList.name}</span>
              </p>
            )}
            {!formData.priceListId && (
              <p className="text-xs text-muted-foreground">
                Pris löses automatiskt via prislisthierarkin (rabattbrev → kundunik → generell → listpris)
              </p>
            )}
          </div>

          {formData.objectId && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Anchor className="h-4 w-4" />
                Fasthakade artiklar
              </Label>
              {articlesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : applicableArticles.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">
                  Inga fasthakade artiklar för detta objekt
                </div>
              ) : (
                <ScrollArea className="h-[120px] border rounded-md p-2">
                  <div className="space-y-2">
                    {applicableArticles.map((article) => (
                      <div
                        key={article.id}
                        className="flex items-center gap-2 p-2 rounded-md hover-elevate"
                      >
                        <Checkbox
                          id={`article-${article.id}`}
                          checked={selectedArticleIds.has(article.id)}
                          onCheckedChange={() => toggleArticle(article.id)}
                          data-testid={`checkbox-article-${article.id}`}
                        />
                        <label
                          htmlFor={`article-${article.id}`}
                          className="flex-1 flex items-center gap-2 cursor-pointer"
                        >
                          <Package className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{article.name}</span>
                          {article.hookLevel && (
                            <Badge variant="outline" className="text-xs">
                              {ARTICLE_HOOK_LEVEL_LABELS[article.hookLevel as keyof typeof ARTICLE_HOOK_LEVEL_LABELS] || article.hookLevel}
                            </Badge>
                          )}
                        </label>
                        <span className="text-sm text-muted-foreground">
                          {article.listPrice ? `${article.listPrice} kr` : "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {selectedArticleIds.size > 0 && (
                <div className="text-xs text-muted-foreground">
                  {selectedArticleIds.size} artikel(ar) valda — läggs till vid skapande
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="planned-notes" className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Meddelande till utförare
            </Label>
            <Textarea
              id="planned-notes"
              placeholder="Info som visas för chauffören i Traivo Go..."
              value={formData.plannedNotes}
              onChange={(e) => setFormData({ ...formData, plannedNotes: e.target.value })}
              rows={2}
              data-testid="input-planned-notes"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beskrivning</Label>
            <Textarea
              id="description"
              placeholder="Beskrivning av jobbet..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              data-testid="input-description"
              rows={2}
            />
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              Team, tekniker, beräknad tid och planerat datum sätts senare i planeringen utifrån de uppgifter och artiklar jobbet får.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
            Avbryt
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createWorkOrderMutation.isPending}
            data-testid="button-save-job"
          >
            {createWorkOrderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Spara jobb
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={pendingPriceListId !== null} onOpenChange={(open) => { if (!open) cancelPriceListChange(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Byt prislista?</AlertDialogTitle>
          <AlertDialogDescription data-testid="text-pricelist-confirm">
            Vill du använda{" "}
            <span className="font-medium">
              {pendingPriceListId === "__auto__" ? "Automatisk (standard)" : pendingPriceList?.name || "den valda prislistan"}
            </span>{" "}
            istället för kundens prislista{" "}
            <span className="font-medium">{autoSelectedPriceList?.name || "(okänd)"}</span> för det här jobbet?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancelPriceListChange} data-testid="button-pricelist-cancel">
            Avbryt
          </AlertDialogCancel>
          <AlertDialogAction onClick={confirmPriceListChange} data-testid="button-pricelist-confirm">
            Bekräfta byte
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <BillingCustomerDialog
      open={showBillingDialog}
      onClose={() => {
        setShowBillingDialog(false);
        setPendingObjectId("");
      }}
      objectId={pendingObjectId}
      onSelect={(customerId) => {
        setFormData(prev => ({ ...prev, customerId }));
        setShowBillingDialog(false);
        setPendingObjectId("");
      }}
    />
  </>
  );
}
