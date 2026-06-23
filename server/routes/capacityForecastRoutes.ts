import type { Express } from "express";
import { z } from "zod";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

type AutoTableOptions = {
  startY?: number;
  head: (string | number)[][];
  body: (string | number)[][];
  styles?: Record<string, unknown>;
  headStyles?: Record<string, unknown>;
};
type AutoTableJsPDF = jsPDF & {
  autoTable: (opts: AutoTableOptions) => void;
  lastAutoTable: { finalY: number };
};
import OpenAI from "openai";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import {
  computeCapacityForecast,
  computeAndCacheForecast,
  loadCachedForecast,
  generateRebalanceSuggestions,
  FORECAST_WINDOWS,
  type ClusterForecastSummary,
  type RebalanceSuggestion,
  type ForecastWindow,
} from "../services/capacity-forecast-service";
import { trackOpenAIResponse } from "../api-usage-tracker";
import { db } from "../db";
import { tenants } from "@shared/schema";
import { isNull } from "drizzle-orm";
import { dashboardCache, DASHBOARD_CACHE_TTL } from "../services/dashboardCache";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

function parseWindow(value: unknown): ForecastWindow {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  return (FORECAST_WINDOWS as readonly number[]).includes(n) ? (n as ForecastWindow) : 12;
}

function summarize(clusters: ClusterForecastSummary[]) {
  const ranked = [...clusters].sort((a, b) => b.totalGap - a.totalGap);
  const understaffed = ranked.filter(c => c.totalGap > 0).slice(0, 5);
  const overstaffed = ranked.filter(c => c.totalGap < 0).slice(-3).reverse();
  return { understaffed, overstaffed };
}

export async function registerCapacityForecastRoutes(app: Express) {
  app.get("/api/capacity-forecast", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const windowWeeks = parseWindow(req.query.weeks);
    const forceRecompute = req.query.refresh === "true";

    if (forceRecompute) {
      dashboardCache.invalidateTenant(tenantId, "capacity:");
    }

    const payload = await dashboardCache.getOrCompute(
      tenantId,
      `capacity:fc:${windowWeeks}`,
      DASHBOARD_CACHE_TTL.CAPACITY_FORECAST_MS,
      async () => {
        let result = forceRecompute ? null : await loadCachedForecast(tenantId, windowWeeks);
        if (!result) {
          result = await computeAndCacheForecast(tenantId, Math.max(windowWeeks, 26));
          // narrow to the requested window
          result = (await loadCachedForecast(tenantId, windowWeeks)) ?? result;
        }

        const suggestions = generateRebalanceSuggestions(result);
        const { understaffed, overstaffed } = summarize(result.clusters);
        return {
          windowWeeks,
          computedAt: result.computedAt,
          clusters: result.clusters,
          understaffed,
          overstaffed,
          suggestions,
        };
      },
    );

    res.json(payload);
  }));

  app.post("/api/capacity-forecast/recompute", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const windowWeeks = parseWindow(req.body?.weeks ?? req.query.weeks ?? 26);
    // Invalidate first so the freshly computed value below is the one that gets cached
    dashboardCache.invalidateTenant(tenantId, "capacity:");
    const result = await computeAndCacheForecast(tenantId, Math.max(windowWeeks, 26));
    const suggestions = generateRebalanceSuggestions(result);
    const { understaffed, overstaffed } = summarize(result.clusters);
    res.json({
      windowWeeks,
      computedAt: result.computedAt,
      clusters: result.clusters,
      understaffed,
      overstaffed,
      suggestions,
    });
  }));

  app.post("/api/capacity-forecast/ai-summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({ weeks: z.number().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Ogiltiga parametrar");
    const windowWeeks = parseWindow(parsed.data.weeks ?? 12);

    const result = (await loadCachedForecast(tenantId, windowWeeks)) ?? await computeCapacityForecast(tenantId, windowWeeks);
    const suggestions = generateRebalanceSuggestions(result).slice(0, 3);

    if (suggestions.length === 0) {
      return res.json({ summary: "Inga större obalanser hittades — kapacitet och efterfrågan ser balanserad ut för perioden." });
    }

    const promptLines = suggestions.map((s, i) =>
      `${i + 1}. Flytta ca ${s.fteShift} FTE (${s.hours} h) från "${s.fromClusterName}" till "${s.toClusterName}" v.${weekNumber(s.weekStart)}${s.weekStartEnd && s.weekStartEnd !== s.weekStart ? `–v.${weekNumber(s.weekStartEnd)}` : ""}`,
    ).join("\n");

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: "Du är en erfaren kapacitetsplanerare. Skriv koncist och praktiskt på svenska." },
          { role: "user", content: `Sammanfatta dessa topp-3 åtgärder för en planerare i 3-5 meningar med tydlig prioritering:\n\n${promptLines}` },
        ],
        temperature: 0.4,
        max_tokens: 280,
      });
      trackOpenAIResponse(response, tenantId);
      const summary = response.choices[0]?.message?.content?.trim() || "Sammanfattning saknas.";
      res.json({ summary, suggestions });
    } catch (err) {
      console.error("[capacity-forecast/ai-summary] error:", err);
      res.json({ summary: promptLines, suggestions, fallback: true });
    }
  }));

  app.get("/api/capacity-forecast/pdf", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const windowWeeks = parseWindow(req.query.weeks);
    const result = (await loadCachedForecast(tenantId, windowWeeks)) ?? await computeCapacityForecast(tenantId, windowWeeks);
    const suggestions = generateRebalanceSuggestions(result);
    const { understaffed, overstaffed } = summarize(result.clusters);

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.setFontSize(18);
    doc.text("Kapacitetsprognos per kluster", 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Period: ${windowWeeks} veckor  •  Beräknad: ${new Date(result.computedAt).toLocaleString("sv-SE")}`, 14, 25);
    doc.setTextColor(0);

    const overviewBody = result.clusters.map(c => [
      c.clusterName,
      `${c.totalDemand.toFixed(1)}h`,
      `${c.totalCapacity.toFixed(1)}h`,
      `${c.totalGap > 0 ? "+" : ""}${c.totalGap.toFixed(1)}h`,
    ]);
    const pdfDoc = doc as AutoTableJsPDF;
    pdfDoc.autoTable({
      startY: 32,
      head: [["Kluster", "Efterfrågan", "Kapacitet", "Gap"]],
      body: overviewBody,
      headStyles: { fillColor: [59, 130, 246] },
    });

    let y = pdfDoc.lastAutoTable.finalY + 10;
    doc.setFontSize(13);
    doc.text("Mest underbemannade kluster", 14, y);
    y += 4;
    pdfDoc.autoTable({
      startY: y,
      head: [["Kluster", "Total brist (h)"]],
      body: understaffed.map(c => [c.clusterName, `+${c.totalGap.toFixed(1)}h`]),
      headStyles: { fillColor: [239, 68, 68] },
    });
    y = pdfDoc.lastAutoTable.finalY + 6;
    doc.setFontSize(13);
    doc.text("Mest överbemannade kluster", 14, y);
    y += 4;
    pdfDoc.autoTable({
      startY: y,
      head: [["Kluster", "Totalt överskott (h)"]],
      body: overstaffed.map(c => [c.clusterName, `${Math.abs(c.totalGap).toFixed(1)}h`]),
      headStyles: { fillColor: [34, 197, 94] },
    });

    if (suggestions.length > 0) {
      y = pdfDoc.lastAutoTable.finalY + 8;
      doc.setFontSize(13);
      doc.text("Föreslagna omflyttningar", 14, y);
      y += 4;
      pdfDoc.autoTable({
        startY: y,
        head: [["Från", "Till", "Veckor", "FTE", "Timmar"]],
        body: suggestions.map(s => [
          s.fromClusterName,
          s.toClusterName,
          s.weekStartEnd && s.weekStartEnd !== s.weekStart
            ? `v.${weekNumber(s.weekStart)}–v.${weekNumber(s.weekStartEnd)}`
            : `v.${weekNumber(s.weekStart)}`,
          s.fteShift.toFixed(2),
          `${s.hours.toFixed(1)}h`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [100, 116, 139] },
      });
    }

    const pdfBytes = Buffer.from(doc.output("arraybuffer"));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="kapacitetsprognos-${windowWeeks}v.pdf"`);
    res.send(pdfBytes);
  }));
}

function weekNumber(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

class CapacityForecastScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private intervalMs = 24 * 60 * 60 * 1000;

  start() {
    if (this.intervalId) return;
    console.log("[capacity-forecast-scheduler] Started (runs daily)");
    this.intervalId = setInterval(() => this.runAll(), this.intervalMs);
    setTimeout(() => this.runAll(), 5 * 60 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runAll() {
    try {
      const tenantList = await db.select({ id: tenants.id }).from(tenants).where(isNull(tenants.deletedAt));
      for (const t of tenantList) {
        try {
          await computeAndCacheForecast(t.id, 26);
          console.log(`[capacity-forecast-scheduler] Tenant ${t.id}: forecast updated`);
        } catch (err) {
          console.error(`[capacity-forecast-scheduler] Tenant ${t.id} failed:`, err);
        }
      }
    } catch (err) {
      console.error("[capacity-forecast-scheduler] Fatal:", err);
    }
  }
}

export const capacityForecastScheduler = new CapacityForecastScheduler();
