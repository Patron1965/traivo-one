import { useCallback } from "react";
import { useSensor, useSensors, PointerSensor, KeyboardSensor, closestCenter, type DragStartEvent, type DragEndEvent } from "@dnd-kit/core";
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
}

export function usePlannerDnd({
  workOrders, viewMode, currentDate, routeJobsForView, routeJobOrder,
  resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation,
  detectConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, toast,
}: UsePlannerDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragJob(workOrders.find(j => j.id === event.active.id) || null);
  }, [workOrders, setActiveDragJob]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragJob(null);
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

    let scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;
    if (!scheduledStartTime && viewMode === "week") {
      const existing = (resourceDayJobMap.jobs[resourceId]?.[dateStr] || []).filter(j => j.scheduledStartTime).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      let nextSlot = DAY_START_HOUR * 60;
      for (const e of existing) { const [eH, eM] = (e.scheduledStartTime || "07:00").split(":").map(Number); const end = eH * 60 + eM + (e.estimatedDuration || 60); if (end > nextSlot) nextSlot = end; }
      const h = Math.floor(nextSlot / 60);
      if (h < DAY_END_HOUR) scheduledStartTime = `${h.toString().padStart(2, "0")}:${(nextSlot % 60).toString().padStart(2, "0")}`;
    }

    const conflicts = detectConflictsForJob(job, resourceId, dateStr, scheduledStartTime || null);
    if (conflicts.length > 0) { setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts }); setConflictDialogOpen(true); return; }
    executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
    if (scheduledStartTime) toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
  }, [workOrders, viewMode, currentDate, routeJobsForView, resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation, detectConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, toast]);

  return {
    sensors,
    collisionDetection: closestCenter,
    handleDragStart,
    handleDragEnd,
  };
}
