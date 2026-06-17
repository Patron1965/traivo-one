// DB-medveten upplösning av artikelns effektiva kvantitet (Antalskälla).
//
// server/article-quantity.ts är ren (inga sidoeffekter): den tar redan upplösta tal
// och tolkar quantityMode. Den här modulen gör DB-uppslagningen som behövs för de
// objekt-drivna lägena och anropar sedan computeArticleQuantity, så att ALLA callers
// (manuella arbetsordrar, orderkoncept-/Fortnox-expansion, metadata-propagering)
// tolkar lägena identiskt:
//   - per_styck / matches_field -> objektets metadatavärde i quantityMetadataField
//   - formula                   -> parseFormula(refs) -> getArticleMetadataForObject
//                                  per ref -> evaluateFormula(quantityFormula)
//
// Alla fel/saknade värden vid utförande faller mjukt tillbaka på baseQuantity (med
// server-logg) så att dispatch/export aldrig bryts av en trasig formel; hård
// validering sker istället när artikeln sparas (server/routes/configRoutes.ts).

import {
  computeArticleQuantity,
  metadataValueToNumber,
  usesQuantityMetadata,
  usesQuantityFormula,
} from "./article-quantity";
import { getArticleMetadataForObject } from "./metadata-queries";
import { parseFormula, evaluateFormula } from "./metadata-formula";

/** Minimal artikelform som behövs för kvantitetsupplösning. */
export type QuantityArticleShape = {
  id?: string | null;
  quantityMode?: string | null;
  quantityMetadataField?: string | null;
  groupSize?: number | null;
  quantityFormula?: string | null;
};

/**
 * Upplöser artikelns formel mot objektets metadatavärden. Returnerar det beräknade
 * talet, eller null när formeln saknas/är ogiltig/refererar ett fält utan numeriskt
 * värde (caller faller då tillbaka på basantal via computeArticleQuantity).
 */
async function resolveFormulaValue(
  formula: string,
  objectId: string,
  tenantId: string,
  articleId?: string | null,
): Promise<number | null> {
  try {
    const { refs } = parseFormula(formula);
    const values: Record<string, number> = {};
    for (const ref of refs) {
      const md = await getArticleMetadataForObject(objectId, ref, tenantId);
      const num = metadataValueToNumber(md?.value);
      if (num == null) {
        console.warn(
          `[article-quantity-resolver] formel "${formula}" (artikel ${articleId ?? "?"}) saknar numeriskt värde för "${ref}" på objekt ${objectId} — faller tillbaka på basantal.`,
        );
        return null;
      }
      values[ref] = num;
    }
    return evaluateFormula(formula, values);
  } catch (e) {
    console.error(
      `[article-quantity-resolver] formel "${formula}" (artikel ${articleId ?? "?"}) kunde inte beräknas:`,
      e,
    );
    return null;
  }
}

/**
 * Detaljerat resultat av kvantitetsupplösningen. Utöver det slutliga `quantity`
 * (samma värde som `resolveEffectiveArticleQuantity` returnerar) exponeras de råa
 * upplösta värdena så att callers kan avgöra ARTIKELTRÄFF: ett metadata-/formel-drivet
 * läge "träffar" bara när ett positivt råvärde faktiskt hittades. computeArticleQuantity
 * faller medvetet tillbaka på basantal (>=1) när värdet saknas, så `quantity` ensamt
 * kan ALDRIG skilja träff från miss — därför detta separata resultat.
 */
export type DetailedArticleQuantity = {
  /** Slutlig effektiv kvantitet (computeArticleQuantity-resultat). */
  quantity: number;
  /** Råt metadatavärde för per_styck/matches_field (null = inget hittat). */
  metadataValue: number | null;
  /** Råt formelresultat för formula (null = saknas/ogiltig). */
  formulaValue: number | null;
  /** True när läget hämtar antalet från objektets metadata/formel (och fält/formel är satt). */
  isMetadataDriven: boolean;
  /**
   * True när läget är metadata-drivet men inget positivt råvärde hittades, dvs.
   * beräkningen föll tillbaka på basantal. För dessa rader är artikeln en MISS.
   */
  usedFallback: boolean;
};

/**
 * Räknar ut den effektiva kvantiteten OCH rapporterar de råa upplösta värdena +
 * träff-/miss-status. All DB-uppslagning (metadata/formel) sker här en gång; både
 * `resolveEffectiveArticleQuantity` och artikelträff-tjänsten bygger på denna så att
 * antal och träff alltid härleds identiskt. Saknat objektId eller ej-objekt-drivet
 * läge -> ingen uppslagning (= legacy-beteende, isMetadataDriven=false ⇒ alltid träff).
 */
export async function resolveEffectiveArticleQuantityDetailed(params: {
  tenantId: string;
  article: QuantityArticleShape | null | undefined;
  baseQuantity: number;
  objectId: string | null | undefined;
}): Promise<DetailedArticleQuantity> {
  const { tenantId, article, baseQuantity, objectId } = params;
  let metadataValue: number | null = null;
  let formulaValue: number | null = null;

  const metadataDriven =
    !!article &&
    ((usesQuantityMetadata(article.quantityMode) && !!article.quantityMetadataField) ||
      (usesQuantityFormula(article.quantityMode) && !!article.quantityFormula));

  if (article && objectId) {
    if (usesQuantityMetadata(article.quantityMode) && article.quantityMetadataField) {
      try {
        const md = await getArticleMetadataForObject(objectId, article.quantityMetadataField, tenantId);
        metadataValue = metadataValueToNumber(md?.value);
      } catch (e) {
        console.error("[article-quantity-resolver] metadata-upplösning misslyckades:", e);
      }
    } else if (usesQuantityFormula(article.quantityMode) && article.quantityFormula) {
      formulaValue = await resolveFormulaValue(article.quantityFormula, objectId, tenantId, article.id);
    }
  }

  const quantity = computeArticleQuantity({
    quantityMode: article?.quantityMode,
    baseQuantity,
    groupSize: article?.groupSize,
    metadataValue,
    formulaValue,
  });

  // Råvärde som styr träff: metadata-läge → metadataValue, formel-läge → formulaValue.
  const rawValue = usesQuantityFormula(article?.quantityMode) ? formulaValue : metadataValue;
  const usedFallback =
    metadataDriven && !(rawValue != null && Number.isFinite(rawValue) && rawValue > 0);

  return { quantity, metadataValue, formulaValue, isMetadataDriven: metadataDriven, usedFallback };
}

/**
 * Räknar ut den effektiva kvantiteten för en artikelrad mot ett objekt. Slår upp
 * metadata-/formelvärden vid behov och delegerar tolkningen till computeArticleQuantity.
 * Saknat objektId eller ej-objekt-drivet läge -> ingen uppslagning (= legacy-beteende).
 *
 * Tunt skal över `resolveEffectiveArticleQuantityDetailed` (oförändrat beteende för
 * alla befintliga callers).
 */
export async function resolveEffectiveArticleQuantity(params: {
  tenantId: string;
  article: QuantityArticleShape | null | undefined;
  baseQuantity: number;
  objectId: string | null | undefined;
}): Promise<number> {
  const detailed = await resolveEffectiveArticleQuantityDetailed(params);
  return detailed.quantity;
}
