/**
 * Asynkron klustringsköa (in-memory, v1).
 *
 * Poolar inkommande analysbegäranden och batchar dem var 30:e sekund.
 * Deduplicerar: flera ändringar på samma uppgift → EN analys per batch.
 * Loggar till konsolen (task_events-integration kan byggas P3).
 */
import { processTask } from "./stop-clustering-engine";

interface ClusteringJob {
  taskId: string;
  taskTable: "work_orders" | "assignments";
  tenantId: string;
}

class ClusteringQueue {
  private queue = new Map<string, ClusteringJob>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchIntervalMs: number;

  constructor(batchIntervalMs = 30_000) {
    this.batchIntervalMs = batchIntervalMs;
  }

  /** Ställer en analysbegäran i kön. Deduplicerar per taskId+taskTable. */
  enqueue(job: ClusteringJob): void {
    const key = `${job.taskId}:${job.taskTable}`;
    this.queue.set(key, job);
    if (this.timer == null) {
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.batchIntervalMs);
    }
  }

  /** Kör alla köade jobb nu (anropas av test eller manuellt). */
  async flush(): Promise<void> {
    this.timer = null;
    if (this.queue.size === 0) return;

    const jobs = Array.from(this.queue.values());
    this.queue.clear();

    console.log(`[clustering-queue] Processing ${jobs.length} jobs`);

    for (const job of jobs) {
      try {
        if (job.taskTable === "work_orders") {
          await processTask(job.taskId, job.tenantId);
        }
        // assignments: P3 (stöds via routeclustering)
      } catch (err) {
        console.error(
          `[clustering-queue] Error processing task ${job.taskId}:`,
          err,
        );
      }
    }

    console.log(`[clustering-queue] Batch complete`);
  }

  /** Stoppar timern (för test / clean shutdown). */
  stop(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get pendingCount(): number {
    return this.queue.size;
  }
}

export const clusteringQueue = new ClusteringQueue();
