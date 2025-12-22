import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { WorkOrder, SimulationScenario, Customer, Article, WorkOrderLine } from "@shared/schema";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { 
  Package, 
  Filter, 
  ChevronRight, 
  Calendar, 
  CircleDollarSign, 
  Clock, 
  TestTube2,
  ListChecks,
  ArrowRight,
  PlayCircle,
  AlertCircle,
  CheckCircle,
  FileCheck,
  Plus,
  Trash2,
  FileText,
  Loader2
} from "lucide-react";

type OrderStatus = 'skapad' | 'planerad_pre' | 'planerad_resurs' | 'planerad_las' | 'utford' | 'fakturerad';

const STATUS_LABELS: Record<OrderStatus, string> = {
  skapad: "Skapad",
  planerad_pre: "Preliminärt planerad",
  planerad_resurs: "Resurs tilldelad",
  planerad_las: "Låst",
  utford: "Utförd",
  fakturerad: "Fakturerad"
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  skapad: "bg-muted text-muted-foreground",
  planerad_pre: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  planerad_resurs: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  planerad_las: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  utford: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  fakturerad: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
};

const STATUS_ICONS: Record<OrderStatus, typeof ListChecks> = {
  skapad: AlertCircle,
  planerad_pre: Calendar,
  planerad_resurs: Clock,
  planerad_las: FileCheck,
  utford: CheckCircle,
  fakturerad: CircleDollarSign
};

interface OrderStockResponse {
  orders: WorkOrder[];
  summary: {
    totalOrders: number;
    totalValue: number;
    totalCost: number;
    totalProductionMinutes: number;
    byStatus: Record<string, number>;
  };
}

const ORDERS_PER_PAGE = 50;

export default function OrderStockPage() {
  const { toast } = useToast();
  const [includeSimulated, setIncludeSimulated] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showLinesDialog, setShowLinesDialog] = useState(false);
  const [selectedOrderForLines, setSelectedOrderForLines] = useState<WorkOrder | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [lineQuantity, setLineQuantity] = useState(1);

  const { data: orderStockData, isLoading: ordersLoading } = useQuery<OrderStockResponse>({
    queryKey: ["/api/order-stock", { includeSimulated, scenarioId: selectedScenario, orderStatus: statusFilter === "all" ? undefined : statusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeSimulated) params.set("includeSimulated", "true");
      if (selectedScenario) params.set("scenarioId", selectedScenario);
      if (statusFilter !== "all") params.set("orderStatus", statusFilter);
      const response = await fetch(`/api/order-stock?${params.toString()}`);
      return response.json();
    }
  });

  const { data: scenarios = [] } = useQuery<SimulationScenario[]>({
    queryKey: ["/api/simulation-scenarios"]
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"]
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"]
  });

  const { data: orderLines = [], isLoading: linesLoading, refetch: refetchLines } = useQuery<WorkOrderLine[]>({
    queryKey: ["/api/work-orders", selectedOrderForLines?.id, "lines"],
    queryFn: async () => {
      if (!selectedOrderForLines?.id) return [];
      const response = await fetch(`/api/work-orders/${selectedOrderForLines.id}/lines`);
      return response.json();
    },
    enabled: !!selectedOrderForLines?.id
  });

  const addLineMutation = useMutation({
    mutationFn: async ({ workOrderId, articleId, quantity }: { workOrderId: string; articleId: string; quantity: number }) => {
      return apiRequest("POST", `/api/work-orders/${workOrderId}/lines`, { articleId, quantity });
    },
    onSuccess: async () => {
      toast({ title: "Artikel tillagd" });
      setSelectedArticleId("");
      setLineQuantity(1);
      await refetchLines();
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
    },
    onError: () => {
      toast({ title: "Kunde inte lägga till artikel", variant: "destructive" });
    }
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (lineId: string) => {
      return apiRequest("DELETE", `/api/work-order-lines/${lineId}`);
    },
    onSuccess: async () => {
      toast({ title: "Artikel borttagen" });
      await refetchLines();
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
    },
    onError: () => {
      toast({ title: "Kunde inte ta bort artikel", variant: "destructive" });
    }
  });

  // Lazy load objects by ID - only fetch objects referenced by orders
  const objectIdsNeeded = useMemo(() => {
    if (!orderStockData?.orders) return [];
    const ids = orderStockData.orders.map(o => o.objectId).filter(Boolean);
    return Array.from(new Set(ids));
  }, [orderStockData?.orders]);

  const { data: objects = [] } = useObjectsByIds(objectIdsNeeded);

  const statusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      return apiRequest("POST", `/api/work-orders/${orderId}/status`, { status });
    },
    onSuccess: () => {
      toast({ title: "Status uppdaterad" });
      setShowStatusDialog(false);
      setSelectedOrder(null);
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera status", variant: "destructive" });
    }
  });

  const promoteMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return apiRequest("POST", `/api/work-orders/${orderId}/promote`);
    },
    onSuccess: () => {
      toast({ title: "Order befordrad till produktionsläge" });
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({ title: "Kunde inte befordra order", variant: "destructive" });
    }
  });

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
  const articleMap = useMemo(() => new Map(articles.map(a => [a.id, a])), [articles]);

  const handleOpenLines = (order: WorkOrder) => {
    setSelectedOrderForLines(order);
    setShowLinesDialog(true);
    setSelectedArticleId("");
    setLineQuantity(1);
  };

  const handleCloseLinesDialog = () => {
    setShowLinesDialog(false);
    setSelectedOrderForLines(null);
    queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
  };

  const handleAddLine = () => {
    if (selectedOrderForLines && selectedArticleId) {
      addLineMutation.mutate({
        workOrderId: selectedOrderForLines.id,
        articleId: selectedArticleId,
        quantity: lineQuantity
      });
    }
  };

  const filteredOrders = useMemo(() => {
    if (!orderStockData?.orders) return [];
    return orderStockData.orders.filter(order => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      const customer = customerMap.get(order.customerId);
      const object = objectMap.get(order.objectId);
      return (
        order.title?.toLowerCase().includes(searchLower) ||
        customer?.name?.toLowerCase().includes(searchLower) ||
        object?.name?.toLowerCase().includes(searchLower)
      );
    });
  }, [orderStockData?.orders, searchTerm, customerMap, objectMap]);

  const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * ORDERS_PER_PAGE;
    return filteredOrders.slice(start, start + ORDERS_PER_PAGE);
  }, [filteredOrders, currentPage]);

  // Reset page when filter changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount == null) return "-";
    return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(amount);
  };

  const formatMinutes = (minutes: number | null | undefined) => {
    if (minutes == null) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;
  };

  const handleStatusChange = (order: WorkOrder) => {
    setSelectedOrder(order);
    setShowStatusDialog(true);
  };

  const getNextStatus = (current: OrderStatus): OrderStatus | null => {
    const flow: OrderStatus[] = ['skapad', 'planerad_pre', 'planerad_resurs', 'planerad_las', 'utford', 'fakturerad'];
    const idx = flow.indexOf(current);
    return idx < flow.length - 1 ? flow[idx + 1] : null;
  };

  if (ordersLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const summary = orderStockData?.summary || { totalOrders: 0, totalValue: 0, totalCost: 0, totalProductionMinutes: 0, byStatus: {} };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Orderstock</h1>
        </div>
        
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <TestTube2 className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="sim-toggle" className="text-sm">Visa simulerade</Label>
            <Switch 
              id="sim-toggle"
              checked={includeSimulated} 
              onCheckedChange={setIncludeSimulated}
              data-testid="switch-include-simulated"
            />
          </div>
          
          {includeSimulated && scenarios.length > 0 && (
            <Select value={selectedScenario || "all"} onValueChange={v => setSelectedScenario(v === "all" ? null : v)}>
              <SelectTrigger className="w-48" data-testid="select-scenario">
                <SelectValue placeholder="Alla scenarier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla scenarier</SelectItem>
                {scenarios.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Totalt antal order</span>
            </div>
            <p className="text-2xl font-bold mt-2" data-testid="text-total-orders">{summary.totalOrders}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Totalt värde</span>
            </div>
            <p className="text-2xl font-bold mt-2" data-testid="text-total-value">{formatCurrency(summary.totalValue)}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total kostnad</span>
            </div>
            <p className="text-2xl font-bold mt-2" data-testid="text-total-cost">{formatCurrency(summary.totalCost)}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total produktionstid</span>
            </div>
            <p className="text-2xl font-bold mt-2" data-testid="text-total-time">{formatMinutes(summary.totalProductionMinutes)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(STATUS_LABELS) as OrderStatus[]).map(status => {
          const count = summary.byStatus[status] || 0;
          const StatusIcon = STATUS_ICONS[status];
          return (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
              className="gap-2"
              data-testid={`button-filter-${status}`}
            >
              <StatusIcon className="h-4 w-4" />
              {STATUS_LABELS[status]}
              <Badge variant="secondary" className="ml-1">{count}</Badge>
            </Button>
          );
        })}
        {statusFilter !== "all" && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter("all")} data-testid="button-clear-filter">
            Rensa filter
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-wrap justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Orderlista
            </CardTitle>
            <Input
              placeholder="Sök order, kund, objekt..."
              value={searchTerm}
              onChange={e => handleSearchChange(e.target.value)}
              className="max-w-sm"
              data-testid="input-search-orders"
            />
          </div>
        </CardHeader>
        <Separator />
        <ScrollArea className="h-[500px]">
          <div className="divide-y">
            {paginatedOrders.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Inga order hittades
              </div>
            ) : (
              paginatedOrders.map(order => {
                const customer = customerMap.get(order.customerId);
                const object = objectMap.get(order.objectId);
                const status = (order.orderStatus || 'skapad') as OrderStatus;
                const StatusIcon = STATUS_ICONS[status];
                const nextStatus = getNextStatus(status);

                return (
                  <div 
                    key={order.id} 
                    className="p-4 flex items-center gap-4 hover-elevate"
                    data-testid={`row-order-${order.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{order.title}</span>
                        {order.isSimulated && (
                          <Badge variant="outline" className="text-xs gap-1">
                            <TestTube2 className="h-3 w-3" />
                            Simulerad
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap mt-1">
                        <span>{customer?.name || "-"}</span>
                        <ChevronRight className="h-3 w-3" />
                        <span>{object?.name || "-"}</span>
                      </div>
                    </div>

                    <div className="text-right text-sm">
                      <div>{formatCurrency(order.cachedValue)}</div>
                      <div className="text-muted-foreground">{formatMinutes(order.cachedProductionMinutes)}</div>
                    </div>

                    <Badge className={`${STATUS_COLORS[status]} gap-1 shrink-0`}>
                      <StatusIcon className="h-3 w-3" />
                      {STATUS_LABELS[status]}
                    </Badge>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenLines(order)}
                        className="gap-1"
                        data-testid={`button-view-lines-${order.id}`}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      
                      {nextStatus && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStatusChange(order)}
                          className="gap-1"
                          data-testid={`button-change-status-${order.id}`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      )}
                      
                      {order.isSimulated && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => promoteMutation.mutate(order.id)}
                          disabled={promoteMutation.isPending}
                          className="gap-1"
                          data-testid={`button-promote-${order.id}`}
                        >
                          <PlayCircle className="h-4 w-4" />
                          Aktivera
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 p-4 border-t">
            <span className="text-sm text-muted-foreground">
              Visar {((currentPage - 1) * ORDERS_PER_PAGE) + 1}-{Math.min(currentPage * ORDERS_PER_PAGE, filteredOrders.length)} av {filteredOrders.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                data-testid="button-prev-page"
              >
                Föregående
              </Button>
              <span className="text-sm px-2">
                Sida {currentPage} av {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                Nästa
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ändra orderstatus</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Vill du ändra status för "{selectedOrder.title}" till nästa steg?
              </p>
              <div className="flex items-center gap-2 justify-center">
                <Badge className={STATUS_COLORS[(selectedOrder.orderStatus || 'skapad') as OrderStatus]}>
                  {STATUS_LABELS[(selectedOrder.orderStatus || 'skapad') as OrderStatus]}
                </Badge>
                <ArrowRight className="h-4 w-4" />
                <Badge className={STATUS_COLORS[getNextStatus((selectedOrder.orderStatus || 'skapad') as OrderStatus) || 'skapad']}>
                  {STATUS_LABELS[getNextStatus((selectedOrder.orderStatus || 'skapad') as OrderStatus) || 'skapad']}
                </Badge>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusDialog(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => {
                if (selectedOrder) {
                  const nextStatus = getNextStatus((selectedOrder.orderStatus || 'skapad') as OrderStatus);
                  if (nextStatus) {
                    statusMutation.mutate({ orderId: selectedOrder.id, status: nextStatus });
                  }
                }
              }}
              disabled={statusMutation.isPending}
              data-testid="button-confirm-status-change"
            >
              {statusMutation.isPending ? 'Sparar...' : 'Bekräfta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLinesDialog} onOpenChange={(open) => !open && handleCloseLinesDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Orderrader
            </DialogTitle>
            <DialogDescription>
              {selectedOrderForLines?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-end gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="article-select">Artikel</Label>
                <Select value={selectedArticleId} onValueChange={setSelectedArticleId}>
                  <SelectTrigger id="article-select" data-testid="select-article">
                    <SelectValue placeholder="Välj artikel..." />
                  </SelectTrigger>
                  <SelectContent>
                    {articles.map(article => (
                      <SelectItem key={article.id} value={article.id}>
                        {article.articleNumber} - {article.name} ({formatCurrency(article.listPrice)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-24">
                <Label htmlFor="quantity-input">Antal</Label>
                <Input
                  id="quantity-input"
                  type="number"
                  min={1}
                  value={lineQuantity}
                  onChange={e => setLineQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  data-testid="input-quantity"
                />
              </div>
              <Button
                onClick={handleAddLine}
                disabled={!selectedArticleId || addLineMutation.isPending}
                className="gap-1"
                data-testid="button-add-line"
              >
                {addLineMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Lägg till
              </Button>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Orderrader</Label>
              {linesLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : orderLines.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Inga orderrader tillagda ännu
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {orderLines.map(line => {
                    const article = articleMap.get(line.articleId);
                    return (
                      <div 
                        key={line.id} 
                        className="p-3 flex items-center gap-4"
                        data-testid={`row-line-${line.id}`}
                      >
                        <div className="flex-1">
                          <div className="font-medium">
                            {article?.name || "Okänd artikel"}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {article?.articleNumber} | Antal: {line.quantity}
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <div>{formatCurrency(line.resolvedPrice)}</div>
                          <div className="text-muted-foreground">
                            {line.resolvedProductionMinutes}min
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {line.priceSource}
                        </Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteLineMutation.mutate(line.id)}
                          disabled={deleteLineMutation.isPending}
                          data-testid={`button-delete-line-${line.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {orderLines.length > 0 && (
              <div className="flex justify-end gap-6 pt-2 border-t">
                <div className="text-sm">
                  <span className="text-muted-foreground">Totalt värde: </span>
                  <span className="font-medium">
                    {formatCurrency(orderLines.reduce((sum, l) => sum + (l.resolvedPrice || 0) * l.quantity, 0))}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Total tid: </span>
                  <span className="font-medium">
                    {formatMinutes(orderLines.reduce((sum, l) => sum + (l.resolvedProductionMinutes || 0) * l.quantity, 0))}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseLinesDialog}>
              Stäng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
