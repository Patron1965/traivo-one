import type { Express, NextFunction, Response } from "express";
import { isNotNull } from "drizzle-orm";
import {
  MobileAuthenticatedRequest,
  storage, db, eq, and, inArray, z,
  formatZodError, isMobileAuthenticated,
  asyncHandler,
  NotFoundError, ValidationError, ForbiddenError,
  resources, teams, teamMembers, resourceProfileAssignments,
  notificationService,
} from "./shared";
import { getStartOfISOWeek } from "../helpers";

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
  // Only return teams that belong to the authenticated resource's own tenant.
  const activeTeams = await db.select().from(teams)
    .where(and(inArray(teams.id, teamIds), eq(teams.status, statusFilter), eq(teams.tenantId, resource.tenantId)));

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
    acceptedAt: new Date(),
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

  // Verify the invited resource exists and belongs to the same tenant as the team.
  const invitedResource = await storage.getResource(parsed.data.resourceId);
  if (!invitedResource) throw new NotFoundError("Inbjuden resurs hittades inte");
  if (invitedResource.tenantId !== team[0].tenantId) throw new ForbiddenError("Inbjuden resurs tillhör en annan organisation");

  const existing = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, parsed.data.resourceId)));
  if (existing.length > 0) return res.json({ success: true, message: "Redan medlem" });

  await db.insert(teamMembers).values({
    id: `tm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    teamId,
    resourceId: parsed.data.resourceId,
    role: "medlem",
    acceptedAt: null,
  });
  notificationService.notifyTeamInvite(teamId, parsed.data.resourceId);
  res.json({ success: true });
});

const acceptHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const teamId = req.params.id;
  const existing = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
  if (existing.length === 0) throw new NotFoundError("Ingen inbjudan hittad");
  await db.update(teamMembers)
    .set({ acceptedAt: new Date() })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
  notificationService.notifyTeamMemberJoined(teamId, resourceId);
  res.json({ success: true });
});

const leaveHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const teamId = req.params.id;
  await db.delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.resourceId, resourceId)));
  notificationService.notifyTeamMemberLeft(teamId, resourceId);
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

// Individuella avvikelser i team (Task #1241) — läsande, för teamets egen vy
// i utförarappen. Scopeas alltid till den inloggade resursens egna team.
const teamDeviationsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  week: z.coerce.number().int().min(1).max(53),
});

const myTeamDeviationsHandler = asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
  const resourceId = req.mobileResourceId;
  const resource = await storage.getResource(resourceId);
  if (!resource) throw new NotFoundError("Resurs hittades inte");

  const parsed = teamDeviationsSchema.safeParse({ year: req.query.year, week: req.query.week });
  if (!parsed.success) {
    const formatted = formatZodError(parsed.error);
    throw new ValidationError(formatted.error, formatted.details);
  }

  const teamId = req.params.teamId;
  const membership = await db.select().from(teamMembers).where(
    and(eq(teamMembers.resourceId, resourceId), eq(teamMembers.teamId, teamId), isNotNull(teamMembers.acceptedAt))
  );
  if (membership.length === 0) {
    throw new ForbiddenError("Du tillhör inte detta team");
  }

  const weekStart = getStartOfISOWeek(parsed.data.year, parsed.data.week);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const result = await storage.getTeamDeviationsForWeek(
    resource.tenantId,
    teamId,
    weekStart,
    weekEnd,
    parsed.data.year,
    parsed.data.week,
  );
  if (!result) throw new NotFoundError("Team");
  res.json(result);
});

export function registerTeamRoutes(app: Express) {
  // Original /api/mobile/* routes
  app.get("/api/mobile/my-profiles", isMobileAuthenticated, myProfilesHandler);
  app.get("/api/mobile/my-team", isMobileAuthenticated, myTeamHandler);
  app.get("/api/mobile/teams/:teamId/deviations", isMobileAuthenticated, myTeamDeviationsHandler);
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
