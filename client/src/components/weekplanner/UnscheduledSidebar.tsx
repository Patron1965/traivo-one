import { memo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Inbox, AlertTriangle, Clock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, MapPin, X, UserPlus, Key, DoorOpen, Filter, XCircle, Loader2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrderWithObject, Customer, Cluster } from "@shared/schema";
import { EXECUTION_CODE_LABELS, EXECUTION_CODE_ICONS } from "@shared/schema";
import { priorityDotColors, priorityLabels } from "./types";
import { DraggableJobCard } from "./DndComponents";

interface UnscheduledSidebarProps {
  showUnscheduled: boolean;
  setShowUnscheduled: (v: boolean) => void;
  unscheduledJobs: WorkOrderWithObject[];
  unscheduledTotal: number;
  accumulatedCount: number;
  hasMoreUnscheduled: boolean;
  loadMoreLoading: boolean;
  loadMoreUnscheduled: () => void;
  orderstockSearch: string;
  setOrderstockSearch: (v: string) => void;
  sidebarFiltersOpen: boolean;
  setSidebarFiltersOpen: (v: boolean) => void;
  sidebarActiveFilterCount: number;
  clearAllSidebarFilters: () => void;
  sidebarQuickStats: { urgentCount: number; highCount: number; overdueCount: number; totalHours: number };
  filterCustomer: string;
  setFilterCustomer: (v: string) => void;
  filterPriority: string;
  setFilterPriority: (v: string) => void;
  filterCluster: string;
  setFilterCluster: (v: string) => void;
  filterTeam: string;
  setFilterTeam: (v: string) => void;
  filterExecutionCode: string;
  setFilterExecutionCode: (v: string) => void;
  customers: Customer[];
  clusters: Cluster[];
  teamsData: Array<{ id: string; name: string; clusterId: string | null; color: string | null }>;
  customerMap: Map<string, Customer>;
  clusterMap: Map<string, Cluster>;
  selectedJob: string | null;
  onJobClick: (jobId: string) => void;
  onOpenAssignDialog: (job: WorkOrderWithObject, e: React.MouseEvent) => void;
  timewindowMap: Map<string, Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>;
}

export const UnscheduledSidebar = memo(function UnscheduledSidebar(props: UnscheduledSidebarProps) {
  const {
    showUnscheduled, setShowUnscheduled, unscheduledJobs, unscheduledTotal,
    accumulatedCount, hasMoreUnscheduled, loadMoreLoading, loadMoreUnscheduled,
    orderstockSearch, setOrderstockSearch, sidebarFiltersOpen, setSidebarFiltersOpen,
    sidebarActiveFilterCount, clearAllSidebarFilters, sidebarQuickStats,
    filterCustomer, setFilterCustomer, filterPriority, setFilterPriority,
    filterCluster, setFilterCluster, filterTeam, setFilterTeam,
    filterExecutionCode, setFilterExecutionCode,
    customers, clusters, teamsData, customerMap, clusterMap,
    selectedJob, onJobClick, onOpenAssignDialog, timewindowMap,
  } = props;

  return (
    <Collapsible open={showUnscheduled} onOpenChange={setShowUnscheduled} className="flex">
      <CollapsibleContent className="w-[280px] border-r bg-muted/20 flex flex-col">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Oschemalagda</span>
              <Badge variant="secondary" className="text-xs">{unscheduledJobs.length}{unscheduledTotal > accumulatedCount ? ` / ${unscheduledTotal}` : ""}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="sidebar-quick-stats">
            {sidebarQuickStats.urgentCount > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                {sidebarQuickStats.urgentCount} akut
              </Badge>
            )}
            {sidebarQuickStats.highCount > 0 && (
              <Badge className="text-[10px] h-5 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-orange-300">
                {sidebarQuickStats.highCount} hög
              </Badge>
            )}
            {sidebarQuickStats.overdueCount > 0 && (
              <Badge variant="outline" className="text-[10px] h-5 gap-1 text-red-600 border-red-300">
                <Clock className="h-2.5 w-2.5" />
                {sidebarQuickStats.overdueCount} försenade
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] h-5 font-normal">
              {sidebarQuickStats.totalHours}h totalt
            </Badge>
          </div>
          <Input
            placeholder="Sök jobb, objekt, kund..."
            value={orderstockSearch}
            onChange={(e) => setOrderstockSearch(e.target.value)}
            className="h-8 text-xs"
            data-testid="input-orderstock-search"
          />
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 flex-1"
              onClick={() => setSidebarFiltersOpen(!sidebarFiltersOpen)}
              data-testid="button-toggle-sidebar-filters"
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
              {sidebarActiveFilterCount > 0 && (
                <Badge variant="secondary" className="text-xs rounded-full">
                  {sidebarActiveFilterCount}
                </Badge>
              )}
              {sidebarFiltersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
            {sidebarActiveFilterCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={clearAllSidebarFilters} data-testid="button-clear-sidebar-filters">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Rensa alla filter</TooltipContent>
              </Tooltip>
            )}
          </div>
          {sidebarActiveFilterCount > 0 && (
            <div className="flex items-center gap-1 flex-wrap" data-testid="sidebar-active-filters">
              {filterCustomer !== "all" && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterCustomer("all")} data-testid="badge-sidebar-filter-customer">
                  {customers.find(c => c.id === filterCustomer)?.name || "Kund"}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {filterPriority !== "all" && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterPriority("all")} data-testid="badge-sidebar-filter-priority">
                  {priorityLabels[filterPriority] || filterPriority}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {filterCluster !== "all" && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterCluster("all")} data-testid="badge-sidebar-filter-cluster">
                  {filterCluster === "none" ? "Utan område" : clusters.find(c => c.id === filterCluster)?.name || "Område"}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {filterTeam !== "all" && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterTeam("all")} data-testid="badge-sidebar-filter-team">
                  {teamsData.find(t => t.id === filterTeam)?.name || "Team"}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
              {filterExecutionCode !== "all" && (
                <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterExecutionCode("all")} data-testid="badge-sidebar-filter-exec-code">
                  {EXECUTION_CODE_LABELS[filterExecutionCode] || filterExecutionCode}
                  <X className="h-2.5 w-2.5" />
                </Badge>
              )}
            </div>
          )}
          {sidebarFiltersOpen && (
            <div className="space-y-2 pt-1" data-testid="sidebar-filter-dropdowns">
              <Select value={filterCustomer} onValueChange={setFilterCustomer}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-customer">
                  <SelectValue placeholder="Alla kunder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla kunder</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-priority">
                  <SelectValue placeholder="Alla prioriteter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla prioriteter</SelectItem>
                  <SelectItem value="urgent">Akut</SelectItem>
                  <SelectItem value="high">Hög</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Låg</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCluster} onValueChange={setFilterCluster}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-cluster">
                  <SelectValue placeholder="Alla områden" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla områden</SelectItem>
                  <SelectItem value="none">Utan område</SelectItem>
                  {clusters.map((cluster) => (
                    <SelectItem key={cluster.id} value={cluster.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cluster.color || "#3B82F6" }} />
                        {cluster.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teamsData.length > 0 && (
                <Select value={filterTeam} onValueChange={setFilterTeam}>
                  <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-team">
                    <SelectValue placeholder="Alla team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alla team</SelectItem>
                    {teamsData.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color || "#3B82F6" }} />
                          {team.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={filterExecutionCode} onValueChange={setFilterExecutionCode}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-execution-code">
                  <SelectValue placeholder="Alla utförandekoder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla utförandekoder</SelectItem>
                  {Object.entries(EXECUTION_CODE_LABELS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>
                      <span className="flex items-center gap-1.5">
                        {EXECUTION_CODE_ICONS[code]} {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-2">
            {unscheduledJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Inga oschemalagda jobb
              </div>
            ) : (
              <>
              {unscheduledJobs.map((job) => {
                const customer = customerMap.get(job.customerId);
                const jobCluster = job.clusterId ? clusterMap.get(job.clusterId) : null;
                return (
                  <DraggableJobCard key={job.id} id={job.id}>
                    <Card
                      className={`p-3 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 touch-none ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${job.priority === "urgent" ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                      onClick={() => onJobClick(job.id)}
                      data-testid={`unscheduled-job-${job.id}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
                          <span className="text-sm font-medium">{job.title}</span>
                          {job.priority === "urgent" && (
                            <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{job.objectName || "Okänt objekt"}</div>
                        {customer && (
                          <div className="text-xs text-muted-foreground">{customer.name}</div>
                        )}
                        {jobCluster && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`unscheduled-job-cluster-${job.id}`}>
                            <MapPin className="h-2.5 w-2.5" />
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: jobCluster.color || "#3B82F6" }} />
                            {jobCluster.name}
                          </div>
                        )}
                        {(job.objectAccessCode || job.objectKeyNumber) && (
                          <div className="flex items-center gap-2 mt-1">
                            {job.objectAccessCode && (
                              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                                <DoorOpen className="h-2.5 w-2.5" />
                                {job.objectAccessCode}
                              </span>
                            )}
                            {job.objectKeyNumber && (
                              <span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                                <Key className="h-2.5 w-2.5" />
                                {job.objectKeyNumber}
                              </span>
                            )}
                          </div>
                        )}
                        {(() => {
                          const jobTws = timewindowMap.get(job.id);
                          if (jobTws && jobTws.length > 0) {
                            const twLabel = jobTws.map(tw => {
                              const parts: string[] = [];
                              if (tw.dayOfWeek) parts.push(tw.dayOfWeek.substring(0, 3));
                              if (tw.startTime && tw.endTime) parts.push(`${tw.startTime}–${tw.endTime}`);
                              return parts.join(" ");
                            }).join(", ");
                            return (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400" data-testid={`unscheduled-timewindow-${job.id}`}>
                                    <Clock className="h-2.5 w-2.5" />
                                    <span className="truncate">{twLabel}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-xs space-y-1">
                                    <p className="font-medium">Tillåtna tidsfönster</p>
                                    {jobTws.map((tw, i) => (
                                      <p key={i}>{tw.dayOfWeek || "Alla dagar"}{tw.startTime && tw.endTime ? ` ${tw.startTime}–${tw.endTime}` : ""}</p>
                                    ))}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            );
                          }
                          return null;
                        })()}
                        {job.plannedWindowEnd && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`unscheduled-deadline-${job.id}`}>
                            <Clock className="h-2.5 w-2.5" />
                            <span>Deadline: {format(new Date(job.plannedWindowEnd), "d MMM", { locale: sv })}</span>
                            {new Date(job.plannedWindowEnd) < new Date() && (
                              <Badge variant="destructive" className="text-[9px] h-4 ml-1">Försenad</Badge>
                            )}
                            {new Date(job.plannedWindowEnd) >= new Date() && new Date(job.plannedWindowEnd) < addDays(new Date(), 7) && (
                              <Badge className="text-[9px] h-4 ml-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300">Snart</Badge>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">
                            {priorityLabels[job.priority] || job.priority}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
                          </Badge>
                          {job.executionCode && (
                            <Badge variant="outline" className="text-[10px]" data-testid={`unscheduled-exec-code-${job.id}`}>
                              {EXECUTION_CODE_ICONS[job.executionCode] || "KOD"} {EXECUTION_CODE_LABELS[job.executionCode] || job.executionCode}
                            </Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="default"
                              className="w-full mt-1.5"
                              onClick={(e) => onOpenAssignDialog(job, e)}
                              data-testid={`button-assign-job-${job.id}`}
                            >
                              <UserPlus className="h-3.5 w-3.5 mr-1" />
                              Tilldela
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Tilldela resurs och datum</TooltipContent>
                        </Tooltip>
                      </div>
                    </Card>
                  </DraggableJobCard>
                );
              })}
              {hasMoreUnscheduled && (
                <div className="pt-2 pb-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={loadMoreUnscheduled}
                    disabled={loadMoreLoading}
                    data-testid="button-load-more-unscheduled"
                  >
                    {loadMoreLoading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Ladda fler ({accumulatedCount} av {unscheduledTotal})
                  </Button>
                </div>
              )}
              </>
            )}
          </div>
        </ScrollArea>
      </CollapsibleContent>
      <Tooltip>
        <TooltipTrigger asChild>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="h-full rounded-none border-r w-6" data-testid="button-toggle-unscheduled">
              {showUnscheduled ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{showUnscheduled ? "Dölj oplanerade" : "Visa oplanerade"}</p>
        </TooltipContent>
      </Tooltip>
    </Collapsible>
  );
});
