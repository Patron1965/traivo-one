// ============================================================================
// METADATA-URSPRUNG → KÄLLA/ARV-BADGE (Task #1438)
// ----------------------------------------------------------------------------
// ENDA källan för hur `metod` på en metadata_varden-rad mappas till badge-
// etiketterna i objektvyn. Kanoniska etiketter:
//   • "Systemgenererad" — satt av systemet/motorerna (system/tjanst/utforande)
//     ELLER automatiskt härledd (auto/automatisk/berakning, t.ex. geokodade
//     koordinater från adressen).
//   • "Ärvd"            — värdet kommer från en förälder (source=inherited).
//   • "Importerad"      — värdet skrevs av en import (metod='import').
//   • "Egen"            — användarskapat värde direkt på objektet.
// Precedens: read-only-systemursprung vinner alltid; därefter arv (ärvda
// importerade/auto-värden visas som Ärvd, med ursprunget i tooltip); därefter
// import; därefter auto; annars Egen.
// ============================================================================

export type MetadataOriginBadge = "systemgenererad" | "arvd" | "importerad" | "egen";

/** Read-only-systemursprung (får aldrig ändras manuellt). */
export const READONLY_ORIGIN_METHODS_SET = new Set(["system", "tjanst", "utforande"]);
/** Automatiskt härledda ursprung (t.ex. geokodning, beräkning). */
export const AUTO_DERIVED_ORIGIN_METHODS = new Set(["auto", "automatisk", "berakning"]);

export function deriveMetadataOriginBadge(
  metod: string | null | undefined,
  isInherited: boolean,
): MetadataOriginBadge {
  if (metod != null && READONLY_ORIGIN_METHODS_SET.has(metod)) return "systemgenererad";
  if (isInherited) return "arvd";
  if (metod === "import") return "importerad";
  if (metod != null && AUTO_DERIVED_ORIGIN_METHODS.has(metod)) return "systemgenererad";
  return "egen";
}

export const METADATA_ORIGIN_BADGE_LABELS: Record<MetadataOriginBadge, string> = {
  systemgenererad: "Systemgenererad",
  arvd: "Ärvd",
  importerad: "Importerad",
  egen: "Egen",
};
