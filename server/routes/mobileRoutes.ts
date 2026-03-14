import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { isAuthenticated } from "../replit_integrations/auth";
import { type ServiceObject } from "@shared/schema";
import { notificationService } from "../notifications";
import { getArticleMetadataForObject, writeArticleMetadataOnObject } from "../metadata-queries";

export async function registerMobileRoutes(app: Express) {
// ========================================
// MOBILE APP API ENDPOINTS
// ========================================

// Mobile login - authenticate with email and PIN
app.post("/api/mobile/login", asyncHandler(async (req, res) => {
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
}));

// Mobile logout
app.post("/api/mobile/logout", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader.substring(7);
    mobileTokens.delete(token);
    res.json({ success: true });
}));

// Get current resource info
app.get("/api/mobile/me", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resource = await storage.getResource(req.mobileResourceId);
    if (!resource) {
      return res.status(404).json({ error: "Resource not found" });
    }
    res.json(resource);
}));

// Get work orders for the logged-in resource
app.get("/api/mobile/my-orders", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// Get single work order details
app.get("/api/mobile/orders/:id", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// Update work order status from mobile
app.patch("/api/mobile/orders/:id/status", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// Add note to work order
app.post("/api/mobile/orders/:id/notes", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// ============================================
// POSITION TRACKING API ENDPOINTS
// ============================================

app.post("/api/resources/position", isAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// Update position from mobile app (also handled via WebSocket)
app.post("/api/mobile/position", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

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

app.get("/api/mobile/orders", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.patch("/api/mobile/orders/:id/substeps/:stepId", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/orders/:id/deviations", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/orders/:id/materials", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.get("/api/mobile/articles", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/orders/:id/signature", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/orders/:id/inspections", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/gps", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.get("/api/mobile/summary", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.get("/api/mobile/weather", asyncHandler(async (req, res) => {
    const lat = parseFloat(req.query.lat as string) || 57.7089;
    const lon = parseFloat(req.query.lon as string) || 11.9746;

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&current_weather=true&timezone=Europe/Stockholm`
    );
    const data = await weatherRes.json();
    res.json(data);
}));

app.post("/api/mobile/ai/chat", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/ai/transcribe", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.post("/api/mobile/ai/analyze-image", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// ============================================
// OFFLINE SYNC API (Mobile Field App)
// ============================================

app.post("/api/mobile/sync", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.get("/api/mobile/sync/status", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// ============================================
// CHECKLIST TEMPLATES API
// ============================================

app.get("/api/checklist-templates", isAuthenticated, asyncHandler(async (req: any, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const templates = await storage.getChecklistTemplates(tenantId);
    res.json(templates);
}));

app.get("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const template = await storage.getChecklistTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
}));

app.post("/api/checklist-templates", isAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.patch("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const template = await storage.updateChecklistTemplate(req.params.id, req.body);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
}));

app.delete("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    await storage.deleteChecklistTemplate(req.params.id);
    res.json({ success: true });
}));

app.get("/api/mobile/orders/:id/checklist", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

// ============================================
// DRIVER PUSH NOTIFICATIONS API
// ============================================

app.get("/api/mobile/notifications", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
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
}));

app.patch("/api/mobile/notifications/:id/read", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const notification = await storage.markDriverNotificationRead(req.params.id, resourceId);
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    res.json(notification);
}));

app.patch("/api/mobile/notifications/read-all", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const count = await storage.markAllDriverNotificationsRead(resourceId);
    res.json({ success: true, markedRead: count });
}));

app.get("/api/mobile/notifications/count", isMobileAuthenticated, asyncHandler(async (req: any, res) => {
    const resourceId = req.mobileResourceId;
    const unreadCount = await storage.getUnreadNotificationCount(resourceId);
    res.json({ unreadCount });
}));

}
