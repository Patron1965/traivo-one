import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Loader2, FileText, Receipt, Send, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, Search, Eye,
  Building2, DollarSign, AlertTriangle,
  RefreshCw, BarChart3, Plus, Trash2, CreditCard, Undo2
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { sv } from "date-fns/locale";
import type { Customer, Article } from "@shared/schema";

interface InvoiceLine {
  workOrderId: string;
  description: string;
  objectName: string | null;
  objectAddress: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  completedAt: string | null;
  metadata: Record<string, string>;
}

interface InvoicePreview {
  customerId: string;
  customerName: string;
  invoiceType: string;
  headerMetadata: Record<string, string>;
  lines: InvoiceLine[];
  summary: {
    totalExVat: number;
    vat: number;
    totalInclVat: number;
    orderCount: number;
  };
  waitForAll: boolean;
}

interface FortnoxExport {
  id: string;
  tenantId: string;
  workOrderId: string | null;
  fortnoxInvoiceNumber: string | null;
  status: string;
  costCenter: string | null;
  project: string | null;
  payerId: string | null;
  totalAmount: number | null;
  errorMessage: string | null;
  isCreditInvoice: boolean | null;
  originalExportId: string | null;
  creditedByExportId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  customerId: string | null;
  exportedAt: string | null;
  createdAt: string;
}

interface ManualLine {
  id: string;
  tenantId: string;
  customerId: string;
  articleId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  costCenter: string | null;
  project: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}

interface ExportResult {
  exported: number;
  failed: number;
  results: Array<{
    customerId: string;
    customerName: string;
    status: string;
    exportId?: string;
    error?: string;
  }>;
}

const INVOICE_TYPE_LABELS: Record<string, string> = {
  per_task: "Per uppdrag",
  per_room: "Per rum",
  per_area: "Per område",
  monthly: "Månadsavgift",
};

const EXPORT_STATUS_LABELS: Record<string, string> = {
  pending: "Väntar",
  processing: "Bearbetas",
  exported: "Exporterad",
  failed: "Misslyckad",
  cancelled: "Avbruten",
  credited: "Krediterad",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(amount);
}

function ExportStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    exported: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    credited: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  };
  return (
    <Badge data-testid={`badge-export-status-${status}`} className={variants[status] || variants.pending}>
      {EXPORT_STATUS_LABELS[status] || status}
    </Badge>
  );
}

export default function InvoicingPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("preview");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("all");
  const [fromDate, setFromDate] = useState(() => format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(() => format(endOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd"));
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [previewDialogInvoice, setPreviewDialogInvoice] = useState<InvoicePreview | null>(null);
  const [exportStatusFilter, setExportStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [manualLineDialogOpen, setManualLineDialogOpen] = useState(false);
  const [creditDialogExport, setCreditDialogExport] = useState<FortnoxExport | null>(null);
  const [manualLineForm, setManualLineForm] = useState({
    customerId: "",
    articleId: "",
    description: "",
    quantity: 1,
    unitPrice: 0,
    costCenter: "",
    project: "",
    notes: "",
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: manualLines = [], refetch: refetchManualLines } = useQuery<ManualLine[]>({
    queryKey: ["/api/manual-invoice-lines"],
  });

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCustomer !== "all") params.set("customerId", selectedCustomer);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    return params.toString();
  }, [selectedCustomer, fromDate, toDate]);

  const { data: invoicePreviews = [], isLoading: isLoadingPreviews, refetch: refetchPreviews } = useQuery<InvoicePreview[]>({
    queryKey: [`/api/invoice-preview?${queryParams}`],
  });

  const { data: fortnoxExports = [], isLoading: isLoadingExports, refetch: refetchExports } = useQuery<FortnoxExport[]>({
    queryKey: ["/api/fortnox/exports"],
  });

  const { data: fortnoxStatus } = useQuery<{ connected: boolean; isActive: boolean }>({
    queryKey: ["/api/fortnox/status"],
  });

  const exportMutation = useMutation<ExportResult, Error, InvoicePreview[]>({
    mutationFn: async (invoices) => {
      const res = await apiRequest("POST", "/api/invoice-preview/export-to-fortnox", { invoices });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Export slutförd",
        description: `${data.exported} fakturor exporterade${data.failed > 0 ? `, ${data.failed} misslyckades` : ""}`,
      });
      setSelectedInvoices(new Set());
      setExportDialogOpen(false);
      refetchExports();
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/exports"] });
    },
    onError: (error) => {
      toast({
        title: "Export misslyckades",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const processExportMutation = useMutation({
    mutationFn: async (exportId: string) => {
      const res = await apiRequest("POST", `/api/fortnox/exports/${exportId}/process`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Faktura skickad till Fortnox" });
      refetchExports();
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skicka till Fortnox", description: error.message, variant: "destructive" });
    },
  });

  const createManualLineMutation = useMutation({
    mutationFn: async (data: typeof manualLineForm) => {
      const res = await apiRequest("POST", "/api/manual-invoice-lines", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Manuell fakturarad skapad" });
      setManualLineDialogOpen(false);
      setManualLineForm({ customerId: "", articleId: "", description: "", quantity: 1, unitPrice: 0, costCenter: "", project: "", notes: "" });
      refetchManualLines();
      refetchPreviews();
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa fakturarad", description: error.message, variant: "destructive" });
    },
  });

  const deleteManualLineMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/manual-invoice-lines/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Manuell fakturarad borttagen" });
      refetchManualLines();
      refetchPreviews();
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort fakturarad", description: error.message, variant: "destructive" });
    },
  });

  const creditInvoiceMutation = useMutation({
    mutationFn: async (exportId: string) => {
      const res = await apiRequest("POST", `/api/fortnox/exports/${exportId}/credit`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Kreditfaktura skapad" });
      setCreditDialogExport(null);
      refetchExports();
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa kreditfaktura", description: error.message, variant: "destructive" });
    },
  });

  const filteredPreviews = useMemo(() => {
    if (!searchQuery) return invoicePreviews;
    const q = searchQuery.toLowerCase();
    return invoicePreviews.filter(ip =>
      ip.customerName.toLowerCase().includes(q) ||
      ip.lines.some(l => l.description?.toLowerCase().includes(q) || l.objectName?.toLowerCase().includes(q))
    );
  }, [invoicePreviews, searchQuery]);

  const filteredExports = useMemo(() => {
    let result = fortnoxExports;
    if (exportStatusFilter !== "all") {
      result = result.filter(e => e.status === exportStatusFilter);
    }
    return result;
  }, [fortnoxExports, exportStatusFilter]);

  const totals = useMemo(() => {
    const totalExVat = filteredPreviews.reduce((s, ip) => s + ip.summary.totalExVat, 0);
    const totalVat = filteredPreviews.reduce((s, ip) => s + ip.summary.vat, 0);
    const totalOrders = filteredPreviews.reduce((s, ip) => s + ip.summary.orderCount, 0);
    return { totalExVat, totalVat, totalInclVat: totalExVat + totalVat, totalOrders, invoiceCount: filteredPreviews.length };
  }, [filteredPreviews]);

  const exportStats = useMemo(() => {
    const pending = fortnoxExports.filter(e => e.status === "pending").length;
    const exported = fortnoxExports.filter(e => e.status === "exported").length;
    const failed = fortnoxExports.filter(e => e.status === "failed").length;
    const credited = fortnoxExports.filter(e => e.status === "credited").length;
    const totalAmount = fortnoxExports.filter(e => e.status === "exported").reduce((s, e) => s + (e.totalAmount || 0), 0);
    return { pending, exported, failed, credited, total: fortnoxExports.length, totalAmount };
  }, [fortnoxExports]);

  const toggleInvoice = (customerId: string) => {
    const next = new Set(selectedInvoices);
    if (next.has(customerId)) next.delete(customerId);
    else next.add(customerId);
    setSelectedInvoices(next);
  };

  const toggleAll = () => {
    if (selectedInvoices.size === filteredPreviews.length) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(filteredPreviews.map(ip => ip.customerId)));
    }
  };

  const toggleExpand = (customerId: string) => {
    const next = new Set(expandedInvoices);
    if (next.has(customerId)) next.delete(customerId);
    else next.add(customerId);
    setExpandedInvoices(next);
  };

  const handleExport = () => {
    const selected = filteredPreviews.filter(ip => selectedInvoices.has(ip.customerId));
    if (selected.length === 0) {
      toast({ title: "Välj minst en faktura att exportera", variant: "destructive" });
      return;
    }
    setExportDialogOpen(true);
  };

  const confirmExport = () => {
    const selected = filteredPreviews.filter(ip => selectedInvoices.has(ip.customerId));
    exportMutation.mutate(selected);
  };

  const selectedInvoiceData = filteredPreviews.filter(ip => selectedInvoices.has(ip.customerId));
  const selectedTotal = selectedInvoiceData.reduce((s, ip) => s + ip.summary.totalInclVat, 0);

  const setDatePreset = (preset: string) => {
    const now = new Date();
    switch (preset) {
      case "last_month": {
        const prev = subMonths(now, 1);
        setFromDate(format(startOfMonth(prev), "yyyy-MM-dd"));
        setToDate(format(endOfMonth(prev), "yyyy-MM-dd"));
        break;
      }
      case "this_month": {
        setFromDate(format(startOfMonth(now), "yyyy-MM-dd"));
        setToDate(format(now, "yyyy-MM-dd"));
        break;
      }
      case "last_30": {
        setFromDate(format(subDays(now, 30), "yyyy-MM-dd"));
        setToDate(format(now, "yyyy-MM-dd"));
        break;
      }
      case "last_90": {
        setFromDate(format(subDays(now, 90), "yyyy-MM-dd"));
        setToDate(format(now, "yyyy-MM-dd"));
        break;
      }
    }
  };

  const draftManualLines = manualLines.filter(ml => ml.status === "draft" || ml.status === "queued");

  return (
    <div className="min-h-screen bg-background" data-testid="invoicing-page">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Fakturering</h1>
            <p className="text-muted-foreground">Förhandsgranska, hantera och exportera fakturor till Fortnox</p>
          </div>
          <div className="flex items-center gap-2">
            {fortnoxStatus?.connected ? (
              <Badge variant="outline" className="border-green-500 text-green-600" data-testid="badge-fortnox-connected">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Fortnox ansluten
              </Badge>
            ) : (
              <Badge variant="outline" className="border-yellow-500 text-yellow-600" data-testid="badge-fortnox-disconnected">
                <AlertTriangle className="h-3 w-3 mr-1" /> Fortnox ej ansluten
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card data-testid="card-kpi-invoices">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <FileText className="h-4 w-4" /> Fakturor
              </div>
              <div className="text-2xl font-bold" data-testid="text-kpi-invoice-count">{totals.invoiceCount}</div>
              <p className="text-xs text-muted-foreground">{totals.totalOrders} ordrar</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-total">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <DollarSign className="h-4 w-4" /> Totalt ex. moms
              </div>
              <div className="text-2xl font-bold" data-testid="text-kpi-total-ex-vat">{formatCurrency(totals.totalExVat)}</div>
              <p className="text-xs text-muted-foreground">Moms: {formatCurrency(totals.totalVat)}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-exported">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Send className="h-4 w-4" /> Exporterade
              </div>
              <div className="text-2xl font-bold" data-testid="text-kpi-exported">{exportStats.exported}</div>
              <p className="text-xs text-muted-foreground">{exportStats.pending} väntar</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-export-value">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <BarChart3 className="h-4 w-4" /> Exporterat värde
              </div>
              <div className="text-2xl font-bold" data-testid="text-kpi-export-value">{formatCurrency(exportStats.totalAmount)}</div>
              <p className="text-xs text-muted-foreground">{exportStats.failed > 0 ? `${exportStats.failed} misslyckade` : "Inga fel"}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4" data-testid="tabs-invoicing">
            <TabsTrigger value="preview" data-testid="tab-preview">
              <Eye className="h-4 w-4 mr-1" /> Förhandsgranskning
            </TabsTrigger>
            <TabsTrigger value="manual" data-testid="tab-manual">
              <Plus className="h-4 w-4 mr-1" /> Manuella rader
              {draftManualLines.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{draftManualLines.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="exports" data-testid="tab-exports">
              <Send className="h-4 w-4 mr-1" /> Exporthistorik
              {exportStats.pending > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{exportStats.pending}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preview">
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-sm font-medium mb-1 block">Kund</label>
                    <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                      <SelectTrigger data-testid="select-customer">
                        <SelectValue placeholder="Alla kunder" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Alla kunder</SelectItem>
                        {customers.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-[150px]">
                    <label className="text-sm font-medium mb-1 block">Från</label>
                    <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} data-testid="input-from-date" />
                  </div>
                  <div className="min-w-[150px]">
                    <label className="text-sm font-medium mb-1 block">Till</label>
                    <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} data-testid="input-to-date" />
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => setDatePreset("last_month")} data-testid="button-preset-last-month">Förra mån</Button>
                    <Button variant="outline" size="sm" onClick={() => setDatePreset("this_month")} data-testid="button-preset-this-month">Denna mån</Button>
                    <Button variant="outline" size="sm" onClick={() => setDatePreset("last_30")} data-testid="button-preset-30d">30 dagar</Button>
                    <Button variant="outline" size="sm" onClick={() => setDatePreset("last_90")} data-testid="button-preset-90d">90 dagar</Button>
                  </div>
                  <Button variant="outline" onClick={() => refetchPreviews()} data-testid="button-refresh-preview">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Sök kund, objekt, beskrivning..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAll}
                  data-testid="button-select-all"
                >
                  {selectedInvoices.size === filteredPreviews.length && filteredPreviews.length > 0 ? "Avmarkera alla" : "Markera alla"}
                </Button>
                <Button
                  onClick={handleExport}
                  disabled={selectedInvoices.size === 0 || exportMutation.isPending}
                  data-testid="button-export-to-fortnox"
                >
                  <Send className="h-4 w-4 mr-1" />
                  Exportera till Fortnox ({selectedInvoices.size})
                </Button>
              </div>
            </div>

            {isLoadingPreviews ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredPreviews.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <h3 className="font-medium text-lg mb-1">Inga fakturor att visa</h3>
                  <p className="text-muted-foreground text-sm">
                    Justera datumintervall eller kundfilter. Endast slutförda ordrar och manuella rader visas.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredPreviews.map((invoice) => {
                  const isExpanded = expandedInvoices.has(invoice.customerId);
                  const isSelected = selectedInvoices.has(invoice.customerId);
                  return (
                    <Card
                      key={invoice.customerId}
                      className={`transition-colors ${isSelected ? "ring-2 ring-primary/50 bg-primary/5" : ""}`}
                      data-testid={`card-invoice-${invoice.customerId}`}
                    >
                      <CardContent className="p-0">
                        <div className="flex items-center gap-3 p-4">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleInvoice(invoice.customerId)}
                            data-testid={`checkbox-invoice-${invoice.customerId}`}
                          />
                          <button
                            onClick={() => toggleExpand(invoice.customerId)}
                            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            data-testid={`button-expand-${invoice.customerId}`}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium truncate" data-testid={`text-customer-name-${invoice.customerId}`}>
                                {invoice.customerName}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {INVOICE_TYPE_LABELS[invoice.invoiceType] || invoice.invoiceType}
                              </Badge>
                              {invoice.lines.some(l => l.workOrderId.startsWith("manual:")) && (
                                <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">
                                  Manuella rader
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {invoice.summary.orderCount} ordrar · {invoice.lines.length} rader
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-lg" data-testid={`text-invoice-total-${invoice.customerId}`}>
                              {formatCurrency(invoice.summary.totalExVat)}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              inkl. moms: {formatCurrency(invoice.summary.totalInclVat)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPreviewDialogInvoice(invoice)}
                            data-testid={`button-preview-${invoice.customerId}`}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>

                        {isExpanded && (
                          <>
                            <Separator />
                            <div className="p-4 bg-muted/30">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Beskrivning</TableHead>
                                    <TableHead>Objekt</TableHead>
                                    <TableHead className="text-right">Antal</TableHead>
                                    <TableHead className="text-right">À-pris</TableHead>
                                    <TableHead className="text-right">Belopp</TableHead>
                                    <TableHead>Datum</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {invoice.lines.map((line, idx) => (
                                    <TableRow key={idx} data-testid={`row-invoice-line-${idx}`} className={line.workOrderId.startsWith("manual:") ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}>
                                      <TableCell className="font-medium">
                                        {line.description}
                                        {line.workOrderId.startsWith("manual:") && (
                                          <Badge variant="outline" className="ml-2 text-xs border-blue-300 text-blue-600">Manuell</Badge>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        {line.objectName || "-"}
                                        {line.objectAddress && (
                                          <span className="block text-xs">{line.objectAddress}</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">{line.quantity}</TableCell>
                                      <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                                      <TableCell className="text-right font-medium">{formatCurrency(line.total)}</TableCell>
                                      <TableCell className="text-sm text-muted-foreground">
                                        {line.completedAt ? format(new Date(line.completedAt), "d MMM", { locale: sv }) : "-"}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                  <TableRow className="border-t-2">
                                    <TableCell colSpan={4} className="text-right font-medium">Summa ex. moms:</TableCell>
                                    <TableCell className="text-right font-bold">{formatCurrency(invoice.summary.totalExVat)}</TableCell>
                                    <TableCell />
                                  </TableRow>
                                  <TableRow>
                                    <TableCell colSpan={4} className="text-right text-muted-foreground">Moms 25%:</TableCell>
                                    <TableCell className="text-right text-muted-foreground">{formatCurrency(invoice.summary.vat)}</TableCell>
                                    <TableCell />
                                  </TableRow>
                                  <TableRow>
                                    <TableCell colSpan={4} className="text-right font-bold">Att betala:</TableCell>
                                    <TableCell className="text-right font-bold text-lg">{formatCurrency(invoice.summary.totalInclVat)}</TableCell>
                                    <TableCell />
                                  </TableRow>
                                </TableBody>
                              </Table>
                              {Object.keys(invoice.headerMetadata).length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {Object.entries(invoice.headerMetadata).map(([key, val]) => (
                                    <Badge key={key} variant="outline" className="text-xs">
                                      {key}: {val}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {selectedInvoices.size > 0 && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border shadow-lg rounded-lg px-6 py-3 flex items-center gap-4" data-testid="bar-export-summary">
                <span className="text-sm font-medium">
                  {selectedInvoices.size} fakturor valda
                </span>
                <Separator orientation="vertical" className="h-6" />
                <span className="font-bold">{formatCurrency(selectedTotal)}</span>
                <Button onClick={handleExport} disabled={exportMutation.isPending} data-testid="button-export-bottom">
                  {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Exportera till Fortnox
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="manual">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Manuella fakturarader</h2>
                <p className="text-sm text-muted-foreground">Skapa fristående fakturarader utan koppling till arbetsordrar</p>
              </div>
              <Button onClick={() => setManualLineDialogOpen(true)} data-testid="button-add-manual-line">
                <Plus className="h-4 w-4 mr-1" /> Ny manuell rad
              </Button>
            </div>

            {draftManualLines.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <h3 className="font-medium text-lg mb-1">Inga manuella rader</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Skapa manuella fakturarader som inkluderas i fakturaförhandsgranskningen.
                  </p>
                  <Button onClick={() => setManualLineDialogOpen(true)} data-testid="button-add-manual-line-empty">
                    <Plus className="h-4 w-4 mr-1" /> Skapa första raden
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kund</TableHead>
                        <TableHead>Beskrivning</TableHead>
                        <TableHead className="text-right">Antal</TableHead>
                        <TableHead className="text-right">À-pris</TableHead>
                        <TableHead className="text-right">Belopp</TableHead>
                        <TableHead>Kostnadsställe</TableHead>
                        <TableHead>Skapad</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draftManualLines.map(ml => {
                        const customer = customers.find(c => c.id === ml.customerId);
                        return (
                          <TableRow key={ml.id} data-testid={`row-manual-line-${ml.id}`} className={ml.status === "queued" ? "opacity-60" : ""}>
                            <TableCell className="font-medium" data-testid={`text-manual-customer-${ml.id}`}>
                              {customer?.name || ml.customerId.slice(0, 8) + "..."}
                            </TableCell>
                            <TableCell data-testid={`text-manual-desc-${ml.id}`}>
                              {ml.description}
                              {ml.status === "queued" && (
                                <Badge variant="outline" className="ml-2 text-xs border-yellow-300 text-yellow-600">Köad för export</Badge>
                              )}
                              {ml.notes && <span className="block text-xs text-muted-foreground">{ml.notes}</span>}
                            </TableCell>
                            <TableCell className="text-right">{ml.quantity}</TableCell>
                            <TableCell className="text-right">{formatCurrency(ml.unitPrice)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(ml.quantity * ml.unitPrice)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{ml.costCenter || "-"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(ml.createdAt), "d MMM HH:mm", { locale: sv })}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteManualLineMutation.mutate(ml.id)}
                                disabled={deleteManualLineMutation.isPending}
                                data-testid={`button-delete-manual-${ml.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="exports">
            <div className="flex items-center gap-3 mb-4">
              <Select value={exportStatusFilter} onValueChange={setExportStatusFilter}>
                <SelectTrigger className="w-[200px]" data-testid="select-export-status-filter">
                  <SelectValue placeholder="Alla statusar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla statusar</SelectItem>
                  <SelectItem value="pending">Väntar</SelectItem>
                  <SelectItem value="exported">Exporterade</SelectItem>
                  <SelectItem value="failed">Misslyckade</SelectItem>
                  <SelectItem value="credited">Krediterade</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetchExports()} data-testid="button-refresh-exports">
                <RefreshCw className="h-4 w-4 mr-1" /> Uppdatera
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Card data-testid="card-export-stat-pending">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                    <Clock className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{exportStats.pending}</div>
                    <p className="text-sm text-muted-foreground">Väntar på export</p>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-export-stat-exported">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{exportStats.exported}</div>
                    <p className="text-sm text-muted-foreground">Exporterade till Fortnox</p>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-export-stat-credited">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <CreditCard className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{exportStats.credited}</div>
                    <p className="text-sm text-muted-foreground">Krediterade</p>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-export-stat-failed">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                    <XCircle className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{exportStats.failed}</div>
                    <p className="text-sm text-muted-foreground">Misslyckade</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {isLoadingExports ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredExports.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Send className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <h3 className="font-medium">Ingen exporthistorik</h3>
                  <p className="text-sm text-muted-foreground">Exportera fakturor från förhandsgranskningen</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ScrollArea className="max-h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order-ID</TableHead>
                        <TableHead>Typ</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fortnox-nr</TableHead>
                        <TableHead className="text-right">Belopp</TableHead>
                        <TableHead>Kostnadsställe</TableHead>
                        <TableHead>Projekt</TableHead>
                        <TableHead>Skapad</TableHead>
                        <TableHead>Exporterad</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExports.map(exp => (
                        <TableRow key={exp.id} data-testid={`row-export-${exp.id}`} className={exp.isCreditInvoice ? "bg-purple-50/50 dark:bg-purple-900/10" : ""}>
                          <TableCell className="font-mono text-sm" data-testid={`text-export-order-${exp.id}`}>
                            {exp.sourceType === "manual" ? "Manuell" : exp.sourceType === "credit" ? "Kredit" : exp.workOrderId ? exp.workOrderId.slice(0, 8) + "..." : "-"}
                          </TableCell>
                          <TableCell>
                            {exp.isCreditInvoice ? (
                              <Badge variant="outline" className="border-purple-300 text-purple-600 gap-1">
                                <Undo2 className="h-3 w-3" /> Kredit
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Faktura</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <ExportStatusBadge status={exp.status} />
                          </TableCell>
                          <TableCell data-testid={`text-fortnox-number-${exp.id}`}>
                            {exp.fortnoxInvoiceNumber ? (
                              <span className="font-medium">{exp.fortnoxInvoiceNumber}</span>
                            ) : "-"}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${(exp.totalAmount || 0) < 0 ? "text-red-600" : ""}`}>
                            {exp.totalAmount != null ? formatCurrency(exp.totalAmount) : "-"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{exp.costCenter || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{exp.project || "-"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(exp.createdAt), "d MMM HH:mm", { locale: sv })}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {exp.exportedAt ? format(new Date(exp.exportedAt), "d MMM HH:mm", { locale: sv }) : "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {exp.status === "pending" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => processExportMutation.mutate(exp.id)}
                                  disabled={processExportMutation.isPending || !fortnoxStatus?.connected}
                                  data-testid={`button-process-export-${exp.id}`}
                                >
                                  <Send className="h-3 w-3 mr-1" /> Skicka
                                </Button>
                              )}
                              {exp.status === "exported" && exp.fortnoxInvoiceNumber && !exp.isCreditInvoice && !exp.creditedByExportId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setCreditDialogExport(exp)}
                                  className="text-purple-600 border-purple-300 hover:bg-purple-50"
                                  data-testid={`button-credit-${exp.id}`}
                                >
                                  <Undo2 className="h-3 w-3 mr-1" /> Kreditera
                                </Button>
                              )}
                              {exp.creditedByExportId && exp.status === "credited" && (
                                <Badge variant="outline" className="text-xs border-purple-300 text-purple-600">
                                  Krediterad
                                </Badge>
                              )}
                              {exp.creditedByExportId && exp.status !== "credited" && (
                                <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-600">
                                  Kredit väntar
                                </Badge>
                              )}
                              {exp.status === "failed" && exp.errorMessage && (
                                <span className="text-xs text-destructive" data-testid={`text-export-error-${exp.id}`}>
                                  {exp.errorMessage}
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent data-testid="dialog-export-confirm">
          <DialogHeader>
            <DialogTitle>Exportera fakturor till Fortnox</DialogTitle>
            <DialogDescription>
              {selectedInvoiceData.length} fakturor kommer att exporteras med totalt belopp {formatCurrency(selectedTotal)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[300px] overflow-auto">
            {selectedInvoiceData.map(inv => (
              <div key={inv.customerId} className="flex items-center justify-between p-2 border rounded-md">
                <div>
                  <span className="font-medium" data-testid={`text-export-customer-${inv.customerId}`}>{inv.customerName}</span>
                  <span className="text-sm text-muted-foreground ml-2">{inv.summary.orderCount} ordrar</span>
                </div>
                <span className="font-bold">{formatCurrency(inv.summary.totalInclVat)}</span>
              </div>
            ))}
          </div>
          {!fortnoxStatus?.connected && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
              <span>Fortnox är inte ansluten. Fakturorna sparas som väntande och kan skickas senare.</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} data-testid="button-cancel-export">Avbryt</Button>
            <Button onClick={confirmExport} disabled={exportMutation.isPending} data-testid="button-confirm-export">
              {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Bekräfta export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewDialogInvoice} onOpenChange={() => setPreviewDialogInvoice(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-invoice-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Fakturaförhandsgranskning
            </DialogTitle>
            <DialogDescription>
              {previewDialogInvoice?.customerName}
            </DialogDescription>
          </DialogHeader>
          {previewDialogInvoice && (
            <div className="space-y-4">
              <div className="border rounded-lg p-4 bg-muted/30">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Kund:</span>
                    <span className="ml-2 font-medium">{previewDialogInvoice.customerName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Typ:</span>
                    <span className="ml-2">{INVOICE_TYPE_LABELS[previewDialogInvoice.invoiceType]}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Period:</span>
                    <span className="ml-2">{fromDate} — {toDate}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Antal ordrar:</span>
                    <span className="ml-2 font-medium">{previewDialogInvoice.summary.orderCount}</span>
                  </div>
                </div>
                {Object.keys(previewDialogInvoice.headerMetadata).length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    {Object.entries(previewDialogInvoice.headerMetadata).map(([k, v]) => (
                      <div key={k} className="text-sm">
                        <span className="text-muted-foreground">{k}:</span>
                        <span className="ml-2">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rad</TableHead>
                    <TableHead>Beskrivning</TableHead>
                    <TableHead className="text-right">Antal</TableHead>
                    <TableHead className="text-right">À-pris</TableHead>
                    <TableHead className="text-right">Belopp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewDialogInvoice.lines.map((line, idx) => (
                    <TableRow key={idx} className={line.workOrderId.startsWith("manual:") ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <span className="font-medium">{line.description}</span>
                        {line.workOrderId.startsWith("manual:") && (
                          <Badge variant="outline" className="ml-2 text-xs border-blue-300 text-blue-600">Manuell</Badge>
                        )}
                        {line.objectAddress && <span className="block text-xs text-muted-foreground">{line.objectAddress}</span>}
                      </TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(line.unitPrice)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(line.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="border-t pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Summa ex. moms:</span>
                  <span className="font-medium">{formatCurrency(previewDialogInvoice.summary.totalExVat)}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Moms 25%:</span>
                  <span>{formatCurrency(previewDialogInvoice.summary.vat)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-bold text-lg">
                  <span>Att betala:</span>
                  <span data-testid="text-preview-total">{formatCurrency(previewDialogInvoice.summary.totalInclVat)}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialogInvoice(null)} data-testid="button-close-preview">Stäng</Button>
            <Button
              onClick={() => {
                if (previewDialogInvoice) {
                  setSelectedInvoices(new Set([previewDialogInvoice.customerId]));
                  setPreviewDialogInvoice(null);
                  handleExport();
                }
              }}
              data-testid="button-export-from-preview"
            >
              <Send className="h-4 w-4 mr-1" /> Exportera denna
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualLineDialogOpen} onOpenChange={setManualLineDialogOpen}>
        <DialogContent data-testid="dialog-manual-line">
          <DialogHeader>
            <DialogTitle>Ny manuell fakturarad</DialogTitle>
            <DialogDescription>
              Skapa en fristående fakturarad utan koppling till en specifik arbetsorder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Kund *</Label>
              <Select value={manualLineForm.customerId} onValueChange={v => setManualLineForm(f => ({ ...f, customerId: v }))}>
                <SelectTrigger data-testid="select-manual-customer">
                  <SelectValue placeholder="Välj kund" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Artikel</Label>
              <Select
                value={manualLineForm.articleId || "none"}
                onValueChange={v => {
                  const artId = v === "none" ? "" : v;
                  setManualLineForm(f => {
                    const art = articles.find(a => a.id === artId);
                    return {
                      ...f,
                      articleId: artId,
                      description: art?.name && !f.description ? art.name : f.description,
                      unitPrice: art?.listPrice && !f.unitPrice ? art.listPrice : f.unitPrice,
                    };
                  });
                }}
              >
                <SelectTrigger data-testid="select-manual-article">
                  <SelectValue placeholder="Välj artikel (valfritt)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen artikel</SelectItem>
                  {articles.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}{a.listPrice ? ` (${formatCurrency(a.listPrice)})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Beskrivning *</Label>
              <Input
                value={manualLineForm.description}
                onChange={e => setManualLineForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Beskrivning av tjänst/vara"
                data-testid="input-manual-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Antal</Label>
                <Input
                  type="number"
                  min={1}
                  value={manualLineForm.quantity}
                  onChange={e => setManualLineForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                  data-testid="input-manual-quantity"
                />
              </div>
              <div>
                <Label>À-pris (SEK)</Label>
                <Input
                  type="number"
                  min={0}
                  value={manualLineForm.unitPrice}
                  onChange={e => setManualLineForm(f => ({ ...f, unitPrice: parseFloat(e.target.value) || 0 }))}
                  data-testid="input-manual-unit-price"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Kostnadsställe</Label>
                <Input
                  value={manualLineForm.costCenter}
                  onChange={e => setManualLineForm(f => ({ ...f, costCenter: e.target.value }))}
                  placeholder="T.ex. 100"
                  data-testid="input-manual-cost-center"
                />
              </div>
              <div>
                <Label>Projekt</Label>
                <Input
                  value={manualLineForm.project}
                  onChange={e => setManualLineForm(f => ({ ...f, project: e.target.value }))}
                  placeholder="T.ex. P001"
                  data-testid="input-manual-project"
                />
              </div>
            </div>
            <div>
              <Label>Anteckningar</Label>
              <Textarea
                value={manualLineForm.notes}
                onChange={e => setManualLineForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Valfria anteckningar"
                rows={2}
                data-testid="input-manual-notes"
              />
            </div>
            {manualLineForm.quantity > 0 && manualLineForm.unitPrice > 0 && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <div className="flex justify-between">
                  <span>Belopp ex. moms:</span>
                  <span className="font-medium">{formatCurrency(manualLineForm.quantity * manualLineForm.unitPrice)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Moms 25%:</span>
                  <span>{formatCurrency(manualLineForm.quantity * manualLineForm.unitPrice * 0.25)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-bold">
                  <span>Totalt inkl. moms:</span>
                  <span>{formatCurrency(manualLineForm.quantity * manualLineForm.unitPrice * 1.25)}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualLineDialogOpen(false)} data-testid="button-cancel-manual">Avbryt</Button>
            <Button
              onClick={() => createManualLineMutation.mutate(manualLineForm)}
              disabled={!manualLineForm.customerId || !manualLineForm.description || createManualLineMutation.isPending}
              data-testid="button-save-manual"
            >
              {createManualLineMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Skapa rad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!creditDialogExport} onOpenChange={() => setCreditDialogExport(null)}>
        <DialogContent data-testid="dialog-credit-confirm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-purple-600" />
              Skapa kreditfaktura
            </DialogTitle>
            <DialogDescription>
              En kreditfaktura skapas med negerat belopp och referens till originalfakturan.
            </DialogDescription>
          </DialogHeader>
          {creditDialogExport && (
            <div className="space-y-3">
              <div className="p-4 border rounded-lg bg-muted/30 space-y-2">
                {creditDialogExport.workOrderId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Order-ID:</span>
                    <span className="font-mono">{creditDialogExport.workOrderId.slice(0, 8)}...</span>
                  </div>
                )}
                {creditDialogExport.sourceType && creditDialogExport.sourceType !== "work_order" && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Typ:</span>
                    <span>{creditDialogExport.sourceType === "manual" ? "Manuell rad" : "Arbetsorder"}</span>
                  </div>
                )}
                {creditDialogExport.fortnoxInvoiceNumber && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fortnox-fakturanr:</span>
                    <span className="font-medium">{creditDialogExport.fortnoxInvoiceNumber}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Originalbelopp:</span>
                  <span className="font-medium">{creditDialogExport.totalAmount != null ? formatCurrency(creditDialogExport.totalAmount) : "-"}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm font-bold text-red-600">
                  <span>Kreditbelopp:</span>
                  <span>{creditDialogExport.totalAmount != null ? formatCurrency(-creditDialogExport.totalAmount) : "-"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-md text-sm">
                <AlertTriangle className="h-4 w-4 text-purple-600 shrink-0" />
                <span>Originalfakturan markeras som krediterad. Kreditfakturan skapas med status "Väntar" och kan skickas till Fortnox.</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditDialogExport(null)} data-testid="button-cancel-credit">Avbryt</Button>
            <Button
              onClick={() => creditDialogExport && creditInvoiceMutation.mutate(creditDialogExport.id)}
              disabled={creditInvoiceMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700"
              data-testid="button-confirm-credit"
            >
              {creditInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Undo2 className="h-4 w-4 mr-1" />}
              Skapa kreditfaktura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
