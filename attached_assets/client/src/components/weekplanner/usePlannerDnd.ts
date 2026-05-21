import { useCallback, useState, useRef } from "react";
import { useSensor, useSensors, PointerSensor, KeyboardSensor, pointerWithin, rectIntersection, type DragStartEvent, type DragEndEvent, type DragOverEvent, type CollisionDetection } from "@dnd-kit/core";
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
  detectTeamConflictsForJob?: (job: WorkOrderWithObject, teamId: string, dateStr: string) => string[];
  setPendingSchedule: (schedule: { jobId: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; conflicts: string[] } | null) => void;
  setConflictDialogOpen: (open: boolean) => void;
  executeSchedule: (jobId: string, resourceId: string, dateStr: string, startTime?: string, clusterOverride?: boolean) => void;
  executeTeamSchedule?: (jobId: string, teamId: string, dateStr: string) => void;
  toast: (opts: { title: string; description?: string }) => void;
  selectedJobIds?: Set<string>;
  clearSelection?: () => void;
  setWhatIfPending?: (pending: { jobId: string; jobTitle: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; clusterOverride?: boolean; bulkJobs?: Array<{ jobId: string; startTime: string }> } | null) => void;
  setWhatIfOpen?: (open: boolean) => void;
  fetchWhatIf?: (workOrderId: string, toResourceId: string, scheduledDate: string, scheduledStartTime?: string, fromResourceId?: string | null, fromDate?: string | null) => void;
}

export function usePlannerDnd({
  workOrders, viewMode, currentDate, routeJobsForView, routeJobOrder,
  resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation,
  detectConflictsForJob, detectTeamConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, executeTeamSchedule, toast,
  selectedJobIds, clearSelection,
  setWhatIfPending, setWhatIfOpen, fetchWhatIf,
}: UsePlannerDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return rectIntersection(args);
  }, []);

  const [dragOverConflicts, setDragOverConflicts] = useState<Record<string, string[]>>({});
  const lastOverIdRef = useRef<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    const found = workOrders.find(j => String(j.id) === activeId);
    if (!found) {
      console.warn("[dnd] handleDragStart: job not found in workOrders", { activeId, workOrderCount: workOrders.length });
    }
    setActiveDragJob(found || null);
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


  const resolveDropTarget = useCallback((dropId: string): { resourceId: string; dateStr: string; hour?: number } | null => {
    const parts = dropId.split("|");
    if (parts.length >= 2) {
      return { resourceId: parts[0], dateStr: parts[1], hour: parts[2] ? parseInt(parts[2], 10) : undefined };
    }
    const targetJob = workOrders.find(j => String(j.id) === dropId);
    if (targetJob && targetJob.resourceId && targetJob.scheduledDate) {
      const ds = typeof targetJob.scheduledDate === "string" ? targetJob.scheduledDate : (targetJob.scheduledDate as Date).toISOString();
      const dateStr = ds.includes("T") ? ds.split("T")[0] : ds.split(" ")[0];
      return { resourceId: targetJob.resourceId, dateStr };
    }
    return null;
  }, [workOrders]);

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

    if (dropId.startsWith("team:")) {
      const job = workOrders.find(j => String(j.id) === String(active.id));
      if (!job || !detectTeamConflictsForJob) {
        setDragOverConflicts({});
        return;
      }
      const rest = dropId.slice(5);
      const [teamId, dateStr] = rest.split("|");
      if (!teamId || !dateStr) {
        setDragOverConflicts({});
        return;
      }
      const conflicts = detectTeamConflictsForJob(job, teamId, dateStr);
      if (conflicts.length > 0) {
        setDragOverConflicts({ [dropId]: conflicts });
      } else {
        setDragOverConflicts({});
      }
      return;
    }

    const job = workOrders.find(j => String(j.id) === String(active.id));
    if (!job) return;
    const target = resolveDropTarget(dropId);
    if (!target) { setDragOverConflicts({}); return; }
    const { resourceId, dateStr, hour } = target;
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
  }, [workOrders, detectConflictsForJob, detectTeamConflictsForJob, computeStartTime, selectedJobIds, resolveDropTarget]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragJob(null);
    setDragOverConflicts({});
    lastOverIdRef.current = null;
    const { active, over } = event;
    if (!over) {
      toast({ title: "Släppte utanför", description: "Dra jobbet till en cell i schemat" });
      return;
    }
    const jobId = String(active.id);
    const dropId = String(over.id);

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

    const job = workOrders.find(j => String(j.id) === jobId);
    if (!job) {
      console.warn("[dnd] handleDragEnd: dragged job not found in workOrders", { jobId, workOrderCount: workOrders.length });
      return;
    }

    if (dropId.startsWith("team:")) {
      const rest = dropId.slice(5);
      const [teamId, dateStr] = rest.split("|");
      if (!teamId || !dateStr) {
        console.warn("[dnd] team drop: malformed id", { dropId });
        return;
      }
      if (!executeTeamSchedule) {
        console.warn("[dnd] team drop: executeTeamSchedule not provided");
        return;
      }
      executeTeamSchedule(jobId, teamId, dateStr);
      return;
    }

    const target = resolveDropTarget(dropId);
    if (!target) {
      console.warn("[dnd] handleDragEnd: could not resolve drop target", { dropId });
      return;
    }
    const { resourceId, dateStr, hour } = target;
    const day = new Date(dateStr + "T12:00:00Z");
    if (job.resourceId === resourceId && job.scheduledDate && isSameDay(new Date(job.scheduledDate), day) && hour === undefined) {
      console.info("[dnd] handleDragEnd: same-slot drop ignored (same resource + same day, no hour change)");
      return;
    }

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
        const allBulkConflicts: string[] = [];
        let bulkAcc = 0;
        for (const j of jobsToMove) {
          const slotMinutes = baseMinutes + bulkAcc;
          const slotTime = `${Math.floor(slotMinutes / 60).toString().padStart(2, "0")}:${(slotMinutes % 60).toString().padStart(2, "0")}`;
          bulkEntries.push({ jobId: j.id, startTime: slotTime });
          const jobConflicts = detectConflictsForJob(j, resourceId, dateStr, slotTime);
          for (const c of jobConflicts) {
            if (!allBulkConflicts.includes(c)) allBulkConflicts.push(c);
          }
          bulkAcc += (j.estimatedDuration || 60);
        }
        if (allBulkConflicts.length === 0) allBulkConflicts.push("Bulk-flytt: en eller flera order har konflikter med denna cell");
        const hasHardBlock = allBulkConflicts.some(c => c.startsWith("[BLOCK]"));
        if (hasHardBlock) {
          toast({ title: "Blockerad", description: allBulkConflicts.find(c => c.startsWith("[BLOCK]"))?.replace("[BLOCK] ", "") || "Tilldelning blockerad av verksamhetsområdesregel" });
          return;
        }
        setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime: baseStartTime, conflicts: allBulkConflicts, bulkJobs: bulkEntries });
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
    const hasHardBlock = conflicts.some(c => c.startsWith("[BLOCK]"));
    if (hasHardBlock) {
      toast({ title: "Blockerad", description: conflicts.find(c => c.startsWith("[BLOCK]"))?.replace("[BLOCK] ", "") || "Tilldelning blockerad av verksamhetsområdesregel" });
      return;
    }

    if (setWhatIfPending && setWhatIfOpen && fetchWhatIf) {
      const fromResourceId = job.resourceId || null;
      const fromDate = job.scheduledDate
        ? (typeof job.scheduledDate === "string"
          ? job.scheduledDate.split("T")[0]
          : (job.scheduledDate as Date).toISOString().split("T")[0])
        : null;

      setWhatIfPending({
        jobId,
        jobTitle: job.title || job.objectName || jobId.slice(0, 8),
        resourceId,
        scheduledDate: dateStr,
        scheduledStartTime,
      });
      setWhatIfOpen(true);
      fetchWhatIf(jobId, resourceId, dateStr, scheduledStartTime, fromResourceId, fromDate);
    } else {
      if (conflicts.length > 0) {
        setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts }); setConflictDialogOpen(true); return;
      }
      executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
      if (scheduledStartTime) toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
    }
  }, [workOrders, viewMode, currentDate, routeJobsForView, resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation, detectConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, executeTeamSchedule, toast, selectedJobIds, clearSelection, computeStartTime, resolveDropTarget, setWhatIfPending, setWhatIfOpen, fetchWhatIf]);

  return {
    sensors,
    collisionDetection: customCollisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    dragOverConflicts,
  };
}
