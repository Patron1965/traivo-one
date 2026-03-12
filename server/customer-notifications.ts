import { sendEmail } from "./replit_integrations/resend";
import { storage } from "./storage";
import type { WorkOrder, Customer, Resource, ServiceObject } from "@shared/schema";

export interface NotificationResult {
  success: boolean;
  recipient?: string;
  error?: string;
  messageId?: string;
}

export interface CustomerNotificationData {
  workOrderId: string;
  notificationType: "technician_on_way" | "technician_arriving" | "job_completed" | "job_rescheduled" | "reminder";
  estimatedArrivalMinutes?: number;
  customMessage?: string;
}

async function getNotificationRecipients(
  tenantId: string,
  workOrder: WorkOrder,
  obj: ServiceObject | undefined,
  customer: Customer | undefined
): Promise<string[]> {
  const emails: string[] = [];
  
  if (customer?.email) {
    emails.push(customer.email);
  }
  
  if (obj) {
    const contacts = await storage.getObjectContacts(obj.id);
    for (const contact of contacts) {
      if (contact.email && (contact.contactType === "primary" || contact.contactType === "technical")) {
        emails.push(contact.email);
      }
    }
  }
  
  return Array.from(new Set(emails));
}

function formatTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minuter`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} timme${hours > 1 ? "r" : ""} och ${mins} minuter` : `${hours} timme${hours > 1 ? "r" : ""}`;
}

function generateEmailHtml(
  notificationType: CustomerNotificationData["notificationType"],
  data: {
    customerName: string;
    objectAddress: string;
    resourceName: string;
    estimatedArrival?: number;
    scheduledDate?: string;
    scheduledTime?: string;
    customMessage?: string;
    companyName: string;
  }
): { subject: string; html: string } {
  const { customerName, objectAddress, resourceName, estimatedArrival, scheduledDate, scheduledTime, customMessage, companyName } = data;
  
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
  
  let subject = "";
  let content = "";
  
  switch (notificationType) {
    case "technician_on_way":
      subject = `Din tekniker är på väg - ${companyName}`;
      content = `
        <h1 style="${headerStyle}">Hej ${customerName}!</h1>
        <p>Vi vill informera dig om att vår tekniker <strong>${resourceName}</strong> nu är på väg till din adress.</p>
        <div style="${infoBoxStyle}">
          <p style="margin: 0;"><strong>Adress:</strong> ${objectAddress}</p>
          ${estimatedArrival ? `<p style="margin: 8px 0 0 0;"><strong>Beräknad ankomst:</strong> om cirka ${formatTime(estimatedArrival)}</p>` : ""}
        </div>
        <p>Vänligen se till att det finns tillgång till platsen.</p>
      `;
      break;
      
    case "technician_arriving":
      subject = `Tekniker anländer snart - ${companyName}`;
      content = `
        <h1 style="${headerStyle}">Hej ${customerName}!</h1>
        <p>Vår tekniker <strong>${resourceName}</strong> anländer inom kort till din adress.</p>
        <div style="${infoBoxStyle}">
          <p style="margin: 0;"><strong>Adress:</strong> ${objectAddress}</p>
          <p style="margin: 8px 0 0 0;"><strong>Beräknad ankomst:</strong> om cirka 15 minuter</p>
        </div>
      `;
      break;
      
    case "job_completed":
      subject = `Arbetet är slutfört - ${companyName}`;
      content = `
        <h1 style="${headerStyle}">Hej ${customerName}!</h1>
        <p>Vi vill informera dig om att arbetet på följande adress nu är slutfört:</p>
        <div style="${infoBoxStyle}">
          <p style="margin: 0;"><strong>Adress:</strong> ${objectAddress}</p>
          <p style="margin: 8px 0 0 0;"><strong>Tekniker:</strong> ${resourceName}</p>
        </div>
        <p>Tack för att du väljer ${companyName}!</p>
      `;
      break;
      
    case "job_rescheduled":
      subject = `Ditt besök har ombokats - ${companyName}`;
      content = `
        <h1 style="${headerStyle}">Hej ${customerName}!</h1>
        <p>Vi vill informera dig om att ditt planerade besök har ombokats.</p>
        <div style="${infoBoxStyle}">
          <p style="margin: 0;"><strong>Adress:</strong> ${objectAddress}</p>
          ${scheduledDate ? `<p style="margin: 8px 0 0 0;"><strong>Nytt datum:</strong> ${scheduledDate}</p>` : ""}
          ${scheduledTime ? `<p style="margin: 8px 0 0 0;"><strong>Tid:</strong> ${scheduledTime}</p>` : ""}
        </div>
        ${customMessage ? `<p><em>${customMessage}</em></p>` : ""}
        <p>Kontakta oss om den nya tiden inte passar.</p>
      `;
      break;
      
    case "reminder":
      subject = `Påminnelse om kommande besök - ${companyName}`;
      content = `
        <h1 style="${headerStyle}">Hej ${customerName}!</h1>
        <p>Detta är en påminnelse om ditt kommande besök:</p>
        <div style="${infoBoxStyle}">
          <p style="margin: 0;"><strong>Adress:</strong> ${objectAddress}</p>
          ${scheduledDate ? `<p style="margin: 8px 0 0 0;"><strong>Datum:</strong> ${scheduledDate}</p>` : ""}
          ${scheduledTime ? `<p style="margin: 8px 0 0 0;"><strong>Tid:</strong> ${scheduledTime}</p>` : ""}
        </div>
        <p>Vänligen se till att det finns tillgång till platsen.</p>
      `;
      break;
  }
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="${baseStyle}">
      <div style="${cardStyle}">
        ${content}
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #666; font-size: 12px; margin: 0;">
          Med vänliga hälsningar,<br>
          <strong>${companyName}</strong>
        </p>
      </div>
      <p style="color: #999; font-size: 11px; text-align: center; margin-top: 16px;">
        Detta är ett automatiskt meddelande. Svara inte på detta mejl.
      </p>
    </body>
    </html>
  `;
  
  return { subject, html };
}

export async function sendCustomerNotification(
  tenantId: string,
  data: CustomerNotificationData
): Promise<NotificationResult[]> {
  try {
    const workOrder = await storage.getWorkOrder(data.workOrderId);
    if (!workOrder) {
      return [{ success: false, error: "Arbetsorder hittades inte" }];
    }
    
    const obj = workOrder.objectId ? await storage.getObject(workOrder.objectId) : undefined;
    const customer = workOrder.customerId ? await storage.getCustomer(workOrder.customerId) : undefined;
    const resource = workOrder.resourceId ? await storage.getResource(workOrder.resourceId) : undefined;
    const tenant = await storage.getTenant(tenantId);
    
    const recipients = await getNotificationRecipients(tenantId, workOrder, obj, customer);
    
    if (recipients.length === 0) {
      return [{ success: false, error: "Inga mottagare hittades" }];
    }
    
    const scheduledDate = workOrder.scheduledDate 
      ? new Date(workOrder.scheduledDate).toLocaleDateString("sv-SE")
      : undefined;
    
    const { subject, html } = generateEmailHtml(data.notificationType, {
      customerName: customer?.name || "Kund",
      objectAddress: obj?.address || "Okänd adress",
      resourceName: resource?.name || "Vår tekniker",
      estimatedArrival: data.estimatedArrivalMinutes,
      scheduledDate,
      scheduledTime: workOrder.scheduledStartTime || undefined,
      customMessage: data.customMessage,
      companyName: tenant?.name || "Fälttjänst AB",
    });
    
    const results: NotificationResult[] = [];
    
    for (const email of recipients) {
      try {
        const result = await sendEmail({
          to: email,
          subject,
          html,
        });
        
        results.push({
          success: true,
          recipient: email,
          messageId: result.data?.id,
        });
        
        console.log(`[notification] Email sent to ${email} for order ${data.workOrderId}`);
      } catch (error) {
        console.error(`[notification] Failed to send email to ${email}:`, error);
        results.push({
          success: false,
          recipient: email,
          error: error instanceof Error ? error.message : "Okänt fel",
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error("[notification] Error sending customer notification:", error);
    return [{ 
      success: false, 
      error: error instanceof Error ? error.message : "Okänt fel vid notifiering" 
    }];
  }
}

export async function notifyTechnicianOnWay(
  tenantId: string,
  workOrderId: string,
  estimatedMinutes?: number
): Promise<NotificationResult[]> {
  return sendCustomerNotification(tenantId, {
    workOrderId,
    notificationType: "technician_on_way",
    estimatedArrivalMinutes: estimatedMinutes || 30,
  });
}

export async function notifyTechnicianArriving(
  tenantId: string,
  workOrderId: string
): Promise<NotificationResult[]> {
  return sendCustomerNotification(tenantId, {
    workOrderId,
    notificationType: "technician_arriving",
    estimatedArrivalMinutes: 15,
  });
}

export async function notifyJobCompleted(
  tenantId: string,
  workOrderId: string
): Promise<NotificationResult[]> {
  return sendCustomerNotification(tenantId, {
    workOrderId,
    notificationType: "job_completed",
  });
}

export async function notifyJobRescheduled(
  tenantId: string,
  workOrderId: string,
  message?: string
): Promise<NotificationResult[]> {
  return sendCustomerNotification(tenantId, {
    workOrderId,
    notificationType: "job_rescheduled",
    customMessage: message,
  });
}

export interface ScheduleJob {
  id: string;
  title: string;
  objectName?: string;
  objectAddress?: string;
  scheduledDate: string;
  scheduledStartTime?: string;
  estimatedDuration?: number;
  accessCode?: string;
  keyNumber?: string;
}

export async function sendScheduleToResource(
  tenantId: string,
  resourceId: string,
  resourceName: string,
  resourceEmail: string,
  jobs: ScheduleJob[],
  dateRange: { start: string; end: string },
  fieldAppUrl: string
): Promise<NotificationResult> {
  try {
    const tenant = await storage.getTenant(tenantId);
    const companyName = tenant?.name || "Nordnav One";
    
    const jobsByDate: Record<string, ScheduleJob[]> = {};
    for (const job of jobs) {
      const dateKey = job.scheduledDate.split("T")[0];
      if (!jobsByDate[dateKey]) jobsByDate[dateKey] = [];
      jobsByDate[dateKey].push(job);
    }
    
    const sortedDates = Object.keys(jobsByDate).sort();
    
    let jobsHtml = "";
    for (const date of sortedDates) {
      const dayJobs = jobsByDate[date].sort((a, b) => 
        (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || "")
      );
      
      const dateObj = new Date(date + "T12:00:00");
      const dayName = dateObj.toLocaleDateString("sv-SE", { weekday: "long" });
      const dateStr = dateObj.toLocaleDateString("sv-SE", { day: "numeric", month: "long" });
      
      jobsHtml += `
        <div style="margin-bottom: 24px;">
          <h3 style="color: #1a1a2e; font-size: 16px; margin-bottom: 12px; text-transform: capitalize; border-bottom: 2px solid #0d6efd; padding-bottom: 8px;">
            ${dayName} ${dateStr}
          </h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
      `;
      
      for (const job of dayJobs) {
        const time = job.scheduledStartTime || "--:--";
        const duration = job.estimatedDuration ? `${job.estimatedDuration} min` : "";
        const accessInfo = [job.accessCode, job.keyNumber].filter(Boolean).join(" | ");
        
        jobsHtml += `
          <tr style="border-bottom: 1px solid #e9ecef;">
            <td style="padding: 12px 8px; width: 60px; vertical-align: top;">
              <strong style="color: #0d6efd;">${time}</strong>
            </td>
            <td style="padding: 12px 8px;">
              <div style="font-weight: 600; color: #1a1a2e;">${job.title}</div>
              ${job.objectAddress ? `<div style="font-size: 14px; color: #6c757d;">${job.objectAddress}</div>` : ""}
              ${accessInfo ? `<div style="font-size: 13px; color: #28a745; margin-top: 4px;">🔑 ${accessInfo}</div>` : ""}
              ${duration ? `<div style="font-size: 13px; color: #6c757d; margin-top: 2px;">⏱ ${duration}</div>` : ""}
            </td>
          </tr>
        `;
      }
      
      jobsHtml += `
            </tbody>
          </table>
        </div>
      `;
    }
    
    const totalJobs = jobs.length;
    const totalMinutes = jobs.reduce((sum, j) => sum + (j.estimatedDuration || 0), 0);
    const totalHours = (totalMinutes / 60).toFixed(1);
    
    const html = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
        <div style="background: white; border-radius: 8px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #1a1a2e; font-size: 24px; margin-bottom: 8px;">Hej ${resourceName}!</h1>
          <p style="color: #6c757d; margin-bottom: 16px;">Här är ditt schema för kommande period.</p>
          
          <div style="background: #e8f4f8; border-left: 4px solid #0d6efd; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0;"><strong>Antal jobb:</strong> ${totalJobs}</p>
            <p style="margin: 8px 0 0 0;"><strong>Total arbetstid:</strong> ${totalHours} timmar</p>
          </div>
          
          <div style="text-align: center; margin: 24px 0;">
            <a href="${fieldAppUrl}" style="display: inline-block; background: #0d6efd; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Öppna Fältappen
            </a>
          </div>
        </div>
        
        <div style="background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #1a1a2e; font-size: 20px; margin-bottom: 16px;">Ditt schema</h2>
          ${jobsHtml}
        </div>
        
        <div style="text-align: center; margin-top: 24px; padding: 16px; color: #6c757d; font-size: 14px;">
          <p>Detta mail skickades från ${companyName}</p>
        </div>
      </div>
    `;
    
    const subject = `Ditt schema - ${totalJobs} jobb planerade`;
    
    const result = await sendEmail({
      to: resourceEmail,
      subject,
      html,
    });
    
    if (result.error) {
      return { success: false, error: result.error.message, recipient: resourceEmail };
    }
    
    return { success: true, recipient: resourceEmail, messageId: result.data?.id };
  } catch (error) {
    console.error("[notification] Error sending schedule to resource:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Okänt fel vid skickning av schema",
      recipient: resourceEmail
    };
  }
}
