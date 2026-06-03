import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Fält kopplat till orderns ordertyp (familjer expanderade till underfält).
// Delas mellan create-formuläret (JobModal) och edit-vyn (JobDetailModal) så att
// renderingen av ett enskilt fält garanterat hålls identisk.
export interface OrderTypeMetadataField {
  id: string;
  namn: string;
  beskrivning: string | null;
  datatyp: string;
  kategori: string | null;
  dotKey: string | null;
  linkSortOrder: number;
}

interface CoupledFieldInputProps {
  field: OrderTypeMetadataField;
  value: string;
  onChange: (value: string) => void;
  /** Extra klass på själva kontrollen (t.ex. `flex-1` när en action ligger bredvid). */
  controlClassName?: string;
  /** Valfri action bredvid kontrollen (t.ex. Spara-knapp i edit-vyn). */
  action?: ReactNode;
}

export function CoupledFieldInput({
  field,
  value,
  onChange,
  controlClassName,
  action,
}: CoupledFieldInputProps) {
  const label = field.dotKey ?? field.namn;

  const control =
    field.datatyp === "boolean" ? (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={controlClassName} data-testid={`input-coupled-field-${field.id}`}>
          <SelectValue placeholder="Välj värde..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Ja</SelectItem>
          <SelectItem value="false">Nej</SelectItem>
        </SelectContent>
      </Select>
    ) : (
      <Input
        className={controlClassName}
        type={
          field.datatyp === "integer" || field.datatyp === "decimal"
            ? "number"
            : field.datatyp === "datetime"
              ? "date"
              : "text"
        }
        step={field.datatyp === "decimal" ? "0.01" : undefined}
        placeholder={
          field.datatyp === "integer"
            ? "Ange heltal..."
            : field.datatyp === "decimal"
              ? "Ange decimaltal..."
              : "Ange värde..."
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`input-coupled-field-${field.id}`}
      />
    );

  return (
    <div className="space-y-1" data-testid={`coupled-field-${field.id}`}>
      <label className="text-sm font-medium flex items-center gap-2">
        {label}
        {field.beskrivning && (
          <span className="text-xs text-muted-foreground font-normal">- {field.beskrivning}</span>
        )}
      </label>
      {action ? (
        <div className="flex gap-2">
          {control}
          {action}
        </div>
      ) : (
        control
      )}
    </div>
  );
}
