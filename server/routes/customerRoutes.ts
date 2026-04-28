import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { insertCustomerSchema, insertObjectSchema, objects, customers, workOrders } from "@shared/schema";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { db } from "../db";
import { eq, and, isNull, sql, or, inArray } from "drizzle-orm";
import { ensureClusterAndAssign } from "../auto-cluster";
import { triggerGeocodeIfMissing } from "../services/geocoding";

export async function registerCustomerRoutes(app: Express) {

app.get("/api/proactive-sales/inactive", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const months = Math.max(1, Math.min(60, parseInt(req.query.months as string) || 12));
  const search = (req.query.search as string || "").trim();
  const sortBy = (req.query.sortBy as string) === "days" ? "days" : "revenue";
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 200));

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const searchCondition = search
    ? sql`AND (c.name ILIKE ${'%' + search + '%'} OR COALESCE(c.email, '') ILIKE ${'%' + search + '%'} OR COALESCE(c.contact_person, '') ILIKE ${'%' + search + '%'})`
    : sql``;

  const orderByClause = sortBy === "revenue"
    ? sql`ORDER BY CASE WHEN agg.order_count IS NULL THEN 1 ELSE 0 END, total_revenue DESC, days_since_last_order DESC`
    : sql`ORDER BY CASE WHEN agg.order_count IS NULL THEN 1 ELSE 0 END, days_since_last_order DESC, total_revenue DESC`;

  const inactiveBase = sql`
    FROM customers c
    LEFT JOIN (
      SELECT
        customer_id,
        MAX(scheduled_date) as last_order_date,
        COUNT(*) as order_count,
        SUM(COALESCE(cached_value, 0)) as total_revenue
      FROM work_orders
      WHERE tenant_id = ${tenantId}
        AND status IN ('completed', 'scheduled', 'in_progress')
        AND deleted_at IS NULL
      GROUP BY customer_id
    ) agg ON agg.customer_id = c.id
    WHERE c.tenant_id = ${tenantId}
      AND c.deleted_at IS NULL
      AND (agg.last_order_date IS NULL OR agg.last_order_date < ${cutoffStr}::date)
      ${searchCondition}
  `;

  const [inactiveRows, summaryResult, totalCustomersResult, totalRevenueResult] = await Promise.all([
    db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.contact_person,
        c.email,
        c.phone,
        c.address,
        c.city,
        agg.last_order_date,
        agg.order_count,
        agg.total_revenue,
        CASE
          WHEN agg.last_order_date IS NULL THEN 9999
          ELSE EXTRACT(DAY FROM NOW() - agg.last_order_date)::int
        END as days_since_last_order
      ${inactiveBase}
      ${orderByClause}
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int as inactive_count,
        COALESCE(SUM(agg.total_revenue), 0)::bigint as lost_revenue
      ${inactiveBase}
    `),
    db.execute(sql`
      SELECT COUNT(*) as count FROM customers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(cached_value), 0) as total
      FROM work_orders
      WHERE tenant_id = ${tenantId} AND status IN ('completed', 'scheduled', 'in_progress') AND deleted_at IS NULL
    `),
  ]);

  interface InactiveRow {
    id: string;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    last_order_date: string | null;
    order_count: string;
    total_revenue: string;
    days_since_last_order: string;
  }
  interface SummaryRow { inactive_count: string; lost_revenue: string }
  interface CountRow { count: string }
  interface TotalRow { total: string }

  const totalCustomers = parseInt((totalCustomersResult.rows as CountRow[])[0]?.count ?? "0");
  const totalRevenueAll = parseInt((totalRevenueResult.rows as TotalRow[])[0]?.total ?? "0");
  const summaryRow = (summaryResult.rows as SummaryRow[])[0];
  const inactiveCount = parseInt(summaryRow?.inactive_count ?? "0");
  const totalLostRevenue = parseInt(summaryRow?.lost_revenue ?? "0");

  const rows = inactiveRows.rows as InactiveRow[];
  const inactiveList = rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    email: r.email,
    phone: r.phone,
    address: r.address,
    city: r.city,
    lastOrderDate: r.last_order_date ? new Date(r.last_order_date).toISOString().split("T")[0] : null,
    daysSinceLastOrder: parseInt(r.days_since_last_order),
    orderCount: parseInt(r.order_count || "0"),
    totalRevenue: parseInt(r.total_revenue || "0"),
  }));

  res.json({
    customers: inactiveList,
    summary: {
      inactiveCount,
      totalCustomers,
      totalLostRevenue,
      totalRevenueAll,
    },
  });
}));

app.get("/api/customers", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : undefined;
  if (idsParam) {
    const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500);
    const list = await storage.getCustomersByIds(tenantId, ids);
    return res.json(list);
  }
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

app.get("/api/customers/aggregates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : undefined;
  const customerIds = idsParam
    ? idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500)
    : undefined;
  const rows = await storage.getCustomerAggregates(tenantId, customerIds);
  res.json(rows);
}));

app.get("/api/customers/totals", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const totals = await storage.getCustomerTotals(tenantId);
  res.json(totals);
}));

app.get("/api/customers/:id/stats", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const stats = await storage.getCustomerStats(tenantId, req.params.id);
  res.json(stats);
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
  const clusterIdFilter = req.query.clusterId as string || undefined;
  const hasFilters = objectType || hierarchyLevel || accessType || interim || issue || clusterIdFilter;
  const paginated = req.query.paginated === "true";

  if (paginated || req.query.limit || req.query.offset || req.query.search || req.query.customerId || noCluster || hasFilters) {
    const filters = hasFilters ? { objectType, hierarchyLevel, accessType, isInterimObject: interim === "true" ? true : interim === "false" ? false : undefined, issue, clusterId: clusterIdFilter } : undefined;
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
    const q = `%${search.trim().toLowerCase()}%`;
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
          sql`LOWER(${objects.name}) LIKE ${q}`,
          sql`LOWER(${objects.address}) LIKE ${q}`,
          sql`LOWER(${objects.objectNumber}) LIKE ${q}`
        )
      ))
      .limit(100);

    return res.json(rows.map(r => ({ ...r, childCount: 0, children: [] })));
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
  const parsedLimit = limit ? Math.max(1, Math.min(1000, parseInt(limit as string) || 0)) : undefined;

  const result = await storage.getObjectsWithIssues(tenantId, {
    issueType: typeof issueType === "string" ? issueType : undefined,
    status: typeof status === "string" ? status : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
    limit: parsedLimit,
  });

  res.json(result);
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
  const objects = await storage.getObjectsByCustomer(req.params.customerId, tenantId);
  res.json(objects);
}));

app.get("/api/customers/:customerId/objects/tree-roots", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  let clusterId: string | null | undefined = undefined;
  if (typeof req.query.clusterId === "string") {
    clusterId = req.query.clusterId === "null" || req.query.clusterId === "" ? null : req.query.clusterId;
  }
  const roots = await storage.getCustomerObjectTreeRoots(req.params.customerId, tenantId, clusterId);
  res.json(roots);
}));

app.get("/api/customers/:customerId/objects/tree-children", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const parentId = (req.query.parentId as string | undefined)?.trim();
  if (!parentId) {
    throw new ValidationError("parentId krävs");
  }
  const children = await storage.getCustomerObjectTreeChildren(req.params.customerId, tenantId, parentId);
  res.json(children);
}));

app.get("/api/customers/:customerId/objects/search", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 50));
  if (!q.trim()) {
    return res.json([]);
  }
  const hits = await storage.searchCustomerObjects(req.params.customerId, tenantId, q, limit);
  res.json(hits);
}));

app.get("/api/customers/:customerId/objects/coordinates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  let clusterId: string | null | undefined = undefined;
  if (typeof req.query.clusterId === "string") {
    clusterId = req.query.clusterId === "null" || req.query.clusterId === "" ? null : req.query.clusterId;
  }
  let bbox: [number, number, number, number] | undefined;
  if (typeof req.query.bbox === "string") {
    const parts = req.query.bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      bbox = [parts[0], parts[1], parts[2], parts[3]];
    }
  }
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit as string) || 2000));
  const zoomRaw = parseFloat(req.query.zoom as string);
  if (!Number.isFinite(zoomRaw)) {
    // Backward compatible: no zoom = legacy point list
    const points = await storage.getCustomerObjectMapPoints(req.params.customerId, tenantId, { bbox, clusterId, limit });
    return res.json(points);
  }
  const data = await storage.getCustomerObjectMapData(req.params.customerId, tenantId, { bbox, clusterId, zoom: zoomRaw, limit });
  res.json(data);
}));

app.post("/api/objects/coordinates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { objectIds } = req.body as { objectIds: string[] };
  if (!Array.isArray(objectIds) || objectIds.length === 0) {
    return res.json([]);
  }
  const limited = objectIds.slice(0, 3000);
  const matchedObjects = await storage.getObjectsByIds(tenantId, limited);
  const coords = matchedObjects
    .filter(o => o.latitude && o.longitude)
    .map(o => ({ id: o.id, latitude: o.latitude, longitude: o.longitude }));
  res.json(coords);
}));

app.post("/api/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertObjectSchema.parse({ ...req.body, tenantId });
  const object = await storage.createObject(data);
  
  if (object.customerId) {
    try {
      await ensureClusterAndAssign(tenantId, object.customerId, object.id);
    } catch (err) {
      console.error("Auto-cluster error on object create:", err);
    }
  }

  triggerGeocodeIfMissing(object.id);

  const updated = await storage.getObject(object.id);
  res.status(201).json(updated || object);
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

  const addressChanged = "address" in updateData && updateData.address !== existing!.address;
  const coordsExplicitlyProvided = "latitude" in updateData || "longitude" in updateData;
  if (addressChanged && !coordsExplicitlyProvided && object.address) {
    triggerGeocodeIfMissing(object.id, { force: true });
  } else if (object.address && (object.latitude == null || object.longitude == null)) {
    triggerGeocodeIfMissing(object.id);
  }

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
