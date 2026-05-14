import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { distanceCache } from "@shared/schema";
import { inArray, eq } from "drizzle-orm";
import { getBatchDistances, type BatchPair } from "../../server/distance-matrix-service";

const L2_TTL_HOURS = 24 * 30;

function encodeGeohash(lat: number, lng: number, precision = 9): string {
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

describe("L2 cache batch — TTL filtering (Task #492)", () => {
  // Slumpa unika koordinater per testkörning för att garantera att L1
  // (modul-scopad och persistent under processen) inte råkar innehålla
  // dessa nycklar från en tidigare körning. 9-tecken geohash ger ~5 m
  // precision, så små offsets räcker för en unik bucket.
  const seed = Math.random();
  const freshFromLat = 63.81 + seed * 0.05;
  const freshFromLng = 20.21 + seed * 0.05;
  const freshToLat = 63.86 + seed * 0.05;
  const freshToLng = 20.31 + seed * 0.05;

  const expiredFromLat = 59.31 + seed * 0.05;
  const expiredFromLng = 18.05 + seed * 0.05;
  const expiredToLat = 59.36 + seed * 0.05;
  const expiredToLng = 18.15 + seed * 0.05;

  const freshKey = coordKey(freshFromLat, freshFromLng, freshToLat, freshToLng);
  const expiredKey = coordKey(expiredFromLat, expiredFromLng, expiredToLat, expiredToLng);

  // Sentinel-värden — orealistiska distanser som omöjligt skulle returneras
  // av en riktig provider eller haversine. Om vi ser dessa i resultatet vet
  // vi säkert att svaret kom från L2-cachen.
  const FRESH_SENTINEL_DISTANCE = 9999.42;
  const FRESH_SENTINEL_DURATION = 12345.6;
  const EXPIRED_SENTINEL_DISTANCE = 8888.31;
  const EXPIRED_SENTINEL_DURATION = 7777.5;

  beforeAll(async () => {
    // Rensa eventuella tidigare rader för dessa nycklar
    await db.delete(distanceCache).where(inArray(distanceCache.id, [freshKey, expiredKey]));

    const now = new Date();
    const expiredAt = new Date(now.getTime() - (L2_TTL_HOURS + 1) * 60 * 60 * 1000);

    // Fräsch rad — createdAt = nu
    await db.insert(distanceCache).values({
      id: freshKey,
      fromLat: freshFromLat,
      fromLng: freshFromLng,
      toLat: freshToLat,
      toLng: freshToLng,
      distanceKm: FRESH_SENTINEL_DISTANCE,
      durationMin: FRESH_SENTINEL_DURATION,
      source: "geoapify",
      createdAt: now,
    });

    // Utgången rad — createdAt = nu - TTL - 1h
    await db.insert(distanceCache).values({
      id: expiredKey,
      fromLat: expiredFromLat,
      fromLng: expiredFromLng,
      toLat: expiredToLat,
      toLng: expiredToLng,
      distanceKm: EXPIRED_SENTINEL_DISTANCE,
      durationMin: EXPIRED_SENTINEL_DURATION,
      source: "geoapify",
      createdAt: expiredAt,
    });
  });

  afterAll(async () => {
    await db.delete(distanceCache).where(inArray(distanceCache.id, [freshKey, expiredKey]));
  });

  it("returnerar fräscha rader från L2-batch och förbigår utgångna", async () => {
    const pairs: BatchPair[] = [
      {
        id: "fresh",
        fromLat: freshFromLat,
        fromLng: freshFromLng,
        toLat: freshToLat,
        toLng: freshToLng,
      },
      {
        id: "expired",
        fromLat: expiredFromLat,
        fromLng: expiredFromLng,
        toLat: expiredToLat,
        toLng: expiredToLng,
      },
    ];

    const results = await getBatchDistances(pairs);

    // Fräsch: ska returneras direkt från cache med exakt sentinel-värdena
    const fresh = results.get("fresh");
    expect(fresh).toBeDefined();
    expect(fresh!.distanceKm).toBe(FRESH_SENTINEL_DISTANCE);
    expect(fresh!.durationMin).toBe(FRESH_SENTINEL_DURATION);
    expect(fresh!.source).toBe("geoapify");

    // Utgången: L2-batch ska inte returnera den (gte(createdAt, cutoff)
    // filtrerar bort raden). Resultatet kommer från provider eller
    // haversine-fallback — viktiga assertion: det är INTE sentinel-värdena
    // från den utgångna raden.
    const expired = results.get("expired");
    expect(expired).toBeDefined();
    expect(expired!.distanceKm).not.toBe(EXPIRED_SENTINEL_DISTANCE);
    expect(expired!.durationMin).not.toBe(EXPIRED_SENTINEL_DURATION);
    // Sanity: en riktig distans mellan punkterna är < 100 km
    expect(expired!.distanceKm).toBeLessThan(100);
  });

  it("efter L2-miss skrivs en färsk rad tillbaka i cachen", async () => {
    // Efter förra testet bör den utgångna nyckeln ha skrivits över med en
    // ny createdAt (via fetchAndStoreUncached → setL2 → onConflictDoUpdate).
    const rows = await db.select().from(distanceCache).where(eq(distanceCache.id, expiredKey));
    expect(rows.length).toBe(1);
    const ageMs = Date.now() - rows[0].createdAt.getTime();
    // Yngre än 5 minuter — bekräftar att raden refreshades, inte bara lästes.
    expect(ageMs).toBeLessThan(5 * 60 * 1000);
  });
});
