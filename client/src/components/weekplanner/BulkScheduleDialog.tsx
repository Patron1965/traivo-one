import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Lock, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { Resource, WorkOrderWithObject } from "@shared/schema";

type ResourceMatch = { resourceId: string; resourceName: string; score: number; reasons: string[]; clusterMatch: boolean };

export interface AssignmentRecommendationContext {
  objectId?: string | null;
  clusterId?: string | null;
}

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

export interface BulkSchedulePrefill {
  date: string;
  resourceId?: string | null;
  teamId?: string | null;
  target: "resource" | "team";
  /** Optional human-readable note shown in the locked summary (e.g. "Rutt från ankarjobb"). */
  note?: string;
  /** Lock target/date fields so user cannot change them (anchor-route mode). */
  lockTargets?: boolean;
}

interface BulkScheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workOrderIds: string[];
  /** Only `id` + `title` are used to render conflict rows; pass any work-order shape that exposes them. */
  jobs: Array<Pick<WorkOrderWithObject, "id" | "title">>;
  resources: Resource[];
  teams: Array<{ id: string; name: string }>;
  onSuccess: () => void;
  prefill?: BulkSchedulePrefill | null;
  /** Optional cluster/object context for resource-match recommendations (single-order mode). */
  recommendationContext?: AssignmentRecommendationContext | null;
  /** Override dialog title (e.g. "Tilldela resurs" for single-order mode). */
  title?: string;
  description?: string;
}

export const BulkScheduleDialog = memo(function BulkScheduleDialog(props: BulkScheduleDialogProps) {
  const { open, onOpenChange, workOrderIds, jobs, resources, teams, onSuccess, prefill, recommendationContext, title, description } = props;
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
      if (prefill) {
        setTarget(prefill.target);
        setResourceId(prefill.resourceId || "");
        setTeamId(prefill.teamId || "");
        setScheduledDate(prefill.date);
      }
    }
  }, [open, prefill]);

  const isLocked = !!prefill?.lockTargets;
  const targetName = useMemo(() => {
    if (target === "resource") return resources.find(r => r.id === resourceId)?.name || "—";
    return teams.find(t => t.id === teamId)?.name || "—";
  }, [target, resourceId, teamId, resources, teams]);

  const jobMap = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs]);

  // Cluster-match recommendation (single-order assignment mode)
  const matchQueryParam = recommendationContext?.clusterId
    ? `clusterId=${recommendationContext.clusterId}`
    : recommendationContext?.objectId
      ? `objectId=${recommendationContext.objectId}`
      : null;
  const { data: matchData } = useQuery<{ matches: ResourceMatch[]; noMatch: boolean; clusterName: string | null }>({
    queryKey: ["/api/clusters/resource-match", matchQueryParam],
    queryFn: async () => {
      if (!matchQueryParam) return { matches: [], noMatch: false, clusterName: null };
      const res = await fetch(`/api/clusters/resource-match?${matchQueryParam}`, { credentials: "include" });
      if (!res.ok) return { matches: [], noMatch: false, clusterName: null };
      return res.json();
    },
    enabled: open && !!matchQueryParam,
    staleTime: 30000,
  });
  const matchScoreMap = useMemo(() => {
    const map = new Map<string, ResourceMatch>();
    if (matchData?.matches) for (const m of matchData.matches) map.set(m.resourceId, m);
    return map;
  }, [matchData]);
  const sortedResources = useMemo(() => {
    if (!matchScoreMap.size) return resources;
    return [...resources].sort((a, b) => {
      const aScore = matchScoreMap.get(a.id)?.score ?? 50;
      const bScore = matchScoreMap.get(b.id)?.score ?? 50;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });
  }, [resources, matchScoreMap]);

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
      let mergedSummary = data.summary;
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
        mergedSummary = summary;
        return { results: merged, summary };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/planner/area-search"] });
      // Also refresh OrderStock so successful rows disappear from the batch
      // page even when the user keeps the dialog open to retry conflicts.
      queryClient.invalidateQueries({ queryKey: ["/api/order-stock"] });
      if (data.summary.scheduled > 0) {
        toast({
          title: "Bulk-schemaläggning klar",
          description: `${data.summary.scheduled} av ${data.summary.total} order schemalagda${data.summary.conflict ? ` (${data.summary.conflict} konflikter)` : ""}${data.summary.blocked ? ` (${data.summary.blocked} blockerade)` : ""}.`,
        });
        // Notify parent (close dialog, clear selections) when there's nothing
        // left to retry. If conflicts/blocked rows remain, keep the dialog open
        // so the user can resolve them via per-row force/skip controls.
        const noOutstanding =
          mergedSummary.conflict === 0 &&
          mergedSummary.blocked === 0 &&
          mergedSummary.error === 0;
        if (noOutstanding) {
          onSuccess();
        }
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
            {title ?? `Schemalägg ${workOrderIds.length} order`}
          </DialogTitle>
          <DialogDescription>
            {description ?? "Välj datum och resurs eller team. Konflikter visas innan de schemaläggs."}
          </DialogDescription>
        </DialogHeader>

        {!results && (
          <div className="space-y-4 py-2">
            {isLocked ? (
              <div
                className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-1"
                data-testid="text-bulk-prefill-summary"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {prefill?.note || "Förvalt från ankarjobb"}
                </div>
                <div className="font-medium">
                  {target === "resource" ? "Resurs" : "Team"}: {targetName}
                </div>
                <div className="text-xs text-muted-foreground">Datum: {scheduledDate}</div>
              </div>
            ) : (
            <>
            <Tabs value={target} onValueChange={(v) => setTarget(v as "resource" | "team")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="resource" data-testid="tab-bulk-target-resource">Resurs</TabsTrigger>
                <TabsTrigger value="team" data-testid="tab-bulk-target-team">Team</TabsTrigger>
              </TabsList>
            </Tabs>

            {target === "resource" ? (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-resource">Resurs</Label>
                {matchData?.noMatch && matchData?.clusterName && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-warning/10 border border-warning/20" data-testid="no-cluster-match-warning">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                    <span className="text-xs text-warning">Ingen resurs matchar klustret <strong>{matchData.clusterName}</strong>.</span>
                  </div>
                )}
                <Select value={resourceId} onValueChange={setResourceId}>
                  <SelectTrigger id="bulk-resource" data-testid="select-bulk-resource">
                    <SelectValue placeholder="Välj resurs" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedResources.map(r => {
                      const matchInfo = matchScoreMap.get(r.id);
                      const isMatch = matchInfo?.clusterMatch;
                      return (
                        <SelectItem key={r.id} value={r.id} data-testid={`option-bulk-resource-${r.id}`}>
                          <span className="flex items-center gap-2">
                            {r.name}
                            {isMatch && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 text-[10px] text-chart-2" data-testid={`badge-recommended-${r.id}`}>
                                    <Sparkles className="h-3 w-3" />Rek.
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {matchInfo?.reasons?.join(" · ") || `Resursen verkar i samma kluster (${matchData?.clusterName})`}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
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
            </>
            )}

            {isLocked && (
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
            )}

            <div className="text-xs text-muted-foreground rounded border bg-muted/30 p-2.5">
              {workOrderIds.length === 1
                ? "Ordern kontrolleras mot konflikter (kapacitet, kluster, körschema, beroenden) innan tilldelning."
                : `${workOrderIds.length} order kommer att kontrolleras mot konflikter (kapacitet, kluster, körschema, beroenden). Konflikter kan accepteras manuellt i nästa steg.`}
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
              {workOrderIds.length === 1 ? "Tilldela" : `Schemalägg ${workOrderIds.length}`}
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

/**
 * AssignmentDialog is the canonical name for the unified 1..N order
 * scheduling/assignment dialog. It is identical to BulkScheduleDialog and
 * supports a single-order recommendation context for cluster-match hints.
 */
export const AssignmentDialog = BulkScheduleDialog;
export type AssignmentDialogProps = BulkScheduleDialogProps;
