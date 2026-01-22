import { sendEmail } from "./replit_integrations/resend";
import { sendSms, isTwilioConfigured } from "./replit_integrations/twilio";
import { storage } from "./storage";

export type NotificationChannel = "email" | "sms" | "both";
export type NotificationType = 
  | "technician_on_way" 
  | "technician_arriving" 
  | "job_completed" 
  | "job_rescheduled" 
  | "reminder"
  | "booking_confirmed"
  | "booking_cancelled"
  | "invoice_ready"
  | "portal_link";

export interface NotificationRecipient {
  email?: string;
  phone?: string;
  name?: string;
}

export interface NotificationOptions {
  tenantId: string;
  recipients: NotificationRecipient[];
  notificationType: NotificationType;
  channel: NotificationChannel;
  data: Record<string, any>;
  customMessage?: string;
}

export interface NotificationResult {
  success: boolean;
  emailsSent: number;
  smsSent: number;
  errors: string[];
}

interface TenantSmsConfig {
  smsEnabled: boolean;
  smsProvider?: "twilio" | "46elks" | "none";
  smsFromName?: string;
}

async function getTenantSmsConfig(tenantId: string): Promise<TenantSmsConfig> {
  try {
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return { smsEnabled: false };
    }
    
    const provider = tenant.smsProvider as "twilio" | "46elks" | "none" | undefined;
    return {
      smsEnabled: tenant.smsEnabled ?? false,
      smsProvider: provider ?? "none",
      smsFromName: tenant.smsFromName ?? tenant.name ?? "Unicorn",
    };
  } catch {
    return { smsEnabled: false };
  }
}

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

function generateSmsContent(
  notificationType: NotificationType,
  data: Record<string, any>,
  companyName: string
): string {
  const { customerName, resourceName, estimatedArrival, objectAddress, scheduledDate, scheduledTime } = data;
  
  switch (notificationType) {
    case "technician_on_way":
      return `${companyName}: Tekniker ${resourceName} är på väg till ${objectAddress}. ${estimatedArrival ? `Beräknad ankomst: ca ${estimatedArrival} min.` : ""}`;
    
    case "technician_arriving":
      return `${companyName}: ${resourceName} anländer till ${objectAddress} inom kort.`;
    
    case "job_completed":
      return `${companyName}: Arbetet på ${objectAddress} är slutfört. Kvittera besöket på kundportalen.`;
    
    case "job_rescheduled":
      return `${companyName}: Besöket ${scheduledDate || ""} ${scheduledTime || ""} till ${objectAddress} har ändrats. Se kundportalen för detaljer.`;
    
    case "reminder":
      return `${companyName}: Påminnelse - besök planerat ${scheduledDate || ""} ${scheduledTime || ""} på ${objectAddress}.`;
    
    case "booking_confirmed":
      return `${companyName}: Din bokning ${scheduledDate || ""} ${scheduledTime || ""} är bekräftad.`;
    
    case "booking_cancelled":
      return `${companyName}: Din bokning har avbokats. Kontakta oss för ombokning.`;
    
    case "invoice_ready":
      return `${companyName}: Din faktura är klar. Se detaljer på kundportalen.`;
    
    case "portal_link":
      const portalUrl = data.portalUrl || "";
      return `${companyName}: Logga in på kundportalen: ${portalUrl}`;
    
    default:
      return data.customMessage || `${companyName}: Du har en ny notifikation.`;
  }
}

function generateEmailSubject(notificationType: NotificationType, data: Record<string, any>): string {
  switch (notificationType) {
    case "technician_on_way":
      return "Tekniker är på väg";
    case "technician_arriving":
      return "Tekniker anländer snart";
    case "job_completed":
      return "Arbete slutfört";
    case "job_rescheduled":
      return "Besök omplanerat";
    case "reminder":
      return "Påminnelse om planerat besök";
    case "booking_confirmed":
      return "Bokning bekräftad";
    case "booking_cancelled":
      return "Bokning avbokad";
    case "invoice_ready":
      return "Faktura klar";
    case "portal_link":
      return "Inloggning till kundportalen";
    default:
      return "Meddelande";
  }
}

function generateEmailHtml(
  notificationType: NotificationType,
  data: Record<string, any>,
  companyName: string
): string {
  const { customerName, resourceName, estimatedArrival, objectAddress, scheduledDate, scheduledTime, portalUrl, customMessage } = data;
  
  const baseStyle = `
    font-family: 'Segoe UI', Arial, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
    background-color: #f8f9fa;
  `;
  
  const cardStyle = `
    background: white;
    border-radius: 8px;
    padding: 24px;
    margin: 16px 0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  `;
  
  const headerStyle = `
    color: #1a1a2e;
    font-size: 24px;
    margin-bottom: 16px;
  `;
  
  const infoBoxStyle = `
    background: #e8f4f8;
    border-left: 4px solid #0d6efd;
    padding: 16px;
    margin: 16px 0;
    border-radius: 0 8px 8px 0;
  `;
  
  let content = "";
  
  switch (notificationType) {
    case "technician_on_way":
      content = `
        <h1 style="${headerStyle}">Tekniker på väg</h1>
        <p>Hej ${customerName || ""}!</p>
        <p>Vår tekniker <strong>${resourceName}</strong> är på väg till dig.</p>
        ${estimatedArrival ? `<div style="${infoBoxStyle}"><strong>Beräknad ankomst:</strong> Om cirka ${estimatedArrival} minuter</div>` : ""}
        <p><strong>Adress:</strong> ${objectAddress}</p>
      `;
      break;
    
    case "job_completed":
      content = `
        <h1 style="${headerStyle}">Arbete slutfört</h1>
        <p>Hej ${customerName || ""}!</p>
        <p>Arbetet på <strong>${objectAddress}</strong> är nu slutfört.</p>
        <p>Du kan kvittera besöket och lämna feedback via kundportalen.</p>
        ${portalUrl ? `<p><a href="${portalUrl}" style="display: inline-block; background: #0d6efd; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Gå till kundportalen</a></p>` : ""}
      `;
      break;
    
    case "reminder":
      content = `
        <h1 style="${headerStyle}">Påminnelse</h1>
        <p>Hej ${customerName || ""}!</p>
        <p>Detta är en påminnelse om ditt planerade besök.</p>
        <div style="${infoBoxStyle}">
          <strong>Datum:</strong> ${scheduledDate}<br/>
          ${scheduledTime ? `<strong>Tid:</strong> ${scheduledTime}<br/>` : ""}
          <strong>Adress:</strong> ${objectAddress}
        </div>
      `;
      break;
    
    case "booking_confirmed":
      content = `
        <h1 style="${headerStyle}">Bokning bekräftad</h1>
        <p>Hej ${customerName || ""}!</p>
        <p>Din bokning har bekräftats.</p>
        <div style="${infoBoxStyle}">
          <strong>Datum:</strong> ${scheduledDate}<br/>
          ${scheduledTime ? `<strong>Tid:</strong> ${scheduledTime}<br/>` : ""}
          <strong>Adress:</strong> ${objectAddress || "Se kundportalen"}
        </div>
      `;
      break;
    
    case "portal_link":
      content = `
        <h1 style="${headerStyle}">Inloggning till kundportalen</h1>
        <p>Hej ${customerName || ""}!</p>
        <p>Klicka på knappen nedan för att logga in på kundportalen:</p>
        ${portalUrl ? `<p><a href="${portalUrl}" style="display: inline-block; background: #0d6efd; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Logga in</a></p>` : ""}
        <p><small>Länken är giltig i 24 timmar.</small></p>
      `;
      break;
    
    default:
      content = `
        <h1 style="${headerStyle}">Meddelande</h1>
        <p>Hej ${customerName || ""}!</p>
        <p>${customMessage || "Du har ett nytt meddelande."}</p>
      `;
  }
  
  return `
    <div style="${baseStyle}">
      <div style="${cardStyle}">
        ${content}
      </div>
      <p style="text-align: center; color: #666; font-size: 12px;">
        Med vänliga hälsningar,<br/>
        <strong>${companyName}</strong>
      </p>
    </div>
  `;
}

export async function sendNotification(options: NotificationOptions): Promise<NotificationResult> {
  const { tenantId, recipients, notificationType, channel, data, customMessage } = options;
  const result: NotificationResult = {
    success: true,
    emailsSent: 0,
    smsSent: 0,
    errors: [],
  };
  
  const tenantSmsConfig = await getTenantSmsConfig(tenantId);
  const tenant = await storage.getTenant(tenantId);
  const companyName = tenant?.name || "Unicorn";
  
  const shouldSendEmail = channel === "email" || channel === "both";
  const shouldSendSms = (channel === "sms" || channel === "both") && tenantSmsConfig.smsEnabled;
  
  for (const recipient of recipients) {
    if (shouldSendEmail && recipient.email) {
      try {
        const subject = generateEmailSubject(notificationType, data);
        const html = generateEmailHtml(notificationType, { ...data, customerName: recipient.name, customMessage }, companyName);
        
        await sendEmail({
          to: recipient.email,
          subject,
          html,
        });
        
        result.emailsSent++;
      } catch (error: any) {
        result.errors.push(`Email to ${recipient.email}: ${error.message}`);
        console.error(`[unified-notifications] Failed to send email to ${recipient.email}:`, error);
      }
    }
    
    if (shouldSendSms && recipient.phone) {
      try {
        if (tenantSmsConfig.smsProvider === "twilio") {
          const twilioConfigured = await isTwilioConfigured();
          if (!twilioConfigured) {
            result.errors.push(`SMS to ${recipient.phone}: Twilio is not configured`);
            continue;
          }
          
          const phoneNumber = formatPhoneNumber(recipient.phone);
          const smsContent = generateSmsContent(notificationType, { ...data, customerName: recipient.name }, tenantSmsConfig.smsFromName || companyName);
          
          const smsResult = await sendSms({
            to: phoneNumber,
            body: smsContent,
          });
          
          if (smsResult.success) {
            result.smsSent++;
          } else {
            result.errors.push(`SMS to ${recipient.phone}: ${smsResult.error}`);
          }
        } else {
          result.errors.push(`SMS to ${recipient.phone}: SMS provider "${tenantSmsConfig.smsProvider}" not supported`);
        }
      } catch (error: any) {
        result.errors.push(`SMS to ${recipient.phone}: ${error.message}`);
        console.error(`[unified-notifications] Failed to send SMS to ${recipient.phone}:`, error);
      }
    }
  }
  
  if (result.errors.length > 0 && result.emailsSent === 0 && result.smsSent === 0) {
    result.success = false;
  }
  
  return result;
}

export async function checkSmsAvailability(tenantId: string): Promise<{
  available: boolean;
  provider?: string;
  configured: boolean;
}> {
  const tenantSmsConfig = await getTenantSmsConfig(tenantId);
  
  if (!tenantSmsConfig.smsEnabled) {
    return { available: false, configured: false };
  }
  
  if (tenantSmsConfig.smsProvider === "twilio") {
    const twilioConfigured = await isTwilioConfigured();
    return {
      available: twilioConfigured,
      provider: "twilio",
      configured: twilioConfigured,
    };
  }
  
  return { available: false, configured: false };
}
