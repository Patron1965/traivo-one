#!/usr/bin/env tsx
/**
 * Task #1164 — Bekräfta att en ren objektmall-import (v2) fungerar mot det
 * rensade produktionssystemet.
 *
 * READ-ONLY efterkontroll som körs EFTER att operatören kört den första skarpa
 * objektmall-importen via wizarden i den publicerade appen. Skriptet svarar på
 * "Done looks like" i tasken:
 *
 *   1. Objekt skapade   — objects (aktiva) > 0 för tenant.
 *   2. Metadata satt/ärvd — metadata_varden kopplade till de nya objekten > 0,
 *      och andelen objekt utan något metadatavärde rapporteras (arv från
 *      metadata_katalog).
 *   3. Orderkoncept re-pekade — order_concept_objects återskapade (> 0) och
 *      pekar på de nyimporterade objekten.
 *   4. Ingen kvarvarande drift-/FK-orphan efter importen:
 *        - objects.parent_id → objects
 *        - order_concept_objects.object_id → objects
 *        - order_concept_objects.order_concept_id → order_concepts
 *        - metadata_varden.objekt_id → objects
 *        - inga work_orders/assignments (driftdata ska fortsatt vara 0).
 *
 * Säkerhet
 *   - Endast SELECT. Ingen BEGIN/COMMIT/skrivning.
 *   - Kräver PROD_DATABASE_URL (Secret). Vägrar köra om den är samma som
 *     DATABASE_URL (dev) om inte --allow-same anges.
 *
 * Användning
 *   PROD_DATABASE_URL=postgres://... npx tsx scripts/verify-object-import-prod.ts
 *
 * Flaggor
 *   --tenant=kinab          (default)
 *   --min-objects=1         minsta antal aktiva objekt för PASS (default 1)
 *   --allow-same            tillåt PROD_DATABASE_URL === DATABASE_URL
 *   --database-url=...      överstyr vilken URL som används (annars
 *                           PROD_DATABASE_URL)
 *
 * Sista raden = "VERIFIKATION: PASS|WARN|FAIL".
 */

import pg from "pg";

const { Pool } = pg;

// ----------------------------- args ------------------------------

const args = process.argv.slice(2);
function arg(name: string, def?: string): string | undefined {
  const m = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!m) return def;
  if (m === `--${name}`) return "true";
  return m.split("=").slice(1).join("=");
}

const TENANT = arg("tenant", "kinab")!;
const MIN_OBJECTS = parseInt(arg("min-objects", "1")!, 10);
const ALLOW_SAME = arg("allow-same") === "true";
const OVERRIDE_URL = arg("database-url");

const connectionString =
  OVERRIDE_URL || process.env.PROD_DATABASE_URL;

if (!connectionString) {
  console.error(
    "FEL: PROD_DATABASE_URL saknas. Lägg in den som Secret (eller använd --database-url=).",
  );
  process.exit(1);
}

if (
  !ALLOW_SAME &&
  !OVERRIDE_URL &&
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL === process.env.PROD_DATABASE_URL
) {
  console.error(
    "FEL: DATABASE_URL och PROD_DATABASE_URL pekar på samma DB. Använd --allow-same om detta är avsiktligt.",
  );
  process.exit(1);
}

const db = new Pool({ connectionString });

// ----------------------------- helpers --------------------------

const log = (...a: unknown[]) => console.log(...a);

type CheckStatus = "PASS" | "FAIL" | "WARN" | "INFO";
interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}
const checks: Check[] = [];
function record(name: string, status: CheckStatus, detail: string) {
  checks.push({ name, status, detail });
  const sym =
    status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "·";
  log(`  [${sym}] ${name.padEnd(46)} ${detail}`);
}

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ c: number }>(sql, params);
  return r.rows[0].c;
}

async function tableExists(table: string): Promise<boolean> {
  return (
    (await scalar(
      `SELECT count(*)::int AS c FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1`,
      [table],
    )) > 0
  );
}

// ----------------------------- main --------------------------

async function main() {
  log(`Verifierar objektmall-import mot prod (tenant=${TENANT})`);
  log(`DB: <maskerad>`);
  log(`Minsta antal aktiva objekt för PASS: ${MIN_OBJECTS}`);

  // ---- 1. Objekt skapade -------------------------------------------------
  log("\n=== 1. Objekt skapade ===");
  const objActive = await scalar(
    `SELECT count(*)::int AS c FROM objects WHERE tenant_id=$1 AND deleted_at IS NULL`,
    [TENANT],
  );
  const objTotal = await scalar(
    `SELECT count(*)::int AS c FROM objects WHERE tenant_id=$1`,
    [TENANT],
  );
  if (objActive >= MIN_OBJECTS) {
    record("objects (aktiva)", "PASS", `${objActive} (totalt ${objTotal})`);
  } else {
    record(
      "objects (aktiva)",
      "FAIL",
      `${objActive} aktiva — importen verkar inte ha körts (kör importen via wizarden först)`,
    );
  }

  // Hierarki-integritet: primär förälder speglad, inga föräldralösa barn
  const rootObjects = await scalar(
    `SELECT count(*)::int AS c FROM objects WHERE tenant_id=$1 AND deleted_at IS NULL AND parent_id IS NULL`,
    [TENANT],
  );
  const childObjects = await scalar(
    `SELECT count(*)::int AS c FROM objects WHERE tenant_id=$1 AND deleted_at IS NULL AND parent_id IS NOT NULL`,
    [TENANT],
  );
  record(
    "hierarki: rot- vs barn-objekt",
    "INFO",
    `${rootObjects} rot, ${childObjects} barn`,
  );

  // ---- 2. Metadata satt / ärvd ------------------------------------------
  log("\n=== 2. Metadata (satt/ärvd från katalog) ===");
  const katalog = await scalar(
    `SELECT count(*)::int AS c FROM metadata_katalog WHERE tenant_id=$1`,
    [TENANT],
  );
  record("metadata_katalog (tenant)", katalog > 0 ? "PASS" : "FAIL", `${katalog} katalog-poster`);

  const varden = await scalar(
    `SELECT count(*)::int AS c FROM metadata_varden mv
     WHERE mv.objekt_id IN (SELECT id FROM objects WHERE tenant_id=$1 AND deleted_at IS NULL)`,
    [TENANT],
  );
  if (objActive === 0) {
    record("metadata_varden (på nya objekt)", "INFO", "0 (inga objekt ännu)");
  } else if (varden > 0) {
    record("metadata_varden (på nya objekt)", "PASS", `${varden} värden`);
  } else {
    record(
      "metadata_varden (på nya objekt)",
      "WARN",
      `0 värden — objekt skapades men fick inga metadatavärden (kontrollera mall-kolumner mot katalogen)`,
    );
  }

  // Andel objekt med minst ett metadatavärde
  if (objActive > 0) {
    const objWithMeta = await scalar(
      `SELECT count(*)::int AS c FROM objects o
       WHERE o.tenant_id=$1 AND o.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM metadata_varden mv WHERE mv.objekt_id = o.id)`,
      [TENANT],
    );
    const pct = objActive > 0 ? Math.round((objWithMeta / objActive) * 100) : 0;
    record(
      "objekt med ≥1 metadatavärde",
      objWithMeta > 0 ? "INFO" : "WARN",
      `${objWithMeta}/${objActive} (${pct}%)`,
    );
  }

  // ---- 3. Orderkoncept re-pekade ----------------------------------------
  log("\n=== 3. Orderkoncept re-pekade mot nya objekt ===");
  const concepts = await scalar(
    `SELECT count(*)::int AS c FROM order_concepts WHERE tenant_id=$1`,
    [TENANT],
  );
  record("order_concepts (bevarade)", concepts > 0 ? "PASS" : "WARN", `${concepts} koncept`);

  const oco = await scalar(
    `SELECT count(*)::int AS c FROM order_concept_objects oco
     WHERE oco.order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id=$1)`,
    [TENANT],
  );
  if (oco > 0) {
    // Hur många pekar på faktiskt existerande, aktiva, tenant-egna objekt?
    const ocoValid = await scalar(
      `SELECT count(*)::int AS c FROM order_concept_objects oco
       WHERE oco.order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id=$1)
         AND oco.object_id IN (SELECT id FROM objects WHERE tenant_id=$1 AND deleted_at IS NULL)`,
      [TENANT],
    );
    record(
      "order_concept_objects (återskapade)",
      ocoValid === oco ? "PASS" : "WARN",
      `${oco} länkar, varav ${ocoValid} mot aktiva tenant-objekt`,
    );
  } else {
    record(
      "order_concept_objects (återskapade)",
      "INFO",
      `0 — kör om-inpekningen i wizarden efter objektimporten (task steg 2)`,
    );
  }

  // ---- 4. FK-orphans & drift-rester -------------------------------------
  log("\n=== 4. FK-orphans & drift-rester ===");

  const parentOrphans = await scalar(
    `SELECT count(*)::int AS c FROM objects o
     WHERE o.tenant_id=$1 AND o.parent_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM objects p WHERE p.id = o.parent_id)`,
    [TENANT],
  );
  record("orphans: objects.parent_id", parentOrphans === 0 ? "PASS" : "FAIL", `${parentOrphans}`);

  const ocoObjOrphans = await scalar(
    `SELECT count(*)::int AS c FROM order_concept_objects oco
     WHERE oco.order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id=$1)
       AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.id = oco.object_id)`,
    [TENANT],
  );
  record("orphans: order_concept_objects.object_id", ocoObjOrphans === 0 ? "PASS" : "FAIL", `${ocoObjOrphans}`);

  const ocoConceptOrphans = await scalar(
    `SELECT count(*)::int AS c FROM order_concept_objects oco
     WHERE NOT EXISTS (SELECT 1 FROM order_concepts oc WHERE oc.id = oco.order_concept_id)
       AND oco.object_id IN (SELECT id FROM objects WHERE tenant_id=$1)`,
    [TENANT],
  );
  record("orphans: order_concept_objects.order_concept_id", ocoConceptOrphans === 0 ? "PASS" : "FAIL", `${ocoConceptOrphans}`);

  const vardenOrphans = await scalar(
    `SELECT count(*)::int AS c FROM metadata_varden mv
     WHERE mv.tenant_id=$1 AND mv.objekt_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.id = mv.objekt_id)`,
    [TENANT],
  );
  record("orphans: metadata_varden.objekt_id", vardenOrphans === 0 ? "PASS" : "FAIL", `${vardenOrphans}`);

  // Driftdata ska fortsatt vara 0 (importen skapar bara objekt/metadata)
  const workOrders = await scalar(
    `SELECT count(*)::int AS c FROM work_orders WHERE tenant_id=$1`,
    [TENANT],
  );
  record("drift: work_orders (förväntat 0)", workOrders === 0 ? "PASS" : "WARN", `${workOrders}`);

  if (await tableExists("assignments")) {
    const hasTenant =
      (await scalar(
        `SELECT count(*)::int AS c FROM information_schema.columns
         WHERE table_schema='public' AND table_name='assignments' AND column_name='tenant_id'`,
      )) > 0;
    if (hasTenant) {
      const assignments = await scalar(
        `SELECT count(*)::int AS c FROM assignments WHERE tenant_id=$1`,
        [TENANT],
      );
      record("drift: assignments (förväntat 0)", assignments === 0 ? "PASS" : "WARN", `${assignments}`);
    }
  }

  // ============ Sammanfattning ============
  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const pass = checks.filter((c) => c.status === "PASS").length;
  const overall: CheckStatus = fail > 0 ? "FAIL" : warn > 0 ? "WARN" : "PASS";

  log("\n========================================");
  log(`Sammanfattning: PASS=${pass}, WARN=${warn}, FAIL=${fail}`);
  log(`VERIFIKATION: ${overall}`);

  await db.end();
  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Oväntat fel:", e);
  try {
    await db.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
