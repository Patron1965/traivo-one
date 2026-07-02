import { sql, and, eq, desc, asc, isNull, type SQL } from "drizzle-orm";
import { db } from "../db";
import { objectPayers, objects } from "@shared/schema";

/**
 * SQL-fragment som returnerar primär-payer-customer_id för objects.id
 * i den FROM-klausul som queryt redan har. Använd som override för
 * objects.customerId i select-listor eller som värde i predikat.
 *
 * Sortering: is_primary=true först, sen högsta priority, sen tidigast skapad.
 * Returnerar NULL om inga payers finns.
 */
export function primaryPayerCustomerIdSql(): SQL<string | null> {
  // OBS: skriv den kvalificerade literalen "objects"."id" — INTE ${objects.id}.
  // När drizzle renderar ${objects.id} som SELECT-kolumn i en enkel-tabell-select
  // utelämnas tabellprefixet och bara "id" renderas. Inuti subqueryn binder då
  // "id" till object_payers.id (närmaste scope) → op.object_id = op.id → alltid
  // falskt → NULL. Den explicita literalen "objects"."id" tvingar korrelationen
  // mot yttre objects-raden och kräver ingen objects-import (samma form som de
  // tre predikat-hjälparna nedan).
  return sql<string | null>`(
    SELECT op.customer_id FROM object_payers op
    WHERE op.object_id = "objects"."id"
      AND op.is_primary = true
    ORDER BY op.priority DESC NULLS LAST, op.created_at ASC
    LIMIT 1
  )`;
}

/**
 * SQL-fragment för predikat: "objektet har <customerId> som primär payer".
 * Använd i WHERE-klausuler istället för eq(objects.customerId, X).
 */
export function objectHasPrimaryCustomerSql(customerId: string): SQL<boolean> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM object_payers op
    WHERE op.object_id = "objects"."id"
      AND op.is_primary = true
      AND op.customer_id = ${customerId}
  )`;
}

/**
 * SQL-fragment för predikat: "objektets primär-payer är någon av <customerIds>".
 */
export function objectPrimaryCustomerInSql(customerIds: string[]): SQL<boolean> {
  if (customerIds.length === 0) return sql<boolean>`FALSE`;
  return sql<boolean>`EXISTS (
    SELECT 1 FROM object_payers op
    WHERE op.object_id = "objects"."id"
      AND op.is_primary = true
      AND op.customer_id IN (${sql.join(customerIds.map(id => sql`${id}`), sql`, `)})
  )`;
}

/**
 * Filter för "objektet har en KOPPLAD UPGIFT (work order) som matchar"
 * (Task #1083 — sök på kopplade uppgifter). Alla fält är valfria; minst ett
 * måste vara satt för att hjälparen ska anropas (annars matchar den allt).
 */
export interface LinkedTaskFilter {
  /** work_orders.order_type (uppgiftstyp, t.ex. "service"). */
  taskType?: string;
  /**
   * Order-/faktureringskund för uppgiften. ADR v3: kunden härleds via
   * orderkoncept/order (work_orders.customer_id stämplas vid expansion) — INTE
   * via objektets primär-payer. Vi filtrerar därför på work_orders.customer_id.
   */
  customerId?: string;
  /** Endast uppgifter utförda (completed_at) från och med denna tidpunkt. */
  completedFrom?: Date;
  /** Endast uppgifter utförda (completed_at) till och med denna tidpunkt. */
  completedTo?: Date;
}

/**
 * SQL-fragment för predikat: "objektet har minst en UTFÖRD kopplad uppgift som
 * matchar filtret". Korrelerar mot yttre objects-raden via "objects"."id"
 * (samma mönster som hjälparna ovan). Tenant-scopas i subqueryn (defense-in-
 * depth) och kräver att uppgiften är utförd (order_status IN utford/fakturerad)
 * samt inte soft-deletad.
 *
 * Returnerar `null` om inget delkriterium är satt — anroparen ska då hoppa över
 * filtret (annars skulle ett tomt filter matcha alla objekt med någon utförd
 * uppgift, vilket inte är avsett).
 */
export function objectHasLinkedTaskSql(
  tenantId: string,
  filter: LinkedTaskFilter,
): SQL<boolean> | null {
  const extra: SQL[] = [];
  if (filter.taskType) {
    extra.push(sql`wo.order_type = ${filter.taskType}`);
  }
  if (filter.customerId) {
    extra.push(sql`wo.customer_id = ${filter.customerId}`);
  }
  if (filter.completedFrom) {
    extra.push(sql`wo.completed_at >= ${filter.completedFrom}`);
  }
  if (filter.completedTo) {
    extra.push(sql`wo.completed_at <= ${filter.completedTo}`);
  }
  if (extra.length === 0) return null;

  const extraSql = sql.join(extra.map(e => sql` AND ${e}`), sql``);
  return sql<boolean>`EXISTS (
    SELECT 1 FROM work_orders wo
    WHERE wo.object_id = "objects"."id"
      AND wo.tenant_id = ${tenantId}
      AND wo.deleted_at IS NULL
      AND wo.order_status IN ('utford', 'fakturerad')${extraSql}
  )`;
}

/**
 * SQL-fragment för predikat: "objektet saknar primär payer (=ingen kund-koppling)".
 * Används för issue=no-customer-filtret.
 */
export function objectHasNoPrimaryCustomerSql(tenantId: string): SQL<boolean> {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM object_payers op
    JOIN customers c ON c.id = op.customer_id
    WHERE op.object_id = "objects"."id"
      AND op.is_primary = true
      AND c.tenant_id = ${tenantId}
      AND c.deleted_at IS NULL
  )`;
}

/**
 * Idempotent skapande av primär payer (kund-koppling) för ett objekt.
 * ADR v3: objekt är kund-neutrala — "vem objektet hör till" bärs av
 * `object_payers` (primär), INTE av någon kolumn på objekt-raden. Denna helper
 * ersätter de gamla `objects.customer_id`-skrivningarna: alla write-vägar som
 * vill koppla ett nyskapat/kopierat objekt till en kund gör det via en
 * primär-payer-rad här.
 *
 * Hoppar över om objektet redan har en primär payer (idempotent). Best-effort:
 * kastar aldrig — en misslyckad payer-koppling får aldrig fälla objekt-skapandet.
 * Returnerar den skapade payer-radens id, eller null (fanns redan / fel / ingen kund).
 */
export async function ensurePrimaryPayer(
  tenantId: string,
  objectId: string,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const existing = await db
      .select({ id: objectPayers.id })
      .from(objectPayers)
      .where(
        and(
          eq(objectPayers.objectId, objectId),
          eq(objectPayers.isPrimary, true),
          eq(objectPayers.tenantId, tenantId),
        ),
      );
    if (existing[0]) return null;
    const [ins] = await db
      .insert(objectPayers)
      .values({
        tenantId,
        objectId,
        customerId,
        payerType: "primary",
        isPrimary: true,
        sharePercent: 100,
        priority: 1,
      })
      .returning({ id: objectPayers.id });
    return ins?.id ?? null;
  } catch {
    return null;
  }
}

export interface ObjectTreeNode {
  id: string;
  name: string;
  objectNumber: string | null;
  objectType: string | null;
  address: string | null;
  customerId: string | null;
  childCount: number;
  children: ObjectTreeNode[];
}

/**
 * Hämtar en nivå i objektträdet med korrekt antal direkta barn (childCount)
 * per rad. Delas av `GET /api/objects/tree` och
 * `GET /api/objects/tree/:parentId/children` så att child-count-logiken bor på
 * ett enda ställe.
 *
 * parentId-semantik:
 *   - icke-tom sträng → returnera direkta barn till den föräldern (eq parent_id)
 *   - undefined/null/"" → returnera rot-objekt (parent_id IS NULL)
 *
 * customerId filtrerar både raderna och child-räknaren på primär-payer-kund.
 *
 * OBS childCountSql: literalen "objects"."id" är medveten — som scalar
 * subselect i SELECT-listan renderar drizzle ${objects.id} okvalificerat som
 * "id", vilket inuti subqueryn binder till inre "objects c" (c.parent_id = c.id)
 * → alltid falskt → childCount = 0. Se memory drizzle-unqualified-subquery-column.
 */
export async function getObjectTreeLevel(
  tenantId: string,
  opts: { parentId?: string | null; customerId?: string | null } = {},
): Promise<ObjectTreeNode[]> {
  const parentId = opts.parentId && typeof opts.parentId === "string" ? opts.parentId : null;
  const customerId = opts.customerId && typeof opts.customerId === "string" ? opts.customerId : null;

  const parentFilter = parentId ? eq(objects.parentId, parentId) : isNull(objects.parentId);

  const conditions = [
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    parentFilter,
  ];
  if (customerId) {
    conditions.push(objectHasPrimaryCustomerSql(customerId));
  }

  const customerFilter = customerId
    ? sql` AND EXISTS (SELECT 1 FROM object_payers op WHERE op.object_id = c.id AND op.is_primary = true AND op.customer_id = ${customerId})`
    : sql``;
  const childCountSql = sql<number>`(SELECT count(*) FROM objects c WHERE c.parent_id = "objects"."id" AND c.tenant_id = ${tenantId} AND c.deleted_at IS NULL${customerFilter})`;

  const rows = await db
    .select({
      id: objects.id,
      name: objects.name,
      objectNumber: objects.objectNumber,
      objectType: objects.objectType,
      address: objects.address,
      customerId: primaryPayerCustomerIdSql(),
      childCount: childCountSql,
    })
    .from(objects)
    .where(and(...conditions))
    .orderBy(objects.name);

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    objectNumber: r.objectNumber,
    objectType: r.objectType,
    address: r.address,
    customerId: r.customerId,
    childCount: Number(r.childCount) || 0,
    children: [],
  }));
}

/**
 * Hämtar primär-payer-customer_id för ett enskilt objekt. NULL om ingen.
 */
export async function getObjectPrimaryCustomerId(
  objectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ customerId: objectPayers.customerId })
    .from(objectPayers)
    .where(and(eq(objectPayers.objectId, objectId), eq(objectPayers.isPrimary, true)))
    .orderBy(desc(objectPayers.priority), asc(objectPayers.createdAt))
    .limit(1);
  return row?.customerId ?? null;
}

/**
 * Batch-variant av getObjectPrimaryCustomerId. Returnerar Map<objectId, customerId|null>.
 */
export async function getObjectsPrimaryCustomerIds(
  objectIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (objectIds.length === 0) return map;
  const rows = await db
    .select({
      objectId: objectPayers.objectId,
      customerId: objectPayers.customerId,
      priority: objectPayers.priority,
      createdAt: objectPayers.createdAt,
    })
    .from(objectPayers)
    .where(
      and(
        eq(objectPayers.isPrimary, true),
        sql`${objectPayers.objectId} IN (${sql.join(objectIds.map(id => sql`${id}`), sql`, `)})`,
      ),
    );
  // Plocka högst priority först, sen tidigast skapad
  const byObj = new Map<string, { customerId: string; priority: number; createdAt: Date }>();
  for (const r of rows) {
    const cur = byObj.get(r.objectId);
    const candidate = {
      customerId: r.customerId,
      priority: r.priority ?? 0,
      createdAt: r.createdAt,
    };
    if (
      !cur ||
      candidate.priority > cur.priority ||
      (candidate.priority === cur.priority && candidate.createdAt < cur.createdAt)
    ) {
      byObj.set(r.objectId, candidate);
    }
  }
  for (const id of objectIds) map.set(id, byObj.get(id)?.customerId ?? null);
  return map;
}

/**
 * Lista alla objectIds för en given primär-payer-customerId i en tenant.
 */
export async function getObjectIdsByPrimaryCustomer(
  customerId: string,
  tenantId: string,
): Promise<string[]> {
  const rows = await db
    .select({ objectId: objectPayers.objectId })
    .from(objectPayers)
    .where(
      and(
        eq(objectPayers.customerId, customerId),
        eq(objectPayers.tenantId, tenantId),
        eq(objectPayers.isPrimary, true),
      ),
    );
  return rows.map(r => r.objectId);
}
