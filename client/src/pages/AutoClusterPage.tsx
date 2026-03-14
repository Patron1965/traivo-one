import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Loader2, Check, AlertTriangle, Target, Globe, Clock, Users, Building2, Hand, BarChart3, Map as MapIcon, List, Pencil, ArrowUpDown, ArrowUp, ArrowDown, Info, Download, Upload } from "lucide-react";
import Papa from "papaparse";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";

type Strategy = "geographic" | "frequency" | "team" | "customer" | "manual";

interface ClusterSuggestion {
  id: string;
  name: string;
  description: string;
  objectIds: string[];
  objectCount: number;
  workOrderCount: number;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKm: number;
  color: string;
  primaryTeamId?: string | null;
  rootCustomerId?: string | null;
  postalCodes: string[];
}

interface UnclusteredObjects {
  count: number;
  objectIds: string[];
  postalCodes: string[];
}

interface AutoAssignResult {
  assignments: { clusterId: string; objectIds: string[]; method: "postalCode" | "coordinates"; count: number }[];
  remaining: { count: number; objectIds: string[] };
  totalAssigned: number;
  totalUnclustered: number;
}

interface PendingMove {
  fromClusterId: string;
  objectIds: string[];
  method: "postalCode" | "coordinates";
}

interface GenerateResult {
  strategy: string;
  suggestions: ClusterSuggestion[];
  unclusteredObjects?: UnclusteredObjects;
  summary?: {
    totalSuggested: number;
    totalCoveredObjects: number;
    totalObjects: number;
    unclusteredCount?: number;
    coverage: number;
  };
  statistics?: {
    totalObjects: number;
    totalWorkOrders: number;
    totalCustomers: number;
    totalResources: number;
    objectsWithCoordinates: number;
    objectsWithoutCoordinates: number;
    citiesBreakdown: { city: string; count: number }[];
    frequencyBreakdown: { high: number; medium: number; low: number; none: number };
    unclustered: number;
    alreadyClustered: number;
  };
}

interface ApplyResult {
  success: boolean;
  message: string;
  clusters: { id: string; name: string; objectCount: number }[];
  totalObjectsLinked: number;
  totalWorkOrdersLinked: number;
  errors?: string[];
}

const STRATEGY_INFO: Record<Strategy, { label: string; icon: typeof Globe; description: string }> = {
  geographic: { label: "Geografiskt", icon: Globe, description: "Gruppera objekt per stad och postnummer" },
  frequency: { label: "Besöksfrekvens", icon: Clock, description: "Gruppera efter antal arbetsordrar per objekt" },
  team: { label: "Team", icon: Users, description: "Gruppera efter vilken resurs som utför arbetsordrar" },
  customer: { label: "Kund", icon: Building2, description: "Gruppera per kund" },
  manual: { label: "Manuellt", icon: Hand, description: "Visa statistik utan förslag" },
};

function createClusterIcon(color: string, isSelected: boolean, isHovered: boolean) {
  const size = isSelected ? 16 : 12;
  const border = isSelected ? 3 : isHovered ? 2 : 1;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border}px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4);cursor:grab;"></div>`,
  });
}

function createResizeIcon(color: string) {
  return L.divIcon({
    className: "",
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    html: `<div style="width:10px;height:10px;border-radius:50%;background:white;border:2px solid ${color};box-shadow:0 0 3px rgba(0,0,0,0.3);cursor:ns-resize;"></div>`,
  });
}

function MapFitBounds({ suggestions, fitKey }: { suggestions: ClusterSuggestion[]; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    const points = suggestions
      .filter(s => s.centerLatitude && s.centerLongitude)
      .map(s => [s.centerLatitude!, s.centerLongitude!] as [number, number]);
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
    }
  }, [fitKey, map]);
  return null;
}

function FlyToCluster({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], 11, { duration: 0.8 });
  }, [lat, lng, map]);
  return null;
}

interface DraggableClusterProps {
  suggestion: ClusterSuggestion;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onMoveCenter: (id: string, lat: number, lng: number) => void;
  onResizeRadius: (id: string, radiusKm: number) => void;
}

function DraggableCluster({ suggestion, isSelected, isHovered, onSelect, onHover, onMoveCenter, onResizeRadius }: DraggableClusterProps) {
  const { centerLatitude, centerLongitude, radiusKm, color, name, objectCount } = suggestion;
  if (!centerLatitude || !centerLongitude) return null;

  const radiusHandleLat = centerLatitude + (radiusKm / 111.32);

  return (
    <>
      <Circle
        center={[centerLatitude, centerLongitude]}
        radius={radiusKm * 1000}
        pathOptions={{
          color: color,
          fillColor: color,
          fillOpacity: isSelected ? 0.25 : isHovered ? 0.18 : 0.12,
          weight: isSelected ? 3 : isHovered ? 2 : 1,
          dashArray: isSelected ? undefined : "5 5",
        }}
        eventHandlers={{
          click: (e) => { L.DomEvent.stopPropagation(e); onSelect(suggestion.id); },
          mouseover: () => onHover(suggestion.id),
          mouseout: () => onHover(null),
        }}
      />
      <Marker
        position={[centerLatitude, centerLongitude]}
        icon={createClusterIcon(color, isSelected, isHovered)}
        draggable={true}
        eventHandlers={{
          click: () => onSelect(suggestion.id),
          dragend: (e) => {
            const latlng = e.target.getLatLng();
            onMoveCenter(suggestion.id, latlng.lat, latlng.lng);
          },
          mouseover: () => onHover(suggestion.id),
          mouseout: () => onHover(null),
        }}
      >
        <Popup>
          <div className="text-xs space-y-1 min-w-[120px]">
            <div className="font-semibold flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
              {name}
            </div>
            <div>{objectCount.toLocaleString("sv")} objekt</div>
            <div>Radie: {radiusKm.toFixed(1)} km</div>
            <div className="text-muted-foreground pt-1">Dra mittpunkten för att flytta. Dra kanten för att ändra radie.</div>
          </div>
        </Popup>
      </Marker>
      <Marker
        position={[radiusHandleLat, centerLongitude]}
        icon={createResizeIcon(color)}
        draggable={true}
        eventHandlers={{
          dragend: (e) => {
            const latlng = e.target.getLatLng();
            const toRad = (d: number) => d * Math.PI / 180;
            const dLat = toRad(latlng.lat - centerLatitude);
            const dLon = toRad(latlng.lng - centerLongitude);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(centerLatitude)) * Math.cos(toRad(latlng.lat)) * Math.sin(dLon / 2) ** 2;
            const newRadius = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            onResizeRadius(suggestion.id, Math.max(0.5, Math.round(newRadius * 10) / 10));
          },
        }}
      />
    </>
  );
}

export default function AutoClusterPage() {
  const mapConfig = useMapConfig();
  const { toast } = useToast();
  const [strategy, setStrategy] = useState<Strategy>("geographic");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [targetSize, setTargetSize] = useState(50);
  const [highThreshold, setHighThreshold] = useState(10);
  const [mediumThreshold, setMediumThreshold] = useState(3);
  const [generatedResult, setGeneratedResult] = useState<GenerateResult | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<string | null>(null);
  const [focusedCluster, setFocusedCluster] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [mapFitKey, setMapFitKey] = useState(0);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [sortField, setSortField] = useState<"name" | "objectCount" | "workOrderCount">("objectCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [showObjectMarkers, setShowObjectMarkers] = useState(true);
  const [autoAssignResult, setAutoAssignResult] = useState<AutoAssignResult | null>(null);
  const [autoAssignApplied, setAutoAssignApplied] = useState(false);
  const [recentAssignments, setRecentAssignments] = useState<{ clusterId: string; clusterName: string; objectIds: string[]; method: string }[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clusterStatus = useQuery<{ total: number }>({
    queryKey: ["/api/clusters/status"],
    queryFn: async () => {
      const res = await fetch("/api/clusters");
      const clusters = await res.json();
      return { total: Array.isArray(clusters) ? clusters.length : 0 };
    }
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {};
      if (strategy === "geographic") config.targetSize = targetSize;
      if (strategy === "frequency") {
        config.highThreshold = highThreshold;
        config.mediumThreshold = mediumThreshold;
      }
      const response = await apiRequest("POST", "/api/clusters/auto-generate", { strategy, config });
      return response.json() as Promise<GenerateResult>;
    },
    onSuccess: (result) => {
      setGeneratedResult(result);
      setSelectedSuggestions(new Set());
      setFocusedCluster(null);
      setMapFitKey(k => k + 1);
      if (result.suggestions.length > 0) {
        toast({ title: "Förslag genererade", description: `${result.suggestions.length} kluster föreslagna` });
      }
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte generera klusterförslag.", variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (suggestions: ClusterSuggestion[]) => {
      const response = await apiRequest("POST", "/api/clusters/auto-generate/apply", { suggestions });
      return response.json() as Promise<ApplyResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clusters/status"] });
      toast({ title: "Kluster skapade", description: result.message });
      setSelectedSuggestions(new Set());
      setGeneratedResult(null);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa kluster.", variant: "destructive" });
    },
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      if (!generatedResult?.unclusteredObjects || !generatedResult.suggestions) throw new Error("No data");
      const response = await apiRequest("POST", "/api/clusters/auto-assign-unclustered", {
        unclusteredObjectIds: generatedResult.unclusteredObjects.objectIds,
        suggestions: generatedResult.suggestions.map(s => ({
          id: s.id,
          postalCodes: s.postalCodes,
          centerLatitude: s.centerLatitude,
          centerLongitude: s.centerLongitude,
          radiusKm: s.radiusKm
        }))
      });
      return response.json() as Promise<AutoAssignResult>;
    },
    onSuccess: (result) => {
      setAutoAssignResult(result);
      setAutoAssignApplied(false);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte analysera objekt utan stad.", variant: "destructive" });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async (params: { id: string; centerLatitude: number; centerLongitude: number; radiusKm: number }) => {
      const response = await apiRequest("POST", "/api/clusters/auto-generate/recalculate", params);
      return response.json() as Promise<{ objectIds: string[]; objectCount: number }>;
    },
  });

  const toggleSuggestion = useCallback((id: string) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    if (generatedResult?.suggestions) {
      setSelectedSuggestions(new Set(generatedResult.suggestions.map(s => s.id)));
    }
  };

  const handleApply = () => {
    if (!generatedResult?.suggestions) return;
    const selected = generatedResult.suggestions.filter(s => selectedSuggestions.has(s.id));
    if (selected.length === 0) {
      toast({ title: "Välj förslag", description: "Markera minst ett klusterförslag.", variant: "destructive" });
      return;
    }
    applyMutation.mutate(selected);
  };

  const handleGenerate = () => {
    setGeneratedResult(null);
    setFocusedCluster(null);
    setEditingNameId(null);
    setAutoAssignResult(null);
    setAutoAssignApplied(false);
    setRecentAssignments([]);
    generateMutation.mutate();
  };

  const startEditingName = useCallback((id: string, currentName: string) => {
    setEditingNameId(id);
    setEditingNameValue(currentName);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const commitNameEdit = useCallback(() => {
    if (!editingNameId || !editingNameValue.trim()) {
      setEditingNameId(null);
      return;
    }
    setGeneratedResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map(s =>
          s.id === editingNameId ? { ...s, name: editingNameValue.trim() } : s
        )
      };
    });
    setEditingNameId(null);
  }, [editingNameId, editingNameValue]);

  const handleClusterSelect = useCallback((id: string) => {
    if (generatedResult?.suggestions) {
      const s = generatedResult.suggestions.find(s => s.id === id);
      if (s?.centerLatitude && s?.centerLongitude) {
        setFocusedCluster({ lat: s.centerLatitude, lng: s.centerLongitude });
      }
    }
    setHoveredCluster(id);
  }, [generatedResult]);

  const handleRowClick = useCallback((s: ClusterSuggestion) => {
    if (s.centerLatitude && s.centerLongitude) {
      setFocusedCluster({ lat: s.centerLatitude, lng: s.centerLongitude });
    }
  }, []);

  const handleMoveCenter = useCallback((id: string, lat: number, lng: number) => {
    setGeneratedResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map(s =>
          s.id === id ? { ...s, centerLatitude: lat, centerLongitude: lng } : s
        )
      };
    });
    const s = generatedResult?.suggestions.find(s => s.id === id);
    if (s) {
      recalculateMutation.mutate(
        { id, centerLatitude: lat, centerLongitude: lng, radiusKm: s.radiusKm },
        {
          onSuccess: (data) => {
            setGeneratedResult(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                suggestions: prev.suggestions.map(s =>
                  s.id === id ? { ...s, objectIds: data.objectIds, objectCount: data.objectCount } : s
                )
              };
            });
          }
        }
      );
    }
  }, [generatedResult, recalculateMutation]);

  const handleResizeRadius = useCallback((id: string, radiusKm: number) => {
    setGeneratedResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map(s =>
          s.id === id ? { ...s, radiusKm } : s
        )
      };
    });
    const s = generatedResult?.suggestions.find(s => s.id === id);
    if (s && s.centerLatitude && s.centerLongitude) {
      recalculateMutation.mutate(
        { id, centerLatitude: s.centerLatitude, centerLongitude: s.centerLongitude, radiusKm },
        {
          onSuccess: (data) => {
            setGeneratedResult(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                suggestions: prev.suggestions.map(s =>
                  s.id === id ? { ...s, objectIds: data.objectIds, objectCount: data.objectCount } : s
                )
              };
            });
          }
        }
      );
    }
  }, [generatedResult, recalculateMutation]);

  const suggestionsWithCoords = useMemo(() =>
    generatedResult?.suggestions.filter(s => s.centerLatitude && s.centerLongitude) || [],
    [generatedResult]
  );

  const sortedSuggestions = useMemo(() => {
    if (!generatedResult?.suggestions) return [];
    const sorted = [...generatedResult.suggestions];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = a.name.localeCompare(b.name, "sv");
      else if (sortField === "objectCount") cmp = a.objectCount - b.objectCount;
      else cmp = a.workOrderCount - b.workOrderCount;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [generatedResult, sortField, sortDir]);

  const toggleSort = useCallback((field: "name" | "objectCount" | "workOrderCount") => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir(field === "name" ? "asc" : "desc"); }
  }, [sortField]);

  const overlappingPairs = useMemo(() => {
    const selected = suggestionsWithCoords.filter(s => selectedSuggestions.has(s.id));
    const pairs: [string, string][] = [];
    const toRad = (d: number) => d * Math.PI / 180;
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const a = selected[i], b = selected[j];
        const dLat = toRad(b.centerLatitude! - a.centerLatitude!);
        const dLon = toRad(b.centerLongitude! - a.centerLongitude!);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.centerLatitude!)) * Math.cos(toRad(b.centerLatitude!)) * Math.sin(dLon / 2) ** 2;
        const dist = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
        if (dist < a.radiusKm + b.radiusKm) pairs.push([a.id, b.id]);
      }
    }
    return pairs;
  }, [suggestionsWithCoords, selectedSuggestions]);

  const overlappingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [a, b] of overlappingPairs) { ids.add(a); ids.add(b); }
    return ids;
  }, [overlappingPairs]);

  const objectCoordsQuery = useQuery<{ lat: number; lng: number; color: string }[]>({
    queryKey: ["/api/objects/coordinates", Array.from(selectedSuggestions).sort().join(",")],
    queryFn: async () => {
      if (!generatedResult?.suggestions || selectedSuggestions.size === 0) return [];
      const selected = generatedResult.suggestions.filter(s => selectedSuggestions.has(s.id));
      const allIds = selected.flatMap(s => s.objectIds);
      if (allIds.length === 0) return [];
      const res = await apiRequest("POST", "/api/objects/coordinates", { objectIds: allIds.slice(0, 3000) });
      const data = await res.json() as { id: string; latitude: number; longitude: number }[];
      const idToColor = new Map<string, string>();
      for (const s of selected) {
        for (const id of s.objectIds) idToColor.set(id, s.color);
      }
      return data
        .filter(o => o.latitude && o.longitude)
        .map(o => ({ lat: o.latitude, lng: o.longitude, color: idToColor.get(o.id) || "#888" }));
    },
    enabled: showObjectMarkers && selectedSuggestions.size > 0 && !!generatedResult,
    staleTime: 30000,
  });

  const applyAutoAssign = useCallback(() => {
    if (!autoAssignResult || !generatedResult) return;
    const newAssignments: typeof recentAssignments = [];
    setGeneratedResult(prev => {
      if (!prev) return prev;
      const addedPerCluster = new Map<string, string[]>();
      for (const a of autoAssignResult.assignments) {
        const existing = addedPerCluster.get(a.clusterId) || [];
        existing.push(...a.objectIds);
        addedPerCluster.set(a.clusterId, existing);
        const cluster = prev.suggestions.find(s => s.id === a.clusterId);
        newAssignments.push({
          clusterId: a.clusterId,
          clusterName: cluster?.name || a.clusterId,
          objectIds: a.objectIds,
          method: a.method === "postalCode" ? "Postnummer" : "Koordinater"
        });
      }
      return {
        ...prev,
        suggestions: prev.suggestions.map(s => {
          const added = addedPerCluster.get(s.id);
          if (!added) return s;
          return {
            ...s,
            objectIds: [...s.objectIds, ...added],
            objectCount: s.objectCount + added.length,
          };
        }),
        unclusteredObjects: autoAssignResult.remaining.count > 0
          ? { count: autoAssignResult.remaining.count, objectIds: autoAssignResult.remaining.objectIds, postalCodes: [] }
          : { count: 0, objectIds: [], postalCodes: [] },
        summary: prev.summary ? {
          ...prev.summary,
          totalCoveredObjects: prev.summary.totalCoveredObjects + autoAssignResult.totalAssigned,
          unclusteredCount: autoAssignResult.remaining.count,
          coverage: prev.summary.totalObjects > 0
            ? Math.round(((prev.summary.totalCoveredObjects + autoAssignResult.totalAssigned) / prev.summary.totalObjects) * 100) : 0
        } : prev.summary
      };
    });
    setRecentAssignments(newAssignments);
    setAutoAssignApplied(true);
    toast({ title: "Tilldelat", description: `${autoAssignResult.totalAssigned.toLocaleString("sv")} objekt tilldelade automatiskt.` });
  }, [autoAssignResult, generatedResult, toast]);

  const handleManualAssign = useCallback(() => {
    if (!assignTarget || !generatedResult?.unclusteredObjects) return;
    const targetCluster = generatedResult.suggestions.find(s => s.id === assignTarget);
    setGeneratedResult(prev => {
      if (!prev || !prev.unclusteredObjects) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map(s =>
          s.id === assignTarget
            ? { ...s, objectIds: [...s.objectIds, ...prev.unclusteredObjects!.objectIds], objectCount: s.objectCount + prev.unclusteredObjects!.count }
            : s
        ),
        unclusteredObjects: { count: 0, objectIds: [], postalCodes: [] },
        summary: prev.summary ? {
          ...prev.summary,
          totalCoveredObjects: prev.summary.totalCoveredObjects + prev.unclusteredObjects!.count,
          unclusteredCount: 0,
          coverage: prev.summary.totalObjects > 0 ? Math.round(((prev.summary.totalCoveredObjects + prev.unclusteredObjects!.count) / prev.summary.totalObjects) * 100) : 0
        } : prev.summary
      };
    });
    if (targetCluster) {
      setRecentAssignments(prev => [...prev, {
        clusterId: assignTarget,
        clusterName: targetCluster.name,
        objectIds: generatedResult.unclusteredObjects!.objectIds,
        method: "Manuell"
      }]);
    }
    setAssignTarget(null);
    toast({ title: "Tilldelat", description: "Kvarvarande objekt har tilldelats valt kluster." });
  }, [assignTarget, generatedResult, toast]);

  const moveAssignment = useCallback((assignment: typeof recentAssignments[0], newClusterId: string) => {
    const newCluster = generatedResult?.suggestions.find(s => s.id === newClusterId);
    setGeneratedResult(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map(s => {
          if (s.id === assignment.clusterId) {
            const remaining = s.objectIds.filter(id => !assignment.objectIds.includes(id));
            return { ...s, objectIds: remaining, objectCount: remaining.length };
          }
          if (s.id === newClusterId) {
            return { ...s, objectIds: [...s.objectIds, ...assignment.objectIds], objectCount: s.objectCount + assignment.objectIds.length };
          }
          return s;
        })
      };
    });
    setRecentAssignments(prev => prev.map(a =>
      a === assignment ? { ...a, clusterId: newClusterId, clusterName: newCluster?.name || newClusterId } : a
    ));
    toast({ title: "Flyttat", description: `${assignment.objectIds.length.toLocaleString("sv")} objekt flyttade till ${newCluster?.name || "annat kluster"}.` });
  }, [generatedResult, toast]);

  const handleExportUnclustered = useCallback(async () => {
    if (!generatedResult?.unclusteredObjects?.objectIds?.length) return;
    setIsExporting(true);
    try {
      const response = await apiRequest("POST", "/api/objects/export-unclustered", {
        objectIds: generatedResult.unclusteredObjects.objectIds
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "oklustrade-objekt.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Exporterad", description: `${generatedResult.unclusteredObjects.count.toLocaleString("sv")} objekt exporterade till CSV.` });
    } catch {
      toast({ title: "Fel", description: "Kunde inte exportera objekt.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [generatedResult, toast]);

  const handleImportCorrections = useCallback((file: File) => {
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      let text = e.target?.result as string || "";
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      Papa.parse(text, {
      header: true,
      delimiter: ";",
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const corrections = (results.data as Record<string, string>[])
            .filter(row => row.Id)
            .map(row => ({
              id: row.Id,
              postalCode: row.Postnummer || undefined,
              city: row.Stad || undefined,
              latitude: row.Latitude ? parseFloat(row.Latitude) : undefined,
              longitude: row.Longitude ? parseFloat(row.Longitude) : undefined,
            }))
            .filter(c => c.city || c.postalCode || c.latitude || c.longitude);

          if (corrections.length === 0) {
            toast({ title: "Ingen data", description: "Inga korrigeringar hittades i filen. Fyll i Stad eller Postnummer-kolumnen.", variant: "destructive" });
            setIsImporting(false);
            return;
          }

          const response = await apiRequest("POST", "/api/objects/import-corrections", { corrections });
          const result = await response.json() as { updated: number; errors: string[]; total: number };
          toast({
            title: "Importerad",
            description: `${result.updated} av ${result.total} objekt uppdaterade.${result.errors.length > 0 ? ` ${result.errors.length} fel.` : ""} Generera om kluster för att se effekten.`,
          });
        } catch {
          toast({ title: "Fel", description: "Kunde inte importera korrigeringar.", variant: "destructive" });
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      },
      error: () => {
        toast({ title: "Fel", description: "Kunde inte läsa CSV-filen.", variant: "destructive" });
        setIsImporting(false);
      }
    });
    };
    reader.onerror = () => {
      toast({ title: "Fel", description: "Kunde inte läsa filen.", variant: "destructive" });
      setIsImporting(false);
    };
    reader.readAsText(file, "utf-8");
  }, [toast]);

  const existingClusters = clusterStatus.data?.total || 0;
  const hasSuggestions = generatedResult && generatedResult.suggestions.length > 0 && !generateMutation.isPending;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Target className="h-6 w-6 text-primary" />
            Automatisk Klusterbildning
          </h1>
          <p className="text-muted-foreground mt-1">
            Gruppera importerade objekt i kluster med olika strategier
          </p>
        </div>
        {hasSuggestions && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMap(!showMap)}
            data-testid="button-toggle-map"
          >
            {showMap ? <List className="h-4 w-4 mr-2" /> : <MapIcon className="h-4 w-4 mr-2" />}
            {showMap ? "Dölj karta" : "Visa karta"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-existing-clusters">{existingClusters}</div>
            <div className="text-xs text-muted-foreground">Befintliga kluster</div>
          </CardContent>
        </Card>
        {generatedResult?.summary && (
          <>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-total-objects">{generatedResult.summary.totalObjects.toLocaleString("sv")}</div>
                <div className="text-xs text-muted-foreground">Totalt objekt</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-suggested-clusters">{generatedResult.summary.totalSuggested}</div>
                <div className="text-xs text-muted-foreground">Föreslagna kluster</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-coverage">{generatedResult.summary.coverage}%</div>
                <div className="text-xs text-muted-foreground">Täckningsgrad</div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Tabs value={strategy} onValueChange={(v) => { setStrategy(v as Strategy); setGeneratedResult(null); setSelectedSuggestions(new Set()); setFocusedCluster(null); }}>
        <TabsList className="w-full grid grid-cols-5">
          {(Object.entries(STRATEGY_INFO) as [Strategy, typeof STRATEGY_INFO[Strategy]][]).map(([key, info]) => {
            const Icon = info.icon;
            return (
              <TabsTrigger key={key} value={key} className="flex items-center gap-1.5 text-xs sm:text-sm" data-testid={`tab-${key}`}>
                <Icon className="h-4 w-4 hidden sm:block" />
                {info.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(Object.entries(STRATEGY_INFO) as [Strategy, typeof STRATEGY_INFO[Strategy]][]).map(([key, info]) => (
          <TabsContent key={key} value={key} className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{info.label}</CardTitle>
                <CardDescription>{info.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {key === "geographic" && (
                  <p className="text-sm text-muted-foreground">Grupperar objekt per stad. Varje stad blir ett kluster med alla postnummerserier.</p>
                )}
                {key === "frequency" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Hög frekvens: ≥{highThreshold} ordrar</label>
                      <Slider value={[highThreshold]} onValueChange={(v) => setHighThreshold(v[0])} min={5} max={50} step={1} data-testid="slider-high-threshold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Medel frekvens: ≥{mediumThreshold} ordrar</label>
                      <Slider value={[mediumThreshold]} onValueChange={(v) => setMediumThreshold(v[0])} min={1} max={highThreshold - 1} step={1} data-testid="slider-medium-threshold" />
                    </div>
                  </div>
                )}
                {key === "team" && <p className="text-sm text-muted-foreground">Varje resurs som utfört arbetsordrar blir ett eget kluster.</p>}
                {key === "customer" && <p className="text-sm text-muted-foreground">Varje kund med minst ett objekt blir ett eget kluster.</p>}
                {key === "manual" && <p className="text-sm text-muted-foreground">Visa statistik om objekten utan att generera klusterförslag.</p>}
                <Button onClick={handleGenerate} disabled={generateMutation.isPending} data-testid="button-generate">
                  {generateMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
                  {key === "manual" ? "Visa statistik" : "Generera förslag"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {generateMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-2">Analyserar data...</h3>
            <p className="text-muted-foreground">Grupperar objekt enligt vald strategi</p>
          </CardContent>
        </Card>
      )}

      {generatedResult && strategy === "manual" && generatedResult.statistics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Översikt</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Totalt objekt</span><span className="font-medium">{generatedResult.statistics.totalObjects.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Med koordinater</span><span className="font-medium">{generatedResult.statistics.objectsWithCoordinates.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Utan koordinater</span><span className="font-medium">{generatedResult.statistics.objectsWithoutCoordinates.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Totalt arbetsordrar</span><span className="font-medium">{generatedResult.statistics.totalWorkOrders.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Kunder</span><span className="font-medium">{generatedResult.statistics.totalCustomers.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Resurser</span><span className="font-medium">{generatedResult.statistics.totalResources}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Redan klustrade</span><span className="font-medium">{generatedResult.statistics.alreadyClustered.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Oklustrade</span><span className="font-medium">{generatedResult.statistics.unclustered.toLocaleString("sv")}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Besöksfrekvens</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Hög (≥10 ordrar)</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.high.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Medel (3-9 ordrar)</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.medium.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Låg (1-2 ordrar)</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.low.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Inga ordrar</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.none.toLocaleString("sv")}</span></div>
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader className="pb-3"><CardTitle className="text-base">Objekt per stad (topp 20)</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
                {generatedResult.statistics.citiesBreakdown.slice(0, 20).map((c) => (
                  <div key={c.city} className="flex justify-between gap-2 px-2 py-1 rounded bg-muted/50">
                    <span className="truncate">{c.city}</span>
                    <span className="font-medium shrink-0">{c.count.toLocaleString("sv")}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {hasSuggestions && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-semibold">Föreslagna kluster ({generatedResult!.suggestions.length})</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">Markera alla</Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedSuggestions(new Set())} data-testid="button-deselect-all">Avmarkera</Button>
              <Button onClick={handleApply} disabled={selectedSuggestions.size === 0 || applyMutation.isPending} data-testid="button-apply">
                {applyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Skapa {selectedSuggestions.size} kluster
              </Button>
            </div>
          </div>

          <div className={`grid gap-4 ${showMap && suggestionsWithCoords.length > 0 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
            {showMap && suggestionsWithCoords.length > 0 && (
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="relative" style={{ height: "500px" }}>
                    <MapContainer
                      center={[62.0, 15.0]}
                      zoom={5}
                      style={{ height: "100%", width: "100%" }}
                      scrollWheelZoom={true}
                    >
                      <TileLayer
                        attribution={mapConfig.attribution}
                        url={mapConfig.tileUrl}
                      />
                      <MapFitBounds suggestions={suggestionsWithCoords} fitKey={mapFitKey} />
                      {focusedCluster && <FlyToCluster lat={focusedCluster.lat} lng={focusedCluster.lng} />}
                      {showObjectMarkers && objectCoordsQuery.data?.map((o, i) => (
                        <CircleMarker
                          key={`obj-${i}`}
                          center={[o.lat, o.lng]}
                          radius={3}
                          pathOptions={{ color: o.color, fillColor: o.color, fillOpacity: 0.6, weight: 1, opacity: 0.7 }}
                        />
                      ))}
                      {suggestionsWithCoords.filter(s => selectedSuggestions.has(s.id)).map(s => (
                        <DraggableCluster
                          key={s.id}
                          suggestion={s}
                          isSelected={true}
                          isHovered={hoveredCluster === s.id}
                          onSelect={handleClusterSelect}
                          onHover={setHoveredCluster}
                          onMoveCenter={handleMoveCenter}
                          onResizeRadius={handleResizeRadius}
                        />
                      ))}
                    </MapContainer>
                    {recalculateMutation.isPending && (
                      <div className="absolute top-2 right-2 bg-background/90 rounded px-2 py-1 text-xs flex items-center gap-1 shadow">
                        <Loader2 className="h-3 w-3 animate-spin" /> Beräknar om...
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-background/90 rounded px-2 py-1 text-xs text-muted-foreground shadow flex items-center gap-2">
                      <span>Dra mittpunkt = flytta. Dra kanten = ändra radie.</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <Checkbox checked={showObjectMarkers} onCheckedChange={(c) => setShowObjectMarkers(!!c)} className="h-3 w-3" />
                        <span>Visa objekt</span>
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="border rounded-lg overflow-hidden">
              {overlappingPairs.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-3 py-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{overlappingPairs.length} klusterpar överlappar geografiskt</span>
                </div>
              )}
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left p-3 w-10">
                        <Checkbox
                          checked={selectedSuggestions.size === generatedResult!.suggestions.length && generatedResult!.suggestions.length > 0}
                          onCheckedChange={(checked) => { if (checked) selectAll(); else setSelectedSuggestions(new Set()); }}
                          data-testid="checkbox-select-all"
                        />
                      </th>
                      <th className="text-left p-3 w-10">Färg</th>
                      <th className="text-left p-3 cursor-pointer select-none" onClick={() => toggleSort("name")} data-testid="sort-name">
                        <span className="flex items-center gap-1">
                          Namn
                          {sortField === "name" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />}
                        </span>
                      </th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => toggleSort("objectCount")} data-testid="sort-objects">
                        <span className="flex items-center justify-end gap-1">
                          Objekt
                          {sortField === "objectCount" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />}
                        </span>
                      </th>
                      <th className="text-right p-3 cursor-pointer select-none" onClick={() => toggleSort("workOrderCount")} data-testid="sort-orders">
                        <span className="flex items-center justify-end gap-1">
                          Ordrar
                          {sortField === "workOrderCount" ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />}
                        </span>
                      </th>
                      <th className="text-right p-3 hidden lg:table-cell">Radie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSuggestions.map((s) => (
                      <tr
                        key={s.id}
                        className={`border-t cursor-pointer transition-colors ${
                          selectedSuggestions.has(s.id) ? "bg-primary/5" : ""
                        } ${hoveredCluster === s.id ? "bg-muted/40" : "hover:bg-muted/30"}`}
                        onClick={() => handleRowClick(s)}
                        onMouseEnter={() => setHoveredCluster(s.id)}
                        onMouseLeave={() => setHoveredCluster(null)}
                        data-testid={`row-suggestion-${s.id}`}
                      >
                        <td className="p-3">
                          <Checkbox
                            checked={selectedSuggestions.has(s.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedSuggestions(prev => new Set([...prev, s.id]));
                              } else {
                                setSelectedSuggestions(prev => { const next = new Set(prev); next.delete(s.id); return next; });
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-${s.id}`}
                          />
                        </td>
                        <td className="p-3">
                          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                        </td>
                        <td className="p-3 max-w-[200px]">
                          {editingNameId === s.id ? (
                            <Input
                              ref={nameInputRef}
                              value={editingNameValue}
                              onChange={(e) => setEditingNameValue(e.target.value)}
                              onBlur={commitNameEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitNameEdit();
                                if (e.key === "Escape") setEditingNameId(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="h-7 text-sm px-2"
                              data-testid={`input-name-${s.id}`}
                            />
                          ) : (
                            <div
                              className="flex items-center gap-1.5 group cursor-text font-medium truncate"
                              onDoubleClick={(e) => { e.stopPropagation(); startEditingName(s.id, s.name); }}
                              title="Dubbelklicka för att byta namn"
                            >
                              <span className="truncate">{s.name}</span>
                              {overlappingIds.has(s.id) && <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" title="Överlappar med annat kluster" />}
                              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <Badge variant="secondary">{s.objectCount.toLocaleString("sv")}</Badge>
                        </td>
                        <td className="p-3 text-right">
                          <Badge variant="outline">{s.workOrderCount.toLocaleString("sv")}</Badge>
                        </td>
                        <td className="p-3 text-right text-muted-foreground hidden lg:table-cell">
                          {s.radiusKm.toFixed(1)} km
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {generatedResult!.unclusteredObjects && generatedResult!.unclusteredObjects.count > 0 && (
            <Card className="border-amber-300/30 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="py-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {generatedResult!.unclusteredObjects.count.toLocaleString("sv")} objekt utan stad
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleExportUnclustered}
                      disabled={isExporting}
                      data-testid="button-export-unclustered"
                    >
                      {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                      Exportera CSV
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                      data-testid="button-import-corrections"
                    >
                      {isImporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                      Importera korrigeringar
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImportCorrections(file);
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => autoAssignMutation.mutate()}
                      disabled={autoAssignMutation.isPending || autoAssignApplied}
                      data-testid="button-auto-assign"
                    >
                      {autoAssignMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
                      {autoAssignApplied ? "Tilldelad" : "Auto-tilldela"}
                    </Button>
                  </div>
                </div>

                {autoAssignResult && !autoAssignApplied && (
                  <div className="bg-white dark:bg-background rounded border p-3 space-y-3">
                    <div className="text-sm font-medium">Förhandsvisning av tilldelning</div>
                    <div className="space-y-1.5 text-sm">
                      {autoAssignResult.assignments.map((a, i) => {
                        const cluster = generatedResult!.suggestions.find(s => s.id === a.clusterId);
                        return (
                          <div key={i} className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cluster?.color || "#888" }} />
                            <span className="font-medium">{cluster?.name || "?"}</span>
                            <span className="text-muted-foreground">← {a.count.toLocaleString("sv")} objekt via {a.method === "postalCode" ? "postnummer" : "koordinater"}</span>
                          </div>
                        );
                      })}
                      {autoAssignResult.remaining.count > 0 && (
                        <div className="text-muted-foreground pt-1">
                          {autoAssignResult.remaining.count.toLocaleString("sv")} objekt kunde inte matchas automatiskt
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button size="sm" onClick={applyAutoAssign} data-testid="button-confirm-auto-assign">
                        <Check className="h-4 w-4 mr-1" /> Godkänn tilldelning ({autoAssignResult.totalAssigned.toLocaleString("sv")} objekt)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAutoAssignResult(null)} data-testid="button-cancel-auto-assign">
                        Avbryt
                      </Button>
                    </div>
                  </div>
                )}

                {autoAssignApplied && generatedResult!.unclusteredObjects.count > 0 && (
                  <div className="flex items-center gap-3 flex-wrap pt-1">
                    <span className="text-sm text-muted-foreground">
                      {generatedResult!.unclusteredObjects.count.toLocaleString("sv")} kvarvarande — tilldela manuellt:
                    </span>
                    <Select value={assignTarget || ""} onValueChange={setAssignTarget}>
                      <SelectTrigger className="w-[250px] h-8 text-sm" data-testid="select-assign-target">
                        <SelectValue placeholder="Välj kluster..." />
                      </SelectTrigger>
                      <SelectContent className="z-[1000]">
                        {generatedResult!.suggestions.map(s => (
                          <SelectItem key={s.id} value={s.id}>
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                              {s.name} ({s.objectCount.toLocaleString("sv")} obj)
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={handleManualAssign} disabled={!assignTarget} data-testid="button-manual-assign">
                      Tilldela
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {recentAssignments.length > 0 && (
            <Card className="border-blue-300/30 bg-blue-50/50 dark:bg-blue-950/20">
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    Senaste tilldelningar — flytta om det automatiska blev fel
                  </span>
                </div>
                <div className="space-y-2">
                  {recentAssignments.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm bg-white dark:bg-background rounded border px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-medium truncate">{a.objectIds.length.toLocaleString("sv")} objekt</span>
                        <Badge variant="outline" className="text-xs shrink-0">{a.method}</Badge>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium truncate">{a.clusterName}</span>
                      </div>
                      <Select value="" onValueChange={(newId) => moveAssignment(a, newId)}>
                        <SelectTrigger className="w-[180px] h-7 text-xs shrink-0" data-testid={`select-move-${i}`}>
                          <SelectValue placeholder="Flytta till..." />
                        </SelectTrigger>
                        <SelectContent className="z-[1000]">
                          {generatedResult!.suggestions
                            .filter(s => s.id !== a.clusterId)
                            .map(s => (
                              <SelectItem key={s.id} value={s.id}>
                                <span className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                                  {s.name}
                                </span>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {selectedSuggestions.size > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm space-y-1">
                    <div className="flex items-center gap-4 flex-wrap">
                      <span><span className="font-semibold">{selectedSuggestions.size}</span> kluster markerade</span>
                      <span>
                        <span className="font-semibold">
                          {generatedResult!.suggestions.filter(s => selectedSuggestions.has(s.id)).reduce((sum, s) => sum + s.objectCount, 0).toLocaleString("sv")}
                        </span> objekt täcks
                      </span>
                      {generatedResult!.summary && (
                        <>
                          <span className="text-muted-foreground">
                            ({Math.round((generatedResult!.suggestions.filter(s => selectedSuggestions.has(s.id)).reduce((sum, s) => sum + s.objectCount, 0) / generatedResult!.summary.totalObjects) * 100)}% av {generatedResult!.summary.totalObjects.toLocaleString("sv")} totalt)
                          </span>
                          {(generatedResult!.unclusteredObjects?.count || 0) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">
                              {generatedResult!.unclusteredObjects!.count.toLocaleString("sv")} utan stad
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            {[...new Set(generatedResult!.suggestions.filter(s => selectedSuggestions.has(s.id)).flatMap(s => s.postalCodes))].length} postnummer
                          </span>
                        </>
                      )}
                    </div>
                    {overlappingPairs.length > 0 && (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        <span>{overlappingPairs.length} överlappningar</span>
                      </div>
                    )}
                  </div>
                  <Button onClick={handleApply} disabled={applyMutation.isPending} data-testid="button-apply-bottom">
                    {applyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                    Skapa {selectedSuggestions.size} kluster
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {applyMutation.isSuccess && applyMutation.data && (
        <Card className="border-green-500/20 bg-green-50 dark:bg-green-950/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check className="h-5 w-5" />
              <span className="font-medium">{applyMutation.data.message}</span>
            </div>
            {applyMutation.data.errors && applyMutation.data.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {applyMutation.data.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    {err}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
