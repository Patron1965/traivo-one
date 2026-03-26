import type { Express } from "express";
  import {
    MobileAuthenticatedRequest,
    storage, db, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError,
    ORDER_STATUSES, orderChecklistItems,
    notificationService, triggerETANotification, broadcastPlannerEvent,
    handleWorkOrderStatusChange,
  } from "./shared";
  import type { Response } from "express";
  
  export function registerSyncRoutes(app: Express) {
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
            const syncUpdated = await storage.updateWorkOrder(orderId, updateData);
            await storage.updateOfflineSyncLogStatus(logEntry.id, "completed");
            results.push({ clientId, status: "completed" });

            notificationService.sendToResource(resourceId, {
              type: "order:updated",
              title: "Order uppdaterad (sync)",
              message: `${syncUpdated.title || orderId} — status: ${newStatus}`,
              orderId,
              data: { status: newStatus, executionStatus: updateData.executionStatus, source: "sync" }
            });

            broadcastPlannerEvent({
              type: 'status_changed',
              data: { orderId, orderNumber: syncUpdated.title || `WO-${orderId.substring(0,8)}`, oldStatus: order.orderStatus || 'unknown', newStatus, driverName: resource?.name || '', timestamp: new Date().toISOString() }
            });
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

  }
  