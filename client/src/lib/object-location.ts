import { OBJECT_LOCATION_TYPES, type ObjectLocationType } from "@shared/schema";

// Task #990: klient-spegling av server/services/object-location.ts för VISNING.
// Server är fortsatt auktoritativ för ruttning/geokodning; detta är bara för att
// rendera platstyp-badge/filter konsekvent i webben.

export const OBJECT_LOCATION_TYPE_LABELS: Record<ObjectLocationType, string> = {
  pinpoint: "Exakt position",
  area: "Område",
  none: "Ingen geografi",
};

// Kategoriskt-neutrala tema-tokens (inga warning/destructive — det är inte feltillstånd).
export const OBJECT_LOCATION_TYPE_BADGE_CLASS: Record<ObjectLocationType, string> = {
  pinpoint: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  area: "bg-chart-4/15 text-chart-4 border border-chart-4/30",
  none: "bg-muted text-muted-foreground border border-border",
};

interface LocatableLike {
  latitude?: number | null;
  longitude?: number | null;
  entranceLatitude?: number | null;
  entranceLongitude?: number | null;
  polylineData?: unknown;
  locationType?: string | null;
}

function usable(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat !== 0 &&
    typeof lng === "number" && Number.isFinite(lng) && lng !== 0
  );
}

/** Effektiv platstyp: explicit kolumnvärde vinner, annars härleds från geografi. */
export function effectiveObjectLocationType(obj: LocatableLike): ObjectLocationType {
  if (obj.locationType && (OBJECT_LOCATION_TYPES as readonly string[]).includes(obj.locationType)) {
    return obj.locationType as ObjectLocationType;
  }
  if (usable(obj.latitude, obj.longitude) || usable(obj.entranceLatitude, obj.entranceLongitude)) {
    return "pinpoint";
  }
  if (obj.polylineData != null) return "area";
  return "none";
}

export function objectLocationTypeLabel(obj: LocatableLike): string {
  return OBJECT_LOCATION_TYPE_LABELS[effectiveObjectLocationType(obj)];
}

export function objectLocationTypeBadgeClass(obj: LocatableLike): string {
  return OBJECT_LOCATION_TYPE_BADGE_CLASS[effectiveObjectLocationType(obj)];
}
