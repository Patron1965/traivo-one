/**
 * ML Data Quality Audit (Fas 0 — go/no-go-grind)
 *
 * Producerar en datakvalitetsrapport som svarar på frågan:
 *   "Har vi tillräckligt komplett historisk data för att kunna träna en
 *   LightGBM-modell som ger MAE ≤ 15% mot heuristisk baseline?"
 *
 * Grindkriterier (från task #421):
 *   - ≥70% av utförda WO de senaste 12 veckorna har actualDuration
 *   - ≥70% av dessa har scheduledDate, executionCode, objektkoordinater
 *   - ≥500 utförda WO totalt över alla tenants (för global modell)
 *
 * Kör: npx tsx scripts/ml-data-quality-audit.ts
 * Output: stdout JSON + markdown-sammanfattning
 */
import { db } from "../server/db";
import { workOrders, objects, mlFeatureSnapshots } from "../shared/schema";
import { sql, gte, eq, and, isNotNull, type SQL } from "drizzle-orm";

interface TenantQualityReport {
  tenantId: string;
  totalCompletedWO: number;
  withActualDuration: number;
  withScheduledDate: number;
  withExecutionCode: number;
  withCoordinates: number;
  qualityScore: number;
  passes70Gate: boolean;
}

interface OverallReport {
  generatedAt: string;
  windowDays: number;
  totalCompletedWO: number;
  passesVolumeGate: boolean;
  passesQualityGate: boolean;
  goNoGoRecommendation: "GO" | "NO_GO" | "WARN";
  reasoning: string[];
  tenants: TenantQualityReport[];
  snapshotStats: {
    preOptimization: number;
    postCompletion: number;
    last7Days: number;
  };
}

const WINDOW_DAYS = 84; // 12 veckor
const VOLUME_GATE = 500;
const QUALITY_GATE = 0.70;

async function buildReport(opts: { tenantId?: string } = {}): Promise<OverallReport> {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const baseConds: SQL[] = [
    eq(workOrders.orderStatus, "utford"),
    gte(workOrders.completedAt, cutoff),
  ];
  if (opts.tenantId) baseConds.push(eq(workOrders.tenantId, opts.tenantId));

  const tenantStats = await db.select({
    tenantId: workOrders.tenantId,
    totalCompletedWO: sql<number>`COUNT(*)::int`,
    withActualDuration: sql<number>`SUM(CASE WHEN ${workOrders.actualDuration} IS NOT NULL AND ${workOrders.actualDuration} > 0 THEN 1 ELSE 0 END)::int`,
    withScheduledDate: sql<number>`SUM(CASE WHEN ${workOrders.scheduledDate} IS NOT NULL THEN 1 ELSE 0 END)::int`,
    withExecutionCode: sql<number>`SUM(CASE WHEN ${workOrders.executionCode} IS NOT NULL AND ${workOrders.executionCode} != '' THEN 1 ELSE 0 END)::int`,
    withCoordinates: sql<number>`SUM(CASE WHEN ${workOrders.objectId} IS NOT NULL THEN 1 ELSE 0 END)::int`,
  })
    .from(workOrders)
    .where(and(...baseConds))
    .groupBy(workOrders.tenantId);

  const tenantReports: TenantQualityReport[] = tenantStats.map(t => {
    const total = Math.max(1, t.totalCompletedWO);
    const completeness = (
      (t.withActualDuration / total) * 0.4 +
      (t.withScheduledDate / total) * 0.2 +
      (t.withExecutionCode / total) * 0.2 +
      (t.withCoordinates / total) * 0.2
    );
    return {
      tenantId: t.tenantId,
      totalCompletedWO: t.totalCompletedWO,
      withActualDuration: t.withActualDuration,
      withScheduledDate: t.withScheduledDate,
      withExecutionCode: t.withExecutionCode,
      withCoordinates: t.withCoordinates,
      qualityScore: Math.round(completeness * 100) / 100,
      passes70Gate: completeness >= QUALITY_GATE,
    };
  });

  const totalCompleted = tenantReports.reduce((s, t) => s + t.totalCompletedWO, 0);
  const passesVolume = totalCompleted >= VOLUME_GATE;
  const passesQuality = tenantReports.length > 0 &&
    tenantReports.filter(t => t.passes70Gate).length / tenantReports.length >= 0.5;

  const reasoning: string[] = [];
  reasoning.push(`Mätfönster: senaste ${WINDOW_DAYS} dagarna (12 veckor)`);
  reasoning.push(`Total utförda WO över alla tenants: ${totalCompleted} (grind: ≥${VOLUME_GATE})`);
  reasoning.push(`Tenants som passerar 70%-grinden: ${tenantReports.filter(t => t.passes70Gate).length}/${tenantReports.length}`);

  let recommendation: OverallReport["goNoGoRecommendation"];
  if (passesVolume && passesQuality) {
    recommendation = "GO";
    reasoning.push("Rekommendation: GO för Fas 1 (träning + shadow).");
  } else if (totalCompleted >= VOLUME_GATE * 0.5) {
    recommendation = "WARN";
    reasoning.push("Rekommendation: VÄNTA 2-4 veckor och kör auditet igen — datavolym är låg men växande.");
  } else {
    recommendation = "NO_GO";
    reasoning.push("Rekommendation: NO_GO. För lite data för meningsfull träning. Verifiera att Fas 0 snapshot-skrivning är aktiv och att fältarbetare loggar actualDuration.");
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

  return {
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    totalCompletedWO: totalCompleted,
    passesVolumeGate: passesVolume,
    passesQualityGate: passesQuality,
    goNoGoRecommendation: recommendation,
    reasoning,
    tenants: tenantReports,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI: cross-tenant per default (kräver DB-access — engineer/ops only).
  const cliTenant = process.argv.find(a => a.startsWith("--tenant="))?.split("=")[1];
  buildReport({ tenantId: cliTenant }).then(report => {
    console.log(JSON.stringify(report, null, 2));
    console.log("\n---\nMARKDOWN-SAMMANFATTNING:\n---");
    console.log(`# ML Data Quality Audit — ${report.generatedAt}`);
    console.log(`\n**Rekommendation:** ${report.goNoGoRecommendation}`);
    console.log(`\n## Resonemang`);
    report.reasoning.forEach(r => console.log(`- ${r}`));
    console.log(`\n## Per tenant`);
    console.log(`| Tenant | WO totalt | Med actual | Kvalitet | Passerar |`);
    console.log(`|---|---|---|---|---|`);
    report.tenants.forEach(t => {
      console.log(`| ${t.tenantId} | ${t.totalCompletedWO} | ${t.withActualDuration} | ${(t.qualityScore * 100).toFixed(0)}% | ${t.passes70Gate ? "✓" : "✗"} |`);
    });
    process.exit(0);
  }).catch(err => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
}
