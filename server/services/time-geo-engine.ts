// ============================================================================
// Tids- & geografimotorn (Task #1038)
// ----------------------------------------------------------------------------
// On-demand-motor som tar RÅA, oplanerade assignments (efter orderkoncept-
// expansion) och:
//   (a) väger ihop flera PARALLELLA tidsvillkor till rangordnade slottider per
//       uppgift (kundönskad tid väger tyngst, därefter tid-på-dygnet/veckodag/
//       utförandekod via de frysta tidsregel-paketen),
//   (b) "skjuter" uppgifter dynamiskt till nästa giltiga slot vid omkörning när
//       en dag är full (kapacitet i minuter per dag),
//   (c) grupperar geografiskt närliggande uppgifter med SAMMA utförandekod +
//       SAMMA tidsvillkor + SAMMA härledda adress till KLUMPUPPGIFTER (kund-
//       oberoende, ADR v3). Sidesmedvetet via udda/jämnt husnummer, faller
//       tillbaka på lat/lng inom konfigurerbar radie, annars fristående.
//   (d) summerar ordervärde/kostnad/produktionstid per klumpuppgift.
//
// Resultatet skrivs till slot_times-registret (Task #1037). Motorn återanvänder
// befintliga geo- och villkors-helpers och äger INGEN UI (separat nedströms-
// uppgift) och INGEN finplanering/ruttoptimering.
// ============================================================================

import { storage } from "../storage";
import { haversineDistanceKm } from "../distance-matrix-service";
import {
  softPreferenceScore,
  SOFT_PRIORITY_UNIT,
} from "./time-rule-package";
import type { FrozenTimeRulePackage, FrozenTimeRule } from "@shared/delivery-restrictions";
import type { WeeklyWindow, BlockedHour } from "@shared/schema";
import type { InsertSlotTime } from "@shared/schema";

// ---------------------------------------------------------------------------
// Konstanter / default-värden
// ---------------------------------------------------------------------------

/** Default-grupperingsradie (meter) när tenant inte konfigurerat egen i planning_parameters. */
export const DEFAULT_GROUPING_RADIUS_METERS = 150;
/** Default: gatusidesberoende PÅ (udda/jämna husnummer hamnar i var sin grupp). */
export const DEFAULT_STREET_SIDE_GROUPING = true;
/** Default arbetstakt i procent (100 = normal takt). */
export const DEFAULT_WORK_PACE_PERCENT = 100;
/** Default daglig kapacitet (minuter) för den dynamiska om-passningen. */
export const DEFAULT_DAILY_CAPACITY_MINUTES = 8 * 60;
/** Max antal assignments som bearbetas per körning (prestandagräns). */
export const DEFAULT_MAX_ASSIGNMENTS = 500;
/** Max antal kandidat-slottider som behålls per uppgift. */
export const DEFAULT_MAX_CANDIDATES_PER_TASK = 5;
/** Max antal dagar horisonten kan vara (prestandagräns). */
export const MAX_HORIZON_DAYS = 120;

/** Källa-stämpel på alla rader motorn skriver (för idempotent omkörning). */
export const ENGINE_SOURCE = "tidsmotor";

// Bas-vikter per slot-typ. Kundönskad tid väger tyngst.
const SLOT_TYPE_BASE_WEIGHT: Record<SlotType, number> = {
  onskad: 1000,
  kravd: 600,
  fordelaktig: 300,
};

// Straff per dags avstånd från ankardatumet (kundens önskade/schemalagda dag).
const DAY_DISTANCE_PENALTY = 12;

export type SlotType = "onskad" | "kravd" | "fordelaktig";

// ---------------------------------------------------------------------------
// Publika typer
// ---------------------------------------------------------------------------

export interface TimeGeoEngineOptions {
  /** Periodens/horisontens start (inklusive). */
  periodStart: Date;
  /** Periodens/horisontens slut (inklusive). */
  periodEnd: Date;
  /**
   * Team vars profil (grupperingsradie, gatusidesberoende, arbetstakt) ska
   * tillämpas när uppgifterna hanteras på teamnivå. Saknas team → tenant/default.
   */
  teamId?: string;
  /** Override av grupperingsradie (meter). Annars team-profil → tenant-konfig → default. */
  groupingRadiusMeters?: number;
  /** Override av gatusidesberoende (av/på). Annars team-profil → default (på). */
  streetSideGrouping?: boolean;
  /** Override av daglig kapacitet (minuter). */
  dailyCapacityMinutes?: number;
  /** Max assignments som bearbetas (prestandagräns). */
  maxAssignments?: number;
  /** Max kandidat-slottider per uppgift. */
  maxCandidatesPerTask?: number;
  /** Referenstid (för test/determinism). Default new Date(). */
  now?: Date;
}

export interface TimeGeoEngineResult {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  groupingRadiusMeters: number;
  streetSideGrouping: boolean;
  workPacePercent: number;
  dailyCapacityMinutes: number;
  processedAssignments: number;
  skippedAssignments: number;
  unschedulableAssignments: number;
  slotsCreated: number;
  taskSlots: number;
  clumpGroups: number;
  groups: ClumpGroupSummary[];
}

export interface ClumpGroupSummary {
  groupKey: string;
  executionCode: string;
  memberCount: number;
  memberAssignmentIds: string[];
  groupingBasis: "address" | "geo" | "standalone";
  summedValueOre: number;
  summedCostOre: number;
  summedDurationMinutes: number;
  windowStart: string;
  windowEnd: string;
  slotType: SlotType;
}

export interface SlotCandidate {
  slotType: SlotType;
  windowStart: Date;
  windowEnd: Date;
  score: number;
  reason: string;
}

// ===========================================================================
// PURA HELPERS (testbara utan DB)
// ===========================================================================

/**
 * Parsar en svensk gatuadress till gatunamn + husnummer + sida (udda/jämnt).
 * "Storgatan 12B, 11122 Stockholm" → { street: "storgatan", houseNumber: 12,
 * parity: "even" }. Sidesmedvetenheten bygger på att jämna/udda husnummer i
 * Sverige ligger på var sin sida av gatan.
 */
export function parseStreetAddress(address: string | null | undefined): {
  street: string | null;
  houseNumber: number | null;
  parity: "even" | "odd" | null;
} {
  if (!address || typeof address !== "string") {
    return { street: null, houseNumber: null, parity: null };
  }
  const firstPart = address.split(",")[0].trim();
  if (!firstPart) return { street: null, houseNumber: null, parity: null };

  // Gatunamn (text) följt av första heltalet = husnummer.
  const m = firstPart.match(/^(.*?)(\d+)/);
  if (!m) {
    return { street: normalizeStreet(firstPart), houseNumber: null, parity: null };
  }
  const street = normalizeStreet(m[1]);
  const houseNumber = parseInt(m[2], 10);
  if (!Number.isFinite(houseNumber)) {
    return { street, houseNumber: null, parity: null };
  }
  return {
    street,
    houseNumber,
    parity: houseNumber % 2 === 0 ? "even" : "odd",
  };
}

function normalizeStreet(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,]+$/, "").trim();
  return s.length > 0 ? s : null;
}

/** "HH:MM" → minuter sedan midnatt; null vid felaktigt format. */
export function parseHHMM(s: string | null | undefined): number | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Bygger ett Date på `day`-dagens datum med klockslaget `minutes` (lokal tid). */
export function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

/** YYYY-MM-DD (lokal tid) för datumjämförelse mot blockedDates. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Två [start,end)-intervall (minuter) överlappar. */
function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** En frusen regel gäller en veckodag (tom veckodagslista = alla dagar). */
function ruleAppliesToWeekday(rule: FrozenTimeRule, weekday: number): boolean {
  if (!rule.weekdays || rule.weekdays.length === 0) return true;
  return rule.weekdays.includes(weekday);
}

/** Regelns tidsfönster i minuter (default heldag 00:00–24:00 om tid saknas). */
function ruleWindowMinutes(rule: { timeFrom?: string; timeTo?: string }): { from: number; to: number } {
  const from = parseHHMM(rule.timeFrom) ?? 0;
  const to = parseHHMM(rule.timeTo) ?? 24 * 60;
  return { from, to: to <= from ? 24 * 60 : to };
}

interface ComputeCandidatesInput {
  periodStart: Date;
  periodEnd: Date;
  /** Kundönskade veckofönster (delivery preferences) — väger tyngst (onskad). */
  desiredWindows: WeeklyWindow[];
  /** Blockerade timmar (delivery preferences). */
  blockedHours: BlockedHour[];
  /** Blockerade datum (YYYY-MM-DD). */
  blockedDates: string[];
  /** Frysta tidsregel-paket från assignment (hard/soft, polaritet, vikt). */
  frozenRules: FrozenTimeRulePackage | null;
  /** Ankardatum (kundens schemalagda dag) — påverkar dags-straffet. */
  anchorDate: Date | null;
  plannedWindowStart: Date | null;
  plannedWindowEnd: Date | null;
  maxCandidates: number;
}

/**
 * Väger ihop alla PARALLELLA tidsvillkor till rangordnade kandidat-slottider för
 * EN uppgift över horisonten. Kundönskad tid (onskad) väger tyngst, därefter
 * hårda positiva regler (kravd) och mjuka positiva regler (fordelaktig). Mjuka
 * regler bidrar dessutom med en veckodags-/tid-på-dygnet-vägd poäng via
 * softPreferenceScore. Hårda NEGATIVA regler, blockerade timmar och datum
 * utesluter kandidater. Returnerar topp `maxCandidates` sorterade (bäst först).
 */
export function computeSlotCandidates(input: ComputeCandidatesInput): SlotCandidate[] {
  const {
    periodStart,
    periodEnd,
    desiredWindows,
    blockedHours,
    blockedDates,
    frozenRules,
    anchorDate,
    plannedWindowStart,
    plannedWindowEnd,
    maxCandidates,
  } = input;

  const blocked = new Set(blockedDates);
  const candidates: SlotCandidate[] = [];

  const anchor = anchorDate ?? periodStart;
  const anchorKey = toDateKey(anchor);

  // Ankarets dagindex för dags-straff.
  const dayMs = 24 * 60 * 60 * 1000;
  const anchorDay = startOfDay(anchor).getTime();

  const start = startOfDay(periodStart);
  const end = startOfDay(periodEnd);

  // Hårda negativa intervall (undvik) för en veckodag — delas mellan huvudloopen
  // och fallback-vägen så att standardfönstret aldrig hamnar i ett undvik-intervall.
  const negativesForWeekday = (wd: number): Array<{ from: number; to: number }> => {
    const negs: Array<{ from: number; to: number }> = [];
    if (frozenRules) {
      for (const r of frozenRules.hard) {
        if (r.polarity !== "negative") continue;
        if (!ruleAppliesToWeekday(r, wd)) continue;
        negs.push(ruleWindowMinutes(r));
      }
    }
    // Blockerade timmar (delivery prefs) som gäller veckodagen.
    for (const bh of blockedHours) {
      if (bh.weekdays && bh.weekdays.length > 0 && !bh.weekdays.includes(wd)) continue;
      const from = parseHHMM(bh.start);
      const to = parseHHMM(bh.end);
      if (from == null || to == null || to <= from) continue;
      negs.push({ from, to });
    }
    return negs;
  };

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const day = new Date(cursor);
    const dateKey = toDateKey(day);
    if (blocked.has(dateKey)) continue; // hela dagen blockerad

    const wd = day.getDay(); // 0=Sön … 6=Lör

    const hardNegatives = negativesForWeekday(wd);

    const isExcluded = (from: number, to: number): boolean =>
      hardNegatives.some((b) => intervalsOverlap(from, to, b.from, b.to));

    const softScore = softPreferenceScore(frozenRules, wd);
    const dayDistance = Math.abs(Math.round((startOfDay(day).getTime() - anchorDay) / dayMs));
    const sameAsAnchor = dateKey === anchorKey;

    const pushCandidate = (
      slotType: SlotType,
      from: number,
      to: number,
      label: string,
    ) => {
      if (to <= from) return;
      if (isExcluded(from, to)) return;
      const base = SLOT_TYPE_BASE_WEIGHT[slotType];
      // Tid-på-dygnet: tidigare på dagen vinner svagt vid lika poäng.
      const timeNudge = -from * 0.001;
      const score =
        base +
        softScore * SOFT_PRIORITY_UNIT -
        dayDistance * DAY_DISTANCE_PENALTY +
        timeNudge;
      candidates.push({
        slotType,
        windowStart: atMinutes(day, from),
        windowEnd: atMinutes(day, to),
        score,
        reason: label,
      });
    };

    // (1) Kundönskade veckofönster för veckodagen → onskad (tyngst).
    for (const w of desiredWindows) {
      if (w.weekday !== wd) continue;
      const from = parseHHMM(w.start);
      const to = parseHHMM(w.end);
      if (from == null || to == null) continue;
      pushCandidate(
        "onskad",
        from,
        to,
        `Kundönskad tid ${w.start}–${w.end}${sameAsAnchor ? " (önskad dag)" : ""}`,
      );
    }

    // (2) Hårda positiva regler → kravd.
    // (3) Mjuka positiva regler → fordelaktig.
    if (frozenRules) {
      for (const r of frozenRules.hard) {
        if (r.polarity !== "positive") continue;
        if (!ruleAppliesToWeekday(r, wd)) continue;
        const { from, to } = ruleWindowMinutes(r);
        pushCandidate("kravd", from, to, r.description || "Krävd tidsregel");
      }
      for (const r of frozenRules.soft) {
        if (r.polarity !== "positive") continue;
        if (!ruleAppliesToWeekday(r, wd)) continue;
        const { from, to } = ruleWindowMinutes(r);
        pushCandidate("fordelaktig", from, to, r.description || "Fördelaktig tidsregel");
      }
    }
  }

  // Fallback: inget villkor gav en kandidat → en enda onskad-slot med planerat
  // fönster (eller default 08:00–16:00). Fallbacken respekterar blockerade datum
  // och hårda undvik-intervall: den letar första giltiga dag (ankardagen först,
  // sedan framåt i perioden). Om varje dag är blockerad blir resultatet 0 slots,
  // vilket är korrekt — vi placerar aldrig en uppgift i ett blockerat fönster.
  if (candidates.length === 0) {
    let from = 8 * 60;
    let to = 16 * 60;
    if (plannedWindowStart && plannedWindowEnd) {
      from = plannedWindowStart.getHours() * 60 + plannedWindowStart.getMinutes();
      to = plannedWindowEnd.getHours() * 60 + plannedWindowEnd.getMinutes();
      if (to <= from) {
        from = 8 * 60;
        to = 16 * 60;
      }
    }

    // Dagordning: ankardagen först (om den ligger i perioden), sedan resten framåt.
    const orderedDays: Date[] = [];
    if (anchor >= start && anchor <= end) orderedDays.push(startOfDay(anchor));
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const d = startOfDay(new Date(cursor));
      if (orderedDays.some((o) => o.getTime() === d.getTime())) continue;
      orderedDays.push(d);
    }

    for (const day of orderedDays) {
      if (blocked.has(toDateKey(day))) continue; // hela dagen blockerad
      const negs = negativesForWeekday(day.getDay());
      if (negs.some((b) => intervalsOverlap(from, to, b.from, b.to))) continue; // undvik-krock
      candidates.push({
        slotType: "onskad",
        windowStart: atMinutes(day, from),
        windowEnd: atMinutes(day, to),
        score: SLOT_TYPE_BASE_WEIGHT.onskad - 0.5,
        reason: "Standardfönster (inga tidsvillkor)",
      });
      break;
    }
  }

  // Sortera bäst först, deduplicera identiska fönster (behåll högsta poäng).
  candidates.sort((a, b) => b.score - a.score || a.windowStart.getTime() - b.windowStart.getTime());
  const seen = new Set<string>();
  const unique: SlotCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.windowStart.getTime()}|${c.windowEnd.getTime()}|${c.slotType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
    if (unique.length >= maxCandidates) break;
  }
  return unique;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ---------------------------------------------------------------------------
// Geo-gruppering (sidesmedveten klumpning)
// ---------------------------------------------------------------------------

export interface GroupableTask {
  assignmentId: string;
  executionCode: string;
  /** Tidsvillkors-nyckel (vald dag + fönster) — del av gruppidentiteten. */
  timeKey: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  valueOre: number;
  costOre: number;
  durationMinutes: number;
  slotType: SlotType;
  windowStart: Date;
  windowEnd: Date;
}

export interface TaskGroup {
  groupKey: string;
  executionCode: string;
  timeKey: string;
  groupingBasis: "address" | "geo" | "standalone";
  members: GroupableTask[];
}

/**
 * Grupperar uppgifter till klumpuppgifter. Identitet = utförandekod + tidsvillkor
 * (timeKey) + härledd adress. Sidesmedveten (default): udda/jämnt husnummer ger
 * var sin grupp. Med `streetSideGrouping=false` (team-profil) slås båda sidor av
 * samma gata ihop. Saknas gatuadress men finns position → greedy-kluster inom
 * `radiusMeters`. Saknas både adress och position → fristående.
 */
export function groupTasks(
  tasks: GroupableTask[],
  radiusMeters: number,
  streetSideGrouping: boolean = DEFAULT_STREET_SIDE_GROUPING,
): TaskGroup[] {
  // Partitionera på (utförandekod, tidsvillkor).
  const partitions = new Map<string, GroupableTask[]>();
  for (const t of tasks) {
    const pk = `${t.executionCode}||${t.timeKey}`;
    const arr = partitions.get(pk);
    if (arr) arr.push(t);
    else partitions.set(pk, [t]);
  }

  const groups = new Map<string, TaskGroup>();

  const addMember = (
    groupKey: string,
    basis: TaskGroup["groupingBasis"],
    t: GroupableTask,
  ) => {
    const g = groups.get(groupKey);
    if (g) g.members.push(t);
    else
      groups.set(groupKey, {
        groupKey,
        executionCode: t.executionCode,
        timeKey: t.timeKey,
        groupingBasis: basis,
        members: [t],
      });
  };

  for (const [pk, members] of Array.from(partitions.entries())) {
    const geoOnly: GroupableTask[] = [];
    const standalone: GroupableTask[] = [];

    for (const t of members) {
      const parsed = parseStreetAddress(t.address);
      // Med sidesberoende krävs både gata + sida; utan det räcker gatunamnet
      // (båda sidor av gatan klumpas ihop).
      if (parsed.street && (streetSideGrouping ? parsed.parity : true)) {
        const key = streetSideGrouping
          ? `${pk}||addr:${parsed.street}#${parsed.parity}`
          : `${pk}||addr:${parsed.street}`;
        addMember(key, "address", t);
      } else if (isUsableCoord(t.latitude, t.longitude)) {
        geoOnly.push(t);
      } else {
        standalone.push(t);
      }
    }

    // Greedy radie-klustring för adresslösa men positionerade uppgifter.
    let clusterIdx = 0;
    const assigned = new Set<string>();
    for (const seed of geoOnly) {
      if (assigned.has(seed.assignmentId)) continue;
      const key = `${pk}||geo:${clusterIdx++}`;
      addMember(key, "geo", seed);
      assigned.add(seed.assignmentId);
      for (const other of geoOnly) {
        if (assigned.has(other.assignmentId)) continue;
        const distM =
          haversineDistanceKm(
            seed.latitude as number,
            seed.longitude as number,
            other.latitude as number,
            other.longitude as number,
          ) * 1000;
        if (distM <= radiusMeters) {
          addMember(key, "geo", other);
          assigned.add(other.assignmentId);
        }
      }
    }

    // Fristående uppgifter (varken adress eller position).
    for (const t of standalone) {
      addMember(`${pk}||solo:${t.assignmentId}`, "standalone", t);
    }
  }

  return Array.from(groups.values());
}

/** Samma användbarhetstest som object-location men för rena tal (assignment-snapshot). */
function isUsableCoord(lat: number | null, lng: number | null): boolean {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat !== 0 &&
    typeof lng === "number" && Number.isFinite(lng) && lng !== 0
  );
}

/** Summerar ordervärde/kostnad/produktionstid + fönster för en klumpuppgift. */
export function summarizeGroup(group: TaskGroup): {
  summedValueOre: number;
  summedCostOre: number;
  summedDurationMinutes: number;
  windowStart: Date;
  windowEnd: Date;
  slotType: SlotType;
} {
  let summedValueOre = 0;
  let summedCostOre = 0;
  let summedDurationMinutes = 0;
  let windowStart = group.members[0].windowStart;
  let windowEnd = group.members[0].windowEnd;
  for (const m of group.members) {
    summedValueOre += m.valueOre;
    summedCostOre += m.costOre;
    summedDurationMinutes += m.durationMinutes;
    if (m.windowStart < windowStart) windowStart = m.windowStart;
    if (m.windowEnd > windowEnd) windowEnd = m.windowEnd;
  }
  return {
    summedValueOre,
    summedCostOre,
    summedDurationMinutes,
    windowStart,
    windowEnd,
    slotType: group.members[0].slotType,
  };
}

// ===========================================================================
// ORKESTRERING (DB-IO)
// ===========================================================================

interface PreparedAssignment {
  id: string;
  objectId: string;
  executionCode: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  valueOre: number;
  costOre: number;
  durationMinutes: number;
  candidates: SlotCandidate[];
  chosenIndex: number; // index i candidates som blev "vald"
}

/**
 * Kör motorn för en tenant och en period/horisont. Idempotent: rensar tidigare
 * motor-genererade slottider för de bearbetade uppgifterna innan nya skrivs, så
 * en omkörning ger ren om-passning (dynamiskt "skjut till nästa giltiga slot").
 */
export async function runTimeGeoEngine(
  tenantId: string,
  options: TimeGeoEngineOptions,
): Promise<TimeGeoEngineResult> {
  const now = options.now ?? new Date();
  const periodStart = startOfDay(options.periodStart);
  let periodEnd = startOfDay(options.periodEnd);
  if (periodEnd < periodStart) periodEnd = periodStart;
  // Prestandagräns: kapa horisonten.
  const maxEnd = new Date(periodStart);
  maxEnd.setDate(maxEnd.getDate() + MAX_HORIZON_DAYS);
  if (periodEnd > maxEnd) periodEnd = maxEnd;

  const maxAssignments = options.maxAssignments ?? DEFAULT_MAX_ASSIGNMENTS;
  const maxCandidates = options.maxCandidatesPerTask ?? DEFAULT_MAX_CANDIDATES_PER_TASK;
  const dailyCapacityMinutes =
    options.dailyCapacityMinutes ?? (await resolveDailyCapacityMinutes(tenantId));

  // Grupperings-/ruttoptimerings-premisser. När ett team är känt tillämpas team-
  // profilens inställningar (radie, gatusidesberoende, arbetstakt); annars tenant/
  // default. Explicita options överstyr alltid.
  const teamConfig = options.teamId
    ? await resolveTeamGroupingConfig(tenantId, options.teamId)
    : null;
  const groupingRadiusMeters =
    options.groupingRadiusMeters ??
    teamConfig?.radiusMeters ??
    (await resolveGroupingRadiusMeters(tenantId));
  const streetSideGrouping =
    options.streetSideGrouping ??
    teamConfig?.streetSideGrouping ??
    DEFAULT_STREET_SIDE_GROUPING;
  const workPacePercent = teamConfig?.workPacePercent ?? DEFAULT_WORK_PACE_PERCENT;

  // (1) Hämta råa, oplanerade assignments. scheduledDate kan vara null → hämta
  // utan datumfilter och filtrera i minnet (datumfiltret träffar inte null).
  const all = await storage.getAssignments(tenantId, { status: "not_planned" });
  const inWindow = all.filter((a) => {
    if (!a.scheduledDate) return true;
    const d = new Date(a.scheduledDate);
    return d >= periodStart && d <= periodEnd;
  });
  const candidatesPool = inWindow.slice(0, maxAssignments);
  const skipped = inWindow.length - candidatesPool.length;

  if (candidatesPool.length === 0) {
    return emptyResult(tenantId, periodStart, periodEnd, groupingRadiusMeters, dailyCapacityMinutes, streetSideGrouping, workPacePercent);
  }

  // (2) Utförandekod per assignment. Task #1110: den stämplas numera på själva
  // uppgiften vid orderkoncept-expansion (a.executionCode). Legacy-rader saknar
  // värdet → fall tillbaka på derive-at-read via assignment_articles → articles.
  const assignmentIds = candidatesPool.map((a) => a.id);
  const execCodeByAssignment = await deriveExecutionCodes(tenantId, assignmentIds);

  // (3) Hämta leveranspreferenser per objekt (deduplicerat).
  const prefsByObject = await resolveDeliveryPrefsByObject(
    Array.from(new Set(candidatesPool.map((a) => a.objectId))),
  );

  // (4) Beräkna kandidat-slottider per uppgift.
  const prepared: PreparedAssignment[] = [];
  for (const a of candidatesPool) {
    const prefs = prefsByObject.get(a.objectId);
    const frozen = (a.frozenTimeRules as FrozenTimeRulePackage | null) ?? null;
    const anchor = a.scheduledDate ? new Date(a.scheduledDate) : null;
    const cands = computeSlotCandidates({
      periodStart: periodStart < startOfDay(now) ? startOfDay(now) : periodStart,
      periodEnd,
      desiredWindows: prefs?.weeklyWindows ?? [],
      blockedHours: prefs?.blockedHours ?? [],
      blockedDates: prefs?.blockedDates ?? [],
      frozenRules: frozen,
      anchorDate: anchor,
      plannedWindowStart: a.plannedWindowStart ? new Date(a.plannedWindowStart) : null,
      plannedWindowEnd: a.plannedWindowEnd ? new Date(a.plannedWindowEnd) : null,
      maxCandidates,
    });
    prepared.push({
      id: a.id,
      objectId: a.objectId,
      executionCode: a.executionCode ?? execCodeByAssignment.get(a.id) ?? "ingen",
      address: a.address ?? null,
      latitude: a.latitude ?? null,
      longitude: a.longitude ?? null,
      valueOre: a.cachedValue ?? 0,
      costOre: a.cachedCost ?? 0,
      durationMinutes: a.estimatedDuration ?? 60,
      candidates: cands,
      chosenIndex: 0,
    });
  }

  // (4b) Uppgifter utan en enda giltig kandidat (alla dagar blockerade/undvik)
  // kan inte schemaläggas. Skilj ut dem så att kapacitet, gruppering och
  // persistens aldrig avrefererar en tom kandidatlista (skulle annars krascha).
  const schedulable = prepared.filter((p) => p.candidates.length > 0);
  const unschedulable = prepared.length - schedulable.length;

  // (5) Dynamisk om-passning: kapacitet (minuter) per dag. Bearbeta i prioritets-
  // ordning (bäst kandidat-poäng först). Välj första kandidaten vars dag har
  // kapacitet kvar; annars skjut till nästa kandidat/dag.
  applyDailyCapacity(schedulable, dailyCapacityMinutes, periodEnd);

  // (6) Geo-gruppering på de VALDA slottiderna.
  const groupable: GroupableTask[] = schedulable.map((p) => {
    const chosen = p.candidates[p.chosenIndex];
    return {
      assignmentId: p.id,
      executionCode: p.executionCode,
      timeKey: `${toDateKey(chosen.windowStart)}|${minutesOfDay(chosen.windowStart)}-${minutesOfDay(chosen.windowEnd)}`,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      valueOre: p.valueOre,
      costOre: p.costOre,
      durationMinutes: p.durationMinutes,
      slotType: chosen.slotType,
      windowStart: chosen.windowStart,
      windowEnd: chosen.windowEnd,
    };
  });
  const groups = groupTasks(groupable, groupingRadiusMeters, streetSideGrouping);

  // Karta uppgift → gruppnyckel (endast för grupper ≥2 = riktiga klumpuppgifter).
  const groupKeyByAssignment = new Map<string, string>();
  const clumpGroups: ClumpGroupSummary[] = [];
  for (const g of groups) {
    if (g.members.length < 2) continue;
    const sum = summarizeGroup(g);
    for (const m of g.members) groupKeyByAssignment.set(m.assignmentId, g.groupKey);
    clumpGroups.push({
      groupKey: g.groupKey,
      executionCode: g.executionCode,
      memberCount: g.members.length,
      memberAssignmentIds: g.members.map((m) => m.assignmentId),
      groupingBasis: g.groupingBasis,
      summedValueOre: sum.summedValueOre,
      summedCostOre: sum.summedCostOre,
      summedDurationMinutes: sum.summedDurationMinutes,
      windowStart: sum.windowStart.toISOString(),
      windowEnd: sum.windowEnd.toISOString(),
      slotType: sum.slotType,
    });
  }

  // (7) Persistens. Idempotent: rensa tidigare motor-rader för dessa uppgifter +
  // grupp-rader inom fönstret, skriv sedan nytt.
  await storage.clearEngineSlotTimes(tenantId, ENGINE_SOURCE, {
    assignmentIds,
    windowStart: periodStart,
    windowEnd: periodEnd,
  });

  const rows: InsertSlotTime[] = [];
  for (const p of schedulable) {
    const groupKey = groupKeyByAssignment.get(p.id) ?? null;
    p.candidates.forEach((c, idx) => {
      const chosen = idx === p.chosenIndex;
      rows.push({
        tenantId,
        assignmentId: p.id,
        // Endast den valda task-slotten bär gruppnyckeln (länkar till klumpen).
        assignmentGroupKey: chosen ? groupKey : null,
        windowStart: c.windowStart,
        windowEnd: c.windowEnd,
        slotType: c.slotType,
        status: chosen ? "vald" : "forslag",
        rank: idx,
        score: round2(c.score),
        source: ENGINE_SOURCE,
        metadata: {
          reason: c.reason,
          executionCode: p.executionCode,
          valueOre: p.valueOre,
          costOre: p.costOre,
          durationMinutes: p.durationMinutes,
        },
      });
    });
  }

  // En grupp-rad (klumpuppgift) per klump ≥2: assignmentId NULL, summerade storheter.
  for (const c of clumpGroups) {
    rows.push({
      tenantId,
      assignmentId: null,
      assignmentGroupKey: c.groupKey,
      windowStart: new Date(c.windowStart),
      windowEnd: new Date(c.windowEnd),
      slotType: c.slotType,
      status: "vald",
      rank: 0,
      score: null,
      source: ENGINE_SOURCE,
      metadata: {
        kind: "clump",
        executionCode: c.executionCode,
        groupingBasis: c.groupingBasis,
        memberCount: c.memberCount,
        memberAssignmentIds: c.memberAssignmentIds,
        summedValueOre: c.summedValueOre,
        summedCostOre: c.summedCostOre,
        summedDurationMinutes: c.summedDurationMinutes,
      },
    });
  }

  const created = await storage.createSlotTimes(rows);

  return {
    tenantId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    groupingRadiusMeters,
    streetSideGrouping,
    workPacePercent,
    dailyCapacityMinutes,
    processedAssignments: schedulable.length,
    skippedAssignments: skipped,
    unschedulableAssignments: unschedulable,
    slotsCreated: created,
    taskSlots: rows.filter((r) => r.assignmentId != null).length,
    clumpGroups: clumpGroups.length,
    groups: clumpGroups,
  };
}

// ---------------------------------------------------------------------------
// Dynamisk om-passning (kapacitet per dag)
// ---------------------------------------------------------------------------

/**
 * Väljer en slot per uppgift med hänsyn till daglig kapacitet (minuter).
 * Uppgifterna bearbetas i prioritetsordning (bäst kandidat-poäng först). För
 * varje uppgift väljs den högst rankade kandidaten vars dag har kapacitet kvar;
 * finns ingen sådan väljs ändå bästa kandidaten (overflow markeras i loggen).
 * Mutaterar `prepared[].chosenIndex`.
 */
function applyDailyCapacity(
  prepared: PreparedAssignment[],
  dailyCapacityMinutes: number,
  periodEnd: Date,
): void {
  // Sortera efter bästa kandidat-poäng (högst först), sedan längst uppgift först.
  const order = [...prepared].sort((a, b) => {
    const sa = a.candidates[0]?.score ?? -Infinity;
    const sb = b.candidates[0]?.score ?? -Infinity;
    return sb - sa || b.durationMinutes - a.durationMinutes;
  });

  const dayLoad = new Map<string, number>();

  for (const p of order) {
    let placed = false;
    for (let i = 0; i < p.candidates.length; i++) {
      const c = p.candidates[i];
      const dayKey = toDateKey(c.windowStart);
      const load = dayLoad.get(dayKey) ?? 0;
      if (load + p.durationMinutes <= dailyCapacityMinutes) {
        dayLoad.set(dayKey, load + p.durationMinutes);
        p.chosenIndex = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Ingen kandidatdag har plats → behåll bästa kandidaten (overflow), men
      // bokför ändå belastningen så efterföljande uppgifter ser dagen som full.
      p.chosenIndex = 0;
      const dayKey = toDateKey(p.candidates[0].windowStart);
      dayLoad.set(dayKey, (dayLoad.get(dayKey) ?? 0) + p.durationMinutes);
    }
  }
}

// ---------------------------------------------------------------------------
// DB-helpers
// ---------------------------------------------------------------------------

async function deriveExecutionCodes(
  tenantId: string,
  assignmentIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (assignmentIds.length === 0) return result;
  const links = await storage.getAssignmentArticlesForAssignments(assignmentIds);
  const articles = await storage.getArticles(tenantId);
  const execByArticle = new Map<string, string | null>();
  for (const art of articles) execByArticle.set(art.id, art.executionCode ?? null);
  // Behåll första (lägsta sequenceOrder) artikelns utförandekod per assignment.
  for (const link of links) {
    if (result.has(link.assignmentId)) continue;
    const code = execByArticle.get(link.articleId);
    if (code) result.set(link.assignmentId, code);
  }
  return result;
}

async function resolveDeliveryPrefsByObject(objectIds: string[]) {
  const map = new Map<
    string,
    { weeklyWindows: WeeklyWindow[]; blockedHours: BlockedHour[]; blockedDates: string[] }
  >();
  for (const objectId of objectIds) {
    try {
      const { effective } = await storage.resolveDeliveryPreferences(objectId);
      map.set(objectId, {
        weeklyWindows: effective.weeklyWindows,
        blockedHours: effective.blockedHours,
        blockedDates: effective.blockedDates,
      });
    } catch {
      map.set(objectId, { weeklyWindows: [], blockedHours: [], blockedDates: [] });
    }
  }
  return map;
}

async function resolveGroupingRadiusMeters(tenantId: string): Promise<number> {
  try {
    const radius = await storage.getTenantGroupingRadiusMeters(tenantId);
    if (typeof radius === "number" && Number.isFinite(radius) && radius > 0) return radius;
  } catch {
    /* faller tillbaka på default */
  }
  return DEFAULT_GROUPING_RADIUS_METERS;
}

async function resolveDailyCapacityMinutes(_tenantId: string): Promise<number> {
  return DEFAULT_DAILY_CAPACITY_MINUTES;
}

/** Team-/utförarprofilens grupperings- & ruttoptimerings-premisser. */
export interface TeamGroupingConfig {
  /** Grupperingsradie i meter (positionsbaserad klumpning). */
  radiusMeters: number;
  /** Gatusidesberoende av/på (udda/jämna husnummer var sin grupp). */
  streetSideGrouping: boolean;
  /** Arbetstakt i procent (100 = normal takt). */
  workPacePercent: number;
}

/**
 * Löser upp ett teams grupperings-/ruttpremisser. Team-profilen vinner per fält;
 * saknat/ogiltigt fält faller tillbaka på tenant-default (radie) respektive
 * motorns default (gatusidesberoende på, arbetstakt 100%). Team i annan tenant
 * eller okänt team → ren default.
 */
export async function resolveTeamGroupingConfig(
  tenantId: string,
  teamId: string,
): Promise<TeamGroupingConfig> {
  const tenantRadius = await resolveGroupingRadiusMeters(tenantId);
  try {
    const team = await storage.getTeam(teamId);
    if (team && team.tenantId === tenantId) {
      const radius =
        typeof team.groupingRadiusMeters === "number" &&
        Number.isFinite(team.groupingRadiusMeters) &&
        team.groupingRadiusMeters > 0
          ? team.groupingRadiusMeters
          : tenantRadius;
      const pace =
        typeof team.workPacePercent === "number" &&
        Number.isFinite(team.workPacePercent) &&
        team.workPacePercent > 0
          ? team.workPacePercent
          : DEFAULT_WORK_PACE_PERCENT;
      return {
        radiusMeters: radius,
        streetSideGrouping: team.streetSideGrouping ?? DEFAULT_STREET_SIDE_GROUPING,
        workPacePercent: pace,
      };
    }
  } catch {
    /* faller tillbaka på default nedan */
  }
  return {
    radiusMeters: tenantRadius,
    streetSideGrouping: DEFAULT_STREET_SIDE_GROUPING,
    workPacePercent: DEFAULT_WORK_PACE_PERCENT,
  };
}

// ---------------------------------------------------------------------------
// Småhjälpare
// ---------------------------------------------------------------------------

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  groupingRadiusMeters: number,
  dailyCapacityMinutes: number,
  streetSideGrouping: boolean = DEFAULT_STREET_SIDE_GROUPING,
  workPacePercent: number = DEFAULT_WORK_PACE_PERCENT,
): TimeGeoEngineResult {
  return {
    tenantId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    groupingRadiusMeters,
    streetSideGrouping,
    workPacePercent,
    dailyCapacityMinutes,
    processedAssignments: 0,
    skippedAssignments: 0,
    unschedulableAssignments: 0,
    slotsCreated: 0,
    taskSlots: 0,
    clumpGroups: 0,
    groups: [],
  };
}
