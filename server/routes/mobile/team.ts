import type { Express, NextFunction, Response } from "express";
import {
  MobileAuthenticatedRequest,
  storage, db, eq, and, inArray, z,
  formatZodError, isMobileAuthenticated,
  asyncHandler,
  NotFoundError, ValidationError, ForbiddenError,
  resources, teams, teamMembers, resourceProfileAssignments,
} from "./shared";

const myProfilesHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const rows = await db.select().from(resourceProfileAssignments).where(eq(resourceProfileAssignments.resourceId, resourceId));
  res.json(rows);
});

const myTeamHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const resource = await storage.getResource(resourceId);
  if (!resource) throw new NotFoundError("Resurs hittades inte");

  // Allow Go-style query: /api/teams?memberId=X. We always scope to the
  // authenticated resource (no cross-tenant lookups).
  const memberships = await db.select().from(teamMembers)
    .where(eq(teamMembers.resourceId, resourceId));
  const teamIds = memberships.map(m => m.teamId);
  if (teamIds.length === 0) return res.json([]);

  const statusFilter = (req.query.status as string | undefined) || "active";
  const activeTeams = await db.select().from(teams)
    .where(and(inArray(teams.id, teamIds), eq(teams.status, statusFilter)));

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
});

const createTeamHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
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
});

const inviteHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
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
});

const acceptHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const teamId = req.params.id;
  const existing = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
  if (existing.length === 0) throw new NotFoundError("Ingen inbjudan hittad");
  res.json({ success: true });
});

const leaveHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const teamId = req.params.id;
  await db.delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
  res.json({ success: true });
});

const deleteTeamHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const teamId = req.params.id;
  const team = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team.length) throw new NotFoundError("Team hittades inte");
  if (team[0].leaderId !== resourceId) throw new ForbiddenError("Bara teamledare kan ta bort teamet");

  await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
  await db.update(teams).set({ status: "deleted", deletedAt: new Date() }).where(eq(teams.id, teamId));
  res.json({ success: true });
});

const resourceSearchHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
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
});

export function registerTeamRoutes(app: Express) {
  // Original /api/mobile/* routes
  app.get("/api/mobile/my-profiles", isMobileAuthenticated, myProfilesHandler);
  app.get("/api/mobile/my-team", isMobileAuthenticated, myTeamHandler);
  app.post("/api/mobile/teams", isMobileAuthenticated, createTeamHandler);
  app.post("/api/mobile/teams/:id/invite", isMobileAuthenticated, inviteHandler);
  app.post("/api/mobile/teams/:id/accept", isMobileAuthenticated, acceptHandler);
  app.post("/api/mobile/teams/:id/leave", isMobileAuthenticated, leaveHandler);
  app.delete("/api/mobile/teams/:id", isMobileAuthenticated, deleteTeamHandler);
  app.get("/api/mobile/resources/search", isMobileAuthenticated, resourceSearchHandler);
}

// Go-compat aliases. Registered EARLY (before web/admin route handlers) so they
// take precedence for Bearer-token requests. Non-Bearer requests fall through
// to the web/admin handler registered later via next("route").
export function registerTeamAliasRoutes(app: Express) {
  const ifBearer = (handler: (req: MobileAuthenticatedRequest, res: Response, next: NextFunction) => void) => {
    return [
      (req: MobileAuthenticatedRequest, _res: Response, next: NextFunction) => {
        const auth = req.headers.authorization || "";
        if (!auth.toLowerCase().startsWith("bearer ")) return next("route");
        return next();
      },
      isMobileAuthenticated,
      handler,
    ];
  };
  app.get("/api/teams", ...ifBearer(myTeamHandler));
  app.post("/api/teams", ...ifBearer(createTeamHandler));
  app.delete("/api/teams/:id", ...ifBearer(deleteTeamHandler));
  app.post("/api/teams/:id/invite", ...ifBearer(inviteHandler));
  app.post("/api/teams/:id/accept", ...ifBearer(acceptHandler));
  app.post("/api/teams/:id/leave", ...ifBearer(leaveHandler));
  app.get("/api/resources/search", ...ifBearer(resourceSearchHandler));
}
