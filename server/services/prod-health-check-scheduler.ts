/**
 * Task #426 — Daglig hälsokoll på prod-data efter Modus-parallelldrift
 *
 * Schemalagd körning av prodHealthCheckService för konfigurerade tenants.
 * Kör en gång per dygn som default. WARN/FAIL skickar mail till operatör
 * via Resend om PROD_HEALTH_CHECK_OPERATOR_EMAIL är satt.
 *
 * Konfigurera via env:
 *   PROD_HEALTH_CHECK_ENABLED              "true"|"false"  (default: true i NODE_ENV=production, annars false)
 *   PROD_HEALTH_CHECK_TENANTS              "kinab,acme"    (CSV; default: "kinab")
 *   PROD_HEALTH_CHECK_INTERVAL_HOURS       24              (default 24)
 *   PROD_HEALTH_CHECK_INITIAL_DELAY_MIN    15              (default 15 min efter start)
 *   PROD_HEALTH_CHECK_OPERATOR_EMAIL       "ops@example.se"
 */

import { db } from "../db";
import { prodHealthCheckRuns } from "@shared/schema";
import {
  runProdHealthCheck,
  type HealthCheckResult,
} from "./prodHealthCheckService";

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return !["0", "false", "no", "off", ""].includes(v.toLowerCase());
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getConfiguredTenants(): string[] {
  const csv = process.env.PROD_HEALTH_CHECK_TENANTS || "kinab";
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function persistResult(
  result: HealthCheckResult,
  alertStatus: "sent" | "skipped" | "failed" | null,
  alertDetail: string | null,
  errorMessage: string | null,
): Promise<void> {
  try {
    await db.insert(prodHealthCheckRuns).values({
      tenantId: result.tenantId,
      status: result.status,
      passCount: result.passCount,
      warnCount: result.warnCount,
      failCount: result.failCount,
      durationMs: result.durationMs,
      counts: result.counts,
      checks: result.checks,
      thresholds: result.thresholds,
      alertStatus,
      alertDetail,
      errorMessage,
    });
  } catch (err) {
    console.error("[prod-health-check] kunde inte spara körning:", err);
  }
}

function buildEmailHtml(result: HealthCheckResult): string {
  const failed = result.checks.filter((c) => c.status === "FAIL");
  const warned = result.checks.filter((c) => c.status === "WARN");
  const rows = (list: typeof result.checks) =>
    list
      .map(
        (c) =>
          `<tr><td><b>${c.status}</b></td><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.detail)}</td></tr>`,
      )
      .join("");
  return `
<h2>Traivo prod-hälsokoll: ${result.status} (tenant ${escapeHtml(result.tenantId)})</h2>
<p>PASS=${result.passCount} · WARN=${result.warnCount} · FAIL=${result.failCount} · ${result.durationMs} ms</p>
${
  failed.length
    ? `<h3>FAIL (${failed.length})</h3>
       <table border="1" cellpadding="4" cellspacing="0">${rows(failed)}</table>`
    : ""
}
${
  warned.length
    ? `<h3>WARN (${warned.length})</h3>
       <table border="1" cellpadding="4" cellspacing="0">${rows(warned)}</table>`
    : ""
}
<h3>Räknesatser</h3>
<table border="1" cellpadding="4" cellspacing="0">
${Object.entries(result.counts)
  .map(
    ([k, v]) =>
      `<tr><td>${escapeHtml(k)}</td><td align="right">${v}</td></tr>`,
  )
  .join("")}
</table>
<p><i>Trösklar: ${escapeHtml(JSON.stringify(result.thresholds))}</i></p>
`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function maybeSendAlert(
  result: HealthCheckResult,
): Promise<{ status: "sent" | "skipped" | "failed"; detail: string | null }> {
  if (result.status === "PASS") return { status: "skipped", detail: "PASS — ingen notis" };
  const to = process.env.PROD_HEALTH_CHECK_OPERATOR_EMAIL;
  if (!to) {
    return {
      status: "skipped",
      detail: "PROD_HEALTH_CHECK_OPERATOR_EMAIL ej satt",
    };
  }
  try {
    const { sendEmail } = await import("../replit_integrations/resend");
    const subject = `[Traivo ${result.status}] Prod-hälsokoll ${result.tenantId} (${result.failCount} FAIL, ${result.warnCount} WARN)`;
    await sendEmail({ to, subject, html: buildEmailHtml(result) });
    return { status: "sent", detail: `notis skickad till ${to}` };
  } catch (err) {
    console.error("[prod-health-check] kunde inte skicka notis:", err);
    return { status: "failed", detail: (err as Error).message };
  }
}

async function runOnceForTenant(tenantId: string): Promise<void> {
  try {
    const result = await runProdHealthCheck(tenantId);
    const alert = await maybeSendAlert(result);
    await persistResult(result, alert.status, alert.detail, null);
    console.log(
      `[prod-health-check] tenant=${tenantId} status=${result.status} pass=${result.passCount} warn=${result.warnCount} fail=${result.failCount} alert=${alert.status}`,
    );
  } catch (err) {
    console.error(`[prod-health-check] tenant=${tenantId} fatal`, err);
    await persistResult(
      {
        tenantId,
        status: "FAIL",
        passCount: 0,
        warnCount: 0,
        failCount: 1,
        durationMs: 0,
        counts: {},
        checks: [{ name: "scheduler", status: "FAIL", detail: (err as Error).message }],
        thresholds: {
          minActiveCustomers: 0,
          minActiveObjects: 0,
          maxOrphans: 0,
          maxLeakRows: 0,
        },
      },
      "skipped",
      "körningen kraschade",
      (err as Error).message,
    );
  }
}

// Per-tenant lock så att överlappande körningar (schemalagd + manuell trigger,
// eller två manuella triggers) inte producerar dubbla rader/notiser.
const runningTenants = new Set<string>();

export function isProdHealthCheckRunning(tenantId: string): boolean {
  return runningTenants.has(tenantId);
}

export async function runProdHealthCheckNow(tenantId?: string): Promise<void> {
  const tenants = tenantId ? [tenantId] : getConfiguredTenants();
  for (const t of tenants) {
    if (runningTenants.has(t)) {
      console.log(
        `[prod-health-check] tenant=${t} hoppar över — föregående körning pågår`,
      );
      continue;
    }
    runningTenants.add(t);
    try {
      await runOnceForTenant(t);
    } finally {
      runningTenants.delete(t);
    }
  }
}

class ProdHealthCheckScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;

  private get enabled(): boolean {
    const defaultOn = process.env.NODE_ENV === "production";
    return envBool("PROD_HEALTH_CHECK_ENABLED", defaultOn);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[prod-health-check] Inaktiverad (sätt PROD_HEALTH_CHECK_ENABLED=true för att slå på)");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) return;
    const intervalMs = envInt("PROD_HEALTH_CHECK_INTERVAL_HOURS", 24) * 60 * 60 * 1000;
    const initialDelayMs = envInt("PROD_HEALTH_CHECK_INITIAL_DELAY_MIN", 15) * 60 * 1000;
    const tenants = getConfiguredTenants();
    console.log(
      `[prod-health-check] Startad (intervall ${Math.round(intervalMs / 3600_000)}h, första körning om ${Math.round(initialDelayMs / 60_000)} min, tenants=${tenants.join(",")})`,
    );
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      void runProdHealthCheckNow();
    }, initialDelayMs);
    this.intervalId = setInterval(() => {
      void runProdHealthCheckNow();
    }, intervalMs);
  }

  stop(): void {
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[prod-health-check] Stoppad");
    }
  }
}

export const prodHealthCheckScheduler = new ProdHealthCheckScheduler();
