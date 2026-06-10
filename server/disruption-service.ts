import { storage } from "./storage";
import { haversineDistanceKm } from "./distance-matrix-service";
import { notificationService } from "./notifications";

export type DisruptionType = "resource_unavailable" | "emergency_job" | "significant_delay" | "early_completion";

export interface DisruptionEvent {
  id: string;
  type: DisruptionType;
  tenantId: string;
  createdAt: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  affectedResourceId?: string;
  affectedWorkOrderIds: string[];
  suggestions: DisruptionSuggestion[];
  status: "active" | "resolved" | "dismissed";
  decisionTrace: DecisionTraceEntry[];
  /** Nedströms ETA-kaskad (endass för significant_delay). */
  downstreamEta?: DownstreamEtaEntry[];
}

export interface DisruptionSuggestion {
  id: string;
  label: string;
  description: string;
  score: number;
  actions: SuggestionAction[];
}

export interface SuggestionAction {
  type: "reassign" | "insert" | "reschedule" | "notify";
  workOrderId: string;
  workOrderTitle?: string;
  targetResourceId?: string;
  targetResourceName?: string;
  scheduledDate?: string;
  scheduledStartTime?: string;
}

/**
 * Nedströms ETA-kaskad: en post per återstående uppgift på den drabbade
 * resursens dag, med ny beräknad ankomsttid och flagga för tidsfönster-risk.
 */
export interface DownstreamEtaEntry {
  workOrderId: string;
  workOrderTitle: string;
  originalStartTime: string | null; // "HH:MM" enligt ursprunglig plan
  newEtaTime: string | null; // "HH:MM" efter kaskad
  delayMinutes: number; // hur många min uppgiften skjuts fram
  windowEnd: string | null; // önskat/planerat fönster-slut "HH:MM"
  windowRisk: boolean; // ankomst riskerar hamna utanför fönstret
  riskReason?: string;
}

interface DecisionTraceEntry {
  step: string;
  detail: string;
  timestamp: string;
}

const activeDisruptions = new Map<string, DisruptionEvent[]>();

function generateId(): string {
  return `dis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function trace(entries: DecisionTraceEntry[], step: string, detail: string) {
  entries.push({ step, detail, timestamp: new Date().toISOString() });
}

const SWEDISH_WEEKDAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const FINISHED_STATUSES = ["utford", "fakturerad", "avbruten"];

/** Parsa "HH:MM" → minuter sedan midnatt, eller null. */
function parseTimeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

/** Minuter sedan midnatt → "HH:MM" (klamras inom dygnet för visning). */
function minutesToTime(min: number): string {
  const wrapped = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Tidsstämpel → tid-på-dygnet i minuter (lokal tid), eller null. */
function timestampToMinutesOfDay(d?: Date | string | null): number | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function dateToDayString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Normalisera ett scheduledDate-värde (Date eller sträng) till lokal "YYYY-MM-DD". */
function normalizeDayString(value: Date | string): string {
  if (value instanceof Date) return dateToDayString(value);
  const s = String(value);
  // Rena datumsträngar ("2026-06-10" eller "2026-06-10T..") tas som lokal dag.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : dateToDayString(d);
}

export interface CascadeOrder {
  id: string;
  title: string;
  scheduledStartTime: string | null;
  estimatedDuration: number;
  windowEndMin: number | null;
}

/**
 * Räkna om nedströms-ETA för en resurs dagssekvens efter en försening.
 * Första återstående uppgiften skjuts fram med hela förseningen; därefter
 * absorberar naturliga luckor mellan uppgifter en del av förseningen
 * (en uppgift kan aldrig starta innan föregående (försenade) uppgift slutat,
 * men inte heller tidigare än sin ursprungliga starttid).
 */
export function computeDownstreamCascade(orders: CascadeOrder[], delayMinutes: number): DownstreamEtaEntry[] {
  const withStart = orders
    .map(o => ({ o, startMin: parseTimeToMinutes(o.scheduledStartTime) }))
    .filter((x): x is { o: CascadeOrder; startMin: number } => x.startMin !== null)
    .sort((a, b) => a.startMin - b.startMin);
  const withoutStart = orders.filter(o => parseTimeToMinutes(o.scheduledStartTime) === null);

  const result: DownstreamEtaEntry[] = [];
  let prevNewEnd: number | null = null;

  for (let i = 0; i < withStart.length; i++) {
    const { o, startMin } = withStart[i];
    const newStart: number = i === 0 ? startMin + delayMinutes : Math.max(startMin, prevNewEnd ?? startMin);
    const dur = o.estimatedDuration || 60;
    prevNewEnd = newStart + dur;
    const delay = Math.max(0, newStart - startMin);

    let windowRisk = false;
    let riskReason: string | undefined;
    if (o.windowEndMin != null && newStart > o.windowEndMin) {
      windowRisk = true;
      riskReason = `Beräknad ankomst ${minutesToTime(newStart)} efter önskat fönster (t.o.m. ${minutesToTime(o.windowEndMin)})`;
    } else if (newStart >= 1440) {
      windowRisk = true;
      riskReason = "Skjuts till efter arbetsdagens slut";
    }

    result.push({
      workOrderId: o.id,
      workOrderTitle: o.title,
      originalStartTime: minutesToTime(startMin),
      newEtaTime: minutesToTime(newStart),
      delayMinutes: delay,
      windowEnd: o.windowEndMin != null ? minutesToTime(o.windowEndMin) : null,
      windowRisk,
      riskReason,
    });
  }

  for (const o of withoutStart) {
    result.push({
      workOrderId: o.id,
      workOrderTitle: o.title,
      originalStartTime: null,
      newEtaTime: null,
      delayMinutes,
      windowEnd: o.windowEndMin != null ? minutesToTime(o.windowEndMin) : null,
      windowRisk: false,
    });
  }

  return result;
}

export interface AltDayChoice {
  dayString: string; // "YYYY-MM-DD"
  weekday: string; // svenskt veckodagsnamn
  loadMinutes: number; // resursens belastning den dagen
  sameWeek: boolean;
}

/**
 * Välj en alternativ dag (helst samma ISO-vecka, mån–fre) för att flytta en
 * uppgift till. Vi väljer den minst belastade vardagen efter idag inom veckan;
 * om inga vardagar återstår denna vecka faller vi tillbaka på nästa vardag.
 * `loadByDay` är resursens redan planerade produktion (min) per dagsträng.
 */
export function pickAlternativeDay(loadByDay: Map<string, number>): AltDayChoice | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayDow = today.getDay() || 7; // 1=mån … 7=sön
  const daysUntilSunday = 7 - todayDow; // återstående dagar denna ISO-vecka

  const candidates: AltDayChoice[] = [];
  // Endast resten av DENNA ISO-vecka (mån–fre), från imorgon. Spec kräver
  // "annan dag/tid samma vecka" — vi faller aldrig tillbaka på nästa vecka.
  for (let offset = 1; offset <= daysUntilSunday; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // hoppa helg
    const ds = dateToDayString(d);
    candidates.push({ dayString: ds, weekday: SWEDISH_WEEKDAYS[dow], loadMinutes: loadByDay.get(ds) || 0, sameWeek: true });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.loadMinutes - b.loadMinutes);
  return candidates[0];
}

export function getActiveDisruptions(tenantId: string): DisruptionEvent[] {
  return (activeDisruptions.get(tenantId) || []).filter(d => d.status === "active");
}

export function getAllDisruptions(tenantId: string): DisruptionEvent[] {
  return activeDisruptions.get(tenantId) || [];
}

export function resolveDisruption(tenantId: string, disruptionId: string): boolean {
  const events = activeDisruptions.get(tenantId);
  if (!events) return false;
  const event = events.find(e => e.id === disruptionId);
  if (!event) return false;
  event.status = "resolved";
  return true;
}

export function dismissDisruption(tenantId: string, disruptionId: string): boolean {
  const events = activeDisruptions.get(tenantId);
  if (!events) return false;
  const event = events.find(e => e.id === disruptionId);
  if (!event) return false;
  event.status = "dismissed";
  return true;
}

function addDisruption(tenantId: string, event: DisruptionEvent) {
  if (!activeDisruptions.has(tenantId)) activeDisruptions.set(tenantId, []);
  const events = activeDisruptions.get(tenantId)!;
  events.push(event);
  if (events.length > 100) {
    const resolved = events.filter(e => e.status !== "active");
    if (resolved.length > 50) {
      const toRemove = resolved.slice(0, resolved.length - 50);
      for (const r of toRemove) {
        const idx = events.indexOf(r);
        if (idx >= 0) events.splice(idx, 1);
      }
    }
  }
}

export async function triggerResourceUnavailable(
  tenantId: string,
  resourceId: string,
  resourceName: string,
  reason: string = "Sjukanmälan",
): Promise<DisruptionEvent> {
  const decisionTrace: DecisionTraceEntry[] = [];
  trace(decisionTrace, "trigger", `Resource ${resourceName} (${resourceId}) markerad som otillgänglig: ${reason}`);

  const today = new Date().toISOString().split("T")[0];
  const allOrders = await storage.getWorkOrders(tenantId);
  const affectedOrders = allOrders.filter(o => {
    if (o.resourceId !== resourceId) return false;
    if (!o.scheduledDate) return false;
    const dateStr = o.scheduledDate instanceof Date
      ? o.scheduledDate.toISOString().split("T")[0]
      : String(o.scheduledDate).split("T")[0];
    return dateStr >= today && !["utford", "fakturerad", "avbruten"].includes(o.orderStatus);
  });

  trace(decisionTrace, "impact_analysis", `${affectedOrders.length} jobb påverkas av resursbortfall`);

  const allResources = await storage.getResources(tenantId);
  const availableResources = allResources.filter(r => r.id !== resourceId && r.status === "active" && r.resourceType === "person");
  trace(decisionTrace, "candidates", `${availableResources.length} tillgängliga resurser för omdisponering`);

  const suggestions: DisruptionSuggestion[] = [];

  if (affectedOrders.length > 0 && availableResources.length > 0) {
    const resourceLoads: Record<string, number> = {};
    for (const r of availableResources) resourceLoads[r.id] = 0;
    for (const o of allOrders) {
      if (!o.resourceId || !o.scheduledDate) continue;
      const dateStr = o.scheduledDate instanceof Date
        ? o.scheduledDate.toISOString().split("T")[0]
        : String(o.scheduledDate).split("T")[0];
      if (dateStr === today && resourceLoads[o.resourceId] !== undefined) {
        resourceLoads[o.resourceId] += (o.estimatedDuration || 60);
      }
    }

    const scored: Array<{ resource: typeof availableResources[0]; score: number; reasons: string[] }> = [];
    for (const r of availableResources) {
      let score = 50;
      const reasons: string[] = [];
      const load = resourceLoads[r.id] || 0;
      const remaining = 480 - load;
      if (remaining > 240) { score += 20; reasons.push("Mycket ledig kapacitet"); }
      else if (remaining > 120) { score += 10; reasons.push("Bra kapacitet"); }
      else if (remaining < 60) { score -= 20; reasons.push("Begränsad kapacitet"); }

      if (affectedOrders[0]?.taskLatitude && affectedOrders[0]?.taskLongitude && r.homeLatitude && r.homeLongitude) {
        const dist = haversineDistanceKm(affectedOrders[0].taskLatitude, affectedOrders[0].taskLongitude, r.homeLatitude, r.homeLongitude);
        if (dist < 10) { score += 15; reasons.push(`Nära (${dist.toFixed(1)} km)`); }
        else if (dist < 30) { score += 5; reasons.push(`Rimligt avstånd (${dist.toFixed(1)} km)`); }
      }

      scored.push({ resource: r, score, reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    const topCandidates = scored.slice(0, 3);

    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i];
      const actions: SuggestionAction[] = affectedOrders.map(o => ({
        type: "reassign" as const,
        workOrderId: o.id,
        workOrderTitle: o.title || `Order ${o.id.slice(0, 8)}`,
        targetResourceId: candidate.resource.id,
        targetResourceName: candidate.resource.name,
      }));

      suggestions.push({
        id: `sug-${i}`,
        label: `Flytta till ${candidate.resource.name}`,
        description: `${candidate.reasons.join(", ")} (poäng: ${candidate.score})`,
        score: candidate.score,
        actions,
      });

      trace(decisionTrace, `suggestion_${i}`, `${candidate.resource.name}: score=${candidate.score}, ${candidate.reasons.join(", ")}`);
    }
  }

  const event: DisruptionEvent = {
    id: generateId(),
    type: "resource_unavailable",
    tenantId,
    createdAt: new Date().toISOString(),
    title: `${resourceName} är otillgänglig`,
    description: `${reason} — ${affectedOrders.length} jobb påverkas`,
    severity: affectedOrders.length > 3 ? "critical" : "warning",
    affectedResourceId: resourceId,
    affectedWorkOrderIds: affectedOrders.map(o => o.id),
    suggestions,
    status: "active",
    decisionTrace,
  };

  addDisruption(tenantId, event);

  notificationService.broadcastSystemAlert({
    type: "anomaly_alert",
    title: event.title,
    message: event.description,
    resourceId,
    metadata: { disruptionId: event.id, disruptionType: event.type },
  }, tenantId);

  return event;
}

export async function triggerEmergencyJob(
  tenantId: string,
  workOrderId: string,
  workOrderTitle: string,
  latitude?: number,
  longitude?: number,
): Promise<DisruptionEvent> {
  const decisionTrace: DecisionTraceEntry[] = [];
  trace(decisionTrace, "trigger", `Akutjobb skapat: ${workOrderTitle} (${workOrderId})`);

  const allResources = await storage.getResources(tenantId);
  const activeResources = allResources.filter(r => r.status === "active" && r.resourceType === "person");

  const today = new Date().toISOString().split("T")[0];
  const allOrders = await storage.getWorkOrders(tenantId);

  const resourceLoads: Record<string, number> = {};
  for (const r of activeResources) resourceLoads[r.id] = 0;
  for (const o of allOrders) {
    if (!o.resourceId || !o.scheduledDate) continue;
    const dateStr = o.scheduledDate instanceof Date
      ? o.scheduledDate.toISOString().split("T")[0]
      : String(o.scheduledDate).split("T")[0];
    if (dateStr === today && resourceLoads[o.resourceId] !== undefined) {
      resourceLoads[o.resourceId] += (o.estimatedDuration || 60);
    }
  }

  const suggestions: DisruptionSuggestion[] = [];
  const scored: Array<{ resource: typeof activeResources[0]; score: number; distKm: number; travelMin: number }> = [];

  for (const r of activeResources) {
    const remaining = 480 - (resourceLoads[r.id] || 0);
    if (remaining < 30) continue;

    let distKm = 999;
    let travelMin = 999;
    const rLat = r.currentLatitude || r.homeLatitude;
    const rLng = r.currentLongitude || r.homeLongitude;
    if (latitude && longitude && rLat && rLng) {
      distKm = haversineDistanceKm(latitude, longitude, rLat, rLng);
      travelMin = Math.round((distKm / 40) * 60);
    }

    let score = 50;
    if (distKm < 5) score += 30;
    else if (distKm < 15) score += 20;
    else if (distKm < 30) score += 10;
    if (remaining > 240) score += 10;

    scored.push({ resource: r, score, distKm, travelMin });
  }

  scored.sort((a, b) => b.score - a.score);
  trace(decisionTrace, "candidates", `${scored.length} resurser utvärderade, top=${scored[0]?.resource.name || "ingen"}`);

  for (let i = 0; i < Math.min(3, scored.length); i++) {
    const c = scored[i];
    suggestions.push({
      id: `sug-${i}`,
      label: `${c.resource.name} (${c.travelMin < 999 ? `${c.travelMin} min bort` : "okänt avstånd"})`,
      description: `Närmaste tillgängliga resurs, ${c.distKm < 999 ? `${c.distKm.toFixed(1)} km` : ""} (poäng: ${c.score})`,
      score: c.score,
      actions: [{
        type: "insert",
        workOrderId,
        workOrderTitle,
        targetResourceId: c.resource.id,
        targetResourceName: c.resource.name,
        scheduledDate: today,
      }],
    });
    trace(decisionTrace, `suggestion_${i}`, `${c.resource.name}: dist=${c.distKm.toFixed(1)}km, travel=${c.travelMin}min, score=${c.score}`);
  }

  const event: DisruptionEvent = {
    id: generateId(),
    type: "emergency_job",
    tenantId,
    createdAt: new Date().toISOString(),
    title: "Akutjobb inkommit",
    description: `${workOrderTitle} — ${scored.length > 0 ? `Närmaste: ${scored[0].resource.name} (${scored[0].travelMin < 999 ? `${scored[0].travelMin} min` : "?"})` : "Inga resurser tillgängliga"}`,
    severity: "critical",
    affectedWorkOrderIds: [workOrderId],
    suggestions,
    status: "active",
    decisionTrace,
  };

  addDisruption(tenantId, event);
  notificationService.broadcastSystemAlert({
    type: "anomaly_alert",
    title: event.title,
    message: event.description,
    metadata: { disruptionId: event.id, disruptionType: event.type },
  }, tenantId);

  return event;
}

export async function triggerSignificantDelay(
  tenantId: string,
  workOrderId: string,
  workOrderTitle: string,
  resourceId: string,
  resourceName: string,
  estimatedDuration: number,
  actualDuration: number,
): Promise<DisruptionEvent | null> {
  const ratio = actualDuration / Math.max(estimatedDuration, 1);
  if (ratio < 1.5) return null;

  const decisionTrace: DecisionTraceEntry[] = [];
  trace(decisionTrace, "trigger", `Jobb ${workOrderTitle} tar ${ratio.toFixed(1)}x längre tid (${actualDuration} vs ${estimatedDuration} min)`);

  const allOrders = await storage.getWorkOrders(tenantId);

  // Förankra dagen till det FÖRSENADE jobbets planerade dag (ej server-UTC-"idag")
  // så kaskaden alltid gäller rätt dagssekvens, även kring tidszonsgränser.
  const delayedOrder = allOrders.find(o => o.id === workOrderId);
  const anchorDay = delayedOrder?.scheduledDate
    ? normalizeDayString(delayedOrder.scheduledDate)
    : normalizeDayString(new Date());
  const delayedStartMin = parseTimeToMinutes(delayedOrder?.scheduledStartTime ?? null);

  const remainingOrders = allOrders.filter(o => {
    if (o.resourceId !== resourceId || !o.scheduledDate) return false;
    if (o.id === workOrderId || FINISHED_STATUSES.includes(o.orderStatus)) return false;
    if (normalizeDayString(o.scheduledDate) !== anchorDay) return false;
    // Endast nedströms: jobb som startar på/efter det försenade jobbet (eller saknar
    // starttid och därmed inte kan placeras före det i sekvensen).
    if (delayedStartMin != null) {
      const startMin = parseTimeToMinutes(o.scheduledStartTime ?? null);
      if (startMin != null && startMin < delayedStartMin) return false;
    }
    return true;
  });

  const delayMinutes = actualDuration - estimatedDuration;
  trace(decisionTrace, "impact", `${delayMinutes} min försening, ${remainingOrders.length} resterande jobb påverkas`);

  // --- Nedströms ETA-kaskad: räkna om ankomsttid för ALLA resterande jobb ---
  const cascadeOrders: CascadeOrder[] = remainingOrders.map(o => ({
    id: o.id,
    title: o.title || `Order ${o.id.slice(0, 8)}`,
    scheduledStartTime: o.scheduledStartTime ?? null,
    estimatedDuration: o.estimatedDuration || 60,
    // Önskat/planerat fönster-slut: planerat fönster först, annars önskad leverans.
    windowEndMin: timestampToMinutesOfDay(o.plannedWindowEnd ?? o.desiredDeliveryEnd ?? null),
  }));
  const downstreamEta = computeDownstreamCascade(cascadeOrders, delayMinutes);
  const atRiskCount = downstreamEta.filter(e => e.windowRisk).length;
  trace(
    decisionTrace,
    "eta_cascade",
    `Nedströms-ETA omräknad för ${downstreamEta.length} jobb; ${atRiskCount} riskerar sitt tidsfönster`,
  );

  const etaByOrderId = new Map(downstreamEta.map(e => [e.workOrderId, e]));

  const suggestions: DisruptionSuggestion[] = [];

  if (remainingOrders.length > 0) {
    // Förslag 1: skjut fram resterande jobb enligt kaskaden (skriver nya starttider).
    const actions: SuggestionAction[] = remainingOrders.map(o => {
      const eta = etaByOrderId.get(o.id);
      return {
        type: "reschedule" as const,
        workOrderId: o.id,
        workOrderTitle: o.title || `Order ${o.id.slice(0, 8)}`,
        targetResourceId: resourceId,
        targetResourceName: resourceName,
        scheduledStartTime: eta?.newEtaTime ?? undefined,
      };
    });

    suggestions.push({
      id: "sug-delay-adjust",
      label: `Skjut fram resterande ${remainingOrders.length} jobb`,
      description: atRiskCount > 0
        ? `Uppdatera starttider enligt kaskaden — ${atRiskCount} jobb riskerar sitt tidsfönster`
        : `Uppdatera starttider för resterande jobb denna dag`,
      score: 70,
      actions,
    });

    // Förslag 2 (alternativfönster): flytta det mest utsatta jobbet till annan
    // dag samma vecka för att lyfta bort risk/belastning.
    const riskTarget = remainingOrders.find(o => etaByOrderId.get(o.id)?.windowRisk)
      || remainingOrders[remainingOrders.length - 1];
    if (riskTarget) {
      // Resursens belastning per dag (produktion, min) för veckans val.
      const loadByDay = new Map<string, number>();
      for (const o of allOrders) {
        if (o.resourceId !== resourceId || !o.scheduledDate) continue;
        if (FINISHED_STATUSES.includes(o.orderStatus)) continue;
        const ds = normalizeDayString(o.scheduledDate);
        loadByDay.set(ds, (loadByDay.get(ds) || 0) + (o.estimatedDuration || 60));
      }
      const altDay = pickAlternativeDay(loadByDay);
      if (altDay) {
        const targetEta = etaByOrderId.get(riskTarget.id);
        const keepStart = riskTarget.scheduledStartTime || "08:00";

        // Uppskattad restidspåverkan när jobbet flyttas från ankardagen till
        // altDay. Marginalkostnaden i en rutt approximeras som tur-och-retur
        // till närmaste grannjobb samma dag (eller resursens hem-/nuvarande
        // position om dagen saknar andra jobb med koordinater). Restidsdeltat
        // är (insättning på altDay − borttag från ankardagen).
        let travelEffect: string | null = null;
        if (riskTarget.taskLatitude != null && riskTarget.taskLongitude != null) {
          const resource = await storage.getResource(resourceId);
          const homeLat = resource?.currentLatitude ?? resource?.homeLatitude ?? null;
          const homeLng = resource?.currentLongitude ?? resource?.homeLongitude ?? null;
          const targetLat = riskTarget.taskLatitude;
          const targetLng = riskTarget.taskLongitude;

          const coordsForDay = (dayString: string, excludeId?: string) =>
            allOrders
              .filter(o =>
                o.resourceId === resourceId &&
                o.scheduledDate != null &&
                normalizeDayString(o.scheduledDate) === dayString &&
                o.id !== excludeId &&
                !FINISHED_STATUSES.includes(o.orderStatus) &&
                o.taskLatitude != null && o.taskLongitude != null,
              )
              .map(o => ({ lat: o.taskLatitude as number, lng: o.taskLongitude as number }));

          const marginalKm = (others: Array<{ lat: number; lng: number }>): number | null => {
            let min = Infinity;
            for (const o of others) {
              const d = haversineDistanceKm(targetLat, targetLng, o.lat, o.lng);
              if (d < min) min = d;
            }
            if (min !== Infinity) return min;
            if (homeLat != null && homeLng != null) {
              return haversineDistanceKm(targetLat, targetLng, homeLat, homeLng);
            }
            return null;
          };

          const removeKm = marginalKm(coordsForDay(anchorDay, riskTarget.id));
          const insertKm = marginalKm(coordsForDay(altDay.dayString));
          if (removeKm != null && insertKm != null) {
            // Tur-och-retur-detour ≈ 2× närmaste granne; ~35 km/h fältsnitt.
            const deltaMin = Math.round(((insertKm - removeKm) * 2 / 35) * 60);
            if (deltaMin > 0) travelEffect = `+${deltaMin} min restid`;
            else if (deltaMin < 0) travelEffect = `${deltaMin} min restid`;
            else travelEffect = "oförändrad restid";
          }
        }

        const effectParts: string[] = [];
        if (targetEta?.windowRisk) effectParts.push("tar bort tidsfönster-risk idag");
        effectParts.push(`flyttar ${riskTarget.estimatedDuration || 60} min produktion till ${altDay.weekday}`);
        if (travelEffect) effectParts.push(travelEffect);
        effectParts.push(`vald dag har lägst belastning (${Math.round((altDay.loadMinutes) / 60 * 10) / 10} h planerat)`);
        suggestions.push({
          id: "sug-delay-alt-window",
          label: `Flytta ${riskTarget.title || "jobbet"} till ${altDay.weekday} ${keepStart}`,
          description: `Alternativfönster${altDay.sameWeek ? " (samma vecka)" : ""}: ${effectParts.join(", ")}.`,
          score: targetEta?.windowRisk ? 75 : 55,
          actions: [{
            type: "reschedule",
            workOrderId: riskTarget.id,
            workOrderTitle: riskTarget.title || `Order ${riskTarget.id.slice(0, 8)}`,
            targetResourceId: resourceId,
            targetResourceName: resourceName,
            scheduledDate: altDay.dayString,
            scheduledStartTime: keepStart,
          }],
        });
        trace(
          decisionTrace,
          "alt_window",
          `Alternativfönster: ${riskTarget.title || riskTarget.id} → ${altDay.dayString} (${altDay.weekday}), belastning ${altDay.loadMinutes} min${travelEffect ? `, restidspåverkan ${travelEffect}` : ""}`,
        );
      }
    }
  }

  const event: DisruptionEvent = {
    id: generateId(),
    type: "significant_delay",
    tenantId,
    createdAt: new Date().toISOString(),
    title: `Fördröjning: ${workOrderTitle}`,
    description: `${resourceName} — jobbet tar ${ratio.toFixed(1)}x längre (+${delayMinutes} min). ${remainingOrders.length} efterföljande jobb påverkas${atRiskCount > 0 ? `, ${atRiskCount} riskerar tidsfönster` : ""}.`,
    severity: ratio > 2.0 || atRiskCount > 0 ? "critical" : "warning",
    affectedResourceId: resourceId,
    affectedWorkOrderIds: [workOrderId, ...remainingOrders.map(o => o.id)],
    suggestions,
    status: "active",
    decisionTrace,
    downstreamEta,
  };

  addDisruption(tenantId, event);
  notificationService.broadcastSystemAlert({
    type: "anomaly_alert",
    title: event.title,
    message: event.description,
    resourceId,
    metadata: { disruptionId: event.id, disruptionType: event.type },
  }, tenantId);

  return event;
}

export async function triggerEarlyCompletion(
  tenantId: string,
  resourceId: string,
  resourceName: string,
  slackMinutes: number,
): Promise<DisruptionEvent | null> {
  if (slackMinutes < 45) return null;

  const decisionTrace: DecisionTraceEntry[] = [];
  trace(decisionTrace, "trigger", `${resourceName} har ${slackMinutes} min ledig tid kvar idag`);

  const resource = await storage.getResource(resourceId);
  const allOrders = await storage.getWorkOrders(tenantId);
  const unplanned = allOrders.filter(o =>
    !o.resourceId && !["utford", "fakturerad", "avbruten"].includes(o.orderStatus)
  );

  trace(decisionTrace, "scan", `${unplanned.length} oplanerade jobb hittade`);

  const rLat = resource?.currentLatitude || resource?.homeLatitude;
  const rLng = resource?.currentLongitude || resource?.homeLongitude;

  const nearby = unplanned
    .filter(o => {
      if (!o.taskLatitude || !o.taskLongitude || !rLat || !rLng) return false;
      const dur = o.estimatedDuration || 60;
      if (dur > slackMinutes) return false;
      const dist = haversineDistanceKm(rLat, rLng, o.taskLatitude, o.taskLongitude);
      return dist < 20;
    })
    .map(o => ({
      order: o,
      dist: haversineDistanceKm(rLat!, rLng!, o.taskLatitude!, o.taskLongitude!),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  trace(decisionTrace, "nearby", `${nearby.length} närliggande jobb inom 20 km`);

  const suggestions: DisruptionSuggestion[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (let i = 0; i < Math.min(3, nearby.length); i++) {
    const n = nearby[i];
    suggestions.push({
      id: `sug-slack-${i}`,
      label: `Ta ${n.order.title || "jobb"} (${n.dist.toFixed(1)} km bort)`,
      description: `${n.order.estimatedDuration || 60} min beräknad tid, ${n.dist.toFixed(1)} km bort`,
      score: 80 - Math.round(n.dist * 2),
      actions: [{
        type: "insert",
        workOrderId: n.order.id,
        workOrderTitle: n.order.title || `Order ${n.order.id.slice(0, 8)}`,
        targetResourceId: resourceId,
        targetResourceName: resourceName,
        scheduledDate: today,
      }],
    });
    trace(decisionTrace, `suggestion_${i}`, `${n.order.title}: ${n.dist.toFixed(1)}km, ${n.order.estimatedDuration}min`);
  }

  if (suggestions.length === 0) return null;

  const event: DisruptionEvent = {
    id: generateId(),
    type: "early_completion",
    tenantId,
    createdAt: new Date().toISOString(),
    title: `${resourceName} har ledig tid`,
    description: `${slackMinutes} min kvar — ${nearby.length} närliggande jobb tillgängliga`,
    severity: "info",
    affectedResourceId: resourceId,
    affectedWorkOrderIds: nearby.map(n => n.order.id),
    suggestions,
    status: "active",
    decisionTrace,
  };

  addDisruption(tenantId, event);
  notificationService.broadcastSystemAlert({
    type: "anomaly_alert",
    title: event.title,
    message: event.description,
    resourceId,
    metadata: { disruptionId: event.id, disruptionType: event.type },
  }, tenantId);

  return event;
}

/**
 * Avisera nedströmskunder vars tidsfönster påverkats av en kaskaderande
 * försening. Planerar-utlöst (opt-in) — itererar `downstreamEta` för en aktiv
 * significant_delay-störning och skickar en ETA-uppdatering per drabbad kund
 * via det befintliga ETA-/SMS-flödet. Endast jobb som faktiskt skjutits fram
 * (delayMinutes > 0) och har en ny beräknad ankomsttid aviseras.
 */
export async function notifyDownstreamCustomers(
  tenantId: string,
  disruptionId: string,
): Promise<{ notified: number; skipped: number; failed: number; details: string[] }> {
  const events = activeDisruptions.get(tenantId);
  const event = events?.find(e => e.id === disruptionId);
  if (!event) throw new Error("Störning ej hittad");

  const entries = (event.downstreamEta || []).filter(e => e.delayMinutes > 0 && e.newEtaTime);
  if (entries.length === 0) {
    return { notified: 0, skipped: 0, failed: 0, details: ["Inga nedströmskunder med påverkat tidsfönster att avisera"] };
  }

  const { triggerDownstreamEtaNotification } = await import("./eta-notification-service");

  const details: string[] = [];
  let notified = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    const res = await triggerDownstreamEtaNotification(
      entry.workOrderId,
      tenantId,
      entry.newEtaTime,
      entry.delayMinutes,
    );
    const label = res.customerName || entry.workOrderTitle;
    if (res.sent) {
      notified++;
      details.push(`${label}: aviserad (ny ETA ${entry.newEtaTime})`);
    } else if (res.reason === "Skickad") {
      notified++;
    } else if (/avaktiverat|kontaktuppgifter|avaktiverade/i.test(res.reason)) {
      skipped++;
      details.push(`${label}: hoppad — ${res.reason}`);
    } else {
      failed++;
      details.push(`${label}: misslyckades — ${res.reason}`);
    }
  }

  event.decisionTrace.push({
    step: "notify_downstream",
    detail: `Nedströmsavisering: ${notified} aviserade, ${skipped} hoppade, ${failed} misslyckades`,
    timestamp: new Date().toISOString(),
  });

  return { notified, skipped, failed, details };
}

export async function applySuggestion(
  tenantId: string,
  disruptionId: string,
  suggestionId: string,
): Promise<{ applied: number; details: string[] }> {
  const events = activeDisruptions.get(tenantId);
  if (!events) throw new Error("Inga störningar hittade");

  const event = events.find(e => e.id === disruptionId);
  if (!event) throw new Error("Störning ej hittad");

  const suggestion = event.suggestions.find(s => s.id === suggestionId);
  if (!suggestion) throw new Error("Förslag ej hittat");

  const details: string[] = [];
  let applied = 0;
  let datesMoved = false;
  const today = new Date().toISOString().split("T")[0];

  for (const action of suggestion.actions) {
    try {
      // Defense-in-depth: verifiera att ordern tillhör tenanten innan UPDATE
      // (storage.updateWorkOrder är en rå-ID-helper utan tenant-predikat).
      const existing = await storage.getWorkOrder(action.workOrderId);
      if (!existing || existing.tenantId !== tenantId) {
        details.push(`Fel: ${action.workOrderTitle || action.workOrderId} tillhör inte denna tenant`);
        continue;
      }

      if (action.type === "reassign" || action.type === "insert") {
        await storage.updateWorkOrder(action.workOrderId, {
          resourceId: action.targetResourceId,
          scheduledDate: action.scheduledDate ? new Date(action.scheduledDate) : new Date(today),
          orderStatus: "planerad_resurs",
        });
        if (action.scheduledDate) datesMoved = true;
        details.push(`${action.workOrderTitle || action.workOrderId} → ${action.targetResourceName || action.targetResourceId}`);
        applied++;
      } else if (action.type === "reschedule") {
        const update: Partial<{ scheduledDate: Date; scheduledStartTime: string }> = {};
        if (action.scheduledDate) update.scheduledDate = new Date(action.scheduledDate);
        if (action.scheduledStartTime) update.scheduledStartTime = action.scheduledStartTime;
        if (Object.keys(update).length > 0) {
          await storage.updateWorkOrder(action.workOrderId, update);
          if (action.scheduledDate) datesMoved = true;
          const moved = action.scheduledDate ? ` → ${action.scheduledDate}` : "";
          const at = action.scheduledStartTime ? ` ${action.scheduledStartTime}` : "";
          details.push(`${action.workOrderTitle || action.workOrderId}: omplanerad${moved}${at}`);
        } else {
          details.push(`${action.workOrderTitle || action.workOrderId}: tider uppdaterade`);
        }
        applied++;
      }
    } catch (err) {
      details.push(`Fel: ${action.workOrderTitle || action.workOrderId} kunde ej uppdateras`);
    }
  }

  // Berörda dagars KPI:er/risk räknas om när jobb flyttats till annan dag.
  if (datesMoved) {
    try {
      const { computeTenantSlaRisk } = await import("./services/sla-risk-engine");
      await computeTenantSlaRisk(tenantId);
      details.push("SLA-risk omräknad för berörda dagar");
    } catch (err) {
      console.error("[disruption] SLA-risk recompute failed:", err);
    }
  }

  event.status = "resolved";
  event.decisionTrace.push({
    step: "applied",
    detail: `Förslag "${suggestion.label}" tillämpat: ${applied} åtgärder`,
    timestamp: new Date().toISOString(),
  });

  return { applied, details };
}
