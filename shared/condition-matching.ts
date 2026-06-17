// ============================================================================
// Standardiserat matchningsfilter (GAP-103, Task #940)
//
// EN återanvändbar matchningsmodell (metadatafält + operator + värde) som driver:
//   - Orderkoncept-wizardens villkorsfilter (steg 4) + förhandsvisning/execute.
//   - Artikellistans filtrering.
//   - Objektlistans filtrering.
//
// `matchesFilter` är enda källan till sanning för operator-semantik så att
// klient-filtrering och server-förhandsvisning ALDRIG kan driva isär. Importeras
// av både frontend och backend (server/services/order-concept-targeting
// re-exporterar härifrån för bakåtkompatibilitet).
// ============================================================================

export interface ConditionFilter {
  /** Metadatanyckel (eller objekt-baskolumn som fallback). */
  metadataKey: string;
  operator: string;
  filterValue: unknown;
}

/** UI-operatorerna som matchningskomponenten exponerar. */
export const CONDITION_OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: "equals", label: "är lika med" },
  { value: "not_equals", label: "är inte lika med" },
  { value: "contains", label: "innehåller" },
  { value: "starts_with", label: "börjar med" },
  { value: "greater_than", label: "större än" },
  { value: "less_than", label: "mindre än" },
  { value: "exists", label: "finns", noValue: true },
  { value: "not_exists", label: "saknas", noValue: true },
];

/** True om operatorn inte behöver ett värde (exists/not_exists). */
export function operatorNeedsNoValue(operator: string): boolean {
  return CONDITION_OPERATORS.find((o) => o.value === operator)?.noValue ?? false;
}

/**
 * Operator-matchning för ETT villkor. Enda källan till sanning — återanvänds av
 * alla inpeknings-/villkors-/listfiltreringsvägar så att förhandsvisning och
 * körning aldrig kan driva isär.
 */
export function matchesFilter(
  metadataValue: unknown,
  operator: string,
  filterValue: unknown,
): boolean {
  switch (operator) {
    case "equals":
      return String(metadataValue ?? "") === String(filterValue ?? "");
    case "not_equals":
      return String(metadataValue ?? "") !== String(filterValue ?? "");
    case "contains":
      return String(metadataValue ?? "")
        .toLowerCase()
        .includes(String(filterValue ?? "").toLowerCase());
    case "starts_with":
      return String(metadataValue ?? "")
        .toLowerCase()
        .startsWith(String(filterValue ?? "").toLowerCase());
    case "greater_than":
      return Number(metadataValue) > Number(filterValue);
    case "less_than":
      return Number(metadataValue) < Number(filterValue);
    case "in_list":
      return Array.isArray(filterValue) && filterValue.map(String).includes(String(metadataValue));
    case "exists":
      return metadataValue !== undefined && metadataValue !== null && metadataValue !== "";
    case "not_exists":
      return metadataValue === undefined || metadataValue === null || metadataValue === "";
    default:
      return true;
  }
}

/**
 * Klient-sidig listfiltrering: behåll de rader som matchar ALLA villkor. `getValue`
 * resolvar radens värde för en given metadatanyckel. Tom/ofullständig filterlista
 * (utan metadataKey) ignoreras så att resultatet matchar förhandsvisningen.
 */
export function applyConditionFilters<T>(
  rows: T[],
  filters: ConditionFilter[],
  getValue: (row: T, metadataKey: string) => unknown,
): T[] {
  const active = filters.filter((f) => f.metadataKey);
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every((f) => matchesFilter(getValue(row, f.metadataKey), f.operator, f.filterValue)),
  );
}
