import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import {
  Play, Pause, SkipBack, SkipForward, Clock, MapPin, Navigation,
  CheckCircle2, Timer, TrendingUp, Users, Loader2, CalendarIcon, History
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  recordedAt: string;
}

interface Resource {
  id: string;
  name: string;
  role?: string;
}

interface DailyKPIs {
  date: string;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  completionRate: number;
  avgTimePerTaskMinutes: number;
  activeResources: number;
  resourceKpis: {
    resourceId: string;
    resourceName: string;
    totalTasks: number;
    completedTasks: number;
    remainingTasks: number;
    avgTimeMinutes: number;
  }[];
}

const createCurrentIcon = (status: string) => {
  const color = status === "on_site" ? "#22c55e" : status === "traveling" ? "#3b82f6" : "#6b7280";
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
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      animation: pulse 2s infinite;
    "><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></div>
    <style>@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}</style>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) {
      const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [40, 40] });
    } else if (positions.length === 1) {
      map.setView(positions[0], 14);
    }
  }, [map, positions.length]);
  return null;
}

const statusLabels: Record<string, string> = {
  traveling: "Kör",
  on_site: "På plats",
  on_job: "På jobb",
  idle: "Inaktiv",
  break: "Rast",
};

const statusColors: Record<string, string> = {
  traveling: "#3b82f6",
  on_site: "#22c55e",
  on_job: "#22c55e",
  idle: "#6b7280",
  break: "#f59e0b",
};

function safeFormatDate(dateStr: string, fmt: string, options?: { locale?: typeof sv }) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return format(d, fmt, options);
  } catch {
    return dateStr;
  }
}

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function HistoricalMapPage() {
  const [selectedDate, setSelectedDate] = useState(getToday);
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.title = "Traivo - Historisk Kartvy";
  }, []);

  const { data: resources } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: positions, isLoading: positionsLoading } = useQuery<ResourcePosition[]>({
    queryKey: ["/api/resources", selectedResourceId, "positions", selectedDate],
    queryFn: async () => {
      if (!selectedResourceId) return [];
      const res = await fetch(`/api/resources/${selectedResourceId}/positions?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to fetch positions");
      return res.json();
    },
    enabled: !!selectedResourceId,
  });

  const { data: kpis } = useQuery<DailyKPIs>({
    queryKey: ["/api/kpis/daily", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/kpis/daily?date=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to fetch KPIs");
      return res.json();
    },
  });

  const sortedPositions = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    return [...positions].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  }, [positions]);

  const allPositions = useMemo(
    () => sortedPositions.map(p => [p.latitude, p.longitude] as [number, number]),
    [sortedPositions]
  );

  const trailPositions = useMemo(
    () => allPositions.slice(0, playbackIndex + 1),
    [allPositions, playbackIndex]
  );

  const currentPosition = sortedPositions[playbackIndex] || null;

  useEffect(() => {
    setPlaybackIndex(sortedPositions.length > 0 ? sortedPositions.length - 1 : 0);
    setIsPlaying(false);
  }, [sortedPositions]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPlayback = useCallback(() => {
    if (sortedPositions.length === 0) return;
    if (playbackIndex >= sortedPositions.length - 1) {
      setPlaybackIndex(0);
    }
    setIsPlaying(true);
  }, [sortedPositions.length, playbackIndex]);

  useEffect(() => {
    if (isPlaying && sortedPositions.length > 0) {
      intervalRef.current = setInterval(() => {
        setPlaybackIndex(prev => {
          if (prev >= sortedPositions.length - 1) {
            stopPlayback();
            return prev;
          }
          return prev + 1;
        });
      }, 500 / playbackSpeed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, sortedPositions.length, stopPlayback]);

  const selectedResource = resources?.find(r => r.id === selectedResourceId);
  const resourceKpi = kpis?.resourceKpis?.find(r => r.resourceId === selectedResourceId);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]" data-testid="page-historical-map">
      <div className="flex items-center justify-between p-4 border-b flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold" data-testid="text-historical-map-title">Historisk Kartvy</h1>
            <p className="text-xs text-muted-foreground">Spela upp rörelsemönster för att utvärdera effektivitet</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="button-date-picker">
                    <CalendarIcon className="h-4 w-4" />
                    {safeFormatDate(selectedDate + "T12:00:00", "d MMMM yyyy", { locale: sv })}
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>Välj datum</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-auto p-0 z-[1500]" align="end">
              <CalendarWidget
                mode="single"
                selected={selectedDate ? new Date(selectedDate + "T12:00:00") : undefined}
                onSelect={(date) => {
                  if (date) {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, "0");
                    const d = String(date.getDate()).padStart(2, "0");
                    setSelectedDate(`${y}-${m}-${d}`);
                  }
                }}
                locale={sv}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Select value={selectedResourceId} onValueChange={setSelectedResourceId}>
                  <SelectTrigger className="w-[200px]" data-testid="select-resource">
                    <SelectValue placeholder="Välj resurs..." />
                  </SelectTrigger>
                  <SelectContent className="z-[1500]">
                    {resources?.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent>Välj resurs att följa</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 relative">
        {kpis && (
          <div className="absolute top-3 right-3 z-[1000] w-72" data-testid="kpi-overlay">
            <Card className="bg-background/95 backdrop-blur shadow-lg hover-elevate">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  KPI — {safeFormatDate(selectedDate + "T12:00:00", "d MMM yyyy", { locale: sv })}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-muted/50 rounded-lg p-2 text-center hover-elevate cursor-help">
                        <div className="text-lg font-bold" data-testid="text-kpi-completed">
                          {kpis.completedTasks}/{kpis.totalTasks}
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                          <CheckCircle2 className="h-3 w-3" /> Slutförda
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>Antal slutförda uppgifter av totalt</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-muted/50 rounded-lg p-2 text-center hover-elevate cursor-help">
                        <div className="text-lg font-bold" data-testid="text-kpi-remaining">
                          {kpis.remainingTasks}
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                          <Clock className="h-3 w-3" /> Kvarvarande
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>Uppgifter som återstår</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-muted/50 rounded-lg p-2 text-center hover-elevate cursor-help">
                        <div className="text-lg font-bold" data-testid="text-kpi-avg-time">
                          {kpis.avgTimePerTaskMinutes}<span className="text-xs font-normal">min</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                          <Timer className="h-3 w-3" /> Snittid
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>Genomsnittlig tid per uppgift</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="bg-muted/50 rounded-lg p-2 text-center hover-elevate cursor-help">
                        <div className="text-lg font-bold" data-testid="text-kpi-completion-rate">
                          {kpis.completionRate}%
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                          <TrendingUp className="h-3 w-3" /> Mål
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>Måluppfyllnad idag</TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground pt-1 border-t">
                  <Users className="h-3 w-3" /> {kpis.activeResources} aktiva resurser
                </div>
                {resourceKpi && (
                  <div className="border-t pt-2">
                    <p className="text-[10px] font-medium mb-1">{selectedResource?.name}</p>
                    <div className="flex gap-2 text-[10px] text-muted-foreground">
                      <span>{resourceKpi.completedTasks}/{resourceKpi.totalTasks} klara</span>
                      <span>&bull;</span>
                      <span>{resourceKpi.avgTimeMinutes} min snitt</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {!selectedResourceId ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <MapPin className="h-12 w-12" />
            <p className="text-lg font-medium">Välj en resurs för att visa historiken</p>
            <p className="text-sm">Välj datum och resurs ovan för att spela upp dagens rörelsemönster</p>
          </div>
        ) : positionsLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sortedPositions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Navigation className="h-12 w-12" />
            <p className="text-lg font-medium">Inga positioner registrerade</p>
            <p className="text-sm">
              {selectedResource?.name} har inga GPS-positioner för{" "}
              {safeFormatDate(selectedDate + "T12:00:00", "d MMMM yyyy", { locale: sv })}
            </p>
          </div>
        ) : (
          <MapContainer
            center={allPositions[0]}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapFitBounds positions={allPositions} />

            <Polyline
              positions={allPositions}
              pathOptions={{ color: "#94a3b8", weight: 2, opacity: 0.3, dashArray: "4 4" }}
            />

            <Polyline
              positions={trailPositions}
              pathOptions={{ color: "#3b82f6", weight: 3, opacity: 0.8 }}
            />

            <CircleMarker
              center={allPositions[0]}
              radius={7}
              pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2 }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-medium">Start</p>
                  <p className="text-xs text-muted-foreground">
                    {safeFormatDate(sortedPositions[0].recordedAt, "HH:mm:ss", { locale: sv })}
                  </p>
                </div>
              </Popup>
            </CircleMarker>

            <CircleMarker
              center={allPositions[allPositions.length - 1]}
              radius={7}
              pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.9, weight: 2 }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-medium">Slut</p>
                  <p className="text-xs text-muted-foreground">
                    {safeFormatDate(sortedPositions[sortedPositions.length - 1].recordedAt, "HH:mm:ss", { locale: sv })}
                  </p>
                </div>
              </Popup>
            </CircleMarker>

            {currentPosition && (
              <Marker
                position={[currentPosition.latitude, currentPosition.longitude]}
                icon={createCurrentIcon(currentPosition.status)}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">{selectedResource?.name}</p>
                    <p className="text-muted-foreground">{statusLabels[currentPosition.status] || currentPosition.status}</p>
                    {currentPosition.speed != null && (
                      <p className="text-xs text-muted-foreground">{Math.round(currentPosition.speed)} km/h</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {safeFormatDate(currentPosition.recordedAt, "HH:mm:ss", { locale: sv })}
                    </p>
                  </div>
                </Popup>
              </Marker>
            )}

            {sortedPositions.map((pos, idx) => {
              if (idx === 0 || idx === sortedPositions.length - 1) return null;
              const prevPos = sortedPositions[idx - 1];
              if (prevPos && prevPos.status !== pos.status) {
                return (
                  <CircleMarker
                    key={pos.id}
                    center={[pos.latitude, pos.longitude]}
                    radius={5}
                    pathOptions={{
                      color: statusColors[pos.status] || "#6b7280",
                      fillColor: statusColors[pos.status] || "#6b7280",
                      fillOpacity: 0.8,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-medium">{statusLabels[pos.status] || pos.status}</p>
                        <p className="text-xs text-muted-foreground">
                          {safeFormatDate(pos.recordedAt, "HH:mm:ss", { locale: sv })}
                        </p>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              }
              return null;
            })}
          </MapContainer>
        )}

        {sortedPositions.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-background/95 backdrop-blur border-t p-3" data-testid="playback-controls">
            <div className="flex items-center gap-3 max-w-4xl mx-auto">
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => { stopPlayback(); setPlaybackIndex(0); }}
                      data-testid="button-skip-back"
                    >
                      <SkipBack className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Spola till start</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => isPlaying ? stopPlayback() : startPlayback()}
                      data-testid="button-play-pause"
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isPlaying ? "Pausa" : "Spela upp"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => { stopPlayback(); setPlaybackIndex(sortedPositions.length - 1); }}
                      data-testid="button-skip-forward"
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Hoppa till slut</TooltipContent>
                </Tooltip>
              </div>

              <div className="flex-1">
                <Slider
                  min={0}
                  max={sortedPositions.length - 1}
                  step={1}
                  value={[playbackIndex]}
                  onValueChange={([v]) => { stopPlayback(); setPlaybackIndex(v); }}
                  data-testid="slider-timeline"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                {currentPosition && (
                  <Badge variant="outline" className="text-xs" data-testid="text-current-time">
                    <Clock className="h-3 w-3 mr-1" />
                    {safeFormatDate(currentPosition.recordedAt, "HH:mm:ss")}
                  </Badge>
                )}
                <Badge
                  variant="secondary"
                  className={`text-xs cursor-pointer ${
                    currentPosition ? (
                      currentPosition.status === "on_site" || currentPosition.status === "on_job"
                        ? "border-green-500/50 text-green-600"
                        : currentPosition.status === "traveling"
                        ? "border-blue-500/50 text-blue-600"
                        : ""
                    ) : ""
                  }`}
                  data-testid="text-current-status"
                >
                  {currentPosition ? (statusLabels[currentPosition.status] || currentPosition.status) : "—"}
                </Badge>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Select value={String(playbackSpeed)} onValueChange={(v) => setPlaybackSpeed(Number(v))}>
                      <SelectTrigger className="w-[70px] h-8 text-xs" data-testid="select-speed">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.5">0.5x</SelectItem>
                        <SelectItem value="1">1x</SelectItem>
                        <SelectItem value="2">2x</SelectItem>
                        <SelectItem value="4">4x</SelectItem>
                        <SelectItem value="8">8x</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Uppspelningshastighet</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
