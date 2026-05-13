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

class FortnoxMappingCleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;
  private running = false;

  private get enabled(): boolean {
    const flag = process.env.FORTNOX_MAPPING_CLEANUP_ENABLED;
    if (flag === undefined) return true;
    return !["0", "false", "no", "off"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.FORTNOX_MAPPING_CLEANUP_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parseNonNegativeInt(process.env.FORTNOX_MAPPING_CLEANUP_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[fortnox-mapping-cleanup] Disabled via FORTNOX_MAPPING_CLEANUP_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) {
      console.log("[fortnox-mapping-cleanup] Already running");
      return;
    }

    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;

    console.log(
      `[fortnox-mapping-cleanup] Started (interval ${Math.round(intervalMs / 60000)} min, first run in ${Math.round(initialDelayMs / 1000)}s)`
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
      console.log("[fortnox-mapping-cleanup] Stopped");
    }
  }

  async runOnce(): Promise<{ customer: number; article: number; resource: number; total: number }> {
    if (this.running) {
      console.log("[fortnox-mapping-cleanup] Skipping run - previous run still in progress");
      return { customer: 0, article: 0, resource: 0, total: 0 };
    }
    this.running = true;
    const startedAt = Date.now();
    try {
      const stats = await storage.cleanupOrphanFortnoxMappings();
      const durationMs = Date.now() - startedAt;
      if (stats.total > 0) {
        console.log(
          `[fortnox-mapping-cleanup] Run complete in ${Math.round(durationMs)}ms: deleted ${stats.total} orphan mappings (customer=${stats.customer}, article=${stats.article}, resource=${stats.resource})`
        );
      } else {
        console.log(`[fortnox-mapping-cleanup] Run complete in ${Math.round(durationMs)}ms: no orphan mappings found`);
      }
      return stats;
    } catch (err) {
      console.error("[fortnox-mapping-cleanup] Fatal error during run:", err);
      return { customer: 0, article: 0, resource: 0, total: 0 };
    } finally {
      this.running = false;
    }
  }
}

export const fortnoxMappingCleanupScheduler = new FortnoxMappingCleanupScheduler();
