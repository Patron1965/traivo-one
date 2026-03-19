import type { Express } from "express";
import type { SQL } from "drizzle-orm";
import { db } from "../db";
import { eq, and, gte, lte, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { annualGoals, workOrders, workOrderLines, subscriptions, orderConcepts, customers, objects, articles, clusters, insertAnnualGoalSchema } from "@shared/schema";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";

function buildGoalScopeConditions(
  tenantId: string,
  yearStart: Date,
  yearEnd: Date,
  objectId: string | null,
  customerId: string | null,
  clusterId: string | null,
): SQL[] {
  const conditions: SQL[] = [
    eq(workOrders.tenantId, tenantId),
    isNull(workOrders.deletedAt),
    gte(workOrders.scheduledDate, yearStart),
    lte(workOrders.scheduledDate, yearEnd),
  ];

  if (objectId) {
    conditions.push(eq(workOrders.objectId, objectId));
  } else if (clusterId) {
    conditions.push(sql`${workOrders.objectId} IN (SELECT id FROM objects WHERE cluster_id = ${clusterId})`);
  } else if (customerId) {
    conditions.push(eq(workOrders.customerId, customerId));
  }

  return conditions;
}

export async function registerAnnualGoalRoutes(app: Express) {

app.get("/api/annual-goals", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();

  const goals = await db
    .select({
      id: annualGoals.id,
      tenantId: annualGoals.tenantId,
      customerId: annualGoals.customerId,
      objectId: annualGoals.objectId,
      clusterId: annualGoals.clusterId,
      articleType: annualGoals.articleType,
      targetCount: annualGoals.targetCount,
      year: annualGoals.year,
      notes: annualGoals.notes,
      sourceType: annualGoals.sourceType,
      sourceId: annualGoals.sourceId,
      status: annualGoals.status,
      createdAt: annualGoals.createdAt,
      deletedAt: annualGoals.deletedAt,
      customerName: customers.name,
      objectName: objects.name,
      objectAddress: objects.address,
      clusterName: clusters.name,
    })
    .from(annualGoals)
    .leftJoin(customers, eq(annualGoals.customerId, customers.id))
    .leftJoin(objects, eq(annualGoals.objectId, objects.id))
    .leftJoin(clusters, eq(annualGoals.clusterId, clusters.id))
    .where(and(
      eq(annualGoals.tenantId, tenantId),
      eq(annualGoals.year, year),
      isNull(annualGoals.deletedAt),
    ))
    .orderBy(desc(annualGoals.createdAt));

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const totalDaysInYear = Math.floor((yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const yearProgress = Math.max(0, Math.min(dayOfYear / totalDaysInYear, 1));

  const enriched = await Promise.all(goals.map(async (goal) => {
    const baseConditions = buildGoalScopeConditions(tenantId, yearStart, yearEnd, goal.objectId, goal.customerId, goal.clusterId);

    const [completedResult] = await db
      .select({ count: sql<number>`count(distinct ${workOrders.id})::int` })
      .from(workOrders)
      .innerJoin(workOrderLines, eq(workOrders.id, workOrderLines.workOrderId))
      .innerJoin(articles, eq(workOrderLines.articleId, articles.id))
      .where(and(
        ...baseConditions,
        eq(workOrders.executionStatus, "completed"),
        eq(articles.articleType, goal.articleType),
      ));

    const [plannedResult] = await db
      .select({ count: sql<number>`count(distinct ${workOrders.id})::int` })
      .from(workOrders)
      .innerJoin(workOrderLines, eq(workOrders.id, workOrderLines.workOrderId))
      .innerJoin(articles, eq(workOrderLines.articleId, articles.id))
      .where(and(
        ...baseConditions,
        eq(articles.articleType, goal.articleType),
      ));

    const completedCount = completedResult?.count || 0;
    const plannedCount = plannedResult?.count || 0;
    const progressPercent = goal.targetCount > 0 ? Math.round((completedCount / goal.targetCount) * 100) : 0;
    const expectedAtThisPoint = Math.round(goal.targetCount * yearProgress);
    const delta = completedCount - expectedAtThisPoint;
    const projectedCompletion = yearProgress > 0 ? Math.round(completedCount / yearProgress) : 0;

    let forecast: "on_track" | "at_risk" | "behind" = "on_track";
    if (yearProgress > 0.1) {
      const behindPercent = expectedAtThisPoint > 0
        ? (expectedAtThisPoint - completedCount) / expectedAtThisPoint
        : 0;
      if (behindPercent > 0.2) {
        forecast = "behind";
      } else if (behindPercent > 0) {
        forecast = "at_risk";
      }
    }

    return {
      ...goal,
      completedCount,
      plannedCount,
      progressPercent,
      expectedAtThisPoint,
      delta,
      projectedCompletion,
      forecast,
    };
  }));

  res.json(enriched);
}));

app.post("/api/annual-goals", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertAnnualGoalSchema.parse({ ...req.body, tenantId });

  const scopeCount = [data.customerId, data.objectId, data.clusterId].filter(Boolean).length;
  if (scopeCount === 0) {
    throw new ValidationError("Minst en av kund, objekt eller kluster måste anges");
  }

  if (data.targetCount < 1) {
    throw new ValidationError("Målantal måste vara minst 1");
  }

  const [goal] = await db.insert(annualGoals).values(data).returning();
  res.status(201).json(goal);
}));

app.put("/api/annual-goals/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { id } = req.params;

  const [existing] = await db.select().from(annualGoals).where(eq(annualGoals.id, id));
  if (!existing || existing.tenantId !== tenantId) {
    throw new NotFoundError("Årsmål hittades inte");
  }

  const updateSchema = z.object({
    customerId: z.string().nullable().optional(),
    objectId: z.string().nullable().optional(),
    clusterId: z.string().nullable().optional(),
    articleType: z.string().min(1).optional(),
    targetCount: z.number().min(1).optional(),
    year: z.number().min(2020).max(2050).optional(),
    notes: z.string().nullable().optional(),
    status: z.enum(["active", "paused", "completed"]).optional(),
  });

  const updateData = updateSchema.parse(req.body);

  const [updated] = await db
    .update(annualGoals)
    .set(updateData)
    .where(eq(annualGoals.id, id))
    .returning();

  res.json(updated);
}));

app.delete("/api/annual-goals/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { id } = req.params;

  const [existing] = await db.select().from(annualGoals).where(eq(annualGoals.id, id));
  if (!existing || existing.tenantId !== tenantId) {
    throw new NotFoundError("Årsmål hittades inte");
  }

  await db.update(annualGoals).set({ deletedAt: new Date() }).where(eq(annualGoals.id, id));
  res.status(204).send();
}));

app.post("/api/annual-goals/generate-from-subscriptions", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const year = req.body.year || new Date().getFullYear();

  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.tenantId, tenantId),
      eq(subscriptions.status, "active"),
      isNull(subscriptions.deletedAt),
    ));

  const activeOCs = await db
    .select()
    .from(orderConcepts)
    .where(and(
      eq(orderConcepts.tenantId, tenantId),
      eq(orderConcepts.status, "active"),
      isNull(orderConcepts.deletedAt),
    ));

  const periodicityToYearly: Record<string, number> = {
    vecka: 52,
    varannan_vecka: 26,
    manad: 12,
    kvartal: 4,
    halvar: 2,
    ar: 1,
  };

  let created = 0;
  let skipped = 0;

  for (const sub of activeSubs) {
    const yearlyCount = periodicityToYearly[sub.periodicity] || 12;

    const articleIds = Array.isArray(sub.articleIds) ? sub.articleIds : [];
    let articleType = "tjanst";
    if (articleIds.length > 0) {
      const firstEntry = articleIds[0];
      let firstArticleId: string | null = null;
      if (typeof firstEntry === "string") {
        firstArticleId = firstEntry;
      } else if (firstEntry && typeof firstEntry === "object") {
        const entryRecord = firstEntry as Record<string, unknown>;
        if (typeof entryRecord.articleId === "string") {
          firstArticleId = entryRecord.articleId;
        }
      }
      if (firstArticleId) {
        const [art] = await db.select({ articleType: articles.articleType }).from(articles).where(eq(articles.id, firstArticleId));
        if (art) articleType = art.articleType;
      }
    }

    const [existing] = await db
      .select({ id: annualGoals.id })
      .from(annualGoals)
      .where(and(
        eq(annualGoals.tenantId, tenantId),
        eq(annualGoals.year, year),
        eq(annualGoals.objectId, sub.objectId),
        eq(annualGoals.articleType, articleType),
        isNull(annualGoals.deletedAt),
      ));

    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(annualGoals).values({
      tenantId,
      customerId: sub.customerId,
      objectId: sub.objectId,
      articleType,
      targetCount: yearlyCount,
      year,
      sourceType: "subscription",
      sourceId: sub.id,
      status: "active",
    });
    created++;
  }

  for (const oc of activeOCs) {
    if (!oc.articleId) continue;

    const [art] = await db.select({ articleType: articles.articleType }).from(articles).where(eq(articles.id, oc.articleId));
    if (!art) continue;

    let yearlyCount = 1;
    if (oc.scenario === "abonnemang" && oc.washesPerYear) {
      yearlyCount = oc.washesPerYear;
    } else if (oc.timesPerPeriod && oc.periodType) {
      const periodMultiplier: Record<string, number> = { week: 52, month: 12, quarter: 4, year: 1 };
      yearlyCount = (oc.timesPerPeriod || 1) * (periodMultiplier[oc.periodType] || 1);
    }

    if (oc.targetClusterId) {
      const [existingClusterGoal] = await db
        .select({ id: annualGoals.id })
        .from(annualGoals)
        .where(and(
          eq(annualGoals.tenantId, tenantId),
          eq(annualGoals.year, year),
          eq(annualGoals.clusterId, oc.targetClusterId),
          eq(annualGoals.articleType, art.articleType),
          isNull(annualGoals.deletedAt),
        ));

      if (existingClusterGoal) {
        skipped++;
      } else {
        await db.insert(annualGoals).values({
          tenantId,
          customerId: oc.customerId,
          clusterId: oc.targetClusterId,
          articleType: art.articleType,
          targetCount: yearlyCount,
          year,
          sourceType: "order_concept",
          sourceId: oc.id,
          status: "active",
        });
        created++;
      }
    } else if (oc.customerId) {
      const customerObjects = await db
        .select({ id: objects.id, customerId: objects.customerId })
        .from(objects)
        .where(and(
          eq(objects.tenantId, tenantId),
          eq(objects.customerId, oc.customerId),
          isNull(objects.deletedAt),
        ));

      for (const obj of customerObjects) {
        const [existing] = await db
          .select({ id: annualGoals.id })
          .from(annualGoals)
          .where(and(
            eq(annualGoals.tenantId, tenantId),
            eq(annualGoals.year, year),
            eq(annualGoals.objectId, obj.id),
            eq(annualGoals.articleType, art.articleType),
            isNull(annualGoals.deletedAt),
          ));

        if (existing) {
          skipped++;
          continue;
        }

        await db.insert(annualGoals).values({
          tenantId,
          customerId: obj.customerId,
          objectId: obj.id,
          articleType: art.articleType,
          targetCount: yearlyCount,
          year,
          sourceType: "order_concept",
          sourceId: oc.id,
          status: "active",
        });
        created++;
      }
    }
  }

  res.json({ created, skipped, year });
}));

}
