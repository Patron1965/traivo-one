import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ObjectHistoryArchiveTab } from "@/components/ObjectHistoryArchiveTab";
import { ObjectVignetteSection } from "@/components/ObjectVignetteSection";
import { ObjectHeaderPanel } from "@/components/ObjectHeaderPanel";
import { type MetadataFormEntry, type MetadataFormType, type MetadataRelatedParent, type MetadataRelatedChild } from "@/components/ObjectMetadataForm";
import { buildLegacyObjectFieldEntries, type LegacyFieldInput } from "@/lib/legacy-object-fields";
import { KallaBadge } from "@/lib/metadata-kalla";
import { ObjectTemplateMetadataForm, type TemplateMetadataType } from "@/components/ObjectTemplateMetadataForm";
import { ObjectSystemGeneratedPanel } from "@/components/ObjectSystemGeneratedPanel";
import { InfoPackageTree } from "@/components/objects/InfoPackageTree";
import InvoiceRecipientsCard from "@/components/InvoiceRecipientsCard";
import { TelinkSyncButton } from "@/components/TelinkSyncButton";
import { SnabborderDialog } from "@/components/SnabborderDialog";
import { ObjectHierarchyCards } from "@/components/objects/ObjectHierarchyCards";
import { ObjectParentCombobox } from "@/components/ObjectParentCombobox";
import { MetadataFieldBuilder, type BuilderFieldValue, type InheritedFieldSeed } from "@/components/MetadataFieldBuilder";
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
import { apiRequest, versionedUrl } from "@/lib/queryClient";
import type { ObjectTimeRestriction } from "@shared/schema";
import {
  ArrowLeft, Building2, MapPin, Key, Keyboard, Users, DoorOpen,
  Clock, Package, FileText, Image, Contact, GitFork, AlertTriangle,
  Calendar, Loader2, ChevronRight, Wrench,
  Box, Layers, Plus,
  Trash2, Pencil, Save, X, Phone, Mail, LinkIcon, Search, History,
  ArrowUp, ArrowDown, RotateCcw, Cog, Copy, Gauge, Zap
} from "lucide-react";
import { ObjectMetadataBody } from "@/components/objects/ObjectMetadataBody";
import { ObjectSystemDetailLists } from "@/components/objects/ObjectSystemDetailLists";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMapConfig } from "@/hooks/use-map-config";
import type { ServiceObject, WorkOrder, ImportTemplate } from "@shared/schema";
import { PolylineEditor } from "@/components/PolylineEditor";
import { objectStatusBadge as statusColors, workOrderStatusBadge as workOrderStatusColors } from "@/lib/status-colors";
import { OBJECT_LOCATION_TYPE_LABELS, objectLocationTypeLabel, objectLocationTypeBadgeClass } from "@/lib/object-location";
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
  lineCount?: number;
};

interface ObjectAssignmentItem {
  id: string;
  title: string;
  status: string;
  priority?: string | null;
  scheduledDate?: string | null;
  quantity?: number | null;
  createdAt?: string | null;
  orderConceptId?: string | null;
  orderConceptName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
}

interface IssueReportItem {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status?: string | null;
  reporterName?: string | null;
  photos?: string[] | null;
  createdAt?: string | null;
}

interface ParentRelation {
  id: string;
  parentId?: string;
  parentName?: string;
  childId?: string;
  childName?: string;
  relationType?: string;
  isPrimary?: boolean;
  relationContext?: string | null;
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
  locationType?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

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

const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Task #1128: enkelsidig "Objektöversikt" — sektion-id:n motsvarar de gamla
// flik-värdena. Ekonomi/arkiv ligger i den hopfällbara "Avancerat"-sektionen,
// så gamla ?tab=-djuplänkar dit mappas till deep-tools.
const TAB_TO_SECTION: Record<string, string> = {
  ekonomi: "deep-tools",
  "history-archive": "deep-tools",
  // Bakåtkompatibilitet efter Fas 1-omstruktureringen: gamla ?tab=-djuplänkar för
  // borttagna/omdöpta sektioner scrollar till närmaste kvarvarande ankare.
  // Steg 1 ("allt är metadata"): objektfälten (access/equipment) renderas nu
  // som legacy-metadata inuti metadata-sektionen, så gamla djuplänkar dit landar.
  access: "metadata",
  equipment: "metadata",
  "delivery-preferences": "metadata",
};

export default function ObjectDetailPage() {
  const mapConfig = useMapConfig();
  const [, params] = useRoute("/objects/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const objectId = params?.id || "";
  // Task #1084: enhetligt objektformulär — samma helskärmssida används för
  // skapa (id === "new"), redigera och visa. I skapa-läge ska inga objekt-
  // specifika queries köras (det finns inget objekt ännu).
  const isCreate = objectId === "new";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const canUseTemplates = isAdmin || user?.role === "planner";

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSection, setEditSection] = useState<"overview" | "access" | "equipment">("overview");
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [restrictionDialogOpen, setRestrictionDialogOpen] = useState(false);
  // Task #1128: flikar ersatta av ankrade sektioner. "Avancerat" (ekonomi/arkiv)
  // är hopfällt som standard; öppnas automatiskt vid navigering dit.
  const [deepToolsOpen, setDeepToolsOpen] = useState(false);
  const didInitialScroll = useRef(false);

  const [editForm, setEditForm] = useState<ObjectEditForm>({});
  const [snabborderOpen, setSnabborderOpen] = useState(false);
  // Task #713: flytta- och kopiera-dialoger
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveSearch, setMoveSearch] = useState("");
  // Task #863: vilket objekt som flyttas (sidans objekt eller ett barn i grenträdet).
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [copyMode, setCopyMode] = useState<"single" | "branch">("single");
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
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => {
    setSearchInput("");
    setSearchQuery("");
    setSearchOpen(false);
  }, [objectId]);

  const { data: resolvedObject, isLoading: loadingObject } = useQuery<ResolvedObjectResponse>({
    queryKey: ["/api/objects", objectId, "resolved"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/resolved`);
      if (!res.ok) throw new Error("Failed to fetch object");
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  const { data: customer } = useQuery<CustomerSummary>({
    queryKey: ["/api/customers", resolvedObject?.customerId],
    enabled: !!resolvedObject?.customerId,
  });

  // Task #1128: scrollar till en sektion via dess id. Gamla flik-värden och
  // ObjectMetadataForm-navigeringen (onNavigateToTab) mappas hit.
  const scrollToSection = useCallback((key: string) => {
    const target = TAB_TO_SECTION[key] ?? key;
    const doScroll = () => {
      const el = document.getElementById(`object-section-${target}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    if (target === "deep-tools") {
      setDeepToolsOpen(true);
      window.setTimeout(doScroll, 160);
    } else {
      requestAnimationFrame(doScroll);
    }
  }, []);

  // Task #1128: bakåtkompatibilitet — gamla ?tab=-djuplänkar scrollar till
  // motsvarande sektion när objektet laddats.
  useEffect(() => {
    if (isCreate || !resolvedObject || didInitialScroll.current) return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab) {
      didInitialScroll.current = true;
      scrollToSection(tab);
    }
  }, [isCreate, resolvedObject, scrollToSection]);

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
    enabled: !!objectId && !isCreate,
  });

  const { data: ancestors = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects", objectId, "ancestors"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/ancestors`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  const { data: workOrders = [] } = useQuery<WorkOrderListItem[]>({
    queryKey: ["/api/objects", objectId, "work-orders"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/work-orders`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  // Task #857: planeringslager-uppgifter (assignments) kopplade till objektet,
  // berikade med orderkoncept + kund för djuplänkning objekt → uppgift → koncept → kund.
  const { data: objectAssignments = [] } = useQuery<ObjectAssignmentItem[]>({
    queryKey: ["/api/objects", objectId, "assignments"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/assignments`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  // Task #714: kronologisk lista över felanmälningar (med bläddringsbara foton).
  const { data: issueReports = [] } = useQuery<IssueReportItem[]>({
    queryKey: ["/api/objects", objectId, "issue-reports"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/issue-reports`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  const { data: metadataResponse } = useQuery<MetadataResponse>({
    queryKey: ["/api/metadata/objects", objectId],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}`);
      if (!res.ok) return { metadata: [] };
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });
  const metadata: MetadataEntry[] = metadataResponse?.metadata || [];

  const { data: contacts = [] } = useQuery<ObjectContact[]>({
    queryKey: ["/api/objects", objectId, "contacts"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/contacts?inheritance=true`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  const { data: images = [] } = useQuery<ObjectImage[]>({
    queryKey: ["/api/objects", objectId, "images"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/images`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  const { data: timeRestrictions = [] } = useQuery<ObjectTimeRestriction[]>({
    queryKey: ["/api/objects", objectId, "time-restrictions"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/time-restrictions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  const { data: parentRelations = [] } = useQuery<ParentRelation[]>({
    queryKey: ["/api/objects", objectId, "parents"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/parents`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  // Task #663: objekt-scoped katalog → kundlåsta fält för andra kunder döljs.
  const { data: metadataTypes = [] } = useQuery<MetadataType[]>({
    queryKey: ["/api/metadata/objects", objectId, "available-types"],
    queryFn: async () => {
      const res = await fetch(`/api/metadata/objects/${objectId}/available-types`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate,
  });

  // Task #998: namngivna importmallar återanvänds som fälturval för mall-styrd
  // redigering. Läs-endpointen är öppen för admin/owner och planner.
  const { data: importTemplates = [] } = useQuery<ImportTemplate[]>({
    queryKey: ["/api/import-templates"],
    queryFn: async () => {
      const res = await fetch(`/api/import-templates`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!objectId && !isCreate && canUseTemplates,
  });

  const updateObjectMutation = useMutation({
    mutationFn: async (data: Partial<ServiceObject>) => {
      await apiRequest("PATCH", `/api/objects/${objectId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "ancestors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Sparat", description: "Objektet har uppdaterats." });
      setEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara ändringarna", description: error.message, variant: "destructive" });
    },
  });

  // Task #713: lista alla objekt (för förälder-väljaren) — laddas bara när
  // flytta-dialogen är öppen.
  const { data: allObjects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
    enabled: moveDialogOpen,
  });

  // Task #713: flytta objektet till ny förälder (null = rotnivå). Servern
  // cykelskyddar och validerar ägarskap; barnobjekt + släktnamn uppdateras.
  const moveObjectMutation = useMutation({
    mutationFn: async (newParentId: string | null) => {
      const targetId = moveTargetId || objectId;
      await apiRequest("PATCH", `/api/objects/${targetId}/move`, { parentId: newParentId });
    },
    onSuccess: () => {
      const targetId = moveTargetId || objectId;
      // Sidans objekt: grenträd, släktnamn och resolved-vy kan ha ändrats.
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "ancestors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "descendants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "resolved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "parents"] });
      // Det flyttade objektet (om det är ett barn) — egna ancestors/parents/resolved.
      if (targetId !== objectId) {
        queryClient.invalidateQueries({ queryKey: ["/api/objects", targetId, "ancestors"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects", targetId, "descendants"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects", targetId, "resolved"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects", targetId, "parents"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Objekt flyttat" });
      setMoveDialogOpen(false);
      setMoveSearch("");
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte flytta objektet", description: error.message, variant: "destructive" });
    },
  });

  // Task #863: öppna flytt-dialogen för ett valfritt objekt (sidans objekt eller
  // ett barn i grenträdet). Servern cykelskyddar/ägarskapskontrollerar oavsett.
  const openMoveDialog = (targetId: string) => {
    setMoveTargetId(targetId);
    setMoveSearch("");
    setMoveDialogOpen(true);
  };

  // Task #863: ids i ett underträd (rot + alla barn) härlett ur descendants-listan,
  // används för att exkludera ogiltiga föräldra-mål i flytt-dialogen.
  const getSubtreeIds = (rootId: string): Set<string> => {
    const byParent = new Map<string, ServiceObject[]>();
    for (const d of descendants) {
      const p = d.parentId || "";
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(d);
    }
    const ids = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of byParent.get(cur) || []) {
        if (!ids.has(c.id)) {
          ids.add(c.id);
          stack.push(c.id);
        }
      }
    }
    return ids;
  };

  // Task #713: kopiera objekt (single) eller hela grenen (branch).
  const copyObjectMutation = useMutation({
    mutationFn: async ({ name, mode }: { name: string; mode: "single" | "branch" }) => {
      const res = await apiRequest("POST", `/api/objects/${objectId}/copy`, { name, mode });
      return res.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "descendants"] });
      const count = created?.createdCount ?? 1;
      if (created?.metadataCopyError) {
        toast({ title: "Objekt kopierat – men metadata misslyckades", description: created.metadataCopyError, variant: "destructive" });
      } else {
        toast({ title: "Objekt kopierat", description: count > 1 ? `${count} objekt kopierade.` : undefined });
      }
      setCopyDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte kopiera objektet", description: error.message, variant: "destructive" });
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

  // Task #998: uppdatera ett befintligt lokalt metadata-värde (PUT). Mall-vyns
  // inline-redigering använder denna väg för fält som redan har eget värde.
  const updateMetadataMutation = useMutation({
    mutationFn: async ({ id, varde }: { id: string; varde: string }) => {
      await apiRequest("PUT", `/api/metadata/${id}`, { varde, uppdateradAv: metadataActor });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Metadata uppdaterad" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte uppdatera metadata", description: error.message, variant: "destructive" });
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
      locationType: resolvedObject.locationType || "auto",
      latitude: resolvedObject.latitude ?? "",
      longitude: resolvedObject.longitude ?? "",
    });
    setEditDialogOpen(true);
  };

  // ===========================================================================
  // Task #1084: SKAPA-LÄGE (id === "new") — samma helskärmsformulär som visa/
  // redigera. Förälder kan förifyllas via ?parentId / ?parentName (t.ex. från
  // "Lägg till underordnat"). Alla hooks nedan måste deklareras före de tidiga
  // returerna (loadingObject / not-found) så React-hook-ordningen är stabil.
  // ===========================================================================
  const [createName, setCreateName] = useState("");
  const [createParentId, setCreateParentId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("parentId"),
  );
  const [createParentName, setCreateParentName] = useState<string>(
    () => new URLSearchParams(window.location.search).get("parentName") || "",
  );
  const [createMetadataFields, setCreateMetadataFields] = useState<BuilderFieldValue[]>([]);
  const [createBuilderKey, setCreateBuilderKey] = useState(0);

  const { data: nextNumberData } = useQuery<{ objectNumber: string }>({
    queryKey: ["/api/objects/next-number"],
    queryFn: async () => {
      const res = await fetch(versionedUrl("/api/objects/next-number"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isCreate,
    staleTime: 0,
  });

  const { data: createParentMetadata } = useQuery<{ metadata: any[] }>({
    queryKey: ["/api/metadata/objects", createParentId, "create-seed"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/metadata/objects/${createParentId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isCreate && !!createParentId,
    staleTime: 30000,
  });

  const createInheritedSeeds = useMemo<InheritedFieldSeed[]>(() => {
    if (!createParentId || !createParentMetadata?.metadata) return [];
    const entryValue = (e: any): string => {
      if (e.vardeString != null) return String(e.vardeString);
      if (e.vardeInteger != null) return String(e.vardeInteger);
      if (e.vardeDecimal != null) return String(e.vardeDecimal);
      if (e.vardeBoolean != null) return e.vardeBoolean ? "true" : "false";
      if (e.vardeDatetime != null) return String(e.vardeDatetime);
      if (e.vardeJson != null) return typeof e.vardeJson === "string" ? e.vardeJson : JSON.stringify(e.vardeJson);
      return "";
    };
    return createParentMetadata.metadata
      .filter((e: any) => e.source !== "computed")
      .filter((e: any) => (e.source === "local" && e.arvsNedat) || e.source === "inherited")
      .map((e: any) => ({
        namn: e.katalog?.namn as string,
        datatyp: (e.katalog?.datatyp as string) || "text",
        value: entryValue(e),
        sourceName: e.fromObject?.namn ?? createParentName,
        allowedValues: e.katalog?.allowedValues ?? null,
        area: e.katalog?.area ?? null,
      }))
      .filter((s: InheritedFieldSeed) => !!s.namn);
  }, [createParentId, createParentMetadata, createParentName]);

  const createObjectMutation = useMutation({
    // Objektet skapas först (1 anrop), därefter skrivs metadatavärden. Inte
    // atomiskt — vi skiljer på "objektet kunde inte skapas" och "objektet
    // skapades men metadatafält misslyckades" så användaren inte skapar dubbletter.
    mutationFn: async (payload: { data: Partial<ServiceObject>; metadata: BuilderFieldValue[] }) => {
      const res = await apiRequest("POST", "/api/objects", payload.data);
      const created = await res.json();
      const metadataErrors: string[] = [];
      for (const field of payload.metadata) {
        if (field.varde === "" || field.varde == null) continue;
        try {
          await apiRequest("POST", "/api/metadata/", {
            objektId: created.id,
            metadataTypNamn: field.namn,
            varde: field.varde,
          });
        } catch (e) {
          metadataErrors.push(`${field.namn}: ${e instanceof Error ? e.message : "okänt fel"}`);
        }
      }
      return { created, metadataErrors };
    },
    onSuccess: ({ created, metadataErrors }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/objects/next-number"] });
      if (metadataErrors.length > 0) {
        toast({
          title: "Objekt skapat – vissa metadatafält misslyckades",
          description: `Objektet skapades, men ${metadataErrors.length} fält kunde inte sparas: ${metadataErrors.join("; ")}. Skapa inte objektet igen — komplettera fälten i detaljvyn.`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Objekt skapat" });
      }
      navigate(`/objects/${created.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte skapa objektet", description: error.message, variant: "destructive" });
    },
  });

  if (isCreate) {
    const createDisplayName = createParentName
      ? `${createParentName} > ${createName || "(nytt objekt)"}`
      : (createName || "(nytt objekt)");
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6" data-testid="object-create-page">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate("/objects")} data-testid="button-back-to-objects">
            <ArrowLeft className="h-4 w-4 mr-1" /> Objekt
          </Button>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-foreground">
            {createParentId ? "Lägg till underordnat objekt" : "Skapa nytt objekt"}
          </span>
        </div>

        <div>
          <h1 className="text-2xl font-bold" data-testid="text-create-object-title">
            {createParentId ? "Lägg till underordnat objekt" : "Skapa nytt objekt"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {createParentId ? (
              <>Nytt objekt under <span className="font-medium text-foreground">{createParentName}</span>. Ärvda metadatavärden är förifyllda nedan.</>
            ) : (
              "Fyll i uppgifterna för det nya objektet. Objekttyp, adress och kund läggs till som metadata."
            )}
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div>
              <Label>Systemnummer</Label>
              <Input
                value={nextNumberData?.objectNumber ?? "—"}
                readOnly
                disabled
                className="font-mono bg-muted"
                data-testid="input-new-object-number"
              />
              <p className="text-xs text-muted-foreground mt-1">Genereras automatiskt vid skapande.</p>
            </div>
            <div>
              <Label>Namn</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Objektnamn"
                data-testid="input-new-object-name"
              />
            </div>
            <div>
              <Label>Släktnamn</Label>
              <Input
                value={createDisplayName}
                readOnly
                disabled
                className="bg-muted"
                data-testid="input-new-object-displayname"
              />
              <p className="text-xs text-muted-foreground mt-1">Genereras automatiskt från överordnat objekt och namn.</p>
            </div>
            <div>
              <Label>Överordnat objekt</Label>
              <ObjectParentCombobox
                value={createParentId}
                valueLabel={createParentName}
                onChange={(id, opt) => {
                  setCreateParentId(id);
                  setCreateParentName(opt ? (opt.displayName || opt.name) : "");
                }}
                className="w-full"
                testId="select-new-parent"
              />
              <p className="text-xs text-muted-foreground mt-1">Sök på objektets namn, adress eller något led i släktnamnet — t.ex. "Hemköp Hisingen pantrum". Släktnamnet visas per träff så du kopplar mot rätt gren.</p>
            </div>
            <div className="border-t pt-4">
              <Label className="mb-2 block">Metadata</Label>
              <p className="text-xs text-muted-foreground mb-3">Objekttyp, adress, kund m.m. läggs till som metadatafält. Ärvda värden från överordnat objekt är förifyllda.</p>
              <MetadataFieldBuilder
                key={createBuilderKey}
                customerId={null}
                inheritedFields={createParentId ? createInheritedSeeds : undefined}
                onChange={setCreateMetadataFields}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate("/objects")} data-testid="button-cancel-create-object">
            Avbryt
          </Button>
          <Button
            onClick={() => createObjectMutation.mutate({
              data: {
                name: createName,
                parentId: createParentId || undefined,
                objectType: "fastighet",
                accessType: "open",
              },
              metadata: createMetadataFields,
            })}
            disabled={!createName || createObjectMutation.isPending}
            data-testid="button-create-object"
          >
            {createObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Skapa
          </Button>
        </div>
      </div>
    );
  }

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

  // Task #1031: släktträd i 360-översikten. Namn slås upp ur redan hämtade
  // ancestors/descendants (täcker primär förälder + barn alltid); alternativa
  // föräldrar faller tillbaka på id-fragment om de saknas i kedjorna.
  const relationNameById = new Map<string, string>();
  for (const a of ancestors) relationNameById.set(a.id, a.name || a.objectNumber || a.id.slice(0, 8));
  for (const d of descendants) relationNameById.set(d.id, d.name || d.objectNumber || d.id.slice(0, 8));
  relationNameById.set(obj.id, obj.name || obj.objectNumber || obj.id.slice(0, 8));
  // objects.parentId speglar alltid den primära föräldern.
  const relatedParents: MetadataRelatedParent[] = parentRelations
    .filter((p): p is ParentRelation & { parentId: string } => !!p.parentId)
    .map((p) => ({
      id: p.parentId,
      name: relationNameById.get(p.parentId) || p.parentName || `Objekt ${p.parentId.slice(0, 8)}`,
      isPrimary: p.isPrimary ?? p.parentId === obj.parentId,
      relationContext: p.relationContext ?? null,
    }));
  const relatedChildren: MetadataRelatedChild[] = descendants
    .filter((d) => d.parentId === objectId)
    .map((d) => ({
      id: d.id,
      name: d.name || d.objectNumber || d.id.slice(0, 8),
      objectType: d.objectType ?? null,
      hierarchyLevel: d.hierarchyLevel ?? null,
    }));
  // Task #1128: primär förälder för header-sammanfattningen.
  const primaryParent = relatedParents.find((p) => p.isPrimary) ?? relatedParents[0] ?? null;


  // Task #863: objektet som flytt-dialogen avser — sidans objekt eller ett barn
  // i grenträdet (hämtas från descendants-listan).
  const moveTargetObj: { name?: string | null; objectNumber?: string | null } | undefined =
    !moveTargetId || moveTargetId === objectId
      ? obj
      : descendants.find((d) => d.id === moveTargetId);

  // Task #713: Släktnamn = hela kedjan rot → detta objekt, sammanfogad med " > ".
  // ancestors (root→self) inkluderar normalt objektet självt sist; dedupliceras
  // defensivt så vi aldrig får dubbel slutnod.
  const slaktnamnChain: { id: string; name: string }[] = (() => {
    const chain = ancestors.map((a) => ({ id: a.id, name: a.name || a.objectNumber || "" }));
    if (chain.length === 0 || chain[chain.length - 1].id !== objectId) {
      chain.push({ id: objectId, name: obj.name || obj.objectNumber || "" });
    }
    return chain;
  })();
  const slaktnamn = slaktnamnChain.map((c) => c.name).join(" > ");

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

  const objectTypeLabel = (obj.objectType && objectTypeLabels[obj.objectType]) || obj.objectType || "";

  const containerCounts = [
    { label: "K1", value: obj.containerCount },
    { label: "K2", value: obj.containerCountK2 },
    { label: "K3", value: obj.containerCountK3 },
    { label: "K4", value: obj.containerCountK4 },
  ].filter(c => c.value && c.value > 0);

  // Task #1128 Fas 1 (P1 / "allt är metadata"): objektkolumner som ännu inte
  // flyttats till metadatamodellen projiceras som syntetiska metadata-poster
  // (KÄLLA=M + "Under migrering") och renderas genom den enhetliga
  // metadata-ytan i stället för i ett separat hårdkodat kort. Presentation-only
  // (expand-contract) — kolumnerna matar fortfarande routing/VRP/mobil/Fortnox.
  const legacyFieldEntries: MetadataFormEntry[] = (() => {
    // Tillgångsinformation kan vara objekt eller sträng — samma normalisering
    // som det gamla kortet använde.
    let accessInfoStr: string | null = null;
    const accessInfoRaw = obj.resolvedAccessInfo || obj.accessInfo;
    if (accessInfoRaw) {
      if (typeof accessInfoRaw === "object") {
        const parts = Object.entries(accessInfoRaw as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => `${k}: ${String(v)}`);
        accessInfoStr = parts.length ? parts.join(" · ") : null;
      } else {
        const s = String(accessInfoRaw).trim();
        accessInfoStr = s === "" || s === "{}" ? null : s;
      }
    }
    const portkod = obj.resolvedAccessCode || obj.accessCode;
    const nyckel = obj.resolvedKeyNumber || obj.keyNumber;
    // accessType har DB-default "open" — behandla det som "inget värde".
    const hasRealAccessType = Boolean(obj.accessType && obj.accessType !== "open");
    const codeInfo = getInheritanceInfo("accessCode");
    const keyInfo = getInheritanceInfo("keyNumber");
    const accessInfoData = getInheritanceInfo("accessInfo");
    const fmtDate = (d: string | Date | null | undefined) =>
      d ? new Date(d).toLocaleDateString("sv-SE") : null;
    const inputs: LegacyFieldInput[] = [
      {
        column: "accessType",
        namn: "Tillgångstyp",
        value: hasRealAccessType && obj.accessType
          ? accessTypeLabels[obj.accessType]?.label || obj.accessType
          : null,
        editGroup: "access",
      },
      { column: "accessCode", namn: "Portkod", value: portkod, editGroup: "access", inherited: codeInfo.inherited, inheritedFromName: codeInfo.sourceName },
      { column: "keyNumber", namn: "Nyckelnummer", value: nyckel, editGroup: "access", inherited: keyInfo.inherited, inheritedFromName: keyInfo.sourceName },
      { column: "accessInfo", namn: "Övrig tillgångsinformation", value: accessInfoStr, editGroup: "access", inherited: accessInfoData.inherited, inheritedFromName: accessInfoData.sourceName },
      ...containerCounts.map((c) => ({
        column: `containerCount${c.label}`,
        namn: `Behållarantal ${c.label}`,
        value: c.value,
        editGroup: "equipment" as const,
      })),
      { column: "serialNumber", namn: "Serienummer", value: obj.serialNumber, editGroup: "equipment" },
      { column: "manufacturer", namn: "Tillverkare", value: obj.manufacturer, editGroup: "equipment" },
      { column: "purchaseDate", namn: "Inköpsdatum", value: fmtDate(obj.purchaseDate as any), editGroup: "equipment" },
      { column: "warrantyExpiry", namn: "Garanti utgår", value: fmtDate(obj.warrantyExpiry as any), editGroup: "equipment" },
      { column: "lastInspection", namn: "Senaste inspektion", value: fmtDate(obj.lastInspection as any), editGroup: "equipment" },
      { column: "notes", namn: "Anteckningar", value: obj.notes, editGroup: "overview" },
    ];
    return buildLegacyObjectFieldEntries(inputs);
  })();

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
            {objectTypeLabel && (
              <Badge variant="secondary" data-testid="badge-object-type">
                {objectTypeLabel}
              </Badge>
            )}
            <Badge className={(obj as any).deletedAt ? statusColors.inactive : statusColors.active} data-testid="badge-status">
              {(obj as any).deletedAt ? "Arkiverad" : "Aktiv"}
            </Badge>
            {obj.accessType && obj.accessType !== "open" && (
              <Badge variant="outline" className="gap-1" data-testid="badge-access-type">
                <AccessIcon className="h-3 w-3" />
                {accessTypeLabels[obj.accessType]?.label}
              </Badge>
            )}
          </div>
          {/* Task #1128: släktskap direkt i headern — redigerbar förälder + underordnade. */}
          <div className="flex items-center gap-x-4 gap-y-1 mt-2 flex-wrap text-sm">
            <div className="flex items-center gap-1.5" data-testid="header-parent-summary">
              <GitFork className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Förälder:</span>
              {primaryParent ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/objects/${primaryParent.id}`)}
                    className="font-medium text-foreground hover:underline"
                    data-testid="link-header-parent"
                  >
                    {primaryParent.name}
                  </button>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">(primär)</span>
                </span>
              ) : (
                <span className="text-muted-foreground" data-testid="text-header-parent-none">Ingen förälder</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => scrollToSection("hierarchy")}
                data-testid="button-edit-parent"
                title="Redigera förälder"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {/* Task #1128: alternativa föräldrar (multi-parent). Arv sker ALLTID från
                  primär förälder — alternativa påverkar endast visningsnamn. */}
              {relatedParents.length > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex items-center gap-1 text-muted-foreground cursor-help flex-wrap"
                      data-testid="header-alternate-parents"
                    >
                      <span className="text-xs">Alternativ:</span>
                      {relatedParents
                        .filter((p) => p.id !== primaryParent?.id)
                        .map((p, i, arr) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => navigate(`/objects/${p.id}`)}
                            className="text-xs hover:underline hover:text-foreground"
                            data-testid={`link-header-alternate-parent-${p.id}`}
                          >
                            {p.name}{i < arr.length - 1 ? "," : ""}
                          </button>
                        ))}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Alternativa föräldrar påverkar endast visningsnamn. Metadata- och
                    fältarv sker alltid från den primära föräldern.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <button
              type="button"
              onClick={() => scrollToSection("hierarchy")}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              data-testid="link-header-children"
            >
              <Layers className="h-4 w-4 shrink-0" />
              <span>Underordnade ({descendants.length})</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(user?.role === "admin" || user?.role === "owner" || user?.role === "planner") && (
            <Button
              size="sm"
              onClick={() => setSnabborderOpen(true)}
              data-testid="button-open-snabborder"
            >
              <Zap className="h-4 w-4 mr-1" /> Snabborder
            </Button>
          )}
          {(user?.role === "admin" || user?.role === "owner") && (
            <TelinkSyncButton objectId={obj.id} />
          )}
        </div>
      </div>

      <ObjectHeaderPanel
        objectId={obj.id}
        objectType={obj.objectType}
        objectTypeLabel={objectTypeLabel}
        serialNumber={(obj as any).serialNumber}
        latitude={obj.latitude}
        longitude={obj.longitude}
        entranceLatitude={obj.entranceLatitude}
        entranceLongitude={obj.entranceLongitude}
        name={obj.name}
        objectNumber={obj.objectNumber}
        metadata={metadata}
        canEdit={user?.role === "admin" || user?.role === "owner"}
      />

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

      {/* Task #1128: enkelsidig översikt — snabbnavigering ersätter flikraden. */}
      <nav
        className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 flex flex-wrap gap-1 border-b py-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        aria-label="Snabbnavigering"
        data-testid="object-detail-section-nav"
      >
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("overview")} data-testid="nav-overview">Åtgärder</Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("hierarchy")} data-testid="nav-hierarchy">
          Släkt & Hierarki {descendants.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{descendants.length}</Badge>}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("metadata")} data-testid="nav-metadata">
          Metadata {metadata.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{metadata.length}</Badge>}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("location")} data-testid="nav-location">Karta</Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("contacts")} data-testid="nav-contacts">
          Kontakter {contacts.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{contacts.length}</Badge>}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("images")} data-testid="nav-images">
          Bilder {images.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{images.length}</Badge>}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("info-packages")} data-testid="nav-info-packages">Informationspaket</Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("restrictions")} data-testid="nav-restrictions">
          SlotPreference {timeRestrictions.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{timeRestrictions.length}</Badge>}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => scrollToSection("deep-tools")} data-testid="nav-deep-tools">Avancerat</Button>
      </nav>

      <div className="space-y-8" data-testid="object-detail-sections">
        {/* ==================== SNABBÅTGÄRDER ==================== */}
        {/* Det fabricerade 360°-dashboardet är rivet — objektets kropp är nu
            100% metadata-driven (se metadata-sektionen). Denna strip behåller
            bara den primära åtgärden och sektionsankaret. */}
        <section id="object-section-overview" className="space-y-4 scroll-mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4" /> Snabbåtgärder
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSnabborderOpen(true)}
              data-testid="button-add-workorder"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Ny snabborder
            </Button>
          </div>
        </section>

        {/* ==================== SLÄKT & HIERARKI ==================== */}
        <section id="object-section-hierarchy" className="space-y-4 scroll-mt-4">
          <ObjectHierarchyCards
            object={obj as unknown as ServiceObject}
            objectId={objectId}
            slaktnamnChain={slaktnamnChain}
            descendants={descendants}
            objectTypeLabels={objectTypeLabels}
            onMoveObject={openMoveDialog}
            onCopy={() => { setCopyName(obj.name || obj.objectNumber || ""); setCopyMode("single"); setCopyDialogOpen(true); }}
          />
        </section>

        {/* ==================== METADATA ==================== */}
        <section id="object-section-metadata" className="space-y-4 scroll-mt-4">
          {(() => {
            const selectedTemplate = importTemplates.find((t) => t.id === selectedTemplateId);
            const renderHistory = (entry: MetadataFormEntry) =>
              entry.katalog?.kronologiskVisning ? (
                <MetadataHistorikButton
                  objectId={objectId}
                  katalogId={entry.metadataKatalogId || ""}
                  katalogNamn={entry.katalog?.namn || ""}
                />
              ) : null;
            return (
              <div className="space-y-4">
                {canUseTemplates && importTemplates.length > 0 && (
                  <Card>
                    <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">Redigera via mall</p>
                        <p className="text-xs text-muted-foreground">
                          Välj en namngiven mall för att redigera enbart dess fält. Övriga fält lämnas orörda.
                        </p>
                      </div>
                      <Select
                        value={selectedTemplateId || "__none__"}
                        onValueChange={(v) => setSelectedTemplateId(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger className="w-full sm:w-72" data-testid="select-object-template">
                          <SelectValue placeholder="Ingen mall – alla fält" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Ingen mall – alla fält</SelectItem>
                          {importTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.id} data-testid={`option-template-${t.id}`}>
                              {t.name}{Array.isArray(t.fieldIds) ? ` (${t.fieldIds.length} fält)` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                )}

                {selectedTemplate ? (
                  <ObjectTemplateMetadataForm
                    objectId={objectId}
                    templateName={selectedTemplate.name}
                    fieldIds={selectedTemplate.fieldIds ?? []}
                    entries={metadata as MetadataFormEntry[]}
                    types={metadataTypes as TemplateMetadataType[]}
                    onAdd={(data) => addMetadataMutation.mutate(data)}
                    onUpdate={(data) => updateMetadataMutation.mutate(data)}
                    isSaving={addMetadataMutation.isPending || updateMetadataMutation.isPending}
                    onSoftDelete={(katalogId) => softDeleteMetadataMutation.mutate(katalogId)}
                    onRestore={(katalogId) => restoreMetadataMutation.mutate(katalogId)}
                    softDeletePending={softDeleteMetadataMutation.isPending}
                    restorePending={restoreMetadataMutation.isPending}
                    renderHistoryButton={renderHistory}
                  />
                ) : (
                  <ObjectMetadataBody
                    objectId={objectId}
                    entries={metadata as MetadataFormEntry[]}
                    types={metadataTypes as MetadataFormType[]}
                    onAdd={(data) => addMetadataMutation.mutate(data)}
                    isAdding={addMetadataMutation.isPending}
                    onSoftDelete={(katalogId) => softDeleteMetadataMutation.mutate(katalogId)}
                    onRestore={(katalogId) => restoreMetadataMutation.mutate(katalogId)}
                    softDeletePending={softDeleteMetadataMutation.isPending}
                    restorePending={restoreMetadataMutation.isPending}
                    renderHistoryButton={renderHistory}
                    legacyEntries={legacyFieldEntries}
                    onEditLegacyField={(group) => openEditDialog(group as "overview" | "access" | "equipment")}
                    objectAssignments={objectAssignments}
                    navigate={navigate}
                  />
                )}
              </div>
            );
          })()}
        </section>

        {/* ==================== SYSTEMGENERERADE DRILLDOWN-LISTOR (Task #1154) ==================== */}
        {/* Dedikerade fullständiga listor för Inspektionsresultat, Kommunikation och
            Betyg — 360°-översiktens "Visa alla" landar här (egna ankare) i stället
            för att bara scrolla till metadata-panelen. */}
        <ObjectSystemDetailLists objectId={objectId} />

        {/* Objektfälten (access/equipment) under migrering renderas nu genom den
            enhetliga metadata-ytan ovan (kortet "Objektfält (under migrering)" i
            ObjectMetadataForm). Gamla ?tab=access/equipment-djuplänkar mappas till
            metadata-sektionen via TAB_TO_SECTION. */}

        {/* ==================== KARTA ==================== */}
        <section id="object-section-location" className="space-y-4 scroll-mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> Karta
                  <KallaBadge kalla="SYS" />
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={objectLocationTypeBadgeClass(obj)} data-testid="badge-location-type-tab">
                    {objectLocationTypeLabel(obj)}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog("overview")} data-testid="button-edit-location">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </div>
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
            </CardContent>
          </Card>

          <div className="mt-4">
            <PolylineEditor object={obj as ServiceObject} />
          </div>
        </section>

        {/* ==================== KONTAKTER ==================== */}
        <section id="object-section-contacts" className="space-y-4 scroll-mt-4">
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
        </section>

        {/* ==================== BILDER ==================== */}
        <section id="object-section-images" className="space-y-4 scroll-mt-4">
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
        </section>

        {/* ==================== INFORMATIONSPAKET-TRÄD (Task #1129 — läsvy, utförda + kommande) ==================== */}
        <section id="object-section-info-packages" className="space-y-4 scroll-mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Informationspaket
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Bläddra bland objektets uppgifter — utförda och kommande — med inmatad metadata, foton och faktureringskoppling. Gruppera på objekt, plats, orderreferens eller utförandetid.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <InfoPackageTree objectId={objectId} />
            </CardContent>
          </Card>
        </section>

        {/* ==================== SLOTPREFERENCE ==================== */}
        <section id="object-section-restrictions" className="space-y-4 scroll-mt-4">
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
        </section>

        {/* ==================== AVANCERADE VERKTYG (hopfällbart) ==================== */}
        <section id="object-section-deep-tools" className="space-y-4 scroll-mt-4">
          <Collapsible open={deepToolsOpen} onOpenChange={setDeepToolsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between"
                data-testid="button-toggle-deep-tools"
              >
                <span className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" /> Avancerade verktyg
                </span>
                <ChevronRight className={`h-4 w-4 transition-transform ${deepToolsOpen ? "rotate-90" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-8 pt-6">
              {/* ==================== EKONOMI ==================== */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Ekonomi</h2>
                {/* Task #1086: "Betalare" borttaget — kund härleds via orderkoncept och
                    visas på fliken "Kopplade uppgifter". Endast fakturamottagare kvar här. */}
                {objectId && (
                  <InvoiceRecipientsCard objectId={objectId} />
                )}
                {!isAdmin && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Endast administratörer kan ändra fakturamottagare.
                  </p>
                )}
              </div>

              {/* ==================== HISTORIK & ARKIV ==================== */}
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Historik &amp; arkiv</h2>
                <ObjectHistoryArchiveTab objectId={objectId} isArchived={!!resolvedObject?.deletedAt} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      </div>

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
                  <Label>Släktnamn</Label>
                  <div
                    className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground break-words"
                    data-testid="text-slaktnamn"
                  >
                    {slaktnamn || "—"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Hela hierarkin (rot → detta objekt). Uppdateras automatiskt vid flytt.
                  </p>
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
                  <Label>Platstyp</Label>
                  <Select
                    value={(editForm.locationType as string) || "auto"}
                    onValueChange={(v) => setEditForm({ ...editForm, locationType: v })}
                  >
                    <SelectTrigger data-testid="select-edit-locationType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatisk (härled från koordinater)</SelectItem>
                      <SelectItem value="pinpoint">{OBJECT_LOCATION_TYPE_LABELS.pinpoint}</SelectItem>
                      <SelectItem value="area">{OBJECT_LOCATION_TYPE_LABELS.area}</SelectItem>
                      <SelectItem value="none">{OBJECT_LOCATION_TYPE_LABELS.none}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Exakt position = ruttbar punkt. Område = visas på karta men ruttas ej.
                    Ingen geografi = objekt utan plats (t.ex. tjänst/abonnemang).
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Latitud</Label>
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={editForm.latitude == null ? "" : String(editForm.latitude)}
                      onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                      placeholder="t.ex. 59.3293"
                      data-testid="input-edit-latitude"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Longitud</Label>
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={editForm.longitude == null ? "" : String(editForm.longitude)}
                      onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                      placeholder="t.ex. 18.0686"
                      data-testid="input-edit-longitude"
                    />
                  </div>
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
                  payload.status = editForm.status;
                  payload.notes = editForm.notes;
                  // Task #990: platstyp + position. "auto" ⇒ null (server härleder).
                  payload.locationType = editForm.locationType === "auto" || !editForm.locationType
                    ? null
                    : editForm.locationType;
                  const rawLat = typeof editForm.latitude === "string" ? editForm.latitude.trim() : editForm.latitude;
                  const rawLng = typeof editForm.longitude === "string" ? editForm.longitude.trim() : editForm.longitude;
                  const lat = rawLat === "" || rawLat == null ? null : Number(rawLat);
                  const lng = rawLng === "" || rawLng == null ? null : Number(rawLng);
                  if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
                    toast({ title: "Ogiltiga koordinater", description: "Latitud och longitud måste vara giltiga tal.", variant: "destructive" });
                    return;
                  }
                  if ((lat === null) !== (lng === null)) {
                    toast({ title: "Ofullständig position", description: "Ange både latitud och longitud, eller lämna båda tomma.", variant: "destructive" });
                    return;
                  }
                  payload.latitude = lat;
                  payload.longitude = lng;
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

      {/* ==================== FLYTTA OBJEKT (Task #713) ==================== */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flytta objekt</DialogTitle>
            <DialogDescription>
              Välj ny förälder för {moveTargetObj?.name || moveTargetObj?.objectNumber || obj.name || obj.objectNumber}. Eventuella barnobjekt följer med och släktnamnet uppdateras automatiskt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Sök objekt..."
              value={moveSearch}
              onChange={(e) => setMoveSearch(e.target.value)}
              data-testid="input-move-search"
            />
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => moveObjectMutation.mutate(null)}
                  disabled={moveObjectMutation.isPending}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm disabled:opacity-50"
                  data-testid="button-move-to-root"
                >
                  (ingen — flytta till rotnivå)
                </button>
                {(() => {
                  const excludedIds = getSubtreeIds(moveTargetId || objectId);
                  const q = moveSearch.trim().toLowerCase();
                  const candidates = allObjects
                    .filter((o) => !excludedIds.has(o.id))
                    .filter((o) => {
                      if (!q) return true;
                      return (o.name || "").toLowerCase().includes(q) || (o.objectNumber || "").toLowerCase().includes(q);
                    })
                    .slice(0, 50);
                  if (candidates.length === 0) {
                    return <p className="text-sm text-muted-foreground px-3 py-2">Inga matchande objekt.</p>;
                  }
                  return candidates.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => moveObjectMutation.mutate(o.id)}
                      disabled={moveObjectMutation.isPending}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm flex items-center gap-2 disabled:opacity-50"
                      data-testid={`button-move-target-${o.id}`}
                    >
                      <span className="font-medium">{o.name || o.objectNumber}</span>
                      {o.objectNumber && <span className="text-xs text-muted-foreground">{o.objectNumber}</span>}
                    </button>
                  ));
                })()}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)} data-testid="button-cancel-move">Avbryt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== KOPIERA OBJEKT/GREN (Task #713) ==================== */}
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kopiera objekt</DialogTitle>
            <DialogDescription>
              Skapa en kopia av {obj.name || obj.objectNumber}. Ett nytt objektnummer genereras och metadata kopieras med.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="copy-name">Namn på kopian</Label>
              <Input
                id="copy-name"
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                data-testid="input-copy-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Omfattning</Label>
              <RadioGroup value={copyMode} onValueChange={(v) => setCopyMode(v as "single" | "branch")}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="single" id="copy-single" data-testid="radio-copy-single" />
                  <Label htmlFor="copy-single" className="font-normal cursor-pointer">Endast detta objekt</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="branch" id="copy-branch" data-testid="radio-copy-branch" />
                  <Label htmlFor="copy-branch" className="font-normal cursor-pointer">
                    Hela grenen ({descendants.length} barnobjekt)
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)} data-testid="button-cancel-copy">Avbryt</Button>
            <Button
              onClick={() => copyObjectMutation.mutate({ name: copyName, mode: copyMode })}
              disabled={copyObjectMutation.isPending}
              data-testid="button-confirm-copy"
            >
              {copyObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              Kopiera
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

      {/* Snabborder: rik direktorder (kund + fakturareferenser + löpande SO-nr +
          rader) — blir fakturaunderlag direkt. Ersätter tidigare minimala
          arbetsorder-dialog. */}
      <SnabborderDialog
        open={snabborderOpen}
        onOpenChange={setSnabborderOpen}
        objectId={objectId}
        objectName={obj.name}
        objectNumber={obj.objectNumber}
        defaultCustomerId={obj.customerId}
      />
    </div>
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
