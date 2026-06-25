// Arv & konflikt vid flera föräldrar (task #619 — fastställt beslut):
// När ett objekt har flera föräldrar (`object_parents`) ärvs metadata och
// hård-kodade arvsfält (portkod, nyckel, access-info, önskad tid) ALLTID från
// den PRIMÄRA föräldern. Den primära relationen (`object_parents.isPrimary`)
// speglas till `objects.parentId` via storage.setPrimaryParent, så denna
// processor — som följer `parentId` — använder per definition den primära
// hierarkin. Icke-primära föräldrar (billing/operational/ownership) påverkar
// inte arvet; de finns för relations-/släktnamns-syften. Vill man arv via en
// annan relation används `contextParentId`/getContextualAncestorChain explicit.
import { db } from "./db";
import { objects, clusters, objectParents } from "@shared/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
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

  async getAncestorChain(objectId: string, contextParentId?: string): Promise<ServiceObject[]> {
    const ancestors: ServiceObject[] = [];
    // Skydd mot självreferens/cykel: ett objekt vars parentId pekar på sig självt
    // (eller en cyklisk kedja) får aldrig listas som sin egen förälder och får
    // aldrig orsaka en oändlig loop. `seen` bryter så snart en nod återkommer.
    const seen = new Set<string>();
    let currentId: string | null = objectId;
    let isFirst = true;

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
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

      if (isFirst && contextParentId) {
        currentId = contextParentId;
        isFirst = false;
      } else {
        currentId = obj.parentId;
        isFirst = false;
      }
    }

    return ancestors.reverse();
  }

  async getContextualAncestorChain(objectId: string, relationContext: string): Promise<ServiceObject[]> {
    const contextParents = await db
      .select()
      .from(objectParents)
      .where(
        and(
          eq(objectParents.objectId, objectId),
          eq(objectParents.tenantId, this.tenantId)
        )
      );

    const contextParent = contextParents.find(p => p.relationContext === relationContext);
    if (contextParent) {
      return this.getAncestorChain(objectId, contextParent.parentId);
    }

    return this.getAncestorChain(objectId);
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

  // Räknar om ärvda värden för alla objekt som hör till angivna kunder
  // (kund + ev. ättlingar). Kundkoppling via object_payers (primary) — ADR v3.
  // Processar top-down: rötter (objekt utan förälder i mängden) först, sedan
  // deras ättlingar, så att arv hämtas från redan uppdaterade föräldrar.
  async processCustomerHierarchy(customerIds: string[]): Promise<{ processed: number; errors: string[] }> {
    if (customerIds.length === 0) return { processed: 0, errors: [] };
    const idList = sql.join(customerIds.map((id) => sql`${id}`), sql`, `);
    const rows = await db.execute(sql`
      SELECT o.id, o.parent_id, o.name
      FROM objects o
      WHERE o.tenant_id = ${this.tenantId} AND o.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM object_payers op
          WHERE op.object_id = o.id AND op.tenant_id = ${this.tenantId}
            AND op.is_primary = true
            AND op.customer_id IN (${idList})
        )
    `);
    const objs = rows.rows as Array<{ id: string; parent_id: string | null; name: string }>;
    const idSet = new Set(objs.map((o) => o.id));
    const roots = objs.filter((o) => !o.parent_id || !idSet.has(o.parent_id));

    let processed = 0;
    const errors: string[] = [];
    const visited = new Set<string>();

    for (const root of roots) {
      try {
        if (!visited.has(root.id)) {
          await this.updateResolvedValues(root.id);
          visited.add(root.id);
          processed++;
        }
        const descendants = await this.getDescendants(root.id);
        for (const desc of descendants) {
          if (visited.has(desc.id)) continue;
          await this.updateResolvedValues(desc.id);
          visited.add(desc.id);
          processed++;
        }
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
      karl: "Objekt",
    };
    return labels[level] || level;
  }
}

export async function createInheritanceProcessor(tenantId: string): Promise<InheritanceProcessor> {
  return new InheritanceProcessor(tenantId);
}
