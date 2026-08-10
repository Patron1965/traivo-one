// Task #1506 — Backfill: uppgiftspaket + artikel-snapshot + sourceAssignmentId
// ============================================================================
// Idempotent. Kör med:  npx tsx scripts/backfill-uppgiftspaket.ts [--dry-run]
//
// 1) work_orders/assignments UTAN paket får ett paket byggt från radens egna
//    kolumner + objektet (uppdateradAv="backfill"). Frysta rader fylls också —
//    deras artikel-snapshot tas från de riktiga frysta kolumnerna
//    (frozenUnitPrice/-Cost/-Time resp. assignment_articles unit*), aldrig från
//    dagens register.
// 2) Rader MED paket men utan artikel-snapshot (artikelId saknas) får
//    snapshoten kompletterad från primär orderrad/assignment-artikel.
// 3) sourceAssignmentId: materialiserade WO:er (invoiceSourceType='assignment')
//    utan referens matchas KONSERVATIVT (exakt en kandidat åt båda håll på
//    tenant+koncept+objekt+kund). Ej entydiga rapporteras som rest.
import { db, pool } from "../server/db";
import { workOrders, assignments, workOrderLines, assignmentArticles } from "@shared/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  UPPGIFTSPAKET_VERSION,
  type Uppgiftspaket,
  type UppgiftspaketArtikel,
} from "@shared/uppgift-contract";
import { buildUppgiftspaket } from "../server/services/uppgiftspaket";
import { deriveUppgiftStatus, isUppgiftFrozen } from "@shared/uppgift-contract";

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Väljer snapshot-värden för en WO: FRYSTA uppgifter måste backfillas från de
 * kanoniska frysta kolumnerna (frozenUnit* — samma öre/min-enhet som resolved*,
 * per styck, satta av freezeWorkOrder), ALDRIG från dagens orderrader (de kan
 * ha ändrats efter frysningen). Öppna uppgifter tar radens resolved*-värden.
 * Exporterad för regressionstest.
 */
export function chooseWoSnapshotValues(
  wo: {
    orderStatus: string | null;
    executionStatus: string | null;
    invoiceQueueState: string | null;
    impossibleReason: string | null;
    frozenUnitPrice: number | null;
    frozenUnitCost: number | null;
    frozenUnitTime: number | null;
  },
  line: { resolvedPrice: number | null; resolvedCost: number | null; resolvedProductionMinutes: number | null } | null,
): { frozen: boolean; prisOre?: number; kostnadOre?: number; produktionstidMin?: number } {
  const status = deriveUppgiftStatus({
    orderStatus: wo.orderStatus as any,
    executionStatus: wo.executionStatus as any,
    invoiceQueueState: (wo.invoiceQueueState as any) ?? null,
    impossible: wo.impossibleReason != null,
  });
  const frozen = isUppgiftFrozen(status);
  if (frozen && (wo.frozenUnitPrice != null || wo.frozenUnitCost != null || wo.frozenUnitTime != null)) {
    return {
      frozen,
      prisOre: wo.frozenUnitPrice != null ? Math.round(wo.frozenUnitPrice) : undefined,
      kostnadOre: wo.frozenUnitCost != null ? Math.round(wo.frozenUnitCost) : undefined,
      produktionstidMin: wo.frozenUnitTime != null ? Math.round(wo.frozenUnitTime) : undefined,
    };
  }
  return {
    frozen,
    prisOre: line?.resolvedPrice ?? undefined,
    kostnadOre: line?.resolvedCost ?? undefined,
    produktionstidMin: line?.resolvedProductionMinutes ?? undefined,
  };
}

async function primaryWoLine(workOrderId: string) {
  const [line] = await db
    .select({
      articleId: workOrderLines.articleId,
      resolvedPrice: workOrderLines.resolvedPrice,
      resolvedCost: workOrderLines.resolvedCost,
      resolvedProductionMinutes: workOrderLines.resolvedProductionMinutes,
    })
    .from(workOrderLines)
    .where(and(eq(workOrderLines.workOrderId, workOrderId), sql`${workOrderLines.articleId} IS NOT NULL`))
    .orderBy(asc(workOrderLines.createdAt))
    .limit(1);
  return line ?? null;
}

async function primaryAssignmentArticle(assignmentId: string) {
  const [row] = await db
    .select({
      articleId: assignmentArticles.articleId,
      unitPrice: assignmentArticles.unitPrice,
      unitCost: assignmentArticles.unitCost,
      unitTime: assignmentArticles.unitTime,
    })
    .from(assignmentArticles)
    .where(eq(assignmentArticles.assignmentId, assignmentId))
    .orderBy(asc(assignmentArticles.sequenceOrder))
    .limit(1);
  return row ?? null;
}

async function main() {
  const report = {
    woPaketFilled: 0,
    woSnapshotAdded: 0,
    woWithoutArticle: 0,
    aPaketFilled: 0,
    aSnapshotAdded: 0,
    aWithoutArticle: 0,
    sourceAssignmentLinked: 0,
    sourceAssignmentAmbiguous: 0,
    errors: 0,
  };

  // ---- 1+2: work_orders ----
  const wos = await db
    .select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      objectId: workOrders.objectId,
      customerId: workOrders.customerId,
      orderStatus: workOrders.orderStatus,
      executionStatus: workOrders.executionStatus,
      invoiceQueueState: workOrders.invoiceQueueState,
      impossibleReason: workOrders.impossibleReason,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      frozenQuantity: workOrders.frozenQuantity,
      executionCode: workOrders.executionCode,
      frozenTimeCode: workOrders.frozenTimeCode,
      frozenInvoiceRecipientId: workOrders.frozenInvoiceRecipientId,
      frozenIsFixedPrice: workOrders.frozenIsFixedPrice,
      frozenUnitPrice: workOrders.frozenUnitPrice,
      frozenUnitCost: workOrders.frozenUnitCost,
      frozenUnitTime: workOrders.frozenUnitTime,
      uppgiftspaket: workOrders.uppgiftspaket,
    })
    .from(workOrders)
    .where(and(
      isNull(workOrders.deletedAt),
      // Sista villkoret: reparera snapshots som en tidigare backfill-körning
      // myntade (uppdateradAv='backfill') — endast dessa får skrivas om.
      sql`(${workOrders.uppgiftspaket} IS NULL
        OR ${workOrders.uppgiftspaket}->'artikel'->>'artikelId' IS NULL
        OR ${workOrders.uppgiftspaket}->>'uppdateradAv' = 'backfill')`,
    ));

  console.log(`work_orders att behandla: ${wos.length}`);
  for (const wo of wos) {
    try {
      const line = await primaryWoLine(wo.id);
      if (!line?.articleId) report.woWithoutArticle++;

      const vals = chooseWoSnapshotValues(wo, line);
      const artikelExtra: Partial<UppgiftspaketArtikel> | null = line?.articleId
        ? {
            artikelId: line.articleId,
            prisOre: vals.prisOre,
            kostnadOre: vals.kostnadOre,
            produktionstidMin: vals.produktionstidMin,
            debiteringsmodell:
              wo.frozenIsFixedPrice != null ? (wo.frozenIsFixedPrice ? "fast" : "lopande") : undefined,
          }
        : null;

      const prev = wo.uppgiftspaket as Uppgiftspaket | null;
      if (!prev) {
        const paket = await buildUppgiftspaket({
          tenantId: wo.tenantId,
          objectId: wo.objectId ?? null,
          tidsfonsterStart: wo.plannedWindowStart ?? wo.desiredDeliveryStart ?? null,
          tidsfonsterSlut: wo.plannedWindowEnd ?? wo.desiredDeliveryEnd ?? null,
          antal: wo.frozenQuantity ?? null,
          utforandekod: wo.executionCode ?? null,
          tidskod: wo.frozenTimeCode ?? null,
          kundId: wo.customerId ?? null,
          frystFakturamottagareId: wo.frozenInvoiceRecipientId ?? null,
          artikel: artikelExtra,
          uppdateradAv: "backfill",
        });
        if (!DRY_RUN) {
          await db.update(workOrders).set({ uppgiftspaket: paket })
            .where(and(eq(workOrders.id, wo.id), eq(workOrders.tenantId, wo.tenantId)));
        }
        report.woPaketFilled++;
      } else if (
        artikelExtra?.artikelId &&
        (prev.artikel?.artikelId == null || prev.uppdateradAv === "backfill")
      ) {
        const artikel: UppgiftspaketArtikel = {
          utforandekod: prev.artikel?.utforandekod ?? wo.executionCode ?? null,
          tidskod: prev.artikel?.tidskod ?? wo.frozenTimeCode ?? null,
          ...artikelExtra,
        };
        const paket: Uppgiftspaket = {
          ...prev,
          version: UPPGIFTSPAKET_VERSION,
          uppdateradVid: new Date().toISOString(),
          uppdateradAv: "backfill",
          artikel,
        };
        if (!DRY_RUN) {
          await db.update(workOrders).set({ uppgiftspaket: paket })
            .where(and(eq(workOrders.id, wo.id), eq(workOrders.tenantId, wo.tenantId)));
        }
        report.woSnapshotAdded++;
      }
    } catch (err) {
      report.errors++;
      console.error(`WO ${wo.id}:`, err);
    }
  }

  // ---- 1+2: assignments ----
  const as = await db
    .select({
      id: assignments.id,
      tenantId: assignments.tenantId,
      objectId: assignments.objectId,
      customerId: assignments.customerId,
      plannedWindowStart: assignments.plannedWindowStart,
      plannedWindowEnd: assignments.plannedWindowEnd,
      quantity: assignments.quantity,
      executionCode: assignments.executionCode,
      frozenTimeCode: assignments.frozenTimeCode,
      isFixedPrice: assignments.isFixedPrice,
      uppgiftspaket: assignments.uppgiftspaket,
    })
    .from(assignments)
    .where(and(
      isNull(assignments.deletedAt),
      sql`(${assignments.uppgiftspaket} IS NULL OR ${assignments.uppgiftspaket}->'artikel'->>'artikelId' IS NULL)`,
    ));

  console.log(`assignments att behandla: ${as.length}`);
  for (const a of as) {
    try {
      const art = await primaryAssignmentArticle(a.id);
      if (!art?.articleId) report.aWithoutArticle++;
      const artikelExtra: Partial<UppgiftspaketArtikel> | null = art?.articleId
        ? {
            artikelId: art.articleId,
            prisOre: art.unitPrice ?? undefined,
            kostnadOre: art.unitCost ?? undefined,
            produktionstidMin: art.unitTime ?? undefined,
            debiteringsmodell: a.isFixedPrice != null ? (a.isFixedPrice ? "fast" : "lopande") : undefined,
          }
        : a.isFixedPrice != null
          ? { debiteringsmodell: a.isFixedPrice ? "fast" : "lopande" }
          : null;

      const prev = a.uppgiftspaket as Uppgiftspaket | null;
      if (!prev) {
        const paket = await buildUppgiftspaket({
          tenantId: a.tenantId,
          objectId: a.objectId ?? null,
          tidsfonsterStart: a.plannedWindowStart ?? null,
          tidsfonsterSlut: a.plannedWindowEnd ?? null,
          antal: a.quantity ?? null,
          utforandekod: a.executionCode ?? null,
          tidskod: a.frozenTimeCode ?? null,
          kundId: a.customerId ?? null,
          artikel: artikelExtra,
          uppdateradAv: "backfill",
        });
        if (!DRY_RUN) {
          await db.update(assignments).set({ uppgiftspaket: paket })
            .where(and(eq(assignments.id, a.id), eq(assignments.tenantId, a.tenantId)));
        }
        report.aPaketFilled++;
      } else if (artikelExtra?.artikelId) {
        const artikel: UppgiftspaketArtikel = {
          utforandekod: prev.artikel?.utforandekod ?? a.executionCode ?? null,
          tidskod: prev.artikel?.tidskod ?? a.frozenTimeCode ?? null,
          ...artikelExtra,
        };
        const paket: Uppgiftspaket = {
          ...prev,
          version: UPPGIFTSPAKET_VERSION,
          uppdateradVid: new Date().toISOString(),
          uppdateradAv: "backfill",
          artikel,
        };
        if (!DRY_RUN) {
          await db.update(assignments).set({ uppgiftspaket: paket })
            .where(and(eq(assignments.id, a.id), eq(assignments.tenantId, a.tenantId)));
        }
        report.aSnapshotAdded++;
      }
    } catch (err) {
      report.errors++;
      console.error(`Assignment ${a.id}:`, err);
    }
  }

  // ---- 3: sourceAssignmentId (konservativ, endast entydiga matchningar) ----
  const orphanWos = await db.execute(sql`
    SELECT wo.id, wo.tenant_id, wo.order_concept_id, wo.object_id, wo.customer_id
    FROM work_orders wo
    WHERE wo.invoice_source_type = 'assignment'
      AND wo.source_assignment_id IS NULL
      AND wo.deleted_at IS NULL
  `);
  for (const wo of orphanWos.rows as Array<Record<string, string | null>>) {
    const candidates = await db.execute(sql`
      SELECT a.id FROM assignments a
      WHERE a.tenant_id = ${wo.tenant_id}
        AND a.deleted_at IS NULL
        AND a.order_concept_id IS NOT DISTINCT FROM ${wo.order_concept_id}
        AND a.object_id IS NOT DISTINCT FROM ${wo.object_id}
        AND a.customer_id IS NOT DISTINCT FROM ${wo.customer_id}
        AND NOT EXISTS (
          SELECT 1 FROM work_orders w2
          WHERE w2.tenant_id = a.tenant_id AND w2.source_assignment_id = a.id
        )
    `);
    if (candidates.rows.length === 1) {
      const assignmentId = (candidates.rows[0] as { id: string }).id;
      if (!DRY_RUN) {
        await db.execute(sql`
          UPDATE work_orders SET source_assignment_id = ${assignmentId}
          WHERE id = ${wo.id} AND tenant_id = ${wo.tenant_id} AND source_assignment_id IS NULL
        `);
      }
      report.sourceAssignmentLinked++;
    } else {
      report.sourceAssignmentAmbiguous++;
    }
  }

  console.log(`\n=== Backfill-rapport${DRY_RUN ? " (DRY RUN)" : ""} ===`);
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

// Kör bara när skriptet exekveras direkt (chooseWoSnapshotValues importeras av tester).
if (process.argv[1]?.includes("backfill-uppgiftspaket")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
