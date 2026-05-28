// ============================================
// Task #582: Telink-koppling — API-endpoints.
//   GET    /api/telink/config         (admin) — visar config med apiKey-redaktion
//   PUT    /api/telink/config         (admin) — sparar config i telink_config-tabellen
//   POST   /api/telink/sync           (admin) — kör full synk nu
//   POST   /api/telink/sync/object/:id (admin) — synk för ett objekt
//   GET    /api/telink/history        (admin) — senaste sync-batchar
// ============================================
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { importBatches, objects } from "@shared/schema";
import { asyncHandler } from "../asyncHandler";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { NotFoundError, ValidationError } from "../errors";
import {
  runTelinkSyncForTenant,
  getTelinkConfigForUi,
  upsertTelinkConfig,
  assertSafeTelinkBaseUrl,
} from "../services/telink-client";

const NO_CACHE_HEADERS = "no-store, no-cache, must-revalidate";

const configSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url("Bas-URL måste vara en giltig URL").max(500),
  apiKey: z.string().min(1).max(500).optional(), // utelämnad = behåll befintlig
  contactNameFieldKey: z.string().min(1).max(100).optional(),
  contactPhoneFieldKey: z.string().min(1).max(100).optional(),
});

export function registerTelinkRoutes(app: Express): void {
  // --- GET config — admin-vy utan apiKey -----------------------------------
  app.get(
    "/api/telink/config",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const ui = await getTelinkConfigForUi(tenantId);
      res.setHeader("Cache-Control", NO_CACHE_HEADERS);
      res.json(ui);
    }),
  );

  // --- PUT config — upsert i dedikerad telink_config-tabell ----------------
  app.put(
    "/api/telink/config",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const parsed = configSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          "Ogiltig Telink-konfiguration: " +
            parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
        );
      }
      // SSRF-skydd: validera bas-URL mot allowlist + privat-IP-block redan
      // vid spara, så admin får direkt felmeddelande istället för gömd
      // schemaläggar-krasch.
      try {
        await assertSafeTelinkBaseUrl(parsed.data.baseUrl);
      } catch (err) {
        throw new ValidationError(
          "Bas-URL otillåten: " + (err instanceof Error ? err.message : String(err)),
        );
      }

      const ui = await upsertTelinkConfig(tenantId, {
        enabled: parsed.data.enabled,
        baseUrl: parsed.data.baseUrl.trim().replace(/\/+$/, ""),
        apiKey: parsed.data.apiKey,
        contactNameFieldKey: parsed.data.contactNameFieldKey,
        contactPhoneFieldKey: parsed.data.contactPhoneFieldKey,
      });
      res.setHeader("Cache-Control", NO_CACHE_HEADERS);
      res.json(ui);
    }),
  );

  // --- POST /api/telink/sync — manuell full synk ---------------------------
  app.post(
    "/api/telink/sync",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const userId = (req as { user?: { id?: string } }).user?.id ?? null;
      const result = await runTelinkSyncForTenant(tenantId, {
        mode: "manual",
        userId,
      });
      res.json(result);
    }),
  );

  // --- POST /api/telink/sync/object/:id — synk för ett objekt --------------
  app.post(
    "/api/telink/sync/object/:id",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const objectId = String(req.params.id);
      // Verifiera ägarskap så manuell synk inte kan triggas för främmande objekt.
      const [obj] = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)))
        .limit(1);
      if (!obj) throw new NotFoundError("Objekt hittades inte");

      const userId = (req as { user?: { id?: string } }).user?.id ?? null;
      const result = await runTelinkSyncForTenant(tenantId, {
        mode: "manual",
        userId,
        objectIdScope: objectId,
      });
      res.json(result);
    }),
  );

  // --- GET /api/telink/history — senaste sync-batchar ----------------------
  app.get(
    "/api/telink/history",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
        100,
      );
      const rows = await db
        .select({
          id: importBatches.id,
          batchId: importBatches.batchId,
          totalRows: importBatches.totalRows,
          created: importBatches.created,
          updated: importBatches.updated,
          errors: importBatches.errors,
          metadata: importBatches.metadata,
          createdAt: importBatches.createdAt,
        })
        .from(importBatches)
        .where(
          and(
            eq(importBatches.tenantId, tenantId),
            sql`${importBatches.metadata}->>'type' = 'telink-sync'`,
          ),
        )
        .orderBy(desc(importBatches.createdAt))
        .limit(limit);
      res.setHeader("Cache-Control", NO_CACHE_HEADERS);
      res.json({ batches: rows });
    }),
  );
}
