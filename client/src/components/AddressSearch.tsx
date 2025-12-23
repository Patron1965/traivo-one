import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MapPin, Loader2 } from "lucide-react";

interface AddressResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    municipality?: string;
    postcode?: string;
  };
}

interface AddressSearchProps {
  onSelect: (result: { address: string; lat: number; lon: number; postalCode?: string }) => void;
  placeholder?: string;
  defaultValue?: string;
}

export function AddressSearch({ onSelect, placeholder = "Sök adress...", defaultValue = "" }: AddressSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=se&limit=5&q=${encodeURIComponent(query)}`,
          {
            headers: {
              "Accept-Language": "sv",
            },
          }
        );
        if (response.ok) {
          const data: AddressResult[] = await response.json();
          setResults(data);
          setOpen(data.length > 0);
        }
      } catch (error) {
        console.error("Address search error:", error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleSelect = (result: AddressResult) => {
    const postalCode = result.address?.postcode;
    setQuery(result.display_name);
    setOpen(false);
    onSelect({
      address: result.display_name,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      postalCode,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative w-full">
          <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="pl-10 pr-10"
            data-testid="input-address-search"
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent 
        className="p-0 w-[var(--radix-popover-trigger-width)]" 
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandList>
            <CommandEmpty>Inga adresser hittades</CommandEmpty>
            <CommandGroup>
              {results.map((result, index) => (
                <CommandItem
                  key={`${result.lat}-${result.lon}-${index}`}
                  value={result.display_name}
                  onSelect={() => handleSelect(result)}
                  className="cursor-pointer"
                  data-testid={`address-result-${index}`}
                >
                  <MapPin className="mr-2 h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{result.display_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
