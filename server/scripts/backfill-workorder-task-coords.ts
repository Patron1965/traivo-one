/**
 * Idempotent backfill: kopierar objects.latitude/longitude till
 * work_orders.task_latitude/task_longitude för alla arbetsordrar där
 * task-koordinaterna saknas men det kopplade objektet har koordinater.
 *
 * Bakgrund: Innan auto-fillen i createWorkOrder/updateWorkOrder fanns
 * (server/storage.ts), skapades arbetsordrar utan task-koordinater.
 * Frontend-planeraren filtrerade då bort dem från ruttvyn. Detta
 * skript återställer befintliga rader. Säkert att köra flera gånger.
 *
 * Körs en gång efter att fixen i task #153 har deployats:
 *   tsx server/scripts/backfill-workorder-task-coords.ts
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[backfill] Starting work_orders task coord backfill from objects...");
  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE work_orders wo
      SET task_latitude = o.latitude,
          task_longitude = o.longitude
      FROM objects o
      WHERE wo.object_id = o.id
        AND (wo.task_latitude IS NULL OR wo.task_longitude IS NULL)
        AND o.latitude IS NOT NULL
        AND o.longitude IS NOT NULL
      RETURNING wo.id
    )
    SELECT count(*)::int AS updated FROM updated;
  `);
  const row = (result as unknown as { rows: Array<{ updated: number }> }).rows?.[0]
    ?? (Array.isArray(result) ? result[0] : undefined);
  const updatedCount = row?.updated ?? 0;
  console.log(`[backfill] Done. Updated ${updatedCount} work_order rows with task coordinates.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Failed:", err);
  process.exit(1);
});
