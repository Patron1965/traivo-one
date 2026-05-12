#!/usr/bin/env tsx
/**
 * Restore individual dormant customer(s) from DEV → PROD (Task #427).
 *
 * Tunn CLI-wrapper runt `server/services/restoreDormantCustomerService.ts`
 * (Task #428). All affärslogik (sökning, dormancy-preflight, spawn av migrate-
 * skriptet, audit-rad i prod) ligger i serviceen så att admin-UI:t (Task #428)
 * och denna CLI använder exakt samma kodväg.
 *
 * ANVÄNDNING — oförändrad sedan Task #427:
 *   # Sök fram kandidater (read-only mot dev):
 *   PROD_DATABASE_URL=postgres://... \
 *     npx tsx scripts/restore-dormant-customer.ts --search="brf solgården"
 *
 *   # Dry-run:
 *   PROD_DATABASE_URL=postgres://... \
 *     npx tsx scripts/restore-dormant-customer.ts \
 *       --customer-id=cust_abc,cust_def --actor=mats@traivo.se --dry-run
 *
 *   # Skarp körning:
 *   PROD_DATABASE_URL=postgres://... CONFIRM=YES_MIGRATE_PROD \
 *     npx tsx scripts/restore-dormant-customer.ts \
 *       --customer-id=cust_abc,cust_def --actor=mats@traivo.se
 */
import {
  restoreDormantCustomers,
  searchDormantCustomers,
  RestoreDormantError,
} from "../server/services/restoreDormantCustomerService";

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

function fail(msg: string): never {
  console.error(`FEL: ${msg}`);
  process.exit(1);
}

async function doSearch(query: string): Promise<void> {
  const rows = await searchDormantCustomers({
    query,
    tenant: TENANT,
    activeSince: ACTIVE_SINCE,
  });
  if (rows.length === 0) {
    console.log(`Inga matchningar för "${query}" under tenant=${TENANT}.`);
    return;
  }
  console.log(`Hittade ${rows.length} kund(er) i dev för "${query}":\n`);
  console.log(
    "STATUS  ID                                   KUNDNR     ORGNR        OBJ  SENASTE WO   NAMN",
  );
  for (const row of rows) {
    const status = row.isActive ? "AKTIV " : "VILAND";
    const id = row.id.padEnd(36);
    const kn = (row.customerNumber || "—").padEnd(10);
    const on = (row.orgNumber || "—").padEnd(12);
    const oc = String(row.objectCount).padStart(4);
    const wo = (row.lastWoDate || "—").padEnd(12);
    console.log(`${status}  ${id} ${kn} ${on} ${oc}  ${wo} ${row.name}`);
  }
  console.log(
    "\nTips: kopiera ID:n och kör med " +
      `--customer-id=<id1,id2,...> --actor=<din epost>${DRY_RUN ? " --dry-run" : ""}`,
  );
}

async function main(): Promise<void> {
  if (SEARCH) {
    await doSearch(SEARCH);
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

  const ids = CUSTOMER_ID_ARG.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) fail("--customer-id är tom.");

  console.log("Traivo — Återställ enskilda vilande kunder DEV → PROD");
  console.log(`  TENANT       : ${TENANT}`);
  console.log(`  ACTIVE_SINCE : ${ACTIVE_SINCE}`);
  console.log(`  ACTOR        : ${ACTOR}`);
  console.log(`  KUND-IDn     : ${ids.length} st`);
  console.log(
    `  DRY_RUN      : ${DRY_RUN ? "JA (rollback i slutet)" : "NEJ — committar"}`,
  );
  console.log("");

  try {
    const result = await restoreDormantCustomers(
      {
        ids,
        tenant: TENANT,
        activeSince: ACTIVE_SINCE,
        allowActive: ALLOW_ACTIVE,
        dryRun: DRY_RUN,
        userId: null, // CLI-mode: ingen inloggad user
        actor: ACTOR ?? null,
      },
      "cli",
    );

    console.log("\nKunder att återställa:");
    for (const r of result.preflight) {
      console.log(
        `  - ${r.id}  ${r.name}  (objekt=${r.objectCount}, ${r.isActive ? "AKTIV" : "vilande"})`,
      );
    }
    console.log("");
    process.stdout.write(result.migrateLog);

    if (result.migrateExitCode !== 0) {
      console.error(
        `\nMigrate-skriptet exit-kodade ${result.migrateExitCode}. Ingen audit-rad skrivs.`,
      );
      process.exit(result.migrateExitCode);
    }
    if (result.dryRun) {
      console.log(
        "\n[DRY-RUN] Hoppar över audit-rad. Kör om utan --dry-run och med " +
          "CONFIRM=YES_MIGRATE_PROD för att persistera.",
      );
      return;
    }
    if (result.auditWritten) {
      console.log(
        `\n[audit] Skrev audit_logs-rad i prod (action=restore_dormant_customer, ` +
          `actor=${ACTOR}, customers=${ids.length}).`,
      );
    }
    console.log("\nKlart.");
  } catch (err) {
    if (err instanceof RestoreDormantError) {
      if (err.code === "customer_active") {
        const details = err.details as { active: { id: string; name: string }[] };
        console.error(`FEL: ${err.message}`);
        for (const a of details.active) console.error(`  - ${a.id}  ${a.name}`);
        console.error(
          "\nDe är inte tänkta att tas in via det här skriptet. Använd det vanliga " +
            "migrate-skriptet (--phase=customers) om du verkligen vill köra dem ändå, " +
            "eller lägg till --allow-active för att tvinga återställning här.",
        );
        process.exit(2);
      }
      fail(err.message);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("\nFEL:", err);
  process.exit(1);
});
