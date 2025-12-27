import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap, Popup, CircleMarker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin, Navigation } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface ResourcePosition {
  id: string;
  resourceId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  status: string;
  workOrderId?: string;
  timestamp: string;
}

interface ResourceTrackingMapProps {
  resourceId: string;
  resourceName: string;
  date?: Date;
  showCurrentPosition?: boolean;
  className?: string;
}

const createResourceIcon = (status: string) => {
  const color = status === "on_job" ? "#22c55e" : status === "traveling" ? "#3b82f6" : "#6b7280";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
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

export function ResourceTrackingMap({ 
  resourceId, 
  resourceName, 
  date,
  showCurrentPosition = true,
  className = "h-96"
}: ResourceTrackingMapProps) {
  const dateParam = date ? format(date, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  
  const { data: positions, isLoading } = useQuery<ResourcePosition[]>({
    queryKey: ["/api/resources", resourceId, "positions", dateParam],
    queryFn: async () => {
      const res = await fetch(`/api/resources/${resourceId}/positions?date=${dateParam}`);
      if (!res.ok) throw new Error("Failed to fetch positions");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const polylinePositions = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    return positions.map(p => [p.latitude, p.longitude] as [number, number]);
  }, [positions]);

  const latestPosition = useMemo(() => {
    if (!positions || positions.length === 0) return null;
    return positions[positions.length - 1];
  }, [positions]);

  if (isLoading) {
    return (
      <Card className={`${className} flex items-center justify-center`}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <Card className={`${className} flex flex-col items-center justify-center gap-2`}>
        <MapPin className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Inga positioner registrerade</p>
        <p className="text-xs text-muted-foreground">{format(date || new Date(), "d MMMM yyyy", { locale: sv })}</p>
      </Card>
    );
  }

  const defaultCenter = polylinePositions[0];
  const statusLabels: Record<string, string> = {
    traveling: "Kör",
    on_job: "På jobb",
    idle: "Inaktiv",
    break: "Rast"
  };

  return (
    <Card className={`${className} overflow-hidden relative`}>
      <div className="absolute top-2 left-2 z-[1000] flex gap-1 flex-wrap">
        <Badge variant="secondary" className="text-xs">
          <Navigation className="h-3 w-3 mr-1" />
          {resourceName}
        </Badge>
        <Badge variant="outline" className="text-xs bg-background/90">
          {positions.length} positioner
        </Badge>
        {latestPosition && (
          <Badge 
            variant="outline" 
            className={`text-xs bg-background/90 ${
              latestPosition.status === "on_job" ? "border-green-500/50 text-green-600" :
              latestPosition.status === "traveling" ? "border-blue-500/50 text-blue-600" :
              "border-gray-500/50 text-gray-600"
            }`}
          >
            {statusLabels[latestPosition.status] || latestPosition.status}
          </Badge>
        )}
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
        
        <MapFitBounds positions={polylinePositions} />
        
        <Polyline
          positions={polylinePositions}
          pathOptions={{
            color: "#3b82f6",
            weight: 3,
            opacity: 0.8,
          }}
        />
        
        {positions.map((pos, idx) => {
          const isLatest = idx === positions.length - 1;
          const isFirst = idx === 0;
          
          if (isLatest && showCurrentPosition) {
            return (
              <Marker
                key={pos.id}
                position={[pos.latitude, pos.longitude]}
                icon={createResourceIcon(pos.status)}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">{resourceName}</p>
                    <p className="text-muted-foreground">
                      {statusLabels[pos.status] || pos.status}
                    </p>
                    {pos.speed !== undefined && pos.speed !== null && (
                      <p className="text-xs text-muted-foreground">
                        {Math.round(pos.speed)} km/h
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(pos.timestamp), "HH:mm:ss", { locale: sv })}
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          }
          
          if (isFirst) {
            return (
              <CircleMarker
                key={pos.id}
                center={[pos.latitude, pos.longitude]}
                radius={6}
                pathOptions={{
                  color: "#22c55e",
                  fillColor: "#22c55e",
                  fillOpacity: 0.8,
                  weight: 2
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">Startposition</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(pos.timestamp), "HH:mm:ss", { locale: sv })}
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          }
          
          return (
            <CircleMarker
              key={pos.id}
              center={[pos.latitude, pos.longitude]}
              radius={3}
              pathOptions={{
                color: pos.status === "on_job" ? "#22c55e" : "#3b82f6",
                fillColor: pos.status === "on_job" ? "#22c55e" : "#3b82f6",
                fillOpacity: 0.6,
                weight: 1
              }}
            />
          );
        })}
      </MapContainer>
    </Card>
  );
}
