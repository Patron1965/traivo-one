import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AlertTriangle, Loader2, User, Sparkles, Wand2, Mail, Copy, Check, Link2, ArrowRight, Trash2, Send, MapPin } from "lucide-react";
import { format, startOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject } from "@shared/schema";
import type { ViewMode, PendingSchedule, AutoFillAssignment, AutoFillDiag } from "./types";

interface AssignDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobToAssign: WorkOrderWithObject | null;
  assignDate: string;
  setAssignDate: (v: string) => void;
  assignResourceId: string | null;
  setAssignResourceId: (v: string) => void;
  resources: Resource[];
  onConfirm: () => void;
  isPending: boolean;
}

export const AssignDialog = memo(function AssignDialog(props: AssignDialogProps) {
  const { open, onOpenChange, jobToAssign, assignDate, setAssignDate, assignResourceId, setAssignResourceId, resources, onConfirm, isPending } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tilldela resurs</DialogTitle>
          <DialogDescription>
            Välj resurs och datum för: {jobToAssign?.title}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Datum</Label>
            <Input type="date" value={assignDate} onChange={(e) => setAssignDate(e.target.value)} data-testid="input-assign-date" />
          </div>
          <div className="space-y-2">
            <Label>Resurs</Label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className={`p-3 rounded-md border cursor-pointer hover-elevate ${assignResourceId === resource.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setAssignResourceId(resource.id)}
                  data-testid={`assign-resource-${resource.id}`}
                >
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{resource.name}</span>
                    <Badge variant="secondary" className="text-xs ml-auto">{resource.resourceType}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button onClick={onConfirm} disabled={!assignResourceId || isPending} data-testid="button-confirm-assign">
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Tilldela
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

interface SendScheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: Resource | null;
  onSendEmail: () => void;
  onCopyLink: () => void;
  copied: boolean;
  isPending: boolean;
}

export const SendScheduleDialog = memo(function SendScheduleDialog(props: SendScheduleDialogProps) {
  const { open, onOpenChange, resource, onSendEmail, onCopyLink, copied, isPending } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Skicka schema</DialogTitle>
          <DialogDescription>Skicka schemat till {resource?.name} för aktuell period</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {resource && (
            <>
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{resource.name}</div>
                    <div className="text-sm text-muted-foreground">{resource.email || "Ingen e-post"}</div>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <Button className="w-full justify-start gap-3" variant="outline" onClick={onSendEmail} disabled={!resource.email || isPending} data-testid="button-send-schedule-email">
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  <div className="text-left flex-1">
                    <div>Skicka via e-post</div>
                    <div className="text-xs text-muted-foreground">{resource.email || "Ingen e-post registrerad"}</div>
                  </div>
                </Button>
                <Button className="w-full justify-start gap-3" variant="outline" onClick={onCopyLink} data-testid="button-copy-field-link">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  <div className="text-left flex-1">
                    <div>Kopiera länk till Traivo Go</div>
                    <div className="text-xs text-muted-foreground">Klistra in i SMS eller meddelande</div>
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Konflikt upptäckt
          </DialogTitle>
          <DialogDescription>Följande konflikter identifierades vid schemaläggning. Du kan välja att schemalägga ändå.</DialogDescription>
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
              {pendingSchedule.conflicts.map((conflict, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-950/30 rounded border border-red-200 dark:border-red-800">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-sm">{conflict}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} data-testid="button-cancel-conflict">Avbryt</Button>
          <Button variant="destructive" onClick={onAccept} data-testid="button-accept-conflict">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Schemalägg ändå
          </Button>
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
            Är du säker? <strong>{jobCount} schemalagda jobb</strong> i {viewMode === "month" ? "denna månad" : viewMode === "day" ? "denna dag" : "denna vecka"} kommer att avplaneras och flyttas tillbaka till orderstocken.
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
                    <p className="text-amber-500">{diag.clusterSkipped} av dessa saknar matchande resurs för sitt kluster.</p>
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
                      const quality = focusPct >= 80 ? "text-green-600" : focusPct >= 60 ? "text-amber-500" : "text-red-500";
                      const bgColor = focusPct >= 80 ? "bg-green-500" : focusPct >= 60 ? "bg-amber-500" : "bg-red-500";
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
                        <p className="flex items-center gap-1"><Check className="h-3.5 w-3.5 text-green-500" /> Alla uppdrag är redan planerade.</p>
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
                                      <div className={`h-full rounded-full ${fillPct >= 95 ? 'bg-red-500' : fillPct >= 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${fillPct}%` }} />
                                    </div>
                                    <p className="mt-0.5">{fillPct}%</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {diag.clusterSkipped > 0 && (
                            <p className="text-amber-500 mt-1">{diag.clusterSkipped} uppdrag saknar matchande resurs för sitt kluster (geografiskt område).</p>
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
            <Link2 className="h-5 w-5 text-orange-500" />
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
                <div key={i} className={`p-3 border rounded-lg flex items-start gap-3 ${item.workOrder.creationMethod === "automatic" ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : ""}`}>
                  <div className="shrink-0 mt-0.5">
                    {item.type === "depends_on" ? <Link2 className="h-4 w-4 text-orange-500" /> : <ArrowRight className="h-4 w-4 text-blue-500" />}
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
                        <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Plockuppgift</Badge>
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
