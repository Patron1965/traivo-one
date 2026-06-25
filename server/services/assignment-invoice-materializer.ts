// Task #1124 (Grundbeslut #1): Fakturan utgår från den UTFÖRDA uppgiften.
//
// Bryggan mellan en utförd avrops-uppgift (call_off-assignment) och faktura-
// pipelinen: en utförd uppgift materialiseras till EXAKT EN fakturerbar
// work_order, länkad via sourceAssignmentId + orderConceptId. Konceptets
// informationspaket (huvud-/radreferenser, fast pris, faktureringstyp) fryses på
// WO:n vid skapande; därefter återanvänds den befintliga
// work_order → konsolidering → Fortnox-vägen oförändrad.
//
// Idempotent: det partiella unika indexet (tenant_id, source_assignment_id) är
// den hårda garantin för "exakt en WO per uppgift". assignments.invoicedAt är en
// sekundär markör. Re-anrop är en no-op (säkerställer bara frys + kö-state, båda
// idempotenta) och returnerar den befintliga WO:n.
//
// Endast call_off (avrop/efterfakturering) materialiseras här — schema och
// abonnemang faktureras i sina egna flöden (utanför scope).

import { db } from "../db";
import { workOrders } from "@shared/schema";
import type { InsertWorkOrder, InsertWorkOrderLine } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { storage } from "../storage";
import { getOrderConceptMethod } from "@shared/order-concept-method";
import {
  resolveInvoiceReferencesForObject,
  buildFrozenRowReferences,
  conceptHasRowConfig,
  type ReferenceConceptLike,
} from "./invoice-reference-resolver";
import { markWorkOrderReadyForInvoice } from "./invoice-consolidation";

// Undantagsstatus som gör en uppgift icke-fakturerbar (matchar schema-kommentaren
// på assignments.exceptionStatus). NULL/tomt = normal, fakturerbar.
const NON_INVOICEABLE_EXCEPTION_STATUSES = new Set<string>([
  "ej_fakturerbar",
  "ej_genomforbar",
  "makulerad",
]);

export type MaterializeResult =
  | { status: "created"; workOrderId: string }
  | { status: "exists"; workOrderId: string }
  | { status: "skipped"; reason: string };

/**
 * Materialiserar en utförd avrops-uppgift till en fakturerbar work_order.
 *
 * @param tenantId   Tenant-scope (hård gräns; uppgift/koncept verifieras mot den).
 * @param assignmentId  Uppgiften som utförts.
 * @param now        Tidpunkt för frysning/kö-stämpling (injicerbar för test).
 */
export async function materializeCompletedAssignmentForInvoice(
  tenantId: string,
  assignmentId: string,
  now: Date = new Date(),
): Promise<MaterializeResult> {
  // 1. Hämta uppgiften. getAssignment saknar tenant-param → verifiera tenant själv.
  const assignment = await storage.getAssignment(assignmentId);
  if (!assignment || assignment.tenantId !== tenantId) {
    return { status: "skipped", reason: "assignment_not_found" };
  }

  // 2. Idempotens: finns redan en materialiserad WO för uppgiften? (unikt index)
  const [existing] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.sourceAssignmentId, assignmentId),
      ),
    );
  if (existing) {
    // Re-entrant: säkerställ frys + kö-state (båda idempotenta) och returnera.
    await ensureFrozenAndReady(existing.id, tenantId, now);
    return { status: "exists", workOrderId: existing.id };
  }

  // 3. Fakturerbarhets-guards.
  if (!assignment.orderConceptId) return { status: "skipped", reason: "no_concept" };
  // customer_id är NOT NULL på work_orders — utan beställare kan vi inte fakturera.
  if (!assignment.customerId) return { status: "skipped", reason: "no_customer" };
  if (
    assignment.exceptionStatus &&
    NON_INVOICEABLE_EXCEPTION_STATUSES.has(assignment.exceptionStatus)
  ) {
    return { status: "skipped", reason: `exception:${assignment.exceptionStatus}` };
  }

  // 4. Hämta konceptet (verifiera tenant) + härled faktureringsmetod. billingMethod
  //    fryses på uppgiften vid expansion; fall tillbaka på live-härledning för
  //    legacy-uppgifter utan stämpel. Endast call_off materialiseras här.
  const concept = await storage.getOrderConcept(assignment.orderConceptId);
  if (!concept || (concept as { tenantId?: string }).tenantId !== tenantId) {
    return { status: "skipped", reason: "concept_not_found" };
  }
  const method = assignment.billingMethod ?? getOrderConceptMethod(concept);
  if (method !== "call_off") return { status: "skipped", reason: `method:${method}` };

  // 5. Resolva faktura-referenser (huvud + rad) för uppgiftens objekt. Referenser är
  //    icke-blockerande: saknade FROM_METADATA-värden ger varningar, aldrig stopp.
  const refConcept = concept as ReferenceConceptLike;
  const resolved = await resolveInvoiceReferencesForObject(
    tenantId,
    refConcept,
    assignment.objectId ?? null,
  );
  const frozenRows = buildFrozenRowReferences(resolved, conceptHasRowConfig(refConcept));
  if (resolved.warnings.length > 0) {
    console.warn(
      `[assignment-invoice-materializer] referens-varningar för uppgift ${assignmentId}:`,
      resolved.warnings.join("; "),
    );
  }

  // 6. Skapa den fakturerbara work_ordern. Frysta HUVUDreferenser + RADreferenser +
  //    fast-pris-natur sätts vid skapande; pris/antal/kostnad/tid + vinnande
  //    fakturamottagare fryses via freezeWorkOrder i steg 9 (läser raderna).
  const woInsert: InsertWorkOrder = {
    tenantId,
    customerId: assignment.customerId,
    objectId: assignment.objectId ?? undefined,
    clusterId: assignment.clusterId ?? undefined,
    title: assignment.title,
    description: assignment.description ?? undefined,
    // Materialiserad WO representerar en redan utförd uppgift.
    orderStatus: "utford",
    executionStatus: "completed",
    scheduledDate: assignment.scheduledDate ?? assignment.completedAt ?? now,
    estimatedDuration: assignment.estimatedDuration ?? undefined,
    taskLatitude: assignment.latitude ?? undefined,
    taskLongitude: assignment.longitude ?? undefined,
    executionCode: assignment.executionCode ?? undefined,
    creationMethod: "assignment_invoice",
    // Task #1124 — koppling + informationspaket-natur.
    sourceAssignmentId: assignmentId,
    orderConceptId: assignment.orderConceptId,
    invoiceSourceType: "assignment",
    frozenIsFixedPrice: assignment.isFixedPrice ?? false,
    // Frysta huvudreferenser (NULL = back-compat → objekt-härledd YourReference).
    frozenOurReference: resolved.ourReference,
    frozenOurDesignation: resolved.ourDesignation,
    frozenCustomerReference: resolved.customerReference,
    frozenCustomerInvoiceReference: resolved.customerInvoiceReference,
    // Frysta radreferenser (NULL = ingen radkonfig → fallback i Fortnox-exporten).
    frozenInvoiceRowReferences: frozenRows ?? undefined,
  };
  const wo = await storage.createWorkOrder(woInsert);

  // 7. Skapa orderrader från uppgiftens artiklar (integer-öre, samma enhet som
  //    work_order_lines). skipRecalc på alla utom sista → en recalc totalt.
  const articles = await storage.getAssignmentArticles(assignmentId);
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const lineInsert: InsertWorkOrderLine = {
      tenantId,
      workOrderId: wo.id,
      articleId: a.articleId,
      quantity: a.quantity ?? 1,
      resolvedPrice: a.unitPrice ?? 0,
      resolvedCost: a.unitCost ?? 0,
      resolvedProductionMinutes: a.unitTime ?? 0,
    };
    await storage.createWorkOrderLine(lineInsert, {
      skipRecalc: i < articles.length - 1,
    });
  }
  // Om uppgiften saknade artiklar finns inga rader att räkna om — frys ger då 0.
  if (articles.length === 0) {
    await storage.recalculateWorkOrderTotals(wo.id);
  }

  // 8. Stämpla uppgiften som fakturerad (sekundär idempotens-markör).
  await storage.updateAssignment(assignmentId, tenantId, { invoicedAt: now });

  // 9. Frys pris/antal/kostnad/tid + mottagare, sätt sedan kö-state (pending/held).
  await ensureFrozenAndReady(wo.id, tenantId, now);

  return { status: "created", workOrderId: wo.id };
}

// Frys + markera redo. Båda stegen är idempotenta:
//   - freezeWorkOrder no-op:ar om alla 5 frozen-fält redan är satta (utan force)
//     och fryser dessutom vinnande fakturamottagare.
//   - markWorkOrderReadyForInvoice rör inte WO som redan är consolidated/exported.
// Ordning: frys FÖRE ready — ready-state läser frozenInvoiceRecipientId +
// frozenOur/Customer-referenser för att resolva policy och bygga segment-nyckeln.
async function ensureFrozenAndReady(
  workOrderId: string,
  tenantId: string,
  now: Date,
): Promise<void> {
  await storage.freezeWorkOrder(workOrderId, tenantId);
  await markWorkOrderReadyForInvoice(workOrderId, tenantId, now);
}
