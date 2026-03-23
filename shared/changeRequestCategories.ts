export const GO_CATEGORY_MAP: Record<string, string> = {
  blocked_access: "tillganglighet",
  damaged_container: "skadat_material",
  wrong_waste: "ovrigt",
  overloaded: "antal_karl_andrat",
  other: "ovrigt",
};

export const ONE_CATEGORIES = [
  "antal_karl_andrat",
  "skadat_material",
  "tillganglighet",
  "skador",
  "rengorings_behov",
  "ovrigt",
] as const;

export const GO_CATEGORIES = [
  "blocked_access",
  "damaged_container",
  "wrong_waste",
  "overloaded",
  "other",
] as const;

export const ALL_CATEGORIES = [...ONE_CATEGORIES, ...GO_CATEGORIES] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  antal_karl_andrat: "Antal kärl ändrat",
  skadat_material: "Skadat material",
  tillganglighet: "Tillgänglighetsproblem",
  skador: "Skador på utrymme",
  rengorings_behov: "Rengöringsbehov",
  ovrigt: "Övrigt",
  blocked_access: "Blockerad åtkomst",
  damaged_container: "Skadad behållare",
  wrong_waste: "Fel avfall",
  overloaded: "Överlastad",
  other: "Övrigt (Go)",
};

export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;

export const SEVERITY_LABELS: Record<string, string> = {
  low: "Låg",
  medium: "Medel",
  high: "Hög",
  critical: "Kritisk",
};

export type OneCategory = typeof ONE_CATEGORIES[number];
export type GoCategory = typeof GO_CATEGORIES[number];
export type SeverityLevel = typeof SEVERITY_LEVELS[number];

export function mapGoCategory(goCategory: string): string {
  return GO_CATEGORY_MAP[goCategory] || "ovrigt";
}
