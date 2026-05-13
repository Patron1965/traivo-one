/**
 * API-usage audit (Task #471, Fas 0).
 *
 * Läser `api_usage_logs` och rapporterar volymer + uppskattad kostnad per
 * tjänst de senaste N dagarna. Används som baseline INFÖR Google-migrationen
 * så att vi vet:
 *   1. Hur många Geoapify routing/route-planner/geokod-anrop vi faktiskt gör
 *   2. Vilka endpoints som dominerar volymen (= vad som ska prioriteras)
 *   3. Cache-hit-andel (för att förutse Google-kostnad efter cache-warmup)
 *   4. Tids/kostnads-distribution per tenant
 *
 * Körs read-only — ingen skrivning.
 *
 * Användning:
 *   npx tsx scripts/api-usage-audit.ts          # senaste 30 dagar
 *   npx tsx scripts/api-usage-audit.ts --days=7 # senaste 7 dagar
 *   npx tsx scripts/api-usage-audit.ts --json   # maskinläsbar utskrift
 */

import { db } from "../server/db";
import { apiUsageLogs } from "@shared/schema";
import { gte, sql } from "drizzle-orm";

interface CliOptions {
  days: number;
  json: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let days = 30;
  let json = false;
  for (const a of args) {
    if (a.startsWith("--days=")) {
      const n = parseInt(a.slice(7), 10);
      if (!isNaN(n) && n > 0) days = n;
    } else if (a === "--json") {
      json = true;
    }
  }
  return { days, json };
}

interface ServiceStat {
  service: string;
  endpoint: string;
  method: string;
  totalCalls: number;
  cacheHits: number;
  totalUnits: number;
  estimatedCostUsd: number;
  avgDurationMs: number;
  errors: number;
}

async function main() {
  const opts = parseArgs();
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);

  // Hämta aggregat per (service, endpoint, method).
  const rows = await db
    .select({
      service: apiUsageLogs.service,
      endpoint: apiUsageLogs.endpoint,
      method: apiUsageLogs.method,
      totalCalls: sql<number>`count(*)::int`,
      cacheHits: sql<number>`sum(case when (metadata->>'cacheHit')::bool = true then 1 else 0 end)::int`,
      totalUnits: sql<number>`coalesce(sum(units), 0)::int`,
      estimatedCostUsd: sql<number>`coalesce(sum(estimated_cost_usd), 0)::float`,
      avgDurationMs: sql<number>`coalesce(round(avg(duration_ms))::int, 0)`,
      errors: sql<number>`sum(case when status_code >= 400 then 1 else 0 end)::int`,
    })
    .from(apiUsageLogs)
    .where(gte(apiUsageLogs.createdAt, since))
    .groupBy(apiUsageLogs.service, apiUsageLogs.endpoint, apiUsageLogs.method);

  const stats: ServiceStat[] = rows.map((r) => ({
    service: r.service,
    endpoint: r.endpoint ?? "(null)",
    method: r.method ?? "(null)",
    totalCalls: r.totalCalls,
    cacheHits: r.cacheHits,
    totalUnits: r.totalUnits,
    estimatedCostUsd: r.estimatedCostUsd,
    avgDurationMs: r.avgDurationMs,
    errors: r.errors,
  }));

  // Sortera: dyraste först, sen volym.
  stats.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalCalls - a.totalCalls);

  // Per-service totaler.
  const perService = new Map<string, { calls: number; units: number; cost: number; errors: number; cacheHits: number }>();
  for (const s of stats) {
    const cur = perService.get(s.service) ?? { calls: 0, units: 0, cost: 0, errors: 0, cacheHits: 0 };
    cur.calls += s.totalCalls;
    cur.units += s.totalUnits;
    cur.cost += s.estimatedCostUsd;
    cur.errors += s.errors;
    cur.cacheHits += s.cacheHits;
    perService.set(s.service, cur);
  }

  if (opts.json) {
    console.log(JSON.stringify({
      windowDays: opts.days,
      since: since.toISOString(),
      perService: Object.fromEntries(perService),
      perEndpoint: stats,
    }, null, 2));
    process.exit(0);
  }

  console.log(`\n=== API-usage audit (senaste ${opts.days} dagar, sedan ${since.toISOString().slice(0, 10)}) ===\n`);

  console.log("Per tjänst (totalt):");
  console.log("─".repeat(90));
  console.log(
    "service".padEnd(15) +
    "anrop".padStart(10) +
    "billable".padStart(12) +
    "cache-hits".padStart(12) +
    "hit%".padStart(8) +
    "errors".padStart(10) +
    "kostnad $".padStart(15),
  );
  console.log("─".repeat(90));
  const perServiceArr = Array.from(perService.entries()).sort((a, b) => b[1].cost - a[1].cost || b[1].calls - a[1].calls);
  for (const [svc, s] of perServiceArr) {
    const hitPct = s.calls > 0 ? Math.round((s.cacheHits / s.calls) * 100) : 0;
    console.log(
      svc.padEnd(15) +
      String(s.calls).padStart(10) +
      String(s.units).padStart(12) +
      String(s.cacheHits).padStart(12) +
      `${hitPct}%`.padStart(8) +
      String(s.errors).padStart(10) +
      s.cost.toFixed(4).padStart(15),
    );
  }
  console.log("─".repeat(90));

  console.log("\nTopp 25 endpoints (sorterat på kostnad, sen volym):");
  console.log("─".repeat(120));
  console.log(
    "service".padEnd(12) +
    "endpoint".padEnd(35) +
    "method".padEnd(20) +
    "anrop".padStart(8) +
    "billable".padStart(10) +
    "cache".padStart(8) +
    "errors".padStart(8) +
    "avg ms".padStart(8) +
    "kostnad $".padStart(12),
  );
  console.log("─".repeat(120));
  for (const s of stats.slice(0, 25)) {
    console.log(
      s.service.slice(0, 12).padEnd(12) +
      s.endpoint.slice(0, 34).padEnd(35) +
      s.method.slice(0, 19).padEnd(20) +
      String(s.totalCalls).padStart(8) +
      String(s.totalUnits).padStart(10) +
      String(s.cacheHits).padStart(8) +
      String(s.errors).padStart(8) +
      String(s.avgDurationMs).padStart(8) +
      s.estimatedCostUsd.toFixed(4).padStart(12),
    );
  }
  console.log("─".repeat(120));

  // Migrationsspecifik sammanfattning
  // OBS: service-namn varierar i api_usage_logs — nuvarande tracking använder
  // bl.a. "geoapify" (routing), "geoapify-geocoding" (geocode/search,
  // /geocode/reverse, autocomplete), "geocode-scheduler" (batch-jobb mot
  // Geoapify), "nominatim" (fallback) och "osrm" (matrix). Alla aggregeras
  // som "kartrelaterat" eftersom de alla flyttar till Google i Task #471.
  const sumServices = (names: string[]): number =>
    names.reduce((acc, n) => acc + (perService.get(n)?.calls ?? 0), 0);

  const geoapifyRoutingTotal = perService.get("geoapify")?.calls ?? 0;
  const geoapifyGeocodingTotal = sumServices(["geoapify-geocoding", "geocode-scheduler"]);
  const nominatimTotal = perService.get("nominatim")?.calls ?? 0;
  const googleTotal = perService.get("google-geocoding")?.calls ?? 0;
  const osrmTotal = perService.get("osrm")?.calls ?? 0;
  const totalMapCalls = geoapifyRoutingTotal + geoapifyGeocodingTotal + nominatimTotal + googleTotal + osrmTotal;

  console.log(`\n=== Migrationsbaseline (Task #471) ===`);
  console.log(`  Geoapify routing:    ${geoapifyRoutingTotal.toString().padStart(8)} anrop  (→ Google Routes API)`);
  console.log(`  Geoapify geocoding:  ${geoapifyGeocodingTotal.toString().padStart(8)} anrop  (geoapify-geocoding + geocode-scheduler → Google Geocoding API)`);
  console.log(`  Nominatim fallback:  ${nominatimTotal.toString().padStart(8)} anrop  (→ Google Geocoding API)`);
  console.log(`  google-geocoding:    ${googleTotal.toString().padStart(8)} anrop  (legacy label — granska)`);
  console.log(`  OSRM matrix:         ${osrmTotal.toString().padStart(8)} anrop  (→ Google Distance Matrix/Routes)`);
  console.log(`  TOTALT karta:        ${totalMapCalls.toString().padStart(8)} anrop\n`);

  // Varna om okända map-relaterade service-labels för att fånga framtida drift.
  const knownMapServices = new Set([
    "geoapify", "geoapify-geocoding", "geocode-scheduler",
    "nominatim", "google-geocoding", "osrm",
  ]);
  const unknownMapLike = Array.from(perService.keys())
    .filter((s) => !knownMapServices.has(s) && /geo|map|route|osrm|nominatim/i.test(s));
  if (unknownMapLike.length > 0) {
    console.log(`⚠️  Okända kart-liknande service-labels (lägg till i baselinen om relevanta):`);
    for (const s of unknownMapLike) {
      console.log(`     - ${s}: ${perService.get(s)?.calls ?? 0} anrop`);
    }
    console.log("");
  }

  if (totalMapCalls === 0) {
    console.log("⚠️  Inga karta/rutt-anrop loggade i fönstret. Bekräfta att trackApiUsage() faktiskt kallas i hot path.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[api-usage-audit] FEL:", err);
  process.exit(1);
});
