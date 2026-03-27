import { db } from "./db";
import { optimizationJobs } from "@shared/schema";
import { eq, and, lt, inArray } from "drizzle-orm";
import type { VRPOptimizationResult } from "./route-optimizer";
import type { VRPConstraintOptions } from "./vrp-constraints";
import type { BreakConfig } from "./route-optimizer";

const MAX_ATTEMPTS = 2;
const JOB_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const ASYNC_THRESHOLD = 30;

export { ASYNC_THRESHOLD };

interface VRPJobInput {
  tenantId: string;
  date?: string;
  clusterId?: string;
  breakConfig: BreakConfig | Record<string, unknown>;
  constraintOptions: VRPConstraintOptions;
}

let isProcessing = false;

export async function createOptimizationJob(
  tenantId: string,
  type: string,
  input: VRPJobInput,
): Promise<string> {
  const [job] = await db.insert(optimizationJobs).values({
    tenantId,
    type,
    status: "queued",
    input: input as Record<string, unknown>,
    progress: 0,
    attempts: 0,
  }).returning();

  scheduleProcessing();
  return job.id;
}

export async function getOptimizationJob(jobId: string, tenantId: string) {
  const [job] = await db.select().from(optimizationJobs)
    .where(and(eq(optimizationJobs.id, jobId), eq(optimizationJobs.tenantId, tenantId)))
    .limit(1);
  return job ?? null;
}

export function scheduleProcessing() {
  if (isProcessing) return;
  setImmediate(() => processNextJob());
}

async function processNextJob() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const [job] = await db.select().from(optimizationJobs)
      .where(eq(optimizationJobs.status, "queued"))
      .orderBy(optimizationJobs.createdAt)
      .limit(1);

    if (!job) {
      isProcessing = false;
      return;
    }

    await db.update(optimizationJobs)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: job.attempts + 1,
        progress: 5,
      })
      .where(eq(optimizationJobs.id, job.id));

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Job timeout exceeded (5 min)")), JOB_TIMEOUT_MS)
    );

    try {
      const executeFunc = job.type === "ortools-vrp" ? executeORToolsJob : executeVRPJob;
      const result = await Promise.race([
        executeFunc(job.id, job.input as unknown as VRPJobInput),
        timeoutPromise,
      ]);

      await db.update(optimizationJobs)
        .set({
          status: "completed",
          result: result as unknown as Record<string, unknown>,
          progress: 100,
          completedAt: new Date(),
        })
        .where(eq(optimizationJobs.id, job.id));

      broadcastJobComplete(job.tenantId, job.id, result);
      console.log(`[optimization-job] Job ${job.id} completed successfully`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newAttempts = job.attempts + 1;

      if (newAttempts < MAX_ATTEMPTS) {
        await db.update(optimizationJobs)
          .set({
            status: "queued",
            error: errorMsg,
            progress: 0,
          })
          .where(eq(optimizationJobs.id, job.id));
        console.warn(`[optimization-job] Job ${job.id} failed (attempt ${newAttempts}/${MAX_ATTEMPTS}), retrying: ${errorMsg}`);
      } else {
        await db.update(optimizationJobs)
          .set({
            status: "failed",
            error: errorMsg,
            completedAt: new Date(),
          })
          .where(eq(optimizationJobs.id, job.id));
        broadcastJobFailed(job.tenantId, job.id, errorMsg);
        console.error(`[optimization-job] Job ${job.id} failed permanently: ${errorMsg}`);
      }
    }
  } catch (err) {
    console.error("[optimization-job] Job processing error:", err);
  } finally {
    isProcessing = false;
    const [next] = await db.select({ id: optimizationJobs.id }).from(optimizationJobs)
      .where(eq(optimizationJobs.status, "queued"))
      .limit(1);
    if (next) {
      setImmediate(() => processNextJob());
    }
  }
}

async function executeORToolsJob(jobId: string, input: VRPJobInput): Promise<VRPOptimizationResult> {
  const { isServiceAvailable, callOptimizationService, convertORToolsToVRPResult } = await import("./services/optimizationQueue");
  const { storage } = await import("./storage");

  const tenantId = input.tenantId;
  await updateProgress(jobId, 10);

  const [workOrders, resources, objects] = await Promise.all([
    storage.getWorkOrders(tenantId),
    storage.getResources(tenantId),
    storage.getObjects(tenantId),
  ]);

  await updateProgress(jobId, 20);

  const objectMap = new Map(objects.map(o => [o.id, o]));

  let filteredOrders = workOrders.filter(o =>
    o.orderStatus !== "utford" && o.orderStatus !== "fakturerad"
  );
  if (input.date) {
    filteredOrders = filteredOrders.filter(o => {
      if (!o.scheduledDate) return false;
      const orderDate = o.scheduledDate instanceof Date
        ? o.scheduledDate.toISOString().split("T")[0]
        : String(o.scheduledDate).split("T")[0];
      return orderDate === input.date;
    });
  }

  const stops = filteredOrders
    .filter(o => {
      const obj = objectMap.get(o.objectId);
      return obj?.latitude && obj?.longitude;
    })
    .map(o => {
      const obj = objectMap.get(o.objectId)!;
      const durationSec = (o.estimatedDuration || 30) * 60;
      let timeWindow: [number, number] | undefined;
      if (o.scheduledStartTime) {
        const match = String(o.scheduledStartTime).match(/^(\d{1,2}):(\d{2})/);
        if (match) {
          const startSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60;
          timeWindow = [startSec, Math.min(startSec + 7200, 61200)];
        }
      }
      return {
        id: o.id,
        lat: obj.latitude!,
        lng: obj.longitude!,
        time_window: timeWindow,
        duration: durationSec,
        required_skills: [] as string[],
        demand: 1,
        priority: o.priority === "hög" ? 3 : o.priority === "medel" ? 2 : 1,
      };
    });

  const vehicles = resources
    .filter(r => r.resourceType === "person" || r.resourceType === "vehicle" || !r.resourceType)
    .map(r => ({
      id: r.id,
      capacity: 100,
      skills: [] as string[],
      home_lat: r.homeLatitude || 59.33,
      home_lng: r.homeLongitude || 18.07,
      start_time: 28800,
      end_time: 61200,
    }));

  await updateProgress(jobId, 40);

  const serviceUp = await isServiceAvailable();
  if (!serviceUp) {
    console.log(`[optimization-job] OR-Tools service unavailable for job ${jobId}, falling back to Geoapify VRP`);
    return executeVRPJob(jobId, input);
  }

  await updateProgress(jobId, 50);

  const orResult = await callOptimizationService({
    stops,
    vehicles,
    maxSolveSeconds: 60,
  });

  await updateProgress(jobId, 90);

  const stopMap = new Map(stops.map(s => {
    const order = filteredOrders.find(o => o.id === s.id);
    return [s.id, {
      title: order?.orderTitle || s.id,
      lat: s.lat,
      lng: s.lng,
      durationMin: Math.round(s.duration / 60),
    }];
  }));
  const vehicleMap = new Map(resources.map(r => [r.id, r.name]));

  return convertORToolsToVRPResult(orResult, stopMap, vehicleMap);
}

async function executeVRPJob(jobId: string, input: VRPJobInput): Promise<VRPOptimizationResult> {
  const { storage } = await import("./storage");
  const { optimizeRoutesVRP, DEFAULT_BREAK_CONFIG } = await import("./route-optimizer");

  const tenantId = input.tenantId;

  await updateProgress(jobId, 10);

  const [workOrders, resources, objects, clusters] = await Promise.all([
    storage.getWorkOrders(tenantId),
    storage.getResources(tenantId),
    storage.getObjects(tenantId),
    storage.getClusters(tenantId),
  ]);

  await updateProgress(jobId, 25);

  let filteredOrders = workOrders;

  if (input.date) {
    filteredOrders = filteredOrders.filter(o => {
      if (!o.scheduledDate) return false;
      const orderDate = o.scheduledDate instanceof Date
        ? o.scheduledDate.toISOString().split("T")[0]
        : String(o.scheduledDate).split("T")[0];
      return orderDate === input.date;
    });
  }

  if (input.clusterId) {
    filteredOrders = filteredOrders.filter(o => o.clusterId === input.clusterId);
  }

  filteredOrders = filteredOrders.filter(o =>
    o.orderStatus !== "utford" && o.orderStatus !== "fakturerad"
  );

  await updateProgress(jobId, 40);

  const breakConfig = (input.breakConfig ?? DEFAULT_BREAK_CONFIG) as BreakConfig;

  const result = await optimizeRoutesVRP(
    filteredOrders,
    resources,
    objects,
    clusters,
    breakConfig,
    input.constraintOptions,
  );

  await updateProgress(jobId, 90);
  return result;
}

async function updateProgress(jobId: string, progress: number) {
  try {
    await db.update(optimizationJobs)
      .set({ progress })
      .where(eq(optimizationJobs.id, jobId));
  } catch (err) {
    console.warn("[optimization-job] Progress update failed:", err instanceof Error ? err.message : err);
  }
}

function broadcastJobComplete(_tenantId: string, jobId: string, _result: VRPOptimizationResult) {
  import("./notifications").then(({ notificationService }) => {
    notificationService.broadcastToAll({
      type: "optimization_complete",
      title: "Ruttoptimering klar",
      message: "Ruttoptimering slutförd. Hämta resultat via jobbstatus.",
      data: { jobId },
    });
  }).catch(err => {
    console.warn("[optimization-job] WebSocket broadcast failed:", err instanceof Error ? err.message : err);
  });
}

function broadcastJobFailed(_tenantId: string, jobId: string, _error: string) {
  import("./notifications").then(({ notificationService }) => {
    notificationService.broadcastToAll({
      type: "optimization_failed",
      title: "Ruttoptimering misslyckades",
      message: "Ruttoptimering kunde inte slutföras. Kontrollera jobbstatus.",
      data: { jobId },
    });
  }).catch(err => {
    console.warn("[optimization-job] WebSocket broadcast failed:", err instanceof Error ? err.message : err);
  });
}

export async function cleanupOldJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - JOB_RETENTION_MS);
  try {
    const old = await db.select({ id: optimizationJobs.id }).from(optimizationJobs)
      .where(lt(optimizationJobs.createdAt, cutoff));
    if (old.length === 0) return 0;
    await db.delete(optimizationJobs)
      .where(inArray(optimizationJobs.id, old.map(j => j.id)));
    console.log(`[optimization-job] Cleaned up ${old.length} old jobs`);
    return old.length;
  } catch (err) {
    console.warn("[optimization-job] Cleanup error:", err instanceof Error ? err.message : err);
    return 0;
  }
}

export function startJobCleanupScheduler() {
  cleanupOldJobs();
  setInterval(() => cleanupOldJobs(), CLEANUP_INTERVAL_MS);
  console.log("[optimization-job] Scheduled job cleanup every 6 hours");
}

export async function resetStaleJobs(): Promise<number> {
  try {
    const fiveMinAgo = new Date(Date.now() - JOB_TIMEOUT_MS);
    const result = await db.update(optimizationJobs)
      .set({ status: "failed", error: "Job timed out (stale running state)", completedAt: new Date() })
      .where(and(
        eq(optimizationJobs.status, "running"),
        lt(optimizationJobs.startedAt, fiveMinAgo),
      ))
      .returning();
    if (result.length > 0) {
      console.log(`[optimization-job] Reset ${result.length} stale running jobs`);
    }
    return result.length;
  } catch (err) {
    console.warn("[optimization-job] Stale job reset error:", err instanceof Error ? err.message : err);
    return 0;
  }
}
