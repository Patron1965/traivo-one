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
  insertInvoiceConsolidationPolicySchema,
  INVOICE_CONSOLIDATION_PERIODS,
} from "@shared/schema";
import {
  markWorkOrderReadyForInvoice,
  runConsolidationForTenant,
} from "../services/invoice-consolidation";
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
}
