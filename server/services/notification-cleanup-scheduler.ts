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
const DEFAULT_INITIAL_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_RETENTION_READ_DAYS = 90;
const DEFAULT_RETENTION_UNREAD_DAYS = 365;

export function getRetentionConfig(): { readDays: number; unreadDays: number } {
  return {
    readDays: parsePositiveInt(process.env.NOTIFICATION_RETENTION_READ_DAYS, DEFAULT_RETENTION_READ_DAYS),
    unreadDays: parsePositiveInt(process.env.NOTIFICATION_RETENTION_UNREAD_DAYS, DEFAULT_RETENTION_UNREAD_DAYS),
  };
}

class NotificationCleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;
  private running = false;

  private get enabled(): boolean {
    const flag = process.env.NOTIFICATION_CLEANUP_ENABLED;
    if (flag === undefined) return true;
    return !["0", "false", "no", "off"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.NOTIFICATION_CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parseNonNegativeInt(process.env.NOTIFICATION_CLEANUP_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[notification-cleanup] Disabled via NOTIFICATION_CLEANUP_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) {
      console.log("[notification-cleanup] Already running");
      return;
    }

    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;
    const { readDays, unreadDays } = getRetentionConfig();

    console.log(
      `[notification-cleanup] Started (interval ${Math.round(intervalMs / 60000)} min, first run in ${Math.round(initialDelayMs / 1000)}s, retention read=${readDays}d unread=${unreadDays}d)`
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
      console.log("[notification-cleanup] Stopped");
    }
  }

  async runOnce(): Promise<{ readDeleted: number; unreadDeleted: number; readDays: number; unreadDays: number }> {
    if (this.running) {
      console.log("[notification-cleanup] Skipping run - previous run still in progress");
      return { readDeleted: 0, unreadDeleted: 0, ...getRetentionConfig() };
    }
    this.running = true;
    const startedAt = Date.now();
    const { readDays, unreadDays } = getRetentionConfig();
    try {
      const { readDeleted, unreadDeleted } = await storage.deleteOldUserNotifications({
        readOlderThanDays: readDays,
        unreadOlderThanDays: unreadDays,
      });
      const durationMs = Date.now() - startedAt;
      console.log(
        `[notification-cleanup] Run complete in ${Math.round(durationMs)}ms: deleted ${readDeleted} read (>${readDays}d) and ${unreadDeleted} unread (>${unreadDays}d)`
      );
      return { readDeleted, unreadDeleted, readDays, unreadDays };
    } catch (err) {
      console.error("[notification-cleanup] Fatal error during run:", err);
      return { readDeleted: 0, unreadDeleted: 0, readDays, unreadDays };
    } finally {
      this.running = false;
    }
  }
}

export const notificationCleanupScheduler = new NotificationCleanupScheduler();
