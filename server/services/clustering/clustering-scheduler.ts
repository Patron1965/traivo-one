/**
 * Klustringsschemaläggaren — tre-nivå frekvensstrategi.
 *
 * Nivå 1 – Near-term (≤30d): inkrementell via clusteringQueue vid varje trigger
 *           (hanteras av clustering-queue.ts + workOrderRoutes.ts — ej här).
 *
 * Nivå 2 – Mid-term (30–90d): schemalagd daglig körning kl. 02:00 lokal tid.
 *           Kör runRollingAnalysis med horizon=90d för alla tenanter.
 *
 * Nivå 3 – Long-term (90–365d): schemalagd veckovis (söndagar) kl. 03:00.
 *           Kör runRollingAnalysis med horizon=365d för alla tenanter.
 *
 * Loggar varje körning till task_events (best-effort).
 *
 * Notering: startar i server/routes.ts via clusteringScheduler.start().
 */
import { db } from "../../db";
import { taskEvents, tenants } from "@shared/schema";
import { runRollingAnalysis, getAllTenantIds } from "./route-clustering-engine";

const TICK_MS = 60 * 60 * 1000; // En gång per timme
const TIMEZONE = process.env.CLUSTERING_TIMEZONE || "Europe/Stockholm";

function getLocalParts(now: Date): {
  hour: number;
  weekday: number; // 0=Söndag
} {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0;

  // Veckodagsindex: 0=Söndag
  const dayNames: Record<string, number> = {
    sön: 0,
    mån: 1,
    tis: 2,
    ons: 3,
    tor: 4,
    fre: 5,
    lör: 6,
  };
  const dayStr = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "";
  const weekday = dayNames[dayStr] ?? now.getDay();

  return { hour, weekday };
}

async function logSchedulerEvent(
  tenantId: string,
  representativeWoId: string | null,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!representativeWoId) return;
  try {
    await db.insert(taskEvents).values({
      tenantId,
      workOrderId: representativeWoId,
      eventType,
      actorType: "system",
      actorId: null,
      detail,
      occurredAt: new Date(),
    });
  } catch {
    // best-effort
  }
}

async function runDailyAnalysis(): Promise<void> {
  console.log("[clustering-scheduler] Running daily mid-term analysis (30–90d)");
  const tenantIds = await getAllTenantIds();
  for (const tenantId of tenantIds) {
    try {
      const result = await runRollingAnalysis(tenantId, 90);
      console.log(
        `[clustering-scheduler] daily tenant=${tenantId} created=${result.created} dissolved=${result.dissolved} assigned=${result.assigned} durationMs=${result.durationMs}`,
      );
    } catch (err) {
      console.error(
        `[clustering-scheduler] daily error tenant=${tenantId}:`,
        err,
      );
    }
  }
}

async function runWeeklyAnalysis(): Promise<void> {
  console.log("[clustering-scheduler] Running weekly long-term analysis (90–365d)");
  const tenantIds = await getAllTenantIds();
  for (const tenantId of tenantIds) {
    try {
      const result = await runRollingAnalysis(tenantId, 365);
      console.log(
        `[clustering-scheduler] weekly tenant=${tenantId} created=${result.created} dissolved=${result.dissolved} assigned=${result.assigned} durationMs=${result.durationMs}`,
      );
    } catch (err) {
      console.error(
        `[clustering-scheduler] weekly error tenant=${tenantId}:`,
        err,
      );
    }
  }
}

class ClusteringScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastDailyRun: string | null = null;  // "YYYY-MM-DD"
  private lastWeeklyRun: string | null = null; // "YYYY-Wnn"

  start(): void {
    if (this.intervalId != null) return;

    console.log(
      `[clustering-scheduler] Started (daily@02:00, weekly@03:00 Sundays, tz=${TIMEZONE})`,
    );

    this.intervalId = setInterval(() => {
      void this.tick();
    }, TICK_MS);

    // Kör inte direkt vid uppstart (ger servern tid att stabilisera)
  }

  stop(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Manuell körning för alla tenanter (anropas av API-endpoint). */
  async runNow(tenantId: string, horizon?: number): Promise<void> {
    await runRollingAnalysis(tenantId, horizon);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const { hour, weekday } = getLocalParts(now);
    const dateKey = now.toISOString().slice(0, 10);
    const weekKey = `${now.getFullYear()}-W${formatIsoWeekNum(now)}`;

    // Daglig körning kl. 02:00 (en gång per dag)
    if (hour === 2 && this.lastDailyRun !== dateKey) {
      this.lastDailyRun = dateKey;
      await runDailyAnalysis();
    }

    // Veckovis körning kl. 03:00 söndagar (en gång per vecka)
    if (weekday === 0 && hour === 3 && this.lastWeeklyRun !== weekKey) {
      this.lastWeeklyRun = weekKey;
      await runWeeklyAnalysis();
    }
  }
}

function formatIsoWeekNum(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const n =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return String(n).padStart(2, "0");
}

export const clusteringScheduler = new ClusteringScheduler();
