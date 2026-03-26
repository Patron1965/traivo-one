import type { Express } from "express";
  import {
    MobileAuthenticatedRequest,
    storage, db, eq, and, gte, sql, desc,
    isMobileAuthenticated, isAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    workOrders, workEntries, workSessions,
    notificationService,
  } from "./shared";
  import type { Request, Response } from "express";
  
  export function registerWorkSessionRoutes(app: Express) {
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
  }
  