/**
 * scripts/merge-kategori-into-omrade.ts
 *
 * Task #674 — Slå ihop Kategori → Område i det svenska metadata-systemet
 * (`metadata_katalog`). Område (`area`) blir det enda grupperingsfältet; de gamla
 * kategori-värdena migreras in i området för de fält som saknar område.
 *
 * Skriptet fyller `area` från `kategori` för rader där `area` är NULL eller tom
 * (`area = COALESCE(NULLIF(area, ''), kategori)`). `kategori`-kolumnen behålls
 * (expand-contract, bakåtkompatibilitet) men slutar användas för gruppering.
 *
 * Idempotent: en andra körning är en no-op eftersom alla rader då redan har
 * `area` satt. Systemmetadata migreras direkt i DB (förbi API-skyddet, som
 * blockerar ändring av grupperingsfältet på systemfält via API).
 *
 * Alla UPDATE har `tenant_id` i WHERE (defense-in-depth, multi-tenant).
 *
 * Användning:
 *   npx tsx scripts/merge-kategori-into-omrade.ts                 # dry-run (alla tenants)
 *   npx tsx scripts/merge-kategori-into-omrade.ts --confirm       # skarp körning
 *   npx tsx scripts/merge-kategori-into-omrade.ts --tenant kinab  # begränsa tenant
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--confirm");
const tenantIdx = args.indexOf("--tenant");
const ONLY_TENANT = tenantIdx >= 0 ? args[tenantIdx + 1] : null;

function rowsOf(r: any): any[] {
  return r.rows ?? r;
}

async function main() {
  console.log("=".repeat(60));
  console.log("MERGE kategori → område (metadata_katalog, per tenant)");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (ingen ändring körs)" : "SKARP KÖRNING"}`);
  if (ONLY_TENANT) console.log(`Tenant-filter: ${ONLY_TENANT}`);
  console.log("=".repeat(60));

  // Rader som saknar område men har en kategori att migrera in.
  const tenantFilter = ONLY_TENANT ? sql`AND tenant_id = ${ONLY_TENANT}` : sql``;
  const candidates = rowsOf(
    await db.execute(sql`
      SELECT tenant_id, kategori, count(*)::int AS n
      FROM metadata_katalog
      WHERE (area IS NULL OR area = '')
        AND kategori IS NOT NULL AND kategori <> ''
        ${tenantFilter}
      GROUP BY tenant_id, kategori
      ORDER BY tenant_id, kategori
    `),
  ) as Array<{ tenant_id: string; kategori: string; n: number }>;

  if (candidates.length === 0) {
    console.log("\nInga fält utan område hittades — allt är redan migrerat.");
    console.log("=".repeat(60));
    process.exit(0);
  }

  let total = 0;
  for (const c of candidates) {
    total += c.n;
    if (DRY_RUN) {
      console.log(`  · [${c.tenant_id}] "${c.kategori}" → område="${c.kategori}" (${c.n} fält)`);
    }
  }

  if (DRY_RUN) {
    console.log("\n" + "=".repeat(60));
    console.log(`${total} fält skulle få område satt. Kör med --confirm för att migrera.`);
    console.log("=".repeat(60));
    process.exit(0);
  }

  // Kör en UPDATE per tenant — varje sats har då alltid tenant_id i WHERE
  // (defense-in-depth, multi-tenant), aldrig en tenant-bred skrivning.
  const tenantIds = Array.from(new Set(candidates.map((c) => c.tenant_id)));
  let affected = 0;
  for (const tid of tenantIds) {
    const res = await db.execute(sql`
      UPDATE metadata_katalog
      SET area = kategori
      WHERE (area IS NULL OR area = '')
        AND kategori IS NOT NULL AND kategori <> ''
        AND tenant_id = ${tid}
    `);
    affected += (res as any).rowCount ?? 0;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`KLART. ${affected} fält fick område satt från kategori (${tenantIds.length} tenant(s)).`);
  console.log("=".repeat(60));
  process.exit(0);
}

main().catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
