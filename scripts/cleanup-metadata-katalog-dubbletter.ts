#!/usr/bin/env tsx
/**
 * Task #1480 — Städa dubblett-katalogfält (metadata_katalog) så inställningarna
 * inte visar förvirrande kopior.
 *
 * Prod-katalogen (kinab) har dubblettnamn (t.ex. "Fördjupad position" ×4,
 * "Vinjetbild" ×3, blandat arkiverade/aktiva). Namn-unikhet är app-nivå utan
 * DB-constraint, så gamla kopior ligger kvar och splittar värden.
 *
 * Vad skriptet gör (per tenant, per lower(namn)-grupp med >1 rad):
 *   1. Väljer EN kanonisk AKTIV rad (prioritet: systemlast → is_system →
 *      har beteckning → flest metadata_varden → äldst). Grupper helt utan
 *      aktiv rad lämnas orörda (rapporteras).
 *   2. Pekar om ALLA referenser från övriga kopior (aktiva + redan arkiverade)
 *      till den kanoniska raden:
 *        - metadata_varden / metadata_historik
 *        - order_type_metadata_links (kollisionsrader tas bort först — unik)
 *        - metadata_katalog_customers (kollisionsrader tas bort först — unik)
 *        - metadata_katalog.parent_metadata_id (barn i familjer)
 *        - object_header_configs (image/logo/field1-3)
 *        - object_quick_field_configs (field1-3)
 *        - metadata_editor_fields.metadata_katalog_id
 *        - import_templates.field_ids[] (ersätt + dedupe, bevarad ordning)
 *        - objects.metadata_field_order (jsonb-array: ersätt + dedupe)
 *   3. ARKIVERAR (soft-delete: deleted_at + archived_by/reason) de aktiva
 *      dubblett-raderna — ALDRIG hard-delete (katalogen är "kontoplan").
 *   4. Tombstonar överskotts-värden: om ett objekt/WO efter ompekningen har
 *      flera lokala aktiva värden för ett allow_duplicates=false-fält behålls
 *      det senast uppdaterade och övriga sätts raderad=true (historik bevaras).
 *
 * Idempotent: en ren omkörning hittar inga grupper med >1 aktiv rad och gör
 * ingenting. Alla writes körs i EN transaktion och har tenant_id i WHERE.
 *
 * Användning (dry-run är default; prod kräver dessutom CONFIRM-env):
 *   npx tsx scripts/cleanup-metadata-katalog-dubbletter.ts --dev            # dry-run mot DATABASE_URL
 *   npx tsx scripts/cleanup-metadata-katalog-dubbletter.ts --dev --confirm  # skarp mot dev
 *   npx tsx scripts/cleanup-metadata-katalog-dubbletter.ts                  # dry-run mot PROD_DATABASE_URL
 *   CONFIRM=YES_DEDUPE_PROD npx tsx scripts/cleanup-metadata-katalog-dubbletter.ts --confirm
 *
 * Flaggor:
 *   --dev             kör mot DATABASE_URL istället för PROD_DATABASE_URL
 *   --confirm         skarp körning (annars dry-run)
 *   --tenant <id>     begränsa till en tenant
 *   --create-index    efter lyckad städning: skapa det partiella unika indexet
 *                     (tenant_id, lower(namn)) WHERE deleted_at IS NULL
 *                     (samma som migrations/0149 — hoppar över om dubbletter
 *                     fortfarande finns i någon annan tenant)
 */

import pg from "pg";

const { Pool } = pg;

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--confirm");
const USE_DEV = args.includes("--dev");
const CREATE_INDEX = args.includes("--create-index");
const tenantIdx = args.indexOf("--tenant");
const ONLY_TENANT = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

const url = USE_DEV ? process.env.DATABASE_URL : process.env.PROD_DATABASE_URL;
if (!url) {
  console.error(`FEL: ${USE_DEV ? "DATABASE_URL" : "PROD_DATABASE_URL"} saknas.`);
  process.exit(1);
}
if (!USE_DEV && process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
  console.error("FEL: PROD_DATABASE_URL == DATABASE_URL — dev/prod-spärr. Avbryter.");
  process.exit(1);
}
if (!USE_DEV && !DRY_RUN && process.env.CONFIRM !== "YES_DEDUPE_PROD") {
  console.error("FEL: skarp prod-körning kräver CONFIRM=YES_DEDUPE_PROD i miljön.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 2 });
pool.on("error", (e) => console.error("pool error:", e.message));

const ACTOR = "task-1480-dedupe";

interface KatalogRow {
  id: string;
  tenant_id: string;
  namn: string;
  beteckning: string | null;
  datatyp: string;
  is_system: boolean;
  systemlast: boolean;
  created_at: string;
  deleted_at: string | null;
  value_count: number;
}

function pickCanonical(active: KatalogRow[]): KatalogRow {
  return [...active].sort((a, b) => {
    if (a.systemlast !== b.systemlast) return a.systemlast ? -1 : 1;
    if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
    const aBet = a.beteckning?.trim() ? 1 : 0;
    const bBet = b.beteckning?.trim() ? 1 : 0;
    if (aBet !== bBet) return bBet - aBet;
    if (a.value_count !== b.value_count) return b.value_count - a.value_count;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

function dedupePreserveOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

type Exec = (text: string, params?: unknown[]) => Promise<pg.QueryResult>;

async function repoint(q: Exec, tenant: string, dup: string, canon: string): Promise<void> {
  await q(`UPDATE metadata_varden SET metadata_katalog_id = $1 WHERE tenant_id = $2 AND metadata_katalog_id = $3`, [canon, tenant, dup]);
  await q(`UPDATE metadata_historik SET metadata_katalog_id = $1 WHERE tenant_id = $2 AND metadata_katalog_id = $3`, [canon, tenant, dup]);

  // order_type_metadata_links: unik (tenant, order_type, metadata_katalog_id)
  await q(
    `DELETE FROM order_type_metadata_links o
     WHERE o.tenant_id = $1 AND o.metadata_katalog_id = $2
       AND EXISTS (SELECT 1 FROM order_type_metadata_links c
                   WHERE c.tenant_id = $1 AND c.order_type = o.order_type AND c.metadata_katalog_id = $3)`,
    [tenant, dup, canon],
  );
  await q(`UPDATE order_type_metadata_links SET metadata_katalog_id = $1 WHERE tenant_id = $2 AND metadata_katalog_id = $3`, [canon, tenant, dup]);

  // metadata_katalog_customers: unik (metadata_katalog_id, customer_id)
  await q(
    `DELETE FROM metadata_katalog_customers m
     WHERE m.tenant_id = $1 AND m.metadata_katalog_id = $2
       AND EXISTS (SELECT 1 FROM metadata_katalog_customers c
                   WHERE c.metadata_katalog_id = $3 AND c.customer_id = m.customer_id)`,
    [tenant, dup, canon],
  );
  await q(`UPDATE metadata_katalog_customers SET metadata_katalog_id = $1 WHERE tenant_id = $2 AND metadata_katalog_id = $3`, [canon, tenant, dup]);

  // Barn-fält i familjer
  await q(`UPDATE metadata_katalog SET parent_metadata_id = $1 WHERE tenant_id = $2 AND parent_metadata_id = $3`, [canon, tenant, dup]);

  // Konfig-ytor som pekar in katalog-id (set null-FK:er — peka om istället)
  for (const [table, cols] of [
    ["object_header_configs", ["image_metadata_katalog_id", "logo_metadata_katalog_id", "field1_katalog_id", "field2_katalog_id", "field3_katalog_id"]],
    ["object_quick_field_configs", ["field1_katalog_id", "field2_katalog_id", "field3_katalog_id"]],
    ["metadata_editor_fields", ["metadata_katalog_id"]],
  ] as const) {
    for (const col of cols) {
      await q(`UPDATE ${table} SET ${col} = $1 WHERE tenant_id = $2 AND ${col} = $3`, [canon, tenant, dup]);
    }
  }

  // import_templates.field_ids[] — ersätt + dedupe (bevara ordning)
  const tpls = await q(`SELECT id, field_ids FROM import_templates WHERE tenant_id = $1 AND $2 = ANY(field_ids)`, [tenant, dup]);
  for (const tpl of tpls.rows as Array<{ id: string; field_ids: string[] }>) {
    const next = dedupePreserveOrder((tpl.field_ids ?? []).map((x) => (x === dup ? canon : x)));
    await q(`UPDATE import_templates SET field_ids = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`, [next, tenant, tpl.id]);
  }

  // objects.metadata_field_order (jsonb-array av katalog-id) — ersätt + dedupe
  const objs = await q(
    `SELECT id, metadata_field_order FROM objects
     WHERE tenant_id = $1 AND metadata_field_order IS NOT NULL AND metadata_field_order @> to_jsonb(ARRAY[$2::text])`,
    [tenant, dup],
  );
  for (const o of objs.rows as Array<{ id: string; metadata_field_order: string[] }>) {
    const next = dedupePreserveOrder((o.metadata_field_order ?? []).map((x) => (x === dup ? canon : x)));
    await q(`UPDATE objects SET metadata_field_order = $1 WHERE tenant_id = $2 AND id = $3`, [JSON.stringify(next), tenant, o.id]);
  }
}

async function main() {
  console.log("=".repeat(64));
  console.log("STÄDA metadata_katalog-dubbletter (arkivera, aldrig hard-delete)");
  console.log(`DB: ${USE_DEV ? "dev (DATABASE_URL)" : "PROD (PROD_DATABASE_URL)"}`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (inga ändringar)" : "SKARP KÖRNING"}`);
  if (ONLY_TENANT) console.log(`Tenant-filter: ${ONLY_TENANT}`);
  console.log("=".repeat(64));

  const client = await pool.connect();
  const q: Exec = (text, params) => client.query(text, params as any[]);
  try {
    const res = await q(
      `SELECT k.id, k.tenant_id, k.namn, k.beteckning, k.datatyp, k.is_system, k.systemlast,
              k.created_at, k.deleted_at,
              (SELECT count(*)::int FROM metadata_varden v
               WHERE v.tenant_id = k.tenant_id AND v.metadata_katalog_id = k.id) AS value_count
       FROM metadata_katalog k
       ${ONLY_TENANT ? "WHERE k.tenant_id = $1" : ""}
       ORDER BY k.tenant_id, lower(k.namn), k.created_at`,
      ONLY_TENANT ? [ONLY_TENANT] : [],
    );
    const rows = res.rows as KatalogRow[];

    const groups = new Map<string, KatalogRow[]>();
    for (const r of rows) {
      const key = `${r.tenant_id}::${r.namn.trim().toLowerCase()}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
    }

    if (!DRY_RUN) await q("BEGIN");

    let touchedGroups = 0;
    let archivedRows = 0;
    const canonicalIds: string[] = [];

    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      const active = group.filter((r) => r.deleted_at == null);
      if (active.length === 0) {
        console.log(`\n[${group[0].tenant_id}] "${group[0].namn}" — ${group.length} rader, ALLA arkiverade → lämnas orörda.`);
        continue;
      }
      const canonical = pickCanonical(active);
      // Kopior som pekas om: övriga AKTIVA (arkiveras) + redan ARKIVERADE med värden
      const activeDups = active.filter((r) => r.id !== canonical.id);
      const archivedDups = group.filter((r) => r.deleted_at != null && r.value_count > 0);
      if (activeDups.length === 0 && archivedDups.length === 0) continue;

      touchedGroups++;
      canonicalIds.push(canonical.id);
      const tenant = canonical.tenant_id;
      console.log(
        `\n[${tenant}] "${canonical.namn}" — ${group.length} rader (${active.length} aktiva). ` +
          `Kanonisk: ${canonical.id}${canonical.systemlast ? " [systemlast]" : canonical.is_system ? " [system]" : ""} (${canonical.value_count} värden)`,
      );

      for (const dup of [...activeDups, ...archivedDups]) {
        const wasArchived = dup.deleted_at != null;
        // DATATYPS-VAKT: peka aldrig om VÄRDEN mellan olika datatyper (t.ex.
        // legacy json-'kontaktperson' → rubrik-'Kontaktperson' vars värden bor
        // på barnfält). Sådana kopior kräver manuell datamigrering — rapportera
        // och hoppa över. Kopior UTAN värden är alltid säkra att arkivera.
        if (dup.value_count > 0 && dup.datatyp !== canonical.datatyp) {
          console.log(
            `  ⚠ HOPPAR ÖVER ${dup.id} (${dup.value_count} värden, datatyp "${dup.datatyp}" ≠ kanonisk "${canonical.datatyp}") — kräver manuell migrering.`,
          );
          continue;
        }
        if (DRY_RUN) {
          console.log(
            `  · skulle peka om ${dup.value_count} värden från ${dup.id}${wasArchived ? " (redan arkiverad)" : ""}` +
              `${wasArchived ? "" : " och ARKIVERA raden"}`,
          );
          continue;
        }
        await repoint(q, tenant, dup.id, canonical.id);
        if (!wasArchived) {
          await q(
            `UPDATE metadata_katalog
             SET deleted_at = now(), archived_by = $1,
                 archived_reason = $2
             WHERE tenant_id = $3 AND id = $4 AND deleted_at IS NULL`,
            [ACTOR, `Dubblett av "${canonical.namn}" — värden sammanslagna till ${canonical.id} (Task #1480)`, tenant, dup.id],
          );
          archivedRows++;
        }
        console.log(`  ✓ ompekad ${dup.id} (${dup.value_count} värden)${wasArchived ? "" : " + arkiverad"}`);
      }
    }

    // Tombstona överskotts-värden på allow_duplicates=false-fält efter sammanslagning
    if (!DRY_RUN && canonicalIds.length > 0) {
      const surplus = await q(
        `WITH ranked AS (
           SELECT mv.id,
                  ROW_NUMBER() OVER (
                    PARTITION BY mv.tenant_id, mv.metadata_katalog_id,
                                 COALESCE(mv.objekt_id, ''), COALESCE(mv.work_order_id, '')
                    ORDER BY mv.updated_at DESC, mv.created_at DESC, mv.id
                  ) AS rn
           FROM metadata_varden mv
           JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
           WHERE mk.allow_duplicates = false AND mv.raderad = false
             AND mv.metadata_katalog_id = ANY($1)
         )
         UPDATE metadata_varden SET raderad = true, raderad_av = $2, raderad_vid = now()
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`,
        [canonicalIds, ACTOR],
      );
      if ((surplus.rowCount ?? 0) > 0) {
        console.log(`\nTombstonade ${surplus.rowCount} överskotts-värde(n) på allow_duplicates=false-fält (senaste behållet).`);
      }
    }

    if (!DRY_RUN) await q("COMMIT");

    console.log("\n" + "=".repeat(64));
    if (touchedGroups === 0) {
      console.log("Inga aktiva dubbletter att städa.");
    } else if (DRY_RUN) {
      console.log(`${touchedGroups} namn-grupp(er) skulle städas. Kör med --confirm för skarp körning.`);
    } else {
      console.log(`KLART. ${touchedGroups} grupp(er) städade, ${archivedRows} rad(er) arkiverade.`);
    }

    // Valfritt: permanent skydd — partiellt unikt index (samma som migrations/0149)
    if (CREATE_INDEX && !DRY_RUN) {
      const remain = await q(
        `SELECT tenant_id, lower(namn) AS n, count(*) FROM metadata_katalog
         WHERE deleted_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1`,
      );
      if ((remain.rowCount ?? 0) > 0) {
        console.log(`Index HOPPAS ÖVER: ${remain.rowCount} aktiv(a) dubblettgrupp(er) kvar (annan tenant?).`);
      } else {
        await q(
          `CREATE UNIQUE INDEX IF NOT EXISTS uidx_metadata_katalog_active_tenant_namn
           ON metadata_katalog (tenant_id, lower(namn)) WHERE deleted_at IS NULL`,
        );
        console.log("Partiellt unikt index uidx_metadata_katalog_active_tenant_namn skapat/finns.");
      }
    }
    console.log("=".repeat(64));
  } catch (e) {
    if (!DRY_RUN) await q("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
