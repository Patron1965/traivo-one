// ============================================
// Task #970: Metadatastyrd fakturaflödeslogik ("Faktura från toppen")
// ============================================
//
// När ett orderkoncept pekas in från toppen av ett objektträd samlas alla
// färdiga work_orders i underliggande grenar normalt på EN konsoliderad faktura
// (befintlig logik i invoice-consolidation.ts grupperar per frozen
// recipient/customer). Två metadatastyrda mekanismer kan SPLITTRA den fakturan:
//
//   1) Fakturastopp (brytpunkt): ett objekt med metadatafältet "Fakturastopp=Ja"
//      bryter uppåt-samlingen där — WO i grenen under den noden hamnar på en egen
//      faktura medan resten fortsätter rulla upp till toppen. Fakturastopp läses
//      LOKALT per nod (ärvs ALDRIG nedåt — annars vore varje barn sin egen
//      brytpunkt). Vi går själva uppåt i förälderkedjan och hittar närmaste nod
//      (eller objektet självt) med ett sant Fakturastopp-värde.
//
//   2) Grupperingsfält (t.ex. "Förvaltare"): när ett konfigurerat
//      grupperingsfält har olika värde mellan objekt skapas en faktura per
//      distinkt värde. Grupperingsvärdet ärvs nedåt (närmaste vinner), precis
//      som vanlig objektmetadata.
//
// DESIGN: segmenteringen KOMPONERAS ovanpå frozen recipient/customer — den byter
// ALDRIG faktureringsmål (frozen-recipient-invarianten + ADR v3 objekt-neutralitet
// bevaras). Brytnoden är bara segment/audit/visning. Segmentet FRYSES på WO vid
// markWorkOrderReadyForInvoice (endast held-WO, endast aktiverade tenants);
// konsolideringen grupperar sedan på de frysta kolumnerna. NULL-segment = exakt
// dagens beteende (full back-compat). Förhandsvisningen räknar LIVE från aktuell
// metadata (det frysta värdet är auktoritativt för den faktiska faktureringen).

import { db } from "../db";
import { tenants, metadataKatalog } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

export const DEFAULT_BREAK_FIELD_NAME = "Fakturastopp";
export const DEFAULT_GROUPING_FIELD_NAME = "Förvaltare";

export type InvoiceFlowConfig = {
  enabled: boolean;
  breakFieldName: string;
  groupingFieldName: string | null;
};

export type BillingSegment = {
  // Närmaste förälder (eller objektet självt) med Fakturastopp=Ja, annars null.
  breakObjectId: string | null;
  // Namnet på grupperingsfältet som faktiskt drev en split (null om inget värde).
  groupingFieldName: string | null;
  // Grupperingsfältets värde (visningssträng) vid objektet, annars null.
  groupingValue: string | null;
  // Deterministisk suffix-nyckel `b:<id|->|g:<value|->`. NULL när ingen split.
  segmentKey: string | null;
};

export const EMPTY_SEGMENT: BillingSegment = {
  breakObjectId: null,
  groupingFieldName: null,
  groupingValue: null,
  segmentKey: null,
};

// Bygg den deterministiska segment-suffixnyckeln. Returnerar null när varken
// brytpunkt eller grupperingsvärde finns (= ingen split = back-compat).
export function buildSegmentKey(breakObjectId: string | null, groupingValue: string | null): string | null {
  if (!breakObjectId && (groupingValue == null || groupingValue === "")) return null;
  return `b:${breakObjectId ?? "-"}|g:${groupingValue == null || groupingValue === "" ? "-" : groupingValue}`;
}

// Läs per-tenant invoiceFlow-config ur tenants.settings.invoiceFlow.
// Defaults: avstängd, Fakturastopp / Förvaltare. Opt-in per tenant.
export async function getInvoiceFlowConfig(tenantId: string): Promise<InvoiceFlowConfig> {
  const [row] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const raw = ((row?.settings as Record<string, unknown> | null) ?? {})["invoiceFlow"] as
    | Record<string, unknown>
    | undefined;
  const breakFieldName =
    typeof raw?.breakFieldName === "string" && raw.breakFieldName.trim() !== ""
      ? (raw.breakFieldName as string).trim()
      : DEFAULT_BREAK_FIELD_NAME;
  // Grupperingsfältet: nyckel SAKNAS ⇒ default (Förvaltare); explicit null/""  ⇒
  // gruppering avstängd (ingen grupperings-dimension); sträng ⇒ använd den.
  const groupingRaw = raw ? raw.groupingFieldName : undefined;
  let groupingFieldName: string | null;
  if (groupingRaw === undefined) groupingFieldName = DEFAULT_GROUPING_FIELD_NAME;
  else if (typeof groupingRaw === "string" && groupingRaw.trim() !== "") groupingFieldName = groupingRaw.trim();
  else groupingFieldName = null;
  return {
    enabled: raw?.enabled === true,
    breakFieldName,
    groupingFieldName,
  };
}

// Skriv invoiceFlow-config (merge:ar in i tenants.settings, rör inga andra nycklar).
export async function setInvoiceFlowConfig(
  tenantId: string,
  patch: Partial<InvoiceFlowConfig>,
): Promise<InvoiceFlowConfig> {
  const [row] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const settings = ((row?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const current = (settings.invoiceFlow as Record<string, unknown> | undefined) ?? {};
  const next: Record<string, unknown> = { ...current };
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  if (patch.breakFieldName !== undefined) next.breakFieldName = patch.breakFieldName;
  if (patch.groupingFieldName !== undefined) next.groupingFieldName = patch.groupingFieldName;
  await db
    .update(tenants)
    .set({ settings: { ...settings, invoiceFlow: next } })
    .where(eq(tenants.id, tenantId));
  return getInvoiceFlowConfig(tenantId);
}

type FlowCatalogIds = {
  breakId: string | null;
  groupingId: string | null;
  groupingFieldName: string | null;
};

// Slå upp metadata_katalog-id för bryt- och grupperingsfält via NAMN (stabil
// universell nyckel per tenant). Saknas fältet ⇒ den dimensionen är inaktiv.
export async function resolveFlowCatalogIds(
  tenantId: string,
  config: InvoiceFlowConfig,
): Promise<FlowCatalogIds> {
  const names = [config.breakFieldName, config.groupingFieldName].filter(
    (n): n is string => typeof n === "string" && n.trim() !== "",
  );
  if (names.length === 0) return { breakId: null, groupingId: null, groupingFieldName: null };
  const rows = await db
    .select({ id: metadataKatalog.id, namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, tenantId), isNull(metadataKatalog.deletedAt)));
  const byName = new Map(rows.map((r) => [r.namn, r.id] as const));
  const breakId = config.breakFieldName ? byName.get(config.breakFieldName) ?? null : null;
  const groupingId = config.groupingFieldName ? byName.get(config.groupingFieldName) ?? null : null;
  return {
    breakId,
    groupingId,
    groupingFieldName: groupingId ? config.groupingFieldName : null,
  };
}

// Visningssträng för en metadata_varden-rad (speglar getObjectWithAllMetadata).
function displayFromRow(r: {
  varde_string?: unknown;
  varde_integer?: unknown;
  varde_decimal?: unknown;
  varde_boolean?: unknown;
  varde_datetime?: unknown;
  varde_referens?: unknown;
}): string | null {
  if (r.varde_string != null && r.varde_string !== "") return String(r.varde_string);
  if (r.varde_integer != null) return String(r.varde_integer);
  if (r.varde_decimal != null) return String(r.varde_decimal);
  if (r.varde_boolean != null) return String(r.varde_boolean);
  if (r.varde_datetime != null) return new Date(r.varde_datetime as string).toISOString();
  if (r.varde_referens != null && r.varde_referens !== "") return String(r.varde_referens);
  return null;
}

// Avgör om ett Fakturastopp-värde är "sant" (Ja/true). Robust mot select-fält
// (varde_string="Ja") och boolean-fält (varde_boolean=true).
function isBreakTruthy(r: { varde_boolean?: unknown; varde_string?: unknown }): boolean {
  if (r.varde_boolean === true) return true;
  if (typeof r.varde_string === "string") {
    const v = r.varde_string.trim().toLowerCase();
    return v === "ja" || v === "yes" || v === "true" || v === "sant" || v === "1" || v === "x";
  }
  return false;
}

// UPPÅT: beräkna segmentet för ETT objekt genom att gå uppför primär-
// förälderkedjan (objects.parent_id). Används vid ready-time per WO.
// Returnerar EMPTY_SEGMENT när config saknar aktiva dimensioner.
export async function computeBillingSegmentForObject(
  tenantId: string,
  objectId: string,
  config: InvoiceFlowConfig,
  catalogIds?: FlowCatalogIds,
): Promise<BillingSegment> {
  if (!config.enabled) return EMPTY_SEGMENT;
  const ids = catalogIds ?? (await resolveFlowCatalogIds(tenantId, config));
  if (!ids.breakId && !ids.groupingId) return EMPTY_SEGMENT;

  const res = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 0 AS lvl
        FROM objects
        WHERE id = ${objectId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
      UNION ALL
      SELECT o.id, o.parent_id, c.lvl + 1
        FROM objects o
        INNER JOIN chain c ON o.id = c.parent_id
        WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
    )
    SELECT
      c.id, c.lvl,
      bv.varde_string AS b_str, bv.varde_boolean AS b_bool,
      gv.varde_string AS g_str, gv.varde_integer AS g_int, gv.varde_decimal AS g_dec,
      gv.varde_boolean AS g_bool, gv.varde_datetime AS g_dt, gv.varde_referens AS g_ref
    FROM chain c
    LEFT JOIN metadata_varden bv
      ON bv.objekt_id = c.id AND bv.tenant_id = ${tenantId}
      AND bv.metadata_katalog_id = ${ids.breakId ?? null}
      AND COALESCE(bv.raderad, false) = false
    LEFT JOIN metadata_varden gv
      ON gv.objekt_id = c.id AND gv.tenant_id = ${tenantId}
      AND gv.metadata_katalog_id = ${ids.groupingId ?? null}
      AND COALESCE(gv.raderad, false) = false
    ORDER BY c.lvl ASC
  `);

  const rows: any[] = (res as any).rows ?? (Array.isArray(res) ? (res as any[]) : []);
  let breakObjectId: string | null = null;
  let groupingValue: string | null = null;
  for (const row of rows) {
    if (breakObjectId == null && ids.breakId && isBreakTruthy({ varde_boolean: row.b_bool, varde_string: row.b_str })) {
      breakObjectId = row.id;
    }
    if (groupingValue == null && ids.groupingId) {
      const v = displayFromRow({
        varde_string: row.g_str,
        varde_integer: row.g_int,
        varde_decimal: row.g_dec,
        varde_boolean: row.g_bool,
        varde_datetime: row.g_dt,
        varde_referens: row.g_ref,
      });
      if (v != null) groupingValue = v;
    }
    if (breakObjectId != null && (groupingValue != null || !ids.groupingId)) break;
  }

  return {
    breakObjectId,
    groupingFieldName: groupingValue != null ? ids.groupingFieldName : null,
    groupingValue,
    segmentKey: buildSegmentKey(breakObjectId, groupingValue),
  };
}

// NEDÅT: beräkna segmentet för ALLA noder i ett subträd i EN fråga. Brytnod och
// grupperingsvärde propageras nedåt (barnets egna värde vinner, annars ärvs
// förälderns). Används av förhandsvisningen (scopat till vald rot-nod).
export async function computeBillingSegmentsForSubtree(
  tenantId: string,
  rootObjectId: string,
  config: InvoiceFlowConfig,
  catalogIds?: FlowCatalogIds,
): Promise<Map<string, BillingSegment>> {
  const result = new Map<string, BillingSegment>();
  if (!config.enabled) return result;
  const ids = catalogIds ?? (await resolveFlowCatalogIds(tenantId, config));
  if (!ids.breakId && !ids.groupingId) return result;

  const res = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT
        o.id, o.parent_id, 0 AS lvl,
        (
          SELECT bv.id FROM metadata_varden bv
          WHERE bv.objekt_id = o.id AND bv.tenant_id = ${tenantId}
            AND bv.metadata_katalog_id = ${ids.breakId ?? null}
            AND COALESCE(bv.raderad, false) = false
            AND (
              bv.varde_boolean = true
              OR lower(btrim(bv.varde_string)) IN ('ja','yes','true','sant','1','x')
            )
          LIMIT 1
        ) IS NOT NULL AS self_break,
        (
          SELECT COALESCE(
            NULLIF(gv.varde_string, ''),
            gv.varde_integer::text, gv.varde_decimal::text, gv.varde_boolean::text,
            gv.varde_datetime::text, NULLIF(gv.varde_referens, '')
          )
          FROM metadata_varden gv
          WHERE gv.objekt_id = o.id AND gv.tenant_id = ${tenantId}
            AND gv.metadata_katalog_id = ${ids.groupingId ?? null}
            AND COALESCE(gv.raderad, false) = false
          LIMIT 1
        ) AS self_group
      FROM objects o
      WHERE o.id = ${rootObjectId} AND o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
      UNION ALL
      SELECT
        c.id, c.parent_id, t.lvl + 1,
        (
          SELECT bv.id FROM metadata_varden bv
          WHERE bv.objekt_id = c.id AND bv.tenant_id = ${tenantId}
            AND bv.metadata_katalog_id = ${ids.breakId ?? null}
            AND COALESCE(bv.raderad, false) = false
            AND (
              bv.varde_boolean = true
              OR lower(btrim(bv.varde_string)) IN ('ja','yes','true','sant','1','x')
            )
          LIMIT 1
        ) IS NOT NULL AS self_break,
        (
          SELECT COALESCE(
            NULLIF(gv.varde_string, ''),
            gv.varde_integer::text, gv.varde_decimal::text, gv.varde_boolean::text,
            gv.varde_datetime::text, NULLIF(gv.varde_referens, '')
          )
          FROM metadata_varden gv
          WHERE gv.objekt_id = c.id AND gv.tenant_id = ${tenantId}
            AND gv.metadata_katalog_id = ${ids.groupingId ?? null}
            AND COALESCE(gv.raderad, false) = false
          LIMIT 1
        ) AS self_group
      FROM objects c
      INNER JOIN tree t ON c.parent_id = t.id
      WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL
    ),
    resolved AS (
      SELECT
        id, parent_id, lvl, self_break, self_group,
        CASE WHEN self_break THEN id ELSE NULL END AS own_break
      FROM tree
    )
    SELECT * FROM resolved ORDER BY lvl ASC
  `);

  // Propagera nedåt i JS (rader är ordnade lvl-stigande, förälder före barn).
  const rows: any[] = (res as any).rows ?? (Array.isArray(res) ? (res as any[]) : []);
  const breakByNode = new Map<string, string | null>();
  const groupByNode = new Map<string, string | null>();
  for (const row of rows) {
    const parentBreak = row.parent_id ? breakByNode.get(row.parent_id) ?? null : null;
    const parentGroup = row.parent_id ? groupByNode.get(row.parent_id) ?? null : null;
    const nodeBreak = row.self_break ? (row.id as string) : parentBreak;
    const nodeGroup = row.self_group != null ? (row.self_group as string) : parentGroup;
    breakByNode.set(row.id, nodeBreak);
    groupByNode.set(row.id, nodeGroup);
    result.set(row.id, {
      breakObjectId: nodeBreak,
      groupingFieldName: nodeGroup != null ? ids.groupingFieldName : null,
      groupingValue: nodeGroup,
      segmentKey: buildSegmentKey(nodeBreak, nodeGroup),
    });
  }
  return result;
}
