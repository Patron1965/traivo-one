// OBS (ADR v3 / Task #565): Objekt är neutrala — `obj.customerId` som returneras
// av `/api/objects*` är *primär-payer-customer_id* projicerad serverside via
// `objectColumnsWithPrimaryCustomer()` i `server/storage.ts` (källa: `object_payers.is_primary=true`).
// Sortering, gruppering, kund-namnslookup (`useCustomerLookup`), filter och kopia
// av kund-koppling i denna vy använder därför payer-relationen — INTE legacy
// `objects.customer_id`. Kolumnen kan droppas (Task #560) utan att klienten ändras.
// Vid copy-objekt: `objectToCopy.customerId` är payer-customer_id; POST till
// `/api/objects` med detta fält backfillas till `object_payers` av servern.
import { useState, useMemo, useCallback, useEffect, memo } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTerminology } from "@/hooks/use-terminology";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { 
  Search, Plus, Filter, Loader2, ChevronRight, ChevronLeft, Building2, MapPin, Trash2, 
  Map as MapIcon, List, Copy, Upload, Clock, Users, DoorOpen,
  Check, X, FileSpreadsheet, Download, BarChart3, MoreHorizontal, AlertTriangle, AlertCircle, ChevronDown, ChevronUp, XCircle,
  Image as ImageIcon, GitFork, Globe, ShieldAlert, ShieldCheck, ShieldX, Package, Info, Camera,
  ArrowUp, ArrowDown, ArrowUpDown, Network, Pencil, FolderPlus, Archive, Columns3,
  Phone, Mail
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { AICard } from "@/components/AICard";
import { ObjectMetadataPanel } from "@/components/ObjectMetadataPanel";
import { ObjectParentsPanel } from "@/components/ObjectParentsPanel";
import { ObjectDisplayNames } from "@/components/ObjectDisplayNames";
import { ObjectInheritedMetadataPanel } from "@/components/ObjectInheritedMetadataPanel";
import { ObjectSystemGeneratedPanel } from "@/components/ObjectSystemGeneratedPanel";
import { useLocalizedObjectName } from "@/lib/object-name";
import { OBJECT_LOCATION_TYPE_LABELS, effectiveObjectPosition } from "@/lib/object-location";
import { AddressSearch } from "@/components/AddressSearch";
import { GeocodedObjectsMap, ObjectsMapTab } from "@/components/ObjectsMapView";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ConditionFilterList,
  CONDITION_OPERATORS,
  type ConditionFilter,
  type ConditionField,
} from "@/components/orderkoncept/shared/ConditionFilter";
import { ObjectHierarchyTree, computeBranchSeedRoots, type TreeNode } from "@/components/objectTree/ObjectHierarchyTree";
import { CustomerMultiCombobox, useCustomerLookup } from "@/components/CustomerCombobox";
import type { ServiceObject } from "@shared/schema";

const PAGE_SIZE = 100;

const OBJECT_CONDITION_OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: "equals", label: "är lika med" },
  { value: "not_equals", label: "skiljer sig från" },
];
const METADATA_COLUMNS_STORAGE_KEY = "traivo:objects:metadataColumns";
const METADATA_COLUMNS_COLLAPSED_STORAGE_KEY = "traivo:objects:metadataColumnsCollapsed";

// Delmängd av metadataKatalog som klienten behöver för kolumnväljaren.
type MetadataCatalogType = {
  id: string;
  namn: string;
  beteckning: string | null;
  datatyp: string;
  area: string | null;
  kategori: string | null;
  sortOrder: number | null;
};

// Task #859: neutralisera CSV-formelinjektion (prefix `'` på celler som börjar
// med = + - @ \t \r) och escape:a citattecken. Se .agents/memory/csv-export-hardening.md.
function sanitizeCSVCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  const escaped = s.replace(/"/g, '""');
  const guarded = /^[=+\-@\t\r]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${guarded}"`;
}

type SearchInputProps = {
  placeholder: string;
  initialValue: string;
  onDebouncedChange: (value: string) => void;
};

const SearchInput = memo(function SearchInput({ placeholder, initialValue, onDebouncedChange }: SearchInputProps) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    // Task #1396: sökningen startar först vid minst 2 tecken — en enda bokstav
    // triggade tidigare en sökning direkt och gjorde skrivandet trögt.
    const effective = value.trim().length >= 2 ? value : "";
    const timer = setTimeout(() => onDebouncedChange(effective), 300);
    return () => clearTimeout(timer);
  }, [value, onDebouncedChange]);
  return (
    <div className="relative flex-1 min-w-[200px] max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="pl-9"
        data-testid="input-search-objects"
      />
    </div>
  );
});

export default function ObjectsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { t } = useTerminology();
  const localizedObjectName = useLocalizedObjectName();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [conditionFilters, setConditionFiltersRaw] = useState<ConditionFilter[]>([]);
  const [issueFilter, setIssueFilter] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("issue");
  });
  // Task #1357: filtrera på importbatch (länk från Import 2.0-resultatsteget).
  const [importBatchFilter, setImportBatchFilterRaw] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("importBatch");
  });
  const clearImportBatchFilter = () => {
    setImportBatchFilterRaw(null);
    setCurrentPage(0);
    const params = new URLSearchParams(window.location.search);
    params.delete("importBatch");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  };
  const [customerFilter, setCustomerFilterRaw] = useState<string[]>(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("customerId") || params.get("customer");
    return c ? [c] : [];
  });
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  // Task #1401: vyläget (lista/träd/karta) speglas i URL:en (?view=) så att
  // man kan djuplänka, ladda om och backa utan att fastna i kartvyn.
  const [viewMode, setViewModeRaw] = useState<"list" | "map" | "tree">(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    return v === "map" || v === "tree" ? v : "list";
  });
  const setViewMode = useCallback((v: "list" | "map" | "tree") => {
    setViewModeRaw(v);
    const params = new URLSearchParams(window.location.search);
    if (v === "list") params.delete("view"); else params.set("view", v);
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [objectToCopy, setObjectToCopy] = useState<ServiceObject | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copyMode, setCopyMode] = useState<"single" | "branch">("single");
  const [currentPage, setCurrentPage] = useState(0);
  const setConditionFilters = (v: ConditionFilter[]) => { setConditionFiltersRaw(v); setCurrentPage(0); };
  const activeConditions = useMemo(() => conditionFilters.filter(f => f.metadataKey), [conditionFilters]);
  const setCustomerFilter = (v: string[]) => { setCustomerFilterRaw(v); setCurrentPage(0); };
  const addCustomerFilter = (id: string) => { if (!customerFilter.includes(id)) { setCustomerFilter([...customerFilter, id]); } };
  const removeCustomerFilter = (id: string) => { setCustomerFilter(customerFilter.filter(c => c !== id)); };
  // Task #990: platstyp-filter (all/pinpoint/area/none) — server-side.
  const [locationTypeFilter, setLocationTypeFilterRaw] = useState<string>("all");
  const setLocationTypeFilter = (v: string) => { setLocationTypeFilterRaw(v); setCurrentPage(0); };
  const [reportedFilter, setReportedFilterRaw] = useState(false);
  const setReportedFilter = (v: boolean) => { setReportedFilterRaw(v); setCurrentPage(0); };
  // Task #1400: legacy-filtret "kopplade uppgifter" (uppgiftstyp/order-kund/
  // tidsperiod från gamla systemet) är borttaget — det fördjupade filtret är
  // metadatavillkor + geografiska filter.
  const [interimFilter, setInterimFilter] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const [bulkStatusDialogOpen, setBulkStatusDialogOpen] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState("active");
  const [isExporting, setIsExporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkParentDialogOpen, setBulkParentDialogOpen] = useState(false);
  const [bulkNewParentId, setBulkNewParentId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Task #1396: stabil debounced-sök-callback (annars nollställs SearchInputs
  // debounce-effekt av orelaterade renders).
  const handleDebouncedSearch = useCallback((v: string) => { setDebouncedSearch(v); setCurrentPage(0); }, []);
  // Task #1396: sök/filter-kortet är sticky; sorteringsraden i listan behöver
  // sticka strax under kortet, vars höjd varierar (chips/öppet filter) — mät den.
  const [stickyOffset, setStickyOffset] = useState(0);
  const stickyRO = useMemo(() => ({ current: null as ResizeObserver | null }), []);
  const stickyCardRef = useCallback((el: HTMLDivElement | null) => {
    stickyRO.current?.disconnect();
    stickyRO.current = null;
    if (!el) return;
    const update = () => setStickyOffset(el.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      stickyRO.current = ro;
    }
  }, [stickyRO]);
  useEffect(() => () => { stickyRO.current?.disconnect(); }, [stickyRO]);
  const [servicePatternDialog, setServicePatternDialog] = useState<{ open: boolean; loading: boolean; data?: { summary: string; patterns: { label: string; value: string }[]; anomalies: { objectId: string; objectName: string; reason: string }[] } }>({ open: false, loading: false });
  const [maintenanceDialog, setMaintenanceDialog] = useState<{ open: boolean; loading: boolean; data?: { overdue: { objectName: string; predictedDate: string; daysUntil: number; confidence: number }[]; upcoming: { objectName: string; predictedDate: string; daysUntil: number; confidence: number }[]; summary: string; totalPredicted: number } }>({ open: false, loading: false });
  const [overflowPanel, setOverflowPanel] = useState<{ objectId: string; panel: "parents" } | null>(null);
  const [expandedDisplayNames, setExpandedDisplayNames] = useState<Set<string>>(new Set());
  const toggleDisplayNames = (id: string) => {
    setExpandedDisplayNames(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [batchGeoOpen, setBatchGeoOpen] = useState(false);
  const [batchGeoCity, setBatchGeoCity] = useState("");
  const [batchGeoLimit, setBatchGeoLimit] = useState(500);
  const [batchGeoRunning, setBatchGeoRunning] = useState(false);
  const [batchGeoResult, setBatchGeoResult] = useState<{ total: number; geocoded: number; updated: number; updatedIds?: string[] } | null>(null);
  const [batchGeoMapObjects, setBatchGeoMapObjects] = useState<ServiceObject[]>([]);
  const [batchGeoShowMap, setBatchGeoShowMap] = useState(false);
  const [batchGeoTab, setBatchGeoTab] = useState<string>("geocode");
  const [batchFillCityOpen, setBatchFillCityOpen] = useState(false);
  const [batchFillCityRunning, setBatchFillCityRunning] = useState(false);
  const [batchFillCityResult, setBatchFillCityResult] = useState<{ total: number; updated: number; failed: number; remaining: number } | null>(null);
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
    }>;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceObject | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") === "true") {
      navigate("/objects/new");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: objectsData, isLoading, isError: objectsIsError, error: objectsError, refetch: objectsRefetch } = useQuery<{ objects: ServiceObject[]; total: number }>({
    queryKey: ["/api/objects", "paginated", currentPage, debouncedSearch, customerFilter, JSON.stringify(activeConditions), reportedFilter, interimFilter, issueFilter, locationTypeFilter, importBatchFilter],
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
      if (activeConditions.length > 0) {
        params.append("conditions", JSON.stringify(activeConditions));
      }
      if (reportedFilter) {
        params.append("reported", "true");
      }
      if (locationTypeFilter !== "all") {
        params.append("locationType", locationTypeFilter);
      }
      if (interimFilter) {
        params.append("interim", "true");
      }
      if (issueFilter) {
        params.append("issue", issueFilter);
      }
      if (importBatchFilter) {
        params.append("importBatchId", importBatchFilter);
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

  const { data: reportedCountData } = useQuery<{ total: number }>({
    queryKey: ["/api/objects", "reported-count"],
    queryFn: async () => {
      const res = await fetch("/api/objects?limit=0&offset=0&reported=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30000,
  });
  const reportedCount = reportedCountData?.total || 0;

  const { data: missingCityData, refetch: refetchMissingCity } = useQuery<{
    totalMissingCity: number;
    canResolveFromPostalCode: number;
    canResolveFromCoordinates: number;
    canResolveFromAddress: number;
    canResolve: number;
  }>({
    queryKey: ["/api/objects/missing-city-count"],
    queryFn: async () => {
      const res = await fetch("/api/objects/missing-city-count", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30000,
  });

  const { data: reportCountsData } = useQuery<Record<string, number>>({
    queryKey: ["/api/customer-change-requests/counts-by-object"],
    queryFn: async () => {
      const res = await fetch("/api/customer-change-requests/counts-by-object", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 30000,
  });
  const reportCounts = reportCountsData || {};

  const objects = objectsData?.objects || [];
  const totalObjects = objectsData?.total || 0;
  const totalPages = Math.ceil(totalObjects / PAGE_SIZE);

  const visibleCustomerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of objects) {
      if (o.customerId) ids.add(o.customerId);
    }
    for (const id of customerFilter) ids.add(id);
    return Array.from(ids);
  }, [objects, customerFilter]);

  const customerNameMap = useCustomerLookup(visibleCustomerIds);


  const { data: batchGeoPreview, refetch: refetchPreview } = useQuery<{
    totalNeedsGeo: number;
    filteredCount: number;
    estimatedCost: number;
    byCity: Array<{ city: string; count: number }>;
    googleAvailable: boolean;
  }>({
    queryKey: ["/api/objects/batch-geocode/preview", batchGeoCity, batchGeoLimit],
    queryFn: async () => {
      const body: any = {};
      if (batchGeoCity) body.city = batchGeoCity;
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

  const { data: batchFillCityPreview } = useQuery<{
    totalMissingCity: number;
    withPostalCode: number;
    withCoordinates: number;
    withAddress: number;
    noResolvableInfo: number;
    byPostalPrefix: Array<{ prefix: string; count: number }>;
  }>({
    queryKey: ["/api/objects/batch-fill-city/preview"],
    queryFn: async () => {
      const res = await fetch("/api/objects/batch-fill-city/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Preview failed");
      return res.json();
    },
    enabled: batchFillCityOpen,
    staleTime: 30000,
  });

  const handleBatchFillCity = useCallback(async () => {
    setBatchFillCityRunning(true);
    setBatchFillCityResult(null);
    try {
      const res = await fetch("/api/objects/batch-fill-city", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Batch fill failed");
      const result = await res.json();
      setBatchFillCityResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/objects/missing-city-count"] });
      refetchMissingCity();
      toast({ title: `${result.updated} objekt uppdaterade med stad` });
    } catch (error) {
      toast({ title: "Batch-ifyllnad misslyckades", description: error instanceof Error ? error.message : "Ett oväntat fel uppstod", variant: "destructive" });
    } finally {
      setBatchFillCityRunning(false);
    }
  }, [toast, refetchMissingCity]);

  const updateObjectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ServiceObject> }) => {
      return apiRequest("PATCH", `/api/objects/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt uppdaterat" });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte uppdatera objektet", description: error.message, variant: "destructive" });
    },
  });

  const verifyObjectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PUT", `/api/objects/${id}/verify`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt verifierat", description: "Det rapporterade objektet har verifierats och är nu ett vanligt objekt." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte verifiera objektet", description: error.message, variant: "destructive" });
    },
  });

  const rejectObjectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PUT", `/api/objects/${id}/reject`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt avvisat", description: "Det rapporterade objektet har avvisats." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte avvisa objektet", description: error.message, variant: "destructive" });
    },
  });

  // Task #550: rensa reconciliation-flagga ("saknas i fastighetslista") manuellt
  // efter att planner har granskat objektet.
  const clearReconciliationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/import/customer-fastighetslista/clear-flag`, { objectId: id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Flagga rensad", description: "Objektet är inte längre markerat som saknat i fastighetslistan." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte rensa flaggan", description: error.message, variant: "destructive" });
    },
  });

  // Task #681: klona objekt via dedikerad server-endpoint (nytt nr + kopierad metadata).
  const copyObjectMutation = useMutation({
    mutationFn: async ({ id, name, mode }: { id: string; name: string; mode: "single" | "branch" }) => {
      const res = await apiRequest("POST", `/api/objects/${id}/copy`, { name, mode });
      return res.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      const n = created?.copiedMetadata ?? 0;
      const createdCount = created?.createdCount ?? 1;
      if (created?.metadataCopyError) {
        toast({ title: "Objekt kopierat – men metadata misslyckades", description: `Objektet skapades, men metadata kunde inte kopieras: ${created.metadataCopyError}`, variant: "destructive" });
      } else if (createdCount > 1) {
        toast({ title: "Gren kopierad", description: `${createdCount} objekt skapade.${n > 0 ? ` ${n} metadatafält kopierade.` : ""}` });
      } else {
        toast({ title: "Objekt kopierat", description: n > 0 ? `${n} metadatafält kopierade.` : undefined });
      }
      setCopyDialogOpen(false);
      setObjectToCopy(null);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte kopiera objektet", description: error.message, variant: "destructive" });
    },
  });

  // Task #681: radera objekt (soft/hard hanteras serverside).
  const deleteObjectMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/objects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Objekt borttaget" });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ta bort objektet", description: error.message, variant: "destructive" });
    },
  });


  const topLevelObjects = useMemo(() => objects.filter(obj => !obj.parentId), [objects]);

  type SortField = "name" | "children" | "city";
  const [sortConfig, setSortConfig] = useState<{ field: SortField; direction: "asc" | "desc" }>({ field: "name", direction: "asc" });

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

  const sortObjects = useCallback((arr: ServiceObject[]): ServiceObject[] => {
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const copy = [...arr];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortConfig.field) {
        case "name": {
          const an = (a.name || a.objectNumber || "").toString();
          const bn = (b.name || b.objectNumber || "").toString();
          cmp = an.localeCompare(bn, "sv", { numeric: true, sensitivity: "base" });
          break;
        }
        case "children": {
          const ac = childrenMap.get(a.id)?.length ?? 0;
          const bc = childrenMap.get(b.id)?.length ?? 0;
          cmp = ac - bc;
          break;
        }
        case "city": {
          cmp = (a.city || "").localeCompare(b.city || "", "sv", { sensitivity: "base" });
          break;
        }
      }
      return cmp * dir;
    });
    return copy;
  }, [sortConfig, childrenMap]);

  const getChildren = useCallback((parentId: string) =>
    sortObjects(childrenMap.get(parentId) || []), [childrenMap, sortObjects]);

  // Task #681 (T007): vid sökning, expandera vägen till träffarna så att
  // matchande barnobjekt blir synliga under sina föräldrar i radvyn.
  useEffect(() => {
    if (!debouncedSearch) return;
    if (childrenMap.size === 0) return;
    setExpandedAreas(prev => {
      const next = new Set(prev);
      for (const parentId of childrenMap.keys()) {
        next.add(parentId);
      }
      return next;
    });
  }, [debouncedSearch, childrenMap]);

  const toggleSort = useCallback((field: SortField) => {
    setSortConfig(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: "asc" };
    });
  }, []);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field) return <ArrowUpDown className="h-4 w-4 opacity-50 stroke-[2.25]" />;
    return sortConfig.direction === "asc"
      ? <ArrowUp className="h-4 w-4 stroke-[2.75] text-primary" />
      : <ArrowDown className="h-4 w-4 stroke-[2.75] text-primary" />;
  };

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

  const filteredObjects = objects;

  // Server-side pagination returns up to PAGE_SIZE arbitrary objects per page.
  // The previous logic filtered out anything with a parentId to render a tree,
  // but on a page that mostly contains child objects (kärl/rum) this leaves the
  // list empty even though the count says e.g. 100 av 1608. To avoid this we
  // render the paginated set flat, keeping the tree-style row component but
  // showing every returned object at level 0. Children that happen to be on
  // the same page are also rendered (under their parent if expanded), so we
  // dedupe to avoid showing them twice.
  const filteredTopLevel = useMemo(() => {
    const childIdsRenderedUnderParent = new Set<string>();
    const presentIds = new Set(filteredObjects.map(o => o.id));
    for (const obj of filteredObjects) {
      if (obj.parentId && presentIds.has(obj.parentId)) {
        childIdsRenderedUnderParent.add(obj.id);
      }
    }
    return sortObjects(filteredObjects.filter(obj => !childIdsRenderedUnderParent.has(obj.id)));
  }, [filteredObjects, sortObjects]);

  // ── Task #859: valbara metadatakolumner ───────────────────────────────────
  const [metadataColumnsDialogOpen, setMetadataColumnsDialogOpen] = useState(false);
  const [metadataColumnSearch, setMetadataColumnSearch] = useState("");
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(METADATA_COLUMNS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(METADATA_COLUMNS_STORAGE_KEY, JSON.stringify(selectedMetadataColumns));
    } catch {
      /* localStorage kan saknas/vara full — kolumnvalet är best-effort */
    }
  }, [selectedMetadataColumns]);
  // Kollaps-läge: dölj/visa metadatakolumnerna i listan utan att rensa valet.
  const [metadataColumnsCollapsed, setMetadataColumnsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(METADATA_COLUMNS_COLLAPSED_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(METADATA_COLUMNS_COLLAPSED_STORAGE_KEY, metadataColumnsCollapsed ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, [metadataColumnsCollapsed]);

  const { data: metadataCatalog = [] } = useQuery<MetadataCatalogType[]>({
    queryKey: ["/api/metadata/types"],
    staleTime: 5 * 60 * 1000,
  });

  // Behåll endast valda kolumner som fortfarande finns i katalogen, i katalogens
  // ordning (area → sortOrder) så kolumnerna ligger stabilt.
  const selectedMetadataFields = useMemo(() => {
    const selected = new Set(selectedMetadataColumns);
    return metadataCatalog.filter((t) => selected.has(t.id));
  }, [metadataCatalog, selectedMetadataColumns]);

  // Objektets kontaktuppgifter (Kontaktperson_Namn/Telefon/Epost) är standard-
  // katalogfält som ärvs neråt (standardArvs=true). De visas alltid i objekt-
  // huvudet — oberoende av det fria kolumnvalet — så att "vem kontaktar man
  // för det här objektet" alltid syns utan manuell konfiguration.
  const contactMetadataFields = useMemo(() => {
    const wanted: Record<string, string> = {
      Kontaktperson_Namn: "Kontakt",
      Kontaktperson_Telefon: "Tel",
      Kontaktperson_Epost: "E-post",
    };
    return Object.entries(wanted)
      .map(([namn, label]) => {
        const field = metadataCatalog.find((t) => t.namn === namn);
        return field ? { ...field, displayLabel: label } : null;
      })
      .filter((f): f is MetadataCatalogType & { displayLabel: string } => f != null);
  }, [metadataCatalog]);

  // Task #1400: villkorsfiltrets fältkälla är den svenska metadata-katalogen.
  // Nyckeln är katalogens `namn` — serverns buildObjectMetadataMap nycklar varje
  // värde på namn/beteckning/punktnotation, så namn resolvar alltid.
  const conditionFields = useMemo<ConditionField[]>(
    () => metadataCatalog.map((t) => ({ value: t.namn, label: t.namn })),
    [metadataCatalog],
  );

  const metadataObjectIds = useMemo(() => filteredObjects.map((o) => o.id), [filteredObjects]);

  const metadataBatchKatalogIds = useMemo(() => {
    const ids = new Set(selectedMetadataColumns);
    for (const f of contactMetadataFields) ids.add(f.id);
    return Array.from(ids);
  }, [selectedMetadataColumns, contactMetadataFields]);

  const { data: metadataValuesData } = useQuery<{ values: Record<string, Record<string, string>> }>({
    queryKey: ["/api/metadata/objects/values-batch", metadataBatchKatalogIds, metadataObjectIds],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/metadata/objects/values-batch", {
        objectIds: metadataObjectIds,
        katalogIds: metadataBatchKatalogIds,
      });
      return res.json();
    },
    enabled: metadataBatchKatalogIds.length > 0 && metadataObjectIds.length > 0,
    staleTime: 30000,
  });
  const metadataValues = metadataValuesData?.values ?? {};

  // Namn-lookup för förälder/barn-relationsindikator (sidans objekt).
  const objectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of objects) m.set(o.id, (o as any).displayName || o.name);
    return m;
  }, [objects]);

  const toggleMetadataColumn = useCallback((id: string) => {
    setSelectedMetadataColumns((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const filteredCatalogForPicker = useMemo(() => {
    const q = metadataColumnSearch.trim().toLowerCase();
    const base = q
      ? metadataCatalog.filter(
          (t) =>
            t.namn.toLowerCase().includes(q) ||
            (t.beteckning || "").toLowerCase().includes(q),
        )
      : metadataCatalog;
    return base;
  }, [metadataCatalog, metadataColumnSearch]);

  const activeFilterCount = useMemo(() => [
    activeConditions.length > 0 ? 1 : 0,
    customerFilter.length > 0 ? 1 : 0,
    reportedFilter ? 1 : 0,
    interimFilter ? 1 : 0,
    issueFilter ? 1 : 0,
    locationTypeFilter !== "all" ? 1 : 0,
    importBatchFilter ? 1 : 0,
  ].reduce((a, b) => a + b, 0), [activeConditions, customerFilter, reportedFilter, interimFilter, issueFilter, locationTypeFilter, importBatchFilter]);

  const clearAllFilters = () => {
    setConditionFilters([]);
    setCustomerFilter([]);
    setReportedFilter(false);
    setInterimFilter(false);
    setIssueFilter(null);
    setLocationTypeFilter("all");
    setImportBatchFilterRaw(null);
    // Task #1401: bevara vyläget (?view=) när filtren rensas.
    const viewParam = new URLSearchParams(window.location.search).get("view");
    window.history.replaceState({}, "", window.location.pathname + (viewParam ? `?view=${viewParam}` : ""));
  };

  // Task #1401: kartan läser effektiv position (egna koordinater ELLER
  // entrékoordinater — speglar serverns platsmodell) istället för att tyst
  // tappa objekt som bara har entré-punkt. Objekt utan någon punkt samlas i
  // en synlig "saknar koordinater"-lista i kartfliken.
  const mapBaseObjects = useMemo(() => (
    selectedIds.size > 0
      ? filteredObjects.filter(o => selectedIds.has(o.id))
      : filteredObjects
  ), [filteredObjects, selectedIds]);
  const objectsWithCoords = useMemo(
    () => mapBaseObjects
      .map(o => ({ obj: o, position: effectiveObjectPosition(o) }))
      .filter((e): e is { obj: ServiceObject; position: [number, number] } => e.position !== null),
    [mapBaseObjects],
  );
  const objectsMissingCoords = useMemo(
    () => mapBaseObjects.filter(o => effectiveObjectPosition(o) === null),
    [mapBaseObjects],
  );
  const mapPositions = useMemo<[number, number][]>(() => objectsWithCoords.map(e => e.position), [objectsWithCoords]);

  const handleCopyObject = useCallback((obj: ServiceObject) => {
    setObjectToCopy(obj);
    setCopyName(obj.name);
    setCopyMode("single");
    setCopyDialogOpen(true);
  }, []);

  const executeCopy = () => {
    if (!objectToCopy) return;
    copyObjectMutation.mutate({ id: objectToCopy.id, name: copyName, mode: copyMode });
  };

  // Task #1084: "Lägg till underordnat" öppnar det enhetliga helskärms-
  // formuläret i skapa-läge med föräldern förifylld.
  const handleAddChild = useCallback((parent: ServiceObject) => {
    const parentName = (parent as any).displayName || parent.name || parent.objectNumber || "";
    navigate(`/objects/new?parentId=${parent.id}&parentName=${encodeURIComponent(parentName)}`);
  }, [navigate]);

  // Task #1084: "Redigera" leder till det enhetliga helskärmsformuläret.
  const handleEditObject = useCallback((obj: ServiceObject) => {
    navigate(`/objects/${obj.id}`);
  }, [navigate]);

  const buildObjectFilterParams = useCallback((limit: number, offset: number): URLSearchParams => {
    const params = new URLSearchParams({ limit: limit.toString(), offset: offset.toString() });
    if (debouncedSearch) params.append("search", debouncedSearch);
    if (customerFilter.length > 0) params.append("customerId", customerFilter.join(","));
    if (activeConditions.length > 0) params.append("conditions", JSON.stringify(activeConditions));
    if (reportedFilter) params.append("reported", "true");
    if (interimFilter) params.append("interim", "true");
    if (issueFilter) params.append("issue", issueFilter);
    if (locationTypeFilter !== "all") params.append("locationType", locationTypeFilter);
    if (importBatchFilter) params.append("importBatchId", importBatchFilter);
    // Task #1397: uppgiftsfiltren måste med — annars exporterar vi ett större
    // urval än listan (och antalet i exportmenyn) visar.
    return params;
  }, [debouncedSearch, customerFilter, activeConditions, reportedFilter, interimFilter, issueFilter, locationTypeFilter, importBatchFilter]);

  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map(row => row.map(sanitizeCSVCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Hämtar objekten som ska exporteras. Återanvänds av alla exportfilerna nedan.
  // Task #1397: grundprincip — finns markerade objekt exporteras ENDAST de
  // markerade; annars hela det aktiva filterurvalet. Vi hämtar via samma
  // filtrerade endpoint (behåller displayName/släktnamns-berikningen) och
  // begränsar därefter till markeringen.
  const fetchAllObjectsForExport = async (): Promise<ServiceObject[]> => {
    // Med markering: hämta OFILTRERAT och begränsa till markeringen, så att
    // exporten omfattar exakt de markerade objekten även om filtren ändrats
    // efter att markeringen gjordes.
    const params = selectedIds.size > 0
      ? new URLSearchParams({ limit: "100000", offset: "0" })
      : buildObjectFilterParams(100000, 0);
    const res = await fetch(`/api/objects?${params.toString()}`, { credentials: "include" });
    if (!res.ok) throw new Error("Kunde inte hämta objekt");
    const data: { objects: ServiceObject[] } = await res.json();
    const all = data.objects ?? [];
    if (selectedIds.size > 0) {
      return all.filter(o => selectedIds.has(o.id));
    }
    return all;
  };

  // Släktnamn = det hierarkiska visningsnamnet (t.ex. "Stockholm › BRF › Hus A").
  // /api/objects levererar det som displayName; faller tillbaka på namnet.
  const slaktnamnOf = (obj: ServiceObject): string => (obj as any).displayName ?? obj.name;

  // ── Fil 1 – Objekt (sammanslagen): fd Fil 1 (intrinsiska kolumner) + fd Fil 2
  // (förälderkoppling) i EN fil — en rad per förälderkoppling (multi-förälder),
  // rotobjekt får en rad med tom "Koppling uppåt". Den separata kopplingsfilen
  // togs bort på produktägarens begäran (dubblerad information var förvirrande).
  // Valfria kundreferens-kolumner (refFields) läggs till som metadata.<namn> så
  // att filen round-trippar via matchningsimporten och kan användas som
  // översättningsnyckel mot kundens egna listor (butiksnummer m.m.).
  const buildObjektFileRows = async (
    allObjects: ServiceObject[],
    refFields: MetadataCatalogType[] = [],
  ): Promise<(string | number)[][]> => {
    const headers = [
      "Objektnummer", "Objektnamn", "Släktnamn", "Status", "Koppling uppåt",
      ...refFields.map(f => `metadata.${f.namn}`),
    ];
    const numberById = new Map(allObjects.map(o => [o.id, o.objectNumber || ""]));

    const res = await fetch(`/api/objects/parents-export`, { credentials: "include" });
    if (!res.ok) throw new Error("Kunde inte hämta förälderkopplingar");
    const links: { objectId: string; parentId: string; isPrimary: boolean }[] = await res.json();

    const linksByChild = new Map<string, { objectId: string; parentId: string; isPrimary: boolean }[]>();
    for (const link of links) {
      const arr = linksByChild.get(link.objectId) ?? [];
      arr.push(link);
      linksByChild.set(link.objectId, arr);
    }

    // Kundreferens-värden: senaste/ärvda värdet per (objekt, fält), chunkat
    // enligt values-batch-endpointens tak (objectIds ≤ 500, katalogIds ≤ 60).
    const refValuesByObj: Record<string, Record<string, string>> = {};
    if (refFields.length > 0 && allObjects.length > 0) {
      const katalogIds = refFields.map(f => f.id);
      const OBJ_CHUNK = 200;
      const KAT_CHUNK = 60;
      const ids = allObjects.map(o => o.id);
      for (let i = 0; i < ids.length; i += OBJ_CHUNK) {
        const objChunk = ids.slice(i, i + OBJ_CHUNK);
        for (let j = 0; j < katalogIds.length; j += KAT_CHUNK) {
          const katChunk = katalogIds.slice(j, j + KAT_CHUNK);
          const mRes = await apiRequest("POST", "/api/metadata/objects/values-batch", {
            objectIds: objChunk,
            katalogIds: katChunk,
          });
          const mData: { values: Record<string, Record<string, string>> } = await mRes.json();
          for (const [objId, m] of Object.entries(mData.values ?? {})) {
            refValuesByObj[objId] = { ...(refValuesByObj[objId] ?? {}), ...m };
          }
        }
      }
    }

    const rows: (string | number)[][] = [];
    for (const child of allObjects) {
      const refCells = refFields.map(f => refValuesByObj[child.id]?.[f.id] ?? "");
      const base = [
        child.objectNumber || "",
        child.name,
        slaktnamnOf(child),
        child.status || "",
      ];
      const childLinks = (linksByChild.get(child.id) ?? [])
        .filter(link => numberById.has(link.parentId)); // förälder ej i exporturvalet → hoppa
      if (childLinks.length === 0) {
        // Rotobjekt (eller förälder utanför urvalet) — en rad med tom uppåt-koppling.
        rows.push([...base, "", ...refCells]);
        continue;
      }
      for (const link of childLinks) {
        rows.push([...base, numberById.get(link.parentId) || "", ...refCells]);
      }
    }
    return [headers, ...rows];
  };

  // ── Fil 3 – Metadata: långformat, en rad per objekt + metadatafält
  // (Objektnummer, Objektnamn, Släktnamn, Metadatafält, Data). Inkluderar
  // sammansatta/kontaktfält (allt som ligger i metadatakatalogen).
  const buildMetadataFileRows = async (
    allObjects: ServiceObject[],
  ): Promise<(string | number)[][]> => {
    const headers = ["Objektnummer", "Objektnamn", "Släktnamn", "Metadatafält", "Data"];
    const allKatalogIds = metadataCatalog.map(t => t.id);
    const katalogNameById = new Map(metadataCatalog.map(t => [t.id, t.namn]));
    const rows: (string | number)[][] = [];
    if (allKatalogIds.length === 0 || allObjects.length === 0) return [headers, ...rows];

    const objById = new Map(allObjects.map(o => [o.id, o]));
    const allIds = allObjects.map(o => o.id);
    // Chunka båda dimensionerna (objectIds ≤ 500, katalogIds ≤ 60).
    const OBJ_CHUNK = 200;
    const KAT_CHUNK = 60;
    for (let i = 0; i < allIds.length; i += OBJ_CHUNK) {
      const objChunk = allIds.slice(i, i + OBJ_CHUNK);
      const valuesByObj: Record<string, Record<string, string>> = {};
      for (let j = 0; j < allKatalogIds.length; j += KAT_CHUNK) {
        const katChunk = allKatalogIds.slice(j, j + KAT_CHUNK);
        const mRes = await apiRequest("POST", "/api/metadata/objects/values-batch", {
          objectIds: objChunk,
          katalogIds: katChunk,
        });
        const mData: { values: Record<string, Record<string, string>> } = await mRes.json();
        for (const [objId, m] of Object.entries(mData.values ?? {})) {
          valuesByObj[objId] = { ...(valuesByObj[objId] ?? {}), ...m };
        }
      }
      for (const objId of objChunk) {
        const obj = objById.get(objId);
        const objValues = valuesByObj[objId] ?? {};
        for (const katalogId of allKatalogIds) {
          const val = objValues[katalogId];
          if (val === undefined || val === null || val === "") continue;
          rows.push([
            obj?.objectNumber || "",
            obj?.name ?? "",
            obj ? slaktnamnOf(obj) : "",
            katalogNameById.get(katalogId) || katalogId,
            val,
          ]);
        }
      }
    }
    return [headers, ...rows];
  };

  // Tvåfils-export: Objektfilen (inkl. förälderkoppling) + Metadatafilen.
  // Samma filer kan läsas tillbaka via matchningsimporten för att uppdatera
  // befintliga objekt + metadata.
  const exportTwoFiles = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const allObjects = await fetchAllObjectsForExport();
      const objektRows = await buildObjektFileRows(allObjects);
      const metaRows = await buildMetadataFileRows(allObjects);
      downloadCSV("1-objekt.csv", objektRows);
      downloadCSV("2-metadata.csv", metaRows);
      toast({
        title: "Export klar",
        description: `${allObjects.length} objekt i två filer (objekt inkl. koppling, metadata)`,
      });
    } catch (err) {
      toast({ title: "Export misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const exportObjektFil = async (refFields: MetadataCatalogType[] = []) => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const allObjects = await fetchAllObjectsForExport();
      downloadCSV("1-objekt.csv", await buildObjektFileRows(allObjects, refFields));
      toast({
        title: "Export klar",
        description: refFields.length > 0
          ? `${allObjects.length} objekt exporterade med ${refFields.length} kundreferens-kolumn${refFields.length > 1 ? "er" : ""}`
          : `${allObjects.length} objekt exporterade`,
      });
    } catch (err) {
      toast({ title: "Export misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const exportMetadataFil = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const allObjects = await fetchAllObjectsForExport();
      const rows = await buildMetadataFileRows(allObjects);
      downloadCSV("2-metadata.csv", rows);
      toast({ title: "Export klar", description: `Metadatavärden exporterade (${rows.length - 1} rader)` });
    } catch (err) {
      toast({ title: "Export misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  // Kundreferens-export: dialog där man väljer ett eller flera metadatafält
  // (t.ex. butiksnummer/fastighetsnummer) som extra kolumner i objektfilen —
  // används som översättningsnyckel mot kundens egna listor.
  const [refExportDialogOpen, setRefExportDialogOpen] = useState(false);
  const [refExportFieldIds, setRefExportFieldIds] = useState<Set<string>>(new Set());
  const [refExportSearch, setRefExportSearch] = useState("");
  const refExportCandidates = useMemo(() => {
    const q = refExportSearch.trim().toLowerCase();
    if (!q) return metadataCatalog;
    return metadataCatalog.filter(t =>
      t.namn.toLowerCase().includes(q) || (t.beteckning ?? "").toLowerCase().includes(q),
    );
  }, [metadataCatalog, refExportSearch]);
  const runRefExport = async () => {
    const fields = metadataCatalog.filter(t => refExportFieldIds.has(t.id));
    setRefExportDialogOpen(false);
    await exportObjektFil(fields);
  };

  // Kolumnexport av markerade objekt i round-trip-format för matchningsimporten
  // (/import): "Systemnummer" → system_id, "Objektnamn" → name (KNOWN_FIELDS), och
  // varje vald metadatakolumn som metadata.<namn>. Nyckeln är exakt den som
  // matchningsimportens fält-katalog (/api/import/objects-v2/fields) exponerar
  // (metadata.${k.namn}) och som execute resolvar via ensureKatalogRow(namn).
  // metadata_katalog.namn är unikt per tenant, så även familjefält (med förälder)
  // matchar rätt katalograd via sitt eget namn — INGEN punktnotation här (dotted
  // nycklar skulle felaktigt grupperas som json-fält i groupMetadataForWrite).
  const exportSelectedColumns = async () => {
    if (isExporting) return;
    if (selectedIds.size === 0) return;
    setIsExporting(true);
    try {
      // Task #1398: hämta de markerade objekten via ids-parametern i stället för
      // att filtrera aktuell sida — trädvyns gren-urval (och markeringar på andra
      // sidor i listan) ska också exporteras. OBS: med `ids` svarar endpointen
      // med en BAR array (inte {objects,total}).
      const selected: ServiceObject[] = [];
      const allIds = Array.from(selectedIds);
      const ID_CHUNK = 200;
      for (let i = 0; i < allIds.length; i += ID_CHUNK) {
        const chunk = allIds.slice(i, i + ID_CHUNK);
        const res = await fetch(`/api/objects?ids=${encodeURIComponent(chunk.join(","))}`, { credentials: "include" });
        if (!res.ok) throw new Error("Kunde inte hämta markerade objekt");
        const data = await res.json();
        for (const o of Array.isArray(data) ? data : data.objects ?? []) selected.push(o);
      }
      const fields = selectedMetadataFields;
      const katalogIds = fields.map(f => f.id);

      // Hämta senaste värde per (objekt, katalog) — chunkat för att hålla oss inom
      // values-batch-takten (objectIds ≤ 500, katalogIds ≤ 60). Endpointen
      // returnerar redan ETT (närmaste/ärvda) värde per katalog, så multivärde-fält
      // exporteras med endast senaste värdet (ingen radexplosion).
      const valuesByObj: Record<string, Record<string, string>> = {};
      if (katalogIds.length > 0) {
        const OBJ_CHUNK = 200;
        const KAT_CHUNK = 60;
        const ids = selected.map(o => o.id);
        for (let i = 0; i < ids.length; i += OBJ_CHUNK) {
          const objChunk = ids.slice(i, i + OBJ_CHUNK);
          for (let j = 0; j < katalogIds.length; j += KAT_CHUNK) {
            const katChunk = katalogIds.slice(j, j + KAT_CHUNK);
            const res = await apiRequest("POST", "/api/metadata/objects/values-batch", {
              objectIds: objChunk,
              katalogIds: katChunk,
            });
            const data: { values: Record<string, Record<string, string>> } = await res.json();
            for (const [objId, m] of Object.entries(data.values ?? {})) {
              valuesByObj[objId] = { ...(valuesByObj[objId] ?? {}), ...m };
            }
          }
        }
      }

      const headers = [
        "Systemnummer",
        "Objektnamn",
        ...fields.map(f => `metadata.${f.namn}`),
      ];
      const rows: (string | number)[][] = selected.map(obj => [
        obj.objectNumber || "",
        obj.name,
        ...fields.map(f => valuesByObj[obj.id]?.[f.id] ?? ""),
      ]);
      downloadCSV("markerade_objekt.csv", [headers, ...rows]);
      toast({
        title: "Export klar",
        description: `${selected.length} markerade objekt exporterade i kolumnformat – kan läsas tillbaka via matchningsimporten`,
      });
    } catch (err) {
      toast({
        title: "Export misslyckades",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Task #1398: skicka urvalet (gren minus avmarkerade) som underlag till
  // orderkoncept-wizarden. Wizardens server-resolver expanderar varje id till
  // hela dess subträd — därför skickas MINIMALA helt täckta gren-rötter
  // (computeBranchSeedRoots), aldrig delvis täckta föräldrar, så att avmarkerade
  // underobjekt inte åter-inkluderas.
  const createConceptFromSelection = useCallback(() => {
    if (selectedIds.size === 0) return;
    const treeData = queryClient.getQueryData<{ nodes: TreeNode[] }>(["/api/objects/hierarchy-tree"]);
    const seedIds = treeData?.nodes?.length
      ? computeBranchSeedRoots(treeData.nodes, selectedIds)
      : Array.from(selectedIds);
    try {
      sessionStorage.setItem("traivo:orderconcept:seedObjectIds", JSON.stringify(seedIds));
    } catch { /* sessionStorage otillgänglig — wizarden öppnas utan urval */ }
    navigate("/order-concepts/new");
  }, [selectedIds, navigate]);

  const runBulkUpdate = async (payload: Record<string, unknown>, successMsg: (n: number) => string) => {
    if (bulkBusy) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    let updated = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await apiRequest("PATCH", `/api/objects/${id}`, payload);
        updated++;
      } catch {
        failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
    setSelectedIds(new Set());
    setBulkBusy(false);
    toast({
      title: failed > 0 ? "Klart med varningar" : "Klart",
      description: `${successMsg(updated)}${failed > 0 ? `, ${failed} misslyckades` : ""}`,
      variant: failed > 0 ? "destructive" : undefined,
    });
  };

  const runBulkGeocode = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await apiRequest("POST", "/api/objects/batch-geocode", { objectIds: Array.from(selectedIds) });
      const data: { geocoded: number; updated: number } = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      toast({ title: "Geokodning klar", description: `${data.updated} objekt uppdaterade (${data.geocoded} geokodade)` });
    } catch (err) {
      toast({ title: "Geokodning misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  // Task #1403: geokoda exakt de objekt som listas i kartans saknar-koordinater-
  // panel (befintlig batch-geocode-endpoint med explicita objekt-id:n).
  const [mapGeocodeRunning, setMapGeocodeRunning] = useState(false);
  // Task #1414: per-objekt-resultat från senaste körningen (id → orsak) så
  // panelen kan visa varför kvarvarande objekt inte kunde geokodas.
  const [mapGeocodeFailures, setMapGeocodeFailures] = useState<Record<string, "no_address" | "no_match">>({});
  const runMissingCoordsGeocode = async (ids: string[]) => {
    if (mapGeocodeRunning || ids.length === 0) return;
    setMapGeocodeRunning(true);
    try {
      const res = await apiRequest("POST", "/api/objects/batch-geocode", { objectIds: ids });
      const data: { geocoded: number; updated: number; failures?: Array<{ id: string; reason: "no_address" | "no_match" }> } = await res.json();
      const failureMap: Record<string, "no_address" | "no_match"> = {};
      for (const f of data.failures ?? []) failureMap[f.id] = f.reason;
      setMapGeocodeFailures(failureMap);
      queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
      const failedCount = data.failures?.length ?? 0;
      toast({
        title: "Geokodning klar",
        description: `${data.updated} objekt uppdaterade (${data.geocoded} geokodade)${failedCount > 0 ? `, ${failedCount} kunde inte geokodas — se panelen` : ""}`,
      });
    } catch (err) {
      toast({ title: "Geokodning misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setMapGeocodeRunning(false);
    }
  };

  const runBulkParentMove = async () => {
    await runBulkUpdate({ parentId: bulkNewParentId }, (n) => `${n} objekt flyttade`);
    setBulkParentDialogOpen(false);
    setBulkNewParentId(null);
  };

  const runBulkDelete = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await apiRequest("DELETE", `/api/objects/${id}`);
        deleted++;
      } catch {
        failed++;
      }
    }
    queryClient.invalidateQueries({ queryKey: ["/api/objects"], exact: false });
    setSelectedIds(new Set());
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    toast({
      title: failed > 0 ? "Borttagning klar med varningar" : "Borttagning klar",
      description: `${deleted} objekt borttagna${failed > 0 ? `, ${failed} misslyckades` : ""}`,
      variant: failed > 0 ? "destructive" : undefined,
    });
  };


  if (isLoading || objectsIsError) {
    return (
      <div className="p-6">
        <QueryState
          isLoading={isLoading}
          isError={objectsIsError}
          isEmpty={false}
          error={objectsError instanceof Error ? objectsError : null}
          onRetry={() => objectsRefetch()}
          loadingVariant="skeleton-rows"
          skeletonRows={8}
        >
          <></>
        </QueryState>
      </div>
    );
  }

  const renderObjectTree = (obj: ServiceObject, level: number = 0) => {
    const children = getChildren(obj.id);
    const isExpanded = expandedAreas.has(obj.id);
    const hasChildren = children.length > 0;

    return (
      <div key={obj.id} className="border-b last:border-b-0">
        <div 
          className={`flex items-center gap-3 p-3 hover-elevate cursor-pointer ${level > 0 ? 'bg-muted/30' : ''} ${selectedIds.has(obj.id) ? 'bg-primary/5' : ''}`}
          style={{ paddingLeft: `${12 + level * 24}px` }}
          data-testid={`object-row-${obj.id}`}
        >
          <Checkbox
            checked={selectedIds.has(obj.id)}
            onCheckedChange={() => toggleSelected(obj.id)}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
            data-testid={`checkbox-object-${obj.id}`}
          />
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
                {(() => {
                  const localName = localizedObjectName(obj.name, (obj as any).nameTranslations);
                  if (localName && localName !== obj.name) return localName;
                  if ((obj as any).displayName && (obj as any).displayName !== obj.name) return (obj as any).displayName;
                  return localName && localName !== "0" ? localName : obj.objectNumber || localName;
                })()}
              </span>
              {obj.objectNumber && obj.name && obj.name !== "0" && (
                <span className="text-xs text-muted-foreground font-mono">{obj.objectNumber}</span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleDisplayNames(obj.id); }}
                    className={`flex items-center rounded p-0.5 hover-elevate ${expandedDisplayNames.has(obj.id) ? "text-chart-3" : "text-muted-foreground"}`}
                    data-testid={`button-display-names-${obj.id}`}
                  >
                    <Network className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Visa släktnamn & hierarkisökväg</TooltipContent>
              </Tooltip>
              {obj.isInterimObject && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="destructive" className="text-xs gap-1 cursor-help">
                      <ShieldAlert className="h-3 w-3" />
                      Rapporterat
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-sm">Objekt som skapats via extern felanmälan (QR-kod) och ännu inte verifierats av en administratör.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {obj.reconciliationFlag === "missing_in_fastighetslista" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs gap-1 cursor-help text-warning border-warning/40" data-testid={`badge-reconciliation-${obj.id}`}>
                      <AlertTriangle className="h-3 w-3" />
                      Saknas i fastighetslista
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-sm">Detta objekt finns i Traivo men saknades i kundens senast uppladdade fastighetslista. Granska manuellt och rensa flaggan via 3-prick-menyn.</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {reportCounts[obj.id] > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      onClick={(e) => { e.stopPropagation(); navigate(`/customer-reports?objectId=${obj.id}`); }}
                      data-testid={`badge-reports-${obj.id}`}
                    >
                      <Badge className="bg-chart-2 text-white text-xs gap-1 cursor-pointer hover:bg-chart-2">
                        <Camera className="h-3 w-3" />
                        {reportCounts[obj.id]} rapport{reportCounts[obj.id] !== 1 ? "er" : ""}
                      </Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-sm">{reportCounts[obj.id]} ny(a) kundrapport(er). Klicka för att visa.</p>
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
                    <span className="flex items-center gap-1 text-chart-2 cursor-help">
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
                    <span className="flex items-center gap-1 text-chart-4 cursor-help">
                      <AlertTriangle className="h-3 w-3 text-chart-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Stad saknas</TooltipContent>
                </Tooltip>
              )}
              {/* Task #1399: kund visas inte längre per objekt — kund hör hemma
                  på uppgiftsnivå (payer-relationen finns kvar i backend). */}
              {/* Task #859: förälder/barn-relation. Barn på samma sida ligger redan
                  indenterat under föräldern; toppnivå-rader som ändå har en förälder
                  får en explicit "under {förälder}"-indikator. */}
              {level === 0 && obj.parentId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="flex items-center gap-1 cursor-pointer text-foreground/70 hover:text-foreground hover:underline"
                      onClick={(e) => { e.stopPropagation(); navigate(`/objects/${obj.parentId}`); }}
                      data-testid={`link-parent-${obj.id}`}
                    >
                      <GitFork className="h-3 w-3" />
                      Under {objectNameById.get(obj.parentId) ?? "överordnat objekt"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Överordnat objekt — klicka för att öppna</TooltipContent>
                </Tooltip>
              )}
              {hasChildren && (
                <span className="flex items-center gap-1 text-muted-foreground" data-testid={`text-childcount-${obj.id}`}>
                  <Network className="h-3 w-3" />
                  {children.length} underordnade
                </span>
              )}
            </div>

            {/* Kontaktuppgifter (Kontakt/Tel/E-post) — fasta, ärvda systemfält,
                alltid synliga oberoende av det fria kolumnvalet. Visas bara om
                minst ett av fälten har ett (eget eller ärvt) värde. */}
            {contactMetadataFields.some(f => metadataValues[obj.id]?.[f.id]) && (
              <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 flex-wrap" data-testid={`contact-fields-${obj.id}`}>
                {contactMetadataFields.map(field => {
                  const value = metadataValues[obj.id]?.[field.id];
                  if (!value) return null;
                  const Icon = field.namn === "Kontaktperson_Telefon" ? Phone
                    : field.namn === "Kontaktperson_Epost" ? Mail
                    : Users;
                  return (
                    <span
                      key={field.id}
                      className="inline-flex items-center gap-1 text-xs"
                      data-testid={`contact-field-${field.namn}-${obj.id}`}
                    >
                      <Icon className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium text-foreground">{value}</span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Task #859: valda metadatakolumner som etikett/värde-chips */}
            {selectedMetadataFields.length > 0 && !metadataColumnsCollapsed && (
              <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 flex-wrap" data-testid={`metadata-columns-${obj.id}`}>
                {selectedMetadataFields.map(field => {
                  const value = metadataValues[obj.id]?.[field.id];
                  return (
                    <span
                      key={field.id}
                      className="inline-flex items-center gap-1 text-xs"
                      data-testid={`metadata-cell-${field.id}-${obj.id}`}
                    >
                      <span className="text-muted-foreground">{field.namn}:</span>
                      <span className={value ? "font-medium text-foreground" : "text-muted-foreground/60"}>
                        {value ?? "—"}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {(
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); navigate(`/objects/${obj.id}?tab=metadata`); }}
                      data-testid={`button-metadata-${obj.id}`}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Visa metadata</p></TooltipContent>
                </Tooltip>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} data-testid={`button-more-actions-${obj.id}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleEditObject(obj)} data-testid={`menu-edit-${obj.id}`}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Redigera
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleAddChild(obj)} data-testid={`menu-add-child-${obj.id}`}>
                      <FolderPlus className="h-4 w-4 mr-2" />
                      Lägg till underordnat objekt
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleCopyObject(obj)} data-testid={`menu-copy-${obj.id}`}>
                      <Copy className="h-4 w-4 mr-2" />
                      Kopiera
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setOverflowPanel({ objectId: obj.id, panel: "parents" })} data-testid={`menu-parents-${obj.id}`}>
                      <GitFork className="h-4 w-4 mr-2" />
                      Föräldrar
                    </DropdownMenuItem>
                    {obj.isInterimObject && (
                      <>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); verifyObjectMutation.mutate(obj.id); }}
                          className="text-chart-2"
                          data-testid={`menu-verify-${obj.id}`}
                        >
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          Verifiera objekt
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); rejectObjectMutation.mutate(obj.id); }}
                          className="text-destructive"
                          data-testid={`menu-reject-${obj.id}`}
                        >
                          <ShieldX className="h-4 w-4 mr-2" />
                          Avvisa objekt
                        </DropdownMenuItem>
                      </>
                    )}
                    {obj.reconciliationFlag === "missing_in_fastighetslista" && (
                      <DropdownMenuItem
                        onClick={(e) => { e.stopPropagation(); clearReconciliationMutation.mutate(obj.id); }}
                        data-testid={`menu-clear-reconciliation-${obj.id}`}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Rensa "saknas i fastighetslista"
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteTarget(obj)}
                      className="text-destructive focus:text-destructive"
                      data-testid={`menu-delete-${obj.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Ta bort
                    </DropdownMenuItem>
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

        {expandedDisplayNames.has(obj.id) && (
          <div
            className="px-4 pb-3 pt-1 bg-muted/20 border-t"
            style={{ paddingLeft: `${12 + level * 24 + 32}px` }}
            data-testid={`display-names-panel-${obj.id}`}
          >
            <ObjectDisplayNames objectId={obj.id} enabled allowSetPrimary showSettingsLink />
          </div>
        )}

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

  const issueFilterLabels: Record<string, string> = {
    "no-coords": "Objekt utan koordinater",
    "no-address": "Objekt utan adress",
    "no-customer": "Objekt utan kundkoppling",
    "empty-metadata": "Objekt med tomma metadata-fält",
  };

  return (
    <div className="p-6 space-y-6">
      {issueFilter && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30" data-testid="banner-issue-filter">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-sm font-medium text-destructive">
            Filtrerat: {issueFilterLabels[issueFilter] || issueFilter}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto" onClick={clearAllFilters} data-testid="button-clear-issue-filter">
            Rensa filter
          </Button>
        </div>
      )}
      <PageHeader icon={Building2} title={t("object_plural")} description={`${filteredObjects.length} av ${totalObjects.toLocaleString("sv")} objekt visas`}>
        <Link href="/objects/duplicates">
          <Button variant="outline" data-testid="button-duplicates">
            <Copy className="h-4 w-4 mr-2" />
            Dubbletter
          </Button>
        </Link>
        <Button variant="outline" onClick={() => { setBatchGeoOpen(true); setBatchGeoResult(null); }} data-testid="button-batch-geocode">
          <Globe className="h-4 w-4 mr-2" />
          Batch-geocodning
        </Button>
        <Link href="/import">
          <Button variant="outline" data-testid="button-import">
            <Upload className="h-4 w-4 mr-2" />
            Importera
          </Button>
        </Link>
        <Button variant="outline" onClick={() => setMetadataColumnsDialogOpen(true)} data-testid="button-metadata-columns">
          <Columns3 className="h-4 w-4 mr-2" />
          Metadatakolumner
          {selectedMetadataColumns.length > 0 && (
            <Badge variant="secondary" className="ml-2" data-testid="badge-metadata-columns-count">
              {selectedMetadataColumns.length}
            </Badge>
          )}
        </Button>
        {selectedMetadataColumns.length > 0 && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMetadataColumnsCollapsed(v => !v)}
            title={metadataColumnsCollapsed ? "Visa metadatakolumner i listan" : "Dölj metadatakolumner i listan"}
            aria-label={metadataColumnsCollapsed ? "Visa metadatakolumner i listan" : "Dölj metadatakolumner i listan"}
            data-testid="button-toggle-metadata-columns"
          >
            {metadataColumnsCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={isExporting} data-testid="button-export">
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              {isExporting ? "Exporterar…" : "Exportera"}
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            {/* Task #1397: tydliggör exportens omfattning innan man väljer format. */}
            <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1" data-testid="text-export-scope">
              {selectedIds.size > 0
                ? `Exporterar ${selectedIds.size} markerade objekt`
                : `Exporterar hela urvalet (${totalObjects.toLocaleString("sv-SE")} objekt)`}
            </div>
            <DropdownMenuItem onClick={exportTwoFiles} data-testid="menu-export-two-files">
              <FileSpreadsheet className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span>Tvåfils-export (CSV)</span>
                <span className="text-xs text-muted-foreground">Objekt (inkl. koppling uppåt) + metadata – kan läsas tillbaka via matchningsimporten</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => exportObjektFil()} data-testid="menu-export-objekt-file">
              <FileSpreadsheet className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span>Fil 1 – Objekt (CSV)</span>
                <span className="text-xs text-muted-foreground">Objektnummer, namn, släktnamn, status, koppling uppåt (en rad per koppling)</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { setRefExportFieldIds(new Set()); setRefExportSearch(""); setRefExportDialogOpen(true); }}
              data-testid="menu-export-objekt-kundreferens"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span>Fil 1 med kundreferens…</span>
                <span className="text-xs text-muted-foreground">Välj metadatafält (t.ex. butiksnummer) som extra kolumner – översättningsnyckel mot kundens listor</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportMetadataFil} data-testid="menu-export-metadata-file">
              <FileSpreadsheet className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span>Fil 2 – Metadata (CSV)</span>
                <span className="text-xs text-muted-foreground">En rad per objekt + metadatafält (namn, data)</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/objektmall-import")} data-testid="menu-export-excel-roundtrip">
              <Download className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span>För återimport (Excel, mallspåret)</span>
                <span className="text-xs text-muted-foreground">Redigera och läs tillbaka – uppdaterar befintliga objekt via objektmallen</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/import?tab=objectsv2")} data-testid="menu-goto-import">
              <Upload className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span>Läs tillbaka en fil (import)…</span>
                <span className="text-xs text-muted-foreground">Öppna matchningsimporten – exporterade filer kan läsas tillbaka med kolumnmatchning</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={refExportDialogOpen} onOpenChange={setRefExportDialogOpen}>
          <DialogContent className="max-w-md" data-testid="dialog-ref-export">
            <DialogHeader>
              <DialogTitle>Exportera med kundreferens</DialogTitle>
              <DialogDescription>
                Välj ett eller flera metadatafält som läggs till som extra kolumner i objektfilen —
                t.ex. butiksnummer eller fastighetsnummer, för att kunna matcha mot kundens egna listor.
                För fält med flera poster exporteras det senaste värdet.
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Sök metadatafält…"
              value={refExportSearch}
              onChange={(e) => setRefExportSearch(e.target.value)}
              data-testid="input-ref-export-search"
            />
            <div className="max-h-64 overflow-y-auto space-y-1 border rounded-md p-2">
              {refExportCandidates.length === 0 && (
                <p className="text-sm text-muted-foreground p-2">Inga metadatafält matchar sökningen.</p>
              )}
              {refExportCandidates.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover-elevate cursor-pointer"
                  data-testid={`ref-export-field-${t.id}`}
                >
                  <Checkbox
                    checked={refExportFieldIds.has(t.id)}
                    onCheckedChange={(checked) => {
                      setRefExportFieldIds(prev => {
                        const next = new Set(prev);
                        if (checked) next.add(t.id); else next.delete(t.id);
                        return next;
                      });
                    }}
                  />
                  <span className="flex-1">{t.beteckning || t.namn}</span>
                  {t.beteckning && t.beteckning !== t.namn && (
                    <span className="text-xs text-muted-foreground font-mono">{t.namn}</span>
                  )}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRefExportDialogOpen(false)} data-testid="button-ref-export-cancel">
                Avbryt
              </Button>
              <Button
                onClick={runRefExport}
                disabled={refExportFieldIds.size === 0 || isExporting}
                data-testid="button-ref-export-run"
              >
                <Download className="h-4 w-4 mr-2" />
                Exportera ({refExportFieldIds.size} fält)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button size="lg" onClick={() => navigate("/objects/new")} data-testid="button-add-object">
          <Plus className="h-4 w-4 mr-2" />
          Skapa {t("object_singular").toLowerCase()}
        </Button>
      </PageHeader>

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
            } catch (error) { toast({ title: "Kunde inte analysera servicemönster", description: error instanceof Error ? error.message : "Försök igen senare.", variant: "destructive" }); setServicePatternDialog({ open: true, loading: false, data: { summary: "Kunde inte analysera servicemönster.", patterns: [], anomalies: [] } }); }
          }}},
          { type: "info", title: "Underhållsprognoser", description: "Prediktera kommande servicebehov baserat på historik", action: { label: "Analysera", onClick: async () => {
            setMaintenanceDialog({ open: true, loading: true });
            try {
              const ids = filteredObjects.map(o => o.id);
              const res = await apiRequest("POST", "/api/ai/predictive-maintenance", { objectIds: ids.length <= 200 ? ids : undefined });
              if (!res.ok) throw new Error("API error");
              const data = await res.json();
              setMaintenanceDialog({ open: true, loading: false, data });
            } catch (error) { toast({ title: "Kunde inte generera prognoser", description: error instanceof Error ? error.message : "Försök igen senare.", variant: "destructive" }); setMaintenanceDialog({ open: true, loading: false, data: { overdue: [], upcoming: [], summary: "Kunde inte generera prognoser.", totalPredicted: 0 } }); }
          }}},
        ]}
      />

      <Card ref={stickyCardRef} className="sticky top-0 z-20 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <SearchInput
                placeholder={`Sök ${t("object_plural").toLowerCase()}, kund, adress, stad...`}
                initialValue={debouncedSearch}
                onDebouncedChange={handleDebouncedSearch}
              />
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
              <div className="flex items-center gap-1">
                <Button
                  variant={reportedFilter ? "default" : "outline"}
                  size="sm"
                  onClick={() => setReportedFilter(!reportedFilter)}
                  className="gap-2"
                  data-testid="button-reported-filter"
                >
                  <AlertTriangle className="h-4 w-4" />
                  Rapporterade objekt
                  {reportedCount > 0 && (
                    <Badge variant={reportedFilter ? "outline" : "destructive"} className="h-5 min-w-[20px] p-0 flex items-center justify-center text-xs rounded-full">
                      {reportedCount}
                    </Badge>
                  )}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" data-testid="info-rapporterade-objekt" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs text-sm">Objekt med minst en aktiv avvikelse eller felanmälan (öppen kund- eller fältrapport). Overifierade QR-objekt filtreras separat i filterpanelen.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1 text-muted-foreground" data-testid="button-clear-filters">
                  <XCircle className="h-4 w-4" />
                  Rensa filter
                </Button>
              )}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              {conditionFilters.map((f, i) => f.metadataKey ? (
                <Badge key={`cond-${i}`} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setConditionFilters(conditionFilters.filter((_, idx) => idx !== i))} data-testid={`badge-filter-condition-${i}`}>
                  {f.metadataKey}
                  {" "}{(OBJECT_CONDITION_OPERATORS.find(o => o.value === f.operator)?.label ?? CONDITION_OPERATORS.find(o => o.value === f.operator)?.label ?? f.operator)}
                  {CONDITION_OPERATORS.find(o => o.value === f.operator)?.noValue ? "" : ` ${String(f.filterValue ?? "")}`}
                  <X className="h-3 w-3" />
                </Badge>
              ) : null)}
              {customerFilter.map(cId => (
                <Badge key={cId} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeCustomerFilter(cId)} data-testid={`badge-filter-customer-${cId}`}>
                  {customerNameMap.get(cId) || cId}
                  <X className="h-3 w-3" />
                </Badge>
              ))}
              {locationTypeFilter !== "all" && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setLocationTypeFilter("all")} data-testid="badge-filter-location-type">
                  Platstyp: {OBJECT_LOCATION_TYPE_LABELS[locationTypeFilter as keyof typeof OBJECT_LOCATION_TYPE_LABELS] ?? locationTypeFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {reportedFilter && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setReportedFilter(false)} data-testid="badge-filter-reported">
                  Rapporterade objekt
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {interimFilter && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => setInterimFilter(false)} data-testid="badge-filter-interim">
                  Overifierade (QR)
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {importBatchFilter && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={clearImportBatchFilter} data-testid="badge-filter-import-batch">
                  Import: {importBatchFilter}
                  <X className="h-3 w-3" />
                </Badge>
              )}
            </div>
          )}
        </CardHeader>
        {filtersOpen && (
          <CardContent className="space-y-4 pt-0 max-h-[45vh] overflow-y-auto">
            <div className="flex items-center gap-4 flex-wrap">
              <CustomerMultiCombobox
                selected={customerFilter}
                onAdd={addCustomerFilter}
                onRemoveAll={() => setCustomerFilter([])}
                placeholder="Filtrera kommun / kund"
                className="w-[180px]"
                testId="select-customer-filter"
              />
              <Select value={locationTypeFilter} onValueChange={setLocationTypeFilter}>
                <SelectTrigger className="w-[180px]" data-testid="select-location-type-filter">
                  <SelectValue placeholder="Platstyp" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla platstyper</SelectItem>
                  <SelectItem value="pinpoint">{OBJECT_LOCATION_TYPE_LABELS.pinpoint}</SelectItem>
                  <SelectItem value="area">{OBJECT_LOCATION_TYPE_LABELS.area}</SelectItem>
                  <SelectItem value="none">{OBJECT_LOCATION_TYPE_LABELS.none}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer" data-testid="checkbox-interim-label">
                <Checkbox
                  checked={interimFilter}
                  onCheckedChange={(v) => { setInterimFilter(v === true); setCurrentPage(0); }}
                  data-testid="checkbox-interim"
                />
                <span className="flex items-center gap-1">
                  Overifierade (QR)
                  {interimCount > 0 && (
                    <Badge variant="outline" className="h-5 min-w-[20px] p-0 flex items-center justify-center text-xs rounded-full">
                      {interimCount}
                    </Badge>
                  )}
                </span>
              </label>
            </div>
            <div className="space-y-2">
              <Label className="text-sm flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5" /> Villkorsfilter (metadata)
              </Label>
              <p className="text-xs text-muted-foreground">
                Matcha objekt på metadatafält — samma matchning som orderkoncept-förhandsvisningen.
              </p>
              <ConditionFilterList
                filters={conditionFilters}
                fields={conditionFields}
                operators={OBJECT_CONDITION_OPERATORS}
                onChange={setConditionFilters}
                emptyText="Inga villkor — alla objekt visas."
                addTestId="button-add-condition-object"
              />
            </div>
          </CardContent>
        )}
      </Card>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "list" | "map" | "tree")}>
        <TabsList>
          <TabsTrigger value="list" className="gap-2" data-testid="tab-list">
            <List className="h-4 w-4" />
            Lista
          </TabsTrigger>
          <TabsTrigger value="tree" className="gap-2" data-testid="tab-tree">
            <Network className="h-4 w-4" />
            Träd
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-2" data-testid="tab-map">
            <MapIcon className="h-4 w-4" />
            Karta
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <BulkActionBar
            selectedCount={selectedIds.size}
            totalCount={filteredTopLevel.length}
            onSelectAll={() => setSelectedIds(new Set(filteredTopLevel.map(o => o.id)))}
            onClearSelection={() => setSelectedIds(new Set())}
          >
            <Select value={bulkNewStatus} onValueChange={setBulkNewStatus}>
              <SelectTrigger className="w-[130px] h-8" data-testid="select-bulk-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="inactive">Inaktiv</SelectItem>
                <SelectItem value="paused">Pausad</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={bulkBusy}
              onClick={() => runBulkUpdate({ status: bulkNewStatus }, (n) => `${n} objekt uppdaterade till ${bulkNewStatus}`)}
              data-testid="button-bulk-change-status"
            >
              Ändra status
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={bulkBusy} data-testid="button-bulk-more">
                  {bulkBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <MoreHorizontal className="h-4 w-4 mr-1" />}
                  Fler åtgärder
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={runBulkGeocode} data-testid="menu-bulk-geocode">
                  <MapPin className="h-4 w-4 mr-2" />
                  Geokoda markerade
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBulkParentDialogOpen(true)} data-testid="menu-bulk-move-parent">
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Flytta till förälder…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportSelectedColumns} data-testid="menu-bulk-export">
                  <Download className="h-4 w-4 mr-2" />
                  Exportera markerade (för återimport)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setBulkDeleteOpen(true)} className="text-destructive focus:text-destructive" data-testid="menu-bulk-delete">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Ta bort markerade
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </BulkActionBar>
          <div className="border rounded-md bg-card">
            {filteredTopLevel.length > 0 && (
              <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted text-xs font-medium text-muted-foreground sticky z-10" style={{ top: stickyOffset }} data-testid="header-sort-row">
                <div className="w-4 shrink-0" />
                <div className="w-4 shrink-0" />
                <button
                  onClick={() => toggleSort("name")}
                  className={`flex-1 min-w-0 flex items-center gap-1 hover:text-foreground text-left ${sortConfig.field === "name" ? "text-primary font-semibold" : ""}`}
                  data-testid="button-sort-name"
                >
                  Namn <SortIcon field="name" />
                </button>
                <button
                  onClick={() => toggleSort("city")}
                  className={`hidden md:flex items-center gap-1 hover:text-foreground w-32 shrink-0 ${sortConfig.field === "city" ? "text-primary font-semibold" : ""}`}
                  data-testid="button-sort-city"
                >
                  Stad <SortIcon field="city" />
                </button>
                <button
                  onClick={() => toggleSort("children")}
                  className={`flex items-center gap-1 hover:text-foreground w-20 shrink-0 justify-end ${sortConfig.field === "children" ? "text-primary font-semibold" : ""}`}
                  data-testid="button-sort-children"
                >
                  Antal <SortIcon field="children" />
                </button>
              </div>
            )}
            {filteredTopLevel.length > 0 ? (
              filteredTopLevel.map(obj => renderObjectTree(obj))
            ) : totalObjects === 0 && !debouncedSearch && activeConditions.length === 0 && customerFilter.length === 0 && !interimFilter && !reportedFilter ? (
              <div className="text-center py-16 px-6">
                <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Package className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Inga {t("object_plural").toLowerCase()} ännu</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Skapa ditt första {t("object_singular").toLowerCase()} för att komma igång, eller importera befintlig data via CSV.
                </p>
                <div className="flex items-center justify-center gap-3">
                  <Button onClick={() => navigate("/objects/new")} data-testid="button-empty-create-object">
                    <Plus className="h-4 w-4 mr-2" />
                    Skapa ditt första {t("object_singular").toLowerCase()}
                  </Button>
                  <Link href="/import">
                    <Button variant="outline" data-testid="button-empty-import">
                      <Upload className="h-4 w-4 mr-2" />
                      Importera
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">Inga {t("object_plural").toLowerCase()} hittades med aktuella filter</p>
                {activeFilterCount > 0 && (
                  <Button variant="outline" size="sm" onClick={clearAllFilters} className="gap-1" data-testid="button-empty-clear-filters">
                    <XCircle className="h-4 w-4" />
                    Rensa filter
                  </Button>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tree" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Network className="h-4 w-4" />
                Objekthierarki
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Sök på namn och metadata för att hitta {t("object_plural").toLowerCase()} i hela
                trädet. Klicka på ett {t("object_singular").toLowerCase()} för att öppna helheten.
                Kryssa i en förälder för att markera hela grenen — enskilda underobjekt kan
                därefter avmarkeras.
              </p>
              {selectedIds.size > 0 && (
                <div
                  className="flex flex-wrap items-center gap-3 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2.5 mb-3"
                  data-testid="tree-selection-bar"
                >
                  <Check className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium" data-testid="text-tree-selected-count">
                    {selectedIds.size} markerade
                  </span>
                  <div className="flex-1" />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isExporting}
                    onClick={exportSelectedColumns}
                    data-testid="button-tree-export-selection"
                  >
                    {isExporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Exportera markerade
                  </Button>
                  <Button
                    size="sm"
                    onClick={createConceptFromSelection}
                    data-testid="button-tree-create-concept"
                  >
                    <Package className="h-4 w-4 mr-1" />
                    Skapa orderkoncept från urval
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    data-testid="button-tree-clear-selection"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <ObjectHierarchyTree
                enableScopeModes
                height={600}
                onNodeClick={(node) => navigate(`/objects/${node.id}`)}
                branchSelection
                selectedObjectIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <ObjectsMapTab
            objectsWithCoords={objectsWithCoords}
            mapPositions={mapPositions}
            defaultCenter={defaultCenter}
            selectedObjectIds={selectedIds}
            missingCoordObjects={objectsMissingCoords}
            onOpenObject={(id) => navigate(`/objects/${id}`)}
            onBackToList={() => setViewMode("list")}
            onGeocodeMissing={runMissingCoordsGeocode}
            geocodeRunning={mapGeocodeRunning}
            geocodeFailures={mapGeocodeFailures}
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
              onClick={() => { setCurrentPage(p => Math.max(0, p - 1)); window.scrollTo({ top: 0 }); }}
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
              onClick={() => { setCurrentPage(p => Math.min(totalPages - 1, p + 1)); window.scrollTo({ top: 0 }); }}
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
            <div className="space-y-2">
              <Label>Omfattning</Label>
              <RadioGroup value={copyMode} onValueChange={(v) => setCopyMode(v as "single" | "branch")}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="single" id="copy-mode-single" data-testid="radio-copy-single" />
                  <Label htmlFor="copy-mode-single" className="font-normal cursor-pointer">Endast detta objekt</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="branch" id="copy-mode-branch" data-testid="radio-copy-branch" />
                  <Label htmlFor="copy-mode-branch" className="font-normal cursor-pointer">Hela grenen (objektet + alla barnobjekt)</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>Avbryt</Button>
            <Button onClick={executeCopy} disabled={copyObjectMutation.isPending} data-testid="button-confirm-copy">
              {copyObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              Kopiera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task #859: kolumnväljare för metadatafält från svenska metadatakatalogen */}
      <Dialog open={metadataColumnsDialogOpen} onOpenChange={setMetadataColumnsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Metadatakolumner</DialogTitle>
            <DialogDescription>
              Välj vilka metadatafält som ska visas som kolumner i listan och i CSV-exporten.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Input
                placeholder="Sök fält…"
                value={metadataColumnSearch}
                onChange={(e) => setMetadataColumnSearch(e.target.value)}
                data-testid="input-metadata-column-search"
              />
              {selectedMetadataColumns.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedMetadataColumns([])}
                  data-testid="button-clear-metadata-columns"
                >
                  Rensa
                </Button>
              )}
            </div>
            <ScrollArea className="h-72 pr-3">
              <div className="space-y-1">
                {filteredCatalogForPicker.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-metadata-fields">
                    Inga metadatafält hittades.
                  </p>
                ) : (
                  filteredCatalogForPicker.map((field) => {
                    const checked = selectedMetadataColumns.includes(field.id);
                    return (
                      <label
                        key={field.id}
                        className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                        data-testid={`row-metadata-field-${field.id}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleMetadataColumn(field.id)}
                          data-testid={`checkbox-metadata-field-${field.id}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{field.namn}</div>
                          {(field.area || field.beteckning) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {[field.area, field.beteckning].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <span className="text-xs text-muted-foreground mr-auto" data-testid="text-selected-metadata-count">
              {selectedMetadataColumns.length} valda
            </span>
            <Button onClick={() => setMetadataColumnsDialogOpen(false)} data-testid="button-close-metadata-columns">
              Klar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task #681: bekräfta radering */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort objekt?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (childrenMap.get(deleteTarget.id)?.length ?? 0) > 0 ? (
                <>Objektet <span className="font-medium">{deleteTarget?.name}</span> har {childrenMap.get(deleteTarget.id)?.length} underordnade objekt. Ta bort eller flytta dessa först.</>
              ) : (
                <>Detta raderar <span className="font-medium">{deleteTarget?.name}</span> permanent. Radering är endast möjlig om objektet är helt oanvänt (inga uppgifter, ingen historik, inga underobjekt) — annars kan objektet bara arkiveras. Åtgärden kan inte ångras.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={(deleteTarget ? (childrenMap.get(deleteTarget.id)?.length ?? 0) > 0 : false) || deleteObjectMutation.isPending}
              onClick={() => { if (deleteTarget) deleteObjectMutation.mutate(deleteTarget.id); }}
              data-testid="button-confirm-delete"
            >
              {deleteObjectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!bulkBusy) setBulkDeleteOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort {selectedIds.size} markerade objekt?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta tar bort {selectedIds.size} markerade objekt. Objekt med underordnade objekt kan misslyckas. Åtgärden kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy} data-testid="button-cancel-bulk-delete">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkBusy}
              onClick={(e) => { e.preventDefault(); runBulkDelete(); }}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Ta bort markerade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={bulkParentDialogOpen} onOpenChange={(open) => { if (!bulkBusy) { setBulkParentDialogOpen(open); if (!open) setBulkNewParentId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flytta {selectedIds.size} objekt</DialogTitle>
            <DialogDescription>
              Välj nytt överordnat objekt. Markerade objekt flyttas och ärver adress från den nya föräldern. Välj "Toppnivå" för att ta bort föräldern.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal" data-testid="button-bulk-parent-select">
                  <span className="truncate">
                    {bulkNewParentId === null ? "Toppnivå (ingen förälder)" : (objectNameById.get(bulkNewParentId) ?? "Valt objekt")}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[360px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Sök objekt…" data-testid="input-bulk-parent-search" />
                  <CommandList>
                    <CommandEmpty>Inget objekt hittades.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem value="__top__" onSelect={() => setBulkNewParentId(null)} data-testid="option-bulk-parent-top">
                        <Check className={`mr-2 h-4 w-4 ${bulkNewParentId === null ? "opacity-100" : "opacity-0"}`} />
                        Toppnivå (ingen förälder)
                      </CommandItem>
                      {objects.filter(o => !selectedIds.has(o.id)).map(o => (
                        <CommandItem
                          key={o.id}
                          value={`${(o as any).displayName || o.name} ${o.objectNumber || ""}`}
                          onSelect={() => setBulkNewParentId(o.id)}
                          data-testid={`option-bulk-parent-${o.id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${bulkNewParentId === o.id ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{(o as any).displayName || o.name}{o.objectNumber ? ` (${o.objectNumber})` : ""}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={bulkBusy} onClick={() => setBulkParentDialogOpen(false)} data-testid="button-cancel-bulk-parent">Avbryt</Button>
            <Button disabled={bulkBusy} onClick={runBulkParentMove} data-testid="button-confirm-bulk-parent">
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FolderPlus className="h-4 w-4 mr-2" />}
              Flytta
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
                  <AlertTriangle className="h-4 w-4 shrink-0 text-chart-4" />
                  Geoapify API-nyckel saknas. Kontrollera att GEOAPIFY_API_KEY är konfigurerad.
                </div>
              )}

              {!batchGeoResult && (
                <>
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
                            <div className="text-2xl font-bold text-chart-4" data-testid="text-batch-geo-cost">${batchGeoPreview.estimatedCost.toFixed(2)}</div>
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
                          <Check className="h-5 w-5 text-chart-2" />
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
                          <div className="text-2xl font-bold text-chart-2">{batchGeoResult.geocoded}</div>
                          <div className="text-xs text-muted-foreground">Geocodade</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-chart-1">{batchGeoResult.updated}</div>
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
                        <div className="text-2xl font-bold text-chart-1" data-testid="text-explore-filtered">
                          {exploreData.objects.length > 0 ? exploreData.objects.length.toLocaleString("sv-SE") : exploreData.filteredCount.toLocaleString("sv-SE")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {exploreData.objects.length > 0 ? "Visar på karta" : `Matchade${exploreCity ? ` i ${exploreCity}` : ""}`}
                        </div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-chart-2" data-testid="text-explore-entrance">{exploreData.withEntrance.toLocaleString("sv-SE")}</div>
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

      <Dialog open={batchFillCityOpen} onOpenChange={(v) => { if (!batchFillCityRunning) { setBatchFillCityOpen(v); setBatchFillCityResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Fyll i stad automatiskt
            </DialogTitle>
            <DialogDescription>
              Fyller i stad på objekt som saknar stadsuppgift via postnummeruppslag eller omvänd geocoding.
            </DialogDescription>
          </DialogHeader>

          {batchFillCityPreview ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md border text-center">
                  <div className="text-2xl font-bold text-chart-4" data-testid="text-missing-city-total">{batchFillCityPreview.totalMissingCity.toLocaleString("sv")}</div>
                  <div className="text-xs text-muted-foreground">Saknar stad</div>
                </div>
                <div className="p-3 rounded-md border text-center">
                  <div className="text-2xl font-bold text-chart-2" data-testid="text-resolvable-count">
                    {(batchFillCityPreview.totalMissingCity - batchFillCityPreview.noResolvableInfo).toLocaleString("sv")}
                  </div>
                  <div className="text-xs text-muted-foreground">Kan fyllas i</div>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Via postnummer</span>
                  <span className="font-medium">{batchFillCityPreview.withPostalCode.toLocaleString("sv")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Via koordinater</span>
                  <span className="font-medium">{batchFillCityPreview.withCoordinates.toLocaleString("sv")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Via adress</span>
                  <span className="font-medium">{batchFillCityPreview.withAddress.toLocaleString("sv")}</span>
                </div>
                {batchFillCityPreview.noResolvableInfo > 0 && (
                  <div className="flex justify-between text-chart-4">
                    <span>Kan ej avgöras</span>
                    <span className="font-medium">{batchFillCityPreview.noResolvableInfo.toLocaleString("sv")}</span>
                  </div>
                )}
              </div>

              {batchFillCityPreview.byPostalPrefix.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Postnummerområden</p>
                  <div className="flex flex-wrap gap-1">
                    {batchFillCityPreview.byPostalPrefix.slice(0, 15).map(({ prefix, count }) => (
                      <Badge key={prefix} variant="secondary" className="text-xs">{prefix}xx ({count})</Badge>
                    ))}
                    {batchFillCityPreview.byPostalPrefix.length > 15 && (
                      <Badge variant="outline" className="text-xs">+{batchFillCityPreview.byPostalPrefix.length - 15} till</Badge>
                    )}
                  </div>
                </div>
              )}

              {batchFillCityResult && (
                <div className="p-3 rounded-md bg-chart-2/10 dark:bg-chart-2/15 border border-chart-2/20 dark:border-chart-2/80 space-y-1">
                  <div className="flex items-center gap-2 text-chart-2">
                    <Check className="h-4 w-4" />
                    <span className="font-medium">Batch-ifyllnad klar</span>
                  </div>
                  <div className="text-sm text-chart-2">
                    {batchFillCityResult.updated} av {batchFillCityResult.total} objekt fick stad ifylld.
                    {batchFillCityResult.remaining > 0 && ` ${batchFillCityResult.remaining} kunde inte avgöras.`}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchFillCityOpen(false)} disabled={batchFillCityRunning} data-testid="button-close-fill-city">
              Stäng
            </Button>
            <Button
              onClick={handleBatchFillCity}
              disabled={batchFillCityRunning || !batchFillCityPreview || batchFillCityPreview.totalMissingCity === 0 || !!batchFillCityResult}
              data-testid="button-run-fill-city"
            >
              {batchFillCityRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
              {batchFillCityRunning ? "Fyller i stad..." : "Starta batch-ifyllnad"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {overflowPanel && (() => {
        const panelObj = objects.find(o => o.id === overflowPanel.objectId);
        if (!panelObj) return null;
        const closePanel = () => setOverflowPanel(null);
        switch (overflowPanel.panel) {
          case "parents":
            return <ObjectParentsPanel object={panelObj} controlled open onOpenChange={(v) => { if (!v) closePanel(); }} />;
          default:
            return null;
        }
      })()}

      <Dialog open={servicePatternDialog.open} onOpenChange={(v) => { if (!v) setServicePatternDialog({ open: false, loading: false }); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-service-pattern-title">
              <BarChart3 className="h-5 w-5 text-chart-1" />
              Servicemönster — AI-analys
            </DialogTitle>
            <DialogDescription>Analys av servicehistorik och mönster för filtrerade objekt</DialogDescription>
          </DialogHeader>
          {servicePatternDialog.loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-chart-5" />
              <p className="text-sm text-muted-foreground">AI analyserar servicemönster...</p>
            </div>
          ) : servicePatternDialog.data && (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-chart-5/15 dark:bg-chart-5/40 border border-chart-5/50 dark:border-chart-5/40">
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
                    <AlertTriangle className="h-3.5 w-3.5 text-chart-4" />
                    Avvikande objekt ({servicePatternDialog.data.anomalies.length})
                  </p>
                  {servicePatternDialog.data.anomalies.map((a, i) => (
                    <div key={i} className="p-2 rounded-md bg-chart-4/15 dark:bg-chart-4/40 border border-chart-4/50 dark:border-chart-4/40">
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

      <Dialog open={maintenanceDialog.open} onOpenChange={(v) => { if (!v) setMaintenanceDialog({ open: false, loading: false }); }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-maintenance-title">
              <Clock className="h-5 w-5 text-chart-2" />
              Underhållsprognoser
            </DialogTitle>
            <DialogDescription>Predikterade servicebehov baserat på historisk data</DialogDescription>
          </DialogHeader>
          {maintenanceDialog.loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-chart-5" />
              <p className="text-sm text-muted-foreground">Beräknar underhållsprognoser...</p>
            </div>
          ) : maintenanceDialog.data && (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-chart-2/15 dark:bg-chart-2/40 border border-chart-2/50 dark:border-chart-2/40">
                <p className="text-sm" data-testid="text-maintenance-summary">{maintenanceDialog.data.summary}</p>
              </div>
              {maintenanceDialog.data.overdue.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive uppercase tracking-wide flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-chart-4" />
                    Försenade ({maintenanceDialog.data.overdue.length})
                  </p>
                  {maintenanceDialog.data.overdue.map((item, i) => (
                    <div key={i} className="flex justify-between items-center p-2 rounded-md bg-destructive/15 dark:bg-destructive/40 border border-destructive/50 dark:border-destructive/40">
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
