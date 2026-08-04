/**
 * Centraliserad artikelkalkyl (GAP-104 / Task #938, ombyggd i Task #1350).
 *
 * Återanvänds av både servern (KPI/marginaluppföljning, prisupplösning) och
 * artikelformuläret (live-sammanfattning) så att självkostnad, listpris och
 * marginal beräknas identiskt överallt.
 *
 * VALUTA: alla prisfält är i ÖRE (samma konvention som articles.listPrice m.fl.).
 *
 * Grundprincip (Tomas instruktionsfil, Task #1350):
 *   1. KOSTNADSKALKYL — kostnadskomponenter summeras till en SJÄLVKOSTNAD.
 *      Listpris/försäljningspris ingår ALDRIG i självkostnaden.
 *   2. PRISKALKYL — försäljningspriset beräknas därefter separat enligt vald
 *      prissättningsmetod (manuell / påslag / marginal).
 *
 * Kostnadsläge (costingMethod):
 *   "calc"     — självkostnad = inköpspris + material + frakt + emballage +
 *                miljöavgift + tidskostnad + lager + intern + övrig, där
 *                tidskostnad = produktionstid/60 × timkostnad (auto).
 *                Standardkostnaden ingår INTE (den är inte längre additiv).
 *   "standard" — explicit fast standardkostnad ersätter kalkylsumman.
 *   null       — LEGACY (bakåtkompatibelt): kostnadsbas efter artikeltyp
 *                (vara → inköpspris, annars standardkostnad) + samma additiva
 *                tillägg som tidigare. Befintliga artiklar behåller därmed sin
 *                effektiva kostnad tills användaren väljer kalkylen.
 *
 * Prissättningsmetod (pricingMethod):
 *   "markup" — listpris = självkostnad × (1 + påslag %/100)
 *   "margin" — listpris = självkostnad ÷ (1 − marginal %/100)   (marginal < 100)
 *   "manual" — användaren sätter listpris; TB/enhet = listpris − självkostnad
 *              och marginal % = TB ÷ listpris × 100 räknas baklänges.
 *   null     — LEGACY: påslag om markupPercent är satt, annars manuell.
 *
 * OBS: påslag och marginal är företagsekonomiskt OLIKA begrepp — 25 % påslag på
 * 100 kr ger 125 kr, medan 25 % önskad marginal ger 133,33 kr.
 */

export type ArticleCostingMethod = "calc" | "standard";
export type ArticlePricingMethod = "manual" | "markup" | "margin";

export interface ArticleCostInput {
  /** Artikeltyp — styr legacy-kostnadsbasen ("vara" → inköpspris, annars standardkostnad). */
  articleType?: string | null;
  /** Kostnadsläge: "calc" | "standard" | null (legacy typ-styrd bas). */
  costingMethod?: string | null;
  /** Inköpspris/grundkostnad (öre). */
  purchasePrice?: number | null;
  /** Standardkostnad (öre) — legacy-bas för icke-varor / explicit fast kostnad ("standard"). */
  standardCost?: number | null;
  /** Materialkostnad (öre). */
  materialCost?: number | null;
  /** Fraktkostnad (öre). */
  freightCost?: number | null;
  /** Emballagekostnad (öre). */
  packagingCost?: number | null;
  /** Miljö-/återvinningsavgift (öre). */
  environmentalFee?: number | null;
  /** Produktionstid (minuter) — driver auto-tidskostnaden. */
  productionTime?: number | null;
  /** Timkostnad (öre/timme) för produktionstiden. */
  hourlyCost?: number | null;
  /** Lagerkostnad (öre). */
  warehouseCost?: number | null;
  /** Internkostnad/hantering (öre) — legacy-kolumnen `cost`. */
  cost?: number | null;
  /** Övrig kostnad (öre). */
  otherCost?: number | null;
  /** Prissättningsmetod: "manual" | "markup" | "margin" | null (legacy). */
  pricingMethod?: string | null;
  /** Påslag i procent (t.ex. 25 = 25 %). */
  markupPercent?: number | null;
  /** Önskad bruttomarginal i procent (t.ex. 25 = 25 %). Måste vara < 100. */
  desiredMarginPercent?: number | null;
  /** Faktiskt satt listpris (öre). */
  listPrice?: number | null;
}

export interface ArticlePricing {
  /** Kostnadsläge som faktiskt tillämpats ("calc" | "standard" | "legacy"). */
  costingMode: "calc" | "standard" | "legacy";
  /** Prissättningsmetod som faktiskt tillämpats. */
  pricingMode: ArticlePricingMethod;
  /** Auto-beräknad tidskostnad = produktionstid/60 × timkostnad (öre). */
  timeCostOre: number;
  /** Självkostnad (öre) enligt kostnadsläget ovan. */
  selfCostOre: number;
  /** True om minst en kostnadspost (bas eller tillägg) är explicit satt. */
  hasCostComponents: boolean;
  /** Beräknat listpris enligt prissättningsmetoden (öre). Vid "manual" = satt listpris. */
  computedListPriceOre: number;
  /** Det listpris marginalen beräknas mot (satt listpris om > 0, annars beräknat). */
  referenceListPriceOre: number;
  /** Täckningsbidrag per enhet = referenslistpris − självkostnad (öre). */
  marginPerUnitOre: number;
  /** Bruttomarginal i procent av referenslistpriset (null om referenslistpris = 0). */
  marginPercent: number | null;
}

/** Tidskostnad (öre) = produktionstid/60 × timkostnad. Auto-beräknad, avrundad till hela öre. */
export function computeTimeCostOre(input: Pick<ArticleCostInput, "productionTime" | "hourlyCost">): number {
  const minutes = input.productionTime ?? 0;
  const hourly = input.hourlyCost ?? 0;
  if (minutes <= 0 || hourly <= 0) return 0;
  return Math.round((minutes / 60) * hourly);
}

/**
 * LEGACY-kostnadsbas (öre) efter artikeltyp: varor använder inköpspris, övriga
 * (tjänst/kontroll/felanmälan/beroende) standardkostnad. Säkerställer att
 * inköpspris och standardkostnad aldrig dubbelräknas för samma artikel.
 */
export function resolveCostBasisOre(input: ArticleCostInput): number {
  if (input.articleType === "vara") {
    return input.purchasePrice ?? 0;
  }
  return input.standardCost ?? 0;
}

function normalizeCostingMethod(input: ArticleCostInput): "calc" | "standard" | "legacy" {
  if (input.costingMethod === "calc") return "calc";
  if (input.costingMethod === "standard") return "standard";
  return "legacy";
}

/** Summan av de additiva kostnadsposterna (allt utom kostnadsbasen), inkl. auto-tidskostnad. */
function additiveCostsOre(input: ArticleCostInput): number {
  return (
    (input.materialCost ?? 0) +
    (input.freightCost ?? 0) +
    (input.packagingCost ?? 0) +
    (input.environmentalFee ?? 0) +
    computeTimeCostOre(input) +
    (input.warehouseCost ?? 0) +
    (input.cost ?? 0) +
    (input.otherCost ?? 0)
  );
}

/**
 * Självkostnad (öre) enligt kostnadsläget:
 *   "standard" → fast standardkostnad (ersätter kalkylen helt)
 *   "calc"     → inköpspris + samtliga additiva poster (standardkostnad ingår EJ)
 *   legacy     → typ-styrd kostnadsbas + additiva poster (bakåtkompatibelt)
 */
export function computeArticleSelfCostOre(input: ArticleCostInput): number {
  const mode = normalizeCostingMethod(input);
  if (mode === "standard") {
    return input.standardCost ?? 0;
  }
  if (mode === "calc") {
    return (input.purchasePrice ?? 0) + additiveCostsOre(input);
  }
  return resolveCostBasisOre(input) + additiveCostsOre(input);
}

/**
 * Kostnadsbas för marginal-/kostnadsuppföljning och prisupplösning — alias för
 * computeArticleSelfCostOre. Gamla artiklar som bara har internkostnad satt får
 * självkostnad = internkostnad och fortsätter därmed fungera oförändrat.
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
    input.packagingCost != null ||
    input.environmentalFee != null ||
    input.hourlyCost != null ||
    input.warehouseCost != null ||
    input.cost != null ||
    input.otherCost != null
  );
}

function normalizePricingMethod(input: ArticleCostInput): ArticlePricingMethod {
  if (input.pricingMethod === "markup" || input.pricingMethod === "margin" || input.pricingMethod === "manual") {
    return input.pricingMethod;
  }
  // Legacy: påslag om markupPercent är satt, annars manuellt listpris.
  return input.markupPercent != null ? "markup" : "manual";
}

/**
 * Hela artikelkalkylen i ett anrop: kostnadskomponenter → självkostnad →
 * listpris enligt vald metod → TB/marginal baklänges vid manuellt pris.
 * Används av artikelformulärets live-sammanfattning och av servern.
 */
export function computeArticlePricing(input: ArticleCostInput): ArticlePricing {
  const costingMode = normalizeCostingMethod(input);
  const pricingMode = normalizePricingMethod(input);
  const timeCostOre = costingMode === "standard" ? 0 : computeTimeCostOre(input);
  const selfCostOre = computeArticleSelfCostOre(input);
  const hasCostComponents = hasAnyCostComponent(input);
  const setListPrice = input.listPrice ?? 0;

  let computedListPriceOre: number;
  if (pricingMode === "markup") {
    const markup = input.markupPercent ?? 0;
    computedListPriceOre = Math.round(selfCostOre * (1 + markup / 100));
  } else if (pricingMode === "margin") {
    const margin = input.desiredMarginPercent ?? 0;
    computedListPriceOre =
      margin > 0 && margin < 100
        ? Math.round(selfCostOre / (1 - margin / 100))
        : selfCostOre; // ogiltig/ej satt marginal → ingen uppräkning
  } else {
    computedListPriceOre = setListPrice;
  }

  // Referenspris för TB/marginal: vid automatisk prissättning (påslag/marginal)
  // ÄR det beräknade priset det som kommer att sparas — ett ev. gammalt sparat
  // listpris får inte styra marginalvisningen. Endast vid manuell prissättning
  // är det satta listpriset referensen.
  const referenceListPriceOre =
    pricingMode === "manual"
      ? (setListPrice > 0 ? setListPrice : computedListPriceOre)
      : computedListPriceOre;
  const marginPerUnitOre = referenceListPriceOre - selfCostOre;
  const marginPercent =
    referenceListPriceOre > 0
      ? (marginPerUnitOre / referenceListPriceOre) * 100
      : null;

  return {
    costingMode,
    pricingMode,
    timeCostOre,
    selfCostOre,
    hasCostComponents,
    computedListPriceOre,
    referenceListPriceOre,
    marginPerUnitOre,
    marginPercent,
  };
}
