import { storage } from "../storage";
import { geocodeAddress, searchDestinations } from "../google-geocoding";
import type { ServiceObject } from "@shared/schema";

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
  if (!obj.address || obj.address.trim() === "") return null;
  return [obj.address, obj.postalCode, obj.city].filter(Boolean).join(", ");
}

export function objectNeedsGeocoding(obj: Pick<ServiceObject, "address" | "latitude" | "longitude">): boolean {
  if (!obj.address || obj.address.trim() === "") return false;
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
  if (!options.force && !objectNeedsGeocoding(obj)) {
    return { objectId, status: "skipped", reason: "Already has coordinates or no address" };
  }
  if (!obj.address || obj.address.trim() === "") {
    return { objectId, status: "skipped", reason: "No address" };
  }

  const fullAddress = buildAddressString(obj);
  if (!fullAddress) {
    return { objectId, status: "skipped", reason: "No address" };
  }

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

    await storage.updateObject(objectId, updateData);
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
