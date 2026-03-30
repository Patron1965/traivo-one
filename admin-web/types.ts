import type { Resource, WorkOrderWithObject, Customer, TaskDependency, Cluster, ObjectTimeRestriction } from "@shared/schema";

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

export interface PlannerAction {
  type: "schedule" | "unschedule";
  jobId: string;
  previousState: {
    resourceId: string | null;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    orderStatus: string;
  };
  newState: {
    resourceId: string | null;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    orderStatus: string;
  };
}

export interface WeekPlannerProps {
  onAddJob?: () => void;
  onSelectJob?: (jobId: string) => void;
  showAIPanel?: boolean;
  onToggleAIPanel?: () => void;
}

export type ViewMode = "day" | "week" | "month" | "route";

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
  clusterSkipped: number;
}

export interface PendingSchedule {
  jobId: string;
  resourceId: string;
  scheduledDate: string;
  scheduledStartTime?: string;
  conflicts: string[];
}

export const priorityDotColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

export const priorityLabels: Record<string, string> = {
  urgent: "Akut",
  high: "Hög",
  normal: "Normal",
  low: "Låg",
};

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
  not_planned: "bg-gray-400",
  planned_rough: "bg-yellow-500",
  planned_fine: "bg-blue-500",
  on_way: "bg-purple-500",
  on_site: "bg-teal-500",
  completed: "bg-green-500",
  inspected: "bg-blue-700",
  invoiced: "bg-emerald-700",
};

export const executionStatusOrder = [
  "not_planned", "planned_rough", "planned_fine", "on_way",
  "on_site", "completed", "inspected", "invoiced",
];

export const HOURS_IN_DAY = 8;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 17;

export const timeBlockColors: Record<TimeBlockCategory, string> = {
  production: "bg-green-100 dark:bg-green-950/30",
  travel: "bg-yellow-100 dark:bg-yellow-950/30",
  break: "bg-blue-100 dark:bg-blue-950/30",
  free: "bg-gray-50 dark:bg-gray-950/20",
};

export const timeBlockBorders: Record<TimeBlockCategory, string> = {
  production: "border-l-green-500",
  travel: "border-l-yellow-400",
  break: "border-l-blue-400",
  free: "border-l-gray-300",
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

export function getJobCategory(job: WorkOrderWithObject): TimeBlockCategory {
  const title = (job.title || "").toLowerCase();
  if (title.includes("restid") || title.includes("körning") || title.includes("transport")) return "travel";
  if (title.includes("rast") || title.includes("lunch") || title.includes("paus") || title.includes("admin")) return "break";
  return "production";
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateTravelTime(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const distance = haversineDistance(lat1, lon1, lat2, lon2);
  return Math.round((distance / 40) * 60);
}
