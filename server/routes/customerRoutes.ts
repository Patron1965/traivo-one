import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { insertCustomerSchema, insertObjectSchema } from "@shared/schema";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";

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
  const { customerId, search } = req.query;
  const allObjects = await storage.getObjects(tenantId);

  if (search && typeof search === "string" && search.trim().length > 0) {
    const q = search.toLowerCase().trim();
    const allCustomers = await storage.getCustomers(tenantId);
    const customerMap = new Map(allCustomers.map(c => [c.id, c.name]));

    const matched = allObjects.filter(o =>
      o.name.toLowerCase().includes(q) ||
      (o.address && o.address.toLowerCase().includes(q)) ||
      (o.objectNumber && o.objectNumber.toLowerCase().includes(q))
    ).slice(0, 100);

    const results = matched.map(obj => ({
      id: obj.id,
      name: obj.name,
      objectNumber: obj.objectNumber,
      objectType: obj.objectType,
      address: obj.address,
      customerId: obj.customerId,
      customerName: customerMap.get(obj.customerId) || null,
      children: [],
    }));

    return res.json(results);
  }

  const filtered = customerId
    ? allObjects.filter(o => o.customerId === customerId)
    : allObjects;

  const byParent = new Map<string | null, typeof filtered>();
  for (const obj of filtered) {
    const parentId = obj.parentId || null;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(obj);
  }

  type TreeNode = {
    id: string;
    name: string;
    objectNumber: string | null;
    objectType: string | null;
    address: string | null;
    customerId: string;
    children: TreeNode[];
  };

  function buildTree(parentId: string | null): TreeNode[] {
    const children = byParent.get(parentId) || [];
    return children.map(obj => ({
      id: obj.id,
      name: obj.name,
      objectNumber: obj.objectNumber,
      objectType: obj.objectType,
      address: obj.address,
      customerId: obj.customerId,
      children: buildTree(obj.id),
    }));
  }

  res.json(buildTree(null));
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
