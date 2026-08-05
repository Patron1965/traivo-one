import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import { Marker, Popup, Polygon, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DoorOpen, MapPinOff, ChevronDown, ChevronUp, List } from "lucide-react";
import type { ServiceObject } from "@shared/schema";
import { BaseMap } from "@/components/ui/map";

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

const createObjectIcon = () => {
  const color = "#4A9B9B";
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

function createHighlightedIcon() {
  return L.divIcon({
    className: "custom-marker-highlighted",
    html: `<div style="
      background-color: #f59e0b;
      color: white;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      border: 3px solid white;
      box-shadow: 0 0 0 2px #f59e0b, 0 2px 6px rgba(0,0,0,0.4);
    ">✓</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function createPolylineLabelIcon(name: string) {
  return L.divIcon({
    className: "polyline-label",
    html: `<div style="
      background: rgba(74,155,155,0.85);
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      pointer-events: none;
    ">${escapeHtml(name)}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, -4],
  });
}

function getPolygonCenter(coords: number[][]): [number, number] {
  let latSum = 0, lngSum = 0;
  for (const c of coords) {
    latSum += c[1];
    lngSum += c[0];
  }
  return [latSum / coords.length, lngSum / coords.length];
}

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
        <BaseMap center={[62.39, 17.31]} zoom={12}>
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
                      <div className="text-chart-2 text-xs mt-1 flex items-center gap-1">
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
                      <div className="font-medium text-chart-2">Entré: {obj.name}</div>
                      {obj.address && <div className="text-muted-foreground">{obj.address}</div>}
                    </div>
                  </Popup>
                </Marker>
              )}
            </Fragment>
          ))}
        </BaseMap>
      </div>
    </div>
  );
});

interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "LineString";
    coordinates: number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

function PolylineLabels({ objects }: { objects: ServiceObject[] }) {
  const labeled = useMemo(() => {
    return objects.filter(o => o.polylineData).map(obj => {
      const geo = obj.polylineData as GeoJSONFeature | null;
      if (!geo?.geometry) return null;
      const { type, coordinates } = geo.geometry;
      let center: [number, number] | null = null;
      if (type === "Polygon" && coordinates?.[0]) {
        const polyCoords = coordinates as number[][][];
        center = getPolygonCenter(polyCoords[0]);
      } else if (type === "LineString" && coordinates?.length > 0) {
        const lineCoords = coordinates as number[][];
        const mid = Math.floor(lineCoords.length / 2);
        center = [lineCoords[mid][1], lineCoords[mid][0]];
      }
      if (!center) return null;
      return { id: obj.id, name: obj.name, center };
    }).filter(Boolean) as { id: string; name: string; center: [number, number] }[];
  }, [objects]);

  return (
    <>
      {labeled.map(item => (
        <Marker
          key={`label-${item.id}`}
          position={item.center}
          icon={createPolylineLabelIcon(item.name)}
          interactive={false}
        />
      ))}
    </>
  );
}

// Task #1401: kartfliken tar emot effektiva positioner (egna ELLER entré-
// koordinater, beräknade i ObjectsPage via effectiveObjectPosition) samt en
// synlig lista över objekt som saknar koordinater — de försvinner inte tyst.
export interface MapObjectEntry {
  obj: ServiceObject;
  position: [number, number];
}

export const ObjectsMapTab = memo(function ObjectsMapTab({ 
  objectsWithCoords, 
  mapPositions, 
  defaultCenter,
  selectedObjectIds,
  missingCoordObjects = [],
  onOpenObject,
  onBackToList,
}: { 
  objectsWithCoords: MapObjectEntry[];
  mapPositions: [number, number][];
  defaultCenter: [number, number];
  selectedObjectIds?: Set<string>;
  missingCoordObjects?: ServiceObject[];
  onOpenObject?: (id: string) => void;
  onBackToList?: () => void;
}) {
  const [missingOpen, setMissingOpen] = useState(false);
  const totalInSelection = objectsWithCoords.length + missingCoordObjects.length;
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-3 text-sm">
          <span data-testid="text-map-shown-count">
            <span className="font-medium">{objectsWithCoords.length}</span> av {totalInSelection} objekt på kartan
          </span>
          {missingCoordObjects.length > 0 && (
            <button
              type="button"
              onClick={() => setMissingOpen(v => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
              data-testid="button-toggle-missing-coords"
            >
              <MapPinOff className="h-3.5 w-3.5" />
              {missingCoordObjects.length} saknar koordinater
              {missingOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
            data-testid="button-map-back-to-list"
          >
            <List className="h-3.5 w-3.5" />
            Tillbaka till listan
          </button>
        )}
      </div>
      {missingOpen && missingCoordObjects.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-b bg-muted/40 px-3 py-2" data-testid="panel-missing-coords">
          <div className="mb-1 text-xs text-muted-foreground">
            Dessa objekt har varken egna koordinater eller entrékoordinater och kan därför inte visas på kartan:
          </div>
          <ul className="space-y-0.5">
            {missingCoordObjects.map(o => (
              <li key={o.id} className="text-sm">
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => onOpenObject?.(o.id)}
                  data-testid={`link-missing-coords-${o.id}`}
                >
                  {o.name}
                </button>
                {o.address && <span className="ml-2 text-xs text-muted-foreground">{o.address}{o.city ? `, ${o.city}` : ""}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="h-[500px]">
        <div className="p-0 h-full relative">
          <BaseMap
            center={defaultCenter}
            zoom={13}
          >
            {mapPositions.length > 0 && <MapFitBounds positions={mapPositions} />}

            {objectsWithCoords.map(({ obj, position }) => (
              <Fragment key={obj.id}>
                <Marker
                  position={position}
                  icon={selectedObjectIds?.has(obj.id) ? createHighlightedIcon() : createObjectIcon()}
                >
                  <Popup>
                    <div className="p-1">
                      <div className="font-medium">{obj.name}</div>
                      <div className="text-sm text-gray-600">{obj.address}, {obj.city}</div>
                      <div className="text-sm mt-1">
                        <span className="font-medium">Typ:</span> {objectTypeLabels[obj.objectType] ?? obj.objectType}
                      </div>
                      {!(obj.latitude && obj.longitude) && (
                        <div className="text-chart-2 text-xs mt-1 flex items-center gap-1">
                          <DoorOpen className="h-3 w-3" /> Visar entrékoordinater
                        </div>
                      )}
                    </div>
                  </Popup>
                </Marker>
                {(obj.polylineData ? ((): ReactNode => {
                  const geo = obj.polylineData as GeoJSONFeature | null;
                  if (!geo?.geometry) return null;
                  const { type, coordinates } = geo.geometry as { type: string; coordinates: unknown };
                  if (type === "Polygon" && Array.isArray(coordinates) && (coordinates as unknown[])[0]) {
                    const polyCoords = coordinates as number[][][];
                    const positions = polyCoords[0].map((c) => [c[1], c[0]] as [number, number]);
                    return <Polygon positions={positions} pathOptions={{ color: "#4A9B9B", fillColor: "#4A9B9B", fillOpacity: 0.15, weight: 2 }} />;
                  }
                  if (type === "LineString" && coordinates) {
                    const lineCoords = coordinates as number[][];
                    const positions = lineCoords.map((c) => [c[1], c[0]] as [number, number]);
                    return <Polyline positions={positions} pathOptions={{ color: "#4A9B9B", weight: 3 }} />;
                  }
                  return null;
                })() : null) as ReactNode}
              </Fragment>
            ))}

            <PolylineLabels objects={objectsWithCoords.map(e => e.obj)} />

          </BaseMap>
          {objectsWithCoords.some(e => e.obj.polylineData) && (
            <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm rounded-md shadow-md p-3 space-y-1.5 z-[1000]">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: "#4A9B9B" }}></span>
                <span>Yta / Polylinje</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
