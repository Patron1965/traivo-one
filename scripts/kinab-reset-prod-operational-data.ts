#!/usr/bin/env tsx
/**
 * scripts/kinab-reset-prod-operational-data.ts
 *
 * PROD-variant av kinab-reset-operational-data.ts. Rensar ALLT operativt
 * kunddata (kunder, objekt, arbetsordrar + barn) för tenant 'kinab' i
 * PRODUKTIONSDATABASEN inför skarp drift. Behåller config/master.
 *
 * Raderingsscopet (faser A–H) delas med dev-skriptet via
 * scripts/kinab-reset-phases.ts — ändra scopet där, aldrig här.
 *
 * SÄKERHET
 *   - PROD_DATABASE_URL måste sättas via Secrets. DATABASE_URL = dev.
 *   - Vägrar köra om DATABASE_URL === PROD_DATABASE_URL (dev/prod-spärr).
 *   - Allt körs i EN transaktion mot prod. Vid minsta fel → ROLLBACK.
 *   - Efter raderingen (innan COMMIT) verifieras att kinab customers/objects/
 *     work_orders är 0. Annars tvångs-rollback.
 *   - DUBBEL bekräftelse krävs för skarp körning, annars dry-run (ROLLBACK):
 *       env  CONFIRM=YES_RESET_PROD
 *       flag --confirm RENSA-KINAB-PROD
 *
 * ANVÄNDNING
 *   # Dry-run (räknar vad som SKULLE raderas, rullar tillbaka):
 *   PROD_DATABASE_URL=postgres://... npx tsx scripts/kinab-reset-prod-operational-data.ts
 *
 *   # Skarp körning:
 *   PROD_DATABASE_URL=postgres://... CONFIRM=YES_RESET_PROD \
 *     npx tsx scripts/kinab-reset-prod-operational-data.ts --confirm RENSA-KINAB-PROD
 */

import pg from "pg";
import { buildResetPhases, DEMO_RESOURCE_IDS } from "./kinab-reset-phases";

const { Pool } = pg;

const TENANT = "kinab";
const args = process.argv.slice(2);
const confirmIdx = args.indexOf("--confirm");
const confirmToken = confirmIdx >= 0 ? args[confirmIdx + 1] : null;
const CONFIRM_ENV = process.env.CONFIRM === "YES_RESET_PROD";
const CONFIRM_FLAG = confirmToken === "RENSA-KINAB-PROD";
const DRY_RUN = !(CONFIRM_ENV && CONFIRM_FLAG);

// ----------------------------- env / spärrar ------------------------------

if (!process.env.PROD_DATABASE_URL) {
  console.error("FEL: PROD_DATABASE_URL saknas. Lägg in den som Secret innan körning.");
  process.exit(1);
}
if (
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL === process.env.PROD_DATABASE_URL
) {
  console.error("FEL: DATABASE_URL och PROD_DATABASE_URL pekar på samma DB. Avbryter.");
  process.exit(1);
}

function maskHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "<okänd host>";
  }
}

const prodPool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });

const PHASES = buildResetPhases(TENANT);
const demoIdList = DEMO_RESOURCE_IDS.map((id) => `'${id}'`).join(",");

// ----------------------------- helpers ------------------------------

async function tableExists(client: pg.PoolClient, name: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name],
  );
  return (r.rowCount ?? 0) > 0;
}

async function count(client: pg.PoolClient, table: string, where: string): Promise<number> {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`);
  return Number(r.rows[0]?.n ?? 0);
}

async function del(client: pg.PoolClient, table: string, where: string): Promise<number> {
  const r = await client.query(`DELETE FROM "${table}" WHERE ${where}`);
  return r.rowCount ?? 0;
}

async function snapshot(client: pg.PoolClient, label: string) {
  console.log(`\n=== ${label} ===`);
  const r = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM customers      WHERE tenant_id=$1) AS customers,
      (SELECT COUNT(*)::int FROM objects        WHERE tenant_id=$1) AS objects,
      (SELECT COUNT(*)::int FROM work_orders    WHERE tenant_id=$1) AS work_orders,
      (SELECT COUNT(*)::int FROM import_batches WHERE tenant_id=$1) AS import_batches
  `, [TENANT]);
  console.log(r.rows[0]);
}

// ----------------------------- main ------------------------------

async function main() {
  console.log("=".repeat(64));
  console.log(`KINAB PROD OPERATIONAL DATA RESET — tenant='${TENANT}'`);
  console.log(`Mål-DB (prod): ${maskHost(process.env.PROD_DATABASE_URL!)}`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (ROLLBACK, ingen radering persisteras)" : "SKARP RADERING (COMMIT)"}`);
  console.log("=".repeat(64));

  const client = await prodPool.connect();
  let committed = false;
  let totalRows = 0;

  try {
    await client.query("BEGIN");

    await snapshot(client, "Före (nuläge i prod)");

    for (const phase of PHASES) {
      console.log(`\n--- ${phase.name} ---`);
      for (const [table, where] of phase.tables) {
        if (!(await tableExists(client, table))) {
          console.log(`  · ${table.padEnd(40)} (saknas — hoppar över)`);
          continue;
        }
        if (DRY_RUN) {
          const n = await count(client, table, where);
          if (n === 0) {
            console.log(`  · ${table.padEnd(40)} 0`);
          } else {
            console.log(`  · ${table.padEnd(40)} ${n.toString().padStart(7)} (skulle raderas)`);
            totalRows += n;
          }
        } else {
          const deleted = await del(client, table, where);
          if (deleted === 0) {
            console.log(`  · ${table.padEnd(40)} 0`);
          } else {
            console.log(`  ✓ ${table.padEnd(40)} ${deleted.toString().padStart(7)} raderade`);
            totalRows += deleted;
          }
        }
      }
    }

    // Nolla dingande users.resource_id-pekare till demo-resurser (UPDATE).
    console.log(`\n--- Extra: nolla users.resource_id för demo-resurser ---`);
    const userMatch = await client.query(
      `SELECT COUNT(*)::int AS n FROM "users" WHERE resource_id IN (${demoIdList})`,
    );
    const userN = Number(userMatch.rows[0]?.n ?? 0);
    if (userN === 0) {
      console.log(`  · users.resource_id                       0`);
    } else if (DRY_RUN) {
      console.log(`  · users.resource_id                       ${userN} (skulle nollställas)`);
    } else {
      const r = await client.query(
        `UPDATE "users" SET resource_id = NULL WHERE resource_id IN (${demoIdList})`,
      );
      console.log(`  ✓ users.resource_id                       ${r.rowCount ?? 0} nollställda`);
    }

    // Post-radering-verifiering (inom transaktionen): allt operativt kinab-data
    // måste vara borta. Annars tvångs-rollback.
    console.log(`\n--- Verifiering (inom transaktion) ---`);
    const leftover = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM customers   WHERE tenant_id=$1) AS customers,
        (SELECT COUNT(*)::int FROM objects     WHERE tenant_id=$1) AS objects,
        (SELECT COUNT(*)::int FROM work_orders WHERE tenant_id=$1) AS work_orders
    `, [TENANT]);
    const lo = leftover.rows[0];
    console.log(`  Kvar efter radering: customers=${lo.customers}, objects=${lo.objects}, work_orders=${lo.work_orders}`);
    if (!DRY_RUN && (lo.customers > 0 || lo.objects > 0 || lo.work_orders > 0)) {
      throw new Error(
        `Post-radering-verifiering MISSLYCKADES: kinab-data kvar ` +
          `(customers=${lo.customers}, objects=${lo.objects}, work_orders=${lo.work_orders}). Tvångs-rollback.`,
      );
    }

    await snapshot(client, DRY_RUN ? "Skulle bli (simulerat)" : "Efter (resultat i prod)");

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\n" + "=".repeat(64));
      console.log(`DRY-RUN klar (ROLLBACK). Skulle ha raderat ~${totalRows} rader för tenant '${TENANT}'.`);
      console.log("För skarp körning:");
      console.log("  PROD_DATABASE_URL=... CONFIRM=YES_RESET_PROD \\");
      console.log("    npx tsx scripts/kinab-reset-prod-operational-data.ts --confirm RENSA-KINAB-PROD");
      console.log("=".repeat(64));
    } else {
      await client.query("COMMIT");
      committed = true;
      console.log("\n" + "=".repeat(64));
      console.log(`[COMMIT] KLART. Totalt ${totalRows} rader raderade i PROD för tenant '${TENANT}'.`);
      console.log("=".repeat(64));
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nFEL — transaktionen rullades tillbaka, inget persisterades:", err);
    throw err;
  } finally {
    client.release();
    await prodPool.end().catch(() => {});
  }

  process.exit(committed || DRY_RUN ? 0 : 1);
}

main().catch(() => {
  process.exit(1);
});
