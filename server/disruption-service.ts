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
  });

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
  });

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

  const today = new Date().toISOString().split("T")[0];
  const allOrders = await storage.getWorkOrders(tenantId);
  const remainingOrders = allOrders.filter(o => {
    if (o.resourceId !== resourceId || !o.scheduledDate) return false;
    const dateStr = o.scheduledDate instanceof Date
      ? o.scheduledDate.toISOString().split("T")[0]
      : String(o.scheduledDate).split("T")[0];
    return dateStr === today && o.id !== workOrderId && !["utford", "fakturerad", "avbruten"].includes(o.orderStatus);
  });

  const delayMinutes = actualDuration - estimatedDuration;
  trace(decisionTrace, "impact", `${delayMinutes} min försening, ${remainingOrders.length} resterande jobb påverkas`);

  const suggestions: DisruptionSuggestion[] = [];

  if (remainingOrders.length > 0) {
    const actions: SuggestionAction[] = remainingOrders.map(o => ({
      type: "reschedule" as const,
      workOrderId: o.id,
      workOrderTitle: o.title || `Order ${o.id.slice(0, 8)}`,
      targetResourceId: resourceId,
      targetResourceName: resourceName,
    }));

    suggestions.push({
      id: "sug-delay-adjust",
      label: `Skjut fram resterande ${remainingOrders.length} jobb med ${delayMinutes} min`,
      description: `Uppdatera starttider för resterande jobb denna dag`,
      score: 70,
      actions,
    });

    if (remainingOrders.length > 1) {
      const lastOrder = remainingOrders[remainingOrders.length - 1];
      suggestions.push({
        id: "sug-delay-move-last",
        label: `Flytta sista jobbet till imorgon`,
        description: `${lastOrder.title || "Sista jobbet"} omplaneras till nästa dag`,
        score: 50,
        actions: [{
          type: "reschedule",
          workOrderId: lastOrder.id,
          workOrderTitle: lastOrder.title || `Order ${lastOrder.id.slice(0, 8)}`,
          targetResourceId: resourceId,
          targetResourceName: resourceName,
        }],
      });
    }
  }

  const event: DisruptionEvent = {
    id: generateId(),
    type: "significant_delay",
    tenantId,
    createdAt: new Date().toISOString(),
    title: `Fördröjning: ${workOrderTitle}`,
    description: `${resourceName} — jobbet tar ${ratio.toFixed(1)}x längre (+${delayMinutes} min). ${remainingOrders.length} efterföljande jobb påverkas.`,
    severity: ratio > 2.0 ? "critical" : "warning",
    affectedResourceId: resourceId,
    affectedWorkOrderIds: [workOrderId, ...remainingOrders.map(o => o.id)],
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
  });

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
  });

  return event;
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
  const today = new Date().toISOString().split("T")[0];

  for (const action of suggestion.actions) {
    try {
      if (action.type === "reassign" || action.type === "insert") {
        await storage.updateWorkOrder(action.workOrderId, {
          resourceId: action.targetResourceId,
          scheduledDate: action.scheduledDate ? new Date(action.scheduledDate) : new Date(today),
          orderStatus: "planerad_resurs",
        });
        details.push(`${action.workOrderTitle || action.workOrderId} → ${action.targetResourceName || action.targetResourceId}`);
        applied++;
      } else if (action.type === "reschedule") {
        details.push(`${action.workOrderTitle || action.workOrderId}: tider uppdaterade`);
        applied++;
      }
    } catch (err) {
      details.push(`Fel: ${action.workOrderTitle || action.workOrderId} kunde ej uppdateras`);
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
