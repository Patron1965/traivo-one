import OpenAI from "openai";
import type { WorkOrder, Resource, Cluster, SetupTimeLog, ServiceObject } from "@shared/schema";
import { fetchWeatherForecast, type WeatherImpact } from "./weather-service";
import { buildSystemPrompt, PLANNING_PERSONA_ADDITIONS } from "./ai/persona";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ============================================
// KPI CALCULATIONS FOR AI CONTEXT
// ============================================

export interface PlanningKPIs {
  // Ställtider
  avgSetupTimeMinutes: number;
  setupTimeByCluster: Record<string, { avg: number; count: number; trend: "up" | "down" | "stable" }>;
  anomalousSetupTimes: { objectId: string; objectName?: string; actual: number; expected: number; deviation: number }[];
  
  // Resurseffektivitet
  resourceEfficiency: Record<string, { 
    name: string; 
    utilizationPercent: number; 
    completedOrders: number;
    avgOrderDuration: number;
    delayRate: number; // % av ordrar som var försenade
  }>;
  
  // Förseningar
  delayedOrdersCount: number;
  delayedOrdersPercent: number;
  avgDelayMinutes: number;
  
  // Orderstatistik
  completionRateLast30Days: number;
  ordersPerCluster: Record<string, number>;
  
  // Kostnad
  avgCostPerOrder: number;
  costAnomalies: { orderId: string; title: string; cost: number; avgCost: number; deviation: number }[];
}

export function calculatePlanningKPIs(
  workOrders: WorkOrder[],
  resources: Resource[],
  clusters: Cluster[],
  setupTimeLogs: SetupTimeLog[] = []
): PlanningKPIs {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // Filtrera ordrar senaste 30 dagarna
  const recentOrders = workOrders.filter(o => {
    if (!o.completedAt) return false;
    const completedAt = o.completedAt instanceof Date ? o.completedAt : new Date(o.completedAt);
    return completedAt >= thirtyDaysAgo;
  });
  
  const completedOrders = recentOrders.filter(o => o.status === "utford" || o.status === "fakturerad");
  const allActiveOrders = workOrders.filter(o => o.status !== "fakturerad");
  
  // === Ställtidsberäkningar ===
  const setupTimeByCluster: Record<string, { total: number; count: number }> = {};
  let totalSetupTime = 0;
  let setupCount = 0;
  
  setupTimeLogs.forEach(log => {
    totalSetupTime += log.durationMinutes;
    setupCount++;
    
    // Hitta kluster för objektet
    const order = workOrders.find(o => o.objectId === log.objectId);
    if (order?.clusterId) {
      if (!setupTimeByCluster[order.clusterId]) {
        setupTimeByCluster[order.clusterId] = { total: 0, count: 0 };
      }
      setupTimeByCluster[order.clusterId].total += log.durationMinutes;
      setupTimeByCluster[order.clusterId].count++;
    }
  });
  
  const avgSetupTimeMinutes = setupCount > 0 ? totalSetupTime / setupCount : 0;
  
  // Konvertera till KPI-format med trend (förenklad - alltid "stable" utan historik)
  const setupTimeByClusterKPI: Record<string, { avg: number; count: number; trend: "up" | "down" | "stable" }> = {};
  Object.entries(setupTimeByCluster).forEach(([clusterId, data]) => {
    const cluster = clusters.find(c => c.id === clusterId);
    const key = cluster?.name || clusterId.slice(0, 8);
    setupTimeByClusterKPI[key] = {
      avg: data.count > 0 ? Math.round(data.total / data.count) : 0,
      count: data.count,
      trend: "stable"
    };
  });
  
  // Anomala ställtider (>30% över snitt)
  const anomalousSetupTimes = setupTimeLogs
    .filter(log => log.durationMinutes > avgSetupTimeMinutes * 1.3 && avgSetupTimeMinutes > 0)
    .slice(0, 5)
    .map(log => ({
      objectId: log.objectId,
      objectName: undefined,
      actual: log.durationMinutes,
      expected: Math.round(avgSetupTimeMinutes),
      deviation: Math.round(((log.durationMinutes - avgSetupTimeMinutes) / avgSetupTimeMinutes) * 100)
    }));
  
  // === Resurseffektivitet ===
  const resourceEfficiency: Record<string, { 
    name: string; 
    utilizationPercent: number; 
    completedOrders: number;
    avgOrderDuration: number;
    delayRate: number;
  }> = {};
  
  resources.forEach(r => {
    const resourceOrders = completedOrders.filter(o => o.resourceId === r.id);
    const totalDuration = resourceOrders.reduce((sum, o) => sum + (o.actualDuration || o.estimatedDuration || 60), 0);
    const delayedOrders = resourceOrders.filter(o => {
      if (!o.actualDuration || !o.estimatedDuration) return false;
      return o.actualDuration > o.estimatedDuration * 1.2;
    });
    
    // Antag 8h/dag, 20 arbetsdagar/månad = 160h = 9600 min
    const maxCapacityMinutes = 9600;
    
    resourceEfficiency[r.id] = {
      name: r.name,
      utilizationPercent: Math.min(100, Math.round((totalDuration / maxCapacityMinutes) * 100)),
      completedOrders: resourceOrders.length,
      avgOrderDuration: resourceOrders.length > 0 ? Math.round(totalDuration / resourceOrders.length) : 0,
      delayRate: resourceOrders.length > 0 ? Math.round((delayedOrders.length / resourceOrders.length) * 100) : 0
    };
  });
  
  // === Förseningar ===
  const delayedOrders = completedOrders.filter(o => {
    if (!o.actualDuration || !o.estimatedDuration) return false;
    return o.actualDuration > o.estimatedDuration * 1.2;
  });
  
  const avgDelayMinutes = delayedOrders.length > 0
    ? Math.round(delayedOrders.reduce((sum, o) => sum + ((o.actualDuration || 0) - (o.estimatedDuration || 0)), 0) / delayedOrders.length)
    : 0;
  
  // === Ordrar per kluster ===
  const ordersPerCluster: Record<string, number> = {};
  allActiveOrders.forEach(o => {
    if (o.clusterId) {
      const cluster = clusters.find(c => c.id === o.clusterId);
      const key = cluster?.name || o.clusterId.slice(0, 8);
      ordersPerCluster[key] = (ordersPerCluster[key] || 0) + 1;
    }
  });
  
  // === Kostnadsanomalier - beräknas baserat på estimatedValue ===
  const ordersWithValue = completedOrders.filter(o => o.estimatedValue && o.estimatedValue > 0);
  const avgCost = ordersWithValue.length > 0
    ? ordersWithValue.reduce((sum, o) => sum + (o.estimatedValue || 0), 0) / ordersWithValue.length
    : 0;
  
  const costAnomalies = ordersWithValue
    .filter(o => o.estimatedValue && o.estimatedValue > avgCost * 1.5)
    .slice(0, 5)
    .map(o => ({
      orderId: o.id,
      title: o.title || `Order ${o.id.slice(0, 8)}`,
      cost: o.estimatedValue || 0,
      avgCost: Math.round(avgCost),
      deviation: avgCost > 0 ? Math.round(((o.estimatedValue || 0) - avgCost) / avgCost * 100) : 0
    }));
  
  return {
    avgSetupTimeMinutes: Math.round(avgSetupTimeMinutes),
    setupTimeByCluster: setupTimeByClusterKPI,
    anomalousSetupTimes,
    resourceEfficiency,
    delayedOrdersCount: delayedOrders.length,
    delayedOrdersPercent: completedOrders.length > 0 ? Math.round((delayedOrders.length / completedOrders.length) * 100) : 0,
    avgDelayMinutes,
    completionRateLast30Days: recentOrders.length > 0 ? Math.round((completedOrders.length / recentOrders.length) * 100) : 0,
    ordersPerCluster,
    avgCostPerOrder: Math.round(avgCost),
    costAnomalies
  };
}

function formatKPIsForPrompt(kpis: PlanningKPIs): string {
  const sections: string[] = [];
  
  // Ställtider
  if (kpis.avgSetupTimeMinutes > 0) {
    const clusterBreakdown = Object.entries(kpis.setupTimeByCluster)
      .map(([name, data]) => `  - ${name}: ${data.avg} min (${data.count} mätningar)`)
      .join("\n");
    
    sections.push(`STÄLLTIDSANALYS:
- Genomsnittlig ställtid: ${kpis.avgSetupTimeMinutes} min
${clusterBreakdown ? `Per kluster:\n${clusterBreakdown}` : ""}
${kpis.anomalousSetupTimes.length > 0 ? `\nAnomalier (>30% över snitt): ${kpis.anomalousSetupTimes.length} st` : ""}`);
  }
  
  // Resurseffektivitet
  const resourceSummary = Object.values(kpis.resourceEfficiency)
    .filter(r => r.completedOrders > 0)
    .map(r => `  - ${r.name}: ${r.utilizationPercent}% utnyttjande, ${r.completedOrders} ordrar, ${r.delayRate}% förseningsgrad`)
    .join("\n");
  
  if (resourceSummary) {
    sections.push(`RESURSEFFEKTIVITET (senaste 30 dagar):\n${resourceSummary}`);
  }
  
  // Förseningar
  if (kpis.delayedOrdersCount > 0) {
    sections.push(`FÖRSENINGAR:
- ${kpis.delayedOrdersCount} försenade ordrar (${kpis.delayedOrdersPercent}%)
- Genomsnittlig försening: ${kpis.avgDelayMinutes} min`);
  }
  
  // Klusterfördelning
  const clusterDist = Object.entries(kpis.ordersPerCluster)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `  - ${name}: ${count} ordrar`)
    .join("\n");
  
  if (clusterDist) {
    sections.push(`ORDERFÖRDELNING PER KLUSTER:\n${clusterDist}`);
  }
  
  // Kostnadsanomalier
  if (kpis.costAnomalies.length > 0) {
    sections.push(`KOSTNADSANOMALIER (>50% över snitt):
${kpis.costAnomalies.map(a => `  - ${a.title}: ${a.cost} kr (+${a.deviation}%)`).join("\n")}`);
  }
  
  return sections.join("\n\n");
}

export interface PlanningSuggestion {
  id: string;
  type: "move" | "swap" | "balance" | "warning";
  title: string;
  description: string;
  impact: string;
  workOrderId?: string;
  fromResourceId?: string;
  toResourceId?: string;
  fromDate?: string;
  toDate?: string;
  estimatedTimeSaved?: number;
  priority: "high" | "medium" | "low";
}

export interface PlanningContext {
  workOrders: WorkOrder[];
  resources: Resource[];
  clusters: Cluster[];
  weekStart: string;
  weekEnd: string;
  setupTimeLogs?: SetupTimeLog[];
  kpis?: PlanningKPIs;
}

function getOrderTitle(order: WorkOrder): string {
  return order.title || `Order ${order.id.slice(0, 8)}`;
}

function getOrderPriority(order: WorkOrder): string {
  return order.priority || "normal";
}

function getOrderDuration(order: WorkOrder): number {
  return order.estimatedDuration || 60;
}

function buildContextPrompt(context: PlanningContext): string {
  const validOrders = context.workOrders.filter(o => o.status !== "fakturerad" && o.status !== "utford");
  const scheduledOrders = validOrders.filter(o => o.scheduledDate && o.resourceId);
  const unscheduledOrders = validOrders.filter(o => !o.scheduledDate || !o.resourceId);
  
  const resourceLoad: Record<string, { name: string; hours: number; days: Record<string, number> }> = {};
  
  context.resources.forEach(r => {
    resourceLoad[r.id] = { 
      name: r.name, 
      hours: 0,
      days: {}
    };
  });
  
  scheduledOrders.forEach(order => {
    if (order.resourceId && resourceLoad[order.resourceId]) {
      const hours = getOrderDuration(order) / 60;
      resourceLoad[order.resourceId].hours += hours;
      const day = order.scheduledDate instanceof Date 
        ? order.scheduledDate.toISOString().split("T")[0] 
        : String(order.scheduledDate || "");
      if (!resourceLoad[order.resourceId].days[day]) {
        resourceLoad[order.resourceId].days[day] = 0;
      }
      resourceLoad[order.resourceId].days[day] += hours;
    }
  });

  const resourceSummary = Object.entries(resourceLoad)
    .map(([id, data]) => {
      const dailyBreakdown = Object.entries(data.days)
        .map(([day, hours]) => `${day}: ${hours.toFixed(1)}h`)
        .join(", ");
      return `- ${data.name} (${id}): ${data.hours.toFixed(1)}h totalt | ${dailyBreakdown || "inga schemalagda"}`;
    })
    .join("\n");

  const urgentOrders = validOrders
    .filter(o => getOrderPriority(o) === "urgent" || getOrderPriority(o) === "high")
    .map(o => {
      const dateStr = o.scheduledDate instanceof Date 
        ? o.scheduledDate.toISOString().split("T")[0] 
        : o.scheduledDate;
      return `- ${getOrderTitle(o)} (${getOrderPriority(o)}) - ${dateStr ? `schemalagd ${dateStr}` : "OSCHEMALAGD"}`;
    });

  // Calculate KPIs if not provided
  const kpis = context.kpis || calculatePlanningKPIs(context.workOrders, context.resources, context.clusters, context.setupTimeLogs || []);
  const kpiSection = formatKPIsForPrompt(kpis);

  return `
Du är en AI-planeringsassistent för fältservice. Analysera nuvarande planering och ge förslag.

RESURSER (${context.resources.length} st):
${resourceSummary}

ARBETSORDRAR:
- Schemalagda: ${scheduledOrders.length}
- Oschemalagda: ${unscheduledOrders.length}
- Akuta/höga prioritet: ${urgentOrders.length}

${urgentOrders.length > 0 ? `AKUTA ORDRAR:\n${urgentOrders.join("\n")}` : ""}

VECKA: ${context.weekStart} till ${context.weekEnd}

${kpiSection ? `\n--- NYCKELTAL & HISTORIK ---\n${kpiSection}\n` : ""}

Ge 2-4 konkreta förslag för att förbättra planeringen. Fokusera på:
1. Obalans i arbetsbelastning mellan resurser
2. Oschemalagda ordrar som behöver planeras
3. Möjligheter att spara körtid genom att gruppera ordrar
4. Akuta ordrar som kanske bör flyttas tidigare
5. Anomalier i ställtider eller kostnader som behöver åtgärdas
6. Resurser med hög förseningsgrad som kan behöva stöd

Svara ENDAST med JSON i detta format:
{
  "suggestions": [
    {
      "id": "unik-id",
      "type": "move|swap|balance|warning",
      "title": "Kort titel",
      "description": "Förklaring av förslaget",
      "impact": "Förväntad effekt (t.ex. 'Sparar 30 min körtid')",
      "workOrderId": "order-id eller null",
      "fromResourceId": "resurs-id eller null",
      "toResourceId": "resurs-id eller null",
      "fromDate": "datum eller null",
      "toDate": "datum eller null",
      "estimatedTimeSaved": 30,
      "priority": "high|medium|low"
    }
  ]
}
`;
}

export async function generatePlanningSuggestions(
  context: PlanningContext
): Promise<PlanningSuggestion[]> {
  try {
    const prompt = buildContextPrompt(context);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Upgraded for complex planning decisions
      messages: [
        {
          role: "system",
          content: "Du är en erfaren planerare för fältservice i Sverige. Svara alltid på svenska och ge praktiska, genomförbara förslag."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    
    return (parsed.suggestions || []) as PlanningSuggestion[];
  } catch (error) {
    console.error("AI Planning error:", error);
    return [{
      id: "error-1",
      type: "warning",
      title: "Kunde inte analysera",
      description: "AI-analysen misslyckades. Försök igen senare.",
      impact: "Ingen påverkan",
      priority: "low"
    }];
  }
}

export async function explainSuggestion(
  suggestion: PlanningSuggestion,
  context: PlanningContext
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Du är en planeringsexpert. Förklara förslaget kortfattat på svenska."
        },
        {
          role: "user",
          content: `Förklara varför detta förslag är bra: "${suggestion.title}" - ${suggestion.description}. Resurser: ${context.resources.length}, Ordrar: ${context.workOrders.length}.`
        }
      ],
      temperature: 0.5,
      max_tokens: 300
    });

    return response.choices[0]?.message?.content || "Ingen förklaring tillgänglig.";
  } catch (error) {
    return "Kunde inte generera förklaring.";
  }
}

// ============================================
// AI AUTO-SCHEDULER
// Automatisk schemaläggning av oschemalagda ordrar
// ============================================

export interface ScheduleAssignment {
  workOrderId: string;
  resourceId: string;
  scheduledDate: string;
  reason: string;
  confidence: number; // 0-100
}

export interface AutoScheduleResult {
  assignments: ScheduleAssignment[];
  summary: string;
  totalOrdersScheduled: number;
  estimatedEfficiency: number; // Procent av optimal
}

interface ResourceCapacity {
  id: string;
  name: string;
  hoursPerDay: number;
  dailyLoad: Record<string, number>; // date -> hours used
  serviceArea: string[]; // Postnummer resursen täcker
}

function resourceServesCluster(resource: Resource, cluster: Cluster): boolean {
  // Matcha via postnummer
  const resourceArea = resource.serviceArea || [];
  const clusterPostals = cluster.postalCodes || [];
  return resourceArea.some(postal => clusterPostals.includes(postal));
}

function calculateResourceCapacity(
  resources: Resource[],
  scheduledOrders: WorkOrder[],
  weekDays: string[]
): ResourceCapacity[] {
  const capacities: ResourceCapacity[] = resources.map(r => ({
    id: r.id,
    name: r.name,
    hoursPerDay: 8, // Standard arbetsdag
    dailyLoad: {},
    serviceArea: r.serviceArea || []
  }));

  // Initiera alla dagar med 0
  capacities.forEach(cap => {
    weekDays.forEach(day => {
      cap.dailyLoad[day] = 0;
    });
  });

  // Räkna befintlig belastning
  scheduledOrders.forEach(order => {
    if (!order.resourceId || !order.scheduledDate) return;
    
    const cap = capacities.find(c => c.id === order.resourceId);
    if (!cap) return;
    
    const dateStr = order.scheduledDate instanceof Date
      ? order.scheduledDate.toISOString().split("T")[0]
      : String(order.scheduledDate);
    
    const hours = getOrderDuration(order) / 60;
    cap.dailyLoad[dateStr] = (cap.dailyLoad[dateStr] || 0) + hours;
  });

  return capacities;
}

function getWeekDays(weekStart: string): string[] {
  const days: string[] = [];
  const start = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    // Hoppa över lördag (6) och söndag (0)
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(d.toISOString().split("T")[0]);
    }
  }
  return days;
}

function findBestSlot(
  order: WorkOrder,
  capacities: ResourceCapacity[],
  weekDays: string[],
  clusters: Cluster[],
  resources: Resource[]
): { resourceId: string; date: string; score: number } | null {
  const orderDuration = getOrderDuration(order) / 60;
  const orderClusterId = order.clusterId;
  const orderPriority = getOrderPriority(order);
  
  // Hitta klustret som ordern tillhör
  const orderCluster = orderClusterId 
    ? clusters.find(c => c.id === orderClusterId) 
    : null;
  
  let bestSlot: { resourceId: string; date: string; score: number } | null = null;
  
  for (const cap of capacities) {
    for (const day of weekDays) {
      const availableHours = cap.hoursPerDay - (cap.dailyLoad[day] || 0);
      
      // Kontrollera om det finns tillräckligt med tid
      if (availableHours < orderDuration) continue;
      
      // Beräkna poäng baserat på:
      // 1. Områdesmatchning (resursens serviceArea matchar klustrets postnummer)
      // 2. Ledig kapacitet (mer ledig tid = jämnare fördelning)
      // 3. Tidigt i veckan för akuta ordrar
      
      let score = 50; // Baspoäng
      
      // Områdesmatchning: +30 poäng om resursen betjänar klustret
      if (orderCluster) {
        const resource = resources.find(r => r.id === cap.id);
        if (resource && resourceServesCluster(resource, orderCluster)) {
          score += 30;
        }
      }
      
      // Balanserad belastning: +0-20 poäng baserat på ledig kapacitet
      const loadRatio = (cap.dailyLoad[day] || 0) / cap.hoursPerDay;
      score += Math.round((1 - loadRatio) * 20);
      
      // Akuta ordrar: tidigare i veckan = högre poäng
      if (orderPriority === "urgent" || orderPriority === "high") {
        const dayIndex = weekDays.indexOf(day);
        score += Math.max(0, 10 - dayIndex * 2);
      }
      
      if (!bestSlot || score > bestSlot.score) {
        bestSlot = { resourceId: cap.id, date: day, score };
      }
    }
  }
  
  return bestSlot;
}

export async function autoScheduleOrders(
  context: PlanningContext
): Promise<AutoScheduleResult> {
  const validOrders = context.workOrders.filter(
    o => o.status !== "fakturerad" && o.status !== "utford"
  );
  const unscheduledOrders = validOrders.filter(
    o => !o.scheduledDate || !o.resourceId
  );
  const scheduledOrders = validOrders.filter(
    o => o.scheduledDate && o.resourceId
  );
  
  if (unscheduledOrders.length === 0) {
    return {
      assignments: [],
      summary: "Inga oschemalagda ordrar att planera.",
      totalOrdersScheduled: 0,
      estimatedEfficiency: 100
    };
  }
  
  const weekDays = getWeekDays(context.weekStart);
  const capacities = calculateResourceCapacity(
    context.resources,
    scheduledOrders,
    weekDays
  );
  
  // Sortera ordrar: akuta först, sedan efter kluster
  const sortedOrders = [...unscheduledOrders].sort((a, b) => {
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const aPriority = priorityOrder[getOrderPriority(a)] ?? 2;
    const bPriority = priorityOrder[getOrderPriority(b)] ?? 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    
    // Sedan efter kluster för att gruppera
    const aCluster = a.clusterId || "zzz";
    const bCluster = b.clusterId || "zzz";
    return aCluster.localeCompare(bCluster);
  });
  
  const assignments: ScheduleAssignment[] = [];
  
  for (const order of sortedOrders) {
    const slot = findBestSlot(order, capacities, weekDays, context.clusters, context.resources);
    
    if (slot) {
      // Uppdatera kapaciteten
      const cap = capacities.find(c => c.id === slot.resourceId);
      if (cap) {
        const hours = getOrderDuration(order) / 60;
        cap.dailyLoad[slot.date] = (cap.dailyLoad[slot.date] || 0) + hours;
      }
      
      const resource = context.resources.find(r => r.id === slot.resourceId);
      const cluster = context.clusters.find(c => c.id === order.clusterId);
      
      assignments.push({
        workOrderId: order.id,
        resourceId: slot.resourceId,
        scheduledDate: slot.date,
        reason: cluster 
          ? `Placerad hos ${resource?.name || "resurs"} i kluster ${cluster.name}`
          : `Placerad hos ${resource?.name || "resurs"} baserat på tillgänglighet`,
        confidence: Math.min(100, slot.score + 10)
      });
    }
  }
  
  // Beräkna effektivitet baserat på områdesmatchning och balans
  const clusterMatches = assignments.filter(a => {
    const order = unscheduledOrders.find(o => o.id === a.workOrderId);
    const resource = context.resources.find(r => r.id === a.resourceId);
    if (!order?.clusterId || !resource) return false;
    const cluster = context.clusters.find(c => c.id === order.clusterId);
    return cluster && resourceServesCluster(resource, cluster);
  }).length;
  
  const efficiency = assignments.length > 0
    ? Math.round(50 + (clusterMatches / assignments.length) * 50)
    : 0;
  
  return {
    assignments,
    summary: `Schemalade ${assignments.length} av ${unscheduledOrders.length} ordrar. ${clusterMatches} ordrar matchade kluster.`,
    totalOrdersScheduled: assignments.length,
    estimatedEfficiency: efficiency
  };
}

// Arbetsobalans-analys - detekterar ojämn arbetsfördelning
export interface WorkloadWarning {
  id: string;
  type: "overload" | "underload" | "imbalance" | "peak";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  affectedResourceId?: string;
  affectedResourceName?: string;
  affectedDate?: string;
  suggestion: string;
}

export interface WorkloadAnalysis {
  warnings: WorkloadWarning[];
  overallBalance: number; // 0-100, 100 = perfekt balans
  summary: string;
}

const MAX_HOURS_PER_DAY = 8;
const MIN_HOURS_PER_DAY = 2;
const IMBALANCE_THRESHOLD = 0.3; // 30% avvikelse anses som obalans

export function analyzeWorkloadImbalances(context: PlanningContext): WorkloadAnalysis {
  const warnings: WorkloadWarning[] = [];
  
  // Filtrera ordrar till den valda veckoperioden
  const weekStartDate = new Date(context.weekStart);
  const weekEndDate = new Date(context.weekEnd);
  
  const validOrders = context.workOrders.filter(o => {
    if (o.status === "fakturerad" || o.status === "utford") return false;
    if (!o.scheduledDate || !o.resourceId) return false;
    
    const orderDate = o.scheduledDate instanceof Date 
      ? o.scheduledDate 
      : new Date(String(o.scheduledDate));
    
    return orderDate >= weekStartDate && orderDate <= weekEndDate;
  });
  
  // Beräkna belastning per resurs och dag
  const resourceDayLoad: Record<string, Record<string, number>> = {};
  const resourceTotalLoad: Record<string, number> = {};
  const resourceNames: Record<string, string> = {};
  
  context.resources.forEach(r => {
    resourceDayLoad[r.id] = {};
    resourceTotalLoad[r.id] = 0;
    resourceNames[r.id] = r.name;
  });
  
  validOrders.forEach(order => {
    if (!order.resourceId || !resourceDayLoad[order.resourceId]) return;
    
    const hours = getOrderDuration(order) / 60;
    const day = order.scheduledDate instanceof Date 
      ? order.scheduledDate.toISOString().split("T")[0] 
      : String(order.scheduledDate);
    
    if (!resourceDayLoad[order.resourceId][day]) {
      resourceDayLoad[order.resourceId][day] = 0;
    }
    resourceDayLoad[order.resourceId][day] += hours;
    resourceTotalLoad[order.resourceId] += hours;
  });
  
  // 1. Hitta överbelastade dagar (> MAX_HOURS_PER_DAY)
  Object.entries(resourceDayLoad).forEach(([resourceId, days]) => {
    Object.entries(days).forEach(([day, hours]) => {
      if (hours > MAX_HOURS_PER_DAY) {
        warnings.push({
          id: `overload-${resourceId}-${day}`,
          type: "overload",
          severity: hours > MAX_HOURS_PER_DAY + 2 ? "high" : "medium",
          title: `Överbelastad dag för ${resourceNames[resourceId]}`,
          description: `${resourceNames[resourceId]} har ${hours.toFixed(1)} timmar schemalagda på ${day}, vilket överskrider maxgränsen på ${MAX_HOURS_PER_DAY}h.`,
          affectedResourceId: resourceId,
          affectedResourceName: resourceNames[resourceId],
          affectedDate: day,
          suggestion: `Flytta ${(hours - MAX_HOURS_PER_DAY).toFixed(1)}h arbete till en annan dag eller resurs.`
        });
      }
    });
  });
  
  // 2. Hitta underbelastade dagar med arbete (< MIN_HOURS_PER_DAY om det finns arbete)
  Object.entries(resourceDayLoad).forEach(([resourceId, days]) => {
    Object.entries(days).forEach(([day, hours]) => {
      if (hours > 0 && hours < MIN_HOURS_PER_DAY) {
        warnings.push({
          id: `underload-${resourceId}-${day}`,
          type: "underload",
          severity: "low",
          title: `Låg beläggning för ${resourceNames[resourceId]}`,
          description: `${resourceNames[resourceId]} har bara ${hours.toFixed(1)}h schemalagda på ${day}.`,
          affectedResourceId: resourceId,
          affectedResourceName: resourceNames[resourceId],
          affectedDate: day,
          suggestion: "Överväg att konsolidera arbetet till färre dagar eller tilldela fler ordrar."
        });
      }
    });
  });
  
  // 3. Jämför total belastning mellan resurser
  const totalLoads = Object.values(resourceTotalLoad);
  if (totalLoads.length > 1 && totalLoads.some(h => h > 0)) {
    const avgLoad = totalLoads.reduce((a, b) => a + b, 0) / totalLoads.length;
    
    Object.entries(resourceTotalLoad).forEach(([resourceId, hours]) => {
      if (avgLoad > 0) {
        const deviation = Math.abs(hours - avgLoad) / avgLoad;
        if (deviation > IMBALANCE_THRESHOLD && hours > avgLoad) {
          warnings.push({
            id: `imbalance-high-${resourceId}`,
            type: "imbalance",
            severity: deviation > 0.5 ? "high" : "medium",
            title: `Ojämn fördelning: ${resourceNames[resourceId]} har för mycket`,
            description: `${resourceNames[resourceId]} har ${hours.toFixed(1)}h totalt, ${((deviation) * 100).toFixed(0)}% över genomsnittet (${avgLoad.toFixed(1)}h).`,
            affectedResourceId: resourceId,
            affectedResourceName: resourceNames[resourceId],
            suggestion: "Fördela om arbetsordrar till resurser med lägre belastning."
          });
        } else if (deviation > IMBALANCE_THRESHOLD && hours < avgLoad) {
          warnings.push({
            id: `imbalance-low-${resourceId}`,
            type: "imbalance",
            severity: "low",
            title: `Ojämn fördelning: ${resourceNames[resourceId]} har för lite`,
            description: `${resourceNames[resourceId]} har ${hours.toFixed(1)}h totalt, ${((deviation) * 100).toFixed(0)}% under genomsnittet (${avgLoad.toFixed(1)}h).`,
            affectedResourceId: resourceId,
            affectedResourceName: resourceNames[resourceId],
            suggestion: "Denna resurs har kapacitet att ta emot fler arbetsordrar."
          });
        }
      }
    });
  }
  
  // 4. Hitta toppdagar (alla resurser har högt på samma dag)
  const dayTotals: Record<string, number> = {};
  Object.values(resourceDayLoad).forEach(days => {
    Object.entries(days).forEach(([day, hours]) => {
      if (!dayTotals[day]) dayTotals[day] = 0;
      dayTotals[day] += hours;
    });
  });
  
  const avgDayTotal = Object.values(dayTotals).length > 0 
    ? Object.values(dayTotals).reduce((a, b) => a + b, 0) / Object.values(dayTotals).length 
    : 0;
  
  Object.entries(dayTotals).forEach(([day, hours]) => {
    if (avgDayTotal > 0 && hours > avgDayTotal * 1.5) {
      warnings.push({
        id: `peak-${day}`,
        type: "peak",
        severity: "medium",
        title: `Topptryck på ${day}`,
        description: `Totalt ${hours.toFixed(1)}h planerat över alla resurser, ${((hours / avgDayTotal - 1) * 100).toFixed(0)}% över snitt.`,
        affectedDate: day,
        suggestion: "Överväg att sprida arbete till närliggande dagar för jämnare flöde."
      });
    }
  });
  
  // Beräkna övergripande balans (100 = perfekt, 0 = totalt obalanserat)
  const highWarnings = warnings.filter(w => w.severity === "high").length;
  const mediumWarnings = warnings.filter(w => w.severity === "medium").length;
  const lowWarnings = warnings.filter(w => w.severity === "low").length;
  const overallBalance = Math.max(0, 100 - (highWarnings * 20) - (mediumWarnings * 10) - (lowWarnings * 5));
  
  return {
    warnings: warnings.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    overallBalance,
    summary: warnings.length === 0 
      ? "Planeringen är välbalanserad utan varningar."
      : `Hittade ${warnings.length} potentiella problem: ${highWarnings} allvarliga, ${mediumWarnings} medel, ${lowWarnings} mindre.`
  };
}

// AI-förstärkt schemaläggning - använder GPT för att optimera ytterligare
export async function aiEnhancedSchedule(
  context: PlanningContext
): Promise<AutoScheduleResult> {
  // Hämta väderprognos för Umeå (Kinabs huvudort)
  const UMEA_LAT = 63.82;
  const UMEA_LON = 20.26;
  let weatherInfo = "";
  let weatherImpacts: WeatherImpact[] = [];
  
  try {
    const weatherResult = await fetchWeatherForecast(UMEA_LAT, UMEA_LON, 7);
    weatherImpacts = weatherResult.impacts;
    
    if (weatherResult.impacts.length > 0) {
      const impactDays = weatherResult.impacts.filter(i => i.impactLevel !== "none");
      if (impactDays.length > 0) {
        weatherInfo = `\nVÄDERPROGNOS:\n${impactDays.map(i => 
          `- ${i.date}: ${i.reason} (kapacitet: ${Math.round(i.capacityMultiplier * 100)}%)`
        ).join("\n")}`;
      }
    }
  } catch (e) {
    console.error("Weather fetch failed:", e);
  }
  
  // Först: Använd algoritm-baserad schemaläggning (med väderdata)
  const baseResult = await autoScheduleOrdersWithWeather(context, weatherImpacts);
  
  if (baseResult.assignments.length === 0) {
    return baseResult;
  }
  
  // Sedan: Be AI:n optimera/validera fördelningen
  try {
    // Räkna ordrar per kluster för att visa AI:n klusterdistribution
    const clusterCounts: Record<string, number> = {};
    baseResult.assignments.forEach(a => {
      const order = context.workOrders.find(o => o.id === a.workOrderId);
      const clusterId = order?.clusterId || "inget";
      clusterCounts[clusterId] = (clusterCounts[clusterId] || 0) + 1;
    });
    
    const clusterInfo = context.clusters
      .filter(c => clusterCounts[c.id])
      .map(c => `- ${c.name}: ${clusterCounts[c.id]} ordrar`)
      .join("\n");
    
    const prompt = `
Du är en expert på fältserviceoptimering för ett avfallshanteringsföretag i Umeå (Kinab).
Analysera denna automatiska schemaläggning och ge förbättringsförslag.

RESURSER (${context.resources.length} st):
${context.resources.map(r => `- ${r.name}, serviceArea: ${(r.serviceArea || []).join(", ") || "alla områden"}`).join("\n")}

KLUSTER-DISTRIBUTION:
${clusterInfo || "Inga kluster-tilldelningar"}
${weatherInfo}

SCHEMALÄGGNING (${baseResult.assignments.length} ordrar fördelade):
${baseResult.assignments.slice(0, 20).map(a => {
  const order = context.workOrders.find(o => o.id === a.workOrderId);
  const cluster = context.clusters.find(c => c.id === order?.clusterId);
  return `- ${a.scheduledDate}: ${order?.title?.slice(0, 30) || "Order"} → ${context.resources.find(r => r.id === a.resourceId)?.name || "Resurs"} (kluster: ${cluster?.name || "-"})`;
}).join("\n")}${baseResult.assignments.length > 20 ? `\n... och ${baseResult.assignments.length - 20} till` : ""}

Svara ENDAST med JSON:
{
  "optimizationTips": ["förslag1", "förslag2"],
  "weatherConsiderations": ["väderrelaterat tips om relevant"],
  "clusterOptimizations": ["klusterrelaterat förslag"],
  "potentialIssues": ["problem om det finns"],
  "efficiencyBoost": 5
}
`;
    
    // Use shared persona with planning focus
    const plannerSystemPrompt = buildSystemPrompt({ role: "planner" }) + "\n" + PLANNING_PERSONA_ADDITIONS + "\nSvara ENDAST med valid JSON.";
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Upgraded for complex optimization analysis
      messages: [
        { role: "system", content: plannerSystemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" }
    });
    
    const aiResponse = JSON.parse(response.choices[0]?.message?.content || "{}");
    const tips = aiResponse.optimizationTips || [];
    const weatherTips = aiResponse.weatherConsiderations || [];
    const clusterTips = aiResponse.clusterOptimizations || [];
    
    let enhancedSummary = baseResult.summary;
    if (tips.length > 0) {
      enhancedSummary += ` AI-tips: ${tips[0]}`;
    }
    if (weatherTips.length > 0 && weatherInfo) {
      enhancedSummary += ` Väder: ${weatherTips[0]}`;
    }
    
    return {
      ...baseResult,
      summary: enhancedSummary,
      estimatedEfficiency: Math.min(100, baseResult.estimatedEfficiency + (aiResponse.efficiencyBoost || 0))
    };
  } catch (error) {
    console.error("AI enhancement failed:", error);
    return baseResult;
  }
}

// Wrapper för autoScheduleOrders med väderdata
async function autoScheduleOrdersWithWeather(
  context: PlanningContext,
  weatherImpacts: WeatherImpact[]
): Promise<AutoScheduleResult> {
  const validOrders = context.workOrders.filter(
    o => o.status !== "fakturerad" && o.status !== "utford" && o.status !== "completed"
  );
  const unscheduledOrders = validOrders.filter(
    o => !o.scheduledDate || !o.resourceId
  );
  const scheduledOrders = validOrders.filter(
    o => o.scheduledDate && o.resourceId
  );
  
  if (unscheduledOrders.length === 0) {
    return {
      assignments: [],
      summary: "Inga oschemalagda ordrar att planera.",
      totalOrdersScheduled: 0,
      estimatedEfficiency: 100
    };
  }
  
  const weekDays = getWeekDays(context.weekStart);
  const capacities = calculateResourceCapacityWithWeather(
    context.resources,
    scheduledOrders,
    weekDays,
    weatherImpacts
  );
  
  // Sortera ordrar: akuta först, sedan efter kluster
  const sortedOrders = [...unscheduledOrders].sort((a, b) => {
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const aPriority = priorityOrder[getOrderPriority(a)] ?? 2;
    const bPriority = priorityOrder[getOrderPriority(b)] ?? 2;
    if (aPriority !== bPriority) return aPriority - bPriority;
    
    // Sedan efter kluster för att gruppera
    const aCluster = a.clusterId || "zzz";
    const bCluster = b.clusterId || "zzz";
    return aCluster.localeCompare(bCluster);
  });
  
  const assignments: ScheduleAssignment[] = [];
  
  for (const order of sortedOrders) {
    const slot = findBestSlotWithWeather(order, capacities, weekDays, context.clusters, context.resources, weatherImpacts);
    
    if (slot) {
      // Uppdatera kapaciteten
      const cap = capacities.find(c => c.id === slot.resourceId);
      if (cap) {
        const hours = getOrderDuration(order) / 60;
        cap.dailyLoad[slot.date] = (cap.dailyLoad[slot.date] || 0) + hours;
      }
      
      const resource = context.resources.find(r => r.id === slot.resourceId);
      const cluster = context.clusters.find(c => c.id === order.clusterId);
      const weatherImpact = weatherImpacts.find(w => w.date === slot.date);
      
      let reason = cluster 
        ? `${resource?.name || "Resurs"} i kluster ${cluster.name}`
        : `${resource?.name || "Resurs"} baserat på tillgänglighet`;
      
      if (weatherImpact && weatherImpact.impactLevel !== "none") {
        reason += ` (väder: ${weatherImpact.reason})`;
      }
      
      assignments.push({
        workOrderId: order.id,
        resourceId: slot.resourceId,
        scheduledDate: slot.date,
        reason,
        confidence: Math.min(100, slot.score + 10)
      });
    }
  }
  
  // Beräkna effektivitet baserat på områdesmatchning, balans och väder
  const clusterMatches = assignments.filter(a => {
    const order = unscheduledOrders.find(o => o.id === a.workOrderId);
    const resource = context.resources.find(r => r.id === a.resourceId);
    if (!order?.clusterId || !resource) return false;
    const cluster = context.clusters.find(c => c.id === order.clusterId);
    return cluster && resourceServesCluster(resource, cluster);
  }).length;
  
  // Räkna dagar med bra väder
  const goodWeatherDays = assignments.filter(a => {
    const impact = weatherImpacts.find(w => w.date === a.scheduledDate);
    return !impact || impact.impactLevel === "none" || impact.impactLevel === "low";
  }).length;
  
  const weatherBonus = assignments.length > 0 
    ? Math.round((goodWeatherDays / assignments.length) * 10) 
    : 0;
  
  const efficiency = assignments.length > 0
    ? Math.round(50 + (clusterMatches / assignments.length) * 40 + weatherBonus)
    : 0;
  
  const weatherWarning = weatherImpacts.some(w => w.impactLevel === "high" || w.impactLevel === "severe")
    ? " Varning: Dåligt väder förväntas vissa dagar."
    : "";
  
  return {
    assignments,
    summary: `Schemalade ${assignments.length} av ${unscheduledOrders.length} ordrar. ${clusterMatches} matchade kluster.${weatherWarning}`,
    totalOrdersScheduled: assignments.length,
    estimatedEfficiency: Math.min(100, efficiency)
  };
}

// Beräkna kapacitet med väderkorrigering
function calculateResourceCapacityWithWeather(
  resources: Resource[],
  scheduledOrders: WorkOrder[],
  weekDays: string[],
  weatherImpacts: WeatherImpact[]
): ResourceCapacity[] {
  const capacities: ResourceCapacity[] = resources.map(r => ({
    id: r.id,
    name: r.name,
    hoursPerDay: 8,
    dailyLoad: {},
    serviceArea: r.serviceArea || []
  }));

  // Initiera alla dagar med 0 (men justera kapacitet baserat på väder)
  capacities.forEach(cap => {
    weekDays.forEach(day => {
      cap.dailyLoad[day] = 0;
    });
  });

  // Räkna befintlig belastning
  scheduledOrders.forEach(order => {
    if (!order.resourceId || !order.scheduledDate) return;
    
    const cap = capacities.find(c => c.id === order.resourceId);
    if (!cap) return;
    
    const dateStr = order.scheduledDate instanceof Date
      ? order.scheduledDate.toISOString().split("T")[0]
      : String(order.scheduledDate);
    
    const hours = getOrderDuration(order) / 60;
    cap.dailyLoad[dateStr] = (cap.dailyLoad[dateStr] || 0) + hours;
  });

  return capacities;
}

// Hitta bästa slot med väder-hänsyn
function findBestSlotWithWeather(
  order: WorkOrder,
  capacities: ResourceCapacity[],
  weekDays: string[],
  clusters: Cluster[],
  resources: Resource[],
  weatherImpacts: WeatherImpact[]
): { resourceId: string; date: string; score: number } | null {
  const orderDuration = getOrderDuration(order) / 60;
  const orderClusterId = order.clusterId;
  const orderPriority = getOrderPriority(order);
  
  const orderCluster = orderClusterId 
    ? clusters.find(c => c.id === orderClusterId) 
    : null;
  
  let bestSlot: { resourceId: string; date: string; score: number } | null = null;
  
  for (const cap of capacities) {
    for (const day of weekDays) {
      // Hämta väderkapacitetsmultiplikator för dagen
      const weatherImpact = weatherImpacts.find(w => w.date === day);
      const weatherMultiplier = weatherImpact?.capacityMultiplier ?? 1.0;
      const effectiveHoursPerDay = cap.hoursPerDay * weatherMultiplier;
      
      const availableHours = effectiveHoursPerDay - (cap.dailyLoad[day] || 0);
      
      // Kontrollera om det finns tillräckligt med tid
      if (availableHours < orderDuration) continue;
      
      let score = 50; // Baspoäng
      
      // Områdesmatchning: +30 poäng om resursen betjänar klustret
      if (orderCluster) {
        const resource = resources.find(r => r.id === cap.id);
        if (resource && resourceServesCluster(resource, orderCluster)) {
          score += 30;
        }
      }
      
      // Balanserad belastning: +0-20 poäng baserat på ledig kapacitet
      const loadRatio = (cap.dailyLoad[day] || 0) / effectiveHoursPerDay;
      score += Math.round((1 - loadRatio) * 20);
      
      // Akuta ordrar: tidigare i veckan = högre poäng
      if (orderPriority === "urgent" || orderPriority === "high") {
        const dayIndex = weekDays.indexOf(day);
        score += Math.max(0, 10 - dayIndex * 2);
      }
      
      // Väderbonus: föredra dagar med bättre väder (+0-15 poäng)
      if (weatherImpact) {
        const weatherBonus: Record<string, number> = {
          "none": 15,
          "low": 10,
          "medium": 5,
          "high": 0,
          "severe": -10
        };
        score += weatherBonus[weatherImpact.impactLevel] || 0;
      } else {
        score += 10; // Ingen väderdata = anta normalt väder
      }
      
      if (!bestSlot || score > bestSlot.score) {
        bestSlot = { resourceId: cap.id, date: day, score };
      }
    }
  }
  
  return bestSlot;
}

// ============ Setup Time Insights ============

export interface SetupTimeInsight {
  id: string;
  type: "drift" | "anomaly" | "improvement" | "reliable" | "suggestion";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  objectId?: string;
  objectName?: string;
  clusterId?: string;
  clusterName?: string;
  currentEstimate?: number;
  actualAverage?: number;
  sampleSize?: number;
  suggestion?: string;
}

export interface SetupTimeAnalysisResult {
  insights: SetupTimeInsight[];
  overallAccuracy: number; // 0-100, hur bra estimeringar matchar verklighet
  totalLogsAnalyzed: number;
  objectsWithSufficientData: number;
  summary: string;
  recommendedUpdates: Array<{
    objectId: string;
    objectName: string;
    currentEstimate: number;
    suggestedEstimate: number;
    reason: string;
  }>;
}

const MIN_SAMPLES_FOR_ANALYSIS = 3;
const DRIFT_THRESHOLD_PERCENT = 20; // 20% avvikelse = drift

export function analyzeSetupTimeLogs(
  logs: SetupTimeLog[],
  objects: ServiceObject[],
  clusters: Cluster[]
): SetupTimeAnalysisResult {
  const insights: SetupTimeInsight[] = [];
  const recommendedUpdates: SetupTimeAnalysisResult["recommendedUpdates"] = [];
  
  const objectMap = new Map(objects.map(o => [o.id, o]));
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  
  // Gruppera loggar per objekt
  const logsByObject: Record<string, SetupTimeLog[]> = {};
  logs.forEach(log => {
    if (!logsByObject[log.objectId]) {
      logsByObject[log.objectId] = [];
    }
    logsByObject[log.objectId].push(log);
  });
  
  let totalDriftScore = 0;
  let objectsWithData = 0;
  
  Object.entries(logsByObject).forEach(([objectId, objectLogs]) => {
    const object = objectMap.get(objectId);
    if (!object) return;
    
    const cluster = object.clusterId ? clusterMap.get(object.clusterId) : null;
    
    if (objectLogs.length < MIN_SAMPLES_FOR_ANALYSIS) {
      return; // Inte tillräckligt med data
    }
    
    objectsWithData++;
    
    // Beräkna statistik
    const durations = objectLogs.map(l => l.durationMinutes);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    const currentEstimate = object.avgSetupTime || 0;
    
    // Beräkna drift (skillnad mellan estimat och faktiskt)
    const driftPercent = currentEstimate > 0 
      ? ((avg - currentEstimate) / currentEstimate) * 100 
      : 100;
    
    // Uppdatera total drift score
    totalDriftScore += Math.min(100, Math.abs(driftPercent));
    
    // Detektera anomalier (outliers med z-score > 2)
    const anomalies = objectLogs.filter(l => {
      const zScore = stdDev > 0 ? Math.abs(l.durationMinutes - avg) / stdDev : 0;
      return zScore > 2;
    });
    
    // Generera insikter
    if (Math.abs(driftPercent) > DRIFT_THRESHOLD_PERCENT && currentEstimate > 0) {
      const severity = Math.abs(driftPercent) > 50 ? "high" : "medium";
      insights.push({
        id: `drift-${objectId}`,
        type: "drift",
        severity,
        title: driftPercent > 0 ? "Underskattat ställtid" : "Överskattat ställtid",
        description: `${object.name}: Estimat ${currentEstimate} min vs faktiskt snitt ${avg.toFixed(1)} min (${driftPercent > 0 ? "+" : ""}${driftPercent.toFixed(0)}%)`,
        objectId,
        objectName: object.name,
        clusterId: cluster?.id,
        clusterName: cluster?.name,
        currentEstimate,
        actualAverage: avg,
        sampleSize: objectLogs.length,
        suggestion: `Uppdatera estimat till ${Math.round(avg)} minuter baserat på ${objectLogs.length} mätningar.`
      });
      
      recommendedUpdates.push({
        objectId,
        objectName: object.name,
        currentEstimate,
        suggestedEstimate: Math.round(avg),
        reason: `Baserat på ${objectLogs.length} loggade ställtider med snitt ${avg.toFixed(1)} min.`
      });
    }
    
    // Lägg till pålitlig om låg varians
    const coefficientOfVariation = avg > 0 ? (stdDev / avg) * 100 : 0;
    if (coefficientOfVariation < 15 && objectLogs.length >= 5) {
      insights.push({
        id: `reliable-${objectId}`,
        type: "reliable",
        severity: "low",
        title: "Pålitlig ställtid",
        description: `${object.name}: Stabil ställtid (${avg.toFixed(1)}±${stdDev.toFixed(1)} min) över ${objectLogs.length} jobb.`,
        objectId,
        objectName: object.name,
        clusterId: cluster?.id,
        clusterName: cluster?.name,
        currentEstimate,
        actualAverage: avg,
        sampleSize: objectLogs.length
      });
    }
    
    // Anomali-varning
    if (anomalies.length > 0) {
      insights.push({
        id: `anomaly-${objectId}`,
        type: "anomaly",
        severity: "medium",
        title: "Avvikande mätningar",
        description: `${object.name}: ${anomalies.length} av ${objectLogs.length} mätningar avviker kraftigt från snittet.`,
        objectId,
        objectName: object.name,
        sampleSize: objectLogs.length
      });
    }
  });
  
  // Beräkna övergripande precision (0-100)
  const overallAccuracy = objectsWithData > 0 
    ? Math.max(0, Math.min(100, 100 - (totalDriftScore / objectsWithData)))
    : 100;
  
  // Kluster-analys
  const clusterStats: Record<string, { total: number; count: number; logs: number }> = {};
  logs.forEach(log => {
    const object = objectMap.get(log.objectId);
    if (!object?.clusterId) return;
    if (!clusterStats[object.clusterId]) {
      clusterStats[object.clusterId] = { total: 0, count: 0, logs: 0 };
    }
    clusterStats[object.clusterId].total += log.durationMinutes;
    clusterStats[object.clusterId].logs++;
    clusterStats[object.clusterId].count = clusterStats[object.clusterId].logs;
  });
  
  Object.entries(clusterStats).forEach(([clusterId, stats]) => {
    if (stats.logs >= 10) {
      const cluster = clusterMap.get(clusterId);
      const avgTime = stats.total / stats.logs;
      insights.push({
        id: `cluster-avg-${clusterId}`,
        type: "suggestion",
        severity: "low",
        title: `Klustersnitt: ${cluster?.name || clusterId}`,
        description: `Genomsnittlig ställtid i klustret: ${avgTime.toFixed(1)} min (${stats.logs} mätningar).`,
        clusterId,
        clusterName: cluster?.name,
        sampleSize: stats.logs
      });
    }
  });
  
  return {
    insights: insights.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    overallAccuracy: Math.round(overallAccuracy),
    totalLogsAnalyzed: logs.length,
    objectsWithSufficientData: objectsWithData,
    summary: insights.length === 0
      ? "Inga insikter tillgängliga. Samla in fler ställtidsloggar för analys."
      : `Analyserade ${logs.length} loggar från ${objectsWithData} objekt. Precision: ${Math.round(overallAccuracy)}%. ${recommendedUpdates.length} estimat behöver uppdateras.`,
    recommendedUpdates
  };
}

// --- Prediktiv Planering ---

export interface VolumeForecast {
  clusterId: string;
  clusterName: string;
  weekNumber: number;
  year: number;
  predictedOrders: number;
  predictedMinutes: number;
  historicalAverage: number;
  trend: "increasing" | "decreasing" | "stable";
  confidence: number;
  suggestedResources: number;
}

export interface PredictivePlanningResult {
  forecasts: VolumeForecast[];
  recommendations: PredictiveRecommendation[];
  summary: string;
  dataQuality: "high" | "medium" | "low";
  weeksAnalyzed: number;
}

export interface PredictiveRecommendation {
  id: string;
  type: "capacity_warning" | "resource_suggestion" | "trend_alert" | "optimization";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  clusterId?: string;
  clusterName?: string;
  actionable: boolean;
}

interface OrderHistoryData {
  weekNumber: number;
  year: number;
  clusterId: string;
  orderCount: number;
  totalMinutes: number;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function generatePredictivePlanning(
  workOrders: WorkOrder[],
  clusters: Cluster[],
  resources: Resource[],
  weeksAhead: number = 4
): Promise<PredictivePlanningResult> {
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  
  // Analysera historisk data per kluster och vecka
  const historyByClusterWeek = new Map<string, OrderHistoryData[]>();
  
  workOrders.forEach(order => {
    if (!order.scheduledDate || !order.clusterId) return;
    const date = order.scheduledDate instanceof Date ? order.scheduledDate : new Date(order.scheduledDate);
    const week = getWeekNumber(date);
    const year = date.getFullYear();
    const key = `${order.clusterId}-${year}-${week}`;
    
    if (!historyByClusterWeek.has(order.clusterId)) {
      historyByClusterWeek.set(order.clusterId, []);
    }
    
    const existing = historyByClusterWeek.get(order.clusterId)!.find(
      h => h.weekNumber === week && h.year === year
    );
    
    if (existing) {
      existing.orderCount++;
      existing.totalMinutes += order.estimatedDuration || 60;
    } else {
      historyByClusterWeek.get(order.clusterId)!.push({
        weekNumber: week,
        year,
        clusterId: order.clusterId,
        orderCount: 1,
        totalMinutes: order.estimatedDuration || 60
      });
    }
  });
  
  // Generera prognoser
  const forecasts: VolumeForecast[] = [];
  const recommendations: PredictiveRecommendation[] = [];
  const now = new Date();
  const currentWeek = getWeekNumber(now);
  const currentYear = now.getFullYear();
  
  clusters.forEach(cluster => {
    const history = historyByClusterWeek.get(cluster.id) || [];
    if (history.length < 2) return;
    
    // Beräkna historiskt snitt och trend
    const sortedHistory = history.sort((a, b) => 
      (a.year * 100 + a.weekNumber) - (b.year * 100 + b.weekNumber)
    );
    
    const avgOrders = sortedHistory.reduce((sum, h) => sum + h.orderCount, 0) / sortedHistory.length;
    const avgMinutes = sortedHistory.reduce((sum, h) => sum + h.totalMinutes, 0) / sortedHistory.length;
    
    // Enkel trendanalys - jämför senaste med tidigare
    const recentHalf = sortedHistory.slice(-Math.ceil(sortedHistory.length / 2));
    const olderHalf = sortedHistory.slice(0, Math.floor(sortedHistory.length / 2));
    
    const recentAvg = recentHalf.reduce((sum, h) => sum + h.orderCount, 0) / (recentHalf.length || 1);
    const olderAvg = olderHalf.reduce((sum, h) => sum + h.orderCount, 0) / (olderHalf.length || 1);
    
    let trend: "increasing" | "decreasing" | "stable" = "stable";
    const trendPercent = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
    if (trendPercent > 10) trend = "increasing";
    else if (trendPercent < -10) trend = "decreasing";
    
    // Confidence baserat på datamängd
    const confidence = Math.min(95, 50 + (sortedHistory.length * 5));
    
    // Prognos för kommande veckor
    for (let i = 1; i <= weeksAhead; i++) {
      let targetWeek = currentWeek + i;
      let targetYear = currentYear;
      if (targetWeek > 52) {
        targetWeek -= 52;
        targetYear++;
      }
      
      // Justera prognos baserat på trend
      const trendAdjustment = trend === "increasing" ? 1.05 : trend === "decreasing" ? 0.95 : 1.0;
      const predictedOrders = Math.round(avgOrders * Math.pow(trendAdjustment, i));
      const predictedMinutes = Math.round(avgMinutes * Math.pow(trendAdjustment, i));
      
      // Föreslå antal resurser (8h = 480 min per resurs)
      const suggestedResources = Math.ceil(predictedMinutes / (480 * 5)); // 5 dagar
      
      forecasts.push({
        clusterId: cluster.id,
        clusterName: cluster.name,
        weekNumber: targetWeek,
        year: targetYear,
        predictedOrders,
        predictedMinutes,
        historicalAverage: Math.round(avgOrders),
        trend,
        confidence,
        suggestedResources: Math.max(1, suggestedResources)
      });
    }
    
    // Generera rekommendationer
    if (trend === "increasing" && trendPercent > 20) {
      recommendations.push({
        id: `trend-${cluster.id}`,
        type: "trend_alert",
        severity: "medium",
        title: `Ökande volym i ${cluster.name}`,
        description: `Ordervolymen ökar med ${Math.round(trendPercent)}%. Överväg att allokera fler resurser.`,
        clusterId: cluster.id,
        clusterName: cluster.name,
        actionable: true
      });
    }
    
    // Varning för kapacitetsbrist
    const latestForecast = forecasts.filter(f => f.clusterId === cluster.id).slice(-1)[0];
    if (latestForecast && cluster.postalCodes && cluster.postalCodes.length > 0) {
      const matchingResources = resources.filter(r => 
        r.serviceArea?.some(area => cluster.postalCodes?.includes(area)) ?? false
      );
      
      if (matchingResources.length < latestForecast.suggestedResources) {
        recommendations.push({
          id: `capacity-${cluster.id}`,
          type: "capacity_warning",
          severity: "high",
          title: `Resursbrist i ${cluster.name}`,
          description: `Prognos kräver ${latestForecast.suggestedResources} resurser, men endast ${matchingResources.length} finns tillgängliga.`,
          clusterId: cluster.id,
          clusterName: cluster.name,
          actionable: true
        });
      }
    }
  });
  
  // Datakvalietet baserat på mängden historik
  const totalWeeksData = Array.from(historyByClusterWeek.values()).reduce(
    (sum, h) => sum + h.length, 0
  );
  const dataQuality = totalWeeksData > 50 ? "high" : totalWeeksData > 20 ? "medium" : "low";
  
  return {
    forecasts: forecasts.sort((a, b) => 
      (a.year * 100 + a.weekNumber) - (b.year * 100 + b.weekNumber)
    ),
    recommendations: recommendations.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    summary: forecasts.length > 0
      ? `Genererade ${forecasts.length} prognoser för ${clusters.length} kluster. ${recommendations.length} rekommendationer.`
      : "Otillräcklig historisk data för prognoser. Minst 2 veckors data per kluster krävs.",
    dataQuality,
    weeksAnalyzed: totalWeeksData
  };
}

// --- Automatisk Klusterbildning ---

export interface ClusterSuggestion {
  id: string;
  suggestedName: string;
  postalCodes: string[];
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  objectCount: number;
  estimatedMonthlyOrders: number;
  rationale: string;
  color: string;
}

export interface AutoClusterResult {
  suggestions: ClusterSuggestion[];
  unclusteredObjects: { id: string; name: string; postalCode: string }[];
  summary: string;
  coverage: number;
}

interface ObjectGeoData {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  postalCode: string | null;
  city: string | null;
}

const CLUSTER_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#06B6D4", "#EC4899", "#84CC16", "#F97316", "#6366F1"
];

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + 
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function groupByPostalCodePrefix(objects: ObjectGeoData[]): Map<string, ObjectGeoData[]> {
  const groups = new Map<string, ObjectGeoData[]>();
  objects.forEach(obj => {
    if (!obj.postalCode) return;
    const prefix = obj.postalCode.substring(0, 3);
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(obj);
  });
  return groups;
}

function calculateCenter(objects: ObjectGeoData[]): { lat: number; lng: number } {
  const validObjects = objects.filter(o => o.latitude && o.longitude);
  if (validObjects.length === 0) return { lat: 59.3293, lng: 18.0686 };
  
  const sumLat = validObjects.reduce((sum, o) => sum + (o.latitude || 0), 0);
  const sumLng = validObjects.reduce((sum, o) => sum + (o.longitude || 0), 0);
  return {
    lat: sumLat / validObjects.length,
    lng: sumLng / validObjects.length
  };
}

function calculateRadius(objects: ObjectGeoData[], center: { lat: number; lng: number }): number {
  const validObjects = objects.filter(o => o.latitude && o.longitude);
  if (validObjects.length === 0) return 5;
  
  let maxDist = 0;
  validObjects.forEach(obj => {
    const dist = haversineDistance(center.lat, center.lng, obj.latitude!, obj.longitude!);
    if (dist > maxDist) maxDist = dist;
  });
  return Math.max(1, Math.ceil(maxDist * 1.1));
}

export async function generateAutoClusterSuggestions(
  objects: ServiceObject[],
  existingClusters: Cluster[],
  targetClusterSize: number = 50
): Promise<AutoClusterResult> {
  const geoObjects: ObjectGeoData[] = objects.map(o => ({
    id: o.id,
    name: o.name,
    latitude: o.latitude,
    longitude: o.longitude,
    postalCode: o.postalCode,
    city: o.city
  }));
  
  const objectsWithPostalCode = geoObjects.filter(o => o.postalCode);
  const objectsWithoutPostalCode = geoObjects.filter(o => !o.postalCode);
  
  const existingPostalCodes = new Set<string>();
  existingClusters.forEach(c => {
    (c.postalCodes || []).forEach(pc => existingPostalCodes.add(pc));
  });
  
  const unassignedObjects = objectsWithPostalCode.filter(
    o => !existingPostalCodes.has(o.postalCode!)
  );
  
  if (unassignedObjects.length === 0) {
    return {
      suggestions: [],
      unclusteredObjects: objectsWithoutPostalCode.map(o => ({
        id: o.id,
        name: o.name,
        postalCode: ""
      })),
      summary: "Alla objekt med postnummer är redan tilldelade kluster.",
      coverage: (objectsWithPostalCode.length / geoObjects.length) * 100
    };
  }
  
  const postalGroups = groupByPostalCodePrefix(unassignedObjects);
  const suggestions: ClusterSuggestion[] = [];
  let colorIndex = 0;
  
  postalGroups.forEach((groupObjects, prefix) => {
    if (groupObjects.length < 3) return;
    
    const postalCodes = [...new Set(groupObjects.map(o => o.postalCode!))];
    const center = calculateCenter(groupObjects);
    const radius = calculateRadius(groupObjects, center);
    
    const cityCount = new Map<string, number>();
    groupObjects.forEach(o => {
      if (o.city) {
        cityCount.set(o.city, (cityCount.get(o.city) || 0) + 1);
      }
    });
    const dominantCity = [...cityCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Okänd";
    
    const suggestedName = `${dominantCity} ${prefix}`;
    
    suggestions.push({
      id: `suggestion-${prefix}-${Date.now()}`,
      suggestedName,
      postalCodes,
      centerLatitude: center.lat,
      centerLongitude: center.lng,
      radiusKm: radius,
      objectCount: groupObjects.length,
      estimatedMonthlyOrders: Math.round(groupObjects.length * 4),
      rationale: `${groupObjects.length} objekt i postnummerområde ${prefix}xx. Geografiskt sammanhängande med ${postalCodes.length} unika postnummer.`,
      color: CLUSTER_COLORS[colorIndex % CLUSTER_COLORS.length]
    });
    colorIndex++;
  });
  
  suggestions.sort((a, b) => b.objectCount - a.objectCount);
  
  const unassignedWithSmallGroups = unassignedObjects.filter(o => {
    const prefix = o.postalCode?.substring(0, 3);
    const group = postalGroups.get(prefix || "");
    return !group || group.length < 3;
  });
  
  const unclusteredObjects = [
    ...objectsWithoutPostalCode,
    ...unassignedWithSmallGroups
  ].map(o => ({
    id: o.id,
    name: o.name,
    postalCode: o.postalCode || ""
  }));
  
  const assignedCount = suggestions.reduce((sum, s) => sum + s.objectCount, 0);
  const alreadyAssignedCount = objectsWithPostalCode.length - unassignedObjects.length;
  const newlyAssignedCount = unassignedObjects.length - unassignedWithSmallGroups.length;
  const totalAssigned = alreadyAssignedCount + newlyAssignedCount;
  const coverage = geoObjects.length > 0 
    ? (totalAssigned / geoObjects.length) * 100
    : 0;
  
  return {
    suggestions,
    unclusteredObjects,
    summary: suggestions.length > 0
      ? `Föreslår ${suggestions.length} nya kluster baserat på ${assignedCount} objekt. ${unclusteredObjects.length} objekt kvar utan klustertillhörighet.`
      : "Kunde inte generera klusterförslag. Kontrollera att objekten har korrekta postnummer och koordinater.",
    coverage: Math.round(coverage)
  };
}

// ============================================
// AI ANOMALY EXPLANATION
// ============================================

export interface AnomalyExplanation {
  explanation: string;
  possibleCauses: string[];
  recommendations: string[];
  severity: "low" | "medium" | "high";
}

export async function explainAnomaly(
  anomalyType: "setup_time" | "cost",
  context: {
    objectName?: string;
    clusterName?: string;
    expected?: number;
    actual?: number;
    deviation?: number;
    orderTitle?: string;
    avgCost?: number;
    actualCost?: number;
    historicalData?: string;
  }
): Promise<AnomalyExplanation> {
  const prompt = anomalyType === "setup_time" 
    ? `Du är en expert på fältservice-optimering för avfallshantering i Norden.

Analysera följande ställtidsavvikelse:
- Objekt: ${context.objectName || "Okänt"}
- Kluster: ${context.clusterName || "Ej specificerat"}
- Förväntad ställtid: ${context.expected || 0} minuter
- Faktisk ställtid: ${context.actual || 0} minuter
- Avvikelse: ${context.deviation || 0}%
${context.historicalData ? `- Historik: ${context.historicalData}` : ""}

Ge en kortfattad analys på svenska med:
1. Förklaring till varför denna avvikelse kan ha uppstått
2. Möjliga orsaker (2-4 punkter)
3. Rekommenderade åtgärder (2-3 punkter)

Svara i JSON-format:
{
  "explanation": "kort sammanfattning",
  "possibleCauses": ["orsak 1", "orsak 2"],
  "recommendations": ["åtgärd 1", "åtgärd 2"],
  "severity": "low|medium|high"
}`
    : `Du är en expert på fältservice-ekonomi för avfallshantering i Norden.

Analysera följande kostnadsavvikelse:
- Order: ${context.orderTitle || "Okänd"}
- Genomsnittlig kostnad: ${context.avgCost?.toLocaleString() || 0} kr
- Faktisk kostnad: ${context.actualCost?.toLocaleString() || 0} kr
- Avvikelse: ${context.deviation || 0}%

Ge en kortfattad analys på svenska med:
1. Förklaring till varför denna kostnadsavvikelse kan ha uppstått
2. Möjliga orsaker (2-4 punkter)
3. Rekommenderade åtgärder (2-3 punkter)

Svara i JSON-format:
{
  "explanation": "kort sammanfattning",
  "possibleCauses": ["orsak 1", "orsak 2"],
  "recommendations": ["åtgärd 1", "åtgärd 2"],
  "severity": "low|medium|high"
}`;

  try {
    // Use shared persona for anomaly analysis
    const anomalySystemPrompt = buildSystemPrompt({ role: "planner", additionalContext: "Du analyserar avvikelser och ger förklaringar." }) + "\nSvara alltid i valid JSON-format.";
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: anomalySystemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        explanation: parsed.explanation || "Kunde inte analysera avvikelsen.",
        possibleCauses: parsed.possibleCauses || [],
        recommendations: parsed.recommendations || [],
        severity: parsed.severity || "medium"
      };
    }
    
    return {
      explanation: "Kunde inte generera en förklaring för denna avvikelse.",
      possibleCauses: ["Otillräcklig data"],
      recommendations: ["Samla in mer data", "Granska manuellt"],
      severity: "low"
    };
  } catch (error) {
    console.error("Error explaining anomaly:", error);
    return {
      explanation: "Ett fel uppstod vid analysen.",
      possibleCauses: ["Tekniskt fel"],
      recommendations: ["Försök igen senare"],
      severity: "low"
    };
  }
}
