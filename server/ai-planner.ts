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
