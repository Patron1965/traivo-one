import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCustomerSchema, insertObjectSchema, insertResourceSchema, 
  insertWorkOrderSchema, insertSetupTimeLogSchema, insertTenantSchema, insertProcurementSchema,
  insertArticleSchema, insertPriceListSchema, insertPriceListArticleSchema, insertResourceArticleSchema,
  insertWorkOrderLineSchema, insertSimulationScenarioSchema, ORDER_STATUSES, type OrderStatus,
  insertVehicleSchema, insertEquipmentSchema, insertResourceVehicleSchema, insertResourceEquipmentSchema,
  insertResourceAvailabilitySchema, insertVehicleScheduleSchema, insertSubscriptionSchema,
  insertTeamSchema, insertTeamMemberSchema, insertPlanningParameterSchema, insertClusterSchema
} from "@shared/schema";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import multer from "multer";
import Papa from "papaparse";
import { notificationService } from "./notifications";
import { handleMcpSse, handleMcpMessage } from "./mcp";
import { hashPassword } from "./password";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

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
  return storage.ensureTenant(DEFAULT_TENANT_ID, {
    name: "Kinab AB",
    orgNumber: "556789-1234",
    contactEmail: "info@kinab.se",
    contactPhone: "+46701234567",
    settings: {},
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize WebSocket notification service
  notificationService.initialize(httpServer);
  
  await setupAuth(app);
  registerAuthRoutes(app);
  
  await ensureDefaultTenant();

  // Object Storage routes for file uploads
  registerObjectStorageRoutes(app);

  // MCP Server endpoints
  app.get("/mcp/sse", handleMcpSse);
  app.post("/mcp/messages", handleMcpMessage);

  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getCustomers(DEFAULT_TENANT_ID);
      res.json(customers);
    } catch (error) {
      console.error("Failed to fetch customers:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) return res.status(404).json({ error: "Customer not found" });
      res.json(customer);
    } catch (error) {
      console.error("Failed to fetch customer:", error);
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
      console.error("Failed to create customer:", error);
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
      console.error("Failed to update customer:", error);
      res.status(500).json({ error: "Failed to update customer" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      await storage.deleteCustomer(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete customer:", error);
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
      console.error("Failed to fetch objects:", error);
      res.status(500).json({ error: "Failed to fetch objects" });
    }
  });

  app.get("/api/objects/:id", async (req, res) => {
    try {
      const object = await storage.getObject(req.params.id);
      if (!object) return res.status(404).json({ error: "Object not found" });
      res.json(object);
    } catch (error) {
      console.error("Failed to fetch object:", error);
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
      console.error("Failed to create object:", error);
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
      console.error("Failed to update object:", error);
      res.status(500).json({ error: "Failed to update object" });
    }
  });

  app.delete("/api/objects/:id", async (req, res) => {
    try {
      await storage.deleteObject(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete object:", error);
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
      console.error("Failed to create resource:", error);
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
      console.error("Failed to update resource:", error);
      res.status(500).json({ error: "Failed to update resource" });
    }
  });

  app.delete("/api/resources/:id", async (req, res) => {
    try {
      await storage.deleteResource(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete resource:", error);
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
      
      // Notify resource if order is assigned immediately
      if (workOrder.resourceId) {
        notificationService.notifyJobAssigned(workOrder, workOrder.resourceId);
      }
      
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
      
      // Get existing order to detect changes
      const existingOrder = await storage.getWorkOrder(req.params.id);
      if (!existingOrder) return res.status(404).json({ error: "Work order not found" });
      
      // Convert scheduledDate string to Date object if present (use UTC to prevent timezone shift)
      if (updateData.scheduledDate && typeof updateData.scheduledDate === 'string') {
        updateData.scheduledDate = new Date(updateData.scheduledDate + 'T12:00:00Z');
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
      const settingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]));
      const parseResult = settingsSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors });
      }
      const tenant = await storage.updateTenantSettings(DEFAULT_TENANT_ID, parseResult.data);
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

  // ============== VEHICLES ==============
  app.get("/api/vehicles", async (req, res) => {
    try {
      const vehicles = await storage.getVehicles(DEFAULT_TENANT_ID);
      res.json(vehicles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicles" });
    }
  });

  app.get("/api/vehicles/:id", async (req, res) => {
    try {
      const vehicle = await storage.getVehicle(req.params.id);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      res.json(vehicle);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle" });
    }
  });

  app.post("/api/vehicles", async (req, res) => {
    try {
      const data = insertVehicleSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const vehicle = await storage.createVehicle(data);
      res.status(201).json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create vehicle" });
    }
  });

  app.patch("/api/vehicles/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const vehicle = await storage.updateVehicle(req.params.id, updateData);
      if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
      res.json(vehicle);
    } catch (error) {
      res.status(500).json({ error: "Failed to update vehicle" });
    }
  });

  app.delete("/api/vehicles/:id", async (req, res) => {
    try {
      await storage.deleteVehicle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete vehicle" });
    }
  });

  // ============== EQUIPMENT ==============
  app.get("/api/equipment", async (req, res) => {
    try {
      const equipment = await storage.getEquipment(DEFAULT_TENANT_ID);
      res.json(equipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch equipment" });
    }
  });

  app.get("/api/equipment/:id", async (req, res) => {
    try {
      const equipment = await storage.getEquipmentById(req.params.id);
      if (!equipment) return res.status(404).json({ error: "Equipment not found" });
      res.json(equipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch equipment" });
    }
  });

  app.post("/api/equipment", async (req, res) => {
    try {
      const data = insertEquipmentSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const equipment = await storage.createEquipment(data);
      res.status(201).json(equipment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create equipment" });
    }
  });

  app.patch("/api/equipment/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const equipment = await storage.updateEquipment(req.params.id, updateData);
      if (!equipment) return res.status(404).json({ error: "Equipment not found" });
      res.json(equipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to update equipment" });
    }
  });

  app.delete("/api/equipment/:id", async (req, res) => {
    try {
      await storage.deleteEquipment(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete equipment" });
    }
  });

  // ============== RESOURCE AVAILABILITY ==============
  app.get("/api/resource-availability/:resourceId", async (req, res) => {
    try {
      const availability = await storage.getResourceAvailability(req.params.resourceId);
      res.json(availability);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource availability" });
    }
  });

  app.get("/api/resource-availability-item/:id", async (req, res) => {
    try {
      const item = await storage.getResourceAvailabilityById(req.params.id);
      if (!item) return res.status(404).json({ error: "Resource availability not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource availability" });
    }
  });

  app.post("/api/resource-availability/:resourceId", async (req, res) => {
    try {
      const data = insertResourceAvailabilitySchema.parse({ 
        ...req.body, 
        tenantId: DEFAULT_TENANT_ID, 
        resourceId: req.params.resourceId 
      });
      const item = await storage.createResourceAvailability(data);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create resource availability" });
    }
  });

  app.patch("/api/resource-availability-item/:id", async (req, res) => {
    try {
      const { tenantId, id, resourceId, createdAt, ...updateData } = req.body;
      const item = await storage.updateResourceAvailability(req.params.id, updateData);
      if (!item) return res.status(404).json({ error: "Resource availability not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to update resource availability" });
    }
  });

  app.delete("/api/resource-availability-item/:id", async (req, res) => {
    try {
      await storage.deleteResourceAvailability(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource availability" });
    }
  });

  // ============== VEHICLE SCHEDULE ==============
  app.get("/api/vehicle-schedule/:vehicleId", async (req, res) => {
    try {
      const schedule = await storage.getVehicleSchedule(req.params.vehicleId);
      res.json(schedule);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle schedule" });
    }
  });

  app.get("/api/vehicle-schedule-item/:id", async (req, res) => {
    try {
      const item = await storage.getVehicleScheduleById(req.params.id);
      if (!item) return res.status(404).json({ error: "Vehicle schedule not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch vehicle schedule" });
    }
  });

  app.post("/api/vehicle-schedule/:vehicleId", async (req, res) => {
    try {
      const data = insertVehicleScheduleSchema.parse({ 
        ...req.body, 
        tenantId: DEFAULT_TENANT_ID, 
        vehicleId: req.params.vehicleId 
      });
      const item = await storage.createVehicleSchedule(data);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create vehicle schedule" });
    }
  });

  app.patch("/api/vehicle-schedule-item/:id", async (req, res) => {
    try {
      const { tenantId, id, vehicleId, createdAt, ...updateData } = req.body;
      const item = await storage.updateVehicleSchedule(req.params.id, updateData);
      if (!item) return res.status(404).json({ error: "Vehicle schedule not found" });
      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "Failed to update vehicle schedule" });
    }
  });

  app.delete("/api/vehicle-schedule-item/:id", async (req, res) => {
    try {
      await storage.deleteVehicleSchedule(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete vehicle schedule" });
    }
  });

  // ============== SUBSCRIPTIONS ==============
  app.get("/api/subscriptions", async (req, res) => {
    try {
      const subscriptions = await storage.getSubscriptions(DEFAULT_TENANT_ID);
      res.json(subscriptions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  });

  app.get("/api/subscriptions/:id", async (req, res) => {
    try {
      const subscription = await storage.getSubscription(req.params.id);
      if (!subscription) return res.status(404).json({ error: "Subscription not found" });
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subscription" });
    }
  });

  app.post("/api/subscriptions", async (req, res) => {
    try {
      const data = insertSubscriptionSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const subscription = await storage.createSubscription(data);
      res.status(201).json(subscription);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });

  app.patch("/api/subscriptions/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
      const subscription = await storage.updateSubscription(req.params.id, updateData);
      if (!subscription) return res.status(404).json({ error: "Subscription not found" });
      res.json(subscription);
    } catch (error) {
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });

  app.delete("/api/subscriptions/:id", async (req, res) => {
    try {
      await storage.deleteSubscription(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete subscription" });
    }
  });

  // Generate orders from active subscriptions
  app.post("/api/subscriptions/generate-orders", async (req, res) => {
    try {
      const subscriptions = await storage.getSubscriptions(DEFAULT_TENANT_ID);
      const now = new Date();
      let generatedCount = 0;

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
            tenantId: DEFAULT_TENANT_ID,
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

          // Calculate next generation date
          let nextDate = new Date(nextGenDate);
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
      const teams = await storage.getTeams(DEFAULT_TENANT_ID);
      res.json(teams);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch teams" });
    }
  });

  app.get("/api/teams/:id", async (req, res) => {
    try {
      const team = await storage.getTeam(req.params.id);
      if (!team) return res.status(404).json({ error: "Team not found" });
      res.json(team);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team" });
    }
  });

  app.post("/api/teams", async (req, res) => {
    try {
      const data = insertTeamSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const team = await storage.createTeam(data);
      res.status(201).json(team);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create team" });
    }
  });

  app.patch("/api/teams/:id", async (req, res) => {
    try {
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
      await storage.deleteTeam(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete team" });
    }
  });

  // ============== TEAM MEMBERS ==============
  app.get("/api/team-members/:teamId", async (req, res) => {
    try {
      const members = await storage.getTeamMembers(req.params.teamId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team members" });
    }
  });

  app.get("/api/team-member/:id", async (req, res) => {
    try {
      const member = await storage.getTeamMember(req.params.id);
      if (!member) return res.status(404).json({ error: "Team member not found" });
      res.json(member);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch team member" });
    }
  });

  app.post("/api/team-members/:teamId", async (req, res) => {
    try {
      const data = insertTeamMemberSchema.parse({ ...req.body, teamId: req.params.teamId });
      const member = await storage.createTeamMember(data);
      res.status(201).json(member);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create team member" });
    }
  });

  app.patch("/api/team-member/:id", async (req, res) => {
    try {
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
      await storage.deleteTeamMember(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete team member" });
    }
  });

  // ============== PLANNING PARAMETERS ==============
  app.get("/api/planning-parameters", async (req, res) => {
    try {
      const params = await storage.getPlanningParameters(DEFAULT_TENANT_ID);
      res.json(params);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch planning parameters" });
    }
  });

  app.get("/api/planning-parameters/:id", async (req, res) => {
    try {
      const param = await storage.getPlanningParameter(req.params.id);
      if (!param) return res.status(404).json({ error: "Planning parameter not found" });
      res.json(param);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch planning parameter" });
    }
  });

  app.post("/api/planning-parameters", async (req, res) => {
    try {
      const data = insertPlanningParameterSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const param = await storage.createPlanningParameter(data);
      res.status(201).json(param);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create planning parameter" });
    }
  });

  app.patch("/api/planning-parameters/:id", async (req, res) => {
    try {
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
      await storage.deletePlanningParameter(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete planning parameter" });
    }
  });

  // ============== RESOURCE VEHICLES ==============
  app.get("/api/resources/:resourceId/vehicles", async (req, res) => {
    try {
      const resourceVehicles = await storage.getResourceVehicles(req.params.resourceId);
      res.json(resourceVehicles);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource vehicles" });
    }
  });

  app.post("/api/resources/:resourceId/vehicles", async (req, res) => {
    try {
      const data = insertResourceVehicleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
      const rv = await storage.createResourceVehicle(data);
      res.status(201).json(rv);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create resource vehicle" });
    }
  });

  app.patch("/api/resource-vehicles/:id", async (req, res) => {
    try {
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
      await storage.deleteResourceVehicle(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource vehicle" });
    }
  });

  // ============== RESOURCE EQUIPMENT ==============
  app.get("/api/resources/:resourceId/equipment", async (req, res) => {
    try {
      const resourceEquipment = await storage.getResourceEquipment(req.params.resourceId);
      res.json(resourceEquipment);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch resource equipment" });
    }
  });

  app.post("/api/resources/:resourceId/equipment", async (req, res) => {
    try {
      const data = insertResourceEquipmentSchema.parse({ ...req.body, resourceId: req.params.resourceId });
      const re = await storage.createResourceEquipment(data);
      res.status(201).json(re);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create resource equipment" });
    }
  });

  app.patch("/api/resource-equipment/:id", async (req, res) => {
    try {
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
      await storage.deleteResourceEquipment(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete resource equipment" });
    }
  });

  // ============== CLUSTERS - NAVET I VERKSAMHETEN ==============
  app.get("/api/clusters", async (req, res) => {
    try {
      const clusters = await storage.getClusters(DEFAULT_TENANT_ID);
      res.json(clusters);
    } catch (error) {
      console.error("Failed to fetch clusters:", error);
      res.status(500).json({ error: "Kunde inte hämta kluster" });
    }
  });

  app.get("/api/clusters/:id", async (req, res) => {
    try {
      const cluster = await storage.getClusterWithStats(req.params.id);
      if (!cluster) return res.status(404).json({ error: "Kluster hittades inte" });
      res.json(cluster);
    } catch (error) {
      console.error("Failed to fetch cluster:", error);
      res.status(500).json({ error: "Kunde inte hämta kluster" });
    }
  });

  app.post("/api/clusters", async (req, res) => {
    try {
      const data = insertClusterSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
      const cluster = await storage.createCluster(data);
      res.status(201).json(cluster);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Failed to create cluster:", error);
      res.status(500).json({ error: "Kunde inte skapa kluster" });
    }
  });

  app.patch("/api/clusters/:id", async (req, res) => {
    try {
      const { tenantId, id, createdAt, deletedAt, ...updateData } = req.body;
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
      const objects = await storage.getClusterObjects(req.params.id);
      res.json(objects);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta objekt i kluster" });
    }
  });

  app.get("/api/clusters/:id/work-orders", async (req, res) => {
    try {
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
      const subscriptions = await storage.getClusterSubscriptions(req.params.id);
      res.json(subscriptions);
    } catch (error) {
      res.status(500).json({ error: "Kunde inte hämta abonnemang i kluster" });
    }
  });

  app.post("/api/clusters/:id/refresh-cache", async (req, res) => {
    try {
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
      const { question, context } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Fråga krävs" });
      }

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();

      // Fetch contextual data based on current module
      let moduleData = "";
      const moduleName = context?.module || "Generell";
      const modulePath = context?.path || "/";

      try {
        if (modulePath.startsWith("/economics")) {
          const workOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID);
          const completed = workOrders.filter(wo => wo.status === "completed" || wo.orderStatus === "utford").length;
          const pending = workOrders.filter(wo => wo.status !== "completed" && wo.orderStatus !== "utford").length;
          moduleData = `Ekonomisk översikt: ${workOrders.length} ordrar totalt, ${completed} utförda, ${pending} väntande`;
        } else if (modulePath.startsWith("/vehicles")) {
          const vehicles = await storage.getVehicles(DEFAULT_TENANT_ID);
          moduleData = `Fordonsflotta: ${vehicles.length} fordon registrerade`;
        } else if (modulePath.startsWith("/weather")) {
          moduleData = "Väderplanering: AI-stöd för att anpassa schemaläggning baserat på väderförhållanden";
        } else if (modulePath.startsWith("/subscriptions")) {
          const subscriptions = await storage.getSubscriptions(DEFAULT_TENANT_ID);
          const active = subscriptions.filter(s => s.status === "active").length;
          moduleData = `Abonnemang: ${subscriptions.length} totalt, ${active} aktiva`;
        } else if (modulePath.startsWith("/articles")) {
          const articles = await storage.getArticles(DEFAULT_TENANT_ID);
          moduleData = `Artiklar: ${articles.length} artiklar i systemet`;
        } else {
          const clusters = await storage.getClusters(DEFAULT_TENANT_ID);
          const workOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID);
          moduleData = `System: ${clusters.length} kluster, ${workOrders.length} ordrar`;
        }
      } catch (e) {
        moduleData = "Kunde inte hämta moduldata";
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du är en AI-assistent för Unicorn, en fältserviceoptimerings-plattform för avfallshantering och sophantering i Sverige. Användaren är på modulen "${moduleName}". 

Aktuell kontext: ${moduleData}

Svara alltid på svenska. Var hjälpsam och konkret. Fokusera på praktiska tips för optimering och effektivisering. Om frågan är utanför systemets scope, föreslå att användaren kontaktar support.`,
          },
          {
            role: "user",
            content: question,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || "Kunde inte generera ett svar.";
      res.json({ answer });
    } catch (error) {
      console.error("AI Chat error:", error);
      res.status(500).json({ error: "Kunde inte behandla frågan" });
    }
  });

  // AI Field Assistant - conversational AI for field workers with location awareness
  app.post("/api/ai/field-assistant", async (req, res) => {
    try {
      const { question, context } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "Fråga krävs" });
      }

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI();

      // Build rich context from the request
      let contextInfo = "";
      
      // Resource/worker info
      if (context?.resourceName) {
        contextInfo += `Fältarbetare: ${context.resourceName}\n`;
      }
      
      // Location info - with defensive checks for all numeric fields
      if (context?.position && 
          typeof context.position.latitude === 'number' && 
          typeof context.position.longitude === 'number') {
        const lat = context.position.latitude.toFixed(4);
        const lng = context.position.longitude.toFixed(4);
        const acc = typeof context.position.accuracy === 'number' ? Math.round(context.position.accuracy) : '?';
        contextInfo += `Din position: ${lat}, ${lng} (noggrannhet: ${acc}m)\n`;
      }
      
      // Today's jobs summary
      if (context?.todayJobsCount !== undefined || context?.completedJobsCount !== undefined) {
        contextInfo += `Dagens uppdrag: ${context.todayJobsCount || 0} kvar, ${context.completedJobsCount || 0} klara\n`;
      }
      
      // Current job context
      if (context?.currentJob) {
        contextInfo += `\nAktuellt jobb:\n`;
        contextInfo += `- Titel: ${context.currentJob.title || "Okänt"}\n`;
        contextInfo += `- Adress: ${context.currentJob.address || "Okänd"}\n`;
        if (context.currentJob.customer) {
          contextInfo += `- Kund: ${context.currentJob.customer}\n`;
        }
      }
      
      // Nearby jobs
      if (context?.nearbyJobs && context.nearbyJobs.length > 0) {
        contextInfo += `\nNästa uppdrag i ordning:\n`;
        context.nearbyJobs.forEach((job: { title: string; address: string }, i: number) => {
          contextInfo += `${i + 1}. ${job.title} - ${job.address || "Adress saknas"}\n`;
        });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du är en personlig AI-assistent för fältarbetare inom fältservice (avfall, underhåll, service). Du pratar vänligt och hjälpsamt, som en kollega.

DITT UPPDRAG:
- Hjälpa fältarbetaren med dagens arbete
- Ge praktiska tips baserat på position och uppdrag
- Svara på frågor om jobb, kunder, och rutter
- Vara proaktiv med förslag när det är relevant

KONTEXT:
${contextInfo || "Ingen specifik kontext tillgänglig."}

RIKTLINJER:
- Svara på svenska
- Var vänlig och personlig (använd "du")
- Håll svaren korta men hjälpsamma (2-4 meningar)
- Om frågan handlar om "nästa jobb" eller "vart ska jag", ge konkret vägledning
- Om du inte vet, säg det ärligt och föreslå vem som kan hjälpa

Du kan ge tips som:
- "Ditt nästa jobb är på [adress]. Vill du att jag öppnar navigation?"
- "Du har 3 uppdrag kvar idag. Det närmaste är..."
- "Portkoden till denna adress är [kod]."`,
          },
          {
            role: "user",
            content: question,
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || "Jag vet inte just nu. Fråga din arbetsledare.";
      res.json({ answer });
    } catch (error) {
      console.error("Field AI error:", error);
      res.status(500).json({ error: "Något gick fel" });
    }
  });

  // AI Planning suggestions
  app.post("/api/ai/planning-suggestions", async (req, res) => {
    try {
      const { generatePlanningSuggestions } = await import("./ai-planner");
      const { weekStart, weekEnd } = req.body;
      
      const [workOrders, resources, clusters] = await Promise.all([
        storage.getWorkOrders(DEFAULT_TENANT_ID),
        storage.getResources(DEFAULT_TENANT_ID),
        storage.getClusters(DEFAULT_TENANT_ID),
      ]);
      
      const suggestions = await generatePlanningSuggestions({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      });
      
      res.json(suggestions);
    } catch (error) {
      console.error("AI Planning error:", error);
      res.status(500).json({ error: "Kunde inte generera planeringsförslag" });
    }
  });

  // AI Auto-Schedule - automatisk schemaläggning av oschemalagda ordrar
  app.post("/api/ai/auto-schedule", async (req, res) => {
    try {
      const { aiEnhancedSchedule } = await import("./ai-planner");
      const { weekStart, weekEnd } = req.body;
      
      const [workOrders, resources, clusters] = await Promise.all([
        storage.getWorkOrders(DEFAULT_TENANT_ID),
        storage.getResources(DEFAULT_TENANT_ID),
        storage.getClusters(DEFAULT_TENANT_ID),
      ]);
      
      const result = await aiEnhancedSchedule({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
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
      
      const [workOrders, resources, objects] = await Promise.all([
        storage.getWorkOrders(DEFAULT_TENANT_ID),
        storage.getResources(DEFAULT_TENANT_ID),
        storage.getObjects(DEFAULT_TENANT_ID),
      ]);
      
      const result = await optimizeDayRoutes(date, workOrders, resources, objects);
      res.json(result);
    } catch (error) {
      console.error("Route optimization error:", error);
      res.status(500).json({ error: "Kunde inte optimera rutter" });
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
      
      const [workOrders, resources, clusters] = await Promise.all([
        storage.getWorkOrders(DEFAULT_TENANT_ID),
        storage.getResources(DEFAULT_TENANT_ID),
        storage.getClusters(DEFAULT_TENANT_ID),
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

  // AI Setup Time Insights
  app.get("/api/ai/setup-insights", async (req, res) => {
    try {
      const { analyzeSetupTimeLogs } = await import("./ai-planner");
      
      const [logs, objects, clusters] = await Promise.all([
        storage.getSetupTimeLogs(DEFAULT_TENANT_ID),
        storage.getObjects(DEFAULT_TENANT_ID),
        storage.getClusters(DEFAULT_TENANT_ID),
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
      const workOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID, undefined, undefined, true, 5000);
      const clusters = await storage.getClusters(DEFAULT_TENANT_ID);
      const resources = await storage.getResources(DEFAULT_TENANT_ID);
      
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
      const cluster = await storage.getCluster(req.params.clusterId);
      if (!cluster) {
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

  // AI Auto-Clustering - Föreslå optimala klustergränser
  app.get("/api/ai/auto-cluster", async (req, res) => {
    try {
      const targetSize = parseInt(req.query.targetSize as string) || 50;
      
      const { generateAutoClusterSuggestions } = await import("./ai-planner");
      const objects = await storage.getObjects(DEFAULT_TENANT_ID);
      const clusters = await storage.getClusters(DEFAULT_TENANT_ID);
      
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
            tenantId: DEFAULT_TENANT_ID,
            name: String(suggestion.suggestedName).trim(),
            description: String(suggestion.rationale || "").trim() || null,
            centerLatitude: typeof suggestion.centerLatitude === "number" ? suggestion.centerLatitude : null,
            centerLongitude: typeof suggestion.centerLongitude === "number" ? suggestion.centerLongitude : null,
            radiusKm: typeof suggestion.radiusKm === "number" ? suggestion.radiusKm : 5,
            postalCodes: suggestion.postalCodes.map((pc: unknown) => String(pc)),
            color: typeof suggestion.color === "string" ? suggestion.color : "#3B82F6",
            slaLevel: "standard",
            defaultPeriodicity: "vecka",
            status: "active"
          });
          createdClusters.push(cluster);
        } catch (err) {
          errors.push(`${suggestion.suggestedName}: Kunde inte skapa kluster`);
        }
      }
      
      res.json({ 
        success: createdClusters.length > 0, 
        message: errors.length > 0
          ? `Skapade ${createdClusters.length} kluster. ${errors.length} fel uppstod.`
          : `Skapade ${createdClusters.length} nya kluster.`,
        clusters: createdClusters,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Apply auto-cluster error:", error);
      res.status(500).json({ error: "Kunde inte skapa kluster" });
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
      if (resource.tenantId !== DEFAULT_TENANT_ID) {
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
      const { email, pin } = req.body;
      
      if (!email || !pin) {
        return res.status(400).json({ error: "Email and PIN required" });
      }
      
      // Find resource by email
      const resources = await storage.getResources(DEFAULT_TENANT_ID);
      const resource = resources.find(r => 
        r.email?.toLowerCase() === email.toLowerCase() && r.status === 'active'
      );
      
      if (!resource) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // For demo purposes, accept any 4-digit PIN
      // In production, you would store and validate PINs properly
      if (pin.length < 4 || pin.length > 6) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      // Generate token
      const token = generateMobileToken();
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
      
      mobileTokens.set(token, { resourceId: resource.id, expiresAt });
      
      console.log(`[mobile] Login successful for resource ${resource.name} (${resource.id})`);
      
      res.json({
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
        },
        token,
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
      const allOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID);
      
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
      
      res.json({
        orders: enrichedOrders,
        total: enrichedOrders.length,
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
      
      if (status === 'paborjad') {
        // Use 'in_progress' status that the mobile app can recognize
        updateData.status = 'in_progress';
        updateData.orderStatus = 'planerad_resurs';
      } else if (status === 'utford') {
        updateData.status = 'completed';
        updateData.orderStatus = 'utford';
        updateData.completedAt = new Date();
      } else if (status === 'ej_utford') {
        updateData.status = 'cancelled';
        updateData.orderStatus = 'skapad';
        if (notes) {
          updateData.notes = order.notes 
            ? `${order.notes}\n\nEj utförd: ${notes}` 
            : `Ej utförd: ${notes}`;
        }
      }
      
      const updatedOrder = await storage.updateWorkOrder(orderId, updateData);
      
      console.log(`[mobile] Order ${orderId} status updated to ${status} by resource ${resourceId}`);
      
      res.json(updatedOrder);
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
      const branding = await storage.getTenantBranding(DEFAULT_TENANT_ID);
      res.json(branding || null);
    } catch (error) {
      console.error("Failed to fetch tenant branding:", error);
      res.status(500).json({ error: "Failed to fetch branding" });
    }
  });

  // Tenant Branding - Update or create branding
  app.put("/api/system/tenant-branding", async (req, res) => {
    try {
      const { templateId, ...brandingData } = req.body;
      
      let existing = await storage.getTenantBranding(DEFAULT_TENANT_ID);
      
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
        result = await storage.updateTenantBranding(DEFAULT_TENANT_ID, brandingData);
      } else {
        result = await storage.createTenantBranding({ 
          tenantId: DEFAULT_TENANT_ID, 
          ...brandingData 
        });
      }
      
      // Create audit log
      await storage.createAuditLog({
        tenantId: DEFAULT_TENANT_ID,
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

  // Tenant Branding - Publish branding
  app.post("/api/system/tenant-branding/publish", async (req, res) => {
    try {
      const result = await storage.publishTenantBranding(DEFAULT_TENANT_ID);
      
      if (!result) {
        return res.status(404).json({ error: "Branding not found" });
      }
      
      await storage.createAuditLog({
        tenantId: DEFAULT_TENANT_ID,
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

  // User Tenant Roles - List all users with roles for current tenant
  app.get("/api/system/user-roles", async (req, res) => {
    try {
      const roles = await storage.getUserTenantRoles(DEFAULT_TENANT_ID);
      res.json(roles);
    } catch (error) {
      console.error("Failed to fetch user roles:", error);
      res.status(500).json({ error: "Failed to fetch user roles" });
    }
  });

  // User Tenant Roles - Create new user role
  app.post("/api/system/user-roles", async (req, res) => {
    try {
      const { userId, name, role, permissions, password } = req.body;
      
      if (!userId || !role) {
        return res.status(400).json({ error: "userId and role are required" });
      }
      
      // Check if user already has a role
      const existing = await storage.getUserTenantRole(userId, DEFAULT_TENANT_ID);
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
        tenantId: DEFAULT_TENANT_ID,
        role,
        permissions: permissions || [],
        isActive: true,
      });
      
      await storage.createAuditLog({
        tenantId: DEFAULT_TENANT_ID,
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

  // User Tenant Roles - Update role
  app.patch("/api/system/user-roles/:id", async (req, res) => {
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
      
      await storage.createAuditLog({
        tenantId: DEFAULT_TENANT_ID,
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
  app.post("/api/system/user-roles/import", async (req, res) => {
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
        
        // Check if user already has a role
        const existing = await storage.getUserTenantRole(userId, DEFAULT_TENANT_ID);
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
          tenantId: DEFAULT_TENANT_ID,
          role,
          permissions: [],
          isActive: true,
        });
        imported++;
      }
      
      await storage.createAuditLog({
        tenantId: DEFAULT_TENANT_ID,
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
  app.delete("/api/system/user-roles/:id", async (req, res) => {
    try {
      await storage.createAuditLog({
        tenantId: DEFAULT_TENANT_ID,
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

  // Audit Logs - Get logs for current tenant
  app.get("/api/system/audit-logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const action = req.query.action as string;
      const userId = req.query.userId as string;
      
      const logs = await storage.getAuditLogs(DEFAULT_TENANT_ID, { limit, offset, action, userId });
      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  return httpServer;
}
