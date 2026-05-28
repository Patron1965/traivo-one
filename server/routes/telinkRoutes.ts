// ============================================
// Task #582: Telink-koppling — API-endpoints.
//   GET    /api/telink/config         (admin) — visar config med apiKey-redaktion
//   PUT    /api/telink/config         (admin) — sparar config (merge i tenant.settings)
//   POST   /api/telink/sync           (admin) — kör full synk nu
//   POST   /api/telink/sync/object/:id (admin) — synk för ett objekt
//   GET    /api/telink/history        (admin) — senaste sync-batchar
// ============================================
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { importBatches, objects } from "@shared/schema";
import { storage } from "../storage";
import { asyncHandler } from "../asyncHandler";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { NotFoundError, ValidationError } from "../errors";
import {
  runTelinkSyncForTenant,
  readTelinkConfig,
  TELINK_DEFAULTS,
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

function redactConfig(settings: unknown): {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  contactNameFieldKey: string;
  contactPhoneFieldKey: string;
} {
  const cfg = readTelinkConfig(settings);
  if (cfg) {
    return {
      enabled: cfg.enabled,
      baseUrl: cfg.baseUrl,
      hasApiKey: true,
      contactNameFieldKey: cfg.contactNameFieldKey ?? TELINK_DEFAULTS.contactNameFieldKey,
      contactPhoneFieldKey: cfg.contactPhoneFieldKey ?? TELINK_DEFAULTS.contactPhoneFieldKey,
    };
  }
  // Returnera defaults så frontend kan rendera tomt formulär
  const raw =
    settings && typeof settings === "object"
      ? (((settings as Record<string, unknown>).telink as Record<string, unknown>) ?? {})
      : {};
  return {
    enabled: raw.enabled === true,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
    hasApiKey: typeof raw.apiKey === "string" && (raw.apiKey as string).length > 0,
    contactNameFieldKey:
      typeof raw.contactNameFieldKey === "string"
        ? (raw.contactNameFieldKey as string)
        : TELINK_DEFAULTS.contactNameFieldKey,
    contactPhoneFieldKey:
      typeof raw.contactPhoneFieldKey === "string"
        ? (raw.contactPhoneFieldKey as string)
        : TELINK_DEFAULTS.contactPhoneFieldKey,
  };
}

export function registerTelinkRoutes(app: Express): void {
  // --- GET config -----------------------------------------------------------
  app.get(
    "/api/telink/config",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) throw new NotFoundError("Företag hittades inte");
      res.setHeader("Cache-Control", NO_CACHE_HEADERS);
      res.json(redactConfig(tenant.settings));
    }),
  );

  // --- PUT config (merge in tenant.settings.telink) -------------------------
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
      // SSRF-skydd: validera bas-URL mot allowlist + privat-IP-block
      // redan vid spara, så admin får direkt felmeddelande istället
      // för en gömd schemaläggar-krasch.
      try {
        await assertSafeTelinkBaseUrl(parsed.data.baseUrl);
      } catch (err) {
        throw new ValidationError(
          "Bas-URL otillåten: " + (err instanceof Error ? err.message : String(err)),
        );
      }

      const tenant = await storage.getTenant(tenantId);
      if (!tenant) throw new NotFoundError("Företag hittades inte");

      const currentSettings: Record<string, unknown> =
        tenant.settings && typeof tenant.settings === "object"
          ? { ...(tenant.settings as Record<string, unknown>) }
          : {};
      const currentTelink: Record<string, unknown> =
        currentSettings.telink && typeof currentSettings.telink === "object"
          ? { ...(currentSettings.telink as Record<string, unknown>) }
          : {};

      const nextTelink: Record<string, unknown> = {
        ...currentTelink,
        enabled: parsed.data.enabled,
        baseUrl: parsed.data.baseUrl.trim().replace(/\/+$/, ""),
        contactNameFieldKey:
          parsed.data.contactNameFieldKey?.trim() ||
          (currentTelink.contactNameFieldKey as string | undefined) ||
          TELINK_DEFAULTS.contactNameFieldKey,
        contactPhoneFieldKey:
          parsed.data.contactPhoneFieldKey?.trim() ||
          (currentTelink.contactPhoneFieldKey as string | undefined) ||
          TELINK_DEFAULTS.contactPhoneFieldKey,
      };
      if (parsed.data.apiKey && parsed.data.apiKey.trim()) {
        nextTelink.apiKey = parsed.data.apiKey.trim();
      } else if (currentTelink.apiKey) {
        nextTelink.apiKey = currentTelink.apiKey;
      }
      currentSettings.telink = nextTelink;

      const updated = await storage.updateTenantSettings(tenantId, currentSettings);
      if (!updated) throw new NotFoundError("Företag hittades inte");
      res.setHeader("Cache-Control", NO_CACHE_HEADERS);
      res.json(redactConfig(updated.settings));
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
