// ============================================
// Task #558: Schemalagt jobb för konsolidering av fakturor
// ============================================
import { db } from "../db";
import { tenants } from "@shared/schema";
import { runConsolidationForTenant } from "./invoice-consolidation";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DEFAULT_INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min

async function runForAllTenants(): Promise<void> {
  try {
    const allTenants = await db.select({ id: tenants.id }).from(tenants);
    for (const t of allTenants) {
      try {
        const result = await runConsolidationForTenant(t.id, { now: new Date() });
        if (result.invoicesCreated > 0 || result.workOrdersConsolidated > 0) {
          console.log(
            `[invoice-consolidation] tenant=${t.id} groups=${result.groupsProcessed} invoices=${result.invoicesCreated} wos=${result.workOrdersConsolidated}`,
          );
        }
      } catch (err) {
        console.error(`[invoice-consolidation] tenant ${t.id} failed`, err);
      }
    }
  } catch (err) {
    console.error("[invoice-consolidation] scheduler fatal", err);
  }
}

class InvoiceConsolidationScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;

  private get enabled(): boolean {
    const flag = process.env.INVOICE_CONSOLIDATION_ENABLED;
    if (flag === undefined) return true;
    return !["0", "false", "no", "off"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.INVOICE_CONSOLIDATION_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parsePositiveInt(process.env.INVOICE_CONSOLIDATION_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[invoice-consolidation] Disabled via INVOICE_CONSOLIDATION_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) return;
    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;
    console.log(
      `[invoice-consolidation] Started (interval ${Math.round(intervalMs / 60000)} min, first run in ${Math.round(initialDelayMs / 1000)}s)`,
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

export const invoiceConsolidationScheduler = new InvoiceConsolidationScheduler();
