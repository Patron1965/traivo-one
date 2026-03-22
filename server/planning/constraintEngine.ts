import type { WorkOrder, Resource, ResourceAvailability, VehicleSchedule, TaskDependencyInstance, ObjectTimeRestriction, ResourceArticle, ResourceVehicle, WorkOrderLine, TeamMember } from "@shared/schema";

export interface ConstraintViolation {
  type: "hard" | "soft";
  category: "locked_order" | "dependency_chain" | "time_window" | "resource_availability" | "vehicle_schedule" | "competency" | "capacity" | "planned_window" | "team_membership";
  severity: "critical" | "warning";
  workOrderId: string;
  resourceId?: string;
  description: string;
}

export interface ScheduleMove {
  workOrderId: string;
  resourceId: string;
  scheduledDate: string;
}

export interface ConstraintContext {
  allOrders: WorkOrder[];
  resources: Resource[];
  resourceAvailability: ResourceAvailability[];
  vehicleSchedules: VehicleSchedule[];
  resourceVehicles: ResourceVehicle[];
  dependencyInstances: TaskDependencyInstance[];
  timeRestrictions: ObjectTimeRestriction[];
  resourceArticles: ResourceArticle[];
  workOrderLines?: WorkOrderLine[];
  teamMembers?: TeamMember[];
}

export function validateSchedule(
  moves: ScheduleMove[],
  ctx: ConstraintContext
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const move of moves) {
    const order = ctx.allOrders.find(o => o.id === move.workOrderId);
    if (!order) continue;

    violations.push(...checkLockedOrder(order, move));
    violations.push(...checkResourceAvailability(move, ctx));
    violations.push(...checkVehicleSchedule(move, ctx));
    violations.push(...checkTimeRestrictions(order, move, ctx));
    violations.push(...checkPlannedWindow(order, move));
    violations.push(...checkTeamMembership(order, move, ctx));
    violations.push(...checkCompetency(order, move, ctx));
  }

  violations.push(...checkDependencyChains(moves, ctx));
  violations.push(...checkCapacityOverload(moves, ctx));

  return violations;
}

function checkLockedOrder(order: WorkOrder, move: ScheduleMove): ConstraintViolation[] {
  if (order.lockedAt) {
    return [{
      type: "hard",
      category: "locked_order",
      severity: "critical",
      workOrderId: move.workOrderId,
      resourceId: move.resourceId,
      description: `Order "${order.title || order.id.slice(0, 8)}" är låst sedan ${formatDate(order.lockedAt)} och kan inte flyttas`
    }];
  }
  return [];
}

function checkResourceAvailability(move: ScheduleMove, ctx: ConstraintContext): ConstraintViolation[] {
  const moveDate = new Date(move.scheduledDate);
  moveDate.setHours(0, 0, 0, 0);

  const unavailable = ctx.resourceAvailability.filter(ra => {
    if (ra.resourceId !== move.resourceId) return false;
    if (ra.isAvailable) return false;

    const raDate = new Date(ra.date);
    raDate.setHours(0, 0, 0, 0);

    if (ra.recurrence === "once") {
      return raDate.getTime() === moveDate.getTime();
    }
    if (ra.recurrence === "weekly") {
      return raDate.getDay() === moveDate.getDay();
    }
    if (ra.recurrence === "daily") {
      return true;
    }
    return raDate.getTime() === moveDate.getTime();
  });

  if (unavailable.length > 0) {
    const ra = unavailable[0];
    const reason = ra.availabilityType === "semester" ? "semester"
      : ra.availabilityType === "sjuk" ? "sjukfrånvaro"
      : ra.availabilityType === "utbildning" ? "utbildning"
      : "ej tillgänglig";

    const resource = ctx.resources.find(r => r.id === move.resourceId);
    return [{
      type: "hard",
      category: "resource_availability",
      severity: "critical",
      workOrderId: move.workOrderId,
      resourceId: move.resourceId,
      description: `${resource?.name || "Resurs"} är ${reason} den ${move.scheduledDate}`
    }];
  }
  return [];
}

function checkVehicleSchedule(move: ScheduleMove, ctx: ConstraintContext): ConstraintViolation[] {
  const resourceVehicleLinks = ctx.resourceVehicles.filter(rv => rv.resourceId === move.resourceId);
  if (resourceVehicleLinks.length === 0) return [];

  const vehicleIds = resourceVehicleLinks.map(rv => rv.vehicleId);

  const moveDate = new Date(move.scheduledDate);
  moveDate.setHours(0, 0, 0, 0);

  const conflicts = ctx.vehicleSchedules.filter(vs => {
    if (!vehicleIds.includes(vs.vehicleId)) return false;
    if (vs.scheduleType === "tillganglig") return false;

    const vsDate = new Date(vs.date);
    vsDate.setHours(0, 0, 0, 0);
    return vsDate.getTime() === moveDate.getTime();
  });

  if (conflicts.length > 0) {
    const vs = conflicts[0];
    const reason = vs.scheduleType === "service" ? "service"
      : vs.scheduleType === "reparation" ? "reparation"
      : vs.scheduleType === "besiktning" ? "besiktning"
      : "ej tillgängligt";

    const resource = ctx.resources.find(r => r.id === move.resourceId);
    return [{
      type: "hard",
      category: "vehicle_schedule",
      severity: "critical",
      workOrderId: move.workOrderId,
      resourceId: move.resourceId,
      description: `Fordon tilldelat ${resource?.name || "resurs"} har ${reason} den ${move.scheduledDate}`
    }];
  }
  return [];
}

function checkTimeRestrictions(order: WorkOrder, move: ScheduleMove, ctx: ConstraintContext): ConstraintViolation[] {
  if (!order.objectId) return [];

  const restrictions = ctx.timeRestrictions.filter(tr =>
    tr.objectId === order.objectId && tr.isActive
  );

  const moveDate = new Date(move.scheduledDate);
  const dayOfWeek = moveDate.getDay() === 0 ? 7 : moveDate.getDay();

  const violations: ConstraintViolation[] = [];

  for (const tr of restrictions) {
    if (tr.validFromDate && new Date(tr.validFromDate) > moveDate) continue;
    if (tr.validToDate && new Date(tr.validToDate) < moveDate) continue;

    const weekdays = tr.weekdays || [];
    if (weekdays.length > 0 && !weekdays.includes(dayOfWeek)) continue;

    if (tr.isBlockingAllDay) {
      const severity = tr.preference === "blocked" ? "critical" : "warning";
      const type = tr.preference === "blocked" ? "hard" : "soft";
      violations.push({
        type,
        category: "time_window",
        severity,
        workOrderId: move.workOrderId,
        description: `Objekt har tidsrestriktion (${tr.restrictionType}): ${tr.description || tr.reason || "blockerat"} den ${move.scheduledDate}`
      });
    }
  }

  return violations;
}

function checkTeamMembership(order: WorkOrder, move: ScheduleMove, ctx: ConstraintContext): ConstraintViolation[] {
  if (!order.teamId || !ctx.teamMembers || ctx.teamMembers.length === 0) return [];

  const isMember = ctx.teamMembers.some(
    tm => tm.teamId === order.teamId && tm.resourceId === move.resourceId
  );

  if (!isMember) {
    const resource = ctx.resources.find(r => r.id === move.resourceId);
    return [{
      type: "hard",
      category: "team_membership",
      severity: "critical",
      workOrderId: move.workOrderId,
      resourceId: move.resourceId,
      description: `${resource?.name || "Resurs"} tillhör inte teamet som är tilldelat denna order`
    }];
  }

  return [];
}

function checkPlannedWindow(order: WorkOrder, move: ScheduleMove): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const moveDate = new Date(move.scheduledDate);
  moveDate.setHours(0, 0, 0, 0);

  if (order.plannedWindowStart) {
    const windowStart = new Date(order.plannedWindowStart);
    windowStart.setHours(0, 0, 0, 0);
    if (moveDate < windowStart) {
      violations.push({
        type: "hard",
        category: "planned_window",
        severity: "critical",
        workOrderId: move.workOrderId,
        resourceId: move.resourceId,
        description: `Order "${order.title || order.id.slice(0, 8)}" schemalagd ${move.scheduledDate} men fönstret öppnar ${formatDate(windowStart)}`
      });
    }
  }

  if (order.plannedWindowEnd) {
    const windowEnd = new Date(order.plannedWindowEnd);
    windowEnd.setHours(0, 0, 0, 0);
    if (moveDate > windowEnd) {
      violations.push({
        type: "hard",
        category: "planned_window",
        severity: "critical",
        workOrderId: move.workOrderId,
        resourceId: move.resourceId,
        description: `Order "${order.title || order.id.slice(0, 8)}" schemalagd ${move.scheduledDate} men fönstret stänger ${formatDate(windowEnd)}`
      });
    }
  }

  return violations;
}

function checkCompetency(order: WorkOrder, move: ScheduleMove, ctx: ConstraintContext): ConstraintViolation[] {
  const resource = ctx.resources.find(r => r.id === move.resourceId);
  if (!resource || resource.resourceType === "vehicle") return [];

  const resourceCompetencies = ctx.resourceArticles.filter(ra => ra.resourceId === move.resourceId);
  if (resourceCompetencies.length === 0) return [];

  if (!ctx.workOrderLines || ctx.workOrderLines.length === 0) return [];

  const orderLines = ctx.workOrderLines.filter(wol => wol.workOrderId === order.id && wol.articleId);
  if (orderLines.length === 0) return [];

  const resourceArticleIds = new Set(resourceCompetencies.map(ra => ra.articleId));
  const unmatchedArticles = orderLines.filter(line => !resourceArticleIds.has(line.articleId));

  if (unmatchedArticles.length > 0) {
    return [{
      type: "hard",
      category: "competency",
      severity: "critical",
      workOrderId: move.workOrderId,
      resourceId: move.resourceId,
      description: `${resource.name || "Resurs"} saknar registrerad kompetens för ${unmatchedArticles.length} artikel(ar) på denna order`
    }];
  }

  return [];
}

function checkDependencyChains(moves: ScheduleMove[], ctx: ConstraintContext): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const moveMap = new Map(moves.map(m => [m.workOrderId, m]));

  for (const dep of ctx.dependencyInstances) {
    const parentMove = moveMap.get(dep.parentWorkOrderId);
    const childMove = moveMap.get(dep.childWorkOrderId);

    if (!parentMove && !childMove) continue;

    const parentDate = parentMove?.scheduledDate ||
      (() => {
        const order = ctx.allOrders.find(o => o.id === dep.parentWorkOrderId);
        if (!order?.scheduledDate) return null;
        return order.scheduledDate instanceof Date
          ? order.scheduledDate.toISOString().split("T")[0]
          : String(order.scheduledDate);
      })();

    const childDate = childMove?.scheduledDate ||
      (() => {
        const order = ctx.allOrders.find(o => o.id === dep.childWorkOrderId);
        if (!order?.scheduledDate) return null;
        return order.scheduledDate instanceof Date
          ? order.scheduledDate.toISOString().split("T")[0]
          : String(order.scheduledDate);
      })();

    if (!parentDate || !childDate) continue;

    if (dep.dependencyType === "before" && parentDate > childDate) {
      violations.push({
        type: "hard",
        category: "dependency_chain",
        severity: "critical",
        workOrderId: dep.childWorkOrderId,
        description: `Beroendekedja bruten: överordnad order måste utföras före den ${childDate}, men är planerad till ${parentDate}`
      });
    }

    if (dep.dependencyType === "after" && parentDate < childDate) {
      violations.push({
        type: "hard",
        category: "dependency_chain",
        severity: "critical",
        workOrderId: dep.childWorkOrderId,
        description: `Beroendekedja bruten: överordnad order måste utföras efter den ${childDate}, men är planerad till ${parentDate}`
      });
    }
  }

  return violations;
}

function checkCapacityOverload(moves: ScheduleMove[], ctx: ConstraintContext): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const MAX_HOURS = 8;

  const loadMap: Record<string, Record<string, number>> = {};

  for (const order of ctx.allOrders) {
    if (!order.resourceId || !order.scheduledDate) continue;
    if (order.orderStatus === "fakturerad" || order.orderStatus === "utford") continue;

    const dateStr = order.scheduledDate instanceof Date
      ? order.scheduledDate.toISOString().split("T")[0]
      : String(order.scheduledDate);
    const hours = (order.estimatedDuration || 60) / 60;

    if (!loadMap[order.resourceId]) loadMap[order.resourceId] = {};
    loadMap[order.resourceId][dateStr] = (loadMap[order.resourceId][dateStr] || 0) + hours;
  }

  for (const move of moves) {
    const order = ctx.allOrders.find(o => o.id === move.workOrderId);
    const hours = ((order?.estimatedDuration || 60)) / 60;

    if (!loadMap[move.resourceId]) loadMap[move.resourceId] = {};
    loadMap[move.resourceId][move.scheduledDate] = (loadMap[move.resourceId][move.scheduledDate] || 0) + hours;
  }

  for (const [resourceId, days] of Object.entries(loadMap)) {
    for (const [date, hours] of Object.entries(days)) {
      if (hours > MAX_HOURS * 1.2) {
        const resource = ctx.resources.find(r => r.id === resourceId);
        violations.push({
          type: "soft",
          category: "capacity",
          severity: "warning",
          workOrderId: moves.find(m => m.resourceId === resourceId && m.scheduledDate === date)?.workOrderId || "",
          resourceId,
          description: `${resource?.name || "Resurs"} har ${hours.toFixed(1)}h planerat den ${date} (max ${MAX_HOURS}h)`
        });
      }
    }
  }

  return violations;
}

function formatDate(d: Date | string | null): string {
  if (!d) return "okänt datum";
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().split("T")[0];
}
