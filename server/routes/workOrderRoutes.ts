import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { insertWorkOrderSchema, insertWorkOrderLineSchema, ORDER_STATUSES, type OrderStatus, workOrders, objects, articles, taskDependencyInstances, insertProcurementSchema, insertSetupTimeLogSchema, insertSimulationScenarioSchema } from "@shared/schema";
import { handleWorkOrderStatusChange } from "../ai-communication";
import { notificationService } from "../notifications";
import { getISOWeek, getStartOfISOWeek } from "./helpers";

export async function registerWorkOrderRoutes(app: Express) {
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

    const search = req.query.search as string || undefined;

    if (status === 'unscheduled') {
      if (search || offset !== undefined) {
        const result = await storage.getUnscheduledWorkOrdersPaginated(
          tenantId,
          limit || 50,
          offset || 0,
          search
        );
        res.json(result);
      } else {
        const workOrders = await storage.getUnscheduledWorkOrders(tenantId, limit || 500);
        res.json(workOrders);
      }
    } else if (paginated || offset !== undefined) {
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
      const workOrders = await storage.getWorkOrders(tenantId, startDate, endDate, includeUnscheduled, limit);
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

app.post("/api/work-orders/bulk-unschedule", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate, resourceIds } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }
    const parsedStart = new Date(startDate);
    const parsedEnd = new Date(endDate);
    if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (resourceIds && (!Array.isArray(resourceIds) || resourceIds.some((id: any) => typeof id !== "string"))) {
      return res.status(400).json({ error: "resourceIds must be an array of strings" });
    }
    const count = await storage.bulkUnscheduleWorkOrders(
      tenantId,
      parsedStart,
      parsedEnd,
      resourceIds
    );
    res.json({ count });
  } catch (error) {
    console.error("Bulk unschedule error:", error);
    res.status(500).json({ error: "Failed to bulk unschedule work orders" });
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
    
    // Convert lockedAt string to Date object if present
    if (updateData.lockedAt && typeof updateData.lockedAt === 'string') {
      updateData.lockedAt = new Date(updateData.lockedAt);
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
}
