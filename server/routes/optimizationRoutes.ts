/**
 * Routes for async route-optimization via BullMQ + Python OR-Tools service.
 */

import type { Express } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { notificationService } from "../notifications";
import { db } from "../db";
import { workOrders } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  addOptimizationJob,
  getJobStatus,
  getJobResult,
  isQueueAvailable,
  type OptimizationJobData,
  type OptimizationStop,
  type OptimizationVehicle,
} from "../services/optimizationQueue";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const stopSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  time_window: z.tuple([z.number(), z.number()]).optional(),
  duration: z.number().optional(),
  required_skills: z.array(z.string()).optional(),
  demand: z.number().optional(),
  priority: z.number().optional(),
});

const vehicleSchema = z.object({
  id: z.string(),
  capacity: z.number().optional(),
  skills: z.array(z.string()).optional(),
  home_lat: z.number(),
  home_lng: z.number(),
  start_time: z.number().optional(),
  end_time: z.number().optional(),
});

const submitJobSchema = z.object({
  stops: z.array(stopSchema).min(1),
  vehicles: z.array(vehicleSchema).min(1),
  constraints: z
    .object({
      maxSolveSeconds: z.number().min(1).max(120).optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOptimizationRoutes(app: Express): void {
  /**
   * POST /api/optimization/jobs - Submit a new optimization job
   */
  app.post(
    "/api/optimization/jobs",
    asyncHandler(async (req, res) => {
      if (!isQueueAvailable()) {
        return res.status(503).json({
          error:
            "Optimization queue is unavailable. Ensure Redis is running.",
        });
      }

      const parsed = submitJobSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors.map((e) => e.message).join(", "),
        );
      }

      const { stops, vehicles, constraints } = parsed.data;
      const tenantId = getTenantIdWithFallback(req);

      const jobData: OptimizationJobData = {
        stops: stops as OptimizationStop[],
        vehicles: vehicles as OptimizationVehicle[],
        constraints: constraints ?? {},
        requestedBy: tenantId,
      };

      const jobId = await addOptimizationJob(jobData);

      res.status(202).json({ jobId, status: "pending" });
    }),
  );

  /**
   * GET /api/optimization/jobs/:id/status - Poll job status
   */
  app.get(
    "/api/optimization/jobs/:id/status",
    asyncHandler(async (req, res) => {
      const jobId = req.params.id;
      const status = await getJobStatus(jobId);
      res.json({ jobId, status });
    }),
  );

  /**
   * GET /api/optimization/jobs/:id/result - Get completed result
   */
  app.get(
    "/api/optimization/jobs/:id/result",
    asyncHandler(async (req, res) => {
      const jobId = req.params.id;
      const status = await getJobStatus(jobId);

      if (status !== "completed") {
        return res.status(200).json({ jobId, status, result: null });
      }

      const result = await getJobResult(jobId);

      // Emit WebSocket event so connected clients are notified
      try {
        notificationService.broadcastToAll({
          type: "route_optimized" as any,
          title: "Ruttoptimering klar",
          message: `Optimering ${jobId} är klar med ${result?.routes?.length ?? 0} rutter.`,
          data: { jobId, routeCount: result?.routes?.length ?? 0 },
        });
      } catch {
        // non-critical
      }

      res.json({ jobId, status: "completed", result });
    }),
  );

  /**
   * POST /api/optimization/apply/:id - Apply optimization result to DB
   */
  app.post(
    "/api/optimization/apply/:id",
    asyncHandler(async (req, res) => {
      const jobId = req.params.id;
      const result = await getJobResult(jobId);

      if (!result || !result.success) {
        return res.status(400).json({
          error: "No completed optimization result found for this job.",
        });
      }

      let appliedCount = 0;

      for (const route of result.routes) {
        for (const stop of route.stops) {
          try {
            // Convert arrival_time (seconds from midnight) to HH:MM format
            const hours = Math.floor(stop.arrival_time / 3600);
            const minutes = Math.floor((stop.arrival_time % 3600) / 60);
            const startTimeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

            await db
              .update(workOrders)
              .set({
                resourceId: route.vehicle_id,
                scheduledStartTime: startTimeStr,
              })
              .where(eq(workOrders.id, stop.stop_id));
            appliedCount++;
          } catch (err) {
            console.warn(
              `[optimization-apply] Could not update work order ${stop.stop_id}:`,
              err,
            );
          }
        }
      }

      // Broadcast update
      try {
        notificationService.broadcastToAll({
          type: "schedule_changed" as any,
          title: "Optimerade rutter tillämpade",
          message: `${appliedCount} arbetsordrar uppdaterade från optimering ${jobId}.`,
          data: { jobId, appliedCount },
        });
      } catch {
        // non-critical
      }

      res.json({
        success: true,
        appliedCount,
        totalRoutes: result.routes.length,
        totalStops: result.routes.reduce((s, r) => s + r.stops.length, 0),
      });
    }),
  );
}
