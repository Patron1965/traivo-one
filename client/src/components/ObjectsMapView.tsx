import { Fragment, memo, useMemo, useState, useCallback, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DoorOpen, Key, Keyboard, Users, PenTool, Save, Undo, X, MapPin, Check, FolderPlus } from "lucide-react";
import type { ServiceObject, Cluster } from "@shared/schema";
import { useMapConfig } from "@/hooks/use-map-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
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

interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "LineString";
    coordinates: number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

function pointInPolygon(lat: number, lng: number, polygon: L.LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat, xi = polygon[i].lng;
    const yj = polygon[j].lat, xj = polygon[j].lng;
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
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
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const [capturedObjects, setCapturedObjects] = useState<ServiceObject[]>([]);
  const [showClusterPanel, setShowClusterPanel] = useState(false);
  const [clusterName, setClusterName] = useState("");
  const [assignToExisting, setAssignToExisting] = useState("");

  const { data: existingClusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const handleToggleDraw = useCallback(() => {
    if (drawing) {
      setDrawing(false);
      setPoints([]);
      setCapturedObjects([]);
      setShowClusterPanel(false);
    } else {
      setDrawing(true);
      setPoints([]);
      setCapturedObjects([]);
      setShowClusterPanel(false);
      setClusterName("");
      setAssignToExisting("");
    }
  }, [drawing]);

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
        setCapturedObjects([]);
        setShowClusterPanel(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawing, handleUndo]);

  const handleConfirmSelection = useCallback(() => {
    if (points.length < 3) {
      toast({ title: "Minst 3 punkter krävs", description: "Rita en polygon med minst 3 punkter för att markera objekt.", variant: "destructive" });
      return;
    }
    const found = objectsWithCoords.filter(obj => {
      if (!obj.latitude || !obj.longitude) return false;
      return pointInPolygon(obj.latitude, obj.longitude, points);
    });
    if (found.length === 0) {
      toast({ title: "Inga objekt hittades", description: "Inga objekt finns inom det markerade området.", variant: "destructive" });
      return;
    }
    setCapturedObjects(found);
    setShowClusterPanel(true);
  }, [points, objectsWithCoords, toast]);

  const createClusterMutation = useMutation({
    mutationFn: async ({ name, objectIds }: { name: string; objectIds: string[] }) => {
      const cluster = await apiRequest("POST", "/api/clusters", { name, tenantId: "default-tenant" });
      const clusterData = await cluster.json();
      await apiRequest("POST", "/api/objects/bulk-assign-cluster", { objectIds, clusterId: clusterData.id });
      return clusterData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      toast({ title: "Kluster skapat", description: `"${data.name}" med ${capturedObjects.length} objekt.` });
      setDrawing(false);
      setPoints([]);
      setCapturedObjects([]);
      setShowClusterPanel(false);
    },
    onError: () => {
      toast({ title: "Kunde inte skapa kluster", variant: "destructive" });
    },
  });

  const assignClusterMutation = useMutation({
    mutationFn: async ({ clusterId, objectIds }: { clusterId: string; objectIds: string[] }) => {
      return apiRequest("POST", "/api/objects/bulk-assign-cluster", { objectIds, clusterId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      const clusterLabel = existingClusters.find(c => c.id === assignToExisting)?.name || "kluster";
      toast({ title: "Objekt tilldelade", description: `${capturedObjects.length} objekt tilldelade till "${clusterLabel}".` });
      setDrawing(false);
      setPoints([]);
      setCapturedObjects([]);
      setShowClusterPanel(false);
    },
    onError: () => {
      toast({ title: "Kunde inte tilldela kluster", variant: "destructive" });
    },
  });

  const handleCreateCluster = useCallback(() => {
    if (!clusterName.trim()) {
      toast({ title: "Ange ett klusternamn", variant: "destructive" });
      return;
    }
    createClusterMutation.mutate({ name: clusterName.trim(), objectIds: capturedObjects.map(o => o.id) });
  }, [clusterName, capturedObjects, createClusterMutation, toast]);

  const handleAssignExisting = useCallback(() => {
    if (!assignToExisting) {
      toast({ title: "Välj ett kluster", variant: "destructive" });
      return;
    }
    assignClusterMutation.mutate({ clusterId: assignToExisting, objectIds: capturedObjects.map(o => o.id) });
  }, [assignToExisting, capturedObjects, assignClusterMutation, toast]);

  const capturedIds = useMemo(() => new Set(capturedObjects.map(o => o.id)), [capturedObjects]);
  const isPending = createClusterMutation.isPending || assignClusterMutation.isPending;

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      {drawing && !showClusterPanel && (
        <div className="px-3 py-2 bg-muted/60 border-b flex items-center gap-2 flex-wrap" data-testid="draw-toolbar">
          <div className="flex items-center gap-1.5">
            <PenTool className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Markera objekt</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {points.length} punkter
          </Badge>
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleUndo} disabled={points.length === 0} data-testid="button-undo-point">
            <Undo className="w-3 h-3 mr-1" />
            Ångra
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleConfirmSelection} disabled={points.length < 3} data-testid="button-confirm-selection">
            <Check className="w-3 h-3 mr-1" />
            Markera
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setDrawing(false); setPoints([]); setCapturedObjects([]); setShowClusterPanel(false); }} data-testid="button-cancel-draw">
            <X className="w-3 h-3 mr-1" />
            Avbryt
          </Button>
          <div className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            Rita polygon runt objekt · Ctrl+Z ångra · Esc avbryt
          </div>
        </div>
      )}
      {showClusterPanel && capturedObjects.length > 0 && (
        <div className="px-3 py-3 bg-muted/60 border-b space-y-3" data-testid="cluster-panel">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">{capturedObjects.length} objekt markerade</span>
            </div>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowClusterPanel(false); setCapturedObjects([]); setPoints([]); setDrawing(false); }} data-testid="button-close-cluster-panel">
              <X className="w-3 h-3 mr-1" />
              Stäng
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {capturedObjects.map(obj => (
              <Badge key={obj.id} variant="outline" className="text-xs" data-testid={`badge-selected-${obj.id}`}>
                {obj.name}
              </Badge>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Skapa nytt kluster</div>
              <div className="flex gap-2">
                <Input
                  placeholder="Klusternamn..."
                  value={clusterName}
                  onChange={(e) => setClusterName(e.target.value)}
                  className="h-8 text-sm"
                  data-testid="input-cluster-name"
                />
                <Button size="sm" className="h-8 text-xs whitespace-nowrap" onClick={handleCreateCluster} disabled={!clusterName.trim() || isPending} data-testid="button-create-cluster">
                  <FolderPlus className="w-3 h-3 mr-1" />
                  Skapa
                </Button>
              </div>
            </div>
            {existingClusters.length > 0 && (
              <div className="flex-1 space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Eller tilldela befintligt</div>
                <div className="flex gap-2">
                  <Select value={assignToExisting} onValueChange={setAssignToExisting}>
                    <SelectTrigger className="h-8 text-sm" data-testid="select-existing-cluster">
                      <SelectValue placeholder="Välj kluster..." />
                    </SelectTrigger>
                    <SelectContent>
                      {existingClusters.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="h-8 text-xs whitespace-nowrap" onClick={handleAssignExisting} disabled={!assignToExisting || isPending} data-testid="button-assign-cluster">
                    <Check className="w-3 h-3 mr-1" />
                    Tilldela
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="h-[500px]">
        <div className="p-0 h-full relative">
          <MapContainer
            center={defaultCenter}
            zoom={13}
            style={{ height: "100%", width: "100%", cursor: drawing && !showClusterPanel ? "crosshair" : "" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution={mapConfig.attribution}
              url={mapConfig.tileUrl}
            />
            <DrawToggleControl active={drawing} onClick={handleToggleDraw} />
            {drawing && !showClusterPanel && <DrawClickHandler onAddPoint={handleAddPoint} />}
            {!drawing && mapPositions.length > 0 && <MapFitBounds positions={mapPositions} />}

            {objectsWithCoords.map(obj => (
              <Fragment key={obj.id}>
                <Marker
                  position={[obj.latitude!, obj.longitude!]}
                  icon={capturedIds.has(obj.id) ? createHighlightedIcon() : createAccessIcon(obj.accessType || "open")}
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

            {points.length >= 3 && (
              <Polygon
                positions={points.map(p => [p.lat, p.lng])}
                pathOptions={{
                  color: showClusterPanel ? "#f59e0b" : "#4A9B9B",
                  fillColor: showClusterPanel ? "#f59e0b" : "#4A9B9B",
                  fillOpacity: showClusterPanel ? 0.1 : 0.2,
                  weight: 2,
                  dashArray: showClusterPanel ? undefined : "6 4",
                }}
              />
            )}
            {drawing && points.length > 0 && points.length < 3 && (
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
