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
  const { enrichVRPRequestWithConstraints } = await import("./vrp-constraints");
  const { storage } = await import("./storage");

  const tenantId = input.tenantId;
  await updateProgress(jobId, 10);

  const [workOrders, resources, objects, clusters] = await Promise.all([
    storage.getWorkOrders(tenantId),
    storage.getResources(tenantId),
    storage.getObjects(tenantId),
    storage.getClusters(tenantId),
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
  if (input.clusterId) {
    filteredOrders = filteredOrders.filter(o => o.clusterId === input.clusterId);
  }

  const validOrders = filteredOrders.filter(o => {
    const obj = objectMap.get(o.objectId);
    return obj?.latitude && obj?.longitude;
  });

  await updateProgress(jobId, 30);

  const baseJobs = validOrders.map(o => {
    const obj = objectMap.get(o.objectId)!;
    const durationSec = (o.estimatedDuration || 30) * 60;
    return {
      location: [obj.longitude!, obj.latitude!] as [number, number],
      duration: durationSec,
      priority: o.priority === "hög" ? 80 : o.priority === "medel" ? 50 : 30,
      id: o.id,
      description: o.orderTitle || o.id,
    };
  });

  const baseAgents = resources
    .filter(r => r.resourceType === "person" || r.resourceType === "vehicle" || !r.resourceType)
    .map(r => ({
      start_location: [r.homeLongitude || 18.07, r.homeLatitude || 59.33] as [number, number],
      end_location: [r.homeLongitude || 18.07, r.homeLatitude || 59.33] as [number, number],
      time_windows: [[28800, 61200]] as [number, number][],
      id: r.id,
      description: r.name,
    }));

  await updateProgress(jobId, 40);

  const constraintResult = await enrichVRPRequestWithConstraints(
    baseJobs,
    baseAgents,
    validOrders,
    resources,
    objects,
    input.constraintOptions,
  );

  await updateProgress(jobId, 50);

  const stops = constraintResult.jobs.map(j => {
    const tw = j.time_windows && j.time_windows.length > 0
      ? j.time_windows[0] as [number, number]
      : undefined;
    return {
      id: j.id,
      lat: j.location[1],
      lng: j.location[0],
      time_window: tw,
      duration: j.duration,
      required_skills: j.required_skills?.map(String) || [],
      demand: j.pickup && j.pickup.length > 0 ? j.pickup[0] : 1,
      priority: j.priority,
    };
  });

  const vehicles = constraintResult.agents.map(a => ({
    id: a.id || "unknown",
    capacity: a.capacity && a.capacity.length > 0 ? a.capacity[0] : 100,
    skills: a.skills?.map(String) || [],
    home_lat: a.start_location[1],
    home_lng: a.start_location[0],
    start_time: a.time_windows && a.time_windows.length > 0 ? a.time_windows[0][0] : 28800,
    end_time: a.time_windows && a.time_windows.length > 0 ? a.time_windows[0][1] : 61200,
  }));

  await updateProgress(jobId, 55);

  const serviceUp = await isServiceAvailable();
  if (!serviceUp) {
    console.log(`[optimization-job] OR-Tools service unavailable for job ${jobId}, falling back to Geoapify VRP`);
    return executeVRPJob(jobId, input);
  }

  await updateProgress(jobId, 60);

  const { computeORToolsMatrix } = await import("./distance-matrix-service");
  const allLocations = [
    ...vehicles.map(v => ({ lat: v.home_lat, lng: v.home_lng })),
    ...stops.map(s => ({ lat: s.lat, lng: s.lng })),
  ];
  const distanceMatrix = await computeORToolsMatrix(allLocations) ?? undefined;

  await updateProgress(jobId, 75);

  const orResult = await callOptimizationService({
    stops,
    vehicles,
    maxSolveSeconds: 60,
    distanceMatrix,
  });

  await updateProgress(jobId, 90);

  const stopMap = new Map(stops.map(s => {
    const order = validOrders.find(o => o.id === s.id);
    return [s.id, {
      title: order?.orderTitle || s.id,
      lat: s.lat,
      lng: s.lng,
      durationMin: Math.round(s.duration / 60),
    }];
  }));
  const vehicleMap = new Map(resources.map(r => [r.id, r.name]));

  const vrpResult = convertORToolsToVRPResult(orResult, stopMap, vehicleMap);
  vrpResult.constraintsApplied = [
    ...constraintResult.constraintsApplied.map(c => `OR-Tools + ${c}`),
  ];
  if (constraintResult.dependencySequences.length > 0) {
    vrpResult.constraintsApplied.push(`${constraintResult.dependencySequences.length} beroenden`);
  }

  return vrpResult;
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

function broadcastJobComplete(tenantId: string, jobId: string, _result: VRPOptimizationResult) {
  import("./notifications").then(({ notificationService }) => {
    notificationService.broadcastToAll({
      type: "optimization_complete",
      title: "Ruttoptimering klar",
      message: "Ruttoptimering slutförd. Hämta resultat via jobbstatus.",
      data: { jobId },
    }, tenantId);
  }).catch(err => {
    console.warn("[optimization-job] WebSocket broadcast failed:", err instanceof Error ? err.message : err);
  });
}

function broadcastJobFailed(tenantId: string, jobId: string, _error: string) {
  import("./notifications").then(({ notificationService }) => {
    notificationService.broadcastToAll({
      type: "optimization_failed",
      title: "Ruttoptimering misslyckades",
      message: "Ruttoptimering kunde inte slutföras. Kontrollera jobbstatus.",
      data: { jobId },
    }, tenantId);
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
