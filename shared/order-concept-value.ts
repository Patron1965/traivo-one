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

/**
 * Bas för fast pris (Task #1055): styr hur det fasta beloppet appliceras.
 *  - per_object: beloppet gäller per träffat objekt (default, dagens beteende).
 *  - per_task:   beloppet gäller per genererad uppgift/arbetsorder.
 *  - per_concept: ett fast totalbelopp för hela orderkonceptet (fördelat jämnt).
 */
export type FixedPriceBasis = "per_concept" | "per_task" | "per_object";

export function normalizeFixedPriceBasis(
  basis: string | null | undefined,
): FixedPriceBasis {
  return basis === "per_concept" || basis === "per_task" ? basis : "per_object";
}

export function computeConceptOrderValue(opts: {
  matchedCount: number;
  articles: ConceptValueArticleInput[];
  priceModel?: string | null;
  fixedPriceAmountOre?: number | null;
  /** Task #1055: bas för fast pris. Default per_object (oförändrat beteende). */
  fixedPriceBasis?: string | null;
  /**
   * Task #1055: antal "fast pris-objekt" att multiplicera/fördela över vid fast pris.
   * Default = matchedCount. Granska-vyn skickar in antalet TRÄFF-objekt (hitCount) så
   * att totalen speglar exakt det expansion fakturerar.
   */
  fixedPriceUnitCount?: number | null;
  /**
   * Task #1055: antal genererade uppgifter vid fast pris + per_task. Default =
   * objektantalet (en uppgift per objekt). Granska-vyn skickar in hitCount × antal
   * generationer.
   */
  taskCount?: number | null;
}): ConceptOrderValue {
  const matchedCount = Math.max(0, Math.trunc(opts.matchedCount || 0));
  const articles = opts.articles ?? [];

  const runningPerObjectOre = articles.reduce((sum, a) => {
    const unit = Number.isFinite(a.unitPriceOre) ? a.unitPriceOre : 0;
    const qty = a.quantity || 0;
    return sum + Math.round(unit * qty);
  }, 0);

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

  const totalCostOre = perObjectCostOre * matchedCount;
  const productionMinutes = perObjectProductionMinutes * matchedCount;

  const fixed = isFixedPriceModel(opts.priceModel, opts.fixedPriceAmountOre);
  if (fixed) {
    const amount = opts.fixedPriceAmountOre as number;
    const basis = normalizeFixedPriceBasis(opts.fixedPriceBasis);
    // Antal objekt som faktiskt får ett fast pris (träff-objekt i Granska, annars
    // matchade objekt i sidofältets live-estimat).
    const units = Math.max(
      0,
      Math.trunc(opts.fixedPriceUnitCount ?? matchedCount),
    );
    const tasks = Math.max(0, Math.trunc(opts.taskCount ?? units));

    let totalValueOre: number;
    let perObjectValueOre: number;
    if (units <= 0) {
      totalValueOre = 0;
      perObjectValueOre = 0;
    } else if (basis === "per_concept") {
      totalValueOre = amount;
      perObjectValueOre = Math.round(amount / units);
    } else if (basis === "per_task") {
      totalValueOre = amount * tasks;
      perObjectValueOre = amount;
    } else {
      // per_object
      totalValueOre = amount * units;
      perObjectValueOre = amount;
    }

    return {
      matchedCount,
      perObjectValueOre,
      totalValueOre,
      totalCostOre,
      productionMinutes,
    };
  }

  const perObjectValueOre = runningPerObjectOre;
  return {
    matchedCount,
    perObjectValueOre,
    totalValueOre: perObjectValueOre * matchedCount,
    totalCostOre,
    productionMinutes,
  };
}
