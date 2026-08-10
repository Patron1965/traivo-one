import { useEffect, useMemo, useState, useCallback } from "react";
import { Marker, Popup } from "react-leaflet";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Wifi, WifiOff, Users } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { BaseMap, MapFitBounds, statusDivIcon, getResourceStatusColor } from "@/components/ui/map";
import { apiRequest, refetchActiveQueriesAfterReconnect } from "@/lib/queryClient";

const USER_SVG = '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';

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

const createResourceIcon = (status: string, isStale: boolean) =>
  statusDivIcon({
    color: getResourceStatusColor(status, isStale),
    svg: USER_SVG,
    size: 36,
    iconPx: 18,
    isStale,
  });

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
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Exponentiell backoff så vi inte hamrar servern vid längre avbrott.
    let reconnectAttempts = 0;
    let hadConnection = false;

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = Math.min(5000 * 2 ** reconnectAttempts, 60000);
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (closed) return;
      try {
        // WS-lagret kräver ett engångstoken (single-use, kort TTL) —
        // hämta ett nytt inför varje (åter)anslutning.
        const res = await apiRequest("POST", "/api/notifications/user-token", {});
        const { token } = await res.json();
        if (closed || !token) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}/ws/notifications?token=${token}`);
        
        ws.onopen = () => {
          setWsConnected(true);
          reconnectAttempts = 0;
          console.log('[LiveMap] WebSocket connected');
          if (hadConnection) {
            // Positionsuppdateringar kan ha missats under avbrottet — hämta ikapp.
            refetchActiveQueriesAfterReconnect();
          }
          hadConnection = true;
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
          scheduleReconnect();
        };
        
        ws.onerror = () => {
          setWsConnected(false);
        };
      } catch (e) {
        console.error('[LiveMap] WebSocket error:', e);
        scheduleReconnect();
      }
    };
    
    connect();
    
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
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
          className={`text-xs bg-background/90 ${wsConnected ? 'border-chart-2/50 text-chart-2' : 'border-destructive/50 text-destructive'}`}
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
      
      <BaseMap center={defaultCenter} zoom={10}>
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
                  <p className={`${isStale ? 'text-destructive' : 'text-muted-foreground'}`}>
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
      </BaseMap>
    </Card>
  );
}
