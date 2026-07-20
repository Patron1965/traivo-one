/**
 * Klustrings-API — stoppklumpar.
 *
 * POST /api/clustering/stop/analyze/:taskId   – analysera en uppgift manuellt
 * POST /api/clustering/stop/full-run          – fullständig omräkning (requirePlanner)
 * GET  /api/clustering/stop-clusters          – lista klumpar för tenant
 * GET  /api/clustering/stop-clusters/:id      – hämta klump med uppgifter
 * PATCH /api/clustering/stop-clusters/:id     – bekräfta / lås / lås upp
 * POST /api/clustering/stop-clusters/merge    – slå ihop två klumpar
 * POST /api/clustering/stop-clusters/:id/split – dela en klump
 */
import type { Express } from "express";
import { db } from "../db";
import {
  stopClusters,
  stopClusterMemberships,
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
}
