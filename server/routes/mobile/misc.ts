import type { Express } from "express";
  import {
    MobileAuthenticatedRequest, enrichOrderForMobile, broadcastPlannerEvent, handleQuickAction, getFallbackChecklist,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, isMobileAuthenticated, isAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    routeFeedbackTable, orderChecklistItems, workOrders, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments,
    mapGoCategory, ONE_CATEGORIES, GO_CATEGORY_MAP,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, writeArticleMetadataOnObject,
  } from "./shared";
  import type { Request, Response } from "express";
  
  export function registerMiscRoutes(app: Express) {
  // ============================================
// CHECKLIST TEMPLATES API
// ============================================

app.get("/api/checklist-templates", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const templates = await storage.getChecklistTemplates(tenantId);
    res.json(templates);
}));

app.get("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const template = await storage.getChecklistTemplate(req.params.id);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

app.post("/api/checklist-templates", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const { name, articleType, questions, isActive } = req.body;

    if (!name || !articleType) {
      throw new ValidationError("name and articleType required");
    }

    const template = await storage.createChecklistTemplate({
      tenantId,
      name,
      articleType,
      questions: questions || [],
      isActive: isActive !== false,
    });

    console.log(`[checklist] Template "${name}" created for articleType "${articleType}"`);
    res.json(template);
}));

app.patch("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const template = await storage.updateChecklistTemplate(req.params.id, req.body);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

app.delete("/api/checklist-templates/:id", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    await storage.deleteChecklistTemplate(req.params.id);
    res.json({ success: true });
}));

app.get("/api/mobile/orders/:id/checklist", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const lines = await storage.getWorkOrderLines(orderId);
    const articleIds = lines.map(l => l.articleId).filter(Boolean);

    let articleTypes: string[] = [];
    if (articleIds.length > 0) {
      const articles = await storage.getArticles(resource.tenantId);
      articleTypes = [...new Set(
        articles.filter(a => articleIds.includes(a.id)).map(a => a.articleType)
      )];
    }

    if (articleTypes.length === 0) {
      articleTypes = ["tjanst"];
    }

    const allTemplates: any[] = [];
    for (const at of articleTypes) {
      const templates = await storage.getChecklistTemplatesByArticleType(resource.tenantId, at);
      allTemplates.push(...templates);
    }

    const uniqueTemplates = Array.from(new Map(allTemplates.map(t => [t.id, t])).values());

    res.json({
      orderId,
      articleTypes,
      checklists: uniqueTemplates.map(t => ({
        templateId: t.id,
        name: t.name,
        articleType: t.articleType,
        questions: t.questions,
      })),
    });
}));

// ============================================
// DRIVER PUSH NOTIFICATIONS API
// ============================================

app.get("/api/mobile/notifications", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const unreadOnly = req.query.unread === "true";
    const limit = parseInt(req.query.limit as string) || 50;

    const notifications = await storage.getDriverNotifications(resourceId, { unreadOnly, limit });
    const unreadCount = await storage.getUnreadNotificationCount(resourceId);

    res.json({
      notifications,
      unreadCount,
      total: notifications.length,
    });
}));

app.patch("/api/mobile/notifications/:id/read", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const notification = await storage.markDriverNotificationRead(req.params.id, resourceId);
    if (!notification) throw new NotFoundError("Avisering hittades inte");
    res.json(notification);
}));

app.patch("/api/mobile/notifications/read-all", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const count = await storage.markAllDriverNotificationsRead(resourceId);
    res.json({ success: true, markedRead: count });
}));

app.get("/api/mobile/notifications/count", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const unreadCount = await storage.getUnreadNotificationCount(resourceId);
    res.json({ unreadCount });
}));

// ============================================
// ROUTE FEEDBACK — drivers rate daily routes
// ============================================
app.get("/api/mobile/route-feedback/mine", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const { startDate, endDate, limit: limitStr } = req.query as Record<string, string>;
    const parsedLimit = limitStr ? Math.min(Math.max(parseInt(limitStr) || 20, 1), 100) : 20;
    const feedback = await storage.getRouteFeedback(resource.tenantId, {
      resourceId,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: parsedLimit,
    });
    res.json(feedback);
}));

app.post("/api/mobile/route-feedback", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const VALID_REASON_CATEGORIES = ["felaktig_ordning", "orimliga_kortider", "vagarbete_hinder", "for_manga_stopp", "saknad_info", "trafik", "optimal", "ovrigt"];
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rating: z.number().int().min(1).max(5),
      reasonCategory: z.string().optional(),
      freeText: z.string().max(1000).optional(),
      workSessionId: z.string().optional(),
    }).refine((data) => {
      if (data.rating <= 2 && !data.reasonCategory) return false;
      return true;
    }, { message: "reasonCategory krävs för betyg 1-2" }).refine((data) => {
      if (data.reasonCategory && !VALID_REASON_CATEGORIES.includes(data.reasonCategory)) return false;
      return true;
    }, { message: `reasonCategory måste vara en av: ${VALID_REASON_CATEGORIES.join(", ")}` });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodError(parseResult.error));
    }

    const existing = await storage.getRouteFeedback(resource.tenantId, {
      resourceId,
      startDate: parseResult.data.date,
      endDate: parseResult.data.date,
      limit: 1,
    });

    let feedback;
    if (existing.length > 0) {
      const [updated] = await db.update(routeFeedbackTable)
        .set({
          rating: parseResult.data.rating,
          reasonCategory: parseResult.data.reasonCategory || null,
          freeText: parseResult.data.freeText || null,
          workSessionId: parseResult.data.workSessionId || null,
        })
        .where(eq(routeFeedbackTable.id, existing[0].id))
        .returning();
      feedback = updated;
    } else {
      feedback = await storage.createRouteFeedback({
        tenantId: resource.tenantId,
        resourceId,
        date: parseResult.data.date,
        rating: parseResult.data.rating,
        reasonCategory: parseResult.data.reasonCategory || null,
        freeText: parseResult.data.freeText || null,
        workSessionId: parseResult.data.workSessionId || null,
      });
    }

    console.log(`[mobile] Route feedback: resource ${resourceId} rated ${parseResult.data.date} as ${parseResult.data.rating}/5`);
    res.status(existing.length > 0 ? 200 : 201).json(feedback);
}));

app.get("/api/mobile/terminology", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) {
      return res.status(404).json({ error: "Resurs hittades inte" });
    }
    const tenantId = resource.tenantId;
    const { tenantLabels, DEFAULT_TERMINOLOGY, INDUSTRY_TERMINOLOGY } = await import("@shared/schema");
    const labels = await db.select().from(tenantLabels).where(eq(tenantLabels.tenantId, tenantId));
    const tenant = await storage.getTenant(tenantId);
    const industry = tenant?.industry || "waste_management";
    const industryDefaults = INDUSTRY_TERMINOLOGY[industry] || {};
    const merged: Record<string, string> = { ...DEFAULT_TERMINOLOGY, ...industryDefaults };
    for (const label of labels) {
      merged[label.labelKey] = label.labelValue;
    }
    res.json(merged);
}));

app.get("/api/checklist/:workOrderId", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;
    const items = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId))
      .orderBy(orderChecklistItems.sortOrder);
    res.json(items);
}));

app.post("/api/checklist/:workOrderId/items", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;
    const { stepText, isAiGenerated, sortOrder } = req.body;
    if (!stepText || typeof stepText !== "string" || !stepText.trim()) {
      return res.status(400).json({ error: "stepText krävs" });
    }
    const existingItems = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId));
    const newSortOrder = sortOrder ?? existingItems.length;
    const [item] = await db.insert(orderChecklistItems).values({
      workOrderId,
      stepText: stepText.trim(),
      isAiGenerated: isAiGenerated || false,
      isCompleted: false,
      sortOrder: newSortOrder,
    }).returning();
    res.status(201).json(item);
}));

app.patch("/api/checklist/items/:itemId", asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const { isCompleted } = req.body;
    if (typeof isCompleted !== "boolean") {
      return res.status(400).json({ error: "isCompleted (boolean) krävs" });
    }
    const [updated] = await db.update(orderChecklistItems)
      .set({
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
      })
      .where(eq(orderChecklistItems.id, itemId))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Checklista-objekt hittades inte" });
    }
    res.json(updated);
}));

app.delete("/api/checklist/items/:itemId", asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    await db.delete(orderChecklistItems)
      .where(eq(orderChecklistItems.id, itemId));
    res.json({ success: true });
}));

app.post("/api/checklist/:workOrderId/generate", asyncHandler(async (req, res) => {
    const { workOrderId } = req.params;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: "Arbetsorder hittades inte" });
    }

    const similarOrders = await db.select({
      title: workOrders.title,
      orderType: workOrders.orderType,
      description: workOrders.description,
      notes: workOrders.notes,
    }).from(workOrders)
      .where(and(
        eq(workOrders.tenantId, workOrder.tenantId),
        eq(workOrders.orderType, workOrder.orderType),
        eq(workOrders.orderStatus, "utford"),
      ))
      .orderBy(desc(workOrders.completedAt))
      .limit(10);

    const existingChecklist = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId));
    const existingSteps = existingChecklist.map(i => i.stepText);

    try {
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      });

      const prompt = `Du är en fältserviceassistent. Föreslå en checklista med 4-7 konkreta arbetsmoment för en tekniker som ska utföra ett jobb.

Ordertyp: ${workOrder.orderType}
Titel: ${workOrder.title}
${workOrder.description ? `Beskrivning: ${workOrder.description}` : ""}
Status: ${workOrder.orderStatus}

${similarOrders.length > 0 ? `Historik från ${similarOrders.length} liknande jobb:
${similarOrders.map((o, i) => `${i + 1}. ${o.title}${o.notes ? ` — ${o.notes}` : ""}`).join("\n")}` : ""}

${existingSteps.length > 0 ? `Redan tillagda steg (lägg INTE till dessa igen): ${existingSteps.join(", ")}` : ""}

Svara ENBART med JSON-array av strängar, t.ex. ["Steg 1", "Steg 2"]. Skriv på svenska. Var konkret och praktisk.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Du genererar checklistor för fältservicetekniker. Svara alltid med en JSON-array av strängar." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 500,
        response_format: { type: "json_object" },
      });

      const { trackOpenAIResponse } = await import("../api-usage-tracker");
      trackOpenAIResponse(response);

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);
      const steps: string[] = Array.isArray(parsed) ? parsed : (parsed.steps || parsed.checklist || parsed.steg || []);

      const filteredSteps = steps.filter(s => typeof s === "string" && s.trim() && !existingSteps.includes(s.trim()));

      const insertedItems = [];
      for (let i = 0; i < filteredSteps.length; i++) {
        const [item] = await db.insert(orderChecklistItems).values({
          workOrderId,
          stepText: filteredSteps[i].trim(),
          isAiGenerated: true,
          isCompleted: false,
          sortOrder: existingChecklist.length + i,
        }).returning();
        insertedItems.push(item);
      }

      res.json({ steps: insertedItems, generated: insertedItems.length });
    } catch (error) {
      console.error("[checklist] AI generation failed:", error);
      const fallbackSteps = getFallbackChecklist(workOrder.orderType);
      const filteredFallback = fallbackSteps.filter(s => !existingSteps.includes(s));

      const insertedItems = [];
      for (let i = 0; i < filteredFallback.length; i++) {
        const [item] = await db.insert(orderChecklistItems).values({
          workOrderId,
          stepText: filteredFallback[i],
          isAiGenerated: true,
          isCompleted: false,
          sortOrder: existingChecklist.length + i,
        }).returning();
        insertedItems.push(item);
      }
      res.json({ steps: insertedItems, generated: insertedItems.length, fallback: true });
    }
}));

  // ========================================
// MOBILE - Customer Change Requests (Go integration)
// ========================================

const mobileChangeRequestSchema = z.object({
  objectId: z.string().uuid(),
  category: z.string().min(1),
  description: z.string().min(1).max(5000),
  photos: z.array(z.string()).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional().nullable(),
});

app.post("/api/mobile/customer-change-requests", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new ForbiddenError("Resurs hittades inte");
    const tenantId = resource.tenantId;

    const parseResult = mobileChangeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const data = parseResult.data;

    const obj = await storage.getObject(data.objectId);
    if (!obj || obj.tenantId !== tenantId) {
      throw new NotFoundError("Objekt hittades inte");
    }
    if (!obj.customerId) {
      throw new ValidationError("Objektet saknar kund-koppling");
    }

    const isOneCategory = (ONE_CATEGORIES as readonly string[]).includes(data.category);
    const isGoCategory = Object.keys(GO_CATEGORY_MAP).includes(data.category);
    if (!isOneCategory && !isGoCategory) {
      throw new ValidationError(`Okänd kategori: ${data.category}. Giltiga kategorier: ${[...ONE_CATEGORIES, ...Object.keys(GO_CATEGORY_MAP)].join(", ")}`);
    }
    const mappedCategory = isOneCategory ? data.category : mapGoCategory(data.category);

    const created = await storage.createCustomerChangeRequest({
      tenantId,
      objectId: data.objectId,
      customerId: obj.customerId,
      category: mappedCategory,
      description: data.description,
      photos: data.photos || null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      status: "new",
      severity: data.severity || null,
      createdByResourceId: resourceId,
    });

    broadcastPlannerEvent({
      type: "change_request:created",
      data: {
        id: created.id,
        tenantId: created.tenantId,
        objectId: created.objectId,
        customerId: created.customerId,
        category: created.category,
        severity: created.severity,
        createdByResourceId: resourceId,
      },
    });

    console.log(`[mobile] Change request created: ${created.id} by resource ${resourceId} for object ${data.objectId}`);
    res.status(201).json(created);
}));

app.get("/api/mobile/customer-change-requests/mine", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new ForbiddenError("Resurs hittades inte");

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;

    const { items, total } = await storage.getCustomerChangeRequests({
      tenantId: resource.tenantId,
      createdByResourceId: resourceId,
      status: status || undefined,
      limit,
      offset,
    });

    const objectIds = [...new Set(items.map(r => r.objectId))];
    const customerIds = [...new Set(items.map(r => r.customerId))];
    const objectsArr = objectIds.length > 0 ? await storage.getObjectsByIds(resource.tenantId, objectIds) : [];
    const objectMap = new Map(objectsArr.map(o => [o.id, o]));
    const customersArr = customerIds.length > 0 ? await Promise.all(customerIds.map(id => storage.getCustomer(id))) : [];
    const customerMap = new Map(customersArr.filter(Boolean).map(c => [c!.id, c!]));

    const enriched = items.map(r => ({
      ...r,
      objectName: objectMap.get(r.objectId)?.name || null,
      objectAddress: objectMap.get(r.objectId)?.address || null,
      customerName: customerMap.get(r.customerId)?.name || null,
    }));

    res.json({ items: enriched, total });
}));

app.post("/api/mobile/customer-change-requests/upload-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
}));

app.post("/api/mobile/customer-change-requests/confirm-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { objectPath } = req.body;
    if (!objectPath || typeof objectPath !== "string") {
      throw new ValidationError("objectPath krävs");
    }

    const safePathRegex = /^\/objects\/[a-zA-Z0-9\/_-]+$/;
    if (!safePathRegex.test(objectPath)) {
      throw new ValidationError("Ogiltig fotosökväg");
    }

    try {
      const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
      const oss = new ObjectStorageService();
      await oss.getObjectEntityFile(objectPath);
    } catch {
      throw new ValidationError("Filen hittades inte eller kunde inte verifieras");
    }

    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const oss = new ObjectStorageService();
    const downloadURL = await oss.getObjectEntityDownloadURL(objectPath);
    res.json({ confirmed: true, objectPath, downloadURL });
}));

app.get("/api/mobile/customer-change-requests/categories", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { GO_CATEGORY_MAP: goMap, ONE_CATEGORIES: oneCats, GO_CATEGORIES: goCats, ALL_CATEGORIES: allCats, CATEGORY_LABELS: labels, SEVERITY_LEVELS: sevs } = await import("@shared/changeRequestCategories");
    res.json({
      oneCategories: oneCats,
      goCategories: goCats,
      allCategories: allCats,
      categoryLabels: labels,
      goCategoryMapping: goMap,
      severityLevels: sevs,
    });
}));

  app.post("/api/travel-distances", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { originLat, originLng, destinations } = req.body;
    if (originLat == null || originLng == null || !Array.isArray(destinations)) {
      throw new ValidationError("originLat, originLng och destinations krävs");
    }

    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const results = destinations.map((dest: { id: string; lat: number; lng: number }) => {
      if (dest.lat == null || dest.lng == null) {
        return { id: dest.id, distanceKm: null, travelMinutes: null };
      }
      const distKm = haversine(originLat, originLng, dest.lat, dest.lng);
      const roadFactor = 1.3;
      const avgSpeedKmh = 40;
      const travelMinutes = Math.round((distKm * roadFactor / avgSpeedKmh) * 60);
      return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, travelMinutes };
    });

    res.json({ distances: results });
}));

app.post("/api/mobile/quick-action", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { orderId, actionType } = req.body;

    const order = await storage.getWorkOrder(orderId);
    if (order && order.resourceId !== resourceId) {
      throw new ForbiddenError("Ej behörig");
    }

    const result = await handleQuickAction(orderId, actionType);
    res.json(result);
}));

app.post("/api/quick-action", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { orderId, actionType } = req.body;
    const result = await handleQuickAction(orderId, actionType);
    res.json(result);
}));

app.post("/api/mobile/travel-times", isAuthenticated, asyncHandler(async (req: Request, res: Response) => {
    const { latitude, longitude, destinations } = req.body;

    if (latitude == null || longitude == null || !Array.isArray(destinations) || destinations.length === 0) {
      throw new ValidationError("latitude, longitude och destinations krävs");
    }
    if (typeof latitude !== "number" || typeof longitude !== "number" || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new ValidationError("Ogiltiga koordinater");
    }

    const validDestinations = destinations.filter((dest: any) =>
      dest && typeof dest.id === "string" &&
      typeof dest.lat === "number" && typeof dest.lng === "number" &&
      dest.lat >= -90 && dest.lat <= 90 && dest.lng >= -180 && dest.lng <= 180
    );
    if (validDestinations.length === 0) {
      return res.json({ results: [], source: "none" });
    }

    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
    if (!GEOAPIFY_API_KEY) {
      const results = validDestinations.map((dest: { id: string; lat: number; lng: number }) => {
        const R = 6371;
        const dLat = (dest.lat - latitude) * Math.PI / 180;
        const dLon = (dest.lng - longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = R * c;
        const estMinutes = Math.round(distKm * 1.4);
        return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, durationMinutes: Math.max(1, estMinutes) };
      });
      return res.json({ results, source: "haversine" });
    }

    try {
      const results = await Promise.all(
        validDestinations.slice(0, 20).map(async (dest: { id: string; lat: number; lng: number }) => {
          try {
            const waypoints = `${latitude},${longitude}|${dest.lat},${dest.lng}`;
            const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Geoapify request failed");
            const data = await response.json();
            const route = data.features?.[0]?.properties;
            if (route) {
              return {
                id: dest.id,
                distanceKm: Math.round((route.distance / 1000) * 10) / 10,
                durationMinutes: Math.round(route.time / 60),
              };
            }
            throw new Error("No route data");
          } catch {
            const R = 6371;
            const dLat = (dest.lat - latitude) * Math.PI / 180;
            const dLon = (dest.lng - longitude) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distKm = R * c;
            return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, durationMinutes: Math.max(1, Math.round(distKm * 1.4)) };
          }
        })
      );
      res.json({ results, source: "geoapify" });
    } catch (error) {
      console.error("[mobile] Travel times error:", error);
      res.status(500).json({ error: "Kunde inte beräkna restider" });
    }
}));

app.get("/api/mobile/tasks/:id/metadata-context", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    if (!order.objectId) return res.json({ articles: [], metadata: [] });

    const tenantId = getTenantIdWithFallback(req);
    const allArticles = await storage.getArticles(tenantId);

    const orderArticleIds: string[] = [];
    if (order.articleId) orderArticleIds.push(order.articleId);

    const relevantArticles = allArticles.filter(a =>
      a.status === "active" && (
        a.fetchMetadataLabel ||
        a.canUpdateMetadata ||
        a.isInfoCarrier
      ) && (
        orderArticleIds.includes(a.id) ||
        !a.hookLevel ||
        (a.objectTypes && a.objectTypes.length === 0)
      )
    );

    const objectMetadata = await getArticleMetadataForObject(order.objectId, tenantId);

    const result = relevantArticles.map(article => {
      const fetchLabel = article.fetchMetadataLabel;
      const updateLabel = article.updateMetadataLabel;
      let fetchedValue: string | null = null;
      let previousValue: string | null = null;

      if (fetchLabel && objectMetadata) {
        const match = objectMetadata.find((m: any) =>
          m.katalog?.beteckning === fetchLabel || m.katalog?.namn === fetchLabel
        );
        if (match) {
          fetchedValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
        }
      }

      if (updateLabel && article.showPreviousValue && objectMetadata) {
        const match = objectMetadata.find((m: any) =>
          m.katalog?.beteckning === updateLabel || m.katalog?.namn === updateLabel
        );
        if (match) {
          previousValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
        }
      }

      return {
        articleId: article.id,
        articleName: article.name,
        articleNumber: article.articleNumber,
        isInfoCarrier: article.isInfoCarrier || false,
        fetchMetadataLabel: fetchLabel || null,
        fetchMetadataLabelFormat: article.fetchMetadataLabelFormat || null,
        fetchedValue,
        canUpdateMetadata: article.canUpdateMetadata || false,
        updateMetadataLabel: updateLabel || null,
        updateMetadataFormat: article.updateMetadataFormat || null,
        showPreviousValue: article.showPreviousValue || false,
        previousValue,
      };
    });

    res.json({ articles: result });
}));

app.post("/api/mobile/tasks/:id/metadata-update", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { articleId, metadataLabel, newValue, inspectionStatus, inspectionComment, inspectionPhoto } = req.body;

    if (!metadataLabel || newValue === undefined) {
      throw new ValidationError("metadataLabel och newValue krävs");
    }

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    if (!order.objectId) throw new ValidationError("Order saknar objekt");

    const tenantId = getTenantIdWithFallback(req);
    const objectMetadata = await getArticleMetadataForObject(order.objectId, tenantId);
    let previousValue: string | null = null;

    if (objectMetadata) {
      const match = objectMetadata.find((m: any) =>
        m.katalog?.beteckning === metadataLabel || m.katalog?.namn === metadataLabel
      );
      if (match) {
        previousValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
      }
    }

    const effectiveValue = inspectionStatus
      ? JSON.stringify({ status: inspectionStatus, value: newValue, comment: inspectionComment || null, photo: inspectionPhoto || null })
      : newValue;

    await writeArticleMetadataOnObject(order.objectId, metadataLabel, effectiveValue, tenantId, resourceId);

    await db.insert(taskMetadataUpdates).values({
      tenantId,
      workOrderId: orderId,
      objectId: order.objectId,
      articleId: articleId || null,
      metadataLabel,
      previousValue,
      newValue: effectiveValue,
      updatedBy: resourceId,
    });

    console.log(`[mobile] Metadata updated: ${metadataLabel} = ${effectiveValue} on object ${order.objectId} by ${resourceId}`);

    res.json({ success: true, previousValue, newValue: effectiveValue });
}));

  // ============================================
// DISTANCE API — REST endpoints for distance calculations
// ============================================
app.post("/api/distance", asyncHandler(async (req: Request, res: Response) => {
    const { getRoutingDistance } = await import("../distance-matrix-service");
    const { fromLat, fromLng, toLat, toLng, origin, destination } = req.body;

    const lat1 = fromLat ?? origin?.lat;
    const lng1 = fromLng ?? origin?.lng;
    const lat2 = toLat ?? destination?.lat;
    const lng2 = toLng ?? destination?.lng;

    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) {
      throw new ValidationError("Koordinater krävs (fromLat/fromLng/toLat/toLng eller origin/destination)");
    }

    const result = await getRoutingDistance(lat1, lng1, lat2, lng2);
    res.json({
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      distanceMeters: Math.round(result.distanceKm * 1000),
      durationSeconds: result.durationMin * 60,
      source: result.source === "geoapify" ? "road_network" : result.source,
    });
}));

app.post("/api/distance/batch", asyncHandler(async (req: Request, res: Response) => {
    const { getBatchDistances } = await import("../distance-matrix-service");
    const { pairs } = req.body;

    if (!pairs || !Array.isArray(pairs)) {
      throw new ValidationError("pairs-array krävs");
    }

    const batchPairs = pairs.map((p: any, i: number) => ({
      id: p.id || String(i),
      fromLat: p.fromLat ?? p.origin?.lat,
      fromLng: p.fromLng ?? p.origin?.lng,
      toLat: p.toLat ?? p.destination?.lat,
      toLng: p.toLng ?? p.destination?.lng,
    }));

    const resultMap = await getBatchDistances(batchPairs);
    const resultsArray: any[] = [];
    const resultsById: Record<string, any> = {};

    for (const [id, r] of resultMap) {
      const entry = {
        id,
        distanceKm: r.distanceKm,
        durationMin: r.durationMin,
        distanceMeters: Math.round(r.distanceKm * 1000),
        durationSeconds: r.durationMin * 60,
        source: r.source === "geoapify" ? "road_network" : r.source,
      };
      resultsArray.push(entry);
      resultsById[id] = entry;
    }

    res.json({ results: resultsArray, resultsById });
}));

// ============================================
// MISSING MOBILE ENDPOINTS — GO compatibility
// ============================================

app.get("/api/mobile/map-config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    const tenantId = resource?.tenantId || getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings as any) || {};

    res.json({
      center: {
        lat: settings.mapCenterLat || resource?.homeLatitude || 57.7089,
        lng: settings.mapCenterLng || resource?.homeLongitude || 11.9746,
      },
      zoom: settings.mapDefaultZoom || 12,
      maxZoom: 18,
      minZoom: 5,
    });
}));

app.get("/api/mobile/team-invites", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    try {
      const invites = await db.execute(
        sql`SELECT t.*, tm.role as member_role FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.resource_id = ${resourceId} AND tm.status = 'invited'`
      );
      res.json(invites.rows || []);
    } catch {
      res.json([]);
    }
}));

app.get("/api/mobile/team-orders", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateParam = req.query.date as string;

    try {
      const teamRows = await db.execute(
        sql`SELECT DISTINCT t.id FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            WHERE tm.resource_id = ${resourceId} AND tm.status = 'active'`
      );
      const teamIds = (teamRows.rows || []).map((r: any) => r.id);
      if (teamIds.length === 0) return res.json({ orders: [], total: 0 });

      const memberRows = await db.execute(
        sql`SELECT DISTINCT resource_id FROM team_members
            WHERE team_id = ANY(${teamIds}::text[]) AND resource_id != ${resourceId} AND status = 'active'`
      );
      const memberResourceIds = (memberRows.rows || []).map((r: any) => r.resource_id);
      if (memberResourceIds.length === 0) return res.json({ orders: [], total: 0 });

      const tenantId = getTenantIdWithFallback(req);
      const allOrders = await storage.getWorkOrders(tenantId);
      let orders = allOrders.filter(o => memberResourceIds.includes(o.resourceId));

      if (dateParam) {
        const target = new Date(dateParam);
        target.setHours(0, 0, 0, 0);
        const next = new Date(target);
        next.setDate(next.getDate() + 1);
        orders = orders.filter(o => {
          if (!o.scheduledDate) return false;
          const d = new Date(o.scheduledDate);
          return d >= target && d < next;
        });
      }

      res.json({ orders, total: orders.length });
    } catch {
      res.json({ orders: [], total: 0 });
    }
}));

app.post("/api/mobile/orders/:id/upload-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const { photo, caption, type: photoType } = req.body;
    if (!photo) throw new ValidationError("Photo-data krävs");

    const metadata = (order.metadata as Record<string, unknown>) || {};
    const photos = (metadata.photos as any[]) || [];
    const newPhoto = {
      id: `photo-${Date.now()}`,
      uri: photo,
      caption: caption || "",
      type: photoType || "general",
      uploadedAt: new Date().toISOString(),
      uploadedBy: resourceId,
    };
    photos.push(newPhoto);
    await storage.updateWorkOrder(orderId, { metadata: { ...metadata, photos } });
    res.json({ success: true, photo: newPhoto });
}));

app.post("/api/mobile/orders/:id/confirm-photo", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const { photoId } = req.body;
    const metadata = (order.metadata as Record<string, unknown>) || {};
    const photos = (metadata.photos as any[]) || [];
    const photo = photos.find((p: any) => p.id === photoId);
    if (photo) {
      photo.confirmed = true;
      photo.confirmedAt = new Date().toISOString();
      await storage.updateWorkOrder(orderId, { metadata: { ...metadata, photos } });
    }
    res.json({ success: true });
}));

app.post("/api/mobile/orders/:id/customer-signoff", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    const { customerName, signature, summary, materials, deviations } = req.body;
    if (!signature) throw new ValidationError("Signatur krävs");

    const metadata = (order.metadata as Record<string, unknown>) || {};
    metadata.customerSignoff = {
      customerName: customerName || "",
      signature,
      summary: summary || "",
      materials: materials || [],
      deviations: deviations || [],
      signedAt: new Date().toISOString(),
      signedBy: resourceId,
    };

    await storage.updateWorkOrder(orderId, {
      metadata: { ...metadata },
      executionStatus: "signed_off",
    });
    res.json({ success: true, signedAt: metadata.customerSignoff.signedAt });
}));

app.post("/api/mobile/notifications/:id/read", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const notification = await storage.markDriverNotificationRead(req.params.id, resourceId);
    if (!notification) throw new NotFoundError("Avisering hittades inte");
    res.json(notification);
}));

app.post("/api/mobile/notifications/read-all", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const count = await storage.markAllDriverNotificationsRead(resourceId);
    res.json({ success: true, markedRead: count });
}));

app.get("/api/resource_profile_assignments", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.query.resourceId as string || req.mobileResourceId;
    if (!resourceId) return res.json([]);

    try {
      const rows = await db.execute(
        sql`SELECT * FROM resource_profile_assignments WHERE resource_id = ${resourceId}`
      );
      res.json(rows.rows || []);
    } catch {
      res.json([]);
    }
}));

app.get("/resource_profile_assignments", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.query.resourceId as string || req.mobileResourceId;
    if (!resourceId) return res.json([]);

    try {
      const rows = await db.execute(
        sql`SELECT * FROM resource_profile_assignments WHERE resource_id = ${resourceId}`
      );
      res.json(rows.rows || []);
    } catch {
      res.json([]);
    }
}));

app.post("/api/mobile/push-token", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      expoPushToken: z.string(),
      platform: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const existing = await db.select().from(pushTokens)
      .where(and(eq(pushTokens.resourceId, resourceId), eq(pushTokens.expoPushToken, parsed.data.expoPushToken)));

    if (existing.length > 0) {
      await db.update(pushTokens)
        .set({ platform: parsed.data.platform, updatedAt: new Date() })
        .where(eq(pushTokens.id, existing[0].id));
    } else {
      await db.insert(pushTokens).values({
        tenantId: resource.tenantId,
        resourceId,
        expoPushToken: parsed.data.expoPushToken,
        platform: parsed.data.platform,
      });
    }

    res.json({ success: true });
}));

app.delete("/api/mobile/push-token", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { expoPushToken } = req.body || {};
    if (expoPushToken) {
      await db.delete(pushTokens).where(and(eq(pushTokens.resourceId, resourceId), eq(pushTokens.expoPushToken, expoPushToken)));
    } else {
      await db.delete(pushTokens).where(eq(pushTokens.resourceId, resourceId));
    }
    res.json({ success: true });
}));

app.post("/api/mobile/status", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const schema = z.object({
      online: z.boolean(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    await db.update(resources)
      .set({
        isOnline: parsed.data.online,
        lastSeenAt: new Date(),
      })
      .where(eq(resources.id, resourceId));

    res.json({ success: true, status: parsed.data.online ? "online" : "offline" });
}));

app.post("/api/mobile/disruptions/trigger/delay", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      orderId: z.union([z.number(), z.string()]),
      estimatedDelay: z.number(),
      reason: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { triggerSignificantDelay } = await import("../disruption-service");
    const woId = String(parsed.data.orderId);
    const order = await storage.getWorkOrder(woId);
    const woTitle = order?.title || woId;

    const event = await triggerSignificantDelay(
      resource.tenantId, woId, woTitle,
      resourceId, resource.name,
      parsed.data.estimatedDelay, parsed.data.estimatedDelay * 2
    );

    res.json({ success: true, disruptionId: event?.id || null });
}));

app.post("/api/mobile/disruptions/trigger/early-completion", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      orderId: z.union([z.number(), z.string()]).optional(),
      savedMinutes: z.number(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { triggerEarlyCompletion } = await import("../disruption-service");
    const event = await triggerEarlyCompletion(resource.tenantId, resourceId, resource.name, parsed.data.savedMinutes);

    res.json({ success: true, disruptionId: event?.id || null });
}));

app.post("/api/mobile/disruptions/trigger/resource-unavailable", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const schema = z.object({
      reason: z.string().optional(),
      estimatedReturn: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { triggerResourceUnavailable } = await import("../disruption-service");
    const event = await triggerResourceUnavailable(resource.tenantId, resourceId, resource.name, parsed.data.reason);

    res.json({ success: true, disruptionId: event?.id || null });
}));

  
app.get("/api/mobile/route", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateStr = req.query.date as string || new Date().toISOString().slice(0, 10);

    const orders = await db.select().from(workOrders)
      .where(and(
        eq(workOrders.resourceId, resourceId),
        sql`DATE(${workOrders.scheduledDate}) = ${dateStr}`,
      ))
      .orderBy(workOrders.scheduledStartTime);

    const orderList = [];
    for (const o of orders) {
      const obj = o.objectId ? await storage.getObject(o.objectId) : null;
      orderList.push({
        id: o.id,
        title: o.title,
        status: o.status,
        scheduledDate: o.scheduledDate,
        scheduledStartTime: o.scheduledStartTime,
        estimatedDuration: o.estimatedDuration,
        latitude: obj?.latitude || null,
        longitude: obj?.longitude || null,
        address: obj?.address || "",
        objectName: obj?.name || "",
      });
    }

    res.json({ orders: orderList, totalDistance: 0, estimatedDuration: 0 });
}));

app.get("/api/mobile/route-optimized", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const dateStr = req.query.date as string || new Date().toISOString().slice(0, 10);

    const orders = await db.select().from(workOrders)
      .where(and(
        eq(workOrders.resourceId, resourceId),
        sql`DATE(${workOrders.scheduledDate}) = ${dateStr}`,
      ))
      .orderBy(workOrders.scheduledStartTime);

    const orderList = [];
    for (const o of orders) {
      const obj = o.objectId ? await storage.getObject(o.objectId) : null;
      orderList.push({
        id: o.id,
        title: o.title,
        status: o.status,
        latitude: obj?.latitude || null,
        longitude: obj?.longitude || null,
        address: obj?.address || "",
        objectName: obj?.name || "",
        estimatedDuration: o.estimatedDuration,
      });
    }

    const withCoords = orderList.filter(o => o.latitude && o.longitude);
    if (withCoords.length <= 1) {
      return res.json({ orders: orderList, totalDistance: 0, estimatedDuration: 0, savings: 0 });
    }

    try {
      const { getRoutingDistance } = await import("../distance-matrix-service");
      let totalDistance = 0;
      for (let i = 0; i < withCoords.length - 1; i++) {
        const result = await getRoutingDistance(
          withCoords[i].latitude!, withCoords[i].longitude!,
          withCoords[i+1].latitude!, withCoords[i+1].longitude!
        );
        totalDistance += result.distanceKm;
      }
      res.json({ orders: orderList, totalDistance: Math.round(totalDistance), estimatedDuration: 0, savings: 0 });
    } catch {
      res.json({ orders: orderList, totalDistance: 0, estimatedDuration: 0, savings: 0 });
    }
}));

app.post("/api/mobile/distance", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      from: z.object({ lat: z.number(), lng: z.number() }),
      to: z.object({ lat: z.number(), lng: z.number() }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { getRoutingDistance } = await import("../distance-matrix-service");
    const result = await getRoutingDistance(parsed.data.from.lat, parsed.data.from.lng, parsed.data.to.lat, parsed.data.to.lng);
    res.json({ distance: result.distanceKm, duration: result.durationMin });
}));

app.post("/api/mobile/distance/batch", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      points: z.array(z.object({ lat: z.number(), lng: z.number() })).min(2),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { getRoutingDistance } = await import("../distance-matrix-service");
    const legs = [];
    let totalDistance = 0, totalDuration = 0;

    for (let i = 0; i < parsed.data.points.length - 1; i++) {
      const p1 = parsed.data.points[i];
      const p2 = parsed.data.points[i + 1];
      const result = await getRoutingDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      legs.push({
        from: p1,
        to: p2,
        distance: result.distanceKm,
        duration: result.durationMin,
      });
      totalDistance += result.distanceKm;
      totalDuration += result.durationMin;
    }

    res.json({ legs, totalDistance, totalDuration });
}));

app.get("/api/mobile/break-config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const tenant = await storage.getTenant(resource.tenantId);
    const settings = (tenant?.settings as Record<string, any>) || {};
    const breakConfig = settings.breakConfig || {};

    res.json({
      breakDuration: breakConfig.durationMinutes || 30,
      autoPlace: breakConfig.autoPlace ?? true,
      lunchStart: breakConfig.earliestStart || "11:00",
      lunchEnd: breakConfig.latestEnd || "13:00",
      breakType: breakConfig.breakType || "flexible",
    });
}));

app.get("/api/mobile/eta-notification/history", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const notifications = await db.select().from(etaNotificationsTable)
      .where(eq(etaNotificationsTable.tenantId, resource.tenantId))
      .orderBy(desc(etaNotificationsTable.createdAt))
      .limit(50);

    res.json(notifications.map(n => ({
      id: n.id,
      orderId: n.workOrderId,
      customerName: "",
      sentAt: n.createdAt,
      etaMinutes: n.etaTime ? parseInt(n.etaTime) : null,
      status: n.status,
    })));
}));

app.get("/api/mobile/eta-notification/config", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const tenant = await storage.getTenant(resource.tenantId);
    const settings = (tenant?.settings as Record<string, any>) || {};
    const etaConfig = settings.etaNotification || {};

    res.json({
      enabled: etaConfig.enabled ?? true,
      autoSend: etaConfig.triggerOnEnRoute ?? true,
      marginMinutes: etaConfig.marginMinutes || 15,
    });
}));

app.post("/api/mobile/work-orders/carry-over", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const schema = z.object({
      orderIds: z.array(z.string()),
      targetDate: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    let movedCount = 0;
    const targetDate = new Date(parsed.data.targetDate);

    for (const orderId of parsed.data.orderIds) {
      const order = await storage.getWorkOrder(orderId);
      if (!order) continue;
      if (order.resourceId !== resourceId) continue;
      if (order.status === "completed" || order.status === "avslutad") continue;

      await db.update(workOrders)
        .set({ scheduledDate: targetDate })
        .where(eq(workOrders.id, orderId));
      movedCount++;
    }

    res.json({ success: true, movedCount });

    if (movedCount > 0) {
      notificationService.sendToResource(resourceId, {
        type: "schedule_changed",
        title: "Schema ändrat",
        message: `${movedCount} order(s) flyttade till ${parsed.data.targetDate}`,
        data: { event: "carry_over", movedCount, targetDate: parsed.data.targetDate }
      });
    }
}));

app.post("/api/mobile/work-orders/:id/auto-eta-sms", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const orderId = req.params.id;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");

    try {
      const result = await triggerETANotification(orderId, resourceId, resource.tenantId);
      res.json({
        success: true,
        etaMinutes: (result as any)?.etaMinutes || null,
        customerNotified: true,
      });
    } catch (err: any) {
      res.json({
        success: false,
        etaMinutes: null,
        customerNotified: false,
        error: err.message || "Kunde inte skicka ETA-notis",
      });
    }
}));

  }
  