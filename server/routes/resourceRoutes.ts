import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { insertResourceSchema } from "@shared/schema";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";

export async function registerResourceRoutes(app: Express) {

app.get("/api/resources", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const page = parseInt(req.query.page as string);
  const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  if (page > 0 && limit > 0) {
    const offset = (page - 1) * limit;
    const result = await storage.getResourcesPaginated(tenantId, limit, offset, search);
    return res.json({ data: result.resources, total: result.total, page, limit });
  }
  const resources = await storage.getResources(tenantId);
  res.json(resources);
}));

app.get("/api/resources/active-positions", asyncHandler(async (_req, res) => {
  const resources = await storage.getActiveResourcePositions();
  res.json(resources.map(r => ({
    id: r.id,
    name: r.name,
    latitude: r.currentLatitude,
    longitude: r.currentLongitude,
    status: r.trackingStatus,
    lastUpdate: r.lastPositionUpdate
  })));
}));

app.get("/api/resources/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const resource = await storage.getResource(req.params.id);
  const verified = verifyTenantOwnership(resource, tenantId);
  if (!verified) throw new NotFoundError("Resurs");
  res.json(verified);
}));

app.post("/api/resources", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertResourceSchema.parse({ ...req.body, tenantId });
  const resource = await storage.createResource(data);
  res.status(201).json(resource);
}));

app.patch("/api/resources/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getResource(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Resurs");
  }
  const updateSchema = insertResourceSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as Record<string, unknown>;
  const resource = await storage.updateResource(req.params.id, updateData);
  if (!resource) throw new NotFoundError("Resurs");
  res.json(resource);
}));

app.delete("/api/resources/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getResource(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Resurs");
  }
  await storage.deleteResource(req.params.id);
  res.status(204).send();
}));

}
