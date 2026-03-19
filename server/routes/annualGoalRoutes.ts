import type { Express } from "express";
import type { SQL } from "drizzle-orm";
import { db } from "../db";
import { eq, and, gte, lte, isNull, sql, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { annualGoals, workOrders, workOrderLines, subscriptions, orderConcepts, customers, objects, articles, clusters, resources, objectTimeRestrictions, insertAnnualGoalSchema, insertWorkOrderSchema, type FlexibleFrequency, type Season } from "@shared/schema";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { generateScheduleDates, isDateInSeason, convertLegacyPeriodicity } from "../scheduling-utils";
import OpenAI from "openai";
import { trackOpenAIResponse } from "../api-usage-tracker";

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
    throw new ValidationError("Välj exakt en av kund, objekt eller kluster");
  }
  if (scopeCount > 1) {
    throw new ValidationError("Välj exakt en av kund, objekt eller kluster — inte flera samtidigt");
  }

  if (data.targetCount < 1) {
    throw new ValidationError("Målantal måste vara minst 1");
  }

  if (data.customerId) {
    const [cust] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, data.customerId), eq(customers.tenantId, tenantId)));
    if (!cust) throw new NotFoundError("Kund hittades inte i din organisation");
  }
  if (data.objectId) {
    const [obj] = await db.select({ id: objects.id }).from(objects).where(and(eq(objects.id, data.objectId), eq(objects.tenantId, tenantId)));
    if (!obj) throw new NotFoundError("Objekt hittades inte i din organisation");
  }
  if (data.clusterId) {
    const [cl] = await db.select({ id: clusters.id }).from(clusters).where(and(eq(clusters.id, data.clusterId), eq(clusters.tenantId, tenantId)));
    if (!cl) throw new NotFoundError("Kluster hittades inte i din organisation");
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

  const mergedCustomerId = updateData.customerId !== undefined ? updateData.customerId : existing.customerId;
  const mergedObjectId = updateData.objectId !== undefined ? updateData.objectId : existing.objectId;
  const mergedClusterId = updateData.clusterId !== undefined ? updateData.clusterId : existing.clusterId;
  const scopeCount = [mergedCustomerId, mergedObjectId, mergedClusterId].filter(Boolean).length;
  if (scopeCount === 0) {
    throw new ValidationError("Välj exakt en av kund, objekt eller kluster");
  }
  if (scopeCount > 1) {
    throw new ValidationError("Välj exakt en av kund, objekt eller kluster — inte flera samtidigt");
  }

  if (mergedCustomerId) {
    const [cust] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, mergedCustomerId), eq(customers.tenantId, tenantId)));
    if (!cust) throw new NotFoundError("Kund hittades inte i din organisation");
  }
  if (mergedObjectId) {
    const [obj] = await db.select({ id: objects.id }).from(objects).where(and(eq(objects.id, mergedObjectId), eq(objects.tenantId, tenantId)));
    if (!obj) throw new NotFoundError("Objekt hittades inte i din organisation");
  }
  if (mergedClusterId) {
    const [cl] = await db.select({ id: clusters.id }).from(clusters).where(and(eq(clusters.id, mergedClusterId), eq(clusters.tenantId, tenantId)));
    if (!cl) throw new NotFoundError("Kluster hittades inte i din organisation");
  }

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

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface MonthlyDistribution {
  month: number;
  count: number;
}

interface GoalDistributionProposal {
  goalId: string;
  customerName: string | null;
  objectName: string | null;
  clusterName: string | null;
  articleType: string;
  targetCount: number;
  completedCount: number;
  remainingCount: number;
  currentDistribution: MonthlyDistribution[];
  proposedDistribution: MonthlyDistribution[];
  seasonRestriction: string | null;
  reasoning: string;
}

app.post("/api/annual-planning/ai-distribute", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { year, customerId, clusterId, startMonth, endMonth } = req.body;

  const targetYear = year || new Date().getFullYear();
  const periodStart = startMonth || 1;
  const periodEnd = endMonth || 12;

  if (periodStart < 1 || periodStart > 12 || periodEnd < 1 || periodEnd > 12 || periodEnd < periodStart) {
    throw new ValidationError("Ogiltig period. startMonth och endMonth måste vara 1-12, endMonth >= startMonth.");
  }

  const goalConditions: SQL[] = [
    eq(annualGoals.tenantId, tenantId),
    eq(annualGoals.year, targetYear),
    eq(annualGoals.status, "active"),
    isNull(annualGoals.deletedAt),
  ];
  if (customerId) goalConditions.push(eq(annualGoals.customerId, customerId));
  if (clusterId) goalConditions.push(eq(annualGoals.clusterId, clusterId));

  const goalsData = await db
    .select({
      id: annualGoals.id,
      tenantId: annualGoals.tenantId,
      customerId: annualGoals.customerId,
      objectId: annualGoals.objectId,
      clusterId: annualGoals.clusterId,
      articleType: annualGoals.articleType,
      targetCount: annualGoals.targetCount,
      year: annualGoals.year,
      sourceType: annualGoals.sourceType,
      sourceId: annualGoals.sourceId,
      customerName: customers.name,
      objectName: objects.name,
      clusterName: clusters.name,
    })
    .from(annualGoals)
    .leftJoin(customers, eq(annualGoals.customerId, customers.id))
    .leftJoin(objects, eq(annualGoals.objectId, objects.id))
    .leftJoin(clusters, eq(annualGoals.clusterId, clusters.id))
    .where(and(...goalConditions));

  if (goalsData.length === 0) {
    return res.json({ proposals: [], summary: "Inga aktiva mål hittades för vald period." });
  }

  const yearStart = new Date(targetYear, 0, 1);
  const yearEnd = new Date(targetYear, 11, 31, 23, 59, 59);

  const tenantResources = await db
    .select({ id: resources.id, weeklyHours: resources.weeklyHours })
    .from(resources)
    .where(and(eq(resources.tenantId, tenantId), eq(resources.status, "active"), isNull(resources.deletedAt)));

  const totalWeeklyCapacity = tenantResources.reduce((sum, r) => sum + (r.weeklyHours || 40), 0);
  const monthlyCapacityHours = (totalWeeklyCapacity * 52) / 12;

  const proposals: GoalDistributionProposal[] = [];

  for (const goal of goalsData) {
    const scopeConditions = buildGoalScopeConditions(tenantId, yearStart, yearEnd, goal.objectId, goal.customerId, goal.clusterId);

    const [completedResult] = await db
      .select({ count: sql<number>`count(distinct ${workOrders.id})::int` })
      .from(workOrders)
      .innerJoin(workOrderLines, eq(workOrders.id, workOrderLines.workOrderId))
      .innerJoin(articles, eq(workOrderLines.articleId, articles.id))
      .where(and(
        ...scopeConditions,
        eq(workOrders.executionStatus, "completed"),
        eq(articles.articleType, goal.articleType),
      ));
    const completedCount = completedResult?.count || 0;

    const existingOrders = await db
      .select({
        id: workOrders.id,
        scheduledDate: workOrders.scheduledDate,
        executionStatus: workOrders.executionStatus,
      })
      .from(workOrders)
      .innerJoin(workOrderLines, eq(workOrders.id, workOrderLines.workOrderId))
      .innerJoin(articles, eq(workOrderLines.articleId, articles.id))
      .where(and(
        ...scopeConditions,
        eq(articles.articleType, goal.articleType),
      ));

    const currentDistribution: MonthlyDistribution[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));
    for (const order of existingOrders) {
      if (order.scheduledDate) {
        const d = order.scheduledDate instanceof Date ? order.scheduledDate : new Date(order.scheduledDate);
        const m = d.getMonth();
        currentDistribution[m].count++;
      }
    }

    const remainingCount = Math.max(0, goal.targetCount - completedCount);

    let seasonRestriction: string | null = null;
    let subscriptionFrequency: FlexibleFrequency | null = null;
    let subscriptionPeriodicity: string | null = null;
    if (goal.sourceId && goal.sourceType === "subscription") {
      const [sub] = await db
        .select({
          activeSeason: subscriptions.activeSeason,
          flexibleFrequency: subscriptions.flexibleFrequency,
          periodicity: subscriptions.periodicity,
        })
        .from(subscriptions)
        .where(and(eq(subscriptions.id, goal.sourceId), eq(subscriptions.tenantId, tenantId)));
      if (sub) {
        if (sub.activeSeason) seasonRestriction = sub.activeSeason;
        subscriptionPeriodicity = sub.periodicity;
        if (sub.flexibleFrequency) {
          subscriptionFrequency = sub.flexibleFrequency as FlexibleFrequency;
          const freq = sub.flexibleFrequency as FlexibleFrequency & { season?: string };
          if (freq.season) seasonRestriction = freq.season;
        }
      }
    }

    const proposedDistribution: MonthlyDistribution[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));

    if (remainingCount > 0) {
      const periodStartDate = new Date(targetYear, periodStart - 1, 1);
      const periodEndDate = new Date(targetYear, periodEnd - 1 + 1, 0, 23, 59, 59);

      let frequency = subscriptionFrequency;
      if (!frequency && subscriptionPeriodicity) {
        frequency = convertLegacyPeriodicity(subscriptionPeriodicity);
      }
      if (frequency && seasonRestriction && !frequency.season) {
        frequency = { ...frequency, season: seasonRestriction };
      }

      if (frequency) {
        const scheduledDates = generateScheduleDates(frequency, periodStartDate, periodEndDate);
        for (const d of scheduledDates) {
          const m = d.getMonth();
          proposedDistribution[m].count++;
        }

        const totalScheduled = proposedDistribution.reduce((s, d) => s + d.count, 0);
        if (totalScheduled > remainingCount) {
          const scale = remainingCount / totalScheduled;
          let distributed = 0;
          for (let i = 0; i < 12; i++) {
            if (i === 11) {
              proposedDistribution[i].count = Math.max(0, remainingCount - distributed);
            } else {
              proposedDistribution[i].count = Math.round(proposedDistribution[i].count * scale);
              distributed += proposedDistribution[i].count;
            }
          }
        }
      } else {
        const allowedMonths: number[] = [];
        for (let m = periodStart; m <= periodEnd; m++) {
          const testDate = new Date(targetYear, m - 1, 15);
          if (!seasonRestriction || isDateInSeason(testDate, seasonRestriction as Season)) {
            allowedMonths.push(m);
          }
        }

        if (allowedMonths.length > 0) {
          const perMonth = Math.floor(remainingCount / allowedMonths.length);
          const remainder = remainingCount % allowedMonths.length;
          for (let i = 0; i < allowedMonths.length; i++) {
            proposedDistribution[allowedMonths[i] - 1].count = perMonth + (i < remainder ? 1 : 0);
          }
        }
      }

      const pendingPlannedInPeriod = existingOrders.filter(o => {
        if (!o.scheduledDate) return false;
        const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate);
        const m = d.getMonth() + 1;
        return m >= periodStart && m <= periodEnd && o.executionStatus !== "completed";
      }).length;

      if (pendingPlannedInPeriod > 0) {
        let toSubtract = pendingPlannedInPeriod;
        for (let i = 11; i >= 0 && toSubtract > 0; i--) {
          const sub = Math.min(proposedDistribution[i].count, toSubtract);
          proposedDistribution[i].count -= sub;
          toSubtract -= sub;
        }
      }
    }

    if (goal.objectId) {
      const restrictions = await db
        .select()
        .from(objectTimeRestrictions)
        .where(and(
          eq(objectTimeRestrictions.tenantId, tenantId),
          eq(objectTimeRestrictions.objectId, goal.objectId),
          eq(objectTimeRestrictions.isActive, true),
        ));
      if (restrictions.length > 0) {
        for (let mi = 0; mi < 12; mi++) {
          if (proposedDistribution[mi].count === 0) continue;
          const testDate = new Date(targetYear, mi, 15);
          for (const r of restrictions) {
            if (r.isBlockingAllDay) {
              if (r.validFromDate && r.validToDate) {
                if (testDate >= r.validFromDate && testDate <= r.validToDate) {
                  proposedDistribution[mi].count = 0;
                }
              }
            }
            if (r.weekdays && r.weekdays.length > 0 && r.weekdays.length <= 2) {
              proposedDistribution[mi].count = Math.max(0, Math.floor(proposedDistribution[mi].count * 0.5));
            }
          }
        }
      }
    }

    proposals.push({
      goalId: goal.id,
      customerName: goal.customerName,
      objectName: goal.objectName,
      clusterName: goal.clusterName,
      articleType: goal.articleType,
      targetCount: goal.targetCount,
      completedCount,
      remainingCount,
      currentDistribution,
      proposedDistribution,
      seasonRestriction,
      reasoning: "",
    });
  }

  const globalMonthTotals = new Array(12).fill(0);
  for (const p of proposals) {
    for (let i = 0; i < 12; i++) {
      globalMonthTotals[i] += p.proposedDistribution[i].count;
    }
  }

  const maxOrdersPerMonth = Math.ceil(monthlyCapacityHours / 1);
  for (let mi = 0; mi < 12; mi++) {
    if (globalMonthTotals[mi] > maxOrdersPerMonth && globalMonthTotals[mi] > 0) {
      const scale = maxOrdersPerMonth / globalMonthTotals[mi];
      for (const p of proposals) {
        p.proposedDistribution[mi].count = Math.floor(p.proposedDistribution[mi].count * scale);
      }
    }
  }

  let aiSummary = "";
  try {
    const goalsSummary = proposals.slice(0, 20).map(p => ({
      scope: p.customerName || p.objectName || p.clusterName || "Okänd",
      articleType: p.articleType,
      target: p.targetCount,
      completed: p.completedCount,
      remaining: p.remainingCount,
      season: p.seasonRestriction || "all_year",
      proposed: p.proposedDistribution.filter(d => d.count > 0).map(d => `M${d.month}:${d.count}`).join(","),
    }));

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Du är en fältservice-planerare i Sverige. Analysera besöksfördelningen och ge kort sammanfattning samt eventuella justeringsförslag. Svara i JSON: { \"summary\": \"...\", \"adjustments\": [{ \"goalIndex\": 0, \"reasoning\": \"...\", \"suggestedMonthlyChanges\": { \"3\": 2, \"6\": 1 } }] }. goalIndex refererar till index i listan. suggestedMonthlyChanges är { month: count } för justerade månader. Ge max 3 justeringar. Svara alltid på svenska.",
        },
        {
          role: "user",
          content: `Resurskapacitet: ${monthlyCapacityHours.toFixed(0)}h/månad med ${tenantResources.length} resurser.\n\nÅrsmål:\n${JSON.stringify(goalsSummary, null, 2)}\n\nAnalysera: Är fördelningen balanserad? Bör något justeras för att jämna ut arbetsbelastningen?`,
        },
      ],
      temperature: 0.5,
      max_tokens: 800,
      response_format: { type: "json_object" },
    });

    trackOpenAIResponse(aiResponse);
    const aiContent = JSON.parse(aiResponse.choices[0]?.message?.content || "{}");

    aiSummary = aiContent.summary || "";

    if (Array.isArray(aiContent.adjustments)) {
      for (const adj of aiContent.adjustments) {
        const idx = adj.goalIndex;
        if (typeof idx === "number" && idx >= 0 && idx < proposals.length && adj.suggestedMonthlyChanges) {
          const proposal = proposals[idx];
          proposal.reasoning = adj.reasoning || "";
          for (const [monthStr, count] of Object.entries(adj.suggestedMonthlyChanges)) {
            const m = parseInt(monthStr, 10);
            if (m >= 1 && m <= 12 && typeof count === "number" && count >= 0) {
              proposal.proposedDistribution[m - 1].count = count;
            }
          }
        }
      }
    }
  } catch (aiErr) {
    console.error("[ai-distribute] AI analysis failed, using balanced distribution:", aiErr);
    aiSummary = "AI-analys kunde inte genomföras. En jämn fördelning har beräknats baserat på frekvens och säsong.";
  }

  res.json({
    proposals,
    summary: aiSummary,
    year: targetYear,
    periodStart,
    periodEnd,
    resourceCount: tenantResources.length,
    monthlyCapacityHours: Math.round(monthlyCapacityHours),
  });
}));

const applyDistributionSchema = z.object({
  proposals: z.array(z.object({
    goalId: z.string().min(1),
    proposedDistribution: z.array(z.object({
      month: z.number().int().min(1).max(12),
      count: z.number().int().min(0).max(100),
    })),
  })).min(1).max(200),
  year: z.number().int().min(2020).max(2050),
});

app.post("/api/annual-planning/apply-distribution", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const approverUserId: string = (req as Express.Request & { userId?: string }).userId || "unknown";
  const parsed = applyDistributionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError("Ogiltigt förslag: " + parsed.error.issues.map(i => i.message).join(", "));
  }

  const { proposals, year: targetYear } = parsed.data;
  let totalCreated = 0;
  let totalMoved = 0;
  const appliedGoals: string[] = [];

  const globalMonthTotals = new Array(12).fill(0);
  for (const p of proposals) {
    for (const d of p.proposedDistribution) {
      globalMonthTotals[d.month - 1] += d.count;
    }
  }

  const tenantResources = await db
    .select({ id: resources.id, weeklyHours: resources.weeklyHours })
    .from(resources)
    .where(and(eq(resources.tenantId, tenantId), eq(resources.status, "active"), isNull(resources.deletedAt)));
  const totalWeeklyCapacity = tenantResources.reduce((sum, r) => sum + (r.weeklyHours || 40), 0);
  const monthlyCapacity = Math.ceil((totalWeeklyCapacity * 52) / 12);
  for (let mi = 0; mi < 12; mi++) {
    if (globalMonthTotals[mi] > monthlyCapacity) {
      throw new ValidationError(`Månad ${mi + 1} överskrider kapaciteten (${globalMonthTotals[mi]} > ${monthlyCapacity}). Justera förslaget.`);
    }
  }

  for (const proposal of proposals) {
    const { goalId, proposedDistribution } = proposal;

    const [goal] = await db
      .select()
      .from(annualGoals)
      .where(and(eq(annualGoals.id, goalId), eq(annualGoals.tenantId, tenantId), isNull(annualGoals.deletedAt)));
    if (!goal) continue;

    let objectId = goal.objectId;
    let customerIdForOrder = goal.customerId;
    const clusterId = goal.clusterId;

    if (!objectId && customerIdForOrder) {
      const [firstObj] = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), eq(objects.customerId, customerIdForOrder), isNull(objects.deletedAt)))
        .limit(1);
      if (firstObj) objectId = firstObj.id;
    }
    if (!objectId && clusterId) {
      const [firstObj] = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), sql`${objects.clusterId} = ${clusterId}`, isNull(objects.deletedAt)))
        .limit(1);
      if (firstObj) objectId = firstObj.id;
    }

    if (!objectId || !customerIdForOrder) {
      if (objectId && !customerIdForOrder) {
        const [obj] = await db.select({ customerId: objects.customerId }).from(objects).where(eq(objects.id, objectId));
        if (obj) customerIdForOrder = obj.customerId;
      }
      if (!objectId || !customerIdForOrder) continue;
    }

    const [matchingArticle] = await db
      .select({ id: articles.id, name: articles.name })
      .from(articles)
      .where(and(eq(articles.tenantId, tenantId), eq(articles.articleType, goal.articleType)))
      .limit(1);

    let targetObjectIds: string[] = [];
    if (goal.objectId) {
      targetObjectIds = [goal.objectId];
    } else if (customerIdForOrder) {
      const custObjects = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), eq(objects.customerId, customerIdForOrder), isNull(objects.deletedAt)));
      targetObjectIds = custObjects.map(o => o.id);
    } else if (clusterId) {
      const clusterObjects = await db
        .select({ id: objects.id })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), sql`${objects.clusterId} = ${clusterId}`, isNull(objects.deletedAt)));
      targetObjectIds = clusterObjects.map(o => o.id);
    }
    if (targetObjectIds.length === 0 && objectId) {
      targetObjectIds = [objectId];
    }
    if (targetObjectIds.length === 0) continue;

    let existingOrdersRaw = await db
      .select()
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, targetObjectIds),
        gte(workOrders.scheduledDate, new Date(targetYear, 0, 1)),
        lte(workOrders.scheduledDate, new Date(targetYear, 11, 31, 23, 59, 59)),
      ));

    if (matchingArticle) {
      const goalOrderIds = new Set<string>();
      const orderLines = await db
        .select({ workOrderId: workOrderLines.workOrderId })
        .from(workOrderLines)
        .where(and(
          eq(workOrderLines.tenantId, tenantId),
          eq(workOrderLines.articleId, matchingArticle.id),
          inArray(workOrderLines.workOrderId, existingOrdersRaw.map(o => o.id)),
        ));
      for (const line of orderLines) goalOrderIds.add(line.workOrderId);
      const goalMetadataIds = existingOrdersRaw
        .filter(o => (o.metadata as Record<string, unknown>)?.annualGoalId === goal.id)
        .map(o => o.id);
      for (const id of goalMetadataIds) goalOrderIds.add(id);
      existingOrdersRaw = existingOrdersRaw.filter(o => goalOrderIds.has(o.id));
    }

    const existingOrders = existingOrdersRaw;
    const completedOrders = existingOrders.filter(o => o.executionStatus === "completed");
    const movableOrders = existingOrders.filter(o => o.executionStatus !== "completed");

    const objectRestrictions = goal.objectId ? await db
      .select()
      .from(objectTimeRestrictions)
      .where(and(
        eq(objectTimeRestrictions.tenantId, tenantId),
        eq(objectTimeRestrictions.objectId, goal.objectId),
        eq(objectTimeRestrictions.isActive, true),
      )) : [];

    const completedByMonth = new Array(12).fill(0);
    for (const o of completedOrders) {
      if (!o.scheduledDate) continue;
      const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate);
      completedByMonth[d.getMonth()]++;
    }

    const targetByMonth = new Array(12).fill(0);
    for (const d of proposedDistribution) {
      targetByMonth[d.month - 1] = d.count + completedByMonth[d.month - 1];
    }

    const movablePool = [...movableOrders];
    const neededByMonth: number[] = new Array(12).fill(0);

    for (let mi = 0; mi < 12; mi++) {
      const existingInMonth = movableOrders.filter(o => {
        if (!o.scheduledDate) return false;
        const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate);
        return d.getMonth() === mi;
      }).length + completedByMonth[mi];

      const diff = targetByMonth[mi] - existingInMonth;
      if (diff > 0) {
        neededByMonth[mi] = diff;
      }
    }

    const excessOrders: typeof movableOrders = [];
    for (let mi = 0; mi < 12; mi++) {
      const ordersInMonth = movablePool.filter(o => {
        if (!o.scheduledDate) return false;
        const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate);
        return d.getMonth() === mi;
      });
      const currentMovable = ordersInMonth.length;
      const targetMovable = targetByMonth[mi] - completedByMonth[mi];
      if (currentMovable > targetMovable) {
        const toRemove = currentMovable - targetMovable;
        excessOrders.push(...ordersInMonth.slice(0, toRemove));
      }
    }

    for (let mi = 0; mi < 12; mi++) {
      while (neededByMonth[mi] > 0 && excessOrders.length > 0) {
        const orderToMove = excessOrders.shift()!;
        const dayInMonth = Math.min(28, Math.floor(Math.random() * 20) + 5);
        let newDate = new Date(targetYear, mi, dayInMonth, 12, 0, 0);
        const dow = newDate.getDay();
        if (dow === 0) newDate = new Date(newDate.getTime() + 86400000);
        if (dow === 6) newDate = new Date(newDate.getTime() + 2 * 86400000);

        let blocked = false;
        for (const r of objectRestrictions) {
          if (r.isBlockingAllDay && r.validFromDate && r.validToDate) {
            if (newDate >= r.validFromDate && newDate <= r.validToDate) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;

        await db.update(workOrders)
          .set({
            scheduledDate: newDate,
            metadata: {
              ...(orderToMove.metadata as Record<string, unknown> || {}),
              aiMoved: true,
              aiMovedAt: new Date().toISOString(),
              aiMovedBy: approverUserId,
              previousMonth: orderToMove.scheduledDate ? (orderToMove.scheduledDate instanceof Date ? orderToMove.scheduledDate.getMonth() + 1 : new Date(orderToMove.scheduledDate).getMonth() + 1) : null,
            },
          })
          .where(eq(workOrders.id, orderToMove.id));
        totalMoved++;
        neededByMonth[mi]--;
      }
    }

    for (let mi = 0; mi < 12; mi++) {
      const toCreate = neededByMonth[mi];
      if (toCreate <= 0) continue;

      for (let i = 0; i < toCreate; i++) {
        const dayInMonth = Math.min(28, Math.floor(((i + 1) / (toCreate + 1)) * 28) + 1);
        let scheduledDate = new Date(targetYear, mi, dayInMonth, 12, 0, 0);
        const dow = scheduledDate.getDay();
        if (dow === 0) scheduledDate = new Date(scheduledDate.getTime() + 86400000);
        if (dow === 6) scheduledDate = new Date(scheduledDate.getTime() + 2 * 86400000);

        let blocked = false;
        for (const r of objectRestrictions) {
          if (r.isBlockingAllDay && r.validFromDate && r.validToDate) {
            if (scheduledDate >= r.validFromDate && scheduledDate <= r.validToDate) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;

        const assignedObjectId = targetObjectIds[i % targetObjectIds.length];
        const orderData = {
          tenantId,
          customerId: customerIdForOrder!,
          objectId: assignedObjectId,
          clusterId: clusterId || undefined,
          title: `${goal.articleType} — AI-planerad (${targetYear}-${String(mi + 1).padStart(2, "0")})`,
          orderType: "service",
          priority: "normal",
          status: "draft",
          orderStatus: "skapad" as const,
          executionStatus: "not_planned",
          creationMethod: "automatic",
          scheduledDate,
          estimatedDuration: 60,
          isSimulated: false,
          metadata: {
            aiDistributed: true,
            aiDistributedAt: new Date().toISOString(),
            annualGoalId: goal.id,
            approvedBy: approverUserId,
            approvedAt: new Date().toISOString(),
          },
        };

        const [created] = await db.insert(workOrders).values(orderData).returning();
        totalCreated++;

        if (matchingArticle) {
          await db.insert(workOrderLines).values({
            tenantId,
            workOrderId: created.id,
            articleId: matchingArticle.id,
            quantity: 1,
            resolvedPrice: 0,
            resolvedCost: 0,
            resolvedProductionMinutes: 60,
            priceSource: "ai-distribution",
          });
        }
      }
    }

    appliedGoals.push(goalId);
  }

  res.json({
    created: totalCreated,
    moved: totalMoved,
    goalsProcessed: appliedGoals.length,
    appliedGoalIds: appliedGoals,
  });
}));

}
