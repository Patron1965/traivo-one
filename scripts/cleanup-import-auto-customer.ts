// Task #1437 — Datastäd: ta bort system-skriven Kund-metadata som legacy-
// importen auto-tilldelade (fallback "första aktiva kund"). Ett objekt ska
// inte automatiskt kopplas till kund; kund anges manuellt på ordern eller via
// uttryckligt mappat Kund-metadatafält.
//
// Identifiering (konservativ):
//   • metadata_varden-rad vars katalogpost är "Kund" (lower(namn)='kund', aktiv)
//   • mv.metod = 'system' AND mv.skapad_av = 'system'  (legacy auto-fallback)
//   • mv.raderad = false, status aktiv
//   • objektet har import_batch_id IS NOT NULL        (importerat objekt)
// Uttryckligen valda kunder röres INTE:
//   • manuellt/UI-satta rader har metod != 'system'
//   • nya explicit-valda import-/portal-kopplingar stämplas med skapad_av
//     'import-explicit' / 'portal-explicit' / 'user-explicit' (Task #1437) och
//     exkluderas av skapad_av='system'-predikatet
//   • seed-/demo-objekt utan import_batch_id röres INTE
// OBS: äldre data skriven FÖRE proveniens-stämpeln kan inte skiljas per rad —
// därför kräver --execute BÅDE --tenant och --customer (den kända felaktiga
// fallback-kunden, t.ex. Telge Bostäder) så att kandidatmängden är uttryckligt
// avgränsad och granskad via dry-run innan något raderas.
//
// Körning:
//   npx tsx scripts/cleanup-import-auto-customer.ts                      # dry-run (default)
//   npx tsx scripts/cleanup-import-auto-customer.ts --tenant <id>        # scopa till tenant
//   npx tsx scripts/cleanup-import-auto-customer.ts --customer <id>      # scopa till kund
//   npx tsx scripts/cleanup-import-auto-customer.ts \
//       --tenant <id> --customer <id> --execute                          # skarp radering
//   npx tsx scripts/cleanup-import-auto-customer.ts --restore <loggfil>  # återställ raderade rader
//
// Reversibilitet: vid --execute skrivs FÖRST en fullständig JSON-logg av alla
// rader som ska raderas till logs/import-auto-customer-cleanup-<ts>.json.
// Raderna HARD-deletas (soft-delete/raderad=true skulle skapa tombstones som
// blockerar kund-arv från förälder — se primaryPayerCustomerIdSqlFor).
// --restore läser loggfilen och återinsertar raderna idempotent (per id,
// ON CONFLICT DO NOTHING).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

type Args = {
  execute: boolean;
  tenant: string | null;
  customer: string | null;
  restore: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false, tenant: null, customer: null, restore: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") args.execute = true;
    else if (a === "--tenant") args.tenant = argv[++i] ?? null;
    else if (a === "--customer") args.customer = argv[++i] ?? null;
    else if (a === "--restore") args.restore = argv[++i] ?? null;
    else {
      console.error(`Okänd flagga: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

export async function findCandidates(args: Pick<Args, "tenant" | "customer">) {
  const res = await db.execute(sql`
    SELECT mv.*, o.name AS object_name, o.object_number, o.import_batch_id,
           c.name AS customer_name
    FROM metadata_varden mv
    JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
      AND lower(mk.namn) = 'kund' AND mk.deleted_at IS NULL
    JOIN objects o ON o.id = mv.objekt_id AND o.tenant_id = mv.tenant_id
    LEFT JOIN customers c ON c.id = mv.varde_referens
    WHERE mv.metod = 'system'
      AND mv.skapad_av = 'system'
      AND COALESCE(mv.raderad, FALSE) = FALSE
      AND (mv.status IS NULL OR mv.status = 'aktiv')
      AND o.import_batch_id IS NOT NULL
      ${args.tenant ? sql`AND mv.tenant_id = ${args.tenant}` : sql``}
      ${args.customer ? sql`AND mv.varde_referens = ${args.customer}` : sql``}
    ORDER BY mv.tenant_id, o.object_number
  `);
  return ((res as any).rows ?? []) as Array<Record<string, unknown>>;
}

async function restore(file: string) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const rows: Array<Record<string, unknown>> = payload.rows ?? [];
  if (!rows.length) {
    console.log("Loggfilen innehåller inga rader — inget att återställa.");
    return;
  }
  // Återinsert endast riktiga metadata_varden-kolumner (loggens extra
  // join-fält som object_name/customer_name/import_batch_id skalas bort).
  const COLUMNS = [
    "id", "tenant_id", "objekt_id", "work_order_id", "metadata_katalog_id",
    "varde_string", "varde_integer", "varde_decimal", "varde_boolean",
    "varde_datetime", "varde_json", "varde_referens",
    "arvs_nedat", "stoppa_vidare_arvning", "niva_las", "kopplad_till_metadata_id",
    "skapad_av", "uppdaterad_av", "metod",
    "raderad", "raderad_av", "raderad_vid",
    "status", "arkiverad_av", "arkiverad_vid",
    "anonymiserad_av", "anonymiserad_vid", "konverterad_fran_historik_id",
    "created_at", "updated_at",
  ];
  let restored = 0;
  for (const r of rows) {
    const cols = COLUMNS.filter((c) => r[c] !== undefined);
    const colSql = sql.raw(cols.map((c) => `"${c}"`).join(", "));
    const valSql = sql.join(
      cols.map((c) => {
        const v = r[c];
        if (c === "varde_json" && v != null) return sql`${JSON.stringify(v)}::jsonb`;
        return sql`${v as any}`;
      }),
      sql`, `,
    );
    const res = await db.execute(sql`
      INSERT INTO metadata_varden (${colSql}) VALUES (${valSql})
      ON CONFLICT (id) DO NOTHING
    `);
    restored += Number((res as any).rowCount ?? 0);
  }
  console.log(`Återställde ${restored} av ${rows.length} rader (redan befintliga hoppades över).`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.restore) {
    await restore(args.restore);
    return;
  }

  const rows = await findCandidates(args);
  console.log(`Hittade ${rows.length} system-skrivna Kund-metadatarader på importerade objekt.`);
  for (const r of rows) {
    console.log(
      `  [${r.tenant_id}] objekt ${r.object_number ?? r.objekt_id} "${r.object_name}"` +
        ` → kund ${r.customer_name ?? r.varde_referens} (mv.id=${r.id}, batch=${r.import_batch_id})`,
    );
  }

  if (!args.execute) {
    console.log("\nDRY-RUN — inget raderat. Kör med --tenant <id> --customer <id> --execute för skarp radering.");
    return;
  }
  if (!args.tenant || !args.customer) {
    console.error(
      "\n--execute kräver BÅDE --tenant och --customer (den kända felaktiga fallback-kunden).\n" +
        "Äldre rader saknar per-rad-proveniens; utan uttrycklig avgränsning riskerar\n" +
        "skarp körning att radera legitima kundkopplingar. Granska dry-run först.",
    );
    process.exitCode = 1;
    return;
  }
  if (!rows.length) {
    console.log("Inget att radera.");
    return;
  }

  // Reversibel logg FÖRE mutationen.
  mkdirSync("logs", { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = `logs/import-auto-customer-cleanup-${ts}.json`;
  writeFileSync(
    logFile,
    JSON.stringify({ createdAt: new Date().toISOString(), reason: "task-1437", rows }, null, 2),
  );
  console.log(`\nBackup-logg skriven: ${logFile}`);

  const ids = rows.map((r) => String(r.id));
  const del = await db.execute(sql`
    DELETE FROM metadata_varden
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      AND metod = 'system' AND skapad_av = 'system'
  `);
  console.log(`Raderade ${Number((del as any).rowCount ?? 0)} rader.`);
  console.log(`Återställ vid behov: npx tsx scripts/cleanup-import-auto-customer.ts --restore ${logFile}`);
}

// Kör bara som CLI — inte när findCandidates importeras av tester.
if (process.argv[1] && /cleanup-import-auto-customer/.test(process.argv[1])) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
