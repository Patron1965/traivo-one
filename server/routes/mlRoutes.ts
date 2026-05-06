/**
 * ML Routes (Fas 0 + Fas 1)
 *
 * Admin-only endpoints för datakvalitetsaudit och modellregister-inspektion.
 * Inferens-endpoint exponeras INTE här (sker via mlPredictionClient → optimization-service).
 */
import type { Express } from "express";
import { asyncHandler } from "../asyncHandler";
import { isAuthenticated } from "../replit_integrations/auth";
import { requireTenantWithFallback, requireAdmin, getTenantIdWithFallback } from "../tenant-middleware";
import { db } from "../db";
import { mlFeatureSnapshots, mlModels } from "@shared/schema";
import { sql, eq, desc } from "drizzle-orm";
import { runDataQualityAudit } from "../../scripts/ml-data-quality-audit";

export function registerMlRoutes(app: Express): void {
  // GET /api/ml/data-quality — kör audit on-demand (cachelös, under 5s)
  app.get(
    "/api/ml/data-quality",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const report = await runDataQualityAudit({ tenantId });
      res.json(report);
    })
  );

  // GET /api/ml/snapshots/stats — snapshot-volym per tenant + per dag
  app.get(
    "/api/ml/snapshots/stats",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const perDay = await db
        .select({
          day: sql<string>`DATE(${mlFeatureSnapshots.createdAt})::text`,
          kind: mlFeatureSnapshots.snapshotKind,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(mlFeatureSnapshots)
        .where(eq(mlFeatureSnapshots.tenantId, tenantId))
        .groupBy(sql`DATE(${mlFeatureSnapshots.createdAt})`, mlFeatureSnapshots.snapshotKind)
        .orderBy(desc(sql`DATE(${mlFeatureSnapshots.createdAt})`))
        .limit(60);

      const [totals] = await db
        .select({
          total: sql<number>`COUNT(*)::int`,
          pre: sql<number>`SUM(CASE WHEN ${mlFeatureSnapshots.snapshotKind} = 'pre_optimization' THEN 1 ELSE 0 END)::int`,
          post: sql<number>`SUM(CASE WHEN ${mlFeatureSnapshots.snapshotKind} = 'post_completion' THEN 1 ELSE 0 END)::int`,
        })
        .from(mlFeatureSnapshots)
        .where(eq(mlFeatureSnapshots.tenantId, tenantId));

      res.json({ tenantId, totals, perDay });
    })
  );

  // GET /api/ml/models — lista modellregister (vilka tränats, status)
  app.get(
    "/api/ml/models",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const models = await db.select().from(mlModels).orderBy(desc(mlModels.createdAt)).limit(50);
      res.json({ models, mlPredictionEnabled: process.env.ML_PREDICTION_ENABLED === "true" });
    })
  );
}
