// Task #1421: Enhetlig metadata-väljare — delad komponent utbruten ur
// MetadataAddButton (ObjectMetadataForm.tsx). Ger samma utseende/beteende i
// ALLA menyer där ett metadatafält väljs: kategorirubriker per metadataområde,
// datatyp-bricka per fält, favorit-stjärna (favoriter grupperas överst) och
// platshållaren "Välj typ...".
//
// Viktigt: komponenten ändrar ENBART presentationen. Vilket värde som sparas
// (id, namn/slug eller fieldKey) styrs av konsumenten via `getValue` — byt
// aldrig värdeform vid migrering av en yta.
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel,
} from "@/components/ui/select";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Star, Check } from "lucide-react";
import { metadataTypeRowLabel, metadataDisplayName, METADATA_DATATYPE_LABELS } from "@/lib/metadata-display";
import { useMetadataAreas } from "@/hooks/use-metadata-areas";
import { useMetadataFavorites } from "@/hooks/use-metadata-favorites";

// Minimal katalograds-shape (samma fält som MetadataFormType i
// ObjectMetadataForm.tsx — hålls strukturellt kompatibel, ingen import för att
// undvika cirkulärt beroende).
export interface MetadataPickerType {
  id?: string;
  namn: string;
  visningsnamn?: string | null;
  kategori?: string;
  datatyp?: string | null;
  area?: string | null;
  displayNumber?: number | null;
  sortOrder?: number | null;
  parentMetadataId?: string | null;
  arBeraknad?: boolean | null;
  allowDuplicates?: boolean | null;
  allowedValues?: string[] | null;
  referensTabell?: string | null;
  deletedAt?: string | null;
}

export interface MetadataPickerRow {
  type: MetadataPickerType;
  isChild: boolean;
  /** Konsumentens sparvärde för raden (från getValue). */
  value: string;
}

export interface MetadataPickerGroup {
  area: string;
  label: string;
  sortOrder: number;
  rows: MetadataPickerRow[];
}

export interface UseMetadataFieldGroupsOptions {
  /** Egen fältlista; utelämnas → hämtas från /api/metadata/types (delad cache). */
  types?: MetadataPickerType[];
  /** Filtrera bort ej relevanta fält (datatyp, redan valda osv). */
  include?: (t: MetadataPickerType) => boolean;
  /** Värdeform per fält — default namn (slug). Returnera null för att utesluta. */
  getValue?: (t: MetadataPickerType) => string | null;
  /**
   * Ta med rubrik-/samlingsfält (grupp-föräldrar). Default false — rubriker är
   * normalt bara gruppering. Vissa ytor (t.ex. artiklarnas visa/lämna-metadata)
   * sparar förälderns namn som "alla underfält" och behöver dem valbara.
   */
  includeRubrik?: boolean;
}

const OVRIGT = "__ovrigt__";
export const FAVORITER_AREA = "__favoriter__";

function baseSort(a: MetadataPickerType, b: MetadataPickerType) {
  const an = a.displayNumber ?? 9999;
  const bn = b.displayNumber ?? 9999;
  if (an !== bn) return an - bn;
  const as = a.sortOrder ?? 9999;
  const bs = b.sortOrder ?? 9999;
  if (as !== bs) return as - bs;
  return a.namn.localeCompare(b.namn, "sv");
}

/** Grupperade väljar-rader (favoriter överst, familjer samlade, områdesordning). */
export function useMetadataFieldGroups(opts: UseMetadataFieldGroupsOptions = {}) {
  const { types: providedTypes, include, getValue, includeRubrik } = opts;
  const { order: areaOrder, areaLabel } = useMetadataAreas();
  const { favoriteSet, toggleFavorite } = useMetadataFavorites();

  const { data: fetchedTypes = [], isLoading } = useQuery<MetadataPickerType[]>({
    queryKey: ["/api/metadata/types"],
    enabled: !providedTypes,
  });
  const allTypes = providedTypes ?? fetchedTypes;

  const groups = useMemo<MetadataPickerGroup[]>(() => {
    // Rubrik-/samlingsfält grupperar normalt bara underfält — valbara endast
    // när ytan uttryckligen behöver grupp-föräldrar (includeRubrik).
    const usable = allTypes.filter((t) => {
      if (!includeRubrik && t.datatyp === "rubrik") return false;
      if ((t as { deletedAt?: string | null }).deletedAt) return false;
      return include ? include(t) : true;
    });
    const valueOf = (t: MetadataPickerType) => (getValue ? getValue(t) : t.namn);

    const childrenByParentId = new Map<string, MetadataPickerType[]>();
    for (const t of usable) {
      if (t.parentMetadataId) {
        const list = childrenByParentId.get(t.parentMetadataId) ?? [];
        list.push(t);
        childrenByParentId.set(t.parentMetadataId, list);
      }
    }

    const orderIndex = new Map<string, number>();
    areaOrder.forEach((v, i) => orderIndex.set(v, i));

    const byArea = new Map<string, MetadataPickerType[]>();
    for (const t of usable) {
      const a = (t.area ?? "").trim() || OVRIGT;
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a)!.push(t);
    }

    const toRow = (t: MetadataPickerType, isChild: boolean): MetadataPickerRow | null => {
      const v = valueOf(t);
      return v == null ? null : { type: t, isChild, value: v };
    };

    const result = Array.from(byArea.entries()).map(([area, types]) => {
      const idsInGroup = new Set(types.map((t) => t.id).filter((id): id is string => !!id));
      const roots = types.filter(
        (t) => !(t.parentMetadataId && idsInGroup.has(t.parentMetadataId)),
      );
      roots.sort(baseSort);
      const rows: MetadataPickerRow[] = [];
      for (const r of roots) {
        const row = toRow(r, !!r.parentMetadataId);
        if (row) rows.push(row);
        const kids = (r.id ? childrenByParentId.get(r.id) : undefined) ?? [];
        kids.sort(baseSort);
        for (const k of kids) {
          const kr = toRow(k, true);
          if (kr) rows.push(kr);
        }
      }
      return {
        area,
        label: area === OVRIGT ? "Övrigt" : areaLabel(area),
        sortOrder: area === OVRIGT ? 99999 : orderIndex.get(area) ?? 5000,
        rows,
      };
    }).filter((g) => g.rows.length > 0);

    result.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label, "sv");
    });

    // Favoriter överst i egen grupp (raderna finns kvar i sina områdesgrupper).
    const favRows = usable
      .filter((t) => favoriteSet.has(t.namn))
      .sort(baseSort)
      .map((t) => toRow(t, false))
      .filter((r): r is MetadataPickerRow => !!r);
    if (favRows.length > 0) {
      result.unshift({ area: FAVORITER_AREA, label: "Favoriter", sortOrder: -1, rows: favRows });
    }
    return result;
  }, [allTypes, include, getValue, includeRubrik, areaOrder, areaLabel, favoriteSet]);

  const typeByValue = useMemo(() => {
    const m = new Map<string, MetadataPickerType>();
    for (const g of groups) for (const r of g.rows) if (!m.has(r.value)) m.set(r.value, r.type);
    return m;
  }, [groups]);

  return { groups, typeByValue, favoriteSet, toggleFavorite, isLoading, allTypes };
}

export function datatypeBadgeLabel(datatyp?: string | null): string {
  return (
    (METADATA_DATATYPE_LABELS as Record<string, string>)[datatyp ?? "string"] ?? (datatyp ?? "")
  );
}

/** Rubrik för en grupp (delas av Select- och Command-varianten). */
export function GroupHeading({ group }: { group: MetadataPickerGroup }) {
  return (
    <span className="flex items-center gap-1.5">
      {group.area === FAVORITER_AREA && (
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
      )}
      {group.label}
    </span>
  );
}

export interface MetadataFieldSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Egen fältlista (annars /api/metadata/types). */
  types?: MetadataPickerType[];
  include?: (t: MetadataPickerType) => boolean;
  /** Värdeform — default t.namn. Returnera null för att utesluta ett fält. */
  getValue?: (t: MetadataPickerType) => string | null;
  /** Extra alternativ (tomval, "Grupp: alla fält" …) — renderas FÖRE grupperna. */
  extraOptionsTop?: { value: string; label: ReactNode; testId?: string }[];
  /** Extra alternativ efter grupperna. */
  extraOptionsBottom?: { value: string; label: ReactNode; testId?: string }[];
  placeholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
  triggerTestId?: string;
  optionTestIdPrefix?: string;
  /** Egen etikett i triggern för valt värde (default fältets visningsnamn). */
  renderValueLabel?: (t: MetadataPickerType | undefined, value: string) => ReactNode;
  /** Ta med rubrik-/grupp-föräldrar som valbara rader (se useMetadataFieldGroups). */
  includeRubrik?: boolean;
}

/**
 * Enhetlig metadata-väljare (Select-variant) — samma design som objektets
 * "Lägg till metadata"-meny.
 */
export function MetadataFieldSelect({
  value,
  onValueChange,
  types,
  include,
  getValue,
  extraOptionsTop,
  extraOptionsBottom,
  placeholder = "Välj typ...",
  disabled,
  triggerClassName,
  triggerTestId,
  optionTestIdPrefix = "option-metadata-field",
  renderValueLabel,
  includeRubrik,
}: MetadataFieldSelectProps) {
  const { groups, typeByValue, favoriteSet, toggleFavorite } = useMetadataFieldGroups({
    types,
    include,
    getValue,
    includeRubrik,
  });
  const selectedType = value ? typeByValue.get(value) : undefined;
  const triggerLabel = renderValueLabel
    ? renderValueLabel(selectedType, value)
    : selectedType
      ? metadataDisplayName(selectedType)
      : undefined;

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={triggerClassName} data-testid={triggerTestId}>
        <SelectValue placeholder={placeholder}>{triggerLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {extraOptionsTop?.map((o) => (
          <SelectItem key={o.value} value={o.value} data-testid={o.testId}>
            {o.label}
          </SelectItem>
        ))}
        {groups.map((g) => (
          <SelectGroup key={g.area}>
            <SelectLabel className="bg-muted/70 -mx-1 mb-0.5 rounded-sm pl-2 pr-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <GroupHeading group={g} />
            </SelectLabel>
            {g.rows.map(({ type: t, isChild, value: v }) => {
              const dn = isChild ? metadataDisplayName(t) : metadataTypeRowLabel(t);
              const isFav = favoriteSet.has(t.namn);
              return (
                <SelectItem
                  key={`${g.area}-${t.id || t.namn}`}
                  value={v}
                  className={isChild ? "pl-8 pr-14" : "pr-14"}
                  data-testid={`${optionTestIdPrefix}-${t.namn}`}
                >
                  <span className="flex items-center gap-2 w-full">
                    <span className="flex-1 truncate">{dn}</span>
                    <Badge
                      variant="outline"
                      className="ml-2 shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    >
                      {datatypeBadgeLabel(t.datatyp)}
                    </Badge>
                  </span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isFav ? "Ta bort favorit" : "Markera som favorit"}
                    title={isFav ? "Ta bort favorit" : "Markera som favorit"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-accent"
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onPointerUp={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(t.namn); }}
                    data-testid={`button-favorite-metadata-type-${t.namn}`}
                  >
                    <Star
                      className={
                        isFav
                          ? "h-3.5 w-3.5 fill-amber-400 text-amber-400"
                          : "h-3.5 w-3.5 text-muted-foreground/40"
                      }
                    />
                  </button>
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
        {extraOptionsBottom?.map((o) => (
          <SelectItem key={o.value} value={o.value} data-testid={o.testId}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface MetadataFieldCommandListProps {
  onSelect: (value: string, type: MetadataPickerType) => void;
  selectedValue?: string;
  types?: MetadataPickerType[];
  include?: (t: MetadataPickerType) => boolean;
  getValue?: (t: MetadataPickerType) => string | null;
  searchPlaceholder?: string;
  emptyText?: string;
  optionTestIdPrefix?: string;
}

/**
 * Command-variant (sökbar combobox) med samma gruppering/brickor/stjärna —
 * för ytor som behöver fritextsök (t.ex. formelbyggaren). Rendera inuti en
 * Popover; komponenten är själva listan.
 */
export function MetadataFieldCommandList({
  onSelect,
  selectedValue,
  types,
  include,
  getValue,
  searchPlaceholder = "Sök fält...",
  emptyText = "Inget fält hittades.",
  optionTestIdPrefix = "option-metadata-field",
}: MetadataFieldCommandListProps) {
  const { groups, favoriteSet, toggleFavorite } = useMetadataFieldGroups({
    types,
    include,
    getValue,
  });
  return (
    <Command>
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList>
        <CommandEmpty>{emptyText}</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup
            key={g.area}
            heading={<GroupHeading group={g} />}
          >
            {g.rows.map(({ type: t, isChild, value: v }) => {
              const dn = isChild ? metadataDisplayName(t) : metadataTypeRowLabel(t);
              const isFav = favoriteSet.has(t.namn);
              return (
                <CommandItem
                  key={`${g.area}-${t.id || t.namn}`}
                  // Sökbar text: visningsnamn + namn (slug).
                  value={`${dn} ${t.namn}`}
                  className={isChild ? "pl-8" : undefined}
                  onSelect={() => onSelect(v, t)}
                  data-testid={`${optionTestIdPrefix}-${t.namn}`}
                >
                  <Check
                    className={`mr-2 h-4 w-4 shrink-0 ${selectedValue === v ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="flex-1 truncate">{dn}</span>
                  <Badge
                    variant="outline"
                    className="ml-2 shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                  >
                    {datatypeBadgeLabel(t.datatyp)}
                  </Badge>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isFav ? "Ta bort favorit" : "Markera som favorit"}
                    title={isFav ? "Ta bort favorit" : "Markera som favorit"}
                    className="ml-1 rounded p-1 hover:bg-accent shrink-0"
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(t.namn); }}
                    data-testid={`button-favorite-metadata-type-${t.namn}`}
                  >
                    <Star
                      className={
                        isFav
                          ? "h-3.5 w-3.5 fill-amber-400 text-amber-400"
                          : "h-3.5 w-3.5 text-muted-foreground/40"
                      }
                    />
                  </button>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
