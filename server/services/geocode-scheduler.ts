import { storage } from "../storage";
import { trackApiUsage } from "../api-usage-tracker";
import { geocodeMissingForTenant, type GeocodeBatchSummary } from "./geocoding";
import { evaluateAndNotifyMissingCoordinates } from "./missing-coordinates-notifier";

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

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after startup
const DEFAULT_TENANT_DELAY_MS = 2000;
const DEFAULT_PER_OBJECT_DELAY_MS = 200;
const DEFAULT_MAX_PER_TENANT = 200;

class GeocodeScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;
  private running = false;

  private get enabled(): boolean {
    const flag = process.env.GEOCODE_SCHEDULER_ENABLED;
    if (flag === undefined) return true;
    return !["0", "false", "no", "off"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.GEOCODE_SCHEDULER_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parseNonNegativeInt(process.env.GEOCODE_SCHEDULER_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  private get tenantDelayMs(): number {
    return parseNonNegativeInt(process.env.GEOCODE_SCHEDULER_TENANT_DELAY_MS, DEFAULT_TENANT_DELAY_MS);
  }

  private get perObjectDelayMs(): number {
    return parseNonNegativeInt(process.env.GEOCODE_SCHEDULER_PER_OBJECT_DELAY_MS, DEFAULT_PER_OBJECT_DELAY_MS);
  }

  private get maxPerTenant(): number {
    return parseNonNegativeInt(process.env.GEOCODE_SCHEDULER_MAX_PER_TENANT, DEFAULT_MAX_PER_TENANT);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[geocode-scheduler] Disabled via GEOCODE_SCHEDULER_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) {
      console.log("[geocode-scheduler] Already running");
      return;
    }

    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;

    console.log(
      `[geocode-scheduler] Started (interval ${Math.round(intervalMs / 60000)} min, first run in ${Math.round(initialDelayMs / 1000)}s)`
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
      console.log("[geocode-scheduler] Stopped");
    }
  }

  async runOnce(): Promise<{
    tenants: number;
    total: number;
    geocoded: number;
    failed: number;
    skipped: number;
    perTenant: Array<{ tenantId: string; summary: GeocodeBatchSummary }>;
  }> {
    if (this.running) {
      console.log("[geocode-scheduler] Skipping run - previous run still in progress");
      return { tenants: 0, total: 0, geocoded: 0, failed: 0, skipped: 0, perTenant: [] };
    }
    this.running = true;
    const startedAt = Date.now();

    const aggregate = {
      tenants: 0,
      total: 0,
      geocoded: 0,
      failed: 0,
      skipped: 0,
      perTenant: [] as Array<{ tenantId: string; summary: GeocodeBatchSummary }>,
    };

    try {
      const tenants = await storage.getPublicTenants();
      const tenantDelayMs = this.tenantDelayMs;
      const perObjectDelayMs = this.perObjectDelayMs;
      const maxPerTenant = this.maxPerTenant;

      console.log(`[geocode-scheduler] Run started for ${tenants.length} tenant(s)`);

      for (let i = 0; i < tenants.length; i++) {
        const tenant = tenants[i];
        try {
          const summary = await geocodeMissingForTenant(tenant.id, {
            delayMs: perObjectDelayMs,
            limit: maxPerTenant > 0 ? maxPerTenant : undefined,
            useSearchDestinations: true,
          });

          aggregate.tenants++;
          aggregate.total += summary.total;
          aggregate.geocoded += summary.geocoded;
          aggregate.failed += summary.failed;
          aggregate.skipped += summary.skipped;
          aggregate.perTenant.push({ tenantId: tenant.id, summary });

          if (summary.total > 0) {
            await trackApiUsage({
              tenantId: tenant.id,
              service: "geocode-scheduler",
              endpoint: "scheduled-run",
              method: "batch",
              units: summary.total,
              statusCode: summary.failed > 0 ? 207 : 200,
              metadata: {
                geocoded: summary.geocoded,
                failed: summary.failed,
                skipped: summary.skipped,
                total: summary.total,
              },
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[geocode-scheduler] Tenant ${tenant.id} failed: ${message}`);
          await trackApiUsage({
            tenantId: tenant.id,
            service: "geocode-scheduler",
            endpoint: "scheduled-run",
            method: "batch",
            units: 0,
            statusCode: 500,
            metadata: { error: message },
          }).catch(() => {});
        }

        try {
          await evaluateAndNotifyMissingCoordinates(tenant.id);
        } catch (notifyErr) {
          const message = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
          console.error(
            `[geocode-scheduler] Missing-coords notification failed for tenant ${tenant.id}: ${message}`,
          );
        }

        if (i < tenants.length - 1 && tenantDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, tenantDelayMs));
        }
      }

      const durationMs = Date.now() - startedAt;
      console.log(
        `[geocode-scheduler] Run complete in ${Math.round(durationMs / 1000)}s: ${aggregate.geocoded} geocoded, ${aggregate.failed} failed, ${aggregate.skipped} skipped across ${aggregate.tenants} tenant(s)`
      );
    } catch (err) {
      console.error("[geocode-scheduler] Fatal error during run:", err);
    } finally {
      this.running = false;
    }

    return aggregate;
  }
}

export const geocodeScheduler = new GeocodeScheduler();
