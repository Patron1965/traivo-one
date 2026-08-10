import { sql, and, eq, isNull, type SQL } from "drizzle-orm";
import { db } from "../db";
import { objects, metadataVarden, metadataKatalog } from "@shared/schema";

// ============================================================================
// OBJEKTETS KUND-KOPPLING — KÄLLA: EKONOMI-METADATA (Etapp 5)
// ----------------------------------------------------------------------------
// Gamla `object_payers`-tabellen är borttagen. Objektets kund härleds nu ur
// Ekonomi-metadatat: katalogfältet "Kund" (datatyp referens → customers),
// arvs-medvetet uppåt via PRIMÄRA förälderkedjan (metadata-arv sker alltid
// från primär förälder). Närmaste värde vinner; en lokal tombstone
// (raderad=true utan aktivt eget värde) stryker ärvt värde.
//
// API:et är oförändrat (samma exporterade funktioner) så alla call-sites
// fortsätter fungera utan ändringar.
// ============================================================================

/** WHERE-fragment som identifierar "Kund"-katalogposten för en metadata-rad. */
const KUND_KATALOG_JOIN = sql`
  mk.id = mv.metadata_katalog_id
  AND lower(mk.namn) = 'kund'
  AND mk.deleted_at IS NULL
`;

/**
 * SQL-fragment som returnerar objektets kund-id (customers.id) härlett ur
 * Ekonomi-metadatafältet "Kund" för `objects.id` i den FROM-klausul som
 * queryt redan har. Använd som override för `objects.customerId` i
 * select-listor eller som värde i predikat.
 *
 * OBS: skriv den kvalificerade literalen "objects"."id" — INTE ${objects.id}.
 * Se memory drizzle-unqualified-subquery-column.
 */
export function primaryPayerCustomerIdSql(): SQL<string | null> {
  return primaryPayerCustomerIdSqlFor(sql.raw(`"objects"."id"`));
}

/**
 * Som primaryPayerCustomerIdSql() men med valfri yttre id-referens, för
 * queries där objects är aliasad (t.ex. `o.id`). Skicka sql.raw('o.id').
 */
export function primaryPayerCustomerIdSqlFor(idRef: SQL): SQL<string | null> {
  return sql<string | null>`(
    WITH RECURSIVE kundchain AS (
      SELECT ko.id, ko.parent_id, ko.tenant_id, 0 AS lvl
      FROM objects ko WHERE ko.id = ${idRef}
      UNION ALL
      SELECT p.id, p.parent_id, p.tenant_id, kc.lvl + 1
      FROM objects p JOIN kundchain kc ON p.id = kc.parent_id
      WHERE kc.lvl < 50
    )
    SELECT mv.varde_referens
    FROM kundchain kc
    JOIN metadata_varden mv ON mv.objekt_id = kc.id AND mv.tenant_id = kc.tenant_id
    JOIN metadata_katalog mk ON ${KUND_KATALOG_JOIN} AND mk.tenant_id = kc.tenant_id
    WHERE mv.varde_referens IS NOT NULL
      AND COALESCE(mv.raderad, FALSE) = FALSE
      AND (mv.status IS NULL OR mv.status = 'aktiv')
      AND (
        kc.lvl = 0
        OR (
          mv.arvs_nedat = TRUE
          AND COALESCE(mv.niva_las, FALSE) = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM metadata_varden t
            JOIN metadata_katalog tk ON tk.id = t.metadata_katalog_id
              AND lower(tk.namn) = 'kund' AND tk.deleted_at IS NULL
            WHERE t.objekt_id = ${idRef} AND COALESCE(t.raderad, FALSE) = TRUE
          )
        )
      )
    ORDER BY kc.lvl ASC
    LIMIT 1
  )`;
}

/**
 * SQL-fragment för predikat: "objektet har <customerId> som kund".
 * Använd i WHERE-klausuler istället för eq(objects.customerId, X).
 */
export function objectHasPrimaryCustomerSql(customerId: string): SQL<boolean> {
  return sql<boolean>`(${primaryPayerCustomerIdSql()} = ${customerId})`;
}

/**
 * SQL-fragment för predikat: "objektets kund är någon av <customerIds>".
 */
export function objectPrimaryCustomerInSql(customerIds: string[]): SQL<boolean> {
  if (customerIds.length === 0) return sql<boolean>`FALSE`;
  return sql<boolean>`(${primaryPayerCustomerIdSql()} IN (${sql.join(customerIds.map(id => sql`${id}`), sql`, `)}))`;
}

/**
 * SQL-fragment för predikat: "objektet saknar kund (=ingen kund-koppling i
 * Ekonomi-metadatat)". Används för issue=no-customer-filtret. Kräver att den
 * härledda kunden dessutom finns och är aktiv i kundregistret.
 */
export function objectHasNoPrimaryCustomerSql(tenantId: string): SQL<boolean> {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = ${primaryPayerCustomerIdSql()}
      AND c.tenant_id = ${tenantId}
      AND c.deleted_at IS NULL
  )`;
}

/**
 * Idempotent skapande av kund-koppling för ett objekt — skriver Ekonomi-
 * metadatafältet "Kund" (referens → customers) på objektet. Ersätter de gamla
 * `object_payers`-skrivningarna: alla write-vägar som vill koppla ett
 * nyskapat/kopierat objekt till en kund gör det via metadata-raden här.
 *
 * Hoppar över om objektet redan har en (egen eller ärvd) kund (idempotent).
 * Best-effort: kastar aldrig — en misslyckad kund-koppling får aldrig fälla
 * objekt-skapandet. Returnerar den skapade metadata-radens id, eller null
 * (fanns redan / fel / ingen kund).
 */
export async function ensurePrimaryPayer(
  tenantId: string,
  objectId: string,
  customerId: string | null | undefined,
  // Task #1437: proveniens-markör i skapad_av. Flöden där kunden UTTRYCKLIGEN
  // valts (Import 2.0 body.customerId / per-rad-mappning, order, portal) ska
  // skicka en distinkt origin (t.ex. "import-explicit") så att städverktyg kan
  // skilja uttryckliga kopplingar från legacy-fallbackens "system"-rader.
  // Obligatorisk med flit: nya writes får ALDRIG tyst defaulta till "system".
  origin: string,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const existing = await getObjectPrimaryCustomerId(objectId);
    if (existing) return null;

    // Hitta (aktiv) "Kund"-katalogpost för tenanten. Skapas normalt av
    // ensureSystemomradenFalt — saknas den hoppar vi över (best-effort).
    const [katalog] = await db
      .select({ id: metadataKatalog.id, standardArvs: metadataKatalog.standardArvs })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        isNull(metadataKatalog.deletedAt),
        sql`lower(${metadataKatalog.namn}) = 'kund'`,
      ))
      .limit(1);
    if (!katalog) return null;

    const [ins] = await db
      .insert(metadataVarden)
      .values({
        tenantId,
        objektId: objectId,
        metadataKatalogId: katalog.id,
        vardeReferens: customerId,
        arvsNedat: katalog.standardArvs ?? true,
        skapadAv: origin,
        metod: "system",
      })
      .returning({ id: metadataVarden.id });
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
 * customerId filtrerar både raderna och child-räknaren på härledd kund.
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

  // Barn-räknaren filtrerar på härledd kund via batch-hämtning efteråt om
  // kund-filter är satt (den korrelerade metadata-härledningen per barn-rad i
  // en count-subquery blir annars för dyr och svårläst).
  const childCountSql = sql<number>`(SELECT count(*) FROM objects c WHERE c.parent_id = "objects"."id" AND c.tenant_id = ${tenantId} AND c.deleted_at IS NULL)`;

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

  // Kund-filtrerad barn-räkning (batch): räkna bara barn vars härledda kund
  // matchar filtret, så childCount ärver kund-filtret precis som raderna.
  if (customerId && rows.length > 0) {
    const parentIds = rows.map(r => r.id);
    const cc = await db.execute(sql`
      SELECT c.parent_id AS "parentId", count(*)::int AS "c"
      FROM objects c
      WHERE c.tenant_id = ${tenantId}
        AND c.deleted_at IS NULL
        AND c.parent_id IN (${sql.join(parentIds.map(id => sql`${id}`), sql`, `)})
        AND ${primaryPayerCustomerIdSqlFor(sql.raw('c.id'))} = ${customerId}
      GROUP BY c.parent_id
    `);
    const byParent = new Map((cc.rows as Array<{ parentId: string; c: number }>).map(r => [r.parentId, Number(r.c) || 0]));
    for (const r of rows) (r as any).childCount = byParent.get(r.id) ?? 0;
  }

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
 * Hämtar härledd kund (customers.id) för ett enskilt objekt. NULL om ingen.
 */
export async function getObjectPrimaryCustomerId(
  objectId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ customerId: primaryPayerCustomerIdSql() })
    .from(objects)
    .where(eq(objects.id, objectId))
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
    .select({ id: objects.id, customerId: primaryPayerCustomerIdSql() })
    .from(objects)
    .where(sql`${objects.id} IN (${sql.join(objectIds.map(id => sql`${id}`), sql`, `)})`);
  const byId = new Map(rows.map(r => [r.id, r.customerId ?? null]));
  for (const id of objectIds) map.set(id, byId.get(id) ?? null);
  return map;
}

/**
 * Lista alla objectIds vars härledda kund är <customerId> i en tenant.
 * Inkluderar objekt som ärver kunden från en förälder.
 */
export async function getObjectIdsByPrimaryCustomer(
  customerId: string,
  tenantId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(
      eq(objects.tenantId, tenantId),
      isNull(objects.deletedAt),
      objectHasPrimaryCustomerSql(customerId),
    ));
  return rows.map(r => r.id);
}
