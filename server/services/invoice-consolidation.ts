// ============================================
// ADR v3 §2.5 (Task #558): Konsolideringsperioder + bromsa fakturor
// ============================================
//
// När en work_order blir "redo att fakturera":
//   - Hitta vinnande konsoliderings-policy (per mottagare → per kund → tenant-default).
//   - period=immediate → WO.invoiceQueueState='pending' (Fortnox-export tar den direkt).
//   - period=daily/weekly/monthly → WO.invoiceQueueState='held' + invoiceHeldUntil=periodens slut.
//
// Schemalagt jobb (invoice-consolidation-scheduler):
//   - Hittar held WOs där invoiceHeldUntil <= now per (tenant, recipient).
//   - Skapar en customer_invoice (state='consolidated') per recipient-batch.
//   - Markerar WO:erna consolidated och kopplar dem till batchens id.
//
// Fortnox-export refuserar held WOs (se server/fortnox-client.ts).

import { db } from "../db";
import {
  workOrders,
  customerInvoices,
  invoiceConsolidationPolicies,
  invoiceRecipients,
  customers,
  type InvoiceConsolidationPolicy,
  type InvoiceConsolidationPeriod,
} from "@shared/schema";
import { and, eq, gte, isNull, isNotNull, lte, inArray, sql, desc } from "drizzle-orm";
import {
  getInvoiceFlowConfig,
  computeBillingSegmentForObject,
  EMPTY_SEGMENT,
  type BillingSegment,
} from "./invoice-flow-segmentation";

export type ResolvedPolicy = {
  policy: InvoiceConsolidationPolicy | null;
  period: InvoiceConsolidationPeriod; // default 'immediate' om ingen policy hittas
  source: "recipient" | "customer" | "default";
};

// Lösningsordning: explicit policy på recipient → policy på kund → default immediate.
export async function resolveConsolidationPolicy(
  tenantId: string,
  opts: { recipientId?: string | null; customerId?: string | null },
): Promise<ResolvedPolicy> {
  if (opts.recipientId) {
    const [pr] = await db
      .select()
      .from(invoiceConsolidationPolicies)
      .where(
        and(
          eq(invoiceConsolidationPolicies.tenantId, tenantId),
          eq(invoiceConsolidationPolicies.invoiceRecipientId, opts.recipientId),
          eq(invoiceConsolidationPolicies.active, true),
          isNull(invoiceConsolidationPolicies.deletedAt),
        ),
      )
      .orderBy(desc(invoiceConsolidationPolicies.updatedAt));
    if (pr) return { policy: pr, period: pr.period as InvoiceConsolidationPeriod, source: "recipient" };
  }
  if (opts.customerId) {
    const [pc] = await db
      .select()
      .from(invoiceConsolidationPolicies)
      .where(
        and(
          eq(invoiceConsolidationPolicies.tenantId, tenantId),
          eq(invoiceConsolidationPolicies.customerId, opts.customerId),
          isNull(invoiceConsolidationPolicies.invoiceRecipientId),
          eq(invoiceConsolidationPolicies.active, true),
          isNull(invoiceConsolidationPolicies.deletedAt),
        ),
      )
      .orderBy(desc(invoiceConsolidationPolicies.updatedAt));
    if (pc) return { policy: pc, period: pc.period as InvoiceConsolidationPeriod, source: "customer" };
  }
  return { policy: null, period: "immediate", source: "default" };
}

// Beräkna periodens slut (exklusiv övre gräns) given nu + policy.
// För daily: slutet av dagen (lokal UTC). Weekly: nästa anchorday. Monthly: nästa anchor day-i-månad.
export function computePeriodEnd(
  now: Date,
  period: InvoiceConsolidationPeriod,
  anchor: number | null | undefined,
  releaseAtHour: number | null | undefined,
): Date | null {
  if (period === "immediate") return null;
  const release = typeof releaseAtHour === "number" && releaseAtHour >= 0 && releaseAtHour <= 23 ? releaseAtHour : 6;
  if (period === "daily") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, release, 0, 0, 0));
    return d;
  }
  if (period === "weekly") {
    // anchor: 0=söndag..6=lördag (default 1 = måndag, då veckan stänger).
    const a = typeof anchor === "number" && anchor >= 0 && anchor <= 6 ? anchor : 1;
    const cur = now.getUTCDay();
    let diff = (a - cur + 7) % 7;
    if (diff === 0) diff = 7; // alltid framåt; aldrig dagens släpp
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, release, 0, 0, 0));
    return d;
  }
  if (period === "monthly") {
    // anchor: dag-i-månaden (1..28). Default 1 (första kommande månadsskifte).
    const a = typeof anchor === "number" && anchor >= 1 && anchor <= 28 ? anchor : 1;
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    let candidate = new Date(Date.UTC(y, m, a, release, 0, 0, 0));
    if (candidate.getTime() <= now.getTime()) {
      candidate = new Date(Date.UTC(y, m + 1, a, release, 0, 0, 0));
    }
    return candidate;
  }
  return null;
}

// Beräkna periodens start (inklusive nedre gräns) — för audit/visning.
export function computePeriodStart(
  end: Date,
  period: InvoiceConsolidationPeriod,
): Date {
  if (period === "daily") {
    return new Date(end.getTime() - 24 * 60 * 60 * 1000);
  }
  if (period === "weekly") {
    return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (period === "monthly") {
    // En grov ansats: 30 dagar bakåt (för audit-visning räcker det).
    return new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return end;
}

// Sätt invoice queue state för en WO baserat på resolverad policy.
// Returns the new state + heldUntil (om held).
export async function markWorkOrderReadyForInvoice(
  workOrderId: string,
  tenantId: string,
  now: Date = new Date(),
): Promise<{ state: "pending" | "held"; heldUntil: Date | null; policyId: string | null }> {
  const [wo] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
  if (!wo) throw new Error("Arbetsorder hittades inte");

  // Om WO redan exporterats eller konsoliderats — rör inget.
  if (wo.invoiceQueueState === "consolidated" || wo.invoiceQueueState === "exported") {
    return {
      state: wo.invoiceQueueState as "pending" | "held",
      heldUntil: wo.invoiceHeldUntil ?? null,
      policyId: null,
    };
  }

  const recipientId = (wo as any).frozenInvoiceRecipientId as string | null;
  const customerId = wo.customerId ?? null;
  const resolved = await resolveConsolidationPolicy(tenantId, { recipientId, customerId });

  if (resolved.period === "immediate") {
    await db
      .update(workOrders)
      .set({
        invoiceQueueState: "pending",
        invoiceReadyAt: now,
        invoiceHeldUntil: null,
        // immediate konsolideras aldrig — rensa ev. tidigare fryst segment.
        billingSegmentKey: null,
        billingBreakObjectId: null,
        billingGroupingFieldName: null,
        billingGroupingValue: null,
      })
      .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
    return { state: "pending", heldUntil: null, policyId: resolved.policy?.id ?? null };
  }

  const periodEnd = computePeriodEnd(
    now,
    resolved.period,
    resolved.policy?.periodAnchor ?? null,
    resolved.policy?.releaseAtHour ?? null,
  );

  // Task #970: frys metadatastyrt billing-segment vid ready-time (endast held).
  // Endast aktiverade tenants; fel i metadata-beräkningen får aldrig blockera
  // faktureringen (degraderar till NULL-segment = dagens beteende).
  let segment: BillingSegment = EMPTY_SEGMENT;
  try {
    const config = await getInvoiceFlowConfig(tenantId);
    if (config.enabled && wo.objectId) {
      segment = await computeBillingSegmentForObject(tenantId, wo.objectId, config);
    }
  } catch (err) {
    console.warn(`[invoice-flow] segment-beräkning misslyckades för WO ${workOrderId}:`, err);
  }

  await db
    .update(workOrders)
    .set({
      invoiceQueueState: "held",
      invoiceReadyAt: now,
      invoiceHeldUntil: periodEnd,
      billingSegmentKey: segment.segmentKey,
      billingBreakObjectId: segment.breakObjectId,
      billingGroupingFieldName: segment.groupingFieldName,
      billingGroupingValue: segment.groupingValue,
    })
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
  return { state: "held", heldUntil: periodEnd, policyId: resolved.policy?.id ?? null };
}

type WoForConsolidation = {
  id: string;
  tenantId: string;
  customerId: string | null;
  frozenInvoiceRecipientId: string | null;
  frozenUnitPrice: number | string | null;
  frozenQuantity: number | string | null;
  cachedValue: number | string | null;
  invoiceHeldUntil: Date | null;
  invoiceReadyAt: Date | null;
  // Task #970: fryst billing-segment (NULL = ingen split = back-compat).
  billingSegmentKey: string | null;
  billingBreakObjectId: string | null;
  billingGroupingFieldName: string | null;
  billingGroupingValue: string | null;
};

function woAmount(wo: WoForConsolidation): number {
  const price = Number(wo.frozenUnitPrice ?? 0);
  const qty = Number(wo.frozenQuantity ?? 0);
  if (price > 0 && qty > 0) return Math.round(price * qty);
  return Math.round(Number(wo.cachedValue ?? 0));
}

export type ConsolidationRunResult = {
  tenantId: string;
  groupsProcessed: number;
  invoicesCreated: number;
  workOrdersConsolidated: number;
  invoiceIds: string[];
};

// Schemalagt jobb (eller manuell "släpp nu"): plocka held WOs vars period stängt,
// gruppera per (recipient | customer) och skapa en customer_invoice per grupp.
export async function runConsolidationForTenant(
  tenantId: string,
  opts: {
    now?: Date;
    onlyRecipientId?: string | null;
    onlyCustomerId?: string | null;
    force?: boolean; // ignorera heldUntil; släpp allt held just nu
    releasedBy?: string | null;
    releasedReason?: string | null;
  } = {},
): Promise<ConsolidationRunResult> {
  const now = opts.now ?? new Date();

  const conditions = [
    eq(workOrders.tenantId, tenantId),
    eq(workOrders.invoiceQueueState, "held"),
    isNull(workOrders.deletedAt),
  ];
  if (!opts.force) {
    conditions.push(
      sql`(${workOrders.invoiceHeldUntil} IS NOT NULL AND ${workOrders.invoiceHeldUntil} <= ${now})`,
    );
  }
  if (opts.onlyRecipientId) {
    conditions.push(eq(workOrders.frozenInvoiceRecipientId, opts.onlyRecipientId));
  }
  if (opts.onlyCustomerId) {
    conditions.push(eq(workOrders.customerId, opts.onlyCustomerId));
  }

  const held = (await db
    .select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      frozenInvoiceRecipientId: workOrders.frozenInvoiceRecipientId,
      frozenUnitPrice: workOrders.frozenUnitPrice,
      frozenQuantity: workOrders.frozenQuantity,
      cachedValue: workOrders.cachedValue,
      invoiceHeldUntil: workOrders.invoiceHeldUntil,
      invoiceReadyAt: workOrders.invoiceReadyAt,
      billingSegmentKey: workOrders.billingSegmentKey,
      billingBreakObjectId: workOrders.billingBreakObjectId,
      billingGroupingFieldName: workOrders.billingGroupingFieldName,
      billingGroupingValue: workOrders.billingGroupingValue,
    })
    .from(workOrders)
    .where(and(...conditions))) as WoForConsolidation[];

  if (held.length === 0) {
    return { tenantId, groupsProcessed: 0, invoicesCreated: 0, workOrdersConsolidated: 0, invoiceIds: [] };
  }

  // Gruppera per (recipientId || customerId) + fryst billing-segment (Task #970).
  // recipientId vinner när det finns. Segment-suffix förfinar grupperingen: NULL
  // segment ⇒ ingen split (dagens beteende, slås ihop med legacy NULL-fakturor).
  const groups = new Map<
    string,
    {
      recipientId: string | null;
      customerId: string | null;
      segmentKey: string | null;
      breakObjectId: string | null;
      groupingFieldName: string | null;
      groupingValue: string | null;
      wos: WoForConsolidation[];
    }
  >();
  for (const wo of held) {
    if (!wo.customerId && !wo.frozenInvoiceRecipientId) continue;
    const baseKey = wo.frozenInvoiceRecipientId
      ? `r:${wo.frozenInvoiceRecipientId}`
      : `c:${wo.customerId}`;
    const key = wo.billingSegmentKey ? `${baseKey}|${wo.billingSegmentKey}` : baseKey;
    if (!groups.has(key)) {
      groups.set(key, {
        recipientId: wo.frozenInvoiceRecipientId,
        customerId: wo.customerId,
        segmentKey: wo.billingSegmentKey ?? null,
        breakObjectId: wo.billingBreakObjectId ?? null,
        groupingFieldName: wo.billingGroupingFieldName ?? null,
        groupingValue: wo.billingGroupingValue ?? null,
        wos: [],
      });
    }
    groups.get(key)!.wos.push(wo);
  }

  const invoiceIds: string[] = [];
  let totalWos = 0;

  for (const group of Array.from(groups.values())) {
    // Vi behöver customerId för customer_invoices.customer_id. Om vi grupperade
    // på recipient utan customerId — slå upp via recipient → customers (vinnaren
    // är recipientens customerId).
    let customerId = group.customerId;
    if (!customerId && group.recipientId) {
      const [rec] = await db
        .select({ customerId: invoiceRecipients.customerId })
        .from(invoiceRecipients)
        .where(and(
          eq(invoiceRecipients.id, group.recipientId),
          eq(invoiceRecipients.tenantId, tenantId),
        ));
      customerId = rec?.customerId ?? null;
    }
    if (!customerId) {
      console.warn(`[invoice-consolidation] Skipping group: no customerId resolvable (tenant=${tenantId})`);
      continue;
    }

    const amount = group.wos.reduce((s: number, w: any) => s + woAmount(w), 0);
    const woIds = group.wos.map((w: any) => w.id);

    // Periodens start = tidigaste invoiceReadyAt i batchen. Slut = nu.
    const periodStart: Date | null = group.wos.reduce((min: Date | null, w: any) => {
      const t = w.invoiceReadyAt ? new Date(w.invoiceReadyAt) : null;
      if (!t) return min;
      if (!min || t < min) return t;
      return min;
    }, null);

    // ADDITIV KONSOLIDERING (period-scoped): bara appenda till en öppen
    // (icke-exporterad) consolidated faktura om den hör till SAMMA period.
    // Periodscope: existing.consolidationPeriodEnd >= periodStart (denna batchs
    // tidigaste invoiceReadyAt). Föregående periods invoice har periodEnd
    // strikt före nuvarande periods start (annars hade WOs:en konsoliderats då),
    // så den filtreras bort och hamnar inte i fel period.
    // Om periodStart saknas (defensiv fallback) — skapa alltid ny faktura.
    const matchConds = [
      eq(customerInvoices.tenantId, tenantId),
      eq(customerInvoices.state, "consolidated"),
      isNull(customerInvoices.fortnoxInvoiceId),
    ];
    if (periodStart) {
      matchConds.push(gte(customerInvoices.consolidationPeriodEnd, periodStart));
    }
    if (group.recipientId) {
      matchConds.push(eq(customerInvoices.invoiceRecipientId, group.recipientId));
    } else {
      matchConds.push(isNull(customerInvoices.invoiceRecipientId));
      matchConds.push(eq(customerInvoices.customerId, customerId));
    }
    // Task #970: additivt merge bara mot SAMMA segment. segmentKey är den
    // kanoniska segment-identiteten överallt (in-memory-gruppering, denna
    // cross-run-merge OCH förhandsvisningen) — kodar brytnod + grupperingsvärde.
    // NULL-segment matchar legacy NULL-fakturor (back-compat); satt segment
    // matchar exakt sin nyckel.
    if (group.segmentKey) {
      matchConds.push(eq(customerInvoices.billingSegmentKey, group.segmentKey));
    } else {
      matchConds.push(isNull(customerInvoices.billingSegmentKey));
    }
    // ATOMISK BATCH: invoice upsert + WO state-flip i samma transaktion.
    // Förhindrar att invoice-summan ökas medan WOs förblir 'held' (vilket
    // skulle leda till dubbeladdition vid retry, även med dedupad
    // workOrderIds-array, eftersom amount/totalAmount är inkrementella).
    // SELECT av "existing" görs INNE i transaktionen för att låsa korrekt rad.
    const invoice = await db.transaction(async (tx) => {
      const [existing] = periodStart
        ? await tx
            .select()
            .from(customerInvoices)
            .where(and(...matchConds))
            .orderBy(desc(customerInvoices.invoiceDate))
            .limit(1)
        : [];

      let inv;
      if (existing) {
        // Idempotens: filtrera bort WOs som redan finns på den befintliga
        // fakturan så vi aldrig dubbel-räknar summan vid retry.
        const existingWoIds = new Set((existing.workOrderIds as string[] | null) ?? []);
        const newWoIds = woIds.filter((id: string) => !existingWoIds.has(id));
        const newWos = group.wos.filter((w: any) => !existingWoIds.has(w.id));
        if (newWoIds.length === 0) {
          // Inget att appenda — fakturan oförändrad. Vi måste fortfarande
          // flippa eventuella WOs som råkat lägga sig i 'held' till
          // 'consolidated' (nedan), så returnera existing.
          return existing;
        }
        const addAmount = newWos.reduce((s: number, w: any) => s + woAmount(w), 0);
        const mergedWoIds = [...Array.from(existingWoIds), ...newWoIds];
        const newAmount = Number(existing.amount ?? 0) + addAmount;
        const newTotal = Number(existing.totalAmount ?? 0) + addAmount;
        const [updated] = await tx
          .update(customerInvoices)
          .set({
            amount: newAmount,
            totalAmount: newTotal,
            workOrderIds: mergedWoIds,
            description: `Konsoliderad faktura (${mergedWoIds.length} arbetsorder)`,
            consolidationPeriodEnd: now,
            releasedBy: opts.force ? (existing.releasedBy ?? opts.releasedBy ?? null) : existing.releasedBy,
            releasedAt: opts.force ? (existing.releasedAt ?? now) : existing.releasedAt,
            releasedReason: opts.force ? (existing.releasedReason ?? opts.releasedReason ?? "Manuell släpp") : existing.releasedReason,
          })
          .where(and(
            eq(customerInvoices.id, existing.id),
            eq(customerInvoices.tenantId, tenantId),
          ))
          .returning();
        inv = updated;
      } else {
        const batchNumber = `CONS-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const [created] = await tx
          .insert(customerInvoices)
          .values({
            tenantId,
            customerId: customerId!,
            invoiceNumber: batchNumber,
            invoiceDate: now,
            dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            amount,
            vatAmount: 0,
            totalAmount: amount,
            currency: "SEK",
            status: "unpaid",
            description: `Konsoliderad faktura (${group.wos.length} arbetsorder)`,
            workOrderIds: woIds,
            state: "consolidated",
            invoiceRecipientId: group.recipientId ?? null,
            billingSegmentKey: group.segmentKey,
            billingBreakObjectId: group.breakObjectId,
            billingGroupingFieldName: group.groupingFieldName,
            billingGroupingValue: group.groupingValue,
            consolidationPeriodStart: periodStart,
            consolidationPeriodEnd: now,
            releasedBy: opts.force ? opts.releasedBy ?? null : null,
            releasedAt: opts.force ? now : null,
            releasedReason: opts.force ? opts.releasedReason ?? "Manuell släpp" : null,
          })
          .returning();
        inv = created;
      }

      if (inv) {
        // Defense-in-depth: tenantId + invoiceQueueState='held' i WHERE så
        // vi aldrig råkar trampa WOs som redan flippat sig i en parallell run.
        await tx
          .update(workOrders)
          .set({
            invoiceQueueState: "consolidated",
            consolidationInvoiceId: inv.id,
            invoiceHeldUntil: null,
          })
          .where(and(
            inArray(workOrders.id, woIds),
            eq(workOrders.tenantId, tenantId),
            eq(workOrders.invoiceQueueState, "held"),
          ));
      }
      return inv;
    });

    if (!invoice) continue;
    invoiceIds.push(invoice.id);
    totalWos += woIds.length;
  }

  return {
    tenantId,
    groupsProcessed: groups.size,
    invoicesCreated: invoiceIds.length,
    workOrdersConsolidated: totalWos,
    invoiceIds,
  };
}
