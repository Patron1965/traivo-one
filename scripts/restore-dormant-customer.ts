#!/usr/bin/env tsx
/**
 * Restore individual dormant customer(s) from DEV → PROD (Task #427).
 *
 * Slim-migreringen (Task #423) lämnade ~1809 vilande kunder utanför prod
 * (kunder utan work_order >= ACTIVE_SINCE). Det här skriptet är en tunn
 * operatör-wrapper runt `scripts/migrate-kinab-dev-to-prod.ts` som låter
 * platform-owner ta in EN eller NÅGRA enstaka av dessa vilande kunder
 * tillbaka till prod utan att röra resten.
 *
 * All tung logik (transaktion, FK-checkar, tenant-leak-check, idempotent
 * upsert, post-run validering) återanvänds från migrate-skriptet — den här
 * filen lägger bara till:
 *   1. Sökning efter kunder i dev (--search)
 *   2. Verifikation att kunderna verkligen är "vilande" (skydd mot
 *      missbruk: använd inte detta för aktiva kunder).
 *   3. Audit-rad i prod (audit_logs) med vem/när/vilka kund-IDn.
 *      OBS: audit-raden skrivs EFTER att migrate-skriptet committat sin egen
 *      transaktion — alltså inte i samma transaktion som dataimporten.
 *      Lyckas migrate men misslyckas audit-skrivningen så är datan
 *      återställd ändå; manuell audit kan då skrivas i efterhand.
 *
 * ANVÄNDNING
 *   # Sök fram kandidater (read-only mot dev):
 *   PROD_DATABASE_URL=postgres://... \
 *     npx tsx scripts/restore-dormant-customer.ts \
 *       --search="brf solgården"
 *
 *   # Dry-run (transaktion + ROLLBACK i prod, ingen audit-rad skrivs):
 *   PROD_DATABASE_URL=postgres://... \
 *     npx tsx scripts/restore-dormant-customer.ts \
 *       --customer-id=cust_abc,cust_def \
 *       --actor=mats@traivo.se \
 *       --dry-run
 *
 *   # Skarp körning (committar + skriver audit-rad):
 *   PROD_DATABASE_URL=postgres://... CONFIRM=YES_MIGRATE_PROD \
 *     npx tsx scripts/restore-dormant-customer.ts \
 *       --customer-id=cust_abc,cust_def \
 *       --actor=mats@traivo.se
 *
 * FLAGGOR
 *   --search=<text>        Lista matchande kunder i dev (id/namn/kundnr/orgnr).
 *                          Read-only. PROD_DATABASE_URL behöver inte sättas.
 *   --customer-id=id,...   ID-lista att importera. Krävs vid återställning.
 *   --actor=<email|namn>   Vem som beställer återställningen. Skrivs i audit.
 *                          Krävs vid återställning.
 *   --tenant=<id>          Default: kinab.
 *   --active-since=<YYYY-MM-DD>  Default: 2024-01-01 (samma tröskel som migrate).
 *   --allow-active         Tillåt återställning av kunder som INTE är vilande.
 *                          Default: hård-fail om någon ID:n redan har work_order
 *                          >= ACTIVE_SINCE i dev.
 *   --dry-run              Tvinga rollback även med CONFIRM. Skriver INTE audit.
 *
 * ENV
 *   DATABASE_URL                källa (dev). Krävs.
 *   PROD_DATABASE_URL           mål (prod). Krävs vid restore (ej --search).
 *   CONFIRM=YES_MIGRATE_PROD    krävs för faktisk commit. Annars dry-run.
 */

import pg from "pg";
import { spawn } from "node:child_process";
import * as path from "node:path";

const { Pool } = pg;

// ----------------------------- args ------------------------------

const args = process.argv.slice(2);
function arg(name: string, def?: string): string | undefined {
  const m = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!m) return def;
  if (m === `--${name}`) return "true";
  return m.split("=").slice(1).join("=");
}

const SEARCH = arg("search");
const CUSTOMER_ID_ARG = arg("customer-id");
const ACTOR = arg("actor");
const TENANT = arg("tenant", "kinab")!;
const ACTIVE_SINCE = arg("active-since", "2024-01-01")!;
const ALLOW_ACTIVE = arg("allow-active") === "true";
const DRY_RUN_FLAG = arg("dry-run") === "true";
const CONFIRM = process.env.CONFIRM === "YES_MIGRATE_PROD";
const DRY_RUN = DRY_RUN_FLAG || !CONFIRM;

// ----------------------------- env ------------------------------

if (!process.env.DATABASE_URL) {
  console.error("FEL: DATABASE_URL (dev) saknas.");
  process.exit(1);
}

const dev = new Pool({ connectionString: process.env.DATABASE_URL });

// ----------------------------- helpers --------------------------

function fail(msg: string): never {
  console.error(`FEL: ${msg}`);
  process.exit(1);
}

async function searchCustomers(query: string): Promise<void> {
  const like = `%${query.toLowerCase()}%`;
  const r = await dev.query<{
    id: string;
    name: string;
    customer_number: string | null;
    org_number: string | null;
    object_count: number;
    last_wo_date: string | null;
    is_active: boolean;
  }>(
    `SELECT c.id,
            c.name,
            c.customer_number,
            c.org_number,
            (SELECT count(*)::int FROM objects o
              WHERE o.customer_id = c.id AND o.tenant_id = $1) AS object_count,
            (SELECT max(scheduled_date)::text FROM work_orders w
              WHERE w.customer_id = c.id AND w.tenant_id = $1) AS last_wo_date,
            EXISTS(
              SELECT 1 FROM work_orders w
               WHERE w.customer_id = c.id
                 AND w.tenant_id = $1
                 AND w.scheduled_date >= $2
            ) AS is_active
     FROM customers c
     WHERE c.tenant_id = $1
       AND c.deleted_at IS NULL
       AND (LOWER(c.id) LIKE $3
            OR LOWER(c.name) LIKE $3
            OR LOWER(COALESCE(c.customer_number,'')) LIKE $3
            OR LOWER(COALESCE(c.org_number,'')) LIKE $3)
     ORDER BY is_active DESC, c.name
     LIMIT 50`,
    [TENANT, ACTIVE_SINCE, like],
  );
  if (r.rowCount === 0) {
    console.log(`Inga matchningar för "${query}" under tenant=${TENANT}.`);
    return;
  }
  console.log(`Hittade ${r.rowCount} kund(er) i dev för "${query}":\n`);
  console.log(
    "STATUS  ID                                   KUNDNR     ORGNR        OBJ  SENASTE WO   NAMN",
  );
  for (const row of r.rows) {
    const status = row.is_active ? "AKTIV " : "VILAND";
    const id = row.id.padEnd(36);
    const kn = (row.customer_number || "—").padEnd(10);
    const on = (row.org_number || "—").padEnd(12);
    const oc = String(row.object_count).padStart(4);
    const wo = (row.last_wo_date || "—").padEnd(12);
    console.log(`${status}  ${id} ${kn} ${on} ${oc}  ${wo} ${row.name}`);
  }
  console.log(
    "\nTips: kopiera ID:n och kör med " +
      `--customer-id=<id1,id2,...> --actor=<din epost>${DRY_RUN ? " --dry-run" : ""}`,
  );
}

interface PreflightRow {
  id: string;
  name: string;
  is_active: boolean;
  object_count: number;
}

async function preflightDormancy(ids: string[]): Promise<PreflightRow[]> {
  const r = await dev.query<PreflightRow>(
    `SELECT c.id,
            c.name,
            EXISTS(
              SELECT 1 FROM work_orders w
               WHERE w.customer_id = c.id
                 AND w.tenant_id = $1
                 AND w.scheduled_date >= $2
            ) AS is_active,
            (SELECT count(*)::int FROM objects o
              WHERE o.customer_id = c.id AND o.tenant_id = $1) AS object_count
     FROM customers c
     WHERE c.tenant_id = $1
       AND c.id = ANY($3::text[])`,
    [TENANT, ACTIVE_SINCE, ids],
  );
  const found = new Set(r.rows.map((x) => x.id));
  for (const id of ids) {
    if (!found.has(id)) {
      fail(
        `kund-id "${id}" saknas i dev under tenant=${TENANT}. ` +
          `Använd --search för att hitta rätt id.`,
      );
    }
  }
  return r.rows;
}

function runMigrate(customerIds: string[]): Promise<number> {
  const scriptPath = path.join(
    process.cwd(),
    "scripts",
    "migrate-kinab-dev-to-prod.ts",
  );
  const cmdArgs = [
    "tsx",
    scriptPath,
    "--phase=customers",
    `--tenant=${TENANT}`,
    `--active-since=${ACTIVE_SINCE}`,
    `--customer-id=${customerIds.join(",")}`,
  ];
  if (DRY_RUN_FLAG) cmdArgs.push("--dry-run");

  // Vi proxar CONFIRM oförändrat. Migrate-skriptet hanterar dry-run-logiken
  // (DRY_RUN=true om CONFIRM saknas eller --dry-run är satt).
  return new Promise((resolve) => {
    const child = spawn("npx", cmdArgs, {
      stdio: "inherit",
      env: { ...process.env },
    });
    let settled = false;
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    child.on("error", (err) => {
      console.error(`\nFEL: kunde inte starta migrate-skriptet: ${err.message}`);
      done(1);
    });
    child.on("exit", (code) => done(code ?? 1));
  });
}

async function writeAuditRow(
  rows: PreflightRow[],
  customerIds: string[],
): Promise<void> {
  if (!process.env.PROD_DATABASE_URL) {
    fail("PROD_DATABASE_URL saknas — kan inte skriva audit-rad i prod.");
  }
  const prodPool = new Pool({
    connectionString: process.env.PROD_DATABASE_URL,
  });
  try {
    const metadata = {
      actor: ACTOR,
      tenant: TENANT,
      activeSince: ACTIVE_SINCE,
      customers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        wasActiveInDev: r.is_active,
        objectCount: r.object_count,
      })),
      requestedIds: customerIds,
      script: "scripts/restore-dormant-customer.ts",
    };
    await prodPool.query(
      `INSERT INTO audit_logs
         (tenant_id, user_id, action, resource_type, resource_id, changes, metadata)
       VALUES ($1, NULL, $2, 'customers', $3, $4::jsonb, $5::jsonb)`,
      [
        TENANT,
        "restore_dormant_customer",
        customerIds.join(","),
        JSON.stringify({ restoredCustomerIds: customerIds }),
        JSON.stringify(metadata),
      ],
    );
    console.log(
      `\n[audit] Skrev audit_logs-rad i prod (action=restore_dormant_customer, ` +
        `actor=${ACTOR}, customers=${customerIds.length}).`,
    );
  } finally {
    await prodPool.end();
  }
}

// ----------------------------- main ------------------------------

async function main(): Promise<void> {
  if (SEARCH) {
    await searchCustomers(SEARCH);
    await dev.end();
    return;
  }

  if (!CUSTOMER_ID_ARG) {
    fail(
      "ange antingen --search=<text> för att söka, eller " +
        "--customer-id=<id1,id2,...> --actor=<epost> för att återställa.",
    );
  }
  if (!ACTOR) {
    fail("--actor=<epost eller namn> krävs vid återställning (för audit-spår).");
  }
  if (!process.env.PROD_DATABASE_URL) {
    fail("PROD_DATABASE_URL saknas. Lägg in den som Secret innan körning.");
  }
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
    fail("DATABASE_URL och PROD_DATABASE_URL pekar på samma DB.");
  }

  const ids = CUSTOMER_ID_ARG.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) fail("--customer-id är tom.");

  console.log("Traivo — Återställ enskilda vilande kunder DEV → PROD");
  console.log(`  TENANT       : ${TENANT}`);
  console.log(`  ACTIVE_SINCE : ${ACTIVE_SINCE}`);
  console.log(`  ACTOR        : ${ACTOR}`);
  console.log(`  KUND-IDn     : ${ids.length} st`);
  console.log(`  DRY_RUN      : ${DRY_RUN ? "JA (rollback i slutet)" : "NEJ — committar"}`);
  console.log("");

  // 1) Verifiera att kunderna finns i dev och är vilande.
  const rows = await preflightDormancy(ids);
  const active = rows.filter((r) => r.is_active);
  if (active.length > 0 && !ALLOW_ACTIVE) {
    console.error(
      `FEL: ${active.length} av kunderna har redan work_order >= ${ACTIVE_SINCE} i dev ` +
        `och räknas alltså som AKTIVA, inte vilande:`,
    );
    for (const a of active) console.error(`  - ${a.id}  ${a.name}`);
    console.error(
      "\nDe är inte tänkta att tas in via det här skriptet. Använd det vanliga " +
        "migrate-skriptet (--phase=customers) om du verkligen vill köra dem ändå, " +
        "eller lägg till --allow-active för att tvinga återställning här.",
    );
    process.exit(2);
  }
  console.log("Kunder att återställa:");
  for (const r of rows) {
    console.log(
      `  - ${r.id}  ${r.name}  (objekt=${r.object_count}, ${r.is_active ? "AKTIV" : "vilande"})`,
    );
  }
  console.log("");

  // 2) Stäng dev-poolen innan migrate-skriptet körs (det öppnar sin egen).
  await dev.end();

  // 3) Delegera till migrate-skriptet — återanvänder transaktion, FK-checkar
  //    och tenant-leak-check.
  const code = await runMigrate(ids);
  if (code !== 0) {
    console.error(
      `\nMigrate-skriptet exit-kodade ${code}. Ingen audit-rad skrivs.`,
    );
    process.exit(code);
  }

  // 4) Audit-rad — endast vid skarp körning. Dry-run skriver inget.
  if (DRY_RUN) {
    console.log(
      "\n[DRY-RUN] Hoppar över audit-rad. Kör om utan --dry-run och med " +
        "CONFIRM=YES_MIGRATE_PROD för att persistera.",
    );
    return;
  }
  await writeAuditRow(rows, ids);
  console.log("\nKlart.");
}

main().catch(async (err) => {
  console.error("\nFEL:", err);
  await dev.end().catch(() => {});
  process.exit(1);
});
