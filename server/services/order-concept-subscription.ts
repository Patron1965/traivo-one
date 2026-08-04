// ============================================
// Task #1057: Dynamisk abonnemangsavgift
// ============================================
// Tidigare angavs abonnemangsavgiften manuellt som ett statiskt "Avgift per enhet
// (kr)"-fält (orderConcepts.monthlyFee). Nu härleds avgiften DYNAMISKT från summan
// av ordervärdet på de uppgifter som är knutna till objekten — samma kanoniska
// ordervärdes-motor (computeConceptOrderValue, ÖRE) som driver sidofältet och
// Granska-steget. Det här är ENDA källan för den beräknade abonnemangsavgiften så
// att schemaläggaren (löpande fakturering), manuell aktivering, förhandsvisning och
// Granska alltid räknar identiskt.
//
// Fördelning per fakturanivå sker naturligt hos anroparen: avgiften distribueras
// per matchat objekt (perObjectValuesOre — exakt heltals-fördelning med största-rest-
// metoden) och anroparen grupperar objekten per upplöst fakturakund (HARDCODED ⇒ en
// kund/toppnivå; FROM_METADATA ⇒ delas på de lägre kundnivåerna via per-objekt-
// kundupplösning). Summan av per-kund-beloppen är ALLTID exakt lika med totalValueOre
// (restören delas ut deterministiskt, ingen avrundning över/under den kanoniska avgiften).

import { storage } from "../storage";
import { resolveArticleCostBasisOre } from "@shared/article-pricing";
import { computeConceptOrderValue } from "@shared/order-concept-value";
import { resolveConceptMatchingObjects } from "./order-concept-targeting";
import {
  resolveActiveArticle,
  resolveConceptArticleHits,
  isFixedPriceConcept,
} from "./order-concept-article-hits";
import { getArticleMetadataForObject } from "../metadata-queries";

export interface SubscriptionFeeResult {
  /** Total beräknad abonnemangsavgift för en period (ÖRE, heltal). */
  totalValueOre: number;
  /**
   * Exakt per-objekt-fördelning (ÖRE, heltal), i samma ordning som de matchande
   * objekten. Använder största-rest-metoden så att restören delas ut deterministiskt
   * ⇒ Σ(perObjectValuesOre) === totalValueOre exakt (inga avrundningstapp).
   * Anroparen grupperar dessa per fakturakund för exakt summa per nivå.
   */
  perObjectValuesOre: number[];
  /** Antal matchande objekt som avgiften fördelas över. */
  matchedCount: number;
  /** Antal träff-objekt (relevant vid fast pris). */
  hitCount: number;
  /** True när avgiften kan beräknas (ordervärde > 0). */
  canCompute: boolean;
}

// Fördelar ett heltals-örebelopp jämnt över `count` poster med största-rest-metoden:
// bas = floor(total/count), och de första `rest` posterna får +1 öre. Garanterar att
// summan av resultatet exakt är `totalOre` (till skillnad från Math.round per post,
// som kan ge Σ ≠ total vid icke-jämn delning).
export function distributeOreEvenly(totalOre: number, count: number): number[] {
  if (count <= 0) return [];
  const safeTotal = Math.round(totalOre);
  const base = Math.floor(safeTotal / count);
  let remainder = safeTotal - base * count;
  const out = new Array<number>(count).fill(base);
  for (let i = 0; i < count && remainder > 0; i++) {
    out[i] += 1;
    remainder--;
  }
  return out;
}

// Beräknar den dynamiska abonnemangsavgiften för ett orderkoncept. Anroparen kan
// skicka in redan upplösta matchande objekt (matchingObjects) för att undvika dubbel
// upplösning; annars resolvas de här (samma väg som execute/preview).
export async function computeConceptSubscriptionFee(
  tenantId: string,
  concept: any,
  opts: { matchingObjects?: Array<{ id: string }> } = {},
): Promise<SubscriptionFeeResult> {
  let matchingObjects = opts.matchingObjects;
  if (!matchingObjects) {
    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    const resolved = await resolveConceptMatchingObjects(
      tenantId,
      concept,
      filterInputs,
      { fallbackAllObjects: true },
    );
    matchingObjects = resolved.matchingObjects;
  }
  const matchedCount = matchingObjects.length;

  // Artikelrader → värde-input (samma härledning som Granska/sidofältet).
  const conceptArticleRows = await storage.getOrderConceptArticles(concept.id);
  const tenantArticles = await storage.getArticles(tenantId);
  const articleMap = new Map(tenantArticles.map((a: any) => [a.id, a]));
  const valueArticleInputs = conceptArticleRows.map((ca: any) => {
    const art: any = articleMap.get(ca.articleId);
    return {
      unitPriceOre: ca.unitPrice ?? art?.listPrice ?? 0,
      quantity: ca.quantity || 1,
      costOre: art ? resolveArticleCostBasisOre(art) : 0,
      productionTimeMinutes: art?.productionTime ?? 0,
    };
  });

  // Fast pris baseras på antal TRÄFF-objekt (hitCount); löpande pris påverkas inte
  // av artikelträffar ⇒ hoppa den extra upplösningen då.
  let hitCount = matchedCount;
  if (isFixedPriceConcept(concept)) {
    let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined;
    if (concept.articleId) {
      linkedArticle = await resolveActiveArticle(
        tenantId,
        await storage.getArticle(concept.articleId),
      );
    }
    const hits = await resolveConceptArticleHits({
      tenantId,
      concept,
      linkedArticle,
      matchingObjects: matchingObjects as any,
    });
    hitCount = hits.hitCount;
  }

  // Abonnemang skapar inga generationer ⇒ generationFactor = 1 (taskCount = hitCount).
  const orderValue = computeConceptOrderValue({
    matchedCount,
    articles: valueArticleInputs,
    priceModel: concept.priceModel,
    fixedPriceAmountOre: concept.fixedPriceAmount ?? null,
    fixedPriceBasis: concept.fixedPriceBasis ?? null,
    fixedPriceUnitCount: hitCount,
    taskCount: hitCount,
  });

  const totalValueOre = Math.round(orderValue.totalValueOre);
  const perObjectValuesOre = distributeOreEvenly(totalValueOre, matchedCount);

  return {
    totalValueOre,
    perObjectValuesOre,
    matchedCount,
    hitCount,
    canCompute: totalValueOre > 0,
  };
}

// ============================================
// Task #1067: Fakturastopp per kundnivå för abonnemang (runtime-split)
// ============================================
// Ett orderkoncept kan konfigureras med ett "fakturastopp" (Step 3 →
// metadatabaserad referens): SAMMA kund hela vägen, men fakturan delas upp
// ORGANISATORISKT per unikt värde i ett metadatafält (t.ex. fastighet, område,
// distrikt, förvaltare). Hittills hade detta ingen runtime-effekt för abonnemang —
// schemaläggaren skapade alltid EN faktura per fakturakund. Denna helper är ENDA
// källan för split-grupperingen så att schemaläggaren (exekvering) och
// förhandsvisningen/Granska alltid grupperar identiskt (preview == execute).
//
// Avgiften (perObjectValuesOre) återanvänds OFÖRÄNDRAD från
// computeConceptSubscriptionFee — denna helper omgrupperar bara redan beräknade
// per-objekt-belopp; den räknar aldrig om avgiften.

export interface SubscriptionInvoiceGroup {
  /** Upplöst fakturakund (samma kund för alla segment vid fakturastopp). */
  customerId: string;
  /** Stabil segmentnyckel (`fält=normaliserat värde`) eller null = kundnivå (ingen split). */
  segmentKey: string | null;
  /** Metadatafältet fakturan delas på (departmentMetadataField), eller null vid kundnivå. */
  groupingFieldName: string | null;
  /** Råvärdet (displayValue) för segmentet, eller null vid kundnivå. */
  groupingValue: string | null;
  /** Objekt-break finns inte för metadatafält-split (det är WO-flödets modell) ⇒ alltid null. */
  breakObjectId: string | null;
  /** Summa per-objekt-ordervärde (ÖRE, heltal) för detta segment. */
  valueOre: number;
  /** Objekten som ingår i segmentet. */
  objectIds: string[];
}

// Fakturastopp är aktivt när konsolideringen INTE är ren kundnivå (customer/per_job)
// OCH ett metadatafält att dela på är valt. Samma derivering som klienten
// (Step3Invoicing) och buildConceptPatch (se order-concept-faktura-niva).
export function isConceptFakturastopp(concept: any): boolean {
  const c = String(concept?.invoiceConsolidation ?? "").trim();
  const field = String(concept?.departmentMetadataField ?? "").trim();
  return c !== "" && c !== "customer" && c !== "per_job" && field !== "";
}

function normalizeSegmentValue(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// Grupperar den dynamiska abonnemangsavgiften per faktura = (fakturakund) ×
// (fakturastopp-segment). Utan fakturastopp (eller objekt som saknar värde på
// split-fältet) degenererar grupperingen till EN grupp per kund = dagens beteende
// (full back-compat, segmentKey = null).
export async function groupSubscriptionInvoices(opts: {
  tenantId: string;
  concept: any;
  matchingObjects: Array<{ id: string }>;
  perObjectValuesOre: number[];
  customerIdForObject: (objectId: string) => string | null | undefined;
}): Promise<SubscriptionInvoiceGroup[]> {
  const { tenantId, concept, matchingObjects, perObjectValuesOre, customerIdForObject } = opts;
  const fakturastopp = isConceptFakturastopp(concept);
  const field = fakturastopp ? String(concept.departmentMetadataField).trim() : "";

  // Memoisera metadata-uppslag per objekt (objekt är unika ⇒ mest defensivt).
  const segmentCache = new Map<string, { segmentKey: string | null; groupingValue: string | null }>();

  const groups = new Map<string, SubscriptionInvoiceGroup>();
  for (let i = 0; i < matchingObjects.length; i++) {
    const obj = matchingObjects[i];
    const customerId = customerIdForObject(obj.id);
    if (!customerId) continue;
    const valueOre = perObjectValuesOre[i] ?? 0;

    let segmentKey: string | null = null;
    let groupingValue: string | null = null;

    if (fakturastopp && field) {
      let cached = segmentCache.get(obj.id);
      if (!cached) {
        cached = { segmentKey: null, groupingValue: null };
        try {
          const md = await getArticleMetadataForObject(obj.id, field, tenantId);
          const raw = md
            ? md.displayValue?.trim() || (md.value != null ? String(md.value).trim() : "")
            : "";
          if (raw) {
            cached.groupingValue = raw;
            cached.segmentKey = `${field}=${normalizeSegmentValue(raw)}`;
          }
        } catch (e) {
          console.error(
            `[order-concept-subscription] fakturastopp metadata-uppslag misslyckades (objekt=${obj.id} fält=${field}):`,
            e,
          );
        }
        segmentCache.set(obj.id, cached);
      }
      segmentKey = cached.segmentKey;
      groupingValue = cached.groupingValue;
    }

    const key = segmentKey ? `c:${customerId}|${segmentKey}` : `c:${customerId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        customerId,
        segmentKey,
        groupingFieldName: segmentKey ? field : null,
        groupingValue,
        breakObjectId: null,
        valueOre: 0,
        objectIds: [],
      };
      groups.set(key, g);
    }
    g.valueOre += valueOre;
    g.objectIds.push(obj.id);
  }

  return Array.from(groups.values());
}
