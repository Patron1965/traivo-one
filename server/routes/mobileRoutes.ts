import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { isAuthenticated } from "../replit_integrations/auth";
import { type ServiceObject, routeFeedback as routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotifications as etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments, workEntries, workSessions } from "@shared/schema";
import { mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES } from "@shared/changeRequestCategories";
import { notificationService } from "../notifications";
import { triggerETANotification } from "../eta-notification-service";
import OpenAI from "openai";
import { getArticleMetadataForObject, writeArticleMetadataOnObject } from "../metadata-queries";
import { handleWorkOrderStatusChange } from "../ai-communication";

interface MobileAuthenticatedRequest extends Request {
  mobileResourceId: string;
  mobileTenantId?: string;
}

export async function registerMobileRoutes(app: Express) {
// ========================================
// MOBILE APP API ENDPOINTS
// ========================================

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// Mobile login - authenticate with email and PIN
app.post("/api/mobile/login", asyncHandler(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp);
    if (attempt) {
      if (now > attempt.resetAt) {
        loginAttempts.delete(clientIp);
      } else if (attempt.count >= 10) {
        return res.status(429).json({ error: "För många inloggningsförsök. Försök igen om 15 minuter." });
      }
    }

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
      throw new ValidationError("PIN or username/password required");
    }

    if (!resource) {
      const existing = loginAttempts.get(clientIp);
      if (existing) {
        existing.count++;
      } else {
        loginAttempts.set(clientIp, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
      }
      return res.status(401).json({ error: "Ogiltiga inloggningsuppgifter" });
    }
    
    loginAttempts.delete(clientIp);
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
app.post("/api/mobile/logout", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader.substring(7);
    mobileTokens.delete(token);
    res.json({ success: true });
}));

// Get current resource info
app.get("/api/mobile/me", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resource = await storage.getResource(req.mobileResourceId);
    if (!resource) {
      throw new NotFoundError("Resurs hittades inte");
    }
    res.json({
      ...resource,
      startLatitude: resource.homeLatitude || null,
      startLongitude: resource.homeLongitude || null,
    });
}));

// Get work orders for the logged-in resource
app.get("/api/mobile/my-orders", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
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
    
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const object = order.objectId ? await storage.getObject(order.objectId) : null;
      const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;
      
      return {
        ...order,
        objectName: object?.name,
        objectAddress: object?.address,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        enRouteAt: order.onWayAt?.toISOString?.() || (order as any).onWayAt || null,
        actualStartTime: order.onSiteAt?.toISOString?.() || (order as any).onSiteAt || null,
        objectAccessCode: object?.accessCode || null,
        objectKeyNumber: object?.keyNumber || null,
        objectLatitude: object?.latitude || null,
        objectLongitude: object?.longitude || null,
        latitude: object?.latitude || null,
        longitude: object?.longitude || null,
        address: object?.address || order.address || "",
        city: object?.city || "",
        postalCode: object?.postalCode || "",
        plannedNotes: order.plannedNotes || null,
        executionStatus: order.executionStatus || "not_started",
        object: object ? { id: object.id, name: object.name, address: object.address, latitude: object.latitude, longitude: object.longitude } : null,
        customer: customer ? { id: customer.id, name: customer.name, customerNumber: customer.customerNumber } : null,
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
app.get("/api/mobile/orders/:id", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    
    const order = await storage.getWorkOrder(orderId);
    
    if (!order) {
      throw new NotFoundError("Order hittades inte");
    }
    
    // Verify this order belongs to the resource
    if (order.resourceId !== resourceId) {
      throw new ForbiddenError("Ej behörig");
    }
    
    const object = order.objectId ? await storage.getObject(order.objectId) : null;
    const customer = order.customerId ? await storage.getCustomer(order.customerId) : null;

    const etaCheck = order.onWayAt ? await db.select().from(etaNotificationsTable)
      .where(and(
        eq(etaNotificationsTable.workOrderId, orderId),
        eq(etaNotificationsTable.status, "sent"),
      ))
      .limit(1) : [];

    res.json({
      ...order,
      objectName: object?.name,
      objectAddress: object?.address,
      objectLatitude: object?.latitude,
      objectLongitude: object?.longitude,
      latitude: object?.latitude || null,
      longitude: object?.longitude || null,
      address: object?.address || order.address || "",
      city: object?.city || "",
      postalCode: object?.postalCode || "",
      accessCode: object?.accessCode,
      keyNumber: object?.keyNumber,
      objectAccessCode: object?.accessCode || null,
      objectKeyNumber: object?.keyNumber || null,
      objectNotes: object?.notes,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      enRouteAt: order.onWayAt?.toISOString?.() || (order as any).onWayAt || null,
      customerNotified: etaCheck.length > 0,
      actualStartTime: order.onSiteAt?.toISOString?.() || (order as any).onSiteAt || null,
      plannedNotes: order.plannedNotes || null,
      executionStatus: order.executionStatus || "not_started",
      object: object ? { id: object.id, name: object.name, address: object.address, latitude: object.latitude, longitude: object.longitude } : null,
      customer: customer ? { id: customer.id, name: customer.name, customerNumber: customer.customerNumber } : null,
    });
}));

// Update work order status from mobile
app.patch("/api/mobile/orders/:id/status", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { status, notes, actualDuration: bodyActualDuration, enRouteAt: bodyEnRouteAt, impossibleReason } = req.body;
    
    const order = await storage.getWorkOrder(orderId);
    
    if (!order) {
      throw new NotFoundError("Order hittades inte");
    }
    
    if (order.resourceId !== resourceId) {
      throw new ForbiddenError("Ej behörig");
    }
    
    const updateData: any = {};
    
    if (status === 'paborjad' || status === 'in_progress') {
      updateData.orderStatus = 'planerad_resurs';
      updateData.executionStatus = 'on_site';
      updateData.onSiteAt = new Date();
    } else if (status === 'dispatched') {
      updateData.executionStatus = 'dispatched';
      if (!order.onWayAt) {
        updateData.onWayAt = new Date();
      }
      if (order.tenantId && resourceId) {
        triggerETANotification(orderId, resourceId, order.tenantId).catch(err =>
          console.error("[eta-notification] Failed to trigger on dispatch:", err)
        );
      }
    } else if (status === 'en_route') {
      updateData.executionStatus = 'on_way';
      if (!order.onWayAt) {
        updateData.onWayAt = bodyEnRouteAt ? new Date(bodyEnRouteAt) : new Date();
      }
      if (order.tenantId && resourceId) {
        triggerETANotification(orderId, resourceId, order.tenantId).catch(err =>
          console.error("[eta-notification] Failed to trigger:", err)
        );
      }
    } else if (status === 'planned' || status === 'assigned') {
      updateData.executionStatus = 'planned_fine';
    } else if (status === 'utford' || status === 'completed') {
      updateData.orderStatus = 'utford';
      updateData.executionStatus = 'completed';
      updateData.completedAt = new Date();
      if (bodyActualDuration !== undefined) {
        updateData.actualDuration = bodyActualDuration;
      } else if (order.onSiteAt) {
        updateData.actualDuration = Math.round((Date.now() - new Date(order.onSiteAt).getTime()) / 60000);
      }
    } else if (status === 'impossible') {
      updateData.orderStatus = 'avbruten';
      updateData.executionStatus = 'impossible';
      updateData.impossibleReason = impossibleReason || notes || null;
      updateData.impossibleAt = new Date();
      updateData.impossibleBy = resourceId;
    } else if (status === 'ej_utford' || status === 'deferred') {
      updateData.orderStatus = 'skapad';
      if (notes) {
        updateData.notes = order.notes 
          ? `${order.notes}\n\nUppskjuten: ${notes}` 
          : `Uppskjuten: ${notes}`;
      }
    } else if (status === 'cancelled') {
      updateData.orderStatus = 'avbruten';
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
      handleWorkOrderStatusChange(orderId, order.orderStatus, status, mobileTenantId).catch(err =>
        console.error("[ai-communication] Mobile event hook error:", err)
      );
    }

    const object = updatedOrder.objectId ? await storage.getObject(updatedOrder.objectId) : null;
    const customer = updatedOrder.customerId ? await storage.getCustomer(updatedOrder.customerId) : null;

    const etaCheck = updatedOrder.onWayAt ? await db.select().from(etaNotificationsTable)
      .where(and(
        eq(etaNotificationsTable.workOrderId, orderId),
        eq(etaNotificationsTable.status, "sent"),
      ))
      .limit(1) : [];

    const enriched = {
      ...updatedOrder,
      enRouteAt: updatedOrder.onWayAt?.toISOString?.() || (updatedOrder as any).onWayAt || null,
      customerNotified: etaCheck.length > 0,
      actualStartTime: updatedOrder.onSiteAt?.toISOString?.() || (updatedOrder as any).onSiteAt || null,
      customerName: customer?.name || null,
      objectName: object?.name || null,
      objectAddress: object?.address || null,
      objectAccessCode: object?.accessCode || null,
      objectKeyNumber: object?.keyNumber || null,
    };

    res.json(enriched);

    broadcastPlannerEvent({
      type: 'status_changed',
      data: { orderId, orderNumber: updatedOrder.title || `WO-${orderId.substring(0,8)}`, oldStatus: order.orderStatus || 'unknown', newStatus: status, driverName: '', timestamp: new Date().toISOString() }
    });

    notificationService.sendToResource(resourceId, {
      type: "order_updated",
      title: "Order uppdaterad",
      message: `${updatedOrder.title || orderId} — status: ${status}`,
      orderId,
      data: { status, executionStatus: updateData.executionStatus }
    });
}));

// Add note to work order
app.post("/api/mobile/orders/:id/notes", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { note } = req.body;
    
    if (!note || !note.trim()) {
      throw new ValidationError("Anteckning krävs");
    }
    
    const order = await storage.getWorkOrder(orderId);
    
    if (!order) {
      throw new NotFoundError("Order hittades inte");
    }
    
    if (order.resourceId !== resourceId) {
      throw new ForbiddenError("Ej behörig");
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

app.post("/api/resources/position", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { resourceId, latitude, longitude, speed, heading, accuracy, status, workOrderId } = req.body;
    
    if (!resourceId) {
      throw new ValidationError("resourceId is required");
    }
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      throw new ValidationError("Latitud och longitud krävs");
    }

    const resource = await storage.getResource(resourceId);
    if (!resource) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const tenantId = getTenantIdWithFallback(req);
    if (resource.tenantId && resource.tenantId !== tenantId) {
      throw new ForbiddenError("Åtkomst nekad");
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
app.post("/api/mobile/position", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { latitude, longitude, speed, heading, accuracy, status, workOrderId, currentOrderId } = req.body;
    
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      throw new ValidationError("Latitud och longitud krävs");
    }
    
    await notificationService.handlePositionUpdate({
      resourceId,
      latitude,
      longitude,
      speed,
      heading,
      accuracy,
      status: status || "traveling",
      workOrderId: workOrderId || currentOrderId,
    });
    
    res.json({ success: true });
}));

// ============================================
// WORK SESSION API
// ============================================

app.post("/api/mobile/work-sessions/start", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const existingMeta: Record<string, unknown> = (resource.metadata as Record<string, unknown>) || {};
    const activeSession = existingMeta.activeWorkSession as Record<string, unknown> | undefined;

    if (activeSession && (activeSession as { status?: string }).status === 'active') {
      return res.json(activeSession);
    }

    const session = {
      id: `ws-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'active' as const,
      pausedAt: null,
      totalPauseMinutes: 0,
    };

    await storage.updateResource(resourceId, {
      metadata: { ...existingMeta, activeWorkSession: session },
    } as any);

    console.log(`[mobile] Work session started for resource ${resourceId}`);
    res.json(session);

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Arbetspass startat",
      message: `${resource.name || resourceId} har startat sitt arbetspass`,
      data: { resourceId, sessionId: session.id, event: "work_session_started" }
    });
}));

app.get("/api/mobile/work-sessions/active", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const existingMeta: Record<string, unknown> = (resource.metadata as Record<string, unknown>) || {};
    const activeSession = existingMeta.activeWorkSession as Record<string, unknown> | null;

    if (activeSession && (activeSession as { status?: string }).status !== 'completed') {
      res.json(activeSession);
    } else {
      res.json(null);
    }
}));

const workSessionStopHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const existingMeta: Record<string, unknown> = (resource.metadata as Record<string, unknown>) || {};
    const activeSession = existingMeta.activeWorkSession as Record<string, unknown> | null;

    if (!activeSession) {
      return res.json({ success: false, error: "Inget aktivt arbetspass" });
    }

    const updatedSession = {
      ...activeSession,
      endTime: new Date().toISOString(),
      status: 'completed',
    };

    await storage.updateResource(resourceId, {
      metadata: { ...existingMeta, activeWorkSession: updatedSession },
    } as any);

    console.log(`[mobile] Work session stopped for resource ${resourceId}`);
    res.json(updatedSession);

    notificationService.broadcastToAll({
      type: "schedule_changed",
      title: "Arbetspass avslutat",
      message: `${resource.name || resourceId} har avslutat sitt arbetspass`,
      data: { resourceId, event: "work_session_stopped" }
    });
});
app.patch("/api/mobile/work-sessions/:id/stop", isMobileAuthenticated, workSessionStopHandler);
app.post("/api/mobile/work-sessions/:id/stop", isMobileAuthenticated, workSessionStopHandler);

const workSessionPauseHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const existingMeta: Record<string, unknown> = (resource.metadata as Record<string, unknown>) || {};
    const activeSession = existingMeta.activeWorkSession as Record<string, unknown> | null;

    if (!activeSession) {
      return res.json({ success: false, error: "Inget aktivt arbetspass" });
    }

    const updatedSession = {
      ...activeSession,
      status: 'paused',
      pausedAt: new Date().toISOString(),
    };

    await storage.updateResource(resourceId, {
      metadata: { ...existingMeta, activeWorkSession: updatedSession },
    } as any);

    res.json(updatedSession);
});
app.patch("/api/mobile/work-sessions/:id/pause", isMobileAuthenticated, workSessionPauseHandler);
app.post("/api/mobile/work-sessions/:id/pause", isMobileAuthenticated, workSessionPauseHandler);

const workSessionResumeHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const existingMeta: Record<string, unknown> = (resource.metadata as Record<string, unknown>) || {};
    const activeSession = existingMeta.activeWorkSession as Record<string, unknown> | null;

    if (!activeSession) {
      return res.json({ success: false, error: "Inget aktivt arbetspass" });
    }

    const pausedAt = (activeSession as { pausedAt?: string }).pausedAt;
    const totalPause = ((activeSession as { totalPauseMinutes?: number }).totalPauseMinutes || 0) +
      (pausedAt ? Math.round((Date.now() - new Date(pausedAt).getTime()) / 60000) : 0);

    const updatedSession = {
      ...activeSession,
      status: 'active',
      pausedAt: null,
      totalPauseMinutes: totalPause,
    };

    await storage.updateResource(resourceId, {
      metadata: { ...existingMeta, activeWorkSession: updatedSession },
    } as any);

    res.json(updatedSession);
});
app.patch("/api/mobile/work-sessions/:id/resume", isMobileAuthenticated, workSessionResumeHandler);
app.post("/api/mobile/work-sessions/:id/resume", isMobileAuthenticated, workSessionResumeHandler);

// ============================================
// PHOTO DOCUMENTATION API
// ============================================

app.post("/api/mobile/orders/:id/photos", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { photos } = req.body;

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      throw new ValidationError("Foton krävs");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const existingMetadata = (order.metadata as Record<string, unknown>) || {};
    const existingPhotos = (existingMetadata.photos as Array<{ uri: string; caption: string; uploadedAt: string; uploadedBy: string }>) || [];

    const newPhotos = photos.map((p: { uri: string; caption?: string }) => ({
      uri: p.uri,
      caption: p.caption || '',
      uploadedAt: new Date().toISOString(),
      uploadedBy: resourceId,
    }));

    await storage.updateWorkOrder(orderId, {
      metadata: {
        ...existingMetadata,
        photos: [...existingPhotos, ...newPhotos],
      },
    } as any);

    console.log(`[mobile] ${photos.length} photos uploaded for order ${orderId} by resource ${resourceId}`);
    res.json({ success: true, count: photos.length });
}));

// ============================================
// CHECKLIST SUBMISSION API (mobile)
// ============================================

app.post("/api/mobile/orders/:id/checklist", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { checklist } = req.body;

    if (!checklist || !Array.isArray(checklist)) {
      throw new ValidationError("Checklista krävs");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    for (const item of checklist) {
      if (item.checked) {
        await db.insert(orderChecklistItems).values({
          workOrderId: orderId,
          stepText: item.label || item.id,
          isCompleted: true,
          completedAt: new Date(),
          isAiGenerated: false,
          sortOrder: 0,
        }).onConflictDoNothing();
      }
    }

    console.log(`[mobile] Checklist submitted for order ${orderId} by resource ${resourceId}: ${checklist.filter((i: { checked: boolean }) => i.checked).length}/${checklist.length} checked`);
    res.json({ success: true, total: checklist.length, checked: checklist.filter((i: { checked: boolean }) => i.checked).length });
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
        status: depOrder?.orderStatus || "unknown",
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
    status: order.orderStatus,
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

app.get("/api/mobile/orders", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

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

app.patch("/api/mobile/orders/:id/substeps/:stepId", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { id: orderId, stepId } = req.params;
    const resourceId = req.mobileResourceId;
    const { completed } = req.body;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

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

app.post("/api/mobile/orders/:id/deviations", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { type, description, latitude, longitude, photos } = req.body;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

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

    let linkedChangeRequest = null;
    const deviationType = type || "other";
    const shouldAutoLink = (AUTO_LINK_DEVIATION_TYPES as readonly string[]).includes(deviationType);

    if (shouldAutoLink && order.objectId) {
      try {
        const existing = await db.select()
          .from(customerChangeRequests)
          .where(eq(customerChangeRequests.linkedDeviationId, deviation.id))
          .limit(1);

        if (existing.length === 0) {
          const obj = await storage.getObject(order.objectId);
          if (obj?.customerId) {
            const mappedCategory = GO_CATEGORY_MAP[deviationType] || mapGoCategory(deviationType);
            linkedChangeRequest = await storage.createCustomerChangeRequest({
              tenantId: order.tenantId!,
              objectId: order.objectId,
              customerId: obj.customerId,
              category: mappedCategory,
              description: `[Auto från avvikelse] ${DEVIATION_TYPE_MAP[deviationType] || deviationType}: ${description || "Ingen beskrivning"}`,
              photos: photos || [],
              latitude: latitude || null,
              longitude: longitude || null,
              status: "new",
              severity: "medium",
              createdByResourceId: resourceId,
              linkedDeviationId: deviation.id,
            });

            console.log(`[mobile] Auto-created change request ${linkedChangeRequest.id} from deviation ${deviation.id}`);

            broadcastPlannerEvent({
              type: 'change_request:created',
              data: { id: linkedChangeRequest.id, category: mappedCategory, objectId: order.objectId, linkedDeviationId: deviation.id, timestamp: new Date().toISOString() }
            });
          }
        }
      } catch (err) {
        console.error(`[mobile] Failed to auto-create change request from deviation ${deviation.id}:`, err);
      }
    }

    console.log(`[mobile] Deviation reported for order ${orderId} by resource ${resourceId}`);
    res.json({ success: true, deviation, linkedChangeRequest });

    broadcastPlannerEvent({
      type: 'deviation_reported',
      data: { orderId, orderNumber: '', deviationType: type, description: description || '', driverName: '', timestamp: new Date().toISOString() }
    });
}));

app.get("/api/mobile/deviations/mine", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new ForbiddenError("Resurs hittades inte");

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { deviationReports } = await import("@shared/schema");
    const { eq, and, desc } = await import("drizzle-orm");

    const items = await db.select().from(deviationReports)
      .where(and(
        eq(deviationReports.tenantId, resource.tenantId),
        eq(deviationReports.reportedByName, resource.name)
      ))
      .orderBy(desc(deviationReports.reportedAt))
      .limit(limit);

    res.json({ items, total: items.length });
}));

const materialLogSchema = z.object({
  articleId: z.string().optional(),
  articleNumber: z.string().optional(),
  articleName: z.string().optional(),
  quantity: z.number().positive().default(1),
}).refine(data => data.articleId || data.articleNumber, {
  message: "articleId eller articleNumber krävs",
});

app.post("/api/mobile/orders/:id/materials", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const parsed = materialLogSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
    const { articleId, articleNumber, articleName, quantity } = parsed.data;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    let resolvedArticleId = articleId;
    const tenantArticles = await storage.getArticles(order.tenantId);
    if (!resolvedArticleId && articleNumber) {
      const found = tenantArticles.find(a => a.articleNumber === articleNumber);
      if (found) resolvedArticleId = found.id;
    }

    if (!resolvedArticleId) {
      throw new ValidationError("Article ID or valid article number required");
    }

    if (!tenantArticles.some(a => a.id === resolvedArticleId)) {
      throw new ForbiddenError("Artikeln tillhör inte denna organisation");
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

app.get("/api/mobile/articles", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

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

app.post("/api/mobile/orders/:id/signature", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { signature } = req.body;

    if (!signature) throw new ValidationError("Signaturdata krävs");

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

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

app.post("/api/mobile/orders/:id/inspections", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { inspections } = req.body;

    if (!inspections || !Array.isArray(inspections)) {
      throw new ValidationError("Inspektionslista krävs");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

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

app.post("/api/mobile/gps", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { latitude, longitude, speed, heading, accuracy, currentOrderId, currentOrderNumber, vehicleRegNo, driverName } = req.body;

    if (latitude === undefined || longitude === undefined) {
      throw new ValidationError("Latitud och longitud krävs");
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

app.get("/api/mobile/summary", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

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

    const completedOrders = todayOrders.filter(o => o.orderStatus === "utford" || o.executionStatus === "completed").length;
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

app.post("/api/mobile/ai/chat", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { message, context } = req.body;
    if (!message) throw new ValidationError("Meddelande krävs");

    const tenantId = req.tenantId || "default-tenant";
    const { enforceBudgetAndRateLimit, withRetry } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "chat");
    if (!enforcement.allowed) {
      if (enforcement.errorType === "ratelimit") {
        res.set("Retry-After", String(enforcement.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden", response: "AI-tjänsten är tillfälligt otillgänglig." });
    }
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI();

    const completion = await withRetry(() => openai.chat.completions.create({
      model: enforcement.model,
      messages: [
        {
          role: "system",
          content: "Du är en hjälpsam AI-assistent för fältarbetare inom avfallshantering och fastighetsskötsel i Sverige. Svara alltid på svenska. Var kortfattad och praktisk. " +
            (context ? `Kontext: Order ${context.orderNumber || ""}, Kund: ${context.customerName || ""}` : ""),
        },
        { role: "user", content: message },
      ],
      max_tokens: 500,
    }), { label: "mobile-chat" });

    const { trackOpenAIResponse } = await import("../api-usage-tracker");
    trackOpenAIResponse(completion, tenantId);
    res.json({ response: completion.choices[0]?.message?.content || "Inget svar" });
}));

app.post("/api/mobile/ai/transcribe", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { audio } = req.body;
    if (!audio) throw new ValidationError("Ljuddata krävs");

    const transcribeTenantId = req.tenantId || "default-tenant";
    const { enforceBudgetAndRateLimit: transcribeEnforce, withRetry: transcribeRetry } = await import("../ai-budget-service");
    const transcribeCheck = await transcribeEnforce(transcribeTenantId, "chat");
    if (!transcribeCheck.allowed) {
      if (transcribeCheck.errorType === "ratelimit") {
        res.set("Retry-After", String(transcribeCheck.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: transcribeCheck.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden" });
    }

    const buffer = Buffer.from(audio, "base64");
    const blob = new Blob([buffer], { type: "audio/webm" });
    const file = new File([blob], "audio.webm", { type: "audio/webm" });

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI();
    const transcription = await transcribeRetry(() => openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "sv",
    }), { label: "mobile-transcribe" });

    const { trackApiUsage } = await import("../api-usage-tracker");
    trackApiUsage({ tenantId: transcribeTenantId, service: "openai", method: "audio.transcriptions", endpoint: "/v1/audio/transcriptions", model: "whisper-1", inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    res.json({ text: transcription.text });
}));

app.post("/api/mobile/ai/analyze-image", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { image, context } = req.body;
    if (!image) throw new ValidationError("Image data required");

    const imgTenantId = req.tenantId || "default-tenant";
    const { enforceBudgetAndRateLimit: imgEnforce, withRetry: imgRetry } = await import("../ai-budget-service");
    const imgCheck = await imgEnforce(imgTenantId, "analysis");
    if (!imgCheck.allowed) {
      if (imgCheck.errorType === "ratelimit") {
        res.set("Retry-After", String(imgCheck.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: imgCheck.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden" });
    }
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI();
    const completion = await imgRetry(() => openai.chat.completions.create({
      model: imgCheck.model,
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
    }), { label: "mobile-analyze-image" });

    const { trackOpenAIResponse: trackImg } = await import("../api-usage-tracker");
    trackImg(completion, imgTenantId);
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

app.post("/api/mobile/sync", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");
    const tenantId = resource.tenantId;
    const { actions } = req.body;

    if (!actions || !Array.isArray(actions)) {
      throw new ValidationError("actions array required");
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
        if (!order) return { order: null, error: "Order hittades inte" };
        if (order.tenantId !== tenantId) return { order: null, error: "Ej behörig" };
        if (order.resourceId !== resourceId) return { order: null, error: "Ej behörig" };
        return { order };
      };

      try {
        switch (actionType) {
          case "status_update": {
            const { orderId, status: newStatus, notes: statusNotes } = payload;
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
            const updateData: Record<string, any> = {};
            if (newStatus === 'paborjad' || newStatus === 'in_progress') {
              updateData.orderStatus = 'planerad_resurs';
              updateData.executionStatus = 'on_site';
              updateData.onSiteAt = new Date();
            } else if (newStatus === 'en_route') {
              updateData.executionStatus = 'on_way';
              updateData.onWayAt = new Date();
              if (order.tenantId && order.resourceId) {
                triggerETANotification(logEntry.entityId!, order.resourceId, order.tenantId).catch(() => {});
              }
            } else if (newStatus === 'planned') {
              updateData.executionStatus = 'planned_fine';
            } else if (newStatus === 'utford' || newStatus === 'completed') {
              updateData.orderStatus = 'utford';
              updateData.executionStatus = 'completed';
              updateData.completedAt = new Date();
            } else if (newStatus === 'ej_utford' || newStatus === 'deferred') {
              updateData.orderStatus = 'skapad';
              if (statusNotes) {
                updateData.notes = order.notes
                  ? `${order.notes}\n\nUppskjuten: ${statusNotes}`
                  : `Uppskjuten: ${statusNotes}`;
              }
            } else if (newStatus === 'cancelled') {
              updateData.orderStatus = 'avbruten';
              if (statusNotes) {
                updateData.notes = order.notes
                  ? `${order.notes}\n\nInställd: ${statusNotes}`
                  : `Inställd: ${statusNotes}`;
              }
            } else {
              const validOrderStatuses: readonly string[] = ORDER_STATUSES;
              updateData.orderStatus = validOrderStatuses.includes(newStatus) ? newStatus : 'skapad';
            }
            await storage.updateWorkOrder(orderId, updateData);
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
            const { order: noteOrder, error } = await verifyOrder(orderId);
            if (!noteOrder) {
              await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
              results.push({ clientId, status: "error", error });
              break;
            }
            const newNote = `[${new Date().toISOString()}] ${text}`;
            const updatedNotes = noteOrder.notes
              ? `${noteOrder.notes}\n${newNote}`
              : newNote;
            await storage.updateWorkOrder(orderId, { notes: updatedNotes });
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
            const { orderId, inspections, checklist } = payload;
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
            if (Array.isArray(inspections)) {
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
            }
            if (Array.isArray(checklist)) {
              for (const item of checklist) {
                if (item.checked) {
                  await db.insert(orderChecklistItems).values({
                    workOrderId: orderId,
                    stepText: item.label || item.id,
                    isCompleted: true,
                    completedAt: new Date(),
                    isAiGenerated: false,
                    sortOrder: 0,
                  }).onConflictDoNothing();
                }
              }
            }
            await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
            results.push({ clientId, status: "completed" });
            break;
          }
          case "signature": {
            const { orderId, signature } = payload;
            if (!orderId || !signature) {
              await storage.updateOfflineSyncLogStatus(logEntry.id, "error", "orderId and signature required");
              results.push({ clientId, status: "error", error: "orderId and signature required" });
              break;
            }
            const { order, error } = await verifyOrder(orderId);
            if (!order) {
              await storage.updateOfflineSyncLogStatus(logEntry.id, "error", error!);
              results.push({ clientId, status: "error", error });
              break;
            }
            await storage.createProtocol({
              tenantId,
              workOrderId: orderId,
              objectId: order.objectId,
              protocolType: "service",
              executedAt: new Date(),
              executedByName: (await storage.getResource(resourceId))?.name || "Fältarbetare",
              signature,
              signedAt: new Date(),
              status: "completed",
            });
            await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
            results.push({ clientId, status: "completed" });
            break;
          }
          case "photo": {
            const { orderId, photos } = payload;
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
            const meta = (order.metadata as Record<string, unknown>) || {};
            const existingPhotos = (meta.photos as Array<unknown>) || [];
            const newPhotos = (Array.isArray(photos) ? photos : []).map((p: any) => ({
              uri: p.uri,
              caption: p.caption || '',
              uploadedAt: new Date().toISOString(),
              uploadedBy: resourceId,
            }));
            await storage.updateWorkOrder(orderId, {
              metadata: { ...meta, photos: [...existingPhotos, ...newPhotos] },
            } as any);
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

app.get("/api/mobile/sync/status", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
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

app.get("/api/checklist-templates", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const templates = await storage.getChecklistTemplates(tenantId);
    res.json(templates);
}));

app.get("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const template = await storage.getChecklistTemplate(req.params.id);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

app.post("/api/checklist-templates", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const { name, articleType, questions, isActive } = req.body;

    if (!name || !articleType) {
      throw new ValidationError("name and articleType required");
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

app.patch("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const template = await storage.updateChecklistTemplate(req.params.id, req.body);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

app.delete("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    await storage.deleteChecklistTemplate(req.params.id);
    res.json({ success: true });
}));

app.get("/api/mobile/orders/:id/checklist", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

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

app.get("/api/mobile/notifications", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
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

app.patch("/api/mobile/notifications/:id/read", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const notification = await storage.markDriverNotificationRead(req.params.id, resourceId);
    if (!notification) throw new NotFoundError("Avisering hittades inte");
    res.json(notification);
}));

app.patch("/api/mobile/notifications/read-all", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const count = await storage.markAllDriverNotificationsRead(resourceId);
    res.json({ success: true, markedRead: count });
}));

app.get("/api/mobile/notifications/count", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const unreadCount = await storage.getUnreadNotificationCount(resourceId);
    res.json({ unreadCount });
}));

// ============================================
// ROUTE FEEDBACK — drivers rate daily routes
// ============================================
app.get("/api/mobile/route-feedback/mine", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const { startDate, endDate, limit: limitStr } = req.query as Record<string, string>;
    const parsedLimit = limitStr ? Math.min(Math.max(parseInt(limitStr) || 20, 1), 100) : 20;
    const feedback = await storage.getRouteFeedback(resource.tenantId, {
      resourceId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: parsedLimit,
    });
    res.json(feedback);
}));

app.post("/api/mobile/route-feedback", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const VALID_REASON_CATEGORIES = ["felaktig_ordning", "orimliga_kortider", "vagarbete_hinder", "for_manga_stopp", "saknad_info", "trafik", "optimal", "ovrigt"];
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rating: z.number().int().min(1).max(5),
      reasonCategory: z.string().optional(),
      freeText: z.string().max(1000).optional(),
      workSessionId: z.string().optional(),
    }).refine((data) => {
      if (data.rating <= 2 && !data.reasonCategory) return false;
      return true;
    }, { message: "reasonCategory krävs för betyg 1-2" }).refine((data) => {
      if (data.reasonCategory && !VALID_REASON_CATEGORIES.includes(data.reasonCategory)) return false;
      return true;
    }, { message: `reasonCategory måste vara en av: ${VALID_REASON_CATEGORIES.join(", ")}` });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodError(parseResult.error));
    }

    const existing = await storage.getRouteFeedback(resource.tenantId, {
      resourceId,
      startDate: parseResult.data.date,
      endDate: parseResult.data.date,
      limit: 1,
    });

    let feedback;
    if (existing.length > 0) {
      const [updated] = await db.update(routeFeedbackTable)
        .set({
          rating: parseResult.data.rating,
          reasonCategory: parseResult.data.reasonCategory || null,
          freeText: parseResult.data.freeText || null,
          workSessionId: parseResult.data.workSessionId || null,
        })
        .where(eq(routeFeedbackTable.id, existing[0].id))
        .returning();
      feedback = updated;
    } else {
      feedback = await storage.createRouteFeedback({
        tenantId: resource.tenantId,
        resourceId,
        date: parseResult.data.date,
        rating: parseResult.data.rating,
        reasonCategory: parseResult.data.reasonCategory || null,
        freeText: parseResult.data.freeText || null,
        workSessionId: parseResult.data.workSessionId || null,
      });
    }

    console.log(`[mobile] Route feedback: resource ${resourceId} rated ${parseResult.data.date} as ${parseResult.data.rating}/5`);
    res.status(existing.length > 0 ? 200 : 201).json(feedback);
}));

app.get("/api/mobile/terminology", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) {
      return res.status(404).json({ error: "Resurs hittades inte" });
    }
    const tenantId = resource.tenantId;
    const { tenantLabels, DEFAULT_TERMINOLOGY, INDUSTRY_TERMINOLOGY } = await import("@shared/schema");
    const labels = await db.select().from(tenantLabels).where(eq(tenantLabels.tenantId, tenantId));
    const tenant = await storage.getTenant(tenantId);
    const industry = tenant?.industry || "waste_management";
    const industryDefaults = INDUSTRY_TERMINOLOGY[industry] || {};
    const merged: Record<string, string> = { ...DEFAULT_TERMINOLOGY, ...industryDefaults };
    for (const label of labels) {
      merged[label.labelKey] = label.labelValue;
    }
    res.json(merged);
}));

app.get("/api/checklist/:workOrderId", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;
    const items = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId))
      .orderBy(orderChecklistItems.sortOrder);
    res.json(items);
}));

app.post("/api/checklist/:workOrderId/items", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;
    const { stepText, isAiGenerated, sortOrder } = req.body;
    if (!stepText || typeof stepText !== "string" || !stepText.trim()) {
      return res.status(400).json({ error: "stepText krävs" });
    }
    const existingItems = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId));
    const newSortOrder = sortOrder ?? existingItems.length;
    const [item] = await db.insert(orderChecklistItems).values({
      workOrderId,
      stepText: stepText.trim(),
      isAiGenerated: isAiGenerated || false,
      isCompleted: false,
      sortOrder: newSortOrder,
    }).returning();
    res.status(201).json(item);
}));

app.patch("/api/checklist/items/:itemId", asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const { isCompleted } = req.body;
    if (typeof isCompleted !== "boolean") {
      return res.status(400).json({ error: "isCompleted (boolean) krävs" });
    }
    const [updated] = await db.update(orderChecklistItems)
      .set({
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      })
      .where(eq(orderChecklistItems.id, itemId))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Checklista-objekt hittades inte" });
    }
    res.json(updated);
}));

app.delete("/api/checklist/items/:itemId", asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    await db.delete(orderChecklistItems)
      .where(eq(orderChecklistItems.id, itemId));
    res.json({ success: true });
}));

app.post("/api/checklist/:workOrderId/generate", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: "Arbetsorder hittades inte" });
    }

    const similarOrders = await db.select({
      title: workOrders.title,
      orderType: workOrders.orderType,
      description: workOrders.description,
      notes: workOrders.notes,
    }).from(workOrders)
      .where(and(
        eq(workOrders.tenantId, workOrder.tenantId),
        eq(workOrders.orderType, workOrder.orderType),
        eq(workOrders.orderStatus, "utford"),
      ))
      .orderBy(desc(workOrders.completedAt))
      .limit(10);

    const existingChecklist = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId));
    const existingSteps = existingChecklist.map(i => i.stepText);

    try {
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const prompt = `Du är en fältserviceassistent. Föreslå en checklista med 4-7 konkreta arbetsmoment för en tekniker som ska utföra ett jobb.

Ordertyp: ${workOrder.orderType}
Titel: ${workOrder.title}
${workOrder.description ? `Beskrivning: ${workOrder.description}` : ""}
Status: ${workOrder.orderStatus}

${similarOrders.length > 0 ? `Historik från ${similarOrders.length} liknande jobb:
${similarOrders.map((o, i) => `${i + 1}. ${o.title}${o.notes ? ` — ${o.notes}` : ""}`).join("\n")}` : ""}

${existingSteps.length > 0 ? `Redan tillagda steg (lägg INTE till dessa igen): ${existingSteps.join(", ")}` : ""}

Svara ENBART med JSON-array av strängar, t.ex. ["Steg 1", "Steg 2"]. Skriv på svenska. Var konkret och praktisk.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Du genererar checklistor för fältservicetekniker. Svara alltid med en JSON-array av strängar." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const { trackOpenAIResponse } = await import("../api-usage-tracker");
      trackOpenAIResponse(response);

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      const steps: string[] = Array.isArray(parsed) ? parsed : (parsed.steps || parsed.checklist || parsed.steg || []);

      const filteredSteps = steps.filter(s => typeof s === "string" && s.trim() && !existingSteps.includes(s.trim()));

      const insertedItems = [];
      for (let i = 0; i < filteredSteps.length; i++) {
        const [item] = await db.insert(orderChecklistItems).values({
          workOrderId,
          stepText: filteredSteps[i].trim(),
          isAiGenerated: true,
          isCompleted: false,
          sortOrder: existingChecklist.length + i,
        }).returning();
        insertedItems.push(item);
      }

      res.json({ steps: insertedItems, generated: insertedItems.length });
    } catch (error) {
      console.error("[checklist] AI generation failed:", error);
      const fallbackSteps = getFallbackChecklist(workOrder.orderType);
      const filteredFallback = fallbackSteps.filter(s => !existingSteps.includes(s));

      const insertedItems = [];
      for (let i = 0; i < filteredFallback.length; i++) {
        const [item] = await db.insert(orderChecklistItems).values({
          workOrderId,
          stepText: filteredFallback[i],
          isAiGenerated: true,
          isCompleted: false,
          sortOrder: existingChecklist.length + i,
        }).returning();
        insertedItems.push(item);
      }
      res.json({ steps: insertedItems, generated: insertedItems.length, fallback: true });
    }
}));

// ========================================
// MOBILE - Customer Change Requests (Go integration)
// ========================================

const mobileChangeRequestSchema = z.object({
  objectId: z.string().uuid(),
  category: z.string().min(1),
  description: z.string().min(1).max(5000),
  photos: z.array(z.string()).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional().nullable(),
});

app.post("/api/mobile/customer-change-requests", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new ForbiddenError("Resurs hittades inte");
    const tenantId = resource.tenantId;

    const parseResult = mobileChangeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const data = parseResult.data;

    const obj = await storage.getObject(data.objectId);
    if (!obj || obj.tenantId !== tenantId) {
      throw new NotFoundError("Objekt hittades inte");
    }
    if (!obj.customerId) {
      throw new ValidationError("Objektet saknar kund-koppling");
    }

    const isOneCategory = (ONE_CATEGORIES as readonly string[]).includes(data.category);
    const isGoCategory = Object.keys(GO_CATEGORY_MAP).includes(data.category);
    if (!isOneCategory && !isGoCategory) {
      throw new ValidationError(`Okänd kategori: ${data.category}. Giltiga kategorier: ${[...ONE_CATEGORIES, ...Object.keys(GO_CATEGORY_MAP)].join(", ")}`);
    }
    const mappedCategory = isOneCategory ? data.category : mapGoCategory(data.category);

    const created = await storage.createCustomerChangeRequest({
      tenantId,
      objectId: data.objectId,
      customerId: obj.customerId,
      category: mappedCategory,
      description: data.description,
      photos: data.photos || null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      status: "new",
      severity: data.severity || null,
      createdByResourceId: resourceId,
    });

    broadcastPlannerEvent({
      type: "change_request:created",
      data: {
        id: created.id,
        tenantId: created.tenantId,
        objectId: created.objectId,
        customerId: created.customerId,
        category: created.category,
        severity: created.severity,
        createdByResourceId: resourceId,
      },
    });

    console.log(`[mobile] Change request created: ${created.id} by resource ${resourceId} for object ${data.objectId}`);
    res.status(201).json(created);
}));

app.get("/api/mobile/customer-change-requests/mine", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new ForbiddenError("Resurs hittades inte");

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;

    const { items, total } = await storage.getCustomerChangeRequests({
      tenantId: resource.tenantId,
      createdByResourceId: resourceId,
      status: status || undefined,
      limit,
      offset,
    });

    const objectIds = [...new Set(items.map(r => r.objectId))];
    const customerIds = [...new Set(items.map(r => r.customerId))];
    const objectsArr = objectIds.length > 0 ? await storage.getObjectsByIds(resource.tenantId, objectIds) : [];
    const objectMap = new Map(objectsArr.map(o => [o.id, o]));
    const customersArr = customerIds.length > 0 ? await Promise.all(customerIds.map(id => storage.getCustomer(id))) : [];
    const customerMap = new Map(customersArr.filter(Boolean).map(c => [c!.id, c!]));

    const enriched = items.map(r => ({
      ...r,
      objectName: objectMap.get(r.objectId)?.name || null,
      objectAddress: objectMap.get(r.objectId)?.address || null,
      customerName: customerMap.get(r.customerId)?.name || null,
    }));

    res.json({ items: enriched, total });
}));

app.post("/api/mobile/customer-change-requests/upload-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
}));

app.post("/api/mobile/customer-change-requests/confirm-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { objectPath } = req.body;
    if (!objectPath || typeof objectPath !== "string") {
      throw new ValidationError("objectPath krävs");
    }

    const safePathRegex = /^\/objects\/[a-zA-Z0-9\/_-]+$/;
    if (!safePathRegex.test(objectPath)) {
      throw new ValidationError("Ogiltig fotosökväg");
    }

    try {
      const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
      const oss = new ObjectStorageService();
      await oss.getObjectEntityFile(objectPath);
    } catch {
      throw new ValidationError("Filen hittades inte eller kunde inte verifieras");
    }

    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const oss = new ObjectStorageService();
    const downloadURL = await oss.getObjectEntityDownloadURL(objectPath);
    res.json({ confirmed: true, objectPath, downloadURL });
}));

app.get("/api/mobile/customer-change-requests/categories", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { GO_CATEGORY_MAP: goMap, ONE_CATEGORIES: oneCats, GO_CATEGORIES: goCats, ALL_CATEGORIES: allCats, CATEGORY_LABELS: labels, SEVERITY_LEVELS: sevs } = await import("@shared/changeRequestCategories");
    res.json({
      oneCategories: oneCats,
      goCategories: goCats,
      allCategories: allCats,
      categoryLabels: labels,
      goCategoryMapping: goMap,
      severityLevels: sevs,
    });
}));

function broadcastPlannerEvent(event: { type: string; data: any }) {
  const clients: Map<string, any> = (global as any).__plannerEventClients || new Map();
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  const eventTenantId = event.data?.tenantId;
  clients.forEach((res: any, id: string) => {
    try {
      if (eventTenantId && (res as any).__tenantId && (res as any).__tenantId !== eventTenantId) return;
      res.write(msg);
    } catch(e) { clients.delete(id); }
  });
}

app.post("/api/travel-distances", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { originLat, originLng, destinations } = req.body;
    if (originLat == null || originLng == null || !Array.isArray(destinations)) {
      throw new ValidationError("originLat, originLng och destinations krävs");
    }

    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const results = destinations.map((dest: { id: string; lat: number; lng: number }) => {
      if (dest.lat == null || dest.lng == null) {
        return { id: dest.id, distanceKm: null, travelMinutes: null };
      }
      const distKm = haversine(originLat, originLng, dest.lat, dest.lng);
      const roadFactor = 1.3;
      const avgSpeedKmh = 40;
      const travelMinutes = Math.round((distKm * roadFactor / avgSpeedKmh) * 60);
      return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, travelMinutes };
    });

    res.json({ distances: results });
}));

async function handleQuickAction(orderId: string, actionType: string) {
    if (!orderId || !actionType) {
      throw new ValidationError("orderId och actionType krävs");
    }

    const validActions = ["needs_part", "customer_absent", "takes_longer"];
    if (!validActions.includes(actionType)) {
      throw new ValidationError("Ogiltig actionType");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) {
      throw new NotFoundError("Order hittades inte");
    }

    const timestamp = new Date().toLocaleString("sv-SE");
    const actionLabels: Record<string, string> = {
      needs_part: "Behöver reservdel",
      customer_absent: "Kund ej hemma",
      takes_longer: "Tar längre tid",
    };
    const label = actionLabels[actionType];
    const noteText = `[${timestamp}] Snabbåtgärd: ${label}`;
    const updatedNotes = order.notes
      ? `${order.notes}\n${noteText}`
      : noteText;

    const updateData: any = { notes: updatedNotes };

    if (actionType === "customer_absent") {
      updateData.status = "deferred";
    }

    if (actionType === "takes_longer") {
      const currentDuration = order.estimatedDuration || 60;
      updateData.estimatedDuration = Math.round(currentDuration * 1.5);
    }

    const existingMetadata = (order.metadata as Record<string, unknown>) || {};
    const existingFieldNotes = (existingMetadata.fieldNotes as Array<{ text: string; timestamp: string }>) || [];
    updateData.metadata = {
      ...existingMetadata,
      fieldNotes: [
        ...existingFieldNotes,
        { text: `Snabbåtgärd: ${label}`, timestamp: new Date().toISOString() },
      ],
    };

    if (actionType === "needs_part") {
      const existingMaterialNeeds = (existingMetadata.materialNeeds as string[]) || [];
      updateData.metadata.materialNeeds = [
        ...existingMaterialNeeds,
        `Reservdel behövs (rapporterad ${timestamp})`,
      ];
    }

    const updatedOrder = await storage.updateWorkOrder(orderId, updateData);

    console.log(`[mobile] Quick action '${actionType}' on order ${orderId}`);

    if (order.resourceId) {
      await notificationService.sendToResource(order.resourceId, {
        type: "job_updated",
        title: `Snabbåtgärd: ${label}`,
        message: `${label} har registrerats för ${order.title}`,
        orderId: order.id,
        data: { actionType, quickAction: true },
      });
    }

    broadcastPlannerEvent({
      type: "quick_action",
      data: {
        orderId,
        orderNumber: order.title || `WO-${orderId.substring(0, 8)}`,
        actionType,
        actionLabel: label,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      actionType,
      actionLabel: label,
      order: updatedOrder,
    };
}

app.post("/api/mobile/quick-action", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { orderId, actionType } = req.body;

    const order = await storage.getWorkOrder(orderId);
    if (order && order.resourceId !== resourceId) {
      throw new ForbiddenError("Ej behörig");
    }

    const result = await handleQuickAction(orderId, actionType);
    res.json(result);
}));

app.post("/api/quick-action", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { orderId, actionType } = req.body;
    const result = await handleQuickAction(orderId, actionType);
    res.json(result);
}));

app.post("/api/mobile/travel-times", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { latitude, longitude, destinations } = req.body;

    if (latitude == null || longitude == null || !Array.isArray(destinations) || destinations.length === 0) {
      throw new ValidationError("latitude, longitude och destinations krävs");
    }
    if (typeof latitude !== "number" || typeof longitude !== "number" || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new ValidationError("Ogiltiga koordinater");
    }

    const validDestinations = destinations.filter((dest: any) =>
      dest && typeof dest.id === "string" &&
      typeof dest.lat === "number" && typeof dest.lng === "number" &&
      dest.lat >= -90 && dest.lat <= 90 && dest.lng >= -180 && dest.lng <= 180
    );
    if (validDestinations.length === 0) {
      return res.json({ results: [], source: "none" });
    }

    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
    if (!GEOAPIFY_API_KEY) {
      const results = validDestinations.map((dest: { id: string; lat: number; lng: number }) => {
        const R = 6371;
        const dLat = (dest.lat - latitude) * Math.PI / 180;
        const dLon = (dest.lng - longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = R * c;
        const estMinutes = Math.round(distKm * 1.4);
        return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, durationMinutes: Math.max(1, estMinutes) };
      });
      return res.json({ results, source: "haversine" });
    }

    try {
      const results = await Promise.all(
        validDestinations.slice(0, 20).map(async (dest: { id: string; lat: number; lng: number }) => {
          try {
            const waypoints = `${latitude},${longitude}|${dest.lat},${dest.lng}`;
            const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Geoapify request failed");
            const data = await response.json();
            const route = data.features?.[0]?.properties;
            if (route) {
              return {
                id: dest.id,
                distanceKm: Math.round((route.distance / 1000) * 10) / 10,
                durationMinutes: Math.round(route.time / 60),
              };
            }
            throw new Error("No route data");
          } catch {
            const R = 6371;
            const dLat = (dest.lat - latitude) * Math.PI / 180;
            const dLon = (dest.lng - longitude) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distKm = R * c;
            return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, durationMinutes: Math.max(1, Math.round(distKm * 1.4)) };
          }
        })
      );
      res.json({ results, source: "geoapify" });
    } catch (error) {
      console.error("[mobile] Travel times error:", error);
      res.status(500).json({ error: "Kunde inte beräkna restider" });
    }
}));

app.get("/api/mobile/tasks/:id/metadata-context", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    if (!order.objectId) return res.json({ articles: [], metadata: [] });

    const tenantId = getTenantIdWithFallback(req);
    const allArticles = await storage.getArticles(tenantId);

    const orderArticleIds: string[] = [];
    if (order.articleId) orderArticleIds.push(order.articleId);

    const relevantArticles = allArticles.filter(a =>
      a.status === "active" && (
        a.fetchMetadataLabel ||
        a.canUpdateMetadata ||
        a.isInfoCarrier
      ) && (
        orderArticleIds.includes(a.id) ||
        !a.hookLevel ||
        (a.objectTypes && a.objectTypes.length === 0)
      )
    );

    const objectMetadata = await getArticleMetadataForObject(order.objectId, tenantId);

    const result = relevantArticles.map(article => {
      const fetchLabel = article.fetchMetadataLabel;
      const updateLabel = article.updateMetadataLabel;
      let fetchedValue: string | null = null;
      let previousValue: string | null = null;

      if (fetchLabel && objectMetadata) {
        const match = objectMetadata.find((m: any) =>
          m.katalog?.beteckning === fetchLabel || m.katalog?.namn === fetchLabel
        );
        if (match) {
          fetchedValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
        }
      }

      if (updateLabel && article.showPreviousValue && objectMetadata) {
        const match = objectMetadata.find((m: any) =>
          m.katalog?.beteckning === updateLabel || m.katalog?.namn === updateLabel
        );
        if (match) {
          previousValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
        }
      }

      return {
        articleId: article.id,
        articleName: article.name,
        articleNumber: article.articleNumber,
        isInfoCarrier: article.isInfoCarrier || false,
        fetchMetadataLabel: fetchLabel || null,
        fetchMetadataLabelFormat: article.fetchMetadataLabelFormat || null,
        fetchedValue,
        canUpdateMetadata: article.canUpdateMetadata || false,
        updateMetadataLabel: updateLabel || null,
        updateMetadataFormat: article.updateMetadataFormat || null,
        showPreviousValue: article.showPreviousValue || false,
        previousValue,
      };
    });

    res.json({ articles: result });
}));

app.post("/api/mobile/tasks/:id/metadata-update", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { articleId, metadataLabel, newValue, inspectionStatus, inspectionComment, inspectionPhoto } = req.body;

    if (!metadataLabel || newValue === undefined) {
      throw new ValidationError("metadataLabel och newValue krävs");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    if (!order.objectId) throw new ValidationError("Order saknar objekt");

    const tenantId = getTenantIdWithFallback(req);
    const objectMetadata = await getArticleMetadataForObject(order.objectId, tenantId);
    let previousValue: string | null = null;

    if (objectMetadata) {
      const match = objectMetadata.find((m: any) =>
        m.katalog?.beteckning === metadataLabel || m.katalog?.namn === metadataLabel
      );
      if (match) {
        previousValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
      }
    }

    const effectiveValue = inspectionStatus
      ? JSON.stringify({ status: inspectionStatus, value: newValue, comment: inspectionComment || null, photo: inspectionPhoto || null })
      : newValue;

    await writeArticleMetadataOnObject(order.objectId, metadataLabel, effectiveValue, tenantId, resourceId);

    await db.insert(taskMetadataUpdates).values({
      tenantId,
      workOrderId: orderId,
      objectId: order.objectId,
      articleId: articleId || null,
      metadataLabel,
      previousValue,
      newValue: effectiveValue,
      updatedBy: resourceId,
    });

    console.log(`[mobile] Metadata updated: ${metadataLabel} = ${effectiveValue} on object ${order.objectId} by ${resourceId}`);

    res.json({ success: true, previousValue, newValue: effectiveValue });
}));

// ============================================
// DISTANCE API — REST endpoints for distance calculations
// ============================================
app.post("/api/distance", asyncHandler(async (req: Request, res: Response) => {
    const { getRoutingDistance } = await import("../distance-matrix-service");
    const { fromLat, fromLng, toLat, toLng, origin, destination } = req.body;

    const lat1 = fromLat ?? origin?.lat;
    const lng1 = fromLng ?? origin?.lng;
    const lat2 = toLat ?? destination?.lat;
    const lng2 = toLng ?? destination?.lng;

    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) {
      throw new ValidationError("Koordinater krävs (fromLat/fromLng/toLat/toLng eller origin/destination)");
    }

    const result = await getRoutingDistance(lat1, lng1, lat2, lng2);
    res.json({
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      distanceMeters: Math.round(result.distanceKm * 1000),
      durationSeconds: result.durationMin * 60,
      source: result.source === "geoapify" ? "road_network" : result.source,
    });
}));

app.post("/api/distance/batch", asyncHandler(async (req: Request, res: Response) => {
    const { getBatchDistances } = await import("../distance-matrix-service");
    const { pairs } = req.body;

    if (!pairs || !Array.isArray(pairs)) {
      throw new ValidationError("pairs-array krävs");
    }

    const batchPairs = pairs.map((p: any, i: number) => ({
      id: p.id || String(i),
      fromLat: p.fromLat ?? p.origin?.lat,
      fromLng: p.fromLng ?? p.origin?.lng,
      toLat: p.toLat ?? p.destination?.lat,
      toLng: p.toLng ?? p.destination?.lng,
    }));

    const resultMap = await getBatchDistances(batchPairs);
    const resultsArray: any[] = [];
    const resultsById: Record<string, any> = {};

    for (const [id, r] of resultMap) {
      const entry = {
        id,
        distanceKm: r.distanceKm,
        durationMin: r.durationMin,
        distanceMeters: Math.round(r.distanceKm * 1000),
        durationSeconds: r.durationMin * 60,
        source: r.source === "geoapify" ? "road_network" : r.source,
      };
      resultsArray.push(entry);
      resultsById[id] = entry;
    }

    res.json({ results: resultsArray, resultsById });
}));

// ============================================
// MISSING MOBILE ENDPOINTS — GO compatibility
// ============================================

app.get("/api/mobile/map-config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    const tenantId = resource?.tenantId || getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings as any) || {};

    res.json({
      center: {
        lat: settings.mapCenterLat || resource?.homeLatitude || 57.7089,
        lng: settings.mapCenterLng || resource?.homeLongitude || 11.9746,
      },
      zoom: settings.mapDefaultZoom || 12,
      maxZoom: 18,
      minZoom: 5,
    });
}));

app.get("/api/mobile/team-invites", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    try {
      const invites = await db.execute(
        sql`SELECT t.*, tm.role as member_role FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.resource_id = ${resourceId} AND tm.status = 'invited'`
      );
      res.json(invites.rows || []);
    } catch {
      res.json([]);
    }
}));

app.get("/api/mobile/team-orders", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateParam = req.query.date as string;

    try {
      const teamRows = await db.execute(
        sql`SELECT DISTINCT t.id FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.resource_id = ${resourceId} AND tm.status = 'active'`
      );
      const teamIds = (teamRows.rows || []).map((r: any) => r.id);
      if (teamIds.length === 0) return res.json({ orders: [], total: 0 });

      const memberRows = await db.execute(
        sql`SELECT DISTINCT resource_id FROM team_members
            WHERE team_id = ANY(${teamIds}::text[]) AND resource_id != ${resourceId} AND status = 'active'`
      );
      const memberResourceIds = (memberRows.rows || []).map((r: any) => r.resource_id);
      if (memberResourceIds.length === 0) return res.json({ orders: [], total: 0 });

      const tenantId = getTenantIdWithFallback(req);
      const allOrders = await storage.getWorkOrders(tenantId);
      let orders = allOrders.filter(o => memberResourceIds.includes(o.resourceId));

      if (dateParam) {
        const target = new Date(dateParam);
        target.setHours(0, 0, 0, 0);
        const next = new Date(target);
        next.setDate(next.getDate() + 1);
        orders = orders.filter(o => {
          if (!o.scheduledDate) return false;
          const d = new Date(o.scheduledDate);
          return d >= target && d < next;
        });
      }

      res.json({ orders, total: orders.length });
    } catch {
      res.json({ orders: [], total: 0 });
    }
}));

app.post("/api/mobile/orders/:id/upload-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const { photo, caption, type: photoType } = req.body;
    if (!photo) throw new ValidationError("Photo-data krävs");

    const metadata = (order.metadata as Record<string, unknown>) || {};
    const photos = (metadata.photos as any[]) || [];
    const newPhoto = {
      id: `photo-${Date.now()}`,
      uri: photo,
      caption: caption || "",
      type: photoType || "general",
      uploadedAt: new Date().toISOString(),
      uploadedBy: resourceId,
    };
    photos.push(newPhoto);
    await storage.updateWorkOrder(orderId, { metadata: { ...metadata, photos } });
    res.json({ success: true, photo: newPhoto });
}));

app.post("/api/mobile/orders/:id/confirm-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const { photoId } = req.body;
    const metadata = (order.metadata as Record<string, unknown>) || {};
    const photos = (metadata.photos as any[]) || [];
    const photo = photos.find((p: any) => p.id === photoId);
    if (photo) {
      photo.confirmed = true;
      photo.confirmedAt = new Date().toISOString();
      await storage.updateWorkOrder(orderId, { metadata: { ...metadata, photos } });
    }
    res.json({ success: true });
}));

app.post("/api/mobile/orders/:id/customer-signoff", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const { customerName, signature, summary, materials, deviations } = req.body;
    if (!signature) throw new ValidationError("Signatur krävs");

    const metadata = (order.metadata as Record<string, unknown>) || {};
    metadata.customerSignoff = {
      customerName: customerName || "",
      signature,
      summary: summary || "",
      materials: materials || [],
      deviations: deviations || [],
      signedAt: new Date().toISOString(),
      signedBy: resourceId,
    };

    await storage.updateWorkOrder(orderId, {
      metadata: { ...metadata },
      executionStatus: "signed_off",
    });
    res.json({ success: true, signedAt: metadata.customerSignoff.signedAt });
}));

app.post("/api/mobile/notifications/:id/read", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const notification = await storage.markDriverNotificationRead(req.params.id, resourceId);
    if (!notification) throw new NotFoundError("Avisering hittades inte");
    res.json(notification);
}));

app.post("/api/mobile/notifications/read-all", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const count = await storage.markAllDriverNotificationsRead(resourceId);
    res.json({ success: true, markedRead: count });
}));

app.get("/api/resource_profile_assignments", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.query.resourceId as string || req.mobileResourceId;
    if (!resourceId) return res.json([]);

    try {
      const rows = await db.execute(
        sql`SELECT * FROM resource_profile_assignments WHERE resource_id = ${resourceId}`
      );
      res.json(rows.rows || []);
    } catch {
      res.json([]);
    }
}));

app.get("/resource_profile_assignments", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.query.resourceId as string || req.mobileResourceId;
    if (!resourceId) return res.json([]);

    try {
      const rows = await db.execute(
        sql`SELECT * FROM resource_profile_assignments WHERE resource_id = ${resourceId}`
      );
      res.json(rows.rows || []);
    } catch {
      res.json([]);
    }
}));

app.post("/api/mobile/push-token", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      expoPushToken: z.string(),
      platform: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const existing = await db.select().from(pushTokens)
      .where(and(eq(pushTokens.resourceId, resourceId), eq(pushTokens.expoPushToken, parsed.data.expoPushToken)));

    if (existing.length > 0) {
      await db.update(pushTokens)
        .set({ platform: parsed.data.platform, updatedAt: new Date() })
        .where(eq(pushTokens.id, existing[0].id));
    } else {
      await db.insert(pushTokens).values({
        tenantId: resource.tenantId,
        resourceId,
        expoPushToken: parsed.data.expoPushToken,
        platform: parsed.data.platform,
      });
    }

    res.json({ success: true });
}));

app.delete("/api/mobile/push-token", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { expoPushToken } = req.body || {};
    if (expoPushToken) {
      await db.delete(pushTokens).where(and(eq(pushTokens.resourceId, resourceId), eq(pushTokens.expoPushToken, expoPushToken)));
    } else {
      await db.delete(pushTokens).where(eq(pushTokens.resourceId, resourceId));
    }
    res.json({ success: true });
}));

app.post("/api/mobile/status", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const schema = z.object({
      online: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    await db.update(resources)
      .set({
        isOnline: parsed.data.online,
        lastSeenAt: new Date(),
      })
      .where(eq(resources.id, resourceId));

    res.json({ success: true, status: parsed.data.online ? "online" : "offline" });
}));

app.post("/api/mobile/disruptions/trigger/delay", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      orderId: z.union([z.number(), z.string()]),
      estimatedDelay: z.number(),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { triggerSignificantDelay } = await import("../disruption-service");
    const woId = String(parsed.data.orderId);
    const order = await storage.getWorkOrder(woId);
    const woTitle = order?.title || woId;

    const event = await triggerSignificantDelay(
      resource.tenantId, woId, woTitle,
      resourceId, resource.name,
      parsed.data.estimatedDelay, parsed.data.estimatedDelay * 2
    );

    res.json({ success: true, disruptionId: event?.id || null });
}));

app.post("/api/mobile/disruptions/trigger/early-completion", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      orderId: z.union([z.number(), z.string()]).optional(),
      savedMinutes: z.number(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { triggerEarlyCompletion } = await import("../disruption-service");
    const event = await triggerEarlyCompletion(resource.tenantId, resourceId, resource.name, parsed.data.savedMinutes);

    res.json({ success: true, disruptionId: event?.id || null });
}));

app.post("/api/mobile/disruptions/trigger/resource-unavailable", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      reason: z.string().optional(),
      estimatedReturn: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { triggerResourceUnavailable } = await import("../disruption-service");
    const event = await triggerResourceUnavailable(resource.tenantId, resourceId, resource.name, parsed.data.reason);

    res.json({ success: true, disruptionId: event?.id || null });
}));

// ========================================
// FAS 2: Team, search, time, stats, route, distance, config endpoints
// ========================================

app.get("/api/mobile/my-profiles", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const rows = await db.select().from(resourceProfileAssignments).where(eq(resourceProfileAssignments.resourceId, resourceId));
    res.json(rows);
}));

app.get("/api/mobile/my-team", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const memberships = await db.select().from(teamMembers)
      .where(eq(teamMembers.resourceId, resourceId));
    const teamIds = memberships.map(m => m.teamId);
    if (teamIds.length === 0) return res.json([]);

    const activeTeams = await db.select().from(teams)
      .where(and(inArray(teams.id, teamIds), eq(teams.status, "active")));

    const result = [];
    for (const team of activeTeams) {
      const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id));
      const memberDetails = [];
      for (const m of members) {
        const r = await storage.getResource(m.resourceId);
        memberDetails.push({ id: m.id, resourceId: m.resourceId, name: r?.name || "", role: m.role });
      }
      result.push({ ...team, members: memberDetails });
    }
    res.json(result);
}));

app.post("/api/mobile/teams", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({ name: z.string(), description: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const teamId = `team-${Date.now()}`;
    await db.insert(teams).values({
      id: teamId,
      tenantId: resource.tenantId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      leaderId: resourceId,
      status: "active",
    });
    await db.insert(teamMembers).values({
      id: `tm-${Date.now()}`,
      teamId,
      resourceId,
      role: "ledare",
    });

    res.json({ success: true, teamId });
}));

app.post("/api/mobile/teams/:id/invite", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const teamId = req.params.id;
    const schema = z.object({ resourceId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const team = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team.length) throw new NotFoundError("Team hittades inte");
    if (team[0].leaderId !== resourceId) throw new ForbiddenError("Bara teamledare kan bjuda in");

    const existing = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, parsed.data.resourceId)));
    if (existing.length > 0) return res.json({ success: true, message: "Redan medlem" });

    await db.insert(teamMembers).values({
      id: `tm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      teamId,
      resourceId: parsed.data.resourceId,
      role: "medlem",
    });
    res.json({ success: true });
}));

app.post("/api/mobile/teams/:id/accept", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const teamId = req.params.id;
    const existing = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
    if (existing.length === 0) throw new NotFoundError("Ingen inbjudan hittad");
    res.json({ success: true });
}));

app.post("/api/mobile/teams/:id/leave", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const teamId = req.params.id;
    await db.delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
    res.json({ success: true });
}));

app.delete("/api/mobile/teams/:id", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const teamId = req.params.id;
    const team = await db.select().from(teams).where(eq(teams.id, teamId));
    if (!team.length) throw new NotFoundError("Team hittades inte");
    if (team[0].leaderId !== resourceId) throw new ForbiddenError("Bara teamledare kan ta bort teamet");

    await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
    await db.update(teams).set({ status: "deleted", deletedAt: new Date() }).where(eq(teams.id, teamId));
    res.json({ success: true });
}));

app.get("/api/mobile/resources/search", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const q = (req.query.q as string || "").toLowerCase().trim();
    if (!q) return res.json([]);

    const allResources = await storage.getResources(resource.tenantId);
    const results = allResources
      .filter(r => r.status === "active" && r.name.toLowerCase().includes(q))
      .slice(0, 20)
      .map(r => ({ id: r.id, name: r.name, role: r.resourceType || "driver", avatarUrl: null }));
    res.json(results);
}));

app.post("/api/mobile/work-sessions/:id/entries", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      type: z.string(),
      startTime: z.string(),
      endTime: z.string().optional(),
      note: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const entryId = `we-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = new Date(parsed.data.startTime);
    const endTime = parsed.data.endTime ? new Date(parsed.data.endTime) : null;
    const durationMinutes = endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : null;

    await db.insert(workEntries).values({
      id: entryId,
      tenantId: resource.tenantId,
      workSessionId: req.params.id,
      resourceId,
      entryType: parsed.data.type,
      startTime,
      endTime,
      durationMinutes,
      notes: parsed.data.note || null,
    });

    res.json({ success: true, entryId });
}));

app.get("/api/mobile/orders/:id/time-entries", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const entries = await db.select().from(workEntries)
      .where(eq(workEntries.workOrderId, orderId))
      .orderBy(desc(workEntries.startTime));

    res.json(entries.map(e => ({
      id: e.id,
      type: e.entryType,
      startTime: e.startTime,
      endTime: e.endTime,
      duration: e.durationMinutes,
      note: e.notes,
    })));
}));

app.get("/api/mobile/time-summary", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateStr = req.query.date as string || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);

    const entries = await db.select().from(workEntries)
      .where(and(
        eq(workEntries.resourceId, resourceId),
        gte(workEntries.startTime, dayStart),
      ));

    const filtered = entries.filter(e => e.startTime && e.startTime <= dayEnd);
    let totalWork = 0, totalTravel = 0, totalBreak = 0;
    for (const e of filtered) {
      const mins = e.durationMinutes || 0;
      if (e.entryType === "travel") totalTravel += mins;
      else if (e.entryType === "break" || e.entryType === "rest") totalBreak += mins;
      else totalWork += mins;
    }

    res.json({
      totalWork, totalTravel, totalBreak,
      totalHours: Math.round((totalWork + totalTravel + totalBreak) / 60 * 10) / 10,
      date: dateStr,
    });
}));

app.get("/api/mobile/statistics", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const period = (req.query.period as string) || "week";
    let since: Date;
    const now = new Date();
    if (period === "month") {
      since = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === "all") {
      since = new Date("2020-01-01");
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      since = d;
    }

    const orders = await db.select().from(workOrders)
      .where(and(
        eq(workOrders.resourceId, resourceId),
        gte(workOrders.createdAt, since),
      ));

    const completed = orders.filter(o => o.status === "completed" || o.status === "avslutad");
    const deviations = await db.select().from(customerChangeRequests)
      .where(and(
        eq(customerChangeRequests.createdByResourceId, resourceId),
        gte(customerChangeRequests.createdAt, since),
      ));

    const entries = await db.select().from(workEntries)
      .where(and(
        eq(workEntries.resourceId, resourceId),
        gte(workEntries.startTime, since),
      ));

    const totalMinutes = entries.reduce((sum, e) => sum + (e.durationMinutes || 0), 0);
    const avgTime = completed.length > 0 ? Math.round(totalMinutes / completed.length) : 0;

    res.json({
      completedOrders: completed.length,
      avgTimePerOrder: avgTime,
      deviations: deviations.length,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      photos: 0,
      period,
    });
}));

app.get("/api/mobile/route", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateStr = req.query.date as string || new Date().toISOString().slice(0, 10);

    const orders = await db.select().from(workOrders)
      .where(and(
        eq(workOrders.resourceId, resourceId),
        sql`DATE(${workOrders.scheduledDate}) = ${dateStr}`,
      ))
      .orderBy(workOrders.scheduledStartTime);

    const orderList = [];
    for (const o of orders) {
      const obj = o.objectId ? await storage.getObject(o.objectId) : null;
      orderList.push({
        id: o.id,
        title: o.title,
        status: o.status,
        scheduledDate: o.scheduledDate,
        scheduledStartTime: o.scheduledStartTime,
        estimatedDuration: o.estimatedDuration,
        latitude: obj?.latitude || null,
        longitude: obj?.longitude || null,
        address: obj?.address || "",
        objectName: obj?.name || "",
      });
    }

    res.json({ orders: orderList, totalDistance: 0, estimatedDuration: 0 });
}));

app.get("/api/mobile/route-optimized", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateStr = req.query.date as string || new Date().toISOString().slice(0, 10);

    const orders = await db.select().from(workOrders)
      .where(and(
        eq(workOrders.resourceId, resourceId),
        sql`DATE(${workOrders.scheduledDate}) = ${dateStr}`,
      ))
      .orderBy(workOrders.scheduledStartTime);

    const orderList = [];
    for (const o of orders) {
      const obj = o.objectId ? await storage.getObject(o.objectId) : null;
      orderList.push({
        id: o.id,
        title: o.title,
        status: o.status,
        latitude: obj?.latitude || null,
        longitude: obj?.longitude || null,
        address: obj?.address || "",
        objectName: obj?.name || "",
        estimatedDuration: o.estimatedDuration,
      });
    }

    const withCoords = orderList.filter(o => o.latitude && o.longitude);
    if (withCoords.length <= 1) {
      return res.json({ orders: orderList, totalDistance: 0, estimatedDuration: 0, savings: 0 });
    }

    try {
      const { getRoutingDistance } = await import("../distance-matrix-service");
      let totalDistance = 0;
      for (let i = 0; i < withCoords.length - 1; i++) {
        const result = await getRoutingDistance(
          withCoords[i].latitude!, withCoords[i].longitude!,
          withCoords[i+1].latitude!, withCoords[i+1].longitude!
        );
        totalDistance += result.distanceKm;
      }
      res.json({ orders: orderList, totalDistance: Math.round(totalDistance), estimatedDuration: 0, savings: 0 });
    } catch {
      res.json({ orders: orderList, totalDistance: 0, estimatedDuration: 0, savings: 0 });
    }
}));

app.post("/api/mobile/distance", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      from: z.object({ lat: z.number(), lng: z.number() }),
      to: z.object({ lat: z.number(), lng: z.number() }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { getRoutingDistance } = await import("../distance-matrix-service");
    const result = await getRoutingDistance(parsed.data.from.lat, parsed.data.from.lng, parsed.data.to.lat, parsed.data.to.lng);
    res.json({ distance: result.distanceKm, duration: result.durationMin });
}));

app.post("/api/mobile/distance/batch", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      points: z.array(z.object({ lat: z.number(), lng: z.number() })).min(2),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { getRoutingDistance } = await import("../distance-matrix-service");
    const legs = [];
    let totalDistance = 0, totalDuration = 0;

    for (let i = 0; i < parsed.data.points.length - 1; i++) {
      const p1 = parsed.data.points[i];
      const p2 = parsed.data.points[i + 1];
      const result = await getRoutingDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      legs.push({
        from: p1,
        to: p2,
        distance: result.distanceKm,
        duration: result.durationMin,
      });
      totalDistance += result.distanceKm;
      totalDuration += result.durationMin;
    }

    res.json({ legs, totalDistance, totalDuration });
}));

app.get("/api/mobile/break-config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const tenant = await storage.getTenant(resource.tenantId);
    const settings = (tenant?.settings as Record<string, any>) || {};
    const breakConfig = settings.breakConfig || {};

    res.json({
      breakDuration: breakConfig.durationMinutes || 30,
      autoPlace: breakConfig.autoPlace ?? true,
      lunchStart: breakConfig.earliestStart || "11:00",
      lunchEnd: breakConfig.latestEnd || "13:00",
      breakType: breakConfig.breakType || "flexible",
    });
}));

app.get("/api/mobile/eta-notification/history", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const notifications = await db.select().from(etaNotificationsTable)
      .where(eq(etaNotificationsTable.tenantId, resource.tenantId))
      .orderBy(desc(etaNotificationsTable.createdAt))
      .limit(50);

    res.json(notifications.map(n => ({
      id: n.id,
      orderId: n.workOrderId,
      customerName: "",
      sentAt: n.createdAt,
      etaMinutes: n.etaTime ? parseInt(n.etaTime) : null,
      status: n.status,
    })));
}));

app.get("/api/mobile/eta-notification/config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const tenant = await storage.getTenant(resource.tenantId);
    const settings = (tenant?.settings as Record<string, any>) || {};
    const etaConfig = settings.etaNotification || {};

    res.json({
      enabled: etaConfig.enabled ?? true,
      autoSend: etaConfig.triggerOnEnRoute ?? true,
      marginMinutes: etaConfig.marginMinutes || 15,
    });
}));

app.post("/api/mobile/work-orders/carry-over", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const schema = z.object({
      orderIds: z.array(z.string()),
      targetDate: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    let movedCount = 0;
    const targetDate = new Date(parsed.data.targetDate);

    for (const orderId of parsed.data.orderIds) {
      const order = await storage.getWorkOrder(orderId);
      if (!order) continue;
      if (order.resourceId !== resourceId) continue;
      if (order.status === "completed" || order.status === "avslutad") continue;

      await db.update(workOrders)
        .set({ scheduledDate: targetDate })
        .where(eq(workOrders.id, orderId));
      movedCount++;
    }

    res.json({ success: true, movedCount });

    if (movedCount > 0) {
      notificationService.sendToResource(resourceId, {
        type: "schedule_changed",
        title: "Schema ändrat",
        message: `${movedCount} order(s) flyttade till ${parsed.data.targetDate}`,
        data: { event: "carry_over", movedCount, targetDate: parsed.data.targetDate }
      });
    }
}));

app.post("/api/mobile/work-orders/:id/auto-eta-sms", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const orderId = req.params.id;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");

    try {
      const result = await triggerETANotification(orderId, resource.tenantId, resourceId);
      res.json({
        success: true,
        etaMinutes: (result as any)?.etaMinutes || null,
        customerNotified: true,
      });
    } catch (err: any) {
      res.json({
        success: false,
        etaMinutes: null,
        customerNotified: false,
        error: err.message || "Kunde inte skicka ETA-notis",
      });
    }
}));

function getFallbackChecklist(orderType: string): string[] {
  const common = [
    "Kontrollera åtkomst och nycklar",
    "Dokumentera med foto före arbete",
    "Utför arbetet enligt order",
    "Kontrollera resultatet",
    "Dokumentera med foto efter arbete",
    "Städa arbetsplatsen",
  ];
  const typeSpecific: Record<string, string[]> = {
    installation: ["Verifiera leverans av material", "Montera enligt specifikation", "Testa funktion", "Instruera kunden"],
    inspection: ["Genomför visuell inspektion", "Fyll i besiktningsprotokoll", "Notera avvikelser"],
    repair: ["Identifiera felet", "Byt ut defekta delar", "Testa funktion efter reparation"],
    delivery: ["Verifiera leveransinnehåll", "Placera enligt kundens önskemål", "Inhämta kundsignatur"],
  };
  return typeSpecific[orderType] || common;
}

}
