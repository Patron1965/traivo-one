import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { insertWorkOrderSchema, insertWorkOrderLineSchema, ORDER_STATUSES, type OrderStatus, articles, insertProcurementSchema, insertSetupTimeLogSchema, insertSimulationScenarioSchema } from "@shared/schema";
import { handleWorkOrderStatusChange } from "../ai-communication";
import { notificationService } from "../notifications";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "../errors";
import { getArticleMetadataForObject, writeArticleMetadataOnObject } from "../metadata-queries";

export async function registerWorkOrderRoutes(app: Express) {

app.get("/api/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allDates = req.query.allDates === 'true';
  let startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  let endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
  const includeUnscheduled = req.query.includeUnscheduled === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
  const status = req.query.status as string || undefined;
  const paginated = req.query.paginated === 'true';
  const search = req.query.search as string || undefined;

  if (!allDates && status !== 'unscheduled') {
    if (!startDate && !endDate) {
      const now = new Date();
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (startDate && !endDate) {
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    } else if (!startDate && endDate) {
      startDate = new Date(0);
    }
  }

  if (status === 'unscheduled') {
    if (search || offset !== undefined) {
      const result = await storage.getUnscheduledWorkOrdersPaginated(tenantId, limit || 50, offset || 0, search);
      res.json(result);
    } else {
      const workOrders = await storage.getUnscheduledWorkOrders(tenantId, limit || 500);
      res.json(workOrders);
    }
  } else if (paginated || offset !== undefined) {
    const result = await storage.getWorkOrdersPaginated(tenantId, limit || 50, offset || 0, startDate, endDate, includeUnscheduled, status);
    res.json(result);
  } else {
    const workOrders = await storage.getWorkOrders(tenantId, startDate, endDate, includeUnscheduled, limit);
    res.json(workOrders);
  }
}));

app.get("/api/work-orders/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.id);
  const verified = verifyTenantOwnership(workOrder, tenantId);
  if (!verified) throw new NotFoundError("Arbetsorder");

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
}));

app.get("/api/resources/:resourceId/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const resource = await storage.getResource(req.params.resourceId);
  if (!verifyTenantOwnership(resource, tenantId)) {
    throw new NotFoundError("Resurs");
  }
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
  const workOrders = await storage.getWorkOrdersByResource(req.params.resourceId, startDate, endDate);
  res.json(workOrders);
}));

const bulkUnscheduleSchema = z.object({
  startDate: z.string().min(1, "startDate krävs"),
  endDate: z.string().min(1, "endDate krävs"),
  resourceIds: z.array(z.string()).optional(),
});

app.post("/api/work-orders/bulk-unschedule", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parsed = bulkUnscheduleSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const { startDate, endDate, resourceIds } = parsed.data;
  const parsedStart = new Date(startDate);
  const parsedEnd = new Date(endDate);
  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    throw new ValidationError("Ogiltigt datumformat");
  }
  const count = await storage.bulkUnscheduleWorkOrders(tenantId, parsedStart, parsedEnd, resourceIds);
  res.json({ count });
}));

app.post("/api/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);

  const bodyData = { ...req.body };
  if (bodyData.scheduledDate && typeof bodyData.scheduledDate === 'string') {
    const dateStr = bodyData.scheduledDate;
    bodyData.scheduledDate = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
  }

  const data = insertWorkOrderSchema.parse({
    orderStatus: 'skapad',
    isSimulated: false,
    ...bodyData,
    tenantId
  });
  const workOrder = await storage.createWorkOrder(data);

  if (workOrder.resourceId) {
    notificationService.notifyJobAssigned(workOrder, workOrder.resourceId);
  }

  res.status(201).json(workOrder);
}));

app.patch("/api/work-orders/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;

  const existingOrder = await storage.getWorkOrder(req.params.id);
  if (!existingOrder || !verifyTenantOwnership(existingOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  if (updateData.scheduledDate && typeof updateData.scheduledDate === 'string') {
    const dateStr = updateData.scheduledDate;
    updateData.scheduledDate = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
  }

  if (updateData.lockedAt && typeof updateData.lockedAt === 'string') {
    updateData.lockedAt = new Date(updateData.lockedAt);
  }

  const workOrder = await storage.updateWorkOrder(req.params.id, updateData);
  if (!workOrder) throw new NotFoundError("Arbetsorder");

  const newResourceId = workOrder.resourceId;
  const oldResourceId = existingOrder.resourceId;

  if (newResourceId && newResourceId !== oldResourceId) {
    notificationService.notifyJobAssigned(workOrder, newResourceId);
    if (oldResourceId) {
      notificationService.notifyJobCancelled(existingOrder, oldResourceId);
    }
  }

  if (newResourceId && updateData.scheduledDate !== undefined) {
    const oldDate = existingOrder.scheduledDate?.toISOString().split('T')[0];
    const newDate = workOrder.scheduledDate?.toISOString().split('T')[0];
    if (oldDate !== newDate) {
      notificationService.notifyScheduleChanged(workOrder, newResourceId, oldDate, newDate);
    }
  }

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

  const isAssignmentChange = newResourceId !== oldResourceId;
  const isScheduleChange = updateData.scheduledDate !== undefined &&
    existingOrder.scheduledDate?.toISOString().split('T')[0] !== workOrder.scheduledDate?.toISOString().split('T')[0];
  const isPriorityChange = updateData.priority && updateData.priority !== existingOrder.priority;

  if (newResourceId && !isAssignmentChange && !isScheduleChange && !isPriorityChange) {
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
}));

app.delete("/api/work-orders/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getWorkOrder(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }
  await storage.deleteWorkOrder(req.params.id);
  res.status(204).send();
}));

app.get("/api/order-stock", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const includeSimulated = req.query.includeSimulated === "true";
  const scenarioId = req.query.scenarioId as string | undefined;
  const orderStatus = req.query.orderStatus as OrderStatus | undefined;
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50;
  const search = req.query.search as string | undefined;

  let metadataFilters: { metadataName: string; operator: string; value: string }[] | undefined;
  const metadataFilterRaw = req.query.metadataFilter as string | undefined;
  if (metadataFilterRaw) {
    metadataFilters = metadataFilterRaw.split(",").map(f => {
      const parts = f.split(":");
      return { metadataName: parts[0], operator: parts[1] || 'eq', value: parts.slice(2).join(":") };
    }).filter(f => f.metadataName && f.value);
  }

  const { orders, total, byStatus, aggregates } = await storage.getOrderStock(tenantId, {
    includeSimulated, scenarioId, orderStatus, startDate, endDate, page, pageSize, search, metadataFilters,
  });

  const summary = {
    totalOrders: total,
    totalValue: aggregates.totalValue,
    totalCost: aggregates.totalCost,
    totalProductionMinutes: aggregates.totalProductionMinutes,
    byStatus
  };

  res.json({ orders, summary, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

app.post("/api/work-orders/:id/status", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getWorkOrder(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) {
    throw new ValidationError(`Invalid status. Must be one of: ${ORDER_STATUSES.join(", ")}`);
  }

  try {
    const workOrder = await storage.updateWorkOrderStatus(req.params.id, status);
    if (!workOrder) throw new NotFoundError("Arbetsorder");
    res.json(workOrder);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Ogiltig statusövergång")) {
      throw new ConflictError(error.message);
    }
    throw error;
  }
}));

app.get("/api/work-orders/:workOrderId/lines", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }
  const lines = await storage.getWorkOrderLines(req.params.workOrderId);

  const enrichedLines = await Promise.all(lines.map(async (line) => {
    const article = line.articleId ? await storage.getArticle(line.articleId) : null;
    return {
      ...line,
      articleName: article?.name || "Okänd artikel",
      articleDescription: article?.description,
    };
  }));

  res.json(enrichedLines);
}));

app.post("/api/work-orders/:workOrderId/lines", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const { articleId, quantity = 1, isOptional = false, notes, priceListId } = req.body;
  if (!articleId) {
    throw new ValidationError("articleId is required");
  }

  let priceInfo: { price: number; cost: number; productionMinutes: number; priceListId: string | null; source: string };

  if (priceListId) {
    priceInfo = await storage.resolveArticlePriceFromList(tenantId, articleId, priceListId);
  } else {
    priceInfo = await storage.resolveArticlePrice(tenantId, articleId, workOrder.customerId);
  }

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
  await storage.recalculateWorkOrderTotals(req.params.workOrderId);
  res.status(201).json(line);
}));

app.patch("/api/work-order-lines/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existingLine = await storage.getWorkOrderLine(req.params.id);
  if (!existingLine) throw new NotFoundError("Orderrad");

  const workOrder = await storage.getWorkOrder(existingLine.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Orderrad");
  }

  const updateSchema = insertWorkOrderLineSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  const { id: _id, tenantId: _t, workOrderId: _w, createdAt: _c, ...updateData } = parseResult.data as Record<string, unknown>;
  const line = await storage.updateWorkOrderLine(req.params.id, updateData);
  if (!line) throw new NotFoundError("Orderrad");

  if (line.workOrderId) {
    await storage.recalculateWorkOrderTotals(line.workOrderId);
  }

  res.json(line);
}));

app.delete("/api/work-order-lines/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const line = await storage.getWorkOrderLine(req.params.id);
  if (!line) throw new NotFoundError("Orderrad");

  const workOrder = await storage.getWorkOrder(line.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Orderrad");
  }

  await storage.deleteWorkOrderLine(req.params.id);

  if (line?.workOrderId) {
    await storage.recalculateWorkOrderTotals(line.workOrderId);
  }

  res.status(204).send();
}));

app.get("/api/work-orders/:workOrderId/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }
  const objects = await storage.getWorkOrderObjects(req.params.workOrderId);
  res.json(objects);
}));

app.post("/api/work-orders/:workOrderId/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const { objectId, isPrimary, sortOrder, notes } = req.body;
  if (!objectId) {
    throw new ValidationError("objectId is required");
  }

  const object = await storage.getObject(objectId);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }

  const existingObjects = await storage.getWorkOrderObjects(req.params.workOrderId);
  const isDuplicate = existingObjects.some(o => o.objectId === objectId);
  if (isDuplicate) {
    throw new ConflictError("Object is already linked to this work order");
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
}));

app.delete("/api/work-order-objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrderObject = await storage.getWorkOrderObject(req.params.id);
  if (!workOrderObject) throw new NotFoundError("Arbetsorderobjekt");

  const workOrder = await storage.getWorkOrder(workOrderObject.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorderobjekt");
  }

  await storage.deleteWorkOrderObject(req.params.id);
  res.status(204).send();
}));

app.get("/api/resolve-price", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { articleId, customerId, date } = req.query;

  if (!articleId || !customerId) {
    throw new ValidationError("articleId and customerId are required");
  }

  const priceInfo = await storage.resolveArticlePrice(
    tenantId,
    articleId as string,
    customerId as string,
    date ? new Date(date as string) : undefined
  );

  res.json(priceInfo);
}));

app.get("/api/simulation-scenarios", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const scenarios = await storage.getSimulationScenarios(tenantId);
  res.json(scenarios);
}));

app.get("/api/simulation-scenarios/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const scenario = await storage.getSimulationScenario(req.params.id);
  const verified = verifyTenantOwnership(scenario, tenantId);
  if (!verified) throw new NotFoundError("Simuleringscenario");
  res.json(verified);
}));

app.post("/api/simulation-scenarios", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertSimulationScenarioSchema.parse({ ...req.body, tenantId });
  const scenario = await storage.createSimulationScenario(data);
  res.status(201).json(scenario);
}));

app.patch("/api/simulation-scenarios/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getSimulationScenario(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Simuleringscenario");
  }
  const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
  const scenario = await storage.updateSimulationScenario(req.params.id, updateData);
  if (!scenario) throw new NotFoundError("Simuleringscenario");
  res.json(scenario);
}));

app.delete("/api/simulation-scenarios/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getSimulationScenario(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Simuleringscenario");
  }
  await storage.deleteSimulationScenario(req.params.id);
  res.status(204).send();
}));

app.post("/api/simulation-scenarios/:id/clone-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { orderIds } = req.body;
  const scenarioId = req.params.id;

  const scenario = await storage.getSimulationScenario(scenarioId);
  if (!verifyTenantOwnership(scenario, tenantId)) {
    throw new NotFoundError("Simuleringscenario");
  }

  const cloneSchema = z.object({
    orderIds: z.array(z.string().min(1)).min(1, "Minst en order krävs"),
  });
  const parsed = cloneSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const validatedOrderIds = parsed.data.orderIds;

  const originals = await Promise.all(validatedOrderIds.map(id => storage.getWorkOrder(id)));
  for (let i = 0; i < validatedOrderIds.length; i++) {
    const original = originals[i];
    if (!original) {
      throw new NotFoundError(`Order ${validatedOrderIds[i]} hittades inte`);
    }
    if (original.tenantId !== tenantId) {
      throw new ForbiddenError(`Order ${validatedOrderIds[i]} tillhör inte din organisation`);
    }
  }

  const clonedOrders = [];
  for (const original of originals) {
    if (!original) continue;

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

    const lines = await storage.getWorkOrderLines(original.id);
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

    await storage.recalculateWorkOrderTotals(clonedOrder.id);
    clonedOrders.push(clonedOrder);
  }

  res.status(201).json({ clonedOrders, count: clonedOrders.length });
}));

app.post("/api/work-orders/:id/promote", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.id);
  if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  if (!workOrder.isSimulated) {
    throw new ValidationError("Order is not simulated");
  }

  const updatedTitle = workOrder.title?.replace(/^\[SIM\] /, "") || workOrder.title;
  const promoted = await storage.updateWorkOrder(req.params.id, {
    isSimulated: false,
    simulationScenarioId: null,
    title: updatedTitle
  });

  res.json(promoted);
}));

app.post("/api/setup-time-logs", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertSetupTimeLogSchema.parse({ ...req.body, tenantId });
  const log = await storage.createSetupTimeLog(data);
  res.status(201).json(log);
}));

app.get("/api/setup-time-logs", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const objectId = req.query.objectId as string | undefined;
  const logs = await storage.getSetupTimeLogs(tenantId, objectId);
  res.json(logs);
}));

app.get("/api/procurements", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const procurements = await storage.getProcurements(tenantId);
  res.json(procurements);
}));

app.get("/api/procurements/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const procurement = await storage.getProcurement(req.params.id);
  const verified = verifyTenantOwnership(procurement, tenantId);
  if (!verified) throw new NotFoundError("Upphandling");
  res.json(verified);
}));

app.post("/api/procurements", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertProcurementSchema.parse({ ...req.body, tenantId });
  const procurement = await storage.createProcurement(data);
  res.status(201).json(procurement);
}));

app.patch("/api/procurements/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getProcurement(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Upphandling");
  }
  const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
  const procurement = await storage.updateProcurement(req.params.id, updateData);
  if (!procurement) throw new NotFoundError("Upphandling");
  res.json(procurement);
}));

app.delete("/api/procurements/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getProcurement(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Upphandling");
  }
  await storage.deleteProcurement(req.params.id);
  res.status(204).send();
}));

}
