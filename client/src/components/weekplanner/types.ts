import type { Resource, WorkOrderWithObject, Customer, TaskDependency, ObjectTimeRestriction } from "@shared/schema";
import { haversineDistanceKm } from "@/lib/geo";

export interface WeatherImpactDay {
  date: string;
  impactLevel: "none" | "low" | "medium" | "high" | "severe";
  capacityMultiplier: number;
  reason: string;
}

export interface WeatherForecastData {
  forecasts: Array<{ date: string; temperature: number; precipitation: number; windSpeed: number; weatherCode: number; weatherDescription: string }>;
  impacts: WeatherImpactDay[];
}

export interface PlannerActionState {
  resourceId: string | null;
  teamId: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  orderStatus: string;
  roughPlannedWeek?: string | null;
}

export interface PlannerAction {
  type: "schedule" | "unschedule" | "team-assign" | "push-to-rough";
  jobId: string;
  previousState: PlannerActionState;
  newState: PlannerActionState;
}

export type PlannerDisplayMode = "full" | "calendar-only" | "orderlager-only";
export type PlannerEffectiveDisplayMode = PlannerDisplayMode | "neither";

export interface WeekPlannerProps {
  onAddJob?: () => void;
  onSelectJob?: (jobId: string) => void;
  onSelectedJobIdsChange?: (ids: Set<string>) => void;
  showAIPanel?: boolean;
  onToggleAIPanel?: () => void;
  displayMode?: PlannerDisplayMode;
  popoutRole?: "main" | "popout-calendar" | "popout-orderlager";
}

export type ViewMode = "day" | "week" | "month" | "quarter" | "year" | "route";

export type TimeBlockCategory = "production" | "travel" | "break" | "free";

export interface AutoFillAssignment {
  workOrderId: string;
  resourceId: string;
  scheduledDate: string;
  scheduledStartTime: string;
  title: string;
  address: string;
  estimatedDuration: number;
  priority: string;
}

export interface AutoFillDiag {
  totalUnscheduled: number;
  capacityPerDay: Record<string, number>;
  maxMinutesPerDay: number;
  resourceCount: number;
}

export interface PendingSchedule {
  jobId: string;
  resourceId: string;
  scheduledDate: string;
  scheduledStartTime?: string;
  conflicts: string[];
}

export { priorityDotColors, priorityBadgeClasses, priorityLabels } from "@/lib/status-colors";

export const statusBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  scheduled: "default",
  draft: "outline",
  in_progress: "secondary",
};

export const executionStatusLabels: Record<string, string> = {
  not_planned: "Ej planerad",
  planned_rough: "Grovplanerad",
  planned_fine: "Finplanerad",
  on_way: "På väg",
  on_site: "På plats",
  completed: "Utförd",
  inspected: "Kontrollerad",
  invoiced: "Fakturerad",
};

export const executionStatusColors: Record<string, string> = {
  not_planned: "bg-muted-foreground/60",
  planned_rough: "bg-chart-3/15",
  planned_fine: "bg-chart-1/15",
  on_way: "bg-chart-5/15",
  on_site: "bg-chart-2/15",
  completed: "bg-chart-2/15",
  inspected: "bg-chart-1/15",
  invoiced: "bg-chart-2/15",
};

export const executionStatusOrder = [
  "not_planned", "planned_rough", "planned_fine", "on_way",
  "on_site", "completed", "inspected", "invoiced",
];

export const HOURS_IN_DAY = 8;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 17;

export const timeBlockColors: Record<TimeBlockCategory, string> = {
  production: "bg-chart-2/15 dark:bg-chart-2/15",
  travel: "bg-chart-3/15 dark:bg-chart-3/15",
  break: "bg-chart-1/15 dark:bg-chart-1/15",
  free: "bg-muted/40 dark:bg-muted/20",
};

export const timeBlockBorders: Record<TimeBlockCategory, string> = {
  production: "border-l-chart-2",
  travel: "border-l-chart-3",
  break: "border-l-chart-1",
  free: "border-l-border",
};

export const timeBlockLabels: Record<TimeBlockCategory, string> = {
  production: "Produktion",
  travel: "Restid",
  break: "Egentid",
  free: "Ledig",
};

export const zoomLevels = [
  { label: "Kompakt", dayH: 28, weekH: 36, monthH: 40, scale: 0.5 },
  { label: "Normal", dayH: 60, weekH: 120, monthH: 100, scale: 1 },
  { label: "XL", dayH: 140, weekH: 320, monthH: 240, scale: 2 },
];

export interface ConstraintCell {
  resourceId: string;
  date: string;
  status: "available" | "warning" | "blocked";
  constraints: Array<{ category: string; severity: "critical" | "warning"; description: string }>;
}

export interface ConstraintData {
  cells: ConstraintCell[];
  weekStart: string;
  dates: string[];
}

export const constraintCategoryLabels: Record<string, string> = {
  resource_availability: "Tillgänglighet",
  vehicle_schedule: "Team",
  capacity: "Kapacitet",
  competency: "Kompetens",
  team_membership: "Team",
  time_window: "Tidsfönster",
  locked_order: "Låst order",
  dependency_chain: "Beroende",
  planned_window: "Planfönster",
};

// Sammanställning av inställelseresa (commute home↔arbetsområde) för en rad/dag (Task #900 E8).
// Endast resa till första jobbet och hem från sista jobbet — exkl. restid mellan jobb.
export interface CommuteSummaryResult {
  ok: boolean;
  reason?: "no-base" | "no-jobs";
  baseLabel: string;
  baseSource: string;
  outKm: number;
  outMin: number;
  backKm: number;
  backMin: number;
  totalKm: number;
  totalMin: number;
  firstLabel: string;
  lastLabel: string;
  jobCount: number;
}

export function getJobCategory(job: WorkOrderWithObject): TimeBlockCategory {
  const title = (job.title || "").toLowerCase();
  if (title.includes("restid") || title.includes("körning") || title.includes("transport")) return "travel";
  if (title.includes("rast") || title.includes("lunch") || title.includes("paus") || title.includes("admin")) return "break";
  return "production";
}

export const haversineDistance = haversineDistanceKm;

export function calculateTravelTime(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const distance = haversineDistanceKm(lat1, lon1, lat2, lon2);
  return Math.round((distance / 40) * 60);
}
