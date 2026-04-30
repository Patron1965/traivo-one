import { storage } from "./storage";
import { sendEmail } from "./replit_integrations/resend";

interface WeeklyKPIs {
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  avgTimeMinutes: number;
  resourceCount: number;
}

interface ResourcePerformance {
  name: string;
  completed: number;
  total: number;
  avgMinutes: number;
  efficiency: number;
}

interface PriorityBreakdown {
  priority: string;
  count: number;
  completed: number;
  rate: number;
}

interface DeviationSummary {
  total: number;
  open: number;
  resolved: number;
  critical: number;
  categories: { name: string; count: number }[];
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
    (o) => o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed"
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

function calcResourcePerformance(orders: any[], resources: any[]): ResourcePerformance[] {
  const resourceMap = new Map<string, { name: string; completed: number; total: number; durations: number[] }>();

  for (const order of orders) {
    if (!order.resourceId) continue;
    if (!resourceMap.has(order.resourceId)) {
      const resource = resources.find((r: any) => r.id === order.resourceId);
      resourceMap.set(order.resourceId, {
        name: resource?.name || "Okänd",
        completed: 0,
        total: 0,
        durations: [],
      });
    }
    const entry = resourceMap.get(order.resourceId)!;
    entry.total++;
    if (order.completedAt || order.orderStatus === "utford" || order.executionStatus === "completed") {
      entry.completed++;
      const dur = order.actualDuration || order.estimatedDuration || 0;
      if (dur > 0) entry.durations.push(dur);
    }
  }

  return Array.from(resourceMap.values())
    .map((r) => ({
      name: r.name,
      completed: r.completed,
      total: r.total,
      avgMinutes: r.durations.length > 0 ? Math.round(r.durations.reduce((a, b) => a + b, 0) / r.durations.length) : 0,
      efficiency: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
    }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 10);
}

function calcPriorityBreakdown(orders: any[]): PriorityBreakdown[] {
  const priorityLabels: Record<string, string> = {
    urgent: "Akut",
    high: "Hög",
    normal: "Normal",
    low: "Låg",
  };
  const map = new Map<string, { count: number; completed: number }>();

  for (const order of orders) {
    const p = order.priority || "normal";
    if (!map.has(p)) map.set(p, { count: 0, completed: 0 });
    const entry = map.get(p)!;
    entry.count++;
    if (order.completedAt || order.orderStatus === "utford" || order.executionStatus === "completed") {
      entry.completed++;
    }
  }

  return Array.from(map.entries()).map(([key, val]) => ({
    priority: priorityLabels[key] || key,
    count: val.count,
    completed: val.completed,
    rate: val.count > 0 ? Math.round((val.completed / val.count) * 100) : 0,
  }));
}

async function calcDeviationSummary(tenantId: string, weekStart: Date, weekEnd: Date): Promise<DeviationSummary> {
  try {
    const allDeviations = await storage.getDeviationReports(tenantId, {});
    const deviations = allDeviations.filter((d: any) => {
      const created = d.reportedAt ? new Date(d.reportedAt) : d.createdAt ? new Date(d.createdAt) : null;
      return created && created >= weekStart && created <= weekEnd;
    });
    const categoryMap = new Map<string, number>();

    for (const d of deviations) {
      const cat = d.category || "Ovrigt";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }

    return {
      total: deviations.length,
      open: deviations.filter((d: any) => d.status === "open" || d.status === "pending").length,
      resolved: deviations.filter((d: any) => d.status === "resolved" || d.status === "closed").length,
      critical: deviations.filter((d: any) => d.severityLevel === "critical" || d.requiresImmediateAction).length,
      categories: Array.from(categoryMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  } catch {
    return { total: 0, open: 0, resolved: 0, critical: 0, categories: [] };
  }
}

function trendArrow(delta: number): string {
  if (delta > 0) return `<span style="color:#22c55e;">&#9650; +${delta}</span>`;
  if (delta < 0) return `<span style="color:#ef4444;">&#9660; ${delta}</span>`;
  return `<span style="color:#6b7280;">&#8213; 0</span>`;
}

function efficiencyColor(rate: number): string {
  if (rate >= 90) return "#22c55e";
  if (rate >= 70) return "#f59e0b";
  return "#ef4444";
}

function buildEmailHtml(
  tenantName: string,
  weekLabel: string,
  current: WeeklyKPIs,
  previous: WeeklyKPIs,
  resourcePerf: ResourcePerformance[],
  priorityBreakdown: PriorityBreakdown[],
  deviations: DeviationSummary
): string {
  const completionDelta = current.completionRate - previous.completionRate;
  const tasksDelta = current.totalTasks - previous.totalTasks;
  const avgTimeDelta = current.avgTimeMinutes - previous.avgTimeMinutes;

  const resourceRows = resourcePerf.map((r) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${r.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#334155;">${r.completed}/${r.total}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#334155;">${r.avgMinutes} min</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;">
        <span style="color:${efficiencyColor(r.efficiency)};font-weight:600;">${r.efficiency}%</span>
      </td>
    </tr>
  `).join("");

  const priorityRows = priorityBreakdown.map((p) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${p.priority}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#334155;">${p.count}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#334155;">${p.completed}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;">
        <span style="color:${efficiencyColor(p.rate)};font-weight:600;">${p.rate}%</span>
      </td>
    </tr>
  `).join("");

  const deviationCategoryList = deviations.categories.map((c) =>
    `<li>${c.name}: ${c.count} st</li>`
  ).join("");

  const totalProductionMinutes = resourcePerf.reduce((sum, r) => sum + r.avgMinutes * r.completed, 0);
  const totalProductionHours = Math.round(totalProductionMinutes / 60 * 10) / 10;

  return `
<!DOCTYPE html>
<html lang="sv">
<head><meta charset="UTF-8"/></head>
<body style="font-family:'Inter',Arial,sans-serif;background:#f8fafc;margin:0;padding:0;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:32px 24px;">
    <h1 style="margin:0;font-size:24px;">Traivo Veckorapport</h1>
    <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">${tenantName} &mdash; ${weekLabel}</p>
  </div>

  <div style="padding:24px;">

    <!-- KPI OVERVIEW -->
    <h2 style="font-size:18px;color:#1e293b;margin:0 0 16px;">Sammanfattning</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;">
      <tr>
        <td style="padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:26px;font-weight:700;color:#1e293b;">${current.completedTasks}/${current.totalTasks}</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Slutförda</div>
          <div style="font-size:11px;margin-top:4px;">${trendArrow(tasksDelta)}</div>
        </td>
        <td style="padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:26px;font-weight:700;color:${efficiencyColor(current.completionRate)};">${current.completionRate}%</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Måluppfyllnad</div>
          <div style="font-size:11px;margin-top:4px;">${trendArrow(completionDelta)}%</div>
        </td>
        <td style="padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:26px;font-weight:700;color:#1e293b;">${current.avgTimeMinutes}<span style="font-size:13px;font-weight:400;">min</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Snittid</div>
          <div style="font-size:11px;margin-top:4px;">${trendArrow(avgTimeDelta)} min</div>
        </td>
        <td style="padding:14px;background:#f1f5f9;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:26px;font-weight:700;color:#1e293b;">${totalProductionHours}<span style="font-size:13px;font-weight:400;">h</span></div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;">Total tid</div>
          <div style="font-size:11px;margin-top:4px;">${current.resourceCount} resurser</div>
        </td>
      </tr>
    </table>

    <!-- RESOURCE PERFORMANCE -->
    ${resourcePerf.length > 0 ? `
    <h2 style="font-size:16px;color:#1e293b;margin:28px 0 12px;">Resursproduktivitet</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Resurs</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;">Klart/Totalt</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;">Snittid</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;">Effektivitet</th>
        </tr>
      </thead>
      <tbody>${resourceRows}</tbody>
    </table>
    ` : ""}

    <!-- PRIORITY BREAKDOWN -->
    ${priorityBreakdown.length > 0 ? `
    <h2 style="font-size:16px;color:#1e293b;margin:28px 0 12px;">Per prioritet</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Prioritet</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;">Antal</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;">Klart</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;">Uppfyllnad</th>
        </tr>
      </thead>
      <tbody>${priorityRows}</tbody>
    </table>
    ` : ""}

    <!-- DEVIATIONS -->
    ${deviations.total > 0 ? `
    <h2 style="font-size:16px;color:#1e293b;margin:28px 0 12px;">Avvikelser</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;">
      <tr>
        <td style="padding:12px;background:#fef2f2;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:22px;font-weight:700;color:#dc2626;">${deviations.critical}</div>
          <div style="font-size:11px;color:#991b1b;margin-top:2px;">Kritiska</div>
        </td>
        <td style="padding:12px;background:#fff7ed;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:22px;font-weight:700;color:#ea580c;">${deviations.open}</div>
          <div style="font-size:11px;color:#9a3412;margin-top:2px;">Öppna</div>
        </td>
        <td style="padding:12px;background:#f0fdf4;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:22px;font-weight:700;color:#16a34a;">${deviations.resolved}</div>
          <div style="font-size:11px;color:#166534;margin-top:2px;">Lösta</div>
        </td>
        <td style="padding:12px;background:#f1f5f9;border-radius:8px;text-align:center;width:25%;">
          <div style="font-size:22px;font-weight:700;color:#475569;">${deviations.total}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">Totalt</div>
        </td>
      </tr>
    </table>
    ${deviations.categories.length > 0 ? `
    <div style="margin-top:12px;padding:12px 16px;background:#fffbeb;border-radius:8px;border-left:4px solid #f59e0b;">
      <h3 style="margin:0 0 6px;font-size:13px;color:#92400e;">Vanligaste kategorier</h3>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:#78350f;line-height:1.8;">${deviationCategoryList}</ul>
    </div>
    ` : ""}
    ` : ""}

    <!-- WEEK COMPARISON -->
    <div style="margin-top:28px;padding:16px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#1e40af;">J&auml;mf&ouml;relse mot f&ouml;rra veckan</h3>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#334155;line-height:1.8;">
        <li>Uppdrag: ${current.totalTasks} (förra: ${previous.totalTasks})</li>
        <li>Slutförda: ${current.completedTasks} (förra: ${previous.completedTasks})</li>
        <li>Måluppfyllnad: ${current.completionRate}% (förra: ${previous.completionRate}%)</li>
        <li>Snittid: ${current.avgTimeMinutes} min (förra: ${previous.avgTimeMinutes} min)</li>
        <li>Aktiva resurser: ${current.resourceCount} (förra: ${previous.resourceCount})</li>
      </ul>
    </div>

    <p style="margin-top:28px;font-size:12px;color:#94a3b8;text-align:center;">
      Automatiskt genererad av Traivo &bull; Skickad varje fredag
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

        const [thisWeekOrders, prevWeekOrders, resources, deviations] = await Promise.all([
          storage.getWorkOrders(tenant.id, startOfWeek, endOfWeek, true),
          storage.getWorkOrders(tenant.id, prevStart, prevEnd, true),
          storage.getResources(tenant.id),
          calcDeviationSummary(tenant.id, startOfWeek, endOfWeek),
        ]);

        const current = calcStats(thisWeekOrders);
        const previous = calcStats(prevWeekOrders);
        const resourcePerf = calcResourcePerformance(thisWeekOrders, resources);
        const priorityBreakdown = calcPriorityBreakdown(thisWeekOrders);

        const html = buildEmailHtml(tenant.name, weekLabel, current, previous, resourcePerf, priorityBreakdown, deviations);

        await sendEmail({
          to: tenant.contactEmail,
          subject: `Traivo Veckorapport - ${weekLabel} - ${tenant.name}`,
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
