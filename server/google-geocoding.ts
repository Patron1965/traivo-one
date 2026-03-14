import { trackApiUsage } from "./api-usage-tracker";

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const GEOAPIFY_GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search";
const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";

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
