/**
 * Stoppklumpningsmotorn (ADR Klumpning v1).
 *
 * Identifierar uppgifter (work_orders) som kan utföras vid samma fysiska
 * stopp baserat på fyra villkor:
 *   1. Geografisk   — koordinater inom konfigurerbar radie (default 30 m)
 *                     ELLER exakt adressmatchning
 *   2. Tidsmässig   — parvisa tidsfönster överlappar (STRIKT, UTAN kedjeklustring)
 *   3. Utförarmässig — exakt samma execution_code
 *                     (null === null är OK; null !== "kod")
 *   4. Statusmässig — uppgiften är aktiv för planering
 *
 * Tidsfönster-invariant (klumpens garanti):
 *   Klumpen håller ett INTERSEKTIONSFÖNSTER (intersection av alla members windows).
 *   En ny uppgift får bara gå in om dess fönster överlappar med intersektionen.
 *   Detta förhindrar kedjeklustring (A∩B, B∩C men A⊄C → A och C hamnar aldrig
 *   i samma klump).
 *
 * Låsningslogik (per klump):
 *   auto      – motorns beslut; skrivs över fritt vid omräkning
 *   confirmed – planeraren bekräftat; ÄNDRAS ALDRIG automatiskt
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
}

// ---------------------------------------------------------------------------
// Interna hjälpfunktioner – tid
// ---------------------------------------------------------------------------

/**
 * Sant om fönstren överlappar. Null-start = -∞, null-end = +∞.
 * Krav: STRIKT överlapp — uppgifter med icke-överlappande fönster
 * hamnar ALDRIG i samma klump.
 */
function windowsOverlap(a: TaskWindow, b: TaskWindow): boolean {
  const aStart = a.start?.getTime() ?? -Infinity;
  const aEnd = a.end?.getTime() ?? Infinity;
  const bStart = b.start?.getTime() ?? -Infinity;
  const bEnd = b.end?.getTime() ?? Infinity;
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Beräknar intersektionsfönstret för två fönster.
 * Returnerar null om intersektionen är tom (aEnd < bStart eller tvärtom).
 */
function intersectWindows(
  a: TaskWindow,
  b: TaskWindow,
): TaskWindow | null {
  const aStart = a.start?.getTime() ?? -Infinity;
  const aEnd = a.end?.getTime() ?? Infinity;
  const bStart = b.start?.getTime() ?? -Infinity;
  const bEnd = b.end?.getTime() ?? Infinity;

  const iStart = Math.max(aStart, bStart);
  const iEnd = Math.min(aEnd, bEnd);

  if (iStart > iEnd) return null; // Tomma intersektionen

  return {
    start: iStart === -Infinity ? null : new Date(iStart),
    end: iEnd === Infinity ? null : new Date(iEnd),
  };
}

// ---------------------------------------------------------------------------
// Interna hjälpfunktioner – geo
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

// ---------------------------------------------------------------------------
// Interna hjälpfunktioner – övrigt
// ---------------------------------------------------------------------------

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
  return { latitude: null, longitude: null, normalizedAddress: null, city: null };
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

async function mintStopClusterReference(tenantId: string): Promise<string> {
  const result = await db
    .select({ cnt: sql<number>`count(*)` })
    .from(stopClusters)
    .where(eq(stopClusters.tenantId, tenantId));
  const n = Number(result[0]?.cnt ?? 0) + 1;
  return `SC-${String(n).padStart(3, "0")}`;
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

/** Klumpar med confirmed eller locked status ändras ALDRIG av automatiska flöden. */
function isProtectedStatus(status: string | null | undefined): boolean {
  return status === "locked" || status === "confirmed";
}

/**
 * Hämtar intersektionsfönstret för alla aktiva members i en klump.
 * Om klumpen saknar members returneras null (öppet fönster – matchar allt).
 * Om intersektionen är tom returneras en sentinel med start > end.
 */
async function getClusterIntersectionWindow(
  clusterId: string,
  tenantId: string,
): Promise<TaskWindow | null> {
  const memberships = await db
    .select({ taskId: stopClusterMemberships.taskId })
    .from(stopClusterMemberships)
    .where(
      and(
        eq(stopClusterMemberships.stopClusterId, clusterId),
        eq(stopClusterMemberships.tenantId, tenantId),
        isNull(stopClusterMemberships.removedAt),
      ),
    );

  if (memberships.length === 0) return null;

  const memberIds = memberships.map((m) => m.taskId);
  const memberWos = await db
    .select()
    .from(workOrders)
    .where(inArray(workOrders.id, memberIds));

  let intersection: TaskWindow | null = null;
  for (const mwo of memberWos) {
    const mw = getEffectiveWindow(mwo as WorkOrder);
    if (intersection === null) {
      intersection = mw;
    } else {
      const next = intersectWindows(intersection, mw);
      if (next === null) {
        // Intersektionen är redan tom — klumpen är inkonsistent (bör inte hända).
        return { start: new Date(0), end: new Date(-1) };
      }
      intersection = next;
    }
  }
  return intersection;
}

// ---------------------------------------------------------------------------
// Publika API
// ---------------------------------------------------------------------------

export function buildStopClusterName(
  address: string,
  city?: string | null,
  extras?: string | null,
): string {
  const base = city ? `${address}, ${city}` : address;
  return extras ? `${base} – ${extras}` : base;
}

/**
 * Analyserar EN uppgift mot befintliga stoppklumpar (skrivskyddad).
 *
 * Villkor (alla tre måste uppfyllas):
 *   1. Exakt execution_code-matchning (null===null OK)
 *   2. Ny uppgift överlappar med klumpens INTERSEKTIONSFÖNSTER
 *      (förhindrar kedjeklustring)
 *   3. Geo-matchning inom radiusMeters ELLER exakt adress
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
  const taskWindow = getEffectiveWindow(wo);

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

    // Villkor 3: Exakt execution_code-matchning
    if (cluster.executionCode !== wo.executionCode) continue;
    if (wo.executionCode !== null) reasons.push("execution_code");

    // Villkor 2: Ny uppgift måste överlappa med klumpens INTERSEKTIONSFÖNSTER
    //   (förhindrar kedjeklustring; null-intersection = inga members → öppet)
    const intersection = await getClusterIntersectionWindow(cluster.id, tenantId);
    if (intersection !== null) {
      // Kolla om intersection är tom (sentinel)
      const iStart = intersection.start?.getTime() ?? -Infinity;
      const iEnd = intersection.end?.getTime() ?? Infinity;
      if (iStart > iEnd) continue; // Tom intersection → klumpen tar inga fler

      if (!windowsOverlap(taskWindow, intersection)) continue;
    }
    reasons.push("time");

    // Villkor 1: Geo-matchning
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
      if (distanceMeters <= config.radiusMeters) {
        reasons.push("geo");
        geoMatched = true;
      }
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
 * Inkrementell tilldelning: analyserar uppgiften, väljer bästa ej-skyddade
 * klump och skriver assignment + membership.
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

  // Skyddade klumpar (confirmed + locked): rör dem ALDRIG automatiskt
  if (isProtectedStatus(currentCluster?.status)) {
    return { action: "skipped", clusterId: wo.stopClusterId ?? undefined };
  }

  const now = new Date();

  if (!isActiveForPlanning(wo)) {
    if (wo.stopClusterId) {
      await removeFromCluster(taskId, "work_orders", tenantId, "status_change");
    }
    return { action: "removed" };
  }

  const config = await getTenantConfig(tenantId);
  const geo = await resolveTaskGeo(wo);
  const hasGeo = geo.latitude != null && geo.longitude != null;
  const hasAddress = !!geo.normalizedAddress;

  if (!hasGeo && !hasAddress) {
    if (wo.stopClusterId) {
      await removeFromCluster(taskId, "work_orders", tenantId, "recluster");
    }
    return { action: "skipped" };
  }

  // analyzeTask använder intersektionsfönstret internt — förhindrar kedjeklustring
  const allMatches = await analyzeTask(taskId, tenantId);
  const bestMatch =
    allMatches.find((m) => !isProtectedStatus(m.cluster.status)) ?? null;

  if (!bestMatch) {
    if (wo.stopClusterId) {
      await removeFromCluster(taskId, "work_orders", tenantId, "recluster");
    }

    const taskWindow = getEffectiveWindow(wo);
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
        earliestDeliveryAt: taskWindow.start,
        latestDeliveryAt: taskWindow.end,
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
    // Redan i rätt klump — uppdatera bara statistik (ej ackumulera duration)
    await db
      .update(stopClusters)
      .set({ lastCalculatedAt: now })
      .where(eq(stopClusters.id, bestMatch.cluster.id));
    return { action: "kept", clusterId: bestMatch.cluster.id };
  }

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
      .where(and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)));
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
      .where(and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)));
  }
}

/**
 * Fullständig omräkning för en tenant. Berör ENBART auto-klumpar.
 *
 * Tidsfönster-invariant: varje bucket håller ett intersektionsfönster som
 * krymper med varje ny member. En ny uppgift kan bara gå in om dess fönster
 * överlappar med intersektionen — detta förhindrar kedjeklustring
 * (A∩B, B∩C men A⊄C → A och C hamnar i SEPARATA klumpar).
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

  // 1. Lös upp ENBART auto-klumpar
  const autoClusters = await db
    .select({ id: stopClusters.id })
    .from(stopClusters)
    .where(
      and(eq(stopClusters.tenantId, tenantId), eq(stopClusters.status, "auto")),
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

  // 2. Hämta aktiva WO inom horizon
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
      // WO i protected (confirmed/locked) klumpar hoppas över
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

      const taskEnd = window.end ?? window.start ?? null;
      if (taskEnd && taskEnd > horizon) continue;

      if (
        geo.latitude == null &&
        geo.longitude == null &&
        !geo.normalizedAddress
      ) continue;

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

  // 3. Greedy-klustring med INTERSEKTIONSFÖNSTER per bucket
  //
  //   Bucket-invariant:
  //     intersectionWindow = ∩ av alla members windows (krymper med varje ny member)
  //     unionWindow        = ∪ av alla members windows (för display/storage)
  //
  //   En ny uppgift kan gå in i bucket OM:
  //     (a) executionCode matchar exakt
  //     (b) geo matchar (inom radie ELLER exakt adress)
  //     (c) task.window ∩ bucket.intersectionWindow ≠ ∅
  //
  //   Varje task kan bara hamna i FÖRSTA matchande bucket (greedy).

  interface ClusterBucket {
    tasks: ActiveTask[];
    geo: TaskGeo;
    intersectionWindow: TaskWindow; // krymper
    unionWindow: TaskWindow;        // växer (för display)
    executionCode: string | null;
    totalDuration: number;
  }

  const buckets: ClusterBucket[] = [];

  for (const task of tasks) {
    let placed = false;
    for (const bucket of buckets) {
      // Villkor (a): Exakt execution_code
      if (bucket.executionCode !== task.executionCode) continue;

      // Villkor (b): Geo-matchning
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

      // Villkor (c): STRIKT tidsfönsteröverlapp mot INTERSEKTIONSFÖNSTRET
      // (förhindrar kedjeklustring)
      if (!windowsOverlap(task.window, bucket.intersectionWindow)) continue;

      // Beräkna ny intersection (krymper)
      const newIntersection = intersectWindows(bucket.intersectionWindow, task.window);
      if (newIntersection === null) continue; // Tom intersection efter merge — ej kompatibel

      // Lägg till i bucket
      bucket.tasks.push(task);
      bucket.intersectionWindow = newIntersection;

      // Expandera union (för display)
      const uStart = bucket.unionWindow.start;
      const uEnd = bucket.unionWindow.end;
      if (task.window.start && (!uStart || task.window.start < uStart))
        bucket.unionWindow.start = task.window.start;
      if (task.window.end && (!uEnd || task.window.end > uEnd))
        bucket.unionWindow.end = task.window.end;

      bucket.totalDuration += task.estimatedDurationMinutes ?? 0;
      placed = true;
      break;
    }

    if (!placed) {
      buckets.push({
        tasks: [task],
        geo: { ...task.geo },
        intersectionWindow: { ...task.window },
        unionWindow: { ...task.window },
        executionCode: task.executionCode,
        totalDuration: task.estimatedDurationMinutes ?? 0,
      });
    }
  }

  // 4. Skapa klumpar för varje bucket
  for (const bucket of buckets) {
    try {
      const centroid = computeCentroid(
        bucket.tasks
          .filter((t) => t.geo.latitude != null && t.geo.longitude != null)
          .map((t) => ({ lat: t.geo.latitude!, lng: t.geo.longitude! })),
      );

      const firstAddr =
        bucket.tasks.find((t) => t.geo.normalizedAddress)?.geo.normalizedAddress ??
        null;
      const firstCity =
        bucket.tasks.find((t) => t.geo.city)?.geo.city ?? null;

      const displayName = buildStopClusterName(
        firstAddr || "Okänd adress",
        firstCity,
      );
      const referenceNumber = await mintStopClusterReference(tenantId);

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
          // Lagra UNIONEN för display/informationsändamål
          earliestDeliveryAt: bucket.unionWindow.start,
          latestDeliveryAt: bucket.unionWindow.end,
          calculatedDurationMinutes: bucket.totalDuration || null,
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
          .set({ stopClusterId: newCluster.id, stopClusterCalculatedAt: now })
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
