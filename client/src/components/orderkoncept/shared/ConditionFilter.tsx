import { useCallback, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";
// Task #1421: enhetlig metadata-väljare (samma design som objektets "Lägg till
// metadata"-meny). Används här ENDAST för definitions-fallet (fieldKey-värden ur
// /api/metadata-definitions) — det generiska fields-fallet (godtyckliga
// value/label, t.ex. artiklarnas matchningsregel-etiketter) behåller den enkla
// listan eftersom dess värden inte nödvändigtvis motsvarar katalograder.
import {
  MetadataFieldSelect as MetadataCatalogFieldSelect,
  type MetadataPickerType,
} from "@/components/metadata/MetadataFieldPicker";
// Task #940: operator-semantik + typer lever i @shared/condition-matching (delas
// med servern). Re-exporteras här så befintliga importörer är oförändrade.
import {
  CONDITION_OPERATORS,
  matchesFilter,
  applyConditionFilters,
  operatorNeedsNoValue,
  type ConditionFilter,
} from "@shared/condition-matching";

export {
  CONDITION_OPERATORS,
  matchesFilter,
  applyConditionFilters,
  operatorNeedsNoValue,
};
export type { ConditionFilter };

/** Generiskt fält-alternativ för matchningskomponenten. */
export interface ConditionField {
  value: string;
  label: string;
}

export const METADATA_NONE = "__none__";

// Task #1400/#1410: objekturvalets begränsade operatoruppsättning ("är lika
// med"/"skiljer sig från") — delas av objektlistans fördjupade filter och
// Navets objekturval så etiketter/semantik aldrig driver isär.
export const OBJECT_CONDITION_OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: "equals", label: "är lika med" },
  { value: "not_equals", label: "skiljer sig från" },
];

/** Normaliserar metadatadefinitioner → generiska fältalternativ. */
function definitionsToFields(definitions: MetadataDefinition[]): ConditionField[] {
  return definitions.map((d) => ({ value: d.fieldKey, label: d.fieldLabel }));
}

function resolveFields(
  fields?: ConditionField[],
  definitions?: MetadataDefinition[],
): ConditionField[] {
  if (fields) return fields;
  if (definitions) return definitionsToFields(definitions);
  return [];
}

interface MetadataFieldSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  /** Generiska fältalternativ. Föredras framför `definitions`. */
  fields?: ConditionField[];
  /** Bakåtkompatibel: metadatadefinitioner (mappas till `fields`). */
  definitions?: MetadataDefinition[];
  index: number;
  placeholder?: string;
  className?: string;
  allowNone?: boolean;
  testId?: string;
}

export function MetadataFieldSelect({
  value,
  onValueChange,
  fields,
  definitions,
  index,
  placeholder = "Metadatafält",
  className = "w-[200px]",
  allowNone = false,
  testId,
}: MetadataFieldSelectProps) {
  // Task #1421: definitions-fallet (sparar def.fieldKey) migreras till den delade
  // MetadataFieldSelect. /api/metadata-definitions är en compat-vy där def.id ===
  // metadata_katalog.id, så vi hämtar katalogen i väljaren och mappar katalograd →
  // fieldKey via defsById. getValue=null utesluter fält som inte fanns i den
  // ursprungliga listan → exakt samma valbara fält som förut, oförändrad värdeform.
  const useCatalogPicker = !fields && !!definitions;
  const defsById = useMemo(
    () => new Map((definitions ?? []).map((d) => [d.id, d])),
    [definitions],
  );
  const getFieldKeyValue = useCallback(
    (t: MetadataPickerType) => (t.id ? defsById.get(t.id)?.fieldKey ?? null : null),
    [defsById],
  );
  const extraOptionsTop = useMemo(
    () => (allowNone ? [{ value: METADATA_NONE, label: "—" }] : undefined),
    [allowNone],
  );

  if (useCatalogPicker) {
    return (
      <MetadataCatalogFieldSelect
        value={value}
        onValueChange={onValueChange}
        getValue={getFieldKeyValue}
        extraOptionsTop={extraOptionsTop}
        placeholder={placeholder}
        triggerClassName={className}
        triggerTestId={testId ?? `select-filter-key-${index}`}
      />
    );
  }

  // Generiskt fields-fall: godtyckliga value/label (behåller enkel lista).
  const resolved = resolveFields(fields, definitions);
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} data-testid={testId ?? `select-filter-key-${index}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={METADATA_NONE}>—</SelectItem>}
        {resolved.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            {f.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ConditionFilterRowProps {
  filter: ConditionFilter;
  index: number;
  fields?: ConditionField[];
  definitions?: MetadataDefinition[];
  onChange: (patch: Partial<ConditionFilter>) => void;
  onRemove: () => void;
  /** Tillåt fritext för värdet via Input (default). Annars endast operator. */
  fieldPlaceholder?: string;
  /** Begränsa/etikettera operatorerna (default: alla CONDITION_OPERATORS). */
  operators?: { value: string; label: string; noValue?: boolean }[];
}

export function ConditionFilterRow({
  filter,
  index,
  fields,
  definitions,
  onChange,
  onRemove,
  fieldPlaceholder,
  operators = CONDITION_OPERATORS,
}: ConditionFilterRowProps) {
  const op = operators.find((o) => o.value === filter.operator) ?? CONDITION_OPERATORS.find((o) => o.value === filter.operator);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`filter-row-${index}`}>
      <MetadataFieldSelect
        value={filter.metadataKey}
        onValueChange={(v) => onChange({ metadataKey: v })}
        fields={fields}
        definitions={definitions}
        index={index}
        placeholder={fieldPlaceholder}
      />
      <Select value={filter.operator} onValueChange={(v) => onChange({ operator: v })}>
        <SelectTrigger className="w-[150px]" data-testid={`select-filter-operator-${index}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!op?.noValue && (
        <Input
          placeholder="Värde"
          value={String(filter.filterValue ?? "")}
          onChange={(e) => onChange({ filterValue: e.target.value })}
          className="w-[160px]"
          data-testid={`input-filter-value-${index}`}
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="h-9 w-9 p-0 text-destructive hover:text-destructive"
        data-testid={`button-remove-filter-${index}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface ConditionFilterListProps {
  filters: ConditionFilter[];
  fields?: ConditionField[];
  definitions?: MetadataDefinition[];
  onChange: (filters: ConditionFilter[]) => void;
  addLabel?: string;
  emptyText?: string;
  fieldPlaceholder?: string;
  /** testid-prefix för "lägg till"-knappen. */
  addTestId?: string;
  /** Begränsa/etikettera operatorerna (default: alla CONDITION_OPERATORS). */
  operators?: { value: string; label: string; noValue?: boolean }[];
}

/**
 * Återanvändbar villkorslista: rader (metadatafält + operator + värde) med
 * "Lägg till villkor"-knapp, ta-bort per rad och tomt-läge. Används av både
 * artikel- och objektlistans filter (Task #940).
 */
export function ConditionFilterList({
  filters,
  fields,
  definitions,
  onChange,
  addLabel = "Lägg till villkor",
  emptyText = "Inga villkor — alla rader visas.",
  fieldPlaceholder,
  addTestId = "button-add-condition",
  operators,
}: ConditionFilterListProps) {
  const addFilter = () =>
    onChange([...filters, { metadataKey: "", operator: "equals", filterValue: "" }]);
  const updateFilter = (i: number, patch: Partial<ConditionFilter>) =>
    onChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const removeFilter = (i: number) => onChange(filters.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2" data-testid="condition-filter-list">
      {filters.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {filters.map((f, i) => (
            <ConditionFilterRow
              key={i}
              filter={f}
              index={i}
              fields={fields}
              definitions={definitions}
              fieldPlaceholder={fieldPlaceholder}
              operators={operators}
              onChange={(patch) => updateFilter(i, patch)}
              onRemove={() => removeFilter(i)}
            />
          ))}
        </div>
      )}
      <Button variant="outline" size="sm" onClick={addFilter} data-testid={addTestId}>
        <Plus className="h-4 w-4 mr-1" /> {addLabel}
      </Button>
    </div>
  );
}
