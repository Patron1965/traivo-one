import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { versionedUrl } from "@/lib/queryClient";
import type { Customer } from "@shared/schema";

interface CustomersPageResp {
  data: Customer[];
  total: number;
  page: number;
  limit: number;
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useCustomerLookup(ids: string[]) {
  const dedupedIds = useMemo(() => Array.from(new Set(ids.filter(Boolean))), [ids]);
  const key = dedupedIds.join(",");
  const { data } = useQuery<Customer[]>({
    queryKey: ["/api/customers", "by-ids", key],
    queryFn: async () => {
      if (!key) return [];
      const res = await fetch(versionedUrl(`/api/customers?ids=${encodeURIComponent(key)}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json();
    },
    enabled: dedupedIds.length > 0,
    staleTime: 60000,
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data || []) map.set(c.id, c.name);
    return map;
  }, [data]);
}

interface CustomerComboboxProps {
  value: string | null;
  onChange: (id: string | null, customer?: Customer) => void;
  placeholder?: string;
  emptyOptionLabel?: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
}

export function CustomerCombobox({
  value,
  onChange,
  placeholder = "Välj kund...",
  emptyOptionLabel,
  className,
  testId,
  disabled,
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const { data: results, isFetching } = useQuery<CustomersPageResp>({
    queryKey: ["/api/customers", "search", debounced],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "30" });
      if (debounced.trim()) params.set("search", debounced.trim());
      const res = await fetch(versionedUrl(`/api/customers?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json();
    },
    enabled: open,
    staleTime: 30000,
  });

  const lookup = useCustomerLookup(value ? [value] : []);
  const selectedName = value ? lookup.get(value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`justify-between ${className ?? ""}`}
          data-testid={testId}
          disabled={disabled}
        >
          <span className="truncate text-left">
            {value ? (selectedName || value) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök kund..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
            data-testid={testId ? `${testId}-search` : undefined}
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-64">
          <div className="py-1">
            {emptyOptionLabel && (
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onClick={() => { onChange(null); setOpen(false); setSearch(""); }}
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <span className="text-muted-foreground">{emptyOptionLabel}</span>
                {value === null && <Check className="h-4 w-4" />}
              </button>
            )}
            {(results?.data || []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onClick={() => { onChange(c.id, c); setOpen(false); setSearch(""); }}
                data-testid={testId ? `${testId}-option-${c.id}` : undefined}
              >
                <span className="truncate">{c.name}</span>
                {value === c.id && <Check className="h-4 w-4" />}
              </button>
            ))}
            {!isFetching && (results?.data || []).length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {debounced.trim() ? `Inga kunder matchar "${debounced}"` : "Inga kunder hittades"}
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

interface CustomerMultiComboboxProps {
  selected: string[];
  onAdd: (id: string) => void;
  onRemoveAll?: () => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}

export function CustomerMultiCombobox({
  selected,
  onAdd,
  onRemoveAll,
  placeholder = "Filtrera kund...",
  className,
  testId,
}: CustomerMultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const { data: results, isFetching } = useQuery<CustomersPageResp>({
    queryKey: ["/api/customers", "search", debounced],
    queryFn: async () => {
      const params = new URLSearchParams({ page: "1", limit: "30" });
      if (debounced.trim()) params.set("search", debounced.trim());
      const res = await fetch(versionedUrl(`/api/customers?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json();
    },
    enabled: open,
    staleTime: 30000,
  });

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`justify-between ${className ?? ""}`}
          data-testid={testId}
        >
          <span className="truncate text-left">
            {selected.length > 0 ? `${selected.length} kunder valda` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök kund..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
            data-testid={testId ? `${testId}-search` : undefined}
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-64">
          <div className="py-1">
            {selected.length > 0 && onRemoveAll && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left text-muted-foreground"
                onClick={() => { onRemoveAll(); setOpen(false); setSearch(""); }}
                data-testid={testId ? `${testId}-clear` : undefined}
              >
                <X className="h-3.5 w-3.5" />
                Rensa alla kunder
              </button>
            )}
            {(results?.data || []).filter(c => !selectedSet.has(c.id)).map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onClick={() => { onAdd(c.id); setSearch(""); }}
                data-testid={testId ? `${testId}-option-${c.id}` : undefined}
              >
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {!isFetching && (results?.data || []).filter(c => !selectedSet.has(c.id)).length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {debounced.trim() ? `Inga kunder matchar "${debounced}"` : "Inga fler kunder att välja"}
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
