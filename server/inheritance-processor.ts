// Hierarki-traversering för objekt (Etapp 5-bantad).
// Tidigare innehöll denna modul arvs-beräkning av specialfält (portkod,
// nyckel, access-info, önskad tid) — de fälten är borttagna ur objects och
// arv sker numera via metadata-systemet. Kvar är ren hierarki-traversering:
// anfäder (via primär parentId), kontextuella anfäder (via object_parents)
// och ättlingar. När ett objekt har flera föräldrar (`object_parents`) är
// den primära relationen speglad till `objects.parentId` (via
// storage.setPrimaryParent), så getAncestorChain följer per definition den
// primära hierarkin. Icke-primära föräldrar (billing/operational/ownership)
// finns för relations-/släktnamns-syften; vill man traversera via en annan
// relation används `contextParentId`/getContextualAncestorChain explicit.
import { db } from "./db";
import { objects, objectParents } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { ServiceObject } from "@shared/schema";

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

      ancestors.push(obj as unknown as import("@shared/schema").ServiceObject);

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
        result.push(child as unknown as import("@shared/schema").ServiceObject);
        queue.push(child.id);
      }
    }

    return result;
  }
}

export async function createInheritanceProcessor(tenantId: string): Promise<InheritanceProcessor> {
  return new InheritanceProcessor(tenantId);
}
