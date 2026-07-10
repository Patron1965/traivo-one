/**
 * Veckoplanering — motor-lager (Task #786).
 *
 * All KPI-/summerings-, validerings-, varnings-, rese- och regellogik för
 * veckoplaner ligger här (server-side, aldrig i frontend). Route-lagret
 * (`server/routes/weeklyPlanRoutes.ts`) är tunt och anropar dessa funktioner.
 *
 * Återanvänder geo/routing-hjälpare:
 *   - `server/services/routing.ts` (getRouteSummary, isGeoapifyRoutingAvailable)
 *   - `server/distance-matrix-service.ts` (haversineDistanceKm) som fallback
 *
 * Tenant-ägarskap enforce:as i storage-lagret (alla UPDATE/DELETE har tenant_id
 * i WHERE). Motorn arbetar alltid med (tenantId, id) och läser endast data som
 * redan tenant-filtrerats.
 */
import { db } from "../db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { workOrders, planningParameters } from "@shared/schema";
import { storage } from "../storage";
// Task #1153: all rutt/distans-slagning går via den cachade, provider-abstraherade
// getRoutingDistance (getMapProvider bakom, geohash-cache, haversine-fallback inbyggd)
// — ingen direkt getRouteSummary/ad-hoc-fetch längre (gotcha: enda källan = mapProvider).
import { getRoutingDistance } from "../distance-matrix-service";
import { getStartOfISOWeek } from "../routes/helpers";
import type {
  WeeklyPlan,
  WeeklyPlanTask,
  PersonalTask,
  TravelTimeEntry,
  InsertTravelTimeEntry,
  WeeklyPlanWarning,
  PreTask,
  Article,
} from "@shared/schema";

// =============================================================================
// Konfiguration / trösklar (kan överstyras per plan via metadata.config)
// =============================================================================

export interface PlanEngineConfig {
  /** Resekostnad i öre per km (default ~25 kr/mil = 250 öre/km). */
  costPerKmOre: number;
  /** CO2-utsläpp i kg per km (jfr 0.25 kg/km i extendedRoutes). */
  co2KgPerKm: number;
  /** Antagen hastighet (km/h) vid haversine-estimat utan routing-API. */
  defaultSpeedKmh: number;
  /** Minsta nattvila i minuter (11h = 660). */
  nightRestMinMinutes: number;
  /** Minsta veckovila/helgvila i minuter (36h = 2160). */
  weekendRestMinMinutes: number;
  /** Tröskel för "hög reseandel" (andel av produktion+resa). */
  travelShareThreshold: number;
  /** Avtalade timmar/vecka om varken plan eller team anger något. */
  defaultContractedHours: number;
}

export const DEFAULT_PLAN_ENGINE_CONFIG: PlanEngineConfig = {
  costPerKmOre: 250,
  co2KgPerKm: 0.25,
  defaultSpeedKmh: 50,
  nightRestMinMinutes: 11 * 60,
  weekendRestMinMinutes: 36 * 60,
  travelShareThreshold: 0.35,
  defaultContractedHours: 40,
};

const WEEK_TOTAL_MINUTES = 168 * 60; // 10080

// Task #1234 (Motor-/regeladministration): tenant-nivåns planeringsmotor-
// defaults (planning_parameters-raden utan kund/objekt-scope). Best-effort —
// saknad rad eller fel faller tillbaka på DEFAULT_PLAN_ENGINE_CONFIG. Ett
// plans metadata.config vinner alltid över tenant-raden.
async function resolveConfig(tenantId: string, plan: WeeklyPlan): Promise<PlanEngineConfig> {
  let base: PlanEngineConfig = DEFAULT_PLAN_ENGINE_CONFIG;
  try {
    const row = await storage.getTenantEngineDefaults(tenantId);
    if (row) {
      base = {
        costPerKmOre: row.costPerKmOre ?? base.costPerKmOre,
        co2KgPerKm: row.co2KgPerKm ?? base.co2KgPerKm,
        defaultSpeedKmh: row.defaultSpeedKmh ?? base.defaultSpeedKmh,
        nightRestMinMinutes: row.nightRestMinMinutes ?? base.nightRestMinMinutes,
        weekendRestMinMinutes: row.weekendRestMinMinutes ?? base.weekendRestMinMinutes,
        travelShareThreshold: row.travelShareThreshold ?? base.travelShareThreshold,
        defaultContractedHours: row.defaultContractedHours ?? base.defaultContractedHours,
      };
    }
  } catch {
    /* faller tillbaka på DEFAULT_PLAN_ENGINE_CONFIG */
  }
  const override = (plan.metadata as Record<string, unknown> | null)?.["config"];
  if (override && typeof override === "object") {
    return { ...base, ...(override as Partial<PlanEngineConfig>) };
  }
  return base;
}

// =============================================================================
// Hjälp-typer
// =============================================================================

interface WorkOrderFacts {
  id: string;
  cachedValue: number;
  productionMinutes: number;
  lat: number | null;
  lng: number | null;
  scheduledDate: Date | null;
  executionType: string | null;
}

// Feature D drill-down: bokad arbetstid vs dagskapacitet per veckodag.
// day: 0=mån..6=sön. spilltidMinutes = bokad − kapacitet (signerat).
export interface DailyBooking {
  day: number;
  bookedMinutes: number;
  capacityMinutes: number;
  spilltidMinutes: number;
}

export interface WeeklyPlanSummary {
  // Minuter per kategori
  totalProductionMinutes: number;
  totalTravelMinutes: number;
  totalCommuteMinutes: number;
  totalBreakMinutes: number;
  totalPersonalMinutes: number;
  totalRestMinutes: number;
  totalRestNightMinutes: number;
  totalRestWeekendMinutes: number;
  totalOvertimeMinutes: number;
  // Värden
  totalValue: number; // öre
  totalTravelCost: number; // öre
  // Task #1235: summerad artikelbaserad kostnad för icke-produktionsblock (vila/lunch/
  // semester/sjukdom/utbildning/administration/egen tid) via personalTasks.cachedCostOre.
  // 0 för tenants utan internal_time-artiklar (back-compat).
  totalPersonalCostOre: number;
  taskCount: number;
  // KPI
  contractedHours: number;
  contractedMinutes: number; // avtalad/planerad arbetstid i minuter
  producedHours: number;
  workedHours: number;
  workedMinutes: number; // bokad arbetstid i minuter (produktion + resa + inställelse + övertid)
  // Spilltid (Feature D): över-/underbokning slås ihop till ETT signerat ± koncept.
  // >0 = överbokad (produktion tar av egentid), <0 = underbokad (oplanerad tid kvar).
  // Härlett: workedMinutes - contractedMinutes. Invariant: spilltidMinutes > 0 ⟺ overContracted.
  spilltidMinutes: number;
  // Feature D drill-down: bokad arbetstid vs dagskapacitet per veckodag (0=mån..6=sön).
  dailyBooking: DailyBooking[];
  utilizationRate: number; // producerade / avtalade
  planningRate: number; // arbetade / avtalade ( = "% av planerad arbetstid")
  billingRate: number; // producerade / arbetade
  travelShare: number; // resa / (produktion + resa)
  productivity: number; // kr per producerad timme
  weekTotalMinutes: number; // 168h-validering
  // Validering
  within168h: boolean;
  overContracted: boolean;
  // Resor (aggregat)
  estimatedKm: number;
  estimatedCo2Kg: number;
}

// =============================================================================
// Datahämtning
// =============================================================================

async function loadWorkOrderFacts(
  tenantId: string,
  taskIds: string[],
): Promise<Map<string, WorkOrderFacts>> {
  const map = new Map<string, WorkOrderFacts>();
  if (taskIds.length === 0) return map;
  const rows = await db
    .select({
      id: workOrders.id,
      cachedValue: workOrders.cachedValue,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      productionTimeMinutes: workOrders.productionTimeMinutes,
      estimatedDuration: workOrders.estimatedDuration,
      lat: workOrders.taskLatitude,
      lng: workOrders.taskLongitude,
      scheduledDate: workOrders.scheduledDate,
      executionType: workOrders.executionType,
    })
    .from(workOrders)
    .where(and(eq(workOrders.tenantId, tenantId), inArray(workOrders.id, taskIds)));
  for (const r of rows) {
    const production =
      r.cachedProductionMinutes ??
      r.productionTimeMinutes ??
      r.estimatedDuration ??
      0;
    map.set(r.id, {
      id: r.id,
      cachedValue: r.cachedValue ?? 0,
      productionMinutes: production,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      scheduledDate: r.scheduledDate ?? null,
      executionType: r.executionType ?? null,
    });
  }
  return map;
}

export function personalTaskMinutes(t: PersonalTask): number {
  if (t.durationMinutes != null) return t.durationMinutes;
  if (t.startAt && t.endAt) {
    return Math.max(0, Math.round((new Date(t.endAt).getTime() - new Date(t.startAt).getTime()) / 60000));
  }
  return 0;
}

// =============================================================================
// 1. KPI- & valideringsmotor
// =============================================================================

export function computeWeeklyPlanSummary(
  plan: WeeklyPlan,
  tasks: WeeklyPlanTask[],
  personalTasks: PersonalTask[],
  travelEntries: TravelTimeEntry[],
  workOrderFacts: Map<string, WorkOrderFacts>,
  config: PlanEngineConfig,
  // Task #1153: produktionstidsfaktor (team → tenant → 1.0). Trimmar/utökar den
  // aggregerade produktionstiden — muterar aldrig WO-durationer. Audit i metadata.kpi.
  productionTimeFactor: number = 1.0,
): WeeklyPlanSummary {
  let totalProductionMinutes = 0;
  let totalValue = 0;
  for (const t of tasks) {
    const facts = workOrderFacts.get(t.taskId);
    const minutes = t.productionMinutes ?? facts?.productionMinutes ?? 0;
    totalProductionMinutes += minutes;
    totalValue += facts?.cachedValue ?? 0;
  }
  if (productionTimeFactor !== 1.0) {
    totalProductionMinutes = Math.round(totalProductionMinutes * productionTimeFactor);
  }

  let personalTravel = 0;
  let personalCommute = 0;
  let totalBreakMinutes = 0;
  let totalPersonalMinutes = 0;
  let totalRestNightMinutes = 0;
  let totalRestWeekendMinutes = 0;
  let totalOvertimeMinutes = 0;
  let totalPersonalCostOre = 0;
  for (const pt of personalTasks) {
    const minutes = personalTaskMinutes(pt);
    totalPersonalCostOre += pt.cachedCostOre ?? 0;
    switch (pt.timeCategory) {
      case "break_meal":
        totalBreakMinutes += minutes;
        break;
      case "personal_time":
        totalPersonalMinutes += minutes;
        break;
      case "rest_night":
        totalRestNightMinutes += minutes;
        break;
      case "rest_weekend":
        totalRestWeekendMinutes += minutes;
        break;
      case "overtime":
        totalOvertimeMinutes += minutes;
        break;
      case "travel_between_jobs":
        personalTravel += minutes;
        break;
      case "travel_commute":
        personalCommute += minutes;
        break;
      // "production" exkluderas medvetet — produktion bokförs via weekly_plan_tasks.
      default:
        break;
    }
  }

  let entryTravel = 0;
  let entryCommute = 0;
  let totalTravelCost = 0;
  let estimatedKm = 0;
  for (const e of travelEntries) {
    const minutes = e.travelMinutes ?? 0;
    if (e.isCommute) entryCommute += minutes;
    else entryTravel += minutes;
    totalTravelCost += e.travelCost ?? 0;
    estimatedKm += e.distanceKm ?? 0;
  }

  const totalTravelMinutes = entryTravel + personalTravel;
  const totalCommuteMinutes = entryCommute + personalCommute;
  const totalRestMinutes = totalRestNightMinutes + totalRestWeekendMinutes;

  // Arbetstid (betald) = produktion + resa + inställelse + övertid.
  // Rast, personlig tid och vila räknas inte som arbetstid.
  const workedMinutes =
    totalProductionMinutes +
    totalTravelMinutes +
    totalCommuteMinutes +
    totalOvertimeMinutes;

  const weekTotalMinutes =
    totalProductionMinutes +
    totalTravelMinutes +
    totalCommuteMinutes +
    totalBreakMinutes +
    totalPersonalMinutes +
    totalRestMinutes +
    totalOvertimeMinutes;

  const contractedHours =
    plan.contractedHours ?? config.defaultContractedHours;
  const contractedMinutes = contractedHours * 60;

  // Feature D drill-down: per-dag bokad arbetstid vs dagskapacitet. 0=mån..6=sön.
  // Speglar workedMinutes exakt (produktion + resa/inställelse/övertid), bucketat på
  // plannedDate. Dagskapacitet = contractedMinutes/5 (mån–fre), helg=0 enligt mån–fre-
  // konventionen. Odaterade block hamnar utanför dagsvyn (drill-down, ej ombokföring).
  const weekdayIndex = (v: Date | string | null | undefined): number | null => {
    if (!v) return null;
    const d =
      typeof v === "string" ? new Date(v.length <= 10 ? `${v}T12:00:00Z` : v) : new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return (d.getUTCDay() + 6) % 7; // JS 0=sön..6=lör → 0=mån..6=sön
  };
  const dailyProd: number[] = new Array(7).fill(0);
  const dailyOther: number[] = new Array(7).fill(0);
  for (const t of tasks) {
    const facts = workOrderFacts.get(t.taskId);
    const d = weekdayIndex(t.plannedDate ?? t.plannedStartTime ?? facts?.scheduledDate ?? null);
    if (d == null) continue;
    dailyProd[d] += t.productionMinutes ?? facts?.productionMinutes ?? 0;
  }
  if (productionTimeFactor !== 1.0) {
    for (let i = 0; i < 7; i++) dailyProd[i] = Math.round(dailyProd[i] * productionTimeFactor);
  }
  const WORKED_PERSONAL_CATEGORIES = new Set(["travel_between_jobs", "travel_commute", "overtime"]);
  for (const pt of personalTasks) {
    if (!WORKED_PERSONAL_CATEGORIES.has(pt.timeCategory ?? "")) continue;
    const d = weekdayIndex(pt.plannedDate ?? pt.startAt ?? null);
    if (d == null) continue;
    dailyOther[d] += personalTaskMinutes(pt);
  }
  for (const e of travelEntries) {
    const d = weekdayIndex(e.plannedDate ?? null);
    if (d == null) continue;
    dailyOther[d] += e.travelMinutes ?? 0;
  }
  const dailyCapacityMinutes = Math.round(contractedMinutes / 5);
  const dailyBooking: DailyBooking[] = Array.from({ length: 7 }, (_, d) => {
    const bookedMinutes = Math.round(dailyProd[d] + dailyOther[d]);
    const capacityMinutes = d <= 4 ? dailyCapacityMinutes : 0;
    return { day: d, bookedMinutes, capacityMinutes, spilltidMinutes: bookedMinutes - capacityMinutes };
  });

  const producedHours = totalProductionMinutes / 60;
  const workedHours = workedMinutes / 60;

  const utilizationRate =
    contractedMinutes > 0 ? totalProductionMinutes / contractedMinutes : 0;
  const planningRate =
    contractedMinutes > 0 ? workedMinutes / contractedMinutes : 0;
  const billingRate = workedMinutes > 0 ? totalProductionMinutes / workedMinutes : 0;
  const travelDenominator = totalProductionMinutes + totalTravelMinutes + totalCommuteMinutes;
  const travelShare =
    travelDenominator > 0
      ? (totalTravelMinutes + totalCommuteMinutes) / travelDenominator
      : 0;
  // Produktivitet: kronor (öre/100) per producerad timme.
  const productivity = producedHours > 0 ? totalValue / 100 / producedHours : 0;

  const estimatedCo2Kg = estimatedKm * config.co2KgPerKm;

  return {
    totalProductionMinutes,
    totalTravelMinutes,
    totalCommuteMinutes,
    totalBreakMinutes,
    totalPersonalMinutes,
    totalRestMinutes,
    totalRestNightMinutes,
    totalRestWeekendMinutes,
    totalOvertimeMinutes,
    totalValue,
    totalTravelCost,
    totalPersonalCostOre,
    taskCount: tasks.length,
    contractedHours,
    contractedMinutes: Math.round(contractedMinutes),
    producedHours: round2(producedHours),
    workedHours: round2(workedHours),
    workedMinutes: Math.round(workedMinutes),
    spilltidMinutes: Math.round(workedMinutes - contractedMinutes),
    dailyBooking,
    utilizationRate: round4(utilizationRate),
    planningRate: round4(planningRate),
    billingRate: round4(billingRate),
    travelShare: round4(travelShare),
    productivity: round2(productivity),
    weekTotalMinutes,
    within168h: weekTotalMinutes <= WEEK_TOTAL_MINUTES,
    overContracted: workedMinutes > contractedMinutes,
    estimatedKm: round2(estimatedKm),
    estimatedCo2Kg: round2(estimatedCo2Kg),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// =============================================================================
// 2. Varningsmotor (idempotent close/reopen)
// =============================================================================

export interface WarningSpec {
  code: string;
  severity: "error" | "warning" | "info" | "ok";
  category: string;
  message: string;
  relatedTaskId?: string | null;
  relatedPersonalTaskId?: string | null;
  metadata?: Record<string, unknown>;
}

interface TimeBlock {
  start: number;
  end: number;
  label: string;
  relatedTaskId?: string | null;
  relatedPersonalTaskId?: string | null;
  allowOverlap: boolean;
  /** Tidskodens prioritet (1=högst/aldrig överlapp ... 3=lägst/får överbokas). */
  priority: number;
}

// =============================================================================
// Prioritetsmedveten överlapp: en tidskods prioritet (time_code_definitions.priority)
// avgör om två överlappande block är en hård konflikt. Endast prio 1 ("aldrig överlapp",
// t.ex. produktion/restid) kolliderar; lägre prioritet viker undan (egentid får överbokas).
// =============================================================================

// Fallback-prioritet när en tidskod saknas i tenantens register (spegling av seed-defaults
// i storage.seedTimeCodeDefinitions). Registret är auktoritativt — detta är bara robusthet.
const DEFAULT_CODE_PRIORITY: Record<string, number> = {
  production: 1,
  overtime: 1,
  travel_between_jobs: 1,
  setup: 1,
  internal_training: 2,
  internal_repair: 2,
  internal_cleaning: 2,
  internal_admin: 2,
  travel_commute: 3,
  break_meal: 3,
  personal_time: 3,
  rest_night: 3,
  rest_weekend: 3,
};
const FALLBACK_CODE_PRIORITY = 2;

function resolveCodePriority(
  priorityMap: Map<string, number>,
  key: string | null | undefined,
): number {
  if (!key) return FALLBACK_CODE_PRIORITY;
  return priorityMap.get(key) ?? DEFAULT_CODE_PRIORITY[key] ?? FALLBACK_CODE_PRIORITY;
}

function collectTimeBlocks(
  tasks: WeeklyPlanTask[],
  personalTasks: PersonalTask[],
  priorityMap: Map<string, number>,
): TimeBlock[] {
  const blocks: TimeBlock[] = [];
  // Produktionsuppgifter (weekly_plan_tasks) representerar jobb → prioritet via "production".
  const workPriority = resolveCodePriority(priorityMap, "production");
  for (const t of tasks) {
    if (t.plannedStartTime && t.plannedEndTime) {
      blocks.push({
        start: new Date(t.plannedStartTime).getTime(),
        end: new Date(t.plannedEndTime).getTime(),
        label: "uppgift",
        relatedTaskId: t.taskId,
        allowOverlap: Boolean((t.metadata as Record<string, unknown> | null)?.["allowOverlap"]),
        priority: workPriority,
      });
    }
  }
  for (const pt of personalTasks) {
    if (pt.startAt && pt.endAt) {
      blocks.push({
        start: new Date(pt.startAt).getTime(),
        end: new Date(pt.endAt).getTime(),
        label: pt.title,
        relatedPersonalTaskId: pt.id,
        allowOverlap: Boolean((pt.metadata as Record<string, unknown> | null)?.["allowOverlap"]),
        // Override (pt.priority, t.ex. läkarbesök→1) vinner; annars härled från registret.
        priority: pt.priority ?? resolveCodePriority(priorityMap, pt.timeCategory),
      });
    }
  }
  return blocks;
}

export function buildWarningSpecs(
  summary: WeeklyPlanSummary,
  tasks: WeeklyPlanTask[],
  personalTasks: PersonalTask[],
  config: PlanEngineConfig,
  priorityMap: Map<string, number>,
): WarningSpec[] {
  const specs: WarningSpec[] = [];

  // --- Tidskonflikt: överlappande block (med tillåtet överlapp via Kinab-regeln) ---
  const blocks = collectTimeBlocks(tasks, personalTasks, priorityMap).sort((a, b) => a.start - b.start);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (b.start >= a.end) break; // sorterade på start → inga fler överlapp för a
      if (a.allowOverlap || b.allowOverlap) continue; // konverterad egentid → tillåtet
      // Prioritetsmedveten: hård konflikt endast när BÅDA blocken är prio 1 ("aldrig
      // överlapp"). Har något block lägre prioritet viker det undan (får överbokas).
      if (a.priority !== 1 || b.priority !== 1) continue;
      specs.push({
        code: "TIME_CONFLICT",
        severity: "error",
        category: "schedule",
        message: `Tidskonflikt: "${a.label}" och "${b.label}" överlappar i tid.`,
        relatedTaskId: b.relatedTaskId ?? a.relatedTaskId ?? null,
        relatedPersonalTaskId: b.relatedPersonalTaskId ?? null,
      });
    }
  }

  // --- 168h-validering ---
  if (!summary.within168h) {
    specs.push({
      code: "WEEK_OVER_168H",
      severity: "error",
      category: "capacity",
      message: `Veckans totala block (${(summary.weekTotalMinutes / 60).toFixed(1)} h) överskrider 168 timmar.`,
      metadata: { weekTotalMinutes: summary.weekTotalMinutes },
    });
  }

  // --- Övertid-konvertering: arbetstid > avtalade timmar ---
  if (summary.overContracted) {
    const overHours = round2(summary.workedHours - summary.contractedHours);
    specs.push({
      code: "OVERTIME",
      severity: "warning",
      category: "capacity",
      message: `Arbetstid (${summary.workedHours.toFixed(1)} h) överskrider avtalade ${summary.contractedHours} h med ${overHours} h — konverteras till beordrad övertid.`,
      metadata: { overHours, workedHours: summary.workedHours, contractedHours: summary.contractedHours },
    });
  }

  // --- Hög reseandel ---
  if (summary.travelShare > config.travelShareThreshold) {
    specs.push({
      code: "HIGH_TRAVEL_SHARE",
      severity: "warning",
      category: "travel",
      message: `Hög reseandel: ${(summary.travelShare * 100).toFixed(0)} % av produktiv+restid är resor (tröskel ${(config.travelShareThreshold * 100).toFixed(0)} %).`,
      metadata: { travelShare: summary.travelShare, threshold: config.travelShareThreshold },
    });
  }

  // --- Nattvila: per rest_night-block mot minimikrav ---
  for (const pt of personalTasks) {
    if (pt.timeCategory !== "rest_night") continue;
    const minutes = personalTaskMinutes(pt);
    if (minutes > 0 && minutes < config.nightRestMinMinutes) {
      specs.push({
        code: "REST_NIGHT_VIOLATION",
        severity: "warning",
        category: "rest",
        message: `Nattvila "${pt.title}" är ${(minutes / 60).toFixed(1)} h, under minimikravet ${(config.nightRestMinMinutes / 60).toFixed(0)} h.`,
        relatedPersonalTaskId: pt.id,
        metadata: { minutes, minMinutes: config.nightRestMinMinutes },
      });
    }
  }

  // --- Helgvila: ok eller för kort ---
  if (summary.totalRestWeekendMinutes > 0) {
    if (summary.totalRestWeekendMinutes >= config.weekendRestMinMinutes) {
      specs.push({
        code: "WEEKEND_REST_OK",
        severity: "ok",
        category: "rest",
        message: `Helgvila uppfylld (${(summary.totalRestWeekendMinutes / 60).toFixed(1)} h ≥ ${(config.weekendRestMinMinutes / 60).toFixed(0)} h).`,
        metadata: { minutes: summary.totalRestWeekendMinutes },
      });
    } else {
      specs.push({
        code: "WEEKEND_REST_SHORT",
        severity: "warning",
        category: "rest",
        message: `Helgvila är ${(summary.totalRestWeekendMinutes / 60).toFixed(1)} h, under minimikravet ${(config.weekendRestMinMinutes / 60).toFixed(0)} h.`,
        metadata: { minutes: summary.totalRestWeekendMinutes, minMinutes: config.weekendRestMinMinutes },
      });
    }
  }

  // --- Info: lågt utnyttjande ---
  if (summary.taskCount > 0 && summary.utilizationRate < 0.5) {
    specs.push({
      code: "LOW_UTILIZATION",
      severity: "info",
      category: "info",
      message: `Lågt utnyttjande: ${(summary.utilizationRate * 100).toFixed(0)} % av avtalad tid är producerad.`,
      metadata: { utilizationRate: summary.utilizationRate },
    });
  }

  return specs;
}

function warningKey(code: string, relatedTaskId?: string | null, relatedPersonalTaskId?: string | null): string {
  return `${code}::${relatedTaskId ?? ""}::${relatedPersonalTaskId ?? ""}`;
}

/**
 * Idempotent avstämning: skapar saknade varningar, uppdaterar/återöppnar
 * matchande och stänger (resolved=true) sådana som inte längre produceras.
 */
export async function reconcileWarnings(
  tenantId: string,
  weeklyPlanId: string,
  specs: WarningSpec[],
): Promise<WeeklyPlanWarning[]> {
  const existing = await storage.getWeeklyPlanWarnings(tenantId, weeklyPlanId);
  const desired = new Map<string, WarningSpec>();
  for (const s of specs) {
    desired.set(warningKey(s.code, s.relatedTaskId, s.relatedPersonalTaskId), s);
  }

  const claimed = new Set<string>();
  const now = new Date();

  for (const w of existing) {
    const key = warningKey(w.code ?? "", w.relatedTaskId, w.relatedPersonalTaskId);
    const spec = desired.get(key);
    if (spec && !claimed.has(key)) {
      // Uppdatera + återöppna (om stängd).
      claimed.add(key);
      await storage.updateWeeklyPlanWarning(tenantId, w.id, {
        severity: spec.severity,
        category: spec.category,
        message: spec.message,
        resolved: false,
        resolvedAt: null,
        metadata: spec.metadata ?? {},
      });
    } else if (!w.resolved) {
      // Inte längre önskad (eller dubblett) → stäng.
      await storage.updateWeeklyPlanWarning(tenantId, w.id, {
        resolved: true,
        resolvedAt: now,
      });
    }
  }

  // Skapa nya som saknar matchning.
  for (const [key, spec] of Array.from(desired.entries())) {
    if (claimed.has(key)) continue;
    await storage.createWeeklyPlanWarning({
      tenantId,
      weeklyPlanId,
      severity: spec.severity,
      code: spec.code,
      category: spec.category,
      message: spec.message,
      relatedTaskId: spec.relatedTaskId ?? null,
      relatedPersonalTaskId: spec.relatedPersonalTaskId ?? null,
      resolved: false,
      metadata: spec.metadata ?? {},
    });
  }

  return storage.getWeeklyPlanWarnings(tenantId, weeklyPlanId);
}

// =============================================================================
// 3 & 4. Resekostnad/km/CO2 via routing-tjänst
// =============================================================================

interface ResolvedCoords {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

function resolveEntryCoords(
  entry: TravelTimeEntry,
  facts: Map<string, WorkOrderFacts>,
): ResolvedCoords | null {
  let fromLat = entry.fromLat;
  let fromLng = entry.fromLng;
  let toLat = entry.toLat;
  let toLng = entry.toLng;

  if ((fromLat == null || fromLng == null) && entry.fromTaskId) {
    const f = facts.get(entry.fromTaskId);
    if (f?.lat != null && f?.lng != null) {
      fromLat = f.lat;
      fromLng = f.lng;
    }
  }
  if ((toLat == null || toLng == null) && entry.toTaskId) {
    const t = facts.get(entry.toTaskId);
    if (t?.lat != null && t?.lng != null) {
      toLat = t.lat;
      toLng = t.lng;
    }
  }

  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    return null;
  }
  return { fromLat, fromLng, toLat, toLng };
}

// =============================================================================
// Task #1153: Restidsmotor — grundparametrar, framkalkylering & auto-tidskod
// =============================================================================

/** Upplösta restidsmotor-parametrar (team → tenant-default → motordefault). */
export interface TravelEngineParams {
  /** Hastighetstak (km/h) på resans medelfart. null = inget tak. */
  speedCapKmh: number | null;
  /** Restidsfaktor (multiplikator). Golv 0.5, tak 3.0. */
  travelTimeFactor: number;
  /** Produktionstidsfaktor (multiplikator). Golv 0.5, tak 3.0. */
  productionTimeFactor: number;
  /** Vinterfaktor på restid inom vinterperioden. Golv 1.0, tak 3.0. */
  winterFactor: number;
  /** Vinterperiod (mm-dd). null = ingen vinterjustering. */
  winterStart: string | null;
  winterEnd: string | null;
}

const TRAVEL_FACTOR_FLOOR = 0.5;
const TRAVEL_FACTOR_CEIL = 3.0;

export const DEFAULT_TRAVEL_ENGINE_PARAMS: TravelEngineParams = {
  speedCapKmh: null,
  travelTimeFactor: 1.0,
  productionTimeFactor: 1.0,
  winterFactor: 1.0,
  winterStart: null,
  winterEnd: null,
};

function clampFactor(
  v: number | null | undefined,
  min = TRAVEL_FACTOR_FLOOR,
  max = TRAVEL_FACTOR_CEIL,
): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

function firstNonNull<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) if (v != null) return v;
  return null;
}

/**
 * Löser upp restidsmotor-parametrar. Team-värdet vinner, annars tenant-default
 * (planning_parameters-raden med customer_id IS NULL AND object_id IS NULL),
 * annars motorns default. Faktorer clampas [0.5, 3.0]; vinterfaktor ≥ 1.0.
 * Hastighetstak > 0 annars behandlat som "inget tak".
 */
export async function resolveTravelEngineParams(
  tenantId: string,
  teamId: string | null,
): Promise<TravelEngineParams> {
  const team = teamId ? await storage.getTeam(teamId) : undefined;
  const [tenantRow] = await db
    .select()
    .from(planningParameters)
    .where(
      and(
        eq(planningParameters.tenantId, tenantId),
        isNull(planningParameters.customerId),
        isNull(planningParameters.objectId),
      ),
    )
    .limit(1);

  const rawCap = firstNonNull(team?.speedCapKmh, tenantRow?.speedCapKmh);
  return {
    speedCapKmh: rawCap != null && rawCap > 0 ? rawCap : null,
    travelTimeFactor: clampFactor(firstNonNull(team?.travelTimeFactor, tenantRow?.travelTimeFactor)) ?? 1.0,
    productionTimeFactor:
      clampFactor(firstNonNull(team?.productionTimeFactor, tenantRow?.productionTimeFactor)) ?? 1.0,
    winterFactor: clampFactor(firstNonNull(team?.winterFactor, tenantRow?.winterFactor), 1.0) ?? 1.0,
    winterStart: firstNonNull(team?.winterStart, tenantRow?.winterStart),
    winterEnd: firstNonNull(team?.winterEnd, tenantRow?.winterEnd),
  };
}

/**
 * Task #1235 (Motor 12): väljer bästa "restid"-artikel för en resa. Filtrerar på
 * tenant + articleType="restid" (soft-delete/arkiv hanteras av getArticles).
 * Bland kandidater som matchar (eller saknar) fordonstyp/hastighetsintervall väljs
 * den mest SPECIFIKA matchningen (flest satta urvalsvillkor som stämmer) — en
 * artikel utan villkor fungerar som tenant-fallback. Ingen "restid"-artikel alls
 * ⇒ null (motorn faller tillbaka på legacy config.costPerKmOre/haversine-tid).
 */
export async function resolveTravelArticle(
  tenantId: string,
  opts: {
    vehicleType?: string | null;
    avgSpeedKmh?: number | null;
    roadType?: string | null;
    distanceKm?: number | null;
  } = {},
): Promise<Article | null> {
  const all = await storage.getArticles(tenantId);
  const candidates = all.filter((a) => a.articleType === "restid" && a.travelMinutesPerKm != null);
  if (candidates.length === 0) return null;

  let best: Article | null = null;
  let bestScore = -1;
  for (const a of candidates) {
    let score = 0;
    if (a.travelVehicleTypes && a.travelVehicleTypes.length > 0) {
      if (!opts.vehicleType || !a.travelVehicleTypes.includes(opts.vehicleType)) continue;
      score += 2;
    }
    if (a.travelRoadTypes && a.travelRoadTypes.length > 0) {
      if (!opts.roadType || !a.travelRoadTypes.includes(opts.roadType)) continue;
      score += 2;
    }
    if (a.travelMinSpeedKmh != null || a.travelMaxSpeedKmh != null) {
      const speed = opts.avgSpeedKmh;
      if (speed == null) continue;
      if (a.travelMinSpeedKmh != null && speed < a.travelMinSpeedKmh) continue;
      if (a.travelMaxSpeedKmh != null && speed > a.travelMaxSpeedKmh) continue;
      score += 1;
    }
    if (score >= bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * Task #1235: härleder en grov vägtyp ur medelfart för matchning mot
 * articles.travelRoadTypes ("stad" | "landsvag" | "motorvag"). Rent
 * heuristiskt (ingen vägdata från routing-providern) — display/matchnings-
 * signal, ej framkalkylerad sanning.
 */
export function estimateRoadType(avgSpeedKmh: number): "stad" | "landsvag" | "motorvag" {
  if (avgSpeedKmh > 70) return "motorvag";
  if (avgSpeedKmh > 35) return "landsvag";
  return "stad";
}

/**
 * Task #1235: härleder fordonstypen som driver en plans resor — teamledarens
 * (fallback: första aktiva medlems) primära fordon via resource_vehicles.
 * Ingen koppling ⇒ null (resolveTravelArticle faller tillbaka på artiklar
 * utan fordonsvillkor, eller vidare till legacy-beteende).
 */
export async function resolveTeamVehicleType(teamId: string | null): Promise<string | null> {
  if (!teamId) return null;
  const team = await storage.getTeam(teamId);
  if (!team) return null;
  const candidateResourceIds: string[] = [];
  if (team.leaderId) candidateResourceIds.push(team.leaderId);
  const members = await storage.getTeamMembers(teamId);
  for (const m of members) {
    if (m.resourceId && !candidateResourceIds.includes(m.resourceId)) candidateResourceIds.push(m.resourceId);
  }
  if (candidateResourceIds.length === 0) return null;
  const resourceVehicles = await storage.getResourceVehiclesByResourceIds(candidateResourceIds);
  if (resourceVehicles.length === 0) return null;
  // Föredra teamledarens/första kandidatens primära fordon, annars första hittade.
  for (const resourceId of candidateResourceIds) {
    const rv =
      resourceVehicles.find((r) => r.resourceId === resourceId && r.isPrimary) ??
      resourceVehicles.find((r) => r.resourceId === resourceId);
    if (rv) {
      const vehicle = await storage.getVehicle(rv.vehicleId);
      if (vehicle) return vehicle.vehicleType;
    }
  }
  return null;
}

/**
 * Task #1235: framkalkylerar en resa via en "restid"-artikel (öre/km + minuter/km).
 * Görs ENDAST om en matchande tenant-artikel finns — annars null och anroparen
 * faller tillbaka på legacy hastighetstak/faktor-kedjan (back-compat).
 */
export function computeTravelFromArticle(
  article: Article,
  distanceKm: number,
): { minutes: number; costOre: number } | null {
  if (article.travelMinutesPerKm == null) return null;
  const minutes = Math.round(distanceKm * article.travelMinutesPerKm);
  const costOre = Math.round(distanceKm * (article.cost ?? 0));
  return { minutes, costOre };
}

/**
 * Task #1235: väljer artikeln (articleType="internal_time") som gör en icke-
 * produktionstidskategori (vila/lunch/semester/sjukdom/utbildning/administration/
 * egen tid) till en artikelbaserad uppgift. Matchas via articles.timeCodeKey ===
 * personalTasks.timeCategory (samma koppling som produktionsartiklar använder mot
 * time_code_definitions.key). Ingen matchande artikel ⇒ null (fristående tidspost,
 * som tidigare — expand-contract, kräver ingen admin-migrering av befintliga tenants).
 */
export async function resolveTimeCategoryArticle(
  tenantId: string,
  timeCategory: string,
): Promise<Article | null> {
  const all = await storage.getArticles(tenantId);
  const match = all.find((a) => a.articleType === "internal_time" && a.timeCodeKey === timeCategory);
  return match ?? null;
}

/**
 * Task #1235: kostnad (öre) för ett personligt block via dess artikel. cost på en
 * internal_time-artikel tolkas som öre/minut (arbetskraftskostnad för tidstypen).
 */
export function computePersonalTaskCostFromArticle(
  article: Article,
  durationMinutes: number,
): number {
  return Math.round(durationMinutes * (article.cost ?? 0));
}

/**
 * Centraliserad artikel-/kostnadshärledning för ett personligt block. ENDA
 * platsen som får sätta articleId/cachedCostOre — måste anropas från VARJE
 * skapande/uppdaterande väg (route create/patch, schemaläggning/materialisering,
 * kategori-konvertering), annars blir kopplingen/kostnaden stale eller saknas
 * tyst för block som inte går via route-handlerns kod.
 */
export async function resolvePersonalTaskArticleFields(
  tenantId: string,
  timeCategory: string,
  effectiveMinutes: number,
): Promise<{ articleId: string | null; cachedCostOre: number | null }> {
  const article = await resolveTimeCategoryArticle(tenantId, timeCategory);
  return {
    articleId: article?.id ?? null,
    cachedCostOre: article && effectiveMinutes > 0 ? computePersonalTaskCostFromArticle(article, effectiveMinutes) : null,
  };
}

/** mm-dd ur ett datum (sträng "YYYY-MM-DD" eller Date). */
function toMmDd(d: string | Date): string {
  if (typeof d === "string") return d.slice(5, 10);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/** Är datumet inom vinterperioden? Hanterar årsskifte (start > slut). */
function isInWinter(plannedDate: string | Date | null, start: string | null, end: string | null): boolean {
  if (!plannedDate || !start || !end) return false;
  const d = toMmDd(plannedDate);
  if (start <= end) return d >= start && d <= end;
  return d >= start || d <= end;
}

/** Framkalkylering (transparens, display-only) som lagras på resemomentet. */
export interface TravelCorrection {
  rawMinutes: number;
  rawSource: string;
  distanceKm: number;
  avgSpeedKmh: number;
  appliedSpeedCapKmh: number | null;
  travelTimeFactor: number;
  winterFactor: number;
  winterApplied: boolean;
  computedAt: string;
}

/**
 * Framkalkylering per resa: hastighetstak på medelfarten → restidsfaktor →
 * vinterfaktor. Taket adderar tid endast om medelfarten faktiskt överstiger taket
 * (tunga fordon som "inte hinner"). Egentid/inställelse (travel_commute) får
 * korrigeras men aldrig trimmas (restidsfaktor < 1.0 ignoreras).
 */
function applyTravelCorrection(
  rawMinutes: number,
  distanceKm: number,
  rawSource: string,
  params: TravelEngineParams,
  plannedDate: string | Date | null,
  timeCategory: string | null,
): { minutes: number; correction: TravelCorrection } {
  const avgSpeedKmh = rawMinutes > 0 ? distanceKm / (rawMinutes / 60) : 0;

  let minutes = rawMinutes;
  const capApplies =
    params.speedCapKmh != null && params.speedCapKmh > 0 && avgSpeedKmh > params.speedCapKmh;
  if (capApplies) {
    minutes = Math.max(minutes, (distanceKm / (params.speedCapKmh as number)) * 60);
  }

  // Egentid/inställelse trimmas aldrig — restidsfaktor kan bara höja, inte sänka.
  const isEgentid = timeCategory === "travel_commute";
  let travelFactor = params.travelTimeFactor;
  if (isEgentid && travelFactor < 1.0) travelFactor = 1.0;
  minutes = minutes * travelFactor;

  const winterApplied = isInWinter(plannedDate, params.winterStart, params.winterEnd);
  const winterFactor = winterApplied ? params.winterFactor : 1.0;
  minutes = minutes * winterFactor;

  return {
    minutes: Math.round(minutes),
    correction: {
      rawMinutes: Math.round(rawMinutes),
      rawSource,
      distanceKm: round2(distanceKm),
      avgSpeedKmh: round2(avgSpeedKmh),
      appliedSpeedCapKmh: capApplies ? (params.speedCapKmh as number) : null,
      travelTimeFactor: round2(travelFactor),
      winterFactor: round2(winterFactor),
      winterApplied,
      computedAt: new Date().toISOString(),
    },
  };
}

const TRAVEL_KEY_SEP = "|";
function travelKey(day: string, fromTaskId: string, toTaskId: string): string {
  return `${day}${TRAVEL_KEY_SEP}${fromTaskId}${TRAVEL_KEY_SEP}${toTaskId}`;
}
function toDayKey(d: string | Date): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Enda källan för auto-genererade resemoment: bygger job→job-poster per dag ur den
 * ordnade uppgiftssekvensen (plannedStartTime, fallback sequence). Upsert på
 * (plannedDate, fromTaskId, toTaskId):
 *   - matchande auto-post lämnas orörd (id + manuell tidskod bevaras),
 *   - saknad post skapas (isAuto=true),
 *   - inaktuell auto-post raderas.
 * Manuella ad-hoc-poster (isAuto=false) rörs aldrig.
 */
export async function rebuildTravelEntriesForPlan(tenantId: string, weeklyPlanId: string): Promise<void> {
  const tasks = await storage.getWeeklyPlanTasks(tenantId, weeklyPlanId);
  const facts = await loadWorkOrderFacts(tenantId, tasks.map((t) => t.taskId));

  const byDay = new Map<string, WeeklyPlanTask[]>();
  for (const t of tasks) {
    if (!t.plannedDate) continue;
    const day = toDayKey(t.plannedDate);
    const arr = byDay.get(day);
    if (arr) arr.push(t);
    else byDay.set(day, [t]);
  }

  const desired: { day: string; fromTaskId: string; toTaskId: string }[] = [];
  for (const [day, dayTasks] of Array.from(byDay)) {
    dayTasks.sort((a, b) => {
      const at = a.plannedStartTime ? new Date(a.plannedStartTime).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.plannedStartTime ? new Date(b.plannedStartTime).getTime() : Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
    const withCoords = dayTasks.filter((t) => {
      const f = facts.get(t.taskId);
      return f?.lat != null && f?.lng != null;
    });
    for (let i = 0; i < withCoords.length - 1; i++) {
      desired.push({ day, fromTaskId: withCoords[i].taskId, toTaskId: withCoords[i + 1].taskId });
    }
  }

  const existing = await storage.getTravelTimeEntries(tenantId, weeklyPlanId);
  const existingAuto = new Map<string, TravelTimeEntry>();
  for (const e of existing) {
    if (e.isAuto && e.plannedDate && e.fromTaskId && e.toTaskId) {
      existingAuto.set(travelKey(toDayKey(e.plannedDate), e.fromTaskId, e.toTaskId), e);
    }
  }
  const desiredKeys = new Set(desired.map((d) => travelKey(d.day, d.fromTaskId, d.toTaskId)));

  for (const d of desired) {
    if (existingAuto.has(travelKey(d.day, d.fromTaskId, d.toTaskId))) continue;
    await storage.createTravelTimeEntry({
      tenantId,
      weeklyPlanId,
      fromTaskId: d.fromTaskId,
      toTaskId: d.toTaskId,
      plannedDate: d.day,
      isAuto: true,
      isCommute: false,
    });
  }
  for (const [key, entry] of Array.from(existingAuto)) {
    if (!desiredKeys.has(key)) await storage.deleteTravelTimeEntry(tenantId, entry.id);
  }
}

/**
 * Räknar om distans/restid/kostnad för alla travel_time_entries i en plan.
 * Steg: (1) synka auto-genererade job→job-poster, (2) lös upp motor-parametrar,
 * (3) auto-klassa tidskod per dag (första resa = inställelse/travel_commute, övriga
 * = ställtid/setup; manuella tidskoder rörs ej), (4) framkalkylera restid via cachad
 * provider-slagning + hastighetstak/faktorer. CO2 aggregeras till planens metadata.
 */
export async function recomputeTravelForPlan(
  tenantId: string,
  weeklyPlanId: string,
  config: PlanEngineConfig,
  params?: TravelEngineParams,
): Promise<{ updated: number; totalKm: number; totalCostOre: number; totalCo2Kg: number }> {
  // (1) Synka auto-poster mot nuvarande uppgiftssekvens.
  await rebuildTravelEntriesForPlan(tenantId, weeklyPlanId);

  // (2) Lös upp motor-parametrar (om inte redan gjort av recomputeWeeklyPlan).
  const plan = await storage.getWeeklyPlan(tenantId, weeklyPlanId);
  let resolvedParams = params;
  if (!resolvedParams) {
    resolvedParams = await resolveTravelEngineParams(tenantId, plan?.teamId ?? null);
  }
  // Task #1235 (Motor 12): fordonstyp som driver planens resor — behövs för att matcha
  // articles.travelVehicleTypes. Ingen koppling ⇒ null (artikel-matchning degraderar
  // till hastighet/vägtyp eller villkorslös fallback-artikel).
  const teamVehicleType = await resolveTeamVehicleType(plan?.teamId ?? null);

  const entries = await storage.getTravelTimeEntries(tenantId, weeklyPlanId);
  const taskIds = new Set<string>();
  for (const e of entries) {
    if (e.fromTaskId) taskIds.add(e.fromTaskId);
    if (e.toTaskId) taskIds.add(e.toTaskId);
  }
  const facts = await loadWorkOrderFacts(tenantId, Array.from(taskIds));

  // (3) Auto-klassa tidskod per dag på fromTask-ordning (plannedStartTime, fallback
  //     sequence). Skriver aldrig över manuellt satt tidskod.
  const planTasks = await storage.getWeeklyPlanTasks(tenantId, weeklyPlanId);
  const taskOrder = new Map<string, { start: number; seq: number }>();
  for (const t of planTasks) {
    taskOrder.set(t.taskId, {
      start: t.plannedStartTime ? new Date(t.plannedStartTime).getTime() : Number.MAX_SAFE_INTEGER,
      seq: t.sequence ?? 0,
    });
  }
  const entryOrder = (e: TravelTimeEntry): { start: number; seq: number } =>
    (e.fromTaskId ? taskOrder.get(e.fromTaskId) : undefined) ?? {
      start: Number.MAX_SAFE_INTEGER,
      seq: Number.MAX_SAFE_INTEGER,
    };

  const entriesByDay = new Map<string, TravelTimeEntry[]>();
  for (const e of entries) {
    const day = e.plannedDate ? toDayKey(e.plannedDate) : "__nodate__";
    const arr = entriesByDay.get(day);
    if (arr) arr.push(e);
    else entriesByDay.set(day, [e]);
  }
  const autoCategory = new Map<string, string>();
  for (const [, dayEntries] of Array.from(entriesByDay)) {
    dayEntries.sort((a, b) => {
      const oa = entryOrder(a);
      const ob = entryOrder(b);
      if (oa.start !== ob.start) return oa.start - ob.start;
      return oa.seq - ob.seq;
    });
    dayEntries.forEach((e, idx) => {
      autoCategory.set(e.id, idx === 0 ? "travel_commute" : "setup");
    });
  }

  // (4) Framkalkylera per resemoment.
  let updated = 0;
  let totalKm = 0;
  let totalCostOre = 0;

  for (const entry of entries) {
    const coords = resolveEntryCoords(entry, facts);
    if (!coords) continue;

    // Rå distans + tid via cachad, provider-abstraherad slagning (haversine-fallback inbyggd).
    const raw = await getRoutingDistance(coords.fromLat, coords.fromLng, coords.toLat, coords.toLng);

    // Effektiv tidskod: manuell override vinner, annars auto-klassning.
    const effectiveCategory = entry.timeCategoryManual
      ? entry.timeCategory
      : autoCategory.get(entry.id) ?? entry.timeCategory ?? null;

    // Task #1235 (Motor 12): en tenant-artikel (articleType="restid") driver hellre
    // tid/kostnad än de generiska hastighetstak/faktor-konstanterna. Ingen matchande
    // artikel ⇒ oförändrat legacy-beteende (back-compat).
    const avgSpeedKmh = raw.durationMin > 0 ? raw.distanceKm / (raw.durationMin / 60) : 0;
    const roadType = estimateRoadType(avgSpeedKmh);
    const travelArticle = await resolveTravelArticle(tenantId, {
      avgSpeedKmh,
      roadType,
      vehicleType: teamVehicleType,
      distanceKm: raw.distanceKm,
    });
    const articleResult = travelArticle ? computeTravelFromArticle(travelArticle, raw.distanceKm) : null;

    let minutes: number;
    let correction: TravelCorrection;
    let travelCost: number;
    if (articleResult) {
      minutes = articleResult.minutes;
      travelCost = articleResult.costOre;
      correction = {
        rawMinutes: Math.round(raw.durationMin),
        rawSource: raw.source,
        distanceKm: round2(raw.distanceKm),
        avgSpeedKmh: round2(avgSpeedKmh),
        appliedSpeedCapKmh: null,
        travelTimeFactor: 1,
        winterFactor: 1,
        winterApplied: false,
        computedAt: new Date().toISOString(),
      };
    } else {
      const legacy = applyTravelCorrection(
        raw.durationMin,
        raw.distanceKm,
        raw.source,
        resolvedParams,
        entry.plannedDate ?? null,
        effectiveCategory,
      );
      minutes = legacy.minutes;
      correction = legacy.correction;
      travelCost = Math.round(raw.distanceKm * config.costPerKmOre);
    }
    totalKm += raw.distanceKm;
    totalCostOre += travelCost;

    const patch: Partial<InsertTravelTimeEntry> = {
      fromLat: coords.fromLat,
      fromLng: coords.fromLng,
      toLat: coords.toLat,
      toLng: coords.toLng,
      distanceKm: round2(raw.distanceKm),
      travelMinutes: minutes,
      travelCost,
      source: raw.source,
      correction,
      isCommute: effectiveCategory === "travel_commute",
      articleId: travelArticle?.id ?? null,
    };
    // Skriv aldrig över en manuellt satt tidskod.
    if (!entry.timeCategoryManual) {
      patch.timeCategory = effectiveCategory ?? undefined;
    }
    await storage.updateTravelTimeEntry(tenantId, entry.id, patch);
    updated++;
  }

  return {
    updated,
    totalKm: round2(totalKm),
    totalCostOre,
    totalCo2Kg: round2(totalKm * config.co2KgPerKm),
  };
}

// =============================================================================
// Orkestrering: räkna om en hel veckoplan
// =============================================================================

export interface RecomputeResult {
  plan: WeeklyPlan;
  summary: WeeklyPlanSummary;
  warnings: WeeklyPlanWarning[];
}

export async function recomputeWeeklyPlan(
  tenantId: string,
  weeklyPlanId: string,
  opts?: { recomputeTravel?: boolean },
): Promise<RecomputeResult | null> {
  const plan = await storage.getWeeklyPlan(tenantId, weeklyPlanId);
  if (!plan) return null;
  const config = await resolveConfig(tenantId, plan);

  // Task #1153: lös upp restidsmotor-parametrar en gång (team → tenant → default)
  // och återanvänd för både restidsberäkning och produktionstids-aggregering.
  const travelParams = await resolveTravelEngineParams(tenantId, plan.teamId ?? null);

  if (opts?.recomputeTravel) {
    await recomputeTravelForPlan(tenantId, weeklyPlanId, config, travelParams);
  }

  const [tasks, personalTasks, travelEntries, timeCodes] = await Promise.all([
    storage.getWeeklyPlanTasks(tenantId, weeklyPlanId),
    storage.getPersonalTasks(tenantId, { weeklyPlanId }),
    storage.getTravelTimeEntries(tenantId, weeklyPlanId),
    storage.getTimeCodeDefinitions(tenantId),
  ]);
  // Prioritetskarta (key → priority) från tenantens tidskod-register för överlapp-logiken.
  const priorityMap = new Map<string, number>(timeCodes.map((tc) => [tc.key, tc.priority]));

  const facts = await loadWorkOrderFacts(
    tenantId,
    tasks.map((t) => t.taskId),
  );

  const summary = computeWeeklyPlanSummary(
    plan,
    tasks,
    personalTasks,
    travelEntries,
    facts,
    config,
    travelParams.productionTimeFactor,
  );

  const existingMeta = (plan.metadata as Record<string, unknown> | null) ?? {};
  const updated = await storage.updateWeeklyPlan(tenantId, weeklyPlanId, {
    totalProductionMinutes: summary.totalProductionMinutes,
    totalTravelMinutes: summary.totalTravelMinutes,
    totalCommuteMinutes: summary.totalCommuteMinutes,
    totalBreakMinutes: summary.totalBreakMinutes,
    totalPersonalMinutes: summary.totalPersonalMinutes,
    totalRestMinutes: summary.totalRestMinutes,
    totalOvertimeMinutes: summary.totalOvertimeMinutes,
    utilizationRate: summary.utilizationRate,
    totalPlannedHours: summary.workedHours,
    totalValue: summary.totalValue,
    totalTravelCost: summary.totalTravelCost,
    taskCount: summary.taskCount,
    metadata: {
      ...existingMeta,
      lastCalculatedAt: new Date().toISOString(),
      kpi: {
        producedHours: summary.producedHours,
        workedHours: summary.workedHours,
        workedMinutes: summary.workedMinutes,
        contractedHours: summary.contractedHours,
        contractedMinutes: summary.contractedMinutes,
        spilltidMinutes: summary.spilltidMinutes,
        dailyBooking: summary.dailyBooking,
        utilizationRate: summary.utilizationRate,
        planningRate: summary.planningRate,
        billingRate: summary.billingRate,
        travelShare: summary.travelShare,
        productivity: summary.productivity,
        weekTotalMinutes: summary.weekTotalMinutes,
        within168h: summary.within168h,
        overContracted: summary.overContracted,
        estimatedKm: summary.estimatedKm,
        totalPersonalCostOre: summary.totalPersonalCostOre,
        estimatedCo2Kg: summary.estimatedCo2Kg,
        totalRestNightMinutes: summary.totalRestNightMinutes,
        totalRestWeekendMinutes: summary.totalRestWeekendMinutes,
        // Task #1153: tillämpade restidsmotor-faktorer (transparens/audit).
        appliedProductionFactor: travelParams.productionTimeFactor,
        appliedTravelFactor: travelParams.travelTimeFactor,
        appliedWinterFactor: travelParams.winterFactor,
        appliedSpeedCapKmh: travelParams.speedCapKmh,
      },
    },
  });

  const specs = buildWarningSpecs(summary, tasks, personalTasks, config, priorityMap);
  const warnings = await reconcileWarnings(tenantId, weeklyPlanId, specs);

  return { plan: updated ?? plan, summary, warnings };
}

// =============================================================================
// 3. Affärsregel: konvertering egentid → beordrad (Kinab-regeln)
// =============================================================================

/**
 * Konverterar ett personlig-tid-block (egentid) till beordrad övertid eller
 * beordrad restid och loggar konverteringen i blockets metadata. Sätter
 * `allowOverlap=true` så att tillåtet överlapp inte längre flaggar tidskonflikt.
 */
export async function convertPersonalTimeToOrdered(
  tenantId: string,
  personalTaskId: string,
  opts: { toCategory: "overtime" | "travel_between_jobs"; allowOverlap?: boolean; convertedBy?: string | null },
): Promise<PersonalTask | undefined> {
  const task = await storage.getPersonalTask(tenantId, personalTaskId);
  if (!task) return undefined;
  const existingMeta = (task.metadata as Record<string, unknown> | null) ?? {};
  const effectiveMinutes = personalTaskMinutes({
    durationMinutes: task.durationMinutes,
    startAt: task.startAt,
    endAt: task.endAt,
  } as any);
  const { articleId, cachedCostOre } = await resolvePersonalTaskArticleFields(
    tenantId,
    opts.toCategory,
    effectiveMinutes,
  );
  const updated = await storage.updatePersonalTask(tenantId, personalTaskId, {
    timeCategory: opts.toCategory,
    articleId,
    cachedCostOre,
    metadata: {
      ...existingMeta,
      allowOverlap: opts.allowOverlap ?? true,
      conversion: {
        from: task.timeCategory,
        to: opts.toCategory,
        convertedAt: new Date().toISOString(),
        convertedBy: opts.convertedBy ?? null,
      },
    },
  });
  if (task.weeklyPlanId) {
    await recomputeWeeklyPlan(tenantId, task.weeklyPlanId);
  }
  return updated;
}

// =============================================================================
// 5. Pre-task-regelmotor (execution_type → pre_tasks)
// =============================================================================

export async function generatePreTasksForWorkOrder(
  tenantId: string,
  workOrderId: string,
): Promise<PreTask[]> {
  const [wo] = await db
    .select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      executionType: workOrders.executionType,
      scheduledDate: workOrders.scheduledDate,
    })
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
  if (!wo || !wo.executionType) return [];

  const rules = await storage.getExecTypePreTaskRules(tenantId, {
    executionType: wo.executionType,
    activeOnly: true,
  });
  const existing = await storage.getPreTasks(tenantId, { workOrderId });
  const existingRuleIds = new Set(existing.map((p) => p.sourceRule).filter(Boolean));

  const created: PreTask[] = [];
  for (const rule of rules) {
    if (!rule.autoGenerate) continue;
    if (existingRuleIds.has(rule.id)) continue; // idempotent
    const offsetDays = rule.offsetDays ?? 0;
    let dueAt: Date | null = null;
    if (wo.scheduledDate) {
      dueAt = new Date(wo.scheduledDate);
      dueAt.setDate(dueAt.getDate() - offsetDays);
    }
    const pt = await storage.createPreTask({
      tenantId,
      workOrderId,
      title: rule.title,
      description: rule.description ?? null,
      preTaskType: rule.preTaskType ?? null,
      status: "pending",
      dueOffsetDays: offsetDays,
      dueAt,
      isGenerated: true,
      sourceRule: rule.id,
      metadata: {},
    });
    created.push(pt);
  }
  return created;
}

// =============================================================================
// 6. Materialisera återkommande personliga scheman
// =============================================================================

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function materializeSchedulesForPlan(
  tenantId: string,
  weeklyPlanId: string,
): Promise<{ created: PersonalTask[] }> {
  const plan = await storage.getWeeklyPlan(tenantId, weeklyPlanId);
  if (!plan) return { created: [] };

  const weekStart = getStartOfISOWeek(plan.year, plan.weekNumber); // måndag
  const schedules = await storage.getPersonalTaskSchedules(tenantId, { activeOnly: true });
  const applicable = schedules.filter((s) => s.teamId == null || s.teamId === plan.teamId);

  const existing = await storage.getPersonalTasks(tenantId, { weeklyPlanId });
  const existingKeys = new Set(
    existing
      .filter((e) => e.sourceRule)
      .map((e) => `${e.sourceRule}::${e.plannedDate ?? ""}`),
  );

  const created: PersonalTask[] = [];
  for (const sched of applicable) {
    // dayOfWeek: 0=mån..6=sön. Null = alla arbetsdagar (mån-fre = 0..4).
    const days = sched.dayOfWeek != null ? [sched.dayOfWeek] : [0, 1, 2, 3, 4];
    for (const dow of days) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + dow);
      const plannedDate = toISODate(date);
      const key = `${sched.id}::${plannedDate}`;
      if (existingKeys.has(key)) continue; // idempotent

      let startAt: Date | null = null;
      let endAt: Date | null = null;
      if (sched.startTime) {
        const [hh, mm] = sched.startTime.split(":").map((x) => parseInt(x, 10));
        startAt = new Date(date);
        startAt.setHours(hh || 0, mm || 0, 0, 0);
        if (sched.durationMinutes) {
          endAt = new Date(startAt.getTime() + sched.durationMinutes * 60000);
        }
      }

      const effectiveMinutes = personalTaskMinutes({
        durationMinutes: sched.durationMinutes ?? null,
        startAt,
        endAt,
      } as any);
      const { articleId, cachedCostOre } = await resolvePersonalTaskArticleFields(
        tenantId,
        sched.timeCategory,
        effectiveMinutes,
      );
      const pt = await storage.createPersonalTask({
        tenantId,
        weeklyPlanId,
        teamId: plan.teamId,
        timeCategory: sched.timeCategory,
        title: sched.title,
        description: sched.description ?? null,
        plannedDate,
        startAt,
        endAt,
        durationMinutes: sched.durationMinutes ?? null,
        isCommute: sched.isCommute,
        locationLat: sched.locationLat ?? null,
        locationLng: sched.locationLng ?? null,
        locationName: sched.locationName ?? null,
        isGenerated: true,
        sourceRule: sched.id,
        articleId,
        cachedCostOre,
        metadata: {},
      });
      created.push(pt);
      existingKeys.add(key);
    }
  }

  await recomputeWeeklyPlan(tenantId, weeklyPlanId);
  return { created };
}
