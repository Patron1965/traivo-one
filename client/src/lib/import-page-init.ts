// Sektions-/flik-initlogik för importsidan (Task #1344/#1345).
// Utbruten ur ImportPage.tsx så att djuplänks-mappningen (?tab=, legacy ?mode=,
// sparad sektion i localStorage) kan enhetstestas — en regression här gör att
// sparade bokmärken/genvägar tyst öppnar fel importflöde.
import type { ImportSection } from "@/components/import/ImportHub";

export type ActiveTab =
  | "modus" | "enrich" | "manual" | "fortnox" | "mapped"
  | "customerlist" | "children" | "recipients" | "diff"
  | "wizard" | "objectsv2"
  | "history" | "quality";

// Varje flik hör hemma i exakt en sektion; djuplänkar (?tab=) fortsätter
// fungera genom att sektionen härleds från fliken.
export const TAB_SECTION: Record<ActiveTab, ImportSection> = {
  objectsv2: "objects",
  modus: "system", enrich: "system", fortnox: "system",
  customerlist: "system", children: "system", recipients: "system", diff: "system",
  manual: "advanced", mapped: "advanced", wizard: "advanced",
  history: "history", quality: "history",
};

export const SECTION_DEFAULT_TAB: Record<ImportSection, ActiveTab> = {
  objects: "objectsv2",
  system: "customerlist",
  advanced: "manual",
  history: "history",
};

export const SECTION_STORAGE_KEY = "traivo-import-section-v2";
// Gamla nycklar från före Task #1344 som ska städas bort vid sidladdning.
export const LEGACY_STORAGE_KEYS = ["traivo-import-mode", "traivo-import-section"] as const;

export const isValidTab = (t: string | null): t is ActiveTab => !!t && t in TAB_SECTION;

export const isValidSection = (s: string | null): s is ImportSection =>
  s === "objects" || s === "system" || s === "history" || s === "advanced";

// Härled initial sektion: ?tab= vinner, sedan legacy ?mode=, sedan sparad
// sektion. null = visa startvyn utan vald sektion.
export function resolveInitialSection(
  urlTab: string | null,
  urlMode: string | null,
  savedSection: string | null,
): ImportSection | null {
  if (isValidTab(urlTab)) return TAB_SECTION[urlTab];
  // Legacy-lägen mappas till närmast motsvarande sektion.
  if (urlMode === "migration" || urlMode === "ongoing") return "system";
  if (urlMode === "wizard") return "advanced";
  return isValidSection(savedSection) ? savedSection : null;
}

// Härled initial flik givet redan-härledd sektion.
export function resolveInitialTab(
  urlTab: string | null,
  urlMode: string | null,
  section: ImportSection | null,
): ActiveTab {
  if (isValidTab(urlTab)) return urlTab;
  if (urlMode === "wizard") return "wizard"; // legacy ?mode=wizard öppnade tre-stegs-wizarden
  return SECTION_DEFAULT_TAB[section ?? "objects"];
}
