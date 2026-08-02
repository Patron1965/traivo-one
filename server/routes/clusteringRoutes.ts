/**
 * Klustrings-API — stopp- och ruttklumpar.
 *
 * STOPPKLUMPAR:
 * POST /api/clustering/stop/analyze/:taskId   – analysera en uppgift manuellt
 * POST /api/clustering/stop/full-run          – fullständig omräkning (requirePlanner)
 * GET  /api/clustering/stop-clusters          – lista klumpar för tenant
 * GET  /api/clustering/stop-clusters/:id      – hämta klump med uppgifter
 * PATCH /api/clustering/stop-clusters/:id     – bekräfta / lås / lås upp
 * POST /api/clustering/stop-clusters/merge    – slå ihop två klumpar
 * POST /api/clustering/stop-clusters/:id/split – dela en klump
 *
 * RUTTKLUMPAR:
 * POST /api/clustering/route/analyze/:taskId  – analysera en uppgift manuellt
 * POST /api/clustering/route/full-run         – fullständig rullande körning (requirePlanner)
 * GET  /api/clustering/route-clusters         – lista ruttklumpar (filter: vecka, ort, code)
 * GET  /api/clustering/route-clusters/:id     – hämta klump med stopp och uppgifter
 * PATCH /api/clustering/route-clusters/:id    – bekräfta / lås / lås upp / byt vecka
 * POST /api/clustering/route-clusters/merge   – slå ihop
 * POST /api/clustering/route-clusters/:id/split – dela
 */
import type { Express } from "express";
import { db } from "../db";
import {
  stopClusters,
  stopClusterMemberships,
  routeClusters,
  routeClusterMemberships,
  workOrders,
} from "@shared/schema";
import { eq, and, isNull, desc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getTenantIdWithFallback, requirePlanner } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import {
  analyzeTask,
  runFullAnalysis,
  buildStopClusterName,
} from "../services/clustering/stop-clustering-engine";
import { clusteringQueue } from "../services/clustering/clustering-queue";
import {
  analyzeTask as analyzeRouteTask,
  runRollingAnalysis,
  buildRouteClusterName,
  scoreDay,
  DEFAULT_ROUTE_WEIGHTS,
  derivePrecision,
} from "../services/clustering/route-clustering-engine";

export function registerClusteringRoutes(app: Express): void {
  // -----------------------------------------------------------------------
  // POST /api/clustering/stop/analyze/:taskId
  // Analyserar EN uppgift mot befintliga klumpar (manuell trigger).
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/stop/analyze/:taskId",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const { taskId } = req.params;
      const matches = await analyzeTask(taskId, tenantId);
      res.json({ taskId, tenantId, matches });
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/stop/full-run
  // Fullständig omräkning för tenant (kräver planner-roll).
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/stop/full-run",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const schema = z.object({
        horizon: z.number().int().min(1).max(365).optional(),
      });
      const { horizon } = schema.parse(req.body);
      const result = await runFullAnalysis(tenantId, { horizon });
      res.json(result);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/clustering/stop-clusters
  // Lista stoppklumpar för tenant.
  // -----------------------------------------------------------------------
  app.get(
    "/api/clustering/stop-clusters",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const statusFilter = (req.query.status as string) || null;

      const rows = await db
        .select()
        .from(stopClusters)
        .where(
          and(
            eq(stopClusters.tenantId, tenantId),
            statusFilter ? eq(stopClusters.status, statusFilter) : undefined,
          ),
        )
        .orderBy(desc(stopClusters.createdAt));

      const countRows = await db
        .select({
          stopClusterId: stopClusterMemberships.stopClusterId,
          cnt: sql<number>`count(*)`,
        })
        .from(stopClusterMemberships)
        .where(
          and(
            eq(stopClusterMemberships.tenantId, tenantId),
            isNull(stopClusterMemberships.removedAt),
          ),
        )
        .groupBy(stopClusterMemberships.stopClusterId);

      const countMap = new Map<string, number>();
      for (const row of countRows) {
        countMap.set(row.stopClusterId, Number(row.cnt));
      }

      res.json(
        rows.map((c) => ({ ...c, memberCount: countMap.get(c.id) ?? 0 })),
      );
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/clustering/stop-clusters/:id
  // Hämta en stoppklump med dess aktiva uppgifter.
  // -----------------------------------------------------------------------
  app.get(
    "/api/clustering/stop-clusters/:id",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      const cluster = await db.query.stopClusters.findFirst({
        where: and(
          eq(stopClusters.id, req.params.id),
          eq(stopClusters.tenantId, tenantId),
        ),
      });
      if (!cluster) throw new NotFoundError("Stoppklump");

      const memberships = await db
        .select()
        .from(stopClusterMemberships)
        .where(
          and(
            eq(stopClusterMemberships.stopClusterId, cluster.id),
            isNull(stopClusterMemberships.removedAt),
          ),
        );

      const woIds = memberships
        .filter((m) => m.taskTable === "work_orders")
        .map((m) => m.taskId);

      const tasks =
        woIds.length > 0
          ? await db
              .select({
                id: workOrders.id,
                orderNumber: workOrders.orderNumber,
                title: workOrders.title,
                orderStatus: workOrders.orderStatus,
                executionStatus: workOrders.executionStatus,
                scheduledDate: workOrders.scheduledDate,
                desiredDeliveryStart: workOrders.desiredDeliveryStart,
                desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
                plannedWindowStart: workOrders.plannedWindowStart,
                plannedWindowEnd: workOrders.plannedWindowEnd,
                estimatedDuration: workOrders.estimatedDuration,
                executionCode: workOrders.executionCode,
                objectId: workOrders.objectId,
              })
              .from(workOrders)
              .where(
                and(
                  eq(workOrders.tenantId, tenantId),
                  inArray(workOrders.id, woIds),
                ),
              )
          : [];

      res.json({ ...cluster, memberships, tasks });
    }),
  );

  // -----------------------------------------------------------------------
  // PATCH /api/clustering/stop-clusters/:id
  // Bekräfta (confirmed) / lås (locked) / lås upp (auto) en klump.
  // -----------------------------------------------------------------------
  app.patch(
    "/api/clustering/stop-clusters/:id",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      const cluster = await db.query.stopClusters.findFirst({
        where: and(
          eq(stopClusters.id, req.params.id),
          eq(stopClusters.tenantId, tenantId),
        ),
      });
      if (!cluster) throw new NotFoundError("Stoppklump");

      const schema = z.object({
        status: z.enum(["auto", "confirmed", "locked"]).optional(),
        displayName: z.string().min(1).max(255).optional(),
      });
      const patch = schema.parse(req.body);

      const [updated] = await db
        .update(stopClusters)
        .set({
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.displayName ? { displayName: patch.displayName } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stopClusters.id, cluster.id),
            eq(stopClusters.tenantId, tenantId),
          ),
        )
        .returning();

      res.json(updated);
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/stop-clusters/merge
  // Slå ihop sourceId → targetId. Kanonisk klump = target.
  // Notera: statisk route MÅSTE definieras INNAN /:id-routen.
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/stop-clusters/merge",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const schema = z.object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
      });
      const { sourceId, targetId } = schema.parse(req.body);
      if (sourceId === targetId) {
        throw new ValidationError("Källa och mål kan inte vara samma klump");
      }

      const [source, target] = await Promise.all([
        db.query.stopClusters.findFirst({
          where: and(
            eq(stopClusters.id, sourceId),
            eq(stopClusters.tenantId, tenantId),
          ),
        }),
        db.query.stopClusters.findFirst({
          where: and(
            eq(stopClusters.id, targetId),
            eq(stopClusters.tenantId, tenantId),
          ),
        }),
      ]);
      if (!source) throw new NotFoundError("Källklump");
      if (!target) throw new NotFoundError("Målklump");

      const now = new Date();

      const activeMembers = await db
        .select()
        .from(stopClusterMemberships)
        .where(
          and(
            eq(stopClusterMemberships.stopClusterId, sourceId),
            isNull(stopClusterMemberships.removedAt),
          ),
        );

      if (activeMembers.length > 0) {
        await db
          .update(stopClusterMemberships)
          .set({ removedAt: now, removalReason: "recluster" })
          .where(
            and(
              eq(stopClusterMemberships.stopClusterId, sourceId),
              isNull(stopClusterMemberships.removedAt),
            ),
          );

        for (const m of activeMembers) {
          await db.insert(stopClusterMemberships).values({
            tenantId,
            stopClusterId: targetId,
            taskId: m.taskId,
            taskTable: m.taskTable,
            assignedAt: now,
          });

          if (m.taskTable === "work_orders") {
            await db
              .update(workOrders)
              .set({ stopClusterId: targetId, stopClusterCalculatedAt: now })
              .where(
                and(
                  eq(workOrders.id, m.taskId),
                  eq(workOrders.tenantId, tenantId),
                ),
              );
          }
        }
      }

      await db
        .update(stopClusters)
        .set({ status: "dissolved", dissolvedAt: now, updatedAt: now })
        .where(eq(stopClusters.id, sourceId));

      const updated = await db.query.stopClusters.findFirst({
        where: eq(stopClusters.id, targetId),
      });
      res.json({ merged: true, target: updated });
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/stop-clusters/:id/split
  // Dela en klump: angiven taskIds-lista → ny klump; övriga stannar.
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/stop-clusters/:id/split",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      const cluster = await db.query.stopClusters.findFirst({
        where: and(
          eq(stopClusters.id, req.params.id),
          eq(stopClusters.tenantId, tenantId),
        ),
      });
      if (!cluster) throw new NotFoundError("Stoppklump");

      const schema = z.object({
        taskIds: z.array(z.string().min(1)).min(1),
        displayName: z.string().min(1).optional(),
      });
      const { taskIds, displayName } = schema.parse(req.body);

      const now = new Date();

      await db
        .update(stopClusterMemberships)
        .set({ removedAt: now, removalReason: "recluster" })
        .where(
          and(
            eq(stopClusterMemberships.stopClusterId, cluster.id),
            isNull(stopClusterMemberships.removedAt),
            inArray(stopClusterMemberships.taskId, taskIds),
          ),
        );

      const newDisplayName =
        displayName ?? buildStopClusterName("Delad klump", cluster.city);

      const [newCluster] = await db
        .insert(stopClusters)
        .values({
          tenantId,
          referenceNumber: null,
          displayName: newDisplayName,
          normalizedAddress: cluster.normalizedAddress,
          city: cluster.city,
          latitude: cluster.latitude,
          longitude: cluster.longitude,
          radiusMeters: cluster.radiusMeters ?? 30,
          executionCode: cluster.executionCode,
          executionCodeDefinitionId: cluster.executionCodeDefinitionId,
          earliestDeliveryAt: null,
          latestDeliveryAt: null,
          status: "auto",
          clusteringRuleVersion: "v1",
          lastCalculatedAt: now,
        })
        .returning();

      for (const taskId of taskIds) {
        await db.insert(stopClusterMemberships).values({
          tenantId,
          stopClusterId: newCluster.id,
          taskId,
          taskTable: "work_orders",
          assignedAt: now,
        });
        await db
          .update(workOrders)
          .set({ stopClusterId: newCluster.id, stopClusterCalculatedAt: now })
          .where(
            and(eq(workOrders.id, taskId), eq(workOrders.tenantId, tenantId)),
          );
      }

      res.status(201).json({ split: true, newCluster });
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/stop/enqueue/:taskId
  // Manuellt köa en uppgift för inkrementell analys (planner).
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/stop/enqueue/:taskId",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const { taskId } = req.params;
      clusteringQueue.enqueue({ taskId, taskTable: "work_orders", tenantId });
      res.json({
        queued: true,
        taskId,
        pending: clusteringQueue.pendingCount,
      });
    }),
  );

  // ==========================================================================
  // RUTTKLUMPAR (route_clusters)
  // ==========================================================================

  // -----------------------------------------------------------------------
  // POST /api/clustering/route/analyze/:taskId
  // Analyserar EN uppgift mot befintliga ruttklumpar.
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/route/analyze/:taskId",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const { taskId } = req.params;
      const matches = await analyzeRouteTask(taskId, tenantId);
      res.json({ taskId, tenantId, matches });
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/route/full-run
  // Fullständig rullande omräkning (kräver planner-roll).
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/route/full-run",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const schema = z.object({
        horizon: z.number().int().min(1).max(365).optional(),
      });
      const { horizon } = schema.parse(req.body);
      const result = await runRollingAnalysis(tenantId, horizon);
      res.json(result);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/clustering/route-clusters
  // Lista ruttklumpar för tenant.
  // Filter: ?status=, ?week=<num>, ?executionCode=, ?city=
  //   ?week=43  → vecka 43 (ISO); returnerar klumpar vars period överlappar veckan
  // -----------------------------------------------------------------------
  app.get(
    "/api/clustering/route-clusters",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const statusFilter = (req.query.status as string) || null;
      const executionCodeFilter = (req.query.executionCode as string) || null;
      const cityFilter = (req.query.city as string) || null;

      // Veckofiltret: parsera "43" eller "v.43" → ISO vecka som datum-intervall
      const weekParam = (req.query.week as string) || null;
      let weekStart: Date | null = null;
      let weekEnd: Date | null = null;
      if (weekParam) {
        const weekNum = parseInt(weekParam.replace(/^v\./, ""), 10);
        if (!isNaN(weekNum)) {
          const year = new Date().getFullYear();
          weekStart = isoWeekStart(year, weekNum);
          weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000 - 1);
        }
      }

      const conditions = [eq(routeClusters.tenantId, tenantId)];
      if (statusFilter) conditions.push(eq(routeClusters.status, statusFilter));
      if (executionCodeFilter)
        conditions.push(eq(routeClusters.executionCode, executionCodeFilter));

      const rows = await db
        .select()
        .from(routeClusters)
        .where(and(...conditions))
        .orderBy(desc(routeClusters.createdAt));

      const countRows = await db
        .select({
          routeClusterId: routeClusterMemberships.routeClusterId,
          cnt: sql<number>`count(*)`,
        })
        .from(routeClusterMemberships)
        .where(
          and(
            eq(routeClusterMemberships.tenantId, tenantId),
            isNull(routeClusterMemberships.removedAt),
          ),
        )
        .groupBy(routeClusterMemberships.routeClusterId);

      const countMap = new Map<string, number>();
      for (const row of countRows) {
        countMap.set(row.routeClusterId, Number(row.cnt));
      }

      const filtered = rows.filter((c) => {
        if (cityFilter && !c.displayName?.includes(cityFilter)) return false;
        if (weekStart && weekEnd) {
          // Klumpens period måste överlappa [weekStart, weekEnd]
          const cS = c.earliestDeliveryAt
            ? new Date(c.earliestDeliveryAt)
            : new Date(0);
          const cE = c.latestDeliveryAt
            ? new Date(c.latestDeliveryAt)
            : new Date(8640000000000000);
          if (cS > weekEnd || cE < weekStart) return false;
        }
        return true;
      });

      const result = filtered.map((c) => ({
        ...c,
        taskCount: countMap.get(c.id) ?? 0,
        period: c.earliestDeliveryAt
          ? (() => {
              const start = new Date(c.earliestDeliveryAt);
              const end = c.latestDeliveryAt
                ? new Date(c.latestDeliveryAt)
                : null;
              if (!end) return formatWeekLabel(start);
              const wS = formatWeekLabel(start);
              const wE = formatWeekLabel(end);
              return wS === wE ? wS : `${wS}–${wE}`;
            })()
          : null,
      }));

      res.json(result);
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/clustering/route-clusters/:id
  // Hämta ruttklump med ingående stopp och uppgifter.
  // Notera: statisk route (merge) MÅSTE definieras FÖRE /:id.
  // -----------------------------------------------------------------------
  app.get(
    "/api/clustering/route-clusters/:id",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      const cluster = await db.query.routeClusters.findFirst({
        where: and(
          eq(routeClusters.id, req.params.id),
          eq(routeClusters.tenantId, tenantId),
        ),
      });
      if (!cluster) throw new NotFoundError("Ruttförslag");

      const memberships = await db
        .select()
        .from(routeClusterMemberships)
        .where(
          and(
            eq(routeClusterMemberships.routeClusterId, cluster.id),
            eq(routeClusterMemberships.tenantId, tenantId),
            isNull(routeClusterMemberships.removedAt),
          ),
        );

      const woIds = memberships
        .filter((m) => m.taskTable === "work_orders")
        .map((m) => m.taskId);

      const tasks =
        woIds.length > 0
          ? await db
              .select({
                id: workOrders.id,
                orderNumber: workOrders.orderNumber,
                title: workOrders.title,
                orderStatus: workOrders.orderStatus,
                executionStatus: workOrders.executionStatus,
                scheduledDate: workOrders.scheduledDate,
                desiredDeliveryStart: workOrders.desiredDeliveryStart,
                desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
                plannedWindowStart: workOrders.plannedWindowStart,
                plannedWindowEnd: workOrders.plannedWindowEnd,
                estimatedDuration: workOrders.estimatedDuration,
                executionCode: workOrders.executionCode,
                objectId: workOrders.objectId,
                taskLatitude: workOrders.taskLatitude,
                taskLongitude: workOrders.taskLongitude,
                stopClusterId: workOrders.stopClusterId,
              })
              .from(workOrders)
              .where(
                and(
                  eq(workOrders.tenantId, tenantId),
                  inArray(workOrders.id, woIds),
                ),
              )
          : [];

      const period = cluster.earliestDeliveryAt
        ? (() => {
            const start = new Date(cluster.earliestDeliveryAt);
            const end = cluster.latestDeliveryAt
              ? new Date(cluster.latestDeliveryAt)
              : null;
            if (!end) return formatWeekLabel(start);
            const wS = formatWeekLabel(start);
            const wE = formatWeekLabel(end);
            return wS === wE ? wS : `${wS}–${wE}`;
          })()
        : null;

      res.json({ ...cluster, memberships, tasks, period });
    }),
  );

  // -----------------------------------------------------------------------
  // PATCH /api/clustering/route-clusters/:id
  // Bekräfta / lås / lås upp / byt vecka / ändra namn.
  // -----------------------------------------------------------------------
  app.patch(
    "/api/clustering/route-clusters/:id",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      const cluster = await db.query.routeClusters.findFirst({
        where: and(
          eq(routeClusters.id, req.params.id),
          eq(routeClusters.tenantId, tenantId),
        ),
      });
      if (!cluster) throw new NotFoundError("Ruttförslag");

      const schema = z.object({
        status: z.enum(["active", "confirmed", "locked"]).optional(),
        displayName: z.string().min(1).max(255).optional(),
        routeDescription: z.string().max(1000).optional(),
        earliestDeliveryAt: z.coerce.date().optional(),
        latestDeliveryAt: z.coerce.date().optional(),
      });
      const patch = schema.parse(req.body);

      const [updated] = await db
        .update(routeClusters)
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.displayName !== undefined
            ? { displayName: patch.displayName }
            : {}),
          ...(patch.routeDescription !== undefined
            ? { routeDescription: patch.routeDescription }
            : {}),
          ...(patch.earliestDeliveryAt !== undefined
            ? { earliestDeliveryAt: patch.earliestDeliveryAt }
            : {}),
          ...(patch.latestDeliveryAt !== undefined
            ? { latestDeliveryAt: patch.latestDeliveryAt }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(routeClusters.id, cluster.id),
            eq(routeClusters.tenantId, tenantId),
          ),
        )
        .returning();

      res.json(updated);
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/route-clusters/merge
  // Slå ihop sourceId → targetId. Statisk route FÖRE /:id.
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/route-clusters/merge",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const schema = z.object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
      });
      const { sourceId, targetId } = schema.parse(req.body);
      if (sourceId === targetId) {
        throw new ValidationError("Källa och mål kan inte vara samma ruttförslag");
      }

      const [source, target] = await Promise.all([
        db.query.routeClusters.findFirst({
          where: and(
            eq(routeClusters.id, sourceId),
            eq(routeClusters.tenantId, tenantId),
          ),
        }),
        db.query.routeClusters.findFirst({
          where: and(
            eq(routeClusters.id, targetId),
            eq(routeClusters.tenantId, tenantId),
          ),
        }),
      ]);
      if (!source) throw new NotFoundError("Källklump");
      if (!target) throw new NotFoundError("Målklump");

      const now = new Date();

      const activeMembers = await db
        .select()
        .from(routeClusterMemberships)
        .where(
          and(
            eq(routeClusterMemberships.routeClusterId, sourceId),
            eq(routeClusterMemberships.tenantId, tenantId),
            isNull(routeClusterMemberships.removedAt),
          ),
        );

      if (activeMembers.length > 0) {
        await db
          .update(routeClusterMemberships)
          .set({ removedAt: now, removalReason: "recluster" })
          .where(
            and(
              eq(routeClusterMemberships.routeClusterId, sourceId),
              eq(routeClusterMemberships.tenantId, tenantId),
              isNull(routeClusterMemberships.removedAt),
            ),
          );

        // Sätt in memberships i target (deduplicera mot befintliga aktiva)
        const existingTargetMemberIds = await db
          .select({ taskId: routeClusterMemberships.taskId })
          .from(routeClusterMemberships)
          .where(
            and(
              eq(routeClusterMemberships.routeClusterId, targetId),
              eq(routeClusterMemberships.tenantId, tenantId),
              isNull(routeClusterMemberships.removedAt),
            ),
          );
        const existingSet = new Set(
          existingTargetMemberIds.map((r) => r.taskId),
        );

        for (const m of activeMembers) {
          if (!existingSet.has(m.taskId)) {
            await db.insert(routeClusterMemberships).values({
              tenantId,
              routeClusterId: targetId,
              taskId: m.taskId,
              taskTable: m.taskTable,
              assignedAt: now,
            });
          }
          if (m.taskTable === "work_orders") {
            await db
              .update(workOrders)
              .set({ routeClusterId: targetId, routeClusterCalculatedAt: now })
              .where(
                and(
                  eq(workOrders.id, m.taskId),
                  eq(workOrders.tenantId, tenantId),
                ),
              );
          }
        }
      }

      await db
        .update(routeClusters)
        .set({ status: "dissolved", dissolvedAt: now, updatedAt: now })
        .where(
          and(
            eq(routeClusters.id, sourceId),
            eq(routeClusters.tenantId, tenantId),
          ),
        );

      const updated = await db.query.routeClusters.findFirst({
        where: eq(routeClusters.id, targetId),
      });
      res.json({ merged: true, target: updated });
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/route-clusters/:id/split
  // Dela en ruttklump: angiven taskIds-lista → ny klump; övriga stannar.
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/route-clusters/:id/split",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      const cluster = await db.query.routeClusters.findFirst({
        where: and(
          eq(routeClusters.id, req.params.id),
          eq(routeClusters.tenantId, tenantId),
        ),
      });
      if (!cluster) throw new NotFoundError("Ruttförslag");

      const schema = z.object({
        taskIds: z.array(z.string().min(1)).min(1),
        displayName: z.string().min(1).optional(),
      });
      const { taskIds, displayName } = schema.parse(req.body);

      const now = new Date();

      await db
        .update(routeClusterMemberships)
        .set({ removedAt: now, removalReason: "recluster" })
        .where(
          and(
            eq(routeClusterMemberships.routeClusterId, cluster.id),
            eq(routeClusterMemberships.tenantId, tenantId),
            isNull(routeClusterMemberships.removedAt),
            inArray(routeClusterMemberships.taskId, taskIds),
          ),
        );

      const newDisplayName = displayName ?? `${cluster.displayName} (delad)`;

      const [newCluster] = await db
        .insert(routeClusters)
        .values({
          tenantId,
          referenceNumber: null,
          displayName: newDisplayName,
          centerLatitude: cluster.centerLatitude,
          centerLongitude: cluster.centerLongitude,
          radiusKilometers: cluster.radiusKilometers ?? 40,
          executionCode: cluster.executionCode,
          executionCodeDefinitionId: cluster.executionCodeDefinitionId,
          earliestDeliveryAt: null,
          latestDeliveryAt: null,
          precisionLevel: cluster.precisionLevel ?? "high",
          status: "active",
          clusteringRuleVersion: "v1",
          lastCalculatedAt: now,
          updatedAt: now,
        })
        .returning();

      for (const taskId of taskIds) {
        await db.insert(routeClusterMemberships).values({
          tenantId,
          routeClusterId: newCluster.id,
          taskId,
          taskTable: "work_orders",
          assignedAt: now,
        });
        await db
          .update(workOrders)
          .set({ routeClusterId: newCluster.id, routeClusterCalculatedAt: now })
          .where(
            and(
              eq(workOrders.id, taskId),
              eq(workOrders.tenantId, tenantId),
            ),
          );
      }

      res.status(201).json({ split: true, newCluster });
    }),
  );

  // -----------------------------------------------------------------------
  // POST /api/clustering/bulk-assign
  // Tilldela alla uppgifter i valda klumpar till ett team och en vecka.
  // Används från kartvy (planerarläge) vid rektangelurval av klumpar.
  // -----------------------------------------------------------------------
  app.post(
    "/api/clustering/bulk-assign",
    requirePlanner,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const schema = z.object({
        routeClusterIds: z.array(z.string().min(1)).max(200).default([]),
        stopClusterIds: z.array(z.string().min(1)).max(200).default([]),
        teamId: z.string().min(1),
        week: z.string().regex(/^\d{4}-W\d{2}$/, "Ogiltigt veckoformat (YYYY-Www)"),
        kommentar: z.string().max(250).optional(),
      });
      const parsed = schema.parse(req.body);

      // Set-baserad hämtning: tenant-validering av klumparna sker via
      // inner join mot kluster-tabellen (tenant-filtrerad) — en fråga per
      // klumptyp istället för 2 frågor per klump.
      const [routeMembers, stopMembers] = await Promise.all([
        parsed.routeClusterIds.length > 0
          ? db
              .select({ taskId: routeClusterMemberships.taskId })
              .from(routeClusterMemberships)
              .innerJoin(
                routeClusters,
                and(
                  eq(routeClusters.id, routeClusterMemberships.routeClusterId),
                  eq(routeClusters.tenantId, tenantId),
                ),
              )
              .where(
                and(
                  inArray(
                    routeClusterMemberships.routeClusterId,
                    parsed.routeClusterIds,
                  ),
                  isNull(routeClusterMemberships.removedAt),
                  eq(routeClusterMemberships.taskTable, "work_orders"),
                ),
              )
          : Promise.resolve([]),
        parsed.stopClusterIds.length > 0
          ? db
              .select({ taskId: stopClusterMemberships.taskId })
              .from(stopClusterMemberships)
              .innerJoin(
                stopClusters,
                and(
                  eq(stopClusters.id, stopClusterMemberships.stopClusterId),
                  eq(stopClusters.tenantId, tenantId),
                ),
              )
              .where(
                and(
                  inArray(
                    stopClusterMemberships.stopClusterId,
                    parsed.stopClusterIds,
                  ),
                  isNull(stopClusterMemberships.removedAt),
                  eq(stopClusterMemberships.taskTable, "work_orders"),
                ),
              )
          : Promise.resolve([]),
      ]);

      const woIds = new Set<string>();
      for (const m of routeMembers) woIds.add(m.taskId);
      for (const m of stopMembers) woIds.add(m.taskId);

      const allIds = Array.from(woIds);
      if (allIds.length === 0) {
        return res.json({ updated: 0, total: 0 });
      }

      const returning = await db
        .update(workOrders)
        .set({
          teamId: parsed.teamId,
          roughPlannedWeek: parsed.week,
          ...(parsed.kommentar ? { plannedNotes: parsed.kommentar } : {}),
        })
        .where(
          and(
            inArray(workOrders.id, allIds),
            eq(workOrders.tenantId, tenantId),
          ),
        )
        .returning({ id: workOrders.id });

      res.json({ updated: returning.length, total: allIds.length });
    }),
  );

  // -----------------------------------------------------------------------
  // GET /api/clustering/task-memberships?workOrderIds=id1,id2,...
  // Hämtar aktiva klump-memberships för en lista work order IDs (max 200).
  // Returnerar: { [workOrderId]: { stop: [...], route: [...] } }
  // -----------------------------------------------------------------------
  app.get(
    "/api/clustering/task-memberships",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const raw = ((req.query.workOrderIds as string) ?? "").trim();
      const woIds = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
      if (woIds.length === 0) { res.json({}); return; }

      const [stopMems, routeMems] = await Promise.all([
        db
          .select({
            taskId: stopClusterMemberships.taskId,
            clusterId: stopClusters.id,
            displayName: stopClusters.displayName,
            status: stopClusters.status,
          })
          .from(stopClusterMemberships)
          .innerJoin(stopClusters, eq(stopClusters.id, stopClusterMemberships.stopClusterId))
          .where(
            and(
              eq(stopClusterMemberships.tenantId, tenantId),
              inArray(stopClusterMemberships.taskId, woIds),
              isNull(stopClusterMemberships.removedAt),
              eq(stopClusterMemberships.taskTable, "work_orders"),
            ),
          ),
        db
          .select({
            taskId: routeClusterMemberships.taskId,
            clusterId: routeClusters.id,
            displayName: routeClusters.displayName,
            status: routeClusters.status,
            calculatedWorkMinutes: routeClusters.calculatedWorkMinutes,
            earliestDeliveryAt: routeClusters.earliestDeliveryAt,
            latestDeliveryAt: routeClusters.latestDeliveryAt,
          })
          .from(routeClusterMemberships)
          .innerJoin(routeClusters, eq(routeClusters.id, routeClusterMemberships.routeClusterId))
          .where(
            and(
              eq(routeClusterMemberships.tenantId, tenantId),
              inArray(routeClusterMemberships.taskId, woIds),
              isNull(routeClusterMemberships.removedAt),
              eq(routeClusterMemberships.taskTable, "work_orders"),
            ),
          ),
      ]);

      // member counts for the stop clusters found
      const scIds = Array.from(new Set(stopMems.map((m) => m.clusterId)));
      const stopCountMap = new Map<string, number>();
      if (scIds.length > 0) {
        const cRows = await db
          .select({
            stopClusterId: stopClusterMemberships.stopClusterId,
            cnt: sql<number>`count(*)`,
          })
          .from(stopClusterMemberships)
          .where(
            and(
              eq(stopClusterMemberships.tenantId, tenantId),
              inArray(stopClusterMemberships.stopClusterId, scIds),
              isNull(stopClusterMemberships.removedAt),
            ),
          )
          .groupBy(stopClusterMemberships.stopClusterId);
        for (const row of cRows) stopCountMap.set(row.stopClusterId, Number(row.cnt));
      }

      const result: Record<string, { stop: object[]; route: object[] }> = {};
      for (const id of woIds) result[id] = { stop: [], route: [] };

      for (const m of stopMems) {
        result[m.taskId]?.stop.push({
          id: m.clusterId,
          displayName: m.displayName,
          status: m.status,
          memberCount: stopCountMap.get(m.clusterId) ?? 0,
        });
      }
      for (const m of routeMems) {
        const period = m.earliestDeliveryAt
          ? formatWeekLabel(new Date(m.earliestDeliveryAt as unknown as string))
          : null;
        const periodEnd = m.latestDeliveryAt
          ? formatWeekLabel(new Date(m.latestDeliveryAt as unknown as string))
          : null;
        const periodLabel =
          period && periodEnd && period !== periodEnd
            ? `${period}–${periodEnd}`
            : period;
        result[m.taskId]?.route.push({
          id: m.clusterId,
          displayName: m.displayName,
          status: m.status,
          period: periodLabel,
          workMinutes: m.calculatedWorkMinutes,
        });
      }

      res.json(result);
    }),
  );
}

// ---------------------------------------------------------------------------
// Hjälpfunktioner
// ---------------------------------------------------------------------------

/** Returnerar Monday 00:00:00 för ISO-vecka weekNum i år year. */
function isoWeekStart(year: number, weekNum: number): Date {
  // Jan 4 är alltid i vecka 1 (ISO 8601)
  const jan4 = new Date(year, 0, 4);
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const start = new Date(mondayWeek1);
  start.setDate(mondayWeek1.getDate() + (weekNum - 1) * 7);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatWeekLabel(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return `v.${weekNum}`;
}
