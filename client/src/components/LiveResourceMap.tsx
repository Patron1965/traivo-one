import { useEffect, useMemo, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMap, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Navigation, RefreshCw, Wifi, WifiOff, Users } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface ActiveResource {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  status: string | null;
  lastUpdate: string | null;
}

interface LiveResourceMapProps {
  className?: string;
  onResourceClick?: (resourceId: string) => void;
}

const createResourceIcon = (status: string, isStale: boolean) => {
  let color = "#6b7280";
  if (!isStale) {
    if (status === "on_job") color = "#22c55e";
    else if (status === "traveling") color = "#3b82f6";
    else if (status === "break") color = "#f59e0b";
  }
  
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background-color: ${color};
      color: white;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      ${isStale ? 'opacity: 0.5;' : ''}
    "><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, positions.length]);
  
  return null;
}

export function LiveResourceMap({ 
  className = "h-96",
  onResourceClick 
}: LiveResourceMapProps) {
  const [wsConnected, setWsConnected] = useState(false);
  const [livePositions, setLivePositions] = useState<Map<string, ActiveResource>>(new Map());

  const { data: resources, isLoading, refetch } = useQuery<ActiveResource[]>({
    queryKey: ["/api/resources/active-positions"],
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (resources) {
      const newPositions = new Map<string, ActiveResource>();
      resources.forEach(r => {
        if (r.latitude !== null && r.longitude !== null) {
          const existingLive = livePositions.get(r.id);
          if (existingLive && existingLive.lastUpdate && r.lastUpdate) {
            const existingTime = new Date(existingLive.lastUpdate).getTime();
            const newTime = new Date(r.lastUpdate).getTime();
            if (existingTime > newTime) {
              newPositions.set(r.id, existingLive);
              return;
            }
          }
          newPositions.set(r.id, r);
        }
      });
      setLivePositions(newPositions);
    }
  }, [resources]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    
    const connect = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/notifications`);
        
        ws.onopen = () => {
          setWsConnected(true);
          console.log('[LiveMap] WebSocket connected');
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'position_update') {
              setLivePositions(prev => {
                const updated = new Map(prev);
                const existing = updated.get(data.resourceId);
                // Preserve the existing name from API response, fallback to resourceId only if unknown
                updated.set(data.resourceId, {
                  id: data.resourceId,
                  name: existing?.name || data.resourceName || data.resourceId,
                  latitude: data.latitude,
                  longitude: data.longitude,
                  status: data.status,
                  lastUpdate: data.timestamp
                });
                return updated;
              });
            }
          } catch (e) {
            console.error('[LiveMap] Failed to parse message:', e);
          }
        };
        
        ws.onclose = () => {
          setWsConnected(false);
          setTimeout(connect, 5000);
        };
        
        ws.onerror = () => {
          setWsConnected(false);
        };
      } catch (e) {
        console.error('[LiveMap] WebSocket error:', e);
      }
    };
    
    connect();
    
    return () => {
      if (ws) ws.close();
    };
  }, []);

  const activeResources = useMemo(() => {
    return Array.from(livePositions.values());
  }, [livePositions]);

  const positions = useMemo(() => {
    return activeResources
      .filter(r => r.latitude !== null && r.longitude !== null)
      .map(r => [r.latitude!, r.longitude!] as [number, number]);
  }, [activeResources]);

  const isPositionStale = useCallback((lastUpdate: string | null) => {
    if (!lastUpdate) return true;
    const diff = Date.now() - new Date(lastUpdate).getTime();
    return diff > 10 * 60 * 1000;
  }, []);

  const statusLabels: Record<string, string> = {
    traveling: "Kör",
    on_job: "På jobb",
    idle: "Inaktiv",
    break: "Rast"
  };

  if (isLoading) {
    return (
      <Card className={`${className} flex items-center justify-center`}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const defaultCenter: [number, number] = positions.length > 0 
    ? positions[0] 
    : [63.8258, 20.2630];

  return (
    <Card className={`${className} overflow-hidden relative`}>
      <div className="absolute top-2 left-2 z-[1000] flex gap-1 flex-wrap">
        <Badge variant="secondary" className="text-xs">
          <Users className="h-3 w-3 mr-1" />
          {activeResources.length} resurser
        </Badge>
        <Badge 
          variant="outline" 
          className={`text-xs bg-background/90 ${wsConnected ? 'border-green-500/50 text-green-600' : 'border-red-500/50 text-red-600'}`}
        >
          {wsConnected ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
          {wsConnected ? 'Live' : 'Offline'}
        </Badge>
      </div>
      
      <div className="absolute top-2 right-2 z-[1000]">
        <Button 
          size="icon" 
          variant="secondary" 
          onClick={() => refetch()}
          data-testid="button-refresh-positions"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      
      <MapContainer
        center={defaultCenter}
        zoom={10}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {positions.length > 0 && <MapFitBounds positions={positions} />}
        
        {activeResources.map((resource) => {
          if (resource.latitude === null || resource.longitude === null) return null;
          
          const isStale = isPositionStale(resource.lastUpdate);
          
          return (
            <Marker
              key={resource.id}
              position={[resource.latitude, resource.longitude]}
              icon={createResourceIcon(resource.status || "idle", isStale)}
              eventHandlers={{
                click: () => onResourceClick?.(resource.id)
              }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-medium">{resource.name}</p>
                  <p className={`${isStale ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {statusLabels[resource.status || ""] || resource.status || "Okänd"}
                    {isStale && " (Inaktuell)"}
                  </p>
                  {resource.lastUpdate && (
                    <p className="text-xs text-muted-foreground">
                      Senast: {format(new Date(resource.lastUpdate), "HH:mm:ss", { locale: sv })}
                    </p>
                  )}
                  {onResourceClick && (
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="mt-2 w-full"
                      onClick={() => onResourceClick(resource.id)}
                      data-testid={`button-view-resource-${resource.id}`}
                    >
                      Visa historik
                    </Button>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </Card>
  );
}
