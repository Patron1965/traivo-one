/**
 * Centraliserad prisuppbyggnad för artiklar (GAP-104 / Task #938).
 *
 * Återanvänds av både servern (KPI/marginaluppföljning) och artikelformuläret
 * (live-sammanfattning) så att självkostnad, listpris och marginal beräknas
 * identiskt överallt.
 *
 * VALUTA: alla prisfält är i ÖRE (samma konvention som articles.listPrice m.fl.).
 *
 *   kostnadsbas       = vara → inköpspris, annars (tjänst m.fl.) → standardkostnad
 *   självkostnad      = kostnadsbas + materialkostnad + fraktkostnad + lagerkostnad + internkostnad
 *   beräknat listpris = självkostnad × (1 + påslag%/100)
 *   marginal/enhet    = referenslistpris − självkostnad
 *   marginal%         = marginal/enhet ÷ referenslistpris × 100
 *
 * Kostnadsbasen väljs efter artikeltyp så att samma post aldrig dubbelräknas:
 * en vara använder inköpspris, en tjänst (eller annan icke-vara) standardkostnad.
 * Övriga poster (material, frakt, lager, intern) är alltid additiva tillägg.
 *
 * "referenslistpris" = det faktiskt satta listpriset (om > 0), annars det
 * beräknade listpriset. Så att marginalen speglar det pris som faktiskt
 * debiteras, men ändå visar något vettigt innan ett listpris satts.
 */

export interface ArticleCostInput {
  /** Artikeltyp — styr kostnadsbasen ("vara" → inköpspris, annars standardkostnad). */
  articleType?: string | null;
  /** Inköpspris (öre) — kostnadsbas för varor. */
  purchasePrice?: number | null;
  /** Standardkostnad (öre) — kostnadsbas för tjänster/icke-varor. */
  standardCost?: number | null;
  /** Materialkostnad (öre) — additivt tillägg. */
  materialCost?: number | null;
  /** Fraktkostnad (öre) — additivt tillägg. */
  freightCost?: number | null;
  /** Lagerkostnad (öre) — additivt tillägg. */
  warehouseCost?: number | null;
  /** Påslag i procent (t.ex. 25 = 25 %). */
  markupPercent?: number | null;
  /** Faktiskt satt listpris (öre). */
  listPrice?: number | null;
  /** Internkostnad (öre) — additivt tillägg (tidigare legacy fallback-kostnad). */
  cost?: number | null;
}

export interface ArticlePricing {
  /** Självkostnad = kostnadsbas + material + frakt + lager + intern (öre). */
  selfCostOre: number;
  /** True om minst en kostnadspost (bas eller tillägg) är explicit satt. */
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
 * Kostnadsbas (öre) efter artikeltyp: varor använder inköpspris, övriga
 * (tjänst/kontroll/felanmälan/beroende) standardkostnad. Säkerställer att
 * inköpspris och standardkostnad aldrig dubbelräknas för samma artikel.
 */
export function resolveCostBasisOre(input: ArticleCostInput): number {
  if (input.articleType === "vara") {
    return input.purchasePrice ?? 0;
  }
  return input.standardCost ?? 0;
}

/**
 * Självkostnad = kostnadsbas (inköp för vara / standardkostnad för tjänst) +
 * material + frakt + lager + internkostnad (öre). Returnerar 0 om inget är satt.
 */
export function computeArticleSelfCostOre(input: ArticleCostInput): number {
  return (
    resolveCostBasisOre(input) +
    (input.materialCost ?? 0) +
    (input.freightCost ?? 0) +
    (input.warehouseCost ?? 0) +
    (input.cost ?? 0)
  );
}

/**
 * Kostnadsbas för marginal-/kostnadsuppföljning. Internkostnaden är numera en
 * additiv del av självkostnaden, så detta är ett alias för
 * computeArticleSelfCostOre (gamla artiklar som bara har internkostnad satt får
 * självkostnad = internkostnad och fortsätter därmed fungera oförändrat).
 */
export function resolveArticleCostBasisOre(input: ArticleCostInput): number {
  return computeArticleSelfCostOre(input);
}

/** True om minst en kostnadspost (bas eller tillägg) är explicit satt. */
function hasAnyCostComponent(input: ArticleCostInput): boolean {
  return (
    input.standardCost != null ||
    input.purchasePrice != null ||
    input.materialCost != null ||
    input.freightCost != null ||
    input.warehouseCost != null ||
    input.cost != null
  );
}

/**
 * Hela prisuppbyggnaden i ett anrop. Används av artikelformulärets
 * live-sammanfattning och av servern.
 */
export function computeArticlePricing(input: ArticleCostInput): ArticlePricing {
  const selfCostOre = computeArticleSelfCostOre(input);
  const hasCostComponents = hasAnyCostComponent(input);
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
