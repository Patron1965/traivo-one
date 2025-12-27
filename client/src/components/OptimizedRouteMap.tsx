import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Maximize2, Minimize2, X } from "lucide-react";

interface RouteStop {
  workOrderId: string;
  objectId: string;
  objectName: string;
  latitude?: number;
  longitude?: number;
  estimatedDuration: number;
}

interface OptimizedRouteMapProps {
  stops: RouteStop[];
  resourceName: string;
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

const createNumberedIcon = (number: number, isFirst: boolean, isLast: boolean) => {
  const color = isFirst ? "#22c55e" : isLast ? "#ef4444" : "#3b82f6";
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
      font-size: 11px;
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    ">${number}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [map, positions.length]);
  
  return null;
}

export function OptimizedRouteMap({ 
  stops, 
  resourceName, 
  onClose,
  expanded = false,
  onToggleExpand 
}: OptimizedRouteMapProps) {
  // Filter stops with valid coordinates and keep track of both positions and stop data
  const validStops = useMemo(() => {
    return stops.filter(s => s.latitude && s.longitude);
  }, [stops]);

  const positions = useMemo(() => {
    return validStops.map(s => [s.latitude!, s.longitude!] as [number, number]);
  }, [validStops]);

  if (positions.length === 0) {
    return (
      <Card className="p-4 text-center text-sm text-muted-foreground">
        Inga stopp med koordinater att visa
      </Card>
    );
  }

  const defaultCenter = positions[0];

  return (
    <Card className={`overflow-hidden ${expanded ? "fixed inset-4 z-50" : "h-64"}`}>
      <div className="absolute top-2 right-2 z-[1000] flex gap-1">
        {onToggleExpand && (
          <Button 
            size="icon" 
            variant="secondary" 
            className="h-7 w-7"
            onClick={onToggleExpand}
            data-testid="button-toggle-map-expand"
          >
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
        )}
        {onClose && (
          <Button 
            size="icon" 
            variant="secondary" 
            className="h-7 w-7"
            onClick={onClose}
            data-testid="button-close-map"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="absolute top-2 left-2 z-[1000]">
        <Badge variant="secondary" className="text-xs">
          {resourceName} - {validStops.length} stopp
        </Badge>
      </div>
      <MapContainer
        center={defaultCenter}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <MapFitBounds positions={positions} />
        
        <Polyline
          positions={positions}
          pathOptions={{
            color: "#3b82f6",
            weight: 3,
            opacity: 0.8,
            dashArray: "8, 4",
          }}
        />
        
        {validStops.map((stop, idx) => (
          <Marker
            key={stop.workOrderId}
            position={[stop.latitude!, stop.longitude!]}
            icon={createNumberedIcon(idx + 1, idx === 0, idx === validStops.length - 1)}
          />
        ))}
      </MapContainer>
    </Card>
  );
}
