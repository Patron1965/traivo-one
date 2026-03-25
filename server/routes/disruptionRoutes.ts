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
      resourceName: z.string(),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const event = await triggerResourceUnavailable(tenantId, parsed.data.resourceId, parsed.data.resourceName, parsed.data.reason);
    res.json(event);
  }));

  app.post("/api/disruptions/trigger/emergency-job", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      workOrderId: z.string(),
      workOrderTitle: z.string(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const event = await triggerEmergencyJob(tenantId, parsed.data.workOrderId, parsed.data.workOrderTitle, parsed.data.latitude, parsed.data.longitude);
    res.json(event);
  }));

  app.post("/api/disruptions/trigger/delay", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      workOrderId: z.string(),
      workOrderTitle: z.string(),
      resourceId: z.string(),
      resourceName: z.string(),
      estimatedDuration: z.number(),
      actualDuration: z.number(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const event = await triggerSignificantDelay(
      tenantId, parsed.data.workOrderId, parsed.data.workOrderTitle,
      parsed.data.resourceId, parsed.data.resourceName,
      parsed.data.estimatedDuration, parsed.data.actualDuration
    );
    res.json(event || { message: "Förseningen understiger tröskelvärdet (50%)" });
  }));

  app.post("/api/disruptions/trigger/early-completion", asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      resourceId: z.string(),
      resourceName: z.string(),
      slackMinutes: z.number(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const event = await triggerEarlyCompletion(tenantId, parsed.data.resourceId, parsed.data.resourceName, parsed.data.slackMinutes);
    res.json(event || { message: "Ingen ledig tid eller inga närliggande jobb" });
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
