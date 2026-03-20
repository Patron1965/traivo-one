import OpenAI from "openai";
import { sendNotification } from "./unified-notifications";
import { storage } from "./storage";
import { trackOpenAIResponse } from "./api-usage-tracker";
import { db } from "./db";
import { customerCommunications, objectContacts } from "@shared/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("07") || cleaned.startsWith("08")) {
    cleaned = "+46" + cleaned.substring(1);
  } else if (cleaned.startsWith("0")) {
    cleaned = "+46" + cleaned.substring(1);
  } else if (!cleaned.startsWith("+")) {
    cleaned = "+46" + cleaned;
  }
  return cleaned;
}

type CommunicationNotificationType = "on_route" | "arrived" | "completed" | "deviation" | "eta_update" | "reminder" | "ai_summary";

function mapNotificationTypeToUnified(type: CommunicationNotificationType): string {
  switch (type) {
    case "on_route": return "technician_on_way";
    case "arrived": return "technician_arriving";
    case "completed": return "job_completed";
    case "deviation": return "job_rescheduled";
    case "eta_update": return "technician_on_way";
    case "reminder": return "reminder";
    case "ai_summary": return "job_completed";
    default: return "reminder";
  }
}

function determineNotificationType(oldStatus: string, newStatus: string): CommunicationNotificationType | null {
  if (newStatus === "travel" || newStatus === "on_way") return "on_route";
  if (newStatus === "on_site") return "arrived";
  if (newStatus === "completed" || newStatus === "utford") return "completed";
  if (newStatus === "cancelled" || newStatus === "ej_utford") return "deviation";
  return null;
}

interface AICompletionSummary {
  sms: string;
  email: string;
}

export async function generateAICompletionSummary(
  workOrder: { title: string; description?: string | null; notes?: string | null },
  object: { name: string; address?: string | null },
  notes?: string | null,
  tenantId: string = "default-tenant"
): Promise<AICompletionSummary> {
  try {
    const { checkBudgetAndBlock, resolveAIModel } = await import("./ai-budget-service");
    const budgetCheck = await checkBudgetAndBlock(tenantId);
    if (!budgetCheck.allowed) {
      return {
        sms: `Arbetet "${workOrder.title}" på ${object.name} är slutfört.`.substring(0, 160),
        email: `Arbetet "${workOrder.title}" på ${object.name} har slutförts av vår tekniker.`,
      };
    }
    const prompt = `Du är en kundkommunikationsassistent för ett fältserviceföretag i Sverige.
Skriv en kundvänlig sammanfattning av utfört arbete.

Arbetsorder: ${workOrder.title}
${workOrder.description ? `Beskrivning: ${workOrder.description}` : ""}
Objekt: ${object.name}
${object.address ? `Adress: ${object.address}` : ""}
${workOrder.notes ? `Teknikernoteringar: ${workOrder.notes}` : ""}
${notes ? `Ytterligare noteringar: ${notes}` : ""}

Svara ENDAST med JSON:
{
  "sms": "Kort sammanfattning max 160 tecken på svenska",
  "email": "Längre kundvänlig sammanfattning på svenska (2-4 meningar)"
}`;

    const { db: commDb } = await import("./db");
    const { tenants: commTenants } = await import("@shared/schema");
    const { eq: commEq } = await import("drizzle-orm");
    const cRow = await commDb.select().from(commTenants).where(commEq(commTenants.id, tenantId)).limit(1);
    const commTier = (cRow[0] as any)?.subscriptionTier || "standard";
    const commModel = resolveAIModel(commTier, "chat");
    const response = await openai.chat.completions.create({
      model: commModel,
      messages: [
        { role: "system", content: "Du skriver kundvänliga sammanfattningar av utfört fältservicearbete på svenska. Svara alltid med JSON." },
        { role: "user", content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    trackOpenAIResponse(response, tenantId);

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      sms: (parsed.sms || `Arbetet "${workOrder.title}" på ${object.name} är slutfört.`).substring(0, 160),
      email: parsed.email || `Arbetet "${workOrder.title}" på ${object.name} har slutförts av vår tekniker.`,
    };
  } catch (error) {
    console.error("[ai-communication] Failed to generate AI summary:", error);
    return {
      sms: `Arbetet "${workOrder.title}" på ${object.name} är slutfört.`.substring(0, 160),
      email: `Arbetet "${workOrder.title}" på ${object.name} har slutförts av vår tekniker.`,
    };
  }
}

export async function handleWorkOrderStatusChange(
  workOrderId: string,
  oldStatus: string,
  newStatus: string,
  tenantId: string
): Promise<void> {
  try {
    const notificationType = determineNotificationType(oldStatus, newStatus);
    if (!notificationType) return;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) return;

    const object = await storage.getObject(workOrder.objectId);
    if (!object) return;

    const customer = await storage.getCustomer(workOrder.customerId);

    const contacts = await db.select().from(objectContacts)
      .where(and(
        eq(objectContacts.objectId, workOrder.objectId),
        eq(objectContacts.tenantId, tenantId)
      ));

    const primaryContacts = contacts.filter(c => c.contactType === "primary");
    const recipientContacts = primaryContacts.length > 0 ? primaryContacts : contacts;

    const recipients: { name?: string; email?: string; phone?: string }[] = [];

    for (const contact of recipientContacts) {
      if (contact.email || contact.phone) {
        recipients.push({
          name: contact.name || undefined,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
        });
      }
    }

    if (recipients.length === 0 && customer) {
      if (customer.email || customer.phone) {
        recipients.push({
          name: customer.contactPerson || customer.name,
          email: customer.email || undefined,
          phone: customer.phone || undefined,
        });
      }
    }

    if (recipients.length === 0) return;

    const tenant = await storage.getTenant(tenantId);
    const smsEnabled = tenant?.smsEnabled ?? false;
    const channel: "sms" | "email" | "both" = smsEnabled ? "both" : "email";

    let message = "";
    let subject: string | null = null;
    let aiGenerated = false;

    if (notificationType === "completed") {
      const summary = await generateAICompletionSummary(workOrder, object, workOrder.notes, tenantId);
      message = summary.email;
      subject = "Arbete slutfört";
      aiGenerated = true;
    } else if (notificationType === "on_route") {
      message = `Vår tekniker är på väg till ${object.address || object.name}.`;
      subject = "Tekniker på väg";
    } else if (notificationType === "arrived") {
      message = `Vår tekniker har anlänt till ${object.address || object.name}.`;
      subject = "Tekniker har anlänt";
    } else if (notificationType === "deviation") {
      message = `Besöket till ${object.address || object.name} kunde tyvärr inte genomföras. Kontakta oss för mer information.`;
      subject = "Avvikelse i planerat besök";
    }

    const unifiedType = mapNotificationTypeToUnified(notificationType) as any;

    let status: "sent" | "failed" | "pending" | "skipped" = "pending";
    let errorMessage: string | null = null;

    try {
      const result = await sendNotification({
        tenantId,
        recipients: recipients.map(r => ({
          email: r.email,
          phone: r.phone ? formatPhoneNumber(r.phone) : undefined,
          name: r.name,
        })),
        notificationType: unifiedType,
        channel,
        data: {
          customerName: recipients[0]?.name || "",
          objectAddress: object.address || object.name,
          customMessage: message,
        },
        customMessage: message,
      });

      status = result.success ? "sent" : "failed";
      if (result.errors.length > 0) {
        errorMessage = result.errors.join("; ");
      }
    } catch (err: any) {
      status = "failed";
      errorMessage = err.message || "Okänt fel vid skickande av notifikation";
      console.error("[ai-communication] Send notification failed:", err);
    }

    for (const recipient of recipients) {
      try {
        await db.insert(customerCommunications).values({
          tenantId,
          workOrderId,
          customerId: workOrder.customerId,
          objectId: workOrder.objectId,
          channel,
          notificationType,
          recipientName: recipient.name || null,
          recipientEmail: recipient.email || null,
          recipientPhone: recipient.phone || null,
          subject,
          message,
          aiGenerated,
          status,
          errorMessage,
          sentAt: status === "sent" ? new Date() : null,
        });
      } catch (logErr) {
        console.error("[ai-communication] Failed to log communication:", logErr);
      }
    }
  } catch (error) {
    console.error("[ai-communication] handleWorkOrderStatusChange error:", error);
  }
}

export async function getAutoNotificationSettings(tenantId: string): Promise<{
  onRoute: boolean;
  arrived: boolean;
  completed: boolean;
  deviation: boolean;
  etaUpdate: boolean;
  reminder: boolean;
}> {
  try {
    const tenant = await storage.getTenant(tenantId);
    const smsEnabled = tenant?.smsEnabled ?? false;

    return {
      onRoute: smsEnabled,
      arrived: smsEnabled,
      completed: true,
      deviation: true,
      etaUpdate: smsEnabled,
      reminder: true,
    };
  } catch (error) {
    console.error("[ai-communication] getAutoNotificationSettings error:", error);
    return {
      onRoute: false,
      arrived: false,
      completed: false,
      deviation: false,
      etaUpdate: false,
      reminder: false,
    };
  }
}

export async function getCommunicationLog(
  tenantId: string,
  filters?: {
    workOrderId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<any[]> {
  try {
    const conditions = [eq(customerCommunications.tenantId, tenantId)];

    if (filters?.workOrderId) {
      conditions.push(eq(customerCommunications.workOrderId, filters.workOrderId));
    }
    if (filters?.status) {
      conditions.push(eq(customerCommunications.status, filters.status));
    }
    if (filters?.startDate) {
      conditions.push(gte(customerCommunications.createdAt, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(customerCommunications.createdAt, filters.endDate));
    }

    const logs = await db.select()
      .from(customerCommunications)
      .where(and(...conditions))
      .orderBy(desc(customerCommunications.createdAt));

    return logs;
  } catch (error) {
    console.error("[ai-communication] getCommunicationLog error:", error);
    return [];
  }
}

export async function sendETAUpdate(
  workOrderId: string,
  estimatedMinutes: number,
  tenantId: string
): Promise<void> {
  try {
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) return;

    const object = await storage.getObject(workOrder.objectId);
    if (!object) return;

    const customer = await storage.getCustomer(workOrder.customerId);

    const contacts = await db.select().from(objectContacts)
      .where(and(
        eq(objectContacts.objectId, workOrder.objectId),
        eq(objectContacts.tenantId, tenantId)
      ));

    const primaryContacts = contacts.filter(c => c.contactType === "primary");
    const recipientContacts = primaryContacts.length > 0 ? primaryContacts : contacts;

    const recipients: { name?: string; email?: string; phone?: string }[] = [];

    for (const contact of recipientContacts) {
      if (contact.email || contact.phone) {
        recipients.push({
          name: contact.name || undefined,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
        });
      }
    }

    if (recipients.length === 0 && customer) {
      if (customer.email || customer.phone) {
        recipients.push({
          name: customer.contactPerson || customer.name,
          email: customer.email || undefined,
          phone: customer.phone || undefined,
        });
      }
    }

    if (recipients.length === 0) return;

    const tenant = await storage.getTenant(tenantId);
    const smsEnabled = tenant?.smsEnabled ?? false;
    const channel: "sms" | "email" | "both" = smsEnabled ? "both" : "email";

    const message = `Vår tekniker beräknas vara på plats vid ${object.address || object.name} om cirka ${estimatedMinutes} minuter.`;
    const subject = "Uppdaterad beräknad ankomsttid";

    let status: "sent" | "failed" | "pending" | "skipped" = "pending";
    let errorMessage: string | null = null;

    try {
      const result = await sendNotification({
        tenantId,
        recipients: recipients.map(r => ({
          email: r.email,
          phone: r.phone ? formatPhoneNumber(r.phone) : undefined,
          name: r.name,
        })),
        notificationType: "technician_on_way",
        channel,
        data: {
          customerName: recipients[0]?.name || "",
          objectAddress: object.address || object.name,
          estimatedArrival: estimatedMinutes.toString(),
          customMessage: message,
        },
      });

      status = result.success ? "sent" : "failed";
      if (result.errors.length > 0) {
        errorMessage = result.errors.join("; ");
      }
    } catch (err: any) {
      status = "failed";
      errorMessage = err.message || "Okänt fel vid skickande av ETA-uppdatering";
      console.error("[ai-communication] ETA update send failed:", err);
    }

    for (const recipient of recipients) {
      try {
        await db.insert(customerCommunications).values({
          tenantId,
          workOrderId,
          customerId: workOrder.customerId,
          objectId: workOrder.objectId,
          channel,
          notificationType: "eta_update",
          recipientName: recipient.name || null,
          recipientEmail: recipient.email || null,
          recipientPhone: recipient.phone || null,
          subject,
          message,
          aiGenerated: false,
          status,
          errorMessage,
          sentAt: status === "sent" ? new Date() : null,
        });
      } catch (logErr) {
        console.error("[ai-communication] Failed to log ETA communication:", logErr);
      }
    }
  } catch (error) {
    console.error("[ai-communication] sendETAUpdate error:", error);
  }
}
