import { useState, useMemo } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { 
  Search, Plus, Filter, Loader2, ChevronRight, Building2, MapPin, Trash2, 
  Map as MapIcon, List, Edit2, Copy, Upload, Clock, Key, Keyboard, Users, DoorOpen,
  Check, X, FileSpreadsheet, Download, BarChart3
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ServiceObject, Customer, SetupTimeLog } from "@shared/schema";

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

function MapFitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  if (positions.length > 0) {
    const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [50, 50] });
  }
  return null;
}

export default function ObjectsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
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

  const { data: objects = [], isLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: setupLogs = [] } = useQuery<SetupTimeLog[]>({
    queryKey: ["/api/setup-time-logs"],
  });

  const updateObjectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServiceObject> }) => {
      return apiRequest("PATCH", `/api/objects/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Objekt uppdaterat" });
      setEditingObject(null);
      setEditField(null);
    },
    onError: () => {
      toast({ title: "Fel vid uppdatering", variant: "destructive" });
    },
  });

  const createObjectMutation = useMutation({
    mutationFn: async (data: Partial<ServiceObject>) => {
      return apiRequest("POST", "/api/objects", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Objekt skapat" });
      setCopyDialogOpen(false);
      setObjectToCopy(null);
    },
    onError: () => {
      toast({ title: "Fel vid skapande", variant: "destructive" });
    },
  });

  const customerMap = new Map(customers.map(c => [c.id, c.name]));

  const topLevelObjects = objects.filter(obj => !obj.parentId);

  const getChildren = (parentId: string) => 
    objects.filter(obj => obj.parentId === parentId);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedAreas);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedAreas(newExpanded);
  };

  const filteredObjects = useMemo(() => {
    return objects.filter(obj => {
      const customerName = customerMap.get(obj.customerId) || "";
      const matchesSearch = 
        obj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (obj.objectNumber || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (obj.address || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (obj.city || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = typeFilter === "all" || obj.objectType === typeFilter;
      const matchesAccess = accessFilter === "all" || obj.accessType === accessFilter;
      const matchesCustomer = customerFilter === "all" || obj.customerId === customerFilter;
      const setupTime = obj.avgSetupTime || 0;
      const matchesSetupTime = setupTime >= setupTimeRange[0] && setupTime <= setupTimeRange[1];
      return matchesSearch && matchesType && matchesAccess && matchesCustomer && matchesSetupTime;
    });
  }, [objects, searchQuery, typeFilter, accessFilter, customerFilter, setupTimeRange, customerMap]);

  const filteredTopLevel = filteredObjects.filter(obj => !obj.parentId);

  const objectsWithCoords = filteredObjects.filter(o => o.latitude && o.longitude);
  const mapPositions: [number, number][] = objectsWithCoords.map(o => [o.latitude!, o.longitude!]);

  const objectSetupLogs = useMemo(() => {
    if (!historyObject) return [];
    return setupLogs
      .filter(log => log.objectId === historyObject.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [setupLogs, historyObject]);

  const handleQuickEdit = (obj: ServiceObject, field: "accessCode" | "avgSetupTime") => {
    setEditingObject(obj);
    setEditField(field);
    setEditValue(field === "accessCode" ? (obj.accessCode || "") : (obj.avgSetupTime?.toString() || "0"));
  };

  const saveQuickEdit = () => {
    if (!editingObject || !editField) return;
    const data = editField === "accessCode" 
      ? { accessCode: editValue }
      : { avgSetupTime: parseInt(editValue) || 0 };
    updateObjectMutation.mutate({ id: editingObject.id, data });
  };

  const handleCopyObject = (obj: ServiceObject) => {
    setObjectToCopy(obj);
    setCopyName(`${obj.name} (kopia)`);
    setCopyDialogOpen(true);
  };

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
    
    queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
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

  const showHistory = (obj: ServiceObject) => {
    setHistoryObject(obj);
    setHistoryDialogOpen(true);
  };

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
              <span className="font-medium">{obj.name}</span>
              <Badge variant="secondary" className="text-xs">
                {objectTypeLabels[obj.objectType] || obj.objectType}
              </Badge>
              {obj.accessType && obj.accessType !== "open" && (
                <Badge variant="outline" className="text-xs gap-1">
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
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
              {obj.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {obj.address}, {obj.city}
                </span>
              )}
              {level === 0 && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {customerName}
                </span>
              )}
              {(obj.containerCount || 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Trash2 className="h-3 w-3" />
                  {obj.containerCount} kärl
                </span>
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
                  <div className="text-sm font-medium">{obj.avgSetupTime || 0} min</div>
                  <div className="text-xs text-muted-foreground">ställtid</div>
                </>
              )}
            </div>

            {isEditing ? (
              <>
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); saveQuickEdit(); }} data-testid="button-save-edit">
                  <Check className="h-4 w-4 text-green-600" />
                </Button>
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingObject(null); setEditField(null); }} data-testid="button-cancel-edit">
                  <X className="h-4 w-4 text-red-600" />
                </Button>
              </>
            ) : (
              <>
                {obj.accessType && obj.accessType !== "open" && (
                  <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); handleQuickEdit(obj, "accessCode"); }} title="Redigera kod" data-testid={`button-edit-code-${obj.id}`}>
                    <Keyboard className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); handleQuickEdit(obj, "avgSetupTime"); }} title="Redigera ställtid" data-testid={`button-edit-setup-${obj.id}`}>
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); handleCopyObject(obj); }} data-testid={`button-copy-${obj.id}`}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); showHistory(obj); }} data-testid={`button-history-${obj.id}`}>
                  <Clock className="h-4 w-4" />
                </Button>
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
          <p className="text-sm text-muted-foreground">
            {filteredObjects.length} av {objects.length} objekt visas
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setImportDialogOpen(true)} data-testid="button-import">
            <Upload className="h-4 w-4 mr-2" />
            Importera CSV
          </Button>
          <Button variant="outline" onClick={exportCSV} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Exportera
          </Button>
          <Button onClick={() => console.log("Add object clicked")} data-testid="button-add-object">
            <Plus className="h-4 w-4 mr-2" />
            Lägg till objekt
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
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
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-customer-filter">
                <SelectValue placeholder="Kund" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla kunder</SelectItem>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
          <Card className="h-[500px] overflow-hidden">
            <CardContent className="p-0 h-full relative">
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
                {mapPositions.length > 0 && <MapFitBounds positions={mapPositions} />}
                {objectsWithCoords.map(obj => (
                  <Marker
                    key={obj.id}
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
