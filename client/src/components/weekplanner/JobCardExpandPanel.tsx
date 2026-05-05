import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Pencil,
  Save,
  X,
  Loader2,
  Check,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import {
  useJobExpandData,
  useUpdateJobLine,
  useUpdateJobNotes,
  useUpdateJobPeriod,
  type JobExpandData,
  type JobExpandPeriod,
  type JobExpandSyncEntry,
  type JobExpandMaterial,
  type SyncStatus,
} from "@/hooks/useJobExpandData";
import { useToast } from "@/hooks/use-toast";

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

function toDateInputValue(d: string | null | undefined): string {
  if (!d) return "";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return "";
    return format(date, "yyyy-MM-dd");
  } catch {
    return "";
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

const DAY_MS = 24 * 60 * 60 * 1000;

function diffInDays(d: string | null | undefined): number | null {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return (date.getTime() - Date.now()) / DAY_MS;
}

function formatRelativeDays(d: string | null | undefined): string | null {
  const days = diffInDays(d);
  if (days === null) return null;
  const rounded = Math.round(days);
  if (rounded === 0) return "idag";
  if (rounded === 1) return "imorgon";
  if (rounded === -1) return "igår";
  if (rounded > 0) return `om ${rounded} dagar`;
  return `${Math.abs(rounded)} dagar försenad`;
}

function relativeColorClass(d: string | null | undefined, opts?: { criticalDays?: number; warningDays?: number }): string {
  const days = diffInDays(d);
  if (days === null) return "";
  const criticalDays = opts?.criticalDays ?? 1;
  const warningDays = opts?.warningDays ?? 3;
  if (days < 0) return "text-red-600 dark:text-red-400";
  if (days <= criticalDays) return "text-red-600 dark:text-red-400";
  if (days <= warningDays) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function ts(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : null;
}

function PeriodTimeline({ period }: { period: JobExpandPeriod }) {
  const desiredStart = ts(period.desiredDeliveryStart);
  const desiredEnd = ts(period.desiredDeliveryEnd);
  const plannedStart = ts(period.plannedWindowStart);
  const plannedEnd = ts(period.plannedWindowEnd);
  const scheduledAt = ts(period.scheduledDate);
  const deadlineAt = ts(period.slaDeadlineAt);
  const createdAt = ts(period.createdAt);
  const now = Date.now();

  const all = [desiredStart, desiredEnd, plannedStart, plannedEnd, scheduledAt, deadlineAt, createdAt, now]
    .filter((v): v is number => v !== null);
  if (all.length < 2) return null;

  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < DAY_MS) {
    const mid = (min + max) / 2;
    min = mid - DAY_MS / 2;
    max = mid + DAY_MS / 2;
  }
  const span = max - min;
  const pad = span * 0.04;
  min -= pad;
  max += pad;
  const totalSpan = max - min;
  const pos = (t: number) => ((t - min) / totalSpan) * 100;

  const desiredRange = desiredStart !== null && desiredEnd !== null && desiredEnd > desiredStart
    ? { left: pos(desiredStart), width: pos(desiredEnd) - pos(desiredStart) }
    : null;
  const plannedRange = plannedStart !== null && plannedEnd !== null && plannedEnd > plannedStart
    ? { left: pos(plannedStart), width: pos(plannedEnd) - pos(plannedStart) }
    : null;
  const nowPos = pos(now);
  const scheduledPos = scheduledAt !== null ? pos(scheduledAt) : null;
  const deadlinePos = deadlineAt !== null ? pos(deadlineAt) : null;

  return (
    <div className="my-2" data-testid="period-timeline">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border" />
        {desiredRange && (
          <div
            className="absolute top-[calc(50%-7px)] h-1.5 rounded bg-blue-300/80 dark:bg-blue-700/80"
            style={{ left: `${desiredRange.left}%`, width: `${desiredRange.width}%` }}
            title="Önskad leveransperiod"
            data-testid="timeline-desired"
          />
        )}
        {plannedRange && (
          <div
            className="absolute top-[calc(50%+1px)] h-1.5 rounded bg-purple-300/80 dark:bg-purple-700/80"
            style={{ left: `${plannedRange.left}%`, width: `${plannedRange.width}%` }}
            title="Planerat fönster"
            data-testid="timeline-planned"
          />
        )}
        {scheduledPos !== null && (
          <div
            className="absolute top-[calc(50%-6px)] h-3 w-1 rounded-sm bg-foreground"
            style={{ left: `calc(${scheduledPos}% - 2px)` }}
            title="Schemalagd"
            data-testid="timeline-scheduled"
          />
        )}
        {deadlinePos !== null && (
          <div
            className="absolute top-[calc(50%-9px)] h-[18px] w-0.5 bg-red-500"
            style={{ left: `calc(${deadlinePos}% - 1px)` }}
            title="SLA-deadline"
            data-testid="timeline-deadline"
          />
        )}
        <div
          className="absolute top-[calc(50%-7px)] h-3.5 w-px bg-amber-500"
          style={{ left: `calc(${nowPos}% - 0.5px)` }}
          title="Nu"
          data-testid="timeline-now"
        >
          <div className="absolute -top-1 -left-[2px] h-1.5 w-1.5 rounded-full bg-amber-500" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground mt-1">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-2 rounded bg-blue-300/80 dark:bg-blue-700/80" />Önskad</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-2 rounded bg-purple-300/80 dark:bg-purple-700/80" />Planerad</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-1 rounded-sm bg-foreground" />Schemalagd</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-0.5 bg-red-500" />Deadline</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Nu</span>
      </div>
    </div>
  );
}

function PeriodTab({ jobId, data }: { jobId: string; data: JobExpandData }) {
  const { period } = data;
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(toDateInputValue(period.desiredDeliveryStart));
  const [end, setEnd] = useState(toDateInputValue(period.desiredDeliveryEnd));
  const mutation = useUpdateJobPeriod(jobId);

  useEffect(() => {
    if (!editing) {
      setStart(toDateInputValue(period.desiredDeliveryStart));
      setEnd(toDateInputValue(period.desiredDeliveryEnd));
    }
  }, [editing, period.desiredDeliveryStart, period.desiredDeliveryEnd]);

  const hasAny =
    period.desiredDeliveryStart ||
    period.desiredDeliveryEnd ||
    period.plannedWindowStart ||
    period.plannedWindowEnd ||
    period.scheduledDate ||
    period.slaDeadlineAt ||
    period.createdAt;

  const handleSave = () => {
    if (start && end && start > end) {
      toast({
        title: "Ogiltigt intervall",
        description: "Startdatumet måste vara före slutdatumet.",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate(
      {
        desiredDeliveryStart: start ? start : null,
        desiredDeliveryEnd: end ? end : null,
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ title: "Önskad leveransperiod uppdaterad" });
        },
        onError: (err) => {
          toast({
            title: "Kunde inte spara perioden",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const slaLevel = period.slaRiskLevel;
  const slaCritical = slaLevel === "critical";
  const slaWarning = slaLevel === "warning";
  const slaOk = slaLevel === "ok";
  const showSlaBanner = slaCritical || slaWarning;

  const deadlineRelative = formatRelativeDays(period.slaDeadlineAt);
  const desiredEndRelative = formatRelativeDays(period.desiredDeliveryEnd ?? period.desiredDeliveryStart);
  const scheduledRelative = formatRelativeDays(period.scheduledDate);
  const predictedRelative = formatRelativeDays(period.slaPredictedCompletionDate);

  return (
    <div data-testid="expand-tab-period-content">
      <SyncMarker entry={data.sync.period} />

      {showSlaBanner && (
        <div
          className={`flex items-start gap-1.5 rounded p-1.5 mb-2 text-[11px] border ${
            slaCritical
              ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300"
              : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
          }`}
          data-testid={`sla-risk-banner-${slaLevel}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold uppercase text-[10px] tracking-wide">
              SLA-risk: {slaCritical ? "kritisk" : "varning"}
            </div>
            {period.slaReason && <div className="text-[10px] opacity-90 truncate">{period.slaReason}</div>}
            {predictedRelative && period.slaPredictedCompletionDate && (
              <div className="text-[10px] opacity-90">
                Prognostiserad klart: {formatDate(period.slaPredictedCompletionDate)} ({predictedRelative})
              </div>
            )}
          </div>
        </div>
      )}

      {slaOk && period.slaDeadlineAt && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 mb-1.5" data-testid="sla-risk-banner-ok">
          <CheckCircle2 className="h-3 w-3" />
          <span>SLA inom marginal</span>
        </div>
      )}

      {!hasAny && !editing && (
        <p className="text-[11px] text-muted-foreground py-2">Ingen leveransperiod, deadline eller schemalagd tid satt.</p>
      )}

      {hasAny && <PeriodTimeline period={period} />}

      <div className="space-y-1.5 text-[11px]">
        <div className="border border-dashed rounded p-1.5">
          <div className="flex items-center justify-between mb-1">
            <div className="text-muted-foreground">Önskad leveransperiod</div>
            {!editing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-5 px-1 text-[10px] gap-1"
                onClick={() => setEditing(true)}
                data-testid={`button-edit-period-${jobId}`}
              >
                <Pencil className="h-3 w-3" /> Ändra
              </Button>
            ) : (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1 text-[10px]"
                  onClick={() => setEditing(false)}
                  disabled={mutation.isPending}
                  data-testid={`button-cancel-period-${jobId}`}
                >
                  <X className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="h-5 px-1.5 text-[10px] gap-1"
                  onClick={handleSave}
                  disabled={mutation.isPending}
                  data-testid={`button-save-period-${jobId}`}
                >
                  {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Spara
                </Button>
              </div>
            )}
          </div>
          {editing ? (
            <div className="grid grid-cols-2 gap-1">
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-7 text-[11px]"
                data-testid={`input-period-start-${jobId}`}
              />
              <Input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-7 text-[11px]"
                data-testid={`input-period-end-${jobId}`}
              />
            </div>
          ) : (
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-medium">
                {formatDate(period.desiredDeliveryStart)} → {formatDate(period.desiredDeliveryEnd)}
              </span>
              {desiredEndRelative && (
                <span className={`text-[10px] ${relativeColorClass(period.desiredDeliveryEnd ?? period.desiredDeliveryStart)}`} data-testid="period-desired-relative">
                  {desiredEndRelative}
                </span>
              )}
            </div>
          )}
        </div>
        {period.slaDeadlineAt && (
          <div>
            <div className="text-muted-foreground">SLA-deadline</div>
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className={`font-medium ${slaCritical ? "text-red-600 dark:text-red-400" : slaWarning ? "text-amber-600 dark:text-amber-400" : ""}`}>
                {formatDate(period.slaDeadlineAt)}
              </span>
              {deadlineRelative && (
                <span className={`text-[10px] ${relativeColorClass(period.slaDeadlineAt)}`} data-testid="period-deadline-relative">
                  {deadlineRelative}
                </span>
              )}
              {slaLevel && (
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1 ${
                    slaCritical
                      ? "border-red-400 text-red-700 dark:border-red-700 dark:text-red-300"
                      : slaWarning
                      ? "border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                      : "border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300"
                  }`}
                  data-testid={`sla-risk-badge-${slaLevel}`}
                >
                  {slaLevel}
                </Badge>
              )}
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
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="font-medium">
                {formatDate(period.scheduledDate)}{period.scheduledStartTime ? ` kl ${period.scheduledStartTime}` : ""}
              </span>
              {scheduledRelative && (
                <span className={`text-[10px] ${relativeColorClass(period.scheduledDate, { criticalDays: 0, warningDays: 2 })}`} data-testid="period-scheduled-relative">
                  {scheduledRelative}
                </span>
              )}
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

function NotesTab({ jobId, data }: { jobId: string; data: JobExpandData }) {
  const { notes } = data;
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [notesValue, setNotesValue] = useState(notes.notes ?? "");
  const [plannedValue, setPlannedValue] = useState(notes.plannedNotes ?? "");
  const mutation = useUpdateJobNotes(jobId);

  useEffect(() => {
    if (!editing) {
      setNotesValue(notes.notes ?? "");
      setPlannedValue(notes.plannedNotes ?? "");
    }
  }, [editing, notes.notes, notes.plannedNotes]);

  const handleSave = () => {
    mutation.mutate(
      {
        notes: notesValue.trim() ? notesValue : null,
        plannedNotes: plannedValue.trim() ? plannedValue : null,
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ title: "Anteckningar sparade" });
        },
        onError: (err) => {
          toast({
            title: "Kunde inte spara anteckningar",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const hasAny = notes.notes || notes.plannedNotes || notes.description;
  return (
    <div data-testid="expand-tab-notes-content">
      <SyncMarker entry={data.sync.notes} />
      <div className="flex items-center justify-end mb-1.5">
        {!editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-[10px] gap-1"
            onClick={() => setEditing(true)}
            data-testid={`button-edit-notes-${jobId}`}
          >
            <Pencil className="h-3 w-3" /> Redigera
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-1 text-[10px]"
              onClick={() => setEditing(false)}
              disabled={mutation.isPending}
              data-testid={`button-cancel-notes-${jobId}`}
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-5 px-1.5 text-[10px] gap-1"
              onClick={handleSave}
              disabled={mutation.isPending}
              data-testid={`button-save-notes-${jobId}`}
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Spara
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-1.5 text-[11px]">
          <div>
            <div className="text-muted-foreground mb-0.5">Anteckningar</div>
            <Textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              rows={3}
              className="text-[11px] min-h-[60px] py-1.5"
              placeholder="Anteckningar för fältarbetet…"
              data-testid={`textarea-notes-${jobId}`}
            />
          </div>
          <div>
            <div className="text-muted-foreground mb-0.5">Planeringsanteckning</div>
            <Textarea
              value={plannedValue}
              onChange={(e) => setPlannedValue(e.target.value)}
              rows={2}
              className="text-[11px] min-h-[44px] py-1.5"
              placeholder="Internt för planeraren…"
              data-testid={`textarea-planned-notes-${jobId}`}
            />
          </div>
        </div>
      ) : !hasAny ? (
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

function MaterialRow({ jobId, line }: { jobId: string; line: JobExpandMaterial }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.quantity));
  const mutation = useUpdateJobLine(jobId);

  useEffect(() => {
    if (!editing) setQty(String(line.quantity));
  }, [editing, line.quantity]);

  const handleSaveQty = () => {
    const parsed = Number(qty);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      toast({
        title: "Ogiltig kvantitet",
        description: "Ange ett heltal ≥ 0.",
        variant: "destructive",
      });
      return;
    }
    if (parsed === line.quantity) {
      setEditing(false);
      return;
    }
    mutation.mutate(
      { lineId: line.id, quantity: parsed },
      {
        onSuccess: () => {
          setEditing(false);
          toast({ title: "Kvantitet uppdaterad" });
        },
        onError: (err) => {
          toast({
            title: "Kunde inte uppdatera",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleToggleOptional = () => {
    const next = !(line.isOptional ?? false);
    mutation.mutate(
      { lineId: line.id, isOptional: next },
      {
        onSuccess: () => {
          toast({ title: next ? "Markerad som klar/valfri" : "Markerad som krävs igen" });
        },
        onError: (err) => {
          toast({
            title: "Kunde inte uppdatera",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const isOptional = line.isOptional ?? false;

  return (
    <li
      className="flex items-center justify-between gap-2 text-[11px] border-b border-muted pb-1"
      data-testid={`expand-material-item-${line.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className={`font-medium truncate ${isOptional ? "line-through text-muted-foreground" : ""}`}>
          {line.articleName || "—"}
        </div>
        {line.articleNumber && <div className="text-muted-foreground text-[10px]">{line.articleNumber}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {editing ? (
          <>
            <Input
              type="number"
              min={0}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-6 w-14 text-[11px] px-1"
              data-testid={`input-line-qty-${line.id}`}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setEditing(false)}
              disabled={mutation.isPending}
              data-testid={`button-cancel-line-${line.id}`}
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-6 px-1.5 text-[10px] gap-0.5"
              onClick={handleSaveQty}
              disabled={mutation.isPending}
              data-testid={`button-save-line-${line.id}`}
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            </Button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-right hover-elevate rounded px-1 py-0.5"
              title="Ändra antal"
              data-testid={`button-edit-line-${line.id}`}
            >
              <span className={isOptional ? "line-through text-muted-foreground" : ""}>{line.quantity} st</span>
              {line.resolvedPrice !== null && line.resolvedPrice !== undefined && (
                <div className="text-muted-foreground text-[10px]">{line.resolvedPrice} kr</div>
              )}
            </button>
            <Button
              type="button"
              size="sm"
              variant={isOptional ? "default" : "ghost"}
              className="h-6 w-6 p-0"
              onClick={handleToggleOptional}
              disabled={mutation.isPending}
              title={isOptional ? "Avmarkera som klar" : "Markera som klar/valfri"}
              data-testid={`button-toggle-line-done-${line.id}`}
            >
              {mutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isOptional ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function MaterialsTab({ jobId, data }: { jobId: string; data: JobExpandData }) {
  return (
    <div data-testid="expand-tab-materials-content">
      <SyncMarker entry={data.sync.materials} />
      {data.materials.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">Inga orderrader.</p>
      ) : (
        <ul className="space-y-1">
          {data.materials.map((m) => (
            <MaterialRow key={m.id} jobId={jobId} line={m} />
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
          <TabsContent value="period" className="mt-0"><PeriodTab jobId={jobId} data={data} /></TabsContent>
          <TabsContent value="history" className="mt-0"><HistoryTab data={data} onHistoryClick={onHistoryClick} /></TabsContent>
          <TabsContent value="communications" className="mt-0"><CommunicationsTab data={data} /></TabsContent>
          <TabsContent value="images" className="mt-0"><ImagesTab data={data} /></TabsContent>
          <TabsContent value="notes" className="mt-0"><NotesTab jobId={jobId} data={data} /></TabsContent>
          <TabsContent value="materials" className="mt-0"><MaterialsTab jobId={jobId} data={data} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
