import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { MetadataDefinition } from "@shared/schema";

export interface ConditionFilter {
  metadataKey: string;
  operator: string;
  filterValue: unknown;
}

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

interface MetadataFieldSelectProps {
  value: string;
  onValueChange: (v: string) => void;
  definitions: MetadataDefinition[];
  index: number;
  placeholder?: string;
  className?: string;
  allowNone?: boolean;
  testId?: string;
}

export const METADATA_NONE = "__none__";

export function MetadataFieldSelect({
  value,
  onValueChange,
  definitions,
  index,
  placeholder = "Metadatafält",
  className = "w-[200px]",
  allowNone = false,
  testId,
}: MetadataFieldSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} data-testid={testId ?? `select-filter-key-${index}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={METADATA_NONE}>—</SelectItem>}
        {definitions.map((d) => (
          <SelectItem key={d.id} value={d.fieldKey}>
            {d.fieldLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface ConditionFilterRowProps {
  filter: ConditionFilter;
  index: number;
  definitions: MetadataDefinition[];
  onChange: (patch: Partial<ConditionFilter>) => void;
  onRemove: () => void;
}

export function ConditionFilterRow({
  filter,
  index,
  definitions,
  onChange,
  onRemove,
}: ConditionFilterRowProps) {
  const op = CONDITION_OPERATORS.find((o) => o.value === filter.operator);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`filter-row-${index}`}>
      <MetadataFieldSelect
        value={filter.metadataKey}
        onValueChange={(v) => onChange({ metadataKey: v })}
        definitions={definitions}
        index={index}
      />
      <Select value={filter.operator} onValueChange={(v) => onChange({ operator: v })}>
        <SelectTrigger className="w-[150px]" data-testid={`select-filter-operator-${index}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPERATORS.map((o) => (
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
