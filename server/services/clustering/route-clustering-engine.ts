/**
 * Ruttklumpningsmotorn (ADR Klumpning v1).
 *
 * Strategisk motor: besvarar frågan "vilken dag bör bilen åka hit?"
 * — inte "vad kan vi utföra när bilen ändå är här?" (stoppmotor).
 *
 * En uppgift kan ingå i en ruttklump om:
 *   1. Geografisk — inom konfigurerbar ruttradie (default 40 km) från klumpens tyngdpunkt
 *   2. Tidsmässig — uppgiftens leveransfönster överlappar klumpens period
 *   3. Utförarmässig — exakt samma execution_code (null===null OK)
 *   4. Kapacitetsmässig — klumpens totala produktionstid + restid ryms i ett arbetspass
 *
 * Precision baserat på tidshorisont:
 *   high   (≤30d)  – hög precision, tät omräkning via trigger
 *   medium (30–90d) – medel, daglig schemalagd körning
 *   low    (>90d)  – låg, veckovis schemalagd körning
 *
 * Statusflöde (per klump):
 *   active    – motorns beslut; skrivs över fritt vid omräkning
 *   confirmed – planeraren bekräftat; ÄNDRAS ALDRIG automatiskt
 *   locked    – hoppas ALLTID över vid automatisk omräkning
 *   dissolved – upplöst (historisk)
 */
import { db } from "../../db";
import { storage } from "../../storage";
import {
  routeClusters,
  routeClusterMemberships,
  workOrders,
  taskEvents,
  tenants,
  type RouteCluster,
  type WorkOrder,
} from "@shared/schema";
import { eq, and, isNull, notInArray, inArray, gte, lte, or, sql } from "drizzle-orm";
import { haversineDistanceKm } from "../../distance-matrix-service";
import { getMapProvider } from "../mapProvider";

// ---------------------------------------------------------------------------
// Typer
// ---------------------------------------------------------------------------

export interface RouteClusterWeights {
  stopCount: number;          // belönar fler stopp (tätare rutt)
  productionMinutes: number;  // belönar högre kapacitetsutnyttjande
  travelMinutes: number;      // straffar lång restid (sätt negativ vikt)
  executionCodeMatch: number; // belönar homogen utförandekod
  deliveryPriority: number;   // belönar prioriterade leveranser
  weekloadBalance: number;    // straffar överlastade veckor
}

export const DEFAULT_ROUTE_WEIGHTS: RouteClusterWeights = {
  stopCount: 2.0,
  productionMinutes: 1.0,
  travelMinutes: -0.5,
  executionCodeMatch: 3.0,
  deliveryPriority: 2.5,
  weekloadBalance: -1.0,
};

export interface RouteClusterMatch {
  cluster: RouteCluster;
  distanceKm: number | null;
  score: number;
  precision: "high" | "medium" | "low";
  matchReasons: Array<"geo" | "time" | "execution_code" | "capacity">;
}

export interface RouteClustering {
  created: number;
  dissolved: number;
  assigned: number;
  unchanged: number;
  lockedSkipped: number;
  confirmedSkipped: number;
  errors: string[];
  durationMs: number;
}

interface TaskGeo {
  latitude: number | null;
  longitude: number | null;
}

interface TaskWindow {
  start: Date | null;
  end: Date | null;
}

interface ActiveTask {
  id: string;
  taskTable: "work_orders";
  tenantId: string;
  executionCode: string | null;
  geo: TaskGeo;
  window: TaskWindow;
  estimatedDurationMinutes: number | null;
}

interface TenantRouteConfig {
  radiusKm: number;
  maxWorkMinutes: number;
  horizonDays: number;
  scheduleHour: number;
}

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

async function getRouteConfig(tenantId: string): Promise<TenantRouteConfig> {
  const tenant = await storage.getTenant(tenantId);
  const s = (tenant?.settings as Record<string, unknown>) ?? {};
  return {
    radiusKm: Number(s.route_cluster_radius_km ?? 40),
    maxWorkMinutes: Number(s.route_cluster_max_work_minutes ?? 480),
    horizonDays: Number(s.route_cluster_horizon_days ?? 365),
    scheduleHour: Number(s.route_cluster_schedule_daily_hour ?? 2),
  };
}

function windowsOverlap(a: TaskWindow, b: TaskWindow): boolean {
  const aS = a.start?.getTime() ?? -Infinity;
  const aE = a.end?.getTime() ?? Infinity;
  const bS = b.start?.getTime() ?? -Infinity;
  const bE = b.end?.getTime() ?? Infinity;
  return aS <= bE && bS <= aE;
}

function isActiveForPlanning(wo: WorkOrder): boolean {
  if (wo.deletedAt != null) return false;
  const inactive = ["makulerad", "fakturerad", "simulerad"];
  if (inactive.includes(wo.orderStatus ?? "")) return false;
  if (wo.impossibleReason != null) return false;
  return true;
}

function getEffectiveWindow(wo: WorkOrder): TaskWindow {
  if (wo.plannedWindowStart || wo.plannedWindowEnd) {
    return {
      start: wo.plannedWindowStart ? new Date(wo.plannedWindowStart) : null,
      end: wo.plannedWindowEnd ? new Date(wo.plannedWindowEnd) : null,
    };
  }
  return {
    start: wo.desiredDeliveryStart ? new Date(wo.desiredDeliveryStart) : null,
    end: wo.desiredDeliveryEnd ? new Date(wo.desiredDeliveryEnd) : null,
  };
}

function computeCentroid(
  coords: Array<{ lat: number; lng: number }>,
): { latitude: number; longitude: number } | null {
  const valid = coords.filter((c) => isFinite(c.lat) && isFinite(c.lng));
  if (valid.length === 0) return null;
  return {
    latitude: valid.reduce((s, c) => s + c.lat, 0) / valid.length,
    longitude: valid.reduce((s, c) => s + c.lng, 0) / valid.length,
  };
}

/**
 * Precision baseras på hur långt bort i tid den TIDLIGASTE uppgiften i klumpen är.
 */
export function derivePrecision(
  earliestWindow: Date | null,
): "high" | "medium" | "low" {
  if (!earliestWindow) return "medium";
  const daysAway = (earliestWindow.getTime() - Date.now()) / 86_400_000;
  if (daysAway <= 30) return "high";
  if (daysAway <= 90) return "medium";
  return "low";
}

/** Formaterar ett datum som ISO-vecka: "v.43" */
function formatIsoWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return `v.${weekNum}`;
}

/** Uppskattar total restid (haversine-kedja) i minuter för en lista stopp. */
function estimateTravelMinutes(
  coords: Array<{ lat: number; lng: number }>,
  speedKmh = 50,
): number {
  if (coords.length < 2) return 0;
  let totalKm = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    totalKm += haversineDistanceKm(
      coords[i].lat,
      coords[i].lng,
      coords[i + 1].lat,
      coords[i + 1].lng,
    );
  }
  return Math.round((totalKm / speedKmh) * 60);
}

async function mintRouteClusterReference(tenantId: string): Promise<string> {
  const result = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(routeClusters)
    .where(eq(routeClusters.tenantId, tenantId));
  const n = Number(result[0]?.cnt ?? 0) + 1;
  return `RC-${String(n).padStart(3, "0")}`;
}

function isProtectedStatus(status: string | null | undefined): boolean {
  return status === "locked" || status === "confirmed";
}

async function logRouteClusterEvent(
  tenantId: string,
  workOrderId: string,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(taskEvents).values({
      tenantId,
      workOrderId,
      eventType,
      actorType: "system",
      actorId: null,
      detail,
      occurredAt: new Date(),
    });
  } catch {
    // best-effort — logga inte vidare om task_events write misslyckas
  }
}

// ---------------------------------------------------------------------------
// Publika API
// ---------------------------------------------------------------------------

/**
 * Reverse geocoding → klumpnamn.
 * Enkel ort: "Nynäshamn"
 * Multi-ort: "Stad1–Stad2" (om tyngdpunkten betjänar flera städer)
 * Fallback: "Ruttklump YYYY-MM-DD"
 */
export async function buildRouteClusterName(
  centerLat: number,
  centerLng: number,
  tenantId: string,
): Promise<string> {
  try {
    const result = await getMapProvider().reverseGeocode(
      centerLat,
      centerLng,
      tenantId,
    );
    if (result?.city) return result.city;
    if (result?.address) {
      const parts = result.address.split(",");
      const candidate = parts[1]?.trim() || parts[0]?.trim();
      if (candidate) return candidate;
    }
  } catch {
    // Geocoding-fel ska inte stoppa klustringsprocessen
  }
  return `Ruttklump ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Poängsätter ett datum baserat på klumpkandidater och konfigurerbara vikter.
 * Deterministisk för identisk input.
 *
 * Kallas av planeraren för att avgöra vilken dag en klump bör läggas ut.
 */
export function scoreDay(
  date: Date,
  clusterCandidates: RouteCluster[],
  weights: RouteClusterWeights = DEFAULT_ROUTE_WEIGHTS,
): number {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const relevant = clusterCandidates.filter((c) => {
    if (!c.earliestDeliveryAt && !c.latestDeliveryAt) return true;
    const cStart = c.earliestDeliveryAt
      ? new Date(c.earliestDeliveryAt)
      : new Date(0);
    const cEnd = c.latestDeliveryAt
      ? new Date(c.latestDeliveryAt)
      : new Date(8640000000000000);
    return cStart <= dayEnd && dayStart <= cEnd;
  });

  if (relevant.length === 0) return 0;

  let score = 0;

  // weekloadBalance: straffar för många klumpar på samma dag
  score += relevant.length * weights.weekloadBalance;

  // executionCodeMatch: bonus om alla klumpar på dagen har SAMMA utförandekod
  const codes = new Set(relevant.map((c) => c.executionCode));
  if (codes.size === 1) {
    score += weights.executionCodeMatch;
  }

  for (const c of relevant) {
    const workMin = c.calculatedWorkMinutes ?? 0;
    const travelMin = c.calculatedTravelMinutes ?? 0;

    // Membercount approximation from stored work minutes (best-effort utan DB-query)
    const stopCountApprox = Math.max(1, Math.round(workMin / 60));

    // deliveryPriority: high = tidskritisk = bonus; low = låg prio
    const priorityFactor =
      c.precisionLevel === "high" ? 1.0 :
      c.precisionLevel === "medium" ? 0.5 :
      0.0;

    score +=
      stopCountApprox * weights.stopCount +
      workMin * weights.productionMinutes +
      travelMin * weights.travelMinutes +
      priorityFactor * weights.deliveryPriority;
  }

  return score;
}

/**
 * Analyserar EN uppgift mot befintliga ruttklumpar (skrivskyddad, inkrementell).
 * Returnerar alla matchande klumpar sorterade efter score.
 *
 * Villkor (alla fyra måste uppfyllas):
 *   1. Exakt execution_code-matchning (null===null OK)
 *   2. Tidsfönsteröverlapp mot klumpens period (union-fönster)
 *   3. Geo: inom radiusKm från klumpens tyngdpunkt
 *   4. Kapacitet: rymmer i ett arbetspass
 */
export async function analyzeTask(
  taskId: string,
  tenantId: string,
): Promise<RouteClusterMatch[]> {
  const wo = await storage.getWorkOrder(taskId);
  if (!wo || wo.tenantId !== tenantId) return [];
  if (!isActiveForPlanning(wo)) return [];

  const config = await getRouteConfig(tenantId);
  const taskGeo: TaskGeo = {
    latitude: wo.taskLatitude ?? null,
    longitude: wo.taskLongitude ?? null,
  };
  const taskWindow = getEffectiveWindow(wo);

  const clusters = await db
    .select()
    .from(routeClusters)
    .where(
      and(
        eq(routeClusters.tenantId, tenantId),
        notInArray(routeClusters.status, ["dissolved"]),
      ),
    );

  const matches: RouteClusterMatch[] = [];

  for (const cluster of clusters) {
    const reasons: RouteClusterMatch["matchReasons"] = [];

    // Villkor 1: Exakt execution_code-matchning
    if (cluster.executionCode !== wo.executionCode) continue;
    if (wo.executionCode !== null) reasons.push("execution_code");

    // Villkor 2: Tidsfönsteröverlapp mot klumpens period
    const clusterWindow: TaskWindow = {
      start: cluster.earliestDeliveryAt
        ? new Date(cluster.earliestDeliveryAt)
        : null,
      end: cluster.latestDeliveryAt
        ? new Date(cluster.latestDeliveryAt)
        : null,
    };
    if (!windowsOverlap(taskWindow, clusterWindow)) continue;
    reasons.push("time");

    // Villkor 3: Geo inom radiusKm
    // Strikt regel: uppgift utan geo kan INTE gå med i en geo-bunden klump.
    let distanceKm: number | null = null;
    const taskHasGeo = taskGeo.latitude != null && taskGeo.longitude != null;
    const clusterHasGeo =
      cluster.centerLatitude != null && cluster.centerLongitude != null;

    if (taskHasGeo && clusterHasGeo) {
      distanceKm = haversineDistanceKm(
        taskGeo.latitude!,
        taskGeo.longitude!,
        cluster.centerLatitude!,
        cluster.centerLongitude!,
      );
      if (distanceKm > config.radiusKm) continue;
      reasons.push("geo");
    } else if (!taskHasGeo && clusterHasGeo) {
      // Uppgift saknar position → kan ej validera geo mot klumpens radie → hoppa
      continue;
    } else {
      // Klumpen har ingen centroid (alla utan geo) → geo-villkoret ej tillämpbart
      reasons.push("geo");
    }

    // Villkor 4: Kapacitetskontroll
    const taskWork = wo.estimatedDuration ?? 0;
    const currentWork = cluster.calculatedWorkMinutes ?? 0;
    const currentTravel = cluster.calculatedTravelMinutes ?? 0;
    if (currentWork + currentTravel + taskWork > config.maxWorkMinutes) continue;
    reasons.push("capacity");

    const precision = derivePrecision(
      cluster.earliestDeliveryAt ? new Date(cluster.earliestDeliveryAt) : null,
    );

    // Beräkna score för denna klump (normaliserad mot maxWorkMinutes)
    const utilizationScore =
      (currentWork + taskWork) / config.maxWorkMinutes;
    const travelPenalty =
      distanceKm != null ? (distanceKm / config.radiusKm) * 2 : 0;
    const score = utilizationScore * 10 - travelPenalty;

    matches.push({ cluster, distanceKm, score, precision, matchReasons: reasons });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

/**
 * Fullständig rullande omräkning för en tenant.
 * Berör ENBART `active`-klumpar inom det angivna tidsbandet.
 * `confirmed` och `locked` klumpar hoppas alltid över.
 *
 * @param horizonDays  Övre gräns för tidsband (default: config.horizonDays).
 * @param minHorizonDays  Undre gräns för tidsband (default: 0 = inga near-term klumpar
 *                        undantas). Skicka 30 för daglig körning för att slippa
 *                        röra klumpar som klusteringskön hanterar.
 */
export async function runRollingAnalysis(
  tenantId: string,
  horizonDays?: number,
  minHorizonDays = 0,
): Promise<RouteClustering> {
  const t0 = Date.now();
  const config = await getRouteConfig(tenantId);
  const effectiveHorizon = horizonDays ?? config.horizonDays;
  const now = new Date();
  const horizon = new Date(now.getTime() + effectiveHorizon * 86_400_000);
  const bandStart =
    minHorizonDays > 0
      ? new Date(now.getTime() + minHorizonDays * 86_400_000)
      : new Date(0);

  const result: RouteClustering = {
    created: 0,
    dissolved: 0,
    assigned: 0,
    unchanged: 0,
    lockedSkipped: 0,
    confirmedSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  // 1. Lös upp ENBART active-klumpar inom tidsbandet.
  //    Klumpar utanför bandet (t.ex. lång horisont vid daglig körning) rörs ej.
  const activeClusters = await db
    .select({ id: routeClusters.id })
    .from(routeClusters)
    .where(
      and(
        eq(routeClusters.tenantId, tenantId),
        eq(routeClusters.status, "active"),
        // Inkludera bara klumpar vars planeringsperiod faller i vårt band
        or(
          isNull(routeClusters.earliestDeliveryAt),
          and(
            gte(routeClusters.earliestDeliveryAt, bandStart),
            lte(routeClusters.earliestDeliveryAt, horizon),
          ),
        ),
      ),
    );
  const activeClusterIds = activeClusters.map((c) => c.id);

  if (activeClusterIds.length > 0) {
    await db
      .update(routeClusterMemberships)
      .set({ removedAt: now, removalReason: "recluster" })
      .where(
        and(
          eq(routeClusterMemberships.tenantId, tenantId),
          inArray(routeClusterMemberships.routeClusterId, activeClusterIds),
          isNull(routeClusterMemberships.removedAt),
        ),
      );
    await db
      .update(workOrders)
      .set({ routeClusterId: null, routeClusterCalculatedAt: now })
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          inArray(workOrders.routeClusterId, activeClusterIds),
        ),
      );
    await db
      .update(routeClusters)
      .set({ status: "dissolved", dissolvedAt: now, updatedAt: now })
      .where(inArray(routeClusters.id, activeClusterIds));
    result.dissolved = activeClusterIds.length;
  }

  // 2. Hämta alla aktiva WO inom horizon
  const eligibleWos = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        isNull(workOrders.impossibleReason),
        notInArray(workOrders.orderStatus, [
          "makulerad",
          "fakturerad",
          "simulerad",
        ]),
        gte(
          sql`coalesce(${workOrders.plannedWindowEnd}, ${workOrders.desiredDeliveryEnd}, now())`,
          now,
        ),
      ),
    );

  const tasks: ActiveTask[] = [];
  for (const wo of eligibleWos) {
    try {
      // WO i confirmed/locked klumpar hoppas över
      if (wo.routeClusterId) {
        const rc = await db.query.routeClusters.findFirst({
          where: eq(routeClusters.id, wo.routeClusterId),
          columns: { status: true },
        });
        if (rc?.status === "locked") {
          result.lockedSkipped++;
          continue;
        }
        if (rc?.status === "confirmed") {
          result.confirmedSkipped++;
          continue;
        }
      }

      const window = getEffectiveWindow(wo as WorkOrder);
      const taskEnd = window.end ?? window.start ?? null;
      if (taskEnd && taskEnd > horizon) continue;
      // Undanta uppgifter som faller UNDER det undre bandet (hanteras av annan körning)
      const taskStart = window.start ?? null;
      if (taskStart && minHorizonDays > 0 && taskStart < bandStart) continue;

      const geo: TaskGeo = {
        latitude: wo.taskLatitude ?? null,
        longitude: wo.taskLongitude ?? null,
      };

      tasks.push({
        id: wo.id,
        taskTable: "work_orders",
        tenantId,
        executionCode: wo.executionCode,
        geo,
        window,
        estimatedDurationMinutes: wo.estimatedDuration ?? null,
      });
    } catch (err) {
      result.errors.push(
        `WO ${wo.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Greedy-klustring med kapacitetskontroll
  interface RouteBucket {
    tasks: ActiveTask[];
    centroidCoords: Array<{ lat: number; lng: number }>;
    centroid: { lat: number; lng: number } | null;
    window: TaskWindow; // union av alla members
    executionCode: string | null;
    totalWorkMinutes: number;
    estimatedTravelMinutes: number;
  }

  const buckets: RouteBucket[] = [];

  for (const task of tasks) {
    let placed = false;

    for (const bucket of buckets) {
      // Villkor 1: Exakt execution_code
      if (bucket.executionCode !== task.executionCode) continue;

      // Villkor 2: Tidsfönsteröverlapp (union-fönster)
      if (!windowsOverlap(task.window, bucket.window)) continue;

      // Villkor 3: Geo inom radiusKm
      // Strikt: uppgift utan geo kan INTE gå med i en geo-bunden bucket.
      const taskHasGeo =
        task.geo.latitude != null && task.geo.longitude != null;
      const bucketHasGeo = bucket.centroid != null;

      if (taskHasGeo && bucketHasGeo) {
        const dist = haversineDistanceKm(
          bucket.centroid!.lat,
          bucket.centroid!.lng,
          task.geo.latitude!,
          task.geo.longitude!,
        );
        if (dist > config.radiusKm) continue;
      } else if (!taskHasGeo && bucketHasGeo) {
        // Uppgift saknar position → kan ej validera radie → hoppa
        continue;
      }
      // Båda saknar geo → geo-villkor ej tillämpbart → OK

      // Villkor 4: Kapacitetskontroll
      const newWork = bucket.totalWorkMinutes + (task.estimatedDurationMinutes ?? 0);
      const newCoords = [
        ...bucket.centroidCoords,
        ...(task.geo.latitude != null && task.geo.longitude != null
          ? [{ lat: task.geo.latitude, lng: task.geo.longitude }]
          : []),
      ];
      const newTravel = estimateTravelMinutes(newCoords);
      if (newWork + newTravel > config.maxWorkMinutes) continue;

      // Lägg till i bucket
      bucket.tasks.push(task);
      if (task.geo.latitude != null && task.geo.longitude != null) {
        bucket.centroidCoords.push({
          lat: task.geo.latitude,
          lng: task.geo.longitude,
        });
        // Uppdatera centroid (löpande medelvärde)
        const c = computeCentroid(bucket.centroidCoords);
        bucket.centroid = c ? { lat: c.latitude, lng: c.longitude } : null;
      }

      // Expandera union-fönster
      if (
        task.window.start &&
        (!bucket.window.start || task.window.start < bucket.window.start)
      ) {
        bucket.window.start = task.window.start;
      }
      if (
        task.window.end &&
        (!bucket.window.end || task.window.end > bucket.window.end)
      ) {
        bucket.window.end = task.window.end;
      }

      bucket.totalWorkMinutes = newWork;
      bucket.estimatedTravelMinutes = newTravel;
      placed = true;
      break;
    }

    if (!placed) {
      const initCoords =
        task.geo.latitude != null && task.geo.longitude != null
          ? [{ lat: task.geo.latitude, lng: task.geo.longitude }]
          : [];
      buckets.push({
        tasks: [task],
        centroidCoords: initCoords,
        centroid:
          initCoords.length > 0
            ? { lat: initCoords[0].lat, lng: initCoords[0].lng }
            : null,
        window: { ...task.window },
        executionCode: task.executionCode,
        totalWorkMinutes: task.estimatedDurationMinutes ?? 0,
        estimatedTravelMinutes: 0,
      });
    }
  }

  // 4. Skapa ruttklumpar för varje bucket
  for (const bucket of buckets) {
    try {
      const centroid = bucket.centroid;
      const precision = derivePrecision(bucket.window.start);

      let displayName = `Ruttklump ${now.toISOString().slice(0, 10)}`;
      if (centroid) {
        displayName = await buildRouteClusterName(
          centroid.lat,
          centroid.lng,
          tenantId,
        );
      }

      const referenceNumber = await mintRouteClusterReference(tenantId);

      const [newCluster] = await db
        .insert(routeClusters)
        .values({
          tenantId,
          referenceNumber,
          displayName,
          centerLatitude: centroid?.lat ?? null,
          centerLongitude: centroid?.lng ?? null,
          radiusKilometers: config.radiusKm,
          executionCode: bucket.executionCode,
          earliestDeliveryAt: bucket.window.start,
          latestDeliveryAt: bucket.window.end,
          calculatedWorkMinutes: bucket.totalWorkMinutes || null,
          calculatedTravelMinutes: bucket.estimatedTravelMinutes || null,
          precisionLevel: precision,
          status: "active",
          clusteringRuleVersion: "v1",
          lastCalculatedAt: now,
          updatedAt: now,
        })
        .returning();

      result.created++;

      // Membership + WO-uppdateringar
      for (const task of bucket.tasks) {
        await db.insert(routeClusterMemberships).values({
          tenantId,
          routeClusterId: newCluster.id,
          taskId: task.id,
          taskTable: task.taskTable,
          assignedAt: now,
        });
      }

      const woIds = bucket.tasks
        .filter((t) => t.taskTable === "work_orders")
        .map((t) => t.id);

      if (woIds.length > 0) {
        await db
          .update(workOrders)
          .set({ routeClusterId: newCluster.id, routeClusterCalculatedAt: now })
          .where(
            and(
              eq(workOrders.tenantId, tenantId),
              inArray(workOrders.id, woIds),
            ),
          );

        // Logga till task_events (first WO som representant för klumpen)
        await logRouteClusterEvent(
          tenantId,
          woIds[0],
          "route_cluster_assigned",
          {
            clusterId: newCluster.id,
            clusterName: displayName,
            precision,
            taskCount: bucket.tasks.length,
            source: "rolling_analysis",
          },
        );
      }

      result.assigned += bucket.tasks.length;
    } catch (err) {
      result.errors.push(
        `bucket[${bucket.tasks.map((t) => t.id).join(",")}]: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  result.durationMs = Date.now() - t0;
  return result;
}

/** Hämtar alla aktiva tenanter. */
export async function getAllTenantIds(): Promise<string[]> {
  const rows = await db.select({ id: tenants.id }).from(tenants);
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Inkrementell near-term-klustring (trigger-driven via kö)
// ---------------------------------------------------------------------------

/**
 * Tar bort en uppgift från ett ruttklump (intern helper).
 * Stämplar removedAt på membership-raden och nullar routeClusterId på WO.
 */
async function removeWoFromRouteCluster(
  taskId: string,
  tenantId: string,
  clusterId: string,
  reason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(routeClusterMemberships)
    .set({ removedAt: now, removalReason: reason })
    .where(
      and(
        eq(routeClusterMemberships.taskId, taskId),
        eq(routeClusterMemberships.routeClusterId, clusterId),
        eq(routeClusterMemberships.tenantId, tenantId),
        isNull(routeClusterMemberships.removedAt),
      ),
    );
  await db
    .update(workOrders)
    .set({ routeClusterId: null, routeClusterCalculatedAt: now })
    .where(and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)));
}

/**
 * Inkrementell ruttklumpningstilldelning för en enskild uppgift.
 *
 * Anropas av klusteringskön när en uppgift skapas/ändras (near-term trigger).
 * Hanterar bara uppgifter vars leveransfönster faller inom de närmaste 30 dagarna
 * (high precision) — längre horisonter hanteras av daglig/veckovis scheduler.
 *
 * Flöde:
 *   1. Hämta WO; skippa om ej aktiv.
 *   2. Protected cluster (confirmed/locked) → hoppa.
 *   3. Ta bort från nuvarande active cluster (om det finns).
 *   4. Kör analyzeTask → tilldela till bäst matchande klump.
 *   5. Ingen match → lämna utan klump (scheduler skapar ny vid nästa körning).
 */
export async function processRouteTask(
  taskId: string,
  tenantId: string,
): Promise<{
  action: "assigned" | "removed" | "unchanged" | "skipped";
  clusterId?: string;
}> {
  const wo = await storage.getWorkOrder(taskId);
  if (!wo || wo.tenantId !== tenantId) return { action: "skipped" };
  if (!isActiveForPlanning(wo)) {
    // Inaktiv uppgift → ta bort från active cluster om tilldelad
    if (wo.routeClusterId) {
      const existing = await db.query.routeClusters.findFirst({
        where: eq(routeClusters.id, wo.routeClusterId),
        columns: { status: true },
      });
      if (existing?.status === "active") {
        await removeWoFromRouteCluster(taskId, tenantId, wo.routeClusterId, "task_inactive");
        return { action: "removed" };
      }
    }
    return { action: "skipped" };
  }

  // Kontrollera om uppgiftens leveransfönster är near-term (≤30 dagar).
  // Längre horisonter hanteras exklusivt av den schemalagda körningen.
  const window = getEffectiveWindow(wo);
  const nearTermCutoff = new Date();
  nearTermCutoff.setDate(nearTermCutoff.getDate() + 30);
  const woStart = window.start ?? window.end ?? null;
  if (woStart && woStart > nearTermCutoff) {
    // Utanför near-term-band — triggerbaserad omräkning hoppar; scheduler tar hand om det.
    return { action: "unchanged" };
  }

  // Protected cluster → lämna orörd
  if (wo.routeClusterId) {
    const existing = await db.query.routeClusters.findFirst({
      where: eq(routeClusters.id, wo.routeClusterId),
      columns: { status: true },
    });
    if (isProtectedStatus(existing?.status)) return { action: "skipped" };
    // Active cluster → ta bort för att möjliggöra omplacering
    await removeWoFromRouteCluster(taskId, tenantId, wo.routeClusterId, "recluster");
  }

  // Kör analys — tilldela till bäst matchande klump
  const matches = await analyzeTask(taskId, tenantId);
  const best = matches[0];
  if (!best) return { action: "unchanged" };

  const now = new Date();
  await db.insert(routeClusterMemberships).values({
    tenantId,
    routeClusterId: best.cluster.id,
    taskId,
    taskTable: "work_orders",
    assignedAt: now,
  });
  await db
    .update(workOrders)
    .set({ routeClusterId: best.cluster.id, routeClusterCalculatedAt: now })
    .where(and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)));

  return { action: "assigned", clusterId: best.cluster.id };
}
