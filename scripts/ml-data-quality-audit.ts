/**
 * ML Data Quality Audit (Fas 0 — go/no-go-grind)
 *
 * Producerar en datakvalitetsrapport som svarar på frågan:
 *   "Har vi tillräckligt komplett historisk data för att kunna träna en
 *   LightGBM-modell som ger MAE ≤ 15% mot heuristisk baseline?"
 *
 * Grindkriterier (från task #421):
 *   - Mätfönster: 12 månader (365 dagar) av utförda WO
 *   - ≥70% har actualDuration inom rimligt intervall (5 min – 12 h)
 *   - ≥70% har scheduledDate, executionCode, objektkoppling
 *   - ≥500 utförda WO totalt (för global modell)
 *   - Per-executionCode breakdown: minst 30 prov per kod för stratifiering
 *   - Setup-log linkage: andel WO med matchande setup_time_logs
 *
 * Kör (CLI): npx tsx scripts/ml-data-quality-audit-cli.ts [--tenant=<id>] [--write-baseline]
 * Detta är biblioteksmodulen (inga sidoeffekter vid import); CLI-entry ligger i *-cli.ts.
 * Output: stdout JSON + markdown-sammanfattning
 */
import { db } from "../server/db";
import { workOrders, mlFeatureSnapshots, setupTimeLogs } from "../shared/schema";
import { sql, gte, eq, and, type SQL } from "drizzle-orm";

const VALID_DURATION_MIN = 5;
const VALID_DURATION_MAX = 720; // 12h
const WINDOW_DAYS = 365; // 12 månader
const VOLUME_GATE = 500;
const QUALITY_GATE = 0.70;
const MIN_SAMPLES_PER_CODE = 30;

interface TenantQualityReport {
  tenantId: string;
  totalCompletedWO: number;
  withActualDuration: number;
  withValidActualDuration: number; // 5min – 12h
  withScheduledDate: number;
  withExecutionCode: number;
  withCoordinates: number;
  withSetupLogLink: number;
  qualityScore: number;
  passes70Gate: boolean;
}

interface ExecutionCodeStats {
  executionCode: string;
  sampleCount: number;
  meanActualMin: number | null;
  hasEnoughSamples: boolean;
}

/**
 * Readiness-nivåer (per Abacus-feedback):
 *   - 'not_ready'           (<70% valid actualDuration)  → fallback till statisk duration
 *   - 'shadow_only'         (70–85%)                     → ML körs i shadow, prediktioner loggas men används inte
 *   - 'production_eligible' (≥85%)                       → ML kan promoveras till active vid GO
 */
export type MlReadinessLevel = "not_ready" | "shadow_only" | "production_eligible";

interface OverallReport {
  generatedAt: string;
  windowDays: number;
  totalCompletedWO: number;
  globalValidActualRatio: number;
  passesVolumeGate: boolean;
  passesQualityGate: boolean;
  readinessLevel: MlReadinessLevel;
  goNoGoRecommendation: "GO" | "NO_GO" | "WARN";
  reasoning: string[];
  tenants: TenantQualityReport[];
  perExecutionCode: ExecutionCodeStats[];
  snapshotStats: {
    preOptimization: number;
    postCompletion: number;
    last7Days: number;
  };
}

const READINESS_SHADOW_THRESHOLD = 0.70;
const READINESS_PRODUCTION_THRESHOLD = 0.85;

function classifyReadiness(globalValidRatio: number): MlReadinessLevel {
  if (globalValidRatio >= READINESS_PRODUCTION_THRESHOLD) return "production_eligible";
  if (globalValidRatio >= READINESS_SHADOW_THRESHOLD) return "shadow_only";
  return "not_ready";
}

export async function buildReport(opts: { tenantId?: string } = {}): Promise<OverallReport> {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const baseConds: SQL[] = [
    eq(workOrders.orderStatus, "utford"),
    gte(workOrders.completedAt, cutoff),
  ];
  if (opts.tenantId) baseConds.push(eq(workOrders.tenantId, opts.tenantId));

  // Per-tenant grundstats
  const validRangeExpr = sql`${workOrders.actualDuration} IS NOT NULL AND ${workOrders.actualDuration} BETWEEN ${VALID_DURATION_MIN} AND ${VALID_DURATION_MAX}`;
  const tenantStats = await db.select({
    tenantId: workOrders.tenantId,
    totalCompletedWO: sql<number>`COUNT(*)::int`,
    withActualDuration: sql<number>`SUM(CASE WHEN ${workOrders.actualDuration} IS NOT NULL AND ${workOrders.actualDuration} > 0 THEN 1 ELSE 0 END)::int`,
    withValidActualDuration: sql<number>`SUM(CASE WHEN ${validRangeExpr} THEN 1 ELSE 0 END)::int`,
    withScheduledDate: sql<number>`SUM(CASE WHEN ${workOrders.scheduledDate} IS NOT NULL THEN 1 ELSE 0 END)::int`,
    withExecutionCode: sql<number>`SUM(CASE WHEN ${workOrders.executionCode} IS NOT NULL AND ${workOrders.executionCode} != '' THEN 1 ELSE 0 END)::int`,
    withCoordinates: sql<number>`SUM(CASE WHEN ${workOrders.objectId} IS NOT NULL THEN 1 ELSE 0 END)::int`,
  })
    .from(workOrders)
    .where(and(...baseConds))
    .groupBy(workOrders.tenantId);

  // Setup-log-linkage: räkna distinct WO som har minst en setup_time_logs-rad
  const setupLinkRows = await db.execute(sql`
    SELECT wo.tenant_id::text AS tenant_id, COUNT(DISTINCT wo.id)::int AS with_setup
    FROM work_orders wo
    INNER JOIN setup_time_logs stl ON stl.work_order_id = wo.id
    WHERE wo.order_status = 'utford'
      AND wo.completed_at >= ${cutoff}
      ${opts.tenantId ? sql`AND wo.tenant_id = ${opts.tenantId}` : sql``}
    GROUP BY wo.tenant_id
  `);
  const setupLinkMap = new Map<string, number>();
  for (const row of setupLinkRows.rows as Array<{ tenant_id: string; with_setup: number }>) {
    setupLinkMap.set(row.tenant_id, row.with_setup);
  }

  const tenantReports: TenantQualityReport[] = tenantStats.map(t => {
    const total = Math.max(1, t.totalCompletedWO);
    const withSetupLogLink = setupLinkMap.get(t.tenantId) ?? 0;
    // Quality = vägd kompletthet med valid-range som dominant signal
    const completeness = (
      (t.withValidActualDuration / total) * 0.5 +
      (t.withScheduledDate / total) * 0.15 +
      (t.withExecutionCode / total) * 0.2 +
      (t.withCoordinates / total) * 0.15
    );
    return {
      tenantId: t.tenantId,
      totalCompletedWO: t.totalCompletedWO,
      withActualDuration: t.withActualDuration,
      withValidActualDuration: t.withValidActualDuration,
      withScheduledDate: t.withScheduledDate,
      withExecutionCode: t.withExecutionCode,
      withCoordinates: t.withCoordinates,
      withSetupLogLink,
      qualityScore: Math.round(completeness * 100) / 100,
      passes70Gate: completeness >= QUALITY_GATE,
    };
  });

  // Per-executionCode breakdown
  const codeConds: SQL[] = [
    eq(workOrders.orderStatus, "utford"),
    gte(workOrders.completedAt, cutoff),
    sql`${workOrders.executionCode} IS NOT NULL AND ${workOrders.executionCode} != ''`,
    sql`${workOrders.actualDuration} BETWEEN ${VALID_DURATION_MIN} AND ${VALID_DURATION_MAX}`,
  ];
  if (opts.tenantId) codeConds.push(eq(workOrders.tenantId, opts.tenantId));
  const codeStats = await db.select({
    executionCode: workOrders.executionCode,
    sampleCount: sql<number>`COUNT(*)::int`,
    meanActualMin: sql<number>`AVG(${workOrders.actualDuration})::float`,
  })
    .from(workOrders)
    .where(and(...codeConds))
    .groupBy(workOrders.executionCode)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(50);

  const perExecutionCode: ExecutionCodeStats[] = codeStats.map(c => ({
    executionCode: c.executionCode ?? "(saknas)",
    sampleCount: c.sampleCount,
    meanActualMin: c.meanActualMin != null ? Math.round(c.meanActualMin * 10) / 10 : null,
    hasEnoughSamples: c.sampleCount >= MIN_SAMPLES_PER_CODE,
  }));

  const totalCompleted = tenantReports.reduce((s, t) => s + t.totalCompletedWO, 0);
  const totalValidActual = tenantReports.reduce((s, t) => s + t.withValidActualDuration, 0);
  const globalValidActualRatio = totalCompleted > 0 ? totalValidActual / totalCompleted : 0;
  const passesVolume = totalCompleted >= VOLUME_GATE;
  // HARD GATE per task #421: global validActualDuration / completedWO >= 0.70.
  // Om denna grind inte passerar kan rekommendationen ALDRIG bli GO.
  const passesQuality = globalValidActualRatio >= QUALITY_GATE;

  const reasoning: string[] = [];
  reasoning.push(`Mätfönster: senaste ${WINDOW_DAYS} dagarna (12 månader)`);
  reasoning.push(`Total utförda WO i fönstret: ${totalCompleted} (grind: ≥${VOLUME_GATE})`);
  reasoning.push(`actualDuration valideras till intervall ${VALID_DURATION_MIN}–${VALID_DURATION_MAX} min`);
  reasoning.push(`Global andel WO med valid actualDuration: ${(globalValidActualRatio * 100).toFixed(1)}% (HARD-grind: ≥${QUALITY_GATE * 100}%)`);
  const codesWithEnough = perExecutionCode.filter(c => c.hasEnoughSamples).length;
  reasoning.push(`ExecutionCodes med ≥${MIN_SAMPLES_PER_CODE} prov (för stratifiering): ${codesWithEnough}/${perExecutionCode.length}`);

  let recommendation: OverallReport["goNoGoRecommendation"];
  if (passesVolume && passesQuality && codesWithEnough >= 3) {
    recommendation = "GO";
    reasoning.push("Rekommendation: GO för Fas 1 (träning + shadow).");
  } else if (!passesQuality) {
    recommendation = "NO_GO";
    reasoning.push(`Rekommendation: NO_GO. Hard-grinden faller — endast ${(globalValidActualRatio * 100).toFixed(1)}% av WO har valid actualDuration. Verifiera att fältarbetare loggar tider.`);
  } else if (totalCompleted >= VOLUME_GATE * 0.5) {
    recommendation = "WARN";
    reasoning.push("Rekommendation: VÄNTA. Datavolym växande men volym eller stratifiering otillräcklig.");
  } else {
    recommendation = "NO_GO";
    reasoning.push("Rekommendation: NO_GO. För lite data för meningsfull träning.");
  }

  // Snapshot-statistik (visar att Fas 0-instrumenteringen fungerar)
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const snapQuery = db.select({
    preOptimization: sql<number>`SUM(CASE WHEN ${mlFeatureSnapshots.snapshotKind} = 'pre_optimization' THEN 1 ELSE 0 END)::int`,
    postCompletion: sql<number>`SUM(CASE WHEN ${mlFeatureSnapshots.snapshotKind} = 'post_completion' THEN 1 ELSE 0 END)::int`,
    last7Days: sql<number>`SUM(CASE WHEN ${mlFeatureSnapshots.createdAt} >= ${last7d} THEN 1 ELSE 0 END)::int`,
  }).from(mlFeatureSnapshots);
  const [snapshotStats] = await (opts.tenantId
    ? snapQuery.where(eq(mlFeatureSnapshots.tenantId, opts.tenantId))
    : snapQuery);

  const readinessLevel = classifyReadiness(globalValidActualRatio);
  reasoning.push(`Readiness-nivå: ${readinessLevel} (tröskel shadow ≥${READINESS_SHADOW_THRESHOLD * 100}%, production ≥${READINESS_PRODUCTION_THRESHOLD * 100}%)`);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    totalCompletedWO: totalCompleted,
    globalValidActualRatio: Math.round(globalValidActualRatio * 1000) / 1000,
    passesVolumeGate: passesVolume,
    passesQualityGate: passesQuality,
    readinessLevel,
    goNoGoRecommendation: recommendation,
    reasoning,
    tenants: tenantReports,
    perExecutionCode,
    snapshotStats: {
      preOptimization: snapshotStats?.preOptimization ?? 0,
      postCompletion: snapshotStats?.postCompletion ?? 0,
      last7Days: snapshotStats?.last7Days ?? 0,
    },
  };
}

/** Tenant-scoped audit (anropas från admin-route — visar endast den anropande tenantens data). */
export async function runDataQualityAudit(opts: { tenantId?: string } = {}): Promise<OverallReport> {
  return buildReport(opts);
}

export function buildMarkdown(report: OverallReport): string {
  const lines: string[] = [];
  lines.push(`# ML Data Quality Audit — ${report.generatedAt}`);
  lines.push(``);
  lines.push(`**Rekommendation:** ${report.goNoGoRecommendation}`);
  lines.push(`**Mätfönster:** ${report.windowDays} dagar`);
  lines.push(`**Volym-grind:** ${report.passesVolumeGate ? "PASS" : "FAIL"}`);
  lines.push(`**Kvalitets-grind (hard):** ${report.passesQualityGate ? "PASS" : "FAIL"}`);
  lines.push(``);
  lines.push(`## Resonemang`);
  report.reasoning.forEach(r => lines.push(`- ${r}`));
  lines.push(``);
  lines.push(`## Per tenant`);
  lines.push(`| Tenant | WO | Valid actual | Med setup-log | Kvalitet | Passerar |`);
  lines.push(`|---|---|---|---|---|---|`);
  report.tenants.forEach(t => {
    lines.push(`| ${t.tenantId} | ${t.totalCompletedWO} | ${t.withValidActualDuration} | ${t.withSetupLogLink} | ${(t.qualityScore * 100).toFixed(0)}% | ${t.passes70Gate ? "✓" : "✗"} |`);
  });
  lines.push(``);
  lines.push(`## Per execution code (top 20)`);
  lines.push(`| Kod | Prov | Snitt min | Stratifierbar |`);
  lines.push(`|---|---|---|---|`);
  report.perExecutionCode.slice(0, 20).forEach(c => {
    lines.push(`| ${c.executionCode} | ${c.sampleCount} | ${c.meanActualMin ?? "—"} | ${c.hasEnoughSamples ? "✓" : "✗"} |`);
  });
  lines.push(``);
  lines.push(`## Snapshot-instrumentering`);
  lines.push(`- pre_optimization: ${report.snapshotStats.preOptimization}`);
  lines.push(`- post_completion: ${report.snapshotStats.postCompletion}`);
  lines.push(`- senaste 7 dagar: ${report.snapshotStats.last7Days}`);
  return lines.join("\n");
}

/** Skriver baseline-rapport till docs/ml-data-quality-baseline-YYYY-MM.md (idempotent per månad). */
export async function writeBaselineReport(report: OverallReport): Promise<string> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const date = new Date(report.generatedAt);
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const filePath = path.resolve(process.cwd(), "docs", `ml-data-quality-baseline-${ym}.md`);
  await fs.writeFile(filePath, buildMarkdown(report), "utf-8");
  return filePath;
}
