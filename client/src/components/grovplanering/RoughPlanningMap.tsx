import { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { BaseMap, MapFitBounds, dotDivIcon } from "@/components/ui/map";
import { formatSekFromOre } from "@/lib/format";
import type { GeographicDistrict, RoughPlanningMapPoint, RoughPlanningSummary } from "@shared/schema";

const SWEDEN_CENTER: [number, number] = [59.3293, 18.0686];
const UNASSIGNED_COLOR = "#6B7C8C";

/** Tyngdpunktsmarkör — en tydlig "target"-ikon som sticker ut från punkterna. */
function tyngdpunktDivIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:26px;height:26px;border-radius:9999px;
      background:hsl(var(--primary));border:3px solid #fff;
      box-shadow:0 0 0 3px hsl(var(--primary)/0.35),0 1px 4px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;color:#fff;
      font-size:14px;font-weight:700;line-height:1;">★</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

interface RoughPlanningMapProps {
  points: RoughPlanningMapPoint[];
  tyngdpunkt: RoughPlanningSummary["tyngdpunkt"];
  districts: GeographicDistrict[];
}

export function RoughPlanningMap({ points, tyngdpunkt, districts }: RoughPlanningMapProps) {
  const colorByDistrict = useMemo(
    () => new Map(districts.map((d) => [d.id, d.color ?? "#3B82F6"])),
    [districts],
  );
  const nameByDistrict = useMemo(
    () => new Map(districts.map((d) => [d.id, d.name])),
    [districts],
  );

  const positions = useMemo<Array<[number, number]>>(() => {
    const arr: Array<[number, number]> = points.map((p) => [p.lat, p.lng]);
    if (tyngdpunkt) arr.push([tyngdpunkt.lat, tyngdpunkt.lng]);
    return arr;
  }, [points, tyngdpunkt]);

  const center: [number, number] = tyngdpunkt
    ? [tyngdpunkt.lat, tyngdpunkt.lng]
    : positions[0] ?? SWEDEN_CENTER;

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-md border" data-testid="map-grovplanering">
      <BaseMap center={center} zoom={9}>
        <MapFitBounds positions={positions} />
        {points.map((p) => {
          const color = p.districtId ? colorByDistrict.get(p.districtId) ?? UNASSIGNED_COLOR : UNASSIGNED_COLOR;
          const districtName = p.districtId ? nameByDistrict.get(p.districtId) ?? "Okänt distrikt" : "Utan distrikt";
          return (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={dotDivIcon({ color, size: 12 })}>
              <Popup>
                <div className="space-y-0.5 text-xs">
                  <div className="font-medium">{p.title || p.id.slice(0, 8)}</div>
                  {p.objectName && <div className="text-muted-foreground">{p.objectName}</div>}
                  <div className="text-muted-foreground">{districtName}</div>
                  <div>{formatSekFromOre(p.valueOre)}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        {tyngdpunkt && (
          <Marker
            position={[tyngdpunkt.lat, tyngdpunkt.lng]}
            icon={tyngdpunktDivIcon()}
            zIndexOffset={1000}
          >
            <Popup>
              <div className="space-y-0.5 text-xs">
                <div className="font-medium">Tyngdpunkt</div>
                {tyngdpunkt.nearestDistrictName && (
                  <div className="text-muted-foreground">
                    Närmaste ort: {tyngdpunkt.nearestDistrictName}
                  </div>
                )}
                <div className="text-muted-foreground">
                  {tyngdpunkt.pointCount} ordrar med koordinater
                </div>
              </div>
            </Popup>
          </Marker>
        )}
      </BaseMap>
    </div>
  );
}
