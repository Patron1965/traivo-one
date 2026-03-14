import { Fragment, memo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DoorOpen, Key, Keyboard, Users } from "lucide-react";
import type { ServiceObject } from "@shared/schema";
import { useMapConfig } from "@/hooks/use-map-config";

const objectTypeLabels: Record<string, string> = {
  omrade: "Område",
  fastighet: "Fastighet",
  serviceboende: "Serviceboende",
  rum: "Rum",
  soprum: "Soprum",
  kok: "Kök",
  uj_hushallsavfall: "UJ Hushållsavfall",
  matafall: "Matavfall",
  atervinning: "Återvinning",
};

const accessTypeLabels: Record<string, { label: string; icon: typeof Key }> = {
  open: { label: "Öppet", icon: DoorOpen },
  code: { label: "Kod", icon: Keyboard },
  key: { label: "Nyckel/bricka", icon: Key },
  meeting: { label: "Personligt möte", icon: Users },
};

const getAccessColor = (type: string) => {
  switch (type) {
    case "open": return "#22c55e";
    case "code": return "#3b82f6";
    case "key": return "#f97316";
    case "meeting": return "#ef4444";
    default: return "#6b7280";
  }
};

const createAccessIcon = (accessType: string) => {
  const color = getAccessColor(accessType);
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 10px;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

export function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  if (positions.length > 0) {
    const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
  return null;
}

export function BatchGeoMapFitter({ objects }: { objects: ServiceObject[] }) {
  const map = useMap();
  const positions: L.LatLng[] = [];
  for (const o of objects) {
    if (o.latitude && o.longitude) {
      positions.push(L.latLng(o.latitude, o.longitude));
    }
    if (o.entranceLatitude && o.entranceLongitude) {
      positions.push(L.latLng(o.entranceLatitude, o.entranceLongitude));
    }
  }
  if (positions.length > 0) {
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [30, 30] });
  }
  return null;
}

export const GeocodedObjectsMap = memo(function GeocodedObjectsMap({ objects }: { objects: Array<{ id: string; name: string; address?: string | null; latitude?: number | null; longitude?: number | null; entranceLatitude?: number | null; entranceLongitude?: number | null }> }) {
  const mapConfig = useMapConfig();
  const validObjects = objects.filter(o => o.latitude && o.longitude);
  if (validObjects.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div style={{ background: "#3b82f6", borderRadius: "50%", width: 10, height: 10, border: "1px solid white" }} />
          Koordinater ({validObjects.length})
        </div>
        <div className="flex items-center gap-1">
          <div style={{ background: "#22c55e", borderRadius: "3px", width: 10, height: 10, border: "1px solid white" }} />
          Entrékoordinater ({validObjects.filter(o => o.entranceLatitude).length})
        </div>
      </div>
      <div className="rounded-lg overflow-hidden border" style={{ height: "420px" }}>
        <MapContainer
          center={[62.39, 17.31]}
          zoom={12}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution={mapConfig.attribution}
            url={mapConfig.tileUrl}
          />
          <BatchGeoMapFitter objects={validObjects as any} />
          {validObjects.map((obj) => (
            <Fragment key={obj.id}>
              <Marker
                position={[obj.latitude!, obj.longitude!]}
                icon={L.divIcon({
                  className: "batch-geo-marker",
                  html: `<div style="background:#3b82f6;color:white;border-radius:50%;width:12px;height:12px;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
                  iconSize: [12, 12],
                  iconAnchor: [6, 6],
                })}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-medium">{obj.name}</div>
                    {obj.address && <div className="text-muted-foreground">{obj.address}</div>}
                    {obj.entranceLatitude && (
                      <div className="text-green-600 text-xs mt-1 flex items-center gap-1">
                        <DoorOpen className="h-3 w-3" /> Entrékoordinater
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
              {obj.entranceLatitude && obj.entranceLongitude && (
                <Marker
                  position={[obj.entranceLatitude, obj.entranceLongitude]}
                  icon={L.divIcon({
                    className: "batch-geo-entrance-marker",
                    html: `<div style="background:#22c55e;color:white;border-radius:4px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/></svg></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7],
                  })}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-medium text-green-600">Entré: {obj.name}</div>
                      {obj.address && <div className="text-muted-foreground">{obj.address}</div>}
                    </div>
                  </Popup>
                </Marker>
              )}
            </Fragment>
          ))}
        </MapContainer>
      </div>
    </div>
  );
});

export const ObjectsMapTab = memo(function ObjectsMapTab({ 
  objectsWithCoords, 
  mapPositions, 
  defaultCenter 
}: { 
  objectsWithCoords: ServiceObject[];
  mapPositions: [number, number][];
  defaultCenter: [number, number];
}) {
  const mapConfig = useMapConfig();
  return (
    <div className="h-[500px] overflow-hidden rounded-md border bg-card">
      <div className="p-0 h-full relative">
        <MapContainer
          center={defaultCenter}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution={mapConfig.attribution}
            url={mapConfig.tileUrl}
          />
          {mapPositions.length > 0 && <MapFitBounds positions={mapPositions} />}
          {objectsWithCoords.map(obj => (
            <Marker
              key={obj.id}
              position={[obj.latitude!, obj.longitude!]}
              icon={createAccessIcon(obj.accessType || "open")}
            >
              <Popup>
                <div className="p-1">
                  <div className="font-medium">{obj.name}</div>
                  <div className="text-sm text-gray-600">{obj.address}, {obj.city}</div>
                  <div className="text-sm mt-1">
                    <span className="font-medium">Typ:</span> {objectTypeLabels[obj.objectType]}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Tillgång:</span> {accessTypeLabels[obj.accessType || "open"]?.label}
                    {obj.accessCode && ` (${obj.accessCode})`}
                  </div>
                  {obj.avgSetupTime && obj.avgSetupTime > 0 && (
                    <div className="text-sm">
                      <span className="font-medium">Ställtid:</span> {obj.avgSetupTime} min
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm rounded-md shadow-md p-3 space-y-1.5 z-[1000]">
          <div className="text-xs font-medium">Tillgångstyp</div>
          {Object.entries(accessTypeLabels).map(([key, config]) => (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getAccessColor(key) }}></span>
              <span>{config.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
