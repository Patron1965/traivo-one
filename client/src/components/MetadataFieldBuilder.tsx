import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { versionedUrl } from "@/lib/queryClient";
import { metadataAreaLabel, METADATA_AREA_ORDER } from "@shared/metadata-areas";

export interface BuilderFieldValue {
  namn: string;
  varde: string;
  datatyp: string;
}

export interface InheritedFieldSeed {
  namn: string;
  datatyp: string;
  value: string;
  sourceName?: string | null;
  allowedValues?: string[] | null;
  area?: string | null;
}

interface MetadataType {
  id?: string;
  namn: string;
  beteckning?: string | null;
  datatyp: string;
  area?: string | null;
  allowedValues?: string[] | null;
  arBeraknad?: boolean;
}

interface BuilderRow {
  namn: string;
  datatyp: string;
  allowedValues?: string[] | null;
  area?: string | null;
  value: string;
  origin: "own" | "inherited";
  originalValue?: string;
  sourceName?: string | null;
}

interface Props {
  customerId?: string | null;
  inheritedFields?: InheritedFieldSeed[];
  onChange: (fields: BuilderFieldValue[]) => void;
}

function renderValueInput(
  datatyp: string,
  value: string,
  onChange: (v: string) => void,
  testId: string,
  allowedValues?: string[] | null,
) {
  if (allowedValues && allowedValues.length > 0) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9" data-testid={testId}>
          <SelectValue placeholder="Välj värde..." />
        </SelectTrigger>
        <SelectContent>
          {allowedValues.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  switch (datatyp) {
    case "boolean":
      return (
        <div className="flex items-center gap-2 h-9">
          <Switch checked={value === "true"} onCheckedChange={(c) => onChange(c ? "true" : "false")} data-testid={testId} />
          <span className="text-sm">{value === "true" ? "Ja" : "Nej"}</span>
        </div>
      );
    case "integer":
      return <Input type="number" step="1" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    case "decimal":
      return <Input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    case "email":
      return <Input type="email" placeholder="namn@exempel.se" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    case "datetime":
      return <Input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    case "image":
    case "file":
      return <Input type="url" placeholder="URL till fil/bild..." value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    case "location":
      return <Input placeholder="Lat, Long" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    default:
      return <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
  }
}

export function MetadataFieldBuilder({ customerId, inheritedFields, onChange }: Props) {
  const [rows, setRows] = useState<BuilderRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const seededRef = useRef(false);

  const typesUrl = customerId
    ? `/api/metadata/types?customerId=${encodeURIComponent(customerId)}`
    : "/api/metadata/types";
  const { data: types = [] } = useQuery<MetadataType[]>({
    queryKey: ["/api/metadata/types", "builder", customerId || "all"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(typesUrl), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta metadatatyper");
      return res.json();
    },
    staleTime: 60000,
  });

  // Seed inherited rows once (and re-seed if the inherited set identity changes).
  useEffect(() => {
    if (!inheritedFields || inheritedFields.length === 0) {
      seededRef.current = true;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.namn));
      const seeded: BuilderRow[] = inheritedFields
        .filter((f) => !existing.has(f.namn))
        .map((f) => ({
          namn: f.namn,
          datatyp: f.datatyp,
          allowedValues: f.allowedValues,
          area: f.area,
          value: f.value,
          origin: "inherited" as const,
          originalValue: f.value,
          sourceName: f.sourceName,
        }));
      return [...prev, ...seeded];
    });
  }, [inheritedFields]);

  // Emit the values that should actually be written on the new object:
  // every "own" field plus any inherited field whose value was overridden.
  useEffect(() => {
    const out: BuilderFieldValue[] = rows
      .filter((r) => r.origin === "own" || (r.origin === "inherited" && r.value !== r.originalValue))
      .map((r) => ({ namn: r.namn, varde: r.value, datatyp: r.datatyp }));
    onChange(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const addedNames = useMemo(() => new Set(rows.map((r) => r.namn)), [rows]);

  const availableTypes = useMemo(
    () => types.filter((t) => !t.arBeraknad && !addedNames.has(t.namn)),
    [types, addedNames],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, MetadataType[]>();
    for (const t of availableTypes) {
      const key = t.area || "annat";
      const arr = map.get(key);
      if (arr) arr.push(t); else map.set(key, [t]);
    }
    const order = [...METADATA_AREA_ORDER, "annat"];
    return Array.from(map.entries()).sort(
      (a, b) => (order.indexOf(a[0]) === -1 ? 999 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 999 : order.indexOf(b[0])),
    );
  }, [availableTypes]);

  const addField = (t: MetadataType) => {
    setRows((prev) => [
      ...prev,
      {
        namn: t.namn,
        datatyp: t.datatyp,
        allowedValues: t.allowedValues,
        area: t.area,
        value: "",
        origin: "own",
      },
    ]);
    setPickerOpen(false);
  };

  const updateValue = (namn: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.namn === namn ? { ...r, value } : r)));
  };

  const removeRow = (namn: string) => {
    setRows((prev) => prev.filter((r) => r.namn !== namn));
  };

  const resetInherited = (namn: string) => {
    setRows((prev) => prev.map((r) => (r.namn === namn ? { ...r, value: r.originalValue ?? "" } : r)));
  };

  return (
    <div className="space-y-3" data-testid="metadata-field-builder">
      {rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r) => {
            const overridden = r.origin === "inherited" && r.value !== r.originalValue;
            const isOwn = r.origin === "own" || overridden;
            return (
              <div key={r.namn} className="rounded-md border p-3 space-y-1.5" data-testid={`metadata-builder-row-${r.namn}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Label className="truncate">{r.namn}</Label>
                    {isOwn ? (
                      <Badge variant="secondary" className="text-xs bg-chart-1/15 text-chart-1 border border-chart-1/30 shrink-0">eget</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs bg-chart-2/15 text-chart-2 border border-chart-2/30 shrink-0">
                        ärvd ↓{r.sourceName ? ` (${r.sourceName})` : ""}
                      </Badge>
                    )}
                  </div>
                  {r.origin === "own" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeRow(r.namn)}
                      data-testid={`button-remove-metadata-${r.namn}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : overridden ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => resetInherited(r.namn)}
                      data-testid={`button-reset-metadata-${r.namn}`}
                    >
                      Återställ arv
                    </Button>
                  ) : null}
                </div>
                {renderValueInput(
                  r.datatyp,
                  r.value,
                  (v) => updateValue(r.namn, v),
                  `input-metadata-value-${r.namn}`,
                  r.allowedValues,
                )}
              </div>
            );
          })}
        </div>
      )}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-2" data-testid="button-add-metadata-field">
            <Plus className="h-4 w-4" />
            Lägg till metadatafält
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[320px]" align="start">
          <Command>
            <div className="flex items-center border-b px-3">
              <Search className="h-4 w-4 opacity-50 shrink-0" />
              <CommandInput placeholder="Sök metadatafält..." className="h-9" data-testid="input-search-metadata-types" />
            </div>
            <CommandList>
              <CommandEmpty>Inga fält hittades.</CommandEmpty>
              {grouped.map(([area, typesInArea]) => (
                <CommandGroup key={area} heading={metadataAreaLabel(area)}>
                  {typesInArea.map((t) => (
                    <CommandItem
                      key={t.id || t.namn}
                      value={`${t.namn} ${t.beteckning || ""} ${metadataAreaLabel(area)}`}
                      onSelect={() => addField(t)}
                      data-testid={`option-metadata-type-${t.namn}`}
                    >
                      <span className="truncate">{t.namn}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{t.datatyp}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
