import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { metadataDisplayName } from "@/lib/metadata-display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, MapPin, User, Calendar as CalendarIcon, Clock, Package, Check, ChevronsUpDown, Tag, ShoppingCart, DollarSign, MessageSquare, Send, CheckCircle2, XCircle, AlertCircle, Search, Copy, AlertTriangle, Ban, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TaskTimewindowsEditor } from "@/components/TaskTimewindowsEditor";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { workOrderStatusBadge } from "@/lib/status-colors";
import type { WorkOrder, ServiceObject, Customer, Resource, WorkOrderObject, MetadataKatalog, WorkOrderLine, CustomerCommunication } from "@shared/schema";
import { getOrderTypeLabel } from "@shared/schema";
import { CoupledFieldInput, type OrderTypeMetadataField } from "./CoupledFieldInput";

interface JobDetailModalProps {
  open: boolean;
  onClose: () => void;
  workOrderId: string | null;
  bulkWorkOrderIds?: string[];
}

interface WorkOrderWithDetails extends WorkOrder {
  objectName?: string;
  objectAddress?: string;
  customerName?: string;
  resourceName?: string;
}

interface WorkOrderObjectWithDetails extends WorkOrderObject {
  objectName?: string;
  objectAddress?: string;
  objectType?: string;
}

interface WorkOrderMetadata {
  id: string;
  workOrderId: string;
  metadataKatalogId: string;
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: string | null;
  vardeJson: any | null;
  vardeReferens: string | null;
  katalog: {
    id: string;
    namn: string;
    beskrivning: string | null;
    datatyp: string;
    kategori: string | null;
    icon: string | null;
  };
}

interface WorkOrderLineWithDetails extends WorkOrderLine {
  articleName?: string;
  articleDescription?: string;
}

// Task #665/#689: fält kopplat till orderns ordertyp (familjer expanderade till
// underfält). Typ + enskild fält-rendering delas via CoupledFieldInput med create-vyn.

export function JobDetailModal({ open, onClose, workOrderId, bulkWorkOrderIds = [] }: JobDetailModalProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const otherBulkIds = useMemo(() => bulkWorkOrderIds.filter(id => id !== workOrderId), [bulkWorkOrderIds, workOrderId]);
  const hasBulkTargets = otherBulkIds.length > 0;
  const [objectSearch, setObjectSearch] = useState("");
  const [objectPopoverOpen, setObjectPopoverOpen] = useState(false);
  const [metadataPopoverOpen, setMetadataPopoverOpen] = useState(false);
  const [selectedMetadataType, setSelectedMetadataType] = useState<string>("");
  const [metadataValue, setMetadataValue] = useState<string>("");
  // Task #665: lokala utkast för kopplade fält (keyed by katalog-fält-id). Ett fält
  // utan utkast faller tillbaka till sitt sparade work-order-metadata-värde.
  const [coupledDrafts, setCoupledDrafts] = useState<Record<string, string>>({});
  const [showAddArticleDialog, setShowAddArticleDialog] = useState(false);
  const [articleSearch, setArticleSearch] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [articleQuantity, setArticleQuantity] = useState(1);
  const [showSmsDialog, setShowSmsDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [smsMessage, setSmsMessage] = useState("");
  const [smsPhone, setSmsPhone] = useState("");
  const [desiredStart, setDesiredStart] = useState<Date | undefined>(undefined);
  const [desiredEnd, setDesiredEnd] = useState<Date | undefined>(undefined);
  const [desiredDirty, setDesiredDirty] = useState(false);

  const { data: workOrder, isLoading: workOrderLoading } = useQuery<WorkOrderWithDetails>({
    queryKey: ["/api/work-orders", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}`);
      if (!res.ok) throw new Error("Failed to fetch work order");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  const { data: linkedObjects = [], isLoading: objectsLoading } = useQuery<WorkOrderObjectWithDetails[]>({
    queryKey: ["/api/work-orders", workOrderId, "objects"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/objects`);
      if (!res.ok) throw new Error("Failed to fetch work order objects");
      const objects = await res.json();
      const objectIds = objects.map((o: WorkOrderObject) => o.objectId);
      if (objectIds.length === 0) return [];
      
      const objectDetails = await Promise.all(
        objectIds.map(async (id: string) => {
          const objRes = await fetch(`/api/objects/${id}`);
          if (!objRes.ok) return null;
          return objRes.json();
        })
      );
      
      return objects.map((obj: WorkOrderObject, idx: number) => ({
        ...obj,
        objectName: objectDetails[idx]?.name || "Okänt objekt",
        objectAddress: objectDetails[idx]?.address || "",
        objectType: objectDetails[idx]?.type || "",
      }));
    },
    enabled: !!workOrderId && open,
  });

  const objectSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (objectSearch.length >= 2) {
      params.set("search", objectSearch);
    }
    if (workOrder?.customerId) {
      params.set("customerId", workOrder.customerId);
    }
    return params.toString();
  }, [objectSearch, workOrder?.customerId]);

  const { data: searchObjectsResponse, isLoading: searchLoading } = useQuery<{ objects: ServiceObject[], total: number }>({
    queryKey: ["/api/objects", objectSearchParams],
    queryFn: async () => {
      const res = await fetch(`/api/objects?${objectSearchParams}`);
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: objectPopoverOpen && objectSearch.length >= 2,
  });

  const searchObjects = searchObjectsResponse?.objects || [];

  // Work order lines query
  const { data: workOrderLines = [], isLoading: linesLoading } = useQuery<WorkOrderLineWithDetails[]>({
    queryKey: ["/api/work-orders", workOrderId, "lines"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/lines`);
      if (!res.ok) throw new Error("Failed to fetch work order lines");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  // Metadata queries
  const { data: metadataTypes = [] } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata/types"],
    enabled: open,
  });

  const { data: workOrderMetadata = [], isLoading: metadataLoading } = useQuery<WorkOrderMetadata[]>({
    queryKey: ["/api/metadata/work-orders", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/work-orders/${workOrderId}`);
      if (!res.ok) throw new Error("Failed to fetch metadata");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  // Task #665: fält kopplade till orderns ordertyp. Kundlås (#663) tillämpas server-
  // side via ?customerId så irrelevanta fält aldrig dyker upp i formuläret.
  const orderType = workOrder?.orderType;
  const { data: coupledFields = [], isLoading: coupledLoading } = useQuery<OrderTypeMetadataField[]>({
    queryKey: ["/api/order-type-metadata", orderType, workOrder?.customerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (workOrder?.customerId) params.set("customerId", workOrder.customerId);
      const qs = params.toString();
      const res = await fetch(`/api/order-type-metadata/${encodeURIComponent(orderType!)}${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch coupled fields");
      return res.json();
    },
    enabled: open && !!orderType,
  });

  const addMetadataMutation = useMutation({
    mutationFn: async ({ metadataTypNamn, varde }: { metadataTypNamn: string; varde: string }) => {
      await apiRequest("POST", `/api/metadata/work-orders/${workOrderId}`, { metadataTypNamn, varde });
      if (hasBulkTargets) {
        await Promise.all(otherBulkIds.map(targetId =>
          apiRequest("POST", `/api/metadata/work-orders/${targetId}`, { metadataTypNamn, varde })
        ));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/work-orders", workOrderId] });
      for (const targetId of otherBulkIds) {
        queryClient.invalidateQueries({ queryKey: ["/api/metadata/work-orders", targetId] });
      }
      setSelectedMetadataType("");
      setMetadataValue("");
      setMetadataPopoverOpen(false);
      toast({ title: "Metadata tillagd", description: hasBulkTargets ? `Metadata tillagd på alla ${otherBulkIds.length + 1} markerade jobb.` : "Metadata har lagts till på jobbet." });
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte lägga till metadata", description: error.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const removeMetadataMutation = useMutation({
    mutationFn: async (metadataId: string) => {
      return apiRequest("DELETE", `/api/metadata/work-orders/metadata/${metadataId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/work-orders", workOrderId] });
      toast({ title: "Metadata borttagen", description: "Metadata har tagits bort från jobbet." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort metadata", description: error.message, variant: "destructive" });
    },
  });

  // Task #665: spara värde för ett kopplat fält via befintlig WO-metadata-väg.
  // Ersätter ev. befintligt värde eftersom POST alltid lägger till. Vi skapar det
  // nya värdet FÖRST och raderar det gamla först efter lyckad POST — så att ett
  // misslyckat POST aldrig leder till dataförlust (värsta utfallet blir en kortvarig
  // dubblett om DELETE skulle fela, vilket invalidate-refetchen synliggör).
  const saveCoupledFieldMutation = useMutation({
    mutationFn: async ({ fieldId, namn, varde, existingId }: { fieldId: string; namn: string; varde: string; existingId?: string }) => {
      const trimmed = varde.trim();
      if (trimmed !== "") {
        await apiRequest("POST", `/api/metadata/work-orders/${workOrderId}`, { metadataTypNamn: namn, varde });
      }
      if (existingId) {
        await apiRequest("DELETE", `/api/metadata/work-orders/metadata/${existingId}`);
      }
      return fieldId;
    },
    onSuccess: (fieldId: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/work-orders", workOrderId] });
      setCoupledDrafts((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
      toast({ title: "Fält sparat", description: "Värdet har sparats på jobbet." });
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte spara fält", description: error.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const handleAddMetadata = () => {
    if (!selectedMetadataType || !metadataValue.trim()) {
      toast({ title: "Fyll i alla fält", description: "Välj metadatatyp och ange värde.", variant: "destructive" });
      return;
    }
    addMetadataMutation.mutate({ metadataTypNamn: selectedMetadataType, varde: metadataValue });
  };

  const getMetadataDisplayValue = (metadata: WorkOrderMetadata) => {
    const { katalog } = metadata;
    switch (katalog.datatyp) {
      case 'string': return metadata.vardeString || '';
      case 'integer': return metadata.vardeInteger?.toString() || '';
      case 'decimal': return metadata.vardeDecimal?.toString() || '';
      case 'boolean': return metadata.vardeBoolean ? 'Ja' : 'Nej';
      case 'datetime': return metadata.vardeDatetime ? format(new Date(metadata.vardeDatetime), 'PPP', { locale: sv }) : '';
      case 'json': return JSON.stringify(metadata.vardeJson);
      case 'referens': return metadata.vardeReferens || '';
      default: return '';
    }
  };

  // Task #665: råvärde (för input-förifyllning) av ett sparat WO-metadata.
  const getMetadataRawValue = (metadata: WorkOrderMetadata): string => {
    switch (metadata.katalog.datatyp) {
      case 'string': return metadata.vardeString ?? '';
      case 'integer': return metadata.vardeInteger != null ? String(metadata.vardeInteger) : '';
      case 'decimal': return metadata.vardeDecimal != null ? String(metadata.vardeDecimal) : '';
      case 'boolean': return metadata.vardeBoolean == null ? '' : metadata.vardeBoolean ? 'true' : 'false';
      case 'datetime': return metadata.vardeDatetime ? metadata.vardeDatetime.slice(0, 10) : '';
      case 'json': return metadata.vardeJson != null ? JSON.stringify(metadata.vardeJson) : '';
      case 'referens': return metadata.vardeReferens ?? '';
      default: return '';
    }
  };

  // Task #665: snabb uppslag av sparat WO-metadata per katalog-fält-id.
  const savedMetaByFieldId = useMemo(() => {
    const m = new Map<string, WorkOrderMetadata>();
    for (const meta of workOrderMetadata) m.set(meta.metadataKatalogId, meta);
    return m;
  }, [workOrderMetadata]);

  const { data: communications = [], isLoading: communicationsLoading } = useQuery<CustomerCommunication[]>({
    queryKey: ["/api/work-orders", workOrderId, "communications"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/communications`);
      if (!res.ok) throw new Error("Failed to fetch communications");
      return res.json();
    },
    enabled: !!workOrderId && open,
  });

  const { data: customer } = useQuery<Customer>({
    queryKey: ["/api/customers", workOrder?.customerId],
    queryFn: async () => {
      const res = await fetch(`/api/customers/${workOrder!.customerId}`);
      if (!res.ok) throw new Error("Failed to fetch customer");
      return res.json();
    },
    enabled: !!workOrder?.customerId && open,
  });

  useEffect(() => {
    if (!open) {
      setDesiredStart(undefined);
      setDesiredEnd(undefined);
      setDesiredDirty(false);
      return;
    }
    if (workOrder) {
      setDesiredStart(workOrder.desiredDeliveryStart ? new Date(workOrder.desiredDeliveryStart) : undefined);
      setDesiredEnd(workOrder.desiredDeliveryEnd ? new Date(workOrder.desiredDeliveryEnd) : undefined);
      setDesiredDirty(false);
    }
  }, [open, workOrder?.id, workOrder?.desiredDeliveryStart, workOrder?.desiredDeliveryEnd]);

  const updateDesiredPeriodMutation = useMutation({
    mutationFn: async ({ start, end }: { start: Date | null; end: Date | null }) => {
      return apiRequest("PATCH", `/api/work-orders/${workOrderId}`, {
        desiredDeliveryStart: start ? start.toISOString() : null,
        desiredDeliveryEnd: end ? end.toISOString() : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
      setDesiredDirty(false);
      toast({ title: "Önskad period sparad" });
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte spara önskad period", description: error?.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const isScheduledOutsideDesired = useMemo(() => {
    if (!workOrder?.scheduledDate) return false;
    const sd = new Date(workOrder.scheduledDate);
    if (desiredStart) {
      const lowerBound = new Date(desiredStart.getFullYear(), desiredStart.getMonth(), desiredStart.getDate(), 0, 0, 0, 0);
      if (sd < lowerBound) return true;
    }
    if (desiredEnd) {
      const upperBound = new Date(desiredEnd.getFullYear(), desiredEnd.getMonth(), desiredEnd.getDate(), 23, 59, 59, 999);
      if (sd > upperBound) return true;
    }
    return false;
  }, [workOrder?.scheduledDate, desiredStart, desiredEnd]);

  const handleOpenSmsDialog = () => {
    const resource = workOrder?.resourceName || "Tekniker";
    const address = workOrder?.objectAddress || workOrder?.objectName || "";
    const orderNum = workOrder?.id?.slice(0, 8) || "";
    const defaultMsg = `Hej! Order ${orderNum}: ${resource} kommer till ${address}. Kontakta oss vid frågor.`;
    setSmsMessage(defaultMsg);
    setSmsPhone(customer?.phone || "");
    setShowSmsDialog(true);
  };

  const sendSmsMutation = useMutation({
    mutationFn: async ({ message, recipientPhone }: { message: string; recipientPhone: string }) => {
      const res = await apiRequest("POST", `/api/work-orders/${workOrderId}/send-sms`, { message, recipientPhone });
      return res.json();
    },
    onSuccess: (data: { success: boolean; error?: string }) => {
      if (data.success) {
        toast({ title: "SMS skickat", description: "Meddelandet har skickats." });
        setShowSmsDialog(false);
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "communications"] });
      } else {
        toast({ title: "SMS misslyckades", description: data.error || "Kunde inte skicka SMS.", variant: "destructive" });
      }
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte skicka SMS", description: error.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const addObjectMutation = useMutation({
    mutationFn: async (objectId: string) => {
      return apiRequest("POST", `/api/work-orders/${workOrderId}/objects`, { objectId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "objects"] });
      setObjectSearch("");
      setObjectPopoverOpen(false);
      toast({ title: "Objekt tillagt", description: "Objektet har lagts till på jobbet." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte lägga till objektet", description: error.message, variant: "destructive" });
    },
  });

  const removeObjectMutation = useMutation({
    mutationFn: async (workOrderObjectId: string) => {
      return apiRequest("DELETE", `/api/work-order-objects/${workOrderObjectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "objects"] });
      toast({ title: "Objekt borttaget", description: "Objektet har tagits bort från jobbet." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort objektet", description: error.message, variant: "destructive" });
    },
  });

  const handleAddObject = (objectId: string) => {
    const alreadyLinked = linkedObjects.some(o => o.objectId === objectId);
    if (alreadyLinked) {
      toast({ title: "Redan tillagt", description: "Detta objekt finns redan på jobbet.", variant: "destructive" });
      return;
    }
    addObjectMutation.mutate(objectId);
  };

  // Articles query and mutation
  interface Article {
    id: string;
    name: string;
    description?: string;
    articleNumber?: string;
    unitPrice?: number;
    productionMinutes?: number;
  }

  const { data: articles = [], isLoading: isArticlesLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
    enabled: showAddArticleDialog,
  });

  const filteredArticles = useMemo(() => {
    if (!articleSearch.trim()) return articles;
    const search = articleSearch.toLowerCase();
    return articles.filter(a => 
      a.name?.toLowerCase().includes(search) || 
      a.articleNumber?.toLowerCase().includes(search) ||
      a.description?.toLowerCase().includes(search)
    );
  }, [articles, articleSearch]);

  const addArticleMutation = useMutation({
    mutationFn: async ({ articleId, quantity }: { articleId: string; quantity: number }) => {
      await apiRequest("POST", `/api/work-orders/${workOrderId}/lines`, { articleId, quantity });
      if (hasBulkTargets) {
        await Promise.all(otherBulkIds.map(targetId =>
          apiRequest("POST", `/api/work-orders/${targetId}/lines`, { articleId, quantity })
        ));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "lines"] });
      for (const targetId of otherBulkIds) {
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders", targetId, "lines"] });
      }
      setShowAddArticleDialog(false);
      setSelectedArticleId("");
      setArticleQuantity(1);
      setArticleSearch("");
      toast({ title: "Artikel tillagd", description: hasBulkTargets ? `Artikeln tillagd på alla ${otherBulkIds.length + 1} markerade jobb.` : "Artikeln har lagts till på jobbet." });
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte lägga till artikeln", description: error.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const handleAddArticle = () => {
    if (!selectedArticleId) {
      toast({ title: "Välj artikel", description: "Du måste välja en artikel att lägga till.", variant: "destructive" });
      return;
    }
    addArticleMutation.mutate({ articleId: selectedArticleId, quantity: articleQuantity });
  };

  const bulkApplyLinesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/work-orders/bulk-apply-lines", {
        sourceWorkOrderId: workOrderId,
        targetWorkOrderIds: otherBulkIds,
      });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Artiklar tillämpade", description: `Artiklar kopierade till ${data.applied} jobb.` });
      for (const targetId of otherBulkIds) {
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders", targetId, "lines"] });
      }
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte tillämpa artiklar", description: error.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const bulkApplyMetadataMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/metadata/work-orders/bulk-apply", {
        sourceWorkOrderId: workOrderId,
        targetWorkOrderIds: otherBulkIds,
      });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Metadata tillämpade", description: `Metadata kopierade till ${data.applied} jobb.` });
    },
    onError: (error: any) => {
      toast({ title: "Kunde inte tillämpa metadata", description: error.message || "Försök igen senare.", variant: "destructive" });
    },
  });

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: "Utkast",
      scheduled: "Schemalagt",
      in_progress: "Pågående",
      completed: "Slutfört",
      cancelled: "Avbokat",
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    if (status === "draft") return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300";
    return workOrderStatusBadge[status] ?? workOrderStatusBadge.unassigned;
  };

  if (!workOrderId) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Jobbdetaljer
            {workOrder?.orderStatus && (
              <Badge className={cn("ml-2", getStatusColor(workOrder.orderStatus))}>
                {getStatusLabel(workOrder.orderStatus)}
              </Badge>
            )}
            {workOrderId && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto mr-6 h-7 gap-1.5"
                onClick={() => {
                  onClose();
                  setLocation(`/work-orders/${workOrderId}`);
                }}
                data-testid="button-open-work-order"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Öppna order
              </Button>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detaljer och åtgärder för jobbet
          </DialogDescription>
          {hasBulkTargets && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20" data-testid="banner-bulk-selection">
              <Copy className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm text-primary font-medium">
                {otherBulkIds.length + 1} jobb markerade — artiklar och metadata du lägger till tillämpas på alla
              </span>
            </div>
          )}
        </DialogHeader>

        {workOrderLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : workOrder ? (
          <div className="space-y-5 py-3">
            <div className="space-y-2">
              <h3 className="font-semibold text-base leading-tight">{workOrder.title}</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span className="text-foreground">{workOrder.customerName || "Okänd kund"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{workOrder.objectAddress || workOrder.objectName || "Ingen adress"}</span>
                </div>
                {workOrder.estimatedDuration && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{workOrder.estimatedDuration} min</span>
                  </div>
                )}
                {workOrder.scheduledDate && (
                  <div className="flex items-center gap-1.5">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span>{format(new Date(workOrder.scheduledDate), "PPP", { locale: sv })}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Önskad leveransperiod
                </h4>
                {desiredDirty && (
                  <Button
                    size="sm"
                    onClick={() => updateDesiredPeriodMutation.mutate({ start: desiredStart || null, end: desiredEnd || null })}
                    disabled={updateDesiredPeriodMutation.isPending}
                    data-testid="button-save-desired-period"
                  >
                    {updateDesiredPeriodMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Spara
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Tidigast</label>
                  <div className="flex gap-1">
                    <Input
                      type="date"
                      value={desiredStart ? format(desiredStart, "yyyy-MM-dd") : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          setDesiredStart(undefined);
                        } else {
                          const [y, m, d] = v.split("-").map(Number);
                          setDesiredStart(new Date(y, m - 1, d, 12, 0, 0, 0));
                        }
                        setDesiredDirty(true);
                      }}
                      className="h-9"
                      data-testid="input-detail-desired-start"
                    />
                    {desiredStart && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => { setDesiredStart(undefined); setDesiredDirty(true); }}
                        data-testid="button-clear-detail-desired-start"
                        title="Rensa tidigaste datum"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Senast</label>
                  <div className="flex gap-1">
                    <Input
                      type="date"
                      value={desiredEnd ? format(desiredEnd, "yyyy-MM-dd") : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          setDesiredEnd(undefined);
                        } else {
                          const [y, m, d] = v.split("-").map(Number);
                          setDesiredEnd(new Date(y, m - 1, d, 12, 0, 0, 0));
                        }
                        setDesiredDirty(true);
                      }}
                      className="h-9"
                      data-testid="input-detail-desired-end"
                    />
                    {desiredEnd && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => { setDesiredEnd(undefined); setDesiredDirty(true); }}
                        data-testid="button-clear-detail-desired-end"
                        title="Rensa senaste datum"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              {desiredStart && desiredEnd && desiredEnd < desiredStart && (
                <Alert variant="default" className="border-chart-4/30 dark:border-chart-4/70" data-testid="alert-desired-range-invalid">
                  <AlertTriangle className="h-4 w-4 text-chart-4" />
                  <AlertDescription className="text-sm">
                    Senaste datum ligger före tidigaste — kontrollera ordningen.
                  </AlertDescription>
                </Alert>
              )}
              {isScheduledOutsideDesired && (
                <Alert variant="default" className="border-chart-4/30 dark:border-chart-4/70" data-testid="alert-scheduled-outside-desired">
                  <AlertTriangle className="h-4 w-4 text-chart-4" />
                  <AlertDescription className="text-sm">
                    Planerat datum ligger utanför kundens önskade period.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {workOrder.tenantId && (
              <div className="pt-3 border-t">
                <TaskTimewindowsEditor
                  workOrderId={workOrder.id}
                  tenantId={workOrder.tenantId}
                />
              </div>
            )}

            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Artiklar {workOrderLines.length > 0 && <span className="text-xs">({workOrderLines.length})</span>}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowAddArticleDialog(true)}
                  data-testid="button-add-article"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Lägg till
                </Button>
              </div>

              {linesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : workOrderLines.length === 0 ? null : (
                <div className="space-y-2">
                  {workOrderLines.map((line) => (
                    <div 
                      key={line.id}
                      className="flex items-center justify-between p-3 border rounded-md"
                      data-testid={`article-line-${line.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium text-sm" data-testid={`text-article-name-${line.id}`}>{line.articleName || "Artikel"}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span data-testid={`text-article-quantity-${line.id}`}>Antal: {line.quantity}</span>
                            {line.resolvedPrice !== null && line.resolvedPrice > 0 && (
                              <span className="flex items-center gap-1" data-testid={`text-article-price-${line.id}`}>
                                <DollarSign className="h-3 w-3" />
                                {(line.resolvedPrice / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                              </span>
                            )}
                            {line.resolvedProductionMinutes !== null && line.resolvedProductionMinutes > 0 && (
                              <span className="flex items-center gap-1" data-testid={`text-article-time-${line.id}`}>
                                <Clock className="h-3 w-3" />
                                {line.resolvedProductionMinutes} min
                              </span>
                            )}
                          </div>
                          {line.notes && (
                            <div className="text-xs text-muted-foreground mt-1" data-testid={`text-article-notes-${line.id}`}>{line.notes}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {line.isCompleted && (
                          <Badge variant="default" className="text-xs" data-testid={`badge-completed-${line.id}`}>Klar</Badge>
                        )}
                        {line.isOptional && (
                          <Badge variant="outline" className="text-xs" data-testid={`badge-optional-${line.id}`}>Valfri</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {workOrderLines.length > 0 && (
                    <div className="flex justify-end gap-4 pt-2 text-sm font-medium">
                      <span data-testid="text-articles-total">
                        Totalt: {(workOrderLines.reduce((sum, l) => sum + (l.resolvedPrice || 0) * (l.quantity || 1), 0) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                      </span>
                      <span className="text-muted-foreground" data-testid="text-articles-time">
                        {workOrderLines.reduce((sum, l) => sum + (l.resolvedProductionMinutes || 0) * (l.quantity || 1), 0)} min
                      </span>
                    </div>
                  )}

                  {hasBulkTargets && workOrderLines.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2 border-primary/30 text-primary hover:bg-primary/10"
                      onClick={() => bulkApplyLinesMutation.mutate()}
                      disabled={bulkApplyLinesMutation.isPending}
                      data-testid="button-bulk-apply-articles"
                    >
                      {bulkApplyLinesMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Copy className="h-4 w-4 mr-2" />
                      )}
                      Tillämpa artiklar på alla {otherBulkIds.length} markerade jobb
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Package className="h-3.5 w-3.5" />
                  Kopplade objekt {linkedObjects.length > 0 && <span className="text-xs">({linkedObjects.length})</span>}
                </h4>
                <div className="relative">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-add-object" onClick={() => setObjectPopoverOpen(!objectPopoverOpen)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Lägg till
                  </Button>
                  {objectPopoverOpen && (
                    <div className="absolute z-50 mt-1 right-0 w-[350px] rounded-md border bg-popover shadow-md">
                      <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <input
                          className="flex h-9 w-full bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                          placeholder="Sök objekt..."
                          value={objectSearch}
                          onChange={(e) => setObjectSearch(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="max-h-[200px] overflow-y-auto">
                        {searchLoading && (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        )}
                        {!searchLoading && searchObjects.length === 0 && objectSearch.length >= 2 && (
                          <div className="py-4 text-center text-sm text-muted-foreground">Inga objekt hittades</div>
                        )}
                        {!searchLoading && searchObjects.length === 0 && objectSearch.length < 2 && (
                          <div className="py-4 text-center text-sm text-muted-foreground">
                            Skriv minst 2 tecken för att söka
                          </div>
                        )}
                        {searchObjects.length > 0 && (
                          <div className="p-1">
                            {searchObjects.map((obj) => {
                              const isLinked = linkedObjects.some(o => o.objectId === obj.id);
                              return (
                                <button
                                  key={obj.id}
                                  type="button"
                                  disabled={isLinked || addObjectMutation.isPending}
                                  className={cn(
                                    "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                    isLinked && "opacity-50 cursor-not-allowed"
                                  )}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleAddObject(obj.id)}
                                >
                                  {isLinked ? (
                                    <Check className="mr-2 h-4 w-4 shrink-0" />
                                  ) : (
                                    <div className="mr-2 h-4 w-4 shrink-0" />
                                  )}
                                  <div className="flex flex-col items-start">
                                    <span>{obj.name}</span>
                                    {obj.address && (
                                      <span className="text-xs text-muted-foreground">{obj.address}</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {objectsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : linkedObjects.length === 0 ? null : (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {linkedObjects.map((obj) => (
                      <div 
                        key={obj.id}
                        className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                      >
                        <div className="flex items-center gap-3">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-sm">{obj.objectName}</div>
                            {obj.objectAddress && (
                              <div className="text-xs text-muted-foreground">{obj.objectAddress}</div>
                            )}
                            {obj.objectType && (
                              <Badge variant="outline" className="text-xs mt-1">
                                {obj.objectType}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeObjectMutation.mutate(obj.id)}
                          disabled={removeObjectMutation.isPending}
                          data-testid={`button-remove-object-${obj.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {workOrder.objectId && (
                <div className="text-xs text-muted-foreground">
                  Primärt objekt: {workOrder.objectName || workOrder.objectId}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Tag className="h-3.5 w-3.5" />
                  Metadata {workOrderMetadata.length > 0 && <span className="text-xs">({workOrderMetadata.length})</span>}
                </h4>
                <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="button-add-metadata" onClick={() => setMetadataPopoverOpen(!metadataPopoverOpen)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Lägg till
                </Button>
              </div>

              {/* Task #665: fält kopplade till orderns ordertyp — visas automatiskt för inmatning */}
              {coupledLoading ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : coupledFields.length > 0 ? (
                <div className="border rounded-md p-3 space-y-3 bg-muted/20" data-testid="section-coupled-fields">
                  <div className="text-xs font-medium text-muted-foreground">
                    Fält för ordertypen{orderType ? ` "${getOrderTypeLabel(orderType)}"` : ""}
                  </div>
                  {coupledFields.map((field) => {
                    const savedMeta = savedMetaByFieldId.get(field.id);
                    const savedValue = savedMeta ? getMetadataRawValue(savedMeta) : "";
                    const draft = coupledDrafts[field.id];
                    const currentValue = draft !== undefined ? draft : savedValue;
                    const isDirty = draft !== undefined && draft !== savedValue;
                    const setVal = (v: string) =>
                      setCoupledDrafts((prev) => ({ ...prev, [field.id]: v }));
                    return (
                      <CoupledFieldInput
                        key={field.id}
                        field={field}
                        value={currentValue}
                        onChange={setVal}
                        controlClassName="flex-1"
                        action={
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isDirty || saveCoupledFieldMutation.isPending}
                            onClick={() =>
                              saveCoupledFieldMutation.mutate({
                                fieldId: field.id,
                                namn: field.namn,
                                varde: currentValue,
                                existingId: savedMeta?.id,
                              })
                            }
                            data-testid={`button-save-coupled-field-${field.id}`}
                          >
                            {saveCoupledFieldMutation.isPending && saveCoupledFieldMutation.variables?.fieldId === field.id && (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            )}
                            Spara
                          </Button>
                        }
                      />
                    );
                  })}
                </div>
              ) : null}

              {metadataPopoverOpen && (
                <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Metadatatyp</label>
                    <Select value={selectedMetadataType} onValueChange={(val) => { setSelectedMetadataType(val); setMetadataValue(""); }}>
                      <SelectTrigger data-testid="select-metadata-type">
                        <SelectValue placeholder="Välj typ..." />
                      </SelectTrigger>
                      <SelectContent>
                        {metadataTypes.map((type) => (
                          <SelectItem key={type.id} value={type.namn}>
                            {type.namn}
                            {type.beskrivning && (
                              <span className="text-muted-foreground ml-2">- {type.beskrivning}</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Värde</label>
                    {(() => {
                      const selectedType = metadataTypes.find(t => t.namn === selectedMetadataType);
                      const datatype = selectedType?.datatyp || 'string';

                      if (datatype === 'boolean') {
                        return (
                          <Select value={metadataValue} onValueChange={setMetadataValue}>
                            <SelectTrigger data-testid="input-metadata-value">
                              <SelectValue placeholder="Välj värde..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Ja</SelectItem>
                              <SelectItem value="false">Nej</SelectItem>
                            </SelectContent>
                          </Select>
                        );
                      }

                      return (
                        <Input
                          type={datatype === 'integer' || datatype === 'decimal' ? 'number' : 'text'}
                          step={datatype === 'decimal' ? '0.01' : undefined}
                          placeholder={
                            datatype === 'integer' ? 'Ange heltal...' :
                            datatype === 'decimal' ? 'Ange decimaltal...' :
                            datatype === 'datetime' ? 'ÅÅÅÅ-MM-DD' :
                            'Ange värde...'
                          }
                          value={metadataValue}
                          onChange={(e) => setMetadataValue(e.target.value)}
                          data-testid="input-metadata-value"
                        />
                      );
                    })()}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleAddMetadata}
                      disabled={addMetadataMutation.isPending || !selectedMetadataType || !metadataValue.trim()}
                      className="flex-1"
                      size="sm"
                      data-testid="button-confirm-add-metadata"
                    >
                      {addMetadataMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Lägg till
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setMetadataPopoverOpen(false); setSelectedMetadataType(""); setMetadataValue(""); }}
                      data-testid="button-cancel-metadata"
                    >
                      Avbryt
                    </Button>
                  </div>
                </div>
              )}

              {metadataLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : workOrderMetadata.length === 0 ? null : (
                <ScrollArea className="h-[150px]">
                  <div className="space-y-2">
                    {workOrderMetadata.map((meta) => (
                      <div 
                        key={meta.id}
                        className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                      >
                        <div className="flex items-center gap-3">
                          <Tag className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium text-sm">{metadataDisplayName(meta.katalog)}</div>
                            <div className="text-xs text-muted-foreground">{getMetadataDisplayValue(meta)}</div>
                            {meta.katalog.kategori && (
                              <Badge variant="outline" className="text-xs mt-1">
                                {meta.katalog.kategori}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeMetadataMutation.mutate(meta.id)}
                          disabled={removeMetadataMutation.isPending}
                          data-testid={`button-remove-metadata-${meta.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {hasBulkTargets && workOrderMetadata.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => bulkApplyMetadataMutation.mutate()}
                  disabled={bulkApplyMetadataMutation.isPending}
                  data-testid="button-bulk-apply-metadata"
                >
                  {bulkApplyMetadataMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Tillämpa metadata på alla {otherBulkIds.length} markerade jobb
                </Button>
              )}
            </div>

            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Kommunikation {communications.length > 0 && <span className="text-xs">({communications.length})</span>}
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleOpenSmsDialog}
                  data-testid="button-send-sms"
                >
                  <Send className="h-3.5 w-3.5 mr-1" />
                  Skicka SMS
                </Button>
              </div>

              {communicationsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : communications.length === 0 ? null : (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {communications.map((comm) => (
                      <div
                        key={comm.id}
                        className="p-3 border rounded-md space-y-1"
                        data-testid={`comm-entry-${comm.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {comm.status === "sent" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-chart-2" />
                            ) : comm.status === "failed" ? (
                              <XCircle className="h-3.5 w-3.5 text-destructive" />
                            ) : (
                              <AlertCircle className="h-3.5 w-3.5 text-chart-3" />
                            )}
                            <Badge variant="outline" className="text-xs">
                              {comm.channel === "sms" ? "SMS" : comm.channel === "email" ? "E-post" : comm.channel}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {comm.notificationType === "manual_sms" ? "Manuellt" :
                               comm.notificationType === "technician_on_way" ? "Tekniker på väg" :
                               comm.notificationType === "on_route" ? "På väg" :
                               comm.notificationType === "completed" ? "Slutfört" :
                               comm.notificationType === "eta_update" ? "ETA-uppdatering" :
                               comm.notificationType}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {comm.createdAt ? format(new Date(comm.createdAt), "d MMM HH:mm", { locale: sv }) : ""}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{comm.message}</p>
                        {comm.recipientPhone && (
                          <span className="text-xs text-muted-foreground">Till: {comm.recipientPhone}</span>
                        )}
                        {comm.errorMessage && (
                          <p className="text-xs text-destructive">{comm.errorMessage}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            Kunde inte ladda jobbdetaljer.
          </div>
        )}

        {workOrder && (
          (() => {
            const cancellable =
              (workOrder.orderStatus === "skapad" ||
                workOrder.orderStatus === "planerad_pre" ||
                workOrder.orderStatus === "planerad_resurs") &&
              !workOrder.lockedAt &&
              !workOrder.frozenAt;
            if (!cancellable) return null;
            return (
              <div className="pt-4 border-t flex justify-start">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCancelDialog(true)}
                  className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  data-testid="button-cancel-order"
                >
                  <Ban className="h-4 w-4" />
                  Avbeställ order
                </Button>
              </div>
            );
          })()
        )}
      </DialogContent>

      <CancelOrderDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        workOrderId={workOrderId}
        workOrderTitle={workOrder?.title}
        onSuccess={() => {
          setShowCancelDialog(false);
          onClose();
        }}
      />

      <Dialog open={showSmsDialog} onOpenChange={setShowSmsDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Skicka SMS
            </DialogTitle>
            <DialogDescription>
              Skicka ett SMS till kunden för denna order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Telefonnummer</label>
              <Input
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                placeholder="+46701234567"
                data-testid="input-sms-phone"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Meddelande</label>
              <Textarea
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                rows={4}
                maxLength={320}
                data-testid="input-sms-message"
              />
              <p className="text-xs text-muted-foreground text-right">{smsMessage.length}/320 tecken</p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowSmsDialog(false)}
                data-testid="button-cancel-sms"
              >
                Avbryt
              </Button>
              <Button
                className="flex-1"
                onClick={() => sendSmsMutation.mutate({ message: smsMessage, recipientPhone: smsPhone })}
                disabled={sendSmsMutation.isPending || !smsPhone.trim() || !smsMessage.trim()}
                data-testid="button-confirm-send-sms"
              >
                {sendSmsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Skicka
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddArticleDialog} onOpenChange={setShowAddArticleDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Lägg till artikel</DialogTitle>
            <DialogDescription>
              Sök och välj en artikel att lägga till på jobbet.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Sök artikel</label>
              <Input
                placeholder="Sök på namn, artikelnummer..."
                value={articleSearch}
                onChange={(e) => setArticleSearch(e.target.value)}
                data-testid="input-article-search"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Välj artikel</label>
              <ScrollArea className="h-[200px] border rounded-md">
                <div className="p-2 space-y-1">
                  {filteredArticles.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      {isArticlesLoading ? "Laddar artiklar..." : articles.length === 0 ? "Inga artiklar finns registrerade ännu." : "Inga artiklar hittades."}
                    </div>
                  ) : (
                    filteredArticles.map((article) => (
                      <div
                        key={article.id}
                        className={cn(
                          "flex items-center justify-between p-2 rounded-md cursor-pointer hover-elevate",
                          selectedArticleId === article.id && "bg-primary/10 border border-primary"
                        )}
                        onClick={() => setSelectedArticleId(article.id)}
                        data-testid={`article-option-${article.id}`}
                      >
                        <div>
                          <div className="font-medium text-sm">{article.name}</div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {article.articleNumber && <span>#{article.articleNumber}</span>}
                            {article.unitPrice && (
                              <span>{(article.unitPrice / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr</span>
                            )}
                            {article.productionMinutes && <span>{article.productionMinutes} min</span>}
                          </div>
                        </div>
                        {selectedArticleId === article.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Antal</label>
              <Input
                type="number"
                min={1}
                value={articleQuantity}
                onChange={(e) => setArticleQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                data-testid="input-article-quantity"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={() => {
                  setShowAddArticleDialog(false);
                  setSelectedArticleId("");
                  setArticleQuantity(1);
                  setArticleSearch("");
                }}
                data-testid="button-cancel-add-article"
              >
                Avbryt
              </Button>
              <Button
                className="flex-1"
                onClick={handleAddArticle}
                disabled={!selectedArticleId || addArticleMutation.isPending}
                data-testid="button-confirm-add-article"
              >
                {addArticleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Lägg till
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
