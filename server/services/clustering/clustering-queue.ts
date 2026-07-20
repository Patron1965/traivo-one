/**
 * Asynkron klustringsköa (in-memory, v1).
 *
 * Pooler inkommande analysbegäranden och batchar dem var 30:e sekund.
 * Deduplicerar: flera ändringar på samma uppgift → EN analys per batch.
 * Loggar klustringsresultat till `task_events` (append-only, same pattern as
 * logWorkOrderTransition). Best-effort — en loggmiss blockerar aldrig affärsoperationen.
 */
import { db } from "../../db";
import { taskEvents } from "@shared/schema";
import { processTask } from "./stop-clustering-engine";
import { processRouteTask } from "./route-clustering-engine";

interface ClusteringJob {
  taskId: string;
  taskTable: "work_orders" | "assignments";
  tenantId: string;
}

async function logClusterEvent(
  tenantId: string,
  workOrderId: string,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(taskEvents).values({
      tenantId,
      workOrderId,
      eventType,
      actorType: "system",
      actorId: null,
      detail,
      occurredAt: new Date(),
    });
  } catch (err) {
    console.error(
      `[clustering-queue] task_events write failed for ${workOrderId}:`,
      err,
    );
  }
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
          const result = await processTask(job.taskId, job.tenantId);

          // Logga till task_events vid faktisk klumptilldelning/borttagning
          if (result.action === "assigned" || result.action === "created") {
            await logClusterEvent(
              job.tenantId,
              job.taskId,
              "stop_cluster_assigned",
              {
                clusterId: result.clusterId,
                action: result.action,
                source: "clustering_queue",
              },
            );
          } else if (result.action === "removed") {
            await logClusterEvent(
              job.tenantId,
              job.taskId,
              "stop_cluster_removed",
              {
                action: result.action,
                source: "clustering_queue",
              },
            );
          }
        }
        // Ruttklumpning: inkrementell near-term-tilldelning för work_orders
        if (job.taskTable === "work_orders") {
          const routeResult = await processRouteTask(job.taskId, job.tenantId);
          if (routeResult.action === "assigned") {
            await logClusterEvent(
              job.tenantId,
              job.taskId,
              "route_cluster_assigned",
              {
                clusterId: routeResult.clusterId,
                action: routeResult.action,
                source: "clustering_queue",
              },
            );
          } else if (routeResult.action === "removed") {
            await logClusterEvent(
              job.tenantId,
              job.taskId,
              "route_cluster_removed",
              {
                action: routeResult.action,
                source: "clustering_queue",
              },
            );
          }
        }
        // assignments: P3
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
