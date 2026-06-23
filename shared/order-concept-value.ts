/**
 * Delad ordervärdes-motor för orderkoncept (Task #1052).
 *
 * EN sanning för "ordervärde" i hela wizarden: sidofältet (live, klient) och
 * Granska-steget (server review-summary) MÅSTE räkna identiskt. Kanonisk enhet är
 * ÖRE — dela bara med 100 vid själva visningen.
 *
 * Ordervärde = (per-objekt-värde) × (antal matchande objekt).
 *   - Löpande pris: per-objekt = Σ(enhetspris_öre × antal) över artiklarna.
 *   - Fast pris:    per-objekt = konceptets fasta pris (öre), oberoende av artiklar.
 * Matchar inga objekt ⇒ totalvärdet är 0 kr.
 */

export interface ConceptValueArticleInput {
  /** Enhetspris i ÖRE (konceptets pris om satt, annars artikelns listpris). */
  unitPriceOre: number;
  /** Antal per matchande objekt. */
  quantity: number;
  /** Självkostnad i ÖRE (valfri). */
  costOre?: number;
  /** Produktionstid i minuter per styck (valfri). */
  productionTimeMinutes?: number;
}

export interface ConceptOrderValue {
  matchedCount: number;
  perObjectValueOre: number;
  totalValueOre: number;
  totalCostOre: number;
  productionMinutes: number;
}

/** Speglar server-sidans isFixedPriceConcept men jobbar på rena öre-tal. */
export function isFixedPriceModel(
  priceModel: string | null | undefined,
  fixedPriceAmountOre: number | null | undefined,
): boolean {
  return (
    priceModel === "fixed" &&
    typeof fixedPriceAmountOre === "number" &&
    Number.isFinite(fixedPriceAmountOre) &&
    fixedPriceAmountOre > 0
  );
}

export function computeConceptOrderValue(opts: {
  matchedCount: number;
  articles: ConceptValueArticleInput[];
  priceModel?: string | null;
  fixedPriceAmountOre?: number | null;
}): ConceptOrderValue {
  const matchedCount = Math.max(0, Math.trunc(opts.matchedCount || 0));
  const articles = opts.articles ?? [];

  const runningPerObjectOre = articles.reduce((sum, a) => {
    const unit = Number.isFinite(a.unitPriceOre) ? a.unitPriceOre : 0;
    const qty = a.quantity || 0;
    return sum + Math.round(unit * qty);
  }, 0);

  const fixed = isFixedPriceModel(opts.priceModel, opts.fixedPriceAmountOre);
  const perObjectValueOre = fixed
    ? (opts.fixedPriceAmountOre as number)
    : runningPerObjectOre;

  const perObjectCostOre = articles.reduce((sum, a) => {
    const cost = Number.isFinite(a.costOre ?? NaN) ? (a.costOre as number) : 0;
    const qty = a.quantity || 0;
    return sum + Math.round(cost * qty);
  }, 0);

  const perObjectProductionMinutes = articles.reduce((sum, a) => {
    const min = Number.isFinite(a.productionTimeMinutes ?? NaN)
      ? (a.productionTimeMinutes as number)
      : 0;
    const qty = a.quantity || 0;
    return sum + min * qty;
  }, 0);

  return {
    matchedCount,
    perObjectValueOre,
    totalValueOre: perObjectValueOre * matchedCount,
    totalCostOre: perObjectCostOre * matchedCount,
    productionMinutes: perObjectProductionMinutes * matchedCount,
  };
}
