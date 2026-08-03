import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Marker, Popup } from "react-leaflet";
import { BaseMap, MapFitBounds, numberedDivIcon, dotDivIcon } from "@/components/ui/map";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, Play, CheckCircle, ArrowLeft,
  Loader2, AlertTriangle, Navigation as NavigationIcon, Phone,
  HelpCircle, Clock, Trash2, Ban, MapPinOff, Timer, Bell, WifiOff, FileSignature, Camera, X,
  Key, DoorOpen, ListChecks, CircleDot, Circle, Mail, Coffee, MessageSquare, ChevronRight,
  User, CloudSun, Pause, SkipForward, Send, Flag, Thermometer, Wind, Download, Share,
  Lock, Unlock, ClipboardCheck, Wrench, UserX, AlarmClock, Car, Database, FileText, ListTodo, Eye, EyeOff, Settings, Network, Plus,
  Search, Route, Users, Warehouse, ChevronDown, Package, Hash, Moon, Sun,
  ArrowRightLeft, RotateCcw, Calendar, Truck, History as HistoryIcon, Activity
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Resource, Vehicle, Equipment } from "@shared/schema";
import { startOfDay, endOfDay, format, getISOWeek, getISOWeekYear } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocalizedObjectName } from "@/lib/object-name";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { useOfflineSupport } from "@/hooks/useOfflineSupport";
import { useOfflineData } from "@/hooks/useOfflineData";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { OfflineIndicator, OfflineBanner } from "@/components/OfflineIndicator";
import { FieldAIAssistant } from "@/components/FieldAIAssistant";
import { PhotoCapture } from "@/components/PhotoCapture";
import { SignatureCapture } from "@/components/SignatureCapture";
import { generateJobProtocol, downloadBlob } from "@/components/JobProtocolGenerator";
import { MaterialLog, type MaterialItem } from "@/components/MaterialLog";
import { OrderChecklist } from "@/components/OrderChecklist";
import { ObjectDisplayNames } from "@/components/ObjectDisplayNames";
import { SigningValidationModal } from "@/components/SigningValidationModal";
import { VehicleStockView } from "@/components/VehicleStockView";
import type { WorkOrderWithObject, Customer } from "@shared/schema";
import { IMPOSSIBLE_REASONS, IMPOSSIBLE_REASON_LABELS, REQUIRED_FIELDS_BY_ORDER_TYPE } from "@shared/schema";
import { CATEGORY_LABELS, SEVERITY_LABELS, GO_CATEGORIES } from "@shared/changeRequestCategories";
import { UPPGIFT_STATUS_LABELS, type UppgiftStatus } from "@shared/uppgift-contract";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FIELD_PHOTO_SIZE_HINT,
  FIELD_PHOTO_TOO_LARGE_TOAST,
  IMAGE_REJECT_TOAST,
  getEffectiveContentType,
  isAcceptableImage,
  isWithinFieldPhotoSizeLimit,
} from "@/lib/file-mime";
import { DailyProgressCard } from "@/components/DailyProgressCard";
import { DayReport } from "@/components/DayReport";
import { FieldTodoList, getUncompletedTodoCount, addPersonalTodo } from "@/components/FieldTodoList";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  type FieldJobMeta,
  compareByRoute,
  sortByRoute,
  groupByLocation,
  groupByCustomer,
  groupByOrderNumber,
  filterBySearch,
  DEFAULT_LOCATION_GROUP_RADIUS_KM,
} from "@/lib/field-job-list";
import { VoiceInput } from "@/components/VoiceInput";
import { FocusTimeline, FocusCTA, ExpandableDetail, OrderStatusBadge, getTimelineStep, useFocusMode } from "@/components/FocusMode";
import { TaskRoleBadge } from "@/components/TaskRoleBadge";
import { OutboxCenter } from "@/components/OutboxCenter";
import { EnkelUppgiftWizard } from "@/components/EnkelUppgiftWizard";
import { TimelineView } from "@/components/TimelineView";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type View = "jobs" | "job" | "report" | "todo" | "outbox" | "timeline" | "stock";

interface MyReportItem {
  id: string;
  category: string;
  description: string;
  status: string;
  severity?: string | null;
  objectName?: string | null;
  objectAddress?: string | null;
  customerName?: string | null;
  createdAt?: string;
}

interface DeviationReportItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: string;
  reportedAt?: string;
}

interface TeamMemberDeviationItem {
  resourceId: string;
  resourceName: string;
  ownTasks: Array<{ id: string; title: string; minutes: number }>;
  ownTasksMinutes: number;
  absences: Array<{ id: string; title: string; minutes: number }>;
  absenceMinutes: number;
  ownTravelMinutes: number;
  totalDeviationMinutes: number;
  hasDeviation: boolean;
}

interface TeamDeviationSummaryItem {
  members: TeamMemberDeviationItem[];
  teamAbsences: Array<{ id: string; title: string; minutes: number }>;
  teamAbsenceMinutes: number;
  totalCapacityImpactMinutes: number;
}

function formatDeviationMinutes(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// Individuella avvikelser i team (Task #1241) — läsande vy för teamets
// medlemmar i utförarappen. Skapar/ändrar aldrig avvikelser, visar bara
// befintliga fine-planning-signaler (egen uppgift/frånvaro/egen resa).
function TeamDeviationsPanel({ mobileApiCall }: { mobileApiCall: (method: string, url: string, body?: unknown) => Promise<Response> }) {
  const [teams, setTeams] = useState<Array<{ id: string; name?: string }>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [summary, setSummary] = useState<TeamDeviationSummaryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Hämta ALLA team resursen tillhör — en fältarbetare kan vara medlem i fler
  // än ett team, och panelen ska inte tyst välja det första utan låta
  // användaren byta om det finns fler.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const teamsRes = await mobileApiCall("GET", "/api/mobile/my-team");
        const teamsData: Array<{ id: string; name?: string }> = await teamsRes.json();
        if (cancelled) return;
        setTeams(teamsData);
        setSelectedTeamId((prev) => prev || teamsData[0]?.id || "");
        if (teamsData.length === 0) setLoading(false);
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [mobileApiCall]);

  useEffect(() => {
    if (!selectedTeamId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const now = new Date();
        const week = getISOWeek(now);
        const isoYear = getISOWeekYear(now);
        const res = await mobileApiCall(
          "GET",
          `/api/mobile/teams/${selectedTeamId}/deviations?year=${isoYear}&week=${week}`,
        );
        const data = await res.json();
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mobileApiCall, selectedTeamId]);

  const membersWithDeviation = summary?.members.filter((m) => m.hasDeviation) ?? [];
  const hasAnyDeviation = membersWithDeviation.length > 0 || (summary?.teamAbsenceMinutes ?? 0) > 0;

  return (
    <Card className="border-chart-4/20 dark:border-chart-4/80" data-testid="panel-team-deviations">
      <CardHeader className="pb-2 space-y-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-chart-4" />
          Avvikelser i teamet denna vecka
        </CardTitle>
        {teams.length > 1 && (
          <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-field-deviation-team">
              <SelectValue placeholder="Välj team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id} data-testid={`option-field-deviation-team-${t.id}`}>
                  {t.name || t.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-xs text-muted-foreground">Laddar...</p>}
        {!loading && error && <p className="text-xs text-muted-foreground">Kunde inte hämta avvikelser.</p>}
        {!loading && !error && !hasAnyDeviation && (
          <p className="text-xs text-muted-foreground" data-testid="text-no-team-deviations">
            Inga avvikelser från teamplanen just nu.
          </p>
        )}
        {!loading && !error && hasAnyDeviation && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-warning" data-testid="text-team-capacity-impact">
              Kapacitetspåverkan: {formatDeviationMinutes(summary?.totalCapacityImpactMinutes ?? 0)}
            </p>
            {membersWithDeviation.map((m) => (
              <div key={m.resourceId} className="text-xs border-l-2 border-chart-4 pl-2" data-testid={`row-team-deviation-${m.resourceId}`}>
                <span className="font-medium">{m.resourceName}</span>
                {m.ownTasksMinutes > 0 && <span className="text-muted-foreground"> · egen uppgift ({formatDeviationMinutes(m.ownTasksMinutes)})</span>}
                {m.ownTravelMinutes > 0 && <span className="text-muted-foreground"> · egen resa ({formatDeviationMinutes(m.ownTravelMinutes)})</span>}
                {m.absenceMinutes > 0 && <span className="text-muted-foreground" data-testid={`text-field-member-absence-${m.resourceId}`}> · frånvaro ({formatDeviationMinutes(m.absenceMinutes)})</span>}
              </div>
            ))}
            {summary && summary.teamAbsences.length > 0 && (
              <div className="text-xs border-l-2 border-muted pl-2" data-testid="row-team-absence">
                <span className="font-medium">Team</span>
                <span className="text-muted-foreground"> · borta ({formatDeviationMinutes(summary.teamAbsenceMinutes)})</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MyReportsPanel({ mobileApiCall }: { mobileApiCall: (method: string, url: string, body?: unknown) => Promise<Response> }) {
  const [changeRequests, setChangeRequests] = useState<MyReportItem[]>([]);
  const [deviations, setDeviations] = useState<DeviationReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"changes" | "deviations">("changes");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [crRes, devRes] = await Promise.all([
          mobileApiCall("GET", "/api/mobile/customer-change-requests/mine?limit=20"),
          mobileApiCall("GET", "/api/mobile/deviations/mine?limit=20"),
        ]);
        const crData = await crRes.json();
        if (!cancelled) setChangeRequests(crData.items || []);
        const devData = await devRes.json();
        if (!cancelled) setDeviations(devData.items || []);
      } catch {
        if (!cancelled) {
          setChangeRequests([]);
          setDeviations([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mobileApiCall]);

  const statusLabels: Record<string, string> = {
    new: "Ny",
    in_progress: "Pågår",
    resolved: "Löst",
    rejected: "Avvisad",
    reported: "Rapporterad",
  };

  const items = activeTab === "changes" ? changeRequests : deviations;

  return (
    <Card className="border-chart-4/20 dark:border-chart-4/80" data-testid="panel-my-reports">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flag className="h-4 w-4 text-chart-4" />
          Mina rapporter
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-1">
          <Button
            variant={activeTab === "changes" ? "default" : "outline"}
            size="sm"
            className="text-xs h-7 flex-1"
            onClick={() => setActiveTab("changes")}
            data-testid="tab-change-requests"
          >
            Kundrapporter ({changeRequests.length})
          </Button>
          <Button
            variant={activeTab === "deviations" ? "default" : "outline"}
            size="sm"
            className="text-xs h-7 flex-1"
            onClick={() => setActiveTab("deviations")}
            data-testid="tab-deviations"
          >
            Avvikelser ({deviations.length})
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            {activeTab === "changes" ? "Inga kundrapporter ännu" : "Inga avvikelser ännu"}
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-auto">
            {items.map((r) => (
              <div key={r.id} className="border rounded-lg p-2 text-sm" data-testid={`report-item-${r.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">
                    {CATEGORY_LABELS[r.category] || ("title" in r ? (r as DeviationReportItem).title : r.category)}
                  </span>
                  <Badge variant={r.status === "new" || r.status === "reported" ? "default" : r.status === "resolved" ? "secondary" : "outline"} className="text-[10px] shrink-0">
                    {statusLabels[r.status] || r.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{r.description}</p>
                {"objectName" in r && (r as MyReportItem).objectName && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{(r as MyReportItem).objectName}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Task #1189: uppgiftens tidslinje i fältappen. Speglar webbens tidslinje
// (WorkOrderDetailPage) men läser via den mobil-auktoriserade endpointen.
interface FieldTimelineEvent {
  id: string;
  eventType: string;
  timeKind?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorName: string;
  detail?: Record<string, unknown> | null;
  occurredAt?: string | null;
}

const FIELD_TIMELINE_EVENT_META: Record<string, { label: string; icon: typeof Activity; tone: "muted" | "warning" | "primary" }> = {
  status_changed: { label: "Status ändrad", icon: ArrowRightLeft, tone: "muted" },
  bounce: { label: "Studs (grov ↔ fin)", icon: RotateCcw, tone: "warning" },
  rescheduled: { label: "Ombokad", icon: Calendar, tone: "warning" },
  resource_reassigned: { label: "Resurs ombokad", icon: Users, tone: "warning" },
  desired_window_set: { label: "Önskad tid satt", icon: Clock, tone: "muted" },
  planned_window_set: { label: "Planerad tid satt", icon: Clock, tone: "muted" },
  en_route: { label: "På väg", icon: Truck, tone: "primary" },
  arrived: { label: "På plats", icon: MapPin, tone: "primary" },
  completed: { label: "Utförd", icon: HistoryIcon, tone: "primary" },
  impossible: { label: "Omöjlig att utföra", icon: AlertTriangle, tone: "warning" },
};

const FIELD_TIMELINE_TONE_CLASSES: Record<"muted" | "warning" | "primary", string> = {
  muted: "bg-muted text-muted-foreground",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/15 text-primary",
};

const FIELD_TIME_KIND_LABELS: Record<string, string> = {
  onskad: "Önskad",
  planerad: "Planerad",
  verklig: "Verklig",
};

function fieldUppgiftStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return UPPGIFT_STATUS_LABELS[status as UppgiftStatus] ?? status;
}

function fieldFmtDateTime(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
}

function fieldFmtDatePart(v: unknown): string {
  if (v == null || v === "") return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("sv-SE", { dateStyle: "medium" });
}

function fieldDescribeTimelineDetail(ev: FieldTimelineEvent): string | null {
  const d = (ev.detail ?? {}) as Record<string, any>;
  switch (ev.eventType) {
    case "rescheduled": {
      const from = d.fromDate ? fieldFmtDatePart(d.fromDate) : "—";
      const to = d.toDate ? fieldFmtDatePart(d.toDate) : "—";
      const times = (d.fromTime || d.toTime) ? ` (${d.fromTime ?? "—"} → ${d.toTime ?? "—"})` : "";
      return `${from} → ${to}${times}`;
    }
    case "bounce":
      return `${d.from ?? "—"} → ${d.to ?? "—"}`;
    case "impossible":
      return d.reason ? `Orsak: ${d.reason}` : null;
    default:
      return null;
  }
}

function TaskTimelinePanel({
  workOrderId,
  mobileApiCall,
  enabled,
}: {
  workOrderId: string;
  mobileApiCall: (method: string, url: string, body?: unknown) => Promise<Response>;
  enabled: boolean;
}) {
  const { data, isLoading } = useQuery<{ timeline: FieldTimelineEvent[] }>({
    queryKey: ["/api/mobile/orders", workOrderId, "timeline"],
    queryFn: async () => {
      const res = await mobileApiCall("GET", `/api/mobile/orders/${workOrderId}/timeline`);
      return res.json();
    },
    enabled: enabled && !!workOrderId,
  });

  const timeline = data?.timeline ?? [];

  return (
    <Card data-testid="card-task-timeline">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <HistoryIcon className="h-4 w-4" /> Tidslinje
          {timeline.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{timeline.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : timeline.length > 0 ? (
          <div className="space-y-4" data-testid="list-task-timeline">
            {timeline.map((ev) => {
              const meta = FIELD_TIMELINE_EVENT_META[ev.eventType] ?? { label: ev.eventType, icon: Activity, tone: "muted" as const };
              const Icon = meta.icon;
              const detail = fieldDescribeTimelineDetail(ev);
              return (
                <div key={ev.id} className="flex gap-3" data-testid={`task-timeline-row-${ev.id}`}>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full shrink-0 ${FIELD_TIMELINE_TONE_CLASSES[meta.tone]}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1 pb-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        {meta.label}
                        {ev.timeKind && FIELD_TIME_KIND_LABELS[ev.timeKind] && (
                          <Badge variant="outline" className="text-[10px] font-normal">{FIELD_TIME_KIND_LABELS[ev.timeKind]}</Badge>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground" data-testid={`task-timeline-time-${ev.id}`}>
                        {fieldFmtDateTime(ev.occurredAt)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid={`task-timeline-actor-${ev.id}`}>
                      {ev.actorName}
                    </div>
                    {ev.eventType === "status_changed" && (
                      <div className="text-sm">
                        {fieldUppgiftStatusLabel(ev.fromStatus)}{" "}
                        <span className="text-muted-foreground">→</span>{" "}
                        <span className="font-medium">{fieldUppgiftStatusLabel(ev.toStatus)}</span>
                      </div>
                    )}
                    {detail && (
                      <div className="text-sm" data-testid={`task-timeline-detail-${ev.id}`}>{detail}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="empty-task-timeline">
            Ingen tidslinje ännu. Statusövergångar och tidsstämplar (önskad → planerad → verklig), studsar och ombokningar loggas här efter hand.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface SimpleFieldAppProps {
  resourceId?: string;
}

export function SimpleFieldApp({ resourceId }: SimpleFieldAppProps) {
  const { toast } = useToast();
  const localizedObjectName = useLocalizedObjectName();
  const { focusMode, setFocusMode } = useFocusMode();
  const [view, setView] = useState<View>("jobs");
  const [showEnkelUppgift, setShowEnkelUppgift] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobSearch, setJobSearch] = useState("");
  const [jobListMode, setJobListMode] = useState<"rutt" | "plats" | "kund" | "order">("rutt");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [jobStarted, setJobStarted] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showProblemPanel, setShowProblemPanel] = useState(false);
  const [showLineagePanel, setShowLineagePanel] = useState(false);
  const [showSignaturePanel, setShowSignaturePanel] = useState(false);
  const [currentSignature, setCurrentSignature] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [completedVehicleId, setCompletedVehicleId] = useState<string | null>(null);
  const [completedEquipmentId, setCompletedEquipmentId] = useState<string | null>(null);
  const [completedParticipantIds, setCompletedParticipantIds] = useState<string[]>([]);
  const [showImpossibleDialog, setShowImpossibleDialog] = useState(false);
  const [selectedImpossibleReason, setSelectedImpossibleReason] = useState<string | null>(null);
  const [impossibleReasonText, setImpossibleReasonText] = useState("");
  const [impossiblePhoto, setImpossiblePhoto] = useState<string | null>(null);
  const [isUploadingImpossiblePhoto, setIsUploadingImpossiblePhoto] = useState(false);
  
  const [showInspectionPanel, setShowInspectionPanel] = useState(false);
  const [inspectionItems, setInspectionItems] = useState<Record<string, { status: string; issues: string[]; comment: string }>>({
    door: { status: '', issues: [], comment: '' },
    lock: { status: '', issues: [], comment: '' },
    window: { status: '', issues: [], comment: '' },
    lighting: { status: '', issues: [], comment: '' },
    floor: { status: '', issues: [], comment: '' },
    ventilation: { status: '', issues: [], comment: '' },
  });

  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [jobNote, setJobNote] = useState("");
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [breakStartTime, setBreakStartTime] = useState<Date | null>(null);
  const [breakElapsedSeconds, setBreakElapsedSeconds] = useState(0);
  const breakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [showCompletedDialog, setShowCompletedDialog] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationMissingFields, setValidationMissingFields] = useState<{ field: string; label: string }[]>([]);

  const [showChangeRequestPanel, setShowChangeRequestPanel] = useState(false);
  const [changeRequestCategory, setChangeRequestCategory] = useState("");
  const [changeRequestDescription, setChangeRequestDescription] = useState("");
  const [changeRequestSeverity, setChangeRequestSeverity] = useState<string>("medium");
  const [changeRequestPhoto, setChangeRequestPhoto] = useState<string | null>(null);
  const [isUploadingChangePhoto, setIsUploadingChangePhoto] = useState(false);
  const [changePhotoDragOver, setChangePhotoDragOver] = useState(false);
  const [impossiblePhotoDragOver, setImpossiblePhotoDragOver] = useState(false);
  const [showMyReportsPanel, setShowMyReportsPanel] = useState(false);
  const [showTeamDeviationsPanel, setShowTeamDeviationsPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const { data: myResource } = useQuery<Resource>({
    queryKey: ["/api/resources", resourceId],
    enabled: !!resourceId && showSettingsPanel,
  });

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
  });

  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  const { data: allResources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const updateResourcePrefsMutation = useMutation({
    mutationFn: async (patch: { smsOnScheduleSend?: boolean; smsOnExtraJob?: boolean }) => {
      if (!resourceId) throw new Error("Ingen resurs");
      return await apiRequest("PATCH", `/api/resources/${resourceId}`, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources", resourceId] });
      toast({ title: "Sparat", description: "Dina aviseringsval har uppdaterats." });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Okänt fel";
      toast({ title: "Kunde inte spara", description: msg, variant: "destructive" });
    },
  });

  const mobileTokenRef = useRef<string | null>(null);

  const getMobileToken = useCallback(async (): Promise<string> => {
    if (mobileTokenRef.current) return mobileTokenRef.current;
    const res = await apiRequest("POST", "/api/field/mobile-token", { resourceId });
    const data = await res.json();
    mobileTokenRef.current = data.token;
    return data.token;
  }, [resourceId]);

  const mobileApiCall = useCallback(async (method: string, url: string, body?: unknown) => {
    const extractError = async (response: Response): Promise<string> => {
      // Servern svarar konsekvent med { error: "..." } (svensk text) på 4xx/5xx,
      // t.ex. 413 "Bilden är för stor. Maxgräns är 15 MB." vid uppladdning.
      // Surfacea det meddelandet i stället för "Mobile API error: 413".
      try {
        const text = await response.text();
        if (text) {
          try {
            const json = JSON.parse(text);
            if (json && typeof json.error === "string" && json.error.trim()) {
              return json.error;
            }
          } catch {
            return text;
          }
        }
      } catch {}
      return `Mobile API error: ${response.status}`;
    };

    const token = await getMobileToken();
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(url, options);
    if (res.status === 401) {
      mobileTokenRef.current = null;
      const newToken = await getMobileToken();
      options.headers = { ...options.headers as Record<string, string>, "Authorization": `Bearer ${newToken}` };
      const retry = await fetch(url, options);
      if (!retry.ok) throw new Error(await extractError(retry));
      return retry;
    }
    if (!res.ok) throw new Error(await extractError(res));
    return res;
  }, [getMobileToken]);

  const uploadChangeRequestPhoto = useCallback(async (
    file: File,
    setBusy: (b: boolean) => void,
    setPhoto: (url: string | null) => void,
  ) => {
    if (!isAcceptableImage(file)) {
      toast({ ...IMAGE_REJECT_TOAST, variant: "destructive", duration: 6000 });
      return;
    }
    if (!isWithinFieldPhotoSizeLimit(file)) {
      toast({ ...FIELD_PHOTO_TOO_LARGE_TOAST, variant: "destructive", duration: 6000 });
      return;
    }
    const effectiveContentType = getEffectiveContentType(file);
    setBusy(true);
    try {
      // mobileApiCall extraherar nu serverns { error } så att t.ex. 413
      // "Bilden är för stor. Maxgräns är 15 MB." surfaceas i toasten.
      // Skicka contentType + size så att servern kan returnera 413 tidigt.
      const uploadRes = await mobileApiCall(
        "POST",
        "/api/mobile/customer-change-requests/upload-photo",
        { contentType: effectiveContentType, size: file.size },
      );
      const { uploadURL, objectPath } = await uploadRes.json();
      const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": effectiveContentType } });
      if (!putRes.ok) throw new Error("Uppladdning misslyckades");
      // Confirm-rutten raderar filen och returnerar 4xx + svenskt error
      // om den faktiska blob-storleken översteg gränsen — visa det som-is.
      const confirmRes = await mobileApiCall("POST", "/api/mobile/customer-change-requests/confirm-photo", { objectPath });
      const { downloadURL } = await confirmRes.json();
      setPhoto(downloadURL || objectPath);
      toast({ title: "Foto uppladdat" });
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Kunde inte ladda upp bilden",
        description: error instanceof Error ? error.message : "Försök igen",
        variant: "destructive",
        duration: 6000,
      });
    } finally {
      setBusy(false);
    }
  }, [mobileApiCall, toast]);

  const [dismissedInstallBanner, setDismissedInstallBanner] = useState(() => {
    try {
      return localStorage.getItem("traivo_pwa_install_dismissed") === "true";
    } catch {
      return false;
    }
  });

  const handleDismissInstallBanner = () => {
    setDismissedInstallBanner(true);
    try {
      localStorage.setItem("traivo_pwa_install_dismissed", "true");
    } catch {
      // localStorage not available
    }
  };

  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();

  const handleNotificationRef = useRef<((notification: Notification) => void) | null>(null);
  
  handleNotificationRef.current = (notification: Notification) => {
    const iconMap: Record<string, "default" | "destructive"> = {
      job_assigned: "default",
      job_updated: "default", 
      schedule_changed: "default",
      priority_changed: "default",
      job_cancelled: "destructive",
    };
    
    toast({
      title: notification.title,
      description: notification.message,
      variant: iconMap[notification.type] || "default",
    });

    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });

    if ("vibrate" in navigator) {
      navigator.vibrate(200);
    }
  };

  const handleNotification = useCallback((notification: Notification) => {
    handleNotificationRef.current?.(notification);
  }, []);

  const { notifications, unreadCount, isConnected, markAsRead } = useNotifications({
    resourceId: resourceId || "",
    onNotification: handleNotification,
    autoConnect: !!resourceId,
  });

  const handleOpenNotificationsPanel = () => {
    setShowNotificationsPanel(!showNotificationsPanel);
    if (!showNotificationsPanel) {
      notifications.filter(n => !n.read).forEach(n => markAsRead(n.id));
    }
  };

  const { isOnline, cacheWorkOrders } = useOfflineSupport({
    onOffline: () => {
      toast({
        title: "Du är offline",
        description: "Dagens jobb är cachade och tillgängliga.",
        variant: "destructive",
      });
    },
    onOnline: () => {
      toast({
        title: "Ansluten igen",
        description: "Synkroniserar data...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });

  const { 
    isSyncing, 
    pendingChanges, 
    lastSyncAt, 
    syncNow,
    queueStatusUpdate,
    savePhoto,
  } = useOfflineData({ resourceId, autoSync: true });

  const { scrollContainerRef, isRefreshing, pullDistance, shouldTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Uppdaterat", description: "Schemat har uppdaterats." });
    },
  });

  useEffect(() => {
    if (jobStarted && startTime && !isOnBreak) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime.getTime()) / 1000) - breakElapsedSeconds);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [jobStarted, startTime, isOnBreak, breakElapsedSeconds]);

  useEffect(() => {
    if (isOnBreak && breakStartTime) {
      breakTimerRef.current = setInterval(() => {
        setBreakElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (breakTimerRef.current) {
        clearInterval(breakTimerRef.current);
        breakTimerRef.current = null;
      }
    }
    return () => {
      if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    };
  }, [isOnBreak, breakStartTime]);

  const [gpsActive, setGpsActive] = useState(false);
  const gpsWatchRef = useRef<number | null>(null);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number; speed: number; heading: number; accuracy: number } | null>(null);
  const statusRef = useRef({ isOnBreak, jobStarted, selectedJobId });

  useEffect(() => {
    statusRef.current = { isOnBreak, jobStarted, selectedJobId };
  }, [isOnBreak, jobStarted, selectedJobId]);

  const sendPositionUpdate = useCallback(async () => {
    const pos = lastPositionRef.current;
    if (!pos || !resourceId) return;
    const { isOnBreak: brk, jobStarted: started, selectedJobId: jobId } = statusRef.current;
    const currentStatus = brk ? "break" : started ? "on_site" : "traveling";
    try {
      await fetch("/api/resources/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          latitude: pos.lat,
          longitude: pos.lng,
          speed: pos.speed,
          heading: pos.heading,
          accuracy: pos.accuracy,
          status: currentStatus,
          workOrderId: jobId || undefined,
        }),
      });
    } catch {
    }
  }, [resourceId]);

  useEffect(() => {
    if (!resourceId || !navigator.geolocation) return;

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastPositionRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed || 0,
          heading: position.coords.heading || 0,
          accuracy: position.coords.accuracy || 0,
        };
        setGpsActive(true);
      },
      () => {
        setGpsActive(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    sendPositionUpdate();
    gpsIntervalRef.current = setInterval(sendPositionUpdate, 15000);

    return () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
        gpsIntervalRef.current = null;
      }
    };
  }, [resourceId, sendPositionUpdate]);

  useEffect(() => {
    sendPositionUpdate();
  }, [isOnBreak, jobStarted, selectedJobId, sendPositionUpdate]);

  const notifiedOrdersRef = useRef<Set<string>>(new Set());

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const { data: workOrders = [], isLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
    refetchInterval: 30000, // Poll every 30 seconds for new jobs
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: weatherData } = useQuery<{ temperature: number; description: string; windSpeed: number }>({
    queryKey: ["/api/weather/today"],
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    if (workOrders.length > 0) {
      cacheWorkOrders(workOrders);
    }
  }, [workOrders, cacheWorkOrders]);

  const objectIdsNeeded = useMemo(() => {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    return workOrders
      .filter(wo => {
        if (!wo.scheduledDate) return false;
        if (resourceId && wo.resourceId !== resourceId) return false;
        const scheduled = new Date(wo.scheduledDate);
        return scheduled >= todayStart && scheduled <= todayEnd;
      })
      .map(wo => wo.objectId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }, [workOrders, resourceId]);

  const { data: objects = [] } = useObjectsByIds(objectIdsNeeded);
  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const today = new Date();
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);

  const todayJobs = workOrders.filter(wo => {
    if (!wo.scheduledDate) return false;
    if (resourceId && wo.resourceId !== resourceId) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= todayStart && scheduled <= todayEnd && wo.orderStatus !== "utford";
  }).sort((a, b) => {
    const timeA = a.scheduledStartTime || "00:00";
    const timeB = b.scheduledStartTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  const { data: dependencyData = {} } = useQuery<Record<string, { dependsOn: Array<{ parentId: string; type: string; completed: boolean }>; isLocked: boolean; isDependentTask: boolean; routeSequence: number | null }>>({
    queryKey: ["/api/field-worker/dependency-info"],
    queryFn: async () => {
      const ids = todayJobs.map(j => j.id);
      if (ids.length === 0) return {};
      const results: Record<string, any> = {};
      const dateStr = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/field-worker/tasks?date=${dateStr}${resourceId ? `&resourceId=${resourceId}` : ''}`);
      if (res.ok) {
        const tasks = await res.json();
        for (const t of tasks) {
          results[t.id] = { dependsOn: t.dependsOn || [], isLocked: t.isLocked || false, isDependentTask: t.isDependentTask || false, routeSequence: t.routeSequence ?? null };
        }
      }
      return results;
    },
    enabled: todayJobs.length > 0,
    refetchInterval: 30000,
  });

  // G1: ruttsekvens per uppgift (planerarens stopp-ordning) härledd ur dependency-svaret.
  const routeSeqMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const [id, d] of Object.entries(dependencyData)) {
      m.set(id, d.routeSequence ?? null);
    }
    return m;
  }, [dependencyData]);

  // Minimal FieldJobMeta för ren ruttsortering (compareByRoute läser bara sekvens + tid).
  const toRouteMeta = useCallback((job: WorkOrderWithObject): FieldJobMeta => ({
    id: job.id,
    routeSequence: routeSeqMap.get(job.id) ?? null,
    scheduledStartTime: job.scheduledStartTime ?? null,
    lat: null, lng: null, address: null, customerId: null, customerName: null, orderNumber: null, searchText: "",
  }), [routeSeqMap]);

  useEffect(() => {
    if (todayJobs.length === 0) return;
    const checkUpcoming = () => {
      const now = new Date();
      for (const job of todayJobs) {
        if (!job.scheduledStartTime || ["utford", "avbruten", "omojlig", "paborjad", "fakturerad"].includes(job.orderStatus)) continue;
        if (notifiedOrdersRef.current.has(job.id)) continue;
        const [h, m] = job.scheduledStartTime.split(":").map(Number);
        const scheduled = new Date(now);
        scheduled.setHours(h, m, 0, 0);
        const diffMs = scheduled.getTime() - now.getTime();
        const diffMin = diffMs / 60000;
        if (diffMin > 0 && diffMin <= 10) {
          notifiedOrdersRef.current.add(job.id);
          toast({
            title: `${job.title} börjar snart`,
            description: `Schemalagd kl ${job.scheduledStartTime} — om ${Math.ceil(diffMin)} min`,
          });
          if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        }
      }
    };
    checkUpcoming();
    const interval = setInterval(checkUpcoming, 30000);
    return () => clearInterval(interval);
  }, [todayJobs, toast]);


  const completedCount = workOrders.filter(wo => {
    if (!wo.scheduledDate) return false;
    if (resourceId && wo.resourceId !== resourceId) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= todayStart && scheduled <= todayEnd && wo.orderStatus === "utford";
  }).length;

  const selectedJob = selectedJobId ? workOrders.find(wo => wo.id === selectedJobId) : null;
  const selectedObject = selectedJob?.objectId ? objectMap.get(selectedJob.objectId) : null;
  const selectedCustomer = selectedJob ? customerMap.get(selectedJob.customerId) : null;
  const selectedJobMetadata = (selectedJob?.metadata as Record<string, unknown>) || {};
  const existingSignaturePath = (selectedJobMetadata.signaturePath as string) || null;

  interface MetadataArticleContext {
    articleId: string;
    articleName: string;
    articleNumber: string;
    isInfoCarrier: boolean;
    fetchMetadataLabel: string | null;
    fetchMetadataLabelFormat: string | null;
    fetchedValue: string | null;
    canUpdateMetadata: boolean;
    updateMetadataLabel: string | null;
    updateMetadataFormat: string | null;
    showPreviousValue: boolean;
    previousValue: string | null;
  }

  interface DependencyArticleContext {
    articleId: string;
    articleName: string;
    articleNumber: string;
    quantity: number;
    stockLocation: string | null;
    stockLatitude: number | null;
    stockLongitude: number | null;
    dependencyMinutesBefore: number | null;
  }

  interface OrderArticleContext {
    lineId: string;
    articleId: string;
    articleName: string;
    articleNumber: string | null;
    quantity: number;
    quantityUnit: string;
    quantityMode: string | null;
    hideQuantityInApp: boolean;
    editableQuantity?: boolean;
    shouldBeReturned?: boolean;
    hasStockLocation?: boolean;
    // Uppgiftslogik v1 (kolumn T): taget antal + härledd svinn/retur. quantity ovan
    // är fakturerat/levererat och rör aldrig. takenQuantity=null ⇒ ej registrerat än.
    takenQuantity?: number | null;
    wasteQuantity?: number;
    returnedQuantity?: number;
    quantityReconciliationNote?: string | null;
    takenQuantityEditable?: boolean;
    // Task #1316: lagerkälla för uttaget. takeFromMainStock = teknikerns sparade
    // val; stockSourceLocked = uttag redan draget från annan plats än huvudlagret.
    takeFromMainStock?: boolean;
    hasMainStockLocation?: boolean;
    stockSourceLocked?: boolean;
  }

  interface ShowMetadataFieldContext {
    articleId: string;
    articleName: string;
    metadataField: string;
    groupField?: string | null;
    clarification: string | null;
    canUpdate: boolean;
    currentValue: string | null;
    displayValue: string | null;
  }

  interface LeaveMetadataFieldContext {
    articleId: string;
    articleName: string;
    metadataField: string;
    groupField?: string | null;
    instruction: string | null;
    required: boolean;
    currentValue: string | null;
    displayValue: string | null;
  }

  const [metadataUpdates, setMetadataUpdates] = useState<Record<string, { value: string; status?: string; comment?: string; photo?: string }>>({});
  const [savingMetadata, setSavingMetadata] = useState<string | null>(null);
  // Ny modell "Visa och uppdatera metadata": Visa+får uppdatera (live-skriv) resp.
  // Lämna (samlas in och skickas vid slutförande). Lämna-värden keyas på fältnamn.
  const [showFieldValues, setShowFieldValues] = useState<Record<string, string>>({});
  const [leaveFieldValues, setLeaveFieldValues] = useState<Record<string, string>>({});
  // Redigerbart antal per orderrad (keyas på lineId). Tomt = visa serverns antal.
  const [quantityEdits, setQuantityEdits] = useState<Record<string, string>>({});
  const [savingQuantityLineId, setSavingQuantityLineId] = useState<string | null>(null);
  // Uppgiftslogik v1 (kolumn T): taget antal. Expansionspanel per orderrad med taget
  // antal + valfri anteckning. Rör ALDRIG det fakturerade antalet (line.quantity).
  const [expandedTakenLineId, setExpandedTakenLineId] = useState<string | null>(null);
  const [takenEdits, setTakenEdits] = useState<Record<string, string>>({});
  const [takenNoteEdits, setTakenNoteEdits] = useState<Record<string, string>>({});
  const [savingTakenLineId, setSavingTakenLineId] = useState<string | null>(null);
  // Task #1316: "ta från huvudlager"-val per orderrad (keyas på lineId).
  // undefined = visa serverns sparade val.
  const [mainStockEdits, setMainStockEdits] = useState<Record<string, boolean>>({});

  const { data: metadataContext } = useQuery<{ articles: MetadataArticleContext[]; dependencyArticles?: DependencyArticleContext[]; orderArticles?: OrderArticleContext[]; showMetadataFields?: ShowMetadataFieldContext[]; leaveMetadataFields?: LeaveMetadataFieldContext[] }>({
    queryKey: ["/api/mobile/tasks", selectedJobId, "metadata-context"],
    queryFn: async () => {
      if (!selectedJobId) return { articles: [], dependencyArticles: [] };
      const res = await mobileApiCall("GET", `/api/mobile/tasks/${selectedJobId}/metadata-context`);
      return res.json();
    },
    enabled: !!selectedJobId && view === "job",
    staleTime: 30000,
  });

  const handleMetadataUpdate = useCallback(async (articleId: string, metadataLabel: string, newValue: string, inspectionStatus?: string, inspectionComment?: string, inspectionPhoto?: string) => {
    if (!selectedJobId) return;
    setSavingMetadata(articleId);
    try {
      await mobileApiCall("POST", `/api/mobile/tasks/${selectedJobId}/metadata-update`, {
        articleId,
        metadataLabel,
        newValue,
        inspectionStatus,
        inspectionComment,
        inspectionPhoto,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/tasks", selectedJobId, "metadata-context"] });
      toast({ title: "Metadata uppdaterad", description: `${metadataLabel} = ${newValue}` });
    } catch (error) {
      toast({ title: "Kunde inte spara metadata", description: error instanceof Error ? error.message : "Försök igen", variant: "destructive" });
    } finally {
      setSavingMetadata(null);
    }
  }, [selectedJobId, mobileApiCall, toast]);

  // Redigerbart antal i fält: skriver tillbaka BÅDE orderraden och objektets antals-
  // metadatafält via dedikerad endpoint. Servern återupprättar all behörighet
  // (per_styck/matches_field, valt fält, aktiv artikel, ej dold, ej fakturalåst).
  const handleQuantityUpdate = useCallback(async (lineId: string, raw: string) => {
    if (!selectedJobId) return;
    const trimmed = (raw ?? "").trim().replace(",", ".");
    const qty = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(qty) || qty < 0) {
      toast({ title: "Ogiltigt antal", description: "Ange ett antal (0 eller mer).", variant: "destructive" });
      return;
    }
    setSavingQuantityLineId(lineId);
    try {
      await mobileApiCall("POST", `/api/mobile/tasks/${selectedJobId}/quantity-update`, { lineId, quantity: qty });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/tasks", selectedJobId, "metadata-context"] });
      setQuantityEdits((prev) => { const next = { ...prev }; delete next[lineId]; return next; });
      toast({ title: "Antal uppdaterat", description: `Nytt antal: ${Math.round(qty)}` });
    } catch (error) {
      toast({ title: "Kunde inte uppdatera antal", description: error instanceof Error ? error.message : "Försök igen", variant: "destructive" });
    } finally {
      setSavingQuantityLineId(null);
    }
  }, [selectedJobId, mobileApiCall, toast]);

  // Uppgiftslogik v1 (kolumn T): registrera taget/förbrukat antal per orderrad.
  // Servern härleder svinn/retur och rör aldrig det fakturerade antalet.
  const handleTakenQuantityUpdate = useCallback(async (lineId: string, raw: string, note: string, takeFromMainStock?: boolean) => {
    if (!selectedJobId) return;
    const trimmed = (raw ?? "").trim().replace(",", ".");
    const qty = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(qty) || qty < 0) {
      toast({ title: "Ogiltigt taget antal", description: "Ange ett antal (0 eller mer).", variant: "destructive" });
      return;
    }
    setSavingTakenLineId(lineId);
    try {
      await mobileApiCall("POST", `/api/mobile/tasks/${selectedJobId}/taken-quantity-update`, { lineId, takenQuantity: qty, note: note?.trim() || undefined, takeFromMainStock });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/tasks", selectedJobId, "metadata-context"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/tasks", selectedJobId, "quantity-events", lineId] });
      setTakenEdits((prev) => { const next = { ...prev }; delete next[lineId]; return next; });
      setTakenNoteEdits((prev) => { const next = { ...prev }; delete next[lineId]; return next; });
      setMainStockEdits((prev) => { const next = { ...prev }; delete next[lineId]; return next; });
      toast({ title: "Taget antal registrerat", description: `Taget: ${Math.round(qty)}` });
    } catch (error) {
      toast({ title: "Kunde inte registrera taget antal", description: error instanceof Error ? error.message : "Försök igen", variant: "destructive" });
    } finally {
      setSavingTakenLineId(null);
    }
  }, [selectedJobId, mobileApiCall, toast]);

  // Task #989: markera artikel "ej utlämnad / ska återtas" ⇒ skapa retur-uppgift till lager.
  const returnToWarehouseMutation = useMutation({
    mutationFn: async ({ articleId }: { articleId: string }) => {
      if (!selectedJobId) throw new Error("Ingen uppgift vald");
      const res = await mobileApiCall("POST", `/api/mobile/orders/${selectedJobId}/return-to-warehouse`, { articleId });
      return res.json() as Promise<{ created?: boolean; alreadyExists?: boolean; articleName?: string; stockLocation?: string | null }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/tasks", selectedJobId, "metadata-context"] });
      toast({
        title: data?.alreadyExists ? "Återtag redan registrerat" : "Återtag skapat",
        description: data?.articleName
          ? `${data.articleName} ska återtas till lager${data.stockLocation ? ` (${data.stockLocation})` : ""}`
          : "Retur-uppgift skapad",
      });
    },
    onError: (error) => {
      toast({
        title: "Kunde inte skapa återtag",
        description: error instanceof Error ? error.message : "Försök igen",
        variant: "destructive",
      });
    },
  });

  // Task #990: fält-korrigering av objektets position (tekniker på plats).
  const [correctingLocation, setCorrectingLocation] = useState(false);
  const correctLocationMutation = useMutation({
    mutationFn: async ({ objectId, latitude, longitude }: { objectId: string; latitude: number; longitude: number }) => {
      const res = await mobileApiCall("PATCH", `/api/mobile/objects/${objectId}/location`, { latitude, longitude });
      return res.json() as Promise<{ success?: boolean; addressUpdated?: Record<string, string> | null }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({
        title: "Position korrigerad",
        description: data?.addressUpdated
          ? "Objektets koordinater och adress uppdaterades."
          : "Objektets koordinater uppdaterades.",
      });
    },
    onError: (error) => {
      toast({
        title: "Kunde inte korrigera position",
        description: error instanceof Error ? error.message : "Försök igen",
        variant: "destructive",
      });
    },
  });

  const handleCorrectObjectLocation = useCallback((objectId: string) => {
    if (!navigator.geolocation) {
      toast({ title: "GPS otillgängligt", description: "Enheten saknar platstjänster.", variant: "destructive" });
      return;
    }
    setCorrectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCorrectingLocation(false);
        correctLocationMutation.mutate({
          objectId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (err) => {
        setCorrectingLocation(false);
        toast({
          title: "Kunde inte hämta position",
          description: err.message || "Tillåt platsåtkomst och försök igen.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }, [correctLocationMutation, toast]);

  // Task #1239: klump/stopp-medlemmarnas positioner + klumpens egna primära
  // navigeringsposition. Hämtas endast när ett jobb är valt; återanvänder
  // befintlig korrigerings-/GPS-mutation ovan per medlemsobjekt (ingen ombyggnad).
  const { data: stopPositions } = useQuery<{
    primary: { latitude: number | null; longitude: number | null; address: string | null } | null;
    members: Array<{ assignmentId: string; objectId: string | null; latitude: number | null; longitude: number | null; address: string | null }>;
  } | null>({
    queryKey: ["/api/work-orders", selectedJob?.id, "stop-positions"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/work-orders/${selectedJob!.id}/stop-positions`);
      return res.json();
    },
    enabled: !!selectedJob?.id,
  });

  const completeJobMutation = useMutation({
    mutationFn: async ({ id, signaturePath }: { id: string; signaturePath?: string }) => {
      const elapsed = Math.ceil(elapsedSeconds / 60);
      const job = workOrders.find(wo => wo.id === id);
      const existingMetadata = (job?.metadata as Record<string, unknown>) || {};
      const photos = (existingMetadata.photos as string[]) || [];
      const finalSignature = signaturePath || (existingMetadata.signaturePath as string) || undefined;
      
      const updatedMetadata = {
        ...existingMetadata,
        signaturePath: finalSignature,
        materials: materials.length > 0 ? materials : (existingMetadata.materials || []),
      };
      
      const selectedVehicle = completedVehicleId ? vehicles.find(v => v.id === completedVehicleId) : undefined;
      const participantIds = completedParticipantIds.length > 0
        ? completedParticipantIds
        : (resourceId ? [resourceId] : []);

      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        orderStatus: "utford",
        completedAt: new Date().toISOString(),
        actualDuration: elapsed,
        metadata: updatedMetadata,
        completedVehicleId: completedVehicleId,
        completedEquipmentId: completedEquipmentId,
        completedVehicleRegNo: selectedVehicle?.registrationNumber ?? null,
        completedParticipantIds: participantIds.length > 0 ? participantIds : null,
        leaveMetadataValues: leaveFieldValues,
      });

      if (job) {
        try {
          const customer = customerMap.get(job.customerId);
          const pdfBlob = await generateJobProtocol({
            workOrderId: job.id,
            title: job.title,
            objectName: job.objectName || undefined,
            objectAddress: job.objectAddress || undefined,
            customerName: customer?.name || undefined,
            scheduledDate: job.scheduledDate ? String(job.scheduledDate) : undefined,
            actualDuration: elapsed,
            photos,
            signaturePath: finalSignature,
            materials: materials.length > 0 ? materials : (existingMetadata.materials as MaterialItem[]) || [],
            status: "utford",
          });
          downloadBlob(pdfBlob, `protokoll-${job.id.slice(0, 8)}.pdf`);
        } catch (pdfErr) {
          console.error("PDF-generering misslyckades", pdfErr);
          toast({
            title: "Jobbet är klart",
            description: "Men protokollet kunde inte genereras automatiskt. Du kan ladda ner det senare.",
            variant: "destructive",
          });
        }
      }
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/work-orders"] });
      const previous = queryClient.getQueryData<WorkOrderWithObject[]>(["/api/work-orders"]);
      const elapsed = Math.ceil(elapsedSeconds / 60);
      queryClient.setQueryData<WorkOrderWithObject[]>(["/api/work-orders"], (old) => {
        if (!old) return old;
        return old.map((wo) =>
          wo.id === id
            ? {
                ...wo,
                orderStatus: "utford" as typeof wo.orderStatus,
                completedAt: new Date(),
                actualDuration: elapsed,
              }
            : wo,
        );
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/work-orders"], context.previous);
      }
      toast({
        title: "Kunde inte slutföra jobbet",
        description: "Försök igen om en stund.",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({ title: "Klart!", description: "Jobbet slutfört och protokoll genererat." });
      setJobStarted(false);
      setStartTime(null);
      setElapsedSeconds(0);
      setBreakElapsedSeconds(0);
      setIsOnBreak(false);
      setShowSignaturePanel(false);
      setCurrentSignature(null);
      setMaterials([]);
      setCompletedVehicleId(null);
      setCompletedEquipmentId(null);
      setCompletedParticipantIds([]);
      setJobNote("");
      setLeaveFieldValues({});
      setShowFieldValues({});
      setShowCompletedDialog(true);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const job = workOrders.find(wo => wo.id === id);
      const existingMetadata = (job?.metadata as Record<string, unknown>) || {};
      const existingNotes = (existingMetadata.fieldNotes as string[]) || [];
      
      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        metadata: {
          ...existingMetadata,
          fieldNotes: [...existingNotes, { text: note, timestamp: new Date().toISOString() }],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Anteckning sparad" });
      setJobNote("");
      setShowNotesPanel(false);
    },
  });

  const quickActionMutation = useMutation({
    mutationFn: async ({ orderId, actionType }: { orderId: string; actionType: string }) => {
      const response = await apiRequest("POST", "/api/quick-action", { orderId, actionType });
      return response.json();
    },
    onSuccess: (data: { success: boolean; actionLabel: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: data.actionLabel, description: "Snabbåtgärd registrerad och planerare notifierad." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte utföra snabbåtgärden", description: error.message, variant: "destructive" });
    },
  });

  const IMPOSSIBLE_TO_DEVIATION_TYPE: Record<string, string> = {
    locked_gate: "blocked_access",
    no_access: "blocked_access",
    wrong_address: "other",
    obstacle: "blocked_access",
    customer_absent: "customer_absent",
    weather: "other",
    equipment_issue: "equipment_issue",
    other: "other",
  };

  const markImpossibleMutation = useMutation({
    mutationFn: async ({ 
      id, 
      reason, 
      reasonText,
      photoUrl
    }: { 
      id: string; 
      reason: string; 
      reasonText?: string;
      photoUrl?: string;
    }) => {
      const deviationType = IMPOSSIBLE_TO_DEVIATION_TYPE[reason] || "other";
      const reasonLabel = IMPOSSIBLE_REASON_LABELS[reason as keyof typeof IMPOSSIBLE_REASON_LABELS] || reason;
      const gpsPos = lastPositionRef.current;

      await mobileApiCall("POST", `/api/mobile/orders/${id}/deviations`, {
        type: deviationType,
        description: `${reasonLabel}${reasonText ? `: ${reasonText}` : ""}`,
        photos: photoUrl ? [photoUrl] : [],
        latitude: gpsPos?.lat ?? undefined,
        longitude: gpsPos?.lng ?? undefined,
      });

      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        status: "omojlig",
        impossibleReason: reason,
        impossibleReasonText: reasonText || null,
        impossibleAt: new Date().toISOString(),
        impossibleBy: resourceId || null,
        impossiblePhotoUrl: photoUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ 
        title: "Order markerad som omöjlig", 
        description: "Avvikelserapport skapad automatiskt.",
      });
      setShowImpossibleDialog(false);
      setSelectedImpossibleReason(null);
      setImpossibleReasonText("");
      setImpossiblePhoto(null);
      setShowProblemPanel(false);
      setView("jobs");
      setSelectedJobId(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Kunde inte markera ordern som omöjlig", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const submitChangeRequestMutation = useMutation({
    mutationFn: async (data: {
      objectId: string;
      category: string;
      description: string;
      severity: string;
      photos?: string[];
      latitude?: number;
      longitude?: number;
    }) => {
      const res = await mobileApiCall("POST", "/api/mobile/customer-change-requests", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/customer-change-requests/mine"] });
      toast({
        title: "Kundrapport skickad",
        description: "Rapporten har registrerats och skickats till planeraren.",
      });
      setShowChangeRequestPanel(false);
      setChangeRequestCategory("");
      setChangeRequestDescription("");
      setChangeRequestSeverity("medium");
      setChangeRequestPhoto(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte skicka kundrapport",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const notifyCustomerMutation = useMutation({
    mutationFn: async ({ workOrderId, estimatedMinutes }: { workOrderId: string; estimatedMinutes?: number }) => {
      const response = await apiRequest("POST", `/api/notifications/technician-on-way/${workOrderId}`, {
        estimatedMinutes: estimatedMinutes || 30,
      });
      return response.json();
    },
    onSuccess: (data: { success: boolean; sent: number; message?: string }) => {
      if (data.success) {
        toast({ 
          title: "Kund notifierad", 
          description: data.message || `Notifiering skickad till ${data.sent} mottagare`,
        });
      } else {
        toast({ 
          title: "Notifiering ej skickad", 
          description: "Ingen e-postadress registrerad för kunden.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({ 
        title: "Kunde inte skicka notifiering till kund", 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const saveInspectionMutation = useMutation({
    mutationFn: async (items: Record<string, { status: string; issues: string[]; comment: string }>) => {
      const results = [];
      for (const [type, data] of Object.entries(items)) {
        if (data.status) {
          const res = await apiRequest("POST", "/api/inspection-metadata", {
            workOrderId: selectedJobId,
            objectId: selectedJob?.objectId,
            inspectionType: type,
            status: data.status,
            issues: data.issues,
            comment: data.comment || null,
            photoUrls: [],
            inspectedBy: resourceId || null,
          });
          results.push(await res.json());
        }
      }
      return results;
    },
    onSuccess: () => {
      toast({ title: "Besiktning sparad", description: "Besiktningsdata har registrerats." });
      setShowInspectionPanel(false);
      queryClient.invalidateQueries({ queryKey: ["/api/inspection-metadata"] });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara besiktning", description: error.message, variant: "destructive" });
    },
  });

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setView("job");
    setShowAiPanel(false);
    setShowProblemPanel(false);
    setMaterials([]);
    setCurrentSignature(null);
    setCompletedVehicleId(null);
    setCompletedEquipmentId(null);
    setCompletedParticipantIds([]);
  };

  const handleStartJob = () => {
    const existingMaterials = (selectedJobMetadata.materials as MaterialItem[]) || [];
    setMaterials(existingMaterials);
    setJobStarted(true);
    setStartTime(new Date());
    setElapsedSeconds(0);
  };

  const handleBack = () => {
    setView("jobs");
    setSelectedJobId(null);
    setJobStarted(false);
    setStartTime(null);
    setShowAiPanel(false);
    setShowProblemPanel(false);
  };

  const handleSelectImpossibleReason = (reason: string) => {
    setSelectedImpossibleReason(reason);
    setShowImpossibleDialog(true);
  };

  const handleConfirmImpossible = () => {
    if (selectedJob && selectedImpossibleReason) {
      markImpossibleMutation.mutate({
        id: selectedJob.id,
        reason: selectedImpossibleReason,
        reasonText: impossibleReasonText || undefined,
        photoUrl: impossiblePhoto || undefined,
      });
    }
  };

  const handleToggleBreak = () => {
    if (isOnBreak) {
      setIsOnBreak(false);
      toast({ title: "Rast avslutad", description: `Rastade i ${formatTime(breakElapsedSeconds)}` });
    } else {
      setIsOnBreak(true);
      setBreakStartTime(new Date());
      toast({ title: "Rast startad", description: "Jobbtimern är pausad" });
    }
  };

  const allTodayJobs = useMemo(() => {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    return workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      if (resourceId && wo.resourceId !== resourceId) return false;
      const scheduled = new Date(wo.scheduledDate);
      return scheduled >= dayStart && scheduled <= dayEnd;
    }).sort((a, b) => compareByRoute(toRouteMeta(a), toRouteMeta(b)));
  }, [workOrders, resourceId, toRouteMeta]);

  const handleNextJob = () => {
    setShowCompletedDialog(false);
    const currentIndex = allTodayJobs.findIndex(j => j.id === selectedJobId);
    const nextPendingJob = allTodayJobs.slice(currentIndex + 1).find(j => j.orderStatus !== "utford");
    if (nextPendingJob) {
      handleSelectJob(nextPendingJob.id);
    } else {
      setView("jobs");
      setSelectedJobId(null);
    }
  };

  const handleGoBackToJobs = () => {
    setShowCompletedDialog(false);
    setView("jobs");
    setSelectedJobId(null);
  };

  const getNextJob = () => {
    const currentIndex = allTodayJobs.findIndex(j => j.id === selectedJobId);
    return allTodayJobs.slice(currentIndex + 1).find(j => j.orderStatus !== "utford") || null;
  };

  const validateBeforeSigning = (job: WorkOrderWithObject, hasSignature: boolean): { field: string; label: string }[] => {
    const orderType = job.orderType || "service";
    const requiredFields = REQUIRED_FIELDS_BY_ORDER_TYPE[orderType] || REQUIRED_FIELDS_BY_ORDER_TYPE.default || [];
    const metadata = (job.metadata as Record<string, unknown>) || {};
    const photos = (metadata.photos as string[]) || [];
    const missing: { field: string; label: string }[] = [];

    for (const req of requiredFields) {
      switch (req.field) {
        case "description":
          if (!job.description && !job.notes && !(metadata.fieldNotes as unknown[])?.length) {
            missing.push(req);
          }
          break;
        case "photos":
          if (photos.length === 0) {
            missing.push(req);
          }
          break;
        case "signature":
          if (!hasSignature && !(metadata.signaturePath as string)) {
            missing.push(req);
          }
          break;
        case "materials":
          if (materials.length === 0 && !(metadata.materials as unknown[])?.length) {
            missing.push(req);
          }
          break;
        case "inspection":
          if (!Object.values(inspectionItems).some(i => i.status)) {
            missing.push(req);
          }
          break;
      }
    }
    return missing;
  };

  const handleCompleteWithValidation = (signaturePath?: string) => {
    if (!selectedJob) return;
    const sigPath = signaturePath || currentSignature || existingSignaturePath;
    const missing = validateBeforeSigning(selectedJob, !!sigPath);
    if (missing.length > 0) {
      setValidationMissingFields(missing);
      setShowValidationModal(true);
      return;
    }
    // Obligatoriska "lämna"-fält måste fyllas i (eller redan finnas på objektet).
    const missingLeave = (metadataContext?.leaveMetadataFields ?? []).filter(
      (f) => f.required
        && !(leaveFieldValues[f.metadataField] && leaveFieldValues[f.metadataField].trim())
        && !(f.currentValue && f.currentValue.trim()),
    );
    if (missingLeave.length > 0) {
      toast({
        title: "Obligatorisk information saknas",
        description: `Fyll i: ${missingLeave.map((f) => f.metadataField).join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    completeJobMutation.mutate({
      id: selectedJob.id,
      signaturePath: sigPath || undefined,
    });
  };

  const [travelDistances, setTravelDistances] = useState<Record<string, { distanceKm: number | null; travelMinutes: number | null }>>({});
  const lastDistanceFetchRef = useRef<number>(0);
  const lastFetchPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!lastPositionRef.current || !gpsActive || todayJobs.length === 0) return;
    const now = Date.now();
    if (now - lastDistanceFetchRef.current < 60_000) return;

    const pos = lastPositionRef.current;
    const prevPos = lastFetchPositionRef.current;
    if (prevPos && Object.keys(travelDistances).length > 0) {
      const dLat = Math.abs(pos.lat - prevPos.lat);
      const dLng = Math.abs(pos.lng - prevPos.lng);
      if (dLat < 0.001 && dLng < 0.001) return;
    }

    lastDistanceFetchRef.current = now;
    lastFetchPositionRef.current = { lat: pos.lat, lng: pos.lng };

    const destinations = todayJobs
      .filter(j => j.status !== "utford")
      .map(j => {
        const obj = objectMap.get(j.objectId ?? "");
        return {
          id: j.id,
          lat: obj?.latitude ?? j.taskLatitude,
          lng: obj?.longitude ?? j.taskLongitude,
        };
      })
      .filter(d => d.lat != null && d.lng != null);

    if (destinations.length === 0) return;

    fetch("/api/mobile/travel-times", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: pos.lat, longitude: pos.lng, destinations }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          const map: Record<string, { distanceKm: number | null; travelMinutes: number | null }> = {};
          for (const r of data.results) {
            map[r.id] = { distanceKm: r.distanceKm, travelMinutes: r.durationMinutes };
          }
          setTravelDistances(map);
        }
      })
      .catch(() => {});
  }, [todayJobs, objectMap, gpsActive, travelDistances]);

  const openNavigation = useCallback((lat: number, lng: number) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, "_blank");
    } else {
      window.location.href = `google.navigation:q=${lat},${lng}`;
      setTimeout(() => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, "_blank");
      }, 500);
    }
  }, []);

  const getNextPendingJob = useCallback(() => {
    if (todayJobs.length === 0) return null;
    const sorted = [...todayJobs].sort((a, b) => compareByRoute(toRouteMeta(a), toRouteMeta(b)));
    return sorted.find(j => j.orderStatus !== "utford") || null;
  }, [todayJobs, toRouteMeta]);

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case "urgent":
        return <Badge variant="destructive" className="text-[10px]"><Flag className="h-3 w-3 mr-0.5" />Brådskande</Badge>;
      case "high":
        return <Badge className="bg-chart-4/15 text-[10px]"><Flag className="h-3 w-3 mr-0.5" />Hög</Badge>;
      default:
        return null;
    }
  };

  // G1/G2/G3/G8/G9: berikade metadata för listkontrollerna (ruttsortering, plats-/
  // kundgruppering, fritextsök). Stop-numret är ruttpositionen och hålls stabilt
  // oavsett sök/gruppering så fältarbetaren känner igen "stopp 3" hela dagen.
  const jobMetas = useMemo<FieldJobMeta[]>(() => {
    return todayJobs.map(job => {
      const obj = job.objectId ? objectMap.get(job.objectId) : null;
      const customer = customerMap.get(job.customerId);
      const lat = (obj?.latitude as number | null | undefined) ?? job.taskLatitude ?? null;
      const lng = (obj?.longitude as number | null | undefined) ?? job.taskLongitude ?? null;
      const address = job.objectAddress || (obj?.address as string | null | undefined) || null;
      const objName = localizedObjectName(job.objectName, job.objectNameTranslations);
      const orderNumber = job.id ? job.id.slice(0, 8) : null;
      const metaValues = job.metadata
        ? Object.values(job.metadata as Record<string, unknown>)
            .map(v => (typeof v === "string" || typeof v === "number" ? String(v) : ""))
        : [];
      const searchText = [
        job.title, address, (obj?.city as string | null | undefined), objName,
        customer?.name, job.orderType, job.plannedNotes,
        job.objectAccessCode, job.objectKeyNumber, orderNumber, ...metaValues,
      ].filter(Boolean).join(" ").toLowerCase();
      return {
        id: job.id,
        routeSequence: routeSeqMap.get(job.id) ?? null,
        scheduledStartTime: job.scheduledStartTime ?? null,
        lat, lng, address,
        customerId: job.customerId ?? null,
        customerName: customer?.name ?? null,
        orderNumber,
        searchText,
      };
    });
  }, [todayJobs, objectMap, customerMap, routeSeqMap, localizedObjectName]);

  const routeSortedMetas = useMemo(() => sortByRoute(jobMetas), [jobMetas]);
  const stopNumberMap = useMemo(() => {
    const m = new Map<string, number>();
    routeSortedMetas.forEach((meta, i) => m.set(meta.id, i + 1));
    return m;
  }, [routeSortedMetas]);
  const filteredMetas = useMemo(() => filterBySearch(routeSortedMetas, jobSearch), [routeSortedMetas, jobSearch]);
  // Å5: platsgrupperingsradien är konfigurerbar (per enhet via localStorage,
  // i meter) med fallback till standardradien — ingen begravd magisk konstant.
  const locationGroupRadiusKm = useMemo(() => {
    const raw = typeof window !== "undefined"
      ? window.localStorage.getItem("traivo:locationGroupRadiusMeters")
      : null;
    const meters = raw != null ? parseFloat(raw) : NaN;
    return Number.isFinite(meters) && meters > 0
      ? meters / 1000
      : DEFAULT_LOCATION_GROUP_RADIUS_KM;
  }, []);
  const locationGroups = useMemo(() => groupByLocation(filteredMetas, locationGroupRadiusKm), [filteredMetas, locationGroupRadiusKm]);
  const customerGroups = useMemo(() => groupByCustomer(filteredMetas), [filteredMetas]);
  const orderGroups = useMemo(() => groupByOrderNumber(filteredMetas), [filteredMetas]);
  const jobById = useMemo(() => new Map(todayJobs.map(j => [j.id, j])), [todayJobs]);

  const renderJobCard = (job: WorkOrderWithObject) => {
    const stopNumber = stopNumberMap.get(job.id);
    return (
      <Card
        key={job.id}
        className={`hover-elevate active-elevate-2 cursor-pointer ${dependencyData[job.id]?.isLocked ? 'opacity-60 border-destructive/20 dark:border-destructive/80' : ''}`}
        onClick={() => {
          if (dependencyData[job.id]?.isLocked) {
            toast({ title: "Beroende ej klart", description: "Det finns olösta beroenden för detta jobb.", variant: "destructive" });
          }
          handleSelectJob(job.id);
        }}
        data-testid={`button-job-${job.id}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
              {stopNumber ?? "–"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{job.title}</p>
                  <span className="text-[10px] text-muted-foreground font-mono" data-testid={`text-ordernr-${job.id}`}>#{job.id.slice(0, 8)}</span>
                  {getPriorityBadge(job.priority)}
                  <TaskRoleBadge task={job} testIdSuffix={job.id} />
                  {dependencyData[job.id]?.isLocked && (
                    <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive gap-0.5">
                      <Lock className="h-3 w-3" />
                      Låst
                    </Badge>
                  )}
                  {dependencyData[job.id]?.isDependentTask && !dependencyData[job.id]?.isLocked && (
                    <Badge variant="outline" className="text-[10px] border-chart-2/30 text-chart-2 gap-0.5">
                      <Unlock className="h-3 w-3" />
                      Upplåst
                    </Badge>
                  )}
                </div>
                {job.scheduledStartTime && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    <Clock className="h-3 w-3 mr-1" />
                    {job.scheduledStartTime}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{job.objectAddress || localizedObjectName(job.objectName, job.objectNameTranslations)}</span>
              </div>
              {job.plannedNotes && (
                <div className="flex items-start gap-1.5 mt-1.5 p-1.5 rounded bg-chart-1/10 dark:bg-chart-1/15 border border-chart-1/20 dark:border-chart-1/80" data-testid={`planned-notes-preview-${job.id}`}>
                  <MessageSquare className="h-3 w-3 text-chart-1 shrink-0 mt-0.5" />
                  <span className="text-xs text-chart-1 line-clamp-2">{job.plannedNotes}</span>
                </div>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {job.estimatedDuration && (
                  <span className="text-xs text-muted-foreground">
                    {job.estimatedDuration} min
                  </span>
                )}
                {travelDistances[job.id] && travelDistances[job.id].distanceKm != null && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5" data-testid={`travel-info-${job.id}`}>
                    <NavigationIcon className="h-2.5 w-2.5" />
                    {travelDistances[job.id].distanceKm} km · {travelDistances[job.id].travelMinutes} min
                  </span>
                )}
                {(job.objectAccessCode || job.objectKeyNumber) && (
                  <Badge variant="outline" className="text-[10px] gap-0.5">
                    <Key className="h-2.5 w-2.5" />
                    Kod
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Laddar schema...</p>
      </div>
    );
  }

  if (view === "report") {
    return (
      <DayReport
        workOrders={workOrders}
        resourceId={resourceId || ""}
        onBack={() => setView("jobs")}
      />
    );
  }

  if (view === "todo") {
    return (
      <FieldTodoList onBack={() => setView("jobs")} />
    );
  }

  if (view === "outbox") {
    return (
      <OutboxCenter onBack={() => setView("jobs")} />
    );
  }

  if (view === "timeline") {
    return (
      <TimelineView onBack={() => setView("jobs")} mobileApiCall={mobileApiCall} />
    );
  }

  if (view === "stock") {
    return (
      <VehicleStockView onBack={() => setView("jobs")} mobileApiCall={mobileApiCall} />
    );
  }

  if (view === "job" && selectedJob) {
    // Etapp 5: åtkomstinfo bor i metadata-systemet; objektkolumnen är borttagen.
    const accessInfo = {} as {
      gateCode?: string;
      keyLocation?: string;
      parking?: string;
      specialInstructions?: string;
    };

    return (
      <div className="flex flex-col h-full bg-background">
        <FieldAIAssistant 
          isOpen={showAiPanel}
          onClose={() => setShowAiPanel(false)}
          jobContext={{
            jobTitle: selectedJob.title,
            objectName: selectedJob.objectName ?? undefined,
            objectAddress: selectedJob.objectAddress ?? undefined,
          }}
        />
        
        <div className="flex items-center gap-3 p-4 border-b bg-card">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleBack}
            data-testid="button-back-from-job"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold truncate">{selectedJob.title}</h1>
              {getPriorityBadge(selectedJob.priority)}
              <OrderStatusBadge status={selectedJob.orderStatus} />
              <TaskRoleBadge task={selectedJob} testIdSuffix={selectedJob.id} />
            </div>
            <p className="text-sm text-muted-foreground truncate">{localizedObjectName(selectedJob.objectName, selectedJob.objectNameTranslations)}</p>
          </div>
          <div className="flex items-center gap-2">
            {isOnBreak && (
              <Badge className="bg-chart-4/15 animate-pulse font-mono text-sm gap-1">
                <Coffee className="h-3 w-3" />
                Rast
              </Badge>
            )}
            {jobStarted && (
              <Badge variant="secondary" className="font-mono text-base gap-1">
                <Timer className="h-4 w-4" />
                {formatTime(elapsedSeconds)}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setFocusMode(!focusMode)}
              title={focusMode ? "Visa detaljvy" : "Aktivera fokusläge"}
              data-testid="button-toggle-focus-mode"
            >
              {focusMode ? <Eye className="h-4 w-4 text-chart-1" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <FocusTimeline currentStep={getTimelineStep(jobStarted, elapsedSeconds, selectedJob.orderStatus)} />

          {focusMode && (
            <FocusCTA
              jobStarted={jobStarted}
              hasAddress={!!selectedJob.objectAddress}
              onStart={handleStartJob}
              onNavigate={() => {
                const primary = stopPositions?.primary;
                if (primary?.latitude != null && primary?.longitude != null) {
                  window.open(`https://maps.google.com?q=${primary.latitude},${primary.longitude}`);
                  if (selectedJobId) {
                    const pos = lastPositionRef.current;
                    fetch(`/api/work-orders/${selectedJobId}/auto-eta-sms`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        technicianLat: pos?.lat || null,
                        technicianLng: pos?.lng || null,
                      }),
                    }).then(r => r.json()).then(data => {
                      if (data.success && !data.skipped) {
                        toast({ title: "Kund-SMS skickat", description: `ETA: ca ${data.etaMinutes} min` });
                      }
                    }).catch(() => {});
                  }
                } else if (selectedJob.objectAddress) {
                  window.open(`https://maps.google.com?q=${encodeURIComponent(selectedJob.objectAddress + ", " + (selectedObject?.city || ""))}`);
                  if (selectedJobId) {
                    const pos = lastPositionRef.current;
                    fetch(`/api/work-orders/${selectedJobId}/auto-eta-sms`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        technicianLat: pos?.lat || null,
                        technicianLng: pos?.lng || null,
                      }),
                    }).then(r => r.json()).then(data => {
                      if (data.success && !data.skipped) {
                        toast({ title: "Kund-SMS skickat", description: `ETA: ca ${data.etaMinutes} min` });
                      }
                    }).catch(() => {});
                  }
                }
              }}
              onReport={() => {
                setShowProblemPanel(!showProblemPanel);
                setShowAiPanel(false);
                setShowNotesPanel(false);
              }}
            />
          )}

          {selectedJob.plannedNotes && (
            <Card className="border-chart-1/20 dark:border-chart-1/80 bg-chart-1/10 dark:bg-chart-1/15" data-testid="card-planned-notes">
              <CardContent className="py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <MessageSquare className="h-4 w-4 text-chart-1" />
                  <span className="text-xs font-medium text-chart-1">Meddelande från planerare</span>
                </div>
                <p className="text-sm text-chart-1">{selectedJob.plannedNotes}</p>
              </CardContent>
            </Card>
          )}

          {selectedJob.objectId && (
            <Card data-testid="card-lineage">
              <CardContent className="py-3">
                <button
                  type="button"
                  onClick={() => setShowLineagePanel(v => !v)}
                  className="flex items-center justify-between w-full"
                  data-testid="button-toggle-lineage"
                >
                  <div className="flex items-center gap-1.5">
                    <Network className="h-4 w-4 text-chart-3" />
                    <span className="text-xs font-medium">Släktnamn & hierarki</span>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showLineagePanel ? "rotate-90" : ""}`} />
                </button>
                {showLineagePanel && (
                  <div className="mt-3">
                    <ObjectDisplayNames objectId={selectedJob.objectId} enabled />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {selectedJob.objectId && (
            <Card data-testid="card-correct-location">
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MapPin className="h-4 w-4 text-chart-2 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">Korrigera objektets position</p>
                      <p className="text-[11px] text-muted-foreground truncate">Sätt exakt position från din nuvarande plats.</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={correctingLocation || correctLocationMutation.isPending}
                    onClick={() => handleCorrectObjectLocation(selectedJob.objectId!)}
                    data-testid="button-correct-object-location"
                  >
                    {(correctingLocation || correctLocationMutation.isPending) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                    <span className="ml-1">Använd min position</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Task #1239: klumpstopp — visar alla medlemmars positioner + stoppets
              egna primära navigeringsposition samtidigt. Korrigering/GPS-fångst
              per position återanvänder den befintliga objekt-mutationen ovan. */}
          {stopPositions && stopPositions.members.length > 1 && (
            <Card data-testid="card-stop-positions">
              <CardContent className="py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MapPin className="h-4 w-4 text-chart-3 shrink-0" />
                    <p className="text-xs font-medium">Klumpstopp — {stopPositions.members.length} positioner</p>
                  </div>
                  {stopPositions.primary?.latitude != null && stopPositions.primary?.longitude != null && (
                    <Button
                      size="sm"
                      variant="default"
                      className="shrink-0"
                      onClick={() => {
                        window.open(`https://maps.google.com?q=${stopPositions.primary!.latitude},${stopPositions.primary!.longitude}`);
                      }}
                      data-testid="button-navigate-stop-primary"
                    >
                      <NavigationIcon className="h-4 w-4" />
                      <span className="ml-1">Navigera</span>
                    </Button>
                  )}
                </div>
                {stopPositions.primary?.address && (
                  <p className="text-[11px] text-muted-foreground">
                    Navigerar till stoppets gemensamma position: {stopPositions.primary.address}
                  </p>
                )}
                {(() => {
                  const mapPoints = stopPositions.members
                    .map((m, idx) => ({ ...m, idx }))
                    .filter((m) => m.latitude != null && m.longitude != null);
                  const primaryPoint = stopPositions.primary?.latitude != null && stopPositions.primary?.longitude != null
                    ? stopPositions.primary
                    : null;
                  const allPositions: Array<[number, number]> = [
                    ...(primaryPoint ? [[primaryPoint.latitude as number, primaryPoint.longitude as number] as [number, number]] : []),
                    ...mapPoints.map((m) => [m.latitude as number, m.longitude as number] as [number, number]),
                  ];
                  if (allPositions.length === 0) return null;
                  const center = allPositions[0];
                  return (
                    <div className="rounded overflow-hidden border h-56 w-full" data-testid="map-stop-positions">
                      <BaseMap center={center} zoom={16}>
                        <MapFitBounds positions={allPositions} padding={[40, 40]} />
                        {primaryPoint && (
                          <Marker
                            position={[primaryPoint.latitude as number, primaryPoint.longitude as number]}
                            icon={numberedDivIcon({ number: "P", color: "#1B4B6B", size: 30 })}
                          >
                            <Popup>
                              Stoppets primära position
                              {primaryPoint.address ? ` — ${primaryPoint.address}` : ""}
                            </Popup>
                          </Marker>
                        )}
                        {mapPoints.map((m) => (
                          <Marker
                            key={m.assignmentId}
                            position={[m.latitude as number, m.longitude as number]}
                            icon={dotDivIcon({ color: "#4A9B9B", size: 16 })}
                          >
                            <Popup>
                              Position {m.idx + 1}
                              {m.address ? ` — ${m.address}` : ""}
                            </Popup>
                          </Marker>
                        ))}
                      </BaseMap>
                    </div>
                  );
                })()}
                <div className="space-y-1.5">
                  {stopPositions.members.map((member, idx) => (
                    <div
                      key={member.assignmentId}
                      className="flex items-center justify-between gap-2 rounded border p-2"
                      data-testid={`row-stop-position-${member.assignmentId}`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium">Position {idx + 1}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {member.address || (member.latitude && member.longitude
                            ? `${member.latitude.toFixed(5)}, ${member.longitude.toFixed(5)}`
                            : "Ingen position ännu")}
                        </p>
                      </div>
                      {member.objectId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          disabled={correctingLocation || correctLocationMutation.isPending}
                          onClick={() => handleCorrectObjectLocation(member.objectId!)}
                          data-testid={`button-correct-stop-position-${member.assignmentId}`}
                        >
                          {(correctingLocation || correctLocationMutation.isPending) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MapPin className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {focusMode && <ExpandableDetail>
            {/* Access info shown early in focus mode if present */}
            {(selectedJob.objectAccessCode || selectedJob.objectKeyNumber || accessInfo.gateCode) && (
              <Card className="border-chart-4/20 dark:border-chart-4/80 bg-chart-4/10 dark:bg-chart-4/15">
                <CardContent className="py-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <DoorOpen className="h-4 w-4 text-chart-4" />
                    <span className="text-xs font-medium text-chart-4">Åtkomstinformation</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {(selectedJob.objectAccessCode || accessInfo.gateCode) && (
                      <div className="text-center p-2 bg-card dark:bg-background rounded border">
                        <p className="text-[10px] text-muted-foreground uppercase">Portkod</p>
                        <p className="text-2xl font-mono font-bold">{selectedJob.objectAccessCode || accessInfo.gateCode}</p>
                      </div>
                    )}
                    {selectedJob.objectKeyNumber && (
                      <div className="text-center p-2 bg-card dark:bg-background rounded border">
                        <p className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-1">
                          <Key className="h-3 w-3" />
                          Nyckel
                        </p>
                        <p className="text-2xl font-mono font-bold">{selectedJob.objectKeyNumber}</p>
                      </div>
                    )}
                  </div>
                  {accessInfo.keyLocation && (
                    <p className="text-xs text-muted-foreground mt-2">Nyckelplats: {accessInfo.keyLocation}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {selectedCustomer && (
              <Card className="border-chart-1/20 dark:border-chart-1/80 bg-chart-1/10 dark:bg-chart-1/15">
                <CardContent className="py-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <User className="h-4 w-4 text-chart-1" />
                    <span className="text-xs font-medium text-chart-1">Kontaktperson</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{selectedCustomer.name}</p>
                      {selectedCustomer.phone && (
                        <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                      )}
                    </div>
                    {selectedCustomer.phone && (
                      <Button size="icon" variant="outline" onClick={() => window.open(`tel:${selectedCustomer.phone}`)} data-testid="focus-button-call-contact">
                        <Phone className="h-4 w-4 text-chart-2" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedJob.objectAddress && (
              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Adress</p>
                  <p className="text-sm">{selectedJob.objectAddress}</p>
                  {selectedObject?.city && (
                    <p className="text-sm text-muted-foreground">{selectedObject.city}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {metadataContext && metadataContext.articles.length > 0 && (
              <p className="text-xs text-muted-foreground">Metadata-artiklar finns — växla till detaljvy för redigering.</p>
            )}
          </ExpandableDetail>}

          {!focusMode && metadataContext?.dependencyArticles && metadataContext.dependencyArticles.length > 0 && (
            <div className="space-y-2" data-testid="panel-dependency-stock">
              <div className="flex items-center gap-1.5 px-1">
                <Warehouse className="h-4 w-4 text-chart-4" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Lagerplats — hämta före jobbet</span>
              </div>
              {metadataContext.dependencyArticles.map(dep => (
                <Card key={dep.articleId} className="border-chart-4/20 dark:border-chart-4/80 bg-chart-4/5 dark:bg-chart-4/10" data-testid={`card-dependency-stock-${dep.articleId}`}>
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Package className="h-4 w-4 text-chart-4 shrink-0" />
                          <span className="text-sm font-medium truncate" data-testid={`text-dependency-name-${dep.articleId}`}>{dep.articleName}</span>
                        </div>
                        {(dep.quantity > 0 || dep.articleNumber) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {dep.quantity > 0 ? `${dep.quantity} st` : ""}{dep.quantity > 0 && dep.articleNumber ? " · " : ""}{dep.articleNumber || ""}
                          </p>
                        )}
                      </div>
                      {dep.dependencyMinutesBefore != null && (
                        <Badge variant="outline" className="text-[10px] gap-0.5 shrink-0 border-warning/40 text-warning">
                          <Clock className="h-3 w-3" />
                          {dep.dependencyMinutesBefore} min före
                        </Badge>
                      )}
                    </div>
                    {dep.stockLocation && (
                      <div className="flex items-center gap-1.5 text-sm" data-testid={`text-dependency-location-${dep.articleId}`}>
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{dep.stockLocation}</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {dep.stockLatitude != null && dep.stockLongitude != null && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-9 gap-1.5"
                          onClick={() => openNavigation(dep.stockLatitude!, dep.stockLongitude!)}
                          data-testid={`button-navigate-stock-${dep.articleId}`}
                        >
                          <NavigationIcon className="h-4 w-4" />
                          Navigera
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-9 gap-1.5"
                        onClick={() => {
                          const label = `Hämta ${dep.quantity > 0 ? dep.quantity + " st " : ""}${dep.articleName}${dep.stockLocation ? " @ " + dep.stockLocation : ""}`;
                          const added = addPersonalTodo(label);
                          toast({ title: added ? "Tillagd i kom ihåg" : "Finns redan i kom ihåg", description: label });
                        }}
                        data-testid={`button-remember-stock-${dep.articleId}`}
                      >
                        <ListTodo className="h-4 w-4" />
                        Lägg i kom ihåg
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* GAP-106: beställda artiklar med antal (read-only). För artiklar med fast/
              härlett antal (hideQuantityInApp) döljs antalet — det används ändå automatiskt
              vid klarmarkering. Inget redigerbart antalsfält visas i fältappen. */}
          {!focusMode && metadataContext?.orderArticles && metadataContext.orderArticles.length > 0 && (
            <Card className="border-chart-3/20 dark:border-chart-3/80 bg-chart-3/10 dark:bg-chart-3/15" data-testid="panel-order-articles">
              <CardContent className="py-3 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Wrench className="h-4 w-4 text-chart-3" />
                  <span className="text-xs font-medium text-chart-3">Beställda artiklar</span>
                </div>
                <div className="space-y-1.5">
                  {metadataContext.orderArticles.map(oa => (
                    <div
                      key={oa.lineId}
                      className="rounded border bg-card dark:bg-background p-2 space-y-2"
                      data-testid={`row-order-article-${oa.articleId}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium truncate">{oa.articleName}</p>
                            {oa.shouldBeReturned && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-warning text-warning shrink-0"
                                data-testid={`badge-should-return-${oa.articleId}`}
                              >
                                Ska återtas
                              </Badge>
                            )}
                          </div>
                          {oa.articleNumber && (
                            <p className="text-[11px] text-muted-foreground truncate">{oa.articleNumber}</p>
                          )}
                        </div>
                        {oa.hideQuantityInApp ? (
                          <span className="shrink-0 text-xs text-muted-foreground" data-testid={`text-quantity-auto-${oa.articleId}`}>
                            Fast antal
                          </span>
                        ) : oa.editableQuantity ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              className="h-8 w-16 text-sm text-right tabular-nums"
                              value={quantityEdits[oa.lineId] ?? String(oa.quantity)}
                              onChange={(e) => setQuantityEdits((prev) => ({ ...prev, [oa.lineId]: e.target.value }))}
                              data-testid={`input-quantity-${oa.articleId}`}
                            />
                            <span className="text-xs text-muted-foreground">{oa.quantityUnit}</span>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 shrink-0"
                              disabled={
                                savingQuantityLineId === oa.lineId ||
                                (quantityEdits[oa.lineId] ?? String(oa.quantity)) === String(oa.quantity)
                              }
                              onClick={() => handleQuantityUpdate(oa.lineId, quantityEdits[oa.lineId] ?? String(oa.quantity))}
                              data-testid={`button-save-quantity-${oa.articleId}`}
                            >
                              {savingQuantityLineId === oa.lineId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                          </div>
                        ) : (
                          <span className="shrink-0 text-sm font-semibold tabular-nums" data-testid={`text-quantity-${oa.articleId}`}>
                            {oa.quantity} {oa.quantityUnit}
                          </span>
                        )}
                      </div>
                      {oa.shouldBeReturned && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-8 text-xs"
                          disabled={!oa.hasStockLocation || returnToWarehouseMutation.isPending}
                          onClick={() => returnToWarehouseMutation.mutate({ articleId: oa.articleId })}
                          data-testid={`button-return-warehouse-${oa.articleId}`}
                        >
                          <Warehouse className="h-3.5 w-3.5 mr-1.5" />
                          {oa.hasStockLocation ? "Återta till lager" : "Saknar lagerplats"}
                        </Button>
                      )}
                      {/* Uppgiftslogik v1 (kolumn T): taget/förbrukat antal. Rör ALDRIG
                          det fakturerade antalet (oa.quantity). Överskott bokförs som
                          svinn (förbrukning) eller retur till lager. */}
                      {(oa.takenQuantityEditable || oa.takenQuantity != null) && (
                        <div className="border-t pt-2 mt-1 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-[11px] text-muted-foreground">Taget antal</span>
                              {oa.takenQuantity != null && (
                                <span className="text-xs font-semibold tabular-nums" data-testid={`text-taken-quantity-${oa.articleId}`}>
                                  {oa.takenQuantity} {oa.quantityUnit}
                                </span>
                              )}
                            </div>
                            {oa.takenQuantityEditable && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px] shrink-0"
                                onClick={() => setExpandedTakenLineId((prev) => (prev === oa.lineId ? null : oa.lineId))}
                                data-testid={`button-toggle-taken-${oa.articleId}`}
                              >
                                {oa.takenQuantity != null ? "Ändra" : "Registrera"}
                                <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${expandedTakenLineId === oa.lineId ? "rotate-180" : ""}`} />
                              </Button>
                            )}
                          </div>
                          {oa.takenQuantity != null && ((oa.wasteQuantity ?? 0) > 0 || (oa.returnedQuantity ?? 0) > 0) && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(oa.wasteQuantity ?? 0) > 0 && (
                                <Badge variant="outline" className="text-[10px] border-warning text-warning" data-testid={`badge-waste-${oa.articleId}`}>
                                  Svinn: {oa.wasteQuantity} {oa.quantityUnit}
                                </Badge>
                              )}
                              {(oa.returnedQuantity ?? 0) > 0 && (
                                <Badge variant="outline" className="text-[10px] border-chart-4 text-chart-4" data-testid={`badge-returned-${oa.articleId}`}>
                                  Åter till lager: {oa.returnedQuantity} {oa.quantityUnit}
                                </Badge>
                              )}
                            </div>
                          )}
                          {oa.quantityReconciliationNote && expandedTakenLineId !== oa.lineId && (
                            <p className="text-[10px] text-muted-foreground italic truncate" data-testid={`text-taken-note-${oa.articleId}`}>
                              {oa.quantityReconciliationNote}
                            </p>
                          )}
                          {oa.takenQuantityEditable && expandedTakenLineId === oa.lineId && (
                            <div className="space-y-2 rounded bg-muted/50 p-2">
                              <p className="text-[10px] text-muted-foreground leading-snug">
                                Verkligt taget/förbrukat antal. Påverkar inte det fakturerade antalet ({oa.quantity} {oa.quantityUnit}). Överskott bokförs som {oa.shouldBeReturned ? "retur till lager" : "svinn"}.
                              </p>
                              <div className="flex items-center gap-1.5">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="any"
                                  className="h-8 flex-1 text-sm text-right tabular-nums"
                                  value={takenEdits[oa.lineId] ?? (oa.takenQuantity != null ? String(oa.takenQuantity) : String(oa.quantity))}
                                  onChange={(e) => setTakenEdits((prev) => ({ ...prev, [oa.lineId]: e.target.value }))}
                                  data-testid={`input-taken-quantity-${oa.articleId}`}
                                />
                                <span className="text-xs text-muted-foreground shrink-0">{oa.quantityUnit}</span>
                              </div>
                              <Input
                                type="text"
                                className="h-8 text-sm"
                                placeholder="Anteckning (valfritt)"
                                value={takenNoteEdits[oa.lineId] ?? oa.quantityReconciliationNote ?? ""}
                                onChange={(e) => setTakenNoteEdits((prev) => ({ ...prev, [oa.lineId]: e.target.value }))}
                                data-testid={`input-taken-note-${oa.articleId}`}
                              />
                              {/* Task #1316: lagerkälla — teknikern kan tvinga uttag från
                                  huvudlagret (t.ex. när bilen är tom). Låst när uttag redan
                                  dragits från en annan plats (retur måste hamna rätt). */}
                              {oa.hasMainStockLocation && (
                                <label
                                  className={`flex items-center gap-2 text-[11px] ${oa.stockSourceLocked ? "text-muted-foreground/60" : "text-muted-foreground"}`}
                                  data-testid={`label-main-stock-${oa.articleId}`}
                                >
                                  <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 accent-primary"
                                    disabled={!!oa.stockSourceLocked}
                                    checked={mainStockEdits[oa.lineId] ?? oa.takeFromMainStock ?? false}
                                    onChange={(e) => setMainStockEdits((prev) => ({ ...prev, [oa.lineId]: e.target.checked }))}
                                    data-testid={`checkbox-main-stock-${oa.articleId}`}
                                  />
                                  <span>
                                    Ta från huvudlager
                                    {oa.stockSourceLocked ? " (låst — uttag redan draget från bilen)" : ""}
                                  </span>
                                </label>
                              )}
                              <Button
                                size="sm"
                                className="w-full h-8 text-xs"
                                disabled={savingTakenLineId === oa.lineId}
                                onClick={() => handleTakenQuantityUpdate(
                                  oa.lineId,
                                  takenEdits[oa.lineId] ?? (oa.takenQuantity != null ? String(oa.takenQuantity) : String(oa.quantity)),
                                  takenNoteEdits[oa.lineId] ?? oa.quantityReconciliationNote ?? "",
                                  mainStockEdits[oa.lineId] ?? oa.takeFromMainStock ?? false,
                                )}
                                data-testid={`button-save-taken-${oa.articleId}`}
                              >
                                {savingTakenLineId === oa.lineId ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                                Registrera taget antal
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!focusMode && metadataContext && metadataContext.articles.length > 0 && (
            /* Detail view metadata - only shown when focus mode is off */
            <div className="space-y-2" data-testid="panel-metadata-context">
              {metadataContext.articles.filter(a => a.isInfoCarrier).map(article => (
                <Card key={article.articleId} className="border-chart-5/20 dark:border-chart-5/80 bg-chart-5/10 dark:bg-chart-5/15" data-testid={`card-info-carrier-${article.articleId}`}>
                  <CardContent className="py-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <CircleDot className="h-4 w-4 text-chart-5" />
                      <span className="text-xs font-medium text-chart-5">{article.articleName}</span>
                    </div>
                    {article.fetchedValue && (
                      <p className="text-sm font-medium">{article.fetchMetadataLabel}: {article.fetchedValue}</p>
                    )}
                  </CardContent>
                </Card>
              ))}

              {metadataContext.articles.filter(a => !a.isInfoCarrier && (a.fetchMetadataLabel || a.canUpdateMetadata)).map(article => (
                <Card key={article.articleId} className="border-chart-2/20 dark:border-chart-2/80 bg-chart-2/10 dark:bg-chart-2/15" data-testid={`card-metadata-${article.articleId}`}>
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Database className="h-4 w-4 text-chart-2" />
                      <span className="text-xs font-medium text-chart-2">{article.articleName}</span>
                    </div>

                    {article.fetchedValue !== null && (
                      <div className="flex items-center justify-between bg-card dark:bg-background rounded border p-2">
                        <span className="text-xs text-muted-foreground">{article.fetchMetadataLabel}</span>
                        <span className="text-sm font-medium">{article.fetchedValue}</span>
                      </div>
                    )}

                    {article.showPreviousValue && article.previousValue !== null && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
                        <span>Föregående värde:</span>
                        <span className="font-mono">{article.previousValue}</span>
                      </div>
                    )}

                    {article.canUpdateMetadata && article.updateMetadataLabel && (
                      <div className="space-y-2">
                        {(article.updateMetadataFormat === "ok_ej_ok") ? (
                          <div className="space-y-2">
                            <Select
                              value={metadataUpdates[article.articleId]?.status || ""}
                              onValueChange={(v) => {
                                setMetadataUpdates(prev => ({
                                  ...prev,
                                  [article.articleId]: { ...prev[article.articleId], value: v, status: v }
                                }));
                                if (v === "OK") {
                                  handleMetadataUpdate(article.articleId, article.updateMetadataLabel!, v, v);
                                }
                              }}
                            >
                              <SelectTrigger className="h-10" data-testid={`select-inspection-${article.articleId}`}>
                                <SelectValue placeholder="Välj status..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="OK">
                                  <span className="flex items-center gap-2 text-chart-2 font-medium">
                                    <CheckCircle className="h-4 w-4" /> OK
                                  </span>
                                </SelectItem>
                                <SelectItem value="EJ_OK">
                                  <span className="flex items-center gap-2 text-destructive font-medium">
                                    <AlertTriangle className="h-4 w-4 text-warning" /> EJ OK
                                  </span>
                                </SelectItem>
                              </SelectContent>
                            </Select>

                            {metadataUpdates[article.articleId]?.status === "EJ_OK" && (
                              <div className="space-y-2 pl-2 border-l-2 border-destructive/30">
                                <Textarea
                                  placeholder="Beskriv avvikelsen..."
                                  value={metadataUpdates[article.articleId]?.comment || ""}
                                  onChange={(e) => setMetadataUpdates(prev => ({
                                    ...prev,
                                    [article.articleId]: { ...prev[article.articleId], comment: e.target.value }
                                  }))}
                                  className="text-sm"
                                  rows={2}
                                  data-testid={`textarea-inspection-comment-${article.articleId}`}
                                />
                                <div className="space-y-1">
                                  {metadataUpdates[article.articleId]?.photo ? (
                                    <div className="relative">
                                      <img
                                        src={metadataUpdates[article.articleId].photo}
                                        alt="Avvikelsefoto"
                                        className="w-full h-24 object-cover rounded border"
                                      />
                                      <Button
                                        size="icon"
                                        variant="destructive"
                                        className="absolute top-1 right-1 h-6 w-6"
                                        onClick={() => setMetadataUpdates(prev => ({
                                          ...prev,
                                          [article.articleId]: { ...prev[article.articleId], photo: undefined }
                                        }))}
                                      >
                                        <X className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <label className="cursor-pointer">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="w-full gap-2"
                                        asChild
                                      >
                                        <span>
                                          <Camera className="h-4 w-4" />
                                          Lägg till foto
                                        </span>
                                      </Button>
                                      <input
                                        type="file"
                                        accept="image/*"
                                        capture="environment"
                                        className="hidden"
                                        data-testid={`input-inspection-photo-${article.articleId}`}
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          const reader = new FileReader();
                                          reader.onload = () => {
                                            setMetadataUpdates(prev => ({
                                              ...prev,
                                              [article.articleId]: { ...prev[article.articleId], photo: reader.result as string }
                                            }));
                                          };
                                          reader.readAsDataURL(file);
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="w-full"
                                  disabled={savingMetadata === article.articleId}
                                  onClick={() => {
                                    const update = metadataUpdates[article.articleId];
                                    handleMetadataUpdate(
                                      article.articleId,
                                      article.updateMetadataLabel!,
                                      "EJ OK",
                                      "EJ_OK",
                                      update?.comment,
                                      update?.photo
                                    );
                                  }}
                                  data-testid={`button-save-inspection-${article.articleId}`}
                                >
                                  {savingMetadata === article.articleId ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  ) : (
                                    <Send className="h-4 w-4 mr-1" />
                                  )}
                                  Spara avvikelse
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Input
                              placeholder={`Ange ${article.updateMetadataLabel}...`}
                              value={metadataUpdates[article.articleId]?.value || ""}
                              onChange={(e) => setMetadataUpdates(prev => ({
                                ...prev,
                                [article.articleId]: { ...prev[article.articleId], value: e.target.value }
                              }))}
                              className="text-sm h-9"
                              data-testid={`input-metadata-${article.articleId}`}
                            />
                            <Button
                              size="sm"
                              className="h-9"
                              disabled={savingMetadata === article.articleId || !metadataUpdates[article.articleId]?.value}
                              onClick={() => {
                                const val = metadataUpdates[article.articleId]?.value;
                                if (val) handleMetadataUpdate(article.articleId, article.updateMetadataLabel!, val);
                              }}
                              data-testid={`button-save-metadata-${article.articleId}`}
                            >
                              {savingMetadata === article.articleId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!focusMode && metadataContext && (((metadataContext.showMetadataFields?.length ?? 0) > 0) || ((metadataContext.leaveMetadataFields?.length ?? 0) > 0)) && (
            <div className="space-y-2" data-testid="panel-show-leave-metadata">
              {(metadataContext.showMetadataFields ?? []).map((f) => (
                <Card key={`show-${f.articleId}-${f.metadataField}`} className="border-chart-2/20 dark:border-chart-2/80 bg-chart-2/10 dark:bg-chart-2/15" data-testid={`card-show-metadata-${f.articleId}-${f.metadataField}`}>
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Database className="h-4 w-4 text-chart-2" />
                      <span className="text-xs font-medium text-chart-2">{f.metadataField}</span>
                    </div>
                    {f.clarification && (
                      <p className="text-xs text-muted-foreground">{f.clarification}</p>
                    )}
                    <div className="flex items-center justify-between bg-card dark:bg-background rounded border p-2">
                      <span className="text-xs text-muted-foreground">Nuvarande värde</span>
                      <span className="text-sm font-medium" data-testid={`text-show-metadata-value-${f.articleId}-${f.metadataField}`}>{f.displayValue ?? f.currentValue ?? "—"}</span>
                    </div>
                    {f.canUpdate && (
                      <div className="flex gap-2">
                        <Input
                          placeholder={`Uppdatera ${f.metadataField}...`}
                          value={showFieldValues[`${f.articleId}::${f.metadataField}`] ?? ""}
                          onChange={(e) => setShowFieldValues((prev) => ({ ...prev, [`${f.articleId}::${f.metadataField}`]: e.target.value }))}
                          className="text-sm h-9"
                          data-testid={`input-show-metadata-${f.articleId}-${f.metadataField}`}
                        />
                        <Button
                          size="sm"
                          className="h-9"
                          disabled={savingMetadata === f.articleId || !showFieldValues[`${f.articleId}::${f.metadataField}`]}
                          onClick={() => {
                            const v = showFieldValues[`${f.articleId}::${f.metadataField}`];
                            if (v) handleMetadataUpdate(f.articleId, f.metadataField, v);
                          }}
                          data-testid={`button-save-show-metadata-${f.articleId}-${f.metadataField}`}
                        >
                          {savingMetadata === f.articleId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {(metadataContext.leaveMetadataFields ?? []).map((f) => (
                <Card key={`leave-${f.articleId}-${f.metadataField}`} className="border-chart-3/20 dark:border-chart-3/80 bg-chart-3/10 dark:bg-chart-3/15" data-testid={`card-leave-metadata-${f.articleId}-${f.metadataField}`}>
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <ClipboardCheck className="h-4 w-4 text-chart-3" />
                      <span className="text-xs font-medium text-chart-3">{f.metadataField}</span>
                      {f.required && (
                        <Badge variant="outline" className="text-[10px]" data-testid={`badge-required-${f.articleId}-${f.metadataField}`}>Obligatorisk</Badge>
                      )}
                    </div>
                    {f.instruction && (
                      <p className="text-xs text-muted-foreground">{f.instruction}</p>
                    )}
                    {f.currentValue != null && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                        <span>Nuvarande:</span>
                        <span className="font-mono">{f.displayValue ?? f.currentValue}</span>
                      </div>
                    )}
                    <Input
                      placeholder={`Ange ${f.metadataField}...`}
                      value={leaveFieldValues[f.metadataField] ?? ""}
                      onChange={(e) => setLeaveFieldValues((prev) => ({ ...prev, [f.metadataField]: e.target.value }))}
                      className="text-sm h-9"
                      data-testid={`input-leave-metadata-${f.articleId}-${f.metadataField}`}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!focusMode && (selectedJob.objectAccessCode || selectedJob.objectKeyNumber || accessInfo.gateCode) && (
            <Card className="border-chart-4/20 dark:border-chart-4/80 bg-chart-4/10 dark:bg-chart-4/15">
              <CardContent className="py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <DoorOpen className="h-4 w-4 text-chart-4" />
                  <span className="text-xs font-medium text-chart-4">Åtkomstinformation</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(selectedJob.objectAccessCode || accessInfo.gateCode) && (
                    <div className="text-center p-2 bg-card dark:bg-background rounded border">
                      <p className="text-[10px] text-muted-foreground uppercase">Portkod</p>
                      <p className="text-2xl font-mono font-bold">{selectedJob.objectAccessCode || accessInfo.gateCode}</p>
                    </div>
                  )}
                  {selectedJob.objectKeyNumber && (
                    <div className="text-center p-2 bg-card dark:bg-background rounded border">
                      <p className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-1">
                        <Key className="h-3 w-3" />
                        Nyckel
                      </p>
                      <p className="text-2xl font-mono font-bold">{selectedJob.objectKeyNumber}</p>
                    </div>
                  )}
                </div>
                {accessInfo.keyLocation && (
                  <p className="text-xs text-muted-foreground mt-2">Nyckelplats: {accessInfo.keyLocation}</p>
                )}
              </CardContent>
            </Card>
          )}

          {!focusMode && selectedCustomer && (
            <Card className="border-chart-1/20 dark:border-chart-1/80 bg-chart-1/10 dark:bg-chart-1/15">
              <CardContent className="py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="h-4 w-4 text-chart-1" />
                  <span className="text-xs font-medium text-chart-1">Kontaktperson</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedCustomer.name}</p>
                    {selectedCustomer.phone && (
                      <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                    )}
                  </div>
                  {selectedCustomer.phone && (
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => window.open(`tel:${selectedCustomer.phone}`)}
                      data-testid="button-call-contact"
                    >
                      <Phone className="h-4 w-4 text-chart-2" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {!focusMode && <div className="grid grid-cols-3 gap-2">
            {selectedJob.objectAddress && (
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => {
                  window.open(`https://maps.google.com?q=${encodeURIComponent(selectedJob.objectAddress + ", " + (selectedObject?.city || ""))}`);
                  if (selectedJobId) {
                    const pos = lastPositionRef.current;
                    fetch(`/api/work-orders/${selectedJobId}/auto-eta-sms`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        technicianLat: pos?.lat || null,
                        technicianLng: pos?.lng || null,
                      }),
                    }).then(r => r.json()).then(data => {
                      if (data.success && !data.skipped) {
                        toast({ title: "Kund-SMS skickat", description: `ETA: ca ${data.etaMinutes} min` });
                      }
                    }).catch((err) => {
                      console.error("[auto-eta-sms] Error:", err);
                    });
                  }
                }}
                data-testid="button-navigate"
              >
                <NavigationIcon className="h-5 w-5 text-chart-1" />
                <span className="text-xs">Navigera</span>
              </Button>
            )}
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                if (selectedJobId) {
                  notifyCustomerMutation.mutate({ workOrderId: selectedJobId, estimatedMinutes: 30 });
                }
              }}
              disabled={notifyCustomerMutation.isPending || !selectedCustomer?.email}
              data-testid="button-notify-customer"
            >
              {notifyCustomerMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Mail className="h-5 w-5 text-chart-2" />
              )}
              <span className="text-xs">Meddela</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowAiPanel(!showAiPanel);
                setShowProblemPanel(false);
                setShowNotesPanel(false);
              }}
              data-testid="button-ask-ai"
            >
              <HelpCircle className="h-5 w-5 text-chart-5" />
              <span className="text-xs">AI-hjälp</span>
            </Button>
          </div>}

          {!focusMode && <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowNotesPanel(!showNotesPanel);
                setShowProblemPanel(false);
                setShowAiPanel(false);
              }}
              data-testid="button-add-note"
            >
              <MessageSquare className="h-5 w-5 text-chart-1" />
              <span className="text-xs">Anteckning</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowProblemPanel(!showProblemPanel);
                setShowAiPanel(false);
                setShowNotesPanel(false);
              }}
              data-testid="button-report-problem"
            >
              <AlertTriangle className="h-5 w-5 text-warning" />
              <span className="text-xs">Problem</span>
            </Button>
            {jobStarted && (
              <Button
                variant={isOnBreak ? "default" : "outline"}
                className={`h-auto py-3 flex-col gap-1 ${isOnBreak ? "bg-chart-4/15 hover:bg-chart-4/15" : ""}`}
                onClick={handleToggleBreak}
                data-testid="button-toggle-break"
              >
                {isOnBreak ? (
                  <>
                    <Play className="h-5 w-5" />
                    <span className="text-xs">Fortsätt</span>
                  </>
                ) : (
                  <>
                    <Coffee className="h-5 w-5 text-chart-4" />
                    <span className="text-xs">Rast</span>
                  </>
                )}
              </Button>
            )}
          </div>}

          {!focusMode && jobStarted && selectedJobId && (
            <Card className="border-chart-2/20 dark:border-chart-2/80 bg-chart-2/10 dark:bg-chart-2/15">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-chart-2" />
                  Snabbåtgärder
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex-col gap-2 border-2 text-sm font-medium"
                    onClick={() => quickActionMutation.mutate({ orderId: selectedJobId, actionType: "needs_part" })}
                    disabled={quickActionMutation.isPending}
                    data-testid="button-quick-needs-part"
                  >
                    {quickActionMutation.isPending ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <Wrench className="h-7 w-7 text-chart-1" />
                    )}
                    <span className="text-xs leading-tight text-center">Behöver reservdel</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex-col gap-2 border-2 text-sm font-medium"
                    onClick={() => quickActionMutation.mutate({ orderId: selectedJobId, actionType: "customer_absent" })}
                    disabled={quickActionMutation.isPending}
                    data-testid="button-quick-customer-absent"
                  >
                    {quickActionMutation.isPending ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <UserX className="h-7 w-7 text-chart-4" />
                    )}
                    <span className="text-xs leading-tight text-center">Kund ej hemma</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex-col gap-2 border-2 text-sm font-medium"
                    onClick={() => quickActionMutation.mutate({ orderId: selectedJobId, actionType: "takes_longer" })}
                    disabled={quickActionMutation.isPending}
                    data-testid="button-quick-takes-longer"
                  >
                    {quickActionMutation.isPending ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <AlarmClock className="h-7 w-7 text-chart-4" />
                    )}
                    <span className="text-xs leading-tight text-center">Tar längre tid</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {!focusMode && showNotesPanel && (
            <Card className="border-chart-1/20 dark:border-chart-1/80">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-chart-1" />
                  Lägg till anteckning
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Textarea
                    value={jobNote}
                    onChange={(e) => setJobNote(e.target.value)}
                    placeholder="Skriv din anteckning här..."
                    className="min-h-[80px] flex-1"
                    data-testid="input-job-note"
                  />
                  <VoiceInput
                    onTranscript={(text) => {
                      setJobNote((prev) => prev ? `${prev} ${text}` : text);
                    }}
                    className="shrink-0 self-start mt-1"
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    if (selectedJobId && jobNote.trim()) {
                      saveNoteMutation.mutate({ id: selectedJobId, note: jobNote.trim() });
                    }
                  }}
                  disabled={!jobNote.trim() || saveNoteMutation.isPending}
                  data-testid="button-save-note"
                >
                  {saveNoteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Spara anteckning
                </Button>
              </CardContent>
            </Card>
          )}


          {showProblemPanel && (
            <Card className="border-warning/20 dark:border-warning/80">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Rapportera problem
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Markera som omöjlig</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Välj anledning till att ordern inte kan utföras:
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {IMPOSSIBLE_REASONS.map((reason) => (
                      <Button
                        key={reason}
                        variant="outline"
                        className="h-auto py-3 flex-col gap-1"
                        onClick={() => handleSelectImpossibleReason(reason)}
                        data-testid={`button-impossible-${reason}`}
                      >
                        {reason === "locked_gate" && <Ban className="h-5 w-5 text-destructive" />}
                        {reason === "no_access" && <Ban className="h-5 w-5 text-destructive" />}
                        {reason === "wrong_address" && <MapPinOff className="h-5 w-5 text-chart-3" />}
                        {reason === "obstacle" && <Trash2 className="h-5 w-5 text-chart-4" />}
                        {reason === "customer_absent" && <Clock className="h-5 w-5 text-chart-1" />}
                        {reason === "weather" && <AlertTriangle className="h-5 w-5 text-gray-500" />}
                        {reason === "equipment_issue" && <AlertTriangle className="h-5 w-5 text-chart-5" />}
                        {reason === "other" && <HelpCircle className="h-5 w-5 text-gray-500" />}
                        <span className="text-xs">{IMPOSSIBLE_REASON_LABELS[reason]}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <Button
                    variant={showChangeRequestPanel ? "default" : "outline"}
                    className="w-full gap-2"
                    onClick={() => setShowChangeRequestPanel(!showChangeRequestPanel)}
                    data-testid="button-toggle-change-request"
                  >
                    <Flag className="h-4 w-4" />
                    Skicka kundrapport
                  </Button>
                </div>

                {showChangeRequestPanel && selectedJob && (
                  <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                    <p className="text-sm font-medium">Ny kundrapport</p>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Kategori</label>
                      <Select value={changeRequestCategory} onValueChange={setChangeRequestCategory}>
                        <SelectTrigger data-testid="select-change-category">
                          <SelectValue placeholder="Välj kategori..." />
                        </SelectTrigger>
                        <SelectContent>
                          {GO_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {CATEGORY_LABELS[cat] || cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Allvarlighetsgrad</label>
                      <Select value={changeRequestSeverity} onValueChange={setChangeRequestSeverity}>
                        <SelectTrigger data-testid="select-change-severity">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SEVERITY_LABELS).map(([val, label]) => (
                            <SelectItem key={val} value={val}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Beskrivning</label>
                      <Textarea
                        value={changeRequestDescription}
                        onChange={(e) => setChangeRequestDescription(e.target.value)}
                        placeholder="Beskriv problemet..."
                        className="min-h-[60px]"
                        data-testid="input-change-description"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Foto (valfritt)</label>
                      {changeRequestPhoto ? (
                        <div className="relative">
                          <img src={changeRequestPhoto} alt="Foto" className="w-full h-24 object-cover rounded-md border" />
                          <Button size="icon" variant="destructive" className="absolute top-1 right-1 h-6 w-6" onClick={() => setChangeRequestPhoto(null)} data-testid="button-remove-change-photo">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className={`relative rounded-md border-2 border-dashed transition-colors ${
                            changePhotoDragOver
                              ? "border-primary bg-primary/5"
                              : "border-transparent"
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (!isUploadingChangePhoto) setChangePhotoDragOver(true);
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            setChangePhotoDragOver(false);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            setChangePhotoDragOver(false);
                            if (isUploadingChangePhoto) return;
                            const file = e.dataTransfer.files?.[0];
                            if (file) uploadChangeRequestPhoto(file, setIsUploadingChangePhoto, setChangeRequestPhoto);
                          }}
                          data-testid="dropzone-change-photo"
                        >
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            id="change-request-photo-input"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) await uploadChangeRequestPhoto(file, setIsUploadingChangePhoto, setChangeRequestPhoto);
                              e.target.value = "";
                            }}
                            data-testid="input-change-photo"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-1"
                            onClick={() => document.getElementById("change-request-photo-input")?.click()}
                            disabled={isUploadingChangePhoto}
                            data-testid="button-take-change-photo"
                          >
                            {isUploadingChangePhoto ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                            {isUploadingChangePhoto ? "Laddar upp..." : changePhotoDragOver ? "Släpp foto här" : "Ta foto eller dra in bild"}
                          </Button>
                          <p className="mt-1 text-[10px] text-muted-foreground" data-testid="text-change-photo-size-hint">
                            {FIELD_PHOTO_SIZE_HINT}
                          </p>
                        </div>
                      )}
                    </div>
                    <Button
                      className="w-full gap-2"
                      onClick={() => {
                        if (selectedJob?.objectId && changeRequestCategory && changeRequestDescription.trim()) {
                          const gpsPos = lastPositionRef.current;
                          submitChangeRequestMutation.mutate({
                            objectId: selectedJob.objectId,
                            category: changeRequestCategory,
                            description: changeRequestDescription.trim(),
                            severity: changeRequestSeverity,
                            photos: changeRequestPhoto ? [changeRequestPhoto] : undefined,
                            ...(gpsPos ? { latitude: gpsPos.lat, longitude: gpsPos.lng } : {}),
                          });
                        }
                      }}
                      disabled={!changeRequestCategory || !changeRequestDescription.trim() || submitChangeRequestMutation.isPending}
                      data-testid="button-submit-change-request"
                    >
                      {submitChangeRequestMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Skicka rapport
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Dialog open={showImpossibleDialog} onOpenChange={setShowImpossibleDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Bekräfta omöjlig order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Du markerar denna order som omöjlig med anledning: 
                  <strong className="ml-1">
                    {selectedImpossibleReason && IMPOSSIBLE_REASON_LABELS[selectedImpossibleReason as keyof typeof IMPOSSIBLE_REASON_LABELS]}
                  </strong>
                </p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Ytterligare detaljer (valfritt)
                  </label>
                  <Textarea
                    value={impossibleReasonText}
                    onChange={(e) => setImpossibleReasonText(e.target.value)}
                    placeholder="Beskriv vad som hindrade dig..."
                    data-testid="input-impossible-reason-text"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Foto som bevis (valfritt)
                  </label>
                  {impossiblePhoto ? (
                    <div className="relative">
                      <img 
                        src={impossiblePhoto} 
                        alt="Bevis" 
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1"
                        onClick={() => setImpossiblePhoto(null)}
                        data-testid="button-remove-impossible-photo"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={`flex gap-2 rounded-md border-2 border-dashed p-1 transition-colors ${
                        impossiblePhotoDragOver
                          ? "border-primary bg-primary/5"
                          : "border-transparent"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!isUploadingImpossiblePhoto) setImpossiblePhotoDragOver(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setImpossiblePhotoDragOver(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setImpossiblePhotoDragOver(false);
                        if (isUploadingImpossiblePhoto) return;
                        const file = e.dataTransfer.files?.[0];
                        if (file) uploadChangeRequestPhoto(file, setIsUploadingImpossiblePhoto, setImpossiblePhoto);
                      }}
                      data-testid="dropzone-impossible-photo"
                    >
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        id="impossible-photo-input"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) await uploadChangeRequestPhoto(file, setIsUploadingImpossiblePhoto, setImpossiblePhoto);
                          e.target.value = "";
                        }}
                        data-testid="input-impossible-photo"
                      />
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => document.getElementById('impossible-photo-input')?.click()}
                        disabled={isUploadingImpossiblePhoto}
                        data-testid="button-take-impossible-photo"
                      >
                        {isUploadingImpossiblePhoto ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4 mr-2" />
                        )}
                        {isUploadingImpossiblePhoto ? "Laddar upp..." : impossiblePhotoDragOver ? "Släpp foto här" : "Ta foto eller dra in bild"}
                      </Button>
                    </div>
                  )}
                  {!impossiblePhoto && (
                    <p className="text-xs text-muted-foreground" data-testid="text-impossible-photo-size-hint">
                      {FIELD_PHOTO_SIZE_HINT}
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowImpossibleDialog(false);
                    setSelectedImpossibleReason(null);
                    setImpossibleReasonText("");
                    setImpossiblePhoto(null);
                  }}
                >
                  Avbryt
                </Button>
                <Button 
                  variant="destructive"
                  onClick={handleConfirmImpossible}
                  disabled={markImpossibleMutation.isPending}
                  data-testid="button-confirm-impossible"
                >
                  {markImpossibleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mr-1 text-warning" />
                  )}
                  Markera som omöjlig
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={showCompletedDialog} onOpenChange={setShowCompletedDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-chart-2" />
                  Jobb slutfört!
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Bra jobbat! Vad vill du göra nu?
                </p>
                {getNextJob() && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="py-3">
                      <p className="text-xs text-muted-foreground mb-1">Nästa jobb</p>
                      <p className="font-medium">{getNextJob()?.title}</p>
                      <p className="text-sm text-muted-foreground">{getNextJob()?.objectAddress}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                {getNextJob() && (
                  <Button 
                    className="w-full gap-2"
                    onClick={handleNextJob}
                    data-testid="button-go-to-next-job"
                  >
                    <SkipForward className="h-4 w-4" />
                    Gå till nästa jobb
                  </Button>
                )}
                <Button 
                  variant="outline"
                  className="w-full"
                  onClick={handleGoBackToJobs}
                  data-testid="button-back-to-jobs-list"
                >
                  Tillbaka till jobbslistan
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <PhotoCapture 
            workOrderId={selectedJob.id}
            existingPhotos={(selectedJob.metadata as { photos?: string[] } | null)?.photos || []}
            onPhotosChange={async (photos) => {
              try {
                await apiRequest("PATCH", `/api/work-orders/${selectedJob.id}`, {
                  metadata: { ...(selectedJob.metadata as object || {}), photos }
                });
                queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
              } catch (error) {
                console.error("Failed to save photos:", error);
              }
            }}
          />

          {!focusMode && <Card className="border-chart-2/20 dark:border-chart-2/80">
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowInspectionPanel(!showInspectionPanel)}>
              <CardTitle className="text-base flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-chart-2" />
                  Besiktning
                </div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showInspectionPanel ? 'rotate-90' : ''}`} />
              </CardTitle>
            </CardHeader>
            {showInspectionPanel && (
              <CardContent className="space-y-3">
                {Object.entries({
                  door: { label: 'Dörr', issues: ['Knarrar', 'Stängs inte', 'Skadad', 'Saknar stängare'] },
                  lock: { label: 'Lås', issues: ['Slitet', 'Fastnar', 'Saknas', 'Fel nyckel'] },
                  window: { label: 'Fönster', issues: ['Sprucket', 'Öppnas inte', 'Trasig spanjolette', 'Kondens'] },
                  lighting: { label: 'Belysning', issues: ['Ur funktion', 'Blinkar', 'Saknas', 'Felaktig armatur'] },
                  floor: { label: 'Golv', issues: ['Skadat', 'Halt', 'Smutsigt', 'Sprickor'] },
                  ventilation: { label: 'Ventilation', issues: ['Ur funktion', 'Oljud', 'Dålig luft', 'Blockerad'] },
                }).map(([type, config]) => (
                  <div key={type} className="border rounded-lg p-3 space-y-2" data-testid={`inspection-item-${type}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{config.label}</span>
                      <div className="flex gap-1">
                        {['ok', 'warning', 'error'].map(status => (
                          <Button
                            key={status}
                            size="sm"
                            variant={inspectionItems[type]?.status === status ? 'default' : 'outline'}
                            className={`h-7 px-2 text-xs ${
                              inspectionItems[type]?.status === status
                                ? status === 'ok' ? 'bg-chart-2/15 hover:bg-chart-2/15' 
                                  : status === 'warning' ? 'bg-warning/15 hover:bg-warning/15'
                                  : 'bg-destructive/15 hover:bg-destructive/15'
                                : ''
                            }`}
                            onClick={() => setInspectionItems(prev => ({
                              ...prev,
                              [type]: { ...prev[type], status }
                            }))}
                            data-testid={`button-inspection-${type}-${status}`}
                          >
                            {status === 'ok' ? 'OK' : status === 'warning' ? 'Varning' : 'Fel'}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {inspectionItems[type]?.status && inspectionItems[type].status !== 'ok' && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {config.issues.map(issue => (
                            <Badge
                              key={issue}
                              variant={inspectionItems[type]?.issues?.includes(issue) ? 'default' : 'outline'}
                              className="cursor-pointer text-xs"
                              onClick={() => setInspectionItems(prev => {
                                const current = prev[type]?.issues || [];
                                const updated = current.includes(issue)
                                  ? current.filter(i => i !== issue)
                                  : [...current, issue];
                                return { ...prev, [type]: { ...prev[type], issues: updated } };
                              })}
                              data-testid={`badge-issue-${type}-${issue}`}
                            >
                              {issue}
                            </Badge>
                          ))}
                        </div>
                        <Textarea
                          placeholder="Kommentar..."
                          className="min-h-[40px] text-sm"
                          value={inspectionItems[type]?.comment || ''}
                          onChange={(e) => setInspectionItems(prev => ({
                            ...prev,
                            [type]: { ...prev[type], comment: e.target.value }
                          }))}
                          data-testid={`input-inspection-comment-${type}`}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  className="w-full gap-2"
                  onClick={() => saveInspectionMutation.mutate(inspectionItems)}
                  disabled={saveInspectionMutation.isPending || !Object.values(inspectionItems).some(i => i.status)}
                  data-testid="button-save-inspection"
                >
                  {saveInspectionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Spara besiktning
                </Button>
              </CardContent>
            )}
          </Card>}

          {!focusMode && jobStarted && (
            <OrderChecklist
              workOrderId={selectedJob.id}
              orderType={selectedJob.orderType}
            />
          )}

          {!focusMode && jobStarted && (
            <MaterialLog
              materials={materials}
              onMaterialsChange={setMaterials}
            />
          )}

          {!focusMode && jobStarted && (
            <Card data-testid="card-completed-resources">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Bil, utrustning & deltagare
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Använt fordon</Label>
                  <Select
                    value={completedVehicleId ?? "none"}
                    onValueChange={(v) => setCompletedVehicleId(v === "none" ? null : v)}
                  >
                    <SelectTrigger data-testid="select-completed-vehicle">
                      <SelectValue placeholder="Välj fordon" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Inget fordon</SelectItem>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id} data-testid={`option-vehicle-${v.id}`}>
                          {v.name} ({v.registrationNumber})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5" />
                    Använd utrustning
                  </Label>
                  <Select
                    value={completedEquipmentId ?? "none"}
                    onValueChange={(v) => setCompletedEquipmentId(v === "none" ? null : v)}
                  >
                    <SelectTrigger data-testid="select-completed-equipment">
                      <SelectValue placeholder="Välj utrustning" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ingen utrustning</SelectItem>
                      {equipment.map((e) => (
                        <SelectItem key={e.id} value={e.id} data-testid={`option-equipment-${e.id}`}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    Deltagare
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {allResources.map((r) => {
                      const selected = completedParticipantIds.includes(r.id);
                      return (
                        <Button
                          key={r.id}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          className="h-8"
                          onClick={() =>
                            setCompletedParticipantIds((prev) =>
                              prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id],
                            )
                          }
                          data-testid={`button-participant-${r.id}`}
                        >
                          {r.name}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {completedParticipantIds.length === 0
                      ? "Inga valda – du läggs till automatiskt vid klarmarkering."
                      : `${completedParticipantIds.length} valda`}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {!focusMode && accessInfo.specialInstructions && (
            <Card className="border-chart-3/20 dark:border-chart-3/80">
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Viktig info</p>
                <p className="text-sm">{accessInfo.specialInstructions}</p>
              </CardContent>
            </Card>
          )}

          {!focusMode && selectedJob.objectAddress && (
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Adress</p>
                <p className="text-sm">{selectedJob.objectAddress}</p>
                {selectedObject?.city && (
                  <p className="text-sm text-muted-foreground">{selectedObject.city}</p>
                )}
              </CardContent>
            </Card>
          )}

          {!focusMode && (
            <TaskTimelinePanel
              workOrderId={selectedJob.id}
              mobileApiCall={mobileApiCall}
              enabled={view === "job"}
            />
          )}
        </div>

        {showSignaturePanel && (
          <div className="p-4 border-t bg-muted/50">
            <SignatureCapture
              workOrderId={selectedJob.id}
              existingSignature={currentSignature || existingSignaturePath}
              onSignatureSaved={(path) => {
                setCurrentSignature(path);
                setShowSignaturePanel(false);
                handleCompleteWithValidation(path);
              }}
              onCancel={() => setShowSignaturePanel(false)}
            />
          </div>
        )}

        <SigningValidationModal
          open={showValidationModal}
          onOpenChange={setShowValidationModal}
          missingFields={validationMissingFields}
        />

        <div className="p-4 border-t bg-card">
          {focusMode && !jobStarted ? null : !jobStarted ? (
            <Button
              size="mobile"
              className="w-full gap-2"
              onClick={handleStartJob}
              data-testid="button-start-job"
            >
              <Play className="h-5 w-5" />
              Starta jobb
            </Button>
          ) : showSignaturePanel ? null : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="mobile"
                variant="outline"
                className="gap-2"
                onClick={() => handleCompleteWithValidation()}
                disabled={completeJobMutation.isPending}
                data-testid="button-complete-without-signature"
              >
                {completeJobMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle className="h-5 w-5" />
                )}
                {existingSignaturePath ? "Slutf\u00f6r" : "Utan signatur"}
              </Button>
              <Button
                size="mobile"
                className="gap-2 bg-chart-2/15"
                onClick={() => setShowSignaturePanel(true)}
                disabled={completeJobMutation.isPending}
                data-testid="button-complete-with-signature"
              >
                <FileSignature className="h-5 w-5" />
                {existingSignaturePath ? "Ny signatur" : "Signera"}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <OfflineBanner isOnline={isOnline} />
      <EnkelUppgiftWizard
        open={showEnkelUppgift}
        onClose={() => setShowEnkelUppgift(false)}
      />
      <div className="p-4 border-b bg-card space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              data-testid="button-back-mobile"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Dagens schema</h1>
              <p className="text-sm text-muted-foreground">
                {format(today, "EEEE d MMMM", { locale: sv })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => setShowEnkelUppgift(true)}
              data-testid="button-open-enkel-uppgift-mobile"
            >
              <Plus className="h-4 w-4" />
              Enkel uppgift
            </Button>
            {weatherData && (
              <Badge variant="outline" className="text-xs gap-1" data-testid="badge-weather">
                <Thermometer className="h-3 w-3" />
                {Math.round(weatherData.temperature)}°
                {weatherData.windSpeed > 10 && (
                  <>
                    <Wind className="h-3 w-3 ml-1" />
                    {Math.round(weatherData.windSpeed)}
                  </>
                )}
              </Badge>
            )}
            <OfflineIndicator
              isOnline={isOnline}
              isSyncing={isSyncing}
              pendingChanges={pendingChanges}
              lastSyncAt={lastSyncAt}
              onSyncNow={syncNow}
            />
            {resourceId && (
              <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${gpsActive ? "text-chart-2 bg-chart-2/10 dark:bg-chart-2/15" : "text-muted-foreground bg-muted"}`} data-testid="indicator-gps-status">
                <NavigationIcon className="h-3 w-3" />
                <span>{gpsActive ? "GPS" : "Ingen GPS"}</span>
              </div>
            )}
            {resourceId && isOnline && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 gap-1"
                onClick={handleOpenNotificationsPanel}
                data-testid="button-toggle-notifications"
              >
                <Bell className={`h-4 w-4 ${isConnected ? "text-chart-2" : "text-muted-foreground"}`} />
                {unreadCount > 0 && (
                  <span className="bg-destructive text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="sm"
              className="h-8 px-2 gap-1"
              onClick={() => setFocusMode(!focusMode)}
              data-testid="button-settings-focus-mode"
            >
              {focusMode ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button 
              variant="ghost" 
              size="sm"
              className="h-8 px-2 gap-1"
              onClick={() => setShowMyReportsPanel(!showMyReportsPanel)}
              data-testid="button-toggle-my-reports"
            >
              <Flag className={`h-4 w-4 ${showMyReportsPanel ? "text-chart-4" : "text-muted-foreground"}`} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 gap-1"
              onClick={() => setShowTeamDeviationsPanel(!showTeamDeviationsPanel)}
              data-testid="button-toggle-team-deviations"
            >
              <Users className={`h-4 w-4 ${showTeamDeviationsPanel ? "text-chart-4" : "text-muted-foreground"}`} />
            </Button>
            {resourceId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 gap-1"
                onClick={() => setShowSettingsPanel(!showSettingsPanel)}
                data-testid="button-toggle-field-settings"
              >
                <Settings className={`h-4 w-4 ${showSettingsPanel ? "text-primary" : "text-muted-foreground"}`} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 gap-1"
              onClick={toggleTheme}
              data-testid="button-toggle-theme"
              aria-label={theme === "light" ? "Byt till mörkt läge" : "Byt till ljust läge"}
            >
              {theme === "light" ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setShowAiPanel(true)}
              data-testid="button-open-ai-assistant"
            >
              <HelpCircle className="h-5 w-5 text-chart-5" />
            </Button>
          </div>
        </div>

        {showNotificationsPanel && notifications.length > 0 && (
          <Card className="border-primary/20">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifikationer
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-3 max-h-40 overflow-auto space-y-2">
              {notifications.slice(0, 5).map((notif, idx) => (
                <div key={idx} className="text-sm border-l-2 border-primary pl-2">
                  <p className="font-medium">{notif.title}</p>
                  <p className="text-xs text-muted-foreground">{notif.message}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {showMyReportsPanel && (
          <MyReportsPanel mobileApiCall={mobileApiCall} />
        )}

        {showTeamDeviationsPanel && (
          <TeamDeviationsPanel mobileApiCall={mobileApiCall} />
        )}

        {showSettingsPanel && (
          <Card className="border-primary/20" data-testid="panel-field-settings">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Mina aviseringar
              </CardTitle>
            </CardHeader>
            <CardContent className="py-3 px-3 space-y-3">
              {!myResource ? (
                <div className="text-xs text-muted-foreground">Laddar dina inställningar...</div>
              ) : (
                <>
                  {!myResource.phone && (
                    <div className="text-xs text-muted-foreground border border-dashed rounded px-2 py-1.5">
                      Inget telefonnummer registrerat – be planeraren lägga till ditt nummer för att kunna ta emot SMS.
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="pref-sms-schedule" className="text-sm">SMS när veckans schema publiceras</Label>
                      <p className="text-[11px] text-muted-foreground">Du får ett kort SMS med antal jobb och första starttid.</p>
                    </div>
                    <Switch
                      id="pref-sms-schedule"
                      checked={myResource.smsOnScheduleSend !== false}
                      disabled={!myResource.phone || updateResourcePrefsMutation.isPending}
                      onCheckedChange={(v) => updateResourcePrefsMutation.mutate({ smsOnScheduleSend: v })}
                      data-testid="switch-pref-sms-schedule"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="pref-sms-extra" className="text-sm">SMS vid extrajobb under publicerad period</Label>
                      <p className="text-[11px] text-muted-foreground">Du varnas direkt om planeraren lägger till eller flyttar in jobb i din vecka.</p>
                    </div>
                    <Switch
                      id="pref-sms-extra"
                      checked={myResource.smsOnExtraJob !== false}
                      disabled={!myResource.phone || updateResourcePrefsMutation.isPending}
                      onCheckedChange={(v) => updateResourcePrefsMutation.mutate({ smsOnExtraJob: v })}
                      data-testid="switch-pref-sms-extra"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <DailyProgressCard 
          completed={completedCount} 
          total={completedCount + todayJobs.length} 
          compact 
        />

        {todayJobs.length > 0 && (() => {
          const typeCounts: Record<string, number> = {};
          for (const job of todayJobs) {
            const type = job.orderType || "service";
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          }
          const typeLabels: Record<string, string> = {
            service: "servicejobb", tvatt: "tvättar", besiktning: "besiktningar",
            kontroll: "kontroller", etablering: "etableringar", tomning: "tömningar",
            reparation: "reparationer", installation: "installationer",
          };
          const parts = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `${count} ${typeLabels[type] || type}`);
          return (
            <div className="bg-muted/50 rounded-lg px-3 py-2 text-center" data-testid="summary-task-types">
              <p className="text-sm font-medium text-muted-foreground">
                {parts.join(", ")}
              </p>
            </div>
          );
        })()}

        {(() => {
          const nextPendingJob = getNextPendingJob();
          if (!nextPendingJob) return null;
          const obj = objectMap.get(nextPendingJob.objectId ?? "");
          const lat = obj?.latitude ?? nextPendingJob.taskLatitude;
          const lng = obj?.longitude ?? nextPendingJob.taskLongitude;
          const dist = travelDistances[nextPendingJob.id];
          if (lat == null || lng == null) return null;
          return (
            <Card className="bg-gradient-to-r from-chart-1 to-chart-1 dark:from-chart-1 dark:to-chart-1 text-white border-0">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider opacity-80">Nästa stopp</p>
                    <p className="font-semibold text-sm truncate">{nextPendingJob.objectAddress || nextPendingJob.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {nextPendingJob.scheduledStartTime && (
                        <span className="text-xs opacity-90 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {nextPendingJob.scheduledStartTime}
                        </span>
                      )}
                      {dist && dist.distanceKm != null && (
                        <span className="text-xs opacity-90 flex items-center gap-1" data-testid="text-next-stop-travel">
                          <Car className="h-3 w-3" />
                          {dist.distanceKm} km — {dist.travelMinutes} min
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-white text-chart-1 hover:bg-chart-1/10 shrink-0 gap-1.5 font-semibold"
                    onClick={(e) => {
                      e.stopPropagation();
                      openNavigation(Number(lat), Number(lng));
                    }}
                    data-testid="button-next-stop-navigate"
                  >
                    <NavigationIcon className="h-4 w-4" />
                    Navigera
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* PWA Install Banner */}
        {!isInstalled && !dismissedInstallBanner && (canInstall || isIOS) && (
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                  <Download className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Installera Traivo Go</p>
                  <p className="text-xs text-muted-foreground">
                    {isIOS ? "Tryck dela → Lägg till på hemskärmen" : "Snabbare åtkomst från hemskärmen"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {canInstall && (
                    <Button
                      size="sm"
                      onClick={promptInstall}
                      data-testid="button-install-pwa"
                    >
                      Installera
                    </Button>
                  )}
                  {isIOS && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        toast({
                          title: "Lägg till på hemskärmen",
                          description: "Tryck på dela-ikonen längst ner och välj 'Lägg till på hemskärmen'",
                        });
                      }}
                      data-testid="button-ios-install-help"
                    >
                      <Share className="h-4 w-4 mr-1" />
                      Hur?
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={handleDismissInstallBanner}
                    data-testid="button-dismiss-install-banner"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <FieldAIAssistant 
        isOpen={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        jobContext={selectedJob ? {
          jobTitle: selectedJob.title,
          objectName: selectedJob.objectName ?? undefined,
          objectAddress: selectedJob.objectAddress ?? undefined,
        } : undefined}
      />

      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-4 space-y-3 pull-to-refresh"
      >
        {pullDistance > 0 && (
          <div 
            className="flex items-center justify-center transition-all"
            style={{ height: pullDistance }}
          >
            <div className={`flex items-center gap-2 text-sm text-muted-foreground ${isRefreshing ? "animate-pulse" : ""}`}>
              {isRefreshing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Uppdaterar...</span>
                </>
              ) : shouldTrigger ? (
                <span>Släpp för att uppdatera</span>
              ) : (
                <span>Dra ner för att uppdatera</span>
              )}
            </div>
          </div>
        )}
        {todayJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <CheckCircle className="h-16 w-16 text-chart-2" />
            <div>
              <p className="text-xl font-semibold">Alla jobb klara!</p>
              <p className="text-muted-foreground">Bra jobbat idag</p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2 sticky top-0 z-10 bg-background pb-2" data-testid="controls-job-list">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  placeholder="Sök jobb, adress, kund, metadata…"
                  className="pl-8 h-9"
                  data-testid="input-job-search"
                />
                {jobSearch && (
                  <button
                    type="button"
                    onClick={() => setJobSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover-elevate rounded p-0.5"
                    data-testid="button-clear-search"
                    aria-label="Rensa sökning"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <ToggleGroup
                type="single"
                value={jobListMode}
                onValueChange={(v) => v && setJobListMode(v as "rutt" | "plats" | "kund" | "order")}
                className="justify-start gap-1"
                data-testid="toggle-list-mode"
              >
                <ToggleGroupItem value="rutt" className="h-8 px-3 gap-1.5 text-xs" data-testid="toggle-mode-rutt">
                  <Route className="h-3.5 w-3.5" /> Rutt
                </ToggleGroupItem>
                <ToggleGroupItem value="plats" className="h-8 px-3 gap-1.5 text-xs" data-testid="toggle-mode-plats">
                  <MapPin className="h-3.5 w-3.5" /> Plats
                </ToggleGroupItem>
                <ToggleGroupItem value="kund" className="h-8 px-3 gap-1.5 text-xs" data-testid="toggle-mode-kund">
                  <Users className="h-3.5 w-3.5" /> Kund
                </ToggleGroupItem>
                <ToggleGroupItem value="order" className="h-8 px-3 gap-1.5 text-xs" data-testid="toggle-mode-order">
                  <Hash className="h-3.5 w-3.5" /> Order
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {filteredMetas.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="empty-search-results">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Inga jobb matchar "{jobSearch}"</p>
              </div>
            ) : jobListMode === "rutt" ? (
              filteredMetas.map(meta => {
                const job = jobById.get(meta.id);
                return job ? renderJobCard(job) : null;
              })
            ) : (
              (jobListMode === "plats" ? locationGroups : jobListMode === "kund" ? customerGroups : orderGroups).map(group => {
                const collapsed = collapsedGroups.has(group.key);
                return (
                  <Collapsible
                    key={group.key}
                    open={!collapsed}
                    onOpenChange={(open) => {
                      setCollapsedGroups(prev => {
                        const next = new Set(prev);
                        if (open) next.delete(group.key); else next.add(group.key);
                        return next;
                      });
                    }}
                    className="space-y-2"
                  >
                    <CollapsibleTrigger
                      className="flex items-center gap-2 w-full text-left px-1 py-1.5 hover-elevate rounded"
                      data-testid={`group-header-${group.key}`}
                    >
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                      {jobListMode === "plats"
                        ? <MapPin className="h-4 w-4 text-chart-4 shrink-0" />
                        : jobListMode === "kund"
                          ? <Users className="h-4 w-4 text-chart-4 shrink-0" />
                          : <Hash className="h-4 w-4 text-chart-4 shrink-0" />}
                      <span className="font-medium text-sm truncate flex-1">{group.label}</span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">{group.items.length}</Badge>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pl-2 border-l-2 border-muted ml-2">
                      {group.items.map(meta => {
                        const job = jobById.get(meta.id);
                        return job ? renderJobCard(job) : null;
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })
            )}
          </>
        )}
      </div>

      <div className="p-4 border-t bg-card flex gap-2">
        <Button
          variant="outline"
          className="flex-1 h-12 gap-2"
          onClick={() => setShowAiPanel(!showAiPanel)}
          data-testid="button-ask-ai-general"
        >
          <HelpCircle className="h-5 w-5 text-chart-5" />
          {showAiPanel ? "Visa jobb" : "Fråga AI"}
        </Button>
        <Button
          variant="outline"
          className="h-12 gap-2 px-4 relative"
          onClick={() => setView("todo")}
          data-testid="button-open-todo-list"
        >
          <ListTodo className="h-5 w-5 text-chart-4" />
          Att göra
          {(() => {
            const count = getUncompletedTodoCount();
            return count > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 bg-chart-4 text-white text-[10px] font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1" data-testid="badge-todo-count">
                {count}
              </span>
            ) : null;
          })()}
        </Button>
        <Button
          variant="outline"
          className="h-12 gap-2 px-4"
          onClick={() => setView("timeline")}
          data-testid="button-open-timeline"
        >
          <Clock className="h-5 w-5 text-chart-2" />
          Tid
        </Button>
        <Button
          variant="outline"
          className="h-12 gap-2 px-4 relative"
          onClick={() => setView("outbox")}
          data-testid="button-open-outbox"
        >
          <Database className="h-5 w-5 text-chart-1" />
          Synk
          {pendingChanges > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-chart-1 text-white text-[10px] font-bold rounded-full h-5 min-w-5 flex items-center justify-center px-1" data-testid="badge-outbox-count">
              {pendingChanges}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          className="h-12 gap-2 px-4"
          onClick={() => setView("stock")}
          data-testid="button-open-vehicle-stock"
        >
          <Truck className="h-5 w-5 text-chart-2" />
          Bil
        </Button>
        <Button
          variant="outline"
          className="h-12 gap-2 px-4"
          onClick={() => setView("report")}
          data-testid="button-open-day-report"
        >
          <FileText className="h-5 w-5 text-chart-2" />
          Rapport
        </Button>
      </div>
    </div>
  );
}
