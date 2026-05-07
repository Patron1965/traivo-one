import { memo, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Inbox, AlertTriangle, Clock, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, MapPin, X, UserPlus, Key, DoorOpen, Filter, XCircle, Loader2, Sparkles, CheckCircle2, CalendarRange, Info, Calendar as CalendarIcon, Target } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format, addDays, startOfWeek, getISOWeek } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrderWithObject, Customer, Cluster } from "@shared/schema";
import { EXECUTION_CODE_LABELS, EXECUTION_CODE_ICONS } from "@shared/schema";
import { priorityDotColors, priorityLabels } from "./types";
import type { AssignSlot } from "./usePlannerSync";
import { DraggableJobCard } from "./DndComponents";
import { JobCardExpandPanel } from "./JobCardExpandPanel";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const EXPANDED_STORAGE_KEY = "traivo:orderlager:expanded";

function readExpandedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function writeExpandedSet(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore quota errors
  }
}

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
  filterDateField: "none" | "desired" | "created" | "sla";
  setFilterDateField: (v: "none" | "desired" | "created" | "sla") => void;
  filterDatePeriod: "all" | "week" | "two_weeks" | "month" | "custom";
  setFilterDatePeriod: (v: "all" | "week" | "two_weeks" | "month" | "custom") => void;
  filterDateCustomFrom: string;
  setFilterDateCustomFrom: (v: string) => void;
  filterDateCustomTo: string;
  setFilterDateCustomTo: (v: string) => void;
  dateFilterActive: boolean;
  unscheduledMissingDateCount: number;
  missingDateExpanded: boolean;
  setMissingDateExpanded: (v: boolean) => void;
  missingDateJobs: WorkOrderWithObject[];
  missingDateLoading: boolean;
  customers: Customer[];
  clusters: Cluster[];
  teamsData: Array<{ id: string; name: string; clusterId: string | null; color: string | null }>;
  customerMap: Map<string, Customer>;
  clusterMap: Map<string, Cluster>;
  selectedJob: string | null;
  onJobClick: (jobId: string) => void;
  onOpenAssignDialog: (job: WorkOrderWithObject, e: React.MouseEvent) => void;
  timewindowMap: Map<string, Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>;
  currentWeekStart?: Date;
  activeDragJob?: WorkOrderWithObject | null;
  clusterMatchedResourceIds?: Set<string>;
  visibleResources?: Array<{ serviceArea?: string[] | null }>;
  expanded?: boolean;
  remoteSlot?: AssignSlot | null;
  onCrossWindowAssign?: (job: WorkOrderWithObject) => void;
  selectedJobIds?: Set<string>;
}

function SuggestPlacementButton({ job, currentWeekStart, className, compact }: { job: WorkOrderWithObject; currentWeekStart?: Date; className?: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ resourceId: string; resourceName: string; date: string; startTime: string; score: number; reasons: string[] }> | null>(null);
  const { toast } = useToast();

  const handleSuggest = useCallback(async () => {
    setLoading(true);
    setSuggestions(null);
    try {
      const weekStart = format(currentWeekStart || startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
      const res = await apiRequest("POST", "/api/ai/suggest-placement", {
        workOrderId: job.id,
        weekStart,
      });
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch {
      toast({ title: "Kunde inte hämta förslag", description: "Försök igen senare" });
    } finally {
      setLoading(false);
    }
  }, [job.id, toast, currentWeekStart]);

  const triggerButton = compact ? (
    <Button
      size="icon"
      variant="outline"
      className={className ?? "h-7 w-7 p-0 shrink-0"}
      onClick={handleSuggest}
      data-testid={`button-suggest-placement-${job.id}`}
      aria-label="Föreslå optimal tid"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className={className ?? "w-full mt-1"}
      onClick={handleSuggest}
      data-testid={`button-suggest-placement-${job.id}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 shrink-0 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1 shrink-0" />}
      <span className="truncate">Föreslå optimal tid</span>
    </Button>
  );

  return (
    <Popover>
      {compact ? (
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent>Föreslå optimal tid</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      )}
      <PopoverContent className="w-72 p-3" side="right" align="start">
        <div className="space-y-2">
          <p className="text-sm font-medium">AI-förslag för placering</p>
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {suggestions && suggestions.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">Inga lämpliga platser hittades denna vecka.</p>
          )}
          {suggestions && suggestions.map((s, i) => (
            <div key={i} className={`p-2 rounded-md border text-xs space-y-1 ${i === 0 ? "border-chart-2/30 bg-chart-2/10 dark:bg-chart-2/15 dark:border-chart-2/80" : "border-border"}`} data-testid={`suggestion-${job.id}-${i}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.resourceName}</span>
                {i === 0 && <Badge className="text-[9px] h-4 bg-chart-2/15 text-chart-2 dark:bg-chart-2/15">Bäst</Badge>}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{format(new Date(s.date + "T12:00:00Z"), "EEE d MMM", { locale: sv })} kl {s.startTime}</span>
              </div>
              <div className="space-y-0.5">
                {s.reasons.map((r, ri) => (
                  <div key={ri} className="flex items-start gap-1 text-[10px] text-muted-foreground">
                    <CheckCircle2 className="h-2.5 w-2.5 mt-0.5 text-chart-2 shrink-0" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
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
    filterDateField, setFilterDateField, filterDatePeriod, setFilterDatePeriod,
    filterDateCustomFrom, setFilterDateCustomFrom, filterDateCustomTo, setFilterDateCustomTo, dateFilterActive,
    unscheduledMissingDateCount,
    missingDateExpanded, setMissingDateExpanded, missingDateJobs, missingDateLoading,
    customers, clusters, teamsData, customerMap, clusterMap,
    selectedJob, onJobClick, onOpenAssignDialog, timewindowMap, currentWeekStart,
    activeDragJob, clusterMatchedResourceIds, visibleResources,
    expanded = false, remoteSlot = null, onCrossWindowAssign,
    selectedJobIds,
  } = props;
  const bulkJobIds = selectedJobIds && selectedJobIds.size > 1 ? Array.from(selectedJobIds) : undefined;

  const showDragNoMatch = !!(activeDragJob && activeDragJob.clusterId &&
    clusterMatchedResourceIds && clusterMatchedResourceIds.size === 0 &&
    visibleResources?.some(r => r.serviceArea && r.serviceArea.length > 0));

  const widthClass = expanded ? "w-full flex-1" : "w-[280px] border-r";

  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(() => readExpandedSet());
  const toggleJobExpanded = useCallback((jobId: string) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      writeExpandedSet(next);
      return next;
    });
  }, []);

  return (
    <Collapsible open={expanded ? true : showUnscheduled} onOpenChange={expanded ? () => {} : setShowUnscheduled} className={`flex min-w-0 ${expanded ? "flex-1" : ""}`}>
      <CollapsibleContent className={`${widthClass} bg-muted/20 flex flex-col min-w-0`}>
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Oschemalagda</span>
              <Badge variant="secondary" className="text-xs">{unscheduledJobs.length}{unscheduledTotal > accumulatedCount ? ` / ${unscheduledTotal}` : ""}</Badge>
            </div>
          </div>
          {showDragNoMatch && (
            <div className="flex items-center gap-1.5 p-2 rounded-md bg-warning/10 dark:bg-warning/15 border border-warning/20 dark:border-warning/80" data-testid="sidebar-no-cluster-match-warning">
              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
              <span className="text-[10px] text-warning">Ingen resurs matchar klustret</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="sidebar-quick-stats">
            {sidebarQuickStats.urgentCount > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 gap-1">
                <AlertTriangle className="h-2.5 w-2.5 text-warning" />
                {sidebarQuickStats.urgentCount} akut
              </Badge>
            )}
            {sidebarQuickStats.highCount > 0 && (
              <Badge className="text-[10px] h-5 bg-warning/15 text-warning dark:bg-warning/15 border-warning/30">
                {sidebarQuickStats.highCount} hög
              </Badge>
            )}
            {sidebarQuickStats.overdueCount > 0 && (
              <Badge variant="outline" className="text-[10px] h-5 gap-1 text-destructive border-destructive/30">
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
              {dateFilterActive && (() => {
                const fieldLabel = filterDateField === "desired" ? "Önskat datum" : filterDateField === "sla" ? "SLA-deadline" : "Skapad";
                let periodLabel: string;
                if (filterDatePeriod === "custom") {
                  if (filterDateCustomFrom && filterDateCustomTo) periodLabel = `${filterDateCustomFrom} → ${filterDateCustomTo}`;
                  else if (filterDateCustomFrom) periodLabel = `från ${filterDateCustomFrom}`;
                  else if (filterDateCustomTo) periodLabel = `till ${filterDateCustomTo}`;
                  else periodLabel = "anpassad";
                } else if (filterDatePeriod === "week") {
                  periodLabel = `vecka ${getISOWeek(currentWeekStart || new Date())}`;
                } else if (filterDatePeriod === "two_weeks") {
                  periodLabel = "kommande 2 veckor";
                } else {
                  periodLabel = "kommande 30 dagar";
                }
                return (
                  <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => { setFilterDateField("none"); setFilterDatePeriod("all"); setFilterDateCustomFrom(""); setFilterDateCustomTo(""); }} data-testid="badge-sidebar-filter-date">
                    <CalendarRange className="h-2.5 w-2.5" />
                    {fieldLabel}: {periodLabel}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                );
              })()}
            </div>
          )}
          {dateFilterActive && (filterDateField === "desired" || filterDateField === "sla") && unscheduledMissingDateCount > 0 && (
            <Collapsible open={missingDateExpanded} onOpenChange={setMissingDateExpanded}>
              <div className="rounded-md bg-chart-1/10 dark:bg-chart-1/15 border border-chart-1/20 dark:border-chart-1/80" data-testid="sidebar-missing-date-info">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-start gap-1.5 p-2 text-left hover-elevate active-elevate-2 rounded-md"
                    data-testid="button-toggle-missing-date"
                  >
                    <Info className="h-3.5 w-3.5 text-chart-1 shrink-0 mt-0.5" />
                    <span className="text-[10px] text-chart-1 leading-tight flex-1">
                      {filterDateField === "desired"
                        ? `${unscheduledMissingDateCount} ordrar saknar önskat datum och visas inte i listan ovan.`
                        : `${unscheduledMissingDateCount} ordrar saknar SLA-deadline och visas inte i listan ovan.`}
                      <span className="block mt-0.5 font-medium">
                        {missingDateExpanded ? "Dölj listan" : "Visa lista för att komplettera datum"}
                      </span>
                    </span>
                    {missingDateExpanded
                      ? <ChevronUp className="h-3.5 w-3.5 text-chart-1 shrink-0 mt-0.5" />
                      : <ChevronDown className="h-3.5 w-3.5 text-chart-1 shrink-0 mt-0.5" />}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-2 pb-2 space-y-1.5" data-testid="sidebar-missing-date-list">
                    {missingDateLoading && (
                      <div className="flex items-center justify-center py-3">
                        <Loader2 className="h-4 w-4 animate-spin text-chart-1" />
                      </div>
                    )}
                    {!missingDateLoading && missingDateJobs.length === 0 && (
                      <p className="text-[10px] text-chart-1 py-2">Inga ordrar att visa.</p>
                    )}
                    {!missingDateLoading && unscheduledMissingDateCount > missingDateJobs.length && missingDateJobs.length > 0 && (
                      <p className="text-[10px] text-chart-1 italic" data-testid="text-missing-date-cap-info">
                        Visar de första {missingDateJobs.length} av {unscheduledMissingDateCount}. Använd sökfältet för att filtrera vidare.
                      </p>
                    )}
                    {!missingDateLoading && missingDateJobs.map((job) => {
                      const customer = customerMap.get(job.customerId);
                      const hasRealCustomer = customer && /[\p{L}\p{N}]/u.test(customer.name);
                      const customerLabel = hasRealCustomer ? customer!.name : "Okänd kund";
                      const addressLabel = job.objectName || "Okänt objekt";
                      const titleLabel = (job.title || "").trim();
                      const showTitle = !!titleLabel && titleLabel !== customerLabel && titleLabel !== addressLabel;
                      return (
                        <DraggableJobCard key={job.id} id={job.id}>
                          <Card
                            className="p-2 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 touch-none bg-white dark:bg-card"
                            onClick={() => onJobClick(job.id)}
                            data-testid={`missing-date-job-${job.id}`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
                                <span
                                  className={`text-xs font-medium truncate ${hasRealCustomer ? "" : "italic text-muted-foreground"}`}
                                  title={customerLabel}
                                >
                                  {customerLabel}
                                </span>
                              </div>
                              {showTitle && (
                                <div
                                  className="text-[10px] font-medium text-foreground/90 truncate"
                                  title={titleLabel}
                                  data-testid={`missing-date-job-title-${job.id}`}
                                >
                                  {titleLabel}
                                </div>
                              )}
                              <div className="text-[10px] text-muted-foreground truncate" title={addressLabel}>{addressLabel}</div>
                              <Button
                                size="sm"
                                variant="default"
                                className="w-full mt-1 h-6 text-[10px]"
                                onClick={(e) => onOpenAssignDialog(job, e)}
                                data-testid={`button-assign-missing-date-${job.id}`}
                              >
                                <CalendarIcon className="h-3 w-3 mr-1" />
                                Lägg till datum
                              </Button>
                            </div>
                          </Card>
                        </DraggableJobCard>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
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
              <div className="space-y-1.5 pt-1 border-t" data-testid="sidebar-date-filter-section">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide pt-1">
                  <CalendarRange className="h-3 w-3" />
                  Datumfilter
                </div>
                <Select value={filterDateField} onValueChange={(v) => {
                  const next = v as "none" | "desired" | "created" | "sla";
                  setFilterDateField(next);
                  if (next === "none") { setFilterDatePeriod("all"); setFilterDateCustomFrom(""); setFilterDateCustomTo(""); }
                }}>
                  <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-date-field">
                    <SelectValue placeholder="Inget datumfilter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Inget datumfilter</SelectItem>
                    <SelectItem value="desired">Önskat datum</SelectItem>
                    <SelectItem value="sla">SLA-deadline</SelectItem>
                    <SelectItem value="created">Skapad</SelectItem>
                  </SelectContent>
                </Select>
                {filterDateField !== "none" && (
                  <Select value={filterDatePeriod} onValueChange={(v) => setFilterDatePeriod(v as "all" | "week" | "two_weeks" | "month" | "custom")}>
                    <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-date-period">
                      <SelectValue placeholder="Period" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All tid</SelectItem>
                      <SelectItem value="week">Vald vecka</SelectItem>
                      <SelectItem value="two_weeks">Kommande 2 veckor</SelectItem>
                      <SelectItem value="month">Kommande 30 dagar</SelectItem>
                      <SelectItem value="custom">Anpassad</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {filterDateField !== "none" && filterDatePeriod === "custom" && (
                  <div className="flex items-center gap-1.5">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs flex-1 justify-start font-normal"
                          data-testid="button-unscheduled-date-from"
                        >
                          <CalendarIcon className="h-3 w-3 mr-1.5 shrink-0" />
                          {filterDateCustomFrom || <span className="text-muted-foreground">Från</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={filterDateCustomFrom ? new Date(filterDateCustomFrom + "T00:00:00") : undefined}
                          onSelect={(d) => setFilterDateCustomFrom(d ? format(d, "yyyy-MM-dd") : "")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <span className="text-xs text-muted-foreground">→</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs flex-1 justify-start font-normal"
                          data-testid="button-unscheduled-date-to"
                        >
                          <CalendarIcon className="h-3 w-3 mr-1.5 shrink-0" />
                          {filterDateCustomTo || <span className="text-muted-foreground">Till</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={filterDateCustomTo ? new Date(filterDateCustomTo + "T00:00:00") : undefined}
                          onSelect={(d) => setFilterDateCustomTo(d ? format(d, "yyyy-MM-dd") : "")}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <div className="space-y-1.5">
            {unscheduledJobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Inga oschemalagda jobb
              </div>
            ) : (
              <>
              {unscheduledJobs.map((job) => {
                const customer = customerMap.get(job.customerId);
                const jobCluster = job.clusterId ? clusterMap.get(job.clusterId) : null;
                const hasRealCustomer = customer && /[\p{L}\p{N}]/u.test(customer.name);
                const customerLabel = hasRealCustomer ? customer!.name : "Okänd kund";
                const addressLabel = job.objectName || "Okänt objekt";
                const titleLabel = (job.title || "").trim();
                const showTitle = !!titleLabel && titleLabel !== customerLabel && titleLabel !== addressLabel;
                return (
                  <DraggableJobCard key={job.id} id={job.id}>
                    <Card
                      className={`p-2 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 touch-none ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${job.priority === "urgent" ? "bg-destructive/10 dark:bg-destructive/15" : ""}`}
                      onClick={() => onJobClick(job.id)}
                      data-testid={`unscheduled-job-${job.id}`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
                          <span
                            className={`text-[13px] font-semibold truncate ${hasRealCustomer ? "" : "italic text-muted-foreground"}`}
                            title={customerLabel}
                            data-testid={`unscheduled-job-customer-${job.id}`}
                          >
                            {customerLabel}
                          </span>
                          {job.priority === "urgent" && (
                            <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                          )}
                          <span className="ml-auto flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                              {priorityLabels[job.priority] || job.priority}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                              {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
                            </Badge>
                          </span>
                        </div>
                        {showTitle && (
                          <div
                            className="text-xs text-foreground/90 truncate pl-3.5"
                            title={titleLabel}
                            data-testid={`unscheduled-job-title-${job.id}`}
                          >
                            {titleLabel}
                          </div>
                        )}
                        <div className="text-[11px] text-muted-foreground truncate pl-3.5" title={addressLabel} data-testid={`unscheduled-job-address-${job.id}`}>{addressLabel}</div>
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
                              <span className="flex items-center gap-0.5 text-[10px] text-warning">
                                <DoorOpen className="h-2.5 w-2.5" />
                                {job.objectAccessCode}
                              </span>
                            )}
                            {job.objectKeyNumber && (
                              <span className="flex items-center gap-0.5 text-[10px] text-chart-1">
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
                                  <div className="flex items-center gap-1 text-[10px] text-chart-1" data-testid={`unscheduled-timewindow-${job.id}`}>
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
                              <Badge className="text-[9px] h-4 ml-1 bg-warning/15 text-warning dark:bg-warning/15 border-warning/30">Snart</Badge>
                            )}
                          </div>
                        )}
                        {job.executionCode && (
                          <div className="pl-3.5">
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5" data-testid={`unscheduled-exec-code-${job.id}`}>
                              {EXECUTION_CODE_ICONS[job.executionCode] || "KOD"} {EXECUTION_CODE_LABELS[job.executionCode] || job.executionCode}
                            </Badge>
                          </div>
                        )}
                        {expandedJobs.has(job.id) && (
                          <JobCardExpandPanel jobId={job.id} enabled={true} onHistoryClick={onJobClick} bulkJobIds={bulkJobIds} />
                        )}
                        {remoteSlot && onCrossWindowAssign && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full mt-1.5 h-6 text-[11px] px-2 gap-1 border-chart-1/30 bg-chart-1/10 hover:bg-chart-1/15 text-chart-1 dark:bg-chart-1/15 dark:border-chart-1/80 dark:hover:bg-chart-1/15"
                                onClick={(e) => { e.stopPropagation(); onCrossWindowAssign(job); }}
                                data-testid={`button-cross-window-assign-${job.id}`}
                              >
                                <Target className="h-3 w-3 shrink-0" />
                                <span className="truncate">Tilldela {remoteSlot.resourceName} · {format(new Date(remoteSlot.date + "T12:00:00"), "d MMM", { locale: sv })}{remoteSlot.startTime ? ` ${remoteSlot.startTime}` : ""}</span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Tilldela till vald slot från andra fönstret</TooltipContent>
                          </Tooltip>
                        )}
                        <div className="flex items-center gap-1.5 mt-1.5 w-full min-w-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleJobExpanded(job.id); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-[11px] font-medium text-foreground/80 hover:text-foreground transition-colors px-2 py-1 rounded-md border border-border bg-background hover-elevate shrink-0"
                            data-testid={`button-expand-job-${job.id}`}
                            aria-expanded={expandedJobs.has(job.id)}
                            title={expandedJobs.has(job.id) ? "Dölj jobbinfo" : "Visa jobbinfo"}
                          >
                            {expandedJobs.has(job.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            <span>{expandedJobs.has(job.id) ? "Dölj" : "Mer info"}</span>
                          </button>
                          <div className="ml-auto flex items-center gap-1.5">
                            <SuggestPlacementButton job={job} currentWeekStart={currentWeekStart} compact />
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs px-3 bg-chart-2 hover:bg-chart-2/90 text-white border border-chart-2/70 dark:bg-chart-2 dark:hover:bg-chart-2/90 dark:text-white dark:border-chart-2/50"
                                  onClick={(e) => onOpenAssignDialog(job, e)}
                                  data-testid={`button-assign-job-${job.id}`}
                                >
                                  <UserPlus className="h-3.5 w-3.5 mr-1 shrink-0" />
                                  Tilldela
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Tilldela resurs och datum</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
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
        </div>
      </CollapsibleContent>
      {!expanded && (
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
      )}
    </Collapsible>
  );
});
