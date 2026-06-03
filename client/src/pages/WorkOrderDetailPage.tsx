import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryErrorState } from "@/components/ErrorBoundary";
import { formatSekFromOre } from "@/lib/format";
import { workOrderStatusBadge, priorityBadgeClasses, priorityLabels } from "@/lib/status-colors";
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
  Phone,
  Mail,
} from "lucide-react";
import type { WorkOrder } from "@shared/schema";

type WorkOrderDetail = WorkOrder & {
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  objectName?: string | null;
  objectAddress?: string | null;
};

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
};

const EXECUTION_STATUS_LABELS: Record<string, string> = {
  not_planned: "Ej planerad",
  planned_rough: "Grovplanerad",
  planned_fine: "Finplanerad",
  on_way: "På väg",
  on_site: "På plats",
  completed: "Slutförd",
  inspected: "Inspekterad",
  invoiced: "Fakturerad",
};

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
        <Badge className={statusBadgeClass(order.orderStatus)} data-testid="badge-order-status">
          {ORDER_STATUS_LABELS[order.orderStatus || "skapad"] || order.orderStatus || "Skapad"}
        </Badge>
        {order.priority && (
          <Badge className={priorityBadgeClasses[order.priority] || priorityBadgeClasses.normal} data-testid="badge-priority">
            {priorityLabels[order.priority] || order.priority}
          </Badge>
        )}
        {order.executionStatus && EXECUTION_STATUS_LABELS[order.executionStatus] && order.executionStatus !== "not_planned" && (
          <Badge variant="outline" data-testid="badge-execution-status">
            {EXECUTION_STATUS_LABELS[order.executionStatus]}
          </Badge>
        )}
      </PageHeader>

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
            <InfoRow label="Ordertyp" value={order.orderType} />
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
    </div>
  );
}
