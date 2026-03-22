import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { objects, workOrders, customerCommunications, objectContacts } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek, getDateFromWeekdayInMonth } from "./helpers";

export async function registerOrderConceptRoutes(app: Express) {
// ============================================
// ORDER CONCEPT WIZARD API
// ============================================

app.get("/api/order-concepts/:id/wizard", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const [conceptObjects, conceptArticles, mappings, invoiceConfig, documentConfigs, schedules, filters] = await Promise.all([
      storage.getOrderConceptObjects(concept.id),
      storage.getOrderConceptArticles(concept.id),
      storage.getArticleObjectMappings(concept.id),
      storage.getInvoiceConfiguration(concept.id),
      storage.getDocumentConfigurations(concept.id),
      storage.getDeliverySchedules(concept.id),
      storage.getConceptFilters(concept.id),
    ]);

    res.json({
      ...concept,
      conceptObjects,
      conceptArticles,
      mappings,
      invoiceConfig,
      documentConfigs,
      schedules,
      filters,
    });
}));

app.get("/api/order-concepts/:id/objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const objs = await storage.getOrderConceptObjects(req.params.id);
    res.json(objs);
}));

app.post("/api/order-concepts/:id/objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { objectIds } = req.body;
    if (!Array.isArray(objectIds) || objectIds.length === 0) {
      throw new ValidationError("objectIds krävs");
    }
    const tenantObjects = await storage.getObjects(tenantId);
    const tenantObjectIds = new Set(tenantObjects.map(o => o.id));
    const validObjectIds = objectIds.filter((id: string) => tenantObjectIds.has(id));
    if (validObjectIds.length === 0) {
      throw new ValidationError("Inga giltiga objekt hittades");
    }
    const inserts = validObjectIds.map((objectId: string) => ({
      orderConceptId: req.params.id,
      objectId,
    }));
    const result = await storage.addOrderConceptObjects(inserts);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalObjects: (await storage.getOrderConceptObjects(req.params.id)).length });
    res.status(201).json(result);
}));

app.delete("/api/order-concepts/:id/objects/:objectId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    await storage.removeOrderConceptObject(req.params.id, req.params.objectId);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalObjects: (await storage.getOrderConceptObjects(req.params.id)).length });
    res.status(204).send();
}));

app.get("/api/order-concepts/:id/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const arts = await storage.getOrderConceptArticles(req.params.id);
    res.json(arts);
}));

app.post("/api/order-concepts/:id/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { articleId, quantity, unitPrice } = req.body;
    if (!articleId || typeof articleId !== "string") {
      throw new ValidationError("articleId krävs");
    }
    const tenantArticles = await storage.getArticles(tenantId);
    if (!tenantArticles.find(a => a.id === articleId)) {
      throw new ValidationError("Artikeln hittades inte");
    }
    const result = await storage.addOrderConceptArticle({
      orderConceptId: req.params.id,
      articleId,
      quantity: quantity || 1,
      unitPrice: unitPrice ?? null,
    });
    const allArticles = await storage.getOrderConceptArticles(req.params.id);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalArticles: allArticles.length });
    res.status(201).json(result);
}));

app.delete("/api/order-concepts/:id/articles/:articleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    await storage.removeOrderConceptArticle(req.params.articleId, req.params.id);
    const allArticles = await storage.getOrderConceptArticles(req.params.id);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalArticles: allArticles.length });
    res.status(204).send();
}));

app.get("/api/order-concepts/:id/article-mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const mappings = await storage.getArticleObjectMappings(req.params.id);
    res.json(mappings);
}));

const articleMappingSchema = z.object({
  orderConceptArticleId: z.string().min(1),
  orderConceptObjectId: z.string().min(1),
  quantity: z.number().positive().optional().default(1),
});

app.post("/api/order-concepts/:id/article-mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const parsed = articleMappingSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
    const result = await storage.createArticleObjectMapping(parsed.data);
    res.status(201).json(result);
}));

app.post("/api/order-concepts/:id/article-mappings/auto", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");

    const conceptObjects = await storage.getOrderConceptObjects(req.params.id);
    const conceptArticles = await storage.getOrderConceptArticles(req.params.id);

    let mappingsCreated = 0;
    await db.transaction(async () => {
      await storage.deleteArticleObjectMappings(req.params.id);
      for (const article of conceptArticles) {
        for (const obj of conceptObjects) {
          if (!obj.included) continue;
          await storage.createArticleObjectMapping({
            orderConceptArticleId: article.id,
            orderConceptObjectId: obj.id,
            quantity: article.quantity || 1,
          });
          mappingsCreated++;
        }
      }
    });

    res.json({ mappingsCreated });
}));

app.put("/api/order-concepts/:id/invoice-config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const result = await storage.upsertInvoiceConfiguration({
      orderConceptId: req.params.id,
      ...req.body,
    });
    res.json(result);
}));

app.put("/api/order-concepts/:id/documents", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { documents } = req.body;
    const configs = (documents || []).map((d: any) => ({
      orderConceptId: req.params.id,
      ...d,
    }));
    const result = await storage.upsertDocumentConfigurations(req.params.id, configs);
    res.json(result);
}));

app.put("/api/order-concepts/:id/delivery", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { deliveryModel, schedules: scheduleData, ...conceptData } = req.body;

    if (deliveryModel) {
      await storage.updateOrderConcept(req.params.id, tenantId, { deliveryModel, ...conceptData });
    }

    if (scheduleData) {
      const schedulesWithId = scheduleData.map((s: any) => ({
        orderConceptId: req.params.id,
        ...s,
      }));
      await storage.upsertDeliverySchedules(req.params.id, schedulesWithId);
    }

    const updatedConcept = await storage.getOrderConcept(req.params.id);
    const updatedSchedules = await storage.getDeliverySchedules(req.params.id);
    res.json({ concept: updatedConcept, schedules: updatedSchedules });
}));

app.post("/api/order-concepts/:id/validate", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Ej hittad");

    const errors: { code: string; message: string }[] = [];
    const warnings: { code: string; message: string }[] = [];

    const conceptObjects = await storage.getOrderConceptObjects(concept.id);
    const conceptArticles = await storage.getOrderConceptArticles(concept.id);

    if (!concept.name) errors.push({ code: "MISSING_NAME", message: "Namn saknas" });
    if (conceptObjects.length === 0) errors.push({ code: "NO_OBJECTS", message: "Inga objekt valda" });
    if (conceptArticles.length === 0) errors.push({ code: "NO_ARTICLES", message: "Inga artiklar valda" });
    if (!concept.invoiceLevel) warnings.push({ code: "NO_INVOICE_LEVEL", message: "Faktureringsnivå ej vald" });
    if (!concept.deliveryModel) warnings.push({ code: "NO_DELIVERY_MODEL", message: "Leveransmodell ej vald" });

    if (concept.deliveryModel === "schedule") {
      const schedules = await storage.getDeliverySchedules(concept.id);
      if (schedules.length === 0) warnings.push({ code: "NO_SCHEDULES", message: "Inga leveransscheman definierade" });
    }

    if (concept.deliveryModel === "subscription" && !concept.monthlyFeeCalc) {
      warnings.push({ code: "NO_MONTHLY_FEE", message: "Månadsavgift ej beräknad" });
    }

    res.json({ valid: errors.length === 0, errors, warnings });
}));

// ============================================
// TASK DEPENDENCY TEMPLATES API
// ============================================

app.get("/api/task-dependency-templates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { articleId } = req.query;
    const templates = await storage.getTaskDependencyTemplates(tenantId, articleId as string | undefined);
    res.json(templates);
}));

app.get("/api/task-dependency-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const template = await storage.getTaskDependencyTemplate(req.params.id);
    if (!template || template.tenantId !== tenantId) {
      throw new NotFoundError("Beroendemall hittades inte");
    }
    res.json(template);
}));

app.post("/api/task-dependency-templates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const template = await storage.createTaskDependencyTemplate({ ...req.body, tenantId });
    res.status(201).json(template);
}));

app.put("/api/task-dependency-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const updated = await storage.updateTaskDependencyTemplate(req.params.id, tenantId, req.body);
    if (!updated) throw new NotFoundError("Beroendemall hittades inte");
    res.json(updated);
}));

app.delete("/api/task-dependency-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteTaskDependencyTemplate(req.params.id, tenantId);
    res.json({ success: true });
}));

app.post("/api/work-orders/:id/generate-dependent-tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Arbetsorder hittades inte");
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
}));

app.get("/api/task-dependency-instances", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { parentWorkOrderId } = req.query;
    const instances = await storage.getTaskDependencyInstances(tenantId, parentWorkOrderId as string | undefined);
    res.json(instances);
}));

// ============================================
// INVOICE RULES API
// ============================================

app.get("/api/invoice-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { orderConceptId } = req.query;
    const rules = await storage.getInvoiceRules(tenantId, orderConceptId as string | undefined);
    res.json(rules);
}));

app.post("/api/invoice-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rule = await storage.createInvoiceRule({ ...req.body, tenantId });
    res.status(201).json(rule);
}));

app.put("/api/invoice-rules/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const updated = await storage.updateInvoiceRule(req.params.id, tenantId, req.body);
    if (!updated) throw new NotFoundError("Faktureringsregel hittades inte");
    res.json(updated);
}));

app.delete("/api/invoice-rules/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteInvoiceRule(req.params.id, tenantId);
    res.json({ success: true });
}));

// ============================================
// INVOICE PREVIEW/GENERATION
// ============================================

app.get("/api/invoice-preview", asyncHandler(async (req, res) => {
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
}));

// ============================================
// ORDER CONCEPT RERUN & RUN LOGS API
// ============================================

app.get("/api/order-concept-run-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { orderConceptId } = req.query;
    const logs = await storage.getOrderConceptRunLogs(tenantId, orderConceptId as string | undefined);
    res.json(logs);
}));

app.post("/api/order-concepts/:id/rerun", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

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
}));

app.post("/api/order-concepts/:id/validate-min-days", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const minDays = concept.minDaysBetween || 60;
    const { proposedDate } = req.body;
    if (!proposedDate) throw new ValidationError("proposedDate krävs");

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
}));

// ============================================
// SCHEDULE API (Week Planning)
// ============================================

app.get("/api/schedule", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError("startDate och endDate krävs");
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
}));

// ============================================
// ASSIGNMENTS API
// ============================================

app.get("/api/assignments", asyncHandler(async (req, res) => {
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
}));

app.get("/api/assignments/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const articles = await storage.getAssignmentArticles(assignment!.id);
    res.json({ ...assignment, articles });
}));

app.post("/api/assignments", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    
    const assignment = await storage.createAssignment({
      ...req.body,
      tenantId,
      createdBy: userId,
      creationMethod: req.body.creationMethod || "manual"
    });
    res.status(201).json(assignment);
}));

app.patch("/api/assignments/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const assignment = await storage.updateAssignment(req.params.id, tenantId, req.body);
    res.json(assignment);
}));

app.delete("/api/assignments/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    await storage.deleteAssignment(req.params.id, tenantId);
    res.status(204).send();
}));

// Get candidate resources for an assignment
app.get("/api/assignments/:id/candidates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
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
}));

// Assign resource to assignment
app.post("/api/assignments/:id/assign", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }

    const { resourceId, scheduledDate, scheduledStartTime, scheduledEndTime } = req.body;
    
    if (!resourceId) {
      throw new ValidationError("ResourceId krävs");
    }

    // Verify resource exists and belongs to tenant
    const resource = await storage.getResource(resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
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
}));

// Assignment Articles
app.get("/api/assignments/:assignmentId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.assignmentId);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const articles = await storage.getAssignmentArticles(req.params.assignmentId);
    res.json(articles);
}));

app.post("/api/assignments/:assignmentId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.assignmentId);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const article = await storage.createAssignmentArticle({
      ...req.body,
      assignmentId: req.params.assignmentId
    });
    res.status(201).json(article);
}));

app.delete("/api/assignments/:assignmentId/articles/:articleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.assignmentId);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    await storage.deleteAssignmentArticle(req.params.articleId, req.params.assignmentId);
    res.status(204).send();
}));

// ============================================
// CUSTOMER NOTIFICATIONS - E-post notifieringar till kunder
// ============================================

app.post("/api/notifications/send", asyncHandler(async (req, res) => {
    const { sendCustomerNotification } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, notificationType, estimatedArrivalMinutes, customMessage } = req.body;
    
    if (!workOrderId || !notificationType) {
      throw new ValidationError("workOrderId och notificationType krävs");
    }
    
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
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
}));

app.post("/api/notifications/technician-on-way/:workOrderId", asyncHandler(async (req, res) => {
    const { notifyTechnicianOnWay } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    const { estimatedMinutes } = req.body;
    
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
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
}));

app.post("/api/notifications/job-completed/:workOrderId", asyncHandler(async (req, res) => {
    const { notifyJobCompleted } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    
    const results = await notifyJobCompleted(tenantId, workOrderId);
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      sent: successCount,
      results,
    });
}));

app.post("/api/notifications/send-schedule/:resourceId", asyncHandler(async (req, res) => {
    const { sendScheduleToResource } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId } = req.params;
    const { jobs, dateRange, fieldAppUrl } = req.body;
    
    const resource = await storage.getResource(resourceId);
    if (!resource || !verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    
    if (!resource.email) {
      throw new ValidationError("Resursen har ingen e-postadress registrerad");
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
}));

app.post("/api/work-orders/:workOrderId/send-sms", asyncHandler(async (req, res) => {
    const { sendSms, isTwilioConfigured } = await import("../replit_integrations/twilio");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    const { message, recipientPhone } = req.body;

    if (!message || typeof message !== "string" || !recipientPhone || typeof recipientPhone !== "string") {
      throw new ValidationError("Meddelande och telefonnummer krävs");
    }

    if (message.length > 320) {
      throw new ValidationError("Meddelandet får inte vara längre än 320 tecken");
    }

    const phoneRegex = /^[\d\s\-+()]{7,20}$/;
    if (!phoneRegex.test(recipientPhone.trim())) {
      throw new ValidationError("Ogiltigt telefonnummerformat");
    }

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const twilioConfigured = await isTwilioConfigured();
    if (!twilioConfigured) {
      throw new ValidationError("SMS-tjänsten (Twilio) är inte konfigurerad");
    }

    let cleaned = recipientPhone.replace(/[\s\-()]/g, "");
    if (cleaned.startsWith("07") || cleaned.startsWith("08") || cleaned.startsWith("0")) {
      cleaned = "+46" + cleaned.substring(1);
    } else if (!cleaned.startsWith("+")) {
      cleaned = "+46" + cleaned;
    }

    const smsResult = await sendSms({ to: cleaned, body: message });

    const customer = await storage.getCustomer(workOrder.customerId);

    await db.insert(customerCommunications).values({
      tenantId,
      workOrderId,
      customerId: workOrder.customerId,
      objectId: workOrder.objectId,
      channel: "sms",
      notificationType: "manual_sms",
      recipientName: customer?.contactPerson || customer?.name || null,
      recipientEmail: null,
      recipientPhone: recipientPhone,
      subject: null,
      message,
      aiGenerated: false,
      status: smsResult.success ? "sent" : "failed",
      errorMessage: smsResult.error || null,
      sentAt: smsResult.success ? new Date() : null,
    });

    res.json({
      success: smsResult.success,
      messageId: smsResult.messageId,
      error: smsResult.error,
    });
}));

app.get("/api/work-orders/:workOrderId/communications", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const logs = await db.select()
      .from(customerCommunications)
      .where(and(
        eq(customerCommunications.tenantId, tenantId),
        eq(customerCommunications.workOrderId, workOrderId)
      ))
      .orderBy(desc(customerCommunications.createdAt));

    res.json(logs);
}));

app.post("/api/work-orders/:workOrderId/auto-eta-sms", asyncHandler(async (req, res) => {
    const { sendSms, isTwilioConfigured } = await import("../replit_integrations/twilio");
    const { trackApiUsage } = await import("../api-usage-tracker");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    const { technicianLat, technicianLng } = req.body;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    if (workOrder.etaSmsSent) {
      res.json({ success: true, skipped: true, reason: "ETA SMS redan skickat för denna order" });
      return;
    }

    const tenant = await storage.getTenant(tenantId);
    if (!tenant?.smsEnabled) {
      res.json({ success: false, reason: "SMS inte aktiverat" });
      return;
    }

    const twilioConfigured = await isTwilioConfigured();
    if (!twilioConfigured) {
      res.json({ success: false, reason: "Twilio inte konfigurerat" });
      return;
    }

    const obj = await storage.getObject(workOrder.objectId);
    if (!obj) {
      throw new NotFoundError("Objekt hittades inte");
    }

    const customer = await storage.getCustomer(workOrder.customerId);
    const contacts = await db.select().from(objectContacts)
      .where(and(
        eq(objectContacts.objectId, workOrder.objectId),
        eq(objectContacts.tenantId, tenantId)
      ));

    const primaryContacts = contacts.filter(c => c.contactType === "primary");
    const recipientContacts = primaryContacts.length > 0 ? primaryContacts : contacts;
    const phoneRecipients: { name: string; phone: string }[] = [];

    for (const contact of recipientContacts) {
      if (contact.phone) {
        phoneRecipients.push({ name: contact.name || "", phone: contact.phone });
      }
    }

    if (phoneRecipients.length === 0 && customer?.phone) {
      phoneRecipients.push({ name: customer.contactPerson || customer.name, phone: customer.phone });
    }

    if (phoneRecipients.length === 0) {
      res.json({ success: false, reason: "Inget telefonnummer för mottagare" });
      return;
    }

    let etaMinutes: number | null = null;
    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
    if (GEOAPIFY_API_KEY && technicianLat && technicianLng && obj.latitude && obj.longitude) {
      try {
        const waypoints = `${technicianLat},${technicianLng}|${obj.latitude},${obj.longitude}`;
        const startTime = Date.now();
        const geoRes = await fetch(
          `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`
        );
        trackApiUsage({
          service: "geoapify",
          method: "routing",
          endpoint: "/v1/routing",
          units: 1,
          statusCode: geoRes.status,
          durationMs: Date.now() - startTime,
        });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const props = geoData.features?.[0]?.properties;
          if (props?.time) {
            etaMinutes = Math.round(props.time / 60);
          }
        }
      } catch (err) {
        console.error("[auto-eta-sms] Geoapify routing error:", err);
      }
    }

    if (!etaMinutes) {
      etaMinutes = 30;
    }

    const resource = workOrder.resourceId ? await storage.getResource(workOrder.resourceId) : null;
    const companyName = tenant?.smsFromName || tenant?.name || "Traivo";
    const resourceName = resource?.name || "Vår tekniker";

    let sentCount = 0;
    for (const recipient of phoneRecipients) {
      let cleaned = recipient.phone.replace(/[\s\-()]/g, "");
      if (cleaned.startsWith("0")) {
        cleaned = "+46" + cleaned.substring(1);
      } else if (!cleaned.startsWith("+")) {
        cleaned = "+46" + cleaned;
      }

      const smsBody = `${companyName}: ${resourceName} är på väg till ${obj.address || obj.name}. Beräknad ankomst: ca ${etaMinutes} min.`;
      const smsResult = await sendSms({ to: cleaned, body: smsBody });

      await db.insert(customerCommunications).values({
        tenantId,
        workOrderId,
        customerId: workOrder.customerId,
        objectId: workOrder.objectId,
        channel: "sms",
        notificationType: "technician_on_way",
        recipientName: recipient.name || null,
        recipientEmail: null,
        recipientPhone: recipient.phone,
        subject: null,
        message: smsBody,
        aiGenerated: false,
        status: smsResult.success ? "sent" : "failed",
        errorMessage: smsResult.error || null,
        sentAt: smsResult.success ? new Date() : null,
      });

      if (smsResult.success) sentCount++;
    }

    if (sentCount > 0) {
      await db.update(workOrders)
        .set({ etaSmsSent: true })
        .where(eq(workOrders.id, workOrderId));
    }

    res.json({
      success: sentCount > 0,
      sent: sentCount,
      total: phoneRecipients.length,
      etaMinutes,
    });
}));

}
