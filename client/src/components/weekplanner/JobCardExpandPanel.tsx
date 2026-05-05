import { useState } from "react";
import type { SyntheticEvent } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarRange,
  History,
  MessageSquare,
  Image as ImageIcon,
  StickyNote,
  Package,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { useJobExpandData, type JobExpandData, type JobExpandSyncEntry, type SyncStatus } from "@/hooks/useJobExpandData";

interface JobCardExpandPanelProps {
  jobId: string;
  enabled: boolean;
  onHistoryClick?: (jobId: string) => void;
}

const TAB_KEY_PREFIX = "traivo:orderlager:expanded-tab:";

const ORDER_STATUS_LABELS: Record<string, string> = {
  skapad: "Skapad",
  planerad_pre: "Förplanerad",
  planerad_resurs: "Planerad",
  planerad_las: "Låst",
  paborjad: "Pågående",
  utford: "Utförd",
  fakturerad: "Fakturerad",
  avbruten: "Avbruten",
  omojlig: "Omöjlig",
};

function formatDate(d: string | null | undefined, withTime = false): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "—";
    return format(date, withTime ? "d MMM yyyy HH:mm" : "d MMM yyyy", { locale: sv });
  } catch {
    return "—";
  }
}

function formatRelative(d: string | null | undefined): string {
  if (!d) return "okänt";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "okänt";
    return formatDistanceToNow(date, { locale: sv, addSuffix: true });
  } catch {
    return "okänt";
  }
}

function CountBadge({ value }: { value: number }) {
  if (!value) return null;
  return (
    <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[9px] leading-none">
      {value}
    </Badge>
  );
}

function SyncMarker({ entry }: { entry: JobExpandSyncEntry }) {
  const map: Record<SyncStatus, { color: string; icon: typeof CheckCircle2; label: string }> = {
    fresh: { color: "text-green-600 dark:text-green-400", icon: CheckCircle2, label: `Synkad ${formatRelative(entry.latestSyncAt)}` },
    stale: { color: "text-muted-foreground", icon: Clock, label: `Senast ${formatRelative(entry.latestSyncAt)}` },
    pending: { color: "text-amber-600 dark:text-amber-400", icon: AlertTriangle, label: "Väntar på fältsync" },
    empty: { color: "text-muted-foreground/60", icon: Circle, label: "Ingen data" },
  };
  const { color, icon: Icon, label } = map[entry.status];
  return (
    <div className={`flex items-center gap-1 text-[10px] ${color} mb-1.5`} data-testid={`sync-marker-${entry.status}`}>
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </div>
  );
}

function PeriodTab({ data }: { data: JobExpandData }) {
  const { period } = data;
  const hasAny =
    period.desiredDeliveryStart ||
    period.desiredDeliveryEnd ||
    period.plannedWindowStart ||
    period.plannedWindowEnd ||
    period.scheduledDate ||
    period.slaDeadlineAt ||
    period.createdAt;
  return (
    <div data-testid="expand-tab-period-content">
      <SyncMarker entry={data.sync.period} />
      {!hasAny && <p className="text-[11px] text-muted-foreground py-2">Ingen leveransperiod, deadline eller schemalagd tid satt.</p>}
      <div className="space-y-1.5 text-[11px]">
        {(period.desiredDeliveryStart || period.desiredDeliveryEnd) && (
          <div>
            <div className="text-muted-foreground">Önskad leveransperiod</div>
            <div className="font-medium">
              {formatDate(period.desiredDeliveryStart)} → {formatDate(period.desiredDeliveryEnd)}
            </div>
          </div>
        )}
        {period.slaDeadlineAt && (
          <div>
            <div className="text-muted-foreground">SLA-deadline</div>
            <div className={`font-medium ${period.slaRiskLevel === "high" || period.slaRiskLevel === "critical" ? "text-red-600 dark:text-red-400" : period.slaRiskLevel === "medium" ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {formatDate(period.slaDeadlineAt)}
              {period.slaRiskLevel && <span className="ml-1 text-[10px] uppercase">({period.slaRiskLevel})</span>}
            </div>
          </div>
        )}
        {(period.plannedWindowStart || period.plannedWindowEnd) && (
          <div>
            <div className="text-muted-foreground">Planerat fönster</div>
            <div className="font-medium">
              {formatDate(period.plannedWindowStart)} → {formatDate(period.plannedWindowEnd)}
            </div>
          </div>
        )}
        {period.scheduledDate && (
          <div>
            <div className="text-muted-foreground">Schemalagd</div>
            <div className="font-medium">
              {formatDate(period.scheduledDate)}{period.scheduledStartTime ? ` kl ${period.scheduledStartTime}` : ""}
            </div>
          </div>
        )}
        {period.createdAt && (
          <div>
            <div className="text-muted-foreground">Skapad</div>
            <div className="font-medium">{formatDate(period.createdAt, true)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryTab({ data, onHistoryClick }: { data: JobExpandData; onHistoryClick?: (id: string) => void }) {
  return (
    <div data-testid="expand-tab-history-content">
      <SyncMarker entry={data.sync.history} />
      {data.history.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">Ingen historik på objektet.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.history.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onHistoryClick?.(h.id); }}
                className="w-full text-left text-[11px] border-l-2 border-muted pl-2 py-1 rounded hover-elevate"
                data-testid={`expand-history-item-${h.id}`}
              >
                <div className="font-medium truncate">{h.title}</div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span>{formatDate(h.scheduledDate || h.createdAt)}</span>
                  <span>·</span>
                  <span>{ORDER_STATUS_LABELS[h.orderStatus] || h.orderStatus}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommunicationsTab({ data }: { data: JobExpandData }) {
  return (
    <div data-testid="expand-tab-communications-content">
      <SyncMarker entry={data.sync.communications} />
      {data.communications.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">Ingen kommunikation skickad.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.communications.map((c) => (
            <li key={c.id} className="text-[11px] border rounded p-1.5 bg-background" data-testid={`expand-comm-item-${c.id}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-medium truncate">{c.notificationType}</span>
                <Badge variant="outline" className="text-[9px] h-4 px-1">{c.channel}</Badge>
              </div>
              {c.subject && <div className="text-muted-foreground truncate">{c.subject}</div>}
              <div className="flex items-center gap-1.5 text-muted-foreground mt-0.5">
                <span>{formatDate(c.sentAt || c.createdAt, true)}</span>
                <span>·</span>
                <span className={c.status === "sent" || c.status === "delivered" ? "text-green-600 dark:text-green-400" : c.status === "failed" ? "text-red-600 dark:text-red-400" : ""}>{c.status}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImagesTab({ data }: { data: JobExpandData }) {
  return (
    <div data-testid="expand-tab-images-content">
      <SyncMarker entry={data.sync.images} />
      {data.images.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">Inga bilder kopplade.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1">
          {data.images.map((img, i) => (
            <a
              key={img.id}
              href={img.url}
              target="_blank"
              rel="noreferrer"
              className="block aspect-square rounded overflow-hidden bg-muted hover-elevate"
              title={`${img.label} – ${formatDate(img.date, true)}`}
              data-testid={`expand-image-${i}`}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={img.url} alt={img.label} className="w-full h-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesTab({ data }: { data: JobExpandData }) {
  const { notes } = data;
  const hasAny = notes.notes || notes.plannedNotes || notes.description;
  return (
    <div data-testid="expand-tab-notes-content">
      <SyncMarker entry={data.sync.notes} />
      {!hasAny ? (
        <p className="text-[11px] text-muted-foreground py-2">Inga anteckningar.</p>
      ) : (
        <div className="space-y-1.5 text-[11px]">
          {notes.description && (
            <div>
              <div className="text-muted-foreground">Beskrivning</div>
              <div className="whitespace-pre-wrap">{notes.description}</div>
            </div>
          )}
          {notes.notes && (
            <div>
              <div className="text-muted-foreground">Anteckningar</div>
              <div className="whitespace-pre-wrap">{notes.notes}</div>
            </div>
          )}
          {notes.plannedNotes && (
            <div>
              <div className="text-muted-foreground">Planeringsanteckning</div>
              <div className="whitespace-pre-wrap">{notes.plannedNotes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MaterialsTab({ data }: { data: JobExpandData }) {
  return (
    <div data-testid="expand-tab-materials-content">
      <SyncMarker entry={data.sync.materials} />
      {data.materials.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">Inga orderrader.</p>
      ) : (
        <ul className="space-y-1">
          {data.materials.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-[11px] border-b border-muted pb-1" data-testid={`expand-material-item-${m.id}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{m.articleName || "—"}</div>
                {m.articleNumber && <div className="text-muted-foreground text-[10px]">{m.articleNumber}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div>{m.quantity} st</div>
                {m.resolvedPrice !== null && m.resolvedPrice !== undefined && (
                  <div className="text-muted-foreground text-[10px]">{m.resolvedPrice} kr</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function JobCardExpandPanel({ jobId, enabled, onHistoryClick }: JobCardExpandPanelProps) {
  const tabKey = `${TAB_KEY_PREFIX}${jobId}`;
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return "period";
    return localStorage.getItem(tabKey) || "period";
  });

  const handleTabChange = (v: string) => {
    setActiveTab(v);
    try { localStorage.setItem(tabKey, v); } catch { /* ignore quota */ }
  };

  const { data, isLoading, isError } = useJobExpandData(jobId, enabled);

  if (!enabled) return null;

  const stopAll = {
    onClick: (e: SyntheticEvent) => e.stopPropagation(),
    onPointerDown: (e: SyntheticEvent) => e.stopPropagation(),
    onMouseDown: (e: SyntheticEvent) => e.stopPropagation(),
    onTouchStart: (e: SyntheticEvent) => e.stopPropagation(),
  };

  if (isLoading) {
    return (
      <div className="mt-2 pt-2 border-t border-dashed" {...stopAll} data-testid={`expand-panel-loading-${jobId}`}>
        <Skeleton className="h-6 w-full mb-2" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mt-2 pt-2 border-t border-dashed flex items-center gap-1.5 text-[11px] text-muted-foreground" {...stopAll} data-testid={`expand-panel-error-${jobId}`}>
        <AlertCircle className="h-3 w-3" />
        Kunde inte ladda jobbinfo.
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-dashed" {...stopAll} data-testid={`expand-panel-${jobId}`}>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid grid-cols-6 h-7 p-0.5 gap-0.5">
          <TabsTrigger value="period" className="h-6 px-1 text-[10px] gap-0.5" data-testid={`tab-job-period-${jobId}`} title="Period">
            <CalendarRange className="h-3 w-3" /><CountBadge value={data.counts.period} />
          </TabsTrigger>
          <TabsTrigger value="history" className="h-6 px-1 text-[10px] gap-0.5" data-testid={`tab-job-history-${jobId}`} title="Historik">
            <History className="h-3 w-3" /><CountBadge value={data.counts.history} />
          </TabsTrigger>
          <TabsTrigger value="communications" className="h-6 px-1 text-[10px] gap-0.5" data-testid={`tab-job-communications-${jobId}`} title="Kommunikation">
            <MessageSquare className="h-3 w-3" /><CountBadge value={data.counts.communications} />
          </TabsTrigger>
          <TabsTrigger value="images" className="h-6 px-1 text-[10px] gap-0.5" data-testid={`tab-job-images-${jobId}`} title="Bilder">
            <ImageIcon className="h-3 w-3" /><CountBadge value={data.counts.images} />
          </TabsTrigger>
          <TabsTrigger value="notes" className="h-6 px-1 text-[10px] gap-0.5" data-testid={`tab-job-notes-${jobId}`} title="Anteckningar">
            <StickyNote className="h-3 w-3" /><CountBadge value={data.counts.notes} />
          </TabsTrigger>
          <TabsTrigger value="materials" className="h-6 px-1 text-[10px] gap-0.5" data-testid={`tab-job-materials-${jobId}`} title="Material">
            <Package className="h-3 w-3" /><CountBadge value={data.counts.materials} />
          </TabsTrigger>
        </TabsList>
        <div className="mt-2 max-h-56 overflow-y-auto pr-1">
          <TabsContent value="period" className="mt-0"><PeriodTab data={data} /></TabsContent>
          <TabsContent value="history" className="mt-0"><HistoryTab data={data} onHistoryClick={onHistoryClick} /></TabsContent>
          <TabsContent value="communications" className="mt-0"><CommunicationsTab data={data} /></TabsContent>
          <TabsContent value="images" className="mt-0"><ImagesTab data={data} /></TabsContent>
          <TabsContent value="notes" className="mt-0"><NotesTab data={data} /></TabsContent>
          <TabsContent value="materials" className="mt-0"><MaterialsTab data={data} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
