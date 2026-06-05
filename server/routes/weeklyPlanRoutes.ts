/**
 * Veckoplanering — REST-API (Task #786).
 *
 * Tunna, tenant-scopade routes med Zod-validering. All affärslogik ligger i
 * `server/planning/weeklyPlanEngine.ts` och `server/storage.ts`. Mutationer som
 * påverkar KPI:er (block/personliga block/travel) triggar omräkning av planen.
 *
 * Tenant-ägarskap: tenantId sätts alltid server-side (aldrig från body) och
 * alla storage-anrop tar (tenantId, id) → UPDATE/DELETE har tenant_id i WHERE.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { formatZodError } from "./helpers";
import {
  getTenantIdWithFallback,
  requireTenantWithFallback,
  requireRole,
} from "../tenant-middleware";
import {
  insertGeographicDistrictSchema,
  insertDistrictZoneSchema,
  insertWeeklyPlanSchema,
  insertWeeklyPlanTaskSchema,
  insertPersonalTaskSchema,
  insertPersonalTaskScheduleSchema,
  insertTravelTimeEntrySchema,
  insertPreTaskSchema,
  insertExecTypePreTaskRuleSchema,
} from "@shared/schema";
import {
  recomputeWeeklyPlan,
  recomputeTravelForPlan,
  materializeSchedulesForPlan,
  generatePreTasksForWorkOrder,
  convertPersonalTimeToOrdered,
  DEFAULT_PLAN_ENGINE_CONFIG,
} from "../planning/weeklyPlanEngine";

const requirePlannerAccess = requireRole("owner", "admin", "planner");

// Parsar body mot ett insert-schema utan tenantId (sätts server-side) och
// kastar ValidationError med strukturerade fältfel vid fel.
function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    throw new ValidationError(formatted.error, formatted.details);
  }
  return result.data;
}

export function registerWeeklyPlanRoutes(app: Express) {
  const guard: RequestHandler[] = [requireTenantWithFallback, requirePlannerAccess];

  // ==========================================================================
  // Grovplanering — serveraggregat per vecka (Task #795)
  // ==========================================================================
  const roughSummarySchema = z.object({
    week: z.string().regex(/^\d{4}-W\d{2}$/, "Ogiltig vecka (format YYYY-Www)"),
    districtId: z.string().min(1).optional(),
  });

  app.get("/api/rough-planning/summary", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = roughSummarySchema.safeParse({
      week: req.query.week,
      districtId: typeof req.query.districtId === "string" && req.query.districtId ? req.query.districtId : undefined,
    });
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const summary = await storage.getRoughPlanningSummary(
      tenantId,
      parsed.data.week,
      parsed.data.districtId,
    );
    res.json(summary);
  }));

  // Ogrovplanerade (aktiva) ordrar — paginerat, separat från aggregatet.
  app.get("/api/rough-planning/unplanned", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
    const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    res.json(await storage.getUnplannedRoughWorkOrders(tenantId, limit, offset));
  }));

  // ==========================================================================
  // Distrikt
  // ==========================================================================
  const districtCreateSchema = insertGeographicDistrictSchema.omit({ tenantId: true });
  const districtPatchSchema = districtCreateSchema.partial();

  app.get("/api/districts", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    res.json(await storage.getGeographicDistricts(tenantId));
  }));

  app.get("/api/districts/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const row = await storage.getGeographicDistrict(tenantId, req.params.id);
    if (!row) throw new NotFoundError("Distrikt");
    res.json(row);
  }));

  app.post("/api/districts", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(districtCreateSchema, req.body);
    res.status(201).json(await storage.createGeographicDistrict({ ...data, tenantId }));
  }));

  app.patch("/api/districts/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(districtPatchSchema, req.body);
    const row = await storage.updateGeographicDistrict(tenantId, req.params.id, data);
    if (!row) throw new NotFoundError("Distrikt");
    res.json(row);
  }));

  app.delete("/api/districts/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getGeographicDistrict(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Distrikt");
    await storage.deleteGeographicDistrict(tenantId, req.params.id);
    res.status(204).end();
  }));

  // ==========================================================================
  // Distrikt-zoner
  // ==========================================================================
  const zoneCreateSchema = insertDistrictZoneSchema.omit({ tenantId: true });
  const zonePatchSchema = zoneCreateSchema.partial();

  app.get("/api/district-zones", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const districtId = typeof req.query.districtId === "string" ? req.query.districtId : undefined;
    res.json(await storage.getDistrictZones(tenantId, districtId));
  }));

  app.get("/api/district-zones/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const row = await storage.getDistrictZone(tenantId, req.params.id);
    if (!row) throw new NotFoundError("Zon");
    res.json(row);
  }));

  app.post("/api/district-zones", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(zoneCreateSchema, req.body);
    const district = await storage.getGeographicDistrict(tenantId, data.districtId);
    if (!district) throw new ValidationError("Distriktet finns inte i denna tenant");
    res.status(201).json(await storage.createDistrictZone({ ...data, tenantId }));
  }));

  app.patch("/api/district-zones/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(zonePatchSchema, req.body);
    const row = await storage.updateDistrictZone(tenantId, req.params.id, data);
    if (!row) throw new NotFoundError("Zon");
    res.json(row);
  }));

  app.delete("/api/district-zones/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getDistrictZone(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Zon");
    await storage.deleteDistrictZone(tenantId, req.params.id);
    res.status(204).end();
  }));

  // ==========================================================================
  // Veckoplaner
  // ==========================================================================
  const planCreateSchema = insertWeeklyPlanSchema.omit({ tenantId: true });
  const planPatchSchema = planCreateSchema.partial();

  app.get("/api/weekly-plans", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const year = req.query.year ? parseInt(String(req.query.year), 10) : undefined;
    const weekNumber = req.query.week ? parseInt(String(req.query.week), 10) : undefined;
    res.json(await storage.getWeeklyPlans(tenantId, { teamId, status, year, weekNumber }));
  }));

  app.get("/api/weekly-plans/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.id);
    if (!plan) throw new NotFoundError("Veckoplan");
    const [tasks, personalTasks, travelEntries, warnings] = await Promise.all([
      storage.getWeeklyPlanTasks(tenantId, plan.id),
      storage.getPersonalTasks(tenantId, { weeklyPlanId: plan.id }),
      storage.getTravelTimeEntries(tenantId, plan.id),
      storage.getWeeklyPlanWarnings(tenantId, plan.id),
    ]);
    // Berika varje uppgift med work-order-/objektfakta (namn, ordervärde,
    // koordinater, plats) så att översikten kan visa jobbnamn, ordervärde-tabell
    // och platser utan separata klient-anrop. Serverberäknade nyckeltal
    // (antal uppdrag + antal objekt) returneras färska.
    const facts = await storage.getWeeklyPlanTaskFacts(tenantId, tasks.map((t) => t.taskId));
    const factMap = new Map(facts.map((f) => [f.taskId, f]));
    const enrichedTasks = tasks.map((t) => {
      const f = factMap.get(t.taskId);
      return {
        ...t,
        name: f?.name ?? null,
        value: f?.value ?? 0,
        productionMinutes: t.productionMinutes ?? f?.productionMinutes ?? 0,
        lat: f?.lat ?? null,
        lng: f?.lng ?? null,
        objectId: f?.objectId ?? null,
        locationName: f?.locationName ?? null,
      };
    });
    const objectCount = new Set(
      enrichedTasks.map((t) => t.objectId).filter((id): id is string => !!id),
    ).size;
    res.json({
      ...plan,
      tasks: enrichedTasks,
      personalTasks,
      travelEntries,
      warnings,
      taskCount: enrichedTasks.length,
      objectCount,
    });
  }));

  app.post("/api/weekly-plans", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(planCreateSchema, req.body);
    const team = await storage.getTeam(data.teamId);
    if (!team || team.tenantId !== tenantId) {
      throw new ValidationError("Teamet finns inte i denna tenant");
    }
    const plan = await storage.createWeeklyPlan({ ...data, tenantId });
    res.status(201).json(plan);
  }));

  app.patch("/api/weekly-plans/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(planPatchSchema, req.body);
    const row = await storage.updateWeeklyPlan(tenantId, req.params.id, data);
    if (!row) throw new NotFoundError("Veckoplan");
    res.json(row);
  }));

  app.delete("/api/weekly-plans/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWeeklyPlan(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Veckoplan");
    await storage.deleteWeeklyPlan(tenantId, req.params.id);
    res.status(204).end();
  }));

  // Omräkning av KPI:er + varningar (valfritt även travel via ?travel=true).
  app.post("/api/weekly-plans/:id/recompute", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const recomputeTravel = req.query.travel === "true" || req.body?.recomputeTravel === true;
    const result = await recomputeWeeklyPlan(tenantId, req.params.id, { recomputeTravel });
    if (!result) throw new NotFoundError("Veckoplan");
    res.json(result);
  }));

  // Räkna om distans/kostnad/CO2 för planens travel-entries.
  app.post("/api/weekly-plans/:id/recompute-travel", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.id);
    if (!plan) throw new NotFoundError("Veckoplan");
    const travel = await recomputeTravelForPlan(tenantId, plan.id, DEFAULT_PLAN_ENGINE_CONFIG);
    const result = await recomputeWeeklyPlan(tenantId, plan.id);
    res.json({ travel, plan: result?.plan, summary: result?.summary });
  }));

  // Materialisera återkommande personliga scheman in i planen.
  app.post("/api/weekly-plans/:id/materialize-schedules", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.id);
    if (!plan) throw new NotFoundError("Veckoplan");
    const result = await materializeSchedulesForPlan(tenantId, plan.id);
    res.json(result);
  }));

  // ==========================================================================
  // Veckoplan-uppgifter (block kopplade till work_orders)
  // ==========================================================================
  const taskCreateSchema = insertWeeklyPlanTaskSchema.omit({ tenantId: true, weeklyPlanId: true });
  const taskPatchSchema = taskCreateSchema.partial();

  app.get("/api/weekly-plans/:planId/tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    res.json(await storage.getWeeklyPlanTasks(tenantId, plan.id));
  }));

  app.post("/api/weekly-plans/:planId/tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    const data = parseBody(taskCreateSchema, req.body);
    const created = await storage.createWeeklyPlanTask({ ...data, tenantId, weeklyPlanId: plan.id });
    await recomputeWeeklyPlan(tenantId, plan.id);
    res.status(201).json(created);
  }));

  app.patch("/api/weekly-plan-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWeeklyPlanTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Veckoplan-uppgift");
    const data = parseBody(taskPatchSchema, req.body);
    const row = await storage.updateWeeklyPlanTask(tenantId, req.params.id, data);
    if (existing.weeklyPlanId) await recomputeWeeklyPlan(tenantId, existing.weeklyPlanId);
    res.json(row);
  }));

  app.delete("/api/weekly-plan-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWeeklyPlanTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Veckoplan-uppgift");
    await storage.deleteWeeklyPlanTask(tenantId, req.params.id);
    if (existing.weeklyPlanId) await recomputeWeeklyPlan(tenantId, existing.weeklyPlanId);
    res.status(204).end();
  }));

  // ==========================================================================
  // Personliga block (vila, rast, personlig tid, inställelse/återresa)
  // ==========================================================================
  const personalCreateSchema = insertPersonalTaskSchema.omit({ tenantId: true, weeklyPlanId: true });
  const personalPatchSchema = personalCreateSchema.partial();

  app.get("/api/weekly-plans/:planId/personal-tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    res.json(await storage.getPersonalTasks(tenantId, { weeklyPlanId: plan.id }));
  }));

  app.post("/api/weekly-plans/:planId/personal-tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    const data = parseBody(personalCreateSchema, req.body);
    const created = await storage.createPersonalTask({
      ...data,
      tenantId,
      weeklyPlanId: plan.id,
      teamId: data.teamId ?? plan.teamId,
    });
    await recomputeWeeklyPlan(tenantId, plan.id);
    res.status(201).json(created);
  }));

  app.patch("/api/personal-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPersonalTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Personligt block");
    const data = parseBody(personalPatchSchema, req.body);
    const row = await storage.updatePersonalTask(tenantId, req.params.id, data);
    if (existing.weeklyPlanId) await recomputeWeeklyPlan(tenantId, existing.weeklyPlanId);
    res.json(row);
  }));

  app.delete("/api/personal-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPersonalTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Personligt block");
    await storage.deletePersonalTask(tenantId, req.params.id);
    if (existing.weeklyPlanId) await recomputeWeeklyPlan(tenantId, existing.weeklyPlanId);
    res.status(204).end();
  }));

  // Konvertera egentid → beordrad övertid/restid (Kinab-regeln).
  const convertSchema = z.object({
    toCategory: z.enum(["overtime", "travel_between_jobs"]),
    allowOverlap: z.boolean().optional(),
  });
  app.post("/api/personal-tasks/:id/convert", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPersonalTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Personligt block");
    const data = parseBody(convertSchema, req.body);
    const userId = (req as any).user?.claims?.sub ?? null;
    const row = await convertPersonalTimeToOrdered(tenantId, req.params.id, {
      toCategory: data.toCategory,
      allowOverlap: data.allowOverlap,
      convertedBy: userId,
    });
    res.json(row);
  }));

  // ==========================================================================
  // Personliga-uppgift-scheman (återkommande regler)
  // ==========================================================================
  const scheduleCreateSchema = insertPersonalTaskScheduleSchema.omit({ tenantId: true });
  const schedulePatchSchema = scheduleCreateSchema.partial();

  app.get("/api/personal-task-schedules", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
    const activeOnly = req.query.activeOnly === "true";
    res.json(await storage.getPersonalTaskSchedules(tenantId, { teamId, activeOnly }));
  }));

  app.get("/api/personal-task-schedules/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const row = await storage.getPersonalTaskSchedule(tenantId, req.params.id);
    if (!row) throw new NotFoundError("Schema");
    res.json(row);
  }));

  app.post("/api/personal-task-schedules", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(scheduleCreateSchema, req.body);
    res.status(201).json(await storage.createPersonalTaskSchedule({ ...data, tenantId }));
  }));

  app.patch("/api/personal-task-schedules/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(schedulePatchSchema, req.body);
    const row = await storage.updatePersonalTaskSchedule(tenantId, req.params.id, data);
    if (!row) throw new NotFoundError("Schema");
    res.json(row);
  }));

  app.delete("/api/personal-task-schedules/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPersonalTaskSchedule(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Schema");
    await storage.deletePersonalTaskSchedule(tenantId, req.params.id);
    res.status(204).end();
  }));

  // ==========================================================================
  // Restidsposter
  // ==========================================================================
  const travelCreateSchema = insertTravelTimeEntrySchema.omit({ tenantId: true, weeklyPlanId: true });
  const travelPatchSchema = travelCreateSchema.partial();

  app.get("/api/weekly-plans/:planId/travel-entries", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    res.json(await storage.getTravelTimeEntries(tenantId, plan.id));
  }));

  app.post("/api/weekly-plans/:planId/travel-entries", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    const data = parseBody(travelCreateSchema, req.body);
    const created = await storage.createTravelTimeEntry({ ...data, tenantId, weeklyPlanId: plan.id });
    // Berika distans/restid/kostnad/CO2 via routing-motorn direkt vid skapande.
    await recomputeWeeklyPlan(tenantId, plan.id, { recomputeTravel: true });
    const enriched = await storage.getTravelTimeEntry(tenantId, created.id);
    res.status(201).json(enriched ?? created);
  }));

  app.patch("/api/travel-entries/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTravelTimeEntry(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Restidspost");
    const data = parseBody(travelPatchSchema, req.body);
    await storage.updateTravelTimeEntry(tenantId, req.params.id, data);
    // Räkna om distans/kostnad/CO2 när en restidspost ändras (t.ex. nya koordinater).
    if (existing.weeklyPlanId) await recomputeWeeklyPlan(tenantId, existing.weeklyPlanId, { recomputeTravel: true });
    const row = await storage.getTravelTimeEntry(tenantId, req.params.id);
    res.json(row);
  }));

  app.delete("/api/travel-entries/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTravelTimeEntry(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Restidspost");
    await storage.deleteTravelTimeEntry(tenantId, req.params.id);
    if (existing.weeklyPlanId) await recomputeWeeklyPlan(tenantId, existing.weeklyPlanId);
    res.status(204).end();
  }));

  // ==========================================================================
  // Varningar (list + resolve)
  // ==========================================================================
  app.get("/api/weekly-plans/:planId/warnings", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const plan = await storage.getWeeklyPlan(tenantId, req.params.planId);
    if (!plan) throw new NotFoundError("Veckoplan");
    res.json(await storage.getWeeklyPlanWarnings(tenantId, plan.id));
  }));

  app.post("/api/weekly-plan-warnings/:id/resolve", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWeeklyPlanWarning(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Varning");
    const row = await storage.updateWeeklyPlanWarning(tenantId, req.params.id, {
      resolved: true,
      resolvedAt: new Date(),
    });
    res.json(row);
  }));

  // ==========================================================================
  // Pre-tasks
  // ==========================================================================
  const preTaskCreateSchema = insertPreTaskSchema.omit({ tenantId: true });
  const preTaskPatchSchema = preTaskCreateSchema.partial();

  app.get("/api/pre-tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrderId = typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await storage.getPreTasks(tenantId, { workOrderId, status }));
  }));

  app.get("/api/pre-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const row = await storage.getPreTask(tenantId, req.params.id);
    if (!row) throw new NotFoundError("Pre-task");
    res.json(row);
  }));

  app.post("/api/pre-tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(preTaskCreateSchema, req.body);
    res.status(201).json(await storage.createPreTask({ ...data, tenantId }));
  }));

  app.patch("/api/pre-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(preTaskPatchSchema, req.body);
    const row = await storage.updatePreTask(tenantId, req.params.id, data);
    if (!row) throw new NotFoundError("Pre-task");
    res.json(row);
  }));

  app.post("/api/pre-tasks/:id/complete", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPreTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Pre-task");
    const userId = (req as any).user?.claims?.sub ?? null;
    const row = await storage.updatePreTask(tenantId, req.params.id, {
      status: "done",
      completedAt: new Date(),
      completedBy: userId,
    });
    res.json(row);
  }));

  app.delete("/api/pre-tasks/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPreTask(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Pre-task");
    await storage.deletePreTask(tenantId, req.params.id);
    res.status(204).end();
  }));

  // Generera pre-tasks för en work order utifrån dess execution_type.
  app.post("/api/work-orders/:workOrderId/generate-pre-tasks", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const created = await generatePreTasksForWorkOrder(tenantId, req.params.workOrderId);
    res.json({ created });
  }));

  // ==========================================================================
  // Pre-task-regler (execution_type → pre-task)
  // ==========================================================================
  const ruleCreateSchema = insertExecTypePreTaskRuleSchema.omit({ tenantId: true });
  const rulePatchSchema = ruleCreateSchema.partial();

  app.get("/api/exec-type-pre-task-rules", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const executionType = typeof req.query.executionType === "string" ? req.query.executionType : undefined;
    const activeOnly = req.query.activeOnly === "true";
    res.json(await storage.getExecTypePreTaskRules(tenantId, { executionType, activeOnly }));
  }));

  app.get("/api/exec-type-pre-task-rules/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const row = await storage.getExecTypePreTaskRule(tenantId, req.params.id);
    if (!row) throw new NotFoundError("Regel");
    res.json(row);
  }));

  app.post("/api/exec-type-pre-task-rules", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(ruleCreateSchema, req.body);
    res.status(201).json(await storage.createExecTypePreTaskRule({ ...data, tenantId }));
  }));

  app.patch("/api/exec-type-pre-task-rules/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = parseBody(rulePatchSchema, req.body);
    const row = await storage.updateExecTypePreTaskRule(tenantId, req.params.id, data);
    if (!row) throw new NotFoundError("Regel");
    res.json(row);
  }));

  app.delete("/api/exec-type-pre-task-rules/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getExecTypePreTaskRule(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Regel");
    await storage.deleteExecTypePreTaskRule(tenantId, req.params.id);
    res.status(204).end();
  }));
}
