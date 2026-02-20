import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { WorkOrder, SimulationScenario, Customer, Article, WorkOrderLine, Team, Resource, MetadataKatalog } from "@shared/schema";
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
  Loader2,
  Download,
  Users,
  UserCheck,
  Lock,
  Unlock,
  XCircle,
  Camera,
  User,
  Database,
  X
} from "lucide-react";
import { AICard } from "@/components/AICard";
import { ExecutionStatusTracker } from "@/components/ExecutionStatusTracker";
import { TaskTimewindowsEditor } from "@/components/TaskTimewindowsEditor";
import { TaskDependenciesView } from "@/components/TaskDependenciesView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { IMPOSSIBLE_REASON_LABELS } from "@shared/schema";

type OrderStatus = 'skapad' | 'planerad_pre' | 'planerad_resurs' | 'planerad_las' | 'utford' | 'fakturerad' | 'omojlig';

const STATUS_LABELS: Record<OrderStatus, string> = {
  skapad: "Skapad",
  planerad_pre: "Preliminärt planerad",
  planerad_resurs: "Resurs tilldelad",
  planerad_las: "Låst",
  utford: "Utförd",
  fakturerad: "Fakturerad",
  omojlig: "Omöjlig"
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  skapad: "bg-muted text-muted-foreground",
  planerad_pre: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  planerad_resurs: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  planerad_las: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  utford: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  fakturerad: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  omojlig: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
};

const STATUS_ICONS: Record<OrderStatus, typeof ListChecks> = {
  skapad: AlertCircle,
  planerad_pre: Calendar,
  planerad_resurs: Clock,
  planerad_las: FileCheck,
  utford: CheckCircle,
  fakturerad: CircleDollarSign,
  omojlig: XCircle
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
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

const ORDERS_PER_PAGE = 50;

const planningFormSchema = z.object({
  teamId: z.string().optional(),
  resourceId: z.string().optional(),
  scheduledDate: z.string().optional(),
});

type PlanningFormData = z.infer<typeof planningFormSchema>;

export default function OrderStockPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [includeSimulated, setIncludeSimulated] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  
  // Debounce search term (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);
  const [metadataFilters, setMetadataFilters] = useState<{ metadataName: string; operator: string; value: string }[]>([]);
  const [showMetadataFilter, setShowMetadataFilter] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");
  const [newFilterOp, setNewFilterOp] = useState("eq");
  const [newFilterValue, setNewFilterValue] = useState("");
  
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showLinesDialog, setShowLinesDialog] = useState(false);
  const [selectedOrderForLines, setSelectedOrderForLines] = useState<WorkOrder | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [lineQuantity, setLineQuantity] = useState(1);

  const metadataFilterString = useMemo(() => {
    if (metadataFilters.length === 0) return "";
    return metadataFilters.map(f => `${f.metadataName}:${f.operator}:${f.value}`).join(",");
  }, [metadataFilters]);
  
  const { data: orderStockData, isLoading: ordersLoading } = useQuery<OrderStockResponse>({
    queryKey: ["/api/order-stock", { includeSimulated, scenarioId: selectedScenario, orderStatus: statusFilter === "all" ? undefined : statusFilter, page: currentPage, search: debouncedSearch, metadataFilter: metadataFilterString }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeSimulated) params.set("includeSimulated", "true");
      if (selectedScenario) params.set("scenarioId", selectedScenario);
      if (statusFilter !== "all") params.set("orderStatus", statusFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (metadataFilterString) params.set("metadataFilter", metadataFilterString);
      params.set("page", currentPage.toString());
      params.set("pageSize", ORDERS_PER_PAGE.toString());
      const response = await fetch(`/api/order-stock?${params.toString()}`);
      return response.json();
    }
  });
  
  const { data: metadataTypes = [] } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata/types"],
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

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"]
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"]
  });

  const [showPlanningDialog, setShowPlanningDialog] = useState(false);
  const [planningOrder, setPlanningOrder] = useState<WorkOrder | null>(null);

  const planningForm = useForm<PlanningFormData>({
    resolver: zodResolver(planningFormSchema),
    defaultValues: {
      teamId: "",
      resourceId: "",
      scheduledDate: "",
    },
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

  const currentQueryKey = ["/api/order-stock", { includeSimulated, scenarioId: selectedScenario, orderStatus: statusFilter === "all" ? undefined : statusFilter, page: currentPage, search: debouncedSearch, metadataFilter: metadataFilterString }];
  
  const OPERATOR_LABELS: Record<string, string> = {
    eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "innehaller",
  };
  
  const addMetadataFilter = () => {
    if (!newFilterName || !newFilterValue) return;
    setMetadataFilters(prev => [...prev, { metadataName: newFilterName, operator: newFilterOp, value: newFilterValue }]);
    setNewFilterName("");
    setNewFilterOp("eq");
    setNewFilterValue("");
    setShowMetadataFilter(false);
    setCurrentPage(1);
  };
  
  const removeMetadataFilter = (index: number) => {
    setMetadataFilters(prev => prev.filter((_, i) => i !== index));
    setCurrentPage(1);
  };
  
  const updateOrderInCache = async (workOrderId: string) => {
    const response = await fetch(`/api/work-orders/${workOrderId}`);
    if (!response.ok) return;
    const updatedOrder: WorkOrder = await response.json();
    
    queryClient.setQueryData<OrderStockResponse>(currentQueryKey, (oldData) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        orders: oldData.orders.map(o => o.id === workOrderId ? updatedOrder : o)
      };
    });
  };

  const addLineMutation = useMutation({
    mutationFn: async ({ workOrderId, articleId, quantity }: { workOrderId: string; articleId: string; quantity: number }) => {
      await apiRequest("POST", `/api/work-orders/${workOrderId}/lines`, { articleId, quantity });
      return workOrderId;
    },
    onSuccess: async (workOrderId) => {
      toast({ title: "Artikel tillagd" });
      setSelectedArticleId("");
      setLineQuantity(1);
      await queryClient.refetchQueries({ queryKey: ["/api/work-orders", workOrderId, "lines"] });
      await updateOrderInCache(workOrderId);
    },
    onError: () => {
      toast({ title: "Kunde inte lägga till artikel", variant: "destructive" });
    }
  });

  const deleteLineMutation = useMutation({
    mutationFn: async ({ lineId, workOrderId }: { lineId: string; workOrderId: string }) => {
      await apiRequest("DELETE", `/api/work-order-lines/${lineId}`);
      return workOrderId;
    },
    onSuccess: async (workOrderId) => {
      toast({ title: "Artikel borttagen" });
      await queryClient.refetchQueries({ queryKey: ["/api/work-orders", workOrderId, "lines"] });
      await updateOrderInCache(workOrderId);
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

  const planningMutation = useMutation({
    mutationFn: async ({ orderId, data }: { orderId: string; data: PlanningFormData }) => {
      const updates: Record<string, any> = {};
      if (data.teamId) updates.teamId = data.teamId;
      if (data.resourceId) updates.resourceId = data.resourceId;
      if (data.scheduledDate) updates.scheduledDate = new Date(data.scheduledDate);
      
      // Determine new status based on what's being assigned
      if (data.resourceId) {
        updates.orderStatus = "planerad_resurs";
      } else if (data.teamId) {
        updates.orderStatus = "planerad_pre";
      }
      
      return apiRequest("PATCH", `/api/work-orders/${orderId}`, updates);
    },
    onSuccess: () => {
      toast({ title: "Planering sparad" });
      setShowPlanningDialog(false);
      setPlanningOrder(null);
      planningForm.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({ title: "Kunde inte spara planering", variant: "destructive" });
    }
  });

  const lockMutation = useMutation({
    mutationFn: async ({ orderId, lock }: { orderId: string; lock: boolean }) => {
      const updates = lock 
        ? { orderStatus: "planerad_las", lockedAt: new Date() }
        : { orderStatus: "planerad_resurs", lockedAt: null };
      return apiRequest("PATCH", `/api/work-orders/${orderId}`, updates);
    },
    onSuccess: (_, { lock }) => {
      toast({ title: lock ? "Order låst" : "Order upplåst" });
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({ title: "Kunde inte ändra låsstatus", variant: "destructive" });
    }
  });

  const openPlanningDialog = (order: WorkOrder) => {
    setPlanningOrder(order);
    planningForm.reset({
      teamId: order.teamId || "",
      resourceId: order.resourceId || "",
      scheduledDate: order.scheduledDate ? new Date(order.scheduledDate).toISOString().split('T')[0] : "",
    });
    setShowPlanningDialog(true);
  };

  const onPlanningSubmit = (data: PlanningFormData) => {
    if (planningOrder) {
      planningMutation.mutate({ orderId: planningOrder.id, data });
    }
  };

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

  // Server-side search - orders already filtered
  const displayOrders = orderStockData?.orders || [];

  // Use server-side pagination info
  const totalPages = orderStockData?.pagination?.totalPages || 1;
  const totalOrders = orderStockData?.pagination?.total || 0;

  // Search input handler (debounce handles page reset)
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  // Export to CSV
  const handleExportCSV = async () => {
    const params = new URLSearchParams();
    if (includeSimulated) params.set("includeSimulated", "true");
    if (selectedScenario) params.set("scenarioId", selectedScenario);
    if (statusFilter !== "all") params.set("orderStatus", statusFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    params.set("page", "1");
    params.set("pageSize", "10000");
    
    try {
      const response = await fetch(`/api/order-stock?${params.toString()}`);
      const data: OrderStockResponse = await response.json();
      
      const headers = ["Titel", "Kund", "Objekt", "Status", "Värde", "Kostnad", "Produktionstid (min)", "Planerat datum"];
      const rows = data.orders.map(order => {
        const customer = customerMap.get(order.customerId);
        const object = objectMap.get(order.objectId);
        return [
          order.title || "",
          customer?.name || "",
          object?.name || "",
          STATUS_LABELS[(order.orderStatus || 'skapad') as OrderStatus],
          order.cachedValue?.toString() || "0",
          order.cachedCost?.toString() || "0",
          order.cachedProductionMinutes?.toString() || "0",
          order.scheduledDate ? new Date(order.scheduledDate).toLocaleDateString("sv-SE") : ""
        ];
      });
      
      const csvContent = [
        headers.join(";"),
        ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(";"))
      ].join("\n");
      
      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orderstock-${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      
      toast({ title: `Exporterade ${data.orders.length} ordrar` });
    } catch (error) {
      toast({ title: "Kunde inte exportera", variant: "destructive" });
    }
  };

  const handleStatusFilterChange = (status: OrderStatus | "all") => {
    setStatusFilter(status);
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
          
          <Button variant="outline" onClick={handleExportCSV} className="gap-2" data-testid="button-export-csv">
            <Download className="h-4 w-4" />
            Exportera CSV
          </Button>
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

      <AICard
        title="AI Orderanalys"
        variant="compact"
        defaultExpanded={false}
        insights={[
          { type: "suggestion", title: "Prioriteringsförslag", description: "AI kan analysera ordrar och föreslå optimal prioritering baserat på deadlines och värde" },
          { type: "optimization", title: "Batchoptimering", description: "Gruppera liknande ordrar för effektivare hantering" },
          { type: "warning", title: "Deadline-varningar", description: "Identifiera ordrar som riskerar att missa sina tidsfönster" },
        ]}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(STATUS_LABELS) as OrderStatus[]).map(status => {
          const count = summary.byStatus[status] || 0;
          const StatusIcon = STATUS_ICONS[status];
          return (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "outline"}
              size="sm"
              onClick={() => handleStatusFilterChange(statusFilter === status ? "all" : status)}
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
          <Button variant="ghost" size="sm" onClick={() => handleStatusFilterChange("all")} data-testid="button-clear-filter">
            Rensa filter
          </Button>
        )}
        
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={metadataFilters.length > 0 ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMetadataFilter(!showMetadataFilter)}
            className="gap-2"
            data-testid="button-metadata-filter-toggle"
          >
            <Database className="h-4 w-4" />
            Metadata-filter
            {metadataFilters.length > 0 && (
              <Badge variant="secondary" className="ml-1">{metadataFilters.length}</Badge>
            )}
          </Button>
        </div>
      </div>

      {showMetadataFilter && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">Metadata-typ</Label>
                <Select value={newFilterName} onValueChange={setNewFilterName}>
                  <SelectTrigger className="w-44" data-testid="select-metadata-type">
                    <SelectValue placeholder="Valj typ..." />
                  </SelectTrigger>
                  <SelectContent>
                    {metadataTypes.map(t => (
                      <SelectItem key={t.id} value={t.namn}>{t.namn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Operator</Label>
                <Select value={newFilterOp} onValueChange={setNewFilterOp}>
                  <SelectTrigger className="w-28" data-testid="select-metadata-operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eq">= Lika med</SelectItem>
                    <SelectItem value="neq">≠ Ej lika</SelectItem>
                    <SelectItem value="gt">&gt; Storre an</SelectItem>
                    <SelectItem value="gte">≥ Storre/lika</SelectItem>
                    <SelectItem value="lt">&lt; Mindre an</SelectItem>
                    <SelectItem value="lte">≤ Mindre/lika</SelectItem>
                    <SelectItem value="contains">Innehaller</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Varde</Label>
                <Input
                  value={newFilterValue}
                  onChange={e => setNewFilterValue(e.target.value)}
                  placeholder="t.ex. 600"
                  className="w-32"
                  onKeyDown={e => e.key === 'Enter' && addMetadataFilter()}
                  data-testid="input-metadata-value"
                />
              </div>
              <Button size="sm" onClick={addMetadataFilter} disabled={!newFilterName || !newFilterValue} data-testid="button-add-metadata-filter">
                <Plus className="h-4 w-4 mr-1" />
                Lagg till
              </Button>
            </div>
            
            {metadataFilters.length > 0 && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="text-xs text-muted-foreground">Aktiva filter:</span>
                {metadataFilters.map((f, i) => (
                  <Badge key={i} variant="secondary" className="gap-1 pr-1" data-testid={`badge-metadata-filter-${i}`}>
                    {f.metadataName} {OPERATOR_LABELS[f.operator] || f.operator} {f.value}
                    <span
                      role="button"
                      className="inline-flex items-center justify-center h-4 w-4 ml-1 rounded-sm cursor-pointer opacity-70 hover:opacity-100"
                      onClick={() => removeMetadataFilter(i)}
                      data-testid={`button-remove-filter-${i}`}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </Badge>
                ))}
                <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => { setMetadataFilters([]); setCurrentPage(1); }} data-testid="button-clear-metadata-filters">
                  Rensa alla
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
            {displayOrders.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Inga order hittades
              </div>
            ) : (
              displayOrders.map(order => {
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
                      {status === "omojlig" && order.impossibleReason && (
                        <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-md text-xs" data-testid={`impossible-details-${order.id}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <XCircle className="h-3 w-3 text-red-500" />
                            <span className="font-medium text-red-700 dark:text-red-300">
                              {IMPOSSIBLE_REASON_LABELS[order.impossibleReason as keyof typeof IMPOSSIBLE_REASON_LABELS] || order.impossibleReason}
                            </span>
                            {order.impossibleAt && (
                              <span className="text-muted-foreground">
                                {new Date(order.impossibleAt).toLocaleDateString("sv-SE")}
                              </span>
                            )}
                            {order.impossibleBy && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <User className="h-3 w-3" />
                                {order.impossibleBy}
                              </span>
                            )}
                            {order.impossiblePhotoUrl && (
                              <Camera className="h-3 w-3 text-muted-foreground" data-testid={`icon-photo-${order.id}`} />
                            )}
                          </div>
                          {order.impossibleReasonText && (
                            <p className="mt-1 text-muted-foreground">{order.impossibleReasonText}</p>
                          )}
                        </div>
                      )}
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
                      
                      {(status === "skapad" || status === "planerad_pre" || status === "planerad_resurs") && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => openPlanningDialog(order)}
                          className="gap-1"
                          data-testid={`button-plan-${order.id}`}
                        >
                          <Users className="h-4 w-4" />
                          Planera
                        </Button>
                      )}
                      
                      {status === "planerad_resurs" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => lockMutation.mutate({ orderId: order.id, lock: true })}
                          className="gap-1"
                          data-testid={`button-lock-${order.id}`}
                        >
                          <Lock className="h-4 w-4" />
                          Lås
                        </Button>
                      )}
                      
                      {status === "planerad_las" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => lockMutation.mutate({ orderId: order.id, lock: false })}
                          className="gap-1"
                          data-testid={`button-unlock-${order.id}`}
                        >
                          <Unlock className="h-4 w-4" />
                          Lås upp
                        </Button>
                      )}
                      
                      {nextStatus && status !== "skapad" && status !== "planerad_pre" && (
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
              Visar {((currentPage - 1) * ORDERS_PER_PAGE) + 1}-{Math.min(currentPage * ORDERS_PER_PAGE, totalOrders)} av {totalOrders}
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

      <Dialog open={showPlanningDialog} onOpenChange={setShowPlanningDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Planera order</DialogTitle>
            <DialogDescription>
              Tilldela team, resurs och datum för denna order
            </DialogDescription>
          </DialogHeader>
          {planningOrder && (
            <Form {...planningForm}>
              <form onSubmit={planningForm.handleSubmit(onPlanningSubmit)} className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Order: {planningOrder.title}
                </div>
                
                <FormField
                  control={planningForm.control}
                  name="scheduledDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Datum</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          data-testid="input-planning-date"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={planningForm.control}
                  name="teamId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team (förplanering)</FormLabel>
                      <Select value={field.value || "none"} onValueChange={(val) => field.onChange(val === "none" ? "" : val)}>
                        <FormControl>
                          <SelectTrigger data-testid="select-planning-team">
                            <SelectValue placeholder="Välj team" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Inget team</SelectItem>
                          {teams.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={planningForm.control}
                  name="resourceId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Resurs (detaljplanering)</FormLabel>
                      <Select value={field.value || "none"} onValueChange={(val) => field.onChange(val === "none" ? "" : val)}>
                        <FormControl>
                          <SelectTrigger data-testid="select-planning-resource">
                            <SelectValue placeholder="Välj resurs" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">Ingen resurs</SelectItem>
                          {resources.map((resource) => (
                            <SelectItem key={resource.id} value={resource.id}>
                              {resource.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowPlanningDialog(false)}>
                    Avbryt
                  </Button>
                  <Button
                    type="submit"
                    disabled={planningMutation.isPending}
                    data-testid="button-save-planning"
                  >
                    {planningMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Spara
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showLinesDialog} onOpenChange={(open) => !open && handleCloseLinesDialog()}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Orderdetaljer
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              {selectedOrderForLines?.title}
              {selectedOrderForLines?.executionStatus && (
                <ExecutionStatusTracker 
                  status={selectedOrderForLines.executionStatus} 
                  variant="badge" 
                />
              )}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="lines" className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="lines" data-testid="tab-lines">Orderrader</TabsTrigger>
              <TabsTrigger value="timewindows" data-testid="tab-timewindows">Tidsfönster</TabsTrigger>
              <TabsTrigger value="dependencies" data-testid="tab-dependencies">Beroenden</TabsTrigger>
            </TabsList>

            <TabsContent value="lines" className="flex-1 overflow-auto mt-4">
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
                              onClick={() => deleteLineMutation.mutate({ lineId: line.id, workOrderId: selectedOrderForLines!.id })}
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
            </TabsContent>

            <TabsContent value="timewindows" className="flex-1 overflow-auto mt-4">
              {selectedOrderForLines && (
                <TaskTimewindowsEditor
                  workOrderId={selectedOrderForLines.id}
                  tenantId={selectedOrderForLines.tenantId}
                />
              )}
            </TabsContent>

            <TabsContent value="dependencies" className="flex-1 overflow-auto mt-4">
              {selectedOrderForLines && (
                <TaskDependenciesView
                  workOrderId={selectedOrderForLines.id}
                  tenantId={selectedOrderForLines.tenantId}
                />
              )}
            </TabsContent>
          </Tabs>

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
