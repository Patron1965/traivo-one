// Import 2.0 — ren, testbar kärnlogik för objektimport.
//
// Innehåller INGA DB-anrop. Allt I/O (createObject/updateObject/createMetadata/
// klustring) sker i routen (server/routes/objectImportV2Routes.ts). Här bor:
//   - auto-matchning av kolumner (exakt → punktnotation → metadata → fuzzy)
//   - header-rad-heuristik (upp till 3 header-rader)
//   - per-datatyp-validering + per-rad-validering
//   - topologisk hierarkibyggare + utrustningsgruppering + cirkulärskydd
//
// Referens: traivo_import_specification §4, §6.3, §6.4, §6.2 steg 5.

import {
  ADDRESS_PATTERNS,
  ALL_KNOWN_KEYS,
  CONTACT_PATTERNS,
  ColumnMapping,
  ColumnMappings,
  FIELD_RULES,
  KNOWN_FIELDS,
  normalizeHeader,
  ValidatorType,
} from "@shared/object-import-spec";

// ───────────────────────────────────────────────────────────── auto-matchning

/** Levenshtein-avstånd (iterativt, O(n·m)). */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Normaliserad likhet 0..1 (1 = identisk). */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

export interface FuzzyResult {
  key: string;
  score: number;
}

/** Bästa fuzzy-träff bland kandidatnycklar över tröskel (default 0.8). */
export function fuzzyMatch(
  normalized: string,
  candidates: string[] = ALL_KNOWN_KEYS,
  threshold = 0.8,
): FuzzyResult | null {
  let best: FuzzyResult | null = null;
  for (const cand of candidates) {
    const score = similarity(normalized, cand.toLowerCase());
    if (score >= threshold && (!best || score > best.score)) {
      best = { key: cand, score };
    }
  }
  return best;
}

// §6.3 — människo-läsbara alias (svenska rubriker) → API-nyckel. Fuzzy-matchning
// poängsätter mot DESSA alias, inte mot råa API-nycklar (system_id, name …),
// eftersom tröskel-nära stavfel uppstår i kundens egna rubriker.
const ALIAS_TO_KEY: Record<string, string> = {
  ...KNOWN_FIELDS,
  ...ADDRESS_PATTERNS,
  ...CONTACT_PATTERNS,
};
const ALIAS_KEYS = Object.keys(ALIAS_TO_KEY);

/**
 * §6.3 auto_match: exakt → adress/kontakt-punktnotation → metadata.* → fuzzy.
 * Returnerar API-nyckeln eller null (kräver manuell koppling).
 */
export function autoMatchColumn(header: string | null | undefined): string | null {
  if (header == null) return null;
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  if (normalized in KNOWN_FIELDS) return KNOWN_FIELDS[normalized];
  if (normalized in ADDRESS_PATTERNS) return ADDRESS_PATTERNS[normalized];
  if (normalized in CONTACT_PATTERNS) return CONTACT_PATTERNS[normalized];
  if (normalized.startsWith("metadata.")) return normalized; // behåll som metadata-fält
  // Steg 4: fuzzy mot alias-rubrikerna (mappa träffen tillbaka till API-nyckel),
  // med API-nycklarna som sista fallback.
  const aliasHit = fuzzyMatch(normalized, ALIAS_KEYS);
  if (aliasHit) return ALIAS_TO_KEY[aliasHit.key];
  const keyHit = fuzzyMatch(normalized, ALL_KNOWN_KEYS);
  return keyHit ? keyHit.key : null;
}

/** Härleder kategori från en API-nyckel för column_mappings.type. */
export function categoryForTarget(target: string): ColumnMapping["type"] {
  if (target.startsWith("address.") || target.startsWith("position.")) return "address";
  if (target.startsWith("contact.")) return "contact";
  if (target.startsWith("metadata.")) return "metadata";
  return "standard";
}

export interface DetectedColumn {
  index: number;
  /** Rad 1 — systemfältnamn (kan vara null). */
  header: string | null;
  /** Rad 3 — kundens egen rubrik (kan vara null). */
  userHeader: string | null;
  autoMatch: string | null;
  matched: boolean;
}

/** Bygger auto-matchade kolumner från system- + användarrubriker. */
export function buildColumns(
  systemHeaders: (string | null)[],
  userHeaders: (string | null)[],
): DetectedColumn[] {
  const count = Math.max(systemHeaders.length, userHeaders.length);
  const cols: DetectedColumn[] = [];
  for (let i = 0; i < count; i++) {
    const header = systemHeaders[i] ?? null;
    const userHeader = userHeaders[i] ?? null;
    // Försök matcha på systemrubriken först, annars på användarrubriken.
    const autoMatch = autoMatchColumn(header) ?? autoMatchColumn(userHeader);
    cols.push({
      index: i,
      header,
      userHeader,
      autoMatch,
      matched: autoMatch != null && autoMatch !== "__empty",
    });
  }
  return cols;
}

// ─────────────────────────────────────────────────────── header-rad-heuristik

/** Hur "känd systemheader" en rad är (antal kända fält). */
function knownFieldScore(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    if (autoMatchColumn(cell)) score++;
  }
  return score;
}

/** Genomsnittlig cell-längd (för att hitta beskrivningsrad). */
function avgCellLength(row: string[]): number {
  const nonEmpty = row.filter((c) => (c ?? "").trim() !== "");
  if (nonEmpty.length === 0) return 0;
  return nonEmpty.reduce((s, c) => s + c.trim().length, 0) / nonEmpty.length;
}

export interface HeaderDetection {
  systemHeaderRow: number;
  descriptionRow: number | null;
  userHeaderRow: number | null;
  /** Första dataradens index (0-baserat in i den råa matrisen). */
  dataStartRow: number;
}

/**
 * §6.2 steg 2: identifiera upp till 3 header-rader.
 *  - Rad med flest kända systemfältnamn → systemheader
 *  - Rad med längst snittext → beskrivningsrad
 *  - Återstående kort/unik rad → användarrubriker
 */
export function detectHeaderRows(matrix: string[][]): HeaderDetection {
  const probe = Math.min(matrix.length, 3);
  if (probe === 0) {
    return { systemHeaderRow: 0, descriptionRow: null, userHeaderRow: null, dataStartRow: 0 };
  }
  // 1. Systemheader = raden bland de 3 första med högst known-field-score.
  let systemHeaderRow = 0;
  let bestScore = -1;
  for (let i = 0; i < probe; i++) {
    const s = knownFieldScore(matrix[i]);
    if (s > bestScore) {
      bestScore = s;
      systemHeaderRow = i;
    }
  }
  // Om ingen rad har kända fält → anta att rad 0 är header, resten data.
  if (bestScore <= 0) {
    return { systemHeaderRow: 0, descriptionRow: null, userHeaderRow: null, dataStartRow: 1 };
  }

  // 2. Ytterligare header-rader tas med ENDAST om de verkligen ser ut som
  //    header — inte data. En extra rad räknas som header om den antingen
  //    själv innehåller kända fält-rubriker (knownFieldScore > 0) ELLER är en
  //    lång beskrivningsrad (tooltips). Vi scannar sammanhängande nedåt från
  //    systemheadern och STOPPAR vid första rad som ser ut som data — så att
  //    en fil med bara en header-rad inte tappar sina första datarader.
  // En beskrivningsrad har prosa i (nästan) ALLA celler. En datarad har en MIX:
  // något långt namn/adress men många korta/tomma celler (id, nummer, postnr).
  // Kräv därför att en hög ANDEL celler är långa — inte bara att snittet är
  // högt — annars klassas en datarad med ett enda långt värde felaktigt som
  // header och första dataraden tappas.
  const looksLikeDescriptionRow = (row: string[]): boolean => {
    const nonEmpty = row.filter((c) => (c ?? "").trim() !== "");
    if (nonEmpty.length < 2) return false;
    const longCells = nonEmpty.filter((c) => c.trim().length >= 15).length;
    return longCells / nonEmpty.length >= 0.6;
  };
  const isHeaderLike = (rowIdx: number): boolean => {
    const row = matrix[rowIdx];
    if (knownFieldScore(row) > 0) return true; // egna fält-/kundrubriker
    return looksLikeDescriptionRow(row); // prosa i de flesta celler
  };

  let descriptionRow: number | null = null;
  let userHeaderRow: number | null = null;
  for (let i = systemHeaderRow + 1; i < probe; i++) {
    if (!isHeaderLike(i)) break; // första dataraden → header-blocket slut
    // Längsta raden = beskrivning, övriga = användarrubriker.
    if (descriptionRow == null || avgCellLength(matrix[i]) > avgCellLength(matrix[descriptionRow])) {
      if (descriptionRow != null && userHeaderRow == null) userHeaderRow = descriptionRow;
      descriptionRow = i;
    } else if (userHeaderRow == null) {
      userHeaderRow = i;
    }
  }

  const headerRows = [systemHeaderRow, descriptionRow, userHeaderRow].filter(
    (r): r is number => r != null,
  );
  const dataStartRow = Math.max(...headerRows) + 1;
  return { systemHeaderRow, descriptionRow, userHeaderRow, dataStartRow };
}

// ─────────────────────────────────────────────────────────────── validatorer

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^[\d\s\-+()]+$/;
const TEXT_ID_RE = /^[A-Za-z0-9_-]+$/;

/** §6.4 VALIDATORS. Värdet kommer alltid som trimmad icke-tom sträng. */
export function validateValue(type: ValidatorType, raw: string): boolean {
  const v = raw.trim();
  switch (type) {
    case "text":
      return v.length > 0;
    case "text_id":
      return TEXT_ID_RE.test(v);
    case "integer": {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) && Number.isInteger(n);
    }
    case "decimal": {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n);
    }
    case "gps": {
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) && n >= -180 && n <= 180;
    }
    case "email":
      return EMAIL_RE.test(v);
    case "phone":
      return PHONE_RE.test(v);
    case "date": {
      const t = Date.parse(v);
      return !Number.isNaN(t);
    }
    case "boolean":
      return ["true", "false", "ja", "nej", "1", "0"].includes(v.toLowerCase());
    default:
      return true;
  }
}

export type IssueSeverity = "error" | "warning";

export interface RowIssue {
  field: string;
  message: string;
  severity: IssueSeverity;
}

export type RowStatus = "valid" | "warning" | "invalid";

export interface ValidatedRow {
  rowNumber: number;
  status: RowStatus;
  issues: RowIssue[];
}

/** Plockar ett mappat värde ur en rådatarad (nyckel = kolumnindex som sträng). */
function cellValue(raw: Record<string, string>, columnKey: string): string {
  const val = raw[columnKey];
  return val == null ? "" : String(val);
}

/**
 * §6.4 validate_row för EN rad. Obligatoriska saknade fält och typfel på
 * obligatoriska fält = error (invalid). Typfel på frivilliga fält = warning.
 */
export function validateRow(
  rowNumber: number,
  raw: Record<string, string>,
  mappings: ColumnMappings,
): ValidatedRow {
  const issues: RowIssue[] = [];
  for (const [columnKey, mapping] of Object.entries(mappings)) {
    const field = mapping.target;
    if (!field || field === "__empty") continue;
    const rule = FIELD_RULES[field] ?? { type: "text" as ValidatorType, required: false };
    const required = mapping.required ?? rule.required;
    const value = cellValue(raw, columnKey).trim();
    if (required && value === "") {
      issues.push({ field, message: `Obligatoriskt fält "${field}" saknas`, severity: "error" });
      continue;
    }
    if (value !== "" && !validateValue(rule.type, value)) {
      issues.push({
        field,
        message: `Fält "${field}": ogiltigt värde "${value}" (förväntar ${rule.type})`,
        severity: required ? "error" : "warning",
      });
    }
  }
  const hasError = issues.some((i) => i.severity === "error");
  const hasWarning = issues.some((i) => i.severity === "warning");
  const status: RowStatus = hasError ? "invalid" : hasWarning ? "warning" : "valid";
  return { rowNumber, status, issues };
}

// ────────────────────────────────────────── radupplösning (mappning → fält)

/** Ett mappat värde per API-nyckel + samlade metadata-/composite-fält. */
export interface ResolvedRow {
  rowNumber: number;
  raw: Record<string, string>;
  /** standard-fält: system_id, name, interim_id, … */
  fields: Record<string, string>;
  /** composite: { address: {street,…}, contact: {name,…} } */
  composite: Record<string, Record<string, string>>;
  /** metadata.*-värden: { typ: "Butik", antal: "41" } (utan metadata.-prefix) */
  metadata: Record<string, string>;
}

/** Bygger ResolvedRow utifrån mappningar (ren transformering, ingen validering). */
export function resolveRow(
  rowNumber: number,
  raw: Record<string, string>,
  mappings: ColumnMappings,
): ResolvedRow {
  const fields: Record<string, string> = {};
  const composite: Record<string, Record<string, string>> = {};
  const metadata: Record<string, string> = {};
  for (const [columnKey, mapping] of Object.entries(mappings)) {
    const target = mapping.target;
    if (!target || target === "__empty") continue;
    const value = cellValue(raw, columnKey).trim();
    if (value === "") continue;
    if (target.startsWith("metadata.")) {
      metadata[target.slice("metadata.".length)] = value;
    } else if (target.includes(".")) {
      const [prefix, sub] = target.split(".", 2);
      (composite[prefix] ??= {})[sub] = value;
    } else {
      fields[target] = value;
    }
  }
  return { rowNumber, raw, fields, composite, metadata };
}

// ──────────────────────────────────────────── referens-/cirkulär-validering

export interface CrossRowIssue {
  rowNumber: number;
  field: string;
  message: string;
  severity: IssueSeverity;
}

/**
 * §5.2 affärsregler som kräver hela filen:
 *  - interim_parent_id måste peka på en interim_id i filen (eller vara tom)
 *  - cirkulärreferens i interim-kedjan
 *  - dubblett-externt_id (varning)
 */
export function validateCrossRow(rows: ResolvedRow[]): CrossRowIssue[] {
  const issues: CrossRowIssue[] = [];
  const interimIds = new Set<string>();
  for (const r of rows) {
    if (r.fields.interim_id) interimIds.add(r.fields.interim_id);
  }
  // Förälderkonsistens.
  for (const r of rows) {
    const p = r.fields.interim_parent_id;
    if (p && !interimIds.has(p)) {
      issues.push({
        rowNumber: r.rowNumber,
        field: "interim_parent_id",
        message: `Interimförälder "${p}" finns inte i filen`,
        severity: "error",
      });
    }
  }
  // Cirkulärreferens (interim_id → interim_parent_id).
  const parentOf = new Map<string, string>();
  for (const r of rows) {
    const id = r.fields.interim_id;
    const p = r.fields.interim_parent_id;
    if (id && p && id !== p) parentOf.set(id, p);
    if (id && p && id === p) {
      issues.push({
        rowNumber: r.rowNumber,
        field: "interim_parent_id",
        message: `Objektet "${id}" är sin egen förälder`,
        severity: "error",
      });
    }
  }
  for (const start of Array.from(parentOf.keys())) {
    const seen = new Set<string>([start]);
    let cur = parentOf.get(start);
    while (cur) {
      if (seen.has(cur)) {
        const row = rows.find((r) => r.fields.interim_id === start);
        if (row) {
          issues.push({
            rowNumber: row.rowNumber,
            field: "interim_parent_id",
            message: `Cirkulärreferens i föräldrakedjan (${start} → … → ${cur})`,
            severity: "error",
          });
        }
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  // Dubblett externt_id (varning).
  const extSeen = new Map<string, number>();
  for (const r of rows) {
    const ext = r.fields.external_id;
    if (!ext) continue;
    const prev = extSeen.get(ext);
    if (prev != null) {
      issues.push({
        rowNumber: r.rowNumber,
        field: "external_id",
        message: `externt_id "${ext}" förekommer flera gånger (även rad ${prev})`,
        severity: "warning",
      });
    } else {
      extSeen.set(ext, r.rowNumber);
    }
  }
  return issues;
}

// ──────────────────────────────────────────────────── hierarkibyggar-plan

export type PlanAction = "create" | "update";

export interface PlanItem {
  rowNumber: number;
  row: ResolvedRow;
  action: PlanAction;
  /** primär = noden för sitt interim_id; equipment = barn till primär. */
  kind: "primary" | "equipment";
  /** Interim-id raden tillhör (för equipment = butikens interim). */
  interimId: string | null;
}

export interface HierarchyPlan {
  /** Ordnade operationer: primärer topologiskt först, sedan utrustning. */
  ordered: PlanItem[];
  /** Rader som inte kunde ordnas pga cykel. */
  cycleRowNumbers: number[];
}

/**
 * §6.2 steg 5 build_hierarchy.
 *  - existingByObjectNumber / existingByExternalId: nycklar som redan finns i DB.
 *  - Matchningsprioritet Systemnummer > externt_id > Interimsnummer avgör
 *    create vs update.
 *  - Rader som delar interim_id grupperas: en primär (butik/nod), resten
 *    utrustning (barn). Primär = raden med interim_parent_id satt, annars
 *    första raden i gruppen.
 *  - Primärer topologiskt sorterade (förälder före barn); cykler rapporteras.
 */
export function buildHierarchyPlan(
  rows: ResolvedRow[],
  existingByObjectNumber: Set<string> = new Set(),
  existingByExternalId: Set<string> = new Set(),
  existingByInterim: Set<string> = new Set(),
): HierarchyPlan {
  // 1. Gruppera per interim_id.
  const groups = new Map<string, ResolvedRow[]>();
  const noInterim: ResolvedRow[] = [];
  for (const r of rows) {
    const id = r.fields.interim_id;
    if (id) {
      (groups.get(id) ?? groups.set(id, []).get(id)!).push(r);
    } else {
      noInterim.push(r);
    }
  }

  // 2. Välj primär per grupp; resten = utrustning.
  const primaries = new Map<string, ResolvedRow>(); // interim_id → primär-rad
  const equipment: ResolvedRow[] = [];
  for (const [id, groupRows] of Array.from(groups.entries())) {
    let primary = groupRows.find((r: ResolvedRow) => (r.fields.interim_parent_id ?? "") !== "");
    if (!primary) primary = groupRows[0];
    primaries.set(id, primary);
    for (const r of groupRows) {
      if (r !== primary) equipment.push(r);
    }
  }

  // Matchningsprioritet (§4): Systemnummer > externt_id > Interimsnummer.
  const actionFor = (r: ResolvedRow): PlanAction => {
    if (r.fields.system_id && existingByObjectNumber.has(r.fields.system_id)) return "update";
    if (r.fields.external_id && existingByExternalId.has(r.fields.external_id)) return "update";
    if (r.fields.interim_id && existingByInterim.has(r.fields.interim_id)) return "update";
    return "create";
  };

  // 3. Topologisk sortering av primärer (Kahn) på interim-kanter.
  const ids = Array.from(primaries.keys());
  const idSet = new Set(ids);
  const indeg = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const id of ids) indeg.set(id, 0);
  for (const id of ids) {
    const parent = primaries.get(id)!.fields.interim_parent_id;
    if (parent && idSet.has(parent) && parent !== id) {
      indeg.set(id, (indeg.get(id) ?? 0) + 1);
      (children.get(parent) ?? children.set(parent, []).get(parent)!).push(id);
    }
  }
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const sortedIds: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    sortedIds.push(id);
    for (const child of children.get(id) ?? []) {
      indeg.set(child, (indeg.get(child) ?? 0) - 1);
      if ((indeg.get(child) ?? 0) === 0) queue.push(child);
    }
  }
  const cycleRowNumbers: number[] = [];
  if (sortedIds.length < ids.length) {
    for (const id of ids) {
      if (!sortedIds.includes(id)) cycleRowNumbers.push(primaries.get(id)!.rowNumber);
    }
  }

  // 4. Bygg ordnad lista: rader utan interim (rena uppdateringar/skapelser)
  //    först om de är root, sedan primärer topologiskt, sedan utrustning.
  const ordered: PlanItem[] = [];
  for (const r of noInterim) {
    ordered.push({ rowNumber: r.rowNumber, row: r, action: actionFor(r), kind: "primary", interimId: null });
  }
  for (const id of sortedIds) {
    const r = primaries.get(id)!;
    ordered.push({ rowNumber: r.rowNumber, row: r, action: actionFor(r), kind: "primary", interimId: id });
  }
  for (const r of equipment) {
    ordered.push({
      rowNumber: r.rowNumber,
      row: r,
      action: actionFor(r),
      kind: "equipment",
      interimId: r.fields.interim_id ?? null,
    });
  }
  return { ordered, cycleRowNumbers };
}

/** Bygger ett sammansatt objekt {street,…} och hoppar över tomma underfält. */
export function buildCompositeObject(sub: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sub)) {
    if ((v ?? "").trim() !== "") out[k] = v.trim();
  }
  return out;
}
