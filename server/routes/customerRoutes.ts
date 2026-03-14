import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { insertCustomerSchema, insertObjectSchema } from "@shared/schema";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";


export async function registerCustomerRoutes(app: Express) {
app.get("/api/customers", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    res.status(500).json({ error: "Kunde inte hämta kunder" });
  }
});

app.get("/api/customers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const customer = await storage.getCustomer(req.params.id);
    const verified = verifyTenantOwnership(customer, tenantId);
    if (!verified) return res.status(404).json({ error: "Customer not found" });
    res.json(verified);
  } catch (error) {
    console.error("Failed to fetch customer:", error);
    res.status(500).json({ error: "Failed to fetch customer" });
  }
});

app.post("/api/customers", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertCustomerSchema.parse({ ...req.body, tenantId });
    const customer = await storage.createCustomer(data);
    res.status(201).json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create customer:", error);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

app.patch("/api/customers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    // Verify ownership before update
    const existing = await storage.getCustomer(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const updateSchema = insertCustomerSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const customer = await storage.updateCustomer(req.params.id, updateData);
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    res.json(customer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to update customer:", error);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

app.delete("/api/customers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    // Verify ownership before delete
    const existing = await storage.getCustomer(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Customer not found" });
    }
    await storage.deleteCustomer(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete customer:", error);
    res.status(500).json({ error: "Failed to delete customer" });
  }
});

app.get("/api/objects", async (req, res) => {
  try {
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
    
    // If requesting specific IDs - batch fetch
    if (ids) {
      const idArray = ids.split(",").filter(id => id.trim());
      if (idArray.length > 0) {
        const objects = await storage.getObjectsByIds(tenantId, idArray);
        res.json(objects);
        return;
      }
    }
    
    const interim = req.query.interim as string || undefined;
    
    const hasFilters = objectType || hierarchyLevel || accessType || interim;
    const paginated = req.query.paginated === "true";
    
    if (paginated || req.query.limit || req.query.offset || req.query.search || req.query.customerId || noCluster || hasFilters) {
      const filters = hasFilters ? { objectType, hierarchyLevel, accessType, isInterimObject: interim === "true" ? true : interim === "false" ? false : undefined } : undefined;
      const result = await storage.getObjectsPaginated(tenantId, limit, offset, search, customerIds, filters);
      
      if (noCluster) {
        const filtered = result.objects.filter((obj: any) => !obj.clusterId);
        res.json(filtered);
      } else {
        res.json(result);
      }
    } else {
      const objects = await storage.getObjects(tenantId);
      res.json(objects);
    }
  } catch (error) {
    console.error("Failed to fetch objects:", error);
    res.status(500).json({ error: "Failed to fetch objects" });
  }
});

app.get("/api/objects/tree", async (req, res) => {
  try {
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

    function buildTree(parentId: string | null): any[] {
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
  } catch (error) {
    console.error("Failed to get object tree:", error);
    res.status(500).json({ error: "Kunde inte hämta objektträd" });
  }
});

// Objects with issues - MUST be before /api/objects/:id
app.get("/api/objects/with-issues", async (req, res) => {
  try {
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
      details?: any[];
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
  } catch (error) {
    console.error("Failed to get objects with issues:", error);
    res.status(500).json({ error: "Kunde inte hämta objekt med avvikelser" });
  }
});

app.get("/api/objects/:id/work-orders", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(object, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const allOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true, 500);
    const objectOrders = allOrders
      .filter(wo => wo.objectId === req.params.id)
      .slice(0, 50);
    res.json(objectOrders);
  } catch (error) {
    console.error("Failed to fetch work orders for object:", error);
    res.status(500).json({ error: "Failed to fetch work orders" });
  }
});

app.get("/api/objects/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.id);
    const verified = verifyTenantOwnership(object, tenantId);
    if (!verified) return res.status(404).json({ error: "Object not found" });
    res.json(verified);
  } catch (error) {
    console.error("Failed to fetch object:", error);
    res.status(500).json({ error: "Failed to fetch object" });
  }
});

app.get("/api/customers/:customerId/objects", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const customer = await storage.getCustomer(req.params.customerId);
    if (!verifyTenantOwnership(customer, tenantId)) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const objects = await storage.getObjectsByCustomer(req.params.customerId);
    res.json(objects);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch objects" });
  }
});

app.post("/api/objects/coordinates", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Error fetching object coordinates:", error);
    res.status(500).json({ error: "Failed to fetch coordinates" });
  }
});

app.post("/api/objects", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertObjectSchema.parse({ ...req.body, tenantId });
    const object = await storage.createObject(data);
    res.status(201).json(object);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create object:", error);
    res.status(500).json({ error: "Failed to create object" });
  }
});

app.patch("/api/objects/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const updateSchema = insertObjectSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const object = await storage.updateObject(req.params.id, updateData);
    if (!object) return res.status(404).json({ error: "Object not found" });
    res.json(object);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to update object:", error);
    res.status(500).json({ error: "Failed to update object" });
  }
});

app.put("/api/objects/:id/verify", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    if (!existing!.isInterimObject) {
      return res.status(400).json({ error: "Objektet är inte ett interimobjekt" });
    }
    const object = await storage.updateObject(req.params.id, { isInterimObject: false });
    res.json(object);
  } catch (error) {
    console.error("Failed to verify object:", error);
    res.status(500).json({ error: "Kunde inte verifiera objekt" });
  }
});

app.put("/api/objects/:id/reject", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
    }
    if (!existing!.isInterimObject) {
      return res.status(400).json({ error: "Objektet är inte ett interimobjekt" });
    }
    const object = await storage.updateObject(req.params.id, { deletedAt: new Date(), status: "rejected" });
    res.json(object);
  } catch (error) {
    console.error("Failed to reject object:", error);
    res.status(500).json({ error: "Kunde inte avvisa objekt" });
  }
});

app.delete("/api/objects/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    await storage.deleteObject(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete object:", error);
    res.status(500).json({ error: "Failed to delete object" });
  }
});

}
