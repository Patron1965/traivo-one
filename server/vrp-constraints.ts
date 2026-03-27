import type {
  WorkOrder,
  Resource,
  ServiceObject,
  ObjectTimeRestriction,
  TaskDesiredTimewindow,
  TaskDependencyInstance,
  ResourceArticle,
  ResourceVehicle,
  Vehicle,
} from "@shared/schema";
import { storage } from "./storage";

export interface VRPConstraintOptions {
  respectTimeWindows?: boolean;
  respectSkills?: boolean;
  respectCapacity?: boolean;
  respectDependencies?: boolean;
  tenantId: string;
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
  const resourceIds = resources.map(r => r.id);
  const objectIds = [...new Set(workOrders.map(o => o.objectId).filter(Boolean))];
  const dependencySequences: Array<{ beforeOrderId: string; afterOrderId: string }> = [];

  const [
    timeRestrictions,
    taskTimewindows,
    dependencyInstances,
    resourceArticlesAll,
    resourceVehicleLinks,
    slotPreferences,
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
    resourceIds.length > 0
      ? storage.getResourceArticlesByResourceIds(resourceIds)
      : Promise.resolve([] as ResourceArticle[]),
    options.respectCapacity !== false && resourceIds.length > 0
      ? storage.getResourceVehiclesByResourceIds(resourceIds)
      : Promise.resolve([] as ResourceVehicle[]),
    options.respectTimeWindows !== false && objectIds.length > 0
      ? loadSlotPreferences(options.tenantId, objectIds)
      : Promise.resolve(new Map<string, SlotPreferenceData[]>()),
  ]);

  if (options.respectTimeWindows !== false) {
    applyTimeRestrictions(jobs, workOrders, timeRestrictions, objectMap);
    applyTaskTimewindows(jobs, taskTimewindows);
    applyPreferredTimesAsSoftWindows(jobs, workOrders, objectMap, slotPreferences);
    constraintsApplied.push("time_windows");
  }

  if (options.respectSkills !== false) {
    const filtered = applySkillConstraints(jobs, agents, workOrders, resources);
    preFilteredPairs = filtered;
    constraintsApplied.push("skills");
  }

  if (options.respectCapacity !== false) {
    const applied = await applyCapacityConstraints(agents, resources, resourceVehicleLinks, options.tenantId, jobs);
    if (applied) constraintsApplied.push("capacity");
  }

  if (options.respectDependencies !== false) {
    const deps = applyDependencyConstraints(jobs, workOrders, dependencyInstances);
    dependencySequences.push(...deps);
    if (deps.length > 0) constraintsApplied.push("dependencies");
  }

  if (resourceArticlesAll.length > 0) {
    const applied = applyEfficiencyFactors(jobs, agents, workOrders, resources, resourceArticlesAll);
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

function applyPreferredTimesAsSoftWindows(
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

    const windows: [number, number][] = [];

    const objRecord = obj as Record<string, unknown>;
    const pref1 = (objRecord.resolvedPreferredTime1 as string | null)
      || (objRecord.preferredTime1 as string | null);
    const pref2 = (objRecord.resolvedPreferredTime2 as string | null)
      || (objRecord.preferredTime2 as string | null);

    if (pref1) {
      const startSec = parseTimeToSeconds(pref1);
      if (startSec !== null) {
        const endSec = Math.min(startSec + PREFERRED_TIME_WINDOW_DURATION, DEFAULT_WORK_HOURS[1]);
        if (endSec > startSec) windows.push([startSec, endSec]);
      }
    }

    if (pref2) {
      const startSec = parseTimeToSeconds(pref2);
      if (startSec !== null) {
        const endSec = Math.min(startSec + PREFERRED_TIME_WINDOW_DURATION, DEFAULT_WORK_HOURS[1]);
        if (endSec > startSec) windows.push([startSec, endSec]);
      }
    }

    const objSlots = slotPreferences.get(order.objectId);
    if (objSlots && objSlots.length > 0) {
      for (const slot of objSlots) {
        if (slot.preference !== "preferred") continue;
        const startSec = parseTimeToSeconds(slot.preferredTime);
        if (startSec !== null) {
          const endSec = Math.min(startSec + PREFERRED_TIME_WINDOW_DURATION, DEFAULT_WORK_HOURS[1]);
          if (endSec > startSec) {
            const alreadyIncluded = windows.some(
              ([s, e]) => Math.abs(s - startSec) < 60 && Math.abs(e - endSec) < 60,
            );
            if (!alreadyIncluded) windows.push([startSec, endSec]);
          }
        }
      }
    }

    if (windows.length > 0) {
      job.time_windows = windows;
    }
  }
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
): Promise<boolean> {
  if (resourceVehicleLinks.length === 0) return false;

  const vehicleIds = [...new Set(resourceVehicleLinks.map(rv => rv.vehicleId))];
  if (vehicleIds.length === 0) return false;

  const allVehicles = await storage.getVehicles(tenantId);
  const vehicleMap = new Map(allVehicles.map(v => [v.id, v]));

  let anyAgentHasCapacity = false;

  for (const agent of agents) {
    const resource = resources.find(r => r.id === agent.id);
    if (!resource) continue;

    const primaryLink = resourceVehicleLinks.find(
      rv => rv.resourceId === resource.id && rv.isPrimary
    ) || resourceVehicleLinks.find(rv => rv.resourceId === resource.id);

    if (!primaryLink) continue;

    const vehicle = vehicleMap.get(primaryLink.vehicleId);
    if (!vehicle) continue;

    const capacityTons = vehicle.capacityTons || 0;
    const capacityVolume = vehicle.capacityVolume || 0;

    if (capacityTons > 0 || capacityVolume > 0) {
      agent.capacity = [
        capacityTons > 0 ? Math.round(capacityTons * 1000) : 0,
        capacityVolume > 0 ? Math.round(capacityVolume * 1000) : 0,
      ];
      anyAgentHasCapacity = true;
    }
  }

  if (anyAgentHasCapacity) {
    for (const agent of agents) {
      if (!agent.capacity) {
        agent.capacity = new Array(CAPACITY_DIMS).fill(0);
      }
    }

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
  dependencies: TaskDependencyInstance[],
): Array<{ beforeOrderId: string; afterOrderId: string }> {
  const sequences: Array<{ beforeOrderId: string; afterOrderId: string }> = [];
  const jobIdSet = new Set(jobs.map(j => j.id));
  const jobMap = new Map(jobs.map(j => [j.id, j]));

  const orderedDeps: Array<{ firstId: string; secondId: string }> = [];
  for (const dep of dependencies) {
    const parentId = dep.parentWorkOrderId;
    const childId = dep.childWorkOrderId;

    if (!jobIdSet.has(parentId) || !jobIdSet.has(childId)) continue;

    if (dep.dependencyType === "before" || dep.dependencyType === "sequential") {
      orderedDeps.push({ firstId: parentId, secondId: childId });
    } else if (dep.dependencyType === "after") {
      orderedDeps.push({ firstId: childId, secondId: parentId });
    }
  }

  const graph = new Map<string, string[]>();
  for (const { firstId, secondId } of orderedDeps) {
    const children = graph.get(firstId) || [];
    children.push(secondId);
    graph.set(firstId, children);
  }

  const roots = orderedDeps
    .map(d => d.firstId)
    .filter(id => !orderedDeps.some(d => d.secondId === id));

  const resolvedEndTimes = new Map<string, number>();

  function resolveChain(jobId: string, visited: Set<string>): number {
    if (resolvedEndTimes.has(jobId)) return resolvedEndTimes.get(jobId)!;
    if (visited.has(jobId)) return DEFAULT_WORK_HOURS[1];

    visited.add(jobId);
    const job = jobMap.get(jobId);
    if (!job) return DEFAULT_WORK_HOURS[0];

    const earliestStart = job.time_windows && job.time_windows.length > 0
      ? job.time_windows[0][0]
      : DEFAULT_WORK_HOURS[0];

    const endTime = earliestStart + job.duration;
    resolvedEndTimes.set(jobId, endTime);
    return endTime;
  }

  for (const rootId of roots) {
    resolveChain(rootId, new Set());
  }

  for (const { firstId, secondId } of orderedDeps) {
    sequences.push({ beforeOrderId: firstId, afterOrderId: secondId });

    const firstJob = jobMap.get(firstId);
    const secondJob = jobMap.get(secondId);

    if (!firstJob || !secondJob) continue;

    firstJob.priority = Math.min(100, Math.max(firstJob.priority || 0, (secondJob.priority || 50) + 10));

    const firstEndTime = resolvedEndTimes.get(firstId)
      ?? (DEFAULT_WORK_HOURS[0] + firstJob.duration);

    if (!secondJob.time_windows || secondJob.time_windows.length === 0) {
      secondJob.time_windows = [[firstEndTime, DEFAULT_WORK_HOURS[1]]];
    } else {
      secondJob.time_windows = secondJob.time_windows
        .map(([s, e]) => [Math.max(s, firstEndTime), e] as [number, number])
        .filter(([s, e]) => e > s);
      if (secondJob.time_windows.length === 0) {
        secondJob.time_windows = [[firstEndTime, DEFAULT_WORK_HOURS[1]]];
      }
    }

    resolvedEndTimes.set(secondId,
      (secondJob.time_windows[0][0]) + secondJob.duration);
  }

  return sequences;
}

function applyEfficiencyFactors(
  jobs: EnrichedGeoapifyJob[],
  agents: EnrichedGeoapifyAgent[],
  workOrders: WorkOrder[],
  resources: Resource[],
  resourceArticles: ResourceArticle[],
): boolean {
  if (resourceArticles.length === 0) return false;
  if (agents.length === 0) return false;
  if (agents.length > 1) return false;

  const agentResourceId = agents[0].id;
  if (!agentResourceId) return false;

  const resource = resources.find(r => r.id === agentResourceId);
  if (!resource) return false;

  const articleEfficiency = new Map<string, number>();
  for (const ra of resourceArticles) {
    if (ra.resourceId !== agentResourceId) continue;
    const effFactor = ra.efficiencyFactor || 1.0;
    if (effFactor !== 1.0 && ra.articleId) {
      articleEfficiency.set(ra.articleId, effFactor);
    }
  }

  const baseEff = resource.efficiencyFactor || 1.0;
  if (baseEff === 1.0 && articleEfficiency.size === 0) return false;

  const orderArticleMap = new Map<string, string | null>();
  for (const order of workOrders) {
    orderArticleMap.set(order.id, order.articleId || null);
  }

  let anyAdjusted = false;

  for (const job of jobs) {
    const articleId = orderArticleMap.get(job.id);
    const articleEff = (articleId && articleEfficiency.get(articleId)) || 1.0;
    const combined = baseEff * articleEff;

    if (Math.abs(combined - 1.0) > 0.01) {
      const adjusted = Math.round(job.duration * combined);
      if (adjusted > 0) {
        job.duration = adjusted;
        anyAdjusted = true;
      }
    }
  }

  return anyAdjusted;
}
