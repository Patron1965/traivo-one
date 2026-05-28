// Arkivering av objekt med preflight — task #552 krav (C).
// Ersätter "radera"-flödet: visar varning om objektet har kopplade aktiva
// ordrar/abonnemang och lagrar metadata om vem som arkiverade + varför.
// Soft-delete-state lagras fortfarande i `objects.deletedAt`.
import { db } from "../db";
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
  // customer_id hämtas via primär object_payer (ADR v3) — inte legacy objects.customer_id.
  return db.execute(sql`
    SELECT o.id, o.name, o.object_number,
      (SELECT op.customer_id FROM object_payers op
        WHERE op.object_id = o.id AND op.is_primary = true
        ORDER BY op.priority DESC NULLS LAST, op.created_at ASC
        LIMIT 1) AS customer_id,
      o.deleted_at AS archived_at, o.archived_by, o.archived_reason
    FROM objects o
    WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NOT NULL
    ORDER BY o.deleted_at DESC
    LIMIT ${limit}
  `).then(r => r.rows);
}
