// Tenant-scoped dubblettidentifiering för objekt (samma namn + adress).
// Centraliserar SQL:en som tidigare låg inline i objectRoutes.ts så att den
// (a) alltid filtreras på tenant_id (säkerhet) och (b) kan återanvändas av
// importflödets förhandsvisning (Feature 2: dubblettvarning i importen).
//
// Kundkoppling härleds ur Ekonomi-metadatat 'Kund' (Etapp 5) — inte legacy objects.customer_id.
import { db } from "../db";
import { sql, and, eq, inArray } from "drizzle-orm";
import { objects } from "@shared/schema";
import { primaryPayerCustomerIdSqlFor } from "./object-customer";
import { objectOwnMetadataTextValueSqlFor } from "./object-metadata-sql";

export interface DuplicateMember {
  id: string;
  name: string | null;
  address: string | null;
  objectNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  postalCode: string | null;
  objectType: string | null;
  createdAt: string | null;
  workOrderCount: number;
  linkedWoCount: number;
  articleCount: number;
  contactCount: number;
}

export interface DuplicateGroup {
  name: string | null;
  address: string | null;
  customerId: string | null;
  customerName: string | null;
  count: number;
  members: DuplicateMember[];
}

export interface DuplicateSummary {
  totalGroups: number;
  removableCount: number;
  totalObjects: number;
}

// En kandidat (rad i en import) + de befintliga aktiva objekt den krockar med.
export interface DuplicateCandidateMatch {
  name: string;
  address: string | null;
  existing: Array<{
    id: string;
    objectNumber: string | null;
    name: string | null;
    address: string | null;
  }>;
}

export async function getObjectDuplicateSummary(tenantId: string): Promise<DuplicateSummary> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) as total_groups,
      COALESCE(SUM(cnt - 1), 0) as removable_count,
      (SELECT COUNT(*) FROM objects WHERE deleted_at IS NULL AND tenant_id = ${tenantId}) as total_objects
    FROM (
      SELECT name, address, primary_customer_id, COUNT(*) as cnt
      FROM (
        SELECT o.name, o.address,
          ${primaryPayerCustomerIdSqlFor(sql.raw("o.id"))} AS primary_customer_id
        FROM objects o
        WHERE o.deleted_at IS NULL AND o.tenant_id = ${tenantId}
      ) s
      GROUP BY name, address, primary_customer_id
      HAVING COUNT(*) > 1
    ) t
  `);
  const row = result.rows[0] || {};
  return {
    totalGroups: Number(row.total_groups || 0),
    removableCount: Number(row.removable_count || 0),
    totalObjects: Number(row.total_objects || 0),
  };
}

export async function listObjectDuplicateGroups(
  tenantId: string,
  page: number,
  limit: number,
): Promise<DuplicateGroup[]> {
  const offset = (page - 1) * limit;
  const primaryPayerSubquery = primaryPayerCustomerIdSqlFor(sql.raw("o.id"));

  const groups = await db.execute(sql`
    SELECT name, address, primary_customer_id AS customer_id, COUNT(*) as cnt
    FROM (
      SELECT o.name, o.address,
        ${primaryPayerCustomerIdSqlFor(sql.raw("o.id"))} AS primary_customer_id
      FROM objects o
      WHERE o.deleted_at IS NULL AND o.tenant_id = ${tenantId}
    ) t
    GROUP BY name, address, primary_customer_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const duplicateGroups: DuplicateGroup[] = [];
  for (const g of groups.rows) {
    const customerMatch = g.customer_id
      ? sql`${primaryPayerSubquery} = ${g.customer_id}`
      : sql`${primaryPayerSubquery} IS NULL`;
    const memberRows = await db.execute(sql`
      SELECT o.id, o.name, o.address, o.object_number, ${primaryPayerSubquery} AS customer_id,
             o.latitude, o.longitude, o.city, o.postal_code,
             ${objectOwnMetadataTextValueSqlFor("Objekttyp", sql.raw("o.id"))} AS object_type,
             o.created_at,
             (SELECT c.name FROM customers c WHERE c.id = ${primaryPayerSubquery}) as customer_name,
             (SELECT COUNT(*) FROM work_orders wo WHERE wo.object_id = o.id) as work_order_count,
             (SELECT COUNT(*) FROM work_order_objects woo WHERE woo.object_id = o.id) as linked_wo_count,
             (SELECT COUNT(*) FROM object_articles oa WHERE oa.object_id = o.id) as article_count,
             (SELECT COUNT(*) FROM metadata_varden mv
                JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
                  AND mk.area = 'kontakt' AND lower(mk.namn) = 'namn' AND mk.deleted_at IS NULL
                WHERE mv.objekt_id = o.id AND COALESCE(mv.raderad, false) = false) as contact_count
      FROM objects o
      WHERE o.tenant_id = ${tenantId}
        AND o.name = ${g.name}
        AND ${g.address ? sql`o.address = ${g.address}` : sql`o.address IS NULL`}
        AND ${customerMatch}
        AND o.deleted_at IS NULL
      ORDER BY
        (SELECT COUNT(*) FROM work_orders wo WHERE wo.object_id = o.id) DESC,
        o.created_at ASC
    `);

    duplicateGroups.push({
      name: g.name as string | null,
      address: g.address as string | null,
      customerId: g.customer_id as string | null,
      customerName: (memberRows.rows[0]?.customer_name as string) || null,
      count: Number(g.cnt),
      members: memberRows.rows.map((m) => ({
        id: m.id as string,
        name: m.name as string | null,
        address: m.address as string | null,
        objectNumber: m.object_number as string | null,
        customerId: m.customer_id as string | null,
        customerName: m.customer_name as string | null,
        latitude: m.latitude as number | null,
        longitude: m.longitude as number | null,
        city: m.city as string | null,
        postalCode: m.postal_code as string | null,
        objectType: m.object_type as string | null,
        createdAt: m.created_at as string | null,
        workOrderCount: Number(m.work_order_count || 0),
        linkedWoCount: Number(m.linked_wo_count || 0),
        articleCount: Number(m.article_count || 0),
        contactCount: Number(m.contact_count || 0),
      })),
    });
  }
  return duplicateGroups;
}

// Förhandsvisning: givet kandidat-rader (namn + ev. adress) i en import,
// returnera de som krockar med BEFINTLIGA aktiva objekt i tenanten.
// Matchar namn + adress case-insensitivt och trim:at (null/tom adress = tom).
export async function findObjectDuplicateCandidates(
  tenantId: string,
  candidates: Array<{ name: string; address?: string | null }>,
  opts: { maxCandidates?: number; perCandidateLimit?: number } = {},
): Promise<DuplicateCandidateMatch[]> {
  const maxCandidates = opts.maxCandidates ?? 2000;
  const perCandidateLimit = opts.perCandidateLimit ?? 25;

  // Deduplicera kandidater på (namn|adress) så vi inte kör samma fråga flera gånger.
  const seen = new Map<string, { name: string; address: string | null }>();
  for (const c of candidates) {
    const name = (c.name ?? "").trim();
    if (!name) continue;
    const address = c.address != null ? String(c.address).trim() : null;
    const key = `${name.toLowerCase()}|${(address ?? "").toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, { name, address });
    if (seen.size >= maxCandidates) break;
  }

  const matches: DuplicateCandidateMatch[] = [];
  for (const { name, address } of Array.from(seen.values())) {
    const rows = await db.execute(sql`
      SELECT id, object_number, name, address
      FROM objects
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND lower(trim(name)) = lower(trim(${name}))
        AND lower(trim(coalesce(address, ''))) = lower(trim(coalesce(${address ?? ""}, '')))
      LIMIT ${perCandidateLimit}
    `);
    if (rows.rows.length > 0) {
      matches.push({
        name,
        address,
        existing: rows.rows.map((r) => ({
          id: r.id as string,
          objectNumber: r.object_number as string | null,
          name: r.name as string | null,
          address: r.address as string | null,
        })),
      });
    }
  }
  return matches;
}

// Feature 2: en dubblettvarning för importflödets förhandsvisning. Knyter ihop
// en (eller flera) import-rader med de BEFINTLIGA aktiva objekt de krockar med
// (samma namn + adress). Rent informativ — ingen auto-merge sker vid import.
export interface ImportDuplicateWarning {
  name: string;
  address: string | null;
  rowNumbers: number[];
  existing: Array<{
    id: string;
    objectNumber: string | null;
    name: string | null;
    address: string | null;
  }>;
}

// Givet import-kandidater (med radnummer + ev. egen objekt-identitet) returnerar
// dubblettvarningar mot befintliga objekt. `selfObjectNumbers` används för att
// filtrera bort självträffar: en rad som UPPDATERAR ett befintligt objekt (matchat
// på system-/externt nummer) ska inte varnas för att krocka med sig själv.
export async function findImportDuplicateWarnings(
  tenantId: string,
  candidates: Array<{
    rowNumber: number;
    name: string;
    address?: string | null;
    selfObjectNumbers?: Array<string | null | undefined>;
  }>,
  opts: { maxCandidates?: number; perCandidateLimit?: number } = {},
): Promise<ImportDuplicateWarning[]> {
  // Gruppera rader på (namn|adress) så samma fråga inte körs flera gånger och
  // så att flera rader som pekar på samma dubblett samlas i en varning.
  const groups = new Map<
    string,
    { name: string; address: string | null; rowNumbers: number[]; self: Set<string> }
  >();
  for (const c of candidates) {
    const name = (c.name ?? "").trim();
    if (!name) continue;
    const address = c.address != null ? String(c.address).trim() : null;
    // Import-dubblettvarning kräver BÅDE namn och adress: namn-only-matchning är
    // för svag och skulle flagga mängder av adresslösa kärl/utrustning som
    // "dubbletter". Featuren är uttryckligen "samma namn + adress".
    if (!address) continue;
    const key = `${name.toLowerCase()}|${address.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { name, address, rowNumbers: [], self: new Set<string>() };
      groups.set(key, g);
    }
    g.rowNumbers.push(c.rowNumber);
    for (const sn of c.selfObjectNumbers ?? []) {
      if (sn) g.self.add(String(sn).trim());
    }
  }

  const matches = await findObjectDuplicateCandidates(
    tenantId,
    Array.from(groups.values()).map((g) => ({ name: g.name, address: g.address })),
    opts,
  );

  const warnings: ImportDuplicateWarning[] = [];
  for (const m of matches) {
    const key = `${m.name.toLowerCase()}|${(m.address ?? "").toLowerCase()}`;
    const g = groups.get(key);
    if (!g) continue;
    // Filtrera bort objektet raden själv uppdaterar (självträff).
    const existing = m.existing.filter(
      (e) => !(e.objectNumber && g.self.has(e.objectNumber.trim())),
    );
    if (existing.length === 0) continue;
    warnings.push({
      name: m.name,
      address: m.address,
      rowNumbers: g.rowNumbers.slice().sort((a, b) => a - b),
      existing,
    });
  }
  return warnings;
}

// FK-tabeller vars object_id pekas om till keep-objektet vid sammanslagning.
const REASSIGN_FK_TABLES = [
  "work_orders", "work_order_objects", "assignments", "protocols",
  "deviation_reports", "setup_time_logs", "planning_parameters",
  "predictive_forecasts", "annual_goals", "customer_booking_requests",
  "customer_change_requests", "customer_communications", "customer_issue_reports",
  "public_issue_reports", "qr_code_links", "self_bookings",
  "subscription_changes", "subscriptions", "iot_devices",
  "inspection_metadata", "task_metadata_updates",
];
// Barn-tabeller som flyttas (object_id) till keep-objektet.
const REASSIGN_CHILD_TABLES = [
  "object_articles", "object_parents",
];

export class DuplicateMergeOwnershipError extends Error {}

// Vilka av de angivna tabellerna har en tenant_id-kolumn? Avgör om merge-UPDATE
// kan lägga till `AND tenant_id = ...` som defense-in-depth-predikat.
async function getTablesWithTenantId(tables: string[]): Promise<Set<string>> {
  if (tables.length === 0) return new Set();
  const rows = await db.execute(
    sql`SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'tenant_id'
          AND table_name IN (${sql.join(tables.map((t) => sql`${t}`), sql`, `)})`,
  );
  return new Set(((rows as any).rows ?? []).map((r: any) => String(r.table_name)));
}

// Slår ihop dubbletter: pekar om relationer till keep-objektet och soft-deletar
// resten. Tenant-säkrad: ALLA inblandade objekt måste tillhöra tenanten, annars
// kastas DuplicateMergeOwnershipError (förhindrar cross-tenant-merge).
export async function mergeDuplicateObjects(
  tenantId: string,
  keepId: string,
  removeIds: string[],
): Promise<{ kept: string; removed: number; reassigned: number }> {
  const ids = Array.from(new Set([keepId, ...removeIds]));
  const owned = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, ids)));
  if (owned.length !== ids.length) {
    throw new DuplicateMergeOwnershipError("Ett eller flera objekt tillhör inte denna tenant");
  }

  // Tabeller med egen tenant_id får ett extra tenant-predikat på UPDATE:n
  // (defense-in-depth). Barn-tabeller utan tenant_id (t.ex. object_parents) saknar
  // kolumnen helt — där är raderna redan begränsade via object_id = removeId, och
  // removeId är tenant-verifierad ovan (owned-checken), så det är säkert.
  const tenantScoped = await getTablesWithTenantId([
    ...REASSIGN_FK_TABLES,
    ...REASSIGN_CHILD_TABLES,
  ]);

  let reassigned = 0;
  for (const removeId of removeIds) {
    for (const table of REASSIGN_FK_TABLES) {
      try {
        const tenantPred = tenantScoped.has(table)
          ? sql` AND tenant_id = ${tenantId}`
          : sql``;
        const result = await db.execute(
          sql`UPDATE ${sql.identifier(table)} SET object_id = ${keepId} WHERE object_id = ${removeId}${tenantPred}`,
        );
        reassigned += Number((result as any).rowCount || 0);
      } catch {}
    }
    for (const table of REASSIGN_CHILD_TABLES) {
      try {
        const tenantPred = tenantScoped.has(table)
          ? sql` AND tenant_id = ${tenantId}`
          : sql``;
        await db.execute(
          sql`UPDATE ${sql.identifier(table)} SET object_id = ${keepId} WHERE object_id = ${removeId}${tenantPred}`,
        );
      } catch {}
    }
    // Soft-delete (aldrig hard-delete), tenant-scoped (defense-in-depth).
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(and(eq(objects.id, removeId), eq(objects.tenantId, tenantId)));
  }

  return { kept: keepId, removed: removeIds.length, reassigned };
}
