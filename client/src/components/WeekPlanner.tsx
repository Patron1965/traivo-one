import { useCallback, useEffect, useMemo, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Loader2, ShieldAlert, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlaRiskJobsList, SlaRiskSummaryBadge } from "@/components/SlaRiskPanel";
import { format, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import type { WeekPlannerProps, PlannerDisplayMode } from "./weekplanner/types";
import { zoomLevels } from "./weekplanner/types";
import { DroppableCell, DraggableJobCard } from "./weekplanner/DndComponents";
import { JobCard, DragOverlayContent } from "./weekplanner/JobCard";
import { UnscheduledSidebar } from "./weekplanner/UnscheduledSidebar";
import { AssignDialog, SendScheduleDialog, BulkSendScheduleDialog, ConflictDialog, ClearDialog, AutoFillDialog, DepChainDialog, ConflictListDialog } from "./weekplanner/PlannerDialogs";
import { PlannerToolbar, PlannerFooter } from "./weekplanner/PlannerToolbar";
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
import { usePlannerSync, openPlannerPopout, type AssignSlot, type PopoutView, type SyncedState } from "./weekplanner/usePlannerSync";
import type { WorkOrderWithObject } from "@shared/schema";

export function WeekPlanner({ onAddJob, onSelectJob, onSelectedJobIdsChange, showAIPanel, onToggleAIPanel, displayMode = "full", popoutRole = "main" }: WeekPlannerProps) {
  const d = usePlannerData();
  const zoom = zoomLevels[d.zoomLevel];
  const [urgentDialogOpen, setUrgentDialogOpen] = useState(false);
  const [conflictListOpen, setConflictListOpen] = useState(false);
  const [slaRiskOpen, setSlaRiskOpen] = useState(false);
  const [urgentPreselectedOrder, setUrgentPreselectedOrder] = useState<WorkOrderWithObject | null>(null);
  const [poppedOutViews, setPoppedOutViews] = useState<Set<PopoutView>>(new Set());
  const [crossWindowSlot, setCrossWindowSlot] = useState<AssignSlot | null>(null);
  const [remoteSelectedSlot, setRemoteSelectedSlot] = useState<AssignSlot | null>(null);

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

  usePlannerSync({
    role: popoutRole,
    state: syncedState,
    applyRemoteState,
    onPopoutsChange: setPoppedOutViews,
    selectedSlot: crossWindowSlot,
    onRemoteSlotChange: setRemoteSelectedSlot,
  });

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

  const dnd = usePlannerDnd({
    workOrders: d.workOrders,
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

  return (
    <DndContext sensors={dnd.sensors} collisionDetection={dnd.collisionDetection} onDragStart={dnd.handleDragStart} onDragOver={dnd.handleDragOver} onDragEnd={dnd.handleDragEnd}>
      <div className="flex h-full">
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
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 animate-in fade-in slide-in-from-top-1 duration-200" data-testid="drag-no-cluster-match-warning">
              <AlertTriangle className="h-4 w-4 text-orange-500 dark:text-orange-400 shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-300">
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

        {effectiveDisplayMode === "neither" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground p-6 text-center">
            <p>Båda vyer är öppna i andra fönster.</p>
            <p className="text-xs">Stäng ett pop-out-fönster för att visa innehållet här igen.</p>
          </div>
        )}

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

      <AssignDialog open={d.assignDialogOpen} onOpenChange={d.setAssignDialogOpen} jobToAssign={d.jobToAssign} assignDate={d.assignDate} setAssignDate={d.setAssignDate} assignResourceId={d.assignResourceId} setAssignResourceId={d.setAssignResourceId} resources={d.resources} onConfirm={d.handleQuickAssign} isPending={d.updateWorkOrderMutation.isPending} />
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
      <Sheet open={slaRiskOpen} onOpenChange={setSlaRiskOpen}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px] flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-red-500" />
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
