import { Fragment, memo, useMemo, useState, useCallback, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DoorOpen, Key, Keyboard, Users, PenTool, Save, Undo, X, MapPin } from "lucide-react";
import type { ServiceObject } from "@shared/schema";
import { useMapConfig } from "@/hooks/use-map-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

const vertexIcon = L.divIcon({
  className: "polyline-vertex",
  html: '<div style="width:10px;height:10px;border-radius:50%;background:#4A9B9B;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

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

type DrawMode = "polygon" | "polyline";

interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "LineString";
    coordinates: number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

function DrawClickHandler({ onAddPoint }: { onAddPoint: (latlng: L.LatLng) => void }) {
  useMapEvents({
    click(e) {
      onAddPoint(e.latlng);
    },
  });
  return null;
}

function DrawToggleControl({ active, onClick }: { active: boolean; onClick: () => void }) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const zoomControl = container.querySelector(".leaflet-control-zoom");
    if (!zoomControl) return;

    const existing = container.querySelector(".polyline-draw-btn");
    if (existing) existing.remove();

    const btn = L.DomUtil.create("div", "polyline-draw-btn");
    btn.style.cssText = `
      width: 30px; height: 30px;
      background: ${active ? "#4A9B9B" : "white"};
      border: 2px solid rgba(0,0,0,0.2);
      border-top: none;
      border-radius: 0 0 4px 4px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: background 0.15s;
    `;
    btn.title = "Rita yta / polylinje";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${active ? "white" : "#333"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/>
      <path d="M12 12l8-4.5"/>
      <path d="M12 12v9"/>
      <path d="M12 12L4 7.5"/>
    </svg>`;

    btn.addEventListener("mouseenter", () => {
      if (!active) btn.style.background = "#f4f4f5";
    });
    btn.addEventListener("mouseleave", () => {
      if (!active) btn.style.background = "white";
    });

    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, "click", () => onClick());

    const zoomParent = zoomControl.parentElement;
    if (!zoomParent) return;
    zoomParent.insertBefore(btn, zoomControl.nextSibling);
    btn.style.marginTop = "-2px";
    btn.style.position = "relative";

    return () => {
      btn.remove();
    };
  }, [map, active, onClick]);

  return null;
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

export const ObjectsMapTab = memo(function ObjectsMapTab({ 
  objectsWithCoords, 
  mapPositions, 
  defaultCenter,
  selectedObjectIds,
}: { 
  objectsWithCoords: ServiceObject[];
  mapPositions: [number, number][];
  defaultCenter: [number, number];
  selectedObjectIds?: Set<string>;
}) {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const [drawing, setDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("polygon");
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const [targetObjectId, setTargetObjectId] = useState<string>("");

  const autoTargetId = useMemo(() => {
    if (selectedObjectIds && selectedObjectIds.size === 1) {
      return Array.from(selectedObjectIds)[0];
    }
    return "";
  }, [selectedObjectIds]);

  useEffect(() => {
    if (autoTargetId) {
      setTargetObjectId(autoTargetId);
    }
  }, [autoTargetId]);

  const handleToggleDraw = useCallback(() => {
    if (drawing) {
      setDrawing(false);
      setPoints([]);
    } else {
      setDrawing(true);
      setPoints([]);
      if (autoTargetId) {
        setTargetObjectId(autoTargetId);
      } else {
        setTargetObjectId("");
      }
    }
  }, [drawing, autoTargetId]);

  const handleAddPoint = useCallback((latlng: L.LatLng) => {
    setPoints(prev => [...prev, latlng]);
  }, []);

  const handleUndo = useCallback(() => {
    setPoints(prev => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    if (!drawing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        handleUndo();
      }
      if (e.key === "Escape") {
        setDrawing(false);
        setPoints([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawing, handleUndo]);

  const saveMutation = useMutation({
    mutationFn: async ({ objectId, geoJson }: { objectId: string; geoJson: GeoJSONFeature }) => {
      return apiRequest("PUT", `/api/objects/${objectId}/polyline`, { polylineData: geoJson });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Yta sparad", description: "Polylinjen har sparats på objektet." });
      setDrawing(false);
      setPoints([]);
    },
    onError: () => {
      toast({ title: "Kunde inte spara", variant: "destructive" });
    },
  });

  const handleSave = useCallback(() => {
    if (!targetObjectId) {
      toast({ title: "Välj ett objekt", description: "Du måste välja vilket objekt ytan ska kopplas till.", variant: "destructive" });
      return;
    }
    if (drawMode === "polygon" && points.length < 3) {
      toast({ title: "Minst 3 punkter krävs för polygon", variant: "destructive" });
      return;
    }
    if (drawMode === "polyline" && points.length < 2) {
      toast({ title: "Minst 2 punkter krävs för polylinje", variant: "destructive" });
      return;
    }

    const coords = points.map(p => [p.lng, p.lat]);
    const targetObj = objectsWithCoords.find(o => o.id === targetObjectId);

    const geoJson = {
      type: "Feature",
      geometry: drawMode === "polygon"
        ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
        : { type: "LineString", coordinates: coords },
      properties: { objectId: targetObjectId, objectName: targetObj?.name || "" },
    };

    saveMutation.mutate({ objectId: targetObjectId, geoJson });
  }, [targetObjectId, drawMode, points, objectsWithCoords, saveMutation, toast]);

  const canSave = drawMode === "polygon" ? points.length >= 3 : points.length >= 2;

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      {drawing && (
        <div className="px-3 py-2 bg-muted/60 border-b flex items-center gap-2 flex-wrap" data-testid="draw-toolbar">
          <div className="flex items-center gap-1.5">
            <PenTool className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Ritläge</span>
          </div>
          <Select value={drawMode} onValueChange={(v) => setDrawMode(v as DrawMode)}>
            <SelectTrigger className="w-[120px] h-7 text-xs" data-testid="select-draw-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="polygon">Polygon</SelectItem>
              <SelectItem value="polyline">Polylinje</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="text-xs">
            {points.length} punkter
          </Badge>
          <div className="h-4 w-px bg-border" />
          <Select value={targetObjectId} onValueChange={setTargetObjectId}>
            <SelectTrigger className="w-[200px] h-7 text-xs" data-testid="select-target-object">
              <SelectValue placeholder="Välj objekt..." />
            </SelectTrigger>
            <SelectContent>
              {objectsWithCoords.map(obj => (
                <SelectItem key={obj.id} value={obj.id}>{obj.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleUndo} disabled={points.length === 0} data-testid="button-undo-point">
            <Undo className="w-3 h-3 mr-1" />
            Ångra
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!canSave || saveMutation.isPending || !targetObjectId} data-testid="button-save-polyline">
            <Save className="w-3 h-3 mr-1" />
            Spara
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDrawing(false); setPoints([]); }} data-testid="button-cancel-draw">
            <X className="w-3 h-3 mr-1" />
            Avbryt
          </Button>
          <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            Klicka på kartan · Ctrl+Z ångra · Esc avbryt
          </div>
        </div>
      )}
      <div className="h-[500px]">
        <div className="p-0 h-full relative">
          <MapContainer
            center={defaultCenter}
            zoom={13}
            style={{ height: "100%", width: "100%", cursor: drawing ? "crosshair" : "" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution={mapConfig.attribution}
              url={mapConfig.tileUrl}
            />
            <DrawToggleControl active={drawing} onClick={handleToggleDraw} />
            {drawing && <DrawClickHandler onAddPoint={handleAddPoint} />}
            {!drawing && mapPositions.length > 0 && <MapFitBounds positions={mapPositions} />}

            {objectsWithCoords.map(obj => (
              <Fragment key={obj.id}>
                <Marker
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
                {obj.polylineData && (() => {
                  const geo = obj.polylineData as GeoJSONFeature | null;
                  if (!geo?.geometry) return null;
                  const { type, coordinates } = geo.geometry;
                  if (type === "Polygon" && coordinates?.[0]) {
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
                })()}
              </Fragment>
            ))}

            <PolylineLabels objects={objectsWithCoords} />

            {drawing && points.length > 0 && drawMode === "polygon" && points.length >= 3 && (
              <Polygon
                positions={points.map(p => [p.lat, p.lng])}
                pathOptions={{ color: "#4A9B9B", fillColor: "#4A9B9B", fillOpacity: 0.2, weight: 2, dashArray: "6 4" }}
              />
            )}
            {drawing && points.length > 0 && (drawMode === "polyline" || points.length < 3) && (
              <Polyline
                positions={points.map(p => [p.lat, p.lng])}
                pathOptions={{ color: "#4A9B9B", weight: 3, dashArray: "6 4" }}
              />
            )}
            {drawing && points.map((point, idx) => (
              <Marker key={`vertex-${idx}`} position={[point.lat, point.lng]} icon={vertexIcon} />
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
            {objectsWithCoords.some(o => o.polylineData) && (
              <>
                <div className="h-px bg-border my-1" />
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: "#4A9B9B" }}></span>
                  <span>Yta / Polylinje</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
