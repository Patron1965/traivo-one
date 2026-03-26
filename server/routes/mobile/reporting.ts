import type { Express } from "express";
  import {
    MobileAuthenticatedRequest, enrichOrderForMobile, broadcastPlannerEvent, handleQuickAction, getFallbackChecklist,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    isAuthenticated,
    routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments, workEntries, workSessions,
    mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, writeArticleMetadataOnObject,
    handleWorkOrderStatusChange,
  } from "./shared";
  import type { Request, Response } from "express";
  
  export function registerReportingRoutes(app: Express) {
  app.post("/api/mobile/gps", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const { latitude, longitude, speed, heading, accuracy, currentOrderId, currentOrderNumber, vehicleRegNo, driverName } = req.body;

    if (latitude === undefined || longitude === undefined) {
      throw new ValidationError("Latitud och longitud krävs");
    }

    await notificationService.handlePositionUpdate({
      resourceId,
      latitude,
      longitude,
      speed: speed || 0,
      heading: heading || 0,
      accuracy: accuracy || 0,
      status: currentOrderId ? "on_site" : "traveling",
      workOrderId: currentOrderId,
    });

    res.json({ success: true });
}));

app.get("/api/mobile/summary", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) throw new NotFoundError("Resurs hittades inte");

    const tenantId = resource.tenantId;
    const allOrders = await storage.getWorkOrders(tenantId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayOrders = allOrders.filter(o => {
      if (o.resourceId !== resourceId) return false;
      if (!o.scheduledDate) return false;
      const d = new Date(o.scheduledDate);
      return d >= today && d < tomorrow;
    });

    const completedOrders = todayOrders.filter(o => o.orderStatus === "utford" || o.executionStatus === "completed").length;
    const totalDuration = todayOrders.reduce((sum, o) => sum + (o.estimatedDuration || 0), 0);

    res.json({
      totalOrders: todayOrders.length,
      completedOrders,
      remainingOrders: todayOrders.length - completedOrders,
      totalDuration,
    });
}));

app.get("/api/mobile/weather", asyncHandler(async (req, res) => {
    const lat = parseFloat(req.query.lat as string) || 57.7089;
    const lon = parseFloat(req.query.lon as string) || 11.9746;

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&current_weather=true&timezone=Europe/Stockholm`
    );
    const data = await weatherRes.json();
    res.json(data);
}));

app.post("/api/mobile/ai/chat", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { message, context } = req.body;
    if (!message) throw new ValidationError("Meddelande krävs");

    const tenantId = req.tenantId || "default-tenant";
    const { enforceBudgetAndRateLimit, withRetry } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "chat");
    if (!enforcement.allowed) {
      if (enforcement.errorType === "ratelimit") {
        res.set("Retry-After", String(enforcement.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden", response: "AI-tjänsten är tillfälligt otillgänglig." });
    }
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI();

    const completion = await withRetry(() => openai.chat.completions.create({
      model: enforcement.model,
      messages: [
        {
          role: "system",
          content: "Du är en hjälpsam AI-assistent för fältarbetare inom avfallshantering och fastighetsskötsel i Sverige. Svara alltid på svenska. Var kortfattad och praktisk. " +
            (context ? `Kontext: Order ${context.orderNumber || ""}, Kund: ${context.customerName || ""}` : ""),
        },
        { role: "user", content: message },
      ],
      max_tokens: 500,
    }), { label: "mobile-chat" });

    const { trackOpenAIResponse } = await import("../api-usage-tracker");
    trackOpenAIResponse(completion, tenantId);
    res.json({ response: completion.choices[0]?.message?.content || "Inget svar" });
}));

app.post("/api/mobile/ai/transcribe", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { audio } = req.body;
    if (!audio) throw new ValidationError("Ljuddata krävs");

    const transcribeTenantId = req.tenantId || "default-tenant";
    const { enforceBudgetAndRateLimit: transcribeEnforce, withRetry: transcribeRetry } = await import("../ai-budget-service");
    const transcribeCheck = await transcribeEnforce(transcribeTenantId, "chat");
    if (!transcribeCheck.allowed) {
      if (transcribeCheck.errorType === "ratelimit") {
        res.set("Retry-After", String(transcribeCheck.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: transcribeCheck.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden" });
    }

    const buffer = Buffer.from(audio, "base64");
    const blob = new Blob([buffer], { type: "audio/webm" });
    const file = new File([blob], "audio.webm", { type: "audio/webm" });

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI();
    const transcription = await transcribeRetry(() => openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "sv",
    }), { label: "mobile-transcribe" });

    const { trackApiUsage } = await import("../api-usage-tracker");
    trackApiUsage({ tenantId: transcribeTenantId, service: "openai", method: "audio.transcriptions", endpoint: "/v1/audio/transcriptions", model: "whisper-1", inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    res.json({ text: transcription.text });
}));

app.post("/api/mobile/ai/analyze-image", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const { image, context } = req.body;
    if (!image) throw new ValidationError("Image data required");

    const imgTenantId = req.tenantId || "default-tenant";
    const { enforceBudgetAndRateLimit: imgEnforce, withRetry: imgRetry } = await import("../ai-budget-service");
    const imgCheck = await imgEnforce(imgTenantId, "analysis");
    if (!imgCheck.allowed) {
      if (imgCheck.errorType === "ratelimit") {
        res.set("Retry-After", String(imgCheck.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: imgCheck.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden" });
    }
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI();
    const completion = await imgRetry(() => openai.chat.completions.create({
      model: imgCheck.model,
      messages: [
        {
          role: "system",
          content: "Du analyserar bilder för fältarbetare inom avfallshantering. Svara på svenska med JSON-format: {category, description, severity}. Severity: low/medium/high. " +
            (context ? `Kontext: ${context}` : ""),
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analysera denna bild och identifiera eventuella problem eller avvikelser." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
          ],
        },
      ],
      max_tokens: 300,
    }), { label: "mobile-analyze-image" });

    const { trackOpenAIResponse: trackImg } = await import("../api-usage-tracker");
    trackImg(completion, imgTenantId);
    const responseText = completion.choices[0]?.message?.content || "";
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { category: "unknown", description: responseText, severity: "medium" };
      res.json(parsed);
    } catch {
      res.json({ category: "unknown", description: responseText, severity: "medium" });
    }
}));

// ============================================
// OFFLINE SYNC API (Mobile Field App)
// ============================================

  }
  