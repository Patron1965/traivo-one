import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search, Filter, X } from "lucide-react";
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

interface CustomerOption {
  id: string;
  name: string;
  customerNumber?: string | null;
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

  // Kund-förfilter: begränsar objektträdet till en specifik kund så att stora
  // datamängder kan smalnas av. Sticky inom modalsessionen (nollställs ej när
  // popovern stängs) så användaren slipper välja kund igen vid nästa öppning.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomer = useDebounced(customerSearch);

  const { data: customerData } = useQuery<CustomerOption[]>({
    queryKey: ["/api/customers", "parent-customer-filter"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/customers`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta kunder");
      return res.json();
    },
    enabled: open,
    staleTime: 60000,
  });

  const customerOptions = useMemo(() => {
    const list = customerData || [];
    const q = debouncedCustomer.trim().toLowerCase();
    if (!q) return [] as CustomerOption[];
    return list
      .filter((c) => c.name?.toLowerCase().includes(q) || (c.customerNumber ?? "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [customerData, debouncedCustomer]);

  // Objektlistan: behåll den föregående listan synlig medan en ny sökning hämtas,
  // vilket eliminerar flimret (tom lista → "Laddar..." → ny lista) som uppstod när
  // query-nyckeln ändrades per tangenttryck. Behåll dock ENDAST inom samma kund-scope
  // (index 2 = customerId) — när kunden byts/rensas släpps gamla resultat så att
  // inaktuella objekt från en annan kund aldrig visas eller går att klicka på.
  const { data: results, isFetching } = useQuery<ParentObjectOption[]>({
    queryKey: ["/api/objects/tree", "parent-search", customerId ?? "", debounced],
    queryFn: async () => {
      const params = new URLSearchParams();
      // Väljaren vill alltid ha en platt, valbar lista (alla nivåer) — inte
      // träd-nivå-noder. flat=true aktiverar serverns platta gren även för rena
      // kund-förfilter utan sökterm; customerId utan flat=true ger hierarkisk träd-vy.
      params.set("flat", "true");
      if (debounced.trim()) params.set("search", debounced.trim());
      if (customerId) params.set("customerId", customerId);
      const res = await fetch(versionedUrl(`/api/objects/tree?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta objekt");
      return res.json();
    },
    enabled: open && (debounced.trim().length > 0 || !!customerId),
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey?.[2] === (customerId ?? "") ? prev : undefined,
    staleTime: 30000,
  });

  const options = useMemo(
    () => (results || []).filter((o) => o.id !== excludeId),
    [results, excludeId],
  );

  const hasQuery = debounced.trim().length > 0 || !!customerId;

  function selectCustomer(c: CustomerOption) {
    setCustomerId(c.id);
    setCustomerName(c.customerNumber ? `${c.name} (#${c.customerNumber})` : c.name);
    setCustomerSearch("");
  }

  function clearCustomer() {
    setCustomerId(null);
    setCustomerName("");
    setCustomerSearch("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setSearch("");
          setCustomerSearch("");
        }
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
            {value ? (valueLabel || value) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[360px] p-0"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Kund-förfilter */}
        <div className="border-b p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            Förfiltrera på kund (valfritt)
          </div>
          {customerId ? (
            <div
              className="flex items-center justify-between gap-2 rounded-md bg-accent px-2 py-1.5 text-sm"
              data-testid={testId ? `${testId}-customer-active` : undefined}
            >
              <span className="truncate">{customerName}</span>
              <button
                type="button"
                className="shrink-0 rounded-sm p-0.5 hover:bg-background"
                onClick={clearCustomer}
                aria-label="Rensa kundfilter"
                data-testid={testId ? `${testId}-customer-clear` : undefined}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="Sök kund..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="h-8 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-1"
                  data-testid={testId ? `${testId}-customer-search` : undefined}
                />
              </div>
              {debouncedCustomer.trim().length > 0 && (
                <div className="max-h-40 overflow-auto rounded-md border">
                  {customerOptions.length === 0 ? (
                    <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                      Inga kunder matchar "{debouncedCustomer}"
                    </div>
                  ) : (
                    customerOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent text-left"
                        onClick={() => selectCustomer(c)}
                        data-testid={testId ? `${testId}-customer-option-${c.id}` : undefined}
                      >
                        <span className="truncate">
                          {c.name}
                          {c.customerNumber ? (
                            <span className="text-muted-foreground"> (#{c.customerNumber})</span>
                          ) : null}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Objektsökning */}
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
            {!hasQuery && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                Skriv för att söka eller förfiltrera på en kund.
              </div>
            )}
            {!isFetching && hasQuery && options.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                {debounced.trim().length > 0
                  ? `Inga objekt matchar "${debounced}"`
                  : "Den valda kunden saknar objekt."}
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
