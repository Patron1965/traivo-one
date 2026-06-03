import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X, Search, ChevronDown, Upload, Loader2, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { versionedUrl } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
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
  parentMetadataId?: string | null;
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
  // Task #681: sammansatt familj — rader som hör till samma familj delar
  // familyParent (förälderns namn). subKey är underfältets katalognamn (JSON-nyckel).
  familyParent?: string | null;
  subKey?: string | null;
}

interface Props {
  customerId?: string | null;
  inheritedFields?: InheritedFieldSeed[];
  onChange: (fields: BuilderFieldValue[]) => void;
}

// Task #681: bild/fil = riktig filuppladdning via presignerad URL. Värdet som
// sparas är objektets lagringssökväg (objectPath) som returneras vid bekräftelse.
function MetadataFileInput({
  value,
  onChange,
  testId,
  accept,
}: {
  value: string;
  onChange: (v: string) => void;
  testId: string;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, error } = useUpload({
    onSuccess: (res) => onChange(res.objectPath),
  });
  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    e.target.value = "";
  };
  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handlePick}
        data-testid={`${testId}-file`}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          data-testid={testId}
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {isUploading ? "Laddar upp..." : value ? "Byt fil" : "Ladda upp fil"}
        </Button>
        {value && !isUploading && (
          <span className="flex items-center gap-1 text-xs text-chart-2 min-w-0" data-testid={`${testId}-status`}>
            <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{value.split("/").pop()}</span>
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive" data-testid={`${testId}-error`}>{error.message}</p>}
    </div>
  );
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
      return <MetadataFileInput value={value} onChange={onChange} testId={testId} accept="image/*" />;
    case "file":
      return <MetadataFileInput value={value} onChange={onChange} testId={testId} />;
    case "location":
      return <Input placeholder="Lat, Long" value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
    default:
      return <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-9" data-testid={testId} />;
  }
}

export function MetadataFieldBuilder({ customerId, inheritedFields, onChange }: Props) {
  const [rows, setRows] = useState<BuilderRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Task #681: signaturen av den senast seedade ärvda uppsättningen. I barn-läge
  // är inheritedFields tom på första render (förälderns metadata laddas async) och
  // fylls därefter — vi måste seeda vid den övergången, inte ge upp på första tom.
  const seededSigRef = useRef<string | null>(null);

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

  // Task #681: familjer (Task #662) — föräldrar (json-gruppfält) och deras
  // underfält. childrenByParent: förälder-id -> underfält. En familj-förälder
  // expanderas i formuläret till en input per underfält och skrivs som ETT
  // strukturerat json-värde på förälderns namn.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, MetadataType[]>();
    for (const t of types) {
      if (t.parentMetadataId) {
        const arr = map.get(t.parentMetadataId);
        if (arr) arr.push(t); else map.set(t.parentMetadataId, [t]);
      }
    }
    return map;
  }, [types]);

  const familyParentIds = useMemo(() => new Set(childrenByParent.keys()), [childrenByParent]);

  // Seed inherited rows when the inherited set becomes available (empty→loaded)
  // and re-seed if the parent's inherited set actually changes. Keyed by a content
  // signature so an async-arriving set still seeds, but the same set never re-seeds
  // (which would wipe user edits).
  useEffect(() => {
    const fields = inheritedFields ?? [];
    if (fields.length === 0) return;
    const sig = fields.map((f) => `${f.namn}=${f.value}`).join("|");
    if (seededSigRef.current === sig) return;
    seededSigRef.current = sig;
    setRows((prev) => {
      const existing = new Set(prev.map((r) => r.namn));
      const seeded: BuilderRow[] = fields
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
  // Family rows are grouped per parent and emitted as a single json value.
  useEffect(() => {
    const out: BuilderFieldValue[] = [];
    const familyAcc = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const overridden = r.origin === "inherited" && r.value !== r.originalValue;
      if (r.origin !== "own" && !overridden) continue;
      if (r.familyParent && r.subKey) {
        const obj = familyAcc.get(r.familyParent) ?? {};
        if (r.value !== "" && r.value != null) obj[r.subKey] = r.value;
        familyAcc.set(r.familyParent, obj);
        continue;
      }
      out.push({ namn: r.namn, varde: r.value, datatyp: r.datatyp });
    }
    for (const [parent, obj] of familyAcc.entries()) {
      if (Object.keys(obj).length === 0) continue;
      out.push({ namn: parent, varde: JSON.stringify(obj), datatyp: "json" });
    }
    onChange(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const addedNames = useMemo(() => new Set(rows.map((r) => r.namn)), [rows]);
  const addedFamilies = useMemo(
    () => new Set(rows.filter((r) => r.familyParent).map((r) => r.familyParent as string)),
    [rows],
  );

  const availableTypes = useMemo(
    () =>
      types.filter((t) => {
        if (t.arBeraknad) return false;
        // underfält adderas endast via sin familj-förälder
        if (t.parentMetadataId) return false;
        if (t.id && familyParentIds.has(t.id)) return !addedFamilies.has(t.namn);
        return !addedNames.has(t.namn);
      }),
    [types, addedNames, addedFamilies, familyParentIds],
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
    const children = t.id ? childrenByParent.get(t.id) : undefined;
    if (children && children.length > 0) {
      // Task #681: familj vald → expandera alla underfält som egna inputs.
      setRows((prev) => [
        ...prev,
        ...children.map((c) => ({
          namn: `${t.namn}.${c.namn}`,
          datatyp: c.datatyp,
          allowedValues: c.allowedValues,
          area: t.area,
          value: "",
          origin: "own" as const,
          familyParent: t.namn,
          subKey: c.namn,
        })),
      ]);
      setPickerOpen(false);
      return;
    }
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

  const removeFamily = (parent: string) => {
    setRows((prev) => prev.filter((r) => r.familyParent !== parent));
  };

  const resetInherited = (namn: string) => {
    setRows((prev) => prev.map((r) => (r.namn === namn ? { ...r, value: r.originalValue ?? "" } : r)));
  };

  // Gruppera rader för rendering: familjer som block, övriga som enskilda rader.
  const standaloneRows = rows.filter((r) => !r.familyParent);
  const familyGroups = useMemo(() => {
    const map = new Map<string, BuilderRow[]>();
    for (const r of rows) {
      if (!r.familyParent) continue;
      const arr = map.get(r.familyParent);
      if (arr) arr.push(r); else map.set(r.familyParent, [r]);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="space-y-3" data-testid="metadata-field-builder">
      {(standaloneRows.length > 0 || familyGroups.length > 0) && (
        <div className="space-y-3">
          {standaloneRows.map((r) => {
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

          {familyGroups.map(([parent, childRows]) => (
            <div key={`family-${parent}`} className="rounded-md border p-3 space-y-3" data-testid={`metadata-builder-family-${parent}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Label className="truncate">{parent}</Label>
                  <Badge variant="secondary" className="text-xs bg-chart-4/15 text-chart-4 border border-chart-4/30 shrink-0">familj</Badge>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => removeFamily(parent)}
                  data-testid={`button-remove-family-${parent}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-2 pl-2 border-l-2 border-chart-4/30">
                {childRows.map((r) => (
                  <div key={r.namn} className="space-y-1" data-testid={`metadata-builder-subfield-${r.namn}`}>
                    <Label className="text-xs text-muted-foreground">{r.subKey}</Label>
                    {renderValueInput(
                      r.datatyp,
                      r.value,
                      (v) => updateValue(r.namn, v),
                      `input-metadata-value-${r.namn}`,
                      r.allowedValues,
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
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
                  {typesInArea.map((t) => {
                    const isFamily = !!(t.id && familyParentIds.has(t.id));
                    return (
                      <CommandItem
                        key={t.id || t.namn}
                        value={`${t.namn} ${t.beteckning || ""} ${metadataAreaLabel(area)}`}
                        onSelect={() => addField(t)}
                        data-testid={`option-metadata-type-${t.namn}`}
                      >
                        <span className="truncate">{t.namn}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{isFamily ? "familj" : t.datatyp}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
