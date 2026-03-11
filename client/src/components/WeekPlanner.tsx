import { useCallback, useMemo } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, User } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import type { WeekPlannerProps } from "./weekplanner/types";
import { zoomLevels } from "./weekplanner/types";
import { DroppableCell } from "./weekplanner/DndComponents";
import { JobCard, DragOverlayContent } from "./weekplanner/JobCard";
import { UnscheduledSidebar } from "./weekplanner/UnscheduledSidebar";
import { AssignDialog, SendScheduleDialog, ConflictDialog, ClearDialog, AutoFillDialog, DepChainDialog } from "./weekplanner/PlannerDialogs";
import { PlannerToolbar, PlannerFooter } from "./weekplanner/PlannerToolbar";
import { DayTimelineView } from "./weekplanner/DayTimelineView";
import { WeekGridView } from "./weekplanner/WeekGridView";
import { MonthView } from "./weekplanner/MonthView";
import { RouteMapView } from "./weekplanner/RouteMapView";
import { usePlannerData } from "./weekplanner/usePlannerData";
import { usePlannerDnd } from "./weekplanner/usePlannerDnd";

export function WeekPlanner({ onAddJob, onSelectJob, showAIPanel, onToggleAIPanel }: WeekPlannerProps) {
  const d = usePlannerData();
  const zoom = zoomLevels[d.zoomLevel];

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
    setPendingSchedule: d.setPendingSchedule,
    setConflictDialogOpen: d.setConflictDialogOpen,
    executeSchedule: d.executeSchedule,
    toast: d.toast,
  });

  const handleJobClickWithCallback = useCallback((jobId: string) => {
    d.handleJobClick(jobId);
    onSelectJob?.(jobId);
  }, [d.handleJobClick, onSelectJob]);

  const isLoading = d.resourcesLoading || d.workOrdersLoading;
  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

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
  }), [d.selectedJob, d.jobConflicts, d.dependenciesData, d.timewindowMap, d.expandedSubSteps, handleJobClickWithCallback, d.handleUnschedule, d.handleToggleSubStep, d.handleOpenDepChain]);

  return (
    <DndContext sensors={dnd.sensors} collisionDetection={dnd.collisionDetection} onDragStart={dnd.handleDragStart} onDragEnd={dnd.handleDragEnd}>
      <div className="flex h-full">
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
          customers={d.customers} clusters={d.clusters} teamsData={d.teamsData}
          customerMap={d.customerMap} clusterMap={d.clusterMap}
          selectedJob={d.selectedJob} onJobClick={handleJobClickWithCallback} onOpenAssignDialog={d.handleOpenAssignDialog}
          timewindowMap={d.timewindowMap}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <PlannerToolbar
            viewMode={d.viewMode} headerLabel={d.getHeaderLabel()}
            onNavigate={d.navigate} onGoToday={d.goToToday} onViewModeChange={d.handleViewModeChange}
            undoCount={d.undoStack.length} redoCount={d.redoStack.length} onUndo={d.handleUndo} onRedo={d.handleRedo}
            zoomLevel={d.zoomLevel} setZoomLevel={d.setZoomLevel}
            resources={d.resources} visibleResources={d.visibleResources}
            hiddenResourceIds={d.hiddenResourceIds} setHiddenResourceIds={d.setHiddenResourceIds}
            onAddJob={onAddJob} onAutoFill={() => { d.setAutoFillDialogOpen(true); }}
            onClearAll={() => d.setClearDialogOpen(true)}
            showAIPanel={showAIPanel} onToggleAIPanel={onToggleAIPanel}
            weekGoals={d.weekGoals} weekTravelTotal={d.weekTravelTotal}
            visibleDates={d.visibleDates} getResourceDayHours={d.getResourceDayHours}
            jobConflictCount={Object.keys(d.jobConflicts).length}
            filteredScheduledCount={d.filteredScheduledJobs.length}
            unscheduledCount={d.unscheduledJobs.length}
          />

          {d.viewMode === "day" && (
            <DayTimelineView
              currentDate={d.currentDate} visibleResources={d.visibleResources}
              timeRestrictions={d.timeRestrictions}
              getJobsForResourceAndDay={d.getJobsForResourceAndDay}
              getResourceDayHours={d.getResourceDayHours} getCapacityPercentage={d.getCapacityPercentage}
              getDropFitClass={d.getDropFitClass} activeDragJob={d.activeDragJob}
              travelTimesForDay={d.travelTimesForDay} zoom={zoom}
              jobCardProps={jobCardProps}
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
          />
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
                          <DroppableCell id={droppableId} className="min-h-[80px] border border-dashed rounded-md p-2 transition-colors">
                            <div data-testid={`panel-drop-zone-${dayKey}`}>
                              {dayJobs.length === 0 ? (
                                <div className="text-xs text-muted-foreground text-center py-4">Dra jobb hit för att schemalägga</div>
                              ) : (
                                <div className="space-y-2">{dayJobs.map(job => <JobCard key={job.id} job={job} {...jobCardProps} />)}</div>
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
      <SendScheduleDialog open={d.sendScheduleDialogOpen} onOpenChange={d.setSendScheduleDialogOpen} resource={d.sendScheduleResource} onSendEmail={d.handleSendScheduleEmail} onCopyLink={d.handleCopyFieldAppLink} copied={d.sendScheduleCopied} isPending={d.sendScheduleMutation.isPending} />
      <ConflictDialog open={d.conflictDialogOpen} onOpenChange={(o) => { if (!o) { d.setConflictDialogOpen(false); d.setPendingSchedule(null); } }} pendingSchedule={d.pendingSchedule} workOrders={d.workOrders} onAccept={d.handleAcceptConflict} onCancel={() => { d.setConflictDialogOpen(false); d.setPendingSchedule(null); }} />
      <ClearDialog open={d.clearDialogOpen} onOpenChange={d.setClearDialogOpen} viewMode={d.viewMode} jobCount={d.currentViewScheduledJobs.length} onConfirm={d.handleClearAllScheduled} loading={d.clearLoading} />
      <AutoFillDialog open={d.autoFillDialogOpen} onOpenChange={d.setAutoFillDialogOpen} overbooking={d.autoFillOverbooking} setOverbooking={d.setAutoFillOverbooking} loading={d.autoFillLoading} applying={d.autoFillApplying} preview={d.autoFillPreview} skipped={d.autoFillSkipped} diag={d.autoFillDiag} resources={d.resources} viewMode={d.viewMode} currentWeekStart={d.currentWeekStart} currentDate={d.currentDate} onPreview={d.handleAutoFillPreview} onApply={d.handleAutoFillApply} />
      <DepChainDialog open={d.depChainDialogOpen} onOpenChange={(o) => { if (!o) { d.setDepChainDialogOpen(false); } }} depChainJobId={d.depChainJobId} workOrders={d.workOrders} depChainData={d.depChainData} />
    </DndContext>
  );
}
