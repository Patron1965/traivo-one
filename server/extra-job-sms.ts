import { storage } from "./storage";
import type { WorkOrder } from "@shared/schema";

function formatPhoneE164(phone: string): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-().]/g, "");
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.substring(2);
  if (cleaned.startsWith("+")) {
    const digits = cleaned.substring(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    return cleaned;
  }
  if (cleaned.startsWith("0")) cleaned = "+46" + cleaned.substring(1);
  else if (/^\d+$/.test(cleaned)) cleaned = "+46" + cleaned;
  else return null;
  const digits = cleaned.substring(1);
  if (!/^\d{8,15}$/.test(digits)) return null;
  return cleaned;
}

function isWithinPublishedPeriod(
  scheduledDate: Date | string | null | undefined,
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined
): boolean {
  if (!scheduledDate || !periodStart || !periodEnd) return false;
  const d = typeof scheduledDate === "string" ? new Date(scheduledDate) : scheduledDate;
  if (isNaN(d.getTime())) return false;
  const dateKey = d.toISOString().split("T")[0];
  return dateKey >= periodStart && dateKey <= periodEnd;
}

function buildExtraJobSmsBody(params: {
  companyName: string;
  resourceName: string;
  jobTitle: string;
  scheduledDate: string;
  scheduledStartTime?: string | null;
  objectName?: string | null;
  objectAddress?: string | null;
}): string {
  const { companyName, resourceName, jobTitle, scheduledDate, scheduledStartTime, objectName, objectAddress } = params;
  const firstName = resourceName.split(" ")[0] || resourceName;
  const dateObj = new Date(scheduledDate + (scheduledDate.includes("T") ? "" : "T12:00:00"));
  const dayStr = dateObj.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
  const timeStr = scheduledStartTime ? ` ${scheduledStartTime}` : "";
  const where = [objectName, objectAddress].filter(Boolean).join(" • ");
  const body = `${companyName}: Hej ${firstName}, extrajobb tillagt ${dayStr}${timeStr}. ${jobTitle}${where ? ` – ${where}` : ""}. Se Traivo Go.`;
  return body.length > 320 ? body.substring(0, 317) + "..." : body;
}

function buildCancellationSmsBody(params: {
  companyName: string;
  resourceName: string;
  jobTitle: string;
  scheduledDate: string;
  scheduledStartTime?: string | null;
}): string {
  const { companyName, resourceName, jobTitle, scheduledDate, scheduledStartTime } = params;
  const firstName = resourceName.split(" ")[0] || resourceName;
  const dateObj = new Date(scheduledDate + (scheduledDate.includes("T") ? "" : "T12:00:00"));
  const dayStr = dateObj.toLocaleDateString("sv-SE", { weekday: "short", day: "numeric", month: "short" });
  const timeStr = scheduledStartTime ? ` ${scheduledStartTime}` : "";
  const body = `${companyName}: Hej ${firstName}, jobbet ${dayStr}${timeStr} (${jobTitle}) är borttaget från din rutt. Se Traivo Go.`;
  return body.length > 320 ? body.substring(0, 317) + "..." : body;
}

/**
 * Trigger an "extra job" SMS to a technician when a work order is added or
 * moved into their already-published schedule period. Fire-and-forget, never
 * throws — failures are logged but never block the calling request.
 */
export async function maybeSendExtraJobSms(params: {
  workOrder: WorkOrder & { objectName?: string | null; objectAddress?: string | null };
  resourceId: string;
  reason: "assigned" | "rescheduled";
}): Promise<void> {
  const { workOrder, resourceId, reason } = params;
  try {
    const resource = await storage.getResource(resourceId);
    if (!resource) return;
    if (resource.tenantId !== workOrder.tenantId) return;
    if (resource.smsOnExtraJob === false) return;
    if (!resource.phone) return;

    if (!isWithinPublishedPeriod(workOrder.scheduledDate, resource.lastSchedulePeriodStart, resource.lastSchedulePeriodEnd)) {
      return;
    }

    const tenant = await storage.getTenant(workOrder.tenantId);
    const companyName = tenant?.name || "Traivo";

    let objectName: string | null | undefined = workOrder.objectName ?? null;
    let objectAddress: string | null | undefined = workOrder.objectAddress ?? null;
    if ((!objectName || !objectAddress) && workOrder.objectId) {
      try {
        const obj = await storage.getObject(workOrder.objectId);
        if (obj) {
          objectName = objectName || obj.name || null;
          objectAddress = objectAddress || obj.address || null;
        }
      } catch {
        // ignore
      }
    }

    const scheduledDateStr = workOrder.scheduledDate
      ? (typeof workOrder.scheduledDate === "string"
          ? workOrder.scheduledDate
          : (workOrder.scheduledDate as Date).toISOString())
      : "";

    const body = buildExtraJobSmsBody({
      companyName,
      resourceName: resource.name,
      jobTitle: workOrder.title,
      scheduledDate: scheduledDateStr,
      scheduledStartTime: workOrder.scheduledStartTime,
      objectName,
      objectAddress,
    });

    const { sendSms, isTwilioConfigured } = await import("./replit_integrations/twilio");
    const configured = await isTwilioConfigured();
    if (!configured) {
      console.log(`[extra-job-sms] Twilio not configured, skipping SMS to ${resource.name}`);
      return;
    }

    const to = formatPhoneE164(resource.phone);
    if (!to) {
      console.warn(`[extra-job-sms] Invalid phone for resource ${resource.id} (${resource.phone})`);
      return;
    }
    const smsResult = await sendSms({ to, body });

    try {
      await storage.createDriverNotification({
        tenantId: workOrder.tenantId,
        resourceId,
        type: "extra_job_sms",
        title: smsResult.success ? "Extrajobb-SMS skickat" : "Extrajobb-SMS misslyckades",
        message: smsResult.success
          ? `SMS skickades till ${to} om "${workOrder.title}" (${reason === "assigned" ? "ny tilldelning" : "flyttat"})`
          : `Kunde inte skicka SMS till ${to}: ${smsResult.error || "okänt fel"}`,
        orderId: workOrder.id,
        data: {
          reason,
          phone: to,
          messageId: smsResult.messageId,
          error: smsResult.error,
        },
        isRead: false,
      });
    } catch (e) {
      console.error("[extra-job-sms] Failed to log notification:", e);
    }

    if (smsResult.success) {
      console.log(`[extra-job-sms] Sent to ${resource.name} (${to}) for work order ${workOrder.id}`);
    } else {
      console.error(`[extra-job-sms] Failed for ${resource.name}: ${smsResult.error}`);
    }
  } catch (e) {
    console.error("[extra-job-sms] Unexpected error:", e);
  }
}

/**
 * Trigger a cancellation SMS to the previous technician when a job is moved
 * to a different technician AND the job sits inside the previous technician's
 * already-published period. Same opt-out as extra-job SMS (smsOnExtraJob),
 * since the underlying rule is "tekniker har bett om att få besked om
 * förändringar i sin publicerade vecka". Fire-and-forget.
 */
export async function maybeSendCancellationSms(params: {
  workOrder: WorkOrder & { objectName?: string | null; objectAddress?: string | null };
  previousResourceId: string;
}): Promise<void> {
  const { workOrder, previousResourceId } = params;
  try {
    const resource = await storage.getResource(previousResourceId);
    if (!resource) return;
    if (resource.tenantId !== workOrder.tenantId) return;
    if (resource.smsOnExtraJob === false) return;
    if (!resource.phone) return;

    if (!isWithinPublishedPeriod(workOrder.scheduledDate, resource.lastSchedulePeriodStart, resource.lastSchedulePeriodEnd)) {
      return;
    }

    const tenant = await storage.getTenant(workOrder.tenantId);
    const companyName = tenant?.name || "Traivo";

    const scheduledDateStr = workOrder.scheduledDate
      ? (typeof workOrder.scheduledDate === "string"
          ? workOrder.scheduledDate
          : (workOrder.scheduledDate as Date).toISOString())
      : "";

    const body = buildCancellationSmsBody({
      companyName,
      resourceName: resource.name,
      jobTitle: workOrder.title,
      scheduledDate: scheduledDateStr,
      scheduledStartTime: workOrder.scheduledStartTime,
    });

    const { sendSms, isTwilioConfigured } = await import("./replit_integrations/twilio");
    const configured = await isTwilioConfigured();
    if (!configured) {
      console.log(`[cancel-job-sms] Twilio not configured, skipping SMS to ${resource.name}`);
      return;
    }

    const to = formatPhoneE164(resource.phone);
    if (!to) {
      console.warn(`[cancel-job-sms] Invalid phone for resource ${resource.id} (${resource.phone})`);
      return;
    }
    const smsResult = await sendSms({ to, body });

    try {
      await storage.createDriverNotification({
        tenantId: workOrder.tenantId,
        resourceId: previousResourceId,
        type: "cancel_job_sms",
        title: smsResult.success ? "Jobbet borttaget – SMS skickat" : "Jobbet borttaget – SMS misslyckades",
        message: smsResult.success
          ? `SMS skickades till ${to} om att "${workOrder.title}" tagits bort från rutten`
          : `Kunde inte skicka SMS till ${to}: ${smsResult.error || "okänt fel"}`,
        orderId: workOrder.id,
        data: {
          phone: to,
          messageId: smsResult.messageId,
          error: smsResult.error,
        },
        isRead: false,
      });
    } catch (e) {
      console.error("[cancel-job-sms] Failed to log notification:", e);
    }

    if (smsResult.success) {
      console.log(`[cancel-job-sms] Sent to ${resource.name} (${to}) for work order ${workOrder.id}`);
    } else {
      console.error(`[cancel-job-sms] Failed for ${resource.name}: ${smsResult.error}`);
    }
  } catch (e) {
    console.error("[cancel-job-sms] Unexpected error:", e);
  }
}
