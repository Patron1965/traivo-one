import type { Express } from "express";
  import {
    MobileAuthenticatedRequest,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable,
    mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, writeArticleMetadataOnObject,
    handleWorkOrderStatusChange,
  } from "./shared";
  import type { Response } from "express";
  
  export function registerOrderRoutes(app: Express) {
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
      
      const metadata: any = order.metadata || {};
      const executionCodes = order.executionCode
        ? [{ id: order.executionCode, code: (order.executionCode as string).toUpperCase().substring(0, 4), name: order.executionCode }]
        : [];

      return {
        ...order,
        objectName: object?.name,
        objectAddress: object?.address,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        enRouteAt: order.onWayAt?.toISOString?.() || (order as any).onWayAt || null,
        customerNotified: false,
        isTeamOrder: !!order.teamId,
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
        subSteps: [],
        dependencies: [],
        inspections: metadata.inspections || [],
        executionCodes,
        timeRestrictions: null,
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

    const orderMetadata: any = order.metadata || {};
    const completedSubSteps: string[] = orderMetadata.completedSubSteps || [];
    const executionCodes = order.executionCode
      ? [{ id: order.executionCode, code: (order.executionCode as string).toUpperCase().substring(0, 4), name: order.executionCode }]
      : [];

    const [dependencies, timeRestrictions] = await Promise.all([
      storage.getTaskDependencies(orderId).catch(() => []),
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

    const restrictions = timeRestrictions.length > 0
      ? {
          earliestPickup: timeRestrictions.find((r: any) => r.startTime)?.startTime || null,
          latestPickup: timeRestrictions.find((r: any) => r.endTime)?.endTime || null,
          earliestDelivery: null,
          latestDelivery: null,
        }
      : null;

    const structuralArticles = order.structuralArticleId
      ? await storage.getStructuralArticlesByParent(order.structuralArticleId).catch(() => [])
      : [];
    const subSteps = structuralArticles.map((sa: any, idx: number) => ({
      id: sa.id,
      label: sa.stepLabel || `Steg ${idx + 1}`,
      completed: completedSubSteps.includes(sa.id),
    }));

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
      isTeamOrder: !!order.teamId,
      actualStartTime: order.onSiteAt?.toISOString?.() || (order as any).onSiteAt || null,
      plannedNotes: order.plannedNotes || null,
      executionStatus: order.executionStatus || "not_started",
      subSteps,
      dependencies: depDetails,
      inspections: orderMetadata.inspections || [],
      executionCodes,
      timeRestrictions: restrictions,
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
      type: "order:updated",
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
    executionStatus: order.executionStatus || "not_started",
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
    enRouteAt: order.onWayAt?.toISOString?.() || (order as any).onWayAt || null,
    customerNotified: false,
    isTeamOrder: !!order.teamId,
    actualStartTime: order.onSiteAt?.toISOString?.() || (order as any).onSiteAt || null,
    objectAccessCode: object?.accessCode || null,
    objectKeyNumber: object?.keyNumber || null,
    plannedNotes: order.plannedNotes || null,
    inspections: metadata.inspections || [],
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

  }
  