import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServiceObject } from "@shared/schema";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PenTool, Trash2, Save, Undo, MapPin, Layers } from "lucide-react";

interface PolylineEditorProps {
  object: ServiceObject;
  onSaved?: () => void;
}

type DrawMode = "polygon" | "polyline";

interface GeoJSONData {
  type: "Feature";
  geometry: {
    type: "Polygon" | "LineString";
    coordinates: number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

function DrawControl({
  drawing,
  points,
  onAddPoint,
  onRemoveLastPoint,
}: {
  drawing: boolean;
  points: L.LatLng[];
  onAddPoint: (latlng: L.LatLng) => void;
  onRemoveLastPoint: () => void;
}) {
  useMapEvents({
    click(e) {
      if (drawing) {
        onAddPoint(e.latlng);
      }
    },
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && drawing) {
        onRemoveLastPoint();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawing, onRemoveLastPoint]);

  return null;
}

export function PolylineEditor({ object, onSaved }: PolylineEditorProps) {
  const { toast } = useToast();
  const [drawing, setDrawing] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("polygon");
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const mapRef = useRef<L.Map | null>(null);

  const { data: polylineResponse } = useQuery<{ polylineData: GeoJSONData | null }>({
    queryKey: ["/api/objects", object.id, "polyline"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${object.id}/polyline`);
      return res.json();
    },
  });

  const existingData = polylineResponse?.polylineData;

  useEffect(() => {
    if (existingData?.geometry) {
      const coords = existingData.geometry.coordinates;
      if (existingData.geometry.type === "Polygon" && Array.isArray(coords[0])) {
        const ring = coords[0] as number[][];
        setPoints(ring.map((c: number[]) => L.latLng(c[1], c[0])));
        setDrawMode("polygon");
      } else if (existingData.geometry.type === "LineString") {
        const line = coords as number[][];
        setPoints(line.map((c: number[]) => L.latLng(c[1], c[0])));
        setDrawMode("polyline");
      }
    }
  }, [existingData]);

  const saveMutation = useMutation({
    mutationFn: async (geoJson: GeoJSONData | null) => {
      return apiRequest("PUT", `/api/objects/${object.id}/polyline`, { polylineData: geoJson });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", object.id, "polyline"] });
      toast({ title: "Yta sparad" });
      setDrawing(false);
      onSaved?.();
    },
    onError: () => {
      toast({ title: "Kunde inte spara yta", variant: "destructive" });
    },
  });

  const handleAddPoint = useCallback((latlng: L.LatLng) => {
    setPoints(prev => [...prev, latlng]);
  }, []);

  const handleRemoveLastPoint = useCallback(() => {
    setPoints(prev => prev.slice(0, -1));
  }, []);

  const handleSave = () => {
    if (points.length < 3 && drawMode === "polygon") {
      toast({ title: "Minst 3 punkter krävs för polygon", variant: "destructive" });
      return;
    }
    if (points.length < 2 && drawMode === "polyline") {
      toast({ title: "Minst 2 punkter krävs för polylinje", variant: "destructive" });
      return;
    }

    const coords = points.map(p => [p.lng, p.lat]);

    const geoJson: GeoJSONData = {
      type: "Feature",
      geometry: drawMode === "polygon"
        ? { type: "Polygon", coordinates: [[...coords, coords[0]]] }
        : { type: "LineString", coordinates: coords },
      properties: { objectId: object.id, objectName: object.name },
    };

    saveMutation.mutate(geoJson);
  };

  const handleClear = () => {
    setPoints([]);
    saveMutation.mutate(null);
  };

  const center: [number, number] = object.latitude && object.longitude
    ? [object.latitude, object.longitude]
    : [59.3293, 18.0686];

  const vertexIcon = L.divIcon({
    className: "polyline-vertex",
    html: '<div style="width:10px;height:10px;border-radius:50%;background:#4A9B9B;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Yta / Polylinje
          </CardTitle>
          <div className="flex items-center gap-2">
            {existingData && (
              <Badge variant="outline" className="text-xs">
                {existingData.geometry?.type === "Polygon" ? "Polygon" : "Polylinje"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
          {!drawing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setDrawing(true); setPoints([]); }}
                data-testid="button-start-draw"
              >
                <PenTool className="w-4 h-4 mr-1" />
                Rita yta
              </Button>
              {points.length > 0 && (
                <Button size="sm" variant="destructive" onClick={handleClear} data-testid="button-clear-polyline">
                  <Trash2 className="w-4 h-4 mr-1" />
                  Radera
                </Button>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Typ:</Label>
                <Select value={drawMode} onValueChange={(v) => setDrawMode(v as DrawMode)}>
                  <SelectTrigger className="w-[120px] h-8" data-testid="select-draw-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="polygon">Polygon</SelectItem>
                    <SelectItem value="polyline">Polylinje</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Badge variant="secondary" className="text-xs">
                {points.length} punkter
              </Badge>
              <Button size="sm" variant="outline" onClick={handleRemoveLastPoint} disabled={points.length === 0} data-testid="button-undo-point">
                <Undo className="w-4 h-4 mr-1" />
                Ångra
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveMutation.isPending || (drawMode === "polygon" ? points.length < 3 : points.length < 2)}
                data-testid="button-save-polyline"
              >
                <Save className="w-4 h-4 mr-1" />
                Spara
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setDrawing(false); }} data-testid="button-cancel-draw">
                Avbryt
              </Button>
            </>
          )}
        </div>

        <div className="h-[300px] w-full" data-testid="polyline-map">
          <MapContainer
            center={center}
            zoom={15}
            style={{ height: "100%", width: "100%" }}
            ref={mapRef}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <DrawControl
              drawing={drawing}
              points={points}
              onAddPoint={handleAddPoint}
              onRemoveLastPoint={handleRemoveLastPoint}
            />

            {object.latitude && object.longitude && (
              <Marker
                position={[object.latitude, object.longitude]}
                icon={L.divIcon({
                  className: "object-center-marker",
                  html: '<div style="width:14px;height:14px;border-radius:50%;background:#1B4B6B;border:3px solid white;box-shadow:0 0 6px rgba(0,0,0,0.4)"></div>',
                  iconSize: [14, 14],
                  iconAnchor: [7, 7],
                })}
              />
            )}

            {points.length > 0 && drawMode === "polygon" && points.length >= 3 && (
              <Polygon
                positions={points.map(p => [p.lat, p.lng])}
                pathOptions={{ color: "#4A9B9B", fillColor: "#4A9B9B", fillOpacity: 0.2, weight: 2 }}
              />
            )}

            {points.length > 0 && (drawMode === "polyline" || points.length < 3) && (
              <Polyline
                positions={points.map(p => [p.lat, p.lng])}
                pathOptions={{ color: "#4A9B9B", weight: 3 }}
              />
            )}

            {drawing && points.map((point, idx) => (
              <Marker key={idx} position={[point.lat, point.lng]} icon={vertexIcon} />
            ))}
          </MapContainer>
        </div>

        {drawing && (
          <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/50">
            <MapPin className="w-3 h-3 inline mr-1" />
            Klicka på kartan för att lägga till punkter. Ctrl+Z för att ångra. Minst {drawMode === "polygon" ? "3" : "2"} punkter krävs.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
