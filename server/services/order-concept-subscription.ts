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
import { computeConceptOrderValue } from "@shared/order-concept-value";
import { resolveConceptMatchingObjects } from "./order-concept-targeting";
import {
  resolveActiveArticle,
  resolveConceptArticleHits,
  isFixedPriceConcept,
} from "./order-concept-article-hits";

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
      costOre: art?.cost ?? 0,
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
