import { trackApiUsage } from "./api-usage-tracker";

const GOOGLE_API_KEY = process.env.GOOGLE_GEOCODING_API_KEY;
const GEOCODING_BASE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
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
      headers: { "User-Agent": "Unicorn-FieldService/1.0" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data || data.length === 0) return null;

    const result = data[0];
    const addr = result.address || {};

    await trackApiUsage({
      service: "nominatim",
      endpoint: "/search",
      method: "GET",
      units: 1,
      statusCode: 200,
    });

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      formattedAddress: result.display_name,
      postalCode: addr.postcode,
      city: addr.city || addr.town || addr.village || addr.municipality,
      components: {
        streetNumber: addr.house_number,
        route: addr.road,
        locality: addr.city || addr.town || addr.village,
        postalCode: addr.postcode,
        country: addr.country,
      },
    };
  } catch (error) {
    console.error("[google-geocoding] Nominatim fallback failed:", error);
    return null;
  }
}

export async function geocodeAddress(
  address: string,
  tenantId?: string
): Promise<GeocodingResult | null> {
  if (!GOOGLE_API_KEY) {
    console.log("[google-geocoding] No API key configured, using Nominatim fallback");
    return nominatimFallback(address);
  }

  const startTime = Date.now();

  try {
    const params = new URLSearchParams({
      address: address,
      key: GOOGLE_API_KEY,
      region: "se",
      language: "sv",
    });

    const res = await fetch(`${GEOCODING_BASE_URL}?${params.toString()}`);
    const data = await res.json();
    const durationMs = Date.now() - startTime;

    await trackApiUsage({
      tenantId,
      service: "google-geocoding",
      endpoint: "/geocode",
      method: "geocodeAddress",
      units: 1,
      statusCode: res.status,
      durationMs,
    });

    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      console.warn("[google-geocoding] No results for:", address, "status:", data.status);
      return nominatimFallback(address);
    }

    const result = data.results[0];
    const location = result.geometry.location;
    const components = extractAddressComponents(result.address_components || []);

    return {
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: result.formatted_address,
      postalCode: components.postalCode,
      city: components.locality,
      components,
    };
  } catch (error) {
    console.error("[google-geocoding] Google geocoding failed, falling back to Nominatim:", error);
    return nominatimFallback(address);
  }
}

export async function searchDestinations(
  address: string,
  tenantId?: string
): Promise<SearchDestinationsResult | null> {
  if (!GOOGLE_API_KEY) {
    console.log("[google-geocoding] No API key configured, using Nominatim fallback");
    const fallback = await nominatimFallback(address);
    return fallback ? { ...fallback } : null;
  }

  const startTime = Date.now();

  try {
    const params = new URLSearchParams({
      address: address,
      key: GOOGLE_API_KEY,
      region: "se",
      language: "sv",
      result_type: "street_address|premise|subpremise",
      enable_address_descriptor: "true",
    });

    const res = await fetch(`${GEOCODING_BASE_URL}?${params.toString()}`);
    const data = await res.json();
    const durationMs = Date.now() - startTime;

    await trackApiUsage({
      tenantId,
      service: "google-geocoding",
      endpoint: "/searchDestinations",
      method: "searchDestinations",
      units: 1,
      statusCode: res.status,
      durationMs,
    });

    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      console.warn("[google-geocoding] SearchDestinations no results for:", address, "status:", data.status);
      const fallback = await nominatimFallback(address);
      return fallback ? { ...fallback } : null;
    }

    const result = data.results[0];
    const location = result.geometry.location;
    const components = extractAddressComponents(result.address_components || []);

    const navigationPoints: SearchDestinationsResult["navigationPoints"] = [];
    if (result.geometry.location_type === "ROOFTOP" || result.geometry.location_type === "RANGE_INTERPOLATED") {
      navigationPoints.push({
        latitude: location.lat,
        longitude: location.lng,
        type: "primary",
      });
    }

    if (result.geometry.viewport) {
      const vp = result.geometry.viewport;
      const entranceLat = vp.southwest ? (vp.southwest.lat + location.lat) / 2 : location.lat;
      const entranceLng = vp.southwest ? (vp.southwest.lng + location.lng) / 2 : location.lng;

      if (result.geometry.location_type === "ROOFTOP") {
        navigationPoints.push({
          latitude: entranceLat,
          longitude: entranceLng,
          type: "entrance_estimate",
        });
      }
    }

    const descriptors: SearchDestinationsResult["descriptors"] = [];
    if (data.address_descriptor) {
      const ad = data.address_descriptor;
      if (ad.landmarks && Array.isArray(ad.landmarks)) {
        for (const landmark of ad.landmarks.slice(0, 3)) {
          descriptors.push({
            type: "landmark",
            text: `${landmark.spatial_relationship || "Nära"} ${landmark.display_name?.text || landmark.name || ""}`.trim(),
          });
        }
      }
      if (ad.areas && Array.isArray(ad.areas)) {
        for (const area of ad.areas.slice(0, 2)) {
          descriptors.push({
            type: "area",
            text: area.display_name?.text || area.name || "",
          });
        }
      }
    }

    const addressDescriptor = descriptors.length > 0
      ? descriptors.map(d => d.text).filter(Boolean).join(". ")
      : undefined;

    const primaryNav = navigationPoints.find(n => n.type === "primary");

    return {
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: result.formatted_address,
      entranceLatitude: primaryNav?.latitude,
      entranceLongitude: primaryNav?.longitude,
      addressDescriptor,
      postalCode: components.postalCode,
      city: components.locality,
      placeId: result.place_id,
      components,
      navigationPoints,
      descriptors,
    };
  } catch (error) {
    console.error("[google-geocoding] SearchDestinations failed, falling back to Nominatim:", error);
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

function extractAddressComponents(components: any[]): GeocodingResult["components"] {
  const result: GeocodingResult["components"] = {};

  for (const comp of components) {
    const types = comp.types || [];
    if (types.includes("street_number")) {
      result.streetNumber = comp.long_name;
    } else if (types.includes("route")) {
      result.route = comp.long_name;
    } else if (types.includes("locality") || types.includes("postal_town")) {
      result.locality = comp.long_name;
    } else if (types.includes("postal_code")) {
      result.postalCode = comp.long_name;
    } else if (types.includes("country")) {
      result.country = comp.long_name;
    }
  }

  return result;
}

export function isGoogleGeocodingAvailable(): boolean {
  return !!GOOGLE_API_KEY;
}
