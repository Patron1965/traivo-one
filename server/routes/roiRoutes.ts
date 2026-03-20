import type { Express } from "express";
import { db } from "../db";
import { eq, and, gte, lte, sql, count, sum, avg, desc, inArray, or } from "drizzle-orm";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { workOrders, environmentalData, deviationReports, customers, objects, roiShareTokens } from "@shared/schema";
import crypto from "crypto";

interface MonthlyMetrics {
  month: string;
  completedOrders: number;
  totalOrders: number;
  completionRate: number;
  avgDurationMinutes: number;
  avgSetupTimeMinutes: number;
  totalDistanceKm: number;
  totalCo2Kg: number;
  totalFuelLiters: number;
  deviationCount: number;
  totalValue: number;
  totalCost: number;
  productivityPerResource: number;
}

export async function registerRoiRoutes(app: Express) {

  app.get("/api/reports/roi/:customerId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;
    const monthsBack = parseInt(req.query.months as string) || 12;

    const [customer] = await db.select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new ValidationError("Kund hittades inte");

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    const now = new Date();

    const orders = await db
      .select({
        id: workOrders.id,
        scheduledDate: workOrders.scheduledDate,
        completedAt: workOrders.completedAt,
        actualDuration: workOrders.actualDuration,
        estimatedDuration: workOrders.estimatedDuration,
        setupTime: workOrders.setupTime,
        cachedValue: workOrders.cachedValue,
        cachedCost: workOrders.cachedCost,
        cachedProductionMinutes: workOrders.cachedProductionMinutes,
        executionStatus: workOrders.executionStatus,
        resourceId: workOrders.resourceId,
      })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.customerId, customerId),
        gte(workOrders.scheduledDate, cutoff),
      ));

    const envData = await db
      .select({
        distanceKm: environmentalData.distanceKm,
        co2Kg: environmentalData.co2Kg,
        fuelLiters: environmentalData.fuelLiters,
        recordedAt: environmentalData.recordedAt,
        workOrderId: environmentalData.workOrderId,
      })
      .from(environmentalData)
      .where(and(
        eq(environmentalData.tenantId, tenantId),
        gte(environmentalData.recordedAt, cutoff),
      ));

    const orderIds = new Set(orders.map(o => o.id));
    const orderIdList = [...orderIds];
    const customerEnvData = envData.filter(e => orderIds.has(e.workOrderId));

    const customerObjects = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), eq(objects.customerId, customerId)));
    const customerObjectIds = customerObjects.map(o => o.id);

    const customerDeviations = (customerObjectIds.length > 0 || orderIdList.length > 0)
      ? await db
        .select({
          id: deviationReports.id,
          reportedAt: deviationReports.reportedAt,
          category: deviationReports.category,
          severityLevel: deviationReports.severityLevel,
        })
        .from(deviationReports)
        .where(and(
          eq(deviationReports.tenantId, tenantId),
          gte(deviationReports.reportedAt, cutoff),
          or(
            customerObjectIds.length > 0 ? inArray(deviationReports.objectId, customerObjectIds) : undefined,
            orderIdList.length > 0 ? inArray(deviationReports.workOrderId, orderIdList) : undefined,
          ),
        ))
      : [];

    const resourceIds = [...new Set(orders.filter(o => o.resourceId).map(o => o.resourceId!))];
    const activeResources = resourceIds.length;

    const completedOrders = orders.filter(o => o.executionStatus === "completed" || o.executionStatus === "inspected" || o.executionStatus === "invoiced");
    const totalOrders = orders.length;
    const completionRate = totalOrders > 0 ? Math.round((completedOrders.length / totalOrders) * 100) : 0;

    const avgActualDuration = completedOrders.length > 0
      ? Math.round(completedOrders.reduce((s, o) => s + (o.actualDuration || o.estimatedDuration || 60), 0) / completedOrders.length)
      : 0;
    const avgEstimatedDuration = completedOrders.length > 0
      ? Math.round(completedOrders.reduce((s, o) => s + (o.estimatedDuration || 60), 0) / completedOrders.length)
      : 0;
    const avgSetupTime = completedOrders.length > 0
      ? Math.round(completedOrders.reduce((s, o) => s + (o.setupTime || 0), 0) / completedOrders.length)
      : 0;

    const totalDistanceKm = Math.round(customerEnvData.reduce((s, e) => s + (e.distanceKm || 0), 0) * 10) / 10;
    const totalCo2Kg = Math.round(customerEnvData.reduce((s, e) => s + (e.co2Kg || 0), 0) * 10) / 10;
    const totalFuelLiters = Math.round(customerEnvData.reduce((s, e) => s + (e.fuelLiters || 0), 0) * 10) / 10;

    const totalValue = orders.reduce((s, o) => s + (o.cachedValue || 0), 0);
    const totalCost = orders.reduce((s, o) => s + (o.cachedCost || 0), 0);

    const monthlyMap = new Map<string, {
      completed: number; total: number; durations: number[]; setupTimes: number[];
      distKm: number; co2: number; fuel: number; devCount: number; value: number; cost: number;
      resourceSet: Set<string>;
    }>();

    for (const o of orders) {
      if (!o.scheduledDate) continue;
      const monthKey = o.scheduledDate.toISOString().substring(0, 7);
      if (!monthlyMap.has(monthKey)) monthlyMap.set(monthKey, { completed: 0, total: 0, durations: [], setupTimes: [], distKm: 0, co2: 0, fuel: 0, devCount: 0, value: 0, cost: 0, resourceSet: new Set() });
      const m = monthlyMap.get(monthKey)!;
      m.total++;
      if (o.executionStatus === "completed" || o.executionStatus === "inspected" || o.executionStatus === "invoiced") {
        m.completed++;
        m.durations.push(o.actualDuration || o.estimatedDuration || 60);
        m.setupTimes.push(o.setupTime || 0);
      }
      m.value += o.cachedValue || 0;
      m.cost += o.cachedCost || 0;
      if (o.resourceId) m.resourceSet.add(o.resourceId);
    }

    for (const e of customerEnvData) {
      if (!e.recordedAt) continue;
      const monthKey = e.recordedAt.toISOString().substring(0, 7);
      const m = monthlyMap.get(monthKey);
      if (m) {
        m.distKm += e.distanceKm || 0;
        m.co2 += e.co2Kg || 0;
        m.fuel += e.fuelLiters || 0;
      }
    }

    for (const d of customerDeviations) {
      if (!d.reportedAt) continue;
      const monthKey = d.reportedAt.toISOString().substring(0, 7);
      const m = monthlyMap.get(monthKey);
      if (m) m.devCount++;
    }

    const monthly: MonthlyMetrics[] = [...monthlyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        completedOrders: m.completed,
        totalOrders: m.total,
        completionRate: m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0,
        avgDurationMinutes: m.durations.length > 0 ? Math.round(m.durations.reduce((s, v) => s + v, 0) / m.durations.length) : 0,
        avgSetupTimeMinutes: m.setupTimes.length > 0 ? Math.round(m.setupTimes.reduce((s, v) => s + v, 0) / m.setupTimes.length) : 0,
        totalDistanceKm: Math.round(m.distKm * 10) / 10,
        totalCo2Kg: Math.round(m.co2 * 10) / 10,
        totalFuelLiters: Math.round(m.fuel * 10) / 10,
        deviationCount: m.devCount,
        totalValue: m.value,
        totalCost: m.cost,
        productivityPerResource: m.resourceSet.size > 0 ? Math.round(m.completed / m.resourceSet.size * 10) / 10 : 0,
      }));

    const efficiencyGain = avgEstimatedDuration > 0 && avgActualDuration > 0
      ? Math.round(((avgEstimatedDuration - avgActualDuration) / avgEstimatedDuration) * 100)
      : 0;

    const firstHalf = monthly.slice(0, Math.floor(monthly.length / 2));
    const secondHalf = monthly.slice(Math.floor(monthly.length / 2));
    const avgSetupFirst = firstHalf.length > 0 ? firstHalf.reduce((s, m) => s + m.avgSetupTimeMinutes, 0) / firstHalf.length : 0;
    const avgSetupSecond = secondHalf.length > 0 ? secondHalf.reduce((s, m) => s + m.avgSetupTimeMinutes, 0) / secondHalf.length : 0;
    const setupTimeReduction = avgSetupFirst > 0 ? Math.round(((avgSetupFirst - avgSetupSecond) / avgSetupFirst) * 100) : 0;

    const avgDistFirst = firstHalf.length > 0 ? firstHalf.reduce((s, m) => s + m.totalDistanceKm, 0) / firstHalf.length : 0;
    const avgDistSecond = secondHalf.length > 0 ? secondHalf.reduce((s, m) => s + m.totalDistanceKm, 0) / secondHalf.length : 0;
    const distanceReductionPercent = avgDistFirst > 0 ? Math.round(((avgDistFirst - avgDistSecond) / avgDistFirst) * 100) : 0;
    const distanceSavedKm = Math.round((avgDistFirst - avgDistSecond) * secondHalf.length * 10) / 10;

    const avgCo2First = firstHalf.length > 0 ? firstHalf.reduce((s, m) => s + m.totalCo2Kg, 0) / firstHalf.length : 0;
    const avgCo2Second = secondHalf.length > 0 ? secondHalf.reduce((s, m) => s + m.totalCo2Kg, 0) / secondHalf.length : 0;
    const co2ReductionPercent = avgCo2First > 0 ? Math.round(((avgCo2First - avgCo2Second) / avgCo2First) * 100) : 0;
    const co2SavedKg = Math.round((avgCo2First - avgCo2Second) * secondHalf.length * 10) / 10;

    const productivityPerResource = activeResources > 0
      ? Math.round((completedOrders.length / activeResources) * 10) / 10
      : 0;

    const uniqueWorkDays = new Set(completedOrders.filter(o => o.scheduledDate).map(o => o.scheduledDate!.toISOString().substring(0, 10))).size;
    const weeks = monthsBack * 4.33;
    const productivityPerDay = uniqueWorkDays > 0 ? Math.round((completedOrders.length / uniqueWorkDays) * 10) / 10 : 0;
    const productivityPerWeek = weeks > 0 ? Math.round((completedOrders.length / weeks) * 10) / 10 : 0;

    const deviationTrend = firstHalf.length > 0 && secondHalf.length > 0
      ? {
        firstPeriodAvg: Math.round(firstHalf.reduce((s, m) => s + m.deviationCount, 0) / firstHalf.length * 10) / 10,
        secondPeriodAvg: Math.round(secondHalf.reduce((s, m) => s + m.deviationCount, 0) / secondHalf.length * 10) / 10,
      }
      : null;

    res.json({
      customer: { id: customer.id, name: customer.name },
      period: { from: cutoff.toISOString(), to: now.toISOString(), months: monthsBack },
      summary: {
        totalOrders,
        completedOrders: completedOrders.length,
        completionRate,
        avgActualDurationMinutes: avgActualDuration,
        avgEstimatedDurationMinutes: avgEstimatedDuration,
        avgSetupTimeMinutes: avgSetupTime,
        efficiencyGainPercent: efficiencyGain,
        setupTimeReductionPercent: setupTimeReduction,
        totalDistanceKm,
        totalCo2Kg,
        totalFuelLiters,
        distanceBaseline: { firstHalfAvgKm: Math.round(avgDistFirst * 10) / 10, secondHalfAvgKm: Math.round(avgDistSecond * 10) / 10 },
        distanceReductionPercent,
        distanceSavedKm,
        co2Baseline: { firstHalfAvgKg: Math.round(avgCo2First * 10) / 10, secondHalfAvgKg: Math.round(avgCo2Second * 10) / 10 },
        co2ReductionPercent,
        co2SavedKg,
        totalValue,
        totalCost,
        activeResources,
        productivityPerResource,
        productivityPerDay,
        productivityPerWeek,
        deviationCount: customerDeviations.length,
        deviationTrend,
        setupTimeBaseline: { firstHalfAvgMinutes: Math.round(avgSetupFirst * 10) / 10, secondHalfAvgMinutes: Math.round(avgSetupSecond * 10) / 10 },
      },
      monthly,
    });
  }));

  app.get("/api/reports/roi-customers", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const customerList = await db
      .select({
        id: customers.id,
        name: customers.name,
        orderCount: sql<number>`count(${workOrders.id})::int`,
      })
      .from(customers)
      .leftJoin(workOrders, and(
        eq(workOrders.customerId, customers.id),
        eq(workOrders.tenantId, tenantId),
      ))
      .where(eq(customers.tenantId, tenantId))
      .groupBy(customers.id, customers.name)
      .orderBy(desc(sql`count(${workOrders.id})`));

    res.json(customerList);
  }));

  app.post("/api/reports/roi/:customerId/share", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;

    const [customer] = await db.select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new ValidationError("Kund hittades inte");

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await db.insert(roiShareTokens).values({ token, tenantId, customerId, expiresAt });

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
    const shareUrl = `${baseUrl}/portal/roi-report?token=${token}`;

    res.json({ shareUrl, expiresAt: expiresAt.toISOString(), token });
  }));

  app.get("/api/portal/roi-shared", asyncHandler(async (req, res) => {
    const token = req.query.token as string;
    if (!token) throw new ValidationError("Token saknas");

    const [shareData] = await db.select()
      .from(roiShareTokens)
      .where(eq(roiShareTokens.token, token));
    if (!shareData) throw new ValidationError("Ogiltig eller utgången delningslänk");
    if (new Date() > shareData.expiresAt) {
      await db.delete(roiShareTokens).where(eq(roiShareTokens.token, token));
      throw new ValidationError("Delningslänken har utgått");
    }

    const { tenantId, customerId } = shareData;
    const months = parseInt(req.query.months as string) || 12;

    const [customer] = await db.select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
    if (!customer) throw new ValidationError("Kund hittades inte");

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const orders = await db
      .select({
        id: workOrders.id,
        scheduledDate: workOrders.scheduledDate,
        actualDuration: workOrders.actualDuration,
        estimatedDuration: workOrders.estimatedDuration,
        setupTime: workOrders.setupTime,
        cachedValue: workOrders.cachedValue,
        executionStatus: workOrders.executionStatus,
      })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.customerId, customerId),
        gte(workOrders.scheduledDate, cutoff),
      ));

    const customerOrderIds = orders.map(o => o.id);
    const envData = customerOrderIds.length > 0
      ? await db
        .select({
          distanceKm: environmentalData.distanceKm,
          co2Kg: environmentalData.co2Kg,
        })
        .from(environmentalData)
        .where(and(
          eq(environmentalData.tenantId, tenantId),
          inArray(environmentalData.workOrderId, customerOrderIds),
        ))
      : [];

    const completedOrders = orders.filter(o => o.executionStatus === "completed" || o.executionStatus === "inspected" || o.executionStatus === "invoiced");
    const completionRate = orders.length > 0 ? Math.round((completedOrders.length / orders.length) * 100) : 0;
    const avgDuration = completedOrders.length > 0
      ? Math.round(completedOrders.reduce((s, o) => s + (o.actualDuration || o.estimatedDuration || 60), 0) / completedOrders.length)
      : 0;
    const avgEstimatedDuration = completedOrders.length > 0
      ? Math.round(completedOrders.reduce((s, o) => s + (o.estimatedDuration || 60), 0) / completedOrders.length)
      : 0;
    const efficiencyGain = avgEstimatedDuration > 0 && avgDuration > 0
      ? Math.round(((avgEstimatedDuration - avgDuration) / avgEstimatedDuration) * 100)
      : 0;
    const totalDistanceKm = Math.round(envData.reduce((s, e) => s + (e.distanceKm || 0), 0) * 10) / 10;
    const totalCo2Kg = Math.round(envData.reduce((s, e) => s + (e.co2Kg || 0), 0) * 10) / 10;

    res.json({
      customer: { name: customer.name },
      summary: {
        totalOrders: orders.length,
        completedOrders: completedOrders.length,
        completionRate,
        avgDurationMinutes: avgDuration,
        efficiencyGainPercent: efficiencyGain,
        totalDistanceKm,
        totalCo2Kg,
      },
    });
  }));

}
