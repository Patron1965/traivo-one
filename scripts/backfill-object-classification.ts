/**
 * scripts/backfill-object-classification.ts (Task #1484)
 *
 * Idempotent backfill för klassificeringsmodellen: skriver metod='auto'-
 * metadatavärden (Objekttyp/Anläggningstyp, systemområdet Klassificering)
 * ENBART för aktiva objekt som har en icke-tom kolumn men SAKNAR egen
 * metadata-rad (aktiv eller tombstonad). Nollar/överskriver aldrig något.
 *
 * Användning:
 *   npx tsx scripts/backfill-object-classification.ts                 # dry-run, alla tenants
 *   npx tsx scripts/backfill-object-classification.ts --tenant kinab  # dry-run, en tenant
 *   npx tsx scripts/backfill-object-classification.ts --confirm KLASSIFICERING-BACKFILL
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { ensureSystemomradenFalt } from "../server/metadata-queries";
import { backfillClassificationMetadata } from "../server/services/object-classification";

const args = process.argv.slice(2);
const tenantIdx = args.indexOf("--tenant");
const TENANT = tenantIdx >= 0 && args[tenantIdx + 1] ? args[tenantIdx + 1] : null;
const confirmIdx = args.indexOf("--confirm");
const DRY_RUN = (confirmIdx >= 0 ? args[confirmIdx + 1] : null) !== "KLASSIFICERING-BACKFILL";

async function main(): Promise<void> {
  const tenantIds: string[] = TENANT
    ? [TENANT]
    : ((await db.execute(sql`SELECT id FROM tenants`)).rows as { id: string }[]).map((r) => r.id);

  console.log(`Klassificerings-backfill — tenants=${tenantIds.length} dryRun=${DRY_RUN}`);
  let totalCreated = 0;
  let totalErrors = 0;
  for (const tenantId of tenantIds) {
    const ensured = await ensureSystemomradenFalt(tenantId);
    const r = await backfillClassificationMetadata(tenantId, { dryRun: DRY_RUN });
    totalCreated += r.created;
    totalErrors += r.errors;
    if (r.created > 0 || r.errors > 0 || ensured.created.length > 0) {
      console.log(
        `  ${tenantId}: scanned=${r.scanned} ${DRY_RUN ? "would-create" : "created"}=${r.created} ` +
        `skippedExisting=${r.skippedExisting} skippedEmpty=${r.skippedEmpty} errors=${r.errors} ` +
        `ensured=[${ensured.created.join(",")}] conflicts=${ensured.conflicts.length}`,
      );
      for (const c of ensured.conflicts) console.log(`    konflikt: ${c.namn} — ${c.reason}`);
    }
  }
  console.log(`KLART. ${DRY_RUN ? "Skulle skriva" : "Skrev"} ${totalCreated} metadatavärden, ${totalErrors} fel.`);
  if (DRY_RUN && totalCreated > 0) {
    console.log(`Kör skarpt: npx tsx scripts/backfill-object-classification.ts --confirm KLASSIFICERING-BACKFILL`);
  }
  if (totalErrors > 0) process.exitCode = 1;
}

main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error("Backfill misslyckades:", err);
  process.exit(1);
});
