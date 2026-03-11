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

export function usePlannerDnd(opts: UsePlannerDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    opts.setActiveDragJob(opts.workOrders.find(j => j.id === event.active.id) || null);
  }, [opts.workOrders, opts.setActiveDragJob]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    opts.setActiveDragJob(null);
    const { active, over } = event;
    if (!over) return;
    const jobId = active.id as string;
    const dropId = over.id as string;

    if (opts.viewMode === "route" && opts.routeJobsForView.length > 0) {
      const isRouteJob = opts.routeJobsForView.some(j => j.id === jobId);
      const isDropOnRouteJob = opts.routeJobsForView.some(j => j.id === dropId);
      if (isRouteJob && isDropOnRouteJob && jobId !== dropId) {
        const oldIdx = opts.routeJobsForView.findIndex(j => j.id === jobId);
        const newIdx = opts.routeJobsForView.findIndex(j => j.id === dropId);
        if (oldIdx !== -1 && newIdx !== -1) {
          const newOrder = arrayMove(opts.routeJobsForView, oldIdx, newIdx);
          opts.setRouteJobOrder(newOrder.map(j => j.id));
          let mins = 8 * 60;
          const ds = format(opts.currentDate, "yyyy-MM-dd");
          newOrder.forEach((job, idx) => {
            opts.updateWorkOrderMutation.mutate({ id: job.id, resourceId: job.resourceId!, scheduledDate: ds, scheduledStartTime: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` });
            mins += (job.estimatedDuration || 30) + (idx < newOrder.length - 1 ? 5 : 0);
          });
          opts.toast({ title: "Körordning uppdaterad", description: `${newOrder.length} stopp har fått ny ordning` });
        }
        return;
      }
    }

    const job = opts.workOrders.find(j => j.id === jobId);
    if (!job) return;
    const parts = dropId.split("|");
    if (parts.length < 2) return;
    const resourceId = parts[0];
    const dateStr = parts[1];
    const hour = parts[2] ? parseInt(parts[2], 10) : undefined;
    const day = new Date(dateStr + "T12:00:00Z");
    if (job.resourceId === resourceId && job.scheduledDate && isSameDay(new Date(job.scheduledDate), day) && hour === undefined) return;

    let scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;
    if (!scheduledStartTime && opts.viewMode === "week") {
      const existing = (opts.resourceDayJobMap.jobs[resourceId]?.[dateStr] || []).filter(j => j.scheduledStartTime).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      let nextSlot = DAY_START_HOUR * 60;
      for (const e of existing) { const [eH, eM] = (e.scheduledStartTime || "07:00").split(":").map(Number); const end = eH * 60 + eM + (e.estimatedDuration || 60); if (end > nextSlot) nextSlot = end; }
      const h = Math.floor(nextSlot / 60);
      if (h < DAY_END_HOUR) scheduledStartTime = `${h.toString().padStart(2, "0")}:${(nextSlot % 60).toString().padStart(2, "0")}`;
    }

    const conflicts = opts.detectConflictsForJob(job, resourceId, dateStr, scheduledStartTime || null);
    if (conflicts.length > 0) { opts.setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts }); opts.setConflictDialogOpen(true); return; }
    opts.executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
    if (scheduledStartTime) opts.toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
  }, [opts]);

  return {
    sensors,
    collisionDetection: closestCenter,
    handleDragStart,
    handleDragEnd,
  };
}
