import { trackApiUsage } from "./api-usage-tracker";

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const GEOAPIFY_GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search";
const GEOAPIFY_AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const GEOAPIFY_REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  entranceLatitude?: number;
  entranceLongitude?: number;
  addressDescriptor?: string;
  postalCode?: string;
  city?: string;
  components?: {
    streetNumber?: string;
    route?: string;
    locality?: string;
    postalCode?: string;
    country?: string;
  };
}

export interface SearchDestinationsResult extends GeocodingResult {
  placeId?: string;
  navigationPoints?: Array<{
    latitude: number;
    longitude: number;
    type: string;
  }>;
  descriptors?: Array<{
    type: string;
    text: string;
  }>;
}

export interface AddressSuggestion {
  formattedAddress: string;
  street?: string;
  houseNumber?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  resultType?: string;
}

async function nominatimFallback(address: string): Promise<GeocodingResult | null> {
  try {
    const params = new URLSearchParams({
      q: address,
      format: "json",
      countrycodes: "se",
      addressdetails: "1",
      limit: "1",
    });

    const res = await fetch(`${NOMINATIM_BASE_URL}?${params.toString()}`, {
      headers: { "User-Agent": "Traivo-FieldService/1.0" },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;

    const result = data[0];
    const addressParts = result.address || {};

    await trackApiUsage({
      service: "nominatim",
      endpoint: "/search",
      method: "nominatimFallback",
      units: 1,
      statusCode: res.status,
      durationMs: 0,
    });

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      formattedAddress: result.display_name,
      postalCode: addressParts.postcode,
      city: addressParts.city || addressParts.town || addressParts.village,
      components: {
        streetNumber: addressParts.house_number,
        route: addressParts.road,
        locality: addressParts.city || addressParts.town || addressParts.village,
        postalCode: addressParts.postcode,
        country: addressParts.country,
      },
    };
  } catch (error) {
    console.error("[geocoding] Nominatim fallback failed:", error);
    return null;
  }
}

function extractGeoapifyComponents(props: Record<string, string>): GeocodingResult["components"] {
  return {
    streetNumber: props.housenumber,
    route: props.street,
    locality: props.city || props.town || props.village,
    postalCode: props.postcode,
    country: props.country,
  };
}

export async function geocodeAddress(
  address: string,
  tenantId?: string
): Promise<GeocodingResult | null> {
  if (!GEOAPIFY_API_KEY) {
    console.log("[geocoding] No Geoapify API key, using Nominatim fallback");
    return nominatimFallback(address);
  }

  const startTime = Date.now();

  try {
    const params = new URLSearchParams({
      text: address,
      apiKey: GEOAPIFY_API_KEY,
      lang: "sv",
      filter: "countrycode:se",
      limit: "1",
    });

    const res = await fetch(`${GEOAPIFY_GEOCODE_URL}?${params.toString()}`);
    const data = await res.json();
    const durationMs = Date.now() - startTime;

    await trackApiUsage({
      tenantId,
      service: "geoapify-geocoding",
      endpoint: "/geocode/search",
      method: "geocodeAddress",
      units: 1,
      statusCode: res.status,
      durationMs,
    });

    if (!data.features || data.features.length === 0) {
      console.warn("[geocoding] No Geoapify results for:", address);
      return nominatimFallback(address);
    }

    const feature = data.features[0];
    const props = feature.properties;

    return {
      latitude: props.lat,
      longitude: props.lon,
      formattedAddress: props.formatted,
      postalCode: props.postcode,
      city: props.city || props.town || props.village,
      components: extractGeoapifyComponents(props),
    };
  } catch (error) {
    console.error("[geocoding] Geoapify geocoding failed, falling back to Nominatim:", error);
    return nominatimFallback(address);
  }
}

export async function searchDestinations(
  address: string,
  tenantId?: string
): Promise<SearchDestinationsResult | null> {
  if (!GEOAPIFY_API_KEY) {
    console.log("[geocoding] No Geoapify API key, using Nominatim fallback");
    const fallback = await nominatimFallback(address);
    return fallback ? { ...fallback } : null;
  }

  const startTime = Date.now();

  try {
    const params = new URLSearchParams({
      text: address,
      apiKey: GEOAPIFY_API_KEY,
      lang: "sv",
      filter: "countrycode:se",
      limit: "5",
    });

    const res = await fetch(`${GEOAPIFY_GEOCODE_URL}?${params.toString()}`);
    const data = await res.json();
    const durationMs = Date.now() - startTime;

    await trackApiUsage({
      tenantId,
      service: "geoapify-geocoding",
      endpoint: "/geocode/search",
      method: "searchDestinations",
      units: 1,
      statusCode: res.status,
      durationMs,
    });

    if (!data.features || data.features.length === 0) {
      console.warn("[geocoding] SearchDestinations no Geoapify results for:", address);
      const fallback = await nominatimFallback(address);
      return fallback ? { ...fallback } : null;
    }

    const feature = data.features[0];
    const props = feature.properties;
    const components = extractGeoapifyComponents(props);

    const navigationPoints: SearchDestinationsResult["navigationPoints"] = [];
    if (props.result_type === "building" || props.result_type === "amenity") {
      navigationPoints.push({
        latitude: props.lat,
        longitude: props.lon,
        type: "primary",
      });
    }

    const descriptors: SearchDestinationsResult["descriptors"] = [];
    if (props.suburb) {
      descriptors.push({ type: "area", text: props.suburb });
    }
    if (props.district) {
      descriptors.push({ type: "area", text: props.district });
    }

    const addressDescriptor = descriptors.length > 0
      ? descriptors.map(d => d.text).filter(Boolean).join(". ")
      : undefined;

    const primaryNav = navigationPoints.find(n => n.type === "primary");

    return {
      latitude: props.lat,
      longitude: props.lon,
      formattedAddress: props.formatted,
      entranceLatitude: primaryNav?.latitude,
      entranceLongitude: primaryNav?.longitude,
      addressDescriptor,
      postalCode: props.postcode,
      city: props.city || props.town || props.village,
      placeId: props.place_id,
      components,
      navigationPoints,
      descriptors,
    };
  } catch (error) {
    console.error("[geocoding] SearchDestinations failed, falling back to Nominatim:", error);
    const fallback = await nominatimFallback(address);
    return fallback ? { ...fallback } : null;
  }
}

export async function autocompleteAddress(
  text: string,
  tenantId?: string,
  limit = 5
): Promise<AddressSuggestion[]> {
  const trimmed = text.trim();
  if (trimmed.length < 3) return [];

  if (!GEOAPIFY_API_KEY) {
    try {
      const params = new URLSearchParams({
        q: trimmed,
        format: "json",
        countrycodes: "se",
        addressdetails: "1",
        limit: String(Math.min(limit, 10)),
      });
      const res = await fetch(`${NOMINATIM_BASE_URL}?${params.toString()}`, {
        headers: { "User-Agent": "Traivo-FieldService/1.0" },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as Array<Record<string, any>>;
      await trackApiUsage({
        service: "nominatim",
        endpoint: "/search",
        method: "autocompleteAddress",
        units: 1,
        statusCode: res.status,
        durationMs: 0,
      });
      return data.map((row) => {
        const addr = row.address || {};
        const street = addr.road || addr.pedestrian || addr.path;
        const houseNumber = addr.house_number;
        return {
          formattedAddress: row.display_name as string,
          street,
          houseNumber,
          address: street ? (houseNumber ? `${street} ${houseNumber}` : street) : undefined,
          postalCode: addr.postcode,
          city: addr.city || addr.town || addr.village,
          latitude: parseFloat(row.lat),
          longitude: parseFloat(row.lon),
        } satisfies AddressSuggestion;
      }).filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
    } catch (error) {
      console.error("[geocoding] Nominatim autocomplete failed:", error);
      return [];
    }
  }

  const startTime = Date.now();
  try {
    const params = new URLSearchParams({
      text: trimmed,
      apiKey: GEOAPIFY_API_KEY,
      lang: "sv",
      filter: "countrycode:se",
      limit: String(Math.min(limit, 10)),
      format: "json",
    });

    const res = await fetch(`${GEOAPIFY_AUTOCOMPLETE_URL}?${params.toString()}`);
    const data = await res.json();
    const durationMs = Date.now() - startTime;

    await trackApiUsage({
      tenantId,
      service: "geoapify-geocoding",
      endpoint: "/geocode/autocomplete",
      method: "autocompleteAddress",
      units: 1,
      statusCode: res.status,
      durationMs,
    });

    const rows: any[] = Array.isArray(data?.results) ? data.results : [];
    return rows
      .map((row) => {
        const street = row.street;
        const houseNumber = row.housenumber;
        const address = street
          ? (houseNumber ? `${street} ${houseNumber}` : street)
          : undefined;
        const lat = typeof row.lat === "number" ? row.lat : parseFloat(row.lat);
        const lon = typeof row.lon === "number" ? row.lon : parseFloat(row.lon);
        return {
          formattedAddress: row.formatted as string,
          street,
          houseNumber,
          address,
          postalCode: row.postcode,
          city: row.city || row.town || row.village,
          latitude: lat,
          longitude: lon,
          placeId: row.place_id,
          resultType: row.result_type,
        } satisfies AddressSuggestion;
      })
      .filter((s) => s.formattedAddress && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  } catch (error) {
    console.error("[geocoding] Geoapify autocomplete failed:", error);
    return [];
  }
}

export async function batchGeocode(
  addresses: Array<{ id: string; address: string }>,
  tenantId?: string,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, SearchDestinationsResult>> {
  const results = new Map<string, SearchDestinationsResult>();
  const total = addresses.length;

  for (let i = 0; i < addresses.length; i++) {
    const { id, address } = addresses[i];
    if (!address) continue;

    const result = await searchDestinations(address, tenantId);
    if (result) {
      results.set(id, result);
    }

    onProgress?.(i + 1, total);

    if (i < addresses.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}

export function isGoogleGeocodingAvailable(): boolean {
  return !!GEOAPIFY_API_KEY;
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
  tenantId?: string
): Promise<{ city?: string; postalCode?: string; address?: string } | null> {
  if (GEOAPIFY_API_KEY) {
    try {
      const params = new URLSearchParams({
        lat: latitude.toString(),
        lon: longitude.toString(),
        apiKey: GEOAPIFY_API_KEY,
        lang: "sv",
      });
      const startTime = Date.now();
      const res = await fetch(`${GEOAPIFY_REVERSE_URL}?${params.toString()}`);
      const data = await res.json();
      const durationMs = Date.now() - startTime;

      await trackApiUsage({
        tenantId,
        service: "geoapify-geocoding",
        endpoint: "/geocode/reverse",
        method: "reverseGeocode",
        units: 1,
        statusCode: res.status,
        durationMs,
      });

      if (data.features && data.features.length > 0) {
        const props = data.features[0].properties;
        const city = props.city || props.town || props.village;
        if (city) {
          const street = props.street || props.name;
          const houseNo = props.housenumber;
          const address = street
            ? (houseNo ? `${street} ${houseNo}` : street)
            : undefined;
          return { city, postalCode: props.postcode, address };
        }
      }
    } catch (error) {
      console.error("[geocoding] Geoapify reverse geocoding failed:", error);
    }
  }

  try {
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lon: longitude.toString(),
      format: "json",
      addressdetails: "1",
    });
    const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`, {
      headers: { "User-Agent": "Traivo-FieldService/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();

    await trackApiUsage({
      service: "nominatim",
      endpoint: "/reverse",
      method: "reverseGeocode",
      units: 1,
      statusCode: res.status,
      durationMs: 0,
    });

    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village;
    if (city) {
      const street = addr.road || addr.pedestrian || addr.path;
      const houseNo = addr.house_number;
      const address = street
        ? (houseNo ? `${street} ${houseNo}` : street)
        : undefined;
      return { city, postalCode: addr.postcode, address };
    }
    return null;
  } catch (error) {
    console.error("[geocoding] Nominatim reverse geocoding failed:", error);
    return null;
  }
}

export async function lookupCityFromPostalCode(
  postalCode: string,
  tenantId?: string
): Promise<string | null> {
  const cleanCode = postalCode.replace(/\s/g, "");
  if (!/^\d{5}$/.test(cleanCode)) return null;

  const searchAddress = `${cleanCode}, Sverige`;
  const result = await geocodeAddress(searchAddress, tenantId);
  return result?.city || result?.components?.locality || null;
}
