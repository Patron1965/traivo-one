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
  // Upplöst resultat av artikelns quantityFormula (läge 'formula'). null = formel
  // saknas eller kunde inte beräknas (då faller beräkningen tillbaka på baseQuantity).
  formulaValue?: number | null;
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

/**
 * True när artikeln räknas som "aktiv" och får användas i fält-/expansionsflöden.
 * Artikelstatus-livscykeln är svensk (aktiv → utgående → utgått); legacy-data
 * (och DB-default) använder engelska "active". Båda måste accepteras så att
 * artiklar skapade via ArticleFormPage ("aktiv") inte tyst exkluderas från
 * mobil-metadata/antalsredigering. Utgående/utgått räknas INTE som aktiva.
 */
export function isActiveArticleStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "active" || s === "aktiv";
}

/**
 * True för kvantitetsläget 'formula' (Antalskälla "Formel"). Antalet beräknas ur
 * artikelns quantityFormula som refererar objektets metadatafält. Callers använder
 * denna för att avgöra om formeln ska upplösas (parseFormula -> metadatavärden ->
 * evaluateFormula) innan computeArticleQuantity anropas.
 */
export function usesQuantityFormula(mode: string | null | undefined): boolean {
  return mode === "formula";
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
  const { quantityMode, baseQuantity, groupSize, metadataValue, formulaValue } = input;
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
    case "formula": {
      // formulaValue är det redan upplösta formelresultatet (callers gör all DB-
      // uppslagning + evaluateFormula). Positivt resultat styr antalet; annars
      // (formel saknas/fel/<=0) faller vi tillbaka på baseQuantity. Denna funktion
      // hämtar ALDRIG metadata eller utvärderar strängar själv.
      if (formulaValue != null && Number.isFinite(formulaValue) && formulaValue > 0) {
        return Math.round(formulaValue);
      }
      return base;
    }
    default:
      return base;
  }
}
