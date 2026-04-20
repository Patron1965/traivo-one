/**
 * Engångsjobb: geokodar alla objekt med adress men utan koordinater
 * och skriver resultatet (lat/lng + ev. entrékoordinater och stad) till
 * objects-tabellen.
 *
 * Idempotent — säkert att köra flera gånger. Objekt som redan har
 * koordinater hoppas över.
 *
 * Användning:
 *   tsx server/scripts/geocode-missing-coords.ts                # alla tenants
 *   tsx server/scripts/geocode-missing-coords.ts --tenant <id>  # en tenant
 *   tsx server/scripts/geocode-missing-coords.ts --limit 50     # max 50 objekt per tenant
 *   tsx server/scripts/geocode-missing-coords.ts --delay 250    # ms mellan anrop
 */
import { storage } from "../storage";
import { geocodeMissingForTenant, type GeocodeBatchSummary } from "../services/geocoding";

function parseArgs(argv: string[]): { tenantId?: string; limit?: number; delay?: number } {
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

  let tenantIds: string[];
  if (args.tenantId) {
    tenantIds = [args.tenantId];
  } else {
    const tenants = await storage.getPublicTenants();
    tenantIds = tenants.map((t) => t.id);
  }

  console.log(`[geocode-missing] Processing ${tenantIds.length} tenant(s)`);

  const totals: GeocodeBatchSummary = { total: 0, geocoded: 0, skipped: 0, failed: 0, results: [] };

  for (const tenantId of tenantIds) {
    const summary = await geocodeMissingForTenant(tenantId, {
      delayMs: args.delay ?? 150,
      limit: args.limit,
    });
    totals.total += summary.total;
    totals.geocoded += summary.geocoded;
    totals.skipped += summary.skipped;
    totals.failed += summary.failed;
  }

  console.log(
    `[geocode-missing] All done. Total candidates: ${totals.total}, geocoded: ${totals.geocoded}, failed: ${totals.failed}, skipped: ${totals.skipped}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[geocode-missing] Failed:", err);
  process.exit(1);
});
