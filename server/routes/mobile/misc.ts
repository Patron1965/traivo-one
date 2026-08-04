import type { Express } from "express";
  import {
    MobileAuthenticatedRequest, enrichOrderForMobile, broadcastPlannerEvent, handleQuickAction, getFallbackChecklist,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, isMobileAuthenticated, isAuthenticated,
    getTenantIdWithFallback, requirePlanner, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    routeFeedbackTable, orderChecklistItems, workOrders, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments,
    mapGoCategory, ONE_CATEGORIES, GO_CATEGORY_MAP,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, getObjectWithAllMetadata, writeArticleMetadataOnObject,
    getAllMetadataTypes, buildMetadataGroupIndex, expandArticleMetadataRows,
    usesQuantityMetadata, isActiveArticleStatus,
    invalidateWorkflowCaches,
  } from "./shared";
  import { resolveVehicleLocationForResource, listStockBalancesForLocation } from "../../services/stock-balance";
  import type { BatchPair } from "../../distance-matrix-service";
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
    const tenantId = getTenantIdWithFallback(req);
    const template = await storage.getChecklistTemplate(req.params.id, tenantId);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

app.post("/api/checklist-templates", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
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

app.patch("/api/checklist-templates/:id", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    const template = await storage.updateChecklistTemplate(req.params.id, tenantId, req.body);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

app.delete("/api/checklist-templates/:id", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteChecklistTemplate(req.params.id, tenantId);
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

    const allTemplates: Record<string, unknown>[] = [];
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
// BIL-LAGER (Lagermodul 2.0) — teknikerns saldo
// ============================================

// Saldon för teknikerns bil-lagerplats (resurs-koppling vinner över team).
// Tenant härleds ALLTID från mobilt token/resursen (bypassad yta — aldrig req.tenantId).
app.get("/api/mobile/stock/my-vehicle", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    let tenantId = req.mobileTenantId;
    if (!tenantId) {
      const resource = await storage.getResource(resourceId);
      if (!resource) throw new NotFoundError("Resurs hittades inte");
      tenantId = resource.tenantId;
    }

    const location = await resolveVehicleLocationForResource(tenantId, resourceId);
    if (!location) {
      res.json({ hasVehicleLocation: false, location: null, balances: [], lowCount: 0 });
      return;
    }
    const balances = await listStockBalancesForLocation(tenantId, location);
    res.json({
      hasVehicleLocation: true,
      location,
      balances,
      lowCount: balances.filter((b) => b.isLow).length,
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

app.get("/api/checklist/:workOrderId", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const { workOrderId } = req.params;
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) throw new NotFoundError("Arbetsorder hittades inte");
    const items = await db.select().from(orderChecklistItems)
      .where(eq(orderChecklistItems.workOrderId, workOrderId))
      .orderBy(orderChecklistItems.sortOrder);
    res.json(items);
}));

app.post("/api/checklist/:workOrderId/items", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const { workOrderId } = req.params;
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) throw new NotFoundError("Arbetsorder hittades inte");
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

app.patch("/api/checklist/items/:itemId", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const tenantId = getTenantIdWithFallback(req);
    const { isCompleted } = req.body;
    if (typeof isCompleted !== "boolean") {
      return res.status(400).json({ error: "isCompleted (boolean) krävs" });
    }
    const [existing] = await db.select().from(orderChecklistItems).where(eq(orderChecklistItems.id, itemId));
    if (!existing) throw new NotFoundError("Checklista-objekt hittades inte");
    const workOrder = await storage.getWorkOrder(existing.workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) throw new NotFoundError("Checklista-objekt hittades inte");
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

app.delete("/api/checklist/items/:itemId", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const tenantId = getTenantIdWithFallback(req);
    const [existing] = await db.select().from(orderChecklistItems).where(eq(orderChecklistItems.id, itemId));
    if (!existing) throw new NotFoundError("Checklista-objekt hittades inte");
    const workOrder = await storage.getWorkOrder(existing.workOrderId);
    if (!workOrder || workOrder.tenantId !== tenantId) throw new NotFoundError("Checklista-objekt hittades inte");
    await db.delete(orderChecklistItems)
      .where(eq(orderChecklistItems.id, itemId));
    res.json({ success: true });
}));

app.post("/api/checklist/:workOrderId/generate", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const { workOrderId } = req.params;
    const tenantId = getTenantIdWithFallback(req);

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!workOrder) {
      return res.status(404).json({ error: "Arbetsorder hittades inte" });
    }
    if (workOrder.tenantId !== tenantId) {
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
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: "Du genererar checklistor för fältservicetekniker. Svara alltid med en JSON-array av strängar." },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 500,
        response_format: { type: "json_object" },
      });

      const { trackOpenAIResponse } = await import("../../api-usage-tracker");
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

    // Behörighet: teknikern måste ha en aktiv (ej utförd/fakturerad) order för objektet.
    const activeAssignment = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(and(
        eq(workOrders.objectId, data.objectId),
        eq(workOrders.resourceId, resourceId),
        eq(workOrders.tenantId, tenantId),
        sql`${workOrders.orderStatus} NOT IN ('utford', 'fakturerad')`,
      ))
      .limit(1);
    if (activeAssignment.length === 0) {
      throw new ForbiddenError("Ej behörig att rapportera för detta objekt");
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
    const { contentType, size } = req.body;
    const { ObjectStorageService, ALLOWED_UPLOAD_MIME_TYPES } = await import("../../replit_integrations/object_storage/objectStorage");
    const { MAX_FIELD_PHOTO_SIZE_BYTES, MAX_FIELD_PHOTO_SIZE_MB } = await import("@shared/upload-limits");
    if (!contentType || !ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
      return res.status(400).json({ error: "File type not allowed. Only images and PDFs are permitted." });
    }
    if (size !== undefined && size !== null && Number(size) > MAX_FIELD_PHOTO_SIZE_BYTES) {
      return res.status(413).json({ error: `Bilden är för stor. Maxgräns är ${MAX_FIELD_PHOTO_SIZE_MB} MB.` });
    }
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

    const { ObjectStorageService } = await import("../../replit_integrations/object_storage/objectStorage");
    const { MAX_FIELD_PHOTO_SIZE_BYTES } = await import("@shared/upload-limits");
    const oss = new ObjectStorageService();

    // Tenant-scoped ownership so all members of this tenant can read the
    // photo while cross-tenant access is blocked.
    const miscMobileTenantId = (req as any).mobileTenantId as string | undefined;
    const miscOwner = miscMobileTenantId ? `tenant:${miscMobileTenantId}` : req.mobileResourceId;
    try {
      await oss.validateUploadedFileAndSetAcl(objectPath, miscOwner, "private", MAX_FIELD_PHOTO_SIZE_BYTES);
    } catch (err: any) {
      throw new ValidationError(err.message || "Filen hittades inte eller kunde inte verifieras");
    }

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

app.post("/api/quick-action", isAuthenticated, requirePlanner, asyncHandler(async (req: Request, res: Response) => {
    const { orderId, actionType } = req.body;
    const tenantId = getTenantIdWithFallback(req);
    const order = await storage.getWorkOrder(orderId);
    if (!order || order.tenantId !== tenantId) throw new NotFoundError("Order hittades inte");
    const result = await handleQuickAction(orderId, actionType);
    res.json(result);
}));

app.post("/api/mobile/travel-times", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { latitude, longitude, destinations } = req.body;

    if (latitude == null || longitude == null || !Array.isArray(destinations) || destinations.length === 0) {
      throw new ValidationError("latitude, longitude och destinations krävs");
    }
    if (typeof latitude !== "number" || typeof longitude !== "number" || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new ValidationError("Ogiltiga koordinater");
    }

    const validDestinations = destinations.filter((dest: Record<string, unknown>) =>
      dest && typeof dest.id === "string" &&
      typeof dest.lat === "number" && typeof dest.lng === "number" &&
      dest.lat >= -90 && dest.lat <= 90 && dest.lng >= -180 && dest.lng <= 180
    );
    if (validDestinations.length === 0) {
      return res.json({ results: [], source: "none" });
    }

    const haversineFallback = (dest: { id: string; lat: number; lng: number }) => {
      const R = 6371;
      const dLat = (dest.lat - latitude) * Math.PI / 180;
      const dLon = (dest.lng - longitude) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distKm = R * c;
      return { id: dest.id, distanceKm: Math.round(distKm * 10) / 10, durationMinutes: Math.max(1, Math.round(distKm * 1.4)) };
    };

    const { isGeoapifyRoutingAvailable, getRouteSummary } = await import("../../services/routing");

    if (!isGeoapifyRoutingAvailable()) {
      const results = validDestinations.map(haversineFallback);
      return res.json({ results, source: "haversine" });
    }

    try {
      const results = await Promise.all(
        validDestinations.slice(0, 20).map(async (dest: { id: string; lat: number; lng: number }) => {
          const summary = await getRouteSummary([
            { lat: latitude, lng: longitude },
            { lat: dest.lat, lng: dest.lng },
          ]);
          if (!summary) return haversineFallback(dest);
          return {
            id: dest.id,
            distanceKm: Math.round(summary.distanceKm * 10) / 10,
            durationMinutes: Math.round(summary.durationMinutes),
          };
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
    if (!order.objectId) return res.json({ articles: [], metadata: [], dependencyArticles: [], orderArticles: [] });

    // Mobil-ytan kringgår tenant-middleware: härled tenant från den ägarskaps-
    // kontrollerade ordern, aldrig från req.tenantId (se replit.md-gotcha).
    const tenantId = order.tenantId;
    const allArticles = await storage.getArticles(tenantId);

    const orderArticleIds: string[] = [];
    const orderArticleId = (order as Record<string, unknown>).articleId as string | undefined;
    if (orderArticleId) orderArticleIds.push(orderArticleId);

    // Task #835: härled hook-/objekttyp-restriktion från BÅDE legacy-fält OCH nya
    // associationRules (back-compat under expand-fasen; nya artiklar sätter bara regler).
    const relevantArticles = allArticles.filter(a => {
      if (a.status !== "active") return false;
      if (!(a.fetchMetadataLabel || a.canUpdateMetadata || a.isInfoCarrier)) return false;
      const rules = (a.associationRules as Array<{ source: string; types?: string[] }> | null) || [];
      const hasHook = !!(a.hookLevel && a.hookLevel.trim() !== "") ||
        rules.some(c => c.source === "hook_level");
      const objTypeRule = rules.find(c => c.source === "object_type");
      const hasObjectTypes = (Array.isArray(a.objectTypes) && a.objectTypes.length > 0) ||
        !!(objTypeRule && Array.isArray(objTypeRule.types) && objTypeRule.types.length > 0);
      // Original semantik: ta med order-artikeln, eller artiklar utan hook, eller utan objekttyp-restriktion.
      return orderArticleIds.includes(a.id) || !hasHook || !hasObjectTypes;
    });

    const objectWithMetadata = await getObjectWithAllMetadata(order.objectId, tenantId);
    const objectMetadata = objectWithMetadata?.metadata ?? [];

    const result = relevantArticles.map(article => {
      const fetchLabel = article.fetchMetadataLabel;
      const updateLabel = article.updateMetadataLabel;
      let fetchedValue: string | null = null;
      let previousValue: string | null = null;

      if (fetchLabel && objectMetadata.length > 0) {
        const match = objectMetadata.find((m) =>
          m.katalog?.beteckning === fetchLabel || m.katalog?.namn === fetchLabel
        );
        if (match) {
          fetchedValue = match.vardeString ?? (match.vardeInteger != null ? String(match.vardeInteger) : null) ?? null;
        }
      }

      if (updateLabel && article.showPreviousValue && objectMetadata.length > 0) {
        const match = objectMetadata.find((m) =>
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

    // G5: beroendeartiklarnas egna lagerplatser (depå) så att fältarbetaren kan
    // hämta material före huvuduppgiften. Härleds från orderns rader → artiklar med
    // dependencyMinutesBefore satt. Dedupar per artikel och summerar antal.
    const articleById = new Map(allArticles.map(a => [a.id, a]));
    const orderLines = await storage.getWorkOrderLines(order.id);
    const depMap = new Map<string, {
      articleId: string;
      articleName: string;
      articleNumber: string;
      quantity: number;
      stockLocation: string | null;
      stockLatitude: number | null;
      stockLongitude: number | null;
      dependencyMinutesBefore: number | null;
    }>();
    for (const line of orderLines) {
      if (!line.articleId) continue;
      const a = articleById.get(line.articleId);
      if (!a || a.status !== "active" || a.dependencyMinutesBefore == null) continue;
      const existing = depMap.get(a.id);
      if (existing) {
        existing.quantity += line.quantity ?? 0;
        continue;
      }
      depMap.set(a.id, {
        articleId: a.id,
        articleName: a.name,
        articleNumber: a.articleNumber,
        quantity: line.quantity ?? 0,
        stockLocation: a.stockLocation || null,
        stockLatitude: a.stockLatitude ?? null,
        stockLongitude: a.stockLongitude ?? null,
        dependencyMinutesBefore: a.dependencyMinutesBefore ?? null,
      });
    }
    const dependencyArticles = Array.from(depMap.values());

    // GAP-106 (Task #939): orderns artikelrader med antal, så fältappen kan visa
    // beställt antal (read-only). hideQuantityInApp döljer antalet i appen för artiklar
    // med fast/härlett antal — det fasta antalet används ändå automatiskt vid
    // rapportering/klarmarkering (line.quantity ändras aldrig av fältarbetaren).
    // Redigerbart antal i fält: blockeras helt om ordern redan konsoliderats/
    // exporterats (samma fakturaintegritets-gate som quantity-update-endpointen).
    const orderInvoiceLocked =
      order.invoiceQueueState === "consolidated" ||
      order.invoiceQueueState === "exported" ||
      !!order.consolidationInvoiceId;
    const orderArticles = orderLines
      .filter(line => !!line.articleId)
      .map(line => {
        const a = articleById.get(line.articleId!);
        // editableQuantity speglar EXAKT samma behörighet som quantity-update-
        // endpointen: antalet styrs av objektets metadata (per_styck/matches_field),
        // ett fält är valt, artikeln är aktiv, ej dold i appen och ordern ej låst.
        // Formel-läge och fasta antal är read-only.
        const editableQuantity =
          !orderInvoiceLocked &&
          !!a && isActiveArticleStatus(a.status) &&
          !a.hideQuantityInApp &&
          usesQuantityMetadata(a.quantityMode) &&
          !!a.quantityMetadataField;
        return {
          lineId: line.id,
          articleId: line.articleId!,
          articleName: a?.name ?? line.description ?? "Artikel",
          articleNumber: a?.articleNumber ?? null,
          quantity: line.quantity ?? 1,
          quantityUnit: a?.quantityUnit || a?.unit || "st",
          quantityMode: a?.quantityMode ?? null,
          hideQuantityInApp: a?.hideQuantityInApp ?? false,
          editableQuantity,
          // Task #989: markör för fältappen ("ska återtas") + om artikeln kan ruttas
          // tillbaka till lager (kräver lagerplats med koordinater).
          shouldBeReturned: a?.shouldBeReturned ?? false,
          hasStockLocation: !!(a?.stockLocation && a?.stockLatitude != null && a?.stockLongitude != null),
          // Uppgiftslogik v1 (kolumn T): taget antal + härledd svinn/retur. `quantity`
          // ovan är fakturerat/levererat och rör aldrig. takenQuantity=null ⇒ ej
          // registrerat än. Fältet är alltid registrerbart (även för fast/dolt antal)
          // så länge ordern ej är fakturalåst.
          takenQuantity: line.takenQuantity ?? null,
          wasteQuantity: line.wasteQuantity ?? 0,
          returnedQuantity: line.returnedQuantity ?? 0,
          quantityReconciliationNote: line.quantityReconciliationNote ?? null,
          takenQuantityEditable: !orderInvoiceLocked && !!a && isActiveArticleStatus(a.status),
          // Task #1316: teknikerns lagerkälle-val + om valet fortfarande går att
          // ändra (låst när uttag redan dragits från en annan plats än huvudlagret).
          takeFromMainStock: line.stockSourceOverride === "main",
          // hasStockLocation kräver koordinater (retur-ruttning); källvalet kräver
          // bara att artikeln HAR en huvudlagerplats.
          hasMainStockLocation: !!(a?.stockLocation && a.stockLocation.trim()),
          stockSourceLocked: !!line.stockAppliedLocation &&
            !!(a?.stockLocation && a.stockLocation.trim()) &&
            line.stockAppliedLocation !== a!.stockLocation!.trim(),
        };
      });

    // Ny modell (expand-contract): "Visa och uppdatera metadata" — per orderns
    // artiklar, med aktuellt värde på objektet. Legacy `articles`-arrayen ovan
    // lämnas orörd. Härleds via order.tenantId (mobil-ytan kringgår tenant-mw).
    // work_orders saknar articleId-kolumn (artikel-kopplingen bor på orderraderna);
    // härled därför artiklar enbart från orderLines.
    const taskArticleIds = new Set<string>();
    for (const line of orderLines) if (line.articleId) taskArticleIds.add(line.articleId);

    const showMetadataFields: Array<{
      articleId: string; articleName: string; metadataField: string;
      groupField: string | null;
      clarification: string | null; canUpdate: boolean;
      currentValue: string | null; displayValue: string | null;
    }> = [];
    const leaveMetadataFields: Array<{
      articleId: string; articleName: string; metadataField: string;
      groupField: string | null;
      instruction: string | null; required: boolean;
      currentValue: string | null; displayValue: string | null;
    }> = [];

    // Grupp-expansion (Alt B): en Visa/Lämna-rad som pekar på en grupp-förälder
    // (t.ex. "Kontakt") expanderas till sina barn FÖRE värde-uppslag — föräldern
    // bär aldrig värde. groupField bär förälderns namn så appen kan gruppera barnen
    // visuellt. Index laddas en gång (mobil-ytan: tenant härleds från ägd order).
    const groupIndex = buildMetadataGroupIndex(await getAllMetadataTypes(tenantId));

    for (const aid of Array.from(taskArticleIds)) {
      const a = articleById.get(aid);
      if (!a || !isActiveArticleStatus(a.status)) continue;
      const showRows = Array.isArray(a.showMetadataFields)
        ? (a.showMetadataFields as Array<{ metadataField?: string; clarification?: string; canUpdate?: boolean }>)
        : [];
      for (const row of expandArticleMetadataRows(showRows, groupIndex)) {
        if (!row.metadataField) continue;
        const current = await getArticleMetadataForObject(order.objectId, row.metadataField, tenantId);
        showMetadataFields.push({
          articleId: a.id,
          articleName: a.name,
          metadataField: row.metadataField,
          groupField: row.groupField ?? null,
          clarification: row.clarification ?? null,
          canUpdate: !!row.canUpdate,
          currentValue: current?.value != null ? String(current.value) : null,
          displayValue: current?.displayValue ?? null,
        });
      }
      const leaveRows = Array.isArray(a.leaveMetadataFields)
        ? (a.leaveMetadataFields as Array<{ metadataField?: string; instruction?: string; required?: boolean }>)
        : [];
      for (const row of expandArticleMetadataRows(leaveRows, groupIndex)) {
        if (!row.metadataField) continue;
        const current = await getArticleMetadataForObject(order.objectId, row.metadataField, tenantId);
        leaveMetadataFields.push({
          articleId: a.id,
          articleName: a.name,
          metadataField: row.metadataField,
          groupField: row.groupField ?? null,
          instruction: row.instruction ?? null,
          required: !!row.required,
          currentValue: current?.value != null ? String(current.value) : null,
          displayValue: current?.displayValue ?? null,
        });
      }
    }

    res.json({ articles: result, dependencyArticles, orderArticles, showMetadataFields, leaveMetadataFields });
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

    // Mobil-ytan kringgår tenant-middleware: härled tenant från den ägarskaps-
    // kontrollerade ordern (aldrig req.tenantId/fallback).
    const tenantId = order.tenantId;

    // Authorisering (IDOR-skydd): fältet måste vara konfigurerat som uppdaterbart på
    // någon av DENNA orders artiklar — annars kan en utförare skriva godtycklig
    // metadata på objektet via en spoofad metadataLabel.
    const allArticlesForAuth = await storage.getArticles(tenantId);
    const articleByIdForAuth = new Map(allArticlesForAuth.map((a) => [a.id, a]));
    const taskArticleIdsForAuth = new Set<string>();
    const authOrderLines = await storage.getWorkOrderLines(order.id);
    for (const l of authOrderLines) if (l.articleId) taskArticleIdsForAuth.add(l.articleId);
    // Grupp-expansion (Alt B): om en show-rad pekar på en grupp-förälder med
    // canUpdate=true är varje BARN skrivbart (klienten skickar barnets namn, aldrig
    // förälderns — föräldern bär inget värde). Index laddas en gång.
    const authGroupIndex = buildMetadataGroupIndex(await getAllMetadataTypes(tenantId));
    const isFieldUpdatable = (a: (typeof allArticlesForAuth)[number] | undefined): boolean => {
      if (!a || !isActiveArticleStatus(a.status)) return false;
      const showRows = Array.isArray(a.showMetadataFields)
        ? (a.showMetadataFields as Array<{ metadataField?: string; canUpdate?: boolean }>)
        : [];
      if (expandArticleMetadataRows(showRows, authGroupIndex).some((r) => r.canUpdate && r.metadataField === metadataLabel)) return true;
      // Legacy: artikel med canUpdateMetadata + matchande etikett.
      if (a.canUpdateMetadata && (a.updateMetadataLabel === metadataLabel || a.fetchMetadataLabel === metadataLabel)) return true;
      return false;
    };
    let updateAllowed = false;
    if (articleId && taskArticleIdsForAuth.has(articleId)) {
      updateAllowed = isFieldUpdatable(articleByIdForAuth.get(articleId));
    } else {
      for (const aid of Array.from(taskArticleIdsForAuth)) {
        if (isFieldUpdatable(articleByIdForAuth.get(aid))) { updateAllowed = true; break; }
      }
    }
    if (!updateAllowed) throw new ForbiddenError("Fältet är inte konfigurerat som uppdaterbart för denna order");

    // Tidigare värde (för audit-spår): slå upp aktuellt metadata-värde på objektet
    // via 3-arg-signaturen (objectId, fält, tenant) som returnerar ett enskilt
    // värde eller null.
    const currentMeta = await getArticleMetadataForObject(order.objectId, metadataLabel, tenantId);
    const previousValue: string | null =
      currentMeta?.value != null ? String(currentMeta.value) : null;

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

// Redigerbart antal i fält (Traivo Go): fältarbetaren justerar det faktiska antalet
// per orderrad. Skriver tillbaka TVÅ ställen: (1) orderraden (work_order_lines.quantity
// → detta jobb/faktura, med recalc av ordertotaler) och (2) objektets antals-
// metadatafält (quantityMetadataField → framtida expansioner ärver det nya antalet)
// + metadata-historik. Endast tillåtet när antalet styrs av objektets metadata
// (per_styck/matches_field), fältet är valt, artikeln aktiv och inte dold i appen.
// Formel-läge är read-only. Blockeras om ordern redan konsoliderats/exporterats
// (fakturaintegritet). Tenant + ägarskap härleds enbart ur den ägda ordern (ingen IDOR).
app.post("/api/mobile/tasks/:id/quantity-update", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { lineId, quantity } = req.body ?? {};

    if (!lineId || quantity === undefined || quantity === null) {
      throw new ValidationError("lineId och quantity krävs");
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new ValidationError("Ogiltigt antal");
    }
    const qtyInt = Math.round(qty);

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    if (!order.objectId) throw new ValidationError("Order saknar objekt");

    // Mobil-ytan kringgår tenant-middleware: härled tenant från den ägarskaps-
    // kontrollerade ordern (aldrig req.tenantId/fallback).
    const tenantId = order.tenantId;

    // Fakturaintegritet: blockera ändring när ordern redan är konsoliderad/exporterad.
    if (order.invoiceQueueState === "consolidated" || order.invoiceQueueState === "exported" || order.consolidationInvoiceId) {
      throw new ForbiddenError("Antalet kan inte ändras — ordern är redan fakturerad eller konsoliderad");
    }

    // Raden måste tillhöra DENNA order (IDOR-skydd via ägd order, aldrig rå lineId).
    const lines = await storage.getWorkOrderLines(order.id);
    const line = lines.find((l) => l.id === lineId);
    if (!line || !line.articleId) throw new NotFoundError("Orderrad hittades inte");

    // getArticle saknar tenant-param → verifiera tenant explicit efter uppslag.
    const article = await storage.getArticle(line.articleId);
    if (!article || article.tenantId !== tenantId || !isActiveArticleStatus(article.status)) {
      throw new ForbiddenError("Antalet kan inte ändras för denna artikel");
    }
    if (article.hideQuantityInApp) {
      throw new ForbiddenError("Antalet är dolt i appen för denna artikel");
    }
    if (!usesQuantityMetadata(article.quantityMode) || !article.quantityMetadataField) {
      throw new ForbiddenError("Antalet kan endast ändras för artiklar vars antal styrs av objektets metadata");
    }

    const previousLineQuantity = line.quantity ?? null;

    // Skrivordning (ingen delad DB-transaktion möjlig — både writeArticleMetadataOnObject
    // och updateWorkOrderLine använder modul-global db utan tx-handle). Skriv objektets
    // antals-metadatafält FÖRST: den slår upp katalogfältet och kastar rent vid felkonfig
    // INNAN den fakturakritiska orderraden rörs, så ett metadata-fel aldrig kan lämna
    // fakturabasens antal ändrat medan anropet returnerar fel. Avbrott efter metadatan men
    // före orderraden konvergerar vid nytt försök (metadata-skrivningen är värde-idempotent).
    // metod 'utforande' = fältarbetarens registrering (auto-ursprung i ändringsloggen).
    await writeArticleMetadataOnObject(order.objectId, article.quantityMetadataField, String(qtyInt), tenantId, resourceId, 'utforande');

    // Writeback orderraden (detta jobb/faktura). Recalc av ordertotaler sker i storage.
    await storage.updateWorkOrderLine(line.id, { quantity: qtyInt });

    // Audit-spår i samma logg som övrig metadata-uppdatering från fält.
    await db.insert(taskMetadataUpdates).values({
      tenantId,
      workOrderId: orderId,
      objectId: order.objectId,
      articleId: article.id,
      metadataLabel: article.quantityMetadataField,
      previousValue: previousLineQuantity != null ? String(previousLineQuantity) : null,
      newValue: String(qtyInt),
      updatedBy: resourceId,
    });

    console.log(`[mobile] Quantity updated: line ${line.id} = ${qtyInt} (metadata ${article.quantityMetadataField}) on object ${order.objectId} by ${resourceId}`);

    res.json({ success: true, lineId: line.id, quantity: qtyInt, quantityMetadataField: article.quantityMetadataField });
}));

// ============================================
// TAGET ANTAL (kolumn T) — Uppgiftslogik v1
// Registrerar verkligt taget/förbrukat antal per orderrad UTAN att röra det
// fakturerade/levererade `quantity`. Överskott (taken - quantity) härleds till
// svinn (förbrukning) eller retur-till-lager (om artikeln är märkt shouldBeReturned),
// enligt Mats beslut. Append-only audit i work_order_line_quantity_events.
// ============================================
app.post("/api/mobile/tasks/:id/taken-quantity-update", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const { lineId, takenQuantity, note, takeFromMainStock } = req.body ?? {};

    if (!lineId || takenQuantity === undefined || takenQuantity === null) {
      throw new ValidationError("lineId och takenQuantity krävs");
    }
    const taken = Number(takenQuantity);
    if (!Number.isFinite(taken) || taken < 0) {
      throw new ValidationError("Ogiltigt taget antal");
    }
    const takenInt = Math.round(taken);

    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");

    // Mobil-ytan kringgår tenant-middleware: härled tenant från den ägarskaps-
    // kontrollerade ordern (aldrig req.tenantId/fallback).
    const tenantId = order.tenantId;

    // Fakturaintegritet: blockera ändring när ordern redan är konsoliderad/exporterad.
    if (order.invoiceQueueState === "consolidated" || order.invoiceQueueState === "exported" || order.consolidationInvoiceId) {
      throw new ForbiddenError("Taget antal kan inte ändras — ordern är redan fakturerad eller konsoliderad");
    }

    // Raden måste tillhöra DENNA order (IDOR-skydd via ägd order, aldrig rå lineId).
    const lines = await storage.getWorkOrderLines(order.id);
    const line = lines.find((l) => l.id === lineId);
    if (!line || !line.articleId) throw new NotFoundError("Orderrad hittades inte");

    // getArticle saknar tenant-param → verifiera tenant explicit efter uppslag.
    const article = await storage.getArticle(line.articleId);
    if (!article || article.tenantId !== tenantId || !isActiveArticleStatus(article.status)) {
      throw new ForbiddenError("Taget antal kan inte registreras för denna artikel");
    }

    // Fakturerat/levererat antal (rör ALDRIG). Taget måste vara >= det fakturerade —
    // man kan inte leverera/fakturera mer än man tagit.
    const billable = line.quantity ?? 0;
    if (takenInt < billable) {
      throw new ValidationError(`Taget antal (${takenInt}) kan inte vara mindre än det fakturerade antalet (${billable})`);
    }

    // Överskott (taket - fakturerat) härleds enligt artikelns retur-flagga:
    // shouldBeReturned ⇒ återlager (retur), annars ⇒ svinn/förbrukning.
    const surplus = Math.max(takenInt - billable, 0);
    const returnedQty = article.shouldBeReturned ? surplus : 0;
    const wasteQty = article.shouldBeReturned ? 0 : surplus;
    const trimmedNote = typeof note === "string" && note.trim() ? note.trim() : null;

    // Task #1316: teknikerns val av lagerkälla ("ta från huvudlager"). Sparas FÖRE
    // reconcile så platsvalet respekteras vid första lagerdraget. Valet kan bara
    // påverka rader vars plats inte redan stämplats (stockAppliedLocation vinner —
    // retur måste hamna på samma plats som uttaget). Utelämnat ⇒ oförändrat.
    if (takeFromMainStock !== undefined && takeFromMainStock !== null) {
      if (typeof takeFromMainStock !== "boolean") {
        throw new ValidationError("takeFromMainStock måste vara true/false");
      }
      if (takeFromMainStock && line.stockAppliedLocation) {
        const mainLocation = (article.stockLocation ?? "").trim();
        if (mainLocation && line.stockAppliedLocation !== mainLocation) {
          throw new ValidationError("Uttag har redan dragits från en annan lagerplats — lagerkällan kan inte ändras för denna rad");
        }
      }
    }

    // Skriv taget/svinn/retur på orderraden. `quantity` (fakturabas) utelämnas medvetet.
    await storage.updateWorkOrderLine(line.id, {
      takenQuantity: takenInt,
      wasteQuantity: wasteQty,
      returnedQuantity: returnedQty,
      quantityReconciliationNote: trimmedNote,
      ...(typeof takeFromMainStock === "boolean"
        ? { stockSourceOverride: takeFromMainStock ? "main" : null }
        : {}),
    });

    // Append-only audit (INTE en lagerledger — bär bara signalen). Ett 'taken'-event
    // per registrering + ett svinn-/retur-event när överskott finns.
    const { workOrderLineQuantityEvents } = await import("@shared/schema");
    const events: Array<{ tenantId: string; workOrderLineId: string; workOrderId: string; articleId: string | null; eventType: string; quantity: number; reason: string | null; createdBy: string | null }> = [
      { tenantId, workOrderLineId: line.id, workOrderId: order.id, articleId: line.articleId, eventType: "taken", quantity: takenInt, reason: trimmedNote, createdBy: resourceId ?? null },
    ];
    if (wasteQty > 0) {
      events.push({ tenantId, workOrderLineId: line.id, workOrderId: order.id, articleId: line.articleId, eventType: "waste", quantity: wasteQty, reason: trimmedNote, createdBy: resourceId ?? null });
    }
    if (returnedQty > 0) {
      events.push({ tenantId, workOrderLineId: line.id, workOrderId: order.id, articleId: line.articleId, eventType: "return", quantity: returnedQty, reason: trimmedNote, createdBy: resourceId ?? null });
    }
    await db.insert(workOrderLineQuantityEvents).values(events);

    // Lagermodell (Motor 8): dra taget/förbrukat från lagersaldot (retur läggs
    // automatiskt tillbaka via netto = taget - retur). Idempotent + best-effort —
    // får aldrig blockera registreringen. No-op om artikeln saknar lagerplats.
    let stockSignal: { balance: number; effectiveReorderPoint: number | null; isLow: boolean } | null = null;
    if (article.stockLocation && article.stockLocation.trim()) {
      try {
        const { reconcileWorkOrderLineStock, getStockSignalForArticleLocation } = await import("../../services/stock-balance");
        await reconcileWorkOrderLineStock(tenantId, line.id);
        // Lagermodul 2.0: signalera saldot för platsen som draget faktiskt
        // applicerades mot (bil-lager eller huvudlager) — inte alltid artikelns.
        const { workOrderLines } = await import("@shared/schema");
        const [updatedLine] = await db
          .select({ stockAppliedLocation: workOrderLines.stockAppliedLocation })
          .from(workOrderLines)
          .where(and(eq(workOrderLines.id, line.id), eq(workOrderLines.tenantId, tenantId)));
        const signalLocation = updatedLine?.stockAppliedLocation ?? article.stockLocation;
        stockSignal = await getStockSignalForArticleLocation(tenantId, article.id, signalLocation);
      } catch (stockErr) {
        console.error("[stock-balance] reconcile (taken-quantity-update) misslyckades:", stockErr);
      }
    }

    console.log(`[mobile] Taget antal: line ${line.id} taken=${takenInt} waste=${wasteQty} return=${returnedQty} (billable ${billable}) by ${resourceId}`);

    res.json({
      success: true,
      lineId: line.id,
      takenQuantity: takenInt,
      wasteQuantity: wasteQty,
      returnedQuantity: returnedQty,
      quantity: billable,
      quantityReconciliationNote: trimmedNote,
      stock: stockSignal,
    });
}));

// Historik för taget antal (expansions-panelen i fältappen). Ägarskap via ägd order;
// valfri lineId-filtrering (kontrolleras mot orderns egna rader).
app.get("/api/mobile/tasks/:id/quantity-events", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const orderId = req.params.id;
    const resourceId = req.mobileResourceId;
    const order = await storage.getWorkOrder(orderId);
    if (!order) throw new NotFoundError("Order hittades inte");
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    const tenantId = order.tenantId;

    const { workOrderLineQuantityEvents } = await import("@shared/schema");
    const lineIdFilter = typeof req.query.lineId === "string" ? req.query.lineId : null;
    if (lineIdFilter) {
      // Bekräfta att raden tillhör ägd order (aldrig rå lineId).
      const lines = await storage.getWorkOrderLines(order.id);
      if (!lines.some((l) => l.id === lineIdFilter)) throw new NotFoundError("Orderrad hittades inte");
    }

    const rows = await db
      .select()
      .from(workOrderLineQuantityEvents)
      .where(and(
        eq(workOrderLineQuantityEvents.tenantId, tenantId),
        eq(workOrderLineQuantityEvents.workOrderId, order.id),
        ...(lineIdFilter ? [eq(workOrderLineQuantityEvents.workOrderLineId, lineIdFilter)] : []),
      ))
      .orderBy(desc(workOrderLineQuantityEvents.createdAt));

    res.json(rows);
}));

  // ============================================
// DISTANCE API — REST endpoints for distance calculations
// ============================================
app.post("/api/distance", asyncHandler(async (req: Request, res: Response) => {
    const { getRoutingDistance } = await import("../../distance-matrix-service");
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
    const { getBatchDistances } = await import("../../distance-matrix-service");
    const { pairs } = req.body;

    if (!pairs || !Array.isArray(pairs)) {
      throw new ValidationError("pairs-array krävs");
    }

    const batchPairs = pairs.map((rawPair: unknown, i: number) => {
      const p = rawPair as {
        id?: string;
        fromLat?: number; fromLng?: number; toLat?: number; toLng?: number;
        origin?: { lat?: number; lng?: number };
        destination?: { lat?: number; lng?: number };
      };
      return {
        id: (p.id as string) || String(i),
        fromLat: p.fromLat ?? p.origin?.lat,
        fromLng: p.fromLng ?? p.origin?.lng,
        toLat: p.toLat ?? p.destination?.lat,
        toLng: p.toLng ?? p.destination?.lng,
      };
    }) as BatchPair[];

    const resultMap = await getBatchDistances(batchPairs);
    const resultsArray: Record<string, unknown>[] = [];
    const resultsById: Record<string, Record<string, unknown>> = {};

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
    const settings = (tenant?.settings as Record<string, unknown>) || {};

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
      const teamIds = (teamRows.rows || []).map((r: Record<string, unknown>) => r.id as string);
      if (teamIds.length === 0) return res.json({ orders: [], total: 0 });

      const memberRows = await db.execute(
        sql`SELECT DISTINCT resource_id FROM team_members
            WHERE team_id = ANY(${teamIds}::text[]) AND resource_id != ${resourceId} AND status = 'active'`
      );
      const memberResourceIds = (memberRows.rows || []).map((r: Record<string, unknown>) => r.resource_id as string);
      if (memberResourceIds.length === 0) return res.json({ orders: [], total: 0 });

      const tenantId = getTenantIdWithFallback(req);
      const allOrders = await storage.getWorkOrders(tenantId);
      let orders = allOrders.filter(o => !!o.resourceId && memberResourceIds.includes(o.resourceId));

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
    const photos = (metadata.photos as Record<string, unknown>[]) || [];
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
    const photos = (metadata.photos as Record<string, unknown>[]) || [];
    const photo = photos.find((p: Record<string, unknown>) => p.id === photoId);
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
    const signoffSignedAt = new Date().toISOString();
    metadata.customerSignoff = {
      customerName: customerName || "",
      signature,
      summary: summary || "",
      materials: materials || [],
      deviations: deviations || [],
      signedAt: signoffSignedAt,
      signedBy: resourceId,
    };

    await storage.updateWorkOrder(orderId, {
      metadata: { ...metadata },
      executionStatus: "signed_off",
    });
    res.json({ success: true, signedAt: signoffSignedAt });
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
    // Always scope to the authenticated caller — never allow a client-supplied resourceId.
    const resourceId = req.mobileResourceId;
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
    // Always scope to the authenticated caller — never allow a client-supplied resourceId.
    const resourceId = req.mobileResourceId;
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

// OBS: Detta är **resurs**-status (online/offline för mobil-användaren), inte work-order-status.
// Trots det missvisande namnet är endpoint:en behållen för bakåtkompatibilitet med
// publicerade mobil-app-versioner. Se `docs/wo-status-endpoints.md`.
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

    const { triggerSignificantDelay } = await import("../../disruption-service");
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

    const { triggerEarlyCompletion } = await import("../../disruption-service");
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

    const { triggerResourceUnavailable } = await import("../../disruption-service");
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
      const { getRoutingDistance } = await import("../../distance-matrix-service");
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

    const { getRoutingDistance } = await import("../../distance-matrix-service");
    const result = await getRoutingDistance(parsed.data.from.lat, parsed.data.from.lng, parsed.data.to.lat, parsed.data.to.lng);
    res.json({ distance: result.distanceKm, duration: result.durationMin });
}));

app.post("/api/mobile/distance/batch", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const schema = z.object({
      points: z.array(z.object({ lat: z.number(), lng: z.number() })).min(2),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const { getRoutingDistance } = await import("../../distance-matrix-service");
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
    const settings = (tenant?.settings as Record<string, unknown>) || {};
    const breakConfig = (settings.breakConfig as Record<string, unknown>) || {};

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
    const settings = (tenant?.settings as Record<string, unknown>) || {};
    const etaConfig = (settings.etaNotification as Record<string, unknown>) || {};

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
    const touchedTenants = new Set<string>();

    for (const orderId of parsed.data.orderIds) {
      const order = await storage.getWorkOrder(orderId);
      if (!order) continue;
      if (order.resourceId !== resourceId) continue;
      if (order.status === "completed" || order.status === "avslutad") continue;

      await db.update(workOrders)
        .set({ scheduledDate: targetDate })
        .where(eq(workOrders.id, orderId));
      movedCount++;
      if (order.tenantId) touchedTenants.add(order.tenantId);
    }

    for (const tid of touchedTenants) invalidateWorkflowCaches(tid);

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
    if (order.resourceId !== resourceId) throw new ForbiddenError("Ej behörig");
    if (order.tenantId !== resource.tenantId) throw new ForbiddenError("Ej behörig");

    try {
      const result = await triggerETANotification(orderId, resourceId, resource.tenantId);
      res.json({
        success: true,
        etaMinutes: (result as Record<string, unknown>)?.etaMinutes || null,
        customerNotified: true,
      });
    } catch (err: unknown) {
      res.json({
        success: false,
        etaMinutes: null,
        customerNotified: false,
        error: (err instanceof Error ? err.message : null) || "Kunde inte skicka ETA-notis",
      });
    }
}));

  }
  