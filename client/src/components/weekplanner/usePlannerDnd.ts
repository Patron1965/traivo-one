import { useCallback, useState, useRef, useEffect } from "react";
import { useSensor, useSensors, PointerSensor, KeyboardSensor, pointerWithin, rectIntersection, type DragStartEvent, type DragEndEvent, type DragOverEvent, type CollisionDetection } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { format, isSameDay } from "date-fns";
import { DAY_START_HOUR, DAY_END_HOUR } from "./types";
import { playDeliveryWindowAlert } from "@/lib/audio-cues";
import { haversineDistanceKm } from "@/lib/geo";
import type { WorkOrderWithObject } from "@shared/schema";

// Total körsträcka (km) längs en stopp-sekvens, beräknad via fågelvägen mellan
// uppgifternas koordinater (uppgiftsposition före objektposition).
function routeTotalKm(jobs: WorkOrderWithObject[]): number {
  let total = 0;
  for (let i = 0; i < jobs.length - 1; i++) {
    const a = jobs[i];
    const b = jobs[i + 1];
    const aLat = a.taskLatitude ?? a.objectLatitude;
    const aLng = a.taskLongitude ?? a.objectLongitude;
    const bLat = b.taskLatitude ?? b.objectLatitude;
    const bLng = b.taskLongitude ?? b.objectLongitude;
    if (aLat != null && aLng != null && bLat != null && bLng != null) {
      total += haversineDistanceKm(aLat, aLng, bLat, bLng);
    }
  }
  return total;
}

// Drop-zoner i kanten av veckovyn för att hoppa till föregående/nästa vecka mitt i ett drag (F2).
const WEEK_NAV_PREV_ID = "week-nav-prev";
const WEEK_NAV_NEXT_ID = "week-nav-next";
const SPRING_NAV_INTERVAL_MS = 850;

// Avgör om en konfliktlista innehåller en leveransfönster-/tidsfönster-överträdelse (F4).
function hasWindowViolation(reasons: string[]): boolean {
  return reasons.some(r => /leveransfönster|tidsfönster|fel dag/i.test(r));
}

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
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
  selectedJobIds?: Set<string>;
  clearSelection?: () => void;
  setWhatIfPending?: (pending: { jobId: string; jobTitle: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; clusterOverride?: boolean; bulkJobs?: Array<{ jobId: string; startTime: string }> } | null) => void;
  setWhatIfOpen?: (open: boolean) => void;
  fetchWhatIf?: (workOrderId: string, toResourceId: string, scheduledDate: string, scheduledStartTime?: string, fromResourceId?: string | null, fromDate?: string | null) => void;
  // F2: hoppa mellan veckor mitt i ett drag genom att hovra kant-zonerna.
  onSpringNavigate?: (dir: "prev" | "next") => void;
  // Callback som anropas när ett schemalagt jobb hamnar utanför den vy som visas.
  onScheduledOutOfView?: (info: { jobId: string; resourceId?: string; teamId?: string; dateStr: string }) => void;
}

export function usePlannerDnd({
  workOrders, viewMode, currentDate, routeJobsForView, routeJobOrder,
  resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation,
  detectConflictsForJob, detectTeamConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, executeTeamSchedule, toast,
  selectedJobIds, clearSelection,
  setWhatIfPending, setWhatIfOpen, fetchWhatIf,
  onSpringNavigate,
  onScheduledOutOfView,
}: UsePlannerDndOptions) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      // F2: prioritera vecka-navigerings-zonerna i kanten så att de vinner över cellen under.
      const navHit = pointerCollisions.find(c => c.id === WEEK_NAV_PREV_ID || c.id === WEEK_NAV_NEXT_ID);
      if (navHit) return [navHit];
      return pointerCollisions;
    }
    return rectIntersection(args);
  }, []);

  const [dragOverConflicts, setDragOverConflicts] = useState<Record<string, string[]>>({});
  const lastOverIdRef = useRef<string | null>(null);
  // F2: timer som upprepar vecka-byte medan man håller dragget i kant-zonen.
  const springTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // F2: håll alltid senaste navigate-callbacken i en ref så spring-intervallet inte fastnar
  // i en stale closure över currentWeekStart (annars navigerar varje tick tillbaka till samma vecka).
  const onSpringNavigateRef = useRef(onSpringNavigate);
  onSpringNavigateRef.current = onSpringNavigate;
  // Håll alltid senaste out-of-view-callback i en ref för att undvika stale closures i handleDragEnd.
  const onScheduledOutOfViewRef = useRef(onScheduledOutOfView);
  onScheduledOutOfViewRef.current = onScheduledOutOfView;
  const clearSpring = useCallback(() => {
    if (springTimerRef.current) {
      clearInterval(springTimerRef.current);
      springTimerRef.current = null;
    }
  }, []);
  // F2: städa spring-timern om planeraren avmonteras mitt i en kant-zon-hover.
  useEffect(() => clearSpring, [clearSpring]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    const found = workOrders.find(j => String(j.id) === activeId);
    if (!found) {
      console.warn("[dnd] handleDragStart: job not found in workOrders", { activeId, workOrderCount: workOrders.length });
    }
    setActiveDragJob(found || null);
    setDragOverConflicts({});
    lastOverIdRef.current = null;
    clearSpring();
  }, [workOrders, setActiveDragJob, clearSpring]);

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
      clearSpring();
      if (lastOverIdRef.current) {
        setDragOverConflicts({});
        lastOverIdRef.current = null;
      }
      return;
    }
    const dropId = over.id as string;
    if (dropId === lastOverIdRef.current) return;
    lastOverIdRef.current = dropId;
    clearSpring();

    // F2: hovra en kant-zon → hoppa till föregående/nästa vecka, upprepa medan dragget hålls kvar.
    if (dropId === WEEK_NAV_PREV_ID || dropId === WEEK_NAV_NEXT_ID) {
      setDragOverConflicts({});
      if (onSpringNavigateRef.current) {
        const dir = dropId === WEEK_NAV_NEXT_ID ? "next" : "prev";
        onSpringNavigateRef.current(dir);
        springTimerRef.current = setInterval(() => onSpringNavigateRef.current?.(dir), SPRING_NAV_INTERVAL_MS);
      }
      return;
    }

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
        if (hasWindowViolation(conflicts)) playDeliveryWindowAlert("hover");
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
      if (hasWindowViolation(allConflicts)) playDeliveryWindowAlert("hover");
    } else {
      setDragOverConflicts({});
    }
  }, [workOrders, detectConflictsForJob, detectTeamConflictsForJob, computeStartTime, selectedJobIds, resolveDropTarget, clearSpring]);

  // F2: avbrutet dragg (Escape) triggar inte onDragEnd → städa spring-timer + drag-state här annars läcker intervallet.
  const handleDragCancel = useCallback(() => {
    clearSpring();
    setDragOverConflicts({});
    lastOverIdRef.current = null;
    setActiveDragJob(null);
  }, [clearSpring, setActiveDragJob]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragJob(null);
    setDragOverConflicts({});
    lastOverIdRef.current = null;
    clearSpring();
    const { active, over } = event;
    if (!over) {
      toast({ title: "Släppte utanför", description: "Dra jobbet till en cell i schemat" });
      return;
    }
    const jobId = String(active.id);
    const dropId = String(over.id);

    // F2: släpp på en kant-zon gör inget i sig — vecka-bytet har redan skett under hovern.
    if (dropId === WEEK_NAV_PREV_ID || dropId === WEEK_NAV_NEXT_ID) {
      return;
    }

    if (viewMode === "route" && routeJobsForView.length > 0) {
      const isRouteJob = routeJobsForView.some(j => j.id === jobId);
      const isDropOnRouteJob = routeJobsForView.some(j => j.id === dropId);
      if (isRouteJob && isDropOnRouteJob && jobId !== dropId) {
        const oldIdx = routeJobsForView.findIndex(j => j.id === jobId);
        const newIdx = routeJobsForView.findIndex(j => j.id === dropId);
        if (oldIdx !== -1 && newIdx !== -1) {
          const newOrder = arrayMove(routeJobsForView, oldIdx, newIdx);
          // Konsekvens: jämför körsträcka före/efter omflyttningen (planeraren
          // flyttar på egen risk — ingen ny optimering görs).
          const kmBefore = routeTotalKm(routeJobsForView);
          const kmAfter = routeTotalKm(newOrder);
          const deltaKm = kmAfter - kmBefore;
          setRouteJobOrder(newOrder.map(j => j.id));
          let mins = 8 * 60;
          const ds = format(currentDate, "yyyy-MM-dd");
          newOrder.forEach((job, idx) => {
            updateWorkOrderMutation.mutate({ id: job.id, resourceId: job.resourceId!, scheduledDate: ds, scheduledStartTime: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` });
            mins += (job.estimatedDuration || 30) + (idx < newOrder.length - 1 ? 5 : 0);
          });
          const deltaAbs = Math.abs(deltaKm).toFixed(1).replace(".", ",");
          const consequence =
            Math.abs(deltaKm) < 0.05
              ? "oförändrad körsträcka"
              : deltaKm > 0
                ? `+${deltaAbs} km körsträcka`
                : `−${deltaAbs} km körsträcka`;
          toast({
            title: "Körordning uppdaterad",
            description: `${newOrder.length} stopp har fått ny ordning — ${consequence}. Flytt sker på planerarens egen risk.`,
            variant: deltaKm > 0.05 ? "destructive" : undefined,
          });
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
      // F4: ljudsignal om släppet hamnar utanför jobbets leveransfönster.
      if (detectTeamConflictsForJob && hasWindowViolation(detectTeamConflictsForJob(job, teamId, dateStr))) {
        playDeliveryWindowAlert("drop");
      }
      executeTeamSchedule(jobId, teamId, dateStr);
      onScheduledOutOfViewRef.current?.({ jobId, teamId, dateStr });
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

    // F4: ljudsignal om släppet hamnar utanför jobbets leveransfönster (resurs-läge).
    {
      const dropStartTime = computeStartTime(resourceId, dateStr, hour);
      if (hasWindowViolation(detectConflictsForJob(job, resourceId, dateStr, dropStartTime || null))) {
        playDeliveryWindowAlert("drop");
      }
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
      onScheduledOutOfViewRef.current?.({ jobId, resourceId, dateStr });
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
      onScheduledOutOfViewRef.current?.({ jobId, resourceId, dateStr });
      if (scheduledStartTime) toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
    }
  }, [workOrders, viewMode, currentDate, routeJobsForView, resourceDayJobMap, setActiveDragJob, setRouteJobOrder, updateWorkOrderMutation, detectConflictsForJob, detectTeamConflictsForJob, setPendingSchedule, setConflictDialogOpen, executeSchedule, executeTeamSchedule, toast, selectedJobIds, clearSelection, computeStartTime, resolveDropTarget, setWhatIfPending, setWhatIfOpen, fetchWhatIf, clearSpring]);

  return {
    sensors,
    collisionDetection: customCollisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    dragOverConflicts,
  };
}
