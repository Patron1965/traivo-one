import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { geocodeAddress, searchDestinations, batchGeocode, isGoogleGeocodingAvailable, reverseGeocode, lookupCityFromPostalCode } from "../google-geocoding";
import { createInheritanceProcessor } from "../inheritance-processor";
import { insertObjectParentSchema, objects, workOrders, workOrderObjects, objectArticles, objectContacts, objectImages, objectMetadata, objectParents, objectPayers, objectTimeRestrictions, geocodingMissingSnapshots } from "@shared/schema";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { db } from "../db";
import { sql, eq, and, isNull, inArray, desc } from "drizzle-orm";
import { geocodeObjectById } from "../services/geocoding";
import {
  evaluateAndNotifyMissingCoordinates,
  readNotificationConfig,
  writeNotificationConfig,
  getDefaultRecipients,
} from "../services/missing-coordinates-notifier";
import { missingCoordinatesNotificationConfigSchema } from "@shared/schema";

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

app.get("/api/objects/duplicates/summary", asyncHandler(async (_req, res) => {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) as total_groups,
      SUM(cnt - 1) as removable_count,
      (SELECT COUNT(*) FROM objects WHERE deleted_at IS NULL) as total_objects
    FROM (
      SELECT name, address, customer_id, COUNT(*) as cnt
      FROM objects
      WHERE deleted_at IS NULL
      GROUP BY name, address, customer_id
      HAVING COUNT(*) > 1
    ) t
  `);
  const row = result.rows[0] || {};
  res.json({
    totalGroups: Number(row.total_groups || 0),
    removableCount: Number(row.removable_count || 0),
    totalObjects: Number(row.total_objects || 0),
  });
}));

app.get("/api/objects/duplicates", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;

  const groups = await db.execute(sql`
    SELECT name, address, customer_id, COUNT(*) as cnt
    FROM objects
    WHERE deleted_at IS NULL
    GROUP BY name, address, customer_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const duplicateGroups = [];
  for (const g of groups.rows) {
    const memberRows = await db.execute(sql`
      SELECT o.id, o.name, o.address, o.object_number, o.customer_id, o.cluster_id,
             o.latitude, o.longitude, o.city, o.postal_code, o.object_type,
             o.created_at,
             c.name as customer_name,
             (SELECT COUNT(*) FROM work_orders wo WHERE wo.object_id = o.id) as work_order_count,
             (SELECT COUNT(*) FROM work_order_objects woo WHERE woo.object_id = o.id) as linked_wo_count,
             (SELECT COUNT(*) FROM object_articles oa WHERE oa.object_id = o.id) as article_count,
             (SELECT COUNT(*) FROM object_contacts oc WHERE oc.object_id = o.id) as contact_count
      FROM objects o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.name = ${g.name}
        AND ${g.address ? sql`o.address = ${g.address}` : sql`o.address IS NULL`}
        AND ${g.customer_id ? sql`o.customer_id = ${g.customer_id}` : sql`o.customer_id IS NULL`}
        AND o.deleted_at IS NULL
      ORDER BY
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.object_id = o.id) DESC,
        o.created_at ASC
    `);

    duplicateGroups.push({
      name: g.name,
      address: g.address,
      customerId: g.customer_id,
      customerName: memberRows.rows[0]?.customer_name || null,
      count: Number(g.cnt),
      members: memberRows.rows.map(m => ({
        id: m.id,
        name: m.name,
        address: m.address,
        objectNumber: m.object_number,
        customerId: m.customer_id,
        customerName: m.customer_name,
        clusterId: m.cluster_id,
        latitude: m.latitude,
        longitude: m.longitude,
        city: m.city,
        postalCode: m.postal_code,
        objectType: m.object_type,
        createdAt: m.created_at,
        workOrderCount: Number(m.work_order_count || 0),
        linkedWoCount: Number(m.linked_wo_count || 0),
        articleCount: Number(m.article_count || 0),
        contactCount: Number(m.contact_count || 0),
      }))
    });
  }

  res.json({ groups: duplicateGroups, page, limit });
}));

app.post("/api/objects/duplicates/merge", asyncHandler(async (req, res) => {
  const schema = z.object({
    keepId: z.string().uuid(),
    removeIds: z.array(z.string().uuid()).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

  const { keepId, removeIds } = parsed.data;
  if (removeIds.includes(keepId)) {
    throw new ValidationError("keepId cannot be in removeIds");
  }

  const keepObj = await db.select().from(objects).where(eq(objects.id, keepId)).limit(1);
  if (!keepObj.length) throw new NotFoundError("Object to keep");

  let reassigned = 0;

  for (const removeId of removeIds) {
    const tables = [
      { table: 'work_orders', col: 'object_id' },
      { table: 'work_order_objects', col: 'object_id' },
      { table: 'assignments', col: 'object_id' },
      { table: 'protocols', col: 'object_id' },
      { table: 'deviation_reports', col: 'object_id' },
      { table: 'setup_time_logs', col: 'object_id' },
      { table: 'planning_parameters', col: 'object_id' },
      { table: 'predictive_forecasts', col: 'object_id' },
      { table: 'annual_goals', col: 'object_id' },
      { table: 'customer_booking_requests', col: 'object_id' },
      { table: 'customer_change_requests', col: 'object_id' },
      { table: 'customer_communications', col: 'object_id' },
      { table: 'customer_issue_reports', col: 'object_id' },
      { table: 'public_issue_reports', col: 'object_id' },
      { table: 'qr_code_links', col: 'object_id' },
      { table: 'self_bookings', col: 'object_id' },
      { table: 'subscription_changes', col: 'object_id' },
      { table: 'subscriptions', col: 'object_id' },
      { table: 'iot_devices', col: 'object_id' },
      { table: 'inspection_metadata', col: 'object_id' },
      { table: 'task_metadata_updates', col: 'object_id' },
    ];

    for (const { table, col } of tables) {
      try {
        const result = await db.execute(
          sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier(col)} = ${keepId} WHERE ${sql.identifier(col)} = ${removeId}`
        );
        reassigned += Number((result as any).rowCount || 0);
      } catch {}
    }

    const childTables = [
      'object_articles', 'object_contacts', 'object_images',
      'object_metadata', 'object_payers', 'object_time_restrictions', 'object_parents'
    ];
    for (const table of childTables) {
      try {
        await db.execute(
          sql`UPDATE ${sql.identifier(table)} SET object_id = ${keepId} WHERE object_id = ${removeId}`
        );
      } catch {}
    }

    await db.update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, removeId));
  }

  res.json({
    success: true,
    kept: keepId,
    removed: removeIds.length,
    reassigned,
  });
}));

app.post("/api/objects/duplicates/auto-merge", asyncHandler(async (req, res) => {
  const schema = z.object({
    maxGroups: z.number().int().min(1).max(500).default(100),
    dryRun: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

  const { maxGroups, dryRun } = parsed.data;

  const groups = await db.execute(sql`
    SELECT name, address, customer_id, COUNT(*) as cnt
    FROM objects
    WHERE deleted_at IS NULL
    GROUP BY name, address, customer_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${maxGroups}
  `);

  let totalRemoved = 0;
  let totalReassigned = 0;
  let groupsProcessed = 0;

  for (const g of groups.rows) {
    const members = await db.execute(sql`
      SELECT o.id,
             (SELECT COUNT(*) FROM work_orders wo WHERE wo.object_id = o.id) as wo_count
      FROM objects o
      WHERE o.name = ${g.name}
        AND ${g.address ? sql`o.address = ${g.address}` : sql`o.address IS NULL`}
        AND ${g.customer_id ? sql`o.customer_id = ${g.customer_id}` : sql`o.customer_id IS NULL`}
        AND o.deleted_at IS NULL
      ORDER BY
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.object_id = o.id) DESC,
        o.created_at ASC
    `);

    if (members.rows.length < 2) continue;

    const keepId = members.rows[0].id as string;
    const removeIds = members.rows.slice(1).map(m => m.id as string);

    if (!dryRun) {
      const tables = [
        'work_orders', 'work_order_objects', 'assignments', 'protocols',
        'deviation_reports', 'setup_time_logs', 'planning_parameters',
        'predictive_forecasts', 'annual_goals', 'customer_booking_requests',
        'customer_change_requests', 'customer_communications', 'customer_issue_reports',
        'public_issue_reports', 'qr_code_links', 'self_bookings',
        'subscription_changes', 'subscriptions', 'iot_devices',
        'inspection_metadata', 'task_metadata_updates',
        'object_articles', 'object_contacts', 'object_images',
        'object_metadata', 'object_payers', 'object_time_restrictions', 'object_parents'
      ];

      for (const removeId of removeIds) {
        for (const table of tables) {
          try {
            const result = await db.execute(
              sql`UPDATE ${sql.identifier(table)} SET object_id = ${keepId} WHERE object_id = ${removeId}`
            );
            totalReassigned += Number((result as any).rowCount || 0);
          } catch {}
        }
        await db.update(objects)
          .set({ deletedAt: new Date() })
          .where(eq(objects.id, removeId));
      }
    }

    totalRemoved += removeIds.length;
    groupsProcessed++;
  }

  res.json({
    dryRun,
    groupsProcessed,
    totalRemoved,
    totalReassigned,
  });
}));

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

app.get("/api/objects/missing-city-count", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  let missingCity = 0;
  let hasPostalCode = 0;
  let hasCoordinates = 0;
  let hasAddress = 0;
  let canResolve = 0;
  for (const obj of allObjects) {
    if (!obj.city || obj.city.trim() === "") {
      missingCity++;
      const hasPC = !!(obj.postalCode && obj.postalCode.trim() !== "");
      const hasCoord = !!(obj.latitude && obj.longitude);
      const hasAddr = !!(obj.address && obj.address.trim() !== "");
      if (hasPC) hasPostalCode++;
      if (hasCoord) hasCoordinates++;
      if (hasAddr) hasAddress++;
      if (hasPC || hasCoord || hasAddr) canResolve++;
    }
  }
  res.json({
    totalMissingCity: missingCity,
    canResolveFromPostalCode: hasPostalCode,
    canResolveFromCoordinates: hasCoordinates,
    canResolveFromAddress: hasAddress,
    canResolve,
  });
}));

app.post("/api/objects/batch-fill-city/preview", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  const missing = allObjects.filter(o => !o.city || o.city.trim() === "");

  let withPostalCode = 0;
  let withCoordinates = 0;
  let withAddress = 0;
  let noResolvableInfo = 0;
  const postalCodeGroups = new Map<string, number>();

  for (const obj of missing) {
    const hasPC = !!(obj.postalCode && obj.postalCode.trim() !== "");
    const hasCoord = !!(obj.latitude && obj.longitude);
    const hasAddr = !!(obj.address && obj.address.trim() !== "");
    if (hasPC) {
      withPostalCode++;
      const code = obj.postalCode!.replace(/\s/g, "").substring(0, 3);
      postalCodeGroups.set(code, (postalCodeGroups.get(code) || 0) + 1);
    }
    if (hasCoord) withCoordinates++;
    if (hasAddr) withAddress++;
    if (!hasPC && !hasCoord && !hasAddr) noResolvableInfo++;
  }

  const byPostalPrefix = Array.from(postalCodeGroups.entries())
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    totalMissingCity: missing.length,
    withPostalCode,
    withCoordinates,
    withAddress,
    noResolvableInfo,
    byPostalPrefix,
  });
}));

app.post("/api/objects/batch-fill-city", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  const missing = allObjects.filter(o => !o.city || o.city.trim() === "");

  const postalCodeCache = new Map<string, string | null>();
  let updated = 0;
  let failed = 0;
  const updatedIds: string[] = [];

  for (let i = 0; i < missing.length; i++) {
    const obj = missing[i];
    let city: string | null = null;
    const updateData: Record<string, unknown> = {};

    if (obj.postalCode && obj.postalCode.trim() !== "") {
      const code = obj.postalCode.replace(/\s/g, "");
      if (postalCodeCache.has(code)) {
        city = postalCodeCache.get(code)!;
      } else {
        city = await lookupCityFromPostalCode(code, tenantId);
        postalCodeCache.set(code, city);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (!city && obj.latitude && obj.longitude) {
      const result = await reverseGeocode(obj.latitude, obj.longitude, tenantId);
      if (result?.city) city = result.city;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!city && obj.address && obj.address.trim() !== "") {
      const result = await geocodeAddress(obj.address, tenantId);
      if (result?.city) {
        city = result.city;
        if (!obj.latitude && result.latitude) {
          updateData.latitude = result.latitude;
          updateData.longitude = result.longitude;
        }
        if (result.postalCode && (!obj.postalCode || obj.postalCode.trim() === "")) {
          updateData.postalCode = result.postalCode;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (city) {
      updateData.city = city;
      await storage.updateObject(obj.id, updateData);
      updated++;
      updatedIds.push(obj.id);
    } else {
      failed++;
    }
  }

  res.json({
    total: missing.length,
    updated,
    failed,
    updatedIds,
    remaining: missing.length - updated,
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

// === Missing coordinates admin: list, retry, trend ===
app.get("/api/objects/missing-coordinates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allObjects = await storage.getObjects(tenantId);
  const customers = await storage.getCustomers(tenantId);
  const clusters = await storage.getClusters(tenantId);
  const customerById = new Map(customers.map(c => [c.id, c]));
  const clusterById = new Map(clusters.map(c => [c.id, c]));

  const withAddress = allObjects.filter(o => o.address && o.address.trim() !== "");
  const missing = withAddress.filter(o => o.latitude == null || o.longitude == null);

  const items = missing.map(o => ({
    id: o.id,
    name: o.name,
    objectNumber: o.objectNumber,
    address: o.address,
    city: o.city,
    postalCode: o.postalCode,
    customerId: o.customerId,
    customerName: customerById.get(o.customerId)?.name || null,
    clusterId: o.clusterId,
    clusterName: o.clusterId ? clusterById.get(o.clusterId)?.name || null : null,
  }));

  const byCustomer = new Map<string, { customerId: string; customerName: string; count: number }>();
  for (const it of items) {
    const key = it.customerId || "(okänd)";
    const existing = byCustomer.get(key);
    if (existing) existing.count++;
    else byCustomer.set(key, { customerId: key, customerName: it.customerName || "(okänd kund)", count: 1 });
  }
  const byCluster = new Map<string, { clusterId: string; clusterName: string; count: number }>();
  for (const it of items) {
    const key = it.clusterId || "(inget kluster)";
    const existing = byCluster.get(key);
    if (existing) existing.count++;
    else byCluster.set(key, { clusterId: key, clusterName: it.clusterName || "(inget kluster)", count: 1 });
  }

  // Snapshot today's count (idempotent per day per tenant)
  const today = new Date().toISOString().slice(0, 10);
  try {
    await db.insert(geocodingMissingSnapshots)
      .values({
        tenantId,
        date: today,
        missingCount: missing.length,
        totalWithAddress: withAddress.length,
        totalObjects: allObjects.length,
      })
      .onConflictDoUpdate({
        target: [geocodingMissingSnapshots.tenantId, geocodingMissingSnapshots.date],
        set: {
          missingCount: missing.length,
          totalWithAddress: withAddress.length,
          totalObjects: allObjects.length,
        },
      });
  } catch (err) {
    console.error("[missing-coordinates] Failed to record snapshot:", err);
  }

  res.json({
    summary: {
      missingCount: missing.length,
      totalWithAddress: withAddress.length,
      totalObjects: allObjects.length,
    },
    items,
    byCustomer: Array.from(byCustomer.values()).sort((a, b) => b.count - a.count),
    byCluster: Array.from(byCluster.values()).sort((a, b) => b.count - a.count),
  });
}));

app.get("/api/objects/missing-coordinates/trend", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 365);
  try {
    const rows = await db.select()
      .from(geocodingMissingSnapshots)
      .where(eq(geocodingMissingSnapshots.tenantId, tenantId))
      .orderBy(desc(geocodingMissingSnapshots.date))
      .limit(days);
    res.json({
      days,
      snapshots: rows.reverse().map(r => ({
        date: r.date,
        missingCount: r.missingCount,
        totalWithAddress: r.totalWithAddress,
        totalObjects: r.totalObjects,
      })),
    });
  } catch (err) {
    // Tabellen kan saknas under första migrationsfönstret — degrade gracefully.
    console.warn("[missing-coordinates/trend] Failed to read snapshots, returning empty list:", err);
    res.json({ days, snapshots: [] });
  }
}));

app.post("/api/objects/missing-coordinates/notify", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const result = await evaluateAndNotifyMissingCoordinates(tenantId);
  res.json(result);
}));

app.get("/api/objects/missing-coordinates/notification-settings", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) throw new NotFoundError("Tenant");
  const config = readNotificationConfig(tenant);
  const defaultRecipients = await getDefaultRecipients(tenant);
  res.json({ ...config, defaultRecipients });
}));

app.put("/api/objects/missing-coordinates/notification-settings", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) throw new NotFoundError("Tenant");
  const parsed = missingCoordinatesNotificationConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(formatZodError(parsed.error));
  }
  const normalized = {
    enabled: parsed.data.enabled,
    recipients: Array.from(new Set(parsed.data.recipients.map((e) => e.trim().toLowerCase()))).filter(Boolean),
  };
  await writeNotificationConfig(tenant, normalized);
  const defaultRecipients = await getDefaultRecipients(tenant);
  res.json({ ...normalized, defaultRecipients });
}));

app.post("/api/objects/:id/geocode", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const force = req.body?.force === true;
  const result = await geocodeObjectById(req.params.id, { force, useSearchDestinations: true });
  res.json(result);
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
