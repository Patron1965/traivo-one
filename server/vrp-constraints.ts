/**
 * VRP Constraint Enrichment for Geoapify Route Planner API
 *
 * Known Geoapify API limitations affecting constraint modeling:
 *
 * 1. EFFICIENCY: Geoapify has ONE duration per job — no per-agent-per-job
 *    durations. Multi-agent scenarios use the mean of per-resource factors
 *    as the best approximation. Single-agent scenarios apply exact factors.
 *
 * 2. PREFERENCES: Geoapify only supports hard time_windows. Preferred times
 *    are modeled as priority boosts (higher priority = solver prefers scheduling
 *    these jobs in better slots) rather than hard feasibility constraints.
 *
 * 3. PRECEDENCE: Geoapify has no native precedence/ordering constraints.
 *    Dependencies are enforced via time_window shifting: child jobs get their
 *    earliest start time set to parent's computed end time (topological order).
 *    This is deterministic but does not account for dynamic travel time between
 *    parent and child.
 *
 * 4. CAPACITY: Only agents with known vehicle data get capacity vectors.
 *    Agents without vehicles remain unconstrained (no zero-capacity blocking).
 *    Capacity is opt-in (disabled by default) for backward compatibility.
 */
import type {
  WorkOrder,
  Resource,
  ServiceObject,
  ObjectTimeRestriction,
  TaskDesiredTimewindow,
  TaskDependencyInstance,
  TaskDependency,
  ResourceArticle,
  ResourceVehicle,
  Vehicle,
} from "@shared/schema";
import { storage } from "./storage";
import type { FrozenTimeRulePackage } from "@shared/delivery-restrictions";
import {
  computeTimeRulePackagesByObject,
  softPreferenceScore,
  softPriorityDelta,
} from "./services/time-rule-package";

export interface VRPConstraintOptions {
  respectTimeWindows?: boolean;
  respectSkills?: boolean;
  respectCapacity?: boolean;
  respectDependencies?: boolean;
  tenantId: string;
  /**
   * När agent.id är ett teamId (team-baserad ruttoptimering): map från
   * teamId → lista av medlemmars resourceIds. Används för att aggregera
   * fordonskapacitet och artikel-effektivitet över alla team-medlemmar.
   * Tomt/utelämnat = klassisk per-resurs-läge.
   */
  teamMemberMap?: Map<string, string[]>;
}

export interface EnrichedGeoapifyJob {
  location: [number, number];
  duration: number;
  priority: number;
  time_windows?: [number, number][];
  id: string;
  description?: string;
  required_skills?: number[];
  pickup?: number[];
  delivery?: number[];
}

export interface EnrichedGeoapifyAgent {
  start_location: [number, number];
  end_location?: [number, number];
  time_windows?: [number, number][];
  breaks?: Array<{ duration: number; time_windows?: [number, number][] }>;
  id?: string;
  description?: string;
  skills?: number[];
  capacity?: number[];
}

export interface ConstraintEnrichmentResult {
  jobs: EnrichedGeoapifyJob[];
  agents: EnrichedGeoapifyAgent[];
  constraintsApplied: string[];
  preFilteredPairs: number;
  dependencySequences: Array<{ beforeOrderId: string; afterOrderId: string }>;
}

const DEFAULT_WORK_HOURS: [number, number] = [8 * 3600, 17 * 3600];
const PREFERRED_TIME_WINDOW_DURATION = 7200;
const DEFAULT_JOB_DEMAND = 1;
const CAPACITY_DIMS = 2;

function parseTimeToSeconds(timeStr: string): number | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 3600 + minutes * 60;
}

export async function enrichVRPRequestWithConstraints(
  jobs: EnrichedGeoapifyJob[],
  agents: EnrichedGeoapifyAgent[],
  workOrders: WorkOrder[],
  resources: Resource[],
  objects: ServiceObject[],
  options: VRPConstraintOptions,
): Promise<ConstraintEnrichmentResult> {
  const constraintsApplied: string[] = [];
  let preFilteredPairs = 0;

  const objectMap = new Map(objects.map(o => [o.id, o]));
  const workOrderIds = workOrders.map(o => o.id);
  // För team-baserad ruttoptimering: utöka resurslistan till att även
  // inkludera alla team-medlemmars resourceIds, så artikel- och fordons-
  // uppslagningar nedan får träff.
  const resourceIdSet = new Set<string>(resources.map(r => r.id));
  if (options.teamMemberMap) {
    for (const memberIds of options.teamMemberMap.values()) {
      for (const id of memberIds) resourceIdSet.add(id);
    }
  }
  const resourceIds = [...resourceIdSet];
  const objectIds = [...new Set(workOrders.map(o => o.objectId).filter(Boolean))];
  const dependencySequences: Array<{ beforeOrderId: string; afterOrderId: string }> = [];

  const [
    timeRestrictions,
    taskTimewindows,
    dependencyInstances,
    taskDependencyBatch,
    resourceArticlesAll,
    resourceVehicleLinks,
    slotPreferences,
    timeRulePackages,
  ] = await Promise.all([
    options.respectTimeWindows !== false && objectIds.length > 0
      ? storage.getObjectTimeRestrictionsByObjectIds(options.tenantId, objectIds)
      : Promise.resolve([] as ObjectTimeRestriction[]),
    options.respectTimeWindows !== false && workOrderIds.length > 0
      ? storage.getTaskTimewindowsBatch(workOrderIds)
      : Promise.resolve({} as Record<string, TaskDesiredTimewindow[]>),
    options.respectDependencies !== false
      ? storage.getTaskDependencyInstances(options.tenantId)
      : Promise.resolve([] as TaskDependencyInstance[]),
    options.respectDependencies !== false && workOrderIds.length > 0
      ? storage.getTaskDependenciesBatch(workOrderIds)
      : Promise.resolve({ dependencies: {} as Record<string, TaskDependency[]>, dependents: {} as Record<string, TaskDependency[]> }),
    resourceIds.length > 0
      ? storage.getResourceArticlesByResourceIds(resourceIds)
      : Promise.resolve([] as ResourceArticle[]),
    options.respectCapacity !== false && resourceIds.length > 0
      ? storage.getResourceVehiclesByResourceIds(resourceIds)
      : Promise.resolve([] as ResourceVehicle[]),
    options.respectTimeWindows !== false && objectIds.length > 0
      ? loadSlotPreferences(options.tenantId, objectIds)
      : Promise.resolve(new Map<string, SlotPreferenceData[]>()),
    // Task #997 (Tidsmotor): livehärledda viktade tidsregel-paket per objekt
    // (mjuka preferenser matas in som prioritetsjustering nedan). Hårda regler
    // rörs ej här — de hanteras av befintliga tidsfönster-mekanismer.
    options.respectTimeWindows !== false && objectIds.length > 0
      ? computeTimeRulePackagesByObject(options.tenantId, objectIds as string[])
      : Promise.resolve(new Map<string, FrozenTimeRulePackage>()),
  ]);

  if (options.respectTimeWindows !== false) {
    applyTimeRestrictions(jobs, workOrders, timeRestrictions, objectMap);
    applyTaskTimewindows(jobs, taskTimewindows);
    applyPreferredTimesAsSoftConstraints(jobs, workOrders, objectMap, slotPreferences);
    const softRulesApplied = applySoftTimeRulePreferences(jobs, workOrders, timeRulePackages);
    constraintsApplied.push("time_windows");
    if (softRulesApplied) constraintsApplied.push("soft_time_rules");
  }

  if (options.respectSkills !== false) {
    const filtered = applySkillConstraints(jobs, agents, workOrders, resources);
    preFilteredPairs = filtered;
    constraintsApplied.push("skills");
  }

  if (options.respectCapacity !== false) {
    const applied = await applyCapacityConstraints(agents, resources, resourceVehicleLinks, options.tenantId, jobs, options.teamMemberMap);
    if (applied) constraintsApplied.push("capacity");
  }

  if (options.respectDependencies !== false) {
    const deps = applyDependencyConstraints(jobs, workOrders, dependencyInstances, taskDependencyBatch);
    dependencySequences.push(...deps);
    if (deps.length > 0) constraintsApplied.push("dependencies");
  }

  if (resourceArticlesAll.length > 0) {
    const applied = applyEfficiencyFactors(jobs, agents, workOrders, resources, resourceArticlesAll, options.teamMemberMap);
    if (applied) constraintsApplied.push("efficiency_factors");
  }

  return {
    jobs,
    agents,
    constraintsApplied,
    preFilteredPairs,
    dependencySequences,
  };
}

function applyTimeRestrictions(
  jobs: EnrichedGeoapifyJob[],
  workOrders: WorkOrder[],
  restrictions: ObjectTimeRestriction[],
  objectMap: Map<string, ServiceObject>,
): void {
  if (restrictions.length === 0) return;

  const restrictionsByObject = new Map<string, ObjectTimeRestriction[]>();
  for (const r of restrictions) {
    if (!r.isActive) continue;
    const list = restrictionsByObject.get(r.objectId) || [];
    list.push(r);
    restrictionsByObject.set(r.objectId, list);
  }

  for (const job of jobs) {
    if (job.time_windows && job.time_windows.length > 0) continue;

    const order = workOrders.find(o => o.id === job.id);
    if (!order?.objectId) continue;

    const objRestrictions = restrictionsByObject.get(order.objectId);
    if (!objRestrictions || objRestrictions.length === 0) continue;

    for (const restriction of objRestrictions) {
      if (restriction.isBlockingAllDay) continue;
      if (restriction.preference === "blocked") continue;

      if (restriction.startTime && restriction.endTime) {
        const startSec = parseTimeToSeconds(restriction.startTime);
        const endSec = parseTimeToSeconds(restriction.endTime);
        if (startSec !== null && endSec !== null && endSec > startSec) {
          if (restriction.restrictionType === "emptying_day" ||
              restriction.restrictionType === "access_restriction") {
            job.time_windows = [[startSec, endSec]];
            break;
          }
          if (restriction.restrictionType === "quiet_hours" ||
              restriction.restrictionType === "parking_ban") {
            const windows: [number, number][] = [];
            if (startSec > DEFAULT_WORK_HOURS[0]) {
              windows.push([DEFAULT_WORK_HOURS[0], startSec]);
            }
            if (endSec < DEFAULT_WORK_HOURS[1]) {
              windows.push([endSec, DEFAULT_WORK_HOURS[1]]);
            }
            if (windows.length > 0) {
              job.time_windows = windows;
              break;
            }
          }
        }
      }
    }
  }
}

function applyTaskTimewindows(
  jobs: EnrichedGeoapifyJob[],
  timewindowsMap: Record<string, TaskDesiredTimewindow[]>,
): void {
  for (const job of jobs) {
    if (job.time_windows && job.time_windows.length > 0) continue;

    const tws = timewindowsMap[job.id];
    if (!tws || tws.length === 0) continue;

    const highestPriority = tws[0];
    if (highestPriority.startTime && highestPriority.endTime) {
      const startSec = parseTimeToSeconds(highestPriority.startTime);
      const endSec = parseTimeToSeconds(highestPriority.endTime);
      if (startSec !== null && endSec !== null && endSec > startSec) {
        job.time_windows = [[startSec, endSec]];
      }
    }
  }
}

interface SlotPreferenceData {
  preferredTime: string;
  preference: string;
}

async function loadSlotPreferences(
  tenantId: string,
  objectIds: string[],
): Promise<Map<string, SlotPreferenceData[]>> {
  const result = new Map<string, SlotPreferenceData[]>();
  try {
    const restrictions = await storage.getObjectTimeRestrictionsByObjectIds(tenantId, objectIds);
    for (const r of restrictions) {
      if (!r.isActive || !r.preference || r.preference === "blocked") continue;
      if (!r.startTime) continue;
      const list = result.get(r.objectId) || [];
      list.push({
        preferredTime: r.startTime,
        preference: r.preference,
      });
      result.set(r.objectId, list);
    }
  } catch {
    // non-critical
  }
  return result;
}

function applyPreferredTimesAsSoftConstraints(
  jobs: EnrichedGeoapifyJob[],
  workOrders: WorkOrder[],
  objectMap: Map<string, ServiceObject>,
  slotPreferences: Map<string, SlotPreferenceData[]>,
): void {
  for (const job of jobs) {
    if (job.time_windows && job.time_windows.length > 0) continue;

    const order = workOrders.find(o => o.id === job.id);
    if (!order?.objectId) continue;

    const obj = objectMap.get(order.objectId);
    if (!obj) continue;

    const objRecord = obj as Record<string, unknown>;
    const pref1 = (objRecord.resolvedPreferredTime1 as string | null)
      || (objRecord.preferredTime1 as string | null);
    const pref2 = (objRecord.resolvedPreferredTime2 as string | null)
      || (objRecord.preferredTime2 as string | null);

    let prefCount = 0;
    if (pref1) prefCount++;
    if (pref2) prefCount++;

    const objSlots = slotPreferences.get(order.objectId);
    if (objSlots) {
      prefCount += objSlots.filter(s => s.preference === "preferred").length;
    }

    if (prefCount > 0) {
      const boost = Math.min(prefCount * 5, 20);
      job.priority = Math.min(100, (job.priority || 50) + boost);
    }
  }
}

/**
 * Task #997 (Tidsmotor): matar in MJUKA viktade tidsregler i optimeringen som en
 * (begränsad) prioritetsjustering. Använder uppgiftens FRYSTA paket
 * (work_orders.frozenTimeRules) om det finns — annars de livehärledda paketen per
 * objekt. Veckodagen härleds ur orderns schemalagda datum (0=Sön … 6=Lör);
 * dagspecifika regler ignoreras när dag saknas. Hårda regler rörs aldrig här.
 * Returnerar true om någon prioritet justerades.
 */
function applySoftTimeRulePreferences(
  jobs: EnrichedGeoapifyJob[],
  workOrders: WorkOrder[],
  packagesByObject: Map<string, FrozenTimeRulePackage>,
): boolean {
  let applied = false;
  for (const job of jobs) {
    const order = workOrders.find(o => o.id === job.id);
    if (!order) continue;

    const frozen = (order as Record<string, unknown>).frozenTimeRules as
      | FrozenTimeRulePackage
      | null
      | undefined;
    const pkg = frozen ?? (order.objectId ? packagesByObject.get(order.objectId) : undefined);
    if (!pkg || pkg.soft.length === 0) continue;

    const sched = order.scheduledDate ? new Date(order.scheduledDate as any) : null;
    const weekday = sched && !Number.isNaN(sched.getTime()) ? sched.getDay() : null;

    const delta = softPriorityDelta(softPreferenceScore(pkg, weekday));
    if (delta === 0) continue;

    job.priority = Math.max(0, Math.min(100, (job.priority || 50) + delta));
    applied = true;
  }
  return applied;
}

function applySkillConstraints(
  jobs: EnrichedGeoapifyJob[],
  agents: EnrichedGeoapifyAgent[],
  workOrders: WorkOrder[],
  resources: Resource[],
): number {
  const executionCodesSet = new Set<string>();

  for (const order of workOrders) {
    if (order.executionCode) executionCodesSet.add(order.executionCode);
  }
  for (const resource of resources) {
    const codes = resource.executionCodes || [];
    for (const code of codes) executionCodesSet.add(code);
  }

  if (executionCodesSet.size === 0) return 0;

  const codeToIndex = new Map<string, number>();
  let idx = 0;
  for (const code of executionCodesSet) {
    codeToIndex.set(code, idx++);
  }

  for (const job of jobs) {
    const order = workOrders.find(o => o.id === job.id);
    if (order?.executionCode) {
      const skillIdx = codeToIndex.get(order.executionCode);
      if (skillIdx !== undefined) {
        job.required_skills = [skillIdx];
      }
    }
  }

  let preFilteredCount = 0;

  for (const agent of agents) {
    const resource = resources.find(r => r.id === agent.id);
    if (!resource) continue;

    const resourceCodes = resource.executionCodes || [];
    const skills: number[] = [];

    for (const code of resourceCodes) {
      const skillIdx = codeToIndex.get(code);
      if (skillIdx !== undefined) skills.push(skillIdx);
    }

    if (skills.length > 0) {
      agent.skills = skills;
    }

    const incompatibleJobs = jobs.filter(j => {
      if (!j.required_skills || j.required_skills.length === 0) return false;
      return !j.required_skills.every(s => (agent.skills || []).includes(s));
    });
    preFilteredCount += incompatibleJobs.length;
  }

  return preFilteredCount;
}

async function applyCapacityConstraints(
  agents: EnrichedGeoapifyAgent[],
  resources: Resource[],
  resourceVehicleLinks: ResourceVehicle[],
  tenantId: string,
  jobs: EnrichedGeoapifyJob[],
  teamMemberMap?: Map<string, string[]>,
): Promise<boolean> {
  if (resourceVehicleLinks.length === 0) return false;

  const vehicleIds = [...new Set(resourceVehicleLinks.map(rv => rv.vehicleId))];
  if (vehicleIds.length === 0) return false;

  const allVehicles = await storage.getVehicles(tenantId);
  const vehicleMap = new Map(allVehicles.map(v => [v.id, v]));

  // Hjälp: hämta primärt fordon för en resurs (resourceId).
  function primaryVehicleForResource(resourceId: string): Vehicle | undefined {
    const primary = resourceVehicleLinks.find(rv => rv.resourceId === resourceId && rv.isPrimary)
      || resourceVehicleLinks.find(rv => rv.resourceId === resourceId);
    if (!primary) return undefined;
    return vehicleMap.get(primary.vehicleId);
  }

  let anyAgentHasCapacity = false;

  for (const agent of agents) {
    if (!agent.id) continue;

    let capacityTons = 0;
    let capacityVolume = 0;

    const memberIds = teamMemberMap?.get(agent.id);
    if (memberIds && memberIds.length > 0) {
      // Team-läge: summera kapacitet från alla medlemmars primära fordon.
      // Samma fordon räknas bara en gång (om flera i teamet delar bil).
      const seenVehicleIds = new Set<string>();
      for (const memberId of memberIds) {
        const vehicle = primaryVehicleForResource(memberId);
        if (!vehicle || seenVehicleIds.has(vehicle.id)) continue;
        seenVehicleIds.add(vehicle.id);
        capacityTons += vehicle.capacityTons || 0;
        capacityVolume += vehicle.capacityVolume || 0;
      }
    } else {
      // Klassiskt per-resurs-läge.
      const resource = resources.find(r => r.id === agent.id);
      if (!resource) continue;
      const vehicle = primaryVehicleForResource(resource.id);
      if (!vehicle) continue;
      capacityTons = vehicle.capacityTons || 0;
      capacityVolume = vehicle.capacityVolume || 0;
    }

    if (capacityTons > 0 || capacityVolume > 0) {
      agent.capacity = [
        capacityTons > 0 ? Math.round(capacityTons * 1000) : 0,
        capacityVolume > 0 ? Math.round(capacityVolume * 1000) : 0,
      ];
      anyAgentHasCapacity = true;
    }
  }

  if (anyAgentHasCapacity) {
    for (const job of jobs) {
      if (!job.pickup || job.pickup.length === 0) {
        job.pickup = new Array(CAPACITY_DIMS).fill(DEFAULT_JOB_DEMAND);
      }
    }
  }

  return anyAgentHasCapacity;
}

function applyDependencyConstraints(
  jobs: EnrichedGeoapifyJob[],
  _workOrders: WorkOrder[],
  dependencyInstances: TaskDependencyInstance[],
  taskDependencyBatch: { dependencies: Record<string, TaskDependency[]>; dependents: Record<string, TaskDependency[]> },
): Array<{ beforeOrderId: string; afterOrderId: string }> {
  const sequences: Array<{ beforeOrderId: string; afterOrderId: string }> = [];
  const jobIdSet = new Set(jobs.map(j => j.id));
  const jobMap = new Map(jobs.map(j => [j.id, j]));

  const edgeSet = new Set<string>();
  const edges: Array<{ firstId: string; secondId: string }> = [];

  function addEdge(firstId: string, secondId: string): void {
    const key = `${firstId}->${secondId}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ firstId, secondId });
  }

  for (const dep of dependencyInstances) {
    const parentId = dep.parentWorkOrderId;
    const childId = dep.childWorkOrderId;

    if (!jobIdSet.has(parentId) || !jobIdSet.has(childId)) continue;

    if (dep.dependencyType === "before" || dep.dependencyType === "sequential") {
      addEdge(parentId, childId);
    } else if (dep.dependencyType === "after") {
      addEdge(childId, parentId);
    }
  }

  for (const [workOrderId, deps] of Object.entries(taskDependencyBatch.dependencies)) {
    for (const dep of deps) {
      if (!jobIdSet.has(dep.workOrderId) || !jobIdSet.has(dep.dependsOnWorkOrderId)) continue;
      addEdge(dep.dependsOnWorkOrderId, dep.workOrderId);
    }
  }

  if (edges.length === 0) return sequences;

  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const allNodes = new Set<string>();

  for (const { firstId, secondId } of edges) {
    allNodes.add(firstId);
    allNodes.add(secondId);
    const children = graph.get(firstId) || [];
    children.push(secondId);
    graph.set(firstId, children);
    inDegree.set(secondId, (inDegree.get(secondId) || 0) + 1);
    if (!inDegree.has(firstId)) inDegree.set(firstId, 0);
  }

  const sorted: string[] = [];
  const queue = [...allNodes].filter(n => (inDegree.get(n) || 0) === 0);

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    const children = graph.get(node) || [];
    for (const child of children) {
      const deg = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, deg);
      if (deg === 0) queue.push(child);
    }
  }

  const resolvedEndTimes = new Map<string, number>();

  for (const nodeId of sorted) {
    const job = jobMap.get(nodeId);
    if (!job) continue;

    const earliestStart = job.time_windows && job.time_windows.length > 0
      ? job.time_windows[0][0]
      : DEFAULT_WORK_HOURS[0];

    resolvedEndTimes.set(nodeId, earliestStart + job.duration);

    const children = graph.get(nodeId) || [];
    for (const childId of children) {
      const childJob = jobMap.get(childId);
      if (!childJob) continue;

      sequences.push({ beforeOrderId: nodeId, afterOrderId: childId });

      job.priority = Math.min(100, Math.max(job.priority || 0, (childJob.priority || 50) + 10));

      const parentEndTime = resolvedEndTimes.get(nodeId)!;

      if (!childJob.time_windows || childJob.time_windows.length === 0) {
        childJob.time_windows = [[parentEndTime, DEFAULT_WORK_HOURS[1]]];
      } else {
        childJob.time_windows = childJob.time_windows
          .map(([s, e]) => [Math.max(s, parentEndTime), e] as [number, number])
          .filter(([s, e]) => e > s);
        if (childJob.time_windows.length === 0) {
          childJob.time_windows = [[parentEndTime, DEFAULT_WORK_HOURS[1]]];
        }
      }

      const childStart = childJob.time_windows[0][0];
      resolvedEndTimes.set(childId, childStart + childJob.duration);
    }
  }

  return sequences;
}

function applyEfficiencyFactors(
  jobs: EnrichedGeoapifyJob[],
  agents: EnrichedGeoapifyAgent[],
  workOrders: WorkOrder[],
  resources: Resource[],
  resourceArticles: ResourceArticle[],
  teamMemberMap?: Map<string, string[]>,
): boolean {
  if (resourceArticles.length === 0) return false;
  if (agents.length === 0) return false;

  const articleEffByResource = new Map<string, Map<string, number>>();
  for (const ra of resourceArticles) {
    const effFactor = ra.efficiencyFactor || 1.0;
    if (effFactor === 1.0 || !ra.articleId) continue;
    const map = articleEffByResource.get(ra.resourceId) || new Map();
    map.set(ra.articleId, effFactor);
    articleEffByResource.set(ra.resourceId, map);
  }

  const resourceBaseEff = new Map<string, number>();
  for (const resource of resources) {
    resourceBaseEff.set(resource.id, resource.efficiencyFactor || 1.0);
  }

  const orderArticleMap = new Map<string, string | null>();
  for (const order of workOrders) {
    orderArticleMap.set(order.id, order.articleId || null);
  }

  // Returnerar effektiv faktor för en specifik agent (resurs ELLER team) givet artikel.
  function effectiveFactorForAgent(agentId: string, articleId: string | null): number {
    const memberIds = teamMemberMap?.get(agentId);
    if (memberIds && memberIds.length > 0) {
      // Team-läge: medelvärde av medlemmarnas effektivitet (base * artikel).
      const memberFactors: number[] = [];
      for (const memberId of memberIds) {
        const baseEff = resourceBaseEff.get(memberId) || 1.0;
        const artMap = articleEffByResource.get(memberId);
        const articleEff = (articleId && artMap?.get(articleId)) || 1.0;
        memberFactors.push(baseEff * articleEff);
      }
      if (memberFactors.length === 0) return 1.0;
      return memberFactors.reduce((a, b) => a + b, 0) / memberFactors.length;
    }
    // Klassiskt per-resurs-läge.
    const baseEff = resourceBaseEff.get(agentId) || 1.0;
    const artMap = articleEffByResource.get(agentId);
    const articleEff = (articleId && artMap?.get(articleId)) || 1.0;
    return baseEff * articleEff;
  }

  let anyAdjusted = false;

  for (const job of jobs) {
    const articleId = orderArticleMap.get(job.id);
    const perAgentFactors: number[] = [];

    for (const agent of agents) {
      if (!agent.id) continue;
      perAgentFactors.push(effectiveFactorForAgent(agent.id, articleId ?? null));
    }

    if (perAgentFactors.length === 0) continue;

    let effectiveFactor: number;
    if (perAgentFactors.length === 1) {
      effectiveFactor = perAgentFactors[0];
    } else {
      const allSame = perAgentFactors.every(f => Math.abs(f - perAgentFactors[0]) < 0.01);
      if (allSame) {
        effectiveFactor = perAgentFactors[0];
      } else {
        effectiveFactor = perAgentFactors.reduce((a, b) => a + b, 0) / perAgentFactors.length;
      }
    }

    if (Math.abs(effectiveFactor - 1.0) > 0.01) {
      const adjusted = Math.round(job.duration * effectiveFactor);
      if (adjusted > 0) {
        job.duration = adjusted;
        anyAdjusted = true;
      }
    }
  }

  return anyAdjusted;
}
