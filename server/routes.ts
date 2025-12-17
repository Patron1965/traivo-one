import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCustomerSchema, insertObjectSchema, insertResourceSchema, 
  insertWorkOrderSchema, insertSetupTimeLogSchema, insertTenantSchema 
} from "@shared/schema";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

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
      const objects = await storage.getObjects(DEFAULT_TENANT_ID);
      res.json(objects);
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
      const workOrders = await storage.getWorkOrders(DEFAULT_TENANT_ID);
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
      const data = insertWorkOrderSchema.parse({ ...req.body, tenantId: DEFAULT_TENANT_ID });
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
      const workOrder = await storage.updateWorkOrder(req.params.id, updateData);
      if (!workOrder) return res.status(404).json({ error: "Work order not found" });
      res.json(workOrder);
    } catch (error) {
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

  return httpServer;
}
