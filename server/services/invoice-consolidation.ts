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
import { and, eq, gte, isNull, isNotNull, lte, inArray, notInArray, sql, desc } from "drizzle-orm";
import type { WorkOrder } from "@shared/schema";
import {
  getInvoiceFlowConfig,
  computeBillingSegmentForObject,
  composeSegmentKeyWithReferences,
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

export type ReadyState = "pending" | "held" | "blocked";
export type ReadyResult = {
  state: ReadyState;
  heldUntil: Date | null;
  policyId: string | null;
  blockedReason?: string;
};

// Uppgiftslogik v1 (Fakturalås): en WO räknas som "klar" i segment-gaten när dess
// livscykelstatus är 'utford' — samma signal som redan triggar readiness. Vi gate:ar
// medvetet INTE på executionStatus='completed' här: mobil-completion sätter bara
// orderStatus, så executionStatus kan släpa och skulle annars låsa segmentet för evigt.
const GATE_COMPLETE_ORDER_STATUS = "utford";
// Terminala icke-utförda statusar exkluderas ur segmentet (de faktureras aldrig och
// får därför aldrig blockera syskonens fakturering).
const GATE_CANCELLED_ORDER_STATUSES = ["avbruten", "omojlig"];

// Det frysta billing-segmentet för EN WO: fullt segment-objekt (för lagring) +
// den komponerade nyckeln (NULL = ingen split). Delas mellan segment-gaten och
// applyReadyDecision så gate-scope och den lagrade nyckeln beräknas EN gång och
// garanterat matchar (ingen recompute-drift mellan gate-pass och frysning).
type GateSegment = { segment: BillingSegment; segmentKey: string | null };

// Beräkna WO:ns billing-segment on-demand. Endast aktiverade tenants; fel i
// metadata-beräkningen får aldrig blockera faktureringen (degraderar till
// NULL-segment = dagens beteende). Väver in WO:ns FRYSTA huvudreferenser (satta vid
// skapande) så WO med olika referenser hamnar på olika fakturor (en faktura kan inte
// bära motstridiga huvudfält).
async function resolveWoSegment(
  wo: WorkOrder,
  tenantId: string,
  config: Awaited<ReturnType<typeof getInvoiceFlowConfig>>,
): Promise<GateSegment> {
  let segment: BillingSegment = EMPTY_SEGMENT;
  try {
    if (config.enabled && wo.objectId) {
      segment = await computeBillingSegmentForObject(tenantId, wo.objectId, config);
    }
  } catch (err) {
    console.warn(`[invoice-flow] segment-beräkning misslyckades för WO ${wo.id}:`, err);
  }
  const segmentKey = composeSegmentKeyWithReferences(segment.segmentKey, {
    ourReference: wo.frozenOurReference,
    ourDesignation: wo.frozenOurDesignation,
    customerReference: wo.frozenCustomerReference,
    customerInvoiceReference: wo.frozenCustomerInvoiceReference,
  });
  return { segment, segmentKey };
}

// Kanonisk bas-nyckel för fakturagruppering: mottagare vinner över kund (EXAKT samma
// prefix-logik som konsolideringen i runConsolidationForTenant). Detta är den yttre
// dimensionen WO grupperas på till fakturor; segment-nyckeln förfinar den ytterligare.
function canonicalBaseKey(wo: {
  frozenInvoiceRecipientId?: string | null;
  customerId?: string | null;
}): string {
  return wo.frozenInvoiceRecipientId
    ? `r:${wo.frozenInvoiceRecipientId}`
    : wo.customerId
      ? `c:${wo.customerId}`
      : "";
}

// Full fakturagrupperings-nyckel (bas + segment) — identisk identitet som
// konsolideringens `key` (baseKey + billingSegmentKey). NULL segment ⇒ ingen split.
function composeGroupKey(baseKey: string, segmentKey: string | null): string {
  return segmentKey ? `${baseKey}|${segmentKey}` : baseKey;
}

// Sätt invoice queue state (pending/held) för EN WO baserat på resolverad policy.
// Ren beslutslogik utan segment-gate — anropas efter att gaten (om aktiv) passerat.
// Rensar alltid ev. fakturalås-blockering på WO:n. `precomputedSegment` återanvänds
// från segment-gaten (undviker omberäkning + garanterar identisk fryst nyckel).
async function applyReadyDecision(
  wo: WorkOrder,
  tenantId: string,
  now: Date,
  precomputedSegment?: GateSegment,
): Promise<ReadyResult> {
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
        // Släppt ur fakturalåset (om det varit blockerat).
        invoiceBlockedReason: null,
        invoiceBlockedAt: null,
      })
      .where(and(eq(workOrders.id, wo.id), eq(workOrders.tenantId, tenantId)));
    return { state: "pending", heldUntil: null, policyId: resolved.policy?.id ?? null };
  }

  const periodEnd = computePeriodEnd(
    now,
    resolved.period,
    resolved.policy?.periodAnchor ?? null,
    resolved.policy?.releaseAtHour ?? null,
  );

  // Task #970: frys metadatastyrt billing-segment vid ready-time (endast held).
  // Återanvänd segment-gatens redan beräknade segment när det finns (identisk nyckel,
  // ingen omberäkning); annars beräkna on-demand via delad resolver.
  const { segment, segmentKey: billingSegmentKey } =
    precomputedSegment ?? (await resolveWoSegment(wo, tenantId, await getInvoiceFlowConfig(tenantId)));

  await db
    .update(workOrders)
    .set({
      invoiceQueueState: "held",
      invoiceReadyAt: now,
      invoiceHeldUntil: periodEnd,
      billingSegmentKey,
      billingBreakObjectId: segment.breakObjectId,
      billingGroupingFieldName: segment.groupingFieldName,
      billingGroupingValue: segment.groupingValue,
      // Släppt ur fakturalåset (om det varit blockerat).
      invoiceBlockedReason: null,
      invoiceBlockedAt: null,
    })
    .where(and(eq(workOrders.id, wo.id), eq(workOrders.tenantId, tenantId)));
  return { state: "held", heldUntil: periodEnd, policyId: resolved.policy?.id ?? null };
}

// Uppgiftslogik v1 (Fakturalås BY+CE): GROV kandidatpool av ÖPPNA (ej fakturerade,
// ej makulerade, ej raderade) fakturalåsta syskon-WO för (tenant, orderConceptId) i
// SAMMA kanoniska bas-dimension som konsolideringen grupperar på: mottagare vinner
// över kund. Detta är BARA den yttre ramen — det faktiska fakturasegmentet förfinas i
// evaluateSegmentGate via billing-segment-nyckeln. Vi kan inte filtrera på
// billingSegmentKey-kolumnen i SQL (NULL på ännu-ofrusna syskon; fryses först vid
// release), men bas-dimensionen ger rätt yttre pool: mottagare kan spänna över flera
// kunder (central faktura), så vi hämtar per recipientId när det finns — annars per
// customerId + recipientId IS NULL (kund-fakturor grupperar aldrig ihop med
// mottagar-fakturor).
async function getOpenGateSiblings(
  wo: WorkOrder,
  tenantId: string,
): Promise<WorkOrder[]> {
  if (!wo.orderConceptId) return [];
  const baseDimension = wo.frozenInvoiceRecipientId
    ? eq(workOrders.frozenInvoiceRecipientId, wo.frozenInvoiceRecipientId)
    : and(
        wo.customerId
          ? eq(workOrders.customerId, wo.customerId)
          : isNull(workOrders.customerId),
        isNull(workOrders.frozenInvoiceRecipientId),
      );
  return await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.orderConceptId, wo.orderConceptId),
        baseDimension,
        eq(workOrders.frozenRequireCompleteSegmentBeforeInvoice, true),
        isNull(workOrders.invoiceQueueState),
        isNull(workOrders.deletedAt),
        notInArray(workOrders.orderStatus, GATE_CANCELLED_ORDER_STATUSES),
      ),
    );
}

// Utvärdera segment-gaten för en fakturalåst WO. Gruppen = EXAKT samma identitet som
// konsolideringen fakturerar på: kanonisk bas (recipient|customer) + billing-segment.
// Om ALLA öppna WO i den gruppen är utförda släpps hela gruppen (varje WO får sitt
// eget pending/held-beslut, med redan beräknat segment). Annars blockeras `trigger`
// (om den själv är utförd) med en synlig orsak.
async function evaluateSegmentGate(
  trigger: WorkOrder,
  tenantId: string,
  now: Date,
): Promise<ReadyResult> {
  const config = await getInvoiceFlowConfig(tenantId);
  const triggerSeg = await resolveWoSegment(trigger, tenantId, config);
  const triggerGroupKey = composeGroupKey(canonicalBaseKey(trigger), triggerSeg.segmentKey);
  const candidates = await getOpenGateSiblings(trigger, tenantId);
  // Förfina den grova bas-poolen till DEN FAKTISKA fakturagruppen. WO med annan
  // metadata-gruppering, andra frysta huvudreferenser eller annan bas-nyckel hamnar på
  // egna fakturor och ska därför INTE blockera varandra (annars hålls en färdig grupp
  // kvar tills orelaterade grupper för samma kund/mottagare också blir klara). Vi
  // sparar varje syskons beräknade segment så release-steget slipper omberäkna.
  const siblings: WorkOrder[] = [];
  const segByWo = new Map<string, GateSegment>();
  for (const c of candidates) {
    const seg = c.id === trigger.id ? triggerSeg : await resolveWoSegment(c, tenantId, config);
    const key = composeGroupKey(canonicalBaseKey(c), seg.segmentKey);
    if (key === triggerGroupKey) {
      siblings.push(c);
      segByWo.set(c.id, seg);
    }
  }
  const total = siblings.length;
  const completed = siblings.filter((s) => s.orderStatus === GATE_COMPLETE_ORDER_STATUS).length;
  const allComplete = total > 0 && completed === total;

  if (allComplete) {
    // Släpp hela gruppen. Varje WO resolverar sin egen policy; segmentet återanvänds.
    let triggerResult: ReadyResult = { state: "blocked", heldUntil: null, policyId: null };
    for (const sib of siblings) {
      const res = await applyReadyDecision(sib, tenantId, now, segByWo.get(sib.id));
      if (sib.id === trigger.id) triggerResult = res;
    }
    return triggerResult;
  }

  // Inte allt klart. Om trigger själv är utförd + öppen → markera den blockerad så
  // det syns varför en färdig WO ändå inte gått vidare i fakturaflödet.
  const triggerIsOpenComplete =
    trigger.orderStatus === GATE_COMPLETE_ORDER_STATUS &&
    trigger.invoiceQueueState == null &&
    trigger.deletedAt == null;
  const blockedReason = `Fakturalås: väntar på att alla uppgifter i fakturasegmentet ska slutföras (${completed}/${total} klara).`;
  if (triggerIsOpenComplete) {
    await db
      .update(workOrders)
      .set({ invoiceBlockedReason: blockedReason, invoiceBlockedAt: now })
      .where(and(eq(workOrders.id, trigger.id), eq(workOrders.tenantId, tenantId)));
  }
  return { state: "blocked", heldUntil: null, policyId: null, blockedReason };
}

// Sätt invoice queue state för en WO baserat på resolverad policy.
// Returns the new state + heldUntil (om held).
// Uppgiftslogik v1: när WO:n är fakturalåst (frozenRequireCompleteSegmentBeforeInvoice)
// går den via segment-gaten först — held/pending sätts bara när hela segmentet är klart.
export async function markWorkOrderReadyForInvoice(
  workOrderId: string,
  tenantId: string,
  now: Date = new Date(),
): Promise<ReadyResult> {
  const [wo] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
  if (!wo) throw new Error("Arbetsorder hittades inte");

  // Om WO redan exporterats eller konsoliderats — rör inget.
  if (wo.invoiceQueueState === "consolidated" || wo.invoiceQueueState === "exported") {
    return {
      state: wo.invoiceQueueState as ReadyState,
      heldUntil: wo.invoiceHeldUntil ?? null,
      policyId: null,
    };
  }

  // Fakturalås (opt-in per orderkoncept, fryst per WO): gate:a på segmentets kompletthet.
  if (wo.frozenRequireCompleteSegmentBeforeInvoice && wo.orderConceptId) {
    return await evaluateSegmentGate(wo, tenantId, now);
  }

  return await applyReadyDecision(wo, tenantId, now);
}

// Uppgiftslogik v1 (Fakturalås): re-utvärdera segment-gaten UTAN att sätta trigger
// själv redo. Anropas när en fakturalåst WO blir terminal-icke-utförd (avbruten/
// omöjlig) — då försvinner den ur det öppna segmentet och kan ha varit det sista
// hindret för redan-utförda syskon. Ren no-op för icke-fakturalåsta WO.
export async function releaseSegmentGateIfComplete(
  workOrderId: string,
  tenantId: string,
  now: Date = new Date(),
): Promise<void> {
  const [wo] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
  if (!wo) return;
  if (!wo.frozenRequireCompleteSegmentBeforeInvoice || !wo.orderConceptId) return;
  // trigger (wo) är nu terminal/utanför öppna segmentet → evaluateSegmentGate
  // exkluderar den och släpper syskonen om de är kompletta.
  await evaluateSegmentGate(wo, tenantId, now);
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
  // Fakturareferenser — huvud vs radnivå: frysta huvudreferenser (speglas på
  // konsoliderad faktura). Inom en grupp är de identiska (de ingår i segment-nyckeln).
  frozenOurReference: string | null;
  frozenOurDesignation: string | null;
  frozenCustomerReference: string | null;
  frozenCustomerInvoiceReference: string | null;
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
      frozenOurReference: workOrders.frozenOurReference,
      frozenOurDesignation: workOrders.frozenOurDesignation,
      frozenCustomerReference: workOrders.frozenCustomerReference,
      frozenCustomerInvoiceReference: workOrders.frozenCustomerInvoiceReference,
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
    // Samma grupp-identitet som fakturalås-gaten använder (canonicalBaseKey +
    // composeGroupKey) — EN källa så gate-scope och konsolidering aldrig divergerar.
    const key = composeGroupKey(canonicalBaseKey(wo), wo.billingSegmentKey);
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
            // Fakturareferenser — huvud vs radnivå: spegla frysta huvudreferenser
            // (identiska inom gruppen, garanterat av segment-nyckeln) för audit/export.
            ourReference: group.wos[0]?.frozenOurReference ?? null,
            ourDesignation: group.wos[0]?.frozenOurDesignation ?? null,
            customerReference: group.wos[0]?.frozenCustomerReference ?? null,
            customerInvoiceReference: group.wos[0]?.frozenCustomerInvoiceReference ?? null,
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
