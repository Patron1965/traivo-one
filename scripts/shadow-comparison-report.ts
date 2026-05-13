/**
 * Shadow Comparison Report (Task #472, Fas 1).
 *
 * Aggregerar `map_shadow_comparisons` och skriver ut median/p95-deltan per
 * operation samt grov kostnadsprojektion för shadow-providern.
 *
 * Körning:
 *   npx tsx scripts/shadow-comparison-report.ts            # senaste 7 dagar
 *   npx tsx scripts/shadow-comparison-report.ts --days=30  # custom fönster
 *
 * Rapporten är read-only och mutiterar ingen produktionsdata.
 */
import { db } from "../server/db";
import { mapShadowComparisons } from "../shared/schema";
import { gte, sql } from "drizzle-orm";

interface CliOptions {
  days: number;
}

function parseArgs(): CliOptions {
  let days = 7;
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--days=(\d+)$/);
    if (m) days = Math.max(1, Number.parseInt(m[1], 10));
  }
  return { days };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

// Approx Google-priser (per 1k requests, 2025-Q1 publika listpriser).
// Dessa är ENDAST grovskattningar för budgetdiskussion. Verkliga kostnader
// beror på volume tier, region och Maps Platform-rabatter.
const GOOGLE_PRICE_PER_1K: Record<string, number> = {
  geocode: 5.0, // Geocoding API
  route: 5.0,   // Routes API (compute_routes)
  matrix: 5.0,  // Routes API matrix-element pris
  vrp: 0,       // Route Optimization API faktureras per attempt — ej modellerad här
};

async function main() {
  const { days } = parseArgs();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.log(`\nMap Shadow Comparison Report (senaste ${days} dagar, sedan ${since.toISOString()})`);
  console.log("=".repeat(80));

  const rows = await db
    .select()
    .from(mapShadowComparisons)
    .where(gte(mapShadowComparisons.createdAt, since));

  if (rows.length === 0) {
    console.log("\nInga shadow-rader i fönstret. Säkerställ att MAP_SHADOW_SAMPLE_RATE > 0 och att en shadow-provider är konfigurerad.\n");
    return;
  }

  console.log(`Totalt rader: ${rows.length}`);
  console.log(`Primär providers: ${unique(rows.map((r) => r.primaryProvider)).join(", ")}`);
  console.log(`Shadow providers: ${unique(rows.map((r) => r.shadowProvider)).join(", ")}`);

  // ---- Per-operation aggregering ----
  const byOp = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byOp.get(r.operation) ?? [];
    arr.push(r);
    byOp.set(r.operation, arr);
  }

  for (const [op, opRows] of byOp) {
    const ok = opRows.filter((r) => r.shadowOk);
    const failed = opRows.length - ok.length;
    console.log(`\n— Operation: ${op} (n=${opRows.length}, shadow-ok=${ok.length}, shadow-fel=${failed}) —`);

    const primaryDur = opRows.map((r) => r.primaryDurationMs ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
    const shadowDur = opRows.map((r) => r.shadowDurationMs ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
    if (primaryDur.length > 0) {
      console.log(`  Primary latency ms — median ${fmt(quantile(primaryDur, 0.5), 0)}, p95 ${fmt(quantile(primaryDur, 0.95), 0)}`);
    }
    if (shadowDur.length > 0) {
      console.log(`  Shadow latency ms  — median ${fmt(quantile(shadowDur, 0.5), 0)}, p95 ${fmt(quantile(shadowDur, 0.95), 0)}`);
    }

    // Delta-analys per nyckel
    const deltaKeys = new Set<string>();
    for (const r of ok) {
      const d = (r.deltas ?? null) as Record<string, unknown> | null;
      if (d) for (const k of Object.keys(d)) deltaKeys.add(k);
    }

    for (const key of Array.from(deltaKeys).sort()) {
      const values: number[] = [];
      for (const r of ok) {
        const d = r.deltas as Record<string, unknown> | null;
        const v = d?.[key];
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
      }
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      const abs = sorted.map((v) => Math.abs(v)).sort((a, b) => a - b);
      console.log(
        `  Δ ${key.padEnd(22)} median=${fmt(quantile(sorted, 0.5))}  p95=${fmt(quantile(sorted, 0.95))}  |Δ|median=${fmt(quantile(abs, 0.5))}  |Δ|p95=${fmt(quantile(abs, 0.95))}`,
      );
    }
  }

  // ---- Grov kostnadsprojektion ----
  console.log("\n— Kostnadsprojektion (grov, baserad på shadow-volym i fönstret) —");
  const days30 = 30 / days;
  for (const [op, opRows] of byOp) {
    const okCount = opRows.filter((r) => r.shadowOk).length;
    const price = GOOGLE_PRICE_PER_1K[op] ?? 0;
    if (price === 0) {
      console.log(`  ${op.padEnd(8)} ${okCount.toString().padStart(6)} shadow-anrop  — pris ej modellerad`);
      continue;
    }
    const projected30d = okCount * days30;
    const sampleRate = Number.parseFloat(process.env.MAP_SHADOW_SAMPLE_RATE ?? "0") || 0;
    const fullVolume = sampleRate > 0 ? projected30d / sampleRate : projected30d;
    const cost30d = (fullVolume / 1000) * price;
    console.log(
      `  ${op.padEnd(8)} ${okCount.toString().padStart(6)} shadow-anrop  → ~${Math.round(projected30d)} sample/30d  →  full volym ~${Math.round(fullVolume)} → ~$${fmt(cost30d, 2)}/månad @ $${price}/1k`,
    );
  }

  console.log("\nKlar.\n");
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[shadow-report] FAILED:", err);
    process.exit(1);
  });
