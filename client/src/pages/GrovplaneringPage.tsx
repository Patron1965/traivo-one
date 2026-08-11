import { useEffect, useMemo, useState } from "react";
import { format as formatDate, isSameWeek } from "date-fns";
import {
  useQuery,
  useMutation,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RoughSummaryCard } from "@/components/grovplanering/RoughSummaryCard";
import { TeamDeviationsPanel } from "@/components/grovplanering/TeamDeviationsPanel";
import {
  RoughFilterPanel,
  createDefaultFilter,
  type FilterState,
  type GridDateField,
} from "@/components/grovplanering/RoughFilterPanel";
import { SavedFilterLibrary } from "@/components/grovplanering/SavedFilterLibrary";
import type { ConditionFilter } from "@/components/orderkoncept/shared/ConditionFilter";
import { RoughGridTable } from "@/components/grovplanering/RoughGridTable";
import type { TaskClusters } from "@/components/grovplanering/RoughGridTable";
import { HierarchyTable } from "@/components/grovplanering/HierarchyTable";
import { RoughAssignModal } from "@/components/grovplanering/RoughAssignModal";
import { ClusterSidePanel, type ClusterRef } from "@/components/clustering/ClusterSidePanel";
import { EngineRunControl } from "@/components/grovplanering/EngineRunControl";
import { EngineResultsView } from "@/components/grovplanering/EngineResultsView";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClusterListView } from "@/components/clustering/ClusterListView";
import { ClusterMapView } from "@/components/clustering/ClusterMapView";
import type { EngineResultsResponse } from "@/lib/engine-results";
import {
  ROUGH_STATUS_ORDER,
  ROUGH_STATUS_META,
  resolvePeriodRange,
  formatCount,
  type GridResponse,
  type GridTaskRow,
  type GridGroup,
  type GridKpis,
  type GroupBy,
  type RoughStatus,
} from "@/lib/rough-planning";
import type { Team, GeographicDistrict } from "@shared/schema";
import { AdvancedFilterBar } from "@/components/filters/AdvancedFilterBar";
import { GROVPLANERING_FILTER_FIELDS } from "@/lib/filter-fields-grovplanering";
import { emptyFilterGroup, evaluateFilterGroup, visibleFieldsForRole, type FilterGroup } from "@shared/filter-engine";
import { useAuth } from "@/hooks/use-auth";

interface AppliedFilter {
  districtIds: string[];
  teamIds: string[];
  postalCode: string;
  city: string;
  from?: string;
  to?: string;
  // Uppgiftsnavet: valbart datumfält + tidskod/kund/resurs.
  dateField: GridDateField;
  timeCodes: string[];
  customerIds: string[];
  resourceIds: string[];
  articleTypes: string[];
  statuses: RoughStatus[];
  executionCodes: string[];
  // Task #1410: objekturval via metadatavillkor (delade motorn med objektlistan).
  conditions: ConditionFilter[];
  // Task #1533: förfiltrering på ett rotobjekt (inkl. hela subträdet) — sätts
  // via ?objectId= i adressraden (länken "Öppna i Uppgiftsnavet" på objektsidan).
  // Ingår inte i det persisterade filterutkastet; rensas via chip eller "Rensa".
  objectId?: string;
}

const EMPTY_APPLIED: AppliedFilter = {
  districtIds: [],
  teamIds: [],
  postalCode: "",
  city: "",
  dateField: "onskad",
  timeCodes: [],
  customerIds: [],
  resourceIds: [],
  articleTypes: [],
  statuses: [],
  executionCodes: [],
  conditions: [],
};

const EMPTY_KPIS: GridKpis = {
  productionMinutes: 0,
  value: 0,
  cost: 0,
  taskCount: 0,
  objectCount: 0,
};

// Exportkolumner (Task #1000) — håll nycklar i synk med
// GROV_EXPORT_COLUMN_ORDER i server/grovplanering-grid.ts. Standardurvalet =
// alla kolumner (nuvarande fasta kolumnset).
type ExportColumnKey =
  | "group"
  | "status"
  | "customer"
  | "object"
  | "task"
  | "articleType"
  | "executionCode"
  | "desiredDelivery"
  | "productionMinutes"
  | "productionHours"
  | "team"
  | "week"
  | "value"
  | "cost";

const EXPORT_COLUMNS: { key: ExportColumnKey; label: string }[] = [
  { key: "group", label: "Grupp" },
  { key: "status", label: "Status" },
  { key: "customer", label: "Kund" },
  { key: "object", label: "Objekt" },
  { key: "task", label: "Uppgift" },
  { key: "articleType", label: "Artikeltyp" },
  { key: "executionCode", label: "Utförandekod" },
  { key: "desiredDelivery", label: "Önskad leverans" },
  { key: "productionMinutes", label: "Produktionstid (min)" },
  { key: "productionHours", label: "Produktionstid (tim)" },
  { key: "team", label: "Team" },
  { key: "week", label: "Vecka" },
  { key: "value", label: "Ordervärde (kr)" },
  { key: "cost", label: "Kostnad (kr)" },
];

const ALL_EXPORT_COLUMN_KEYS = EXPORT_COLUMNS.map((c) => c.key);
const EXPORT_COLUMNS_STORAGE_KEY = "grovplanering.exportColumns.v1";

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "objekt", label: "Objekt" },
  { value: "kund", label: "Kund" },
  { value: "orderkoncept", label: "Orderkoncept" },
  { value: "ingen", label: "Ingen" },
];

function buildFilterParams(applied: AppliedFilter, groupBy: GroupBy): URLSearchParams {
  const p = new URLSearchParams();
  p.set("groupBy", groupBy);
  if (applied.districtIds.length) p.set("districtIds", applied.districtIds.join(","));
  if (applied.teamIds.length) p.set("teamIds", applied.teamIds.join(","));
  if (applied.postalCode) p.set("postalCode", applied.postalCode);
  if (applied.city) p.set("city", applied.city);
  if (applied.from) p.set("from", applied.from);
  if (applied.to) p.set("to", applied.to);
  if (applied.dateField && applied.dateField !== "onskad")
    p.set("dateField", applied.dateField);
  if (applied.timeCodes.length) p.set("timeCodes", applied.timeCodes.join(","));
  if (applied.customerIds.length) p.set("customerIds", applied.customerIds.join(","));
  if (applied.resourceIds.length) p.set("resourceIds", applied.resourceIds.join(","));
  if (applied.articleTypes.length) p.set("articleTypes", applied.articleTypes.join(","));
  if (applied.statuses.length) p.set("statuses", applied.statuses.join(","));
  if (applied.executionCodes.length)
    p.set("executionCodes", applied.executionCodes.join(","));
  // Task #1410: metadatavillkoren skickas server-side (samma ?conditions=-format
  // som objektlistan) och matchas där via den delade villkorsmotorn.
  if (applied.conditions.length)
    p.set("conditions", JSON.stringify(applied.conditions));
  // Task #1533: rotobjekt-scope (servern expanderar till hela subträdet).
  if (applied.objectId) p.set("objectId", applied.objectId);
  return p;
}

function buildGridUrl(
  applied: AppliedFilter,
  groupBy: GroupBy,
  offset: number,
  limit: number,
): string {
  const p = buildFilterParams(applied, groupBy);
  p.set("offset", String(offset));
  p.set("limit", String(limit));
  return `/api/rough-planning/grid?${p.toString()}`;
}

// Persistens av filter-state över sidladdningar (spec: "Filter-state sparas").
const FILTER_STORAGE_KEY = "grovplanering.filter.v1";

// Läs sparat exportkolumn-urval; faller tillbaka till alla kolumner.
function loadExportColumns(): ExportColumnKey[] {
  try {
    const raw = localStorage.getItem(EXPORT_COLUMNS_STORAGE_KEY);
    if (!raw) return [...ALL_EXPORT_COLUMN_KEYS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...ALL_EXPORT_COLUMN_KEYS];
    const valid = ALL_EXPORT_COLUMN_KEYS.filter((k) => parsed.includes(k));
    return valid.length ? valid : [...ALL_EXPORT_COLUMN_KEYS];
  } catch {
    return [...ALL_EXPORT_COLUMN_KEYS];
  }
}

// Härled applicerbart filter från utkastet — delas av applyFilters och
// återställning vid mount så att de alltid är identiska.
function deriveApplied(draft: FilterState): AppliedFilter {
  const { from, to } = resolvePeriodRange(
    draft.periodMode,
    new Date(draft.anchor),
    draft.rangeFrom,
    draft.rangeTo,
  );
  return {
    districtIds: draft.districtIds,
    teamIds: draft.teamIds,
    postalCode: draft.postalCode.trim(),
    city: draft.city,
    from,
    to,
    dateField: draft.dateField ?? "onskad",
    timeCodes: draft.timeCodes ?? [],
    customerIds: draft.customerIds ?? [],
    resourceIds: draft.resourceIds ?? [],
    articleTypes: draft.articleTypes ?? [],
    statuses: draft.statuses,
    executionCodes: draft.executionCodes,
    // Endast kompletta villkor (valt fält) skickas till servern.
    conditions: draft.conditions.filter((c) => c.metadataKey),
  };
}

function loadPersistedFilter(): FilterState | null {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    // Merga över defaults så att tillkommande/borttagna nycklar inte korrumperar formen.
    return { ...createDefaultFilter(), ...(JSON.parse(raw) as Partial<FilterState>) };
  } catch {
    return null;
  }
}

function persistFilter(draft: FilterState): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* localStorage kan vara blockerad (privat läge) — ignorera tyst */
  }
}

function clearPersistedFilter(): void {
  try {
    localStorage.removeItem(FILTER_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function pageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export default function GrovplaneringPage() {
  const { toast } = useToast();

  const [view, setView] = useState<"manuell" | "motor" | "klump" | "karta">("manuell");
  const [listMode, setListMode] = useState<"lista" | "hierarki">("lista");
  const [groupBy, setGroupBy] = useState<GroupBy>("objekt");
  const [pageSize, setPageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const [draft, setDraft] = useState<FilterState>(
    () => loadPersistedFilter() ?? createDefaultFilter(),
  );
  const [applied, setApplied] = useState<AppliedFilter>(() => {
    const persisted = loadPersistedFilter();
    const base = persisted ? deriveApplied(persisted) : EMPTY_APPLIED;
    // Task #1533: ?objectId= i adressraden förfiltrerar på objektet + subträdet.
    const objectId = new URLSearchParams(window.location.search).get("objectId");
    return objectId ? { ...base, objectId } : base;
  });

  // Task #1533: namn för objekt-scope-chippen (endast när scope är satt).
  const { data: scopeObject } = useQuery<{ name?: string | null; objectNumber?: string | null }>({
    // Egen key-form ("detail"-suffix) så att den aldrig kolliderar med den
    // globala objektlistans ["/api/objects", ...]-nycklar i cachen.
    queryKey: ["/api/objects", applied.objectId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${applied.objectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta objektet");
      return res.json();
    },
    enabled: !!applied.objectId,
  });

  // Delad vecko-/dagkälla för kartvyn (MapTimeline/ClusterWeekSlider) och
  // rutnätets periodfilter — lyft hit så veckobyte i en vy speglas i den andra
  // och överlever flikbyten. Initieras från det persisterade filtrets ankare.
  const [weekRef, setWeekRef] = useState<Date>(() => {
    const persisted = loadPersistedFilter();
    const d = persisted ? new Date(persisted.anchor) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  });
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const [advancedFilter, setAdvancedFilter] = useState<FilterGroup>(() => emptyFilterGroup());
  const { user: currentUser } = useAuth() as { user?: { role?: string | null } };
  const currentRole = currentUser?.role ?? null;

  const [selected, setSelected] = useState<Map<string, GridTaskRow>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openCluster, setOpenCluster] = useState<ClusterRef | null>(null);
  const [mapFocusCluster, setMapFocusCluster] = useState<ClusterRef | null>(null);

  const [assignTarget, setAssignTarget] = useState<GridTaskRow[] | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<
    { ids: string[]; label: string } | null
  >(null);

  // Referensdata.
  const { data: teams = [] } = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const { data: districts = [] } = useQuery<GeographicDistrict[]>({
    queryKey: ["/api/districts"],
  });
  const { data: cities = [] } = useQuery<string[]>({
    queryKey: ["/api/rough-planning/cities"],
  });

  // Rutnät.
  const hasAdvancedFilter = advancedFilter.conditions.length > 0;
  // Task #1240: när avancerat filter är aktivt måste vi filtrera mot HELA den
  // grovfiltrerade mängden, inte bara den redan sid-beskurna 20-raders-sidan —
  // annars missar filtret matchande rader utanför nuvarande sida och
  // totalsumman/sidantalet blir missvisande. Servern (GET /api/rough-planning/grid)
  // tak:ar limit på 200; det täcker den typiska grovplaneringsvolymen per
  // grov-filter men är en känd gräns tills en server-side filterevaluator finns
  // (uppföljning: full 94-fälts-motor server-side, se follow-up #1251).
  const fetchLimit = hasAdvancedFilter ? 200 : pageSize;
  const fetchOffset = hasAdvancedFilter ? 0 : offset;
  const gridUrl = buildGridUrl(applied, groupBy, fetchOffset, fetchLimit);
  const {
    data,
    isLoading,
    isError,
    isFetching,
  } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", applied, groupBy, fetchOffset, fetchLimit],
    queryFn: async () => (await apiRequest("GET", gridUrl)).json(),
    placeholderData: keepPreviousData,
  });

  // Task #1240: klient-sidan finfiltrering ovanpå serverns grov-filter/gruppering,
  // via den delade filtermotorn. Grupper utan kvarvarande rader döljs helt.
  const rawGroups: GridGroup[] = data?.groups ?? [];
  const filteredGroups: GridGroup[] = useMemo(() => {
    if (!hasAdvancedFilter) return rawGroups;
    // Säkerhet: evaluera ENBART mot fält den inloggade rollen får se/söka på —
    // annars kan ett sparat/delat filter läcka ekonomifält till roller som
    // inte ska ha åtkomst (villkoret skulle annars fortfarande matcha).
    const allowedFields = visibleFieldsForRole(GROVPLANERING_FILTER_FIELDS, currentRole);
    const allowedKeys = new Set(allowedFields.map((f) => f.key));
    const safeFilter: FilterGroup = {
      ...advancedFilter,
      conditions: advancedFilter.conditions.filter((c) => allowedKeys.has(c.field)),
    };
    return rawGroups
      .map((g) => ({
        ...g,
        tasks: g.tasks.filter((t) => evaluateFilterGroup(t, safeFilter, allowedFields)),
      }))
      .filter((g) => g.tasks.length > 0);
  }, [rawGroups, advancedFilter, currentRole, hasAdvancedFilter]);

  const total = hasAdvancedFilter
    ? filteredGroups.reduce((n, g) => n + g.tasks.length, 0)
    : (data?.pagination.total ?? 0);

  // Vid avancerat filter pagineras klient-sidan ovanpå den fullständigt
  // finfiltrerade mängden (se ovan) — annars styr servern fortfarande sidan.
  const groups: GridGroup[] = useMemo(() => {
    if (!hasAdvancedFilter) return filteredGroups;
    let remainingSkip = offset;
    let remainingTake = pageSize;
    const page: GridGroup[] = [];
    for (const g of filteredGroups) {
      if (remainingTake <= 0) break;
      let tasks = g.tasks;
      if (remainingSkip > 0) {
        if (remainingSkip >= tasks.length) {
          remainingSkip -= tasks.length;
          continue;
        }
        tasks = tasks.slice(remainingSkip);
        remainingSkip = 0;
      }
      const taken = tasks.slice(0, remainingTake);
      remainingTake -= taken.length;
      if (taken.length > 0) page.push({ ...g, tasks: taken });
    }
    return page;
  }, [filteredGroups, hasAdvancedFilter, offset, pageSize]);

  const summary = data?.summary ?? EMPTY_KPIS;

  // Batch-hämta klump-memberships för synliga uppgifter (manuell vy).
  const visibleTaskIds = useMemo(
    () => groups.flatMap((g) => g.tasks.map((t) => t.id)),
    [groups],
  );
  const membershipIdsKey = visibleTaskIds.slice(0, 200).sort().join(",");
  const { data: membershipData } = useQuery<Record<string, TaskClusters>>({
    queryKey: ["/api/clustering/task-memberships", membershipIdsKey],
    queryFn: async () => {
      if (visibleTaskIds.length === 0) return {};
      const params = new URLSearchParams({
        workOrderIds: visibleTaskIds.slice(0, 200).join(","),
      });
      return (await apiRequest("GET", `/api/clustering/task-memberships?${params}`)).json();
    },
    enabled: visibleTaskIds.length > 0,
  });

  const getTaskClusters = (taskId: string): TaskClusters | undefined =>
    membershipData?.[taskId];

  // Hierarki-vy: hämta platt lista (ingen gruppering, hög limit) när hierarki-läget är aktivt.
  // buildHierarchy() grupperar klient-sidan efter routeClusterId/stopClusterId.
  // Avancerat filter appliceras klient-sidan (samma logik som filteredGroups) för filterparity.
  const hierarchyFilterParams = useMemo(() => {
    const p = buildFilterParams(applied, "ingen");
    p.set("limit", "2000");
    p.set("offset", "0");
    return p.toString();
  }, [applied]);

  const {
    data: hierarchyData,
    isLoading: hierarchyLoading,
    isError: hierarchyError,
  } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", "hierarki", applied],
    queryFn: async () =>
      (await apiRequest("GET", `/api/rough-planning/grid?${hierarchyFilterParams}`)).json(),
    enabled: view === "manuell" && listMode === "hierarki",
    placeholderData: keepPreviousData,
  });

  const hierarchyTasks = useMemo(() => {
    const rawTasks = (hierarchyData?.groups ?? []).flatMap((g) => g.tasks);
    if (!hasAdvancedFilter) return rawTasks;
    const allowedFields = visibleFieldsForRole(GROVPLANERING_FILTER_FIELDS, currentRole);
    const allowedKeys = new Set(allowedFields.map((f) => f.key));
    const safeFilter: FilterGroup = {
      ...advancedFilter,
      conditions: advancedFilter.conditions.filter((c) => allowedKeys.has(c.field)),
    };
    return rawTasks.filter((t) => evaluateFilterGroup(t, safeFilter, allowedFields));
  }, [hierarchyData, hasAdvancedFilter, advancedFilter, currentRole]);

  // Trunkeringsindikation: servern skickade färre rader än totalen (limit- eller radtak).
  const hierarchyLoadedCount = useMemo(
    () => (hierarchyData?.groups ?? []).reduce((sum, g) => sum + g.tasks.length, 0),
    [hierarchyData],
  );
  const hierarchyTruncated =
    !!hierarchyData &&
    (hierarchyData.truncated || hierarchyData.pagination.total > hierarchyLoadedCount);

  // Motorns förslag (Task #1039) — läses on-demand, separat från work_order-rutnätet.
  const {
    data: engineData,
    isLoading: engineLoading,
    isError: engineError,
    refetch: refetchEngine,
  } = useQuery<EngineResultsResponse>({
    queryKey: ["/api/rough-planning/engine-results"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/rough-planning/engine-results")).json(),
  });

  // Visa färska motorförslag direkt när planeraren öppnar fliken (Task #1042):
  // hämta om read-modellen vid byte till motor-vyn så körningar gjorda i en annan
  // flik/session syns — utan att köra om motorn (den förblir on-demand, #1038).
  const openMotorView = () => {
    setView("motor");
    void refetchEngine();
  };

  // Selektion. I hierarki-läget används hierarchyTasks som underlag.
  const visibleRows = useMemo(
    () =>
      listMode === "hierarki"
        ? hierarchyTasks
        : groups.flatMap((g) => g.tasks),
    [listMode, hierarchyTasks, groups],
  );
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  const toggleRow = (row: GridTaskRow) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });

  const toggleGroup = (group: GridGroup, checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const t of group.tasks) {
        if (checked) next.set(t.id, t);
        else next.delete(t.id);
      }
      return next;
    });

  // "Markera grupp": markera ALLA rader i gruppen över alla sidor (Task #922).
  // Hämtar hela gruppens rader serverside (samma filter/gruppering) och slår ihop
  // dem i urvalet — inte bara den synliga sidans rader.
  const [selectingGroupKey, setSelectingGroupKey] = useState<string | null>(null);
  const selectWholeGroup = async (group: GridGroup) => {
    setSelectingGroupKey(group.key);
    try {
      const p = buildFilterParams(applied, groupBy);
      p.set("groupKey", group.key);
      const res = await apiRequest(
        "GET",
        `/api/rough-planning/group-rows?${p.toString()}`,
      );
      const data = (await res.json()) as { rows: GridTaskRow[] };
      setSelected((prev) => {
        const next = new Map(prev);
        for (const r of data.rows) next.set(r.id, r);
        return next;
      });
    } catch (err) {
      toast({
        title: "Kunde inte markera gruppen",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSelectingGroupKey(null);
    }
  };

  const toggleAllVisible = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of visibleRows) {
        if (checked) next.set(r.id, r);
        else next.delete(r.id);
      }
      return next;
    });

  const clearSelection = () => setSelected(new Map());

  // Excel-export av den aktuellt filtrerade listan. Speglar samma filter/gruppering
  // som rutnätet (samma query-params) — servern paginerar inte exporten.
  const [exporting, setExporting] = useState(false);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState<ExportColumnKey[]>(
    () => loadExportColumns(),
  );

  const toggleExportColumn = (key: ExportColumnKey, checked: boolean) =>
    setExportColumns((prev) => {
      const next = checked
        ? ALL_EXPORT_COLUMN_KEYS.filter((k) => prev.includes(k) || k === key)
        : prev.filter((k) => k !== key);
      try {
        localStorage.setItem(EXPORT_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota/serialisering */
      }
      return next;
    });

  const resetExportColumns = () => {
    setExportColumns([...ALL_EXPORT_COLUMN_KEYS]);
    try {
      localStorage.removeItem(EXPORT_COLUMNS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const exportToExcel = async () => {
    setExporting(true);
    try {
      const p = buildFilterParams(applied, groupBy);
      if (exportColumns.length > 0) p.set("columns", exportColumns.join(","));
      const res = await apiRequest(
        "GET",
        `/api/rough-planning/export?${p.toString()}`,
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `traivo-grovplanering-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "Kunde inte exportera",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const exportToCsv = async (scope: "all" | "selected" = "all") => {
    setExporting(true);
    try {
      const p = buildFilterParams(applied, groupBy);
      if (scope === "selected" && selected.size > 0) {
        p.set("workOrderIds", Array.from(selected.keys()).join(","));
      }
      const res = await fetch(`/api/rough-planning/export-csv?${p.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "Okänt fel");
        throw new Error(errText);
      }
      const truncated = res.headers.get("X-Truncated") === "true";
      const rowCount = res.headers.get("X-Row-Count");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Bevara filnamn från servern (inkl. filter-suffix) om tillgängligt
      const cd = res.headers.get("Content-Disposition") ?? "";
      const cdMatch = cd.match(/filename="([^"]+)"/);
      const datestamp = new Date().toISOString().slice(0, 10);
      a.download = cdMatch ? cdMatch[1] : `navet-export-${datestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (truncated && rowCount) {
        toast({
          title: "Export trunkerad",
          description: `Filen innehåller ${rowCount} rader (max 15 000). Förfina filtret för fullständig export.`,
          variant: "default",
        });
      }
    } catch (err) {
      toast({
        title: "Kunde inte exportera CSV",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectionKpis: GridKpis = useMemo(() => {
    const objs = new Set<string>();
    let pm = 0;
    let v = 0;
    let c = 0;
    for (const r of Array.from(selected.values())) {
      pm += r.productionMinutes;
      v += r.value;
      c += r.cost;
      if (r.objectId) objs.add(r.objectId);
    }
    return {
      productionMinutes: pm,
      value: v,
      cost: c,
      taskCount: selected.size,
      objectCount: objs.size,
    };
  }, [selected]);

  const selectedTilldeladCount = useMemo(
    () =>
      Array.from(selected.values()).filter((r) => r.status === "tilldelad")
        .length,
    [selected],
  );

  // Filter apply/clear.
  const applyFilters = () => {
    // Behåll ev. objekt-scope (chip) tills det rensas explicit.
    setApplied({ ...deriveApplied(draft), objectId: applied.objectId });
    setOffset(0);
    persistFilter(draft);
  };

  const clearFilters = () => {
    setDraft(createDefaultFilter());
    setApplied(EMPTY_APPLIED);
    setOffset(0);
    clearPersistedFilter();
  };

  // Kartvyn byter vecka → spegla in i rutnätets periodfilter (ankare) när
  // filtret står i veckoläge, så båda vyerna visar samma aktiva vecka.
  const handleWeekChange = (d: Date) => {
    setWeekRef(d);
    if (draft.periodMode === "vecka" && !isSameWeek(d, new Date(draft.anchor), { weekStartsOn: 1 })) {
      // Lokal datumformattering — toISOString() är UTC och kan skifta
      // måndag 00:00 (CET/CEST) till föregående dag/vecka.
      const nextDraft = { ...draft, anchor: formatDate(d, "yyyy-MM-dd") };
      setDraft(nextDraft);
      setApplied({ ...deriveApplied(nextDraft), objectId: applied.objectId });
      setOffset(0);
      persistFilter(nextDraft);
    }
  };

  // Rutnätets periodankare byter vecka → spegla in i kartvyns vecka.
  useEffect(() => {
    if (draft.periodMode !== "vecka") return;
    const anchorDate = new Date(draft.anchor);
    if (isNaN(anchorDate.getTime())) return;
    setWeekRef((prev) =>
      isSameWeek(prev, anchorDate, { weekStartsOn: 1 }) ? prev : anchorDate,
    );
  }, [draft.anchor, draft.periodMode]);

  // Återställ sida vid grupperings-/sidstorleksbyte.
  useEffect(() => {
    setOffset(0);
  }, [groupBy, pageSize]);

  // Mutationer.
  const assignMutation = useMutation({
    mutationFn: async (vars: {
      ids: string[];
      week: string;
      teamId: string;
      kommentar: string;
    }) => {
      const res = await apiRequest("POST", "/api/work-orders/bulk-rough-plan", {
        workOrderIds: vars.ids,
        roughPlannedWeek: vars.week,
        teamId: vars.teamId,
        kommentar: vars.kommentar || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Uppgifter tilldelade" });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      clearSelection();
      setAssignTarget(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte tilldela",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/rough-planning/revoke", {
        workOrderIds: ids,
      });
      return res.json() as Promise<{ updated: number; skipped: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Tilldelning återkallad",
        description:
          result.skipped > 0
            ? `${result.updated} återkallade, ${result.skipped} hoppades över (ej tilldelade).`
            : `${result.updated} återkallade.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      clearSelection();
      setRevokeTarget(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte återkalla",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageSize, total);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        icon={CalendarRange}
        title="Uppgiftsnav"
        description="Filtrera, gruppera och tilldela uppgifter till team och veckor."
      />

      {/* Summeringskort */}
      <div className="grid gap-3 lg:grid-cols-2">
        <RoughSummaryCard
          title="Summering — enligt filter"
          kpis={summary}
          variant="filter"
          testIdPrefix="summary-filter"
        />
        <RoughSummaryCard
          title="Summering — markerade"
          kpis={selectionKpis}
          variant="selection"
          testIdPrefix="summary-selection"
        />
      </div>

      <TeamDeviationsPanel teams={teams.map((t) => ({ id: t.id, name: t.name }))} periodAnchor={applied.from} />

      {/* Filterbibliotek — namngivna sparade filterkombinationer (Uppgiftsnavet) */}
      <div className="flex justify-end">
        <SavedFilterLibrary
          current={draft}
          onApply={(next) => {
            setDraft(next);
            setApplied({ ...deriveApplied(next), objectId: applied.objectId });
            setOffset(0);
            persistFilter(next);
          }}
        />
      </div>

      {/* Task #1533: objekt-scope-chip (?objectId= från objektsidan). */}
      {applied.objectId && (
        <div className="flex items-center gap-2" data-testid="chip-object-scope">
          <Badge variant="secondary" className="gap-1.5 pr-1">
            Objekt: {scopeObject?.name || scopeObject?.objectNumber || applied.objectId.slice(0, 8)}
            <span className="text-muted-foreground font-normal">inkl. underordnade</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-4 w-4 p-0"
              onClick={() => {
                setApplied((prev) => ({ ...prev, objectId: undefined }));
                setOffset(0);
              }}
              aria-label="Ta bort objektfilter"
              data-testid="button-clear-object-scope"
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        </div>
      )}

      {/* Filterpanel */}
      <RoughFilterPanel
        value={draft}
        onChange={setDraft}
        districts={districts.map((d) => ({ id: d.id, name: d.name }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        cities={cities}
        onApply={applyFilters}
        onClear={clearFilters}
        isFetching={isFetching}
      />

      {/* Avancerat filter (Task #1240) — delad filtermotor, sparade/delade filter */}
      <AdvancedFilterBar
        scope="uppgiftsnav"
        fields={GROVPLANERING_FILTER_FIELDS}
        value={advancedFilter}
        onChange={(g) => {
          setAdvancedFilter(g);
          setOffset(0);
        }}
      />

      {/* Motorns körkontroll — intill filtret (Task #1039) */}
      <EngineRunControl
        lastRunAt={engineData?.lastRunAt ?? null}
        onRan={openMotorView}
      />

      {/* Vy-växel: manuell lista / motorns förslag / förslagsvy / kartvy */}
      <Tabs
        value={view}
        onValueChange={(v) => {
          const next = v as "manuell" | "motor" | "klump" | "karta";
          if (next === "motor") openMotorView();
          else setView(next);
        }}
      >
        <TabsList data-testid="tabs-grov-view">
          <TabsTrigger value="manuell" data-testid="tab-manuell">
            Manuell lista
          </TabsTrigger>
          <TabsTrigger value="motor" data-testid="tab-motor">
            Motorns förslag
            {engineData?.hasResults
              ? ` (${formatCount(engineData.summary.taskCount)})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="klump" data-testid="tab-klump">
            Förslagsvy
          </TabsTrigger>
          <TabsTrigger value="karta" data-testid="tab-karta">
            Karta
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "motor" ? (
        engineLoading ? (
          <div className="flex items-center justify-center rounded-lg border py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Laddar motorns förslag…
          </div>
        ) : engineError ? (
          <div
            className="rounded-lg border py-16 text-center text-destructive"
            data-testid="text-engine-error"
          >
            Kunde inte ladda motorns förslag. Försök igen.
          </div>
        ) : (
          <EngineResultsView
            data={
              engineData ?? {
                hasResults: false,
                lastRunAt: null,
                periodStart: null,
                periodEnd: null,
                summary: {
                  taskCount: 0,
                  clumpCount: 0,
                  standaloneCount: 0,
                  valueOre: 0,
                  costOre: 0,
                  durationMinutes: 0,
                },
                clumps: [],
                standalone: [],
              }
            }
          />
        )
      ) : view === "klump" ? (
        <ClusterListView />
      ) : view === "karta" ? (
        <ClusterMapView
          focusCluster={mapFocusCluster}
          weekRef={weekRef}
          onWeekChange={handleWeekChange}
          selectedDay={selectedDay}
          onDayChange={setSelectedDay}
        />
      ) : (
        <>
      {/* Gruppering & Åtgärder */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Listläge-växel: Lista | Hierarki */}
            <div className="flex items-center rounded-md border p-0.5 gap-0.5" data-testid="toggle-listmode">
              <Button
                size="sm"
                variant={listMode === "lista" ? "default" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setListMode("lista")}
                data-testid="button-listmode-lista"
              >
                Lista
              </Button>
              <Button
                size="sm"
                variant={listMode === "hierarki" ? "default" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setListMode("hierarki")}
                data-testid="button-listmode-hierarki"
              >
                Hierarki
              </Button>
            </div>

            {listMode === "lista" && (
              <>
                <span className="text-sm font-medium">Gruppera per:</span>
                <RadioGroup
                  value={groupBy}
                  onValueChange={(v) => setGroupBy(v as GroupBy)}
                  className="flex flex-wrap items-center gap-4"
                  data-testid="radiogroup-groupby"
                >
                  {GROUP_OPTIONS.map((o) => (
                    <div key={o.value} className="flex items-center gap-1.5">
                      <RadioGroupItem
                        value={o.value}
                        id={`group-${o.value}`}
                        data-testid={`radio-group-${o.value}`}
                      />
                      <Label
                        htmlFor={`group-${o.value}`}
                        className="cursor-pointer text-sm font-normal"
                      >
                        {o.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm text-muted-foreground"
              data-testid="text-selection-count"
            >
              {formatCount(selected.size)} markerade
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={visibleRows.length === 0}
              onClick={() => toggleAllVisible(true)}
              data-testid="button-select-all"
            >
              Markera alla
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={clearSelection}
              data-testid="button-clear-selection"
            >
              <XCircle className="h-4 w-4" />
              Avmarkera alla
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setColumnDialogOpen(true)}
              data-testid="button-export-columns"
            >
              <Columns3 className="h-4 w-4" />
              Kolumner ({exportColumns.length})
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting || total === 0}
                  data-testid="button-export-dropdown"
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Exportera
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  onClick={exportToExcel}
                  disabled={exporting || exportColumns.length === 0}
                  data-testid="menuitem-export-excel"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <div className="flex flex-col">
                    <span>Synliga kolumner (Excel)</span>
                    <span className="text-xs text-muted-foreground">
                      {exportColumns.length} kolumner · ~{Math.min(total, 10000).toLocaleString("sv")} rader · max 10 000
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => exportToCsv(selected.size > 0 ? "selected" : "all")}
                  disabled={exporting}
                  data-testid="menuitem-export-csv"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <div className="flex flex-col">
                    <span>
                      {selected.size > 0
                        ? `Fullständig CSV (${selected.size.toLocaleString("sv")} markerade)`
                        : "Fullständig CSV-export"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selected.size > 0
                        ? `${selected.size.toLocaleString("sv")} rader · 94+ fält + hierarki + metadata`
                        : `~${total.toLocaleString("sv")} rader · 94+ fält + hierarki + metadata`}
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {listMode === "lista" && (<DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={groups.length === 0}
                  data-testid="button-select-group"
                >
                  Markera grupp
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-72 w-64 overflow-y-auto"
              >
                {groups.map((g) => (
                  <DropdownMenuItem
                    key={g.key}
                    onClick={() => selectWholeGroup(g)}
                    disabled={selectingGroupKey !== null}
                    data-testid={`menuitem-select-group-${g.key}`}
                  >
                    <span className="truncate">{g.label}</span>
                    <span className="ml-auto flex items-center gap-1.5 pl-3 text-xs text-muted-foreground">
                      {selectingGroupKey === g.key && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {formatCount(g.summary.taskCount)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>)}
            <Button
              size="sm"
              variant="outline"
              disabled={selectedTilldeladCount === 0}
              onClick={() =>
                setRevokeTarget({
                  ids: Array.from(selected.values())
                    .filter((r) => r.status === "tilldelad")
                    .map((r) => r.id),
                  label: `${selectedTilldeladCount} markerade`,
                })
              }
              data-testid="button-revoke-selected"
            >
              <RotateCcw className="h-4 w-4" />
              Återkalla tilldelning
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setAssignTarget(Array.from(selected.values()))}
              data-testid="button-assign-selected"
            >
              <Users className="h-4 w-4" />
              Tilldela markerade
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rutnät / Hierarki */}
      {listMode === "hierarki" ? (
        hierarchyLoading ? (
          <div className="flex items-center justify-center rounded-lg border py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Laddar hierarki…
          </div>
        ) : hierarchyError ? (
          <div
            className="rounded-lg border py-16 text-center text-destructive"
            data-testid="text-hierarchy-error"
          >
            Kunde inte ladda hierarkin. Försök igen.
          </div>
        ) : (
          <>
            {hierarchyTruncated && (
              <div
                className="mb-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-muted-foreground"
                data-testid="text-hierarchy-truncated"
              >
                Visar de första {hierarchyLoadedCount} av {hierarchyData?.pagination.total}{" "}
                uppgifterna. Använd filter för att avgränsa urvalet.
              </div>
            )}
            <HierarchyTable
            tasks={hierarchyTasks}
            selected={selected}
            onToggleRow={toggleRow}
            onAssignRow={(row) => setAssignTarget([row])}
            onRevokeRow={(row) =>
              setRevokeTarget({
                ids: [row.id],
                label: row.objectName ?? row.title ?? "uppgift",
              })
            }
            onOpenCluster={setOpenCluster}
            onAssignCluster={(rows) => setAssignTarget(rows)}
            onRevokeCluster={(rows) =>
              setRevokeTarget({
                ids: rows.map((r) => r.id),
                label: `${rows.length} uppgifter`,
              })
            }
            onGoToMap={(ref) => {
              if (ref) setMapFocusCluster(ref);
              setView("karta");
            }}
            />
          </>
        )
      ) : isLoading ? (
        <div className="flex items-center justify-center rounded-lg border py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Laddar uppgifter…
        </div>
      ) : isError ? (
        <div className="rounded-lg border py-16 text-center text-destructive" data-testid="text-grid-error">
          Kunde inte ladda uppgifter. Försök igen.
        </div>
      ) : (
        <>
          {data?.truncated && (
            <p className="text-xs text-warning" data-testid="text-truncated-warning">
              Visar de första 10 000 uppgifterna. Förfina filtret för fullständigt resultat.
            </p>
          )}
          <RoughGridTable
            groups={groups}
            grouping={data?.grouping ?? groupBy}
            selected={selected}
            collapsed={collapsed}
            onToggleRow={toggleRow}
            onToggleGroup={toggleGroup}
            onToggleCollapse={toggleCollapse}
            onToggleAllVisible={toggleAllVisible}
            allVisibleSelected={allVisibleSelected}
            onAssignRow={(row) => setAssignTarget([row])}
            onRevokeRow={(row) =>
              setRevokeTarget({
                ids: [row.id],
                label: row.objectName ?? row.title ?? "uppgift",
              })
            }
            onOpenCluster={setOpenCluster}
            getTaskClusters={getTaskClusters}
          />

          {/* Paginering + legend */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span data-testid="text-pagination-range">
                Visar {formatCount(rangeStart)}–{formatCount(rangeEnd)} av{" "}
                {formatCount(total)} uppgifter
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-[110px]" data-testid="select-pagesize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}/sida
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  data-testid="button-page-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageWindow(currentPage, totalPages).map((p, i) =>
                  p === "ellipsis" ? (
                    <span key={`e-${i}`} className="px-1 text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      size="icon"
                      variant={p === currentPage ? "default" : "outline"}
                      className="h-8 w-8 tabular-nums"
                      onClick={() => setOffset((p - 1) * pageSize)}
                      data-testid={`button-page-${p}`}
                    >
                      {p}
                    </Button>
                  ),
                )}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setOffset(offset + pageSize)}
                  data-testid="button-page-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Statuslegend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">Status:</span>
        {ROUGH_STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-xs">
            <span
              className={
                "inline-block h-2.5 w-2.5 rounded-full " + ROUGH_STATUS_META[s].dot
              }
            />
            {ROUGH_STATUS_META[s].label}
          </span>
        ))}
      </div>
        </>
      )}

      {/* Klump-panel (öppnas vid klick på badge i manuell vy) */}
      <ClusterSidePanel cluster={openCluster} onClose={() => setOpenCluster(null)} />

      {/* Tilldela-modal */}
      <RoughAssignModal
        open={assignTarget !== null}
        onOpenChange={(o) => !o && setAssignTarget(null)}
        selectedRows={assignTarget ?? []}
        teams={teams}
        isPending={assignMutation.isPending}
        onSubmit={({ teamId, week, kommentar }) =>
          assignMutation.mutate({
            ids: (assignTarget ?? []).map((r) => r.id),
            week,
            teamId,
            kommentar,
          })
        }
      />

      {/* Återkalla-bekräftelse */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      >
        <AlertDialogContent data-testid="dialog-revoke">
          <AlertDialogHeader>
            <AlertDialogTitle>Återkalla tilldelning?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta tar bort team, vecka och kommentar för {revokeTarget?.label}.
              Endast uppgifter med status “Tilldelad” påverkas — utförda eller
              avvikande uppgifter lämnas orörda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-revoke-cancel">
              Avbryt
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.ids)}
              data-testid="button-revoke-confirm"
            >
              Återkalla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}>
        <DialogContent data-testid="dialog-export-columns">
          <DialogHeader>
            <DialogTitle>Kolumner i exporten</DialogTitle>
            <DialogDescription>
              Välj vilka kolumner som ska tas med i Excel-filen. Valet sparas
              till nästa gång.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EXPORT_COLUMNS.filter(
              (col) =>
                (col.key !== "value" && col.key !== "cost") ||
                ["owner", "admin", "planner"].includes(currentRole ?? ""),
            ).map((col) => {
              const checked = exportColumns.includes(col.key);
              return (
                <label
                  key={col.key}
                  className="flex items-center gap-2 rounded-md border border-border p-2 text-sm hover-elevate cursor-pointer"
                  data-testid={`row-export-column-${col.key}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) =>
                      toggleExportColumn(col.key, v === true)
                    }
                    data-testid={`checkbox-export-column-${col.key}`}
                  />
                  <span>{col.label}</span>
                </label>
              );
            })}
          </div>
          {exportColumns.length === 0 && (
            <p
              className="text-sm text-destructive"
              data-testid="text-export-columns-empty"
            >
              Välj minst en kolumn för att kunna exportera.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={resetExportColumns}
              data-testid="button-export-columns-reset"
            >
              <RotateCcw className="h-4 w-4" />
              Återställ alla
            </Button>
            <Button
              onClick={() => setColumnDialogOpen(false)}
              data-testid="button-export-columns-done"
            >
              Klar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
