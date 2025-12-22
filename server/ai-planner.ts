import OpenAI from "openai";
import type { WorkOrder, Resource, Cluster } from "@shared/schema";

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
