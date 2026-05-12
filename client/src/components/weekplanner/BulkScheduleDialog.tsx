import { memo, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { Resource, WorkOrderWithObject } from "@shared/schema";

interface BulkScheduleResult {
  workOrderId: string;
  status: "scheduled" | "conflict" | "blocked" | "error";
  conflictReasons: string[];
  message?: string;
}

interface BulkScheduleResponse {
  summary: { total: number; scheduled: number; conflict: number; blocked: number; error: number };
  results: BulkScheduleResult[];
}

interface BulkScheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workOrderIds: string[];
  jobs: WorkOrderWithObject[];
  resources: Resource[];
  teams: Array<{ id: string; name: string }>;
  onSuccess: () => void;
}

export const BulkScheduleDialog = memo(function BulkScheduleDialog(props: BulkScheduleDialogProps) {
  const { open, onOpenChange, workOrderIds, jobs, resources, teams, onSuccess } = props;
  const { toast } = useToast();
  const [target, setTarget] = useState<"resource" | "team">("resource");
  const [resourceId, setResourceId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [scheduledStartTime, setScheduledStartTime] = useState<string>("");
  const [results, setResults] = useState<BulkScheduleResponse | null>(null);
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);

  useEffect(() => {
    if (open) {
      setResults(null);
      setShowConflictsOnly(false);
    }
  }, [open]);

  const jobMap = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs]);

  const mutation = useMutation({
    mutationFn: async (vars: { force: boolean; ids?: string[] }) => {
      const ids = vars.ids && vars.ids.length > 0 ? vars.ids : workOrderIds;
      const body: Record<string, unknown> = {
        workOrderIds: ids,
        scheduledDate,
        force: vars.force,
      };
      if (target === "resource") body.resourceId = resourceId;
      else body.teamId = teamId;
      if (scheduledStartTime) body.scheduledStartTime = scheduledStartTime;
      const res = await apiRequest("POST", "/api/work-orders/bulk-schedule", body);
      const json = (await res.json()) as BulkScheduleResponse;
      return { data: json, isPartial: !!vars.ids && vars.ids.length > 0 };
    },
    onSuccess: ({ data, isPartial }) => {
      setResults(prev => {
        if (!prev || !isPartial) return data;
        // Merge per-row retry results into existing state
        const byId = new Map(data.results.map(r => [r.workOrderId, r]));
        const merged = prev.results.map(r => byId.get(r.workOrderId) ?? r);
        const summary = {
          total: merged.length,
          scheduled: merged.filter(r => r.status === "scheduled").length,
          conflict: merged.filter(r => r.status === "conflict").length,
          blocked: merged.filter(r => r.status === "blocked").length,
          error: merged.filter(r => r.status === "error").length,
        };
        return { results: merged, summary };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/planner/area-search"] });
      if (data.summary.scheduled > 0) {
        toast({
          title: "Bulk-schemaläggning klar",
          description: `${data.summary.scheduled} av ${data.summary.total} order schemalagda${data.summary.conflict ? ` (${data.summary.conflict} konflikter)` : ""}${data.summary.blocked ? ` (${data.summary.blocked} blockerade)` : ""}.`,
        });
        // Defer selection clearing until dialog is closed so a follow-up
        // force-retry on remaining conflicts still has the original IDs.
      } else if (data.summary.scheduled === 0 && data.summary.conflict + data.summary.blocked + data.summary.error > 0) {
        toast({
          title: "Inga order schemalagda",
          description: `Alla ${data.summary.total} order har konflikter eller fel. Granska listan nedan.`,
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Bulk-schemaläggning misslyckades",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit = workOrderIds.length > 0 && scheduledDate && (
    (target === "resource" && resourceId) || (target === "team" && teamId)
  );

  const visibleResults = useMemo(() => {
    if (!results) return [];
    if (!showConflictsOnly) return results.results;
    return results.results.filter(r => r.status === "conflict" || r.status === "blocked" || r.status === "error");
  }, [results, showConflictsOnly]);

  const hasRetryableConflicts = !!results && results.results.some(r => r.status === "conflict");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="dialog-bulk-schedule">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Schemalägg {workOrderIds.length} order
          </DialogTitle>
          <DialogDescription>
            Välj datum och resurs eller team. Konflikter visas innan de schemaläggs.
          </DialogDescription>
        </DialogHeader>

        {!results && (
          <div className="space-y-4 py-2">
            <Tabs value={target} onValueChange={(v) => setTarget(v as "resource" | "team")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="resource" data-testid="tab-bulk-target-resource">Resurs</TabsTrigger>
                <TabsTrigger value="team" data-testid="tab-bulk-target-team">Team</TabsTrigger>
              </TabsList>
            </Tabs>

            {target === "resource" ? (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-resource">Resurs</Label>
                <Select value={resourceId} onValueChange={setResourceId}>
                  <SelectTrigger id="bulk-resource" data-testid="select-bulk-resource">
                    <SelectValue placeholder="Välj resurs" />
                  </SelectTrigger>
                  <SelectContent>
                    {resources.map(r => (
                      <SelectItem key={r.id} value={r.id} data-testid={`option-bulk-resource-${r.id}`}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-team">Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger id="bulk-team" data-testid="select-bulk-team">
                    <SelectValue placeholder="Välj team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map(t => (
                      <SelectItem key={t.id} value={t.id} data-testid={`option-bulk-team-${t.id}`}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-date">Datum</Label>
                <Input
                  id="bulk-date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  data-testid="input-bulk-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bulk-time">Starttid (valfri)</Label>
                <Input
                  id="bulk-time"
                  type="time"
                  value={scheduledStartTime}
                  onChange={(e) => setScheduledStartTime(e.target.value)}
                  data-testid="input-bulk-time"
                />
              </div>
            </div>

            <div className="text-xs text-muted-foreground rounded border bg-muted/30 p-2.5">
              {workOrderIds.length} order kommer att kontrolleras mot konflikter (kapacitet, kluster, körschema, beroenden).
              Konflikter kan accepteras manuellt i nästa steg.
            </div>
          </div>
        )}

        {results && (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded border bg-chart-2/10 border-chart-2/30 p-2" data-testid="text-bulk-summary-scheduled">
                <div className="text-chart-2 font-semibold text-lg">{results.summary.scheduled}</div>
                <div className="text-muted-foreground">Schemalagda</div>
              </div>
              <div className="rounded border bg-warning/10 border-warning/30 p-2" data-testid="text-bulk-summary-conflict">
                <div className="text-warning font-semibold text-lg">{results.summary.conflict}</div>
                <div className="text-muted-foreground">Konflikt</div>
              </div>
              <div className="rounded border bg-destructive/10 border-destructive/30 p-2" data-testid="text-bulk-summary-blocked">
                <div className="text-destructive font-semibold text-lg">{results.summary.blocked}</div>
                <div className="text-muted-foreground">Blockerade</div>
              </div>
              <div className="rounded border bg-muted p-2" data-testid="text-bulk-summary-error">
                <div className="font-semibold text-lg">{results.summary.error}</div>
                <div className="text-muted-foreground">Fel</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium" data-testid="text-bulk-result-summary">
                {results.summary.scheduled} av {results.summary.total} schemalagda
              </p>
              {(results.summary.conflict + results.summary.blocked + results.summary.error) > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConflictsOnly(v => !v)}
                  data-testid="button-bulk-show-conflicts"
                >
                  {showConflictsOnly ? "Visa alla" : "Visa konflikter"}
                </Button>
              )}
            </div>

            <ScrollArea className="h-64 rounded border">
              <div className="divide-y">
                {visibleResults.map(r => {
                  const job = jobMap.get(r.workOrderId);
                  const Icon = r.status === "scheduled" ? CheckCircle2 : r.status === "blocked" ? ShieldAlert : r.status === "error" ? XCircle : AlertTriangle;
                  const tone = r.status === "scheduled" ? "text-chart-2" : r.status === "blocked" ? "text-destructive" : r.status === "error" ? "text-destructive" : "text-warning";
                  return (
                    <div
                      key={r.workOrderId}
                      className="px-3 py-2 text-xs"
                      data-testid={`row-bulk-result-${r.workOrderId}`}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${tone}`} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{job?.title || r.workOrderId.slice(0, 8)}</div>
                          {r.message && <div className="text-muted-foreground">{r.message}</div>}
                          {r.conflictReasons.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {r.conflictReasons.map((c, i) => (
                                <li key={i} className="text-muted-foreground">
                                  • {c.startsWith("[BLOCK] ") ? c.slice(8) : c}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {r.status === "conflict" && (
                          <div className="flex flex-col gap-1 shrink-0">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              disabled={mutation.isPending}
                              onClick={() => mutation.mutate({ force: true, ids: [r.workOrderId] })}
                              data-testid={`button-bulk-row-force-${r.workOrderId}`}
                            >
                              Schemalägg ändå
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => setResults(prev => prev ? {
                                ...prev,
                                results: prev.results.filter(x => x.workOrderId !== r.workOrderId),
                                summary: { ...prev.summary, conflict: prev.summary.conflict - 1, total: prev.summary.total - 1 },
                              } : prev)}
                              data-testid={`button-bulk-row-skip-${r.workOrderId}`}
                            >
                              Hoppa över
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-bulk-schedule-cancel"
          >
            {results ? "Stäng" : "Avbryt"}
          </Button>
          {!results && (
            <Button
              onClick={() => mutation.mutate({ force: false })}
              disabled={!canSubmit || mutation.isPending}
              data-testid="button-bulk-schedule-submit"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Schemalägg {workOrderIds.length}
            </Button>
          )}
          {results && hasRetryableConflicts && (
            <Button
              variant="destructive"
              onClick={() => mutation.mutate({
                force: true,
                ids: results!.results.filter(r => r.status === "conflict").map(r => r.workOrderId),
              })}
              disabled={mutation.isPending}
              data-testid="button-bulk-schedule-force"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
              Schemalägg ändå (ignorera konflikter)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
