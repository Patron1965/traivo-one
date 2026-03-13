import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, Plus, Filter, Loader2, ChevronRight, ChevronLeft, Building2, MapPin, Trash2, 
  Map as MapIcon, List, Edit2, Copy, Upload, Clock, Key, Keyboard, Users, DoorOpen,
  Check, X, FileSpreadsheet, Download, BarChart3, MoreHorizontal, AlertTriangle, ChevronDown, ChevronUp, XCircle,
  Image, GitFork, Link2, Globe, ShieldAlert, ShieldCheck, ShieldX
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AICard } from "@/components/AICard";
import { ObjectMetadataPanel } from "@/components/ObjectMetadataPanel";
import { ObjectPayersPanel } from "@/components/ObjectPayersPanel";
import { ObjectParentsPanel } from "@/components/ObjectParentsPanel";
import { ObjectApplicableArticlesPanel } from "@/components/ObjectApplicableArticlesPanel";
import { ObjectContactsDialog } from "@/components/ObjectContactsPanel";
import { ObjectImagesDialog } from "@/components/ObjectImagesGallery";
import { AddressSearch } from "@/components/AddressSearch";
import { GeocodedObjectsMap, ObjectsMapTab } from "@/components/ObjectsMapView";
import type { ServiceObject, Customer, SetupTimeLog } from "@shared/schema";

const hierarchyLevelLabels: Record<string, { label: string; color: string }> = {
  koncern: { label: "Koncern", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  brf: { label: "BRF", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  fastighet: { label: "Fastighet", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  rum: { label: "Rum", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  karl: { label: "Kärl", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
};

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

const PAGE_SIZE = 100;

export default function ObjectsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilterRaw] = useState("all");
  const [accessFilter, setAccessFilterRaw] = useState("all");
  const [customerFilter, setCustomerFilterRaw] = useState<string[]>([]);
  const [hierarchyFilter, setHierarchyFilterRaw] = useState("all");
  const [setupTimeRange, setSetupTimeRange] = useState<[number, number]>([0, 60]);
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [editingObject, setEditingObject] = useState<ServiceObject | null>(null);
  const [editField, setEditField] = useState<"accessCode" | "avgSetupTime" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [objectToCopy, setObjectToCopy] = useState<ServiceObject | null>(null);
  const [copyName, setCopyName] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [csvData, setCsvData] = useState("");
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyObject, setHistoryObject] = useState<ServiceObject | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const setTypeFilter = (v: string) => { setTypeFilterRaw(v); setCurrentPage(0); };
  const setAccessFilter = (v: string) => { setAccessFilterRaw(v); setCurrentPage(0); };
  const setCustomerFilter = (v: string[]) => { setCustomerFilterRaw(v); setCurrentPage(0); };
  const addCustomerFilter = (id: string) => { if (!customerFilter.includes(id)) { setCustomerFilter([...customerFilter, id]); } };
  const removeCustomerFilter = (id: string) => { setCustomerFilter(customerFilter.filter(c => c !== id)); };
  const setHierarchyFilter = (v: string) => { setHierarchyFilterRaw(v); setCurrentPage(0); };
  const [interimFilter, setInterimFilter] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [servicePatternDialog, setServicePatternDialog] = useState<{ open: boolean; loading: boolean; data?: { summary: string; patterns: { label: string; value: string }[]; anomalies: { objectId: string; objectName: string; reason: string }[] } }>({ open: false, loading: false });
  const [clusterDialog, setClusterDialog] = useState<{ open: boolean; loading: boolean; data?: { suggestions?: { suggestedName: string; objectCount: number; postalCodes: string[]; rationale: string }[]; message?: string } }>({ open: false, loading: false });
  const [maintenanceDialog, setMaintenanceDialog] = useState<{ open: boolean; loading: boolean; data?: { overdue: { objectName: string; predictedDate: string; daysUntil: number; confidence: number }[]; upcoming: { objectName: string; predictedDate: string; daysUntil: number; confidence: number }[]; summary: string; totalPredicted: number } }>({ open: false, loading: false });
  const [overflowPanel, setOverflowPanel] = useState<{ objectId: string; panel: "images" | "payers" | "parents" | "articles" } | null>(null);
  const [batchGeoOpen, setBatchGeoOpen] = useState(false);
  const [batchGeoCity, setBatchGeoCity] = useState("");
  const [batchGeoCluster, setBatchGeoCluster] = useState("");
  const [batchGeoLimit, setBatchGeoLimit] = useState(500);
  const [batchGeoRunning, setBatchGeoRunning] = useState(false);
  const [batchGeoResult, setBatchGeoResult] = useState<{ total: number; geocoded: number; updated: number; updatedIds?: string[] } | null>(null);
  const [batchGeoMapObjects, setBatchGeoMapObjects] = useState<ServiceObject[]>([]);
  const [batchGeoShowMap, setBatchGeoShowMap] = useState(false);
  const [batchGeoTab, setBatchGeoTab] = useState<string>("geocode");
  const [exploreCity, setExploreCity] = useState("");
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreData, setExploreData] = useState<{
    totalGeocoded: number;
    filteredCount: number;
    withEntrance: number;
    byCity: { city: string; count: number }[];
    objects: Array<{
      id: string; name: string; address: string; city: string; postalCode: string;
      latitude: number; longitude: number;
      entranceLatitude: number | null; entranceLongitude: number | null;
      objectType: string;
    }>;
  } | null>(null);
  const [newObject, setNewObject] = useState({
    name: "",
    objectType: "fastighet",
    accessType: "open",
    accessCode: "",
    address: "",
    customerId: "",
    latitude: null as number | null,
    longitude: null as number | null,
    city: "",
    postalCode: "",
    entranceLatitude: null as number | null,
    entranceLongitude: null as number | null,
    addressDescriptor: "",
  });

  // Debounce search for server-side filtering
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: objectsData, isLoading } = useQuery<{ objects: ServiceObject[]; total: number }>({
    queryKey: ["/api/objects", "paginated", currentPage, debouncedSearch, customerFilter, typeFilter, accessFilter, hierarchyFilter, interimFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: PAGE_SIZE.toString(),
        offset: (currentPage * PAGE_SIZE).toString(),
      });
      if (debouncedSearch) {
        params.append("search", debouncedSearch);
      }
      if (customerFilter.length > 0) {
        params.append("customerId", customerFilter.join(","));
      }
      if (typeFilter !== "all") {
        params.append("objectType", typeFilter);
      }
      if (accessFilter !== "all") {
        params.append("accessType", accessFilter);
      }
      if (hierarchyFilter !== "all") {
        params.append("hierarchyLevel", hierarchyFilter);
      }
      if (interimFilter) {
        params.append("interim", "true");
      }
      const res = await fetch(`/api/objects?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch objects");
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: interimCountData } = useQuery<{ total: number }>({
    queryKey: ["/api/objects", "interim-count"],
    queryFn: async () => {
      const res = await fetch("/api/objects?limit=0&offset=0&interim=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30000,
  });
  const interimCount = interimCountData?.total || 0;

  const objects = objectsData?.objects || [];
  const totalObjects = objectsData?.total || 0;
  const totalPages = Math.ceil(totalObjects / PAGE_SIZE);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
    staleTime: 60000,
  });

  const { data: setupLogs = [] } = useQuery<SetupTimeLog[]>({
    queryKey: ["/api/setup-time-logs"],
    staleTime: 60000,
  });

  const { data: batchGeoPreview, refetch: refetchPreview } = useQuery<{
    totalNeedsGeo: number;
    filteredCount: number;
    estimatedCost: number;
    byCity: Array<{ city: string; count: number }>;
    byCluster: Array<{ clusterId: string; clusterName: string; count: number }>;
    googleAvailable: boolean;
  }>({
    queryKey: ["/api/objects/batch-geocode/preview", batchGeoCity, batchGeoCluster, batchGeoLimit],
    queryFn: async () => {
      const body: any = {};
      if (batchGeoCity) body.city = batchGeoCity;
      if (batchGeoCluster) body.clusterId = batchGeoCluster;
      if (batchGeoLimit > 0) body.limit = batchGeoLimit;
      const res = await fetch("/api/objects/batch-geocode/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Preview failed");
      return res.json();
    },
    enabled: batchGeoOpen,
    staleTime: 30000,
  });

  const updateObjectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServiceObject> }) => {
      return apiRequest("PATCH", `/api/objects/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt uppdaterat" });
      setEditingObject(null);
      setEditField(null);
    },
    onError: () => {
      toast({ title: "Fel vid uppdatering", variant: "destructive" });
    },
  });

  const verifyObjectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PUT", `/api/objects/${id}/verify`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt verifierat", description: "Interimobjektet har verifierats och är nu ett vanligt objekt." });
    },
    onError: () => {
      toast({ title: "Fel vid verifiering", variant: "destructive" });
    },
  });

  const rejectObjectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PUT", `/api/objects/${id}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt avvisat", description: "Interimobjektet har avvisats." });
    },
    onError: () => {
      toast({ title: "Fel vid avvisning", variant: "destructive" });
    },
  });

  const createObjectMutation = useMutation({
    mutationFn: async (data: Partial<ServiceObject>) => {
      return apiRequest("POST", "/api/objects", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt skapat" });
      setCopyDialogOpen(false);
      setObjectToCopy(null);
      setCreateDialogOpen(false);
      setNewObject({ name: "", objectType: "fastighet", accessType: "open", accessCode: "", address: "", customerId: "", latitude: null, longitude: null, city: "", postalCode: "", entranceLatitude: null, entranceLongitude: null, addressDescriptor: "" });
    },
    onError: () => {
      toast({ title: "Fel vid skapande", variant: "destructive" });
    },
  });

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c.name])), [customers]);

  const topLevelObjects = useMemo(() => objects.filter(obj => !obj.parentId), [objects]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, ServiceObject[]>();
    for (const obj of objects) {
      if (obj.parentId) {
        const arr = map.get(obj.parentId);
        if (arr) {
          arr.push(obj);
        } else {
          map.set(obj.parentId, [obj]);
        }
      }
    }
    return map;
  }, [objects]);

  const getChildren = useCallback((parentId: string) => 
    childrenMap.get(parentId) || [], [childrenMap]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedAreas(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  }, []);

  const filteredObjects = useMemo(() => {
    return objects.filter(obj => {
      const setupTime = obj.avgSetupTime || 0;
      const matchesSetupTime = setupTime >= setupTimeRange[0] && setupTime <= setupTimeRange[1];
      return matchesSetupTime;
    });
  }, [objects, setupTimeRange]);

  const filteredTopLevel = useMemo(() => filteredObjects.filter(obj => !obj.parentId), [filteredObjects]);

  const activeFilterCount = useMemo(() => [
    typeFilter !== "all" ? 1 : 0,
    accessFilter !== "all" ? 1 : 0,
    customerFilter.length > 0 ? 1 : 0,
    hierarchyFilter !== "all" ? 1 : 0,
    (setupTimeRange[0] !== 0 || setupTimeRange[1] !== 60) ? 1 : 0,
  ].reduce((a, b) => a + b, 0), [typeFilter, accessFilter, customerFilter, hierarchyFilter, setupTimeRange]);

  const quickStats = useMemo(() => {
    const typeCounts: Record<string, number> = {};
    let totalSetup = 0;
    let setupCount = 0;
    let missingCity = 0;
    for (const obj of objects) {
      const label = objectTypeLabels[obj.objectType] || obj.objectType;
      typeCounts[label] = (typeCounts[label] || 0) + 1;
      if (obj.avgSetupTime && obj.avgSetupTime > 0) {
        totalSetup += obj.avgSetupTime;
        setupCount++;
      }
      if (!obj.city || obj.city.trim() === "") missingCity++;
    }
    const topTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return {
      topTypes,
      avgSetup: setupCount > 0 ? Math.round(totalSetup / setupCount) : 0,
      missingCity,
    };
  }, [objects]);

  const clearAllFilters = () => {
    setTypeFilter("all");
    setAccessFilter("all");
    setCustomerFilter([]);
    setHierarchyFilter("all");
    setSetupTimeRange([0, 60]);
  };

  const objectsWithCoords = useMemo(() => filteredObjects.filter(o => o.latitude && o.longitude), [filteredObjects]);
  const mapPositions = useMemo<[number, number][]>(() => objectsWithCoords.map(o => [o.latitude!, o.longitude!]), [objectsWithCoords]);

  const objectSetupLogs = useMemo(() => {
    if (!historyObject) return [];
    return setupLogs
      .filter(log => log.objectId === historyObject.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [setupLogs, historyObject]);

  const handleQuickEdit = useCallback((obj: ServiceObject, field: "accessCode" | "avgSetupTime") => {
    setEditingObject(obj);
    setEditField(field);
    setEditValue(field === "accessCode" ? (obj.accessCode || "") : (obj.avgSetupTime?.toString() || "0"));
  }, []);

  const saveQuickEdit = useCallback(() => {
    if (!editingObject || !editField) return;
    const data = editField === "accessCode" 
      ? { accessCode: editValue }
      : { avgSetupTime: parseInt(editValue) || 0 };
    updateObjectMutation.mutate({ id: editingObject.id, data });
  }, [editingObject, editField, editValue, updateObjectMutation]);

  const handleCopyObject = useCallback((obj: ServiceObject) => {
    setObjectToCopy(obj);
    setCopyName(`${obj.name} (kopia)`);
    setCopyDialogOpen(true);
  }, []);

  const executeCopy = () => {
    if (!objectToCopy) return;
    const newObj = {
      tenantId: objectToCopy.tenantId,
      customerId: objectToCopy.customerId,
      parentId: objectToCopy.parentId,
      name: copyName,
      objectNumber: `${objectToCopy.objectNumber}-COPY`,
      objectType: objectToCopy.objectType,
      objectLevel: objectToCopy.objectLevel,
      address: objectToCopy.address,
      city: objectToCopy.city,
      postalCode: objectToCopy.postalCode,
      latitude: objectToCopy.latitude,
      longitude: objectToCopy.longitude,
      accessType: objectToCopy.accessType,
      accessCode: objectToCopy.accessCode,
      keyNumber: objectToCopy.keyNumber,
      accessInfo: objectToCopy.accessInfo,
      containerCount: objectToCopy.containerCount,
      avgSetupTime: objectToCopy.avgSetupTime,
      status: "active",
    };
    createObjectMutation.mutate(newObj);
  };

  const handleImportCSV = async () => {
    const lines = csvData.trim().split("\n");
    if (lines.length < 2) {
      toast({ title: "CSV måste ha header och minst en rad", variant: "destructive" });
      return;
    }
    
    const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
    const dataLines = lines.slice(1);
    let successCount = 0;
    let errorCount = 0;
    
    for (const line of dataLines) {
      if (!line.trim()) continue;
      const values = line.split(",").map(v => v.replace(/"/g, "").trim());
      
      const nameIdx = headers.indexOf("namn");
      const typeIdx = headers.indexOf("typ");
      const addressIdx = headers.indexOf("adress");
      const cityIdx = headers.indexOf("stad");
      const accessIdx = headers.indexOf("tillgång");
      const codeIdx = headers.indexOf("kod");
      const setupIdx = headers.indexOf("ställtid");
      
      const name = nameIdx >= 0 ? values[nameIdx] : "";
      if (!name) {
        errorCount++;
        continue;
      }
      
      const typeMap: Record<string, string> = { "område": "omrade", "fastighet": "fastighet", "serviceboende": "serviceboende", "rum": "rum", "soprum": "soprum", "kök": "kok" };
      const accessMap: Record<string, string> = { "öppet": "open", "kod": "code", "nyckel/bricka": "key", "personligt möte": "meeting" };
      
      const newObj = {
        tenantId: "default-tenant",
        customerId: customers.length > 0 ? customers[0].id : "",
        name,
        objectType: typeIdx >= 0 ? (typeMap[values[typeIdx]?.toLowerCase()] || "fastighet") : "fastighet",
        objectLevel: 1,
        address: addressIdx >= 0 ? values[addressIdx] : null,
        city: cityIdx >= 0 ? values[cityIdx] : null,
        accessType: accessIdx >= 0 ? (accessMap[values[accessIdx]?.toLowerCase()] || "open") : "open",
        accessCode: codeIdx >= 0 ? values[codeIdx] : null,
        avgSetupTime: setupIdx >= 0 ? parseInt(values[setupIdx]) || 0 : 0,
        status: "active",
      };
      
      try {
        await apiRequest("POST", "/api/objects", newObj);
        successCount++;
      } catch {
        errorCount++;
      }
    }
    
    queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
    toast({ 
      title: "Import klar", 
      description: `${successCount} objekt importerade${errorCount > 0 ? `, ${errorCount} misslyckades` : ""}` 
    });
    setImportDialogOpen(false);
    setCsvData("");
  };

  const exportCSV = () => {
    const headers = ["Namn", "Objektnummer", "Typ", "Adress", "Stad", "Tillgång", "Kod", "Ställtid"];
    const rows = filteredObjects.map(obj => [
      obj.name,
      obj.objectNumber || "",
      objectTypeLabels[obj.objectType] || obj.objectType,
      obj.address || "",
      obj.city || "",
      accessTypeLabels[obj.accessType || "open"]?.label || obj.accessType,
      obj.accessCode || "",
      obj.avgSetupTime?.toString() || "0",
    ]);
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "objekt_export.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export klar", description: `${filteredObjects.length} objekt exporterade` });
  };

  const showHistory = useCallback((obj: ServiceObject) => {
    setHistoryObject(obj);
    setHistoryDialogOpen(true);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderObjectTree = (obj: ServiceObject, level: number = 0) => {
    const children = getChildren(obj.id);
    const isExpanded = expandedAreas.has(obj.id);
    const hasChildren = children.length > 0;
    const customerName = customerMap.get(obj.customerId) || "";
    const AccessIcon = accessTypeLabels[obj.accessType || "open"]?.icon || DoorOpen;
    const isEditing = editingObject?.id === obj.id;

    return (
      <div key={obj.id} className="border-b last:border-b-0">
        <div 
          className={`flex items-center gap-3 p-3 hover-elevate cursor-pointer ${level > 0 ? 'bg-muted/30' : ''}`}
          style={{ paddingLeft: `${12 + level * 24}px` }}
          data-testid={`object-row-${obj.id}`}
        >
          <div onClick={() => hasChildren && toggleExpand(obj.id)} className="shrink-0">
            {hasChildren ? (
              <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            ) : (
              <div className="w-4" />
            )}
          </div>
          
          <div className="flex-1 min-w-0" onClick={() => hasChildren && toggleExpand(obj.id)}>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-medium text-primary hover:underline cursor-pointer"
                onClick={(e) => { e.stopPropagation(); navigate(`/objects/${obj.id}`); }}
                data-testid={`link-object-detail-${obj.id}`}
              >
                {obj.name && obj.name !== "0" ? obj.name : obj.objectNumber || obj.name}
              </span>
              {obj.objectNumber && obj.name && obj.name !== "0" && (
                <span className="text-xs text-muted-foreground font-mono">{obj.objectNumber}</span>
              )}
              {obj.hierarchyLevel && hierarchyLevelLabels[obj.hierarchyLevel] && (
                <Badge className={`text-xs ${hierarchyLevelLabels[obj.hierarchyLevel].color}`}>
                  {hierarchyLevelLabels[obj.hierarchyLevel].label}
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {objectTypeLabels[obj.objectType] || obj.objectType}
              </Badge>
              {(obj as any).isInterimObject && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  Interim
                </Badge>
              )}
              {obj.accessType && obj.accessType !== "open" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs gap-1 cursor-help">
                      <AccessIcon className="h-3 w-3" />
                      {isEditing && editField === "accessCode" ? (
                        <Input 
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-5 w-16 text-xs px-1"
                          onClick={(e) => e.stopPropagation()}
                          data-testid="input-quick-edit-code"
                        />
                      ) : (
                        <span>{obj.accessCode || obj.keyNumber || accessTypeLabels[obj.accessType]?.label}</span>
                      )}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Tillgång: {accessTypeLabels[obj.accessType]?.label}
                    {obj.accessCode && ` - Kod: ${obj.accessCode}`}
                    {obj.keyNumber && ` - Nyckel: ${obj.keyNumber}`}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
              {obj.address && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 cursor-help">
                      <MapPin className="h-3 w-3" />
                      {obj.address}{obj.postalCode || obj.city ? ", " : ""}{[obj.postalCode, obj.city].filter(Boolean).join(" ")}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Adress</TooltipContent>
                </Tooltip>
              )}
              {(obj as any).entranceLatitude && (obj as any).entranceLongitude && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-green-600 cursor-help">
                      <DoorOpen className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Entrékoordinater tillgängliga
                    {(obj as any).addressDescriptor && (
                      <span className="block text-xs mt-1">{(obj as any).addressDescriptor}</span>
                    )}
                  </TooltipContent>
                </Tooltip>
              )}
              {obj.address && (!obj.city || obj.city.trim() === "") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 text-amber-500 cursor-help">
                      <AlertTriangle className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Stad saknas</TooltipContent>
                </Tooltip>
              )}
              {level === 0 && customerName && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 cursor-help text-foreground/70">
                      <Building2 className="h-3 w-3" />
                      {customerName}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Kund</TooltipContent>
                </Tooltip>
              )}
              {(obj.containerCount || 0) > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1 cursor-help">
                      <Trash2 className="h-3 w-3" />
                      {obj.containerCount} kärl
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Antal kärl (K1)</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <div className="text-right mr-2">
              {isEditing && editField === "avgSetupTime" ? (
                <Input 
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="h-6 w-14 text-xs px-1"
                  onClick={(e) => e.stopPropagation()}
                  data-testid="input-quick-edit-setup"
                />
              ) : (
                <>
                  {(obj.avgSetupTime || 0) > 0 ? (
                    <>
                      <div className="text-sm font-medium">{obj.avgSetupTime} min</div>
                      <div className="text-xs text-muted-foreground">ställtid</div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground/50">0 min</div>
                  )}
                </>
              )}
            </div>

            {isEditing ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); saveQuickEdit(); }} data-testid="button-save-edit">
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Spara</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingObject(null); setEditField(null); }} data-testid="button-cancel-edit">
                      <X className="h-4 w-4 text-red-600" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Avbryt</p></TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                {obj.accessType && obj.accessType !== "open" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); handleQuickEdit(obj, "accessCode"); }} data-testid={`button-edit-code-${obj.id}`}>
                        <Keyboard className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>Redigera kod</p></TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); handleQuickEdit(obj, "avgSetupTime"); }} data-testid={`button-edit-setup-${obj.id}`}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Redigera ställtid</p></TooltipContent>
                </Tooltip>
                <ObjectMetadataPanel object={obj} />
                <ObjectContactsDialog object={obj} />
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} data-testid={`button-more-actions-${obj.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleCopyObject(obj)} data-testid={`menu-copy-${obj.id}`}>
                      <Copy className="h-4 w-4 mr-2" />
                      Kopiera
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => showHistory(obj)} data-testid={`menu-history-${obj.id}`}>
                      <Clock className="h-4 w-4 mr-2" />
                      Ställtidshistorik
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setOverflowPanel({ objectId: obj.id, panel: "images" })} data-testid={`menu-images-${obj.id}`}>
                      <Image className="h-4 w-4 mr-2" />
                      Bilder
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setOverflowPanel({ objectId: obj.id, panel: "payers" })} data-testid={`menu-payers-${obj.id}`}>
                      <Users className="h-4 w-4 mr-2" />
                      Betalare
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setOverflowPanel({ objectId: obj.id, panel: "parents" })} data-testid={`menu-parents-${obj.id}`}>
                      <GitFork className="h-4 w-4 mr-2" />
                      Föräldrar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setOverflowPanel({ objectId: obj.id, panel: "articles" })} data-testid={`menu-articles-${obj.id}`}>
                      <Link2 className="h-4 w-4 mr-2" />
                      Artiklar & Priser
                    </DropdownMenuItem>
                    {(obj as any).isInterimObject && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); verifyObjectMutation.mutate(obj.id); }}
                          className="text-green-600"
                          data-testid={`menu-verify-${obj.id}`}
                        >
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          Verifiera objekt
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); rejectObjectMutation.mutate(obj.id); }}
                          className="text-red-600"
                          data-testid={`menu-reject-${obj.id}`}
                        >
                          <ShieldX className="h-4 w-4 mr-2" />
                          Avvisa objekt
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>

          {hasChildren && (
            <Badge variant="outline" className="shrink-0">
              {children.length} under
            </Badge>
          )}
        </div>

        {isExpanded && hasChildren && (
          <div>
            {children.map(child => renderObjectTree(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const defaultCenter: [number, number] = mapPositions.length > 0 
    ? mapPositions[0] 
    : [59.196, 17.626];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Objekt</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {filteredObjects.length} av {totalObjects.toLocaleString("sv")} objekt visas
            </span>
            {quickStats.topTypes.map(([label, count]) => (
              <Badge key={label} variant="secondary" className="text-xs font-normal">{count} {label}</Badge>
            ))}
            {quickStats.avgSetup > 0 && (
              <Badge variant="outline" className="text-xs font-normal">Snitt ställtid: {quickStats.avgSetup} min</Badge>
            )}
            {quickStats.missingCity > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs font-normal text-amber-600 border-amber-300 gap-1 cursor-help">
                    <AlertTriangle className="h-3 w-3" />
                    {quickStats.missingCity} utan stad
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Objekt som saknar stadsuppgift</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => { setBatchGeoOpen(true); setBatchGeoResult(null); }} data-testid="button-batch-geocode">
            <Globe className="h-4 w-4 mr-2" />
            Batch-geocodning
          </Button>
          <Button variant="outline" onClick={() => setImportDialogOpen(true)} data-testid="button-import">
            <Upload className="h-4 w-4 mr-2" />
            Importera CSV
          </Button>
          <Button variant="outline" onClick={exportCSV} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Exportera
          </Button>
          <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-add-object">
            <Plus className="h-4 w-4 mr-2" />
            Lägg till objekt
          </Button>
        </div>
      </div>

      <AICard
        title="AI Objektanalys"
        variant="compact"
        defaultExpanded={false}
        insights={[
          { type: "suggestion", title: "Servicemönster", description: "AI kan identifiera mönster i hur objekt servas för bättre planering", action: { label: "Analysera", onClick: async () => {
            setServicePatternDialog({ open: true, loading: true });
            try {
              const ids = filteredObjects.map(o => o.id);
              const res = await apiRequest("POST", "/api/ai/service-patterns", { objectIds: ids.length <= 200 ? ids : undefined });
              if (!res.ok) throw new Error("API error");
              const data = await res.json();
              setServicePatternDialog({ open: true, loading: false, data });
            } catch { toast({ title: "Fel", description: "Kunde inte analysera servicemönster", variant: "destructive" }); setServicePatternDialog({ open: true, loading: false, data: { summary: "Kunde inte analysera servicemönster.", patterns: [], anomalies: [] } }); }
          }}},
          { type: "optimization", title: "Gruppering", description: "Föreslå optimal gruppering av objekt baserat på geografi och servicebehov", action: { label: "Analysera", onClick: async () => {
            setClusterDialog({ open: true, loading: true });
            try {
              const ids = filteredObjects.map(o => o.id);
              const res = await apiRequest("POST", "/api/ai/auto-cluster", { objectIds: ids.length <= 200 ? ids : undefined });
              if (!res.ok) throw new Error("API error");
              const data = await res.json();
              setClusterDialog({ open: true, loading: false, data });
            } catch { toast({ title: "Fel", description: "Kunde inte generera klusterförslag", variant: "destructive" }); setClusterDialog({ open: true, loading: false, data: { message: "Kunde inte generera klusterförslag." } }); }
          }}},
          { type: "info", title: "Underhållsprognoser", description: "Prediktera kommande servicebehov baserat på historik", action: { label: "Analysera", onClick: async () => {
            setMaintenanceDialog({ open: true, loading: true });
            try {
              const ids = filteredObjects.map(o => o.id);
              const res = await apiRequest("POST", "/api/ai/predictive-maintenance", { objectIds: ids.length <= 200 ? ids : undefined });
              if (!res.ok) throw new Error("API error");
              const data = await res.json();
              setMaintenanceDialog({ open: true, loading: false, data });
            } catch { toast({ title: "Fel", description: "Kunde inte generera prognoser", variant: "destructive" }); setMaintenanceDialog({ open: true, loading: false, data: { overdue: [], upcoming: [], summary: "Kunde inte generera prognoser.", totalPredicted: 0 } }); }
          }}},
        ]}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Sök objekt, kund, adress, stad..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-objects"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiltersOpen(!filtersOpen)}
                className="gap-2"
                data-testid="button-toggle-filters"
              >
                <Filter className="h-4 w-4" />
                Filter
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                    {activeFilterCount}
                  </Badge>
                )}
                {filtersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
              <Button
                variant={interimFilter ? "default" : "outline"}
                size="sm"
                onClick={() => { setInterimFilter(!interimFilter); setCurrentPage(0); }}
                className="gap-2"
                data-testid="button-interim-filter"
              >
                <ShieldAlert className="h-4 w-4" />
                Interimobjekt
                {interimCount > 0 && (
                  <Badge variant={interimFilter ? "outline" : "destructive"} className="h-5 min-w-[20px] p-0 flex items-center justify-center text-xs rounded-full">
                    {interimCount}
                  </Badge>
                )}
              </Button>
              {(activeFilterCount > 0 || interimFilter) && (
                <Button variant="ghost" size="sm" onClick={() => { clearAllFilters(); setInterimFilter(false); }} className="gap-1 text-muted-foreground" data-testid="button-clear-filters">
                  <XCircle className="h-4 w-4" />
                  Rensa filter
                </Button>
              )}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              {typeFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setTypeFilter("all")} data-testid="badge-filter-type">
                  Typ: {objectTypeLabels[typeFilter] || typeFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {accessFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setAccessFilter("all")} data-testid="badge-filter-access">
                  Tillgång: {accessTypeLabels[accessFilter]?.label || accessFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {customerFilter.map(cId => (
                <Badge key={cId} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeCustomerFilter(cId)} data-testid={`badge-filter-customer-${cId}`}>
                  {customers.find(c => c.id === cId)?.name || cId}
                  <X className="h-3 w-3" />
                </Badge>
              ))}
              {hierarchyFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setHierarchyFilter("all")} data-testid="badge-filter-hierarchy">
                  Nivå: {hierarchyLevelLabels[hierarchyFilter]?.label || hierarchyFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {(setupTimeRange[0] !== 0 || setupTimeRange[1] !== 60) && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setSetupTimeRange([0, 60])} data-testid="badge-filter-setuptime">
                  Ställtid: {setupTimeRange[0]}-{setupTimeRange[1]} min
                  <X className="h-3 w-3" />
                </Badge>
              )}
            </div>
          )}
        </CardHeader>
        {filtersOpen && (
          <CardContent className="space-y-4 pt-0">
            <div className="flex items-center gap-4 flex-wrap">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
                  <SelectValue placeholder="Objekttyp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla typer</SelectItem>
                  {Object.entries(objectTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={accessFilter} onValueChange={setAccessFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-access-filter">
                  <SelectValue placeholder="Tillgångstyp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla tillgångar</SelectItem>
                  {Object.entries(accessTypeLabels).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value="" onValueChange={(v) => { if (v === "__clear__") { setCustomerFilter([]); } else if (v && v !== "__none__") { addCustomerFilter(v); } }}>
                <SelectTrigger className="w-[180px]" data-testid="select-customer-filter">
                  <SelectValue placeholder={customerFilter.length > 0 ? `${customerFilter.length} kunder valda` : "Filtrera kund"} />
                </SelectTrigger>
                <SelectContent>
                  {customerFilter.length > 0 && (
                    <SelectItem value="__clear__" data-testid="select-customer-clear">
                      Rensa alla kunder
                    </SelectItem>
                  )}
                  {customers.filter(c => !customerFilter.includes(c.id)).map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                  {customers.filter(c => !customerFilter.includes(c.id)).length === 0 && customerFilter.length > 0 && (
                    <SelectItem value="__none__" disabled>Alla kunder valda</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Select value={hierarchyFilter} onValueChange={setHierarchyFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-hierarchy-filter">
                  <SelectValue placeholder="Nivå" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla nivåer</SelectItem>
                  {Object.entries(hierarchyLevelLabels).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <Label className="text-sm text-muted-foreground shrink-0">Ställtid: {setupTimeRange[0]}-{setupTimeRange[1]} min</Label>
              <Slider
                value={setupTimeRange}
                onValueChange={(v) => setSetupTimeRange(v as [number, number])}
                min={0}
                max={60}
                step={5}
                className="w-64"
                data-testid="slider-setup-time"
              />
            </div>
          </CardContent>
        )}
      </Card>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "map")}>
        <TabsList>
          <TabsTrigger value="list" className="gap-2" data-testid="tab-list">
            <List className="h-4 w-4" />
            Lista
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-2" data-testid="tab-map">
            <MapIcon className="h-4 w-4" />
            Karta
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <div className="border rounded-md bg-card">
            {filteredTopLevel.length > 0 ? (
              filteredTopLevel.map(obj => renderObjectTree(obj))
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Inga objekt hittades</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <ObjectsMapTab
            objectsWithCoords={objectsWithCoords}
            mapPositions={mapPositions}
            defaultCenter={defaultCenter}
          />
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 mt-4 px-2">
          <div className="text-sm text-muted-foreground">
            Visar {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, totalObjects)} av {totalObjects.toLocaleString("sv-SE")} objekt
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
              Föregående
            </Button>
            <span className="text-sm px-2">
              Sida {currentPage + 1} av {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              data-testid="button-next-page"
            >
              Nästa
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kopiera objekt</DialogTitle>
            <DialogDescription>
              Skapa en kopia av {objectToCopy?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="copy-name">Namn på kopian</Label>
              <Input 
                id="copy-name"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                data-testid="input-copy-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>Avbryt</Button>
            <Button onClick={executeCopy} disabled={createObjectMutation.isPending} data-testid="button-confirm-copy">
              {createObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              Kopiera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Importera objekt från CSV
            </DialogTitle>
            <DialogDescription>
              Klistra in CSV-data med header: Namn, Objektnummer, Typ, Adress, Stad, Tillgång, Kod, Ställtid
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <textarea
              className="w-full h-48 p-3 text-sm font-mono border rounded-md bg-muted"
              placeholder="Namn,Objektnummer,Typ,Adress,Stad,Tillgång,Kod,Ställtid
Fastighet A,FAST-100,fastighet,Storgatan 1,Stockholm,code,1234,10"
              value={csvData}
              onChange={(e) => setCsvData(e.target.value)}
              data-testid="textarea-csv-import"
            />
            <p className="text-xs text-muted-foreground">
              Tips: Exportera först för att se korrekt format
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Avbryt</Button>
            <Button onClick={handleImportCSV} data-testid="button-confirm-import">
              <Upload className="h-4 w-4 mr-2" />
              Importera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Ställtidshistorik - {historyObject?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {objectSetupLogs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Ingen ställtidshistorik registrerad för detta objekt
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-2xl font-semibold">
                      {Math.round(objectSetupLogs.reduce((s, l) => s + l.durationMinutes, 0) / objectSetupLogs.length)}
                    </div>
                    <div className="text-xs text-muted-foreground">min snitt</div>
                  </div>
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-2xl font-semibold">
                      {Math.min(...objectSetupLogs.map(l => l.durationMinutes))}
                    </div>
                    <div className="text-xs text-muted-foreground">min min</div>
                  </div>
                  <div className="p-3 bg-muted rounded-md">
                    <div className="text-2xl font-semibold">
                      {Math.max(...objectSetupLogs.map(l => l.durationMinutes))}
                    </div>
                    <div className="text-xs text-muted-foreground">min max</div>
                  </div>
                </div>
                <div className="divide-y max-h-64 overflow-auto">
                  {objectSetupLogs.slice(0, 10).map(log => (
                    <div key={log.id} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="text-sm">{log.category}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(log.createdAt).toLocaleDateString("sv-SE")}
                        </div>
                      </div>
                      <Badge variant="secondary">{log.durationMinutes} min</Badge>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogOpen(false)}>Stäng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create object dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skapa nytt objekt</DialogTitle>
            <DialogDescription>
              Fyll i uppgifterna för det nya objektet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Namn</Label>
              <Input
                value={newObject.name}
                onChange={(e) => setNewObject({ ...newObject, name: e.target.value })}
                placeholder="Objektnamn"
                data-testid="input-new-object-name"
              />
            </div>
            <div>
              <Label>Objekttyp</Label>
              <Select value={newObject.objectType} onValueChange={(v) => setNewObject({ ...newObject, objectType: v })}>
                <SelectTrigger data-testid="select-new-object-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(objectTypeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tillgångstyp</Label>
              <Select value={newObject.accessType} onValueChange={(v) => setNewObject({ ...newObject, accessType: v })}>
                <SelectTrigger data-testid="select-new-access-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(accessTypeLabels).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(newObject.accessType === "code" || newObject.accessType === "key") && (
              <div>
                <Label>{newObject.accessType === "code" ? "Kod" : "Nyckelnummer"}</Label>
                <Input
                  value={newObject.accessCode}
                  onChange={(e) => setNewObject({ ...newObject, accessCode: e.target.value })}
                  placeholder={newObject.accessType === "code" ? "Portkod" : "Nyckelnummer"}
                  data-testid="input-new-access-code"
                />
              </div>
            )}
            <div>
              <Label>Adress</Label>
              <AddressSearch
                defaultValue={newObject.address}
                placeholder="Sök gatuadress..."
                onSelect={(result) => setNewObject({
                  ...newObject,
                  address: result.address,
                  latitude: result.lat,
                  longitude: result.lon,
                  city: result.city || "",
                  postalCode: result.postalCode || "",
                  entranceLatitude: result.entranceLat || null,
                  entranceLongitude: result.entranceLon || null,
                  addressDescriptor: result.addressDescriptor || "",
                })}
              />
            </div>
            <div>
              <Label>Kund</Label>
              <Select value={newObject.customerId || "none"} onValueChange={(v) => setNewObject({ ...newObject, customerId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-new-customer">
                  <SelectValue placeholder="Välj kund" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen kund</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Avbryt</Button>
            <Button 
              onClick={() => createObjectMutation.mutate({
                name: newObject.name,
                objectType: newObject.objectType,
                accessType: newObject.accessType,
                accessCode: newObject.accessCode || undefined,
                address: newObject.address || undefined,
                customerId: newObject.customerId || undefined,
                latitude: newObject.latitude || undefined,
                longitude: newObject.longitude || undefined,
                city: newObject.city || undefined,
                postalCode: newObject.postalCode || undefined,
                entranceLatitude: newObject.entranceLatitude || undefined,
                entranceLongitude: newObject.entranceLongitude || undefined,
                addressDescriptor: newObject.addressDescriptor || undefined,
              })} 
              disabled={!newObject.name || createObjectMutation.isPending}
              data-testid="button-create-object"
            >
              {createObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Skapa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchGeoOpen} onOpenChange={(v) => { if (!batchGeoRunning) { setBatchGeoOpen(v); setBatchGeoShowMap(false); } }}>
        <DialogContent className={(batchGeoShowMap || (exploreData?.objects?.length ?? 0) > 0) ? "max-w-5xl max-h-[90vh] overflow-y-auto" : "max-w-2xl"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Geocodning & kartvy
            </DialogTitle>
            <DialogDescription>
              Geocoda nya objekt eller utforska redan geocodade objekt på kartan.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={batchGeoTab} onValueChange={(v) => {
            setBatchGeoTab(v);
            if (v === "explore" && !exploreData) {
              setExploreLoading(true);
              fetch("/api/objects/geocoded", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ limit: 0 }),
              }).then(r => r.ok ? r.json() : null).then(data => {
                if (data) setExploreData({ ...data, objects: [] });
              }).finally(() => setExploreLoading(false));
            }
          }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="geocode" data-testid="tab-batch-geocode">
                <Globe className="h-4 w-4 mr-2" />
                Geocoda
              </TabsTrigger>
              <TabsTrigger value="explore" data-testid="tab-explore-geocoded">
                <MapIcon className="h-4 w-4 mr-2" />
                Utforska geocodade
              </TabsTrigger>
            </TabsList>

            <TabsContent value="geocode" className="space-y-4 mt-4">
              {batchGeoPreview && !batchGeoPreview.googleAvailable && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Geoapify API-nyckel saknas. Kontrollera att GEOAPIFY_API_KEY är konfigurerad.
                </div>
              )}

              {!batchGeoResult && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Filtrera per stad</Label>
                      <Select value={batchGeoCity || "all"} onValueChange={(v) => setBatchGeoCity(v === "all" ? "" : v)}>
                        <SelectTrigger data-testid="select-batch-geo-city">
                          <SelectValue placeholder="Alla städer" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alla städer</SelectItem>
                          {batchGeoPreview?.byCity.map(({ city, count }) => (
                            <SelectItem key={city} value={city}>{city} ({count} st)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Filtrera per kluster</Label>
                      <Select value={batchGeoCluster || "all"} onValueChange={(v) => setBatchGeoCluster(v === "all" ? "" : v)}>
                        <SelectTrigger data-testid="select-batch-geo-cluster">
                          <SelectValue placeholder="Alla kluster" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Alla kluster</SelectItem>
                          {batchGeoPreview?.byCluster.map(({ clusterId, clusterName, count }) => (
                            <SelectItem key={clusterId} value={clusterId}>{clusterName} ({count} st)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Max antal objekt per körning: {batchGeoLimit}</Label>
                    <Slider
                      value={[batchGeoLimit]}
                      onValueChange={([v]) => setBatchGeoLimit(v)}
                      min={10}
                      max={5000}
                      step={10}
                      className="mt-2"
                      data-testid="slider-batch-geo-limit"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>10</span>
                      <span>5 000</span>
                    </div>
                  </div>

                  {batchGeoPreview && (
                    <Card>
                      <CardContent className="pt-4 space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <div className="text-2xl font-bold" data-testid="text-batch-geo-total">{batchGeoPreview.totalNeedsGeo.toLocaleString("sv-SE")}</div>
                            <div className="text-xs text-muted-foreground">Totalt utan entrékoord.</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-primary" data-testid="text-batch-geo-filtered">{batchGeoPreview.filteredCount.toLocaleString("sv-SE")}</div>
                            <div className="text-xs text-muted-foreground">Matchas av filter</div>
                          </div>
                          <div>
                            <div className="text-2xl font-bold text-orange-500" data-testid="text-batch-geo-cost">${batchGeoPreview.estimatedCost.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground">Uppskattad kostnad</div>
                          </div>
                        </div>

                        {batchGeoPreview.byCity.length > 0 && (
                          <div>
                            <div className="text-sm font-medium mb-2">Nedbrytning per stad (topp 10)</div>
                            <div className="grid grid-cols-2 gap-1 text-sm">
                              {batchGeoPreview.byCity.slice(0, 10).map(({ city, count }) => (
                                <div key={city} className="flex justify-between px-2 py-1 rounded bg-muted/50">
                                  <span className="truncate">{city}</span>
                                  <span className="font-medium ml-2">{count.toLocaleString("sv-SE")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setBatchGeoOpen(false)} data-testid="button-batch-geo-close">
                      Avbryt
                    </Button>
                    <Button
                      onClick={async () => {
                        setBatchGeoRunning(true);
                        setBatchGeoResult(null);
                        try {
                          const body: any = {};
                          if (batchGeoCity) body.city = batchGeoCity;
                          if (batchGeoCluster) body.clusterId = batchGeoCluster;
                          if (batchGeoLimit > 0) body.limit = batchGeoLimit;
                          const res = await fetch("/api/objects/batch-geocode", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify(body),
                          });
                          if (!res.ok) throw new Error("Batch geocode failed");
                          const result = await res.json();
                          setBatchGeoResult(result);
                          setBatchGeoShowMap(false);
                          setBatchGeoMapObjects([]);
                          queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
                          toast({ title: `${result.updated} objekt uppdaterade med entrékoordinater` });
                          if (result.updatedIds?.length > 0) {
                            try {
                              const objRes = await fetch("/api/objects/by-ids", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                                body: JSON.stringify({ ids: result.updatedIds }),
                              });
                              if (objRes.ok) {
                                const objs = await objRes.json();
                                setBatchGeoMapObjects(objs);
                              }
                            } catch {}
                          }
                        } catch (error) {
                          toast({ title: "Batch-geocodning misslyckades", variant: "destructive" });
                        } finally {
                          setBatchGeoRunning(false);
                        }
                      }}
                      disabled={batchGeoRunning || !batchGeoPreview?.googleAvailable || batchGeoPreview?.filteredCount === 0}
                      data-testid="button-start-batch-geocode"
                    >
                      {batchGeoRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Globe className="h-4 w-4 mr-2" />}
                      Starta geocodning ({batchGeoPreview?.filteredCount || 0} objekt)
                    </Button>
                  </div>
                </>
              )}

              {batchGeoRunning && (
                <div className="space-y-3 py-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Geocodning pågår...
                  </div>
                  <Progress value={undefined} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    Detta kan ta en stund beroende på antal objekt. Stäng inte dialogen.
                  </p>
                </div>
              )}

              {batchGeoResult && !batchGeoRunning && (
                <div className="space-y-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Check className="h-5 w-5 text-green-500" />
                          <span className="font-medium">Batch-geocodning klar</span>
                        </div>
                        {batchGeoMapObjects.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setBatchGeoShowMap(!batchGeoShowMap)}
                            data-testid="button-toggle-batch-geo-map"
                          >
                            <MapIcon className="h-4 w-4 mr-2" />
                            {batchGeoShowMap ? "Dölj karta" : "Visa på karta"}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold">{batchGeoResult.total}</div>
                          <div className="text-xs text-muted-foreground">Skickade</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-green-500">{batchGeoResult.geocoded}</div>
                          <div className="text-xs text-muted-foreground">Geocodade</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-blue-500">{batchGeoResult.updated}</div>
                          <div className="text-xs text-muted-foreground">Uppdaterade</div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3">
                        Kostnad: ${(batchGeoResult.total * 0.005).toFixed(2)}
                      </p>
                    </CardContent>
                  </Card>

                  {batchGeoShowMap && batchGeoMapObjects.length > 0 && (
                    <GeocodedObjectsMap objects={batchGeoMapObjects} />
                  )}

                  <div className="flex justify-end">
                    <Button variant="outline" onClick={() => { setBatchGeoResult(null); setBatchGeoShowMap(false); setBatchGeoMapObjects([]); }} data-testid="button-batch-geo-new-run">
                      Ny körning
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="explore" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Välj stad</Label>
                  <Select
                    value={exploreCity || "all"}
                    onValueChange={async (v) => {
                      const city = v === "all" ? "" : v;
                      setExploreCity(city);
                      setExploreLoading(true);
                      try {
                        const res = await fetch("/api/objects/geocoded", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ city: city || undefined, limit: 1000 }),
                        });
                        if (res.ok) {
                          setExploreData(await res.json());
                        }
                      } catch {} finally {
                        setExploreLoading(false);
                      }
                    }}
                    data-testid="select-explore-city"
                  >
                    <SelectTrigger data-testid="select-explore-city-trigger">
                      <SelectValue placeholder="Välj stad..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alla städer</SelectItem>
                      {(exploreData?.byCity || []).map(({ city, count }) => (
                        <SelectItem key={city} value={city}>{city} ({count} st)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={async () => {
                      setExploreLoading(true);
                      try {
                        const res = await fetch("/api/objects/geocoded", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ city: exploreCity || undefined, limit: 1000 }),
                        });
                        if (res.ok) {
                          setExploreData(await res.json());
                        }
                      } catch {} finally {
                        setExploreLoading(false);
                      }
                    }}
                    disabled={exploreLoading}
                    data-testid="button-load-geocoded"
                  >
                    {exploreLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapIcon className="h-4 w-4 mr-2" />}
                    Visa på karta
                  </Button>
                </div>
              </div>

              {exploreData && (
                <Card>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold" data-testid="text-explore-total">{exploreData.totalGeocoded.toLocaleString("sv-SE")}</div>
                        <div className="text-xs text-muted-foreground">Totalt geocodade</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-blue-500" data-testid="text-explore-filtered">
                          {exploreData.objects.length > 0 ? exploreData.objects.length.toLocaleString("sv-SE") : exploreData.filteredCount.toLocaleString("sv-SE")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {exploreData.objects.length > 0 ? "Visar på karta" : `Matchade${exploreCity ? ` i ${exploreCity}` : ""}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-500" data-testid="text-explore-entrance">{exploreData.withEntrance.toLocaleString("sv-SE")}</div>
                        <div className="text-xs text-muted-foreground">Med entrékoord.</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {exploreData && exploreData.objects.length > 0 && (
                <GeocodedObjectsMap objects={exploreData.objects as any} />
              )}

              {exploreData && exploreData.objects.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <MapIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Inga geocodade objekt hittades{exploreCity ? ` i ${exploreCity}` : ""}.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {overflowPanel && (() => {
        const panelObj = objects.find(o => o.id === overflowPanel.objectId);
        if (!panelObj) return null;
        const closePanel = () => setOverflowPanel(null);
        switch (overflowPanel.panel) {
          case "images":
            return <ObjectImagesDialog object={panelObj} controlled open onOpenChange={(v) => { if (!v) closePanel(); }} />;
          case "payers":
            return <ObjectPayersPanel object={panelObj} controlled open onOpenChange={(v) => { if (!v) closePanel(); }} />;
          case "parents":
            return <ObjectParentsPanel object={panelObj} controlled open onOpenChange={(v) => { if (!v) closePanel(); }} />;
          case "articles":
            return <ObjectApplicableArticlesPanel object={panelObj} controlled open onOpenChange={(v) => { if (!v) closePanel(); }} />;
          default:
            return null;
        }
      })()}

      <Dialog open={servicePatternDialog.open} onOpenChange={(v) => { if (!v) setServicePatternDialog({ open: false, loading: false }); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-service-pattern-title">
              <BarChart3 className="h-5 w-5 text-blue-500" />
              Servicemönster — AI-analys
            </DialogTitle>
            <DialogDescription>Analys av servicehistorik och mönster för filtrerade objekt</DialogDescription>
          </DialogHeader>
          {servicePatternDialog.loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <p className="text-sm text-muted-foreground">AI analyserar servicemönster...</p>
            </div>
          ) : servicePatternDialog.data && (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-purple-500/5 border border-purple-500/20">
                <p className="text-sm" data-testid="text-service-pattern-summary">{servicePatternDialog.data.summary}</p>
              </div>
              {servicePatternDialog.data.patterns.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Statistik</p>
                  {servicePatternDialog.data.patterns.map((p, i) => (
                    <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                      <span className="text-sm">{p.label}</span>
                      <span className="text-sm font-medium" data-testid={`text-pattern-value-${i}`}>{p.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {servicePatternDialog.data.anomalies.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    Avvikande objekt ({servicePatternDialog.data.anomalies.length})
                  </p>
                  {servicePatternDialog.data.anomalies.map((a, i) => (
                    <div key={i} className="p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                      <p className="text-sm font-medium">{a.objectName}</p>
                      <p className="text-xs text-muted-foreground">{a.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={clusterDialog.open} onOpenChange={(v) => { if (!v) setClusterDialog({ open: false, loading: false }); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-cluster-title">
              <MapIcon className="h-5 w-5 text-purple-500" />
              Gruppering — AI-förslag
            </DialogTitle>
            <DialogDescription>Förslag på optimal geografisk gruppering av objekt</DialogDescription>
          </DialogHeader>
          {clusterDialog.loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <p className="text-sm text-muted-foreground">AI analyserar gruppering...</p>
            </div>
          ) : clusterDialog.data && (
            <div className="space-y-4">
              {clusterDialog.data.message && (
                <div className="p-3 rounded-md bg-purple-500/5 border border-purple-500/20">
                  <p className="text-sm" data-testid="text-cluster-message">{clusterDialog.data.message}</p>
                </div>
              )}
              {clusterDialog.data.suggestions && clusterDialog.data.suggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {clusterDialog.data.suggestions.length} kluster föreslagna
                  </p>
                  {clusterDialog.data.suggestions.map((s, i) => (
                    <div key={i} className="p-3 rounded-md bg-background border border-border/50" data-testid={`card-cluster-suggestion-${i}`}>
                      <div className="flex justify-between items-start">
                        <p className="text-sm font-medium">{s.suggestedName}</p>
                        <Badge variant="secondary" className="text-xs">{s.objectCount} objekt</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{s.rationale}</p>
                      {s.postalCodes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {s.postalCodes.slice(0, 6).map((pc, j) => (
                            <Badge key={j} variant="outline" className="text-xs">{pc}</Badge>
                          ))}
                          {s.postalCodes.length > 6 && <Badge variant="outline" className="text-xs">+{s.postalCodes.length - 6}</Badge>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {(!clusterDialog.data.suggestions || clusterDialog.data.suggestions.length === 0) && !clusterDialog.data.message && (
                <p className="text-sm text-muted-foreground text-center py-4">Inga klusterförslag genererade. Kontrollera att objekt har adresser.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={maintenanceDialog.open} onOpenChange={(v) => { if (!v) setMaintenanceDialog({ open: false, loading: false }); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-maintenance-title">
              <Clock className="h-5 w-5 text-green-500" />
              Underhållsprognoser
            </DialogTitle>
            <DialogDescription>Predikterade servicebehov baserat på historisk data</DialogDescription>
          </DialogHeader>
          {maintenanceDialog.loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
              <p className="text-sm text-muted-foreground">Beräknar underhållsprognoser...</p>
            </div>
          ) : maintenanceDialog.data && (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-green-500/5 border border-green-500/20">
                <p className="text-sm" data-testid="text-maintenance-summary">{maintenanceDialog.data.summary}</p>
              </div>
              {maintenanceDialog.data.overdue.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-red-500 uppercase tracking-wide flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Försenade ({maintenanceDialog.data.overdue.length})
                  </p>
                  {maintenanceDialog.data.overdue.map((item, i) => (
                    <div key={i} className="flex justify-between items-center p-2 rounded-md bg-red-500/5 border border-red-500/20">
                      <div>
                        <p className="text-sm font-medium">{item.objectName}</p>
                        <p className="text-xs text-muted-foreground">Förväntad: {item.predictedDate}</p>
                      </div>
                      <Badge variant="destructive" className="text-xs">{Math.abs(item.daysUntil)}d försenad</Badge>
                    </div>
                  ))}
                </div>
              )}
              {maintenanceDialog.data.upcoming.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kommande ({maintenanceDialog.data.upcoming.length})</p>
                  {maintenanceDialog.data.upcoming.map((item, i) => (
                    <div key={i} className="flex justify-between items-center p-2 rounded-md bg-background border border-border/50">
                      <div>
                        <p className="text-sm font-medium">{item.objectName}</p>
                        <p className="text-xs text-muted-foreground">Förväntad: {item.predictedDate}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">{item.daysUntil}d kvar ({item.confidence}%)</Badge>
                    </div>
                  ))}
                </div>
              )}
              {maintenanceDialog.data.overdue.length === 0 && maintenanceDialog.data.upcoming.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Ingen tillräcklig historik för att generera prognoser.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
