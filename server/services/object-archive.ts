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

/**
 * Hard-delete av ett helt oanvänt objekt. Rensar objektets egna kringdata
 * (metadata, föräldralänkar, artikelkopplingar) och tar bort raden. Kastar
 * aldrig själv vid FK-konflikt — anroparen fångar och hänvisar till arkivering.
 */
export async function hardDeleteUnusedObject(objectId: string, tenantId: string): Promise<void> {
  await db.execute(sql`DELETE FROM metadata_historik WHERE tenant_id = ${tenantId} AND metadata_varden_id IN (
    SELECT id FROM metadata_varden WHERE tenant_id = ${tenantId} AND objekt_id = ${objectId}
  )`).catch(() => undefined);
  await db.execute(sql`DELETE FROM metadata_varden WHERE tenant_id = ${tenantId} AND objekt_id = ${objectId}`);
  await db.execute(sql`DELETE FROM object_parents WHERE tenant_id = ${tenantId} AND (object_id = ${objectId} OR parent_id = ${objectId})`);
  await db.execute(sql`DELETE FROM object_articles WHERE tenant_id = ${tenantId} AND object_id = ${objectId}`);
  await db.execute(sql`DELETE FROM objects WHERE tenant_id = ${tenantId} AND id = ${objectId}`);
}
