import { trackApiUsage } from "./api-usage-tracker";
import { createHash } from "crypto";

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const ROUTING_URL = "https://api.geoapify.com/v1/routing";

interface DistanceResult {
  distanceKm: number;
  durationMin: number;
  source: "geoapify" | "haversine";
}

interface CacheEntry {
  result: DistanceResult;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// In-memory cache (fallback)
// ---------------------------------------------------------------------------

const distanceCache = new Map<string, CacheEntry>();
const CACHE_TTL = 2 * 60 * 60 * 1000;
const MAX_CACHE_SIZE = 5000;

function cacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  return `${lat1.toFixed(4)},${lng1.toFixed(4)}|${lat2.toFixed(4)},${lng2.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Redis caching layer
// ---------------------------------------------------------------------------

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const REDIS_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const REDIS_KEY_PREFIX = "dist:";

let redisClient: import("ioredis").default | null = null;
let redisAvailable = false;

async function getRedis(): Promise<import("ioredis").default | null> {
  if (redisClient) return redisAvailable ? redisClient : null;

  try {
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redisClient.on("error", () => {
      redisAvailable = false;
    });
    redisClient.on("connect", () => {
      redisAvailable = true;
    });

    await redisClient.connect();
    redisAvailable = true;
    console.log("[distance-matrix] Redis cache connected");
    return redisClient;
  } catch {
    console.warn("[distance-matrix] Redis unavailable – using in-memory cache only");
    redisAvailable = false;
    return null;
  }
}

function redisCacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const raw = `${lat1.toFixed(4)},${lng1.toFixed(4)}|${lat2.toFixed(4)},${lng2.toFixed(4)}`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${REDIS_KEY_PREFIX}${hash}`;
}

async function getFromRedis(key: string): Promise<DistanceResult | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;

    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as DistanceResult;
  } catch {
    return null;
  }
}

async function setInRedis(key: string, value: DistanceResult): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;

    await redis.set(key, JSON.stringify(value), "EX", REDIS_CACHE_TTL_SECONDS);
  } catch {
    // Graceful fallback – do nothing
  }
}

// ---------------------------------------------------------------------------
// Core distance functions
// ---------------------------------------------------------------------------

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

function evictOldEntries() {
  if (distanceCache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  distanceCache.forEach((entry, key) => {
    if (now - entry.timestamp > CACHE_TTL) distanceCache.delete(key);
  });
  if (distanceCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(distanceCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE + 500);
    toRemove.forEach(([key]) => distanceCache.delete(key));
  }
}

export async function getRoutingDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): Promise<DistanceResult> {
  const memKey = cacheKey(lat1, lng1, lat2, lng2);
  const redKey = redisCacheKey(lat1, lng1, lat2, lng2);

  // 1. Check in-memory cache
  const memCached = distanceCache.get(memKey);
  if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
    return memCached.result;
  }

  // 2. Check Redis cache
  const redisCached = await getFromRedis(redKey);
  if (redisCached) {
    // Warm up in-memory
    distanceCache.set(memKey, { result: redisCached, timestamp: Date.now() });
    return redisCached;
  }

  if (!GEOAPIFY_API_KEY) {
    return haversineFallback(lat1, lng1, lat2, lng2);
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
      return haversineFallback(lat1, lng1, lat2, lng2);
    }

    const data = await response.json();
    const props = data.features?.[0]?.properties;

    if (props && props.distance !== undefined && props.time !== undefined) {
      const result: DistanceResult = {
        distanceKm: props.distance / 1000,
        durationMin: Math.round(props.time / 60),
        source: "geoapify",
      };
      evictOldEntries();
      distanceCache.set(memKey, { result, timestamp: Date.now() });
      await setInRedis(redKey, result);
      return result;
    }

    const fb = haversineFallback(lat1, lng1, lat2, lng2);
    evictOldEntries();
    distanceCache.set(memKey, { result: fb, timestamp: Date.now() - CACHE_TTL + 15 * 60 * 1000 });
    return fb;
  } catch (error) {
    console.warn("[distance-matrix] Geoapify fetch failed, falling back to haversine:", error);
    const fb = haversineFallback(lat1, lng1, lat2, lng2);
    evictOldEntries();
    distanceCache.set(memKey, { result: fb, timestamp: Date.now() - CACHE_TTL + 15 * 60 * 1000 });
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
    const memKey = cacheKey(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
    const cached = distanceCache.get(memKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      results.set(pair.id, cached.result);
    } else {
      uncached.push(pair);
    }
  }

  // Check Redis for remaining uncached pairs
  const stillUncached: BatchPair[] = [];
  for (const pair of uncached) {
    const redKey = redisCacheKey(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
    const redisCached = await getFromRedis(redKey);
    if (redisCached) {
      results.set(pair.id, redisCached);
      const memKey = cacheKey(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
      distanceCache.set(memKey, { result: redisCached, timestamp: Date.now() });
    } else {
      stillUncached.push(pair);
    }
  }

  if (stillUncached.length === 0) return results;

  if (!GEOAPIFY_API_KEY) {
    for (const pair of stillUncached) {
      results.set(pair.id, haversineFallback(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng));
    }
    return results;
  }

  const BATCH_SIZE = 5;
  for (let i = 0; i < stillUncached.length; i += BATCH_SIZE) {
    const batch = stillUncached.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (pair) => {
      try {
        const result = await getRoutingDistance(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng);
        results.set(pair.id, result);
      } catch {
        results.set(pair.id, haversineFallback(pair.fromLat, pair.fromLng, pair.toLat, pair.toLng));
      }
    });
    await Promise.all(batchPromises);
  }

  return results;
}

export function getDistanceCacheStats(): { size: number; maxSize: number; redisAvailable: boolean } {
  return { size: distanceCache.size, maxSize: MAX_CACHE_SIZE, redisAvailable };
}
