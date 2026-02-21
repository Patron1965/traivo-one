import OpenAI from "openai";
import { storage } from "./storage";
import { trackOpenAIResponse } from "./api-usage-tracker";
import { calculatePlanningKPIs } from "./ai-planner";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface InsightCard {
  id: string;
  type: "kpi" | "anomaly" | "recommendation" | "trend" | "warning";
  title: string;
  description: string;
  metric?: string;
  metricValue?: string;
  trend?: "up" | "down" | "stable";
  severity: "info" | "warning" | "critical" | "success";
  actionLabel?: string;
  actionRoute?: string;
}

export async function generateInsightCards(tenantId: string): Promise<InsightCard[]> {
  const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
    storage.getWorkOrders(tenantId),
    storage.getResources(tenantId),
    storage.getClusters(tenantId),
    storage.getSetupTimeLogs(tenantId),
  ]);

  const kpis = calculatePlanningKPIs(workOrders, resources, clusters, setupTimeLogs);

  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const activeOrders = workOrders.filter(o => o.status !== "fakturerad" && !o.deletedAt);
  const completedThisWeek = workOrders.filter(o => {
    if (!o.completedAt) return false;
    const d = o.completedAt instanceof Date ? o.completedAt : new Date(o.completedAt);
    return d >= sevenDaysAgo;
  });
  const unplannedOrders = activeOrders.filter(o => !o.scheduledDate || !o.resourceId);
  const overdueOrders = activeOrders.filter(o => {
    if (!o.scheduledDate) return false;
    const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate);
    return d < today && o.status !== "completed" && o.status !== "utford";
  });

  const dataContext = `
VECKOSTATISTIK:
- Aktiva ordrar: ${activeOrders.length}
- Slutförda denna vecka: ${completedThisWeek.length}
- Oplanerade: ${unplannedOrders.length}
- Försenade: ${overdueOrders.length}
- Resurser: ${resources.length}

KPI:er (senaste 30 dagarna):
- Slutförandegrad: ${Math.round(kpis.completionRateLast30Days)}%
- Försenade ordrar: ${Math.round(kpis.delayedOrdersPercent)}%
- Genomsnittlig ställtid: ${Math.round(kpis.avgSetupTimeMinutes)} min
- Genomsnittlig orderkostnad: ${Math.round(kpis.avgCostPerOrder)} kr

RESURSEFFEKTIVITET:
${Object.entries(kpis.resourceEfficiency).slice(0, 5).map(([name, e]) => 
  `- ${name}: ${Math.round(e.utilizationPercent)}% utnyttjande, ${e.completedOrders} ordrar, ${Math.round(e.delayRate)}% förseningar`
).join("\n")}

ANOMALIER:
- Ställtider: ${kpis.anomalousSetupTimes.length} avvikande
- Kostnader: ${kpis.costAnomalies.length} avvikande
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Du är en affärsanalytiker för fältservice. Generera 4-6 insiktskort baserat på datan.
Varje kort ska ha: typ (kpi/anomaly/recommendation/trend/warning), titel, beskrivning (max 2 meningar), 
allvarlighetsgrad (info/warning/critical/success), och eventuell åtgärd.

Returnera JSON: {"cards": [{"type": "...", "title": "...", "description": "...", "metric": "namn", "metricValue": "värde", "trend": "up/down/stable", "severity": "...", "actionLabel": "Knapptext", "actionRoute": "/path"}]}`
        },
        { role: "user", content: dataContext }
      ],
      temperature: 0.6,
      max_tokens: 1200,
      response_format: { type: "json_object" }
    });

    trackOpenAIResponse(response);
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{"cards":[]}');
    const cards: InsightCard[] = (parsed.cards || []).map((c: any, i: number) => ({
      id: `insight-${Date.now()}-${i}`,
      type: c.type || "kpi",
      title: c.title || "Insikt",
      description: c.description || "",
      metric: c.metric,
      metricValue: c.metricValue,
      trend: c.trend,
      severity: c.severity || "info",
      actionLabel: c.actionLabel,
      actionRoute: c.actionRoute,
    }));

    return cards;
  } catch (error) {
    console.error("[ai-insights] Failed to generate insights:", error);
    const fallbackCards: InsightCard[] = [];

    if (unplannedOrders.length > 10) {
      fallbackCards.push({
        id: "insight-unplanned",
        type: "warning",
        title: "Många oplanerade ordrar",
        description: `${unplannedOrders.length} ordrar saknar schema. Använd AI-planering för att tilldela dem.`,
        metric: "Oplanerade",
        metricValue: String(unplannedOrders.length),
        severity: "warning",
        actionLabel: "Planera",
        actionRoute: "/ai-planning",
      });
    }

    if (overdueOrders.length > 0) {
      fallbackCards.push({
        id: "insight-overdue",
        type: "critical" as any,
        title: "Försenade ordrar",
        description: `${overdueOrders.length} ordrar har passerat sitt schemalagda datum.`,
        metric: "Försenade",
        metricValue: String(overdueOrders.length),
        severity: "critical",
        actionLabel: "Visa försenade",
        actionRoute: "/week-planner",
      });
    }

    fallbackCards.push({
      id: "insight-completion",
      type: "kpi",
      title: "Veckoöversikt",
      description: `${completedThisWeek.length} ordrar slutförda denna vecka med ${Math.round(kpis.completionRateLast30Days)}% slutförandegrad.`,
      metric: "Slutförda",
      metricValue: String(completedThisWeek.length),
      trend: "stable",
      severity: "info",
    });

    return fallbackCards;
  }
}
