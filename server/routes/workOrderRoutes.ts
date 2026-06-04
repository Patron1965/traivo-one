import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  formatZodError,
  verifyTenantOwnership,
  ensureResourceInTenant,
  ensureTeamInTenant,
  ensureCustomerInTenant,
  ensureObjectInTenant,
  ensureClusterInTenant,
  ensureResourceIdsInTenant,
} from "./helpers";
import { getTenantIdWithFallback, requireAdmin, requirePlanner } from "../tenant-middleware";
import { insertWorkOrderSchema, insertWorkOrderLineSchema, ORDER_STATUSES, type OrderStatus, articles, insertProcurementSchema, insertSetupTimeLogSchema, insertSimulationScenarioSchema, clusters, resources, orderConcepts, workOrderLines, fortnoxInvoiceExports, protocols, workOrders, customers, objects, objectPayers, slaRiskSnapshots, type OrderConcept, isOutsidePreferredWindow } from "@shared/schema";
import type { WorkOrder, InsertWorkOrderLine } from "@shared/schema";
import { handleWorkOrderStatusChange } from "../ai-communication";
import { notificationService } from "../notifications";
import { asyncHandler } from "../asyncHandler";
import { AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError } from "../errors";

/** Räknar ut outsidePreferredWindow-flaggan + priority utifrån objektets/kundens
 * effektiva leveranspreferens och plannedWindowStart/End. */
async function computeOutsidePreferredWindow(
  objectId: string | null | undefined,
  plannedStart: Date | string | null | undefined,
  plannedEnd: Date | string | null | undefined,
): Promise<{ outsidePreferredWindow: boolean; deliveryPreferencePriority: string | null }> {
  if (!objectId || !plannedStart) return { outsidePreferredWindow: false, deliveryPreferencePriority: null };
  const { effective, source } = await storage.resolveDeliveryPreferences(objectId);
  if (source === "none") return { outsidePreferredWindow: false, deliveryPreferencePriority: null };
  return {
    outsidePreferredWindow: isOutsidePreferredWindow(effective, plannedStart, plannedEnd),
    deliveryPreferencePriority: effective.priority ?? "preferred",
  };
}
import { getArticleMetadataForObject, writeArticleMetadataOnObject, writeSystemMetadataOnObject } from "../metadata-queries";

/**
 * Kör constraint-/konfliktkontrollen (samma motor som veckoplaneraren bulk-schedule
 * använder) för en enstaka datum-/resursändring på en arbetsorder. Returnerar
 * dedupade beskrivningar uppdelade i hårda (blockerande) och mjuka (kräver
 * bekräftelse) konflikter. Används av PATCH /api/work-orders/:id när klienten
 * skickar `checkConstraints: true` (t.ex. detaljvyns redigera-dialog) så att en
 * planerare inte oavsiktligt skapar överbokning eller bryter en klusterregel.
 */
async function validateWorkOrderScheduleChange(params: {
  tenantId: string;
  workOrder: WorkOrder;
  scheduledDate: string;
  resourceId: string | null;
  teamId: string | null;
}): Promise<{ hard: string[]; soft: string[] }> {
  const { tenantId, workOrder, scheduledDate } = params;

  const allOrders = await storage.getWorkOrders(tenantId);
  const allResources = await storage.getResources(tenantId);
  const resourceAvailability = await storage.getResourceAvailabilityByTenant(tenantId);
  const vehicleSchedules = await storage.getVehicleSchedulesByTenant(tenantId);
  const resourceIdsList = allResources.map(r => r.id);
  const resourceVehicles = await storage.getResourceVehiclesByResourceIds(resourceIdsList);
  const dependencyInstances = await storage.getTaskDependencyInstances(tenantId);
  const resourceArticles = await storage.getResourceArticlesByResourceIds(resourceIdsList);
  const teamMembers = await storage.getAllTeamMembers(tenantId);
  const clustersList = await storage.getClusters(tenantId);
  const tenant = await storage.getTenant(tenantId);
  const tenantSettings = (tenant?.settings as Record<string, unknown>) || {};
  const hardClusterBlocking = tenantSettings.hardClusterBlocking !== false;

  // Lös ut en resurs för flytten. Om ordern är team-tilldelad använder vi en
  // medlems resurs (samma som bulk-schedule). Saknas både resurs och team kör
  // vi ändå de datumbaserade kontrollerna (tidsfönster, beroenden, restriktioner).
  let effectiveResourceId: string = params.resourceId || "";
  if (!effectiveResourceId && params.teamId) {
    const tm = teamMembers.find(m => m.teamId === params.teamId);
    effectiveResourceId = tm?.resourceId || "";
  }

  const timeRestrictions = workOrder.objectId
    ? await storage.getObjectTimeRestrictions(workOrder.objectId)
    : [];
  const workOrderLines = await storage.getWorkOrderLines(workOrder.id);

  // Nollställ ordens egna scheduledDate i datasetet så kapacitetskontrollen inte
  // dubbelräknar dess gamla dag — flytten lägger tillbaka timmarna på den nya
  // dagen. Raden måste finnas kvar (med uppdaterad resurs/team) så per-flytt-
  // kontrollerna kan slå upp ordern.
  const idx = allOrders.findIndex(o => o.id === workOrder.id);
  if (idx >= 0) {
    allOrders[idx] = {
      ...allOrders[idx],
      scheduledDate: null,
      resourceId: effectiveResourceId || null,
      teamId: params.teamId ?? null,
    };
  }

  const { validateSchedule } = await import("../planning/constraintEngine");
  const violations = validateSchedule(
    [{ workOrderId: workOrder.id, resourceId: effectiveResourceId, scheduledDate }],
    {
      allOrders,
      resources: allResources,
      resourceAvailability,
      vehicleSchedules,
      resourceVehicles,
      dependencyInstances,
      timeRestrictions,
      resourceArticles,
      workOrderLines,
      teamMembers,
      clusters: clustersList,
      hardClusterBlocking,
    },
  );

  // Inkludera violations som rör denna order direkt, plus aggregerade
  // kapacitets-/kluster-/beroende-konflikter (rapporteras ibland mot annan id).
  const relevant = violations.filter(v =>
    v.workOrderId === workOrder.id ||
    v.category === "capacity" ||
    v.category === "cluster_geographic" ||
    v.category === "dependency_chain"
  );
  const hard = Array.from(new Set(relevant.filter(v => v.type === "hard").map(v => v.description)));
  const soft = Array.from(new Set(relevant.filter(v => v.type === "soft").map(v => v.description)));
  return { hard, soft };
}

/** Plockar fram inloggad användares id från request (web-session claims eller id). */
function getRequestUserId(req: any): string | null {
  return req?.user?.claims?.sub ?? req?.user?.id ?? null;
}

export async function registerWorkOrderRoutes(app: Express) {

app.get("/api/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const allDates = req.query.allDates === 'true';
  let startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  let endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
  const includeUnscheduled = req.query.includeUnscheduled === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
  const status = req.query.status as string || undefined;
  const paginated = req.query.paginated === 'true';
  const search = req.query.search as string || undefined;
  const isValidIsoDate = (s: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  const dateFilterSchema = z.object({
    dateField: z.enum(["desired", "created", "sla"]).optional(),
    dateFrom: z.string().refine(isValidIsoDate, { message: "Ogiltigt datum (YYYY-MM-DD)" }).optional(),
    dateTo: z.string().refine(isValidIsoDate, { message: "Ogiltigt datum (YYYY-MM-DD)" }).optional(),
  });
  const dateParse = dateFilterSchema.safeParse({
    dateField: req.query.dateField,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
  });
  if (!dateParse.success) {
    throw new ValidationError("Ogiltiga datumfilter-parametrar");
  }
  let dateFilter: { field: 'desired' | 'created' | 'sla'; from?: string; to?: string } | undefined;
  if (dateParse.data.dateField && (dateParse.data.dateFrom || dateParse.data.dateTo)) {
    dateFilter = {
      field: dateParse.data.dateField,
      from: dateParse.data.dateFrom,
      to: dateParse.data.dateTo,
    };
  }

  if (!allDates && status !== 'unscheduled') {
    if (!startDate && !endDate) {
      const now = new Date();
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    } else if (startDate && !endDate) {
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    } else if (!startDate && endDate) {
      startDate = new Date(0);
    }
    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);
  }

  if (status === 'unscheduled') {
    const missingDateOnly = req.query.missingDateOnly === 'true';
    if (missingDateOnly) {
      if (!dateParse.data.dateField || (dateParse.data.dateField !== 'desired' && dateParse.data.dateField !== 'sla')) {
        throw new ValidationError("missingDateOnly kräver dateField=desired eller sla");
      }
      const workOrders = await storage.getUnscheduledMissingDateField(tenantId, dateParse.data.dateField, search, limit || 100);
      res.json({ workOrders, total: workOrders.length });
    } else if (search || offset !== undefined || dateFilter) {
      const result = await storage.getUnscheduledWorkOrdersPaginated(tenantId, limit || 50, offset || 0, search, dateFilter);
      res.json(result);
    } else {
      const workOrders = await storage.getUnscheduledWorkOrders(tenantId, limit || 500);
      res.json(workOrders);
    }
  } else if (paginated || offset !== undefined) {
    const result = await storage.getWorkOrdersPaginated(tenantId, limit || 50, offset || 0, startDate, endDate, includeUnscheduled, status);
    res.json(result);
  } else {
    const workOrders = await storage.getWorkOrders(tenantId, startDate, endDate, includeUnscheduled, limit);
    res.json(workOrders);
  }
}));

app.get("/api/work-orders/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  let workOrder = await storage.getWorkOrder(req.params.id);
  // getWorkOrder filtrerar bort soft-deleted (avbrutna) ordrar. Detaljsidan ska
  // ändå kunna visa en avbruten order med "Avbruten"-markering + återställning,
  // så vi läser raden direkt om den inte hittades via den vanliga vägen.
  if (!workOrder) {
    const [deleted] = await db.select().from(workOrders).where(eq(workOrders.id, req.params.id));
    if (deleted) workOrder = deleted;
  }
  const verified = verifyTenantOwnership(workOrder, tenantId);
  if (!verified) throw new NotFoundError("Arbetsorder");

  const [customer, object] = await Promise.all([
    verified.customerId ? storage.getCustomer(verified.customerId) : null,
    verified.objectId ? storage.getObject(verified.objectId) : null,
  ]);

  const cancellation = (verified.metadata as any)?.cancellation ?? null;

  res.json({
    ...verified,
    customerName: customer?.name,
    customerPhone: customer?.phone,
    customerEmail: customer?.email,
    objectName: object?.name,
    objectAddress: object?.address,
    isCancelled: !!verified.deletedAt,
    cancellation,
  });
}));

// Aktivitetslogg för en arbetsorder: statusbyten, redigeringar, avbeställningar
// och återställningar med tidpunkt, användare och ev. orsak. Fungerar även för
// avbrutna (soft-deleted) ordrar.
app.get("/api/work-orders/:id/activity", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  let workOrder = await storage.getWorkOrder(req.params.id);
  if (!workOrder) {
    const [deleted] = await db.select().from(workOrders).where(eq(workOrders.id, req.params.id));
    if (deleted) workOrder = deleted;
  }
  const verified = verifyTenantOwnership(workOrder, tenantId);
  if (!verified) throw new NotFoundError("Arbetsorder");

  const logs = await storage.getAuditLogs(tenantId, {
    resourceType: "work_order",
    resourceId: req.params.id,
    limit: 100,
  });

  // Lös upp användarnamn i en batch.
  const userIds = Array.from(new Set(logs.map(l => l.userId).filter(Boolean) as string[]));
  const userMap = new Map<string, string>();
  await Promise.all(userIds.map(async (uid) => {
    const u = await storage.getUser(uid);
    if (u) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || uid;
      userMap.set(uid, name);
    }
  }));

  const activity = logs.map(l => ({
    id: l.id,
    action: l.action,
    createdAt: l.createdAt,
    userId: l.userId,
    userName: l.userId ? (userMap.get(l.userId) ?? "Okänd användare") : "System",
    changes: l.changes ?? null,
    metadata: l.metadata ?? null,
  }));

  res.json({ activity });
}));

app.get("/api/work-orders/:id/expand", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.id);
  const verified = verifyTenantOwnership(workOrder, tenantId);
  if (!verified) throw new NotFoundError("Arbetsorder");

  const objectId = verified.objectId;
  const tenantSafeObject = objectId ? await storage.getObject(objectId) : null;
  const tenantSafeObjectId = tenantSafeObject && tenantSafeObject.tenantId === tenantId ? objectId : null;

  const [lines, history, communications, images, protocolList, slaSnapshot] = await Promise.all([
    storage.getWorkOrderLines(verified.id),
    tenantSafeObjectId ? storage.getRecentWorkOrdersForObject(tenantId, tenantSafeObjectId, verified.id, 5) : Promise.resolve([]),
    storage.getCustomerCommunicationsByWorkOrder(tenantId, verified.id, 3),
    tenantSafeObjectId ? storage.getObjectImages(tenantSafeObjectId) : Promise.resolve([]),
    storage.getProtocols(tenantId, { workOrderId: verified.id }),
    db.select({
        deadlineAt: slaRiskSnapshots.deadlineAt,
        riskLevel: slaRiskSnapshots.riskLevel,
        daysToBreach: slaRiskSnapshots.daysToBreach,
        predictedCompletionDate: slaRiskSnapshots.predictedCompletionDate,
        reason: slaRiskSnapshots.reason,
      })
      .from(slaRiskSnapshots)
      .where(and(eq(slaRiskSnapshots.tenantId, tenantId), eq(slaRiskSnapshots.workOrderId, verified.id)))
      .limit(1)
      .then(rows => rows[0] ?? null)
      .catch(() => null),
  ]);

  let articleNameMap = new Map<string, { name: string; articleNumber: string }>();
  const articleIds = Array.from(new Set(lines.map(l => l.articleId).filter(Boolean) as string[]));
  if (articleIds.length > 0) {
    const rows = await db.select({ id: articles.id, name: articles.name, articleNumber: articles.articleNumber })
      .from(articles)
      .where(and(eq(articles.tenantId, tenantId), inArray(articles.id, articleIds)));
    for (const a of rows) articleNameMap.set(a.id, { name: a.name, articleNumber: a.articleNumber });
  }

  const period = {
    desiredDeliveryStart: verified.desiredDeliveryStart,
    desiredDeliveryEnd: verified.desiredDeliveryEnd,
    plannedWindowStart: verified.plannedWindowStart,
    plannedWindowEnd: verified.plannedWindowEnd,
    scheduledDate: verified.scheduledDate,
    scheduledStartTime: verified.scheduledStartTime,
    slaDeadlineAt: slaSnapshot?.deadlineAt ?? null,
    slaRiskLevel: slaSnapshot?.riskLevel ?? null,
    slaDaysToBreach: slaSnapshot?.daysToBreach ?? null,
    slaPredictedCompletionDate: slaSnapshot?.predictedCompletionDate ?? null,
    slaReason: slaSnapshot?.reason ?? null,
    createdAt: verified.createdAt,
  };

  const notes = {
    notes: verified.notes ?? null,
    plannedNotes: verified.plannedNotes ?? null,
    description: verified.description ?? null,
  };

  const materials = lines.map(l => ({
    id: l.id,
    articleId: l.articleId,
    articleName: l.articleId ? (articleNameMap.get(l.articleId)?.name ?? null) : null,
    articleNumber: l.articleId ? (articleNameMap.get(l.articleId)?.articleNumber ?? null) : null,
    quantity: l.quantity,
    resolvedPrice: l.resolvedPrice,
    notes: l.notes,
    isOptional: l.isOptional ?? false,
    isCompleted: l.isCompleted ?? false,
    completedAt: l.completedAt instanceof Date ? l.completedAt.toISOString() : (l.completedAt ?? null),
  }));

  const recentJobs = history.map(h => ({
    id: h.id,
    title: h.title,
    scheduledDate: h.scheduledDate,
    orderStatus: h.orderStatus,
    executionStatus: h.executionStatus,
    completedAt: h.completedAt,
    createdAt: h.createdAt,
  }));

  const comms = communications.map(c => ({
    id: c.id,
    channel: c.channel,
    notificationType: c.notificationType,
    status: c.status,
    subject: c.subject,
    message: c.message,
    sentAt: c.sentAt,
    createdAt: c.createdAt,
  }));

  type FieldImage = { id: string; url: string; label: string; date: string };
  const objectImageItems: FieldImage[] = images.map(i => ({
    id: `obj:${i.id}`,
    url: i.imageUrl,
    label: i.description ?? "Objektbild",
    date: (i.imageDate instanceof Date ? i.imageDate : new Date(i.imageDate)).toISOString(),
  }));
  const protocolImageItems: FieldImage[] = protocolList.flatMap(p => {
    const arr: FieldImage[] = [];
    const dateIso = (p.executedAt instanceof Date ? p.executedAt : new Date(p.executedAt)).toISOString();
    if (p.beforePhotoUrl) arr.push({ id: `p:${p.id}:before`, url: p.beforePhotoUrl, label: "Före", date: dateIso });
    if (p.afterPhotoUrl) arr.push({ id: `p:${p.id}:after`, url: p.afterPhotoUrl, label: "Efter", date: dateIso });
    if (Array.isArray(p.additionalPhotos)) {
      p.additionalPhotos.forEach((u, idx) => arr.push({ id: `p:${p.id}:${idx}`, url: u, label: "Fältfoto", date: dateIso }));
    }
    return arr;
  });
  const fieldImages = [...objectImageItems, ...protocolImageItems]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

  // --- Sync-status per sektion ---
  // pendingFieldSync är ett framtidssäkert fält; alltid false tills offline-kömodellen finns.
  const pendingFieldSync = false;
  const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const computeStatus = (latest: Date | string | null | undefined, hasData: boolean): "fresh" | "stale" | "pending" | "empty" => {
    if (pendingFieldSync) return "pending";
    if (!hasData) return "empty";
    if (!latest) return "stale";
    const t = (latest instanceof Date ? latest : new Date(latest)).getTime();
    return Number.isFinite(t) && now - t <= FRESH_WINDOW_MS ? "fresh" : "stale";
  };

  const latestHistory = recentJobs[0]?.completedAt ?? recentJobs[0]?.scheduledDate ?? recentJobs[0]?.createdAt ?? null;
  const latestComm = comms[0]?.sentAt ?? comms[0]?.createdAt ?? null;
  const latestImage = fieldImages[0]?.date ?? null;
  const woAnchor = verified.createdAt ?? null;

  const sync = {
    pendingFieldSync,
    period: { status: computeStatus(woAnchor, true), latestSyncAt: woAnchor },
    history: { status: computeStatus(latestHistory, recentJobs.length > 0), latestSyncAt: latestHistory },
    communications: { status: computeStatus(latestComm, comms.length > 0), latestSyncAt: latestComm },
    images: { status: computeStatus(latestImage, fieldImages.length > 0), latestSyncAt: latestImage },
    notes: { status: computeStatus(woAnchor, !!(notes.notes || notes.plannedNotes || notes.description)), latestSyncAt: woAnchor },
    materials: { status: computeStatus(woAnchor, materials.length > 0), latestSyncAt: woAnchor },
  };

  const hasPeriodData = !!(
    period.desiredDeliveryStart ||
    period.desiredDeliveryEnd ||
    period.plannedWindowStart ||
    period.plannedWindowEnd ||
    period.scheduledDate ||
    period.scheduledStartTime ||
    period.slaDeadlineAt
  );
  let periodCount = hasPeriodData ? 1 : 0;
  if (period.slaRiskLevel === "critical") periodCount += 2;
  else if (period.slaRiskLevel === "warning") periodCount += 1;

  const counts = {
    period: periodCount,
    history: recentJobs.length,
    communications: comms.length,
    images: fieldImages.length,
    notes: [notes.notes, notes.plannedNotes, notes.description].filter(Boolean).length,
    materials: materials.length,
  };

  res.json({
    period,
    history: recentJobs,
    communications: comms,
    images: fieldImages,
    notes,
    materials,
    counts,
    sync,
  });
}));

app.get("/api/resources/:resourceId/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const resource = await storage.getResource(req.params.resourceId);
  if (!verifyTenantOwnership(resource, tenantId)) {
    throw new NotFoundError("Resurs");
  }
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
  const workOrders = await storage.getWorkOrdersByResource(req.params.resourceId, startDate, endDate);
  res.json(workOrders);
}));

const bulkUnscheduleSchema = z.object({
  startDate: z.string().min(1, "startDate krävs"),
  endDate: z.string().min(1, "endDate krävs"),
  resourceIds: z.array(z.string()).optional(),
});

app.post("/api/work-orders/bulk-unschedule", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parsed = bulkUnscheduleSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const { startDate, endDate, resourceIds } = parsed.data;
  const parsedStart = new Date(startDate);
  const parsedEnd = new Date(endDate);
  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    throw new ValidationError("Ogiltigt datumformat");
  }
  // Avvisa cross-tenant resourceIds innan vi rör några ordrar.
  await ensureResourceIdsInTenant(resourceIds, tenantId);
  const count = await storage.bulkUnscheduleWorkOrders(tenantId, parsedStart, parsedEnd, resourceIds);
  res.json({ count });
}));

const bulkScheduleSchema = z.object({
  workOrderIds: z.array(z.string().min(1)).min(1).max(200),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ogiltigt datumformat (YYYY-MM-DD)"),
  resourceId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  scheduledStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  force: z.boolean().optional(),
}).refine(d => Boolean(d.resourceId) !== Boolean(d.teamId), {
  message: "Ange antingen resourceId eller teamId (en av dem)",
});

type BulkScheduleResultStatus = "scheduled" | "conflict" | "blocked" | "error";
interface BulkScheduleResult {
  workOrderId: string;
  status: BulkScheduleResultStatus;
  conflictReasons: string[];
  message?: string;
}

app.post("/api/work-orders/bulk-schedule", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parsed = bulkScheduleSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const { workOrderIds, scheduledDate, resourceId, teamId, scheduledStartTime, force } = parsed.data;

  if (resourceId) await ensureResourceInTenant(resourceId, tenantId);
  if (teamId) await ensureTeamInTenant(teamId, tenantId);

  // Dedup
  const uniqueIds = Array.from(new Set(workOrderIds));

  // Pre-load all orders + tenant-ownership filter
  const ordersById = new Map<string, Awaited<ReturnType<typeof storage.getWorkOrder>>>();
  for (const id of uniqueIds) {
    const wo = await storage.getWorkOrder(id);
    ordersById.set(id, wo);
  }

  // Build constraint context (same shape as planner what-if)
  const allOrders = await storage.getWorkOrders(tenantId);
  const allResources = await storage.getResources(tenantId);
  const resourceAvailability = await storage.getResourceAvailabilityByTenant(tenantId);
  const vehicleSchedules = await storage.getVehicleSchedulesByTenant(tenantId);
  const resourceIdsList = allResources.map(r => r.id);
  const resourceVehicles = await storage.getResourceVehiclesByResourceIds(resourceIdsList);
  const dependencyInstances = await storage.getTaskDependencyInstances(tenantId);
  const resourceArticles = await storage.getResourceArticlesByResourceIds(resourceIdsList);
  const teamMembers = await storage.getAllTeamMembers(tenantId);
  const clustersList = await storage.getClusters(tenantId);
  const tenant = await storage.getTenant(tenantId);
  const tenantSettings = (tenant?.settings as Record<string, unknown>) || {};
  const hardClusterBlocking = tenantSettings.hardClusterBlocking !== false;

  const { validateSchedule } = await import("../planning/constraintEngine");

  // Resolve resourceId for moves: if teamId given, pick first available active member resource id
  // (we still mutate teamId on the WO directly; the constraint check needs *some* resourceId).
  let effectiveResourceIdForCheck: string | null = resourceId || null;
  if (!effectiveResourceIdForCheck && teamId) {
    const tm = teamMembers.find(m => m.teamId === teamId);
    effectiveResourceIdForCheck = tm?.resourceId || allResources[0]?.id || null;
  }

  const results: BulkScheduleResult[] = [];
  // Track moves accepted earlier in the batch so subsequent items see intra-batch
  // capacity/dependency conflictReasons. We mutate `allOrders` in-place to reflect
  // simulated updates (resourceId/scheduledDate) for already-scheduled items.
  const pendingMoves: Array<{ workOrderId: string; resourceId: string; scheduledDate: string }> = [];

  for (const id of uniqueIds) {
    const wo = ordersById.get(id);
    if (!wo || !verifyTenantOwnership(wo, tenantId)) {
      results.push({ workOrderId: id, status: "error", conflictReasons: [], message: "Arbetsorder hittades inte" });
      continue;
    }

    let conflictReasons: string[] = [];
    if (effectiveResourceIdForCheck) {
      const timeRestrictions = wo.objectId
        ? await storage.getObjectTimeRestrictions(wo.objectId)
        : [];
      const workOrderLines = await storage.getWorkOrderLines(id);
      const movesForCheck = [
        ...pendingMoves,
        { workOrderId: id, resourceId: effectiveResourceIdForCheck, scheduledDate },
      ];
      const violations = validateSchedule(
        movesForCheck,
        {
          allOrders,
          resources: allResources,
          resourceAvailability,
          vehicleSchedules,
          resourceVehicles,
          dependencyInstances,
          timeRestrictions,
          resourceArticles,
          workOrderLines,
          teamMembers,
          clusters: clustersList,
          hardClusterBlocking,
        }
      );
      conflictReasons = violations
        .filter(v => v.workOrderId === id)
        .map(v => (v.type === "hard" ? `[BLOCK] ${v.description}` : v.description));
      // Capacity/cluster checks aggregate by resource+date across moves; surface
      // those even when reported against a sibling pending move.
      const aggregateExtras = violations
        .filter(v => v.workOrderId !== id && (v.category === "capacity" || v.category === "cluster_geographic"))
        .map(v => (v.type === "hard" ? `[BLOCK] ${v.description}` : v.description));
      for (const extra of aggregateExtras) {
        if (!conflictReasons.includes(extra)) conflictReasons.push(extra);
      }
    }

    const hasHardBlock = conflictReasons.some(c => c.startsWith("[BLOCK]"));
    if (hasHardBlock) {
      results.push({ workOrderId: id, status: "blocked", conflictReasons });
      continue;
    }
    if (conflictReasons.length > 0 && !force) {
      results.push({ workOrderId: id, status: "conflict", conflictReasons });
      continue;
    }

    try {
      const updateData: Record<string, unknown> = {
        scheduledDate: new Date(scheduledDate + "T12:00:00Z"),
      };
      if (resourceId) {
        updateData.resourceId = resourceId;
        updateData.teamId = null;
      } else if (teamId) {
        updateData.teamId = teamId;
        updateData.resourceId = null;
      }
      if (scheduledStartTime) updateData.scheduledStartTime = scheduledStartTime;
      if (wo.orderStatus === "skapad") updateData.orderStatus = "planerad_resurs";

      const oldStatus = wo.orderStatus;
      const updated = await storage.updateWorkOrder(id, updateData);
      if (!updated) {
        results.push({ workOrderId: id, status: "error", conflictReasons, message: "Uppdatering misslyckades" });
        continue;
      }

      // Mirror status-change side effects from PATCH /api/work-orders/:id
      if (updated.orderStatus !== oldStatus) {
        handleWorkOrderStatusChange(updated.id, oldStatus, updated.orderStatus, tenantId).catch(err =>
          console.error(`[bulk-schedule] status-change hook failed for ${id}:`, err)
        );
      }

      // Track simulated state for downstream conflict checks
      pendingMoves.push({
        workOrderId: id,
        resourceId: effectiveResourceIdForCheck || updated.resourceId || "",
        scheduledDate,
      });
      const idxInAll = allOrders.findIndex(o => o.id === id);
      if (idxInAll >= 0) {
        allOrders[idxInAll] = {
          ...allOrders[idxInAll],
          resourceId: updated.resourceId,
          teamId: updated.teamId,
          scheduledDate: updated.scheduledDate,
          scheduledStartTime: updated.scheduledStartTime,
          orderStatus: updated.orderStatus,
        };
      }

      // Notifications + extra-job-sms (mirror PATCH /api/work-orders/:id behavior)
      const oldResourceId = wo.resourceId;
      const newResourceId = updated.resourceId;
      if (newResourceId && newResourceId !== oldResourceId) {
        notificationService.notifyJobAssigned(updated, newResourceId);
        if (oldResourceId) notificationService.notifyJobCancelled(wo, oldResourceId);
        try {
          const { maybeSendExtraJobSms, maybeSendCancellationSms } = await import("../extra-job-sms");
          void maybeSendExtraJobSms({ workOrder: updated, resourceId: newResourceId, reason: "assigned" });
          if (oldResourceId) {
            void maybeSendCancellationSms({ workOrder: wo, previousResourceId: oldResourceId });
          }
        } catch (e) {
          console.error("[extra-job-sms] hook failed (bulk-schedule):", e);
        }
      } else if (newResourceId) {
        const oldDate = wo.scheduledDate?.toISOString().split("T")[0];
        const newDate = updated.scheduledDate?.toISOString().split("T")[0];
        if (oldDate !== newDate) {
          notificationService.notifyScheduleChanged(updated, newResourceId, oldDate, newDate);
          try {
            const { maybeSendExtraJobSms } = await import("../extra-job-sms");
            void maybeSendExtraJobSms({ workOrder: updated, resourceId: newResourceId, reason: "rescheduled" });
          } catch (e) {
            console.error("[extra-job-sms] hook failed (bulk-reschedule):", e);
          }
        }
      }

      results.push({ workOrderId: id, status: "scheduled", conflictReasons });
    } catch (err) {
      console.error(`[bulk-schedule] Failed to schedule ${id}:`, err);
      results.push({
        workOrderId: id,
        status: "error",
        conflictReasons,
        message: err instanceof Error ? err.message : "Okänt fel",
      });
    }
  }

  const summary = {
    total: results.length,
    scheduled: results.filter(r => r.status === "scheduled").length,
    conflict: results.filter(r => r.status === "conflict").length,
    blocked: results.filter(r => r.status === "blocked").length,
    error: results.filter(r => r.status === "error").length,
  };

  res.json({ summary, results });
}));

app.post("/api/work-orders/carry-over", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { fromDate, toDate, resourceIds } = req.body;
  if (!fromDate || !toDate) throw new ValidationError("fromDate och toDate krävs");
  // Avvisa cross-tenant resourceIds även om filterlogiken längre ned redan
  // skär bort främmande tenants — felet ska bubbla upp så klienten ser det.
  await ensureResourceIdsInTenant(Array.isArray(resourceIds) ? resourceIds : undefined, tenantId);
  
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0);
  const fromEnd = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 23, 59, 59);
  
  const allOrders = await storage.getWorkOrders(tenantId);
  const unfinished = allOrders.filter(wo => {
    if (!wo.scheduledDate) return false;
    const d = new Date(wo.scheduledDate);
    if (d < fromStart || d > fromEnd) return false;
    if (resourceIds?.length && !resourceIds.includes(wo.resourceId)) return false;
    return !["utford", "fakturerad", "avbruten", "omojlig"].includes(wo.orderStatus);
  });
  
  let movedCount = 0;
  for (const wo of unfinished) {
    await storage.updateWorkOrder(wo.id, { 
      scheduledDate: to,
      orderStatus: wo.orderStatus === "paborjad" ? "planerad_resurs" : wo.orderStatus
    });
    movedCount++;
  }
  
  res.json({ moved: movedCount, toDate: to.toISOString().split("T")[0] });
}));

// Task #712: Snabborder från filtrerat urval i klusterträdet. Skapar en arbetsorder
// per valt objekt och löser primär betalare (kund) per objekt. Allt tenant-scopat;
// objekt utan primär kund eller utanför tenant hoppas över och rapporteras tillbaka.
app.post("/api/work-orders/quick-bulk", requirePlanner, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const schema = z.object({
    objectIds: z.array(z.string().min(1)).min(1, "Välj minst ett objekt"),
    title: z.string().min(1, "Titel krävs"),
    orderType: z.string().optional(),
    priority: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  const uniqueIds = Array.from(new Set(parsed.objectIds));

  const objRows = await db.select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, uniqueIds), isNull(objects.deletedAt)));
  const validIds = new Set(objRows.map(o => o.id));

  const payerByObject = new Map<string, string>();
  if (validIds.size > 0) {
    const payerRows = await db.select({ objectId: objectPayers.objectId, customerId: objectPayers.customerId })
      .from(objectPayers)
      .where(and(eq(objectPayers.tenantId, tenantId), eq(objectPayers.isPrimary, true), inArray(objectPayers.objectId, Array.from(validIds))));
    for (const p of payerRows) {
      if (!payerByObject.has(p.objectId)) payerByObject.set(p.objectId, p.customerId);
    }
  }

  const createdIds: string[] = [];
  const skipped: { objectId: string; reason: string }[] = [];
  for (const objectId of uniqueIds) {
    if (!validIds.has(objectId)) { skipped.push({ objectId, reason: "Objekt saknas eller tillhör annan tenant" }); continue; }
    const customerId = payerByObject.get(objectId);
    if (!customerId) { skipped.push({ objectId, reason: "Saknar primär kund (betalare)" }); continue; }
    try {
      const data = insertWorkOrderSchema.parse({
        tenantId,
        customerId,
        objectId,
        title: parsed.title,
        orderType: parsed.orderType || "service",
        priority: parsed.priority || "normal",
        orderStatus: "skapad",
        isSimulated: false,
      });
      const workOrder = await storage.createWorkOrder(data);
      createdIds.push(workOrder.id);
    } catch (err) {
      // Fail-soft per objekt: en rad som fallerar avbryter inte hela bulken.
      // Redan skapade ordrar bevaras och resultatet rapporteras deterministiskt.
      skipped.push({ objectId, reason: err instanceof Error ? err.message : "Kunde inte skapa order" });
    }
  }

  res.json({ created: createdIds.length, createdIds, skipped });
}));

app.post("/api/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);

  const bodyData = { ...req.body };
  for (const field of ['scheduledDate', 'desiredDeliveryStart', 'desiredDeliveryEnd'] as const) {
    if (bodyData[field] && typeof bodyData[field] === 'string') {
      const dateStr = bodyData[field] as string;
      bodyData[field] = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
    }
  }

  // Enkel uppgift (Task #736): kund är valfri. Saknas customerId använder vi
  // tenantens interna kund som beställare (DB-kolumnen är fortsatt NOT NULL).
  if (!bodyData.customerId) {
    const internalCustomer = await storage.resolveInternalCustomer(tenantId);
    bodyData.customerId = internalCustomer.id;
  }

  const data = insertWorkOrderSchema.parse({
    orderStatus: 'skapad',
    isSimulated: false,
    ...bodyData,
    tenantId
  });

  // Validera alla refererade id:n mot tenant så att en planerare inte kan
  // skapa en order som pekar på resurser/kunder/objekt/team i en annan tenant.
  if (data.resourceId) await ensureResourceInTenant(data.resourceId, tenantId);
  if (data.teamId) await ensureTeamInTenant(data.teamId, tenantId);
  if (data.customerId) await ensureCustomerInTenant(data.customerId, tenantId);
  if (data.objectId) await ensureObjectInTenant(data.objectId, tenantId);
  if (data.clusterId) await ensureClusterInTenant(data.clusterId, tenantId);

  if (data.articleId && data.objectId) {
    const article = await storage.getArticle(data.articleId);
    if (article && article.limitationType && article.limitationType !== "unlimited") {
      const allOrders = await storage.getWorkOrders(tenantId);
      const existingForArticle = allOrders.filter(
        wo => wo.articleId === data.articleId && wo.orderStatus !== "avbruten" && wo.deletedAt === null
      );

      if (article.limitationType === "one_per_object") {
        const existing = existingForArticle.find(wo => wo.objectId === data.objectId);
        if (existing) {
          throw new ValidationError(`Artikeln "${article.name}" får bara utföras en gång per objekt. En order finns redan.`);
        }
      } else if (article.limitationType === "one_per_address") {
        const targetObj = await storage.getObject(data.objectId);
        if (targetObj?.address) {
          for (const wo of existingForArticle) {
            if (wo.objectId) {
              const woObj = await storage.getObject(wo.objectId);
              if (woObj?.address === targetObj.address) {
                throw new ValidationError(`Artikeln "${article.name}" får bara utföras en gång per adress. En order finns redan på "${targetObj.address}".`);
              }
            }
          }
        }
      } else if (article.limitationType === "one_per_customer") {
        const existing = existingForArticle.find(wo => wo.customerId === data.customerId);
        if (existing) {
          throw new ValidationError(`Artikeln "${article.name}" får bara utföras en gång per kund.`);
        }
      }
    }
  }

  const prefFlags = await computeOutsidePreferredWindow(
    data.objectId,
    data.plannedWindowStart,
    data.plannedWindowEnd,
  );
  const dataWithFlag = {
    ...data,
    outsidePreferredWindow: prefFlags.outsidePreferredWindow,
    deliveryPreferencePriority: prefFlags.deliveryPreferencePriority,
  };
  const workOrder = await storage.createWorkOrder(dataWithFlag);

  // Task #682: skriv systemgenererad, read-only metadata på objektet — "senaste
  // arbetsorder". Best-effort; ett misslyckande får aldrig blockera order-skapandet.
  if (workOrder.objectId) {
    try {
      const scheduled = workOrder.scheduledDate ? ` (${new Date(workOrder.scheduledDate).toISOString().slice(0, 10)})` : "";
      await writeSystemMetadataOnObject(
        workOrder.objectId,
        "Senaste arbetsorder",
        `${workOrder.title}${scheduled}`,
        tenantId,
        `system:wo-create:${workOrder.id}`,
      );
    } catch (e) {
      console.error("[task-682] writeSystemMetadataOnObject (Senaste arbetsorder) failed:", e);
    }
  }

  if (workOrder.resourceId) {
    notificationService.notifyJobAssigned(workOrder, workOrder.resourceId);
    try {
      const { maybeSendExtraJobSms } = await import("../extra-job-sms");
      void maybeSendExtraJobSms({ workOrder, resourceId: workOrder.resourceId, reason: "assigned" });
    } catch (e) {
      console.error("[extra-job-sms] hook failed (create):", e);
    }
  }

  res.status(201).json(workOrder);
}));

// Atomisk skapa-WO-med-rader (Task #741). Skapar arbetsordern OCH alla rader
// (artikel + fritext) i EN databastransaktion. Allt-eller-inget: om någon rad
// fallerar rullas hela ordern tillbaka, så inga halvfärdiga ordrar (WO utan
// rader) kan uppstå. Ersätter wizardens tidigare flöde med WO-skapande följt av
// N separata rad-anrop. Full tenant-scoping på alla refererade id:n och rader.
const withLinesBodySchema = z.object({
  workOrder: z.record(z.unknown()),
  lines: z.array(z.object({
    articleId: z.string().optional().nullable(),
    quantity: z.number().int().positive().optional(),
    isOptional: z.boolean().optional(),
    notes: z.string().optional().nullable(),
    priceListId: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    unitPrice: z.number().optional(),
    unitCost: z.number().optional(),
    productionMinutes: z.number().optional(),
  })).default([]),
});

app.post("/api/work-orders/with-lines", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);

  const parsedBody = withLinesBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json(formatZodError(parsedBody.error));
  }

  const bodyData: Record<string, unknown> = { ...parsedBody.data.workOrder };
  for (const field of ['scheduledDate', 'desiredDeliveryStart', 'desiredDeliveryEnd'] as const) {
    if (bodyData[field] && typeof bodyData[field] === 'string') {
      const dateStr = bodyData[field] as string;
      bodyData[field] = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
    }
  }

  // Kund är valfri (Enkel uppgift). Saknas customerId används tenantens interna
  // kund som beställare (DB-kolumnen är fortsatt NOT NULL).
  if (!bodyData.customerId) {
    const internalCustomer = await storage.resolveInternalCustomer(tenantId);
    bodyData.customerId = internalCustomer.id;
  }

  const data = insertWorkOrderSchema.parse({
    orderStatus: 'skapad',
    isSimulated: false,
    ...bodyData,
    tenantId,
  });

  // Validera alla refererade id:n mot tenant så att en planerare inte kan skapa
  // en order som pekar på resurser/kunder/objekt/team i en annan tenant.
  if (data.resourceId) await ensureResourceInTenant(data.resourceId, tenantId);
  if (data.teamId) await ensureTeamInTenant(data.teamId, tenantId);
  if (data.customerId) await ensureCustomerInTenant(data.customerId, tenantId);
  if (data.objectId) await ensureObjectInTenant(data.objectId, tenantId);
  if (data.clusterId) await ensureClusterInTenant(data.clusterId, tenantId);

  const prefFlags = await computeOutsidePreferredWindow(
    data.objectId,
    data.plannedWindowStart,
    data.plannedWindowEnd,
  );
  const workOrderData = {
    ...data,
    outsidePreferredWindow: prefFlags.outsidePreferredWindow,
    deliveryPreferencePriority: prefFlags.deliveryPreferencePriority,
  };

  // Resolva pris/tid för varje rad (read-only) och bygg rad-data. Detta görs
  // före transaktionen — endast skrivningarna är transaktionella.
  const lineInputs: Omit<InsertWorkOrderLine, "workOrderId" | "tenantId">[] = [];
  for (const line of parsedBody.data.lines) {
    const quantity = line.quantity ?? 1;
    const isOptional = line.isOptional ?? false;
    const notes = line.notes ?? undefined;

    if (!line.articleId) {
      const trimmedDescription = typeof line.description === "string" ? line.description.trim() : "";
      if (!trimmedDescription) {
        throw new ValidationError("Antingen articleId eller description krävs för en orderrad");
      }
      const unitPrice = Math.max(0, Math.round(Number(line.unitPrice ?? 0)));
      const unitCost = Math.max(0, Math.round(Number(line.unitCost ?? 0)));
      const productionMinutes = Math.max(0, Math.round(Number(line.productionMinutes ?? 0)));
      lineInputs.push(insertWorkOrderLineSchema.omit({ workOrderId: true, tenantId: true }).parse({
        articleId: null,
        description: trimmedDescription,
        quantity,
        resolvedPrice: unitPrice,
        resolvedCost: unitCost,
        resolvedProductionMinutes: productionMinutes,
        priceListIdUsed: null,
        priceSource: "manual",
        isOptional,
        notes,
      }));
      continue;
    }

    // Artikelrad — validera att artikeln tillhör tenant och resolva pris.
    const priceInfo = line.priceListId
      ? await storage.resolveArticlePriceFromList(tenantId, line.articleId, line.priceListId)
      : await storage.resolveArticlePrice(tenantId, line.articleId, workOrderData.customerId);

    const [articleRow] = await db.select({ tenantId: articles.tenantId, quantityMode: articles.quantityMode })
      .from(articles)
      .where(and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)));
    if (!articleRow) {
      throw new ValidationError("Artikeln saknas eller tillhör en annan tenant");
    }
    const effectiveQuantity = articleRow.quantityMode === 'single_per_task' ? 1 : quantity;

    lineInputs.push(insertWorkOrderLineSchema.omit({ workOrderId: true, tenantId: true }).parse({
      articleId: line.articleId,
      quantity: effectiveQuantity,
      resolvedPrice: priceInfo.price,
      resolvedCost: priceInfo.cost,
      resolvedProductionMinutes: priceInfo.productionMinutes,
      priceListIdUsed: priceInfo.priceListId,
      priceSource: priceInfo.source,
      isOptional,
      notes,
    }));
  }

  const { workOrder, lines } = await storage.createWorkOrderWithLines(workOrderData, lineInputs);

  // Best-effort: systemgenererad metadata + notifieringar (får aldrig blockera).
  if (workOrder.objectId) {
    try {
      const scheduled = workOrder.scheduledDate ? ` (${new Date(workOrder.scheduledDate).toISOString().slice(0, 10)})` : "";
      await writeSystemMetadataOnObject(
        workOrder.objectId,
        "Senaste arbetsorder",
        `${workOrder.title}${scheduled}`,
        tenantId,
        `system:wo-create:${workOrder.id}`,
      );
    } catch (e) {
      console.error("[task-682] writeSystemMetadataOnObject (Senaste arbetsorder) failed:", e);
    }
  }

  if (workOrder.resourceId) {
    notificationService.notifyJobAssigned(workOrder, workOrder.resourceId);
    try {
      const { maybeSendExtraJobSms } = await import("../extra-job-sms");
      void maybeSendExtraJobSms({ workOrder, resourceId: workOrder.resourceId, reason: "assigned" });
    } catch (e) {
      console.error("[extra-job-sms] hook failed (create-with-lines):", e);
    }
  }

  res.status(201).json({ ...workOrder, lines });
}));

app.patch("/api/work-orders/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;

  const clusterOverride = updateData.clusterOverride;
  delete updateData.clusterOverride;

  // Opt-in constraint-kontroll (detaljvyns redigera-dialog). Dessa flaggor är
  // styrfält och får aldrig sparas på ordern.
  const wantsConstraintCheck = req.body.checkConstraints === true;
  const forceSchedule = req.body.force === true;
  delete updateData.checkConstraints;
  delete updateData.force;

  const existingOrder = await storage.getWorkOrder(req.params.id);
  if (!existingOrder || !verifyTenantOwnership(existingOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  // Validera klient-skickade refererade id:n mot tenant så att en planerare
  // inte kan flytta en order till en resurs/team/kund/objekt i en annan tenant.
  if (updateData.resourceId) await ensureResourceInTenant(updateData.resourceId, tenantId);
  if (updateData.teamId) await ensureTeamInTenant(updateData.teamId, tenantId);
  if (updateData.customerId) await ensureCustomerInTenant(updateData.customerId, tenantId);
  if (updateData.objectId) await ensureObjectInTenant(updateData.objectId, tenantId);
  if (updateData.clusterId) await ensureClusterInTenant(updateData.clusterId, tenantId);

  // När klienten begär det (detaljvyns redigera-dialog), kör samma
  // constraint-/konfliktkontroll som veckoplaneraren innan vi sparar en
  // datum-/resurs-/team-ändring. Hårda konflikter blockerar (422); mjuka
  // konflikter kräver bekräftelse (409) tills klienten skickar `force: true`.
  if (wantsConstraintCheck) {
    const toDateStr = (v: unknown): string | null => {
      if (typeof v === "string" && v) return v.slice(0, 10);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return null;
    };
    const existingDateStr = existingOrder.scheduledDate
      ? new Date(existingOrder.scheduledDate).toISOString().slice(0, 10)
      : null;
    const newDateStr = "scheduledDate" in updateData ? toDateStr(updateData.scheduledDate) : null;
    const effectiveDateStr = newDateStr ?? existingDateStr;

    const dateChanged = "scheduledDate" in updateData && newDateStr !== existingDateStr;
    const resourceChanged = "resourceId" in updateData && updateData.resourceId !== existingOrder.resourceId;
    const teamChanged = "teamId" in updateData && updateData.teamId !== existingOrder.teamId;

    if (effectiveDateStr && (dateChanged || resourceChanged || teamChanged)) {
      const conflicts = await validateWorkOrderScheduleChange({
        tenantId,
        workOrder: existingOrder,
        scheduledDate: effectiveDateStr,
        resourceId: ("resourceId" in updateData ? updateData.resourceId : existingOrder.resourceId) as string | null,
        teamId: ("teamId" in updateData ? updateData.teamId : existingOrder.teamId) as string | null,
      });

      if (conflicts.hard.length > 0) {
        return res.status(422).json({
          error: "Schemakonflikt",
          code: "ERR_VALIDATION",
          message: "Ändringen blockeras av hårda planeringsregler och kan inte sparas.",
          details: { hardConflicts: conflicts.hard, softConflicts: conflicts.soft, blocked: true },
        });
      }
      if (conflicts.soft.length > 0 && !forceSchedule) {
        return res.status(409).json({
          error: "Schemakonflikt",
          code: "ERR_CONFLICT",
          message: "Ändringen skapar konflikter som kräver bekräftelse.",
          details: { hardConflicts: [], softConflicts: conflicts.soft, requiresConfirmation: true },
        });
      }
    }
  }

  const isResourceChange = updateData.resourceId && updateData.resourceId !== existingOrder.resourceId;
  const assignedResourceId = updateData.resourceId || existingOrder.resourceId;
  const clusterId = existingOrder.clusterId;
  if (assignedResourceId && clusterId && (isResourceChange || clusterOverride)) {
    try {
      const normalize = (pc: string) => pc.replace(/\s/g, "").trim();
      const cluster = await db.query.clusters.findFirst({ where: and(eq(clusters.id, clusterId), eq(clusters.tenantId, tenantId)) });
      const resource = await db.query.resources.findFirst({ where: and(eq(resources.id, assignedResourceId), eq(resources.tenantId, tenantId)) });
      if (cluster && resource) {
        const cpc = (cluster.postalCodes || []).map(normalize).filter(Boolean);
        const rsa = (resource.serviceArea || []).map(normalize).filter(Boolean);
        if (cpc.length > 0 && rsa.length > 0) {
          const rsaSet = new Set(rsa);
          const overlap = cpc.some(pc => rsaSet.has(pc));
          if (!overlap) {
            const tenant = await storage.getTenant(tenantId);
            const tenantSettings = (tenant?.settings as Record<string, any>) || {};
            const hardBlocking = tenantSettings.hardClusterBlocking !== false;
            if (hardBlocking) {
              return res.status(422).json({
                error: "Klusterblockering",
                message: `Resursen "${resource.name}" arbetar inte i kluster "${cluster.name}". Tilldelning blockerad av verksamhetsområdesregel.`,
                clusterName: cluster.name,
                resourceName: resource.name,
              });
            }
            console.warn(`[cluster-override] Work order ${req.params.id} assigned to resource ${assignedResourceId} outside cluster "${cluster.name}". Override: ${clusterOverride ? 'explicit' : 'no override flag'}, hardBlocking: ${hardBlocking}`);
          }
        }
      }
    } catch (e) {
      console.error("[cluster-validation] Error during cluster check:", e);
    }
  }

  for (const field of ['scheduledDate', 'desiredDeliveryStart', 'desiredDeliveryEnd'] as const) {
    if (updateData[field] && typeof updateData[field] === 'string') {
      const dateStr = updateData[field] as string;
      updateData[field] = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
    } else if (updateData[field] === null || updateData[field] === '') {
      updateData[field] = null;
    }
  }

  if (updateData.lockedAt && typeof updateData.lockedAt === 'string') {
    updateData.lockedAt = new Date(updateData.lockedAt);
  }

  for (const field of ['plannedWindowStart', 'plannedWindowEnd'] as const) {
    if (updateData[field] && typeof updateData[field] === 'string') {
      updateData[field] = new Date(updateData[field] as string);
    } else if (updateData[field] === '' || updateData[field] === null) {
      updateData[field] = null;
    }
  }

  const willChangeWindow = 'plannedWindowStart' in updateData || 'plannedWindowEnd' in updateData || 'objectId' in updateData;
  if (willChangeWindow) {
    const effectiveObjectId = updateData.objectId ?? existingOrder.objectId;
    const effectiveStart = 'plannedWindowStart' in updateData ? updateData.plannedWindowStart : existingOrder.plannedWindowStart;
    const effectiveEnd = 'plannedWindowEnd' in updateData ? updateData.plannedWindowEnd : existingOrder.plannedWindowEnd;
    const prefFlags = await computeOutsidePreferredWindow(
      effectiveObjectId,
      effectiveStart,
      effectiveEnd,
    );
    updateData.outsidePreferredWindow = prefFlags.outsidePreferredWindow;
    updateData.deliveryPreferencePriority = prefFlags.deliveryPreferencePriority;
  }

  const workOrder = await storage.updateWorkOrder(req.params.id, updateData);
  if (!workOrder) throw new NotFoundError("Arbetsorder");

  // Audit-spår: logga vilka fält som ändrades (för aktivitetslistan på detaljsidan).
  try {
    const TRACKED_FIELDS: Array<keyof typeof workOrder> = [
      "title", "description", "priority", "orderStatus", "executionStatus",
      "scheduledDate", "scheduledStartTime", "notes", "plannedNotes",
      "resourceId", "teamId", "estimatedDuration",
    ];
    const normalize = (v: unknown): unknown => {
      if (v instanceof Date) return v.toISOString();
      return v ?? null;
    };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of TRACKED_FIELDS) {
      if (!(field in updateData)) continue;
      const b = normalize((existingOrder as Record<string, unknown>)[field as string]);
      const a = normalize((workOrder as Record<string, unknown>)[field as string]);
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        before[field as string] = b;
        after[field as string] = a;
      }
    }
    if (Object.keys(after).length > 0) {
      await storage.createAuditLog({
        tenantId,
        userId: getRequestUserId(req),
        action: "updated",
        resourceType: "work_order",
        resourceId: req.params.id,
        changes: { before, after },
      });
    }
  } catch (auditErr) {
    console.error(`[work-orders] failed to write update audit log for ${req.params.id}:`, auditErr);
  }

  const newResourceId = workOrder.resourceId;
  const oldResourceId = existingOrder.resourceId;

  if (newResourceId && newResourceId !== oldResourceId) {
    notificationService.notifyJobAssigned(workOrder, newResourceId);
    if (oldResourceId) {
      notificationService.notifyJobCancelled(existingOrder, oldResourceId);
    }
    try {
      const { maybeSendExtraJobSms, maybeSendCancellationSms } = await import("../extra-job-sms");
      void maybeSendExtraJobSms({ workOrder, resourceId: newResourceId, reason: "assigned" });
      if (oldResourceId) {
        void maybeSendCancellationSms({ workOrder: existingOrder, previousResourceId: oldResourceId });
      }
    } catch (e) {
      console.error("[extra-job-sms] hook failed (reassign):", e);
    }
  }

  if (newResourceId && updateData.scheduledDate !== undefined) {
    const oldDate = existingOrder.scheduledDate?.toISOString().split('T')[0];
    const newDate = workOrder.scheduledDate?.toISOString().split('T')[0];
    if (oldDate !== newDate) {
      notificationService.notifyScheduleChanged(workOrder, newResourceId, oldDate, newDate);
      if (newResourceId === oldResourceId) {
        try {
          const { maybeSendExtraJobSms } = await import("../extra-job-sms");
          void maybeSendExtraJobSms({ workOrder, resourceId: newResourceId, reason: "rescheduled" });
        } catch (e) {
          console.error("[extra-job-sms] hook failed (reschedule):", e);
        }
      }
    }
  }

  if (newResourceId && updateData.priority && updateData.priority !== existingOrder.priority) {
    notificationService.notifyPriorityChanged(workOrder, newResourceId, existingOrder.priority);
  }

  if (updateData.executionStatus === "completed" && existingOrder.executionStatus !== "completed" && workOrder.objectId) {
    try {
      const lines = await storage.getWorkOrderLines(workOrder.id);
      for (const line of lines) {
        if (line.articleId) {
          const article = await db.query.articles.findFirst({
            where: and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)),
          });
          if (article?.leaveMetadataCode) {
            let coercedValue: string = "";
            if (article.leaveMetadataFormat === "timestamp") {
              coercedValue = new Date().toISOString();
            } else if (article.leaveMetadataFormat === "boolean_true") {
              coercedValue = "true";
            } else if (article.leaveMetadataFormat === "counter_increment") {
              const current = await getArticleMetadataForObject(workOrder.objectId, article.leaveMetadataCode, tenantId);
              const currentNum = parseInt(current?.value || "0") || 0;
              coercedValue = String(currentNum + 1);
            } else {
              coercedValue = new Date().toISOString();
            }
            await writeArticleMetadataOnObject(
              workOrder.objectId,
              article.leaveMetadataCode,
              coercedValue,
              tenantId,
              `auto:${workOrder.id}`
            );
            console.log(`[metadata-writeback] Auto-wrote ${article.leaveMetadataCode}=${coercedValue} (format=${article.leaveMetadataFormat || 'default'}) on object ${workOrder.objectId} from work order ${workOrder.id}`);
          }
        }
      }
    } catch (metaErr) {
      console.error("[metadata-writeback] Error during auto-writeback:", metaErr);
    }

    // Task #693: systemgenererad, read-only metadata på objektet — "Senast
    // slutförd order". Best-effort; ett misslyckande får aldrig blockera
    // slutförandet.
    try {
      const completed = workOrder.completedAt ? new Date(workOrder.completedAt) : new Date();
      await writeSystemMetadataOnObject(
        workOrder.objectId,
        "Senast slutförd order",
        `${workOrder.title} (${completed.toISOString().slice(0, 10)})`,
        tenantId,
        `system:wo-completed:${workOrder.id}`,
      );
    } catch (e) {
      console.error("[task-693] writeSystemMetadataOnObject (Senast slutförd order) failed:", e);
    }
  }

  const isAssignmentChange = newResourceId !== oldResourceId;
  const isScheduleChange = updateData.scheduledDate !== undefined &&
    existingOrder.scheduledDate?.toISOString().split('T')[0] !== workOrder.scheduledDate?.toISOString().split('T')[0];
  const isPriorityChange = updateData.priority && updateData.priority !== existingOrder.priority;

  if (newResourceId && !isAssignmentChange && !isScheduleChange && !isPriorityChange) {
    const changes: string[] = [];
    if (updateData.orderStatus && updateData.orderStatus !== existingOrder.orderStatus) {
      changes.push(`status ändrad till ${updateData.orderStatus}`);
    }
    if (updateData.notes !== undefined && updateData.notes !== existingOrder.notes) {
      changes.push("anteckningar uppdaterade");
    }
    if (updateData.description !== undefined && updateData.description !== existingOrder.description) {
      changes.push("beskrivning uppdaterad");
    }
    if (changes.length > 0) {
      notificationService.notifyJobUpdated(workOrder, newResourceId, `${workOrder.title}: ${changes.join(", ")}`);
    }
  }

  const statusChanged = updateData.orderStatus && updateData.orderStatus !== existingOrder.orderStatus;
  const execStatusChanged = updateData.executionStatus && updateData.executionStatus !== existingOrder.executionStatus;
  if (statusChanged || execStatusChanged) {
    const oldSt = existingOrder.executionStatus || existingOrder.orderStatus;
    const newSt = updateData.executionStatus || updateData.orderStatus || "";
    handleWorkOrderStatusChange(workOrder.id, oldSt, newSt, tenantId).catch(err =>
      console.error("[ai-communication] Event hook error:", err)
    );
  }

  res.json(workOrder);
}));

app.delete("/api/work-orders/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getWorkOrder(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const force = req.query.force === "true" || req.query.force === "1";
  const role = (req as any).tenantRole as string | undefined;
  const isAdmin = role === "owner" || role === "admin";
  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim().slice(0, 500)
    : undefined;
  const userId = (req as any).user?.claims?.sub
    ?? (req as any).user?.id
    ?? null;

  // Hård spärr: utförda eller fakturerade ordrar får aldrig avbeställas
  // (audit/fakturahistorik måste bevaras).
  if (existing!.orderStatus === "utford" || existing!.orderStatus === "fakturerad") {
    throw new ConflictError(
      existing!.orderStatus === "utford"
        ? "Utförda ordrar kan inte avbeställas. Skapa en kreditfaktura eller markera som omöjlig istället."
        : "Fakturerade ordrar kan inte avbeställas. Kreditera fakturan via Fortnox-flödet istället."
    );
  }

  // Frusen WO snapshot — kräver force + admin (samma mönster som /freeze).
  if (existing!.frozenAt && !(force && isAdmin)) {
    throw new ConflictError(
      isAdmin
        ? "Ordern är fryst (frozen snapshot). Lägg till ?force=true för att radera ändå."
        : "Ordern är fryst (frozen snapshot) och kan bara avbeställas av administratör med tvångsläge."
    );
  }

  // Fortnox-export — kräver force + admin.
  const exports = await db.select({ id: fortnoxInvoiceExports.id })
    .from(fortnoxInvoiceExports)
    .where(eq(fortnoxInvoiceExports.workOrderId, req.params.id))
    .limit(1);
  if (exports.length > 0 && !(force && isAdmin)) {
    throw new ConflictError(
      isAdmin
        ? "Ordern har Fortnox-exporter kopplade till sig. Lägg till ?force=true för att radera ändå."
        : "Ordern har Fortnox-exporter kopplade till sig och kan bara avbeställas av administratör med tvångsläge."
    );
  }

  await storage.deleteWorkOrder(req.params.id, { reason, userId });

  // Audit-spår: skriv 'cancelled'-rad i auditLogs (work_order_history-ekvivalent).
  try {
    await storage.createAuditLog({
      tenantId,
      userId: userId ?? null,
      action: "cancelled",
      resourceType: "work_order",
      resourceId: req.params.id,
      changes: {
        before: { orderStatus: existing!.orderStatus, deletedAt: null },
        after: { orderStatus: existing!.orderStatus, deletedAt: new Date().toISOString() },
        reason: reason ?? null,
      },
      metadata: { force, frozenAt: existing!.frozenAt ?? null, hadFortnoxExports: exports.length > 0 },
    });
  } catch (auditErr) {
    console.error(`[work-orders] failed to write cancellation audit log for ${req.params.id}:`, auditErr);
  }

  // Task #693: systemgenererad, read-only metadata på objektet — "Senast
  // inställd order". Best-effort; ett misslyckande får aldrig blockera
  // avbeställningen.
  if (existing!.objectId) {
    try {
      await writeSystemMetadataOnObject(
        existing!.objectId,
        "Senast inställd order",
        `${existing!.title} (${new Date().toISOString().slice(0, 10)})`,
        tenantId,
        `system:wo-cancelled:${req.params.id}`,
      );
    } catch (e) {
      console.error("[task-693] writeSystemMetadataOnObject (Senast inställd order) failed:", e);
    }
  }

  console.log(`[work-orders] cancelled id=${req.params.id} tenant=${tenantId} userId=${userId} force=${force} reason=${reason ?? ""}`);
  res.status(204).send();
}));

// Återställ en avbeställd (soft-deleted) work order. Admin-only; idempotent
// (kan köras på redan återställd order). Tar bort metadata.cancellation och
// nollställer deletedAt så ordern dyker upp i normala vyer igen.
app.post("/api/work-orders/:id/restore", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  // OBS: storage.getWorkOrder() filtrerar bort soft-deleted (deletedAt IS NOT NULL),
  // så vi måste läsa direkt här för att kunna återställa avbeställda ordrar.
  const [existing] = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, req.params.id));
  if (!existing || existing.tenantId !== tenantId) {
    throw new NotFoundError("Arbetsorder");
  }
  if (!existing.deletedAt) {
    // Inte avbeställd — returnera ordern som den är (idempotent).
    return res.json(existing);
  }
  const restored = await storage.restoreWorkOrder(req.params.id);
  if (!restored) {
    throw new NotFoundError("Arbetsorder");
  }

  const userId = (req as any).user?.claims?.sub
    ?? (req as any).user?.id
    ?? null;
  try {
    await storage.createAuditLog({
      tenantId,
      userId: userId ?? null,
      action: "restored",
      resourceType: "work_order",
      resourceId: req.params.id,
      changes: {
        before: { deletedAt: existing.deletedAt },
        after: { deletedAt: null },
      },
      metadata: {
        cancellation: (existing.metadata as any)?.cancellation ?? null,
      },
    });
  } catch (auditErr) {
    console.error(`[work-orders] failed to write restore audit log for ${req.params.id}:`, auditErr);
  }

  console.log(`[work-orders] restored id=${req.params.id} tenant=${tenantId} userId=${userId}`);
  res.json(restored);
}));

app.get("/api/order-stock", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const includeSimulated = req.query.includeSimulated === "true";
  const includeCancelled = req.query.includeCancelled === "true";
  const scenarioId = req.query.scenarioId as string | undefined;
  const orderStatus = req.query.orderStatus as OrderStatus | undefined;
  const activeOnly = req.query.activeOnly !== "false";
  const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
  const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50;
  const search = req.query.search as string | undefined;

  let metadataFilters: { metadataName: string; operator: string; value: string }[] | undefined;
  const metadataFilterRaw = req.query.metadataFilter as string | undefined;
  if (metadataFilterRaw) {
    metadataFilters = metadataFilterRaw.split(",").map(f => {
      const parts = f.split(":");
      return { metadataName: parts[0], operator: parts[1] || 'eq', value: parts.slice(2).join(":") };
    }).filter(f => f.metadataName && f.value);
  }

  const { orders, total, byStatus, aggregates } = await storage.getOrderStock(tenantId, {
    includeSimulated, scenarioId, orderStatus, activeOnly, startDate, endDate, page, pageSize, search, metadataFilters, includeCancelled,
  });

  const summary = {
    totalOrders: total,
    totalValue: aggregates.totalValue,
    totalCost: aggregates.totalCost,
    totalProductionMinutes: aggregates.totalProductionMinutes,
    byStatus
  };

  res.json({ orders, summary, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
}));

// Bulk-räkna om cachedValue/cachedCost/cachedProductionMinutes på alla ordrar
// som matchar samma filter som GET /api/order-stock. Returnerar antal omräknade
// och antal vars värde faktiskt ändrades.
app.post("/api/order-stock/recalculate", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const includeSimulated = req.body?.includeSimulated === true || req.body?.includeSimulated === "true";
  const scenarioId = (req.body?.scenarioId as string | undefined) || undefined;
  const orderStatus = (req.body?.orderStatus as OrderStatus | undefined) || undefined;
  const activeOnly = req.body?.activeOnly !== false && req.body?.activeOnly !== "false";
  const startDate = req.body?.startDate ? new Date(req.body.startDate as string) : undefined;
  const endDate = req.body?.endDate ? new Date(req.body.endDate as string) : undefined;
  const search = (req.body?.search as string | undefined) || undefined;

  let metadataFilters: { metadataName: string; operator: string; value: string }[] | undefined;
  const metadataFilterRaw = req.body?.metadataFilter as string | undefined;
  if (metadataFilterRaw) {
    metadataFilters = metadataFilterRaw.split(",").map((f: string) => {
      const parts = f.split(":");
      return { metadataName: parts[0], operator: parts[1] || 'eq', value: parts.slice(2).join(":") };
    }).filter((f: { metadataName: string; value: string }) => f.metadataName && f.value);
  }

  // Hämta alla matchande order-IDs genom att paginera. 5000/sida räcker för
  // att hålla varje fråga snabb och funkar oavsett tenantstorlek.
  const PAGE = 5000;
  const allIds: string[] = [];
  let page = 1;
  while (true) {
    const pageResult = await storage.getOrderStock(tenantId, {
      includeSimulated, scenarioId, orderStatus, activeOnly, startDate, endDate,
      page, pageSize: PAGE, search, metadataFilters,
    });
    for (const o of pageResult.orders) allIds.push(o.id);
    // Sluta när vi nått totalantalet eller fått en delsida.
    if (allIds.length >= pageResult.total || pageResult.orders.length < PAGE) break;
    page++;
    // Safety-guard: bryt vid orimligt många sidor (≈500k ordrar).
    if (page > 100) break;
  }

  const recalcResult = await storage.recalculateWorkOrderTotalsBulk(allIds);
  res.json({ matched: allIds.length, recalculated: recalcResult.recalculated, changed: recalcResult.changed });
}));

// Web/admin-endpoint: enkel `status`-uppdatering med strikt enum-validering (`ORDER_STATUSES`)
// och övergångsregler i `storage.updateWorkOrderStatus`. Skiljer sig medvetet från:
//  - `PATCH /api/mobile/orders/:id/status` (mobile, mappar paborjad/utford/en_route/...
//    till executionStatus + sidoeffekter: ETA-SMS, signature, completion-time).
//  - `POST /api/field-worker/tasks/:id/complete` (smal field-worker shortcut: alltid
//    completed + dependency-cascade).
//  - `POST /api/mobile/status` (gäller resurs online/offline, ej work-order — namnet
//    är historiskt och bör inte ändras utan mobil-app-bump).
// Se `docs/wo-status-endpoints.md` för beslutsmatris.
app.post("/api/work-orders/:id/status", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getWorkOrder(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const { status } = req.body;
  if (!ORDER_STATUSES.includes(status)) {
    throw new ValidationError(`Invalid status. Must be one of: ${ORDER_STATUSES.join(", ")}`);
  }
  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim().slice(0, 500) || null
    : null;

  try {
    const previousStatus = existing!.orderStatus;
    const workOrder = await storage.updateWorkOrderStatus(req.params.id, status);
    if (!workOrder) throw new NotFoundError("Arbetsorder");

    if (previousStatus !== status) {
      try {
        await storage.createAuditLog({
          tenantId,
          userId: getRequestUserId(req),
          action: "status_changed",
          resourceType: "work_order",
          resourceId: req.params.id,
          changes: {
            before: { orderStatus: previousStatus },
            after: { orderStatus: status },
            reason,
          },
        });
      } catch (auditErr) {
        console.error(`[work-orders] failed to write status-change audit log for ${req.params.id}:`, auditErr);
      }
    }

    res.json(workOrder);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Ogiltig statusövergång")) {
      throw new ConflictError(error.message);
    }
    throw error;
  }
}));

app.get("/api/work-orders/:workOrderId/lines", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }
  const lines = await storage.getWorkOrderLines(req.params.workOrderId);

  const enrichedLines = await Promise.all(lines.map(async (line) => {
    const article = line.articleId ? await storage.getArticle(line.articleId) : null;
    return {
      ...line,
      articleName: article?.name || line.description || "Fritext",
      articleDescription: article?.description,
    };
  }));

  res.json(enrichedLines);
}));

app.post("/api/work-orders/:workOrderId/lines", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const { articleId, quantity = 1, isOptional = false, notes, priceListId, description } = req.body;

  // Enkel uppgift (Task #736): en rad är antingen en artikelrad (articleId) ELLER
  // en fritext-/blindgångar-rad (description + manuellt pris/tid i öre/minuter).
  if (!articleId) {
    const trimmedDescription = typeof description === "string" ? description.trim() : "";
    if (!trimmedDescription) {
      throw new ValidationError("Antingen articleId eller description krävs för en orderrad");
    }
    const unitPrice = Math.max(0, Math.round(Number(req.body.unitPrice ?? 0)));
    const unitCost = Math.max(0, Math.round(Number(req.body.unitCost ?? 0)));
    const productionMinutes = Math.max(0, Math.round(Number(req.body.productionMinutes ?? 0)));
    const freeTextLineData = insertWorkOrderLineSchema.parse({
      tenantId,
      workOrderId: req.params.workOrderId,
      articleId: null,
      description: trimmedDescription,
      quantity,
      resolvedPrice: unitPrice,
      resolvedCost: unitCost,
      resolvedProductionMinutes: productionMinutes,
      priceListIdUsed: null,
      priceSource: "manual",
      isOptional,
      notes,
    });
    const freeTextLine = await storage.createWorkOrderLine(freeTextLineData);
    return res.status(201).json(freeTextLine);
  }

  let priceInfo: { price: number; cost: number; productionMinutes: number; priceListId: string | null; source: string };

  if (priceListId) {
    priceInfo = await storage.resolveArticlePriceFromList(tenantId, articleId, priceListId);
  } else {
    priceInfo = await storage.resolveArticlePrice(tenantId, articleId, workOrder.customerId);
  }

  const [articleRow] = await db.select({ quantityMode: articles.quantityMode })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, tenantId)));
  const effectiveQuantity = articleRow?.quantityMode === 'single_per_task' ? 1 : quantity;

  const lineData = insertWorkOrderLineSchema.parse({
    tenantId,
    workOrderId: req.params.workOrderId,
    articleId,
    quantity: effectiveQuantity,
    resolvedPrice: priceInfo.price,
    resolvedCost: priceInfo.cost,
    resolvedProductionMinutes: priceInfo.productionMinutes,
    priceListIdUsed: priceInfo.priceListId,
    priceSource: priceInfo.source,
    isOptional,
    notes
  });

  const line = await storage.createWorkOrderLine(lineData);
  res.status(201).json(line);
}));

app.patch("/api/work-order-lines/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existingLine = await storage.getWorkOrderLine(req.params.id);
  if (!existingLine) throw new NotFoundError("Orderrad");

  const workOrder = await storage.getWorkOrder(existingLine.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Orderrad");
  }

  const updateSchema = insertWorkOrderLineSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  const { id: _id, tenantId: _t, workOrderId: _w, createdAt: _c, ...updateData } = parseResult.data as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(updateData, "isCompleted")) {
    const next = updateData.isCompleted === true;
    (updateData as Record<string, unknown>).isCompleted = next;
    (updateData as Record<string, unknown>).completedAt = next
      ? (existingLine.completedAt ?? new Date())
      : null;
  }
  const line = await storage.updateWorkOrderLine(req.params.id, updateData);
  if (!line) throw new NotFoundError("Orderrad");

  res.json(line);
}));

app.delete("/api/work-order-lines/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const line = await storage.getWorkOrderLine(req.params.id);
  if (!line) throw new NotFoundError("Orderrad");

  const workOrder = await storage.getWorkOrder(line.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Orderrad");
  }

  await storage.deleteWorkOrderLine(req.params.id);

  res.status(204).send();
}));

app.get("/api/work-orders/:workOrderId/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }
  const objects = await storage.getWorkOrderObjects(req.params.workOrderId);
  res.json(objects);
}));

app.post("/api/work-orders/:workOrderId/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  const { objectId, isPrimary, sortOrder, notes } = req.body;
  if (!objectId) {
    throw new ValidationError("objectId is required");
  }

  await ensureObjectInTenant(objectId, tenantId);

  const existingObjects = await storage.getWorkOrderObjects(req.params.workOrderId);
  const isDuplicate = existingObjects.some(o => o.objectId === objectId);
  if (isDuplicate) {
    throw new ConflictError("Object is already linked to this work order");
  }

  const workOrderObject = await storage.createWorkOrderObject({
    tenantId,
    workOrderId: req.params.workOrderId,
    objectId,
    isPrimary: isPrimary || false,
    sortOrder: sortOrder || 0,
    notes
  });

  res.status(201).json(workOrderObject);
}));

app.delete("/api/work-order-objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrderObject = await storage.getWorkOrderObject(req.params.id);
  if (!workOrderObject) throw new NotFoundError("Arbetsorderobjekt");

  const workOrder = await storage.getWorkOrder(workOrderObject.workOrderId);
  if (!verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorderobjekt");
  }

  await storage.deleteWorkOrderObject(req.params.id);
  res.status(204).send();
}));

app.get("/api/resolve-price", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { articleId, customerId, date } = req.query;

  if (!articleId || !customerId) {
    throw new ValidationError("articleId and customerId are required");
  }

  const priceInfo = await storage.resolveArticlePrice(
    tenantId,
    articleId as string,
    customerId as string,
    date ? new Date(date as string) : undefined
  );

  res.json(priceInfo);
}));

app.get("/api/simulation-scenarios", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const scenarios = await storage.getSimulationScenarios(tenantId);
  res.json(scenarios);
}));

app.get("/api/simulation-scenarios/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const scenario = await storage.getSimulationScenario(req.params.id);
  const verified = verifyTenantOwnership(scenario, tenantId);
  if (!verified) throw new NotFoundError("Simuleringscenario");
  res.json(verified);
}));

app.post("/api/simulation-scenarios", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertSimulationScenarioSchema.parse({ ...req.body, tenantId });
  const scenario = await storage.createSimulationScenario(data);
  res.status(201).json(scenario);
}));

app.patch("/api/simulation-scenarios/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getSimulationScenario(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Simuleringscenario");
  }
  const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
  const scenario = await storage.updateSimulationScenario(req.params.id, updateData);
  if (!scenario) throw new NotFoundError("Simuleringscenario");
  res.json(scenario);
}));

app.delete("/api/simulation-scenarios/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getSimulationScenario(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Simuleringscenario");
  }
  await storage.deleteSimulationScenario(req.params.id);
  res.status(204).send();
}));

app.post("/api/simulation-scenarios/:id/clone-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { orderIds } = req.body;
  const scenarioId = req.params.id;

  const scenario = await storage.getSimulationScenario(scenarioId);
  if (!verifyTenantOwnership(scenario, tenantId)) {
    throw new NotFoundError("Simuleringscenario");
  }

  const cloneSchema = z.object({
    orderIds: z.array(z.string().min(1)).min(1, "Minst en order krävs"),
  });
  const parsed = cloneSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const validatedOrderIds = parsed.data.orderIds;

  const originals = await Promise.all(validatedOrderIds.map(id => storage.getWorkOrder(id)));
  for (let i = 0; i < validatedOrderIds.length; i++) {
    const original = originals[i];
    if (!original) {
      throw new NotFoundError(`Order ${validatedOrderIds[i]} hittades inte`);
    }
    if (original.tenantId !== tenantId) {
      throw new ForbiddenError(`Order ${validatedOrderIds[i]} tillhör inte din organisation`);
    }
  }

  const clonedOrders = [];
  for (const original of originals) {
    if (!original) continue;

    const clonedOrder = await storage.createWorkOrder({
      tenantId,
      customerId: original.customerId,
      objectId: original.objectId,
      resourceId: original.resourceId,
      title: `[SIM] ${original.title}`,
      description: original.description,
      orderType: original.orderType,
      priority: original.priority,
      orderStatus: 'skapad',
      scheduledDate: original.scheduledDate,
      scheduledStartTime: original.scheduledStartTime,
      estimatedDuration: original.estimatedDuration,
      isSimulated: true,
      simulationScenarioId: scenarioId,
      notes: original.notes,
      metadata: original.metadata as Record<string, unknown> | undefined
    });

    const lines = await storage.getWorkOrderLines(original.id);
    for (const line of lines) {
      await storage.createWorkOrderLine({
        tenantId,
        workOrderId: clonedOrder.id,
        articleId: line.articleId,
        quantity: line.quantity,
        resolvedPrice: line.resolvedPrice,
        resolvedCost: line.resolvedCost,
        resolvedProductionMinutes: line.resolvedProductionMinutes,
        priceListIdUsed: line.priceListIdUsed,
        isOptional: line.isOptional,
        notes: line.notes
      }, { skipRecalc: true });
    }

    await storage.recalculateWorkOrderTotals(clonedOrder.id);
    clonedOrders.push(clonedOrder);
  }

  res.status(201).json({ clonedOrders, count: clonedOrders.length });
}));

app.post("/api/work-orders/:id/promote", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrder = await storage.getWorkOrder(req.params.id);
  if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
    throw new NotFoundError("Arbetsorder");
  }

  if (!workOrder.isSimulated) {
    throw new ValidationError("Order is not simulated");
  }

  const updatedTitle = workOrder.title?.replace(/^\[SIM\] /, "") || workOrder.title;
  const promoted = await storage.updateWorkOrder(req.params.id, {
    isSimulated: false,
    simulationScenarioId: null,
    title: updatedTitle
  });

  res.json(promoted);
}));

app.post("/api/setup-time-logs", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertSetupTimeLogSchema.parse({ ...req.body, tenantId });
  const log = await storage.createSetupTimeLog(data);
  res.status(201).json(log);
}));

app.get("/api/setup-time-logs", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const objectId = req.query.objectId as string | undefined;
  const logs = await storage.getSetupTimeLogs(tenantId, objectId);
  res.json(logs);
}));

app.get("/api/procurements", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const procurements = await storage.getProcurements(tenantId);
  res.json(procurements);
}));

app.get("/api/procurements/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const procurement = await storage.getProcurement(req.params.id);
  const verified = verifyTenantOwnership(procurement, tenantId);
  if (!verified) throw new NotFoundError("Upphandling");
  res.json(verified);
}));

app.post("/api/procurements", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertProcurementSchema.parse({ ...req.body, tenantId });
  const procurement = await storage.createProcurement(data);
  res.status(201).json(procurement);
}));

app.patch("/api/procurements/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getProcurement(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Upphandling");
  }
  const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
  const procurement = await storage.updateProcurement(req.params.id, updateData);
  if (!procurement) throw new NotFoundError("Upphandling");
  res.json(procurement);
}));

app.post("/api/work-orders/bulk-apply-lines", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { sourceWorkOrderId, targetWorkOrderIds } = req.body;

  if (!sourceWorkOrderId || !Array.isArray(targetWorkOrderIds) || targetWorkOrderIds.length === 0) {
    throw new ValidationError("sourceWorkOrderId och targetWorkOrderIds (array) krävs");
  }

  const sourceOrder = await storage.getWorkOrder(sourceWorkOrderId);
  if (!verifyTenantOwnership(sourceOrder, tenantId)) {
    throw new NotFoundError("Käll-arbetsorder");
  }

  const sourceLines = await storage.getWorkOrderLines(sourceWorkOrderId);
  if (sourceLines.length === 0) {
    return res.json({ applied: 0, targets: targetWorkOrderIds.length, message: "Inga artiklar att tillämpa" });
  }

  let applied = 0;
  for (const targetId of targetWorkOrderIds) {
    if (targetId === sourceWorkOrderId) continue;
    const targetOrder = await storage.getWorkOrder(targetId);
    if (!verifyTenantOwnership(targetOrder, tenantId)) continue;

    const existingLines = await storage.getWorkOrderLines(targetId);
    for (const existing of existingLines) {
      await storage.deleteWorkOrderLine(existing.id, { skipRecalc: true });
    }

    for (const line of sourceLines) {
      let priceInfo: { price: number; cost: number; productionMinutes: number; priceListId: string | null; source: string };
      if (line.priceListIdUsed) {
        priceInfo = await storage.resolveArticlePriceFromList(tenantId, line.articleId!, line.priceListIdUsed);
      } else {
        priceInfo = await storage.resolveArticlePrice(tenantId, line.articleId!, targetOrder!.customerId);
      }

      const [articleRow] = await db.select({ quantityMode: articles.quantityMode })
        .from(articles)
        .where(and(eq(articles.id, line.articleId!), eq(articles.tenantId, tenantId)));
      const effectiveQuantity = articleRow?.quantityMode === 'single_per_task' ? 1 : line.quantity;

      const lineData = insertWorkOrderLineSchema.parse({
        tenantId,
        workOrderId: targetId,
        articleId: line.articleId,
        quantity: effectiveQuantity,
        resolvedPrice: priceInfo.price,
        resolvedCost: priceInfo.cost,
        resolvedProductionMinutes: priceInfo.productionMinutes,
        priceListIdUsed: priceInfo.priceListId,
        priceSource: priceInfo.source,
        isOptional: line.isOptional,
        notes: line.notes,
      });
      await storage.createWorkOrderLine(lineData, { skipRecalc: true });
    }

    await storage.recalculateWorkOrderTotals(targetId);
    applied++;
  }

  res.json({ applied, targets: targetWorkOrderIds.length, linesPerOrder: sourceLines.length });
}));

app.delete("/api/procurements/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getProcurement(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Upphandling");
  }
  await storage.deleteProcurement(req.params.id);
  res.status(204).send();
}));

app.get("/api/chain-trace/by-concept/:conceptId", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { conceptId } = req.params;

  const [concept] = await db.select()
    .from(orderConcepts)
    .where(and(eq(orderConcepts.id, conceptId), eq(orderConcepts.tenantId, tenantId)));
  if (!concept) {
    throw new NotFoundError("Orderkoncept hittades inte");
  }

  if (!concept.customerId) {
    return res.json({ workOrderId: null });
  }

  if (concept.articleId) {
    const matched = await db.select({ workOrderId: workOrderLines.workOrderId })
      .from(workOrderLines)
      .innerJoin(workOrders, and(eq(workOrderLines.workOrderId, workOrders.id), eq(workOrders.tenantId, tenantId)))
      .where(and(
        eq(workOrderLines.tenantId, tenantId),
        eq(workOrderLines.articleId, concept.articleId),
        eq(workOrders.customerId, concept.customerId),
      ))
      .orderBy(desc(workOrders.createdAt))
      .limit(1);

    if (matched.length > 0) {
      return res.json({ workOrderId: matched[0].workOrderId });
    }
  }

  const fallback = await db.select({ id: workOrders.id })
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.customerId, concept.customerId),
    ))
    .orderBy(desc(workOrders.createdAt))
    .limit(1);

  res.json({ workOrderId: fallback.length > 0 ? fallback[0].id : null });
}));

app.get("/api/chain-trace/:workOrderId", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { workOrderId } = req.params;

  const wo = await storage.getWorkOrder(workOrderId);
  if (!wo || !verifyTenantOwnership(wo, tenantId)) {
    throw new NotFoundError("Arbetsorder hittades inte");
  }

  const [customerRaw, objectRaw, resourceRaw] = await Promise.all([
    wo.customerId ? storage.getCustomer(wo.customerId) : Promise.resolve(undefined),
    wo.objectId ? storage.getObject(wo.objectId) : Promise.resolve(undefined),
    wo.resourceId ? storage.getResource(wo.resourceId) : Promise.resolve(undefined),
  ]);
  const customer = customerRaw && verifyTenantOwnership(customerRaw, tenantId) ? customerRaw : undefined;
  const object = objectRaw && verifyTenantOwnership(objectRaw, tenantId) ? objectRaw : undefined;
  const resource = resourceRaw && verifyTenantOwnership(resourceRaw, tenantId) ? resourceRaw : undefined;

  const [lines, invoiceExports, protocolRows] = await Promise.all([
    db.select({
      id: workOrderLines.id,
      articleId: workOrderLines.articleId,
      quantity: workOrderLines.quantity,
      resolvedPrice: workOrderLines.resolvedPrice,
      priceSource: workOrderLines.priceSource,
      articleName: articles.name,
      articleNumber: articles.articleNumber,
    })
      .from(workOrderLines)
      .leftJoin(articles, and(eq(workOrderLines.articleId, articles.id), eq(articles.tenantId, tenantId)))
      .where(and(eq(workOrderLines.workOrderId, workOrderId), eq(workOrderLines.tenantId, tenantId))),
    db.select()
      .from(fortnoxInvoiceExports)
      .where(and(eq(fortnoxInvoiceExports.workOrderId, workOrderId), eq(fortnoxInvoiceExports.tenantId, tenantId)))
      .orderBy(desc(fortnoxInvoiceExports.createdAt)),
    db.select()
      .from(protocols)
      .where(and(eq(protocols.workOrderId, workOrderId), eq(protocols.tenantId, tenantId)))
      .orderBy(desc(protocols.executedAt)),
  ]);

  let concept: OrderConcept | null = null;
  let conceptMatchType: "article" | null = null;
  if (wo.customerId) {
    const conceptRows = await db.select()
      .from(orderConcepts)
      .where(and(
        eq(orderConcepts.tenantId, tenantId),
        eq(orderConcepts.customerId, wo.customerId),
      ))
      .orderBy(desc(orderConcepts.createdAt));
    if (conceptRows.length > 0) {
      const lineArticleIds = lines.map(l => l.articleId);
      const matchedConcept = conceptRows.find(c => c.articleId && lineArticleIds.includes(c.articleId));
      if (matchedConcept) {
        concept = matchedConcept;
        conceptMatchType = "article";
      }
    }
  }

  const trace = {
    avtal: concept ? {
      id: concept.id,
      name: concept.name,
      scenario: concept.scenario,
      status: concept.status,
      customerId: concept.customerId,
      customerName: customer?.name || null,
      articleId: concept.articleId,
      matchType: conceptMatchType,
    } : customer ? {
      id: null,
      name: null,
      scenario: null,
      status: null,
      customerId: customer.id,
      customerName: customer.name,
      articleId: null,
      matchType: null,
    } : null,
    artiklar: lines.map(l => ({
      id: l.id,
      articleId: l.articleId,
      articleNumber: l.articleNumber,
      name: l.articleName,
      quantity: l.quantity,
      resolvedPrice: l.resolvedPrice,
      priceSource: l.priceSource,
    })),
    uppgift: {
      id: wo.id,
      title: wo.title,
      status: wo.status,
      orderStatus: wo.orderStatus,
      scheduledDate: wo.scheduledDate,
      completedAt: wo.completedAt,
      objectId: wo.objectId,
      objectName: object?.name || null,
      objectAddress: object?.address || null,
      parentWorkOrderId: wo.parentWorkOrderId ?? null,
    },
    resurs: resource ? {
      id: resource.id,
      name: resource.name,
      resourceType: resource.resourceType,
      phone: resource.phone,
    } : null,
    utfall: {
      completedAt: wo.completedAt,
      actualDuration: wo.actualDuration,
      protocols: protocolRows.map(p => ({
        id: p.id,
        protocolType: p.protocolType,
        protocolNumber: p.protocolNumber,
        executedAt: p.executedAt,
        executedByName: p.executedByName,
        assessmentRating: p.assessmentRating,
        status: p.status,
      })),
    },
    faktura: invoiceExports.map(inv => ({
      id: inv.id,
      fortnoxInvoiceNumber: inv.fortnoxInvoiceNumber,
      status: inv.status,
      totalAmount: inv.totalAmount,
      exportedAt: inv.exportedAt,
      isCreditInvoice: inv.isCreditInvoice,
    })),
  };

  res.json(trace);
}));

// ============== ADR v3 (F5): Frozen Snapshot + Invoice Recalculation ==============
app.post("/api/work-orders/:id/freeze", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const force = req.query.force === "true" || req.body?.force === true;
  try {
    const result = await storage.freezeWorkOrder(req.params.id, tenantId, { force });
    res.json(result);
  } catch (err: any) {
    throw new AppError(err.message || "Kunde inte frysa arbetsordern", 404, { code: "ERR_NOT_FOUND" });
  }
}));

app.post("/api/work-orders/:id/recalculate", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "manual";
  try {
    const result = await storage.recalculateWorkOrder(req.params.id, tenantId, userId, reason);
    res.json(result);
  } catch (err: any) {
    throw new ValidationError(err.message || "Kunde inte rakna om");
  }
}));

app.get("/api/invoice-recalculation-log", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const workOrderId = typeof req.query.workOrderId === "string" ? req.query.workOrderId : undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const rows = await storage.getInvoiceRecalculationLogs(tenantId, { workOrderId, limit, offset });
  res.json(rows);
}));

}
