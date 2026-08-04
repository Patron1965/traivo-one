// ============================================
// Task #996: Automatisk körning av abonnemang/schema-orderkoncept
// ============================================
// Tenant-scopead, miljövariabel-gateadad bakgrundsprocess som periodiskt hittar
// orderkoncept vars nästa körning (`nextRunDate`) är förfallen och kör dem genom
// den befintliga expansions-/fakturavägen — utan att en användare behöver trycka
// "Kör koncept". Mönstret speglar samlingsfaktura-schemaläggaren
// (`invoice-consolidation-scheduler.ts`): env-gate, hourly-intervall, per-tenant-loop
// med per-tenant/per-koncept try/catch så att en trasig tenant/koncept inte stoppar
// övriga.
//
// Två metoder auto-körs (via getOrderConceptMethod):
//  - subscription (abonnemang): genererar en customer_invoice för perioden
//    (totalUnits × monthlyFee × stegmånader) och avancerar nextRunDate via
//    computeSubscriptionNextRun. Manuell `:id/execute` "aktiverar" bara
//    abonnemanget (skapar ingen faktura) — den vägen lämnas oförändrad.
//  - schedule (schema): genererar schemalagda uppgifter via samma
//    generateScheduleAssignments som /execute (idempotent) och rullar fram
//    nextRunDate så horisonten fortsätter framåt.
//
// Avrop (call_off) är on-demand och auto-körs ALDRIG här.
//
// Dubbelkörning per period förhindras på två nivåer: (1) vi gate:ar på
// nextRunDate <= now och avancerar alltid nextRunDate strikt förbi now efter en
// lyckad körning, så samma period aldrig triggar igen; (2) en process-lokal
// `running`-flagga hindrar överlappande tick (en körning som tar längre tid än
// intervallet startar inte en parallell körning).
//
// Defense-in-depth: alla UPDATE/COUNT mot order_concepts/customer_invoices går
// via tenant-scopade helpers (storage.updateOrderConcept har tenant_id i WHERE;
// invoice-inserten stämplar tenantId).

import { db } from "../db";
import { resolveArticleCostBasisOre } from "@shared/article-pricing";
import { and, eq, isNull, lte, isNotNull } from "drizzle-orm";
import { tenants, orderConcepts, customerInvoices, type OrderConcept } from "@shared/schema";
import { getOrderConceptMethod } from "@shared/order-concept-method";
import { storage } from "../storage";
import { resolveConceptMatchingObjects } from "./order-concept-targeting";
import { resolveActiveArticle, resolveConceptArticleHits } from "./order-concept-article-hits";
import { computeConceptSubscriptionFee, groupSubscriptionInvoices } from "./order-concept-subscription";
import {
  computeSubscriptionNextRun,
  generateScheduleAssignments,
  prepareConceptCustomerPricing,
} from "../routes/fortnoxRoutes";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const DEFAULT_INITIAL_DELAY_MS = 3 * 60 * 1000; // 3 min

export interface AutoRunResult {
  conceptsConsidered: number;
  subscriptionsBilled: number;
  invoicesCreated: number;
  schedulesExpanded: number;
  assignmentsCreated: number;
  failures: number;
}

function emptyResult(): AutoRunResult {
  return {
    conceptsConsidered: 0,
    subscriptionsBilled: 0,
    invoicesCreated: 0,
    schedulesExpanded: 0,
    assignmentsCreated: 0,
    failures: 0,
  };
}

// Stegmånader per faktureringsfrekvens — samma härledning som /execute.
// Task #1064: billingFrequency (monthly/quarterly/yearly) är enda källan.
function stepMonthsFor(freq: string): number {
  return freq === "yearly" ? 12 : freq === "quarterly" ? 3 : 1;
}

async function loadConceptFilterInputs(conceptId: string) {
  const filters = await storage.getConceptFilters(conceptId);
  return filters.map((f: any) => ({
    metadataKey: f.metadataKey,
    operator: f.operator,
    filterValue: f.filterValue,
  }));
}

// === Abonnemang: generera fakturering för alla förfallna perioder ===
// Hela körningen (claim + fakturor + nextRunDate-avancering) sker i EN transaktion
// med rad-lås (SELECT ... FOR UPDATE) på konceptet:
//  - Rad-låset serialiserar samtidiga körare (scheduler + manuell trigger +
//    multi-instans). Förloraren ser ett redan-avancerat nextRunDate och hoppar över.
//  - Atomiciteten gör att om någon faktura-insert failar rullas ALLT tillbaka
//    (inkl. nextRunDate) → perioden återförsöks nästa tick utan dubbletter.
//  - Catch-up: om konceptet är flera perioder försenat faktureras VARJE missad
//    period exakt en gång (inte bara en period med ett framhoppat datum).
async function runSubscriptionConcept(
  concept: OrderConcept,
  tenantId: string,
  now: Date,
  result: AutoRunResult,
): Promise<void> {
  if (concept.customerMode !== "FROM_METADATA" && !concept.customerId) {
    // HARDCODED utan kund kan inte fakturera — hoppa över utan att avancera nextRunDate
    // (annars tyst skippad fakturering tills någon märker att kund saknas).
    console.warn(
      `[order-concept-autorun] tenant=${tenantId} concept=${concept.id} HARDCODED saknar fakturakund — hoppar över`,
    );
    result.failures++;
    return;
  }

  // Läsningar (objekt + kund-/enhetsgruppering) sker utanför transaktionen — de
  // muterar inget och behöver inte hålla rad-låset. Korrekthetsinvarianten (ingen
  // dubbelfakturering per period) garanteras av rad-låset + nextRunDate-avanceringen.
  const filterInputs = await loadConceptFilterInputs(concept.id);
  const { matchingObjects } = await resolveConceptMatchingObjects(
    tenantId,
    concept as any,
    filterInputs,
    { fallbackAllObjects: true },
  );

  const isFromMetadata = concept.customerMode === "FROM_METADATA";
  // FROM_METADATA: härled fakturakund per objekt (kastar om något objekt inte kan
  // resolvas → fångas per-koncept, nextRunDate avanceras ej). HARDCODED: konceptets
  // fasta kund för alla objekt.
  const { customerIdForObject } = await prepareConceptCustomerPricing({
    concept: concept as any,
    tenantId,
    matchingObjects,
    runPrePass: isFromMetadata,
  });

  // Task #1057: dynamisk avgift = summan av uppgifternas ordervärde knutna till
  // objekten (samma kanoniska motor som Granska/sidofältet). Kan inte beräknas
  // (inget ordervärde) ⇒ hoppa över UTAN att avancera nextRunDate, så ett åtgärdat
  // koncept (pris/artikel tillagd) plockas upp nästa tick utan att perioden tappas.
  const fee = await computeConceptSubscriptionFee(tenantId, concept as any, {
    matchingObjects,
  });
  if (!fee.canCompute) {
    console.warn(
      `[order-concept-autorun] tenant=${tenantId} concept=${concept.id} kan inte beräkna abonnemangsavgift (inget ordervärde på uppgifterna) — hoppar över`,
    );
    result.failures++;
    return;
  }

  // Fördela ordervärdet per FAKTURA = (fakturakund) × (fakturastopp-segment).
  // HARDCODED ⇒ en kund/toppnivå; FROM_METADATA ⇒ per-objekt-kund = delning på lägre
  // nivåer. Fakturastopp (Task #1067) delar dessutom upp SAMMA kund organisatoriskt
  // per unikt metadatavärde (concept.departmentMetadataField). Utan fakturastopp
  // degenererar grupperingen till en grupp per kund = dagens beteende. perObjectValuesOre
  // är en exakt heltals-fördelning (största-rest) ⇒ Σ per grupp === totalValueOre exakt.
  // groupSubscriptionInvoices är ENDA källan så förhandsvisning/Granska grupperar identiskt.
  const groups = await groupSubscriptionInvoices({
    tenantId,
    concept: concept as any,
    matchingObjects,
    perObjectValuesOre: fee.perObjectValuesOre,
    customerIdForObject: (objId) =>
      isFromMetadata ? customerIdForObject(objId) : concept.customerId,
  });

  const freq = (concept.billingFrequency as string) || "monthly";
  const stepMonths = stepMonthsFor(freq);

  const outcome = await db.transaction(async (tx) => {
    // CLAIM: lås konceptraden och läs auktoritativt nextRunDate. En samtidig körare
    // blockeras här tills denna tx commitar och ser då det avancerade datumet.
    const [locked] = await tx
      .select()
      .from(orderConcepts)
      .where(and(
        eq(orderConcepts.id, concept.id),
        eq(orderConcepts.tenantId, tenantId),
        isNull(orderConcepts.deletedAt),
      ))
      .for("update");
    if (!locked || !locked.nextRunDate || new Date(locked.nextRunDate) > now) {
      // Inte (längre) förfallen — annan körare hann före, eller redan kört.
      return { claimed: false, invoices: 0, periods: 0 };
    }

    // Catch-up: räkna upp varje period vars start ligger <= now. Varje period
    // faktureras en gång; nextRunDate sätts till första perioden strikt efter now.
    const periods: { start: Date; end: Date }[] = [];
    let cursor = new Date(locked.nextRunDate);
    let guard = 0;
    while (cursor <= now && guard < 240) {
      const periodEnd = new Date(cursor);
      periodEnd.setMonth(periodEnd.getMonth() + stepMonths);
      periods.push({ start: new Date(cursor), end: new Date(periodEnd) });
      cursor = periodEnd;
      guard++;
    }
    const newNextRun = cursor;

    let invoicesCreated = 0;
    for (let pi = 0; pi < periods.length; pi++) {
      const p = periods[pi];
      for (const g of groups) {
        // Fakturasummor lagras i KRONOR. g.valueOre är heltals-öre; multiplicera
        // med antal månader (heltal) FÖRE division med 100 så att resultatet blir exakt
        // kronor med två decimaler (inga binär-flyt-artefakter).
        const perInvoiceTotal = (g.valueOre * stepMonths) / 100;
        if (perInvoiceTotal <= 0) continue;
        const invoiceNumber = `SUB-${p.start.getFullYear()}${String(p.start.getMonth() + 1).padStart(2, "0")}${String(p.start.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        // Fakturastopp (Task #1067): segment-suffix på beskrivningen så en split-faktura
        // tydligt visar vilken organisatorisk nivå den gäller (samma kund för alla segment).
        const description = g.segmentKey
          ? `Abonnemang: ${concept.name} – ${g.groupingFieldName}: ${g.groupingValue} (beräknad avgift, ${freq})`
          : `Abonnemang: ${concept.name} (beräknad avgift, ${freq})`;
        await tx.insert(customerInvoices).values({
          tenantId,
          customerId: g.customerId,
          invoiceNumber,
          invoiceDate: now,
          dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          amount: perInvoiceTotal,
          vatAmount: 0,
          totalAmount: perInvoiceTotal,
          currency: "SEK",
          status: "unpaid",
          // Abonnemangsfakturor går inte via samlingsfaktura-konsolideringen (de har
          // inga work_orders); de är direkt redo för Fortnox-export.
          state: "pending",
          description,
          consolidationPeriodStart: p.start,
          consolidationPeriodEnd: p.end,
          // Frozen billing-segment (Task #1067). NULL = kundnivå (dagens beteende).
          billingSegmentKey: g.segmentKey,
          billingBreakObjectId: g.breakObjectId,
          billingGroupingFieldName: g.groupingFieldName,
          billingGroupingValue: g.groupingValue,
        });
        invoicesCreated++;
      }
    }

    // Avancera nextRunDate i SAMMA transaktion som fakturorna. Tenant_id i WHERE
    // (defense-in-depth) — raden är redan låst på id+tenant.
    await tx
      .update(orderConcepts)
      .set({ lastRunDate: now, nextRunDate: newNextRun })
      .where(and(
        eq(orderConcepts.id, concept.id),
        eq(orderConcepts.tenantId, tenantId),
      ));

    return { claimed: true, invoices: invoicesCreated, periods: periods.length };
  });

  if (!outcome.claimed) return;
  result.invoicesCreated += outcome.invoices;
  if (outcome.invoices > 0) result.subscriptionsBilled++;
  if (outcome.periods > 1) {
    console.log(
      `[order-concept-autorun] tenant=${tenantId} concept=${concept.id} catch-up: fakturerade ${outcome.periods} förfallna perioder`,
    );
  }
}

// === Schema: generera schemalagda uppgifter och rulla fram horisonten ===
async function runScheduleConcept(
  concept: OrderConcept,
  tenantId: string,
  now: Date,
  result: AutoRunResult,
): Promise<void> {
  const originalNextRunDate = concept.nextRunDate ? new Date(concept.nextRunDate) : null;
  const originalLastRunDate = concept.lastRunDate ? new Date(concept.lastRunDate) : null;
  const scheduleNextRun = new Date(now.getFullYear(), now.getMonth() + (concept.rollingMonths || 3), 1);

  // Återställer claim:ens datum-avancering (vid felkonfig ELLER kastat fel i
  // expansionen) så perioden inte tappas — annars behandlas en misslyckad körning
  // som klar och återförsöks aldrig.
  const restoreClaim = async () => {
    if (originalNextRunDate) {
      await storage.updateOrderConcept(concept.id, tenantId, {
        nextRunDate: originalNextRunDate,
        lastRunDate: originalLastRunDate ?? undefined,
      });
    }
  };

  // CLAIM: lås konceptraden, verifiera att den fortfarande är förfallen och avancera
  // nextRunDate i en transaktion FÖRE expansionen. Det serialiserar samtidiga körare
  // (scheduler + manuell trigger + multi-instans) — förloraren ser det avancerade
  // datumet och hoppar över, så schemat expanderas aldrig två gånger för samma period.
  const claimed = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(orderConcepts)
      .where(and(
        eq(orderConcepts.id, concept.id),
        eq(orderConcepts.tenantId, tenantId),
        isNull(orderConcepts.deletedAt),
      ))
      .for("update");
    if (!locked || !locked.nextRunDate || new Date(locked.nextRunDate) > now) {
      return false;
    }
    await tx
      .update(orderConcepts)
      .set({ lastRunDate: now, nextRunDate: scheduleNextRun })
      .where(and(
        eq(orderConcepts.id, concept.id),
        eq(orderConcepts.tenantId, tenantId),
      ));
    return true;
  });
  if (!claimed) return;

  // Allt efter claim:en wrappas så att ett kastat fel (DB-fel, transient beroende)
  // återställer det avancerade datumet innan felet bubblar upp till per-koncept-catch.
  try {
  const filterInputs = await loadConceptFilterInputs(concept.id);
  const { matchingObjects } = await resolveConceptMatchingObjects(
    tenantId,
    concept as any,
    filterInputs,
    { fallbackAllObjects: true },
  );

  let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
  let linkedArticleId: string | null = concept.articleId ?? null;
  let linkedPrice = { price: 0, cost: 0, productionMinutes: 0, priceListId: null as string | null };
  if (concept.articleId) {
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

  const hits = await resolveConceptArticleHits({
    tenantId,
    concept: concept as any,
    linkedArticle,
    matchingObjects,
  });
  const expansionObjects = hits ? hits.hitObjects : matchingObjects;

  const { isFromMetadata, customerIdForObject, resolvePrice } = await prepareConceptCustomerPricing({
    concept: concept as any,
    tenantId,
    matchingObjects: expansionObjects,
    runPrePass: true,
  });

  const scheduleResult = await generateScheduleAssignments({
    concept: concept as any,
    tenantId,
    userId: undefined,
    matchingObjects: expansionObjects,
    linkedArticle,
    linkedArticleId,
    linkedPrice,
    isFromMetadata,
    customerIdForObject,
    resolvePrice,
    quantityByObjectId: hits?.quantityByObjectId,
  });

  if (scheduleResult === null) {
    // Saknar leveransschema/intervall — felkonfigurerat. Claim:en har redan avancerat
    // nextRunDate; återställ det förfallna datumet så ett åtgärdat koncept kan plockas
    // upp igen nästa tick istället för att tappa perioden.
    await restoreClaim();
    console.warn(
      `[order-concept-autorun] tenant=${tenantId} concept=${concept.id} schema saknar leveransschema/intervall — hoppar över`,
    );
    result.failures++;
    return;
  }

  // nextRunDate avancerades redan i claim-transaktionen ovan.
  result.schedulesExpanded++;
  result.assignmentsCreated += scheduleResult.created.length;
  } catch (err) {
    // Expansionen kastade efter claim:en — återställ datumet så perioden återförsöks,
    // och låt felet bubbla upp till per-koncept-catch (loggning + failures++).
    await restoreClaim();
    throw err;
  }
}

// Kör alla förfallna abonnemang/schema-koncept för EN tenant. Per-koncept try/catch
// så att ett trasigt koncept inte stoppar övriga inom samma tenant.
export async function runDueConceptsForTenant(
  tenantId: string,
  opts: { now?: Date } = {},
): Promise<AutoRunResult> {
  const now = opts.now ?? new Date();
  const result = emptyResult();

  const dueConcepts = await db
    .select()
    .from(orderConcepts)
    .where(and(
      eq(orderConcepts.tenantId, tenantId),
      eq(orderConcepts.status, "active"),
      isNull(orderConcepts.deletedAt),
      isNotNull(orderConcepts.nextRunDate),
      lte(orderConcepts.nextRunDate, now),
    ));

  for (const concept of dueConcepts) {
    const method = getOrderConceptMethod(concept);
    if (method !== "subscription" && method !== "schedule") continue;
    result.conceptsConsidered++;
    try {
      if (method === "subscription") {
        await runSubscriptionConcept(concept, tenantId, now, result);
      } else {
        await runScheduleConcept(concept, tenantId, now, result);
      }
    } catch (err) {
      result.failures++;
      console.error(
        `[order-concept-autorun] tenant=${tenantId} concept=${concept.id} (${method}) misslyckades`,
        err,
      );
    }
  }

  return result;
}

async function runForAllTenants(): Promise<void> {
  try {
    const allTenants = await db.select({ id: tenants.id }).from(tenants).where(isNull(tenants.deletedAt));
    for (const t of allTenants) {
      try {
        const result = await runDueConceptsForTenant(t.id, { now: new Date() });
        if (result.invoicesCreated > 0 || result.assignmentsCreated > 0 || result.failures > 0) {
          console.log(
            `[order-concept-autorun] tenant=${t.id} considered=${result.conceptsConsidered} subs=${result.subscriptionsBilled} invoices=${result.invoicesCreated} schedules=${result.schedulesExpanded} assignments=${result.assignmentsCreated} failures=${result.failures}`,
          );
        }
      } catch (err) {
        console.error(`[order-concept-autorun] tenant ${t.id} failed`, err);
      }
    }
  } catch (err) {
    console.error("[order-concept-autorun] scheduler fatal", err);
  }
}

class OrderConceptAutoRunScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeoutId: NodeJS.Timeout | null = null;
  private running = false;

  private get enabled(): boolean {
    const flag = process.env.ORDER_CONCEPT_AUTORUN_ENABLED;
    if (flag === undefined) return true;
    return !["0", "false", "no", "off"].includes(flag.toLowerCase());
  }

  private get intervalMs(): number {
    return parsePositiveInt(process.env.ORDER_CONCEPT_AUTORUN_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  }

  private get initialDelayMs(): number {
    return parsePositiveInt(process.env.ORDER_CONCEPT_AUTORUN_INITIAL_DELAY_MS, DEFAULT_INITIAL_DELAY_MS);
  }

  // Process-lokal överlappnings-spärr: en pågående körning får aldrig starta en
  // parallell körning (skyddar mot dubbel-fakturering om en körning tar längre tid
  // än intervallet).
  private async runGuarded(): Promise<void> {
    if (this.running) {
      console.log("[order-concept-autorun] Föregående körning pågår fortfarande — hoppar över denna tick");
      return;
    }
    this.running = true;
    try {
      await runForAllTenants();
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (!this.enabled) {
      console.log("[order-concept-autorun] Disabled via ORDER_CONCEPT_AUTORUN_ENABLED");
      return;
    }
    if (this.intervalId || this.initialTimeoutId) return;
    const intervalMs = this.intervalMs;
    const initialDelayMs = this.initialDelayMs;
    console.log(
      `[order-concept-autorun] Started (interval ${Math.round(intervalMs / 60000)} min, first run in ${Math.round(initialDelayMs / 1000)}s)`,
    );
    this.initialTimeoutId = setTimeout(() => {
      this.initialTimeoutId = null;
      void this.runGuarded();
    }, initialDelayMs);
    this.intervalId = setInterval(() => void this.runGuarded(), intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
  }

  async runNow(): Promise<void> {
    await this.runGuarded();
  }
}

export const orderConceptAutoRunScheduler = new OrderConceptAutoRunScheduler();
