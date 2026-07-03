import { Badge } from "@/components/ui/badge";
import { MapPin, MapPinOff, AlertTriangle } from "lucide-react";
import { resolveLocationRequirement } from "@shared/location-requirement";

interface LocationRequirementBadgeProps {
  order: { locationRequirement?: string | null; taskCategory?: string | null; objectId?: string | null };
  /** Kompakt variant (WeekPlanner JobCard) med mindre text/ikoner. */
  compact?: boolean;
  /** Visa även "Ingen plats" (default av — överlappar oftast admin/logistik-badge). */
  showNone?: boolean;
  testIdSuffix?: string;
}

/**
 * §5 A — visar effektivt platskrav (obligatorisk/valfri/ingen) för en arbetsorder.
 * Normalfallet (obligatorisk + har objekt) renderas utan badge. Saknad plats på en
 * platsobligatorisk uppgift ger en icke-blockerande varning (bg-warning) — detta är
 * "steg 5"-varningen, ingen hård spärr.
 */
export function LocationRequirementBadge({
  order,
  compact = false,
  showNone = false,
  testIdSuffix,
}: LocationRequirementBadgeProps) {
  const req = resolveLocationRequirement(order);
  const hasLocation = !!order.objectId;
  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";
  const iconSize = compact ? "h-2.5 w-2.5" : "h-3 w-3";
  const base = compact ? "text-[9px] h-4 gap-0.5 mt-0.5" : "text-xs gap-1";

  if (req === "obligatorisk" && !hasLocation) {
    return (
      <Badge
        variant="outline"
        className={`${base} bg-warning/10 text-warning border-warning/30 dark:bg-warning/15 dark:border-warning/70`}
        data-testid={`badge-location-missing${suffix}`}
      >
        <AlertTriangle className={iconSize} />
        Plats saknas
      </Badge>
    );
  }

  if (req === "valfri") {
    return (
      <Badge variant="outline" className={base} data-testid={`badge-location-optional${suffix}`}>
        <MapPin className={iconSize} />
        Plats valfri
      </Badge>
    );
  }

  if (req === "ingen" && showNone) {
    return (
      <Badge variant="outline" className={`${base} text-muted-foreground`} data-testid={`badge-location-none${suffix}`}>
        <MapPinOff className={iconSize} />
        Ingen plats
      </Badge>
    );
  }

  return null;
}
