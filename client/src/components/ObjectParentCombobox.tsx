import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { versionedUrl } from "@/lib/queryClient";

export interface ParentObjectOption {
  id: string;
  name: string;
  objectNumber?: string | null;
  displayName?: string | null;
}

// Serverns /api/objects/parent-search-svar: matchar varje sökord mot objektets
// egna fält ELLER något led i primär-förälderkedjan och returnerar hela
// släktnamnskedjan (rot → löv) så att rätt gren kan verifieras bland tusentals
// liknande objekt.
interface ObjectParentSearchHit {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  city: string | null;
  objectType: string | null;
  hierarchyLevel: string | null;
  path: Array<{ id: string; name: string }>;
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface ObjectParentComboboxProps {
  value: string | null;
  // Visningsnamn (släktnamn) för det valda objektet — visas i triggern.
  valueLabel?: string | null;
  onChange: (id: string | null, option?: ParentObjectOption) => void;
  // Objekt-id som inte får väljas (t.ex. objektet självt i redigera-läge).
  excludeId?: string;
  placeholder?: string;
  emptyOptionLabel?: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
}

const formatPath = (path: Array<{ id: string; name: string }>) =>
  path.map((p) => p.name).join(" › ");

/**
 * Sökbar förälder-väljare. Delar sök-beteende och släktnamns-visning med
 * "Lägg till förälder"-dialogen (ObjectParentsManager) så att objekt-ytorna ser
 * och fungerar likadant. Fritextsökning matchar objektets egna fält OCH hela
 * primär-förälderkedjan (t.ex. "Hemköp Hisingen pantrum") — objekt bär ingen
 * egen kunddata (ADR v3: objekt är neutrala), så något kund-förfilter finns
 * medvetet inte här.
 */
export function ObjectParentCombobox({
  value,
  valueLabel,
  onChange,
  excludeId,
  placeholder = "Välj överordnat objekt...",
  emptyOptionLabel = "Inget (rotobjekt)",
  className,
  testId,
  disabled,
}: ObjectParentComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const trimmed = debounced.trim();

  const { data: results = [], isFetching } = useQuery<ObjectParentSearchHit[]>({
    queryKey: ["/api/objects/parent-search", { q: trimmed, exclude: excludeId ?? "" }],
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmed });
      if (excludeId) params.set("exclude", excludeId);
      const res = await fetch(versionedUrl(`/api/objects/parent-search?${params.toString()}`), {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && trimmed.length >= 2,
    staleTime: 30000,
  });

  const options = useMemo(
    () => (results || []).filter((o) => o.id !== excludeId),
    [results, excludeId],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
      modal={false}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`justify-between font-normal ${className ?? ""}`}
          data-testid={testId}
          disabled={disabled}
        >
          <span className="truncate text-left">
            {value ? valueLabel || value : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Sök på namn, adress eller släktnamn..."
            value={search}
            onValueChange={setSearch}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                  setSearch("");
                }}
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <Check className={`mr-2 h-4 w-4 ${value === null ? "opacity-100" : "opacity-0"}`} />
                <span className="text-muted-foreground">{emptyOptionLabel}</span>
              </CommandItem>
            </CommandGroup>
            {trimmed.length < 2 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Skriv minst 2 tecken för att söka…
              </div>
            ) : isFetching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Söker…
              </div>
            ) : options.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Inga objekt hittades.
              </div>
            ) : (
              <CommandGroup>
                {options.map((hit) => (
                  <CommandItem
                    key={hit.id}
                    value={hit.id}
                    onSelect={() => {
                      onChange(hit.id, {
                        id: hit.id,
                        name: hit.name,
                        objectNumber: hit.objectNumber,
                        displayName: formatPath(hit.path),
                      });
                      setOpen(false);
                      setSearch("");
                    }}
                    data-testid={testId ? `${testId}-option-${hit.id}` : undefined}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <div className="flex w-full items-center gap-2">
                      <Check
                        className={`h-4 w-4 shrink-0 ${value === hit.id ? "opacity-100" : "opacity-0"}`}
                      />
                      <span className="font-medium">{formatPath(hit.path)}</span>
                    </div>
                    {(hit.objectNumber || hit.address || hit.city) && (
                      <span className="pl-6 text-xs text-muted-foreground">
                        {[hit.objectNumber, hit.address, hit.city].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
