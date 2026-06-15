// Centraliserad kvantitetslogik för artikelns quantityMode (Session 08-15).
// Stödjer både legacy-lägen (use_object_quantity / single_per_task / configurable)
// och spec-lägena per_styck / matches_field / group. All expand-wiring
// (manuella arbetsordrar, orderkoncept-expansion, Fortnox-körning) ska använda
// computeArticleQuantity så att lägena tolkas identiskt överallt.

export type ArticleQuantityInput = {
  quantityMode: string | null | undefined;
  // Bas-kvantiteten som gäller för legacy-lägen (objektets antal / manuellt angivet).
  baseQuantity: number;
  // Fast multipel för 'group'.
  groupSize?: number | null;
  // Upplöst numeriskt metadatavärde för metadata-drivna lägen (null = inget värde hittat).
  metadataValue?: number | null;
};

/**
 * True för de kvantitetslägen som hämtar antalet från objektets metadatafält
 * (artikelns quantityMetadataField). Spec-standardläget 'per_styck'
 * ("Per styck — antal från objektets metadata") och legacy-läget 'matches_field'
 * använder samma upplösning. Callers använder denna för att avgöra om objektets
 * metadatavärde ska slås upp innan computeArticleQuantity anropas.
 */
export function usesQuantityMetadata(mode: string | null | undefined): boolean {
  return mode === "per_styck" || mode === "matches_field";
}

/** Tolkar ett metadatavärde (sträng/nummer) till ett tal, annars null. */
export function metadataValueToNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Räknar ut den effektiva kvantiteten för en artikelrad baserat på quantityMode.
 * - single_per_task → alltid 1
 * - group → fast multipel (groupSize, minst 1)
 * - per_styck / matches_field → objektets metadatavärde (quantityMetadataField) om
 *   det finns och är > 0, annars baseQuantity (objektets/orderradens basantal)
 * - use_object_quantity (legacy) / configurable (legacy) / okänt → baseQuantity
 *
 * 'per_styck' är spec-standardläget ("Per styck — antal från objektets metadata"):
 * när artikeln har ett valt metadatafält och objektet har ett numeriskt värde där
 * styr det antalet, annars faller det tillbaka på baseQuantity. Artiklar utan valt
 * fält (metadataValue == null) beter sig exakt som tidigare (= baseQuantity), vilket
 * bevarar bakåtkompatibilitet för migrerade use_object_quantity/configurable-rader.
 * 'matches_field' behålls som alias för redan sparade rader.
 */
export function computeArticleQuantity(input: ArticleQuantityInput): number {
  const { quantityMode, baseQuantity, groupSize, metadataValue } = input;
  const base =
    Number.isFinite(baseQuantity) && baseQuantity > 0 ? Math.round(baseQuantity) : 1;
  switch (quantityMode) {
    case "single_per_task":
      return 1;
    case "group": {
      const g = Math.round(groupSize ?? 1);
      return g > 0 ? g : 1;
    }
    case "per_styck":
    case "matches_field": {
      if (metadataValue != null && Number.isFinite(metadataValue) && metadataValue > 0) {
        return Math.round(metadataValue);
      }
      return base;
    }
    default:
      return base;
  }
}
