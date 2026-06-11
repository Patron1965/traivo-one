import { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import { BaseMap, MapFitBounds, dotDivIcon } from "@/components/ui/map";

export interface UnplannedTaskPin {
  id: string;
  lat: number;
  lng: number;
  title: string;
  reference?: string | null;
  address?: string | null;
}

const SWEDEN_CENTER: [number, number] = [59.3293, 18.0686];

interface UnplannedTasksMapProps {
  pins: UnplannedTaskPin[];
}

/**
 * Enkel grovplaneringskarta: en pin per ej planerad uppgift som har koordinater.
 * Ingen tyngdpunkt, inga distriktsfärger, inga värden — bara var uppgifterna är.
 */
export function UnplannedTasksMap({ pins }: UnplannedTasksMapProps) {
  const positions = useMemo<Array<[number, number]>>(
    () => pins.map((p) => [p.lat, p.lng]),
    [pins],
  );
  const center: [number, number] = positions[0] ?? SWEDEN_CENTER;

  return (
    <div
      className="h-[420px] w-full overflow-hidden rounded-md border"
      data-testid="map-grovplanering"
    >
      <BaseMap center={center} zoom={9}>
        <MapFitBounds positions={positions} />
        {pins.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lng]}
            icon={dotDivIcon({ color: "hsl(var(--primary))", size: 14 })}
          >
            <Popup>
              <div className="space-y-0.5 text-xs">
                {p.reference && (
                  <div className="text-muted-foreground">{p.reference}</div>
                )}
                <div className="font-medium">{p.title}</div>
                {p.address && (
                  <div className="text-muted-foreground">{p.address}</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </BaseMap>
    </div>
  );
}
