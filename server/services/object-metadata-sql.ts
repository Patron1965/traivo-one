import { sql, type SQL } from "drizzle-orm";

// ============================================================================
// METADATA-VÄRDE SOM SQL-FRAGMENT (Etapp 5)
// ----------------------------------------------------------------------------
// Objektens gamla specialkolumner (åtkomstkod, nyckelnummer m.fl.) är borttagna
// — värdena bor i metadata_katalog/metadata_varden. Den här hjälparen ger ett
// korrelerat subquery-fragment som löser upp ett metadatafälts textvärde för
// "objects"."id" i den FROM-klausul queryt redan har, arvs-medvetet uppåt via
// PRIMÄRA förälderkedjan (närmast-vinner), samma modell som
// primaryPayerCustomerIdSqlFor i object-customer.ts.
//
// OBS: literalen "objects"."id" är medveten — se memory
// drizzle-unqualified-subquery-column.
// ============================================================================

/**
 * Textvärdet (varde_string) för katalogfältet med namn `fieldName` (case-
 * insensitive) på objektet, eller närmast ärvt värde uppåt i primärkedjan.
 * NULL om inget värde finns.
 */
export function objectMetadataTextValueSql(fieldName: string): SQL<string | null> {
  return objectMetadataTextValueSqlFor(fieldName, sql.raw(`"objects"."id"`));
}

/** Som objectMetadataTextValueSql men med valfri yttre id-referens (t.ex. sql.raw('o.id')). */
export function objectMetadataTextValueSqlFor(
  fieldName: string,
  idRef: SQL,
): SQL<string | null> {
  return sql<string | null>`(
    WITH RECURSIVE metachain AS (
      SELECT mo.id, mo.parent_id, mo.tenant_id, 0 AS lvl
      FROM objects mo WHERE mo.id = ${idRef}
      UNION ALL
      SELECT p.id, p.parent_id, p.tenant_id, mc.lvl + 1
      FROM objects p JOIN metachain mc ON p.id = mc.parent_id
      WHERE mc.lvl < 50
    )
    SELECT mv.varde_string
    FROM metachain mc
    JOIN metadata_varden mv ON mv.objekt_id = mc.id AND mv.tenant_id = mc.tenant_id
    JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
      AND lower(mk.namn) = lower(${fieldName})
      AND mk.deleted_at IS NULL
      AND mk.tenant_id = mc.tenant_id
    WHERE mv.varde_string IS NOT NULL
      AND COALESCE(mv.raderad, FALSE) = FALSE
      AND (mv.status IS NULL OR mv.status = 'aktiv')
      AND (mc.lvl = 0 OR (mv.arvs_nedat = TRUE AND COALESCE(mv.niva_las, FALSE) = FALSE))
    ORDER BY mc.lvl ASC
    LIMIT 1
  )`;
}
