// Task #1243: Schemalagt kund-/artikelsynk-jobb mot Fortnox.
// Uppdaterar EFTERHAND mappade kunder/artiklar med aktuella namn/pris/status
// från Fortnox (drift-skydd — annars laddas data bara in en gång vid import
// och kan bli inaktuell). Skapar INGA nya lokala kunder/artiklar — det gör
// befintliga import-endpoints (POST /api/fortnox/customers/import och
// /articles/import) explicit, med användarens godkännande. Denna schemaläggare
// är läs-och-uppdatera, inte läs-och-skapa, för att undvika oönskad datatillväxt.
// Default AV — sätt FORTNOX_SYNC_ENABLED=true för att aktivera.
import { db } from "../db";
import { fortnoxConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { FortnoxClient } from "../fortnox-client";
import { isActiveArticleStatus } from "../article-quantity";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const DEFAULT_INITIAL_DELAY_MS = 7 * 60 * 1000; // 7 min efter boot

export interface FortnoxSyncResult {
  tenantId: string;
  customersChecked: number;
  customersUpdated: number;
  articlesChecked: number;
  articlesUpdated: number;
  errors: string[];
}

async function syncCustomersForTenant(tenantId: string, client: FortnoxClient): Promise<{ checked: number; updated: number; errors: string[] }> {
  const errors: string[] = [];
  let checked = 0;
  let updated = 0;
  try {
    const mappings = await storage.getFortnoxMappings(tenantId, "customer");
    if (!mappings.length) return { checked: 0, updated: 0, errors };
    const fortnoxCustomers = await client.getCustomers();
    const byNumber = new Map(fortnoxCustomers.map((c: any) => [c.CustomerNumber, c]));
    for (const mapping of mappings) {
      const fc = byNumber.get(mapping.fortnoxId);
      if (!fc) continue;
      checked++;
      try {
        const local = await storage.getCustomer(mapping.unicornId);
        if (!local || local.tenantId !== tenantId) continue;
        const addressParts = [fc.Address1, fc.Address2].filter(Boolean);
        const patch: Record<string, unknown> = {};
        if (fc.Name && fc.Name !== local.name) patch.name = fc.Name;
        if (fc.Phone1 && fc.Phone1 !== local.phone) patch.phone = fc.Phone1;
        if (fc.Email && fc.Email !== local.email) patch.email = fc.Email;
        const address = addressParts.join(", ") || undefined;
        if (address && address !== local.address) patch.address = address;
        if (fc.ZipCode && fc.ZipCode !== local.postalCode) patch.postalCode = fc.ZipCode;
        if (fc.City && fc.City !== local.city) patch.city = fc.City;
        if (Object.keys(patch).length > 0) {
          await storage.updateCustomer(mapping.unicornId, patch as any);
          updated++;
        }
      } catch (err) {
        errors.push(`kund ${mapping.fortnoxId}: ${err instanceof Error ? err.message : "okänt fel"}`);
      }
    }
  } catch (err) {
    errors.push(`kundhämtning: ${err instanceof Error ? err.message : "okänt fel"}`);
  }
  return { checked, updated, errors };
}

async function syncArticlesForTenant(tenantId: string, client: FortnoxClient): Promise<{ checked: number; updated: number; errors: string[] }> {
  const errors: string[] = [];
  let checked = 0;
  let updated = 0;
  try {
    const mappings = await storage.getFortnoxMappings(tenantId, "article");
    if (!mappings.length) return { checked: 0, updated: 0, errors };
    const fortnoxArticles = await client.getArticles();
    const byNumber = new Map(fortnoxArticles.map((a: any) => [a.ArticleNumber, a]));
    for (const mapping of mappings) {
      const fa = byNumber.get(mapping.fortnoxId);
      if (!fa) continue;
      checked++;
      try {
        const local = await storage.getArticle(mapping.unicornId);
        if (!local || local.tenantId !== tenantId) continue;
        const patch: Record<string, unknown> = {};
        if (fa.Description && fa.Description !== local.name) patch.name = fa.Description;
        if (typeof fa.SalesPrice === "number") {
          // listPrice-fältet är öre (DB-konvention); Fortnox anger pris i kronor.
          const listPriceOre = Math.round(fa.SalesPrice * 100);
          if (listPriceOre !== (local as any).listPrice) patch.listPrice = listPriceOre;
        }
        if (typeof fa.Active === "boolean" && isActiveArticleStatus((local as any).status) !== fa.Active) {
          // Status divergerar från Fortnox — uppdatera till svensk konvention (aktiv/utgått).
          patch.status = fa.Active ? "aktiv" : "utgått";
        }
        if (Object.keys(patch).length > 0) {
          await storage.updateArticle(mapping.unicornId, patch as any);
          updated++;
        }
      } catch (err) {
        errors.push(`artikel ${mapping.fortnoxId}: ${err instanceof Error ? err.message : "okänt fel"}`);
      }
    }
  } catch (err) {
    errors.push(`artikelhämtning: ${err instanceof Error ? err.message : "okänt fel"}`);
  }
  return { checked, updated, errors };
}

export async function runFortnoxSyncForTenant(tenantId: string): Promise<FortnoxSyncResult> {
  const result: FortnoxSyncResult = {
    tenantId,
    customersChecked: 0,
    customersUpdated: 0,
    articlesChecked: 0,
    articlesUpdated: 0,
    errors: [],
  };
  const client = new FortnoxClient(tenantId);
  if (!(await client.isConnected())) {
    result.errors.push("Fortnox är inte anslutet");
    return result;
  }
  const customerSync = await syncCustomersForTenant(tenantId, client);
  const articleSync = await syncArticlesForTenant(tenantId, client);
  result.customersChecked = customerSync.checked;
  result.customersUpdated = customerSync.updated;
  result.articlesChecked = articleSync.checked;
  result.articlesUpdated = articleSync.updated;
  result.errors.push(...customerSync.errors, ...articleSync.errors);
  try {
    await storage.updateFortnoxConfig(tenantId, { lastSyncAt: new Date() });
  } catch {
    // Best-effort — sync-resultatet är oberoende av denna stämpel.
  }
  return result;
}

async function runForAllTenants(): Promise<void> {
  try {
    const activeConfigs = await db
      .select({ tenantId: fortnoxConfig.tenantId })
      .from(fortnoxConfig)
      .where(eq(fortnoxConfig.isActive, true));
    for (const c of activeConfigs) {
      try {
        const result = await runFortnoxSyncForTenant(c.tenantId);
        console.log(
          `[fortnox-sync] tenant=${c.tenantId} kunder=${result.customersUpdated}/${result.customersChecked} artiklar=${result.articlesUpdated}/${result.articlesChecked} fel=${result.errors.length}`,
        );
      } catch (err) {
        console.error(`[fortnox-sync] tenant ${c.tenantId} misslyckades`, err);
      }
    }
  } catch (err) {
    console.error("[fortnox-sync] scheduler fatal", err);
  }
}

class FortnoxSyncScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;

  private get enabled(): boolean {
    const flag = process.env.FORTNOX_SYNC_ENABLED;
    if (!flag) return false;
    return ["1", "true", "yes", "on"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.FORTNOX_SYNC_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parsePositiveInt(process.env.FORTNOX_SYNC_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  start(): void {
    if (!this.enabled) {
      console.log("[fortnox-sync] Inaktiverad (sätt FORTNOX_SYNC_ENABLED=true för att slå på)");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) return;
    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;
    console.log(
      `[fortnox-sync] Started (interval ${Math.round(intervalMs / 3600000)}h, first run in ${Math.round(initialDelayMs / 1000)}s)`,
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

export const fortnoxSyncScheduler = new FortnoxSyncScheduler();
