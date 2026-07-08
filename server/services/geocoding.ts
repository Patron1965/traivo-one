import { storage } from "../storage";
import {
  geocodeAddress,
  searchDestinations,
  reverseGeocode,
  autocompleteAddress,
  batchGeocode,
  isGoogleGeocodingAvailable,
  lookupCityFromPostalCode,
} from "../geoapify-geocoding";
import type { ServiceObject } from "@shared/schema";

// Re-export the lower-level Geoapify/Nominatim primitives so all server-side
// callers (importRoutes, objectRoutes, mobile) have a single entry point. The
// raw `server/geoapify-geocoding.ts` module remains the implementation detail
// for retry/fallback/cache logic; new call-sites should import from here.
export {
  geocodeAddress,
  searchDestinations,
  reverseGeocode,
  autocompleteAddress,
  batchGeocode,
  isGoogleGeocodingAvailable,
  lookupCityFromPostalCode,
};
export type {
  GeocodingResult,
  SearchDestinationsResult,
  AddressSuggestion,
} from "../geoapify-geocoding";

export interface GeocodeObjectResult {
  objectId: string;
  status: "geocoded" | "skipped" | "no-result" | "error";
  reason?: string;
  latitude?: number;
  longitude?: number;
}

export interface GeocodeBatchSummary {
  total: number;
  geocoded: number;
  skipped: number;
  failed: number;
  results: GeocodeObjectResult[];
}

export function buildAddressString(obj: Pick<ServiceObject, "address" | "postalCode" | "city">): string | null {
  // Task #990: tål stad-only, gatuadress eller postnr — bygg av alla icke-tomma delar.
  const parts = [obj.address, obj.postalCode, obj.city]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function objectNeedsGeocoding(
  obj: Pick<ServiceObject, "address" | "city" | "postalCode" | "latitude" | "longitude" | "locationType">,
): boolean {
  // Task #990: objekt utan geografi ("none") geokodas aldrig.
  if (obj.locationType === "none") return false;
  // Behöver minst en adresskomponent (tål stad-only) och sakna koordinater.
  if (!buildAddressString(obj)) return false;
  return obj.latitude == null || obj.longitude == null;
}

export async function geocodeObjectById(
  objectId: string,
  options: { useSearchDestinations?: boolean; force?: boolean } = {}
): Promise<GeocodeObjectResult> {
  const obj = await storage.getObject(objectId);
  if (!obj) {
    return { objectId, status: "error", reason: "Object not found" };
  }
  return geocodeObject(obj, options);
}

export async function geocodeObject(
  obj: ServiceObject,
  options: { useSearchDestinations?: boolean; force?: boolean } = {}
): Promise<GeocodeObjectResult> {
  const objectId = obj.id;
  if (obj.locationType === "none") {
    return { objectId, status: "skipped", reason: "Location type is none" };
  }
  if (!options.force && !objectNeedsGeocoding(obj)) {
    return { objectId, status: "skipped", reason: "Already has coordinates or no address" };
  }

  const fullAddress = buildAddressString(obj);
  if (!fullAddress) {
    return { objectId, status: "skipped", reason: "No address" };
  }
  // Task #990: stad-only adress (ingen gatuadress) ger en ungefärlig centroid. Markera
  // som "area" om platstyp inte satts explicit, så motorn inte ruttar till en gissad punkt.
  const isCityOnly = !obj.address || obj.address.trim() === "";

  try {
    const result = options.useSearchDestinations
      ? await searchDestinations(fullAddress, obj.tenantId)
      : await geocodeAddress(fullAddress, obj.tenantId);

    if (!result || result.latitude == null || result.longitude == null) {
      console.warn(`[geocoding-service] No result for object ${objectId} (${fullAddress})`);
      return { objectId, status: "no-result", reason: `No geocode result for "${fullAddress}"` };
    }

    const updateData: Record<string, unknown> = {
      latitude: result.latitude,
      longitude: result.longitude,
    };
    if ("entranceLatitude" in result && result.entranceLatitude != null) {
      updateData.entranceLatitude = result.entranceLatitude;
      updateData.entranceLongitude = result.entranceLongitude;
    }
    if ("addressDescriptor" in result && result.addressDescriptor) {
      updateData.addressDescriptor = result.addressDescriptor;
    }
    if (result.postalCode && (!obj.postalCode || obj.postalCode.trim() === "")) {
      updateData.postalCode = result.postalCode;
    }
    if (result.city && (!obj.city || obj.city.trim() === "")) {
      updateData.city = result.city;
    }
    if (isCityOnly && obj.locationType == null) {
      updateData.locationType = "area";
    }

    await storage.updateObject(objectId, updateData);
    // Kanonisk geomodell (T004): spegla den geokodade koordinaten tillbaka till
    // objektets Koordinater-metadatafält (metod='auto'). Fire-and-forget; respekterar
    // en manuell pin och konvergerar (skriver inget om värdet redan stämmer).
    void import("./geo-field-sync")
      .then(({ mirrorCoordinatesToMetadata }) =>
        mirrorCoordinatesToMetadata(obj.tenantId, objectId, result.latitude!, result.longitude!),
      )
      .catch((err) => console.error(`[geocoding-service] coord-mirror failed for ${objectId}:`, err));
    console.log(
      `[geocoding-service] Geocoded object ${objectId} -> (${result.latitude}, ${result.longitude}) from "${fullAddress}"`
    );
    return {
      objectId,
      status: "geocoded",
      latitude: result.latitude,
      longitude: result.longitude,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[geocoding-service] Error geocoding object ${objectId}: ${message}`);
    return { objectId, status: "error", reason: message };
  }
}

/**
 * Fire-and-forget geocoding triggered when a new object is created.
 * Skips silently if the object doesn't need geocoding. Logs result.
 */
export function triggerGeocodeIfMissing(objectId: string, options: { force?: boolean } = {}): void {
  void geocodeObjectById(objectId, options).catch((err) => {
    console.error(`[geocoding-service] triggerGeocodeIfMissing failed for ${objectId}:`, err);
  });
}

/**
 * Batch-geocode every object in a tenant that has an address but no
 * coordinates. Throttled with a small delay between requests to be nice
 * to the geocoding provider.
 */
export async function geocodeMissingForTenant(
  tenantId: string,
  options: {
    delayMs?: number;
    limit?: number;
    useSearchDestinations?: boolean;
    onProgress?: (done: number, total: number, last: GeocodeObjectResult) => void;
  } = {}
): Promise<GeocodeBatchSummary> {
  const { delayMs = 150, limit, useSearchDestinations = true, onProgress } = options;
  const all = await storage.getObjects(tenantId);
  let candidates = all.filter(objectNeedsGeocoding);
  if (limit && limit > 0) candidates = candidates.slice(0, limit);

  const summary: GeocodeBatchSummary = {
    total: candidates.length,
    geocoded: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  console.log(
    `[geocoding-service] Starting tenant ${tenantId}: ${candidates.length} object(s) need geocoding`
  );

  for (let i = 0; i < candidates.length; i++) {
    const obj = candidates[i];
    const result = await geocodeObject(obj, { useSearchDestinations });
    summary.results.push(result);
    if (result.status === "geocoded") summary.geocoded++;
    else if (result.status === "skipped") summary.skipped++;
    else summary.failed++;
    onProgress?.(i + 1, candidates.length, result);
    if (i < candidates.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.log(
    `[geocoding-service] Tenant ${tenantId} done: ${summary.geocoded} geocoded, ${summary.failed} failed, ${summary.skipped} skipped (of ${summary.total})`
  );
  return summary;
}
