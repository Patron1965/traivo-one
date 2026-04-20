import { db } from "../db";
import { tenants } from "@shared/schema";
import { computeTenantSlaRisk } from "./sla-risk-engine";

async function runForAllTenants() {
  try {
    const allTenants = await db.select({ id: tenants.id }).from(tenants);
    for (const t of allTenants) {
      try {
        const { snapshots, transitions } = await computeTenantSlaRisk(t.id);
        const critical = snapshots.filter(s => s.riskLevel === "critical").length;
        const warning = snapshots.filter(s => s.riskLevel === "warning").length;
        if (snapshots.length > 0 || transitions.length > 0) {
          console.log(
            `[sla-risk] tenant=${t.id} snapshots=${snapshots.length} critical=${critical} warning=${warning} transitions=${transitions.length}`,
          );
        }
      } catch (err) {
        console.error(`[sla-risk] tenant ${t.id} failed`, err);
      }
    }
  } catch (err) {
    console.error("[sla-risk] scheduler fatal", err);
  }
}

class SlaRiskScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private intervalMs = 60 * 60 * 1000; // hourly

  start() {
    if (this.intervalId) return;
    console.log("[sla-risk] Started (runs every hour)");
    this.intervalId = setInterval(() => runForAllTenants(), this.intervalMs);
    setTimeout(() => runForAllTenants(), 90 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[sla-risk] Stopped");
    }
  }

  async runNow() {
    await runForAllTenants();
  }
}

export const slaRiskScheduler = new SlaRiskScheduler();
export { runForAllTenants };
