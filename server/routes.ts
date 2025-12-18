import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertCustomerSchema, insertObjectSchema, insertResourceSchema, 
  insertWorkOrderSchema, insertSetupTimeLogSchema, insertTenantSchema, insertProcurementSchema 
} from "@shared/schema";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import multer from "multer";
import Papa from "papaparse";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
      
      // Convert scheduledDate string to Date object if present
      if (updateData.scheduledDate && typeof updateData.scheduledDate === 'string') {
        updateData.scheduledDate = new Date(updateData.scheduledDate + 'T00:00:00');
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
