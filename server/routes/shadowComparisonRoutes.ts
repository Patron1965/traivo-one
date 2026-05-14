/**
 * Admin-vy för Map Shadow Comparison (Task #477).
 *
 * Endast platform-owner-tenant ("kinab") + roll owner/admin får anropa.
 * Aggregerings-logiken delas med CLI-skriptet
 * `scripts/shadow-comparison-report.ts` via `services/shadowComparisonReport.ts`.
 */
import type { Express, Request } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { isAuthenticated } from "../replit_integrations/auth";
import {
  requireTenantWithFallback,
  requireAdmin,
  getTenantIdWithFallback,
} from "../tenant-middleware";
import {
  getShadowSummary,
  buildShadowComparisonCsv,
} from "../services/shadowComparisonReport";

const PLATFORM_OWNER_TENANT = "kinab";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).optional(),
});

function ensurePlatformOwner(req: Request): string | null {
  const tenantId = getTenantIdWithFallback(req as never);
  if (tenantId !== PLATFORM_OWNER_TENANT) return null;
  return tenantId;
}

export function registerShadowComparisonRoutes(app: Express): void {
  // GET /api/admin/shadow-comparison/summary?days=7
  app.get(
    "/api/admin/shadow-comparison/summary",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      if (!ensurePlatformOwner(req)) {
        return res
          .status(403)
          .json({ error: "Endast platform-owner kan se shadow-jämförelse" });
      }
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "ogiltig query", issues: parsed.error.issues });
      }
      const days = parsed.data.days ?? 7;
      const summary = await getShadowSummary(days);
      res.json(summary);
    }),
  );

  // GET /api/admin/shadow-comparison/export.csv?days=30
  app.get(
    "/api/admin/shadow-comparison/export.csv",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      if (!ensurePlatformOwner(req)) {
        return res
          .status(403)
          .json({ error: "Endast platform-owner kan exportera shadow-jämförelse" });
      }
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "ogiltig query", issues: parsed.error.issues });
      }
      const days = parsed.data.days ?? 30;
      const csv = await buildShadowComparisonCsv(days);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="shadow-comparison-${days}d.csv"`,
      );
      res.send(csv);
    }),
  );
}
