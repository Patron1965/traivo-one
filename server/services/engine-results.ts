// ============================================================================
// Tids- & geografimotorns resultat-läsmodell (Task #1039)
// ----------------------------------------------------------------------------
// Läsväg som monterar slot_times-registret (#1037, skrivet av motorn #1038) till
// en UI-vänlig struktur för Grovplaneringen:
//   - standalone[]  fristående uppgifter (ingen klumpnyckel)
//   - clumps[]      klumpuppgifter (assignmentGroupKey) med summerade storheter
//                   och sina medlemsuppgifter
//   - summary       totaler
//   - lastRunAt     senaste motorkörningens tidsstämpel
//
// Motorn äger INGEN UI; den här filen äger heller INGEN beräkning — den läser bara
// det motorn redan skrivit och berikar med uppgifts-/objekts-/kundkontext. Ingen
// finplanering eller ruttoptimering här.
// ============================================================================

import { db } from "../db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { assignments, objects, customers, type SlotTime } from "@shared/schema";
import { storage } from "../storage";
import { ENGINE_SOURCE, type SlotType } from "./time-geo-engine";

// ---------------------------------------------------------------------------
// Publika typer (speglas i client/src/lib/engine-results.ts)
// ---------------------------------------------------------------------------

export type PlannerDecision = "accepterad" | "avvisad";

export interface EngineSlotCandidate {
  windowStart: string;
  windowEnd: string;
  slotType: SlotType;
  status: "vald" | "forslag";
  rank: number;
  score: number | null;
  reason: string | null;
}

export interface EngineTaskResult {
  assignmentId: string;
  title: string | null;
  objectId: string | null;
  objectName: string | null;
  customerId: string | null;
  customerName: string | null;
  address: string | null;
  executionCode: string;
  valueOre: number;
  costOre: number;
  durationMinutes: number;
  /** Klumpnyckel om uppgiften ingår i en klumpuppgift, annars null. */
  groupKey: string | null;
  /** Vald slottid (status=vald). */
  chosen: EngineSlotCandidate | null;
  /** Näst bästa förslag (lägst rank bland status=forslag) — ger flexibilitet/deadline. */
  alternative: EngineSlotCandidate | null;
  /** Alla kandidater (sorterade på rank) — driver förklaringsdialogen. */
  candidates: EngineSlotCandidate[];
  /** Planerarens beslut om motorns förslag (null = obeslutat). */
  decision: PlannerDecision | null;
  /** Tidsstämpel för beslutet (ISO) eller null. */
  decidedAt: string | null;
}

export interface EngineClumpResult {
  groupKey: string;
  executionCode: string;
  groupingBasis: "address" | "geo" | "standalone";
  address: string | null;
  memberCount: number;
  summedValueOre: number;
  summedCostOre: number;
  summedDurationMinutes: number;
  windowStart: string;
  windowEnd: string;
  slotType: SlotType;
  members: EngineTaskResult[];
  /** Planerarens beslut om klumpens förslag (null = obeslutat). */
  decision: PlannerDecision | null;
  /** Tidsstämpel för beslutet (ISO) eller null. */
  decidedAt: string | null;
}

export interface EngineResultsSummary {
  taskCount: number;
  clumpCount: number;
  standaloneCount: number;
  valueOre: number;
  costOre: number;
  durationMinutes: number;
}

export interface EngineResultsResponse {
  hasResults: boolean;
  lastRunAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  summary: EngineResultsSummary;
  clumps: EngineClumpResult[];
  standalone: EngineTaskResult[];
}

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function asSlotType(value: string): SlotType {
  return value === "kravd" || value === "fordelaktig" ? value : "onskad";
}

function asDecision(value: string | null | undefined): PlannerDecision | null {
  return value === "accepterad" || value === "avvisad" ? value : null;
}

interface ClumpMeta {
  kind?: string;
  executionCode?: string;
  groupingBasis?: "address" | "geo" | "standalone";
  memberCount?: number;
  memberAssignmentIds?: string[];
  summedValueOre?: number;
  summedCostOre?: number;
  summedDurationMinutes?: number;
}

interface TaskMeta {
  reason?: string;
  executionCode?: string;
  valueOre?: number;
  costOre?: number;
  durationMinutes?: number;
}

function isClumpRow(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && (metadata as ClumpMeta).kind === "clump";
}

const EMPTY_SUMMARY: EngineResultsSummary = {
  taskCount: 0,
  clumpCount: 0,
  standaloneCount: 0,
  valueOre: 0,
  costOre: 0,
  durationMinutes: 0,
};

// ---------------------------------------------------------------------------
// Huvud-läsfunktion
// ---------------------------------------------------------------------------

export async function getEngineResults(tenantId: string): Promise<EngineResultsResponse> {
  // IO-skikt: läs registret + uppgiftskontext, delegera monteringen till den rena
  // assembleEngineResults så läsmodellen kan regressionstestas utan DB (Task #1042).
  const slots = await storage.getSlotTimes(tenantId);
  const engineSlots = slots.filter((s) => s.source === ENGINE_SOURCE);
  const assignmentIds = Array.from(
    new Set(
      engineSlots
        .filter((s) => s.assignmentId != null)
        .map((s) => s.assignmentId as string),
    ),
  );
  const context = await loadAssignmentContext(tenantId, assignmentIds);
  return assembleEngineResults(engineSlots, context);
}

/**
 * Ren montering av motorns redan skrivna slot_times-rader till UI-läsmodellen.
 * Tar emot redan källfiltrerade (source=tidsmotor) slottider samt uppgiftskontext
 * per assignmentId. Ingen IO här — så clumps/standalone/vald/alternativ kan
 * verifieras mot exakt den radform motorn skriver (Task #1042).
 */
export function assembleEngineResults(
  engineSlots: SlotTime[],
  contextById: Map<string, AssignmentContext>,
): EngineResultsResponse {
  if (engineSlots.length === 0) {
    return {
      hasResults: false,
      lastRunAt: null,
      periodStart: null,
      periodEnd: null,
      summary: { ...EMPTY_SUMMARY },
      clumps: [],
      standalone: [],
    };
  }

  // Senaste körningens tidsstämpel + periodens omfång (ur fönstren).
  let lastRunAt = 0;
  let periodStart = Infinity;
  let periodEnd = -Infinity;
  for (const s of engineSlots) {
    const created = s.createdAt instanceof Date ? s.createdAt.getTime() : new Date(s.createdAt).getTime();
    if (Number.isFinite(created)) lastRunAt = Math.max(lastRunAt, created);
    const ws = s.windowStart instanceof Date ? s.windowStart.getTime() : new Date(s.windowStart).getTime();
    const we = s.windowEnd instanceof Date ? s.windowEnd.getTime() : new Date(s.windowEnd).getTime();
    if (Number.isFinite(ws)) periodStart = Math.min(periodStart, ws);
    if (Number.isFinite(we)) periodEnd = Math.max(periodEnd, we);
  }

  // Dela upp i klump-rader och uppgifts-rader.
  const clumpRows = engineSlots.filter((s) => s.assignmentId == null && isClumpRow(s.metadata));
  const taskRows = engineSlots.filter((s) => s.assignmentId != null);

  // Gruppera uppgifts-rader per assignmentId → bygg kandidatlista.
  const byAssignment = new Map<string, typeof taskRows>();
  for (const row of taskRows) {
    const id = row.assignmentId as string;
    const list = byAssignment.get(id) ?? [];
    list.push(row);
    byAssignment.set(id, list);
  }

  // Bygg EngineTaskResult per assignment (uppgiftskontext injicerad av anroparen).
  const taskById = new Map<string, EngineTaskResult>();
  for (const [assignmentId, rows] of Array.from(byAssignment.entries())) {
    const sorted = [...rows].sort((a, b) => a.rank - b.rank);
    const candidates: EngineSlotCandidate[] = sorted.map((r) => {
      const meta = (r.metadata ?? {}) as TaskMeta;
      return {
        windowStart: toIso(r.windowStart) ?? "",
        windowEnd: toIso(r.windowEnd) ?? "",
        slotType: asSlotType(r.slotType),
        status: r.status === "vald" ? "vald" : "forslag",
        rank: r.rank,
        score: r.score ?? null,
        reason: meta.reason ?? null,
      };
    });

    const chosenRow = sorted.find((r) => r.status === "vald") ?? null;
    const chosenMeta = (chosenRow?.metadata ?? sorted[0]?.metadata ?? {}) as TaskMeta;
    const chosen = candidates.find((c) => c.status === "vald") ?? null;
    const alternative = candidates.find((c) => c.status === "forslag") ?? null;
    const ctx = contextById.get(assignmentId);

    // Beslutet stämplas på alla rader för uppgiften — läs från den valda (annars första).
    const decisionRow = chosenRow ?? sorted[0] ?? null;
    const decision = asDecision(decisionRow?.plannerDecision);

    taskById.set(assignmentId, {
      assignmentId,
      title: ctx?.title ?? null,
      objectId: ctx?.objectId ?? null,
      objectName: ctx?.objectName ?? null,
      customerId: ctx?.customerId ?? null,
      customerName: ctx?.customerName ?? null,
      address: ctx?.address ?? null,
      executionCode: chosenMeta.executionCode ?? "ingen",
      valueOre: chosenMeta.valueOre ?? 0,
      costOre: chosenMeta.costOre ?? 0,
      durationMinutes: chosenMeta.durationMinutes ?? 0,
      groupKey: chosenRow?.assignmentGroupKey ?? null,
      chosen,
      alternative,
      candidates,
      decision,
      decidedAt: decision ? toIso(decisionRow?.decidedAt) : null,
    });
  }

  // Montera klumpuppgifter och dra ut deras medlemmar.
  const clumps: EngineClumpResult[] = [];
  const clumpedAssignmentIds = new Set<string>();

  for (const row of clumpRows) {
    const groupKey = row.assignmentGroupKey;
    if (!groupKey) continue;
    const meta = (row.metadata ?? {}) as ClumpMeta;
    const memberIds = Array.isArray(meta.memberAssignmentIds) ? meta.memberAssignmentIds : [];

    const members: EngineTaskResult[] = [];
    for (const mid of memberIds) {
      const t = taskById.get(mid);
      if (t) {
        members.push(t);
        clumpedAssignmentIds.add(mid);
      }
    }

    // Adress härleds ur första medlem med adress (klump-raden lagrar ingen adress).
    const address = members.find((m) => m.address)?.address ?? null;

    const decision = asDecision(row.plannerDecision);

    clumps.push({
      groupKey,
      executionCode: meta.executionCode ?? "ingen",
      groupingBasis: meta.groupingBasis ?? "geo",
      address,
      memberCount: meta.memberCount ?? members.length,
      summedValueOre: meta.summedValueOre ?? members.reduce((acc, m) => acc + m.valueOre, 0),
      summedCostOre: meta.summedCostOre ?? members.reduce((acc, m) => acc + m.costOre, 0),
      summedDurationMinutes:
        meta.summedDurationMinutes ?? members.reduce((acc, m) => acc + m.durationMinutes, 0),
      windowStart: toIso(row.windowStart) ?? "",
      windowEnd: toIso(row.windowEnd) ?? "",
      slotType: asSlotType(row.slotType),
      members,
      decision,
      decidedAt: decision ? toIso(row.decidedAt) : null,
    });
  }

  // Fristående uppgifter = de som inte hamnade i en klump.
  const standalone: EngineTaskResult[] = [];
  for (const [assignmentId, task] of Array.from(taskById.entries())) {
    if (!clumpedAssignmentIds.has(assignmentId)) standalone.push(task);
  }

  // Stabil sortering (vald slot-start) för deterministisk vy.
  const byWindow = (a: EngineTaskResult, b: EngineTaskResult) =>
    (a.chosen?.windowStart ?? "").localeCompare(b.chosen?.windowStart ?? "");
  standalone.sort(byWindow);
  clumps.sort((a, b) => a.windowStart.localeCompare(b.windowStart));

  // Summering.
  let valueOre = 0;
  let costOre = 0;
  let durationMinutes = 0;
  for (const t of Array.from(taskById.values())) {
    valueOre += t.valueOre;
    costOre += t.costOre;
    durationMinutes += t.durationMinutes;
  }

  return {
    hasResults: true,
    lastRunAt: lastRunAt > 0 ? new Date(lastRunAt).toISOString() : null,
    periodStart: Number.isFinite(periodStart) ? new Date(periodStart).toISOString() : null,
    periodEnd: Number.isFinite(periodEnd) ? new Date(periodEnd).toISOString() : null,
    summary: {
      taskCount: taskById.size,
      clumpCount: clumps.length,
      standaloneCount: standalone.length,
      valueOre,
      costOre,
      durationMinutes,
    },
    clumps,
    standalone,
  };
}

// ---------------------------------------------------------------------------
// Planerarens beslut (acceptera/avvisa) på motorns förslag (Task #1043).
// ----------------------------------------------------------------------------
// Accepterat förslag = "förs vidare" till finplanering/ruttoptimering: beslutet
// persisteras på slot_times så att nedströmssteget kan läsa den bekräftade
// mängden (plannerDecision='accepterad'). Avvisade förslag markeras 'avvisad'.
// "ingen" nollar beslutet (ångra). Klump-beslut stämplar både klump-raden och
// dess medlems-uppgifter så att vy och nedströmssteg är konsistenta.
// ---------------------------------------------------------------------------

export type DecisionInput = "accepterad" | "avvisad" | "ingen";

export interface ApplyDecisionResult {
  updated: number;
  decision: PlannerDecision | null;
}

export async function applyEngineDecision(
  tenantId: string,
  input: {
    target: "task" | "clump";
    assignmentId?: string;
    groupKey?: string;
    decision: DecisionInput;
  },
  decidedBy: string | null,
): Promise<ApplyDecisionResult> {
  const decision: PlannerDecision | null = input.decision === "ingen" ? null : input.decision;

  if (input.target === "task") {
    if (!input.assignmentId) {
      return { updated: 0, decision };
    }
    const updated = await storage.setSlotTimePlannerDecision(tenantId, {
      assignmentIds: [input.assignmentId],
      decision,
      decidedBy,
    });
    return { updated, decision };
  }

  // Klump: stämpla klump-raden + medlems-uppgifterna (härledda ur klump-radens metadata).
  if (!input.groupKey) {
    return { updated: 0, decision };
  }
  const groupRows = await storage.getSlotTimes(tenantId, { assignmentGroupKey: input.groupKey });
  const clumpRow = groupRows.find((r) => r.assignmentId == null && isClumpRow(r.metadata));
  const memberIds = clumpRow
    ? ((clumpRow.metadata ?? {}) as ClumpMeta).memberAssignmentIds ?? []
    : [];

  const updated = await storage.setSlotTimePlannerDecision(tenantId, {
    assignmentGroupKey: input.groupKey,
    assignmentIds: Array.isArray(memberIds) && memberIds.length > 0 ? memberIds : undefined,
    decision,
    decidedBy,
  });
  return { updated, decision };
}

// ---------------------------------------------------------------------------
// Uppgiftskontext (titel/objekt/kund/adress) — tenant-scopat.
// ---------------------------------------------------------------------------

export interface AssignmentContext {
  title: string | null;
  objectId: string | null;
  objectName: string | null;
  customerId: string | null;
  customerName: string | null;
  address: string | null;
}

async function loadAssignmentContext(
  tenantId: string,
  assignmentIds: string[],
): Promise<Map<string, AssignmentContext>> {
  const out = new Map<string, AssignmentContext>();
  if (assignmentIds.length === 0) return out;

  const rows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      address: assignments.address,
      objectId: assignments.objectId,
      objectName: objects.name,
      customerId: assignments.customerId,
      customerName: customers.name,
    })
    .from(assignments)
    .leftJoin(objects, eq(assignments.objectId, objects.id))
    .leftJoin(customers, eq(assignments.customerId, customers.id))
    .where(
      and(
        eq(assignments.tenantId, tenantId),
        isNull(assignments.deletedAt),
        inArray(assignments.id, assignmentIds),
      ),
    );

  for (const r of rows) {
    out.set(r.id, {
      title: r.title ?? null,
      objectId: r.objectId ?? null,
      objectName: r.objectName ?? null,
      customerId: r.customerId ?? null,
      customerName: r.customerName ?? null,
      address: r.address ?? null,
    });
  }
  return out;
}
