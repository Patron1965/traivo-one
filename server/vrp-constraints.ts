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

  const orderMap = new Map(workOrders.map(o => [o.id, o]));
  const objectMap = new Map(objects.map(o => [o.id, o]));
  const resourceMap = new Map(resources.map(r => [r.id, r]));
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
    options.respectSkills !== false && resourceIds.length > 0
      ? storage.getResourceArticlesByResourceIds(resourceIds)
      : Promise.resolve([] as ResourceArticle[]),
    options.respectCapacity !== false && resourceIds.length > 0
      ? storage.getResourceVehiclesByResourceIds(resourceIds)
      : Promise.resolve([] as ResourceVehicle[]),
  ]);

  if (options.respectTimeWindows !== false) {
    applyTimeRestrictions(jobs, workOrders, timeRestrictions, objectMap);
    applyTaskTimewindows(jobs, taskTimewindows);
    applyObjectPreferredTimes(jobs, workOrders, objectMap);
    constraintsApplied.push("time_windows");
  }

  if (options.respectSkills !== false) {
    const filtered = applySkillConstraints(jobs, agents, workOrders, resources, resourceArticlesAll);
    preFilteredPairs = filtered;
    constraintsApplied.push("skills");
  }

  if (options.respectCapacity !== false) {
    const applied = await applyCapacityConstraints(agents, resources, resourceVehicleLinks, options.tenantId);
    if (applied) constraintsApplied.push("capacity");
  }

  if (options.respectDependencies !== false) {
    const deps = applyDependencyConstraints(jobs, workOrders, dependencyInstances);
    dependencySequences.push(...deps);
    if (deps.length > 0) constraintsApplied.push("dependencies");
  }

  applyEfficiencyFactors(jobs, agents, workOrders, resources, resourceArticlesAll);
  if (resourceArticlesAll.length > 0) constraintsApplied.push("efficiency_factors");

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

function applyObjectPreferredTimes(
  jobs: EnrichedGeoapifyJob[],
  workOrders: WorkOrder[],
  objectMap: Map<string, ServiceObject>,
): void {
  for (const job of jobs) {
    if (job.time_windows && job.time_windows.length > 0) continue;

    const order = workOrders.find(o => o.id === job.id);
    if (!order?.objectId) continue;

    const obj = objectMap.get(order.objectId);
    if (!obj) continue;

    const preferredTime = (obj as Record<string, unknown>).resolvedPreferredTime1 as string | null
      || (obj as Record<string, unknown>).preferredTime1 as string | null;

    if (preferredTime) {
      const startSec = parseTimeToSeconds(preferredTime);
      if (startSec !== null) {
        const endSec = Math.min(startSec + 7200, DEFAULT_WORK_HOURS[1]);
        if (endSec > startSec) {
          job.time_windows = [[startSec, endSec]];
        }
      }
    }
  }
}

function applySkillConstraints(
  jobs: EnrichedGeoapifyJob[],
  agents: EnrichedGeoapifyAgent[],
  workOrders: WorkOrder[],
  resources: Resource[],
  resourceArticles: ResourceArticle[],
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

  const resourceArticleMap = new Map<string, Set<string>>();
  for (const ra of resourceArticles) {
    const set = resourceArticleMap.get(ra.resourceId) || new Set();
    if (ra.articleId) set.add(ra.articleId);
    resourceArticleMap.set(ra.resourceId, set);
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
    } else if (executionCodesSet.size > 0) {
      agent.skills = [...codeToIndex.values()];
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
): Promise<boolean> {
  if (resourceVehicleLinks.length === 0) return false;

  const vehicleIds = [...new Set(resourceVehicleLinks.map(rv => rv.vehicleId))];
  if (vehicleIds.length === 0) return false;

  const allVehicles = await storage.getVehicles(tenantId);
  const vehicleMap = new Map(allVehicles.map(v => [v.id, v]));

  let applied = false;

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
        Math.round((capacityTons || 10) * 1000),
        Math.round((capacityVolume || 20) * 1000),
      ];
      applied = true;
    }
  }

  return applied;
}

function applyDependencyConstraints(
  jobs: EnrichedGeoapifyJob[],
  workOrders: WorkOrder[],
  dependencies: TaskDependencyInstance[],
): Array<{ beforeOrderId: string; afterOrderId: string }> {
  const sequences: Array<{ beforeOrderId: string; afterOrderId: string }> = [];
  const jobIdSet = new Set(jobs.map(j => j.id));

  for (const dep of dependencies) {
    const parentId = dep.parentWorkOrderId;
    const childId = dep.childWorkOrderId;

    if (!jobIdSet.has(parentId) || !jobIdSet.has(childId)) continue;

    if (dep.dependencyType === "before" || dep.dependencyType === "sequential") {
      sequences.push({ beforeOrderId: parentId, afterOrderId: childId });

      const parentJob = jobs.find(j => j.id === parentId);
      const childJob = jobs.find(j => j.id === childId);

      if (parentJob && childJob) {
        if (!parentJob.priority || parentJob.priority <= (childJob.priority || 0)) {
          parentJob.priority = (childJob.priority || 50) + 10;
        }
      }
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
): void {
  if (resourceArticles.length === 0) return;
  if (agents.length === 0) return;

  const articleEfficiencyByResource = new Map<string, Map<string, number>>();
  for (const ra of resourceArticles) {
    const effFactor = ra.efficiencyFactor || 1.0;
    if (effFactor === 1.0) continue;

    const map = articleEfficiencyByResource.get(ra.resourceId) || new Map();
    if (ra.articleId) map.set(ra.articleId, effFactor);
    articleEfficiencyByResource.set(ra.resourceId, map);
  }

  if (articleEfficiencyByResource.size === 0) return;

  const avgEfficiencyByResource = new Map<string, number>();
  for (const [resId, articleMap] of articleEfficiencyByResource) {
    const factors = [...articleMap.values()];
    const avg = factors.reduce((s, f) => s + f, 0) / factors.length;
    avgEfficiencyByResource.set(resId, avg);
  }

  const resourceEfficiency = new Map<string, number>();
  for (const resource of resources) {
    const baseEff = resource.efficiencyFactor || 1.0;
    const articleEff = avgEfficiencyByResource.get(resource.id) || 1.0;
    const combined = baseEff * articleEff;
    if (combined !== 1.0) {
      resourceEfficiency.set(resource.id, combined);
    }
  }

  if (resourceEfficiency.size === 0 || agents.length <= 1) return;

  const avgFactor = [...resourceEfficiency.values()].reduce((s, f) => s + f, 0) / resourceEfficiency.size;

  for (const job of jobs) {
    const adjustedDuration = Math.round(job.duration * avgFactor);
    if (adjustedDuration !== job.duration && adjustedDuration > 0) {
      job.duration = adjustedDuration;
    }
  }
}
