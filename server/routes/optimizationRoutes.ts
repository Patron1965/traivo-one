import type { Express } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { ValidationError } from "../errors";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { notificationService } from "../notifications";
import {
  isServiceAvailable,
  callOptimizationService,
  convertORToolsToVRPResult,
  ASYNC_THRESHOLD,
  type OptimizationStop,
  type OptimizationVehicle,
  type OptimizationJobData,
} from "../services/optimizationQueue";
import {
  createOptimizationJob,
  getOptimizationJob,
} from "../optimization-job-runner";

const stopSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  time_window: z.tuple([z.number(), z.number()]).optional(),
  duration: z.number().default(1800),
  required_skills: z.array(z.string()).optional(),
  demand: z.number().default(1),
  priority: z.number().default(1),
});

const vehicleSchema = z.object({
  id: z.string(),
  capacity: z.number().default(100),
  skills: z.array(z.string()).optional(),
  home_lat: z.number(),
  home_lng: z.number(),
  start_time: z.number().default(28800),
  end_time: z.number().default(61200),
});

const submitJobSchema = z.object({
  stops: z.array(stopSchema).min(1),
  vehicles: z.array(vehicleSchema).min(1),
  maxSolveSeconds: z.number().min(1).max(300).optional(),
});

async function buildOptimizationPayload(
  date: string,
  tenantId: string,
): Promise<{ stops: OptimizationStop[]; vehicles: OptimizationVehicle[] }> {
  const [workOrders, resources, objects] = await Promise.all([
    storage.getWorkOrders(tenantId),
    storage.getResources(tenantId),
    storage.getObjects(tenantId),
  ]);

  const objectMap = new Map(objects.map(o => [o.id, o]));

  const filteredOrders = workOrders.filter(o => {
    if (!o.scheduledDate) return false;
    const orderDate = o.scheduledDate instanceof Date
      ? o.scheduledDate.toISOString().split("T")[0]
      : String(o.scheduledDate).split("T")[0];
    if (orderDate !== date) return false;
    if (o.orderStatus === "utford" || o.orderStatus === "fakturerad") return false;
    const obj = objectMap.get(o.objectId);
    return obj?.latitude && obj?.longitude;
  });

  const stops: OptimizationStop[] = filteredOrders.map(o => {
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
      required_skills: [],
      demand: 1,
      priority: o.priority === "hög" ? 3 : o.priority === "medel" ? 2 : 1,
    };
  });

  const vehicles: OptimizationVehicle[] = resources
    .filter(r => r.resourceType === "person" || r.resourceType === "vehicle" || !r.resourceType)
    .map(r => ({
      id: r.id,
      capacity: 100,
      skills: [],
      home_lat: r.homeLatitude || 59.33,
      home_lng: r.homeLongitude || 18.07,
      start_time: 28800,
      end_time: 61200,
    }));

  return { stops, vehicles };
}

export async function registerOptimizationRoutes(app: Express) {
  app.post("/api/optimization/jobs", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    let stops: OptimizationStop[];
    let vehicles: OptimizationVehicle[];

    if (req.body.date && !req.body.stops) {
      const payload = await buildOptimizationPayload(req.body.date, tenantId);
      stops = payload.stops;
      vehicles = payload.vehicles;
    } else {
      const parsed = submitJobSchema.parse(req.body);
      stops = parsed.stops;
      vehicles = parsed.vehicles;
    }

    if (stops.length === 0) {
      throw new ValidationError("Inga stopp med koordinater hittades för det valda datumet");
    }

    const serviceUp = await isServiceAvailable();

    if (serviceUp) {
      if (stops.length <= ASYNC_THRESHOLD) {
        const result = await callOptimizationService({ stops, vehicles, maxSolveSeconds: req.body.maxSolveSeconds });

        const stopMap = new Map(stops.map(s => [s.id, {
          title: s.id,
          lat: s.lat,
          lng: s.lng,
          durationMin: Math.round(s.duration / 60),
        }]));
        const vehicleMap = new Map(vehicles.map(v => [v.id, v.id]));
        const vrpResult = convertORToolsToVRPResult(result, stopMap, vehicleMap);

        res.json(vrpResult);
        return;
      }

      const jobId = await createOptimizationJob(tenantId, "ortools-vrp", {
        tenantId,
        date: req.body.date,
        clusterId: undefined,
        breakConfig: {},
        constraintOptions: {
          respectTimeWindows: true,
          respectSkills: true,
          respectCapacity: false,
          respectDependencies: true,
          tenantId,
        },
      });

      res.json({ jobId, status: "pending", orderCount: stops.length });
      return;
    }

    if (stops.length > ASYNC_THRESHOLD) {
      const jobId = await createOptimizationJob(tenantId, "vrp", {
        tenantId,
        date: req.body.date,
        clusterId: undefined,
        breakConfig: {},
        constraintOptions: {
          respectTimeWindows: true,
          respectSkills: true,
          respectCapacity: false,
          respectDependencies: true,
          tenantId,
        },
      });

      res.json({ jobId, status: "pending", orderCount: stops.length });
      return;
    }

    const { optimizeRoutesVRP, DEFAULT_BREAK_CONFIG } = await import("../route-optimizer");
    const [workOrders, resources, objects, clusters] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getObjects(tenantId),
      storage.getClusters(tenantId),
    ]);

    let filteredOrders = workOrders;
    if (req.body.date) {
      filteredOrders = filteredOrders.filter(o => {
        if (!o.scheduledDate) return false;
        const orderDate = o.scheduledDate instanceof Date
          ? o.scheduledDate.toISOString().split("T")[0]
          : String(o.scheduledDate).split("T")[0];
        return orderDate === req.body.date;
      });
    }
    filteredOrders = filteredOrders.filter(o =>
      o.orderStatus !== "utford" && o.orderStatus !== "fakturerad"
    );

    const result = await optimizeRoutesVRP(filteredOrders, resources, objects, clusters, DEFAULT_BREAK_CONFIG, {
      respectTimeWindows: true,
      respectSkills: true,
      respectCapacity: false,
      respectDependencies: true,
      tenantId,
    });

    res.json(result);
  }));

  app.get("/api/optimization/jobs/:id/status", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const job = await getOptimizationJob(req.params.id, tenantId);

    if (!job) {
      res.status(404).json({ error: "Jobb hittades inte" });
      return;
    }

    res.json({
      jobId: job.id,
      status: job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : job.status === "running" ? "processing" : "pending",
      progress: job.progress,
    });
  }));

  app.get("/api/optimization/jobs/:id/result", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const job = await getOptimizationJob(req.params.id, tenantId);

    if (!job) {
      res.status(404).json({ error: "Jobb hittades inte" });
      return;
    }

    if (job.status !== "completed") {
      res.status(400).json({ error: "Jobb inte klart", status: job.status });
      return;
    }

    notificationService.broadcastToAll({
      type: "route_optimized",
      title: "Ruttoptimering klar",
      message: "Ruttoptimering slutförd",
      data: { jobId: job.id },
    });

    res.json(job.result);
  }));

  app.post("/api/optimization/apply/:id", isAuthenticated, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const job = await getOptimizationJob(req.params.id, tenantId);

    if (!job) {
      res.status(404).json({ error: "Jobb hittades inte" });
      return;
    }

    if (job.status !== "completed" || !job.result) {
      res.status(400).json({ error: "Jobb har inget resultat att tillämpa" });
      return;
    }

    const result = job.result as unknown as {
      routes?: Array<{
        resourceId: string;
        stops: Array<{ orderId: string; sequence: number }>;
      }>;
    };

    if (!result.routes || !Array.isArray(result.routes)) {
      res.status(400).json({ error: "Ogiltigt resultatformat" });
      return;
    }

    let applied = 0;
    let failed = 0;

    for (const route of result.routes) {
      for (const stop of route.stops) {
        try {
          await storage.updateWorkOrder(stop.orderId, {
            resourceId: route.resourceId,
          });
          applied++;
        } catch {
          failed++;
        }
      }
    }

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Schema uppdaterat",
      message: `${applied} ordrar omfördelade efter optimering`,
      data: { jobId: job.id, applied, failed },
    });

    res.json({
      applied,
      failed,
      total: applied + failed,
      message: `${applied} ordrar uppdaterade med optimerad rutt`,
    });
  }));

  console.log("[optimization] Optimization routes registered");
}

export { buildOptimizationPayload };
