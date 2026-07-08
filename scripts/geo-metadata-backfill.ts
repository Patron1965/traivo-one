/**
 * scripts/geo-metadata-backfill.ts
 *
 * Engångs-backfill för den kanoniska geografimodellen (T004): gör legacy-objekt
 * konsekventa genom att skriva metod='auto'-metadatavärden för de systemlåsta
 * geo-fälten (Gatuadress/Postnummer/Postort/Koordinater) ENBART där objektet har
 * en icke-tom kolumn men saknar ett eget aktivt metadatavärde.
 *
 * Säkert i alla miljöer:
 *   - DEV (adress i kolumner, tom metadata) → fyller metadata additivt.
 *   - PROD (kolumner tomma, adress i metadata) → no-op.
 * Nollar ALDRIG något; skriver bara saknade metadatavärden. Kör ALDRIG vid startup.
 *
 * Användning:
 *   npx tsx scripts/geo-metadata-backfill.ts                       # dry-run (kinab)
 *   npx tsx scripts/geo-metadata-backfill.ts --tenant kinab        # dry-run
 *   npx tsx scripts/geo-metadata-backfill.ts --tenant kinab --confirm GEO-BACKFILL
 */

import { ensureSystemlastaFalt } from "../server/metadata-queries";
import { backfillColumnsToMetadata } from "../server/services/geo-field-sync";

const args = process.argv.slice(2);
const tenantIdx = args.indexOf("--tenant");
const TENANT = tenantIdx >= 0 && args[tenantIdx + 1] ? args[tenantIdx + 1] : "kinab";
const confirmIdx = args.indexOf("--confirm");
const confirmToken = confirmIdx >= 0 ? args[confirmIdx + 1] : null;
const DRY_RUN = confirmToken !== "GEO-BACKFILL";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log(`Geo-metadata backfill — tenant='${TENANT}' dryRun=${DRY_RUN}`);
  console.log("=".repeat(60));

  // Se till att de systemlåsta geo-katalogfälten finns för tenanten (idempotent).
  await ensureSystemlastaFalt(TENANT);

  const report = await backfillColumnsToMetadata(TENANT, { dryRun: DRY_RUN });

  console.log(`\nObjekt skannade: ${report.objectsScanned}`);
  console.log(`Fält som ${DRY_RUN ? "SKULLE skrivas" : "skrevs"}: ${report.fieldsWritten}`);
  for (const [namn, n] of Object.entries(report.perField)) {
    console.log(`  • ${namn}: ${n}`);
  }
  if (report.details.length > 0) {
    console.log("\nDetaljer (max 30):");
    for (const d of report.details.slice(0, 30)) {
      console.log(`  ${d.objectId}  ${d.field} = ${d.value}`);
    }
  }

  if (DRY_RUN) {
    console.log("\n" + "=".repeat(60));
    console.log("DRY-RUN klar. Inget skrevs.");
    console.log(`För att köra skarpt:`);
    console.log(`  npx tsx scripts/geo-metadata-backfill.ts --tenant ${TENANT} --confirm GEO-BACKFILL`);
    console.log("=".repeat(60));
  } else {
    console.log("\n" + "=".repeat(60));
    console.log(`KLART. ${report.fieldsWritten} metadatavärden skrevs för tenant '${TENANT}'.`);
    console.log("=".repeat(60));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
