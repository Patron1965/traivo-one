import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Loader2,
  Filter,
  Calendar,
  MapPin,
  Clock,
  Package,
  User,
  ChevronRight,
  CheckCircle2,
  Circle,
  PlayCircle,
  TruckIcon,
  ClipboardCheck,
  FileCheck,
  Receipt,
  DollarSign,
  Timer,
  UserPlus,
  XCircle,
  X,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Building2,
  Boxes,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Assignment, Resource, Cluster, ServiceObject, Article, AssignmentArticle } from "@shared/schema";
import { ASSIGNMENT_STATUS_LABELS, type AssignmentStatus } from "@shared/schema";
import { PageHelp } from "@/components/ui/help-tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClipboardList } from "lucide-react";
import { QueryState } from "@/components/QueryState";
import { formatSekFromOre } from "@/lib/format";
import { executionStatusBadge, getExecutionStatusBadge } from "@/lib/status-colors";

const formatCurrency = (value: number | null | undefined) => formatSekFromOre(value);

const statusOptions: { value: AssignmentStatus; label: string; icon: typeof Circle }[] = [
  { value: "not_planned", label: "Ej planerad", icon: Circle },
  { value: "planned_rough", label: "Grovplanerad", icon: Calendar },
  { value: "planned_fine", label: "Finplanerad", icon: ClipboardCheck },
  { value: "on_way", label: "På väg", icon: TruckIcon },
  { value: "on_site", label: "På plats", icon: MapPin },
  { value: "completed", label: "Utförd", icon: CheckCircle2 },
  { value: "inspected", label: "Kontrollerad", icon: FileCheck },
  { value: "invoiced", label: "Fakturerad", icon: Receipt },
];

const priorityOptions = [
  { value: "low", label: "Låg" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Hög" },
  { value: "urgent", label: "Brådskande" },
];

const getStatusColor = (status: string): string => {
  if (status === "invoiced") {
    return "bg-chart-5/15 text-chart-5 border border-chart-5/30";
  }
  return executionStatusBadge[status] ?? getExecutionStatusBadge(status);
};

interface ResourceCandidate {
  resource: Resource;
  score: number;
  available: boolean;
  reasons: string[];
}

export default function AssignmentsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [resourceFilter, setResourceFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [statusUpdateOpen, setStatusUpdateOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignmentToAssign, setAssignmentToAssign] = useState<Assignment | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const { toast } = useToast();

  const { data: assignments = [], isLoading, isError, error, refetch } = useQuery<Assignment[]>({
    queryKey: ["/api/assignments", statusFilter !== "all" ? statusFilter : undefined],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", "lookup"],
  });

  // Task #836 (Fas 3): Schemaläggnings-varningar (överlapp, restid, okvitterade
  // beroenden) över tenantens uppgifter — surfas som banner överst.
  const { data: scheduleWarnings } = useQuery<{
    warnings: Array<{ code: string; category: string; severity: string; message: string; relatedTaskId?: string }>;
    taskCount: number;
  }>({
    queryKey: ["/api/assignments/schedule-warnings"],
    staleTime: 15_000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/assignments/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/assignments"] });
      const snapshots = queryClient
        .getQueriesData<Assignment[]>({ queryKey: ["/api/assignments"] })
        .filter(([key, data]) => key.length <= 2 && Array.isArray(data));
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        queryClient.setQueryData<Assignment[]>(
          key,
          data.map((a) => (a.id === id ? { ...a, status } : a)),
        );
      });
      setStatusUpdateOpen(false);
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => {
        if (data) queryClient.setQueryData(key, data);
      });
      toast({ title: "Kunde inte uppdatera status", variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Status uppdaterad" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
    },
  });

  // Candidates query - only enabled when dialog is open
  const { data: candidates = [], isLoading: candidatesLoading } = useQuery<ResourceCandidate[]>({
    queryKey: ["/api/assignments", assignmentToAssign?.id, "candidates", selectedDate],
    queryFn: async () => {
      const params = selectedDate ? `?date=${selectedDate}` : "";
      const res = await fetch(`/api/assignments/${assignmentToAssign?.id}/candidates${params}`);
      if (!res.ok) throw new Error("Failed to fetch candidates");
      return res.json();
    },
    enabled: assignDialogOpen && !!assignmentToAssign?.id,
  });

  const assignResourceMutation = useMutation({
    mutationFn: ({ assignmentId, resourceId, scheduledDate }: { assignmentId: string; resourceId: string; scheduledDate?: string }) =>
      apiRequest("POST", `/api/assignments/${assignmentId}/assign`, { resourceId, scheduledDate }),
    onMutate: async ({ assignmentId, resourceId, scheduledDate }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/assignments"] });
      const snapshots = queryClient
        .getQueriesData<Assignment[]>({ queryKey: ["/api/assignments"] })
        .filter(([key, data]) => key.length <= 2 && Array.isArray(data));
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        queryClient.setQueryData<Assignment[]>(
          key,
          data.map((a) =>
            a.id === assignmentId
              ? {
                  ...a,
                  resourceId,
                  scheduledDate: scheduledDate ? new Date(scheduledDate) : a.scheduledDate,
                  status: a.status === "not_planned" ? "planned_fine" : a.status,
                }
              : a,
          ),
        );
      });
      setAssignDialogOpen(false);
      setAssignmentToAssign(null);
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => {
        if (data) queryClient.setQueryData(key, data);
      });
      toast({ title: "Kunde inte tilldela resurs", variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Resurs tilldelad" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
    },
  });

  // Task #836 (Fas 3): Kvittera beroendeuppgift (tillgänglighet bekräftad).
  const acknowledgeDependencyMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      apiRequest("POST", `/api/assignments/${assignmentId}/acknowledge-dependency`, {}),
    onSuccess: () => {
      toast({ title: "Beroende kvitterat" });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments/schedule-warnings"] });
    },
    onError: () => {
      toast({ title: "Kunde inte kvittera beroende", variant: "destructive" });
    },
  });

  const handleViewDetails = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setDetailDialogOpen(true);
  };

  const handleUpdateStatus = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setNewStatus(assignment.status);
    setStatusUpdateOpen(true);
  };

  const handleAssignResource = (assignment: Assignment) => {
    setAssignmentToAssign(assignment);
    setSelectedDate(assignment.scheduledDate 
      ? new Date(assignment.scheduledDate).toISOString().split("T")[0] 
      : new Date().toISOString().split("T")[0]);
    setAssignDialogOpen(true);
  };

  const filteredAssignments = assignments.filter((a) => {
    const matchesSearch =
      a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.address?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    const matchesResource = resourceFilter === "all" || a.resourceId === resourceFilter;
    return matchesSearch && matchesStatus && matchesResource;
  });

  const statusCounts = assignments.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Calculate totals
  const totals = filteredAssignments.reduce((acc, a) => ({
    value: acc.value + (a.cachedValue || 0),
    cost: acc.cost + (a.cachedCost || 0),
    time: acc.time + (a.estimatedDuration || 0),
  }), { value: 0, cost: 0, time: 0 });

  const activeFilterCount = [
    statusFilter !== "all" ? 1 : 0,
    resourceFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearAllFilters = () => {
    setStatusFilter("all");
    setResourceFilter("all");
    setSearchTerm("");
  };

  const hasActiveAssignmentFilter = !!searchTerm || statusFilter !== "all" || resourceFilter !== "all";

  return (
    <div className="p-6 space-y-6">
      <PageHeader icon={ClipboardList} title="Uppgifter" description="Hantera och följ upp genererade arbetsuppgifter">
        {assignments.length > 0 && (
          <>
            <Badge variant="secondary" className="text-xs font-normal">
              {filteredAssignments.length} av {assignments.length} visas
            </Badge>
            {assignments.filter(a => a.status === "not_planned").length > 0 && (
              <Badge variant="outline" className="text-xs font-normal text-chart-4 border-chart-4/30 dark:border-chart-4/70">
                {assignments.filter(a => a.status === "not_planned").length} ej planerade
              </Badge>
            )}
          </>
        )}
        <PageHelp
          title="Uppgifter (Assignments)"
          description="Uppgifter genereras automatiskt från orderkoncept eller skapas manuellt. De följer ett 8-stegs arbetsflöde från 'Ej planerad' till 'Fakturerad'."
        />
      </PageHeader>

      {/* Schemaläggnings-varningar (Fas 3) */}
      {scheduleWarnings && scheduleWarnings.warnings.length > 0 && (
        <Card className="border-warning/40" data-testid="card-schedule-warnings">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Schemaläggnings-varningar
              <Badge variant="outline" className="ml-1 text-xs font-normal">
                {scheduleWarnings.warnings.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {scheduleWarnings.warnings.map((w, i) => (
              <div
                key={`${w.code}-${i}`}
                className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                  w.severity === "error"
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-warning/40 bg-warning/10"
                }`}
                data-testid={`schedule-warning-${w.code}-${i}`}
              >
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 mt-0.5 ${w.severity === "error" ? "text-destructive" : "text-warning"}`}
                />
                <span>{w.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Economic Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Antal uppgifter</span>
            </div>
            <div className="text-2xl font-bold mt-1">{filteredAssignments.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-chart-2" />
              <span className="text-sm text-muted-foreground">Totalt värde</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-chart-2">{formatCurrency(totals.value)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-destructive" />
              <span className="text-sm text-muted-foreground">Total kostnad</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-destructive">{formatCurrency(totals.cost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-chart-1" />
              <span className="text-sm text-muted-foreground">Total tid</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-chart-1">{Math.round(totals.time / 60)} tim</div>
          </CardContent>
        </Card>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {statusOptions.map((status) => (
          <Card
            key={status.value}
            className={`cursor-pointer hover-elevate ${
              statusFilter === status.value ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setStatusFilter(statusFilter === status.value ? "all" : status.value)}
            data-testid={`card-status-${status.value}`}
          >
            <CardContent className="p-3 text-center">
              <status.icon className={`h-5 w-5 mx-auto mb-1 ${statusFilter === status.value ? "text-primary" : "text-muted-foreground"}`} />
              <div className="text-lg font-bold">{statusCounts[status.value] || 0}</div>
              <div className="text-xs text-muted-foreground truncate">{status.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-1 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök uppgifter..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-assignments"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="gap-2"
              data-testid="button-toggle-filters"
            >
              <Filter className="h-4 w-4" />
              Filter
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                  {activeFilterCount}
                </Badge>
              )}
              {filtersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1 text-muted-foreground" data-testid="button-clear-filters">
                <XCircle className="h-4 w-4" />
                Rensa filter
              </Button>
            )}
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              {statusFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setStatusFilter("all")} data-testid="badge-filter-status">
                  Status: {statusOptions.find(s => s.value === statusFilter)?.label || statusFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {resourceFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setResourceFilter("all")} data-testid="badge-filter-resource">
                  Resurs: {resources.find(r => r.id === resourceFilter)?.name || resourceFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
            </div>
          )}
        </CardHeader>
        {filtersOpen && (
          <CardContent className="space-y-4 pt-0">
            <div className="flex items-center gap-4 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                  <SelectValue placeholder="Alla statusar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla statusar</SelectItem>
                  {statusOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={resourceFilter} onValueChange={setResourceFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-resource-filter">
                  <SelectValue placeholder="Alla resurser" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla resurser</SelectItem>
                  {resources.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Assignments Table */}
      <Card>
        <CardContent className="p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={filteredAssignments.length === 0}
            error={error as { message?: string } | null}
            onRetry={() => refetch()}
            loadingVariant="skeleton-rows"
            skeletonRows={6}
            emptyTitle={hasActiveAssignmentFilter ? "Inga uppgifter matchade filtren" : "Inga uppgifter skapade än"}
            emptyDescription={hasActiveAssignmentFilter
              ? "Försök med andra sökord eller rensa filtren."
              : "Kör ett orderkoncept för att automatiskt generera uppgifter."}
            emptyAction={hasActiveAssignmentFilter ? (
              <Button variant="outline" size="sm" onClick={clearAllFilters} className="gap-1" data-testid="button-clear-filters-empty">
                <XCircle className="h-4 w-4" />
                Rensa filter
              </Button>
            ) : (
              <Link href="/order-concepts">
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-goto-concepts">
                  Gå till Orderkoncept
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          >
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>Uppgift</TableHead>
                <TableHead>Objekt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Värde</TableHead>
                <TableHead className="hidden lg:table-cell">Tid</TableHead>
                <TableHead className="hidden md:table-cell">Resurs</TableHead>
                <TableHead className="hidden lg:table-cell">Planerad</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssignments.map((assignment) => {
                const object = objects.find((o) => o.id === assignment.objectId);
                const resource = resources.find((r) => r.id === assignment.resourceId);
                return (
                  <TableRow key={assignment.id} data-testid={`row-assignment-${assignment.id}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{assignment.title}</div>
                        {assignment.quantity && assignment.quantity > 1 && (
                          <div className="text-xs text-muted-foreground">
                            {assignment.quantity} st
                          </div>
                        )}
                        {(assignment as any).requiresAcknowledgment && (
                          (assignment as any).dependencyAcknowledgedAt ? (
                            <Badge variant="outline" className="mt-1 gap-1 text-chart-2 border-chart-2/40" data-testid={`badge-dependency-ack-${assignment.id}`}>
                              <ShieldCheck className="h-3 w-3" /> Beroende kvitterat
                            </Badge>
                          ) : (
                            <Badge
                              className={`mt-1 gap-1 ${((assignment as any).dependencyCriticality ?? "critical") === "critical" ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground"}`}
                              data-testid={`badge-dependency-pending-${assignment.id}`}
                            >
                              <AlertTriangle className="h-3 w-3" /> Okvitterat beroende
                            </Badge>
                          )
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {object?.name || <span className="text-muted-foreground">Okänt</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(assignment.status)}>
                        {ASSIGNMENT_STATUS_LABELS[assignment.status as AssignmentStatus] || assignment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-sm font-medium text-chart-2">
                        {formatCurrency(assignment.cachedValue)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {assignment.estimatedDuration || 60} min
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {resource ? (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span className="text-sm">{resource.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Ej tilldelad</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {assignment.scheduledDate ? (
                        <div className="flex items-center gap-1 text-sm">
                          <Calendar className="h-3 w-3" />
                          {new Date(assignment.scheduledDate).toLocaleDateString("sv-SE")}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {(assignment as any).requiresAcknowledgment && !(assignment as any).dependencyAcknowledgedAt && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => acknowledgeDependencyMutation.mutate(assignment.id)}
                                disabled={acknowledgeDependencyMutation.isPending}
                                data-testid={`button-acknowledge-${assignment.id}`}
                              >
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Kvittera
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent><p>Bekräfta att beroendet är tillgängligt så huvuduppgiften kan utföras</p></TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant={!resource ? "default" : "ghost"}
                              onClick={() => handleAssignResource(assignment)}
                              data-testid={`button-assign-${assignment.id}`}
                            >
                              <UserPlus className="h-3 w-3 mr-1" />
                              {resource ? "Ändra" : "Tilldela"}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>{resource ? "Ändra tilldelad resurs" : "Tilldela resurs till uppgiften"}</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUpdateStatus(assignment)}
                              data-testid={`button-status-${assignment.id}`}
                            >
                              Ändra status
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Uppdatera uppgiftens status</p></TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleViewDetails(assignment)}
                              data-testid={`button-details-${assignment.id}`}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Visa detaljer</p></TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </QueryState>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedAssignment?.title}</DialogTitle>
            <DialogDescription>Uppgiftsdetaljer</DialogDescription>
          </DialogHeader>
          {selectedAssignment && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div>
                    <Badge className={getStatusColor(selectedAssignment.status)}>
                      {ASSIGNMENT_STATUS_LABELS[selectedAssignment.status as AssignmentStatus]}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Prioritet</Label>
                  <div>
                    <Badge variant="outline">
                      {priorityOptions.find((p) => p.value === selectedAssignment.priority)?.label}
                    </Badge>
                  </div>
                </div>
              </div>
              {selectedAssignment.description && (
                <div>
                  <Label className="text-muted-foreground">Beskrivning</Label>
                  <p className="text-sm">{selectedAssignment.description}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Objekt</Label>
                  <p className="text-sm">
                    {selectedAssignment.objectId ? (
                      <Link
                        href={`/objects/${selectedAssignment.objectId}`}
                        className="text-primary hover:underline inline-flex items-center gap-1"
                        data-testid="link-assignment-object"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {objects.find((o) => o.id === selectedAssignment.objectId)?.name || "Okänt"}
                      </Link>
                    ) : (
                      "Okänt"
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Antal</Label>
                  <p className="text-sm">{selectedAssignment.quantity || 1} st</p>
                </div>
              </div>
              {selectedAssignment.orderConceptId && (
                <div>
                  <Label className="text-muted-foreground">Orderkoncept</Label>
                  <p className="text-sm">
                    <Link
                      href={`/order-concepts/${selectedAssignment.orderConceptId}/edit`}
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="link-assignment-concept"
                    >
                      <Boxes className="h-3.5 w-3.5" />
                      Visa orderkoncept
                    </Link>
                  </p>
                </div>
              )}
              {selectedAssignment.orderConceptId && (
                <div>
                  <Label className="text-muted-foreground">Matchningsorsak</Label>
                  <p className="text-sm" data-testid="text-assignment-match-reason">
                    {selectedAssignment.matchReason || "—"}
                  </p>
                </div>
              )}
              {selectedAssignment.address && (
                <div>
                  <Label className="text-muted-foreground">Adress</Label>
                  <p className="text-sm">{selectedAssignment.address}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Uppskattad tid</Label>
                  <p className="text-sm">{selectedAssignment.estimatedDuration || 60} min</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Skapad</Label>
                  <p className="text-sm">
                    {new Date(selectedAssignment.createdAt).toLocaleDateString("sv-SE")}
                  </p>
                </div>
              </div>
              {/* Economic summary */}
              <div className="border-t pt-4">
                <Label className="text-muted-foreground">Ekonomi</Label>
                <div className="grid grid-cols-3 gap-4 mt-2">
                  <div className="bg-chart-2/10 dark:bg-chart-2/15 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground">Värde</div>
                    <div className="font-medium text-chart-2">
                      {formatCurrency(selectedAssignment.cachedValue)}
                    </div>
                  </div>
                  <div className="bg-destructive/10 dark:bg-destructive/15 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground">Kostnad</div>
                    <div className="font-medium text-destructive">
                      {formatCurrency(selectedAssignment.cachedCost)}
                    </div>
                  </div>
                  <div className="bg-chart-1/10 dark:bg-chart-1/15 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground">Marginal</div>
                    <div className="font-medium text-chart-1">
                      {formatCurrency((selectedAssignment.cachedValue || 0) - (selectedAssignment.cachedCost || 0))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDetailDialogOpen(false)}>Stäng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Update Dialog */}
      <Dialog open={statusUpdateOpen} onOpenChange={setStatusUpdateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ändra status</DialogTitle>
            <DialogDescription>Uppdatera uppgiftens status</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ny status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger data-testid="select-new-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <div className="flex items-center gap-2">
                        <s.icon className="h-4 w-4" />
                        {s.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusUpdateOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() =>
                selectedAssignment &&
                updateStatusMutation.mutate({ id: selectedAssignment.id, status: newStatus })
              }
              disabled={updateStatusMutation.isPending}
              data-testid="button-confirm-status"
            >
              {updateStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Resource Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tilldela resurs</DialogTitle>
            <DialogDescription>
              Välj en resurs för uppgiften: {assignmentToAssign?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Datum</Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                data-testid="input-assign-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Tillgängliga resurser</Label>
              {candidatesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">Inga resurser hittades</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {candidates.map((candidate) => (
                    <div
                      key={candidate.resource.id}
                      className={`p-3 rounded-md border ${
                        candidate.available 
                          ? "hover-elevate cursor-pointer" 
                          : "opacity-50 cursor-not-allowed"
                      }`}
                      onClick={() => {
                        if (candidate.available && assignmentToAssign) {
                          assignResourceMutation.mutate({
                            assignmentId: assignmentToAssign.id,
                            resourceId: candidate.resource.id,
                            scheduledDate: selectedDate
                          });
                        }
                      }}
                      data-testid={`candidate-${candidate.resource.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{candidate.resource.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {candidate.available ? (
                            <Badge variant="outline" className="bg-chart-2/10 dark:bg-chart-2/15 text-chart-2">
                              Tillgänglig
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-destructive/10 dark:bg-destructive/15 text-destructive">
                              Ej tillgänglig
                            </Badge>
                          )}
                          <Badge variant="secondary">{candidate.score} poäng</Badge>
                        </div>
                      </div>
                      {candidate.reasons.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {candidate.reasons.join(" • ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Avbryt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
