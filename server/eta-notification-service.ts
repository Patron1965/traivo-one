import { db } from "./db";
import { storage } from "./storage";
import { sendNotification } from "./unified-notifications";
import { getRoutingDistance, haversineDistanceKm } from "./distance-matrix-service";
import { etaNotifications } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface ETANotificationConfig {
  enabled: boolean;
  marginMinutes: number;
  channel: "email" | "sms" | "both";
  triggerOnEnRoute: boolean;
}

export const DEFAULT_ETA_NOTIFICATION_CONFIG: ETANotificationConfig = {
  enabled: true,
  marginMinutes: 15,
  channel: "email",
  triggerOnEnRoute: true,
};

interface ETAResult {
  etaMinutes: number;
  etaTime: string;
  distanceKm: number;
  source: string;
}

async function calculateETAToOrder(
  resourceId: string,
  workOrderId: string
): Promise<ETAResult | null> {
  const resource = await storage.getResource(resourceId);
  const order = await storage.getWorkOrder(workOrderId);
  if (!resource || !order) return null;

  let objLat = order.taskLatitude;
  let objLng = order.taskLongitude;

  if (!objLat || !objLng) {
    if (order.objectId) {
      const obj = await storage.getObject(order.objectId);
      if (obj) {
        objLat = obj.latitude;
        objLng = obj.longitude;
      }
    }
  }

  if (!resource.currentLatitude || !resource.currentLongitude || !objLat || !objLng) {
    if (order.scheduledStartTime) {
      const [h, m] = order.scheduledStartTime.split(":").map(Number);
      const etaDate = new Date();
      etaDate.setHours(h, m, 0, 0);
      return {
        etaMinutes: Math.max(0, Math.round((etaDate.getTime() - Date.now()) / 60000)),
        etaTime: order.scheduledStartTime,
        distanceKm: 0,
        source: "scheduled",
      };
    }
    return null;
  }

  try {
    const routing = await getRoutingDistance(
      resource.currentLatitude, resource.currentLongitude,
      objLat, objLng
    );
    const now = new Date();
    const arrivalTime = new Date(now.getTime() + routing.durationMin * 60000);
    return {
      etaMinutes: Math.round(routing.durationMin),
      etaTime: `${String(arrivalTime.getHours()).padStart(2, "0")}:${String(arrivalTime.getMinutes()).padStart(2, "0")}`,
      distanceKm: routing.distanceKm,
      source: routing.source,
    };
  } catch {
    const havDist = haversineDistanceKm(
      resource.currentLatitude, resource.currentLongitude,
      objLat, objLng
    );
    const minutes = Math.round((havDist / 40) * 60);
    const now = new Date();
    const arrivalTime = new Date(now.getTime() + minutes * 60000);
    return {
      etaMinutes: minutes,
      etaTime: `${String(arrivalTime.getHours()).padStart(2, "0")}:${String(arrivalTime.getMinutes()).padStart(2, "0")}`,
      distanceKm: Math.round(havDist * 10) / 10,
      source: "haversine",
    };
  }
}

export async function triggerETANotification(
  workOrderId: string,
  resourceId: string,
  tenantId: string
): Promise<{ sent: boolean; reason: string }> {
  try {
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings as any) || {};
    const config: ETANotificationConfig = {
      ...DEFAULT_ETA_NOTIFICATION_CONFIG,
      ...(settings.etaNotificationConfig || {}),
    };

    if (!config.enabled || !config.triggerOnEnRoute) {
      return { sent: false, reason: "ETA-notifieringar avaktiverade" };
    }

    const order = await storage.getWorkOrder(workOrderId);
    if (!order || !order.customerId) {
      return { sent: false, reason: "Order eller kund saknas" };
    }

    const existingNotifs = await db.select()
      .from(etaNotifications)
      .where(and(
        eq(etaNotifications.workOrderId, workOrderId),
        eq(etaNotifications.notificationType, "technician_on_way"),
        eq(etaNotifications.status, "sent")
      ))
      .limit(1);

    if (existingNotifs.length > 0) {
      return { sent: false, reason: "Notifiering redan skickad för denna order" };
    }

    let customerSettings: any = null;
    try {
      const csRows = await db.execute(
        sql`SELECT * FROM customer_notification_settings WHERE customer_id = ${order.customerId} AND tenant_id = ${tenantId} LIMIT 1`
      );
      customerSettings = csRows.rows?.[0] || null;
    } catch {}

    if (customerSettings && !customerSettings.notify_on_technician_on_way) {
      return { sent: false, reason: "Kund har avaktiverat notifieringar" };
    }

    const customer = await storage.getCustomer(order.customerId);
    if (!customer) {
      return { sent: false, reason: "Kund hittades inte" };
    }

    const eta = await calculateETAToOrder(resourceId, workOrderId);
    if (!eta) {
      return { sent: false, reason: "Kunde inte beräkna ETA" };
    }

    const resource = await storage.getResource(resourceId);
    const obj = order.objectId ? await storage.getObject(order.objectId) : null;

    const recipientEmail = customerSettings?.preferred_contact_email || customer.email;
    const recipientPhone = customerSettings?.preferred_contact_phone || customer.phone;

    const channel = config.channel;
    const hasEmail = !!recipientEmail;
    const hasSms = !!recipientPhone;

    if ((channel === "email" && !hasEmail) || (channel === "sms" && !hasSms) || (channel === "both" && !hasEmail && !hasSms)) {
      return { sent: false, reason: "Inga kontaktuppgifter" };
    }

    const result = await sendNotification({
      tenantId,
      recipients: [{
        email: recipientEmail || undefined,
        phone: recipientPhone || undefined,
        name: customer.contactPerson || customer.name,
      }],
      notificationType: "technician_on_way",
      channel,
      data: {
        customerName: customer.contactPerson || customer.name,
        resourceName: resource?.name || "Tekniker",
        estimatedArrival: eta.etaMinutes,
        etaTime: eta.etaTime,
        marginMinutes: config.marginMinutes,
        objectAddress: obj?.address || order.title,
      },
    });

    await db.insert(etaNotifications).values({
      tenantId,
      workOrderId,
      customerId: order.customerId,
      resourceId,
      channel,
      notificationType: "technician_on_way",
      recipientEmail: recipientEmail || null,
      recipientPhone: recipientPhone || null,
      etaMinutes: eta.etaMinutes,
      etaTime: eta.etaTime,
      marginMinutes: config.marginMinutes,
      status: result.success ? "sent" : "failed",
      errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
    });

    console.log(`[eta-notification] Sent ETA notification for order ${workOrderId}: ETA ${eta.etaTime} ±${config.marginMinutes}min`);

    return { sent: result.success, reason: result.success ? "Skickad" : result.errors.join("; ") };
  } catch (error: any) {
    console.error("[eta-notification] Error:", error);
    return { sent: false, reason: error.message };
  }
}

export async function getETAForPortal(
  workOrderId: string,
  tenantId: string
): Promise<{
  available: boolean;
  etaMinutes?: number;
  etaTime?: string;
  marginMinutes?: number;
  resourceName?: string;
  isEnRoute?: boolean;
  distanceKm?: number;
} | null> {
  const order = await storage.getWorkOrder(workOrderId);
  if (!order || order.tenantId !== tenantId) return null;

  const isEnRoute = order.executionStatus === "on_way";
  const isOnSite = order.executionStatus === "on_site" || order.executionStatus === "completed";

  if (isOnSite) {
    return { available: false };
  }

  if (!order.resourceId) {
    return { available: false };
  }

  const resource = await storage.getResource(order.resourceId);

  if (!isEnRoute) {
    return {
      available: false,
      resourceName: resource?.name,
      isEnRoute: false,
    };
  }

  const tenant = await storage.getTenant(tenantId);
  const settings = (tenant?.settings as any) || {};
  const config: ETANotificationConfig = {
    ...DEFAULT_ETA_NOTIFICATION_CONFIG,
    ...(settings.etaNotificationConfig || {}),
  };

  const eta = await calculateETAToOrder(order.resourceId, workOrderId);
  if (!eta) {
    return {
      available: true,
      isEnRoute: true,
      resourceName: resource?.name,
    };
  }

  return {
    available: true,
    etaMinutes: eta.etaMinutes,
    etaTime: eta.etaTime,
    marginMinutes: config.marginMinutes,
    resourceName: resource?.name,
    isEnRoute: true,
    distanceKm: Math.round(eta.distanceKm * 10) / 10,
  };
}

export async function getNotificationHistory(
  tenantId: string,
  customerId?: string,
  limit: number = 50
) {
  const conditions = [eq(etaNotifications.tenantId, tenantId)];
  if (customerId) {
    conditions.push(eq(etaNotifications.customerId, customerId));
  }

  return db.select()
    .from(etaNotifications)
    .where(and(...conditions))
    .orderBy(desc(etaNotifications.createdAt))
    .limit(limit);
}
