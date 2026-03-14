import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { geocodeAddress, searchDestinations, batchGeocode, isGoogleGeocodingAvailable } from "../google-geocoding";
import { createInheritanceProcessor } from "../inheritance-processor";
import { objects, insertObjectParentSchema } from "@shared/schema";

export async function registerObjectRoutes(app: Express) {
// === GOOGLE GEOCODING v4 API ===

app.post("/api/geocode/address", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || typeof address !== "string") {
      return res.status(400).json({ error: "Address is required" });
    }
    const tenantId = getTenantIdWithFallback(req);
    const result = await geocodeAddress(address, tenantId);
    if (!result) {
      return res.status(404).json({ error: "Address not found" });
    }
    res.json(result);
  } catch (error) {
    console.error("Failed to geocode address:", error);
    res.status(500).json({ error: "Geocoding failed" });
  }
});

app.post("/api/geocode/search-destinations", async (req, res) => {
  try {
    const { address } = req.body;
    if (!address || typeof address !== "string") {
      return res.status(400).json({ error: "Address is required" });
    }
    const tenantId = getTenantIdWithFallback(req);
    const result = await searchDestinations(address, tenantId);
    if (!result) {
      return res.status(404).json({ error: "No destinations found" });
    }
    res.json(result);
  } catch (error) {
    console.error("Failed to search destinations:", error);
    res.status(500).json({ error: "Search destinations failed" });
  }
});

app.get("/api/geocode/status", async (_req, res) => {
  res.json({ googleAvailable: isGoogleGeocodingAvailable() });
});

app.post("/api/objects/:id/update-entrance", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const { entranceLatitude, entranceLongitude, addressDescriptor } = req.body;
    const updateData: any = {};
    if (entranceLatitude !== undefined) updateData.entranceLatitude = entranceLatitude;
    if (entranceLongitude !== undefined) updateData.entranceLongitude = entranceLongitude;
    if (addressDescriptor !== undefined) updateData.addressDescriptor = addressDescriptor;

    const object = await storage.updateObject(req.params.id, updateData);
    if (!object) return res.status(404).json({ error: "Object not found" });
    res.json(object);
  } catch (error) {
    console.error("Failed to update entrance:", error);
    res.status(500).json({ error: "Failed to update entrance" });
  }
});

function applyBatchGeoFilters(objects: ServiceObject[], filters: any): ServiceObject[] {
  let targets = objects.filter(o =>
    o.address && (!o.entranceLatitude || !o.entranceLongitude)
  );
  if (filters.objectIds && Array.isArray(filters.objectIds) && filters.objectIds.length > 0) {
    targets = targets.filter(o => filters.objectIds.includes(o.id));
  }
  if (filters.city && typeof filters.city === "string") {
    const cityLower = filters.city.toLowerCase();
    targets = targets.filter(o => o.city && o.city.toLowerCase() === cityLower);
  }
  if (filters.clusterId && typeof filters.clusterId === "string") {
    targets = targets.filter(o => o.clusterId === filters.clusterId);
  }
  if (filters.postalCode && typeof filters.postalCode === "string") {
    targets = targets.filter(o => o.postalCode && o.postalCode.startsWith(filters.postalCode));
  }
  if (filters.limit && typeof filters.limit === "number" && filters.limit > 0) {
    targets = targets.slice(0, filters.limit);
  }
  return targets;
}

app.post("/api/objects/by-ids", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.json([]);
    }
    const objects = await storage.getObjectsByIds(tenantId, ids.slice(0, 500));
    res.json(objects);
  } catch (error) {
    console.error("Failed to get objects by ids:", error);
    res.status(500).json({ error: "Failed to get objects" });
  }
});

app.post("/api/objects/geocoded", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to get geocoded objects:", error);
    res.status(500).json({ error: "Failed to get geocoded objects" });
  }
});

app.post("/api/objects/batch-geocode/preview", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to preview batch geocode:", error);
    res.status(500).json({ error: "Preview failed" });
  }
});

app.post("/api/objects/batch-geocode", async (req, res) => {
  try {
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
      const updateData: any = {};
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
  } catch (error) {
    console.error("Failed to batch geocode:", error);
    res.status(500).json({ error: "Batch geocoding failed" });
  }
});

// === FLERFÖRÄLDRA-API (Multi-parent relationships) ===

app.get("/api/objects/:id/parents", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const parents = await storage.getObjectParents(req.params.id);
    res.json(parents);
  } catch (error) {
    console.error("Failed to fetch object parents:", error);
    res.status(500).json({ error: "Failed to fetch object parents" });
  }
});

app.post("/api/objects/:id/parents", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const parentObj = await storage.getObject(req.body.parentId);
    if (!verifyTenantOwnership(parentObj, tenantId)) {
      return res.status(404).json({ error: "Parent object not found" });
    }
    const data = insertObjectParentSchema.parse({
      ...req.body,
      objectId: req.params.id,
      tenantId,
    });
    const result = await storage.addObjectParent(data);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to add object parent:", error);
    res.status(500).json({ error: "Failed to add object parent" });
  }
});

app.delete("/api/objects/:id/parents/:parentRelationId", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    await storage.removeObjectParent(req.params.parentRelationId, req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to remove object parent:", error);
    res.status(500).json({ error: "Failed to remove object parent" });
  }
});

app.patch("/api/objects/:id/parents/:parentRelationId/primary", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const parents = await storage.getObjectParents(req.params.id);
    const relation = parents.find(p => p.id === req.params.parentRelationId);
    if (!relation) {
      return res.status(404).json({ error: "Parent relation not found" });
    }
    const result = await storage.setPrimaryParent(req.params.id, relation.parentId, tenantId);
    if (!result) {
      return res.status(404).json({ error: "Failed to set primary parent" });
    }
    res.json(result);
  } catch (error) {
    console.error("Failed to set primary parent:", error);
    res.status(500).json({ error: "Failed to set primary parent" });
  }
});

// === ÄRVNINGS-API (Inheritance) ===

// Hämta objekt med resolved/ärvda värden och ursprungsinformation
app.get("/api/objects/:id/resolved", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    
    const processor = await createInheritanceProcessor(tenantId);
    const objectWithInheritance = await processor.getObjectWithResolvedValues(req.params.id);
    
    if (!objectWithInheritance) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    
    res.json(objectWithInheritance);
  } catch (error) {
    console.error("Failed to get resolved object:", error);
    res.status(500).json({ error: "Kunde inte hämta objekt med ärvda värden" });
  }
});

// Hämta hela ärvningskedjan (ancestors) för ett objekt
app.get("/api/objects/:id/ancestors", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    
    const processor = await createInheritanceProcessor(tenantId);
    const ancestors = await processor.getAncestorChain(req.params.id);
    
    res.json(ancestors);
  } catch (error) {
    console.error("Failed to get ancestors:", error);
    res.status(500).json({ error: "Kunde inte hämta ärvningskedja" });
  }
});

// Hämta alla ättlingar (descendants) för ett objekt
app.get("/api/objects/:id/descendants", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    
    const processor = await createInheritanceProcessor(tenantId);
    const descendants = await processor.getDescendants(req.params.id);
    
    res.json(descendants);
  } catch (error) {
    console.error("Failed to get descendants:", error);
    res.status(500).json({ error: "Kunde inte hämta ättlingar" });
  }
});

// Uppdatera resolved-värden för ett objekt och alla dess ättlingar
app.post("/api/objects/:id/recalculate-inheritance", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    
    const processor = await createInheritanceProcessor(tenantId);
    await processor.updateResolvedValues(req.params.id);
    const descendantsUpdated = await processor.updateDescendants(req.params.id);
    
    res.json({ 
      success: true, 
      message: `Uppdaterade ärvning för objektet och ${descendantsUpdated} ättlingar` 
    });
  } catch (error) {
    console.error("Failed to recalculate inheritance:", error);
    res.status(500).json({ error: "Kunde inte uppdatera ärvning" });
  }
});

// Processa ärvning för hela klusterhierarkin
app.post("/api/clusters/:id/process-inheritance", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(cluster, tenantId)) {
      return res.status(404).json({ error: "Kluster hittades inte" });
    }
    
    const processor = await createInheritanceProcessor(tenantId);
    const result = await processor.processClusterHierarchy(req.params.id);
    
    res.json({
      success: true,
      processed: result.processed,
      errors: result.errors
    });
  } catch (error) {
    console.error("Failed to process cluster inheritance:", error);
    res.status(500).json({ error: "Kunde inte bearbeta klusterärvning" });
  }
});

}
