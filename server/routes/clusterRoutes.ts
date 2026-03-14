import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { insertClusterSchema, objects, workOrders } from "@shared/schema";

export async function registerClusterRoutes(app: Express) {
// ============== CLUSTERS - NAVET I VERKSAMHETEN ==============
app.get("/api/clusters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const clusters = await storage.getClusters(tenantId);
    res.json(clusters || []);
}));

app.get("/api/clusters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getClusterWithStats(req.params.id);
    const verified = verifyTenantOwnership(cluster, tenantId);
    if (!verified) throw new NotFoundError("Kluster hittades inte");
    res.json(verified);
}));

app.post("/api/clusters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertClusterSchema.parse({ ...req.body, tenantId });
    if (data.radiusKm && data.radiusKm > 50) data.radiusKm = 50;
    const cluster = await storage.createCluster(data);

    if (cluster.postalCodes && cluster.postalCodes.length > 0) {
      const normalizedPostals = [...new Set(cluster.postalCodes.map(pc => pc.replace(/\s/g, "")))];
      const matchingObjects = await db.select({ id: objects.id, postalCode: objects.postalCode })
        .from(objects)
        .where(and(
          eq(objects.tenantId, tenantId),
          isNull(objects.deletedAt),
          isNull(objects.clusterId)
        ));
      const objectsToLink = matchingObjects.filter(obj => {
        const objPostal = (obj.postalCode || "").replace(/\s/g, "");
        return normalizedPostals.some(pc => objPostal === pc || objPostal.startsWith(pc));
      });
      if (objectsToLink.length > 0) {
        const objectIds = objectsToLink.map(o => o.id);
        const batchSize = 500;
        for (let i = 0; i < objectIds.length; i += batchSize) {
          const batch = objectIds.slice(i, i + batchSize);
          await db.update(objects)
            .set({ clusterId: cluster.id })
            .where(and(inArray(objects.id, batch), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
        }
        for (let i = 0; i < objectIds.length; i += batchSize) {
          const woBatch = objectIds.slice(i, i + batchSize);
          await db.update(workOrders)
            .set({ clusterId: cluster.id })
            .where(and(inArray(workOrders.objectId, woBatch), eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)));
        }
      }
    }

    await storage.updateClusterCaches(cluster.id);
    const updated = await storage.getCluster(cluster.id);
    res.status(201).json(updated || cluster);
}));

app.patch("/api/clusters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
    const cluster = await storage.updateCluster(req.params.id, updateData);
    if (!cluster) throw new NotFoundError("Kluster hittades inte");
    res.json(cluster);
}));

app.delete("/api/clusters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    await storage.deleteCluster(req.params.id);
    res.status(204).send();
}));

// Cluster aggregations - "snöret"
app.get("/api/clusters/:id/objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(cluster, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const objects = await storage.getClusterObjects(req.params.id);
    res.json(objects);
}));

app.get("/api/clusters/:id/work-orders", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(cluster, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
    const workOrders = await storage.getClusterWorkOrders(req.params.id, { startDate, endDate });
    res.json(workOrders);
}));

app.get("/api/clusters/:id/subscriptions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(cluster, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const subscriptions = await storage.getClusterSubscriptions(req.params.id);
    res.json(subscriptions);
}));

// Get all contacts for objects in a cluster (including inherited)
app.get("/api/clusters/:id/object-contacts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const cluster = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(cluster, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const objects = await storage.getClusterObjects(req.params.id);
    
    // Get contacts for all objects including inherited ones
    const contactsByObject: Record<string, any[]> = {};
    for (const obj of objects) {
      const contacts = await storage.getObjectContactsWithInheritance(obj.id, tenantId);
      contactsByObject[obj.id] = contacts;
    }
    res.json(contactsByObject);
}));

app.post("/api/clusters/:id/refresh-cache", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getCluster(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const cluster = await storage.updateClusterCaches(req.params.id);
    if (!cluster) throw new NotFoundError("Kluster hittades inte");
    res.json(cluster);
}));

// AI General Chat - contextual AI assistant for all modules
app.post("/api/ai/chat", asyncHandler(async (req, res) => {
    const { question, context, conversationHistory = [] } = req.body;
    if (!question || typeof question !== "string") {
      throw new ValidationError("Fråga krävs");
    }

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    
    // Use shared persona module
    const { buildSystemPrompt } = await import("./ai/persona");

    // Fetch contextual data based on current module
    let moduleData = "";
    const moduleName = context?.module || "Generell";
    const modulePath = context?.path || "/";
    
    // Determine role based on module path
    let role: "field_worker" | "planner" | "admin" | "general" = "general";
    if (modulePath.startsWith("/mobile") || modulePath === "/") {
      role = "field_worker";
    } else if (modulePath.startsWith("/planner") || modulePath.startsWith("/week")) {
      role = "planner";
    } else if (modulePath.startsWith("/fortnox") || modulePath.startsWith("/admin")) {
      role = "admin";
    }

    try {
      const tenantId = getTenantIdWithFallback(req);
      if (modulePath.startsWith("/economics")) {
        const workOrders = await storage.getWorkOrders(tenantId);
        const completed = workOrders.filter(wo => wo.status === "completed" || wo.orderStatus === "utford").length;
        const pending = workOrders.filter(wo => wo.status !== "completed" && wo.orderStatus !== "utford").length;
        moduleData = `Ekonomisk översikt: ${workOrders.length} ordrar totalt, ${completed} utförda, ${pending} väntande`;
      } else if (modulePath.startsWith("/vehicles")) {
        const vehicles = await storage.getVehicles(tenantId);
        moduleData = `Fordonsflotta: ${vehicles.length} fordon registrerade`;
      } else if (modulePath.startsWith("/weather")) {
        moduleData = "Väderplanering: AI-stöd för att anpassa schemaläggning baserat på väderförhållanden";
      } else if (modulePath.startsWith("/subscriptions")) {
        const subscriptions = await storage.getSubscriptions(tenantId);
        const active = subscriptions.filter(s => s.status === "active").length;
        moduleData = `Abonnemang: ${subscriptions.length} totalt, ${active} aktiva`;
      } else if (modulePath.startsWith("/articles")) {
        const articles = await storage.getArticles(tenantId);
        moduleData = `Artiklar: ${articles.length} artiklar i systemet`;
      } else {
        const clusters = await storage.getClusters(tenantId);
        const workOrders = await storage.getWorkOrders(tenantId);
        moduleData = `System: ${clusters.length} kluster, ${workOrders.length} ordrar`;
      }
    } catch (e) {
      moduleData = "Kunde inte hämta moduldata";
    }

    // Build system prompt with shared persona
    const systemPrompt = buildSystemPrompt({ 
      role, 
      moduleName, 
      additionalContext: moduleData 
    }) + `

VIKTIGT: Avsluta ALLTID ditt svar med exakt 2-3 föreslagna följdfrågor som användaren kan ställa.
Formatera dem på en ny rad efter ditt svar, med prefixet "FÖLJDFRÅGOR:" följt av frågorna separerade med "|".`;

    // Build messages array with history
    const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt }
    ];
    
    // Add conversation history (limit to last 10)
    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === "user" || msg.role === "assistant") {
        chatMessages.push({ role: msg.role, content: msg.content });
      }
    }
    
    chatMessages.push({ role: "user", content: question });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const { trackOpenAIResponse } = await import("./api-usage-tracker");
    trackOpenAIResponse(response);

    let rawAnswer = response.choices[0]?.message?.content || "Kunde inte generera ett svar.";
    
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

}
