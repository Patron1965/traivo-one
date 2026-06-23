import { memo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Clock, X, Link2, ArrowRight, Key, DoorOpen, UsersRound, MoreVertical, Zap, Info, CalendarClock, CalendarX2 } from "lucide-react";
import type { WorkOrderWithObject } from "@shared/schema";
import { EXECUTION_CODE_LABELS, EXECUTION_CODE_ICONS } from "@shared/schema";
import type { DeliveryRestrictionNote } from "@shared/delivery-restrictions";
import {
  executionStatusColors, executionStatusLabels, executionStatusOrder,
  statusBadgeVariant, timeBlockBorders, getJobCategory, priorityDotColors,
} from "./types";
import { SubStepsExpander } from "./DndComponents";
import { WorkOrderMetadataPanel } from "../WorkOrderMetadataPanel";
import { useLocalizedObjectName } from "@/lib/object-name";

interface JobCardProps {
  job: WorkOrderWithObject;
  compact?: boolean;
  selectedJob: string | null;
  jobConflicts: Record<string, string[]>;
  dependenciesData?: {
    dependencies: Record<string, Array<{ dependsOnWorkOrderId: string }>>;
    dependents: Record<string, Array<{ workOrderId: string }>>;
  } | null;
  timewindowMap: Map<string, Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>;
  restrictionNotesByObject?: Map<string, DeliveryRestrictionNote[]>;
  expandedSubSteps: Record<string, boolean>;
  onJobClick: (jobId: string) => void;
  onUnschedule: (e: { stopPropagation: () => void }, jobId: string) => void;
  onPushToRough?: (e: { stopPropagation: () => void }, jobId: string) => void;
  onToggleSubStep: (jobId: string) => void;
  onOpenDepChain: (jobId: string) => void;
  selectedJobIds?: Set<string>;
  onToggleSelection?: (jobId: string, shiftKey?: boolean) => void;
  onEscalateUrgent?: (job: WorkOrderWithObject) => void;
}

export const JobCard = memo(function JobCard({
  job, compact = false, selectedJob, jobConflicts, dependenciesData,
  timewindowMap, restrictionNotesByObject, expandedSubSteps, onJobClick, onUnschedule, onPushToRough, onToggleSubStep, onOpenDepChain,
  selectedJobIds, onToggleSelection, onEscalateUrgent,
}: JobCardProps) {
  const localizedObjectName = useLocalizedObjectName();
  const restrictionNotes = (job.objectId && restrictionNotesByObject?.get(job.objectId)) || [];
  const hasHardRestriction = restrictionNotes.some((n) => n.enforcement === "hard");
  const execStatus = (job as { executionStatus?: string }).executionStatus || "not_planned";
  const execIndex = executionStatusOrder.indexOf(execStatus);
  const execProgress = ((execIndex + 1) / executionStatusOrder.length) * 100;

  const jobDependencies = dependenciesData?.dependencies?.[job.id] || [];
  const jobDependents = dependenciesData?.dependents?.[job.id] || [];
  const hasDependencies = jobDependencies.length > 0;
  const hasDependents = jobDependents.length > 0;
  const category = getJobCategory(job);
  const hasConflict = job.scheduledDate && jobConflicts[job.id];
  const isMultiSelected = selectedJobIds && selectedJobIds.has(job.id);

  return (
      <Card
        className={`p-1 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 border-l-2 overflow-hidden ${timeBlockBorders[category]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${hasConflict ? "ring-2 ring-destructive/50 bg-destructive/10 dark:bg-destructive/15" : ""} ${isMultiSelected ? "ring-2 ring-chart-1/50 bg-chart-1/10 dark:bg-chart-1/15" : ""} group touch-none`}
        onClick={() => onJobClick(job.id)}
        data-testid={`job-card-${job.id}`}
      >
        <div className="flex items-start justify-between gap-1">
          {onToggleSelection && (
            <div
              className="shrink-0 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={isMultiSelected ? { opacity: 1 } : undefined}
              onClick={(e) => { e.stopPropagation(); onToggleSelection(job.id, e.shiftKey); }}
            >
              <Checkbox
                checked={!!isMultiSelected}
                className="h-3.5 w-3.5 pointer-events-none"
                data-testid={`checkbox-select-job-${job.id}`}
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${executionStatusColors[execStatus] || "bg-muted-foreground/60"} ${
                    (execStatus === "on_way" || execStatus === "on_site") ? "animate-pulse" : ""
                  }`} />
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">
                    <p className="font-medium">{executionStatusLabels[execStatus] || execStatus}</p>
                    {execStatus === "on_way" && <p className="text-muted-foreground">Fältarbetaren är på väg</p>}
                    {execStatus === "on_site" && <p className="text-muted-foreground">Fältarbetaren är på plats</p>}
                  </div>
                </TooltipContent>
              </Tooltip>
              <span className="text-xs font-medium truncate">{job.title}</span>
              {job.executionCode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] shrink-0 bg-muted text-muted-foreground px-1 rounded" data-testid={`exec-code-${job.id}`}>
                      {EXECUTION_CODE_ICONS[job.executionCode] || "KOD"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{EXECUTION_CODE_LABELS[job.executionCode] || job.executionCode}</TooltipContent>
                </Tooltip>
              )}
              {(hasDependencies || hasDependents) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex items-center gap-0.5 shrink-0 cursor-pointer hover:opacity-70"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDepChain(job.id);
                      }}
                      data-testid={`dep-chain-link-${job.id}`}
                    >
                      {hasDependencies && <Link2 className="h-3 w-3 text-warning" />}
                      {hasDependents && <ArrowRight className="h-3 w-3 text-chart-1" />}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs space-y-1">
                      {hasDependencies && (
                        <p className="flex items-center gap-1">
                          <Link2 className="h-3 w-3 text-warning" />
                          Beroende av {jobDependencies.length} uppgift{jobDependencies.length > 1 ? "er" : ""}
                        </p>
                      )}
                      {hasDependents && (
                        <p className="flex items-center gap-1">
                          <ArrowRight className="h-3 w-3 text-chart-1" />
                          Blockerar {jobDependents.length} uppgift{jobDependents.length > 1 ? "er" : ""}
                        </p>
                      )}
                      <p className="text-muted-foreground">Klicka för att se beroendekedjan</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">{localizedObjectName(job.objectName, job.objectNameTranslations) || "Okänt objekt"}</div>
            {(job.metadata as Record<string, string> | null)?.teamName && (
              <Badge variant="outline" className="text-[9px] h-4 gap-0.5 mt-0.5" style={{ borderColor: "#3B82F6" }} data-testid={`team-badge-${job.id}`}>
                <UsersRound className="h-2.5 w-2.5" />
                {(job.metadata as Record<string, string>).teamName}
              </Badge>
            )}
            {job.creationMethod === "automatic" && (
              <Badge className="text-[9px] h-4 bg-warning/15 text-warning dark:bg-warning/15 border-warning/30" data-testid={`pickup-badge-${job.id}`}>
                Plockuppgift
              </Badge>
            )}
            {(job.objectAccessCode || job.objectKeyNumber) && (
              <div className="flex items-center gap-2 mt-0.5">
                {job.objectAccessCode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-[10px] text-warning">
                        <DoorOpen className="h-2.5 w-2.5" />
                        {job.objectAccessCode}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Portkod</TooltipContent>
                  </Tooltip>
                )}
                {job.objectKeyNumber && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-[10px] text-chart-1">
                        <Key className="h-2.5 w-2.5" />
                        {job.objectKeyNumber}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Nyckelnummer</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {(job as { outsidePreferredWindow?: boolean }).outsidePreferredWindow && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={
                      (job as { deliveryPreferencePriority?: string }).deliveryPreferencePriority === "strict"
                        ? "text-[9px] h-4 gap-0.5 mt-0.5 bg-destructive/10 text-destructive border-destructive/30 dark:bg-destructive/15-foreground dark:border-destructive/70"
                        : "text-[9px] h-4 gap-0.5 mt-0.5 bg-warning/10 text-warning border-warning/30 dark:bg-warning/15 dark:border-warning/70"
                    }
                    data-testid={`badge-outside-preferred-${job.id}`}
                  >
                    <CalendarClock className="h-2.5 w-2.5" />
                    {(job as { deliveryPreferencePriority?: string }).deliveryPreferencePriority === "strict"
                      ? "Bryter slottid"
                      : "Utanför slottid"}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                  {(job as { deliveryPreferencePriority?: string }).deliveryPreferencePriority === "strict"
                    ? "Planerad tid bryter mot kundens strikta leveransfönster."
                    : "Planerad tid ligger utanför kundens/objektets önskade leveransfönster."}
                </TooltipContent>
              </Tooltip>
            )}
            {restrictionNotes.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={
                      hasHardRestriction
                        ? "text-[9px] h-4 gap-0.5 mt-0.5 bg-destructive/10 text-destructive border-destructive/30 dark:bg-destructive/15 dark:border-destructive/70"
                        : "text-[9px] h-4 gap-0.5 mt-0.5 bg-warning/10 text-warning border-warning/30 dark:bg-warning/15 dark:border-warning/70"
                    }
                    data-testid={`badge-delivery-restriction-${job.id}`}
                  >
                    <CalendarClock className="h-2.5 w-2.5" />
                    Tidsrestriktion{restrictionNotes.length > 1 ? ` (${restrictionNotes.length})` : ""}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs">
                  <div className="space-y-1.5">
                    {restrictionNotes.map((n, i) => (
                      <div key={i} className="space-y-0.5">
                        <p className="flex items-center gap-1 font-medium">
                          {n.enforcement === "hard"
                            ? <AlertTriangle className="h-3 w-3 text-destructive" />
                            : <CalendarClock className="h-3 w-3 text-warning" />}
                          {n.polarity === "positive" ? "Lämplig leveranstid" : "Undvik leveranstid"}
                          <span className="text-muted-foreground">{n.enforcement === "hard" ? "(hård)" : "(mjuk)"}</span>
                        </p>
                        {n.timeRule && <p className="text-muted-foreground">{n.timeRule}</p>}
                        {n.description && <p>{n.description}</p>}
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {hasConflict && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-[10px] text-destructive mt-0.5 cursor-help" data-testid={`conflict-warning-${job.id}`}>
                    <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
                    <span className="truncate">{jobConflicts[job.id][0]}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium text-destructive">Konfliktvarning</p>
                    {jobConflicts[job.id].map((reason, i) => (
                      <p key={i} className="text-xs flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                        {reason}
                      </p>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {!compact && (
              <>
                {job.scheduledStartTime && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    <span>{job.scheduledStartTime}</span>
                    {(() => {
                      const cardTws = timewindowMap.get(job.id);
                      if (cardTws && cardTws.length > 0) {
                        const hasTimeBound = cardTws.some(tw => tw.startTime && tw.endTime);
                        if (hasTimeBound) {
                          const isWithin = cardTws.some(tw => {
                            if (!tw.startTime || !tw.endTime || !job.scheduledStartTime) return false;
                            return job.scheduledStartTime >= tw.startTime && job.scheduledStartTime <= tw.endTime;
                          });
                          return (
                            <span className={`text-[9px] px-1 rounded ${isWithin ? "bg-chart-2/15 dark:bg-chart-2/15 text-chart-2" : "bg-destructive/15 dark:bg-destructive/15 text-destructive"}`}>
                              {isWithin ? "i fönster" : "utanför"}
                            </span>
                          );
                        }
                      }
                      return null;
                    })()}
                  </div>
                )}
                <div className="flex items-center gap-1 mt-1">
                  <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${executionStatusColors[execStatus] || "bg-muted-foreground/60"} transition-all`}
                      style={{ width: `${execProgress}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{execIndex + 1}/8</span>
                </div>
                <SubStepsExpander jobId={job.id} isExpanded={!!expandedSubSteps[job.id]} onToggle={() => onToggleSubStep(job.id)} />
                {selectedJob === job.id && (
                  <WorkOrderMetadataPanel
                    workOrderId={job.id}
                    objectId={job.objectId}
                    executionStatus={execStatus}
                    compact
                  />
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`button-job-menu-${job.id}`}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {onEscalateUrgent && (
                  <>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive dark:focus:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onEscalateUrgent(job); }}
                      data-testid={`menu-escalate-urgent-${job.id}`}
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      Eskalera till akut
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onJobClick(job.id); }}
                  data-testid={`menu-details-${job.id}`}
                >
                  <Info className="h-4 w-4 mr-2" />
                  Detaljer
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => { e.stopPropagation(); onUnschedule(e, job.id); }}
                  data-testid={`menu-unschedule-${job.id}`}
                >
                  <X className="h-4 w-4 mr-2" />
                  Ta bort tilldelning
                </DropdownMenuItem>
                {onPushToRough && (
                  <DropdownMenuItem
                    onClick={(e) => { e.stopPropagation(); onPushToRough(e, job.id); }}
                    data-testid={`menu-push-to-rough-${job.id}`}
                  >
                    <CalendarX2 className="h-4 w-4 mr-2" />
                    Skjut tillbaka till grovplanering
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Badge variant={statusBadgeVariant[job.status] || "outline"} className="text-[10px]">
              {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
            </Badge>
          </div>
        </div>
      </Card>
  );
});

export const DragOverlayContent = memo(function DragOverlayContent({
  job,
  timewindowMap,
}: {
  job: WorkOrderWithObject;
  timewindowMap: Map<string, Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>;
}) {
  const dragTws = timewindowMap.get(job.id);
  const hasTimeWindow = dragTws && dragTws.length > 0;
  const windowLabel = hasTimeWindow
    ? dragTws.map(tw => {
        const parts: string[] = [];
        if (tw.dayOfWeek) parts.push(tw.dayOfWeek.substring(0, 3));
        if (tw.startTime && tw.endTime) parts.push(`${tw.startTime}–${tw.endTime}`);
        return parts.join(" ");
      }).join(", ")
    : null;
  const hasDeadline = job.plannedWindowEnd;

  return (
    <Card className="p-3 shadow-xl border-primary/50 bg-background/95 backdrop-blur-sm w-[260px] rotate-1">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
          <span className="text-sm font-medium truncate">{job.title}</span>
        </div>
        <div className="text-xs text-muted-foreground truncate">{job.objectName || "Okänt objekt"}</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[10px]">
            {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
          </Badge>
          {windowLabel && (
            <Badge variant="outline" className="text-[10px] border-chart-1/30 text-chart-1">
              <Clock className="h-2.5 w-2.5 mr-0.5" />
              {windowLabel}
            </Badge>
          )}
          {hasDeadline && (
            <Badge variant="outline" className="text-[10px] border-warning/30 text-warning">
              DL: {(() => { const d = new Date(job.plannedWindowEnd!); return `${d.getDate()} ${d.toLocaleString("sv-SE", { month: "short" })}`; })()}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
});
