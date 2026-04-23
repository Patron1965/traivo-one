/**
 * Engångsjobb: spegla alla redan sparade externa tenant-logoUrl in i
 * objektlagret så att vi inte är beroende av extern hosting.
 *
 * Idempotent — rader vars logoUrl redan pekar på /api/storage/serve... hoppas
 * över. Misslyckade nedladdningar loggas men avbryter inte resten av batchen.
 *
 * Användning:
 *   tsx server/scripts/mirror-external-logos.ts                    # alla tenants
 *   tsx server/scripts/mirror-external-logos.ts --tenant <id>      # en tenant
 *   tsx server/scripts/mirror-external-logos.ts --limit 50         # max 50 nedladdningar
 *   tsx server/scripts/mirror-external-logos.ts --delay 500        # ms mellan anrop
 */
import { mirrorAllExternalTenantLogos } from "../services/mirrorLogo.backfill";

function parseArgs(argv: string[]): {
  tenantId?: string;
  limit?: number;
  delay?: number;
} {
  const out: { tenantId?: string; limit?: number; delay?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant" && argv[i + 1]) {
      out.tenantId = argv[++i];
    } else if (arg === "--limit" && argv[i + 1]) {
      out.limit = parseInt(argv[++i], 10);
    } else if (arg === "--delay" && argv[i + 1]) {
      out.delay = parseInt(argv[++i], 10);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[mirror-external-logos] Startar${args.tenantId ? ` för tenant ${args.tenantId}` : ""}` +
      `${args.limit ? `, limit=${args.limit}` : ""}${args.delay ? `, delay=${args.delay}ms` : ""}`
  );

  const summary = await mirrorAllExternalTenantLogos({
    tenantId: args.tenantId,
    limit: args.limit,
    delayMs: args.delay,
  });

  console.log(
    `[mirror-external-logos] Klar. total=${summary.total}, candidates=${summary.candidates}, ` +
      `mirrored=${summary.mirrored}, failed=${summary.failed}, skipped=${summary.skipped}`
  );
  if (summary.failed > 0) {
    console.log(
      `[mirror-external-logos] Misslyckade rader:\n` +
        summary.results
          .filter((r) => r.status === "failed")
          .map((r) => `  - ${r.tenantId}: ${r.originalUrl} (${r.error})`)
          .join("\n")
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[mirror-external-logos] Failed:", err);
  process.exit(1);
});
