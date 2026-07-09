import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { invalidateWorkflowCaches } from "../services/dashboardCache";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback, requirePlanner } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError, UnauthorizedError } from "../errors";
import { isAuthenticated } from "../replit_integrations/auth";
import { type ServiceObject, type WorkOrderLine } from "@shared/schema";
import { resolveLocationRequirement } from "@shared/location-requirement";
import { getISOWeek } from "./helpers";
import { notificationService } from "../notifications";
import { getBatchDistances, haversineDistanceKm, type BatchPair } from "../distance-matrix-service";
import {
  enforceBudgetAndRateLimit,
  acquireSchedulingLock,
  releaseSchedulingLock,
  withRetry,
  getCachedAIResponse,
  setCachedAIResponse,
  createAICacheKey,
  invalidateAICache,
} from "../ai-budget-service";
import { isReasoningModel } from "../ai-model-capabilities";

async function aiBudgetGuard(req: Request, res: Response, useCase: "planning" | "chat" | "analysis" = "chat"): Promise<{ tenantId: string; tier: string; model: string; blocked: boolean }> {
  const tenantId = getTenantIdWithFallback(req);
  const enforcement = await enforceBudgetAndRateLimit(tenantId, useCase);
  if (!enforcement.allowed) {
    if (enforcement.errorType === "ratelimit") {
      res.set("Retry-After", String(enforcement.retryAfterSeconds || 60));
    }
    res.status(429).json({
      error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden",
      message: enforcement.errorMessage,
    });
    return { tenantId, tier: enforcement.tier, model: "gpt-5-mini", blocked: true };
  }
  return { tenantId, tier: enforcement.tier, model: enforcement.model, blocked: false };
}

export async function registerAIRoutes(app: Express) {

import("../optimization-job-runner").then(({ startJobCleanupScheduler, resetStaleJobs, scheduleProcessing }) => {
  resetStaleJobs().then(() => {
    scheduleProcessing();
  });
  startJobCleanupScheduler();
}).catch(err => console.warn("[ai-routes] Failed to start optimization job scheduler:", err));

// ============================================
// AI FIELD ASSISTANT
// ============================================
// Conversational AI with full system data access via function calling
//
// MODELLVAL (aktuell: gpt-5-mini - mest kostnadseffektiv)
// -------------------------------------------------------
// | Modell         | Pris/1M in | Pris/1M ut | Användning                    |
// |----------------|------------|------------|-------------------------------|
// | gpt-5-mini    | $0.15      | $0.60      | Standard - enklare frågor     |
// | gpt-4o         | $2.50      | $10.00     | Premium - djupare analys      |
// | gpt-4o-vision  | $2.50      | $10.00     | Enterprise - bildanalys       |
// | gpt-4.5        | ~$5.00     | ~$15.00    | Pro - avancerad planering     |
//
// UPPGRADERINGSMÖJLIGHETER:
// - Premium (gpt-4o): Bättre resonemang, optimeringsförslag för hela veckan
// - Enterprise (gpt-4o + vision): Analysera foton av skadade kärl, automatisk rapport
// - Pro (gpt-4.5): Prediktiv analys, automatisk omplanering vid sjukdom
//
// Byt modell genom att ändra "model: gpt-5-mini" till önskad modell nedan
// ============================================
app.post("/api/ai/field-assistant", requirePlanner, asyncHandler(async (req, res) => {
    const { question, jobContext, conversationHistory = [] } = req.body;
    if (!question || typeof question !== "string") {
      throw new ValidationError("Fråga krävs");
    }

    const guard = await aiBudgetGuard(req, res);
    if (guard.blocked) return;
    const { tenantId, model: aiModel } = guard;

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    // Define tools for data access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "get_todays_orders",
          description: "Hämta alla ordrar planerade för idag",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_weeks_orders",
          description: "Hämta alla ordrar för denna vecka",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_pending_orders",
          description: "Hämta alla ordrar som inte är slutförda",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_urgent_orders",
          description: "Hämta alla brådskande ordrar med hög prioritet",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_resources",
          description: "Hämta alla resurser (personal och fordon)",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "search_objects",
          description: "Sök efter objekt/platser baserat på namn eller adress",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Sökord för objekt (namn eller adress)" }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_object_details",
          description: "Hämta detaljerad information om ett specifikt objekt (portkod, anteckningar etc)",
          parameters: {
            type: "object",
            properties: {
              objectId: { type: "string", description: "ID för objektet" }
            },
            required: ["objectId"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_customers",
          description: "Hämta alla kunder i systemet",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_system_stats",
          description: "Hämta systemstatistik (antal ordrar, resurser, objekt)",
          parameters: { type: "object", properties: {}, required: [] }
        }
      },
      {
        type: "function",
        function: {
          name: "get_route_feedback",
          description: "Hämta rutt-feedback från förare (betyg 1-5 på dagliga rutter). Kan filtrera på datum.",
          parameters: {
            type: "object",
            properties: {
              startDate: { type: "string", description: "Startdatum YYYY-MM-DD" },
              endDate: { type: "string", description: "Slutdatum YYYY-MM-DD" }
            },
            required: []
          }
        }
      }
    ];

    // Tool execution helper
    const executeTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      switch (name) {
        case "get_todays_orders": {
          const orders = await storage.getWorkOrders(tenantId);
          const objects = await storage.getObjects(tenantId);
          const objectMap = new Map(objects.map(o => [o.id, o]));
          
          const todaysOrders = orders.filter(o => {
            if (!o.scheduledDate) return false;
            const orderDate = new Date(o.scheduledDate);
            return orderDate >= today && orderDate < tomorrow;
          });
          
          return JSON.stringify(todaysOrders.map(o => ({
            id: o.id,
            titel: o.title || o.description,
            status: o.orderStatus === "utford" ? "Klar" : o.orderStatus === "planerad_resurs" ? "Pågår" : "Planerad",
            tid: o.scheduledStartTime,
            plats: o.objectId ? (objectMap.get(o.objectId)?.name || objectMap.get(o.objectId)?.address) : "Okänd",
            adress: o.objectId ? objectMap.get(o.objectId)?.address : null,
            prioritet: o.priority === "high" ? "Hög" : o.priority === "medium" ? "Medium" : "Normal"
          })));
        }
        
        case "get_weeks_orders": {
          const orders = await storage.getWorkOrders(tenantId);
          const objects = await storage.getObjects(tenantId);
          const objectMap = new Map(objects.map(o => [o.id, o]));
          
          const weekOrders = orders.filter(o => {
            if (!o.scheduledDate) return false;
            const orderDate = new Date(o.scheduledDate);
            return orderDate >= weekStart && orderDate <= weekEnd;
          });
          
          return JSON.stringify({
            totalt: weekOrders.length,
            klara: weekOrders.filter(o => o.orderStatus === "utford").length,
            kvar: weekOrders.filter(o => o.orderStatus !== "utford").length,
            ordrar: weekOrders.slice(0, 10).map(o => ({
              titel: o.title || o.description,
              datum: o.scheduledDate,
              status: o.orderStatus,
              plats: o.objectId ? objectMap.get(o.objectId)?.name : null
            }))
          });
        }
        
        case "get_pending_orders": {
          const orders = await storage.getWorkOrders(tenantId);
          const objects = await storage.getObjects(tenantId);
          const objectMap = new Map(objects.map(o => [o.id, o]));
          
          const pending = orders.filter(o => o.orderStatus !== "utford" && o.orderStatus !== "avbruten");
          return JSON.stringify({
            antal: pending.length,
            ordrar: pending.slice(0, 15).map(o => ({
              titel: o.title || o.description,
              datum: o.scheduledDate,
              plats: o.objectId ? objectMap.get(o.objectId)?.name : null,
              prioritet: o.priority
            }))
          });
        }
        
        case "get_urgent_orders": {
          const orders = await storage.getWorkOrders(tenantId);
          const objects = await storage.getObjects(tenantId);
          const objectMap = new Map(objects.map(o => [o.id, o]));
          
          const urgent = orders.filter(o => o.priority === "high" && o.orderStatus !== "utford" && o.orderStatus !== "avbruten");
          return JSON.stringify({
            antal: urgent.length,
            ordrar: urgent.map(o => ({
              titel: o.title || o.description,
              datum: o.scheduledDate,
              plats: o.objectId ? objectMap.get(o.objectId)?.name : null,
              adress: o.objectId ? objectMap.get(o.objectId)?.address : null
            }))
          });
        }
        
        case "get_resources": {
          const resources = await storage.getResources(tenantId);
          return JSON.stringify({
            totalt: resources.length,
            aktiva: resources.filter(r => r.status === "active").length,
            resurser: resources.map(r => ({
              namn: r.name,
              typ: r.resourceType === "driver" ? "Förare" : r.resourceType === "vehicle" ? "Fordon" : r.resourceType,
              status: r.status === "active" ? "Aktiv" : "Inaktiv",
              telefon: r.phone
            }))
          });
        }
        
        case "search_objects": {
          const query = (args.query as string || "").toLowerCase();
          const objects = await storage.getObjects(tenantId);
          const matching = objects.filter(o => 
            o.name?.toLowerCase().includes(query) || 
            o.address?.toLowerCase().includes(query)
          ).slice(0, 10);
          
          return JSON.stringify(matching.map(o => ({
            id: o.id,
            namn: o.name,
            adress: o.address,
            portkod: o.accessCode,
            typ: o.objectType
          })));
        }
        
        case "get_object_details": {
          const objectId = args.objectId as string;
          const obj = await storage.getObject(objectId);
          if (!obj) return JSON.stringify({ error: "Objektet hittades inte" });
          
          const customer = obj.customerId ? await storage.getCustomer(obj.customerId) : null;
          
          return JSON.stringify({
            namn: obj.name,
            adress: obj.address,
            portkod: obj.accessCode,
            anteckningar: obj.notes,
            kund: customer?.name,
            typ: obj.objectType,
            lat: obj.latitude,
            lng: obj.longitude
          });
        }
        
        case "get_customers": {
          const customers = await storage.getCustomers(tenantId);
          return JSON.stringify({
            antal: customers.length,
            kunder: customers.slice(0, 20).map(c => ({
              id: c.id,
              namn: c.name,
              kontakt: c.contactPerson,
              telefon: c.phone,
              email: c.email
            }))
          });
        }
        
        case "get_system_stats": {
          const [orders, resources, objects, customers, clusters] = await Promise.all([
            storage.getWorkOrders(tenantId),
            storage.getResources(tenantId),
            storage.getObjects(tenantId),
            storage.getCustomers(tenantId),
            storage.getClusters(tenantId)
          ]);
          
          const completed = orders.filter(o => o.orderStatus === "utford").length;
          const pending = orders.filter(o => o.orderStatus !== "utford" && o.orderStatus !== "avbruten").length;
          
          return JSON.stringify({
            ordrar: { totalt: orders.length, klara: completed, väntande: pending },
            resurser: { totalt: resources.length, aktiva: resources.filter(r => r.status === "active").length },
            objekt: objects.length,
            kunder: customers.length,
            kluster: clusters.length
          });
        }
        
        case "get_route_feedback": {
          const startDate = args.startDate as string | undefined;
          const endDate = args.endDate as string | undefined;
          const summary = await storage.getRouteFeedbackSummary(tenantId, { startDate, endDate });
          const resources = await storage.getResources(tenantId);
          const resourceMap = new Map(resources.map(r => [r.id, r.name]));
          return JSON.stringify({
            snittbetyg: summary.avgRating,
            antalSvar: summary.totalCount,
            betygsfördelning: summary.ratingDistribution,
            perKategori: summary.byCategory,
            perFörare: summary.byResource.map(r => ({
              namn: resourceMap.get(r.resourceId) || r.resourceId,
              snittbetyg: r.avgRating,
              antal: r.count,
            })),
          });
        }

        default:
          return JSON.stringify({ error: "Okänt verktyg" });
      }
    }

    // Use shared persona module for consistent AI personality
    const { buildSystemPromptWithTools } = await import("../ai/persona");
    const systemPrompt = buildSystemPromptWithTools({ role: "field_worker" }) + `

VIKTIGT: Avsluta ALLTID ditt svar med exakt 2-3 föreslagna följdfrågor som användaren kan ställa.
Formatera dem på en ny rad efter ditt svar, med prefixet "FÖLJDFRÅGOR:" följt av frågorna separerade med "|".
Exempel: FÖLJDFRÅGOR:Visa mina ordrar idag|Vilka fordon är tillgängliga|Hur rapporterar jag ett problem`;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [
      {
        role: "system",
        content: systemPrompt
      }
    ];
    
    // Add conversation history (limit to last 10 messages)
    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    
    // Add current question
    messages.push({
      role: "user",
      content: question
    });

    const { trackOpenAIResponse: trackOAIResponse } = await import("../api-usage-tracker");

    let response = await withRetry(
      () => openai.chat.completions.create({
        model: aiModel,
        messages,
        tools,
        tool_choice: "auto",
        max_completion_tokens: 500,
        ...(isReasoningModel(aiModel) ? {} : { temperature: 0.5 }),
      }),
      { label: "field-assistant" }
    );

    trackOAIResponse(response, tenantId);

    let assistantMessage = response.choices[0]?.message;

    let iterations = 0;
    while (assistantMessage?.tool_calls && iterations < 3) {
      iterations++;
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tc = toolCall as any;
        const args = JSON.parse(tc.function?.arguments || "{}");
        const result = await executeTool(tc.function?.name, args);
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      }

      response = await withRetry(
        () => openai.chat.completions.create({
          model: aiModel,
          messages,
          tools,
          tool_choice: "auto",
          max_completion_tokens: 500,
          ...(isReasoningModel(aiModel) ? {} : { temperature: 0.5 }),
        }),
        { label: "field-assistant-tool" }
      );

      trackOAIResponse(response, tenantId);

      assistantMessage = response.choices[0]?.message;
    }

    let rawAnswer = assistantMessage?.content || "Jag kunde tyvärr inte hitta ett svar. Försök formulera om din fråga.";
    
    // Parse suggested follow-up questions
    let suggestedQuestions: string[] = [];
    const followUpMatch = rawAnswer.match(/FÖLJDFRÅGOR:([\s\S]+?)$/);
    if (followUpMatch) {
      suggestedQuestions = followUpMatch[1].split("|").map(q => q.trim()).filter(q => q.length > 0);
      rawAnswer = rawAnswer.replace(/\n*FÖLJDFRÅGOR:[\s\S]+$/, "").trim();
    }
    
    res.json({ 
      answer: rawAnswer,
      suggestedQuestions: suggestedQuestions.slice(0, 3)
    });
}));

// ============================================
// AI FELANMÄLAN-TOLK (fritext → strukturerat ärende)
// ============================================
// Tar emot en fritextbeskrivning ("Locket på den bruna tunnan är trasigt")
// och returnerar strukturerade förslagsfält som planeraren kan redigera
// innan ärendet sparas. Bygger på samma OpenAI-integration som övriga AI-rutter.
app.post("/api/ai/parse-issue-report", asyncHandler(async (req, res) => {
    const { text, objectName, objectType } = req.body;
    if (!text || typeof text !== "string" || text.trim().length < 3) {
      throw new ValidationError("Beskrivning krävs (minst 3 tecken)");
    }

    const guard = await aiBudgetGuard(req, res, "analysis");
    if (guard.blocked) return;
    const { tenantId, model: aiModel } = guard;

    const { parseIssueReportAI } = await import("../services/issue-parser");
    const result = await parseIssueReportAI({ text, objectName, objectType, model: aiModel, tenantId });
    res.json(result);
}));

// AI Predictive Maintenance - analyze order history to predict service needs
const handlePredictiveMaintenance = async (req: any, res: any) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const orders = await storage.getWorkOrders(tenantId);

    const objectIds = req.body?.objectIds as string[] | undefined;
    if (objectIds && (!Array.isArray(objectIds) || objectIds.length > 500)) {
      throw new ValidationError("objectIds måste vara en array med max 500 element");
    }

    const objects = objectIds && objectIds.length > 0
      ? await storage.getObjectsByIds(tenantId, objectIds)
      : await storage.getObjects(tenantId);
    
    // Build object service history map
    const objectHistory: Map<string, { lastService: Date | null; avgDaysBetweenServices: number; serviceCount: number; objectName: string }> = new Map();
    
    objects.forEach(obj => {
      const objectOrders = orders.filter(o => 
        o.objectId === obj.id && 
        (o.orderStatus === "utford" || o.orderStatus === "fakturerad")
      ).sort((a, b) => {
        const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return dateB - dateA;
      });
      
      if (objectOrders.length >= 2) {
        const intervals: number[] = [];
        for (let i = 0; i < objectOrders.length - 1; i++) {
          const current = objectOrders[i].completedAt ? new Date(objectOrders[i].completedAt!) : null;
          const previous = objectOrders[i + 1].completedAt ? new Date(objectOrders[i + 1].completedAt!) : null;
          if (current && previous) {
            const daysDiff = (current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24);
            if (daysDiff > 0 && daysDiff < 365) {
              intervals.push(daysDiff);
            }
          }
        }
        
        if (intervals.length > 0) {
          const avgInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
          const lastService = objectOrders[0].completedAt ? new Date(objectOrders[0].completedAt) : null;
          
          objectHistory.set(obj.id, {
            lastService,
            avgDaysBetweenServices: Math.round(avgInterval),
            serviceCount: objectOrders.length,
            objectName: obj.name
          });
        }
      }
    });
    
    // Predict upcoming service needs
    const predictions: { objectId: string; objectName: string; predictedDate: string; daysUntil: number; confidence: number; avgInterval: number }[] = [];
    const today = new Date();
    
    objectHistory.forEach((history, objectId) => {
      if (history.lastService && history.avgDaysBetweenServices > 0) {
        const predictedDate = new Date(history.lastService);
        predictedDate.setDate(predictedDate.getDate() + history.avgDaysBetweenServices);
        
        const daysUntil = Math.ceil((predictedDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        // Only predict within next 30 days
        if (daysUntil >= -7 && daysUntil <= 30) {
          const confidence = Math.min(95, 50 + (history.serviceCount * 5));
          predictions.push({
            objectId,
            objectName: history.objectName,
            predictedDate: predictedDate.toISOString().split("T")[0],
            daysUntil,
            confidence,
            avgInterval: history.avgDaysBetweenServices
          });
        }
      }
    });
    
    // Sort by days until (overdue first, then soonest)
    predictions.sort((a, b) => a.daysUntil - b.daysUntil);
    
    // Separate into overdue and upcoming
    const overdue = predictions.filter(p => p.daysUntil < 0).slice(0, 5);
    const upcoming = predictions.filter(p => p.daysUntil >= 0).slice(0, 10);
    
    res.json({
      overdue,
      upcoming,
      totalPredicted: predictions.length,
      summary: overdue.length > 0 
        ? `${overdue.length} objekt har passerat förväntad servicedag, ${upcoming.length} förväntas inom 30 dagar`
        : `${upcoming.length} objekt förväntas behöva service inom 30 dagar`
    });
  } catch (error) {
    console.error("Predictive maintenance error:", error);
    res.status(500).json({ error: "Kunde inte generera prediktioner" });
  }
};
app.get("/api/ai/predictive-maintenance", requirePlanner, asyncHandler(handlePredictiveMaintenance));
app.post("/api/ai/predictive-maintenance", requirePlanner, asyncHandler(handlePredictiveMaintenance));

app.post("/api/ai/service-patterns", requirePlanner, asyncHandler(async (req, res) => {
    const guard = await aiBudgetGuard(req, res);
    if (guard.blocked) return;
    const tenantId = guard.tenantId;
    const { objectIds } = req.body as { objectIds?: string[] };

    if (objectIds && (!Array.isArray(objectIds) || objectIds.length > 500)) {
      throw new ValidationError("objectIds måste vara en array med max 500 element");
    }

    const allObjects = objectIds && objectIds.length > 0
      ? await storage.getObjectsByIds(tenantId, objectIds)
      : await storage.getObjects(tenantId);

    const orders = await storage.getWorkOrders(tenantId);

    const typeStats: Record<string, { count: number; totalOrders: number; avgInterval: number; intervals: number[] }> = {};
    const anomalies: { objectId: string; objectName: string; reason: string }[] = [];

    const objectSet = new Set(allObjects.map(o => o.id));

    for (const obj of allObjects) {
      const objOrders = orders
        .filter(o => o.objectId === obj.id && (o.completedAt || o.orderStatus === "utford"))
        .sort((a, b) => {
          const da = a.completedAt ? new Date(a.completedAt).getTime() : 0;
          const db = b.completedAt ? new Date(b.completedAt).getTime() : 0;
          return da - db;
        });

      const objType = obj.objectType || "unknown";
      if (!typeStats[objType]) {
        typeStats[objType] = { count: 0, totalOrders: 0, avgInterval: 0, intervals: [] };
      }
      typeStats[objType].count++;
      typeStats[objType].totalOrders += objOrders.length;

      if (objOrders.length >= 2) {
        for (let i = 1; i < objOrders.length; i++) {
          const prev = objOrders[i - 1].completedAt ? new Date(objOrders[i - 1].completedAt!) : null;
          const curr = objOrders[i].completedAt ? new Date(objOrders[i].completedAt!) : null;
          if (prev && curr) {
            const days = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
            if (days > 0 && days < 365) {
              typeStats[objType].intervals.push(days);
            }
          }
        }
      }

      if (objOrders.length === 0) {
        anomalies.push({ objectId: obj.id, objectName: obj.name, reason: "Aldrig servat — saknar historik" });
      }
    }

    for (const [type, stats] of Object.entries(typeStats)) {
      if (stats.intervals.length > 0) {
        stats.avgInterval = Math.round(stats.intervals.reduce((a, b) => a + b, 0) / stats.intervals.length);
      }
    }

    for (const obj of allObjects) {
      const objType = obj.objectType || "unknown";
      const stats = typeStats[objType];
      if (!stats || stats.avgInterval === 0) continue;

      const objOrders = orders
        .filter(o => o.objectId === obj.id && o.completedAt)
        .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

      if (objOrders.length >= 2) {
        const lastTwo = objOrders.slice(-2);
        const interval = (new Date(lastTwo[1].completedAt!).getTime() - new Date(lastTwo[0].completedAt!).getTime()) / (1000 * 60 * 60 * 24);
        if (interval > stats.avgInterval * 1.8) {
          anomalies.push({ objectId: obj.id, objectName: obj.name, reason: `Ovanligt långt intervall (${Math.round(interval)} dagar vs snitt ${stats.avgInterval} dagar)` });
        }
      }
    }

    const patterns: { label: string; value: string }[] = [];
    patterns.push({ label: "Analyserade objekt", value: allObjects.length.toString() });

    for (const [type, stats] of Object.entries(typeStats)) {
      const typeLabel: Record<string, string> = { miljokarl: "Miljökärl", rum: "Miljörum", underjord: "Underjordsbehållare", fastighet: "Fastighet", omrade: "Område" };
      if (stats.avgInterval > 0) {
        patterns.push({ label: `${typeLabel[type] || type} — snittintervall`, value: `${stats.avgInterval} dagar (${stats.count} objekt, ${stats.totalOrders} ordrar)` });
      } else {
        patterns.push({ label: `${typeLabel[type] || type}`, value: `${stats.count} objekt, ${stats.totalOrders} ordrar` });
      }
    }

    if (anomalies.length > 0) {
      patterns.push({ label: "Avvikande objekt", value: anomalies.length.toString() });
    }

    let summary = "";
    try {
      const OpenAI = (await import("openai")).default;
      const aiClient = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const dataContext = JSON.stringify({ objectCount: allObjects.length, typeStats: Object.fromEntries(Object.entries(typeStats).map(([k, v]) => [k, { count: v.count, totalOrders: v.totalOrders, avgInterval: v.avgInterval }])), anomalyCount: anomalies.length, topAnomalies: anomalies.slice(0, 5) });

      const completion = await withRetry(() => aiClient.chat.completions.create({
        model: guard.model,
        messages: [
          { role: "system", content: "Du är en AI-assistent för fältservice-planering i Sverige. Analysera servicemönster och ge en kort sammanfattning på svenska (max 3-4 meningar). Var konkret med siffror." },
          { role: "user", content: `Analysera dessa servicemönster:\n${dataContext}` }
        ],
        max_completion_tokens: 300,
        ...(isReasoningModel(guard.model) ? {} : { temperature: 0.3 }),
      }), { label: "service-patterns" });

      const { trackOpenAIResponse: trackSPResponse } = await import("../api-usage-tracker");
      trackSPResponse(completion, guard.tenantId);
      summary = completion.choices[0]?.message?.content || "";
    } catch (aiError) {
      const totalOrders = Object.values(typeStats).reduce((sum, s) => sum + s.totalOrders, 0);
      const avgIntervals = Object.entries(typeStats).filter(([_, s]) => s.avgInterval > 0).map(([type, s]) => `${type}: ${s.avgInterval} dagar`).join(", ");
      summary = `${allObjects.length} objekt analyserade med ${totalOrders} serviceordrar totalt. Snittintervall per typ: ${avgIntervals || "ingen data"}. ${anomalies.length} objekt avviker från normalt mönster.`;
    }

    res.json({ summary, patterns, anomalies: anomalies.slice(0, 20) });
}));

// AI Proactive Tips - background anomaly analysis for proactive suggestions
// OPTIMIZED: Uses efficient SQL COUNT queries instead of fetching all records
app.get("/api/ai/proactive-tips", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    // Use optimized count queries - much faster than fetching all orders
    const counts = await storage.getWorkOrderCounts(tenantId);
    const activeResourceCount = await storage.getActiveResourceCount(tenantId);
    
    // Detect anomalies
    const tips: { type: string; severity: "info" | "warning" | "critical"; title: string; message: string; action?: string }[] = [];
    
    // Check for overdue orders
    if (counts.overdue > 0) {
      tips.push({
        type: "overdue",
        severity: counts.overdue > 5 ? "critical" : "warning",
        title: "Försenade ordrar",
        message: `Du har ${counts.overdue} ordrar som passerat sitt schemalagda datum.`,
        action: "Se veckoplanering"
      });
    }
    
    // Check for today's workload
    if (counts.todayPending > 0 && activeResourceCount > 0) {
      const ordersPerResource = counts.todayPending / activeResourceCount;
      if (ordersPerResource > 8) {
        tips.push({
          type: "workload",
          severity: "warning",
          title: "Hög arbetsbelastning",
          message: `Idag finns ${counts.todayPending} ordrar för ${activeResourceCount} resurser (${ordersPerResource.toFixed(1)} per resurs).`,
          action: "Granska planeringen"
        });
      }
    }
    
    res.json({ tips: tips.slice(0, 3) }); // Return max 3 tips
}));

// AI Planning suggestions - now with KPIs
app.post("/api/ai/planning-suggestions", requirePlanner, asyncHandler(async (req, res) => {
    const { generatePlanningSuggestions, calculatePlanningKPIs } = await import("../ai-planner");
    const { weekStart, weekEnd } = req.body;
    
    const guard = await aiBudgetGuard(req, res, "planning");
    if (guard.blocked) return;
    const tenantId = guard.tenantId;
    const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
      storage.getSetupTimeLogs(tenantId),
    ]);
    
    // Pre-calculate KPIs so they can be reused
    const kpis = calculatePlanningKPIs(workOrders, resources, clusters, setupTimeLogs);
    
    const resolvedWeekStart = weekStart || new Date().toISOString().split("T")[0];
    const resolvedWeekEnd = weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const orderStateHash = workOrders.map(o => `${o.id}:${o.orderStatus}:${o.scheduledDate || ''}:${o.resourceId || ''}`).join('|');
    const resourceStateHash = resources.map(r => `${r.id}:${r.isActive}`).join('|');
    const cacheKey = createAICacheKey({ tenantId, weekStart: resolvedWeekStart, weekEnd: resolvedWeekEnd, orderState: orderStateHash, resourceState: resourceStateHash });
    const cachedResult = getCachedAIResponse(cacheKey);
    if (cachedResult) {
      return res.json(JSON.parse(cachedResult));
    }

    const { runWithAIContext } = await import("../ai-planner");
    const suggestions = await runWithAIContext({ tenantId, model: guard.model }, () =>
      generatePlanningSuggestions({
        workOrders,
        resources,
        clusters,
        weekStart: resolvedWeekStart,
        weekEnd: resolvedWeekEnd,
        setupTimeLogs,
        kpis,
      }, { model: guard.model, tenantId })
    );

    setCachedAIResponse(cacheKey, JSON.stringify(suggestions));
    
    res.json(suggestions);
}));

app.get("/api/ai/planning-analysis", requirePlanner, asyncHandler(async (req, res) => {
    const { calculatePlanningKPIs } = await import("../ai-planner");
    const tenantId = getTenantIdWithFallback(req);
    const week = req.query.week as string || "current";
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset + (week === "next" ? 7 : 0));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);

    const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
      storage.getSetupTimeLogs(tenantId),
    ]);

    const kpis = calculatePlanningKPIs(workOrders, resources, clusters, setupTimeLogs);

    const activeOrders = workOrders.filter(o => o.orderStatus !== "fakturerad" && !o.deletedAt);
    const weekOrders = activeOrders.filter(o => {
      if (!o.scheduledDate) return false;
      const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate);
      return d >= weekStart && d <= weekEnd;
    });
    const scheduledOrders = weekOrders.filter(o => o.resourceId);
    const unscheduledWeekOrders = weekOrders.filter(o => !o.resourceId);
    const globalUnscheduled = activeOrders.filter(o => !o.scheduledDate);

    const activeResources = resources.filter(r => r.status === "active");
    const totalCapacityHours = activeResources.length * 8 * 5;
    const totalScheduledMinutes = scheduledOrders.reduce((sum, o) => sum + (o.estimatedDuration || 60), 0);
    const resourceUtilization = totalCapacityHours > 0
      ? Math.round((totalScheduledMinutes / 60 / totalCapacityHours) * 100)
      : 0;

    const dayNames = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];
    const dailyCapacity = activeResources.length * 8;
    const weeklyForecast = dayNames.map((name, i) => {
      const dayDate = new Date(weekStart);
      dayDate.setDate(weekStart.getDate() + i);
      const dayStr = dayDate.toISOString().split("T")[0];
      const dayOrders = weekOrders.filter(o => {
        const d = o.scheduledDate instanceof Date ? o.scheduledDate : new Date(o.scheduledDate!);
        return d.toISOString().split("T")[0] === dayStr;
      });
      const ordersCount = dayOrders.length;
      return {
        day: name,
        orders: ordersCount,
        capacity: dailyCapacity,
      };
    });

    const recommendations: Array<{
      id: string;
      type: string;
      priority: string;
      title: string;
      description: string;
      impact?: string;
      savings?: string;
      action?: { label: string };
    }> = [];

    if (globalUnscheduled.length > 5) {
      recommendations.push({
        id: "unscheduled",
        type: "warning",
        priority: "high",
        title: `${globalUnscheduled.length} oschemalagda ordrar`,
        description: `Det finns ${globalUnscheduled.length} arbetsordrar som saknar tilldelad resurs eller datum.`,
        impact: `Påverkar leveransförmågan`,
        action: { label: "Visa oplanerade" },
      });
    }

    const overloadedDays = weeklyForecast.filter(d => dailyCapacity > 0 && d.orders > d.capacity);
    if (overloadedDays.length > 0) {
      recommendations.push({
        id: "overloaded",
        type: "warning",
        priority: "high",
        title: `Överbelastade dagar: ${overloadedDays.map(d => d.day).join(", ")}`,
        description: `${overloadedDays.length} dagar har fler ordrar än kapacitet. Överväg omfördelning.`,
        impact: "Risk för förseningar",
        action: { label: "Omfördela ordrar" },
      });
    }

    if (resourceUtilization < 60 && scheduledOrders.length > 0) {
      recommendations.push({
        id: "low-utilization",
        type: "suggestion",
        priority: "medium",
        title: "Låg resursbeläggning",
        description: `Beläggningen är ${resourceUtilization}%. Det finns kapacitet att schemalägga fler ordrar.`,
        impact: "Ökad produktivitet",
        action: { label: "Auto-schemalägg" },
      });
    }

    if (kpis.costAnomalies.length > 0) {
      recommendations.push({
        id: "cost-anomalies",
        type: "insight",
        priority: "medium",
        title: `${kpis.costAnomalies.length} kostnadsavvikelser`,
        description: `Det finns ordrar med signifikant högre kostnad än genomsnittet.`,
        impact: `${kpis.costAnomalies.length} ordrar avviker`,
      });
    }

    if (kpis.delayedOrdersPercent > 20) {
      recommendations.push({
        id: "delay-rate",
        type: "warning",
        priority: "medium",
        title: "Hög förseningsgrad",
        description: `${kpis.delayedOrdersPercent}% av ordrar försenades de senaste 30 dagarna. Genomsnittlig försening: ${kpis.avgDelayMinutes} min.`,
        impact: "Påverkar kundnöjdhet",
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        id: "all-good",
        type: "insight",
        priority: "low",
        title: "Allt ser bra ut",
        description: "Planeringen verkar vara i balans. Inga akuta åtgärder krävs.",
        impact: "Stabil verksamhet",
      });
    }

    const totalDriveHours = Math.round(totalScheduledMinutes / 60 * 0.3);

    res.json({
      summary: {
        totalOrders: weekOrders.length + globalUnscheduled.length,
        plannedOrders: scheduledOrders.length,
        unplannedOrders: unscheduledWeekOrders.length + globalUnscheduled.length,
        estimatedDriveTime: totalDriveHours,
        resourceUtilization,
      },
      recommendations,
      weeklyForecast,
      routeOptimization: {
        currentDistance: Math.round(totalDriveHours * 35),
        optimizedDistance: Math.round(totalDriveHours * 35 * 0.82),
        savingsPercent: 18,
      },
    });
}));

// AI KPIs endpoint - get planning KPIs for dashboard/analysis
app.get("/api/ai/kpis", requirePlanner, asyncHandler(async (req, res) => {
    const { calculatePlanningKPIs } = await import("../ai-planner");
    const tenantId = getTenantIdWithFallback(req);
    
    const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
      storage.getSetupTimeLogs(tenantId),
    ]);
    
    const kpis = calculatePlanningKPIs(workOrders, resources, clusters, setupTimeLogs);
    res.json(kpis);
}));

// AI Explain Anomaly - get AI explanation for a specific anomaly
app.post("/api/ai/explain-anomaly", requirePlanner, asyncHandler(async (req, res) => {
    const { explainAnomaly } = await import("../ai-planner");
    const { anomalyType, context } = req.body;
    
    if (!anomalyType || !["setup_time", "cost"].includes(anomalyType)) {
      throw new ValidationError("Ogiltig anomalityp");
    }

    const guard = await aiBudgetGuard(req, res, "analysis");
    if (guard.blocked) return;
    
    const { runWithAIContext } = await import("../ai-planner");
    const explanation = await runWithAIContext({ tenantId: guard.tenantId, model: guard.model }, () =>
      explainAnomaly(anomalyType, context || {})
    );
    res.json(explanation);
}));

// AI Auto-Schedule - automatisk schemaläggning av oschemalagda ordrar
app.post("/api/ai/auto-schedule", requirePlanner, asyncHandler(async (req, res) => {
    const { aiEnhancedSchedule } = await import("../ai-planner");
    const { weekStart, weekEnd } = req.body;
    
    const guard = await aiBudgetGuard(req, res, "planning");
    if (guard.blocked) return;
    const { tenantId } = guard;

    const lockAcquired = await acquireSchedulingLock(tenantId);
    if (!lockAcquired) {
      throw new ConflictError("Auto-scheduling pågår redan", { message: "En annan auto-scheduling-körning pågår för er organisation. Vänta tills den är klar." });
    }

    try {
    const resolvedWeekStart = weekStart || new Date().toISOString().split("T")[0];
    const resolvedWeekEnd = weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const [workOrders, resources, clusters, setupTimeLogs, objects] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
      storage.getSetupTimeLogs(tenantId),
      storage.getObjects(tenantId),
    ]);
    
    const unscheduledOrderIds = workOrders
      .filter(o => !o.scheduledDate || !o.resourceId)
      .map(o => o.id);
    const resourceIds = resources.map(r => r.id);

    const [timeWindows, resourceAvailability, vehicleSchedules, resourceVehicles, dependencyInstances, timeRestrictions, resourceArticlesData] = await Promise.all([
      storage.getTaskTimewindowsBatch(unscheduledOrderIds),
      storage.getResourceAvailabilityByTenant(tenantId),
      storage.getVehicleSchedulesByTenant(tenantId),
      storage.getResourceVehiclesByResourceIds(resourceIds),
      storage.getTaskDependencyInstances(tenantId),
      storage.getObjectTimeRestrictionsByTenant(tenantId),
      storage.getResourceArticlesByResourceIds(resourceIds),
    ]);

    const workOrderLineBatches: WorkOrderLine[][] = [];
    const batchSize = 50;
    for (let i = 0; i < unscheduledOrderIds.length; i += batchSize) {
      const batch = unscheduledOrderIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(id => storage.getWorkOrderLines(id))
      );
      workOrderLineBatches.push(...batchResults);
    }
    const allWorkOrderLines = workOrderLineBatches.flat();

    const teamIds = [...new Set(workOrders.map(o => o.teamId).filter(Boolean))] as string[];
    const teamMemberResults = await Promise.all(
      teamIds.map(id => storage.getTeamMembers(id))
    );
    const allTeamMembers = teamMemberResults.flat();

    const constraintContext = {
      allOrders: workOrders,
      resources,
      resourceAvailability,
      vehicleSchedules,
      resourceVehicles,
      dependencyInstances,
      timeRestrictions,
      resourceArticles: resourceArticlesData,
      workOrderLines: allWorkOrderLines,
      teamMembers: allTeamMembers,
    };
    
      const { runWithAIContext } = await import("../ai-planner");
      const result = await runWithAIContext({ tenantId, model: guard.model }, () =>
        aiEnhancedSchedule({
          workOrders,
          resources,
          clusters,
          weekStart: resolvedWeekStart,
          weekEnd: resolvedWeekEnd,
          setupTimeLogs,
          timeWindows,
          constraintContext,
          objects,
        })
      );

      const userWithClaims = req.user as { claims?: { sub?: string } } | undefined;
      const userId = userWithClaims?.claims?.sub || "unknown";

      try {
        await storage.createPlanningDecisionLog({
          tenantId,
          userId,
          weekStart: resolvedWeekStart,
          weekEnd: resolvedWeekEnd,
          summary: result.decisionTrace.summary,
          moveCount: result.decisionTrace.moves.length,
          violationCount: result.decisionTrace.constraintViolations.length,
          riskScore: result.decisionTrace.summary.riskScore,
          totalOrdersScheduled: result.totalOrdersScheduled,
        });
      } catch (e) {
        console.error("[planning-audit] Failed to log decision trace:", e);
      }
      
      invalidateAICache();
      res.json(result);
    } finally {
      await releaseSchedulingLock(tenantId);
    }
}));

// Route optimization per day
app.post("/api/ai/optimize-routes", requirePlanner, asyncHandler(async (req, res) => {
    const { optimizeDayRoutes } = await import("../route-optimizer");
    const { date } = req.body;
    
    if (!date) {
      throw new ValidationError("date krävs");
    }
    
    const tenantId = getTenantIdWithFallback(req);
    const [workOrders, resources, objects] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getObjects(tenantId),
    ]);
    
    const result = await optimizeDayRoutes(date, workOrders, resources, objects);
    res.json(result);
}));

// VRP-based route optimization using Geoapify Route Planner
app.post("/api/ai/optimize-vrp", requirePlanner, asyncHandler(async (req, res) => {
    const { optimizeRoutesVRP, DEFAULT_BREAK_CONFIG } = await import("../route-optimizer");
    const { createOptimizationJob, ASYNC_THRESHOLD } = await import("../optimization-job-runner");
    const { buildTeamVehicles, buildTeamMemberMap, buildStartPointsForDate } = await import("../team-vehicles");
    const { date, clusterId, breakConfig: reqBreakConfig, constraints } = req.body;
    
    const tenantId = getTenantIdWithFallback(req);
    const [workOrders, resources, objects, clusters, tenant, teams, teamMembersAll] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getObjects(tenantId),
      storage.getClusters(tenantId),
      storage.getTenant(tenantId),
      storage.getTeams(tenantId),
      storage.getAllTeamMembers(tenantId),
    ]);

    // Task #1216: fordonens startpositioner kommer från dagens startuppgifter.
    const startPoints = buildStartPointsForDate(workOrders, date ?? null);
    const teamVehicles = buildTeamVehicles(teams, teamMembersAll, resources, startPoints);
    const teamMemberMap = buildTeamMemberMap(teams, teamMembersAll);
    if (teamVehicles.length === 0) {
      throw new ValidationError("Inga ruttbara team hittades. Lägg in en startuppgift (Hem/Hotell/Depå/Lager/Nattvila/Helgvila) med position för teamet i veckoplanen för att kunna ruttberäkna.", { success: false });
    }
    
    let filteredOrders = workOrders;
    
    if (date) {
      filteredOrders = filteredOrders.filter(o => {
        if (!o.scheduledDate) return false;
        const orderDate = o.scheduledDate instanceof Date 
          ? o.scheduledDate.toISOString().split("T")[0]
          : String(o.scheduledDate).split("T")[0];
        return orderDate === date;
      });
    }
    
    if (clusterId) {
      filteredOrders = filteredOrders.filter(o => o.clusterId === clusterId);
    }
    
    filteredOrders = filteredOrders.filter(o => 
      o.orderStatus !== "utford" && o.orderStatus !== "fakturerad"
    );

    // Task #1216: uppgifter utan geografisk koppling planeras av tidsmotorn,
    // aldrig av VRP:n.
    filteredOrders = filteredOrders.filter(o => resolveLocationRequirement(o) !== "ingen");

    const tenantSettings = (tenant?.settings as Record<string, unknown>) || {};
    const breakConfig = reqBreakConfig ?? tenantSettings.breakConfig ?? DEFAULT_BREAK_CONFIG;
    
    const constraintOptions = constraints ? {
      respectTimeWindows: constraints.respectTimeWindows !== false,
      respectSkills: constraints.respectSkills !== false,
      respectCapacity: constraints.respectCapacity === true,
      respectDependencies: constraints.respectDependencies !== false,
      tenantId,
    } : {
      respectTimeWindows: true,
      respectSkills: true,
      respectCapacity: false,
      respectDependencies: true,
      tenantId,
    };

    if (filteredOrders.length > ASYNC_THRESHOLD) {
      const jobId = await createOptimizationJob(tenantId, "vrp", {
        tenantId,
        date,
        clusterId,
        breakConfig,
        constraintOptions,
      });
      res.json({ jobId, status: "queued", orderCount: filteredOrders.length });
      return;
    }
    
    const result = await optimizeRoutesVRP(filteredOrders, teamVehicles, objects, clusters, breakConfig, { ...constraintOptions, teamMemberMap });
    res.json(result);
}));

app.get("/api/ai/optimization-job/:jobId", asyncHandler(async (req, res) => {
    const { getOptimizationJob } = await import("../optimization-job-runner");
    const tenantId = getTenantIdWithFallback(req);
    const { jobId } = req.params;

    const job = await getOptimizationJob(jobId, tenantId);
    if (!job) {
      throw new AppError("Optimeringsjobb hittades inte", 404, { code: "ERR_NOT_FOUND" });
    }

    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      result: job.status === "completed" ? job.result : undefined,
      error: job.status === "failed" ? job.error : undefined,
      attempts: job.attempts,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
}));

// AI Route Recommendations - weather and history based suggestions
app.get("/api/ai/route-recommendations", asyncHandler(async (req, res) => {
    const { fetchWeatherForecast } = await import("../weather-service");
    const tenantId = getTenantIdWithFallback(req);
    const date = req.query.date as string || new Date().toISOString().split("T")[0];
    
    const [workOrders, resources, objects, clusters] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getObjects(tenantId),
      storage.getClusters(tenantId),
    ]);
    
    // Get weather for default location (Umeå)
    const weather = await fetchWeatherForecast(63.826, 20.263, 7, tenantId);
    const todayWeather = weather.forecasts.find(f => f.date === date);
    const todayImpact = weather.impacts.find(i => i.date === date);
    
    const isCompleted = (o: typeof workOrders[0]) => 
      o.orderStatus === "utford" || o.orderStatus === "fakturerad";
    
    const todaysOrders = workOrders.filter(o => {
      if (!o.scheduledDate) return false;
      const orderDate = o.scheduledDate instanceof Date 
        ? o.scheduledDate.toISOString().split("T")[0]
        : String(o.scheduledDate).split("T")[0];
      return orderDate === date && !isCompleted(o);
    });
    
    // Calculate historical stats
    const completedOrders = workOrders.filter(isCompleted);
    const avgDuration = completedOrders.length > 0
      ? completedOrders.reduce((sum, o) => sum + (o.actualDuration || o.estimatedDuration || 60), 0) / completedOrders.length
      : 60;
    
    // Generate AI recommendations
    const recommendations: Array<{
      type: "weather" | "optimization" | "capacity" | "historical";
      priority: "high" | "medium" | "low";
      title: string;
      description: string;
      actionable?: string;
    }> = [];
    
    // Weather-based recommendations
    if (todayImpact && todayImpact.impactLevel !== "none") {
      recommendations.push({
        type: "weather",
        priority: todayImpact.impactLevel === "severe" || todayImpact.impactLevel === "high" ? "high" : "medium",
        title: `Vädervarning: ${todayImpact.reason}`,
        description: todayImpact.recommendations.join(". ") || "Anpassa planering efter väderförhållanden.",
        actionable: `Kapacitet justerad till ${Math.round(todayImpact.capacityMultiplier * 100)}%`,
      });
    }
    
    // Capacity recommendations
    const ordersPerResource: Record<string, number> = {};
    todaysOrders.forEach(o => {
      if (o.resourceId) {
        ordersPerResource[o.resourceId] = (ordersPerResource[o.resourceId] || 0) + 1;
      }
    });
    
    const maxOrders = Math.max(...Object.values(ordersPerResource), 0);
    const minOrders = Math.min(...Object.values(ordersPerResource).filter(n => n > 0), maxOrders);
    
    if (maxOrders > 0 && maxOrders - minOrders > 3) {
      const overloadedResource = resources.find(r => ordersPerResource[r.id] === maxOrders);
      recommendations.push({
        type: "capacity",
        priority: "medium",
        title: "Ojämn arbetsbelastning",
        description: `${overloadedResource?.name || "En resurs"} har ${maxOrders} ordrar medan andra har färre.`,
        actionable: "Omfördela ordrar för bättre balans",
      });
    }
    
    // Route optimization recommendations - check for unassigned orders
    const unassignedOrders = todaysOrders.filter(o => !o.resourceId);
    if (unassignedOrders.length > 3) {
      recommendations.push({
        type: "optimization",
        priority: "medium",
        title: "Ordrar ej tilldelade",
        description: `${unassignedOrders.length} ordrar saknar tilldelad resurs.`,
        actionable: "Kör VRP-optimering för bättre rutter",
      });
    }
    
    // Historical insights
    if (avgDuration > 90) {
      recommendations.push({
        type: "historical",
        priority: "low",
        title: "Längre genomsnittlig tid",
        description: `Genomsnittlig ordertid är ${Math.round(avgDuration)} min. Överväg att planera mer tid per order.`,
      });
    }
    
    const currentRoutes: Array<{ resourceId: string; resourceName: string; orders: Array<{ title: string; address: string; orderId: string }> }> = [];
    const resourceOrdersMap = new Map<string, typeof todaysOrders>();
    todaysOrders.forEach(o => {
      if (!o.resourceId) return;
      if (!resourceOrdersMap.has(o.resourceId)) resourceOrdersMap.set(o.resourceId, []);
      resourceOrdersMap.get(o.resourceId)!.push(o);
    });
    Array.from(resourceOrdersMap.entries()).forEach(([resId, orders]) => {
      const res2 = resources.find(r => r.id === resId);
      currentRoutes.push({
        resourceId: resId,
        resourceName: res2?.name || resId,
        orders: orders.map((o: typeof todaysOrders[0]) => ({
          title: o.title || o.orderNumber || "Order",
          address: o.address || "",
          orderId: o.id,
        })),
      });
    });

    const objectMap = new Map(objects.map(o => [o.id, o]));
    let currentRouteStats: { totalDistanceKm: number; totalDurationMinutes: number; avgEfficiency: number } | null = null;
    try {
      const assignedOrders = todaysOrders.filter(o => o.resourceId);
      if (assignedOrders.length > 0) {
        let totalDistanceKm = 0;
        let totalWorkMinutes = 0;
        let totalDriveMinutes = 0;
        let totalRouteLegs = 0;

        type OrderType = typeof todaysOrders[0];
        const resEntries = Array.from(resourceOrdersMap.entries());
        for (let e = 0; e < resEntries.length; e++) {
          const [resId, resOrders] = resEntries[e];
          const res2 = resources.find(r => r.id === resId);

          const sortedOrders = resOrders.slice().sort((a: OrderType, b: OrderType) => {
            const aTime = a.scheduledStartTime || "";
            const bTime = b.scheduledStartTime || "";
            if (aTime && bTime) return aTime.localeCompare(bTime);
            if (aTime) return -1;
            if (bTime) return 1;
            return 0;
          });

          const ordersWithCoords = sortedOrders
            .map((o: OrderType) => {
              const obj = objectMap.get(o.objectId);
              return { order: o, lat: obj?.latitude ?? null, lng: obj?.longitude ?? null };
            })
            .filter((x: { order: OrderType; lat: number | null; lng: number | null }): x is { order: OrderType; lat: number; lng: number } => x.lat != null && x.lng != null);

          if (ordersWithCoords.length === 0) continue;

          const resWork = ordersWithCoords.reduce((s: number, x: { order: OrderType }) => s + (x.order.estimatedDuration || 60), 0);
          totalWorkMinutes += resWork;

          const pairs: BatchPair[] = [];
          let prevLat = res2?.homeLatitude ?? ordersWithCoords[0].lat;
          let prevLng = res2?.homeLongitude ?? ordersWithCoords[0].lng;

          for (let i = 0; i < ordersWithCoords.length; i++) {
            pairs.push({
              id: `leg-${resId}-${i}`,
              fromLat: prevLat,
              fromLng: prevLng,
              toLat: ordersWithCoords[i].lat,
              toLng: ordersWithCoords[i].lng,
            });
            prevLat = ordersWithCoords[i].lat;
            prevLng = ordersWithCoords[i].lng;
          }

          const distances = await getBatchDistances(pairs);
          let resDist = 0;
          let resDrive = 0;
          for (let i = 0; i < ordersWithCoords.length; i++) {
            const r = distances.get(`leg-${resId}-${i}`);
            if (r) {
              resDist += r.distanceKm;
              resDrive += r.durationMin;
            } else {
              const d = haversineDistanceKm(
                i === 0 ? (res2?.homeLatitude ?? ordersWithCoords[0].lat) : ordersWithCoords[i - 1].lat,
                i === 0 ? (res2?.homeLongitude ?? ordersWithCoords[0].lng) : ordersWithCoords[i - 1].lng,
                ordersWithCoords[i].lat, ordersWithCoords[i].lng
              );
              resDist += d;
              resDrive += Math.round((d / 35) * 60);
            }
          }

          totalDistanceKm += resDist;
          totalDriveMinutes += resDrive;
          totalRouteLegs += pairs.length;
        }

        if (totalRouteLegs > 0) {
          const totalTime = totalWorkMinutes + totalDriveMinutes;
          currentRouteStats = {
            totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
            totalDurationMinutes: Math.round(totalTime),
            avgEfficiency: totalTime > 0 ? Math.round((totalWorkMinutes / totalTime) * 100) : 0,
          };
        }
      }
    } catch (err) {
      console.warn("[route-recommendations] Failed to calculate current route stats:", err instanceof Error ? err.message : err);
    }

    res.json({
      date,
      weather: todayWeather ? {
        temperature: todayWeather.temperature,
        precipitation: todayWeather.precipitation,
        windSpeed: todayWeather.windSpeed,
        description: todayWeather.weatherDescription,
        impact: todayImpact?.impactLevel || "none",
        capacityMultiplier: todayImpact?.capacityMultiplier || 1.0,
      } : null,
      statistics: {
        totalOrders: todaysOrders.length,
        assignedOrders: todaysOrders.filter(o => o.resourceId).length,
        activeResources: Object.keys(ordersPerResource).length,
        avgDurationMinutes: Math.round(avgDuration),
      },
      currentRouteStats,
      currentRoutes,
      recommendations,
      summary: recommendations.length > 0 
        ? `${recommendations.filter(r => r.priority === "high").length} höga, ${recommendations.filter(r => r.priority === "medium").length} medel prioriterade förslag`
        : "Inga särskilda rekommendationer för idag",
    });
}));

// Apply VRP optimization - update order sequence
app.post("/api/ai/optimize-vrp/apply", requirePlanner, asyncHandler(async (req, res) => {
    const { routes } = req.body as { 
      routes: Array<{
        resourceId: string;
        stops: Array<{
          orderId: string;
          sequence: number;
        }>;
      }>;
    };
    
    if (!Array.isArray(routes)) {
      throw new ValidationError("routes måste vara en array");
    }
    
    const results: Array<{ orderId: string; success: boolean; error?: string }> = [];
    
    // route.resourceId är teamId (team-baserad ruttoptimering).
    // Tilldela ordern till teamet och nollställ ev. tidigare individuell resurs.
    for (const route of routes) {
      for (const stop of route.stops) {
        try {
          const updated = await storage.updateWorkOrder(stop.orderId, {
            teamId: route.resourceId,
            resourceId: null,
          });
          results.push({ orderId: stop.orderId, success: !!updated });
        } catch (err) {
          results.push({ orderId: stop.orderId, success: false, error: String(err) });
        }
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    res.json({ 
      applied: successCount, 
      total: results.length,
      message: `${successCount} ordrar tilldelade till team enligt optimerad rutt`,
      results 
    });
}));

const requireSystemAdmin = async (req: any, res: any, next: any) => {
  const replitUser = req.user;
  const sessionUserId = (req.session as any)?.userId;
  const userId = replitUser?.claims?.sub || sessionUserId;
  if (!userId) {
    return next(new UnauthorizedError("Ej autentiserad"));
  }
  try {
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return next(new UnauthorizedError("Ej autentiserad"));
    }
    const role = dbUser.role || "user";
    if (role !== "admin" && role !== "owner") {
      return next(new ForbiddenError("Systemadministratörsrättigheter krävs."));
    }
    return next();
  } catch {
    return res.status(500).json({ error: "Kunde inte verifiera behörighet" });
  }
};

app.get("/api/admin/distance-cache", isAuthenticated, requireSystemAdmin, asyncHandler(async (_req, res) => {
    const { getDistanceCacheStats, getL2CacheStats } = await import("../distance-matrix-service");
    const l1Stats = getDistanceCacheStats();
    const l2Stats = await getL2CacheStats();
    res.json({ ...l1Stats, ...l2Stats });
}));

app.delete("/api/admin/distance-cache", isAuthenticated, requireSystemAdmin, asyncHandler(async (_req, res) => {
    const { clearDistanceCache } = await import("../distance-matrix-service");
    const result = await clearDistanceCache();
    res.json({ message: "Distance cache cleared", ...result });
}));

app.post("/api/admin/distance-cache/cleanup", isAuthenticated, requireSystemAdmin, asyncHandler(async (_req, res) => {
    const { cleanupExpiredL2 } = await import("../distance-matrix-service");
    const removed = await cleanupExpiredL2();
    res.json({ message: "Expired L2 entries removed", removed });
}));

// Apply auto-schedule assignments
app.post("/api/ai/auto-schedule/apply", requirePlanner, asyncHandler(async (req, res) => {
    const { assignments } = req.body as { assignments: Array<{
      workOrderId: string;
      resourceId: string;
      scheduledDate: string;
    }> };
    
    if (!Array.isArray(assignments)) {
      throw new ValidationError("assignments måste vara en array");
    }
    
    const results = await Promise.all(
      assignments.map(async (a) => {
        try {
          const updated = await storage.updateWorkOrder(a.workOrderId, {
            resourceId: a.resourceId,
            scheduledDate: new Date(a.scheduledDate + "T12:00:00Z"),
          });
          return { workOrderId: a.workOrderId, success: !!updated };
        } catch (err) {
          return { workOrderId: a.workOrderId, success: false, error: String(err) };
        }
      })
    );
    
    const successCount = results.filter(r => r.success).length;
    res.json({ 
      applied: successCount, 
      total: assignments.length,
      results 
    });
}));

// Workload analysis - detect imbalances
app.post("/api/ai/workload-analysis", requirePlanner, asyncHandler(async (req, res) => {
    const { analyzeWorkloadImbalances } = await import("../ai-planner");
    const { weekStart, weekEnd } = req.body;
    
    const tenantId = getTenantIdWithFallback(req);
    const [workOrders, resources, clusters] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
    ]);
    
    const analysis = analyzeWorkloadImbalances({
      workOrders,
      resources,
      clusters,
      weekStart: weekStart || new Date().toISOString().split("T")[0],
      weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });
    
    res.json(analysis);
}));

app.post("/api/ai/planner-chat", requirePlanner, asyncHandler(async (req, res) => {
    const { processConversationalPlannerQueryV2 } = await import("../ai-planner");
    const { query, weekStart, weekEnd, conversationHistory } = req.body;
    
    if (!query || typeof query !== "string") {
      throw new ValidationError("Fråga krävs");
    }
    
    const guard = await aiBudgetGuard(req, res, "planning");
    if (guard.blocked) return;
    const tenantId = guard.tenantId;
    const [workOrders, resources, clusters] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
    ]);
    
    const today = new Date().toISOString().split("T")[0];
    const weekEndDefault = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    
    const { runWithAIContext } = await import("../ai-planner");
    const response = await runWithAIContext({ tenantId, model: guard.model }, () =>
      processConversationalPlannerQueryV2(query, {
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || today,
        weekEnd: weekEnd || weekEndDefault,
      }, conversationHistory || [])
    );
    
    res.json(response);
}));

// Execute conversational planner action (reschedule, etc.)
app.post("/api/ai/planner-chat/execute", requirePlanner, asyncHandler(async (req, res) => {
    const { action, params, workOrderIds, toResourceId, toDate } = req.body;
    
    if (!action || typeof action !== "string") {
      throw new ValidationError("Åtgärd krävs", { success: false });
    }
    
    const tenantId = getTenantIdWithFallback(req);
    
    // Verify orders belong to tenant before modifying
    if (workOrderIds && Array.isArray(workOrderIds)) {
      const tenantOrders = await storage.getWorkOrders(tenantId);
      const tenantOrderIds = new Set(tenantOrders.map(o => o.id));
      const invalidIds = workOrderIds.filter((id: string) => !tenantOrderIds.has(id));
      if (invalidIds.length > 0) {
        throw new ForbiddenError(`Åtkomst nekad för ordrar: ${invalidIds.slice(0, 3).join(", ")}`, { success: false });
      }
    }
    
    if (action === "reschedule_to_resource" && workOrderIds && toResourceId) {
      let successCount = 0;
      for (const orderId of workOrderIds) {
        try {
          await storage.updateWorkOrder(orderId, { resourceId: toResourceId }, tenantId);
          successCount++;
        } catch (e) {
          console.error(`Failed to update order ${orderId}:`, e);
        }
      }
      invalidateAICache();
      return res.json({ 
        success: true, 
        message: `${successCount} av ${workOrderIds.length} ordrar har omtilldelats.`,
        affectedOrders: workOrderIds
      });
    }
    
    if (action === "reschedule_to_date" && workOrderIds && toDate) {
      let successCount = 0;
      for (const orderId of workOrderIds) {
        try {
          await storage.updateWorkOrder(orderId, { scheduledDate: toDate }, tenantId);
          successCount++;
        } catch (e) {
          console.error(`Failed to update order ${orderId}:`, e);
        }
      }
      invalidateAICache();
      return res.json({ 
        success: true, 
        message: `${successCount} av ${workOrderIds.length} ordrar har flyttats till ${toDate}.`,
        affectedOrders: workOrderIds
      });
    }
    
    throw new ValidationError("Ogiltig åtgärd eller saknade parametrar.", { success: false });
}));

// AI Setup Time Insights
app.get("/api/ai/setup-insights", requirePlanner, asyncHandler(async (req, res) => {
    const { analyzeSetupTimeLogs } = await import("../ai-planner");
    
    const tenantId = getTenantIdWithFallback(req);
    const [logs, objects, clusters] = await Promise.all([
      storage.getSetupTimeLogs(tenantId),
      storage.getObjects(tenantId),
      storage.getClusters(tenantId),
    ]);
    
    const analysis = analyzeSetupTimeLogs(logs, objects, clusters);
    res.json(analysis);
}));

// Apply recommended setup time updates
app.post("/api/ai/apply-setup-updates", requirePlanner, asyncHandler(async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new ValidationError("Updates måste vara en icke-tom array");
    }
    
    // Validera varje uppdatering
    const validUpdates = updates.filter(update => 
      typeof update.objectId === "string" && 
      typeof update.suggestedEstimate === "number" &&
      update.suggestedEstimate >= 0
    );
    
    if (validUpdates.length === 0) {
      throw new ValidationError("Inga giltiga uppdateringar");
    }
    
    const results = await Promise.all(
      validUpdates.map(async (update: { objectId: string; suggestedEstimate: number }) => {
        try {
          const updated = await storage.updateObject(update.objectId, { 
            avgSetupTime: Math.round(update.suggestedEstimate)
          });
          return { objectId: update.objectId, success: !!updated };
        } catch (e) {
          console.error(`Failed to update object ${update.objectId}:`, e);
          return { objectId: update.objectId, success: false };
        }
      })
    );
    
    const successCount = results.filter(r => r.success).length;
    res.json({ 
      success: successCount > 0, 
      message: `Uppdaterade ${successCount} av ${validUpdates.length} objekt.`,
      results 
    });
}));

// AI Predictive Planning
app.get("/api/ai/predictive-planning", requirePlanner, asyncHandler(async (req, res) => {
    const weeksAhead = parseInt(req.query.weeksAhead as string) || 4;
    
    const { generatePredictivePlanning } = await import("../ai-planner");
    const tenantId = getTenantIdWithFallback(req);
    const workOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true, 5000);
    const clusters = await storage.getClusters(tenantId);
    const resources = await storage.getResources(tenantId);
    
    const validClusters = clusters.filter(c => c.postalCodes && c.postalCodes.length > 0);
    
    const result = await generatePredictivePlanning(
      workOrders, 
      validClusters.length > 0 ? validClusters : clusters, 
      resources, 
      Math.min(weeksAhead, 12)
    );
    
    res.json(result);
}));

// Simple weather for today (mobile app)
app.get("/api/weather/today", asyncHandler(async (_req, res) => {
    const { fetchWeatherForecast } = await import("../weather-service");
    const result = await fetchWeatherForecast(63.826, 20.263, 1);
    
    if (result.forecasts && result.forecasts.length > 0) {
      const today = result.forecasts[0];
      res.json({
        temperature: today.temperature,
        description: today.weatherDescription,
        windSpeed: today.windSpeed,
        precipitation: today.precipitation,
      });
    } else {
      res.json({
        temperature: 5,
        description: "Molnigt",
        windSpeed: 8,
        precipitation: 0,
      });
    }
}));

// Weather forecast for capacity planning
app.get("/api/weather/forecast", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const tenantSettings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const weatherEnabled = tenantSettings.weatherPlanningEnabled !== false;

    if (!weatherEnabled) {
      return res.json({
        location: { latitude: 0, longitude: 0 },
        forecasts: [],
        impacts: [],
        summary: "Väderprognos avstängd i tenant-inställningar.",
        disabled: true,
      });
    }

    let latitude = parseFloat(req.query.latitude as string);
    let longitude = parseFloat(req.query.longitude as string);
    let locationName: string | undefined;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const clusters = await storage.getClusters(tenantId);
      const active = clusters.filter(c => c.centerLatitude != null && c.centerLongitude != null);
      if (active.length > 0) {
        latitude = active.reduce((s, c) => s + (c.centerLatitude as number), 0) / active.length;
        longitude = active.reduce((s, c) => s + (c.centerLongitude as number), 0) / active.length;
        locationName = active.length === 1
          ? active[0].name
          : `Mittpunkt över ${active.length} kluster`;
      } else {
        latitude = 59.3293;
        longitude = 18.0686;
        locationName = "Stockholm (standard)";
      }
    }

    const rawDays = parseInt(req.query.days as string);
    const days = Math.max(1, Math.min(Number.isFinite(rawDays) ? rawDays : 7, 14));

    const weekStartStr = req.query.weekStart as string | undefined;
    const dateStr = req.query.date as string | undefined;
    let filterStart: Date | undefined;
    let filterEnd: Date | undefined;
    if (weekStartStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
      filterStart = new Date(`${weekStartStr}T00:00:00Z`);
      filterEnd = new Date(filterStart.getTime() + days * 86400000);
    } else if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      filterStart = new Date(`${dateStr}T00:00:00Z`);
      filterEnd = new Date(filterStart.getTime() + 86400000);
    }

    const { fetchWeatherForecast } = await import("../weather-service");
    const result = await fetchWeatherForecast(latitude, longitude, days, tenantId);

    let { forecasts, impacts } = result;
    if (filterStart && filterEnd) {
      const startIso = filterStart.toISOString().slice(0, 10);
      const endIso = filterEnd.toISOString().slice(0, 10);
      forecasts = forecasts.filter(f => f.date >= startIso && f.date < endIso);
      impacts = impacts.filter(i => i.date >= startIso && i.date < endIso);
    }

    res.json({
      ...result,
      forecasts,
      impacts,
      location: { ...result.location, name: locationName ?? result.location.name },
    });
}));

// Weather impact for specific cluster
app.get("/api/weather/cluster/:clusterId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getCluster(req.params.clusterId);
    if (!cluster || !verifyTenantOwnership(cluster, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    
    const latitude = cluster.centerLatitude || 59.3293;
    const longitude = cluster.centerLongitude || 18.0686;
    const days = parseInt(req.query.days as string) || 7;
    
    const { fetchWeatherForecast } = await import("../weather-service");
    const result = await fetchWeatherForecast(latitude, longitude, Math.min(days, 14));
    
    res.json({
      ...result,
      location: { ...result.location, name: cluster.name }
    });
}));

// Delete all data (for re-import)
app.get("/api/import/batches", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const allObjects = await storage.getObjects(tenantId);
    const allWorkOrders = await storage.getWorkOrders(tenantId);
    const allCustomers = await storage.getCustomers(tenantId);
    
    const batchMap = new Map<string, { batchId: string; objects: number; workOrders: number; customers: number; importedAt: string | null; scorecardSummary: unknown }>();
    
    for (const obj of allObjects) {
      if (obj.importBatchId) {
        if (!batchMap.has(obj.importBatchId)) {
          batchMap.set(obj.importBatchId, { batchId: obj.importBatchId, objects: 0, workOrders: 0, customers: 0, importedAt: obj.createdAt ? new Date(obj.createdAt).toISOString() : null, scorecardSummary: null });
        }
        batchMap.get(obj.importBatchId)!.objects++;
      }
    }
    
    for (const wo of allWorkOrders) {
      if (wo.importBatchId) {
        if (!batchMap.has(wo.importBatchId)) {
          batchMap.set(wo.importBatchId, { batchId: wo.importBatchId, objects: 0, workOrders: 0, customers: 0, importedAt: wo.createdAt ? new Date(wo.createdAt).toISOString() : null, scorecardSummary: null });
        }
        batchMap.get(wo.importBatchId)!.workOrders++;
      }
    }
    
    for (const c of allCustomers) {
      if (c.importBatchId) {
        if (!batchMap.has(c.importBatchId)) {
          batchMap.set(c.importBatchId, { batchId: c.importBatchId, objects: 0, workOrders: 0, customers: 0, importedAt: c.createdAt ? new Date(c.createdAt).toISOString() : null, scorecardSummary: null });
        }
        batchMap.get(c.importBatchId)!.customers++;
      }
    }
    
    try {
      const { importBatches: importBatchesTable } = await import("@shared/schema");
      const persistedBatches = await db.select().from(importBatchesTable).where(eq(importBatchesTable.tenantId, tenantId));
      for (const pb of persistedBatches) {
        const existing = batchMap.get(pb.batchId);
        if (existing) {
          existing.scorecardSummary = pb.scorecardSummary;
          (existing as Record<string, unknown>).scorecardCategories = (pb.metadata as Record<string, unknown>)?.scorecardCategories || null;
        }
      }
    } catch {}
    
    const batches = Array.from(batchMap.values()).sort((a, b) => 
      (b.importedAt || '').localeCompare(a.importedAt || '')
    );
    
    res.json(batches);
}));

app.delete("/api/import/batch/:batchId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { batchId } = req.params;
    
    let deletedObjects = 0;
    let deletedWorkOrders = 0;
    let deletedCustomers = 0;
    
    let deletedWorkOrderLines = 0;
    const allWorkOrders = await storage.getWorkOrders(tenantId);
    for (const wo of allWorkOrders) {
      if (wo.importBatchId === batchId) {
        const lines = await storage.getWorkOrderLines(wo.id);
        for (const line of lines) {
          // Skippa per-rad recalc — hela arbetsordern raderas direkt efter.
          await storage.deleteWorkOrderLine(line.id, { skipRecalc: true });
          deletedWorkOrderLines++;
        }
        await storage.deleteWorkOrder(wo.id);
        deletedWorkOrders++;
      }
    }
    
    const allObjects = await storage.getObjects(tenantId);
    const batchObjects = allObjects.filter(o => o.importBatchId === batchId);
    const childFirst = batchObjects.sort((a, b) => (b.objectLevel || 0) - (a.objectLevel || 0));
    for (const obj of childFirst) {
      await storage.deleteObject(obj.id);
      deletedObjects++;
    }
    
    const allCustomers = await storage.getCustomers(tenantId);
    for (const c of allCustomers) {
      if (c.importBatchId === batchId) {
        await storage.deleteCustomer(c.id);
        deletedCustomers++;
      }
    }
    
    res.json({ 
      deleted: { objects: deletedObjects, workOrders: deletedWorkOrders, customers: deletedCustomers, workOrderLines: deletedWorkOrderLines },
      batchId 
    });
}));

app.delete("/api/import/clear/:type", asyncHandler(async (req, res) => {
    const { type } = req.params;
    const tenantId = getTenantIdWithFallback(req);
    
    if (type === "customers") {
      const customers = await storage.getCustomers(tenantId);
      for (const c of customers) {
        await storage.deleteCustomer(c.id);
      }
      res.json({ deleted: customers.length });
    } else if (type === "resources") {
      const resources = await storage.getResources(tenantId);
      for (const r of resources) {
        await storage.deleteResource(r.id);
      }
      res.json({ deleted: resources.length });
    } else if (type === "objects") {
      const objects = await storage.getObjects(tenantId);
      for (const o of objects) {
        await storage.deleteObject(o.id);
      }
      res.json({ deleted: objects.length });
    } else if (type === "work-orders") {
      const workOrders = await storage.getWorkOrders(tenantId);
      for (const wo of workOrders) {
        await storage.deleteWorkOrder(wo.id);
      }
      res.json({ deleted: workOrders.length });
    } else {
      throw new ValidationError("Okänd typ");
    }
}));

// Notification token endpoint - generates auth token for WebSocket connection
// Requires authentication and validates resource ownership
app.post("/api/notifications/token", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { resourceId } = req.body;
    
    if (!resourceId) {
      throw new ValidationError("resourceId required");
    }
    
    // Validate resource exists
    const resource = await storage.getResource(resourceId);
    if (!resource) {
      throw new NotFoundError("Resurs hittades inte");
    }
    
    // Verify resource belongs to the same tenant
    // In production, you might also verify that the authenticated user
    // is allowed to access this specific resource
    const tenantId = getTenantIdWithFallback(req);
    if (resource.tenantId !== tenantId) {
      console.log(`[notifications] Token request denied: resource ${resourceId} belongs to different tenant`);
      throw new ForbiddenError("Ej behörig att komma åt denna resurs");
    }
    
    // Generate token for this resource
    const token = notificationService.generateAuthToken(resourceId, tenantId);
    
    console.log(`[notifications] Token generated for resource ${resourceId} by user ${req.user?.claims?.sub || "unknown"}`);
    
    res.json({ 
      token,
      expiresIn: 300, // 5 minutes
      resourceId 
    });
}));

app.post("/api/ai/suggest-placement", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const guard = await aiBudgetGuard(req, res, "planning");
    if (guard.blocked) return;

    const schema = z.object({
      workOrderId: z.string(),
      weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekStart måste vara YYYY-MM-DD"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const { workOrderId, weekStart } = parsed.data;
    const tenantId = guard.tenantId;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) throw new NotFoundError("Arbetsorder hittades inte");
    await verifyTenantOwnership(workOrder.tenantId, tenantId, "work_order");

    // Ladda effektiva leveranspreferenser så placering kan respektera slottider.
    const { EMPTY_DELIVERY_PREFERENCES } = await import("@shared/schema");
    type DeliveryPrefs = import("@shared/schema").DeliveryPreferences;
    type ResolvedPrefs = { effective: DeliveryPrefs; source: "object" | "none" };
    const deliveryPrefs: ResolvedPrefs = workOrder.objectId
      ? await storage.resolveDeliveryPreferences(workOrder.objectId)
      : { effective: EMPTY_DELIVERY_PREFERENCES, source: "none" };

    const allResources = await storage.getResources(tenantId);
    const activeResources = allResources.filter(r => r.status === "active" && r.resourceType === "person");

    const weekStartDate = new Date(weekStart + "T00:00:00Z");
    const weekDays: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStartDate);
      d.setUTCDate(d.getUTCDate() + i);
      weekDays.push(d.toISOString().split("T")[0]);
    }

    const allOrders = await storage.getWorkOrders(tenantId);
    const scheduledOrders = allOrders.filter(o => o.scheduledDate && o.resourceId).map(o => ({
      ...o,
      scheduledDate: typeof o.scheduledDate === "string" ? o.scheduledDate.split("T")[0] : o.scheduledDate,
    }));

    const objectLat = workOrder.taskLatitude || (workOrder as any).objectLatitude;
    const objectLng = workOrder.taskLongitude || (workOrder as any).objectLongitude;

    const HOURS_IN_DAY = 8;
    const jobDuration = (workOrder.estimatedDuration || 60) / 60;

    type Suggestion = {
      resourceId: string;
      resourceName: string;
      date: string;
      startTime: string;
      score: number;
      reasons: string[];
    };

    const suggestions: Suggestion[] = [];

    for (const resource of activeResources) {
      for (const day of weekDays) {
        const dayOrders = scheduledOrders.filter(o => o.resourceId === resource.id && o.scheduledDate === day);
        const dayHours = dayOrders.reduce((sum, o) => sum + ((o.estimatedDuration || 0) / 60), 0);
        const remainingCapacity = HOURS_IN_DAY - dayHours;

        if (remainingCapacity < jobDuration) continue;

        let score = 50;
        const reasons: string[] = [];

        const capacityPct = dayHours / HOURS_IN_DAY;
        if (capacityPct < 0.3) {
          score += 5;
          reasons.push("Låg beläggning denna dag");
        } else if (capacityPct < 0.7) {
          score += 10;
          reasons.push("Bra kapacitetsutnyttjande");
        } else {
          score -= 5;
          reasons.push("Hög beläggning denna dag");
        }

        if (objectLat && objectLng) {
          let minDist = Infinity;
          let closestCoord: { lat: number; lng: number } | null = null;
          for (const o of dayOrders) {
            const oLat = o.taskLatitude || (o as any).objectLatitude;
            const oLng = o.taskLongitude || (o as any).objectLongitude;
            if (oLat && oLng) {
              const dist = haversineDistanceKm(objectLat, objectLng, oLat, oLng);
              if (dist < minDist) { minDist = dist; closestCoord = { lat: oLat, lng: oLng }; }
            }
          }
          if (minDist < 5) {
            score += 25;
            reasons.push(`Nära befintligt jobb (${minDist.toFixed(1)} km fågelväg)`);
          } else if (minDist < 15) {
            score += 15;
            reasons.push(`Relativt nära befintligt jobb (${minDist.toFixed(1)} km fågelväg)`);
          } else if (minDist < 50) {
            score += 5;
            reasons.push(`Inom rimligt avstånd (${minDist.toFixed(1)} km fågelväg)`);
          }

          if (resource.homeLatitude && resource.homeLongitude) {
            const homeDist = haversineDistanceKm(objectLat, objectLng, resource.homeLatitude, resource.homeLongitude);
            if (homeDist < 10) {
              score += 10;
              reasons.push(`Nära resursens utgångsplats (${homeDist.toFixed(1)} km fågelväg)`);
            }
          }
        }

        if (resource.serviceArea && resource.serviceArea.length > 0 && workOrder.clusterId) {
          if (resource.serviceArea.includes(workOrder.clusterId)) {
            score += 15;
            reasons.push("Resurs tilldelad detta område");
          }
        }

        // Justera score utifrån kundens/objektets leveranspreferenser.
        const dayDate = new Date(day + "T00:00:00Z");
        const weekday = dayDate.getUTCDay();
        const dayWindows = (deliveryPrefs.effective.weeklyWindows || []).filter(w => w.weekday === weekday);
        const isStrict = deliveryPrefs.effective.priority === "strict";
        if (deliveryPrefs.source !== "none") {
          const blockedDay = (deliveryPrefs.effective.blockedDates || []).includes(day);
          if (blockedDay) {
            if (isStrict) continue; // hoppa helt — får inte planeras denna dag
            score -= 30;
            reasons.push("Kunden har markerat dagen som blockerad");
          } else if (dayWindows.length > 0) {
            score += isStrict ? 25 : 12;
            reasons.push(
              isStrict
                ? `Inom kundens strikta slottid (${dayWindows.map(w => `${w.start}-${w.end}`).join(", ")})`
                : `Inom kundens önskade slottid (${dayWindows.map(w => `${w.start}-${w.end}`).join(", ")})`,
            );
          }
        }

        let startTime = "07:00";
        const sortedExisting = dayOrders
          .filter(o => o.scheduledStartTime)
          .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
        if (sortedExisting.length > 0) {
          const last = sortedExisting[sortedExisting.length - 1];
          const [h, m] = (last.scheduledStartTime || "07:00").split(":").map(Number);
          const endMin = h * 60 + m + (last.estimatedDuration || 60);
          if (endMin >= 17 * 60) continue;
          startTime = `${Math.floor(endMin / 60).toString().padStart(2, "0")}:${(endMin % 60).toString().padStart(2, "0")}`;
        }

        // Om kunden har slottider, försök placera startTime inom ett av fönstren.
        // Strict => hård regel (skip om ingen passar); preferred => mjuk (justera + behåll).
        if (dayWindows.length > 0) {
          const toMin = (s: string) => {
            const [h, m] = s.split(":").map(Number);
            return h * 60 + m;
          };
          const toHHMM = (mins: number) =>
            `${Math.floor(mins / 60).toString().padStart(2, "0")}:${(mins % 60).toString().padStart(2, "0")}`;
          const startMin = toMin(startTime);
          const finishMin = startMin + (jobDuration * 60);
          const fits = dayWindows.find(w => startMin >= toMin(w.start) && finishMin <= toMin(w.end));
          if (!fits) {
            // Hitta första fönster där hela jobbet ryms efter startMin
            const candidate = dayWindows
              .map(w => ({ start: toMin(w.start), end: toMin(w.end) }))
              .filter(w => w.end - w.start >= jobDuration * 60)
              .sort((a, b) => a.start - b.start)
              .find(w => w.start >= startMin || w.end >= finishMin);
            if (candidate) {
              const newStart = Math.max(candidate.start, startMin);
              if (newStart + jobDuration * 60 <= candidate.end) {
                startTime = toHHMM(newStart);
                reasons.push(
                  isStrict
                    ? `Justerad starttid ${startTime} för att rymmas i strikt slottid`
                    : `Justerad starttid ${startTime} för att möta önskad slottid`,
                );
              } else if (isStrict) {
                continue;
              } else {
                score -= 15;
                reasons.push("Kan ej placeras inom önskad slottid");
              }
            } else if (isStrict) {
              continue;
            } else {
              score -= 15;
              reasons.push("Kan ej placeras inom önskad slottid");
            }
          }
        }

        suggestions.push({
          resourceId: resource.id,
          resourceName: resource.name,
          date: day,
          startTime,
          score,
          reasons,
        });
      }
    }

    if (objectLat && objectLng && suggestions.length > 0) {
      const topCandidates = [...suggestions].sort((a, b) => b.score - a.score).slice(0, 15);
      const distPairs: BatchPair[] = [];

      for (const s of topCandidates) {
        const resource = activeResources.find(r => r.id === s.resourceId);
        if (!resource) continue;

        const dayOrders = scheduledOrders.filter(o => o.resourceId === s.resourceId && o.scheduledDate === s.date);
        let closestOrder: typeof dayOrders[0] | null = null;
        let closestHav = Infinity;
        for (const o of dayOrders) {
          const oLat = o.taskLatitude || (o as any).objectLatitude;
          const oLng = o.taskLongitude || (o as any).objectLongitude;
          if (oLat && oLng) {
            const d = haversineDistanceKm(objectLat, objectLng, oLat, oLng);
            if (d < closestHav) { closestHav = d; closestOrder = o; }
          }
        }

        if (closestOrder && closestHav < 50) {
          const cLat = closestOrder.taskLatitude || (closestOrder as any).objectLatitude;
          const cLng = closestOrder.taskLongitude || (closestOrder as any).objectLongitude;
          if (cLat && cLng) {
            distPairs.push({
              id: `job-${s.resourceId}-${s.date}`,
              fromLat: objectLat, fromLng: objectLng,
              toLat: cLat, toLng: cLng,
            });
          }
        }

        if (resource.homeLatitude && resource.homeLongitude) {
          distPairs.push({
            id: `home-${s.resourceId}`,
            fromLat: objectLat, fromLng: objectLng,
            toLat: resource.homeLatitude, toLng: resource.homeLongitude,
          });
        }
      }

      if (distPairs.length > 0) {
        const distances = await getBatchDistances(distPairs);

        for (const s of topCandidates) {
          const jobKey = `job-${s.resourceId}-${s.date}`;
          const homeKey = `home-${s.resourceId}`;
          const jobDist = distances.get(jobKey);
          const homeDist = distances.get(homeKey);

          let adjustment = 0;
          if (jobDist && jobDist.source === "geoapify") {
            const havDist = haversineDistanceKm(objectLat, objectLng,
              distPairs.find(p => p.id === jobKey)!.toLat,
              distPairs.find(p => p.id === jobKey)!.toLng);
            const realVsHav = jobDist.distanceKm / Math.max(havDist, 0.1);
            if (realVsHav > 1.8) {
              adjustment -= 15;
              s.reasons.push(`Verklig körtid ${jobDist.durationMin} min (${jobDist.distanceKm.toFixed(1)} km väg)`);
            } else if (realVsHav < 1.2) {
              adjustment += 5;
              s.reasons.push(`Bra vägförbindelse (${jobDist.distanceKm.toFixed(1)} km, ${jobDist.durationMin} min)`);
            } else {
              s.reasons.push(`Körtid ${jobDist.durationMin} min (${jobDist.distanceKm.toFixed(1)} km väg)`);
            }
          }

          if (homeDist && homeDist.source === "geoapify") {
            const havHome = haversineDistanceKm(objectLat, objectLng,
              distPairs.find(p => p.id === homeKey)!.toLat,
              distPairs.find(p => p.id === homeKey)!.toLng);
            const homeRatio = homeDist.distanceKm / Math.max(havHome, 0.1);
            if (homeRatio > 2.0) {
              adjustment -= 10;
            }
          }

          s.score += adjustment;
        }
      }
    }

    const resourceIds = activeResources.map(r => r.id);
    const allResourceArticles = await storage.getResourceArticlesByResourceIds(resourceIds);
    const orderLines = await storage.getWorkOrderLines(workOrderId);
    const orderArticleIds = new Set(orderLines.filter(l => l.articleId).map(l => l.articleId));

    for (const suggestion of suggestions) {
      if (orderArticleIds.size > 0) {
        const resArticleIds = new Set(
          allResourceArticles.filter(ra => ra.resourceId === suggestion.resourceId).map(ra => ra.articleId)
        );
        if (resArticleIds.size === 0) {
          suggestion.score -= 10;
          suggestion.reasons.push("Saknar registrerad kompetens");
        } else {
          let matched = 0;
          for (const aid of orderArticleIds) {
            if (resArticleIds.has(aid)) matched++;
          }
          const matchRatio = matched / orderArticleIds.size;
          if (matchRatio === 1) {
            suggestion.score += 20;
            suggestion.reasons.push("Full kompetens-match för alla artiklar");
          } else if (matchRatio > 0) {
            suggestion.score += Math.round(matchRatio * 15);
            suggestion.reasons.push(`Kompetens-match för ${matched}/${orderArticleIds.size} artiklar`);
          } else {
            suggestion.score -= 10;
            suggestion.reasons.push("Saknar kompetens för orderns artiklar");
          }
        }
      }
    }

    suggestions.sort((a, b) => b.score - a.score);
    const topSuggestions = suggestions.slice(0, 3);

    res.json({
      workOrderId,
      workOrderTitle: workOrder.title,
      suggestions: topSuggestions,
    });
}));

app.post("/api/ai/resource-competency-check", requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      resourceId: z.string(),
      articleIds: z.array(z.string()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const { resourceId, articleIds } = parsed.data;
    const tenantId = getTenantIdWithFallback(req);

    const tenantResources = await storage.getResources(tenantId);
    const validResource = tenantResources.find(r => r.id === resourceId);
    if (!validResource) {
      throw new ForbiddenError("Resursen tillhör inte din organisation");
    }

    if (articleIds.length === 0) {
      return res.json({ hasWarning: false, missingArticles: [] });
    }

    const resourceArticlesData = await storage.getResourceArticles(resourceId);
    const allArticles = await storage.getArticles(tenantId);
    const articleMap = new Map(allArticles.map(a => [a.id, a]));

    if (resourceArticlesData.length === 0) {
      const missingArticles = articleIds.map(id => ({
        id,
        name: articleMap.get(id)?.name || id,
      }));
      return res.json({
        hasWarning: true,
        missingArticles,
        message: `Resursen saknar registrerad kompetens för ${missingArticles.length} artikel(ar): ${missingArticles.map(a => a.name).join(", ")}`,
      });
    }

    const resourceArticleIds = new Set(resourceArticlesData.map(ra => ra.articleId));
    const missingArticleIds = articleIds.filter(id => !resourceArticleIds.has(id));

    if (missingArticleIds.length === 0) {
      return res.json({ hasWarning: false, missingArticles: [] });
    }

    const missingArticles = missingArticleIds.map(id => ({
      id,
      name: articleMap.get(id)?.name || id,
    }));

    res.json({
      hasWarning: true,
      missingArticles,
      message: `Resursen saknar kompetens för ${missingArticles.length} artikel(ar): ${missingArticles.map(a => a.name).join(", ")}`,
    });
}));

app.post("/api/ai/suggest-resource-for-new-order", requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      objectId: z.string(),
      articleIds: z.array(z.string()).optional().default([]),
      estimatedDuration: z.number().optional().default(60),
      priority: z.string().optional().default("normal"),
      weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const { objectId, articleIds, estimatedDuration, priority, weekStart } = parsed.data;
    const tenantId = getTenantIdWithFallback(req);

    const obj = await storage.getObject(objectId);
    if (!obj) throw new NotFoundError("Objekt hittades inte");

    const [allResources, allOrders, clusters, resourceAvailability, vehicleSchedules, timeRestrictions] = await Promise.all([
      storage.getResources(tenantId),
      storage.getWorkOrders(tenantId),
      storage.getClusters(tenantId),
      storage.getResourceAvailabilityByTenant(tenantId),
      storage.getVehicleSchedulesByTenant(tenantId),
      storage.getObjectTimeRestrictionsByTenant(tenantId),
    ]);

    const activeResources = allResources.filter(r => r.status === "active" && r.resourceType === "person");
    const resourceIds = activeResources.map(r => r.id);

    const [allResourceArticles, resourceVehicles] = await Promise.all([
      storage.getResourceArticlesByResourceIds(resourceIds),
      storage.getResourceVehiclesByResourceIds(resourceIds),
    ]);

    const weekStartDate = new Date(weekStart + "T00:00:00Z");
    const weekDays: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStartDate);
      d.setUTCDate(d.getUTCDate() + i);
      weekDays.push(d.toISOString().split("T")[0]);
    }

    const scheduledOrders = allOrders.filter(o => o.scheduledDate && o.resourceId);

    const objectLat = obj.latitude;
    const objectLng = obj.longitude;
    const HOURS_IN_DAY = 8;
    const jobDuration = estimatedDuration / 60;

    type Suggestion = {
      resourceId: string;
      resourceName: string;
      date: string;
      startTime: string;
      score: number;
      reasons: string[];
    };
    const suggestions: Suggestion[] = [];

    const { validateSchedule } = await import("../planning/constraintEngine");

    for (const resource of activeResources) {
      for (const day of weekDays) {
        const dayOrders = scheduledOrders.filter(o => {
          const d = o.scheduledDate instanceof Date ? o.scheduledDate.toISOString().split("T")[0] : String(o.scheduledDate).split("T")[0];
          return o.resourceId === resource.id && d === day;
        });
        const dayHours = dayOrders.reduce((sum, o) => sum + ((o.estimatedDuration || 0) / 60), 0);
        const remainingCapacity = HOURS_IN_DAY - dayHours;
        if (remainingCapacity < jobDuration) continue;

        const constraintViolations = validateSchedule(
          [{ workOrderId: "__preview__", resourceId: resource.id, scheduledDate: day }],
          {
            allOrders,
            resources: allResources,
            resourceAvailability,
            vehicleSchedules,
            resourceVehicles,
            dependencyInstances: [],
            timeRestrictions,
            resourceArticles: allResourceArticles,
            workOrderLines: [],
            teamMembers: [],
          }
        );
        const hardViolations = constraintViolations.filter(v => v.type === "hard" && v.category !== "competency");
        if (hardViolations.length > 0) continue;

        let score = 50;
        const reasons: string[] = [];

        const capacityPct = dayHours / HOURS_IN_DAY;
        if (capacityPct < 0.3) { score += 5; reasons.push("Låg beläggning"); }
        else if (capacityPct < 0.7) { score += 10; reasons.push("Bra kapacitet"); }
        else { score -= 5; reasons.push("Hög beläggning"); }

        if (objectLat && objectLng) {
          let minDist = Infinity;
          for (const o of dayOrders) {
            const oLat = o.taskLatitude;
            const oLng = o.taskLongitude;
            if (oLat && oLng) {
              const dist = haversineDistanceKm(objectLat, objectLng, oLat, oLng);
              if (dist < minDist) minDist = dist;
            }
          }
          if (minDist < 5) { score += 25; reasons.push(`Nära befintligt jobb (${minDist.toFixed(1)} km fågelväg)`); }
          else if (minDist < 15) { score += 15; reasons.push(`Relativt nära (${minDist.toFixed(1)} km fågelväg)`); }
          else if (minDist < 50) { score += 5; reasons.push(`Inom rimligt avstånd (${minDist.toFixed(1)} km fågelväg)`); }

          if (resource.homeLatitude && resource.homeLongitude) {
            const homeDist = haversineDistanceKm(objectLat, objectLng, resource.homeLatitude, resource.homeLongitude);
            if (homeDist < 10) { score += 10; reasons.push(`Nära utgångsplats (${homeDist.toFixed(1)} km fågelväg)`); }
          }
        }

        if (resource.serviceArea && resource.serviceArea.length > 0 && obj.clusterId) {
          const cluster = clusters.find(c => c.id === obj.clusterId);
          if (cluster) {
            const clusterPostals = cluster.postalCodes || [];
            if (resource.serviceArea.some(p => clusterPostals.includes(p))) {
              score += 30;
              reasons.push(`Klustermatchning (${cluster.name})`);
            } else {
              score -= 10;
              reasons.push("Utanför klustrets serviceområde");
            }
          }
        }

        if (priority === "urgent" || priority === "high") {
          const dayIndex = weekDays.indexOf(day);
          score += Math.max(0, 10 - dayIndex * 2);
          if (dayIndex === 0) reasons.push("Tidigast möjliga dag");
        }

        if (articleIds.length > 0) {
          const resArticleIds = new Set(
            allResourceArticles.filter(ra => ra.resourceId === resource.id).map(ra => ra.articleId)
          );
          if (resArticleIds.size === 0) {
            score -= 10;
            reasons.push("Saknar registrerad kompetens");
          } else {
            let matched = 0;
            for (const aid of articleIds) { if (resArticleIds.has(aid)) matched++; }
            const matchRatio = matched / articleIds.length;
            if (matchRatio === 1) { score += 20; reasons.push("Full kompetens-match"); }
            else if (matchRatio > 0) { score += Math.round(matchRatio * 15); reasons.push(`Kompetens ${matched}/${articleIds.length}`); }
            else { score -= 10; reasons.push("Saknar kompetens för artiklarna"); }
          }
        }

        let startTime = "07:00";
        const sortedExisting = dayOrders
          .filter(o => o.scheduledStartTime)
          .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
        if (sortedExisting.length > 0) {
          const last = sortedExisting[sortedExisting.length - 1];
          const [h, m] = (last.scheduledStartTime || "07:00").split(":").map(Number);
          const endMin = h * 60 + m + (last.estimatedDuration || 60);
          if (endMin >= 17 * 60) continue;
          startTime = `${Math.floor(endMin / 60).toString().padStart(2, "0")}:${(endMin % 60).toString().padStart(2, "0")}`;
        }

        suggestions.push({ resourceId: resource.id, resourceName: resource.name, date: day, startTime, score, reasons });
      }
    }

    suggestions.sort((a, b) => b.score - a.score);
    res.json({ suggestions: suggestions.slice(0, 3) });
}));

app.post("/api/ai/auto-distribute-today", requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const today = new Date().toISOString().split("T")[0];

    const [allOrders, allResources, clusters, objects] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
      storage.getObjects(tenantId),
    ]);

    const activeResources = allResources.filter(r => r.status === "active" && r.resourceType === "person");

    const unplannedToday = allOrders.filter(o => {
      if (o.orderStatus === "utford" || o.orderStatus === "avbruten" || o.orderStatus === "fakturerad") return false;
      if (o.resourceId) return false;
      if (!o.scheduledDate) return true;
      const dateStr = o.scheduledDate instanceof Date
        ? o.scheduledDate.toISOString().split("T")[0]
        : String(o.scheduledDate).split("T")[0];
      return dateStr === today || !o.scheduledDate;
    });

    if (unplannedToday.length === 0) {
      return res.json({ assignments: [], summary: "Inga oplanerade ordrar att fördela idag.", totalAssigned: 0 });
    }

    const resourceIds = allResources.map(r => r.id);
    const unscheduledOrderIds = unplannedToday.map(o => o.id);

    const [resourceAvailability, vehicleSchedules, resourceVehicles, dependencyInstances, timeRestrictions, allResourceArticles] = await Promise.all([
      storage.getResourceAvailabilityByTenant(tenantId),
      storage.getVehicleSchedulesByTenant(tenantId),
      storage.getResourceVehiclesByResourceIds(resourceIds),
      storage.getTaskDependencyInstances(tenantId),
      storage.getObjectTimeRestrictionsByTenant(tenantId),
      storage.getResourceArticlesByResourceIds(resourceIds),
    ]);

    const workOrderLineBatches: WorkOrderLine[][] = [];
    const batchSize = 50;
    for (let i = 0; i < unscheduledOrderIds.length; i += batchSize) {
      const batch = unscheduledOrderIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(id => storage.getWorkOrderLines(id)));
      workOrderLineBatches.push(...batchResults);
    }
    const allWorkOrderLines = workOrderLineBatches.flat();

    const teamIds = [...new Set(allOrders.map(o => o.teamId).filter(Boolean))] as string[];
    const teamMemberResults = await Promise.all(teamIds.map(id => storage.getTeamMembers(id)));
    const allTeamMembers = teamMemberResults.flat();

    const constraintCtx = {
      allOrders,
      resources: allResources,
      resourceAvailability,
      vehicleSchedules,
      resourceVehicles,
      dependencyInstances,
      timeRestrictions,
      resourceArticles: allResourceArticles,
      workOrderLines: allWorkOrderLines,
      teamMembers: allTeamMembers,
    };

    const { validateSchedule } = await import("../planning/constraintEngine");

    const objectMap = new Map(objects.map(o => [o.id, o]));
    const resourceArticleMap: Record<string, Set<string>> = {};
    for (const ra of allResourceArticles) {
      if (!resourceArticleMap[ra.resourceId]) resourceArticleMap[ra.resourceId] = new Set();
      resourceArticleMap[ra.resourceId].add(ra.articleId);
    }

    const scheduledToday = allOrders.filter(o => {
      if (!o.scheduledDate || !o.resourceId) return false;
      const dateStr = o.scheduledDate instanceof Date
        ? o.scheduledDate.toISOString().split("T")[0]
        : String(o.scheduledDate).split("T")[0];
      return dateStr === today;
    });

    const HOURS_IN_DAY = 8;
    const resourceLoad: Record<string, number> = {};
    for (const r of activeResources) { resourceLoad[r.id] = 0; }
    for (const o of scheduledToday) {
      if (o.resourceId && resourceLoad[o.resourceId] !== undefined) {
        resourceLoad[o.resourceId] += (o.estimatedDuration || 60) / 60;
      }
    }

    const sortedOrders = [...unplannedToday].sort((a, b) => {
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      return (priorityOrder[a.priority || "normal"] ?? 2) - (priorityOrder[b.priority || "normal"] ?? 2);
    });

    const preDistPairs: BatchPair[] = [];
    for (const order of sortedOrders) {
      const obj = order.objectId ? objectMap.get(order.objectId) : null;
      if (!obj?.latitude || !obj?.longitude) continue;
      for (const resource of activeResources) {
        if (!resource.homeLatitude || !resource.homeLongitude) continue;
        const havDist = haversineDistanceKm(obj.latitude, obj.longitude, resource.homeLatitude, resource.homeLongitude);
        if (havDist < 50) {
          preDistPairs.push({
            id: `ad-${order.id}-${resource.id}`,
            fromLat: obj.latitude, fromLng: obj.longitude,
            toLat: resource.homeLatitude, toLng: resource.homeLongitude,
          });
        }
      }
    }
    const realDistMap = preDistPairs.length > 0 ? await getBatchDistances(preDistPairs) : new Map();

    type Assignment = {
      workOrderId: string;
      workOrderTitle: string;
      resourceId: string;
      resourceName: string;
      scheduledDate: string;
      score: number;
      reasons: string[];
      constraintWarnings: string[];
    };

    const assignments: Assignment[] = [];

    for (const order of sortedOrders) {
      const jobDuration = (order.estimatedDuration || 60) / 60;
      let bestResource: { id: string; name: string; score: number; reasons: string[]; constraintWarnings: string[] } | null = null;

      const orderArticleIds = new Set(
        allWorkOrderLines.filter(l => l.workOrderId === order.id && l.articleId).map(l => l.articleId)
      );
      const obj = order.objectId ? objectMap.get(order.objectId) : null;

      for (const resource of activeResources) {
        const remaining = HOURS_IN_DAY - (resourceLoad[resource.id] || 0);
        if (remaining < jobDuration) continue;

        const violations = validateSchedule(
          [{ workOrderId: order.id, resourceId: resource.id, scheduledDate: today }],
          constraintCtx
        );
        const hardViolations = violations.filter(v => v.type === "hard");
        if (hardViolations.length > 0) continue;

        const softWarnings = violations.filter(v => v.type === "soft").map(v => v.description);

        let score = 50;
        const reasons: string[] = [];

        const loadPct = (resourceLoad[resource.id] || 0) / HOURS_IN_DAY;
        if (loadPct < 0.3) { score += 5; reasons.push("Låg beläggning"); }
        else if (loadPct < 0.7) { score += 10; reasons.push("Bra kapacitet"); }
        else { score -= 5; reasons.push("Hög beläggning"); }

        if (obj?.latitude && obj?.longitude && resource.homeLatitude && resource.homeLongitude) {
          const realKey = `ad-${order.id}-${resource.id}`;
          const realDist = realDistMap.get(realKey);
          if (realDist && realDist.source === "geoapify") {
            if (realDist.distanceKm < 15) { score += 20; reasons.push(`Nära (${realDist.distanceKm.toFixed(1)} km, ${realDist.durationMin} min)`); }
            else if (realDist.distanceKm < 40) { score += 10; reasons.push(`Rimligt avstånd (${realDist.distanceKm.toFixed(1)} km, ${realDist.durationMin} min)`); }
            else { reasons.push(`Avstånd ${realDist.distanceKm.toFixed(1)} km (${realDist.durationMin} min)`); }
          } else {
            const havDist = haversineDistanceKm(obj.latitude, obj.longitude, resource.homeLatitude, resource.homeLongitude);
            if (havDist < 10) { score += 20; reasons.push(`Nära (${havDist.toFixed(1)} km fågelväg)`); }
            else if (havDist < 30) { score += 10; reasons.push(`Rimligt avstånd (${havDist.toFixed(1)} km fågelväg)`); }
          }
        }

        if (resource.serviceArea && resource.serviceArea.length > 0 && order.clusterId) {
          const cluster = clusters.find(c => c.id === order.clusterId);
          if (cluster) {
            const clusterPostals = cluster.postalCodes || [];
            if (resource.serviceArea.some(p => clusterPostals.includes(p))) {
              score += 30;
              reasons.push(`Klustermatchning (${cluster.name})`);
            } else {
              score -= 10;
              reasons.push("Utanför klustrets serviceområde");
            }
          }
        }

        if (orderArticleIds.size > 0) {
          if (!resourceArticleMap[resource.id]?.size) {
            score -= 10;
            reasons.push("Saknar registrerad kompetens");
          } else {
            let matched = 0;
            for (const aid of orderArticleIds) {
              if (resourceArticleMap[resource.id].has(aid)) matched++;
            }
            const ratio = matched / orderArticleIds.size;
            if (ratio === 1) { score += 20; reasons.push("Full kompetens-match"); }
            else if (ratio > 0) { score += Math.round(ratio * 15); reasons.push(`Delvis kompetens (${matched}/${orderArticleIds.size})`); }
            else { score -= 10; reasons.push("Saknar kompetens"); }
          }
        }

        if (softWarnings.length > 0) {
          score -= softWarnings.length * 5;
        }

        if (!bestResource || score > bestResource.score) {
          bestResource = { id: resource.id, name: resource.name, score, reasons, constraintWarnings: softWarnings };
        }
      }

      if (bestResource) {
        resourceLoad[bestResource.id] = (resourceLoad[bestResource.id] || 0) + jobDuration;
        assignments.push({
          workOrderId: order.id,
          workOrderTitle: order.title || `Order ${order.id.slice(0, 8)}`,
          resourceId: bestResource.id,
          resourceName: bestResource.name,
          scheduledDate: today,
          score: bestResource.score,
          reasons: bestResource.reasons,
          constraintWarnings: bestResource.constraintWarnings,
        });
      }
    }

    res.json({
      assignments,
      summary: `Fördelade ${assignments.length} av ${unplannedToday.length} oplanerade ordrar till ${new Set(assignments.map(a => a.resourceId)).size} resurser.`,
      totalAssigned: assignments.length,
      totalUnplanned: unplannedToday.length,
    });
}));

app.post("/api/ai/auto-distribute-today/apply", requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({
      assignments: z.array(z.object({
        workOrderId: z.string(),
        resourceId: z.string(),
        scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const { assignments } = parsed.data;
    const tenantId = getTenantIdWithFallback(req);

    const [tenantOrders, tenantResources] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
    ]);
    const tenantOrderIds = new Set(tenantOrders.map(o => o.id));
    const tenantResourceIds = new Set(tenantResources.map(r => r.id));

    for (const a of assignments) {
      if (!tenantOrderIds.has(a.workOrderId)) {
        throw new ForbiddenError(`Arbetsorder ${a.workOrderId} tillhör inte din organisation`);
      }
      if (!tenantResourceIds.has(a.resourceId)) {
        throw new ForbiddenError(`Resurs ${a.resourceId} tillhör inte din organisation`);
      }
    }

    const resourceIds = tenantResources.map(r => r.id);
    const [resourceAvailability, vehicleSchedules, resourceVehicles, dependencyInstances, timeRestrictions, allResourceArticles] = await Promise.all([
      storage.getResourceAvailabilityByTenant(tenantId),
      storage.getVehicleSchedulesByTenant(tenantId),
      storage.getResourceVehiclesByResourceIds(resourceIds),
      storage.getTaskDependencyInstances(tenantId),
      storage.getObjectTimeRestrictionsByTenant(tenantId),
      storage.getResourceArticlesByResourceIds(resourceIds),
    ]);

    const orderIds = [...new Set(assignments.map(a => a.workOrderId))];
    const workOrderLineResults = await Promise.all(orderIds.map(id => storage.getWorkOrderLines(id)));
    const allWorkOrderLines = workOrderLineResults.flat();

    const teamIds = [...new Set(tenantOrders.map(o => o.teamId).filter(Boolean))] as string[];
    const teamMemberResults = await Promise.all(teamIds.map(id => storage.getTeamMembers(id)));
    const allTeamMembers = teamMemberResults.flat();

    const { validateSchedule } = await import("../planning/constraintEngine");

    const constraintCtx = {
      allOrders: tenantOrders,
      resources: tenantResources,
      resourceAvailability,
      vehicleSchedules,
      resourceVehicles,
      dependencyInstances,
      timeRestrictions,
      resourceArticles: allResourceArticles,
      workOrderLines: allWorkOrderLines,
      teamMembers: allTeamMembers,
    };

    const results = await Promise.all(
      assignments.map(async (a) => {
        const violations = validateSchedule(
          [{ workOrderId: a.workOrderId, resourceId: a.resourceId, scheduledDate: a.scheduledDate }],
          constraintCtx
        );
        const hardViolations = violations.filter(v => v.type === "hard");
        if (hardViolations.length > 0) {
          return {
            workOrderId: a.workOrderId,
            success: false,
            error: `Hårda restriktioner: ${hardViolations.map(v => v.description).join("; ")}`,
          };
        }

        try {
          const updated = await storage.updateWorkOrder(a.workOrderId, {
            resourceId: a.resourceId,
            scheduledDate: new Date(a.scheduledDate + "T12:00:00Z"),
          });
          return { workOrderId: a.workOrderId, success: !!updated };
        } catch (err) {
          return { workOrderId: a.workOrderId, success: false, error: String(err) };
        }
      })
    );

    const successCount = results.filter(r => r.success).length;
    res.json({
      applied: successCount,
      total: assignments.length,
      results,
    });
}));

}

function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
