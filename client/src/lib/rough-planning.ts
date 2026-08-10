/**
 * Grovplanering — delade klient-typer, status-meta och period-hjälpare (Task #921).
 * Speglar svaret från GET /api/rough-planning/grid (server/grovplanering-grid.ts).
 */
import {
  startOfISOWeek,
  endOfISOWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  getISOWeek,
  getISOWeekYear,
} from "date-fns";

export type RoughStatus =
  | "otilldelad"
  | "tilldelad"
  | "delvis"
  | "utford"
  | "avviker";

export type GroupBy = "objekt" | "kund" | "orderkoncept" | "ingen";
export type PeriodMode = "manad" | "vecka" | "intervall";

export interface GridKpis {
  productionMinutes: number;
  value: number; // öre
  cost: number; // öre
  taskCount: number;
  objectCount: number;
}

export interface GridTaskRow {
  id: string;
  status: RoughStatus;
  customerId: string | null;
  customerName: string | null;
  objectId: string | null;
  objectName: string | null;
  title: string | null;
  taskType: string; // LEGACY (Task #1485) — behålls för bakåtkompatibilitet
  taskTypeLabel: string;
  executionCode: string | null;
  // Task #1485: artikeltyp härledd från artikelkopplingen (source="artikel")
  // eller fritext-heuristiken (source="legacy") för gamla rader utan artikel.
  articleType: string | null;
  articleTypeLabel: string | null;
  articleTypeSource: "artikel" | "legacy";
  desiredDeliveryStart: string | null;
  desiredDeliveryEnd: string | null;
  productionMinutes: number;
  teamId: string | null;
  teamName: string | null;
  teamColor: string | null;
  roughPlannedWeek: string | null;
  lastServiceDate: string | null;
  value: number; // öre
  cost: number; // öre
  source: string | null; // creation_method-nyckel (manual/import/external_report/performer/automatic)
  stopClusterId: string | null;
  stopClusterName: string | null;
  routeClusterId: string | null;
  routeClusterName: string | null;
}

export interface GridGroup {
  key: string;
  label: string;
  groupType: GroupBy;
  objectCount: number;
  earliestDesired: string | null;
  summary: GridKpis;
  tasks: GridTaskRow[];
}

export interface GridResponse {
  summary: GridKpis;
  groups: GridGroup[];
  pagination: { offset: number; limit: number; total: number };
  grouping: GroupBy;
  truncated: boolean;
}

// Uppgiftskälla (work_orders.creation_method) → svensk etikett. Visar VARIFRÅN en
// uppgift kommer: manuellt inlagd, importerad, från felanmälan, skapad av utförare,
// eller automatiskt av systemet (t.ex. orderkoncept-expansion).
export const CREATION_SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell",
  import: "Import",
  external_report: "Felanmälan",
  performer: "Utförare",
  automatic: "Automatisk",
};

export function creationSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return CREATION_SOURCE_LABELS[source] ?? source;
}

// Legend-ordning (matchar referensbilden): Utförd, Tilldelad, Otilldelad, Delvis, Avviker.
export const ROUGH_STATUS_ORDER: RoughStatus[] = [
  "utford",
  "tilldelad",
  "otilldelad",
  "delvis",
  "avviker",
];

export const ROUGH_STATUS_META: Record<
  RoughStatus,
  { label: string; dot: string; badge: string }
> = {
  utford: {
    label: "Utförd",
    dot: "bg-chart-2",
    badge: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  },
  tilldelad: {
    label: "Tilldelad",
    dot: "bg-warning",
    badge: "bg-warning/15 text-warning border border-warning/30",
  },
  delvis: {
    label: "Delvis utförd",
    dot: "bg-chart-3",
    badge: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
  },
  avviker: {
    label: "Avviker",
    dot: "bg-destructive",
    badge: "bg-destructive/15 text-destructive border border-destructive/30",
  },
  otilldelad: {
    label: "Otilldelad",
    dot: "border-2 border-muted-foreground/50 bg-transparent",
    badge: "bg-muted text-muted-foreground border border-border",
  },
};

// ---------------------------------------------------------------------------
// Format-hjälpare
// ---------------------------------------------------------------------------
export function formatHours(minutes: number | null | undefined): string {
  const m = minutes ?? 0;
  return `${Math.round(m / 60).toLocaleString("sv-SE")} h`;
}

export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("sv-SE");
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "–";
  return d.toLocaleDateString("sv-SE");
}

// "YYYY-Www" (versalt W) — formatet bulk-rough-plan kräver.
export function isoWeekString(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

// "2026 - V26" för stepper-etiketter.
export function weekLabel(date: Date): string {
  return `${getISOWeekYear(date)} - V${String(getISOWeek(date)).padStart(2, "0")}`;
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString("sv-SE", { year: "numeric", month: "long" });
}

// "2026-W26" → "V26" för veckochip i tabellen.
export function weekChip(week: string | null | undefined): string | null {
  if (!week) return null;
  const m = week.match(/-W(\d{2})$/);
  return m ? `V${m[1]}` : week;
}

// Löser ut [from, to] (ISO) från periodläget. Tomt = ingen tidsbegränsning.
export function resolvePeriodRange(
  mode: PeriodMode,
  anchor: Date,
  rangeFrom: string,
  rangeTo: string,
): { from?: string; to?: string } {
  if (mode === "vecka") {
    return {
      from: startOfISOWeek(anchor).toISOString(),
      to: endOfISOWeek(anchor).toISOString(),
    };
  }
  if (mode === "manad") {
    return {
      from: startOfMonth(anchor).toISOString(),
      to: endOfMonth(anchor).toISOString(),
    };
  }
  const from = rangeFrom ? startOfDay(new Date(rangeFrom)).toISOString() : undefined;
  const to = rangeTo ? endOfDay(new Date(rangeTo)).toISOString() : undefined;
  return { from, to };
}

// ---------------------------------------------------------------------------
// Hierarchy (Task #1283) — 3-nivå kollapsbar hierarki
// Ruttklump (L1) → Stoppklump (L2) → Uppgift (L3)
//
// Designregel:
//  - Uppgifter MED routeClusterId → L1 → L2 → L3-träd.
//  - Uppgifter UTAN routeClusterId (oavsett stopClusterId) → ogrupperade och
//    visas direkt som platta L3-rader nedanför trädet.
//  - Ingen syntetisk "Utan ruttklump"-L1-rad skapas.
//  - Stopklumpar inom en ruttklump: verkliga stop-IDs → L2-rader; uppgifter
//    i samma rutt men utan stopClusterId → L3 direkt under L1 (ingen L2-rad).
// ---------------------------------------------------------------------------

export interface HierarchyKpis {
  taskCount: number;
  productionMinutes: number;
  value: number;
  cost: number;
}

export interface HierarchyL2Stop {
  /** Null = uppgifter i denna rutt utan stopklump-tillhörighet */
  id: string | null;
  displayName: string;
  tasks: GridTaskRow[];
  kpis: HierarchyKpis;
}

export interface HierarchyL1Route {
  id: string;
  displayName: string;
  /** Stopklumpar (id != null) + ev. null-bucket för uppgifter utan stopp */
  stopClusters: HierarchyL2Stop[];
  kpis: HierarchyKpis;
}

export interface HierarchyBuildResult {
  /** Uppgifter som tillhör minst en ruttklump */
  routes: HierarchyL1Route[];
  /** Uppgifter helt utan ruttklump → visas som platta L3-rader */
  unclusteredTasks: GridTaskRow[];
}

function computeHierarchyKpis(tasks: GridTaskRow[]): HierarchyKpis {
  let productionMinutes = 0;
  let value = 0;
  let cost = 0;
  for (const t of tasks) {
    productionMinutes += t.productionMinutes;
    value += t.value;
    cost += t.cost;
  }
  return { taskCount: tasks.length, productionMinutes, value, cost };
}

export function buildHierarchy(tasks: GridTaskRow[]): HierarchyBuildResult {
  const unclusteredTasks: GridTaskRow[] = [];

  const routeMap = new Map<
    string,
    {
      id: string;
      displayName: string;
      stopMap: Map<
        string | null,
        { id: string | null; displayName: string; tasks: GridTaskRow[] }
      >;
    }
  >();

  for (const task of tasks) {
    const rKey = task.routeClusterId ?? null;

    if (rKey === null) {
      // Ingen ruttklump → platt L3
      unclusteredTasks.push(task);
      continue;
    }

    if (!routeMap.has(rKey)) {
      routeMap.set(rKey, {
        id: rKey,
        displayName: task.routeClusterName ?? rKey.slice(0, 8),
        stopMap: new Map(),
      });
    }
    const route = routeMap.get(rKey)!;
    const sKey = task.stopClusterId ?? null;
    if (!route.stopMap.has(sKey)) {
      route.stopMap.set(sKey, {
        id: sKey,
        displayName: task.stopClusterName ?? (sKey ? sKey.slice(0, 8) : ""),
        tasks: [],
      });
    }
    route.stopMap.get(sKey)!.tasks.push(task);
  }

  const sortedRouteKeys = [...routeMap.keys()].sort((a, b) =>
    (routeMap.get(a)?.displayName ?? "").localeCompare(
      routeMap.get(b)?.displayName ?? "",
      "sv-SE",
    ),
  );

  const routes = sortedRouteKeys.map((rKey) => {
    const route = routeMap.get(rKey)!;

    // Sortera: namngivna stopp first (alphabetically), null-bucket sist
    const sortedStopKeys = [...route.stopMap.keys()].sort((a, b) => {
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      return (route.stopMap.get(a)?.displayName ?? "").localeCompare(
        route.stopMap.get(b)?.displayName ?? "",
        "sv-SE",
      );
    });

    const stopClusters: HierarchyL2Stop[] = sortedStopKeys.map((sKey) => {
      const stop = route.stopMap.get(sKey)!;
      return {
        id: stop.id,
        displayName: stop.displayName,
        tasks: stop.tasks,
        kpis: computeHierarchyKpis(stop.tasks),
      };
    });

    const allTasks = stopClusters.flatMap((s) => s.tasks);
    return {
      id: route.id,
      displayName: route.displayName,
      stopClusters,
      kpis: computeHierarchyKpis(allTasks),
    };
  });

  return { routes, unclusteredTasks };
}

/** Kompakt leveranstidsintervall för en samling uppgifter (L1/L2-rader). */
export function clusterDeliveryRange(tasks: GridTaskRow[]): string {
  const dates = tasks
    .map((t) => t.desiredDeliveryStart)
    .filter((d): d is string => !!d)
    .map((d) => new Date(d))
    .filter((d) => Number.isFinite(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length === 0) return "–";
  const fmt = (d: Date) =>
    d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
  const first = fmt(dates[0]);
  const last = fmt(dates[dates.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/** Marginal i öre (value - cost). Returnerar null om value=0 (inget underlag). */
export function computeMargin(value: number, cost: number): number | null {
  return value === 0 ? null : value - cost;
}

/** Formatera marginal som "+X kr" / "−X kr" eller "–" */
export function formatMargin(marginOre: number | null): string {
  if (marginOre === null) return "–";
  const sign = marginOre >= 0 ? "+" : "";
  return `${sign}${Math.round(marginOre / 100).toLocaleString("sv-SE")} kr`;
}
