import { storage } from "./storage";
import { sendEmail } from "./replit_integrations/resend";
import { trackApiUsage } from "./api-usage-tracker";

interface WeeklyKPIs {
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  avgTimeMinutes: number;
  resourceCount: number;
}

function getWeekDates() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);

  const startOfWeek = new Date(now);
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const prevStart = new Date(startOfWeek);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd = new Date(startOfWeek);
  prevEnd.setMilliseconds(-1);

  return { startOfWeek, endOfWeek, prevStart, prevEnd };
}

function calcStats(orders: any[]): WeeklyKPIs {
  const completed = orders.filter(
    (o) => o.completedAt || o.status === "completed" || o.executionStatus === "completed"
  );
  const durations = completed
    .map((o) => o.actualDuration || o.estimatedDuration || 0)
    .filter((d: number) => d > 0);
  const resourceIds = new Set(orders.map((o) => o.resourceId).filter(Boolean));
  return {
    totalTasks: orders.length,
    completedTasks: completed.length,
    completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
    avgTimeMinutes:
      durations.length > 0
        ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
        : 0,
    resourceCount: resourceIds.size,
  };
}

function trendArrow(delta: number): string {
  if (delta > 0) return `<span style="color:#22c55e;">&#9650; +${delta}</span>`;
  if (delta < 0) return `<span style="color:#ef4444;">&#9660; ${delta}</span>`;
  return `<span style="color:#6b7280;">&#8213; 0</span>`;
}

function buildEmailHtml(
  tenantName: string,
  weekLabel: string,
  current: WeeklyKPIs,
  previous: WeeklyKPIs
): string {
  const completionDelta = current.completionRate - previous.completionRate;
  const tasksDelta = current.totalTasks - previous.totalTasks;
  const avgTimeDelta = current.avgTimeMinutes - previous.avgTimeMinutes;

  return `
<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"/></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f8fafc;margin:0;padding:0;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
  <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:32px 24px;">
    <h1 style="margin:0;font-size:24px;">Unicorn Veckorapport</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">${tenantName} &mdash; ${weekLabel}</p>
  </div>
  <div style="padding:24px;">
    <h2 style="font-size:18px;color:#1e293b;margin:0 0 16px;">Sammanfattning</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:12px;background:#f1f5f9;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:28px;font-weight:700;color:#1e293b;">${current.completedTasks}/${current.totalTasks}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Slutförda uppdrag</div>
          <div style="font-size:12px;margin-top:4px;">${trendArrow(tasksDelta)} från förra veckan</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px;background:#f1f5f9;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:28px;font-weight:700;color:#1e293b;">${current.completionRate}%</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Måluppfyllnad</div>
          <div style="font-size:12px;margin-top:4px;">${trendArrow(completionDelta)}%</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px;background:#f1f5f9;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:28px;font-weight:700;color:#1e293b;">${current.avgTimeMinutes}<span style="font-size:14px;font-weight:400;">min</span></div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Snittid/uppdrag</div>
          <div style="font-size:12px;margin-top:4px;">${trendArrow(avgTimeDelta)} min</div>
        </td>
      </tr>
    </table>

    <div style="margin-top:24px;padding:16px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#1e40af;">Jämförelse mot förra veckan</h3>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#334155;line-height:1.8;">
        <li>Uppdrag: ${current.totalTasks} (förra: ${previous.totalTasks})</li>
        <li>Slutförda: ${current.completedTasks} (förra: ${previous.completedTasks})</li>
        <li>Aktiva resurser: ${current.resourceCount} (förra: ${previous.resourceCount})</li>
      </ul>
    </div>

    <p style="margin-top:24px;font-size:12px;color:#94a3b8;text-align:center;">
      Automatiskt genererad av Unicorn &bull; Skickad varje fredag
    </p>
  </div>
</div>
</body>
</html>`;
}

export async function generateAndSendWeeklyReports(): Promise<{ sent: number; errors: string[] }> {
  const results = { sent: 0, errors: [] as string[] };

  try {
    const tenants = await storage.getPublicTenants();
    const { startOfWeek, endOfWeek, prevStart, prevEnd } = getWeekDates();
    const weekLabel = `Vecka ${getISOWeekNumber(startOfWeek)}, ${startOfWeek.getFullYear()}`;

    for (const tenant of tenants) {
      try {
        if (!tenant.contactEmail) {
          continue;
        }

        const thisWeekOrders = await storage.getWorkOrders(tenant.id, startOfWeek, endOfWeek, true);
        const prevWeekOrders = await storage.getWorkOrders(tenant.id, prevStart, prevEnd, true);

        const current = calcStats(thisWeekOrders);
        const previous = calcStats(prevWeekOrders);

        const html = buildEmailHtml(tenant.name, weekLabel, current, previous);

        await sendEmail({
          to: tenant.contactEmail,
          subject: `Unicorn Veckorapport - ${weekLabel} - ${tenant.name}`,
          html,
        });

        results.sent++;
        console.log(`[weekly-report] Sent to ${tenant.contactEmail} for tenant ${tenant.name}`);
      } catch (err: any) {
        const msg = `Failed for tenant ${tenant.name}: ${err.message}`;
        results.errors.push(msg);
        console.error(`[weekly-report] ${msg}`);
      }
    }
  } catch (err: any) {
    results.errors.push(`Global error: ${err.message}`);
    console.error(`[weekly-report] Global error:`, err);
  }

  return results;
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function startWeeklyReportScheduler() {
  const checkInterval = 60 * 60 * 1000;
  let lastSentWeek = -1;

  setInterval(async () => {
    const now = new Date();
    if (now.getDay() !== 5) return;
    if (now.getHours() < 16 || now.getHours() > 17) return;

    const weekNum = getISOWeekNumber(now);
    if (weekNum === lastSentWeek) return;

    console.log(`[weekly-report] Triggering weekly report generation (week ${weekNum})`);
    lastSentWeek = weekNum;

    const result = await generateAndSendWeeklyReports();
    console.log(`[weekly-report] Done: ${result.sent} sent, ${result.errors.length} errors`);
  }, checkInterval);

  console.log("[weekly-report] Scheduler started (runs Fridays 16:00-17:00)");
}
