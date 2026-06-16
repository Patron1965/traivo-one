// Ångra-funktion (Feature 1): rulla tillbaka den senaste ångringsbara import-
// batchen i ett klick. Auktoritativ källa för undo är `import_actions` — per-
// entitet before/after-snapshot som stämplas under import-exekvering (wizard +
// Import 2.0). Undo:
//   - create_object  → soft-delete (arkivera) objektet + rensa import-egna
//                       primär object_parents/object_payers-rader.
//   - update_object  → återställ skalär-fält + primär-förälder från beforeJson,
//                       men ENDAST om objektets nuvarande tillstånd fortfarande
//                       == afterJson (annars blockeras raden, fail-closed).
//   - metadata_write → hård-radera de metadata_varden-rader som batchen skapade
//                       (id:n sparade i afterJson.ids).
//
// Multi-tenant: ALLA SELECT/UPDATE/DELETE har tenant_id i WHERE. Guardrails är
// fail-closed: ett skapat objekt arkiveras aldrig om någon EXTERN (icke-import-
// egen) rad fortfarande refererar det (barn, arbetsordrar, koncept, payers m.m.).
// Den listan härleds generiskt via pg_catalog (alla FK som pekar på objects.id)
// så den aldrig blir inaktuell vid nya tabeller.

import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  importActions,
  importBatches,
  metadataVarden,
  objectParents,
  objectPayers,
  objects,
  type ImportAction,
} from "@shared/schema";

// 7 dygns ångringsfönster. Efter det markeras batchen inte längre som "senaste
// ångringsbara" (undoExpiresAt). Sätts vid stämpling.
export const IMPORT_UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Skalär-fält som snapshot:as för objekt (create_object.afterJson /
// update_object.before+afterJson). Håll listan synkad med restoreObjectScalars.
export type ObjectSnapshot = {
  name: string | null;
  parentId: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  objectType: string | null;
};

// Drizzle-select för en ObjectSnapshot (property-namn → kolumner).
export const objectSnapshotColumns = {
  name: objects.name,
  parentId: objects.parentId,
  address: objects.address,
  city: objects.city,
  postalCode: objects.postalCode,
  latitude: objects.latitude,
  longitude: objects.longitude,
  objectType: objects.objectType,
} as const;

// Normalisera ett snapshot-fält för drift-jämförelse: null/undefined → "",
// allt annat → trimmad sträng. Lat/lng (real) jämförs som tal när bägge är
// parsbara så "59.3" == 59.3.
function normField(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function snapshotMatches(current: ObjectSnapshot, after: any): boolean {
  if (!after || typeof after !== "object") return false;
  const keys: (keyof ObjectSnapshot)[] = [
    "name",
    "parentId",
    "address",
    "city",
    "postalCode",
    "latitude",
    "longitude",
    "objectType",
  ];
  for (const k of keys) {
    const a = normField((current as any)[k]);
    const b = normField(after[k]);
    if (a === b) continue;
    // Numerisk tolerans för koordinater (real ↔ JSON-number).
    if (k === "latitude" || k === "longitude") {
      const an = Number(a);
      const bn = Number(b);
      if (!Number.isNaN(an) && !Number.isNaN(bn) && Math.abs(an - bn) < 1e-6) continue;
    }
    return false;
  }
  return true;
}

type FkColumn = { table: string; column: string };

// (table.column)-par som är IMPORT-EGNA och därför ALDRIG ska blockera arkivering
// av ett skapat objekt — de raderas/ignoreras explicit i stället.
const IGNORED_FK_COLUMNS = new Set<string>([
  "object_parents.object_id",
  "object_payers.object_id",
  "metadata_varden.objekt_id",
  "metadata_historik.objekt_id",
  "object_import_rows.object_id",
]);

// Alla FK-kolumner som refererar objects.id (generiskt via pg_catalog → aldrig
// inaktuellt). Inkluderar objects.parent_id (self-ref barn).
async function getObjectReferencingColumns(runner: typeof db): Promise<FkColumn[]> {
  const res: any = await runner.execute(sql`
    SELECT con.conrelid::regclass::text AS table_name,
           att.attname AS column_name
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.confrelid = 'objects'::regclass
  `);
  const rows: any[] = res.rows ?? (Array.isArray(res) ? res : []);
  return rows
    .map((r) => ({ table: String(r.table_name), column: String(r.column_name) }))
    .filter((c) => !IGNORED_FK_COLUMNS.has(`${c.table}.${c.column}`));
}

// Vilka av (table) som har tenant_id / deleted_at-kolumner (för korrekt scoping).
async function getColumnFlags(
  runner: typeof db,
  tables: string[],
): Promise<Map<string, { hasTenant: boolean; hasDeletedAt: boolean }>> {
  const flags = new Map<string, { hasTenant: boolean; hasDeletedAt: boolean }>();
  for (const t of tables) flags.set(t, { hasTenant: false, hasDeletedAt: false });
  if (tables.length === 0) return flags;
  const res: any = await runner.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('tenant_id', 'deleted_at')
  `);
  const rows: any[] = res.rows ?? (Array.isArray(res) ? res : []);
  for (const r of rows) {
    const t = String(r.table_name);
    const f = flags.get(t);
    if (!f) continue;
    if (r.column_name === "tenant_id") f.hasTenant = true;
    if (r.column_name === "deleted_at") f.hasDeletedAt = true;
  }
  return flags;
}

// Beräkna vilka skapade objekt-id:n som INTE får arkiveras p.g.a. externa
// referenser. Ett objekt blockeras om någon referens-kolumn (utom import-egna)
// pekar på det — barn och object_parents-syskon inom samma undo-set exkluderas.
async function computeBlockedObjectIds(
  runner: typeof db,
  tenantId: string,
  createdIds: string[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (createdIds.length === 0) return blocked;
  const cols = await getObjectReferencingColumns(runner);
  const flags = await getColumnFlags(runner, Array.from(new Set(cols.map((c) => c.table))));

  for (const { table, column } of cols) {
    const f = flags.get(table) ?? { hasTenant: false, hasDeletedAt: false };
    let q = sql`SELECT DISTINCT ${sql.identifier(column)} AS oid FROM ${sql.identifier(table)} WHERE ${sql.identifier(column)} = ANY(${createdIds})`;
    if (f.hasTenant) q = sql`${q} AND tenant_id = ${tenantId}`;
    if (f.hasDeletedAt) q = sql`${q} AND deleted_at IS NULL`;
    // Self-ref barn (objects.parent_id) + multi-parent (object_parents.parent_id):
    // exkludera rader som själva tillhör undo-setet (de arkiveras ändå).
    if (table === "objects" && column === "parent_id") {
      q = sql`${q} AND id <> ALL(${createdIds})`;
    } else if (table === "object_parents" && column === "parent_id") {
      q = sql`${q} AND object_id <> ALL(${createdIds})`;
    }
    try {
      const res: any = await runner.execute(q);
      const rows: any[] = res.rows ?? (Array.isArray(res) ? res : []);
      for (const r of rows) if (r.oid) blocked.add(String(r.oid));
    } catch {
      // Fail-closed: om en guardrail-fråga oväntat failar, blockera ALLA skapade
      // objekt hellre än att riskera en oönskad arkivering.
      for (const id of createdIds) blocked.add(id);
      return blocked;
    }
  }
  return blocked;
}

export type UndoBatchSummary = {
  batchId: string;
  sourceFlow: string | null;
  createdAt: Date;
  totalRows: number | null;
  created: number | null;
  updated: number | null;
  actionCount: number;
  undoExpiresAt: Date | null;
  expired: boolean;
};

// Senaste ångringsbara batchen för en tenant (för UI-knappen). null om ingen.
export async function getLatestReversibleBatch(
  tenantId: string,
): Promise<UndoBatchSummary | null> {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.tenantId, tenantId),
        eq(importBatches.undoStatus, "reversible"),
        isNull(importBatches.undoneAt),
        // Endast batchar inom ångringsfönstret (eller utan utgångsdatum).
        or(isNull(importBatches.undoExpiresAt), gte(importBatches.undoExpiresAt, new Date())),
      ),
    )
    .orderBy(desc(importBatches.createdAt))
    .limit(1);
  if (!batch) return null;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(importActions)
    .where(
      and(
        eq(importActions.tenantId, tenantId),
        eq(importActions.batchId, batch.batchId),
        eq(importActions.status, "applied"),
      ),
    );
  if (!count) return null;
  const expired = !!batch.undoExpiresAt && batch.undoExpiresAt.getTime() < Date.now();
  return {
    batchId: batch.batchId,
    sourceFlow: batch.sourceFlow ?? null,
    createdAt: batch.createdAt,
    totalRows: batch.totalRows ?? null,
    created: batch.created ?? null,
    updated: batch.updated ?? null,
    actionCount: count,
    undoExpiresAt: batch.undoExpiresAt ?? null,
    expired,
  };
}

export type UndoResult = {
  batchId: string;
  sourceFlow: string | null;
  undoStatus: "undone" | "partially_undone" | "blocked";
  archived: number;
  restored: number;
  metadataRemoved: number;
  blocked: { entityId: string | null; actionType: string; reason: string }[];
};

function restoreScalarSet(before: any): Record<string, unknown> {
  const b = (before ?? {}) as Partial<ObjectSnapshot>;
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };
  const toStr = (v: unknown): string | null =>
    v === null || v === undefined || v === "" ? null : String(v);
  return {
    name: b.name ?? null,
    parentId: toStr(b.parentId),
    address: toStr(b.address),
    city: toStr(b.city),
    postalCode: toStr(b.postalCode),
    latitude: toNum(b.latitude),
    longitude: toNum(b.longitude),
    // object_type är NOT NULL — fall tillbaka på "omrade" om snapshot saknar typ.
    objectType: toStr(b.objectType) ?? "omrade",
  };
}

// Återställ primär-förälder-spegeln (object_parents.isPrimary) till `parentId`.
// Legacy objects.parentId och object_parents-primärraden måste alltid hållas i
// synk (se replit.md). Körs i samma tx som skalär-återställningen.
async function restorePrimaryParent(
  tx: any,
  tenantId: string,
  objectId: string,
  parentId: string | null,
) {
  const existing = await tx
    .select({ id: objectParents.id })
    .from(objectParents)
    .where(
      and(
        eq(objectParents.objectId, objectId),
        eq(objectParents.isPrimary, true),
        eq(objectParents.tenantId, tenantId),
      ),
    );
  if (!parentId) {
    if (existing[0]) {
      await tx
        .delete(objectParents)
        .where(and(eq(objectParents.id, existing[0].id), eq(objectParents.tenantId, tenantId)));
    }
    return;
  }
  if (existing[0]) {
    await tx
      .update(objectParents)
      .set({ parentId, relationContext: "primary" })
      .where(and(eq(objectParents.id, existing[0].id), eq(objectParents.tenantId, tenantId)));
  } else {
    await tx
      .insert(objectParents)
      .values({ tenantId, objectId, parentId, isPrimary: true, relationContext: "primary" });
  }
}

// Ångra en batch. `batchId` valfritt — default = senaste ångringsbara.
export async function undoImportBatch(args: {
  tenantId: string;
  userId: string | null;
  batchId?: string;
}): Promise<UndoResult> {
  const { tenantId, userId } = args;
  return db.transaction(async (tx) => {
    // Lås batch-raden (FOR UPDATE) så två samtidiga undo inte kan dubbel-ångra.
    const batchRows = await tx
      .select()
      .from(importBatches)
      .where(
        args.batchId
          ? and(eq(importBatches.tenantId, tenantId), eq(importBatches.batchId, args.batchId))
          : and(
              eq(importBatches.tenantId, tenantId),
              eq(importBatches.undoStatus, "reversible"),
              isNull(importBatches.undoneAt),
            ),
      )
      .orderBy(desc(importBatches.createdAt))
      .limit(1)
      .for("update");
    const batch = batchRows[0];
    if (!batch) {
      throw new Error("Ingen ångringsbar import hittades.");
    }
    if (batch.undoStatus !== "reversible" || batch.undoneAt) {
      throw new Error("Importen har redan ångrats eller går inte att ångra.");
    }
    // Ångringsfönstret (7 dagar) enforce:as i den låsta transaktionen — inte bara
    // i listnings-frågan — så en utgången batch aldrig kan ångras via en rå POST.
    if (batch.undoExpiresAt && batch.undoExpiresAt.getTime() < Date.now()) {
      throw new Error("Ångringsfönstret (7 dagar) har gått ut för denna import.");
    }

    const actions: ImportAction[] = await tx
      .select()
      .from(importActions)
      .where(
        and(
          eq(importActions.tenantId, tenantId),
          eq(importActions.batchId, batch.batchId),
          eq(importActions.status, "applied"),
        ),
      )
      .orderBy(desc(importActions.createdAt));

    if (actions.length === 0) {
      throw new Error("Importen saknar ångringsbara åtgärder.");
    }

    const createdIds = actions
      .filter((a) => a.actionType === "create_object" && a.entityId)
      .map((a) => a.entityId as string);
    const blockedCreatedIds = await computeBlockedObjectIds(tx as any, tenantId, createdIds);

    let archived = 0;
    let restored = 0;
    let metadataRemoved = 0;
    const blocked: UndoResult["blocked"] = [];
    const now = new Date();

    const markUndone = async (id: string) => {
      await tx
        .update(importActions)
        .set({ status: "undone", undoneAt: now, undoneBy: userId })
        .where(and(eq(importActions.id, id), eq(importActions.tenantId, tenantId)));
    };
    const markBlocked = async (action: ImportAction, reason: string) => {
      await tx
        .update(importActions)
        .set({ status: "blocked", undoError: reason })
        .where(and(eq(importActions.id, action.id), eq(importActions.tenantId, tenantId)));
      blocked.push({ entityId: action.entityId, actionType: action.actionType, reason });
    };

    for (const action of actions) {
      try {
        if (action.actionType === "create_object") {
          const id = action.entityId;
          if (!id) {
            await markBlocked(action, "Saknar entityId.");
            continue;
          }
          if (blockedCreatedIds.has(id)) {
            await markBlocked(
              action,
              "Objektet har fått nya kopplingar efter importen (barn, ordrar, koncept eller liknande) och kan inte arkiveras automatiskt.",
            );
            continue;
          }
          // Drift-kontroll även för skapade objekt: arkivera bara om objektets
          // nuvarande tillstånd fortfarande == importens after-snapshot. Har någon
          // ändrat namn/adress/förälder/typ efteråt → lämna orört (fail-closed).
          const [curCreated] = await tx
            .select(objectSnapshotColumns)
            .from(objects)
            .where(and(eq(objects.id, id), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
          if (!curCreated) {
            // Redan borttaget/arkiverat — idempotent, inget att göra.
            await markUndone(action.id);
            continue;
          }
          if (!snapshotMatches(curCreated as ObjectSnapshot, action.afterJson)) {
            await markBlocked(
              action,
              "Objektet har ändrats efter importen — arkiveras inte (för att inte radera nyare ändringar).",
            );
            continue;
          }
          // Payer-guardrail: importen äger en känd uppsättning payer-rader
          // (afterJson.payerIds). Finns det payer-rader som importen INTE skapade
          // → någon har kopplat en betalare efteråt → blockera (radera aldrig en
          // payer-rad vi inte äger). Saknas payerIds (wizard skapar inga payers)
          // blockerar vilken payer-rad som helst — fail-closed.
          const ownedPayerIds = new Set<string>(
            Array.isArray((action.afterJson as any)?.payerIds)
              ? (action.afterJson as any).payerIds.map((x: any) => String(x))
              : [],
          );
          const currentPayers = await tx
            .select({ id: objectPayers.id })
            .from(objectPayers)
            .where(and(eq(objectPayers.objectId, id), eq(objectPayers.tenantId, tenantId)));
          if (currentPayers.some((p) => !ownedPayerIds.has(p.id))) {
            await markBlocked(
              action,
              "Objektet har fått en ny betalarkoppling efter importen och kan inte arkiveras automatiskt.",
            );
            continue;
          }
          // Alla guardrails passerade → arkivera (soft-delete) + städa import-egna
          // relationer (primär object_parents + endast de payer-rader vi äger).
          await tx
            .update(objects)
            .set({ deletedAt: now })
            .where(and(eq(objects.id, id), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
          await tx
            .delete(objectParents)
            .where(and(eq(objectParents.objectId, id), eq(objectParents.tenantId, tenantId)));
          if (ownedPayerIds.size > 0) {
            await tx
              .delete(objectPayers)
              .where(
                and(
                  sql`${objectPayers.id} = ANY(${Array.from(ownedPayerIds)})`,
                  eq(objectPayers.tenantId, tenantId),
                ),
              );
          }
          archived++;
          await markUndone(action.id);
        } else if (action.actionType === "update_object") {
          const id = action.entityId;
          if (!id) {
            await markBlocked(action, "Saknar entityId.");
            continue;
          }
          const [current] = await tx
            .select(objectSnapshotColumns)
            .from(objects)
            .where(and(eq(objects.id, id), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
          if (!current) {
            await markBlocked(action, "Objektet finns inte längre — kan inte återställas.");
            continue;
          }
          if (!snapshotMatches(current as ObjectSnapshot, action.afterJson)) {
            await markBlocked(
              action,
              "Objektet har ändrats efter importen — återställs inte (för att inte skriva över nyare ändringar).",
            );
            continue;
          }
          const before = action.beforeJson as ObjectSnapshot | null;
          await tx
            .update(objects)
            .set(restoreScalarSet(before) as any)
            .where(and(eq(objects.id, id), eq(objects.tenantId, tenantId)));
          await restorePrimaryParent(tx, tenantId, id, (before?.parentId ?? null) as string | null);
          restored++;
          await markUndone(action.id);
        } else if (action.actionType === "metadata_write") {
          const afterIds = (action.afterJson as any)?.ids;
          let idsToDelete: string[];
          if (Array.isArray(afterIds)) {
            // Normalfall: finaliserad lista över exakt de metadata-rader importen
            // skapade (kan vara tom → no-op).
            idsToDelete = afterIds.map((x: any) => String(x));
          } else {
            // Återställning: finaliserings-UPDATE:n hann aldrig köra (krasch i
            // fönstret mellan metadata-skrivningen och stämplingen). Radera objektets
            // nuvarande metadata som INTE fanns vid importtillfället (baseline).
            // Bounded: undo gäller bara senaste batchen, admin-gated, inom 7-dagars-
            // fönstret — så risken att radera senare tillagd metadata är minimal.
            const baseline = new Set<string>(
              Array.isArray((action.beforeJson as any)?.baseline)
                ? (action.beforeJson as any).baseline.map((x: any) => String(x))
                : [],
            );
            const objId = action.entityId;
            if (objId) {
              const cur = await tx
                .select({ id: metadataVarden.id })
                .from(metadataVarden)
                .where(and(eq(metadataVarden.objektId, objId), eq(metadataVarden.tenantId, tenantId)));
              idsToDelete = cur.map((r) => r.id).filter((x) => !baseline.has(x));
            } else {
              idsToDelete = [];
            }
          }
          if (idsToDelete.length > 0) {
            const del = await tx
              .delete(metadataVarden)
              .where(and(sql`${metadataVarden.id} = ANY(${idsToDelete})`, eq(metadataVarden.tenantId, tenantId)))
              .returning({ id: metadataVarden.id });
            metadataRemoved += del.length;
          }
          await markUndone(action.id);
        } else {
          await markBlocked(action, `Okänd åtgärdstyp: ${action.actionType}`);
        }
      } catch (err: any) {
        await markBlocked(action, `Fel vid ångring: ${err?.message ?? String(err)}`);
      }
    }

    const undoStatus: UndoResult["undoStatus"] =
      blocked.length === 0
        ? "undone"
        : archived + restored + metadataRemoved > 0
          ? "partially_undone"
          : "blocked";

    await tx
      .update(importBatches)
      .set({ undoStatus, undoneAt: now, undoneBy: userId })
      .where(and(eq(importBatches.batchId, batch.batchId), eq(importBatches.tenantId, tenantId)));

    return {
      batchId: batch.batchId,
      sourceFlow: batch.sourceFlow ?? null,
      undoStatus,
      archived,
      restored,
      metadataRemoved,
      blocked,
    };
  });
}
