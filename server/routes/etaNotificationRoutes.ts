import type { Express } from "express";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { etaNotifications } from "@shared/schema";
import {
  getETAForPortal,
  getNotificationHistory,
  DEFAULT_ETA_NOTIFICATION_CONFIG,
  triggerETANotification,
} from "../eta-notification-service";

export async function registerETANotificationRoutes(app: Express) {

  app.get("/api/eta-notification/config", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings as any) || {};
    const config = {
      ...DEFAULT_ETA_NOTIFICATION_CONFIG,
      ...(settings.etaNotificationConfig || {}),
    };
    res.json(config);
  }));

  app.patch("/api/eta-notification/config", isAuthenticated, asyncHandler(async (req, res) => {
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

  app.get("/api/eta-notification/history", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const customerId = req.query.customerId as string | undefined;
    const orderId = req.query.orderId as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    if (orderId) {
      const rows = await db.select().from(etaNotifications)
        .where(and(
          eq(etaNotifications.tenantId, tenantId),
          eq(etaNotifications.workOrderId, orderId),
        ))
        .orderBy(sql`created_at DESC`)
        .limit(limit);
      return res.json(rows);
    }

    const notifications = await getNotificationHistory(tenantId, customerId, limit);
    res.json(notifications);
  }));

  app.post("/api/work-orders/:id/auto-eta-sms", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrderId = req.params.id;

    const order = await storage.getWorkOrder(workOrderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order hittades inte" });
    }

    if (order.tenantId && order.tenantId !== tenantId) {
      return res.status(403).json({ success: false, message: "Ej behörig" });
    }

    const resourceId = order.resourceId;
    if (!resourceId) {
      return res.status(400).json({ success: false, message: "Ingen resurs tilldelad ordern" });
    }

    const result = await triggerETANotification(workOrderId, resourceId, tenantId);
    res.json({
      success: result.sent,
      message: result.sent ? "ETA SMS skickat till kund" : result.reason,
    });
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

    const order = await storage.getWorkOrder(workOrderId);
    if (!order || (order.tenantId && order.tenantId !== session.tenant_id)) {
      return res.status(404).json({ error: "Order hittades inte" });
    }

    if (session.customer_id && order.customerId && order.customerId !== session.customer_id) {
      return res.status(403).json({ error: "Ej behörig" });
    }

    const eta = await getETAForPortal(workOrderId, session.tenant_id);
    if (!eta) {
      return res.status(404).json({ error: "ETA ej tillgänglig" });
    }

    res.json(eta);
  }));
}
