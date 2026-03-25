import type { Express, Request, Response } from "express";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { z } from "zod";
import { formatZodError } from "./helpers";
import {
  getActiveDisruptions,
  getAllDisruptions,
  resolveDisruption,
  dismissDisruption,
  triggerResourceUnavailable,
  triggerEmergencyJob,
  triggerSignificantDelay,
  triggerEarlyCompletion,
  applySuggestion,
} from "../disruption-service";

export function registerDisruptionRoutes(app: Express) {

  app.get("/api/disruptions", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const includeResolved = req.query.includeResolved === "true";
    const events = includeResolved ? getAllDisruptions(tenantId) : getActiveDisruptions(tenantId);
    res.json(events);
  }));

  app.post("/api/disruptions/trigger/resource-unavailable", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      resourceId: z.string(),
      resourceName: z.string().optional(),
      reason: z.string().optional(),
      type: z.string().optional(),
      message: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const reason = parsed.data.reason || parsed.data.type || parsed.data.message || undefined;
    let resourceName = parsed.data.resourceName || "";
    if (!resourceName) {
      const { storage } = await import("../storage");
      const resource = await storage.getResource(parsed.data.resourceId);
      resourceName = resource?.name || parsed.data.resourceId;
    }

    const event = await triggerResourceUnavailable(tenantId, parsed.data.resourceId, resourceName, reason);
    res.json({ success: true, disruptionId: event?.id || null, acknowledged: true, event });
  }));

  app.post("/api/disruptions/trigger/emergency-job", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      workOrderId: z.string().optional(),
      orderId: z.string().optional(),
      workOrderTitle: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const woId = parsed.data.workOrderId || parsed.data.orderId || "";
    const event = await triggerEmergencyJob(tenantId, woId, parsed.data.workOrderTitle || woId, parsed.data.latitude, parsed.data.longitude);
    res.json({ success: true, disruptionId: event?.id || null, acknowledged: true, event });
  }));

  app.post("/api/disruptions/trigger/delay", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      workOrderId: z.string().optional(),
      orderId: z.string().optional(),
      workOrderTitle: z.string().optional(),
      resourceId: z.string().optional(),
      resourceName: z.string().optional(),
      estimatedDuration: z.number(),
      actualDuration: z.number().optional(),
      actualElapsed: z.number().optional(),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const woId = parsed.data.workOrderId || parsed.data.orderId || "";
    const actual = parsed.data.actualDuration || parsed.data.actualElapsed || 0;
    let resourceId = parsed.data.resourceId || "";
    let resourceName = parsed.data.resourceName || "";
    let woTitle = parsed.data.workOrderTitle || woId;

    if (woId && (!resourceId || !resourceName || !woTitle || woTitle === woId)) {
      const { storage } = await import("../storage");
      const order = await storage.getWorkOrder(woId);
      if (order) {
        resourceId = resourceId || order.resourceId || "";
        woTitle = order.title || woId;
        if (!resourceName && resourceId) {
          const resource = await storage.getResource(resourceId);
          resourceName = resource?.name || resourceId;
        }
      }
    }

    const event = await triggerSignificantDelay(
      tenantId, woId, woTitle,
      resourceId, resourceName,
      parsed.data.estimatedDuration, actual
    );
    if (!event) {
      res.json({ success: true, disruptionId: null, acknowledged: true, message: "Förseningen understiger tröskelvärdet (50%)" });
    } else {
      res.json({ success: true, disruptionId: event.id, acknowledged: true, event });
    }
  }));

  app.post("/api/disruptions/trigger/early-completion", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      resourceId: z.string(),
      resourceName: z.string().optional(),
      slackMinutes: z.number().optional(),
      remainingMinutes: z.number().optional(),
      completedOrders: z.number().optional(),
      totalOrders: z.number().optional(),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const slack = parsed.data.slackMinutes || parsed.data.remainingMinutes || 0;
    let resourceName = parsed.data.resourceName || "";
    if (!resourceName) {
      const { storage } = await import("../storage");
      const resource = await storage.getResource(parsed.data.resourceId);
      resourceName = resource?.name || parsed.data.resourceId;
    }

    const event = await triggerEarlyCompletion(tenantId, parsed.data.resourceId, resourceName, slack);
    if (!event) {
      res.json({ success: true, disruptionId: null, acknowledged: true, message: "Ingen ledig tid eller inga närliggande jobb" });
    } else {
      res.json({ success: true, disruptionId: event.id, acknowledged: true, event });
    }
  }));

  app.post("/api/disruptions/:id/apply/:suggestionId", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await applySuggestion(tenantId, req.params.id, req.params.suggestionId);
    res.json(result);
  }));

  app.post("/api/disruptions/:id/dismiss", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const success = dismissDisruption(tenantId, req.params.id);
    res.json({ success });
  }));

  app.post("/api/disruptions/:id/resolve", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const success = resolveDisruption(tenantId, req.params.id);
    res.json({ success });
  }));
}
