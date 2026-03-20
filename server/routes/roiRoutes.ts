import type { Express } from "express";
import { db } from "../db";
import { eq, and, gte, lte, sql, count, sum, avg, desc } from "drizzle-orm";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { workOrders, environmentalData, deviationReports, resources, customers, routeFeedback } from "@shared/schema";

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
    const customerEnvData = envData.filter(e => orderIds.has(e.workOrderId));

    const deviations = await db
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
      ));

    const customerObjectOrders = orders.map(o => o.id);
    const orderDeviations = deviations.filter(d => {
      return true;
    });

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

    for (const d of orderDeviations) {
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

    const productivityPerResource = activeResources > 0
      ? Math.round((completedOrders.length / activeResources) * 10) / 10
      : 0;

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
        totalValue,
        totalCost,
        activeResources,
        productivityPerResource,
        deviationCount: orderDeviations.length,
        deviationTrend,
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

}
