import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { objects, workOrders, articles , insertDeviationReportSchema, insertProtocolSchema } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek, getDateFromWeekdayInMonth } from "./helpers";
import { notificationService } from "../notifications";
import { sendEmail } from "../replit_integrations/resend";
import { requireAdmin } from "../tenant-middleware";
import { hashPassword } from "../password";
import { getArticleMetadataForObject, writeArticleMetadataOnObject, createMetadata, getAllMetadataTypes } from "../metadata-queries";

export async function registerExtendedRoutes(app: Express) {
// ============================================
// PUBLIC ISSUE REPORT API (No auth required - for QR code scanning)
// ============================================

// Get object info and report form by QR code
app.get("/api/public/report/:code", async (req, res) => {
  try {
    const { code } = req.params;
    
    const qrLink = await storage.getQrCodeLinkByCode(code);
    if (!qrLink) {
      return res.status(404).json({ error: "Ogiltig QR-kod" });
    }
    
    if (!qrLink.isActive) {
      return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });
    }
    
    // Increment scan count
    await storage.incrementQrCodeScanCount(qrLink.id);
    
    // Get object info (limited)
    const object = await storage.getObject(qrLink.objectId);
    if (!object) {
      return res.status(404).json({ error: "Objekt hittades inte" });
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
  } catch (error) {
    console.error("Failed to get public report info:", error);
    res.status(500).json({ error: "Kunde inte ladda information" });
  }
});

// Submit public issue report (no auth)
app.post("/api/public/report/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const { category, title, description, reporterName, reporterEmail, reporterPhone, photos, latitude, longitude } = req.body;
    
    const qrLink = await storage.getQrCodeLinkByCode(code);
    if (!qrLink) {
      return res.status(404).json({ error: "Ogiltig QR-kod" });
    }
    
    if (!qrLink.isActive) {
      return res.status(410).json({ error: "Denna QR-kod är inte längre aktiv" });
    }
    
    if (!category || !title) {
      return res.status(400).json({ error: "Kategori och titel krävs" });
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
      photos: photos || undefined,
      latitude: latitude || undefined,
      longitude: longitude || undefined,
      ipAddress: req.ip || undefined,
      userAgent: req.headers['user-agent'] || undefined,
      status: 'new',
    });
    
    res.status(201).json({
      success: true,
      reportId: report.id,
      message: "Tack för din anmälan! Vi har tagit emot den och kommer att hantera ärendet.",
    });
  } catch (error) {
    console.error("Failed to create public issue report:", error);
    res.status(500).json({ error: "Kunde inte skicka anmälan" });
  }
});

// ============================================
// PROTOCOLS API
// ============================================

app.get("/api/protocols", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, objectId, protocolType, status } = req.query;
    
    const protocols = await storage.getProtocols(tenantId, {
      workOrderId: workOrderId as string,
      objectId: objectId as string,
      protocolType: protocolType as string,
      status: status as string,
    });
    
    res.json(protocols);
  } catch (error) {
    console.error("Failed to get protocols:", error);
    res.status(500).json({ error: "Kunde inte hämta protokoll" });
  }
});

// Get assessment statistics - MUST be before /:id
app.get("/api/protocols/statistics/assessments", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to get assessment statistics:", error);
    res.status(500).json({ error: "Kunde inte hämta statistik" });
  }
});

app.get("/api/protocols/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const protocol = await storage.getProtocol(req.params.id);
    
    if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
      return res.status(404).json({ error: "Protokoll hittades inte" });
    }
    
    res.json(protocol);
  } catch (error) {
    console.error("Failed to get protocol:", error);
    res.status(500).json({ error: "Kunde inte hämta protokoll" });
  }
});

app.post("/api/protocols", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const { insertProtocolSchema } = await import("@shared/schema");
    const validated = insertProtocolSchema.parse({ ...req.body, tenantId });
    
    const protocol = await storage.createProtocol(validated);
    res.status(201).json(protocol);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create protocol:", error);
    res.status(500).json({ error: "Kunde inte skapa protokoll" });
  }
});

app.patch("/api/protocols/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getProtocol(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Protokoll hittades inte" });
    }
    
    const protocol = await storage.updateProtocol(req.params.id, tenantId, req.body);
    res.json(protocol);
  } catch (error) {
    console.error("Failed to update protocol:", error);
    res.status(500).json({ error: "Kunde inte uppdatera protokoll" });
  }
});

app.delete("/api/protocols/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getProtocol(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Protokoll hittades inte" });
    }
    
    await storage.deleteProtocol(req.params.id, tenantId);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete protocol:", error);
    res.status(500).json({ error: "Kunde inte ta bort protokoll" });
  }
});

// Generate PDF for protocol
app.post("/api/protocols/:id/generate-pdf", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const protocol = await storage.getProtocol(req.params.id);
    if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
      return res.status(404).json({ error: "Protokoll hittades inte" });
    }
    
    const { generateProtocolPdf } = await import('./protocol-pdf-generator');
    
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
  } catch (error) {
    console.error("Failed to generate protocol PDF:", error);
    res.status(500).json({ error: "Kunde inte generera PDF" });
  }
});

// Send protocol to customer via email
app.post("/api/protocols/:id/send-to-customer", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const protocol = await storage.getProtocol(req.params.id);
    if (!protocol || !verifyTenantOwnership(protocol, tenantId)) {
      return res.status(404).json({ error: "Protokoll hittades inte" });
    }
    
    const { sendProtocolToCustomer } = await import('./protocol-email-service');
    
    const workOrder = await storage.getWorkOrder(protocol.workOrderId);
    const object = protocol.objectId ? await storage.getObject(protocol.objectId) : null;
    const customer = workOrder?.customerId ? await storage.getCustomer(workOrder.customerId) : null;
    const tenant = await storage.getTenant(tenantId);
    
    if (!customer?.email) {
      return res.status(400).json({ error: "Kunden har ingen e-postadress" });
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
  } catch (error) {
    console.error("Failed to send protocol to customer:", error);
    res.status(500).json({ error: "Kunde inte skicka protokoll" });
  }
});

// ============================================
// DEVIATION REPORTS API
// ============================================

app.get("/api/deviation-reports", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId, status, category, severity } = req.query;
    
    const reports = await storage.getDeviationReports(tenantId, {
      objectId: objectId as string,
      status: status as string,
      category: category as string,
      severity: severity as string,
    });
    
    res.json(reports);
  } catch (error) {
    console.error("Failed to get deviation reports:", error);
    res.status(500).json({ error: "Kunde inte hämta avvikelserapporter" });
  }
});

app.get("/api/deviation-reports/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const report = await storage.getDeviationReport(req.params.id);
    
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      return res.status(404).json({ error: "Avvikelserapport hittades inte" });
    }
    
    res.json(report);
  } catch (error) {
    console.error("Failed to get deviation report:", error);
    res.status(500).json({ error: "Kunde inte hämta avvikelserapport" });
  }
});

app.post("/api/deviation-reports", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const { insertDeviationReportSchema } = await import("@shared/schema");
    const validated = insertDeviationReportSchema.parse({ ...req.body, tenantId });
    
    const report = await storage.createDeviationReport(validated);
    res.status(201).json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create deviation report:", error);
    res.status(500).json({ error: "Kunde inte skapa avvikelserapport" });
  }
});

app.patch("/api/deviation-reports/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const existing = await storage.getDeviationReport(req.params.id);
    if (!existing || !verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Avvikelserapport hittades inte" });
    }
    
    const report = await storage.updateDeviationReport(req.params.id, tenantId, req.body);
    res.json(report);
  } catch (error) {
    console.error("Failed to update deviation report:", error);
    res.status(500).json({ error: "Kunde inte uppdatera avvikelserapport" });
  }
});

// Create work order from deviation report
app.post("/api/deviation-reports/:id/create-order", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const report = await storage.getDeviationReport(req.params.id);
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      return res.status(404).json({ error: "Avvikelserapport hittades inte" });
    }
    
    // Get object and customer info
    const object = await storage.getObject(report.objectId);
    if (!object) {
      return res.status(400).json({ error: "Objekt hittades inte" });
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
  } catch (error) {
    console.error("Failed to create order from deviation:", error);
    res.status(500).json({ error: "Kunde inte skapa arbetsorder" });
  }
});

// Resolve deviation report
app.post("/api/deviation-reports/:id/resolve", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const user = (req as any).user;
    const { resolutionNotes } = req.body;
    
    const report = await storage.getDeviationReport(req.params.id);
    if (!report || !verifyTenantOwnership(report, tenantId)) {
      return res.status(404).json({ error: "Avvikelserapport hittades inte" });
    }
    
    const updated = await storage.updateDeviationReport(report.id, tenantId, {
      status: 'resolved',
      resolvedAt: new Date(),
      resolvedBy: user?.id,
      resolutionNotes,
    });
    
    res.json(updated);
  } catch (error) {
    console.error("Failed to resolve deviation report:", error);
    res.status(500).json({ error: "Kunde inte markera avvikelse som åtgärdad" });
  }
});

app.get("/api/objects/:id/issue-history", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const objectId = req.params.id;
    
    const obj = await storage.getObject(objectId);
    if (!obj || !verifyTenantOwnership(obj, tenantId)) {
      return res.status(404).json({ error: "Objekt hittades inte" });
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
  } catch (error) {
    console.error("Failed to get object issue history:", error);
    res.status(500).json({ error: "Kunde inte hämta problemhistorik" });
  }
});

// ============================================
// ENVIRONMENTAL DATA - Fas 3.1
// ============================================

app.get("/api/environmental-data", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, resourceId, startDate, endDate } = req.query;
    
    const data = await storage.getEnvironmentalData(tenantId, {
      workOrderId: workOrderId as string,
      resourceId: resourceId as string,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    
    res.json(data);
  } catch (error) {
    console.error("Failed to get environmental data:", error);
    res.status(500).json({ error: "Kunde inte hämta miljödata" });
  }
});

app.post("/api/environmental-data", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to create environmental data:", error);
    res.status(500).json({ error: "Kunde inte spara miljödata" });
  }
});

app.get("/api/environmental-data/statistics", async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to get environmental statistics:", error);
    res.status(500).json({ error: "Kunde inte hämta miljöstatistik" });
  }
});

// Environmental Certificate - annual sustainability report per customer
app.get("/api/environmental-certificates/:customerId", async (req, res) => {
  try {
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
      return res.status(404).json({ error: "Kund hittades inte" });
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
      wo => wo.status === "utford" || wo.status === "fakturerad"
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
  } catch (error) {
    console.error("Failed to generate environmental certificate:", error);
    res.status(500).json({ error: "Kunde inte generera miljöcertifikat" });
  }
});

app.get("/api/system/api-costs/summary", requireAdmin, async (req, res) => {
  try {
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
      .where(gte(apiUsageLogs.createdAt, startDate))
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
  } catch (error) {
    console.error("Failed to fetch API cost summary:", error);
    res.status(500).json({ error: "Kunde inte hämta API-kostnadssammanfattning" });
  }
});

app.get("/api/system/api-costs/trends", requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const serviceFilter = req.query.service as string;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const conditions = [gte(apiUsageLogs.createdAt, startDate)];
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
  } catch (error) {
    console.error("Failed to fetch API cost trends:", error);
    res.status(500).json({ error: "Kunde inte hämta kostnadstrender" });
  }
});

app.get("/api/system/api-costs/recent", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const serviceFilter = req.query.service as string;
    
    const conditions = [];
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
  } catch (error) {
    console.error("Failed to fetch recent API logs:", error);
    res.status(500).json({ error: "Kunde inte hämta API-loggar" });
  }
});

app.get("/api/system/api-costs/by-tenant", requireAdmin, async (req, res) => {
  try {
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
  } catch (error) {
    console.error("Failed to fetch tenant API costs:", error);
    res.status(500).json({ error: "Kunde inte hämta tenant-kostnader" });
  }
});

app.get("/api/system/api-budgets", requireAdmin, async (req, res) => {
  try {
    const budgets = await db.select().from(apiBudgets).orderBy(apiBudgets.service);
    res.json(budgets);
  } catch (error) {
    console.error("Failed to fetch API budgets:", error);
    res.status(500).json({ error: "Kunde inte hämta budgetar" });
  }
});

app.put("/api/system/api-budgets", requireAdmin, async (req, res) => {
  try {
    const { service, monthlyBudgetUsd, alertThresholdPercent, tenantId } = req.body;
    if (!service || monthlyBudgetUsd === undefined) {
      return res.status(400).json({ error: "Service och budget krävs" });
    }
    
    const existing = await db.select().from(apiBudgets)
      .where(and(
        eq(apiBudgets.service, service),
        tenantId ? eq(apiBudgets.tenantId, tenantId) : sql`${apiBudgets.tenantId} IS NULL`
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
        tenantId: tenantId || null,
        monthlyBudgetUsd,
        alertThresholdPercent: alertThresholdPercent || 80,
      });
    }
    
    const budgets = await db.select().from(apiBudgets).orderBy(apiBudgets.service);
    res.json(budgets);
  } catch (error) {
    console.error("Failed to update API budget:", error);
    res.status(500).json({ error: "Kunde inte uppdatera budget" });
  }
});

app.get("/api/system/api-costs/pricing", requireAdmin, async (_req, res) => {
  const { PRICING } = await import("./api-usage-tracker");
  res.json(PRICING);
});

// ============================================
// FIELD WORKER TASK ENDPOINTS
// ============================================

app.get("/api/field-worker/tasks", async (req, res) => {
  try {
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
    
    const tasksWithDeps = await Promise.all(filtered.map(async (wo) => {
      const deps = await db.select().from(taskDependencyInstances)
        .where(eq(taskDependencyInstances.childWorkOrderId, wo.id));
      
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
    }));
    
    res.json(tasksWithDeps);
  } catch (error) {
    console.error("Failed to get field worker tasks:", error);
    res.status(500).json({ error: "Kunde inte hämta uppgifter" });
  }
});

app.post("/api/field-worker/tasks/:id/start", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      return res.status(404).json({ error: "Uppgift hittades inte" });
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
  } catch (error) {
    res.status(500).json({ error: "Kunde inte starta uppgift" });
  }
});

app.post("/api/field-worker/tasks/:id/complete", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      return res.status(404).json({ error: "Uppgift hittades inte" });
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
  } catch (error) {
    res.status(500).json({ error: "Kunde inte slutföra uppgift" });
  }
});

app.post("/api/field-worker/tasks/:id/update-metadata", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      return res.status(404).json({ error: "Uppgift hittades inte" });
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
  } catch (error) {
    res.status(500).json({ error: "Kunde inte uppdatera metadata" });
  }
});

// ============================================
// FIELD WORKER PHOTO UPLOAD
// ============================================

app.post("/api/field-worker/tasks/:id/upload-photo", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      return res.status(404).json({ error: "Uppgift hittades inte" });
    }
    
    const { ObjectStorageService } = await import("./replit_integrations/object_storage/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    
    res.json({
      uploadURL,
      objectPath,
      workOrderId: req.params.id,
    });
  } catch (error) {
    console.error("Failed to generate photo upload URL:", error);
    res.status(500).json({ error: "Kunde inte generera uppladdnings-URL" });
  }
});

app.post("/api/field-worker/tasks/:id/confirm-photo", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      return res.status(404).json({ error: "Uppgift hittades inte" });
    }
    
    const { objectPath, category } = req.body;
    if (!objectPath) {
      return res.status(400).json({ error: "objectPath krävs" });
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
  } catch (error) {
    console.error("Failed to confirm photo upload:", error);
    res.status(500).json({ error: "Kunde inte spara fotoinformation" });
  }
});

// ============================================
// INVOICE PREVIEW TO FORTNOX EXPORT
// ============================================

app.post("/api/invoice-preview/export-to-fortnox", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { invoices } = req.body;
    
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({ error: "Inga fakturor att exportera" });
    }
    
    const results: Array<{ customerId: string; customerName: string; status: string; exportId?: string; error?: string }> = [];
    
    for (const invoice of invoices) {
      const lines = invoice.lines || [];
      for (const line of lines) {
        if (!line.workOrderId) continue;
        try {
          const invoiceExport = await storage.createFortnoxInvoiceExport({
            tenantId,
            workOrderId: line.workOrderId,
            status: "pending",
            totalAmount: Math.round(line.total || 0),
            costCenter: invoice.headerMetadata?.kostnadsställe || null,
            project: invoice.headerMetadata?.projekt || null,
          });
          
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
  } catch (error) {
    console.error("Failed to export invoices to Fortnox:", error);
    res.status(500).json({ error: "Kunde inte exportera fakturor till Fortnox" });
  }
});

// ============================================
// INSPECTION METADATA ENDPOINTS
// ============================================

app.get("/api/inspection-metadata", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { objectId } = req.query;
    const results = await storage.getInspectionMetadata(tenantId, objectId as string | undefined);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte hämta besiktningsdata" });
  }
});

app.post("/api/inspection-metadata", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const result = await storage.createInspectionMetadata({ ...req.body, tenantId });
    res.status(201).json(result);
  } catch (error) {
    console.error("Failed to create inspection metadata:", error);
    res.status(500).json({ error: "Kunde inte skapa besiktningsdata" });
  }
});

app.get("/api/inspection-metadata/search", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { inspectionType, status, objectId } = req.query;
    const results = await storage.searchInspectionMetadata(tenantId, {
      inspectionType: inspectionType as string | undefined,
      status: status as string | undefined,
      objectId: objectId as string | undefined,
    });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte söka besiktningsdata" });
  }
});

// ============================================
// AI ETA & DELAY SERVICE
// ============================================

app.get("/api/ai/eta-overview", async (req, res) => {
  try {
    const { calculateETAForTodaysOrders } = await import("./ai-eta-service");
    const tenantId = getTenantIdWithFallback(req);
    const overview = await calculateETAForTodaysOrders(tenantId);
    res.json(overview);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte beräkna ETA" });
  }
});

app.post("/api/ai/eta-check-delays", async (req, res) => {
  try {
    const { checkAndNotifyDelays } = await import("./ai-eta-service");
    const tenantId = getTenantIdWithFallback(req);
    const { thresholdMinutes } = req.body;
    const result = await checkAndNotifyDelays(tenantId, thresholdMinutes || 20);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte kontrollera förseningar" });
  }
});

// ============================================
// AI INSIGHT CARDS
// ============================================

app.get("/api/ai/insights", async (req, res) => {
  try {
    const { generateInsightCards } = await import("./ai-insights");
    const tenantId = getTenantIdWithFallback(req);
    const cards = await generateInsightCards(tenantId);
    res.json(cards);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte generera insikter" });
  }
});

// ============================================
// AI-ASSISTED PLANNING
// ============================================

app.post("/api/ai/assisted-plan", async (req, res) => {
  try {
    const { aiAssistedSchedule } = await import("./ai-planner");
    const { weekStart, weekEnd, instruction } = req.body;

    const tenantId = getTenantIdWithFallback(req);
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

    const result = await aiAssistedSchedule({
      workOrders,
      resources,
      clusters,
      weekStart: weekStart || new Date().toISOString().split("T")[0],
      weekEnd: weekEnd || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      setupTimeLogs,
      timeWindows,
    }, instruction);

    res.json(result);
  } catch (error) {
    console.error("AI Assisted Plan error:", error);
    res.status(500).json({ error: "Kunde inte skapa AI-assisterad plan" });
  }
});

// ============================================
// AI CUSTOMER COMMUNICATION
// ============================================

app.get("/api/ai/communications", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, status, from, to } = req.query;
    const log = await getCommunicationLog(tenantId, {
      workOrderId: workOrderId as string,
      status: status as string,
      from: from as string,
      to: to as string,
    });
    res.json(log);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte hämta kommunikationslogg" });
  }
});

app.get("/api/ai/communications/settings", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const settings = await getAutoNotificationSettings(tenantId);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte hämta inställningar" });
  }
});

app.post("/api/ai/communications/eta-update", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, estimatedMinutes } = req.body;
    if (!workOrderId || estimatedMinutes === undefined) {
      return res.status(400).json({ error: "workOrderId och estimatedMinutes krävs" });
    }
    const result = await sendETAUpdate(workOrderId, estimatedMinutes, tenantId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte skicka ETA-uppdatering" });
  }
});

app.post("/api/ai/communications/send-manual", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, notificationType, channel, customMessage } = req.body;
    if (!workOrderId) {
      return res.status(400).json({ error: "workOrderId krävs" });
    }
    const result = await handleWorkOrderStatusChange(
      workOrderId, 
      "manual", 
      notificationType || "reminder", 
      tenantId
    );
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: "Kunde inte skicka meddelande" });
  }
});

// ============================================
// USER MANAGEMENT API
// ============================================

const requireAdminAuth = async (req: any, res: any, next: any) => {
  const replitUser = req.user as any;
  const sessionUserId = (req.session as any)?.userId;
  const userId = replitUser?.claims?.sub || sessionUserId;
  if (!userId) {
    return res.status(401).json({ error: "Ej autentiserad", message: "Du måste logga in för att komma åt denna resurs." });
  }
  try {
    const dbUser = await storage.getUser(userId);
    if (!dbUser) {
      return res.status(401).json({ error: "Ej autentiserad", message: "Användaren hittades inte." });
    }
    const role = dbUser.role || "user";
    if (role !== "admin" && role !== "owner") {
      return res.status(403).json({ error: "Ej behörig", message: "Administratörsrättigheter krävs." });
    }
    req.userId = userId;
    const tenantId = await getTenantIdWithFallback(req);
    if (tenantId) {
      req.tenantId = tenantId;
    }
    return next();
  } catch {
    return res.status(500).json({ error: "Kunde inte verifiera behörighet" });
  }
};

app.get("/api/admin/users", requireAdminAuth, async (req, res) => {
  try {
    const allUsers = await storage.getAllUsers();
    const safeUsers = allUsers.map(({ passwordHash, ...user }) => user);
    res.json(safeUsers);
  } catch (error) {
    console.error("Failed to get users:", error);
    res.status(500).json({ error: "Kunde inte hämta användare" });
  }
});

app.post("/api/admin/users", requireAdminAuth, async (req, res) => {
  try {
    const { email, firstName, lastName, password, role, resourceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "E-post och lösenord krävs" });
    }

    const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: `Ogiltig roll: ${role}` });
    }

    const existing = await storage.getUserByUsername(email);
    if (existing) {
      return res.status(409).json({ error: "En användare med den e-postadressen finns redan" });
    }

    const hashedPassword = hashPassword(password);
    const user = await storage.createUser({
      email,
      firstName: firstName || null,
      lastName: lastName || null,
      passwordHash: hashedPassword,
      role: role || "user",
      resourceId: resourceId || null,
      isActive: true,
    });

    const tenantId = (req as any).tenantId;
    if (tenantId) {
      await assignUserToTenant(user.id, tenantId, (role || "user") as UserRole, (req as any).userId);
    }

    const { passwordHash: _, ...safeUser } = user;
    console.log(`[user-mgmt] User "${email}" created with role "${role || 'user'}"`);
    res.status(201).json(safeUser);
  } catch (error) {
    console.error("Failed to create user:", error);
    res.status(500).json({ error: "Kunde inte skapa användare" });
  }
});

app.patch("/api/admin/users/bulk", requireAdminAuth, async (req, res) => {
  try {
    const { ids, updates } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Inga användare valda" });
    }
    const validUpdates: Record<string, any> = {};
    if (updates.role !== undefined) {
      const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"];
      if (!validRoles.includes(updates.role)) {
        return res.status(400).json({ error: `Ogiltig roll: ${updates.role}` });
      }
      validUpdates.role = updates.role;
    }
    if (updates.isActive !== undefined) validUpdates.isActive = updates.isActive;
    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({ error: "Inga uppdateringar angivna" });
    }
    let updatedCount = 0;
    const tenantId = (req as any).tenantId;
    for (const id of ids) {
      const result = await storage.updateUser(id, validUpdates);
      if (result) {
        updatedCount++;
        if (validUpdates.role && tenantId) {
          await assignUserToTenant(id, tenantId, validUpdates.role as UserRole, (req as any).userId);
        }
      }
    }
    console.log(`[user-mgmt] Bulk update: ${updatedCount} users updated with`, validUpdates);
    res.json({ success: true, updatedCount });
  } catch (error) {
    console.error("Bulk update failed:", error);
    res.status(500).json({ error: "Bulk-uppdatering misslyckades" });
  }
});

app.patch("/api/admin/users/:id", requireAdminAuth, async (req, res) => {
  try {
    const { email, firstName, lastName, password, role, resourceId, isActive } = req.body;
    const updateData: Record<string, any> = {};

    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (role !== undefined) {
      const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Ogiltig roll: ${role}` });
      }
      updateData.role = role;
    }
    if (resourceId !== undefined) updateData.resourceId = resourceId;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) {
      updateData.passwordHash = hashPassword(password);
    }

    const user = await storage.updateUser(req.params.id, updateData);
    if (!user) return res.status(404).json({ error: "Användaren hittades inte" });

    if (role !== undefined) {
      const tenantId = (req as any).tenantId;
      if (tenantId) {
        await assignUserToTenant(req.params.id, tenantId, role as UserRole, (req as any).userId);
      }
    }

    const { passwordHash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    console.error("Failed to update user:", error);
    res.status(500).json({ error: "Kunde inte uppdatera användare" });
  }
});

app.delete("/api/admin/users/:id", requireAdminAuth, async (req, res) => {
  try {
    await storage.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ error: "Kunde inte ta bort användare" });
  }
});

// Login with email + password (returns session)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "E-post och lösenord krävs" });
    }

    const { verifyPassword } = await import("./password");
    const user = await storage.getUserByUsername(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Felaktig e-post eller lösenord" });
    }
    if (user.isActive === false) {
      return res.status(403).json({ error: "Kontot är inaktiverat" });
    }

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Felaktig e-post eller lösenord" });
    }

    (req.session as any).userId = user.id;
    (req.session as any).userEmail = user.email;
    (req.session as any).userRole = user.role;

    await storage.updateUser(user.id, { lastLoginAt: new Date() });

    const { passwordHash: _, ...safeUser } = user;
    console.log(`[auth] User "${email}" logged in successfully`);
    res.json({ success: true, user: safeUser });
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({ error: "Inloggning misslyckades" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Inte inloggad" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "Användaren hittades inte" });
    }
    const { passwordHash: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ error: "Kunde inte hämta användardata" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

}
