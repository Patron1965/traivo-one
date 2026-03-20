import type { Express } from "express";
import { db } from "../db";
import { eq, and, gte, lte, isNull, sql, desc, asc, inArray } from "drizzle-orm";
import { z } from "zod";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { predictiveForecasts, iotSignals, iotDevices, objects, customers, workOrders } from "@shared/schema";
import OpenAI from "openai";
import { trackOpenAIResponse } from "../api-usage-tracker";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface SignalHistory {
  objectId: string;
  objectName: string;
  customerName: string | null;
  deviceId: string;
  deviceType: string;
  signals: { signalType: string; createdAt: Date }[];
  completedOrders: { scheduledDate: Date }[];
}

function computeBaselineForecast(signals: { createdAt: Date }[], now: Date): { avgIntervalDays: number; predictedDate: Date; confidence: number } | null {
  if (signals.length < 2) return null;

  const sorted = [...signals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const diffMs = sorted[i].createdAt.getTime() - sorted[i - 1].createdAt.getTime();
    intervals.push(diffMs / (1000 * 60 * 60 * 24));
  }

  const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const variance = intervals.reduce((s, v) => s + Math.pow(v - avgInterval, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const cv = avgInterval > 0 ? stdDev / avgInterval : 1;

  let confidence = 0.9;
  if (signals.length < 5) confidence -= 0.2;
  if (signals.length < 3) confidence -= 0.2;
  if (cv > 0.5) confidence -= 0.2;
  if (cv > 1.0) confidence -= 0.2;
  confidence = Math.max(0.1, Math.min(1.0, confidence));

  const lastSignal = sorted[sorted.length - 1];
  const daysSinceLast = (now.getTime() - lastSignal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const daysUntilNext = Math.max(0, avgInterval - daysSinceLast);
  const predictedDate = new Date(now.getTime() + daysUntilNext * 24 * 60 * 60 * 1000);

  return { avgIntervalDays: Math.round(avgInterval * 10) / 10, predictedDate, confidence: Math.round(confidence * 100) / 100 };
}

export async function registerPredictiveRoutes(app: Express) {

  app.post("/api/predictive/analyze", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      monthsBack: z.number().min(1).max(24).default(12),
      useAI: z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Ogiltiga parametrar");
    const { monthsBack, useAI } = parsed.data;

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
    const now = new Date();

    const devices = await db
      .select({
        deviceId: iotDevices.id,
        objectId: iotDevices.objectId,
        deviceType: iotDevices.deviceType,
        objectName: objects.name,
        customerName: customers.name,
      })
      .from(iotDevices)
      .innerJoin(objects, eq(objects.id, iotDevices.objectId))
      .leftJoin(customers, eq(customers.id, objects.customerId))
      .where(and(
        eq(iotDevices.tenantId, tenantId),
        eq(iotDevices.status, "active"),
      ));

    if (devices.length === 0) {
      return res.json({ forecasts: [], summary: "Inga aktiva IoT-enheter hittades.", dataQuality: "low" });
    }

    const deviceIds = devices.map(d => d.deviceId);
    const actionableSignalTypes = ["full", "damaged", "overflow", "tilt", "fire"];

    const allSignals = await db
      .select({
        deviceId: iotSignals.deviceId,
        signalType: iotSignals.signalType,
        createdAt: iotSignals.createdAt,
      })
      .from(iotSignals)
      .where(and(
        eq(iotSignals.tenantId, tenantId),
        inArray(iotSignals.deviceId, deviceIds),
        gte(iotSignals.createdAt, cutoffDate),
        inArray(iotSignals.signalType, actionableSignalTypes),
      ))
      .orderBy(asc(iotSignals.createdAt));

    const objectIds = [...new Set(devices.map(d => d.objectId))];
    const completedOrders = objectIds.length > 0 ? await db
      .select({
        objectId: workOrders.objectId,
        scheduledDate: workOrders.scheduledDate,
      })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, objectIds),
        eq(workOrders.executionStatus, "completed"),
        gte(workOrders.scheduledDate, cutoffDate),
      )) : [];

    const signalsByDevice = new Map<string, { signalType: string; createdAt: Date }[]>();
    for (const s of allSignals) {
      if (!signalsByDevice.has(s.deviceId)) signalsByDevice.set(s.deviceId, []);
      signalsByDevice.get(s.deviceId)!.push({ signalType: s.signalType, createdAt: s.createdAt });
    }

    const ordersByObject = new Map<string, { scheduledDate: Date }[]>();
    for (const o of completedOrders) {
      if (!o.objectId || !o.scheduledDate) continue;
      if (!ordersByObject.has(o.objectId)) ordersByObject.set(o.objectId, []);
      ordersByObject.get(o.objectId)!.push({ scheduledDate: o.scheduledDate });
    }

    const histories: SignalHistory[] = devices.map(d => ({
      objectId: d.objectId,
      objectName: d.objectName,
      customerName: d.customerName,
      deviceId: d.deviceId,
      deviceType: d.deviceType,
      signals: signalsByDevice.get(d.deviceId) || [],
      completedOrders: ordersByObject.get(d.objectId) || [],
    }));

    const forecasts: Array<{
      objectId: string;
      objectName: string;
      customerName: string | null;
      deviceId: string;
      deviceType: string;
      predictedDate: string;
      daysUntilService: number;
      confidence: number;
      confidenceLevel: "high" | "medium" | "low";
      avgIntervalDays: number;
      signalCount: number;
      lastSignalAt: string | null;
      reasoning: string;
    }> = [];

    const aiInputs: Array<{ objectName: string; deviceType: string; signalCount: number; avgIntervalDays: number; signals: string[] }> = [];

    for (const h of histories) {
      if (h.signals.length < 2) continue;

      const baseline = computeBaselineForecast(h.signals, now);
      if (!baseline) continue;

      const daysUntil = Math.round((baseline.predictedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const lastSig = h.signals[h.signals.length - 1];
      const confLevel = baseline.confidence >= 0.7 ? "high" : baseline.confidence >= 0.4 ? "medium" : "low";

      forecasts.push({
        objectId: h.objectId,
        objectName: h.objectName,
        customerName: h.customerName,
        deviceId: h.deviceId,
        deviceType: h.deviceType,
        predictedDate: baseline.predictedDate.toISOString(),
        daysUntilService: daysUntil,
        confidence: baseline.confidence,
        confidenceLevel: confLevel,
        avgIntervalDays: baseline.avgIntervalDays,
        signalCount: h.signals.length,
        lastSignalAt: lastSig?.createdAt?.toISOString() || null,
        reasoning: `Baserat p\u00e5 ${h.signals.length} signaler med snittintervall ${baseline.avgIntervalDays} dagar.`,
      });

      if (useAI && h.signals.length >= 3) {
        aiInputs.push({
          objectName: h.objectName,
          deviceType: h.deviceType,
          signalCount: h.signals.length,
          avgIntervalDays: baseline.avgIntervalDays,
          signals: h.signals.slice(-10).map(s => `${s.signalType} @ ${s.createdAt.toISOString().split("T")[0]}`),
        });
      }
    }

    let aiSummary = "";
    if (useAI && aiInputs.length > 0) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Du \u00e4r en AI-expert p\u00e5 prediktivt underh\u00e5ll f\u00f6r avfallshantering. Analysera IoT-signalm\u00f6nster och ge en kort sammanfattning p\u00e5 svenska (max 200 ord). Identifiera m\u00f6nster som s\u00e4songsvariation, accelererande frekvenser, eller objekt som beh\u00f6ver extra uppm\u00e4rksamhet.",
            },
            {
              role: "user",
              content: `Analysera dessa IoT-objekt och deras signalhistorik:\n${JSON.stringify(aiInputs.slice(0, 20), null, 2)}\n\nGe en sammanfattning av m\u00f6nster och rekommendationer.`,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        });
        aiSummary = response.choices[0]?.message?.content || "";
        await trackOpenAIResponse("predictive-maintenance", response);

        if (aiSummary) {
          for (const f of forecasts) {
            const aiInput = aiInputs.find(a => a.objectName === f.objectName);
            if (aiInput) {
              f.reasoning = `AI-analys baserad p\u00e5 ${f.signalCount} signaler. Snittintervall: ${f.avgIntervalDays} dagar.`;
            }
          }
        }
      } catch (err) {
        console.error("[predictive] AI analysis failed, using baseline only:", err);
      }
    }

    forecasts.sort((a, b) => a.daysUntilService - b.daysUntilService);

    await db.delete(predictiveForecasts).where(eq(predictiveForecasts.tenantId, tenantId));
    if (forecasts.length > 0) {
      await db.insert(predictiveForecasts).values(
        forecasts.map(f => ({
          tenantId,
          objectId: f.objectId,
          deviceId: f.deviceId,
          predictedDate: new Date(f.predictedDate),
          confidence: f.confidence,
          avgIntervalDays: f.avgIntervalDays,
          signalCount: f.signalCount,
          lastSignalAt: f.lastSignalAt ? new Date(f.lastSignalAt) : null,
          reasoning: f.reasoning,
          status: "active" as const,
        }))
      );
    }

    const urgent = forecasts.filter(f => f.daysUntilService <= 7).length;
    const upcoming = forecasts.filter(f => f.daysUntilService > 7 && f.daysUntilService <= 30).length;
    const dataQuality = forecasts.length === 0 ? "low" : forecasts.filter(f => f.confidenceLevel === "high").length > forecasts.length / 2 ? "high" : "medium";

    const summary = aiSummary || `${forecasts.length} objekt analyserade. ${urgent} beh\u00f6ver service inom 7 dagar, ${upcoming} inom 30 dagar.`;

    res.json({
      forecasts,
      summary,
      dataQuality,
      totalDevices: devices.length,
      analyzedObjects: forecasts.length,
      urgentCount: urgent,
      upcomingCount: upcoming,
    });
  }));

  app.get("/api/predictive/forecasts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const cached = await db
      .select({
        id: predictiveForecasts.id,
        objectId: predictiveForecasts.objectId,
        objectName: objects.name,
        customerName: customers.name,
        deviceId: predictiveForecasts.deviceId,
        predictedDate: predictiveForecasts.predictedDate,
        confidence: predictiveForecasts.confidence,
        avgIntervalDays: predictiveForecasts.avgIntervalDays,
        signalCount: predictiveForecasts.signalCount,
        lastSignalAt: predictiveForecasts.lastSignalAt,
        reasoning: predictiveForecasts.reasoning,
        updatedAt: predictiveForecasts.updatedAt,
      })
      .from(predictiveForecasts)
      .innerJoin(objects, eq(objects.id, predictiveForecasts.objectId))
      .leftJoin(customers, eq(customers.id, objects.customerId))
      .where(and(
        eq(predictiveForecasts.tenantId, tenantId),
        eq(predictiveForecasts.status, "active"),
      ))
      .orderBy(asc(predictiveForecasts.predictedDate));

    const now = new Date();
    const enriched = cached.map(f => {
      const daysUntil = Math.round((new Date(f.predictedDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        ...f,
        daysUntilService: daysUntil,
        confidenceLevel: (f.confidence >= 0.7 ? "high" : f.confidence >= 0.4 ? "medium" : "low") as "high" | "medium" | "low",
      };
    });

    res.json(enriched);
  }));

  app.post("/api/predictive/create-order", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      objectId: z.string(),
      scheduledDate: z.string(),
      description: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Ogiltiga parametrar");

    const { objectId, scheduledDate, description } = parsed.data;

    const [obj] = await db.select({ name: objects.name, customerId: objects.customerId, address: objects.address })
      .from(objects).where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
    if (!obj) throw new ValidationError("Objekt hittades inte");

    const [order] = await db.insert(workOrders).values({
      tenantId,
      objectId,
      customerId: obj.customerId,
      address: obj.address,
      scheduledDate: new Date(scheduledDate),
      description: description || `Prediktivt underh\u00e5ll \u2014 ${obj.name}`,
      status: "scheduled",
      executionStatus: "pending",
      source: "predictive",
      metadata: { generatedBy: "predictive-maintenance", analyzedAt: new Date().toISOString() },
    }).returning({ id: workOrders.id });

    res.json({ orderId: order.id, message: "Arbetsorder skapad fr\u00e5n prediktiv analys" });
  }));

}
