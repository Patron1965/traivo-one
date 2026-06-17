// ============================================
// Task #558: Fakturakö + konsoliderings-policy routes
// ============================================
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { storage } from "../storage";
import { asyncHandler } from "../asyncHandler";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { NotFoundError, ValidationError } from "../errors";
import { formatZodError } from "./helpers";
import {
  workOrders,
  customerInvoices,
  invoiceRecipients,
  customers,
  objects,
  metadataKatalog,
  insertInvoiceConsolidationPolicySchema,
  INVOICE_CONSOLIDATION_PERIODS,
} from "@shared/schema";
import {
  markWorkOrderReadyForInvoice,
  runConsolidationForTenant,
} from "../services/invoice-consolidation";
import {
  getInvoiceFlowConfig,
  setInvoiceFlowConfig,
  computeBillingSegmentsForSubtree,
  EMPTY_SEGMENT,
  type BillingSegment,
} from "../services/invoice-flow-segmentation";
import { inArray } from "drizzle-orm";
import { exportConsolidatedInvoiceToFortnox } from "../fortnox-client";

const policyInputSchema = insertInvoiceConsolidationPolicySchema
  .extend({
    period: z.enum(INVOICE_CONSOLIDATION_PERIODS),
    periodAnchor: z.number().int().nullable().optional(),
    releaseAtHour: z.number().int().min(0).max(23).nullable().optional(),
  })
  .refine(
    (v) => Boolean(v.customerId) || Boolean(v.invoiceRecipientId),
    { message: "Antingen customerId eller invoiceRecipientId måste sättas" },
  );

export function registerInvoiceQueueRoutes(app: Express): void {
  // --- Fakturakö: lista held WOs grupperade per mottagare/kund ---
  app.get("/api/invoice-queue", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const state = (req.query.state as string) || "held";
    if (!["held", "pending", "consolidated", "exported"].includes(state)) {
      throw new ValidationError("Ogiltigt state-filter");
    }

    const rows = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        customerId: workOrders.customerId,
        customerName: customers.name,
        frozenInvoiceRecipientId: workOrders.frozenInvoiceRecipientId,
        recipientName: invoiceRecipients.recipientName,
        recipientLevel: invoiceRecipients.level,
        invoiceQueueState: workOrders.invoiceQueueState,
        invoiceHeldUntil: workOrders.invoiceHeldUntil,
        invoiceReadyAt: workOrders.invoiceReadyAt,
        consolidationInvoiceId: workOrders.consolidationInvoiceId,
        frozenUnitPrice: workOrders.frozenUnitPrice,
        frozenQuantity: workOrders.frozenQuantity,
        cachedValue: workOrders.cachedValue,
        scheduledDate: workOrders.scheduledDate,
      })
      .from(workOrders)
      .leftJoin(customers, eq(workOrders.customerId, customers.id))
      .leftJoin(invoiceRecipients, eq(workOrders.frozenInvoiceRecipientId, invoiceRecipients.id))
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.invoiceQueueState, state),
        isNull(workOrders.deletedAt),
      ))
      .orderBy(workOrders.invoiceHeldUntil);

    // Gruppera i Node: per recipient (om finns) annars per customer.
    type Group = {
      key: string;
      recipientId: string | null;
      recipientName: string | null;
      recipientLevel: string | null;
      customerId: string | null;
      customerName: string | null;
      heldUntil: Date | null;
      workOrders: typeof rows;
      totalAmount: number;
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const key = r.frozenInvoiceRecipientId
        ? `r:${r.frozenInvoiceRecipientId}`
        : `c:${r.customerId ?? "_"}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          recipientId: r.frozenInvoiceRecipientId,
          recipientName: r.recipientName ?? null,
          recipientLevel: r.recipientLevel ?? null,
          customerId: r.customerId,
          customerName: r.customerName ?? null,
          heldUntil: r.invoiceHeldUntil,
          workOrders: [],
          totalAmount: 0,
        });
      }
      const g = groups.get(key)!;
      g.workOrders.push(r);
      const price = Number(r.frozenUnitPrice ?? 0);
      const qty = Number(r.frozenQuantity ?? 0);
      const amount = price > 0 && qty > 0 ? Math.round(price * qty) : Math.round(Number(r.cachedValue ?? 0));
      g.totalAmount += amount;
      if (r.invoiceHeldUntil && (!g.heldUntil || new Date(r.invoiceHeldUntil) < g.heldUntil)) {
        g.heldUntil = r.invoiceHeldUntil;
      }
    }

    res.json({
      state,
      groups: Array.from(groups.values()).sort((a, b) => {
        const ah = a.heldUntil ? new Date(a.heldUntil).getTime() : Infinity;
        const bh = b.heldUntil ? new Date(b.heldUntil).getTime() : Infinity;
        return ah - bh;
      }),
      totalWorkOrders: rows.length,
    });
  }));

  // --- Släpp nu: tvinga konsolidering för en mottagare/kund eller hela tenant ---
  app.post("/api/invoice-queue/release", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      recipientId: z.string().optional(),
      customerId: z.string().optional(),
      reason: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);

    const userId = (req as any).user?.claims?.sub ?? null;
    const result = await runConsolidationForTenant(tenantId, {
      now: new Date(),
      onlyRecipientId: parsed.data.recipientId ?? null,
      onlyCustomerId: parsed.data.customerId ?? null,
      force: true,
      releasedBy: userId,
      releasedReason: parsed.data.reason ?? "Manuell släpp via Fakturakö",
    });
    res.json({ released: true, ...result });
  }));

  // --- Markera WO som redo att fakturera (sätter held/pending baserat på policy) ---
  app.post("/api/work-orders/:id/mark-ready-to-invoice", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const wo = await storage.getWorkOrder(req.params.id);
    if (!wo || wo.tenantId !== tenantId) throw new NotFoundError("Arbetsorder hittades inte");
    const result = await markWorkOrderReadyForInvoice(req.params.id, tenantId);
    res.json(result);
  }));

  // --- Konsoliderings-policy CRUD ---
  app.get("/api/invoice-consolidation-policies", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const customerId = (req.query.customerId as string) || undefined;
    const recipientId = (req.query.recipientId as string) || undefined;
    const activeOnly = req.query.activeOnly === "true";
    const list = await storage.listInvoiceConsolidationPolicies(tenantId, { customerId, recipientId, activeOnly });
    res.json(list);
  }));

  app.post("/api/invoice-consolidation-policies", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = policyInputSchema.safeParse({ ...req.body, tenantId });
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    // Tenant-ownership check: om recipientId/customerId satta — kontrollera att de hör hemma.
    if (parsed.data.invoiceRecipientId) {
      const rec = await storage.getInvoiceRecipient(tenantId, parsed.data.invoiceRecipientId);
      if (!rec) throw new ValidationError("invoiceRecipientId hör inte till denna tenant");
    }
    if (parsed.data.customerId) {
      const [cust] = await db.select({ id: customers.id }).from(customers).where(and(
        eq(customers.id, parsed.data.customerId),
        eq(customers.tenantId, tenantId),
      ));
      if (!cust) throw new ValidationError("customerId hör inte till denna tenant");
    }
    const created = await storage.createInvoiceConsolidationPolicy(parsed.data);
    res.status(201).json(created);
  }));

  app.patch("/api/invoice-consolidation-policies/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getInvoiceConsolidationPolicy(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Policy hittades inte");
    const patchSchema = insertInvoiceConsolidationPolicySchema
      .extend({
        period: z.enum(INVOICE_CONSOLIDATION_PERIODS).optional(),
        periodAnchor: z.number().int().nullable().optional(),
        releaseAtHour: z.number().int().min(0).max(23).nullable().optional(),
      })
      .partial();
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    const updated = await storage.updateInvoiceConsolidationPolicy(tenantId, req.params.id, parsed.data as any);
    res.json(updated);
  }));

  app.delete("/api/invoice-consolidation-policies/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getInvoiceConsolidationPolicy(tenantId, req.params.id);
    if (!existing) throw new NotFoundError("Policy hittades inte");
    await storage.deleteInvoiceConsolidationPolicy(tenantId, req.params.id);
    res.json({ deleted: true });
  }));

  // --- Exportera en konsoliderad faktura till Fortnox ---
  // Detta är den kanoniska export-vägen för samlingsfakturor: WOs i state
  // "consolidated" får INTE exporteras enskilt via /api/fortnox/exports/:id/process.
  app.post("/api/invoice-queue/consolidated/:id/export", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [invoice] = await db
      .select({ id: customerInvoices.id, tenantId: customerInvoices.tenantId })
      .from(customerInvoices)
      .where(and(
        eq(customerInvoices.id, req.params.id),
        eq(customerInvoices.tenantId, tenantId),
      ));
    if (!invoice) throw new NotFoundError("Konsoliderad faktura hittades inte");
    const result = await exportConsolidatedInvoiceToFortnox(tenantId, req.params.id);
    if (!result.success) throw new ValidationError(result.error ?? "Export misslyckades");
    res.json(result);
  }));

  // --- Konsoliderade fakturor (för admin-listning) ---
  app.get("/api/invoice-queue/consolidated", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rows = await db
      .select({
        id: customerInvoices.id,
        invoiceNumber: customerInvoices.invoiceNumber,
        invoiceDate: customerInvoices.invoiceDate,
        amount: customerInvoices.amount,
        totalAmount: customerInvoices.totalAmount,
        state: customerInvoices.state,
        customerId: customerInvoices.customerId,
        customerName: customers.name,
        invoiceRecipientId: customerInvoices.invoiceRecipientId,
        recipientName: invoiceRecipients.recipientName,
        consolidationPeriodStart: customerInvoices.consolidationPeriodStart,
        consolidationPeriodEnd: customerInvoices.consolidationPeriodEnd,
        workOrderIds: customerInvoices.workOrderIds,
        releasedAt: customerInvoices.releasedAt,
        releasedReason: customerInvoices.releasedReason,
      })
      .from(customerInvoices)
      .leftJoin(customers, eq(customerInvoices.customerId, customers.id))
      .leftJoin(invoiceRecipients, eq(customerInvoices.invoiceRecipientId, invoiceRecipients.id))
      .where(and(
        eq(customerInvoices.tenantId, tenantId),
        eq(customerInvoices.state, "consolidated"),
      ))
      .orderBy(desc(customerInvoices.invoiceDate))
      .limit(200);
    res.json(rows);
  }));

  // ============================================
  // Task #970: Metadatastyrd fakturaflödeslogik — config + förhandsvisning
  // ============================================

  // --- Hämta invoice-flow-config + tillgängliga metadatafält (för dropdowns) ---
  app.get("/api/invoice-flow/config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const config = await getInvoiceFlowConfig(tenantId);
    const fields = await db
      .select({ id: metadataKatalog.id, namn: metadataKatalog.namn, datatyp: metadataKatalog.datatyp })
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, tenantId), isNull(metadataKatalog.deletedAt)))
      .orderBy(metadataKatalog.namn);
    res.json({ config, availableFields: fields });
  }));

  // --- Uppdatera invoice-flow-config (skriver tenants.settings.invoiceFlow) ---
  app.put("/api/invoice-flow/config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      enabled: z.boolean().optional(),
      breakFieldName: z.string().trim().min(1).max(100).optional(),
      // null/"" ⇒ stäng av gruppering; sträng ⇒ använd det fältet.
      groupingFieldName: z.string().trim().max(100).nullable().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    const patch: Record<string, unknown> = {};
    if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
    if (parsed.data.breakFieldName !== undefined) patch.breakFieldName = parsed.data.breakFieldName;
    if (parsed.data.groupingFieldName !== undefined) {
      patch.groupingFieldName = parsed.data.groupingFieldName
        ? parsed.data.groupingFieldName
        : null;
    }
    const config = await setInvoiceFlowConfig(tenantId, patch);
    res.json({ config });
  }));

  // --- Förhandsvisning: hur skulle fakturorna delas upp för ett objektsubträd? ---
  // Beräknar segment LIVE från aktuell metadata (kan avvika från frusna WO-värden
  // — det är meningen). Tvingar enabled=true i beräkningen så admin ser effekten
  // även innan funktionen slås på; svaret innehåller `enabled` för UI-varning.
  app.get("/api/invoice-flow/preview", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rootObjectId = (req.query.rootObjectId as string) || "";
    if (!rootObjectId) throw new ValidationError("rootObjectId krävs");

    // Tenant-ownership: roten måste tillhöra denna tenant (aldrig lita på klient-id).
    const [root] = await db
      .select({ id: objects.id, name: objects.name })
      .from(objects)
      .where(and(eq(objects.id, rootObjectId), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
    if (!root) throw new NotFoundError("Objekt hittades inte");

    const config = await getInvoiceFlowConfig(tenantId);
    const subtreeIds = await storage.getObjectSubtreeIds(tenantId, rootObjectId);
    if (subtreeIds.length === 0) {
      return res.json({ enabled: config.enabled, config, root, groups: [], totalWorkOrders: 0 });
    }

    // Segment per objekt (LIVE), tvinga enabled så förhandsvisningen alltid visar effekten.
    const segments = await computeBillingSegmentsForSubtree(
      tenantId,
      rootObjectId,
      { ...config, enabled: true },
    );

    // Fakturerbara WO i subträdet (oberoende av köstatus → meningsfull även innan
    // något frysts). Måste ha kund eller frusen mottagare för att kunna fakturera.
    const wos = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        objectId: workOrders.objectId,
        customerId: workOrders.customerId,
        customerName: customers.name,
        frozenInvoiceRecipientId: workOrders.frozenInvoiceRecipientId,
        recipientName: invoiceRecipients.recipientName,
        invoiceQueueState: workOrders.invoiceQueueState,
        frozenUnitPrice: workOrders.frozenUnitPrice,
        frozenQuantity: workOrders.frozenQuantity,
        cachedValue: workOrders.cachedValue,
      })
      .from(workOrders)
      .leftJoin(customers, and(eq(workOrders.customerId, customers.id), eq(customers.tenantId, tenantId)))
      .leftJoin(
        invoiceRecipients,
        and(
          eq(workOrders.frozenInvoiceRecipientId, invoiceRecipients.id),
          eq(invoiceRecipients.tenantId, tenantId),
        ),
      )
      .where(and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, subtreeIds),
        isNull(workOrders.deletedAt),
      ));

    type PreviewGroup = {
      key: string;
      recipientId: string | null;
      recipientName: string | null;
      customerId: string | null;
      customerName: string | null;
      segmentKey: string | null;
      breakObjectId: string | null;
      breakObjectName: string | null;
      groupingFieldName: string | null;
      groupingValue: string | null;
      workOrderCount: number;
      totalAmount: number;
    };
    const groups = new Map<string, PreviewGroup>();
    let billable = 0;
    for (const w of wos) {
      // Endast fakturerbara: måste kunna landa på en faktura (mottagare eller kund).
      if (!w.frozenInvoiceRecipientId && !w.customerId) continue;
      billable++;
      const seg: BillingSegment = segments.get(w.objectId) ?? EMPTY_SEGMENT;
      const baseKey = w.frozenInvoiceRecipientId
        ? `r:${w.frozenInvoiceRecipientId}`
        : `c:${w.customerId ?? "_"}`;
      const segKey = seg.segmentKey ?? "";
      const key = `${baseKey}|${segKey}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          recipientId: w.frozenInvoiceRecipientId,
          recipientName: w.recipientName ?? null,
          customerId: w.customerId,
          customerName: w.customerName ?? null,
          segmentKey: seg.segmentKey,
          breakObjectId: seg.breakObjectId,
          breakObjectName: null,
          groupingFieldName: seg.groupingFieldName,
          groupingValue: seg.groupingValue,
          workOrderCount: 0,
          totalAmount: 0,
        });
      }
      const g = groups.get(key)!;
      g.workOrderCount++;
      const price = Number(w.frozenUnitPrice ?? 0);
      const qty = Number(w.frozenQuantity ?? 0);
      const amount = price > 0 && qty > 0 ? Math.round(price * qty) : Math.round(Number(w.cachedValue ?? 0));
      g.totalAmount += amount;
    }

    // Slå upp namn på brytpunkts-objekten för läsbar visning.
    const breakIds = Array.from(
      new Set(Array.from(groups.values()).map(g => g.breakObjectId).filter((x): x is string => !!x)),
    );
    if (breakIds.length > 0) {
      const breakObjs = await db
        .select({ id: objects.id, name: objects.name })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, breakIds)));
      const nameById = new Map(breakObjs.map(o => [o.id, o.name]));
      for (const g of groups.values()) {
        if (g.breakObjectId) g.breakObjectName = nameById.get(g.breakObjectId) ?? null;
      }
    }

    res.json({
      enabled: config.enabled,
      config,
      root,
      groups: Array.from(groups.values()).sort((a, b) => b.totalAmount - a.totalAmount),
      totalWorkOrders: billable,
    });
  }));
}
