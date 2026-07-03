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
import { and, eq, inArray } from "drizzle-orm";
import { workOrders } from "@shared/schema";
import { storage } from "../storage";
import {
  getRouteSummary,
  isGeoapifyRoutingAvailable,
} from "../services/routing";
import { haversineDistanceKm } from "../distance-matrix-service";
import { getStartOfISOWeek } from "../routes/helpers";
import type {
  WeeklyPlan,
  WeeklyPlanTask,
  PersonalTask,
  TravelTimeEntry,
  WeeklyPlanWarning,
  PreTask,
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

function resolveConfig(plan: WeeklyPlan): PlanEngineConfig {
  const override = (plan.metadata as Record<string, unknown> | null)?.["config"];
  if (override && typeof override === "object") {
    return { ...DEFAULT_PLAN_ENGINE_CONFIG, ...(override as Partial<PlanEngineConfig>) };
  }
  return DEFAULT_PLAN_ENGINE_CONFIG;
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
  taskCount: number;
  // KPI
  contractedHours: number;
  producedHours: number;
  workedHours: number;
  utilizationRate: number; // producerade / avtalade
  planningRate: number; // arbetade / avtalade
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

function personalTaskMinutes(t: PersonalTask): number {
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
): WeeklyPlanSummary {
  let totalProductionMinutes = 0;
  let totalValue = 0;
  for (const t of tasks) {
    const facts = workOrderFacts.get(t.taskId);
    const minutes = t.productionMinutes ?? facts?.productionMinutes ?? 0;
    totalProductionMinutes += minutes;
    totalValue += facts?.cachedValue ?? 0;
  }

  let personalTravel = 0;
  let personalCommute = 0;
  let totalBreakMinutes = 0;
  let totalPersonalMinutes = 0;
  let totalRestNightMinutes = 0;
  let totalRestWeekendMinutes = 0;
  let totalOvertimeMinutes = 0;
  for (const pt of personalTasks) {
    const minutes = personalTaskMinutes(pt);
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
    taskCount: tasks.length,
    contractedHours,
    producedHours: round2(producedHours),
    workedHours: round2(workedHours),
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

/**
 * Räknar om distans/restid/kostnad för alla travel_time_entries i en plan via
 * routing-tjänsten (Geoapify) med haversine-fallback. CO2 aggregeras till
 * planens metadata (travel_time_entries saknar egen co2-kolumn).
 */
export async function recomputeTravelForPlan(
  tenantId: string,
  weeklyPlanId: string,
  config: PlanEngineConfig,
): Promise<{ updated: number; totalKm: number; totalCostOre: number; totalCo2Kg: number }> {
  const entries = await storage.getTravelTimeEntries(tenantId, weeklyPlanId);
  const taskIds = new Set<string>();
  for (const e of entries) {
    if (e.fromTaskId) taskIds.add(e.fromTaskId);
    if (e.toTaskId) taskIds.add(e.toTaskId);
  }
  const facts = await loadWorkOrderFacts(tenantId, Array.from(taskIds));

  let updated = 0;
  let totalKm = 0;
  let totalCostOre = 0;
  const routingAvailable = isGeoapifyRoutingAvailable();

  for (const entry of entries) {
    const coords = resolveEntryCoords(entry, facts);
    if (!coords) continue;

    let distanceKm: number | null = null;
    let travelMinutes: number | null = null;
    let source = "estimate";

    if (routingAvailable) {
      const summary = await getRouteSummary([
        { lat: coords.fromLat, lng: coords.fromLng },
        { lat: coords.toLat, lng: coords.toLng },
      ]);
      if (summary) {
        distanceKm = summary.distanceKm;
        travelMinutes = Math.round(summary.durationMinutes);
        source = "geoapify";
      }
    }
    if (distanceKm == null) {
      distanceKm = haversineDistanceKm(coords.fromLat, coords.fromLng, coords.toLat, coords.toLng);
      travelMinutes = Math.round((distanceKm / config.defaultSpeedKmh) * 60);
      source = "estimate";
    }

    const travelCost = Math.round(distanceKm * config.costPerKmOre);
    totalKm += distanceKm;
    totalCostOre += travelCost;

    await storage.updateTravelTimeEntry(tenantId, entry.id, {
      fromLat: coords.fromLat,
      fromLng: coords.fromLng,
      toLat: coords.toLat,
      toLng: coords.toLng,
      distanceKm: round2(distanceKm),
      travelMinutes: travelMinutes ?? 0,
      travelCost,
      source,
    });
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
  const config = resolveConfig(plan);

  if (opts?.recomputeTravel) {
    await recomputeTravelForPlan(tenantId, weeklyPlanId, config);
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

  const summary = computeWeeklyPlanSummary(plan, tasks, personalTasks, travelEntries, facts, config);

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
        contractedHours: summary.contractedHours,
        utilizationRate: summary.utilizationRate,
        planningRate: summary.planningRate,
        billingRate: summary.billingRate,
        travelShare: summary.travelShare,
        productivity: summary.productivity,
        weekTotalMinutes: summary.weekTotalMinutes,
        within168h: summary.within168h,
        overContracted: summary.overContracted,
        estimatedKm: summary.estimatedKm,
        estimatedCo2Kg: summary.estimatedCo2Kg,
        totalRestNightMinutes: summary.totalRestNightMinutes,
        totalRestWeekendMinutes: summary.totalRestWeekendMinutes,
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
  const updated = await storage.updatePersonalTask(tenantId, personalTaskId, {
    timeCategory: opts.toCategory,
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
        metadata: {},
      });
      created.push(pt);
      existingKeys.add(key);
    }
  }

  await recomputeWeeklyPlan(tenantId, weeklyPlanId);
  return { created };
}
