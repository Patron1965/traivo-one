import OpenAI from "openai";
import type { WorkOrder, Resource, Cluster, SetupTimeLog, ServiceObject } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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

Ge 2-4 konkreta förslag för att förbättra planeringen. Fokusera på:
1. Obalans i arbetsbelastning mellan resurser
2. Oschemalagda ordrar som behöver planeras
3. Möjligheter att spara körtid genom att gruppera ordrar
4. Akuta ordrar som kanske bör flyttas tidigare

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
      model: "gpt-4o-mini",
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
  // Först: Använd algoritm-baserad schemaläggning
  const baseResult = await autoScheduleOrders(context);
  
  if (baseResult.assignments.length === 0) {
    return baseResult;
  }
  
  // Sedan: Be AI:n optimera/validera fördelningen
  try {
    const prompt = `
Du är en expert på fältserviceoptimering. Analysera denna automatiska schemaläggning och ge förbättringsförslag.

RESURSER:
${context.resources.map(r => `- ${r.name} (${r.id.slice(0,8)}), serviceArea: ${(r.serviceArea || []).join(", ") || "inget"}`).join("\n")}

SCHEMALÄGGNING (${baseResult.assignments.length} ordrar):
${baseResult.assignments.map(a => {
  const order = context.workOrders.find(o => o.id === a.workOrderId);
  return `- Order ${a.workOrderId.slice(0,8)} → ${a.resourceId.slice(0,8)} på ${a.scheduledDate} (kluster: ${order?.clusterId || "inget"})`;
}).join("\n")}

Svara ENDAST med JSON:
{
  "optimizationTips": ["förslag1", "förslag2"],
  "potentialIssues": ["problem1"],
  "efficiencyBoost": 5
}
`;
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Du är en svensk planeringsexpert. Ge korta, praktiska förslag." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: "json_object" }
    });
    
    const aiResponse = JSON.parse(response.choices[0]?.message?.content || "{}");
    const tips = aiResponse.optimizationTips || [];
    
    return {
      ...baseResult,
      summary: `${baseResult.summary}${tips.length > 0 ? ` AI-tips: ${tips[0]}` : ""}`,
      estimatedEfficiency: Math.min(100, baseResult.estimatedEfficiency + (aiResponse.efficiencyBoost || 0))
    };
  } catch (error) {
    console.error("AI enhancement failed:", error);
    return baseResult;
  }
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
