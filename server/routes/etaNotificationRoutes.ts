import type { Express } from "express";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { etaNotifications } from "@shared/schema";
import {
  getETAForPortal,
  getNotificationHistory,
  DEFAULT_ETA_NOTIFICATION_CONFIG,
} from "../eta-notification-service";

export async function registerETANotificationRoutes(app: Express) {

  app.get("/api/eta-notification/config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings as any) || {};
    const config = {
      ...DEFAULT_ETA_NOTIFICATION_CONFIG,
      ...(settings.etaNotificationConfig || {}),
    };
    res.json(config);
  }));

  app.patch("/api/eta-notification/config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { enabled, marginMinutes, channel, triggerOnEnRoute } = req.body;

    const tenant = await storage.getTenant(tenantId);
    const currentSettings = (tenant?.settings as any) || {};
    const currentConfig = currentSettings.etaNotificationConfig || {};

    const updated = {
      ...currentConfig,
      ...(enabled !== undefined && { enabled }),
      ...(marginMinutes !== undefined && { marginMinutes: Math.max(5, Math.min(60, marginMinutes)) }),
      ...(channel !== undefined && ["email", "sms", "both"].includes(channel) && { channel }),
      ...(triggerOnEnRoute !== undefined && { triggerOnEnRoute }),
    };

    await db.execute(
      sql`UPDATE tenants SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{etaNotificationConfig}', ${JSON.stringify(updated)}::jsonb) WHERE id = ${tenantId}`
    );

    res.json(updated);
  }));

  app.get("/api/eta-notification/history", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const customerId = req.query.customerId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const notifications = await getNotificationHistory(tenantId, customerId, limit);
    res.json(notifications);
  }));

  app.get("/api/portal/eta/:workOrderId", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;

    const token = req.headers["x-portal-token"] as string;
    if (!token) {
      return res.status(401).json({ error: "Ej autentiserad" });
    }

    let session: any;
    try {
      const sessions = await db.execute(
        sql`SELECT * FROM portal_sessions WHERE token = ${token} AND expires_at > NOW() LIMIT 1`
      );
      session = sessions.rows?.[0];
    } catch {
      return res.status(401).json({ error: "Ogiltig session" });
    }

    if (!session) {
      return res.status(401).json({ error: "Session utgången" });
    }

    const eta = await getETAForPortal(workOrderId, session.tenant_id);
    if (!eta) {
      return res.status(404).json({ error: "Order hittades inte" });
    }

    res.json(eta);
  }));
}
