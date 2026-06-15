/**
 * scripts/kinab-reset-operational-data.ts
 *
 * Rensar operativt kunddata för tenant 'kinab' inför pilotstart.
 * Kör mot DEV-databasen (DATABASE_URL via server/db).
 * För PROD: använd scripts/kinab-reset-prod-operational-data.ts.
 *
 * Raderingsscopet (faser A–H) definieras i scripts/kinab-reset-phases.ts och
 * delas med prod-skriptet — ändra scopet där, aldrig här.
 *
 * BEHÅLLER (config/master):
 *   - tenants, users, user_tenant_roles
 *   - resources, branding_templates, tenant_branding
 *   - articles, article_components, metadata_katalog
 *   - fortnox_mappings, tenant-features/moduler
 *   - audit_logs (historikbevarande)
 *
 * RADERAR (operativt):
 *   - work_orders + alla barnrader
 *   - objects + alla barnrader
 *   - customers + alla barnrader (utom audit_logs)
 *   - import_batches, fortnox_invoice_exports, notifications, ai-tips
 *
 * Användning:
 *   npx tsx scripts/kinab-reset-operational-data.ts                # dry-run
 *   npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { buildResetPhases, DEMO_RESOURCE_IDS } from "./kinab-reset-phases";

const TENANT = "kinab";
const args = process.argv.slice(2);
const confirmIdx = args.indexOf("--confirm");
const confirmToken = confirmIdx >= 0 ? args[confirmIdx + 1] : null;
const DRY_RUN = confirmToken !== "RENSA-KINAB";

const PHASES = buildResetPhases(TENANT);
const demoIdList = DEMO_RESOURCE_IDS.map((id) => `'${id}'`).join(",");

async function tableExists(name: string): Promise<boolean> {
  const r: any = await db.execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${name} LIMIT 1`
  );
  return (r.rows ?? r).length > 0;
}

async function count(table: string, where: string): Promise<number> {
  try {
    const r: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`));
    const rows = r.rows ?? r;
    return Number(rows[0]?.n ?? 0);
  } catch (e: any) {
    console.warn(`  ! kunde inte räkna ${table}: ${e.message}`);
    return -1;
  }
}

async function del(table: string, where: string): Promise<number> {
  const r: any = await db.execute(sql.raw(`DELETE FROM "${table}" WHERE ${where}`));
  return r.rowCount ?? 0;
}

async function snapshot(label: string) {
  console.log(`\n=== ${label} ===`);
  const stats = await db.execute(sql.raw(`
    SELECT
      (SELECT COUNT(*) FROM customers WHERE tenant_id='${TENANT}') AS customers,
      (SELECT COUNT(*) FROM objects WHERE tenant_id='${TENANT}') AS objects,
      (SELECT COUNT(*) FROM work_orders WHERE tenant_id='${TENANT}') AS work_orders,
      (SELECT COUNT(*) FROM import_batches WHERE tenant_id='${TENANT}') AS import_batches
  `));
  console.log((stats as any).rows ?? stats);
}

async function main() {
  console.log("=".repeat(60));
  console.log(`KINAB OPERATIONAL DATA RESET — tenant='${TENANT}'`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (ingen radering körs)" : "SKARP RADERING"}`);
  console.log("=".repeat(60));

  await snapshot("Före (nuläge)");

  let totalRows = 0;

  for (const phase of PHASES) {
    console.log(`\n--- ${phase.name} ---`);
    for (const [table, where] of phase.tables) {
      if (!(await tableExists(table))) {
        console.log(`  · ${table.padEnd(40)} (saknas — hoppar över)`);
        continue;
      }
      const n = await count(table, where);
      if (n < 0) continue;
      if (n === 0) {
        console.log(`  · ${table.padEnd(40)} 0`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  · ${table.padEnd(40)} ${n.toString().padStart(7)} (skulle raderas)`);
      } else {
        const deleted = await del(table, where);
        console.log(`  ✓ ${table.padEnd(40)} ${deleted.toString().padStart(7)} raderade`);
        totalRows += deleted;
      }
    }
  }

  // Nolla dingande users.resource_id-pekare till demo-resurserna (UPDATE, inte DELETE).
  console.log(`\n--- Extra: nolla users.resource_id för demo-resurser ---`);
  const userMatch: any = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS n FROM "users" WHERE resource_id IN (${demoIdList})`),
  );
  const userN = Number((userMatch.rows ?? userMatch)[0]?.n ?? 0);
  if (userN === 0) {
    console.log(`  · users.resource_id                       0`);
  } else if (DRY_RUN) {
    console.log(`  · users.resource_id                       ${userN} (skulle nollställas)`);
  } else {
    const r: any = await db.execute(
      sql.raw(`UPDATE "users" SET resource_id = NULL WHERE resource_id IN (${demoIdList})`),
    );
    console.log(`  ✓ users.resource_id                       ${r.rowCount ?? 0} nollställda`);
  }

  if (DRY_RUN) {
    console.log("\n" + "=".repeat(60));
    console.log("DRY-RUN klar. Inget raderades.");
    console.log("För att köra skarpt:");
    console.log("  npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB");
    console.log("=".repeat(60));
  } else {
    await snapshot("Efter (resultat)");
    console.log("\n" + "=".repeat(60));
    console.log(`KLART. Totalt ${totalRows} rader raderade för tenant '${TENANT}'.`);
    console.log("=".repeat(60));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
