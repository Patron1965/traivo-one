// Task #1443: Sökbar metadataområdes-väljare — ersätter plain Select i
// dialogerna som väljer område (skapa fält / fältinställningar). Samma
// Command-mönster som MetadataFieldPicker: fritextsök (case-insensitivt via
// cmdk), tydligt tomt-läge och oförändrat sparvärde (area-value eller NO_AREA).
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import type { MetadataAreaMeta } from "./metadata-carousel-utils";

export const NO_AREA = "__ovrigt__";

export function MetadataAreaCombobox({
  value,
  onValueChange,
  areas,
  disabled,
  triggerTestId = "select-field-area",
}: {
  value: string;
  onValueChange: (value: string) => void;
  areas: MetadataAreaMeta[];
  disabled?: boolean;
  triggerTestId?: string;
}) {
  const [open, setOpen] = useState(false);

  const options = [
    { value: NO_AREA, label: "Övrigt (inget område)" },
    ...areas.map((a) => ({ value: a.value, label: a.label })),
  ];
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid={triggerTestId}
        >
          <span className="truncate">{selected?.label ?? "Välj område..."}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Sök område..." data-testid={`${triggerTestId}-search`} />
          <CommandList>
            <CommandEmpty data-testid={`${triggerTestId}-empty`}>Inget område hittades.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onValueChange(o.value);
                    setOpen(false);
                  }}
                  data-testid={`option-area-${o.value}`}
                >
                  <Check
                    className={`mr-2 h-4 w-4 shrink-0 ${value === o.value ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
