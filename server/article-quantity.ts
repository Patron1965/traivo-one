// Centraliserad kvantitetslogik för artikelns quantityMode (Session 08-15).
// Stödjer både legacy-lägen (use_object_quantity / single_per_task / configurable)
// och de nya spec-lägena per_styck / matches_field / group. All expand-wiring
// (manuella arbetsordrar, orderkoncept-expansion, Fortnox-körning) ska använda
// computeArticleQuantity så att lägena tolkas identiskt överallt.

export type ArticleQuantityInput = {
  quantityMode: string | null | undefined;
  // Bas-kvantiteten som gäller för legacy-lägen (objektets antal / manuellt angivet).
  baseQuantity: number;
  // Fast multipel för 'group'.
  groupSize?: number | null;
  // Upplöst numeriskt metadatavärde för 'matches_field' (null = inget värde hittat).
  metadataValue?: number | null;
};

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
 * - per_styck / single_per_task → alltid 1
 * - group → fast multipel (groupSize, minst 1)
 * - matches_field → objektets metadatavärde (faller tillbaka på baseQuantity om värde saknas)
 * - use_object_quantity / configurable / okänt → baseQuantity (legacy-beteende)
 */
export function computeArticleQuantity(input: ArticleQuantityInput): number {
  const { quantityMode, baseQuantity, groupSize, metadataValue } = input;
  const base =
    Number.isFinite(baseQuantity) && baseQuantity > 0 ? Math.round(baseQuantity) : 1;
  switch (quantityMode) {
    case "per_styck":
    case "single_per_task":
      return 1;
    case "group": {
      const g = Math.round(groupSize ?? 1);
      return g > 0 ? g : 1;
    }
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
