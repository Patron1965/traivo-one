/**
 * Stoppklumpningsmotorn (ADR Klumpning v1).
 *
 * Identifierar uppgifter (work_orders + assignments) som kan utföras vid samma
 * fysiska stopp baserat på fyra villkor:
 *   1. Geografisk — koordinater inom konfigurerbar radie (default 30 m)
 *   2. Tidsmässig — leveranstidsfönster överlappar (STRIKT överlapp)
 *   3. Utförarmässig — exakt samma execution_code (null === null är OK;
 *                      null !== "kod" → hoppas över)
 *   4. Statusmässig — uppgiften är aktiv för planering
 *
 * Låsningslogik (per klump):
 *   auto      – motorns beslut; skrivs över fritt vid omräkning
 *   confirmed – planeraren bekräftat; ÄNDRAS ALDRIG automatiskt (samma skydd som locked)
 *   locked    – hoppas ALLTID över vid automatisk omräkning
 */
import { db } from "../../db";
import { storage } from "../../storage";
import {
  workOrders,
  objects,
  stopClusters,
  stopClusterMemberships,
  type WorkOrder,
  type StopCluster,
} from "@shared/schema";
import { eq, and, isNull, notInArray, inArray, gte, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Typer
// ---------------------------------------------------------------------------

export interface StopClusterMatch {
  cluster: StopCluster;
  distanceMeters: number | null;
  matchReasons: Array<"geo" | "time" | "execution_code" | "address">;
  memberCount: number;
}

export interface ClusteringResult {
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
  normalizedAddress: string | null;
  city: string | null;
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
  stopClusterId: string | null;
  stopClusterStatus: string | null;
}

// ---------------------------------------------------------------------------
// Interna hjälpfunktioner
// ---------------------------------------------------------------------------

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeAddressKey(address: string | null | undefined): string {
  if (!address) return "";
  return address.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * STRIKT tidsfönsteröverlapp — uppgifter med icke-överlappande fönster
 * hamnar ALDRIG i samma klump (jämför Acceptanskriterium 2).
 * Öppna fönster (start=null eller end=null) behandlas konservativt:
 *   null start → -∞, null end → +∞.
 */
function windowsOverlap(a: TaskWindow, b: TaskWindow): boolean {
  const aStart = a.start?.getTime() ?? -Infinity;
  const aEnd = a.end?.getTime() ?? Infinity;
  const bStart = b.start?.getTime() ?? -Infinity;
  const bEnd = b.end?.getTime() ?? Infinity;
  return aStart <= bEnd && bStart <= aEnd;
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

/** Geo-löser en work_order. Prioritet: taskLatitude/Lng → objektets lat/lng. */
async function resolveTaskGeo(wo: WorkOrder): Promise<TaskGeo> {
  if (wo.taskLatitude != null && wo.taskLongitude != null) {
    const obj = wo.objectId
      ? await db.query.objects.findFirst({
          where: eq(objects.id, wo.objectId),
          columns: { address: true, city: true },
        })
      : null;
    return {
      latitude: wo.taskLatitude,
      longitude: wo.taskLongitude,
      normalizedAddress: normalizeAddressKey(obj?.address),
      city: obj?.city ?? null,
    };
  }
  if (wo.objectId) {
    const obj = await db.query.objects.findFirst({
      where: eq(objects.id, wo.objectId),
      columns: { latitude: true, longitude: true, address: true, city: true },
    });
    return {
      latitude: obj?.latitude ?? null,
      longitude: obj?.longitude ?? null,
      normalizedAddress: normalizeAddressKey(obj?.address),
      city: obj?.city ?? null,
    };
  }
  return {
    latitude: null,
    longitude: null,
    normalizedAddress: null,
    city: null,
  };
}

interface TenantClusterConfig {
  radiusMeters: number;
  horizonDays: number;
}

async function getTenantConfig(tenantId: string): Promise<TenantClusterConfig> {
  const tenant = await storage.getTenant(tenantId);
  const settings = (tenant?.settings as Record<string, unknown>) ?? {};
  return {
    radiusMeters: Number(settings.stop_cluster_radius_meters ?? 30),
    horizonDays: Number(settings.stop_cluster_horizon_days ?? 14),
  };
}

/** Myntar nästa SC-NNN referensnummer (tenant-scoped, best-effort sekvens). */
async function mintStopClusterReference(tenantId: string): Promise<string> {
  const result = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(stopClusters)
    .where(eq(stopClusters.tenantId, tenantId));
  const n = Number(result[0]?.cnt ?? 0) + 1;
  return `SC-${String(n).padStart(3, "0")}`;
}

/** Beräknar viktad centroid (aritmetiskt medelvärde). */
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

/** Sant om klumpstatus är skyddad (blocked from auto-change). */
function isProtectedStatus(status: string | null | undefined): boolean {
  return status === "locked" || status === "confirmed";
}

// ---------------------------------------------------------------------------
// Publika API
// ---------------------------------------------------------------------------

/**
 * Bygger visningsnamn för en stoppklump.
 *   "Mekanivägen 2C, Tullinge"        (adress + stad)
 *   "Mekanivägen 2C – Miljörum västra" (adress + extra)
 */
export function buildStopClusterName(
  address: string,
  city?: string | null,
  extras?: string | null,
): string {
  const base = city ? `${address}, ${city}` : address;
  return extras ? `${base} – ${extras}` : base;
}

/**
 * Analyserar EN uppgift mot befintliga stoppklumpar (skrivskyddad, inkrementell).
 * Returnerar alla matchande klumpar sorterade efter avstånd.
 *
 * Klumpvillkor (alla tre måste uppfyllas):
 *   1. Strikt geo-matchning: koordinater inom radiusMeters ELLER exakt adress
 *   2. Strikt tidsfönsteröverlapp (ej gap-baserat)
 *   3. Exakt execution_code-matchning (null === null är OK)
 */
export async function analyzeTask(
  taskId: string,
  tenantId: string,
): Promise<StopClusterMatch[]> {
  const wo = await storage.getWorkOrder(taskId);
  if (!wo || wo.tenantId !== tenantId) return [];
  if (!isActiveForPlanning(wo)) return [];

  const config = await getTenantConfig(tenantId);
  const geo = await resolveTaskGeo(wo);
  const window = getEffectiveWindow(wo);

  const clusters = await db
    .select()
    .from(stopClusters)
    .where(
      and(
        eq(stopClusters.tenantId, tenantId),
        notInArray(stopClusters.status, ["dissolved"]),
      ),
    );

  const countRows = await db
    .select({
      stopClusterId: stopClusterMemberships.stopClusterId,
      cnt: sql<number>`count(*)`,
    })
    .from(stopClusterMemberships)
    .where(
      and(
        eq(stopClusterMemberships.tenantId, tenantId),
        isNull(stopClusterMemberships.removedAt),
      ),
    )
    .groupBy(stopClusterMemberships.stopClusterId);

  const memberCountMap = new Map<string, number>();
  for (const row of countRows) {
    memberCountMap.set(row.stopClusterId, Number(row.cnt));
  }

  const matches: StopClusterMatch[] = [];

  for (const cluster of clusters) {
    const reasons: StopClusterMatch["matchReasons"] = [];

    // Villkor 3: Exakt execution_code-matchning (null === null OK, null !== "kod")
    if (cluster.executionCode !== wo.executionCode) continue;
    if (wo.executionCode !== null) reasons.push("execution_code");

    // Villkor 2: STRIKT tidsfönsteröverlapp
    const clusterWindow: TaskWindow = {
      start: cluster.earliestDeliveryAt
        ? new Date(cluster.earliestDeliveryAt)
        : null,
      end: cluster.latestDeliveryAt
        ? new Date(cluster.latestDeliveryAt)
        : null,
    };
    if (!windowsOverlap(window, clusterWindow)) continue;
    reasons.push("time");

    // Villkor 1: Geo-matchning (koordinater inom radie ELLER exakt adress)
    let distanceMeters: number | null = null;
    let geoMatched = false;

    if (
      geo.latitude != null &&
      geo.longitude != null &&
      cluster.latitude != null &&
      cluster.longitude != null
    ) {
      distanceMeters = haversineMeters(
        geo.latitude,
        geo.longitude,
        cluster.latitude,
        cluster.longitude,
      );
      if (distanceMeters > config.radiusMeters) continue;
      reasons.push("geo");
      geoMatched = true;
    }

    if (
      !geoMatched &&
      geo.normalizedAddress &&
      cluster.normalizedAddress &&
      normalizeAddressKey(cluster.normalizedAddress) === geo.normalizedAddress
    ) {
      reasons.push("address");
      geoMatched = true;
    }

    if (!geoMatched) continue;

    matches.push({
      cluster,
      distanceMeters,
      matchReasons: reasons,
      memberCount: memberCountMap.get(cluster.id) ?? 0,
    });
  }

  matches.sort((a, b) => {
    if (a.distanceMeters == null && b.distanceMeters == null) return 0;
    if (a.distanceMeters == null) return 1;
    if (b.distanceMeters == null) return -1;
    return a.distanceMeters - b.distanceMeters;
  });

  return matches;
}

/**
 * Inkrementell tilldelning: analyserar uppgiften, väljer bästa ej-skyddade klump,
 * skriver assignment + membership. Kallas från klustringsköns processor.
 *
 * Skyddade klumpar (confirmed + locked): uppgift i en sådan klump ändras ALDRIG
 * automatiskt. Ny uppgift tilldelas ALDRIG automatiskt till en skyddad klump.
 */
export async function processTask(
  taskId: string,
  tenantId: string,
): Promise<{
  action: "skipped" | "removed" | "kept" | "assigned" | "created";
  clusterId?: string;
}> {
  const wo = await storage.getWorkOrder(taskId);
  if (!wo || wo.tenantId !== tenantId) return { action: "skipped" };

  const currentCluster = wo.stopClusterId
    ? await db.query.stopClusters.findFirst({
        where: eq(stopClusters.id, wo.stopClusterId),
      })
    : null;

  // Skyddade klumpar (confirmed + locked): rör dem ALDRIG automatiskt.
  if (isProtectedStatus(currentCluster?.status)) {
    return { action: "skipped", clusterId: wo.stopClusterId ?? undefined };
  }

  const now = new Date();

  if (!isActiveForPlanning(wo)) {
    if (wo.stopClusterId) {
      await removeFromCluster(taskId, "work_orders", tenantId, "status_change");
      return { action: "removed" };
    }
    return { action: "skipped" };
  }

  const config = await getTenantConfig(tenantId);
  const geo = await resolveTaskGeo(wo);

  const hasGeo = geo.latitude != null && geo.longitude != null;
  const hasAddress = !!geo.normalizedAddress;
  if (!hasGeo && !hasAddress) {
    if (wo.stopClusterId) {
      await removeFromCluster(taskId, "work_orders", tenantId, "recluster");
      return { action: "removed" };
    }
    return { action: "skipped" };
  }

  // Hämta bara matchande klumpar (analyzeTask exkluderar dissolved + kontrollerar villkor)
  const allMatches = await analyzeTask(taskId, tenantId);

  // Välj bästa icke-skyddade match (confirmed/locked hoppas alltid över)
  const bestMatch =
    allMatches.find((m) => !isProtectedStatus(m.cluster.status)) ?? null;

  if (!bestMatch) {
    // Ingen befintlig klump matchar — skapa ny solo-klump
    if (wo.stopClusterId) {
      await removeFromCluster(taskId, "work_orders", tenantId, "recluster");
    }

    const window = getEffectiveWindow(wo);
    const displayName = buildStopClusterName(
      geo.normalizedAddress || "Okänd adress",
      geo.city,
    );
    const referenceNumber = await mintStopClusterReference(tenantId);

    const [newCluster] = await db
      .insert(stopClusters)
      .values({
        tenantId,
        referenceNumber,
        displayName,
        normalizedAddress: geo.normalizedAddress,
        city: geo.city,
        latitude: geo.latitude,
        longitude: geo.longitude,
        radiusMeters: config.radiusMeters,
        executionCode: wo.executionCode,
        earliestDeliveryAt: window.start,
        latestDeliveryAt: window.end,
        calculatedDurationMinutes: wo.estimatedDuration ?? null,
        status: "auto",
        clusteringRuleVersion: "v1",
        lastCalculatedAt: now,
      })
      .returning();

    await assignToCluster(taskId, "work_orders", newCluster.id, tenantId, wo.stopClusterId);
    return { action: "created", clusterId: newCluster.id };
  }

  if (bestMatch.cluster.id === wo.stopClusterId) {
    // Uppgiften är redan i rätt klump — uppdatera bara tidsfönstret
    const window = getEffectiveWindow(wo);
    await updateClusterWindow(
      bestMatch.cluster.id,
      window,
      wo.estimatedDuration ?? null,
      now,
    );
    return { action: "kept", clusterId: bestMatch.cluster.id };
  }

  // Flytta till bättre klump
  if (wo.stopClusterId) {
    await removeFromCluster(taskId, "work_orders", tenantId, "recluster");
  }
  await assignToCluster(
    taskId,
    "work_orders",
    bestMatch.cluster.id,
    tenantId,
    wo.stopClusterId,
  );
  return { action: "assigned", clusterId: bestMatch.cluster.id };
}

async function assignToCluster(
  taskId: string,
  taskTable: "work_orders",
  clusterId: string,
  tenantId: string,
  prevClusterId: string | null | undefined,
): Promise<void> {
  const now = new Date();

  if (prevClusterId && prevClusterId !== clusterId) {
    await db
      .update(stopClusterMemberships)
      .set({ removedAt: now, removalReason: "recluster" })
      .where(
        and(
          eq(stopClusterMemberships.taskId, taskId),
          eq(stopClusterMemberships.taskTable, taskTable),
          eq(stopClusterMemberships.stopClusterId, prevClusterId),
          isNull(stopClusterMemberships.removedAt),
        ),
      );
  }

  await db.insert(stopClusterMemberships).values({
    tenantId,
    stopClusterId: clusterId,
    taskId,
    taskTable,
    assignedAt: now,
  });

  if (taskTable === "work_orders") {
    await db
      .update(workOrders)
      .set({ stopClusterId: clusterId, stopClusterCalculatedAt: now })
      .where(
        and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)),
      );
  }
}

async function removeFromCluster(
  taskId: string,
  taskTable: "work_orders",
  tenantId: string,
  reason: string,
): Promise<void> {
  const now = new Date();

  await db
    .update(stopClusterMemberships)
    .set({ removedAt: now, removalReason: reason })
    .where(
      and(
        eq(stopClusterMemberships.taskId, taskId),
        eq(stopClusterMemberships.taskTable, taskTable),
        isNull(stopClusterMemberships.removedAt),
      ),
    );

  if (taskTable === "work_orders") {
    await db
      .update(workOrders)
      .set({ stopClusterId: null, stopClusterCalculatedAt: now })
      .where(
        and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)),
      );
  }
}

async function updateClusterWindow(
  clusterId: string,
  newWindow: TaskWindow,
  durationMinutes: number | null,
  now: Date,
): Promise<void> {
  const cluster = await db.query.stopClusters.findFirst({
    where: eq(stopClusters.id, clusterId),
  });
  if (!cluster || isProtectedStatus(cluster.status)) return;

  const existingStart = cluster.earliestDeliveryAt
    ? new Date(cluster.earliestDeliveryAt)
    : null;
  const existingEnd = cluster.latestDeliveryAt
    ? new Date(cluster.latestDeliveryAt)
    : null;

  const effectiveStart =
    existingStart && newWindow.start
      ? new Date(Math.min(existingStart.getTime(), newWindow.start.getTime()))
      : newWindow.start ?? existingStart;
  const effectiveEnd =
    existingEnd && newWindow.end
      ? new Date(Math.max(existingEnd.getTime(), newWindow.end.getTime()))
      : newWindow.end ?? existingEnd;

  const newDuration =
    durationMinutes != null
      ? (cluster.calculatedDurationMinutes ?? 0) + durationMinutes
      : cluster.calculatedDurationMinutes;

  await db
    .update(stopClusters)
    .set({
      earliestDeliveryAt: effectiveStart,
      latestDeliveryAt: effectiveEnd,
      calculatedDurationMinutes: newDuration,
      lastCalculatedAt: now,
    })
    .where(eq(stopClusters.id, clusterId));
}

/**
 * Fullständig omräkning för en tenant. Berör ENBART auto-klumpar.
 * Confirmed och locked klumpar (och uppgifter i dem) hoppas alltid över.
 */
export async function runFullAnalysis(
  tenantId: string,
  options: { horizon?: number } = {},
): Promise<ClusteringResult> {
  const t0 = Date.now();
  const config = await getTenantConfig(tenantId);
  const horizonDays = options.horizon ?? config.horizonDays;
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);

  const result: ClusteringResult = {
    created: 0,
    dissolved: 0,
    assigned: 0,
    unchanged: 0,
    lockedSkipped: 0,
    confirmedSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  // Identifiera auto-klumpar (enda kandidaterna för upplösning)
  const autoClusters = await db
    .select({ id: stopClusters.id })
    .from(stopClusters)
    .where(
      and(
        eq(stopClusters.tenantId, tenantId),
        eq(stopClusters.status, "auto"),
      ),
    );
  const autoClusterIds = autoClusters.map((c) => c.id);

  if (autoClusterIds.length > 0) {
    await db
      .update(stopClusterMemberships)
      .set({ removedAt: now, removalReason: "recluster" })
      .where(
        and(
          eq(stopClusterMemberships.tenantId, tenantId),
          inArray(stopClusterMemberships.stopClusterId, autoClusterIds),
          isNull(stopClusterMemberships.removedAt),
        ),
      );

    await db
      .update(workOrders)
      .set({ stopClusterId: null, stopClusterCalculatedAt: now })
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          inArray(workOrders.stopClusterId, autoClusterIds),
        ),
      );

    await db
      .update(stopClusters)
      .set({ status: "dissolved", dissolvedAt: now })
      .where(inArray(stopClusters.id, autoClusterIds));

    result.dissolved = autoClusterIds.length;
  }

  // Hämta alla aktiva WO inom horizon
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
      // Uppgifter i protected (confirmed/locked) klumpar hoppas ALLTID över
      if (wo.stopClusterId) {
        const sc = await db.query.stopClusters.findFirst({
          where: eq(stopClusters.id, wo.stopClusterId),
          columns: { status: true },
        });
        if (sc?.status === "locked") {
          result.lockedSkipped++;
          continue;
        }
        if (sc?.status === "confirmed") {
          result.confirmedSkipped++;
          continue;
        }
      }

      const geo = await resolveTaskGeo(wo as WorkOrder);
      const window = getEffectiveWindow(wo as WorkOrder);

      // Filtrera bort WO utanför horizon
      const taskEnd = window.end ?? window.start ?? null;
      if (taskEnd && taskEnd > horizon) continue;

      if (
        geo.latitude == null &&
        geo.longitude == null &&
        !geo.normalizedAddress
      ) {
        continue;
      }

      tasks.push({
        id: wo.id,
        taskTable: "work_orders",
        tenantId,
        executionCode: wo.executionCode,
        geo,
        window,
        estimatedDurationMinutes: wo.estimatedDuration ?? null,
        stopClusterId: null,
        stopClusterStatus: null,
      });
    } catch (err) {
      result.errors.push(
        `WO ${wo.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Greedy-klustring: strikt geo + strikt execution_code + strikt tidsfönsteröverlapp
  interface ClusterBucket {
    tasks: ActiveTask[];
    geo: TaskGeo;
    window: TaskWindow;
    executionCode: string | null;
  }

  const buckets: ClusterBucket[] = [];

  for (const task of tasks) {
    let placed = false;
    for (const bucket of buckets) {
      // Villkor 3: Exakt execution_code-matchning
      if (bucket.executionCode !== task.executionCode) continue;

      // Villkor 1: Geo-matchning
      const geoOk = (() => {
        if (
          bucket.geo.latitude != null &&
          bucket.geo.longitude != null &&
          task.geo.latitude != null &&
          task.geo.longitude != null
        ) {
          return (
            haversineMeters(
              bucket.geo.latitude,
              bucket.geo.longitude,
              task.geo.latitude,
              task.geo.longitude,
            ) <= config.radiusMeters
          );
        }
        if (bucket.geo.normalizedAddress && task.geo.normalizedAddress) {
          return bucket.geo.normalizedAddress === task.geo.normalizedAddress;
        }
        return false;
      })();
      if (!geoOk) continue;

      // Villkor 2: STRIKT tidsfönsteröverlapp
      if (!windowsOverlap(bucket.window, task.window)) continue;

      bucket.tasks.push(task);
      // Expandera bucketens fönster till union
      if (
        task.window.start &&
        (bucket.window.start == null ||
          task.window.start < bucket.window.start)
      ) {
        bucket.window.start = task.window.start;
      }
      if (
        task.window.end &&
        (bucket.window.end == null || task.window.end > bucket.window.end)
      ) {
        bucket.window.end = task.window.end;
      }
      placed = true;
      break;
    }

    if (!placed) {
      buckets.push({
        tasks: [task],
        geo: { ...task.geo },
        window: { ...task.window },
        executionCode: task.executionCode,
      });
    }
  }

  // Skapa klumpar för varje bucket
  for (const bucket of buckets) {
    try {
      const centroid = computeCentroid(
        bucket.tasks
          .filter((t) => t.geo.latitude != null && t.geo.longitude != null)
          .map((t) => ({ lat: t.geo.latitude!, lng: t.geo.longitude! })),
      );

      const firstAddr =
        bucket.tasks.find((t) => t.geo.normalizedAddress)?.geo
          .normalizedAddress ?? null;
      const firstCity =
        bucket.tasks.find((t) => t.geo.city)?.geo.city ?? null;

      const displayName = buildStopClusterName(
        firstAddr || "Okänd adress",
        firstCity,
      );
      const referenceNumber = await mintStopClusterReference(tenantId);
      const totalDuration = bucket.tasks.reduce(
        (s, t) => s + (t.estimatedDurationMinutes ?? 0),
        0,
      );

      const [newCluster] = await db
        .insert(stopClusters)
        .values({
          tenantId,
          referenceNumber,
          displayName,
          normalizedAddress: firstAddr,
          city: firstCity,
          latitude: centroid?.latitude ?? null,
          longitude: centroid?.longitude ?? null,
          radiusMeters: config.radiusMeters,
          executionCode: bucket.executionCode,
          earliestDeliveryAt: bucket.window.start,
          latestDeliveryAt: bucket.window.end,
          calculatedDurationMinutes: totalDuration || null,
          status: "auto",
          clusteringRuleVersion: "v1",
          lastCalculatedAt: now,
        })
        .returning();

      result.created++;

      for (const task of bucket.tasks) {
        await db.insert(stopClusterMemberships).values({
          tenantId,
          stopClusterId: newCluster.id,
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
          .set({
            stopClusterId: newCluster.id,
            stopClusterCalculatedAt: now,
          })
          .where(
            and(
              eq(workOrders.tenantId, tenantId),
              inArray(workOrders.id, woIds),
            ),
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
