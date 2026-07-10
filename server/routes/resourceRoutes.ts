import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { and, eq, isNull } from "drizzle-orm";
import { objects, resources } from "@shared/schema";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
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

// Task #991: Enhetlig läsmodell för utförarregistret (personer + fordon/utrustning + team).
app.get("/api/executor-register", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const register = await storage.getExecutorRegister(tenantId);
  res.json(register);
}));

app.get("/api/resources/active-positions", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const resources = await storage.getActiveResourcePositions(tenantId);
  res.json(resources.map(r => ({
    id: r.id,
    name: r.name,
    latitude: r.currentLatitude,
    longitude: r.currentLongitude,
    status: r.trackingStatus,
    lastUpdate: r.lastPositionUpdate
  })));
}));

app.get("/api/resources/zones", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);

  const allObjects = await db.select({
    id: objects.id,
    latitude: objects.latitude,
    longitude: objects.longitude,
    postalCode: objects.postalCode,
  }).from(objects).where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));

  const computeConvexHull = (points: [number, number][]): [number, number][] => {
    if (points.length < 3) return points;
    const sorted = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
      (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
    const lower: [number, number][] = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: [number, number][] = [];
    for (const p of [...sorted].reverse()) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  };

  const allResources = await db.select({
    id: resources.id,
    name: resources.name,
    serviceArea: resources.serviceArea,
    status: resources.status,
  }).from(resources).where(and(eq(resources.tenantId, tenantId), isNull(resources.deletedAt)));

  const RESOURCE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

  const resourceZones = allResources
    .filter(r => r.status === "active" && r.serviceArea && r.serviceArea.length > 0)
    .map((resource, idx) => {
      const normalizedAreas = resource.serviceArea!.map(pc => pc.replace(/\s/g, ""));
      const areaObjects = allObjects.filter(obj => {
        if (!obj.latitude || !obj.longitude || !obj.postalCode) return false;
        const objPC = obj.postalCode.replace(/\s/g, "");
        return normalizedAreas.some(area => objPC === area || objPC.startsWith(area));
      });
      const coords = areaObjects.map(o => [o.latitude!, o.longitude!] as [number, number]);
      const hull = computeConvexHull(coords);
      return {
        id: resource.id,
        name: resource.name,
        color: RESOURCE_COLORS[idx % RESOURCE_COLORS.length],
        serviceArea: resource.serviceArea,
        objectCount: areaObjects.length,
        polygon: hull.length >= 3 ? hull : null,
        center: coords.length > 0
          ? [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length]
          : null,
      };
    })
    .filter(z => z.polygon || z.center);

  res.json({ resourceZones });
}));

app.get("/api/resources/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const resource = await storage.getResource(req.params.id);
  const verified = verifyTenantOwnership(resource, tenantId);
  if (!verified) throw new NotFoundError("Resurs");
  res.json(verified);
}));

app.get("/api/resources/:id/sms-history", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const resource = await storage.getResource(req.params.id);
  if (!verifyTenantOwnership(resource, tenantId)) {
    throw new NotFoundError("Resurs");
  }
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const SCHEDULE_HISTORY_TYPES = [
    "schedule_published",
    "schedule_send_failed",
    "extra_job_sms",
    "cancel_job_sms",
  ];
  const history = await storage.listDriverNotificationsByResource(req.params.id, tenantId, {
    types: SCHEDULE_HISTORY_TYPES,
    limit,
  });
  res.json(history);
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

app.delete("/api/resources/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getResource(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Resurs");
  }
  await storage.deleteResource(req.params.id);
  res.status(204).send();
}));

}
