// Delad artikelträff- och ekonomitjänst för orderkoncept-expansion.
//
// "Artikelträff" = avgör för vilka inpekade objekt den länkade artikeln FAKTISKT
// träffar. För metadata-/formel-drivna antalslägen (per_styck/matches_field +
// quantityMetadataField, eller formula + quantityFormula) träffar artikeln bara när
// objektet har ett positivt råvärde. Objekt utan värde är MISS och ska varken
// räknas, prissättas eller expanderas till en uppgift (tidigare föll de tillbaka på
// basantal 1 → 60 uppgifter i stället för 20).
//
// Allt antals- och träffberäknande sker EN gång här (via
// resolveEffectiveArticleQuantityDetailed) och konsumeras av execute, schema-
// generatorn/run-rolling, preview och resultat-endpointen, så att de aldrig
// divergerar. Ekonomihjälparna (isFixedPriceConcept/computeObjectValueOre) ser till
// att konceptets fasta pris (priceModel='fixed') slår igenom överallt på samma sätt.

import type { ServiceObject } from "@shared/schema";
import { storage } from "../storage";
import { usesQuantityMetadata, usesQuantityFormula } from "../article-quantity";
import { resolveEffectiveArticleQuantityDetailed } from "../article-quantity-resolver";
import { parseFormula } from "../metadata-formula";

type ArticleShape = Awaited<ReturnType<typeof storage.getArticle>>;

/** Minimal konceptform som ekonomi-/träfflogiken behöver. */
export type HitConceptShape = {
  priceModel?: string | null;
  fixedPriceAmount?: number | null;
  crossPollinationField?: string | null;
  articleId?: string | null;
};

/**
 * Följer utgått→ersättning-kedjan (flera hopp, cykelskydd, tenant-spärr) och
 * returnerar den aktiva artikeln. Samma logik som execute använder inline; bryts ut
 * hit så att preview/run-rolling/resultat-endpointen kan återanvända den och aldrig
 * prissätta mot en utgången artikel.
 */
export async function resolveActiveArticle(
  tenantId: string,
  article: ArticleShape | undefined | null,
): Promise<ArticleShape | undefined> {
  if (!article) return undefined;
  // Tenant-spärr på den initiala artikeln (inte bara på ersättningarna): ett koncept
  // får aldrig prissätta/expandera mot en främmande tenants artikel även om
  // concept.articleId av någon anledning pekar utanför tenant. Säkerhetskritiskt —
  // delas av article-hit-summary, preview, run-rolling och execute.
  if (article.tenantId !== tenantId) return undefined;
  let active = article;
  const visited = new Set<string>([active.id]);
  while (
    active.status === "utgått" &&
    active.replacementArticleId &&
    !visited.has(active.replacementArticleId)
  ) {
    const repl = await storage.getArticle(active.replacementArticleId);
    if (!repl || repl.tenantId !== tenantId) break;
    visited.add(repl.id);
    active = repl;
  }
  return active;
}

/** True när konceptet är prissatt med fast pris (öre) i stället för löpande pris×antal. */
export function isFixedPriceConcept(concept: HitConceptShape | null | undefined): boolean {
  return (
    !!concept &&
    concept.priceModel === "fixed" &&
    typeof concept.fixedPriceAmount === "number" &&
    Number.isFinite(concept.fixedPriceAmount) &&
    concept.fixedPriceAmount > 0
  );
}

/**
 * Per-objekt ordervärde i ÖRE. Fast pris ⇒ konceptets fixedPriceAmount (oberoende av
 * antal); annars löpande pris (öre) × antal. Alla prisfält i konceptflödet är i öre.
 */
export function computeObjectValueOre(
  concept: HitConceptShape | null | undefined,
  runningUnitPriceOre: number,
  quantity: number,
): number {
  if (isFixedPriceConcept(concept)) {
    return concept!.fixedPriceAmount as number;
  }
  return Math.round((runningUnitPriceOre || 0) * (quantity || 0));
}

export type ArticleHitRow = {
  objectId: string;
  objectName: string;
  objectNumber: string | null;
  address: string | null;
  isHit: boolean;
  quantity: number;
  metadataValue: number | null;
  formulaValue: number | null;
};

export type ConceptArticleHits = {
  /** Antal inpekade objekt (= matchande objekt efter villkorsfilter). */
  inpekadeCount: number;
  /** Objekt där artikeln träffar. */
  hitCount: number;
  /** Objekt utan träff. */
  missCount: number;
  /** True när antalet hämtas från metadata/formel (annars träffar alla objekt alltid). */
  isMetadataDriven: boolean;
  /**
   * Etikett för det som saknas vid miss: metadatafältets namn (svenska katalogen) för
   * metadata-läge, "antal enligt formel (fält: a, b)" för formel-läge, annars null.
   */
  quantityFieldLabel: string | null;
  /** Delmängd av matchingObjects som träffar (i ursprunglig ordning). */
  hitObjects: ServiceObject[];
  /** Alla inpekade objekt med träff/miss + upplöst antal (för resultatvyn). */
  rows: ArticleHitRow[];
  /** Upplöst antal per objekt-id (hits + misses), så loopar slipper räkna om. */
  quantityByObjectId: Map<string, number>;
};

/** Cross-pollination-bas: objektets metadatavärde × (annars 1) — identiskt med execute. */
function crossPollinationBase(
  concept: HitConceptShape,
  obj: ServiceObject,
): number {
  const objWithMeta = obj as ServiceObject & { metadata?: Record<string, unknown> };
  if (concept.crossPollinationField && objWithMeta.metadata?.[concept.crossPollinationField]) {
    return Number(objWithMeta.metadata[concept.crossPollinationField]) || 1;
  }
  return 1;
}

/** Bygg miss-etikett från artikelns antalsläge. */
function buildQuantityFieldLabel(article: ArticleShape | undefined | null): string | null {
  if (!article) return null;
  if (usesQuantityMetadata(article.quantityMode) && article.quantityMetadataField) {
    return article.quantityMetadataField;
  }
  if (usesQuantityFormula(article.quantityMode) && article.quantityFormula) {
    const refs = parseFormula(article.quantityFormula).refs;
    return refs.length > 0
      ? `antal enligt formel (fält: ${refs.join(", ")})`
      : "antal enligt formel";
  }
  return null;
}

/**
 * Avgör träff/miss + antal för varje inpekat objekt mot konceptets länkade artikel.
 * Inget linkat artikel-id ⇒ alla objekt träffar (legacy-beteende bevaras).
 *
 * `linkedArticle` förväntas vara den AKTIVA artikeln (kör resolveActiveArticle först
 * om utgått→ersättning-swap behövs).
 */
export async function resolveConceptArticleHits(opts: {
  tenantId: string;
  concept: HitConceptShape;
  linkedArticle: ArticleShape | undefined | null;
  matchingObjects: ServiceObject[];
}): Promise<ConceptArticleHits> {
  const { tenantId, concept, linkedArticle, matchingObjects } = opts;

  const isMetadataDriven =
    !!linkedArticle &&
    ((usesQuantityMetadata(linkedArticle.quantityMode) && !!linkedArticle.quantityMetadataField) ||
      (usesQuantityFormula(linkedArticle.quantityMode) && !!linkedArticle.quantityFormula));
  const quantityFieldLabel = isMetadataDriven ? buildQuantityFieldLabel(linkedArticle) : null;

  const rows: ArticleHitRow[] = [];
  const hitObjects: ServiceObject[] = [];
  const quantityByObjectId = new Map<string, number>();

  for (const obj of matchingObjects) {
    const base = crossPollinationBase(concept, obj);
    const detailed = await resolveEffectiveArticleQuantityDetailed({
      tenantId,
      article: linkedArticle ?? null,
      baseQuantity: base,
      objectId: obj.id,
    });
    // Träff = inte metadata-drivet ELLER ett positivt råvärde hittades.
    const isHit = !detailed.usedFallback;
    quantityByObjectId.set(obj.id, detailed.quantity);
    if (isHit) hitObjects.push(obj);
    rows.push({
      objectId: obj.id,
      objectName: obj.name,
      objectNumber: (obj as ServiceObject & { objectNumber?: string | null }).objectNumber ?? null,
      address: obj.address ?? null,
      isHit,
      quantity: detailed.quantity,
      metadataValue: detailed.metadataValue,
      formulaValue: detailed.formulaValue,
    });
  }

  return {
    inpekadeCount: matchingObjects.length,
    hitCount: hitObjects.length,
    missCount: matchingObjects.length - hitObjects.length,
    isMetadataDriven,
    quantityFieldLabel,
    hitObjects,
    rows,
    quantityByObjectId,
  };
}
