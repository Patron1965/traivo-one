import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, type DragEndEvent } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Calendar as CalendarIcon, Inbox, Loader2, ShieldAlert, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlaRiskJobsList, SlaRiskSummaryBadge } from "@/components/SlaRiskPanel";
import { format, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import type { WeekPlannerProps, PlannerDisplayMode } from "./weekplanner/types";
import { zoomLevels } from "./weekplanner/types";
import { DroppableCell, DraggableJobCard } from "./weekplanner/DndComponents";
import { JobCard, DragOverlayContent } from "./weekplanner/JobCard";
import { UnscheduledSidebar } from "./weekplanner/UnscheduledSidebar";
import { SendScheduleDialog, BulkSendScheduleDialog, ConflictDialog, ClearDialog, AutoFillDialog, DepChainDialog, ConflictListDialog } from "./weekplanner/PlannerDialogs";
import { AssignmentDialog } from "./weekplanner/BulkScheduleDialog";
import { PlannerToolbar, PlannerFooter } from "./weekplanner/PlannerToolbar";
import { PlannerAreaSearchPanel } from "./weekplanner/PlannerAreaSearchPanel";
import { BulkScheduleDialog } from "./weekplanner/BulkScheduleDialog";
import { DisruptionPanel } from "./weekplanner/DisruptionPanel";
import { DayTimelineView } from "./weekplanner/DayTimelineView";
import { WeekGridView } from "./weekplanner/WeekGridView";
import { MonthView } from "./weekplanner/MonthView";
import { RouteMapView } from "./weekplanner/RouteMapView";
import { ResourceFilterBar } from "./weekplanner/ResourceFilterBar";
import { usePlannerData } from "./weekplanner/usePlannerData";
import { usePlannerDnd } from "./weekplanner/usePlannerDnd";
import { UrgentJobDialog } from "./UrgentJobDialog";
import { WhatIfPreview } from "./weekplanner/WhatIfPreview";
import { usePlannerSync, openPlannerPopout, type AssignSlot, type PopoutView, type SyncedState, type RemoteDragInfo } from "./weekplanner/usePlannerSync";
import type { WorkOrderWithObject } from "@shared/schema";

function findDropIdAtClientPoint(clientX: number, clientY: number): string | null {
  if (typeof document === "undefined") return null;
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  let cur: Element | null = el;
  while (cur) {
    const tid = cur.getAttribute?.("data-testid");
    if (tid && tid.startsWith("droppable-cell-")) {
      return tid.slice("droppable-cell-".length);
    }
    cur = cur.parentElement;
  }
  return null;
}

function parseDropIdToTarget(dropId: string): { kind: "team"; teamId: string; dateStr: string } | { kind: "resource"; resourceId: string; dateStr: string; hour?: number } | null {
  if (dropId.startsWith("team:")) {
    const rest = dropId.slice(5);
    const [teamId, dateStr] = rest.split("|");
    if (!teamId || !dateStr) return null;
    return { kind: "team", teamId, dateStr };
  }
  const parts = dropId.split("|");
  if (parts.length < 2) return null;
  return {
    kind: "resource",
    resourceId: parts[0],
    dateStr: parts[1],
    hour: parts[2] ? parseInt(parts[2], 10) : undefined,
  };
}

export function WeekPlanner({ onAddJob, onSelectJob, onSelectedJobIdsChange, showAIPanel, onToggleAIPanel, displayMode = "full", popoutRole = "main" }: WeekPlannerProps) {
  const d = usePlannerData();
  const zoom = zoomLevels[d.zoomLevel];
  const [urgentDialogOpen, setUrgentDialogOpen] = useState(false);
  const [conflictListOpen, setConflictListOpen] = useState(false);
  const [slaRiskOpen, setSlaRiskOpen] = useState(false);
  const [areaSearchOpen, setAreaSearchOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("areaSearch") === "open";
  });
  const [extraDraggableJobs, setExtraDraggableJobs] = useState<WorkOrderWithObject[]>([]);
  const [areaSelectedIds, setAreaSelectedIds] = useState<Set<string>>(new Set());
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [bulkPrefill, setBulkPrefill] = useState<import("./weekplanner/BulkScheduleDialog").BulkSchedulePrefill | null>(null);
  const [bulkOverrideIds, setBulkOverrideIds] = useState<string[] | null>(null);
  const openBulkSchedule = useCallback((opts?: { overrideIds?: string[]; prefill?: import("./weekplanner/BulkScheduleDialog").BulkSchedulePrefill }) => {
    setBulkPrefill(opts?.prefill ?? null);
    setBulkOverrideIds(opts?.overrideIds ?? null);
    setBulkScheduleOpen(true);
  }, []);
  const toggleAreaSelection = useCallback((jobId: string) => {
    setAreaSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  }, []);
  const clearAreaSelection = useCallback(() => setAreaSelectedIds(new Set()), []);
  const selectAllAreaJobs = useCallback((ids: string[]) => setAreaSelectedIds(new Set(ids)), []);
  const dndWorkOrders = useMemo(() => {
    if (extraDraggableJobs.length === 0) return null;
    const seen = new Set<string>();
    const out: WorkOrderWithObject[] = [];
    for (const j of extraDraggableJobs) { if (!seen.has(j.id)) { seen.add(j.id); out.push(j); } }
    return out;
  }, [extraDraggableJobs]);
  const [urgentPreselectedOrder, setUrgentPreselectedOrder] = useState<WorkOrderWithObject | null>(null);
  const [poppedOutViews, setPoppedOutViews] = useState<Set<PopoutView>>(new Set());
  const [crossWindowSlot, setCrossWindowSlot] = useState<AssignSlot | null>(null);
  const [remoteSelectedSlot, setRemoteSelectedSlot] = useState<AssignSlot | null>(null);
  // Remote drag state — set when ANOTHER window is currently dragging
  const [remoteDrag, setRemoteDrag] = useState<RemoteDragInfo>({ jobId: null, senderRole: null });
  // Which dropId in OUR window the remote pointer is currently hovering over
  const [remoteHoveredDropId, setRemoteHoveredDropId] = useState<string | null>(null);
  // Refs used by drag handlers (avoid stale closures)
  const remoteDragRef = useRef<RemoteDragInfo>({ jobId: null, senderRole: null });
  remoteDragRef.current = remoteDrag;
  const remoteHoveredDropIdRef = useRef<string | null>(null);
  remoteHoveredDropIdRef.current = remoteHoveredDropId;
  // When WE are the drag source, the dropId broadcast back from the receiving window.
  // Includes the receiver's senderId and a freshness timestamp so we can ignore stale data
  // if the receiver popout closes mid-drag or stops broadcasting.
  const localDragRemoteHoverRef = useRef<{ senderId: string; dropId: string; lastSeen: number } | null>(null);
  // How fresh a remote hover must be (ms) to be trusted as the auto-assign target on drop
  const REMOTE_HOVER_FRESH_MS = 1500;
  // Tracks whether THIS window currently has a local drag in progress, so cross-window
  // hover broadcasts from other windows are only consumed when we're actually the drag source.
  // (Prevents stale hover capture in multi-window setups, e.g. main + 2 popouts.)
  const localActiveDragJobRef = useRef<string | null>(null);
  localActiveDragJobRef.current = d.activeDragJob?.id ?? null;

  const syncedState = useMemo<SyncedState>(() => ({
    weekStart: format(d.currentWeekStart, "yyyy-MM-dd"),
    currentDate: format(d.currentDate, "yyyy-MM-dd"),
    viewMode: d.viewMode,
    selectedJob: d.selectedJob,
    filters: {
      customer: d.filterCustomer,
      priority: d.filterPriority,
      cluster: d.filterCluster,
      team: d.filterTeam,
      executionCode: d.filterExecutionCode,
      search: d.orderstockSearch,
    },
  }), [d.currentWeekStart, d.currentDate, d.viewMode, d.selectedJob, d.filterCustomer, d.filterPriority, d.filterCluster, d.filterTeam, d.filterExecutionCode, d.orderstockSearch]);

  const applyRemoteState = useCallback((s: SyncedState) => {
    if (s.weekStart) {
      const ws = new Date(s.weekStart + "T00:00:00");
      if (!isNaN(ws.getTime())) d.setCurrentWeekStart(ws);
    }
    if (s.currentDate) {
      const cd = new Date(s.currentDate + "T00:00:00");
      if (!isNaN(cd.getTime())) d.setCurrentDate(cd);
    }
    if (s.viewMode && s.viewMode !== d.viewMode) d.setViewMode(s.viewMode);
    if (s.selectedJob !== d.selectedJob) d.setSelectedJob(s.selectedJob ?? null);
    if (s.filters) {
      if (s.filters.customer !== d.filterCustomer) d.setFilterCustomer(s.filters.customer);
      if (s.filters.priority !== d.filterPriority) d.setFilterPriority(s.filters.priority);
      if (s.filters.cluster !== d.filterCluster) d.setFilterCluster(s.filters.cluster);
      if (s.filters.team !== d.filterTeam) d.setFilterTeam(s.filters.team);
      if (s.filters.executionCode !== d.filterExecutionCode) d.setFilterExecutionCode(s.filters.executionCode);
      if (s.filters.search !== d.orderstockSearch) d.setOrderstockSearch(s.filters.search);
    }
  }, [d]);

  const handleRemoteDragChange = useCallback((info: RemoteDragInfo) => {
    setRemoteDrag(info);
    if (!info.jobId) {
      setRemoteHoveredDropId(null);
    }
  }, []);

  // Ref to sync API — populated after usePlannerSync runs; used to break a circular dep
  const syncApiRef = useRef<{ broadcastDragPointer: (x: number, y: number) => void; broadcastDragHover: (id: string | null) => void } | null>(null);

  const handleRemoteDragPointer = useCallback((screenX: number, screenY: number) => {
    // Convert source-screen coords to OUR client coords; approximate browser chrome offset
    const chromeY = Math.max(0, window.outerHeight - window.innerHeight);
    const chromeX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const clientX = screenX - window.screenX - chromeX;
    const clientY = screenY - window.screenY - chromeY;
    if (clientX < 0 || clientY < 0 || clientX > window.innerWidth || clientY > window.innerHeight) {
      if (remoteHoveredDropIdRef.current !== null) {
        setRemoteHoveredDropId(null);
        syncApiRef.current?.broadcastDragHover(null);
      }
      return;
    }
    const dropId = findDropIdAtClientPoint(clientX, clientY);
    if (dropId !== remoteHoveredDropIdRef.current) {
      setRemoteHoveredDropId(dropId);
      syncApiRef.current?.broadcastDragHover(dropId);
    }
  }, []);

  const handleRemoteDragHover = useCallback((dropId: string | null, _senderRole: unknown, senderId: string) => {
    // Only the active drag source consumes hover broadcasts. If we're not currently
    // dragging locally, ignore — otherwise hover from someone else's drag could be
    // captured and consumed on a later, unrelated drop in this window.
    if (!localActiveDragJobRef.current) return;
    if (dropId === null) {
      // Receiver explicitly told us its pointer left all droppable cells — clear any stale target
      const cur = localDragRemoteHoverRef.current;
      if (cur && cur.senderId === senderId) {
        localDragRemoteHoverRef.current = null;
      }
      return;
    }
    localDragRemoteHoverRef.current = { senderId, dropId, lastSeen: Date.now() };
  }, []);

  // If the receiver popout closes mid-drag (graceful close OR detected via heartbeat),
  // drop any stale hover ref pointing at it so we never auto-assign to a vanished window.
  const handleRemoteSenderClosed = useCallback((senderId: string) => {
    const cur = localDragRemoteHoverRef.current;
    if (cur && cur.senderId === senderId) {
      localDragRemoteHoverRef.current = null;
    }
  }, []);

  const sync = usePlannerSync({
    role: popoutRole,
    state: syncedState,
    applyRemoteState,
    onPopoutsChange: setPoppedOutViews,
    selectedSlot: crossWindowSlot,
    onRemoteSlotChange: setRemoteSelectedSlot,
    localDragJobId: d.activeDragJob?.id ?? null,
    onRemoteDragChange: handleRemoteDragChange,
    onRemoteDragPointer: handleRemoteDragPointer,
    onRemoteDragHover: handleRemoteDragHover,
    onRemoteSenderClosed: handleRemoteSenderClosed,
  });
  syncApiRef.current = sync;

  // While we are dragging locally, broadcast pointer screen coords (throttled inside hook)
  useEffect(() => {
    if (!d.activeDragJob) {
      localDragRemoteHoverRef.current = null;
      return;
    }
    const onMove = (e: PointerEvent) => {
      syncApiRef.current?.broadcastDragPointer(e.screenX, e.screenY);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, [d.activeDragJob]);

  const handleOpenPopout = useCallback((view: PopoutView) => {
    if (poppedOutViews.has(view)) return;
    openPlannerPopout(view);
  }, [poppedOutViews]);

  const handleCrossWindowAssign = useCallback((job: WorkOrderWithObject) => {
    if (!remoteSelectedSlot) return;
    const slotLabel = `${remoteSelectedSlot.resourceName} · ${remoteSelectedSlot.date}${remoteSelectedSlot.startTime ? ` ${remoteSelectedSlot.startTime}` : ""}`;
    d.updateWorkOrderMutation.mutate(
      {
        id: job.id,
        resourceId: remoteSelectedSlot.resourceId,
        scheduledDate: remoteSelectedSlot.date,
        ...(remoteSelectedSlot.startTime ? { scheduledStartTime: remoteSelectedSlot.startTime } : {}),
      },
      {
        onSuccess: () => {
          d.toast({
            title: "Uppgift tilldelad",
            description: `${(job.title || "Uppgift").slice(0, 60)} → ${slotLabel}`,
          });
        },
        onError: (err: unknown) => {
          d.toast({
            title: "Tilldelning misslyckades",
            description: err instanceof Error ? err.message : "Kunde inte tilldela uppgiften till vald slot.",
            variant: "destructive",
          });
        },
      },
    );
  }, [remoteSelectedSlot, d]);

  type EffectiveDisplayMode = "full" | "calendar-only" | "orderlager-only" | "neither";
  const effectiveDisplayMode = useMemo<EffectiveDisplayMode>(() => {
    if (displayMode !== "full") return displayMode;
    if (popoutRole !== "main") return displayMode;
    const calOut = poppedOutViews.has("calendar");
    const ordOut = poppedOutViews.has("orderlager");
    if (calOut && ordOut) return "neither";
    if (ordOut) return "calendar-only";
    if (calOut) return "orderlager-only";
    return "full";
  }, [displayMode, popoutRole, poppedOutViews]);

  const showSidebar = effectiveDisplayMode === "full" || effectiveDisplayMode === "orderlager-only";
  const showCalendar = effectiveDisplayMode === "full" || effectiveDisplayMode === "calendar-only";
  const sidebarDisplayMode: PlannerDisplayMode = effectiveDisplayMode === "neither" ? "full" : effectiveDisplayMode;

  useEffect(() => {
    onSelectedJobIdsChange?.(d.selectedJobIds);
  }, [d.selectedJobIds, onSelectedJobIdsChange]);

  const handleEscalateUrgent = useCallback((job: WorkOrderWithObject) => {
    setUrgentPreselectedOrder(job);
    setUrgentDialogOpen(true);
  }, []);

  const handleOpenUrgentDialog = useCallback(() => {
    setUrgentPreselectedOrder(null);
    setUrgentDialogOpen(true);
  }, []);

  const combinedWorkOrders = useMemo(() => {
    if (!dndWorkOrders) return d.workOrders;
    const ids = new Set(d.workOrders.map(j => j.id));
    const extras = dndWorkOrders.filter(j => !ids.has(j.id));
    return extras.length ? [...d.workOrders, ...extras] : d.workOrders;
  }, [d.workOrders, dndWorkOrders]);

  const dnd = usePlannerDnd({
    workOrders: combinedWorkOrders,
    viewMode: d.viewMode,
    currentDate: d.currentDate,
    routeJobsForView: d.routeJobsForView,
    routeJobOrder: d.routeJobOrder,
    resourceDayJobMap: d.resourceDayJobMap,
    setActiveDragJob: d.setActiveDragJob,
    setRouteJobOrder: d.setRouteJobOrder,
    updateWorkOrderMutation: d.updateWorkOrderMutation,
    detectConflictsForJob: d.detectConflictsForJob,
    detectTeamConflictsForJob: d.detectTeamConflictsForJob,
    setPendingSchedule: d.setPendingSchedule,
    setConflictDialogOpen: d.setConflictDialogOpen,
    executeSchedule: d.executeSchedule,
    executeTeamSchedule: d.executeTeamSchedule,
    toast: d.toast,
    selectedJobIds: d.selectedJobIds,
    clearSelection: d.clearSelection,
    setWhatIfPending: d.setWhatIfPending,
    setWhatIfOpen: d.setWhatIfOpen,
    fetchWhatIf: d.fetchWhatIf,
  });

  // Wrap dnd.handleDragEnd to auto-assign on cross-window drop:
  // If our local drag ended without a local "over" target but a remote window broadcasted
  // a hover dropId, perform the assignment as if the user dropped on that remote slot.
  // Guards: hover must originate from a still-active sender (not closed) AND be recent
  // (REMOTE_HOVER_FRESH_MS) — otherwise we fall back to normal drag-end handling and avoid
  // any state corruption if the receiving window closed mid-drag.
  const handleDragEndWithRemote = useCallback((event: DragEndEvent) => {
    const cur = localDragRemoteHoverRef.current;
    const isFresh = !!cur && (Date.now() - cur.lastSeen) < REMOTE_HOVER_FRESH_MS;
    if (event.active && !event.over && cur && isFresh) {
      const target = parseDropIdToTarget(cur.dropId);
      const jobId = String(event.active.id);
      const job = combinedWorkOrders.find(j => String(j.id) === jobId);
      if (target && job) {
        if (target.kind === "team" && d.executeTeamSchedule) {
          d.executeTeamSchedule(job.id, target.teamId, target.dateStr);
        } else if (target.kind === "resource") {
          // Mirror usePlannerDnd.computeStartTime: use the cell hour when present;
          // otherwise (week-mode whole-day drop) compute the next free slot for that resource/day.
          let startTime: string | undefined = target.hour !== undefined
            ? `${String(target.hour).padStart(2, "0")}:00`
            : undefined;
          if (!startTime) {
            const existing = (d.resourceDayJobMap?.jobs?.[target.resourceId]?.[target.dateStr] || [])
              .filter((j: WorkOrderWithObject) => j.scheduledStartTime)
              .sort((a: WorkOrderWithObject, b: WorkOrderWithObject) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
            let nextSlot = 7 * 60;
            for (const e of existing) {
              const [eH, eM] = (e.scheduledStartTime || "07:00").split(":").map(Number);
              const end = eH * 60 + eM + (e.estimatedDuration || 60);
              if (end > nextSlot) nextSlot = end;
            }
            const h = Math.floor(nextSlot / 60);
            startTime = h < 17 ? `${String(h).padStart(2, "0")}:${String(nextSlot % 60).padStart(2, "0")}` : "07:00";
          }
          d.executeSchedule(job.id, target.resourceId, target.dateStr, startTime);
        }
        d.toast({ title: "Schemalagt över fönster", description: `${job.title} tilldelad via popout-fönster` });
        d.setActiveDragJob(null);
        localDragRemoteHoverRef.current = null;
        return;
      }
    }
    if (cur && !isFresh) {
      console.info("[planner-sync] ignoring stale remote hover on drag-end", { ageMs: Date.now() - cur.lastSeen });
    }
    localDragRemoteHoverRef.current = null;
    dnd.handleDragEnd(event);
  }, [dnd, d]);

  const handleJobClickWithCallback = useCallback((jobId: string) => {
    d.handleJobClick(jobId);
    onSelectJob?.(jobId);
  }, [d.handleJobClick, onSelectJob]);

  const handleNavigateToConflictJob = useCallback((jobId: string, date: Date) => {
    d.goToDay(date);
    d.handleJobClick(jobId);
    onSelectJob?.(jobId);
  }, [d.goToDay, d.handleJobClick, onSelectJob]);

  const jobCardProps = useMemo(() => ({
    selectedJob: d.selectedJob,
    jobConflicts: d.jobConflicts,
    dependenciesData: d.dependenciesData,
    timewindowMap: d.timewindowMap,
    expandedSubSteps: d.expandedSubSteps,
    onJobClick: handleJobClickWithCallback,
    onUnschedule: d.handleUnschedule,
    onToggleSubStep: d.handleToggleSubStep,
    onOpenDepChain: d.handleOpenDepChain,
    selectedJobIds: d.selectedJobIds,
    onToggleSelection: d.toggleJobSelection,
    onEscalateUrgent: handleEscalateUrgent,
  }), [d.selectedJob, d.jobConflicts, d.dependenciesData, d.timewindowMap, d.expandedSubSteps, handleJobClickWithCallback, d.handleUnschedule, d.handleToggleSubStep, d.handleOpenDepChain, d.selectedJobIds, d.toggleJobSelection, handleEscalateUrgent]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          onAddJob?.();
          break;
        case "f":
          e.preventDefault();
          d.setAutoFillDialogOpen(true);
          break;
        case "1":
          e.preventDefault();
          d.handleViewModeChange("day");
          break;
        case "2":
          e.preventDefault();
          d.handleViewModeChange("week");
          break;
        case "3":
          e.preventDefault();
          d.handleViewModeChange("month");
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAddJob, d.setAutoFillDialogOpen, d.handleViewModeChange]);

  const isLoading = d.resourcesLoading || d.workOrdersLoading;
  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const showPersistentPopoutStrip = popoutRole === "main" && effectiveDisplayMode !== "full";

  return (
    <DndContext sensors={dnd.sensors} collisionDetection={dnd.collisionDetection} onDragStart={dnd.handleDragStart} onDragOver={dnd.handleDragOver} onDragEnd={handleDragEndWithRemote}>
      <div className="flex flex-col h-full">
        {showPersistentPopoutStrip && (
          <div className="flex items-center justify-between gap-2 border-y border-card-border bg-card px-3 py-1.5 text-xs" data-testid="strip-popout-controls">
            <span className="text-muted-foreground truncate">
              {effectiveDisplayMode === "neither"
                ? "Båda vyer i pop-out"
                : effectiveDisplayMode === "calendar-only"
                  ? "Orderlager i pop-out"
                  : "Kalender i pop-out"}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant={poppedOutViews.has("calendar") ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2"
                onClick={() => handleOpenPopout("calendar")}
                disabled={poppedOutViews.has("calendar")}
                data-testid="strip-button-popout-calendar"
                title={poppedOutViews.has("calendar") ? "Kalender redan i pop-out" : "Öppna kalender i pop-out"}
              >
                <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                Kalender
              </Button>
              <Button
                variant={poppedOutViews.has("orderlager") ? "secondary" : "outline"}
                size="sm"
                className="h-7 px-2"
                onClick={() => handleOpenPopout("orderlager")}
                disabled={poppedOutViews.has("orderlager")}
                data-testid="strip-button-popout-orderlager"
                title={poppedOutViews.has("orderlager") ? "Orderlager redan i pop-out" : "Öppna orderlager i pop-out"}
              >
                <Inbox className="h-3.5 w-3.5 mr-1" />
                Orderlager
              </Button>
            </div>
          </div>
        )}
      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <UnscheduledSidebar
            showUnscheduled={d.showUnscheduled} setShowUnscheduled={d.setShowUnscheduled}
            unscheduledJobs={d.unscheduledJobs} unscheduledTotal={d.unscheduledTotal} accumulatedCount={d.accumulatedUnscheduled.length}
            hasMoreUnscheduled={d.hasMoreUnscheduled} loadMoreLoading={d.loadMoreLoading} loadMoreUnscheduled={d.loadMoreUnscheduled}
            orderstockSearch={d.orderstockSearch} setOrderstockSearch={d.setOrderstockSearch}
            sidebarFiltersOpen={d.sidebarFiltersOpen} setSidebarFiltersOpen={d.setSidebarFiltersOpen}
            sidebarActiveFilterCount={d.sidebarActiveFilterCount} clearAllSidebarFilters={d.clearAllSidebarFilters}
            sidebarQuickStats={d.sidebarQuickStats}
            filterCustomer={d.filterCustomer} setFilterCustomer={d.setFilterCustomer}
            filterPriority={d.filterPriority} setFilterPriority={d.setFilterPriority}
            filterCluster={d.filterCluster} setFilterCluster={d.setFilterCluster}
            filterTeam={d.filterTeam} setFilterTeam={d.setFilterTeam}
            filterExecutionCode={d.filterExecutionCode} setFilterExecutionCode={d.setFilterExecutionCode}
            filterDateField={d.filterDateField} setFilterDateField={d.setFilterDateField}
            filterDatePeriod={d.filterDatePeriod} setFilterDatePeriod={d.setFilterDatePeriod}
            filterDateCustomFrom={d.filterDateCustomFrom} setFilterDateCustomFrom={d.setFilterDateCustomFrom}
            filterDateCustomTo={d.filterDateCustomTo} setFilterDateCustomTo={d.setFilterDateCustomTo}
            dateFilterActive={d.dateFilterActive}
            unscheduledMissingDateCount={d.unscheduledMissingDateCount}
            missingDateExpanded={d.missingDateExpanded} setMissingDateExpanded={d.setMissingDateExpanded}
            missingDateJobs={d.missingDateJobs} missingDateLoading={d.missingDateLoading}
            customers={d.customers} clusters={d.clusters} teamsData={d.teamsData}
            customerMap={d.customerMap} clusterMap={d.clusterMap}
            selectedJob={d.selectedJob} onJobClick={handleJobClickWithCallback} onOpenAssignDialog={d.handleOpenAssignDialog}
            timewindowMap={d.timewindowMap}
            currentWeekStart={d.currentWeekStart}
            activeDragJob={d.activeDragJob}
            clusterMatchedResourceIds={d.clusterMatchedResourceIds}
            visibleResources={d.visibleResources}
            expanded={effectiveDisplayMode === "orderlager-only"}
            remoteSlot={remoteSelectedSlot}
            onCrossWindowAssign={handleCrossWindowAssign}
            selectedJobIds={d.selectedJobIds}
          />
        )}

        {showCalendar && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <PlannerToolbar
            viewMode={d.viewMode} headerLabel={d.getHeaderLabel()}
            onNavigate={d.navigate} onGoToday={d.goToToday} onViewModeChange={d.handleViewModeChange}
            undoCount={d.undoStack.length} redoCount={d.redoStack.length} onUndo={d.handleUndo} onRedo={d.handleRedo}
            zoomLevel={d.zoomLevel} setZoomLevel={d.setZoomLevel}
            resources={d.resources} visibleResources={d.visibleResources}
            hiddenResourceIds={d.hiddenResourceIds} setHiddenResourceIds={d.setHiddenResourceIds}
            weekRowMode={d.weekRowMode} teamsData={d.teamsData}
            selectedTeamIds={d.selectedTeamIds} setSelectedTeamIds={d.setSelectedTeamIds}
            onAddJob={onAddJob} onAutoFill={() => { d.setAutoFillDialogOpen(true); }}
            onClearAll={() => d.setClearDialogOpen(true)}
            onCarryOver={d.handleCarryOver}
            onUrgentJob={handleOpenUrgentDialog}
            showAIPanel={showAIPanel} onToggleAIPanel={onToggleAIPanel}
            areaSearchOpen={areaSearchOpen}
            onToggleAreaSearch={() => setAreaSearchOpen(o => !o)}
            weekGoals={d.weekGoals} weekTravelTotal={d.weekTravelTotal}
            visibleDates={d.visibleDates} getResourceDayHours={d.getResourceDayHours}
            jobConflictCount={Object.keys(d.jobConflicts).length}
            filteredScheduledCount={d.filteredScheduledJobs.length}
            unscheduledCount={d.unscheduledJobs.length}
            showConstraintLayer={d.showConstraintLayer}
            onToggleConstraintLayer={() => d.setShowConstraintLayer(!d.showConstraintLayer)}
            onPublishWeek={d.openBulkSendDialog}
            popoutRole={popoutRole}
            displayMode={effectiveDisplayMode}
            poppedOutViews={poppedOutViews}
            onOpenPopout={handleOpenPopout}
            crossWindowSlot={crossWindowSlot}
            setCrossWindowSlot={setCrossWindowSlot}
          />

          <DisruptionPanel />

          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b dark:border-gray-800 bg-muted/40">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">SLA-tidigvarning:</span>
              <SlaRiskSummaryBadge />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSlaRiskOpen(true)}
              data-testid="button-open-sla-risk-panel"
            >
              Visa risker
            </Button>
          </div>

          {d.activeDragJob && d.activeDragJob.clusterId && d.clusterMatchedResourceIds.size === 0 && d.visibleResources.some(r => r.serviceArea && r.serviceArea.length > 0) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 dark:bg-warning/15 border-b border-warning/20 dark:border-warning/80 animate-in fade-in slide-in-from-top-1 duration-200" data-testid="drag-no-cluster-match-warning">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
              <span className="text-xs text-warning">
                Ingen synlig resurs matchar klustret för detta jobb. Kontrollera resursernas serviceområden.
              </span>
            </div>
          )}

          {(d.viewMode === "day" || d.viewMode === "week") && (
            <ResourceFilterBar
              resourceNameFilter={d.resourceNameFilter}
              setResourceNameFilter={d.setResourceNameFilter}
              resourceExecutionCodeFilter={d.resourceExecutionCodeFilter}
              setResourceExecutionCodeFilter={d.setResourceExecutionCodeFilter}
              resourceOccupancyFilter={d.resourceOccupancyFilter}
              setResourceOccupancyFilter={d.setResourceOccupancyFilter}
              filterTeam={d.filterTeam}
              setFilterTeam={d.setFilterTeam}
              teamsData={d.teamsData}
              allExecutionCodes={d.allExecutionCodes}
              resourceActiveFilterCount={d.resourceActiveFilterCount}
              clearResourceFilters={d.clearResourceFilters}
              showRowModeToggle={d.viewMode === "week"}
              weekRowMode={d.weekRowMode}
              setWeekRowMode={d.setWeekRowMode}
              selectedTeamIds={d.selectedTeamIds}
              setSelectedTeamIds={d.setSelectedTeamIds}
            />
          )}

          {d.viewMode === "day" && (
            <DayTimelineView
              currentDate={d.currentDate} visibleResources={d.visibleResources}
              timeRestrictions={d.timeRestrictions}
              getJobsForResourceAndDay={d.getJobsForResourceAndDay}
              getResourceDayHours={d.getResourceDayHours} getCapacityPercentage={d.getCapacityPercentage}
              getDropFitClass={d.getDropFitClass} activeDragJob={d.activeDragJob}
              travelTimesForDay={d.travelTimesForDay} zoom={zoom}
              jobCardProps={jobCardProps}
              dragOverConflicts={dnd.dragOverConflicts}
              clusterMatchedResourceIds={d.clusterMatchedResourceIds}
              showConstraintLayer={d.showConstraintLayer}
              constraintMap={d.constraintMap}
              remoteDragActive={!!remoteDrag.jobId}
              remoteHoveredDropId={remoteHoveredDropId}
            />
          )}
          {d.viewMode === "week" && (
            <WeekGridView
              visibleDates={d.visibleDates} visibleResources={d.visibleResources}
              getJobsForResourceAndDay={d.getJobsForResourceAndDay}
              getResourceDayHours={d.getResourceDayHours} getCapacityPercentage={d.getCapacityPercentage}
              getCapacityColor={d.getCapacityColor} getCapacityBgColor={d.getCapacityBgColor}
              getDropFitClass={d.getDropFitClass} activeDragJob={d.activeDragJob}
              restrictionsByObject={d.restrictionsByObject} resourceWeekSummary={d.resourceWeekSummary}
              zoom={zoom} weatherByDate={d.weatherByDate}
              onResourceClick={d.handleResourceClick} onSendSchedule={d.handleSendSchedule}
              jobCardProps={jobCardProps}
              dragOverConflicts={dnd.dragOverConflicts}
              clusterMatchedResourceIds={d.clusterMatchedResourceIds}
              showConstraintLayer={d.showConstraintLayer}
              constraintMap={d.constraintMap}
              remoteDragActive={!!remoteDrag.jobId}
              remoteHoveredDropId={remoteHoveredDropId}
              currentPeriod={d.currentPeriodRange}
              rowMode={d.weekRowMode}
              teamRows={d.teamRows}
              getJobsForTeamAndDay={d.getJobsForTeamAndDay}
              getTeamDayHours={d.getTeamDayHours}
              teamWeekSummary={d.teamWeekSummary}
              hiddenUntiedTeamSummary={d.hiddenUntiedTeamSummary}
              showingUntiedUnderFilter={d.selectedTeamIds.length > 0 && d.showUntiedTeamRows}
              onShowUntiedTeamRows={() => d.setShowUntiedTeamRows(true)}
              onHideUntiedTeamRows={() => d.setShowUntiedTeamRows(false)}
              allResources={d.resources}
              teamMembersData={d.teamMembersData}
            />
          )}
          {d.viewMode === "month" && (
            <MonthView
              currentDate={d.currentDate} filteredScheduledJobs={d.filteredScheduledJobs}
              jobConflicts={d.jobConflicts} timeRestrictions={d.timeRestrictions}
              zoom={zoom} goToDay={d.goToDay}
            />
          )}
          {d.viewMode === "route" && (
            <RouteMapView
              currentDate={d.currentDate} resources={d.resources}
              routeViewResourceId={d.routeViewResourceId} setRouteViewResourceId={(v) => { d.setRouteViewResourceId(v); d.setRouteJobOrder([]); }}
              routeJobs={d.routeJobsForView} routeJobOrder={d.routeJobOrder}
              customerMap={d.customerMap} isOptimizing={d.isOptimizing}
              selectedJob={d.selectedJob} onJobClick={handleJobClickWithCallback}
              onSortEnd={() => {}} onOptimizeRoute={d.handleOptimizeRoute}
              onSendSchedule={d.handleSendSchedule}
            />
          )}

          <PlannerFooter
            jobConflictCount={Object.keys(d.jobConflicts).length}
            filteredScheduledCount={d.filteredScheduledJobs.length}
            unscheduledCount={d.unscheduledJobs.length}
            onConflictClick={() => setConflictListOpen(true)}
          />
        </div>
        )}

        {showCalendar && (
          <PlannerAreaSearchPanel
            open={areaSearchOpen}
            onClose={() => setAreaSearchOpen(false)}
            onSelectJob={(jobId) => { d.handleJobClick(jobId); onSelectJob?.(jobId); }}
            onResultsChange={setExtraDraggableJobs}
            selectedJobIds={areaSelectedIds}
            onToggleSelection={toggleAreaSelection}
            onClearSelection={clearAreaSelection}
            onSelectAll={selectAllAreaJobs}
            onBulkSchedule={openBulkSchedule}
            getResourceDayHours={(rid, dateStr) => d.getResourceDayHours(rid, new Date(dateStr + "T00:00:00"))}
            getTeamDayHours={(tid, dateStr) => d.getTeamDayHours(tid, new Date(dateStr + "T00:00:00"))}
            resourceNameById={new Map(d.resources.map(r => [r.id, r.name]))}
            teamNameById={new Map(d.teamsData.map(t => [t.id, t.name]))}
          />
        )}

        {effectiveDisplayMode === "neither" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-6 text-center">
            <p>Båda vyer är öppna i andra fönster.</p>
            <p className="text-xs">Stäng ett pop-out-fönster för att visa innehållet här igen.</p>
          </div>
        )}
      </div>

        <Sheet open={!!d.activeResourceId} onOpenChange={(open) => !open && d.setActiveResourceId(null)}>
          <SheetContent className="w-[400px] sm:w-[450px] p-0 flex flex-col">
            {d.activeResource && (
              <>
                <SheetHeader className="p-4 border-b">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12"><AvatarFallback className="text-lg">{d.activeResource.initials || d.activeResource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback></Avatar>
                    <div>
                      <SheetTitle className="text-left">{d.activeResource.name}</SheetTitle>
                      <p className="text-sm text-muted-foreground">{d.activeResource.resourceType || "Fälttekniker"} • {d.activeResource.weeklyHours || 40}h/vecka</p>
                    </div>
                  </div>
                </SheetHeader>
                <div className="p-4 border-b bg-muted/30">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2"><User className="h-4 w-4" /><span>Veckoschema - Dra jobb hit för att schemalägga</span></div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-background rounded-md p-2 text-center"><div className="font-medium">{d.activeResourceJobs.length}</div><div className="text-muted-foreground">jobb</div></div>
                    <div className="bg-background rounded-md p-2 text-center"><div className="font-medium">{(d.activeResourceJobs.reduce((s, j) => s + (j.estimatedDuration || 0), 0) / 60).toFixed(1).replace(".", ",")} h</div><div className="text-muted-foreground">planerat</div></div>
                    <div className="bg-background rounded-md p-2 text-center"><div className="font-medium">{Object.keys(d.activeResourceJobsByDay).length}</div><div className="text-muted-foreground">dagar</div></div>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-4">
                    {d.visibleDates.map((day) => {
                      const dayKey = format(day, "yyyy-MM-dd");
                      const dayJobs = d.activeResourceJobsByDay[dayKey] || [];
                      const dayHours = dayJobs.reduce((s, j) => s + (j.estimatedDuration || 0) / 60, 0);
                      const droppableId = `${d.activeResourceId}|${dayKey}`;
                      return (
                        <div key={dayKey} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className={`text-sm font-medium ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>{format(day, "EEEE d MMM", { locale: sv })}</div>
                            <Badge variant="secondary" className="text-xs">{dayHours.toFixed(1)}h</Badge>
                          </div>
                          <DroppableCell id={droppableId} className="min-h-[80px] border border-dashed rounded-md p-2 transition-colors" dragOverConflicts={dnd.dragOverConflicts?.[droppableId]}>
                            <div data-testid={`panel-drop-zone-${dayKey}`}>
                              {dayJobs.length === 0 ? (
                                <div className="text-xs text-muted-foreground text-center py-4">Dra jobb hit för att schemalägga</div>
                              ) : (
                                <div className="space-y-2">{dayJobs.map(job => (
                                  <DraggableJobCard key={job.id} id={job.id}>
                                    <JobCard job={job} {...jobCardProps} />
                                  </DraggableJobCard>
                                ))}</div>
                              )}
                            </div>
                          </DroppableCell>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
        {d.activeDragJob && <DragOverlayContent job={d.activeDragJob} timewindowMap={d.timewindowMap} />}
      </DragOverlay>

      <AssignmentDialog
        open={d.assignDialogOpen}
        onOpenChange={(v) => { d.setAssignDialogOpen(v); }}
        workOrderIds={d.jobToAssign ? [d.jobToAssign.id] : []}
        jobs={d.jobToAssign ? [d.jobToAssign] : []}
        resources={d.resources}
        teams={d.teamsData}
        prefill={d.jobToAssign ? { date: d.assignDate, target: "resource", resourceId: null, teamId: null } : null}
        recommendationContext={d.jobToAssign ? { objectId: d.jobToAssign.objectId, clusterId: d.jobToAssign.clusterId } : null}
        title="Tilldela resurs"
        description={d.jobToAssign ? `Välj resurs och datum för: ${d.jobToAssign.title}` : undefined}
        onSuccess={() => { d.setAssignDialogOpen(false); }}
      />
      <SendScheduleDialog
        open={d.sendScheduleDialogOpen}
        onOpenChange={d.setSendScheduleDialogOpen}
        resource={d.sendScheduleResource}
        onSend={d.submitSendSchedule}
        onCopyLink={d.handleCopyFieldAppLink}
        copied={d.sendScheduleCopied}
        isPending={d.sendScheduleMutation.isPending}
        channelEmail={d.sendChannelEmail}
        setChannelEmail={d.setSendChannelEmail}
        channelSms={d.sendChannelSms}
        setChannelSms={d.setSendChannelSms}
        lastResult={d.sendLastResult}
      />
      <BulkSendScheduleDialog
        open={d.bulkSendOpen}
        onOpenChange={d.setBulkSendOpen}
        resources={d.resources}
        resourceJobCount={d.resourceJobCountForCurrentPeriod}
        selectedResourceIds={d.bulkSelectedIds}
        setSelectedResourceIds={d.setBulkSelectedIds}
        channelEmail={d.bulkChannelEmail}
        setChannelEmail={d.setBulkChannelEmail}
        channelSms={d.bulkChannelSms}
        setChannelSms={d.setBulkChannelSms}
        onSend={d.handleBulkSendSchedule}
        isPending={d.bulkSending}
        results={d.bulkResults}
      />
      <ConflictDialog open={d.conflictDialogOpen} onOpenChange={(o) => { if (!o) { d.setConflictDialogOpen(false); d.setPendingSchedule(null); } }} pendingSchedule={d.pendingSchedule} workOrders={d.workOrders} onAccept={d.handleAcceptConflict} onCancel={() => { d.setConflictDialogOpen(false); d.setPendingSchedule(null); }} />
      <ClearDialog open={d.clearDialogOpen} onOpenChange={d.setClearDialogOpen} viewMode={d.viewMode} jobCount={d.currentViewScheduledJobs.length} onConfirm={d.handleClearAllScheduled} loading={d.clearLoading} />
      <AutoFillDialog open={d.autoFillDialogOpen} onOpenChange={d.setAutoFillDialogOpen} overbooking={d.autoFillOverbooking} setOverbooking={d.setAutoFillOverbooking} geoClustering={d.autoFillGeoClustering} setGeoClustering={d.setAutoFillGeoClustering} geoSpread={d.autoFillGeoSpread} loading={d.autoFillLoading} applying={d.autoFillApplying} preview={d.autoFillPreview} skipped={d.autoFillSkipped} diag={d.autoFillDiag} resources={d.resources} viewMode={d.viewMode} currentWeekStart={d.currentWeekStart} currentDate={d.currentDate} onPreview={d.handleAutoFillPreview} onApply={d.handleAutoFillApply} />
      <DepChainDialog open={d.depChainDialogOpen} onOpenChange={(o) => { if (!o) { d.setDepChainDialogOpen(false); } }} depChainJobId={d.depChainJobId} workOrders={d.workOrders} depChainData={d.depChainData} />
      <ConflictListDialog open={conflictListOpen} onOpenChange={setConflictListOpen} jobConflicts={d.jobConflicts} workOrders={d.workOrders} resources={d.resources} onNavigateToJob={handleNavigateToConflictJob} />
      <WhatIfPreview
        open={d.whatIfOpen}
        onOpenChange={d.setWhatIfOpen}
        result={d.whatIfResult}
        loading={d.whatIfLoading}
        jobTitle={d.whatIfPending?.jobTitle || ""}
        onConfirm={d.handleWhatIfConfirm}
        onCancel={d.handleWhatIfCancel}
      />
      <UrgentJobDialog open={urgentDialogOpen} onClose={() => setUrgentDialogOpen(false)} preselectedOrder={urgentPreselectedOrder} />
      <BulkScheduleDialog
        open={bulkScheduleOpen}
        onOpenChange={(o) => {
          setBulkScheduleOpen(o);
          if (!o) {
            setBulkPrefill(null);
            setBulkOverrideIds(null);
            clearAreaSelection();
          }
        }}
        workOrderIds={bulkOverrideIds ?? Array.from(areaSelectedIds)}
        jobs={extraDraggableJobs}
        resources={d.resources}
        teams={d.teamsData}
        onSuccess={clearAreaSelection}
        prefill={bulkPrefill}
      />
      <Sheet open={slaRiskOpen} onOpenChange={setSlaRiskOpen}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px] flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              SLA-tidigvarning
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 py-3 border-b bg-muted/30">
            <SlaRiskSummaryBadge />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Topp-25 jobb i risk för SLA-överträdelse, sorterade efter dagar till deadline.
            </p>
          </div>
          <div className="flex-1 overflow-hidden p-3">
            <SlaRiskJobsList
              riskLevel="warning,critical"
              limit={25}
              onSelectJob={(jobId) => {
                onSelectJob?.(jobId);
                d.handleJobClick(jobId);
                setSlaRiskOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </DndContext>
  );
}
