// Task #566 — Massimport av betalare (object_payers) och fakturamottagare (invoice_recipients).
// Mönstret följer /api/objects/:parentId/import-children (dryRun → commit, batch-id i import_batches).
import type { Express } from "express";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { db } from "../db";
import {
  objects,
  customers,
  objectPayers,
  invoiceRecipients,
  importBatches,
  INVOICE_RECIPIENT_LEVELS,
} from "@shared/schema";
import { formatZodError } from "./helpers";

// === Hjälpare ==============================================================

function parseDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return null;
  // Tillåt YYYY-MM-DD eller ISO
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function rangesOverlap(aFrom: Date | null, aTo: Date | null, bFrom: Date | null, bTo: Date | null): boolean {
  // Open-ended ranges (NULL) tolkas som oändligheter åt det hållet.
  const aStart = aFrom ? aFrom.getTime() : -Infinity;
  const aEnd = aTo ? aTo.getTime() : Infinity;
  const bStart = bFrom ? bFrom.getTime() : -Infinity;
  const bEnd = bTo ? bTo.getTime() : Infinity;
  return aStart <= bEnd && bStart <= aEnd;
}

// === Betalare (object_payers) ==============================================

const payerRowSchema = z.object({
  objectNumber: z.string().min(1, "objectNumber krävs"),
  customerNumber: z.string().min(1, "customerNumber krävs"),
  payerType: z.enum(["primary", "secondary", "split"]).optional(),
  isPrimary: z.boolean().optional(),
  sharePercent: z.number().int().min(1).max(100).optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  invoiceReference: z.string().max(200).optional(),
  fortnoxCustomerId: z.string().max(64).optional(),
  notes: z.string().max(1000).optional(),
});

const importPayersSchema = z.object({
  rows: z.array(payerRowSchema).min(1).max(2000),
  dryRun: z.boolean().optional(),
  batchId: z.string().min(1).max(100).optional(),
});

// === Fakturamottagare (invoice_recipients) =================================

const recipientRowSchema = z.object({
  customerNumber: z.string().min(1, "customerNumber krävs"),
  level: z.enum(INVOICE_RECIPIENT_LEVELS),
  recipientName: z.string().min(1).max(200),
  recipientEmail: z.string().email().optional().or(z.literal("")),
  recipientAddress: z.string().max(200).optional(),
  recipientPostalCode: z.string().max(20).optional(),
  recipientCity: z.string().max(120).optional(),
  recipientReference: z.string().max(120).optional(),
  fortnoxCustomerId: z.string().max(64).optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  breaksInheritance: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

const importRecipientsSchema = z.object({
  rows: z.array(recipientRowSchema).min(1).max(2000),
  dryRun: z.boolean().optional(),
  batchId: z.string().min(1).max(100).optional(),
});

type RowError = { index: number; message: string };

export function registerImportPayersRoutes(app: Express): void {
  // ========================================================================
  // POST /api/object-payers/import
  // ========================================================================
  app.post("/api/object-payers/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = importPayersSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).error);
    }
    const { rows, dryRun = false, batchId: providedBatchId } = parsed.data;
    const batchId = providedBatchId ?? `import-payers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // --- Idempotens: om batchId redan finns, returnera det tidigare resultatet ---
    if (providedBatchId && !dryRun) {
      const [existing] = await db.select().from(importBatches)
        .where(and(eq(importBatches.batchId, providedBatchId), eq(importBatches.tenantId, tenantId)));
      if (existing) {
        return res.json({
          dryRun: false,
          batchId,
          idempotent: true,
          created: existing.created ?? 0,
          errors: [],
        });
      }
    }

    // --- Lookups: unika objektnummer + kundnummer ---
    const objectNumbers = Array.from(new Set(rows.map(r => r.objectNumber)));
    const customerNumbers = Array.from(new Set(rows.map(r => r.customerNumber)));

    const [objectRows, customerRows] = await Promise.all([
      db.select({ id: objects.id, objectNumber: objects.objectNumber })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, objectNumbers))),
      db.select({ id: customers.id, customerNumber: customers.customerNumber })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), inArray(customers.customerNumber, customerNumbers))),
    ]);

    const objectByNumber = new Map(objectRows.filter(o => o.objectNumber).map(o => [o.objectNumber!, o.id]));
    const customerByNumber = new Map(customerRows.filter(c => c.customerNumber).map(c => [c.customerNumber!, c.id]));

    // --- Hämta befintliga primary-betalare för alla berörda objekt (för överlappskontroll) ---
    const matchedObjectIds = Array.from(new Set(rows
      .map(r => objectByNumber.get(r.objectNumber))
      .filter((v): v is string => !!v)));

    const existingPrimaries = matchedObjectIds.length > 0
      ? await db.select({
          objectId: objectPayers.objectId,
          validFrom: objectPayers.validFrom,
          validTo: objectPayers.validTo,
        })
        .from(objectPayers)
        .where(and(
          eq(objectPayers.tenantId, tenantId),
          eq(objectPayers.isPrimary, true),
          inArray(objectPayers.objectId, matchedObjectIds),
        ))
      : [];

    const existingPrimariesByObject = new Map<string, Array<{ validFrom: Date | null; validTo: Date | null }>>();
    for (const ep of existingPrimaries) {
      const list = existingPrimariesByObject.get(ep.objectId) ?? [];
      list.push({ validFrom: ep.validFrom ?? null, validTo: ep.validTo ?? null });
      existingPrimariesByObject.set(ep.objectId, list);
    }

    // --- Validera och bygg insert-rader ---
    const errors: RowError[] = [];
    const inserts: Array<typeof objectPayers.$inferInsert> = [];
    const preview: Array<{ index: number; objectNumber: string; customerNumber: string; payerType: string; isPrimary: boolean }> = [];

    // För att hitta överlapp *inom* uppladdningen samlar vi periodvis per objekt.
    const pendingPrimariesByObject = new Map<string, Array<{ from: Date | null; to: Date | null; index: number }>>();

    rows.forEach((r, i) => {
      const objectId = objectByNumber.get(r.objectNumber);
      if (!objectId) {
        errors.push({ index: i, message: `Objektnummer "${r.objectNumber}" hittades inte` });
        return;
      }
      const customerId = customerByNumber.get(r.customerNumber);
      if (!customerId) {
        errors.push({ index: i, message: `Kundnummer "${r.customerNumber}" hittades inte` });
        return;
      }
      const payerType = r.payerType ?? "primary";
      const isPrimary = r.isPrimary ?? (payerType === "primary");
      const validFrom = parseDate(r.validFrom);
      const validTo = parseDate(r.validTo);
      if (r.validFrom && !validFrom) {
        errors.push({ index: i, message: `Ogiltigt validFrom "${r.validFrom}"` });
        return;
      }
      if (r.validTo && !validTo) {
        errors.push({ index: i, message: `Ogiltigt validTo "${r.validTo}"` });
        return;
      }
      if (validFrom && validTo && validFrom.getTime() > validTo.getTime()) {
        errors.push({ index: i, message: `validFrom är efter validTo` });
        return;
      }

      // Överlappskontroll: bara för primary
      if (isPrimary) {
        const existing = existingPrimariesByObject.get(objectId) ?? [];
        const overlapsExisting = existing.some(e => rangesOverlap(validFrom, validTo, e.validFrom, e.validTo));
        if (overlapsExisting) {
          errors.push({
            index: i,
            message: `Primär betalare för objekt "${r.objectNumber}" överlappar med befintlig period`,
          });
          return;
        }
        const pending = pendingPrimariesByObject.get(objectId) ?? [];
        const overlapsPending = pending.find(p => rangesOverlap(validFrom, validTo, p.from, p.to));
        if (overlapsPending) {
          errors.push({
            index: i,
            message: `Primär betalare för objekt "${r.objectNumber}" överlappar med rad ${overlapsPending.index + 1} i uppladdningen`,
          });
          return;
        }
        pending.push({ from: validFrom, to: validTo, index: i });
        pendingPrimariesByObject.set(objectId, pending);
      }

      inserts.push({
        tenantId,
        objectId,
        customerId,
        payerType,
        isPrimary,
        sharePercent: r.sharePercent ?? 100,
        validFrom: validFrom ?? undefined,
        validTo: validTo ?? undefined,
        invoiceReference: r.invoiceReference ?? null,
        fortnoxCustomerId: r.fortnoxCustomerId ?? null,
        notes: r.notes ?? null,
      });
      preview.push({
        index: i,
        objectNumber: r.objectNumber,
        customerNumber: r.customerNumber,
        payerType,
        isPrimary,
      });
    });

    if (dryRun) {
      return res.json({
        dryRun: true,
        batchId,
        valid: preview.length,
        invalid: errors.length,
        errors,
        preview,
      });
    }
    if (errors.length > 0) {
      throw new ValidationError(`${errors.length} rader har fel — kör dryRun för detaljer`);
    }

    // --- Commit ---
    const created = inserts.length > 0
      ? await db.insert(objectPayers).values(inserts).returning({ id: objectPayers.id })
      : [];

    // Skriv import_batches-rad för historik/idempotens
    await db.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: rows.length,
      created: created.length,
      updated: 0,
      errors: 0,
      metadata: {
        type: "object-payers",
        status: "completed",
        startedBy: (req as any).user?.id ?? null,
        completedAt: new Date().toISOString(),
      },
    });

    res.json({
      dryRun: false,
      batchId,
      created: created.length,
      ids: created.map(c => c.id),
    });
  }));

  // ========================================================================
  // POST /api/invoice-recipients/import
  // ========================================================================
  app.post("/api/invoice-recipients/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = importRecipientsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error).error);
    }
    const { rows, dryRun = false, batchId: providedBatchId } = parsed.data;
    const batchId = providedBatchId ?? `import-recipients-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (providedBatchId && !dryRun) {
      const [existing] = await db.select().from(importBatches)
        .where(and(eq(importBatches.batchId, providedBatchId), eq(importBatches.tenantId, tenantId)));
      if (existing) {
        return res.json({
          dryRun: false,
          batchId,
          idempotent: true,
          created: existing.created ?? 0,
          errors: [],
        });
      }
    }

    const customerNumbers = Array.from(new Set(rows.map(r => r.customerNumber)));
    const customerRows = await db.select({ id: customers.id, customerNumber: customers.customerNumber })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), inArray(customers.customerNumber, customerNumbers)));
    const customerByNumber = new Map(customerRows.filter(c => c.customerNumber).map(c => [c.customerNumber!, c.id]));

    // För validering: vilka kunder förekommer som betalare någonstans?
    const matchedCustomerIds = Array.from(new Set(
      rows.map(r => customerByNumber.get(r.customerNumber)).filter((v): v is string => !!v),
    ));
    const payerCustomerRows = matchedCustomerIds.length > 0
      ? await db.select({ customerId: objectPayers.customerId })
        .from(objectPayers)
        .where(and(eq(objectPayers.tenantId, tenantId), inArray(objectPayers.customerId, matchedCustomerIds)))
      : [];
    const knownPayerCustomerIds = new Set(payerCustomerRows.map(p => p.customerId));

    const errors: RowError[] = [];
    const inserts: Array<typeof invoiceRecipients.$inferInsert> = [];
    const preview: Array<{ index: number; customerNumber: string; level: string; recipientName: string }> = [];

    rows.forEach((r, i) => {
      const customerId = customerByNumber.get(r.customerNumber);
      if (!customerId) {
        errors.push({ index: i, message: `Kundnummer "${r.customerNumber}" hittades inte` });
        return;
      }
      if (!knownPayerCustomerIds.has(customerId)) {
        errors.push({
          index: i,
          message: `Kund "${r.customerNumber}" är inte registrerad som betalare i object_payers — importera betalare först`,
        });
        return;
      }
      const validFrom = parseDate(r.validFrom);
      const validTo = parseDate(r.validTo);
      if (r.validFrom && !validFrom) {
        errors.push({ index: i, message: `Ogiltigt validFrom "${r.validFrom}"` });
        return;
      }
      if (r.validTo && !validTo) {
        errors.push({ index: i, message: `Ogiltigt validTo "${r.validTo}"` });
        return;
      }
      if (validFrom && validTo && validFrom.getTime() > validTo.getTime()) {
        errors.push({ index: i, message: `validFrom är efter validTo` });
        return;
      }

      inserts.push({
        tenantId,
        customerId,
        level: r.level,
        recipientName: r.recipientName,
        recipientEmail: r.recipientEmail || null,
        recipientAddress: r.recipientAddress ?? null,
        recipientPostalCode: r.recipientPostalCode ?? null,
        recipientCity: r.recipientCity ?? null,
        recipientReference: r.recipientReference ?? null,
        fortnoxCustomerId: r.fortnoxCustomerId ?? null,
        validFrom: validFrom ?? undefined,
        validTo: validTo ?? undefined,
        priority: r.priority ?? 1,
        breaksInheritance: r.breaksInheritance ?? false,
        notes: r.notes ?? null,
      });
      preview.push({
        index: i,
        customerNumber: r.customerNumber,
        level: r.level,
        recipientName: r.recipientName,
      });
    });

    if (dryRun) {
      return res.json({
        dryRun: true,
        batchId,
        valid: preview.length,
        invalid: errors.length,
        errors,
        preview,
      });
    }
    if (errors.length > 0) {
      throw new ValidationError(`${errors.length} rader har fel — kör dryRun för detaljer`);
    }

    const created = inserts.length > 0
      ? await db.insert(invoiceRecipients).values(inserts).returning({ id: invoiceRecipients.id })
      : [];

    await db.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: rows.length,
      created: created.length,
      updated: 0,
      errors: 0,
      metadata: {
        type: "invoice-recipients",
        status: "completed",
        startedBy: (req as any).user?.id ?? null,
        completedAt: new Date().toISOString(),
      },
    });

    res.json({
      dryRun: false,
      batchId,
      created: created.length,
      ids: created.map(c => c.id),
    });
  }));
}
