import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ObjectArchiveControl } from "@/components/objects/ObjectArchiveControl";
import { ObjectHeaderPanel } from "@/components/ObjectHeaderPanel";
import { type MetadataFormEntry, type MetadataFormType, type MetadataRelatedChild } from "@/components/ObjectMetadataForm";
import { ObjectTemplateMetadataForm, type TemplateMetadataType } from "@/components/ObjectTemplateMetadataForm";
import { ObjectSystemGeneratedPanel } from "@/components/ObjectSystemGeneratedPanel";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, versionedUrl } from "@/lib/queryClient";
import {
  ArrowLeft, Building2, MapPin, Key, Keyboard, Users, DoorOpen,
  Clock, Package, FileText, Image as ImageIcon, Contact, GitFork, AlertTriangle,
  Calendar, Loader2, ChevronRight, Wrench,
  Box, Layers, Plus,
  Trash2, Pencil, Save, X, Phone, Mail, LinkIcon, Search, History as HistoryIcon,
  ArrowUp, ArrowDown, RotateCcw, Cog, Copy, Gauge, Zap, Network
} from "lucide-react";
import { ObjectMetadataBody } from "@/components/objects/ObjectMetadataBody";
import { ObjectDomainGrid } from "@/components/objects/ObjectDomainGrid";
import { ObjectLinkedTasksGrid } from "@/components/objects/ObjectLinkedTasksGrid";
import { ObjectLinkedOrdersTable } from "@/components/objects/ObjectLinkedOrdersTable";
import { ObjectSystemInfoSection } from "@/components/objects/ObjectSystemInfoSection";
import { DomainCarouselCard } from "@/components/objects/DomainCarouselCard";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import "leaflet/dist/leaflet.css";
import type { ServiceObject, WorkOrder, ImportTemplate } from "@shared/schema";
import { objectStatusBadge as statusColors, workOrderStatusBadge as workOrderStatusColors } from "@/lib/status-colors";
import type { LucideIcon } from "lucide-react";

// Objektets enda två livscykel-lägen är Aktiv/Arkiverad (arkivering hanteras
// via deletedAt + ObjectArchiveControl). Denna karta behålls enbart för att
// visa historiska statusändringar från audit-loggen (gammalt active/inactive/
// pending-fält), inte för att sätta ny status.
const OBJECT_STATUS_LABELS: Record<string, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
  pending: "Väntande",
};

// Task #1172: etiketter för objektets livscykel-händelser i den utfällbara
// historik-vyn (audit-actions).
const OBJECT_LIFECYCLE_ACTION_LABELS: Record<string, string> = {
  "object.status_change": "Statusändring",
  "object.archive": "Arkiverad",
  "object.restore": "Återställd",
};

// Task #1169: Modus-orderstatus-etiketter för den inline-öppnade arbetsorder-
// panelen (samma schema som tidslinjen använder).
const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  skapad: "Skapad",
  planerad_pre: "Förplanerad",
  planerad_resurs: "Resursplanerad",
  ln: "Planerad",
  planerad_las: "Låst",
  utford: "Utförd",
  fakturerad: "Fakturerad",
  omojlig: "Omöjlig",
  avbruten: "Avbruten",
};

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
  visningsnamn?: string | null;
  kategori?: string;
  datatyp?: string;
  allowedValues?: string[] | null;
  area?: string | null;
  displayNumber?: number | null;
  sortOrder?: number | null;
  parentMetadataId?: string | null;
  arBeraknad?: boolean | null;
  allowDuplicates?: boolean | null;
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
  // Task #1370: ursprung (Task #1369) för "Kopplade order och uppgifter".
  sourceType?: string | null;
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

interface ObjectEditForm {
  name?: string;
  objectNumber?: string;
  hierarchyLevel?: string;
  status?: string;
  locationType?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}


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

// Task #1128: enkelsidig "Objektöversikt" — sektion-id:n motsvarar de gamla
// flik-värdena. Ekonomi/arkiv ligger i den hopfällbara "Avancerat"-sektionen,
// så gamla ?tab=-djuplänkar dit mappas till deep-tools.
const TAB_TO_SECTION: Record<string, string> = {
  // Objektvyn är omstrukturerad till tre ankarsektioner: huvud, metadata och
  // kopplade uppgifter (linked-tasks). Gamla ?tab=-djuplänkar mappas hit för
  // bakåtkompatibilitet.
  metadata: "metadata",
  "info-packages": "metadata",
  restrictions: "metadata",
  access: "metadata",
  equipment: "metadata",
  "delivery-preferences": "metadata",
  contacts: "metadata",
  location: "metadata",
  production: "metadata",
  "deep-tools": "metadata",
  hierarchy: "huvud",
  huvud: "huvud",
  ekonomi: "huvud",
  "history-archive": "huvud",
  images: "linked-tasks",
  inspections: "linked-tasks",
  communications: "linked-tasks",
  ratings: "linked-tasks",
  "issue-reports": "linked-tasks",
  "linked-concepts": "linked-tasks",
  timeline: "linked-tasks",
};

export default function ObjectDetailPage() {
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

  // Task #1399: kund visas inte längre på objektnivå (kund hör hemma på
  // uppgiftsnivå); payer-relationen används enbart för hierarki-sökningen nedan.

  // Task #1128: scrollar till en sektion via dess id. Gamla flik-värden och
  // ObjectMetadataForm-navigeringen (onNavigateToTab) mappas hit.
  const scrollToSection = useCallback((key: string) => {
    const target = TAB_TO_SECTION[key] ?? key;
    requestAnimationFrame(() => {
      const el = document.getElementById(`object-section-${target}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

  // Task #1165: senaste driftstatus-ändring (aktör + tidpunkt) för spårbarhet
  // nära status-väljaren i huvudet.
  const { data: statusHistory } = useQuery<{
    latest: { changedAt: string; actorName: string | null; changes: { from?: string | null; to?: string | null } | null } | null;
    entries?: Array<{
      id: string;
      action: string;
      changedAt: string;
      actorName: string | null;
      changes: { from?: string | null; to?: string | null; reason?: string | null } | null;
    }>;
  }>({
    queryKey: ["/api/objects", objectId, "status-history"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/objects/${objectId}/status-history`), { credentials: "include" });
      if (!res.ok) return { latest: null, entries: [] };
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
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "status-history"] });
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

  // Task #1218: GDPR-anonymisering av ett metadata-fält (oåterkalleligt).
  const anonymizeMetadataMutation = useMutation({
    mutationFn: async (katalogId: string) => {
      await apiRequest("POST", `/api/metadata/objects/${objectId}/field/${katalogId}/anonymize`, { confirm: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({ title: "Fältet anonymiserat", description: "Värdet är oåterkalleligt raderat i alla kopior." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte anonymisera metadata", description: error.message, variant: "destructive" });
    },
  });

  const openEditDialog = () => {
    if (!resolvedObject) return;
    setEditForm({
      name: resolvedObject.name || "",
      objectNumber: resolvedObject.objectNumber || "",
      hierarchyLevel: resolvedObject.hierarchyLevel || "",
      status: resolvedObject.status || "active",
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
              "Fyll i uppgifterna för det nya objektet. Adress och övriga egenskaper läggs till som metadata."
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
              <p className="text-xs text-muted-foreground mb-3">Adress och övriga egenskaper läggs till som metadatafält. Ärvda värden från överordnat objekt är förifyllda.</p>
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
              // Task #1399: objectType skickas inte längre — kolumnen får
              // serverns DB-default (fältet är pensionerat i UI).
              data: {
                name: createName,
                parentId: createParentId || undefined,
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
  const relatedChildren: MetadataRelatedChild[] = descendants
    .filter((d) => d.parentId === objectId)
    .map((d) => ({
      id: d.id,
      name: d.name || d.objectNumber || d.id.slice(0, 8),
      objectType: d.objectType ?? null,
      hierarchyLevel: d.hierarchyLevel ?? null,
    }));


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
              variant="ghost"
              size="sm"
              className="h-auto p-0 text-muted-foreground underline-offset-4 hover:underline"
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
            {/* Task #1418: kompakt barn-indikation i sidhuvudet — nedåt-relationen
                framgår inte av släktnamnet; klick scrollar till hierarkisektionen. */}
            {(() => {
              const directChildren = descendants.filter((d) => d.parentId === objectId).length;
              return directChildren > 0 ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => scrollToSection("hierarchy")}
                  title="Visa underordnade objekt i hierarkin"
                  data-testid="button-header-child-count"
                >
                  <Network className="h-3 w-3" />
                  {directChildren} underordnade
                </button>
              ) : null;
            })()}
            {/* Task #1158: arkivering (soft-delete via deletedAt) är read-only i
                huvudet — objektets driftstatus (active/inactive/pending) redigeras
                separat via väljaren nedan (befintlig PATCH /api/objects/:id). */}
            {(obj as any).deletedAt ? (() => {
              // Task #1173: visa vem som arkiverade + när (och ev. orsak) via
              // audit-historiken; fall tillbaka på objektets egna arkiv-kolumner.
              const archiveEntry = statusHistory?.entries?.find((e) => e.action === "object.archive");
              const archivedByName = archiveEntry?.actorName ?? (obj as any).archivedBy ?? null;
              const archivedAt = archiveEntry?.changedAt ?? (obj as any).deletedAt;
              const archivedReason = archiveEntry?.changes?.reason ?? (obj as any).archivedReason ?? null;
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className={`${statusColors.inactive} cursor-help`} data-testid="badge-status">
                      Arkiverad
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent data-testid="tooltip-archived">
                    Arkiverad{archivedByName ? ` av ${archivedByName}` : ""}
                    {archivedAt ? ` den ${new Date(archivedAt).toLocaleDateString("sv-SE")}` : ""}
                    {archivedReason ? ` — ${archivedReason}` : ""}
                  </TooltipContent>
                </Tooltip>
              );
            })() : (
              <Badge className={statusColors.active} data-testid="badge-status">
                Aktiv
              </Badge>
            )}
            {statusHistory?.latest && !(obj as any).deletedAt && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="text-xs text-muted-foreground cursor-help"
                    data-testid="text-status-last-changed"
                  >
                    Senast ändrad av {statusHistory.latest.actorName || "okänd"}{" "}
                    {new Date(statusHistory.latest.changedAt).toLocaleDateString("sv-SE")}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Status ändrad{statusHistory.latest.changes?.from ? ` från "${OBJECT_STATUS_LABELS[statusHistory.latest.changes.from] ?? statusHistory.latest.changes.from}"` : ""}
                  {statusHistory.latest.changes?.to ? ` till "${OBJECT_STATUS_LABELS[statusHistory.latest.changes.to] ?? statusHistory.latest.changes.to}"` : ""}
                  {" "}av {statusHistory.latest.actorName || "okänd"} den{" "}
                  {new Date(statusHistory.latest.changedAt).toLocaleString("sv-SE")}
                </TooltipContent>
              </Tooltip>
            )}
            {/* Task #1172: full livscykel-historik (status/arkiv/återställ) i en
                utfällbar lista — visas oavsett arkiverad eller ej. */}
            {statusHistory?.entries && statusHistory.entries.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                    data-testid="button-status-history"
                  >
                    <HistoryIcon className="h-3 w-3" />
                    Historik ({statusHistory.entries.length})
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 p-0" data-testid="popover-status-history">
                  <div className="border-b px-3 py-2 text-sm font-medium">Livscykelhistorik</div>
                  <div className="max-h-72 overflow-y-auto py-1">
                    {statusHistory.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="px-3 py-2 text-xs hover:bg-muted/50"
                        data-testid={`row-status-history-${entry.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {OBJECT_LIFECYCLE_ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(entry.changedAt).toLocaleDateString("sv-SE")}
                          </span>
                        </div>
                        {entry.action === "object.status_change" && (entry.changes?.from || entry.changes?.to) && (
                          <div className="mt-0.5 text-muted-foreground">
                            {entry.changes?.from ? `${OBJECT_STATUS_LABELS[entry.changes.from] ?? entry.changes.from} → ` : ""}
                            {entry.changes?.to ? OBJECT_STATUS_LABELS[entry.changes.to] ?? entry.changes.to : ""}
                          </div>
                        )}
                        {entry.changes?.reason && (
                          <div className="mt-0.5 text-muted-foreground break-words">{entry.changes.reason}</div>
                        )}
                        <div className="mt-0.5 text-muted-foreground">
                          {entry.actorName || "okänd"} · {new Date(entry.changedAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {/* Arkivera/återställ flyttat hit från separat kort längre ner. */}
            <ObjectArchiveControl
              objectId={objectId}
              isArchived={!!(obj as any).deletedAt}
              canRestore={user?.role === "admin" || user?.role === "owner"}
            />
          </div>
          {/* Task #1399: förälder-/underordnade-sammanfattningen är borttagen ur
              headern — informationen framgår redan av brödsmulan ovan och av
              korten "Föräldrar / Överordnade" och "Barn / Underordnade" nedan. */}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Snabbmeny (ersätter tidigare sticky-navigering): hoppa till sektion. */}
          <div className="flex items-center gap-1" data-testid="object-detail-quicknav">
            <Button variant="ghost" size="sm" onClick={() => scrollToSection("metadata")} data-testid="nav-metadata">
              Metadata
            </Button>
            <Button variant="ghost" size="sm" onClick={() => scrollToSection("linked-tasks")} data-testid="nav-linked-tasks">
              Uppgifter
            </Button>
          </div>
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
        latitude={obj.latitude}
        longitude={obj.longitude}
        entranceLatitude={obj.entranceLatitude}
        entranceLongitude={obj.entranceLongitude}
        name={obj.name}
        objectNumber={obj.objectNumber}
        metadata={metadata}
        canEdit={user?.role === "admin" || user?.role === "owner"}
      />

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
              placeholder="Sök i hierarkin (namn, adress, objektnummer)..."
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

      {/* ==================== (1) HUVUD: identitet, släktträd, arkivering ==================== */}
      <section id="object-section-huvud" className="space-y-4 scroll-mt-4 mb-6">
        <ObjectHierarchyCards
          object={obj as unknown as ServiceObject}
          objectId={objectId}
          slaktnamnChain={slaktnamnChain}
          descendants={descendants}
          onMoveObject={openMoveDialog}
          onCopy={() => { setCopyName(obj.name || obj.objectNumber || ""); setCopyMode("single"); setCopyDialogOpen(true); }}
        />
      </section>

      <div className="space-y-8" data-testid="object-detail-sections">
        {/* ==================== (2) METADATA: editor + samlingskaruseller ==================== */}
        <section id="object-section-metadata" className="space-y-4 scroll-mt-4">
          {(() => {
            const selectedTemplate = importTemplates.find((t) => t.id === selectedTemplateId);
            // Historik slås ihop per fält (PO): visa historik-knappen på ALLA
            // katalog-backade fält (ej bara kronologiskVisning), nyast först.
            const renderHistory = (entry: MetadataFormEntry) =>
              entry.metadataKatalogId ? (
                <MetadataHistorikButton
                  objectId={objectId}
                  katalogId={entry.metadataKatalogId}
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
                    canAnonymize={isAdmin}
                    onAnonymize={(katalogId) => anonymizeMetadataMutation.mutate(katalogId)}
                    anonymizePending={anonymizeMetadataMutation.isPending}
                    renderHistoryButton={renderHistory}
                    objectAssignments={objectAssignments}
                    navigate={navigate}
                    canEditFields={isAdmin}
                  />
                )}
              </div>
            );
          })()}

          {/* Samlingskaruseller: Kontakt / Produktion / Geografi */}
          <ObjectDomainGrid
            section="collections"
            objectId={objectId}
            obj={obj}
            contacts={contacts as any}
            onEditGeo={() => openEditDialog()}
            navigate={navigate}
          />
        </section>

        {/* ==================== (3) KOPPLADE UPPGIFTER ==================== */}
        <section id="object-section-linked-tasks" className="space-y-6 scroll-mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4" /> Kopplade uppgifter
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

          {/* Task #1370 (krav 11): sammanställning av kopplade order + uppgifter
              med källa, orderkoncept, status (deriveUppgiftStatus) och datum. */}
          <ObjectLinkedOrdersTable
            workOrders={workOrders as any}
            assignments={objectAssignments as any}
          />

          {/* Mikro-grovplanering: subträd + källa, exakt grovplaneringslayout (readOnly) */}
          <ObjectLinkedTasksGrid objectId={objectId} />

          {/* List-block (bläddra + sök): orderkoncept, snabbordrar, uppgifter, bilder */}
          <ObjectDomainGrid
            section="linked"
            objectId={objectId}
            obj={obj}
            contacts={contacts as any}
            workOrders={workOrders as any}
            onEditGeo={() => openEditDialog()}
            navigate={navigate}
          />
        </section>

        {/* ==================== (4) SYSTEMINFORMATION ====================
            Task #1370 (krav 12): separat read-only sektion längst ned,
            åtskild från redigerbar metadata. */}
        <section id="object-section-system-info" className="scroll-mt-4">
          <ObjectSystemInfoSection objectId={objectId} />
        </section>

      </div>

      {/* ==================== REDIGERA OBJEKT-DIALOG ==================== */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Redigera grundinformation
            </DialogTitle>
            <DialogDescription>Uppdatera objektets information nedan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
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
                  {/* Task #1418: släktnamnet klickbart per led även här. */}
                  <div
                    className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground break-words flex flex-wrap items-center gap-1"
                    data-testid="text-slaktnamn"
                  >
                    {slaktnamnChain.length === 0 && "—"}
                    {slaktnamnChain.map((c, i) => (
                      <span key={c.id} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                        {c.id === objectId ? (
                          <span className="font-medium text-foreground">{c.name}</span>
                        ) : (
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => { setEditDialogOpen(false); navigate(`/objects/${c.id}`); }}
                            data-testid={`link-edit-slaktnamn-${c.id}`}
                          >
                            {c.name}
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Hela hierarkin (rot → detta objekt). Uppdateras automatiskt vid flytt.
                  </p>
                </div>
                {/* Task #1399: "Objekttyp" är pensionerat i UI (äldre metadatafält);
                    DB-kolumnen behålls (expand-contract). */}
              </>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
              Avbryt
            </Button>
            <Button
              onClick={() => {
                const payload: ObjectEditForm = {
                  name: editForm.name,
                  objectNumber: editForm.objectNumber,
                };
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
            <HistoryIcon className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Visa historik</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="h-4 w-4" /> Historik – {katalogNamn}
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
