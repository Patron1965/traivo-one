import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Building2, MapPin, Key, Keyboard, Users, DoorOpen,
  Clock, Package, FileText, Image, Contact, GitFork, AlertTriangle,
  Calendar, Loader2, ChevronRight, ExternalLink, Wrench, Shield,
  Hash, Truck, Timer, Info, Box, Layers, ClipboardList
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ServiceObject, WorkOrder } from "@shared/schema";

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
  miljokarl: "Miljökärl",
  underjord: "Underjordsbehållare",
};

const accessTypeLabels: Record<string, { label: string; icon: typeof Key }> = {
  open: { label: "Öppet", icon: DoorOpen },
  code: { label: "Kod", icon: Keyboard },
  key: { label: "Nyckel/bricka", icon: Key },
  meeting: { label: "Personligt möte", icon: Users },
};

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

const workOrderStatusColors: Record<string, string> = {
  unassigned: "bg-gray-100 text-gray-800",
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

function InfoRow({ label, value, icon: Icon }: { label: string; value: string | number | null | undefined; icon?: any }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-medium break-words">{String(value)}</div>
      </div>
    </div>
  );
}

function InheritedInfoRow({ label, value, inherited, source, icon: Icon }: {
  label: string;
  value: string | number | null | undefined;
  inherited?: boolean;
  source?: string;
  icon?: any;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-3 py-2">
      {Icon && <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          {label}
          {inherited && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 cursor-help">
                  Ärvd
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Ärvd från: {source || "förälder"}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="text-sm font-medium break-words">{String(value)}</div>
      </div>
    </div>
  );
}

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function ObjectDetailPage() {
  const [, params] = useRoute("/objects/:id");
  const [, navigate] = useLocation();
  const objectId = params?.id || "";

  const { data: resolvedObject, isLoading: loadingObject } = useQuery<any>({
    queryKey: ["/api/objects", objectId, "resolved"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/resolved`);
      if (!res.ok) throw new Error("Failed to fetch object");
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: customer } = useQuery<any>({
    queryKey: ["/api/customers", resolvedObject?.customerId],
    enabled: !!resolvedObject?.customerId,
  });

  const { data: descendants = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", objectId, "descendants"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/descendants`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: ancestors = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", objectId, "ancestors"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/ancestors`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: workOrders = [] } = useQuery<any[]>({
    queryKey: ["/api/objects", objectId, "work-orders"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/work-orders`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: metadataResponse } = useQuery<any>({
    queryKey: ["/api/metadata/objects", objectId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!objectId,
  });
  const metadata: any[] = metadataResponse?.metadata || [];

  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["/api/objects", objectId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/contacts?inheritance=true`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: images = [] } = useQuery<any[]>({
    queryKey: ["/api/objects", objectId, "images"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/images`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: timeRestrictions = [] } = useQuery<any[]>({
    queryKey: ["/api/objects", objectId, "time-restrictions"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/time-restrictions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: parentRelations = [] } = useQuery<any[]>({
    queryKey: ["/api/objects", objectId, "parents"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/parents`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  if (loadingObject) {
    return (
      <div className="flex items-center justify-center h-96" data-testid="loading-object-detail">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!resolvedObject) {
    return (
      <div className="p-6 text-center" data-testid="object-not-found">
        <p className="text-muted-foreground">Objektet hittades inte.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/objects")} data-testid="button-back-to-objects">
          <ArrowLeft className="h-4 w-4 mr-2" /> Tillbaka till objekt
        </Button>
      </div>
    );
  }

  const obj = resolvedObject;
  const inheritanceSources: any[] = obj.inheritanceSources || [];

  const getInheritanceInfo = (fieldName: string) => {
    const source = inheritanceSources.find((s: any) => s.field === fieldName);
    return {
      inherited: source?.inherited || false,
      sourceName: source?.sourceName || "",
    };
  };

  const hasCoordinates = obj.latitude && obj.longitude;
  const hasEntrance = obj.entranceLatitude && obj.entranceLongitude;
  const AccessIcon = accessTypeLabels[obj.accessType || "open"]?.icon || DoorOpen;

  const containerCounts = [
    { label: "K1", value: obj.containerCount },
    { label: "K2", value: obj.containerCountK2 },
    { label: "K3", value: obj.containerCountK3 },
    { label: "K4", value: obj.containerCountK4 },
  ].filter(c => c.value && c.value > 0);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6" data-testid="object-detail-page">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/objects")}
          data-testid="button-back-to-objects"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Objekt
        </Button>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        {ancestors.length > 0 && ancestors.slice().reverse().map((anc: any) => (
          <span key={anc.id} className="flex items-center gap-1">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-muted-foreground"
              onClick={() => navigate(`/objects/${anc.id}`)}
              data-testid={`breadcrumb-ancestor-${anc.id}`}
            >
              {anc.name || anc.objectNumber}
            </Button>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </span>
        ))}
        <span className="font-semibold text-foreground">
          {obj.name && obj.name !== "0" ? obj.name : obj.objectNumber || "Objekt"}
        </span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3" data-testid="text-object-name">
            {obj.name && obj.name !== "0" ? obj.name : obj.objectNumber || "Objekt"}
            {obj.objectNumber && obj.name && obj.name !== "0" && (
              <span className="text-base font-mono text-muted-foreground">{obj.objectNumber}</span>
            )}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {obj.hierarchyLevel && hierarchyLevelLabels[obj.hierarchyLevel] && (
              <Badge className={hierarchyLevelLabels[obj.hierarchyLevel].color} data-testid="badge-hierarchy-level">
                {hierarchyLevelLabels[obj.hierarchyLevel].label}
              </Badge>
            )}
            <Badge variant="secondary" data-testid="badge-object-type">
              {objectTypeLabels[obj.objectType] || obj.objectType}
            </Badge>
            <Badge className={statusColors[obj.status || "active"] || statusColors.active} data-testid="badge-status">
              {obj.status === "active" ? "Aktiv" : obj.status === "inactive" ? "Inaktiv" : obj.status || "Aktiv"}
            </Badge>
            {obj.accessType && obj.accessType !== "open" && (
              <Badge variant="outline" className="gap-1" data-testid="badge-access-type">
                <AccessIcon className="h-3 w-3" />
                {accessTypeLabels[obj.accessType]?.label}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1" data-testid="object-detail-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Översikt</TabsTrigger>
          <TabsTrigger value="location" data-testid="tab-location">Plats & Karta</TabsTrigger>
          <TabsTrigger value="access" data-testid="tab-access">Tillgång</TabsTrigger>
          <TabsTrigger value="equipment" data-testid="tab-equipment">Utrustning</TabsTrigger>
          <TabsTrigger value="hierarchy" data-testid="tab-hierarchy">
            Hierarki {descendants.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{descendants.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="metadata" data-testid="tab-metadata">
            Metadata {metadata.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{metadata.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-contacts">
            Kontakter {contacts.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{contacts.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="images" data-testid="tab-images">
            Bilder {images.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{images.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="workorders" data-testid="tab-workorders">
            Arbetsordrar {workOrders.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{workOrders.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="restrictions" data-testid="tab-restrictions">
            Tidsrestriktioner {timeRestrictions.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{timeRestrictions.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Grundinformation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <InfoRow label="Objektnamn" value={obj.name} icon={Building2} />
                <InfoRow label="Objektnummer" value={obj.objectNumber} icon={Hash} />
                <InfoRow label="Objekttyp" value={objectTypeLabels[obj.objectType] || obj.objectType} icon={Box} />
                <InfoRow label="Hierarkinivå" value={hierarchyLevelLabels[obj.hierarchyLevel]?.label || obj.hierarchyLevel} icon={Layers} />
                <InfoRow label="Status" value={obj.status === "active" ? "Aktiv" : obj.status === "inactive" ? "Inaktiv" : obj.status} icon={Info} />
                {obj.notes && <InfoRow label="Anteckningar" value={obj.notes} icon={FileText} />}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Kund & Kluster
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {customer && (
                  <InfoRow label="Kund" value={customer.name} icon={Users} />
                )}
                {obj.customerId && !customer && (
                  <InfoRow label="Kund-ID" value={obj.customerId} icon={Users} />
                )}
                {obj.clusterId && (
                  <InfoRow label="Kluster-ID" value={obj.clusterId} icon={MapPin} />
                )}
                <InfoRow label="Senaste service" value={obj.lastServiceDate ? new Date(obj.lastServiceDate).toLocaleDateString("sv-SE") : null} icon={Calendar} />
                <InfoRow label="Genomsnittlig ställtid" value={obj.avgSetupTime ? `${obj.avgSetupTime} min` : null} icon={Timer} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> Adress
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <InfoRow label="Adress" value={obj.address} icon={MapPin} />
                <InfoRow label="Postnummer" value={obj.postalCode} icon={Hash} />
                <InfoRow label="Stad" value={obj.city} icon={Building2} />
                {hasCoordinates && (
                  <InfoRow label="Koordinater" value={`${Number(obj.latitude).toFixed(6)}, ${Number(obj.longitude).toFixed(6)}`} icon={MapPin} />
                )}
                {hasEntrance && (
                  <InfoRow label="Entrékoordinater" value={`${Number(obj.entranceLatitude).toFixed(6)}, ${Number(obj.entranceLongitude).toFixed(6)}`} icon={DoorOpen} />
                )}
                {obj.addressDescriptor && (
                  <InfoRow label="Adressbeskrivning" value={obj.addressDescriptor} icon={Info} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" /> Sammanfattning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-workorder-count">{workOrders.length}</div>
                    <div className="text-xs text-muted-foreground">Arbetsordrar</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-children-count">{descendants.length}</div>
                    <div className="text-xs text-muted-foreground">Barnobjekt</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-metadata-count">{metadata.length}</div>
                    <div className="text-xs text-muted-foreground">Metadata</div>
                  </div>
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <div className="text-2xl font-bold" data-testid="text-contacts-count">{contacts.length}</div>
                    <div className="text-xs text-muted-foreground">Kontakter</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="location">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Plats & Karta
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hasCoordinates ? (
                <div className="rounded-lg overflow-hidden border" style={{ height: 400 }}>
                  <MapContainer
                    center={[Number(obj.latitude), Number(obj.longitude)]}
                    zoom={16}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap'
                    />
                    <Marker position={[Number(obj.latitude), Number(obj.longitude)]} icon={defaultIcon}>
                      <Popup>
                        <strong>{obj.name || obj.objectNumber}</strong>
                        {obj.address && <br />}
                        {obj.address}
                      </Popup>
                    </Marker>
                    {hasEntrance && (
                      <Marker
                        position={[Number(obj.entranceLatitude), Number(obj.entranceLongitude)]}
                        icon={L.divIcon({
                          className: "entrance-marker",
                          html: '<div style="background:#22c55e;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>',
                          iconSize: [12, 12],
                          iconAnchor: [6, 6],
                        })}
                      >
                        <Popup>Entrékoordinat</Popup>
                      </Marker>
                    )}
                  </MapContainer>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 bg-muted/30 rounded-lg">
                  <div className="text-center text-muted-foreground">
                    <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Inga koordinater tillgängliga</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <InfoRow label="Adress" value={obj.address} icon={MapPin} />
                <InfoRow label="Postnummer" value={obj.postalCode} icon={Hash} />
                <InfoRow label="Stad" value={obj.city} icon={Building2} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" /> Tillgångsinformation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <InfoRow label="Tillgångstyp" value={accessTypeLabels[obj.accessType || "open"]?.label || "Öppet"} icon={DoorOpen} />
              {(() => {
                const codeInfo = getInheritanceInfo("accessCode");
                return (
                  <InheritedInfoRow
                    label="Portkod"
                    value={obj.resolvedAccessCode || obj.accessCode}
                    inherited={codeInfo.inherited}
                    source={codeInfo.sourceName}
                    icon={Keyboard}
                  />
                );
              })()}
              {(() => {
                const keyInfo = getInheritanceInfo("keyNumber");
                return (
                  <InheritedInfoRow
                    label="Nyckelnummer"
                    value={obj.resolvedKeyNumber || obj.keyNumber}
                    inherited={keyInfo.inherited}
                    source={keyInfo.sourceName}
                    icon={Key}
                  />
                );
              })()}
              {(() => {
                const accessInfoData = getInheritanceInfo("accessInfo");
                const info = obj.resolvedAccessInfo || obj.accessInfo;
                if (!info) return null;
                const infoStr = typeof info === "object" ? JSON.stringify(info) : String(info);
                return (
                  <InheritedInfoRow
                    label="Övrig tillgångsinformation"
                    value={infoStr}
                    inherited={accessInfoData.inherited}
                    source={accessInfoData.sourceName}
                    icon={Info}
                  />
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipment">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Utrustning & Behållare
              </CardTitle>
            </CardHeader>
            <CardContent>
              {containerCounts.length > 0 && (
                <div className="mb-4">
                  <div className="text-sm font-medium mb-2">Behållarantal</div>
                  <div className="flex gap-3 flex-wrap">
                    {containerCounts.map(c => (
                      <div key={c.label} className="text-center p-3 bg-muted/50 rounded-lg min-w-[80px]">
                        <div className="text-xl font-bold">{c.value}</div>
                        <div className="text-xs text-muted-foreground">{c.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <InfoRow label="Serienummer" value={obj.serialNumber} icon={Hash} />
                <InfoRow label="Tillverkare" value={obj.manufacturer} icon={Wrench} />
                <InfoRow label="Inköpsdatum" value={obj.purchaseDate ? new Date(obj.purchaseDate).toLocaleDateString("sv-SE") : null} icon={Calendar} />
                <InfoRow label="Garanti utgår" value={obj.warrantyExpiry ? new Date(obj.warrantyExpiry).toLocaleDateString("sv-SE") : null} icon={Shield} />
                <InfoRow label="Senaste inspektion" value={obj.lastInspection ? new Date(obj.lastInspection).toLocaleDateString("sv-SE") : null} icon={ClipboardList} />
                <InfoRow label="Skick" value={obj.condition} icon={Info} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hierarchy">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <GitFork className="h-4 w-4" /> Föräldrar
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ancestors.length > 0 ? (
                  <div className="space-y-2">
                    {ancestors.slice().reverse().map((anc: any, idx: number) => (
                      <div
                        key={anc.id}
                        className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                        style={{ paddingLeft: `${idx * 16 + 8}px` }}
                        onClick={() => navigate(`/objects/${anc.id}`)}
                        data-testid={`link-ancestor-${anc.id}`}
                      >
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm font-medium">{anc.name || anc.objectNumber}</span>
                        {anc.hierarchyLevel && hierarchyLevelLabels[anc.hierarchyLevel] && (
                          <Badge className={`text-[10px] ${hierarchyLevelLabels[anc.hierarchyLevel].color}`}>
                            {hierarchyLevelLabels[anc.hierarchyLevel].label}
                          </Badge>
                        )}
                      </div>
                    ))}
                    <div
                      className="flex items-center gap-2 p-2 rounded-md bg-primary/10 font-semibold"
                      style={{ paddingLeft: `${ancestors.length * 16 + 8}px` }}
                    >
                      <ChevronRight className="h-3 w-3" />
                      <span className="text-sm">{obj.name || obj.objectNumber}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Inga föräldrar — detta är ett toppnivåobjekt.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Barnobjekt ({descendants.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {descendants.length > 0 ? (
                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {descendants.map((child: any) => (
                      <div
                        key={child.id}
                        className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                        onClick={() => navigate(`/objects/${child.id}`)}
                        data-testid={`link-child-${child.id}`}
                      >
                        <span className="text-sm font-medium">{child.name || child.objectNumber}</span>
                        {child.objectType && (
                          <Badge variant="secondary" className="text-[10px]">
                            {objectTypeLabels[child.objectType] || child.objectType}
                          </Badge>
                        )}
                        {child.hierarchyLevel && hierarchyLevelLabels[child.hierarchyLevel] && (
                          <Badge className={`text-[10px] ${hierarchyLevelLabels[child.hierarchyLevel].color}`}>
                            {hierarchyLevelLabels[child.hierarchyLevel].label}
                          </Badge>
                        )}
                        <ExternalLink className="h-3 w-3 text-muted-foreground ml-auto" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Inga barnobjekt.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="metadata">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Metadata
              </CardTitle>
            </CardHeader>
            <CardContent>
              {metadata.length > 0 ? (
                <div className="divide-y">
                  {metadata.map((m: any) => {
                    const displayValue = m.vardeString ?? m.vardeInteger ?? m.vardeDecimal ??
                      (m.vardeBoolean !== null && m.vardeBoolean !== undefined ? (m.vardeBoolean ? "Ja" : "Nej") : null) ??
                      (m.vardeDatetime ? new Date(m.vardeDatetime).toLocaleDateString("sv-SE") : null) ??
                      (m.vardeJson ? JSON.stringify(m.vardeJson) : null) ?? "—";
                    return (
                      <div key={m.id} className="flex items-center justify-between py-3" data-testid={`metadata-row-${m.id}`}>
                        <div>
                          <div className="text-sm font-medium">{m.katalog?.namn || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.katalog?.kategori && <span className="mr-2">{m.katalog.kategori}</span>}
                            {m.metod && <span>{m.metod}</span>}
                          </div>
                        </div>
                        <div className="text-sm font-mono text-right flex items-center gap-2">
                          {String(displayValue)}
                          {m.source === "inherited" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] cursor-help">Ärvd</Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {m.fromObject?.name ? `Ärvd från: ${m.fromObject.name}` : "Ärvd från förälder"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Ingen metadata registrerad.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Contact className="h-4 w-4" /> Kontakter
              </CardTitle>
            </CardHeader>
            <CardContent>
              {contacts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {contacts.map((c: any) => (
                    <div key={c.id} className="p-3 border rounded-lg" data-testid={`contact-card-${c.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{c.name}</span>
                        {c.inherited && (
                          <Badge variant="outline" className="text-[10px]">Ärvd</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{c.role || c.contactType || ""}</div>
                      {c.phone && <div className="text-xs mt-1">{c.phone}</div>}
                      {c.email && <div className="text-xs">{c.email}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Inga kontakter registrerade.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="images">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="h-4 w-4" /> Bilder
              </CardTitle>
            </CardHeader>
            <CardContent>
              {images.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {images.map((img: any) => (
                    <div key={img.id} className="aspect-square rounded-lg overflow-hidden border bg-muted" data-testid={`image-card-${img.id}`}>
                      <img
                        src={img.url || img.imageUrl}
                        alt={img.description || img.title || "Bild"}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 bg-muted/30 rounded-lg">
                  <div className="text-center text-muted-foreground">
                    <Image className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Inga bilder uppladdade</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workorders">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" /> Arbetsordrar
              </CardTitle>
            </CardHeader>
            <CardContent>
              {workOrders.length > 0 ? (
                <div className="divide-y">
                  {workOrders.map((wo: any) => (
                    <div key={wo.id} className="flex items-center justify-between py-3 gap-4" data-testid={`workorder-row-${wo.id}`}>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{wo.title || `Order ${wo.id.slice(0, 8)}`}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {wo.scheduledDate && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(wo.scheduledDate).toLocaleDateString("sv-SE")}
                            </span>
                          )}
                          {wo.resourceName && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Truck className="h-3 w-3" />
                              {wo.resourceName}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge className={workOrderStatusColors[wo.status || "unassigned"] || workOrderStatusColors.unassigned}>
                        {wo.status === "completed" ? "Klar" :
                         wo.status === "scheduled" ? "Schemalagd" :
                         wo.status === "in_progress" ? "Pågår" :
                         wo.status === "cancelled" ? "Avbruten" : "Ej tilldelad"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Inga arbetsordrar kopplade till detta objekt.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="restrictions">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Tidsrestriktioner
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timeRestrictions.length > 0 ? (
                <div className="divide-y">
                  {timeRestrictions.map((tr: any) => (
                    <div key={tr.id} className="py-3" data-testid={`restriction-row-${tr.id}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{tr.name || tr.restrictionType || "Restriktion"}</span>
                        <Badge variant={tr.isActive !== false ? "default" : "secondary"}>
                          {tr.isActive !== false ? "Aktiv" : "Inaktiv"}
                        </Badge>
                      </div>
                      {tr.description && (
                        <p className="text-xs text-muted-foreground mt-1">{tr.description}</p>
                      )}
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        {tr.startTime && <span>Start: {tr.startTime}</span>}
                        {tr.endTime && <span>Slut: {tr.endTime}</span>}
                        {tr.days && <span>Dagar: {Array.isArray(tr.days) ? tr.days.join(", ") : tr.days}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Inga tidsrestriktioner konfigurerade.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
