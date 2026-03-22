import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { objects, workOrders, articles } from "@shared/schema";
import { getISOWeek } from "./helpers";

export async function registerFortnoxRoutes(app: Express) {
// ============================================
// FORTNOX INTEGRATION
// ============================================

const { createFortnoxClient, exportWorkOrderToFortnox } = await import("../fortnox-client");

// Fortnox OAuth Authorization
app.get("/api/fortnox/authorize", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    const redirectUri = `${req.protocol}://${req.get("host")}/api/fortnox/callback`;
    const state = Buffer.from(JSON.stringify({ tenantId, timestamp: Date.now() })).toString("base64");
    
    const authUrl = await client.getAuthorizationUrlWithConfig(redirectUri, state);
    if (!authUrl) {
      throw new ValidationError("Fortnox configuration missing - please add Client ID first");
    }
    
    res.json({ authUrl });
}));

// Fortnox OAuth Callback
app.get("/api/fortnox/callback", asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    
    if (oauthError) {
      return res.redirect(`/fortnox?error=${encodeURIComponent(oauthError as string)}`);
    }
    
    if (!code || !state) {
      return res.redirect("/fortnox?error=missing_code");
    }

    let stateData: { tenantId: string };
    try {
      stateData = JSON.parse(Buffer.from(state as string, "base64").toString());
    } catch {
      return res.redirect("/fortnox?error=invalid_state");
    }

    const client = createFortnoxClient(stateData.tenantId);
    const redirectUri = `${req.protocol}://${req.get("host")}/api/fortnox/callback`;
    
    await client.exchangeCodeForTokens(code as string, redirectUri);
    
    res.redirect("/fortnox?success=true");
}));

// Fortnox Connection Status
app.get("/api/fortnox/status", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    const config = await storage.getFortnoxConfig(tenantId);
    
    res.json({
      isConnected,
      hasConfig: !!config?.clientId,
      tokenExpiresAt: config?.tokenExpiresAt,
    });
}));

// Process Fortnox Export (send to Fortnox API)
app.post("/api/fortnox/exports/:id/process", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await exportWorkOrderToFortnox(tenantId, req.params.id);
    
    if (result.success) {
      res.json({ success: true, invoiceNumber: result.invoiceNumber });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
}));

// Fortnox Config
app.get("/api/fortnox/config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const config = await storage.getFortnoxConfig(tenantId);
    res.json(config || null);
}));

app.post("/api/fortnox/config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      throw new ValidationError("Client ID and Secret required");
    }

    const existing = await storage.getFortnoxConfig(tenantId);
    if (existing) {
      const updated = await storage.updateFortnoxConfig(tenantId, {
        clientId,
        clientSecret,
        isActive: true
      });
      return res.json(updated);
    }

    const config = await storage.createFortnoxConfig({
      tenantId,
      clientId,
      clientSecret,
      isActive: true
    });
    res.status(201).json(config);
}));

app.patch("/api/fortnox/config", asyncHandler(async (req, res) => {
    const updateSchema = z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      isActive: z.boolean().optional(),
      accessToken: z.string().nullable().optional(),
      refreshToken: z.string().nullable().optional(),
      tokenExpiresAt: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
    });
    const updateData = updateSchema.parse(req.body);
    const tenantId = getTenantIdWithFallback(req);
    const config = await storage.updateFortnoxConfig(tenantId, updateData);
    if (!config) throw new NotFoundError("Konfiguration hittades inte");
    res.json(config);
}));

// Fortnox Mappings
app.get("/api/fortnox/mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const entityType = req.query.entityType as string | undefined;
    const mappings = await storage.getFortnoxMappings(tenantId, entityType);
    res.json(mappings);
}));

app.post("/api/fortnox/mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { entityType, unicornId, fortnoxId } = req.body;
    if (!entityType || !unicornId || !fortnoxId) {
      throw new ValidationError("Alla fält krävs");
    }

    const existing = await storage.getFortnoxMapping(tenantId, entityType, unicornId);
    if (existing) {
      const updated = await storage.updateFortnoxMapping(existing.id, tenantId, { fortnoxId, lastSyncedAt: new Date() });
      return res.json(updated);
    }

    const mapping = await storage.createFortnoxMapping({
      tenantId,
      entityType,
      unicornId,
      fortnoxId
    });
    res.status(201).json(mapping);
}));

app.delete("/api/fortnox/mappings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteFortnoxMapping(req.params.id, tenantId);
    res.status(204).send();
}));

// Fortnox Invoice Exports
app.get("/api/fortnox/exports", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const status = req.query.status as string | undefined;
    const exports = await storage.getFortnoxInvoiceExports(tenantId, status);
    res.json(exports);
}));

app.post("/api/fortnox/exports", asyncHandler(async (req, res) => {
    const { workOrderId, payerId, costCenter, project } = req.body;
    if (!workOrderId) {
      throw new ValidationError("Arbetsorder-ID krävs");
    }

    const tenantId = getTenantIdWithFallback(req);
    const invoiceExport = await storage.createFortnoxInvoiceExport({
      tenantId,
      workOrderId,
      payerId: payerId || null,
      costCenter: costCenter || null,
      project: project || null,
      status: "pending"
    });
    res.status(201).json(invoiceExport);
}));

app.patch("/api/fortnox/exports/:id", asyncHandler(async (req, res) => {
    const updateSchema = z.object({
      status: z.string().optional(),
      fortnoxInvoiceNumber: z.string().nullable().optional(),
      errorMessage: z.string().nullable().optional(),
      exportedAt: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
    });
    const updateData = updateSchema.parse(req.body);
    const tenantId = getTenantIdWithFallback(req);
    const invoiceExport = await storage.updateFortnoxInvoiceExport(req.params.id, tenantId, updateData);
    if (!invoiceExport) throw new NotFoundError("Export hittades inte");
    res.json(invoiceExport);
}));

// ============================================
// OBJECT IMAGES - Bildgalleri per objekt
// ============================================

app.get("/api/objects/:objectId/images", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const images = await storage.getObjectImages(req.params.objectId);
    res.json(images);
}));

app.post("/api/objects/:objectId/images", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const data = insertObjectImageSchema.parse({
      ...req.body,
      tenantId,
      objectId: req.params.objectId
    });
    const image = await storage.createObjectImage(data);
    res.status(201).json(image);
}));

app.delete("/api/objects/:objectId/images/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    await storage.deleteObjectImage(req.params.id, req.params.objectId, tenantId);
    res.status(204).send();
}));

// ============================================
// OBJECT CONTACTS - Kontakter med arvslogik
// ============================================

app.get("/api/objects/:objectId/contacts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const withInheritance = req.query.inheritance === "true";
    const contacts = withInheritance
      ? await storage.getObjectContactsWithInheritance(req.params.objectId, tenantId)
      : await storage.getObjectContacts(req.params.objectId);
    res.json(contacts);
}));

app.post("/api/objects/:objectId/contacts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const data = insertObjectContactSchema.parse({
      ...req.body,
      tenantId,
      objectId: req.params.objectId
    });
    const contact = await storage.createObjectContact(data);
    res.status(201).json(contact);
}));

app.patch("/api/objects/:objectId/contacts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const updateSchema = z.object({
      name: z.string().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      role: z.string().nullable().optional(),
      contactType: z.string().optional(),
      isInheritable: z.boolean().optional(),
      notes: z.string().nullable().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const contact = await storage.updateObjectContact(req.params.id, req.params.objectId, tenantId, updateData);
    if (!contact) throw new NotFoundError("Kontakt hittades inte");
    res.json(contact);
}));

app.delete("/api/objects/:objectId/contacts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    await storage.deleteObjectContact(req.params.id, req.params.objectId, tenantId);
    res.status(204).send();
}));

// ============================================
// TASK TIMEWINDOWS - Flera önskade tidsfönster per uppgift
// ============================================

app.get("/api/task-timewindows", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const timewindows = await storage.getAllTaskTimewindows(tenantId);
    res.json(timewindows);
}));

app.get("/api/work-orders/:workOrderId/timewindows", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const timewindows = await storage.getTaskTimewindows(req.params.workOrderId);
    res.json(timewindows);
}));

app.post("/api/work-orders/:workOrderId/timewindows", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const data = insertTaskDesiredTimewindowSchema.parse({
      ...req.body,
      tenantId,
      workOrderId: req.params.workOrderId
    });
    const timewindow = await storage.createTaskTimewindow(data);
    res.status(201).json(timewindow);
}));

app.patch("/api/work-orders/:workOrderId/timewindows/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const updateSchema = z.object({
      weekNumber: z.number().nullable().optional(),
      dayOfWeek: z.string().nullable().optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      priority: z.number().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const timewindow = await storage.updateTaskTimewindow(req.params.id, req.params.workOrderId, tenantId, updateData);
    if (!timewindow) throw new NotFoundError("Tidsfönster hittades inte");
    res.json(timewindow);
}));

app.delete("/api/work-orders/:workOrderId/timewindows/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    await storage.deleteTaskTimewindow(req.params.id, req.params.workOrderId, tenantId);
    res.status(204).send();
}));

// ============================================
// AUTO-PLAN WEEK (Fyll Veckan) - C4
// ============================================
app.post("/api/auto-plan-week", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { weekStartDate, resourceIds, overbookingPercent = 0 } = req.body;

    if (!weekStartDate || !resourceIds || !Array.isArray(resourceIds)) {
      throw new ValidationError("weekStartDate and resourceIds[] required");
    }

    const weekStart = new Date(weekStartDate);
    const weekDays: Date[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      weekDays.push(d);
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);
    const allWorkOrders = await storage.getWorkOrders(tenantId, weekStart, weekEnd, true);
    const allResources = await storage.getResources(tenantId);

    const selectedResources = allResources.filter(r => resourceIds.includes(r.id));
    if (selectedResources.length === 0) {
      throw new ValidationError("Inga giltiga resurser hittades");
    }

    const allTeams = await storage.getTeams(tenantId);
    const allTeamMembers = await storage.getAllTeamMembers(tenantId);
    const allProfileAssignments = await storage.getResourceProfileAssignments(tenantId);
    const allProfiles = await storage.getResourceProfiles(tenantId);
    const resourceProfileCodes = new Map<string, Set<string>>();
    for (const assignment of allProfileAssignments) {
      const profile = allProfiles.find(p => p.id === assignment.profileId && p.status === "active");
      if (profile?.executionCodes && profile.executionCodes.length > 0) {
        if (!resourceProfileCodes.has(assignment.resourceId)) {
          resourceProfileCodes.set(assignment.resourceId, new Set());
        }
        for (const code of profile.executionCodes) {
          resourceProfileCodes.get(assignment.resourceId)!.add(code);
        }
      }
    }
    for (const tm of allTeamMembers) {
      const team = allTeams.find(t => t.id === tm.teamId);
      if (team?.profileIds && team.profileIds.length > 0) {
        for (const profileId of team.profileIds) {
          const profile = allProfiles.find(p => p.id === profileId && p.status === "active");
          if (profile?.executionCodes && profile.executionCodes.length > 0) {
            if (!resourceProfileCodes.has(tm.resourceId)) {
              resourceProfileCodes.set(tm.resourceId, new Set());
            }
            for (const code of profile.executionCodes) {
              resourceProfileCodes.get(tm.resourceId)!.add(code);
            }
          }
        }
      }
    }
    const resourceClusterIds = new Map<string, Set<string>>();
    for (const tm of allTeamMembers) {
      const team = allTeams.find(t => t.id === tm.teamId);
      if (team?.clusterId) {
        if (!resourceClusterIds.has(tm.resourceId)) resourceClusterIds.set(tm.resourceId, new Set());
        resourceClusterIds.get(tm.resourceId)!.add(team.clusterId);
      }
    }

    const allObjectIds = [...new Set(allWorkOrders.map(wo => wo.objectId).filter(Boolean) as string[])];
    const timeRestrictions = await storage.getObjectTimeRestrictionsByObjectIds(tenantId, allObjectIds);
    const restrictionsByObject = new Map<string, typeof timeRestrictions>();
    for (const r of timeRestrictions) {
      if (!restrictionsByObject.has(r.objectId)) restrictionsByObject.set(r.objectId, []);
      restrictionsByObject.get(r.objectId)!.push(r);
    }

    const unscheduledOrders = allWorkOrders.filter(wo => 
      (!wo.scheduledDate || !wo.resourceId) && 
      wo.orderStatus !== "utford" && wo.orderStatus !== "avbruten" &&
      wo.executionStatus !== "completed" && wo.executionStatus !== "invoiced"
    );

    if (unscheduledOrders.length === 0) {
      return res.json({ assignments: [], totalAssigned: 0, totalSkipped: 0 });
    }

    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const sorted = [...unscheduledOrders].sort((a, b) => {
      const pA = priorityOrder[a.priority] ?? 99;
      const pB = priorityOrder[b.priority] ?? 99;
      if (pA !== pB) return pA - pB;
      if (a.plannedWindowStart && b.plannedWindowStart) {
        return new Date(a.plannedWindowStart).getTime() - new Date(b.plannedWindowStart).getTime();
      }
      if (a.plannedWindowStart) return -1;
      if (b.plannedWindowStart) return 1;
      return 0;
    });

    const HOURS_PER_DAY = 8;
    const maxMinutesPerDay = HOURS_PER_DAY * 60 * (1 + overbookingPercent / 100);

    const existingScheduled = allWorkOrders.filter(wo => wo.scheduledDate && wo.resourceId);
    const resourceDayMinutes: Record<string, Record<string, number>> = {};
    for (const resource of selectedResources) {
      resourceDayMinutes[resource.id] = {};
      for (const day of weekDays) {
        const dayStr = day.toISOString().split("T")[0];
        const dayMinutes = existingScheduled
          .filter(wo => {
            if (wo.resourceId !== resource.id) return false;
            const woDate = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(wo.scheduledDate!);
            return woDate.toISOString().split("T")[0] === dayStr;
          })
          .reduce((sum, wo) => sum + (wo.estimatedDuration || 60), 0);
        resourceDayMinutes[resource.id][dayStr] = dayMinutes;
      }
    }

    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const assignments: Array<{
      workOrderId: string;
      resourceId: string;
      scheduledDate: string;
      scheduledStartTime: string;
      title: string;
      address: string;
      estimatedDuration: number;
      priority: string;
    }> = [];
    const skipped: string[] = [];
    let clusterSkipped = 0;

    for (const order of sorted) {
      let assigned = false;
      const orderDur = order.estimatedDuration || 60;

      for (const day of weekDays) {
        if (assigned) break;
        const dayStr = day.toISOString().split("T")[0];
        const dayOfWeek = day.getDay() || 7;

        if (order.plannedWindowStart) {
          const winDate = new Date(order.plannedWindowStart).toISOString().split("T")[0];
          if (winDate !== dayStr) continue;
        }

        if (order.objectId) {
          const objRestrictions = restrictionsByObject.get(order.objectId) || [];
          const blocked = objRestrictions.some(r => {
            if (!r.isActive) return false;
            if (!r.weekdays || r.weekdays.length === 0) return false;
            if (!r.weekdays.includes(dayOfWeek)) return false;
            if (r.isBlockingAllDay) return true;
            return true;
          });
          if (blocked) continue;
        }

        let bestResource: typeof selectedResources[0] | null = null;
        let bestScore = Infinity;

        for (const resource of selectedResources) {
          const resClusters = resourceClusterIds.get(resource.id);
          if (order.clusterId && resClusters && resClusters.size > 0) {
            if (!resClusters.has(order.clusterId)) continue;
          }

          if (order.executionCode) {
            const hasDirectCodes = resource.executionCodes && resource.executionCodes.length > 0;
            const directMatch = hasDirectCodes && resource.executionCodes.includes(order.executionCode);
            const profileCodes = resourceProfileCodes.get(resource.id);
            const hasProfileCodes = profileCodes && profileCodes.size > 0;
            const profileMatch = hasProfileCodes && profileCodes.has(order.executionCode);
            if (hasDirectCodes || hasProfileCodes) {
              if (!directMatch && !profileMatch) continue;
            }
          }

          const currentLoad = resourceDayMinutes[resource.id][dayStr] || 0;
          if (currentLoad + orderDur > maxMinutesPerDay) continue;

          let score = currentLoad;

          if (order.taskLatitude && order.taskLongitude) {
            const dayOrders = [...existingScheduled, ...assignments.map(a => ({
              ...allWorkOrders.find(wo => wo.id === a.workOrderId),
              resourceId: a.resourceId,
              scheduledDate: new Date(a.scheduledDate),
            }))].filter(wo => {
              if (!wo || wo.resourceId !== resource.id) return false;
              const woDate = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(wo.scheduledDate!);
              return woDate.toISOString().split("T")[0] === dayStr;
            });

            if (dayOrders.length > 0) {
              const lastOrder = dayOrders[dayOrders.length - 1] as any;
              if (lastOrder?.taskLatitude && lastOrder?.taskLongitude) {
                const dist = haversine(lastOrder.taskLatitude, lastOrder.taskLongitude, order.taskLatitude!, order.taskLongitude!);
                score += dist * 10;
              }
            }
          }

          if (!bestResource || score < bestScore) {
            bestResource = resource;
            bestScore = score;
          }
        }

        if (bestResource) {
          const currentLoad = resourceDayMinutes[bestResource.id][dayStr] || 0;
          const startMinutes = Math.max(8 * 60, currentLoad + 8 * 60);
          const startHour = Math.floor(startMinutes / 60);
          const startMin = startMinutes % 60;
          const startTime = `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;

          assignments.push({
            workOrderId: order.id,
            resourceId: bestResource.id,
            scheduledDate: dayStr,
            scheduledStartTime: startTime,
            title: order.title || "Utan titel",
            address: order.objectAddress || "",
            estimatedDuration: orderDur,
            priority: order.priority,
          });

          resourceDayMinutes[bestResource.id][dayStr] = (resourceDayMinutes[bestResource.id][dayStr] || 0) + orderDur;
          assigned = true;
        }
      }

      if (!assigned) {
        skipped.push(order.id);
        if (order.clusterId) {
          const anyResourceMatchesCluster = selectedResources.some(r => {
            const rc = resourceClusterIds.get(r.id);
            return !rc || rc.size === 0 || rc.has(order.clusterId!);
          });
          if (!anyResourceMatchesCluster) clusterSkipped++;
        }
      }
    }

    const capacitySummary: Record<string, number> = {};
    for (const resource of selectedResources) {
      for (const day of weekDays) {
        const dayStr = day.toISOString().split("T")[0];
        const used = resourceDayMinutes[resource.id][dayStr] || 0;
        capacitySummary[dayStr] = (capacitySummary[dayStr] || 0) + used;
      }
    }

    res.json({
      assignments,
      totalAssigned: assignments.length,
      totalSkipped: skipped.length,
      totalUnscheduled: unscheduledOrders.length,
      clusterSkipped,
      skippedIds: skipped,
      capacityPerDay: capacitySummary,
      maxMinutesPerDay: Math.round(maxMinutesPerDay),
      resourceCount: selectedResources.length,
    });
}));

app.post("/api/auto-plan-week/apply", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { assignments } = req.body;

    if (!assignments || !Array.isArray(assignments)) {
      throw new ValidationError("assignments[] required");
    }

    const results = [];
    for (const assignment of assignments) {
      const workOrder = await storage.getWorkOrder(assignment.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) continue;

      const updated = await storage.updateWorkOrder(assignment.workOrderId, {
        resourceId: assignment.resourceId,
        scheduledDate: new Date(assignment.scheduledDate),
        scheduledStartTime: assignment.scheduledStartTime,
        orderStatus: "planerad_pre",
        executionStatus: "planned_rough",
      });
      results.push(updated);
    }

    res.json({ applied: results.length });
}));

// ============================================
// TASK DEPENDENCIES - Beroendelogik
// ============================================

app.get("/api/work-orders/:workOrderId/dependencies", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const dependencies = await storage.getTaskDependencies(req.params.workOrderId);
    res.json(dependencies);
}));

app.get("/api/work-orders/:workOrderId/dependents", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const dependents = await storage.getTaskDependents(req.params.workOrderId);
    res.json(dependents);
}));

app.post("/api/work-orders/:workOrderId/dependencies", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const data = insertTaskDependencySchema.parse({
      ...req.body,
      tenantId,
      workOrderId: req.params.workOrderId
    });
    const dependency = await storage.createTaskDependency(data);
    res.status(201).json(dependency);
}));

app.delete("/api/work-orders/:workOrderId/dependencies/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    await storage.deleteTaskDependency(req.params.id, tenantId);
    res.status(204).send();
}));

app.post("/api/task-dependencies/batch", asyncHandler(async (req, res) => {
    const { workOrderIds } = req.body as { workOrderIds: string[] };
    if (!Array.isArray(workOrderIds)) {
      throw new ValidationError("workOrderIds must be an array");
    }
    const result = await storage.getTaskDependenciesBatch(workOrderIds);
    res.json(result);
}));

// ============================================
// C7: AUTO-CREATE PICKUP TASKS (Beroendeartiklar)
// ============================================

app.post("/api/work-orders/:workOrderId/generate-pickup-tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const mainWorkOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!mainWorkOrder || !verifyTenantOwnership(mainWorkOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const lines = await storage.getWorkOrderLines(req.params.workOrderId);
    const createdPickups: any[] = [];

    for (const line of lines) {
      if (!line.articleId) continue;
      const article = await storage.getArticle(line.articleId);
      if (!article || article.articleType !== "beroende") continue;

      const minutesBefore = article.dependencyMinutesBefore || 120;
      let pickupDate: Date | null = null;
      let pickupStartTime: string | null = null;

      if (mainWorkOrder.scheduledDate) {
        const mainDate = mainWorkOrder.scheduledDate instanceof Date 
          ? mainWorkOrder.scheduledDate 
          : new Date(mainWorkOrder.scheduledDate);
        const [mainH, mainM] = (mainWorkOrder.scheduledStartTime || "08:00").split(":").map(Number);
        const mainMinutes = mainH * 60 + mainM;
        const pickupMinutes = mainMinutes - minutesBefore;

        if (pickupMinutes >= 0) {
          pickupDate = mainDate;
        } else {
          pickupDate = new Date(mainDate);
          pickupDate.setDate(pickupDate.getDate() - Math.ceil(Math.abs(pickupMinutes) / (8 * 60)));
        }

        const effectivePickupMinutes = ((pickupMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
        const clampedMinutes = Math.max(7 * 60, Math.min(effectivePickupMinutes, 17 * 60));
        const pH = Math.floor(clampedMinutes / 60);
        const pM = clampedMinutes % 60;
        pickupStartTime = `${pH.toString().padStart(2, "0")}:${pM.toString().padStart(2, "0")}`;
      }

      const pickupWorkOrder = await storage.createWorkOrder({
        tenantId,
        customerId: mainWorkOrder.customerId,
        objectId: mainWorkOrder.objectId,
        resourceId: mainWorkOrder.resourceId,
        title: `Plocka: ${article.name}`,
        description: `Automatisk plockuppgift för ${article.name}. Lagerplats: ${article.stockLocation || "Ej angiven"}`,
        orderType: "service",
        priority: mainWorkOrder.priority,
        status: "draft",
        orderStatus: mainWorkOrder.resourceId ? "planerad_pre" : "skapad",
        scheduledDate: pickupDate,
        scheduledStartTime: pickupStartTime,
        estimatedDuration: article.productionTime || 30,
        executionStatus: pickupDate ? "planned_rough" : "not_planned",
        creationMethod: "automatic",
        executionCode: mainWorkOrder.executionCode || undefined,
        taskLatitude: article.stockLatitude || undefined,
        taskLongitude: article.stockLongitude || undefined,
      });

      await storage.createTaskDependency({
        tenantId,
        workOrderId: req.params.workOrderId,
        dependsOnWorkOrderId: pickupWorkOrder.id,
        dependencyType: "automatic",
        structuralArticleId: article.id,
      });

      createdPickups.push({
        pickupWorkOrderId: pickupWorkOrder.id,
        articleName: article.name,
        articleId: article.id,
        scheduledDate: pickupDate?.toISOString().split("T")[0],
        scheduledStartTime: pickupStartTime,
        stockLocation: article.stockLocation,
      });
    }

    res.json({
      created: createdPickups.length,
      pickupTasks: createdPickups,
      mainWorkOrderId: req.params.workOrderId,
    });
}));

// C7: Get full dependency chain for a work order
app.get("/api/work-orders/:workOrderId/dependency-chain", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const dependencies = await storage.getTaskDependencies(req.params.workOrderId);
    const dependents = await storage.getTaskDependents(req.params.workOrderId);

    const chain: any[] = [];

    for (const dep of dependencies) {
      const depOrder = await storage.getWorkOrder(dep.dependsOnWorkOrderId);
      if (depOrder) {
        chain.push({
          type: "depends_on",
          dependencyType: dep.dependencyType,
          workOrder: {
            id: depOrder.id,
            title: depOrder.title,
            status: depOrder.status,
            executionStatus: depOrder.executionStatus,
            scheduledDate: depOrder.scheduledDate,
            scheduledStartTime: depOrder.scheduledStartTime,
            creationMethod: depOrder.creationMethod,
          },
        });
      }
    }

    for (const dep of dependents) {
      const depOrder = await storage.getWorkOrder(dep.workOrderId);
      if (depOrder) {
        chain.push({
          type: "blocks",
          dependencyType: dep.dependencyType,
          workOrder: {
            id: depOrder.id,
            title: depOrder.title,
            status: depOrder.status,
            executionStatus: depOrder.executionStatus,
            scheduledDate: depOrder.scheduledDate,
            scheduledStartTime: depOrder.scheduledStartTime,
            creationMethod: depOrder.creationMethod,
          },
        });
      }
    }

    res.json({
      workOrderId: req.params.workOrderId,
      chain,
    });
}));

// ============================================
// TASK INFORMATION - Bilagor och info
// ============================================

app.get("/api/work-orders/:workOrderId/information", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const information = await storage.getTaskInformation(req.params.workOrderId);
    res.json(information);
}));

app.post("/api/work-orders/:workOrderId/information", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const data = insertTaskInformationSchema.parse({
      ...req.body,
      tenantId,
      workOrderId: req.params.workOrderId
    });
    const info = await storage.createTaskInformation(data);
    res.status(201).json(info);
}));

app.patch("/api/work-orders/:workOrderId/information/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const updateSchema = z.object({
      infoValue: z.string().nullable().optional(),
      hasLogic: z.boolean().optional(),
      linkedArticleId: z.string().nullable().optional(),
      quantity: z.number().nullable().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const info = await storage.updateTaskInformation(req.params.id, req.params.workOrderId, tenantId, updateData);
    if (!info) throw new NotFoundError("Information hittades inte");
    res.json(info);
}));

app.delete("/api/work-orders/:workOrderId/information/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    await storage.deleteTaskInformation(req.params.id, req.params.workOrderId, tenantId);
    res.status(204).send();
}));

// ============================================
// OBJECT TIME RESTRICTIONS (C9) - Tidsbegränsningar
// ============================================

app.get("/api/objects/:objectId/time-restrictions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const restrictions = await storage.getObjectTimeRestrictions(req.params.objectId);
    res.json(restrictions);
}));

app.get("/api/time-restrictions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectIds = req.query.objectIds ? (req.query.objectIds as string).split(",") : [];
    let restrictions;
    if (objectIds.length > 0) {
      restrictions = await storage.getObjectTimeRestrictionsByObjectIds(tenantId, objectIds);
    } else {
      restrictions = await storage.getObjectTimeRestrictionsByTenant(tenantId);
    }
    res.json(restrictions);
}));

app.post("/api/objects/:objectId/time-restrictions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const restrictionSchema = z.object({
      restrictionType: z.string(),
      description: z.string().nullable().optional(),
      weekdays: z.array(z.number()).optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      isBlockingAllDay: z.boolean().optional(),
      preference: z.enum(["favorable", "unfavorable"]).optional(),
      reason: z.string().nullable().optional(),
    });
    const parsed = restrictionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    const { restrictionType, description, weekdays, startTime, endTime, isBlockingAllDay, preference, reason } = parsed.data;

    const obj = await storage.getObject(req.params.objectId);
    if (!obj || obj.tenantId !== tenantId) throw new NotFoundError("Objekt hittades inte");

    const restriction = await storage.createObjectTimeRestriction({
      tenantId,
      objectId: req.params.objectId,
      restrictionType,
      description: description || null,
      weekdays: weekdays || [],
      startTime: startTime || null,
      endTime: endTime || null,
      isBlockingAllDay: isBlockingAllDay ?? true,
      preference: preference || "unfavorable",
      reason: reason || null,
      isActive: true,
    });
    res.json(restriction);
}));

app.patch("/api/time-restrictions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const updateSchema = z.object({
      restrictionType: z.string().optional(),
      description: z.string().nullable().optional(),
      weekdays: z.array(z.number()).optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      isBlockingAllDay: z.boolean().optional(),
      preference: z.enum(["favorable", "unfavorable"]).optional(),
      reason: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    const restriction = await storage.updateObjectTimeRestriction(req.params.id, tenantId, parsed.data);
    if (!restriction) throw new NotFoundError("Hittades inte");
    res.json(restriction);
}));

app.get("/api/slot-preferences/aggregate", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectIds = req.query.objectIds ? (req.query.objectIds as string).split(",") : [];
    if (objectIds.length === 0) return res.json([]);
    const restrictions = await storage.getObjectTimeRestrictionsByObjectIds(tenantId, objectIds);
    const objectNames = new Map<string, string>();
    for (const oid of objectIds) {
      const obj = await storage.getObject(oid);
      if (obj && obj.tenantId === tenantId) objectNames.set(oid, obj.name);
    }
    const aggregated = restrictions.map(r => ({
      ...r,
      objectName: objectNames.get(r.objectId) || r.objectId,
    }));
    res.json(aggregated);
}));

app.delete("/api/time-restrictions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteObjectTimeRestriction(req.params.id, tenantId);
    res.json({ success: true });
}));

// C10 - Expand structural article into sub-step work orders
app.post("/api/work-orders/:id/expand-structural", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder) throw new NotFoundError("Arbetsorder hittades inte");

    const articleId = workOrder.articleId;
    if (!articleId) throw new ValidationError("Arbetsordern saknar artikel");

    const subArticles = await storage.getStructuralArticlesByParent(articleId);
    if (subArticles.length === 0) return res.json({ created: [], message: "No structural sub-articles found" });

    const created: any[] = [];
    for (const sub of subArticles) {
      const childArticle = await storage.getArticle(sub.childArticleId);
      const subWorkOrder = await storage.createWorkOrder({
        tenantId,
        title: sub.stepName || childArticle?.name || "Delsteg",
        description: `Delsteg ${sub.sequenceOrder}: ${sub.stepName || childArticle?.name || ""}`,
        status: "pending",
        executionStatus: "not_planned",
        articleId: sub.childArticleId,
        objectId: workOrder.objectId,
        customerId: workOrder.customerId,
        resourceId: workOrder.resourceId,
        scheduledDate: workOrder.scheduledDate,
        scheduledStartTime: workOrder.scheduledStartTime,
        estimatedDuration: sub.defaultDurationMinutes || childArticle?.productionTime || 30,
        structuralArticleId: articleId,
        creationMethod: "structural",
        executionCode: workOrder.executionCode,
      });

      await storage.createTaskDependency({
        tenantId,
        workOrderId: subWorkOrder.id,
        dependsOnWorkOrderId: workOrder.id,
        dependencyType: "structural",
        structuralArticleId: sub.childArticleId,
      });

      created.push({
        workOrder: subWorkOrder,
        stepName: sub.stepName,
        sequenceOrder: sub.sequenceOrder,
        isOptional: sub.isOptional,
      });
    }

    res.json({ created, parentId: workOrder.id });
}));

// C10 - Get sub-steps for a work order (structural children)
app.get("/api/work-orders/:id/sub-steps", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder) throw new NotFoundError("Arbetsorder hittades inte");

    const allDeps = await storage.getTaskDependencies(req.params.id);
    const structuralDeps = allDeps.filter(d => d.dependsOnWorkOrderId === req.params.id && d.dependencyType === "structural");

    const subSteps: any[] = [];
    for (const dep of structuralDeps) {
      const subWo = await storage.getWorkOrder(dep.workOrderId);
      if (subWo) {
        subSteps.push({
          id: subWo.id,
          title: subWo.title,
          status: subWo.orderStatus,
          executionStatus: subWo.executionStatus,
          estimatedDuration: subWo.estimatedDuration,
          structuralArticleId: dep.structuralArticleId,
        });
      }
    }

    const articleId = workOrder.articleId;
    let structuralInfo = null;
    if (articleId) {
      const subArticles = await storage.getStructuralArticlesByParent(articleId);
      if (subArticles.length > 0) {
        structuralInfo = {
          totalSteps: subArticles.length,
          steps: subArticles.map(s => ({
            childArticleId: s.childArticleId,
            stepName: s.stepName,
            sequenceOrder: s.sequenceOrder,
            isOptional: s.isOptional,
            defaultDurationMinutes: s.defaultDurationMinutes,
          })),
        };
      }
    }

    const completedCount = subSteps.filter(s => s.executionStatus === "completed" || s.executionStatus === "inspected" || s.executionStatus === "invoiced").length;

    res.json({
      subSteps,
      structuralInfo,
      progress: {
        completed: completedCount,
        total: subSteps.length || structuralInfo?.totalSteps || 0,
      },
    });
}));

// ============================================
// STRUCTURAL ARTICLES - Artiklar med beroendeuppgifter
// ============================================

app.get("/api/structural-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const articles = await storage.getStructuralArticles(tenantId);
    res.json(articles);
}));

app.get("/api/articles/:articleId/structural-children", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.articleId);
    if (!verifyTenantOwnership(article, tenantId)) {
      throw new NotFoundError("Artikel hittades inte");
    }
    const children = await storage.getStructuralArticlesByParent(req.params.articleId);
    res.json(children);
}));

app.post("/api/structural-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertStructuralArticleSchema.parse({
      ...req.body,
      tenantId
    });
    const article = await storage.createStructuralArticle(data);
    res.status(201).json(article);
}));

app.patch("/api/structural-articles/:id", asyncHandler(async (req, res) => {
    const updateSchema = z.object({
      sequenceOrder: z.number().optional(),
      stepName: z.string().nullable().optional(),
      taskType: z.string().nullable().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.updateStructuralArticle(req.params.id, tenantId, updateData);
    if (!article) throw new NotFoundError("Strukturartikel hittades inte");
    res.json(article);
}));

app.delete("/api/structural-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteStructuralArticle(req.params.id, tenantId);
    res.status(204).send();
}));

// Preview dynamic structural article steps
app.post("/api/structural-articles/:parentArticleId/preview-tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { parentArticleId } = req.params;
    const { executionDate, objectMetadata, individualObjects } = req.body;
    
    // Get all structural articles for this parent
    const allStructuralArticles = await storage.getStructuralArticles(tenantId);
    const steps = allStructuralArticles.filter(sa => sa.parentArticleId === parentArticleId);
    
    if (steps.length === 0) {
      return res.json({ 
        tasks: [], 
        totalDuration: 0, 
        message: "Inga strukturartiklar hittades för denna artikel" 
      });
    }
    
    const { generateTasksFromStructuralArticle, calculateTotalDuration } = await import('../structural-article-utils');
    
    const date = executionDate ? new Date(executionDate) : new Date();
    const metadata = objectMetadata || {};
    const objects = individualObjects || [];
    
    const tasks = generateTasksFromStructuralArticle(steps, date, metadata, objects);
    const totalDuration = calculateTotalDuration(tasks);
    
    // Get article names for display
    const allArticles = await storage.getArticles(tenantId);
    const articlesMap = new Map(allArticles.map(a => [a.id, a]));
    
    const tasksWithNames = tasks.map(task => ({
      ...task,
      articleName: articlesMap.get(task.articleId)?.name || 'Okänd artikel',
    }));
    
    res.json({
      tasks: tasksWithNames,
      totalDuration,
      applicableCount: tasks.filter(t => t.isApplicable).length,
      skippedCount: tasks.filter(t => !t.isApplicable).length,
    });
}));

app.post("/api/work-orders/:workOrderId/expand-structural", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    // Use structuralArticleId from work order
    const structuralArticleId = workOrder.structuralArticleId;
    if (!structuralArticleId) {
      return res.json({ expanded: [], message: "Ingen strukturartikel att expandera" });
    }
    
    const allStructuralArticles = await storage.getStructuralArticles(tenantId);
    const structuralArticlesMap = new Map<string, typeof allStructuralArticles>();
    
    for (const sa of allStructuralArticles) {
      const existing = structuralArticlesMap.get(sa.parentArticleId) || [];
      existing.push(sa);
      structuralArticlesMap.set(sa.parentArticleId, existing);
    }

    if (!structuralArticlesMap.has(structuralArticleId)) {
      return res.json({ expanded: [], message: "Inga strukturartiklar hittades" });
    }

    const allArticles = await storage.getArticles(tenantId);
    const articlesMap = new Map(allArticles.map(a => [a.id, a]));

    const { expandStructuralArticle } = await import("../ai-planner");

    const children = structuralArticlesMap.get(structuralArticleId) || [];
    
    const result = await expandStructuralArticle(
      workOrder,
      structuralArticleId,
      children,
      articlesMap,
      async (data: Record<string, unknown>) => storage.createWorkOrder({ ...data, tenantId: workOrder.tenantId } as typeof insertWorkOrderSchema._type),
      async (data: Record<string, unknown>) => storage.createTaskDependency(data as typeof insertTaskDependencySchema._type)
    );

    res.json({
      expanded: [result],
      message: `${result.createdWorkOrders.length} deluppgifter skapades`
    });
}));

// Route Optimization API
app.post("/api/route/optimize", asyncHandler(async (req, res) => {
    const { stops } = req.body;
    
    if (!stops || !Array.isArray(stops)) {
      throw new ValidationError("Stops array krävs");
    }

    const tenantId = getTenantIdWithFallback(req);
    const { enforceBudgetAndRateLimit } = await import("../ai-budget-service");
    const rtEnforcement = await enforceBudgetAndRateLimit(tenantId, "planning");
    if (!rtEnforcement.allowed) {
      if (rtEnforcement.errorType === "ratelimit") {
        res.set("Retry-After", String(rtEnforcement.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: rtEnforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden", message: rtEnforcement.errorMessage });
    }
    
    const { optimizeRoute, runWithAIContext } = await import("../ai-planner");
    
    const result = await runWithAIContext({ tenantId, model: rtEnforcement.model }, () =>
      optimizeRoute(stops)
    );
    
    res.json(result);
}));

// Generate Google Maps URL for route
app.post("/api/route/google-maps-url", asyncHandler(async (req, res) => {
    const { stops } = req.body;
    
    if (!stops || !Array.isArray(stops)) {
      throw new ValidationError("Stops array krävs");
    }
    
    const { generateGoogleMapsUrl } = await import("../ai-planner");
    
    const url = generateGoogleMapsUrl(stops);
    
    res.json({ url });
}));

// Send route to mobile app via WebSocket
app.post("/api/route/send-to-mobile", asyncHandler(async (req, res) => {
    const { resourceId, stops, date, googleMapsUrl } = req.body;
    
    if (!resourceId || !stops) {
      throw new ValidationError("ResourceId och stops krävs");
    }
    
    // Send notification to the specific resource's mobile app
    notificationService.sendToResource(resourceId, {
      type: "route_update",
      title: "Ny rutt tilldelad",
      message: `Du har fått en rutt med ${stops.length} stopp för ${date}`,
      data: {
        stops,
        googleMapsUrl,
        date
      }
    });
    
    res.json({ 
      success: true, 
      message: `Rutt skickad till resurs ${resourceId}` 
    });
}));

// ============================================
// ORDER CONCEPTS API
// ============================================

app.get("/api/order-concepts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concepts = await storage.getOrderConcepts(tenantId);
    res.json(concepts);
}));

app.get("/api/order-concepts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.id);
    const verifiedConcept = verifyTenantOwnership(concept, tenantId);
    if (!verifiedConcept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    const filters = await storage.getConceptFilters(verifiedConcept.id);
    res.json({ ...verifiedConcept, filters });
}));

app.post("/api/order-concepts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    
    if (req.body.customerMode && !["HARDCODED", "FROM_METADATA"].includes(req.body.customerMode)) {
      throw new ValidationError("customerMode måste vara HARDCODED eller FROM_METADATA");
    }
    
    const concept = await storage.createOrderConcept({
      ...req.body,
      tenantId,
      createdBy: userId
    });
    res.status(201).json(concept);
}));

app.patch("/api/order-concepts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    if (req.body.customerMode && !["HARDCODED", "FROM_METADATA"].includes(req.body.customerMode)) {
      throw new ValidationError("customerMode måste vara HARDCODED eller FROM_METADATA");
    }
    
    const concept = await storage.updateOrderConcept(req.params.id, tenantId, req.body);
    res.json(concept);
}));

app.delete("/api/order-concepts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    await storage.deleteOrderConcept(req.params.id, tenantId);
    res.status(204).send();
}));

app.post("/api/order-concepts/check-customer-metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectIds } = req.body;
    if (!Array.isArray(objectIds) || objectIds.length === 0) {
      throw new ValidationError("objectIds krävs");
    }
    const objectsList = await storage.getObjectsByIds(tenantId, objectIds);
    const customers = await storage.getCustomers(tenantId);
    const validCustomerIds = new Set(customers.map(c => c.id));

    const missingCustomer: Array<{ id: string; name: string; objectNumber: string | null; customerId: string | null }> = [];
    const withCustomer: Array<{ id: string; name: string; customerId: string; customerName: string | null }> = [];
    for (const obj of objectsList) {
      if (!obj.customerId || !validCustomerIds.has(obj.customerId)) {
        missingCustomer.push({ id: obj.id, name: obj.name, objectNumber: obj.objectNumber, customerId: obj.customerId });
      } else {
        const cust = customers.find(c => c.id === obj.customerId);
        withCustomer.push({ id: obj.id, name: obj.name, customerId: obj.customerId, customerName: cust?.name || null });
      }
    }
    res.json({ missingCustomer, withCustomer, total: objectsList.length });
}));

// Concept Filters
app.get("/api/order-concepts/:conceptId/filters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.conceptId);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    const filters = await storage.getConceptFilters(req.params.conceptId);
    res.json(filters);
}));

app.post("/api/order-concepts/:conceptId/filters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.conceptId);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    const filter = await storage.createConceptFilter({
      ...req.body,
      orderConceptId: req.params.conceptId
    });
    res.status(201).json(filter);
}));

app.delete("/api/order-concepts/:conceptId/filters/:filterId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.conceptId);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    await storage.deleteConceptFilter(req.params.filterId, req.params.conceptId);
    res.status(204).send();
}));

// Execute order concept - generates assignments from filters
app.post("/api/order-concepts/:id/execute", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const filters = await storage.getConceptFilters(concept.id);
    
    // Get all objects in the cluster hierarchy
    let targetObjects: ServiceObject[] = [];
    if (concept.targetClusterId) {
      const clusterObjects = await storage.getClusterObjects(concept.targetClusterId);
      targetObjects = clusterObjects;
    } else {
      targetObjects = await storage.getObjects(tenantId);
    }

    // Apply filters to find matching objects
    const matchingObjects = targetObjects.filter(obj => {
      return filters.every(filter => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
        const filterValue = filter.filterValue;
        
        switch (filter.operator) {
          case "equals":
            return metadataValue === filterValue;
          case "not_equals":
            return metadataValue !== filterValue;
          case "contains":
            return String(metadataValue || "").includes(String(filterValue));
          case "starts_with":
            return String(metadataValue || "").startsWith(String(filterValue));
          case "greater_than":
            return Number(metadataValue) > Number(filterValue);
          case "less_than":
            return Number(metadataValue) < Number(filterValue);
          case "in_list":
            return Array.isArray(filterValue) && filterValue.includes(metadataValue);
          case "exists":
            return metadataValue !== undefined && metadataValue !== null;
          case "not_exists":
            return metadataValue === undefined || metadataValue === null;
          default:
            return true;
        }
      });
    });

    // Generate assignments for each matching object
    const createdAssignments = [];
    const scheduledDate = req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined;
    
    // Fetch article once before loop if concept has articleId
    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
    if (concept.articleId) {
      linkedArticle = await storage.getArticle(concept.articleId);
    }

    for (const obj of matchingObjects) {
      // Cross-pollination: multiply by metadata field if specified
      const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
      let quantity = 1;
      if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
        quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
      }

      // Calculate estimated duration from linked article
      let estimatedDuration = 60; // default 60 minutes
      let totalValue = 0;
      let totalCost = 0;
      
      if (linkedArticle) {
        estimatedDuration = (linkedArticle.productionTime || 0) * quantity;
        totalValue = (linkedArticle.listPrice || 0) * quantity;
        totalCost = (linkedArticle.cost || 0) * quantity;
      }

      const assignment = await storage.createAssignment({
        tenantId,
        orderConceptId: concept.id,
        objectId: obj.id,
        clusterId: obj.clusterId || undefined,
        title: concept.name,
        description: concept.description || undefined,
        status: "not_planned",
        priority: concept.priority || "normal",
        scheduledDate,
        quantity,
        address: obj.address || undefined,
        latitude: obj.latitude || undefined,
        longitude: obj.longitude || undefined,
        creationMethod: "automatic",
        createdBy: userId,
        estimatedDuration,
        cachedValue: totalValue,
        cachedCost: totalCost
      });

      // If an article is linked, create assignment article
      if (linkedArticle && concept.articleId) {
        await storage.createAssignmentArticle({
          assignmentId: assignment.id,
          articleId: concept.articleId,
          quantity,
          unitPrice: linkedArticle.listPrice || 0,
          totalPrice: (linkedArticle.listPrice || 0) * quantity,
          unitCost: linkedArticle.cost || 0,
          totalCost: (linkedArticle.cost || 0) * quantity,
          unitTime: linkedArticle.productionTime || 0,
          totalTime: (linkedArticle.productionTime || 0) * quantity,
          sequenceOrder: 1,
          status: "pending"
        });
      }

      createdAssignments.push(assignment);
    }

    // Update last run date
    await storage.updateOrderConcept(concept.id, tenantId, {
      lastRunDate: new Date()
    });

    res.json({
      success: true,
      message: `Skapade ${createdAssignments.length} uppgifter från ${matchingObjects.length} matchande objekt`,
      assignmentsCreated: createdAssignments.length,
      objectsMatched: matchingObjects.length,
      assignments: createdAssignments
    });
}));

// Preview order concept execution (dry run)
app.post("/api/order-concepts/:id/preview", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const filters = await storage.getConceptFilters(concept.id);
    
    let targetObjects: ServiceObject[] = [];
    if (concept.targetClusterId) {
      targetObjects = await storage.getClusterObjects(concept.targetClusterId);
    } else {
      targetObjects = await storage.getObjects(tenantId);
    }

    const matchingObjects = targetObjects.filter(obj => {
      return filters.every(filter => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
        const filterValue = filter.filterValue;
        switch (filter.operator) {
          case "equals": return metadataValue === filterValue;
          case "not_equals": return metadataValue !== filterValue;
          case "contains": return String(metadataValue || "").includes(String(filterValue));
          case "greater_than": return Number(metadataValue) > Number(filterValue);
          case "less_than": return Number(metadataValue) < Number(filterValue);
          case "exists": return metadataValue !== undefined && metadataValue !== null;
          case "not_exists": return metadataValue === undefined || metadataValue === null;
          default: return true;
        }
      });
    });

    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
    if (concept.articleId) {
      linkedArticle = await storage.getArticle(concept.articleId);
    }

    const previewItems = matchingObjects.map(obj => {
      const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
      let quantity = 1;
      if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
        quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
      }
      const unitPrice = linkedArticle?.listPrice || 0;
      return {
        objectId: obj.id,
        objectName: obj.name,
        address: obj.address,
        quantity,
        articleName: linkedArticle?.name || "-",
        estimatedDuration: (linkedArticle?.productionTime || 0) * quantity,
        estimatedValue: unitPrice * quantity,
      };
    });

    // Generate rolling schedule preview if scenario is "schema"
    let schedulePreview: Array<{ date: string; objectCount: number }> = [];
    if (concept.scenario === "schema" && concept.deliverySchedule) {
      const schedule = concept.deliverySchedule as Array<{ month: number; weekNumber: number; weekday: number; timeWindowStart?: string; timeWindowEnd?: string }>;
      const months = concept.rollingMonths || 3;
      const now = new Date();
      for (let m = 0; m < months; m++) {
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + m, 1);
        for (const entry of schedule) {
          if (entry.month && entry.month !== targetMonth.getMonth() + 1) continue;
          const date = getDateFromWeekdayInMonth(targetMonth.getFullYear(), targetMonth.getMonth(), entry.weekNumber, entry.weekday);
          if (date && date >= now) {
            schedulePreview.push({
              date: date.toISOString().split('T')[0],
              objectCount: matchingObjects.length,
            });
          }
        }
      }
      schedulePreview.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Subscription calculation for "abonnemang" scenario
    let subscriptionCalc: { totalUnits: number; monthlyTotal: number; yearlyTotal: number } | undefined;
    if (concept.scenario === "abonnemang" && concept.monthlyFee) {
      let totalUnits = 0;
      for (const obj of matchingObjects) {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        if (concept.subscriptionMetadataField && objWithMeta.metadata?.[concept.subscriptionMetadataField]) {
          totalUnits += Number(objWithMeta.metadata[concept.subscriptionMetadataField]) || 1;
        } else {
          totalUnits += 1;
        }
      }
      subscriptionCalc = {
        totalUnits,
        monthlyTotal: totalUnits * concept.monthlyFee,
        yearlyTotal: totalUnits * concept.monthlyFee * 12,
      };
    }

    res.json({
      objectsMatched: matchingObjects.length,
      totalFilters: filters.length,
      items: previewItems,
      schedulePreview,
      subscriptionCalc,
    });
}));

// Rolling schedule execution - generate assignments for upcoming windows
app.post("/api/order-concepts/:id/run-rolling", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    if (concept.scenario !== "schema" || !concept.deliverySchedule) {
      throw new ValidationError("Konceptet har inget leveransschema");
    }

    const filters = await storage.getConceptFilters(concept.id);
    let targetObjects: ServiceObject[] = [];
    if (concept.targetClusterId) {
      targetObjects = await storage.getClusterObjects(concept.targetClusterId);
    } else {
      targetObjects = await storage.getObjects(tenantId);
    }

    const matchingObjects = targetObjects.filter(obj => {
      return filters.every(filter => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
        const filterValue = filter.filterValue;
        switch (filter.operator) {
          case "equals": return metadataValue === filterValue;
          case "not_equals": return metadataValue !== filterValue;
          case "contains": return String(metadataValue || "").includes(String(filterValue));
          case "greater_than": return Number(metadataValue) > Number(filterValue);
          case "less_than": return Number(metadataValue) < Number(filterValue);
          case "exists": return metadataValue !== undefined && metadataValue !== null;
          case "not_exists": return metadataValue === undefined || metadataValue === null;
          default: return true;
        }
      });
    });

    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
    if (concept.articleId) {
      linkedArticle = await storage.getArticle(concept.articleId);
    }

    const schedule = concept.deliverySchedule as Array<{ month: number; weekNumber: number; weekday: number; timeWindowStart?: string; timeWindowEnd?: string }>;
    const months = concept.rollingMonths || 3;
    const now = new Date();
    const createdAssignments = [];

    for (let m = 0; m < months; m++) {
      const targetMonth = new Date(now.getFullYear(), now.getMonth() + m, 1);
      for (const entry of schedule) {
        if (entry.month && entry.month !== targetMonth.getMonth() + 1) continue;
        const date = getDateFromWeekdayInMonth(targetMonth.getFullYear(), targetMonth.getMonth(), entry.weekNumber, entry.weekday);
        if (!date || date < now) continue;

        for (const obj of matchingObjects) {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          let quantity = 1;
          if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
            quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
          }

          const estimatedDuration = (linkedArticle?.productionTime || 0) * quantity || 60;
          const totalValue = (linkedArticle?.listPrice || 0) * quantity;
          const totalCost = (linkedArticle?.cost || 0) * quantity;

          const assignment = await storage.createAssignment({
            tenantId,
            orderConceptId: concept.id,
            objectId: obj.id,
            clusterId: obj.clusterId || undefined,
            title: concept.name,
            description: concept.description || undefined,
            status: "not_planned",
            priority: concept.priority || "normal",
            scheduledDate: date,
            plannedWindowStart: entry.timeWindowStart ? new Date(`${date.toISOString().split('T')[0]}T${entry.timeWindowStart}:00`) : undefined,
            plannedWindowEnd: entry.timeWindowEnd ? new Date(`${date.toISOString().split('T')[0]}T${entry.timeWindowEnd}:00`) : undefined,
            quantity,
            address: obj.address || undefined,
            latitude: obj.latitude || undefined,
            longitude: obj.longitude || undefined,
            creationMethod: "automatic",
            createdBy: userId,
            estimatedDuration,
            cachedValue: totalValue,
            cachedCost: totalCost,
          });

          if (linkedArticle && concept.articleId) {
            await storage.createAssignmentArticle({
              assignmentId: assignment.id,
              articleId: concept.articleId,
              quantity,
              unitPrice: linkedArticle.listPrice || 0,
              totalPrice: totalValue,
              unitCost: linkedArticle.cost || 0,
              totalCost,
              unitTime: linkedArticle.productionTime || 0,
              totalTime: estimatedDuration,
              sequenceOrder: 1,
              status: "pending"
            });
          }

          createdAssignments.push(assignment);
        }
      }
    }

    await storage.updateOrderConcept(concept.id, tenantId, {
      lastRunDate: new Date(),
      nextRunDate: new Date(now.getFullYear(), now.getMonth() + months, 1),
    });

    res.json({
      success: true,
      message: `Genererade ${createdAssignments.length} uppgifter för ${months} månader framåt`,
      assignmentsCreated: createdAssignments.length,
      objectsMatched: matchingObjects.length,
    });
}));

// Subscription calculation
app.get("/api/order-concepts/:id/subscription-calc", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const filters = await storage.getConceptFilters(concept.id);
    let targetObjects: ServiceObject[] = [];
    if (concept.targetClusterId) {
      targetObjects = await storage.getClusterObjects(concept.targetClusterId);
    } else {
      targetObjects = await storage.getObjects(tenantId);
    }

    const matchingObjects = targetObjects.filter(obj => {
      return filters.every(filter => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
        const filterValue = filter.filterValue;
        switch (filter.operator) {
          case "equals": return metadataValue === filterValue;
          case "not_equals": return metadataValue !== filterValue;
          case "exists": return metadataValue !== undefined && metadataValue !== null;
          default: return true;
        }
      });
    });

    const perObject = matchingObjects.map(obj => {
      const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
      let units = 1;
      if (concept.subscriptionMetadataField && objWithMeta.metadata?.[concept.subscriptionMetadataField]) {
        units = Number(objWithMeta.metadata[concept.subscriptionMetadataField]) || 1;
      }
      return {
        objectId: obj.id,
        objectName: obj.name,
        units,
        monthlyFee: (concept.monthlyFee || 0) * units,
      };
    });

    const totalUnits = perObject.reduce((sum, p) => sum + p.units, 0);
    const monthlyTotal = perObject.reduce((sum, p) => sum + p.monthlyFee, 0);

    res.json({
      perObject,
      totalUnits,
      monthlyTotal,
      quarterlyTotal: monthlyTotal * 3,
      yearlyTotal: monthlyTotal * 12,
      billingFrequency: concept.billingFrequency || "monthly",
      contractLockMonths: concept.contractLockMonths,
    });
}));

// Subscription changes
app.get("/api/subscription-changes", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { conceptId, status } = req.query;
    const changes = await storage.getSubscriptionChanges(
      tenantId,
      conceptId as string | undefined,
      status as string | undefined
    );
    res.json(changes);
}));

app.patch("/api/subscription-changes/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const { approvalStatus } = req.body;
    if (!approvalStatus || !["approved", "rejected"].includes(approvalStatus)) {
      throw new ValidationError("Ogiltig status");
    }
    const change = await storage.updateSubscriptionChangeStatus(
      req.params.id, tenantId, approvalStatus, userId
    );
    if (!change) {
      throw new NotFoundError("Ändring hittades inte");
    }
    res.json(change);
}));

// Detect subscription changes
app.post("/api/order-concepts/:id/detect-changes", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept || concept.scenario !== "abonnemang") {
      throw new ValidationError("Konceptet är inte ett abonnemang");
    }

    const filters = await storage.getConceptFilters(concept.id);
    let targetObjects: ServiceObject[] = [];
    if (concept.targetClusterId) {
      targetObjects = await storage.getClusterObjects(concept.targetClusterId);
    } else {
      targetObjects = await storage.getObjects(tenantId);
    }

    const matchingObjects = targetObjects.filter(obj => {
      return filters.every(filter => {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        const metadataValue = objWithMeta.metadata?.[filter.metadataKey];
        const filterValue = filter.filterValue;
        switch (filter.operator) {
          case "equals": return metadataValue === filterValue;
          case "not_equals": return metadataValue !== filterValue;
          case "exists": return metadataValue !== undefined && metadataValue !== null;
          default: return true;
        }
      });
    });

    const existingAssignments = await storage.getAssignments(tenantId, {});
    const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
    const assignedObjectIds = new Set(conceptAssignments.map(a => a.objectId));

    const createdChanges = [];

    for (const obj of matchingObjects) {
      if (!assignedObjectIds.has(obj.id)) {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        let units = 1;
        if (concept.subscriptionMetadataField && objWithMeta.metadata?.[concept.subscriptionMetadataField]) {
          units = Number(objWithMeta.metadata[concept.subscriptionMetadataField]) || 1;
        }
        const monthlyDelta = (concept.monthlyFee || 0) * units;
        const change = await storage.createSubscriptionChange({
          tenantId,
          orderConceptId: concept.id,
          objectId: obj.id,
          changeType: "new_object",
          previousValue: "0",
          newValue: String(units),
          monthlyDelta,
          approvalStatus: "pending",
        });
        createdChanges.push(change);
      }
    }

    for (const objectId of assignedObjectIds) {
      if (!matchingObjects.find(o => o.id === objectId)) {
        const assignment = conceptAssignments.find(a => a.objectId === objectId);
        const monthlyDelta = -(concept.monthlyFee || 0) * (assignment?.quantity || 1);
        const change = await storage.createSubscriptionChange({
          tenantId,
          orderConceptId: concept.id,
          objectId,
          changeType: "removed_object",
          previousValue: String(assignment?.quantity || 1),
          newValue: "0",
          monthlyDelta,
          approvalStatus: "pending",
        });
        createdChanges.push(change);
      }
    }

    res.json({
      changesDetected: createdChanges.length,
      changes: createdChanges,
    });
}));

// Fetch all customers from Fortnox for import preview
app.get("/api/fortnox/customers/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);

    const isConnected = await client.isConnected();
    if (!isConnected) {
      throw new ValidationError("Fortnox är inte anslutet. Anslut först under Fortnox-inställningar.");
    }

    const fortnoxCustomers = await client.getCustomers();

    const existingCustomers = await storage.getCustomers(tenantId);
    const existingMappings = await storage.getFortnoxMappings(tenantId, "customer");

    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enrichedCustomers = fortnoxCustomers.map((fc: any) => {
      const customerNumber = fc.CustomerNumber || "";
      const alreadyImported = mappedFortnoxIds.has(customerNumber);
      const nameMatch = existingCustomers.find(
        ec => ec.name?.toLowerCase().trim() === (fc.Name || "").toLowerCase().trim()
      );

      return {
        customerNumber,
        name: fc.Name || "",
        organisationNumber: fc.OrganisationNumber || "",
        address1: fc.Address1 || "",
        address2: fc.Address2 || "",
        zipCode: fc.ZipCode || "",
        city: fc.City || "",
        phone: fc.Phone1 || fc.Phone2 || "",
        email: fc.Email || "",
        contactPerson: fc.YourReference || "",
        active: fc.Active !== false,
        alreadyImported,
        existingMatch: nameMatch ? { id: nameMatch.id, name: nameMatch.name } : null,
      };
    });

    res.json({
      total: enrichedCustomers.length,
      customers: enrichedCustomers,
    });
}));

// Import selected customers from Fortnox
app.post("/api/fortnox/customers/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);

    const isConnected = await client.isConnected();
    if (!isConnected) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      customers: z.array(z.object({
        customerNumber: z.string(),
        name: z.string(),
        organisationNumber: z.string().optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        zipCode: z.string().optional(),
        city: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        contactPerson: z.string().optional(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error));
    }

    const results: Array<{ customerNumber: string; name: string; status: "created" | "skipped" | "error"; error?: string; customerId?: string }> = [];
    const existingMappings = await storage.getFortnoxMappings(tenantId, "customer");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    for (const fc of parsed.data.customers) {
      try {
        if (mappedFortnoxIds.has(fc.customerNumber)) {
          results.push({ customerNumber: fc.customerNumber, name: fc.name, status: "skipped" });
          continue;
        }

        const addressParts = [fc.address1, fc.address2].filter(Boolean);
        const newCustomer = await storage.createCustomer({
          tenantId,
          name: fc.name,
          customerNumber: fc.customerNumber,
          contactPerson: fc.contactPerson || null,
          email: fc.email || null,
          phone: fc.phone || null,
          address: addressParts.join(", ") || null,
          city: fc.city || null,
          postalCode: fc.zipCode || null,
          notes: fc.organisationNumber ? `Org.nr: ${fc.organisationNumber}` : null,
          importBatchId: `fortnox-${new Date().toISOString().slice(0, 10)}`,
        });

        await storage.createFortnoxMapping({
          tenantId,
          entityType: "customer",
          unicornId: newCustomer.id,
          fortnoxId: fc.customerNumber,
        });

        results.push({ customerNumber: fc.customerNumber, name: fc.name, status: "created", customerId: newCustomer.id });
      } catch (err: any) {
        results.push({ customerNumber: fc.customerNumber, name: fc.name, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;

    res.json({
      summary: { created, skipped, errors, total: results.length },
      results,
    });
}));

// ============================================
// ARTICLES FETCH & IMPORT
// ============================================

app.get("/api/fortnox/articles/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const fortnoxArticles = await client.getArticles();
    const existingArticles = await storage.getArticles(tenantId);
    const existingMappings = await storage.getFortnoxMappings(tenantId, "article");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enriched = fortnoxArticles.map((fa: any) => {
      const articleNumber = fa.ArticleNumber || "";
      const alreadyImported = mappedFortnoxIds.has(articleNumber);
      const numberMatch = existingArticles.find(
        ea => ea.articleNumber?.toLowerCase() === articleNumber.toLowerCase()
      );
      return {
        articleNumber,
        description: fa.Description || "",
        unit: fa.Unit || "st",
        salesPrice: fa.SalesPrice || 0,
        purchasePrice: fa.PurchasePrice || 0,
        type: fa.Type || "",
        active: fa.Active !== false,
        alreadyImported,
        existingMatch: numberMatch ? { id: numberMatch.id, name: numberMatch.name } : null,
      };
    });

    res.json({ total: enriched.length, articles: enriched });
}));

app.post("/api/fortnox/articles/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      articles: z.array(z.object({
        articleNumber: z.string(),
        description: z.string(),
        unit: z.string().optional(),
        salesPrice: z.number().optional(),
        type: z.string().optional(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const existingMappings = await storage.getFortnoxMappings(tenantId, "article");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const results: Array<{ articleNumber: string; description: string; status: "created" | "skipped" | "error"; error?: string }> = [];

    for (const fa of parsed.data.articles) {
      try {
        if (mappedFortnoxIds.has(fa.articleNumber)) {
          results.push({ articleNumber: fa.articleNumber, description: fa.description, status: "skipped" });
          continue;
        }
        const newArticle = await storage.createArticle({
          tenantId,
          articleNumber: fa.articleNumber,
          name: fa.description || fa.articleNumber,
          description: fa.description,
          unit: fa.unit || "st",
          listPrice: Math.round((fa.salesPrice || 0) * 100),
          articleType: fa.type === "STOCK" ? "vara" : "tjanst",
        });
        await storage.createFortnoxMapping({
          tenantId,
          entityType: "article",
          unicornId: newArticle.id,
          fortnoxId: fa.articleNumber,
        });
        results.push({ articleNumber: fa.articleNumber, description: fa.description, status: "created" });
      } catch (err: any) {
        results.push({ articleNumber: fa.articleNumber, description: fa.description, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ summary: { created, skipped, errors, total: results.length }, results });
}));

// ============================================
// COST CENTERS FETCH & IMPORT
// ============================================

app.get("/api/fortnox/costcenters/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const fortnoxCCs = await client.getCostCenters();
    const existingMappings = await storage.getFortnoxMappings(tenantId, "costcenter");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enriched = fortnoxCCs.map((cc: any) => {
      const code = cc.Code || "";
      return {
        code,
        description: cc.Description || "",
        active: cc.Active !== false,
        alreadyImported: mappedFortnoxIds.has(code),
      };
    });

    res.json({ total: enriched.length, costcenters: enriched });
}));

app.post("/api/fortnox/costcenters/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      costcenters: z.array(z.object({
        code: z.string(),
        description: z.string(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const existingMappings = await storage.getFortnoxMappings(tenantId, "costcenter");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const results: Array<{ code: string; description: string; status: "created" | "skipped" | "error"; error?: string }> = [];

    for (const cc of parsed.data.costcenters) {
      try {
        if (mappedFortnoxIds.has(cc.code)) {
          results.push({ code: cc.code, description: cc.description, status: "skipped" });
          continue;
        }
        await storage.createFortnoxMapping({
          tenantId,
          entityType: "costcenter",
          unicornId: cc.code,
          fortnoxId: cc.code,
        });
        results.push({ code: cc.code, description: cc.description, status: "created" });
      } catch (err: any) {
        results.push({ code: cc.code, description: cc.description, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ summary: { created, skipped, errors, total: results.length }, results });
}));

// ============================================
// PROJECTS FETCH & IMPORT
// ============================================

app.get("/api/fortnox/projects/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const fortnoxProjects = await client.getProjects();
    const existingMappings = await storage.getFortnoxMappings(tenantId, "project");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enriched = fortnoxProjects.map((p: any) => {
      const projectNumber = p.ProjectNumber || "";
      return {
        projectNumber,
        description: p.Description || "",
        status: p.Status || "",
        startDate: p.StartDate || "",
        endDate: p.EndDate || "",
        active: p.Status !== "FINISHED",
        alreadyImported: mappedFortnoxIds.has(projectNumber),
      };
    });

    res.json({ total: enriched.length, projects: enriched });
}));

app.post("/api/fortnox/projects/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      projects: z.array(z.object({
        projectNumber: z.string(),
        description: z.string(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const existingMappings = await storage.getFortnoxMappings(tenantId, "project");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const results: Array<{ projectNumber: string; description: string; status: "created" | "skipped" | "error"; error?: string }> = [];

    for (const p of parsed.data.projects) {
      try {
        if (mappedFortnoxIds.has(p.projectNumber)) {
          results.push({ projectNumber: p.projectNumber, description: p.description, status: "skipped" });
          continue;
        }
        await storage.createFortnoxMapping({
          tenantId,
          entityType: "project",
          unicornId: p.projectNumber,
          fortnoxId: p.projectNumber,
        });
        results.push({ projectNumber: p.projectNumber, description: p.description, status: "created" });
      } catch (err: any) {
        results.push({ projectNumber: p.projectNumber, description: p.description, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ summary: { created, skipped, errors, total: results.length }, results });
}));

}
