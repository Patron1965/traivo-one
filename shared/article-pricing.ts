/**
 * Centraliserad prisuppbyggnad för artiklar (GAP-104 / Task #938).
 *
 * Återanvänds av både servern (KPI/marginaluppföljning) och artikelformuläret
 * (live-sammanfattning) så att självkostnad, listpris och marginal beräknas
 * identiskt överallt.
 *
 * VALUTA: alla prisfält är i ÖRE (samma konvention som articles.listPrice m.fl.).
 *
 *   självkostnad   = inköpspris + fraktkostnad + lagerkostnad
 *   beräknat listpris = självkostnad × (1 + påslag%/100)
 *   marginal/enhet = referenslistpris − självkostnad
 *   marginal%      = marginal/enhet ÷ referenslistpris × 100
 *
 * "referenslistpris" = det faktiskt satta listpriset (om > 0), annars det
 * beräknade listpriset. Så att marginalen speglar det pris som faktiskt
 * debiteras, men ändå visar något vettigt innan ett listpris satts.
 */

export interface ArticleCostInput {
  /** Inköpspris (öre). */
  purchasePrice?: number | null;
  /** Fraktkostnad (öre). */
  freightCost?: number | null;
  /** Lagerkostnad (öre). */
  warehouseCost?: number | null;
  /** Påslag i procent (t.ex. 25 = 25 %). */
  markupPercent?: number | null;
  /** Faktiskt satt listpris (öre). */
  listPrice?: number | null;
  /** Legacy internkostnad (öre) — används som fallback när inga kostnadskomponenter är satta. */
  cost?: number | null;
}

export interface ArticlePricing {
  /** Självkostnad = inköp + frakt + lager (öre). */
  selfCostOre: number;
  /** True om minst en av inköp/frakt/lager är explicit satt. */
  hasCostComponents: boolean;
  /** Beräknat listpris = självkostnad × (1 + påslag) (öre). */
  computedListPriceOre: number;
  /** Det listpris marginalen beräknas mot (satt listpris om > 0, annars beräknat). */
  referenceListPriceOre: number;
  /** Marginal per enhet = referenslistpris − självkostnad (öre). */
  marginPerUnitOre: number;
  /** Marginal i procent av referenslistpriset (null om referenslistpris = 0). */
  marginPercent: number | null;
}

/**
 * Självkostnad = inköp + frakt + lager (öre). Returnerar 0 om inget är satt.
 */
export function computeArticleSelfCostOre(input: ArticleCostInput): number {
  return (
    (input.purchasePrice ?? 0) +
    (input.freightCost ?? 0) +
    (input.warehouseCost ?? 0)
  );
}

/**
 * Kostnadsbas för marginal-/kostnadsuppföljning: nya självkostnaden (inköp +
 * frakt + lager) när minst en komponent är satt, annars fallback till legacy
 * internkostnad (`cost`). Säkerställer att gamla artiklar utan de nya fälten
 * fortsätter att fungera oförändrat.
 */
export function resolveArticleCostBasisOre(input: ArticleCostInput): number {
  if (
    input.purchasePrice != null ||
    input.freightCost != null ||
    input.warehouseCost != null
  ) {
    return computeArticleSelfCostOre(input);
  }
  return input.cost ?? 0;
}

/**
 * Hela prisuppbyggnaden i ett anrop. Används av artikelformulärets
 * live-sammanfattning och av servern.
 */
export function computeArticlePricing(input: ArticleCostInput): ArticlePricing {
  const selfCostOre = computeArticleSelfCostOre(input);
  const hasCostComponents =
    input.purchasePrice != null ||
    input.freightCost != null ||
    input.warehouseCost != null;
  const markup = input.markupPercent ?? 0;
  const computedListPriceOre = Math.round(selfCostOre * (1 + markup / 100));
  const setListPrice = input.listPrice ?? 0;
  const referenceListPriceOre = setListPrice > 0 ? setListPrice : computedListPriceOre;
  const marginPerUnitOre = referenceListPriceOre - selfCostOre;
  const marginPercent =
    referenceListPriceOre > 0
      ? (marginPerUnitOre / referenceListPriceOre) * 100
      : null;
  return {
    selfCostOre,
    hasCostComponents,
    computedListPriceOre,
    referenceListPriceOre,
    marginPerUnitOre,
    marginPercent,
  };
}
