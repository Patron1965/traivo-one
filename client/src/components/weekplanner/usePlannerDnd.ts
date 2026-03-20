import { useCallback, useState, useRef } from "react";
import { useSensor, useSensors, PointerSensor, KeyboardSensor, closestCenter, type DragStartEvent, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { format, isSameDay } from "date-fns";
import { DAY_START_HOUR, DAY_END_HOUR } from "./types";
import type { WorkOrderWithObject } from "@shared/schema";

interface UsePlannerDndOptions {
  workOrders: WorkOrderWithObject[];
  viewMode: string;
  currentDate: Date;
  routeJobsForView: WorkOrderWithObject[];
  routeJobOrder: string[];
  resourceDayJobMap: { jobs: Record<string, Record<string, WorkOrderWithObject[]>> };
  setActiveDragJob: (job: WorkOrderWithObject | null) => void;
  setRouteJobOrder: (order: string[]) => void;
  updateWorkOrderMutation: { mutate: (data: Record<string, unknown>) => void };
  detectConflictsForJob: (job: WorkOrderWithObject, resourceId: string, dateStr: string, startTime: string | null) => string[];
  setPendingSchedule: (schedule: { jobId: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; conflicts: string[] } | null) => void;
  setConflictDialogOpen: (open: boolean) => void;
  executeSchedule: (jobId: string, resourceId: string, dateStr: string, startTime?: string) => void;
  toast: (opts: { title: string; description?: string }) => void;
  selectedJobIds?: Set<string>;
  clearSelection?: () => void;
}

export function usePlannerDnd({
  workOrders, viewMode, currentDate, routeJobsForView, routeJobOrder,
  resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation,
  detectConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, toast,
  selectedJobIds, clearSelection,
}: UsePlannerDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const [dragOverConflicts, setDragOverConflicts] = useState<Record<string, string[]>>({});
  const lastOverIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragJob(workOrders.find(j => j.id === event.active.id) || null);
    setDragOverConflicts({});
    lastOverIdRef.current = null;
  }, [workOrders, setActiveDragJob]);

  const computeStartTime = useCallback((resourceId: string, dateStr: string, hour?: number): string | undefined => {
    let scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;
    if (!scheduledStartTime && viewMode === "week") {
      const existing = (resourceDayJobMap.jobs[resourceId]?.[dateStr] || []).filter(j => j.scheduledStartTime).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      let nextSlot = DAY_START_HOUR * 60;
      for (const e of existing) { const [eH, eM] = (e.scheduledStartTime || "07:00").split(":").map(Number); const end = eH * 60 + eM + (e.estimatedDuration || 60); if (end > nextSlot) nextSlot = end; }
      const h = Math.floor(nextSlot / 60);
      if (h < DAY_END_HOUR) scheduledStartTime = `${h.toString().padStart(2, "0")}:${(nextSlot % 60).toString().padStart(2, "0")}`;
    }
    return scheduledStartTime;
  }, [viewMode, resourceDayJobMap]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) {
      if (lastOverIdRef.current) {
        setDragOverConflicts({});
        lastOverIdRef.current = null;
      }
      return;
    }
    const dropId = over.id as string;
    if (dropId === lastOverIdRef.current) return;
    lastOverIdRef.current = dropId;

    const job = workOrders.find(j => j.id === (active.id as string));
    if (!job) return;
    const parts = dropId.split("|");
    if (parts.length < 2) { setDragOverConflicts({}); return; }
    const resourceId = parts[0];
    const dateStr = parts[1];
    const hour = parts[2] ? parseInt(parts[2], 10) : undefined;
    const provisionalStartTime = hour !== undefined
      ? `${hour.toString().padStart(2, "0")}:00`
      : computeStartTime(resourceId, dateStr) || null;

    const jobsToCheck = (selectedJobIds && selectedJobIds.size > 1 && selectedJobIds.has(job.id))
      ? workOrders.filter(j => selectedJobIds.has(j.id))
      : [job];

    const allConflicts: string[] = [];
    let accMin = 0;
    const baseMinutes = provisionalStartTime
      ? parseInt(provisionalStartTime.split(":")[0]) * 60 + parseInt(provisionalStartTime.split(":")[1])
      : DAY_START_HOUR * 60;

    for (const j of jobsToCheck) {
      const slotMin = baseMinutes + accMin;
      const slotTime = `${Math.floor(slotMin / 60).toString().padStart(2, "0")}:${(slotMin % 60).toString().padStart(2, "0")}`;
      const conflicts = detectConflictsForJob(j, resourceId, dateStr, slotTime);
      if (conflicts.length > 0) allConflicts.push(...conflicts);
      accMin += (j.estimatedDuration || 60);
    }

    if (allConflicts.length > 0) {
      setDragOverConflicts({ [dropId]: allConflicts });
    } else {
      setDragOverConflicts({});
    }
  }, [workOrders, detectConflictsForJob, computeStartTime, selectedJobIds]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragJob(null);
    setDragOverConflicts({});
    lastOverIdRef.current = null;
    const { active, over } = event;
    if (!over) return;
    const jobId = active.id as string;
    const dropId = over.id as string;

    if (viewMode === "route" && routeJobsForView.length > 0) {
      const isRouteJob = routeJobsForView.some(j => j.id === jobId);
      const isDropOnRouteJob = routeJobsForView.some(j => j.id === dropId);
      if (isRouteJob && isDropOnRouteJob && jobId !== dropId) {
        const oldIdx = routeJobsForView.findIndex(j => j.id === jobId);
        const newIdx = routeJobsForView.findIndex(j => j.id === dropId);
        if (oldIdx !== -1 && newIdx !== -1) {
          const newOrder = arrayMove(routeJobsForView, oldIdx, newIdx);
          setRouteJobOrder(newOrder.map(j => j.id));
          let mins = 8 * 60;
          const ds = format(currentDate, "yyyy-MM-dd");
          newOrder.forEach((job, idx) => {
            updateWorkOrderMutation.mutate({ id: job.id, resourceId: job.resourceId!, scheduledDate: ds, scheduledStartTime: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` });
            mins += (job.estimatedDuration || 30) + (idx < newOrder.length - 1 ? 5 : 0);
          });
          toast({ title: "Körordning uppdaterad", description: `${newOrder.length} stopp har fått ny ordning` });
        }
        return;
      }
    }

    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    const parts = dropId.split("|");
    if (parts.length < 2) return;
    const resourceId = parts[0];
    const dateStr = parts[1];
    const hour = parts[2] ? parseInt(parts[2], 10) : undefined;
    const day = new Date(dateStr + "T12:00:00Z");
    if (job.resourceId === resourceId && job.scheduledDate && isSameDay(new Date(job.scheduledDate), day) && hour === undefined) return;

    const isBulk = selectedJobIds && selectedJobIds.size > 1 && selectedJobIds.has(jobId);

    if (isBulk) {
      const jobsToMove = workOrders.filter(j => selectedJobIds.has(j.id));
      let accumulatedMinutes = 0;
      const baseStartTime = computeStartTime(resourceId, dateStr, hour);
      const baseMinutes = baseStartTime ? parseInt(baseStartTime.split(":")[0]) * 60 + parseInt(baseStartTime.split(":")[1]) : DAY_START_HOUR * 60;

      let hasConflicts = false;
      for (const j of jobsToMove) {
        const slotMinutes = baseMinutes + accumulatedMinutes;
        const slotTime = `${Math.floor(slotMinutes / 60).toString().padStart(2, "0")}:${(slotMinutes % 60).toString().padStart(2, "0")}`;
        const conflicts = detectConflictsForJob(j, resourceId, dateStr, slotTime);
        if (conflicts.length > 0) { hasConflicts = true; break; }
        accumulatedMinutes += (j.estimatedDuration || 60);
      }

      if (hasConflicts) {
        const bulkEntries: Array<{ jobId: string; startTime: string }> = [];
        let bulkAcc = 0;
        for (const j of jobsToMove) {
          const slotMinutes = baseMinutes + bulkAcc;
          const slotTime = `${Math.floor(slotMinutes / 60).toString().padStart(2, "0")}:${(slotMinutes % 60).toString().padStart(2, "0")}`;
          bulkEntries.push({ jobId: j.id, startTime: slotTime });
          bulkAcc += (j.estimatedDuration || 60);
        }
        setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime: baseStartTime, conflicts: ["Bulk-flytt: en eller flera order har konflikter med denna cell"], bulkJobs: bulkEntries });
        setConflictDialogOpen(true);
        return;
      }

      accumulatedMinutes = 0;
      for (const j of jobsToMove) {
        const slotMinutes = baseMinutes + accumulatedMinutes;
        const slotTime = `${Math.floor(slotMinutes / 60).toString().padStart(2, "0")}:${(slotMinutes % 60).toString().padStart(2, "0")}`;
        executeSchedule(j.id, resourceId, dateStr, slotTime);
        accumulatedMinutes += (j.estimatedDuration || 60);
      }
      toast({ title: "Bulk-flytt klar", description: `${jobsToMove.length} order flyttade till ${dateStr}` });
      clearSelection?.();
      return;
    }

    const scheduledStartTime = computeStartTime(resourceId, dateStr, hour);
    const conflicts = detectConflictsForJob(job, resourceId, dateStr, scheduledStartTime || null);
    if (conflicts.length > 0) { setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts }); setConflictDialogOpen(true); return; }
    executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
    if (scheduledStartTime) toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
  }, [workOrders, viewMode, currentDate, routeJobsForView, resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation, detectConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, toast, selectedJobIds, clearSelection, computeStartTime]);

  return {
    sensors,
    collisionDetection: closestCenter,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dragOverConflicts,
  };
}
