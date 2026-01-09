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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Assignment, Resource, Cluster, ServiceObject, Article, AssignmentArticle } from "@shared/schema";
import { ASSIGNMENT_STATUS_LABELS, type AssignmentStatus } from "@shared/schema";
import { PageHelp } from "@/components/ui/help-tooltip";

function formatCurrency(value: number | null | undefined): string {
  if (!value) return "0 kr";
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(value / 100);
}

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

function getStatusColor(status: string): string {
  switch (status) {
    case "not_planned":
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    case "planned_rough":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "planned_fine":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
    case "on_way":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "on_site":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "inspected":
      return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200";
    case "invoiced":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

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
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [statusUpdateOpen, setStatusUpdateOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignmentToAssign, setAssignmentToAssign] = useState<Assignment | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");

  const { toast } = useToast();

  const { data: assignments = [], isLoading } = useQuery<Assignment[]>({
    queryKey: ["/api/assignments", statusFilter !== "all" ? statusFilter : undefined],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/assignments/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      setStatusUpdateOpen(false);
      toast({ title: "Status uppdaterad" });
    },
    onError: () => {
      toast({ title: "Kunde inte uppdatera status", variant: "destructive" });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      setAssignDialogOpen(false);
      setAssignmentToAssign(null);
      toast({ title: "Resurs tilldelad" });
    },
    onError: () => {
      toast({ title: "Kunde inte tilldela resurs", variant: "destructive" });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-assignments">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Uppgifter</h1>
          <p className="text-muted-foreground">
            Hantera och följ upp genererade arbetsuppgifter
          </p>
        </div>
        <PageHelp
          title="Uppgifter (Assignments)"
          description="Uppgifter genereras automatiskt från orderkoncept eller skapas manuellt. De följer ett 8-stegs arbetsflöde från 'Ej planerad' till 'Fakturerad'."
        />
      </div>

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
              <DollarSign className="h-4 w-4 text-green-600" />
              <span className="text-sm text-muted-foreground">Totalt värde</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-green-600">{formatCurrency(totals.value)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-red-600" />
              <span className="text-sm text-muted-foreground">Total kostnad</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-red-600">{formatCurrency(totals.cost)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-muted-foreground">Total tid</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-blue-600">{Math.round(totals.time / 60)} tim</div>
          </CardContent>
        </Card>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {statusOptions.map((status) => (
          <Card
            key={status.value}
            className={`cursor-pointer transition-all ${
              statusFilter === status.value ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setStatusFilter(statusFilter === status.value ? "all" : status.value)}
            data-testid={`card-status-${status.value}`}
          >
            <CardContent className="p-3 text-center">
              <status.icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-lg font-bold">{statusCounts[status.value] || 0}</div>
              <div className="text-xs text-muted-foreground truncate">{status.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök uppgifter..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search-assignments"
          />
        </div>
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
        {(statusFilter !== "all" || resourceFilter !== "all" || searchTerm) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter("all");
              setResourceFilter("all");
              setSearchTerm("");
            }}
          >
            Rensa filter
          </Button>
        )}
      </div>

      {/* Assignments Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Uppgift</TableHead>
                <TableHead>Objekt</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Värde</TableHead>
                <TableHead>Tid</TableHead>
                <TableHead>Resurs</TableHead>
                <TableHead>Planerad</TableHead>
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
                    <TableCell>
                      <span className="text-sm font-medium text-green-600">
                        {formatCurrency(assignment.cachedValue)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {assignment.estimatedDuration || 60} min
                      </span>
                    </TableCell>
                    <TableCell>
                      {resource ? (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          <span className="text-sm">{resource.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Ej tilldelad</span>
                      )}
                    </TableCell>
                    <TableCell>
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
                        <Button
                          size="sm"
                          variant={!resource ? "default" : "ghost"}
                          onClick={() => handleAssignResource(assignment)}
                          data-testid={`button-assign-${assignment.id}`}
                        >
                          <UserPlus className="h-3 w-3 mr-1" />
                          {resource ? "Ändra" : "Tilldela"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUpdateStatus(assignment)}
                          data-testid={`button-status-${assignment.id}`}
                        >
                          Ändra status
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleViewDetails(assignment)}
                          data-testid={`button-details-${assignment.id}`}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredAssignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {searchTerm || statusFilter !== "all" || resourceFilter !== "all"
                      ? "Inga uppgifter matchade filtren"
                      : "Inga uppgifter skapade än. Kör ett orderkoncept för att generera uppgifter."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
                    {objects.find((o) => o.id === selectedAssignment.objectId)?.name || "Okänt"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Antal</Label>
                  <p className="text-sm">{selectedAssignment.quantity || 1} st</p>
                </div>
              </div>
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
                  <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground">Värde</div>
                    <div className="font-medium text-green-700 dark:text-green-400">
                      {formatCurrency(selectedAssignment.cachedValue)}
                    </div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground">Kostnad</div>
                    <div className="font-medium text-red-700 dark:text-red-400">
                      {formatCurrency(selectedAssignment.cachedCost)}
                    </div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground">Marginal</div>
                    <div className="font-medium text-blue-700 dark:text-blue-400">
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
                            <Badge variant="outline" className="bg-green-50 text-green-700">
                              Tillgänglig
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-50 text-red-700">
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
