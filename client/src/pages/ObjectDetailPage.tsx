import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Building2, MapPin, Key, Keyboard, Users, DoorOpen,
  Clock, Package, FileText, Image, Contact, GitFork, AlertTriangle,
  Calendar, Loader2, ChevronRight, ExternalLink, Wrench, Shield,
  Hash, Truck, Timer, Info, Box, Layers, ClipboardList, Plus,
  Trash2, Pencil, Save, X, Phone, Mail
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

const CONTACT_TYPES = [
  { value: "primary", label: "Primär kontakt" },
  { value: "invoice", label: "Fakturakontakt" },
  { value: "technical", label: "Teknisk kontakt" },
  { value: "emergency", label: "Nödkontakt" },
  { value: "property_manager", label: "Fastighetsförvaltare" },
];

const IMAGE_TYPES = [
  { value: "photo", label: "Foto" },
  { value: "map", label: "Karta" },
  { value: "diagram", label: "Diagram" },
  { value: "document", label: "Dokument" },
  { value: "instruction", label: "Instruktion" },
];

const RESTRICTION_TYPES = [
  { value: "time_window", label: "Tidsfönster" },
  { value: "blocked_period", label: "Blockerad period" },
  { value: "preferred_time", label: "Föredragen tid" },
  { value: "access_hours", label: "Öppettider" },
];

const WEEKDAY_LABELS = [
  { value: 1, label: "Mån" },
  { value: 2, label: "Tis" },
  { value: 3, label: "Ons" },
  { value: 4, label: "Tor" },
  { value: 5, label: "Fre" },
  { value: 6, label: "Lör" },
  { value: 0, label: "Sön" },
];

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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const objectId = params?.id || "";

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSection, setEditSection] = useState<"overview" | "access" | "equipment">("overview");
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [restrictionDialogOpen, setRestrictionDialogOpen] = useState(false);
  const [workOrderDialogOpen, setWorkOrderDialogOpen] = useState(false);

  const [editForm, setEditForm] = useState<any>({});
  const [contactForm, setContactForm] = useState({ name: "", contactType: "primary", phone: "", email: "", role: "" });
  const [imageForm, setImageForm] = useState({ imageUrl: "", imageType: "photo", description: "" });
  const [restrictionForm, setRestrictionForm] = useState({
    restrictionType: "time_window",
    description: "",
    startTime: "",
    endTime: "",
    weekdays: [] as number[],
    isBlockingAllDay: false,
    preference: "unfavorable" as "favorable" | "unfavorable",
    reason: "",
  });
  const [workOrderForm, setWorkOrderForm] = useState({ title: "", description: "", scheduledDate: "" });

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

  const { data: metadataTypes = [] } = useQuery<any[]>({
    queryKey: ["/api/metadata/types"],
    queryFn: async () => {
      const res = await fetch("/api/metadata/types");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const updateObjectMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PATCH", `/api/objects/${objectId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Sparat", description: "Objektet har uppdaterats." });
      setEditDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara ändringarna.", variant: "destructive" });
    },
  });

  const addContactMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", `/api/objects/${objectId}/contacts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      toast({ title: "Kontakt tillagd" });
      setContactDialogOpen(false);
      setContactForm({ name: "", contactType: "primary", phone: "", email: "", role: "" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte lägga till kontakt.", variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      await apiRequest("DELETE", `/api/objects/${objectId}/contacts/${contactId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      toast({ title: "Kontakt borttagen" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort kontakt.", variant: "destructive" });
    },
  });

  const addImageMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", `/api/objects/${objectId}/images`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "images"] });
      toast({ title: "Bild tillagd" });
      setImageDialogOpen(false);
      setImageForm({ imageUrl: "", imageType: "photo", description: "" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte lägga till bild.", variant: "destructive" });
    },
  });

  const deleteImageMutation = useMutation({
    mutationFn: async (imageId: string) => {
      await apiRequest("DELETE", `/api/objects/${objectId}/images/${imageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "images"] });
      toast({ title: "Bild borttagen" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort bild.", variant: "destructive" });
    },
  });

  const addRestrictionMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", `/api/objects/${objectId}/time-restrictions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "time-restrictions"] });
      toast({ title: "Tidsrestriktion tillagd" });
      setRestrictionDialogOpen(false);
      setRestrictionForm({ restrictionType: "time_window", description: "", startTime: "", endTime: "", weekdays: [], isBlockingAllDay: false, preference: "unfavorable", reason: "" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte lägga till tidsrestriktion.", variant: "destructive" });
    },
  });

  const deleteRestrictionMutation = useMutation({
    mutationFn: async (restrictionId: string) => {
      await apiRequest("DELETE", `/api/time-restrictions/${restrictionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "time-restrictions"] });
      toast({ title: "Tidsrestriktion borttagen" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort tidsrestriktion.", variant: "destructive" });
    },
  });

  const addMetadataMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", "/api/metadata", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Metadata tillagd" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte lägga till metadata.", variant: "destructive" });
    },
  });

  const deleteMetadataMutation = useMutation({
    mutationFn: async (metadataId: string) => {
      await apiRequest("DELETE", `/api/metadata/${metadataId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Metadata borttagen" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort metadata.", variant: "destructive" });
    },
  });

  const createWorkOrderMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("POST", "/api/work-orders", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Arbetsorder skapad" });
      setWorkOrderDialogOpen(false);
      setWorkOrderForm({ title: "", description: "", scheduledDate: "" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa arbetsorder.", variant: "destructive" });
    },
  });

  const openEditDialog = (section: "overview" | "access" | "equipment") => {
    if (!resolvedObject) return;
    setEditSection(section);
    setEditForm({
      name: resolvedObject.name || "",
      objectNumber: resolvedObject.objectNumber || "",
      objectType: resolvedObject.objectType || "",
      hierarchyLevel: resolvedObject.hierarchyLevel || "",
      status: resolvedObject.status || "active",
      notes: resolvedObject.notes || "",
      accessType: resolvedObject.accessType || "open",
      accessCode: resolvedObject.accessCode || "",
      keyNumber: resolvedObject.keyNumber || "",
      containerCount: resolvedObject.containerCount || 0,
      containerCountK2: resolvedObject.containerCountK2 || 0,
      containerCountK3: resolvedObject.containerCountK3 || 0,
      containerCountK4: resolvedObject.containerCountK4 || 0,
      serialNumber: resolvedObject.serialNumber || "",
      manufacturer: resolvedObject.manufacturer || "",
      condition: resolvedObject.condition || "",
    });
    setEditDialogOpen(true);
  };

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
            SlotPreference {timeRestrictions.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{timeRestrictions.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ==================== ÖVERSIKT ==================== */}
        <TabsContent value="overview">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Grundinformation
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog("overview")} data-testid="button-edit-overview">
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Redigera
                  </Button>
                </div>
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

        {/* ==================== PLATS & KARTA ==================== */}
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

        {/* ==================== TILLGÅNG ==================== */}
        <TabsContent value="access">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Key className="h-4 w-4" /> Tillgångsinformation
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => openEditDialog("access")} data-testid="button-edit-access">
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Redigera
                </Button>
              </div>
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

        {/* ==================== UTRUSTNING ==================== */}
        <TabsContent value="equipment">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" /> Utrustning & Behållare
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => openEditDialog("equipment")} data-testid="button-edit-equipment">
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Redigera
                </Button>
              </div>
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

        {/* ==================== HIERARKI ==================== */}
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

        {/* ==================== METADATA ==================== */}
        <TabsContent value="metadata">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Metadata
                </CardTitle>
                <MetadataAddButton
                  objectId={objectId}
                  metadataTypes={metadataTypes}
                  onAdd={(data) => addMetadataMutation.mutate(data)}
                  isPending={addMetadataMutation.isPending}
                />
              </div>
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
                      <div key={m.id} className="flex items-center justify-between py-3 gap-2" data-testid={`metadata-row-${m.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{m.katalog?.namn || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {m.katalog?.kategori && <span className="mr-2">{m.katalog.kategori}</span>}
                            {m.metod && <span>{m.metod}</span>}
                          </div>
                        </div>
                        <div className="text-sm font-mono text-right flex items-center gap-2 shrink-0">
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
                          {m.source !== "inherited" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => deleteMetadataMutation.mutate(m.id)}
                              disabled={deleteMetadataMutation.isPending}
                              data-testid={`button-delete-metadata-${m.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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

        {/* ==================== KONTAKTER ==================== */}
        <TabsContent value="contacts">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Contact className="h-4 w-4" /> Kontakter
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setContactDialogOpen(true)}
                  data-testid="button-add-contact"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {contacts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {contacts.map((c: any) => (
                    <div key={c.id} className="p-3 border rounded-lg" data-testid={`contact-card-${c.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{c.name}</span>
                        <div className="flex items-center gap-1">
                          {c.inherited && (
                            <Badge variant="outline" className="text-[10px]">Ärvd</Badge>
                          )}
                          {!c.inherited && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => deleteContactMutation.mutate(c.id)}
                              disabled={deleteContactMutation.isPending}
                              data-testid={`button-delete-contact-${c.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {CONTACT_TYPES.find(t => t.value === c.contactType)?.label || c.role || c.contactType || ""}
                      </div>
                      {c.phone && (
                        <div className="text-xs mt-1 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-muted-foreground" /> {c.phone}
                        </div>
                      )}
                      {c.email && (
                        <div className="text-xs flex items-center gap-1">
                          <Mail className="h-3 w-3 text-muted-foreground" /> {c.email}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Inga kontakter registrerade.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== BILDER ==================== */}
        <TabsContent value="images">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Image className="h-4 w-4" /> Bilder
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImageDialogOpen(true)}
                  data-testid="button-add-image"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {images.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {images.map((img: any) => (
                    <div key={img.id} className="relative group" data-testid={`image-card-${img.id}`}>
                      <div className="aspect-square rounded-lg overflow-hidden border bg-muted">
                        <img
                          src={img.url || img.imageUrl}
                          alt={img.description || img.title || "Bild"}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="absolute top-1 right-1 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deleteImageMutation.mutate(img.id)}
                        disabled={deleteImageMutation.isPending}
                        data-testid={`button-delete-image-${img.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      {img.description && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">{img.description}</div>
                      )}
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

        {/* ==================== ARBETSORDRAR ==================== */}
        <TabsContent value="workorders">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" /> Arbetsordrar
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWorkOrderDialogOpen(true)}
                  data-testid="button-add-workorder"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Ny arbetsorder
                </Button>
              </div>
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

        {/* ==================== SLOTPREFERENCE ==================== */}
        <TabsContent value="restrictions">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" /> SlotPreference — Tidsregler
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRestrictionDialogOpen(true)}
                  data-testid="button-add-restriction"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {timeRestrictions.length > 0 ? (
                <>
                  {/* Week calendar view */}
                  <div className="mb-4">
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Veckokalender</h4>
                    <div className="grid grid-cols-7 gap-1" data-testid="slot-week-calendar">
                      {WEEKDAY_LABELS.map(day => (
                        <div key={day.value} className="text-center">
                          <div className="text-xs font-medium mb-1">{day.label}</div>
                          {(() => {
                            const daySlots = timeRestrictions.filter((tr: any) =>
                              tr.weekdays && Array.isArray(tr.weekdays) && tr.weekdays.includes(day.value)
                            );
                            const favorable = daySlots.filter((tr: any) => tr.preference === "favorable");
                            const unfavorable = daySlots.filter((tr: any) => tr.preference !== "favorable");
                            if (daySlots.length === 0) {
                              return <div className="h-12 rounded border border-dashed border-muted-foreground/20 flex items-center justify-center text-[10px] text-muted-foreground">—</div>;
                            }
                            return (
                              <div className="space-y-0.5">
                                {favorable.map((s: any) => (
                                  <div key={s.id} className="bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700 rounded px-1 py-0.5" data-testid={`slot-favorable-${s.id}`}>
                                    <div className="text-[10px] font-medium text-green-800 dark:text-green-300 truncate">{s.startTime || "Hela"}{s.endTime ? `–${s.endTime}` : ""}</div>
                                  </div>
                                ))}
                                {unfavorable.map((s: any) => (
                                  <div key={s.id} className="bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded px-1 py-0.5" data-testid={`slot-unfavorable-${s.id}`}>
                                    <div className="text-[10px] font-medium text-red-800 dark:text-red-300 truncate">{s.startTime || "Hela"}{s.endTime ? `–${s.endTime}` : ""}</div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 mt-2">
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-3 h-3 rounded bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700" />
                        Fördelaktig tid
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700" />
                        Ofördelaktig tid
                      </div>
                    </div>
                  </div>

                  <Separator className="my-3" />

                  {/* List view */}
                  <div className="divide-y">
                    {timeRestrictions.map((tr: any) => {
                      const isFavorable = tr.preference === "favorable";
                      return (
                        <div key={tr.id} className={`py-3 border-l-2 pl-3 ${isFavorable ? "border-l-green-500" : "border-l-red-500"}`} data-testid={`restriction-row-${tr.id}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{tr.name || RESTRICTION_TYPES.find((t: any) => t.value === tr.restrictionType)?.label || tr.restrictionType || "Restriktion"}</span>
                              <Badge variant="outline" className={isFavorable ? "border-green-500 text-green-700 dark:text-green-400" : "border-red-500 text-red-700 dark:text-red-400"}>
                                {isFavorable ? "Fördelaktig" : "Ofördelaktig"}
                              </Badge>
                              <Badge variant={tr.isActive !== false ? "default" : "secondary"}>
                                {tr.isActive !== false ? "Aktiv" : "Inaktiv"}
                              </Badge>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => deleteRestrictionMutation.mutate(tr.id)}
                              disabled={deleteRestrictionMutation.isPending}
                              data-testid={`button-delete-restriction-${tr.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {tr.reason && (
                            <p className="text-xs mt-1 italic">{tr.reason}</p>
                          )}
                          {tr.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{tr.description}</p>
                          )}
                          <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                            {tr.startTime && <span>Start: {tr.startTime}</span>}
                            {tr.endTime && <span>Slut: {tr.endTime}</span>}
                            {tr.weekdays && Array.isArray(tr.weekdays) && tr.weekdays.length > 0 && (
                              <span>Dagar: {tr.weekdays.map((d: number) => WEEKDAY_LABELS.find(w => w.value === d)?.label || d).join(", ")}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Inga tidsregler konfigurerade. Lägg till fördelaktiga eller ofördelaktiga tider.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== REDIGERA OBJEKT-DIALOG ==================== */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editSection === "overview" ? "Redigera grundinformation" :
               editSection === "access" ? "Redigera tillgångsinformation" :
               "Redigera utrustning"}
            </DialogTitle>
            <DialogDescription>Uppdatera objektets information nedan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            {editSection === "overview" && (
              <>
                <div className="space-y-2">
                  <Label>Objektnamn</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    data-testid="input-edit-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Objektnummer</Label>
                  <Input
                    value={editForm.objectNumber}
                    onChange={(e) => setEditForm({ ...editForm, objectNumber: e.target.value })}
                    data-testid="input-edit-objectNumber"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Objekttyp</Label>
                  <Select value={editForm.objectType} onValueChange={(v) => setEditForm({ ...editForm, objectType: v })}>
                    <SelectTrigger data-testid="select-edit-objectType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(objectTypeLabels).map(([val, label]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hierarkinivå</Label>
                  <Select value={editForm.hierarchyLevel} onValueChange={(v) => setEditForm({ ...editForm, hierarchyLevel: v })}>
                    <SelectTrigger data-testid="select-edit-hierarchyLevel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(hierarchyLevelLabels).map(([val, { label }]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                    <SelectTrigger data-testid="select-edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktiv</SelectItem>
                      <SelectItem value="inactive">Inaktiv</SelectItem>
                      <SelectItem value="pending">Väntande</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Anteckningar</Label>
                  <Textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    data-testid="input-edit-notes"
                  />
                </div>
              </>
            )}
            {editSection === "access" && (
              <>
                <div className="space-y-2">
                  <Label>Tillgångstyp</Label>
                  <Select value={editForm.accessType} onValueChange={(v) => setEditForm({ ...editForm, accessType: v })}>
                    <SelectTrigger data-testid="select-edit-accessType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(accessTypeLabels).map(([val, { label }]) => (
                        <SelectItem key={val} value={val}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Portkod</Label>
                  <Input
                    value={editForm.accessCode}
                    onChange={(e) => setEditForm({ ...editForm, accessCode: e.target.value })}
                    data-testid="input-edit-accessCode"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nyckelnummer</Label>
                  <Input
                    value={editForm.keyNumber}
                    onChange={(e) => setEditForm({ ...editForm, keyNumber: e.target.value })}
                    data-testid="input-edit-keyNumber"
                  />
                </div>
              </>
            )}
            {editSection === "equipment" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>K1 antal</Label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.containerCount}
                      onChange={(e) => setEditForm({ ...editForm, containerCount: parseInt(e.target.value) || 0 })}
                      data-testid="input-edit-containerCount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>K2 antal</Label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.containerCountK2}
                      onChange={(e) => setEditForm({ ...editForm, containerCountK2: parseInt(e.target.value) || 0 })}
                      data-testid="input-edit-containerCountK2"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>K3 antal</Label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.containerCountK3}
                      onChange={(e) => setEditForm({ ...editForm, containerCountK3: parseInt(e.target.value) || 0 })}
                      data-testid="input-edit-containerCountK3"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>K4 antal</Label>
                    <Input
                      type="number"
                      min="0"
                      value={editForm.containerCountK4}
                      onChange={(e) => setEditForm({ ...editForm, containerCountK4: parseInt(e.target.value) || 0 })}
                      data-testid="input-edit-containerCountK4"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Serienummer</Label>
                  <Input
                    value={editForm.serialNumber}
                    onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })}
                    data-testid="input-edit-serialNumber"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tillverkare</Label>
                  <Input
                    value={editForm.manufacturer}
                    onChange={(e) => setEditForm({ ...editForm, manufacturer: e.target.value })}
                    data-testid="input-edit-manufacturer"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Skick</Label>
                  <Input
                    value={editForm.condition}
                    onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })}
                    data-testid="input-edit-condition"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
              Avbryt
            </Button>
            <Button
              onClick={() => {
                const payload: any = {};
                if (editSection === "overview") {
                  payload.name = editForm.name;
                  payload.objectNumber = editForm.objectNumber;
                  payload.objectType = editForm.objectType;
                  payload.hierarchyLevel = editForm.hierarchyLevel;
                  payload.status = editForm.status;
                  payload.notes = editForm.notes;
                }
                if (editSection === "access") {
                  payload.accessType = editForm.accessType;
                  payload.accessCode = editForm.accessCode;
                  payload.keyNumber = editForm.keyNumber;
                }
                if (editSection === "equipment") {
                  payload.containerCount = editForm.containerCount;
                  payload.containerCountK2 = editForm.containerCountK2;
                  payload.containerCountK3 = editForm.containerCountK3;
                  payload.containerCountK4 = editForm.containerCountK4;
                  payload.serialNumber = editForm.serialNumber;
                  payload.manufacturer = editForm.manufacturer;
                  payload.condition = editForm.condition;
                }
                updateObjectMutation.mutate(payload);
              }}
              disabled={updateObjectMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== LÄGG TILL KONTAKT ==================== */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lägg till kontakt</DialogTitle>
            <DialogDescription>Fyll i kontaktuppgifterna nedan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Namn *</Label>
              <Input
                value={contactForm.name}
                onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                placeholder="Kontaktnamn"
                data-testid="input-contact-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Typ</Label>
              <Select value={contactForm.contactType} onValueChange={(v) => setContactForm({ ...contactForm, contactType: v })}>
                <SelectTrigger data-testid="select-contact-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Roll</Label>
              <Input
                value={contactForm.role}
                onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                placeholder="t.ex. Vaktmästare"
                data-testid="input-contact-role"
              />
            </div>
            <div className="space-y-2">
              <Label>Telefon</Label>
              <Input
                value={contactForm.phone}
                onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                placeholder="070-123 45 67"
                data-testid="input-contact-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>E-post</Label>
              <Input
                value={contactForm.email}
                onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                placeholder="kontakt@example.com"
                data-testid="input-contact-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)} data-testid="button-cancel-contact">
              Avbryt
            </Button>
            <Button
              onClick={() => addContactMutation.mutate(contactForm)}
              disabled={!contactForm.name || addContactMutation.isPending}
              data-testid="button-save-contact"
            >
              {addContactMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== LÄGG TILL BILD ==================== */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lägg till bild</DialogTitle>
            <DialogDescription>Ange bildlänk och valfri beskrivning.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Bild-URL *</Label>
              <Input
                value={imageForm.imageUrl}
                onChange={(e) => setImageForm({ ...imageForm, imageUrl: e.target.value })}
                placeholder="https://..."
                data-testid="input-image-url"
              />
            </div>
            <div className="space-y-2">
              <Label>Typ</Label>
              <Select value={imageForm.imageType} onValueChange={(v) => setImageForm({ ...imageForm, imageType: v })}>
                <SelectTrigger data-testid="select-image-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Beskrivning</Label>
              <Input
                value={imageForm.description}
                onChange={(e) => setImageForm({ ...imageForm, description: e.target.value })}
                placeholder="Valfri beskrivning"
                data-testid="input-image-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImageDialogOpen(false)} data-testid="button-cancel-image">
              Avbryt
            </Button>
            <Button
              onClick={() => addImageMutation.mutate(imageForm)}
              disabled={!imageForm.imageUrl || addImageMutation.isPending}
              data-testid="button-save-image"
            >
              {addImageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== LÄGG TILL TIDSRESTRIKTION ==================== */}
      <Dialog open={restrictionDialogOpen} onOpenChange={setRestrictionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lägg till tidsregel</DialogTitle>
            <DialogDescription>Konfigurera fördelaktiga eller ofördelaktiga tider för detta objekt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Preferens *</Label>
              <Select value={restrictionForm.preference} onValueChange={(v) => setRestrictionForm({ ...restrictionForm, preference: v as "favorable" | "unfavorable" })}>
                <SelectTrigger data-testid="select-preference">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="favorable">Fördelaktig tid</SelectItem>
                  <SelectItem value="unfavorable">Ofördelaktig tid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Typ *</Label>
              <Select value={restrictionForm.restrictionType} onValueChange={(v) => setRestrictionForm({ ...restrictionForm, restrictionType: v })}>
                <SelectTrigger data-testid="select-restriction-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESTRICTION_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Anledning</Label>
              <Input
                value={restrictionForm.reason}
                onChange={(e) => setRestrictionForm({ ...restrictionForm, reason: e.target.value })}
                placeholder={restrictionForm.preference === "favorable" ? "T.ex. 'Bästa tömningsdag'" : "T.ex. 'P-förbud gäller'"}
                data-testid="input-restriction-reason"
              />
            </div>
            <div className="space-y-2">
              <Label>Beskrivning</Label>
              <Input
                value={restrictionForm.description}
                onChange={(e) => setRestrictionForm({ ...restrictionForm, description: e.target.value })}
                placeholder="Valfri ytterligare detalj"
                data-testid="input-restriction-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Starttid</Label>
                <Input
                  type="time"
                  value={restrictionForm.startTime}
                  onChange={(e) => setRestrictionForm({ ...restrictionForm, startTime: e.target.value })}
                  data-testid="input-restriction-startTime"
                />
              </div>
              <div className="space-y-2">
                <Label>Sluttid</Label>
                <Input
                  type="time"
                  value={restrictionForm.endTime}
                  onChange={(e) => setRestrictionForm({ ...restrictionForm, endTime: e.target.value })}
                  data-testid="input-restriction-endTime"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Veckodagar</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map(day => (
                  <label key={day.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox
                      checked={restrictionForm.weekdays.includes(day.value)}
                      onCheckedChange={(checked) => {
                        setRestrictionForm({
                          ...restrictionForm,
                          weekdays: checked
                            ? [...restrictionForm.weekdays, day.value]
                            : restrictionForm.weekdays.filter(d => d !== day.value),
                        });
                      }}
                      data-testid={`checkbox-weekday-${day.value}`}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={restrictionForm.isBlockingAllDay}
                onCheckedChange={(checked) => setRestrictionForm({ ...restrictionForm, isBlockingAllDay: !!checked })}
                data-testid="checkbox-blocking-all-day"
              />
              <Label className="cursor-pointer">Blockerar hela dagen</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestrictionDialogOpen(false)} data-testid="button-cancel-restriction">
              Avbryt
            </Button>
            <Button
              onClick={() => addRestrictionMutation.mutate(restrictionForm)}
              disabled={addRestrictionMutation.isPending}
              data-testid="button-save-restriction"
            >
              {addRestrictionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== NY ARBETSORDER ==================== */}
      <Dialog open={workOrderDialogOpen} onOpenChange={setWorkOrderDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Skapa arbetsorder</DialogTitle>
            <DialogDescription>Skapa en ny arbetsorder kopplad till detta objekt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!obj.customerId && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md text-sm text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Objektet saknar kundkoppling. Koppla en kund innan du skapar en arbetsorder.
              </div>
            )}
            <div className="space-y-2">
              <Label>Titel *</Label>
              <Input
                value={workOrderForm.title}
                onChange={(e) => setWorkOrderForm({ ...workOrderForm, title: e.target.value })}
                placeholder="Arbetsorder titel"
                data-testid="input-workorder-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Beskrivning</Label>
              <Textarea
                value={workOrderForm.description}
                onChange={(e) => setWorkOrderForm({ ...workOrderForm, description: e.target.value })}
                placeholder="Valfri beskrivning"
                data-testid="input-workorder-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Planerat datum</Label>
              <Input
                type="date"
                value={workOrderForm.scheduledDate}
                onChange={(e) => setWorkOrderForm({ ...workOrderForm, scheduledDate: e.target.value })}
                data-testid="input-workorder-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkOrderDialogOpen(false)} data-testid="button-cancel-workorder">
              Avbryt
            </Button>
            <Button
              onClick={() => createWorkOrderMutation.mutate({
                title: workOrderForm.title,
                description: workOrderForm.description || undefined,
                scheduledDate: workOrderForm.scheduledDate || undefined,
                objectId,
                customerId: obj.customerId || undefined,
                status: "unassigned",
              })}
              disabled={!workOrderForm.title || !obj.customerId || createWorkOrderMutation.isPending}
              data-testid="button-save-workorder"
            >
              {createWorkOrderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Skapa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetadataAddButton({ objectId, metadataTypes, onAdd, isPending }: {
  objectId: string;
  metadataTypes: any[];
  onAdd: (data: any) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [value, setValue] = useState("");

  const handleAdd = () => {
    if (!selectedType) return;
    const metaType = metadataTypes.find((t: any) => t.namn === selectedType || t.id === selectedType);
    onAdd({
      objektId: objectId,
      metadataTypNamn: metaType?.namn || selectedType,
      varde: value,
    });
    setOpen(false);
    setSelectedType("");
    setValue("");
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-add-metadata"
      >
        <Plus className="h-3.5 w-3.5 mr-1" /> Lägg till
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lägg till metadata</DialogTitle>
            <DialogDescription>Välj metadatatyp och ange värde.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Metadatatyp *</Label>
              {metadataTypes.length > 0 ? (
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger data-testid="select-metadata-type">
                    <SelectValue placeholder="Välj typ..." />
                  </SelectTrigger>
                  <SelectContent>
                    {metadataTypes.map((t: any) => (
                      <SelectItem key={t.id || t.namn} value={t.namn}>
                        {t.namn} {t.kategori ? `(${t.kategori})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  placeholder="Ange typnamn"
                  data-testid="input-metadata-type"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Värde *</Label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Ange värde"
                data-testid="input-metadata-value"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-metadata">
              Avbryt
            </Button>
            <Button
              onClick={handleAdd}
              disabled={!selectedType || !value || isPending}
              data-testid="button-save-metadata"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
