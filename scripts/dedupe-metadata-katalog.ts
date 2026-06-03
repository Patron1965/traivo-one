/**
 * scripts/dedupe-metadata-katalog.ts
 *
 * Slår ihop dubbletter i `metadata_katalog` per tenant. Två (eller fler) rader
 * med samma `namn` (case-insensitivt) är samma logiska metadatafält och ska bara
 * finnas en gång — annars dyker fältet upp flera gånger i importmallar och
 * fält-väljare (se Task #672, fältet "Antal").
 *
 * För varje namn-grupp väljs EN kanonisk rad (prioritet: is_system → har
 * beteckning → äldst). Alla referenser till de överflödiga raderna pekas om till
 * den kanoniska, varefter de överflödiga raderna tas bort.
 *
 * Referenser som pekas om:
 *   - metadata_varden.metadata_katalog_id        (objekt-/WO-värden)
 *   - metadata_historik.metadata_katalog_id      (historik)
 *   - order_type_metadata_links.metadata_katalog_id (ordertyp-kopplingar, unik)
 *   - metadata_katalog_customers.metadata_katalog_id (kundlås, unik)
 *   - metadata_katalog.parent_metadata_id        (barn-fält i familjer)
 *   - import_templates.field_ids[]               (sparade mallar, array)
 *
 * concept_filters.metadata_key refererar via NAMN (sträng), inte id — den
 * kanoniska raden behåller namnet så de filtren fortsätter matcha.
 *
 * Alla UPDATE/DELETE har tenant_id i WHERE (defense-in-depth, multi-tenant).
 *
 * Användning:
 *   npx tsx scripts/dedupe-metadata-katalog.ts                 # dry-run
 *   npx tsx scripts/dedupe-metadata-katalog.ts --confirm       # skarp körning
 *   npx tsx scripts/dedupe-metadata-katalog.ts --tenant kinab  # begränsa tenant
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--confirm");
const tenantIdx = args.indexOf("--tenant");
const ONLY_TENANT = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

interface KatalogRow {
  id: string;
  tenant_id: string;
  namn: string;
  beteckning: string | null;
  kategori: string | null;
  is_system: boolean;
  created_at: string;
}

function rowsOf(r: any): any[] {
  return r.rows ?? r;
}

// Välj kanonisk rad: is_system först, sedan rad med beteckning, sedan äldst.
function pickCanonical(group: KatalogRow[]): KatalogRow {
  return [...group].sort((a, b) => {
    if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
    const aBet = a.beteckning && a.beteckning.trim() ? 1 : 0;
    const bBet = b.beteckning && b.beteckning.trim() ? 1 : 0;
    if (aBet !== bBet) return bBet - aBet;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

function dedupePreserveOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

async function repoint(tenant: string, dup: string, canon: string): Promise<void> {
  // metadata_varden + metadata_historik: enkel ompekning (inga unika constraints).
  await db.execute(sql`UPDATE metadata_varden SET metadata_katalog_id = ${canon} WHERE tenant_id = ${tenant} AND metadata_katalog_id = ${dup}`);
  await db.execute(sql`UPDATE metadata_historik SET metadata_katalog_id = ${canon} WHERE tenant_id = ${tenant} AND metadata_katalog_id = ${dup}`);

  // order_type_metadata_links: unik (tenant, order_type, metadata_katalog_id).
  // Ta bort rader som skulle kollidera med kanonisk, peka sedan om resten.
  await db.execute(sql`
    DELETE FROM order_type_metadata_links o
    WHERE o.tenant_id = ${tenant} AND o.metadata_katalog_id = ${dup}
      AND EXISTS (
        SELECT 1 FROM order_type_metadata_links c
        WHERE c.tenant_id = ${tenant} AND c.order_type = o.order_type AND c.metadata_katalog_id = ${canon}
      )`);
  await db.execute(sql`UPDATE order_type_metadata_links SET metadata_katalog_id = ${canon} WHERE tenant_id = ${tenant} AND metadata_katalog_id = ${dup}`);

  // metadata_katalog_customers: unik (metadata_katalog_id, customer_id).
  await db.execute(sql`
    DELETE FROM metadata_katalog_customers m
    WHERE m.tenant_id = ${tenant} AND m.metadata_katalog_id = ${dup}
      AND EXISTS (
        SELECT 1 FROM metadata_katalog_customers c
        WHERE c.metadata_katalog_id = ${canon} AND c.customer_id = m.customer_id
      )`);
  await db.execute(sql`UPDATE metadata_katalog_customers SET metadata_katalog_id = ${canon} WHERE tenant_id = ${tenant} AND metadata_katalog_id = ${dup}`);

  // Barn-fält i familjer: peka förälder mot kanonisk.
  await db.execute(sql`UPDATE metadata_katalog SET parent_metadata_id = ${canon} WHERE tenant_id = ${tenant} AND parent_metadata_id = ${dup}`);

  // import_templates.field_ids[]: ersätt dup→canon och deduplicera (bevara ordning).
  const tpls = rowsOf(
    await db.execute(sql`SELECT id, field_ids FROM import_templates WHERE tenant_id = ${tenant} AND ${dup} = ANY(field_ids)`),
  ) as Array<{ id: string; field_ids: string[] }>;
  for (const tpl of tpls) {
    const next = dedupePreserveOrder((tpl.field_ids ?? []).map((x) => (x === dup ? canon : x)));
    const literal = `ARRAY[${next.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}]::text[]`;
    await db.execute(sql`UPDATE import_templates SET field_ids = ${sql.raw(literal)}, updated_at = now() WHERE tenant_id = ${tenant} AND id = ${tpl.id}`);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("DEDUPE metadata_katalog (per tenant, by lower(namn))");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (ingen ändring körs)" : "SKARP KÖRNING"}`);
  if (ONLY_TENANT) console.log(`Tenant-filter: ${ONLY_TENANT}`);
  console.log("=".repeat(60));

  const all = rowsOf(
    await db.execute(sql`
      SELECT id, tenant_id, namn, beteckning, kategori, is_system, created_at
      FROM metadata_katalog
      ORDER BY tenant_id, lower(namn), created_at
    `),
  ) as KatalogRow[];

  const groups = new Map<string, KatalogRow[]>();
  for (const r of all) {
    if (ONLY_TENANT && r.tenant_id !== ONLY_TENANT) continue;
    const key = `${r.tenant_id}::${r.namn.toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let groupsWithDupes = 0;
  let removed = 0;

  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    groupsWithDupes++;
    const [tenant] = key.split("::");
    const canonical = pickCanonical(group);
    const dups = group.filter((r) => r.id !== canonical.id);

    const canonLabel = `${canonical.namn}${canonical.beteckning ? ` · ${canonical.beteckning}` : ""} [${canonical.kategori ?? "-"}${canonical.is_system ? ", system" : ""}]`;
    console.log(`\n[${tenant}] "${canonical.namn}" — ${group.length} rader, behåller: ${canonLabel}`);

    for (const dup of dups) {
      const dupLabel = `${dup.namn}${dup.beteckning ? ` · ${dup.beteckning}` : ""} [${dup.kategori ?? "-"}]`;
      if (DRY_RUN) {
        const cnt = rowsOf(
          await db.execute(sql`SELECT count(*)::int AS n FROM metadata_varden WHERE tenant_id = ${tenant} AND metadata_katalog_id = ${dup.id}`),
        )[0]?.n ?? 0;
        console.log(`  · skulle slå ihop ${dupLabel} (${cnt} värden pekas om) → ${canonical.id}`);
      } else {
        await repoint(tenant, dup.id, canonical.id);
        await db.execute(sql`DELETE FROM metadata_katalog WHERE tenant_id = ${tenant} AND id = ${dup.id}`);
        console.log(`  ✓ sammanslagen ${dupLabel} → ${canonical.id}`);
        removed++;
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  if (groupsWithDupes === 0) {
    console.log("Inga dubbletter hittades.");
  } else if (DRY_RUN) {
    console.log(`${groupsWithDupes} namn-grupp(er) med dubbletter. Kör med --confirm för att slå ihop.`);
  } else {
    console.log(`KLART. ${removed} dubblett-rad(er) borttagna i ${groupsWithDupes} grupp(er).`);
  }
  console.log("=".repeat(60));
  process.exit(0);
}

main().catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
