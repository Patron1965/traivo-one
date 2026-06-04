import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback, assignUserToTenant, getUserTenants } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, UnauthorizedError, ForbiddenError, ConflictError } from "../errors";
import { objects, workOrders, articles , insertDeviationReportSchema, insertProtocolSchema, apiUsageLogs, taskDependencyInstances, invitations } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek, getDateFromWeekdayInMonth } from "./helpers";
import { notificationService } from "../notifications";
import { sendEmail } from "../replit_integrations/resend";
import { requireAdmin, requirePlanner } from "../tenant-middleware";
import { hashPassword } from "../password";
import { getArticleMetadataForObject, writeArticleMetadataOnObject, createMetadata, getAllMetadataTypes, writeSystemMetadataOnObject } from "../metadata-queries";
import { signDynamicQrToken, verifyDynamicQrToken, verifyObjectQrToken } from "../dynamic-qr-token";
import { checkPublicReportRateLimit, getClientKeyForRequest } from "../public-report-rate-limit";
import { RateLimitError } from "../errors";
import { ObjectStorageService, ALLOWED_UPLOAD_MIME_TYPES } from "../replit_integrations/object_storage/objectStorage";
import { getObjectAclPolicy } from "../replit_integrations/object_storage/objectAcl";
import { MAX_FIELD_PHOTO_SIZE_BYTES, MAX_FIELD_PHOTO_SIZE_MB } from "@shared/upload-limits";

export async function registerExtendedRoutes(app: Express) {
// ============================================
// PUBLIC ISSUE REPORT API (No auth required - for QR code scanning)
// ============================================

// Get object info and report form by QR code
app.get("/api/public/report/:code", asyncHandler(async (req, res) => {
    const { code } = req.params;
    
    const qrLink = await storage.getQrCodeLinkByCode(code);
    if (!qrLink) {
      throw new NotFoundError("Ogiltig QR-kod");
    }
    
    if (!qrLink.isActive) {
      return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });
    }
    
    // Increment scan count
    await storage.incrementQrCodeScanCount(qrLink.id);
    
    // Get object info (limited)
    const object = await storage.getObject(qrLink.objectId);
    if (!object) {
      throw new NotFoundError("Objekt hittades inte");
    }
    
    // Get tenant branding
    const { tenantBranding } = await import("@shared/schema");
    const [branding] = await db.select().from(tenantBranding)
      .where(eq(tenantBranding.tenantId, qrLink.tenantId));
    
    // Return limited info for public display
    res.json({
      objectId: object.id,
      objectName: object.name,
      objectAddress: object.address,
      qrLabel: qrLink.label,
      tenantId: qrLink.tenantId,
      companyName: branding?.companyName || 'Fältservice',
      primaryColor: branding?.primaryColor || '#3B82F6',
      categories: [
        { id: 'graffiti', label: 'Klotter' },
        { id: 'damage', label: 'Skada' },
        { id: 'spill', label: 'Spill/utsläpp' },
        { id: 'lighting', label: 'Belysning' },
        { id: 'large_items', label: 'Stora föremål' },
        { id: 'safety', label: 'Säkerhetsproblem' },
        { id: 'other', label: 'Övrigt' },
      ],
    });
}));

// Submit public issue report (no auth)
app.post("/api/public/report/:code", asyncHandler(async (req, res) => {
    const rateCheck = checkPublicReportRateLimit(getClientKeyForRequest(req));
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      throw new RateLimitError(
        "För många felanmälningar från denna enhet. Vänta en stund och försök igen.",
      );
    }

    const { code } = req.params;
    const { category, title, description, reporterName, reporterEmail, reporterPhone, photos, latitude, longitude } = req.body;
    
    const qrLink = await storage.getQrCodeLinkByCode(code);
    if (!qrLink) {
      throw new NotFoundError("Ogiltig QR-kod");
    }
    
    if (!qrLink.isActive) {
      return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });
    }
    
    if (!category || !title) {
      throw new ValidationError("Kategori och titel krävs");
    }

    // Task #714: felbeskrivning är obligatorisk för felanmälan.
    if (!description || typeof description !== "string" || description.trim().length === 0) {
      throw new ValidationError("Beskrivning krävs");
    }

    // Task #714: validera foton hårt. Klienten får bara skicka bekräftade,
    // tenant-ägda /objects/-sökvägar (satta via confirm-upload). Vi verifierar
    // ACL-ägaren server-side så att foton från annan tenant eller godtyckliga
    // URL:er aldrig persisteras (bypassar ej upload-confirm-pipelinen).
    let validatedPhotos: string[] | undefined;
    if (photos !== undefined && photos !== null) {
      const photosSchema = z.array(z.string().min(1).max(512)).max(10);
      const parsedPhotos = photosSchema.safeParse(photos);
      if (!parsedPhotos.success) {
        throw new ValidationError("Ogiltig fotolista (max 10 bilder).");
      }
      const objectStorageService = new ObjectStorageService();
      const accepted: string[] = [];
      for (const objectPath of parsedPhotos.data) {
        if (!/^\/objects\/[a-zA-Z0-9/_-]+$/.test(objectPath)) {
          throw new ValidationError("Ogiltig objektsökväg för foto.");
        }
        let aclOwner: string | null = null;
        try {
          const file = await objectStorageService.getObjectEntityFile(objectPath);
          const acl = await getObjectAclPolicy(file);
          aclOwner = acl?.owner ?? null;
        } catch {
          throw new ValidationError("Ett bifogat foto kunde inte hittas. Ladda upp på nytt.");
        }
        if (aclOwner !== `tenant:${qrLink.tenantId}`) {
          throw new ValidationError("Ett bifogat foto är inte giltigt för denna anmälan.");
        }
        accepted.push(objectPath);
      }
      validatedPhotos = accepted.length > 0 ? accepted : undefined;
    }

    // Create public issue report
    const report = await storage.createPublicIssueReport({
      tenantId: qrLink.tenantId,
      qrCodeLinkId: qrLink.id,
      objectId: qrLink.objectId,
      category,
      title,
      description: description || undefined,
      reporterName: reporterName || undefined,
      reporterEmail: reporterEmail || undefined,
      reporterPhone: reporterPhone || undefined,
      photos: validatedPhotos,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
      ipAddress: req.ip || undefined,
      userAgent: req.headers['user-agent'] || undefined,
      status: 'new',
    });

    // Task #714: skriv systemgenererad, kronologisk metadata "Senaste felanmälan"
    // på objektet (samma mönster som report-dynamic). Best-effort.
    try {
      const when = new Date().toISOString().slice(0, 10);
      await writeSystemMetadataOnObject(
        qrLink.objectId,
        "Senaste felanmälan",
        `${title} (${when})`,
        qrLink.tenantId,
        `system:public-issue-report:${report.id}`,
      );
    } catch (e) {
      console.error("[task-714] writeSystemMetadataOnObject (Senaste felanmälan) failed:", e);
    }

    res.status(201).json({
      success: true,
      reportId: report.id,
      message: "Tack för din anmälan! Vi har tagit emot den och kommer att hantera ärendet.",
    });
}));

// ============================================
// PUBLIC FELANMÄLAN — FOTO-UPPLADDNING + AI (Task #714)
// ============================================
// Anonyma anmälare måste kunna ladda upp foton utan inloggning. Vi minter en
// signerad upload-URL gated på en giltig (oförutsägbar) QR-kod, och sätter ACL
// till tenant:<tenantId> (härledd server-side från koden — aldrig från klienten)
// först efter bekräftad uppladdning. Mime + storlek valideras på båda stegen.

// POST /api/public/report/:code/upload-url — signerad foto-upload-URL (kodgated)
app.post("/api/public/report/:code/upload-url", asyncHandler(async (req, res) => {
    const rateCheck = checkPublicReportRateLimit(getClientKeyForRequest(req));
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      throw new RateLimitError("För många uppladdningar från denna enhet. Vänta en stund och försök igen.");
    }
    const qrLink = await storage.getQrCodeLinkByCode(req.params.code);
    if (!qrLink) throw new NotFoundError("Ogiltig QR-kod");
    if (!qrLink.isActive) return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });

    const schema = z.object({
      name: z.string().min(1).max(255),
      size: z.number().int().positive().optional(),
      contentType: z.string().min(1).max(100),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(parsed.data.contentType)) {
      throw new ValidationError("Filtypen tillåts inte. Endast bilder och PDF är tillåtna.");
    }
    if (parsed.data.size !== undefined && parsed.data.size > MAX_FIELD_PHOTO_SIZE_BYTES) {
      res.status(413).json({ error: `Bilden är för stor. Maxgräns är ${MAX_FIELD_PHOTO_SIZE_MB} MB.` });
      return;
    }

    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
}));

// POST /api/public/report/:code/confirm-upload — sätt tenant-ACL efter PUT
app.post("/api/public/report/:code/confirm-upload", asyncHandler(async (req, res) => {
    const qrLink = await storage.getQrCodeLinkByCode(req.params.code);
    if (!qrLink) throw new NotFoundError("Ogiltig QR-kod");
    if (!qrLink.isActive) return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });

    const objectPath = req.body?.objectPath;
    if (!objectPath || typeof objectPath !== "string") {
      throw new ValidationError("objectPath krävs");
    }
    if (!/^\/objects\/[a-zA-Z0-9/_-]+$/.test(objectPath)) {
      throw new ValidationError("Ogiltig objektsökväg");
    }

    const objectStorageService = new ObjectStorageService();
    // ACL härleds från koden (server-side), aldrig från klienten.
    await objectStorageService.validateUploadedFileAndSetAcl(
      objectPath,
      `tenant:${qrLink.tenantId}`,
      "private",
      MAX_FIELD_PHOTO_SIZE_BYTES,
    );
    res.json({ confirmed: true, objectPath });
}));

// POST /api/public/report/:code/suggest-description — AI-förslag på beskrivning
// (kodgated + per-tenant budget/rate-limit). Fail-closed.
app.post("/api/public/report/:code/suggest-description", asyncHandler(async (req, res) => {
    const qrLink = await storage.getQrCodeLinkByCode(req.params.code);
    if (!qrLink) throw new NotFoundError("Ogiltig QR-kod");
    if (!qrLink.isActive) return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });

    const schema = z.object({
      title: z.string().min(3).max(200),
      category: z.string().max(100).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }

    const tenantId = qrLink.tenantId;
    const { enforceBudgetAndRateLimit } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "analysis");
    if (!enforcement.allowed) {
      if (enforcement.errorType === "ratelimit") res.set("Retry-After", String(enforcement.retryAfterSeconds || 60));
      return res.status(429).json({
        error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden",
        message: enforcement.errorMessage,
      });
    }

    const object = await storage.getObject(qrLink.objectId);
    const text = parsed.data.category
      ? `Felanmälan i kategori "${parsed.data.category}": ${parsed.data.title}`
      : parsed.data.title;
    const { parseIssueReportAI } = await import("../services/issue-parser");
    const result = await parseIssueReportAI({
      text,
      objectName: object?.name ?? null,
      objectType: object?.objectType ?? null,
      model: enforcement.model,
      tenantId,
    });
    res.json({ description: (result as any)?.description ?? "" });
}));

// ============================================
// PUBLIC KUNDBETYG / FEEDBACK (Task #714)
// ============================================
// Objekt-bunden, signerad QR-token (objqr:) → tenant + objekt härleds server-side.
// Ingen enumeration (HMAC-signerad). Fail-closed.

const FEEDBACK_QUESTION = "Hur nöjd är du med vår service på denna plats?";
const FEEDBACK_OPTIONS = [
  { id: "mycket_nojd", label: "Mycket nöjd" },
  { id: "nojd", label: "Nöjd" },
  { id: "neutral", label: "Neutral" },
  { id: "missnojd", label: "Missnöjd" },
  { id: "mycket_missnojd", label: "Mycket missnöjd" },
];

// GET /api/public/feedback/:token — formulärdata för kundbetyg
app.get("/api/public/feedback/:token", asyncHandler(async (req, res) => {
    const decoded = verifyObjectQrToken(req.params.token);
    if (!decoded) throw new NotFoundError("Ogiltig kod");
    const object = await storage.getObject(decoded.objectId);
    if (!object || object.tenantId !== decoded.tenantId) throw new NotFoundError("Objekt hittades inte");

    const { tenantBranding } = await import("@shared/schema");
    const [branding] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, decoded.tenantId));

    res.json({
      objectName: object.name,
      objectAddress: object.address,
      companyName: branding?.companyName || "Fältservice",
      primaryColor: branding?.primaryColor || "#3B82F6",
      question: FEEDBACK_QUESTION,
      options: FEEDBACK_OPTIONS,
    });
}));

// POST /api/public/feedback/:token — spara kundbetyg som systemgenererad metadata
app.post("/api/public/feedback/:token", asyncHandler(async (req, res) => {
    const rateCheck = checkPublicReportRateLimit(getClientKeyForRequest(req));
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      throw new RateLimitError("För många omdömen från denna enhet. Vänta en stund och försök igen.");
    }
    const decoded = verifyObjectQrToken(req.params.token);
    if (!decoded) throw new NotFoundError("Ogiltig kod");
    const object = await storage.getObject(decoded.objectId);
    if (!object || object.tenantId !== decoded.tenantId) throw new NotFoundError("Objekt hittades inte");

    const schema = z.object({
      answer: z.enum(FEEDBACK_OPTIONS.map((o) => o.id) as unknown as [string, ...string[]]),
      name: z.string().max(120).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }

    const label = FEEDBACK_OPTIONS.find((o) => o.id === parsed.data.answer)?.label ?? parsed.data.answer;
    const name = parsed.data.name?.trim();
    const when = new Date().toISOString().slice(0, 10);
    const value = name ? `${label} – ${name} (${when})` : `${label} (${when})`;

    await writeSystemMetadataOnObject(
      decoded.objectId,
      "Senaste kundbetyg",
      value,
      decoded.tenantId,
      "system:public-feedback",
    );

    res.status(201).json({ success: true, message: "Tack för ditt omdöme!" });
}));

// ============================================
// PROTOCOLS API
// ============================================

app.get("/api/protocols", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, objectId, protocolType, status } = req.query;
    
    const protocols = await storage.getProtocols(tenantId, {
      workOrderId: workOrderId as string,
      objectId: objectId as string,
      protocolType: protocolType as string,
      status: status as string,
    });
    
    res.json(protocols);
}));

// Get assessment statistics - MUST be before /:id
app.get("/api/protocols/statistics/assessments", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId, startDate, endDate } = req.query;
    
    const allProtocols = await storage.getProtocols(tenantId, {
      protocolType: 'inspection',
      objectId: objectId as string,
    });
    
    let protocols = allProtocols;
    if (startDate) {
      const start = new Date(startDate as string);
      protocols = protocols.filter(p => new Date(p.executedAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate as string);
      protocols = protocols.filter(p => new Date(p.executedAt) <= end);
    }
    
    const { ASSESSMENT_RATING_SCORES, ASSESSMENT_RATING_LABELS } = await import("@shared/schema");
    
    const ratingCounts: Record<string, number> = {};
    let totalScore = 0;
    let ratedCount = 0;
    
    for (const protocol of protocols) {
      if (protocol.assessmentRating) {
        ratingCounts[protocol.assessmentRating] = (ratingCounts[protocol.assessmentRating] || 0) + 1;
        const score = ASSESSMENT_RATING_SCORES[protocol.assessmentRating as keyof typeof ASSESSMENT_RATING_SCORES];
        if (score !== undefined) {
          totalScore += score;
          ratedCount++;
        }
      }
    }
    
    const averageScore = ratedCount > 0 ? totalScore / ratedCount : null;
    
    const distribution = Object.entries(ratingCounts).map(([rating, count]) => ({
      rating,
      label: ASSESSMENT_RATING_LABELS[rating as keyof typeof ASSESSMENT_RATING_LABELS] || rating,
      count,
      percentage: protocols.length > 0 ? Math.round((count / protocols.length) * 100) : 0,
    }));
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const recentProtocols = allProtocols.filter(p => new Date(p.executedAt) >= sixMonthsAgo);
    const monthlyData: Record<string, { count: number; totalScore: number }> = {};
    
    for (const protocol of recentProtocols) {
      const monthKey = new Date(protocol.executedAt).toISOString().substring(0, 7);
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { count: 0, totalScore: 0 };
      }
      monthlyData[monthKey].count++;
      if (protocol.assessmentRating) {
        const score = ASSESSMENT_RATING_SCORES[protocol.assessmentRating as keyof typeof ASSESSMENT_RATING_SCORES];
        if (score !== undefined) {
          monthlyData[monthKey].totalScore += score;
        }
      }
    }
    
    const trend = Object.entries(monthlyData)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, data]) => ({
        month,
        inspections: data.count,
        averageScore: data.count > 0 ? Math.round((data.totalScore / data.count) * 10) / 10 : null,
      }));
    
    res.json({
      totalInspections: protocols.length,
      averageScore: averageScore !== null ? Math.round(averageScore * 10) / 10 : null,
      distribution,
      trend,
    });
}));

app.get("/api/protocols/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const protocol = await storage.getProtocol(req.params.id);
    
    if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
      throw new NotFoundError("Protokoll hittades inte");
    }
    
    res.json(protocol);
}));

app.post("/api/protocols", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const { insertProtocolSchema } = await import("@shared/schema");
    const validated = insertProtocolSchema.parse({ ...req.body, tenantId });
    
    const protocol = await storage.createProtocol(validated);
    res.status(201).json(protocol);
}));

app.patch("/api/protocols/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getProtocol(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Protokoll hittades inte");
    }
    
    const protocol = await storage.updateProtocol(req.params.id, tenantId, req.body);
    res.json(protocol);
}));

app.delete("/api/protocols/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getProtocol(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Protokoll hittades inte");
    }
    
    await storage.deleteProtocol(req.params.id, tenantId);
    res.status(204).send();
}));

// Generate PDF for protocol
app.post("/api/protocols/:id/generate-pdf", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const protocol = await storage.getProtocol(req.params.id);
    if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
      throw new NotFoundError("Protokoll hittades inte");
    }
    
    const { generateProtocolPdf } = await import('../protocol-pdf-generator');
    
    // Fetch related data
    const workOrder = await storage.getWorkOrder(protocol.workOrderId);
    const object = protocol.objectId ? await storage.getObject(protocol.objectId) : null;
    const customer = workOrder?.customerId ? await storage.getCustomer(workOrder.customerId) : null;
    const tenant = await storage.getTenant(tenantId);
    
    const pdfBuffer = await generateProtocolPdf(protocol, {
      workOrder,
      object,
      customer,
      tenant,
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="protokoll-${protocol.protocolNumber || protocol.id}.pdf"`);
    res.send(pdfBuffer);
}));

// Send protocol to customer via email
app.post("/api/protocols/:id/send-to-customer", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const protocol = await storage.getProtocol(req.params.id);
    if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
      throw new NotFoundError("Protokoll hittades inte");
    }
    
    const { sendProtocolToCustomer } = await import('../protocol-email-service');
    
    const workOrder = await storage.getWorkOrder(protocol.workOrderId);
    const object = protocol.objectId ? await storage.getObject(protocol.objectId) : null;
    const customer = workOrder?.customerId ? await storage.getCustomer(workOrder.customerId) : null;
    const tenant = await storage.getTenant(tenantId);
    
    if (!customer?.email) {
      throw new ValidationError("Kunden har ingen e-postadress");
    }
    
    const result = await sendProtocolToCustomer(protocol, {
      workOrder,
      object,
      customer,
      tenant,
    });
    
    // Update protocol status
    await storage.updateProtocol(protocol.id, tenantId, {
      sentToCustomer: true,
      sentAt: new Date(),
      status: 'sent',
    });
    
    res.json({ success: true, message: "Protokoll skickat till kund" });
}));

// ============================================
// DEVIATION REPORTS API
// ============================================

app.get("/api/deviation-reports", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId, status, category, severity } = req.query;
    
    const reports = await storage.getDeviationReports(tenantId, {
      objectId: objectId as string,
      status: status as string,
      category: category as string,
      severity: severity as string,
    });
    
    res.json(reports);
}));

app.get("/api/deviation-reports/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const report = await storage.getDeviationReport(req.params.id);
    
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      throw new NotFoundError("Avvikelserapport hittades inte");
    }
    
    res.json(report);
}));

app.post("/api/deviation-reports", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const { insertDeviationReportSchema } = await import("@shared/schema");
    const validated = insertDeviationReportSchema.parse({ ...req.body, tenantId });
    
    const report = await storage.createDeviationReport(validated);
    res.status(201).json(report);
}));

app.patch("/api/deviation-reports/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getDeviationReport(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Avvikelserapport hittades inte");
    }
    
    const report = await storage.updateDeviationReport(req.params.id, tenantId, req.body);
    res.json(report);
}));

// Create work order from deviation report
app.post("/api/deviation-reports/:id/create-order", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const report = await storage.getDeviationReport(req.params.id);
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      throw new NotFoundError("Avvikelserapport hittades inte");
    }
    
    // Get object and customer info
    const object = await storage.getObject(report.objectId);
    if (!object) {
      throw new ValidationError("Objekt hittades inte");
    }
    
    // Create new work order for fixing the deviation
    const { DEVIATION_CATEGORY_LABELS, SEVERITY_LEVEL_LABELS } = await import("@shared/schema");
    
    const categoryLabel = DEVIATION_CATEGORY_LABELS[report.category as keyof typeof DEVIATION_CATEGORY_LABELS] || report.category;
    const severityLabel = SEVERITY_LEVEL_LABELS[report.severityLevel as keyof typeof SEVERITY_LEVEL_LABELS] || report.severityLevel;
    
    const workOrder = await storage.createWorkOrder({
      tenantId,
      objectId: report.objectId,
      customerId: object.customerId || '',
      orderType: 'manual',
      status: 'planned',
      description: `Åtgärd: ${categoryLabel} - ${report.title}\n\nBeskrivning: ${report.description || ''}\n\nAllvarlighetsgrad: ${severityLabel}\n\nFöreslagen åtgärd: ${report.suggestedAction || 'Ej angiven'}`,
      creationMethod: 'deviation_report',
      latitude: report.latitude ? String(report.latitude) : undefined,
      longitude: report.longitude ? String(report.longitude) : undefined,
    });
    
    // Update deviation report with linked order
    await storage.updateDeviationReport(report.id, tenantId, {
      linkedActionOrderId: workOrder.id,
      status: 'in_progress',
    });
    
    res.status(201).json({
      workOrder,
      message: "Arbetsorder skapad för åtgärd av avvikelse",
    });
}));

// Resolve deviation report
app.post("/api/deviation-reports/:id/resolve", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = (req as any).user;
    const { resolutionNotes } = req.body;
    
    const report = await storage.getDeviationReport(req.params.id);
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      throw new NotFoundError("Avvikelserapport hittades inte");
    }
    
    const updated = await storage.updateDeviationReport(report.id, tenantId, {
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy: user?.id,
      resolutionNotes,
    });
    
    res.json(updated);
}));

app.get("/api/objects/:id/issue-history", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectId = req.params.id;
    
    const obj = await storage.getObject(objectId);
    if (!obj || !verifyTenantOwnership(obj, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }
    
    const deviations = await storage.getDeviationReports(tenantId, { objectId });
    const protocols = await storage.getProtocols(tenantId, { objectId, protocolType: 'inspection' });
    const publicReports = await storage.getPublicIssueReports(tenantId, { objectId });
    
    const timeline: any[] = [];
    
    for (const dev of deviations) {
      timeline.push({
        type: 'deviation',
        date: dev.reportedAt,
        category: dev.category,
        title: dev.title,
        status: dev.status,
        severity: dev.severity,
        id: dev.id,
      });
    }
    
    for (const protocol of protocols) {
      if (protocol.assessmentRating) {
        timeline.push({
          type: 'inspection',
          date: protocol.executedAt,
          rating: protocol.assessmentRating,
          notes: protocol.assessmentNotes,
          id: protocol.id,
        });
      }
    }
    
    for (const report of publicReports) {
      timeline.push({
        type: 'public_report',
        date: report.createdAt,
        category: report.category,
        title: report.title,
        status: report.status,
        id: report.id,
      });
    }
    
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    const byCategory: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    
    for (const item of timeline) {
      if (item.type === 'deviation' || item.type === 'public_report') {
        byCategory[item.category] = (byCategory[item.category] || 0) + 1;
        const month = new Date(item.date).toISOString().substring(0, 7);
        byMonth[month] = (byMonth[month] || 0) + 1;
      }
    }
    
    res.json({
      object: obj,
      totalEvents: timeline.length,
      categoryBreakdown: byCategory,
      monthlyTrend: Object.entries(byMonth)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, count]) => ({ month, count })),
      timeline: timeline.slice(0, 50),
    });
}));

// ============================================
// ENHETLIGT ÄRENDE-LAGER (Task #648)
// ============================================
// Aggregerar de tre rapport-tabellerna (deviation_reports, customer_issue_reports,
// public_issue_reports) till ETT ärende-lager för planeraren. Tabellerna förblir
// separata — detta är en vy/abstraktion, inte en schema-migrering.
//
// Gemensam status-livscykel (ADR-vision): inkommen → mottagen → under_behandling
// → avslutad → arkiverad. Varje källtabell mappas in i denna modell.

type CaseSource = "deviation" | "customer" | "public";

const UNIFIED_STATUS = ["inkommen", "mottagen", "under_behandling", "avslutad", "arkiverad"] as const;
type UnifiedStatus = typeof UNIFIED_STATUS[number];

// Mappa per-tabell-status → enhetlig status
function toUnifiedStatus(source: CaseSource, raw: string | null | undefined): UnifiedStatus {
  const s = (raw || "").toLowerCase();
  if (source === "deviation") {
    // reported, acknowledged, in_progress, resolved, cancelled
    if (s === "acknowledged") return "mottagen";
    if (s === "in_progress") return "under_behandling";
    if (s === "resolved") return "avslutad";
    if (s === "cancelled") return "arkiverad";
    return "inkommen";
  }
  if (source === "customer") {
    // open, in_progress, resolved, closed
    if (s === "in_progress") return "under_behandling";
    if (s === "resolved") return "avslutad";
    if (s === "closed") return "arkiverad";
    return "inkommen";
  }
  // public: new, reviewed, converted, rejected (ingen "resolved"-status finns)
  if (s === "reviewed") return "mottagen";
  if (s === "converted") return "under_behandling";
  if (s === "rejected") return "arkiverad";
  return "inkommen";
}

// Mappa enhetlig status → per-tabell-status (för PATCH)
function fromUnifiedStatus(source: CaseSource, unified: UnifiedStatus): string {
  if (source === "deviation") {
    return { inkommen: "reported", mottagen: "acknowledged", under_behandling: "in_progress", avslutad: "resolved", arkiverad: "cancelled" }[unified];
  }
  if (source === "customer") {
    return { inkommen: "open", mottagen: "open", under_behandling: "in_progress", avslutad: "resolved", arkiverad: "closed" }[unified];
  }
  // public saknar "resolved"; avslutad mappas till "converted" (åtgärdad/omvandlad)
  return { inkommen: "new", mottagen: "reviewed", under_behandling: "converted", avslutad: "converted", arkiverad: "rejected" }[unified];
}

// GET /api/cases — enhetlig lista över alla ärenden
app.get("/api/cases", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { status, objectId, source } = req.query as { status?: string; objectId?: string; source?: string };

    const [deviations, publicReports, objects] = await Promise.all([
      storage.getDeviationReports(tenantId, { objectId: objectId as string | undefined }),
      storage.getPublicIssueReports(tenantId, { objectId: objectId as string | undefined }),
      storage.getObjects(tenantId),
    ]);

    // customer_issue_reports hämtas per kund — iterera kunder
    const customers = await storage.getCustomers(tenantId);
    const customerReportsNested = await Promise.all(
      customers.map((c) => storage.getCustomerIssueReports(tenantId, c.id))
    );
    const customerReports = customerReportsNested.flat();

    const objectMap = new Map(objects.map((o) => [o.id, o]));

    type UnifiedCase = {
      caseId: string;
      source: CaseSource;
      sourceId: string;
      objectId: string | null;
      objectName: string | null;
      objectAddress: string | null;
      title: string;
      description: string | null;
      category: string | null;
      priority: string | null;
      severityLevel: string | null;
      status: UnifiedStatus;
      rawStatus: string | null;
      reporter: string | null;
      latitude: number | null;
      longitude: number | null;
      photos: string[] | null;
      linkedWorkOrderId: string | null;
      createdAt: Date | string | null;
    };

    const cases: UnifiedCase[] = [];

    for (const d of deviations) {
      const obj = d.objectId ? objectMap.get(d.objectId) : undefined;
      cases.push({
        caseId: `deviation:${d.id}`,
        source: "deviation",
        sourceId: d.id,
        objectId: d.objectId,
        objectName: obj?.name ?? null,
        objectAddress: obj?.address ?? null,
        title: d.title,
        description: d.description ?? null,
        category: d.category,
        priority: null,
        severityLevel: d.severityLevel,
        status: toUnifiedStatus("deviation", d.status),
        rawStatus: d.status,
        reporter: d.reportedByName ?? null,
        latitude: d.latitude ?? null,
        longitude: d.longitude ?? null,
        photos: d.photos ?? null,
        linkedWorkOrderId: d.linkedActionOrderId ?? null,
        createdAt: d.reportedAt ?? d.createdAt,
      });
    }

    for (const p of publicReports) {
      const obj = p.objectId ? objectMap.get(p.objectId) : undefined;
      cases.push({
        caseId: `public:${p.id}`,
        source: "public",
        sourceId: p.id,
        objectId: p.objectId,
        objectName: obj?.name ?? null,
        objectAddress: obj?.address ?? null,
        title: p.title,
        description: p.description ?? null,
        category: p.category,
        priority: null,
        severityLevel: null,
        status: toUnifiedStatus("public", p.status),
        rawStatus: p.status,
        reporter: p.reporterName ?? null,
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        photos: p.photos ?? null,
        linkedWorkOrderId: p.linkedWorkOrderId ?? null,
        createdAt: p.createdAt,
      });
    }

    for (const c of customerReports) {
      const obj = c.objectId ? objectMap.get(c.objectId) : undefined;
      cases.push({
        caseId: `customer:${c.id}`,
        source: "customer",
        sourceId: c.id,
        objectId: c.objectId,
        objectName: obj?.name ?? null,
        objectAddress: obj?.address ?? null,
        title: c.title,
        description: c.description ?? null,
        category: c.issueType,
        priority: c.priority,
        severityLevel: null,
        status: toUnifiedStatus("customer", c.status),
        rawStatus: c.status,
        reporter: c.customerContact ?? null,
        latitude: null,
        longitude: null,
        photos: c.imageUrls ?? null,
        linkedWorkOrderId: c.linkedWorkOrderId ?? null,
        createdAt: c.createdAt,
      });
    }

    let filtered = cases;
    if (source && ["deviation", "customer", "public"].includes(source)) {
      filtered = filtered.filter((c) => c.source === source);
    }
    if (status && (UNIFIED_STATUS as readonly string[]).includes(status)) {
      filtered = filtered.filter((c) => c.status === status);
    }

    filtered.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    res.json(filtered);
}));

// Hjälpare: hämta ett ärende från valfri källa + verifiera tenant
async function loadCase(source: CaseSource, id: string, tenantId: string) {
  if (source === "deviation") {
    const d = await storage.getDeviationReport(id);
    return d && verifyTenantOwnership(d, tenantId) ? d : undefined;
  }
  if (source === "public") {
    const p = await storage.getPublicIssueReport(id);
    return p && verifyTenantOwnership(p, tenantId) ? p : undefined;
  }
  // customer
  const customers = await storage.getCustomers(tenantId);
  for (const c of customers) {
    const reports = await storage.getCustomerIssueReports(tenantId, c.id);
    const found = reports.find((r) => r.id === id);
    if (found) return found;
  }
  return undefined;
}

// GET /api/cases/dynamic-qr-token — signerad token för objektoberoende QR (planerare)
app.get("/api/cases/dynamic-qr-token", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = (req as any).tenantId as string;
    if (!tenantId) throw new UnauthorizedError("Ingen tenant");
    res.json({ token: signDynamicQrToken(tenantId) });
}));

// PATCH /api/cases/:source/:id/status — uppdatera enhetlig status
app.patch("/api/cases/:source/:id/status", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const source = req.params.source as CaseSource;
    if (!["deviation", "customer", "public"].includes(source)) {
      throw new ValidationError("Ogiltig ärendekälla");
    }
    const { status } = req.body as { status?: string };
    if (!status || !(UNIFIED_STATUS as readonly string[]).includes(status)) {
      throw new ValidationError(`Ogiltig status. Tillåtna: ${UNIFIED_STATUS.join(", ")}`);
    }

    const existing = await loadCase(source, req.params.id, tenantId);
    if (!existing) {
      throw new NotFoundError("Ärende hittades inte");
    }

    const rawStatus = fromUnifiedStatus(source, status as UnifiedStatus);
    if (source === "deviation") {
      await storage.updateDeviationReport(req.params.id, tenantId, { status: rawStatus });
    } else if (source === "public") {
      await storage.updatePublicIssueReport(req.params.id, tenantId, { status: rawStatus });
    } else {
      await storage.updateCustomerIssueReport(req.params.id, tenantId, { status: rawStatus });
    }

    res.json({ success: true, source, id: req.params.id, status, rawStatus });
}));

// POST /api/cases/:source/:id/create-order — skapa arbetsorder (uppgift) från ärende
// Bygger på samma princip som /api/deviation-reports/:id/create-order: en uppgift
// skapas direkt och länkas tillbaka till ärendet. Kund härleds via object_payers
// (primär), annars body.customerId.
app.post("/api/cases/:source/:id/create-order", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const source = req.params.source as CaseSource;
    if (!["deviation", "customer", "public"].includes(source)) {
      throw new ValidationError("Ogiltig ärendekälla");
    }

    const existing = await loadCase(source, req.params.id, tenantId) as any;
    if (!existing) {
      throw new NotFoundError("Ärende hittades inte");
    }

    // Förhindra dubbel-konvertering: ett ärende får bara ge upphov till en order.
    const alreadyLinked = source === "deviation" ? existing.linkedActionOrderId : existing.linkedWorkOrderId;
    if (alreadyLinked) {
      throw new ValidationError("Ärendet har redan en kopplad order");
    }

    const objectId: string | null = existing.objectId ?? null;
    if (!objectId) {
      throw new ValidationError("Ärendet saknar kopplat objekt — koppla ett objekt innan order skapas");
    }
    const object = await storage.getObject(objectId);
    if (!object || !verifyTenantOwnership(object, tenantId)) {
      throw new ValidationError("Kopplat objekt hittades inte");
    }

    // Härled kund: body → object_payers (primär) → legacy objects.customerId
    let customerId: string | null = req.body?.customerId ?? null;
    if (!customerId) {
      const payers = await storage.getObjectPayers(objectId);
      const primary = payers.find((p) => p.isPrimary) || payers[0];
      customerId = primary?.customerId ?? object.customerId ?? null;
    }
    if (!customerId) {
      throw new ValidationError("Kunde inte härleda kund för objektet. Ange customerId.");
    }

    const { DEVIATION_CATEGORY_LABELS } = await import("@shared/schema");
    const catLabel = (DEVIATION_CATEGORY_LABELS as Record<string, string>)[existing.category] || existing.category || "Ärende";
    const userId = (req.user as any)?.claims?.sub ?? (req.session as any)?.userId ?? null;

    const title = existing.title || catLabel;
    const description = [
      `Åtgärd från ärende (${source}): ${existing.title || ""}`,
      existing.description ? `\nBeskrivning: ${existing.description}` : "",
      existing.suggestedAction ? `\nFöreslagen åtgärd: ${existing.suggestedAction}` : "",
    ].join("");
    const priority = existing.priority || (existing.severityLevel === "critical" || existing.severityLevel === "high" ? "high" : "normal");

    // Ärende → Orderkoncept → Uppgift: skapa ett ad-hoc (avrop) orderkoncept och
    // expandera det till EN uppgift via samma assignment-väg som ordinarie
    // konceptkörning (createAssignment med orderConceptId). Vi går ALDRIG förbi
    // konceptlagret med en lös work_order — uppgiften bär orderConceptId så att
    // lineage/fakturering/rapportering följer det vanliga flödet.
    const concept = await storage.createOrderConcept({
      tenantId,
      name: title,
      description,
      customerId,
      scenario: "avrop",
      scheduleType: "once",
      priority,
    } as any);

    const assignment = await storage.createAssignment({
      tenantId,
      orderConceptId: concept.id,
      objectId,
      clusterId: object.clusterId || undefined,
      title,
      description,
      status: "not_planned",
      priority,
      address: object.address || undefined,
      latitude: existing.latitude ?? object.latitude ?? undefined,
      longitude: existing.longitude ?? object.longitude ?? undefined,
      creationMethod: "case_create_order",
      createdBy: userId,
    } as any);

    // Länka tillbaka + flytta ärendet framåt
    if (source === "deviation") {
      await storage.updateDeviationReport(existing.id, tenantId, { linkedActionOrderId: assignment.id, status: "in_progress" });
    } else if (source === "public") {
      await storage.updatePublicIssueReport(existing.id, tenantId, { linkedWorkOrderId: assignment.id, status: "converted" });
    } else {
      await storage.updateCustomerIssueReport(existing.id, tenantId, { linkedWorkOrderId: assignment.id, status: "in_progress" });
    }

    res.status(201).json({ orderConcept: concept, assignment, message: "Order skapad från ärende via orderkoncept" });
}));

// ============================================
// DYNAMISK GPS-QR (Task #648)
// ============================================
// Befintlig objekt-specifik QR (/api/public/report/:code) lämnas oförändrad.
// Här tillkommer ett tenant-scopat, objekt-oberoende flöde: användaren scannar
// EN generell QR → GPS-position → systemet listar närliggande objekt → välj →
// felanmälan skapas mot valt objekt. Ingen schema-migrering (objektoberoende QR
// kräver ingen qr_code_links-rad eftersom objektet väljs i efterhand).

// GET /api/public/nearby-objects?t=:token&lat=&lng=&radius= (meter)
app.get("/api/public/nearby-objects", asyncHandler(async (req, res) => {
    const tenantId = verifyDynamicQrToken(req.query.t as string);
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusMeters = Math.min(Math.max(parseInt((req.query.radius as string) || "150", 10) || 150, 10), 2000);

    if (!tenantId) throw new NotFoundError("Ogiltig kod");
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new ValidationError("Giltig position (lat/lng) krävs");
    }

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) throw new NotFoundError("Ogiltig kod");

    const { haversineDistanceKm } = await import("../distance-matrix-service");
    const objects = await storage.getObjects(tenantId);

    const nearby = objects
      .filter((o) => typeof o.latitude === "number" && typeof o.longitude === "number")
      .map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        objectType: o.objectType,
        distanceMeters: Math.round(haversineDistanceKm(lat, lng, o.latitude as number, o.longitude as number) * 1000),
      }))
      .filter((o) => o.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 25);

    res.json({ tenantId, radiusMeters, objects: nearby });
}));

// GET /api/public/dynamic-info?t=:token — branding + kategorier för dynamisk QR
app.get("/api/public/dynamic-info", asyncHandler(async (req, res) => {
    const tenantId = verifyDynamicQrToken(req.query.t as string);
    if (!tenantId) throw new NotFoundError("Ogiltig kod");
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) throw new NotFoundError("Ogiltig kod");

    const { tenantBranding, DEVIATION_CATEGORIES, DEVIATION_CATEGORY_LABELS } = await import("@shared/schema");
    const [branding] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId));

    res.json({
      tenantId,
      companyName: branding?.companyName || "Fältservice",
      primaryColor: branding?.primaryColor || "#3B82F6",
      categories: (DEVIATION_CATEGORIES as readonly string[]).map((id) => ({
        id,
        label: (DEVIATION_CATEGORY_LABELS as Record<string, string>)[id] || id,
      })),
    });
}));

// POST /api/public/parse-issue-report — token-gated AI-tolkning för publik felanmälan
// Samma fritext→strukturerat som /api/ai/parse-issue-report men gated på giltig
// dynamisk QR-token (ej öppen) + per-tenant budget/rate-limit (DoS-skydd).
app.post("/api/public/parse-issue-report", asyncHandler(async (req, res) => {
    const schema = z.object({
      t: z.string().min(1),
      text: z.string().min(3).max(2000),
      objectName: z.string().max(200).optional().nullable(),
      objectType: z.string().max(200).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const tenantId = verifyDynamicQrToken(parsed.data.t);
    if (!tenantId) throw new NotFoundError("Ogiltig kod");

    const { enforceBudgetAndRateLimit } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "analysis");
    if (!enforcement.allowed) {
      if (enforcement.errorType === "ratelimit") res.set("Retry-After", String(enforcement.retryAfterSeconds || 60));
      return res.status(429).json({
        error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden",
        message: enforcement.errorMessage,
      });
    }

    const { parseIssueReportAI } = await import("../services/issue-parser");
    const result = await parseIssueReportAI({
      text: parsed.data.text,
      objectName: parsed.data.objectName,
      objectType: parsed.data.objectType,
      model: enforcement.model,
      tenantId,
    });
    res.json(result);
}));

// POST /api/public/report-dynamic — felanmälan mot valt objekt (objektoberoende QR)
app.post("/api/public/report-dynamic", asyncHandler(async (req, res) => {
    const rateCheck = checkPublicReportRateLimit(getClientKeyForRequest(req));
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      throw new RateLimitError(
        "För många felanmälningar från denna enhet. Vänta en stund och försök igen.",
      );
    }

    const { DEVIATION_CATEGORIES } = await import("@shared/schema");
    const dynamicReportSchema = z.object({
      t: z.string().min(1),
      objectId: z.string().min(1),
      category: z.enum(DEVIATION_CATEGORIES as unknown as [string, ...string[]]),
      title: z.string().min(1).max(200),
      description: z.string().max(4000).optional().nullable(),
      reporterName: z.string().max(200).optional().nullable(),
      reporterEmail: z.string().max(200).optional().nullable(),
      reporterPhone: z.string().max(50).optional().nullable(),
      photos: z.array(z.string().max(2048)).max(10).optional(),
      latitude: z.number().min(-90).max(90).optional().nullable(),
      longitude: z.number().min(-180).max(180).optional().nullable(),
    });
    const parsed = dynamicReportSchema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const { t, objectId, category, title, description, reporterName, reporterEmail, reporterPhone, photos, latitude, longitude } = parsed.data;

    const tenantId = verifyDynamicQrToken(t);
    if (!tenantId) throw new NotFoundError("Ogiltig kod");

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) throw new NotFoundError("Ogiltig kod");

    const object = await storage.getObject(objectId);
    if (!object || object.tenantId !== tenantId) {
      throw new NotFoundError("Objekt hittades inte");
    }

    const report = await storage.createPublicIssueReport({
      tenantId,
      objectId,
      category,
      title,
      description: description || undefined,
      reporterName: reporterName || undefined,
      reporterEmail: reporterEmail || undefined,
      reporterPhone: reporterPhone || undefined,
      photos: photos || undefined,
      latitude: latitude ?? undefined,
      longitude: longitude ?? undefined,
      ipAddress: req.ip || undefined,
      userAgent: req.headers["user-agent"] || undefined,
      status: "new",
    });

    // Task #682: skriv systemgenererad, read-only metadata på objektet — "senaste
    // felanmälan". Best-effort; ett fel får aldrig stoppa kvittensen till anmälaren.
    try {
      const when = new Date().toISOString().slice(0, 10);
      await writeSystemMetadataOnObject(
        objectId,
        "Senaste felanmälan",
        `${title} (${when})`,
        tenantId,
        `system:public-issue-report:${report.id}`,
      );
    } catch (e) {
      console.error("[task-682] writeSystemMetadataOnObject (Senaste felanmälan) failed:", e);
    }

    res.status(201).json({
      success: true,
      reportId: report.id,
      message: "Tack för din anmälan! Vi har tagit emot den och kommer att hantera ärendet.",
    });
}));

// ============================================
// ENVIRONMENTAL DATA - Fas 3.1
// ============================================

app.get("/api/environmental-data", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, resourceId, startDate, endDate } = req.query;
    
    const data = await storage.getEnvironmentalData(tenantId, {
      workOrderId: workOrderId as string,
      resourceId: resourceId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    
    res.json(data);
}));

app.post("/api/environmental-data", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = (req as any).user;
    
    const { CO2_EMISSION_FACTORS } = await import("@shared/schema");
    
    let co2Kg = req.body.co2Kg;
    if (req.body.co2CalculationMethod !== 'manual' && req.body.fuelLiters && req.body.fuelType) {
      const factor = CO2_EMISSION_FACTORS[req.body.fuelType] || 0;
      co2Kg = req.body.fuelLiters * factor;
    } else if (req.body.co2CalculationMethod !== 'manual' && req.body.distanceKm && !co2Kg) {
      co2Kg = req.body.distanceKm * 0.25;
    }
    
    const data = await storage.createEnvironmentalData({
      ...req.body,
      tenantId,
      co2Kg,
      createdBy: user?.id,
    });
    
    res.json(data);
}));

app.get("/api/environmental-data/statistics", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate, resourceId } = req.query;
    
    const data = await storage.getEnvironmentalData(tenantId, {
      resourceId: resourceId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    
    let totalDistanceKm = 0;
    let totalFuelLiters = 0;
    let totalCo2Kg = 0;
    let totalWasteKg = 0;
    const chemicalsAggregated: Record<string, { quantity: number; unit: string }> = {};
    const fuelByType: Record<string, number> = {};
    const monthlyData: Record<string, { distanceKm: number; co2Kg: number; wasteKg: number }> = {};
    
    for (const record of data) {
      if (record.distanceKm) totalDistanceKm += record.distanceKm;
      if (record.fuelLiters) {
        totalFuelLiters += record.fuelLiters;
        if (record.fuelType) {
          fuelByType[record.fuelType] = (fuelByType[record.fuelType] || 0) + record.fuelLiters;
        }
      }
      if (record.co2Kg) totalCo2Kg += record.co2Kg;
      if (record.wasteCollectedKg) totalWasteKg += record.wasteCollectedKg;
      
      if (record.chemicalsUsed && Array.isArray(record.chemicalsUsed)) {
        for (const chem of record.chemicalsUsed as any[]) {
          if (!chemicalsAggregated[chem.name]) {
            chemicalsAggregated[chem.name] = { quantity: 0, unit: chem.unit || 'liters' };
          }
          chemicalsAggregated[chem.name].quantity += chem.quantity || 0;
        }
      }
      
      const monthKey = new Date(record.recordedAt).toISOString().substring(0, 7);
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { distanceKm: 0, co2Kg: 0, wasteKg: 0 };
      }
      monthlyData[monthKey].distanceKm += record.distanceKm || 0;
      monthlyData[monthKey].co2Kg += record.co2Kg || 0;
      monthlyData[monthKey].wasteKg += record.wasteCollectedKg || 0;
    }
    
    const trend = Object.entries(monthlyData)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, stats]) => ({
        month,
        distanceKm: Math.round(stats.distanceKm),
        co2Kg: Math.round(stats.co2Kg * 10) / 10,
        wasteKg: Math.round(stats.wasteKg),
      }));
    
    const chemicals = Object.entries(chemicalsAggregated).map(([name, data]) => ({
      name,
      quantity: Math.round(data.quantity * 100) / 100,
      unit: data.unit,
    }));
    
    res.json({
      totalRecords: data.length,
      totalDistanceKm: Math.round(totalDistanceKm),
      totalFuelLiters: Math.round(totalFuelLiters * 10) / 10,
      totalCo2Kg: Math.round(totalCo2Kg * 10) / 10,
      totalWasteKg: Math.round(totalWasteKg),
      fuelByType,
      chemicals,
      trend,
      co2PerKm: totalDistanceKm > 0 ? Math.round((totalCo2Kg / totalDistanceKm) * 1000) / 1000 : null,
    });
}));

// Environmental Certificate - annual sustainability report per customer
app.get("/api/environmental-certificates/:customerId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;
    const { year } = req.query;
    
    const targetYear = year ? parseInt(year as string) : new Date().getFullYear() - 1;
    const startDate = new Date(`${targetYear}-01-01`);
    const endDate = new Date(`${targetYear}-12-31T23:59:59`);
    
    // Get customer info
    const customers = await storage.getCustomers(tenantId);
    const customer = customers.find(c => c.id === customerId);
    if (!customer) {
      throw new NotFoundError("Kund hittades inte");
    }
    
    // Get work orders for this customer
    const allWorkOrders = await storage.getWorkOrders(tenantId);
    const customerObjects = await storage.getObjects(tenantId);
    const customerObjectIds = new Set(
      customerObjects.filter(o => o.customerId === customerId).map(o => o.id)
    );
    const customerWorkOrders = allWorkOrders.filter(
      wo => wo.customerId === customerId || (wo.objectId && customerObjectIds.has(wo.objectId))
    );
    const workOrderIds = new Set(customerWorkOrders.map(wo => wo.id));
    
    // Get environmental data for this customer's work orders
    const allEnvData = await storage.getEnvironmentalData(tenantId, {
      startDate,
      endDate,
    });
    
    const envData = allEnvData.filter(d => d.workOrderId && workOrderIds.has(d.workOrderId));
    
    // Aggregate statistics
    let totalDistanceKm = 0;
    let totalFuelLiters = 0;
    let totalCo2Kg = 0;
    let totalWasteKg = 0;
    const chemicalsAggregated: Record<string, { quantity: number; unit: string }> = {};
    const fuelByType: Record<string, number> = {};
    
    for (const record of envData) {
      if (record.distanceKm) totalDistanceKm += record.distanceKm;
      if (record.fuelLiters) {
        totalFuelLiters += record.fuelLiters;
        if (record.fuelType) {
          fuelByType[record.fuelType] = (fuelByType[record.fuelType] || 0) + record.fuelLiters;
        }
      }
      if (record.co2Kg) totalCo2Kg += record.co2Kg;
      if (record.wasteCollectedKg) totalWasteKg += record.wasteCollectedKg;
      
      if (record.chemicalsUsed && Array.isArray(record.chemicalsUsed)) {
        for (const chem of record.chemicalsUsed as any[]) {
          if (!chemicalsAggregated[chem.name]) {
            chemicalsAggregated[chem.name] = { quantity: 0, unit: chem.unit || 'liters' };
          }
          chemicalsAggregated[chem.name].quantity += chem.quantity || 0;
        }
      }
    }
    
    const chemicals = Object.entries(chemicalsAggregated).map(([name, data]) => ({
      name,
      quantity: Math.round(data.quantity * 100) / 100,
      unit: data.unit,
    }));
    
    // Calculate sustainability metrics
    const co2PerKm = totalDistanceKm > 0 ? totalCo2Kg / totalDistanceKm : 0;
    const co2Savings = totalWasteKg * 0.5; // Estimated CO2 saved per kg waste collected (simplified)
    const netCo2Impact = totalCo2Kg - co2Savings;
    
    // Count completed work orders
    const completedOrders = customerWorkOrders.filter(
      wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad"
    ).length;
    
    res.json({
      customerId,
      customerName: customer.name,
      customerOrgNumber: customer.orgNumber,
      year: targetYear,
      generatedAt: new Date().toISOString(),
      statistics: {
        totalWorkOrders: customerWorkOrders.length,
        completedWorkOrders: completedOrders,
        totalDistanceKm: Math.round(totalDistanceKm),
        totalFuelLiters: Math.round(totalFuelLiters * 10) / 10,
        totalCo2Kg: Math.round(totalCo2Kg * 10) / 10,
        totalWasteCollectedKg: Math.round(totalWasteKg),
        co2PerKm: Math.round(co2PerKm * 1000) / 1000,
        estimatedCo2SavingsKg: Math.round(co2Savings * 10) / 10,
        netCo2ImpactKg: Math.round(netCo2Impact * 10) / 10,
        fuelByType,
        chemicals,
      },
      sustainabilityRating: netCo2Impact <= 0 ? "Klimatpositiv" : 
        co2PerKm < 0.15 ? "Utmärkt" : 
        co2PerKm < 0.25 ? "Bra" : 
        co2PerKm < 0.35 ? "Medel" : "Behöver förbättras",
    });
}));

app.get("/api/system/api-costs/summary", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const period = (req.query.period as string) || "month";
    let startDate: Date;
    const endDate = new Date();
    
    switch (period) {
      case "day": startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); break;
      case "week": startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case "year": startDate = new Date(endDate.getFullYear(), 0, 1); break;
      default: startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    }
    
    if (req.query.startDate) startDate = new Date(req.query.startDate as string);
    if (req.query.endDate) endDate.setTime(new Date(req.query.endDate as string).getTime());

    const results = await db
      .select({
        service: apiUsageLogs.service,
        totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
        totalCalls: sql<number>`COUNT(*)`,
        totalInputTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.outputTokens}), 0)`,
        avgDurationMs: sql<number>`COALESCE(AVG(${apiUsageLogs.durationMs}), 0)`,
        errorCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.statusCode} >= 400 THEN 1 ELSE 0 END)`,
      })
      .from(apiUsageLogs)
      .where(and(gte(apiUsageLogs.createdAt, startDate), eq(apiUsageLogs.tenantId, tenantId)))
      .groupBy(apiUsageLogs.service);
    
    const totalCost = results.reduce((sum, r) => sum + Number(r.totalCost), 0);
    const totalCalls = results.reduce((sum, r) => sum + Number(r.totalCalls), 0);
    
    res.json({
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      totalCalls,
      services: results.map(r => ({
        service: r.service,
        totalCostUsd: Math.round(Number(r.totalCost) * 10000) / 10000,
        totalCalls: Number(r.totalCalls),
        totalInputTokens: Number(r.totalInputTokens),
        totalOutputTokens: Number(r.totalOutputTokens),
        avgDurationMs: Math.round(Number(r.avgDurationMs)),
        errorCount: Number(r.errorCount),
      })),
    });
}));

app.get("/api/system/api-costs/trends", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const days = parseInt(req.query.days as string) || 30;
    const serviceFilter = req.query.service as string;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const conditions = [gte(apiUsageLogs.createdAt, startDate), eq(apiUsageLogs.tenantId, tenantId)];
    if (serviceFilter) conditions.push(eq(apiUsageLogs.service, serviceFilter));
    
    const results = await db
      .select({
        date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
        service: apiUsageLogs.service,
        totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
        totalCalls: sql<number>`COUNT(*)`,
        totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.totalTokens}), 0)`,
      })
      .from(apiUsageLogs)
      .where(and(...conditions))
      .groupBy(sql`DATE(${apiUsageLogs.createdAt})`, apiUsageLogs.service)
      .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);
    
    res.json(results.map(r => ({
      date: r.date,
      service: r.service,
      totalCostUsd: Math.round(Number(r.totalCost) * 10000) / 10000,
      totalCalls: Number(r.totalCalls),
      totalTokens: Number(r.totalTokens),
    })));
}));

app.get("/api/system/api-costs/recent", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const serviceFilter = req.query.service as string;
    
    const conditions = [eq(apiUsageLogs.tenantId, tenantId)];
    if (serviceFilter) conditions.push(eq(apiUsageLogs.service, serviceFilter));
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    const [logs, countResult] = await Promise.all([
      db
        .select()
        .from(apiUsageLogs)
        .where(whereClause)
        .orderBy(desc(apiUsageLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)` })
        .from(apiUsageLogs)
        .where(whereClause),
    ]);
    
    res.json({
      logs,
      total: Number(countResult[0]?.total || 0),
      limit,
      offset,
    });
}));

const requireSystemAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const replitUser = req.user;
  const sessionUserId = (req.session as Record<string, string>)?.userId;
  const userId = replitUser?.claims?.sub || sessionUserId;
  if (!userId) {
    return next(new UnauthorizedError("Ej autentiserad"));
  }
  try {
    const dbUser = await storage.getUser(userId);
    if (!dbUser || dbUser.role !== "admin") {
      return next(new ForbiddenError("Systemadministratörsbehörighet krävs."));
    }
    const { users } = await import("@shared/schema");
    const isGlobalAdmin = await db.select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.role, "admin")))
      .limit(1);
    if (isGlobalAdmin.length === 0) {
      return next(new ForbiddenError("Systemadministratörsbehörighet krävs."));
    }
    req.userId = userId;
    return next();
  } catch {
    return res.status(500).json({ error: "Kunde inte verifiera behörighet" });
  }
};

app.get("/api/system/api-costs/by-tenant", requireSystemAdmin, asyncHandler(async (req, res) => {
    const period = (req.query.period as string) || "month";
    let startDate: Date;
    
    switch (period) {
      case "day": startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); break;
      case "week": startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); break;
      case "year": startDate = new Date(new Date().getFullYear(), 0, 1); break;
      default: startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    const results = await db
      .select({
        tenantId: apiUsageLogs.tenantId,
        service: apiUsageLogs.service,
        totalCost: sql<number>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
        totalCalls: sql<number>`COUNT(*)`,
      })
      .from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, startDate))
      .groupBy(apiUsageLogs.tenantId, apiUsageLogs.service);
    
    res.json(results.map(r => ({
      tenantId: r.tenantId || "system",
      service: r.service,
      totalCostUsd: Math.round(Number(r.totalCost) * 10000) / 10000,
      totalCalls: Number(r.totalCalls),
    })));
}));

app.get("/api/system/api-budgets", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const budgets = await db.select().from(apiBudgets)
      .where(eq(apiBudgets.tenantId, tenantId))
      .orderBy(apiBudgets.service);
    res.json(budgets);
}));

app.put("/api/system/api-budgets", requireAdmin, asyncHandler(async (req, res) => {
    const currentTenantId = getTenantIdWithFallback(req);
    const { service, monthlyBudgetUsd, alertThresholdPercent } = req.body;
    if (!service || monthlyBudgetUsd === undefined) {
      throw new ValidationError("Service och budget krävs");
    }
    
    const existing = await db.select().from(apiBudgets)
      .where(and(
        eq(apiBudgets.service, service),
        eq(apiBudgets.tenantId, currentTenantId)
      ));
    
    if (existing.length > 0) {
      await db.update(apiBudgets)
        .set({ 
          monthlyBudgetUsd, 
          alertThresholdPercent: alertThresholdPercent || 80,
          updatedAt: new Date() 
        })
        .where(eq(apiBudgets.id, existing[0].id));
    } else {
      await db.insert(apiBudgets).values({
        service,
        tenantId: currentTenantId,
        monthlyBudgetUsd,
        alertThresholdPercent: alertThresholdPercent || 80,
      });
    }
    
    const budgets = await db.select().from(apiBudgets)
      .where(eq(apiBudgets.tenantId, currentTenantId))
      .orderBy(apiBudgets.service);
    res.json(budgets);
}));

app.get("/api/system/api-costs/pricing", requireAdmin, async (_req, res) => {
  const { PRICING } = await import("../api-usage-tracker");
  res.json(PRICING);
});

app.get("/api/system/budget-status", requireAdmin, asyncHandler(async (req, res) => {
  const { getTenantBudgetStatus } = await import("../ai-budget-service");
  const tenantId = getTenantIdWithFallback(req);
  const status = await getTenantBudgetStatus(tenantId);
  res.json(status);
}));

app.get("/api/system/budget-status/all-tenants", requireSystemAdmin, asyncHandler(async (req, res) => {
  const { getTenantBudgetStatus } = await import("../ai-budget-service");
  const { tenants } = await import("@shared/schema");
  const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const statuses = await Promise.all(
    allTenants.map(async (t) => {
      const status = await getTenantBudgetStatus(t.id);
      return { tenantId: t.id, tenantName: t.name, ...status };
    })
  );
  res.json(statuses);
}));

// ============================================
// FIELD WORKER TASK ENDPOINTS
// ============================================

app.get("/api/field-worker/tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { date, resourceId } = req.query;
    
    const allOrders = await storage.getWorkOrders(tenantId);
    const targetDate = date ? new Date(date as string) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0];
    
    let filtered = allOrders.filter(wo => {
      if (wo.scheduledDate) {
        const woDate = new Date(wo.scheduledDate).toISOString().split('T')[0];
        return woDate === dateStr;
      }
      return false;
    });
    
    if (resourceId) {
      filtered = filtered.filter(wo => wo.resourceId === resourceId);
    }
    
    filtered.sort((a, b) => {
      const aTime = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0;
      const bTime = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0;
      return aTime - bTime;
    });
    
    // Batch: hämta alla task-dependencies i en enda fråga istället för en per order (N+1 → 1).
    const childIds = filtered.map(wo => wo.id);
    const allDeps = childIds.length > 0
      ? await db.select().from(taskDependencyInstances)
          .where(inArray(taskDependencyInstances.childWorkOrderId, childIds))
      : [];
    const depsByChildId = new Map<string, typeof allDeps>();
    for (const d of allDeps) {
      const arr = depsByChildId.get(d.childWorkOrderId) ?? [];
      arr.push(d);
      depsByChildId.set(d.childWorkOrderId, arr);
    }

    const tasksWithDeps = filtered.map((wo) => {
      const deps = depsByChildId.get(wo.id) ?? [];
      const dependsOn = deps.map(d => ({
        parentId: d.parentWorkOrderId,
        type: d.dependencyType,
        completed: d.completed,
      }));
      const isLocked = dependsOn.some(d => d.type === 'before' && !d.completed);
      return {
        ...wo,
        dependsOn,
        isLocked,
        isDependentTask: dependsOn.length > 0,
      };
    });
    
    res.json(tasksWithDeps);
}));

app.post("/api/field-worker/tasks/:id/start", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const updated = await storage.updateWorkOrder(req.params.id, {
      executionStatus: "travel",
      status: "in_progress",
    });
    if (workOrder.tenantId) {
      handleWorkOrderStatusChange(req.params.id, workOrder.executionStatus || "pending", "travel", workOrder.tenantId).catch(err =>
        console.error("[ai-communication] Field start hook error:", err)
      );
    }
    res.json(updated);
}));

// Smal field-worker-shortcut: tvingar status=completed + executionStatus=completed
// och cascadar `taskDependencyInstances.completed`. Inte ersättningsbar av generiska
// `/api/work-orders/:id/status` eftersom den senare inte rör dependency-tabellen.
// Se `docs/wo-status-endpoints.md`.
app.post("/api/field-worker/tasks/:id/complete", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const updated = await storage.updateWorkOrder(req.params.id, {
      executionStatus: "completed",
      status: "completed",
      completedAt: new Date(),
    });
    if (workOrder.tenantId) {
      handleWorkOrderStatusChange(req.params.id, workOrder.executionStatus || "in_progress", "completed", workOrder.tenantId).catch(err =>
        console.error("[ai-communication] Field complete hook error:", err)
      );
    }
    
    await db.update(taskDependencyInstances)
      .set({ completed: true })
      .where(eq(taskDependencyInstances.parentWorkOrderId, req.params.id));
    
    res.json(updated);
}));

app.post("/api/field-worker/tasks/:id/update-metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const { metadata } = req.body;
    if (workOrder.objectId && metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        try {
          await createMetadata({
            tenantId,
            objektId: workOrder.objectId,
            metadataTypNamn: key,
            varde: String(value),
            metod: `field:${req.params.id}`,
          });
        } catch (e) {
        }
      }
    }
    
    res.json({ success: true });
}));

// ============================================
// FIELD WORKER PHOTO UPLOAD
// ============================================

app.post("/api/field-worker/tasks/:id/upload-photo", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Uppgift hittades inte");
    }

    const { contentType, size } = req.body;
    const { ObjectStorageService, ALLOWED_UPLOAD_MIME_TYPES } = await import("../replit_integrations/object_storage/objectStorage");
    const { MAX_FIELD_PHOTO_SIZE_BYTES, MAX_FIELD_PHOTO_SIZE_MB } = await import("@shared/upload-limits");
    if (!contentType || !ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
      throw new ValidationError("File type not allowed. Only images and PDFs are permitted.");
    }
    if (size !== undefined && size !== null && Number(size) > MAX_FIELD_PHOTO_SIZE_BYTES) {
      return res.status(413).json({ error: `Bilden är för stor. Maxgräns är ${MAX_FIELD_PHOTO_SIZE_MB} MB.` });
    }

    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    
    res.json({
      uploadURL,
      objectPath,
      workOrderId: req.params.id,
    });
}));

app.post("/api/field-worker/tasks/:id/confirm-photo", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const { objectPath, category } = req.body;
    if (!objectPath) {
      throw new ValidationError("objectPath krävs");
    }

    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const { MAX_FIELD_PHOTO_SIZE_BYTES } = await import("@shared/upload-limits");
    const oss = new ObjectStorageService();

    // Tenant-scoped ownership so all members of this tenant can read the
    // photo while cross-tenant access is blocked.
    try {
      await oss.validateUploadedFileAndSetAcl(objectPath, `tenant:${tenantId}`, "private", MAX_FIELD_PHOTO_SIZE_BYTES);
    } catch (err: any) {
      throw new ValidationError(err.message || "Fotot kunde inte verifieras i lagringen");
    }

    const metadata = (workOrder.metadata as Record<string, any>) || {};
    const photos = metadata.photos || [];
    photos.push({
      path: objectPath,
      category: category || "general",
      uploadedAt: new Date().toISOString(),
    });
    
    await storage.updateWorkOrder(req.params.id, tenantId, {
      metadata: { ...metadata, photos },
    });
    
    res.json({ success: true, photoCount: photos.length });
}));

// ============================================
// INVOICE PREVIEW TO FORTNOX EXPORT
// ============================================

app.post("/api/invoice-preview/export-to-fortnox", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { invoices } = req.body;
    
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      throw new ValidationError("Inga fakturor att exportera");
    }
    
    const results: Array<{ customerId: string; customerName: string; status: string; exportId?: string; error?: string }> = [];
    
    for (const invoice of invoices) {
      const lines = invoice.lines || [];

      // Tenant-ägarskapscheck: vägra om kunden inte tillhör aktuell tenant.
      // Annars kan en inloggad användare exportera fakturarader för vilken
      // kund-UUID som helst i hela systemet.
      if (invoice.customerId) {
        const customer = await storage.getCustomer(invoice.customerId);
        if (!customer || customer.tenantId !== tenantId) {
          for (const line of lines) {
            if (!line.workOrderId) continue;
            results.push({
              customerId: invoice.customerId,
              customerName: invoice.customerName,
              status: "error",
              error: "Kunden tillhör inte din organisation",
            });
          }
          continue;
        }
      }

      for (const line of lines) {
        if (!line.workOrderId) continue;
        try {
          const isManualLine = line.workOrderId.startsWith("manual:");
          const manualLineId = isManualLine ? line.workOrderId.replace("manual:", "") : null;

          // Extra ägarskapscheck för work-order-baserade rader: säkerställ att
          // den refererade ordern tillhör denna tenant.
          if (!isManualLine) {
            const wo = await storage.getWorkOrder(line.workOrderId);
            if (!wo || wo.tenantId !== tenantId) {
              results.push({
                customerId: invoice.customerId,
                customerName: invoice.customerName,
                status: "error",
                error: "Arbetsordern tillhör inte din organisation",
              });
              continue;
            }
          }

          const invoiceExport = await storage.createFortnoxInvoiceExport({
            tenantId,
            workOrderId: isManualLine ? null : line.workOrderId,
            status: "pending",
            totalAmount: Math.round(line.total || 0),
            costCenter: invoice.headerMetadata?.kostnadsställe || null,
            project: invoice.headerMetadata?.projekt || null,
            sourceType: isManualLine ? "manual" : "work_order",
            sourceId: isManualLine ? manualLineId : line.workOrderId,
            customerId: invoice.customerId || null,
          });
          
          if (isManualLine && manualLineId) {
            await storage.updateManualInvoiceLine(manualLineId, tenantId, {
              status: "queued",
              invoiceExportId: invoiceExport.id,
            });
          }
          
          results.push({
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            status: "pending",
            exportId: invoiceExport.id,
          });
        } catch (e: any) {
          results.push({
            customerId: invoice.customerId,
            customerName: invoice.customerName,
            status: "error",
            error: e.message,
          });
        }
      }
    }
    
    res.json({ 
      exported: results.filter(r => r.status === "pending").length,
      failed: results.filter(r => r.status === "error").length,
      results 
    });
}));

// ============================================
// MANUAL INVOICE LINES
// ============================================

app.get("/api/manual-invoice-lines", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId, status } = req.query;
    const lines = await storage.getManualInvoiceLines(tenantId, customerId as string | undefined, status as string | undefined);
    res.json(lines);
}));

app.post("/api/manual-invoice-lines", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId, articleId, description, quantity, unitPrice, costCenter, project, notes } = req.body;
    if (!customerId || !description) {
      throw new ValidationError("Kund och beskrivning krävs");
    }
    const customer = await storage.getCustomer(customerId);
    if (!customer || customer.tenantId !== tenantId) {
      throw new ValidationError("Kunden tillhör inte din organisation");
    }
    if (articleId) {
      const article = await storage.getArticle(articleId);
      if (!article || article.tenantId !== tenantId) {
        throw new ValidationError("Artikeln tillhör inte din organisation");
      }
    }
    const parsedQuantity = Math.max(1, Math.round(Number(quantity) || 1));
    const parsedUnitPrice = Math.round(Number(unitPrice) || 0);
    const line = await storage.createManualInvoiceLine({
      tenantId,
      customerId,
      articleId: articleId || null,
      description: String(description).slice(0, 500),
      quantity: parsedQuantity,
      unitPrice: parsedUnitPrice,
      costCenter: costCenter ? String(costCenter).slice(0, 50) : null,
      project: project ? String(project).slice(0, 50) : null,
      notes: notes ? String(notes).slice(0, 1000) : null,
      status: "draft",
    });
    res.status(201).json(line);
}));

app.patch("/api/manual-invoice-lines/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getManualInvoiceLine(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError("Manuell fakturarad hittades inte");
    }
    const allowedFields = ["description", "quantity", "unitPrice", "costCenter", "project", "notes", "articleId"];
    const safeData: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) safeData[key] = req.body[key];
    }
    const updated = await storage.updateManualInvoiceLine(req.params.id, tenantId, safeData);
    res.json(updated);
}));

app.delete("/api/manual-invoice-lines/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getManualInvoiceLine(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError("Manuell fakturarad hittades inte");
    }
    if (existing.status === "queued" || existing.status === "invoiced") {
      throw new ValidationError("Kan inte radera en fakturarad som redan är köad eller fakturerad");
    }
    await storage.deleteManualInvoiceLine(req.params.id, tenantId);
    res.status(204).send();
}));

// ============================================
// CREDIT INVOICES
// ============================================

app.post("/api/fortnox/exports/:id/credit", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const originalExport = await storage.getFortnoxInvoiceExport(req.params.id);
    if (!originalExport || originalExport.tenantId !== tenantId) {
      throw new NotFoundError("Fakturaexport hittades inte");
    }
    if (originalExport.isCreditInvoice) {
      throw new ValidationError("Kan inte kreditera en kreditfaktura");
    }
    if (originalExport.creditedByExportId) {
      throw new ValidationError("Denna faktura har redan krediterats");
    }
    if (originalExport.status !== "exported") {
      throw new ValidationError("Kan bara kreditera exporterade fakturor med Fortnox-fakturanummer");
    }
    if (!originalExport.fortnoxInvoiceNumber) {
      throw new ValidationError("Originalfakturan saknar Fortnox-fakturanummer");
    }
    if (originalExport.fortnoxInvoiceNumber.includes(",")) {
      throw new ValidationError("Kan inte kreditera fakturor med flera Fortnox-fakturanummer. Kontakta support.");
    }

    const creditExport = await storage.createFortnoxInvoiceExport({
      tenantId,
      workOrderId: originalExport.workOrderId || null,
      status: "pending",
      totalAmount: originalExport.totalAmount ? -originalExport.totalAmount : 0,
      costCenter: originalExport.costCenter,
      project: originalExport.project,
      payerId: originalExport.payerId,
      isCreditInvoice: true,
      originalExportId: originalExport.id,
      sourceType: "credit",
      sourceId: originalExport.id,
      customerId: originalExport.customerId || null,
    });

    await storage.updateFortnoxInvoiceExport(originalExport.id, tenantId, {
      creditedByExportId: creditExport.id,
    });

    res.status(201).json(creditExport);
}));

// ============================================
// INSPECTION METADATA ENDPOINTS
// ============================================

app.get("/api/inspection-metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId } = req.query;
    const results = await storage.getInspectionMetadata(tenantId, objectId as string | undefined);
    res.json(results);
}));

app.post("/api/inspection-metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await storage.createInspectionMetadata({ ...req.body, tenantId });
    res.status(201).json(result);
}));

app.get("/api/inspection-metadata/search", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { inspectionType, status, objectId } = req.query;
    const results = await storage.searchInspectionMetadata(tenantId, {
      inspectionType: inspectionType as string | undefined,
      status: status as string | undefined,
      objectId: objectId as string | undefined,
    });
    res.json(results);
}));

// ============================================
// AI ETA & DELAY SERVICE
// ============================================

app.get("/api/ai/eta-overview", asyncHandler(async (req, res) => {
    const { calculateETAForTodaysOrders } = await import("../ai-eta-service");
    const tenantId = getTenantIdWithFallback(req);
    const overview = await calculateETAForTodaysOrders(tenantId);
    res.json(overview);
}));

app.post("/api/ai/eta-check-delays", asyncHandler(async (req, res) => {
    const { checkAndNotifyDelays } = await import("../ai-eta-service");
    const tenantId = getTenantIdWithFallback(req);
    const { thresholdMinutes } = req.body;
    const result = await checkAndNotifyDelays(tenantId, thresholdMinutes || 20);
    res.json(result);
}));

// ============================================
// AI INSIGHT CARDS
// ============================================

app.get("/api/ai/insights", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { enforceBudgetAndRateLimit } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "analysis");
    if (!enforcement.allowed) {
      return res.json([]);
    }
    const { generateInsightCards } = await import("../ai-insights");
    const cards = await generateInsightCards(tenantId);
    res.json(cards);
}));

// ============================================
// AI-ASSISTED PLANNING
// ============================================

app.post("/api/ai/assisted-plan", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { enforceBudgetAndRateLimit: enforcePlan } = await import("../ai-budget-service");
    const apEnforcement = await enforcePlan(tenantId, "planning");
    if (!apEnforcement.allowed) {
      if (apEnforcement.errorType === "ratelimit") {
        res.set("Retry-After", String(apEnforcement.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: apEnforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden", message: apEnforcement.errorMessage });
    }

    const { aiAssistedSchedule, runWithAIContext } = await import("../ai-planner");
    const { weekStart, weekEnd, instruction } = req.body;

    const [workOrders, resources, clusters, setupTimeLogs] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getClusters(tenantId),
      storage.getSetupTimeLogs(tenantId),
    ]);

    const unscheduledOrderIds = workOrders
      .filter(o => !o.scheduledDate || !o.resourceId)
      .map(o => o.id);
    const timeWindows = await storage.getTaskTimewindowsBatch(unscheduledOrderIds);

    const result = await runWithAIContext({ tenantId, model: apEnforcement.model }, () =>
      aiAssistedSchedule({
        workOrders,
        resources,
        clusters,
        weekStart: weekStart || new Date().toISOString().split("T")[0],
        weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        setupTimeLogs,
        timeWindows,
      }, instruction)
    );

    res.json(result);
}));

// ============================================
// AI CUSTOMER COMMUNICATION
// ============================================

app.get("/api/ai/communications", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, status, from, to } = req.query;
    const log = await getCommunicationLog(tenantId, {
      workOrderId: workOrderId as string,
      status: status as string,
      from: from as string,
      to: to as string,
    });
    res.json(log);
}));

app.get("/api/ai/communications/settings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const settings = await getAutoNotificationSettings(tenantId);
    res.json(settings);
}));

app.post("/api/ai/communications/eta-update", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, estimatedMinutes } = req.body;
    if (!workOrderId || estimatedMinutes === undefined) {
      throw new ValidationError("workOrderId och estimatedMinutes krävs");
    }
    const result = await sendETAUpdate(workOrderId, estimatedMinutes, tenantId);
    res.json(result);
}));

app.post("/api/ai/communications/send-manual", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, notificationType, channel, customMessage } = req.body;
    if (!workOrderId) {
      throw new ValidationError("workOrderId krävs");
    }
    const result = await handleWorkOrderStatusChange(
      workOrderId, 
      "manual", 
      notificationType || "reminder", 
      tenantId
    );
    res.json({ success: true, result });
}));

// ============================================
// USER MANAGEMENT API
// ============================================

const requireAdminAuth = async (req: any, res: any, next: any) => {
  const replitUser = req.user;
  const sessionUserId = (req.session as any)?.userId;
  const userId = replitUser?.claims?.sub || sessionUserId;
  if (!userId) {
    return next(new UnauthorizedError("Du måste logga in för att komma åt denna resurs."));
  }
  try {
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return next(new UnauthorizedError("Användaren hittades inte."));
    }
    req.userId = userId;
    if (!req.tenantId) {
      const userTenants = await getUserTenants(userId);
      if (userTenants.length > 0) {
        req.tenantId = userTenants[0].tenantId;
      }
    }
    if (!req.tenantId) {
      return next(new ForbiddenError("Ingen tenant-tillhörighet hittades."));
    }
    const tenantRole = await storage.getUserTenantRole(userId, req.tenantId);
    if (!tenantRole || (tenantRole.role !== "admin" && tenantRole.role !== "owner")) {
      return next(new ForbiddenError("Administratörsrättigheter inom organisationen krävs."));
    }
    return next();
  } catch {
    return res.status(500).json({ error: "Kunde inte verifiera behörighet" });
  }
};

app.get("/api/admin/users", requireAdminAuth, asyncHandler(async (req, res) => {
    const tenantId = (req as any).tenantId;
    const tenantUsers = await storage.getUsersByTenant(tenantId);
    const safeUsers = tenantUsers.map(({ passwordHash, ...user }) => user);
    res.json(safeUsers);
}));

app.post("/api/admin/users", requireAdminAuth, asyncHandler(async (req, res) => {
    const { email, firstName, lastName, password, role, resourceId } = req.body;

    if (!email || !password) {
      throw new ValidationError("E-post och lösenord krävs");
    }

    const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"];
    if (role && !validRoles.includes(role)) {
      throw new ValidationError(`Ogiltig roll: ${role}`);
    }

    const tenantId = (req as any).tenantId;
    const hashedPassword = hashPassword(password);

    const existing = await storage.getUserByUsername(email);
    let user;
    if (existing) {
      // Kontrollera om användaren är medlem någonstans. Om hen är "föräldralös"
      // (raderad från alla organisationer men användarraden låg kvar pga FK:er)
      // återanvänder vi raden och kopplar in hen i denna organisation med nya
      // uppgifter. Det matchar förväntningen att en raderad användare kan
      // återskapas med samma e-post.
      const memberships = await getUserTenants(existing.id);
      const inThisTenant = memberships.some((m) => m.tenantId === tenantId);
      if (inThisTenant) {
        throw new ConflictError("En användare med den e-postadressen finns redan i denna organisation");
      }
      if (memberships.length > 0) {
        throw new ConflictError("E-postadressen används redan av en användare i en annan organisation");
      }
      const updated = await storage.updateUser(existing.id, {
        firstName: firstName || existing.firstName || null,
        lastName: lastName || existing.lastName || null,
        passwordHash: hashedPassword,
        resourceId: resourceId ?? existing.resourceId ?? null,
        isActive: true,
      });
      user = updated ?? existing;
      console.log(`[user-mgmt] Återaktiverade befintlig användare "${email}"`);
    } else {
      user = await storage.createUser({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        passwordHash: hashedPassword,
        role: "user",
        resourceId: resourceId || null,
        isActive: true,
      });
    }

    if (tenantId) {
      await assignUserToTenant(user.id, tenantId, (role || "user") as UserRole, (req as any).userId);
    }

    if (tenantId) {
      await db
        .insert(invitations)
        .values({
          email: email.toLowerCase(),
          tenantId,
          role: role || "user",
          invitedBy: (req as any).userId || null,
          status: "pending",
        })
        .onConflictDoNothing();
      console.log(`[user-mgmt] Auto-invitation created for "${email}" in tenant "${tenantId}"`);
    }

    const { passwordHash: _, ...safeUser } = user;
    console.log(`[user-mgmt] User "${email}" created with role "${role || 'user'}"`);
    res.status(201).json(safeUser);
}));

app.patch("/api/admin/users/bulk", requireAdminAuth, asyncHandler(async (req, res) => {
    const { ids, updates } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new ValidationError("Inga användare valda");
    }
    let tenantRoleToAssign: string | undefined;
    if (updates.role !== undefined) {
      const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"];
      if (!validRoles.includes(updates.role)) {
        throw new ValidationError(`Ogiltig roll: ${updates.role}`);
      }
      tenantRoleToAssign = updates.role;
    }
    const accountUpdates: Record<string, any> = {};
    if (updates.isActive !== undefined) accountUpdates.isActive = updates.isActive;
    if (tenantRoleToAssign === undefined && Object.keys(accountUpdates).length === 0) {
      throw new ValidationError("Inga uppdateringar angivna");
    }
    let updatedCount = 0;
    const tenantId = (req as any).tenantId;
    for (const id of ids) {
      const membership = await storage.getUserTenantRole(id, tenantId);
      if (!membership) {
        continue;
      }
      if (Object.keys(accountUpdates).length > 0) {
        await storage.updateUser(id, accountUpdates);
      }
      if (tenantRoleToAssign) {
        await assignUserToTenant(id, tenantId, tenantRoleToAssign as UserRole, (req as any).userId);
      }
      updatedCount++;
    }
    console.log(`[user-mgmt] Bulk update: ${updatedCount} users updated with`, { ...accountUpdates, tenantRole: tenantRoleToAssign });
    res.json({ success: true, updatedCount });
}));

app.patch("/api/admin/users/:id", requireAdminAuth, asyncHandler(async (req, res) => {
    const tenantId = (req as any).tenantId;
    const membership = await storage.getUserTenantRole(req.params.id, tenantId);
    if (!membership) {
      throw new ForbiddenError("Ej behörig", { message: "Användaren tillhör inte din organisation." });
    }

    const { email, firstName, lastName, password, role, resourceId, isActive } = req.body;

    if (role !== undefined) {
      const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"];
      if (!validRoles.includes(role)) {
        throw new ValidationError(`Ogiltig roll: ${role}`);
      }
    }

    const accountData: Record<string, any> = {};
    if (email !== undefined) accountData.email = email;
    if (firstName !== undefined) accountData.firstName = firstName;
    if (lastName !== undefined) accountData.lastName = lastName;
    if (resourceId !== undefined) accountData.resourceId = resourceId;
    if (isActive !== undefined) accountData.isActive = isActive;
    if (password) {
      accountData.passwordHash = hashPassword(password);
    }

    let user = await storage.getUser(req.params.id);
    if (!user) throw new NotFoundError("Användaren hittades inte");

    if (Object.keys(accountData).length > 0) {
      const updated = await storage.updateUser(req.params.id, accountData);
      if (updated) user = updated;
    }

    let effectiveRole: string | null = membership.role ?? user.role ?? "user";
    if (role !== undefined) {
      await assignUserToTenant(req.params.id, tenantId, role as UserRole, (req as any).userId);
      effectiveRole = role;
    }

    const { passwordHash: _, ...safeUser } = user;
    res.json({ ...safeUser, role: effectiveRole });
}));

app.delete("/api/admin/users/:id", requireAdminAuth, asyncHandler(async (req, res) => {
    const currentUserId = (req as any).userId;
    if (req.params.id === currentUserId) {
      throw new ValidationError("Du kan inte ta bort ditt eget konto");
    }
    const tenantId = (req as any).tenantId;
    const membership = await storage.getUserTenantRole(req.params.id, tenantId);
    if (!membership) {
      throw new ForbiddenError("Ej behörig", { message: "Användaren tillhör inte din organisation." });
    }
    await storage.deleteUserTenantRole(membership.id);
    res.json({ success: true });
}));

// Login with email + password (returns session)
app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const { logLoginEvent } = await import("../login-audit");
    if (!email || !password) {
      await logLoginEvent({ req, method: "password", outcome: "failed", email: email || null, reason: "missing_credentials" });
      throw new ValidationError("E-post och lösenord krävs");
    }

    const { verifyPassword } = await import("../password");
    const user = await storage.getUserByUsername(email);
    if (!user || !user.passwordHash) {
      await logLoginEvent({ req, method: "password", outcome: "failed", email, reason: "unknown_user_or_no_password" });
      throw new UnauthorizedError("Felaktig e-post eller lösenord");
    }
    if (user.isActive === false) {
      await logLoginEvent({ req, method: "password", outcome: "failed", email, userId: user.id, reason: "inactive_account" });
      throw new ForbiddenError("Kontot är inaktiverat");
    }

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      await logLoginEvent({ req, method: "password", outcome: "failed", email, userId: user.id, reason: "bad_password" });
      throw new UnauthorizedError("Felaktig e-post eller lösenord");
    }

    (req.session as any).userId = user.id;
    (req.session as any).userEmail = user.email;
    (req.session as any).userRole = user.role;

    await storage.updateUser(user.id, { lastLoginAt: new Date() });
    await logLoginEvent({ req, method: "password", outcome: "success", email, userId: user.id });

    const { passwordHash: _, ...safeUser } = user;
    console.log(`[auth] User "${email}" logged in successfully`);
    res.json({ success: true, user: safeUser });
}));

app.get("/api/auth/me", asyncHandler(async (req, res) => {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      throw new UnauthorizedError("Inte inloggad");
    }
    const user = await storage.getUser(userId);
    if (!user) {
      throw new UnauthorizedError("Användaren hittades inte");
    }
    const { passwordHash: _, ...safeUser } = user;
    res.json(safeUser);
}));

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ============================================
// FIELD → MOBILE AUTH BRIDGE
// ============================================

app.post("/api/field/mobile-token", asyncHandler(async (req: any, res) => {
    const user = req.user || (req.session as any)?.passport?.user;
    if (!user) {
      throw new ForbiddenError("Ej autentiserad");
    }
    const userResourceId = user.resourceId;

    if (!userResourceId) {
      throw new ValidationError("Ingen resurs-ID kopplad till din användare");
    }

    const resource = await storage.getResource(userResourceId);
    if (!resource) {
      throw new NotFoundError("Resurs hittades inte");
    }

    const { generateMobileToken, mobileTokens } = await import("./helpers");
    const token = generateMobileToken();
    mobileTokens.set(token, {
      resourceId: userResourceId,
      tenantId: resource.tenantId,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    console.log(`[field] Mobile token generated for resource ${userResourceId}`);
    res.json({ token, resourceId: userResourceId, expiresIn: 86400 });
}));

// ============================================
// ASSOCIATION TVÅSTEGSFILTER API (Kinab P3)
// ============================================

app.get("/api/objects/:id/matching-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectId = req.params.id;

    const obj = await storage.getObject(objectId);
    if (!obj || !verifyTenantOwnership(obj, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }

    const { getMatchingArticlesForObject } = await import("../association-service");
    const matches = await getMatchingArticlesForObject(objectId, tenantId);
    res.json(matches);
}));

app.post("/api/articles/:id/test-association", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const articleId = req.params.id;
    const { label, value, operator } = req.body;

    if (!label || !value) {
      throw new ValidationError("Etikett och värde krävs");
    }

    const { testArticleAssociation } = await import("../association-service");
    const result = await testArticleAssociation(
      articleId,
      tenantId,
      label,
      value,
      operator || "equals"
    );
    res.json(result);
}));

app.get("/api/articles/:id/matched-objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const articleId = req.params.id;

    const { getMatchedObjectsForArticle } = await import("../association-service");
    const result = await getMatchedObjectsForArticle(articleId, tenantId);

    if (!result.article) {
      throw new NotFoundError("Artikel hittades inte");
    }

    res.json(result);
}));

// ============================================
// TELEPHONY LOOKUP API (Växel-API P14)
// ============================================

app.get("/api/telephony/lookup", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const phone = req.query.phone as string;

    if (!phone || phone.trim().length < 5) {
      throw new ValidationError("Telefonnummer krävs (minst 5 siffror)");
    }

    const { lookupCustomerByPhone } = await import("../telephony-service");
    const result = await lookupCustomerByPhone(tenantId, phone.trim());

    res.json(result);
}));

// ============================================
// RESOURCE AVAILABILITY API (Statusmeddelanden P15)
// ============================================

app.get("/api/resources/availability", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resourceId = req.query.resourceId as string | undefined;

    const { getResourceAvailability } = await import("../telephony-service");
    const result = await getResourceAvailability(tenantId, resourceId);

    res.json(result);
}));

app.get("/api/resources/:id/status-message", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resourceId = req.params.id;
    const triggerType = (req.query.triggerType as string) || "incoming_call";

    const { generateStatusMessage } = await import("../telephony-service");
    const message = await generateStatusMessage(tenantId, resourceId, triggerType);

    res.json({ message, resourceId, triggerType });
}));

// ============================================
// STATUS MESSAGE TEMPLATES CRUD
// ============================================

app.get("/api/status-message-templates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { statusMessageTemplates } = await import("@shared/schema");
    const templates = await db.select().from(statusMessageTemplates)
      .where(eq(statusMessageTemplates.tenantId, tenantId))
      .orderBy(statusMessageTemplates.priority);
    res.json(templates);
}));

app.post("/api/status-message-templates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { statusMessageTemplates, insertStatusMessageTemplateSchema } = await import("@shared/schema");
    const validated = insertStatusMessageTemplateSchema.parse({ ...req.body, tenantId });
    const [template] = await db.insert(statusMessageTemplates).values(validated).returning();
    res.status(201).json(template);
}));

app.patch("/api/status-message-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { statusMessageTemplates } = await import("@shared/schema");
    const [existing] = await db.select().from(statusMessageTemplates)
      .where(and(eq(statusMessageTemplates.id, req.params.id), eq(statusMessageTemplates.tenantId, tenantId)));
    if (!existing) throw new NotFoundError("Mall hittades inte");
    const { name, templateText, triggerType, isActive, priority } = req.body;
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (templateText !== undefined) updates.templateText = templateText;
    if (triggerType !== undefined) updates.triggerType = triggerType;
    if (isActive !== undefined) updates.isActive = isActive;
    if (priority !== undefined) updates.priority = priority;
    const [updated] = await db.update(statusMessageTemplates)
      .set(updates)
      .where(eq(statusMessageTemplates.id, req.params.id))
      .returning();
    res.json(updated);
}));

app.delete("/api/status-message-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { statusMessageTemplates } = await import("@shared/schema");
    const [existing] = await db.select().from(statusMessageTemplates)
      .where(and(eq(statusMessageTemplates.id, req.params.id), eq(statusMessageTemplates.tenantId, tenantId)));
    if (!existing) throw new NotFoundError("Mall hittades inte");
    await db.delete(statusMessageTemplates).where(eq(statusMessageTemplates.id, req.params.id));
    res.status(204).send();
}));

// ============================================
// TELEPHONY + STATUS: Combined lookup with auto-response
// ============================================

app.get("/api/telephony/lookup-with-status", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const phone = req.query.phone as string;
    const resourceId = req.query.resourceId as string | undefined;

    if (!phone || phone.trim().length < 5) {
      throw new ValidationError("Telefonnummer krävs");
    }

    const { lookupCustomerByPhone, getResourceAvailability, generateStatusMessage } = await import("../telephony-service");

    const lookup = await lookupCustomerByPhone(tenantId, phone.trim());

    let statusMessages: Array<{ resourceId: string; resourceName: string; message: string | null }> = [];

    if (resourceId) {
      const msg = await generateStatusMessage(tenantId, resourceId, "incoming_call");
      const avail = await getResourceAvailability(tenantId, resourceId);
      statusMessages = [{ resourceId, resourceName: avail[0]?.resourceName || "", message: msg }];
    } else {
      const allAvailability = await getResourceAvailability(tenantId);
      statusMessages = await Promise.all(
        allAvailability.slice(0, 5).map(async (r) => {
          const msg = await generateStatusMessage(tenantId, r.resourceId, "incoming_call");
          return { resourceId: r.resourceId, resourceName: r.resourceName, message: msg };
        })
      );
    }

    res.json({
      ...lookup,
      statusMessages,
    });
}));

}
