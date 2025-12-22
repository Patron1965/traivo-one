import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCustomerSchema, insertObjectSchema, insertResourceSchema, 
  insertWorkOrderSchema, insertSetupTimeLogSchema, insertTenantSchema, insertProcurementSchema,
  insertArticleSchema, insertPriceListSchema, insertPriceListArticleSchema, insertResourceArticleSchema,
  insertWorkOrderLineSchema, insertSimulationScenarioSchema, ORDER_STATUSES, type OrderStatus
} from "@shared/schema";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import multer from "multer";
import Papa from "papaparse";

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

async function ensureDefaultTenant() {
  let tenant = await storage.getTenant(DEFAULT_TENANT_ID);
  return tenant;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  await setupAuth(app);
  registerAuthRoutes(app);
  
  await ensureDefaultTenant();

  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customer" });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const data = insertCustomerSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const customer = await storage.createCustomer(data);
      res.status(201).json(customer);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create customer" });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const customer = await storage.updateCustomer(req.params.id, updateData);
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      await storage.deleteCustomer(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete customer" });
    }
  });

  app.get("/api/objects", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string || "";
      const customerId = req.query.customerId as string || undefined;
      const ids = req.query.ids as string || undefined;
      
      // If requesting specific IDs - batch fetch
      if (ids) {
        const idArray = ids.split(",").filter(id => id.trim());
        if (idArray.length > 0) {
          const objects = await storage.getObjectsByIds(DEFAULT_TENANT_ID, idArray);
          res.json(objects);
          return;
        }
      }
      
      // If paginated request
      if (req.query.limit || req.query.offset || req.query.search || req.query.customerId) {
        const result = await storage.getObjectsPaginated(DEFAULT_TENANT_ID, limit, offset, search, customerId);
        res.json(result);
      } else {
        // Legacy: return all objects (for backward compatibility)
        const objects = await storage.getObjects(DEFAULT_TENANT_ID);
        res.json(objects);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch objects" });
    }
  });

  app.get("/api/objects/:id", async (req, res) => {
    try {
      const object = await storage.getObject(req.params.id);
      if (!object) return res.status(404).json({ error: "Object not found" });
      res.json(object);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch object" });
    }
  });

  app.get("/api/customers/:customerId/objects", async (req, res) => {
    try {
      const objects = await storage.getObjectsByCustomer(req.params.customerId);
      res.json(objects);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch objects" });
    }
  });

  app.post("/api/objects", async (req, res) => {
    try {
      const data = insertObjectSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const object = await storage.createObject(data);
      res.status(201).json(object);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create object" });
    }
  });

  app.patch("/api/objects/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const object = await storage.updateObject(req.params.id, updateData);
      if (!object) return res.status(404).json({ error: "Object not found" });
      res.json(object);
    } catch (error) {
      res.status(500).json({ error: "Failed to update object" });
    }
  });

  app.delete("/api/objects/:id", async (req, res) => {
    try {
      await storage.deleteObject(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete object" });
    }
  });

  app.get("/api/resources", async (req, res) => {
    try {
      const resources = await storage.getResources(DEFAULT_TENANT_ID);
      res.json(resources);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resources" });
    }
  });

  app.get("/api/resources/:id", async (req, res) => {
    try {
      const resource = await storage.getResource(req.params.id);
      if (!resource) return res.status(404).json({ error: "Resource not found" });
      res.json(resource);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource" });
    }
  });

  app.post("/api/resources", async (req, res) => {
    try {
      const data = insertResourceSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const resource = await storage.createResource(data);
      res.status(201).json(resource);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create resource" });
    }
  });

  app.patch("/api/resources/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const resource = await storage.updateResource(req.params.id, updateData);
      if (!resource) return res.status(404).json({ error: "Resource not found" });
      res.json(resource);
    } catch (error) {
      res.status(500).json({ error: "Failed to update resource" });
    }
  });

  app.delete("/api/resources/:id", async (req, res) => {
    try {
      await storage.deleteResource(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource" });
    }
  });

  app.get("/api/work-orders", async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const includeUnscheduled = req.query.includeUnscheduled === 'true';
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      
      const workOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID, startDate, endDate, includeUnscheduled, limit);
      res.json(workOrders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work orders" });
    }
  });

  app.get("/api/work-orders/:id", async (req, res) => {
    try {
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      res.json(workOrder);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work order" });
    }
  });

  app.get("/api/resources/:resourceId/work-orders", async (req, res) => {
    try {
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
      // Default orderStatus to 'skapad' for new orders
      const data = insertWorkOrderSchema.parse({ 
        orderStatus: 'skapad',
        isSimulated: false,
        ...req.body, 
        tenantId: DEFAULT_TENANT_ID 
      });
      const workOrder = await storage.createWorkOrder(data);
      res.status(201).json(workOrder);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create work order" });
    }
  });

  app.patch("/api/work-orders/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      
      // Convert scheduledDate string to Date object if present (use UTC to prevent timezone shift)
      if (updateData.scheduledDate && typeof updateData.scheduledDate === 'string') {
        updateData.scheduledDate = new Date(updateData.scheduledDate + 'T12:00:00Z');
      }
      
      const workOrder = await storage.updateWorkOrder(req.params.id, updateData);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      res.json(workOrder);
    } catch (error) {
      console.error("Failed to update work order:", error);
      res.status(500).json({ error: "Failed to update work order" });
    }
  });

  app.delete("/api/work-orders/:id", async (req, res) => {
    try {
      await storage.deleteWorkOrder(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete work order" });
    }
  });

  // Order Stock - aggregated view with filters and server-side pagination
  app.get("/api/order-stock", async (req, res) => {
    try {
      const includeSimulated = req.query.includeSimulated === "true";
      const scenarioId = req.query.scenarioId as string | undefined;
      const orderStatus = req.query.orderStatus as OrderStatus | undefined;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50;
      const search = req.query.search as string | undefined;
      
      const { orders, total, byStatus, aggregates } = await storage.getOrderStock(DEFAULT_TENANT_ID, {
        includeSimulated,
        scenarioId,
        orderStatus,
        startDate,
        endDate,
        page,
        pageSize,
        search
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
      const lines = await storage.getWorkOrderLines(req.params.workOrderId);
      res.json(lines);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch work order lines" });
    }
  });

  app.post("/api/work-orders/:workOrderId/lines", async (req, res) => {
    try {
      const workOrder = await storage.getWorkOrder(req.params.workOrderId);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      
      const { articleId, quantity = 1, isOptional = false, notes } = req.body;
      
      if (!articleId) {
        return res.status(400).json({ error: "articleId is required" });
      }
      
      // Resolve price using the hierarchy
      const priceInfo = await storage.resolveArticlePrice(
        DEFAULT_TENANT_ID,
        articleId,
        workOrder.customerId
      );
      
      const lineData = insertWorkOrderLineSchema.parse({
        tenantId: DEFAULT_TENANT_ID,
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
        return res.status(400).json({ error: error.errors });
      }
      console.error("Failed to create work order line:", error);
      res.status(500).json({ error: "Failed to create work order line" });
    }
  });

  app.patch("/api/work-order-lines/:id", async (req, res) => {
    try {
      const { id, tenantId, workOrderId, createdAt, ...updateData } = req.body;
      const line = await storage.updateWorkOrderLine(req.params.id, updateData);
      if (!line) return res.status(404).json({ error: "Work order line not found" });
      
      // Recalculate work order totals
      if (line.workOrderId) {
        await storage.recalculateWorkOrderTotals(line.workOrderId);
      }
      
      res.json(line);
    } catch (error) {
      res.status(500).json({ error: "Failed to update work order line" });
    }
  });

  app.delete("/api/work-order-lines/:id", async (req, res) => {
    try {
      // Get the line first to know which work order to recalculate
      const line = await storage.getWorkOrderLine(req.params.id);
      
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

  // Price Resolution API
  app.get("/api/resolve-price", async (req, res) => {
    try {
      const { articleId, customerId, date } = req.query;
      
      if (!articleId || !customerId) {
        return res.status(400).json({ error: "articleId and customerId are required" });
      }
      
      const priceInfo = await storage.resolveArticlePrice(
        DEFAULT_TENANT_ID,
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
      const scenarios = await storage.getSimulationScenarios(DEFAULT_TENANT_ID);
      res.json(scenarios);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch simulation scenarios" });
    }
  });

  app.get("/api/simulation-scenarios/:id", async (req, res) => {
    try {
      const scenario = await storage.getSimulationScenario(req.params.id);
      if (!scenario) return res.status(404).json({ error: "Simulation scenario not found" });
      res.json(scenario);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch simulation scenario" });
    }
  });

  app.post("/api/simulation-scenarios", async (req, res) => {
    try {
      const data = insertSimulationScenarioSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const scenario = await storage.createSimulationScenario(data);
      res.status(201).json(scenario);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create simulation scenario" });
    }
  });

  app.patch("/api/simulation-scenarios/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const scenario = await storage.updateSimulationScenario(req.params.id, updateData);
      if (!scenario) return res.status(404).json({ error: "Simulation scenario not found" });
      res.json(scenario);
    } catch (error) {
      res.status(500).json({ error: "Failed to update simulation scenario" });
    }
  });

  app.delete("/api/simulation-scenarios/:id", async (req, res) => {
    try {
      await storage.deleteSimulationScenario(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete simulation scenario" });
    }
  });

  // Clone orders to simulation scenario
  app.post("/api/simulation-scenarios/:id/clone-orders", async (req, res) => {
    try {
      const { orderIds } = req.body;
      const scenarioId = req.params.id;
      
      const scenario = await storage.getSimulationScenario(scenarioId);
      if (!scenario) return res.status(404).json({ error: "Simulation scenario not found" });
      
      const clonedOrders = [];
      for (const orderId of orderIds) {
        const original = await storage.getWorkOrder(orderId);
        if (!original) continue;
        
        // Clone the order with simulation flag
        const clonedOrder = await storage.createWorkOrder({
          tenantId: DEFAULT_TENANT_ID,
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
            tenantId: DEFAULT_TENANT_ID,
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
      const workOrder = await storage.getWorkOrder(req.params.id);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      
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
      const data = insertSetupTimeLogSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const log = await storage.createSetupTimeLog(data);
      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create setup time log" });
    }
  });

  app.get("/api/setup-time-logs", async (req, res) => {
    try {
      const objectId = req.query.objectId as string | undefined;
      const logs = await storage.getSetupTimeLogs(DEFAULT_TENANT_ID, objectId);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch setup time logs" });
    }
  });

  app.get("/api/procurements", async (req, res) => {
    try {
      const procurements = await storage.getProcurements(DEFAULT_TENANT_ID);
      res.json(procurements);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch procurements" });
    }
  });

  app.get("/api/procurements/:id", async (req, res) => {
    try {
      const procurement = await storage.getProcurement(req.params.id);
      if (!procurement) return res.status(404).json({ error: "Procurement not found" });
      res.json(procurement);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch procurement" });
    }
  });

  app.post("/api/procurements", async (req, res) => {
    try {
      const data = insertProcurementSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const procurement = await storage.createProcurement(data);
      res.status(201).json(procurement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create procurement" });
    }
  });

  app.patch("/api/procurements/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const procurement = await storage.updateProcurement(req.params.id, updateData);
      if (!procurement) return res.status(404).json({ error: "Procurement not found" });
      res.json(procurement);
    } catch (error) {
      res.status(500).json({ error: "Failed to update procurement" });
    }
  });

  app.delete("/api/procurements/:id", async (req, res) => {
    try {
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
          const customerData = {
            tenantId: DEFAULT_TENANT_ID,
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
          const resourceData = {
            tenantId: DEFAULT_TENANT_ID,
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
      const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
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
            tenantId: DEFAULT_TENANT_ID,
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

  // Tenant settings
  app.get("/api/tenant/settings", async (req, res) => {
    try {
      const tenant = await storage.getTenant(DEFAULT_TENANT_ID);
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
      const tenant = await storage.updateTenantSettings(DEFAULT_TENANT_ID, req.body);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      res.json({ id: tenant.id, name: tenant.name, settings: tenant.settings });
    } catch (error) {
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Export data as CSV
  app.get("/api/export/:type", async (req, res) => {
    try {
      const { type } = req.params;
      let data: Record<string, unknown>[] = [];
      let headers: string[] = [];

      if (type === "customers") {
        const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
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
        const resources = await storage.getResources(DEFAULT_TENANT_ID);
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
        const objects = await storage.getObjects(DEFAULT_TENANT_ID);
        const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
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
        delimiter: ";", // Modus uses semicolon
      });
      
      if (result.errors.length > 0) {
        return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
      }

      // Get existing customers or create them from unique Kund values
      const customerNames = new Set<string>();
      for (const row of result.data as Record<string, string>[]) {
        const kundName = row["Kund"];
        if (kundName) {
          // Extract customer name without the ID in parentheses
          const match = kundName.match(/^(.+?)\s*\(\d+\)$/);
          const cleanName = match ? match[1].trim() : kundName.trim();
          if (cleanName) customerNames.add(cleanName);
        }
      }

      // Create customers that don't exist
      const existingCustomers = await storage.getCustomers(DEFAULT_TENANT_ID);
      const customerMap = new Map(existingCustomers.map(c => [c.name.toLowerCase(), c.id]));
      
      for (const name of Array.from(customerNames)) {
        if (!customerMap.has(name.toLowerCase())) {
          const newCustomer = await storage.createCustomer({
            tenantId: DEFAULT_TENANT_ID,
            name: name,
          });
          customerMap.set(name.toLowerCase(), newCustomer.id);
        }
      }

      // Track created objects by Modus ID for parent lookups
      const modusIdMap = new Map<string, string>();
      
      const imported: string[] = [];
      const errors: string[] = [];
      const skipped: string[] = [];
      
      // First pass: create all objects without parents
      for (const row of result.data as Record<string, string>[]) {
        try {
          const modusId = row["Id"];
          const name = row["Namn"] || "";
          const typ = row["Typ"] || "Område";
          const parent = row["Parent"] || "";
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
          
          // Map object type
          let objectType = "omrade";
          const typLower = typ.toLowerCase();
          if (typLower.includes("fastighet") || typLower.includes("adress")) objectType = "fastighet";
          else if (typLower.includes("rum") || typLower.includes("soprum")) objectType = "rum";
          else if (typLower.includes("kök")) objectType = "kok";
          else if (typLower.includes("matavfall")) objectType = "matafall";
          else if (typLower.includes("återvinning")) objectType = "atervinning";
          else if (typLower.includes("uj") || typLower.includes("hushåll")) objectType = "uj_hushallsavfall";
          else if (typLower.includes("serviceboende") || typLower.includes("boende")) objectType = "serviceboende";
          
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
          
          // Determine object level
          let objectLevel = 1;
          if (parent) objectLevel = 2;
          if (objectType === "rum" || objectType === "soprum" || objectType === "kok" || 
              objectType === "matafall" || objectType === "atervinning") objectLevel = 3;
          
          const objectData = {
            tenantId: DEFAULT_TENANT_ID,
            customerId,
            parentId: null as string | null,
            name,
            objectNumber: `MODUS-${modusId}`,
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
          
          const createdObject = await storage.createObject(objectData);
          modusIdMap.set(modusId, createdObject.id);
          imported.push(name);
        } catch (err) {
          console.error("Modus object import error:", err);
          errors.push(`Fel vid import av "${row["Namn"] || "okänd"}": ${err}`);
        }
      }
      
      // Second pass: update parent references
      let parentsUpdated = 0;
      for (const row of result.data as Record<string, string>[]) {
        const modusId = row["Id"];
        const parentModusId = row["Parent"];
        
        if (modusId && parentModusId) {
          const objectId = modusIdMap.get(modusId);
          const parentId = modusIdMap.get(parentModusId);
          
          if (objectId && parentId) {
            await storage.updateObject(objectId, { parentId });
            parentsUpdated++;
          }
        }
      }
      
      res.json({ 
        imported: imported.length, 
        parentsUpdated,
        customersCreated: customerNames.size,
        skipped: skipped.length,
        errors: errors.slice(0, 20),
        totalRows: (result.data as unknown[]).length,
      });
    } catch (error) {
      console.error("Modus import error:", error);
      res.status(500).json({ error: "Modus import misslyckades", details: String(error) });
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

      // Get existing objects and customers
      const objects = await storage.getObjects(DEFAULT_TENANT_ID);
      const objectMap = new Map(objects.map(o => [o.objectNumber, o]));
      
      const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
      const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
      
      // Get or create resources from Team field
      const resources = await storage.getResources(DEFAULT_TENANT_ID);
      const resourceMap = new Map(resources.map(r => [r.name.toLowerCase(), r.id]));
      
      const imported: string[] = [];
      const errors: string[] = [];
      
      for (const row of result.data as Record<string, string>[]) {
        try {
          const uppgiftsId = row["Uppgifts Id"];
          const objekt = row["Objekt"];
          const kundRaw = row["Kund"] || "";
          const uppgiftsnamn = row["Uppgiftsnamn"] || "";
          const uppgiftstyp = row["Uppgiftstyp"] || "";
          const status = row["Status"] || "draft";
          const varaktighet = row["Varaktighet"] || "60";
          const team = row["Team"] || "";
          const planeradDagOTid = row["Planerad dag o tid"] || "";
          
          if (!uppgiftsId || !uppgiftsnamn) continue;
          
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
                tenantId: DEFAULT_TENANT_ID,
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
          
          const workOrderData = {
            tenantId: DEFAULT_TENANT_ID,
            customerId: object.customerId,
            objectId: object.id,
            resourceId,
            title: uppgiftsnamn,
            description: `Modus ID: ${uppgiftsId}, Typ: ${uppgiftstyp}`,
            orderType: uppgiftstyp.toLowerCase().includes("tvätt") ? "karlttvatt" : 
                       uppgiftstyp.toLowerCase().includes("rum") ? "rumstvatt" : "hamtning",
            priority: "normal",
            status: mappedStatus,
            scheduledDate,
            scheduledStartTime,
            estimatedDuration: parseInt(varaktighet) || 60,
            metadata: { modusId: uppgiftsId },
          };
          
          await storage.createWorkOrder(workOrderData);
          imported.push(uppgiftsnamn);
        } catch (err) {
          errors.push(`Fel vid import av uppgift: ${err}`);
        }
      }
      
      res.json({ 
        imported: imported.length, 
        errors: errors.slice(0, 20),
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

  // ============== ARTICLES ==============
  app.get("/api/articles", async (req, res) => {
    try {
      const articles = await storage.getArticles(DEFAULT_TENANT_ID);
      res.json(articles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch articles" });
    }
  });

  app.get("/api/articles/:id", async (req, res) => {
    try {
      const article = await storage.getArticle(req.params.id);
      if (!article) return res.status(404).json({ error: "Article not found" });
      res.json(article);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch article" });
    }
  });

  app.post("/api/articles", async (req, res) => {
    try {
      const data = insertArticleSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const article = await storage.createArticle(data);
      res.status(201).json(article);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create article" });
    }
  });

  app.patch("/api/articles/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const article = await storage.updateArticle(req.params.id, updateData);
      if (!article) return res.status(404).json({ error: "Article not found" });
      res.json(article);
    } catch (error) {
      res.status(500).json({ error: "Failed to update article" });
    }
  });

  app.delete("/api/articles/:id", async (req, res) => {
    try {
      await storage.deleteArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete article" });
    }
  });

  // ============== PRICE LISTS ==============
  app.get("/api/price-lists", async (req, res) => {
    try {
      const priceLists = await storage.getPriceLists(DEFAULT_TENANT_ID);
      res.json(priceLists);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price lists" });
    }
  });

  app.get("/api/price-lists/:id", async (req, res) => {
    try {
      const priceList = await storage.getPriceList(req.params.id);
      if (!priceList) return res.status(404).json({ error: "Price list not found" });
      res.json(priceList);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price list" });
    }
  });

  app.post("/api/price-lists", async (req, res) => {
    try {
      const data = insertPriceListSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const priceList = await storage.createPriceList(data);
      res.status(201).json(priceList);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create price list" });
    }
  });

  app.patch("/api/price-lists/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const priceList = await storage.updatePriceList(req.params.id, updateData);
      if (!priceList) return res.status(404).json({ error: "Price list not found" });
      res.json(priceList);
    } catch (error) {
      res.status(500).json({ error: "Failed to update price list" });
    }
  });

  app.delete("/api/price-lists/:id", async (req, res) => {
    try {
      await storage.deletePriceList(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete price list" });
    }
  });

  // ============== PRICE LIST ARTICLES ==============
  app.get("/api/price-lists/:priceListId/articles", async (req, res) => {
    try {
      const priceListArticles = await storage.getPriceListArticles(req.params.priceListId);
      res.json(priceListArticles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price list articles" });
    }
  });

  app.post("/api/price-lists/:priceListId/articles", async (req, res) => {
    try {
      const data = insertPriceListArticleSchema.parse({ ...req.body, priceListId: req.params.priceListId });
      const priceListArticle = await storage.createPriceListArticle(data);
      res.status(201).json(priceListArticle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create price list article" });
    }
  });

  app.patch("/api/price-list-articles/:id", async (req, res) => {
    try {
      const { id, priceListId, articleId, createdAt, ...updateData } = req.body;
      const priceListArticle = await storage.updatePriceListArticle(req.params.id, updateData);
      if (!priceListArticle) return res.status(404).json({ error: "Price list article not found" });
      res.json(priceListArticle);
    } catch (error) {
      res.status(500).json({ error: "Failed to update price list article" });
    }
  });

  app.delete("/api/price-list-articles/:id", async (req, res) => {
    try {
      await storage.deletePriceListArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete price list article" });
    }
  });

  // ============== RESOURCE ARTICLES (TIDSVERK) ==============
  app.get("/api/resources/:resourceId/articles", async (req, res) => {
    try {
      const resourceArticles = await storage.getResourceArticles(req.params.resourceId);
      res.json(resourceArticles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource articles" });
    }
  });

  app.post("/api/resources/:resourceId/articles", async (req, res) => {
    try {
      const data = insertResourceArticleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
      const resourceArticle = await storage.createResourceArticle(data);
      res.status(201).json(resourceArticle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create resource article" });
    }
  });

  app.patch("/api/resource-articles/:id", async (req, res) => {
    try {
      const { id, resourceId, articleId, createdAt, ...updateData } = req.body;
      const resourceArticle = await storage.updateResourceArticle(req.params.id, updateData);
      if (!resourceArticle) return res.status(404).json({ error: "Resource article not found" });
      res.json(resourceArticle);
    } catch (error) {
      res.status(500).json({ error: "Failed to update resource article" });
    }
  });

  app.delete("/api/resource-articles/:id", async (req, res) => {
    try {
      await storage.deleteResourceArticle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource article" });
    }
  });

  // Delete all data (for re-import)
  app.delete("/api/import/clear/:type", async (req, res) => {
    try {
      const { type } = req.params;
      
      if (type === "customers") {
        const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
        for (const c of customers) {
          await storage.deleteCustomer(c.id);
        }
        res.json({ deleted: customers.length });
      } else if (type === "resources") {
        const resources = await storage.getResources(DEFAULT_TENANT_ID);
        for (const r of resources) {
          await storage.deleteResource(r.id);
        }
        res.json({ deleted: resources.length });
      } else if (type === "objects") {
        const objects = await storage.getObjects(DEFAULT_TENANT_ID);
        for (const o of objects) {
          await storage.deleteObject(o.id);
        }
        res.json({ deleted: objects.length });
      } else if (type === "work-orders") {
        const workOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID);
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

  return httpServer;
}
