/**
 * BullMQ-based async route-optimization queue.
 *
 * Jobs are submitted, processed by a worker that calls the Python OR-Tools
 * micro-service, and the result is stored back on the job for later retrieval.
 */

import { Queue, Worker, Job } from "bullmq";
import type { RedisOptions } from "ioredis";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimizationStop {
  id: string;
  lat: number;
  lng: number;
  time_window?: [number, number];
  duration?: number;
  required_skills?: string[];
  demand?: number;
  priority?: number;
}

export interface OptimizationVehicle {
  id: string;
  capacity?: number;
  skills?: string[];
  home_lat: number;
  home_lng: number;
  start_time?: number;
  end_time?: number;
}

export interface OptimizationConstraints {
  maxSolveSeconds?: number;
}

export interface OptimizationJobData {
  stops: OptimizationStop[];
  vehicles: OptimizationVehicle[];
  constraints: OptimizationConstraints;
  requestedBy: string;
}

export type OptimizationJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface OptimizationJobResult {
  success: boolean;
  routes: Array<{
    vehicle_id: string;
    stops: Array<{
      stop_id: string;
      sequence: number;
      arrival_time: number;
      departure_time: number;
      waiting_time: number;
    }>;
    total_distance_km: number;
    total_duration_seconds: number;
  }>;
  unassigned_stop_ids: string[];
  solve_time_ms: number;
  cluster_info?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Redis connection helper
// ---------------------------------------------------------------------------

const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const OPTIMIZATION_SERVICE_URL =
  process.env.OPTIMIZATION_SERVICE_URL || "http://127.0.0.1:8090";

const redisConnection: RedisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: null, // required by BullMQ
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

const QUEUE_NAME = "route-optimization";

let queue: Queue<OptimizationJobData, OptimizationJobResult> | null = null;
let worker: Worker<OptimizationJobData, OptimizationJobResult> | null = null;
let queueAvailable = false;

function getQueue(): Queue<OptimizationJobData, OptimizationJobResult> {
  if (!queue) {
    queue = new Queue<OptimizationJobData, OptimizationJobResult>(QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { age: 3600 * 24 }, // keep 24 h
        removeOnFail: { age: 3600 * 48 },
      },
    });
    queueAvailable = true;
  }
  return queue;
}

// ---------------------------------------------------------------------------
// Worker – calls the Python OR-Tools service
// ---------------------------------------------------------------------------

async function processOptimizationJob(
  job: Job<OptimizationJobData, OptimizationJobResult>,
): Promise<OptimizationJobResult> {
  const { stops, vehicles, constraints } = job.data;

  await job.updateProgress(10);

  const payload = {
    stops: stops.map((s) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      time_window: s.time_window ?? null,
      duration: s.duration ?? 1800,
      required_skills: s.required_skills ?? [],
      demand: s.demand ?? 1,
      priority: s.priority ?? 50,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      capacity: v.capacity ?? 20,
      skills: v.skills ?? [],
      home_lat: v.home_lat,
      home_lng: v.home_lng,
      start_time: v.start_time ?? 28800,
      end_time: v.end_time ?? 61200,
    })),
    max_solve_seconds: constraints.maxSolveSeconds ?? 30,
  };

  await job.updateProgress(20);

  const response = await fetch(`${OPTIMIZATION_SERVICE_URL}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Optimization service error ${response.status}: ${errorText}`,
    );
  }

  await job.updateProgress(90);

  const result: OptimizationJobResult = await response.json();

  await job.updateProgress(100);

  return result;
}

export function startOptimizationWorker(): void {
  if (worker) return;
  try {
    worker = new Worker<OptimizationJobData, OptimizationJobResult>(
      QUEUE_NAME,
      processOptimizationJob,
      {
        connection: redisConnection,
        concurrency: 2,
      },
    );

    worker.on("completed", (job) => {
      console.log(
        `[optimization-queue] Job ${job.id} completed in ${job.data.stops.length} stops`,
      );
    });

    worker.on("failed", (job, err) => {
      console.error(
        `[optimization-queue] Job ${job?.id} failed:`,
        err.message,
      );
    });

    console.log("[optimization-queue] Worker started");
  } catch (err) {
    console.warn(
      "[optimization-queue] Could not start worker (Redis may be unavailable):",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function addOptimizationJob(
  data: OptimizationJobData,
): Promise<string> {
  const q = getQueue();
  const job = await q.add("optimize", data);
  return job.id!;
}

export async function getJobStatus(
  jobId: string,
): Promise<OptimizationJobStatus> {
  const q = getQueue();
  const job = await q.getJob(jobId);
  if (!job) return "pending";

  const state = await job.getState();
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "active":
      return "processing";
    default:
      return "pending";
  }
}

export async function getJobResult(
  jobId: string,
): Promise<OptimizationJobResult | null> {
  const q = getQueue();
  const job = await q.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  if (state === "completed") {
    return job.returnvalue;
  }
  return null;
}

export function isQueueAvailable(): boolean {
  return queueAvailable;
}
