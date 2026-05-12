/**
 * Task #426 — Daglig hälsokoll på prod-data efter Modus-parallelldrift
 *
 * Admin-endpoints:
 *   POST /api/admin/prod-health-check/run     — kör nu (platform-owner)
 *   GET  /api/admin/prod-health-check/runs    — hämta historik (admin)
 *   GET  /api/admin/prod-health-check/latest  — senaste körning per tenant
 */

import type { Express } from "express";
import { asyncHandler } from "../asyncHandler";
import { isAuthenticated } from "../replit_integrations/auth";
import {
  requireTenantWithFallback,
  requireAdmin,
  getTenantIdWithFallback,
} from "../tenant-middleware";
import { db } from "../db";
import { prodHealthCheckRuns } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  runProdHealthCheck,
  getThresholdsForTenant,
} from "../services/prodHealthCheckService";
import { runProdHealthCheckNow } from "../services/prod-health-check-scheduler";

const PLATFORM_OWNER_TENANT = "kinab";

export function registerProdHealthCheckRoutes(app: Express): void {
  app.post(
    "/api/admin/prod-health-check/run",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const callerTenant = getTenantIdWithFallback(req);
      const targetTenant =
        typeof req.body?.tenantId === "string" && req.body.tenantId.trim()
          ? req.body.tenantId.trim()
          : callerTenant;
      // Operatörer får köra mot sin egen tenant. Endast platform-owner får
      // köra mot andra tenants (för felsökning).
      if (targetTenant !== callerTenant && callerTenant !== PLATFORM_OWNER_TENANT) {
        return res
          .status(403)
          .json({ error: "Endast platform-owner kan köra hälsokoll mot annan tenant" });
      }
      const persist = req.body?.persist !== false;
      if (persist) {
        await runProdHealthCheckNow(targetTenant);
        const [latest] = await db
          .select()
          .from(prodHealthCheckRuns)
          .where(eq(prodHealthCheckRuns.tenantId, targetTenant))
          .orderBy(desc(prodHealthCheckRuns.ranAt))
          .limit(1);
        return res.json({ run: latest });
      }
      const result = await runProdHealthCheck(targetTenant);
      res.json({ result });
    }),
  );

  app.get(
    "/api/admin/prod-health-check/runs",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const callerTenant = getTenantIdWithFallback(req);
      const queryTenant =
        typeof req.query.tenantId === "string" && req.query.tenantId.trim()
          ? req.query.tenantId.trim()
          : callerTenant;
      if (queryTenant !== callerTenant && callerTenant !== PLATFORM_OWNER_TENANT) {
        return res.status(403).json({ error: "Ej behörig att läsa annan tenant" });
      }
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "30"), 10) || 30, 1),
        200,
      );
      const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
      const where = statusFilter
        ? and(
            eq(prodHealthCheckRuns.tenantId, queryTenant),
            eq(prodHealthCheckRuns.status, statusFilter),
          )
        : eq(prodHealthCheckRuns.tenantId, queryTenant);
      const rows = await db
        .select()
        .from(prodHealthCheckRuns)
        .where(where)
        .orderBy(desc(prodHealthCheckRuns.ranAt))
        .limit(limit);
      res.json({
        tenantId: queryTenant,
        thresholds: getThresholdsForTenant(queryTenant),
        runs: rows,
      });
    }),
  );

  app.get(
    "/api/admin/prod-health-check/latest",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const callerTenant = getTenantIdWithFallback(req);
      const queryTenant =
        typeof req.query.tenantId === "string" && req.query.tenantId.trim()
          ? req.query.tenantId.trim()
          : callerTenant;
      if (queryTenant !== callerTenant && callerTenant !== PLATFORM_OWNER_TENANT) {
        return res.status(403).json({ error: "Ej behörig att läsa annan tenant" });
      }
      const [latest] = await db
        .select()
        .from(prodHealthCheckRuns)
        .where(eq(prodHealthCheckRuns.tenantId, queryTenant))
        .orderBy(desc(prodHealthCheckRuns.ranAt))
        .limit(1);
      res.json({
        tenantId: queryTenant,
        thresholds: getThresholdsForTenant(queryTenant),
        run: latest ?? null,
      });
    }),
  );
}
