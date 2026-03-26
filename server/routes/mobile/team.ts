import type { Express } from "express";
  import {
    MobileAuthenticatedRequest, enrichOrderForMobile, broadcastPlannerEvent, handleQuickAction, getFallbackChecklist,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    isAuthenticated,
    routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments, workEntries, workSessions,
    mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, writeArticleMetadataOnObject,
    handleWorkOrderStatusChange,
  } from "./shared";
  import type { Request, Response } from "express";
  
  export function registerTeamRoutes(app: Express) {
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

  }
  