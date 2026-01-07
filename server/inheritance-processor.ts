import { db } from "./db";
import { objects, clusters } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { ServiceObject, Cluster } from "@shared/schema";

interface ResolvedObjectData {
  resolvedAccessCode: string | null;
  resolvedKeyNumber: string | null;
  resolvedAccessInfo: Record<string, unknown>;
  resolvedPreferredTime1: string | null;
  resolvedPreferredTime2: string | null;
  hierarchyDepth: number;
  hierarchyPath: string[];
}

interface InheritanceSource {
  field: string;
  value: unknown;
  sourceObjectId: string | null;
  sourceObjectName: string | null;
  inherited: boolean;
}

export interface ObjectWithInheritance extends ServiceObject {
  inheritanceSources?: InheritanceSource[];
}

const HIERARCHY_LEVEL_ORDER: Record<string, number> = {
  koncern: 1,
  brf: 2,
  fastighet: 3,
  rum: 4,
  karl: 5,
};

export class InheritanceProcessor {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async getAncestorChain(objectId: string): Promise<ServiceObject[]> {
    const ancestors: ServiceObject[] = [];
    let currentId: string | null = objectId;

    while (currentId) {
      const [obj] = await db
        .select()
        .from(objects)
        .where(
          and(
            eq(objects.id, currentId),
            eq(objects.tenantId, this.tenantId),
            isNull(objects.deletedAt)
          )
        );

      if (!obj) break;

      ancestors.push(obj);
      currentId = obj.parentId;
    }

    return ancestors.reverse();
  }

  async resolveInheritance(objectId: string): Promise<ResolvedObjectData> {
    const ancestors = await this.getAncestorChain(objectId);

    if (ancestors.length === 0) {
      return {
        resolvedAccessCode: null,
        resolvedKeyNumber: null,
        resolvedAccessInfo: {},
        resolvedPreferredTime1: null,
        resolvedPreferredTime2: null,
        hierarchyDepth: 0,
        hierarchyPath: [],
      };
    }

    const target = ancestors[ancestors.length - 1];
    const hierarchyPath = ancestors.map((a) => a.id);
    const hierarchyDepth = ancestors.length - 1;

    let resolvedAccessCode: string | null = null;
    let resolvedKeyNumber: string | null = null;
    let resolvedAccessInfo: Record<string, unknown> = {};
    let resolvedPreferredTime1: string | null = null;
    let resolvedPreferredTime2: string | null = null;

    for (const ancestor of ancestors) {
      if (ancestor.accessCode && !ancestor.accessCodeInherited) {
        resolvedAccessCode = ancestor.accessCode;
      }

      if (ancestor.keyNumber && !ancestor.keyNumberInherited) {
        resolvedKeyNumber = ancestor.keyNumber;
      }

      if (ancestor.accessInfo && !ancestor.accessInfoInherited) {
        const info = ancestor.accessInfo as Record<string, unknown>;
        resolvedAccessInfo = { ...resolvedAccessInfo, ...info };
      }

      if (ancestor.preferredTime1 && !ancestor.preferredTimeInherited) {
        resolvedPreferredTime1 = ancestor.preferredTime1;
      }

      if (ancestor.preferredTime2 && !ancestor.preferredTimeInherited) {
        resolvedPreferredTime2 = ancestor.preferredTime2;
      }
    }

    return {
      resolvedAccessCode,
      resolvedKeyNumber,
      resolvedAccessInfo,
      resolvedPreferredTime1,
      resolvedPreferredTime2,
      hierarchyDepth,
      hierarchyPath,
    };
  }

  async getObjectWithResolvedValues(objectId: string): Promise<ObjectWithInheritance | null> {
    const [obj] = await db
      .select()
      .from(objects)
      .where(
        and(
          eq(objects.id, objectId),
          eq(objects.tenantId, this.tenantId),
          isNull(objects.deletedAt)
        )
      );

    if (!obj) return null;

    const resolved = await this.resolveInheritance(objectId);
    const ancestors = await this.getAncestorChain(objectId);

    const inheritanceSources: InheritanceSource[] = [];

    for (const field of ["accessCode", "keyNumber", "preferredTime1", "preferredTime2"]) {
      let sourceObj: ServiceObject | null = null;
      let value: unknown = null;
      let inherited = false;

      for (const ancestor of ancestors) {
        const fieldValue = (ancestor as Record<string, unknown>)[field];
        const inheritedFlag = (ancestor as Record<string, unknown>)[`${field}Inherited`];

        if (fieldValue && !inheritedFlag) {
          sourceObj = ancestor;
          value = fieldValue;
          inherited = ancestor.id !== obj.id;
        }
      }

      inheritanceSources.push({
        field,
        value,
        sourceObjectId: sourceObj?.id || null,
        sourceObjectName: sourceObj?.name || null,
        inherited,
      });
    }

    return {
      ...obj,
      resolvedAccessCode: resolved.resolvedAccessCode,
      resolvedKeyNumber: resolved.resolvedKeyNumber,
      resolvedAccessInfo: resolved.resolvedAccessInfo,
      resolvedPreferredTime1: resolved.resolvedPreferredTime1,
      resolvedPreferredTime2: resolved.resolvedPreferredTime2,
      hierarchyDepth: resolved.hierarchyDepth,
      hierarchyPath: resolved.hierarchyPath,
      inheritanceSources,
    };
  }

  async updateResolvedValues(objectId: string): Promise<void> {
    const resolved = await this.resolveInheritance(objectId);

    await db
      .update(objects)
      .set({
        resolvedAccessCode: resolved.resolvedAccessCode,
        resolvedKeyNumber: resolved.resolvedKeyNumber,
        resolvedAccessInfo: resolved.resolvedAccessInfo,
        resolvedPreferredTime1: resolved.resolvedPreferredTime1,
        resolvedPreferredTime2: resolved.resolvedPreferredTime2,
        hierarchyDepth: resolved.hierarchyDepth,
        hierarchyPath: resolved.hierarchyPath,
      })
      .where(eq(objects.id, objectId));
  }

  async updateDescendants(objectId: string): Promise<number> {
    const descendants = await this.getDescendants(objectId);
    let updated = 0;

    for (const descendant of descendants) {
      await this.updateResolvedValues(descendant.id);
      updated++;
    }

    return updated;
  }

  async getDescendants(objectId: string): Promise<ServiceObject[]> {
    const result: ServiceObject[] = [];
    const queue: string[] = [objectId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      const children = await db
        .select()
        .from(objects)
        .where(
          and(
            eq(objects.parentId, currentId),
            eq(objects.tenantId, this.tenantId),
            isNull(objects.deletedAt)
          )
        );

      for (const child of children) {
        result.push(child);
        queue.push(child.id);
      }
    }

    return result;
  }

  async processClusterHierarchy(clusterId: string): Promise<{ processed: number; errors: string[] }> {
    const clusterObjects = await db
      .select()
      .from(objects)
      .where(
        and(
          eq(objects.clusterId, clusterId),
          eq(objects.tenantId, this.tenantId),
          isNull(objects.deletedAt)
        )
      );

    let processed = 0;
    const errors: string[] = [];

    const rootObjects = clusterObjects.filter((o) => !o.parentId);

    for (const root of rootObjects) {
      try {
        await this.updateResolvedValues(root.id);
        const descendants = await this.getDescendants(root.id);

        for (const desc of descendants) {
          await this.updateResolvedValues(desc.id);
          processed++;
        }

        processed++;
      } catch (error) {
        errors.push(`Failed to process ${root.name}: ${error}`);
      }
    }

    return { processed, errors };
  }

  validateHierarchyLevel(parentLevel: string | null, childLevel: string): boolean {
    if (!parentLevel) return true;

    const parentOrder = HIERARCHY_LEVEL_ORDER[parentLevel] || 999;
    const childOrder = HIERARCHY_LEVEL_ORDER[childLevel] || 999;

    return childOrder > parentOrder;
  }

  getHierarchyLevelLabel(level: string): string {
    const labels: Record<string, string> = {
      koncern: "Koncern",
      brf: "BRF",
      fastighet: "Fastighet",
      rum: "Rum",
      karl: "Kärl",
    };
    return labels[level] || level;
  }
}

export async function createInheritanceProcessor(tenantId: string): Promise<InheritanceProcessor> {
  return new InheritanceProcessor(tenantId);
}
