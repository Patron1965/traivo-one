import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PageHeader } from "@/components/layout/PageHeader";
import { ChainTracePanel } from "@/components/ChainTracePanel";
import { QueryErrorState } from "@/components/ErrorBoundary";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { formatSekFromOre } from "@/lib/format";
import { workOrderStatusBadge, priorityBadgeClasses, priorityLabels, getExecutionStatusLabel, getExecutionStatusBadge, executionStatusMeta } from "@/lib/status-colors";
import {
  ArrowLeft,
  ClipboardList,
  Building2,
  Users,
  Calendar,
  Clock,
  Truck,
  Package,
  FileText,
  MessageSquare,
  Image as ImageIcon,
  History,
  AlertTriangle,
  Loader2,
  MapPin,
  Link2,
  Phone,
  Mail,
  Pencil,
  Ban,
  RotateCcw,
  Activity,
  PencilLine,
  ArrowRightLeft,
  Receipt,
} from "lucide-react";
import type { WorkOrder } from "@shared/schema";
import { getOrderTypeLabel } from "@shared/schema";
import { KonteringCard } from "@/components/KonteringCard";

type CancellationInfo = {
  reason?: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
};

type WorkOrderDetail = WorkOrder & {
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  objectName?: string | null;
  objectAddress?: string | null;
  isCancelled?: boolean;
  cancellation?: CancellationInfo | null;
};


interface ActivityItem {
  id: string;
  action: string;
  createdAt?: string | null;
  userId?: string | null;
  userName: string;
  changes?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reason?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
}

interface ExpandPeriod {
  desiredDeliveryStart?: string | null;
  desiredDeliveryEnd?: string | null;
  plannedWindowStart?: string | null;
  plannedWindowEnd?: string | null;
  scheduledDate?: string | null;
  scheduledStartTime?: string | null;
  slaDeadlineAt?: string | null;
  slaRiskLevel?: string | null;
  slaDaysToBreach?: number | null;
  slaPredictedCompletionDate?: string | null;
  slaReason?: string | null;
  createdAt?: string | null;
}

interface ExpandMaterial {
  id: string;
  articleName?: string | null;
  articleNumber?: string | null;
  quantity?: number | null;
  resolvedPrice?: number | null;
  notes?: string | null;
  isOptional?: boolean;
  isCompleted?: boolean;
}

interface ExpandHistory {
  id: string;
  title?: string | null;
  scheduledDate?: string | null;
  orderStatus?: string | null;
  executionStatus?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
}

interface ExpandComm {
  id: string;
  channel?: string | null;
  notificationType?: string | null;
  status?: string | null;
  subject?: string | null;
  message?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
}

interface ExpandImage {
  id: string;
  url: string;
  label: string;
  date: string;
}

interface ExpandData {
  period: ExpandPeriod;
  history: ExpandHistory[];
  communications: ExpandComm[];
  images: ExpandImage[];
  notes: { notes?: string | null; plannedNotes?: string | null; description?: string | null };
  materials: ExpandMaterial[];
  counts: Record<string, number>;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  skapad: "Skapad",
  planerad_pre: "Förplanerad",
  planerad_resurs: "Planerad",
  planerad_las: "Låst",
  utford: "Klar",
  fakturerad: "Fakturerad",
  omojlig: "Omöjlig",
  avbruten: "Avbruten",
};

const STATUS_FLOW = ["skapad", "planerad_pre", "planerad_resurs", "planerad_las", "utford", "fakturerad"];
const TERMINAL_STATUSES = ["avbruten", "omojlig"];

const PRIORITY_OPTIONS = ["urgent", "high", "normal", "low"] as const;

/** Speglar serverns transitionsregler (storage.updateWorkOrderStatus):
 * från ett icke-terminalt läge kan man gå ett steg framåt i flödet, återgå
 * till "skapad", eller sätta "omöjlig". "avbruten" sker via Avbryt-knappen. */
function allowedNextStatuses(current: string): string[] {
  if (TERMINAL_STATUSES.includes(current)) return [];
  const idx = STATUS_FLOW.indexOf(current);
  const allowed = new Set<string>();
  if (current !== "skapad") allowed.add("skapad");
  if (idx >= 0 && idx + 1 < STATUS_FLOW.length) allowed.add(STATUS_FLOW[idx + 1]);
  allowed.add("omojlig");
  return Array.from(allowed);
}

function statusBadgeClass(orderStatus?: string | null): string {
  if (orderStatus === "utford" || orderStatus === "fakturerad") return workOrderStatusBadge.completed;
  if (orderStatus === "planerad_resurs" || orderStatus === "planerad_las") return workOrderStatusBadge.scheduled;
  if (orderStatus === "planerad_pre") return workOrderStatusBadge.in_progress;
  return workOrderStatusBadge.unassigned;
}

function fmtDate(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
}

function fmtDateTime(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
}

const FIELD_LABELS: Record<string, string> = {
  title: "Titel",
  description: "Beskrivning",
  priority: "Prioritet",
  orderStatus: "Status",
  executionStatus: "Utförandestatus",
  scheduledDate: "Schemalagt datum",
  scheduledStartTime: "Starttid",
  notes: "Anteckningar",
  plannedNotes: "Planeringsanteckning",
  resourceId: "Resurs",
  teamId: "Team",
  estimatedDuration: "Beräknad tid",
};

function fmtFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "orderStatus") return ORDER_STATUS_LABELS[String(value)] || String(value);
  if (field === "executionStatus") return getExecutionStatusLabel(String(value));
  if (field === "priority") return priorityLabels[String(value)] || String(value);
  if (field === "scheduledDate") return fmtDate(String(value)) ?? String(value);
  if (typeof value === "string" && value.length > 60) return value.slice(0, 60) + "…";
  return String(value);
}

const ACTION_META: Record<string, { label: string; icon: typeof Activity }> = {
  status_changed: { label: "Status ändrad", icon: ArrowRightLeft },
  updated: { label: "Order redigerad", icon: PencilLine },
  cancelled: { label: "Order avbruten", icon: Ban },
  restored: { label: "Order återställd", icon: RotateCcw },
};

function InfoRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: typeof Building2 }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </span>
      <span className="font-medium text-right break-words min-w-0">{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

export default function WorkOrderDetailPage() {
  const [, params] = useRoute("/work-orders/:id");
  const [, navigate] = useLocation();
  const workOrderId = params?.id || "";

  const {
    data: order,
    isLoading,
    error,
    refetch,
  } = useQuery<WorkOrderDetail>({
    queryKey: ["/api/work-orders", workOrderId],
    enabled: !!workOrderId,
  });

  const { data: expand } = useQuery<ExpandData>({
    queryKey: ["/api/work-orders", workOrderId, "expand"],
    enabled: !!workOrderId,
  });

  const { data: activityData } = useQuery<{ activity: ActivityItem[] }>({
    queryKey: ["/api/work-orders", workOrderId, "activity"],
    enabled: !!workOrderId,
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    scheduledDate: "",
    priority: "normal",
  });
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [chainTraceOpen, setChainTraceOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [forceCancel, setForceCancel] = useState(false);
  const [scheduleConflict, setScheduleConflict] = useState<{
    hard: string[];
    soft: string[];
    blocked: boolean;
  } | null>(null);

  const invalidateOrder = (objectId?: string | null) => {
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId] });
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "expand"] });
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId, "activity"] });
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    if (objectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "work-orders"] });
    }
  };

  const restoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/work-orders/${workOrderId}/restore`, {});
      return res.json();
    },
    onSuccess: (restored: WorkOrderDetail) => {
      invalidateOrder(restored?.objectId ?? order?.objectId);
      toast({ title: "Order återställd", description: "Arbetsordern är aktiv igen." });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte återställa", description: err.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/work-orders/${workOrderId}`, payload);
      return res.json();
    },
    onSuccess: (updated: WorkOrderDetail) => {
      invalidateOrder(updated?.objectId ?? order?.objectId);
      setEditOpen(false);
      setScheduleConflict(null);
      toast({ title: "Sparat", description: "Arbetsordern uppdaterades." });
    },
    onError: (err: Error) => {
      // Schemakonflikt från constraint-motorn (samma som veckoplaneraren):
      // 422 = hård blockering (kan ej sparas), 409 = mjuk konflikt (kräver
      // bekräftelse → spara igen med force).
      if (err instanceof ApiError && (err.status === 422 || err.status === 409)) {
        const details = (err.details ?? {}) as {
          hardConflicts?: string[];
          softConflicts?: string[];
          blocked?: boolean;
        };
        const hard = details.hardConflicts ?? [];
        const soft = details.softConflicts ?? [];
        if (hard.length > 0 || soft.length > 0) {
          setScheduleConflict({ hard, soft, blocked: err.status === 422 });
          return;
        }
      }
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("POST", `/api/work-orders/${workOrderId}/status`, { status });
      return res.json();
    },
    onSuccess: (updated: WorkOrderDetail) => {
      invalidateOrder(updated?.objectId ?? order?.objectId);
      setPendingStatus(null);
      toast({ title: "Status uppdaterad", description: "Orderstatusen ändrades." });
    },
    onError: (err: Error) => {
      setPendingStatus(null);
      toast({ title: "Kunde inte ändra status", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ reason, force }: { reason: string; force: boolean }) => {
      const url = `/api/work-orders/${workOrderId}${force ? "?force=true" : ""}`;
      await apiRequest("DELETE", url, reason ? { reason } : undefined);
    },
    onSuccess: () => {
      invalidateOrder(order?.objectId);
      setCancelOpen(false);
      toast({ title: "Order avbruten", description: "Arbetsordern har avbeställts." });
    },
    onError: (err: Error) => {
      const msg = err.message || "";
      if (!forceCancel && /fryst|Fortnox|force=true/i.test(msg)) {
        setForceCancel(true);
        toast({
          title: "Kräver tvångsläge",
          description: "Ordern är skyddad. Bekräfta tvångsavbeställning för att radera ändå.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Kunde inte avbryta", description: msg, variant: "destructive" });
    },
  });

  const openEdit = () => {
    if (!order) return;
    setEditForm({
      title: order.title ?? "",
      description: order.description ?? "",
      scheduledDate: order.scheduledDate
        ? new Date(order.scheduledDate).toISOString().slice(0, 10)
        : "",
      priority: order.priority ?? "normal",
    });
    setEditOpen(true);
  };

  const buildEditPayload = (force = false): Record<string, unknown> => ({
    title: editForm.title.trim(),
    description: editForm.description.trim() || null,
    priority: editForm.priority,
    scheduledDate: editForm.scheduledDate || null,
    checkConstraints: true,
    ...(force ? { force: true } : {}),
  });

  const submitEdit = () => {
    setScheduleConflict(null);
    editMutation.mutate(buildEditPayload(false));
  };

  const confirmSoftConflict = () => {
    setScheduleConflict(null);
    editMutation.mutate(buildEditPayload(true));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="loading-workorder">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="container mx-auto p-4 max-w-3xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/objects")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Tillbaka
        </Button>
        <QueryErrorState
          message={error ? "Kunde inte ladda arbetsordern" : "Arbetsordern hittades inte"}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const period = expand?.period;
  const materials = expand?.materials ?? [];
  const history = expand?.history ?? [];
  const comms = expand?.communications ?? [];
  const images = expand?.images ?? [];
  const notes = expand?.notes;
  const activity = activityData?.activity ?? [];

  const objectAddress = order.objectAddress;

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-4">
      <Button variant="ghost" size="sm" className="mb-1" onClick={() => navigate(order.objectId ? `/objects/${order.objectId}` : "/objects")} data-testid="button-back">
        <ArrowLeft className="h-4 w-4 mr-1" /> {order.objectId ? "Tillbaka till objekt" : "Tillbaka"}
      </Button>

      <PageHeader
        icon={ClipboardList}
        title={order.title || `Arbetsorder ${order.id.slice(0, 8)}`}
        description={order.description || undefined}
        testId="text-workorder-title"
      >
        {order.isCancelled ? (
          <Badge className="bg-destructive/15 text-destructive border border-destructive/30" data-testid="badge-order-status">
            Avbruten
          </Badge>
        ) : (
          <Badge className={statusBadgeClass(order.orderStatus)} data-testid="badge-order-status">
            {ORDER_STATUS_LABELS[order.orderStatus || "skapad"] || order.orderStatus || "Skapad"}
          </Badge>
        )}
        {order.priority && (
          <Badge className={priorityBadgeClasses[order.priority] || priorityBadgeClasses.normal} data-testid="badge-priority">
            {priorityLabels[order.priority] || order.priority}
          </Badge>
        )}
        {order.executionStatus && executionStatusMeta[order.executionStatus] && order.executionStatus !== "not_planned" && (
          <Badge variant="outline" className={getExecutionStatusBadge(order.executionStatus)} data-testid="badge-execution-status">
            {getExecutionStatusLabel(order.executionStatus)}
          </Badge>
        )}
      </PageHeader>

      {order.isCancelled ? (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3" data-testid="cancelled-banner">
          <div className="flex flex-wrap items-start gap-3">
            <Ban className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-0.5 text-sm">
              <div className="font-medium text-destructive">Den här ordern är avbruten</div>
              {order.cancellation?.cancelledAt && (
                <div className="text-muted-foreground" data-testid="text-cancelled-at">
                  Avbruten {fmtDateTime(order.cancellation.cancelledAt)}
                </div>
              )}
              {order.cancellation?.reason && (
                <div className="text-muted-foreground" data-testid="text-cancelled-reason">
                  Orsak: {order.cancellation.reason}
                </div>
              )}
            </div>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreMutation.mutate()}
                disabled={restoreMutation.isPending}
                data-testid="button-restore-workorder"
              >
                {restoreMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-1.5" />
                )}
                Återställ order
              </Button>
            )}
          </div>
        </div>
      ) : (() => {
        const nextStatuses = allowedNextStatuses(order.orderStatus || "skapad");
        const isTerminal = TERMINAL_STATUSES.includes(order.orderStatus || "");
        const canCancel = order.orderStatus !== "utford" && order.orderStatus !== "fakturerad";
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3" data-testid="workorder-actions">
            <Button variant="outline" size="sm" onClick={openEdit} data-testid="button-edit-workorder">
              <Pencil className="h-4 w-4 mr-1.5" /> Redigera
            </Button>

            {nextStatuses.length > 0 && (
              <Select value="" onValueChange={(v) => setPendingStatus(v)}>
                <SelectTrigger className="h-9 w-[180px]" data-testid="select-change-status">
                  <SelectValue placeholder="Byt status…" />
                </SelectTrigger>
                <SelectContent>
                  {nextStatuses.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`status-option-${s}`}>
                      {ORDER_STATUS_LABELS[s] || s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="ml-auto" />

            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setCancelReason("");
                  setForceCancel(false);
                  setCancelOpen(true);
                }}
                data-testid="button-cancel-workorder"
              >
                <Ban className="h-4 w-4 mr-1.5" /> Avbryt order
              </Button>
            )}
            {isTerminal && (
              <span className="text-sm text-muted-foreground" data-testid="text-terminal-status">
                Ordern är {ORDER_STATUS_LABELS[order.orderStatus || ""]?.toLowerCase()} och kan inte ändras.
              </span>
            )}
          </div>
        );
      })()}

      {/* Redigera-dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent data-testid="dialog-edit-workorder">
          <DialogHeader>
            <DialogTitle>Redigera arbetsorder</DialogTitle>
            <DialogDescription>Ändra nyckelfält och spara direkt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Titel</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                data-testid="input-edit-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Beskrivning</Label>
              <Textarea
                id="edit-description"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                data-testid="input-edit-description"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-scheduled">Schemalagt datum</Label>
                <Input
                  id="edit-scheduled"
                  type="date"
                  value={editForm.scheduledDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, scheduledDate: e.target.value }))}
                  data-testid="input-edit-scheduled-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-priority">Prioritet</Label>
                <Select
                  value={editForm.priority}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, priority: v }))}
                >
                  <SelectTrigger id="edit-priority" data-testid="select-edit-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p} data-testid={`priority-option-${p}`}>
                        {priorityLabels[p] || p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit">
              Avbryt
            </Button>
            <Button
              onClick={submitEdit}
              disabled={editMutation.isPending || !editForm.title.trim()}
              data-testid="button-save-edit"
            >
              {editMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schemakonflikt (samma kontroll som veckoplaneraren) */}
      <AlertDialog open={!!scheduleConflict} onOpenChange={(o) => !o && setScheduleConflict(null)}>
        <AlertDialogContent data-testid="dialog-schedule-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {scheduleConflict?.blocked ? "Ändringen blockeras" : "Bekräfta schemakonflikt"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {scheduleConflict?.blocked
                ? "Datum-/resursändringen bryter mot hårda planeringsregler och kan inte sparas. Justera planeringen och försök igen."
                : "Datum-/resursändringen skapar konflikter med planeringen. Granska varningarna nedan och bekräfta om du vill spara ändå."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-1">
            {scheduleConflict?.hard && scheduleConflict.hard.length > 0 && (
              <div className="space-y-1.5" data-testid="list-hard-conflicts">
                <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                  <Ban className="h-3.5 w-3.5" /> Blockerande
                </p>
                <ul className="space-y-1">
                  {scheduleConflict.hard.map((c, i) => (
                    <li
                      key={`hard-${i}`}
                      className="text-sm rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5"
                      data-testid={`text-hard-conflict-${i}`}
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {scheduleConflict?.soft && scheduleConflict.soft.length > 0 && (
              <div className="space-y-1.5" data-testid="list-soft-conflicts">
                <p className="text-sm font-medium text-warning flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Varningar
                </p>
                <ul className="space-y-1">
                  {scheduleConflict.soft.map((c, i) => (
                    <li
                      key={`soft-${i}`}
                      className="text-sm rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5"
                      data-testid={`text-soft-conflict-${i}`}
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-conflict">
              {scheduleConflict?.blocked ? "Stäng" : "Avbryt"}
            </AlertDialogCancel>
            {!scheduleConflict?.blocked && (
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmSoftConflict();
                }}
                disabled={editMutation.isPending}
                data-testid="button-confirm-conflict"
              >
                {editMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Spara ändå
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Statusbyte-bekräftelse */}
      <AlertDialog open={!!pendingStatus} onOpenChange={(o) => !o && setPendingStatus(null)}>
        <AlertDialogContent data-testid="dialog-confirm-status">
          <AlertDialogHeader>
            <AlertDialogTitle>Byt status?</AlertDialogTitle>
            <AlertDialogDescription>
              Ändra orderns status till{" "}
              <strong>{pendingStatus ? ORDER_STATUS_LABELS[pendingStatus] || pendingStatus : ""}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-status">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingStatus) statusMutation.mutate(pendingStatus);
              }}
              disabled={statusMutation.isPending}
              data-testid="button-confirm-status"
            >
              {statusMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Bekräfta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Avbryt-order-bekräftelse */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent data-testid="dialog-confirm-cancel">
          <AlertDialogHeader>
            <AlertDialogTitle>Avbryt arbetsorder?</AlertDialogTitle>
            <AlertDialogDescription>
              {forceCancel
                ? "Ordern är skyddad (fryst eller exporterad). Tvångsavbeställning krävs och kräver administratörsbehörighet."
                : "Ordern avbeställs och tas bort från aktiva vyer. Detta kan återställas av en administratör."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="cancel-reason">Orsak (valfritt)</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Varför avbeställs ordern?"
              data-testid="input-cancel-reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-cancel">Tillbaka</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                cancelMutation.mutate({ reason: cancelReason.trim(), force: forceCancel });
              }}
              disabled={cancelMutation.isPending}
              data-testid="button-confirm-cancel"
            >
              {cancelMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {forceCancel ? "Tvinga avbeställning" : "Avbryt order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Grunddata */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Orderinformation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5">
            <InfoRow label="Order-ID" value={<span className="font-mono text-xs">{order.id.slice(0, 8)}</span>} />
            <InfoRow label="Ordertyp" value={getOrderTypeLabel(order.orderType)} />
            <InfoRow label="Schemalagd" value={fmtDate(order.scheduledDate)} icon={Calendar} />
            {order.scheduledStartTime && <InfoRow label="Starttid" value={order.scheduledStartTime} icon={Clock} />}
            <InfoRow label="Beräknad tid" value={order.estimatedDuration ? `${order.estimatedDuration} min` : null} icon={Clock} />
            {order.actualDuration != null && <InfoRow label="Faktisk tid" value={`${order.actualDuration} min`} icon={Clock} />}
            <InfoRow label="Skapad" value={fmtDateTime(period?.createdAt ?? order.createdAt)} />
            {order.completedAt && <InfoRow label="Slutförd" value={fmtDateTime(order.completedAt)} />}
            {order.cachedValue ? <InfoRow label="Värde" value={formatSekFromOre(order.cachedValue)} /> : null}
          </CardContent>
        </Card>

        {/* Kund & Objekt */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Kund & Objekt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5">
            <InfoRow label="Kund" value={order.customerName} icon={Users} />
            {order.customerPhone && <InfoRow label="Telefon" value={order.customerPhone} icon={Phone} />}
            {order.customerEmail && <InfoRow label="E-post" value={order.customerEmail} icon={Mail} />}
            <InfoRow
              label="Objekt"
              value={
                order.objectId && order.objectName ? (
                  <button
                    className="text-primary hover:underline"
                    onClick={() => navigate(`/objects/${order.objectId}`)}
                    data-testid="link-object"
                  >
                    {order.objectName}
                  </button>
                ) : (
                  order.objectName
                )
              }
              icon={Building2}
            />
            {objectAddress && <InfoRow label="Adress" value={objectAddress} icon={MapPin} />}
            {/* Task #857: spåra hela kedjan order → orderkoncept → objekt → kund → faktura */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setChainTraceOpen(true)}
                data-testid="button-chain-trace"
              >
                <Link2 className="h-4 w-4 mr-1.5" /> Spåra hela kedjan
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Period & SLA */}
      {period && (period.desiredDeliveryStart || period.plannedWindowStart || period.slaDeadlineAt) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Period & SLA
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
            {(period.desiredDeliveryStart || period.desiredDeliveryEnd) && (
              <InfoRow
                label="Önskad period"
                value={`${fmtDate(period.desiredDeliveryStart) ?? "?"} – ${fmtDate(period.desiredDeliveryEnd) ?? "?"}`}
              />
            )}
            {(period.plannedWindowStart || period.plannedWindowEnd) && (
              <InfoRow
                label="Planerat fönster"
                value={`${fmtDate(period.plannedWindowStart) ?? "?"} – ${fmtDate(period.plannedWindowEnd) ?? "?"}`}
              />
            )}
            {period.slaDeadlineAt && <InfoRow label="SLA-deadline" value={fmtDate(period.slaDeadlineAt)} icon={AlertTriangle} />}
            {period.slaRiskLevel && (
              <InfoRow
                label="SLA-risk"
                value={
                  <Badge className={period.slaRiskLevel === "critical" ? "bg-destructive/15 text-destructive border border-destructive/30" : "bg-warning/15 text-warning border border-warning/30"}>
                    {period.slaRiskLevel === "critical" ? "Kritisk" : "Varning"}
                  </Badge>
                }
              />
            )}
            {period.slaReason && <InfoRow label="SLA-orsak" value={period.slaReason} />}
          </CardContent>
        </Card>
      )}

      {/* §5 J (Kontering): tilldelat team + kostnadsställe + projekt som uppgiften
          faktureras mot, med varifrån värdet härleds (read-only). */}
      <KonteringCard workOrderId={workOrderId} />

      {/* Anteckningar */}
      {(notes?.notes || notes?.plannedNotes || notes?.description || order.notes) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Anteckningar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {notes?.description && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Beskrivning</div>
                <p className="whitespace-pre-wrap">{notes.description}</p>
              </div>
            )}
            {notes?.plannedNotes && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Planeringsanteckning</div>
                <p className="whitespace-pre-wrap">{notes.plannedNotes}</p>
              </div>
            )}
            {(notes?.notes || order.notes) && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Övrigt</div>
                <p className="whitespace-pre-wrap">{notes?.notes ?? order.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Material */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" /> Material & artiklar
            {materials.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{materials.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {materials.length > 0 ? (
            <div className="divide-y">
              {materials.map((m) => (
                <div key={m.id} className="flex items-center justify-between py-2 gap-4" data-testid={`material-row-${m.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {m.articleName || "Okänd artikel"}
                      {m.isOptional && <span className="ml-2 text-xs text-muted-foreground">(valfri)</span>}
                    </div>
                    {m.articleNumber && <div className="text-xs text-muted-foreground">{m.articleNumber}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm">{m.quantity ?? 0} st</div>
                    {m.resolvedPrice != null && (
                      <div className="text-xs text-muted-foreground">{formatSekFromOre(m.resolvedPrice)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="empty-materials">Inga artiklar på denna order.</p>
          )}
        </CardContent>
      </Card>

      {/* Historik */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Tidigare ordrar på objektet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 gap-4" data-testid={`history-row-${h.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{h.title || "Order"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(h.completedAt ?? h.scheduledDate ?? h.createdAt)}</div>
                  </div>
                  <Badge className={statusBadgeClass(h.orderStatus)}>
                    {ORDER_STATUS_LABELS[h.orderStatus || "skapad"] || "Skapad"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aktivitet / ändringslogg */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Aktivitet
            {activity.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{activity.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity.length > 0 ? (
            <div className="space-y-4">
              {activity.map((item) => {
                const meta = ACTION_META[item.action] ?? { label: item.action, icon: Activity };
                const Icon = meta.icon;
                const reason = item.changes?.reason ?? null;
                const before = item.changes?.before ?? {};
                const after = item.changes?.after ?? {};
                const changedFields = Object.keys(after);
                return (
                  <div key={item.id} className="flex gap-3" data-testid={`activity-row-${item.id}`}>
                    <div className="flex flex-col items-center">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1 pb-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium">{meta.label}</span>
                        <span className="text-xs text-muted-foreground" data-testid={`activity-time-${item.id}`}>
                          {fmtDateTime(item.createdAt)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground" data-testid={`activity-user-${item.id}`}>
                        {item.userName}
                      </div>
                      {item.action === "status_changed" && (
                        <div className="text-sm">
                          {fmtFieldValue("orderStatus", before.orderStatus)}{" "}
                          <span className="text-muted-foreground">→</span>{" "}
                          <span className="font-medium">{fmtFieldValue("orderStatus", after.orderStatus)}</span>
                        </div>
                      )}
                      {item.action === "updated" && changedFields.length > 0 && (
                        <ul className="text-sm space-y-0.5">
                          {changedFields.map((f) => (
                            <li key={f}>
                              <span className="text-muted-foreground">{FIELD_LABELS[f] || f}:</span>{" "}
                              {fmtFieldValue(f, before[f])} <span className="text-muted-foreground">→</span>{" "}
                              <span className="font-medium">{fmtFieldValue(f, after[f])}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {reason && (
                        <div className="text-sm" data-testid={`activity-reason-${item.id}`}>
                          <span className="text-muted-foreground">Orsak:</span> {reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="empty-activity">
              Ingen registrerad aktivitet ännu. Statusbyten, redigeringar och avbeställningar visas här.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Kommunikation */}
      {comms.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Kommunikation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {comms.map((c) => (
                <div key={c.id} className="py-2" data-testid={`comm-row-${c.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">{c.subject || c.notificationType || c.channel || "Meddelande"}</div>
                    <div className="text-xs text-muted-foreground shrink-0">{fmtDateTime(c.sentAt ?? c.createdAt)}</div>
                  </div>
                  {c.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.message}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bilder */}
      {images.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Fältbilder
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {images.map((img) => (
                <div key={img.id} className="space-y-1" data-testid={`image-${img.id}`}>
                  <img src={img.url} alt={img.label} className="w-full h-28 object-cover rounded-md border" loading="lazy" />
                  <div className="text-xs text-muted-foreground truncate">{img.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ChainTracePanel
        workOrderId={chainTraceOpen ? workOrderId : null}
        open={chainTraceOpen}
        onClose={() => setChainTraceOpen(false)}
      />
    </div>
  );
}
