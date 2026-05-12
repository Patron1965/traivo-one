/**
 * Admin-vy för att återställa enskilda vilande kunder (Task #428).
 *
 * Endast platform-owner-tenant ("kinab") + roll owner/admin får anropa.
 * All logik delegeras till `server/services/restoreDormantCustomerService.ts`,
 * som även CLI-wrappern `scripts/restore-dormant-customer.ts` använder.
 */
import type { Express } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { isAuthenticated } from "../replit_integrations/auth";
import {
  requireTenantWithFallback,
  requireAdmin,
  getTenantIdWithFallback,
} from "../tenant-middleware";
import {
  restoreDormantCustomers,
  searchDormantCustomers,
  RestoreDormantError,
} from "../services/restoreDormantCustomerService";

const PLATFORM_OWNER_TENANT = "kinab";

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  tenant: z.string().min(1).max(100).optional(),
  activeSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const restoreSchema = z.object({
  customerIds: z.array(z.string().min(1)).min(1).max(100),
  tenant: z.string().min(1).max(100).optional(),
  activeSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  allowActive: z.boolean().optional(),
  dryRun: z.boolean(),
});

function ensurePlatformOwner(req: Parameters<Parameters<Express["get"]>[1]>[0]): string | null {
  const tenantId = getTenantIdWithFallback(req as never);
  if (tenantId !== PLATFORM_OWNER_TENANT) return null;
  return tenantId;
}

function mapErrorStatus(err: RestoreDormantError): number {
  switch (err.code) {
    case "missing_prod_url":
    case "missing_dev_url":
    case "same_db":
      return 503;
    case "customer_not_found":
    case "customer_active":
      return 422;
    case "empty_ids":
      return 400;
    default:
      return 500;
  }
}

export function registerRestoreDormantRoutes(app: Express): void {
  // GET /api/admin/restore-dormant-customers/search?q=...
  app.get(
    "/api/admin/restore-dormant-customers/search",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      if (!ensurePlatformOwner(req)) {
        return res
          .status(403)
          .json({ error: "Endast platform-owner kan återställa vilande kunder" });
      }
      const parsed = searchSchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "ogiltig sökning", issues: parsed.error.issues });
      }
      try {
        const customers = await searchDormantCustomers({
          query: parsed.data.q,
          tenant: parsed.data.tenant,
          activeSince: parsed.data.activeSince,
        });
        res.json({ customers });
      } catch (err) {
        if (err instanceof RestoreDormantError) {
          return res.status(mapErrorStatus(err)).json({ error: err.message, code: err.code });
        }
        throw err;
      }
    }),
  );

  // POST /api/admin/restore-dormant-customers/restore
  // Body: { customerIds, dryRun, allowActive?, tenant?, activeSince? }
  app.post(
    "/api/admin/restore-dormant-customers/restore",
    isAuthenticated,
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      if (!ensurePlatformOwner(req)) {
        return res
          .status(403)
          .json({ error: "Endast platform-owner kan återställa vilande kunder" });
      }
      const parsed = restoreSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "ogiltig payload", issues: parsed.error.issues });
      }

      // Hämta inloggad user för audit-rad. Vi anropar inte storage här —
      // claims.sub finns alltid efter isAuthenticated/requireTenantWithFallback.
      const claims = (req.user as { claims?: { sub?: string; email?: string } } | undefined)
        ?.claims;
      const userId = claims?.sub ?? null;
      const actor = claims?.email ?? userId ?? null;

      // Skarp körning kräver att vi explicit sätter CONFIRM för det spawned
      // migrate-skriptet. Vi sätter det BARA för det här anropet (env tillhör
      // process — vi måste återställa efteråt).
      const prevConfirm = process.env.CONFIRM;
      if (!parsed.data.dryRun) process.env.CONFIRM = "YES_MIGRATE_PROD";
      try {
        const result = await restoreDormantCustomers(
          {
            ids: parsed.data.customerIds,
            tenant: parsed.data.tenant,
            activeSince: parsed.data.activeSince,
            allowActive: parsed.data.allowActive,
            dryRun: parsed.data.dryRun,
            userId,
            actor,
          },
          "admin_ui",
        );
        const ok = result.migrateExitCode === 0;
        return res.status(ok ? 200 : 500).json({
          ok,
          dryRun: result.dryRun,
          auditWritten: result.auditWritten,
          migrateExitCode: result.migrateExitCode,
          migrateLog: result.migrateLog,
          preflight: result.preflight,
        });
      } catch (err) {
        if (err instanceof RestoreDormantError) {
          return res
            .status(mapErrorStatus(err))
            .json({ error: err.message, code: err.code, details: err.details });
        }
        throw err;
      } finally {
        if (prevConfirm === undefined) delete process.env.CONFIRM;
        else process.env.CONFIRM = prevConfirm;
      }
    }),
  );
}
