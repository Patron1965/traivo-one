// Arkivering av objekt med preflight — task #552 krav (C).
// Ersätter "radera"-flödet: visar varning om objektet har kopplade aktiva
// ordrar/abonnemang och lagrar metadata om vem som arkiverade + varför.
// Soft-delete-state lagras fortfarande i `objects.deletedAt`.
import { db } from "../db";
import { primaryPayerCustomerIdSqlFor } from "./object-customer";
import { objects, workOrders, subscriptions } from "@shared/schema";
import { and, eq, isNull, ne, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

export type ArchivePreflight = {
  objectId: string;
  hasDescendants: number;
  activeWorkOrders: number;
  totalWorkOrders: number;
  activeSubscriptions: number;
  blockers: string[];
  warnings: string[];
};

const ACTIVE_WO_STATUSES = ["draft", "planned", "scheduled", "in_progress", "ongoing", "pending"];

export async function archivePreflight(objectId: string, tenantId: string): Promise<ArchivePreflight> {
  const [obj] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
  if (!obj) {
    return {
      objectId,
      hasDescendants: 0, activeWorkOrders: 0, totalWorkOrders: 0, activeSubscriptions: 0,
      blockers: ["Objektet hittades inte"],
      warnings: [],
    };
  }

  const descendantsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM objects
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND parent_id = ${objectId}
  `);
  const hasDescendants = Number((descendantsResult.rows[0] as any)?.cnt ?? 0);

  const [woStats] = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = ANY(${ACTIVE_WO_STATUSES}))::int AS active_cnt,
      COUNT(*)::int AS total_cnt
    FROM work_orders
    WHERE tenant_id = ${tenantId} AND object_id = ${objectId} AND deleted_at IS NULL
  `).then(r => r.rows as any[]);
  const activeWorkOrders = Number(woStats?.active_cnt ?? 0);
  const totalWorkOrders = Number(woStats?.total_cnt ?? 0);

  const subsResult = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM subscriptions
    WHERE tenant_id = ${tenantId} AND object_id = ${objectId} AND (status IS NULL OR status NOT IN ('cancelled','ended'))
  `).catch(() => ({ rows: [{ cnt: 0 }] }));
  const activeSubscriptions = Number((subsResult.rows[0] as any)?.cnt ?? 0);

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (hasDescendants > 0) {
    blockers.push(`${hasDescendants} underobjekt är fortfarande aktiva — arkivera eller flytta dem först`);
  }
  if (activeWorkOrders > 0) {
    warnings.push(`${activeWorkOrders} aktiv${activeWorkOrders === 1 ? "" : "a"} arbetsorder är kopplade och fryses i nuvarande status`);
  }
  if (activeSubscriptions > 0) {
    warnings.push(`${activeSubscriptions} aktivt${activeSubscriptions === 1 ? "" : "a"} abonnemang behöver avslutas separat`);
  }
  if (obj.deletedAt) {
    blockers.push("Objektet är redan arkiverat");
  }

  return { objectId, hasDescendants, activeWorkOrders, totalWorkOrders, activeSubscriptions, blockers, warnings };
}

export async function archiveObject(
  objectId: string,
  tenantId: string,
  opts: { archivedBy?: string; archivedReason?: string; force?: boolean },
): Promise<{ ok: boolean; preflight: ArchivePreflight }> {
  const preflight = await archivePreflight(objectId, tenantId);
  if (preflight.blockers.length > 0 && !opts.force) {
    return { ok: false, preflight };
  }
  await db
    .update(objects)
    .set({
      deletedAt: new Date(),
      archivedBy: opts.archivedBy ?? null,
      archivedReason: opts.archivedReason ?? null,
    })
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
  return { ok: true, preflight };
}

export async function restoreObject(objectId: string, tenantId: string): Promise<void> {
  await db
    .update(objects)
    .set({ deletedAt: null, archivedBy: null, archivedReason: null })
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
}

export async function listArchivedObjects(tenantId: string, limit = 200) {
  // customer_id härleds ur Ekonomi-metadatat 'Kund' (Etapp 5) — inte legacy objects.customer_id.
  return db.execute(sql`
    SELECT o.id, o.name, o.object_number,
      ${primaryPayerCustomerIdSqlFor(sql.raw("o.id"))} AS customer_id,
      o.deleted_at AS archived_at, o.archived_by, o.archived_reason
    FROM objects o
    WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NOT NULL
    ORDER BY o.deleted_at DESC
    LIMIT ${limit}
  `).then(r => r.rows);
}

// ============================================================
// Raderingsregeln (Etapp 5, Task #1217): hård preflight — ett objekt får
// endast RADERAS (hard delete) om det är helt oanvänt: inga uppgifter
// (work_orders/assignments, även historiska), inga abonnemang och inga
// barnobjekt. Annars är arkivering enda vägen.
// ============================================================

export type DeletePreflight = {
  objectId: string;
  children: number;
  workOrders: number;
  assignments: number;
  subscriptions: number;
  blockers: string[];
};

export async function deleteObjectPreflight(objectId: string, tenantId: string): Promise<DeletePreflight> {
  const [counts] = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM objects
        WHERE tenant_id = ${tenantId} AND parent_id = ${objectId}) AS children,
      (SELECT COUNT(*)::int FROM object_parents
        WHERE tenant_id = ${tenantId} AND parent_id = ${objectId}) AS alt_children,
      (SELECT COUNT(*)::int FROM work_orders
        WHERE tenant_id = ${tenantId} AND object_id = ${objectId}) AS work_orders,
      (SELECT COUNT(*)::int FROM assignments
        WHERE tenant_id = ${tenantId} AND object_id = ${objectId}) AS assignments,
      (SELECT COUNT(*)::int FROM subscriptions
        WHERE tenant_id = ${tenantId} AND object_id = ${objectId}) AS subscriptions
  `).then(r => r.rows as any[]);

  const children = Number(counts?.children ?? 0) + Number(counts?.alt_children ?? 0);
  const workOrderCount = Number(counts?.work_orders ?? 0);
  const assignmentCount = Number(counts?.assignments ?? 0);
  const subscriptionCount = Number(counts?.subscriptions ?? 0);

  const blockers: string[] = [];
  if (children > 0) blockers.push(`${children} underobjekt`);
  if (workOrderCount > 0) blockers.push(`${workOrderCount} uppgift${workOrderCount === 1 ? "" : "er"} (inkl. historik)`);
  if (assignmentCount > 0) blockers.push(`${assignmentCount} planerad${assignmentCount === 1 ? "" : "e"} uppgift${assignmentCount === 1 ? "" : "er"}`);
  if (subscriptionCount > 0) blockers.push(`${subscriptionCount} abonnemang`);

  return {
    objectId,
    children,
    workOrders: workOrderCount,
    assignments: assignmentCount,
    subscriptions: subscriptionCount,
    blockers,
  };
}

// ============================================================
// Massradering (Task #1428): batch-variant av raderingsregeln ovan.
// Samma regler som enkelradering, men:
//  - preflight körs batchat (inga N+1-queries per objekt),
//  - urvalet raderas i topologisk ordning (barn före föräldrar) så att
//    hela markerade delträd kan raderas i ett svep,
//  - per-objekt-resultat med läsbar orsak för blockerade objekt.
// ============================================================

export type BulkDeleteItemResult = {
  id: string;
  status: "deleted" | "blocked";
  reason?: string;
};

export type BulkDeleteResult = {
  deleted: number;
  blocked: number;
  results: BulkDeleteItemResult[];
};

const DELETE_CHUNK_SIZE = 100;

// drizzle sql`` expanderar en JS-array till ($1,$2,...) — bygg IN-listor explicit.
const sqlIdList = (arr: string[]) => sql.join(arr.map((v) => sql`${v}`), sql`, `);

export async function bulkDeleteObjects(rawIds: string[], tenantId: string): Promise<BulkDeleteResult> {
  const ids = Array.from(new Set(rawIds));
  const results = new Map<string, BulkDeleteItemResult>();
  if (ids.length === 0) return { deleted: 0, blocked: 0, results: [] };

  // 1) Ladda urvalets objekt (tenant-scopat). Saknade id:n = fel tenant eller
  //    redan borttagna → blockerade med "hittades inte" (ingen cross-tenant-läcka).
  const objRows = await db.execute(sql`
    SELECT id, parent_id FROM objects
    WHERE tenant_id = ${tenantId} AND id IN (${sqlIdList(ids)})
  `).then(r => r.rows as Array<{ id: string; parent_id: string | null }>);
  const inSelection = new Set(objRows.map(r => r.id));
  const notFound: BulkDeleteItemResult[] = [];
  for (const id of ids) {
    if (!inSelection.has(id)) {
      notFound.push({ id, status: "blocked", reason: "Objektet hittades inte" });
    }
  }
  // Hela urvalet fanns inte i tenanten (fel tenant/redan borttagna) → svara
  // direkt; tomma IN-listor är dessutom ogiltig SQL.
  if (inSelection.size === 0) {
    return { deleted: 0, blocked: notFound.length, results: notFound };
  }

  // 2) Batchad preflight — samma räkningar som deleteObjectPreflight, grupperade.
  const selIds = Array.from(inSelection);
  const [childRows, altChildRows, woRows, asgRows, subRows] = await Promise.all([
    db.execute(sql`
      SELECT id, parent_id FROM objects
      WHERE tenant_id = ${tenantId} AND parent_id IN (${sqlIdList(selIds)})
    `).then(r => r.rows as Array<{ id: string; parent_id: string }>),
    db.execute(sql`
      SELECT object_id, parent_id FROM object_parents
      WHERE tenant_id = ${tenantId} AND parent_id IN (${sqlIdList(selIds)})
    `).then(r => r.rows as Array<{ object_id: string; parent_id: string }>),
    db.execute(sql`
      SELECT object_id, COUNT(*)::int AS cnt FROM work_orders
      WHERE tenant_id = ${tenantId} AND object_id IN (${sqlIdList(selIds)}) GROUP BY object_id
    `).then(r => r.rows as Array<{ object_id: string; cnt: number }>),
    db.execute(sql`
      SELECT object_id, COUNT(*)::int AS cnt FROM assignments
      WHERE tenant_id = ${tenantId} AND object_id IN (${sqlIdList(selIds)}) GROUP BY object_id
    `).then(r => r.rows as Array<{ object_id: string; cnt: number }>),
    db.execute(sql`
      SELECT object_id, COUNT(*)::int AS cnt FROM subscriptions
      WHERE tenant_id = ${tenantId} AND object_id IN (${sqlIdList(selIds)}) GROUP BY object_id
    `).then(r => r.rows as Array<{ object_id: string; cnt: number }>),
  ]);

  const woCount = new Map(woRows.map(r => [r.object_id, Number(r.cnt)]));
  const asgCount = new Map(asgRows.map(r => [r.object_id, Number(r.cnt)]));
  const subCount = new Map(subRows.map(r => [r.object_id, Number(r.cnt)]));

  // Kvarvarande barn per förälder = alla barn minus de barn i urvalet som
  // faktiskt raderas. Barn UTANFÖR urvalet kan aldrig raderas här → blockerar.
  const remainingChildren = new Map<string, number>();
  // förälder → barn-id:n som ligger i urvalet (avgörs före föräldern).
  const inSelectionChildren = new Map<string, string[]>();
  const addChild = (parentId: string, childId: string) => {
    remainingChildren.set(parentId, (remainingChildren.get(parentId) ?? 0) + 1);
    if (inSelection.has(childId)) {
      const arr = inSelectionChildren.get(parentId) ?? [];
      arr.push(childId);
      inSelectionChildren.set(parentId, arr);
    }
  };
  for (const r of childRows) addChild(r.parent_id, r.id);
  for (const r of altChildRows) addChild(r.parent_id, r.object_id);

  // 3) Avgör i topologisk ordning: en förälder avgörs först när alla dess
  //    barn i urvalet är avgjorda (Kahn). Ev. cykler (object_parents) faller
  //    ur kön och blockeras på sina räknare i uppsamlingssteget.
  const pendingInSelectionChildren = new Map<string, number>();
  for (const id of selIds) pendingInSelectionChildren.set(id, 0);
  for (const [parentId, children] of Array.from(inSelectionChildren.entries())) {
    if (inSelection.has(parentId)) {
      pendingInSelectionChildren.set(parentId, children.length);
    }
  }
  const parentsOf = new Map<string, string[]>(); // barn → föräldrar i urvalet
  for (const [parentId, children] of Array.from(inSelectionChildren.entries())) {
    if (!inSelection.has(parentId)) continue;
    for (const childId of children) {
      const arr = parentsOf.get(childId) ?? [];
      arr.push(parentId);
      parentsOf.set(childId, arr);
    }
  }

  const queue = selIds.filter(id => (pendingInSelectionChildren.get(id) ?? 0) === 0);
  const decidedOrder: string[] = [];
  const toDelete: string[] = []; // barn-först-ordning bevaras för chunkad radering
  const decide = (id: string) => {
    const blockers: string[] = [];
    const children = remainingChildren.get(id) ?? 0;
    const wo = woCount.get(id) ?? 0;
    const asg = asgCount.get(id) ?? 0;
    const subs = subCount.get(id) ?? 0;
    if (children > 0) blockers.push(`${children} underobjekt`);
    if (wo > 0) blockers.push(`${wo} uppgift${wo === 1 ? "" : "er"} (inkl. historik)`);
    if (asg > 0) blockers.push(`${asg} planerad${asg === 1 ? "" : "e"} uppgift${asg === 1 ? "" : "er"}`);
    if (subs > 0) blockers.push(`${subs} abonnemang`);
    if (blockers.length > 0) {
      results.set(id, {
        id,
        status: "blocked",
        reason: `Används av ${blockers.join(", ")} — kan arkiveras istället`,
      });
    } else {
      results.set(id, { id, status: "deleted" });
      toDelete.push(id);
      // Objektet raderas → räkna ner föräldrarnas kvarvarande barn.
      for (const parentId of parentsOf.get(id) ?? []) {
        remainingChildren.set(parentId, Math.max(0, (remainingChildren.get(parentId) ?? 1) - 1));
      }
    }
  };
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    decidedOrder.push(id);
    decide(id);
    for (const parentId of parentsOf.get(id) ?? []) {
      const left = (pendingInSelectionChildren.get(parentId) ?? 1) - 1;
      pendingInSelectionChildren.set(parentId, left);
      if (left <= 0 && !seen.has(parentId)) queue.push(parentId);
    }
  }
  // Cykel-rest (bör inte hända med parent_id, men object_parents saknar cykelvakt
  // historiskt): avgör i godtycklig ordning — deras barn-räknare blockerar korrekt.
  for (const id of selIds) {
    if (!seen.has(id)) {
      seen.add(id);
      decidedOrder.push(id);
      decide(id);
    }
  }

  // 4) Radera i barn-först-ordning, chunkat med batchade DELETE-satser.
  //    Varje chunk körs i EN transaktion — kringdata (metadata/länkar) får
  //    aldrig förstöras för ett objekt vars slutliga DELETE blockeras av en
  //    oförutsedd FK. Vid fel rullas chunken tillbaka och körs om per objekt
  //    (egen transaktion per objekt) så exakt rätt objekt märks som blockerat.
  for (let i = 0; i < toDelete.length; i += DELETE_CHUNK_SIZE) {
    const chunk = toDelete.slice(i, i + DELETE_CHUNK_SIZE);
    try {
      await db.transaction(async (tx) => {
        await hardDeleteUnusedObjectsBatch(tx, chunk, tenantId);
      });
    } catch {
      for (const id of chunk) {
        try {
          await db.transaction(async (tx) => {
            await hardDeleteUnusedObjectsBatch(tx, [id], tenantId);
          });
        } catch (err: any) {
          if (err?.code === "23503" || err?.cause?.code === "23503") {
            results.set(id, {
              id,
              status: "blocked",
              reason: "Refereras av annan data — kan arkiveras istället",
            });
          } else {
            throw err;
          }
        }
      }
    }
  }

  // Resultat i faktisk avgörande-ordning (barn före föräldrar) — klientens
  // "Arkivera blockerade" itererar denna ordning så föräldrar inte stoppas
  // av ännu-aktiva barn. Saknade id:n läggs sist.
  const ordered: BulkDeleteItemResult[] = [];
  for (const id of decidedOrder) {
    const r = results.get(id);
    if (r) ordered.push(r);
  }
  ordered.push(...notFound);
  const deleted = ordered.filter(r => r.status === "deleted").length;
  return { deleted, blocked: ordered.length - deleted, results: ordered };
}

type DbOrTx = Pick<typeof db, "execute">;

// Batchad motsvarighet till hardDeleteUnusedObject — samma tabeller, IN-listor.
// Körs alltid inom en transaktion (tx) så att kringdata-rensning + objekt-DELETE
// är atomära: blockeras objektet av en FK rullas allt tillbaka.
async function hardDeleteUnusedObjectsBatch(tx: DbOrTx, objectIds: string[], tenantId: string): Promise<void> {
  if (objectIds.length === 0) return;
  await tx.execute(sql`DELETE FROM metadata_historik WHERE tenant_id = ${tenantId} AND metadata_varden_id IN (
    SELECT id FROM metadata_varden WHERE tenant_id = ${tenantId} AND objekt_id IN (${sqlIdList(objectIds)})
  )`);
  await tx.execute(sql`DELETE FROM metadata_varden WHERE tenant_id = ${tenantId} AND objekt_id IN (${sqlIdList(objectIds)})`);
  await tx.execute(sql`DELETE FROM object_parents WHERE tenant_id = ${tenantId} AND (object_id IN (${sqlIdList(objectIds)}) OR parent_id IN (${sqlIdList(objectIds)}))`);
  await tx.execute(sql`DELETE FROM object_articles WHERE tenant_id = ${tenantId} AND object_id IN (${sqlIdList(objectIds)})`);
  await tx.execute(sql`DELETE FROM objects WHERE tenant_id = ${tenantId} AND id IN (${sqlIdList(objectIds)})`);
}

/**
 * Hard-delete av ett helt oanvänt objekt. Rensar objektets egna kringdata
 * (metadata, föräldralänkar, artikelkopplingar) och tar bort raden. Kastar
 * aldrig själv vid FK-konflikt — anroparen fångar och hänvisar till arkivering.
 */
export async function hardDeleteUnusedObject(objectId: string, tenantId: string): Promise<void> {
  // Task #1428: atomärt — kringdata-rensning + objekt-DELETE i en transaktion
  // så att en FK-blockerad radering inte hinner förstöra objektets metadata.
  await db.transaction(async (tx) => {
    await hardDeleteUnusedObjectsBatch(tx, [objectId], tenantId);
  });
}
