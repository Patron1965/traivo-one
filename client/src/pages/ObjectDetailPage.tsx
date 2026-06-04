import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeliveryPreferencesEditor } from "@/components/DeliveryPreferencesEditor";
import { ObjectHistoryArchiveTab } from "@/components/ObjectHistoryArchiveTab";
import { ObjectVignetteSection } from "@/components/ObjectVignetteSection";
import InvoiceRecipientsCard from "@/components/InvoiceRecipientsCard";
import ObjectPayersCard from "@/components/ObjectPayersCard";
import { TelinkSyncButton } from "@/components/TelinkSyncButton";
import { useAuth } from "@/hooks/use-auth";
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
import type { ObjectTimeRestriction } from "@shared/schema";
import {
  ArrowLeft, Building2, MapPin, Key, Keyboard, Users, DoorOpen,
  Clock, Package, FileText, Image, Contact, GitFork, AlertTriangle,
  Calendar, Loader2, ChevronRight, ExternalLink, Wrench, Shield,
  Hash, Truck, Timer, Info, Box, Layers, ClipboardList, Plus,
  Trash2, Pencil, Save, X, Phone, Mail, LinkIcon, Search, History,
  ArrowUp, ArrowDown, RotateCcw, Cog
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";
import type { ServiceObject, WorkOrder, DeliveryPreferences } from "@shared/schema";
import { PolylineEditor } from "@/components/PolylineEditor";
import { objectStatusBadge as statusColors, workOrderStatusBadge as workOrderStatusColors } from "@/lib/status-colors";
import type { LucideIcon } from "lucide-react";

interface InheritanceSource {
  field: string;
  inherited?: boolean;
  sourceName?: string;
}

type ResolvedObjectResponse = Partial<Omit<ServiceObject, "id" | "deletedAt">> & {
  id: string;
  deletedAt?: string | Date | null;
  inheritanceSources?: InheritanceSource[];
};

interface MetadataKatalog {
  namn?: string;
  kategori?: string;
  kronologiskVisning?: boolean;
}

interface MetadataEntry {
  id: string;
  metadataKatalogId?: string;
  katalog?: MetadataKatalog;
  vardeString?: string | null;
  vardeInteger?: number | null;
  vardeDecimal?: number | null;
  vardeBoolean?: boolean | null;
  vardeDatetime?: string | null;
  vardeJson?: unknown;
  metod?: string | null;
  skapadAv?: string | null;
  uppdateradAv?: string | null;
  lastChangedAt?: string | null;
  source?: "inherited" | "direct" | string;
  fromObject?: { namn?: string } | null;
  overridden?: boolean;
  inheritedValue?: string | null;
  inheritedFromName?: string | null;
  softDeleted?: boolean;
  raderad?: boolean;
  sortIndex?: number | null;
}

interface MetadataResponse {
  metadata?: MetadataEntry[];
}

// Ursprung som är read-only / systemgenererat (speglar server-sidans
// READONLY_ORIGIN i metadata-queries.ts: system/tjanst/utforande).
const READONLY_METADATA_ORIGINS = new Set(["system", "tjanst", "utforande"]);
function isReadonlyMetadataOrigin(metod?: string | null): boolean {
  return !!metod && READONLY_METADATA_ORIGINS.has(metod);
}

// Task #682 introducerade systemfälten nedan (skrivs read-only vid WO-skapande /
// inkommen felanmälan). Vi lyfter fram dem på objektkortet.
const LATEST_WORKORDER_FIELD = "Senaste arbetsorder";
const LATEST_ISSUE_FIELD = "Senaste felanmälan";

function getMetadataDisplayValue(entry: MetadataEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.vardeString != null && entry.vardeString !== "") return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "Ja" : "Nej";
  if (entry.vardeDatetime) return new Date(entry.vardeDatetime).toLocaleDateString("sv-SE");
  return null;
}

function findSystemMetadata(metadata: MetadataEntry[], namn: string): MetadataEntry | undefined {
  return metadata.find((m) => m.katalog?.namn === namn);
}

// Task #694: systemfälten "Senaste arbetsorder"/"Senaste felanmälan" skrivs av
// systemet (Task #682) med setBy-strängen `system:<typ>:<id>` lagrad i skapadAv
// (första skrivningen) resp. uppdateradAv (senare uppdateringar). Vi läser ut
// id:t därifrån så att kortet kan djuplänka till exakt arbetsorder/felanmälan.
// Bakåtkompatibelt: saknas ett tolkbart id (äldre rena strängvärden) returneras
// null och länken faller tillbaka på den gamla list-navigeringen.
function parseSystemRefId(
  entry: MetadataEntry | undefined,
  marker: string,
): string | null {
  const raw = entry?.uppdateradAv ?? entry?.skapadAv;
  if (!raw) return null;
  const prefix = `system:${marker}:`;
  if (!raw.startsWith(prefix)) return null;
  const id = raw.slice(prefix.length).trim();
  return id.length > 0 ? id : null;
}

function formatChangedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE");
}

interface MetadataType {
  id?: string;
  namn: string;
  kategori?: string;
  datatyp?: string;
  allowedValues?: string[] | null;
  area?: string | null;
  displayNumber?: number | null;
}

interface ObjectContact {
  id: string;
  name: string;
  contactType?: string;
  phone?: string;
  email?: string;
  role?: string;
  inherited?: boolean;
}

interface ObjectImage {
  id: string;
  url?: string;
  imageUrl?: string;
  title?: string;
  description?: string;
}

type WorkOrderListItem = Partial<Omit<WorkOrder, "id" | "scheduledDate">> & {
  id: string;
  scheduledDate?: string | Date | null;
  resourceName?: string;
};

interface ParentRelation {
  id: string;
  parentId?: string;
  parentName?: string;
  childId?: string;
  childName?: string;
  relationType?: string;
}

interface CustomerSummary {
  id: string;
  name: string;
  customerNumber?: string | null;
}

interface ObjectEditForm {
  name?: string;
  objectNumber?: string;
  objectType?: string;
  hierarchyLevel?: string;
  status?: string;
  notes?: string;
  accessType?: string;
  accessCode?: string;
  keyNumber?: string;
  containerCount?: number | string;
  containerCountK2?: number | string;
  containerCountK3?: number | string;
  containerCountK4?: number | string;
  serialNumber?: string;
  manufacturer?: string;
  condition?: string;
}

const hierarchyLevelLabels: Record<string, { label: string; color: string }> = {
  koncern: { label: "Koncern", color: "bg-chart-5/15 text-chart-5 border border-chart-5/30" },
  brf: { label: "BRF", color: "bg-chart-1/15 text-chart-1 border border-chart-1/30" },
  fastighet: { label: "Fastighet", color: "bg-chart-2/15 text-chart-2 border border-chart-2/30" },
  rum: { label: "Rum", color: "bg-chart-3/15 text-chart-3 border border-chart-3/30" },
  karl: { label: "Kärl", color: "bg-chart-4/15 text-chart-4 border border-chart-4/30" },
  objekt: { label: "Objekt", color: "bg-muted text-muted-foreground border border-border" },
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

function InfoRow({ label, value, icon: Icon }: { label: string; value: string | number | null | undefined; icon?: LucideIcon }) {
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
  icon?: LucideIcon;
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
  const mapConfig = useMapConfig();
  const [, params] = useRoute("/objects/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const objectId = params?.id || "";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSection, setEditSection] = useState<"overview" | "access" | "equipment">("overview");
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [restrictionDialogOpen, setRestrictionDialogOpen] = useState(false);
  const [workOrderDialogOpen, setWorkOrderDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  // Task #694: id på den arbetsorder som ska markeras/scrollas fram efter att
  // användaren klickat "Visa arbetsorder" i kortet "Senaste aktivitet".
  const [highlightedWorkOrderId, setHighlightedWorkOrderId] = useState<string | null>(null);

  const [editForm, setEditForm] = useState<ObjectEditForm>({});
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

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => {
    setSearchInput("");
    setSearchQuery("");
    setSearchOpen(false);
  }, [objectId]);

  // Task #694: scrolla fram den markerade arbetsordern i "Arbetsordrar"-fliken
  // när användaren djuplänkat dit från kortet "Senaste aktivitet". Körs en gång
  // per id/tab-byte (querySelector i stället för inline-ref => ingen re-scroll).
  useEffect(() => {
    if (!highlightedWorkOrderId || activeTab !== "workorders") return;
    const el = document.querySelector(`[data-testid="workorder-row-${highlightedWorkOrderId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedWorkOrderId, activeTab]);

  // Rensa markeringen när objektet byts så den inte hänger kvar mellan objekt.
  useEffect(() => {
    setHighlightedWorkOrderId(null);
  }, [objectId]);

  const { data: resolvedObject, isLoading: loadingObject } = useQuery<ResolvedObjectResponse>({
    queryKey: ["/api/objects", objectId, "resolved"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/resolved`);
      if (!res.ok) throw new Error("Failed to fetch object");
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: customer } = useQuery<CustomerSummary>({
    queryKey: ["/api/customers", resolvedObject?.customerId],
    enabled: !!resolvedObject?.customerId,
  });

  const customerIdForSearch: string | undefined = resolvedObject?.customerId || undefined;
  const searchHitsQuery = useQuery<Array<{
    id: string;
    name: string;
    objectNumber: string | null;
    address: string | null;
    hierarchyLevel: string | null;
    path: Array<{ id: string; name: string; hierarchyLevel: string | null }>;
  }>>({
    queryKey: ["/api/customers", customerIdForSearch, "objects", "search", searchQuery],
    queryFn: async () => {
      const r = await fetch(
        `/api/customers/${encodeURIComponent(customerIdForSearch!)}/objects/search?q=${encodeURIComponent(searchQuery)}&limit=50`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Sökningen misslyckades");
      return r.json();
    },
    enabled: !!customerIdForSearch && searchQuery.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
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

  const { data: workOrders = [] } = useQuery<WorkOrderListItem[]>({
    queryKey: ["/api/objects", objectId, "work-orders"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/work-orders`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: metadataResponse } = useQuery<MetadataResponse>({
    queryKey: ["/api/metadata/objects", objectId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}`);
      if (!res.ok) return { metadata: [] };
      return res.json();
    },
    enabled: !!objectId,
  });
  const metadata: MetadataEntry[] = metadataResponse?.metadata || [];

  const { data: contacts = [] } = useQuery<ObjectContact[]>({
    queryKey: ["/api/objects", objectId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/contacts?inheritance=true`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: images = [] } = useQuery<ObjectImage[]>({
    queryKey: ["/api/objects", objectId, "images"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/images`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: timeRestrictions = [] } = useQuery<ObjectTimeRestriction[]>({
    queryKey: ["/api/objects", objectId, "time-restrictions"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/time-restrictions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: parentRelations = [] } = useQuery<ParentRelation[]>({
    queryKey: ["/api/objects", objectId, "parents"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/parents`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  // Task #663: objekt-scoped katalog → kundlåsta fält för andra kunder döljs.
  const { data: metadataTypes = [] } = useQuery<MetadataType[]>({
    queryKey: ["/api/metadata/objects", objectId, "available-types"],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}/available-types`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const { data: matchingArticles = [] } = useQuery<Array<{
    article: { id: string; articleNumber: string; name: string; description?: string; associationLabel: string; associationValue: string; associationOperator: string };
    matchedLabel: string;
    matchedValue: string;
    objectValue: string | null;
    operator: string;
    inherited: boolean;
  }>>({
    queryKey: ["/api/objects", objectId, "matching-articles"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/matching-articles`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId,
  });

  const updateObjectMutation = useMutation({
    mutationFn: async (data: Partial<ServiceObject>) => {
      await apiRequest("PATCH", `/api/objects/${objectId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Sparat", description: "Objektet har uppdaterats." });
      setEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara ändringarna", description: error.message, variant: "destructive" });
    },
  });

  const addContactMutation = useMutation({
    mutationFn: async (data: Partial<ObjectContact>) => {
      await apiRequest("POST", `/api/objects/${objectId}/contacts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      toast({ title: "Kontakt tillagd" });
      setContactDialogOpen(false);
      setContactForm({ name: "", contactType: "primary", phone: "", email: "", role: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte lägga till kontakt", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort kontakt", description: error.message, variant: "destructive" });
    },
  });

  const addImageMutation = useMutation({
    mutationFn: async (data: Partial<ObjectImage>) => {
      await apiRequest("POST", `/api/objects/${objectId}/images`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "images"] });
      toast({ title: "Bild tillagd" });
      setImageDialogOpen(false);
      setImageForm({ imageUrl: "", imageType: "photo", description: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte lägga till bild", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort bild", description: error.message, variant: "destructive" });
    },
  });

  const addRestrictionMutation = useMutation({
    mutationFn: async (data: Partial<ObjectTimeRestriction>) => {
      await apiRequest("POST", `/api/objects/${objectId}/time-restrictions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "time-restrictions"] });
      toast({ title: "Tidsrestriktion tillagd" });
      setRestrictionDialogOpen(false);
      setRestrictionForm({ restrictionType: "time_window", description: "", startTime: "", endTime: "", weekdays: [], isBlockingAllDay: false, preference: "unfavorable", reason: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte lägga till tidsrestriktion", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort tidsrestriktion", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte lägga till metadata", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort metadata", description: error.message, variant: "destructive" });
    },
  });

  const metadataActor = user?.email ?? user?.id ?? undefined;

  const softDeleteMetadataMutation = useMutation({
    mutationFn: async (katalogId: string) => {
      await apiRequest("DELETE", `/api/metadata/objects/${objectId}/field/${katalogId}`, { raderadAv: metadataActor });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Metadata borttagen" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort metadata", description: error.message, variant: "destructive" });
    },
  });

  const restoreMetadataMutation = useMutation({
    mutationFn: async (katalogId: string) => {
      await apiRequest("POST", `/api/metadata/objects/${objectId}/field/${katalogId}/restore`, { restoredBy: metadataActor });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Metadata återställd" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte återställa metadata", description: error.message, variant: "destructive" });
    },
  });

  const reorderMetadataMutation = useMutation({
    mutationFn: async (orderedKatalogIds: string[]) => {
      await apiRequest("PUT", `/api/metadata/objects/${objectId}/order`, { orderedKatalogIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara sorteringsordning", description: error.message, variant: "destructive" });
    },
  });

  // Flytta ett metadata-fält upp/ner och spara hela ordningen (katalog-id-lista).
  const moveMetadata = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= metadata.length) return;
    const ids = metadata
      .map((m) => m.metadataKatalogId)
      .filter((id): id is string => !!id);
    const fromId = metadata[index]?.metadataKatalogId;
    const toId = metadata[target]?.metadataKatalogId;
    if (!fromId || !toId) return;
    const fromPos = ids.indexOf(fromId);
    const toPos = ids.indexOf(toId);
    if (fromPos < 0 || toPos < 0) return;
    [ids[fromPos], ids[toPos]] = [ids[toPos], ids[fromPos]];
    reorderMetadataMutation.mutate(ids);
  };

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
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa arbetsorder", description: error.message, variant: "destructive" });
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
  const inheritanceSources: InheritanceSource[] = obj.inheritanceSources || [];

  const getInheritanceInfo = (fieldName: string) => {
    const source = inheritanceSources.find((s) => s.field === fieldName);
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
        {ancestors.length > 0 && ancestors.slice().reverse().map((anc) => (
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
              {(obj.objectType && objectTypeLabels[obj.objectType]) || obj.objectType}
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
        {(user?.role === "admin" || user?.role === "owner") && (
          <TelinkSyncButton objectId={obj.id} />
        )}
      </div>

      <ObjectVignetteSection objectId={obj.id} />

      {customerIdForSearch && (
        <div className="relative" data-testid="object-tree-search">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder={`Sök i ${customer?.name ? `${customer.name}s ` : ""}hierarki (namn, adress, objektnummer)...`}
              className="pl-8 pr-8"
              data-testid="input-tree-search"
            />
            {searchInput && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setSearchInput(""); setSearchQuery(""); setSearchOpen(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover-elevate"
                aria-label="Rensa sökning"
                data-testid="button-clear-search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          {searchOpen && searchQuery && (
            <div
              className="absolute z-20 left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-[320px] overflow-y-auto"
              data-testid="search-results"
            >
              {searchHitsQuery.isLoading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Söker...
                </div>
              ) : searchHitsQuery.isError ? (
                <div className="flex items-center gap-2 p-3 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" /> Sökningen misslyckades.
                  <Button variant="ghost" size="sm" className="h-5 text-xs px-1" onMouseDown={(e) => { e.preventDefault(); searchHitsQuery.refetch(); }}>Försök igen</Button>
                </div>
              ) : (searchHitsQuery.data || []).length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground" data-testid="text-empty-search">
                  Inga objekt matchar "{searchQuery}".
                </div>
              ) : (
                <ul className="divide-y">
                  {(searchHitsQuery.data || []).map((hit) => {
                    const levelLabel = hit.hierarchyLevel && hierarchyLevelLabels[hit.hierarchyLevel];
                    const pathLabel = hit.path
                      .filter((p) => p.id !== hit.id)
                      .map((p) => p.name)
                      .join(" › ");
                    return (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSearchInput("");
                            setSearchQuery("");
                            setSearchOpen(false);
                            navigate(`/objects/${hit.id}`);
                          }}
                          className="w-full text-left px-3 py-2 hover-elevate flex items-start gap-2"
                          data-testid={`search-hit-${hit.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{hit.name || hit.objectNumber || "Objekt"}</span>
                              {levelLabel && (
                                <Badge variant="outline" className="text-[10px]">{levelLabel.label}</Badge>
                              )}
                              {hit.objectNumber && (
                                <span className="text-[10px] font-mono text-muted-foreground">#{hit.objectNumber}</span>
                              )}
                            </div>
                            {pathLabel && (
                              <div className="text-xs text-muted-foreground truncate" data-testid={`search-hit-path-${hit.id}`}>
                                {pathLabel}
                              </div>
                            )}
                            {hit.address && (
                              <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                <MapPin className="h-3 w-3" /> {hit.address}
                              </div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
          <TabsTrigger value="delivery-preferences" data-testid="tab-delivery-preferences">
            Leveranspreferenser
          </TabsTrigger>
          <TabsTrigger value="ekonomi" data-testid="tab-ekonomi">
            Ekonomi
          </TabsTrigger>
          <TabsTrigger value="matching-articles" data-testid="tab-matching-articles">
            <LinkIcon className="h-3.5 w-3.5 mr-1" />
            Matchande artiklar {matchingArticles.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{matchingArticles.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="history-archive" data-testid="tab-history-archive">
            Historik & Arkiv
          </TabsTrigger>
        </TabsList>

        {/* ==================== ÖVERSIKT ==================== */}
        <TabsContent value="overview">
          {/* Task #692: lyft fram systemfälten "Senaste arbetsorder"/"Senaste
              felanmälan" (skrivs read-only av systemet, Task #682) direkt på kortet. */}
          {(() => {
            const latestWoEntry = findSystemMetadata(metadata, LATEST_WORKORDER_FIELD);
            const latestIssueEntry = findSystemMetadata(metadata, LATEST_ISSUE_FIELD);
            const latestWoValue = getMetadataDisplayValue(latestWoEntry);
            const latestIssueValue = getMetadataDisplayValue(latestIssueEntry);
            const latestWoChanged = formatChangedAt(latestWoEntry?.lastChangedAt);
            const latestIssueChanged = formatChangedAt(latestIssueEntry?.lastChangedAt);
            // Task #694: id för djuplänk (om systemfältet har ett inbäddat id).
            const latestWoId = parseSystemRefId(latestWoEntry, "wo-create");
            const latestIssueId = parseSystemRefId(latestIssueEntry, "public-issue-report");
            return (
              <Card className="mb-4" data-testid="card-latest-activity">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Senaste aktivitet
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3" data-testid="block-latest-workorder">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                        <ClipboardList className="h-3.5 w-3.5" /> Senaste arbetsorder
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">system</Badge>
                      </div>
                      {latestWoValue ? (
                        <>
                          <div className="text-sm font-medium break-words" data-testid="text-latest-workorder">{latestWoValue}</div>
                          {latestWoChanged && (
                            <div className="text-xs text-muted-foreground mt-0.5">Uppdaterad {latestWoChanged}</div>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 mt-1 text-xs text-primary hover:bg-transparent"
                            onClick={() => {
                              if (latestWoId) {
                                navigate(`/work-orders/${latestWoId}`);
                              } else {
                                setActiveTab("workorders");
                              }
                            }}
                            data-testid="link-latest-workorder"
                          >
                            {latestWoId ? "Öppna arbetsorder" : "Visa arbetsordrar"} <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground" data-testid="empty-latest-workorder">
                          Ingen arbetsorder registrerad ännu
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border p-3" data-testid="block-latest-issue">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" /> Senaste felanmälan
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">system</Badge>
                      </div>
                      {latestIssueValue ? (
                        <>
                          <div className="text-sm font-medium break-words" data-testid="text-latest-issue">{latestIssueValue}</div>
                          {latestIssueChanged && (
                            <div className="text-xs text-muted-foreground mt-0.5">Uppdaterad {latestIssueChanged}</div>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 mt-1 text-xs text-primary hover:bg-transparent"
                            onClick={() => navigate(latestIssueId ? `/cases?case=public:${latestIssueId}` : "/cases")}
                            data-testid="link-latest-issue"
                          >
                            {latestIssueId ? "Öppna felanmälan" : "Visa felanmälningar"} <ChevronRight className="h-3 w-3 ml-0.5" />
                          </Button>
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground" data-testid="empty-latest-issue">
                          Ingen felanmälan registrerad ännu
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
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
                <InfoRow label="Objekttyp" value={(obj.objectType && objectTypeLabels[obj.objectType]) || obj.objectType} icon={Box} />
                <InfoRow label="Hierarkinivå" value={(obj.hierarchyLevel && hierarchyLevelLabels[obj.hierarchyLevel]?.label) || obj.hierarchyLevel} icon={Layers} />
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
                      url={mapConfig.tileUrl}
                      attribution={mapConfig.attribution}
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

          <div className="mt-4">
            <PolylineEditor object={obj as ServiceObject} />
          </div>
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
                    {ancestors.slice().reverse().map((anc, idx) => (
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
                    {descendants.map((child) => (
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
                  {metadata.map((m, idx) => {
                    const isInherited = m.source === "inherited";
                    const isSystem = isReadonlyMetadataOrigin(m.metod);
                    const isSoftDeleted = !!m.softDeleted || !!m.raderad;
                    // Tombstone som stryker ett ärvt värde är en lokal rad
                    // (source='local') men har upplöst ärvt ursprung. Visa då
                    // ärvd-ursprung ("Ärvd från X") istället för "Egen".
                    const isInheritedRemoval =
                      isSoftDeleted && (m.inheritedFromName != null || m.inheritedValue != null);
                    const isInheritedOrigin = isInherited || isInheritedRemoval;
                    const rawDisplay = m.vardeString ?? m.vardeInteger ?? m.vardeDecimal ??
                      (m.vardeBoolean !== null && m.vardeBoolean !== undefined ? (m.vardeBoolean ? "Ja" : "Nej") : null) ??
                      (m.vardeDatetime ? new Date(m.vardeDatetime).toLocaleDateString("sv-SE") : null) ??
                      (m.vardeJson ? JSON.stringify(m.vardeJson) : null) ?? null;
                    // Tombstone utan eget värde: visa det borttagna ärvda värdet
                    // (överstruket) så användaren ser exakt vad som togs bort.
                    const displayValue =
                      rawDisplay ?? (isSoftDeleted ? m.inheritedValue ?? null : null) ?? "—";
                    const lastChanged = m.lastChangedAt ? new Date(m.lastChangedAt) : null;
                    const showHistory = !!m.katalog?.kronologiskVisning;
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between py-3 gap-2 ${isSoftDeleted ? "opacity-60" : ""}`}
                        data-testid={`metadata-row-${m.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-4 w-5 p-0 text-muted-foreground"
                                disabled={idx === 0 || reorderMetadataMutation.isPending}
                                onClick={() => moveMetadata(idx, -1)}
                                data-testid={`button-metadata-up-${m.id}`}
                                aria-label="Flytta upp"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-4 w-5 p-0 text-muted-foreground"
                                disabled={idx === metadata.length - 1 || reorderMetadataMutation.isPending}
                                onClick={() => moveMetadata(idx, 1)}
                                data-testid={`button-metadata-down-${m.id}`}
                                aria-label="Flytta ner"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className={`text-sm font-medium ${isSoftDeleted ? "line-through" : ""}`}>{m.katalog?.namn || "—"}</div>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap pl-7">
                            {m.katalog?.kategori && <span>{m.katalog.kategori}</span>}
                            {m.metod && <span>{m.metod}</span>}
                            {lastChanged && (
                              <span className="inline-flex items-center gap-1" data-testid={`text-metadata-last-changed-${m.id}`}>
                                <Clock className="h-3 w-3" />
                                Senast ändrad {lastChanged.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-sm font-mono text-right flex items-center gap-2 shrink-0">
                          <span className={isSoftDeleted ? "line-through" : ""}>{String(displayValue)}</span>
                          {/* Ursprungsbadge: Systemgenererad / Ärvd (ev. ändrad) / Egen */}
                          {isSystem ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-metadata-origin-${m.id}`}>
                                  <Cog className="h-3 w-3" /> Systemgenererad
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>Automatiskt satt av systemet ({m.metod})</TooltipContent>
                            </Tooltip>
                          ) : isInheritedOrigin ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] cursor-help inline-flex items-center gap-1" data-testid={`badge-metadata-origin-${m.id}`}>
                                  <LinkIcon className="h-3 w-3" />
                                  {m.inheritedFromName || m.fromObject?.namn ? `Ärvd från ${m.inheritedFromName || m.fromObject?.namn}` : "Ärvd"}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isInheritedRemoval
                                  ? `Ärvt värde borttaget${m.inheritedFromName ? ` (från ${m.inheritedFromName})` : ""}`
                                  : m.fromObject?.namn ? `Ärvd från: ${m.fromObject.namn}` : "Ärvd från förälder"}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]" data-testid={`badge-metadata-origin-${m.id}`}>Egen</Badge>
                          )}
                          {/* Override: lokalt värde som skiljer sig från ärvt */}
                          {m.overridden && !isInheritedOrigin && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] cursor-help border-warning text-warning" data-testid={`badge-metadata-overridden-${m.id}`}>
                                  Ärvd, men ändrad
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {m.inheritedValue != null
                                  ? `Ärvt värde: ${m.inheritedValue}${m.inheritedFromName ? ` (från ${m.inheritedFromName})` : ""}`
                                  : "Skiljer sig från ärvt värde"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {showHistory && (
                            <MetadataHistorikButton
                              objectId={objectId}
                              katalogId={m.metadataKatalogId || ""}
                              katalogNamn={m.katalog?.namn || ""}
                            />
                          )}
                          {/* Återställ mjuk-raderat fält */}
                          {isSoftDeleted ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => restoreMetadataMutation.mutate(m.metadataKatalogId || "")}
                              disabled={restoreMetadataMutation.isPending || !m.metadataKatalogId}
                              data-testid={`button-restore-metadata-${m.id}`}
                              aria-label="Återställ"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          ) : !isSystem && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => softDeleteMetadataMutation.mutate(m.metadataKatalogId || "")}
                              disabled={softDeleteMetadataMutation.isPending || !m.metadataKatalogId}
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
                  {contacts.map((c) => (
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
                  {images.map((img) => (
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
                  {workOrders.map((wo) => {
                    const isHighlighted = highlightedWorkOrderId === wo.id;
                    return (
                    <div
                      key={wo.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/work-orders/${wo.id}`)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/work-orders/${wo.id}`); } }}
                      className={`flex items-center justify-between py-3 gap-4 transition-colors cursor-pointer hover:bg-muted/50 -mx-2 px-2 rounded-md ${isHighlighted ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
                      data-testid={`workorder-row-${wo.id}`}
                    >
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
                      <Badge className={workOrderStatusColors[wo.orderStatus || "skapad"] || workOrderStatusColors.unassigned}>
                        {wo.orderStatus === "utford" ? "Klar" :
                         wo.orderStatus === "planerad_resurs" ? "Planerad" :
                         wo.orderStatus === "planerad_las" ? "Låst" :
                         wo.orderStatus === "fakturerad" ? "Fakturerad" : "Skapad"}
                      </Badge>
                    </div>
                    );
                  })}
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
                            const daySlots = timeRestrictions.filter((tr) =>
                              tr.weekdays && Array.isArray(tr.weekdays) && tr.weekdays.includes(day.value)
                            );
                            const favorable = daySlots.filter((tr) => tr.preference === "favorable");
                            const unfavorable = daySlots.filter((tr) => tr.preference !== "favorable");
                            if (daySlots.length === 0) {
                              return <div className="h-12 rounded border border-dashed border-muted-foreground/20 flex items-center justify-center text-[10px] text-muted-foreground">—</div>;
                            }
                            return (
                              <div className="space-y-0.5">
                                {favorable.map((s) => (
                                  <div key={s.id} className="bg-chart-2/15 dark:bg-chart-2/15 border border-chart-2/30 dark:border-chart-2/70 rounded px-1 py-0.5" data-testid={`slot-favorable-${s.id}`}>
                                    <div className="text-[10px] font-medium text-chart-2 truncate">{s.startTime || "Hela"}{s.endTime ? `–${s.endTime}` : ""}</div>
                                  </div>
                                ))}
                                {unfavorable.map((s) => (
                                  <div key={s.id} className="bg-destructive/15 dark:bg-destructive/15 border border-destructive/30 dark:border-destructive/70 rounded px-1 py-0.5" data-testid={`slot-unfavorable-${s.id}`}>
                                    <div className="text-[10px] font-medium text-destructive truncate">{s.startTime || "Hela"}{s.endTime ? `–${s.endTime}` : ""}</div>
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
                        <div className="w-3 h-3 rounded bg-chart-2/15 dark:bg-chart-2/15 border border-chart-2/30 dark:border-chart-2/70" />
                        Fördelaktig tid
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        <div className="w-3 h-3 rounded bg-destructive/15 dark:bg-destructive/15 border border-destructive/30 dark:border-destructive/70" />
                        Ofördelaktig tid
                      </div>
                    </div>
                  </div>

                  <Separator className="my-3" />

                  {/* List view */}
                  <div className="divide-y">
                    {timeRestrictions.map((tr) => {
                      const isFavorable = tr.preference === "favorable";
                      return (
                        <div key={tr.id} className={`py-3 border-l-2 pl-3 ${isFavorable ? "border-l-chart-2" : "border-l-destructive"}`} data-testid={`restriction-row-${tr.id}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{RESTRICTION_TYPES.find((t) => t.value === tr.restrictionType)?.label || tr.restrictionType || "Restriktion"}</span>
                              <Badge variant="outline" className={isFavorable ? "border-chart-2/50 text-chart-2" : "border-destructive/50 text-destructive"}>
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

        {/* ==================== LEVERANSPREFERENSER ==================== */}
        <TabsContent value="delivery-preferences">
          <DeliveryPreferencesEditor
            entityKind="object"
            entityId={obj.id}
            initial={(obj as { deliveryPreferences?: DeliveryPreferences | null }).deliveryPreferences}
            invalidateKeys={[["/api/objects", obj.id], ["/api/objects"]]}
          />
          {!((obj as { deliveryPreferences?: DeliveryPreferences | null }).deliveryPreferences) && customer && (
            <p className="text-xs text-muted-foreground mt-3">
              Inga preferenser för objektet — kundens preferenser används som fallback.
            </p>
          )}
        </TabsContent>

        {/* ==================== EKONOMI ==================== */}
        <TabsContent value="ekonomi">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {objectId && (
              <ObjectPayersCard objectId={objectId} canEdit={isAdmin} />
            )}
            {objectId && (
              <InvoiceRecipientsCard objectId={objectId} />
            )}
          </div>
          {!isAdmin && (
            <p className="text-xs text-muted-foreground mt-3">
              Endast administratörer kan ändra betalare och fakturamottagare.
            </p>
          )}
        </TabsContent>

        {/* ==================== MATCHANDE ARTIKLAR ==================== */}
        <TabsContent value="matching-articles">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <LinkIcon className="h-4 w-4" /> Matchande artiklar via association
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {matchingArticles.length > 0 ? (
                <div className="space-y-3">
                  {matchingArticles.map((match, i) => (
                    <div key={`${match.article.id}-${i}`} className="flex items-start gap-3 p-3 rounded-md border bg-muted/30">
                      <Package className="h-5 w-5 mt-0.5 text-primary" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{match.article.name}</span>
                          <Badge variant="outline" className="font-mono text-xs">{match.article.articleNumber}</Badge>
                        </div>
                        {match.article.description && (
                          <p className="text-xs text-muted-foreground">{match.article.description}</p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">
                            {match.matchedLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {match.operator === "equals" ? "=" : match.operator === "contains" ? "∋" : match.operator === "starts_with" ? "^" : "≠"}
                          </span>
                          <Badge variant="outline" className="font-mono text-xs">{match.matchedValue}</Badge>
                          <span className="text-xs text-muted-foreground">→</span>
                          <Badge variant="default" className="font-mono text-xs">{match.objectValue}</Badge>
                          {match.inherited && (
                            <Badge variant="secondary" className="text-xs italic">ärvd</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Inga artiklar matchar detta objekt via association-filter.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history-archive">
          <ObjectHistoryArchiveTab objectId={objectId} isArchived={!!resolvedObject?.deletedAt} />
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
                const payload: ObjectEditForm = {};
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
                updateObjectMutation.mutate(payload as Partial<ServiceObject>);
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
              <div className="p-3 bg-chart-3/10 dark:bg-chart-3/15 border border-chart-3/20 dark:border-chart-3/80 rounded-md text-sm text-chart-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
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
  metadataTypes: MetadataType[];
  onAdd: (data: { objektId: string; metadataTypNamn: string; varde: string }) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [value, setValue] = useState("");

  const selectedMetaType = metadataTypes.find((t) => t.namn === selectedType || t.id === selectedType);
  const allowedValues = selectedMetaType?.allowedValues ?? null;
  const hasAllowedValues = !!allowedValues && allowedValues.length > 0;

  const sortedTypes = [...metadataTypes].sort((a, b) => {
    const an = a.displayNumber ?? 9999;
    const bn = b.displayNumber ?? 9999;
    if (an !== bn) return an - bn;
    return a.namn.localeCompare(b.namn, "sv");
  });

  const handleAdd = () => {
    if (!selectedType) return;
    onAdd({
      objektId: objectId,
      metadataTypNamn: selectedMetaType?.namn || selectedType,
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
                <Select value={selectedType} onValueChange={(v) => { setSelectedType(v); setValue(""); }}>
                  <SelectTrigger data-testid="select-metadata-type">
                    <SelectValue placeholder="Välj typ..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedTypes.map((t) => {
                      const prefix = t.displayNumber != null ? `${t.displayNumber}. ` : "";
                      const dropdownHint = t.allowedValues && t.allowedValues.length > 0 ? " · fasta val" : "";
                      return (
                        <SelectItem key={t.id || t.namn} value={t.namn}>
                          {prefix}{t.namn} {t.kategori ? `(${t.kategori})` : ""}{dropdownHint}
                        </SelectItem>
                      );
                    })}
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
              {hasAllowedValues ? (
                <Select value={value} onValueChange={setValue} disabled={!selectedType}>
                  <SelectTrigger data-testid="select-metadata-value">
                    <SelectValue placeholder="Välj värde..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedValues!.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Ange värde"
                  data-testid="input-metadata-value"
                />
              )}
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

// Task #579: Knapp + dialog som visar kronologisk historik för ett
// specifikt metadata-fält på ett objekt. Visas endast när
// `metadata_katalog.kronologisk_visning = true`.
function MetadataHistorikButton({
  objectId,
  katalogId,
  katalogNamn,
}: {
  objectId: string;
  katalogId: string;
  katalogNamn: string;
}) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{
    katalog: { id: string; namn: string; datatyp: string; kronologiskVisning: boolean };
    history: Array<{
      id: string;
      gammaltVarde: string | null;
      nyttVarde: string | null;
      andradAv: string | null;
      andradVid: string;
      andringsMetod: string | null;
    }>;
  }>({
    queryKey: ["/api/metadata/objects", objectId, "definition", katalogId, "historik"],
    queryFn: async () => {
      const res = await fetch(
        `/api/metadata/objects/${objectId}/definition/${katalogId}/historik`,
      );
      if (!res.ok) throw new Error("Kunde inte hämta historik");
      return res.json();
    },
    enabled: open,
  });

  const entries = data?.history ?? [];

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setOpen(true)}
            data-testid={`button-metadata-history-${katalogId}`}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Visa historik</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Historik – {katalogNamn}
            </DialogTitle>
            <DialogDescription>
              Kronologisk tidslinje över alla ändringar på detta fält. Nyaste händelsen visas först.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto" data-testid="metadata-history-list">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Ingen historik registrerad för detta fält ännu.
              </p>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-4 py-2">
                {entries.map((e) => {
                  const when = new Date(e.andradVid);
                  const isDelete = e.nyttVarde === null;
                  const isCreate = e.gammaltVarde === null;
                  return (
                    <li key={e.id} className="ml-4" data-testid={`metadata-history-entry-${e.id}`}>
                      <span
                        className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-border ${
                          isDelete ? "bg-destructive" : isCreate ? "bg-chart-4" : "bg-primary"
                        }`}
                      />
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <div className="text-xs text-muted-foreground">
                          {when.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                          {e.andradAv && <span className="ml-2">av {e.andradAv}</span>}
                        </div>
                        {e.andringsMetod && (
                          <Badge variant="outline" className="text-[10px]">
                            {e.andringsMetod}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-sm font-mono break-words">
                        {isCreate ? (
                          <>
                            <span className="text-muted-foreground">∅</span>{" "}
                            <span className="text-muted-foreground">→</span>{" "}
                            <span>{e.nyttVarde ?? "∅"}</span>
                          </>
                        ) : isDelete ? (
                          <>
                            <span className="line-through text-muted-foreground">
                              {e.gammaltVarde ?? "∅"}
                            </span>{" "}
                            <span className="text-muted-foreground">→</span>{" "}
                            <span className="text-destructive">∅ (raderad)</span>
                          </>
                        ) : (
                          <>
                            <span className="line-through text-muted-foreground">
                              {e.gammaltVarde ?? "∅"}
                            </span>{" "}
                            <span className="text-muted-foreground">→</span>{" "}
                            <span>{e.nyttVarde}</span>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-close-history">
              Stäng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
