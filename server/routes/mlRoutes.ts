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
import { ValidationError, ForbiddenError, ConflictError } from "../errors";
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
        throw new ForbiddenError("Endast platform-owner kan skriva baseline");
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
        throw new ValidationError("ogiltig payload", { issues: parsed.error.issues });
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

  // POST /api/ml/models/:id/promote — Blue-green lifecycle.
  // Tillåtna övergångar (target):
  //   training  → shadow
  //   shadow    → canary    (rolloutPercentage 1–50)
  //   canary    → active    (sätter föregående aktiva → deprecated, sparar previousModelId)
  //   active    → deprecated
  // Endast platform-owner-tenant. Idempotent: omkörning med samma target+rollout är no-op.
  const promoteSchema = z.object({
    targetStatus: z.enum(["shadow", "canary", "active", "deprecated"]),
    rolloutPercentage: z.number().int().min(0).max(100).optional(),
  });
  app.post(
    "/api/ml/models/:id/promote",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      if (tenantId !== PLATFORM_OWNER_TENANT) {
        throw new ForbiddenError("Endast platform-owner kan ändra ML-modellstatus");
      }
      const parsed = promoteSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("ogiltig payload", { issues: parsed.error.issues });
      }
      const { targetStatus, rolloutPercentage } = parsed.data;

      // Kör hela övergången i en transaktion + FOR UPDATE-lås för att förhindra
      // race där två samtidiga promote:s skulle kunna skapa två actives.
      // DB har även partial unique index "uq_ml_models_one_active_per_type" som
      // sista försvarslinje (migration 0037).
      try {
        const result = await db.transaction(async (tx) => {
          const lockedRows = await tx.execute(
            sql`SELECT * FROM ml_models WHERE id = ${req.params.id} FOR UPDATE`
          );
          const model = (lockedRows.rows?.[0] as typeof mlModels.$inferSelect | undefined);
          if (!model) return { status: 404 as const, body: { error: "modell saknas" } };

          const allowed: Record<string, string[]> = {
            training: ["shadow"],
            shadow: ["canary", "deprecated"],
            canary: ["active", "shadow", "deprecated"],
            active: ["deprecated"],
            deprecated: [],
            rolled_back: ["shadow"],
          };
          const validNext = allowed[model.status] ?? [];
          if (!validNext.includes(targetStatus)) {
            return { status: 409 as const, body: { error: `ogiltig övergång ${model.status} → ${targetStatus}`, allowed: validNext } };
          }

          let previousModelId: string | null = model.previousModelId ?? null;
          if (targetStatus === "active") {
            // Lås + deprecate ev. existerande aktiv modell av samma typ.
            const activeRows = await tx.execute(
              sql`SELECT id FROM ml_models WHERE model_type = ${model.modelType} AND status = 'active' AND id <> ${model.id} FOR UPDATE`
            );
            const currentActiveId = activeRows.rows?.[0]?.id as string | undefined;
            if (currentActiveId) {
              await tx.update(mlModels)
                .set({ status: "deprecated", rolloutPercentage: 0 })
                .where(eq(mlModels.id, currentActiveId));
              previousModelId = currentActiveId;
            }
          }

          const newRollout =
            targetStatus === "active" ? 100
            : targetStatus === "canary" ? Math.max(1, Math.min(50, rolloutPercentage ?? 10))
            : 0;

          const [updated] = await tx.update(mlModels)
            .set({
              status: targetStatus,
              rolloutPercentage: newRollout,
              previousModelId,
              promotedAt: new Date(),
              rollbackReason: null,
            })
            .where(eq(mlModels.id, model.id))
            .returning();

          return { status: 200 as const, body: { model: updated, transition: `${model.status} → ${targetStatus}` } };
        });
        return res.status(result.status).json(result.body);
      } catch (err) {
        // Partial unique index kan kasta om två promote:s körs samtidigt.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("uq_ml_models_one_active_per_type") || msg.includes("uq_ml_models_one_canary_per_type")) {
          throw new ConflictError("konflikt: en annan modell av samma typ är redan i mål-status. Försök igen.");
        }
        throw err;
      }
    })
  );

  // POST /api/ml/models/:id/rollback — instant rollback till previousModelId.
  // Sätter aktuell modell → 'rolled_back' och promotar previousModelId tillbaka till 'active'.
  const rollbackSchema = z.object({ reason: z.string().min(3).max(500) });
  app.post(
    "/api/ml/models/:id/rollback",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      if (tenantId !== PLATFORM_OWNER_TENANT) {
        throw new ForbiddenError("Endast platform-owner kan rollback:a ML-modell");
      }
      const parsed = rollbackSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("ogiltig payload", { issues: parsed.error.issues });
      }
      try {
        const result = await db.transaction(async (tx) => {
          // Lås både den modell som rollas tillbaka OCH previous-modellen.
          const currentRows = await tx.execute(
            sql`SELECT * FROM ml_models WHERE id = ${req.params.id} FOR UPDATE`
          );
          const model = currentRows.rows?.[0] as typeof mlModels.$inferSelect | undefined;
          if (!model) return { status: 404 as const, body: { error: "modell saknas" } };
          if (!["active", "canary"].includes(model.status)) {
            return { status: 409 as const, body: { error: `kan endast rollback:a active/canary, nuvarande: ${model.status}` } };
          }
          if (!model.previousModelId) {
            return { status: 409 as const, body: { error: "ingen previousModelId — kan inte rollback:a" } };
          }
          await tx.execute(sql`SELECT id FROM ml_models WHERE id = ${model.previousModelId} FOR UPDATE`);

          // Steg 1: nuvarande → rolled_back. Frigör partial unique-index FÖRE vi sätter ny active.
          await tx.update(mlModels)
            .set({ status: "rolled_back", rolloutPercentage: 0, rollbackReason: parsed.data.reason })
            .where(eq(mlModels.id, model.id));
          // Steg 2: previous → active.
          const [restored] = await tx.update(mlModels)
            .set({ status: "active", rolloutPercentage: 100, promotedAt: new Date(), rollbackReason: null })
            .where(eq(mlModels.id, model.previousModelId))
            .returning();

          return {
            status: 200 as const,
            body: { rolledBack: { id: model.id, reason: parsed.data.reason }, restored },
          };
        });
        return res.status(result.status).json(result.body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("uq_ml_models_one_active_per_type")) {
          throw new ConflictError("konflikt: en annan modell är redan active. Försök igen.");
        }
        throw err;
      }
    })
  );
}
