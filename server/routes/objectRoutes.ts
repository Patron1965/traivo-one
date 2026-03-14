import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { geocodeAddress, searchDestinations, batchGeocode, isGoogleGeocodingAvailable } from "../google-geocoding";
import { createInheritanceProcessor } from "../inheritance-processor";
import { insertObjectParentSchema } from "@shared/schema";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";

type ServiceObject = Awaited<ReturnType<typeof storage.getObjects>>[number];

function applyBatchGeoFilters(objects: ServiceObject[], filters: Record<string, unknown>): ServiceObject[] {
  let targets = objects.filter(o =>
    o.address && (!o.entranceLatitude || !o.entranceLongitude)
  );
  const objectIds = filters.objectIds;
  if (Array.isArray(objectIds) && objectIds.length > 0) {
    targets = targets.filter(o => objectIds.includes(o.id));
  }
  if (typeof filters.city === "string") {
    const cityLower = filters.city.toLowerCase();
    targets = targets.filter(o => o.city && o.city.toLowerCase() === cityLower);
  }
  if (typeof filters.clusterId === "string") {
    targets = targets.filter(o => o.clusterId === filters.clusterId);
  }
  if (typeof filters.postalCode === "string") {
    targets = targets.filter(o => o.postalCode && o.postalCode.startsWith(filters.postalCode as string));
  }
  if (typeof filters.limit === "number" && filters.limit > 0) {
    targets = targets.slice(0, filters.limit);
  }
  return targets;
}

export async function registerObjectRoutes(app: Express) {

app.post("/api/geocode/address", asyncHandler(async (req, res) => {
  const { address } = req.body;
  if (!address || typeof address !== "string") {
    throw new ValidationError("Address is required");
  }
  const tenantId = getTenantIdWithFallback(req);
  const result = await geocodeAddress(address, tenantId);
  if (!result) throw new NotFoundError("Adress");
  res.json(result);
}));

app.post("/api/geocode/search-destinations", asyncHandler(async (req, res) => {
  const { address } = req.body;
  if (!address || typeof address !== "string") {
    throw new ValidationError("Address is required");
  }
  const tenantId = getTenantIdWithFallback(req);
  const result = await searchDestinations(address, tenantId);
  if (!result) throw new NotFoundError("Destination");
  res.json(result);
}));

app.get("/api/geocode/status", (_req, res) => {
  res.json({ googleAvailable: isGoogleGeocodingAvailable() });
});

app.post("/api/objects/:id/update-entrance", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const { entranceLatitude, entranceLongitude, addressDescriptor } = req.body;
  const updateData: Record<string, unknown> = {};
  if (entranceLatitude !== undefined) updateData.entranceLatitude = entranceLatitude;
  if (entranceLongitude !== undefined) updateData.entranceLongitude = entranceLongitude;
  if (addressDescriptor !== undefined) updateData.addressDescriptor = addressDescriptor;

  const object = await storage.updateObject(req.params.id, updateData);
  if (!object) throw new NotFoundError("Objekt");
  res.json(object);
}));

app.post("/api/objects/by-ids", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.json([]);
  }
  const objects = await storage.getObjectsByIds(tenantId, ids.slice(0, 500));
  res.json(objects);
}));

app.post("/api/objects/geocoded", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  const geocoded = allObjects.filter(o => o.latitude && o.longitude);

  const { city, clusterId, limit } = req.body || {};
  let matched = geocoded;
  if (city) {
    matched = matched.filter(o => (o.city || "").toLowerCase() === city.toLowerCase());
  }
  if (clusterId) {
    matched = matched.filter(o => o.clusterId === clusterId);
  }
  const maxResults = Math.min(typeof limit === "number" ? limit : 500, 2000);
  const filtered = maxResults > 0 ? matched.slice(0, maxResults) : [];

  const cityMap = new Map<string, number>();
  for (const obj of geocoded) {
    const c = obj.city || "(ingen stad)";
    cityMap.set(c, (cityMap.get(c) || 0) + 1);
  }
  const byCity = Array.from(cityMap.entries())
    .map(([c, count]) => ({ city: c, count }))
    .sort((a, b) => b.count - a.count);

  const withEntrance = matched.filter(o => o.entranceLatitude && o.entranceLongitude).length;

  res.json({
    totalGeocoded: geocoded.length,
    filteredCount: matched.length,
    withEntrance,
    byCity,
    objects: filtered.map(o => ({
      id: o.id,
      name: o.name,
      address: o.address,
      city: o.city,
      postalCode: o.postalCode,
      latitude: o.latitude,
      longitude: o.longitude,
      entranceLatitude: o.entranceLatitude,
      entranceLongitude: o.entranceLongitude,
      objectType: o.objectType,
    })),
  });
}));

app.post("/api/objects/batch-geocode/preview", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  const needsGeo = allObjects.filter(o =>
    o.address && (!o.entranceLatitude || !o.entranceLongitude)
  );
  const targets = applyBatchGeoFilters(allObjects, req.body);
  const costPerRequest = 0.005;

  const cityMap = new Map<string, number>();
  for (const obj of needsGeo) {
    const city = obj.city || "(ingen stad)";
    cityMap.set(city, (cityMap.get(city) || 0) + 1);
  }
  const byCity = Array.from(cityMap.entries())
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);

  const clusters = await storage.getClusters(tenantId);
  const clusterMap = new Map<string, { name: string; count: number }>();
  for (const obj of needsGeo) {
    if (obj.clusterId) {
      const existing = clusterMap.get(obj.clusterId);
      if (existing) {
        existing.count++;
      } else {
        const cluster = clusters.find(c => c.id === obj.clusterId);
        clusterMap.set(obj.clusterId, { name: cluster?.name || obj.clusterId, count: 1 });
      }
    }
  }
  const byCluster = Array.from(clusterMap.entries())
    .map(([clusterId, { name, count }]) => ({ clusterId, clusterName: name, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalNeedsGeo: needsGeo.length,
    filteredCount: targets.length,
    estimatedCost: +(targets.length * costPerRequest).toFixed(2),
    byCity,
    byCluster,
    googleAvailable: isGoogleGeocodingAvailable(),
  });
}));

app.post("/api/objects/batch-geocode", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  const targets = applyBatchGeoFilters(allObjects, req.body);

  const addresses = targets.map(o => ({
    id: o.id,
    address: [o.address, o.postalCode, o.city].filter(Boolean).join(", "),
  }));

  const results = await batchGeocode(addresses, tenantId);

  let updated = 0;
  const updatedIds: string[] = [];
  for (const [objectId, geoResult] of results) {
    const updateData: Record<string, unknown> = {};
    if (!targets.find(t => t.id === objectId)?.latitude && geoResult.latitude) {
      updateData.latitude = geoResult.latitude;
      updateData.longitude = geoResult.longitude;
    }
    if (geoResult.entranceLatitude) {
      updateData.entranceLatitude = geoResult.entranceLatitude;
      updateData.entranceLongitude = geoResult.entranceLongitude;
    }
    if (geoResult.addressDescriptor) {
      updateData.addressDescriptor = geoResult.addressDescriptor;
    }
    if (Object.keys(updateData).length > 0) {
      await storage.updateObject(objectId, updateData);
      updated++;
      updatedIds.push(objectId);
    }
  }

  res.json({
    total: addresses.length,
    geocoded: results.size,
    updated,
    updatedIds,
    googleAvailable: isGoogleGeocodingAvailable(),
  });
}));

app.get("/api/objects/:id/parents", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const parents = await storage.getObjectParents(req.params.id);
  res.json(parents);
}));

app.post("/api/objects/:id/parents", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const parentObj = await storage.getObject(req.body.parentId);
  if (!verifyTenantOwnership(parentObj, tenantId)) {
    throw new NotFoundError("Förälderobjekt");
  }
  const data = insertObjectParentSchema.parse({
    ...req.body,
    objectId: req.params.id,
    tenantId,
  });
  const result = await storage.addObjectParent(data);
  res.status(201).json(result);
}));

app.delete("/api/objects/:id/parents/:parentRelationId", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  await storage.removeObjectParent(req.params.parentRelationId, req.params.id);
  res.status(204).send();
}));

app.patch("/api/objects/:id/parents/:parentRelationId/primary", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const parents = await storage.getObjectParents(req.params.id);
  const relation = parents.find(p => p.id === req.params.parentRelationId);
  if (!relation) throw new NotFoundError("Föräldrarelation");
  const result = await storage.setPrimaryParent(req.params.id, relation.parentId, tenantId);
  if (!result) throw new NotFoundError("Föräldrarelation");
  res.json(result);
}));

app.get("/api/objects/:id/resolved", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const processor = await createInheritanceProcessor(tenantId);
  const objectWithInheritance = await processor.getObjectWithResolvedValues(req.params.id);
  if (!objectWithInheritance) throw new NotFoundError("Objekt");
  res.json(objectWithInheritance);
}));

app.get("/api/objects/:id/ancestors", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const processor = await createInheritanceProcessor(tenantId);
  const ancestors = await processor.getAncestorChain(req.params.id);
  res.json(ancestors);
}));

app.get("/api/objects/:id/descendants", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const processor = await createInheritanceProcessor(tenantId);
  const descendants = await processor.getDescendants(req.params.id);
  res.json(descendants);
}));

app.post("/api/objects/:id/recalculate-inheritance", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const processor = await createInheritanceProcessor(tenantId);
  await processor.updateResolvedValues(req.params.id);
  const descendantsUpdated = await processor.updateDescendants(req.params.id);
  res.json({
    success: true,
    message: `Uppdaterade ärvning för objektet och ${descendantsUpdated} ättlingar`
  });
}));

app.post("/api/clusters/:id/process-inheritance", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const cluster = await storage.getCluster(req.params.id);
  if (!verifyTenantOwnership(cluster, tenantId)) {
    throw new NotFoundError("Kluster");
  }
  const processor = await createInheritanceProcessor(tenantId);
  const result = await processor.processClusterHierarchy(req.params.id);
  res.json({
    success: true,
    processed: result.processed,
    errors: result.errors
  });
}));

}
