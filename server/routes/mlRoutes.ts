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
import { z } from "zod";
import { runDataQualityAudit, writeBaselineReport } from "../../scripts/ml-data-quality-audit";
import { predictDurations, type PredictionRequestRow } from "../services/mlPredictionClient";

const predictJobSchema = z.object({
  workOrderId: z.string().min(1),
  estimatedDurationMin: z.number().nonnegative(),
  executionCode: z.string().nullish(),
  taskCategory: z.string().nullish(),
  weekday: z.number().int().min(0).max(6).nullish(),
  hourOfDay: z.number().int().min(0).max(23).nullish(),
  isWeekend: z.boolean().nullish(),
  objectLat: z.number().nullish(),
  objectLng: z.number().nullish(),
});
const predictBodySchema = z.object({
  jobs: z.array(predictJobSchema).min(1).max(500),
});

const PLATFORM_OWNER_TENANT = "kinab";

export function registerMlRoutes(app: Express): void {
  // GET /api/ml/data-quality — kör audit on-demand
  // Default: tenant-scoped. ?scope=platform tillåts endast för platform-owner-tenant.
  app.get(
    "/api/ml/data-quality",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const wantsPlatform = req.query.scope === "platform";
      const allowPlatform = wantsPlatform && tenantId === PLATFORM_OWNER_TENANT;
      const report = await runDataQualityAudit(allowPlatform ? {} : { tenantId });
      res.json({ ...report, scope: allowPlatform ? "platform" : "tenant" });
    })
  );

  // POST /api/ml/data-quality/baseline — skriv baseline-rapport till docs/
  // Endast platform-owner-tenant. Idempotent per månad (YYYY-MM).
  app.post(
    "/api/ml/data-quality/baseline",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      if (tenantId !== PLATFORM_OWNER_TENANT) {
        return res.status(403).json({ error: "Endast platform-owner kan skriva baseline" });
      }
      const report = await runDataQualityAudit({});
      const filePath = await writeBaselineReport(report);
      res.json({ filePath, recommendation: report.goNoGoRecommendation });
    })
  );

  // POST /api/ml/predict/durations — admin-endpoint för manuell smoke-test av Fas 1.
  // Body: { tenantId, jobs: [{ workOrderId, executionCode, estimatedDurationMin, ... }] }
  // Response: { predictions: [{ workOrderId, durationP50Sec, durationP90Sec, fallbackUsed }] }
  // Returnerar fallback (estimatedDurationMin * 60) om ML_PREDICTION_ENABLED!=true.
  app.post(
    "/api/ml/predict/durations",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const parsed = predictBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "ogiltig payload", issues: parsed.error.issues });
      }
      const jobs: PredictionRequestRow[] = parsed.data.jobs;
      const result = await predictDurations({ tenantId, jobs });
      const predictions = jobs.map((j, i) => {
        const fallbackSec = Math.round((j.estimatedDurationMin || 30) * 60);
        const pred = result?.[i];
        if (!pred) {
          return {
            workOrderId: j.workOrderId,
            durationP50Sec: fallbackSec,
            durationP90Sec: Math.round(fallbackSec * 1.3),
            fallbackUsed: true,
          };
        }
        return {
          workOrderId: j.workOrderId,
          durationP50Sec: pred.p50Sec ?? fallbackSec,
          durationP90Sec: pred.p90Sec ?? Math.round((pred.p50Sec ?? fallbackSec) * 1.3),
          fallbackUsed: pred.fallbackUsed === true,
        };
      });
      res.json({
        predictions,
        mlPredictionEnabled: process.env.ML_PREDICTION_ENABLED === "true",
      });
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
