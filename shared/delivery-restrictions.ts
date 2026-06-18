// Task #978: Delade typer + normalisering för Steg 5 (Leveranstid & tidsrestriktioner).
// Importeras av både klient (wizard-load + UI) och server (planner-visning, review).
// Håller back-compat-logiken på ETT ställe så klient och server aldrig divergerar.

export type RestrictionPolarity = "positive" | "negative"; // positive=lämplig, negative=undvik
export type RestrictionEnforcement = "hard" | "soft"; // hard=blockerar, soft=rekommendation

/**
 * Utökad tidsrestriktion (Task #978): villkor (metadatafält) + tidsregel
 * (veckodag(ar) + start/slut) + polaritet + enforcement + fri text.
 */
export interface DeliveryRestriction {
  metadataKey: string;
  operator: string;
  filterValue?: unknown;
  weekdays: number[]; // 0=Sön … 6=Lör
  timeFrom?: string; // "HH:MM"
  timeTo?: string; // "HH:MM"
  polarity: RestrictionPolarity;
  enforcement: RestrictionEnforcement;
  // Task #997: relativ vikt för MJUKA regler. Styr hur starkt en mjuk
  // tidspreferens väger mot ruttkostnad i optimeraren (högre = starkare
  // preferens). Saknas/ogiltigt ⇒ 1 (normaliseras). Hårda regler bär också
  // fältet men det påverkar inte deras blockerande effekt.
  weight?: number;
  description?: string;
}

/**
 * Ett huvudtidsfönster (Task #978): en datum+tid-period med egen frekvens/flextid.
 * Det första (primära) fönstret speglas till legacy interval-kolumnerna i DB så att
 * expansionsmotorn fungerar oförändrat; övriga fönster är planeringsstöd.
 */
export interface MainDeliveryWindow {
  startDate?: string | null; // "yyyy-mm-dd"
  startTime?: string | null; // "HH:MM"
  endDate?: string | null; // "yyyy-mm-dd"
  endTime?: string | null; // "HH:MM"
  intervalFrequencyDays?: number | null;
  intervalFlexDays?: number | null;
}

/**
 * Normaliserar en rå (möjligen legacy) restriktion till den utökade formen.
 * Legacy-rader har { type:'soft'|'hard', metadataKey, operator, filterValue } —
 * `type` mappas till `enforcement`, `polarity` defaultar till 'negative' (undvik).
 */
export function normalizeDeliveryRestriction(raw: any): DeliveryRestriction {
  const enforcement: RestrictionEnforcement =
    raw?.enforcement === "hard" || raw?.enforcement === "soft"
      ? raw.enforcement
      : raw?.type === "hard"
        ? "hard"
        : "soft";
  const polarity: RestrictionPolarity = raw?.polarity === "positive" ? "positive" : "negative";
  return {
    metadataKey: typeof raw?.metadataKey === "string" ? raw.metadataKey : "",
    operator: typeof raw?.operator === "string" ? raw.operator : "equals",
    filterValue: raw?.filterValue,
    weekdays: Array.isArray(raw?.weekdays)
      ? raw.weekdays.filter((d: unknown): d is number => typeof d === "number")
      : [],
    timeFrom: typeof raw?.timeFrom === "string" && raw.timeFrom ? raw.timeFrom : undefined,
    timeTo: typeof raw?.timeTo === "string" && raw.timeTo ? raw.timeTo : undefined,
    polarity,
    enforcement,
    weight: normalizeRestrictionWeight(raw?.weight),
    description: typeof raw?.description === "string" ? raw.description : "",
  };
}

/**
 * Normaliserar en vikt till ett ändligt positivt tal. Saknas/ogiltigt/≤0 ⇒ 1
 * (neutral vikt). Delas av normaliseringen och frys-paketsbyggaren så att klient
 * och server alltid räknar med samma vikt.
 */
export function normalizeRestrictionWeight(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function normalizeDeliveryRestrictions(raw: unknown): DeliveryRestriction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeDeliveryRestriction);
}

/**
 * Kompakt, display-färdig restriktion för planeringsvyn (Task #978, T004).
 * Beräknas live per objekt (villkoret matchas mot objektets metadata) och
 * skickas till JobCard/expand-panel. Bär ingen villkorslogik — bara det som visas.
 */
export interface DeliveryRestrictionNote {
  description: string;
  polarity: RestrictionPolarity;
  enforcement: RestrictionEnforcement;
  timeRule: string; // formaterad veckodag(ar) + klockslag (kan vara "")
}

/**
 * En restriktion är meningsfull att visa i planeraren om den har en fri
 * beskrivning ELLER en konkret tidsregel (veckodag/klockslag). Annars är den
 * tom brus och döljs.
 */
export function isDisplayableRestriction(
  r: Pick<DeliveryRestriction, "description" | "weekdays" | "timeFrom" | "timeTo">,
): boolean {
  return Boolean(
    (r.description && r.description.trim()) ||
      (Array.isArray(r.weekdays) && r.weekdays.length > 0) ||
      r.timeFrom ||
      r.timeTo,
  );
}

/** Bygger en display-not från en normaliserad restriktion. */
export function toDeliveryRestrictionNote(r: DeliveryRestriction): DeliveryRestrictionNote {
  return {
    description: r.description?.trim() || "",
    polarity: r.polarity,
    enforcement: r.enforcement,
    timeRule: formatRestrictionTimeRule(r),
  };
}

// ============================================================================
// Task #997: Frozen tidsregel-paket (fryses per genererad uppgift vid expansion).
// Hela det viktade tidsregel-paketet (hårda + mjuka regler med polaritet + vikt)
// snapshotas på uppgiften så att schemaläggning/optimering är reproducerbar även
// om konceptets restriktioner senare ändras. Mjuka regler matas in i optimeraren
// som viktad preferens; hårda fortsätter begränsa som idag.
// ============================================================================

/** En enskild fryst tidsregel (villkor + tidsregel + polaritet + vikt). */
export interface FrozenTimeRule {
  metadataKey: string;
  operator: string;
  filterValue?: unknown;
  weekdays: number[]; // 0=Sön … 6=Lör; tom = alla dagar
  timeFrom?: string; // "HH:MM"
  timeTo?: string; // "HH:MM"
  polarity: RestrictionPolarity; // positive=föredra, negative=undvik
  weight: number; // relativ vikt (mjuka regler); normaliserad ≥ 0 (>0)
  description?: string;
}

/**
 * Det kompletta frysta tidsregel-paketet för EN uppgift. Hårda och mjuka regler
 * hålls isär så att optimeraren kan behandla dem olika (hård = begränsning,
 * mjuk = viktad preferens). `version` möjliggör framtida migrering av formatet.
 */
export interface FrozenTimeRulePackage {
  version: 1;
  frozenAt: string; // ISO-tidsstämpel
  hard: FrozenTimeRule[];
  soft: FrozenTimeRule[];
}

function toFrozenTimeRule(r: DeliveryRestriction): FrozenTimeRule {
  return {
    metadataKey: r.metadataKey,
    operator: r.operator,
    filterValue: r.filterValue,
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.slice() : [],
    timeFrom: r.timeFrom,
    timeTo: r.timeTo,
    polarity: r.polarity,
    weight: normalizeRestrictionWeight(r.weight),
    description: r.description?.trim() || undefined,
  };
}

/**
 * Bygger ett fryst tidsregel-paket från en lista (redan normaliserade)
 * restriktioner. Endast meningsfulla regler (isDisplayableRestriction — har en
 * tidsregel eller fri beskrivning) tas med; rena villkors-/brus-rader utan
 * tidseffekt utelämnas. Returnerar `null` när inget finns att frysa, så att
 * anroparen kan lagra NULL och behålla dagens fallback-beteende (schemalagt datum).
 */
export function buildFrozenTimeRulePackage(
  restrictions: DeliveryRestriction[],
  frozenAt: Date = new Date(),
): FrozenTimeRulePackage | null {
  const hard: FrozenTimeRule[] = [];
  const soft: FrozenTimeRule[] = [];
  for (const r of restrictions) {
    if (!isDisplayableRestriction(r)) continue;
    (r.enforcement === "hard" ? hard : soft).push(toFrozenTimeRule(r));
  }
  if (hard.length === 0 && soft.length === 0) return null;
  return { version: 1, frozenAt: frozenAt.toISOString(), hard, soft };
}

const WEEKDAY_LABELS_SHORT = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];

/**
 * Bygger en läsbar svensk sammanfattning av tidsregeln (veckodagar + klockslag),
 * fristående från den fria beskrivningen. Tom sträng om ingen tidsregel finns.
 */
export function formatRestrictionTimeRule(r: Pick<DeliveryRestriction, "weekdays" | "timeFrom" | "timeTo">): string {
  const days = (r.weekdays ?? [])
    .slice()
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // Mån först, Sön sist
    .map((d) => WEEKDAY_LABELS_SHORT[d])
    .filter(Boolean)
    .join(", ");
  const time = r.timeFrom && r.timeTo ? `${r.timeFrom}–${r.timeTo}` : r.timeFrom ? `från ${r.timeFrom}` : r.timeTo ? `till ${r.timeTo}` : "";
  return [days, time].filter(Boolean).join(" ");
}
