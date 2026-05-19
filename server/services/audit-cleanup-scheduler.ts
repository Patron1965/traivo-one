import { storage } from "../storage";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 15 * 60 * 1000;
const DEFAULT_LOGIN_RETENTION_DAYS = 365;
const DEFAULT_OTHER_RETENTION_DAYS = 730;

export interface AuditRetentionConfig {
  loginDays: number;
  otherDays: number;
}

export function getAuditRetentionConfig(): AuditRetentionConfig {
  return {
    loginDays: parsePositiveInt(process.env.AUDIT_LOG_LOGIN_RETENTION_DAYS, DEFAULT_LOGIN_RETENTION_DAYS),
    otherDays: parsePositiveInt(process.env.AUDIT_LOG_RETENTION_DAYS, DEFAULT_OTHER_RETENTION_DAYS),
  };
}

class AuditCleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;
  private running = false;

  private get enabled(): boolean {
    const flag = process.env.AUDIT_LOG_CLEANUP_ENABLED;
    if (flag === undefined) return true;
    return !["0", "false", "no", "off"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.AUDIT_LOG_CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parseNonNegativeInt(process.env.AUDIT_LOG_CLEANUP_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[audit-cleanup] Disabled via AUDIT_LOG_CLEANUP_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) {
      console.log("[audit-cleanup] Already running");
      return;
    }

    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;
    const { loginDays, otherDays } = getAuditRetentionConfig();

    console.log(
      `[audit-cleanup] Started (interval ${Math.round(intervalMs / 60000)} min, first run in ${Math.round(initialDelayMs / 1000)}s, retention login=${loginDays}d other=${otherDays}d)`
    );

    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      void this.runOnce();
    }, initialDelayMs);

    this.intervalId = setInterval(() => {
      void this.runOnce();
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
      console.log("[audit-cleanup] Stopped");
    }
  }

  async runOnce(): Promise<{ loginDeleted: number; otherDeleted: number; loginDays: number; otherDays: number }> {
    const { loginDays, otherDays } = getAuditRetentionConfig();
    if (this.running) {
      console.log("[audit-cleanup] Skipping run - previous run still in progress");
      return { loginDeleted: 0, otherDeleted: 0, loginDays, otherDays };
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      const { loginDeleted, otherDeleted } = await storage.deleteOldAuditLogs({
        loginOlderThanDays: loginDays,
        otherOlderThanDays: otherDays,
      });
      const durationMs = Date.now() - startedAt;
      console.log(
        `[audit-cleanup] Run complete in ${Math.round(durationMs)}ms: deleted ${loginDeleted} login (>${loginDays}d) and ${otherDeleted} other (>${otherDays}d)`
      );
      return { loginDeleted, otherDeleted, loginDays, otherDays };
    } catch (err) {
      console.error("[audit-cleanup] Fatal error during run:", err);
      return { loginDeleted: 0, otherDeleted: 0, loginDays, otherDays };
    } finally {
      this.running = false;
    }
  }
}

export const auditCleanupScheduler = new AuditCleanupScheduler();
