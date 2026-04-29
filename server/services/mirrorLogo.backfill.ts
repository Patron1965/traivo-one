import { db } from "../db";
import { tenantBranding } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isExternalLogoUrl, mirrorExternalLogo } from "./mirrorLogo";

export type MirrorBackfillRowResult = {
  tenantId: string;
  originalUrl: string;
  status: "mirrored" | "failed";
  newUrl?: string;
  error?: string;
};

export type MirrorBackfillSummary = {
  total: number;
  candidates: number;
  mirrored: number;
  failed: number;
  skipped: number;
  results: MirrorBackfillRowResult[];
};

export type MirrorBackfillOptions = {
  delayMs?: number;
  limit?: number;
  tenantId?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mirrorAllExternalTenantLogos(
  options: MirrorBackfillOptions = {}
): Promise<MirrorBackfillSummary> {
  const delayMs = options.delayMs ?? 250;

  const rows = options.tenantId
    ? await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, options.tenantId))
    : await db.select().from(tenantBranding);

  const summary: MirrorBackfillSummary = {
    total: rows.length,
    candidates: 0,
    mirrored: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  let processed = 0;
  for (const row of rows) {
    const logoUrl = row.logoUrl;
    if (!isExternalLogoUrl(logoUrl)) {
      summary.skipped++;
      continue;
    }
    summary.candidates++;
    if (options.limit && processed >= options.limit) {
      summary.skipped++;
      continue;
    }
    processed++;

    console.log(`[mirror-backfill] tenant=${row.tenantId} fetching ${logoUrl}`);
    const result = await mirrorExternalLogo(logoUrl, `tenant:${row.tenantId}`);

    if (!result.ok) {
      summary.failed++;
      summary.results.push({
        tenantId: row.tenantId,
        originalUrl: logoUrl,
        status: "failed",
        error: `[${result.status}] ${result.error}`,
      });
      console.warn(
        `[mirror-backfill] tenant=${row.tenantId} FAILED: [${result.status}] ${result.error}`
      );
      if (delayMs > 0) await sleep(delayMs);
      continue;
    }

    try {
      await db
        .update(tenantBranding)
        .set({
          logoUrl: result.url,
          version: (row.version || 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(tenantBranding.tenantId, row.tenantId));

      summary.mirrored++;
      summary.results.push({
        tenantId: row.tenantId,
        originalUrl: logoUrl,
        status: "mirrored",
        newUrl: result.url,
      });
      console.log(
        `[mirror-backfill] tenant=${row.tenantId} mirrored -> ${result.url} (${result.bytes} bytes, ${result.contentType})`
      );
    } catch (err) {
      summary.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.results.push({
        tenantId: row.tenantId,
        originalUrl: logoUrl,
        status: "failed",
        error: `db-update: ${msg}`,
      });
      console.warn(`[mirror-backfill] tenant=${row.tenantId} DB UPDATE FAILED: ${msg}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return summary;
}
