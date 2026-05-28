// ============================================
// Task #582: Dagligt schemalagt jobb för Telink-synk.
// Default AV — sätt TELINK_SYNC_ENABLED=true för att aktivera schemaläggaren.
// Per-tenant aktivering krävs dessutom via tenant.settings.telink.enabled.
// ============================================
import { db } from "../db";
import { tenants } from "@shared/schema";
import { runTelinkSyncForTenant, readTelinkConfig } from "./telink-client";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 min efter boot

async function runForAllTenants(): Promise<void> {
  try {
    const allTenants = await db
      .select({ id: tenants.id, settings: tenants.settings })
      .from(tenants);
    for (const t of allTenants) {
      const config = readTelinkConfig(t.settings);
      if (!config || !config.enabled) continue;
      try {
        const result = await runTelinkSyncForTenant(t.id, { mode: "scheduled" });
        console.log(
          `[telink-sync] tenant=${t.id} fetched=${result.fetched} matched=${result.matched} updated=${result.updated} issues=${result.issuesCreated} errors=${result.errors.length}`,
        );
      } catch (err) {
        console.error(`[telink-sync] tenant ${t.id} failed`, err);
      }
    }
  } catch (err) {
    console.error("[telink-sync] scheduler fatal", err);
  }
}

class TelinkSyncScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;

  private get enabled(): boolean {
    // Default PÅ: schemaläggaren rullar i alla miljöer så snart processen
    // startar. Faktisk synk-aktivering styrs per tenant via
    // tenant.settings.telink.enabled — tenants som inte konfigurerat
    // Telink skippas tyst av runForAllTenants(). Sätt
    // TELINK_SYNC_ENABLED=false för att slå AV schemaläggaren globalt
    // (t.ex. i tester eller lokal utveckling).
    const flag = process.env.TELINK_SYNC_ENABLED;
    if (!flag) return true;
    return ["1", "true", "yes", "on"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.TELINK_SYNC_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parsePositiveInt(process.env.TELINK_SYNC_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[telink-sync] Disabled (sätt TELINK_SYNC_ENABLED=true för att slå på)");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) return;
    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;
    console.log(
      `[telink-sync] Started (interval ${Math.round(intervalMs / 3600000)}h, first run in ${Math.round(initialDelayMs / 1000)}s)`,
    );
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      void runForAllTenants();
    }, initialDelayMs);
    this.intervalId = setInterval(() => void runForAllTenants(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
  }

  async runNow(): Promise<void> {
    await runForAllTenants();
  }
}

export const telinkSyncScheduler = new TelinkSyncScheduler();
