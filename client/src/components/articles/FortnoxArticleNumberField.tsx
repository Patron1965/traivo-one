import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { AlertTriangle, Loader2, Tag } from "lucide-react";

export interface FortnoxArticleOption {
  articleNumber: string;
  description: string;
  unit: string;
  salesPrice: number;
  active: boolean;
}

interface FortnoxArticleSearchResponse {
  connected: boolean;
  articles: FortnoxArticleOption[];
  total: number;
  error?: string;
}

interface FortnoxArticleNumberFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSelectFortnox?: (article: FortnoxArticleOption) => void;
  invalid?: boolean;
  disabled?: boolean;
}

// Task #837: Sökbar rullgardin för artikelnummer som hämtar artiklar från
// Fortnox-registret. Fältet är fortfarande ett vanligt textfält (fritext-fallback)
// — det som skrivs blir artikelnumret. När man skriver visas Fortnox-förslag i en
// popover; väljer man ett förslag fylls numret i automatiskt.
export function FortnoxArticleNumberField({
  value,
  onChange,
  onSelectFortnox,
  invalid,
  disabled,
}: FortnoxArticleNumberFieldProps) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [debounced, setDebounced] = useState(value.trim());
  const justSelectedRef = useRef(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(handle);
  }, [value]);

  const { data, isFetching, isError } = useQuery<FortnoxArticleSearchResponse>({
    queryKey: ["/api/fortnox/articles/search", debounced],
    queryFn: async () => {
      const res = await fetch(
        `/api/fortnox/articles/search?q=${encodeURIComponent(debounced)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Sökning misslyckades");
      return res.json();
    },
    enabled: focused && debounced.length >= 2,
    staleTime: 60_000,
    retry: false,
  });

  const connected = data?.connected ?? false;
  const results = data?.articles ?? [];
  const showPopover =
    open && focused && debounced.length >= 2 && connected && !justSelectedRef.current;

  // "Tydligt fel" (Task #837): visa status nära fältet även när popovern är stängd,
  // så att användaren förstår att fritext är fallback om Fortnox är otillgängligt.
  const hasQuery = debounced.length >= 2;
  const statusMessage: string | null = !hasQuery
    ? null
    : isError
      ? "Kunde inte söka i Fortnox just nu. Skriv artikelnumret manuellt."
      : data?.error
        ? data.error
        : data && data.connected === false
          ? "Fortnox är inte anslutet — skriv artikelnumret manuellt eller anslut Fortnox under Inställningar."
          : null;

  const handleSelect = (article: FortnoxArticleOption) => {
    justSelectedRef.current = true;
    onChange(article.articleNumber);
    onSelectFortnox?.(article);
    setOpen(false);
    setTimeout(() => {
      justSelectedRef.current = false;
    }, 400);
  };

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-full">
          <Input
            id="articleNumber"
            value={value}
            onChange={(e) => {
              justSelectedRef.current = false;
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => {
              setFocused(false);
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder="Sök i Fortnox eller skriv fritext"
            required
            disabled={disabled}
            autoComplete="off"
            className={invalid ? "border-destructive focus-visible:ring-destructive pr-9" : "pr-9"}
            data-testid="input-article-number"
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverAnchor>
      {statusMessage && (
        <p
          className="text-xs text-warning flex items-start gap-1 mt-1"
          data-testid="status-fortnox-search"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{statusMessage}</span>
        </p>
      )}
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)]"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>
              {isFetching ? "Söker i Fortnox…" : "Inga artiklar hittades i Fortnox"}
            </CommandEmpty>
            {results.length > 0 && (
              <CommandGroup heading="Fortnox artikelregister">
                {results.map((article) => (
                  <CommandItem
                    key={article.articleNumber}
                    value={article.articleNumber}
                    onSelect={() => handleSelect(article)}
                    className="cursor-pointer"
                    data-testid={`fortnox-article-${article.articleNumber}`}
                  >
                    <Tag className="mr-2 h-4 w-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs mr-1">{article.articleNumber}</span>
                      <span className="truncate">{article.description}</span>
                      {!article.active && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <AlertTriangle className="h-3 w-3" /> inaktiv
                        </span>
                      )}
                    </div>
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
