import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Loader2, User, Sparkles, Wand2, Mail, Copy, Check, Link2, ArrowRight, Trash2, Send, MapPin, Calendar, ChevronRight, MessageSquare, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format, startOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject } from "@shared/schema";
import type { ViewMode, PendingSchedule, AutoFillAssignment, AutoFillDiag } from "./types";

interface SendScheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: Resource | null;
  onSend: (channels: { email: boolean; sms: boolean }) => void;
  onCopyLink: () => void;
  copied: boolean;
  isPending: boolean;
  channelEmail: boolean;
  setChannelEmail: (v: boolean) => void;
  channelSms: boolean;
  setChannelSms: (v: boolean) => void;
  lastResult: {
    email?: { success: boolean; recipient?: string; error?: string };
    sms?: { success: boolean; recipient?: string; error?: string };
  } | null;
}

export const SendScheduleDialog = memo(function SendScheduleDialog(props: SendScheduleDialogProps) {
  const {
    open, onOpenChange, resource, onSend, onCopyLink, copied, isPending,
    channelEmail, setChannelEmail, channelSms, setChannelSms, lastResult,
  } = props;

  const hasEmail = !!resource?.email;
  const hasPhone = !!resource?.phone;
  const smsAllowedByPref = resource?.smsOnScheduleSend !== false;
  const lastPublishedAt = resource?.lastSchedulePublishedAt
    ? new Date(resource.lastSchedulePublishedAt)
    : null;

  const canSend = (channelEmail && hasEmail) || (channelSms && hasPhone && smsAllowedByPref);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Skicka schema</DialogTitle>
          <DialogDescription>Publicera schemat för {resource?.name} för aktuell period</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {resource && (
            <>
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="font-medium">{resource.name}</div>
                    <div className="text-xs text-muted-foreground" data-testid={`text-last-published-${resource.id}`}>
                      {lastPublishedAt
                        ? `Senast publicerat ${format(lastPublishedAt, "d MMM HH:mm", { locale: sv })}`
                        : "Schemat har inte skickats tidigare"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Välj kanal</div>

                <label
                  className={`flex items-center gap-3 p-3 border rounded-lg ${hasEmail ? "cursor-pointer hover:bg-muted/40" : "opacity-60 cursor-not-allowed"}`}
                  data-testid="row-channel-email"
                >
                  <Checkbox
                    checked={channelEmail && hasEmail}
                    onCheckedChange={(v) => setChannelEmail(!!v)}
                    disabled={!hasEmail}
                    data-testid="checkbox-channel-email"
                  />
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">E-post</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {resource.email || "Ingen e-post registrerad"}
                    </div>
                  </div>
                </label>

                <label
                  className={`flex items-center gap-3 p-3 border rounded-lg ${hasPhone && smsAllowedByPref ? "cursor-pointer hover:bg-muted/40" : "opacity-60 cursor-not-allowed"}`}
                  data-testid="row-channel-sms"
                >
                  <Checkbox
                    checked={channelSms && hasPhone && smsAllowedByPref}
                    onCheckedChange={(v) => setChannelSms(!!v)}
                    disabled={!hasPhone || !smsAllowedByPref}
                    data-testid="checkbox-channel-sms"
                  />
                  <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">SMS</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {!hasPhone
                        ? "Inget telefonnummer registrerat"
                        : !smsAllowedByPref
                          ? "Teknikern har stängt av SMS-utskick"
                          : resource.phone}
                    </div>
                  </div>
                </label>

                {lastResult && (
                  <div className="space-y-2 mt-2">
                    {lastResult.email && (
                      <div className={`flex items-start gap-2 text-xs p-2 rounded ${lastResult.email.success ? "bg-chart-2/10 text-chart-2 dark:bg-chart-2/15" : "bg-destructive/10 text-destructive dark:bg-destructive/15"}`} data-testid="status-email-result">
                        {lastResult.email.success ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                        <div>
                          <div className="font-medium">E-post {lastResult.email.success ? "skickad" : "misslyckades"}</div>
                          <div className="text-[11px] opacity-80">{lastResult.email.success ? `Till ${lastResult.email.recipient}` : (lastResult.email.error || "Okänt fel")}</div>
                        </div>
                      </div>
                    )}
                    {lastResult.sms && (
                      <div className={`flex items-start gap-2 text-xs p-2 rounded ${lastResult.sms.success ? "bg-chart-2/10 text-chart-2 dark:bg-chart-2/15" : "bg-destructive/10 text-destructive dark:bg-destructive/15"}`} data-testid="status-sms-result">
                        {lastResult.sms.success ? <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                        <div>
                          <div className="font-medium">SMS {lastResult.sms.success ? "skickat" : "misslyckades"}</div>
                          <div className="text-[11px] opacity-80">{lastResult.sms.success ? `Till ${lastResult.sms.recipient}` : (lastResult.sms.error || "Okänt fel")}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  className="w-full gap-2"
                  onClick={() => onSend({ email: channelEmail && hasEmail, sms: channelSms && hasPhone && smsAllowedByPref })}
                  disabled={!canSend || isPending}
                  data-testid="button-send-schedule"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Publicera schema
                </Button>

                <Button className="w-full justify-start gap-3" variant="outline" onClick={onCopyLink} data-testid="button-copy-field-link">
                  {copied ? <Check className="h-4 w-4 text-chart-2" /> : <Copy className="h-4 w-4" />}
                  <div className="text-left flex-1">
                    <div>Kopiera länk till Traivo Go</div>
                    <div className="text-xs text-muted-foreground">Klistra in i annat meddelande</div>
                  </div>
                </Button>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Stäng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface BulkSendScheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resources: Resource[];
  resourceJobCount: Record<string, number>;
  selectedResourceIds: Set<string>;
  setSelectedResourceIds: (s: Set<string>) => void;
  channelEmail: boolean;
  setChannelEmail: (v: boolean) => void;
  channelSms: boolean;
  setChannelSms: (v: boolean) => void;
  onSend: () => void;
  isPending: boolean;
  results: Record<string, { email?: { success: boolean; error?: string }; sms?: { success: boolean; error?: string } }>;
}

export const BulkSendScheduleDialog = memo(function BulkSendScheduleDialog(props: BulkSendScheduleDialogProps) {
  const {
    open, onOpenChange, resources, resourceJobCount,
    selectedResourceIds, setSelectedResourceIds,
    channelEmail, setChannelEmail, channelSms, setChannelSms,
    onSend, isPending, results,
  } = props;

  const eligibleResources = useMemo(
    () => resources.filter(r => (resourceJobCount[r.id] || 0) > 0),
    [resources, resourceJobCount]
  );
  const allSelected = eligibleResources.length > 0 && eligibleResources.every(r => selectedResourceIds.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelectedResourceIds(new Set());
    else setSelectedResourceIds(new Set(eligibleResources.map(r => r.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedResourceIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedResourceIds(next);
  };

  const canSend = selectedResourceIds.size > 0 && (channelEmail || channelSms);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicera schema till flera</DialogTitle>
          <DialogDescription>
            Välj tekniker som ska få veckans schema och vilka kanaler som ska användas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="bulk-checkbox-email-row">
              <Checkbox checked={channelEmail} onCheckedChange={(v) => setChannelEmail(!!v)} data-testid="bulk-checkbox-email" />
              <Mail className="h-4 w-4" /> E-post
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="bulk-checkbox-sms-row">
              <Checkbox checked={channelSms} onCheckedChange={(v) => setChannelSms(!!v)} data-testid="bulk-checkbox-sms" />
              <MessageSquare className="h-4 w-4" /> SMS
            </label>
          </div>

          <div className="border rounded-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="bulk-checkbox-all" />
                Alla med jobb ({eligibleResources.length})
              </label>
              <span className="text-xs text-muted-foreground">{selectedResourceIds.size} valda</span>
            </div>
            <ScrollArea className="max-h-[280px]">
              <div className="divide-y">
                {eligibleResources.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground text-center">Inga tekniker har planerade jobb i aktuell period.</div>
                )}
                {eligibleResources.map(r => {
                  const res = results[r.id];
                  const lastPublishedAt = r.lastSchedulePublishedAt ? new Date(r.lastSchedulePublishedAt) : null;
                  return (
                    <label
                      key={r.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40"
                      data-testid={`bulk-row-${r.id}`}
                    >
                      <Checkbox
                        checked={selectedResourceIds.has(r.id)}
                        onCheckedChange={() => toggleOne(r.id)}
                        data-testid={`bulk-checkbox-${r.id}`}
                      />
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">{r.initials || r.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {resourceJobCount[r.id] || 0} jobb •{" "}
                          {lastPublishedAt ? `senast ${format(lastPublishedAt, "d MMM HH:mm", { locale: sv })}` : "ej skickat"}
                        </div>
                      </div>
                      {res && (
                        <div className="flex items-center gap-1">
                          {res.email && (res.email.success
                            ? <Check className="h-4 w-4 text-chart-2" data-testid={`bulk-status-email-ok-${r.id}`} />
                            : <X className="h-4 w-4 text-destructive" data-testid={`bulk-status-email-fail-${r.id}`} />)}
                          {res.sms && (res.sms.success
                            ? <Check className="h-4 w-4 text-chart-2" data-testid={`bulk-status-sms-ok-${r.id}`} />
                            : <X className="h-4 w-4 text-destructive" data-testid={`bulk-status-sms-fail-${r.id}`} />)}
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Stäng</Button>
          <Button onClick={onSend} disabled={!canSend || isPending} data-testid="button-bulk-send-schedule">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Publicera till valda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface ConflictDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pendingSchedule: PendingSchedule | null;
  workOrders: WorkOrderWithObject[];
  onAccept: () => void;
  onCancel: () => void;
}

export const ConflictDialog = memo(function ConflictDialog(props: ConflictDialogProps) {
  const { open, onOpenChange, pendingSchedule, workOrders, onAccept, onCancel } = props;
  const hasHardBlock = pendingSchedule?.conflicts.some(c => c.startsWith("[BLOCK]")) ?? false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5 text-warning" />
            {hasHardBlock ? "Tilldelning blockerad" : "Konflikt upptäckt"}
          </DialogTitle>
          <DialogDescription>
            {hasHardBlock
              ? "Denna order kan inte tilldelas — verksamhetsområdesregeln förhindrar tilldelningen."
              : "Följande konflikter identifierades vid schemaläggning. Du kan välja att schemalägga ändå."}
          </DialogDescription>
        </DialogHeader>
        {pendingSchedule && (
          <div className="space-y-3 py-2">
            <div className="p-3 bg-muted rounded-lg text-sm">
              <div className="font-medium">{workOrders.find(j => j.id === pendingSchedule.jobId)?.title}</div>
              <div className="text-muted-foreground text-xs mt-1">
                Planerad: {pendingSchedule.scheduledDate}
                {pendingSchedule.scheduledStartTime && ` kl ${pendingSchedule.scheduledStartTime}`}
              </div>
            </div>
            <div className="space-y-2">
              {pendingSchedule.conflicts.map((conflict, i) => {
                const isHardBlock = conflict.startsWith("[BLOCK]");
                const isClusterWarning = !isHardBlock && conflict.includes("Kluster");
                const displayText = isHardBlock ? conflict.replace("[BLOCK] ", "") : conflict;
                return (
                <div key={i} className={`flex items-start gap-2 p-2 rounded border ${isHardBlock ? "bg-destructive/15 dark:bg-destructive/15 border-destructive/30 dark:border-destructive/70" : isClusterWarning ? "bg-warning/10 dark:bg-warning/15 border-warning/20 dark:border-warning/80" : "bg-destructive/10 dark:bg-destructive/15 border-destructive/20 dark:border-destructive/80"}`}>
                  <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${isHardBlock ? "text-destructive" : isClusterWarning ? "text-warning" : "text-destructive"}`} />
                  <span className="text-sm">{displayText}</span>
                </div>
                );
              })}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} data-testid="button-cancel-conflict">
            {hasHardBlock ? "Stäng" : "Avbryt"}
          </Button>
          {!hasHardBlock && (
            <Button variant="destructive" onClick={onAccept} data-testid="button-accept-conflict">
              <AlertTriangle className="h-4 w-4 mr-2 text-warning" />
              Schemalägg ändå
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface ClearDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  viewMode: ViewMode;
  jobCount: number;
  onConfirm: () => void;
  loading: boolean;
}

export const ClearDialog = memo(function ClearDialog(props: ClearDialogProps) {
  const { open, onOpenChange, viewMode, jobCount, onConfirm, loading } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Rensa planering
          </DialogTitle>
          <DialogDescription>
            Är du säker? <strong>{jobCount} schemalagda jobb</strong> i {viewMode === "year" ? "detta år" : viewMode === "quarter" ? "detta kvartal" : viewMode === "month" ? "denna månad" : viewMode === "day" ? "denna dag" : "denna vecka"} kommer att avplaneras och flyttas tillbaka till orderstocken.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-clear">Avbryt</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading} data-testid="button-confirm-clear">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Rensa {jobCount} jobb
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface AutoFillDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  overbooking: number;
  setOverbooking: (v: number) => void;
  geoClustering: boolean;
  setGeoClustering: (v: boolean) => void;
  planningMode: "balanced" | "delivery_time";
  setPlanningMode: (v: "balanced" | "delivery_time") => void;
  geoSpread: Record<string, { totalJobs: number; zonesUsed: number; dominantZonePct: number }> | null;
  loading: boolean;
  applying: boolean;
  preview: AutoFillAssignment[] | null;
  skipped: number;
  diag: AutoFillDiag | null;
  resources: Resource[];
  viewMode: ViewMode;
  currentWeekStart: Date;
  currentDate: Date;
  onPreview: () => void;
  onApply: () => void;
}

export const AutoFillDialog = memo(function AutoFillDialog(props: AutoFillDialogProps) {
  const {
    open, onOpenChange, overbooking, setOverbooking, geoClustering, setGeoClustering,
    planningMode, setPlanningMode,
    geoSpread, loading, applying,
    preview, skipped, diag, resources, viewMode, currentWeekStart, currentDate,
    onPreview, onApply,
  } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Fyll veckan automatiskt
          </DialogTitle>
          <DialogDescription>
            Fyll lediga tider i veckan med oplanerade uppdrag. Algoritmen prioriterar brådsamma uppdrag och minimerar körsträckan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-2 block">Planeringsläge</label>
            <div className="grid grid-cols-2 gap-2" data-testid="planning-mode-selector">
              <button
                type="button"
                onClick={() => setPlanningMode("balanced")}
                className={`rounded-lg border p-3 text-left transition-colors ${planningMode === "balanced" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
                data-testid="planning-mode-balanced"
              >
                <span className="text-sm font-medium block">Balanserad</span>
                <span className="text-xs text-muted-foreground">Prioritet först, sedan körsträcka</span>
              </button>
              <button
                type="button"
                onClick={() => setPlanningMode("delivery_time")}
                className={`rounded-lg border p-3 text-left transition-colors ${planningMode === "delivery_time" ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50"}`}
                data-testid="planning-mode-delivery-time"
              >
                <span className="text-sm font-medium block">Efter leveranstid</span>
                <span className="text-xs text-muted-foreground">Önskad/krävd leveranstid styr först</span>
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">Överbokningstolerans: {overbooking}%</label>
            <input type="range" min={0} max={50} step={5} value={overbooking} onChange={(e) => setOverbooking(Number(e.target.value))} className="w-full accent-primary" data-testid="slider-overbooking" />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0% (exakt)</span><span>25%</span><span>50% (max)</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer" data-testid="toggle-geo-clustering">
              <input type="checkbox" checked={geoClustering} onChange={(e) => setGeoClustering(e.target.checked)} className="h-4 w-4 rounded border-border accent-primary" />
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Geografisk dagsklustring</span>
            </label>
            <span className="text-xs text-muted-foreground">Gruppera uppdrag per område och dag</span>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onPreview} disabled={loading} data-testid="button-auto-fill-preview">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Förhandsgranska
            </Button>
            <span className="text-xs text-muted-foreground">
              {resources.length} resurser, v.{format(viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 }), "w", { locale: sv })}
            </span>
          </div>
          {preview && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="default">{preview.length} tilldelade</Badge>
                {skipped > 0 && <Badge variant="secondary">{skipped} ryms ej</Badge>}
              </div>
              {skipped > 0 && preview.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{skipped} uppdrag ryms ej i schemat och förblir oplanerade i orderstocken.</p>
                  {diag && diag.clusterSkipped > 0 && (
                    <p className="text-warning">{diag.clusterSkipped} av dessa saknar matchande resurs för sitt kluster.</p>
                  )}
                </div>
              )}
              {geoSpread && Object.keys(geoSpread).length > 0 && (
                <div className="border rounded-lg p-3 bg-muted/30" data-testid="geo-spread-indicator">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Geografisk spridning per dag</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {Object.entries(geoSpread).sort().map(([day, info]) => {
                      const focusPct = info.dominantZonePct;
                      const quality = focusPct >= 80 ? "text-chart-2" : focusPct >= 60 ? "text-warning" : "text-destructive";
                      const bgColor = focusPct >= 80 ? "bg-chart-2/15" : focusPct >= 60 ? "bg-warning/15" : "bg-destructive/15";
                      return (
                        <div key={day} className="text-center text-xs" data-testid={`geo-spread-day-${day}`}>
                          <p className="font-medium">{format(new Date(day + "T12:00:00"), "EEE", { locale: sv })}</p>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                            <div className={`h-full rounded-full ${bgColor}`} style={{ width: `${focusPct}%` }} />
                          </div>
                          <p className={`mt-0.5 font-medium ${quality}`}>{focusPct}%</p>
                          <p className="text-muted-foreground">{info.zonesUsed} zon{info.zonesUsed !== 1 ? "er" : ""}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Högre procent = mer koncentrerad geografisk planering per dag</p>
                </div>
              )}
              {preview.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_120px_80px_60px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    <span>Uppdrag</span><span>Resurs</span><span>Dag</span><span>Tid</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {preview.map((a, i) => {
                      const resource = resources.find(r => r.id === a.resourceId);
                      return (
                        <div key={i} className="grid grid-cols-[1fr_120px_80px_60px] gap-2 px-3 py-2 border-t text-sm items-center" data-testid={`auto-fill-row-${i}`}>
                          <div className="truncate">
                            <span className="font-medium">{a.title}</span>
                            {a.address && <span className="text-xs text-muted-foreground ml-1">- {a.address}</span>}
                          </div>
                          <span className="text-xs">{resource?.name || a.resourceId}</span>
                          <span className="text-xs">{format(new Date(a.scheduledDate + "T12:00:00"), "EEE d/M", { locale: sv })}</span>
                          <span className="text-xs">{a.scheduledStartTime}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {preview.length === 0 && (
                <div className="p-4 text-sm border rounded-lg space-y-2">
                  <p className="text-center text-muted-foreground font-medium">Inga uppdrag kunde tilldelas denna vecka.</p>
                  {diag && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {diag.totalUnscheduled === 0 ? (
                        <p className="flex items-center gap-1"><Check className="h-3.5 w-3.5 text-chart-2" /> Alla uppdrag är redan planerade.</p>
                      ) : (
                        <>
                          <p>{diag.totalUnscheduled} oplanerade uppdrag hittades men ryms ej i schemat.</p>
                          <p>{diag.resourceCount} resurser × 5 dagar = {diag.resourceCount * 5} resursdagar (max {Math.round(diag.maxMinutesPerDay / 60)}h/dag)</p>
                          {Object.entries(diag.capacityPerDay).length > 0 && (
                            <div className="grid grid-cols-5 gap-1 mt-1">
                              {Object.entries(diag.capacityPerDay).sort().map(([day, mins]) => {
                                const totalCapacity = diag!.maxMinutesPerDay * diag!.resourceCount;
                                const fillPct = Math.min(100, Math.round((mins / totalCapacity) * 100));
                                return (
                                  <div key={day} className="text-center">
                                    <p className="font-medium">{day.slice(5)}</p>
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-0.5">
                                      <div className={`h-full rounded-full ${fillPct >= 95 ? 'bg-destructive/15' : fillPct >= 70 ? 'bg-warning/15' : 'bg-chart-2/15'}`} style={{ width: `${fillPct}%` }} />
                                    </div>
                                    <p className="mt-0.5">{fillPct}%</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {diag.clusterSkipped > 0 && (
                            <p className="text-warning mt-1">{diag.clusterSkipped} uppdrag saknar matchande resurs för sitt kluster (geografiskt område).</p>
                          )}
                          <p className="mt-1">Prova att öka överbokningsprocenten eller byta till en annan vecka.</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-auto-fill">Avbryt</Button>
          {preview && preview.length > 0 && (
            <Button onClick={onApply} disabled={applying} data-testid="button-apply-auto-fill">
              {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Tillämpa ({preview.length} uppdrag)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface DepChainDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  depChainJobId: string | null;
  workOrders: WorkOrderWithObject[];
  depChainData?: { chain: Array<{ type: string; dependencyType: string; workOrder: { id: string; title: string; status: string; executionStatus: string; scheduledDate: string | null; scheduledStartTime: string | null; creationMethod: string | null } }> } | null;
}

export const DepChainDialog = memo(function DepChainDialog(props: DepChainDialogProps) {
  const { open, onOpenChange, depChainJobId, workOrders, depChainData } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-warning" />
            Beroendekedja
          </DialogTitle>
          <DialogDescription>Visar alla uppgifter som är kopplade via beroenden.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {depChainJobId && (
            <div className="p-3 border rounded-lg bg-primary/5">
              <div className="text-sm font-medium">{workOrders.find(w => w.id === depChainJobId)?.title || "Vald uppgift"}</div>
              <div className="text-xs text-muted-foreground">{workOrders.find(w => w.id === depChainJobId)?.objectName}</div>
            </div>
          )}
          {depChainData?.chain && depChainData.chain.length > 0 ? (
            <div className="space-y-2">
              {depChainData.chain.map((item, i) => (
                <div key={i} className={`p-3 border rounded-lg flex items-start gap-3 ${item.workOrder.creationMethod === "automatic" ? "border-warning/30 bg-warning/10 dark:border-warning/70 dark:bg-warning/15" : ""}`}>
                  <div className="shrink-0 mt-0.5">
                    {item.type === "depends_on" ? <Link2 className="h-4 w-4 text-warning" /> : <ArrowRight className="h-4 w-4 text-chart-1" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{item.workOrder.title}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {item.type === "depends_on" ? "Föregångare" : "Efterföljare"}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {item.dependencyType === "automatic" ? "Automatisk" : item.dependencyType === "structural" ? "Strukturell" : "Sekventiell"}
                      </Badge>
                      {item.workOrder.scheduledDate && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(item.workOrder.scheduledDate).toLocaleDateString("sv-SE")}
                          {item.workOrder.scheduledStartTime && ` ${item.workOrder.scheduledStartTime}`}
                        </span>
                      )}
                      {item.workOrder.creationMethod === "automatic" && (
                        <Badge className="text-[10px] bg-warning/15 text-warning dark:bg-warning/15">Plockuppgift</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-muted-foreground">Inga beroenden hittades</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-dep-chain">Stäng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface ConflictListDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobConflicts: Record<string, string[]>;
  workOrders: WorkOrderWithObject[];
  resources: Resource[];
  onNavigateToJob: (jobId: string, date: Date) => void;
}

export const ConflictListDialog = memo(function ConflictListDialog({ open, onOpenChange, jobConflicts, workOrders, resources, onNavigateToJob }: ConflictListDialogProps) {
  const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);
  const conflictEntries = useMemo(() => {
    const entries: Array<{ job: WorkOrderWithObject; reasons: string[]; resourceName: string; dateStr: string }> = [];
    for (const [jobId, reasons] of Object.entries(jobConflicts)) {
      const job = workOrders.find(wo => wo.id === jobId);
      if (!job) continue;
      const resource = job.resourceId ? resourceMap.get(job.resourceId) : null;
      entries.push({
        job,
        reasons,
        resourceName: resource?.name || "Ej tilldelad",
        dateStr: job.scheduledDate ? format(new Date(job.scheduledDate), "EEE d MMM", { locale: sv }) : "—",
      });
    }
    entries.sort((a, b) => {
      if (!a.job.scheduledDate || !b.job.scheduledDate) return 0;
      return new Date(a.job.scheduledDate).getTime() - new Date(b.job.scheduledDate).getTime();
    });
    return entries;
  }, [jobConflicts, workOrders, resourceMap]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col" data-testid="dialog-conflict-list">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {conflictEntries.length} konflikter
          </DialogTitle>
          <DialogDescription>
            Klicka på ett jobb för att navigera till det i planeringsvyn.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-2 py-2">
            {conflictEntries.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">Inga konflikter att visa</div>
            )}
            {conflictEntries.map(({ job, reasons, resourceName, dateStr }) => (
              <button
                key={job.id}
                onClick={() => {
                  if (job.scheduledDate) {
                    onNavigateToJob(job.id, new Date(job.scheduledDate));
                  }
                  onOpenChange(false);
                }}
                className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors group cursor-pointer"
                data-testid={`conflict-item-${job.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{job.title}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{resourceName}</span>
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{dateStr}</span>
                      {job.scheduledStartTime && <span>{job.scheduledStartTime}</span>}
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {reasons.map((reason, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-warning" />
                          <span>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0 mt-1 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-conflict-list">Stäng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
