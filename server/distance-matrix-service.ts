import { trackApiUsage } from "./api-usage-tracker";
import { db } from "./db";
import { distanceCache } from "@shared/schema";
import { eq, lt } from "drizzle-orm";
import { isOSRMAvailable, osrmRoute, osrmTable, getOSRMStatus } from "./osrm-client";

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const ROUTING_URL = "https://api.geoapify.com/v1/routing";

export interface DistanceResult {
  distanceKm: number;
  durationMin: number;
  source: "osrm" | "geoapify" | "haversine";
}

interface L1CacheEntry {
  result: DistanceResult;
  timestamp: number;
}

const l1Cache = new Map<string, L1CacheEntry>();
const L1_TTL = 2 * 60 * 60 * 1000;
const L1_MAX_SIZE = 50_000;
const L1_EVICT_BATCH = 5_000;
// 30 dagar — avstånd mellan två koordinater är statiska, så längre TTL minskar
// onödiga externa Geoapify-anrop utan att göra cachen mindre korrekt.
const L2_TTL_HOURS = 24 * 30;

function encodeGeohash(lat: number, lng: number, precision: number = 9): string {
  const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let hash = "";
  let isLng = true;
  let bit = 0;
  let ch = 0;
  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { ch = ch | (1 << (4 - bit)); minLng = mid; }
      else { maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { ch = ch | (1 << (4 - bit)); minLat = mid; }
      else { maxLat = mid; }
    }
    isLng = !isLng;
    bit++;
    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function coordKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return `${encodeGeohash(lat1, lng1)}|${encodeGeohash(lat2, lng2)}`;
}

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function haversineFallback(lat1: number, lng1: number, lat2: number, lng2: number): DistanceResult {
  const distanceKm = haversineDistanceKm(lat1, lng1, lat2, lng2);
  return {
    distanceKm,
    durationMin: Math.round((distanceKm / 35) * 60),
    source: "haversine",
  };
}

function evictL1() {
  if (l1Cache.size <= L1_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of l1Cache) {
    if (now - entry.timestamp > L1_TTL) l1Cache.delete(key);
  }
  if (l1Cache.size > L1_MAX_SIZE) {
    const cutoff = L1_MAX_SIZE - L1_EVICT_BATCH;
    let removed = 0;
    for (const key of l1Cache.keys()) {
      if (l1Cache.size <= cutoff || removed >= L1_EVICT_BATCH) break;
      l1Cache.delete(key);
      removed++;
    }
  }
}

function setL1(key: string, result: DistanceResult): void {
  evictL1();
  l1Cache.set(key, { result, timestamp: Date.now() });
}

async function getL2(key: string): Promise<DistanceResult | null> {
  try {
    const cutoff = new Date(Date.now() - L2_TTL_HOURS * 60 * 60 * 1000);
    const rows = await db.select().from(distanceCache).where(eq(distanceCache.id, key)).limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    if (row.createdAt < cutoff) return null;
    return {
      distanceKm: row.distanceKm,
      durationMin: row.durationMin,
      source: row.source as "osrm" | "geoapify" | "haversine",
    };
  } catch (err) {
    console.warn("[distance-cache] L2 read error:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function setL2(key: string, lat1: number, lng1: number, lat2: number, lng2: number, result: DistanceResult): Promise<void> {
  try {
    await db.insert(distanceCache).values({
      id: key,
      fromLat: lat1,
      fromLng: lng1,
      toLat: lat2,
      toLng: lng2,
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      source: result.source,
    }).onConflictDoUpdate({
      target: distanceCache.id,
      set: {
        distanceKm: result.distanceKm,
        durationMin: result.durationMin,
        source: result.source,
        createdAt: new Date(),
      },
    });
  } catch (err) {
    console.warn("[distance-cache] L2 write error:", err instanceof Error ? err.message : err);
  }
}

export async function getRoutingDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): Promise<DistanceResult> {
  const key = coordKey(lat1, lng1, lat2, lng2);

  const l1Hit = l1Cache.get(key);
  if (l1Hit && Date.now() - l1Hit.timestamp < L1_TTL) {
    return l1Hit.result;
  }

  const l2Hit = await getL2(key);
  if (l2Hit) {
    setL1(key, l2Hit);
    return l2Hit;
  }

  const osrmAvailable = await isOSRMAvailable();
  if (osrmAvailable) {
    try {
      const osrmResult = await osrmRoute({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
      if (osrmResult) {
        const result: DistanceResult = {
          distanceKm: osrmResult.distanceMeters / 1000,
          durationMin: Math.round(osrmResult.durationSeconds / 60),
          source: "osrm",
        };
        setL1(key, result);
        await setL2(key, lat1, lng1, lat2, lng2, result);
        return result;
      }
    } catch (err) {
      console.warn("[distance-matrix] OSRM failed, trying Geoapify:", err instanceof Error ? err.message : err);
    }
  }

  if (!GEOAPIFY_API_KEY) {
    const fb = haversineFallback(lat1, lng1, lat2, lng2);
    setL1(key, fb);
    return fb;
  }

  try {
    const waypoints = `${lat1},${lng1}|${lat2},${lng2}`;
    const startTime = Date.now();
    const response = await fetch(
      `${ROUTING_URL}?waypoints=${waypoints}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`
    );

    trackApiUsage({
      service: "geoapify",
      method: "routing",
      endpoint: "/v1/routing",
      units: 1,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
    });

    if (!response.ok) {
      console.warn(`[distance-matrix] Geoapify error ${response.status}, falling back to haversine`);
      const fb = haversineFallback(lat1, lng1, lat2, lng2);
      setL1(key, fb);
      return fb;
    }

    const data = await response.json();
    const props = data.features?.[0]?.properties;

    if (props && props.distance !== undefined && props.time !== undefined) {
      const result: DistanceResult = {
        distanceKm: props.distance / 1000,
        durationMin: Math.round(props.time / 60),
        source: "geoapify",
      };
      setL1(key, result);
      await setL2(key, lat1, lng1, lat2, lng2, result);
      return result;
    }

    const fb = haversineFallback(lat1, lng1, lat2, lng2);
    setL1(key, fb);
    return fb;
  } catch (error) {
    console.warn("[distance-matrix] Geoapify fetch failed, falling back to haversine:", error);
    const fb = haversineFallback(lat1, lng1, lat2, lng2);
    setL1(key, fb);
    return fb;
  }
}

export interface BatchPair {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  id: string;
}

export async function getBatchDistances(
  pairs: BatchPair[],
): Promise<Map<string, DistanceResult>> {
  const results = new Map<string, DistanceResult>();
  const uncached: BatchPair[] = [];

  for (const pair of pairs) {
    const key = coordKey(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
    const l1Hit = l1Cache.get(key);
    if (l1Hit && Date.now() - l1Hit.timestamp < L1_TTL) {
      results.set(pair.id, l1Hit.result);
    } else {
      uncached.push(pair);
    }
  }

  if (uncached.length === 0) return results;

  const l2Misses: BatchPair[] = [];
  for (const pair of uncached) {
    const key = coordKey(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
    const l2Hit = await getL2(key);
    if (l2Hit) {
      results.set(pair.id, l2Hit);
      setL1(key, l2Hit);
    } else {
      l2Misses.push(pair);
    }
  }

  if (l2Misses.length === 0) return results;

  const BATCH_SIZE = 5;
  for (let i = 0; i < l2Misses.length; i += BATCH_SIZE) {
    const batch = l2Misses.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (pair) => {
      try {
        const result = await getRoutingDistance(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
        results.set(pair.id, result);
      } catch {
        const fb = haversineFallback(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
        results.set(pair.id, fb);
      }
    });
    await Promise.all(batchPromises);
  }

  return results;
}

export interface CoordStop {
  id: string;
  lat: number;
  lng: number;
}

export interface DistanceMatrixEntry {
  fromId: string;
  toId: string;
  distanceKm: number;
  durationMin: number;
}

export async function precomputeDistanceMatrix(
  stops: CoordStop[],
): Promise<DistanceMatrixEntry[]> {
  const matrix: DistanceMatrixEntry[] = [];

  for (const stop of stops) {
    matrix.push({ fromId: stop.id, toId: stop.id, distanceKm: 0, durationMin: 0 });
  }

  if (stops.length >= 2 && await isOSRMAvailable()) {
    const tableResult = await osrmTable(stops.map(s => ({ lat: s.lat, lng: s.lng })));
    if (tableResult && tableResult.distances.length === stops.length) {
      console.log(`[distance-matrix] OSRM table API: ${stops.length}×${stops.length} matrix computed`);
      const l2Promises: Promise<void>[] = [];
      let nullCount = 0;
      for (let i = 0; i < stops.length; i++) {
        for (let j = 0; j < stops.length; j++) {
          if (i === j) continue;
          const rawDist = tableResult.distances[i][j];
          const rawDur = tableResult.durations[i][j];
          let distKm: number;
          let durMin: number;
          let source: DistanceResult["source"] = "osrm";
          if (isNaN(rawDist) || isNaN(rawDur)) {
            nullCount++;
            distKm = haversineDistanceKm(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
            durMin = Math.round((distKm / 40) * 60);
            source = "haversine";
          } else {
            distKm = rawDist / 1000;
            durMin = Math.round(rawDur / 60);
          }
          matrix.push({
            fromId: stops[i].id,
            toId: stops[j].id,
            distanceKm: distKm,
            durationMin: durMin,
          });
          const key = coordKey(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
          const result: DistanceResult = { distanceKm: distKm, durationMin: durMin, source };
          setL1(key, result);
          l2Promises.push(setL2(key, stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng, result));
        }
      }
      if (nullCount > 0) {
        console.warn(`[distance-matrix] OSRM returned ${nullCount} unreachable pairs, filled with Haversine`);
      }
      await Promise.all(l2Promises);
      return matrix;
    }
  }

  const pairs: BatchPair[] = [];
  for (let i = 0; i < stops.length; i++) {
    for (let j = 0; j < stops.length; j++) {
      if (i === j) continue;
      pairs.push({
        fromLat: stops[i].lat,
        fromLng: stops[i].lng,
        toLat: stops[j].lat,
        toLng: stops[j].lng,
        id: `${stops[i].id}|${stops[j].id}`,
      });
    }
  }

  const results = await getBatchDistances(pairs);

  for (const [pairId, result] of results) {
    const [fromId, toId] = pairId.split("|");
    matrix.push({ fromId, toId, distanceKm: result.distanceKm, durationMin: result.durationMin });
  }

  return matrix;
}

export interface PrecomputedDistanceEntry {
  from_idx: number;
  to_idx: number;
  distance_m: number;
  duration_s: number;
}

export async function computeORToolsMatrix(
  locations: Array<{ lat: number; lng: number }>,
): Promise<PrecomputedDistanceEntry[] | null> {
  if (locations.length < 2) return null;

  try {
    const osrmAvail = await isOSRMAvailable();
    if (osrmAvail) {
      const tableResult = await osrmTable(locations);
      if (tableResult && tableResult.distances.length === locations.length) {
        const entries: PrecomputedDistanceEntry[] = [];
        let nullCount = 0;
        for (let i = 0; i < locations.length; i++) {
          for (let j = 0; j < locations.length; j++) {
            if (i === j) continue;
            const rawDist = tableResult.distances[i][j];
            const rawDur = tableResult.durations[i][j];
            if (isNaN(rawDist) || isNaN(rawDur)) {
              nullCount++;
              const distKm = haversineDistanceKm(locations[i].lat, locations[i].lng, locations[j].lat, locations[j].lng);
              entries.push({
                from_idx: i,
                to_idx: j,
                distance_m: Math.round(distKm * 1000),
                duration_s: Math.round((distKm / 40) * 3600),
              });
            } else {
              entries.push({
                from_idx: i,
                to_idx: j,
                distance_m: Math.round(rawDist),
                duration_s: Math.round(rawDur),
              });
            }
          }
        }
        if (nullCount > 0) {
          console.warn(`[distance-matrix] OSRM matrix: ${nullCount} unreachable pairs filled with Haversine`);
        }
        console.log(`[distance-matrix] OSRM OR-Tools matrix: ${locations.length}×${locations.length} (${entries.length} entries)`);
        return entries;
      }
    }

    const entries: PrecomputedDistanceEntry[] = [];
    for (let i = 0; i < locations.length; i++) {
      for (let j = 0; j < locations.length; j++) {
        if (i === j) continue;
        const dr = await getRoutingDistance(locations[i].lat, locations[i].lng, locations[j].lat, locations[j].lng);
        entries.push({
          from_idx: i,
          to_idx: j,
          distance_m: Math.round(dr.distanceKm * 1000),
          duration_s: Math.round(dr.durationMin * 60),
        });
      }
    }
    console.log(`[distance-matrix] Fallback OR-Tools matrix: ${locations.length}×${locations.length} (${entries.length} entries)`);
    return entries;
  } catch (err) {
    console.warn("[distance-matrix] OR-Tools matrix computation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface GeoCluster {
  centroid: { lat: number; lng: number };
  stops: CoordStop[];
}

export function geographicPreCluster(
  stops: CoordStop[],
  numGroups: number,
  maxRadiusKm = 25,
): GeoCluster[] {
  if (stops.length === 0) return [];
  if (numGroups <= 0) numGroups = 1;
  if (numGroups >= stops.length) {
    return stops.map(s => ({
      centroid: { lat: s.lat, lng: s.lng },
      stops: [s],
    }));
  }

  const k = Math.min(numGroups, stops.length);
  const indices = [];
  const step = Math.floor(stops.length / k);
  for (let i = 0; i < k; i++) {
    indices.push(Math.min(i * step, stops.length - 1));
  }
  let centroids = indices.map(i => ({ lat: stops[i].lat, lng: stops[i].lng }));

  const maxIterations = 50;
  let assignments = new Array(stops.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    const newAssignments = new Array(stops.length).fill(0);

    for (let i = 0; i < stops.length; i++) {
      let bestDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < centroids.length; c++) {
        const d = haversineDistanceKm(stops[i].lat, stops[i].lng, centroids[c].lat, centroids[c].lng);
        if (d < bestDist) {
          bestDist = d;
          bestCluster = c;
        }
      }
      newAssignments[i] = bestCluster;
    }

    const newCentroids = centroids.map(() => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < stops.length; i++) {
      const c = newAssignments[i];
      newCentroids[c].lat += stops[i].lat;
      newCentroids[c].lng += stops[i].lng;
      newCentroids[c].count++;
    }

    const updatedCentroids = newCentroids.map((nc, idx) => {
      if (nc.count === 0) return centroids[idx];
      return { lat: nc.lat / nc.count, lng: nc.lng / nc.count };
    });

    const converged = updatedCentroids.every((uc, idx) =>
      haversineDistanceKm(uc.lat, uc.lng, centroids[idx].lat, centroids[idx].lng) < 0.01
    );

    centroids = updatedCentroids;
    assignments = newAssignments;
    if (converged) break;
  }

  const targetSize = Math.ceil(stops.length / k);
  const clusterSizes = new Array(k).fill(0);
  for (const a of assignments) clusterSizes[a]++;

  const overloaded = clusterSizes.some(s => s > targetSize * 1.5);
  if (overloaded) {
    const indexed = stops.map((s, i) => ({ stop: s, cluster: assignments[i] }));
    indexed.sort((a, b) => {
      if (a.cluster !== b.cluster) return a.cluster - b.cluster;
      return haversineDistanceKm(a.stop.lat, a.stop.lng, centroids[a.cluster].lat, centroids[a.cluster].lng)
        - haversineDistanceKm(b.stop.lat, b.stop.lng, centroids[b.cluster].lat, centroids[b.cluster].lng);
    });

    const balanced = new Array(k).fill(null).map(() => [] as CoordStop[]);
    for (const item of indexed) {
      let bestCluster = item.cluster;
      if (balanced[bestCluster].length >= targetSize) {
        let minSize = Infinity;
        for (let c = 0; c < k; c++) {
          if (balanced[c].length < minSize) {
            minSize = balanced[c].length;
            bestCluster = c;
          }
        }
      }
      balanced[bestCluster].push(item.stop);
    }

    return balanced.filter(g => g.length > 0).map(group => {
      const lat = group.reduce((s, st) => s + st.lat, 0) / group.length;
      const lng = group.reduce((s, st) => s + st.lng, 0) / group.length;
      return { centroid: { lat, lng }, stops: group };
    });
  }

  const clusterGroups = new Array(k).fill(null).map(() => [] as CoordStop[]);
  for (let i = 0; i < stops.length; i++) {
    clusterGroups[assignments[i]].push(stops[i]);
  }

  const result: GeoCluster[] = [];
  for (let c = 0; c < k; c++) {
    const group = clusterGroups[c];
    if (group.length === 0) continue;

    const tooFar = group.some(s =>
      haversineDistanceKm(s.lat, s.lng, centroids[c].lat, centroids[c].lng) > maxRadiusKm
    );

    if (tooFar && group.length > 2) {
      const sub = geographicPreCluster(group, 2, maxRadiusKm);
      result.push(...sub);
    } else {
      result.push({ centroid: centroids[c], stops: group });
    }
  }

  return result;
}

export function getDistanceCacheStats(): {
  l1Size: number;
  l1MaxSize: number;
  l2TtlHours: number;
  osrm: ReturnType<typeof getOSRMStatus>;
} {
  return {
    l1Size: l1Cache.size,
    l1MaxSize: L1_MAX_SIZE,
    l2TtlHours: L2_TTL_HOURS,
    osrm: getOSRMStatus(),
  };
}

export async function getL2CacheStats(): Promise<{ l2Count: number }> {
  try {
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`SELECT COUNT(*)::int AS count FROM distance_cache`);
    const resultObj = result as unknown as { rows?: Array<Record<string, unknown>> };
    if (resultObj.rows && resultObj.rows.length > 0) {
      return { l2Count: Number(resultObj.rows[0].count) || 0 };
    }
    const resultArr = result as unknown as Array<Record<string, unknown>>;
    if (Array.isArray(resultArr) && resultArr.length > 0) {
      return { l2Count: Number(resultArr[0].count) || 0 };
    }
    return { l2Count: 0 };
  } catch (err) {
    console.warn("[distance-cache] L2 stats error:", err instanceof Error ? err.message : err);
    return { l2Count: 0 };
  }
}

export async function clearDistanceCache(): Promise<{ l1Cleared: number; l2Cleared: number }> {
  const l1Cleared = l1Cache.size;
  l1Cache.clear();

  let l2Cleared = 0;
  try {
    const result = await db.delete(distanceCache);
    l2Cleared = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
  } catch {
  }

  return { l1Cleared, l2Cleared };
}

export async function cleanupExpiredL2(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - L2_TTL_HOURS * 60 * 60 * 1000);
    const result = await db.delete(distanceCache).where(lt(distanceCache.createdAt, cutoff));
    return (result as unknown as { rowCount?: number })?.rowCount ?? 0;
  } catch {
    return 0;
  }
}

const L2_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startScheduledL2Cleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(async () => {
    try {
      const removed = await cleanupExpiredL2();
      if (removed > 0) {
        console.log(`[distance-cache] Scheduled cleanup removed ${removed} expired L2 entries`);
      }
    } catch (err) {
      console.warn("[distance-cache] Scheduled cleanup error:", err);
    }
  }, L2_CLEANUP_INTERVAL_MS);
  console.log("[distance-cache] Scheduled L2 cleanup every 6 hours");
}

startScheduledL2Cleanup();
