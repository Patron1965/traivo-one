import type { Express } from "express";
import { storage } from "../storage";
import { ensurePrimaryPayer } from "../services/object-customer";
import { getTimeRestrictionsForObjects, getTimeRestrictionsForTenant } from "../services/object-time-restrictions";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, ensureResourceInTenant, ensureResourceIdsInTenant } from "./helpers";
import { getTenantIdWithFallback, requirePlanner } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError, describeFortnoxMappingConflict } from "../errors";
import { objects, workOrders, articles, customers, fortnoxMappings, importBatches, assignments, insertWorkOrderSchema, insertTaskDesiredTimewindowSchema, insertTaskDependencySchema, insertTaskInformationSchema, insertStructuralArticleSchema, type InsertWorkOrder, type ServiceObject, type Assignment } from "@shared/schema";
import { notificationService } from "../notifications";
import { resolveArticleCostBasisOre } from "@shared/article-pricing";
import {
  shouldSplitForStockPickup,
  resolveStockLocation,
  computePickupDate,
} from "../services/logistics-task-expansion";
import { getISOWeek, getDateFromWeekdayInMonth } from "./helpers";
import { buildScheduleDateTargets } from "../services/order-concept-schedule";
import { getOrderConceptMethod } from "@shared/order-concept-method";
import { triggerGeocodeIfMissing } from "../services/geocoding";
import { resolveEffectiveArticleQuantity } from "../article-quantity-resolver";
import {
  resolveActiveArticle,
  resolveConceptArticleHits,
  isFixedPriceConcept,
  computeObjectValueOre,
  fixedPriceWoDivisor,
  type ConceptArticleHits,
} from "../services/order-concept-article-hits";
import { getArticleMetadataForObject } from "../metadata-queries";
import { computeConceptSubscriptionFee, groupSubscriptionInvoices, isConceptFakturastopp } from "../services/order-concept-subscription";
import {
  resolveTargetObjects,
  filterObjectsByConditions,
  resolveConceptMatchingObjects,
  buildMatchReasonsForObjects,
} from "../services/order-concept-targeting";
import { deriveFortnoxCodesForWorkOrder } from "../services/fortnox-code-derivation";
import { buildConceptTimeRulePackagesByObject } from "../services/time-rule-package";
import {
  buildCustomerLookup,
  resolveConceptCustomerForObject,
} from "../services/concept-customer-resolver";

async function verifyObjectTenant(objectId: string, tenantId: string): Promise<boolean> {
  try {
    const obj = await storage.getObject(objectId);
    return verifyTenantOwnership(obj, tenantId) !== null;
  } catch {
    return false;
  }
}

// Task #934/#979: SCHEMA-metodens (schedule) date-generator lever nu i
// ../services/order-concept-schedule (delad med /execute, /run-rolling och
// review-summary så att preview och körning aldrig divergerar). Idempotens
// (hoppa över redan genererade (objekt|datum)-par) hanteras i
// generateScheduleAssignments nedan.

// Task #976: läsbar träff-/miss-sammanfattning för svenska success-meddelanden.
// Metadata-driven artikel ⇒ "20 av 60 inpekade objekt (40 saknar pantkärl)"; annars
// (alla träffar) ⇒ "60 objekt".
function buildHitSummaryText(hits: ConceptArticleHits | null): string {
  if (!hits) return "0 objekt";
  if (!hits.isMetadataDriven || hits.missCount === 0) {
    return `${hits.hitCount} objekt`;
  }
  const missLabel = hits.quantityFieldLabel
    ? ` (${hits.missCount} saknar ${hits.quantityFieldLabel})`
    : ` (${hits.missCount} utan träff)`;
  return `${hits.hitCount} av ${hits.inpekadeCount} inpekade objekt${missLabel}`;
}

// Task #989: skapa hämt-uppgiften (assignment) för en varuartikel med lagerplats.
// Hämtuppgiften ligger på lagerplatsens koordinater och schemaläggs FÖRE
// leveransuppgiften (ledtid via artikelns dependencyMinutesBefore). Den bär INGEN
// artikelrad/pris — värdet stannar på leveransuppgiften så fakturering aldrig
// dubbelräknas. Leveransuppgiften länkas tillbaka via parentAssignmentId.
async function createStockPickupAssignment(opts: {
  tenantId: string;
  concept: any;
  obj: { id: string; clusterId?: string | null };
  linkedArticle: any;
  deliverDate: Date | null | undefined;
  customerId: string | null;
  quantity: number;
  userId: string | undefined;
  // Task #1205 (fält 54): läsbar matchningsorsak för objektet (ärvs till hämt-uppgiften).
  matchReason?: string;
}): Promise<Assignment> {
  const { tenantId, concept, obj, linkedArticle, deliverDate, customerId, quantity, userId, matchReason } = opts;
  const stock = resolveStockLocation(linkedArticle);
  const pickupDate = computePickupDate(deliverDate, linkedArticle);
  return storage.createAssignment({
    tenantId,
    orderConceptId: concept.id,
    objectId: obj.id,
    customerId: customerId ?? undefined,
    title: `Hämta: ${linkedArticle.name}`,
    description: stock.address ? `Hämtas på lagerplats: ${stock.address}` : undefined,
    status: "not_planned",
    priority: concept.priority || "normal",
    scheduledDate: pickupDate,
    quantity,
    address: stock.address || undefined,
    latitude: stock.latitude ?? undefined,
    longitude: stock.longitude ?? undefined,
    creationMethod: "automatic",
    createdBy: userId,
    estimatedDuration: linkedArticle.productionTime || 30,
    cachedValue: 0,
    cachedCost: 0,
    logisticsRole: "pickup",
    // Task #1369: ursprung stämplat vid skapandet (koncept-expansion).
    sourceType: "orderkoncept",
    // Task #1205 (fält 54): matchningsorsak ärvs till hämt-uppgiften.
    matchReason: matchReason ?? undefined,
    // Task #1110: stämpla artikelns utförandekod på hämt-uppgiften (informationspaket).
    executionCode: linkedArticle?.executionCode ?? undefined,
    // Tidskod fryst från artikelns timeCodeKey (finplanering/lön).
    frozenTimeCode: linkedArticle?.timeCodeKey ?? undefined,
    // Task #1124: stämpla informationspaket-natur vid expansion (concept-nivå, gäller
    // alla uppgifter konceptet skapar). isFixedPrice styr radkollaps vid materialisering;
    // billingMethod = faktureringstyp (call_off/schedule/subscription) snapshot.
    isFixedPrice: isFixedPriceConcept(concept),
    billingMethod: getOrderConceptMethod(concept),
  });
}

export async function generateScheduleAssignments(opts: {
  concept: any;
  tenantId: string;
  userId: string | undefined;
  matchingObjects: ServiceObject[];
  linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined;
  linkedArticleId: string | null;
  linkedPrice: { price: number; cost: number; productionMinutes: number };
  // Task #937: FROM_METADATA — per-objekt kund + pris. customerIdForObject ger
  // resolverad kund (FROM_METADATA) eller konceptets fasta kund (HARDCODED);
  // resolvePrice slår upp kund-pris (memo:at av anroparen).
  isFromMetadata: boolean;
  customerIdForObject: (objectId: string) => string | null;
  resolvePrice: (
    article: Awaited<ReturnType<typeof storage.getArticle>> | undefined,
    articleId: string | null,
    customerId: string | null,
  ) => Promise<{ price: number; cost: number; productionMinutes: number; priceListId: string | null }>;
  // Task #976: förupplöst antal per objekt (från artikelträff-tjänsten). matchingObjects
  // är redan filtrerat till träff-objekt; kartan ger samma antal som träffberäkningen
  // så schema och resultatvy aldrig divergerar. Saknas den faller vi tillbaka på
  // resolveEffectiveArticleQuantity (back-compat).
  quantityByObjectId?: Map<string, number>;
}): Promise<{ created: any[]; datesGenerated: number; skipped: number } | null> {
  const {
    concept,
    tenantId,
    userId,
    matchingObjects,
    linkedArticle,
    linkedArticleId,
    linkedPrice,
    isFromMetadata,
    customerIdForObject,
    resolvePrice,
    quantityByObjectId,
  } = opts;

  const targets = buildScheduleDateTargets(concept);
  if (targets === null) return null;

  // Task #1055: fast pris-delare för EN genererad arbetsorder. Per_object delar det
  // fasta beloppet jämnt över objektets generationer (datum); per_concept delar över
  // alla arbetsordrar (objekt × generationer); per_task = 1 (fullt belopp per WO).
  const fixedDivisor = fixedPriceWoDivisor(concept, {
    objectCount: matchingObjects.length,
    occurrences: targets.length,
  });

  // Idempotens: läs in befintliga (objekt|datum)-par för konceptet.
  const dateKey = (d: Date | string | null | undefined): string => {
    if (!d) return "";
    const dd = typeof d === "string" ? new Date(d) : d;
    return Number.isNaN(dd.getTime()) ? "" : dd.toISOString().split("T")[0];
  };
  const existing = await db
    .select({ objectId: assignments.objectId, scheduledDate: assignments.scheduledDate, logisticsRole: assignments.logisticsRole })
    .from(assignments)
    .where(and(eq(assignments.tenantId, tenantId), eq(assignments.orderConceptId, concept.id)));
  // Task #989: hämt-uppgifter (logisticsRole='pickup') ligger på lagerplatsens datum
  // (leverans − ledtid) och får aldrig förgifta idempotens-nycklarna — annars skulle en
  // hämtdatum-kollision felaktigt hoppa över en legitim leveransuppgift.
  const seenKeys = new Set(
    existing
      .filter((e) => e.logisticsRole !== "pickup")
      .map((e) => `${e.objectId}|${dateKey(e.scheduledDate as any)}`),
  );

  // Task #997 (Tidsmotor): frys konceptets viktade tidsregel-paket per objekt en
  // gång (samma objekt återkommer för varje schemalagt datum). Objekt utan
  // tillämpliga regler saknas i kartan ⇒ frozenTimeRules=null.
  const frozenTimeRulesByObject = await buildConceptTimeRulePackagesByObject(
    tenantId,
    concept.deliveryRestrictions,
    matchingObjects.map((o) => o.id),
  );

  // Task #1205 (fält 54): läsbar matchningsorsak per objekt (delad batch), stämplas
  // på varje genererad assignment så att VARFÖR objektet hakades på överlever senare
  // filteredigeringar.
  const scheduleFilters = await storage.getConceptFilters(concept.id);
  const matchReasonByObject = await buildMatchReasonsForObjects(
    tenantId,
    matchingObjects,
    scheduleFilters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    })),
  );

  const created: any[] = [];
  let skipped = 0;
  for (const t of targets) {
    const dayStr = t.date.toISOString().split("T")[0];
    for (const obj of matchingObjects) {
      const key = `${obj.id}|${dayStr}`;
      if (seenKeys.has(key)) {
        skipped++;
        continue;
      }
      seenKeys.add(key); // skydda mot dubbletter inom samma körning

      // Task #976: använd förupplöst antal från artikelträff-tjänsten (samma värde
      // som träffberäkningen), annars beräkna som tidigare.
      let quantity = quantityByObjectId?.get(obj.id);
      if (quantity == null) {
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        quantity = 1;
        if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
          quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
        }
        if (linkedArticle) {
          quantity = await resolveEffectiveArticleQuantity({
            tenantId,
            article: linkedArticle,
            baseQuantity: quantity,
            objectId: obj.id,
          });
        }
      }

      // Task #937: per-objekt kund + pris (FROM_METADATA resolverat; annars konceptets
      // fasta kund + förberäknat linkedPrice).
      const effectiveCustomerId = customerIdForObject(obj.id);
      const objPrice = isFromMetadata
        ? await resolvePrice(linkedArticle, linkedArticleId, effectiveCustomerId)
        : linkedPrice;

      const estimatedDuration = objPrice.productionMinutes * quantity || 60;
      // Task #976: fast pris (priceModel='fixed') ⇒ fixedPriceAmount per objekt; annars
      // löpande pris × antal. Kostnad påverkas inte av det fasta försäljningspriset.
      const totalValue = computeObjectValueOre(concept, objPrice.price, quantity, fixedDivisor);
      const totalCost = objPrice.cost * quantity;
      const unitPriceForArticle =
        isFixedPriceConcept(concept) && quantity > 0 ? Math.round(totalValue / quantity) : objPrice.price;

      // Task #989: varuartikel med lagerplats ⇒ skapa hämt-uppgiften (lagerplats,
      // före leverans) först och länka leveransuppgiften tillbaka till den.
      const splitForStock = shouldSplitForStockPickup(linkedArticle);
      let pickupAssignmentId: string | undefined;
      if (splitForStock) {
        const pickup = await createStockPickupAssignment({
          tenantId,
          concept,
          obj,
          linkedArticle,
          deliverDate: t.date,
          customerId: effectiveCustomerId,
          quantity,
          userId,
          matchReason: matchReasonByObject.get(obj.id),
        });
        pickupAssignmentId = pickup.id;
        created.push(pickup);
      }

      const assignment = await storage.createAssignment({
        tenantId,
        orderConceptId: concept.id,
        objectId: obj.id,
        customerId: effectiveCustomerId ?? undefined,
        title: concept.name,
        description: concept.description || undefined,
        status: "not_planned",
        priority: concept.priority || "normal",
        scheduledDate: t.date,
        plannedWindowStart: t.windowStart ? new Date(`${dayStr}T${t.windowStart}:00`) : undefined,
        plannedWindowEnd: t.windowEnd ? new Date(`${dayStr}T${t.windowEnd}:00`) : undefined,
        quantity,
        address: obj.address || undefined,
        latitude: obj.latitude || undefined,
        longitude: obj.longitude || undefined,
        creationMethod: "automatic",
        createdBy: userId,
        estimatedDuration,
        cachedValue: totalValue,
        cachedCost: totalCost,
        logisticsRole: splitForStock ? "deliver" : undefined,
        parentAssignmentId: pickupAssignmentId,
        // Task #1205 (fält 54): läsbar matchningsorsak snapshotad vid expansion.
        matchReason: matchReasonByObject.get(obj.id),
        // Task #1110: stämpla artikelns utförandekod på uppgiften (informationspaket).
        executionCode: linkedArticle?.executionCode ?? undefined,
        // Tidskod fryst från artikelns timeCodeKey (finplanering/lön).
        frozenTimeCode: linkedArticle?.timeCodeKey ?? undefined,
        // Task #997: fryst viktat tidsregel-paket (null om objektet saknar regler).
        frozenTimeRules: frozenTimeRulesByObject.get(obj.id) ?? null,
        // Task #1369: ursprung stämplat vid skapandet (koncept-expansion, schema).
        sourceType: "orderkoncept",
        // Task #1124/#1187: faktureringstyp-snapshot (schedule/subscription). Läses av
        // materialiseraren; abonnemangsuppgifter kvittas till 0 vid slutförande så att
        // identifieringen inte hänger på att konceptet finns kvar/oförändrat senare.
        billingMethod: getOrderConceptMethod(concept),
        // Platskrav (§5 A) stämplas MEDVETET inte här: detta är en concept-nivå-
        // assignment (en per objekt, ej per artikel), så en enskild artikels
        // locationRequirement har ingen entydig innebörd. Objektet är obligatoriskt
        // (objectId NOT NULL) ⇒ resolveLocationRequirement härleder "obligatorisk"
        // vid materialisering, identiskt med "valfri" i VRP. Per-artikel-platskrav
        // tillämpas i admin/logistik-WO-vägen (se ca.locationRequirement nedan).
      });

      if (linkedArticle && linkedArticleId) {
        await storage.createAssignmentArticle({
          assignmentId: assignment.id,
          articleId: linkedArticleId,
          quantity,
          unitPrice: unitPriceForArticle,
          totalPrice: totalValue,
          unitCost: objPrice.cost,
          totalCost,
          unitTime: objPrice.productionMinutes,
          totalTime: estimatedDuration,
          sequenceOrder: 1,
          status: "pending",
        });
      }

      created.push(assignment);
    }
  }

  return { created, datesGenerated: targets.length, skipped };
}

type ConceptPriceMemo = { price: number; cost: number; productionMinutes: number; priceListId: string | null };

// Task #937: Bygg per-objekt kund-resolution + pris-memo för konceptexpansion.
// FROM_METADATA härleder kund per objekt från valt metadatafält (svenska katalogen,
// via getArticleMetadataForObject) och matchar mot kundregistret; HARDCODED använder
// konceptets fasta kund. Pre-passet (call_off + schema, EJ abonnemang) kräver att ALLA
// matchande objekt kan resolvas innan några uppgifter skapas — annars kastas
// ValidationError så att vi aldrig får partiell expansion. Pris-memo:n återanvänds
// över både huvud-, för- och schema-uppgifter så samma (artikel|kund) bara slås upp en gång.
export async function prepareConceptCustomerPricing(opts: {
  concept: any;
  tenantId: string;
  matchingObjects: ServiceObject[];
  runPrePass: boolean;
}): Promise<{
  isFromMetadata: boolean;
  resolvedCustomerByObject: Map<string, string>;
  customerIdForObject: (objectId: string) => string | null;
  resolvePrice: (
    article: Awaited<ReturnType<typeof storage.getArticle>> | undefined,
    articleId: string | null,
    customerId: string | null,
  ) => Promise<ConceptPriceMemo>;
}> {
  const { concept, tenantId, matchingObjects, runPrePass } = opts;
  const isFromMetadata = concept.customerMode === "FROM_METADATA";
  const resolvedCustomerByObject = new Map<string, string>();

  const priceMemo = new Map<string, ConceptPriceMemo>();
  const listPriceFor = (a: Awaited<ReturnType<typeof storage.getArticle>> | undefined): ConceptPriceMemo => ({
    price: a?.listPrice || 0,
    cost: a ? resolveArticleCostBasisOre(a) : 0,
    productionMinutes: a?.productionTime || 0,
    priceListId: null,
  });
  const resolvePrice = async (
    article: Awaited<ReturnType<typeof storage.getArticle>> | undefined,
    articleId: string | null,
    customerId: string | null,
  ): Promise<ConceptPriceMemo> => {
    if (!article || !articleId) return { price: 0, cost: 0, productionMinutes: 0, priceListId: null };
    if (!customerId) return listPriceFor(article);
    const key = `${articleId}|${customerId}`;
    const cached = priceMemo.get(key);
    if (cached) return cached;
    const info = await storage.resolveArticlePrice(tenantId, articleId, customerId);
    const result: ConceptPriceMemo = {
      price: info.price,
      cost: info.cost,
      productionMinutes: info.productionMinutes,
      priceListId: info.priceListId,
    };
    priceMemo.set(key, result);
    return result;
  };
  // Kund-id per objekt: FROM_METADATA → resolverat; HARDCODED → konceptets fasta kund.
  const customerIdForObject = (objectId: string): string | null =>
    isFromMetadata ? (resolvedCustomerByObject.get(objectId) ?? null) : (concept.customerId ?? null);

  if (isFromMetadata && runPrePass) {
    // Trimmat — ett blanksteg-värde räknas som "inget fält valt" (matchar resolverns
    // no_field och valideringens FROM_METADATA_NO_FIELD), så meddelandet blir korrekt.
    if (!concept.customerMetadataField?.trim()) {
      throw new ValidationError(
        'Konceptet använder läget "Från objektets metadata" men inget metadatafält för kund är valt. Välj fältet i steg 1 innan du kör konceptet.',
      );
    }
    const allCustomers = await storage.getCustomers(tenantId);
    const customerLookup = buildCustomerLookup(allCustomers);
    const failures: Array<{ status: string; rawValue?: string }> = [];
    for (const obj of matchingObjects) {
      const r = await resolveConceptCustomerForObject(tenantId, concept, obj.id, customerLookup);
      if (r.status === "ok") {
        resolvedCustomerByObject.set(obj.id, r.customerId);
      } else {
        failures.push({ status: r.status, rawValue: (r as { rawValue?: string }).rawValue });
      }
    }
    if (failures.length > 0) {
      const noValue = failures.filter((f) => f.status === "missing_value").length;
      const unmatched = failures.filter((f) => f.status === "unmatched");
      const ambiguous = failures.filter((f) => f.status === "ambiguous").length;
      const parts: string[] = [];
      if (noValue > 0) parts.push(`${noValue} objekt saknar värde i fältet "${concept.customerMetadataField}"`);
      if (unmatched.length > 0) {
        parts.push(`${unmatched.length} objekt har ett värde som inte matchar någon kund (t.ex. "${unmatched[0].rawValue ?? ""}")`);
      }
      if (ambiguous > 0) parts.push(`${ambiguous} objekt matchar flera kunder (tvetydigt namn)`);
      throw new ValidationError(
        `Kan inte härleda kund för alla objekt: ${parts.join("; ")}. Inga uppgifter skapades — åtgärda kundkopplingen och kör igen.`,
      );
    }
  }

  return { isFromMetadata, resolvedCustomerByObject, customerIdForObject, resolvePrice };
}

// Task #1067: bygg en nivå-vy (segment) för abonnemangs-förhandsvisningen så att
// Granska/sidofältet TYDLIGT visar vilka organisatoriska nivåer fakturan stoppas på
// (fakturastopp = samma kund, uppdelad per metadatavärde). Använder SAMMA kanoniska
// grupperare (groupSubscriptionInvoices) som schemaläggaren ⇒ preview == execute.
// Aggregeras per segment (samma kund hela vägen) för en kompakt lista.
export interface SubscriptionSegmentPreview {
  segmentKey: string | null;
  fieldName: string | null;
  value: string | null;
  label: string;
  monthlyTotal: number;
  objectCount: number;
  isStop: boolean;
}

export async function buildSubscriptionSegmentsPreview(
  tenantId: string,
  concept: any,
  matchingObjects: ServiceObject[],
  fee: { perObjectValuesOre: number[] },
): Promise<SubscriptionSegmentPreview[]> {
  const fakturastopp = isConceptFakturastopp(concept);
  // Kund-upplösningen är best-effort i förhandsvisningen — den får ALDRIG kasta och
  // dölja nivå-vyn. Sentinel-kund säkerställer att objekt inte tappas om en
  // FROM_METADATA-kund inte kan härledas (vi aggregerar ändå per segment).
  let customerIdForObject: (objectId: string) => string | null = () => concept.customerId ?? "preview";
  try {
    const pricing = await prepareConceptCustomerPricing({
      concept,
      tenantId,
      matchingObjects,
      runPrePass: concept.customerMode === "FROM_METADATA",
    });
    customerIdForObject = (id) => pricing.customerIdForObject(id) ?? "preview";
  } catch {
    customerIdForObject = () => "preview";
  }

  const groups = await groupSubscriptionInvoices({
    tenantId,
    concept,
    matchingObjects,
    perObjectValuesOre: fee.perObjectValuesOre,
    customerIdForObject,
  });

  // Aggregera per segment i ÖRE (heltal) ⇒ ingen flyt-drift; dela med 100 sist.
  const segMap = new Map<
    string,
    { segmentKey: string | null; fieldName: string | null; value: string | null; valueOre: number; objectCount: number }
  >();
  for (const g of groups) {
    const k = g.segmentKey ?? "__customer__";
    const existing = segMap.get(k);
    if (existing) {
      existing.valueOre += g.valueOre;
      existing.objectCount += g.objectIds.length;
    } else {
      segMap.set(k, {
        segmentKey: g.segmentKey,
        fieldName: g.groupingFieldName,
        value: g.groupingValue,
        valueOre: g.valueOre,
        objectCount: g.objectIds.length,
      });
    }
  }

  return Array.from(segMap.values())
    .map((s) => ({
      segmentKey: s.segmentKey,
      fieldName: s.fieldName,
      value: s.value,
      label: s.segmentKey
        ? `${s.fieldName}: ${s.value}`
        : fakturastopp
          ? "Utan värde (kundnivå)"
          : "Kundnivå",
      monthlyTotal: s.valueOre / 100,
      objectCount: s.objectCount,
      isStop: !!s.segmentKey,
    }))
    // Stoppade nivåer först (namn-stigande), kundnivå-rest sist.
    .sort((a, b) => {
      if (a.isStop !== b.isStop) return a.isStop ? -1 : 1;
      return a.label.localeCompare(b.label, "sv");
    });
}

// Task #934: ABONNEMANGETS (subscription) nästa fakturadatum. Respekterar
// startdatum (framtida start ⇒ första körning = startdatum) och avancerar i steg
// om billingFrequency tills datumet ligger strikt efter "now".
// Task #1064: billingFrequency (monthly/quarterly/yearly) är enda frekvenskällan.
export function computeSubscriptionNextRun(start: Date, freq: string, now: Date): Date {
  if (start > now) return new Date(start);
  const stepMonths =
    freq === "yearly" ? 12 : freq === "quarterly" ? 3 : 1;
  const next = new Date(start);
  let guard = 0;
  while (next <= now && guard < 600) {
    next.setMonth(next.getMonth() + stepMonths);
    guard++;
  }
  return next;
}

// Task #911: leveransdatum tolkas i Europe/Stockholm. Ett datum-only-värde
// ("2026-07-01") saknar tidszon och `new Date("2026-07-01")` tolkar det som
// UTC-midnatt. På en server väster om UTC (t.ex. Replits US-regioner) blir det
// då föregående kalenderdag vid lokal/tidszonsfri formattering → off-by-one i
// planeringsvyer. Vi förankrar därför datum-only till midnatt i Europe/Stockholm.
const DELIVERY_DATE_TIMEZONE = "Europe/Stockholm";

// Tidszonens offset (minuter, positivt öster om UTC) för en given instant.
function getDeliveryTimeZoneOffsetMinutes(timeZone: string, instant: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? "0", 10);
  let hour = get("hour");
  if (hour === 24) hour = 0; // Intl kan returnera "24" beroende på locale
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return (asUTC - instant.getTime()) / 60000;
}

// Tolka ett datum-only-värde som midnatt i angiven tidszon. Två offset-pass
// hanterar DST-kanter korrekt (offseten vid UTC-gissningen kan skilja sig från
// offseten vid den justerade instanten kring DST-bytet).
function dateOnlyToZonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guessUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  let offset = getDeliveryTimeZoneOffsetMinutes(timeZone, new Date(guessUtcMs));
  let utcMs = guessUtcMs - offset * 60000;
  offset = getDeliveryTimeZoneOffsetMinutes(timeZone, new Date(utcMs));
  utcMs = guessUtcMs - offset * 60000;
  return new Date(utcMs);
}

// Task #901 (B8): tolka ett metadatavärde till ett leveransdatum vid orderkoncept-
// expansion. Accepterar ENBART Date-instanser och datum-/datetime-strängar
// ("YYYY-MM-DD" eller "YYYY-MM-DD HH:mm[:ss]"). Nummer/boolean avvisas medvetet —
// annars skulle ett numeriskt metadatafält tolkas som epoch-millisekunder
// (1970-skräp). Returnerar null vid saknat/ogiltigt värde så att expansionen kan
// falla tillbaka på konceptets schemalagda datum utan att krascha.
export function parseDeliveryDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Datum-only ("YYYY-MM-DD"): förankra till midnatt i Europe/Stockholm (se
    // Task #911-noten ovan) i stället för UTC-midnatt.
    const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      // Avvisa ogiltiga kalenderdatum (t.ex. "2026-13-45") — Date.UTC rullar
      // annars över till ett giltigt datum och döljer felet.
      const check = new Date(Date.UTC(year, month - 1, day));
      if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day
      ) {
        return null;
      }
      const zoned = dateOnlyToZonedMidnight(year, month, day, DELIVERY_DATE_TIMEZONE);
      return Number.isNaN(zoned.getTime()) ? null : zoned;
    }
    // Värden med tidskomponent ("YYYY-MM-DD HH:mm[:ss]") tolkas oförändrat:
    // normalisera mellanslag → ISO-T så Date tolkar korrekt (server-lokal tid).
    const normalized = trimmed.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, "$1T$2");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Task #837: per-tenant cache av Fortnox-artikelregistret för sök-i-rullgardin.
// Hela registret hämtas en gång (paginerat) och filtreras server-side så att
// sök-medan-du-skriver inte träffar Fortnox vid varje tangenttryck. Stale-värden
// återanvänds om ett senare API-anrop fallerar (robust mot långsamt/otillgängligt API).
interface FortnoxArticleOption {
  articleNumber: string;
  description: string;
  unit: string;
  salesPrice: number;
  active: boolean;
}
const fortnoxArticleSearchCache = new Map<string, { fetchedAt: number; articles: FortnoxArticleOption[] }>();
const FORTNOX_ARTICLE_CACHE_TTL_MS = 5 * 60 * 1000;
const FORTNOX_ARTICLE_FETCH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout efter ${ms} ms`)), ms),
    ),
  ]);
}

export async function registerFortnoxRoutes(app: Express) {
// ============================================
// FORTNOX INTEGRATION
// ============================================

const { createFortnoxClient } = await import("../fortnox-client");
const { exportWorkOrderToFortnox } = await import("../services/fortnox-export-service");

// Fortnox OAuth Authorization
app.get("/api/fortnox/authorize", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    const redirectUri = `${req.protocol}://${req.get("host")}/api/fortnox/callback`;
    const state = Buffer.from(JSON.stringify({ tenantId, timestamp: Date.now() })).toString("base64");
    
    const authUrl = await client.getAuthorizationUrlWithConfig(redirectUri, state);
    if (!authUrl) {
      throw new ValidationError("Fortnox configuration missing - please add Client ID first");
    }
    
    res.json({ authUrl });
}));

// Fortnox OAuth Callback
app.get("/api/fortnox/callback", asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    
    if (oauthError) {
      return res.redirect(`/fortnox?error=${encodeURIComponent(oauthError as string)}`);
    }
    
    if (!code || !state) {
      return res.redirect("/fortnox?error=missing_code");
    }

    let stateData: { tenantId: string };
    try {
      stateData = JSON.parse(Buffer.from(state as string, "base64").toString());
    } catch {
      return res.redirect("/fortnox?error=invalid_state");
    }

    const client = createFortnoxClient(stateData.tenantId);
    const redirectUri = `${req.protocol}://${req.get("host")}/api/fortnox/callback`;
    
    await client.exchangeCodeForTokens(code as string, redirectUri);
    
    res.redirect("/fortnox?success=true");
}));

// Fortnox Connection Status
app.get("/api/fortnox/status", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    const config = await storage.getFortnoxConfig(tenantId);
    
    res.json({
      isConnected,
      hasConfig: !!config?.clientId,
      tokenExpiresAt: config?.tokenExpiresAt,
    });
}));

// Process Fortnox Export (send to Fortnox API)
app.post("/api/fortnox/exports/:id/process", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await exportWorkOrderToFortnox(tenantId, req.params.id, (req as any).session?.userId ?? null);
    
    if (result.success) {
      res.json({ success: true, invoiceNumber: result.invoiceNumber });
    } else {
      throw new ValidationError(result.error ?? "Export misslyckades", { success: false });
    }
}));

// Fortnox Config
app.get("/api/fortnox/config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const config = await storage.getFortnoxConfig(tenantId);
    res.json(config || null);
}));

app.post("/api/fortnox/config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) {
      throw new ValidationError("Client ID and Secret required");
    }

    const existing = await storage.getFortnoxConfig(tenantId);
    if (existing) {
      const updated = await storage.updateFortnoxConfig(tenantId, {
        clientId,
        clientSecret,
        isActive: true
      });
      return res.json(updated);
    }

    const config = await storage.createFortnoxConfig({
      tenantId,
      clientId,
      clientSecret,
      isActive: true
    });
    res.status(201).json(config);
}));

app.patch("/api/fortnox/config", asyncHandler(async (req, res) => {
    const updateSchema = z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      isActive: z.boolean().optional(),
      accessToken: z.string().nullable().optional(),
      refreshToken: z.string().nullable().optional(),
      tokenExpiresAt: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
    });
    const updateData = updateSchema.parse(req.body);
    const tenantId = getTenantIdWithFallback(req);
    const config = await storage.updateFortnoxConfig(tenantId, updateData);
    if (!config) throw new NotFoundError("Konfiguration hittades inte");
    res.json(config);
}));

// Fortnox Mappings
app.get("/api/fortnox/mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const entityType = req.query.entityType as string | undefined;
    const mappings = await storage.getFortnoxMappings(tenantId, entityType);
    res.json(mappings);
}));

app.post("/api/fortnox/mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { entityType, unicornId, fortnoxId } = req.body;
    if (!entityType || !unicornId || !fortnoxId) {
      throw new ValidationError("Alla fält krävs");
    }

    const existing = await storage.getFortnoxMapping(tenantId, entityType, unicornId);
    if (existing) {
      const updated = await storage.updateFortnoxMapping(existing.id, tenantId, { fortnoxId, lastSyncedAt: new Date() });
      return res.json(updated);
    }

    const mapping = await storage.createFortnoxMapping({
      tenantId,
      entityType,
      unicornId,
      fortnoxId
    });
    res.status(201).json(mapping);
}));

app.delete("/api/fortnox/mappings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteFortnoxMapping(req.params.id, tenantId);
    res.status(204).send();
}));

// Fortnox Invoice Exports
app.get("/api/fortnox/exports", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const status = req.query.status as string | undefined;
    const exports = await storage.getFortnoxInvoiceExports(tenantId, status);
    res.json(exports);
}));

// Task #1243: Rik exportlogg (försök, väntetid, API-anrop, användare, felkod, slutstatus) — auditerbar i UI.
app.get("/api/fortnox/exports/:id/log", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const entries = await storage.getFortnoxExportLogEntries(req.params.id, tenantId);
    res.json(entries);
}));

app.post("/api/fortnox/exports", asyncHandler(async (req, res) => {
    const { workOrderId, payerId, costCenter, project } = req.body;
    if (!workOrderId) {
      throw new ValidationError("Arbetsorder-ID krävs");
    }

    const tenantId = getTenantIdWithFallback(req);

    // Task #941: härled kostnadsställe/projektkod automatiskt från den bil/utrustning
    // och de utförare som fångats vid klarmarkering. Manuell override har företräde:
    // härled bara när värdet saknas i begäran.
    let resolvedCostCenter: string | null = costCenter || null;
    let resolvedProject: string | null = project || null;
    if (!resolvedCostCenter || !resolvedProject) {
      const wo = await storage.getWorkOrder(workOrderId);
      if (wo && wo.tenantId === tenantId) {
        const derived = await deriveFortnoxCodesForWorkOrder(tenantId, wo);
        if (!resolvedCostCenter) resolvedCostCenter = derived.costCenter;
        if (!resolvedProject) resolvedProject = derived.project;
      }
    }

    const invoiceExport = await storage.createFortnoxInvoiceExport({
      tenantId,
      workOrderId,
      payerId: payerId || null,
      costCenter: resolvedCostCenter,
      project: resolvedProject,
      status: "pending"
    });
    res.status(201).json(invoiceExport);
}));

app.patch("/api/fortnox/exports/:id", asyncHandler(async (req, res) => {
    const updateSchema = z.object({
      status: z.string().optional(),
      fortnoxInvoiceNumber: z.string().nullable().optional(),
      errorMessage: z.string().nullable().optional(),
      exportedAt: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
    });
    const updateData = updateSchema.parse(req.body);
    const tenantId = getTenantIdWithFallback(req);
    const invoiceExport = await storage.updateFortnoxInvoiceExport(req.params.id, tenantId, updateData);
    if (!invoiceExport) throw new NotFoundError("Export hittades inte");
    res.json(invoiceExport);
}));

// ============================================
// OBJECT CONTACTS - Kontakter med arvslogik
// ============================================

app.get("/api/objects/:objectId/contacts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    // Etapp 5: kontakter läses ur Kontakt-metadatat (alltid arvs-medvetet).
    const { getObjectKontaktPersons } = await import("../metadata-queries");
    const kontakter = await getObjectKontaktPersons(req.params.objectId, tenantId);
    res.json(kontakter.map((k, idx) => ({
      id: `${req.params.objectId}-kontakt-${idx}`,
      objectId: req.params.objectId,
      name: k.namn,
      role: k.titel,
      phone: k.telefon,
      email: k.epost,
      // Task #1440: redigerings- och ursprungsinfo för det konsoliderade
      // kontaktkortet (varden-id per underfält, ärvt/eget, skapad).
      fields: k.fields,
      inherited: k.inherited,
      inheritedFromObjectName: k.inheritedFromObjectName,
      createdAt: k.createdAt,
      // Task #1459: personens grupp-nyckel — låter klienten komplettera saknade
      // underfält rad-säkert (POST /api/metadata med gruppNyckel).
      gruppNyckel: k.gruppNyckel,
    })));
}));

// ============================================
// TASK TIMEWINDOWS - Flera önskade tidsfönster per uppgift
// ============================================

app.get("/api/task-timewindows", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const timewindows = await storage.getAllTaskTimewindows(tenantId);
    res.json(timewindows);
}));

app.get("/api/work-orders/:workOrderId/timewindows", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const timewindows = await storage.getTaskTimewindows(req.params.workOrderId);
    res.json(timewindows);
}));

app.post("/api/work-orders/:workOrderId/timewindows", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const data = insertTaskDesiredTimewindowSchema.parse({
      ...req.body,
      tenantId,
      workOrderId: req.params.workOrderId
    });
    const timewindow = await storage.createTaskTimewindow(data);
    res.status(201).json(timewindow);
}));

app.patch("/api/work-orders/:workOrderId/timewindows/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const updateSchema = z.object({
      weekNumber: z.number().nullable().optional(),
      dayOfWeek: z.string().nullable().optional(),
      startTime: z.string().nullable().optional(),
      endTime: z.string().nullable().optional(),
      priority: z.number().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const timewindow = await storage.updateTaskTimewindow(req.params.id, req.params.workOrderId, tenantId, updateData);
    if (!timewindow) throw new NotFoundError("Tidsfönster hittades inte");
    res.json(timewindow);
}));

app.delete("/api/work-orders/:workOrderId/timewindows/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    await storage.deleteTaskTimewindow(req.params.id, req.params.workOrderId, tenantId);
    res.status(204).send();
}));

// ============================================
// AUTO-PLAN WEEK (Fyll Veckan) - C4
// ============================================
app.post("/api/auto-plan-week", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { weekStartDate, resourceIds, overbookingPercent = 0, geoClusteringEnabled = true } = req.body;
    // Planeringsläge: "balanced" (prioritet först) eller "delivery_time"
    // (önskad/krävd leveranstid som första styrning). Default balanserat.
    const planningMode: "balanced" | "delivery_time" =
      req.body.planningMode === "delivery_time" ? "delivery_time" : "balanced";

    if (!weekStartDate || !resourceIds || !Array.isArray(resourceIds)) {
      throw new ValidationError("weekStartDate and resourceIds[] required");
    }

    // Cross-tenant skydd: avvisa hela förfrågan om något resurs-id inte
    // tillhör tenanten (kastar NotFoundError -> 404). Tidigare filtrerade
    // vi tyst bort främmande id:n vilket dolde tenant-läckage.
    await ensureResourceIdsInTenant(resourceIds, tenantId);

    const weekStart = new Date(weekStartDate);
    const weekDays: Date[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      weekDays.push(d);
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);
    const allWorkOrders = await storage.getWorkOrders(tenantId, weekStart, weekEnd, true);
    const allResources = await storage.getResources(tenantId);

    const selectedResources = allResources.filter(r => resourceIds.includes(r.id));
    if (selectedResources.length === 0) {
      throw new ValidationError("Inga giltiga resurser hittades");
    }

    const allTeams = await storage.getTeams(tenantId);
    const allTeamMembers = await storage.getAllTeamMembers(tenantId);
    const allProfileAssignments = await storage.getResourceProfileAssignments(tenantId);
    const allProfiles = await storage.getResourceProfiles(tenantId);
    const resourceProfileCodes = new Map<string, Set<string>>();
    for (const assignment of allProfileAssignments) {
      const profile = allProfiles.find(p => p.id === assignment.profileId && p.status === "active");
      if (profile?.executionCodes && profile.executionCodes.length > 0) {
        if (!resourceProfileCodes.has(assignment.resourceId)) {
          resourceProfileCodes.set(assignment.resourceId, new Set());
        }
        for (const code of profile.executionCodes) {
          resourceProfileCodes.get(assignment.resourceId)!.add(code);
        }
      }
    }
    for (const tm of allTeamMembers) {
      const team = allTeams.find(t => t.id === tm.teamId);
      if (team?.profileIds && team.profileIds.length > 0) {
        for (const profileId of team.profileIds) {
          const profile = allProfiles.find(p => p.id === profileId && p.status === "active");
          if (profile?.executionCodes && profile.executionCodes.length > 0) {
            if (!resourceProfileCodes.has(tm.resourceId)) {
              resourceProfileCodes.set(tm.resourceId, new Set());
            }
            for (const code of profile.executionCodes) {
              resourceProfileCodes.get(tm.resourceId)!.add(code);
            }
          }
        }
      }
    }
    const resourceClusterIds = new Map<string, Set<string>>();
    for (const tm of allTeamMembers) {
      const team = allTeams.find(t => t.id === tm.teamId);
      if (team?.clusterId) {
        if (!resourceClusterIds.has(tm.resourceId)) resourceClusterIds.set(tm.resourceId, new Set());
        resourceClusterIds.get(tm.resourceId)!.add(team.clusterId);
      }
    }

    const allObjectIds = [...new Set(allWorkOrders.map(wo => wo.objectId).filter(Boolean) as string[])];
    const timeRestrictions = await getTimeRestrictionsForObjects(tenantId, allObjectIds);
    const restrictionsByObject = new Map<string, typeof timeRestrictions>();
    for (const r of timeRestrictions) {
      if (!restrictionsByObject.has(r.objectId)) restrictionsByObject.set(r.objectId, []);
      restrictionsByObject.get(r.objectId)!.push(r);
    }

    const plannableStatuses = new Set(["skapad", "planerad_pre"]);
    const unscheduledOrders = allWorkOrders.filter(wo => 
      (plannableStatuses.has(wo.orderStatus) || !wo.scheduledDate || !wo.resourceId) && 
      wo.orderStatus !== "utford" && wo.orderStatus !== "avbruten" &&
      wo.executionStatus !== "completed" && wo.executionStatus !== "invoiced"
    );

    if (unscheduledOrders.length === 0) {
      return res.json({ assignments: [], totalAssigned: 0, totalSkipped: 0 });
    }

    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    // Leveranstid: krävd deadline (plannedWindowEnd) före önskad start (plannedWindowStart).
    const deliveryKey = (o: typeof unscheduledOrders[number]): number => {
      const d = o.plannedWindowEnd ?? o.plannedWindowStart;
      return d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
    };
    const sorted = [...unscheduledOrders].sort((a, b) => {
      if (planningMode === "delivery_time") {
        // Leveranstid är första styrning; prioritet bryter lika leveranstid.
        const dA = deliveryKey(a);
        const dB = deliveryKey(b);
        if (dA !== dB) return dA - dB;
        const pA = priorityOrder[a.priority] ?? 99;
        const pB = priorityOrder[b.priority] ?? 99;
        return pA - pB;
      }
      // Balanserat (oförändrat): prioritet först, sedan önskad starttid.
      const pA = priorityOrder[a.priority] ?? 99;
      const pB = priorityOrder[b.priority] ?? 99;
      if (pA !== pB) return pA - pB;
      if (a.plannedWindowStart && b.plannedWindowStart) {
        return new Date(a.plannedWindowStart).getTime() - new Date(b.plannedWindowStart).getTime();
      }
      if (a.plannedWindowStart) return -1;
      if (b.plannedWindowStart) return 1;
      return 0;
    });

    const orderDayZonePreference = new Map<string, number>();
    let geoZoneCount = 0;
    if (geoClusteringEnabled) {
      const geoOrders = sorted.filter(o => o.taskLatitude && o.taskLongitude && !o.plannedWindowStart);
      if (geoOrders.length >= 3) {
        const numZones = Math.min(5, Math.max(2, Math.ceil(geoOrders.length / 4)));
        const coords = geoOrders.map(o => ({ lat: o.taskLatitude!, lng: o.taskLongitude! }));
        const minLat = Math.min(...coords.map(c => c.lat));
        const maxLat = Math.max(...coords.map(c => c.lat));
        const minLng = Math.min(...coords.map(c => c.lng));
        const maxLng = Math.max(...coords.map(c => c.lng));
        const latRange = maxLat - minLat || 0.01;
        const lngRange = maxLng - minLng || 0.01;

        const centroids: Array<{ lat: number; lng: number }> = [];
        for (let i = 0; i < numZones; i++) {
          centroids.push({
            lat: minLat + (latRange * (i + 0.5)) / numZones,
            lng: minLng + (lngRange * (i + 0.5)) / numZones,
          });
        }

        for (let iter = 0; iter < 8; iter++) {
          const groups: Array<Array<{ lat: number; lng: number }>> = centroids.map(() => []);
          for (const c of coords) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let j = 0; j < centroids.length; j++) {
              const d = (c.lat - centroids[j].lat) ** 2 + (c.lng - centroids[j].lng) ** 2;
              if (d < bestDist) { bestDist = d; bestIdx = j; }
            }
            groups[bestIdx].push(c);
          }
          for (let j = 0; j < centroids.length; j++) {
            if (groups[j].length > 0) {
              centroids[j] = {
                lat: groups[j].reduce((s, c) => s + c.lat, 0) / groups[j].length,
                lng: groups[j].reduce((s, c) => s + c.lng, 0) / groups[j].length,
              };
            }
          }
        }

        for (const order of geoOrders) {
          let bestZone = 0;
          let bestDist = Infinity;
          for (let j = 0; j < centroids.length; j++) {
            const d = (order.taskLatitude! - centroids[j].lat) ** 2 + (order.taskLongitude! - centroids[j].lng) ** 2;
            if (d < bestDist) { bestDist = d; bestZone = j; }
          }
          orderDayZonePreference.set(order.id, bestZone % 5);
        }
        geoZoneCount = numZones;
      }
    }

    const HOURS_PER_DAY = 8;
    const maxMinutesPerDay = HOURS_PER_DAY * 60 * (1 + overbookingPercent / 100);

    const unscheduledIds = new Set(unscheduledOrders.map(wo => wo.id));
    const existingScheduled = allWorkOrders.filter(wo => wo.scheduledDate && wo.resourceId && !unscheduledIds.has(wo.id));
    const resourceDayMinutes: Record<string, Record<string, number>> = {};
    for (const resource of selectedResources) {
      resourceDayMinutes[resource.id] = {};
      for (const day of weekDays) {
        const dayStr = day.toISOString().split("T")[0];
        const dayMinutes = existingScheduled
          .filter(wo => {
            if (wo.resourceId !== resource.id) return false;
            const woDate = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(wo.scheduledDate!);
            return woDate.toISOString().split("T")[0] === dayStr;
          })
          .reduce((sum, wo) => sum + (wo.estimatedDuration || 60), 0);
        resourceDayMinutes[resource.id][dayStr] = dayMinutes;
      }
    }

    const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const resourceDayZoneCounts = new Map<string, Map<number, number>>();
    const getDayZoneKey = (resourceId: string, dayStr: string) => `${resourceId}::${dayStr}`;
    const getDominantZone = (key: string): number | null => {
      const counts = resourceDayZoneCounts.get(key);
      if (!counts || counts.size === 0) return null;
      let best = -1, bestCount = 0;
      for (const [zone, count] of counts) {
        if (count > bestCount) { bestCount = count; best = zone; }
      }
      return best;
    };

    const assignments: Array<{
      workOrderId: string;
      resourceId: string;
      scheduledDate: string;
      scheduledStartTime: string;
      title: string;
      address: string;
      estimatedDuration: number;
      priority: string;
      geoZone?: number;
    }> = [];
    const skipped: string[] = [];
    let clusterSkipped = 0;

    for (const order of sorted) {
      let assigned = false;
      const orderDur = order.estimatedDuration || 60;

      for (const day of weekDays) {
        if (assigned) break;
        const dayStr = day.toISOString().split("T")[0];
        const dayOfWeek = day.getDay() || 7;

        if (order.plannedWindowStart) {
          const winDate = new Date(order.plannedWindowStart).toISOString().split("T")[0];
          if (winDate !== dayStr) continue;
        }

        if (order.objectId) {
          const objRestrictions = restrictionsByObject.get(order.objectId) || [];
          const blocked = objRestrictions.some(r => {
            if (!r.isActive) return false;
            if (!r.weekdays || r.weekdays.length === 0) return false;
            if (!r.weekdays.includes(dayOfWeek)) return false;
            if (r.isBlockingAllDay) return true;
            return true;
          });
          if (blocked) continue;
        }

        let bestResource: typeof selectedResources[0] | null = null;
        let bestScore = Infinity;

        for (const resource of selectedResources) {
          const resClusters = resourceClusterIds.get(resource.id);
          if (order.clusterId && resClusters && resClusters.size > 0) {
            if (!resClusters.has(order.clusterId)) continue;
          }

          if (order.executionCode) {
            const hasDirectCodes = resource.executionCodes && resource.executionCodes.length > 0;
            const directMatch = hasDirectCodes && resource.executionCodes!.includes(order.executionCode);
            const profileCodes = resourceProfileCodes.get(resource.id);
            const hasProfileCodes = profileCodes && profileCodes.size > 0;
            const profileMatch = hasProfileCodes && profileCodes.has(order.executionCode);
            if (hasDirectCodes || hasProfileCodes) {
              if (!directMatch && !profileMatch) continue;
            }
          }

          const currentLoad = resourceDayMinutes[resource.id][dayStr] || 0;
          if (currentLoad + orderDur > maxMinutesPerDay) continue;

          let score = currentLoad;

          if (order.taskLatitude && order.taskLongitude) {
            const dayOrders = [...existingScheduled, ...assignments.map(a => ({
              ...allWorkOrders.find(wo => wo.id === a.workOrderId),
              resourceId: a.resourceId,
              scheduledDate: new Date(a.scheduledDate),
            }))].filter(wo => {
              if (!wo || wo.resourceId !== resource.id) return false;
              const woDate = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(wo.scheduledDate!);
              return woDate.toISOString().split("T")[0] === dayStr;
            });

            if (dayOrders.length > 0) {
              const lastOrder = dayOrders[dayOrders.length - 1] as any;
              if (lastOrder?.taskLatitude && lastOrder?.taskLongitude) {
                const dist = haversine(lastOrder.taskLatitude, lastOrder.taskLongitude, order.taskLatitude!, order.taskLongitude!);
                score += dist * 10;
              }
            }
          }

          if (geoClusteringEnabled && geoZoneCount > 0) {
            const orderZone = orderDayZonePreference.get(order.id);
            if (orderZone !== undefined) {
              const zoneKey = getDayZoneKey(resource.id, dayStr);
              const dayDominant = getDominantZone(zoneKey);
              if (dayDominant !== null && dayDominant !== orderZone) {
                score += 200;
              } else if (dayDominant === orderZone) {
                score -= 50;
              }
            }
          }

          if (!bestResource || score < bestScore) {
            bestResource = resource;
            bestScore = score;
          }
        }

        if (bestResource) {
          const currentLoad = resourceDayMinutes[bestResource.id][dayStr] || 0;
          const startMinutes = Math.max(8 * 60, currentLoad + 8 * 60);
          const startHour = Math.floor(startMinutes / 60);
          const startMin = startMinutes % 60;
          const startTime = `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}`;

          const orderZone = orderDayZonePreference.get(order.id);
          assignments.push({
            workOrderId: order.id,
            resourceId: bestResource.id,
            scheduledDate: dayStr,
            scheduledStartTime: startTime,
            title: order.title || "Utan titel",
            address: order.objectAddress || "",
            estimatedDuration: orderDur,
            priority: order.priority,
            geoZone: orderZone,
          });

          if (orderZone !== undefined) {
            const zoneKey = getDayZoneKey(bestResource.id, dayStr);
            if (!resourceDayZoneCounts.has(zoneKey)) resourceDayZoneCounts.set(zoneKey, new Map());
            const counts = resourceDayZoneCounts.get(zoneKey)!;
            counts.set(orderZone, (counts.get(orderZone) || 0) + 1);
          }

          resourceDayMinutes[bestResource.id][dayStr] = (resourceDayMinutes[bestResource.id][dayStr] || 0) + orderDur;
          assigned = true;
        }
      }

      if (!assigned) {
        skipped.push(order.id);
        if (order.clusterId) {
          const anyResourceMatchesCluster = selectedResources.some(r => {
            const rc = resourceClusterIds.get(r.id);
            return !rc || rc.size === 0 || rc.has(order.clusterId!);
          });
          if (!anyResourceMatchesCluster) clusterSkipped++;
        }
      }
    }

    const capacitySummary: Record<string, number> = {};
    for (const resource of selectedResources) {
      for (const day of weekDays) {
        const dayStr = day.toISOString().split("T")[0];
        const used = resourceDayMinutes[resource.id][dayStr] || 0;
        capacitySummary[dayStr] = (capacitySummary[dayStr] || 0) + used;
      }
    }

    const geoSpreadPerDay: Record<string, { totalJobs: number; zonesUsed: number; dominantZonePct: number }> = {};
    if (geoClusteringEnabled && geoZoneCount > 0) {
      for (const day of weekDays) {
        const dayStr = day.toISOString().split("T")[0];
        const dayAssignments = assignments.filter(a => a.scheduledDate === dayStr && a.geoZone !== undefined);
        if (dayAssignments.length > 0) {
          const zoneCounts = new Map<number, number>();
          for (const a of dayAssignments) {
            zoneCounts.set(a.geoZone!, (zoneCounts.get(a.geoZone!) || 0) + 1);
          }
          const maxZoneCount = Math.max(...zoneCounts.values());
          geoSpreadPerDay[dayStr] = {
            totalJobs: dayAssignments.length,
            zonesUsed: zoneCounts.size,
            dominantZonePct: Math.round((maxZoneCount / dayAssignments.length) * 100),
          };
        }
      }
    }

    res.json({
      assignments,
      totalAssigned: assignments.length,
      totalSkipped: skipped.length,
      totalUnscheduled: unscheduledOrders.length,
      clusterSkipped,
      skippedIds: skipped,
      capacityPerDay: capacitySummary,
      maxMinutesPerDay: Math.round(maxMinutesPerDay),
      resourceCount: selectedResources.length,
      geoClusteringEnabled,
      geoZoneCount,
      geoSpreadPerDay,
    });
}));

app.post("/api/auto-plan-week/apply", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { assignments } = req.body;

    if (!assignments || !Array.isArray(assignments)) {
      throw new ValidationError("assignments[] required");
    }

    // Validering: varje assignment måste innehålla ett icke-tomt resourceId
    // (sträng). Tidigare filtrerades saknade id:n tyst bort.
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      if (!a || typeof a.resourceId !== "string" || a.resourceId.trim() === "") {
        throw new ValidationError(`assignments[${i}].resourceId krävs (icke-tom sträng)`);
      }
    }

    // Cross-tenant skydd: avvisa hela request:en om något resourceId i
    // assignments inte tillhör tenanten. Tidigare hoppade vi tyst över
    // främmande id:n vilket dolde tenant-läckage.
    const assignmentResourceIds = assignments.map((a: { resourceId: string }) => a.resourceId);
    await ensureResourceIdsInTenant(assignmentResourceIds, tenantId);

    const results = [];
    const skipped: Array<{ workOrderId: string; reason: string }> = [];
    for (const assignment of assignments) {
      const workOrder = await storage.getWorkOrder(assignment.workOrderId);
      if (!verifyTenantOwnership(workOrder, tenantId)) {
        // Hård avvisning för cross-tenant arbetsorder — undviker tyst läckage
        // och är konsistent med övriga planeringsendpoints (404 NotFoundError).
        throw new NotFoundError("Arbetsorder hittades inte");
      }
      // Resource-tenant kontrolleras redan i pre-checken ovan via
      // ensureResourceIdsInTenant — ingen ytterligare check behövs här.

      // Inferens sker nu i storage.updateWorkOrder via samma cache:ade helper.
      // Vi skickar inte med teamId i payloaden här — det betyder att storage-
      // lagret kommer härleda korrekt teamId (eller sätta null om resursen
      // saknar team) baserat på den nya resourceId.
      const updatePayload: Record<string, unknown> = {
        resourceId: assignment.resourceId,
        scheduledDate: new Date(assignment.scheduledDate),
        scheduledStartTime: assignment.scheduledStartTime,
        orderStatus: "planerad_pre",
        executionStatus: "planned_rough",
      };

      const updated = await storage.updateWorkOrder(assignment.workOrderId, updatePayload);
      results.push(updated);
    }

    res.json({ applied: results.length, skipped });
}));

// ============================================
// TASK DEPENDENCIES - Beroendelogik
// ============================================

app.get("/api/work-orders/:workOrderId/dependencies", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const dependencies = await storage.getTaskDependencies(req.params.workOrderId);
    res.json(dependencies);
}));

app.get("/api/work-orders/:workOrderId/dependents", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const dependents = await storage.getTaskDependents(req.params.workOrderId);
    res.json(dependents);
}));

app.post("/api/work-orders/:workOrderId/dependencies", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const data = insertTaskDependencySchema.parse({
      ...req.body,
      tenantId,
      workOrderId: req.params.workOrderId
    });
    const dependency = await storage.createTaskDependency(data);
    res.status(201).json(dependency);
}));

app.delete("/api/work-orders/:workOrderId/dependencies/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    await storage.deleteTaskDependency(req.params.id, tenantId);
    res.status(204).send();
}));

app.post("/api/task-dependencies/batch", asyncHandler(async (req, res) => {
    const { workOrderIds } = req.body as { workOrderIds: string[] };
    if (!Array.isArray(workOrderIds)) {
      throw new ValidationError("workOrderIds must be an array");
    }
    const result = await storage.getTaskDependenciesBatch(workOrderIds);
    res.json(result);
}));

// ============================================
// C7: AUTO-CREATE PICKUP TASKS (Beroendeartiklar)
// ============================================

app.post("/api/work-orders/:workOrderId/generate-pickup-tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const mainWorkOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!mainWorkOrder || !verifyTenantOwnership(mainWorkOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const lines = await storage.getWorkOrderLines(req.params.workOrderId);
    const createdPickups: any[] = [];

    for (const line of lines) {
      if (!line.articleId) continue;
      const article = await storage.getArticle(line.articleId);
      if (!article) continue;
      // Task #989: generaliserat — utöver beroendeartiklar genererar nu även
      // varuartiklar med lagerplats en plockuppgift (hämta@lager före leverans).
      const isBeroende = article.articleType === "beroende";
      const isStockVara = shouldSplitForStockPickup(article);
      if (!isBeroende && !isStockVara) continue;

      const minutesBefore = article.dependencyMinutesBefore || 120;
      let pickupDate: Date | null = null;
      let pickupStartTime: string | null = null;

      if (mainWorkOrder.scheduledDate) {
        const mainDate = mainWorkOrder.scheduledDate instanceof Date 
          ? mainWorkOrder.scheduledDate 
          : new Date(mainWorkOrder.scheduledDate);
        const [mainH, mainM] = (mainWorkOrder.scheduledStartTime || "08:00").split(":").map(Number);
        const mainMinutes = mainH * 60 + mainM;
        const pickupMinutes = mainMinutes - minutesBefore;

        if (pickupMinutes >= 0) {
          pickupDate = mainDate;
        } else {
          pickupDate = new Date(mainDate);
          pickupDate.setDate(pickupDate.getDate() - Math.ceil(Math.abs(pickupMinutes) / (8 * 60)));
        }

        const effectivePickupMinutes = ((pickupMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
        const clampedMinutes = Math.max(7 * 60, Math.min(effectivePickupMinutes, 17 * 60));
        const pH = Math.floor(clampedMinutes / 60);
        const pM = clampedMinutes % 60;
        pickupStartTime = `${pH.toString().padStart(2, "0")}:${pM.toString().padStart(2, "0")}`;
      }

      const pickupWorkOrder = await storage.createWorkOrder({
        tenantId,
        customerId: mainWorkOrder.customerId,
        objectId: mainWorkOrder.objectId,
        resourceId: mainWorkOrder.resourceId,
        title: `Plocka: ${article.name}`,
        description: `Automatisk plockuppgift för ${article.name}. Lagerplats: ${article.stockLocation || "Ej angiven"}`,
        orderType: "service",
        priority: mainWorkOrder.priority,
        status: "draft",
        orderStatus: mainWorkOrder.resourceId ? "planerad_pre" : "skapad",
        scheduledDate: pickupDate,
        scheduledStartTime: pickupStartTime,
        estimatedDuration: article.productionTime || 30,
        executionStatus: pickupDate ? "planned_rough" : "not_planned",
        creationMethod: "automatic",
        executionCode: mainWorkOrder.executionCode || undefined,
        // Tidskod ärvs från förälder-WO (BOM/plock-derivat).
        frozenTimeCode: mainWorkOrder.frozenTimeCode || undefined,
        taskLatitude: article.stockLatitude || undefined,
        taskLongitude: article.stockLongitude || undefined,
        logisticsRole: "pickup",
        // Task #1369: derivat ärver huvudorderns ursprung + konceptreferens.
        sourceType: mainWorkOrder.sourceType || undefined,
        orderConceptId: mainWorkOrder.orderConceptId || undefined,
      });

      await storage.createTaskDependency({
        tenantId,
        workOrderId: req.params.workOrderId,
        dependsOnWorkOrderId: pickupWorkOrder.id,
        dependencyType: "automatic",
        structuralArticleId: article.id,
      });

      createdPickups.push({
        pickupWorkOrderId: pickupWorkOrder.id,
        articleName: article.name,
        articleId: article.id,
        scheduledDate: pickupDate?.toISOString().split("T")[0],
        scheduledStartTime: pickupStartTime,
        stockLocation: article.stockLocation,
      });
    }

    res.json({
      created: createdPickups.length,
      pickupTasks: createdPickups,
      mainWorkOrderId: req.params.workOrderId,
    });
}));

// C7: Get full dependency chain for a work order
app.get("/api/work-orders/:workOrderId/dependency-chain", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const dependencies = await storage.getTaskDependencies(req.params.workOrderId);
    const dependents = await storage.getTaskDependents(req.params.workOrderId);

    const chain: any[] = [];

    for (const dep of dependencies) {
      const depOrder = await storage.getWorkOrder(dep.dependsOnWorkOrderId);
      if (depOrder) {
        chain.push({
          type: "depends_on",
          dependencyType: dep.dependencyType,
          workOrder: {
            id: depOrder.id,
            title: depOrder.title,
            orderStatus: depOrder.orderStatus,
            executionStatus: depOrder.executionStatus,
            scheduledDate: depOrder.scheduledDate,
            scheduledStartTime: depOrder.scheduledStartTime,
            creationMethod: depOrder.creationMethod,
          },
        });
      }
    }

    for (const dep of dependents) {
      const depOrder = await storage.getWorkOrder(dep.workOrderId);
      if (depOrder) {
        chain.push({
          type: "blocks",
          dependencyType: dep.dependencyType,
          workOrder: {
            id: depOrder.id,
            title: depOrder.title,
            orderStatus: depOrder.orderStatus,
            executionStatus: depOrder.executionStatus,
            scheduledDate: depOrder.scheduledDate,
            scheduledStartTime: depOrder.scheduledStartTime,
            creationMethod: depOrder.creationMethod,
          },
        });
      }
    }

    res.json({
      workOrderId: req.params.workOrderId,
      chain,
    });
}));

// ============================================
// TASK INFORMATION - Bilagor och info
// ============================================

app.get("/api/work-orders/:workOrderId/information", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const information = await storage.getTaskInformation(req.params.workOrderId);
    res.json(information);
}));

app.post("/api/work-orders/:workOrderId/information", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const data = insertTaskInformationSchema.parse({
      ...req.body,
      tenantId,
      workOrderId: req.params.workOrderId
    });
    const info = await storage.createTaskInformation(data);
    res.status(201).json(info);
}));

app.patch("/api/work-orders/:workOrderId/information/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    const updateSchema = z.object({
      infoValue: z.string().nullable().optional(),
      hasLogic: z.boolean().optional(),
      linkedArticleId: z.string().nullable().optional(),
      quantity: z.number().nullable().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const info = await storage.updateTaskInformation(req.params.id, req.params.workOrderId, tenantId, updateData);
    if (!info) throw new NotFoundError("Information hittades inte");
    res.json(info);
}));

app.delete("/api/work-orders/:workOrderId/information/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    await storage.deleteTaskInformation(req.params.id, req.params.workOrderId, tenantId);
    res.status(204).send();
}));

// ============================================
// TIDSRESTRIKTIONER (Etapp 5) — metadata-backad läsvy
// Källa: metadata-fältet "Tidsrestriktioner" (area 'tid'). Skrivning sker via
// vanliga metadata-endpoints; gamla POST/PATCH/DELETE-endpoints är borttagna.
// ============================================

app.get("/api/objects/:objectId/time-restrictions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const restrictions = await getTimeRestrictionsForObjects(tenantId, [req.params.objectId]);
    res.json(restrictions);
}));

app.get("/api/time-restrictions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectIds = req.query.objectIds ? (req.query.objectIds as string).split(",") : [];
    const restrictions = objectIds.length > 0
      ? await getTimeRestrictionsForObjects(tenantId, objectIds)
      : await getTimeRestrictionsForTenant(tenantId);
    res.json(restrictions);
}));

app.get("/api/slot-preferences/aggregate", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectIds = req.query.objectIds ? (req.query.objectIds as string).split(",") : [];
    if (objectIds.length === 0) return res.json([]);
    const restrictions = await getTimeRestrictionsForObjects(tenantId, objectIds);
    const objectNames = new Map<string, string>();
    for (const oid of objectIds) {
      const obj = await storage.getObject(oid);
      if (obj && obj.tenantId === tenantId) objectNames.set(oid, obj.name);
    }
    const aggregated = restrictions.map(r => ({
      ...r,
      objectName: objectNames.get(r.objectId) || r.objectId,
    }));
    res.json(aggregated);
}));

// C10 - Expand structural article into sub-step work orders
app.post("/api/work-orders/:id/expand-structural", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder) throw new NotFoundError("Arbetsorder hittades inte");

    const articleId = workOrder.structuralArticleId;
    if (!articleId) throw new ValidationError("Arbetsordern saknar artikel");

    const subArticles = await storage.getStructuralArticlesByParent(articleId);
    if (subArticles.length === 0) return res.json({ created: [], message: "No structural sub-articles found" });

    const created: any[] = [];
    for (const sub of subArticles) {
      const childArticle = await storage.getArticle(sub.childArticleId);
      const subWorkOrder = await storage.createWorkOrder({
        tenantId,
        title: sub.stepName || childArticle?.name || "Delsteg",
        description: `Delsteg ${sub.sequenceOrder}: ${sub.stepName || childArticle?.name || ""}`,
        status: "pending",
        executionStatus: "not_planned",
        objectId: workOrder.objectId,
        customerId: workOrder.customerId,
        resourceId: workOrder.resourceId,
        scheduledDate: workOrder.scheduledDate,
        scheduledStartTime: workOrder.scheduledStartTime,
        estimatedDuration: sub.defaultDurationMinutes || childArticle?.productionTime || 30,
        structuralArticleId: articleId,
        creationMethod: "structural",
        executionCode: workOrder.executionCode,
        // Tidskod ärvs från förälder-WO (strukturellt delsteg).
        frozenTimeCode: workOrder.frozenTimeCode,
        // Task #1369: delsteg ärver förälder-WO:ns ursprung + konceptreferens.
        sourceType: workOrder.sourceType || undefined,
        orderConceptId: workOrder.orderConceptId || undefined,
      });

      await storage.createTaskDependency({
        tenantId,
        workOrderId: subWorkOrder.id,
        dependsOnWorkOrderId: workOrder.id,
        dependencyType: "structural",
        structuralArticleId: sub.childArticleId,
      });

      created.push({
        workOrder: subWorkOrder,
        stepName: sub.stepName,
        sequenceOrder: sub.sequenceOrder,
        isOptional: sub.isOptional,
      });
    }

    res.json({ created, parentId: workOrder.id });
}));

// C10 - Get sub-steps for a work order (structural children)
app.get("/api/work-orders/:id/sub-steps", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder) throw new NotFoundError("Arbetsorder hittades inte");

    const allDeps = await storage.getTaskDependencies(req.params.id);
    const structuralDeps = allDeps.filter(d => d.dependsOnWorkOrderId === req.params.id && d.dependencyType === "structural");

    const subSteps: any[] = [];
    for (const dep of structuralDeps) {
      const subWo = await storage.getWorkOrder(dep.workOrderId);
      if (subWo) {
        subSteps.push({
          id: subWo.id,
          title: subWo.title,
          status: subWo.orderStatus,
          executionStatus: subWo.executionStatus,
          estimatedDuration: subWo.estimatedDuration,
          structuralArticleId: dep.structuralArticleId,
        });
      }
    }

    const articleId = workOrder.structuralArticleId;
    let structuralInfo = null;
    if (articleId) {
      const subArticles = await storage.getStructuralArticlesByParent(articleId);
      if (subArticles.length > 0) {
        structuralInfo = {
          totalSteps: subArticles.length,
          steps: subArticles.map(s => ({
            childArticleId: s.childArticleId,
            stepName: s.stepName,
            sequenceOrder: s.sequenceOrder,
            isOptional: s.isOptional,
            defaultDurationMinutes: s.defaultDurationMinutes,
          })),
        };
      }
    }

    const completedCount = subSteps.filter(s => s.executionStatus === "completed" || s.executionStatus === "inspected" || s.executionStatus === "invoiced").length;

    res.json({
      subSteps,
      structuralInfo,
      progress: {
        completed: completedCount,
        total: subSteps.length || structuralInfo?.totalSteps || 0,
      },
    });
}));

// ============================================
// STRUCTURAL ARTICLES - Artiklar med beroendeuppgifter
// ============================================

app.get("/api/structural-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const articles = await storage.getStructuralArticles(tenantId);
    res.json(articles);
}));

app.get("/api/articles/:articleId/structural-children", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.articleId);
    if (!verifyTenantOwnership(article, tenantId)) {
      throw new NotFoundError("Artikel hittades inte");
    }
    const children = await storage.getStructuralArticlesByParent(req.params.articleId);
    res.json(children);
}));

app.post("/api/structural-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertStructuralArticleSchema.parse({
      ...req.body,
      tenantId
    });
    const article = await storage.createStructuralArticle(data);
    res.status(201).json(article);
}));

app.patch("/api/structural-articles/:id", asyncHandler(async (req, res) => {
    const updateSchema = z.object({
      sequenceOrder: z.number().optional(),
      stepName: z.string().nullable().optional(),
      taskType: z.string().nullable().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.updateStructuralArticle(req.params.id, tenantId, updateData);
    if (!article) throw new NotFoundError("Strukturartikel hittades inte");
    res.json(article);
}));

app.delete("/api/structural-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteStructuralArticle(req.params.id, tenantId);
    res.status(204).send();
}));

// Preview dynamic structural article steps
app.post("/api/structural-articles/:parentArticleId/preview-tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { parentArticleId } = req.params;
    const { executionDate, objectMetadata, individualObjects } = req.body;
    
    // Get all structural articles for this parent
    const allStructuralArticles = await storage.getStructuralArticles(tenantId);
    const steps = allStructuralArticles.filter(sa => sa.parentArticleId === parentArticleId);
    
    if (steps.length === 0) {
      return res.json({ 
        tasks: [], 
        totalDuration: 0, 
        message: "Inga strukturartiklar hittades för denna artikel" 
      });
    }
    
    const { generateTasksFromStructuralArticle, calculateTotalDuration } = await import('../structural-article-utils');
    
    const date = executionDate ? new Date(executionDate) : new Date();
    const metadata = objectMetadata || {};
    const objects = individualObjects || [];
    
    const tasks = generateTasksFromStructuralArticle(steps, date, metadata, objects);
    const totalDuration = calculateTotalDuration(tasks);
    
    // Get article names for display
    const allArticles = await storage.getArticles(tenantId);
    const articlesMap = new Map(allArticles.map(a => [a.id, a]));
    
    const tasksWithNames = tasks.map(task => ({
      ...task,
      articleName: articlesMap.get(task.articleId)?.name || 'Okänd artikel',
    }));
    
    res.json({
      tasks: tasksWithNames,
      totalDuration,
      applicableCount: tasks.filter(t => t.isApplicable).length,
      skippedCount: tasks.filter(t => !t.isApplicable).length,
    });
}));

app.post("/api/work-orders/:workOrderId/expand-structural", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.workOrderId);
    if (!workOrder || !verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    // Use structuralArticleId from work order
    const structuralArticleId = workOrder.structuralArticleId;
    if (!structuralArticleId) {
      return res.json({ expanded: [], message: "Ingen strukturartikel att expandera" });
    }
    
    const allStructuralArticles = await storage.getStructuralArticles(tenantId);
    const structuralArticlesMap = new Map<string, typeof allStructuralArticles>();
    
    for (const sa of allStructuralArticles) {
      const existing = structuralArticlesMap.get(sa.parentArticleId) || [];
      existing.push(sa);
      structuralArticlesMap.set(sa.parentArticleId, existing);
    }

    if (!structuralArticlesMap.has(structuralArticleId)) {
      return res.json({ expanded: [], message: "Inga strukturartiklar hittades" });
    }

    const allArticles = await storage.getArticles(tenantId);
    const articlesMap = new Map(allArticles.map(a => [a.id, a]));

    const { expandStructuralArticle } = await import("../ai-planner");

    const children = structuralArticlesMap.get(structuralArticleId) || [];
    
    const result = await expandStructuralArticle(
      workOrder,
      structuralArticleId,
      children,
      articlesMap,
      async (data: Record<string, unknown>) => storage.createWorkOrder({ ...data, tenantId: workOrder.tenantId } as typeof insertWorkOrderSchema._type),
      async (data: Record<string, unknown>) => storage.createTaskDependency(data as typeof insertTaskDependencySchema._type)
    );

    res.json({
      expanded: [result],
      message: `${result.createdWorkOrders.length} deluppgifter skapades`
    });
}));

// Route Optimization API
app.post("/api/route/optimize", asyncHandler(async (req, res) => {
    const { stops } = req.body;
    
    if (!stops || !Array.isArray(stops)) {
      throw new ValidationError("Stops array krävs");
    }

    const tenantId = getTenantIdWithFallback(req);
    const { enforceBudgetAndRateLimit } = await import("../ai-budget-service");
    const rtEnforcement = await enforceBudgetAndRateLimit(tenantId, "planning");
    if (!rtEnforcement.allowed) {
      if (rtEnforcement.errorType === "ratelimit") {
        res.set("Retry-After", String(rtEnforcement.retryAfterSeconds || 60));
      }
      return res.status(429).json({ error: rtEnforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden", message: rtEnforcement.errorMessage });
    }
    
    const { optimizeRoute, runWithAIContext } = await import("../ai-planner");
    
    const result = await runWithAIContext({ tenantId, model: rtEnforcement.model }, () =>
      optimizeRoute(stops)
    );
    
    res.json(result);
}));

// Generate Google Maps URL for route
app.post("/api/route/google-maps-url", asyncHandler(async (req, res) => {
    const { stops } = req.body;
    
    if (!stops || !Array.isArray(stops)) {
      throw new ValidationError("Stops array krävs");
    }
    
    const { generateGoogleMapsUrl } = await import("../ai-planner");
    
    const url = generateGoogleMapsUrl(stops);
    
    res.json({ url });
}));

// Send route to mobile app via WebSocket
app.post("/api/route/send-to-mobile", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, stops, date, googleMapsUrl } = req.body;
    
    if (!resourceId || !stops) {
      throw new ValidationError("ResourceId och stops krävs");
    }

    // Avvisa cross-tenant resourceId så att en planerare i tenant A inte kan
    // pusha en rutt direkt till en mobil i tenant B via WebSocket.
    await ensureResourceInTenant(resourceId, tenantId);

    // Send notification to the specific resource's mobile app
    notificationService.sendToResource(resourceId, {
      type: "route_update",
      title: "Ny rutt tilldelad",
      message: `Du har fått en rutt med ${stops.length} stopp för ${date}`,
      data: {
        stops,
        googleMapsUrl,
        date
      }
    });
    
    res.json({ 
      success: true, 
      message: `Rutt skickad till resurs ${resourceId}` 
    });
}));

// ============================================
// ORDER CONCEPTS API
// ============================================

app.get("/api/order-concepts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concepts = await storage.getOrderConcepts(tenantId);
    res.json(concepts);
}));

app.get("/api/order-concepts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.id);
    const verifiedConcept = verifyTenantOwnership(concept, tenantId);
    if (!verifiedConcept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    const filters = await storage.getConceptFilters(verifiedConcept.id);
    res.json({ ...verifiedConcept, filters });
}));

app.post("/api/order-concepts", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    
    if (req.body.customerMode && !["HARDCODED", "FROM_METADATA"].includes(req.body.customerMode)) {
      throw new ValidationError("customerMode måste vara HARDCODED eller FROM_METADATA");
    }
    
    const concept = await storage.createOrderConcept({
      ...req.body,
      tenantId,
      createdBy: userId
    });
    res.status(201).json(concept);
}));

app.patch("/api/order-concepts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    if (req.body.customerMode && !["HARDCODED", "FROM_METADATA"].includes(req.body.customerMode)) {
      throw new ValidationError("customerMode måste vara HARDCODED eller FROM_METADATA");
    }

    // Task #1124: huvudreferens-lägen (Er referens / Ert ordernr) styr om värdet är
    // fast eller härleds per objekt ur metadata. Samma kanoniska värden som customerMode.
    for (const modeField of ["customerReferenceMode", "customerLabelMode"] as const) {
      const v = (req.body as Record<string, unknown>)[modeField];
      if (v != null && !["HARDCODED", "FROM_METADATA"].includes(v as string)) {
        throw new ValidationError(`${modeField} måste vara HARDCODED eller FROM_METADATA`);
      }
    }

    // Task #1124: radreferenser = lista av metadata-katalognamn (svensk katalog).
    if (req.body.invoiceRowReferenceFields != null && !Array.isArray(req.body.invoiceRowReferenceFields)) {
      throw new ValidationError("invoiceRowReferenceFields måste vara en lista");
    }

    // Task #1055: fast pris-bas styr hur det fasta beloppet fördelas vid expansion.
    if (
      req.body.fixedPriceBasis != null &&
      !["per_concept", "per_task", "per_object"].includes(req.body.fixedPriceBasis)
    ) {
      throw new ValidationError("fixedPriceBasis måste vara per_concept, per_task eller per_object");
    }

    // Session 9B — timestamp-kolumner kräver Date-objekt (inte ISO-sträng) i drizzle .set().
    // Task #934: deliveryStart (abonnemangets startdatum) coerce:as på samma sätt.
    for (const dateField of ["subscriptionAdjustmentDate", "intervalStartDate", "intervalEndDate", "deliveryStart"] as const) {
      const v = (req.body as Record<string, unknown>)[dateField];
      if (typeof v === "string" && v.trim()) {
        const parsed = new Date(v);
        if (!Number.isNaN(parsed.getTime())) (req.body as Record<string, unknown>)[dateField] = parsed;
        else (req.body as Record<string, unknown>)[dateField] = null;
      } else if (v === "" ) {
        (req.body as Record<string, unknown>)[dateField] = null;
      }
    }

    const concept = await storage.updateOrderConcept(req.params.id, tenantId, req.body);
    res.json(concept);
}));

app.delete("/api/order-concepts/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    await storage.deleteOrderConcept(req.params.id, tenantId);
    res.status(204).send();
}));

// Task #937: Förhandskontroll av kund-härledning per objekt för ett orderkoncept.
// Repurposad från legacy `objects.customer_id` (under avveckling, ADR v3) till samma
// resolver som /execute använder. Kräver `conceptId` (för customerMode/fält/fast kund);
// `objectIds` är valfritt — utelämnas det matchas objekt via konceptets filter, identiskt
// med körningen. HARDCODED rapporterar bara om den fasta kunden saknas/ogiltig.
app.post("/api/order-concepts/check-customer-metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { conceptId, objectIds } = req.body as { conceptId?: string; objectIds?: string[] };
    if (!conceptId) {
      throw new ValidationError("conceptId krävs");
    }
    const rawConcept = await storage.getOrderConcept(conceptId);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    // Mängden objekt: explicit lista (tenant-filtrerad) eller konceptets matchande objekt.
    let objectsList: Array<{ id: string; name: string; objectNumber: string | null }>;
    if (Array.isArray(objectIds) && objectIds.length > 0) {
      objectsList = await storage.getObjectsByIds(tenantId, objectIds);
    } else {
      const filters = await storage.getConceptFilters(concept.id);
      const filterInputs = filters.map((f: any) => ({
        metadataKey: f.metadataKey,
        operator: f.operator,
        filterValue: f.filterValue,
      }));
      const { matchingObjects } = await resolveConceptMatchingObjects(
        tenantId,
        concept as any,
        filterInputs,
        { fallbackAllObjects: true },
      );
      objectsList = matchingObjects.map((o) => ({ id: o.id, name: o.name, objectNumber: o.objectNumber }));
    }

    const customers = await storage.getCustomers(tenantId);
    const lookup = buildCustomerLookup(customers);

    const withCustomer: Array<{ id: string; name: string; customerId: string; customerName: string; matchedBy: string }> = [];
    const missingValue: Array<{ id: string; name: string; objectNumber: string | null }> = [];
    const unmatched: Array<{ id: string; name: string; objectNumber: string | null; rawValue: string }> = [];
    const ambiguous: Array<{ id: string; name: string; objectNumber: string | null; rawValue: string; candidateIds: string[] }> = [];
    let noField = false;
    let hardcodedMissing = false;

    for (const obj of objectsList) {
      const r = await resolveConceptCustomerForObject(tenantId, concept, obj.id, lookup);
      switch (r.status) {
        case "ok":
          withCustomer.push({ id: obj.id, name: obj.name, customerId: r.customerId, customerName: r.customerName, matchedBy: r.matchedBy });
          break;
        case "missing_value":
          missingValue.push({ id: obj.id, name: obj.name, objectNumber: obj.objectNumber });
          break;
        case "unmatched":
          unmatched.push({ id: obj.id, name: obj.name, objectNumber: obj.objectNumber, rawValue: r.rawValue });
          break;
        case "ambiguous":
          ambiguous.push({ id: obj.id, name: obj.name, objectNumber: obj.objectNumber, rawValue: r.rawValue, candidateIds: r.candidateIds });
          break;
        case "no_field":
          noField = true;
          break;
        case "hardcoded_missing":
          hardcodedMissing = true;
          break;
      }
    }

    res.json({
      customerMode: concept.customerMode ?? "HARDCODED",
      customerMetadataField: concept.customerMetadataField ?? null,
      total: objectsList.length,
      withCustomer,
      missingValue,
      unmatched,
      ambiguous,
      noField,
      hardcodedMissing,
    });
}));

// Concept Filters
app.get("/api/order-concepts/:conceptId/filters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.conceptId);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    const filters = await storage.getConceptFilters(req.params.conceptId);
    res.json(filters);
}));

app.post("/api/order-concepts/:conceptId/filters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.conceptId);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    const filter = await storage.createConceptFilter({
      ...req.body,
      orderConceptId: req.params.conceptId
    });
    res.status(201).json(filter);
}));

app.delete("/api/order-concepts/:conceptId/filters/:filterId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.conceptId);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }
    
    await storage.deleteConceptFilter(req.params.filterId, req.params.conceptId);
    res.status(204).send();
}));

// Execute order concept - generates assignments from filters
app.post("/api/order-concepts/:id/execute", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));

    // Resolva målobjekt (gren-subträd via target_object_ids → legacy kluster →
    // alla tenant-objekt) och applicera villkoren via den delade modulen så att
    // execute matchar förhandsvisning (condition-preview) IDENTISKT — samma
    // operator-switch, samma batch-laddade metadata. ADR v3, Session 9B.
    const { targetObjects, matchingObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      filterInputs,
      { fallbackAllObjects: true },
    );

    // Task #1205 (fält 54): läsbar matchningsorsak per objekt (delad batch) —
    // snapshotas på call_off- och föruppgifter så att VARFÖR objektet hakades på
    // överlever senare filteredigeringar.
    const matchReasonByObject = await buildMatchReasonsForObjects(
      tenantId,
      matchingObjects,
      filterInputs,
    );

    // Generate assignments for each matching object
    const createdAssignments = [];
    // Task #911-beslut: Stockholm-normaliseringen gäller ENBART datum-only-
    // metadatavärden via parseDeliveryDate. Konceptets schemalagda fallback nedan
    // kommer som full ISO-tidsstämpel från klienten (med tid/offset) och ska
    // tolkas oförändrat — den är redan en entydig instant och har inget
    // datum-only/UTC-midnatt-problem.
    const scheduledDate = req.body.scheduledDate ? new Date(req.body.scheduledDate) : undefined;
    // Task #901 (B8): observability — räkna hur många assignments som fick sin
    // leveranstid från metadatafältet resp. föll tillbaka på schemalagt datum.
    let deliveryTimeFromMetadata = 0;
    let deliveryTimeFallback = 0;
    
    // Fetch article + resolve customer-specific price once before the loop.
    // Task #391: Använd resolveArticlePrice så kundunik/rabattbrev slår igenom
    // (tidigare användes article.listPrice direkt → kund-priser ignorerades).
    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
    let linkedArticleId: string | null = concept.articleId ?? null;
    let linkedPrice = { price: 0, cost: 0, productionMinutes: 0, priceListId: null as string | null };
    if (concept.articleId) {
      // utgått→ersättning + tenant-spärr via delad helper (säkerhetskritiskt: spärrar
      // även den initiala artikeln, inte bara ersättningarna) — samma källa som
      // preview/run-rolling/article-hit-summary så Fortnox-körningen aldrig divergerar.
      linkedArticle = await resolveActiveArticle(tenantId, await storage.getArticle(concept.articleId));
      linkedArticleId = linkedArticle?.id ?? null;
      if (linkedArticle && concept.customerId) {
        const info = await storage.resolveArticlePrice(tenantId, linkedArticleId!, concept.customerId);
        linkedPrice = {
          price: info.price,
          cost: info.cost,
          productionMinutes: info.productionMinutes,
          priceListId: info.priceListId,
        };
      } else if (linkedArticle) {
        linkedPrice = {
          price: linkedArticle.listPrice || 0,
          cost: resolveArticleCostBasisOre(linkedArticle),
          productionMinutes: linkedArticle.productionTime || 0,
          priceListId: null,
        };
      }
    }

    // Task #934: De tre faktureringsmetoderna exekveras distinkt. invoiceModel
    // (med fallback till legacy scenario) avgör vägen — inte längre alltid
    // engångs-avrop. Avrop faller igenom till engångsloopen nedan; Schema
    // genererar återkommande jobb; Abonnemang skapar inga engångsjobb utan
    // aktiverar abonnemanget (nästa fakturadatum + summor).
    const conceptMethod = getOrderConceptMethod(concept);

    // Task #1187: ett abonnemang med leveransschema/intervall genererar utförbara
    // uppgifter som kvittas mot avgiften vid slutförande. Ett avgifts-abonnemang utan
    // schema skapar inga uppgifter (oförändrat beteende).
    const subscriptionHasSchedule =
      conceptMethod === "subscription" && buildScheduleDateTargets(concept) !== null;

    // Task #976: artikelträff — avgör för vilka inpekade objekt den länkade artikeln
    // FAKTISKT träffar (metadata-/formel-drivet antal > 0). Endast träff-objekt ska
    // expanderas, prissättas och räknas. Beräknas en gång och konsumeras av call_off-
    // loopen, schema-generatorn och pre-task-loopen. Ett avgifts-abonnemang (utan
    // schema) skapar inga uppgifter och berörs inte; ett schemalagt abonnemang beräknar
    // träffar precis som schema. Tjänsten faller tillbaka på "alla träffar" när inget
    // antalsläge är metadata-drivet (legacy-beteende bevaras).
    let hits: ConceptArticleHits | null = null;
    if (conceptMethod !== "subscription" || subscriptionHasSchedule) {
      hits = await resolveConceptArticleHits({
        tenantId,
        concept,
        linkedArticle,
        matchingObjects,
      });
    }
    const expansionObjects = hits ? hits.hitObjects : matchingObjects;

    // Task #997 (Tidsmotor): frys konceptets kompletta viktade tidsregel-paket
    // (hårda + mjuka regler med polaritet + vikt) per objekt vid expansion.
    // Beräknas en gång för alla träff-objekt och delas av huvuduppgift + föruppgift.
    // Objekt utan tillämpliga regler saknas i kartan ⇒ frozenTimeRules=null
    // (dagens fallback oförändrad).
    const frozenTimeRulesByObject = await buildConceptTimeRulePackagesByObject(
      tenantId,
      (concept as any).deliveryRestrictions,
      expansionObjects.map((o) => o.id),
    );

    // Task #937: FROM_METADATA — härled order-/faktureringskund per objekt.
    // HARDCODED stämplar konceptets fasta kund; FROM_METADATA läser ett metadatafält
    // (svenska katalogen) på varje objekt och matchar mot kundregistret. Pre-passet körs
    // för call_off + schema (ej abonnemang, som inte skapar uppgifter) över träff-
    // objekten (miss-objekt ska aldrig blockera expansionen) och kastar innan någon
    // skrivning sker om något objekt inte kan resolvas (ingen partiell expansion).
    const { isFromMetadata, customerIdForObject, resolvePrice: resolvePriceMemo } =
      await prepareConceptCustomerPricing({
        concept,
        tenantId,
        matchingObjects: expansionObjects,
        runPrePass: conceptMethod !== "subscription" || subscriptionHasSchedule,
      });

    if (conceptMethod === "subscription") {
      // Task #1057: dynamisk avgift = summan av uppgifternas ordervärde (kanonisk
      // ordervärdes-motor). Aktivering kräver att avgiften kan beräknas (ordervärde > 0)
      // — inte längre ett statiskt månadsavgiftsfält.
      const fee = await computeConceptSubscriptionFee(tenantId, concept as any, { matchingObjects });
      if (!fee.canCompute) {
        throw new ValidationError("Abonnemangsavgiften kan inte beräknas — koppla minst en artikel med pris till konceptets uppgifter innan du aktiverar abonnemanget.");
      }
      const startDate = concept.deliveryStart ? new Date(concept.deliveryStart) : new Date();
      const freq = (concept.billingFrequency as string) || "monthly";
      const nextRun = computeSubscriptionNextRun(startDate, freq, new Date());

      // Fakturasummor i KRONOR (ordervärdet är öre). monthlyTotal = en periods
      // ordervärde; perInvoiceTotal skalas med stegmånaderna (kvartal/år).
      const monthlyTotal = fee.totalValueOre / 100;
      const stepMonths = freq === "yearly" ? 12 : freq === "quarterly" ? 3 : 1;
      const perInvoiceTotal = monthlyTotal * stepMonths;

      await storage.updateOrderConcept(concept.id, tenantId, {
        lastRunDate: new Date(),
        nextRunDate: nextRun,
      });

      // Task #1187: ett schemalagt abonnemang genererar utförbara uppgifter (stämplade
      // billingMethod='subscription' via getOrderConceptMethod i generatorn). Uppgifterna
      // kvittas till 0 mot abonnemangsavgiften när de slutförs (se materialiseraren).
      // Ett avgifts-abonnemang utan schema skapar inga uppgifter (oförändrat).
      let assignmentsCreated = 0;
      if (subscriptionHasSchedule) {
        const scheduleResult = await generateScheduleAssignments({
          concept,
          tenantId,
          userId,
          matchingObjects: expansionObjects,
          linkedArticle,
          linkedArticleId,
          linkedPrice,
          isFromMetadata,
          customerIdForObject,
          resolvePrice: resolvePriceMemo,
          quantityByObjectId: hits?.quantityByObjectId,
        });
        assignmentsCreated = scheduleResult?.created.length ?? 0;
      }

      return res.json({
        success: true,
        method: "subscription",
        message: `Abonnemang aktiverat för ${matchingObjects.length} objekt (beräknad avgift ${monthlyTotal.toLocaleString("sv-SE")} kr)${assignmentsCreated > 0 ? `, ${assignmentsCreated} uppgifter schemalagda` : ""}. Nästa fakturering ${nextRun.toISOString().split("T")[0]}.`,
        objectsMatched: matchingObjects.length,
        assignmentsCreated,
        subscription: {
          computed: true,
          matchedObjects: matchingObjects.length,
          monthlyTotal,
          perInvoiceTotal,
          quarterlyTotal: monthlyTotal * 3,
          yearlyTotal: monthlyTotal * 12,
          billingFrequency: freq,
          startDate: startDate.toISOString(),
          nextRunDate: nextRun.toISOString(),
        },
      });
    }

    if (conceptMethod === "schedule") {
      const scheduleResult = await generateScheduleAssignments({
        concept,
        tenantId,
        userId,
        matchingObjects: expansionObjects,
        linkedArticle,
        linkedArticleId,
        linkedPrice,
        isFromMetadata,
        customerIdForObject,
        resolvePrice: resolvePriceMemo,
        quantityByObjectId: hits?.quantityByObjectId,
      });
      if (scheduleResult === null) {
        throw new ValidationError("Schema-konceptet saknar leveransschema eller intervall. Konfigurera ett leveransschema (månad/vecka/veckodag) eller ett återkommande intervall (startdatum + frekvens i dagar) i steg 5 innan du kör konceptet.");
      }
      await storage.updateOrderConcept(concept.id, tenantId, {
        lastRunDate: new Date(),
        nextRunDate: new Date(new Date().getFullYear(), new Date().getMonth() + (concept.rollingMonths || 3), 1),
      });
      return res.json({
        success: true,
        method: "schedule",
        message: `Genererade ${scheduleResult.created.length} schemalagda uppgifter (${scheduleResult.datesGenerated} tillfällen) för ${buildHitSummaryText(hits)}` +
          (scheduleResult.skipped > 0 ? ` (${scheduleResult.skipped} hoppades över — fanns redan)` : "") + ".",
        assignmentsCreated: scheduleResult.created.length,
        objectsMatched: matchingObjects.length,
        objectsHit: hits?.hitCount ?? matchingObjects.length,
        objectsMissed: hits?.missCount ?? 0,
        datesGenerated: scheduleResult.datesGenerated,
        skipped: scheduleResult.skipped,
        assignments: scheduleResult.created,
      });
    }

    // call_off (Avrop, default): engångsexpansion — en uppgift per TRÄFF-objekt nu.
    // Task #976: expansionObjects = artikelträff-objekten (miss-objekt utelämnas helt).
    // Task #1055: en generation (occurrences=1) ⇒ per_object/per_task = fullt belopp;
    // per_concept fördelar det fasta beloppet jämnt över alla träff-objekt.
    const callOffFixedDivisor = fixedPriceWoDivisor(concept, {
      objectCount: expansionObjects.length,
      occurrences: 1,
    });
    for (const obj of expansionObjects) {
      // Task #976: använd förupplöst antal från artikelträff-tjänsten (samma värde som
      // träffberäkningen → cachedValue/assignmentArticle kan aldrig divergera). Faller
      // tillbaka på inline-beräkning om kartan saknas (t.ex. inget länkat artikel-id).
      let quantity = hits?.quantityByObjectId.get(obj.id);
      if (quantity == null) {
        // Cross-pollination: multiply by metadata field if specified
        const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
        quantity = 1;
        if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
          quantity = Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
        }
        // Honorera den länkade artikelns quantityMode ovanpå ev. cross-pollination-bas:
        // single_per_task→1, group→groupSize, per_styck/matches_field→objektets metadatavärde (annars bas).
        // Metadata-drivna lägen upplöses ärvningsmedvetet via getArticleMetadataForObject (samma
        // resolver som manuella orderrader) — objekten här saknar populerad .metadata.
        if (linkedArticle) {
          quantity = await resolveEffectiveArticleQuantity({
            tenantId,
            article: linkedArticle,
            baseQuantity: quantity,
            objectId: obj.id,
          });
        }
      }

      // Task #937: per-objekt kund + pris. FROM_METADATA använder objektets resolvade
      // kund (pris via memo så samma kund inte slås upp om och om); HARDCODED använder
      // konceptets fasta kund + det förberäknade linkedPrice.
      const effectiveCustomerId = customerIdForObject(obj.id);
      const objPrice = isFromMetadata
        ? await resolvePriceMemo(linkedArticle, linkedArticleId, effectiveCustomerId)
        : linkedPrice;

      // Calculate estimated duration from linked article
      let estimatedDuration = 60; // default 60 minutes
      let totalValue = 0;
      let totalCost = 0;
      // Task #976: fast pris (priceModel='fixed') ⇒ fixedPriceAmount per objekt; annars
      // löpande pris × antal. Enhetspris på artikelraden härleds från totalen vid fast pris.
      let unitPriceForArticle = objPrice.price;

      if (linkedArticle) {
        estimatedDuration = objPrice.productionMinutes * quantity;
        totalValue = computeObjectValueOre(concept, objPrice.price, quantity, callOffFixedDivisor);
        totalCost = objPrice.cost * quantity;
        unitPriceForArticle =
          isFixedPriceConcept(concept) && quantity > 0 ? Math.round(totalValue / quantity) : objPrice.price;
      }

      // Task #901 (B8): metadatastyrd leveranstid. När konceptet pekar ut ett
      // metadatafält läses objektets värde (ärvningsmedvetet) och tolkas som
      // leveransdatum; saknas/ogiltigt ⇒ fallback till det schemalagda datumet.
      let effectiveScheduledDate = scheduledDate;
      if (concept.deliveryTimeMetadataField) {
        let metaDate: Date | null = null;
        try {
          const md = await getArticleMetadataForObject(obj.id, concept.deliveryTimeMetadataField, tenantId);
          metaDate = parseDeliveryDate(md?.value);
        } catch (e) {
          console.error("[fortnox delivery-time metadata] resolve failed:", e);
        }
        if (metaDate) {
          effectiveScheduledDate = metaDate;
          deliveryTimeFromMetadata++;
        } else {
          deliveryTimeFallback++;
          console.warn(
            `[fortnox delivery-time metadata] objekt ${obj.id}: fältet "${concept.deliveryTimeMetadataField}" saknas/ogiltigt — faller tillbaka på schemalagt datum`,
          );
        }
      }

      // Task #989: varuartikel med lagerplats ⇒ skapa hämt-uppgiften (lagerplats,
      // schemalagd före leverans) först, länka sedan leveransuppgiften till den.
      const splitForStock = shouldSplitForStockPickup(linkedArticle);
      let pickupAssignmentId: string | undefined;
      if (splitForStock) {
        const pickup = await createStockPickupAssignment({
          tenantId,
          concept,
          obj,
          linkedArticle,
          deliverDate: effectiveScheduledDate,
          customerId: effectiveCustomerId,
          quantity,
          userId,
          matchReason: matchReasonByObject.get(obj.id),
        });
        pickupAssignmentId = pickup.id;
        createdAssignments.push(pickup);
      }

      const assignment = await storage.createAssignment({
        tenantId,
        orderConceptId: concept.id,
        objectId: obj.id,
        // Task #937: snapshota resolverad order-/faktureringskund (FROM_METADATA per objekt,
        // annars konceptets fasta kund).
        customerId: effectiveCustomerId ?? undefined,
        title: concept.name,
        description: concept.description || undefined,
        status: "not_planned",
        priority: concept.priority || "normal",
        scheduledDate: effectiveScheduledDate,
        quantity,
        address: obj.address || undefined,
        latitude: obj.latitude || undefined,
        longitude: obj.longitude || undefined,
        creationMethod: "automatic",
        createdBy: userId,
        estimatedDuration,
        cachedValue: totalValue,
        cachedCost: totalCost,
        logisticsRole: splitForStock ? "deliver" : undefined,
        parentAssignmentId: pickupAssignmentId,
        // Task #1205 (fält 54): läsbar matchningsorsak snapshotad vid expansion.
        matchReason: matchReasonByObject.get(obj.id),
        // Task #1110: stämpla artikelns utförandekod på uppgiften (informationspaket).
        executionCode: linkedArticle?.executionCode ?? undefined,
        // Tidskod fryst från artikelns timeCodeKey (finplanering/lön).
        frozenTimeCode: linkedArticle?.timeCodeKey ?? undefined,
        // Task #997: fryst viktat tidsregel-paket (null om objektet saknar regler).
        frozenTimeRules: frozenTimeRulesByObject.get(obj.id) ?? null,
        // Task #1369: ursprung stämplat vid skapandet (koncept-expansion, avrop).
        sourceType: "orderkoncept",
        // Task #1124: informationspaket-natur (fast pris + faktureringstyp) snapshotat
        // vid expansion — bärs vidare till materialiserad faktura-WO. conceptMethod är
        // "call_off" här (schema/abonnemang har redan returnerat ovan).
        isFixedPrice: isFixedPriceConcept(concept),
        billingMethod: conceptMethod,
      });

      // If an article is linked, create assignment article (kund-pris via resolveArticlePrice).
      // Använd linkedArticleId (ev. ersättningsartikel efter utgått→swap), inte rå concept.articleId.
      if (linkedArticle && linkedArticleId) {
        await storage.createAssignmentArticle({
          assignmentId: assignment.id,
          articleId: linkedArticleId,
          quantity,
          unitPrice: unitPriceForArticle,
          totalPrice: totalValue,
          unitCost: objPrice.cost,
          totalCost: objPrice.cost * quantity,
          unitTime: objPrice.productionMinutes,
          totalTime: objPrice.productionMinutes * quantity,
          sequenceOrder: 1,
          status: "pending"
        });
      }

      createdAssignments.push(assignment);
    }

    // Task #381 — Administrativa/logistik-artiklar (task_category != 'field')
    // expanderas till EN work_order per artikel och konceptkörning, helt utan
    // object_id. Flödet skapar en arbetsorder direkt (förbi assignments) eftersom
    // dessa uppgifter saknar fysiskt objekt och inte ska kopplas till objektmatchning.
    const conceptArticles = await storage.getOrderConceptArticles(concept.id);
    const adminArticles = conceptArticles.filter(ca => ca.taskCategory && ca.taskCategory !== "field");
    const createdAdminWorkOrders: Array<{ id: string; taskCategory: string; articleId: string }> = [];
    // Task #937: administrativa/logistik-artiklar är objektlösa och behöver EN fast
    // faktureringskund. I FROM_METADATA härleds kund per objekt — det finns ingen enskild
    // kund att hänga den objektlösa arbetsordern på, så vi hoppar över dem och varnar
    // (uppfinner aldrig en kund). Out of scope: objektlös admin-gruppering under FROM_METADATA.
    let adminArticlesSkippedFromMetadata = 0;
    if (adminArticles.length > 0 && isFromMetadata) {
      adminArticlesSkippedFromMetadata = adminArticles.length;
    } else if (adminArticles.length > 0 && concept.customerId) {
      for (const ca of adminArticles) {
        const article = await storage.getArticle(ca.articleId);
        if (!article) continue;
        const qty = ca.quantity ?? 1;
        // Task #391: kund-pris via resolveArticlePrice även för admin/logistik
        const priceInfo = await storage.resolveArticlePrice(tenantId, ca.articleId, concept.customerId);
        const minutes = priceInfo.productionMinutes || 30;
        const wo = await storage.createWorkOrder({
          tenantId,
          customerId: concept.customerId,
          objectId: null,
          taskCategory: ca.taskCategory ?? "admin",
          // §5 A — ärv platskrav från konceptartikeln (admin/logistik → normalt 'ingen').
          locationRequirement: ca.locationRequirement ?? null,
          title: `${article.name} (${concept.name})`,
          description: concept.description ?? null,
          orderStatus: "ej_planerad",
          priority: concept.priority || "normal",
          scheduledDate,
          estimatedDuration: minutes * qty,
          creationMethod: "concept_execute",
          createdBy: userId ?? null,
          // Task #1110: stämpla artikelns utförandekod även på admin/logistik-WO så
          // grovplaneringen kan sortera/filtrera även dessa på utförandekod.
          executionCode: article.executionCode ?? null,
          // Tidskod fryst från artikelns timeCodeKey (finplanering/lön).
          frozenTimeCode: article.timeCodeKey ?? null,
          // Task #1369: ursprung + konceptreferens stämplas vid skapandet så att
          // relationen Objekt → Order → Orderkoncept aldrig försvinner.
          sourceType: "orderkoncept",
          orderConceptId: concept.id,
        } as InsertWorkOrder);
        createdAdminWorkOrders.push({ id: wo.id, taskCategory: wo.taskCategory, articleId: ca.articleId });
      }
    }

    // Session 9B — Föruppgifter & beroendeuppgifter (steg 6/7).
    // Artikelrader markerade isPreTask (t.ex. plocka/beställ för fysiska artiklar
    // eller föravisering med negativ leveranstid) expanderas till en egen
    // föruppgift per matchande objekt, schemalagd med dependencyOffsetMinutes
    // relativt huvuduppgiftens datum (negativt = före).
    const preTaskArticles = conceptArticles.filter(ca => (ca as any).isPreTask === true && (!ca.taskCategory || ca.taskCategory === "field"));
    const createdPreTasks: Array<{ id: string; objectId: string; articleId: string }> = [];
    if (preTaskArticles.length > 0) {
      // Task #976: föruppgifter skapas bara för träff-objekt (inte för miss-objekt).
      for (const obj of expansionObjects) {
        for (const ca of preTaskArticles) {
          const article = await storage.getArticle(ca.articleId);
          if (!article) continue;
          const qty = ca.quantity ?? 1;
          const offsetMin = Number((ca as any).dependencyOffsetMinutes ?? 0);
          // Task #836 (Fas 3): Ledtid (leverantörens leveranstid i dagar) skjuter
          // föruppgiften ytterligare bakåt så att beställningen hinner levereras före
          // huvuduppgiften. Total förskjutning = offsettid (min) − ledtid (dagar).
          // Offsettid betyder enbart före/samtidigt/efter; den överlastas inte längre
          // som leveranstid (migration 0076 flyttade positiv offset → lead_time_days).
          const leadDays = Number(article.leadTimeDays ?? 0);
          let preDate: Date | undefined = undefined;
          if (scheduledDate) {
            preDate = new Date(
              scheduledDate.getTime() + offsetMin * 60_000 - leadDays * 86_400_000,
            );
          }
          // Task #937: per-objekt kund för pris + snapshot (FROM_METADATA resolverat,
          // annars konceptets fasta kund). Pris via memo (delas med huvuduppgiften).
          const preCustomerId = customerIdForObject(obj.id);
          let unitTime = article.productionTime || 30;
          let unitPrice = article.listPrice || 0;
          let unitCost = resolveArticleCostBasisOre(article);
          if (preCustomerId) {
            const info = await resolvePriceMemo(article, ca.articleId, preCustomerId);
            unitTime = info.productionMinutes || unitTime;
            unitPrice = info.price;
            unitCost = info.cost;
          }
          const preAssignment = await storage.createAssignment({
            tenantId,
            orderConceptId: concept.id,
            objectId: obj.id,
            customerId: preCustomerId ?? undefined,
            title: `${article.name} (föruppgift)`,
            description: concept.description || undefined,
            status: "not_planned",
            priority: concept.priority || "normal",
            scheduledDate: preDate,
            quantity: qty,
            address: obj.address || undefined,
            latitude: obj.latitude || undefined,
            longitude: obj.longitude || undefined,
            creationMethod: "automatic",
            createdBy: userId,
            estimatedDuration: unitTime * qty,
            cachedValue: unitPrice * qty,
            cachedCost: unitCost * qty,
            // Task #836 (Fas 3): Stämpla beroende-kvittenskrav + kritiskhet från
            // artikeln. requiresAcknowledgment=true ⇒ tillgängligheten måste kvitteras
            // (dependencyAcknowledgedAt) före huvuduppgiften, annars varnar systemet.
            requiresAcknowledgment: article.requiresAcknowledgment ?? false,
            dependencyCriticality: article.dependencyCriticality ?? "critical",
            // Task #1205 (fält 54): matchningsorsak ärvs även till föruppgiften.
            matchReason: matchReasonByObject.get(obj.id),
            // Task #1110: stämpla artikelns utförandekod även på föruppgiften.
            executionCode: article.executionCode ?? undefined,
            // Tidskod fryst från artikelns timeCodeKey (finplanering/lön).
            frozenTimeCode: article.timeCodeKey ?? undefined,
            // Task #1124: informationspaket-natur (fast pris + faktureringstyp) snapshotat
            // vid expansion (call_off-väg; schema/abonnemang har returnerat ovan).
            isFixedPrice: isFixedPriceConcept(concept),
            billingMethod: conceptMethod,
            // Task #1369: ursprung stämplat vid skapandet (koncept-expansion, föruppgift).
            sourceType: "orderkoncept",
          });
          await storage.createAssignmentArticle({
            assignmentId: preAssignment.id,
            articleId: ca.articleId,
            quantity: qty,
            unitPrice,
            totalPrice: unitPrice * qty,
            unitCost,
            totalCost: unitCost * qty,
            unitTime,
            totalTime: unitTime * qty,
            sequenceOrder: 1,
            status: "pending",
          });
          createdPreTasks.push({ id: preAssignment.id, objectId: obj.id, articleId: ca.articleId });
        }
      }
    }

    // Update last run date
    await storage.updateOrderConcept(concept.id, tenantId, {
      lastRunDate: new Date()
    });

    res.json({
      success: true,
      message: `Skapade ${createdAssignments.length} uppgifter från ${buildHitSummaryText(hits)}` +
        (createdPreTasks.length > 0 ? ` + ${createdPreTasks.length} föruppgifter` : "") +
        (createdAdminWorkOrders.length > 0 ? ` + ${createdAdminWorkOrders.length} administrativa uppgifter` : "") +
        (concept.deliveryTimeMetadataField ? ` (leveranstid från metadata: ${deliveryTimeFromMetadata}, schemalagd fallback: ${deliveryTimeFallback})` : "") +
        (adminArticlesSkippedFromMetadata > 0
          ? `. ${adminArticlesSkippedFromMetadata} administrativa/logistik-artiklar hoppades över — de är objektlösa och kräver en fast kund, men konceptet härleder kund per objekt (läge: Från objektets metadata)`
          : ""),
      assignmentsCreated: createdAssignments.length,
      objectsMatched: matchingObjects.length,
      objectsHit: hits?.hitCount ?? matchingObjects.length,
      objectsMissed: hits?.missCount ?? 0,
      deliveryTimeFromMetadata,
      deliveryTimeFallback,
      assignments: createdAssignments,
      preTasksCreated: createdPreTasks.length,
      preTasks: createdPreTasks,
      adminWorkOrdersCreated: createdAdminWorkOrders.length,
      adminWorkOrders: createdAdminWorkOrders,
      adminArticlesSkippedFromMetadata,
    });
}));

// Preview order concept execution (dry run)
app.post("/api/order-concepts/:id/preview", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    // Resolva mål (gren-subträd via target_object_ids → legacy kluster → alla)
    // + matcha villkoren via delad modul, identiskt med execute/condition-preview.
    const { matchingObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      filterInputs,
      { fallbackAllObjects: true },
    );

    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
    let linkedPrice = { price: 0, cost: 0, productionMinutes: 0 };
    if (concept.articleId) {
      // Task #976: använd den aktiva artikeln (utgått→ersättning) även i preview, så
      // pris och antalsläge matchar execute.
      linkedArticle = await resolveActiveArticle(tenantId, await storage.getArticle(concept.articleId));
      if (linkedArticle && concept.customerId) {
        const info = await storage.resolveArticlePrice(tenantId, linkedArticle.id, concept.customerId);
        linkedPrice = { price: info.price, cost: info.cost, productionMinutes: info.productionMinutes };
      } else if (linkedArticle) {
        linkedPrice = {
          price: linkedArticle.listPrice || 0,
          cost: resolveArticleCostBasisOre(linkedArticle),
          productionMinutes: linkedArticle.productionTime || 0,
        };
      }
    }

    // Task #934: förhandsvisning grenar på faktureringsmetoden (invoiceModel med
    // fallback till scenario) — inte längre enbart legacy-scenario.
    const previewMethod = getOrderConceptMethod(concept);

    // Task #976: artikelträff i preview — visa endast träff-objekt och konceptets fasta
    // pris. Abonnemang expanderar inga uppgifter ⇒ behåll alla objekt där.
    const previewHits = await resolveConceptArticleHits({
      tenantId,
      concept,
      linkedArticle,
      matchingObjects,
    });
    const previewObjects = previewMethod === "subscription" ? matchingObjects : previewHits.hitObjects;
    // Task #1055: förhandsvisningen visar en rad per objekt (en generation) ⇒ per_concept
    // fördelar det fasta beloppet över objekten; per_object/per_task = fullt belopp.
    const previewFixedDivisor = fixedPriceWoDivisor(concept, {
      objectCount: previewObjects.length,
      occurrences: 1,
    });
    const previewItems = previewObjects.map(obj => {
      const quantity = previewHits.quantityByObjectId.get(obj.id) ?? 1;
      return {
        objectId: obj.id,
        objectName: obj.name,
        address: obj.address,
        quantity,
        articleName: linkedArticle?.name || "-",
        estimatedDuration: linkedPrice.productionMinutes * quantity,
        estimatedValue: computeObjectValueOre(concept, linkedPrice.price, quantity, previewFixedDivisor),
      };
    });

    // Generate rolling schedule preview if method is "schedule"
    let schedulePreview: Array<{ date: string; objectCount: number }> = [];
    if (previewMethod === "schedule" && concept.deliverySchedule) {
      const schedule = concept.deliverySchedule as Array<{ month: number; weekNumber: number; weekday: number; timeWindowStart?: string; timeWindowEnd?: string }>;
      const months = concept.rollingMonths || 3;
      const now = new Date();
      for (let m = 0; m < months; m++) {
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + m, 1);
        for (const entry of schedule) {
          if (entry.month && entry.month !== targetMonth.getMonth() + 1) continue;
          const date = getDateFromWeekdayInMonth(targetMonth.getFullYear(), targetMonth.getMonth(), entry.weekNumber, entry.weekday);
          if (date && date >= now) {
            schedulePreview.push({
              date: date.toISOString().split('T')[0],
              objectCount: previewHits.hitCount,
            });
          }
        }
      }
      schedulePreview.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Subscription calculation for "subscription" method
    // Task #1057: avgiften beräknas dynamiskt från uppgifternas ordervärde (kronor),
    // inte längre från det statiska månadsavgiftsfältet.
    let subscriptionCalc:
      | { matchedObjects: number; monthlyTotal: number; yearlyTotal: number; computed: boolean; fakturastopp: boolean; segments: SubscriptionSegmentPreview[] }
      | undefined;
    if (previewMethod === "subscription") {
      const fee = await computeConceptSubscriptionFee(tenantId, concept as any, { matchingObjects });
      const monthlyTotal = fee.totalValueOre / 100;
      // Task #1067: nivå-vy (fakturastopp-segment) så förhandsvisningen visar vilka
      // organisatoriska nivåer fakturan stoppas på (samma kanoniska grupperare som execute).
      const segments = await buildSubscriptionSegmentsPreview(tenantId, concept as any, matchingObjects, fee);
      subscriptionCalc = {
        matchedObjects: fee.matchedCount,
        monthlyTotal,
        yearlyTotal: monthlyTotal * 12,
        computed: fee.canCompute,
        fakturastopp: isConceptFakturastopp(concept as any),
        segments,
      };
    }

    res.json({
      objectsMatched: matchingObjects.length,
      totalFilters: filters.length,
      items: previewItems,
      schedulePreview,
      subscriptionCalc,
      // Task #976: artikelträff-sammanfattning för förhandsvisningen.
      objectsHit: previewHits.hitCount,
      objectsMissed: previewHits.missCount,
      isMetadataDriven: previewHits.isMetadataDriven,
      quantityFieldLabel: previewHits.quantityFieldLabel,
    });
}));

// Rolling schedule execution - generate assignments for upcoming windows
app.post("/api/order-concepts/:id/run-rolling", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    // Task #934: grena på faktureringsmetoden (invoiceModel m. fallback scenario).
    // run-rolling är SCHEMA-metodens dedikerade endpoint och delar nu generator
    // med /execute (method === "schedule") så att de inte divergerar; intervall-
    // konfigurerade scheman (utan delivery_schedule) stöds därmed också.
    if (getOrderConceptMethod(concept) !== "schedule") {
      throw new ValidationError("Konceptet är inte ett schema-koncept (faktureringsmetod Schema krävs).");
    }

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    // Resolva mål (gren-subträd via target_object_ids → legacy kluster → alla)
    // + matcha villkoren via delad modul, identiskt med execute/condition-preview.
    const { matchingObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      filterInputs,
      { fallbackAllObjects: true },
    );

    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
    let linkedArticleId: string | null = concept.articleId ?? null;
    let linkedPrice = { price: 0, cost: 0, productionMinutes: 0 };
    if (concept.articleId) {
      // Task #976: aktiv artikel (utgått→ersättning) + samma artikelträfflogik som execute.
      linkedArticle = await resolveActiveArticle(tenantId, await storage.getArticle(concept.articleId));
      if (linkedArticle) linkedArticleId = linkedArticle.id;
      if (linkedArticle && concept.customerId) {
        const info = await storage.resolveArticlePrice(tenantId, linkedArticleId!, concept.customerId);
        linkedPrice = { price: info.price, cost: info.cost, productionMinutes: info.productionMinutes };
      } else if (linkedArticle) {
        linkedPrice = {
          price: linkedArticle.listPrice || 0,
          cost: resolveArticleCostBasisOre(linkedArticle),
          productionMinutes: linkedArticle.productionTime || 0,
        };
      }
    }

    // Task #976: artikelträff — endast träff-objekt schemaläggs/prissätts.
    const rollingHits = await resolveConceptArticleHits({
      tenantId,
      concept,
      linkedArticle,
      matchingObjects,
    });

    const months = concept.rollingMonths || 3;
    const now = new Date();
    // Task #937: samma per-objekt kund-resolution + pris-memo som /execute. run-rolling
    // är alltid schema-metoden ⇒ pre-passet körs (kastar före skrivning om FROM_METADATA
    // inte kan resolva alla objekt). Pre-passet körs över träff-objekten.
    const { isFromMetadata, customerIdForObject, resolvePrice } = await prepareConceptCustomerPricing({
      concept,
      tenantId,
      matchingObjects: rollingHits.hitObjects,
      runPrePass: true,
    });
    const rollingResult = await generateScheduleAssignments({
      concept,
      tenantId,
      userId,
      matchingObjects: rollingHits.hitObjects,
      linkedArticle,
      linkedArticleId,
      linkedPrice,
      isFromMetadata,
      customerIdForObject,
      resolvePrice,
      quantityByObjectId: rollingHits.quantityByObjectId,
    });
    if (rollingResult === null) {
      throw new ValidationError("Konceptet saknar leveransschema eller intervall. Konfigurera ett leveransschema (månad/vecka/veckodag) eller ett återkommande intervall (startdatum + frekvens i dagar) innan du kör.");
    }

    await storage.updateOrderConcept(concept.id, tenantId, {
      lastRunDate: new Date(),
      nextRunDate: new Date(now.getFullYear(), now.getMonth() + months, 1),
    });

    res.json({
      success: true,
      message: `Genererade ${rollingResult.created.length} uppgifter för ${months} månader framåt (${buildHitSummaryText(rollingHits)})` +
        (rollingResult.skipped > 0 ? ` (${rollingResult.skipped} hoppades över — fanns redan)` : ""),
      assignmentsCreated: rollingResult.created.length,
      objectsMatched: matchingObjects.length,
      objectsHit: rollingHits.hitCount,
      objectsMissed: rollingHits.missCount,
      skipped: rollingResult.skipped,
    });
}));

// Subscription calculation
app.get("/api/order-concepts/:id/subscription-calc", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    // Resolva mål (gren-subträd via target_object_ids → legacy kluster → alla)
    // + matcha villkoren via delad modul, identiskt med execute/condition-preview.
    const { matchingObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      filterInputs,
      { fallbackAllObjects: true },
    );

    // Task #1057: dynamisk avgift = ordervärdet per objekt (kronor), jämnt fördelat
    // från konceptets totala ordervärde. Inget statiskt månadsavgiftsfält längre.
    const fee = await computeConceptSubscriptionFee(tenantId, concept as any, { matchingObjects });
    // Exakt per-objekt-fördelning (största-rest) ⇒ Σ per-objekt === totalValueOre.
    const perObject = matchingObjects.map((obj, i) => ({
      objectId: obj.id,
      objectName: obj.name,
      monthlyFee: (fee.perObjectValuesOre[i] ?? 0) / 100,
    }));

    const monthlyTotal = fee.totalValueOre / 100;

    // Task #1067: nivå-vy (fakturastopp-segment) — visar TYDLIGT vilka organisatoriska
    // nivåer fakturan stoppas på (samma kund, en faktura per metadatavärde). Samma
    // kanoniska grupperare (groupSubscriptionInvoices) som schemaläggaren ⇒ preview == execute.
    const segments = await buildSubscriptionSegmentsPreview(tenantId, concept as any, matchingObjects, fee);

    res.json({
      perObject,
      matchedObjects: fee.matchedCount,
      monthlyTotal,
      quarterlyTotal: monthlyTotal * 3,
      yearlyTotal: monthlyTotal * 12,
      computed: fee.canCompute,
      billingFrequency: concept.billingFrequency || "monthly",
      contractLockMonths: concept.contractLockMonths,
      fakturastopp: isConceptFakturastopp(concept as any),
      segments,
    });
}));

// Subscription changes
app.get("/api/subscription-changes", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { conceptId, status } = req.query;
    const changes = await storage.getSubscriptionChanges(
      tenantId,
      conceptId as string | undefined,
      status as string | undefined
    );
    res.json(changes);
}));

app.patch("/api/subscription-changes/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const { approvalStatus } = req.body;
    if (!approvalStatus || !["approved", "rejected"].includes(approvalStatus)) {
      throw new ValidationError("Ogiltig status");
    }
    const change = await storage.updateSubscriptionChangeStatus(
      req.params.id, tenantId, approvalStatus, userId
    );
    if (!change) {
      throw new NotFoundError("Ändring hittades inte");
    }
    res.json(change);
}));

// Detect subscription changes
app.post("/api/order-concepts/:id/detect-changes", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept || getOrderConceptMethod(concept) !== "subscription") {
      throw new ValidationError("Konceptet är inte ett abonnemang");
    }

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    // Resolva mål (gren-subträd via target_object_ids → legacy kluster → alla)
    // + matcha villkoren via delad modul, identiskt med execute/condition-preview.
    const { matchingObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      filterInputs,
      { fallbackAllObjects: true },
    );

    const existingAssignments = await storage.getAssignments(tenantId, {});
    const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
    const assignedObjectIds = new Set(conceptAssignments.map(a => a.objectId));

    // Task #1057: avgiftsdeltat per objekt = dynamiskt beräknad per-objekt-avgift
    // (kronor), jämnt fördelat från konceptets ordervärde — inte statisk månadsavgift.
    const fee = await computeConceptSubscriptionFee(tenantId, concept as any, { matchingObjects });
    // Exakt per-objekt-fördelning (största-rest), nyckel per objekt-id (kronor).
    const feeKrByObjectId = new Map<string, number>();
    matchingObjects.forEach((obj, i) => {
      feeKrByObjectId.set(obj.id, (fee.perObjectValuesOre[i] ?? 0) / 100);
    });
    // Borttagna objekt har ingen aktuell fördelning ⇒ använd snitt-avgiften som
    // delta-uppskattning (detta är en föreslagen ändring, inte en fakturaskrivning).
    const avgFeeKr = fee.matchedCount > 0 ? fee.totalValueOre / fee.matchedCount / 100 : 0;

    const createdChanges = [];

    for (const obj of matchingObjects) {
      if (!assignedObjectIds.has(obj.id)) {
        const perObjectFeeKr = feeKrByObjectId.get(obj.id) ?? 0;
        const change = await storage.createSubscriptionChange({
          tenantId,
          orderConceptId: concept.id,
          objectId: obj.id,
          changeType: "new_object",
          previousValue: "0",
          newValue: String(perObjectFeeKr),
          monthlyDelta: perObjectFeeKr,
          approvalStatus: "pending",
        });
        createdChanges.push(change);
      }
    }

    for (const objectId of assignedObjectIds) {
      if (!matchingObjects.find(o => o.id === objectId)) {
        const monthlyDelta = -avgFeeKr;
        const change = await storage.createSubscriptionChange({
          tenantId,
          orderConceptId: concept.id,
          objectId,
          changeType: "removed_object",
          previousValue: String(avgFeeKr),
          newValue: "0",
          monthlyDelta,
          approvalStatus: "pending",
        });
        createdChanges.push(change);
      }
    }

    res.json({
      changesDetected: createdChanges.length,
      changes: createdChanges,
    });
}));

// Fetch all customers from Fortnox for import preview
app.get("/api/fortnox/customers/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);

    const isConnected = await client.isConnected();
    if (!isConnected) {
      throw new ValidationError("Fortnox är inte anslutet. Anslut först under Fortnox-inställningar.");
    }

    const fortnoxCustomers = await client.getCustomers();

    const existingCustomers = await storage.getCustomers(tenantId);
    const existingMappings = await storage.getFortnoxMappings(tenantId, "customer");

    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enrichedCustomers = fortnoxCustomers.map((fc: any) => {
      const customerNumber = fc.CustomerNumber || "";
      const alreadyImported = mappedFortnoxIds.has(customerNumber);
      const nameMatch = existingCustomers.find(
        ec => ec.name?.toLowerCase().trim() === (fc.Name || "").toLowerCase().trim()
      );

      return {
        customerNumber,
        name: fc.Name || "",
        organisationNumber: fc.OrganisationNumber || "",
        address1: fc.Address1 || "",
        address2: fc.Address2 || "",
        zipCode: fc.ZipCode || "",
        city: fc.City || "",
        phone: fc.Phone1 || fc.Phone2 || "",
        email: fc.Email || "",
        contactPerson: fc.YourReference || "",
        active: fc.Active !== false,
        alreadyImported,
        existingMatch: nameMatch ? { id: nameMatch.id, name: nameMatch.name } : null,
      };
    });

    res.json({
      total: enrichedCustomers.length,
      customers: enrichedCustomers,
    });
}));

// Import selected customers from Fortnox
app.post("/api/fortnox/customers/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);

    const isConnected = await client.isConnected();
    if (!isConnected) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      customers: z.array(z.object({
        customerNumber: z.string(),
        name: z.string(),
        organisationNumber: z.string().optional(),
        address1: z.string().optional(),
        address2: z.string().optional(),
        zipCode: z.string().optional(),
        city: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        contactPerson: z.string().optional(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodError(parsed.error));
    }

    const results: Array<{ customerNumber: string; name: string; status: "created" | "skipped" | "error"; error?: string; customerId?: string }> = [];
    const existingMappings = await storage.getFortnoxMappings(tenantId, "customer");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const fortnoxBatchId = `fortnox-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
    const fortnoxStartedBy = (req as any).user?.id || null;

    for (const fc of parsed.data.customers) {
      try {
        if (mappedFortnoxIds.has(fc.customerNumber)) {
          results.push({ customerNumber: fc.customerNumber, name: fc.name, status: "skipped" });
          continue;
        }

        const addressParts = [fc.address1, fc.address2].filter(Boolean);
        const newCustomer = await storage.createCustomer({
          tenantId,
          name: fc.name,
          customerNumber: fc.customerNumber,
          contactPerson: fc.contactPerson || null,
          email: fc.email || null,
          phone: fc.phone || null,
          address: addressParts.join(", ") || null,
          city: fc.city || null,
          postalCode: fc.zipCode || null,
          notes: fc.organisationNumber ? `Org.nr: ${fc.organisationNumber}` : null,
          importBatchId: fortnoxBatchId,
        });

        await storage.createFortnoxMapping({
          tenantId,
          entityType: "customer",
          unicornId: newCustomer.id,
          fortnoxId: fc.customerNumber,
        });

        results.push({ customerNumber: fc.customerNumber, name: fc.name, status: "created", customerId: newCustomer.id });
      } catch (err: any) {
        results.push({ customerNumber: fc.customerNumber, name: fc.name, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;

    // Skriv import_batches-rad så historikpanelen (Task #574) kan visa
    // föregående Fortnox-kundimporter med samma format som Modus-importerna.
    try {
      await db.insert(importBatches).values({
        tenantId,
        batchId: fortnoxBatchId,
        totalRows: results.length,
        created,
        updated: 0,
        errors,
        metadata: {
          type: "fortnox-customers",
          status: "completed",
          startedBy: fortnoxStartedBy,
          filename: null,
          skipped,
          completedAt: new Date().toISOString(),
          sampleErrors: results.filter(r => r.status === "error").slice(0, 20).map(r => `${r.customerNumber} ${r.name}: ${r.error || "okänt fel"}`),
        },
      });
    } catch (err) {
      console.error(`[fortnox-customers ${fortnoxBatchId}] kunde inte skriva import_batches-rad:`, err);
    }

    res.json({
      summary: { created, skipped, errors, total: results.length },
      results,
      batchId: fortnoxBatchId,
    });
}));

// ============================================
// ARTICLES FETCH & IMPORT
// ============================================

app.get("/api/fortnox/articles/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const fortnoxArticles = await client.getArticles();
    const existingArticles = await storage.getArticles(tenantId);
    const existingMappings = await storage.getFortnoxMappings(tenantId, "article");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enriched = fortnoxArticles.map((fa: any) => {
      const articleNumber = fa.ArticleNumber || "";
      const alreadyImported = mappedFortnoxIds.has(articleNumber);
      const numberMatch = existingArticles.find(
        ea => ea.articleNumber?.toLowerCase() === articleNumber.toLowerCase()
      );
      return {
        articleNumber,
        description: fa.Description || "",
        unit: fa.Unit || "st",
        salesPrice: fa.SalesPrice || 0,
        purchasePrice: fa.PurchasePrice || 0,
        type: fa.Type || "",
        active: fa.Active !== false,
        alreadyImported,
        existingMatch: numberMatch ? { id: numberMatch.id, name: numberMatch.name } : null,
      };
    });

    res.json({ total: enriched.length, articles: enriched });
}));

// Task #837: Sök artiklar i Fortnox-registret för den sökbara rullgardinen i
// artikelformuläret. Tenant-skyddad, cache:ad och timeout-skyddad — fallerar
// "mjukt" (returnerar tomt + status) så att frontend kan falla tillbaka på fritext.
app.get("/api/fortnox/articles/search", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const q = (typeof req.query.q === "string" ? req.query.q : "").trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 50);

    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      return res.json({ connected: false, articles: [], total: 0 });
    }

    let entry = fortnoxArticleSearchCache.get(tenantId);
    const now = Date.now();
    if (!entry || now - entry.fetchedAt > FORTNOX_ARTICLE_CACHE_TTL_MS) {
      try {
        const fetched = await withTimeout(
          client.getArticles(),
          FORTNOX_ARTICLE_FETCH_TIMEOUT_MS,
          "Fortnox artikelhämtning",
        );
        entry = {
          fetchedAt: now,
          articles: (fetched as any[]).map((fa) => ({
            articleNumber: fa.ArticleNumber || "",
            description: fa.Description || "",
            unit: fa.Unit || "st",
            salesPrice: fa.SalesPrice || 0,
            active: fa.Active !== false,
          })),
        };
        fortnoxArticleSearchCache.set(tenantId, entry);
      } catch (err) {
        // Återanvänd ev. tidigare (stale) cache; annars mjukt fel utan att läcka detaljer.
        console.error("Fortnox artikelsök misslyckades:", err instanceof Error ? err.message : err);
        if (!entry) {
          return res.json({
            connected: true,
            articles: [],
            total: 0,
            error: "Kunde inte hämta artiklar från Fortnox just nu. Försök igen om en stund eller skriv artikelnumret manuellt.",
          });
        }
      }
    }

    const source = entry?.articles ?? [];
    const matched = (q
      ? source.filter(
          (a) =>
            a.articleNumber.toLowerCase().includes(q) ||
            a.description.toLowerCase().includes(q),
        )
      : source
    ).slice(0, limit);

    res.json({ connected: true, articles: matched, total: source.length });
}));

app.post("/api/fortnox/articles/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      articles: z.array(z.object({
        articleNumber: z.string(),
        description: z.string(),
        unit: z.string().optional(),
        salesPrice: z.number().optional(),
        type: z.string().optional(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const existingMappings = await storage.getFortnoxMappings(tenantId, "article");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const results: Array<{ articleNumber: string; description: string; status: "created" | "skipped" | "error"; error?: string }> = [];

    for (const fa of parsed.data.articles) {
      try {
        if (mappedFortnoxIds.has(fa.articleNumber)) {
          results.push({ articleNumber: fa.articleNumber, description: fa.description, status: "skipped" });
          continue;
        }
        const newArticle = await storage.createArticle({
          tenantId,
          articleNumber: fa.articleNumber,
          name: fa.description || fa.articleNumber,
          description: fa.description,
          unit: fa.unit || "st",
          listPrice: Math.round((fa.salesPrice || 0) * 100),
          articleType: fa.type === "STOCK" ? "vara" : "tjanst",
        });
        await storage.createFortnoxMapping({
          tenantId,
          entityType: "article",
          unicornId: newArticle.id,
          fortnoxId: fa.articleNumber,
        });
        results.push({ articleNumber: fa.articleNumber, description: fa.description, status: "created" });
      } catch (err: any) {
        results.push({ articleNumber: fa.articleNumber, description: fa.description, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ summary: { created, skipped, errors, total: results.length }, results });
}));

// ============================================
// COST CENTERS FETCH & IMPORT
// ============================================

app.get("/api/fortnox/costcenters/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const fortnoxCCs = await client.getCostCenters();
    const existingMappings = await storage.getFortnoxMappings(tenantId, "costcenter");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enriched = fortnoxCCs.map((cc: any) => {
      const code = cc.Code || "";
      return {
        code,
        description: cc.Description || "",
        active: cc.Active !== false,
        alreadyImported: mappedFortnoxIds.has(code),
      };
    });

    res.json({ total: enriched.length, costcenters: enriched });
}));

app.post("/api/fortnox/costcenters/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      costcenters: z.array(z.object({
        code: z.string(),
        description: z.string(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const existingMappings = await storage.getFortnoxMappings(tenantId, "costcenter");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const results: Array<{ code: string; description: string; status: "created" | "skipped" | "error"; error?: string }> = [];

    for (const cc of parsed.data.costcenters) {
      try {
        if (mappedFortnoxIds.has(cc.code)) {
          results.push({ code: cc.code, description: cc.description, status: "skipped" });
          continue;
        }
        await storage.createFortnoxMapping({
          tenantId,
          entityType: "costcenter",
          unicornId: cc.code,
          fortnoxId: cc.code,
        });
        results.push({ code: cc.code, description: cc.description, status: "created" });
      } catch (err: any) {
        results.push({ code: cc.code, description: cc.description, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ summary: { created, skipped, errors, total: results.length }, results });
}));

// ============================================
// PROJECTS FETCH & IMPORT
// ============================================

app.get("/api/fortnox/projects/fetch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const fortnoxProjects = await client.getProjects();
    const existingMappings = await storage.getFortnoxMappings(tenantId, "project");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

    const enriched = fortnoxProjects.map((p: any) => {
      const projectNumber = p.ProjectNumber || "";
      return {
        projectNumber,
        description: p.Description || "",
        status: p.Status || "",
        startDate: p.StartDate || "",
        endDate: p.EndDate || "",
        active: p.Status !== "FINISHED",
        alreadyImported: mappedFortnoxIds.has(projectNumber),
      };
    });

    res.json({ total: enriched.length, projects: enriched });
}));

app.post("/api/fortnox/projects/import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet.");
    }

    const schema = z.object({
      projects: z.array(z.object({
        projectNumber: z.string(),
        description: z.string(),
      })),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));

    const existingMappings = await storage.getFortnoxMappings(tenantId, "project");
    const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));
    const results: Array<{ projectNumber: string; description: string; status: "created" | "skipped" | "error"; error?: string }> = [];

    for (const p of parsed.data.projects) {
      try {
        if (mappedFortnoxIds.has(p.projectNumber)) {
          results.push({ projectNumber: p.projectNumber, description: p.description, status: "skipped" });
          continue;
        }
        await storage.createFortnoxMapping({
          tenantId,
          entityType: "project",
          unicornId: p.projectNumber,
          fortnoxId: p.projectNumber,
        });
        results.push({ projectNumber: p.projectNumber, description: p.description, status: "created" });
      } catch (err: any) {
        results.push({ projectNumber: p.projectNumber, description: p.description, status: "error", error: err.message });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ summary: { created, skipped, errors, total: results.length }, results });
}));

// ============================================
// FULL INITIAL IMPORT - kunder + objekt + artiklar
// ============================================
app.post("/api/fortnox/full-import", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const client = createFortnoxClient(tenantId);

    if (!(await client.isConnected())) {
      throw new ValidationError("Fortnox är inte anslutet. Anslut först under Fortnox-inställningar.");
    }

    const includeArticles = req.body?.includeArticles !== false;

    const importBatchId = `fortnox-full-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

    const customerSummary = { created: 0, skipped: 0, errors: 0 };
    const objectSummary = { created: 0, skipped: 0, errors: 0, geocodingQueued: 0 };
    const articleSummary = { created: 0, skipped: 0, errors: 0 };
    const contactSummary = { created: 0, skipped: 0, errors: 0 };
    const errorMessages: string[] = [];
    const newObjectIdsForGeocoding: string[] = [];

    // === STEP 1: Customers ===
    const fortnoxCustomers = await client.getCustomers();
    const existingCustomerMappings = await storage.getFortnoxMappings(tenantId, "customer");
    const customerFortnoxIdToUnicornId = new Map(existingCustomerMappings.map(m => [m.fortnoxId, m.unicornId]));

    for (const fc of fortnoxCustomers) {
      const customerNumber = (fc.CustomerNumber || "").toString();
      if (!customerNumber || !fc.Name) {
        customerSummary.errors++;
        continue;
      }

      try {
        let unicornCustomerId = customerFortnoxIdToUnicornId.get(customerNumber);

        if (unicornCustomerId) {
          customerSummary.skipped++;
        } else {
          const addressParts = [fc.Address1, fc.Address2].filter(Boolean) as string[];
          const newCustomerId = await db.transaction(async (tx) => {
            const [created] = await tx.insert(customers).values({
              tenantId,
              name: fc.Name,
              customerNumber,
              contactPerson: (fc.YourReference as string) || null,
              email: fc.Email || null,
              phone: (fc.Phone1 as string) || (fc.Phone2 as string) || null,
              address: addressParts.join(", ") || null,
              city: fc.City || null,
              postalCode: fc.ZipCode || null,
              notes: fc.OrganisationNumber ? `Org.nr: ${fc.OrganisationNumber}` : null,
              importBatchId,
            }).returning();
            await tx.insert(fortnoxMappings).values({
              tenantId,
              entityType: "customer",
              unicornId: created.id,
              fortnoxId: customerNumber,
            });
            return created.id;
          });

          unicornCustomerId = newCustomerId;
          customerFortnoxIdToUnicornId.set(customerNumber, unicornCustomerId);
          customerSummary.created++;
        }
      } catch (err) {
        customerSummary.errors++;
        const friendly = describeFortnoxMappingConflict(err);
        const detail = friendly || (err instanceof Error ? err.message : String(err));
        errorMessages.push(`Kund ${customerNumber}: ${detail}`);
      }
    }

    // === STEP 2: Objects (one fastighet per Fortnox-projekt eller leveransadress; fallback: en per kund) ===
    const existingObjectMappings = await storage.getFortnoxMappings(tenantId, "object");
    const objectFortnoxIds = new Set(existingObjectMappings.map(m => m.fortnoxId));

    // Hämta projekt + leveransadresser (kan misslyckas oberoende av kund/objekt-importen)
    let fortnoxProjects: any[] = [];
    let fortnoxDeliveryAddresses: any[] = [];
    try {
      fortnoxProjects = await client.getProjects();
    } catch (err) {
      errorMessages.push(`Projektshämtning misslyckades: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      fortnoxDeliveryAddresses = await client.getDeliveryAddresses();
    } catch (err) {
      errorMessages.push(`Leveransadresshämtning misslyckades: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Gruppera per kundnummer
    const projectsByCustomer = new Map<string, any[]>();
    for (const p of fortnoxProjects) {
      const cn = p?.CustomerNumber;
      if (!cn) continue;
      const key = String(cn);
      if (!projectsByCustomer.has(key)) projectsByCustomer.set(key, []);
      projectsByCustomer.get(key)!.push(p);
    }
    const deliveriesByCustomer = new Map<string, any[]>();
    for (const d of fortnoxDeliveryAddresses) {
      const cn = d?.CustomerNumber;
      if (!cn) continue;
      const key = String(cn);
      if (!deliveriesByCustomer.has(key)) deliveriesByCustomer.set(key, []);
      deliveriesByCustomer.get(key)!.push(d);
    }

    type SubObject = {
      fortnoxId: string;
      name: string;
      objectNumber: string | null;
      address: string | null;
      city: string | null;
      postalCode: string | null;
      notes: string;
    };

    for (const fc of fortnoxCustomers) {
      const customerNumber = (fc.CustomerNumber || "").toString();
      if (!customerNumber || !fc.Name) continue;

      const unicornCustomerId = customerFortnoxIdToUnicornId.get(customerNumber);
      if (!unicornCustomerId) continue;

      const customerAddress = [fc.Address1, fc.Address2].filter(Boolean).join(", ") || null;
      const projects = projectsByCustomer.get(customerNumber) || [];
      const deliveries = deliveriesByCustomer.get(customerNumber) || [];

      const subObjects: SubObject[] = [];

      if (projects.length > 0) {
        // Projekt har högst prio: ett objekt per projekt
        for (const p of projects) {
          const projectNumber = String(p.ProjectNumber || "");
          if (!projectNumber) continue;
          const description = (p.Description as string) || "";
          subObjects.push({
            fortnoxId: `project:${projectNumber}`,
            name: description ? `${fc.Name} – ${description}` : `${fc.Name} – Projekt ${projectNumber}`,
            objectNumber: projectNumber,
            address: customerAddress,
            city: fc.City || null,
            postalCode: fc.ZipCode || null,
            notes: `Importerat från Fortnox-projekt ${projectNumber}`,
          });
        }
      } else if (deliveries.length > 0) {
        // Annars: ett objekt per leveransadress
        for (const d of deliveries) {
          const daId = String(d.DeliveryAddressId || "");
          if (!daId) continue;
          const daAddress = [d.Address1, d.Address2].filter(Boolean).join(", ") || null;
          const labelPart = d.City || d.Address1 || `Leveransadress ${daId}`;
          subObjects.push({
            fortnoxId: `delivery:${customerNumber}:${daId}`,
            name: `${fc.Name} – ${labelPart}`,
            objectNumber: `${customerNumber}-${daId}`,
            address: daAddress,
            city: (d.City as string) || null,
            postalCode: (d.ZipCode as string) || null,
            notes: `Importerat från Fortnox-leveransadress ${daId}`,
          });
        }
      } else {
        // Fallback: ett standardobjekt per kund (befintligt beteende)
        subObjects.push({
          fortnoxId: customerNumber,
          name: fc.City ? `${fc.Name} – ${fc.City}` : fc.Name,
          objectNumber: customerNumber,
          address: customerAddress,
          city: fc.City || null,
          postalCode: fc.ZipCode || null,
          notes: "Skapad automatiskt vid Fortnox-import",
        });
      }

      for (const so of subObjects) {
        try {
          if (objectFortnoxIds.has(so.fortnoxId)) {
            objectSummary.skipped++;
            continue;
          }

          const createdObjectId = await db.transaction(async (tx) => {
            const [created] = await tx.insert(objects).values({
              tenantId,
              name: so.name,
              objectNumber: so.objectNumber,
              objectType: "fastighet",
              hierarchyLevel: "fastighet",
              objectLevel: 1,
              address: so.address,
              city: so.city,
              postalCode: so.postalCode,
              status: "active",
              importBatchId,
            }).returning();
            await tx.insert(fortnoxMappings).values({
              tenantId,
              entityType: "object",
              unicornId: created.id,
              fortnoxId: so.fortnoxId,
            });
            return created.id;
          });
          await ensurePrimaryPayer(tenantId, createdObjectId, unicornCustomerId, "import-explicit");
          objectFortnoxIds.add(so.fortnoxId);
          objectSummary.created++;
          if (so.address && so.address.trim() !== "") {
            newObjectIdsForGeocoding.push(createdObjectId);
          }
        } catch (err) {
          objectSummary.errors++;
          const friendly = describeFortnoxMappingConflict(err);
          const detail = friendly || (err instanceof Error ? err.message : String(err));
          errorMessages.push(`Objekt ${so.fortnoxId} (kund ${customerNumber}): ${detail}`);
        }
      }
    }

    // === STEP 3: Customer Contacts -> object_contacts ===
    const existingContactMappings = await storage.getFortnoxMappings(tenantId, "customer_contact");
    const contactFortnoxIds = new Set(existingContactMappings.map(m => m.fortnoxId));
    // Bygg kund-nr → första objekt-id från alla objekt-mappningar (inkl. de nyskapade).
    // Eftersom sub-objekt nu har olika fortnoxId-prefix (project:, delivery:, eller bara
    // kundnumret), härleder vi kundnumret per mappning för att kunna länka kontakter.
    const objectMappingsAfter = await storage.getFortnoxMappings(tenantId, "object");
    const customerNumberToObjectId = new Map<string, string>();
    for (const m of objectMappingsAfter) {
      let cn: string | null = null;
      if (m.fortnoxId.startsWith("delivery:")) {
        cn = m.fortnoxId.split(":")[1] || null;
      } else if (m.fortnoxId.startsWith("project:")) {
        // Projekt-mappningar saknar kundkoppling — hoppa över här.
        continue;
      } else {
        cn = m.fortnoxId; // legacy: kundnr som fortnoxId
      }
      if (cn && !customerNumberToObjectId.has(cn)) {
        customerNumberToObjectId.set(cn, m.unicornId);
      }
    }

    for (const fc of fortnoxCustomers) {
      const customerNumber = (fc.CustomerNumber || "").toString();
      if (!customerNumber) continue;

      const objectId = customerNumberToObjectId.get(customerNumber);
      if (!objectId) continue;

      let contacts;
      try {
        contacts = await client.getCustomerContacts(customerNumber);
      } catch (err) {
        contactSummary.errors++;
        errorMessages.push(`Kontakter för kund ${customerNumber}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      for (const cp of contacts) {
        const contactPersonId = cp.ContactPersonId != null ? String(cp.ContactPersonId) : "";
        if (!contactPersonId) {
          contactSummary.errors++;
          continue;
        }
        const mappingFortnoxId = `${customerNumber}:${contactPersonId}`;

        try {
          if (contactFortnoxIds.has(mappingFortnoxId)) {
            contactSummary.skipped++;
            continue;
          }

          const name = (cp.ContactPersonName || "").toString().trim();
          const email = (cp.Email || cp.EmailInvoice || "").toString().trim() || null;
          const phone = (cp.Phone1 as string) || (cp.Phone2 as string) || null;
          const role = (cp.Position || "").toString().trim() || null;

          if (!name && !email && !phone) {
            contactSummary.skipped++;
            continue;
          }

          // Etapp 5: kontakter skrivs som Kontakt-metadata (flervärdes-familjen).
          const { writeObjectKontaktPerson } = await import("../metadata-queries");
          await writeObjectKontaktPerson(objectId, tenantId, {
            namn: name || email || phone || "Kontakt",
            titel: role,
            telefon: phone,
            epost: email,
          }, "fortnox-import");
          await db.insert(fortnoxMappings).values({
            tenantId,
            entityType: "customer_contact",
            unicornId: objectId,
            fortnoxId: mappingFortnoxId,
          });
          contactFortnoxIds.add(mappingFortnoxId);
          contactSummary.created++;
        } catch (err) {
          contactSummary.errors++;
          const friendly = describeFortnoxMappingConflict(err);
          const detail = friendly || (err instanceof Error ? err.message : String(err));
          errorMessages.push(`Kontakt ${mappingFortnoxId}: ${detail}`);
        }
      }
    }

    // === STEP 4: Articles (optional) ===
    if (includeArticles) {
      try {
        const fortnoxArticles = await client.getArticles();
        const existingArticleMappings = await storage.getFortnoxMappings(tenantId, "article");
        const articleFortnoxIds = new Set(existingArticleMappings.map(m => m.fortnoxId));

        for (const fa of fortnoxArticles) {
          const articleNumber = (fa.ArticleNumber || "").toString();
          if (!articleNumber) {
            articleSummary.errors++;
            continue;
          }

          try {
            if (articleFortnoxIds.has(articleNumber)) {
              articleSummary.skipped++;
              continue;
            }

            await db.transaction(async (tx) => {
              const [created] = await tx.insert(articles).values({
                tenantId,
                articleNumber,
                name: fa.Description || articleNumber,
                description: fa.Description || "",
                unit: fa.Unit || "st",
                listPrice: Math.round((Number(fa.SalesPrice) || 0) * 100),
                articleType: fa.Type === "STOCK" ? "vara" : "tjanst",
              }).returning();
              await tx.insert(fortnoxMappings).values({
                tenantId,
                entityType: "article",
                unicornId: created.id,
                fortnoxId: articleNumber,
              });
            });
            articleFortnoxIds.add(articleNumber);
            articleSummary.created++;
          } catch (err) {
            articleSummary.errors++;
            const friendly = describeFortnoxMappingConflict(err);
            const detail = friendly || (err instanceof Error ? err.message : String(err));
            errorMessages.push(`Artikel ${articleNumber}: ${detail}`);
          }
        }
      } catch (err) {
        errorMessages.push(`Artikelhämtning misslyckades: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // === STEP 4: Queue geocoding for newly created objects with addresses ===
    for (const newObjectId of newObjectIdsForGeocoding) {
      triggerGeocodeIfMissing(newObjectId);
    }
    objectSummary.geocodingQueued = newObjectIdsForGeocoding.length;
    if (newObjectIdsForGeocoding.length > 0) {
      console.log(
        `[fortnox-full-import] Queued ${newObjectIdsForGeocoding.length} new object(s) for geocoding (tenant ${tenantId})`
      );
    }

    res.json({
      success: true,
      importBatchId,
      summary: {
        customers: customerSummary,
        objects: objectSummary,
        contacts: contactSummary,
        articles: articleSummary,
      },
      errors: errorMessages.slice(0, 20),
    });
}));

}
