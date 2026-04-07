import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { insertCustomerSchema, insertObjectSchema, objects, customers } from "@shared/schema";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { db } from "../db";
import { eq, and, isNull, sql, ilike, or } from "drizzle-orm";

export async function registerCustomerRoutes(app: Express) {

app.get("/api/customers", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const page = parseInt(req.query.page as string);
  const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  if (page > 0 && limit > 0) {
    const offset = (page - 1) * limit;
    const result = await storage.getCustomersPaginated(tenantId, limit, offset, search);
    return res.json({ data: result.customers, total: result.total, page, limit });
  }
  const customers = await storage.getCustomers(tenantId);
  res.json(customers);
}));

app.get("/api/customers/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  const verified = verifyTenantOwnership(customer, tenantId);
  if (!verified) throw new NotFoundError("Kund");
  res.json(verified);
}));

app.post("/api/customers", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertCustomerSchema.parse({ ...req.body, tenantId });
  const customer = await storage.createCustomer(data);
  res.status(201).json(customer);
}));

app.patch("/api/customers/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const updateSchema = insertCustomerSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as Record<string, unknown>;
  const customer = await storage.updateCustomer(req.params.id, updateData);
  if (!customer) throw new NotFoundError("Kund");
  res.json(customer);
}));

app.delete("/api/customers/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Kund");
  }
  await storage.deleteCustomer(req.params.id);
  res.status(204).send();
}));

app.get("/api/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const search = req.query.search as string || "";
  const customerIdParam = req.query.customerId as string || undefined;
  const customerIds = customerIdParam ? customerIdParam.split(",").filter(id => id.trim()) : undefined;
  const objectType = req.query.objectType as string || undefined;
  const hierarchyLevel = req.query.hierarchyLevel as string || undefined;
  const accessType = req.query.accessType as string || undefined;
  const ids = req.query.ids as string || undefined;
  const noCluster = req.query.noCluster === "true";

  if (ids) {
    const idArray = ids.split(",").filter(id => id.trim());
    if (idArray.length > 0) {
      const objects = await storage.getObjectsByIds(tenantId, idArray);
      return res.json(objects);
    }
  }

  const interim = req.query.interim as string || undefined;
  const issue = req.query.issue as string || undefined;
  const hasFilters = objectType || hierarchyLevel || accessType || interim || issue;
  const paginated = req.query.paginated === "true";

  if (paginated || req.query.limit || req.query.offset || req.query.search || req.query.customerId || noCluster || hasFilters) {
    const filters = hasFilters ? { objectType, hierarchyLevel, accessType, isInterimObject: interim === "true" ? true : interim === "false" ? false : undefined, issue } : undefined;
    const result = await storage.getObjectsPaginated(tenantId, limit, offset, search, customerIds, filters);

    if (noCluster) {
      const filtered = (result.objects as Array<Record<string, unknown>>).filter(obj => !obj.clusterId);
      res.json(filtered);
    } else {
      res.json(result);
    }
  } else {
    const objects = await storage.getObjects(tenantId);
    res.json(objects);
  }
}));

app.get("/api/objects/tree", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { customerId, search, parentId } = req.query;

  if (search && typeof search === "string" && search.trim().length > 0) {
    const q = `%${search.trim()}%`;
    const rows = await db
      .select({
        id: objects.id,
        name: objects.name,
        objectNumber: objects.objectNumber,
        objectType: objects.objectType,
        address: objects.address,
        customerId: objects.customerId,
        customerName: customers.name,
      })
      .from(objects)
      .leftJoin(customers, eq(objects.customerId, customers.id))
      .where(and(
        eq(objects.tenantId, tenantId),
        isNull(objects.deletedAt),
        or(
          ilike(objects.name, q),
          ilike(objects.address, q),
          ilike(objects.objectNumber, q)
        )
      ))
      .limit(100);

    return res.json(rows.map(r => ({ ...r, children: [] })));
  }

  const parentFilter = parentId && typeof parentId === "string"
    ? eq(objects.parentId, parentId)
    : isNull(objects.parentId);

  const conditions = [
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    parentFilter,
  ];
  if (customerId && typeof customerId === "string") {
    conditions.push(eq(objects.customerId, customerId));
  }

  const customerFilter = (customerId && typeof customerId === "string")
    ? sql` AND c.customer_id = ${customerId}`
    : sql``;
  const childCountSql = sql<number>`(SELECT count(*) FROM objects c WHERE c.parent_id = ${objects.id} AND c.tenant_id = ${tenantId} AND c.deleted_at IS NULL${customerFilter})`;

  const rows = await db
    .select({
      id: objects.id,
      name: objects.name,
      objectNumber: objects.objectNumber,
      objectType: objects.objectType,
      address: objects.address,
      customerId: objects.customerId,
      childCount: childCountSql,
    })
    .from(objects)
    .where(and(...conditions))
    .orderBy(objects.name);

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    objectNumber: r.objectNumber,
    objectType: r.objectType,
    address: r.address,
    customerId: r.customerId,
    childCount: Number(r.childCount) || 0,
    children: [],
  })));
}));

app.get("/api/objects/tree/:parentId/children", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { parentId } = req.params;
  const { customerId } = req.query;

  const conditions = [
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    eq(objects.parentId, parentId),
  ];
  if (customerId && typeof customerId === "string") {
    conditions.push(eq(objects.customerId, customerId));
  }

  const customerFilter2 = (customerId && typeof customerId === "string")
    ? sql` AND c.customer_id = ${customerId}`
    : sql``;
  const childCountSql2 = sql<number>`(SELECT count(*) FROM objects c WHERE c.parent_id = ${objects.id} AND c.tenant_id = ${tenantId} AND c.deleted_at IS NULL${customerFilter2})`;

  const rows = await db
    .select({
      id: objects.id,
      name: objects.name,
      objectNumber: objects.objectNumber,
      objectType: objects.objectType,
      address: objects.address,
      customerId: objects.customerId,
      childCount: childCountSql2,
    })
    .from(objects)
    .where(and(...conditions))
    .orderBy(objects.name);

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    objectNumber: r.objectNumber,
    objectType: r.objectType,
    address: r.address,
    customerId: r.customerId,
    childCount: Number(r.childCount) || 0,
    children: [],
  })));
}));

app.get("/api/objects/tree/:parentId/descendants", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { parentId } = req.params;
  const { customerId } = req.query;

  const customerClause = (customerId && typeof customerId === "string")
    ? sql` AND customer_id = ${customerId}`
    : sql``;
  const customerClauseR = (customerId && typeof customerId === "string")
    ? sql` AND o.customer_id = ${customerId}`
    : sql``;

  const result = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM objects WHERE id = ${parentId} AND tenant_id = ${tenantId} AND deleted_at IS NULL${customerClause}
      UNION ALL
      SELECT o.id FROM objects o INNER JOIN tree t ON o.parent_id = t.id WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL${customerClauseR}
    )
    SELECT id FROM tree
  `);
  const ids = (result.rows as Array<{ id: string }>).map(r => r.id);
  res.json(ids);
}));

app.get("/api/objects/with-issues", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { issueType, status, customerId, limit } = req.query;

  const allObjects = await storage.getObjects(tenantId);
  const deviations = await storage.getDeviationReports(tenantId, {
    status: status as string || undefined
  });

  type ObjectWithIssue = {
    object: (typeof allObjects)[0];
    issueType: string;
    issueCount: number;
    latestIssue: Date | null;
    severity?: string;
    details?: Array<Record<string, unknown>>;
  };

  const objectsWithIssues: ObjectWithIssue[] = [];

  const deviationsByObject = new Map<string, typeof deviations>();
  for (const dev of deviations) {
    const existing = deviationsByObject.get(dev.objectId) || [];
    existing.push(dev);
    deviationsByObject.set(dev.objectId, existing);
  }

  for (const [objectId, devList] of deviationsByObject) {
    const obj = allObjects.find(o => o.id === objectId);
    if (!obj) continue;
    if (customerId && obj.customerId !== customerId) continue;

    const byCategory = new Map<string, typeof devList>();
    for (const dev of devList) {
      const cat = dev.category || 'other';
      const existing = byCategory.get(cat) || [];
      existing.push(dev);
      byCategory.set(cat, existing);
    }

    for (const [category, categoryDevs] of byCategory) {
      if (issueType && category !== issueType) continue;

      const sorted = categoryDevs.sort((a, b) =>
        new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime()
      );
      const latest = sorted[0];

      objectsWithIssues.push({
        object: obj,
        issueType: category,
        issueCount: categoryDevs.length,
        latestIssue: new Date(latest.reportedAt),
        severity: latest.severity || undefined,
        details: sorted.slice(0, 5).map(d => ({
          id: d.id,
          title: d.title,
          status: d.status,
          reportedAt: d.reportedAt,
          severity: d.severity,
        })),
      });
    }
  }

  objectsWithIssues.sort((a, b) => {
    if (!a.latestIssue) return 1;
    if (!b.latestIssue) return -1;
    return b.latestIssue.getTime() - a.latestIssue.getTime();
  });

  const limited = limit ? objectsWithIssues.slice(0, parseInt(limit as string)) : objectsWithIssues;

  const issueTypeCounts: Record<string, number> = {};
  for (const item of objectsWithIssues) {
    issueTypeCounts[item.issueType] = (issueTypeCounts[item.issueType] || 0) + 1;
  }

  res.json({
    totalObjectsWithIssues: objectsWithIssues.length,
    issueTypes: issueTypeCounts,
    objects: limited,
  });
}));

app.get("/api/objects/:id/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const allOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true, 500);
  const objectOrders = allOrders
    .filter(wo => wo.objectId === req.params.id)
    .slice(0, 50);
  res.json(objectOrders);
}));

app.get("/api/objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  const verified = verifyTenantOwnership(object, tenantId);
  if (!verified) throw new NotFoundError("Objekt");
  res.json(verified);
}));

app.get("/api/customers/:customerId/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const objects = await storage.getObjectsByCustomer(req.params.customerId);
  res.json(objects);
}));

app.post("/api/objects/coordinates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { objectIds } = req.body as { objectIds: string[] };
  if (!Array.isArray(objectIds) || objectIds.length === 0) {
    return res.json([]);
  }
  const limited = objectIds.slice(0, 3000);
  const allObjects = await storage.getObjectsByTenant(tenantId);
  const idSet = new Set(limited);
  const coords = allObjects
    .filter(o => idSet.has(o.id) && o.latitude && o.longitude)
    .map(o => ({ id: o.id, latitude: o.latitude, longitude: o.longitude }));
  res.json(coords);
}));

app.post("/api/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertObjectSchema.parse({ ...req.body, tenantId });
  const object = await storage.createObject(data);
  res.status(201).json(object);
}));

app.patch("/api/objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const updateSchema = insertObjectSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as Record<string, unknown>;
  const object = await storage.updateObject(req.params.id, updateData);
  if (!object) throw new NotFoundError("Objekt");
  res.json(object);
}));

app.put("/api/objects/:id/verify", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  if (!existing!.isInterimObject) {
    throw new ValidationError("Objektet är inte ett rapporterat objekt");
  }
  const object = await storage.updateObject(req.params.id, { isInterimObject: false });
  res.json(object);
}));

app.put("/api/objects/:id/reject", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  if (!existing!.isInterimObject) {
    throw new ValidationError("Objektet är inte ett rapporterat objekt");
  }
  const object = await storage.updateObject(req.params.id, { deletedAt: new Date(), status: "rejected" });
  res.json(object);
}));

app.delete("/api/objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  await storage.deleteObject(req.params.id);
  res.status(204).send();
}));

}
