import { db } from "../db";
import { and, eq, gte, isNull, lte, inArray, sql } from "drizzle-orm";
import {
  annualGoals,
  articles,
  clusters,
  resources,
  workOrders,
  workOrderLines,
  objects,
  subscriptions,
  clusterCapacityForecast,
  type Cluster,
  type Resource,
} from "@shared/schema";
import { isDateInSeason } from "../scheduling-utils";
import type { Season } from "@shared/schema";
import { fetchWeatherForecast, getCapacityAdjustmentForDate, type WeatherImpact } from "../weather-service";

export const FORECAST_WINDOWS = [8, 12, 26] as const;
export type ForecastWindow = typeof FORECAST_WINDOWS[number];

const PERIODICITY_TO_YEARLY: Record<string, number> = {
  vecka: 52,
  varannan_vecka: 26,
  manad: 12,
  kvartal: 4,
  halvar: 2,
  ar: 1,
};

const DEFAULT_PRODUCTION_MINUTES = 30;

export interface ClusterWeekForecast {
  weekStart: string;
  demandHours: number;
  capacityHours: number;
  gapHours: number;
  weatherMultiplier: number;
}

export interface ClusterForecastSummary {
  clusterId: string;
  clusterName: string;
  weeks: ClusterWeekForecast[];
  totalDemand: number;
  totalCapacity: number;
  totalGap: number;
}

export interface RebalanceSuggestion {
  fromClusterId: string;
  fromClusterName: string;
  toClusterId: string;
  toClusterName: string;
  weekStart: string;
  weekStartEnd?: string;
  fteShift: number;
  hours: number;
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function loadAvgArticleMinutes(tenantId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const rows = await db
    .select({
      articleType: articles.articleType,
      avg: sql<number>`AVG(${workOrders.actualDuration})::float`,
    })
    .from(workOrders)
    .innerJoin(workOrderLines, eq(workOrderLines.workOrderId, workOrders.id))
    .innerJoin(articles, eq(articles.id, workOrderLines.articleId))
    .where(and(
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.executionStatus, "completed"),
      isNull(workOrders.deletedAt),
      sql`${workOrders.actualDuration} IS NOT NULL AND ${workOrders.actualDuration} > 0`,
    ))
    .groupBy(articles.articleType);

  for (const r of rows) {
    if (r.avg && r.avg > 0) map.set(r.articleType, r.avg);
  }

  const fallbackRows = await db
    .select({
      articleType: articles.articleType,
      avg: sql<number>`AVG(${articles.productionTime})::float`,
    })
    .from(articles)
    .where(and(eq(articles.tenantId, tenantId), isNull(articles.deletedAt)))
    .groupBy(articles.articleType);

  for (const r of fallbackRows) {
    if (!map.has(r.articleType) && r.avg && r.avg > 0) {
      map.set(r.articleType, r.avg);
    }
  }
  return map;
}

export interface GoalRow {
  id: string;
  customerId: string | null;
  objectId: string | null;
  clusterId: string | null;
  articleType: string;
  targetCount: number;
  year: number;
  sourceType: string | null;
  sourceId: string | null;
}

export function resolveGoalsToClustersPure(
  goals: GoalRow[],
  objectClusterMap: Map<string, string | null>,
  customerClusterMap: Map<string, string[]>,
): Map<string, GoalRow[]> {
  const byCluster = new Map<string, GoalRow[]>();

  const push = (clusterId: string, goal: GoalRow) => {
    if (!byCluster.has(clusterId)) byCluster.set(clusterId, []);
    byCluster.get(clusterId)!.push(goal);
  };

  for (const goal of goals) {
    if (goal.clusterId) {
      push(goal.clusterId, goal);
    } else if (goal.objectId) {
      const cid = objectClusterMap.get(goal.objectId);
      if (cid) push(cid, goal);
    } else if (goal.customerId) {
      const cids = customerClusterMap.get(goal.customerId) || [];
      if (cids.length > 0) {
        const share = goal.targetCount / cids.length;
        for (const cid of cids) {
          push(cid, { ...goal, targetCount: share });
        }
      }
    }
  }

  return byCluster;
}

async function resolveGoalsToClusters(
  tenantId: string,
  goals: GoalRow[],
): Promise<Map<string, GoalRow[]>> {
  const objectIds = goals.filter(g => g.objectId).map(g => g.objectId!) as string[];
  const customerIds = goals.filter(g => !g.objectId && !g.clusterId && g.customerId).map(g => g.customerId!) as string[];

  const objectClusterMap = new Map<string, string | null>();
  if (objectIds.length > 0) {
    const rows = await db
      .select({ id: objects.id, clusterId: objects.clusterId })
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, objectIds)));
    for (const r of rows) objectClusterMap.set(r.id, r.clusterId);
  }

  const customerClusterMap = new Map<string, string[]>();
  if (customerIds.length > 0) {
    const rows = await db
      .select({ customerId: objects.customerId, clusterId: objects.clusterId })
      .from(objects)
      .where(and(
        eq(objects.tenantId, tenantId),
        inArray(objects.customerId, customerIds),
        isNull(objects.deletedAt),
        sql`${objects.clusterId} IS NOT NULL`,
      ));
    for (const r of rows) {
      if (!r.clusterId) continue;
      if (!customerClusterMap.has(r.customerId)) customerClusterMap.set(r.customerId, []);
      const arr = customerClusterMap.get(r.customerId)!;
      if (!arr.includes(r.clusterId)) arr.push(r.clusterId);
    }
  }

  return resolveGoalsToClustersPure(goals, objectClusterMap, customerClusterMap);
}

async function getSubscriptionSeasons(tenantId: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: subscriptions.id, activeSeason: subscriptions.activeSeason })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), isNull(subscriptions.deletedAt)));
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.id, r.activeSeason ?? null);
  return map;
}

export function computeClusterCapacityPure(
  clusterList: Cluster[],
  allResources: Resource[],
): Map<string, number> {
  const result = new Map<string, number>();
  if (clusterList.length === 0) return result;

  for (const cluster of clusterList) {
    const clusterPostalCodes = new Set<string>(cluster.postalCodes ?? []);
    let weeklyHours = 0;
    let matched = 0;
    for (const r of allResources) {
      const area = (r.serviceArea ?? []) as string[];
      const overlap = clusterPostalCodes.size > 0 && area.some(p => clusterPostalCodes.has(p));
      if (overlap) {
        const hours = (r.weeklyHours ?? 40) * (r.efficiencyFactor ?? 1.0);
        weeklyHours += hours;
        matched++;
      }
    }
    if (matched === 0) {
      // Fallback: even share of all resources across clusters
      const totalWeekly = allResources.reduce((s, r) => s + (r.weeklyHours ?? 40) * (r.efficiencyFactor ?? 1.0), 0);
      weeklyHours = totalWeekly / clusterList.length;
    }
    result.set(cluster.id, weeklyHours);
  }
  return result;
}

async function loadClusterCapacity(
  tenantId: string,
  clusterList: Cluster[],
): Promise<Map<string, number>> {
  const allResources: Resource[] = await db
    .select()
    .from(resources)
    .where(and(
      eq(resources.tenantId, tenantId),
      eq(resources.status, "active"),
      isNull(resources.deletedAt),
    ));

  return computeClusterCapacityPure(clusterList, allResources);
}

interface ClusterCenter {
  latitude: number;
  longitude: number;
}

async function resolveClusterCenters(
  tenantId: string,
  clusterList: Cluster[],
): Promise<Map<string, ClusterCenter>> {
  const result = new Map<string, ClusterCenter>();
  const missing: Cluster[] = [];

  for (const c of clusterList) {
    if (c.centerLatitude != null && c.centerLongitude != null) {
      result.set(c.id, { latitude: c.centerLatitude, longitude: c.centerLongitude });
    } else {
      missing.push(c);
    }
  }

  if (missing.length > 0) {
    const missingIds = missing.map(c => c.id);
    const rows = await db
      .select({
        clusterId: objects.clusterId,
        latitude: objects.latitude,
        longitude: objects.longitude,
      })
      .from(objects)
      .where(and(
        eq(objects.tenantId, tenantId),
        inArray(objects.clusterId, missingIds),
        isNull(objects.deletedAt),
        sql`${objects.latitude} IS NOT NULL AND ${objects.longitude} IS NOT NULL`,
      ));

    const sums = new Map<string, { lat: number; lng: number; n: number }>();
    for (const r of rows) {
      if (!r.clusterId || r.latitude == null || r.longitude == null) continue;
      const s = sums.get(r.clusterId) ?? { lat: 0, lng: 0, n: 0 };
      s.lat += r.latitude;
      s.lng += r.longitude;
      s.n += 1;
      sums.set(r.clusterId, s);
    }
    sums.forEach((s, cid) => {
      if (s.n > 0) {
        result.set(cid, { latitude: s.lat / s.n, longitude: s.lng / s.n });
      }
    });
  }

  return result;
}

async function getWeatherMultipliersForWeeks(
  weekStarts: Date[],
  clusterList: Cluster[],
  centers: Map<string, ClusterCenter>,
  tenantId: string,
): Promise<Map<string, Map<string, number>>> {
  const byCluster = new Map<string, Map<string, number>>();

  await Promise.all(clusterList.map(async (cluster) => {
    const weekMap = new Map<string, number>();
    byCluster.set(cluster.id, weekMap);

    const center = centers.get(cluster.id);
    let impacts: WeatherImpact[] = [];
    if (center) {
      try {
        const result = await fetchWeatherForecast(center.latitude, center.longitude, 16, tenantId);
        impacts = result.impacts;
      } catch {
        impacts = [];
      }
    }

    for (const ws of weekStarts) {
      let total = 0;
      let count = 0;
      for (let i = 0; i < 7; i++) {
        const dateStr = addDays(ws, i).toISOString().slice(0, 10);
        total += getCapacityAdjustmentForDate(impacts, dateStr);
        count += 1;
      }
      weekMap.set(ws.toISOString(), count > 0 ? total / count : 1.0);
    }
  }));

  return byCluster;
}

export function computeWeekDemandHours(
  goals: GoalRow[],
  weekStart: Date,
  avgMinutesByType: Map<string, number>,
  subscriptionSeasons: Map<string, string | null>,
): number {
  let demandHours = 0;
  const year = weekStart.getFullYear();

  for (const goal of goals) {
    if (goal.year !== year) continue;
    const minutesPerUnit = avgMinutesByType.get(goal.articleType) ?? DEFAULT_PRODUCTION_MINUTES;

    let season: string | null = null;
    if (goal.sourceType === "subscription" && goal.sourceId) {
      season = subscriptionSeasons.get(goal.sourceId) ?? null;
    }

    let inSeasonWeeks = 52;
    if (season && season !== "all_year") {
      inSeasonWeeks = 0;
      for (let m = 0; m < 12; m++) {
        const probe = new Date(year, m, 15);
        if (isDateInSeason(probe, season as Season)) inSeasonWeeks += 52 / 12;
      }
    }
    const weekInSeason = isDateInSeason(weekStart, (season ?? "all_year") as Season);
    if (!weekInSeason) continue;

    const weeklyShare = goal.targetCount / Math.max(inSeasonWeeks, 1);
    demandHours += (weeklyShare * minutesPerUnit) / 60;
  }
  return demandHours;
}

export interface ComputedForecastResult {
  clusters: ClusterForecastSummary[];
  computedAt: Date;
}

export async function computeCapacityForecast(
  tenantId: string,
  windowWeeks: number = 12,
): Promise<ComputedForecastResult> {
  const clusterList: Cluster[] = await db
    .select()
    .from(clusters)
    .where(and(
      eq(clusters.tenantId, tenantId),
      eq(clusters.status, "active"),
      isNull(clusters.deletedAt),
    ));

  const today = new Date();
  const firstWeek = startOfIsoWeek(today);
  const weekStarts: Date[] = [];
  for (let w = 0; w < windowWeeks; w++) weekStarts.push(addDays(firstWeek, w * 7));

  if (clusterList.length === 0) {
    return { clusters: [], computedAt: new Date() };
  }

  const centers = await resolveClusterCenters(tenantId, clusterList);

  const [avgMinutesByType, capacityByCluster, weatherByCluster] = await Promise.all([
    loadAvgArticleMinutes(tenantId),
    loadClusterCapacity(tenantId, clusterList),
    getWeatherMultipliersForWeeks(weekStarts, clusterList, centers, tenantId),
  ]);

  const yearsInWindow = new Set<number>();
  for (const ws of weekStarts) yearsInWindow.add(ws.getFullYear());

  const goalRows = await db
    .select({
      id: annualGoals.id,
      customerId: annualGoals.customerId,
      objectId: annualGoals.objectId,
      clusterId: annualGoals.clusterId,
      articleType: annualGoals.articleType,
      targetCount: annualGoals.targetCount,
      year: annualGoals.year,
      sourceType: annualGoals.sourceType,
      sourceId: annualGoals.sourceId,
    })
    .from(annualGoals)
    .where(and(
      eq(annualGoals.tenantId, tenantId),
      eq(annualGoals.status, "active"),
      isNull(annualGoals.deletedAt),
      inArray(annualGoals.year, Array.from(yearsInWindow)),
    ));

  const goalsByCluster = await resolveGoalsToClusters(tenantId, goalRows as GoalRow[]);
  const subscriptionSeasons = await getSubscriptionSeasons(tenantId);

  const summaries: ClusterForecastSummary[] = [];

  for (const cluster of clusterList) {
    const goals = goalsByCluster.get(cluster.id) ?? [];
    const baseCapacity = capacityByCluster.get(cluster.id) ?? 0;

    const clusterWeather = weatherByCluster.get(cluster.id);
    const weekRecords: ClusterWeekForecast[] = weekStarts.map(ws => {
      const weatherMul = clusterWeather?.get(ws.toISOString()) ?? 1.0;
      const capacityHours = baseCapacity * weatherMul;

      const demandHours = computeWeekDemandHours(goals, ws, avgMinutesByType, subscriptionSeasons);

      return {
        weekStart: ws.toISOString(),
        demandHours: Math.round(demandHours * 10) / 10,
        capacityHours: Math.round(capacityHours * 10) / 10,
        gapHours: Math.round((demandHours - capacityHours) * 10) / 10,
        weatherMultiplier: Math.round(weatherMul * 100) / 100,
      };
    });

    summaries.push({
      clusterId: cluster.id,
      clusterName: cluster.name,
      weeks: weekRecords,
      totalDemand: Math.round(weekRecords.reduce((s, w) => s + w.demandHours, 0) * 10) / 10,
      totalCapacity: Math.round(weekRecords.reduce((s, w) => s + w.capacityHours, 0) * 10) / 10,
      totalGap: Math.round(weekRecords.reduce((s, w) => s + w.gapHours, 0) * 10) / 10,
    });
  }

  return { clusters: summaries, computedAt: new Date() };
}

export async function computeAndCacheForecast(
  tenantId: string,
  windowWeeks: number = 26,
): Promise<ComputedForecastResult> {
  const result = await computeCapacityForecast(tenantId, windowWeeks);
  await db.delete(clusterCapacityForecast).where(eq(clusterCapacityForecast.tenantId, tenantId));
  const rows: typeof clusterCapacityForecast.$inferInsert[] = [];
  for (const c of result.clusters) {
    for (const w of c.weeks) {
      rows.push({
        tenantId,
        clusterId: c.clusterId,
        weekStart: new Date(w.weekStart),
        demandHours: w.demandHours,
        capacityHours: w.capacityHours,
        gapHours: w.gapHours,
        weatherMultiplier: w.weatherMultiplier,
      });
    }
  }
  if (rows.length > 0) {
    await db.insert(clusterCapacityForecast).values(rows);
  }
  return result;
}

export async function loadCachedForecast(
  tenantId: string,
  windowWeeks: number = 12,
): Promise<ComputedForecastResult | null> {
  const today = new Date();
  const firstWeek = startOfIsoWeek(today);
  const lastWeek = addDays(firstWeek, (windowWeeks - 1) * 7 + 6);

  const rows = await db
    .select({
      clusterId: clusterCapacityForecast.clusterId,
      clusterName: clusters.name,
      weekStart: clusterCapacityForecast.weekStart,
      demandHours: clusterCapacityForecast.demandHours,
      capacityHours: clusterCapacityForecast.capacityHours,
      gapHours: clusterCapacityForecast.gapHours,
      weatherMultiplier: clusterCapacityForecast.weatherMultiplier,
      computedAt: clusterCapacityForecast.computedAt,
    })
    .from(clusterCapacityForecast)
    .innerJoin(clusters, eq(clusters.id, clusterCapacityForecast.clusterId))
    .where(and(
      eq(clusterCapacityForecast.tenantId, tenantId),
      gte(clusterCapacityForecast.weekStart, firstWeek),
      lte(clusterCapacityForecast.weekStart, lastWeek),
    ))
    .orderBy(clusterCapacityForecast.clusterId, clusterCapacityForecast.weekStart);

  if (rows.length === 0) return null;

  const grouped = new Map<string, ClusterForecastSummary>();
  let computedAt = new Date(0);
  for (const r of rows) {
    if (!grouped.has(r.clusterId)) {
      grouped.set(r.clusterId, {
        clusterId: r.clusterId,
        clusterName: r.clusterName,
        weeks: [],
        totalDemand: 0,
        totalCapacity: 0,
        totalGap: 0,
      });
    }
    const c = grouped.get(r.clusterId)!;
    c.weeks.push({
      weekStart: r.weekStart.toISOString(),
      demandHours: r.demandHours ?? 0,
      capacityHours: r.capacityHours ?? 0,
      gapHours: r.gapHours ?? 0,
      weatherMultiplier: r.weatherMultiplier ?? 1.0,
    });
    c.totalDemand = Math.round((c.totalDemand + (r.demandHours ?? 0)) * 10) / 10;
    c.totalCapacity = Math.round((c.totalCapacity + (r.capacityHours ?? 0)) * 10) / 10;
    c.totalGap = Math.round((c.totalGap + (r.gapHours ?? 0)) * 10) / 10;
    if (r.computedAt > computedAt) computedAt = r.computedAt;
  }

  return { clusters: Array.from(grouped.values()), computedAt };
}

const FTE_HOURS_PER_WEEK = 40;

export function generateRebalanceSuggestions(
  forecast: ComputedForecastResult,
  options: { maxSuggestions?: number } = {},
): RebalanceSuggestion[] {
  const max = options.maxSuggestions ?? 10;
  const suggestions: RebalanceSuggestion[] = [];
  if (forecast.clusters.length < 2) return suggestions;

  const weekCount = forecast.clusters[0]?.weeks.length ?? 0;

  // Group consecutive weeks with same shortage cluster
  type Range = { fromCluster: string; toCluster: string; weeks: string[]; totalHours: number };
  const ranges: Range[] = [];

  for (let w = 0; w < weekCount; w++) {
    const ws = forecast.clusters[0].weeks[w].weekStart;
    const shortages: { clusterId: string; gap: number }[] = [];
    const surpluses: { clusterId: string; gap: number }[] = [];
    for (const c of forecast.clusters) {
      const gap = c.weeks[w]?.gapHours ?? 0;
      if (gap > 0.5) shortages.push({ clusterId: c.clusterId, gap });
      else if (gap < -0.5) surpluses.push({ clusterId: c.clusterId, gap: -gap });
    }
    shortages.sort((a, b) => b.gap - a.gap);
    surpluses.sort((a, b) => b.gap - a.gap);

    for (const s of shortages) {
      let remaining = s.gap;
      for (const sur of surpluses) {
        if (sur.gap <= 0.5 || remaining <= 0.5) continue;
        const move = Math.min(remaining, sur.gap);
        const exists = ranges.find(r =>
          r.fromCluster === sur.clusterId &&
          r.toCluster === s.clusterId &&
          r.weeks[r.weeks.length - 1] &&
          new Date(ws).getTime() - new Date(r.weeks[r.weeks.length - 1]).getTime() === 7 * 86400 * 1000,
        );
        if (exists) {
          exists.weeks.push(ws);
          exists.totalHours += move;
        } else {
          ranges.push({
            fromCluster: sur.clusterId,
            toCluster: s.clusterId,
            weeks: [ws],
            totalHours: move,
          });
        }
        sur.gap -= move;
        remaining -= move;
      }
    }
  }

  ranges.sort((a, b) => b.totalHours - a.totalHours);
  for (const r of ranges.slice(0, max)) {
    const fromCluster = forecast.clusters.find(c => c.clusterId === r.fromCluster)!;
    const toCluster = forecast.clusters.find(c => c.clusterId === r.toCluster)!;
    const weeksCount = r.weeks.length;
    const fte = (r.totalHours / weeksCount) / FTE_HOURS_PER_WEEK;
    suggestions.push({
      fromClusterId: r.fromCluster,
      fromClusterName: fromCluster.clusterName,
      toClusterId: r.toCluster,
      toClusterName: toCluster.clusterName,
      weekStart: r.weeks[0],
      weekStartEnd: r.weeks[r.weeks.length - 1],
      fteShift: Math.round(fte * 100) / 100,
      hours: Math.round(r.totalHours * 10) / 10,
    });
  }

  return suggestions;
}
