import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Clock, Truck, Coffee, Wrench, Timer,
  Pencil, AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface TimeEntry {
  id: string;
  type: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  note: string | null;
  workOrderId: string | null;
  orderTitle: string | null;
}

interface TimeSummary {
  totalWork: number;
  totalTravel: number;
  totalBreak: number;
  totalHours: number;
  date: string;
}

interface TimelineViewProps {
  onBack: () => void;
  mobileApiCall: (method: string, url: string, body?: unknown) => Promise<Response>;
}

const ENTRY_COLORS: Record<string, { bg: string; border: string; text: string; icon: typeof Clock }> = {
  travel: { bg: "bg-blue-100 dark:bg-blue-900/30", border: "border-blue-400", text: "text-blue-600 dark:text-blue-400", icon: Truck },
  work: { bg: "bg-green-100 dark:bg-green-900/30", border: "border-green-400", text: "text-green-600 dark:text-green-400", icon: Wrench },
  break: { bg: "bg-amber-100 dark:bg-amber-900/30", border: "border-amber-400", text: "text-amber-600 dark:text-amber-400", icon: Coffee },
  rest: { bg: "bg-amber-100 dark:bg-amber-900/30", border: "border-amber-400", text: "text-amber-600 dark:text-amber-400", icon: Coffee },
};

const ENTRY_LABELS: Record<string, string> = {
  travel: "Resa",
  work: "Arbete",
  break: "Rast",
  rest: "Vila",
};

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

export function TimelineView({ onBack, mobileApiCall }: TimelineViewProps) {
  const { toast } = useToast();
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [authError, setAuthError] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ["/api/mobile/time-entries", today],
    queryFn: async () => {
      try {
        const res = await mobileApiCall("GET", `/api/mobile/time-entries?date=${today}`);
        setAuthError(false);
        return res.json();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("401")) setAuthError(true);
        return [];
      }
    },
    refetchInterval: 30000,
  });

  const { data: summary } = useQuery<TimeSummary>({
    queryKey: ["/api/mobile/time-summary", today],
    queryFn: async () => {
      try {
        const res = await mobileApiCall("GET", `/api/mobile/time-summary?date=${today}`);
        return res.json();
      } catch {
        return { totalWork: 0, totalTravel: 0, totalBreak: 0, totalHours: 0, date: today };
      }
    },
    refetchInterval: 30000,
  });

  const correctionMutation = useMutation({
    mutationFn: async ({ id, startTime, endTime }: { id: string; startTime?: string; endTime?: string }) => {
      const res = await mobileApiCall("PATCH", `/api/mobile/time-entries/${id}`, { startTime, endTime });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mobile/time-summary"] });
      setEditingEntry(null);
      toast({ title: "Tidskorrigering sparad" });
    },
    onError: (err: Error) => {
      toast({ title: "Fel", description: err.message, variant: "destructive" });
    },
  });

  const totalMinutes = (summary?.totalWork || 0) + (summary?.totalTravel || 0) + (summary?.totalBreak || 0);

  const segments = useMemo(() => {
    if (!entries.length || totalMinutes === 0) return [];
    return entries
      .filter(e => e.duration && e.duration > 0)
      .map(e => ({
        ...e,
        pct: Math.max(2, (e.duration! / totalMinutes) * 100),
      }));
  }, [entries, totalMinutes]);

  const handleEditOpen = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setEditStartTime(entry.startTime ? format(new Date(entry.startTime), "HH:mm") : "");
    setEditEndTime(entry.endTime ? format(new Date(entry.endTime), "HH:mm") : "");
  };

  const handleEditSave = () => {
    if (!editingEntry) return;
    const base = today;
    const startISO = editStartTime ? `${base}T${editStartTime}:00` : undefined;
    const endISO = editEndTime ? `${base}T${editEndTime}:00` : undefined;
    correctionMutation.mutate({ id: editingEntry.id, startTime: startISO, endTime: endISO });
  };

  const nowPos = useMemo(() => {
    if (!entries.length) return null;
    const firstStart = entries[0]?.startTime;
    if (!firstStart) return null;
    const dayStartMs = new Date(firstStart).getTime();
    const lastEntry = entries[entries.length - 1];
    const dayEndMs = lastEntry?.endTime ? new Date(lastEntry.endTime).getTime() : Date.now();
    const span = dayEndMs - dayStartMs;
    if (span <= 0) return null;
    const now = Date.now();
    if (now < dayStartMs || now > dayEndMs) return null;
    return ((now - dayStartMs) / span) * 100;
  }, [entries]);

  return (
    <div className="flex flex-col h-full bg-background" data-testid="timeline-view">
      <div className="flex items-center gap-3 p-4 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-from-timeline">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">TimeThread</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), "EEEE d MMMM yyyy", { locale: sv })}
          </p>
        </div>
        <Badge variant="outline" className="gap-1" data-testid="badge-total-hours">
          <Timer className="h-3.5 w-3.5" />
          {summary?.totalHours || 0}h
        </Badge>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {authError && (
          <Card className="border-red-300 dark:border-red-800">
            <CardContent className="py-3 px-4 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Session har gått ut. Gå tillbaka och logga in igen.
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="py-3 px-3 text-center">
              <Wrench className="h-4 w-4 mx-auto text-green-500 mb-1" />
              <p className="text-xs text-muted-foreground">Arbete</p>
              <p className="text-sm font-semibold" data-testid="text-work-minutes">{formatMinutes(summary?.totalWork || 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-3 text-center">
              <Truck className="h-4 w-4 mx-auto text-blue-500 mb-1" />
              <p className="text-xs text-muted-foreground">Resa</p>
              <p className="text-sm font-semibold" data-testid="text-travel-minutes">{formatMinutes(summary?.totalTravel || 0)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-3 text-center">
              <Coffee className="h-4 w-4 mx-auto text-amber-500 mb-1" />
              <p className="text-xs text-muted-foreground">Rast</p>
              <p className="text-sm font-semibold" data-testid="text-break-minutes">{formatMinutes(summary?.totalBreak || 0)}</p>
            </CardContent>
          </Card>
        </div>

        {segments.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Visuell tidslinje
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-4">
              <div className="relative flex h-8 rounded-lg overflow-hidden border" data-testid="timeline-bar">
                {segments.map((seg, i) => {
                  const colors = ENTRY_COLORS[seg.type] || ENTRY_COLORS.work;
                  return (
                    <div
                      key={seg.id}
                      className={`${colors.bg} ${i > 0 ? "border-l border-background" : ""} relative group cursor-pointer hover:brightness-90 transition-all`}
                      style={{ width: `${seg.pct}%` }}
                      title={`${ENTRY_LABELS[seg.type] || seg.type}: ${formatMinutes(seg.duration || 0)}${seg.orderTitle ? ` — ${seg.orderTitle}` : ""}`}
                      onClick={() => handleEditOpen(seg)}
                      data-testid={`timeline-segment-${seg.id}`}
                    >
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[9px] font-medium truncate px-0.5">{formatMinutes(seg.duration || 0)}</span>
                      </div>
                    </div>
                  );
                })}
                {nowPos !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                    style={{ left: `${nowPos}%` }}
                    data-testid="timeline-now-indicator"
                  >
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                {entries.length > 0 && entries[0].startTime && (
                  <span>{formatTime(entries[0].startTime)}</span>
                )}
                {entries.length > 0 && entries[entries.length - 1]?.endTime && (
                  <span>{formatTime(entries[entries.length - 1].endTime!)}</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-green-400" /> Arbete
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-400" /> Resa
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Rast
                </span>
                <span className="flex items-center gap-1 ml-auto">
                  <span className="w-2.5 h-0.5 bg-red-500" /> Nu
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Timer className="h-4 w-4" />
              Tidsposter ({entries.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 px-4">
            {entriesLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground" data-testid="timeline-loading">
                Laddar tidsposter...
              </div>
            ) : entries.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground" data-testid="timeline-empty">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Inga tidsposter idag
              </div>
            ) : (
              <div className="divide-y">
                {entries.map((entry, idx) => {
                  const colors = ENTRY_COLORS[entry.type] || ENTRY_COLORS.work;
                  const Icon = colors.icon;
                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 py-3"
                      data-testid={`time-entry-${entry.id}`}
                    >
                      <div className="relative flex flex-col items-center">
                        <div className={`h-8 w-8 rounded-full ${colors.bg} flex items-center justify-center shrink-0`}>
                          <Icon className={`h-4 w-4 ${colors.text}`} />
                        </div>
                        {idx < entries.length - 1 && (
                          <div className="w-0.5 flex-1 bg-border mt-1 min-h-[16px]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{ENTRY_LABELS[entry.type] || entry.type}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleEditOpen(entry)}
                            data-testid={`button-edit-entry-${entry.id}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {entry.startTime ? formatTime(entry.startTime) : "\u2014"}
                          {" \u2192 "}
                          {entry.endTime ? formatTime(entry.endTime) : "p\u00e5g\u00e5r"}
                        </p>
                        {entry.duration !== null && (
                          <Badge variant="secondary" className="text-[10px] mt-1">
                            {formatMinutes(entry.duration)}
                          </Badge>
                        )}
                        {entry.orderTitle && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {entry.orderTitle}
                          </p>
                        )}
                        {entry.note && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic truncate">
                            {entry.note}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent className="max-w-[350px]">
          <DialogHeader>
            <DialogTitle className="text-base">Korrigera tid</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{ENTRY_LABELS[editingEntry.type] || editingEntry.type}</Badge>
                {editingEntry.orderTitle && (
                  <span className="text-xs text-muted-foreground truncate">{editingEntry.orderTitle}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Starttid</label>
                  <Input
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    data-testid="input-edit-start-time"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Sluttid</label>
                  <Input
                    type="time"
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    data-testid="input-edit-end-time"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditingEntry(null)} data-testid="button-cancel-edit">
              Avbryt
            </Button>
            <Button onClick={handleEditSave} disabled={correctionMutation.isPending} data-testid="button-save-edit">
              {correctionMutation.isPending ? "Sparar..." : "Spara"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
