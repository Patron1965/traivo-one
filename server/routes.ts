import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";

const importJobs = new Map<string, {
  tenantId: string;
  status: "running" | "completed" | "failed";
  phase: string;
  processed: number;
  total: number;
  created: number;
  updated: number;
  errors: number;
  result?: any;
  listeners: Set<ExpressResponse>;
}>();

function notifyImportProgress(jobId: string) {
  const job = importJobs.get(jobId);
  if (!job) return;
  const data = { status: job.status, phase: job.phase, processed: job.processed, total: job.total, created: job.created, updated: job.updated, errors: job.errors, result: job.result };
  for (const res of job.listeners) {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  }
}
import { db } from "./db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { 
  insertCustomerSchema, insertObjectSchema, insertResourceSchema, 
  insertWorkOrderSchema, insertSetupTimeLogSchema, insertTenantSchema, insertProcurementSchema,
  insertArticleSchema, insertPriceListSchema, insertPriceListArticleSchema, insertResourceArticleSchema,
  insertWorkOrderLineSchema, insertSimulationScenarioSchema, ORDER_STATUSES, type OrderStatus,
  insertVehicleSchema, insertEquipmentSchema, insertResourceVehicleSchema, insertResourceEquipmentSchema,
  insertResourceAvailabilitySchema, insertVehicleScheduleSchema, insertSubscriptionSchema,
  insertTeamSchema, insertTeamMemberSchema, insertPlanningParameterSchema, insertClusterSchema,
  insertMetadataDefinitionSchema, insertObjectMetadataSchema, insertObjectPayerSchema,
  insertObjectImageSchema, insertObjectContactSchema, insertTaskDesiredTimewindowSchema,
  insertTaskDependencySchema, insertTaskInformationSchema, insertStructuralArticleSchema,
  insertVisitConfirmationSchema, insertTechnicianRatingSchema, insertPortalMessageSchema, insertSelfBookingSchema,
  insertFuelLogSchema, insertMaintenanceLogSchema, insertObjectParentSchema,
  type ServiceObject,
  apiUsageLogs, apiBudgets, articles, taskDependencyInstances,
  objects, workOrders
} from "@shared/schema";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { requireTenantWithFallback, getTenantIdWithFallback, requireAdmin, getUserTenants } from "./tenant-middleware";
import multer from "multer";
import Papa from "papaparse";
import { notificationService } from "./notifications";
import { handleMcpSse, handleMcpMessage } from "./mcp";
import { hashPassword } from "./password";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { anomalyMonitor } from "./anomaly-monitor";
import { startWeeklyReportScheduler, generateAndSendWeeklyReports } from "./weekly-report";
import { sendEmail } from "./replit_integrations/resend";
import { createInheritanceProcessor } from "./inheritance-processor";
import { metadataRouter } from "./metadata-routes";
import { getArticleMetadataForObject, writeArticleMetadataOnObject, createMetadata, getAllMetadataTypes } from "./metadata-queries";
import { handleWorkOrderStatusChange, getCommunicationLog, sendETAUpdate, getAutoNotificationSettings } from "./ai-communication";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for large Modus exports
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Endast CSV-filer är tillåtna'));
    }
  }
});

const DEFAULT_TENANT_ID = "default-tenant";

function formatZodError(error: z.ZodError): { error: string; details: Array<{ field: string; message: string }> } {
  const details = error.errors.map(e => ({
    field: e.path.join('.') || 'unknown',
    message: e.message,
  }));
  const summary = details.map(d => `${d.field}: ${d.message}`).join(', ');
  return { error: `Valideringsfel: ${summary}`, details };
}

async function ensureDefaultTenant() {
  return storage.ensureTenant(DEFAULT_TENANT_ID, {
    name: "Kinab AB",
    orgNumber: "556789-1234",
    contactEmail: "info@kinab.se",
    contactPhone: "+46701234567",
    settings: {},
  });
}

function getDateFromWeekdayInMonth(year: number, month: number, weekNumber: number, weekday: number): Date | null {
  const firstDay = new Date(year, month, 1);
  let dayOfWeek = firstDay.getDay();
  let diff = weekday - dayOfWeek;
  if (diff < 0) diff += 7;
  const firstOccurrence = 1 + diff;
  const targetDay = firstOccurrence + (weekNumber - 1) * 7;
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (targetDay > lastDay) return null;
  return new Date(year, month, targetDay);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize WebSocket notification service
  notificationService.initialize(httpServer);
  
  // Start anomaly monitoring (runs every 5 minutes)
  anomalyMonitor.start();
  
  // Start weekly report scheduler (Fridays 16:00)
  startWeeklyReportScheduler();
  
  await setupAuth(app);
  registerAuthRoutes(app);
  
  await ensureDefaultTenant();

  // Tenant discovery endpoint - must be registered BEFORE tenant middleware
  // so authenticated-but-unassigned users can discover their tenant assignments
  app.get("/api/me/tenant", async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.claims?.sub) {
        // Unauthenticated: return default tenant info for demo/initial access
        return res.json({ tenantId: "default-tenant", role: "user", tenants: [] });
      }
      
      const tenants = await getUserTenants(user.claims.sub);
      
      // If user has tenant assignment, return their primary tenant
      if (tenants.length > 0) {
        res.json({
          tenantId: tenants[0].tenantId,
          role: tenants[0].role,
          tenantName: tenants[0].tenantName,
          tenants,
        });
      } else {
        // Authenticated but not assigned to any tenant - allow them to see they need assignment
        res.json({
          tenantId: null,
          role: null,
          tenantName: null,
          tenants: [],
          message: "Du är inte kopplad till någon organisation ännu. Kontakta administratör."
        });
      }
    } catch (error) {
      console.error("Failed to fetch tenant info:", error);
      res.status(500).json({ error: "Failed to fetch tenant info" });
    }
  });

  // Apply tenant middleware to all API routes EXCEPT portal, mobile, and planner routes
  // Portal routes use token-based auth, mobile routes use Bearer token auth
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/portal") || req.path.startsWith("/mobile") || req.path.startsWith("/planner") || req.path.startsWith("/admin") || req.path.startsWith("/auth")) {
      return next();
    }
    return requireTenantWithFallback(req, res, next);
  });

  // Helper function to verify tenant ownership of a resource
  function verifyTenantOwnership<T extends { tenantId: string }>(
    resource: T | undefined,
    requestTenantId: string
  ): T | null {
    if (!resource) return null;
    if (resource.tenantId !== requestTenantId) {
      return null; // Return null to trigger 404 - don't reveal existence to other tenants
    }
    return resource;
  }

  // Object Storage routes for file uploads
  registerObjectStorageRoutes(app);

  // MCP Server endpoints
  app.get("/mcp/sse", handleMcpSse);
  app.post("/mcp/messages", handleMcpMessage);

  // Metadata EAV routes (Mats vision)
  app.use("/api/metadata", metadataRouter);

  app.get("/api/customers", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const customers = await storage.getCustomers(tenantId);
      res.json(customers);
    } catch (error) {
      console.error("Failed to fetch customers:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
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
      const customerId = req.query.customerId as string || undefined;
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
      
      // If paginated request
      if (req.query.limit || req.query.offset || req.query.search || req.query.customerId || noCluster) {
        const result = await storage.getObjectsPaginated(tenantId, limit, offset, search, customerId);
        
        // Filter out objects that already have a cluster
        if (noCluster) {
          const filtered = result.objects.filter((obj: any) => !obj.clusterId);
          res.json(filtered);
        } else {
          res.json(result);
        }
      } else {
        // Legacy: return all objects (for backward compatibility)
        const objects = await storage.getObjects(tenantId);
        res.json(objects);
      }
    } catch (error) {
      console.error("Failed to fetch objects:", error);
      res.status(500).json({ error: "Failed to fetch objects" });
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

  app.get("/api/resources", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resources = await storage.getResources(tenantId);
      res.json(resources);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resources" });
    }
  });

  app.get("/api/resources/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.id);
      const verified = verifyTenantOwnership(resource, tenantId);
      if (!verified) return res.status(404).json({ error: "Resource not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource" });
    }
  });

  app.post("/api/resources", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertResourceSchema.parse({ ...req.body, tenantId });
      const resource = await storage.createResource(data);
      res.status(201).json(resource);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create resource:", error);
      res.status(500).json({ error: "Failed to create resource" });
    }
  });

  app.patch("/api/resources/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResource(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const updateSchema = insertResourceSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
      const resource = await storage.updateResource(req.params.id, updateData);
      if (!resource) return res.status(404).json({ error: "Resource not found" });
      res.json(resource);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update resource:", error);
      res.status(500).json({ error: "Failed to update resource" });
    }
  });

  app.delete("/api/resources/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResource(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      await storage.deleteResource(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete resource:", error);
      res.status(500).json({ error: "Failed to delete resource" });
    }
  });

  app.get("/api/work-orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const includeUnscheduled = req.query.includeUnscheduled === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
      const status = req.query.status as string || undefined;
      const paginated = req.query.paginated === 'true';

      if (paginated || offset !== undefined) {
        const result = await storage.getWorkOrdersPaginated(
          tenantId, 
          limit || 50, 
          offset || 0, 
          startDate, 
          endDate, 
          includeUnscheduled,
          status
        );
        res.json(result);
      } else {
        const defaultLimit = limit || 500;
        const workOrders = await storage.getWorkOrders(tenantId, startDate, endDate, includeUnscheduled, defaultLimit);
        res.json(workOrders);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work orders" });
    }
  });

  app.get("/api/work-orders/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      const verified = verifyTenantOwnership(workOrder, tenantId);
      if (!verified) return res.status(404).json({ error: "Work order not found" });
      
      // Enrich with customer and object information
      const [customer, object] = await Promise.all([
        verified.customerId ? storage.getCustomer(verified.customerId) : null,
        verified.objectId ? storage.getObject(verified.objectId) : null,
      ]);
      
      res.json({
        ...verified,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        customerEmail: customer?.email,
        objectName: object?.name,
        objectAddress: object?.address,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work order" });
    }
  });

  app.get("/api/resources/:resourceId/work-orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const workOrders = await storage.getWorkOrdersByResource(req.params.resourceId, startDate, endDate);
      res.json(workOrders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work orders" });
    }
  });

  app.post("/api/work-orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      // Convert scheduledDate string to Date object if present
      const bodyData = { ...req.body };
      if (bodyData.scheduledDate && typeof bodyData.scheduledDate === 'string') {
        // Handle both ISO strings and simple date strings
        const dateStr = bodyData.scheduledDate;
        if (dateStr.includes('T')) {
          // Already an ISO string - parse directly
          bodyData.scheduledDate = new Date(dateStr);
        } else {
          // Simple date string (YYYY-MM-DD) - add time to prevent timezone shift
          bodyData.scheduledDate = new Date(dateStr + 'T12:00:00Z');
        }
      }
      
      // Default orderStatus to 'skapad' for new orders
      const data = insertWorkOrderSchema.parse({ 
        orderStatus: 'skapad',
        isSimulated: false,
        ...bodyData, 
        tenantId 
      });
      const workOrder = await storage.createWorkOrder(data);
      
      // Notify resource if order is assigned immediately
      if (workOrder.resourceId) {
        notificationService.notifyJobAssigned(workOrder, workOrder.resourceId);
      }
      
      res.status(201).json(workOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create work order" });
    }
  });

  app.patch("/api/work-orders/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
      
      // Get existing order to detect changes and verify ownership
      const existingOrder = await storage.getWorkOrder(req.params.id);
      if (!existingOrder || !verifyTenantOwnership(existingOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      
      // Convert scheduledDate string to Date object if present
      if (updateData.scheduledDate && typeof updateData.scheduledDate === 'string') {
        const dateStr = updateData.scheduledDate;
        if (dateStr.includes('T')) {
          updateData.scheduledDate = new Date(dateStr);
        } else {
          updateData.scheduledDate = new Date(dateStr + 'T12:00:00Z');
        }
      }
      
      const workOrder = await storage.updateWorkOrder(req.params.id, updateData);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      
      // Send notifications based on what changed
      const newResourceId = workOrder.resourceId;
      const oldResourceId = existingOrder.resourceId;
      
      // New assignment
      if (newResourceId && newResourceId !== oldResourceId) {
        notificationService.notifyJobAssigned(workOrder, newResourceId);
        
        // Notify old resource if order was reassigned
        if (oldResourceId) {
          notificationService.notifyJobCancelled(existingOrder, oldResourceId);
        }
      }
      
      // Schedule change
      if (newResourceId && updateData.scheduledDate !== undefined) {
        const oldDate = existingOrder.scheduledDate?.toISOString().split('T')[0];
        const newDate = workOrder.scheduledDate?.toISOString().split('T')[0];
        if (oldDate !== newDate) {
          notificationService.notifyScheduleChanged(workOrder, newResourceId, oldDate, newDate);
        }
      }
      
      // Priority change
      if (newResourceId && updateData.priority && updateData.priority !== existingOrder.priority) {
        notificationService.notifyPriorityChanged(workOrder, newResourceId, existingOrder.priority);
      }
      
      if (updateData.executionStatus === "completed" && existingOrder.executionStatus !== "completed" && workOrder.objectId) {
        try {
          const lines = await storage.getWorkOrderLines(workOrder.id);
          for (const line of lines) {
            if (line.articleId) {
              const article = await db.query.articles.findFirst({
                where: and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)),
              });
              if (article?.leaveMetadataCode) {
                let coercedValue: string = "";
                if (article.leaveMetadataFormat === "timestamp") {
                  coercedValue = new Date().toISOString();
                } else if (article.leaveMetadataFormat === "boolean_true") {
                  coercedValue = "true";
                } else if (article.leaveMetadataFormat === "counter_increment") {
                  const current = await getArticleMetadataForObject(workOrder.objectId, article.leaveMetadataCode, tenantId);
                  const currentNum = parseInt(current?.value || "0") || 0;
                  coercedValue = String(currentNum + 1);
                } else {
                  coercedValue = new Date().toISOString();
                }
                await writeArticleMetadataOnObject(
                  workOrder.objectId,
                  article.leaveMetadataCode,
                  coercedValue,
                  tenantId,
                  `auto:${workOrder.id}`
                );
                console.log(`[metadata-writeback] Auto-wrote ${article.leaveMetadataCode}=${coercedValue} (format=${article.leaveMetadataFormat || 'default'}) on object ${workOrder.objectId} from work order ${workOrder.id}`);
              }
            }
          }
        } catch (metaErr) {
          console.error("[metadata-writeback] Error during auto-writeback:", metaErr);
        }
      }

      // General update (if resource is assigned and update doesn't fall into other categories)
      const isAssignmentChange = newResourceId !== oldResourceId;
      const isScheduleChange = updateData.scheduledDate !== undefined && 
        existingOrder.scheduledDate?.toISOString().split('T')[0] !== workOrder.scheduledDate?.toISOString().split('T')[0];
      const isPriorityChange = updateData.priority && updateData.priority !== existingOrder.priority;
      
      if (newResourceId && !isAssignmentChange && !isScheduleChange && !isPriorityChange) {
        // General update - status, notes, etc.
        const changes: string[] = [];
        if (updateData.status && updateData.status !== existingOrder.status) {
          changes.push(`status ändrad till ${updateData.status}`);
        }
        if (updateData.notes !== undefined && updateData.notes !== existingOrder.notes) {
          changes.push("anteckningar uppdaterade");
        }
        if (updateData.description !== undefined && updateData.description !== existingOrder.description) {
          changes.push("beskrivning uppdaterad");
        }
        if (changes.length > 0) {
          notificationService.notifyJobUpdated(workOrder, newResourceId, `${workOrder.title}: ${changes.join(", ")}`);
        }
      }
      
      const statusChanged = updateData.status && updateData.status !== existingOrder.status;
      const execStatusChanged = updateData.executionStatus && updateData.executionStatus !== existingOrder.executionStatus;
      if (statusChanged || execStatusChanged) {
        const oldSt = existingOrder.executionStatus || existingOrder.status;
        const newSt = updateData.executionStatus || updateData.status || "";
        handleWorkOrderStatusChange(workOrder.id, oldSt, newSt, tenantId).catch(err => 
          console.error("[ai-communication] Event hook error:", err)
        );
      }

      res.json(workOrder);
    } catch (error) {
      console.error("Failed to update work order:", error);
      res.status(500).json({ error: "Failed to update work order" });
    }
  });

  app.delete("/api/work-orders/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getWorkOrder(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      await storage.deleteWorkOrder(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete work order" });
    }
  });

  // Order Stock - aggregated view with filters and server-side pagination
  app.get("/api/order-stock", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const includeSimulated = req.query.includeSimulated === "true";
      const scenarioId = req.query.scenarioId as string | undefined;
      const orderStatus = req.query.orderStatus as OrderStatus | undefined;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50;
      const search = req.query.search as string | undefined;
      
      // Parse metadata filters: metadataFilter=Volym:gt:600,Antal:eq:4
      let metadataFilters: { metadataName: string; operator: string; value: string }[] | undefined;
      const metadataFilterRaw = req.query.metadataFilter as string | undefined;
      if (metadataFilterRaw) {
        metadataFilters = metadataFilterRaw.split(",").map(f => {
          const parts = f.split(":");
          return { metadataName: parts[0], operator: parts[1] || 'eq', value: parts.slice(2).join(":") };
        }).filter(f => f.metadataName && f.value);
      }
      
      const { orders, total, byStatus, aggregates } = await storage.getOrderStock(tenantId, {
        includeSimulated,
        scenarioId,
        orderStatus,
        startDate,
        endDate,
        page,
        pageSize,
        search,
        metadataFilters,
      });
      
      // Summary with SQL-aggregated values from entire filtered dataset
      const summary = {
        totalOrders: total,
        totalValue: aggregates.totalValue,
        totalCost: aggregates.totalCost,
        totalProductionMinutes: aggregates.totalProductionMinutes,
        byStatus
      };
      
      res.json({ orders, summary, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
    } catch (error) {
      console.error("Failed to fetch order stock:", error);
      res.status(500).json({ error: "Failed to fetch order stock" });
    }
  });

  // Work Order Status Transitions
  app.post("/api/work-orders/:id/status", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getWorkOrder(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      
      const { status } = req.body;
      
      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${ORDER_STATUSES.join(", ")}` });
      }
      
      const workOrder = await storage.updateWorkOrderStatus(req.params.id, status);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      res.json(workOrder);
    } catch (error) {
      // Handle sequential validation error with proper 4xx response
      if (error instanceof Error && error.message.includes("Invalid status transition")) {
        return res.status(409).json({ error: error.message });
      }
      console.error("Failed to update work order status:", error);
      res.status(500).json({ error: "Failed to update work order status" });
    }
  });

  // Work Order Lines
  app.get("/api/work-orders/:workOrderId/lines", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const lines = await storage.getWorkOrderLines(req.params.workOrderId);
      
      // Enrich with article details
      const enrichedLines = await Promise.all(lines.map(async (line) => {
        const article = line.articleId ? await storage.getArticle(line.articleId) : null;
        return {
          ...line,
          articleName: article?.name || "Okänd artikel",
          articleDescription: article?.description,
        };
      }));
      
      res.json(enrichedLines);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work order lines" });
    }
  });

  app.post("/api/work-orders/:workOrderId/lines", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      
      const { articleId, quantity = 1, isOptional = false, notes } = req.body;
      
      if (!articleId) {
        return res.status(400).json({ error: "articleId is required" });
      }
      
      // Resolve price using the hierarchy
      const priceInfo = await storage.resolveArticlePrice(
        tenantId,
        articleId,
        workOrder.customerId
      );
      
      const lineData = insertWorkOrderLineSchema.parse({
        tenantId,
        workOrderId: req.params.workOrderId,
        articleId,
        quantity,
        resolvedPrice: priceInfo.price,
        resolvedCost: priceInfo.cost,
        resolvedProductionMinutes: priceInfo.productionMinutes,
        priceListIdUsed: priceInfo.priceListId,
        priceSource: priceInfo.source,
        isOptional,
        notes
      });
      
      const line = await storage.createWorkOrderLine(lineData);
      
      // Recalculate work order totals
      await storage.recalculateWorkOrderTotals(req.params.workOrderId);
      
      res.status(201).json(line);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create work order line:", error);
      res.status(500).json({ error: "Failed to create work order line" });
    }
  });

  app.patch("/api/work-order-lines/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existingLine = await storage.getWorkOrderLine(req.params.id);
      if (!existingLine) return res.status(404).json({ error: "Work order line not found" });
      
      // Verify the parent work order belongs to the tenant
      const workOrder = await storage.getWorkOrder(existingLine.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order line not found" });
      }
      
      const updateSchema = insertWorkOrderLineSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { id: _id, tenantId: _t, workOrderId: _w, createdAt: _c, ...updateData } = parseResult.data as any;
      const line = await storage.updateWorkOrderLine(req.params.id, updateData);
      if (!line) return res.status(404).json({ error: "Work order line not found" });
      
      // Recalculate work order totals
      if (line.workOrderId) {
        await storage.recalculateWorkOrderTotals(line.workOrderId);
      }
      
      res.json(line);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to update work order line" });
    }
  });

  app.delete("/api/work-order-lines/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      // Get the line first to know which work order to recalculate
      const line = await storage.getWorkOrderLine(req.params.id);
      if (!line) return res.status(404).json({ error: "Work order line not found" });
      
      // Verify the parent work order belongs to the tenant
      const workOrder = await storage.getWorkOrder(line.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order line not found" });
      }
      
      await storage.deleteWorkOrderLine(req.params.id);
      
      // Recalculate work order totals if we found the line
      if (line?.workOrderId) {
        await storage.recalculateWorkOrderTotals(line.workOrderId);
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete work order line" });
    }
  });

  // Work Order Objects - multiple objects per work order
  app.get("/api/work-orders/:workOrderId/objects", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const objects = await storage.getWorkOrderObjects(req.params.workOrderId);
      res.json(objects);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work order objects" });
    }
  });

  app.post("/api/work-orders/:workOrderId/objects", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      
      const { objectId, isPrimary, sortOrder, notes } = req.body;
      if (!objectId) {
        return res.status(400).json({ error: "objectId is required" });
      }
      
      // Verify the object belongs to the tenant
      const object = await storage.getObject(objectId);
      if (!verifyTenantOwnership(object, tenantId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      
      // Check for duplicate before inserting
      const existingObjects = await storage.getWorkOrderObjects(req.params.workOrderId);
      const isDuplicate = existingObjects.some(o => o.objectId === objectId);
      if (isDuplicate) {
        return res.status(400).json({ error: "Object is already linked to this work order" });
      }
      
      const workOrderObject = await storage.createWorkOrderObject({
        tenantId,
        workOrderId: req.params.workOrderId,
        objectId,
        isPrimary: isPrimary || false,
        sortOrder: sortOrder || 0,
        notes
      });
      
      res.status(201).json(workOrderObject);
    } catch (error) {
      console.error("Failed to add object to work order:", error);
      res.status(500).json({ error: "Failed to add object to work order" });
    }
  });

  app.delete("/api/work-order-objects/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrderObject = await storage.getWorkOrderObject(req.params.id);
      if (!workOrderObject) {
        return res.status(404).json({ error: "Work order object not found" });
      }
      
      // Verify via the work order
      const workOrder = await storage.getWorkOrder(workOrderObject.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order object not found" });
      }
      
      await storage.deleteWorkOrderObject(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete work order object" });
    }
  });

  // Price Resolution API
  app.get("/api/resolve-price", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { articleId, customerId, date } = req.query;
      
      if (!articleId || !customerId) {
        return res.status(400).json({ error: "articleId and customerId are required" });
      }
      
      const priceInfo = await storage.resolveArticlePrice(
        tenantId,
        articleId as string,
        customerId as string,
        date ? new Date(date as string) : undefined
      );
      
      res.json(priceInfo);
    } catch (error) {
      res.status(500).json({ error: "Failed to resolve price" });
    }
  });

  // Simulation Scenarios
  app.get("/api/simulation-scenarios", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const scenarios = await storage.getSimulationScenarios(tenantId);
      res.json(scenarios);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch simulation scenarios" });
    }
  });

  app.get("/api/simulation-scenarios/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const scenario = await storage.getSimulationScenario(req.params.id);
      const verified = verifyTenantOwnership(scenario, tenantId);
      if (!verified) return res.status(404).json({ error: "Simulation scenario not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch simulation scenario" });
    }
  });

  app.post("/api/simulation-scenarios", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertSimulationScenarioSchema.parse({ ...req.body, tenantId });
      const scenario = await storage.createSimulationScenario(data);
      res.status(201).json(scenario);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create simulation scenario" });
    }
  });

  app.patch("/api/simulation-scenarios/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getSimulationScenario(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Simulation scenario not found" });
      }
      const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
      const scenario = await storage.updateSimulationScenario(req.params.id, updateData);
      if (!scenario) return res.status(404).json({ error: "Simulation scenario not found" });
      res.json(scenario);
    } catch (error) {
      res.status(500).json({ error: "Failed to update simulation scenario" });
    }
  });

  app.delete("/api/simulation-scenarios/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getSimulationScenario(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Simulation scenario not found" });
      }
      await storage.deleteSimulationScenario(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete simulation scenario" });
    }
  });

  // Clone orders to simulation scenario
  app.post("/api/simulation-scenarios/:id/clone-orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { orderIds } = req.body;
      const scenarioId = req.params.id;
      
      const scenario = await storage.getSimulationScenario(scenarioId);
      if (!verifyTenantOwnership(scenario, tenantId)) {
        return res.status(404).json({ error: "Simulation scenario not found" });
      }
      
      const clonedOrders = [];
      for (const orderId of orderIds) {
        const original = await storage.getWorkOrder(orderId);
        if (!original) continue;
        
        const tenantId = getTenantIdWithFallback(req);
        // Clone the order with simulation flag
        const clonedOrder = await storage.createWorkOrder({
          tenantId,
          customerId: original.customerId,
          objectId: original.objectId,
          resourceId: original.resourceId,
          title: `[SIM] ${original.title}`,
          description: original.description,
          orderType: original.orderType,
          priority: original.priority,
          orderStatus: 'skapad',
          scheduledDate: original.scheduledDate,
          scheduledStartTime: original.scheduledStartTime,
          estimatedDuration: original.estimatedDuration,
          isSimulated: true,
          simulationScenarioId: scenarioId,
          notes: original.notes,
          metadata: original.metadata as Record<string, unknown> | undefined
        });
        
        // Clone the lines
        const lines = await storage.getWorkOrderLines(orderId);
        for (const line of lines) {
          await storage.createWorkOrderLine({
            tenantId,
            workOrderId: clonedOrder.id,
            articleId: line.articleId,
            quantity: line.quantity,
            resolvedPrice: line.resolvedPrice,
            resolvedCost: line.resolvedCost,
            resolvedProductionMinutes: line.resolvedProductionMinutes,
            priceListIdUsed: line.priceListIdUsed,
            isOptional: line.isOptional,
            notes: line.notes
          });
        }
        
        // Recalculate totals
        await storage.recalculateWorkOrderTotals(clonedOrder.id);
        clonedOrders.push(clonedOrder);
      }
      
      res.status(201).json({ clonedOrders, count: clonedOrders.length });
    } catch (error) {
      console.error("Failed to clone orders:", error);
      res.status(500).json({ error: "Failed to clone orders to scenario" });
    }
  });

  // Promote simulated order to real
  app.post("/api/work-orders/:id/promote", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      
      if (!workOrder.isSimulated) {
        return res.status(400).json({ error: "Order is not simulated" });
      }
      
      // Remove simulation flag and scenario link, update title
      const updatedTitle = workOrder.title?.replace(/^\[SIM\] /, "") || workOrder.title;
      const promoted = await storage.updateWorkOrder(req.params.id, {
        isSimulated: false,
        simulationScenarioId: null,
        title: updatedTitle
      });
      
      res.json(promoted);
    } catch (error) {
      res.status(500).json({ error: "Failed to promote simulated order" });
    }
  });

  app.post("/api/setup-time-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertSetupTimeLogSchema.parse({ ...req.body, tenantId });
      const log = await storage.createSetupTimeLog(data);
      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create setup time log" });
    }
  });

  app.get("/api/setup-time-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const objectId = req.query.objectId as string | undefined;
      const logs = await storage.getSetupTimeLogs(tenantId, objectId);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch setup time logs" });
    }
  });

  app.get("/api/procurements", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const procurements = await storage.getProcurements(tenantId);
      res.json(procurements);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch procurements" });
    }
  });

  app.get("/api/procurements/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const procurement = await storage.getProcurement(req.params.id);
      const verified = verifyTenantOwnership(procurement, tenantId);
      if (!verified) return res.status(404).json({ error: "Procurement not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch procurement" });
    }
  });

  app.post("/api/procurements", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertProcurementSchema.parse({ ...req.body, tenantId });
      const procurement = await storage.createProcurement(data);
      res.status(201).json(procurement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create procurement" });
    }
  });

  app.patch("/api/procurements/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getProcurement(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Procurement not found" });
      }
      const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
      const procurement = await storage.updateProcurement(req.params.id, updateData);
      if (!procurement) return res.status(404).json({ error: "Procurement not found" });
      res.json(procurement);
    } catch (error) {
      res.status(500).json({ error: "Failed to update procurement" });
    }
  });

  app.delete("/api/procurements/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getProcurement(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Procurement not found" });
      }
      await storage.deleteProcurement(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete procurement" });
    }
  });

  // Import endpoints
  app.post("/api/import/customers", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors });
      }
      
      const imported: string[] = [];
      const errors: string[] = [];
      
      for (const row of result.data as Record<string, string>[]) {
        try {
          const tenantId = getTenantIdWithFallback(req);
          const customerData = {
            tenantId,
            name: row.name || row.namn || row.Namn || "",
            customerNumber: row.customerNumber || row.kundnummer || row.Kundnummer || null,
            contactPerson: row.contactPerson || row.kontaktperson || row.Kontaktperson || null,
            email: row.email || row.epost || row.Epost || null,
            phone: row.phone || row.telefon || row.Telefon || null,
            address: row.address || row.adress || row.Adress || null,
            city: row.city || row.stad || row.Stad || null,
            postalCode: row.postalCode || row.postnummer || row.Postnummer || null,
          };
          
          if (!customerData.name) {
            errors.push(`Rad saknar namn`);
            continue;
          }
          
          await storage.createCustomer(customerData);
          imported.push(customerData.name);
        } catch (err) {
          errors.push(`Kunde inte importera: ${row.name || row.namn || "okänd"}`);
        }
      }
      
      res.json({ imported: imported.length, errors });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Import misslyckades" });
    }
  });

  app.post("/api/import/resources", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors });
      }
      
      const imported: string[] = [];
      const errors: string[] = [];
      
      for (const row of result.data as Record<string, string>[]) {
        try {
          const tenantId = getTenantIdWithFallback(req);
          const resourceData = {
            tenantId,
            name: row.name || row.namn || row.Namn || "",
            initials: row.initials || row.initialer || row.Initialer || null,
            phone: row.phone || row.telefon || row.Telefon || null,
            email: row.email || row.epost || row.Epost || null,
            homeLocation: row.homeLocation || row.hemort || row.Hemort || null,
            weeklyHours: row.weeklyHours ? parseInt(row.weeklyHours) : (row.timmar ? parseInt(row.timmar) : 40),
            competencies: row.competencies || row.kompetenser ? 
              (row.competencies || row.kompetenser || "").split(",").map((s: string) => s.trim()) : [],
          };
          
          if (!resourceData.name) {
            errors.push(`Rad saknar namn`);
            continue;
          }
          
          await storage.createResource(resourceData);
          imported.push(resourceData.name);
        } catch (err) {
          errors.push(`Kunde inte importera: ${row.name || row.namn || "okänd"}`);
        }
      }
      
      res.json({ imported: imported.length, errors });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Import misslyckades" });
    }
  });

  app.post("/api/import/objects", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors });
      }
      
      // First, get all customers to map names to IDs
      const tenantId = getTenantIdWithFallback(req);
      const customers = await storage.getCustomers(tenantId);
      const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
      
      // Track created objects by objectNumber for parent lookups
      const objectNumberMap = new Map<string, string>();
      
      const imported: string[] = [];
      const errors: string[] = [];
      
      // Sort by objectLevel to ensure parents are created first
      const rows = (result.data as Record<string, string>[]).sort((a, b) => {
        const levelA = parseInt(a.objectLevel || a.nivå || a.Nivå || "1");
        const levelB = parseInt(b.objectLevel || b.nivå || b.Nivå || "1");
        return levelA - levelB;
      });
      
      for (const row of rows) {
        try {
          const customerName = row.customer || row.kund || row.Kund || "";
          const customerId = customerMap.get(customerName.toLowerCase());
          
          if (!customerId) {
            errors.push(`Kund "${customerName}" hittades inte för objekt "${row.name || row.namn}"`);
            continue;
          }
          
          const parentNumber = row.parentNumber || row.förälder || row.Förälder || null;
          let parentId = null;
          if (parentNumber) {
            parentId = objectNumberMap.get(parentNumber) || null;
          }
          
          const objectData = {
            tenantId,
            customerId,
            parentId,
            name: row.name || row.namn || row.Namn || "",
            objectNumber: row.objectNumber || row.objektnummer || row.Objektnummer || null,
            objectType: row.objectType || row.typ || row.Typ || "fastighet",
            objectLevel: parseInt(row.objectLevel || row.nivå || row.Nivå || "1"),
            address: row.address || row.adress || row.Adress || null,
            city: row.city || row.stad || row.Stad || null,
            postalCode: row.postalCode || row.postnummer || row.Postnummer || null,
            latitude: row.latitude || row.lat ? parseFloat(row.latitude || row.lat) : null,
            longitude: row.longitude || row.lng || row.lon ? parseFloat(row.longitude || row.lng || row.lon) : null,
            accessType: row.accessType || row.tillgång || row.Tillgång || "open",
            accessCode: row.accessCode || row.portkod || row.Portkod || null,
            keyNumber: row.keyNumber || row.nyckelnummer || row.Nyckelnummer || null,
            containerCount: row.containerCount || row.kärl ? parseInt(row.containerCount || row.kärl || "0") : 0,
            containerCountK2: row.containerCountK2 || row.k2 ? parseInt(row.containerCountK2 || row.k2 || "0") : 0,
            containerCountK3: row.containerCountK3 || row.k3 ? parseInt(row.containerCountK3 || row.k3 || "0") : 0,
            containerCountK4: row.containerCountK4 || row.k4 ? parseInt(row.containerCountK4 || row.k4 || "0") : 0,
          };
          
          if (!objectData.name) {
            errors.push(`Rad saknar namn`);
            continue;
          }
          
          const createdObject = await storage.createObject(objectData);
          
          // Store mapping for parent lookups
          if (objectData.objectNumber) {
            objectNumberMap.set(objectData.objectNumber, createdObject.id);
          }
          
          imported.push(objectData.name);
        } catch (err) {
          console.error("Object import error:", err);
          errors.push(`Kunde inte importera: ${row.name || row.namn || "okänd"}`);
        }
      }
      
      res.json({ imported: imported.length, errors });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Import misslyckades" });
    }
  });

  app.get("/api/tenant", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json(tenant);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tenant" });
    }
  });

  app.patch("/api/tenant", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const tenantUpdateSchema = z.object({
        name: z.string().min(1).optional(),
        orgNumber: z.string().optional(),
        contactEmail: z.string().email().optional().or(z.literal("")),
        contactPhone: z.string().optional(),
        industry: z.string().optional(),
      });
      const parseResult = tenantUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors });
      }
      const tenant = await storage.updateTenant(tenantId, parseResult.data);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json(tenant);
    } catch (error) {
      console.error("Failed to update tenant:", error);
      res.status(500).json({ error: "Failed to update tenant" });
    }
  });

  // Tenant settings
  app.get("/api/tenant/settings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const tenant = await storage.getTenant(tenantId);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json({ id: tenant.id, name: tenant.name, settings: tenant.settings || {} });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/tenant/settings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const settingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]));
      const parseResult = settingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors });
      }
      const tenant = await storage.updateTenantSettings(tenantId, parseResult.data);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json({ id: tenant.id, name: tenant.name, settings: tenant.settings });
    } catch (error) {
      console.error("Failed to update settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Export data as CSV
  app.get("/api/export/:type", async (req, res) => {
    try {
      const { type } = req.params;
      let data: Record<string, unknown>[] = [];
      let headers: string[] = [];

      const tenantId = getTenantIdWithFallback(req);
      if (type === "customers") {
        const customers = await storage.getCustomers(tenantId);
        headers = ["namn", "kundnummer", "kontaktperson", "epost", "telefon", "adress", "stad", "postnummer"];
        data = customers.map(c => ({
          namn: c.name,
          kundnummer: c.customerNumber || "",
          kontaktperson: c.contactPerson || "",
          epost: c.email || "",
          telefon: c.phone || "",
          adress: c.address || "",
          stad: c.city || "",
          postnummer: c.postalCode || "",
        }));
      } else if (type === "resources") {
        const resources = await storage.getResources(tenantId);
        headers = ["namn", "initialer", "telefon", "epost", "hemort", "timmar", "kompetenser"];
        data = resources.map(r => ({
          namn: r.name,
          initialer: r.initials || "",
          telefon: r.phone || "",
          epost: r.email || "",
          hemort: r.homeLocation || "",
          timmar: r.weeklyHours || 40,
          kompetenser: (r.competencies || []).join(", "),
        }));
      } else if (type === "objects") {
        const objects = await storage.getObjects(tenantId);
        const customers = await storage.getCustomers(tenantId);
        const customerMap = new Map(customers.map(c => [c.id, c.name]));
        
        headers = ["namn", "objektnummer", "typ", "nivå", "kund", "adress", "stad", "tillgång", "tillgångskod", "kärl"];
        data = objects.map(o => ({
          namn: o.name,
          objektnummer: o.objectNumber || "",
          typ: o.objectType,
          nivå: o.objectLevel,
          kund: customerMap.get(o.customerId) || "",
          adress: o.address || "",
          stad: o.city || "",
          tillgång: o.accessType || "open",
          tillgångskod: o.accessCode || "",
          kärl: o.containerCount || 0,
        }));
      } else {
        return res.status(400).json({ error: "Okänd exporttyp" });
      }

      const csv = [
        headers.join(","),
        ...data.map(row => headers.map(h => `"${(row[h] ?? "").toString().replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=${type}_export.csv`);
      res.send("\ufeff" + csv);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Export misslyckades" });
    }
  });

  // OpenRouteService proxy for route optimization
  app.post("/api/routes/directions", async (req, res) => {
    try {
      const { coordinates } = req.body;
      
      if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
        return res.status(400).json({ error: "At least 2 coordinates required" });
      }

      const apiKey = process.env.OPENROUTESERVICE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "OpenRouteService API key not configured" });
      }

      const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": apiKey,
        },
        body: JSON.stringify({
          coordinates: coordinates,
          instructions: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenRouteService error:", errorText);
        return res.status(response.status).json({ error: "Route calculation failed" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Route directions error:", error);
      res.status(500).json({ error: "Failed to calculate route" });
    }
  });

  // OpenRouteService route optimization (TSP)
  app.post("/api/routes/optimize", async (req, res) => {
    try {
      const { jobs, vehicles } = req.body;
      
      const apiKey = process.env.OPENROUTESERVICE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "OpenRouteService API key not configured" });
      }

      const response = await fetch("https://api.openrouteservice.org/optimization", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": apiKey,
        },
        body: JSON.stringify({
          jobs,
          vehicles,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("OpenRouteService optimization error:", errorText);
        return res.status(response.status).json({ error: "Route optimization failed" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Route optimization error:", error);
      res.status(500).json({ error: "Failed to optimize route" });
    }
  });

  app.get("/api/import/progress/:jobId", (req, res) => {
    const { jobId } = req.params;
    const tenantId = getTenantIdWithFallback(req);
    
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    
    const job = importJobs.get(jobId);
    if (!job || job.tenantId !== tenantId) {
      res.write(`data: ${JSON.stringify({ status: "not_found" })}\n\n`);
      res.end();
      return;
    }
    
    job.listeners.add(res);
    notifyImportProgress(jobId);
    
    req.on("close", () => {
      job.listeners.delete(res);
    });
  });

  app.post("/api/import/modus/validate", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }

      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        delimiter: ";",
      });

      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
      }

      const rows = result.data as Record<string, string>[];
      const totalRows = rows.length;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      const missingFields: { row: number; fields: string[] }[] = [];
      const duplicateModusIds: { modusId: string; rows: number[] }[] = [];
      const invalidCoordinates: { row: number; lat: string; lng: string }[] = [];
      const warnings: string[] = [];
      const typeStats: Record<string, number> = {};
      let emptyTypeCount = 0;
      let parentWithSpaces = 0;

      const modusIdOccurrences = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        const missing: string[] = [];
        if (!row["Id"]?.trim()) missing.push("Id");
        if (!row["Namn"]?.trim()) missing.push("Namn");
        if (missing.length > 0) {
          missingFields.push({ row: rowNum, fields: missing });
        }

        const rawModusId = (row["Id"] || "").trim();
        const modusId = rawModusId.replace(/\s/g, "");
        if (modusId) {
          if (!modusIdOccurrences.has(modusId)) {
            modusIdOccurrences.set(modusId, []);
          }
          modusIdOccurrences.get(modusId)!.push(rowNum);
        }

        const typ = (row["Typ"] || "").trim();
        if (typ) {
          typeStats[typ] = (typeStats[typ] || 0) + 1;
        } else {
          emptyTypeCount++;
        }

        const rawParent = (row["Parent"] || "").trim();
        if (rawParent && rawParent !== rawParent.replace(/\s/g, "")) {
          parentWithSpaces++;
        }

        const latStr = (row["Latitud"] || "").trim();
        const lngStr = (row["Longitud"] || "").trim();
        if (latStr || lngStr) {
          const lat = parseFloat(latStr.replace(",", "."));
          const lng = parseFloat(lngStr.replace(",", "."));
          if (latStr && (isNaN(lat) || lat < 55 || lat > 70)) {
            invalidCoordinates.push({ row: rowNum, lat: latStr, lng: lngStr });
          } else if (lngStr && (isNaN(lng) || lng < 10 || lng > 25)) {
            invalidCoordinates.push({ row: rowNum, lat: latStr, lng: lngStr });
          }
        }
      }

      for (const [modusId, rowNums] of modusIdOccurrences) {
        if (rowNums.length > 1) {
          duplicateModusIds.push({ modusId, rows: rowNums });
        }
      }

      const customerNames = new Set<string>();
      for (const row of rows) {
        const kundName = row["Kund"];
        if (kundName) {
          const match = kundName.match(/^(.+?)\s*\(\d+\)$/);
          const cleanName = match ? match[1].trim() : kundName.trim();
          if (cleanName) customerNames.add(cleanName);
        }
      }

      const tenantId = getTenantIdWithFallback(req);
      const existingCustomers = await storage.getCustomers(tenantId);
      const existingCustomerNames = new Set(existingCustomers.map(c => c.name.toLowerCase()));

      const customersExisting: string[] = [];
      const customersNew: string[] = [];
      for (const name of Array.from(customerNames)) {
        if (existingCustomerNames.has(name.toLowerCase())) {
          customersExisting.push(name);
        } else {
          customersNew.push(name);
        }
      }

      const existingObjects = await storage.getObjects(tenantId);
      const existingObjectNumbers = new Set(existingObjects.map(o => o.objectNumber?.toLowerCase()).filter(Boolean));

      let objectsExisting = 0;
      let objectsNew = 0;
      for (const row of rows) {
        const modusId = (row["Id"] || "").trim().replace(/\s/g, "");
        if (modusId) {
          const objNumber = `MODUS-${modusId}`.toLowerCase();
          if (existingObjectNumbers.has(objNumber)) {
            objectsExisting++;
          } else {
            objectsNew++;
          }
        }
      }

      const parentIds = new Set<string>();
      const allIds = new Set<string>();
      for (const row of rows) {
        const id = (row["Id"] || "").trim().replace(/\s/g, "");
        const parent = (row["Parent"] || "").trim().replace(/\s/g, "");
        if (id) allIds.add(id);
        if (parent) parentIds.add(parent);
      }
      const missingParents: string[] = [];
      for (const pid of parentIds) {
        if (!allIds.has(pid)) {
          const existsInDb = existingObjectNumbers.has(`MODUS-${pid}`.toLowerCase());
          if (!existsInDb) {
            missingParents.push(pid);
          }
        }
      }
      if (missingParents.length > 0) {
        warnings.push(`${missingParents.length} föräldra-ID:n refereras men finns varken i CSV:n eller databasen`);
      }
      if (parentWithSpaces > 0) {
        warnings.push(`${parentWithSpaces} föräldra-ID:n innehåller mellanslag (rensas automatiskt vid import)`);
      }
      if (emptyTypeCount > 0) {
        warnings.push(`${emptyTypeCount} objekt saknar typ (importeras som "Område")`);
      }

      const metadataColumns: string[] = [];
      if (rows.length > 0) {
        for (const key of Object.keys(rows[0])) {
          if (key.startsWith("Metadata - ")) {
            metadataColumns.push(key.replace("Metadata - ", "").trim());
          }
        }
      }

      res.json({
        totalRows,
        columns,
        missingFields: missingFields.slice(0, 50),
        missingFieldsCount: missingFields.length,
        duplicateModusIds: duplicateModusIds.slice(0, 50),
        duplicateModusIdsCount: duplicateModusIds.length,
        invalidCoordinates: invalidCoordinates.slice(0, 50),
        invalidCoordinatesCount: invalidCoordinates.length,
        customersExisting,
        customersNew,
        objectsExisting,
        objectsNew,
        missingParents: missingParents.slice(0, 20),
        metadataColumns,
        warnings,
        typeStats,
        emptyTypeCount,
      });
    } catch (error) {
      console.error("Modus validate error:", error);
      res.status(500).json({ error: "Validering misslyckades", details: String(error) });
    }
  });

  // Modus 2.0 Import - Objects (semicolon-separated)
  app.post("/api/import/modus/objects", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { 
        header: true, 
        skipEmptyLines: true,
        delimiter: ";",
      });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
      }

      const customerNames = new Set<string>();
      for (const row of result.data as Record<string, string>[]) {
        const kundName = row["Kund"];
        if (kundName) {
          const match = kundName.match(/^(.+?)\s*\(\d+\)$/);
          const cleanName = match ? match[1].trim() : kundName.trim();
          if (cleanName) customerNames.add(cleanName);
        }
      }

      const tenantId = getTenantIdWithFallback(req);
      const importBatchId = crypto.randomUUID();
      const totalRows = (result.data as unknown[]).length;
      
      importJobs.set(importBatchId, { tenantId, status: "running", phase: "kunder", processed: 0, total: totalRows, created: 0, updated: 0, errors: 0, listeners: new Set() });
      
      res.json({ importBatchId, status: "started", totalRows });
      
      // Continue import in background
      
      const existingCustomers = await storage.getCustomers(tenantId);
      const customerMap = new Map(existingCustomers.map(c => [c.name.toLowerCase(), c.id]));
      
      for (const name of Array.from(customerNames)) {
        if (!customerMap.has(name.toLowerCase())) {
          const newCustomer = await storage.createCustomer({
            tenantId,
            name: name,
            importBatchId,
          });
          customerMap.set(name.toLowerCase(), newCustomer.id);
        }
      }

      const job = importJobs.get(importBatchId)!;
      job.phase = "objekt";
      notifyImportProgress(importBatchId);
      
      const modusIdMap = new Map<string, string>();
      const created: string[] = [];
      const updated: string[] = [];
      const errors: string[] = [];
      const skipped: string[] = [];
      
      for (const row of result.data as Record<string, string>[]) {
        try {
          const modusId = (row["Id"] || "").replace(/\s/g, "");
          const name = row["Namn"] || "";
          const typ = row["Typ"] || "Område";
          const parent = (row["Parent"] || "").replace(/\s/g, "");
          const kundRaw = row["Kund"] || "";
          
          if (!name || !modusId) {
            skipped.push(`Rad utan namn eller ID`);
            continue;
          }
          
          // Extract customer name
          const kundMatch = kundRaw.match(/^(.+?)\s*\(\d+\)$/);
          const kundName = kundMatch ? kundMatch[1].trim() : kundRaw.trim();
          const customerId = customerMap.get(kundName.toLowerCase());
          
          if (!customerId) {
            errors.push(`Kund "${kundName}" hittades inte för "${name}"`);
            continue;
          }
          
          // Parse coordinates
          let latitude = row["Latitud"] ? parseFloat(row["Latitud"].replace(",", ".")) : null;
          let longitude = row["Longitud"] ? parseFloat(row["Longitud"].replace(",", ".")) : null;
          
          // Validate coordinates (Sweden approximate bounds)
          if (latitude && (latitude < 55 || latitude > 70)) latitude = null;
          if (longitude && (longitude < 10 || longitude > 25)) longitude = null;
          
          // Map object type (matches real Modus export: Område, Fastighet / Byggnad, Miljörum, Miljökärl, Underjordsbehållare)
          let objectType = "omrade";
          const typLower = typ.toLowerCase().trim();
          if (typLower.includes("miljökärl") || typLower === "miljokarl") objectType = "miljokarl";
          else if (typLower.includes("miljörum")) objectType = "rum";
          else if (typLower.includes("underjord")) objectType = "underjord";
          else if (typLower.includes("fastighet") || typLower.includes("byggnad") || typLower.includes("adress")) objectType = "fastighet";
          else if (typLower.includes("rum") || typLower.includes("soprum")) objectType = "rum";
          else if (typLower.includes("kök")) objectType = "kok";
          else if (typLower.includes("matavfall")) objectType = "matafall";
          else if (typLower.includes("återvinning")) objectType = "atervinning";
          else if (typLower.includes("uj") || typLower.includes("hushåll")) objectType = "uj_hushallsavfall";
          else if (typLower.includes("serviceboende") || typLower.includes("boende")) objectType = "serviceboende";
          else if (typLower === "område" || typLower === "omrade" || typLower === "") objectType = "omrade";
          
          // Determine access type from metadata
          let accessType = "open";
          let accessCode = null;
          let keyNumber = null;
          const nyckelEllerKod = row["Metadata - Nyckel eller kod"] || "";
          if (nyckelEllerKod) {
            if (nyckelEllerKod.toLowerCase().includes("nyckel")) {
              accessType = "key";
              keyNumber = nyckelEllerKod;
            } else if (/^\d+$/.test(nyckelEllerKod.trim())) {
              accessType = "code";
              accessCode = nyckelEllerKod.trim();
            } else {
              accessType = "code";
              accessCode = nyckelEllerKod;
            }
          }
          
          // Parse container counts
          const antalStr = row["Metadata - Antal"] || "0";
          const containerCount = parseInt(antalStr.replace(/\D/g, "") || "0");
          
          // Parse description for contact info
          const beskrivning = row["Beskrivning"] || "";
          let accessInfo = {};
          if (beskrivning) {
            const lines = beskrivning.split("\n");
            if (lines.length >= 2) {
              accessInfo = {
                contactPerson: lines[1]?.trim() || null,
                phone: lines[2]?.trim() || null,
                email: lines[3]?.trim() || null,
              };
            }
          }
          
          // Determine object level based on type hierarchy
          let objectLevel = 1; // Område = top level
          if (objectType === "fastighet") objectLevel = 2;
          else if (objectType === "rum" || objectType === "miljokarl" || objectType === "underjord" || 
                   objectType === "kok" || objectType === "matafall" || objectType === "atervinning" ||
                   objectType === "uj_hushallsavfall") objectLevel = 3;
          else if (objectType === "omrade" && parent) objectLevel = 2;
          
          const objectNumber = `MODUS-${modusId}`;
          
          const objectFields = {
            customerId,
            parentId: null as string | null,
            name,
            objectNumber,
            objectType,
            objectLevel,
            address: row["Adress 1"] || null,
            city: row["Ort"] || null,
            postalCode: row["Postnummer"] || null,
            latitude,
            longitude,
            accessType,
            accessCode,
            keyNumber,
            accessInfo,
            containerCount,
          };
          
          const existingObject = await storage.getObjectByObjectNumber(tenantId, objectNumber);
          
          if (existingObject) {
            const { parentId: _p, ...updateFields } = objectFields;
            const updatedObject = await storage.updateObject(existingObject.id, updateFields);
            if (updatedObject) {
              modusIdMap.set(modusId, updatedObject.id);
              updated.push(name);
              job.updated++;
            }
          } else {
            const createdObject = await storage.createObject({ tenantId, ...objectFields, importBatchId });
            modusIdMap.set(modusId, createdObject.id);
            created.push(name);
            job.created++;
          }
        } catch (err) {
          console.error("Modus object import error:", err);
          errors.push(`Rad ${row["Id"] || "?"}: ${err}`);
          job.errors++;
        }
        job.processed++;
        if (job.processed % 10 === 0) notifyImportProgress(importBatchId);
      }
      
      job.phase = "hierarki";
      notifyImportProgress(importBatchId);
      
      let parentsUpdated = 0;
      for (const row of result.data as Record<string, string>[]) {
        const modusId = (row["Id"] || "").replace(/\s/g, "");
        const parentModusId = (row["Parent"] || "").replace(/\s/g, "");
        
        if (modusId && parentModusId) {
          const objectId = modusIdMap.get(modusId);
          const parentId = modusIdMap.get(parentModusId);
          
          if (objectId && parentId) {
            await storage.updateObject(objectId, { parentId });
            parentsUpdated++;
          }
        }
      }
      
      job.phase = "metadata";
      notifyImportProgress(importBatchId);
      
      let metadataWritten = 0;
      const metadataErrors: string[] = [];
      
      const metadataTypes = await getAllMetadataTypes(tenantId);
      const metadataTypeMap = new Map(metadataTypes.map(t => [t.namn.toLowerCase(), t]));
      
      // Detect all "Metadata - *" columns from first row
      const firstRow = (result.data as Record<string, string>[])[0];
      const metadataColumns: { csvColumn: string; metadataName: string }[] = [];
      if (firstRow) {
        for (const key of Object.keys(firstRow)) {
          if (key.startsWith("Metadata - ")) {
            const metadataName = key.replace("Metadata - ", "").trim();
            metadataColumns.push({ csvColumn: key, metadataName });
          }
        }
      }
      
      if (metadataColumns.length > 0) {
        for (const row of result.data as Record<string, string>[]) {
          const modusId = (row["Id"] || "").replace(/\s/g, "");
          const objectId = modusId ? modusIdMap.get(modusId) : null;
          if (!objectId) continue;
          
          for (const { csvColumn, metadataName } of metadataColumns) {
            const rawValue = (row[csvColumn] || "").trim();
            if (!rawValue) continue;
            
            try {
              // Find metadata type by name (case-insensitive match)
              const metaType = metadataTypeMap.get(metadataName.toLowerCase());
              if (!metaType) {
                // Auto-create metadata type if not found
                const { metadataKatalog: mkSchema } = await import("@shared/schema");
                const [newType] = await db.insert(mkSchema).values({
                  tenantId,
                  namn: metadataName,
                  datatyp: 'string',
                  arLogisk: true,
                  standardArvs: false,
                  kategori: 'importerad',
                  beskrivning: `Importerad fran Modus CSV (${csvColumn})`,
                  sortOrder: 100,
                }).returning();
                metadataTypeMap.set(metadataName.toLowerCase(), newType);
              }
              
              await createMetadata({
                tenantId,
                objektId: objectId,
                metadataTypNamn: metadataTypeMap.get(metadataName.toLowerCase())!.namn,
                varde: rawValue,
                skapadAv: 'modus-import',
                metod: 'manuell',
              });
              metadataWritten++;
            } catch (metaErr: any) {
              metadataErrors.push(`Metadata "${metadataName}" for "${row["Namn"] || modusId}": ${metaErr.message}`);
            }
          }
        }
      }
      
      const responseData = { 
        importBatchId,
        imported: created.length + updated.length,
        created: created.length,
        updated: updated.length,
        parentsUpdated,
        customersCreated: customerNames.size,
        skipped: skipped.length,
        metadataWritten,
        metadataColumns: metadataColumns.map(c => c.metadataName),
        errors: [...errors, ...metadataErrors].slice(0, 50),
        totalRows: (result.data as unknown[]).length,
      };
      
      job.status = "completed";
      job.phase = "klar";
      job.result = responseData;
      notifyImportProgress(importBatchId);
      setTimeout(() => importJobs.delete(importBatchId), 300000);
    } catch (error) {
      console.error("Modus import error:", error);
      const failedJob = importJobs.get(importBatchId);
      if (failedJob) {
        failedJob.status = "failed";
        failedJob.phase = "fel";
        failedJob.result = { error: String(error), importBatchId };
        notifyImportProgress(importBatchId);
      }
      setTimeout(() => importJobs.delete(importBatchId), 300000);
    }
  });

  // Modus 2.0 Import - Tasks (uppgifter)
  app.post("/api/import/modus/tasks", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { 
        header: true, 
        skipEmptyLines: true,
        delimiter: ";",
      });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
      }

      const tenantId = getTenantIdWithFallback(req);
      const taskBatchId = crypto.randomUUID();
      const objects = await storage.getObjects(tenantId);
      const objectMap = new Map(objects.map(o => [o.objectNumber, o]));
      
      const customers = await storage.getCustomers(tenantId);
      const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
      
      const resources = await storage.getResources(tenantId);
      const resourceMap = new Map(resources.map(r => [r.name.toLowerCase(), r.id]));
      
      const created: string[] = [];
      const updated: string[] = [];
      const errors: string[] = [];
      
      for (const row of result.data as Record<string, string>[]) {
        try {
          const uppgiftsId = row["Uppgifts Id"];
          const objekt = (row["Objekt"] || "").replace(/\s/g, "");
          const kundRaw = row["Kund"] || "";
          let uppgiftsnamn = row["Uppgiftsnamn"] || "";
          const uppgiftstyp = row["Uppgiftstyp"] || "";
          const status = row["Status"] || "draft";
          const varaktighet = row["Varaktighet"] || "60";
          const team = row["Team"] || "";
          const planeradDagOTid = row["Planerad dag o tid"] || "";
          const prislista = row["Prislista"] || "";
          const kostnad = row["Kostnad"] || "0";
          const pris = row["Pris"] || "0";
          const fakturerad = row["Fakturerad"] || "0";
          const resultat = row["Resultat"] || "";
          const jobb = row["Jobb"] || "";
          const bestallning = row["Beställning"] || "";
          const starttid = row["Starttid"] || "";
          const sluttid = row["Sluttid"] || "";
          
          if (!uppgiftsId) continue;
          if (!uppgiftsnamn) uppgiftsnamn = `Uppgift ${uppgiftsId}`;
          
          // Find object by Modus ID
          const objectNumber = `MODUS-${objekt}`;
          const object = objectMap.get(objectNumber);
          if (!object) {
            errors.push(`Objekt ${objekt} hittades inte för uppgift ${uppgiftsId}`);
            continue;
          }
          
          // Find or create resource
          let resourceId = null;
          if (team) {
            resourceId = resourceMap.get(team.toLowerCase());
            if (!resourceId) {
              const newResource = await storage.createResource({
                tenantId,
                name: team,
                initials: team.substring(0, 3).toUpperCase(),
              });
              resourceId = newResource.id;
              resourceMap.set(team.toLowerCase(), resourceId);
            }
          }
          
          // Parse scheduled date
          let scheduledDate = null;
          let scheduledStartTime = null;
          if (planeradDagOTid) {
            const dt = new Date(planeradDagOTid);
            if (!isNaN(dt.getTime())) {
              scheduledDate = dt;
              scheduledStartTime = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
            }
          }
          
          // Map status
          let mappedStatus = "draft";
          if (status === "done") mappedStatus = "completed";
          else if (status === "in_progress") mappedStatus = "in_progress";
          else if (status === "not_started" || status === "scheduled") mappedStatus = "scheduled";
          else if (status === "not_feasible") mappedStatus = "cancelled";
          
          // Map task type
          const typLower = uppgiftstyp.toLowerCase();
          let orderType = "hamtning";
          if (typLower.includes("kärltvätt") || typLower.includes("karlttvatt")) orderType = "karlttvatt";
          else if (typLower.includes("rumstvätt") || typLower.includes("rumstvatt")) orderType = "rumstvatt";
          else if (typLower.includes("uj") || typLower.includes("underjord")) orderType = "uj_tvatt";
          else if (typLower.includes("tvätt")) orderType = "karlttvatt";
          
          // Parse monetary values (Swedish comma decimals)
          const parsedKostnad = parseFloat(kostnad.replace(",", ".")) || 0;
          const parsedPris = parseFloat(pris.replace(",", ".")) || 0;
          const parsedVaraktighet = parseFloat(varaktighet.replace(",", ".")) || 60;
          
          const workOrderFields = {
            customerId: object.customerId,
            objectId: object.id,
            resourceId,
            title: uppgiftsnamn,
            description: `Modus ID: ${uppgiftsId}, Typ: ${uppgiftstyp}`,
            orderType,
            priority: "normal",
            status: mappedStatus,
            scheduledDate,
            scheduledStartTime,
            estimatedDuration: Math.round(parsedVaraktighet),
            cachedCost: Math.round(parsedKostnad * 100),
            cachedValue: Math.round(parsedPris * 100),
            notes: resultat || null,
            metadata: { 
              modusId: uppgiftsId, 
              prislista: prislista || undefined, 
              jobb: jobb || undefined,
              bestallning: bestallning || undefined,
              fakturerad: fakturerad === "1",
              starttid: starttid || undefined,
              sluttid: sluttid || undefined,
            },
          };
          
          const existingWo = await storage.getWorkOrderByModusId(tenantId, uppgiftsId);
          
          if (existingWo) {
            await storage.updateWorkOrder(existingWo.id, workOrderFields);
            updated.push(uppgiftsnamn);
          } else {
            await storage.createWorkOrder({ tenantId, ...workOrderFields, importBatchId: taskBatchId });
            created.push(uppgiftsnamn);
          }
        } catch (err) {
          errors.push(`Fel vid import av uppgift: ${err}`);
        }
      }
      
      res.json({ 
        importBatchId: taskBatchId,
        imported: created.length + updated.length,
        created: created.length,
        updated: updated.length,
        errors: errors.slice(0, 50),
        totalRows: (result.data as unknown[]).length,
      });
    } catch (error) {
      console.error("Modus tasks import error:", error);
      res.status(500).json({ error: "Modus tasks import misslyckades" });
    }
  });

  // Modus 2.0 Import - Task Events (for setup time analysis)
  app.post("/api/import/modus/events", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { 
        header: true, 
        skipEmptyLines: true,
        delimiter: ";",
      });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
      }

      // Group events by Uppgifts Id to calculate setup times
      const eventsByTask = new Map<string, Array<{ type: string; time: Date }>>();
      
      for (const row of result.data as Record<string, string>[]) {
        const uppgiftsId = row["Uppgifts Id"];
        const eventTyp = row["Event Typ"];
        const tid = row["Tid"];
        
        if (!uppgiftsId || !tid) continue;
        
        const time = new Date(tid);
        if (isNaN(time.getTime())) continue;
        
        if (!eventsByTask.has(uppgiftsId)) {
          eventsByTask.set(uppgiftsId, []);
        }
        eventsByTask.get(uppgiftsId)!.push({ type: eventTyp, time });
      }
      
      // Calculate setup times (time between in_progress events on same task)
      // This approximates setup time as the gap between consecutive task starts
      const setupTimes: Array<{ taskId: string; minutes: number }> = [];
      
      for (const [taskId, events] of Array.from(eventsByTask)) {
        // Sort by time
        events.sort((a: { type: string; time: Date }, b: { type: string; time: Date }) => a.time.getTime() - b.time.getTime());
        
        // Find in_progress -> done pairs
        for (let i = 0; i < events.length - 1; i++) {
          if (events[i].type === "in_progress" && events[i + 1].type === "done") {
            const duration = (events[i + 1].time.getTime() - events[i].time.getTime()) / (1000 * 60);
            if (duration > 0 && duration < 240) { // Max 4 hours
              setupTimes.push({ taskId, minutes: Math.round(duration) });
            }
          }
        }
      }
      
      res.json({ 
        totalEvents: (result.data as unknown[]).length,
        uniqueTasks: eventsByTask.size,
        calculatedSetupTimes: setupTimes.length,
        averageSetupTime: setupTimes.length > 0 
          ? Math.round(setupTimes.reduce((sum, s) => sum + s.minutes, 0) / setupTimes.length) 
          : 0,
        setupTimeDistribution: {
          under5min: setupTimes.filter(s => s.minutes < 5).length,
          "5to15min": setupTimes.filter(s => s.minutes >= 5 && s.minutes < 15).length,
          "15to30min": setupTimes.filter(s => s.minutes >= 15 && s.minutes < 30).length,
          over30min: setupTimes.filter(s => s.minutes >= 30).length,
        },
      });
    } catch (error) {
      console.error("Modus events import error:", error);
      res.status(500).json({ error: "Modus events import misslyckades" });
    }
  });

  // Modus 2.0 Import - Invoice Lines (fakturarader)
  app.post("/api/import/modus/invoice-lines", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Ingen fil uppladdad" });
      }
      
      const csvText = req.file.buffer.toString("utf-8");
      const result = Papa.parse(csvText, { 
        header: true, 
        skipEmptyLines: true,
        delimiter: ";",
      });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
      }

      const tenantId = getTenantIdWithFallback(req);
      const invoiceBatchId = crypto.randomUUID();
      
      const allWorkOrders = await storage.getWorkOrders(tenantId);
      const woByModusId = new Map<string, any>();
      for (const wo of allWorkOrders) {
        const meta = wo.metadata as any;
        if (meta?.modusId) {
          woByModusId.set(String(meta.modusId), wo);
        }
      }
      
      const existingArticles = await storage.getArticles(tenantId);
      const articleByFortnox = new Map<string, any>();
      for (const a of existingArticles) {
        if ((a as any).fortnoxId) {
          articleByFortnox.set((a as any).fortnoxId.toLowerCase(), a);
        }
        if (a.name) {
          articleByFortnox.set(a.name.toLowerCase(), a);
        }
      }
      
      const created: string[] = [];
      const errors: string[] = [];
      let articlesAutoCreated = 0;
      
      for (const row of result.data as Record<string, string>[]) {
        try {
          const rawUppgiftId = row["Uppgift Id"];
          const rad = row["Rad"] || "1";
          const beskrivning = row["Beskrivning"] || "";
          const antalStr = row["Antal"] || "0";
          const prisStr = row["Pris"] || "0";
          const fortnoxArtikelId = (row["Fortnox Artikel Id"] || "").trim();
          const fortnoxProjekt = (row["Fortnox Projekt"] || "").trim();
          
          if (!rawUppgiftId) continue;
          const uppgiftId = rawUppgiftId.replace(/\s/g, "");
          
          const workOrder = woByModusId.get(uppgiftId);
          if (!workOrder) {
            errors.push(`Uppgift ${uppgiftId} hittades inte i systemet`);
            continue;
          }
          
          const antal = Math.round(parseFloat(antalStr.replace(",", ".")) || 0);
          const pris = Math.round(parseFloat(prisStr.replace(",", ".")) * 100) || 0;
          
          let article = fortnoxArtikelId ? articleByFortnox.get(fortnoxArtikelId.toLowerCase()) : null;
          
          if (!article && fortnoxArtikelId) {
            let articleName = fortnoxArtikelId;
            if (fortnoxArtikelId === "K100") articleName = "Kärltvätt Standard";
            else if (fortnoxArtikelId === "UJ100") articleName = "Tvätt UJ-behållare";
            
            article = await storage.createArticle({
              tenantId,
              name: articleName,
              articleNumber: fortnoxArtikelId,
              articleType: "tjanst",
              listPrice: pris,
              objectTypes: [],
            });
            articleByFortnox.set(fortnoxArtikelId.toLowerCase(), article);
            articlesAutoCreated++;
          }
          
          if (!article) {
            errors.push(`Ingen artikel kunde skapas för rad ${uppgiftId}/${rad}`);
            continue;
          }
          
          await storage.createWorkOrderLine({
            tenantId,
            workOrderId: workOrder.id,
            articleId: article.id,
            quantity: antal,
            resolvedPrice: pris,
            resolvedCost: 0,
            resolvedProductionMinutes: 0,
            priceSource: "modus_import",
            notes: beskrivning || null,
          });
          
          created.push(`${uppgiftId}/${rad}: ${beskrivning.substring(0, 40)}`);
        } catch (err) {
          errors.push(`Fel vid import av fakturarad ${row["Uppgift Id"] || "?"}/${row["Rad"] || "?"}: ${err}`);
        }
      }
      
      res.json({ 
        importBatchId: invoiceBatchId,
        imported: created.length,
        created: created.length,
        articlesAutoCreated,
        errors: errors.slice(0, 50),
        totalRows: (result.data as unknown[]).length,
      });
    } catch (error) {
      console.error("Modus invoice lines import error:", error);
      res.status(500).json({ error: "Modus fakturarader import misslyckades" });
    }
  });

  // ============== ARTICLES ==============
  app.get("/api/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const articles = await storage.getArticles(tenantId);
      res.json(articles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch articles" });
    }
  });

  app.get("/api/articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const article = await storage.getArticle(req.params.id);
      const verified = verifyTenantOwnership(article, tenantId);
      if (!verified) return res.status(404).json({ error: "Article not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch article" });
    }
  });

  app.post("/api/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertArticleSchema.parse({ ...req.body, tenantId });
      const article = await storage.createArticle(data);
      res.status(201).json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create article" });
    }
  });

  app.patch("/api/articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getArticle(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Article not found" });
      }
      const updateSchema = insertArticleSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
      const article = await storage.updateArticle(req.params.id, updateData);
      if (!article) return res.status(404).json({ error: "Article not found" });
      res.json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to update article" });
    }
  });

  app.delete("/api/articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getArticle(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Article not found" });
      }
      await storage.deleteArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete article" });
    }
  });

  // Fasthakning: Hämta applicerbara artiklar för ett objekt baserat på hookLevel
  app.get("/api/objects/:objectId/applicable-articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const object = await storage.getObject(req.params.objectId);
      if (!verifyTenantOwnership(object, tenantId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      const applicableArticles = await storage.getApplicableArticlesForObject(
        tenantId,
        req.params.objectId
      );
      res.json(applicableArticles);
    } catch (error) {
      console.error("Failed to get applicable articles:", error);
      res.status(500).json({ error: "Failed to fetch applicable articles" });
    }
  });

  // Resolved article prices for an object (includes auto-hooked + manual + price resolution)
  app.get("/api/objects/:objectId/article-prices", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const object = await storage.getObject(req.params.objectId);
      if (!verifyTenantOwnership(object, tenantId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      const prices = await storage.getResolvedArticlePricesForObject(tenantId, req.params.objectId);
      res.json(prices);
    } catch (error) {
      console.error("Failed to get article prices:", error);
      res.status(500).json({ error: "Failed to fetch article prices" });
    }
  });

  // Manual object-article links
  app.post("/api/objects/:objectId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const object = await storage.getObject(req.params.objectId);
      if (!verifyTenantOwnership(object, tenantId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      const { articleId, overridePrice } = req.body;
      if (!articleId) {
        return res.status(400).json({ error: "articleId is required" });
      }
      const article = await storage.getArticle(articleId);
      if (!article || article.tenantId !== tenantId) {
        return res.status(404).json({ error: "Article not found" });
      }
      const existing = await storage.getObjectArticles(tenantId, req.params.objectId);
      if (existing.some(e => e.articleId === articleId)) {
        return res.status(409).json({ error: "Article already linked to this object" });
      }
      const result = await storage.addObjectArticle({
        tenantId,
        objectId: req.params.objectId,
        articleId,
        overridePrice: overridePrice ?? undefined,
      });
      res.json(result);
    } catch (error) {
      console.error("Failed to add object article:", error);
      res.status(500).json({ error: "Failed to add article" });
    }
  });

  app.delete("/api/objects/:objectId/articles/:linkId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const object = await storage.getObject(req.params.objectId);
      if (!verifyTenantOwnership(object, tenantId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      const deleted = await storage.removeObjectArticle(tenantId, req.params.objectId, req.params.linkId);
      if (!deleted) {
        return res.status(404).json({ error: "Article link not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to remove object article:", error);
      res.status(500).json({ error: "Failed to remove article" });
    }
  });

  app.patch("/api/objects/:objectId/articles/:linkId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const object = await storage.getObject(req.params.objectId);
      if (!verifyTenantOwnership(object, tenantId)) {
        return res.status(404).json({ error: "Object not found" });
      }
      const { overridePrice } = req.body;
      if (overridePrice !== null && overridePrice !== undefined && typeof overridePrice !== 'number') {
        return res.status(400).json({ error: "overridePrice must be a number or null" });
      }
      const result = await storage.updateObjectArticlePrice(tenantId, req.params.objectId, req.params.linkId, overridePrice ?? null);
      if (!result) {
        return res.status(404).json({ error: "Object article link not found" });
      }
      res.json(result);
    } catch (error) {
      console.error("Failed to update object article price:", error);
      res.status(500).json({ error: "Failed to update price" });
    }
  });

  // ============== PRICE LISTS ==============
  app.get("/api/price-lists", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const priceLists = await storage.getPriceLists(tenantId);
      res.json(priceLists);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price lists" });
    }
  });

  app.get("/api/price-lists/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const priceList = await storage.getPriceList(req.params.id);
      const verified = verifyTenantOwnership(priceList, tenantId);
      if (!verified) return res.status(404).json({ error: "Price list not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price list" });
    }
  });

  app.post("/api/price-lists", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertPriceListSchema.parse({ ...req.body, tenantId });
      const priceList = await storage.createPriceList(data);
      res.status(201).json(priceList);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create price list" });
    }
  });

  app.patch("/api/price-lists/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getPriceList(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Price list not found" });
      }
      const updateSchema = insertPriceListSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
      const priceList = await storage.updatePriceList(req.params.id, updateData);
      if (!priceList) return res.status(404).json({ error: "Price list not found" });
      res.json(priceList);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to update price list" });
    }
  });

  app.delete("/api/price-lists/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getPriceList(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Price list not found" });
      }
      await storage.deletePriceList(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete price list" });
    }
  });

  // ============== PRICE LIST ARTICLES ==============
  app.get("/api/price-lists/:priceListId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const priceList = await storage.getPriceList(req.params.priceListId);
      if (!verifyTenantOwnership(priceList, tenantId)) {
        return res.status(404).json({ error: "Price list not found" });
      }
      const priceListArticles = await storage.getPriceListArticles(req.params.priceListId);
      res.json(priceListArticles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price list articles" });
    }
  });

  app.post("/api/price-lists/:priceListId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const priceList = await storage.getPriceList(req.params.priceListId);
      if (!verifyTenantOwnership(priceList, tenantId)) {
        return res.status(404).json({ error: "Price list not found" });
      }
      const data = insertPriceListArticleSchema.parse({ ...req.body, priceListId: req.params.priceListId });
      const priceListArticle = await storage.createPriceListArticle(data);
      res.status(201).json(priceListArticle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create price list article" });
    }
  });

  app.patch("/api/price-list-articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getPriceListArticle(req.params.id);
      if (!existing) return res.status(404).json({ error: "Price list article not found" });
      
      // Verify the parent price list belongs to the tenant
      const priceList = await storage.getPriceList(existing.priceListId);
      if (!verifyTenantOwnership(priceList, tenantId)) {
        return res.status(404).json({ error: "Price list article not found" });
      }
      
      const updateSchema = insertPriceListArticleSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
      const priceListArticle = await storage.updatePriceListArticle(req.params.id, updateData);
      if (!priceListArticle) return res.status(404).json({ error: "Price list article not found" });
      res.json(priceListArticle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to update price list article" });
    }
  });

  app.delete("/api/price-list-articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getPriceListArticle(req.params.id);
      if (!existing) return res.status(404).json({ error: "Price list article not found" });
      
      // Verify the parent price list belongs to the tenant
      const priceList = await storage.getPriceList(existing.priceListId);
      if (!verifyTenantOwnership(priceList, tenantId)) {
        return res.status(404).json({ error: "Price list article not found" });
      }
      
      await storage.deletePriceListArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete price list article" });
    }
  });

  // ============== RESOURCE ARTICLES (TIDSVERK) ==============
  app.get("/api/resources/:resourceId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const resourceArticles = await storage.getResourceArticles(req.params.resourceId);
      res.json(resourceArticles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource articles" });
    }
  });

  app.post("/api/resources/:resourceId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const data = insertResourceArticleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
      const resourceArticle = await storage.createResourceArticle(data);
      res.status(201).json(resourceArticle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create resource article" });
    }
  });

  app.patch("/api/resource-articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceArticle(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource article not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource article not found" });
      }
      
      const updateSchema = insertResourceArticleSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
      const resourceArticle = await storage.updateResourceArticle(req.params.id, updateData);
      if (!resourceArticle) return res.status(404).json({ error: "Resource article not found" });
      res.json(resourceArticle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to update resource article" });
    }
  });

  app.delete("/api/resource-articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceArticle(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource article not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource article not found" });
      }
      
      await storage.deleteResourceArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource article" });
    }
  });

  // ============== VEHICLES ==============
  app.get("/api/vehicles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicles = await storage.getVehicles(tenantId);
      res.json(vehicles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicles" });
    }
  });

  app.get("/api/vehicles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicle = await storage.getVehicle(req.params.id);
      const verified = verifyTenantOwnership(vehicle, tenantId);
      if (!verified) return res.status(404).json({ error: "Vehicle not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle" });
    }
  });

  app.post("/api/vehicles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertVehicleSchema.parse({ ...req.body, tenantId });
      const vehicle = await storage.createVehicle(data);
      res.status(201).json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create vehicle" });
    }
  });

  app.patch("/api/vehicles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getVehicle(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      const updateSchema = insertVehicleSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(formatZodError(parseResult.error));
      }
      const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
      const vehicle = await storage.updateVehicle(req.params.id, updateData);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      res.json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to update vehicle" });
    }
  });

  app.delete("/api/vehicles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getVehicle(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      await storage.deleteVehicle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete vehicle" });
    }
  });

  // ============== FUEL LOGS ==============
  app.get("/api/fuel-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicleId = req.query.vehicleId as string | undefined;
      const logs = await storage.getFuelLogs(tenantId, vehicleId);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch fuel logs" });
    }
  });

  app.post("/api/fuel-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicle = await storage.getVehicle(req.body.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      const data = insertFuelLogSchema.parse({ ...req.body, tenantId });
      const log = await storage.createFuelLog(data);
      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create fuel log:", error);
      res.status(500).json({ error: "Failed to create fuel log" });
    }
  });

  app.delete("/api/fuel-logs/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteFuelLog(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete fuel log" });
    }
  });

  // ============== MAINTENANCE LOGS ==============
  app.get("/api/maintenance-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicleId = req.query.vehicleId as string | undefined;
      const logs = await storage.getMaintenanceLogs(tenantId, vehicleId);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch maintenance logs" });
    }
  });

  app.post("/api/maintenance-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicle = await storage.getVehicle(req.body.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      const data = insertMaintenanceLogSchema.parse({ ...req.body, tenantId });
      const log = await storage.createMaintenanceLog(data);
      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create maintenance log:", error);
      res.status(500).json({ error: "Failed to create maintenance log" });
    }
  });

  app.delete("/api/maintenance-logs/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteMaintenanceLog(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete maintenance log" });
    }
  });

  // ============== EQUIPMENT ==============
  app.get("/api/equipment", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const equipment = await storage.getEquipment(tenantId);
      res.json(equipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch equipment" });
    }
  });

  app.get("/api/equipment/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const equipment = await storage.getEquipmentById(req.params.id);
      const verified = verifyTenantOwnership(equipment, tenantId);
      if (!verified) return res.status(404).json({ error: "Equipment not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch equipment" });
    }
  });

  app.post("/api/equipment", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertEquipmentSchema.parse({ ...req.body, tenantId });
      const equipment = await storage.createEquipment(data);
      res.status(201).json(equipment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create equipment" });
    }
  });

  app.patch("/api/equipment/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getEquipmentById(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
      const equipment = await storage.updateEquipment(req.params.id, updateData);
      if (!equipment) return res.status(404).json({ error: "Equipment not found" });
      res.json(equipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to update equipment" });
    }
  });

  app.delete("/api/equipment/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getEquipmentById(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Equipment not found" });
      }
      await storage.deleteEquipment(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete equipment" });
    }
  });

  // ============== RESOURCE AVAILABILITY ==============
  app.get("/api/resource-availability/:resourceId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const availability = await storage.getResourceAvailability(req.params.resourceId);
      res.json(availability);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource availability" });
    }
  });

  app.get("/api/resource-availability-item/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const item = await storage.getResourceAvailabilityById(req.params.id);
      if (!item) return res.status(404).json({ error: "Resource availability not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(item.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource availability not found" });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource availability" });
    }
  });

  app.post("/api/resource-availability/:resourceId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const data = insertResourceAvailabilitySchema.parse({ 
        ...req.body, 
        tenantId, 
        resourceId: req.params.resourceId 
      });
      const item = await storage.createResourceAvailability(data);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create resource availability" });
    }
  });

  app.patch("/api/resource-availability-item/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceAvailabilityById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource availability not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource availability not found" });
      }
      
      const { tenantId: _, id, resourceId, createdAt, ...updateData } = req.body;
      const item = await storage.updateResourceAvailability(req.params.id, updateData);
      if (!item) return res.status(404).json({ error: "Resource availability not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to update resource availability" });
    }
  });

  app.delete("/api/resource-availability-item/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceAvailabilityById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource availability not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource availability not found" });
      }
      
      await storage.deleteResourceAvailability(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource availability" });
    }
  });

  // ============== VEHICLE SCHEDULE ==============
  app.get("/api/vehicle-schedule/:vehicleId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicle = await storage.getVehicle(req.params.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      const schedule = await storage.getVehicleSchedule(req.params.vehicleId);
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle schedule" });
    }
  });

  app.get("/api/vehicle-schedule-item/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const item = await storage.getVehicleScheduleById(req.params.id);
      if (!item) return res.status(404).json({ error: "Vehicle schedule not found" });
      
      const vehicle = await storage.getVehicle(item.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle schedule not found" });
      }
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle schedule" });
    }
  });

  app.post("/api/vehicle-schedule/:vehicleId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const vehicle = await storage.getVehicle(req.params.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle not found" });
      }
      const data = insertVehicleScheduleSchema.parse({ 
        ...req.body, 
        tenantId, 
        vehicleId: req.params.vehicleId 
      });
      const item = await storage.createVehicleSchedule(data);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create vehicle schedule" });
    }
  });

  app.patch("/api/vehicle-schedule-item/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getVehicleScheduleById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Vehicle schedule not found" });
      
      const vehicle = await storage.getVehicle(existing.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle schedule not found" });
      }
      
      const { tenantId: _, id, vehicleId, createdAt, ...updateData } = req.body;
      const item = await storage.updateVehicleSchedule(req.params.id, updateData);
      if (!item) return res.status(404).json({ error: "Vehicle schedule not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to update vehicle schedule" });
    }
  });

  app.delete("/api/vehicle-schedule-item/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getVehicleScheduleById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Vehicle schedule not found" });
      
      const vehicle = await storage.getVehicle(existing.vehicleId);
      if (!verifyTenantOwnership(vehicle, tenantId)) {
        return res.status(404).json({ error: "Vehicle schedule not found" });
      }
      
      await storage.deleteVehicleSchedule(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete vehicle schedule" });
    }
  });

  // ============== SUBSCRIPTIONS ==============
  app.get("/api/subscriptions", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const subscriptions = await storage.getSubscriptions(tenantId);
      res.json(subscriptions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  });

  app.get("/api/subscriptions/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const subscription = await storage.getSubscription(req.params.id);
      const verified = verifyTenantOwnership(subscription, tenantId);
      if (!verified) return res.status(404).json({ error: "Subscription not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  });

  app.post("/api/subscriptions", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertSubscriptionSchema.parse({ ...req.body, tenantId });
      const subscription = await storage.createSubscription(data);
      res.status(201).json(subscription);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  app.patch("/api/subscriptions/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getSubscription(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Subscription not found" });
      }
      const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
      const subscription = await storage.updateSubscription(req.params.id, updateData);
      if (!subscription) return res.status(404).json({ error: "Subscription not found" });
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });

  app.delete("/api/subscriptions/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getSubscription(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Subscription not found" });
      }
      await storage.deleteSubscription(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete subscription" });
    }
  });

  // Preview scheduled dates based on flexible frequency
  app.post("/api/scheduling/preview-dates", async (req, res) => {
    try {
      const { frequency, startDate, endDate } = req.body;
      
      if (!frequency || !startDate || !endDate) {
        return res.status(400).json({ error: "frequency, startDate, and endDate are required" });
      }
      
      const { generateScheduleDates, formatFrequencyDescription } = await import('./scheduling-utils');
      
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const dates = generateScheduleDates(frequency, start, end);
      const description = formatFrequencyDescription(frequency);
      
      res.json({
        dates: dates.map(d => d.toISOString()),
        count: dates.length,
        description,
        period: {
          start: start.toISOString(),
          end: end.toISOString(),
        }
      });
    } catch (error) {
      console.error("Failed to preview dates:", error);
      res.status(500).json({ error: "Failed to preview scheduled dates" });
    }
  });

  // Generate orders from active subscriptions
  app.post("/api/subscriptions/generate-orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const subscriptions = await storage.getSubscriptions(tenantId);
      const now = new Date();
      let generatedCount = 0;

      const { generateScheduleDates, convertLegacyPeriodicity } = await import('./scheduling-utils');

      for (const sub of subscriptions) {
        if (sub.status !== "active" || !sub.autoGenerate) continue;
        if (!sub.nextGenerationDate) continue;
        
        const nextGenDate = new Date(sub.nextGenerationDate);
        const generateAheadDays = sub.generateDaysAhead || 14;
        const generateThreshold = new Date(now.getTime() + generateAheadDays * 24 * 60 * 60 * 1000);
        
        // Generate if nextGenerationDate is within the generate-ahead window
        if (nextGenDate <= generateThreshold) {
          // Create work order from subscription
          const workOrder = await storage.createWorkOrder({
            tenantId,
            customerId: sub.customerId,
            objectId: sub.objectId,
            title: sub.name,
            description: `Genererad från abonnemang: ${sub.name}`,
            orderStatus: "skapad",
            priority: "normal",
            estimatedDuration: 60,
            scheduledDate: nextGenDate,
            isSimulated: false,
          });

          generatedCount++;

          // Calculate next generation date - use flexible frequency if available
          let nextDate: Date;
          
          if (sub.flexibleFrequency) {
            // Use new flexible frequency system
            const frequency = sub.flexibleFrequency as any;
            const dates = generateScheduleDates(frequency, nextGenDate, generateThreshold);
            // Find the next date after the current one
            const futureDates = dates.filter(d => d > nextGenDate);
            nextDate = futureDates.length > 0 ? futureDates[0] : new Date(nextGenDate.getTime() + 7 * 24 * 60 * 60 * 1000);
          } else {
            // Fallback to legacy periodicity
            nextDate = new Date(nextGenDate);
            switch (sub.periodicity) {
              case "vecka":
                nextDate.setDate(nextDate.getDate() + 7);
                break;
              case "varannan_vecka":
                nextDate.setDate(nextDate.getDate() + 14);
                break;
              case "manad":
                nextDate.setMonth(nextDate.getMonth() + 1);
                break;
              case "kvartal":
                nextDate.setMonth(nextDate.getMonth() + 3);
                break;
              case "halvar":
                nextDate.setMonth(nextDate.getMonth() + 6);
                break;
              case "ar":
                nextDate.setFullYear(nextDate.getFullYear() + 1);
                break;
              default:
                nextDate.setMonth(nextDate.getMonth() + 1);
            }
          }

          // Check if we've passed endDate
          if (sub.endDate && nextDate > new Date(sub.endDate)) {
            await storage.updateSubscription(sub.id, {
              status: "completed",
              lastGeneratedDate: now,
            });
          } else {
            await storage.updateSubscription(sub.id, {
              lastGeneratedDate: now,
              nextGenerationDate: nextDate,
            });
          }
        }
      }

      res.json({ success: true, generatedCount });
    } catch (error) {
      console.error("Failed to generate orders:", error);
      res.status(500).json({ error: "Failed to generate orders from subscriptions" });
    }
  });

  // ============== TEAMS ==============
  app.get("/api/teams", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const teams = await storage.getTeams(tenantId);
      res.json(teams);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch teams" });
    }
  });

  app.get("/api/teams/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const team = await storage.getTeam(req.params.id);
      const verified = verifyTenantOwnership(team, tenantId);
      if (!verified) return res.status(404).json({ error: "Team not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.post("/api/teams", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertTeamSchema.parse({ ...req.body, tenantId });
      const team = await storage.createTeam(data);
      res.status(201).json(team);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create team" });
    }
  });

  app.patch("/api/teams/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getTeam(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Team not found" });
      }
      const updateSchema = insertTeamSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors });
      }
      const team = await storage.updateTeam(req.params.id, parseResult.data);
      if (!team) return res.status(404).json({ error: "Team not found" });
      res.json(team);
    } catch (error) {
      console.error("Failed to update team:", error);
      res.status(500).json({ error: "Failed to update team" });
    }
  });

  app.delete("/api/teams/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getTeam(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Team not found" });
      }
      await storage.deleteTeam(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete team" });
    }
  });

  // ============== TEAM MEMBERS ==============
  app.get("/api/team-members/:teamId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const team = await storage.getTeam(req.params.teamId);
      if (!verifyTenantOwnership(team, tenantId)) {
        return res.status(404).json({ error: "Team not found" });
      }
      const members = await storage.getTeamMembers(req.params.teamId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team members" });
    }
  });

  app.get("/api/team-members", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const members = await storage.getAllTeamMembers(tenantId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team members" });
    }
  });

  app.get("/api/team-member/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const member = await storage.getTeamMember(req.params.id);
      if (!member) return res.status(404).json({ error: "Team member not found" });
      
      const team = await storage.getTeam(member.teamId);
      if (!verifyTenantOwnership(team, tenantId)) {
        return res.status(404).json({ error: "Team member not found" });
      }
      res.json(member);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team member" });
    }
  });

  app.post("/api/team-members/:teamId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const team = await storage.getTeam(req.params.teamId);
      if (!verifyTenantOwnership(team, tenantId)) {
        return res.status(404).json({ error: "Team not found" });
      }
      const data = insertTeamMemberSchema.parse({ ...req.body, teamId: req.params.teamId });
      const member = await storage.createTeamMember(data);
      res.status(201).json(member);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create team member" });
    }
  });

  app.patch("/api/team-member/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getTeamMember(req.params.id);
      if (!existing) return res.status(404).json({ error: "Team member not found" });
      
      const team = await storage.getTeam(existing.teamId);
      if (!verifyTenantOwnership(team, tenantId)) {
        return res.status(404).json({ error: "Team member not found" });
      }
      
      const { id, teamId, resourceId, createdAt, ...updateData } = req.body;
      const member = await storage.updateTeamMember(req.params.id, updateData);
      if (!member) return res.status(404).json({ error: "Team member not found" });
      res.json(member);
    } catch (error) {
      res.status(500).json({ error: "Failed to update team member" });
    }
  });

  app.delete("/api/team-member/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getTeamMember(req.params.id);
      if (!existing) return res.status(404).json({ error: "Team member not found" });
      
      const team = await storage.getTeam(existing.teamId);
      if (!verifyTenantOwnership(team, tenantId)) {
        return res.status(404).json({ error: "Team member not found" });
      }
      
      await storage.deleteTeamMember(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete team member" });
    }
  });

  // ============== PLANNING PARAMETERS ==============
  app.get("/api/planning-parameters", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const params = await storage.getPlanningParameters(tenantId);
      res.json(params);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch planning parameters" });
    }
  });

  app.get("/api/planning-parameters/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const param = await storage.getPlanningParameter(req.params.id);
      const verified = verifyTenantOwnership(param, tenantId);
      if (!verified) return res.status(404).json({ error: "Planning parameter not found" });
      res.json(verified);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch planning parameter" });
    }
  });

  app.post("/api/planning-parameters", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertPlanningParameterSchema.parse({ ...req.body, tenantId });
      const param = await storage.createPlanningParameter(data);
      res.status(201).json(param);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create planning parameter" });
    }
  });

  app.patch("/api/planning-parameters/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getPlanningParameter(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Planning parameter not found" });
      }
      const updateSchema = insertPlanningParameterSchema.partial().omit({ tenantId: true });
      const parseResult = updateSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors });
      }
      const param = await storage.updatePlanningParameter(req.params.id, parseResult.data);
      if (!param) return res.status(404).json({ error: "Planning parameter not found" });
      res.json(param);
    } catch (error) {
      console.error("Failed to update planning parameter:", error);
      res.status(500).json({ error: "Failed to update planning parameter" });
    }
  });

  app.delete("/api/planning-parameters/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getPlanningParameter(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Planning parameter not found" });
      }
      await storage.deletePlanningParameter(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete planning parameter" });
    }
  });

  // ============== RESOURCE VEHICLES ==============
  app.get("/api/resources/:resourceId/vehicles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const resourceVehicles = await storage.getResourceVehicles(req.params.resourceId);
      res.json(resourceVehicles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource vehicles" });
    }
  });

  app.post("/api/resources/:resourceId/vehicles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const data = insertResourceVehicleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
      const rv = await storage.createResourceVehicle(data);
      res.status(201).json(rv);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create resource vehicle" });
    }
  });

  app.patch("/api/resource-vehicles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceVehicle(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource vehicle not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource vehicle not found" });
      }
      
      const { id, resourceId, vehicleId, createdAt, ...updateData } = req.body;
      const rv = await storage.updateResourceVehicle(req.params.id, updateData);
      if (!rv) return res.status(404).json({ error: "Resource vehicle not found" });
      res.json(rv);
    } catch (error) {
      res.status(500).json({ error: "Failed to update resource vehicle" });
    }
  });

  app.delete("/api/resource-vehicles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceVehicle(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource vehicle not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource vehicle not found" });
      }
      
      await storage.deleteResourceVehicle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource vehicle" });
    }
  });

  // ============== RESOURCE EQUIPMENT ==============
  app.get("/api/resources/:resourceId/equipment", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const resourceEquipment = await storage.getResourceEquipment(req.params.resourceId);
      res.json(resourceEquipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource equipment" });
    }
  });

  app.post("/api/resources/:resourceId/equipment", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(req.params.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const data = insertResourceEquipmentSchema.parse({ ...req.body, resourceId: req.params.resourceId });
      const re = await storage.createResourceEquipment(data);
      res.status(201).json(re);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      res.status(500).json({ error: "Failed to create resource equipment" });
    }
  });

  app.patch("/api/resource-equipment/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceEquipmentById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource equipment not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource equipment not found" });
      }
      
      const { id, resourceId, equipmentId, createdAt, ...updateData } = req.body;
      const re = await storage.updateResourceEquipment(req.params.id, updateData);
      if (!re) return res.status(404).json({ error: "Resource equipment not found" });
      res.json(re);
    } catch (error) {
      res.status(500).json({ error: "Failed to update resource equipment" });
    }
  });

  app.delete("/api/resource-equipment/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getResourceEquipmentById(req.params.id);
      if (!existing) return res.status(404).json({ error: "Resource equipment not found" });
      
      // Verify the parent resource belongs to the tenant
      const resource = await storage.getResource(existing.resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resource equipment not found" });
      }
      
      await storage.deleteResourceEquipment(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource equipment" });
    }
  });

  // ============== CLUSTERS - NAVET I VERKSAMHETEN ==============
  app.get("/api/clusters", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const clusters = await storage.getClusters(tenantId);
      res.json(clusters || []);
    } catch (error) {
      console.error("Failed to fetch clusters:", error);
      res.status(500).json({ error: "Kunde inte hämta kluster", details: String(error) });
    }
  });

  app.get("/api/clusters/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const cluster = await storage.getClusterWithStats(req.params.id);
      const verified = verifyTenantOwnership(cluster, tenantId);
      if (!verified) return res.status(404).json({ error: "Kluster hittades inte" });
      res.json(verified);
    } catch (error) {
      console.error("Failed to fetch cluster:", error);
      res.status(500).json({ error: "Kunde inte hämta kluster" });
    }
  });

  app.post("/api/clusters", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertClusterSchema.parse({ ...req.body, tenantId });
      if (data.radiusKm && data.radiusKm > 50) data.radiusKm = 50;
      const cluster = await storage.createCluster(data);

      if (cluster.postalCodes && cluster.postalCodes.length > 0) {
        const normalizedPostals = [...new Set(cluster.postalCodes.map(pc => pc.replace(/\s/g, "")))];
        const matchingObjects = await db.select({ id: objects.id, postalCode: objects.postalCode })
          .from(objects)
          .where(and(
            eq(objects.tenantId, tenantId),
            isNull(objects.deletedAt),
            isNull(objects.clusterId)
          ));
        const objectsToLink = matchingObjects.filter(obj => {
          const objPostal = (obj.postalCode || "").replace(/\s/g, "");
          return normalizedPostals.some(pc => objPostal === pc || objPostal.startsWith(pc));
        });
        if (objectsToLink.length > 0) {
          const objectIds = objectsToLink.map(o => o.id);
          const batchSize = 500;
          for (let i = 0; i < objectIds.length; i += batchSize) {
            const batch = objectIds.slice(i, i + batchSize);
            await db.update(objects)
              .set({ clusterId: cluster.id })
              .where(and(inArray(objects.id, batch), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
          }
          for (let i = 0; i < objectIds.length; i += batchSize) {
            const woBatch = objectIds.slice(i, i + batchSize);
            await db.update(workOrders)
              .set({ clusterId: cluster.id })
              .where(and(inArray(workOrders.objectId, woBatch), eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)));
          }
        }
      }

      await storage.updateClusterCaches(cluster.id);
      const updated = await storage.getCluster(cluster.id);
      res.status(201).json(updated || cluster);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create cluster:", error);
      res.status(500).json({ error: "Kunde inte skapa kluster" });
    }
  });

  app.patch("/api/clusters/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
      const cluster = await storage.updateCluster(req.params.id, updateData);
      if (!cluster) return res.status(404).json({ error: "Kluster hittades inte" });
      res.json(cluster);
    } catch (error) {
      console.error("Failed to update cluster:", error);
      res.status(500).json({ error: "Kunde inte uppdatera kluster" });
    }
  });

  app.delete("/api/clusters/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      await storage.deleteCluster(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete cluster:", error);
      res.status(500).json({ error: "Kunde inte ta bort kluster" });
    }
  });

  // Cluster aggregations - "snöret"
  app.get("/api/clusters/:id/objects", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const cluster = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(cluster, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      const objects = await storage.getClusterObjects(req.params.id);
      res.json(objects);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta objekt i kluster" });
    }
  });

  app.get("/api/clusters/:id/work-orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const cluster = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(cluster, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const workOrders = await storage.getClusterWorkOrders(req.params.id, { startDate, endDate });
      res.json(workOrders);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta ordrar i kluster" });
    }
  });

  app.get("/api/clusters/:id/subscriptions", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const cluster = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(cluster, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      const subscriptions = await storage.getClusterSubscriptions(req.params.id);
      res.json(subscriptions);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta abonnemang i kluster" });
    }
  });

  // Get all contacts for objects in a cluster (including inherited)
  app.get("/api/clusters/:id/object-contacts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const cluster = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(cluster, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      const objects = await storage.getClusterObjects(req.params.id);
      
      // Get contacts for all objects including inherited ones
      const contactsByObject: Record<string, any[]> = {};
      for (const obj of objects) {
        const contacts = await storage.getObjectContactsWithInheritance(obj.id, tenantId);
        contactsByObject[obj.id] = contacts;
      }
      res.json(contactsByObject);
    } catch (error) {
      console.error("Error fetching cluster object contacts:", error);
      res.status(500).json({ error: "Kunde inte hämta kontakter för objekt i kluster" });
    }
  });

  app.post("/api/clusters/:id/refresh-cache", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getCluster(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      const cluster = await storage.updateClusterCaches(req.params.id);
      if (!cluster) return res.status(404).json({ error: "Kluster hittades inte" });
      res.json(cluster);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte uppdatera klustercache" });
    }
  });

  // AI General Chat - contextual AI assistant for all modules
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const { question, context, conversationHistory = [] } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Fråga krävs" });
      }

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });
      
      // Use shared persona module
      const { buildSystemPrompt } = await import("./ai/persona");

      // Fetch contextual data based on current module
      let moduleData = "";
      const moduleName = context?.module || "Generell";
      const modulePath = context?.path || "/";
      
      // Determine role based on module path
      let role: "field_worker" | "planner" | "admin" | "general" = "general";
      if (modulePath.startsWith("/mobile") || modulePath === "/") {
        role = "field_worker";
      } else if (modulePath.startsWith("/planner") || modulePath.startsWith("/week")) {
        role = "planner";
      } else if (modulePath.startsWith("/fortnox") || modulePath.startsWith("/admin")) {
        role = "admin";
      }

      try {
        const tenantId = getTenantIdWithFallback(req);
        if (modulePath.startsWith("/economics")) {
          const workOrders = await storage.getWorkOrders(tenantId);
          const completed = workOrders.filter(wo => wo.status === "completed" || wo.orderStatus === "utford").length;
          const pending = workOrders.filter(wo => wo.status !== "completed" && wo.orderStatus !== "utford").length;
          moduleData = `Ekonomisk översikt: ${workOrders.length} ordrar totalt, ${completed} utförda, ${pending} väntande`;
        } else if (modulePath.startsWith("/vehicles")) {
          const vehicles = await storage.getVehicles(tenantId);
          moduleData = `Fordonsflotta: ${vehicles.length} fordon registrerade`;
        } else if (modulePath.startsWith("/weather")) {
          moduleData = "Väderplanering: AI-stöd för att anpassa schemaläggning baserat på väderförhållanden";
        } else if (modulePath.startsWith("/subscriptions")) {
          const subscriptions = await storage.getSubscriptions(tenantId);
          const active = subscriptions.filter(s => s.status === "active").length;
          moduleData = `Abonnemang: ${subscriptions.length} totalt, ${active} aktiva`;
        } else if (modulePath.startsWith("/articles")) {
          const articles = await storage.getArticles(tenantId);
          moduleData = `Artiklar: ${articles.length} artiklar i systemet`;
        } else {
          const clusters = await storage.getClusters(tenantId);
          const workOrders = await storage.getWorkOrders(tenantId);
          moduleData = `System: ${clusters.length} kluster, ${workOrders.length} ordrar`;
        }
      } catch (e) {
        moduleData = "Kunde inte hämta moduldata";
      }

      // Build system prompt with shared persona
      const systemPrompt = buildSystemPrompt({ 
        role, 
        moduleName, 
        additionalContext: moduleData 
      }) + `

VIKTIGT: Avsluta ALLTID ditt svar med exakt 2-3 föreslagna följdfrågor som användaren kan ställa.
Formatera dem på en ny rad efter ditt svar, med prefixet "FÖLJDFRÅGOR:" följt av frågorna separerade med "|".`;

      // Build messages array with history
      const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt }
      ];
      
      // Add conversation history (limit to last 10)
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          chatMessages.push({ role: msg.role, content: msg.content });
        }
      }
      
      chatMessages.push({ role: "user", content: question });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: chatMessages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const { trackOpenAIResponse } = await import("./api-usage-tracker");
      trackOpenAIResponse(response);

      let rawAnswer = response.choices[0]?.message?.content || "Kunde inte generera ett svar.";
      
      // Parse suggested follow-up questions
      let suggestedQuestions: string[] = [];
      const followUpMatch = rawAnswer.match(/FÖLJDFRÅGOR:([\s\S]+?)$/);
      if (followUpMatch) {
        suggestedQuestions = followUpMatch[1].split("|").map(q => q.trim()).filter(q => q.length > 0);
        rawAnswer = rawAnswer.replace(/\n*FÖLJDFRÅGOR:[\s\S]+$/, "").trim();
      }
      
      res.json({ 
        answer: rawAnswer,
        suggestedQuestions: suggestedQuestions.slice(0, 3)
      });
    } catch (error) {
      console.error("AI Chat error:", error);
      res.status(500).json({ error: "Kunde inte behandla frågan" });
    }
  });

  // ============================================
  // AI FIELD ASSISTANT
  // ============================================
  // Conversational AI with full system data access via function calling
  //
  // MODELLVAL (aktuell: gpt-4o-mini - mest kostnadseffektiv)
  // -------------------------------------------------------
  // | Modell         | Pris/1M in | Pris/1M ut | Användning                    |
  // |----------------|------------|------------|-------------------------------|
  // | gpt-4o-mini    | $0.15      | $0.60      | Standard - enklare frågor     |
  // | gpt-4o         | $2.50      | $10.00     | Premium - djupare analys      |
  // | gpt-4o-vision  | $2.50      | $10.00     | Enterprise - bildanalys       |
  // | gpt-4.5        | ~$5.00     | ~$15.00    | Pro - avancerad planering     |
  //
  // UPPGRADERINGSMÖJLIGHETER:
  // - Premium (gpt-4o): Bättre resonemang, optimeringsförslag för hela veckan
  // - Enterprise (gpt-4o + vision): Analysera foton av skadade kärl, automatisk rapport
  // - Pro (gpt-4.5): Prediktiv analys, automatisk omplanering vid sjukdom
  //
  // Byt modell genom att ändra "model: gpt-4o-mini" till önskad modell nedan
  // ============================================
  app.post("/api/ai/field-assistant", async (req, res) => {
    try {
      const { question, jobContext, conversationHistory = [] } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Fråga krävs" });
      }

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      // Define tools for data access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools: any[] = [
        {
          type: "function",
          function: {
            name: "get_todays_orders",
            description: "Hämta alla ordrar planerade för idag",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "get_weeks_orders",
            description: "Hämta alla ordrar för denna vecka",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "get_pending_orders",
            description: "Hämta alla ordrar som inte är slutförda",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "get_urgent_orders",
            description: "Hämta alla brådskande ordrar med hög prioritet",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "get_resources",
            description: "Hämta alla resurser (personal och fordon)",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "search_objects",
            description: "Sök efter objekt/platser baserat på namn eller adress",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Sökord för objekt (namn eller adress)" }
              },
              required: ["query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "get_object_details",
            description: "Hämta detaljerad information om ett specifikt objekt (portkod, anteckningar etc)",
            parameters: {
              type: "object",
              properties: {
                objectId: { type: "string", description: "ID för objektet" }
              },
              required: ["objectId"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "get_customers",
            description: "Hämta alla kunder i systemet",
            parameters: { type: "object", properties: {}, required: [] }
          }
        },
        {
          type: "function",
          function: {
            name: "get_system_stats",
            description: "Hämta systemstatistik (antal ordrar, resurser, objekt)",
            parameters: { type: "object", properties: {}, required: [] }
          }
        }
      ];

      // Tool execution helper
      const tenantId = getTenantIdWithFallback(req);
      const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        switch (name) {
          case "get_todays_orders": {
            const orders = await storage.getWorkOrders(tenantId);
            const objects = await storage.getObjects(tenantId);
            const objectMap = new Map(objects.map(o => [o.id, o]));
            
            const todaysOrders = orders.filter(o => {
              if (!o.scheduledDate) return false;
              const orderDate = new Date(o.scheduledDate);
              return orderDate >= today && orderDate < tomorrow;
            });
            
            return JSON.stringify(todaysOrders.map(o => ({
              id: o.id,
              titel: o.title || o.description,
              status: o.status === "completed" ? "Klar" : o.status === "in_progress" ? "Pågår" : "Planerad",
              tid: o.scheduledStartTime,
              plats: o.objectId ? (objectMap.get(o.objectId)?.name || objectMap.get(o.objectId)?.address) : "Okänd",
              adress: o.objectId ? objectMap.get(o.objectId)?.address : null,
              prioritet: o.priority === "high" ? "Hög" : o.priority === "medium" ? "Medium" : "Normal"
            })));
          }
          
          case "get_weeks_orders": {
            const orders = await storage.getWorkOrders(tenantId);
            const objects = await storage.getObjects(tenantId);
            const objectMap = new Map(objects.map(o => [o.id, o]));
            
            const weekOrders = orders.filter(o => {
              if (!o.scheduledDate) return false;
              const orderDate = new Date(o.scheduledDate);
              return orderDate >= weekStart && orderDate <= weekEnd;
            });
            
            return JSON.stringify({
              totalt: weekOrders.length,
              klara: weekOrders.filter(o => o.status === "completed").length,
              kvar: weekOrders.filter(o => o.status !== "completed").length,
              ordrar: weekOrders.slice(0, 10).map(o => ({
                titel: o.title || o.description,
                datum: o.scheduledDate,
                status: o.status,
                plats: o.objectId ? objectMap.get(o.objectId)?.name : null
              }))
            });
          }
          
          case "get_pending_orders": {
            const orders = await storage.getWorkOrders(tenantId);
            const objects = await storage.getObjects(tenantId);
            const objectMap = new Map(objects.map(o => [o.id, o]));
            
            const pending = orders.filter(o => o.status !== "completed" && o.status !== "cancelled");
            return JSON.stringify({
              antal: pending.length,
              ordrar: pending.slice(0, 15).map(o => ({
                titel: o.title || o.description,
                datum: o.scheduledDate,
                plats: o.objectId ? objectMap.get(o.objectId)?.name : null,
                prioritet: o.priority
              }))
            });
          }
          
          case "get_urgent_orders": {
            const orders = await storage.getWorkOrders(tenantId);
            const objects = await storage.getObjects(tenantId);
            const objectMap = new Map(objects.map(o => [o.id, o]));
            
            const urgent = orders.filter(o => o.priority === "high" && o.status !== "completed" && o.status !== "cancelled");
            return JSON.stringify({
              antal: urgent.length,
              ordrar: urgent.map(o => ({
                titel: o.title || o.description,
                datum: o.scheduledDate,
                plats: o.objectId ? objectMap.get(o.objectId)?.name : null,
                adress: o.objectId ? objectMap.get(o.objectId)?.address : null
              }))
            });
          }
          
          case "get_resources": {
            const resources = await storage.getResources(tenantId);
            return JSON.stringify({
              totalt: resources.length,
              aktiva: resources.filter(r => r.status === "active").length,
              resurser: resources.map(r => ({
                namn: r.name,
                typ: r.resourceType === "driver" ? "Förare" : r.resourceType === "vehicle" ? "Fordon" : r.resourceType,
                status: r.status === "active" ? "Aktiv" : "Inaktiv",
                telefon: r.phone
              }))
            });
          }
          
          case "search_objects": {
            const query = (args.query as string || "").toLowerCase();
            const objects = await storage.getObjects(tenantId);
            const matching = objects.filter(o => 
              o.name?.toLowerCase().includes(query) || 
              o.address?.toLowerCase().includes(query)
            ).slice(0, 10);
            
            return JSON.stringify(matching.map(o => ({
              id: o.id,
              namn: o.name,
              adress: o.address,
              portkod: o.accessCode,
              typ: o.objectType
            })));
          }
          
          case "get_object_details": {
            const objectId = args.objectId as string;
            const obj = await storage.getObject(objectId);
            if (!obj) return JSON.stringify({ error: "Objektet hittades inte" });
            
            const customer = obj.customerId ? await storage.getCustomer(obj.customerId) : null;
            
            return JSON.stringify({
              namn: obj.name,
              adress: obj.address,
              portkod: obj.accessCode,
              anteckningar: obj.notes,
              kund: customer?.name,
              typ: obj.objectType,
              lat: obj.latitude,
              lng: obj.longitude
            });
          }
          
          case "get_customers": {
            const customers = await storage.getCustomers(tenantId);
            return JSON.stringify({
              antal: customers.length,
              kunder: customers.slice(0, 20).map(c => ({
                id: c.id,
                namn: c.name,
                kontakt: c.contactPerson,
                telefon: c.phone,
                email: c.email
              }))
            });
          }
          
          case "get_system_stats": {
            const [orders, resources, objects, customers, clusters] = await Promise.all([
              storage.getWorkOrders(tenantId),
              storage.getResources(tenantId),
              storage.getObjects(tenantId),
              storage.getCustomers(tenantId),
              storage.getClusters(tenantId)
            ]);
            
            const completed = orders.filter(o => o.status === "completed").length;
            const pending = orders.filter(o => o.status !== "completed" && o.status !== "cancelled").length;
            
            return JSON.stringify({
              ordrar: { totalt: orders.length, klara: completed, väntande: pending },
              resurser: { totalt: resources.length, aktiva: resources.filter(r => r.status === "active").length },
              objekt: objects.length,
              kunder: customers.length,
              kluster: clusters.length
            });
          }
          
          default:
            return JSON.stringify({ error: "Okänt verktyg" });
        }
      }

      // Use shared persona module for consistent AI personality
      const { buildSystemPromptWithTools } = await import("./ai/persona");
      const systemPrompt = buildSystemPromptWithTools({ role: "field_worker" }) + `

VIKTIGT: Avsluta ALLTID ditt svar med exakt 2-3 föreslagna följdfrågor som användaren kan ställa.
Formatera dem på en ny rad efter ditt svar, med prefixet "FÖLJDFRÅGOR:" följt av frågorna separerade med "|".
Exempel: FÖLJDFRÅGOR:Visa mina ordrar idag|Vilka fordon är tillgängliga|Hur rapporterar jag ett problem`;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messages: any[] = [
        {
          role: "system",
          content: systemPrompt
        }
      ];
      
      // Add conversation history (limit to last 10 messages)
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      
      // Add current question
      messages.push({
        role: "user",
        content: question
      });

      const { trackOpenAIResponse: trackOAIResponse } = await import("./api-usage-tracker");

      // First API call with tools
      let response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 500,
        temperature: 0.5
      });

      trackOAIResponse(response);

      let assistantMessage = response.choices[0]?.message;

      // Handle tool calls (up to 3 iterations)
      let iterations = 0;
      while (assistantMessage?.tool_calls && iterations < 3) {
        iterations++;
        messages.push(assistantMessage);

        // Execute all tool calls
        for (const toolCall of assistantMessage.tool_calls) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tc = toolCall as any;
          const args = JSON.parse(tc.function?.arguments || "{}");
          const result = await executeTool(tc.function?.name, args);
          
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result
          });
        }

        // Get next response
        response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages,
          tools,
          tool_choice: "auto",
          max_tokens: 500,
          temperature: 0.5
        });

        trackOAIResponse(response);

        assistantMessage = response.choices[0]?.message;
      }

      let rawAnswer = assistantMessage?.content || "Jag kunde tyvärr inte hitta ett svar. Försök formulera om din fråga.";
      
      // Parse suggested follow-up questions
      let suggestedQuestions: string[] = [];
      const followUpMatch = rawAnswer.match(/FÖLJDFRÅGOR:([\s\S]+?)$/);
      if (followUpMatch) {
        suggestedQuestions = followUpMatch[1].split("|").map(q => q.trim()).filter(q => q.length > 0);
        rawAnswer = rawAnswer.replace(/\n*FÖLJDFRÅGOR:[\s\S]+$/, "").trim();
      }
      
      res.json({ 
        answer: rawAnswer,
        suggestedQuestions: suggestedQuestions.slice(0, 3)
      });
    } catch (error) {
      console.error("Field AI error:", error);
      res.status(500).json({ error: "Något gick fel" });
    }
  });

  // AI Predictive Maintenance - analyze order history to predict service needs
  app.get("/api/ai/predictive-maintenance", isAuthenticated, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const orders = await storage.getWorkOrders(tenantId);
      const objects = await storage.getObjects(tenantId);
      
      // Build object service history map
      const objectHistory: Map<string, { lastService: Date | null; avgDaysBetweenServices: number; serviceCount: number; objectName: string }> = new Map();
      
      objects.forEach(obj => {
        const objectOrders = orders.filter(o => 
          o.objectId === obj.id && 
          (o.status === "completed" || o.status === "utford" || o.status === "fakturerad")
        ).sort((a, b) => {
          const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return dateB - dateA;
        });
        
        if (objectOrders.length >= 2) {
          const intervals: number[] = [];
          for (let i = 0; i < objectOrders.length - 1; i++) {
            const current = objectOrders[i].completedAt ? new Date(objectOrders[i].completedAt!) : null;
            const previous = objectOrders[i + 1].completedAt ? new Date(objectOrders[i + 1].completedAt!) : null;
            if (current && previous) {
              const daysDiff = (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);
              if (daysDiff > 0 && daysDiff < 365) {
                intervals.push(daysDiff);
              }
            }
          }
          
          if (intervals.length > 0) {
            const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
            const lastService = objectOrders[0].completedAt ? new Date(objectOrders[0].completedAt) : null;
            
            objectHistory.set(obj.id, {
              lastService,
              avgDaysBetweenServices: Math.round(avgInterval),
              serviceCount: objectOrders.length,
              objectName: obj.name
            });
          }
        }
      });
      
      // Predict upcoming service needs
      const predictions: { objectId: string; objectName: string; predictedDate: string; daysUntil: number; confidence: number; avgInterval: number }[] = [];
      const today = new Date();
      
      objectHistory.forEach((history, objectId) => {
        if (history.lastService && history.avgDaysBetweenServices > 0) {
          const predictedDate = new Date(history.lastService);
          predictedDate.setDate(predictedDate.getDate() + history.avgDaysBetweenServices);
          
          const daysUntil = Math.ceil((predictedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          // Only predict within next 30 days
          if (daysUntil >= -7 && daysUntil <= 30) {
            const confidence = Math.min(95, 50 + (history.serviceCount * 5));
            predictions.push({
              objectId,
              objectName: history.objectName,
              predictedDate: predictedDate.toISOString().split("T")[0],
              daysUntil,
              confidence,
              avgInterval: history.avgDaysBetweenServices
            });
          }
        }
      });
      
      // Sort by days until (overdue first, then soonest)
      predictions.sort((a, b) => a.daysUntil - b.daysUntil);
      
      // Separate into overdue and upcoming
      const overdue = predictions.filter(p => p.daysUntil < 0).slice(0, 5);
      const upcoming = predictions.filter(p => p.daysUntil >= 0).slice(0, 10);
      
      res.json({
        overdue,
        upcoming,
        totalPredicted: predictions.length,
        summary: overdue.length > 0 
          ? `${overdue.length} objekt har passerat förväntad servicedag, ${upcoming.length} förväntas inom 30 dagar`
          : `${upcoming.length} objekt förväntas behöva service inom 30 dagar`
      });
    } catch (error) {
      console.error("Predictive maintenance error:", error);
      res.status(500).json({ error: "Kunde inte generera prediktioner" });
    }
  });

  // AI Proactive Tips - background anomaly analysis for proactive suggestions
  // OPTIMIZED: Uses efficient SQL COUNT queries instead of fetching all records
  app.get("/api/ai/proactive-tips", isAuthenticated, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      // Use optimized count queries - much faster than fetching all orders
      const counts = await storage.getWorkOrderCounts(tenantId);
      const activeResourceCount = await storage.getActiveResourceCount(tenantId);
      
      // Detect anomalies
      const tips: { type: string; severity: "info" | "warning" | "critical"; title: string; message: string; action?: string }[] = [];
      
      // Check for overdue orders
      if (counts.overdue > 0) {
        tips.push({
          type: "overdue",
          severity: counts.overdue > 5 ? "critical" : "warning",
          title: "Försenade ordrar",
          message: `Du har ${counts.overdue} ordrar som passerat sitt schemalagda datum.`,
          action: "Se veckoplanering"
        });
      }
      
      // Check for today's workload
      if (counts.todayPending > 0 && activeResourceCount > 0) {
        const ordersPerResource = counts.todayPending / activeResourceCount;
        if (ordersPerResource > 8) {
          tips.push({
            type: "workload",
            severity: "warning",
            title: "Hög arbetsbelastning",
            message: `Idag finns ${counts.todayPending} ordrar för ${activeResourceCount} resurser (${ordersPerResource.toFixed(1)} per resurs).`,
            action: "Granska planeringen"
          });
        }
      }
      
      res.json({ tips: tips.slice(0, 3) }); // Return max 3 tips
    } catch (error) {
      console.error("Proactive tips error:", error);
      res.json({ tips: [] });
    }
  });

  // AI Planning suggestions - now with KPIs
  app.post("/api/ai/planning-suggestions", async (req, res) => {
    try {
      const { generatePlanningSuggestions, calculatePlanningKPIs } = await import("./ai-planner");
      const { weekStart, weekEnd } = req.body;
      
      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getClusters(tenantId),
        storage.getSetupTimeLogs(tenantId),
      ]);
      
      // Pre-calculate KPIs so they can be reused
      const kpis = calculatePlanningKPIs(workOrders, resources, clusters, setupTimeLogs);
      
      const suggestions = await generatePlanningSuggestions({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        setupTimeLogs,
        kpis,
      });
      
      res.json(suggestions);
    } catch (error) {
      console.error("AI Planning error:", error);
      res.status(500).json({ error: "Kunde inte generera planeringsförslag" });
    }
  });

  // AI KPIs endpoint - get planning KPIs for dashboard/analysis
  app.get("/api/ai/kpis", async (req, res) => {
    try {
      const { calculatePlanningKPIs } = await import("./ai-planner");
      const tenantId = getTenantIdWithFallback(req);
      
      const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getClusters(tenantId),
        storage.getSetupTimeLogs(tenantId),
      ]);
      
      const kpis = calculatePlanningKPIs(workOrders, resources, clusters, setupTimeLogs);
      res.json(kpis);
    } catch (error) {
      console.error("AI KPIs error:", error);
      res.status(500).json({ error: "Kunde inte beräkna nyckeltal" });
    }
  });

  // AI Explain Anomaly - get AI explanation for a specific anomaly
  app.post("/api/ai/explain-anomaly", async (req, res) => {
    try {
      const { explainAnomaly } = await import("./ai-planner");
      const { anomalyType, context } = req.body;
      
      if (!anomalyType || !["setup_time", "cost"].includes(anomalyType)) {
        return res.status(400).json({ error: "Ogiltig anomalityp" });
      }
      
      const explanation = await explainAnomaly(anomalyType, context || {});
      res.json(explanation);
    } catch (error) {
      console.error("Explain anomaly error:", error);
      res.status(500).json({ error: "Kunde inte generera förklaring" });
    }
  });

  // AI Auto-Schedule - automatisk schemaläggning av oschemalagda ordrar
  app.post("/api/ai/auto-schedule", async (req, res) => {
    try {
      const { aiEnhancedSchedule } = await import("./ai-planner");
      const { weekStart, weekEnd } = req.body;
      
      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getClusters(tenantId),
        storage.getSetupTimeLogs(tenantId),
      ]);
      
      // Hämta tidsfönster för alla oschemalagda ordrar
      const unscheduledOrderIds = workOrders
        .filter(o => !o.scheduledDate || !o.resourceId)
        .map(o => o.id);
      const timeWindows = await storage.getTaskTimewindowsBatch(unscheduledOrderIds);
      
      const result = await aiEnhancedSchedule({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        setupTimeLogs,
        timeWindows,
      });
      
      res.json(result);
    } catch (error) {
      console.error("AI Auto-Schedule error:", error);
      res.status(500).json({ error: "Kunde inte generera automatisk schemaläggning" });
    }
  });

  // Route optimization per day
  app.post("/api/ai/optimize-routes", async (req, res) => {
    try {
      const { optimizeDayRoutes } = await import("./route-optimizer");
      const { date } = req.body;
      
      if (!date) {
        return res.status(400).json({ error: "date krävs" });
      }
      
      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, objects] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getObjects(tenantId),
      ]);
      
      const result = await optimizeDayRoutes(date, workOrders, resources, objects);
      res.json(result);
    } catch (error) {
      console.error("Route optimization error:", error);
      res.status(500).json({ error: "Kunde inte optimera rutter" });
    }
  });

  // VRP-based route optimization using VROOM/OpenRouteService
  app.post("/api/ai/optimize-vrp", async (req, res) => {
    try {
      const { optimizeRoutesVRP } = await import("./route-optimizer");
      const { date, clusterId } = req.body;
      
      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, objects, clusters] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getObjects(tenantId),
        storage.getClusters(tenantId),
      ]);
      
      // Filter orders if specific date or cluster provided
      let filteredOrders = workOrders;
      
      if (date) {
        filteredOrders = filteredOrders.filter(o => {
          if (!o.scheduledDate) return false;
          const orderDate = o.scheduledDate instanceof Date 
            ? o.scheduledDate.toISOString().split("T")[0]
            : String(o.scheduledDate).split("T")[0];
          return orderDate === date;
        });
      }
      
      if (clusterId) {
        filteredOrders = filteredOrders.filter(o => o.clusterId === clusterId);
      }
      
      // Only include unexecuted orders
      filteredOrders = filteredOrders.filter(o => 
        o.status !== "executed" && o.status !== "invoiced"
      );
      
      const result = await optimizeRoutesVRP(filteredOrders, resources, objects, clusters);
      res.json(result);
    } catch (error) {
      console.error("VRP optimization error:", error);
      res.status(500).json({ error: "Kunde inte optimera rutter med VRP" });
    }
  });

  // AI Route Recommendations - weather and history based suggestions
  app.get("/api/ai/route-recommendations", async (req, res) => {
    try {
      const { fetchWeatherForecast } = await import("./weather-service");
      const tenantId = getTenantIdWithFallback(req);
      const date = req.query.date as string || new Date().toISOString().split("T")[0];
      
      const [workOrders, resources, objects, clusters] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getObjects(tenantId),
        storage.getClusters(tenantId),
      ]);
      
      // Get weather for default location (Umeå)
      const weather = await fetchWeatherForecast(63.826, 20.263, 7);
      const todayWeather = weather.forecasts.find(f => f.date === date);
      const todayImpact = weather.impacts.find(i => i.date === date);
      
      // Filter today's orders - check both legacy status and new orderStatus fields
      const isCompleted = (o: typeof workOrders[0]) => 
        o.orderStatus === "utford" || o.orderStatus === "fakturerad" ||
        o.status === "utford" || o.status === "fakturerad";
      
      const todaysOrders = workOrders.filter(o => {
        if (!o.scheduledDate) return false;
        const orderDate = o.scheduledDate instanceof Date 
          ? o.scheduledDate.toISOString().split("T")[0]
          : String(o.scheduledDate).split("T")[0];
        return orderDate === date && !isCompleted(o);
      });
      
      // Calculate historical stats
      const completedOrders = workOrders.filter(isCompleted);
      const avgDuration = completedOrders.length > 0
        ? completedOrders.reduce((sum, o) => sum + (o.actualDuration || o.estimatedDuration || 60), 0) / completedOrders.length
        : 60;
      
      // Generate AI recommendations
      const recommendations: Array<{
        type: "weather" | "optimization" | "capacity" | "historical";
        priority: "high" | "medium" | "low";
        title: string;
        description: string;
        actionable?: string;
      }> = [];
      
      // Weather-based recommendations
      if (todayImpact && todayImpact.impactLevel !== "none") {
        recommendations.push({
          type: "weather",
          priority: todayImpact.impactLevel === "severe" || todayImpact.impactLevel === "high" ? "high" : "medium",
          title: `Vädervarning: ${todayImpact.reason}`,
          description: todayImpact.recommendations.join(". ") || "Anpassa planering efter väderförhållanden.",
          actionable: `Kapacitet justerad till ${Math.round(todayImpact.capacityMultiplier * 100)}%`,
        });
      }
      
      // Capacity recommendations
      const ordersPerResource: Record<string, number> = {};
      todaysOrders.forEach(o => {
        if (o.resourceId) {
          ordersPerResource[o.resourceId] = (ordersPerResource[o.resourceId] || 0) + 1;
        }
      });
      
      const maxOrders = Math.max(...Object.values(ordersPerResource), 0);
      const minOrders = Math.min(...Object.values(ordersPerResource).filter(n => n > 0), maxOrders);
      
      if (maxOrders > 0 && maxOrders - minOrders > 3) {
        const overloadedResource = resources.find(r => ordersPerResource[r.id] === maxOrders);
        recommendations.push({
          type: "capacity",
          priority: "medium",
          title: "Ojämn arbetsbelastning",
          description: `${overloadedResource?.name || "En resurs"} har ${maxOrders} ordrar medan andra har färre.`,
          actionable: "Omfördela ordrar för bättre balans",
        });
      }
      
      // Route optimization recommendations - check for unassigned orders
      const unassignedOrders = todaysOrders.filter(o => !o.resourceId);
      if (unassignedOrders.length > 3) {
        recommendations.push({
          type: "optimization",
          priority: "medium",
          title: "Ordrar ej tilldelade",
          description: `${unassignedOrders.length} ordrar saknar tilldelad resurs.`,
          actionable: "Kör VRP-optimering för bättre rutter",
        });
      }
      
      // Historical insights
      if (avgDuration > 90) {
        recommendations.push({
          type: "historical",
          priority: "low",
          title: "Längre genomsnittlig tid",
          description: `Genomsnittlig ordertid är ${Math.round(avgDuration)} min. Överväg att planera mer tid per order.`,
        });
      }
      
      res.json({
        date,
        weather: todayWeather ? {
          temperature: todayWeather.temperature,
          precipitation: todayWeather.precipitation,
          windSpeed: todayWeather.windSpeed,
          description: todayWeather.weatherDescription,
          impact: todayImpact?.impactLevel || "none",
          capacityMultiplier: todayImpact?.capacityMultiplier || 1.0,
        } : null,
        statistics: {
          totalOrders: todaysOrders.length,
          assignedOrders: todaysOrders.filter(o => o.resourceId).length,
          activeResources: Object.keys(ordersPerResource).length,
          avgDurationMinutes: Math.round(avgDuration),
        },
        recommendations,
        summary: recommendations.length > 0 
          ? `${recommendations.filter(r => r.priority === "high").length} höga, ${recommendations.filter(r => r.priority === "medium").length} medel prioriterade förslag`
          : "Inga särskilda rekommendationer för idag",
      });
    } catch (error) {
      console.error("Route recommendations error:", error);
      res.status(500).json({ error: "Kunde inte hämta rekommendationer" });
    }
  });

  // Apply VRP optimization - update order sequence
  app.post("/api/ai/optimize-vrp/apply", async (req, res) => {
    try {
      const { routes } = req.body as { 
        routes: Array<{
          resourceId: string;
          stops: Array<{
            orderId: string;
            sequence: number;
          }>;
        }>;
      };
      
      if (!Array.isArray(routes)) {
        return res.status(400).json({ error: "routes måste vara en array" });
      }
      
      const results: Array<{ orderId: string; success: boolean; error?: string }> = [];
      
      for (const route of routes) {
        for (const stop of route.stops) {
          try {
            // Update work order with resource assignment only
            // (sequenceOrder is tracked on assignment_articles, not work_orders)
            const updated = await storage.updateWorkOrder(stop.orderId, {
              resourceId: route.resourceId,
            });
            results.push({ orderId: stop.orderId, success: !!updated });
          } catch (err) {
            results.push({ orderId: stop.orderId, success: false, error: String(err) });
          }
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      res.json({ 
        applied: successCount, 
        total: results.length,
        message: `${successCount} ordrar uppdaterade med optimerad sekvens`,
        results 
      });
    } catch (error) {
      console.error("Apply VRP optimization error:", error);
      res.status(500).json({ error: "Kunde inte tillämpa VRP-optimering" });
    }
  });

  // Apply auto-schedule assignments
  app.post("/api/ai/auto-schedule/apply", async (req, res) => {
    try {
      const { assignments } = req.body as { assignments: Array<{
        workOrderId: string;
        resourceId: string;
        scheduledDate: string;
      }> };
      
      if (!Array.isArray(assignments)) {
        return res.status(400).json({ error: "assignments måste vara en array" });
      }
      
      const results = await Promise.all(
        assignments.map(async (a) => {
          try {
            const updated = await storage.updateWorkOrder(a.workOrderId, {
              resourceId: a.resourceId,
              scheduledDate: new Date(a.scheduledDate + "T12:00:00Z"),
            });
            return { workOrderId: a.workOrderId, success: !!updated };
          } catch (err) {
            return { workOrderId: a.workOrderId, success: false, error: String(err) };
          }
        })
      );
      
      const successCount = results.filter(r => r.success).length;
      res.json({ 
        applied: successCount, 
        total: assignments.length,
        results 
      });
    } catch (error) {
      console.error("Apply auto-schedule error:", error);
      res.status(500).json({ error: "Kunde inte tillämpa schemaläggning" });
    }
  });

  // Workload analysis - detect imbalances
  app.post("/api/ai/workload-analysis", async (req, res) => {
    try {
      const { analyzeWorkloadImbalances } = await import("./ai-planner");
      const { weekStart, weekEnd } = req.body;
      
      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, clusters] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getClusters(tenantId),
      ]);
      
      const analysis = analyzeWorkloadImbalances({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      });
      
      res.json(analysis);
    } catch (error) {
      console.error("Workload analysis error:", error);
      res.status(500).json({ error: "Kunde inte analysera arbetsbelastning" });
    }
  });
  
  app.post("/api/ai/planner-chat", async (req, res) => {
    try {
      const { processConversationalPlannerQueryV2 } = await import("./ai-planner");
      const { query, weekStart, weekEnd, conversationHistory } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Fråga krävs" });
      }
      
      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, clusters] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getClusters(tenantId),
      ]);
      
      const today = new Date().toISOString().split("T")[0];
      const weekEndDefault = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      
      const response = await processConversationalPlannerQueryV2(query, {
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || today,
        weekEnd: weekEnd || weekEndDefault,
      }, conversationHistory || []);
      
      res.json(response);
    } catch (error) {
      console.error("Conversational planner error:", error);
      res.status(500).json({ 
        message: "Ett fel uppstod vid bearbetning av din fråga.",
        followUpQuestions: ["Visa alla ordrar", "Vilka resurser finns?"]
      });
    }
  });
  
  // Execute conversational planner action (reschedule, etc.)
  app.post("/api/ai/planner-chat/execute", async (req, res) => {
    try {
      const { action, params, workOrderIds, toResourceId, toDate } = req.body;
      
      if (!action || typeof action !== "string") {
        return res.status(400).json({ success: false, message: "Åtgärd krävs" });
      }
      
      const tenantId = getTenantIdWithFallback(req);
      
      // Verify orders belong to tenant before modifying
      if (workOrderIds && Array.isArray(workOrderIds)) {
        const tenantOrders = await storage.getWorkOrders(tenantId);
        const tenantOrderIds = new Set(tenantOrders.map(o => o.id));
        const invalidIds = workOrderIds.filter((id: string) => !tenantOrderIds.has(id));
        if (invalidIds.length > 0) {
          return res.status(403).json({ 
            success: false, 
            message: `Åtkomst nekad för ordrar: ${invalidIds.slice(0, 3).join(", ")}` 
          });
        }
      }
      
      if (action === "reschedule_to_resource" && workOrderIds && toResourceId) {
        let successCount = 0;
        for (const orderId of workOrderIds) {
          try {
            await storage.updateWorkOrder(orderId, { resourceId: toResourceId }, tenantId);
            successCount++;
          } catch (e) {
            console.error(`Failed to update order ${orderId}:`, e);
          }
        }
        return res.json({ 
          success: true, 
          message: `${successCount} av ${workOrderIds.length} ordrar har omtilldelats.`,
          affectedOrders: workOrderIds
        });
      }
      
      if (action === "reschedule_to_date" && workOrderIds && toDate) {
        let successCount = 0;
        for (const orderId of workOrderIds) {
          try {
            await storage.updateWorkOrder(orderId, { scheduledDate: toDate }, tenantId);
            successCount++;
          } catch (e) {
            console.error(`Failed to update order ${orderId}:`, e);
          }
        }
        return res.json({ 
          success: true, 
          message: `${successCount} av ${workOrderIds.length} ordrar har flyttats till ${toDate}.`,
          affectedOrders: workOrderIds
        });
      }
      
      res.status(400).json({ success: false, message: "Ogiltig åtgärd eller saknade parametrar." });
    } catch (error) {
      console.error("Planner action error:", error);
      res.status(500).json({ success: false, message: "Kunde inte utföra åtgärden." });
    }
  });

  // AI Setup Time Insights
  app.get("/api/ai/setup-insights", async (req, res) => {
    try {
      const { analyzeSetupTimeLogs } = await import("./ai-planner");
      
      const tenantId = getTenantIdWithFallback(req);
      const [logs, objects, clusters] = await Promise.all([
        storage.getSetupTimeLogs(tenantId),
        storage.getObjects(tenantId),
        storage.getClusters(tenantId),
      ]);
      
      const analysis = analyzeSetupTimeLogs(logs, objects, clusters);
      res.json(analysis);
    } catch (error) {
      console.error("Setup time insights error:", error);
      res.status(500).json({ error: "Kunde inte analysera ställtider" });
    }
  });

  // Apply recommended setup time updates
  app.post("/api/ai/apply-setup-updates", async (req, res) => {
    try {
      const { updates } = req.body;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ error: "Updates måste vara en icke-tom array" });
      }
      
      // Validera varje uppdatering
      const validUpdates = updates.filter(update => 
        typeof update.objectId === "string" && 
        typeof update.suggestedEstimate === "number" &&
        update.suggestedEstimate >= 0
      );
      
      if (validUpdates.length === 0) {
        return res.status(400).json({ error: "Inga giltiga uppdateringar" });
      }
      
      const results = await Promise.all(
        validUpdates.map(async (update: { objectId: string; suggestedEstimate: number }) => {
          try {
            const updated = await storage.updateObject(update.objectId, { 
              avgSetupTime: Math.round(update.suggestedEstimate)
            });
            return { objectId: update.objectId, success: !!updated };
          } catch (e) {
            console.error(`Failed to update object ${update.objectId}:`, e);
            return { objectId: update.objectId, success: false };
          }
        })
      );
      
      const successCount = results.filter(r => r.success).length;
      res.json({ 
        success: successCount > 0, 
        message: `Uppdaterade ${successCount} av ${validUpdates.length} objekt.`,
        results 
      });
    } catch (error) {
      console.error("Apply setup updates error:", error);
      res.status(500).json({ error: "Kunde inte tillämpa uppdateringar" });
    }
  });

  // AI Predictive Planning
  app.get("/api/ai/predictive-planning", async (req, res) => {
    try {
      const weeksAhead = parseInt(req.query.weeksAhead as string) || 4;
      
      const { generatePredictivePlanning } = await import("./ai-planner");
      const tenantId = getTenantIdWithFallback(req);
      const workOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true, 5000);
      const clusters = await storage.getClusters(tenantId);
      const resources = await storage.getResources(tenantId);
      
      const validClusters = clusters.filter(c => c.postalCodes && c.postalCodes.length > 0);
      
      const result = await generatePredictivePlanning(
        workOrders, 
        validClusters.length > 0 ? validClusters : clusters, 
        resources, 
        Math.min(weeksAhead, 12)
      );
      
      res.json(result);
    } catch (error) {
      console.error("Predictive planning error:", error);
      res.status(500).json({ error: "Kunde inte generera prognoser" });
    }
  });

  // Simple weather for today (mobile app)
  app.get("/api/weather/today", async (_req, res) => {
    try {
      const { fetchWeatherForecast } = await import("./weather-service");
      const result = await fetchWeatherForecast(63.826, 20.263, 1);
      
      if (result.forecasts && result.forecasts.length > 0) {
        const today = result.forecasts[0];
        res.json({
          temperature: today.temperature,
          description: today.weatherDescription,
          windSpeed: today.windSpeed,
          precipitation: today.precipitation,
        });
      } else {
        res.json({
          temperature: 5,
          description: "Molnigt",
          windSpeed: 8,
          precipitation: 0,
        });
      }
    } catch (error) {
      console.error("Today weather error:", error);
      res.json({
        temperature: 5,
        description: "Okänt",
        windSpeed: 8,
        precipitation: 0,
      });
    }
  });

  // Weather forecast for capacity planning
  app.get("/api/weather/forecast", async (req, res) => {
    try {
      const latitude = parseFloat(req.query.latitude as string) || 59.3293;
      const longitude = parseFloat(req.query.longitude as string) || 18.0686;
      const days = parseInt(req.query.days as string) || 7;
      
      const { fetchWeatherForecast } = await import("./weather-service");
      const result = await fetchWeatherForecast(latitude, longitude, Math.min(days, 14));
      
      res.json(result);
    } catch (error) {
      console.error("Weather forecast error:", error);
      res.status(500).json({ error: "Kunde inte hämta väderprognos" });
    }
  });

  // Weather impact for specific cluster
  app.get("/api/weather/cluster/:clusterId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const cluster = await storage.getCluster(req.params.clusterId);
      if (!cluster || !verifyTenantOwnership(cluster, tenantId)) {
        return res.status(404).json({ error: "Kluster hittades inte" });
      }
      
      const latitude = cluster.centerLatitude || 59.3293;
      const longitude = cluster.centerLongitude || 18.0686;
      const days = parseInt(req.query.days as string) || 7;
      
      const { fetchWeatherForecast } = await import("./weather-service");
      const result = await fetchWeatherForecast(latitude, longitude, Math.min(days, 14));
      
      res.json({
        ...result,
        location: { ...result.location, name: cluster.name }
      });
    } catch (error) {
      console.error("Cluster weather error:", error);
      res.status(500).json({ error: "Kunde inte hämta väderprognos för kluster" });
    }
  });

  // Multi-strategi klustergenerering
  app.post("/api/clusters/auto-generate", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { strategy, config } = req.body;
      
      if (!strategy || !["geographic", "frequency", "team", "customer", "manual"].includes(strategy)) {
        return res.status(400).json({ error: "Ogiltig strategi. Välj: geographic, frequency, team, customer, manual" });
      }
      
      const allObjects = await storage.getObjects(tenantId);
      const allWorkOrders = await storage.getWorkOrders(tenantId);
      const allCustomers = await storage.getCustomers(tenantId);
      const allResources = await storage.getResources(tenantId);
      
      const woCountPerObject = new Map<string, number>();
      for (const wo of allWorkOrders) {
        if (wo.objectId) woCountPerObject.set(wo.objectId, (woCountPerObject.get(wo.objectId) || 0) + 1);
      }
      
      const COLORS = [
        "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
        "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
        "#14B8A6", "#E11D48", "#A855F7", "#0EA5E9", "#22C55E",
        "#D946EF", "#F43F5E", "#64748B", "#78716C", "#0D9488"
      ];
      let colorIdx = 0;
      const nextColor = () => COLORS[colorIdx++ % COLORS.length];
      
      const computeGroupStats = (objs: typeof allObjects) => {
        const coords = objs.filter(o => o.latitude && o.longitude);
        const centerLat = coords.length > 0 ? coords.reduce((s, o) => s + (o.latitude || 0), 0) / coords.length : null;
        const centerLng = coords.length > 0 ? coords.reduce((s, o) => s + (o.longitude || 0), 0) / coords.length : null;
        const postalCodes = [...new Set(objs.map(o => o.postalCode).filter(Boolean))] as string[];
        const woCount = objs.reduce((sum, o) => sum + (woCountPerObject.get(o.id) || 0), 0);
        return { centerLat, centerLng, postalCodes, woCount };
      };
      
      interface ClusterSuggestion {
        id: string;
        name: string;
        description: string;
        objectIds: string[];
        objectCount: number;
        workOrderCount: number;
        centerLatitude: number | null;
        centerLongitude: number | null;
        radiusKm: number;
        color: string;
        primaryTeamId?: string | null;
        rootCustomerId?: string | null;
        postalCodes: string[];
      }
      
      const suggestions: ClusterSuggestion[] = [];
      const unclusteredObjectIds: string[] = [];
      
      if (strategy === "geographic") {
        const cityGroups = new Map<string, typeof allObjects>();
        for (const obj of allObjects) {
          const city = (obj.city || "Okänd stad").trim();
          if (!cityGroups.has(city)) cityGroups.set(city, []);
          cityGroups.get(city)!.push(obj);
        }
        
        for (const [city, cityObjects] of cityGroups) {
          const stats = computeGroupStats(cityObjects);
          suggestions.push({
            id: `geo-${city.replace(/[^a-zåäö0-9]/gi, "_").toLowerCase()}`,
            name: city,
            description: `${cityObjects.length} objekt i ${city}, ${stats.postalCodes.length} postnummer`,
            objectIds: cityObjects.map(o => o.id),
            objectCount: cityObjects.length,
            workOrderCount: stats.woCount,
            centerLatitude: stats.centerLat,
            centerLongitude: stats.centerLng,
            radiusKm: 5,
            color: nextColor(),
            postalCodes: stats.postalCodes
          });
        }
        
      } else if (strategy === "frequency") {
        const highThreshold = config?.highThreshold || 10;
        const mediumThreshold = config?.mediumThreshold || 3;
        
        const freqCategories: Record<string, typeof allObjects> = { high: [], medium: [], low: [], none: [] };
        for (const obj of allObjects) {
          const count = woCountPerObject.get(obj.id) || 0;
          if (count >= highThreshold) freqCategories.high.push(obj);
          else if (count >= mediumThreshold) freqCategories.medium.push(obj);
          else if (count > 0) freqCategories.low.push(obj);
          else freqCategories.none.push(obj);
        }
        
        const freqLabels: Record<string, string> = {
          high: `Hög frekvens (≥${highThreshold} ordrar)`,
          medium: `Medel frekvens (${mediumThreshold}-${highThreshold - 1} ordrar)`,
          low: `Låg frekvens (1-${mediumThreshold - 1} ordrar)`,
          none: "Inga ordrar"
        };
        
        // Sub-group each frequency category by city
        for (const [freqKey, freqObjects] of Object.entries(freqCategories)) {
          if (freqObjects.length === 0) continue;
          
          const cityGroups = new Map<string, typeof allObjects>();
          for (const obj of freqObjects) {
            const city = (obj.city || "Okänd stad").trim();
            if (!cityGroups.has(city)) cityGroups.set(city, []);
            cityGroups.get(city)!.push(obj);
          }
          
          for (const [city, cityObjects] of cityGroups) {
            const stats = computeGroupStats(cityObjects);
            suggestions.push({
              id: `freq-${freqKey}-${city.replace(/[^a-zåäö0-9]/gi, "_").toLowerCase()}`,
              name: `${city} – ${freqLabels[freqKey]}`,
              description: `${cityObjects.length} objekt med ${freqLabels[freqKey].toLowerCase()} i ${city}`,
              objectIds: cityObjects.map(o => o.id),
              objectCount: cityObjects.length,
              workOrderCount: stats.woCount,
              centerLatitude: stats.centerLat,
              centerLongitude: stats.centerLng,
              radiusKm: 5,
              color: nextColor(),
              postalCodes: stats.postalCodes
            });
          }
        }
        
      } else if (strategy === "team") {
        // Group by resource (who performed the work orders)
        const resourceObjects = new Map<string, Set<string>>();
        const resourceWoCount = new Map<string, number>();
        
        for (const wo of allWorkOrders) {
          const resId = wo.resourceId || "__unassigned__";
          if (!resourceObjects.has(resId)) {
            resourceObjects.set(resId, new Set());
            resourceWoCount.set(resId, 0);
          }
          if (wo.objectId) resourceObjects.get(resId)!.add(wo.objectId);
          resourceWoCount.set(resId, (resourceWoCount.get(resId) || 0) + 1);
        }
        
        // Also find objects without any work orders
        const assignedObjectIds = new Set<string>();
        for (const objIds of resourceObjects.values()) {
          for (const id of objIds) assignedObjectIds.add(id);
        }
        const unassignedObjects = allObjects.filter(o => !assignedObjectIds.has(o.id));
        if (unassignedObjects.length > 0) {
          if (!resourceObjects.has("__unassigned__")) {
            resourceObjects.set("__unassigned__", new Set());
            resourceWoCount.set("__unassigned__", 0);
          }
          for (const o of unassignedObjects) {
            resourceObjects.get("__unassigned__")!.add(o.id);
          }
        }
        
        const objectMap = new Map(allObjects.map(o => [o.id, o]));
        const resourceMap = new Map(allResources.map(r => [r.id, r]));
        
        for (const [resId, objIdSet] of resourceObjects) {
          const objs = [...objIdSet].map(id => objectMap.get(id)).filter(Boolean) as typeof allObjects;
          const resource = resId !== "__unassigned__" ? resourceMap.get(resId) : null;
          const name = resource ? (resource.name || `Resurs ${resId.slice(0, 6)}`) : "Ej tilldelad";
          const stats = computeGroupStats(objs);
          
          suggestions.push({
            id: `team-${resId.slice(0, 8)}`,
            name: `Team: ${name}`,
            description: `${objs.length} objekt, ${resourceWoCount.get(resId) || 0} ordrar`,
            objectIds: objs.map(o => o.id),
            objectCount: objs.length,
            workOrderCount: resourceWoCount.get(resId) || 0,
            centerLatitude: stats.centerLat,
            centerLongitude: stats.centerLng,
            radiusKm: 10,
            color: nextColor(),
            primaryTeamId: resId !== "__unassigned__" ? resId : null,
            postalCodes: stats.postalCodes
          });
        }
        
      } else if (strategy === "customer") {
        // Group by customer
        const customerObjects = new Map<string, typeof allObjects>();
        for (const obj of allObjects) {
          const custId = obj.customerId || "__no_customer__";
          if (!customerObjects.has(custId)) customerObjects.set(custId, []);
          customerObjects.get(custId)!.push(obj);
        }
        
        const customerMap = new Map(allCustomers.map(c => [c.id, c]));
        
        for (const [custId, custObjs] of customerObjects) {
          const customer = custId !== "__no_customer__" ? customerMap.get(custId) : null;
          const name = customer ? (customer.name || `Kund ${custId.slice(0, 6)}`) : "Utan kund";
          const stats = computeGroupStats(custObjs);
          
          suggestions.push({
            id: `cust-${custId.slice(0, 8)}`,
            name: name,
            description: `${custObjs.length} objekt, ${stats.woCount} ordrar`,
            objectIds: custObjs.map(o => o.id),
            objectCount: custObjs.length,
            workOrderCount: stats.woCount,
            centerLatitude: stats.centerLat,
            centerLongitude: stats.centerLng,
            radiusKm: 5,
            color: nextColor(),
            rootCustomerId: custId !== "__no_customer__" ? custId : null,
            postalCodes: stats.postalCodes
          });
        }
        
      } else if (strategy === "manual") {
        const cityStats = new Map<string, number>();
        for (const obj of allObjects) {
          const city = (obj.city || "Okänd stad").trim();
          cityStats.set(city, (cityStats.get(city) || 0) + 1);
        }
        
        const freqStats = { high: 0, medium: 0, low: 0, none: 0 };
        for (const obj of allObjects) {
          const count = woCountPerObject.get(obj.id) || 0;
          if (count >= 10) freqStats.high++;
          else if (count >= 3) freqStats.medium++;
          else if (count > 0) freqStats.low++;
          else freqStats.none++;
        }
        
        return res.json({
          strategy: "manual",
          suggestions: [],
          statistics: {
            totalObjects: allObjects.length,
            totalWorkOrders: allWorkOrders.length,
            totalCustomers: allCustomers.length,
            totalResources: allResources.length,
            objectsWithCoordinates: allObjects.filter(o => o.latitude && o.longitude).length,
            objectsWithoutCoordinates: allObjects.filter(o => !o.latitude || !o.longitude).length,
            citiesBreakdown: [...cityStats.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count),
            frequencyBreakdown: freqStats,
            unclustered: allObjects.filter(o => !o.clusterId).length,
            alreadyClustered: allObjects.filter(o => o.clusterId).length
          }
        });
      }
      
      // Sort by objectCount descending
      suggestions.sort((a, b) => b.objectCount - a.objectCount);
      
      const totalCoveredObjects = suggestions.reduce((s, c) => s + c.objectCount, 0);
      
      res.json({
        strategy,
        suggestions,
        summary: {
          totalSuggested: suggestions.length,
          totalCoveredObjects,
          totalObjects: allObjects.length,
          coverage: allObjects.length > 0 ? Math.round((totalCoveredObjects / allObjects.length) * 100) : 0
        }
      });
    } catch (error) {
      console.error("Multi-strategy auto-cluster error:", error);
      res.status(500).json({ error: "Kunde inte generera klusterförslag" });
    }
  });

  app.post("/api/clusters/auto-generate/recalculate", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { centerLatitude, centerLongitude, radiusKm, currentObjectIds } = req.body;
      
      if (typeof centerLatitude !== "number" || typeof centerLongitude !== "number" || typeof radiusKm !== "number") {
        return res.status(400).json({ error: "centerLatitude, centerLongitude och radiusKm krävs" });
      }
      
      const allObjects = await storage.getObjects(tenantId);
      
      const toRad = (deg: number) => deg * Math.PI / 180;
      const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      
      const objectIds: string[] = [];
      for (const obj of allObjects) {
        if (obj.latitude && obj.longitude) {
          const dist = haversine(centerLatitude, centerLongitude, obj.latitude, obj.longitude);
          if (dist <= radiusKm) {
            objectIds.push(obj.id);
          }
        }
      }
      
      res.json({ objectIds, objectCount: objectIds.length });
    } catch (error) {
      console.error("Recalculate cluster error:", error);
      res.status(500).json({ error: "Kunde inte beräkna om kluster" });
    }
  });

  // Applicera kluster från multi-strategi förslag
  app.post("/api/clusters/auto-generate/apply", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { suggestions } = req.body;
      
      if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
        return res.status(400).json({ error: "Inga förslag att tillämpa" });
      }
      
      let totalObjectsLinked = 0;
      let totalWorkOrdersLinked = 0;
      const createdClusters: any[] = [];
      const errors: string[] = [];
      
      for (const suggestion of suggestions) {
        if (!suggestion.name || typeof suggestion.name !== "string") {
          errors.push("Saknar klusternamn");
          continue;
        }
        
        try {
          const cluster = await storage.createCluster({
            tenantId,
            name: String(suggestion.name).trim(),
            description: String(suggestion.description || "").trim() || null,
            centerLatitude: typeof suggestion.centerLatitude === "number" ? suggestion.centerLatitude : null,
            centerLongitude: typeof suggestion.centerLongitude === "number" ? suggestion.centerLongitude : null,
            radiusKm: typeof suggestion.radiusKm === "number" ? Math.min(suggestion.radiusKm, 50) : 5,
            postalCodes: Array.isArray(suggestion.postalCodes) ? suggestion.postalCodes.map((pc: unknown) => String(pc)) : [],
            color: typeof suggestion.color === "string" ? suggestion.color : "#3B82F6",
            rootCustomerId: suggestion.rootCustomerId || null,
            primaryTeamId: suggestion.primaryTeamId || null,
            slaLevel: "standard",
            defaultPeriodicity: "vecka",
            status: "active"
          });
          
          // Link objects to cluster
          const objectIds = suggestion.objectIds || [];
          if (objectIds.length > 0) {
            const batchSize = 500;
            for (let i = 0; i < objectIds.length; i += batchSize) {
              const batch = objectIds.slice(i, i + batchSize);
              await db.update(objects)
                .set({ clusterId: cluster.id })
                .where(and(
                  inArray(objects.id, batch),
                  eq(objects.tenantId, tenantId),
                  isNull(objects.deletedAt)
                ));
            }
            totalObjectsLinked += objectIds.length;
            
            for (let i = 0; i < objectIds.length; i += batchSize) {
              const woBatch = objectIds.slice(i, i + batchSize);
              const woResult = await db.update(workOrders)
                .set({ clusterId: cluster.id })
                .where(and(
                  inArray(workOrders.objectId, woBatch),
                  eq(workOrders.tenantId, tenantId),
                  isNull(workOrders.deletedAt)
                ))
                .returning({ id: workOrders.id });
              totalWorkOrdersLinked += woResult.length;
            }
          }
          
          // Update all cached stats from actual DB counts
          await storage.updateClusterCaches(cluster.id);
          
          createdClusters.push({
            id: cluster.id,
            name: cluster.name,
            objectCount: objectIds.length
          });
        } catch (err) {
          errors.push(`${suggestion.name}: Kunde inte skapa kluster - ${(err as Error).message}`);
        }
      }
      
      res.json({
        success: createdClusters.length > 0,
        message: `Skapade ${createdClusters.length} kluster. ${totalObjectsLinked} objekt och ${totalWorkOrdersLinked} arbetsordrar kopplades.`,
        clusters: createdClusters,
        totalObjectsLinked,
        totalWorkOrdersLinked,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Apply multi-strategy cluster error:", error);
      res.status(500).json({ error: "Kunde inte skapa kluster" });
    }
  });

  // AI Auto-Clustering - Föreslå optimala klustergränser
  app.get("/api/ai/auto-cluster", async (req, res) => {
    try {
      const targetSize = parseInt(req.query.targetSize as string) || 50;
      
      const { generateAutoClusterSuggestions } = await import("./ai-planner");
      const tenantId = getTenantIdWithFallback(req);
      const objects = await storage.getObjects(tenantId);
      const clusters = await storage.getClusters(tenantId);
      
      const result = await generateAutoClusterSuggestions(objects, clusters, targetSize);
      
      res.json(result);
    } catch (error) {
      console.error("Auto-cluster error:", error);
      res.status(500).json({ error: "Kunde inte generera klusterförslag" });
    }
  });

  // Skapa kluster från AI-förslag
  app.post("/api/ai/auto-cluster/apply", async (req, res) => {
    try {
      const { suggestions } = req.body;
      
      if (!suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
        return res.status(400).json({ error: "Inga förslag att tillämpa" });
      }
      
      const createdClusters = [];
      const errors: string[] = [];
      let totalObjectsLinked = 0;
      let totalWorkOrdersLinked = 0;
      
      const tenantId = getTenantIdWithFallback(req);
      
      for (const suggestion of suggestions) {
        if (!suggestion.suggestedName || typeof suggestion.suggestedName !== "string") {
          errors.push("Saknar eller ogiltigt klusternamn");
          continue;
        }
        if (!Array.isArray(suggestion.postalCodes) || suggestion.postalCodes.length === 0) {
          errors.push(`${suggestion.suggestedName}: Saknar postnummer`);
          continue;
        }
        
        try {
          const cluster = await storage.createCluster({
            tenantId,
            name: String(suggestion.suggestedName).trim(),
            description: String(suggestion.rationale || "").trim() || null,
            centerLatitude: typeof suggestion.centerLatitude === "number" ? suggestion.centerLatitude : null,
            centerLongitude: typeof suggestion.centerLongitude === "number" ? suggestion.centerLongitude : null,
            radiusKm: typeof suggestion.radiusKm === "number" ? Math.min(suggestion.radiusKm, 50) : 5,
            postalCodes: suggestion.postalCodes.map((pc: unknown) => String(pc)),
            color: typeof suggestion.color === "string" ? suggestion.color : "#3B82F6",
            slaLevel: "standard",
            defaultPeriodicity: "vecka",
            status: "active"
          });

          const postalCodes = suggestion.postalCodes.map((pc: unknown) => String(pc).replace(/\s/g, ""));
          const normalizedPostals = [...new Set(postalCodes)];
          
          if (normalizedPostals.length > 0) {
            const matchingObjects = await db.select({ id: objects.id, postalCode: objects.postalCode })
              .from(objects)
              .where(and(
                eq(objects.tenantId, tenantId),
                isNull(objects.deletedAt),
                isNull(objects.clusterId)
              ));
            
            const objectsToLink = matchingObjects.filter(obj => {
              const objPostal = (obj.postalCode || "").replace(/\s/g, "");
              return normalizedPostals.some(pc => objPostal === pc || objPostal.startsWith(pc));
            });
            
            if (objectsToLink.length > 0) {
              const objectIds = objectsToLink.map(o => o.id);
              const batchSize = 500;
              for (let i = 0; i < objectIds.length; i += batchSize) {
                const batch = objectIds.slice(i, i + batchSize);
                await db.update(objects)
                  .set({ clusterId: cluster.id })
                  .where(and(
                    inArray(objects.id, batch),
                    eq(objects.tenantId, tenantId),
                    isNull(objects.deletedAt)
                  ));
              }
              totalObjectsLinked += objectIds.length;

              for (let i = 0; i < objectIds.length; i += batchSize) {
                const woBatch = objectIds.slice(i, i + batchSize);
                const woResult = await db.update(workOrders)
                  .set({ clusterId: cluster.id })
                  .where(and(
                    inArray(workOrders.objectId, woBatch),
                    eq(workOrders.tenantId, tenantId),
                    isNull(workOrders.deletedAt)
                  ))
                  .returning({ id: workOrders.id });
                totalWorkOrdersLinked += woResult.length;
              }
            }
          }

          await storage.updateClusterCaches(cluster.id);
          createdClusters.push(cluster);
        } catch (err) {
          errors.push(`${suggestion.suggestedName}: Kunde inte skapa kluster`);
        }
      }
      
      res.json({ 
        success: createdClusters.length > 0, 
        message: errors.length > 0
          ? `Skapade ${createdClusters.length} kluster med ${totalObjectsLinked} objekt och ${totalWorkOrdersLinked} ordrar. ${errors.length} fel uppstod.`
          : `Skapade ${createdClusters.length} nya kluster med ${totalObjectsLinked} objekt och ${totalWorkOrdersLinked} ordrar.`,
        clusters: createdClusters,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Apply auto-cluster error:", error);
      res.status(500).json({ error: "Kunde inte skapa kluster" });
    }
  });

  // Delete all data (for re-import)
  app.get("/api/import/batches", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const allObjects = await storage.getObjects(tenantId);
      const allWorkOrders = await storage.getWorkOrders(tenantId);
      const allCustomers = await storage.getCustomers(tenantId);
      
      const batchMap = new Map<string, { batchId: string; objects: number; workOrders: number; customers: number; importedAt: string | null }>();
      
      for (const obj of allObjects) {
        if (obj.importBatchId) {
          if (!batchMap.has(obj.importBatchId)) {
            batchMap.set(obj.importBatchId, { batchId: obj.importBatchId, objects: 0, workOrders: 0, customers: 0, importedAt: obj.createdAt ? new Date(obj.createdAt).toISOString() : null });
          }
          batchMap.get(obj.importBatchId)!.objects++;
        }
      }
      
      for (const wo of allWorkOrders) {
        if (wo.importBatchId) {
          if (!batchMap.has(wo.importBatchId)) {
            batchMap.set(wo.importBatchId, { batchId: wo.importBatchId, objects: 0, workOrders: 0, customers: 0, importedAt: wo.createdAt ? new Date(wo.createdAt).toISOString() : null });
          }
          batchMap.get(wo.importBatchId)!.workOrders++;
        }
      }
      
      for (const c of allCustomers) {
        if (c.importBatchId) {
          if (!batchMap.has(c.importBatchId)) {
            batchMap.set(c.importBatchId, { batchId: c.importBatchId, objects: 0, workOrders: 0, customers: 0, importedAt: c.createdAt ? new Date(c.createdAt).toISOString() : null });
          }
          batchMap.get(c.importBatchId)!.customers++;
        }
      }
      
      const batches = Array.from(batchMap.values()).sort((a, b) => 
        (b.importedAt || '').localeCompare(a.importedAt || '')
      );
      
      res.json(batches);
    } catch (error) {
      console.error("Failed to list import batches:", error);
      res.status(500).json({ error: "Kunde inte lista import-batchar" });
    }
  });

  app.delete("/api/import/batch/:batchId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { batchId } = req.params;
      
      let deletedObjects = 0;
      let deletedWorkOrders = 0;
      let deletedCustomers = 0;
      
      let deletedWorkOrderLines = 0;
      const allWorkOrders = await storage.getWorkOrders(tenantId);
      for (const wo of allWorkOrders) {
        if (wo.importBatchId === batchId) {
          const lines = await storage.getWorkOrderLines(wo.id);
          for (const line of lines) {
            await storage.deleteWorkOrderLine(line.id);
            deletedWorkOrderLines++;
          }
          await storage.deleteWorkOrder(wo.id);
          deletedWorkOrders++;
        }
      }
      
      const allObjects = await storage.getObjects(tenantId);
      const batchObjects = allObjects.filter(o => o.importBatchId === batchId);
      const childFirst = batchObjects.sort((a, b) => (b.objectLevel || 0) - (a.objectLevel || 0));
      for (const obj of childFirst) {
        await storage.deleteObject(obj.id);
        deletedObjects++;
      }
      
      const allCustomers = await storage.getCustomers(tenantId);
      for (const c of allCustomers) {
        if (c.importBatchId === batchId) {
          await storage.deleteCustomer(c.id);
          deletedCustomers++;
        }
      }
      
      res.json({ 
        deleted: { objects: deletedObjects, workOrders: deletedWorkOrders, customers: deletedCustomers, workOrderLines: deletedWorkOrderLines },
        batchId 
      });
    } catch (error) {
      console.error("Failed to undo import batch:", error);
      res.status(500).json({ error: "Kunde inte ångra import" });
    }
  });

  app.delete("/api/import/clear/:type", async (req, res) => {
    try {
      const { type } = req.params;
      const tenantId = getTenantIdWithFallback(req);
      
      if (type === "customers") {
        const customers = await storage.getCustomers(tenantId);
        for (const c of customers) {
          await storage.deleteCustomer(c.id);
        }
        res.json({ deleted: customers.length });
      } else if (type === "resources") {
        const resources = await storage.getResources(tenantId);
        for (const r of resources) {
          await storage.deleteResource(r.id);
        }
        res.json({ deleted: resources.length });
      } else if (type === "objects") {
        const objects = await storage.getObjects(tenantId);
        for (const o of objects) {
          await storage.deleteObject(o.id);
        }
        res.json({ deleted: objects.length });
      } else if (type === "work-orders") {
        const workOrders = await storage.getWorkOrders(tenantId);
        for (const wo of workOrders) {
          await storage.deleteWorkOrder(wo.id);
        }
        res.json({ deleted: workOrders.length });
      } else {
        res.status(400).json({ error: "Okänd typ" });
      }
    } catch (error) {
      console.error("Clear error:", error);
      res.status(500).json({ error: "Kunde inte rensa data" });
    }
  });

  // Notification token endpoint - generates auth token for WebSocket connection
  // Requires authentication and validates resource ownership
  app.post("/api/notifications/token", isAuthenticated, async (req: any, res) => {
    try {
      const { resourceId } = req.body;
      
      if (!resourceId) {
        return res.status(400).json({ error: "resourceId required" });
      }
      
      // Validate resource exists
      const resource = await storage.getResource(resourceId);
      if (!resource) {
        return res.status(404).json({ error: "Resource not found" });
      }
      
      // Verify resource belongs to the same tenant
      // In production, you might also verify that the authenticated user
      // is allowed to access this specific resource
      const tenantId = getTenantIdWithFallback(req);
      if (resource.tenantId !== tenantId) {
        console.log(`[notifications] Token request denied: resource ${resourceId} belongs to different tenant`);
        return res.status(403).json({ error: "Not authorized to access this resource" });
      }
      
      // Generate token for this resource
      const token = notificationService.generateAuthToken(resourceId);
      
      console.log(`[notifications] Token generated for resource ${resourceId} by user ${req.user?.claims?.sub || "unknown"}`);
      
      res.json({ 
        token,
        expiresIn: 300, // 5 minutes
        resourceId 
      });
    } catch (error) {
      console.error("Failed to generate notification token:", error);
      res.status(500).json({ error: "Failed to generate token" });
    }
  });

  // ========================================
  // MOBILE APP API ENDPOINTS
  // ========================================
  
  // Simple token storage for mobile auth (in production, use Redis or database)
  const mobileTokens = new Map<string, { resourceId: string; expiresAt: number }>();
  
  function generateMobileToken(): string {
    return Array.from({ length: 64 }, () => 
      Math.random().toString(36).charAt(2)
    ).join('');
  }
  
  function validateMobileToken(token: string): string | null {
    const tokenData = mobileTokens.get(token);
    if (!tokenData) return null;
    if (Date.now() > tokenData.expiresAt) {
      mobileTokens.delete(token);
      return null;
    }
    return tokenData.resourceId;
  }
  
  // Middleware to check mobile auth
  function isMobileAuthenticated(req: any, res: any, next: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = authHeader.substring(7);
    const resourceId = validateMobileToken(token);
    
    if (!resourceId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    req.mobileResourceId = resourceId;
    next();
  }

  // Mobile login - authenticate with email and PIN
  app.post("/api/mobile/login", async (req, res) => {
    try {
      const { email, pin, username, password } = req.body;
      
      const tenantId = getTenantIdWithFallback(req);
      const resources = await storage.getResources(tenantId);
      let resource: any = null;

      if (pin && !email && !username) {
        resource = resources.find(r => r.pin === pin && r.status === 'active');
      } else if (username && password) {
        resource = resources.find(r =>
          (r.email?.toLowerCase() === username.toLowerCase() || r.name?.toLowerCase() === username.toLowerCase()) && r.status === 'active'
        );
        if (resource && resource.pin && resource.pin !== password) {
          resource = null;
        }
      } else if (email && pin) {
        resource = resources.find(r =>
          r.email?.toLowerCase() === email.toLowerCase() && r.status === 'active'
        );
        if (resource) {
          if (resource.pin) {
            if (resource.pin !== pin) resource = null;
          } else {
            if (pin.length < 4 || pin.length > 6) {
              return res.status(401).json({ error: "PIN must be 4-6 digits" });
            }
          }
        }
      } else {
        return res.status(400).json({ error: "PIN or username/password required" });
      }

      if (!resource) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      const token = generateMobileToken();
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
      
      mobileTokens.set(token, { resourceId: resource.id, expiresAt });
      
      console.log(`[mobile] Login successful for resource ${resource.name} (${resource.id})`);
      
      res.json({
        token,
        user: {
          id: resource.id,
          name: resource.name,
          role: resource.resourceType || "driver",
          resourceId: resource.id,
          vehicleRegNo: "",
          executionCodes: resource.executionCodes || [],
        },
        success: true,
        resource: {
          id: resource.id,
          tenantId: resource.tenantId,
          userId: resource.userId,
          name: resource.name,
          initials: resource.initials,
          resourceType: resource.resourceType,
          phone: resource.phone,
          email: resource.email,
          homeLocation: resource.homeLocation,
          homeLatitude: resource.homeLatitude,
          homeLongitude: resource.homeLongitude,
          status: resource.status,
          executionCodes: resource.executionCodes || [],
        },
      });
    } catch (error) {
      console.error("Mobile login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
  
  // Mobile logout
  app.post("/api/mobile/logout", isMobileAuthenticated, async (req: any, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader.substring(7);
      mobileTokens.delete(token);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Logout failed" });
    }
  });
  
  // Get current resource info
  app.get("/api/mobile/me", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resource = await storage.getResource(req.mobileResourceId);
      if (!resource) {
        return res.status(404).json({ error: "Resource not found" });
      }
      res.json(resource);
    } catch (error) {
      console.error("Failed to get resource:", error);
      res.status(500).json({ error: "Failed to get resource" });
    }
  });
  
  // Get work orders for the logged-in resource
  app.get("/api/mobile/my-orders", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const dateParam = req.query.date as string;
      
      // Get all work orders for this resource
      const tenantId = getTenantIdWithFallback(req);
      const allOrders = await storage.getWorkOrders(tenantId);
      
      // Filter by resource
      let orders = allOrders.filter(o => o.resourceId === resourceId);
      
      // Filter by date if provided
      if (dateParam) {
        const targetDate = new Date(dateParam);
        targetDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(targetDate);
        nextDay.setDate(nextDay.getDate() + 1);
        
        orders = orders.filter(o => {
          if (!o.scheduledDate) return false;
          const orderDate = new Date(o.scheduledDate);
          return orderDate >= targetDate && orderDate < nextDay;
        });
      }
      
      // Sort by scheduled time
      orders.sort((a, b) => {
        if (!a.scheduledStartTime && !b.scheduledStartTime) return 0;
        if (!a.scheduledStartTime) return 1;
        if (!b.scheduledStartTime) return -1;
        return a.scheduledStartTime.localeCompare(b.scheduledStartTime);
      });
      
      // Enrich with object and customer info
      const enrichedOrders = await Promise.all(orders.map(async (order) => {
        const object = order.objectId ? await storage.getObject(order.objectId) : null;
        const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;
        
        return {
          ...order,
          objectName: object?.name,
          objectAddress: object?.address,
          customerName: customer?.name,
          customerPhone: customer?.phone,
        };
      }));
      
      const syncLogs = await storage.getOfflineSyncLogs(resourceId);
      const processingSync = syncLogs.filter(l => l.status === "processing").length;
      const failedSync = syncLogs.filter(l => l.status === "error").length;
      const unreadNotifs = await storage.getUnreadNotificationCount(resourceId);

      res.json({
        orders: enrichedOrders,
        total: enrichedOrders.length,
        syncStatus: {
          processingActions: processingSync,
          failedActions: failedSync,
          lastSync: syncLogs[0]?.createdAt || null,
        },
        unreadNotifications: unreadNotifs,
      });
    } catch (error) {
      console.error("Failed to get mobile orders:", error);
      res.status(500).json({ error: "Failed to get orders" });
    }
  });
  
  // Get single work order details
  app.get("/api/mobile/orders/:id", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      
      const order = await storage.getWorkOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Verify this order belongs to the resource
      if (order.resourceId !== resourceId) {
        return res.status(403).json({ error: "Not authorized" });
      }
      
      // Enrich with object and customer info
      const object = order.objectId ? await storage.getObject(order.objectId) : null;
      const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;
      
      res.json({
        ...order,
        objectName: object?.name,
        objectAddress: object?.address,
        objectLatitude: object?.latitude,
        objectLongitude: object?.longitude,
        accessCode: object?.accessCode,
        keyNumber: object?.keyNumber,
        objectNotes: object?.notes,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        customerEmail: customer?.email,
      });
    } catch (error) {
      console.error("Failed to get order details:", error);
      res.status(500).json({ error: "Failed to get order" });
    }
  });
  
  // Update work order status from mobile
  app.patch("/api/mobile/orders/:id/status", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      const { status, notes } = req.body;
      
      const order = await storage.getWorkOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      if (order.resourceId !== resourceId) {
        return res.status(403).json({ error: "Not authorized" });
      }
      
      const updateData: any = {};
      
      if (status === 'paborjad' || status === 'in_progress') {
        updateData.status = 'in_progress';
        updateData.orderStatus = 'planerad_resurs';
        updateData.executionStatus = 'on_site';
        updateData.onSiteAt = new Date();
      } else if (status === 'en_route') {
        updateData.status = 'in_progress';
        updateData.executionStatus = 'on_way';
        updateData.onWayAt = new Date();
      } else if (status === 'planned') {
        updateData.status = 'planned';
        updateData.executionStatus = 'planned_fine';
      } else if (status === 'utford' || status === 'completed') {
        updateData.status = 'completed';
        updateData.orderStatus = 'utford';
        updateData.executionStatus = 'completed';
        updateData.completedAt = new Date();
      } else if (status === 'ej_utford' || status === 'deferred') {
        updateData.status = 'deferred';
        updateData.orderStatus = 'skapad';
        if (notes) {
          updateData.notes = order.notes 
            ? `${order.notes}\n\nUppskjuten: ${notes}` 
            : `Uppskjuten: ${notes}`;
        }
      } else if (status === 'cancelled') {
        updateData.status = 'cancelled';
        updateData.orderStatus = 'skapad';
        if (notes) {
          updateData.notes = order.notes 
            ? `${order.notes}\n\nInställd: ${notes}` 
            : `Inställd: ${notes}`;
        }
      }
      
      const updatedOrder = await storage.updateWorkOrder(orderId, updateData);
      
      console.log(`[mobile] Order ${orderId} status updated to ${status} by resource ${resourceId}`);
      
      const mobileTenantId = order.tenantId;
      if (mobileTenantId) {
        handleWorkOrderStatusChange(orderId, order.status, status, mobileTenantId).catch(err =>
          console.error("[ai-communication] Mobile event hook error:", err)
        );
      }

      res.json(updatedOrder);

      broadcastPlannerEvent({
        type: 'status_changed',
        data: { orderId, orderNumber: updatedOrder.title || `WO-${orderId.substring(0,8)}`, oldStatus: 'unknown', newStatus: status, driverName: '', timestamp: new Date().toISOString() }
      });
    } catch (error) {
      console.error("Failed to update order status:", error);
      res.status(500).json({ error: "Failed to update status" });
    }
  });
  
  // Add note to work order
  app.post("/api/mobile/orders/:id/notes", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      const { note } = req.body;
      
      if (!note || !note.trim()) {
        return res.status(400).json({ error: "Note is required" });
      }
      
      const order = await storage.getWorkOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      if (order.resourceId !== resourceId) {
        return res.status(403).json({ error: "Not authorized" });
      }
      
      const timestamp = new Date().toLocaleString('sv-SE');
      const newNote = `[${timestamp}] ${note.trim()}`;
      const updatedNotes = order.notes 
        ? `${order.notes}\n${newNote}` 
        : newNote;
      
      const updatedOrder = await storage.updateWorkOrder(orderId, { notes: updatedNotes });
      
      res.json(updatedOrder);
    } catch (error) {
      console.error("Failed to add note:", error);
      res.status(500).json({ error: "Failed to add note" });
    }
  });

  // ============================================
  // POSITION TRACKING API ENDPOINTS
  // ============================================

  app.post("/api/resources/position", isAuthenticated, async (req: any, res) => {
    try {
      const { resourceId, latitude, longitude, speed, heading, accuracy, status, workOrderId } = req.body;
      
      if (!resourceId) {
        return res.status(400).json({ error: "resourceId is required" });
      }
      if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      const resource = await storage.getResource(resourceId);
      if (!resource) {
        return res.status(404).json({ error: "Resource not found" });
      }
      const tenantId = getTenantIdWithFallback(req);
      if (resource.tenantId && resource.tenantId !== tenantId) {
        return res.status(403).json({ error: "Access denied" });
      }

      await notificationService.handlePositionUpdate({
        resourceId,
        latitude,
        longitude,
        speed: speed || 0,
        heading: heading || 0,
        accuracy: accuracy || 0,
        status: status || "traveling",
        workOrderId
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update resource position:", error);
      res.status(500).json({ error: "Failed to update position" });
    }
  });
  
  // Update position from mobile app (also handled via WebSocket)
  app.post("/api/mobile/position", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const { latitude, longitude, speed, heading, accuracy, status, workOrderId } = req.body;
      
      // Validate coordinates - allow 0 values (equator/prime meridian)
      if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }
      
      // Use the notification service to handle position update (broadcasts to planners)
      await notificationService.handlePositionUpdate({
        resourceId,
        latitude,
        longitude,
        speed,
        heading,
        accuracy,
        status: status || "traveling",
        workOrderId
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update position:", error);
      res.status(500).json({ error: "Failed to update position" });
    }
  });

  // ============================================
  // DRIVER CORE FIELD APP API - Extended Endpoints
  // ============================================

  async function enrichOrderForMobile(order: any, storage: any) {
    const object = order.objectId ? await storage.getObject(order.objectId) : null;
    const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;

    const [dependencies, lines, timeRestrictions] = await Promise.all([
      storage.getTaskDependencies(order.id).catch(() => []),
      storage.getWorkOrderLines(order.id).catch(() => []),
      order.objectId ? storage.getObjectTimeRestrictions(order.objectId).catch(() => []) : Promise.resolve([]),
    ]);

    const depDetails = await Promise.all(
      dependencies.map(async (dep: any) => {
        const depOrder = await storage.getWorkOrder(dep.dependsOnWorkOrderId).catch(() => null);
        return {
          orderId: dep.dependsOnWorkOrderId,
          orderNumber: depOrder?.title || dep.dependsOnWorkOrderId,
          status: depOrder?.status || "unknown",
          type: dep.dependencyType === "sequential" ? "must_complete_first" : dep.dependencyType,
        };
      })
    );

    const enrichedLines = await Promise.all(
      lines.map(async (line: any) => {
        const article = await storage.getArticle(line.articleId).catch(() => null);
        return {
          id: line.id,
          articleId: line.articleId,
          articleNumber: article?.articleNumber || "",
          articleName: article?.name || "",
          quantity: line.quantity,
          completed: false,
        };
      })
    );

    const metadata: any = order.metadata || {};
    const completedSubSteps: string[] = metadata.completedSubSteps || [];

    const structuralArticles = order.structuralArticleId
      ? await storage.getStructuralArticlesByParent(order.structuralArticleId).catch(() => [])
      : [];
    const subSteps = structuralArticles.map((sa: any, idx: number) => ({
      id: sa.id,
      label: sa.stepLabel || `Steg ${idx + 1}`,
      completed: completedSubSteps.includes(sa.id),
    }));

    const noteParts = order.notes
      ? order.notes.split("\n").filter((n: string) => n.trim()).map((n: string, idx: number) => ({
          id: `n${idx + 1}`,
          text: n.trim(),
          createdAt: order.createdAt,
          author: "System",
        }))
      : [];

    const restrictions = timeRestrictions.length > 0
      ? {
          earliestPickup: timeRestrictions.find((r: any) => r.startTime)?.startTime || null,
          latestPickup: timeRestrictions.find((r: any) => r.endTime)?.endTime || null,
          earliestDelivery: null,
          latestDelivery: null,
        }
      : null;

    const executionCodes = order.executionCode
      ? [{ id: order.executionCode, code: (order.executionCode as string).toUpperCase().substring(0, 4), name: order.executionCode }]
      : [];

    return {
      id: order.id,
      orderNumber: order.title || `WO-${order.id.substring(0, 8)}`,
      status: order.status,
      executionStatus: order.executionStatus,
      customerName: customer?.name || "",
      address: object?.address || "",
      city: object?.city || "",
      postalCode: object?.postalCode || "",
      latitude: object?.latitude || order.taskLatitude,
      longitude: object?.longitude || order.taskLongitude,
      contactName: customer?.contactPerson || customer?.name || "",
      contactPhone: customer?.phone || "",
      scheduledDate: order.scheduledDate,
      scheduledTimeStart: order.scheduledStartTime || null,
      scheduledTimeEnd: order.plannedWindowEnd || null,
      description: order.description || "",
      priority: order.priority || "normal",
      estimatedDuration: order.estimatedDuration || 60,
      wasteType: object?.objectType || "",
      containerType: object?.name || "",
      containerCount: object?.containerCount || 0,
      what3words: order.what3words || "",
      executionCodes,
      dependencies: depDetails,
      timeRestrictions: restrictions,
      subSteps: subSteps.length > 0 ? subSteps : enrichedLines.map((l: any) => ({
        id: l.id,
        label: l.articleName || `Artikel ${l.articleNumber}`,
        completed: completedSubSteps.includes(l.id),
      })),
      orderNotes: noteParts,
      objectId: order.objectId,
      customerId: order.customerId,
      resourceId: order.resourceId,
      notes: order.notes,
    };
  }

  app.get("/api/mobile/orders", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const resource = await storage.getResource(resourceId);
      if (!resource) return res.status(404).json({ error: "Resource not found" });

      const tenantId = resource.tenantId;
      const allOrders = await storage.getWorkOrders(tenantId);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const orders = allOrders.filter(o => {
        if (o.resourceId !== resourceId) return false;
        if (!o.scheduledDate) return false;
        const d = new Date(o.scheduledDate);
        return d >= today && d < tomorrow;
      });

      orders.sort((a, b) => {
        if (!a.scheduledStartTime && !b.scheduledStartTime) return 0;
        if (!a.scheduledStartTime) return 1;
        if (!b.scheduledStartTime) return -1;
        return a.scheduledStartTime.localeCompare(b.scheduledStartTime);
      });

      const enriched = await Promise.all(orders.map(o => enrichOrderForMobile(o, storage)));
      res.json(enriched);
    } catch (error) {
      console.error("Failed to get mobile orders:", error);
      res.status(500).json({ error: "Failed to get orders" });
    }
  });

  app.patch("/api/mobile/orders/:id/substeps/:stepId", isMobileAuthenticated, async (req: any, res) => {
    try {
      const { id: orderId, stepId } = req.params;
      const resourceId = req.mobileResourceId;
      const { completed } = req.body;

      const order = await storage.getWorkOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.resourceId !== resourceId) return res.status(403).json({ error: "Not authorized" });

      const metadata: any = order.metadata || {};
      if (!metadata.completedSubSteps) metadata.completedSubSteps = [];
      if (completed && !metadata.completedSubSteps.includes(stepId)) {
        metadata.completedSubSteps.push(stepId);
      } else if (!completed) {
        metadata.completedSubSteps = metadata.completedSubSteps.filter((s: string) => s !== stepId);
      }

      await storage.updateWorkOrder(orderId, { metadata });
      res.json({ success: true, stepId, completed });
    } catch (error) {
      console.error("Failed to update substep:", error);
      res.status(500).json({ error: "Failed to update substep" });
    }
  });

  app.post("/api/mobile/orders/:id/deviations", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      const { type, description, latitude, longitude, photos } = req.body;

      const order = await storage.getWorkOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.resourceId !== resourceId) return res.status(403).json({ error: "Not authorized" });

      const resource = await storage.getResource(resourceId);

      const DEVIATION_TYPE_MAP: Record<string, string> = {
        blocked_access: "Blockerad åtkomst",
        damaged_container: "Skadat kärl",
        wrong_waste: "Felaktigt avfall",
        overloaded: "Överlastat",
        other: "Övrigt",
      };

      const deviation = await storage.createDeviationReport({
        tenantId: order.tenantId,
        workOrderId: orderId,
        objectId: order.objectId,
        category: type || "other",
        title: DEVIATION_TYPE_MAP[type] || type || "Avvikelse",
        description: description || "",
        severityLevel: "medium",
        reportedByName: resource?.name || "Fältarbetare",
        latitude: latitude || null,
        longitude: longitude || null,
        photos: photos || [],
        status: "reported",
      });

      console.log(`[mobile] Deviation reported for order ${orderId} by resource ${resourceId}`);
      res.json({ success: true, deviation });

      broadcastPlannerEvent({
        type: 'deviation_reported',
        data: { orderId, orderNumber: '', deviationType: type, description: description || '', driverName: '', timestamp: new Date().toISOString() }
      });
    } catch (error) {
      console.error("Failed to create deviation:", error);
      res.status(500).json({ error: "Failed to create deviation" });
    }
  });

  app.post("/api/mobile/orders/:id/materials", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      const { articleId, articleNumber, articleName, quantity } = req.body;

      const order = await storage.getWorkOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.resourceId !== resourceId) return res.status(403).json({ error: "Not authorized" });

      let resolvedArticleId = articleId;
      if (!resolvedArticleId && articleNumber) {
        const articles = await storage.getArticles(order.tenantId);
        const found = articles.find(a => a.articleNumber === articleNumber);
        if (found) resolvedArticleId = found.id;
      }

      if (!resolvedArticleId) {
        return res.status(400).json({ error: "Article ID or valid article number required" });
      }

      const line = await storage.createWorkOrderLine({
        tenantId: order.tenantId,
        workOrderId: orderId,
        articleId: resolvedArticleId,
        quantity: quantity || 1,
      });

      console.log(`[mobile] Material logged for order ${orderId}: ${articleName || articleNumber} x${quantity}`);
      res.json({ success: true, line });
    } catch (error) {
      console.error("Failed to log material:", error);
      res.status(500).json({ error: "Failed to log material" });
    }
  });

  app.get("/api/mobile/articles", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const resource = await storage.getResource(resourceId);
      if (!resource) return res.status(404).json({ error: "Resource not found" });

      const search = (req.query.search as string || "").toLowerCase();
      const articles = await storage.getArticles(resource.tenantId);

      const filtered = search
        ? articles.filter(a =>
            a.name.toLowerCase().includes(search) ||
            a.articleNumber.toLowerCase().includes(search) ||
            (a.description && a.description.toLowerCase().includes(search))
          )
        : articles;

      res.json(filtered.slice(0, 50).map(a => ({
        id: a.id,
        articleNumber: a.articleNumber,
        name: a.name,
        unit: a.unit || "st",
        category: a.articleType,
      })));
    } catch (error) {
      console.error("Failed to search articles:", error);
      res.status(500).json({ error: "Failed to search articles" });
    }
  });

  app.post("/api/mobile/orders/:id/signature", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      const { signature } = req.body;

      if (!signature) return res.status(400).json({ error: "Signature data required" });

      const order = await storage.getWorkOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.resourceId !== resourceId) return res.status(403).json({ error: "Not authorized" });

      const resource = await storage.getResource(resourceId);

      const protocol = await storage.createProtocol({
        tenantId: order.tenantId,
        workOrderId: orderId,
        objectId: order.objectId,
        protocolType: "service",
        executedAt: new Date(),
        executedByName: resource?.name || "Fältarbetare",
        signature,
        signedAt: new Date(),
        status: "completed",
      });

      console.log(`[mobile] Signature captured for order ${orderId} by resource ${resourceId}`);
      res.json({ success: true, protocol });
    } catch (error) {
      console.error("Failed to save signature:", error);
      res.status(500).json({ error: "Failed to save signature" });
    }
  });

  app.post("/api/mobile/orders/:id/inspections", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;
      const { inspections } = req.body;

      if (!inspections || !Array.isArray(inspections)) {
        return res.status(400).json({ error: "Inspections array required" });
      }

      const order = await storage.getWorkOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.resourceId !== resourceId) return res.status(403).json({ error: "Not authorized" });

      const results = await Promise.all(
        inspections.map((insp: any) =>
          storage.createInspectionMetadata({
            tenantId: order.tenantId,
            workOrderId: orderId,
            objectId: order.objectId,
            inspectionType: insp.category || "Övrigt",
            status: insp.status || "ok",
            issues: insp.issues || [],
            comment: insp.comment || null,
            inspectedBy: resourceId,
          })
        )
      );

      console.log(`[mobile] ${results.length} inspections saved for order ${orderId}`);
      res.json({ success: true, inspections: results });
    } catch (error) {
      console.error("Failed to save inspections:", error);
      res.status(500).json({ error: "Failed to save inspections" });
    }
  });

  app.post("/api/mobile/gps", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const { latitude, longitude, speed, heading, accuracy, currentOrderId, currentOrderNumber, vehicleRegNo, driverName } = req.body;

      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
      }

      await notificationService.handlePositionUpdate({
        resourceId,
        latitude,
        longitude,
        speed: speed || 0,
        heading: heading || 0,
        accuracy: accuracy || 0,
        status: currentOrderId ? "on_site" : "traveling",
        workOrderId: currentOrderId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Failed to update GPS:", error);
      res.status(500).json({ error: "Failed to update GPS" });
    }
  });

  app.get("/api/mobile/summary", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const resource = await storage.getResource(resourceId);
      if (!resource) return res.status(404).json({ error: "Resource not found" });

      const tenantId = resource.tenantId;
      const allOrders = await storage.getWorkOrders(tenantId);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayOrders = allOrders.filter(o => {
        if (o.resourceId !== resourceId) return false;
        if (!o.scheduledDate) return false;
        const d = new Date(o.scheduledDate);
        return d >= today && d < tomorrow;
      });

      const completedOrders = todayOrders.filter(o => o.status === "completed").length;
      const totalDuration = todayOrders.reduce((sum, o) => sum + (o.estimatedDuration || 0), 0);

      res.json({
        totalOrders: todayOrders.length,
        completedOrders,
        remainingOrders: todayOrders.length - completedOrders,
        totalDuration,
      });
    } catch (error) {
      console.error("Failed to get summary:", error);
      res.status(500).json({ error: "Failed to get summary" });
    }
  });

  app.get("/api/mobile/weather", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string) || 57.7089;
      const lon = parseFloat(req.query.lon as string) || 11.9746;

      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&current_weather=true&timezone=Europe/Stockholm`
      );
      const data = await weatherRes.json();
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch weather:", error);
      res.status(500).json({ error: "Failed to fetch weather" });
    }
  });

  app.post("/api/mobile/ai/chat", isMobileAuthenticated, async (req: any, res) => {
    try {
      const { message, context } = req.body;
      if (!message) return res.status(400).json({ error: "Message required" });

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Du är en hjälpsam AI-assistent för fältarbetare inom avfallshantering och fastighetsskötsel i Sverige. Svara alltid på svenska. Var kortfattad och praktisk. " +
              (context ? `Kontext: Order ${context.orderNumber || ""}, Kund: ${context.customerName || ""}` : ""),
          },
          { role: "user", content: message },
        ],
        max_tokens: 500,
      });

      res.json({ response: completion.choices[0]?.message?.content || "Inget svar" });
    } catch (error) {
      console.error("Failed AI chat:", error);
      res.status(500).json({ error: "Failed to get AI response" });
    }
  });

  app.post("/api/mobile/ai/transcribe", isMobileAuthenticated, async (req: any, res) => {
    try {
      const { audio } = req.body;
      if (!audio) return res.status(400).json({ error: "Audio data required" });

      const buffer = Buffer.from(audio, "base64");
      const blob = new Blob([buffer], { type: "audio/webm" });
      const file = new File([blob], "audio.webm", { type: "audio/webm" });

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();
      const transcription = await openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
        language: "sv",
      });

      res.json({ text: transcription.text });
    } catch (error) {
      console.error("Failed transcription:", error);
      res.status(500).json({ error: "Failed to transcribe audio" });
    }
  });

  app.post("/api/mobile/ai/analyze-image", isMobileAuthenticated, async (req: any, res) => {
    try {
      const { image, context } = req.body;
      if (!image) return res.status(400).json({ error: "Image data required" });

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Du analyserar bilder för fältarbetare inom avfallshantering. Svara på svenska med JSON-format: {category, description, severity}. Severity: low/medium/high. " +
              (context ? `Kontext: ${context}` : ""),
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analysera denna bild och identifiera eventuella problem eller avvikelser." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
            ],
          },
        ],
        max_tokens: 300,
      });

      const responseText = completion.choices[0]?.message?.content || "";
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { category: "unknown", description: responseText, severity: "medium" };
        res.json(parsed);
      } catch {
        res.json({ category: "unknown", description: responseText, severity: "medium" });
      }
    } catch (error) {
      console.error("Failed image analysis:", error);
      res.status(500).json({ error: "Failed to analyze image" });
    }
  });

  // ============================================
  // OFFLINE SYNC API (Mobile Field App)
  // ============================================

  app.post("/api/mobile/sync", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const resource = await storage.getResource(resourceId);
      if (!resource) return res.status(404).json({ error: "Resource not found" });
      const tenantId = resource.tenantId;
      const { actions } = req.body;

      if (!actions || !Array.isArray(actions)) {
        return res.status(400).json({ error: "actions array required" });
      }

      const results: Array<{ clientId: string; status: string; error?: string }> = [];

      for (const action of actions) {
        const { clientId, actionType, payload } = action;
        if (!clientId || !actionType) {
          results.push({ clientId: clientId || "unknown", status: "error", error: "clientId and actionType required" });
          continue;
        }

        const logEntry = await storage.createOfflineSyncLog({
          tenantId,
          resourceId,
          clientId,
          actionType,
          payload: payload || {},
          status: "processing",
        });

        const verifyOrder = async (orderId: string): Promise<{ order: any; error?: string }> => {
          if (!orderId) return { order: null, error: "orderId required" };
          const order = await storage.getWorkOrder(orderId);
          if (!order) return { order: null, error: "Order not found" };
          if (order.tenantId !== tenantId) return { order: null, error: "Not authorized" };
          if (order.resourceId !== resourceId) return { order: null, error: "Not authorized" };
          return { order };
        };

        try {
          switch (actionType) {
            case "status_update": {
              const { orderId, status: newStatus } = payload;
              if (!orderId || !newStatus) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "orderId and status required");
                results.push({ clientId, status: "error", error: "orderId and status required" });
                break;
              }
              const { order, error } = await verifyOrder(orderId);
              if (!order) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
                results.push({ clientId, status: "error", error });
                break;
              }
              await storage.updateWorkOrder(orderId, { status: newStatus });
              await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
              results.push({ clientId, status: "completed" });
              break;
            }
            case "note": {
              const { orderId, text } = payload;
              if (!orderId || !text) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "orderId and text required");
                results.push({ clientId, status: "error", error: "orderId and text required" });
                break;
              }
              const { order, error } = await verifyOrder(orderId);
              if (!order) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
                results.push({ clientId, status: "error", error });
                break;
              }
              const existingNotes = Array.isArray(order.notes) ? order.notes : [];
              await storage.updateWorkOrder(orderId, {
                notes: [...existingNotes, { text, by: resourceId, at: new Date().toISOString() }] as any,
              });
              await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
              results.push({ clientId, status: "completed" });
              break;
            }
            case "deviation": {
              const { orderId, description, severity, category } = payload;
              if (!orderId) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "orderId required");
                results.push({ clientId, status: "error", error: "orderId required" });
                break;
              }
              const { order, error } = await verifyOrder(orderId);
              if (!order) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
                results.push({ clientId, status: "error", error });
                break;
              }
              const existingDeviations = Array.isArray(order.deviations) ? order.deviations : [];
              await storage.updateWorkOrder(orderId, {
                deviations: [...existingDeviations, {
                  description: description || "",
                  severity: severity || "medium",
                  category: category || "other",
                  reportedBy: resourceId,
                  reportedAt: new Date().toISOString(),
                }] as any,
              });
              await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
              results.push({ clientId, status: "completed" });
              break;
            }
            case "material": {
              const { orderId, articleId, quantity, comment } = payload;
              if (!orderId || !articleId) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "orderId and articleId required");
                results.push({ clientId, status: "error", error: "orderId and articleId required" });
                break;
              }
              const { order, error } = await verifyOrder(orderId);
              if (!order) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
                results.push({ clientId, status: "error", error });
                break;
              }
              const materials = Array.isArray(order.materialsUsed) ? order.materialsUsed : [];
              await storage.updateWorkOrder(orderId, {
                materialsUsed: [...materials, {
                  articleId,
                  quantity: quantity || 1,
                  comment: comment || "",
                  loggedBy: resourceId,
                  loggedAt: new Date().toISOString(),
                }] as any,
              });
              await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
              results.push({ clientId, status: "completed" });
              break;
            }
            case "gps": {
              const { latitude, longitude, speed, heading, accuracy } = payload;
              if (latitude !== undefined && longitude !== undefined) {
                await notificationService.handlePositionUpdate({
                  resourceId,
                  latitude,
                  longitude,
                  speed: speed || 0,
                  heading: heading || 0,
                  accuracy: accuracy || 0,
                  status: "traveling",
                });
                await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
                results.push({ clientId, status: "completed" });
              } else {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "latitude and longitude required");
                results.push({ clientId, status: "error", error: "latitude and longitude required" });
              }
              break;
            }
            case "inspection": {
              const { orderId, inspections } = payload;
              if (!orderId || !Array.isArray(inspections)) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "orderId and inspections required");
                results.push({ clientId, status: "error", error: "orderId and inspections required" });
                break;
              }
              const { order, error } = await verifyOrder(orderId);
              if (!order) {
                await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
                results.push({ clientId, status: "error", error });
                break;
              }
              await Promise.all(inspections.map((insp: any) =>
                storage.createInspectionMetadata({
                  tenantId,
                  workOrderId: orderId,
                  objectId: order.objectId!,
                  inspectionType: insp.category || "Övrigt",
                  status: insp.status || "ok",
                  issues: insp.issues || [],
                  comment: insp.comment || null,
                  inspectedBy: resourceId,
                })
              ));
              await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
              results.push({ clientId, status: "completed" });
              break;
            }
            default: {
              await storage.updateOfflineSyncLogStatus(logEntry.id, "error", `Unknown actionType: ${actionType}`);
              results.push({ clientId, status: "error", error: `Unknown actionType: ${actionType}` });
            }
          }
        } catch (err: any) {
          await storage.updateOfflineSyncLogStatus(logEntry.id, "error", err.message || "Processing failed");
          results.push({ clientId, status: "error", error: err.message || "Processing failed" });
        }
      }

      const completed = results.filter(r => r.status === "completed").length;
      const failed = results.filter(r => r.status === "error").length;

      console.log(`[mobile-sync] Processed ${actions.length} actions for resource ${resourceId}: ${completed} completed, ${failed} failed`);

      res.json({
        success: true,
        processed: actions.length,
        completed,
        failed,
        results,
      });
    } catch (error) {
      console.error("Failed to process sync:", error);
      res.status(500).json({ error: "Failed to process sync" });
    }
  });

  app.get("/api/mobile/sync/status", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const status = (req.query.status as string) || undefined;
      const logs = await storage.getOfflineSyncLogs(resourceId, status);

      const processing = logs.filter(l => l.status === "processing").length;
      const completed = logs.filter(l => l.status === "completed").length;
      const failed = logs.filter(l => l.status === "error").length;

      res.json({
        syncStatus: {
          processing,
          completed,
          failed,
          total: logs.length,
          lastSync: logs[0]?.createdAt || null,
        },
        recentLogs: logs.slice(0, 20).map(l => ({
          id: l.id,
          clientId: l.clientId,
          actionType: l.actionType,
          status: l.status,
          errorMessage: l.errorMessage,
          createdAt: l.createdAt,
          processedAt: l.processedAt,
        })),
      });
    } catch (error) {
      console.error("Failed to get sync status:", error);
      res.status(500).json({ error: "Failed to get sync status" });
    }
  });

  // ============================================
  // CHECKLIST TEMPLATES API
  // ============================================

  app.get("/api/checklist-templates", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const templates = await storage.getChecklistTemplates(tenantId);
      res.json(templates);
    } catch (error) {
      console.error("Failed to get checklist templates:", error);
      res.status(500).json({ error: "Failed to get checklist templates" });
    }
  });

  app.get("/api/checklist-templates/:id", isAuthenticated, async (req: any, res) => {
    try {
      const template = await storage.getChecklistTemplate(req.params.id);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to get template" });
    }
  });

  app.post("/api/checklist-templates", isAuthenticated, async (req: any, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { name, articleType, questions, isActive } = req.body;

      if (!name || !articleType) {
        return res.status(400).json({ error: "name and articleType required" });
      }

      const template = await storage.createChecklistTemplate({
        tenantId,
        name,
        articleType,
        questions: questions || [],
        isActive: isActive !== false,
      });

      console.log(`[checklist] Template "${name}" created for articleType "${articleType}"`);
      res.json(template);
    } catch (error) {
      console.error("Failed to create checklist template:", error);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.patch("/api/checklist-templates/:id", isAuthenticated, async (req: any, res) => {
    try {
      const template = await storage.updateChecklistTemplate(req.params.id, req.body);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete("/api/checklist-templates/:id", isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteChecklistTemplate(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  app.get("/api/mobile/orders/:id/checklist", isMobileAuthenticated, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const resourceId = req.mobileResourceId;

      const order = await storage.getWorkOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.resourceId !== resourceId) return res.status(403).json({ error: "Not authorized" });

      const resource = await storage.getResource(resourceId);
      if (!resource) return res.status(404).json({ error: "Resource not found" });

      const lines = await storage.getWorkOrderLines(orderId);
      const articleIds = lines.map(l => l.articleId).filter(Boolean);

      let articleTypes: string[] = [];
      if (articleIds.length > 0) {
        const articles = await storage.getArticles(resource.tenantId);
        articleTypes = [...new Set(
          articles.filter(a => articleIds.includes(a.id)).map(a => a.articleType)
        )];
      }

      if (articleTypes.length === 0) {
        articleTypes = ["tjanst"];
      }

      const allTemplates: any[] = [];
      for (const at of articleTypes) {
        const templates = await storage.getChecklistTemplatesByArticleType(resource.tenantId, at);
        allTemplates.push(...templates);
      }

      const uniqueTemplates = Array.from(new Map(allTemplates.map(t => [t.id, t])).values());

      res.json({
        orderId,
        articleTypes,
        checklists: uniqueTemplates.map(t => ({
          templateId: t.id,
          name: t.name,
          articleType: t.articleType,
          questions: t.questions,
        })),
      });
    } catch (error) {
      console.error("Failed to get checklist for order:", error);
      res.status(500).json({ error: "Failed to get checklist" });
    }
  });

  // ============================================
  // DRIVER PUSH NOTIFICATIONS API
  // ============================================

  app.get("/api/mobile/notifications", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const unreadOnly = req.query.unread === "true";
      const limit = parseInt(req.query.limit as string) || 50;

      const notifications = await storage.getDriverNotifications(resourceId, { unreadOnly, limit });
      const unreadCount = await storage.getUnreadNotificationCount(resourceId);

      res.json({
        notifications,
        unreadCount,
        total: notifications.length,
      });
    } catch (error) {
      console.error("Failed to get driver notifications:", error);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  app.patch("/api/mobile/notifications/:id/read", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const notification = await storage.markDriverNotificationRead(req.params.id, resourceId);
      if (!notification) return res.status(404).json({ error: "Notification not found" });
      res.json(notification);
    } catch (error) {
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  app.patch("/api/mobile/notifications/read-all", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const count = await storage.markAllDriverNotificationsRead(resourceId);
      res.json({ success: true, markedRead: count });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark all as read" });
    }
  });

  app.get("/api/mobile/notifications/count", isMobileAuthenticated, async (req: any, res) => {
    try {
      const resourceId = req.mobileResourceId;
      const unreadCount = await storage.getUnreadNotificationCount(resourceId);
      res.json({ unreadCount });
    } catch (error) {
      res.status(500).json({ error: "Failed to get notification count" });
    }
  });

  // ============================================
  // PLANNER VIEW API ENDPOINTS (Driver Core)
  // ============================================

  app.get("/api/planner/drivers/locations", async (req, res) => {
    try {
      const resources = await storage.getActiveResourcePositions();
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const locations = resources
        .filter(r => r.currentLatitude && r.currentLongitude && r.lastPositionUpdate && new Date(r.lastPositionUpdate) > cutoff)
        .map(r => ({
          driverId: r.id,
          driverName: r.name,
          vehicleRegNo: "",
          latitude: r.currentLatitude,
          longitude: r.currentLongitude,
          speed: 0,
          heading: 0,
          status: r.trackingStatus || "offline",
          currentOrderId: null,
          currentOrderNumber: null,
          updatedAt: r.lastPositionUpdate,
        }));

      res.json(locations);
    } catch (error) {
      console.error("Failed to get driver locations:", error);
      res.status(500).json({ error: "Failed to get driver locations" });
    }
  });

  app.get("/api/planner/orders", async (req, res) => {
    try {
      const range = req.query.range as string || "today";
      const tenantId = getTenantIdWithFallback(req);
      const allOrders = await storage.getWorkOrders(tenantId);

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endRange = new Date(startOfDay);

      if (range === "week") {
        endRange.setDate(endRange.getDate() + 7);
      } else {
        endRange.setDate(endRange.getDate() + 1);
      }

      const filtered = allOrders.filter(o => {
        if (!o.scheduledDate) return false;
        const d = new Date(o.scheduledDate);
        return d >= startOfDay && d < endRange;
      });

      const enriched = await Promise.all(
        filtered.map(async (order) => {
          const object = order.objectId ? await storage.getObject(order.objectId) : null;
          const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;
          return {
            id: order.id,
            orderNumber: order.title || `WO-${order.id.substring(0, 8)}`,
            status: order.status,
            customerName: customer?.name || "",
            address: object?.address || "",
            latitude: object?.latitude || order.taskLatitude,
            longitude: object?.longitude || order.taskLongitude,
            scheduledDate: order.scheduledDate,
            scheduledTimeStart: order.scheduledStartTime,
            priority: order.priority,
            resourceId: order.resourceId,
            description: order.description,
          };
        })
      );

      res.json(enriched);
    } catch (error) {
      console.error("Failed to get planner orders:", error);
      res.status(500).json({ error: "Failed to get planner orders" });
    }
  });

  // Helper to broadcast planner events via SSE
  function broadcastPlannerEvent(event: { type: string; data: any }) {
    const clients: Map<string, any> = (global as any).__plannerEventClients || new Map();
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    clients.forEach((res, id) => {
      try { res.write(msg); } catch(e) { clients.delete(id); }
    });
  }

  // SSE endpoint for real-time planner events
  app.get("/api/planner/events", (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const clientId = Date.now().toString();
    if (!(global as any).__plannerEventClients) {
      (global as any).__plannerEventClients = new Map();
    }
    const clients: Map<string, any> = (global as any).__plannerEventClients;
    clients.set(clientId, res);

    res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

    req.on('close', () => {
      clients.delete(clientId);
    });
  });

  app.get("/api/planner/routes", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const allOrders = await storage.getWorkOrders(tenantId);
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const todayOrders = allOrders.filter(o => {
        if (!o.scheduledDate || !o.resourceId) return false;
        const d = new Date(o.scheduledDate);
        return d >= startOfDay && d < endOfDay;
      });

      const byResource: Record<string, any[]> = {};
      for (const order of todayOrders) {
        if (!byResource[order.resourceId!]) byResource[order.resourceId!] = [];
        const obj = order.objectId ? await storage.getObject(order.objectId) : null;
        byResource[order.resourceId!].push({
          id: order.id,
          orderNumber: order.title || `WO-${order.id.substring(0, 8)}`,
          latitude: obj?.latitude || order.taskLatitude,
          longitude: obj?.longitude || order.taskLongitude,
          scheduledTimeStart: order.scheduledStartTime,
          status: order.status,
          sequence: order.sequenceNumber || 0,
        });
      }

      const resources = await storage.getResources(tenantId);
      const resourceMap = new Map(resources.map(r => [r.id, r]));

      const routes = Object.entries(byResource).map(([resourceId, orders]) => {
        const resource = resourceMap.get(resourceId);
        const sorted = orders
          .filter(o => o.latitude && o.longitude)
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || (a.scheduledTimeStart || '').localeCompare(b.scheduledTimeStart || ''));
        return {
          resourceId,
          resourceName: resource?.name || 'Okänd',
          color: resource?.color || null,
          waypoints: sorted.map(o => ({
            id: o.id,
            orderNumber: o.orderNumber,
            lat: o.latitude,
            lng: o.longitude,
            status: o.status,
          })),
        };
      }).filter(r => r.waypoints.length >= 2);

      res.json(routes);
    } catch (error) {
      console.error("Failed to get planner routes:", error);
      res.status(500).json({ error: "Failed to get planner routes" });
    }
  });

  app.patch("/api/planner/orders/:id/reassign", async (req, res) => {
    try {
      const orderId = req.params.id;
      const { resourceId } = req.body;
      if (!resourceId) return res.status(400).json({ error: "resourceId krävs" });

      const tenantId = getTenantIdWithFallback(req);
      const resource = await storage.getResource(resourceId);
      if (!resource) return res.status(404).json({ error: "Resurs hittades inte" });

      const existingOrder = await storage.getWorkOrder(orderId);
      if (!existingOrder) return res.status(404).json({ error: "Order hittades inte" });
      if (existingOrder.tenantId && existingOrder.tenantId !== tenantId) {
        return res.status(403).json({ error: "Åtkomst nekad" });
      }

      const updated = await storage.updateWorkOrder(orderId, { resourceId });
      if (!updated) return res.status(404).json({ error: "Order hittades inte" });

      broadcastPlannerEvent({
        type: 'order_reassigned',
        data: {
          orderId,
          orderNumber: updated.title || `WO-${orderId.substring(0, 8)}`,
          newResourceId: resourceId,
          newResourceName: resource.name,
          timestamp: new Date().toISOString(),
        }
      });

      res.json({ success: true, orderId, resourceId, resourceName: resource.name });
    } catch (error) {
      console.error("Failed to reassign order:", error);
      res.status(500).json({ error: "Failed to reassign order" });
    }
  });

  app.get("/planner/map", (req, res) => {
    const STATUS_COLORS: Record<string, string> = {
      planned: "#8E44AD",
      en_route: "#F39C12",
      in_progress: "#27AE60",
      completed: "#1B8553",
      deferred: "#E74C3C",
      cancelled: "#95A5A6",
      draft: "#6C757D",
    };

    const ROUTE_COLORS = ['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#F97316','#6366F1','#14B8A6'];

    const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unicorn - Planerarvy</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#1a1a2e}
#map{position:absolute;top:0;right:0;bottom:0;left:280px}
.driver-panel{position:absolute;top:0;left:0;bottom:0;width:280px;background:#1a1a2e;color:#fff;overflow-y:auto;border-right:1px solid #2d2d4a;z-index:1001}
.driver-panel h2{padding:16px;font-size:16px;border-bottom:1px solid #2d2d4a;display:flex;align-items:center;gap:8px}
.driver-card{padding:12px 16px;border-bottom:1px solid #2d2d4a;cursor:pointer;transition:background .2s}
.driver-card:hover{background:#2d2d4a}
.driver-card.active{background:#3B82F6;background:rgba(59,130,246,0.2);border-left:3px solid #3B82F6}
.driver-card h4{font-size:14px;margin:0 0 4px}
.driver-card p{font-size:12px;color:#aaa;margin:0}
.driver-status{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.driver-status.online{background:#27AE60}
.driver-status.traveling{background:#F39C12}
.driver-status.on_site{background:#3B82F6}
.driver-status.offline{background:#95A5A6}
.controls{position:absolute;top:10px;right:10px;z-index:1000;display:flex;gap:8px;flex-wrap:wrap}
.controls button{padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}
.btn-active{background:#8E44AD;color:#fff}
.btn-inactive{background:rgba(255,255,255,0.9);color:#333}
.btn-inactive:hover{background:#fff}
.btn-route{background:#3B82F6;color:#fff}
.btn-route:hover{background:#2563EB}
.btn-route-off{background:rgba(255,255,255,0.9);color:#333}
.legend{position:absolute;bottom:20px;right:10px;z-index:1000;background:rgba(26,26,46,0.95);padding:12px 16px;border-radius:10px;color:#fff;font-size:12px}
.legend-item{display:flex;align-items:center;gap:8px;margin:4px 0}
.legend-dot{width:10px;height:10px;border-radius:50%}
.legend-sq{width:10px;height:10px;border-radius:2px}
.status-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;color:#fff}
.driver-popup{min-width:180px}
.driver-popup h3{margin:0 0 4px;font-size:14px}
.driver-popup p{margin:2px 0;font-size:12px;color:#666}
.job-popup{min-width:220px}
.job-popup h3{margin:0 0 4px;font-size:14px}
.job-popup p{margin:2px 0;font-size:12px;color:#666}
.info-bar{position:absolute;top:10px;left:290px;z-index:1000;background:rgba(26,26,46,0.95);padding:10px 16px;border-radius:10px;color:#fff;font-size:13px}
.toast-container{position:fixed;bottom:20px;right:20px;z-index:2000;display:flex;flex-direction:column-reverse;gap:8px;max-width:380px}
.toast{padding:12px 16px;border-radius:10px;color:#fff;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn .3s ease;display:flex;align-items:flex-start;gap:10px;cursor:pointer;transition:opacity .3s}
.toast:hover{opacity:0.8}
.toast-status{background:linear-gradient(135deg,#27AE60,#1B8553)}
.toast-deviation{background:linear-gradient(135deg,#E74C3C,#C0392B)}
.toast-reassign{background:linear-gradient(135deg,#3B82F6,#2563EB)}
.toast-icon{font-size:18px;flex-shrink:0}
.toast-body{flex:1}
.toast-title{font-weight:600;margin-bottom:2px}
.toast-msg{font-size:12px;opacity:0.9}
.toast-time{font-size:11px;opacity:0.6;margin-top:2px}
@keyframes slideIn{from{transform:translateX(100px);opacity:0}to{transform:translateX(0);opacity:1}}
.reassign-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:3000;display:flex;align-items:center;justify-content:center}
.reassign-dialog{background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
.reassign-dialog h3{margin:0 0 12px;font-size:18px;color:#1a1a2e}
.reassign-dialog p{color:#666;font-size:14px;margin:8px 0}
.reassign-dialog .btn-row{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
.reassign-dialog button{padding:8px 20px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500}
.reassign-dialog .btn-confirm{background:#3B82F6;color:#fff}
.reassign-dialog .btn-cancel{background:#eee;color:#333}
.waypoint-number{background:#fff;border:2px solid;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,0.3)}
@media(max-width:768px){
  .driver-panel{width:0;display:none}
  #map{left:0}
  .info-bar{left:10px}
}
</style>
</head>
<body>
<div class="driver-panel" id="driver-panel">
  <h2><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> F&ouml;rare</h2>
  <div id="driver-list"></div>
</div>
<div id="map"></div>
<div class="info-bar" id="info-bar">Laddar data...</div>
<div class="controls">
  <button class="btn-active" id="btn-today" onclick="setRange('today')">Idag</button>
  <button class="btn-inactive" id="btn-week" onclick="setRange('week')">Vecka</button>
  <button class="btn-inactive" id="btn-hide" onclick="toggleJobs()">D&ouml;lj jobb</button>
  <button class="btn-route" id="btn-routes" onclick="toggleRoutes()">Rutter &#x2713;</button>
</div>
<div class="legend">
  <div style="font-weight:600;margin-bottom:6px">F&ouml;rklaring</div>
  <div class="legend-item"><div class="legend-dot" style="background:#3B82F6"></div> Chauff&ouml;r</div>
  ${Object.entries(STATUS_COLORS).map(([k,v]) => `<div class="legend-item"><div class="legend-sq" style="background:${v}"></div> ${k.charAt(0).toUpperCase()+k.slice(1).replace('_',' ')}</div>`).join('')}
  <div class="legend-item"><div style="width:20px;height:2px;border-top:2px dashed #3B82F6"></div> Rutt</div>
</div>
<div class="toast-container" id="toast-container"></div>
<script>
const STATUS_COLORS = ${JSON.stringify(STATUS_COLORS)};
const ROUTE_COLORS = ${JSON.stringify(ROUTE_COLORS)};
const map = L.map('map').setView([57.7089, 11.9746], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap'}).addTo(map);

const driverLayer = L.layerGroup().addTo(map);
const jobCluster = L.markerClusterGroup({maxClusterRadius:40}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let currentRange = 'today';
let jobsVisible = true;
let routesVisible = true;
let driversData = [];
let jobsData = [];
let selectedDriverId = null;
let draggedJobId = null;
let draggedJobMarker = null;

function createDriverIcon(status) {
  const color = status === 'traveling' ? '#F39C12' : status === 'on_site' ? '#27AE60' : '#3B82F6';
  return L.divIcon({
    className:'',
    html:'<div style="width:32px;height:32px;border-radius:50%;background:'+color+';border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" fill="#fff" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>',
    iconSize:[32,32],iconAnchor:[16,16]
  });
}
function createJobIcon(status) {
  const color = STATUS_COLORS[status] || '#6C757D';
  return L.divIcon({
    className:'',
    html:'<div style="width:22px;height:22px;border-radius:3px;background:'+color+';border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);cursor:grab"></div>',
    iconSize:[22,22],iconAnchor:[11,11]
  });
}
function createWaypointIcon(number, color) {
  return L.divIcon({
    className:'',
    html:'<div class="waypoint-number" style="border-color:'+color+';color:'+color+'">'+number+'</div>',
    iconSize:[20,20],iconAnchor:[10,10]
  });
}

function esc(str) {
  var d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

var SVG_ICONS = {
  status_changed: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
  deviation_reported: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  order_reassigned: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
  default_icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>'
};

function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const classMap = { status_changed:'toast-status', deviation_reported:'toast-deviation', order_reassigned:'toast-reassign' };
  toast.className = 'toast ' + (classMap[type] || 'toast-status');
  toast.innerHTML = '<div class="toast-icon">'+(SVG_ICONS[type]||SVG_ICONS.default_icon)+'</div><div class="toast-body"><div class="toast-title">'+esc(title)+'</div><div class="toast-msg">'+esc(message)+'</div><div class="toast-time">'+new Date().toLocaleTimeString('sv-SE')+'</div></div>';
  toast.onclick = function() { toast.remove(); };
  container.appendChild(toast);
  setTimeout(function() { if(toast.parentNode) toast.remove(); }, 6000);
  if(container.children.length > 5) container.children[0].remove();
}

function connectSSE() {
  const evtSource = new EventSource('/api/planner/events');
  evtSource.onmessage = function(e) {
    try {
      const event = JSON.parse(e.data);
      if(event.type === 'connected') return;
      if(event.type === 'status_changed') {
        showToast('status_changed', 'Status\\u00e4ndring', event.data.orderNumber + ' \\u2192 ' + event.data.newStatus);
        refresh();
      } else if(event.type === 'deviation_reported') {
        showToast('deviation_reported', 'Avvikelse rapporterad', (event.data.orderNumber || 'Order') + ': ' + (event.data.description || event.data.deviationType));
        refresh();
      } else if(event.type === 'order_reassigned') {
        showToast('order_reassigned', 'Omplanering', event.data.orderNumber + ' \\u2192 ' + event.data.newResourceName);
        refresh();
      }
    } catch(err) { console.error('SSE parse error:', err); }
  };
  evtSource.onerror = function() {
    evtSource.close();
    setTimeout(connectSSE, 5000);
  };
}
connectSSE();

function getDistance(lat1,lon1,lat2,lon2) {
  var R=6371e3,f1=lat1*Math.PI/180,f2=lat2*Math.PI/180;
  var df=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  var a=Math.sin(df/2)*Math.sin(df/2)+Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)*Math.sin(dl/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function findNearestDriver(lat, lng) {
  var nearest = null, minDist = Infinity;
  driversData.forEach(function(d) {
    if(!d.latitude || !d.longitude) return;
    var dist = getDistance(lat, lng, d.latitude, d.longitude);
    if(dist < minDist) { minDist = dist; nearest = d; }
  });
  return nearest && minDist < 2000 ? { driver: nearest, distance: minDist } : null;
}

function showReassignDialog(jobId, jobTitle, driverName, driverId) {
  var existing = document.querySelector('.reassign-modal');
  if(existing) existing.remove();
  var modal = document.createElement('div');
  modal.className = 'reassign-modal';
  modal.innerHTML = '<div class="reassign-dialog"><h3>Omplanera uppdrag</h3><p>Flytta <strong>'+esc(jobTitle)+'</strong> till <strong>'+esc(driverName)+'</strong>?</p><div class="btn-row"><button class="btn-cancel" id="btn-cancel-reassign">Avbryt</button><button class="btn-confirm" id="btn-do-reassign">Bekr\\u00e4fta</button></div></div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if(e.target === modal) modal.remove(); });
  document.getElementById('btn-cancel-reassign').onclick = function() { modal.remove(); };
  document.getElementById('btn-do-reassign').onclick = async function() {
    try {
      var resp = await fetch('/api/planner/orders/'+jobId+'/reassign', {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({resourceId:driverId})
      });
      if(resp.ok) {
        showToast('order_reassigned','Omplanerad',jobTitle+' \\u2192 '+driverName);
        refresh();
      } else {
        var err = await resp.json();
        alert('Fel: '+(err.error||'Ok\\u00e4nt fel'));
      }
    } catch(e) { alert('N\\u00e4tverksfel'); }
    modal.remove();
  };
}

async function loadDrivers() {
  try {
    var res = await fetch('/api/planner/drivers/locations');
    driversData = await res.json();
    driverLayer.clearLayers();
    driversData.forEach(function(d) {
      if(!d.latitude||!d.longitude) return;
      var m = L.marker([d.latitude,d.longitude],{icon:createDriverIcon(d.status)});
      m.driverId = d.driverId;
      m.bindPopup('<div class="driver-popup"><h3>'+esc(d.driverName)+'</h3><p>Status: '+esc(d.status)+'</p>'+(d.vehicleRegNo?'<p>Reg: '+esc(d.vehicleRegNo)+'</p>':'')+'<p>Uppdaterad: '+new Date(d.updatedAt).toLocaleString("sv-SE")+'</p></div>');
      driverLayer.addLayer(m);
    });
    updateDriverPanel();
    return driversData.length;
  } catch(e) { console.error(e); return 0; }
}

function updateDriverPanel() {
  var list = document.getElementById('driver-list');
  if(!driversData.length) {
    list.innerHTML = '<div style="padding:16px;color:#aaa;font-size:13px">Inga f\\u00f6rare online</div>';
    return;
  }
  var jobCounts = {};
  jobsData.forEach(function(j) { if(j.resourceId) jobCounts[j.resourceId] = (jobCounts[j.resourceId]||0)+1; });
  list.innerHTML = driversData.map(function(d) {
    var statusClass = d.status || 'offline';
    var count = jobCounts[d.driverId] || 0;
    return '<div class="driver-card'+(selectedDriverId===d.driverId?' active':'')+'" data-driver-id="'+esc(d.driverId)+'" data-lat="'+d.latitude+'" data-lng="'+d.longitude+'"><h4><span class="driver-status '+esc(statusClass)+'"></span>'+esc(d.driverName)+'</h4><p>'+count+' uppdrag | '+esc(statusClass)+'</p></div>';
  }).join('');
  list.querySelectorAll('.driver-card').forEach(function(card) {
    card.addEventListener('click', function() {
      focusDriver(card.dataset.driverId, parseFloat(card.dataset.lat), parseFloat(card.dataset.lng));
    });
  });
}

function focusDriver(id,lat,lng) {
  selectedDriverId = selectedDriverId === id ? null : id;
  if(lat && lng && selectedDriverId) map.setView([lat,lng], 14);
  updateDriverPanel();
}

async function loadJobs() {
  if(!jobsVisible) return 0;
  try {
    var res = await fetch('/api/planner/orders?range='+currentRange);
    jobsData = await res.json();
    jobCluster.clearLayers();
    jobsData.forEach(function(j) {
      if(!j.latitude||!j.longitude) return;
      var m = L.marker([j.latitude,j.longitude],{icon:createJobIcon(j.status),draggable:true});
      m.jobData = j;
      var badge = '<span class="status-badge" style="background:'+(STATUS_COLORS[j.status]||'#6C757D')+'">'+esc(j.status)+'</span>';
      m.bindPopup('<div class="job-popup"><h3>'+esc(j.orderNumber)+'</h3>'+badge+'<p>'+esc(j.customerName)+'</p><p>'+esc(j.address)+'</p>'+(j.scheduledTimeStart?'<p>Tid: '+esc(j.scheduledTimeStart)+'</p>':'')+(j.resourceId?'<p style="color:#3B82F6">Tilldelad resurs</p>':'<p style="color:#E74C3C">Ej tilldelad</p>')+'</div>');
      m.on('dragend', function(e) {
        var pos = e.target.getLatLng();
        var nearest = findNearestDriver(pos.lat, pos.lng);
        if(nearest) {
          showReassignDialog(j.id, j.orderNumber, nearest.driver.driverName, nearest.driver.driverId);
        } else {
          showToast('status_changed','Ingen f\\u00f6rare n\\u00e4ra','Dra uppdraget n\\u00e4rmare en f\\u00f6rare (max 2km)');
        }
        e.target.setLatLng([j.latitude, j.longitude]);
      });
      jobCluster.addLayer(m);
    });
    updateDriverPanel();
    return jobsData.length;
  } catch(e) { console.error(e); return 0; }
}

async function loadRoutes() {
  routeLayer.clearLayers();
  if(!routesVisible) return;
  try {
    var res = await fetch('/api/planner/routes');
    var routes = await res.json();
    routes.forEach(function(route, idx) {
      var color = route.color || ROUTE_COLORS[idx % ROUTE_COLORS.length];
      if(route.waypoints.length < 2) return;
      var latlngs = route.waypoints.map(function(w) { return [w.lat, w.lng]; });
      var polyline = L.polyline(latlngs, {
        color: color, weight: 3, opacity: 0.7, dashArray: '8, 6'
      });
      routeLayer.addLayer(polyline);
      route.waypoints.forEach(function(w, i) {
        var wm = L.marker([w.lat, w.lng], {
          icon: createWaypointIcon(i+1, color),
          interactive: false
        });
        routeLayer.addLayer(wm);
      });
    });
  } catch(e) { console.error('Routes error:', e); }
}

function setRange(r) {
  currentRange = r;
  document.getElementById('btn-today').className = r==='today'?'btn-active':'btn-inactive';
  document.getElementById('btn-week').className = r==='week'?'btn-active':'btn-inactive';
  refresh();
}
function toggleJobs() {
  jobsVisible = !jobsVisible;
  document.getElementById('btn-hide').textContent = jobsVisible?'D\\u00f6lj jobb':'Visa jobb';
  document.getElementById('btn-hide').className = jobsVisible?'btn-inactive':'btn-active';
  if(!jobsVisible) jobCluster.clearLayers(); else refresh();
}
function toggleRoutes() {
  routesVisible = !routesVisible;
  document.getElementById('btn-routes').innerHTML = routesVisible?'Rutter &#x2713;':'Rutter';
  document.getElementById('btn-routes').className = routesVisible?'btn-route':'btn-route-off';
  if(!routesVisible) routeLayer.clearLayers(); else loadRoutes();
}

async function refresh() {
  var results = await Promise.all([loadDrivers(), loadJobs()]);
  loadRoutes();
  document.getElementById('info-bar').textContent = results[0]+' f\\u00f6rare | '+(jobsVisible?results[1]+' uppdrag':'Jobb dolda')+' | '+currentRange.replace('today','Idag').replace('week','Vecka');
}

refresh();
setInterval(loadDrivers, 15000);
setInterval(loadJobs, 30000);
setInterval(loadRoutes, 30000);
<\/script>
</body>
</html>`;
    res.type('html').send(html);
  });

  // Get resource position history (breadcrumb trail) for a specific date
  app.get("/api/resources/:id/positions", async (req, res) => {
    try {
      const resourceId = req.params.id;
      const dateParam = req.query.date as string;
      
      let startDate: Date | undefined;
      let endDate: Date | undefined;
      
      if (dateParam) {
        startDate = new Date(dateParam);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(dateParam);
        endDate.setHours(23, 59, 59, 999);
      }
      
      const positions = await storage.getResourcePositions(resourceId, startDate, endDate);
      res.json(positions);
    } catch (error) {
      console.error("Failed to fetch positions:", error);
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });
  
  // Get all active resource positions (for planner map view)
  app.get("/api/resources/active-positions", async (req, res) => {
    try {
      const resources = await storage.getActiveResourcePositions();
      res.json(resources.map(r => ({
        id: r.id,
        name: r.name,
        latitude: r.currentLatitude,
        longitude: r.currentLongitude,
        status: r.trackingStatus,
        lastUpdate: r.lastPositionUpdate
      })));
    } catch (error) {
      console.error("Failed to fetch active positions:", error);
      res.status(500).json({ error: "Failed to fetch positions" });
    }
  });

  // ============================================
  // KPI / ANALYTICS ENDPOINTS
  // ============================================

  app.get("/api/kpis/daily", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const dateParam = req.query.date as string;
      const date = dateParam ? new Date(dateParam) : new Date();
      
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const orders = await storage.getWorkOrdersByDate(tenantId, date);
      const resources = await storage.getResources(tenantId);

      const completed = orders.filter(o => 
        o.completedAt || o.status === "completed" || o.executionStatus === "completed"
      );
      const remaining = orders.filter(o => 
        !o.completedAt && o.status !== "completed" && o.executionStatus !== "completed"
      );

      const durationsMinutes = completed
        .map(o => o.actualDuration || o.estimatedDuration || 0)
        .filter(d => d > 0);
      const avgTimePerTask = durationsMinutes.length > 0
        ? Math.round(durationsMinutes.reduce((a, b) => a + b, 0) / durationsMinutes.length)
        : 0;

      const activeResources = resources.filter(r => 
        orders.some(o => o.resourceId === r.id)
      );

      const resourceKpis = activeResources.map(r => {
        const resourceOrders = orders.filter(o => o.resourceId === r.id);
        const resourceCompleted = resourceOrders.filter(o => 
          o.completedAt || o.status === "completed" || o.executionStatus === "completed"
        );
        const resourceDurations = resourceCompleted
          .map(o => o.actualDuration || o.estimatedDuration || 0)
          .filter(d => d > 0);
        return {
          resourceId: r.id,
          resourceName: r.name,
          totalTasks: resourceOrders.length,
          completedTasks: resourceCompleted.length,
          remainingTasks: resourceOrders.length - resourceCompleted.length,
          avgTimeMinutes: resourceDurations.length > 0
            ? Math.round(resourceDurations.reduce((a, b) => a + b, 0) / resourceDurations.length)
            : 0,
        };
      });

      res.json({
        date: date.toISOString().split("T")[0],
        totalTasks: orders.length,
        completedTasks: completed.length,
        remainingTasks: remaining.length,
        completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
        avgTimePerTaskMinutes: avgTimePerTask,
        activeResources: activeResources.length,
        resourceKpis,
      });
    } catch (error) {
      console.error("Failed to compute daily KPIs:", error);
      res.status(500).json({ error: "Failed to compute KPIs" });
    }
  });

  app.get("/api/kpis/weekly", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const weekParam = req.query.week as string;
      
      let startOfWeek: Date;
      if (weekParam) {
        startOfWeek = new Date(weekParam);
      } else {
        startOfWeek = new Date();
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
      }
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const prevStart = new Date(startOfWeek);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevEnd = new Date(startOfWeek);
      prevEnd.setMilliseconds(-1);

      const thisWeekOrders = await storage.getWorkOrders(tenantId, startOfWeek, endOfWeek, true);
      const prevWeekOrders = await storage.getWorkOrders(tenantId, prevStart, prevEnd, true);
      const thisWeek = thisWeekOrders;
      const prevWeek = prevWeekOrders;

      const calcStats = (orders: typeof thisWeek) => {
        const completed = orders.filter(o => o.completedAt || o.status === "completed" || o.executionStatus === "completed");
        const durations = completed.map(o => o.actualDuration || o.estimatedDuration || 0).filter(d => d > 0);
        return {
          totalTasks: orders.length,
          completedTasks: completed.length,
          completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
          avgTimeMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
        };
      };

      const current = calcStats(thisWeek);
      const previous = calcStats(prevWeek);

      res.json({
        weekStart: startOfWeek.toISOString().split("T")[0],
        weekEnd: endOfWeek.toISOString().split("T")[0],
        current,
        previous,
        trends: {
          tasksDelta: current.totalTasks - previous.totalTasks,
          completionRateDelta: current.completionRate - previous.completionRate,
          avgTimeDelta: current.avgTimeMinutes - previous.avgTimeMinutes,
        },
      });
    } catch (error) {
      console.error("Failed to compute weekly KPIs:", error);
      res.status(500).json({ error: "Failed to compute weekly KPIs" });
    }
  });

  app.post("/api/system/weekly-report/trigger", requireAdmin, async (req, res) => {
    try {
      const result = await generateAndSendWeeklyReports();
      res.json(result);
    } catch (error) {
      console.error("Failed to trigger weekly report:", error);
      res.status(500).json({ error: "Failed to send weekly reports" });
    }
  });

  // ============================================
  // ANOMALY MONITORING API ENDPOINTS
  // ============================================
  
  // Manually trigger anomaly check and get results
  app.get("/api/system/anomalies/check", async (req, res) => {
    try {
      const alerts = await anomalyMonitor.runManualCheck();
      res.json({
        timestamp: new Date().toISOString(),
        alertCount: alerts.length,
        alerts: alerts
      });
    } catch (error) {
      console.error("Failed to run anomaly check:", error);
      res.status(500).json({ error: "Failed to run anomaly check" });
    }
  });

  // ============================================
  // SYSTEM DASHBOARD API ENDPOINTS
  // ============================================

  // Branding Templates - List all
  app.get("/api/system/branding-templates", async (req, res) => {
    try {
      const templates = await storage.getBrandingTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Failed to fetch branding templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  // Branding Templates - Get by ID
  app.get("/api/system/branding-templates/:id", async (req, res) => {
    try {
      const template = await storage.getBrandingTemplate(req.params.id);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error) {
      console.error("Failed to fetch branding template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // Branding Templates - Get by slug
  app.get("/api/system/branding-templates/slug/:slug", async (req, res) => {
    try {
      const template = await storage.getBrandingTemplateBySlug(req.params.slug);
      if (!template) return res.status(404).json({ error: "Template not found" });
      res.json(template);
    } catch (error) {
      console.error("Failed to fetch branding template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // Tenant Branding - Get current tenant branding
  app.get("/api/system/tenant-branding", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const branding = await storage.getTenantBranding(tenantId);
      res.json(branding || null);
    } catch (error) {
      console.error("Failed to fetch tenant branding:", error);
      res.status(500).json({ error: "Failed to fetch branding" });
    }
  });

  // Tenant Branding - Update or create branding
  app.put("/api/system/tenant-branding", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { templateId, ...brandingData } = req.body;
      
      let existing = await storage.getTenantBranding(tenantId);
      
      // If using a template, fetch and merge template colors
      if (templateId) {
        const template = await storage.getBrandingTemplate(templateId);
        if (template) {
          brandingData.templateId = templateId;
          brandingData.primaryColor = brandingData.primaryColor || template.primaryColor;
          brandingData.primaryLight = brandingData.primaryLight || template.primaryLight;
          brandingData.primaryDark = brandingData.primaryDark || template.primaryDark;
          brandingData.secondaryColor = brandingData.secondaryColor || template.secondaryColor;
          brandingData.accentColor = brandingData.accentColor || template.accentColor;
          brandingData.successColor = brandingData.successColor || template.successColor;
          brandingData.errorColor = brandingData.errorColor || template.errorColor;
          
          // Increment template usage
          await storage.incrementTemplateUsage(templateId);
        }
      }
      
      let result;
      if (existing) {
        result = await storage.updateTenantBranding(tenantId, brandingData);
      } else {
        result = await storage.createTenantBranding({ 
          tenantId, 
          ...brandingData 
        });
      }
      
      // Create audit log
      await storage.createAuditLog({
        tenantId,
        action: existing ? "update_branding" : "create_branding",
        resourceType: "tenant_branding",
        resourceId: result?.id,
        changes: brandingData,
      });
      
      res.json(result);
    } catch (error) {
      console.error("Failed to update tenant branding:", error);
      res.status(500).json({ error: "Failed to update branding" });
    }
  });

  // Tenant Branding - Publish branding (admin only)
  app.post("/api/system/tenant-branding/publish", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const result = await storage.publishTenantBranding(tenantId);
      
      if (!result) {
        return res.status(404).json({ error: "Branding not found" });
      }
      
      await storage.createAuditLog({
        tenantId,
        action: "publish_branding",
        resourceType: "tenant_branding",
        resourceId: result.id,
      });
      
      res.json(result);
    } catch (error) {
      console.error("Failed to publish branding:", error);
      res.status(500).json({ error: "Failed to publish branding" });
    }
  });

  // SMS Configuration - Get current SMS settings (admin only)
  app.get("/api/system/sms-config", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const tenant = await storage.getTenant(tenantId);
      
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      
      res.json({
        smsEnabled: tenant.smsEnabled ?? false,
        smsProvider: tenant.smsProvider ?? "none",
        smsFromName: tenant.smsFromName ?? tenant.name ?? "",
      });
    } catch (error) {
      console.error("Failed to get SMS config:", error);
      res.status(500).json({ error: "Failed to get SMS configuration" });
    }
  });

  // SMS Configuration - Update SMS settings (admin only)
  const smsConfigSchema = z.object({
    smsEnabled: z.boolean().optional(),
    smsProvider: z.enum(["twilio", "46elks", "none"]).optional(),
    smsFromName: z.string().max(100).optional(),
  });

  app.put("/api/system/sms-config", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const parseResult = smsConfigSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid request data", details: parseResult.error.flatten() });
      }
      
      const tenant = await storage.updateTenantSmsSettings(tenantId, parseResult.data);
      
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      
      await storage.createAuditLog({
        tenantId,
        action: "update_sms_config",
        resourceType: "tenant",
        resourceId: tenantId,
        data: parseResult.data,
      });
      
      res.json({
        smsEnabled: tenant.smsEnabled ?? false,
        smsProvider: tenant.smsProvider ?? "none",
        smsFromName: tenant.smsFromName ?? "",
      });
    } catch (error) {
      console.error("Failed to update SMS config:", error);
      res.status(500).json({ error: "Failed to update SMS configuration" });
    }
  });

  // SMS Configuration - Test SMS sending (admin only)
  app.post("/api/system/sms-config/test", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { phoneNumber } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }
      
      const tenant = await storage.getTenant(tenantId);
      if (!tenant?.smsEnabled) {
        return res.status(400).json({ error: "SMS is not enabled for this tenant" });
      }
      
      const { sendNotification } = await import("./unified-notifications");
      const result = await sendNotification({
        tenantId,
        recipients: [{ phone: phoneNumber, name: "Test" }],
        notificationType: "reminder",
        channel: "sms",
        data: {
          objectAddress: "Testadress 123",
          scheduledDate: "idag",
          scheduledTime: "10:00",
        },
      });
      
      if (result.success && result.smsSent > 0) {
        res.json({ success: true, message: "Test-SMS skickat!" });
      } else {
        res.status(500).json({ success: false, error: result.errors.join(", ") || "Failed to send test SMS" });
      }
    } catch (error: any) {
      console.error("Failed to send test SMS:", error);
      res.status(500).json({ error: error.message || "Failed to send test SMS" });
    }
  });

  // User Tenant Roles - List all users with roles for current tenant (admin only)
  app.get("/api/system/user-roles", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const roles = await storage.getUserTenantRoles(tenantId);
      res.json(roles);
    } catch (error) {
      console.error("Failed to fetch user roles:", error);
      res.status(500).json({ error: "Failed to fetch user roles" });
    }
  });

  // User Tenant Roles - Create new user role (admin only)
  app.post("/api/system/user-roles", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { userId, name, role, permissions, password } = req.body;
      
      if (!userId || !role) {
        return res.status(400).json({ error: "userId and role are required" });
      }
      
      // Check if user already has a role
      const existing = await storage.getUserTenantRole(userId, tenantId);
      if (existing) {
        return res.status(400).json({ error: "User already has a role in this tenant" });
      }
      
      // Create or update user record with password if provided
      const email = userId.startsWith("email:") ? userId.replace("email:", "") : null;
      if (email) {
        const passwordHash = password ? hashPassword(password) : undefined;
        const [firstName, ...lastNameParts] = (name || "").split(" ");
        await storage.upsertUser({
          id: userId,
          email,
          firstName: firstName || null,
          lastName: lastNameParts.join(" ") || null,
          passwordHash,
        });
      }
      
      const result = await storage.createUserTenantRole({
        userId,
        tenantId,
        role,
        permissions: permissions || [],
        isActive: true,
      });
      
      await storage.createAuditLog({
        tenantId,
        action: "create_user_role",
        resourceType: "user_tenant_roles",
        resourceId: result.id,
        changes: { userId, role, permissions, hasPassword: !!password },
      });
      
      res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create user role:", error);
      res.status(500).json({ error: "Failed to create user role" });
    }
  });

  // User Tenant Roles - Update role (admin only)
  app.patch("/api/system/user-roles/:id", requireAdmin, async (req, res) => {
    try {
      const { role, permissions, isActive, password } = req.body;
      
      const result = await storage.updateUserTenantRole(req.params.id, {
        role,
        permissions,
        isActive,
      });
      
      if (!result) {
        return res.status(404).json({ error: "User role not found" });
      }
      
      // Update password if provided
      if (password && result.userId) {
        const email = result.userId.startsWith("email:") ? result.userId.replace("email:", "") : null;
        if (email) {
          const passwordHash = hashPassword(password);
          await storage.upsertUser({
            id: result.userId,
            email,
            passwordHash,
          });
        }
      }
      
      const tenantId = getTenantIdWithFallback(req);
      await storage.createAuditLog({
        tenantId,
        action: "update_user_role",
        resourceType: "user_tenant_roles",
        resourceId: result.id,
        changes: { role, permissions, isActive, passwordChanged: !!password },
      });
      
      res.json(result);
    } catch (error) {
      console.error("Failed to update user role:", error);
      res.status(500).json({ error: "Failed to update user role" });
    }
  });

  // User Tenant Roles - Import users from CSV data
  app.post("/api/system/user-roles/import", requireAdmin, async (req, res) => {
    try {
      const { users } = req.body;
      
      if (!Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ error: "No users provided" });
      }
      
      let imported = 0;
      let skipped = 0;
      
      for (const user of users) {
        if (!user.email) {
          skipped++;
          continue;
        }
        
        const userId = `email:${user.email}`;
        const tenantId = getTenantIdWithFallback(req);
        
        // Check if user already has a role
        const existing = await storage.getUserTenantRole(userId, tenantId);
        if (existing) {
          skipped++;
          continue;
        }
        
        // Map role names (Swedish to English) - handle whitespace and case variations
        let role = user.role?.toLowerCase().trim() || "viewer";
        const roleMap: Record<string, string> = {
          "ägare": "owner",
          "owner": "owner",
          "administratör": "admin",
          "administrator": "admin",
          "admin": "admin",
          "planerare": "planner",
          "planner": "planner",
          "tekniker": "technician",
          "technician": "technician",
          "läsare": "viewer",
          "viewer": "viewer",
          "user": "viewer",
          "användare": "viewer",
        };
        role = roleMap[role] || "viewer";
        
        await storage.createUserTenantRole({
          userId,
          tenantId,
          role,
          permissions: [],
          isActive: true,
        });
        imported++;
      }
      
      const tenantIdForLog = getTenantIdWithFallback(req);
      await storage.createAuditLog({
        tenantId: tenantIdForLog,
        action: "import_users",
        resourceType: "user_tenant_roles",
        changes: { imported, skipped, total: users.length },
      });
      
      res.json({ imported, skipped, total: users.length });
    } catch (error) {
      console.error("Failed to import users:", error);
      res.status(500).json({ error: "Failed to import users" });
    }
  });

  // User Tenant Roles - Delete role
  app.delete("/api/system/user-roles/:id", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.createAuditLog({
        tenantId,
        action: "delete_user_role",
        resourceType: "user_tenant_roles",
        resourceId: req.params.id,
      });
      
      await storage.deleteUserTenantRole(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete user role:", error);
      res.status(500).json({ error: "Failed to delete user role" });
    }
  });

  // ============================================
  // INDUSTRY PACKAGES API ENDPOINTS
  // ============================================

  // Industry Packages - List all available packages
  app.get("/api/system/industry-packages", async (req, res) => {
    try {
      const packages = await storage.getIndustryPackages();
      res.json(packages);
    } catch (error) {
      console.error("Failed to fetch industry packages:", error);
      res.status(500).json({ error: "Failed to fetch industry packages" });
    }
  });

  // Industry Packages - Get by ID with full data
  app.get("/api/system/industry-packages/:id", async (req, res) => {
    try {
      const pkg = await storage.getIndustryPackage(req.params.id);
      if (!pkg) return res.status(404).json({ error: "Package not found" });
      
      const packageData = await storage.getIndustryPackageData(req.params.id);
      res.json({ ...pkg, data: packageData });
    } catch (error) {
      console.error("Failed to fetch industry package:", error);
      res.status(500).json({ error: "Failed to fetch package" });
    }
  });

  // Industry Packages - Get tenant installation history
  app.get("/api/system/industry-packages/installations", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const installations = await storage.getTenantPackageInstallations(tenantId);
      res.json(installations);
    } catch (error) {
      console.error("Failed to fetch package installations:", error);
      res.status(500).json({ error: "Failed to fetch installations" });
    }
  });

  // Industry Packages - Install package for tenant
  app.post("/api/system/industry-packages/:id/install", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const packageId = req.params.id;
      const userId = (req.user as any)?.id;
      
      const pkg = await storage.getIndustryPackage(packageId);
      if (!pkg) return res.status(404).json({ error: "Package not found" });
      
      const packageData = await storage.getIndustryPackageData(packageId);
      
      let articlesInstalled = 0;
      let metadataInstalled = 0;
      let structuralArticlesInstalled = 0;
      
      const articlesData = packageData.find(d => d.dataType === "articles");
      if (articlesData && Array.isArray(articlesData.data)) {
        for (const article of articlesData.data as any[]) {
          try {
            await storage.createArticle({
              tenantId,
              articleNumber: article.articleNumber,
              name: article.name,
              description: article.description,
              articleType: article.articleType,
              unitPrice: article.unitPrice?.toString(),
              unit: article.unit,
              objectTypes: article.objectTypes,
            });
            articlesInstalled++;
          } catch (err) {
            console.warn(`Skipping duplicate article ${article.articleNumber}:`, err);
          }
        }
      }
      
      const metadataData = packageData.find(d => d.dataType === "metadataDefinitions");
      if (metadataData && Array.isArray(metadataData.data)) {
        for (const meta of metadataData.data as any[]) {
          try {
            await storage.createMetadataDefinition({
              tenantId,
              fieldKey: meta.fieldKey,
              fieldLabel: meta.fieldLabel,
              dataType: meta.dataType,
              objectTypes: meta.objectTypes,
              propagationType: meta.propagationType,
              isRequired: meta.isRequired,
              description: meta.description,
              defaultValue: meta.defaultValue,
              validationRules: meta.validationRules,
            });
            metadataInstalled++;
          } catch (err) {
            console.warn(`Skipping duplicate metadata ${meta.fieldKey}:`, err);
          }
        }
      }
      
      const structuralData = packageData.find(d => d.dataType === "structuralArticles");
      if (structuralData && Array.isArray(structuralData.data)) {
        const tenantArticles = await storage.getArticles(tenantId);
        const articleMap = new Map(tenantArticles.map(a => [a.articleNumber, a.id]));
        
        for (const sa of structuralData.data as any[]) {
          try {
            const parentId = articleMap.get(sa.parentArticleNumber);
            const childId = articleMap.get(sa.childArticleNumber);
            
            if (parentId && childId) {
              await storage.createStructuralArticle({
                tenantId,
                parentArticleId: parentId,
                childArticleId: childId,
                sequenceOrder: sa.sequenceOrder || 1,
                quantity: sa.quantity?.toString() || "1",
                isConditional: sa.isConditional || false,
                conditionType: sa.conditionType,
                conditionValue: sa.conditionValue,
              });
              structuralArticlesInstalled++;
            } else {
              console.warn(`Skipping structural article: parent=${sa.parentArticleNumber} child=${sa.childArticleNumber} - articles not found`);
            }
          } catch (err) {
            console.warn(`Skipping structural article:`, err);
          }
        }
      }
      
      const installation = await storage.createTenantPackageInstallation({
        tenantId,
        packageId,
        installedBy: userId,
        articlesInstalled,
        metadataInstalled,
        structuralArticlesInstalled,
        status: "completed",
      });
      
      await storage.createAuditLog({
        tenantId,
        userId,
        action: "install_industry_package",
        resourceType: "industry_package",
        resourceId: packageId,
        changes: { 
          packageName: pkg.name, 
          articlesInstalled, 
          metadataInstalled,
          structuralArticlesInstalled
        },
      });
      
      res.json({
        success: true,
        installation,
        summary: {
          articlesInstalled,
          metadataInstalled,
          structuralArticlesInstalled,
        },
      });
    } catch (error) {
      console.error("Failed to install industry package:", error);
      res.status(500).json({ error: "Failed to install package" });
    }
  });

  // Tenant Onboarding - Create new tenant with package and admin user
  app.post("/api/system/onboard-tenant", requireAdmin, async (req, res) => {
    try {
      const { company, industryPackageId, adminUser } = req.body;
      const currentUserId = (req.user as any)?.id;

      if (!company?.name) {
        return res.status(400).json({ error: "Företagsnamn krävs" });
      }
      if (!adminUser?.email || !adminUser?.password) {
        return res.status(400).json({ error: "E-post och lösenord krävs för admin-användaren" });
      }

      const existingUser = await storage.getUserByUsername(adminUser.email);
      if (existingUser) {
        return res.status(409).json({ error: "En användare med den e-postadressen finns redan" });
      }

      const tenantId = `tenant-${Date.now()}`;
      const tenant = await storage.createTenant({
        id: tenantId,
        name: company.name,
        orgNumber: company.orgNumber || null,
        contactEmail: company.contactEmail || null,
        contactPhone: company.contactPhone || null,
        industry: company.industry || null,
      });

      let packageSummary = null;
      if (industryPackageId) {
        const pkg = await storage.getIndustryPackage(industryPackageId);
        if (pkg) {
          const packageData = await storage.getIndustryPackageData(industryPackageId);
          let articlesInstalled = 0;
          let metadataInstalled = 0;
          let structuralArticlesInstalled = 0;

          const articlesData = packageData.find(d => d.dataType === "articles");
          if (articlesData && Array.isArray(articlesData.data)) {
            for (const article of articlesData.data as any[]) {
              try {
                await storage.createArticle({
                  tenantId,
                  articleNumber: article.articleNumber,
                  name: article.name,
                  description: article.description,
                  articleType: article.articleType,
                  unitPrice: article.unitPrice?.toString(),
                  unit: article.unit,
                  objectTypes: article.objectTypes,
                });
                articlesInstalled++;
              } catch (err) {
                console.warn(`Skipping duplicate article ${article.articleNumber}:`, err);
              }
            }
          }

          const metadataData = packageData.find(d => d.dataType === "metadataDefinitions");
          if (metadataData && Array.isArray(metadataData.data)) {
            for (const meta of metadataData.data as any[]) {
              try {
                await storage.createMetadataDefinition({
                  tenantId,
                  fieldKey: meta.fieldKey,
                  fieldLabel: meta.fieldLabel,
                  dataType: meta.dataType,
                  objectTypes: meta.objectTypes,
                  propagationType: meta.propagationType,
                  isRequired: meta.isRequired,
                  description: meta.description,
                  defaultValue: meta.defaultValue,
                  validationRules: meta.validationRules,
                });
                metadataInstalled++;
              } catch (err) {
                console.warn(`Skipping duplicate metadata ${meta.fieldKey}:`, err);
              }
            }
          }

          const structuralData = packageData.find(d => d.dataType === "structuralArticles");
          if (structuralData && Array.isArray(structuralData.data)) {
            const tenantArticles = await storage.getArticles(tenantId);
            const articleMap = new Map(tenantArticles.map(a => [a.articleNumber, a.id]));
            for (const sa of structuralData.data as any[]) {
              try {
                const parentId = articleMap.get(sa.parentArticleNumber);
                const childId = articleMap.get(sa.childArticleNumber);
                if (parentId && childId) {
                  await storage.createStructuralArticle({
                    tenantId,
                    parentArticleId: parentId,
                    childArticleId: childId,
                    sequenceOrder: sa.sequenceOrder || 1,
                    quantity: sa.quantity?.toString() || "1",
                    isConditional: sa.isConditional || false,
                    conditionType: sa.conditionType,
                    conditionValue: sa.conditionValue,
                  });
                  structuralArticlesInstalled++;
                }
              } catch (err) {
                console.warn(`Skipping structural article:`, err);
              }
            }
          }

          await storage.createTenantPackageInstallation({
            tenantId,
            packageId: industryPackageId,
            installedBy: currentUserId,
            articlesInstalled,
            metadataInstalled,
            structuralArticlesInstalled,
            status: "completed",
          });

          packageSummary = {
            packageName: pkg.name,
            articlesInstalled,
            metadataInstalled,
            structuralArticlesInstalled,
          };
        }
      }

      const hashedPassword = hashPassword(adminUser.password);
      const user = await storage.createUser({
        email: adminUser.email,
        firstName: adminUser.firstName || null,
        lastName: adminUser.lastName || null,
        passwordHash: hashedPassword,
        role: "admin",
        isActive: true,
      });

      await storage.createUserTenantRole({
        userId: user.id,
        tenantId,
        role: "owner",
        assignedBy: currentUserId,
      });

      await storage.createAuditLog({
        tenantId,
        userId: currentUserId,
        action: "onboard_tenant",
        resourceType: "tenant",
        resourceId: tenantId,
        changes: {
          companyName: company.name,
          adminEmail: adminUser.email,
          packageInstalled: packageSummary?.packageName || null,
        },
      });

      console.log(`[onboarding] New tenant "${company.name}" (${tenantId}) created with admin "${adminUser.email}"`);

      res.status(201).json({
        success: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          orgNumber: tenant.orgNumber,
          industry: tenant.industry,
        },
        adminUser: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        packageSummary,
      });
    } catch (error) {
      console.error("Failed to onboard tenant:", error);
      res.status(500).json({ error: "Kunde inte skapa företagskonto" });
    }
  });

  // Industry Packages - Seed default packages (admin only, one-time setup)
  app.post("/api/system/industry-packages/seed", requireAdmin, async (req, res) => {
    try {
      const { allPackages, getPackageData } = await import("./data/industryPackages");
      
      const results = [];
      for (const pkgData of allPackages) {
        const existing = await storage.getIndustryPackageBySlug(pkgData.slug);
        if (existing) {
          results.push({ slug: pkgData.slug, status: "skipped", message: "Already exists" });
          continue;
        }
        
        const pkg = await storage.createIndustryPackage(pkgData);
        
        const data = getPackageData(pkgData.slug);
        
        if (data.articles.length > 0) {
          await storage.createIndustryPackageData({
            packageId: pkg.id,
            dataType: "articles",
            data: data.articles,
          });
        }
        
        if (data.metadata.length > 0) {
          await storage.createIndustryPackageData({
            packageId: pkg.id,
            dataType: "metadataDefinitions",
            data: data.metadata,
          });
        }
        
        if (data.structuralArticles.length > 0) {
          await storage.createIndustryPackageData({
            packageId: pkg.id,
            dataType: "structuralArticles",
            data: data.structuralArticles,
          });
        }
        
        results.push({ 
          slug: pkgData.slug, 
          status: "created", 
          articles: data.articles.length,
          metadata: data.metadata.length,
          structuralArticles: data.structuralArticles.length,
        });
      }
      
      res.json({ success: true, results });
    } catch (error) {
      console.error("Failed to seed industry packages:", error);
      res.status(500).json({ error: "Failed to seed packages" });
    }
  });

  // Audit Logs - Get logs for current tenant
  app.get("/api/system/audit-logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const action = req.query.action as string;
      const userId = req.query.userId as string;
      
      const tenantId = getTenantIdWithFallback(req);
      const logs = await storage.getAuditLogs(tenantId, { limit, offset, action, userId });
      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  // Project Statistics API - Returns code statistics for PDF generation
  app.get("/api/system/project-stats", async (req, res) => {
    try {
      // Project code statistics (based on actual code count)
      const stats = {
        projectName: "Unicorn - AI-Driven Field Service Planning Platform",
        generatedDate: new Date().toISOString(),
        codeStats: {
          totalLines: 43628,
          frontend: { lines: 31253, files: 120, description: "React/TypeScript frontend" },
          backend: { lines: 11304, files: 45, description: "Express.js/Node.js backend" },
          shared: { lines: 1071, files: 15, description: "Delad typning och schema" },
          totalFiles: 180,
        },
        features: [
          "Drag-and-drop veckoplanering",
          "AI-driven ruttoptimering (VROOM/OpenRouteService)",
          "GPS-spårning i realtid med breadcrumb-trails",
          "Automatisk anomali-övervakning",
          "Mobil fältapp med digitala signaturer",
          "Flerföretagsstöd-arkitektur",
          "WebSocket push-notifikationer",
          "MCP-integration för externa AI-assistenter",
          "Modus 2.0 CSV-import",
          "Väderoptimerad schemaläggning",
        ],
        techStack: [
          "React 18 + TypeScript",
          "Express.js + Node.js",
          "PostgreSQL + Drizzle ORM",
          "TanStack Query",
          "Tailwind CSS + Shadcn/UI",
          "Leaflet kartor",
          "OpenAI GPT-4",
          "WebSocket realtidskommunikation",
        ],
        costComparison: {
          // Swedish development costs
          hourlyRate: { min: 800, max: 1500, currency: "SEK" },
          // Estimate: 10-20 lines of production code per hour for complex systems
          estimatedHours: { min: 2181, max: 4363 }, // 43628 / 20 and 43628 / 10
          // Total cost range
          totalCost: {
            min: 2181 * 800, // 1 744 800 SEK
            max: 4363 * 1500, // 6 544 500 SEK
            currency: "SEK",
          },
          // Additional costs for a typical project
          additionalCosts: {
            projectManagement: "15-20% av utvecklingskostnad",
            uxDesign: "10-15% av utvecklingskostnad",
            testing: "20-30% av utvecklingskostnad",
            infrastructure: "Löpande månadskostnad",
          },
          // Timeline estimate
          timeline: {
            team: "3-5 utvecklare",
            duration: "6-12 månader",
          },
          notes: [
            "Uppskattningen baseras på 10-20 rader produktionskod per timme",
            "Timkostnaden för svenska konsulter varierar mellan 800-1500 kr/tim",
            "Inkluderar inte projektledning, UX-design eller infrastruktur",
            "Ett erfaret team kan leverera snabbare men till högre timkostnad",
          ],
        },
      };
      
      res.json(stats);
    } catch (error) {
      console.error("Failed to get project stats:", error);
      res.status(500).json({ error: "Failed to get project stats" });
    }
  });

  // Send project report via email
  app.post("/api/system/send-project-report", requireAdmin, async (req, res) => {
    try {
      const { to, pdfBase64 } = req.body;
      
      if (!to || !pdfBase64) {
        return res.status(400).json({ error: "Missing required fields: to, pdfBase64" });
      }

      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      
      const result = await sendEmail({
        to,
        subject: "Unicorn Projektrapport - Kodstatistik och Kostnadsjämförelse",
        html: `
          <h1>Unicorn Projektrapport</h1>
          <p>Bifogat finner du projektrapporten med kodstatistik och kostnadsjämförelse för Unicorn-plattformen.</p>
          <h2>Sammanfattning</h2>
          <ul>
            <li><strong>Totalt antal kodrader:</strong> ~43 600</li>
            <li><strong>Uppskattad utvecklingskostnad:</strong> 1,7 - 6,5 miljoner SEK</li>
            <li><strong>Uppskattad utvecklingstid:</strong> 6-12 månader med 3-5 utvecklare</li>
          </ul>
          <p>Se bifogad PDF för detaljerad information.</p>
          <hr>
          <p><em>Genererad av Unicorn - AI-Driven Field Service Planning Platform</em></p>
        `,
        attachments: [
          {
            filename: "Unicorn_Projektrapport_Kostnadsjamforelse.pdf",
            content: pdfBuffer,
          }
        ],
      });
      
      console.log("Email sent successfully:", result);
      res.json({ success: true, result });
    } catch (error) {
      console.error("Failed to send email:", error);
      res.status(500).json({ error: "Failed to send email", details: String(error) });
    }
  });

  // ============== METADATA DEFINITIONS ==============
  app.get("/api/metadata-definitions", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const definitions = await storage.getMetadataDefinitions(tenantId);
      res.json(definitions);
    } catch (error) {
      console.error("Failed to fetch metadata definitions:", error);
      res.status(500).json({ error: "Failed to fetch metadata definitions" });
    }
  });

  app.get("/api/metadata-definitions/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const definition = await storage.getMetadataDefinition(req.params.id);
      const verified = verifyTenantOwnership(definition, tenantId);
      if (!verified) return res.status(404).json({ error: "Definition not found" });
      res.json(verified);
    } catch (error) {
      console.error("Failed to fetch metadata definition:", error);
      res.status(500).json({ error: "Failed to fetch metadata definition" });
    }
  });

  app.post("/api/metadata-definitions", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertMetadataDefinitionSchema.parse({ ...req.body, tenantId });
      const definition = await storage.createMetadataDefinition(data);
      res.status(201).json(definition);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create metadata definition:", error);
      res.status(500).json({ error: "Failed to create metadata definition" });
    }
  });

  app.patch("/api/metadata-definitions/:id", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getMetadataDefinition(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Definition not found" });
      }
      // Only allow updating safe fields - never tenantId, id, fieldKey, or createdAt
      const updateSchema = z.object({
        fieldLabel: z.string().optional(),
        dataType: z.string().optional(),
        propagationType: z.string().optional(),
        applicableLevels: z.array(z.string()).optional(),
        isRequired: z.boolean().optional(),
        defaultValue: z.string().nullable().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      const definition = await storage.updateMetadataDefinition(req.params.id, updateData);
      if (!definition) return res.status(404).json({ error: "Definition not found" });
      res.json(definition);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update metadata definition:", error);
      res.status(500).json({ error: "Failed to update metadata definition" });
    }
  });

  app.delete("/api/metadata-definitions/:id", requireAdmin, async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getMetadataDefinition(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Definition not found" });
      }
      await storage.deleteMetadataDefinition(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete metadata definition:", error);
      res.status(500).json({ error: "Failed to delete metadata definition" });
    }
  });

  // ============== OBJECT METADATA ==============
  // Helper to verify object belongs to current tenant
  async function verifyObjectTenant(objectId: string, tenantId: string): Promise<boolean> {
    const obj = await storage.getObject(objectId);
    return obj?.tenantId === tenantId;
  }

  app.get("/api/objects/:objectId/metadata", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const metadata = await storage.getObjectMetadata(req.params.objectId);
      res.json(metadata);
    } catch (error) {
      console.error("Failed to fetch object metadata:", error);
      res.status(500).json({ error: "Failed to fetch object metadata" });
    }
  });

  app.post("/api/objects/:objectId/metadata", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const data = insertObjectMetadataSchema.parse({ 
        ...req.body, 
        tenantId,
        objectId: req.params.objectId 
      });
      const metadata = await storage.createObjectMetadata(data);
      res.status(201).json(metadata);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create object metadata:", error);
      res.status(500).json({ error: "Failed to create object metadata" });
    }
  });

  app.patch("/api/objects/:objectId/metadata/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updateSchema = z.object({
        value: z.string().optional(),
        breaksInheritance: z.boolean().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      // Storage method enforces objectId and tenantId match at DB level
      const metadata = await storage.updateObjectMetadata(req.params.id, req.params.objectId, tenantId, updateData);
      if (!metadata) return res.status(404).json({ error: "Metadata not found or does not belong to this object" });
      res.json(metadata);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update object metadata:", error);
      res.status(500).json({ error: "Failed to update object metadata" });
    }
  });

  app.delete("/api/objects/:objectId/metadata/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      // Storage method enforces objectId and tenantId match at DB level
      await storage.deleteObjectMetadata(req.params.id, req.params.objectId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete object metadata:", error);
      res.status(500).json({ error: "Failed to delete object metadata" });
    }
  });

  // Get effective metadata for an object (including inherited values)
  app.get("/api/objects/:objectId/effective-metadata", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const effectiveMetadata = await storage.getEffectiveMetadata(req.params.objectId, tenantId);
      res.json(effectiveMetadata);
    } catch (error) {
      console.error("Failed to fetch effective metadata:", error);
      res.status(500).json({ error: "Failed to fetch effective metadata" });
    }
  });

  // ============== OBJECT PAYERS ==============
  app.get("/api/objects/:objectId/payers", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const payers = await storage.getObjectPayers(req.params.objectId);
      res.json(payers);
    } catch (error) {
      console.error("Failed to fetch object payers:", error);
      res.status(500).json({ error: "Failed to fetch object payers" });
    }
  });

  app.post("/api/objects/:objectId/payers", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const data = insertObjectPayerSchema.parse({
        ...req.body,
        tenantId,
        objectId: req.params.objectId
      });
      const payer = await storage.createObjectPayer(data);
      res.status(201).json(payer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create object payer:", error);
      res.status(500).json({ error: "Failed to create object payer" });
    }
  });

  app.patch("/api/objects/:objectId/payers/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updateSchema = z.object({
        customerId: z.string().optional(),
        payerType: z.string().optional(),
        sharePercent: z.number().optional(),
        articleTypes: z.array(z.string()).optional(),
        priority: z.number().optional(),
        validFrom: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
        validTo: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
        invoiceReference: z.string().optional(),
        fortnoxCustomerId: z.string().optional(),
        notes: z.string().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      const payer = await storage.updateObjectPayer(req.params.id, req.params.objectId, tenantId, updateData);
      if (!payer) return res.status(404).json({ error: "Payer not found or does not belong to this object" });
      res.json(payer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update object payer:", error);
      res.status(500).json({ error: "Failed to update object payer" });
    }
  });

  app.delete("/api/objects/:objectId/payers/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteObjectPayer(req.params.id, req.params.objectId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete object payer:", error);
      res.status(500).json({ error: "Failed to delete object payer" });
    }
  });

  // ============================================
  // FORTNOX INTEGRATION
  // ============================================

  const { createFortnoxClient, exportWorkOrderToFortnox } = await import("./fortnox-client");

  // Fortnox OAuth Authorization
  app.get("/api/fortnox/authorize", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const client = createFortnoxClient(tenantId);
      const redirectUri = `${req.protocol}://${req.get("host")}/api/fortnox/callback`;
      const state = Buffer.from(JSON.stringify({ tenantId, timestamp: Date.now() })).toString("base64");
      
      const authUrl = await client.getAuthorizationUrlWithConfig(redirectUri, state);
      if (!authUrl) {
        return res.status(400).json({ error: "Fortnox configuration missing - please add Client ID first" });
      }
      
      res.json({ authUrl });
    } catch (error) {
      console.error("Failed to generate Fortnox auth URL:", error);
      res.status(500).json({ error: "Failed to generate authorization URL" });
    }
  });

  // Fortnox OAuth Callback
  app.get("/api/fortnox/callback", async (req, res) => {
    try {
      const { code, state, error: oauthError } = req.query;
      
      if (oauthError) {
        return res.redirect(`/fortnox?error=${encodeURIComponent(oauthError as string)}`);
      }
      
      if (!code || !state) {
        return res.redirect("/fortnox?error=missing_code");
      }

      let stateData: { tenantId: string };
      try {
        stateData = JSON.parse(Buffer.from(state as string, "base64").toString());
      } catch {
        return res.redirect("/fortnox?error=invalid_state");
      }

      const client = createFortnoxClient(stateData.tenantId);
      const redirectUri = `${req.protocol}://${req.get("host")}/api/fortnox/callback`;
      
      await client.exchangeCodeForTokens(code as string, redirectUri);
      
      res.redirect("/fortnox?success=true");
    } catch (error) {
      console.error("Fortnox OAuth callback failed:", error);
      res.redirect(`/fortnox?error=${encodeURIComponent("Token exchange failed")}`);
    }
  });

  // Fortnox Connection Status
  app.get("/api/fortnox/status", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const client = createFortnoxClient(tenantId);
      const isConnected = await client.isConnected();
      const config = await storage.getFortnoxConfig(tenantId);
      
      res.json({
        isConnected,
        hasConfig: !!config?.clientId,
        tokenExpiresAt: config?.tokenExpiresAt,
      });
    } catch (error) {
      console.error("Failed to check Fortnox status:", error);
      res.status(500).json({ error: "Failed to check connection status" });
    }
  });

  // Process Fortnox Export (send to Fortnox API)
  app.post("/api/fortnox/exports/:id/process", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const result = await exportWorkOrderToFortnox(tenantId, req.params.id);
      
      if (result.success) {
        res.json({ success: true, invoiceNumber: result.invoiceNumber });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      console.error("Failed to process Fortnox export:", error);
      res.status(500).json({ error: "Failed to process export" });
    }
  });

  // Fortnox Config
  app.get("/api/fortnox/config", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const config = await storage.getFortnoxConfig(tenantId);
      res.json(config || null);
    } catch (error) {
      console.error("Failed to fetch Fortnox config:", error);
      res.status(500).json({ error: "Failed to fetch Fortnox config" });
    }
  });

  app.post("/api/fortnox/config", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { clientId, clientSecret } = req.body;
      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: "Client ID and Secret required" });
      }

      const existing = await storage.getFortnoxConfig(tenantId);
      if (existing) {
        const updated = await storage.updateFortnoxConfig(tenantId, {
          clientId,
          clientSecret,
          isActive: true
        });
        return res.json(updated);
      }

      const config = await storage.createFortnoxConfig({
        tenantId,
        clientId,
        clientSecret,
        isActive: true
      });
      res.status(201).json(config);
    } catch (error) {
      console.error("Failed to save Fortnox config:", error);
      res.status(500).json({ error: "Failed to save Fortnox config" });
    }
  });

  app.patch("/api/fortnox/config", async (req, res) => {
    try {
      const updateSchema = z.object({
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
        isActive: z.boolean().optional(),
        accessToken: z.string().nullable().optional(),
        refreshToken: z.string().nullable().optional(),
        tokenExpiresAt: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
      });
      const updateData = updateSchema.parse(req.body);
      const tenantId = getTenantIdWithFallback(req);
      const config = await storage.updateFortnoxConfig(tenantId, updateData);
      if (!config) return res.status(404).json({ error: "Config not found" });
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update Fortnox config:", error);
      res.status(500).json({ error: "Failed to update Fortnox config" });
    }
  });

  // Fortnox Mappings
  app.get("/api/fortnox/mappings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const entityType = req.query.entityType as string | undefined;
      const mappings = await storage.getFortnoxMappings(tenantId, entityType);
      res.json(mappings);
    } catch (error) {
      console.error("Failed to fetch Fortnox mappings:", error);
      res.status(500).json({ error: "Failed to fetch Fortnox mappings" });
    }
  });

  app.post("/api/fortnox/mappings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { entityType, unicornId, fortnoxId } = req.body;
      if (!entityType || !unicornId || !fortnoxId) {
        return res.status(400).json({ error: "All fields required" });
      }

      const existing = await storage.getFortnoxMapping(tenantId, entityType, unicornId);
      if (existing) {
        const updated = await storage.updateFortnoxMapping(existing.id, tenantId, { fortnoxId, lastSyncedAt: new Date() });
        return res.json(updated);
      }

      const mapping = await storage.createFortnoxMapping({
        tenantId,
        entityType,
        unicornId,
        fortnoxId
      });
      res.status(201).json(mapping);
    } catch (error) {
      console.error("Failed to create Fortnox mapping:", error);
      res.status(500).json({ error: "Failed to create Fortnox mapping" });
    }
  });

  app.delete("/api/fortnox/mappings/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteFortnoxMapping(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete Fortnox mapping:", error);
      res.status(500).json({ error: "Failed to delete Fortnox mapping" });
    }
  });

  // Fortnox Invoice Exports
  app.get("/api/fortnox/exports", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const status = req.query.status as string | undefined;
      const exports = await storage.getFortnoxInvoiceExports(tenantId, status);
      res.json(exports);
    } catch (error) {
      console.error("Failed to fetch Fortnox exports:", error);
      res.status(500).json({ error: "Failed to fetch Fortnox exports" });
    }
  });

  app.post("/api/fortnox/exports", async (req, res) => {
    try {
      const { workOrderId, payerId, costCenter, project } = req.body;
      if (!workOrderId) {
        return res.status(400).json({ error: "Work order ID required" });
      }

      const tenantId = getTenantIdWithFallback(req);
      const invoiceExport = await storage.createFortnoxInvoiceExport({
        tenantId,
        workOrderId,
        payerId: payerId || null,
        costCenter: costCenter || null,
        project: project || null,
        status: "pending"
      });
      res.status(201).json(invoiceExport);
    } catch (error) {
      console.error("Failed to create Fortnox export:", error);
      res.status(500).json({ error: "Failed to create Fortnox export" });
    }
  });

  app.patch("/api/fortnox/exports/:id", async (req, res) => {
    try {
      const updateSchema = z.object({
        status: z.string().optional(),
        fortnoxInvoiceNumber: z.string().nullable().optional(),
        errorMessage: z.string().nullable().optional(),
        exportedAt: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
      });
      const updateData = updateSchema.parse(req.body);
      const tenantId = getTenantIdWithFallback(req);
      const invoiceExport = await storage.updateFortnoxInvoiceExport(req.params.id, tenantId, updateData);
      if (!invoiceExport) return res.status(404).json({ error: "Export not found" });
      res.json(invoiceExport);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update Fortnox export:", error);
      res.status(500).json({ error: "Failed to update Fortnox export" });
    }
  });

  // ============================================
  // OBJECT IMAGES - Bildgalleri per objekt
  // ============================================

  app.get("/api/objects/:objectId/images", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const images = await storage.getObjectImages(req.params.objectId);
      res.json(images);
    } catch (error) {
      console.error("Failed to fetch object images:", error);
      res.status(500).json({ error: "Failed to fetch object images" });
    }
  });

  app.post("/api/objects/:objectId/images", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const data = insertObjectImageSchema.parse({
        ...req.body,
        tenantId,
        objectId: req.params.objectId
      });
      const image = await storage.createObjectImage(data);
      res.status(201).json(image);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create object image:", error);
      res.status(500).json({ error: "Failed to create object image" });
    }
  });

  app.delete("/api/objects/:objectId/images/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteObjectImage(req.params.id, req.params.objectId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete object image:", error);
      res.status(500).json({ error: "Failed to delete object image" });
    }
  });

  // ============================================
  // OBJECT CONTACTS - Kontakter med arvslogik
  // ============================================

  app.get("/api/objects/:objectId/contacts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const withInheritance = req.query.inheritance === "true";
      const contacts = withInheritance
        ? await storage.getObjectContactsWithInheritance(req.params.objectId, tenantId)
        : await storage.getObjectContacts(req.params.objectId);
      res.json(contacts);
    } catch (error) {
      console.error("Failed to fetch object contacts:", error);
      res.status(500).json({ error: "Failed to fetch object contacts" });
    }
  });

  app.post("/api/objects/:objectId/contacts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const data = insertObjectContactSchema.parse({
        ...req.body,
        tenantId,
        objectId: req.params.objectId
      });
      const contact = await storage.createObjectContact(data);
      res.status(201).json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create object contact:", error);
      res.status(500).json({ error: "Failed to create object contact" });
    }
  });

  app.patch("/api/objects/:objectId/contacts/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      const updateSchema = z.object({
        name: z.string().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        contactType: z.string().optional(),
        isInheritable: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      const contact = await storage.updateObjectContact(req.params.id, req.params.objectId, tenantId, updateData);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      res.json(contact);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update object contact:", error);
      res.status(500).json({ error: "Failed to update object contact" });
    }
  });

  app.delete("/api/objects/:objectId/contacts/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
        return res.status(403).json({ error: "Access denied" });
      }
      await storage.deleteObjectContact(req.params.id, req.params.objectId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete object contact:", error);
      res.status(500).json({ error: "Failed to delete object contact" });
    }
  });

  // ============================================
  // TASK TIMEWINDOWS - Flera önskade tidsfönster per uppgift
  // ============================================

  app.get("/api/task-timewindows", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const timewindows = await storage.getAllTaskTimewindows(tenantId);
      res.json(timewindows);
    } catch (error) {
      console.error("Failed to fetch all task timewindows:", error);
      res.status(500).json({ error: "Failed to fetch task timewindows" });
    }
  });

  app.get("/api/work-orders/:workOrderId/timewindows", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const timewindows = await storage.getTaskTimewindows(req.params.workOrderId);
      res.json(timewindows);
    } catch (error) {
      console.error("Failed to fetch task timewindows:", error);
      res.status(500).json({ error: "Failed to fetch task timewindows" });
    }
  });

  app.post("/api/work-orders/:workOrderId/timewindows", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const data = insertTaskDesiredTimewindowSchema.parse({
        ...req.body,
        tenantId,
        workOrderId: req.params.workOrderId
      });
      const timewindow = await storage.createTaskTimewindow(data);
      res.status(201).json(timewindow);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create task timewindow:", error);
      res.status(500).json({ error: "Failed to create task timewindow" });
    }
  });

  app.patch("/api/work-orders/:workOrderId/timewindows/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const updateSchema = z.object({
        weekNumber: z.number().nullable().optional(),
        dayOfWeek: z.string().nullable().optional(),
        startTime: z.string().nullable().optional(),
        endTime: z.string().nullable().optional(),
        priority: z.number().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      const timewindow = await storage.updateTaskTimewindow(req.params.id, req.params.workOrderId, tenantId, updateData);
      if (!timewindow) return res.status(404).json({ error: "Timewindow not found" });
      res.json(timewindow);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update task timewindow:", error);
      res.status(500).json({ error: "Failed to update task timewindow" });
    }
  });

  app.delete("/api/work-orders/:workOrderId/timewindows/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      await storage.deleteTaskTimewindow(req.params.id, req.params.workOrderId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete task timewindow:", error);
      res.status(500).json({ error: "Failed to delete task timewindow" });
    }
  });

  // ============================================
  // AUTO-PLAN WEEK (Fyll Veckan) - C4
  // ============================================
  app.post("/api/auto-plan-week", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { weekStartDate, resourceIds, overbookingPercent = 0 } = req.body;

      if (!weekStartDate || !resourceIds || !Array.isArray(resourceIds)) {
        return res.status(400).json({ error: "weekStartDate and resourceIds[] required" });
      }

      const weekStart = new Date(weekStartDate);
      const weekDays: Date[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        weekDays.push(d);
      }

      const allWorkOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true);
      const allResources = await storage.getResources(tenantId);

      const selectedResources = allResources.filter(r => resourceIds.includes(r.id));
      if (selectedResources.length === 0) {
        return res.status(400).json({ error: "No valid resources found" });
      }

      const allObjectIds = [...new Set(allWorkOrders.map(wo => wo.objectId).filter(Boolean) as string[])];
      const timeRestrictions = await storage.getObjectTimeRestrictionsByObjectIds(tenantId, allObjectIds);
      const restrictionsByObject = new Map<string, typeof timeRestrictions>();
      for (const r of timeRestrictions) {
        if (!restrictionsByObject.has(r.objectId)) restrictionsByObject.set(r.objectId, []);
        restrictionsByObject.get(r.objectId)!.push(r);
      }

      const unscheduledOrders = allWorkOrders.filter(wo => 
        (!wo.scheduledDate || !wo.resourceId) && 
        wo.status !== "completed" && wo.status !== "cancelled" &&
        wo.executionStatus !== "completed" && wo.executionStatus !== "invoiced"
      );

      if (unscheduledOrders.length === 0) {
        return res.json({ assignments: [], totalAssigned: 0, totalSkipped: 0 });
      }

      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      const sorted = [...unscheduledOrders].sort((a, b) => {
        const pA = priorityOrder[a.priority] ?? 99;
        const pB = priorityOrder[b.priority] ?? 99;
        if (pA !== pB) return pA - pB;
        if (a.plannedWindowStart && b.plannedWindowStart) {
          return new Date(a.plannedWindowStart).getTime() - new Date(b.plannedWindowStart).getTime();
        }
        if (a.plannedWindowStart) return -1;
        if (b.plannedWindowStart) return 1;
        return 0;
      });

      const HOURS_PER_DAY = 8;
      const maxMinutesPerDay = HOURS_PER_DAY * 60 * (1 + overbookingPercent / 100);

      const existingScheduled = allWorkOrders.filter(wo => wo.scheduledDate && wo.resourceId);
      const resourceDayMinutes: Record<string, Record<string, number>> = {};
      for (const resource of selectedResources) {
        resourceDayMinutes[resource.id] = {};
        for (const day of weekDays) {
          const dayStr = day.toISOString().split("T")[0];
          const dayMinutes = existingScheduled
            .filter(wo => {
              if (wo.resourceId !== resource.id) return false;
              const woDate = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(wo.scheduledDate!);
              return woDate.toISOString().split("T")[0] === dayStr;
            })
            .reduce((sum, wo) => sum + (wo.estimatedDuration || 60), 0);
          resourceDayMinutes[resource.id][dayStr] = dayMinutes;
        }
      }

      const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      const assignments: Array<{
        workOrderId: string;
        resourceId: string;
        scheduledDate: string;
        scheduledStartTime: string;
        title: string;
        address: string;
        estimatedDuration: number;
        priority: string;
      }> = [];
      const skipped: string[] = [];

      for (const order of sorted) {
        let assigned = false;
        const orderDur = order.estimatedDuration || 60;

        for (const day of weekDays) {
          if (assigned) break;
          const dayStr = day.toISOString().split("T")[0];
          const dayOfWeek = day.getDay() || 7;

          if (order.plannedWindowStart) {
            const winDate = new Date(order.plannedWindowStart).toISOString().split("T")[0];
            if (winDate !== dayStr) continue;
          }

          if (order.objectId) {
            const objRestrictions = restrictionsByObject.get(order.objectId) || [];
            const blocked = objRestrictions.some(r => {
              if (!r.isActive) return false;
              if (!r.weekdays || r.weekdays.length === 0) return false;
              if (!r.weekdays.includes(dayOfWeek)) return false;
              if (r.isBlockingAllDay) return true;
              return true;
            });
            if (blocked) continue;
          }

          let bestResource: typeof selectedResources[0] | null = null;
          let bestScore = Infinity;

          for (const resource of selectedResources) {
            if (order.executionCode && resource.executionCodes && resource.executionCodes.length > 0) {
              if (!resource.executionCodes.includes(order.executionCode)) continue;
            }

            const currentLoad = resourceDayMinutes[resource.id][dayStr] || 0;
            if (currentLoad + orderDur > maxMinutesPerDay) continue;

            let score = currentLoad;

            if (order.taskLatitude && order.taskLongitude) {
              const dayOrders = [...existingScheduled, ...assignments.map(a => ({
                ...allWorkOrders.find(wo => wo.id === a.workOrderId),
                resourceId: a.resourceId,
                scheduledDate: new Date(a.scheduledDate),
              }))].filter(wo => {
                if (!wo || wo.resourceId !== resource.id) return false;
                const woDate = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(wo.scheduledDate!);
                return woDate.toISOString().split("T")[0] === dayStr;
              });

              if (dayOrders.length > 0) {
                const lastOrder = dayOrders[dayOrders.length - 1] as any;
                if (lastOrder?.taskLatitude && lastOrder?.taskLongitude) {
                  const dist = haversine(lastOrder.taskLatitude, lastOrder.taskLongitude, order.taskLatitude!, order.taskLongitude!);
                  score += dist * 10;
                }
              }
            }

            if (!bestResource || score < bestScore) {
              bestResource = resource;
              bestScore = score;
            }
          }

          if (bestResource) {
            const currentLoad = resourceDayMinutes[bestResource.id][dayStr] || 0;
            const startMinutes = Math.max(8 * 60, currentLoad + 8 * 60);
            const startHour = Math.floor(startMinutes / 60);
            const startMin = startMinutes % 60;
            const startTime = `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;

            assignments.push({
              workOrderId: order.id,
              resourceId: bestResource.id,
              scheduledDate: dayStr,
              scheduledStartTime: startTime,
              title: order.title || "Utan titel",
              address: order.objectAddress || "",
              estimatedDuration: orderDur,
              priority: order.priority,
            });

            resourceDayMinutes[bestResource.id][dayStr] = (resourceDayMinutes[bestResource.id][dayStr] || 0) + orderDur;
            assigned = true;
          }
        }

        if (!assigned) {
          skipped.push(order.id);
        }
      }

      res.json({
        assignments,
        totalAssigned: assignments.length,
        totalSkipped: skipped.length,
        skippedIds: skipped,
      });
    } catch (error) {
      console.error("Auto-plan week error:", error);
      res.status(500).json({ error: "Failed to auto-plan week" });
    }
  });

  app.post("/api/auto-plan-week/apply", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { assignments } = req.body;

      if (!assignments || !Array.isArray(assignments)) {
        return res.status(400).json({ error: "assignments[] required" });
      }

      const results = [];
      for (const assignment of assignments) {
        const workOrder = await storage.getWorkOrder(assignment.workOrderId);
        if (!verifyTenantOwnership(workOrder, tenantId)) continue;

        const updated = await storage.updateWorkOrder(assignment.workOrderId, {
          resourceId: assignment.resourceId,
          scheduledDate: new Date(assignment.scheduledDate),
          scheduledStartTime: assignment.scheduledStartTime,
          orderStatus: "planerad_pre",
          executionStatus: "planned_rough",
        });
        results.push(updated);
      }

      res.json({ applied: results.length });
    } catch (error) {
      console.error("Apply auto-plan error:", error);
      res.status(500).json({ error: "Failed to apply auto-plan" });
    }
  });

  // ============================================
  // TASK DEPENDENCIES - Beroendelogik
  // ============================================

  app.get("/api/work-orders/:workOrderId/dependencies", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const dependencies = await storage.getTaskDependencies(req.params.workOrderId);
      res.json(dependencies);
    } catch (error) {
      console.error("Failed to fetch task dependencies:", error);
      res.status(500).json({ error: "Failed to fetch task dependencies" });
    }
  });

  app.get("/api/work-orders/:workOrderId/dependents", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const dependents = await storage.getTaskDependents(req.params.workOrderId);
      res.json(dependents);
    } catch (error) {
      console.error("Failed to fetch task dependents:", error);
      res.status(500).json({ error: "Failed to fetch task dependents" });
    }
  });

  app.post("/api/work-orders/:workOrderId/dependencies", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const data = insertTaskDependencySchema.parse({
        ...req.body,
        tenantId,
        workOrderId: req.params.workOrderId
      });
      const dependency = await storage.createTaskDependency(data);
      res.status(201).json(dependency);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create task dependency:", error);
      res.status(500).json({ error: "Failed to create task dependency" });
    }
  });

  app.delete("/api/work-orders/:workOrderId/dependencies/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      await storage.deleteTaskDependency(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete task dependency:", error);
      res.status(500).json({ error: "Failed to delete task dependency" });
    }
  });

  app.post("/api/task-dependencies/batch", async (req, res) => {
    try {
      const { workOrderIds } = req.body as { workOrderIds: string[] };
      if (!Array.isArray(workOrderIds)) {
        return res.status(400).json({ error: "workOrderIds must be an array" });
      }
      const result = await storage.getTaskDependenciesBatch(workOrderIds);
      res.json(result);
    } catch (error) {
      console.error("Failed to fetch batch dependencies:", error);
      res.status(500).json({ error: "Failed to fetch batch dependencies" });
    }
  });

  // ============================================
  // C7: AUTO-CREATE PICKUP TASKS (Beroendeartiklar)
  // ============================================

  app.post("/api/work-orders/:workOrderId/generate-pickup-tasks", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const mainWorkOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!mainWorkOrder || !verifyTenantOwnership(mainWorkOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }

      const lines = await storage.getWorkOrderLines(req.params.workOrderId);
      const createdPickups: any[] = [];

      for (const line of lines) {
        if (!line.articleId) continue;
        const article = await storage.getArticle(line.articleId);
        if (!article || article.articleType !== "beroende") continue;

        const minutesBefore = article.dependencyMinutesBefore || 120;
        let pickupDate: Date | null = null;
        let pickupStartTime: string | null = null;

        if (mainWorkOrder.scheduledDate) {
          const mainDate = mainWorkOrder.scheduledDate instanceof Date 
            ? mainWorkOrder.scheduledDate 
            : new Date(mainWorkOrder.scheduledDate);
          const [mainH, mainM] = (mainWorkOrder.scheduledStartTime || "08:00").split(":").map(Number);
          const mainMinutes = mainH * 60 + mainM;
          const pickupMinutes = mainMinutes - minutesBefore;

          if (pickupMinutes >= 0) {
            pickupDate = mainDate;
          } else {
            pickupDate = new Date(mainDate);
            pickupDate.setDate(pickupDate.getDate() - Math.ceil(Math.abs(pickupMinutes) / (8 * 60)));
          }

          const effectivePickupMinutes = ((pickupMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
          const clampedMinutes = Math.max(7 * 60, Math.min(effectivePickupMinutes, 17 * 60));
          const pH = Math.floor(clampedMinutes / 60);
          const pM = clampedMinutes % 60;
          pickupStartTime = `${pH.toString().padStart(2, "0")}:${pM.toString().padStart(2, "0")}`;
        }

        const pickupWorkOrder = await storage.createWorkOrder({
          tenantId,
          customerId: mainWorkOrder.customerId,
          objectId: mainWorkOrder.objectId,
          resourceId: mainWorkOrder.resourceId,
          title: `Plocka: ${article.name}`,
          description: `Automatisk plockuppgift för ${article.name}. Lagerplats: ${article.stockLocation || "Ej angiven"}`,
          orderType: "service",
          priority: mainWorkOrder.priority,
          status: "draft",
          orderStatus: mainWorkOrder.resourceId ? "planerad_pre" : "skapad",
          scheduledDate: pickupDate,
          scheduledStartTime: pickupStartTime,
          estimatedDuration: article.productionTime || 30,
          executionStatus: pickupDate ? "planned_rough" : "not_planned",
          creationMethod: "automatic",
          executionCode: mainWorkOrder.executionCode || undefined,
          taskLatitude: article.stockLatitude || undefined,
          taskLongitude: article.stockLongitude || undefined,
        });

        await storage.createTaskDependency({
          tenantId,
          workOrderId: req.params.workOrderId,
          dependsOnWorkOrderId: pickupWorkOrder.id,
          dependencyType: "automatic",
          structuralArticleId: article.id,
        });

        createdPickups.push({
          pickupWorkOrderId: pickupWorkOrder.id,
          articleName: article.name,
          articleId: article.id,
          scheduledDate: pickupDate?.toISOString().split("T")[0],
          scheduledStartTime: pickupStartTime,
          stockLocation: article.stockLocation,
        });
      }

      res.json({
        created: createdPickups.length,
        pickupTasks: createdPickups,
        mainWorkOrderId: req.params.workOrderId,
      });
    } catch (error) {
      console.error("Generate pickup tasks error:", error);
      res.status(500).json({ error: "Failed to generate pickup tasks" });
    }
  });

  // C7: Get full dependency chain for a work order
  app.get("/api/work-orders/:workOrderId/dependency-chain", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }

      const dependencies = await storage.getTaskDependencies(req.params.workOrderId);
      const dependents = await storage.getTaskDependents(req.params.workOrderId);

      const chain: any[] = [];

      for (const dep of dependencies) {
        const depOrder = await storage.getWorkOrder(dep.dependsOnWorkOrderId);
        if (depOrder) {
          chain.push({
            type: "depends_on",
            dependencyType: dep.dependencyType,
            workOrder: {
              id: depOrder.id,
              title: depOrder.title,
              status: depOrder.status,
              executionStatus: depOrder.executionStatus,
              scheduledDate: depOrder.scheduledDate,
              scheduledStartTime: depOrder.scheduledStartTime,
              creationMethod: depOrder.creationMethod,
            },
          });
        }
      }

      for (const dep of dependents) {
        const depOrder = await storage.getWorkOrder(dep.workOrderId);
        if (depOrder) {
          chain.push({
            type: "blocks",
            dependencyType: dep.dependencyType,
            workOrder: {
              id: depOrder.id,
              title: depOrder.title,
              status: depOrder.status,
              executionStatus: depOrder.executionStatus,
              scheduledDate: depOrder.scheduledDate,
              scheduledStartTime: depOrder.scheduledStartTime,
              creationMethod: depOrder.creationMethod,
            },
          });
        }
      }

      res.json({
        workOrderId: req.params.workOrderId,
        chain,
      });
    } catch (error) {
      console.error("Failed to fetch dependency chain:", error);
      res.status(500).json({ error: "Failed to fetch dependency chain" });
    }
  });

  // ============================================
  // TASK INFORMATION - Bilagor och info
  // ============================================

  app.get("/api/work-orders/:workOrderId/information", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const information = await storage.getTaskInformation(req.params.workOrderId);
      res.json(information);
    } catch (error) {
      console.error("Failed to fetch task information:", error);
      res.status(500).json({ error: "Failed to fetch task information" });
    }
  });

  app.post("/api/work-orders/:workOrderId/information", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const data = insertTaskInformationSchema.parse({
        ...req.body,
        tenantId,
        workOrderId: req.params.workOrderId
      });
      const info = await storage.createTaskInformation(data);
      res.status(201).json(info);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create task information:", error);
      res.status(500).json({ error: "Failed to create task information" });
    }
  });

  app.patch("/api/work-orders/:workOrderId/information/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      const updateSchema = z.object({
        infoValue: z.string().nullable().optional(),
        hasLogic: z.boolean().optional(),
        linkedArticleId: z.string().nullable().optional(),
        quantity: z.number().nullable().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      const info = await storage.updateTaskInformation(req.params.id, req.params.workOrderId, tenantId, updateData);
      if (!info) return res.status(404).json({ error: "Information not found" });
      res.json(info);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update task information:", error);
      res.status(500).json({ error: "Failed to update task information" });
    }
  });

  app.delete("/api/work-orders/:workOrderId/information/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }
      await storage.deleteTaskInformation(req.params.id, req.params.workOrderId, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete task information:", error);
      res.status(500).json({ error: "Failed to delete task information" });
    }
  });

  // ============================================
  // OBJECT TIME RESTRICTIONS (C9) - Tidsbegränsningar
  // ============================================

  app.get("/api/objects/:objectId/time-restrictions", async (req, res) => {
    try {
      const restrictions = await storage.getObjectTimeRestrictions(req.params.objectId);
      res.json(restrictions);
    } catch (error) {
      console.error("Failed to fetch time restrictions:", error);
      res.status(500).json({ error: "Failed to fetch time restrictions" });
    }
  });

  app.get("/api/time-restrictions", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const objectIds = req.query.objectIds ? (req.query.objectIds as string).split(",") : [];
      let restrictions;
      if (objectIds.length > 0) {
        restrictions = await storage.getObjectTimeRestrictionsByObjectIds(tenantId, objectIds);
      } else {
        restrictions = await storage.getObjectTimeRestrictionsByTenant(tenantId);
      }
      res.json(restrictions);
    } catch (error) {
      console.error("Failed to fetch time restrictions:", error);
      res.status(500).json({ error: "Failed to fetch time restrictions" });
    }
  });

  app.post("/api/objects/:objectId/time-restrictions", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { restrictionType, description, weekdays, startTime, endTime, isBlockingAllDay } = req.body;
      if (!restrictionType) return res.status(400).json({ error: "restrictionType is required" });

      const obj = await storage.getObject(req.params.objectId);
      if (!obj || obj.tenantId !== tenantId) return res.status(404).json({ error: "Object not found" });

      const restriction = await storage.createObjectTimeRestriction({
        tenantId,
        objectId: req.params.objectId,
        restrictionType,
        description: description || null,
        weekdays: weekdays || [],
        startTime: startTime || null,
        endTime: endTime || null,
        isBlockingAllDay: isBlockingAllDay ?? true,
        isActive: true,
      });
      res.json(restriction);
    } catch (error) {
      console.error("Failed to create time restriction:", error);
      res.status(500).json({ error: "Failed to create time restriction" });
    }
  });

  app.patch("/api/time-restrictions/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const restriction = await storage.updateObjectTimeRestriction(req.params.id, tenantId, req.body);
      if (!restriction) return res.status(404).json({ error: "Not found" });
      res.json(restriction);
    } catch (error) {
      console.error("Failed to update time restriction:", error);
      res.status(500).json({ error: "Failed to update time restriction" });
    }
  });

  app.delete("/api/time-restrictions/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteObjectTimeRestriction(req.params.id, tenantId);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete time restriction:", error);
      res.status(500).json({ error: "Failed to delete time restriction" });
    }
  });

  // C10 - Expand structural article into sub-step work orders
  app.post("/api/work-orders/:id/expand-structural", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });

      const articleId = workOrder.articleId;
      if (!articleId) return res.status(400).json({ error: "Work order has no article" });

      const subArticles = await storage.getStructuralArticlesByParent(articleId);
      if (subArticles.length === 0) return res.json({ created: [], message: "No structural sub-articles found" });

      const created: any[] = [];
      for (const sub of subArticles) {
        const childArticle = await storage.getArticle(sub.childArticleId);
        const subWorkOrder = await storage.createWorkOrder({
          tenantId,
          title: sub.stepName || childArticle?.name || "Delsteg",
          description: `Delsteg ${sub.sequenceOrder}: ${sub.stepName || childArticle?.name || ""}`,
          status: "pending",
          executionStatus: "not_planned",
          articleId: sub.childArticleId,
          objectId: workOrder.objectId,
          customerId: workOrder.customerId,
          resourceId: workOrder.resourceId,
          scheduledDate: workOrder.scheduledDate,
          scheduledStartTime: workOrder.scheduledStartTime,
          estimatedDuration: sub.defaultDurationMinutes || childArticle?.productionTime || 30,
          structuralArticleId: articleId,
          creationMethod: "structural",
          executionCode: workOrder.executionCode,
        });

        await storage.createTaskDependency({
          tenantId,
          workOrderId: subWorkOrder.id,
          dependsOnWorkOrderId: workOrder.id,
          dependencyType: "structural",
          structuralArticleId: sub.childArticleId,
        });

        created.push({
          workOrder: subWorkOrder,
          stepName: sub.stepName,
          sequenceOrder: sub.sequenceOrder,
          isOptional: sub.isOptional,
        });
      }

      res.json({ created, parentId: workOrder.id });
    } catch (error) {
      console.error("Failed to expand structural article:", error);
      res.status(500).json({ error: "Failed to expand structural article" });
    }
  });

  // C10 - Get sub-steps for a work order (structural children)
  app.get("/api/work-orders/:id/sub-steps", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });

      const allDeps = await storage.getTaskDependencies(req.params.id);
      const structuralDeps = allDeps.filter(d => d.dependsOnWorkOrderId === req.params.id && d.dependencyType === "structural");

      const subSteps: any[] = [];
      for (const dep of structuralDeps) {
        const subWo = await storage.getWorkOrder(dep.workOrderId);
        if (subWo) {
          subSteps.push({
            id: subWo.id,
            title: subWo.title,
            status: subWo.status,
            executionStatus: subWo.executionStatus,
            estimatedDuration: subWo.estimatedDuration,
            structuralArticleId: dep.structuralArticleId,
          });
        }
      }

      const articleId = workOrder.articleId;
      let structuralInfo = null;
      if (articleId) {
        const subArticles = await storage.getStructuralArticlesByParent(articleId);
        if (subArticles.length > 0) {
          structuralInfo = {
            totalSteps: subArticles.length,
            steps: subArticles.map(s => ({
              childArticleId: s.childArticleId,
              stepName: s.stepName,
              sequenceOrder: s.sequenceOrder,
              isOptional: s.isOptional,
              defaultDurationMinutes: s.defaultDurationMinutes,
            })),
          };
        }
      }

      const completedCount = subSteps.filter(s => s.executionStatus === "completed" || s.executionStatus === "inspected" || s.executionStatus === "invoiced").length;

      res.json({
        subSteps,
        structuralInfo,
        progress: {
          completed: completedCount,
          total: subSteps.length || structuralInfo?.totalSteps || 0,
        },
      });
    } catch (error) {
      console.error("Failed to fetch sub-steps:", error);
      res.status(500).json({ error: "Failed to fetch sub-steps" });
    }
  });

  // ============================================
  // STRUCTURAL ARTICLES - Artiklar med beroendeuppgifter
  // ============================================

  app.get("/api/structural-articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const articles = await storage.getStructuralArticles(tenantId);
      res.json(articles);
    } catch (error) {
      console.error("Failed to fetch structural articles:", error);
      res.status(500).json({ error: "Failed to fetch structural articles" });
    }
  });

  app.get("/api/articles/:articleId/structural-children", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const article = await storage.getArticle(req.params.articleId);
      if (!verifyTenantOwnership(article, tenantId)) {
        return res.status(404).json({ error: "Article not found" });
      }
      const children = await storage.getStructuralArticlesByParent(req.params.articleId);
      res.json(children);
    } catch (error) {
      console.error("Failed to fetch structural article children:", error);
      res.status(500).json({ error: "Failed to fetch structural article children" });
    }
  });

  app.post("/api/structural-articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const data = insertStructuralArticleSchema.parse({
        ...req.body,
        tenantId
      });
      const article = await storage.createStructuralArticle(data);
      res.status(201).json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create structural article:", error);
      res.status(500).json({ error: "Failed to create structural article" });
    }
  });

  app.patch("/api/structural-articles/:id", async (req, res) => {
    try {
      const updateSchema = z.object({
        sequenceOrder: z.number().optional(),
        stepName: z.string().nullable().optional(),
        taskType: z.string().nullable().optional(),
      });
      const updateData = updateSchema.parse(req.body);
      const tenantId = getTenantIdWithFallback(req);
      const article = await storage.updateStructuralArticle(req.params.id, tenantId, updateData);
      if (!article) return res.status(404).json({ error: "Structural article not found" });
      res.json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to update structural article:", error);
      res.status(500).json({ error: "Failed to update structural article" });
    }
  });

  app.delete("/api/structural-articles/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteStructuralArticle(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete structural article:", error);
      res.status(500).json({ error: "Failed to delete structural article" });
    }
  });

  // Preview dynamic structural article steps
  app.post("/api/structural-articles/:parentArticleId/preview-tasks", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { parentArticleId } = req.params;
      const { executionDate, objectMetadata, individualObjects } = req.body;
      
      // Get all structural articles for this parent
      const allStructuralArticles = await storage.getStructuralArticles(tenantId);
      const steps = allStructuralArticles.filter(sa => sa.parentArticleId === parentArticleId);
      
      if (steps.length === 0) {
        return res.json({ 
          tasks: [], 
          totalDuration: 0, 
          message: "Inga strukturartiklar hittades för denna artikel" 
        });
      }
      
      const { generateTasksFromStructuralArticle, calculateTotalDuration } = await import('./structural-article-utils');
      
      const date = executionDate ? new Date(executionDate) : new Date();
      const metadata = objectMetadata || {};
      const objects = individualObjects || [];
      
      const tasks = generateTasksFromStructuralArticle(steps, date, metadata, objects);
      const totalDuration = calculateTotalDuration(tasks);
      
      // Get article names for display
      const allArticles = await storage.getArticles(tenantId);
      const articlesMap = new Map(allArticles.map(a => [a.id, a]));
      
      const tasksWithNames = tasks.map(task => ({
        ...task,
        articleName: articlesMap.get(task.articleId)?.name || 'Okänd artikel',
      }));
      
      res.json({
        tasks: tasksWithNames,
        totalDuration,
        applicableCount: tasks.filter(t => t.isApplicable).length,
        skippedCount: tasks.filter(t => !t.isApplicable).length,
      });
    } catch (error) {
      console.error("Failed to preview structural article tasks:", error);
      res.status(500).json({ error: "Failed to preview structural article tasks" });
    }
  });

  app.post("/api/work-orders/:workOrderId/expand-structural", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Work order not found" });
      }

      // Use structuralArticleId from work order
      const structuralArticleId = workOrder.structuralArticleId;
      if (!structuralArticleId) {
        return res.json({ expanded: [], message: "Ingen strukturartikel att expandera" });
      }
      
      const allStructuralArticles = await storage.getStructuralArticles(tenantId);
      const structuralArticlesMap = new Map<string, typeof allStructuralArticles>();
      
      for (const sa of allStructuralArticles) {
        const existing = structuralArticlesMap.get(sa.parentArticleId) || [];
        existing.push(sa);
        structuralArticlesMap.set(sa.parentArticleId, existing);
      }

      if (!structuralArticlesMap.has(structuralArticleId)) {
        return res.json({ expanded: [], message: "Inga strukturartiklar hittades" });
      }

      const allArticles = await storage.getArticles(tenantId);
      const articlesMap = new Map(allArticles.map(a => [a.id, a]));

      const { expandStructuralArticle } = await import("./ai-planner");

      const children = structuralArticlesMap.get(structuralArticleId) || [];
      
      const result = await expandStructuralArticle(
        workOrder,
        structuralArticleId,
        children,
        articlesMap,
        async (data: Record<string, unknown>) => storage.createWorkOrder({ ...data, tenantId: workOrder.tenantId } as typeof insertWorkOrderSchema._type),
        async (data: Record<string, unknown>) => storage.createTaskDependency(data as typeof insertTaskDependencySchema._type)
      );

      res.json({
        expanded: [result],
        message: `${result.createdWorkOrders.length} deluppgifter skapades`
      });
    } catch (error) {
      console.error("Failed to expand structural articles:", error);
      res.status(500).json({ error: "Kunde inte expandera strukturartiklar" });
    }
  });

  // Route Optimization API
  app.post("/api/route/optimize", async (req, res) => {
    try {
      const { stops } = req.body;
      
      if (!stops || !Array.isArray(stops)) {
        return res.status(400).json({ error: "Stops array krävs" });
      }
      
      const { optimizeRoute } = await import("./ai-planner");
      
      const result = await optimizeRoute(stops);
      
      res.json(result);
    } catch (error) {
      console.error("Failed to optimize route:", error);
      res.status(500).json({ error: "Kunde inte optimera rutt" });
    }
  });

  // Generate Google Maps URL for route
  app.post("/api/route/google-maps-url", async (req, res) => {
    try {
      const { stops } = req.body;
      
      if (!stops || !Array.isArray(stops)) {
        return res.status(400).json({ error: "Stops array krävs" });
      }
      
      const { generateGoogleMapsUrl } = await import("./ai-planner");
      
      const url = generateGoogleMapsUrl(stops);
      
      res.json({ url });
    } catch (error) {
      console.error("Failed to generate Google Maps URL:", error);
      res.status(500).json({ error: "Kunde inte generera Google Maps-länk" });
    }
  });

  // Send route to mobile app via WebSocket
  app.post("/api/route/send-to-mobile", async (req, res) => {
    try {
      const { resourceId, stops, date, googleMapsUrl } = req.body;
      
      if (!resourceId || !stops) {
        return res.status(400).json({ error: "ResourceId och stops krävs" });
      }
      
      // Send notification to the specific resource's mobile app
      notificationService.sendToResource(resourceId, {
        type: "route_update",
        title: "Ny rutt tilldelad",
        message: `Du har fått en rutt med ${stops.length} stopp för ${date}`,
        data: {
          stops,
          googleMapsUrl,
          date
        }
      });
      
      res.json({ 
        success: true, 
        message: `Rutt skickad till resurs ${resourceId}` 
      });
    } catch (error) {
      console.error("Failed to send route to mobile:", error);
      res.status(500).json({ error: "Kunde inte skicka rutt till mobilapp" });
    }
  });

  // ============================================
  // ORDER CONCEPTS API
  // ============================================
  
  app.get("/api/order-concepts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const concepts = await storage.getOrderConcepts(tenantId);
      res.json(concepts);
    } catch (error) {
      console.error("Failed to get order concepts:", error);
      res.status(500).json({ error: "Kunde inte hämta orderkoncept" });
    }
  });

  app.get("/api/order-concepts/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const concept = await storage.getOrderConcept(req.params.id);
      const verifiedConcept = verifyTenantOwnership(concept, tenantId);
      if (!verifiedConcept) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }
      
      const filters = await storage.getConceptFilters(verifiedConcept.id);
      res.json({ ...verifiedConcept, filters });
    } catch (error) {
      console.error("Failed to get order concept:", error);
      res.status(500).json({ error: "Kunde inte hämta orderkoncept" });
    }
  });

  app.post("/api/order-concepts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const userId = req.session?.user?.id;
      
      const concept = await storage.createOrderConcept({
        ...req.body,
        tenantId,
        createdBy: userId
      });
      res.status(201).json(concept);
    } catch (error) {
      console.error("Failed to create order concept:", error);
      res.status(500).json({ error: "Kunde inte skapa orderkoncept" });
    }
  });

  app.patch("/api/order-concepts/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getOrderConcept(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }
      
      const concept = await storage.updateOrderConcept(req.params.id, tenantId, req.body);
      res.json(concept);
    } catch (error) {
      console.error("Failed to update order concept:", error);
      res.status(500).json({ error: "Kunde inte uppdatera orderkoncept" });
    }
  });

  app.delete("/api/order-concepts/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getOrderConcept(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }
      
      await storage.deleteOrderConcept(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete order concept:", error);
      res.status(500).json({ error: "Kunde inte radera orderkoncept" });
    }
  });

  // Concept Filters
  app.get("/api/order-concepts/:conceptId/filters", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const concept = await storage.getOrderConcept(req.params.conceptId);
      if (!verifyTenantOwnership(concept, tenantId)) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }
      
      const filters = await storage.getConceptFilters(req.params.conceptId);
      res.json(filters);
    } catch (error) {
      console.error("Failed to get concept filters:", error);
      res.status(500).json({ error: "Kunde inte hämta filter" });
    }
  });

  app.post("/api/order-concepts/:conceptId/filters", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const concept = await storage.getOrderConcept(req.params.conceptId);
      if (!verifyTenantOwnership(concept, tenantId)) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }
      
      const filter = await storage.createConceptFilter({
        ...req.body,
        orderConceptId: req.params.conceptId
      });
      res.status(201).json(filter);
    } catch (error) {
      console.error("Failed to create concept filter:", error);
      res.status(500).json({ error: "Kunde inte skapa filter" });
    }
  });

  app.delete("/api/order-concepts/:conceptId/filters/:filterId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const concept = await storage.getOrderConcept(req.params.conceptId);
      if (!verifyTenantOwnership(concept, tenantId)) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }
      
      await storage.deleteConceptFilter(req.params.filterId, req.params.conceptId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete concept filter:", error);
      res.status(500).json({ error: "Kunde inte radera filter" });
    }
  });

  // Execute order concept - generates assignments from filters
  app.post("/api/order-concepts/:id/execute", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const userId = req.session?.user?.id;
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }

      const filters = await storage.getConceptFilters(concept.id);
      
      // Get all objects in the cluster hierarchy
      let targetObjects: ServiceObject[] = [];
      if (concept.targetClusterId) {
        const clusterObjects = await storage.getClusterObjects(concept.targetClusterId);
        targetObjects = clusterObjects;
      } else {
        targetObjects = await storage.getObjects(tenantId);
      }

      // Apply filters to find matching objects
      const matchingObjects = targetObjects.filter(obj => {
        return filters.every(filter => {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
          const filterValue = filter.filterValue;
          
          switch (filter.operator) {
            case "equals":
              return metadataValue === filterValue;
            case "not_equals":
              return metadataValue !== filterValue;
            case "contains":
              return String(metadataValue || "").includes(String(filterValue));
            case "starts_with":
              return String(metadataValue || "").startsWith(String(filterValue));
            case "greater_than":
              return Number(metadataValue) > Number(filterValue);
            case "less_than":
              return Number(metadataValue) < Number(filterValue);
            case "in_list":
              return Array.isArray(filterValue) && filterValue.includes(metadataValue);
            case "exists":
              return metadataValue !== undefined && metadataValue !== null;
            case "not_exists":
              return metadataValue === undefined || metadataValue === null;
            default:
              return true;
          }
        });
      });

      // Generate assignments for each matching object
      const createdAssignments = [];
      const scheduledDate = req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined;
      
      // Fetch article once before loop if concept has articleId
      let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
      if (concept.articleId) {
        linkedArticle = await storage.getArticle(concept.articleId);
      }

      for (const obj of matchingObjects) {
        // Cross-pollination: multiply by metadata field if specified
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        let quantity = 1;
        if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
          quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
        }

        // Calculate estimated duration from linked article
        let estimatedDuration = 60; // default 60 minutes
        let totalValue = 0;
        let totalCost = 0;
        
        if (linkedArticle) {
          estimatedDuration = (linkedArticle.productionTime || 0) * quantity;
          totalValue = (linkedArticle.listPrice || 0) * quantity;
          totalCost = (linkedArticle.cost || 0) * quantity;
        }

        const assignment = await storage.createAssignment({
          tenantId,
          orderConceptId: concept.id,
          objectId: obj.id,
          clusterId: obj.clusterId || undefined,
          title: concept.name,
          description: concept.description || undefined,
          status: "not_planned",
          priority: concept.priority || "normal",
          scheduledDate,
          quantity,
          address: obj.address || undefined,
          latitude: obj.latitude || undefined,
          longitude: obj.longitude || undefined,
          creationMethod: "automatic",
          createdBy: userId,
          estimatedDuration,
          cachedValue: totalValue,
          cachedCost: totalCost
        });

        // If an article is linked, create assignment article
        if (linkedArticle && concept.articleId) {
          await storage.createAssignmentArticle({
            assignmentId: assignment.id,
            articleId: concept.articleId,
            quantity,
            unitPrice: linkedArticle.listPrice || 0,
            totalPrice: (linkedArticle.listPrice || 0) * quantity,
            unitCost: linkedArticle.cost || 0,
            totalCost: (linkedArticle.cost || 0) * quantity,
            unitTime: linkedArticle.productionTime || 0,
            totalTime: (linkedArticle.productionTime || 0) * quantity,
            sequenceOrder: 1,
            status: "pending"
          });
        }

        createdAssignments.push(assignment);
      }

      // Update last run date
      await storage.updateOrderConcept(concept.id, tenantId, {
        lastRunDate: new Date()
      });

      res.json({
        success: true,
        message: `Skapade ${createdAssignments.length} uppgifter från ${matchingObjects.length} matchande objekt`,
        assignmentsCreated: createdAssignments.length,
        objectsMatched: matchingObjects.length,
        assignments: createdAssignments
      });
    } catch (error) {
      console.error("Failed to execute order concept:", error);
      res.status(500).json({ error: "Kunde inte köra orderkoncept" });
    }
  });

  // Preview order concept execution (dry run)
  app.post("/api/order-concepts/:id/preview", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }

      const filters = await storage.getConceptFilters(concept.id);
      
      let targetObjects: ServiceObject[] = [];
      if (concept.targetClusterId) {
        targetObjects = await storage.getClusterObjects(concept.targetClusterId);
      } else {
        targetObjects = await storage.getObjects(tenantId);
      }

      const matchingObjects = targetObjects.filter(obj => {
        return filters.every(filter => {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
          const filterValue = filter.filterValue;
          switch (filter.operator) {
            case "equals": return metadataValue === filterValue;
            case "not_equals": return metadataValue !== filterValue;
            case "contains": return String(metadataValue || "").includes(String(filterValue));
            case "greater_than": return Number(metadataValue) > Number(filterValue);
            case "less_than": return Number(metadataValue) < Number(filterValue);
            case "exists": return metadataValue !== undefined && metadataValue !== null;
            case "not_exists": return metadataValue === undefined || metadataValue === null;
            default: return true;
          }
        });
      });

      let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
      if (concept.articleId) {
        linkedArticle = await storage.getArticle(concept.articleId);
      }

      const previewItems = matchingObjects.map(obj => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        let quantity = 1;
        if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
          quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
        }
        const unitPrice = linkedArticle?.listPrice || 0;
        return {
          objectId: obj.id,
          objectName: obj.name,
          address: obj.address,
          quantity,
          articleName: linkedArticle?.name || "-",
          estimatedDuration: (linkedArticle?.productionTime || 0) * quantity,
          estimatedValue: unitPrice * quantity,
        };
      });

      // Generate rolling schedule preview if scenario is "schema"
      let schedulePreview: Array<{ date: string; objectCount: number }> = [];
      if (concept.scenario === "schema" && concept.deliverySchedule) {
        const schedule = concept.deliverySchedule as Array<{ month: number; weekNumber: number; weekday: number; timeWindowStart?: string; timeWindowEnd?: string }>;
        const months = concept.rollingMonths || 3;
        const now = new Date();
        for (let m = 0; m < months; m++) {
          const targetMonth = new Date(now.getFullYear(), now.getMonth() + m, 1);
          for (const entry of schedule) {
            if (entry.month && entry.month !== targetMonth.getMonth() + 1) continue;
            const date = getDateFromWeekdayInMonth(targetMonth.getFullYear(), targetMonth.getMonth(), entry.weekNumber, entry.weekday);
            if (date && date >= now) {
              schedulePreview.push({
                date: date.toISOString().split('T')[0],
                objectCount: matchingObjects.length,
              });
            }
          }
        }
        schedulePreview.sort((a, b) => a.date.localeCompare(b.date));
      }

      // Subscription calculation for "abonnemang" scenario
      let subscriptionCalc: { totalUnits: number; monthlyTotal: number; yearlyTotal: number } | undefined;
      if (concept.scenario === "abonnemang" && concept.monthlyFee) {
        let totalUnits = 0;
        for (const obj of matchingObjects) {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          if (concept.subscriptionMetadataField && objWithMeta.metadata?.[concept.subscriptionMetadataField]) {
            totalUnits += Number(objWithMeta.metadata[concept.subscriptionMetadataField]) || 1;
          } else {
            totalUnits += 1;
          }
        }
        subscriptionCalc = {
          totalUnits,
          monthlyTotal: totalUnits * concept.monthlyFee,
          yearlyTotal: totalUnits * concept.monthlyFee * 12,
        };
      }

      res.json({
        objectsMatched: matchingObjects.length,
        totalFilters: filters.length,
        items: previewItems,
        schedulePreview,
        subscriptionCalc,
      });
    } catch (error) {
      console.error("Failed to preview order concept:", error);
      res.status(500).json({ error: "Kunde inte förhandsgranska orderkoncept" });
    }
  });

  // Rolling schedule execution - generate assignments for upcoming windows
  app.post("/api/order-concepts/:id/run-rolling", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const userId = req.session?.user?.id;
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }

      if (concept.scenario !== "schema" || !concept.deliverySchedule) {
        return res.status(400).json({ error: "Konceptet har inget leveransschema" });
      }

      const filters = await storage.getConceptFilters(concept.id);
      let targetObjects: ServiceObject[] = [];
      if (concept.targetClusterId) {
        targetObjects = await storage.getClusterObjects(concept.targetClusterId);
      } else {
        targetObjects = await storage.getObjects(tenantId);
      }

      const matchingObjects = targetObjects.filter(obj => {
        return filters.every(filter => {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
          const filterValue = filter.filterValue;
          switch (filter.operator) {
            case "equals": return metadataValue === filterValue;
            case "not_equals": return metadataValue !== filterValue;
            case "contains": return String(metadataValue || "").includes(String(filterValue));
            case "greater_than": return Number(metadataValue) > Number(filterValue);
            case "less_than": return Number(metadataValue) < Number(filterValue);
            case "exists": return metadataValue !== undefined && metadataValue !== null;
            case "not_exists": return metadataValue === undefined || metadataValue === null;
            default: return true;
          }
        });
      });

      let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
      if (concept.articleId) {
        linkedArticle = await storage.getArticle(concept.articleId);
      }

      const schedule = concept.deliverySchedule as Array<{ month: number; weekNumber: number; weekday: number; timeWindowStart?: string; timeWindowEnd?: string }>;
      const months = concept.rollingMonths || 3;
      const now = new Date();
      const createdAssignments = [];

      for (let m = 0; m < months; m++) {
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + m, 1);
        for (const entry of schedule) {
          if (entry.month && entry.month !== targetMonth.getMonth() + 1) continue;
          const date = getDateFromWeekdayInMonth(targetMonth.getFullYear(), targetMonth.getMonth(), entry.weekNumber, entry.weekday);
          if (!date || date < now) continue;

          for (const obj of matchingObjects) {
            const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
            let quantity = 1;
            if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
              quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
            }

            const estimatedDuration = (linkedArticle?.productionTime || 0) * quantity || 60;
            const totalValue = (linkedArticle?.listPrice || 0) * quantity;
            const totalCost = (linkedArticle?.cost || 0) * quantity;

            const assignment = await storage.createAssignment({
              tenantId,
              orderConceptId: concept.id,
              objectId: obj.id,
              clusterId: obj.clusterId || undefined,
              title: concept.name,
              description: concept.description || undefined,
              status: "not_planned",
              priority: concept.priority || "normal",
              scheduledDate: date,
              plannedWindowStart: entry.timeWindowStart ? new Date(`${date.toISOString().split('T')[0]}T${entry.timeWindowStart}:00`) : undefined,
              plannedWindowEnd: entry.timeWindowEnd ? new Date(`${date.toISOString().split('T')[0]}T${entry.timeWindowEnd}:00`) : undefined,
              quantity,
              address: obj.address || undefined,
              latitude: obj.latitude || undefined,
              longitude: obj.longitude || undefined,
              creationMethod: "automatic",
              createdBy: userId,
              estimatedDuration,
              cachedValue: totalValue,
              cachedCost: totalCost,
            });

            if (linkedArticle && concept.articleId) {
              await storage.createAssignmentArticle({
                assignmentId: assignment.id,
                articleId: concept.articleId,
                quantity,
                unitPrice: linkedArticle.listPrice || 0,
                totalPrice: totalValue,
                unitCost: linkedArticle.cost || 0,
                totalCost,
                unitTime: linkedArticle.productionTime || 0,
                totalTime: estimatedDuration,
                sequenceOrder: 1,
                status: "pending"
              });
            }

            createdAssignments.push(assignment);
          }
        }
      }

      await storage.updateOrderConcept(concept.id, tenantId, {
        lastRunDate: new Date(),
        nextRunDate: new Date(now.getFullYear(), now.getMonth() + months, 1),
      });

      res.json({
        success: true,
        message: `Genererade ${createdAssignments.length} uppgifter för ${months} månader framåt`,
        assignmentsCreated: createdAssignments.length,
        objectsMatched: matchingObjects.length,
      });
    } catch (error) {
      console.error("Failed to run rolling schedule:", error);
      res.status(500).json({ error: "Kunde inte köra rullande schema" });
    }
  });

  // Subscription calculation
  app.get("/api/order-concepts/:id/subscription-calc", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept) {
        return res.status(404).json({ error: "Orderkoncept hittades inte" });
      }

      const filters = await storage.getConceptFilters(concept.id);
      let targetObjects: ServiceObject[] = [];
      if (concept.targetClusterId) {
        targetObjects = await storage.getClusterObjects(concept.targetClusterId);
      } else {
        targetObjects = await storage.getObjects(tenantId);
      }

      const matchingObjects = targetObjects.filter(obj => {
        return filters.every(filter => {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
          const filterValue = filter.filterValue;
          switch (filter.operator) {
            case "equals": return metadataValue === filterValue;
            case "not_equals": return metadataValue !== filterValue;
            case "exists": return metadataValue !== undefined && metadataValue !== null;
            default: return true;
          }
        });
      });

      const perObject = matchingObjects.map(obj => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        let units = 1;
        if (concept.subscriptionMetadataField && objWithMeta.metadata?.[concept.subscriptionMetadataField]) {
          units = Number(objWithMeta.metadata[concept.subscriptionMetadataField]) || 1;
        }
        return {
          objectId: obj.id,
          objectName: obj.name,
          units,
          monthlyFee: (concept.monthlyFee || 0) * units,
        };
      });

      const totalUnits = perObject.reduce((sum, p) => sum + p.units, 0);
      const monthlyTotal = perObject.reduce((sum, p) => sum + p.monthlyFee, 0);

      res.json({
        perObject,
        totalUnits,
        monthlyTotal,
        quarterlyTotal: monthlyTotal * 3,
        yearlyTotal: monthlyTotal * 12,
        billingFrequency: concept.billingFrequency || "monthly",
        contractLockMonths: concept.contractLockMonths,
      });
    } catch (error) {
      console.error("Failed to calc subscription:", error);
      res.status(500).json({ error: "Kunde inte beräkna abonnemang" });
    }
  });

  // Subscription changes
  app.get("/api/subscription-changes", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { conceptId, status } = req.query;
      const changes = await storage.getSubscriptionChanges(
        tenantId,
        conceptId as string | undefined,
        status as string | undefined
      );
      res.json(changes);
    } catch (error) {
      console.error("Failed to get subscription changes:", error);
      res.status(500).json({ error: "Kunde inte hämta abonnemangsändringar" });
    }
  });

  app.patch("/api/subscription-changes/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const userId = req.session?.user?.id;
      const { approvalStatus } = req.body;
      if (!approvalStatus || !["approved", "rejected"].includes(approvalStatus)) {
        return res.status(400).json({ error: "Ogiltig status" });
      }
      const change = await storage.updateSubscriptionChangeStatus(
        req.params.id, tenantId, approvalStatus, userId
      );
      if (!change) {
        return res.status(404).json({ error: "Ändring hittades inte" });
      }
      res.json(change);
    } catch (error) {
      console.error("Failed to update subscription change:", error);
      res.status(500).json({ error: "Kunde inte uppdatera ändring" });
    }
  });

  // Detect subscription changes
  app.post("/api/order-concepts/:id/detect-changes", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept || concept.scenario !== "abonnemang") {
        return res.status(400).json({ error: "Konceptet är inte ett abonnemang" });
      }

      const filters = await storage.getConceptFilters(concept.id);
      let targetObjects: ServiceObject[] = [];
      if (concept.targetClusterId) {
        targetObjects = await storage.getClusterObjects(concept.targetClusterId);
      } else {
        targetObjects = await storage.getObjects(tenantId);
      }

      const matchingObjects = targetObjects.filter(obj => {
        return filters.every(filter => {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
          const filterValue = filter.filterValue;
          switch (filter.operator) {
            case "equals": return metadataValue === filterValue;
            case "not_equals": return metadataValue !== filterValue;
            case "exists": return metadataValue !== undefined && metadataValue !== null;
            default: return true;
          }
        });
      });

      const existingAssignments = await storage.getAssignments(tenantId, {});
      const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
      const assignedObjectIds = new Set(conceptAssignments.map(a => a.objectId));

      const createdChanges = [];

      for (const obj of matchingObjects) {
        if (!assignedObjectIds.has(obj.id)) {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          let units = 1;
          if (concept.subscriptionMetadataField && objWithMeta.metadata?.[concept.subscriptionMetadataField]) {
            units = Number(objWithMeta.metadata[concept.subscriptionMetadataField]) || 1;
          }
          const monthlyDelta = (concept.monthlyFee || 0) * units;
          const change = await storage.createSubscriptionChange({
            tenantId,
            orderConceptId: concept.id,
            objectId: obj.id,
            changeType: "new_object",
            previousValue: "0",
            newValue: String(units),
            monthlyDelta,
            approvalStatus: "pending",
          });
          createdChanges.push(change);
        }
      }

      for (const objectId of assignedObjectIds) {
        if (!matchingObjects.find(o => o.id === objectId)) {
          const assignment = conceptAssignments.find(a => a.objectId === objectId);
          const monthlyDelta = -(concept.monthlyFee || 0) * (assignment?.quantity || 1);
          const change = await storage.createSubscriptionChange({
            tenantId,
            orderConceptId: concept.id,
            objectId,
            changeType: "removed_object",
            previousValue: String(assignment?.quantity || 1),
            newValue: "0",
            monthlyDelta,
            approvalStatus: "pending",
          });
          createdChanges.push(change);
        }
      }

      res.json({
        changesDetected: createdChanges.length,
        changes: createdChanges,
      });
    } catch (error) {
      console.error("Failed to detect changes:", error);
      res.status(500).json({ error: "Kunde inte detektera ändringar" });
    }
  });

  // ============================================
  // TASK DEPENDENCY TEMPLATES API
  // ============================================

  app.get("/api/task-dependency-templates", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { articleId } = req.query;
      const templates = await storage.getTaskDependencyTemplates(tenantId, articleId as string | undefined);
      res.json(templates);
    } catch (error) {
      console.error("Failed to get task dependency templates:", error);
      res.status(500).json({ error: "Kunde inte hämta beroendemallar" });
    }
  });

  app.get("/api/task-dependency-templates/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const template = await storage.getTaskDependencyTemplate(req.params.id);
      if (!template || template.tenantId !== tenantId) {
        return res.status(404).json({ error: "Beroendemall hittades inte" });
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta beroendemall" });
    }
  });

  app.post("/api/task-dependency-templates", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const template = await storage.createTaskDependencyTemplate({ ...req.body, tenantId });
      res.status(201).json(template);
    } catch (error) {
      console.error("Failed to create task dependency template:", error);
      res.status(500).json({ error: "Kunde inte skapa beroendemall" });
    }
  });

  app.put("/api/task-dependency-templates/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const updated = await storage.updateTaskDependencyTemplate(req.params.id, tenantId, req.body);
      if (!updated) return res.status(404).json({ error: "Beroendemall hittades inte" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte uppdatera beroendemall" });
    }
  });

  app.delete("/api/task-dependency-templates/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteTaskDependencyTemplate(req.params.id, tenantId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Kunde inte ta bort beroendemall" });
    }
  });

  app.post("/api/work-orders/:id/generate-dependent-tasks", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || workOrder.tenantId !== tenantId) {
        return res.status(404).json({ error: "Arbetsorder hittades inte" });
      }

      const templates = await storage.getTaskDependencyTemplates(tenantId, workOrder.articleId || undefined);
      if (templates.length === 0) {
        return res.json({ created: 0, message: "Inga beroendemallar konfigurerade för denna artikel" });
      }

      const created = [];
      for (const template of templates) {
        const scheduledDate = workOrder.scheduledDate ? new Date(workOrder.scheduledDate) : new Date();
        const offsetMs = (template.timeOffsetHours || 0) * 60 * 60 * 1000;
        const childScheduled = new Date(scheduledDate.getTime() + offsetMs);

        const childWo = await storage.createWorkOrder({
          tenantId,
          articleId: template.dependentArticleId,
          objectId: workOrder.objectId,
          customerId: workOrder.customerId,
          scheduledDate: childScheduled,
          status: template.dependencyType === "before" ? "pending" : "locked",
          executionStatus: "not_started",
          priority: workOrder.priority,
          description: `Beroende uppgift (${template.dependencyType === "before" ? "före" : "efter"})`,
          creationMethod: "auto_dependency",
        });

        const instance = await storage.createTaskDependencyInstance({
          tenantId,
          parentWorkOrderId: workOrder.id,
          childWorkOrderId: childWo.id,
          dependencyType: template.dependencyType,
          scheduledAt: childScheduled,
          completed: false,
        });

        created.push({ workOrder: childWo, instance });
      }

      res.json({ created: created.length, tasks: created });
    } catch (error) {
      console.error("Failed to generate dependent tasks:", error);
      res.status(500).json({ error: "Kunde inte generera beroende uppgifter" });
    }
  });

  app.get("/api/task-dependency-instances", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { parentWorkOrderId } = req.query;
      const instances = await storage.getTaskDependencyInstances(tenantId, parentWorkOrderId as string | undefined);
      res.json(instances);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta beroendeinstanser" });
    }
  });

  // ============================================
  // INVOICE RULES API
  // ============================================

  app.get("/api/invoice-rules", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { orderConceptId } = req.query;
      const rules = await storage.getInvoiceRules(tenantId, orderConceptId as string | undefined);
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta faktureringsregler" });
    }
  });

  app.post("/api/invoice-rules", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const rule = await storage.createInvoiceRule({ ...req.body, tenantId });
      res.status(201).json(rule);
    } catch (error) {
      console.error("Failed to create invoice rule:", error);
      res.status(500).json({ error: "Kunde inte skapa faktureringsregel" });
    }
  });

  app.put("/api/invoice-rules/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const updated = await storage.updateInvoiceRule(req.params.id, tenantId, req.body);
      if (!updated) return res.status(404).json({ error: "Faktureringsregel hittades inte" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte uppdatera faktureringsregel" });
    }
  });

  app.delete("/api/invoice-rules/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      await storage.deleteInvoiceRule(req.params.id, tenantId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Kunde inte ta bort faktureringsregel" });
    }
  });

  // ============================================
  // INVOICE PREVIEW/GENERATION
  // ============================================
  
  app.get("/api/invoice-preview", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { orderConceptId, customerId, fromDate, toDate } = req.query;
      
      const allOrders = await storage.getWorkOrders(tenantId);
      const completedOrders = allOrders.filter(wo => {
        const isCompleted = wo.status === "completed" || wo.executionStatus === "completed";
        if (!isCompleted) return false;
        
        if (customerId && wo.customerId !== customerId) return false;
        
        if (fromDate) {
          const from = new Date(fromDate as string);
          const woDate = wo.completedAt ? new Date(wo.completedAt) : wo.scheduledDate ? new Date(wo.scheduledDate) : null;
          if (woDate && woDate < from) return false;
        }
        if (toDate) {
          const to = new Date(toDate as string);
          const woDate = wo.completedAt ? new Date(wo.completedAt) : wo.scheduledDate ? new Date(wo.scheduledDate) : null;
          if (woDate && woDate > to) return false;
        }
        
        return true;
      });
      
      // Get invoice rules
      const rules = await storage.getInvoiceRules(tenantId, orderConceptId as string | undefined);
      
      // Group orders by invoice stop-level (or customer as fallback)
      const ordersByInvoiceTarget: Record<string, { customerId: string; stopObjectName: string | null; invoiceReference: string | null; orders: typeof completedOrders }> = {};
      for (const order of completedOrders) {
        let targetKey = order.customerId || 'unknown';
        let stopObjectName: string | null = null;
        let invoiceReference: string | null = null;
        
        if (order.objectId) {
          const stopLevel = await storage.findInvoiceStopLevel(order.objectId, tenantId);
          if (stopLevel) {
            targetKey = stopLevel.customerId;
            stopObjectName = stopLevel.objectName;
            invoiceReference = stopLevel.invoiceReference;
          }
        }
        
        if (!ordersByInvoiceTarget[targetKey]) {
          ordersByInvoiceTarget[targetKey] = { customerId: targetKey, stopObjectName, invoiceReference, orders: [] };
        }
        ordersByInvoiceTarget[targetKey].orders.push(order);
      }
      
      const ordersByCustomer: Record<string, typeof completedOrders> = {};
      const invoiceStopInfo: Record<string, { stopObjectName: string | null; invoiceReference: string | null }> = {};
      for (const [key, target] of Object.entries(ordersByInvoiceTarget)) {
        ordersByCustomer[target.customerId] = [...(ordersByCustomer[target.customerId] || []), ...target.orders];
        if (!invoiceStopInfo[target.customerId] && target.stopObjectName) {
          invoiceStopInfo[target.customerId] = { stopObjectName: target.stopObjectName, invoiceReference: target.invoiceReference };
        }
      }
      
      // Get all customers for name lookup
      const customers = await storage.getCustomers(tenantId);
      const customerMap = new Map(customers.map(c => [c.id, c]));
      
      // Generate invoice previews
      const invoicePreviews = [];
      
      for (const [cid, orders] of Object.entries(ordersByCustomer)) {
        const customer = customerMap.get(cid);
        const rule = rules.find(r => r.customerId === cid) || rules[0];
        const invoiceType = rule?.invoiceType || 'per_task';
        const metadataOnHeader = (rule?.metadataOnHeader as string[]) || [];
        const metadataOnLine = (rule?.metadataOnLine as string[]) || [];
        
        const lines = [];
        
        if (invoiceType === 'per_task') {
          for (const order of orders) {
            const orderMeta = (order.metadata as Record<string, unknown>) || {};
            const lineMetadata: Record<string, string> = {};
            for (const key of metadataOnLine) {
              if (orderMeta[key]) lineMetadata[key] = String(orderMeta[key]);
            }
            
            lines.push({
              workOrderId: order.id,
              description: order.title,
              objectName: order.objectName,
              objectAddress: order.objectAddress,
              quantity: 1,
              unitPrice: order.estimatedCost || 0,
              total: order.estimatedCost || 0,
              completedAt: order.completedAt,
              metadata: lineMetadata,
            });
          }
        } else if (invoiceType === 'per_room' || invoiceType === 'per_area') {
          // Group by object
          const byObject: Record<string, typeof orders> = {};
          for (const order of orders) {
            const oid = order.objectId || 'unknown';
            if (!byObject[oid]) byObject[oid] = [];
            byObject[oid].push(order);
          }
          
          for (const [oid, objOrders] of Object.entries(byObject)) {
            const firstOrder = objOrders[0];
            const totalCost = objOrders.reduce((sum, o) => sum + (o.estimatedCost || 0), 0);
            
            lines.push({
              workOrderId: objOrders.map(o => o.id).join(','),
              description: `${invoiceType === 'per_room' ? 'Rum' : 'Område'}: ${firstOrder.objectName}`,
              objectName: firstOrder.objectName,
              objectAddress: firstOrder.objectAddress,
              quantity: objOrders.length,
              unitPrice: totalCost / objOrders.length,
              total: totalCost,
              completedAt: objOrders[objOrders.length - 1].completedAt,
              metadata: {},
            });
          }
        } else if (invoiceType === 'monthly') {
          // Monthly flat fee
          lines.push({
            workOrderId: orders.map(o => o.id).join(','),
            description: 'Månadsavgift',
            objectName: null,
            objectAddress: null,
            quantity: 1,
            unitPrice: 0,
            total: 0,
            completedAt: null,
            metadata: {},
          });
        }
        
        const totalExVat = lines.reduce((sum, l) => sum + l.total, 0);
        const vat = totalExVat * 0.25;
        
        // Build header metadata
        const headerMetadata: Record<string, string> = {};
        // Try to get header metadata from the customer or first order
        for (const key of metadataOnHeader) {
          const customerData = customer as Record<string, unknown> | undefined;
          if (customerData && customerData[key]) {
            headerMetadata[key] = String(customerData[key]);
          }
        }
        
        const stopInfo = invoiceStopInfo[cid];
        invoicePreviews.push({
          customerId: cid,
          customerName: customer?.name || 'Okänd kund',
          invoiceStopObject: stopInfo?.stopObjectName || null,
          invoiceReference: stopInfo?.invoiceReference || null,
          invoiceType,
          headerMetadata,
          lines,
          summary: {
            totalExVat: Math.round(totalExVat * 100) / 100,
            vat: Math.round(vat * 100) / 100,
            totalInclVat: Math.round((totalExVat + vat) * 100) / 100,
            orderCount: orders.length,
          },
          waitForAll: rule?.waitForAll || false,
        });
      }
      
      res.json(invoicePreviews);
    } catch (error) {
      console.error("Failed to generate invoice preview:", error);
      res.status(500).json({ error: "Kunde inte generera fakturaförhandsgranskning" });
    }
  });

  // ============================================
  // ORDER CONCEPT RERUN & RUN LOGS API
  // ============================================

  app.get("/api/order-concept-run-logs", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { orderConceptId } = req.query;
      const logs = await storage.getOrderConceptRunLogs(tenantId, orderConceptId as string | undefined);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta omkörningsloggar" });
    }
  });

  app.post("/api/order-concepts/:id/rerun", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const userId = req.session?.user?.id;
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept) return res.status(404).json({ error: "Orderkoncept hittades inte" });

      let tasksCreated = 0;
      let tasksSkipped = 0;
      let changesDetected = 0;
      const details: any[] = [];

      const filters = await storage.getConceptFilters(concept.id);
      let targetObjects: ServiceObject[] = [];
      if (concept.targetClusterId) {
        targetObjects = await storage.getClusterObjects(concept.targetClusterId);
      } else {
        targetObjects = await storage.getObjects(tenantId);
      }

      const matchingObjects = targetObjects.filter(obj => {
        if (filters.length === 0) return true;
        return filters.every(filter => {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
          const filterValue = filter.filterValue;
          switch (filter.operator) {
            case "equals": return metadataValue === filterValue;
            case "not_equals": return metadataValue !== filterValue;
            case "exists": return metadataValue !== undefined && metadataValue !== null;
            default: return true;
          }
        });
      });

      const existingAssignments = await storage.getAssignments(tenantId, {});
      const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
      const assignedObjectIds = new Set(conceptAssignments.map(a => a.objectId));

      for (const obj of matchingObjects) {
        if (!assignedObjectIds.has(obj.id)) {
          changesDetected++;
          details.push({ type: "new_object", objectId: obj.id, objectName: obj.name || obj.id });
        }
      }

      for (const objectId of assignedObjectIds) {
        if (!matchingObjects.find(o => o.id === objectId)) {
          changesDetected++;
          details.push({ type: "removed_object", objectId });
        }
      }

      if (concept.subscriptionMetadataField) {
        for (const obj of matchingObjects) {
          if (assignedObjectIds.has(obj.id)) {
            const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
            const currentUnits = Number(objWithMeta.metadata?.[concept.subscriptionMetadataField] || 0);
            const assignment = conceptAssignments.find(a => a.objectId === obj.id);
            const previousUnits = assignment?.quantity || 0;
            if (currentUnits !== previousUnits) {
              changesDetected++;
              details.push({ 
                type: "quantity_changed", 
                objectId: obj.id, 
                objectName: obj.name || obj.id,
                previousValue: previousUnits, 
                newValue: currentUnits 
              });
            }
          }
        }
      }

      if (concept.scenario === "schema" && concept.deliverySchedule) {
        const schedule = concept.deliverySchedule as any[];
        const now = new Date();
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + (concept.rollingMonths || 3));

        for (const entry of schedule) {
          const targetMonth = entry.month;
          for (let year = now.getFullYear(); year <= futureDate.getFullYear(); year++) {
            const entryDate = new Date(year, targetMonth - 1, 1);
            if (entryDate >= now && entryDate <= futureDate) {
              const existingForMonth = conceptAssignments.find(a => {
                if (!a.scheduledDate) return false;
                const d = new Date(a.scheduledDate);
                return d.getMonth() + 1 === targetMonth && d.getFullYear() === year;
              });
              if (!existingForMonth) {
                tasksCreated++;
                details.push({ type: "new_schedule_entry", month: targetMonth, year });
              } else {
                tasksSkipped++;
              }
            }
          }
        }
      }

      const log = await storage.createOrderConceptRunLog({
        tenantId,
        orderConceptId: concept.id,
        runType: "rerun",
        status: "completed",
        tasksCreated,
        tasksSkipped,
        changesDetected,
        details,
        runBy: userId,
      });

      await storage.updateOrderConcept(concept.id, tenantId, { lastRunDate: new Date() });

      res.json({
        log,
        summary: {
          tasksCreated,
          tasksSkipped,
          changesDetected,
          details,
        },
      });
    } catch (error) {
      console.error("Failed to rerun order concept:", error);
      res.status(500).json({ error: "Kunde inte köra om orderkonceptet" });
    }
  });

  app.post("/api/order-concepts/:id/validate-min-days", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const rawConcept = await storage.getOrderConcept(req.params.id);
      const concept = verifyTenantOwnership(rawConcept, tenantId);
      if (!concept) return res.status(404).json({ error: "Orderkoncept hittades inte" });

      const minDays = concept.minDaysBetween || 60;
      const { proposedDate } = req.body;
      if (!proposedDate) return res.status(400).json({ error: "proposedDate krävs" });

      const existingAssignments = await storage.getAssignments(tenantId, {});
      const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
      const proposedDateObj = new Date(proposedDate);

      let valid = true;
      let conflictingTask = null;

      for (const assignment of conceptAssignments) {
        if (!assignment.scheduledDate) continue;
        const assignDate = new Date(assignment.scheduledDate);
        const diffMs = Math.abs(proposedDateObj.getTime() - assignDate.getTime());
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays < minDays) {
          valid = false;
          conflictingTask = {
            id: assignment.id,
            scheduledDate: assignment.scheduledDate,
            daysDiff: Math.round(diffDays),
          };
          break;
        }
      }

      res.json({ valid, minDays, conflictingTask });
    } catch (error) {
      res.status(500).json({ error: "Kunde inte validera min dagar mellan" });
    }
  });

  // ============================================
  // SCHEDULE API (Week Planning)
  // ============================================

  app.get("/api/schedule", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate och endDate krävs" });
      }

      const start = new Date(startDate as string);
      const end = new Date(endDate as string);

      // Get all resources
      const resources = await storage.getResources(tenantId);
      const activeResources = resources.filter(r => r.status === "active");

      // Get all assignments in date range
      const assignments = await storage.getAssignments(tenantId, {
        startDate: start,
        endDate: end
      });

      // Build schedule data per resource per day
      const schedule = await Promise.all(activeResources.map(async (resource) => {
        // Get availability entries for this resource
        const availabilityEntries = await storage.getResourceAvailability(resource.id);

        // Group assignments by date
        const resourceAssignments = assignments.filter(a => a.resourceId === resource.id);
        const assignmentsByDate: Record<string, typeof assignments> = {};
        
        resourceAssignments.forEach(a => {
          if (a.scheduledDate) {
            const dateKey = new Date(a.scheduledDate).toISOString().split("T")[0];
            if (!assignmentsByDate[dateKey]) assignmentsByDate[dateKey] = [];
            assignmentsByDate[dateKey].push(a);
          }
        });

        // Build daily data
        const days: Array<{
          date: string;
          available: boolean;
          availabilityType?: string;
          assignments: typeof assignments;
          totalTime: number;
          totalValue: number;
        }> = [];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split("T")[0];
          
          // Check availability
          let available = true;
          let availabilityType = "available";
          
          // Check resource.availability JSON field
          if (resource.availability) {
            const dayAvail = (resource.availability as Record<string, string>)[dateStr];
            if (dayAvail && dayAvail !== "available") {
              available = false;
              availabilityType = dayAvail;
            }
          }

          // Check resource_availability table
          const blockingEntry = availabilityEntries.find(entry => {
            if (entry.date) {
              const entryDate = new Date(entry.date).toISOString().split("T")[0];
              return entryDate === dateStr && !entry.isAvailable;
            }
            return false;
          });
          if (blockingEntry) {
            available = false;
            availabilityType = blockingEntry.availabilityType || "blocked";
          }

          const dayAssignments = assignmentsByDate[dateStr] || [];
          const totalTime = dayAssignments.reduce((sum, a) => sum + (a.estimatedDuration || 60), 0);
          const totalValue = dayAssignments.reduce((sum, a) => sum + (a.cachedValue || 0), 0);

          days.push({
            date: dateStr,
            available,
            availabilityType,
            assignments: dayAssignments,
            totalTime,
            totalValue
          });
        }

        return {
          resource,
          days
        };
      }));

      // Also return unassigned assignments in the date range
      const unassignedAssignments = assignments.filter(a => !a.resourceId);

      res.json({
        schedule,
        unassignedAssignments,
        dateRange: { start: start.toISOString(), end: end.toISOString() }
      });
    } catch (error) {
      console.error("Failed to get schedule:", error);
      res.status(500).json({ error: "Kunde inte hämta schema" });
    }
  });

  // ============================================
  // ASSIGNMENTS API
  // ============================================
  
  app.get("/api/assignments", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { status, resourceId, clusterId, startDate, endDate } = req.query;
      
      const assignments = await storage.getAssignments(tenantId, {
        status: status as string | undefined,
        resourceId: resourceId as string | undefined,
        clusterId: clusterId as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      });
      res.json(assignments);
    } catch (error) {
      console.error("Failed to get assignments:", error);
      res.status(500).json({ error: "Kunde inte hämta uppgifter" });
    }
  });

  app.get("/api/assignments/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const assignment = await storage.getAssignment(req.params.id);
      if (!verifyTenantOwnership(assignment, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const articles = await storage.getAssignmentArticles(assignment!.id);
      res.json({ ...assignment, articles });
    } catch (error) {
      console.error("Failed to get assignment:", error);
      res.status(500).json({ error: "Kunde inte hämta uppgift" });
    }
  });

  app.post("/api/assignments", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const userId = req.session?.user?.id;
      
      const assignment = await storage.createAssignment({
        ...req.body,
        tenantId,
        createdBy: userId,
        creationMethod: req.body.creationMethod || "manual"
      });
      res.status(201).json(assignment);
    } catch (error) {
      console.error("Failed to create assignment:", error);
      res.status(500).json({ error: "Kunde inte skapa uppgift" });
    }
  });

  app.patch("/api/assignments/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getAssignment(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const assignment = await storage.updateAssignment(req.params.id, tenantId, req.body);
      res.json(assignment);
    } catch (error) {
      console.error("Failed to update assignment:", error);
      res.status(500).json({ error: "Kunde inte uppdatera uppgift" });
    }
  });

  app.delete("/api/assignments/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const existing = await storage.getAssignment(req.params.id);
      if (!verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      await storage.deleteAssignment(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete assignment:", error);
      res.status(500).json({ error: "Kunde inte radera uppgift" });
    }
  });

  // Get candidate resources for an assignment
  app.get("/api/assignments/:id/candidates", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const assignment = await storage.getAssignment(req.params.id);
      if (!verifyTenantOwnership(assignment, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }

      // Get all active resources for the tenant
      const allResources = await storage.getResources(tenantId);
      const activeResources = allResources.filter(r => r.status === "active");

      // Get the scheduled date from assignment or query param
      const targetDate = req.query.date 
        ? new Date(req.query.date as string)
        : assignment!.scheduledDate;
      const dateStr = targetDate ? targetDate.toISOString().split("T")[0] : null;

      // Score each resource
      const candidates = await Promise.all(activeResources.map(async (resource) => {
        let score = 50; // Base score
        let available = true;
        let reasons: string[] = [];

        // Check availability from resource's availability field (JSON)
        if (dateStr && resource.availability) {
          const dayAvailability = (resource.availability as Record<string, string>)[dateStr];
          if (dayAvailability && dayAvailability !== "available") {
            available = false;
            reasons.push(`Ej tillgänglig: ${dayAvailability}`);
            score -= 100;
          }
        }

        // Check resource_availability table entries
        if (dateStr) {
          const availabilityEntries = await storage.getResourceAvailability(resource.id);
          const dateConflict = availabilityEntries.find(entry => {
            if (entry.date) {
              const entryDate = new Date(entry.date).toISOString().split("T")[0];
              return entryDate === dateStr && !entry.isAvailable;
            }
            return false;
          });
          if (dateConflict) {
            available = false;
            reasons.push(`Blockerad: ${dateConflict.notes || dateConflict.availabilityType}`);
            score -= 100;
          }
        }

        // Check existing assignments for the date (workload)
        if (dateStr) {
          const resourceAssignments = await storage.getAssignments(tenantId, {
            resourceId: resource.id,
            startDate: new Date(dateStr),
            endDate: new Date(dateStr)
          });
          const workload = resourceAssignments.length;
          if (workload > 0) {
            reasons.push(`${workload} uppgifter redan planerade`);
            score -= workload * 5; // Reduce score per existing assignment
          }
          if (workload >= 10) {
            available = false;
            reasons.push("Fullbokat");
            score -= 50;
          }
        }

        // Bonus for matching cluster/area
        if (assignment!.clusterId && resource.serviceArea) {
          // Simple check if service area matches cluster
          score += 10;
        }

        return {
          resource,
          score: Math.max(0, score),
          available,
          reasons
        };
      }));

      // Sort by score (highest first), then by availability
      candidates.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return b.score - a.score;
      });

      res.json(candidates);
    } catch (error) {
      console.error("Failed to get candidate resources:", error);
      res.status(500).json({ error: "Kunde inte hämta kandidatresurser" });
    }
  });

  // Assign resource to assignment
  app.post("/api/assignments/:id/assign", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const assignment = await storage.getAssignment(req.params.id);
      if (!verifyTenantOwnership(assignment, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }

      const { resourceId, scheduledDate, scheduledStartTime, scheduledEndTime } = req.body;
      
      if (!resourceId) {
        return res.status(400).json({ error: "ResourceId krävs" });
      }

      // Verify resource exists and belongs to tenant
      const resource = await storage.getResource(resourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resurs hittades inte" });
      }

      // Update assignment with resource and scheduling info
      const updatedAssignment = await storage.updateAssignment(req.params.id, tenantId, {
        resourceId,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : assignment!.scheduledDate,
        scheduledStartTime: scheduledStartTime || undefined,
        scheduledEndTime: scheduledEndTime || undefined,
        status: scheduledDate ? "planned_fine" : "planned_rough"
      });

      res.json(updatedAssignment);
    } catch (error) {
      console.error("Failed to assign resource:", error);
      res.status(500).json({ error: "Kunde inte tilldela resurs" });
    }
  });

  // Assignment Articles
  app.get("/api/assignments/:assignmentId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const assignment = await storage.getAssignment(req.params.assignmentId);
      if (!verifyTenantOwnership(assignment, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const articles = await storage.getAssignmentArticles(req.params.assignmentId);
      res.json(articles);
    } catch (error) {
      console.error("Failed to get assignment articles:", error);
      res.status(500).json({ error: "Kunde inte hämta artiklar" });
    }
  });

  app.post("/api/assignments/:assignmentId/articles", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const assignment = await storage.getAssignment(req.params.assignmentId);
      if (!verifyTenantOwnership(assignment, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const article = await storage.createAssignmentArticle({
        ...req.body,
        assignmentId: req.params.assignmentId
      });
      res.status(201).json(article);
    } catch (error) {
      console.error("Failed to create assignment article:", error);
      res.status(500).json({ error: "Kunde inte lägga till artikel" });
    }
  });

  app.delete("/api/assignments/:assignmentId/articles/:articleId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const assignment = await storage.getAssignment(req.params.assignmentId);
      if (!verifyTenantOwnership(assignment, tenantId)) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      await storage.deleteAssignmentArticle(req.params.articleId, req.params.assignmentId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete assignment article:", error);
      res.status(500).json({ error: "Kunde inte radera artikel" });
    }
  });

  // ============================================
  // CUSTOMER NOTIFICATIONS - E-post notifieringar till kunder
  // ============================================
  
  app.post("/api/notifications/send", async (req, res) => {
    try {
      const { sendCustomerNotification } = await import("./customer-notifications");
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId, notificationType, estimatedArrivalMinutes, customMessage } = req.body;
      
      if (!workOrderId || !notificationType) {
        return res.status(400).json({ error: "workOrderId och notificationType krävs" });
      }
      
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Arbetsorder hittades inte" });
      }
      
      const results = await sendCustomerNotification(tenantId, {
        workOrderId,
        notificationType,
        estimatedArrivalMinutes,
        customMessage,
      });
      
      const successCount = results.filter(r => r.success).length;
      res.json({
        success: successCount > 0,
        sent: successCount,
        total: results.length,
        results,
        message: successCount > 0 
          ? `Notifiering skickad till ${successCount} mottagare`
          : "Kunde inte skicka notifiering",
      });
    } catch (error) {
      console.error("Failed to send notification:", error);
      res.status(500).json({ error: "Kunde inte skicka notifiering" });
    }
  });
  
  app.post("/api/notifications/technician-on-way/:workOrderId", async (req, res) => {
    try {
      const { notifyTechnicianOnWay } = await import("./customer-notifications");
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId } = req.params;
      const { estimatedMinutes } = req.body;
      
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Arbetsorder hittades inte" });
      }
      
      const results = await notifyTechnicianOnWay(tenantId, workOrderId, estimatedMinutes);
      const successCount = results.filter(r => r.success).length;
      
      res.json({
        success: successCount > 0,
        sent: successCount,
        results,
        message: successCount > 0 
          ? `Kunden notifierad om att tekniker är på väg`
          : "Kunde inte skicka notifiering",
      });
    } catch (error) {
      console.error("Failed to send technician-on-way notification:", error);
      res.status(500).json({ error: "Kunde inte skicka notifiering" });
    }
  });
  
  app.post("/api/notifications/job-completed/:workOrderId", async (req, res) => {
    try {
      const { notifyJobCompleted } = await import("./customer-notifications");
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId } = req.params;
      
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        return res.status(404).json({ error: "Arbetsorder hittades inte" });
      }
      
      const results = await notifyJobCompleted(tenantId, workOrderId);
      const successCount = results.filter(r => r.success).length;
      
      res.json({
        success: successCount > 0,
        sent: successCount,
        results,
      });
    } catch (error) {
      console.error("Failed to send job-completed notification:", error);
      res.status(500).json({ error: "Kunde inte skicka notifiering" });
    }
  });
  
  app.post("/api/notifications/send-schedule/:resourceId", async (req, res) => {
    try {
      const { sendScheduleToResource } = await import("./customer-notifications");
      const tenantId = getTenantIdWithFallback(req);
      const { resourceId } = req.params;
      const { jobs, dateRange, fieldAppUrl } = req.body;
      
      const resource = await storage.getResource(resourceId);
      if (!resource || !verifyTenantOwnership(resource, tenantId)) {
        return res.status(404).json({ error: "Resurs hittades inte" });
      }
      
      if (!resource.email) {
        return res.status(400).json({ error: "Resursen har ingen e-postadress registrerad" });
      }
      
      const result = await sendScheduleToResource(
        tenantId,
        resourceId,
        resource.name,
        resource.email,
        jobs,
        dateRange,
        fieldAppUrl
      );
      
      res.json(result);
    } catch (error) {
      console.error("Failed to send schedule to resource:", error);
      res.status(500).json({ error: "Kunde inte skicka schema till resurs" });
    }
  });

  // ============================================
  // CUSTOMER PORTAL - Self-Service Portal
  // Token-baserad autentisering för kunder
  // ============================================

  const portalRateLimits = new Map<string, { count: number; resetAt: number }>();
  const PORTAL_RATE_LIMIT = 5;
  const PORTAL_RATE_WINDOW = 15 * 60 * 1000;

  function checkPortalRateLimit(key: string): boolean {
    const now = Date.now();
    const limit = portalRateLimits.get(key);
    if (!limit || now > limit.resetAt) {
      portalRateLimits.set(key, { count: 1, resetAt: now + PORTAL_RATE_WINDOW });
      return true;
    }
    if (limit.count >= PORTAL_RATE_LIMIT) {
      return false;
    }
    limit.count++;
    return true;
  }

  // Portal auth middleware - validates session for all protected portal data endpoints
  interface PortalSession {
    valid: boolean;
    customerId?: string;
    customerName?: string;
    email?: string;
    tenantId?: string;
    tenantName?: string;
    sessionId?: string;
  }

  async function requirePortalAuth(req: ExpressRequest, res: ExpressResponse): Promise<PortalSession | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Autentisering krävs" });
      return null;
    }

    const sessionToken = authHeader.substring(7);
    const { validateSession } = await import("./portal-auth");
    const session = await validateSession(sessionToken);

    if (!session.valid || !session.customerId || !session.tenantId) {
      res.status(401).json({ error: "Ogiltig session" });
      return null;
    }

    return session as PortalSession;
  }

  app.get("/api/portal/tenants", async (req, res) => {
    try {
      const tenants = await storage.getPublicTenants();
      res.json(tenants.map(t => ({ id: t.id, name: t.name })));
    } catch (error) {
      console.error("Failed to get tenants:", error);
      res.status(500).json({ error: "Kunde inte hämta företag" });
    }
  });

  app.post("/api/portal/auth/request-link", async (req, res) => {
    try {
      const { email } = req.body;
      let { tenantId } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "E-postadress krävs" });
      }

      if (!tenantId) {
        const tenants = await storage.getPublicTenants();
        if (tenants.length === 1) {
          tenantId = tenants[0].id;
        } else if (tenants.length === 0) {
          return res.status(400).json({ error: "Ingen aktiv tenant hittades" });
        } else {
          return res.status(400).json({ error: "Välj ett företag" });
        }
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!checkPortalRateLimit(`${ip}:${email}`)) {
        return res.status(429).json({ error: "För många inloggningsförsök. Försök igen om 15 minuter." });
      }

      const { requestMagicLink, sendPortalMagicLinkEmail } = await import("./portal-auth");
      const result = await requestMagicLink(
        email,
        tenantId,
        ip,
        req.headers["user-agent"]
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      const tenant = await storage.getTenant(tenantId);
      const companyName = tenant?.name || "Unicorn";
      
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `https://${req.headers.host}`;
      const magicLinkUrl = `${baseUrl}/portal/verify?token=${result.token}`;

      const emailSent = await sendPortalMagicLinkEmail(
        email,
        magicLinkUrl,
        result.customer?.name || result.customer?.contactPerson || "Kund",
        companyName
      );

      if (!emailSent) {
        console.warn("Magic link email not sent - RESEND_API_KEY may be missing");
      }

      res.json({ 
        success: true, 
        message: "Inloggningslänk skickad till din e-post",
        emailSent,
      });
    } catch (error) {
      console.error("Failed to request magic link:", error);
      res.status(500).json({ error: "Kunde inte skicka inloggningslänk" });
    }
  });

  app.post("/api/portal/auth/verify", async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token krävs" });
      }

      const { verifyMagicLink } = await import("./portal-auth");
      const ip = req.ip || req.socket.remoteAddress;
      const result = await verifyMagicLink(token, ip, req.headers["user-agent"]);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        sessionToken: result.session?.token,
        customer: {
          id: result.session?.customer?.id,
          name: result.session?.customer?.name,
          email: result.session?.customer?.email,
        },
        tenant: {
          id: result.session?.tenant?.id,
          name: result.session?.tenant?.name,
        },
      });
    } catch (error) {
      console.error("Failed to verify magic link:", error);
      res.status(500).json({ error: "Kunde inte verifiera inloggning" });
    }
  });

  app.get("/api/portal/me", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Autentisering krävs" });
      }

      const sessionToken = authHeader.substring(7);
      const { validateSession } = await import("./portal-auth");
      const session = await validateSession(sessionToken);

      if (!session.valid) {
        return res.status(401).json({ error: "Ogiltig session" });
      }

      const tenant = await storage.getTenant(session.tenantId!);

      res.json({
        customer: {
          id: session.customer?.id,
          name: session.customer?.name,
          email: session.customer?.email,
          phone: session.customer?.phone,
        },
        tenant: {
          id: tenant?.id,
          name: tenant?.name,
        },
      });
    } catch (error) {
      console.error("Failed to get portal user:", error);
      res.status(500).json({ error: "Kunde inte hämta användarinfo" });
    }
  });

  app.get("/api/portal/orders", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const workOrders = await storage.getWorkOrdersByCustomer(session.customerId!, session.tenantId!);
      const objects = await storage.getObjects(session.tenantId!);
      const objectMap = new Map(objects.map(o => [o.id, o]));
      const resources = await storage.getResources(session.tenantId!);
      const resourceMap = new Map(resources.map(r => [r.id, r]));

      const enrichedOrders = workOrders.map(order => {
        const obj = order.objectId ? objectMap.get(order.objectId) : undefined;
        const resource = order.resourceId ? resourceMap.get(order.resourceId) : undefined;
        return {
          id: order.id,
          title: order.title,
          description: order.description,
          status: order.orderStatus || order.status,
          scheduledDate: order.scheduledDate,
          scheduledTime: order.scheduledStartTime,
          completedAt: order.completedAt,
          objectAddress: obj?.address,
          objectName: obj?.name,
          resourceName: resource?.name,
        };
      });

      const upcoming = enrichedOrders
        .filter(o => !["utford", "fakturerad", "completed", "invoiced"].includes(o.status))
        .sort((a, b) => {
          if (!a.scheduledDate) return 1;
          if (!b.scheduledDate) return -1;
          return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
        });

      const history = enrichedOrders
        .filter(o => ["utford", "fakturerad", "completed", "invoiced"].includes(o.status))
        .sort((a, b) => {
          if (!a.completedAt) return 1;
          if (!b.completedAt) return -1;
          return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
        })
        .slice(0, 20);

      res.json({ upcoming, history });
    } catch (error) {
      console.error("Failed to get portal orders:", error);
      res.status(500).json({ error: "Kunde inte hämta ordrar" });
    }
  });

  app.get("/api/portal/objects", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const objects = await storage.getObjectsByCustomer(session.customerId!);
      
      res.json(objects.map(o => ({
        id: o.id,
        name: o.name,
        address: o.address,
        city: o.city,
        objectType: o.objectType,
      })));
    } catch (error) {
      console.error("Failed to get portal objects:", error);
      res.status(500).json({ error: "Kunde inte hämta objekt" });
    }
  });

  // Portal cluster/objects hierarchy overview
  app.get("/api/portal/clusters", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      // Get all objects for this customer with hierarchy info
      const customerObjects = await storage.getObjectsByCustomer(session.customerId!);
      
      // Create a set of customer's object IDs for filtering
      const customerObjectIds = new Set(customerObjects.map(obj => obj.id));
      
      // Get upcoming work orders for these objects
      const now = new Date();
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + 3);
      const allWorkOrders = await storage.getWorkOrders(session.tenantId!, now, futureDate, false, 500);
      
      // Filter to only include work orders for this customer's objects
      const workOrders = allWorkOrders.filter((wo: any) => wo.objectId && customerObjectIds.has(wo.objectId));
      
      // Get completed work orders for history
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 6);
      const allHistoryOrders = await storage.getWorkOrders(session.tenantId!, pastDate, now, false, 500);
      
      // Filter to only include work orders for this customer's objects
      const historyOrders = allHistoryOrders.filter((wo: any) => wo.objectId && customerObjectIds.has(wo.objectId));
      
      // Create a map of object IDs to their work order info
      const objectVisitInfo: Record<string, { nextVisit?: Date; lastVisit?: Date }> = {};
      
      workOrders.forEach((wo: any) => {
        if (wo.objectId && wo.scheduledDate) {
          if (!objectVisitInfo[wo.objectId]) {
            objectVisitInfo[wo.objectId] = {};
          }
          const date = new Date(wo.scheduledDate);
          if (!objectVisitInfo[wo.objectId].nextVisit || date < objectVisitInfo[wo.objectId].nextVisit!) {
            objectVisitInfo[wo.objectId].nextVisit = date;
          }
        }
      });
      
      historyOrders.forEach((wo: any) => {
        if (wo.objectId && (wo.completedAt || wo.scheduledDate)) {
          if (!objectVisitInfo[wo.objectId]) {
            objectVisitInfo[wo.objectId] = {};
          }
          const date = new Date(wo.completedAt || wo.scheduledDate);
          if (!objectVisitInfo[wo.objectId].lastVisit || date > objectVisitInfo[wo.objectId].lastVisit!) {
            objectVisitInfo[wo.objectId].lastVisit = date;
          }
        }
      });

      // Build hierarchy tree
      const objectMap = new Map<string, any>();
      const rootObjects: any[] = [];

      // First pass: create all node objects with enriched data
      customerObjects.forEach(obj => {
        const visitInfo = objectVisitInfo[obj.id] || {};
        objectMap.set(obj.id, {
          id: obj.id,
          name: obj.name,
          objectType: obj.objectType,
          hierarchyLevel: obj.hierarchyLevel || "fastighet",
          address: obj.address,
          city: obj.city,
          postalCode: obj.postalCode,
          accessCode: obj.accessCode,
          keyNumber: obj.keyNumber,
          accessInfo: obj.accessInfo,
          latitude: obj.latitude,
          longitude: obj.longitude,
          parentId: obj.parentId,
          nextVisit: visitInfo.nextVisit?.toISOString() || null,
          lastVisit: visitInfo.lastVisit?.toISOString() || null,
          children: [],
        });
      });

      // Second pass: build parent-child relationships
      customerObjects.forEach(obj => {
        const node = objectMap.get(obj.id);
        if (obj.parentId && objectMap.has(obj.parentId)) {
          objectMap.get(obj.parentId).children.push(node);
        } else {
          rootObjects.push(node);
        }
      });

      // Sort children at each level by name
      const sortChildren = (nodes: any[]) => {
        nodes.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
        nodes.forEach(node => {
          if (node.children.length > 0) {
            sortChildren(node.children);
          }
        });
      };
      sortChildren(rootObjects);

      res.json({
        total: customerObjects.length,
        tree: rootObjects,
      });
    } catch (error) {
      console.error("Failed to get portal clusters:", error);
      res.status(500).json({ error: "Kunde inte hämta klusteröversikt" });
    }
  });

  // Predefined time slots for booking requests
  const VALID_TIME_SLOTS = ["morning", "afternoon", "all_day"] as const;
  const VALID_REQUEST_TYPES = ["new", "reschedule", "cancel", "extra_service"] as const;

  // Endpoint to get available time slots and request types for booking
  app.get("/api/portal/booking-options", async (req, res) => {
    res.json({
      timeSlots: [
        { value: "morning", label: "Förmiddag (08:00-12:00)" },
        { value: "afternoon", label: "Eftermiddag (12:00-17:00)" },
        { value: "all_day", label: "Heldag (08:00-17:00)" },
      ],
      requestTypes: [
        { value: "new", label: "Ny bokning" },
        { value: "reschedule", label: "Ombokning" },
        { value: "cancel", label: "Avbokning" },
        { value: "extra_service", label: "Tilläggstjänst" },
      ],
    });
  });

  // Flexible date validation that accepts ISO date strings (YYYY-MM-DD) or datetime strings
  const flexibleDateSchema = z.string().refine(
    (val) => !val || /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(val),
    { message: "Ogiltigt datumformat" }
  ).optional().nullable();

  // Zod schema for booking request validation
  const portalBookingRequestSchema = z.object({
    objectId: z.string().uuid().optional().nullable(),
    workOrderId: z.string().uuid().optional().nullable(),
    requestType: z.enum(VALID_REQUEST_TYPES, {
      errorMap: () => ({ message: "Ogiltig typ av förfrågan. Välj: ny bokning, ombokning, avbokning eller tilläggstjänst." })
    }),
    preferredDate1: flexibleDateSchema,
    preferredDate2: flexibleDateSchema,
    preferredTimeSlot: z.enum(VALID_TIME_SLOTS, {
      errorMap: () => ({ message: "Ogiltig tidslucka. Välj: förmiddag, eftermiddag eller heldag." })
    }).optional().nullable(),
    customerNotes: z.string().max(2000, "Meddelande får max vara 2000 tecken").optional().nullable(),
  });

  app.post("/api/portal/booking-requests", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const parseResult = portalBookingRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map(e => e.message).join(", ");
        return res.status(400).json({ error: errorMessage });
      }

      const { objectId, workOrderId, requestType, preferredDate1, preferredDate2, preferredTimeSlot, customerNotes } = parseResult.data;

      const bookingRequest = await storage.createBookingRequest({
        tenantId: session.tenantId!,
        customerId: session.customerId!,
        objectId: objectId || null,
        workOrderId: workOrderId || null,
        requestType,
        status: "pending",
        preferredDate1: preferredDate1 ? new Date(preferredDate1) : null,
        preferredDate2: preferredDate2 ? new Date(preferredDate2) : null,
        preferredTimeSlot: preferredTimeSlot || null,
        customerNotes: customerNotes || null,
        staffNotes: null,
        handledBy: null,
        handledAt: null,
      });

      res.json({ success: true, bookingRequest });
    } catch (error) {
      console.error("Failed to create booking request:", error);
      res.status(500).json({ error: "Kunde inte skapa bokningsförfrågan" });
    }
  });

  app.get("/api/portal/booking-requests", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const requests = await storage.getBookingRequests(session.tenantId!, session.customerId!);
      res.json(requests);
    } catch (error) {
      console.error("Failed to get booking requests:", error);
      res.status(500).json({ error: "Kunde inte hämta bokningsförfrågningar" });
    }
  });

  // Portal Messages - Get all messages
  app.get("/api/portal/messages", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const messages = await storage.getLegacyPortalMessages(session.tenantId!, session.customerId!);
      await storage.markLegacyPortalMessagesAsRead(session.tenantId!, session.customerId!);
      res.json(messages);
    } catch (error) {
      console.error("Failed to get portal messages:", error);
      res.status(500).json({ error: "Kunde inte hämta meddelanden" });
    }
  });

  // Portal Messages - Send a message
  app.post("/api/portal/messages", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const { message } = req.body;
      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ error: "Meddelande krävs" });
      }

      const newMessage = await storage.createLegacyPortalMessage({
        tenantId: session.tenantId!,
        customerId: session.customerId!,
        sender: "customer",
        message: message.trim()
      });

      res.json(newMessage);
    } catch (error) {
      console.error("Failed to send portal message:", error);
      res.status(500).json({ error: "Kunde inte skicka meddelande" });
    }
  });

  // Portal Messages - Get unread count
  app.get("/api/portal/messages/unread-count", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const count = await storage.getLegacyUnreadMessageCount(session.tenantId!, session.customerId!);
      res.json({ count });
    } catch (error) {
      console.error("Failed to get unread count:", error);
      res.status(500).json({ error: "Kunde inte hämta antal olästa" });
    }
  });

  // ============================================
  // PORTAL - INVOICES (Fakturor)
  // ============================================
  app.get("/api/portal/invoices", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const invoices = await storage.getCustomerInvoices(session.tenantId!, session.customerId!);
      res.json(invoices);
    } catch (error) {
      console.error("Failed to get portal invoices:", error);
      res.status(500).json({ error: "Kunde inte hämta fakturor" });
    }
  });

  // ============================================
  // PORTAL - ISSUE REPORTS (Felanmälningar)
  // ============================================
  app.get("/api/portal/issue-reports", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const reports = await storage.getCustomerIssueReports(session.tenantId!, session.customerId!);
      res.json(reports);
    } catch (error) {
      console.error("Failed to get issue reports:", error);
      res.status(500).json({ error: "Kunde inte hämta felanmälningar" });
    }
  });

  app.post("/api/portal/issue-reports", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const { issueType, title, description, objectId, customerContact } = req.body;
      
      if (!issueType || !title) {
        return res.status(400).json({ error: "Typ och rubrik krävs" });
      }

      const report = await storage.createCustomerIssueReport({
        tenantId: session.tenantId!,
        customerId: session.customerId!,
        issueType,
        title,
        description: description || null,
        objectId: objectId || null,
        customerContact: customerContact || null,
      });

      res.json(report);
    } catch (error) {
      console.error("Failed to create issue report:", error);
      res.status(500).json({ error: "Kunde inte skapa felanmälan" });
    }
  });

  // ============================================
  // PORTAL - SERVICE CONTRACTS (Tjänsteavtal)
  // ============================================
  app.get("/api/portal/service-contracts", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const contracts = await storage.getCustomerServiceContracts(session.tenantId!, session.customerId!);
      res.json(contracts);
    } catch (error) {
      console.error("Failed to get service contracts:", error);
      res.status(500).json({ error: "Kunde inte hämta tjänsteavtal" });
    }
  });

  // ============================================
  // PORTAL - NOTIFICATION SETTINGS (Profil)
  // ============================================
  app.get("/api/portal/notification-settings", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      let settings = await storage.getCustomerNotificationSettings(session.tenantId!, session.customerId!);
      
      if (!settings) {
        const customer = await storage.getCustomer(session.customerId!);
        settings = {
          id: "",
          tenantId: session.tenantId!,
          customerId: session.customerId!,
          emailNotifications: true,
          smsNotifications: false,
          notifyOnTechnicianOnWay: true,
          notifyOnJobCompleted: true,
          notifyOnInvoice: true,
          notifyOnBookingConfirmation: true,
          preferredContactEmail: customer?.email || null,
          preferredContactPhone: customer?.phone || null,
          updatedAt: new Date(),
        };
      }

      res.json(settings);
    } catch (error) {
      console.error("Failed to get notification settings:", error);
      res.status(500).json({ error: "Kunde inte hämta inställningar" });
    }
  });

  app.put("/api/portal/notification-settings", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const updates = req.body;
      const settings = await storage.upsertCustomerNotificationSettings({
        tenantId: session.tenantId!,
        customerId: session.customerId!,
        ...updates,
      });

      res.json(settings);
    } catch (error) {
      console.error("Failed to update notification settings:", error);
      res.status(500).json({ error: "Kunde inte spara inställningar" });
    }
  });

  // ============================================
  // PORTAL - VISIT PROTOCOLS (Besöksprotokoll)
  // ============================================
  app.get("/api/portal/visit-protocols", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;

      const workOrders = await storage.getWorkOrders(session.tenantId!);
      const customerOrders = workOrders.filter(
        o => o.customerId === session.customerId && 
        ["utford", "fakturerad", "completed", "invoiced"].includes(o.orderStatus || o.status)
      );

      const protocols = customerOrders
        .filter(o => o.completedAt)
        .map(o => ({
          id: o.id,
          workOrderId: o.id,
          title: o.title,
          description: o.description,
          completedAt: o.completedAt,
          objectName: o.objectName,
          objectAddress: o.objectAddress,
          status: o.orderStatus || o.status,
        }))
        .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
        .slice(0, 50);

      res.json(protocols);
    } catch (error) {
      console.error("Failed to get visit protocols:", error);
      res.status(500).json({ error: "Kunde inte hämta protokoll" });
    }
  });

  app.post("/api/portal/auth/demo-login", async (req, res) => {
    try {
      const demoEmail = "demo@unicorn.se";
      const tenantId = "default-tenant";
      
      const customer = await storage.getCustomerByEmail(demoEmail, tenantId);
      if (!customer) {
        return res.status(404).json({ error: "Demokund finns inte. Skapa en kund med e-post demo@unicorn.se." });
      }

      const { generateSessionToken } = await import("./portal-auth");
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await storage.createPortalSession({
        tenantId,
        customerId: customer.id,
        sessionToken,
        expiresAt,
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      });

      const tenant = await storage.getTenant(tenantId);

      res.json({
        success: true,
        sessionToken,
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
        },
        tenant: {
          id: tenant?.id,
          name: tenant?.name,
        },
      });
    } catch (error) {
      console.error("Failed demo login:", error);
      res.status(500).json({ error: "Kunde inte skapa demosession" });
    }
  });

  app.post("/api/portal/logout", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const sessionToken = authHeader.substring(7);
        const { logout } = await import("./portal-auth");
        await logout(sessionToken);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to logout:", error);
      res.status(500).json({ error: "Kunde inte logga ut" });
    }
  });

  // ============================================
  // CUSTOMER PORTAL - Staff API (authenticated staff)
  // ============================================
  
  app.get("/api/portal/customer/:customerId/orders", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { customerId } = req.params;
      
      const rawCustomer = await storage.getCustomer(customerId);
      const customer = verifyTenantOwnership(rawCustomer, tenantId);
      if (!customer) {
        return res.status(404).json({ error: "Kund hittades inte" });
      }
      
      const workOrders = await storage.getWorkOrders(tenantId);
      const customerOrders = workOrders.filter(o => o.customerId === customerId);
      
      const objects = await storage.getObjects(tenantId);
      const objectMap = new Map(objects.map(o => [o.id, o]));
      const resources = await storage.getResources(tenantId);
      const resourceMap = new Map(resources.map(r => [r.id, r]));
      
      const enrichedOrders = customerOrders.map(order => {
        const obj = order.objectId ? objectMap.get(order.objectId) : undefined;
        const resource = order.resourceId ? resourceMap.get(order.resourceId) : undefined;
        return {
          id: order.id,
          title: order.title,
          description: order.description,
          status: order.orderStatus || order.status,
          scheduledDate: order.scheduledDate,
          scheduledTime: order.scheduledStartTime,
          completedAt: order.completedAt,
          objectAddress: obj?.address,
          objectName: obj?.name,
          resourceName: resource?.name,
        };
      });
      
      const upcoming = enrichedOrders
        .filter(o => !["utford", "fakturerad"].includes(o.status))
        .sort((a, b) => {
          if (!a.scheduledDate) return 1;
          if (!b.scheduledDate) return -1;
          return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
        });
        
      const history = enrichedOrders
        .filter(o => ["utford", "fakturerad"].includes(o.status))
        .sort((a, b) => {
          if (!a.completedAt) return 1;
          if (!b.completedAt) return -1;
          return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
        })
        .slice(0, 20);
      
      res.json({
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
        },
        upcoming,
        history,
      });
    } catch (error) {
      console.error("Failed to get portal orders:", error);
      res.status(500).json({ error: "Kunde inte hämta ordrar" });
    }
  });

  // ============================================
  // CUSTOMER PORTAL - Staff Messages API
  // ============================================

  // Get all customers with messages (for staff inbox)
  app.get("/api/staff/portal-messages", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const customerIds = await storage.getCustomersWithMessages(tenantId);
      const customers = await Promise.all(
        customerIds.map(id => storage.getCustomer(id))
      );
      
      const customerMessages = await Promise.all(
        customerIds.map(async (customerId) => {
          const messages = await storage.getLegacyPortalMessages(tenantId, customerId);
          const customer = customers.find(c => c?.id === customerId);
          const unreadCount = messages.filter(m => m.sender === "customer" && !m.readAt).length;
          const lastMessage = messages[messages.length - 1];
          return {
            customerId,
            customerName: customer?.name || "Okänd kund",
            customerEmail: customer?.email,
            unreadCount,
            lastMessage: lastMessage?.message || "",
            lastMessageAt: lastMessage?.createdAt,
            messageCount: messages.length,
          };
        })
      );

      customerMessages.sort((a, b) => {
        if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
        const dateA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const dateB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return dateB - dateA;
      });

      res.json(customerMessages);
    } catch (error) {
      console.error("Failed to get portal messages for staff:", error);
      res.status(500).json({ error: "Kunde inte hämta meddelanden" });
    }
  });

  // Get messages for a specific customer (staff view)
  app.get("/api/staff/portal-messages/:customerId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { customerId } = req.params;
      
      const rawCustomer = await storage.getCustomer(customerId);
      const customer = verifyTenantOwnership(rawCustomer, tenantId);
      if (!customer) {
        return res.status(404).json({ error: "Kund hittades inte" });
      }

      const messages = await storage.getLegacyPortalMessages(tenantId, customerId);
      await storage.markStaffMessagesAsRead(tenantId, customerId);
      
      res.json({
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
        },
        messages,
      });
    } catch (error) {
      console.error("Failed to get customer messages:", error);
      res.status(500).json({ error: "Kunde inte hämta kundmeddelanden" });
    }
  });

  // Send message to customer (staff)
  app.post("/api/staff/portal-messages/:customerId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { customerId } = req.params;
      const { message } = req.body;

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ error: "Meddelande krävs" });
      }

      const customer = await storage.getCustomer(customerId);
      if (!verifyTenantOwnership(customer, tenantId)) {
        return res.status(404).json({ error: "Kund hittades inte" });
      }

      const newMessage = await storage.createLegacyPortalMessage({
        tenantId,
        customerId,
        sender: "staff",
        message: message.trim(),
      });

      res.json(newMessage);
    } catch (error) {
      console.error("Failed to send message to customer:", error);
      res.status(500).json({ error: "Kunde inte skicka meddelande" });
    }
  });

  // ============================================
  // CUSTOMER PORTAL 2.0 - Visit Confirmations, Ratings, Chat, Self-Booking
  // ============================================

  // Visit Confirmations - Customer confirms job completion
  app.get("/api/portal/visit-confirmations", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const confirmations = await storage.getVisitConfirmations(session.tenantId!, { 
        customerId: session.customerId 
      });
      res.json(confirmations);
    } catch (error) {
      console.error("Failed to get visit confirmations:", error);
      res.status(500).json({ error: "Kunde inte hämta besökskvitteringar" });
    }
  });

  const visitConfirmationRequestSchema = insertVisitConfirmationSchema
    .omit({ tenantId: true, customerId: true, confirmedByEmail: true })
    .extend({
      confirmationStatus: z.enum(["confirmed", "disputed"]).optional(),
    });

  app.post("/api/portal/visit-confirmations", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const parseResult = visitConfirmationRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Ogiltig förfrågningsdata", details: parseResult.error.flatten() });
      }
      
      const { workOrderId, confirmationStatus, disputeReason, customerComment, confirmedByName } = parseResult.data;
      
      // Check if already confirmed
      const existing = await storage.getVisitConfirmationByWorkOrder(workOrderId);
      if (existing) {
        return res.status(400).json({ error: "Besöket är redan kvitterat" });
      }
      
      // Get work order to validate ownership
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!workOrder || workOrder.customerId !== session.customerId) {
        return res.status(404).json({ error: "Order hittades inte" });
      }
      
      const confirmation = await storage.createVisitConfirmation({
        tenantId: session.tenantId!,
        workOrderId,
        customerId: session.customerId!,
        confirmationStatus: confirmationStatus || "confirmed",
        disputeReason,
        customerComment,
        confirmedByName: confirmedByName || session.customerName,
        confirmedByEmail: session.email,
      });
      
      res.status(201).json(confirmation);
    } catch (error) {
      console.error("Failed to create visit confirmation:", error);
      res.status(500).json({ error: "Kunde inte kvittera besök" });
    }
  });

  // Technician Ratings
  app.get("/api/portal/technician-ratings", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const ratings = await storage.getTechnicianRatings(session.tenantId!, { 
        customerId: session.customerId 
      });
      res.json(ratings);
    } catch (error) {
      console.error("Failed to get ratings:", error);
      res.status(500).json({ error: "Kunde inte hämta betyg" });
    }
  });

  const technicianRatingRequestSchema = insertTechnicianRatingSchema
    .omit({ tenantId: true, customerId: true, resourceId: true })
    .extend({
      rating: z.number().min(1).max(5),
      categories: z.object({
        punctuality: z.number().min(1).max(5).optional(),
        quality: z.number().min(1).max(5).optional(),
        professionalism: z.number().min(1).max(5).optional(),
        communication: z.number().min(1).max(5).optional(),
        cleanliness: z.number().min(1).max(5).optional(),
      }).optional(),
    });

  app.post("/api/portal/technician-ratings", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const parseResult = technicianRatingRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Ogiltig förfrågningsdata", details: parseResult.error.flatten() });
      }
      
      const { workOrderId, rating, comment, categories, isAnonymous } = parseResult.data;
      
      // Check if already rated
      const existing = await storage.getTechnicianRatingByWorkOrder(workOrderId);
      if (existing) {
        return res.status(400).json({ error: "Du har redan betygsatt detta besök" });
      }
      
      // Get work order to get resource and validate
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!workOrder || workOrder.customerId !== session.customerId) {
        return res.status(404).json({ error: "Order hittades inte" });
      }
      
      const newRating = await storage.createTechnicianRating({
        tenantId: session.tenantId!,
        workOrderId,
        customerId: session.customerId!,
        resourceId: workOrder.resourceId || undefined,
        rating,
        comment,
        categories: categories || {},
        isAnonymous: isAnonymous || false,
      });
      
      res.status(201).json(newRating);
    } catch (error) {
      console.error("Failed to create rating:", error);
      res.status(500).json({ error: "Kunde inte spara betyg" });
    }
  });

  // Portal Messages (Chat) - New unified chat for work orders
  app.get("/api/portal/work-order-chat/:workOrderId", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const { workOrderId } = req.params;
      
      // Verify work order ownership
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!workOrder || workOrder.customerId !== session.customerId) {
        return res.status(404).json({ error: "Order hittades inte" });
      }
      
      // Get resource info
      let resource = null;
      if (workOrder.resourceId) {
        resource = await storage.getResource(workOrder.resourceId);
      }
      
      const messages = await storage.getPortalMessages(session.tenantId!, { 
        workOrderId,
        customerId: session.customerId,
      });
      
      res.json({
        workOrder: {
          id: workOrder.id,
          title: workOrder.title,
          scheduledDate: workOrder.scheduledDate,
          status: workOrder.orderStatus || workOrder.status,
        },
        resource: resource ? {
          id: resource.id,
          name: resource.name,
        } : null,
        messages,
      });
    } catch (error) {
      console.error("Failed to get work order chat:", error);
      res.status(500).json({ error: "Kunde inte hämta meddelanden" });
    }
  });

  const chatMessageRequestSchema = insertPortalMessageSchema
    .pick({ message: true })
    .extend({
      message: z.string().min(1, "Meddelande krävs"),
    });

  app.post("/api/portal/work-order-chat/:workOrderId", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const { workOrderId } = req.params;
      
      const parseResult = chatMessageRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Meddelande krävs", details: parseResult.error.flatten() });
      }
      
      const { message } = parseResult.data;
      
      // Verify work order ownership
      const workOrder = await storage.getWorkOrder(workOrderId);
      if (!workOrder || workOrder.customerId !== session.customerId) {
        return res.status(404).json({ error: "Order hittades inte" });
      }
      
      const newMessage = await storage.createPortalMessage({
        tenantId: session.tenantId!,
        workOrderId,
        customerId: session.customerId!,
        resourceId: workOrder.resourceId || undefined,
        senderType: "customer",
        senderId: session.customerId,
        senderName: session.customerName,
        message: message.trim(),
        messageType: "text",
      });
      
      res.status(201).json(newMessage);
    } catch (error) {
      console.error("Failed to send message:", error);
      res.status(500).json({ error: "Kunde inte skicka meddelande" });
    }
  });

  // Self-Booking Slots - Get available slots
  app.get("/api/portal/booking-slots", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const { startDate, endDate, serviceType } = req.query;
      
      const start = startDate ? new Date(startDate as string) : new Date();
      const end = endDate ? new Date(endDate as string) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      
      const slots = await storage.getSelfBookingSlots(session.tenantId!, {
        startDate: start,
        endDate: end,
        serviceType: serviceType as string,
        isActive: true,
      });
      
      // Filter to only available slots
      const availableSlots = slots.filter(s => (s.currentBookings || 0) < (s.maxBookings || 1));
      
      res.json(availableSlots);
    } catch (error) {
      console.error("Failed to get booking slots:", error);
      res.status(500).json({ error: "Kunde inte hämta tillgängliga tider" });
    }
  });

  // Self-Bookings - Customer's bookings
  app.get("/api/portal/self-bookings", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const bookings = await storage.getSelfBookings(session.tenantId!, { 
        customerId: session.customerId 
      });
      
      // Enrich with slot info
      const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
        let slot = null;
        if (booking.slotId) {
          slot = await storage.getSelfBookingSlot(booking.slotId);
        }
        return {
          ...booking,
          slotDate: slot?.slotDate,
          slotStartTime: slot?.startTime,
          slotEndTime: slot?.endTime,
        };
      }));
      
      res.json(enrichedBookings);
    } catch (error) {
      console.error("Failed to get self-bookings:", error);
      res.status(500).json({ error: "Kunde inte hämta bokningar" });
    }
  });

  const selfBookingRequestSchema = insertSelfBookingSchema
    .omit({ tenantId: true, customerId: true, status: true })
    .extend({
      serviceType: z.string().min(1, "Tjänsttyp krävs"),
    });

  app.post("/api/portal/self-bookings", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const parseResult = selfBookingRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Tidslucka och tjänsttyp krävs", details: parseResult.error.flatten() });
      }
      
      const { slotId, objectId, serviceType, customerNotes } = parseResult.data;
      
      // Verify slot exists and is available
      const slot = await storage.getSelfBookingSlot(slotId);
      if (!slot || slot.tenantId !== session.tenantId) {
        return res.status(404).json({ error: "Tidslucka hittades inte" });
      }
      
      if ((slot.currentBookings || 0) >= (slot.maxBookings || 1)) {
        return res.status(400).json({ error: "Tidsluckan är fullbokad" });
      }
      
      // Verify object belongs to customer if provided
      if (objectId) {
        const object = await storage.getObject(objectId);
        if (!object || object.customerId !== session.customerId) {
          return res.status(404).json({ error: "Objekt hittades inte" });
        }
      }
      
      // Create booking
      const booking = await storage.createSelfBooking({
        tenantId: session.tenantId!,
        slotId,
        customerId: session.customerId!,
        objectId: objectId || undefined,
        serviceType,
        status: "pending",
        customerNotes,
      });
      
      // Increment slot booking count
      await storage.incrementSlotBookingCount(slotId);
      
      res.status(201).json(booking);
    } catch (error) {
      console.error("Failed to create self-booking:", error);
      res.status(500).json({ error: "Kunde inte skapa bokning" });
    }
  });

  app.delete("/api/portal/self-bookings/:id", async (req, res) => {
    try {
      const session = await requirePortalAuth(req, res);
      if (!session) return;
      
      const booking = await storage.getSelfBooking(req.params.id);
      if (!booking || booking.customerId !== session.customerId) {
        return res.status(404).json({ error: "Bokning hittades inte" });
      }
      
      if (booking.status !== "pending") {
        return res.status(400).json({ error: "Endast väntande bokningar kan avbokas" });
      }
      
      await storage.updateSelfBooking(req.params.id, {
        status: "cancelled",
        cancelledAt: new Date(),
        cancelReason: "Avbokad av kund",
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to cancel self-booking:", error);
      res.status(500).json({ error: "Kunde inte avboka" });
    }
  });

  // Staff API - Self-booking slot management
  app.get("/api/self-booking-slots", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { startDate, endDate } = req.query;
      
      const slots = await storage.getSelfBookingSlots(tenantId, {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      
      res.json(slots);
    } catch (error) {
      console.error("Failed to get booking slots:", error);
      res.status(500).json({ error: "Kunde inte hämta tidsluckor" });
    }
  });

  app.post("/api/self-booking-slots", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const user = (req as any).user;
      
      const { insertSelfBookingSlotSchema } = await import("@shared/schema");
      const validated = insertSelfBookingSlotSchema.parse({
        ...req.body,
        tenantId,
        createdBy: user?.id,
      });
      
      const slot = await storage.createSelfBookingSlot(validated);
      res.status(201).json(slot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create booking slot:", error);
      res.status(500).json({ error: "Kunde inte skapa tidslucka" });
    }
  });

  app.patch("/api/self-booking-slots/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getSelfBookingSlot(req.params.id);
      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "Tidslucka hittades inte" });
      }
      
      const updated = await storage.updateSelfBookingSlot(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Failed to update booking slot:", error);
      res.status(500).json({ error: "Kunde inte uppdatera tidslucka" });
    }
  });

  app.delete("/api/self-booking-slots/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getSelfBookingSlot(req.params.id);
      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "Tidslucka hittades inte" });
      }
      
      await storage.deleteSelfBookingSlot(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete booking slot:", error);
      res.status(500).json({ error: "Kunde inte ta bort tidslucka" });
    }
  });

  // Staff API - View all self-bookings
  app.get("/api/self-bookings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { status } = req.query;
      
      const bookings = await storage.getSelfBookings(tenantId, {
        status: status as string,
      });
      
      // Enrich with customer and slot info
      const enrichedBookings = await Promise.all(bookings.map(async (booking) => {
        const [customer, slot] = await Promise.all([
          storage.getCustomer(booking.customerId),
          booking.slotId ? storage.getSelfBookingSlot(booking.slotId) : null,
        ]);
        return {
          ...booking,
          customerName: customer?.name,
          slotDate: slot?.slotDate,
          slotStartTime: slot?.startTime,
          slotEndTime: slot?.endTime,
        };
      }));
      
      res.json(enrichedBookings);
    } catch (error) {
      console.error("Failed to get self-bookings:", error);
      res.status(500).json({ error: "Kunde inte hämta bokningar" });
    }
  });

  app.patch("/api/self-bookings/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getSelfBooking(req.params.id);
      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "Bokning hittades inte" });
      }
      
      const { status, workOrderId } = req.body;
      
      const updateData: Record<string, unknown> = {};
      if (status) updateData.status = status;
      if (workOrderId) updateData.workOrderId = workOrderId;
      if (status === "confirmed") updateData.confirmedAt = new Date();
      if (status === "cancelled") {
        updateData.cancelledAt = new Date();
        updateData.cancelReason = req.body.cancelReason || "Avbokad av personal";
      }
      
      const updated = await storage.updateSelfBooking(req.params.id, updateData as any);
      res.json(updated);
    } catch (error) {
      console.error("Failed to update self-booking:", error);
      res.status(500).json({ error: "Kunde inte uppdatera bokning" });
    }
  });

  // Staff API - View technician ratings
  app.get("/api/technician-ratings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { resourceId } = req.query;
      
      const ratings = await storage.getTechnicianRatings(tenantId, {
        resourceId: resourceId as string,
      });
      
      res.json(ratings);
    } catch (error) {
      console.error("Failed to get technician ratings:", error);
      res.status(500).json({ error: "Kunde inte hämta teknikerbetyg" });
    }
  });

  app.get("/api/technician-ratings/average/:resourceId", async (req, res) => {
    try {
      const { resourceId } = req.params;
      const avgRating = await storage.getResourceAverageRating(resourceId);
      res.json(avgRating);
    } catch (error) {
      console.error("Failed to get average rating:", error);
      res.status(500).json({ error: "Kunde inte hämta genomsnittsbetyg" });
    }
  });

  // Staff API - View visit confirmations
  app.get("/api/visit-confirmations", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { customerId, workOrderId } = req.query;
      
      const confirmations = await storage.getVisitConfirmations(tenantId, {
        customerId: customerId as string,
        workOrderId: workOrderId as string,
      });
      
      res.json(confirmations);
    } catch (error) {
      console.error("Failed to get visit confirmations:", error);
      res.status(500).json({ error: "Kunde inte hämta besökskvitteringar" });
    }
  });

  // ============================================
  // QR CODE LINKS API
  // ============================================
  
  app.get("/api/qr-code-links", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { objectId } = req.query;
      
      const links = await storage.getQrCodeLinks(tenantId, objectId as string);
      res.json(links);
    } catch (error) {
      console.error("Failed to get QR code links:", error);
      res.status(500).json({ error: "Kunde inte hämta QR-koder" });
    }
  });

  app.get("/api/qr-code-links/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const link = await storage.getQrCodeLink(req.params.id);
      
      if (!link || !verifyTenantOwnership(link, tenantId)) {
        return res.status(404).json({ error: "QR-kod hittades inte" });
      }
      
      res.json(link);
    } catch (error) {
      console.error("Failed to get QR code link:", error);
      res.status(500).json({ error: "Kunde inte hämta QR-kod" });
    }
  });

  app.post("/api/qr-code-links", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const user = (req as any).user;
      
      // Generate unique code
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const { insertQrCodeLinkSchema } = await import("@shared/schema");
      const validated = insertQrCodeLinkSchema.parse({ 
        ...req.body, 
        tenantId,
        code,
        createdBy: user?.id,
      });
      
      const link = await storage.createQrCodeLink(validated);
      res.status(201).json(link);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create QR code link:", error);
      res.status(500).json({ error: "Kunde inte skapa QR-kod" });
    }
  });

  app.patch("/api/qr-code-links/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getQrCodeLink(req.params.id);
      if (!existing || !verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "QR-kod hittades inte" });
      }
      
      const link = await storage.updateQrCodeLink(req.params.id, tenantId, req.body);
      res.json(link);
    } catch (error) {
      console.error("Failed to update QR code link:", error);
      res.status(500).json({ error: "Kunde inte uppdatera QR-kod" });
    }
  });

  app.delete("/api/qr-code-links/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getQrCodeLink(req.params.id);
      if (!existing || !verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "QR-kod hittades inte" });
      }
      
      await storage.deleteQrCodeLink(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete QR code link:", error);
      res.status(500).json({ error: "Kunde inte ta bort QR-kod" });
    }
  });

  // ============================================
  // PUBLIC ISSUE REPORTS API (Internal management)
  // ============================================
  
  app.get("/api/public-issue-reports", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { objectId, status } = req.query;
      
      const reports = await storage.getPublicIssueReports(tenantId, {
        objectId: objectId as string,
        status: status as string,
      });
      
      res.json(reports);
    } catch (error) {
      console.error("Failed to get public issue reports:", error);
      res.status(500).json({ error: "Kunde inte hämta felanmälningar" });
    }
  });

  app.get("/api/public-issue-reports/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const report = await storage.getPublicIssueReport(req.params.id);
      
      if (!report || !verifyTenantOwnership(report, tenantId)) {
        return res.status(404).json({ error: "Felanmälan hittades inte" });
      }
      
      res.json(report);
    } catch (error) {
      console.error("Failed to get public issue report:", error);
      res.status(500).json({ error: "Kunde inte hämta felanmälan" });
    }
  });

  app.patch("/api/public-issue-reports/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getPublicIssueReport(req.params.id);
      if (!existing || !verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Felanmälan hittades inte" });
      }
      
      const report = await storage.updatePublicIssueReport(req.params.id, tenantId, req.body);
      res.json(report);
    } catch (error) {
      console.error("Failed to update public issue report:", error);
      res.status(500).json({ error: "Kunde inte uppdatera felanmälan" });
    }
  });

  // Convert public issue report to deviation report
  app.post("/api/public-issue-reports/:id/convert-to-deviation", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const user = (req as any).user;
      
      const report = await storage.getPublicIssueReport(req.params.id);
      if (!report || !verifyTenantOwnership(report, tenantId)) {
        return res.status(404).json({ error: "Felanmälan hittades inte" });
      }
      
      // Create deviation report from public issue
      const deviation = await storage.createDeviationReport({
        tenantId,
        objectId: report.objectId,
        category: report.category,
        title: report.title,
        description: report.description || undefined,
        severityLevel: 'medium',
        reportedByName: report.reporterName || 'Publik anmälan',
        latitude: report.latitude || undefined,
        longitude: report.longitude || undefined,
        photos: report.photos || undefined,
      });
      
      // Update public issue report with link
      await storage.updatePublicIssueReport(report.id, tenantId, {
        status: 'converted',
        linkedDeviationId: deviation.id,
        reviewedBy: user?.id,
        reviewedAt: new Date(),
      });
      
      res.status(201).json({
        deviation,
        message: "Felanmälan konverterad till avvikelse",
      });
    } catch (error) {
      console.error("Failed to convert public issue to deviation:", error);
      res.status(500).json({ error: "Kunde inte konvertera felanmälan" });
    }
  });

  // ============================================
  // PUBLIC ISSUE REPORT API (No auth required - for QR code scanning)
  // ============================================
  
  // Get object info and report form by QR code
  app.get("/api/public/report/:code", async (req, res) => {
    try {
      const { code } = req.params;
      
      const qrLink = await storage.getQrCodeLinkByCode(code);
      if (!qrLink) {
        return res.status(404).json({ error: "Ogiltig QR-kod" });
      }
      
      if (!qrLink.isActive) {
        return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });
      }
      
      // Increment scan count
      await storage.incrementQrCodeScanCount(qrLink.id);
      
      // Get object info (limited)
      const object = await storage.getObject(qrLink.objectId);
      if (!object) {
        return res.status(404).json({ error: "Objekt hittades inte" });
      }
      
      // Get tenant branding
      const { tenantBranding } = await import("@shared/schema");
      const [branding] = await db.select().from(tenantBranding)
        .where(eq(tenantBranding.tenantId, qrLink.tenantId));
      
      // Return limited info for public display
      res.json({
        objectId: object.id,
        objectName: object.name,
        objectAddress: object.address,
        qrLabel: qrLink.label,
        tenantId: qrLink.tenantId,
        companyName: branding?.companyName || 'Fältservice',
        primaryColor: branding?.primaryColor || '#3B82F6',
        categories: [
          { id: 'graffiti', label: 'Klotter' },
          { id: 'damage', label: 'Skada' },
          { id: 'spill', label: 'Spill/utsläpp' },
          { id: 'lighting', label: 'Belysning' },
          { id: 'large_items', label: 'Stora föremål' },
          { id: 'safety', label: 'Säkerhetsproblem' },
          { id: 'other', label: 'Övrigt' },
        ],
      });
    } catch (error) {
      console.error("Failed to get public report info:", error);
      res.status(500).json({ error: "Kunde inte ladda information" });
    }
  });

  // Submit public issue report (no auth)
  app.post("/api/public/report/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const { category, title, description, reporterName, reporterEmail, reporterPhone, photos, latitude, longitude } = req.body;
      
      const qrLink = await storage.getQrCodeLinkByCode(code);
      if (!qrLink) {
        return res.status(404).json({ error: "Ogiltig QR-kod" });
      }
      
      if (!qrLink.isActive) {
        return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });
      }
      
      if (!category || !title) {
        return res.status(400).json({ error: "Kategori och titel krävs" });
      }
      
      // Create public issue report
      const report = await storage.createPublicIssueReport({
        tenantId: qrLink.tenantId,
        qrCodeLinkId: qrLink.id,
        objectId: qrLink.objectId,
        category,
        title,
        description: description || undefined,
        reporterName: reporterName || undefined,
        reporterEmail: reporterEmail || undefined,
        reporterPhone: reporterPhone || undefined,
        photos: photos || undefined,
        latitude: latitude || undefined,
        longitude: longitude || undefined,
        ipAddress: req.ip || undefined,
        userAgent: req.headers['user-agent'] || undefined,
        status: 'new',
      });
      
      res.status(201).json({
        success: true,
        reportId: report.id,
        message: "Tack för din anmälan! Vi har tagit emot den och kommer att hantera ärendet.",
      });
    } catch (error) {
      console.error("Failed to create public issue report:", error);
      res.status(500).json({ error: "Kunde inte skicka anmälan" });
    }
  });

  // ============================================
  // PROTOCOLS API
  // ============================================
  
  app.get("/api/protocols", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId, objectId, protocolType, status } = req.query;
      
      const protocols = await storage.getProtocols(tenantId, {
        workOrderId: workOrderId as string,
        objectId: objectId as string,
        protocolType: protocolType as string,
        status: status as string,
      });
      
      res.json(protocols);
    } catch (error) {
      console.error("Failed to get protocols:", error);
      res.status(500).json({ error: "Kunde inte hämta protokoll" });
    }
  });

  app.get("/api/protocols/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const protocol = await storage.getProtocol(req.params.id);
      
      if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
        return res.status(404).json({ error: "Protokoll hittades inte" });
      }
      
      res.json(protocol);
    } catch (error) {
      console.error("Failed to get protocol:", error);
      res.status(500).json({ error: "Kunde inte hämta protokoll" });
    }
  });

  app.post("/api/protocols", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const { insertProtocolSchema } = await import("@shared/schema");
      const validated = insertProtocolSchema.parse({ ...req.body, tenantId });
      
      const protocol = await storage.createProtocol(validated);
      res.status(201).json(protocol);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create protocol:", error);
      res.status(500).json({ error: "Kunde inte skapa protokoll" });
    }
  });

  app.patch("/api/protocols/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getProtocol(req.params.id);
      if (!existing || !verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Protokoll hittades inte" });
      }
      
      const protocol = await storage.updateProtocol(req.params.id, tenantId, req.body);
      res.json(protocol);
    } catch (error) {
      console.error("Failed to update protocol:", error);
      res.status(500).json({ error: "Kunde inte uppdatera protokoll" });
    }
  });

  app.delete("/api/protocols/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getProtocol(req.params.id);
      if (!existing || !verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Protokoll hittades inte" });
      }
      
      await storage.deleteProtocol(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete protocol:", error);
      res.status(500).json({ error: "Kunde inte ta bort protokoll" });
    }
  });

  // Get assessment statistics for inspections
  app.get("/api/protocols/statistics/assessments", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { objectId, startDate, endDate } = req.query;
      
      // Get all inspection protocols
      const allProtocols = await storage.getProtocols(tenantId, {
        protocolType: 'inspection',
        objectId: objectId as string,
      });
      
      // Filter by date if specified
      let protocols = allProtocols;
      if (startDate) {
        const start = new Date(startDate as string);
        protocols = protocols.filter(p => new Date(p.executedAt) >= start);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        protocols = protocols.filter(p => new Date(p.executedAt) <= end);
      }
      
      // Count by rating
      const { ASSESSMENT_RATING_SCORES, ASSESSMENT_RATING_LABELS } = await import("@shared/schema");
      
      const ratingCounts: Record<string, number> = {};
      let totalScore = 0;
      let ratedCount = 0;
      
      for (const protocol of protocols) {
        if (protocol.assessmentRating) {
          ratingCounts[protocol.assessmentRating] = (ratingCounts[protocol.assessmentRating] || 0) + 1;
          const score = ASSESSMENT_RATING_SCORES[protocol.assessmentRating as keyof typeof ASSESSMENT_RATING_SCORES];
          if (score !== undefined) {
            totalScore += score;
            ratedCount++;
          }
        }
      }
      
      // Calculate average score
      const averageScore = ratedCount > 0 ? totalScore / ratedCount : null;
      
      // Build distribution with labels
      const distribution = Object.entries(ratingCounts).map(([rating, count]) => ({
        rating,
        label: ASSESSMENT_RATING_LABELS[rating as keyof typeof ASSESSMENT_RATING_LABELS] || rating,
        count,
        percentage: protocols.length > 0 ? Math.round((count / protocols.length) * 100) : 0,
      }));
      
      // Get trend data (last 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      const recentProtocols = allProtocols.filter(p => new Date(p.executedAt) >= sixMonthsAgo);
      const monthlyData: Record<string, { count: number; totalScore: number }> = {};
      
      for (const protocol of recentProtocols) {
        const monthKey = new Date(protocol.executedAt).toISOString().substring(0, 7);
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { count: 0, totalScore: 0 };
        }
        monthlyData[monthKey].count++;
        if (protocol.assessmentRating) {
          const score = ASSESSMENT_RATING_SCORES[protocol.assessmentRating as keyof typeof ASSESSMENT_RATING_SCORES];
          if (score !== undefined) {
            monthlyData[monthKey].totalScore += score;
          }
        }
      }
      
      const trend = Object.entries(monthlyData)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, data]) => ({
          month,
          inspections: data.count,
          averageScore: data.count > 0 ? Math.round((data.totalScore / data.count) * 10) / 10 : null,
        }));
      
      res.json({
        totalInspections: protocols.length,
        averageScore: averageScore !== null ? Math.round(averageScore * 10) / 10 : null,
        distribution,
        trend,
      });
    } catch (error) {
      console.error("Failed to get assessment statistics:", error);
      res.status(500).json({ error: "Kunde inte hämta statistik" });
    }
  });

  // Generate PDF for protocol
  app.post("/api/protocols/:id/generate-pdf", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const protocol = await storage.getProtocol(req.params.id);
      if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
        return res.status(404).json({ error: "Protokoll hittades inte" });
      }
      
      const { generateProtocolPdf } = await import('./protocol-pdf-generator');
      
      // Fetch related data
      const workOrder = await storage.getWorkOrder(protocol.workOrderId);
      const object = protocol.objectId ? await storage.getObject(protocol.objectId) : null;
      const customer = workOrder?.customerId ? await storage.getCustomer(workOrder.customerId) : null;
      const tenant = await storage.getTenant(tenantId);
      
      const pdfBuffer = await generateProtocolPdf(protocol, {
        workOrder,
        object,
        customer,
        tenant,
      });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="protokoll-${protocol.protocolNumber || protocol.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Failed to generate protocol PDF:", error);
      res.status(500).json({ error: "Kunde inte generera PDF" });
    }
  });

  // Send protocol to customer via email
  app.post("/api/protocols/:id/send-to-customer", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const protocol = await storage.getProtocol(req.params.id);
      if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
        return res.status(404).json({ error: "Protokoll hittades inte" });
      }
      
      const { sendProtocolToCustomer } = await import('./protocol-email-service');
      
      const workOrder = await storage.getWorkOrder(protocol.workOrderId);
      const object = protocol.objectId ? await storage.getObject(protocol.objectId) : null;
      const customer = workOrder?.customerId ? await storage.getCustomer(workOrder.customerId) : null;
      const tenant = await storage.getTenant(tenantId);
      
      if (!customer?.email) {
        return res.status(400).json({ error: "Kunden har ingen e-postadress" });
      }
      
      const result = await sendProtocolToCustomer(protocol, {
        workOrder,
        object,
        customer,
        tenant,
      });
      
      // Update protocol status
      await storage.updateProtocol(protocol.id, tenantId, {
        sentToCustomer: true,
        sentAt: new Date(),
        status: 'sent',
      });
      
      res.json({ success: true, message: "Protokoll skickat till kund" });
    } catch (error) {
      console.error("Failed to send protocol to customer:", error);
      res.status(500).json({ error: "Kunde inte skicka protokoll" });
    }
  });

  // ============================================
  // DEVIATION REPORTS API
  // ============================================
  
  app.get("/api/deviation-reports", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { objectId, status, category, severity } = req.query;
      
      const reports = await storage.getDeviationReports(tenantId, {
        objectId: objectId as string,
        status: status as string,
        category: category as string,
        severity: severity as string,
      });
      
      res.json(reports);
    } catch (error) {
      console.error("Failed to get deviation reports:", error);
      res.status(500).json({ error: "Kunde inte hämta avvikelserapporter" });
    }
  });

  app.get("/api/deviation-reports/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const report = await storage.getDeviationReport(req.params.id);
      
      if (!report || !verifyTenantOwnership(report, tenantId)) {
        return res.status(404).json({ error: "Avvikelserapport hittades inte" });
      }
      
      res.json(report);
    } catch (error) {
      console.error("Failed to get deviation report:", error);
      res.status(500).json({ error: "Kunde inte hämta avvikelserapport" });
    }
  });

  app.post("/api/deviation-reports", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const { insertDeviationReportSchema } = await import("@shared/schema");
      const validated = insertDeviationReportSchema.parse({ ...req.body, tenantId });
      
      const report = await storage.createDeviationReport(validated);
      res.status(201).json(report);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json(formatZodError(error));
      }
      console.error("Failed to create deviation report:", error);
      res.status(500).json({ error: "Kunde inte skapa avvikelserapport" });
    }
  });

  app.patch("/api/deviation-reports/:id", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const existing = await storage.getDeviationReport(req.params.id);
      if (!existing || !verifyTenantOwnership(existing, tenantId)) {
        return res.status(404).json({ error: "Avvikelserapport hittades inte" });
      }
      
      const report = await storage.updateDeviationReport(req.params.id, tenantId, req.body);
      res.json(report);
    } catch (error) {
      console.error("Failed to update deviation report:", error);
      res.status(500).json({ error: "Kunde inte uppdatera avvikelserapport" });
    }
  });

  // Create work order from deviation report
  app.post("/api/deviation-reports/:id/create-order", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      
      const report = await storage.getDeviationReport(req.params.id);
      if (!report || !verifyTenantOwnership(report, tenantId)) {
        return res.status(404).json({ error: "Avvikelserapport hittades inte" });
      }
      
      // Get object and customer info
      const object = await storage.getObject(report.objectId);
      if (!object) {
        return res.status(400).json({ error: "Objekt hittades inte" });
      }
      
      // Create new work order for fixing the deviation
      const { DEVIATION_CATEGORY_LABELS, SEVERITY_LEVEL_LABELS } = await import("@shared/schema");
      
      const categoryLabel = DEVIATION_CATEGORY_LABELS[report.category as keyof typeof DEVIATION_CATEGORY_LABELS] || report.category;
      const severityLabel = SEVERITY_LEVEL_LABELS[report.severityLevel as keyof typeof SEVERITY_LEVEL_LABELS] || report.severityLevel;
      
      const workOrder = await storage.createWorkOrder({
        tenantId,
        objectId: report.objectId,
        customerId: object.customerId || '',
        orderType: 'manual',
        status: 'planned',
        description: `Åtgärd: ${categoryLabel} - ${report.title}\n\nBeskrivning: ${report.description || ''}\n\nAllvarlighetsgrad: ${severityLabel}\n\nFöreslagen åtgärd: ${report.suggestedAction || 'Ej angiven'}`,
        creationMethod: 'deviation_report',
        latitude: report.latitude ? String(report.latitude) : undefined,
        longitude: report.longitude ? String(report.longitude) : undefined,
      });
      
      // Update deviation report with linked order
      await storage.updateDeviationReport(report.id, tenantId, {
        linkedActionOrderId: workOrder.id,
        status: 'in_progress',
      });
      
      res.status(201).json({
        workOrder,
        message: "Arbetsorder skapad för åtgärd av avvikelse",
      });
    } catch (error) {
      console.error("Failed to create order from deviation:", error);
      res.status(500).json({ error: "Kunde inte skapa arbetsorder" });
    }
  });

  // Resolve deviation report
  app.post("/api/deviation-reports/:id/resolve", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const user = (req as any).user;
      const { resolutionNotes } = req.body;
      
      const report = await storage.getDeviationReport(req.params.id);
      if (!report || !verifyTenantOwnership(report, tenantId)) {
        return res.status(404).json({ error: "Avvikelserapport hittades inte" });
      }
      
      const updated = await storage.updateDeviationReport(report.id, tenantId, {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: user?.id,
        resolutionNotes,
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Failed to resolve deviation report:", error);
      res.status(500).json({ error: "Kunde inte markera avvikelse som åtgärdad" });
    }
  });

  // ============================================
  // METADATA-TRIGGERS - Fas 3.2
  // Lista objekt med klotter, avvikelser och problem
  // ============================================

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

  app.get("/api/objects/:id/issue-history", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const objectId = req.params.id;
      
      const obj = await storage.getObject(objectId);
      if (!obj || !verifyTenantOwnership(obj, tenantId)) {
        return res.status(404).json({ error: "Objekt hittades inte" });
      }
      
      const deviations = await storage.getDeviationReports(tenantId, { objectId });
      const protocols = await storage.getProtocols(tenantId, { objectId, protocolType: 'inspection' });
      const publicReports = await storage.getPublicIssueReports(tenantId, { objectId });
      
      const timeline: any[] = [];
      
      for (const dev of deviations) {
        timeline.push({
          type: 'deviation',
          date: dev.reportedAt,
          category: dev.category,
          title: dev.title,
          status: dev.status,
          severity: dev.severity,
          id: dev.id,
        });
      }
      
      for (const protocol of protocols) {
        if (protocol.assessmentRating) {
          timeline.push({
            type: 'inspection',
            date: protocol.executedAt,
            rating: protocol.assessmentRating,
            notes: protocol.assessmentNotes,
            id: protocol.id,
          });
        }
      }
      
      for (const report of publicReports) {
        timeline.push({
          type: 'public_report',
          date: report.createdAt,
          category: report.category,
          title: report.title,
          status: report.status,
          id: report.id,
        });
      }
      
      timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      const byCategory: Record<string, number> = {};
      const byMonth: Record<string, number> = {};
      
      for (const item of timeline) {
        if (item.type === 'deviation' || item.type === 'public_report') {
          byCategory[item.category] = (byCategory[item.category] || 0) + 1;
          const month = new Date(item.date).toISOString().substring(0, 7);
          byMonth[month] = (byMonth[month] || 0) + 1;
        }
      }
      
      res.json({
        object: obj,
        totalEvents: timeline.length,
        categoryBreakdown: byCategory,
        monthlyTrend: Object.entries(byMonth)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, count]) => ({ month, count })),
        timeline: timeline.slice(0, 50),
      });
    } catch (error) {
      console.error("Failed to get object issue history:", error);
      res.status(500).json({ error: "Kunde inte hämta problemhistorik" });
    }
  });

  // ============================================
  // ENVIRONMENTAL DATA - Fas 3.1
  // ============================================

  app.get("/api/environmental-data", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId, resourceId, startDate, endDate } = req.query;
      
      const data = await storage.getEnvironmentalData(tenantId, {
        workOrderId: workOrderId as string,
        resourceId: resourceId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      
      res.json(data);
    } catch (error) {
      console.error("Failed to get environmental data:", error);
      res.status(500).json({ error: "Kunde inte hämta miljödata" });
    }
  });

  app.post("/api/environmental-data", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const user = (req as any).user;
      
      const { CO2_EMISSION_FACTORS } = await import("@shared/schema");
      
      let co2Kg = req.body.co2Kg;
      if (req.body.co2CalculationMethod !== 'manual' && req.body.fuelLiters && req.body.fuelType) {
        const factor = CO2_EMISSION_FACTORS[req.body.fuelType] || 0;
        co2Kg = req.body.fuelLiters * factor;
      } else if (req.body.co2CalculationMethod !== 'manual' && req.body.distanceKm && !co2Kg) {
        co2Kg = req.body.distanceKm * 0.25;
      }
      
      const data = await storage.createEnvironmentalData({
        ...req.body,
        tenantId,
        co2Kg,
        createdBy: user?.id,
      });
      
      res.json(data);
    } catch (error) {
      console.error("Failed to create environmental data:", error);
      res.status(500).json({ error: "Kunde inte spara miljödata" });
    }
  });

  app.get("/api/environmental-data/statistics", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { startDate, endDate, resourceId } = req.query;
      
      const data = await storage.getEnvironmentalData(tenantId, {
        resourceId: resourceId as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
      });
      
      let totalDistanceKm = 0;
      let totalFuelLiters = 0;
      let totalCo2Kg = 0;
      let totalWasteKg = 0;
      const chemicalsAggregated: Record<string, { quantity: number; unit: string }> = {};
      const fuelByType: Record<string, number> = {};
      const monthlyData: Record<string, { distanceKm: number; co2Kg: number; wasteKg: number }> = {};
      
      for (const record of data) {
        if (record.distanceKm) totalDistanceKm += record.distanceKm;
        if (record.fuelLiters) {
          totalFuelLiters += record.fuelLiters;
          if (record.fuelType) {
            fuelByType[record.fuelType] = (fuelByType[record.fuelType] || 0) + record.fuelLiters;
          }
        }
        if (record.co2Kg) totalCo2Kg += record.co2Kg;
        if (record.wasteCollectedKg) totalWasteKg += record.wasteCollectedKg;
        
        if (record.chemicalsUsed && Array.isArray(record.chemicalsUsed)) {
          for (const chem of record.chemicalsUsed as any[]) {
            if (!chemicalsAggregated[chem.name]) {
              chemicalsAggregated[chem.name] = { quantity: 0, unit: chem.unit || 'liters' };
            }
            chemicalsAggregated[chem.name].quantity += chem.quantity || 0;
          }
        }
        
        const monthKey = new Date(record.recordedAt).toISOString().substring(0, 7);
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { distanceKm: 0, co2Kg: 0, wasteKg: 0 };
        }
        monthlyData[monthKey].distanceKm += record.distanceKm || 0;
        monthlyData[monthKey].co2Kg += record.co2Kg || 0;
        monthlyData[monthKey].wasteKg += record.wasteCollectedKg || 0;
      }
      
      const trend = Object.entries(monthlyData)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, stats]) => ({
          month,
          distanceKm: Math.round(stats.distanceKm),
          co2Kg: Math.round(stats.co2Kg * 10) / 10,
          wasteKg: Math.round(stats.wasteKg),
        }));
      
      const chemicals = Object.entries(chemicalsAggregated).map(([name, data]) => ({
        name,
        quantity: Math.round(data.quantity * 100) / 100,
        unit: data.unit,
      }));
      
      res.json({
        totalRecords: data.length,
        totalDistanceKm: Math.round(totalDistanceKm),
        totalFuelLiters: Math.round(totalFuelLiters * 10) / 10,
        totalCo2Kg: Math.round(totalCo2Kg * 10) / 10,
        totalWasteKg: Math.round(totalWasteKg),
        fuelByType,
        chemicals,
        trend,
        co2PerKm: totalDistanceKm > 0 ? Math.round((totalCo2Kg / totalDistanceKm) * 1000) / 1000 : null,
      });
    } catch (error) {
      console.error("Failed to get environmental statistics:", error);
      res.status(500).json({ error: "Kunde inte hämta miljöstatistik" });
    }
  });
  
  // Environmental Certificate - annual sustainability report per customer
  app.get("/api/environmental-certificates/:customerId", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { customerId } = req.params;
      const { year } = req.query;
      
      const targetYear = year ? parseInt(year as string) : new Date().getFullYear() - 1;
      const startDate = new Date(`${targetYear}-01-01`);
      const endDate = new Date(`${targetYear}-12-31T23:59:59`);
      
      // Get customer info
      const customers = await storage.getCustomers(tenantId);
      const customer = customers.find(c => c.id === customerId);
      if (!customer) {
        return res.status(404).json({ error: "Kund hittades inte" });
      }
      
      // Get work orders for this customer
      const allWorkOrders = await storage.getWorkOrders(tenantId);
      const customerObjects = await storage.getObjects(tenantId);
      const customerObjectIds = new Set(
        customerObjects.filter(o => o.customerId === customerId).map(o => o.id)
      );
      const customerWorkOrders = allWorkOrders.filter(
        wo => wo.customerId === customerId || (wo.objectId && customerObjectIds.has(wo.objectId))
      );
      const workOrderIds = new Set(customerWorkOrders.map(wo => wo.id));
      
      // Get environmental data for this customer's work orders
      const allEnvData = await storage.getEnvironmentalData(tenantId, {
        startDate,
        endDate,
      });
      
      const envData = allEnvData.filter(d => d.workOrderId && workOrderIds.has(d.workOrderId));
      
      // Aggregate statistics
      let totalDistanceKm = 0;
      let totalFuelLiters = 0;
      let totalCo2Kg = 0;
      let totalWasteKg = 0;
      const chemicalsAggregated: Record<string, { quantity: number; unit: string }> = {};
      const fuelByType: Record<string, number> = {};
      
      for (const record of envData) {
        if (record.distanceKm) totalDistanceKm += record.distanceKm;
        if (record.fuelLiters) {
          totalFuelLiters += record.fuelLiters;
          if (record.fuelType) {
            fuelByType[record.fuelType] = (fuelByType[record.fuelType] || 0) + record.fuelLiters;
          }
        }
        if (record.co2Kg) totalCo2Kg += record.co2Kg;
        if (record.wasteCollectedKg) totalWasteKg += record.wasteCollectedKg;
        
        if (record.chemicalsUsed && Array.isArray(record.chemicalsUsed)) {
          for (const chem of record.chemicalsUsed as any[]) {
            if (!chemicalsAggregated[chem.name]) {
              chemicalsAggregated[chem.name] = { quantity: 0, unit: chem.unit || 'liters' };
            }
            chemicalsAggregated[chem.name].quantity += chem.quantity || 0;
          }
        }
      }
      
      const chemicals = Object.entries(chemicalsAggregated).map(([name, data]) => ({
        name,
        quantity: Math.round(data.quantity * 100) / 100,
        unit: data.unit,
      }));
      
      // Calculate sustainability metrics
      const co2PerKm = totalDistanceKm > 0 ? totalCo2Kg / totalDistanceKm : 0;
      const co2Savings = totalWasteKg * 0.5; // Estimated CO2 saved per kg waste collected (simplified)
      const netCo2Impact = totalCo2Kg - co2Savings;
      
      // Count completed work orders
      const completedOrders = customerWorkOrders.filter(
        wo => wo.status === "utford" || wo.status === "fakturerad"
      ).length;
      
      res.json({
        customerId,
        customerName: customer.name,
        customerOrgNumber: customer.orgNumber,
        year: targetYear,
        generatedAt: new Date().toISOString(),
        statistics: {
          totalWorkOrders: customerWorkOrders.length,
          completedWorkOrders: completedOrders,
          totalDistanceKm: Math.round(totalDistanceKm),
          totalFuelLiters: Math.round(totalFuelLiters * 10) / 10,
          totalCo2Kg: Math.round(totalCo2Kg * 10) / 10,
          totalWasteCollectedKg: Math.round(totalWasteKg),
          co2PerKm: Math.round(co2PerKm * 1000) / 1000,
          estimatedCo2SavingsKg: Math.round(co2Savings * 10) / 10,
          netCo2ImpactKg: Math.round(netCo2Impact * 10) / 10,
          fuelByType,
          chemicals,
        },
        sustainabilityRating: netCo2Impact <= 0 ? "Klimatpositiv" : 
          co2PerKm < 0.15 ? "Utmärkt" : 
          co2PerKm < 0.25 ? "Bra" : 
          co2PerKm < 0.35 ? "Medel" : "Behöver förbättras",
      });
    } catch (error) {
      console.error("Failed to generate environmental certificate:", error);
      res.status(500).json({ error: "Kunde inte generera miljöcertifikat" });
    }
  });

  app.get("/api/system/api-costs/summary", requireAdmin, async (req, res) => {
    try {
      const period = (req.query.period as string) || "month";
      let startDate: Date;
      const endDate = new Date();
      
      switch (period) {
        case "day": startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); break;
        case "week": startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case "year": startDate = new Date(endDate.getFullYear(), 0, 1); break;
        default: startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      }
      
      if (req.query.startDate) startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) endDate.setTime(new Date(req.query.endDate as string).getTime());

      const results = await db
        .select({
          service: apiUsageLogs.service,
          totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
          totalCalls: sql<number>`COUNT(*)`,
          totalInputTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.inputTokens}), 0)`,
          totalOutputTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.outputTokens}), 0)`,
          avgDurationMs: sql<number>`COALESCE(AVG(${apiUsageLogs.durationMs}), 0)`,
          errorCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.statusCode} >= 400 THEN 1 ELSE 0 END)`,
        })
        .from(apiUsageLogs)
        .where(gte(apiUsageLogs.createdAt, startDate))
        .groupBy(apiUsageLogs.service);
      
      const totalCost = results.reduce((sum, r) => sum + Number(r.totalCost), 0);
      const totalCalls = results.reduce((sum, r) => sum + Number(r.totalCalls), 0);
      
      res.json({
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        totalCalls,
        services: results.map(r => ({
          service: r.service,
          totalCostUsd: Math.round(Number(r.totalCost) * 10000) / 10000,
          totalCalls: Number(r.totalCalls),
          totalInputTokens: Number(r.totalInputTokens),
          totalOutputTokens: Number(r.totalOutputTokens),
          avgDurationMs: Math.round(Number(r.avgDurationMs)),
          errorCount: Number(r.errorCount),
        })),
      });
    } catch (error) {
      console.error("Failed to fetch API cost summary:", error);
      res.status(500).json({ error: "Kunde inte hämta API-kostnadssammanfattning" });
    }
  });

  app.get("/api/system/api-costs/trends", requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const serviceFilter = req.query.service as string;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      
      const conditions = [gte(apiUsageLogs.createdAt, startDate)];
      if (serviceFilter) conditions.push(eq(apiUsageLogs.service, serviceFilter));
      
      const results = await db
        .select({
          date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
          service: apiUsageLogs.service,
          totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
          totalCalls: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.totalTokens}), 0)`,
        })
        .from(apiUsageLogs)
        .where(and(...conditions))
        .groupBy(sql`DATE(${apiUsageLogs.createdAt})`, apiUsageLogs.service)
        .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);
      
      res.json(results.map(r => ({
        date: r.date,
        service: r.service,
        totalCostUsd: Math.round(Number(r.totalCost) * 10000) / 10000,
        totalCalls: Number(r.totalCalls),
        totalTokens: Number(r.totalTokens),
      })));
    } catch (error) {
      console.error("Failed to fetch API cost trends:", error);
      res.status(500).json({ error: "Kunde inte hämta kostnadstrender" });
    }
  });

  app.get("/api/system/api-costs/recent", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const serviceFilter = req.query.service as string;
      
      const conditions = [];
      if (serviceFilter) conditions.push(eq(apiUsageLogs.service, serviceFilter));
      
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      
      const [logs, countResult] = await Promise.all([
        db
          .select()
          .from(apiUsageLogs)
          .where(whereClause)
          .orderBy(desc(apiUsageLogs.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: sql<number>`COUNT(*)` })
          .from(apiUsageLogs)
          .where(whereClause),
      ]);
      
      res.json({
        logs,
        total: Number(countResult[0]?.total || 0),
        limit,
        offset,
      });
    } catch (error) {
      console.error("Failed to fetch recent API logs:", error);
      res.status(500).json({ error: "Kunde inte hämta API-loggar" });
    }
  });

  app.get("/api/system/api-costs/by-tenant", requireAdmin, async (req, res) => {
    try {
      const period = (req.query.period as string) || "month";
      let startDate: Date;
      
      switch (period) {
        case "day": startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); break;
        case "week": startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
        case "year": startDate = new Date(new Date().getFullYear(), 0, 1); break;
        default: startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      }

      const results = await db
        .select({
          tenantId: apiUsageLogs.tenantId,
          service: apiUsageLogs.service,
          totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
          totalCalls: sql<number>`COUNT(*)`,
        })
        .from(apiUsageLogs)
        .where(gte(apiUsageLogs.createdAt, startDate))
        .groupBy(apiUsageLogs.tenantId, apiUsageLogs.service);
      
      res.json(results.map(r => ({
        tenantId: r.tenantId || "system",
        service: r.service,
        totalCostUsd: Math.round(Number(r.totalCost) * 10000) / 10000,
        totalCalls: Number(r.totalCalls),
      })));
    } catch (error) {
      console.error("Failed to fetch tenant API costs:", error);
      res.status(500).json({ error: "Kunde inte hämta tenant-kostnader" });
    }
  });

  app.get("/api/system/api-budgets", requireAdmin, async (req, res) => {
    try {
      const budgets = await db.select().from(apiBudgets).orderBy(apiBudgets.service);
      res.json(budgets);
    } catch (error) {
      console.error("Failed to fetch API budgets:", error);
      res.status(500).json({ error: "Kunde inte hämta budgetar" });
    }
  });

  app.put("/api/system/api-budgets", requireAdmin, async (req, res) => {
    try {
      const { service, monthlyBudgetUsd, alertThresholdPercent, tenantId } = req.body;
      if (!service || monthlyBudgetUsd === undefined) {
        return res.status(400).json({ error: "Service och budget krävs" });
      }
      
      const existing = await db.select().from(apiBudgets)
        .where(and(
          eq(apiBudgets.service, service),
          tenantId ? eq(apiBudgets.tenantId, tenantId) : sql`${apiBudgets.tenantId} IS NULL`
        ));
      
      if (existing.length > 0) {
        await db.update(apiBudgets)
          .set({ 
            monthlyBudgetUsd, 
            alertThresholdPercent: alertThresholdPercent || 80,
            updatedAt: new Date() 
          })
          .where(eq(apiBudgets.id, existing[0].id));
      } else {
        await db.insert(apiBudgets).values({
          service,
          tenantId: tenantId || null,
          monthlyBudgetUsd,
          alertThresholdPercent: alertThresholdPercent || 80,
        });
      }
      
      const budgets = await db.select().from(apiBudgets).orderBy(apiBudgets.service);
      res.json(budgets);
    } catch (error) {
      console.error("Failed to update API budget:", error);
      res.status(500).json({ error: "Kunde inte uppdatera budget" });
    }
  });

  app.get("/api/system/api-costs/pricing", requireAdmin, async (_req, res) => {
    const { PRICING } = await import("./api-usage-tracker");
    res.json(PRICING);
  });

  // ============================================
  // FIELD WORKER TASK ENDPOINTS
  // ============================================

  app.get("/api/field-worker/tasks", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { date, resourceId } = req.query;
      
      const allOrders = await storage.getWorkOrders(tenantId);
      const targetDate = date ? new Date(date as string) : new Date();
      const dateStr = targetDate.toISOString().split('T')[0];
      
      let filtered = allOrders.filter(wo => {
        if (wo.scheduledDate) {
          const woDate = new Date(wo.scheduledDate).toISOString().split('T')[0];
          return woDate === dateStr;
        }
        return false;
      });
      
      if (resourceId) {
        filtered = filtered.filter(wo => wo.resourceId === resourceId);
      }
      
      filtered.sort((a, b) => {
        const aTime = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
        const bTime = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
        return aTime - bTime;
      });
      
      const tasksWithDeps = await Promise.all(filtered.map(async (wo) => {
        const deps = await db.select().from(taskDependencyInstances)
          .where(eq(taskDependencyInstances.childWorkOrderId, wo.id));
        
        const dependsOn = deps.map(d => ({
          parentId: d.parentWorkOrderId,
          type: d.dependencyType,
          completed: d.completed,
        }));
        
        const isLocked = dependsOn.some(d => d.type === 'before' && !d.completed);
        
        return {
          ...wo,
          dependsOn,
          isLocked,
          isDependentTask: dependsOn.length > 0,
        };
      }));
      
      res.json(tasksWithDeps);
    } catch (error) {
      console.error("Failed to get field worker tasks:", error);
      res.status(500).json({ error: "Kunde inte hämta uppgifter" });
    }
  });

  app.post("/api/field-worker/tasks/:id/start", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || workOrder.tenantId !== tenantId) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const updated = await storage.updateWorkOrder(req.params.id, {
        executionStatus: "travel",
        status: "in_progress",
      });
      if (workOrder.tenantId) {
        handleWorkOrderStatusChange(req.params.id, workOrder.executionStatus || "pending", "travel", workOrder.tenantId).catch(err =>
          console.error("[ai-communication] Field start hook error:", err)
        );
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte starta uppgift" });
    }
  });

  app.post("/api/field-worker/tasks/:id/complete", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || workOrder.tenantId !== tenantId) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const updated = await storage.updateWorkOrder(req.params.id, {
        executionStatus: "completed",
        status: "completed",
        completedAt: new Date(),
      });
      if (workOrder.tenantId) {
        handleWorkOrderStatusChange(req.params.id, workOrder.executionStatus || "in_progress", "completed", workOrder.tenantId).catch(err =>
          console.error("[ai-communication] Field complete hook error:", err)
        );
      }
      
      await db.update(taskDependencyInstances)
        .set({ completed: true })
        .where(eq(taskDependencyInstances.parentWorkOrderId, req.params.id));
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte slutföra uppgift" });
    }
  });

  app.post("/api/field-worker/tasks/:id/update-metadata", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || workOrder.tenantId !== tenantId) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const { metadata } = req.body;
      if (workOrder.objectId && metadata) {
        for (const [key, value] of Object.entries(metadata)) {
          try {
            await createMetadata({
              tenantId,
              objektId: workOrder.objectId,
              metadataTypNamn: key,
              varde: String(value),
              metod: `field:${req.params.id}`,
            });
          } catch (e) {
          }
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Kunde inte uppdatera metadata" });
    }
  });

  // ============================================
  // FIELD WORKER PHOTO UPLOAD
  // ============================================
  
  app.post("/api/field-worker/tasks/:id/upload-photo", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || workOrder.tenantId !== tenantId) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
      const objectStorageService = new ObjectStorageService();
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      
      res.json({
        uploadURL,
        objectPath,
        workOrderId: req.params.id,
      });
    } catch (error) {
      console.error("Failed to generate photo upload URL:", error);
      res.status(500).json({ error: "Kunde inte generera uppladdnings-URL" });
    }
  });
  
  app.post("/api/field-worker/tasks/:id/confirm-photo", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder || workOrder.tenantId !== tenantId) {
        return res.status(404).json({ error: "Uppgift hittades inte" });
      }
      
      const { objectPath, category } = req.body;
      if (!objectPath) {
        return res.status(400).json({ error: "objectPath krävs" });
      }
      
      const metadata = (workOrder.metadata as Record<string, any>) || {};
      const photos = metadata.photos || [];
      photos.push({
        path: objectPath,
        category: category || "general",
        uploadedAt: new Date().toISOString(),
      });
      
      await storage.updateWorkOrder(req.params.id, tenantId, {
        metadata: { ...metadata, photos },
      });
      
      res.json({ success: true, photoCount: photos.length });
    } catch (error) {
      console.error("Failed to confirm photo upload:", error);
      res.status(500).json({ error: "Kunde inte spara fotoinformation" });
    }
  });

  // ============================================
  // INVOICE PREVIEW TO FORTNOX EXPORT
  // ============================================
  
  app.post("/api/invoice-preview/export-to-fortnox", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { invoices } = req.body;
      
      if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
        return res.status(400).json({ error: "Inga fakturor att exportera" });
      }
      
      const results: Array<{ customerId: string; customerName: string; status: string; exportId?: string; error?: string }> = [];
      
      for (const invoice of invoices) {
        const lines = invoice.lines || [];
        for (const line of lines) {
          if (!line.workOrderId) continue;
          try {
            const invoiceExport = await storage.createFortnoxInvoiceExport({
              tenantId,
              workOrderId: line.workOrderId,
              status: "pending",
              totalAmount: Math.round(line.total || 0),
              costCenter: invoice.headerMetadata?.kostnadsställe || null,
              project: invoice.headerMetadata?.projekt || null,
            });
            
            results.push({
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              status: "pending",
              exportId: invoiceExport.id,
            });
          } catch (e: any) {
            results.push({
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              status: "error",
              error: e.message,
            });
          }
        }
      }
      
      res.json({ 
        exported: results.filter(r => r.status === "pending").length,
        failed: results.filter(r => r.status === "error").length,
        results 
      });
    } catch (error) {
      console.error("Failed to export invoices to Fortnox:", error);
      res.status(500).json({ error: "Kunde inte exportera fakturor till Fortnox" });
    }
  });

  // ============================================
  // INSPECTION METADATA ENDPOINTS
  // ============================================

  app.get("/api/inspection-metadata", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { objectId } = req.query;
      const results = await storage.getInspectionMetadata(tenantId, objectId as string | undefined);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta besiktningsdata" });
    }
  });

  app.post("/api/inspection-metadata", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const result = await storage.createInspectionMetadata({ ...req.body, tenantId });
      res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create inspection metadata:", error);
      res.status(500).json({ error: "Kunde inte skapa besiktningsdata" });
    }
  });

  app.get("/api/inspection-metadata/search", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { inspectionType, status, objectId } = req.query;
      const results = await storage.searchInspectionMetadata(tenantId, {
        inspectionType: inspectionType as string | undefined,
        status: status as string | undefined,
        objectId: objectId as string | undefined,
      });
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte söka besiktningsdata" });
    }
  });

  // ============================================
  // AI ETA & DELAY SERVICE
  // ============================================

  app.get("/api/ai/eta-overview", async (req, res) => {
    try {
      const { calculateETAForTodaysOrders } = await import("./ai-eta-service");
      const tenantId = getTenantIdWithFallback(req);
      const overview = await calculateETAForTodaysOrders(tenantId);
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte beräkna ETA" });
    }
  });

  app.post("/api/ai/eta-check-delays", async (req, res) => {
    try {
      const { checkAndNotifyDelays } = await import("./ai-eta-service");
      const tenantId = getTenantIdWithFallback(req);
      const { thresholdMinutes } = req.body;
      const result = await checkAndNotifyDelays(tenantId, thresholdMinutes || 20);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte kontrollera förseningar" });
    }
  });

  // ============================================
  // AI INSIGHT CARDS
  // ============================================

  app.get("/api/ai/insights", async (req, res) => {
    try {
      const { generateInsightCards } = await import("./ai-insights");
      const tenantId = getTenantIdWithFallback(req);
      const cards = await generateInsightCards(tenantId);
      res.json(cards);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte generera insikter" });
    }
  });

  // ============================================
  // AI-ASSISTED PLANNING
  // ============================================

  app.post("/api/ai/assisted-plan", async (req, res) => {
    try {
      const { aiAssistedSchedule } = await import("./ai-planner");
      const { weekStart, weekEnd, instruction } = req.body;

      const tenantId = getTenantIdWithFallback(req);
      const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
        storage.getWorkOrders(tenantId),
        storage.getResources(tenantId),
        storage.getClusters(tenantId),
        storage.getSetupTimeLogs(tenantId),
      ]);

      const unscheduledOrderIds = workOrders
        .filter(o => !o.scheduledDate || !o.resourceId)
        .map(o => o.id);
      const timeWindows = await storage.getTaskTimewindowsBatch(unscheduledOrderIds);

      const result = await aiAssistedSchedule({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        setupTimeLogs,
        timeWindows,
      }, instruction);

      res.json(result);
    } catch (error) {
      console.error("AI Assisted Plan error:", error);
      res.status(500).json({ error: "Kunde inte skapa AI-assisterad plan" });
    }
  });

  // ============================================
  // AI CUSTOMER COMMUNICATION
  // ============================================

  app.get("/api/ai/communications", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId, status, from, to } = req.query;
      const log = await getCommunicationLog(tenantId, {
        workOrderId: workOrderId as string,
        status: status as string,
        from: from as string,
        to: to as string,
      });
      res.json(log);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta kommunikationslogg" });
    }
  });

  app.get("/api/ai/communications/settings", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const settings = await getAutoNotificationSettings(tenantId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta inställningar" });
    }
  });

  app.post("/api/ai/communications/eta-update", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId, estimatedMinutes } = req.body;
      if (!workOrderId || estimatedMinutes === undefined) {
        return res.status(400).json({ error: "workOrderId och estimatedMinutes krävs" });
      }
      const result = await sendETAUpdate(workOrderId, estimatedMinutes, tenantId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte skicka ETA-uppdatering" });
    }
  });

  app.post("/api/ai/communications/send-manual", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const { workOrderId, notificationType, channel, customMessage } = req.body;
      if (!workOrderId) {
        return res.status(400).json({ error: "workOrderId krävs" });
      }
      const result = await handleWorkOrderStatusChange(
        workOrderId, 
        "manual", 
        notificationType || "reminder", 
        tenantId
      );
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: "Kunde inte skicka meddelande" });
    }
  });

  // ============================================
  // USER MANAGEMENT API
  // ============================================

  const requireAdminAuth = (req: any, res: any, next: any) => {
    const replitUser = req.user as any;
    const sessionUserId = (req.session as any)?.userId;
    if ((replitUser && replitUser.claims?.sub) || sessionUserId) {
      return next();
    }
    return res.status(401).json({ error: "Ej autentiserad", message: "Du måste logga in för att komma åt denna resurs." });
  };

  app.get("/api/admin/users", requireAdminAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const safeUsers = allUsers.map(({ passwordHash, ...user }) => user);
      res.json(safeUsers);
    } catch (error) {
      console.error("Failed to get users:", error);
      res.status(500).json({ error: "Kunde inte hämta användare" });
    }
  });

  app.post("/api/admin/users", requireAdminAuth, async (req, res) => {
    try {
      const { email, firstName, lastName, password, role, resourceId } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "E-post och lösenord krävs" });
      }

      const existing = await storage.getUserByUsername(email);
      if (existing) {
        return res.status(409).json({ error: "En användare med den e-postadressen finns redan" });
      }

      const hashedPassword = hashPassword(password);
      const user = await storage.createUser({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash: hashedPassword,
        role: role || "user",
        resourceId: resourceId || null,
        isActive: true,
      });

      const { passwordHash: _, ...safeUser } = user;
      console.log(`[user-mgmt] User "${email}" created with role "${role || 'user'}"`);
      res.status(201).json(safeUser);
    } catch (error) {
      console.error("Failed to create user:", error);
      res.status(500).json({ error: "Kunde inte skapa användare" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdminAuth, async (req, res) => {
    try {
      const { email, firstName, lastName, password, role, resourceId, isActive } = req.body;
      const updateData: Record<string, any> = {};

      if (email !== undefined) updateData.email = email;
      if (firstName !== undefined) updateData.firstName = firstName;
      if (lastName !== undefined) updateData.lastName = lastName;
      if (role !== undefined) updateData.role = role;
      if (resourceId !== undefined) updateData.resourceId = resourceId;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (password) {
        updateData.passwordHash = hashPassword(password);
      }

      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) return res.status(404).json({ error: "Användaren hittades inte" });

      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Failed to update user:", error);
      res.status(500).json({ error: "Kunde inte uppdatera användare" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdminAuth, async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete user:", error);
      res.status(500).json({ error: "Kunde inte ta bort användare" });
    }
  });

  // Login with email + password (returns session)
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "E-post och lösenord krävs" });
      }

      const { verifyPassword } = await import("./password");
      const user = await storage.getUserByUsername(email);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: "Felaktig e-post eller lösenord" });
      }
      if (user.isActive === false) {
        return res.status(403).json({ error: "Kontot är inaktiverat" });
      }

      const valid = verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Felaktig e-post eller lösenord" });
      }

      (req.session as any).userId = user.id;
      (req.session as any).userEmail = user.email;
      (req.session as any).userRole = user.role;

      const { passwordHash: _, ...safeUser } = user;
      console.log(`[auth] User "${email}" logged in successfully`);
      res.json({ success: true, user: safeUser });
    } catch (error) {
      console.error("Login failed:", error);
      res.status(500).json({ error: "Inloggning misslyckades" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Inte inloggad" });
      }
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ error: "Användaren hittades inte" });
      }
      const { passwordHash: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta användardata" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.use((err: any, _req: ExpressRequest, res: ExpressResponse, _next: any) => {
    console.error("[global-error]", err);
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const message = err.message || "Ett oväntat serverfel uppstod";
    res.status(err.status || 500).json({ error: message });
  });

  return httpServer;
}
