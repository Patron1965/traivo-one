import type { Express } from "express";
  import {
    MobileAuthenticatedRequest, broadcastPlannerEvent, enrichOrderForMobile,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, visitConfirmationsTable,
    mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, writeArticleMetadataOnObject, findMissingRequiredLeaveMetadata,
    handleWorkOrderStatusChange,
  } from "./shared";
  import type { WorkOrder } from "./shared";
  import type { Response } from "express";
  import { taskDependencies, objects } from "@shared/schema";
  import { articleHasStockLocation, resolveStockLocation } from "../../services/logistics-task-expansion";
  import { reverseGeocode, buildAddressString } from "../../services/geocoding";

  // Löser effektiv produktionstid (minuter) ur redan hämtade listrader.
  // Prioritet: resurs-specifik (giltig) → generisk lista (giltig) → artikelns
  // bas-produktionstid. Work orders saknar utrustnings-koppling, så
  // utrustnings-specifika listrader (equipmentId satt) matchas aldrig här.
  function resolveProductionTimeFromLists(
    lists: Array<Record<string, unknown>>,
    resourceId: string | null,
    baseProductionTime: number | null,
  ): { productionTimeMinutes: number | null; productionTimeSource: "resource" | "list" | "article" | null } {
    const now = Date.now();
    const valid = lists.filter((l) => {
      const from = l.validFrom ? new Date(l.validFrom as string).getTime() : -Infinity;
      const to = l.validTo ? new Date(l.validTo as string).getTime() : Infinity;
      return now >= from && now <= to;
    });
    if (resourceId) {
      // Resurs-unik rad utan utrustnings-bindning (WO har ingen equipmentId).
      const byResource = valid.find((l) => l.performerResourceId === resourceId && !l.equipmentId);
      if (byResource) return { productionTimeMinutes: Number(byResource.productionTimeMinutes), productionTimeSource: "resource" };
    }
    const generic = valid.find((l) => !l.performerResourceId && !l.equipmentId);
    if (generic) return { productionTimeMinutes: Number(generic.productionTimeMinutes), productionTimeSource: "list" };
    if (baseProductionTime != null) return { productionTimeMinutes: baseProductionTime, productionTimeSource: "article" };
    return { productionTimeMinutes: null, productionTimeSource: null };
  }

  // Berikar WO-rader till mobil-artikelobjekt med Session 11/12-fält (filer,
  // rapporteringstyp, retur-flagga) + effektiv produktionstid. Slår upp artikel
  // och produktionstids-listor en gång per unikt articleId (undviker N+1).
  async function enrichMobileArticleLines(
    lines: Array<Record<string, unknown>>,
    tenantId: string,
    resourceId: string | null,
  ) {
    const uniqueArticleIds = Array.from(
      new Set(lines.map((l) => l.articleId as string).filter(Boolean)),
    );
    const articleMap = new Map<string, Record<string, unknown> | null>();
    const listMap = new Map<string, Array<Record<string, unknown>>>();
    await Promise.all(
      uniqueArticleIds.map(async (aid) => {
        const [article, lists] = await Promise.all([
          storage.getArticle(aid).catch(() => null) as Promise<Record<string, unknown> | null>,
          storage.getProductionTimeLists(tenantId, aid).catch(() => []) as Promise<Array<Record<string, unknown>>>,
        ]);
        articleMap.set(aid, article);
        listMap.set(aid, lists);
      }),
    );
    return lines.map((line) => {
      const aid = line.articleId as string;
      const article = articleMap.get(aid) ?? null;
      const lists = listMap.get(aid) ?? [];
      const pt = resolveProductionTimeFromLists(
        lists,
        resourceId,
        article?.productionTime != null ? Number(article.productionTime) : null,
      );
      return {
        id: line.id,
        articleId: line.articleId,
        articleNumber: (article?.articleNumber as string) || "",
        articleName: (article?.name as string) || "",
        quantity: line.quantity,
        resolvedPrice: line.resolvedPrice || 0,
        resolvedCost: line.resolvedCost || 0,
        // Session 11/12 — fält-rapportering & logistik
        files: article?.files ?? [],
        reportingType: article?.reportingType ?? null,
        reportingMetadataField: article?.reportingMetadataField ?? null,
        shouldBeReturned: article?.shouldBeReturned ?? false,
        productionTimeMinutes: pt.productionTimeMinutes,
        productionTimeSource: pt.productionTimeSource,
      };
    });
  }

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
    
    // Batcha objects + customers + eta-notifs i tre frågor istället för 3*N (N+1 → 3).
    const objectIds = Array.from(new Set(orders.map(o => o.objectId).filter((v): v is string => !!v)));
    const customerIds = Array.from(new Set(orders.map(o => o.customerId).filter((v): v is string => !!v)));
    const orderIdsWithEta = orders.filter(o => !!o.onWayAt).map(o => o.id);
    const [objectList, customerList, etaRows] = await Promise.all([
      objectIds.length > 0 ? storage.getObjectsByIds(tenantId, objectIds) : Promise.resolve([]),
      customerIds.length > 0 ? storage.getCustomersByIds(tenantId, customerIds) : Promise.resolve([]),
      orderIdsWithEta.length > 0
        ? db.select({ workOrderId: etaNotificationsTable.workOrderId })
            .from(etaNotificationsTable)
            .where(and(
              inArray(etaNotificationsTable.workOrderId, orderIdsWithEta),
              eq(etaNotificationsTable.status, "sent"),
            ))
        : Promise.resolve([] as Array<{ workOrderId: string }>),
    ]);
    const objectsById = new Map(objectList.map(o => [o.id, o]));
    const customersById = new Map(customerList.map(c => [c.id, c]));
    const notifiedOrderIds = new Set(etaRows.map(r => r.workOrderId));

    const enrichedOrders = orders.map((order) => {
      const object = order.objectId ? objectsById.get(order.objectId) ?? null : null;
      const customer = order.customerId ? customersById.get(order.customerId) ?? null : null;

      const metadata = (order.metadata as Record<string, unknown>) || {};
      const executionCodes = order.executionCode
        ? [{ id: order.executionCode, code: (order.executionCode as string).toUpperCase().substring(0, 4), name: order.executionCode }]
        : [];

      const scheduledStartIso =
        order.plannedWindowStart instanceof Date ? order.plannedWindowStart.toISOString() :
        (order.plannedWindowStart as string | null) || (order.scheduledStartTime as string | null) || null;
      const scheduledEndIso =
        order.plannedWindowEnd instanceof Date ? order.plannedWindowEnd.toISOString() :
        (order.plannedWindowEnd as string | null) || null;

      return {
        ...order,
        objectName: object?.name,
        objectAddress: object?.address,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        enRouteAt: order.onWayAt instanceof Date ? order.onWayAt.toISOString() : (order.onWayAt as string | null) || null,
        customerNotified: notifiedOrderIds.has(order.id),
        isTeamOrder: !!order.teamId,
        actualStartTime: order.onSiteAt instanceof Date ? order.onSiteAt.toISOString() : (order.onSiteAt as string | null) || null,
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
        scheduledStart: scheduledStartIso,
        scheduledEnd: scheduledEndIso,
        subSteps: [],
        dependencies: [],
        inspections: metadata.inspections || [],
        executionCodes,
        timeRestrictions: null,
        object: object ? { id: object.id, name: object.name, address: object.address, latitude: object.latitude, longitude: object.longitude } : null,
        customer: customer ? { id: customer.id, name: customer.name, customerNumber: customer.customerNumber } : null,
      };
    });
    
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

    const [etaCheck, visitRows] = await Promise.all([
      order.onWayAt
        ? db.select().from(etaNotificationsTable)
            .where(and(
              eq(etaNotificationsTable.workOrderId, orderId),
              eq(etaNotificationsTable.status, "sent"),
            ))
            .limit(1)
        : Promise.resolve([] as unknown[]),
      db.select({ signatureUrl: visitConfirmationsTable.signatureUrl })
        .from(visitConfirmationsTable)
        .where(eq(visitConfirmationsTable.workOrderId, orderId))
        .orderBy(desc(visitConfirmationsTable.confirmedAt))
        .limit(1)
        .catch(() => [] as Array<{ signatureUrl: string | null }>),
    ]);
    const signatureUrl = visitRows[0]?.signatureUrl || null;

    const orderMetadata = (order.metadata as Record<string, unknown>) || {};
    const completedSubSteps: string[] = (orderMetadata.completedSubSteps as string[]) || [];
    const executionCodes = order.executionCode
      ? [{ id: order.executionCode, code: (order.executionCode as string).toUpperCase().substring(0, 4), name: order.executionCode }]
      : [];

    const [dependencies, timeRestrictions] = await Promise.all([
      storage.getTaskDependencies(orderId).catch(() => []),
      order.objectId ? storage.getObjectTimeRestrictions(order.objectId).catch(() => []) : Promise.resolve([]),
    ]);

    const depDetails = await Promise.all(
      dependencies.map(async (dep: Record<string, unknown>) => {
        const depOrderId = dep.dependsOnWorkOrderId as string;
        const depOrder = await storage.getWorkOrder(depOrderId).catch(() => null);
        return {
          orderId: depOrderId,
          orderNumber: depOrder?.title || depOrderId,
          status: depOrder?.orderStatus || "unknown",
          type: dep.dependencyType === "sequential" ? "must_complete_first" : dep.dependencyType as string,
        };
      })
    );

    const restrictions = timeRestrictions.length > 0
      ? {
          earliestPickup: timeRestrictions.find((r: Record<string, unknown>) => r.startTime)?.startTime as string || null,
          latestPickup: timeRestrictions.find((r: Record<string, unknown>) => r.endTime)?.endTime as string || null,
          earliestDelivery: null,
          latestDelivery: null,
        }
      : null;

    const structuralArticles = order.structuralArticleId
      ? await storage.getStructuralArticlesByParent(order.structuralArticleId).catch(() => [])
      : [];
    const subSteps = structuralArticles.map((sa: Record<string, unknown>, idx: number) => ({
      id: sa.id,
      label: sa.stepLabel || `Steg ${idx + 1}`,
      completed: completedSubSteps.includes(sa.id),
    }));

    const orderLines = await storage.getWorkOrderLines(orderId).catch(() => []);
    const articles = await enrichMobileArticleLines(
      orderLines as Array<Record<string, unknown>>,
      order.tenantId,
      (order.resourceId as string) || null,
    );

    const detailScheduledStart =
      order.plannedWindowStart instanceof Date ? order.plannedWindowStart.toISOString() :
      (order.plannedWindowStart as string | null) || (order.scheduledStartTime as string | null) || null;
    const detailScheduledEnd =
      order.plannedWindowEnd instanceof Date ? order.plannedWindowEnd.toISOString() :
      (order.plannedWindowEnd as string | null) || null;

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
      deliveryPreferenceNotes: order.objectId ? (await storage.resolveDeliveryPreferences(order.objectId)).effective.notes || null : null,
      outsidePreferredWindow: order.outsidePreferredWindow ?? false,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      enRouteAt: order.onWayAt instanceof Date ? order.onWayAt.toISOString() : (order.onWayAt as string | null) || null,
      customerNotified: etaCheck.length > 0,
      isTeamOrder: !!order.teamId,
      actualStartTime: order.onSiteAt instanceof Date ? order.onSiteAt.toISOString() : (order.onSiteAt as string | null) || null,
      plannedNotes: order.plannedNotes || null,
      executionStatus: order.executionStatus || "not_started",
      scheduledStart: detailScheduledStart,
      scheduledEnd: detailScheduledEnd,
      signatureUrl,
      subSteps,
      articles,
      dependencies: depDetails,
      inspections: orderMetadata.inspections || [],
      executionCodes,
      timeRestrictions: restrictions,
      object: object ? { id: object.id, name: object.name, address: object.address, latitude: object.latitude, longitude: object.longitude } : null,
      customer: customer ? { id: customer.id, name: customer.name, customerNumber: customer.customerNumber } : null,
    });
}));

// Update work order status from mobile.
// Mobil-specifik handler — får inte slås ihop med `/api/work-orders/:id/status` eftersom
// den (a) accepterar mobil-status-alias (paborjad/utford/en_route/...), (b) skriver
// både `orderStatus` och `executionStatus` med tids-stämplar (`onWayAt`, `onSiteAt`,
// `completedAt`, `impossibleAt`), (c) triggar ETA-notiser och (d) returnerar berikad
// payload (object/customer/visitConfirmation). Se `docs/wo-status-endpoints.md`.
app.patch("/api/mobile/orders/:id/status", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const {
      status, notes, actualDuration: bodyActualDuration, enRouteAt: bodyEnRouteAt, impossibleReason,
      // Task #941: fångad bil/utrustning + deltagare vid klarmarkering.
      completedVehicleId: bodyCompletedVehicleId,
      completedEquipmentId: bodyCompletedEquipmentId,
      vehicleRegNo: bodyVehicleRegNo,
      participantIds: bodyParticipantIds,
    } = req.body;
    
    const order = await storage.getWorkOrder(orderId);
    
    if (!order) {
      throw new NotFoundError("Order hittades inte");
    }
    
    if (order.resourceId !== resourceId) {
      throw new ForbiddenError("Ej behörig");
    }
    
    const updateData: Record<string, unknown> = {};
    
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
      // Kap 6 (master-spec): obligatorisk informationslämning. Blockera slutförande
      // om någon artikel kräver leave-metadata (format "value") som varken finns på
      // objektet eller skickats med i begäran.
      if (order.objectId && order.tenantId) {
        const providedLeaveValues: Record<string, string> =
          (req.body?.leaveMetadataValues && typeof req.body.leaveMetadataValues === "object")
            ? (req.body.leaveMetadataValues as Record<string, string>)
            : {};
        const lines = await storage.getWorkOrderLines(orderId);
        const missing = await findMissingRequiredLeaveMetadata(lines, order.objectId, order.tenantId, providedLeaveValues);
        if (missing.length > 0) {
          throw new ValidationError(
            `Obligatorisk informationslämning saknas: ${missing.join(", ")}. Fyll i fält(en) innan uppgiften kan slutföras.`,
          );
        }
      }
      updateData.orderStatus = 'utford';
      updateData.executionStatus = 'completed';
      updateData.completedAt = new Date();
      if (bodyActualDuration !== undefined) {
        updateData.actualDuration = bodyActualDuration;
      } else if (order.onSiteAt) {
        updateData.actualDuration = Math.round((Date.now() - new Date(order.onSiteAt).getTime()) / 60000);
      }
      // Task #941: fånga vilken bil/utrustning och vilka utförare som användes så
      // att kostnadsställe/projektkod kan härledas automatiskt till Fortnox-exporten.
      // Allt valfritt — utelämnade fält lämnas orörda (back-compat).
      if (bodyCompletedVehicleId !== undefined) {
        updateData.completedVehicleId = bodyCompletedVehicleId || null;
      }
      if (bodyCompletedEquipmentId !== undefined) {
        updateData.completedEquipmentId = bodyCompletedEquipmentId || null;
      }
      if (bodyVehicleRegNo !== undefined) {
        updateData.completedVehicleRegNo = bodyVehicleRegNo || null;
      }
      if (bodyParticipantIds !== undefined) {
        const participantIds = Array.isArray(bodyParticipantIds)
          ? bodyParticipantIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
          : [];
        // Fall tillbaka på den utförande resursen om inga deltagare skickades.
        updateData.completedParticipantIds = participantIds.length > 0
          ? participantIds
          : (resourceId ? [resourceId] : null);
      } else if (resourceId) {
        // Ingen deltagarlista skickad: registrera åtminstone den inloggade utföraren.
        updateData.completedParticipantIds = [resourceId];
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

    const [etaCheck, statusVisitRows] = await Promise.all([
      updatedOrder.onWayAt
        ? db.select().from(etaNotificationsTable)
            .where(and(
              eq(etaNotificationsTable.workOrderId, orderId),
              eq(etaNotificationsTable.status, "sent"),
            ))
            .limit(1)
        : Promise.resolve([] as unknown[]),
      db.select({ signatureUrl: visitConfirmationsTable.signatureUrl })
        .from(visitConfirmationsTable)
        .where(eq(visitConfirmationsTable.workOrderId, orderId))
        .orderBy(desc(visitConfirmationsTable.confirmedAt))
        .limit(1)
        .catch(() => [] as Array<{ signatureUrl: string | null }>),
    ]);

    const statusScheduledStart =
      updatedOrder.plannedWindowStart instanceof Date ? updatedOrder.plannedWindowStart.toISOString() :
      (updatedOrder.plannedWindowStart as string | null) || (updatedOrder.scheduledStartTime as string | null) || null;
    const statusScheduledEnd =
      updatedOrder.plannedWindowEnd instanceof Date ? updatedOrder.plannedWindowEnd.toISOString() :
      (updatedOrder.plannedWindowEnd as string | null) || null;

    const enriched = {
      ...updatedOrder,
      enRouteAt: updatedOrder.onWayAt instanceof Date ? updatedOrder.onWayAt.toISOString() : (updatedOrder.onWayAt as string | null) || null,
      customerNotified: etaCheck.length > 0,
      actualStartTime: updatedOrder.onSiteAt instanceof Date ? updatedOrder.onSiteAt.toISOString() : (updatedOrder.onSiteAt as string | null) || null,
      customerName: customer?.name || null,
      objectName: object?.name || null,
      objectAddress: object?.address || null,
      objectAccessCode: object?.accessCode || null,
      objectKeyNumber: object?.keyNumber || null,
      scheduledStart: statusScheduledStart,
      scheduledEnd: statusScheduledEnd,
      signatureUrl: statusVisitRows[0]?.signatureUrl || null,
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

// Task #989: fältmarkering "ej utlämnad / ska återtas" ⇒ skapa retur-uppgift till lager.
// Returuppgiften ligger på artikelns lagerplats och beror på källordern (återtag sker
// EFTER leveransen). Mobil-ytan kringgår tenant-middleware — härled tenant ur ordern,
// läs aldrig req.tenantId. Idempotent per (källorder, artikel).
const returnToWarehouseSchema = z.object({
  articleId: z.string().optional(),
  reason: z.string().optional(),
});
app.post("/api/mobile/orders/:id/return-to-warehouse", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;

    const parsed = returnToWarehouseSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error));
    }
    const { articleId: bodyArticleId, reason } = parsed.data;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const tenantId = order.tenantId;
    if (!tenantId) throw new ForbiddenError("Order saknar tenant");
    // Defense-in-depth: bär mobil-token en tenant måste den matcha orderns tenant.
    if (req.mobileTenantId && req.mobileTenantId !== tenantId) {
      throw new ForbiddenError("Ej behörig");
    }

    // Hitta returnerbar artikel: explicit articleId (måste finnas på orderns rader)
    // annars första raden vars artikel är märkt shouldBeReturned.
    const lines = await storage.getWorkOrderLines(orderId);
    const lineArticleIds = new Set(
      lines.map((l) => l.articleId).filter((v): v is string => !!v),
    );

    let articleId: string | null = null;
    if (bodyArticleId) {
      if (!lineArticleIds.has(bodyArticleId)) {
        throw new ValidationError("Artikeln finns inte på denna order");
      }
      articleId = bodyArticleId;
    } else {
      for (const l of lines) {
        if (!l.articleId) continue;
        const a = await storage.getArticle(l.articleId);
        if (a && a.shouldBeReturned) {
          articleId = l.articleId;
          break;
        }
      }
    }
    if (!articleId) {
      throw new ValidationError("Ingen returnerbar artikel hittades på ordern");
    }

    const article = await storage.getArticle(articleId);
    if (!article || article.tenantId !== tenantId) {
      throw new NotFoundError("Artikel hittades inte");
    }
    if (!articleHasStockLocation(article)) {
      throw new ValidationError("Artikeln saknar lagerplats och kan inte återtas till lager");
    }

    // Idempotens: en retur-WO per (källorder, artikel). Återanrop returnerar den
    // befintliga utan dubblett (matchar via task_dependency.structuralArticleId).
    const existing = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .innerJoin(taskDependencies, eq(taskDependencies.workOrderId, workOrders.id))
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.parentWorkOrderId, order.id),
        eq(workOrders.logisticsRole, "return"),
        eq(taskDependencies.structuralArticleId, articleId),
      ))
      .limit(1);
    if (existing.length > 0) {
      if (!order.returnToWarehouse) {
        await storage.updateWorkOrder(orderId, { returnToWarehouse: true });
      }
      return res.json({ created: false, alreadyExists: true, returnWorkOrderId: existing[0].id });
    }

    const stock = resolveStockLocation(article);
    const returnWorkOrder = await storage.createWorkOrder({
      tenantId,
      customerId: order.customerId,
      objectId: order.objectId,
      resourceId: order.resourceId,
      title: `Återta: ${article.name}`,
      description: `Återtag till lager${stock.address ? `: ${stock.address}` : ""}.${reason ? ` Orsak: ${reason}` : ""}`,
      orderType: "service",
      priority: order.priority,
      status: "draft",
      orderStatus: order.resourceId ? "planerad_pre" : "skapad",
      executionStatus: "not_planned",
      creationMethod: "automatic",
      executionCode: order.executionCode || undefined,
      taskLatitude: article.stockLatitude || undefined,
      taskLongitude: article.stockLongitude || undefined,
      logisticsRole: "return",
      parentWorkOrderId: order.id,
    });

    // Beroende: returen sker EFTER källordern (deliver). work_orders-lagret är enda
    // sanningen för beroenden — länka aldrig över till assignments-tabellen.
    await storage.createTaskDependency({
      tenantId,
      workOrderId: returnWorkOrder.id,
      dependsOnWorkOrderId: order.id,
      dependencyType: "automatic",
      structuralArticleId: articleId,
    });

    // Markör på källordern så fältappen visar "ska återtas".
    await storage.updateWorkOrder(orderId, { returnToWarehouse: true });

    console.log(`[mobile] Return-to-warehouse WO ${returnWorkOrder.id} skapad för order ${orderId} (artikel ${articleId}) av resurs ${resourceId}`);

    res.json({
      created: true,
      returnWorkOrderId: returnWorkOrder.id,
      articleId,
      articleName: article.name,
      stockLocation: article.stockLocation,
    });
}));

// Task #990: fält-korrigering av objektets position. Tekniker på plats kan rätta
// koordinaterna direkt i appen. Mobil-ytan kringgår tenant-middleware — härled
// tenant ur en TILLDELAD work order för objektet (anti-IDOR), läs aldrig req.tenantId.
const correctObjectLocationSchema = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
});
app.patch("/api/mobile/objects/:id/location", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const objectId = req.params.id;
    const resourceId = req.mobileResourceId;

    const parsed = correctObjectLocationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).error);
    }
    const { latitude, longitude } = parsed.data;
    if (latitude === 0 && longitude === 0) {
      throw new ValidationError("Ogiltig position (0,0)");
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new ValidationError("Position utanför giltigt intervall");
    }

    // Behörighet: teknikern måste ha minst en tilldelad order för objektet.
    // Den ordern bär tenant-kontexten (mobil-ytan saknar tenant-middleware).
    const assigned = await db
      .select({ tenantId: workOrders.tenantId })
      .from(workOrders)
      .where(and(
        eq(workOrders.objectId, objectId),
        eq(workOrders.resourceId, resourceId),
      ))
      .limit(1);
    if (assigned.length === 0) {
      throw new ForbiddenError("Ej behörig att ändra objektets position");
    }
    const tenantId = assigned[0].tenantId;
    if (!tenantId) throw new ForbiddenError("Order saknar tenant");
    // Defense-in-depth: bär mobil-token en tenant måste den matcha.
    if (req.mobileTenantId && req.mobileTenantId !== tenantId) {
      throw new ForbiddenError("Ej behörig");
    }

    // Reverse-geocode best-effort: fyll adress/stad endast om de saknas idag.
    let geocodeUpdate: { address?: string; city?: string; postalCode?: string } = {};
    try {
      const [existing] = await db
        .select({ address: objects.address, city: objects.city, postalCode: objects.postalCode })
        .from(objects)
        .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)))
        .limit(1);
      const hasAddress = !!buildAddressString({
        address: existing?.address ?? null,
        postalCode: existing?.postalCode ?? null,
        city: existing?.city ?? null,
      });
      if (!hasAddress) {
        const rev = await reverseGeocode(latitude, longitude, tenantId);
        if (rev) {
          if (rev.address && !existing?.address) geocodeUpdate.address = rev.address;
          if (rev.city && !existing?.city) geocodeUpdate.city = rev.city;
          if (rev.postalCode && !existing?.postalCode) geocodeUpdate.postalCode = rev.postalCode;
        }
      }
    } catch (err) {
      console.warn(`[mobile] reverse-geocode misslyckades för objekt ${objectId}:`, err);
    }

    // Tenant-scopad UPDATE (defense-in-depth) — storage.updateObject saknar
    // tenant-predikat, så skriv inline med tenant_id i WHERE.
    const [updated] = await db
      .update(objects)
      .set({
        latitude,
        longitude,
        locationType: "pinpoint",
        ...geocodeUpdate,
      })
      .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)))
      .returning({ id: objects.id, latitude: objects.latitude, longitude: objects.longitude, locationType: objects.locationType });
    if (!updated) {
      throw new NotFoundError("Objekt hittades inte");
    }

    console.log(`[mobile] Objekt ${objectId} position korrigerad till (${latitude}, ${longitude}) av resurs ${resourceId}`);

    res.json({
      success: true,
      objectId: updated.id,
      latitude: updated.latitude,
      longitude: updated.longitude,
      locationType: updated.locationType,
      addressUpdated: Object.keys(geocodeUpdate).length > 0 ? geocodeUpdate : null,
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
    } as Partial<WorkOrder>);

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

    const metadata = (order.metadata as Record<string, unknown>) || {};
    if (!metadata.completedSubSteps) metadata.completedSubSteps = [];
    const completedSubSteps = metadata.completedSubSteps as string[];
    if (completed && !completedSubSteps.includes(stepId)) {
      completedSubSteps.push(stepId);
    } else if (!completed) {
      metadata.completedSubSteps = completedSubSteps.filter((s: string) => s !== stepId);
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

// List materials previously logged on an order. Combines the canonical
// `work_order_lines` rows (written by the mobile POST /materials handler)
// with any free-form `metadata.materialsUsed` entries (written by the
// offline-sync "material" action). Output shape matches Traivo Go's
// expectation: { articleId, articleNumber, articleName, quantity, comment, loggedBy, loggedAt }.
app.get("/api/mobile/orders/:id/materials", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const lines = await storage.getWorkOrderLines(orderId).catch(() => []);
    const articlesById = new Map<string, { articleNumber: string; name: string }>();
    await Promise.all(
      lines.map(async (line) => {
        if (!line.articleId || articlesById.has(line.articleId)) return;
        const article = await storage.getArticle(line.articleId).catch(() => null);
        if (article) {
          articlesById.set(line.articleId, {
            articleNumber: article.articleNumber || "",
            name: article.name || "",
          });
        }
      })
    );

    const fromLines = lines.map((line) => {
      const meta = articlesById.get(line.articleId as string);
      const createdAt = (line as { createdAt?: Date | string | null }).createdAt;
      return {
        id: line.id,
        articleId: line.articleId,
        articleNumber: meta?.articleNumber || "",
        articleName: meta?.name || "",
        quantity: line.quantity ?? 1,
        comment: "",
        loggedBy: null as string | null,
        loggedAt: createdAt instanceof Date ? createdAt.toISOString() : (createdAt as string | null) || null,
        source: "work_order_line" as const,
      };
    });

    const orderMeta = (order.metadata as Record<string, unknown>) || {};
    const metaMaterials = Array.isArray((orderMeta as { materialsUsed?: unknown }).materialsUsed)
      ? ((orderMeta as { materialsUsed: Array<Record<string, unknown>> }).materialsUsed)
      : [];
    const fromMetadata = metaMaterials.map((m, idx) => ({
      id: `meta-${idx}`,
      articleId: (m.articleId as string) || null,
      articleNumber: (m.articleNumber as string) || "",
      articleName: (m.articleName as string) || "",
      quantity: (m.quantity as number) ?? 1,
      comment: (m.comment as string) || "",
      loggedBy: (m.loggedBy as string) || null,
      loggedAt: (m.loggedAt as string) || null,
      source: "metadata" as const,
    }));

    const items = [...fromLines, ...fromMetadata];
    res.json({ items, total: items.length });
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
      inspections.map((insp: Record<string, unknown>) =>
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

// ============================================================
// ADR v3 (F7): Mobile v2 endpoint
// Exponerar frozen-snapshot, BOM-checklista, beroende-status.
// v1 (/api/mobile/orders/:id) ar oforandrad — Go-appen kan
// adoptera v2 nar den ar redo utan baklangeskompatibilitetsbrott.
// ============================================================
app.get("/api/mobile/v2/orders/:id", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const tenantId = getTenantIdWithFallback(req);

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behorig");

    const [object, customer, dependencies, orderLines] = await Promise.all([
      order.objectId ? storage.getObject(order.objectId) : Promise.resolve(null),
      order.customerId ? storage.getCustomer(order.customerId) : Promise.resolve(null),
      storage.getTaskDependencies(orderId).catch(() => []),
      storage.getWorkOrderLines(orderId).catch(() => []),
    ]);

    // F5 — frozen-snapshot (audit-immutabelt prislas).
    const wo = order as Record<string, unknown>;
    const frozen = (wo.frozenUnitPrice != null && wo.frozenQuantity != null && Number(wo.frozenQuantity) > 0)
      ? {
          isFrozen: true,
          quantity: Number(wo.frozenQuantity),
          unitPrice: Number(wo.frozenUnitPrice),
          unitCost: wo.frozenUnitCost != null ? Number(wo.frozenUnitCost) : null,
          unitTime: wo.frozenUnitTime != null ? Number(wo.frozenUnitTime) : null,
          frozenAt: wo.frozenAt || null,
          totalPrice: Number(wo.frozenUnitPrice) * Number(wo.frozenQuantity),
        }
      : { isFrozen: false };

    // F4 — BOM-checklista. For varje WO-rad med strukturartikel, hamta
    // komponentrader sa fältarbetaren kan bocka av varje del.
    const bomChecklist: Array<Record<string, unknown>> = [];
    for (const line of orderLines as Array<Record<string, unknown>>) {
      const article = await storage.getArticle(line.articleId as string).catch(() => null);
      if (!article || !(article as Record<string, unknown>).isStructure) continue;
      const components = await storage.getArticleComponents(line.articleId as string, tenantId).catch(() => []);
      if (!components.length) continue;
      const items = await Promise.all(components.map(async (c: Record<string, unknown>) => {
        const child = await storage.getArticle(c.childArticleId as string).catch(() => null);
        return {
          componentId: c.id,
          articleId: c.childArticleId,
          articleNumber: (child as Record<string, unknown>)?.articleNumber || "",
          articleName: (child as Record<string, unknown>)?.name || "",
          quantityPerParent: Number(c.quantity ?? 1),
          totalRequired: Number(c.quantity ?? 1) * Number(line.quantity ?? 1),
          unit: c.unit || (child as Record<string, unknown>)?.unit || null,
          notes: c.notes || null,
        };
      }));
      bomChecklist.push({
        parentLineId: line.id,
        parentArticleId: line.articleId,
        parentArticleName: (article as Record<string, unknown>).name,
        parentQuantity: Number(line.quantity ?? 1),
        items,
      });
    }

    // F4 (utokat) — om WO har structuralArticleId pa toppnivan, exponera den ocksa.
    if ((order as Record<string, unknown>).structuralArticleId) {
      const sid = (order as Record<string, unknown>).structuralArticleId as string;
      if (!bomChecklist.find(b => b.parentArticleId === sid)) {
        const components = await storage.getArticleComponents(sid, tenantId).catch(() => []);
        if (components.length) {
          const parent = await storage.getArticle(sid).catch(() => null);
          const items = await Promise.all(components.map(async (c: Record<string, unknown>) => {
            const child = await storage.getArticle(c.childArticleId as string).catch(() => null);
            return {
              componentId: c.id,
              articleId: c.childArticleId,
              articleNumber: (child as Record<string, unknown>)?.articleNumber || "",
              articleName: (child as Record<string, unknown>)?.name || "",
              quantityPerParent: Number(c.quantity ?? 1),
              totalRequired: Number(c.quantity ?? 1),
              unit: c.unit || (child as Record<string, unknown>)?.unit || null,
              notes: c.notes || null,
            };
          }));
          bomChecklist.push({
            parentLineId: null,
            parentArticleId: sid,
            parentArticleName: (parent as Record<string, unknown>)?.name || "Strukturartikel",
            parentQuantity: 1,
            items,
          });
        }
      }
    }

    // Beroende-status — varje dep med blockerande/icke-blockerande flagga.
    const dependencyStatus = await Promise.all(
      (dependencies as Array<Record<string, unknown>>).map(async (dep) => {
        const depOrderId = dep.dependsOnWorkOrderId as string;
        const depOrder = await storage.getWorkOrder(depOrderId).catch(() => null);
        const depStatus = (depOrder as Record<string, unknown>)?.orderStatus as string || "unknown";
        const isCompleted = ["completed", "invoiced", "closed"].includes(depStatus);
        const depType = dep.dependencyType === "sequential" ? "must_complete_first" : (dep.dependencyType as string);
        const isBlocking = depType === "must_complete_first" && !isCompleted;
        return {
          orderId: depOrderId,
          orderTitle: (depOrder as Record<string, unknown>)?.title || depOrderId,
          status: depStatus,
          type: depType,
          isCompleted,
          isBlocking,
        };
      })
    );
    const canStart = !dependencyStatus.some(d => d.isBlocking);

    // Berikade artiklar — Session 11/12-fält + effektiv produktionstid.
    const articles = await enrichMobileArticleLines(
      orderLines as Array<Record<string, unknown>>,
      order.tenantId,
      (order.resourceId as string) || null,
    );

    res.json({
      apiVersion: "v2",
      orderId: order.id,
      title: order.title,
      orderStatus: order.orderStatus,
      executionStatus: order.executionStatus || "not_started",
      scheduledStart: order.plannedWindowStart instanceof Date ? order.plannedWindowStart.toISOString() : (order.plannedWindowStart as string | null) || null,
      scheduledEnd: order.plannedWindowEnd instanceof Date ? order.plannedWindowEnd.toISOString() : (order.plannedWindowEnd as string | null) || null,
      object: object ? { id: object.id, name: object.name, address: object.address, latitude: object.latitude, longitude: object.longitude } : null,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      // === ADR v3-fält ===
      frozen,
      articles,
      bomChecklist,
      dependencyStatus,
      canStart,
      blockedBy: dependencyStatus.filter(d => d.isBlocking).map(d => d.orderId),
    });
}));

  }
  