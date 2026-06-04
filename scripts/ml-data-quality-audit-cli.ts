import { buildReport, buildMarkdown, writeBaselineReport } from "./ml-data-quality-audit";

// CLI: cross-tenant per default (kräver DB-access — engineer/ops only).
const cliTenant = process.argv.find(a => a.startsWith("--tenant="))?.split("=")[1];
const writeBaseline = process.argv.includes("--write-baseline");
buildReport({ tenantId: cliTenant }).then(async report => {
  console.log(JSON.stringify(report, null, 2));
  console.log("\n---\nMARKDOWN-SAMMANFATTNING:\n---");
  console.log(buildMarkdown(report));
  if (writeBaseline) {
    const p = await writeBaselineReport(report);
    console.log(`\n[baseline skriven] ${p}`);
  }
  process.exit(0);
}).catch(err => {
  console.error("Audit failed:", err);
  process.exit(1);
});
