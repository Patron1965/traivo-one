import type { MetadataFormEntry } from "@/components/ObjectMetadataForm";

/**
 * Legacy-kolumnadapter (P1 / "allt är metadata").
 *
 * Vissa objektfält (tillgång, nycklar, behållare, utrustning, anteckningar) bor
 * fortfarande i riktiga kolumner på `objects` — routing/VRP/mobil/Fortnox läser dem.
 * Istället för att rendera dem i ett separat hårdkodat kort projiceras de som
 * syntetiska metadata-poster så de visas genom samma enhetliga metadata-rendering,
 * märkta KÄLLA=M + "Under migrering". Data migreras INTE i P1.
 *
 * Guard: posterna bär `legacyColumn` (+ `legacyEditGroup`) så de aldrig kan hamna i
 * metadata_varden spar-/raderingsvägarna — redigering routas till objektets
 * befintliga redigeringsdialog (PATCH /api/objects/:id).
 */
export type LegacyEditGroup = "access" | "equipment" | "overview";

export interface LegacyFieldInput {
  /** Stabil kolumnnyckel, t.ex. "accessCode". */
  column: string;
  /** Svenskt visningsnamn. */
  namn: string;
  /** Förformaterat visningsvärde (sv-SE). Tomt/nullvärde hoppas över. */
  value: string | number | null | undefined;
  /** Vilken redigeringsdialog fältet hör till. */
  editGroup: LegacyEditGroup;
  /** Ärvt från förälder? */
  inherited?: boolean;
  inheritedFromName?: string | null;
}

export function buildLegacyObjectFieldEntries(
  fields: LegacyFieldInput[],
): MetadataFormEntry[] {
  const out: MetadataFormEntry[] = [];
  for (const f of fields) {
    if (f.value == null || f.value === "") continue;
    out.push({
      id: `legacy:${f.column}`,
      katalog: { namn: f.namn, datatyp: "string" },
      vardeString: String(f.value),
      metod: "manuell",
      source: f.inherited ? "inherited" : "direct",
      inheritedFromName: f.inherited ? f.inheritedFromName ?? null : null,
      legacyColumn: f.column,
      legacyEditGroup: f.editGroup,
    });
  }
  return out;
}
