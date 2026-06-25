// Task #1124 (Grundbeslut #1): Fakturan utgår från den UTFÖRDA uppgiften.
//
// Approach B (rekommenderad): varje schemalagd avrops-uppgift (call_off) blir ett
// RIKTIGT jobb i planeraren + mobilappen. Fältarbetaren slutför det som vilket
// annat jobb som helst, och konceptets informationspaket (huvud-/radreferenser,
// fast pris, faktureringstyp) följer med automatiskt till fakturan.
//
// Två faser:
//   1. PROJEKTION (ensureWorkOrderForAssignmentExecution): när uppgiften får en
//      resurs/tidpunkt (POST /api/assignments/:id/assign) skapas EXAKT EN länkad
//      work_order (sourceAssignmentId + orderConceptId, invoiceSourceType
//      'assignment') som en NORMAL planerad WO — så den syns i WeekPlanner och
//      mobilappen och kan utföras. Pris/referenser fryses INTE här.
//   2. FRYSNING/FAKTURERING (finalizeCompletedAssignmentForInvoice): när den
//      länkade WO:n klarmarkeras (mobil eller webb) resolvas + fryses
//      informationspaketet (huvud- + radreferenser), pris/antal/kostnad/tid +
//      vinnande fakturamottagare fryses, och WO:n läggs i fakturakön. Därefter
//      återanvänds work_order → konsolidering → Fortnox-vägen oförändrad.
//
// Idempotent: det partiella unika indexet (tenant_id, source_assignment_id) är
// den hårda garantin för "exakt en WO per uppgift" (race-säker — krock på indexet
// fångas och faller tillbaka på den befintliga WO:n). assignments.invoicedAt är en
// sekundär markör för att frysning/fakturering bara sker en gång.
//
// Endast call_off (avrop/efterfakturering) projiceras/materialiseras här — schema
// och abonnemang faktureras i sina egna flöden (utanför scope).

import { db } from "../db";
import { workOrders } from "@shared/schema";
import type { InsertWorkOrder, InsertWorkOrderLine, Assignment, OrderConcept } from "@shared/schema";
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

// Undantagsstatus som gör en uppgift ICKE-UTFÖRBAR (ska inte ens projiceras till
// ett fältjobb). NULL/tomt = normal.
const NON_EXECUTABLE_EXCEPTION_STATUSES = new Set<string>([
  "ej_genomforbar",
  "makulerad",
]);

// Undantagsstatus som gör en uppgift ICKE-FAKTURERBAR (matchar schema-kommentaren
// på assignments.exceptionStatus). En "ej_fakturerbar" uppgift utförs i fält men
// faktureras aldrig. NULL/tomt = normal, fakturerbar.
const NON_INVOICEABLE_EXCEPTION_STATUSES = new Set<string>([
  "ej_fakturerbar",
  "ej_genomforbar",
  "makulerad",
]);

export type EnsureResult =
  | { status: "created"; workOrderId: string }
  | { status: "updated"; workOrderId: string }
  | { status: "exists"; workOrderId: string }
  | { status: "skipped"; reason: string };

export type FinalizeResult =
  | { status: "invoiced"; workOrderId: string }
  | { status: "exists"; workOrderId: string }
  | { status: "skipped"; reason: string };

export type MaterializeResult =
  | { status: "created"; workOrderId: string }
  | { status: "exists"; workOrderId: string }
  | { status: "skipped"; reason: string };

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

// Härled faktureringsmetod för uppgiften. billingMethod fryses på uppgiften vid
// expansion (Task #1124); legacy-uppgifter utan stämpel faller tillbaka på
// live-härledning ur konceptet.
async function resolveBillingMethod(
  assignment: Assignment,
): Promise<{ method: string | null; concept: OrderConcept | null }> {
  if (assignment.billingMethod) {
    return { method: assignment.billingMethod, concept: null };
  }
  if (!assignment.orderConceptId) return { method: null, concept: null };
  const concept = await storage.getOrderConcept(assignment.orderConceptId);
  return { method: concept ? getOrderConceptMethod(concept) : null, concept: concept ?? null };
}

/**
 * FAS 1 — PROJEKTION. Skapa (eller uppdatera) EXAKT EN planerad work_order för en
 * schemalagd avrops-uppgift så att den syns i planerare + mobilapp och kan utföras.
 * Pris/referenser fryses INTE här — det sker först vid klarmarkering (fas 2).
 *
 * Idempotent via det partiella unika indexet (tenant_id, source_assignment_id):
 * en befintlig WO uppdateras (schemaläggning) om den ännu inte startats; annars
 * lämnas den orörd. Race-säker (krock på indexet → fall tillbaka på befintlig WO).
 */
export async function ensureWorkOrderForAssignmentExecution(
  tenantId: string,
  assignmentId: string,
): Promise<EnsureResult> {
  const assignment = await storage.getAssignment(assignmentId);
  if (!assignment || assignment.tenantId !== tenantId) {
    return { status: "skipped", reason: "assignment_not_found" };
  }

  // Endast konceptgenererade avrops-uppgifter projiceras.
  if (!assignment.orderConceptId) return { status: "skipped", reason: "no_concept" };
  // work_orders.customer_id är NOT NULL — utan beställare kan ingen WO skapas.
  if (!assignment.customerId) return { status: "skipped", reason: "no_customer" };
  if (
    assignment.exceptionStatus &&
    NON_EXECUTABLE_EXCEPTION_STATUSES.has(assignment.exceptionStatus)
  ) {
    return { status: "skipped", reason: `exception:${assignment.exceptionStatus}` };
  }

  const { method, concept: loadedConcept } = await resolveBillingMethod(assignment);
  if (method !== "call_off") return { status: "skipped", reason: `method:${method}` };

  // Defense-in-depth (arkitekt-rekommendation): verifiera att konceptet tillhör
  // samma tenant innan vi stämplar orderConceptId på WO:n. assignment.orderConceptId
  // skrivs alltid tenant-scopat av expansionen, så detta ska aldrig falla — men ett
  // koncept i FEL tenant blockeras. Ett SAKNAT (raderat) koncept blockerar INTE:
  // uppgiften är ändå verklig och utförbar. resolveBillingMethod laddar bara
  // konceptet när billingMethod ej är stämplad, så ladda vid behov.
  let conceptForTenantCheck = loadedConcept;
  if (!conceptForTenantCheck && assignment.orderConceptId) {
    conceptForTenantCheck = (await storage.getOrderConcept(assignment.orderConceptId)) ?? null;
  }
  if (
    conceptForTenantCheck &&
    (conceptForTenantCheck as { tenantId?: string }).tenantId !== tenantId
  ) {
    return { status: "skipped", reason: "concept_wrong_tenant" };
  }

  // Finns redan en länkad WO? (unikt index — exakt en per uppgift.)
  const [existing] = await db
    .select({
      id: workOrders.id,
      executionStatus: workOrders.executionStatus,
      orderStatus: workOrders.orderStatus,
    })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.sourceAssignmentId, assignmentId),
      ),
    );

  // Härled status från schemaläggning (samma princip som /assign på uppgiften).
  const hasSchedule = assignment.scheduledDate != null;
  const orderStatus = hasSchedule
    ? "planerad_resurs"
    : assignment.resourceId
      ? "planerad_pre"
      : "skapad";
  const executionStatus = hasSchedule
    ? "planned_fine"
    : assignment.resourceId
      ? "planned_rough"
      : "not_planned";

  if (existing) {
    // Uppdatera schemaläggningen bara om jobbet ännu inte påbörjats i fält — annars
    // får ett re-assign aldrig skriva över fältarbetarens progress eller en fryst WO.
    const reschedulable = new Set(["not_planned", "planned_rough", "planned_fine"]);
    if (existing.executionStatus && reschedulable.has(existing.executionStatus)) {
      await db
        .update(workOrders)
        .set({
          resourceId: assignment.resourceId ?? null,
          scheduledDate: assignment.scheduledDate ?? null,
          scheduledStartTime: assignment.scheduledStartTime ?? null,
          orderStatus,
          executionStatus,
        })
        .where(and(eq(workOrders.id, existing.id), eq(workOrders.tenantId, tenantId)));
      return { status: "updated", workOrderId: existing.id };
    }
    return { status: "exists", workOrderId: existing.id };
  }

  // Skapa en NORMAL planerad WO + dess orderrader atomiskt (allt eller inget).
  // teamId utelämnas medvetet → createWorkOrderWithLines auto-härleder det ur
  // resursens team-medlemskap.
  const woInsert: InsertWorkOrder = {
    tenantId,
    customerId: assignment.customerId,
    objectId: assignment.objectId ?? undefined,
    clusterId: assignment.clusterId ?? undefined,
    resourceId: assignment.resourceId ?? undefined,
    title: assignment.title,
    description: assignment.description ?? undefined,
    priority: assignment.priority ?? undefined,
    orderStatus,
    executionStatus,
    scheduledDate: assignment.scheduledDate ?? undefined,
    scheduledStartTime: assignment.scheduledStartTime ?? undefined,
    estimatedDuration: assignment.estimatedDuration ?? undefined,
    taskLatitude: assignment.latitude ?? undefined,
    taskLongitude: assignment.longitude ?? undefined,
    executionCode: assignment.executionCode ?? undefined,
    creationMethod: "assignment_invoice",
    // Task #1124 — koppling + fast-pris-natur (stabil; resten av paketet fryses
    // först vid klarmarkering i fas 2).
    sourceAssignmentId: assignmentId,
    orderConceptId: assignment.orderConceptId,
    invoiceSourceType: "assignment",
    frozenIsFixedPrice: assignment.isFixedPrice ?? false,
  };

  const articles = await storage.getAssignmentArticles(assignmentId);
  const lines: Omit<InsertWorkOrderLine, "workOrderId" | "tenantId">[] = articles.map((a) => ({
    articleId: a.articleId,
    quantity: a.quantity ?? 1,
    resolvedPrice: a.unitPrice ?? 0,
    resolvedCost: a.unitCost ?? 0,
    resolvedProductionMinutes: a.unitTime ?? 0,
  }));

  try {
    const { workOrder } = await storage.createWorkOrderWithLines(woInsert, lines);
    return { status: "created", workOrderId: workOrder.id };
  } catch (err) {
    // Race: en parallell projektion hann skapa WO:n först (unikt index). Fall
    // tillbaka på den befintliga i stället för att duplicera.
    if (isUniqueViolation(err)) {
      const [raced] = await db
        .select({ id: workOrders.id })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.tenantId, tenantId),
            eq(workOrders.sourceAssignmentId, assignmentId),
          ),
        );
      if (raced) return { status: "exists", workOrderId: raced.id };
    }
    throw err;
  }
}

/**
 * FAS 2 — FRYSNING/FAKTURERING. Anropas när en projicerad konceptuppgift-WO
 * klarmarkeras (mobil eller webb). Resolvar + fryser informationspaketet, fryser
 * pris/antal/kostnad/tid + vinnande fakturamottagare, lägger WO:n i fakturakön och
 * stämplar uppgiften som fakturerad. Best-effort + idempotent (re-anrop no-op).
 *
 * @param workOrderId  Den klarmarkerade work_ordern (måste ha sourceAssignmentId).
 */
export async function finalizeCompletedAssignmentForInvoice(
  tenantId: string,
  workOrderId: string,
  now: Date = new Date(),
): Promise<FinalizeResult> {
  const wo = await storage.getWorkOrder(workOrderId);
  if (!wo || wo.tenantId !== tenantId) {
    return { status: "skipped", reason: "work_order_not_found" };
  }
  if (!wo.sourceAssignmentId) {
    return { status: "skipped", reason: "not_projected" };
  }

  const assignment = await storage.getAssignment(wo.sourceAssignmentId);
  const assignmentValid = !!assignment && assignment.tenantId === tenantId;

  // Idempotens: redan fakturerad uppgift → säkerställ bara frys + kö-state.
  if (assignmentValid && assignment!.invoicedAt) {
    await ensureFrozenAndReady(workOrderId, tenantId, now);
    return { status: "exists", workOrderId };
  }

  // Icke-fakturerbar uppgift: arbetet är utfört (WO:n är redan klarmarkerad) men
  // ska aldrig faktureras. Stämpla bara uppgiften som utförd, hoppa över frys/kö.
  if (
    assignmentValid &&
    assignment!.exceptionStatus &&
    NON_INVOICEABLE_EXCEPTION_STATUSES.has(assignment!.exceptionStatus)
  ) {
    await storage.updateAssignment(wo.sourceAssignmentId, tenantId, {
      completedAt: assignment!.completedAt ?? now,
      status: "completed",
    });
    return { status: "skipped", reason: `exception:${assignment!.exceptionStatus}` };
  }

  // Resolva + frys informationspaketet (huvud- + radreferenser) på WO:n. Konceptet
  // identifieras via WO:n (eller uppgiften). Saknas konceptet fryser vi ändå
  // pris/kö nedan — bara huvudreferenserna uteblir (back-compat-fallback i export).
  const conceptId = wo.orderConceptId ?? assignment?.orderConceptId ?? null;
  if (conceptId) {
    const concept = await storage.getOrderConcept(conceptId);
    if (concept && (concept as { tenantId?: string }).tenantId === tenantId) {
      await freezeReferencesOnWorkOrder(
        workOrderId,
        tenantId,
        wo.objectId ?? assignment?.objectId ?? null,
        concept as ReferenceConceptLike,
        wo.sourceAssignmentId,
      );
    }
  }

  // Frys pris/antal/kostnad/tid + vinnande fakturamottagare, lägg i fakturakön.
  await ensureFrozenAndReady(workOrderId, tenantId, now);

  // Stämpla uppgiften: utförd + fakturerad (sekundär idempotens-markör).
  if (assignmentValid) {
    await storage.updateAssignment(wo.sourceAssignmentId, tenantId, {
      completedAt: assignment!.completedAt ?? now,
      invoicedAt: now,
      status: "completed",
    });
  }

  return { status: "invoiced", workOrderId };
}

/**
 * ADMIN/BACKFILL-fallback (option D). Materialiserar en redan utförd avrops-
 * uppgift direkt till en fakturerbar WO i ett steg — för uppgifter som aldrig gick
 * via fält-projektionen (legacy/backfill). Återanvänder projektion + frysning så
 * att resultatet blir identiskt med fält-vägen.
 */
export async function materializeCompletedAssignmentForInvoice(
  tenantId: string,
  assignmentId: string,
  now: Date = new Date(),
): Promise<MaterializeResult> {
  const ensured = await ensureWorkOrderForAssignmentExecution(tenantId, assignmentId);
  if (ensured.status === "skipped") return ensured;

  const workOrderId = ensured.workOrderId;
  const wasNew = ensured.status === "created";

  // Tvinga WO:n till utförd (backfill: uppgiften är redan gjord i verkligheten).
  await db
    .update(workOrders)
    .set({
      orderStatus: "utford",
      executionStatus: "completed",
      completedAt: now,
    })
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));

  const finalized = await finalizeCompletedAssignmentForInvoice(tenantId, workOrderId, now);
  if (finalized.status === "skipped") return finalized;

  return { status: wasNew ? "created" : "exists", workOrderId };
}

// Resolva + frys huvud-/radreferenser på en WO. Referenser är icke-blockerande:
// saknade FROM_METADATA-värden ger varningar, aldrig stopp. Tenant-scopad UPDATE
// (defense-in-depth).
async function freezeReferencesOnWorkOrder(
  workOrderId: string,
  tenantId: string,
  objectId: string | null,
  concept: ReferenceConceptLike,
  assignmentId: string,
): Promise<void> {
  const resolved = await resolveInvoiceReferencesForObject(tenantId, concept, objectId);
  const frozenRows = buildFrozenRowReferences(resolved, conceptHasRowConfig(concept));
  if (resolved.warnings.length > 0) {
    console.warn(
      `[assignment-invoice-materializer] referens-varningar för uppgift ${assignmentId}:`,
      resolved.warnings.join("; "),
    );
  }
  await db
    .update(workOrders)
    .set({
      frozenOurReference: resolved.ourReference,
      frozenOurDesignation: resolved.ourDesignation,
      frozenCustomerReference: resolved.customerReference,
      frozenCustomerInvoiceReference: resolved.customerInvoiceReference,
      frozenInvoiceRowReferences: frozenRows ?? null,
    })
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
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
