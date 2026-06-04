import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { versionedUrl } from "@/lib/queryClient";

export interface ParentObjectOption {
  id: string;
  name: string;
  objectNumber?: string | null;
  displayName?: string | null;
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

  const { data: results, isFetching } = useQuery<ParentObjectOption[]>({
    queryKey: ["/api/objects/tree", "parent-search", debounced],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debounced.trim()) params.set("search", debounced.trim());
      const res = await fetch(versionedUrl(`/api/objects/tree?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta objekt");
      return res.json();
    },
    enabled: open && debounced.trim().length > 0,
    staleTime: 30000,
  });

  const options = useMemo(
    () => (results || []).filter((o) => o.id !== excludeId),
    [results, excludeId],
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
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
            {value ? (valueLabel || value) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök på namn, adress eller systemnummer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
            data-testid={testId ? `${testId}-search` : undefined}
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-72">
          <div className="py-1">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
              onClick={() => { onChange(null); setOpen(false); setSearch(""); }}
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              <span className="text-muted-foreground">{emptyOptionLabel}</span>
              {value === null && <Check className="h-4 w-4" />}
            </button>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="flex w-full items-start justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onClick={() => { onChange(o.id, o); setOpen(false); setSearch(""); }}
                data-testid={testId ? `${testId}-option-${o.id}` : undefined}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {o.name}
                    {o.objectNumber ? <span className="text-muted-foreground font-normal"> (#{o.objectNumber})</span> : null}
                  </span>
                  {o.displayName && o.displayName !== o.name && (
                    <span className="block truncate text-xs text-muted-foreground" data-testid={testId ? `${testId}-displayname-${o.id}` : undefined}>
                      {o.displayName}
                    </span>
                  )}
                </span>
                {value === o.id && <Check className="h-4 w-4 shrink-0 mt-0.5" />}
              </button>
            ))}
            {open && debounced.trim().length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                Skriv för att söka efter ett överordnat objekt.
              </div>
            )}
            {!isFetching && debounced.trim().length > 0 && options.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                Inga objekt matchar "{debounced}"
              </div>
            )}
            {isFetching && (
              <div className="px-3 py-2 text-center text-xs text-muted-foreground">Laddar...</div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
