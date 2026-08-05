/**
 * Delad filtermotor (Task #1240).
 *
 * Generisk, fält-agnostisk filtermotor avsedd att återanvändas av uppgiftsnavet,
 * objektnavet, kundportalen, utförarappen och administrationen. Motorn känner
 * inte till någon specifik datamodell — den tar en FilterFieldDef[]-katalog
 * (vad som kan filtreras på + hur man läser värdet ur en rad) och ett
 * FilterGroup (villkorsträd) och evaluerar dem mot valfri record.
 *
 * Roll-styrd fältsynlighet: varje FilterFieldDef kan ange vilka roller som får
 * se/söka på fältet (visibleTo). `visibleFieldsForRole` används av alla ytor
 * (nav, portal, export) så att samma regel gäller överallt.
 */
import { z } from "zod";

export type FilterValue = string | number | boolean | null | (string | number)[];

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const filterConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(FILTER_OPERATORS),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])
    .optional()
    .nullable(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    combinator: z.enum(["and", "or"]),
    conditions: z.array(filterConditionSchema),
    groups: z.array(filterGroupSchema).optional(),
  }),
);
export interface FilterGroup {
  combinator: "and" | "or";
  conditions: FilterCondition[];
  groups?: FilterGroup[];
}

export function emptyFilterGroup(): FilterGroup {
  return { combinator: "and", conditions: [] };
}

export type FilterFieldType = "text" | "number" | "date" | "boolean" | "select" | "multiselect";

/**
 * Fältkatalog-post. `getValue` läser ut jämförbart värde ur en godtycklig rad
 * (kan vara en kolumn, en live-computed metadata-lookup eller ett engine-output-fält).
 * `visibleTo` = roller som får se/söka fältet. Saknas visibleTo => synligt för alla.
 */
export interface FilterFieldDef<TRow = any> {
  key: string;
  label: string;
  type: FilterFieldType;
  getValue: (row: TRow) => FilterValue | Date | undefined;
  options?: { value: string; label: string }[];
  visibleTo?: string[];
  exportable?: boolean;
  searchable?: boolean;
  group?: string;
}

function toComparable(v: FilterValue | Date | undefined): string | number | boolean | null {
  if (v instanceof Date) return v.getTime();
  if (Array.isArray(v)) return v.join(",");
  return v ?? null;
}

// Datumfält: värdet i UI/definition-string ("2026-07-10") måste tolkas som
// epoch-ms innan numerisk jämförelse — annars blir Number("2026-07-10")=NaN
// och alla gt/gte/lt/lte/between-jämförelser mot ett datumfält blir false.
function toNumeric(v: unknown, isDate: boolean): number {
  if (isDate) {
    if (v instanceof Date) return v.getTime();
    const parsed = typeof v === "string" || typeof v === "number" ? Date.parse(String(v)) : NaN;
    return parsed;
  }
  return Number(v);
}

function evaluateCondition<TRow>(row: TRow, cond: FilterCondition, fields: FilterFieldDef<TRow>[]): boolean {
  const def = fields.find((f) => f.key === cond.field);
  if (!def) return true; // okänt fält blockerar aldrig (fail-open för att inte tappa rader vid fält-drift)
  const isDate = def.type === "date";
  const raw = def.getValue(row);
  const value = toComparable(raw);
  const target = cond.value;

  switch (cond.operator) {
    case "is_empty":
      return value === null || value === "" || (Array.isArray(raw) && raw.length === 0);
    case "is_not_empty":
      return !(value === null || value === "" || (Array.isArray(raw) && raw.length === 0));
    case "eq":
      return isDate
        ? toNumeric(value, true) === toNumeric(target, true)
        : value === toComparable(target as FilterValue);
    case "neq":
      return isDate
        ? toNumeric(value, true) !== toNumeric(target, true)
        : value !== toComparable(target as FilterValue);
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "not_contains":
      return !String(value ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "gt":
      return value !== null && toNumeric(value, isDate) > toNumeric(target, isDate);
    case "gte":
      return value !== null && toNumeric(value, isDate) >= toNumeric(target, isDate);
    case "lt":
      return value !== null && toNumeric(value, isDate) < toNumeric(target, isDate);
    case "lte":
      return value !== null && toNumeric(value, isDate) <= toNumeric(target, isDate);
    case "between": {
      if (!Array.isArray(target) || target.length !== 2 || value === null) return false;
      const n = toNumeric(value, isDate);
      return n >= toNumeric(target[0], isDate) && n <= toNumeric(target[1], isDate);
    }
    case "in":
      return Array.isArray(target) ? target.map(String).includes(String(value)) : false;
    case "not_in":
      return Array.isArray(target) ? !target.map(String).includes(String(value)) : true;
    default:
      return true;
  }
}

export function evaluateFilterGroup<TRow>(
  row: TRow,
  group: FilterGroup | null | undefined,
  fields: FilterFieldDef<TRow>[],
): boolean {
  if (!group) return true;
  const conditionResults = group.conditions.map((c) => evaluateCondition(row, c, fields));
  const groupResults = (group.groups ?? []).map((g) => evaluateFilterGroup(row, g, fields));
  const all = [...conditionResults, ...groupResults];
  if (all.length === 0) return true;
  return group.combinator === "and" ? all.every(Boolean) : all.some(Boolean);
}

/**
 * Roll-styrd fältsynlighet — enda källan för "vilka fält får denna roll se/söka/exportera".
 * Används av nav-UI, portal-UI, exportkolumn-väljaren OCH server-side export/sanering.
 */
export function isFieldVisibleForRole(field: Pick<FilterFieldDef, "visibleTo">, role: string | null | undefined): boolean {
  if (!field.visibleTo || field.visibleTo.length === 0) return true;
  if (!role) return false;
  return field.visibleTo.includes(role);
}

export function visibleFieldsForRole<TRow>(
  fields: FilterFieldDef<TRow>[],
  role: string | null | undefined,
): FilterFieldDef<TRow>[] {
  return fields.filter((f) => isFieldVisibleForRole(f, role));
}

// "uppgiftsnav-panel" = Grovplaneringens/Uppgiftsnavets huvudfilterpanel
// (FilterState-payload, inte filtermotorns villkorsträd) — samma CRUD/roll-scoping.
export const savedFilterScopeValues = ["uppgiftsnav", "uppgiftsnav-panel", "objektnav", "portal", "utforarapp", "administration"] as const;
export type SavedFilterScope = (typeof savedFilterScopeValues)[number];

export const savedFilterDefinitionSchema = z.object({
  scope: z.enum(savedFilterScopeValues),
  name: z.string().min(1).max(120),
  group: filterGroupSchema,
  isShared: z.boolean().optional().default(false),
  roles: z.array(z.string()).optional().default([]),
});
export type SavedFilterDefinition = z.infer<typeof savedFilterDefinitionSchema>;
