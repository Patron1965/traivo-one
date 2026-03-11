import { memo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Clock, X, Link2, ArrowRight, Key, DoorOpen, UsersRound } from "lucide-react";
import type { WorkOrderWithObject } from "@shared/schema";
import { EXECUTION_CODE_LABELS, EXECUTION_CODE_ICONS } from "@shared/schema";
import {
  executionStatusColors, executionStatusLabels, executionStatusOrder,
  statusBadgeVariant, timeBlockBorders, getJobCategory, priorityDotColors,
} from "./types";
import { DraggableJobCard, SubStepsExpander } from "./DndComponents";
import { WorkOrderMetadataPanel } from "../WorkOrderMetadataPanel";

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
  expandedSubSteps: Record<string, boolean>;
  onJobClick: (jobId: string) => void;
  onUnschedule: (e: { stopPropagation: () => void }, jobId: string) => void;
  onToggleSubStep: (jobId: string) => void;
  onOpenDepChain: (jobId: string) => void;
}

export const JobCard = memo(function JobCard({
  job, compact = false, selectedJob, jobConflicts, dependenciesData,
  timewindowMap, expandedSubSteps, onJobClick, onUnschedule, onToggleSubStep, onOpenDepChain,
}: JobCardProps) {
  const execStatus = (job as { executionStatus?: string }).executionStatus || "not_planned";
  const execIndex = executionStatusOrder.indexOf(execStatus);
  const execProgress = ((execIndex + 1) / executionStatusOrder.length) * 100;

  const jobDependencies = dependenciesData?.dependencies?.[job.id] || [];
  const jobDependents = dependenciesData?.dependents?.[job.id] || [];
  const hasDependencies = jobDependencies.length > 0;
  const hasDependents = jobDependents.length > 0;
  const category = getJobCategory(job);
  const hasConflict = job.scheduledDate && jobConflicts[job.id];

  return (
    <DraggableJobCard key={job.id} id={job.id}>
      <Card
        className={`p-2 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 border-l-4 overflow-hidden ${timeBlockBorders[category]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${hasConflict ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950/30" : ""} group touch-none`}
        onClick={() => onJobClick(job.id)}
        data-testid={`job-card-${job.id}`}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${executionStatusColors[execStatus] || "bg-gray-400"} ${
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
              {(job as any).executionCode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] shrink-0 bg-slate-100 dark:bg-slate-800 px-1 rounded" data-testid={`exec-code-${job.id}`}>
                      {EXECUTION_CODE_ICONS[(job as any).executionCode] || "KOD"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{EXECUTION_CODE_LABELS[(job as any).executionCode] || (job as any).executionCode}</TooltipContent>
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
                      {hasDependencies && <Link2 className="h-3 w-3 text-orange-500" />}
                      {hasDependents && <ArrowRight className="h-3 w-3 text-blue-500" />}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs space-y-1">
                      {hasDependencies && (
                        <p className="flex items-center gap-1">
                          <Link2 className="h-3 w-3 text-orange-500" />
                          Beroende av {jobDependencies.length} uppgift{jobDependencies.length > 1 ? "er" : ""}
                        </p>
                      )}
                      {hasDependents && (
                        <p className="flex items-center gap-1">
                          <ArrowRight className="h-3 w-3 text-blue-500" />
                          Blockerar {jobDependents.length} uppgift{jobDependents.length > 1 ? "er" : ""}
                        </p>
                      )}
                      <p className="text-muted-foreground">Klicka för att se beroendekedjan</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">{job.objectName || "Okänt objekt"}</div>
            {(job as any).metadata?.teamName && (
              <Badge variant="outline" className="text-[9px] h-4 gap-0.5 mt-0.5" style={{ borderColor: "#3B82F6" }} data-testid={`team-badge-${job.id}`}>
                <UsersRound className="h-2.5 w-2.5" />
                {(job as any).metadata.teamName}
              </Badge>
            )}
            {(job as any).creationMethod === "automatic" && (
              <Badge className="text-[9px] h-4 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300" data-testid={`pickup-badge-${job.id}`}>
                Plockuppgift
              </Badge>
            )}
            {(job.objectAccessCode || job.objectKeyNumber) && (
              <div className="flex items-center gap-2 mt-0.5">
                {job.objectAccessCode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
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
                      <span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                        <Key className="h-2.5 w-2.5" />
                        {job.objectKeyNumber}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Nyckelnummer</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
            {hasConflict && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 mt-0.5 cursor-help" data-testid={`conflict-warning-${job.id}`}>
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="truncate">{jobConflicts[job.id][0]}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-medium text-red-600 dark:text-red-400">Konfliktvarning</p>
                    {jobConflicts[job.id].map((reason, i) => (
                      <p key={i} className="text-xs flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
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
                            <span className={`text-[9px] px-1 rounded ${isWithin ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"}`}>
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
                      className={`h-full ${executionStatusColors[execStatus] || "bg-gray-400"} transition-all`}
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  onClick={(e) => onUnschedule(e, job.id)}
                  data-testid={`button-unschedule-${job.id}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Avschemalägg</TooltipContent>
            </Tooltip>
            <Badge variant={statusBadgeVariant[job.status] || "outline"} className="text-[10px]">
              {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
            </Badge>
          </div>
        </div>
      </Card>
    </DraggableJobCard>
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
            <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600 dark:text-blue-400">
              <Clock className="h-2.5 w-2.5 mr-0.5" />
              {windowLabel}
            </Badge>
          )}
          {hasDeadline && (
            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 dark:text-amber-400">
              DL: {(() => { const d = new Date(job.plannedWindowEnd!); return `${d.getDate()} ${d.toLocaleString("sv-SE", { month: "short" })}`; })()}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
});
