import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MapPin, Loader2, DoorOpen } from "lucide-react";

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

interface GoogleGeoResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  entranceLatitude?: number;
  entranceLongitude?: number;
  addressDescriptor?: string;
  postalCode?: string;
  city?: string;
}

interface AddressSearchProps {
  onSelect: (result: {
    address: string;
    lat: number;
    lon: number;
    postalCode?: string;
    entranceLat?: number;
    entranceLon?: number;
    addressDescriptor?: string;
    city?: string;
  }) => void;
  placeholder?: string;
  defaultValue?: string;
}

export function AddressSearch({ onSelect, placeholder = "Sök adress...", defaultValue = "" }: AddressSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultValue);
  const [googleResults, setGoogleResults] = useState<GoogleGeoResult[]>([]);
  const [nominatimResults, setNominatimResults] = useState<AddressResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [useGoogle, setUseGoogle] = useState(true);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.length < 3) {
      setGoogleResults([]);
      setNominatimResults([]);
      setOpen(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      let handled = false;
      try {
        if (useGoogle) {
          try {
            const res = await fetch("/api/geocode/search-destinations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ address: query }),
            });
            if (res.ok) {
              const data: GoogleGeoResult = await res.json();
              setGoogleResults([data]);
              setNominatimResults([]);
              setOpen(true);
              handled = true;
            }
          } catch {
            setUseGoogle(false);
          }
        }

        if (!handled) {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=se&limit=5&q=${encodeURIComponent(query)}`,
            { headers: { "Accept-Language": "sv" } }
          );
          if (response.ok) {
            const data: AddressResult[] = await response.json();
            setNominatimResults(data);
            setGoogleResults([]);
            setOpen(data.length > 0);
          }
        }
      } catch (error) {
        console.error("Address search error:", error);
        setNominatimResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, useGoogle]);

  const handleSelectGoogle = (result: GoogleGeoResult) => {
    setQuery(result.formattedAddress);
    setOpen(false);
    onSelect({
      address: result.formattedAddress,
      lat: result.latitude,
      lon: result.longitude,
      postalCode: result.postalCode,
      entranceLat: result.entranceLatitude,
      entranceLon: result.entranceLongitude,
      addressDescriptor: result.addressDescriptor,
      city: result.city,
    });
  };

  const handleSelectNominatim = (result: AddressResult) => {
    const postalCode = result.address?.postcode;
    setQuery(result.display_name);
    setOpen(false);
    onSelect({
      address: result.display_name,
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      postalCode,
      city: result.address?.city || result.address?.town || result.address?.municipality,
    });
  };

  const hasGoogleResults = googleResults.length > 0;
  const hasNominatimResults = nominatimResults.length > 0;

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
            {hasGoogleResults && (
              <CommandGroup heading="Google Geocoding">
                {googleResults.map((result, index) => (
                  <CommandItem
                    key={`google-${index}`}
                    value={result.formattedAddress}
                    onSelect={() => handleSelectGoogle(result)}
                    className="cursor-pointer"
                    data-testid={`address-result-google-${index}`}
                  >
                    <MapPin className="mr-2 h-4 w-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{result.formattedAddress}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {result.entranceLatitude && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <DoorOpen className="h-3 w-3" />
                            Entrékoordinater
                          </span>
                        )}
                        {result.addressDescriptor && (
                          <span className="text-xs text-muted-foreground truncate">{result.addressDescriptor}</span>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {hasNominatimResults && (
              <CommandGroup heading={hasGoogleResults ? "OpenStreetMap" : undefined}>
                {nominatimResults.map((result, index) => (
                  <CommandItem
                    key={`${result.lat}-${result.lon}-${index}`}
                    value={result.display_name}
                    onSelect={() => handleSelectNominatim(result)}
                    className="cursor-pointer"
                    data-testid={`address-result-${index}`}
                  >
                    <MapPin className="mr-2 h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{result.display_name}</span>
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
