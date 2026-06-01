import type { Express } from "express";
import { getTenantIdWithFallback, requireAdmin, requirePlanner } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { isAuthenticated } from "../replit_integrations/auth";
import { AppError, ValidationError, UnauthorizedError, ForbiddenError } from "../errors";
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

  app.patch("/api/eta-notification/config", isAuthenticated, requireAdmin, asyncHandler(async (req, res) => {
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

  app.post("/api/work-orders/:id/auto-eta-sms", isAuthenticated, requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrderId = req.params.id;

    const order = await storage.getWorkOrder(workOrderId);
    if (!order) {
      throw new AppError("Order hittades inte", 404, { code: "ERR_NOT_FOUND", details: { success: false } });
    }

    if (order.tenantId && order.tenantId !== tenantId) {
      throw new ForbiddenError("Ej behörig", { success: false });
    }

    const resourceId = order.resourceId;
    if (!resourceId) {
      throw new ValidationError("Ingen resurs tilldelad ordern", { success: false });
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
      throw new UnauthorizedError("Ej autentiserad");
    }

    let session: any;
    try {
      const sessions = await db.execute(
        sql`SELECT * FROM portal_sessions WHERE token = ${token} AND expires_at > NOW() LIMIT 1`
      );
      session = sessions.rows?.[0];
    } catch {
      throw new UnauthorizedError("Ogiltig session");
    }

    if (!session) {
      throw new UnauthorizedError("Session utgången");
    }

    const order = await storage.getWorkOrder(workOrderId);
    if (!order || (order.tenantId && order.tenantId !== session.tenant_id)) {
      throw new AppError("Order hittades inte", 404, { code: "ERR_NOT_FOUND" });
    }

    if (session.customer_id && order.customerId && order.customerId !== session.customer_id) {
      throw new ForbiddenError("Ej behörig");
    }

    const eta = await getETAForPortal(workOrderId, session.tenant_id);
    if (!eta) {
      throw new AppError("ETA ej tillgänglig", 404, { code: "ERR_NOT_FOUND" });
    }

    res.json(eta);
  }));
}
