import { and, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { userNotifications } from "@shared/schema";
import { storage } from "../storage";
import { notificationService } from "../notifications";
import { computeTenantCarryOver, carryOverNotificationCopy, type CarryOverSummary } from "./carry-over";

// Roller som ska få carry-over-notisen (tenant-rollen från user_tenant_roles).
const NOTIFY_ROLES = new Set(["owner", "admin", "planner", "team_leader"]);
const DEFAULT_HOUR = 16;
const DEFAULT_TIMEZONE = process.env.CARRY_OVER_TIMEZONE || "Europe/Stockholm";
const TICK_INTERVAL_MS = 15 * 60 * 1000; // var 15:e min — räcker för en-timmas-precision
const NOTIFICATION_TYPE = "carry_over_warning" as const;

function isEnabled(): boolean {
  const flag = process.env.CARRY_OVER_NOTIFICATIONS_ENABLED;
  if (flag === undefined) return true;
  return !["0", "false", "no", "off"].includes(flag.toLowerCase());
}

interface TenantLocalDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  isoDate: string; // YYYY-MM-DD i tenant-lokal tidszon
}

function getTenantLocalParts(now: Date, timeZone: string): TenantLocalDate {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "0";
  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // Intl kan returnera "24" beroende på locale
  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, isoDate };
}

function buildLocalDate(year: number, month: number, day: number): Date {
  // Vi använder middag-UTC för att undvika DST-kanter när vi sen anropar
  // getWorkOrdersByDate som dag-bucketar på dateparam.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(parts: TenantLocalDate, n: number): { year: number; month: number; day: number; isoDate: string } {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + n);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + 1;
  const d = base.getUTCDate();
  return { year: y, month: m, day: d, isoDate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

class CarryOverNotificationScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;
  // tenantId -> senaste isoDate (tenant-lokalt) som notisen kördes för. Förhindrar
  // dubbla utskick samma dag om tick-fönstret träffar samma timme två gånger.
  private lastRunByTenant: Map<string, string> = new Map();
  private running = false;

  start(): void {
    if (!isEnabled()) {
      console.log("[carry-over] Disabled via CARRY_OVER_NOTIFICATIONS_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) {
      console.log("[carry-over] Already running");
      return;
    }
    console.log(`[carry-over] Started (tick ${TICK_INTERVAL_MS / 60000} min, timezone ${DEFAULT_TIMEZONE}, default hour ${DEFAULT_HOUR})`);
    // Första tick efter 2 min så servern hinner bli redo.
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      void this.tick();
    }, 2 * 60 * 1000);
    this.intervalId = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.initialTimeoutId) { clearTimeout(this.initialTimeoutId); this.initialTimeoutId = null; }
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; console.log("[carry-over] Stopped"); }
  }

  async tick(): Promise<void> {
    if (!isEnabled() || this.running) return;
    this.running = true;
    try {
      const tenants = await storage.getPublicTenants();
      const now = new Date();
      for (const tenant of tenants) {
        try {
          await this.maybeRunForTenant(tenant.id, now);
        } catch (err) {
          // Fail-safe: ett tenant-fel påverkar inte andra.
          console.error(`[carry-over] tenant ${tenant.id} failed:`, err);
        }
      }
    } catch (err) {
      console.error("[carry-over] tick fatal:", err);
    } finally {
      this.running = false;
    }
  }

  private async maybeRunForTenant(tenantId: string, now: Date): Promise<void> {
    const local = getTenantLocalParts(now, DEFAULT_TIMEZONE);
    // Slå inte upp planning_parameters förrän vi vet att vi *kanske* ska köra
    // (timmen kan matcha default eller en konfigurerad timme).
    const params = await storage.getPlanningParameters(tenantId);
    const tenantParam = params.find(p => !p.customerId && !p.objectId) ?? null;
    const configHour = tenantParam?.carryOverNotificationHour ?? DEFAULT_HOUR;

    if (local.hour !== configHour) return;
    // In-memory dedup (snabb-path inom samma process).
    if (this.lastRunByTenant.get(tenantId) === local.isoDate) return;
    // DB-dedup (överlever restart + multi-instans): kolla om någon
    // carry_over_warning redan skapats för denna tenant senaste 22 timmarna.
    const alreadySent = await this.hasRecentNotification(tenantId);
    if (alreadySent) {
      this.lastRunByTenant.set(tenantId, local.isoDate);
      return;
    }

    await this.runForTenant(tenantId, local);
    this.lastRunByTenant.set(tenantId, local.isoDate);
  }

  /**
   * DB-baserad dedup: returnerar true om någon carry_over_warning skickats för
   * tenant senaste 22h (täcker dag-fönstret men ger marginal vid lite skiftande
   * körtider och DST-övergångar). Bygger på existerande `user_notifications`-
   * tabell så ingen extra ledger behövs.
   */
  private async hasRecentNotification(tenantId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - 22 * 60 * 60 * 1000);
    const [row] = await db.select({ id: userNotifications.id })
      .from(userNotifications)
      .where(and(
        eq(userNotifications.tenantId, tenantId),
        eq(userNotifications.type, NOTIFICATION_TYPE),
        gte(userNotifications.createdAt, cutoff),
      ))
      .limit(1);
    return !!row;
  }

  private async runForTenant(tenantId: string, local: TenantLocalDate): Promise<CarryOverSummary | null> {
    const tomorrow = addDays(local, 1);
    const today = buildLocalDate(local.year, local.month, local.day);
    const tomorrowDate = buildLocalDate(tomorrow.year, tomorrow.month, tomorrow.day);

    const summary = await computeTenantCarryOver(tenantId, today, tomorrowDate);
    summary.tomorrow = tomorrow.isoDate;
    summary.today = local.isoDate;

    await this.deliverNotifications(tenantId, summary);
    console.log(
      `[carry-over] tenant=${tenantId} ${summary.today}→${summary.tomorrow} ` +
      `remaining=${summary.remainingTodayContainers} planned=${summary.plannedTomorrowContainers} ` +
      `total=${summary.totalContainers}/${summary.capacityTomorrow} (${summary.loadPercent}% ${summary.status})`,
    );
    return summary;
  }

  private async deliverNotifications(tenantId: string, summary: CarryOverSummary): Promise<void> {
    const users = await storage.getUsersByTenant(tenantId);
    const recipients = users.filter(u => {
      if (!u.isActive) return false;
      const role = (u.role ?? "").toLowerCase();
      return NOTIFY_ROLES.has(role);
    });
    if (recipients.length === 0) {
      console.log(`[carry-over] tenant=${tenantId} no eligible recipients (owner/admin/planner/team_leader)`);
      return;
    }

    const { title, message } = carryOverNotificationCopy(summary);
    const link = `/planner?day=${summary.tomorrow}`;
    const data = {
      summary,
      tomorrow: summary.tomorrow,
      status: summary.status,
      loadPercent: summary.loadPercent,
    } as const;

    for (const user of recipients) {
      try {
        const pref = await storage.getUserNotificationPreference(tenantId, user.id, NOTIFICATION_TYPE);
        if (pref && !pref.enabled) continue;
        const row = await storage.createUserNotification({
          tenantId,
          userId: user.id,
          type: NOTIFICATION_TYPE,
          title,
          message,
          link,
          data,
          isRead: false,
        });
        notificationService.sendUserNotification(user.id, {
          notificationId: row.id,
          type: NOTIFICATION_TYPE,
          title,
          message,
          link,
          data,
          createdAt: row.createdAt?.toISOString(),
        });
      } catch (err) {
        console.error(`[carry-over] failed to notify user ${user.id} in tenant ${tenantId}:`, err);
      }
    }
  }

  /** Manuell trigger för admin-endpoint och tester. */
  async runManual(tenantId: string, opts: { dryRun?: boolean } = {}): Promise<CarryOverSummary> {
    const local = getTenantLocalParts(new Date(), DEFAULT_TIMEZONE);
    const tomorrow = addDays(local, 1);
    const today = buildLocalDate(local.year, local.month, local.day);
    const tomorrowDate = buildLocalDate(tomorrow.year, tomorrow.month, tomorrow.day);
    const summary = await computeTenantCarryOver(tenantId, today, tomorrowDate);
    summary.tomorrow = tomorrow.isoDate;
    summary.today = local.isoDate;
    if (!opts.dryRun) {
      await this.deliverNotifications(tenantId, summary);
      this.lastRunByTenant.set(tenantId, local.isoDate);
    }
    return summary;
  }
}

export const carryOverNotificationScheduler = new CarryOverNotificationScheduler();
export const CARRY_OVER_NOTIFICATION_TYPE = NOTIFICATION_TYPE;
