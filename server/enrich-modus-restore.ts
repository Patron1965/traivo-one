import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  auditLogs,
  importBatches,
  metadataVarden,
} from "@shared/schema";
import { updateMetadata, rollbackDeleteMetadataRows } from "./metadata-queries";
import { NotFoundError, ValidationError } from "./errors";

export interface RestoreEnrichModusResult {
  restored: number;
  deleted: number;
  skipped: number;
  total: number;
}

export interface RestoreEnrichModusOptions {
  batchId: string;
  tenantId: string;
  userId: string | null;
}

export const ENRICH_MODUS_BATCH_PREFIX = "enrich-modus-";

export async function restoreEnrichModusBatch({
  batchId,
  tenantId,
  userId,
}: RestoreEnrichModusOptions): Promise<RestoreEnrichModusResult> {
  if (!batchId.startsWith(ENRICH_MODUS_BATCH_PREFIX)) {
    throw new ValidationError(
      "Endast enrich-modus-batches kan återställas via denna endpoint",
    );
  }

  const [batch] = await db
    .select()
    .from(importBatches)
    .where(
      and(
        eq(importBatches.batchId, batchId),
        eq(importBatches.tenantId, tenantId),
      ),
    );
  if (!batch) throw new NotFoundError("Berikning-batch hittades inte");

  return await db.transaction(async (tx) => {
    const entries = await tx
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, "enrich_modus"),
          sql`${auditLogs.metadata}->>'batchId' = ${batchId}`,
        ),
      );

    let restored = 0;
    let deleted = 0;
    let skipped = 0;
    const restoreAudit: any[] = [];

    for (const entry of entries) {
      if (!entry.resourceId) {
        skipped++;
        continue;
      }
      const before = (entry.changes as any)?.before;
      const after = (entry.changes as any)?.after;

      if (before === null || before === undefined) {
        // Task #1213: rollback-radering via centrala skrivlagret.
        const delCount = await rollbackDeleteMetadataRows(tx, tenantId, [entry.resourceId]);
        if (delCount > 0) {
          deleted++;
          restoreAudit.push({
            tenantId,
            userId,
            action: "enrich_modus_restore",
            resourceType: "object_metadata",
            resourceId: entry.resourceId,
            changes: { before: after, after: null },
            metadata: {
              batchId,
              restoredFromBatch: batchId,
              source: "enrich-modus-restore",
            },
          });
        } else {
          skipped++;
        }
      } else if (typeof before === "object" && "value" in before) {
        try {
          await updateMetadata(
            entry.resourceId,
            before.value,
            tenantId,
            userId || "enrich-restore",
            "enrich-modus-restore",
          );
          restored++;
          restoreAudit.push({
            tenantId,
            userId,
            action: "enrich_modus_restore",
            resourceType: "object_metadata",
            resourceId: entry.resourceId,
            changes: { before: after, after: before },
            metadata: {
              batchId,
              restoredFromBatch: batchId,
              source: "enrich-modus-restore",
            },
          });
        } catch {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    if (restoreAudit.length > 0) {
      for (let i = 0; i < restoreAudit.length; i += 500) {
        await tx.insert(auditLogs).values(restoreAudit.slice(i, i + 500));
      }
    }

    const existingMeta = (batch.metadata as Record<string, any>) || {};
    await tx
      .update(importBatches)
      .set({
        metadata: {
          ...existingMeta,
          restored: true,
          restoredAt: new Date().toISOString(),
          restoredBy: userId,
          restoredCount: restored + deleted,
        },
      })
      .where(
        and(
          eq(importBatches.batchId, batchId),
          eq(importBatches.tenantId, tenantId),
        ),
      );

    return { restored, deleted, skipped, total: entries.length };
  });
}
