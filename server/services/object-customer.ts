import { sql, and, eq, desc, asc, type SQL } from "drizzle-orm";
import { db } from "../db";
import { objectPayers } from "@shared/schema";

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
