import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";
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
