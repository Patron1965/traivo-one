import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { versionedUrl } from "@/lib/queryClient";

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface ObjectsPageResp {
  objects: { id: string; name: string; customerId: string }[];
  total: number;
}

export function useObjectLookup(ids: string[]) {
  const dedupedIds = useMemo(() => Array.from(new Set(ids.filter(Boolean))), [ids]);
  const key = dedupedIds.join(",");
  const { data } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/objects", "by-ids", key],
    queryFn: async () => {
      if (!key) return [];
      const res = await fetch(versionedUrl(`/api/objects?ids=${encodeURIComponent(key)}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: dedupedIds.length > 0,
    staleTime: 60000,
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const o of data || []) map.set(o.id, o.name);
    return map;
  }, [data]);
}

interface ObjectComboboxProps {
  value: string | null;
  onChange: (id: string | null) => void;
  customerId?: string | null;
  placeholder?: string;
  emptyOptionLabel?: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
}

export function ObjectCombobox({
  value,
  onChange,
  customerId,
  placeholder = "Välj objekt...",
  emptyOptionLabel,
  className,
  testId,
  disabled,
}: ObjectComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const { data: results, isFetching } = useQuery<ObjectsPageResp>({
    queryKey: ["/api/objects", "search", debounced, customerId || "_any"],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "30", offset: "0" });
      if (debounced.trim()) params.set("search", debounced.trim());
      if (customerId) params.set("customerId", customerId);
      params.set("paginated", "true");
      const res = await fetch(versionedUrl(`/api/objects?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    enabled: open,
    staleTime: 30000,
  });

  const lookup = useObjectLookup(value ? [value] : []);
  const selectedName = value ? lookup.get(value) : undefined;

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
          disabled={disabled}
        >
          <span className="truncate text-left">
            {value ? (selectedName || value) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök objekt..."
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
            {(results?.objects || []).map((o) => (
              <button
                key={o.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onClick={() => { onChange(o.id); setOpen(false); setSearch(""); }}
                data-testid={testId ? `${testId}-option-${o.id}` : undefined}
              >
                <span className="truncate">{o.name}</span>
                {value === o.id && <Check className="h-4 w-4" />}
              </button>
            ))}
            {!isFetching && (results?.objects || []).length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {debounced.trim() ? `Inga objekt matchar "${debounced}"` : "Inga objekt hittades"}
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

interface ClusterItem {
  id: string;
  name: string;
}

export function useClusterLookup() {
  const { data } = useQuery<ClusterItem[]>({
    queryKey: ["/api/clusters"],
    staleTime: 60000,
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data || []) map.set(c.id, c.name);
    return { map, all: data || [] };
  }, [data]);
}

interface ClusterComboboxProps {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  emptyOptionLabel?: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
}

export function ClusterCombobox({
  value,
  onChange,
  placeholder = "Välj kluster...",
  emptyOptionLabel,
  className,
  testId,
  disabled,
}: ClusterComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: clusters, isFetching } = useQuery<ClusterItem[]>({
    queryKey: ["/api/clusters"],
    enabled: open || !!value,
    staleTime: 60000,
  });

  const filtered = useMemo(() => {
    const list = clusters || [];
    if (!search.trim()) return list.slice(0, 100);
    const q = search.trim().toLowerCase();
    return list.filter((c) => c.name?.toLowerCase().includes(q)).slice(0, 100);
  }, [clusters, search]);

  const selectedName = useMemo(() => {
    if (!value) return undefined;
    return (clusters || []).find((c) => c.id === value)?.name;
  }, [clusters, value]);

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
          disabled={disabled}
        >
          <span className="truncate text-left">
            {value ? (selectedName || value) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-2 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök kluster..."
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
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
                onClick={() => { onChange(c.id); setOpen(false); setSearch(""); }}
                data-testid={testId ? `${testId}-option-${c.id}` : undefined}
              >
                <span className="truncate">{c.name}</span>
                {value === c.id && <Check className="h-4 w-4" />}
              </button>
            ))}
            {!isFetching && filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {search.trim() ? `Inga kluster matchar "${search}"` : "Inga kluster hittades"}
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
