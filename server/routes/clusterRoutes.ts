import type { Express } from "express";
import { storage } from "../storage";
import { invalidateWorkflowCaches } from "../services/dashboardCache";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { insertClusterSchema, objects, workOrders, resources } from "@shared/schema";

export async function registerClusterRoutes(app: Express) {
// ============== CLUSTERS - NAVET I VERKSAMHETEN ==============
app.get("/api/clusters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const clusters = await storage.getClusters(tenantId);
    res.json(clusters || []);
}));

app.get("/api/clusters/zones", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const allClusters = await storage.getClusters(tenantId);
    const activeClusters = (allClusters || []).filter(c => c.status === "active");
    
    const allObjects = await db.select({
      id: objects.id,
      clusterId: objects.clusterId,
      latitude: objects.latitude,
      longitude: objects.longitude,
      postalCode: objects.postalCode,
    }).from(objects).where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
    
    const computeConvexHull = (points: [number, number][]): [number, number][] => {
      if (points.length < 3) return points;
      const sorted = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
        (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
      const lower: [number, number][] = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper: [number, number][] = [];
      for (const p of [...sorted].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      upper.pop();
      lower.pop();
      return lower.concat(upper);
    };
    
    const clusterZones = activeClusters.map(cluster => {
      const clusterObjects = allObjects.filter(o => o.clusterId === cluster.id && o.latitude && o.longitude);
      const coords = clusterObjects.map(o => [o.latitude!, o.longitude!] as [number, number]);
      const hull = computeConvexHull(coords);
      const postalCodes = [...new Set(clusterObjects.map(o => o.postalCode).filter(Boolean))] as string[];
      return {
        id: cluster.id,
        name: cluster.name,
        color: cluster.color || "#3B82F6",
        objectCount: clusterObjects.length,
        postalCodes,
        polygon: hull.length >= 3 ? hull : null,
        center: cluster.centerLatitude && cluster.centerLongitude
          ? [cluster.centerLatitude, cluster.centerLongitude]
          : coords.length > 0
            ? [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length]
            : null,
        radiusKm: cluster.radiusKm || null,
      };
    }).filter(z => z.polygon || z.center);
    
    const allResources = await db.select({
      id: resources.id,
      name: resources.name,
      serviceArea: resources.serviceArea,
      status: resources.status,
    }).from(resources).where(and(eq(resources.tenantId, tenantId), isNull(resources.deletedAt)));
    
    const RESOURCE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];
    
    const resourceZones = allResources
      .filter(r => r.status === "active" && r.serviceArea && r.serviceArea.length > 0)
      .map((resource, idx) => {
        const normalizedAreas = resource.serviceArea!.map(pc => pc.replace(/\s/g, ""));
        const areaObjects = allObjects.filter(obj => {
          if (!obj.latitude || !obj.longitude || !obj.postalCode) return false;
          const objPC = obj.postalCode.replace(/\s/g, "");
          return normalizedAreas.some(area => objPC === area || objPC.startsWith(area));
        });
        const coords = areaObjects.map(o => [o.latitude!, o.longitude!] as [number, number]);
        const hull = computeConvexHull(coords);
        return {
          id: resource.id,
          name: resource.name,
          color: RESOURCE_COLORS[idx % RESOURCE_COLORS.length],
          serviceArea: resource.serviceArea,
          objectCount: areaObjects.length,
          polygon: hull.length >= 3 ? hull : null,
          center: coords.length > 0
            ? [coords.reduce((s, c) => s + c[0], 0) / coords.length, coords.reduce((s, c) => s + c[1], 0) / coords.length]
            : null,
        };
      })
      .filter(z => z.polygon || z.center);
    
    res.json({ clusterZones, resourceZones });
}));

app.get("/api/clusters/resource-match", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const clusterId = req.query.clusterId as string | undefined;
    const objectId = req.query.objectId as string | undefined;

    if (!clusterId && !objectId) {
      throw new ValidationError("clusterId eller objectId krävs");
    }

    let targetClusterId = clusterId;

    if (objectId && !targetClusterId) {
      const obj = await storage.getObject(objectId);
      if (obj && obj.tenantId === tenantId) {
        targetClusterId = obj.clusterId || undefined;
      }
    }

    const allClusters = await storage.getClusters(tenantId);
    const allResources = await storage.getResources(tenantId);
    const activeResources = allResources.filter(r => r.status === "active" && r.resourceType === "person");

    const scheduledOrders = (await storage.getWorkOrders(tenantId)).filter(o => o.scheduledDate && o.resourceId);
    const resourceLoad: Record<string, number> = {};
    const today = new Date().toISOString().split("T")[0];
    const weekEnd = new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0];
    scheduledOrders.forEach(o => {
      if (!o.resourceId || !o.scheduledDate) return;
      const d = o.scheduledDate instanceof Date ? o.scheduledDate.toISOString().split("T")[0] : String(o.scheduledDate).split("T")[0];
      if (d >= today && d <= weekEnd) {
        resourceLoad[o.resourceId] = (resourceLoad[o.resourceId] || 0) + (o.estimatedDuration || 60);
      }
    });

    const targetCluster = targetClusterId ? allClusters.find(c => c.id === targetClusterId) : null;
    const clusterPostals = targetCluster?.postalCodes || [];

    type Match = { resourceId: string; resourceName: string; score: number; reasons: string[]; clusterMatch: boolean };
    const matches: Match[] = [];

    for (const resource of activeResources) {
      let score = 50;
      const reasons: string[] = [];
      let clusterMatch = false;

      if (targetCluster && resource.serviceArea && resource.serviceArea.length > 0) {
        const normalizedServiceArea = resource.serviceArea.map(p => p.replace(/\s/g, ""));
        const overlap = normalizedServiceArea.filter(p => clusterPostals.map(cp => cp.replace(/\s/g, "")).some(cp => cp === p || cp.startsWith(p) || p.startsWith(cp)));
        if (overlap.length > 0) {
          const overlapPct = clusterPostals.length > 0 ? Math.round((overlap.length / clusterPostals.length) * 100) : 100;
          score += 40;
          clusterMatch = true;
          reasons.push(`Klustermatchning ${overlapPct}% (${overlap.length} postnr)`);
        } else {
          score -= 10;
          reasons.push("Ej i klustrets område");
        }
      } else if (targetCluster && (!resource.serviceArea || resource.serviceArea.length === 0)) {
        score += 5;
        reasons.push("Inget begränsat område");
      }

      const loadMin = resourceLoad[resource.id] || 0;
      const weekCapacityMin = (resource.weeklyHours || 40) * 60;
      const loadPct = weekCapacityMin > 0 ? Math.round((loadMin / weekCapacityMin) * 100) : 0;
      if (loadPct < 50) { score += 10; reasons.push(`Låg beläggning (${loadPct}%)`); }
      else if (loadPct < 80) { score += 5; reasons.push(`Normal beläggning (${loadPct}%)`); }
      else { score -= 5; reasons.push(`Hög beläggning (${loadPct}%)`); }

      if (resource.executionCodes && resource.executionCodes.length > 0) {
        score += 5;
        reasons.push(`Kompetens: ${resource.executionCodes.join(", ")}`);
      } else {
        score -= 3;
        reasons.push("Inga registrerade kompetenser");
      }

      matches.push({ resourceId: resource.id, resourceName: resource.name, score, reasons, clusterMatch });
    }

    matches.sort((a, b) => b.score - a.score);
    const noMatch = targetCluster ? !matches.some(m => m.clusterMatch) : false;

    res.json({ matches, noMatch, clusterId: targetClusterId || null, clusterName: targetCluster?.name || null });
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
    invalidateWorkflowCaches(tenantId);
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

app.post("/api/objects/bulk-assign-cluster", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      objectIds: z.array(z.string()).min(1),
      clusterId: z.string().min(1),
    });
    const { objectIds, clusterId } = schema.parse(req.body);
    const cluster = await storage.getCluster(clusterId);
    if (!verifyTenantOwnership(cluster, tenantId)) {
      throw new NotFoundError("Kluster hittades inte");
    }
    const batchSize = 500;
    for (let i = 0; i < objectIds.length; i += batchSize) {
      const batch = objectIds.slice(i, i + batchSize);
      await db.update(objects)
        .set({ clusterId })
        .where(and(inArray(objects.id, batch), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
    }
    for (let i = 0; i < objectIds.length; i += batchSize) {
      const batch = objectIds.slice(i, i + batchSize);
      await db.update(workOrders)
        .set({ clusterId })
        .where(and(inArray(workOrders.objectId, batch), eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)));
    }
    await storage.updateClusterCaches(clusterId);
    invalidateWorkflowCaches(tenantId);
    res.json({ success: true, count: objectIds.length });
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

    const tenantId = getTenantIdWithFallback(req);

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    
    const { buildSystemPrompt } = await import("../ai/persona");

    let moduleData = "";
    const moduleName = context?.module || "Generell";
    const modulePath = context?.path || "/";
    
    let role: "field_worker" | "planner" | "admin" | "general" = "general";
    if (modulePath.startsWith("/mobile") || modulePath === "/") {
      role = "field_worker";
    } else if (modulePath.startsWith("/planner") || modulePath.startsWith("/week")) {
      role = "planner";
    } else if (modulePath.startsWith("/fortnox") || modulePath.startsWith("/admin")) {
      role = "admin";
    }

    try {
      if (modulePath.startsWith("/economics")) {
        const workOrders = await storage.getWorkOrders(tenantId);
        const completed = workOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
        const pending = workOrders.filter(wo => wo.orderStatus !== "utford" && wo.orderStatus !== "fakturerad").length;
        moduleData = `Ekonomisk översikt: ${workOrders.length} ordrar totalt, ${completed} utförda, ${pending} väntande`;
      } else if (modulePath.startsWith("/vehicles")) {
        const vehicles = await storage.getVehicles(tenantId);
        moduleData = `Fordonsflotta: ${vehicles.length} fordon registrerade`;
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

    const { enforceBudgetAndRateLimit, withRetry } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "chat");
    if (!enforcement.allowed) {
      if (enforcement.errorType === "ratelimit") {
        res.set("Retry-After", String(enforcement.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden", message: enforcement.errorMessage });
    }

    const response = await withRetry(() => openai.chat.completions.create({
      model: enforcement.model,
      messages: chatMessages,
      max_tokens: 500,
      temperature: 0.7,
    }), { label: "cluster-chat" });

    const { trackOpenAIResponse } = await import("../api-usage-tracker");
    trackOpenAIResponse(response, tenantId);

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
