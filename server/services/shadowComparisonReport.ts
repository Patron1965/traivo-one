/**
 * Shadow Comparison Report Aggregation (Task #477).
 *
 * Delar samma logik som CLI-skriptet `scripts/shadow-comparison-report.ts`
 * men exponerar den som en återanvändbar service så Admin-vyn kan visa
 * median/p95-deltan, shadow-volym, kostnadsprojektion och larmflaggor.
 *
 * All läsning är read-only och rör inte produktionsdata.
 */
import { db } from "../db";
import { mapShadowComparisons, type MapShadowComparison } from "@shared/schema";
import { gte } from "drizzle-orm";

export type ShadowReportOperation = "geocode" | "route" | "matrix" | "vrp";

export interface DeltaStats {
  median: number | null;
  p95: number | null;
  absMedian: number | null;
  absP95: number | null;
  count: number;
}

export interface OperationSummary {
  operation: string;
  total: number;
  shadowOk: number;
  shadowFailed: number;
  failureRatePct: number;
  primaryLatency: { medianMs: number | null; p95Ms: number | null };
  shadowLatency: { medianMs: number | null; p95Ms: number | null };
  deltas: Record<string, DeltaStats>;
  cost: {
    pricePer1k: number | null;
    sampleCount: number;
    projected30d: number;
    fullVolume30d: number;
    estimatedCostUsd30d: number | null;
    sampleRate: number | null;
  };
}

export interface ShadowReportSummary {
  windowDays: number;
  since: string;
  totalRows: number;
  primaryProviders: string[];
  shadowProviders: string[];
  sampleRate: number | null;
  thresholds: {
    failureRatePct: number;
    distanceP95Km: number;
  };
  alerts: Array<{
    severity: "warning" | "critical";
    operation: string;
    metric: string;
    value: number;
    threshold: number;
    message: string;
  }>;
  operations: OperationSummary[];
}

// Approx Google-priser (per 1k requests, 2025-Q1 publika listpriser).
// Endast grova skattningar för budgetdiskussion.
const GOOGLE_PRICE_PER_1K: Record<string, number> = {
  geocode: 5.0,
  route: 5.0,
  matrix: 5.0,
  vrp: 0,
};

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function readSampleRate(): number | null {
  const raw = process.env.MAP_SHADOW_SAMPLE_RATE;
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1) return 1;
  return n;
}

function readThresholds() {
  const failure = Number.parseFloat(process.env.MAP_SHADOW_ERROR_THRESHOLD_PCT ?? "5");
  const distance = Number.parseFloat(process.env.MAP_SHADOW_DISTANCE_P95_KM ?? "5");
  return {
    failureRatePct: Number.isFinite(failure) && failure > 0 ? failure : 5,
    distanceP95Km: Number.isFinite(distance) && distance > 0 ? distance : 5,
  };
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function statsFor(values: number[]): DeltaStats {
  if (values.length === 0) {
    return { median: null, p95: null, absMedian: null, absP95: null, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const abs = sorted.map((v) => Math.abs(v)).sort((a, b) => a - b);
  return {
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    absMedian: quantile(abs, 0.5),
    absP95: quantile(abs, 0.95),
    count: values.length,
  };
}

export async function fetchShadowRows(days: number): Promise<MapShadowComparison[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(mapShadowComparisons)
    .where(gte(mapShadowComparisons.createdAt, since));
}

export function buildShadowSummary(
  rows: MapShadowComparison[],
  days: number,
): ShadowReportSummary {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sampleRate = readSampleRate();
  const thresholds = readThresholds();

  const byOp = new Map<string, MapShadowComparison[]>();
  for (const r of rows) {
    const arr = byOp.get(r.operation) ?? [];
    arr.push(r);
    byOp.set(r.operation, arr);
  }

  const days30 = days > 0 ? 30 / days : 0;
  const operations: OperationSummary[] = [];
  const alerts: ShadowReportSummary["alerts"] = [];

  for (const [op, opRows] of Array.from(byOp.entries())) {
    const ok = opRows.filter((r) => r.shadowOk);
    const failed = opRows.length - ok.length;
    const failureRatePct = opRows.length > 0 ? (failed / opRows.length) * 100 : 0;

    const primaryDur = opRows
      .map((r) => r.primaryDurationMs ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const shadowDur = opRows
      .map((r) => r.shadowDurationMs ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);

    const deltaKeys = new Set<string>();
    for (const r of ok) {
      const d = (r.deltas ?? null) as Record<string, unknown> | null;
      if (d) for (const k of Object.keys(d)) deltaKeys.add(k);
    }

    const deltas: Record<string, DeltaStats> = {};
    for (const key of Array.from(deltaKeys).sort()) {
      const values: number[] = [];
      for (const r of ok) {
        const d = r.deltas as Record<string, unknown> | null;
        const v = d?.[key];
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
      }
      deltas[key] = statsFor(values);
    }

    const price = GOOGLE_PRICE_PER_1K[op] ?? null;
    const projected30d = ok.length * days30;
    const fullVolume30d = sampleRate && sampleRate > 0 ? projected30d / sampleRate : projected30d;
    const estimatedCostUsd30d =
      price !== null && price > 0 ? (fullVolume30d / 1000) * price : price === 0 ? 0 : null;

    operations.push({
      operation: op,
      total: opRows.length,
      shadowOk: ok.length,
      shadowFailed: failed,
      failureRatePct,
      primaryLatency: {
        medianMs: quantile(primaryDur, 0.5),
        p95Ms: quantile(primaryDur, 0.95),
      },
      shadowLatency: {
        medianMs: quantile(shadowDur, 0.5),
        p95Ms: quantile(shadowDur, 0.95),
      },
      deltas,
      cost: {
        pricePer1k: price,
        sampleCount: ok.length,
        projected30d,
        fullVolume30d,
        estimatedCostUsd30d,
        sampleRate,
      },
    });

    if (opRows.length >= 20 && failureRatePct > thresholds.failureRatePct) {
      alerts.push({
        severity: failureRatePct > thresholds.failureRatePct * 2 ? "critical" : "warning",
        operation: op,
        metric: "failureRatePct",
        value: failureRatePct,
        threshold: thresholds.failureRatePct,
        message: `Shadow-fel för ${op} är ${failureRatePct.toFixed(1)}% (>${thresholds.failureRatePct}%).`,
      });
    }

    const distP95 = deltas["distanceKmDelta"]?.absP95;
    if (distP95 != null && distP95 > thresholds.distanceP95Km) {
      alerts.push({
        severity: distP95 > thresholds.distanceP95Km * 2 ? "critical" : "warning",
        operation: op,
        metric: "distanceKmAbsP95",
        value: distP95,
        threshold: thresholds.distanceP95Km,
        message: `|Δ distans| p95 för ${op} är ${distP95.toFixed(2)} km (>${thresholds.distanceP95Km} km).`,
      });
    }
  }

  operations.sort((a, b) => a.operation.localeCompare(b.operation));

  return {
    windowDays: days,
    since: since.toISOString(),
    totalRows: rows.length,
    primaryProviders: unique(rows.map((r) => r.primaryProvider)),
    shadowProviders: unique(rows.map((r) => r.shadowProvider)),
    sampleRate,
    thresholds,
    alerts,
    operations,
  };
}

export async function getShadowSummary(days: number): Promise<ShadowReportSummary> {
  const rows = await fetchShadowRows(days);
  return buildShadowSummary(rows, days);
}

export async function buildShadowComparisonCsv(days: number): Promise<string> {
  const rows = await fetchShadowRows(days);
  const header = [
    "createdAt",
    "operation",
    "primaryProvider",
    "shadowProvider",
    "primaryOk",
    "shadowOk",
    "primaryDurationMs",
    "shadowDurationMs",
    "shadowError",
    "distanceKmDelta",
    "durationMinDelta",
    "distanceKmRelPct",
    "durationMinRelPct",
    "distanceMeters",
    "tenantId",
    "requestHash",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const d = (r.deltas ?? {}) as Record<string, unknown>;
    const row = [
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ""),
      r.operation,
      r.primaryProvider,
      r.shadowProvider,
      r.primaryOk == null ? "" : String(r.primaryOk),
      r.shadowOk == null ? "" : String(r.shadowOk),
      r.primaryDurationMs ?? "",
      r.shadowDurationMs ?? "",
      r.shadowError ?? "",
      typeof d.distanceKmDelta === "number" ? d.distanceKmDelta : "",
      typeof d.durationMinDelta === "number" ? d.durationMinDelta : "",
      typeof d.distanceKmRelPct === "number" ? d.distanceKmRelPct : "",
      typeof d.durationMinRelPct === "number" ? d.durationMinRelPct : "",
      typeof d.distanceMeters === "number" ? d.distanceMeters : "",
      r.tenantId ?? "",
      r.requestHash,
    ];
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\n");
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
