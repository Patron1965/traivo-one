/**
 * Grovplanering — läs-optimerad rutnäts-endpoint (Task #921).
 *
 * En enda läsväg som filtrerar i SQL och grupperar/paginerar i applagret över hela
 * den filtrerade mängden (cap ROW_CAP). Härledd status uttrycks som ETT återanvändbart
 * SQL-CASE-fragment så att både SELECT och status-filtret blir SQL-korrekta.
 *
 * Tenant-ägarskap: tenantId sätts alltid server-side och ingår i WHERE på alla frågor.
 */
import ExcelJS from "exceljs";
import { db } from "./db";
import {
  eq,
  ne,
  and,
  isNull,
  isNotNull,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  workOrders,
  objects,
  customers,
  teams,
  assignments,
  orderConcepts,
  stopClusters,
  routeClusters,
} from "@shared/schema";
import { haversineDistanceKm } from "./distance-matrix-service";

// ---------------------------------------------------------------------------
// Typer
// ---------------------------------------------------------------------------
export type RoughStatus =
  | "otilldelad"
  | "tilldelad"
  | "delvis"
  | "utford"
  | "avviker";

export type GroupBy = "objekt" | "kund" | "orderkoncept" | "ingen";

export interface GridFilters {
  districtIds?: string[];
  postalCode?: string;
  city?: string;
  from?: Date; // önskad leveranstid – intervallstart
  to?: Date; // önskad leveranstid – intervallslut
  taskTypes?: string[]; // normaliserade nycklar (se TASK_TYPE_KEYS)
  statuses?: RoughStatus[];
  teamIds?: string[]; // "Fler filter" — filtrera på tilldelat team
  executionCodes?: string[]; // Task #1110 — filtrera på utförandekod (work_orders.execution_code)
  rootObjectId?: string; // Mikro-grovplanering: begränsa till ett objekt + dess ättlingar (subträd)
}

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
  taskType: string; // normaliserad nyckel
  taskTypeLabel: string;
  executionCode: string | null; // Task #1110 — utförandekod (registernyckel/fritext)
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
  tasks: GridTaskRow[]; // endast aktuell sidas rader
}

export interface GridResponse {
  summary: GridKpis; // vänster kort — hela filtrerade mängden
  groups: GridGroup[]; // grupper som har rader på aktuell sida
  pagination: { offset: number; limit: number; total: number };
  grouping: GroupBy;
  truncated: boolean; // träffade ROW_CAP
}

// ---------------------------------------------------------------------------
// Uppgiftstyp-normalisering (Öppet beslut #1 — härled från fritext-orderType).
// Mappar råa orderType-värden till specens 8 kontrollerade etiketter; okänt → "ovrigt".
// ---------------------------------------------------------------------------
export const TASK_TYPE_KEYS = [
  "bok",
  "rbk",
  "service",
  "driftkontroll",
  "tvatt",
  "besiktning",
  "administration",
  "konsultation",
] as const;

export const ROUGH_STATUS_LABELS: Record<RoughStatus, string> = {
  otilldelad: "Otilldelad",
  tilldelad: "Tilldelad",
  delvis: "Delvis utförd",
  utford: "Utförd",
  avviker: "Avviker",
};

export const TASK_TYPE_LABELS: Record<string, string> = {
  bok: "BÖK",
  rbk: "RBK",
  service: "Service",
  driftkontroll: "Driftkontroll",
  tvatt: "Tvätt",
  besiktning: "Besiktning",
  administration: "Administration",
  konsultation: "Konsultation",
  ovrigt: "Övrigt",
};

export function normalizeTaskType(orderType: string | null | undefined): string {
  const raw = (orderType ?? "").trim().toLowerCase();
  if (!raw) return "ovrigt";
  if (raw.includes("bök") || raw === "bok" || raw.startsWith("bok")) return "bok";
  if (raw === "rbk" || raw.startsWith("rbk")) return "rbk";
  if (raw.includes("driftkontroll") || raw.includes("drift")) return "driftkontroll";
  if (raw.includes("tvätt") || raw.includes("tvatt") || raw.includes("wash")) return "tvatt";
  if (raw.includes("besikt")) return "besiktning";
  if (raw.includes("administ") || raw === "admin") return "administration";
  if (raw.includes("konsult")) return "konsultation";
  if (raw.includes("service")) return "service";
  return "ovrigt";
}

// ---------------------------------------------------------------------------
// Härledd status — ETT återanvändbart SQL-CASE-fragment.
// Kolumner refereras med litterala kvalificerade namn ("work_orders"."col") eftersom
// drizzle kan rendera ${table.col} okvalificerat och då binda fel tabell i korrelerade
// subqueries (se memory: drizzle-correlated-subquery-column-qualification).
// Precedens: Avviker → Utförd → Delvis utförd → Tilldelad → Otilldelad.
// ---------------------------------------------------------------------------
export const STATUS_CASE = sql<RoughStatus>`
  CASE
    WHEN "work_orders"."impossible_reason" IS NOT NULL
      OR "work_orders"."order_status" = 'omojlig'
      OR "work_orders"."execution_status" = 'impossible'
      THEN 'avviker'
    WHEN "work_orders"."completed_at" IS NOT NULL
      OR "work_orders"."order_status" IN ('utford', 'fakturerad')
      OR "work_orders"."execution_status" IN ('completed', 'inspected')
      THEN 'utford'
    WHEN EXISTS (
        SELECT 1 FROM work_order_lines wol
        WHERE wol.work_order_id = "work_orders"."id" AND wol.is_completed = true
      ) AND EXISTS (
        SELECT 1 FROM work_order_lines wol2
        WHERE wol2.work_order_id = "work_orders"."id" AND wol2.is_completed = false
      )
      THEN 'delvis'
    WHEN "work_orders"."team_id" IS NOT NULL AND "work_orders"."rough_planned_week" IS NOT NULL
      THEN 'tilldelad'
    ELSE 'otilldelad'
  END
`;

const ROW_CAP = 10000;
const CLUSTER_OBJECT_CAP = 1500; // över detta: hoppa 30 m-klustring (varje objekt = egen grupp)
const CLUSTER_RADIUS_M = 30;

// ---------------------------------------------------------------------------
// WHERE-villkor från filter (de billiga/SQL-vänliga). Uppgiftstyp filtreras i
// applagret efter normalisering (fuzzy fritext).
// ---------------------------------------------------------------------------
function buildConditions(tenantId: string, filters: GridFilters): SQL[] {
  const conditions: SQL[] = [
    eq(workOrders.tenantId, tenantId),
    isNull(workOrders.deletedAt),
    ne(workOrders.orderStatus, "avbruten"),
  ];

  if (filters.districtIds && filters.districtIds.length > 0) {
    conditions.push(inArray(workOrders.districtId, filters.districtIds));
  }
  if (filters.teamIds && filters.teamIds.length > 0) {
    conditions.push(inArray(workOrders.teamId, filters.teamIds));
  }
  if (filters.executionCodes && filters.executionCodes.length > 0) {
    conditions.push(inArray(workOrders.executionCode, filters.executionCodes));
  }
  // Mikro-grovplanering: objektets egna uppgifter + ättlingarnas (subträd via hierarchy_path).
  // Tenant-predikat på subquery:n (aldrig läcka objekt tvärs tenant).
  if (filters.rootObjectId) {
    const root = filters.rootObjectId;
    conditions.push(
      sql`${workOrders.objectId} IN (
        SELECT o2.id FROM objects o2
        WHERE o2.tenant_id = ${tenantId}
          AND (o2.id = ${root} OR ${root} = ANY(o2.hierarchy_path))
      )`,
    );
  }
  if (filters.postalCode) {
    const norm = filters.postalCode.replace(/\s/g, "");
    conditions.push(
      sql`REPLACE(COALESCE(${objects.postalCode}, ''), ' ', '') ILIKE ${norm + "%"}`,
    );
  }
  if (filters.city) {
    conditions.push(sql`${objects.city} ILIKE ${filters.city}`);
  }
  // Tidsperiod = överlapp mot önskad leveranstid (start..COALESCE(end,start)).
  if (filters.from) {
    conditions.push(
      sql`COALESCE(${workOrders.desiredDeliveryEnd}, ${workOrders.desiredDeliveryStart}) >= ${filters.from}`,
    );
  }
  if (filters.to) {
    conditions.push(sql`${workOrders.desiredDeliveryStart} <= ${filters.to}`);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(
      sql`(${STATUS_CASE}) IN (${sql.join(
        filters.statuses.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }
  return conditions;
}

interface RawRow {
  id: string;
  status: RoughStatus;
  customerId: string | null;
  customerName: string | null;
  objectId: string | null;
  objectName: string | null;
  title: string | null;
  orderType: string | null;
  executionCode: string | null;
  desiredDeliveryStart: Date | null;
  desiredDeliveryEnd: Date | null;
  productionMinutes: number | null;
  teamId: string | null;
  teamName: string | null;
  teamColor: string | null;
  roughPlannedWeek: string | null;
  lastServiceDate: Date | null;
  value: number | null;
  cost: number | null;
  creationMethod: string | null;
  lat: number | null;
  lng: number | null;
  stopClusterId: string | null;
  stopClusterName: string | null;
  routeClusterId: string | null;
  routeClusterName: string | null;
}

function emptyKpis(): GridKpis {
  return { productionMinutes: 0, value: 0, cost: 0, taskCount: 0, objectCount: 0 };
}

function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// 30 m-klustring (union-find) över DISTINKTA objekt. Returnerar objectId → representant
// (minsta objectId i klustret). Objekt utan koordinat = eget kluster.
function clusterObjects(
  objs: { id: string; lat: number | null; lng: number | null }[],
): Map<string, string> {
  const parent = new Map<string, string>();
  for (const o of objs) parent.set(o.id, o.id);

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let cur = x;
    while (parent.get(cur) !== r) {
      const next = parent.get(cur)!;
      parent.set(cur, r);
      cur = next;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  const withCoords = objs.filter((o) => o.lat != null && o.lng != null);
  if (withCoords.length <= CLUSTER_OBJECT_CAP) {
    for (let i = 0; i < withCoords.length; i++) {
      for (let j = i + 1; j < withCoords.length; j++) {
        const a = withCoords[i];
        const b = withCoords[j];
        const m = haversineDistanceKm(a.lat!, a.lng!, b.lat!, b.lng!) * 1000;
        if (m <= CLUSTER_RADIUS_M) union(a.id, b.id);
      }
    }
  }

  const map = new Map<string, string>();
  for (const o of objs) map.set(o.id, find(o.id));
  return map;
}

interface BuiltGroup {
  key: string;
  label: string;
  rows: GridTaskRow[];
  objects: Set<string>;
  summary: GridKpis;
  earliest: string | null;
}

interface OrderedGroupsResult {
  orderedGroups: BuiltGroup[];
  summary: GridKpis;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Delad kärna: filtrera i SQL, normalisera typ, klustra/gruppera i applagret.
// Returnerar de fullständiga, sorterade grupperna (alla rader, ej paginerade) +
// hela-mängd-summeringen. Återanvänds av både rutnätet (paginerar) och
// grupp-rad-uppslaget (markera hel grupp över alla sidor).
// ---------------------------------------------------------------------------
async function buildOrderedGroups(
  tenantId: string,
  filters: GridFilters,
  grouping: GroupBy,
): Promise<OrderedGroupsResult> {
  const conditions = buildConditions(tenantId, filters);

  const fetched = (await db
    .select({
      id: workOrders.id,
      status: STATUS_CASE,
      customerId: workOrders.customerId,
      customerName: customers.name,
      objectId: workOrders.objectId,
      objectName: objects.name,
      title: workOrders.title,
      orderType: workOrders.orderType,
      executionCode: workOrders.executionCode,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      productionMinutes: workOrders.cachedProductionMinutes,
      teamId: workOrders.teamId,
      teamName: teams.name,
      teamColor: teams.color,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      lastServiceDate: objects.lastServiceDate,
      value: workOrders.cachedValue,
      cost: workOrders.cachedCost,
      creationMethod: workOrders.creationMethod,
      lat: sql<number | null>`COALESCE(${workOrders.taskLatitude}, ${objects.latitude})`,
      lng: sql<number | null>`COALESCE(${workOrders.taskLongitude}, ${objects.longitude})`,
      stopClusterId: workOrders.stopClusterId,
      stopClusterName: stopClusters.displayName,
      routeClusterId: workOrders.routeClusterId,
      routeClusterName: routeClusters.displayName,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .leftJoin(teams, eq(workOrders.teamId, teams.id))
    .leftJoin(stopClusters, eq(workOrders.stopClusterId, stopClusters.id))
    .leftJoin(routeClusters, eq(workOrders.routeClusterId, routeClusters.id))
    .where(and(...conditions))
    .limit(ROW_CAP + 1)) as RawRow[];

  const truncated = fetched.length > ROW_CAP;
  const raw = truncated ? fetched.slice(0, ROW_CAP) : fetched;

  // Uppgiftstyp-filter i applagret (fuzzy normalisering).
  const typeFilter =
    filters.taskTypes && filters.taskTypes.length > 0
      ? new Set(filters.taskTypes)
      : null;

  const rows: (GridTaskRow & { lat: number | null; lng: number | null })[] = [];
  for (const r of raw) {
    const taskType = normalizeTaskType(r.orderType);
    if (typeFilter && !typeFilter.has(taskType)) continue;
    rows.push({
      id: r.id,
      status: r.status,
      customerId: r.customerId,
      customerName: r.customerName,
      objectId: r.objectId,
      objectName: r.objectName,
      title: r.title,
      taskType,
      taskTypeLabel: TASK_TYPE_LABELS[taskType] ?? "Övrigt",
      executionCode: r.executionCode ?? null,
      desiredDeliveryStart: toIso(r.desiredDeliveryStart),
      desiredDeliveryEnd: toIso(r.desiredDeliveryEnd),
      productionMinutes: r.productionMinutes ?? 0,
      teamId: r.teamId,
      teamName: r.teamName,
      teamColor: r.teamColor,
      roughPlannedWeek: r.roughPlannedWeek,
      lastServiceDate: toIso(r.lastServiceDate),
      value: r.value ?? 0,
      cost: r.cost ?? 0,
      source: r.creationMethod ?? null,
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      stopClusterId: r.stopClusterId ?? null,
      stopClusterName: r.stopClusterName ?? null,
      routeClusterId: r.routeClusterId ?? null,
      routeClusterName: r.routeClusterName ?? null,
    });
  }

  // Vänster kort — KPI:er över hela filtrerade mängden.
  const summary = emptyKpis();
  const summaryObjects = new Set<string>();
  for (const r of rows) {
    summary.productionMinutes += r.productionMinutes;
    summary.value += r.value;
    summary.cost += r.cost;
    summary.taskCount += 1;
    if (r.objectId) summaryObjects.add(r.objectId);
  }
  summary.objectCount = summaryObjects.size;

  // Grupperingsnycklar.
  const objectIds = Array.from(
    new Set(rows.map((r) => r.objectId).filter((id): id is string => !!id)),
  );

  let conceptByObject = new Map<string, { id: string; name: string }>();
  if (grouping === "orderkoncept" && objectIds.length > 0) {
    const conceptRows = await db
      .select({
        objectId: assignments.objectId,
        conceptId: assignments.orderConceptId,
        conceptName: orderConcepts.name,
      })
      .from(assignments)
      .innerJoin(orderConcepts, eq(assignments.orderConceptId, orderConcepts.id))
      .where(
        and(
          eq(assignments.tenantId, tenantId),
          inArray(assignments.objectId, objectIds),
          isNotNull(assignments.orderConceptId),
        ),
      );
    // Representant per objekt: minsta conceptId (deterministiskt).
    for (const c of conceptRows) {
      if (!c.conceptId) continue;
      const existing = conceptByObject.get(c.objectId);
      if (!existing || c.conceptId < existing.id) {
        conceptByObject.set(c.objectId, { id: c.conceptId, name: c.conceptName });
      }
    }
  }

  let objectCluster = new Map<string, string>();
  const objectName = new Map<string, string>();
  if (grouping === "objekt") {
    const distinctObjs = new Map<string, { id: string; lat: number | null; lng: number | null }>();
    for (const r of rows) {
      if (!r.objectId) continue;
      if (!distinctObjs.has(r.objectId)) {
        distinctObjs.set(r.objectId, { id: r.objectId, lat: r.lat, lng: r.lng });
        objectName.set(r.objectId, r.objectName ?? "Objekt");
      }
    }
    objectCluster = clusterObjects(Array.from(distinctObjs.values()));
  }

  // Bestäm grupp per rad.
  function groupOf(r: (typeof rows)[number]): { key: string; label: string } {
    switch (grouping) {
      case "kund":
        return {
          key: r.customerId ?? "__nocustomer__",
          label: r.customerName ?? "Ingen kund",
        };
      case "orderkoncept": {
        const c = r.objectId ? conceptByObject.get(r.objectId) : undefined;
        return c
          ? { key: c.id, label: c.name }
          : { key: "__noconcept__", label: "Inget orderkoncept" };
      }
      case "ingen":
        return { key: "__all__", label: "Alla uppgifter" };
      case "objekt":
      default: {
        if (!r.objectId) return { key: "__noobject__", label: "Inget objekt" };
        const rep = objectCluster.get(r.objectId) ?? r.objectId;
        return { key: rep, label: objectName.get(rep) ?? r.objectName ?? "Objekt" };
      }
    }
  }

  const groupMap = new Map<string, BuiltGroup>();
  for (const r of rows) {
    const { key, label } = groupOf(r);
    let g = groupMap.get(key);
    if (!g) {
      g = { key, label, rows: [], objects: new Set(), summary: emptyKpis(), earliest: null };
      groupMap.set(key, g);
    }
    // Strippa interna geo-fält ur radobjektet som skickas till klienten.
    const { lat: _lat, lng: _lng, ...clientRow } = r;
    g.rows.push(clientRow);
    g.summary.productionMinutes += r.productionMinutes;
    g.summary.value += r.value;
    g.summary.cost += r.cost;
    g.summary.taskCount += 1;
    if (r.objectId) g.objects.add(r.objectId);
    if (r.desiredDeliveryStart) {
      if (!g.earliest || r.desiredDeliveryStart < g.earliest) g.earliest = r.desiredDeliveryStart;
    }
  }

  const collator = new Intl.Collator("sv");
  const orderedGroups = Array.from(groupMap.values()).sort((a, b) =>
    collator.compare(a.label, b.label),
  );
  // Stabil radordning inom grupp: titel, sen id.
  for (const g of orderedGroups) {
    g.rows.sort(
      (a, b) => collator.compare(a.title ?? "", b.title ?? "") || a.id.localeCompare(b.id),
    );
    g.summary.objectCount = g.objects.size;
  }

  return { orderedGroups, summary, truncated };
}

// ---------------------------------------------------------------------------
// Huvud-endpoint — paginerar den grupp-ordnade, platta listan per UPPGIFT.
// ---------------------------------------------------------------------------
export async function getGrovplaneringGrid(
  tenantId: string,
  filters: GridFilters,
  grouping: GroupBy,
  offset: number,
  limit: number,
): Promise<GridResponse> {
  const { orderedGroups, summary, truncated } = await buildOrderedGroups(
    tenantId,
    filters,
    grouping,
  );

  // Paginera per UPPGIFT över den grupp-ordnade, platta listan.
  const flat: { groupKey: string; row: GridTaskRow }[] = [];
  for (const g of orderedGroups) {
    for (const row of g.rows) flat.push({ groupKey: g.key, row });
  }
  const total = flat.length;
  const pageSlice = flat.slice(offset, offset + limit);

  // Återbygg grupper för sidan (bevara grupp-ordning), bifoga FULLA grupp-summeringar.
  const pageRowsByGroup = new Map<string, GridTaskRow[]>();
  for (const { groupKey, row } of pageSlice) {
    const arr = pageRowsByGroup.get(groupKey) ?? [];
    arr.push(row);
    pageRowsByGroup.set(groupKey, arr);
  }

  const groups: GridGroup[] = [];
  for (const g of orderedGroups) {
    const pageRows = pageRowsByGroup.get(g.key);
    if (!pageRows || pageRows.length === 0) continue;
    groups.push({
      key: g.key,
      label: g.label,
      groupType: grouping,
      objectCount: g.objects.size,
      earliestDesired: g.earliest,
      summary: g.summary,
      tasks: pageRows,
    });
  }

  return {
    summary,
    groups,
    pagination: { offset, limit, total },
    grouping,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Alla rader i EN grupp över alla sidor (Task #922) — för "Markera grupp".
// Återanvänder exakt samma filter/klustring/gruppering som rutnätet så att
// nyckeln matchar 1:1. Returnerar de fullständiga, sorterade raderna i gruppen
// (samma form som rutnätets `tasks`). Okänd nyckel → tom lista.
// ---------------------------------------------------------------------------
export async function getGrovplaneringGroupRows(
  tenantId: string,
  filters: GridFilters,
  grouping: GroupBy,
  groupKey: string,
): Promise<{ rows: GridTaskRow[]; truncated: boolean }> {
  const { orderedGroups, truncated } = await buildOrderedGroups(
    tenantId,
    filters,
    grouping,
  );
  const group = orderedGroups.find((g) => g.key === groupKey);
  return { rows: group ? group.rows : [], truncated };
}

// ---------------------------------------------------------------------------
// Distinkta orter (för Ort-filtret).
// ---------------------------------------------------------------------------
export async function getRoughPlanningCities(tenantId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ city: objects.city })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNotNull(objects.city)));
  return rows
    .map((r) => (r.city ?? "").trim())
    .filter((c) => c.length > 0)
    .sort((a, b) => new Intl.Collator("sv").compare(a, b));
}

// ---------------------------------------------------------------------------
// Återkalla tilldelning — EN mängd-baserad UPDATE. Nollar team + vecka + kommentar
// ENDAST för rader vars härledda status är 'tilldelad' (rör aldrig Utförd/Avviker/Delvis).
// ---------------------------------------------------------------------------
export async function revokeRoughAssignments(
  tenantId: string,
  ids: string[],
): Promise<{ updated: number; skipped: number }> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return { updated: 0, skipped: 0 };

  const result = await db
    .update(workOrders)
    .set({ teamId: null, roughPlannedWeek: null, plannedNotes: null })
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.id, unique),
        sql`(${STATUS_CASE}) = 'tilldelad'`,
      ),
    )
    .returning({ id: workOrders.id });

  return { updated: result.length, skipped: unique.length - result.length };
}

// ---------------------------------------------------------------------------
// Excel-export (pivot-vänlig) — en rad per UPPGIFT över hela den filtrerade
// mängden. Återanvänder buildOrderedGroups så att exporten speglar EXAKT samma
// filter/gruppering som rutnätet (samma tenant-scoping, samma uppgiftstyp-/
// status-filter). Grupp-etiketten skrivs som egen kolumn så att resultatet kan
// pivoteras direkt i Excel. Återanvänder ExcelJS-mönstret från objektmall-exporten.
// ---------------------------------------------------------------------------

// Neutralisera formula-injection (memory: csv-export-hardening).
function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.length === 0) return s;
  const first = s.charAt(0);
  if (
    first === "=" ||
    first === "+" ||
    first === "-" ||
    first === "@" ||
    first === "\t" ||
    first === "\r"
  ) {
    return "'" + s;
  }
  return s;
}

function toDateOrNull(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

// öre → kronor (numeriskt, pivot-vänligt).
function oreToKronor(ore: number): number {
  return Math.round(ore) / 100;
}

const GROUP_LABEL: Record<GroupBy, string> = {
  objekt: "Objekt (grupp)",
  kund: "Kund (grupp)",
  orderkoncept: "Orderkoncept (grupp)",
  ingen: "Grupp",
};

// ---------------------------------------------------------------------------
// Kolumnregister för exporten (Task #1000). Varje kolumn har en stabil nyckel
// (skickas av klienten), en etikett (rubrik + kolumnväljare), bredd, valfritt
// talformat och en värde-extraktor. `group`-kolumnens rubrik beror på
// grupperingen (GROUP_LABEL). Kolumnordningen i exporten följer alltid
// GROV_EXPORT_COLUMN_ORDER oavsett i vilken ordning klienten skickar nycklarna.
// ---------------------------------------------------------------------------
export type GrovExportColumnKey =
  | "group"
  | "status"
  | "customer"
  | "object"
  | "task"
  | "taskType"
  | "executionCode"
  | "desiredDelivery"
  | "productionMinutes"
  | "productionHours"
  | "team"
  | "week"
  | "lastService"
  | "value"
  | "cost";

interface GrovExportColumnDef {
  key: GrovExportColumnKey;
  label: string;
  width: number;
  numFmt?: string;
  value: (label: string, r: GridTaskRow) => string | number | Date | null;
}

const GROV_EXPORT_COLUMN_DEFS: GrovExportColumnDef[] = [
  { key: "group", label: "Grupp", width: 28, value: (label) => safeCell(label) },
  {
    key: "status",
    label: "Status",
    width: 14,
    value: (_l, r) => ROUGH_STATUS_LABELS[r.status] ?? r.status,
  },
  { key: "customer", label: "Kund", width: 26, value: (_l, r) => safeCell(r.customerName ?? "") },
  { key: "object", label: "Objekt", width: 28, value: (_l, r) => safeCell(r.objectName ?? "") },
  { key: "task", label: "Uppgift", width: 28, value: (_l, r) => safeCell(r.title ?? "") },
  { key: "taskType", label: "Uppgiftstyp", width: 16, value: (_l, r) => safeCell(r.taskTypeLabel) },
  { key: "executionCode", label: "Utförandekod", width: 18, value: (_l, r) => safeCell(r.executionCode ?? "") },
  {
    key: "desiredDelivery",
    label: "Önskad leverans",
    width: 16,
    numFmt: "yyyy-mm-dd",
    value: (_l, r) => toDateOrNull(r.desiredDeliveryStart),
  },
  {
    key: "productionMinutes",
    label: "Produktionstid (min)",
    width: 18,
    numFmt: "0",
    value: (_l, r) => r.productionMinutes ?? 0,
  },
  {
    key: "productionHours",
    label: "Produktionstid (tim)",
    width: 18,
    numFmt: "0.00",
    value: (_l, r) => Math.round(((r.productionMinutes ?? 0) / 60) * 100) / 100,
  },
  { key: "team", label: "Team", width: 20, value: (_l, r) => safeCell(r.teamName ?? "") },
  { key: "week", label: "Vecka", width: 12, value: (_l, r) => safeCell(r.roughPlannedWeek ?? "") },
  {
    key: "lastService",
    label: "Senast utförd",
    width: 16,
    numFmt: "yyyy-mm-dd",
    value: (_l, r) => toDateOrNull(r.lastServiceDate),
  },
  {
    key: "value",
    label: "Ordervärde (kr)",
    width: 16,
    numFmt: "#,##0.00",
    value: (_l, r) => oreToKronor(r.value),
  },
  {
    key: "cost",
    label: "Kostnad (kr)",
    width: 16,
    numFmt: "#,##0.00",
    value: (_l, r) => oreToKronor(r.cost),
  },
];

// Kanonisk kolumnordning (= standardurvalet, nuvarande fasta kolumnset).
export const GROV_EXPORT_COLUMN_ORDER: GrovExportColumnKey[] =
  GROV_EXPORT_COLUMN_DEFS.map((c) => c.key);

// Lättviktig kolumnkatalog för klientens kolumnväljare (key + etikett).
export const GROV_EXPORT_COLUMNS: { key: GrovExportColumnKey; label: string }[] =
  GROV_EXPORT_COLUMN_DEFS.map((c) => ({ key: c.key, label: c.label }));

const GROV_EXPORT_COLUMN_KEY_SET = new Set<string>(GROV_EXPORT_COLUMN_ORDER);

// Sanera klient-skickade kolumnnycklar: behåll endast kända nycklar, deduplicera
// och tvinga kanonisk ordning. Tom/ogiltig lista → fullständigt standardurval.
export function sanitizeGrovExportColumns(
  keys: string[] | undefined,
): GrovExportColumnKey[] {
  if (!keys || keys.length === 0) return [...GROV_EXPORT_COLUMN_ORDER];
  const requested = new Set(keys.filter((k) => GROV_EXPORT_COLUMN_KEY_SET.has(k)));
  if (requested.size === 0) return [...GROV_EXPORT_COLUMN_ORDER];
  return GROV_EXPORT_COLUMN_ORDER.filter((k) => requested.has(k));
}

export async function buildGrovplaneringExport(
  tenantId: string,
  filters: GridFilters,
  grouping: GroupBy,
  columnKeys?: GrovExportColumnKey[],
): Promise<{ buffer: Buffer; truncated: boolean; rowCount: number }> {
  const { orderedGroups, truncated } = await buildOrderedGroups(
    tenantId,
    filters,
    grouping,
  );

  const selectedKeys = sanitizeGrovExportColumns(columnKeys);
  const defByKey = new Map(GROV_EXPORT_COLUMN_DEFS.map((c) => [c.key, c]));
  const columns = selectedKeys.map((k) => defByKey.get(k)!);

  const headerFor = (c: GrovExportColumnDef): string =>
    c.key === "group" ? GROUP_LABEL[grouping] : c.label;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Traivo";
  wb.created = new Date();
  const ws = wb.addWorksheet("Grovplanering");
  ws.columns = columns.map((c) => ({ header: headerFor(c), width: c.width }));

  // Rubrikrad.
  const headerRow = ws.getRow(1);
  headerRow.height = 20;
  columns.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = headerFor(c);
    cell.font = { bold: true, color: { argb: "FF1B4B6B" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F4F8" },
    };
    cell.border = { bottom: { style: "medium", color: { argb: "FF1B4B6B" } } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  let rowCount = 0;
  for (const g of orderedGroups) {
    for (const r of g.rows) {
      const values = columns.map((c) => c.value(g.label, r));
      const row = ws.addRow(values);
      columns.forEach((c, idx) => {
        if (c.numFmt) row.getCell(idx + 1).numFmt = c.numFmt;
      });
      rowCount += 1;
    }
  }

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf), truncated, rowCount };
}
