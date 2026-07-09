// Bakgrundsjob för metadata-ändringar — task #552 krav (D).
// När metadata uppdateras på ett objekt kan det påverka:
//  1. Priser/totaler på aktiva arbetsordrar (om metadata används i prisregler)
//  2. Framtida ogjorda uppgifters antal (artiklar med quantityMode='matches_field')
//  3. Dynamisk kluster-tillhörighet (avvecklad, se nedan)
//
//  4. Objektets ruttbara geo-kolumner (enkelriktad cache, geo-field-sync)
//  5. Uppgiftspaketet (Task #1215): full arbetskopie-uppdatering + spegelsynk
//     för öppna/framtida uppgifter i BÅDA lagren (work_orders + assignments)
//
// Designval: fire-and-forget, debounced per tenant. Vi blockerar inte
// metadata-skrivningen, men loggar misslyckanden. Större batchar (CSV-import)
// kan kalla `enqueueMetadataChange` med `force: true` för att alltid köra
// efterbehandling. Bulk-import täcks också: batch-writern
// (writeObjectImportMetadataBatch i metadata-queries.ts) enqueue:ar hit per
// berört objekt, så både enskilda redigeringar OCH massimport träffar
// efterbehandlingen ovan.
import { db } from "../db";
import { workOrders, assignments } from "@shared/schema";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { storage } from "../storage";
import { usesQuantityMetadata, usesQuantityFormula } from "../article-quantity";

// Alla icke-finaliserade WO-statusar — exkluderar bara invoiced/cancelled/completed.
// Recalc får alltså träffa även in_progress/ongoing/on_hold etc. så att pågående
// arbete får uppdaterade priser/totaler om metadata påverkar prisregler.
const FINALIZED_STATUSES = ["invoiced", "cancelled", "completed"];

// Finaliserade assignment-statusar som ALDRIG rörs av antals-propagering (frysta fakta).
const ASSIGNMENT_FINALIZED_STATUSES = ["completed", "cancelled"];

// Å1 / kriterium 7 / E8: dynamisk uppdatering av framtida ogjorda uppgifters antal.
// På som standard; sätt DYNAMIC_TASK_PROPAGATION_ENABLED=false för att stänga av.
const DYNAMIC_TASK_PROPAGATION_ENABLED =
  process.env.DYNAMIC_TASK_PROPAGATION_ENABLED !== "false";

type Pending = { tenantId: string; objectIds: Set<string>; timer: NodeJS.Timeout | null };
const pendingByTenant = new Map<string, Pending>();
const DEBOUNCE_MS = 4000;

export function enqueueMetadataChange(
  tenantId: string,
  objectId: string,
  opts: { force?: boolean } = {},
): void {
  let p = pendingByTenant.get(tenantId);
  if (!p) {
    p = { tenantId, objectIds: new Set(), timer: null };
    pendingByTenant.set(tenantId, p);
  }
  p.objectIds.add(objectId);
  if (p.timer) clearTimeout(p.timer);
  const delay = opts.force ? 0 : DEBOUNCE_MS;
  p.timer = setTimeout(() => {
    const objectIds = Array.from(p!.objectIds);
    pendingByTenant.delete(tenantId);
    runMetadataChangeJob(tenantId, objectIds).catch(err => {
      console.error(`[metadata-change-jobs] failed for tenant ${tenantId}:`, err);
    });
  }, delay);
}

async function runMetadataChangeJob(tenantId: string, objectIds: string[]): Promise<void> {
  const start = Date.now();

  // 1. Räkna om totaler på påverkade aktiva arbetsordrar
  let recalcCount = 0;
  try {
    const rows = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, objectIds),
        isNull(workOrders.deletedAt),
        notInArray(workOrders.status, FINALIZED_STATUSES),
      ));
    const ids = rows.map(r => r.id);
    if (ids.length > 0 && typeof (storage as any).recalculateWorkOrderTotalsBulk === "function") {
      const r = await (storage as any).recalculateWorkOrderTotalsBulk(ids);
      recalcCount = r?.recalculated ?? ids.length;
    }
  } catch (err) {
    console.error(`[metadata-change-jobs] recalc failed:`, err);
  }

  // 2. Dynamiska kluster är avvecklade (Task #856) — automatisk om-tilldelning
  //    av objects.clusterId via regler är avstängd. clusterId bevaras i DB
  //    bakåtkompatibelt men utvärderas inte längre.
  const clusterAssigned = 0;

  // 3. Dynamisk omräkning av framtida ogjorda uppgifters antal (Å1 / E8).
  let taskQtyUpdated = 0;
  if (DYNAMIC_TASK_PROPAGATION_ENABLED) {
    try {
      taskQtyUpdated = await propagateTaskQuantities(tenantId, objectIds);
    } catch (err) {
      console.error(`[metadata-change-jobs] task-qty propagation failed:`, err);
    }
  }

  // 4. Kanonisk geomodell (T004): synka de systemlåsta geo-metadatafälten ned i
  //    objektets ruttbara kolumner (enkelriktad cache). cascade=true eftersom en
  //    förälders adress-ändring ändrar barnens UPPLÖSTA värde. No-op när objektet
  //    saknar geo-metadatavärden (t.ex. adress bara i kolumner) — säkert i alla miljöer.
  let geoSynced = 0;
  try {
    const { syncObjectGeoFields } = await import("./geo-field-sync");
    for (const objectId of objectIds) {
      const results = await syncObjectGeoFields(tenantId, objectId, { cascade: true });
      geoSynced += results.filter((r) => r.columnsUpdated.length > 0 || r.geocodeTriggered).length;
    }
  } catch (err) {
    console.error(`[metadata-change-jobs] geo-field sync failed:`, err);
  }

  // 5. Uppgiftspaketet (Task #1215): full uppdatering av arbetskopian + tekniska
  //    spegelkolumner för alla ÖPPNA/FRAMTIDA uppgifter kopplade till de ändrade
  //    objekten (inkl. subträd — barn ärver metadata). Körs EFTER geo-synken (steg 4)
  //    så att objektets ruttbara kolumn-cache är färsk när paketet byggs. Frysta
  //    uppgifter (deriveUppgiftStatus + isUppgiftFrozen) röres aldrig.
  let paketWo = 0;
  let paketAssignments = 0;
  if (DYNAMIC_TASK_PROPAGATION_ENABLED) {
    try {
      const { propagateUppgiftspaket } = await import("./uppgiftspaket");
      const r = await propagateUppgiftspaket(tenantId, objectIds);
      paketWo = r.workOrdersUpdated;
      paketAssignments = r.assignmentsUpdated;
    } catch (err) {
      console.error(`[metadata-change-jobs] uppgiftspaket propagation failed:`, err);
    }
  }

  const ms = Date.now() - start;
  console.log(`[metadata-change-jobs] tenant=${tenantId} objects=${objectIds.length} recalc=${recalcCount} clusterDelta=${clusterAssigned} taskQty=${taskQtyUpdated} geoSynced=${geoSynced} paketWo=${paketWo} paketAssignments=${paketAssignments} ms=${ms}`);
}

// Räknar om antal + cachade totaler för icke-finaliserade assignments vars artikel
// använder ett metadata-drivet quantityMode (per_styck/matches_field), när objektets metadatavärde ändrats.
// Speglar expansionens kvantitetslogik (server/routes/fortnoxRoutes.ts): nytt antal
// via computeArticleQuantity med objektets aktuella (ärvningsmedvetna) metadatavärde,
// och totaler skalas om från redan lagrade enhetspriser/-tider. Completed/cancelled
// rörs aldrig. Returnerar antal uppdaterade assignments.
async function propagateTaskQuantities(tenantId: string, objectIds: string[]): Promise<number> {
  if (objectIds.length === 0) return 0;

  const rows = await db
    .select({
      id: assignments.id,
      objectId: assignments.objectId,
      quantity: assignments.quantity,
    })
    .from(assignments)
    .where(and(
      eq(assignments.tenantId, tenantId),
      inArray(assignments.objectId, objectIds),
      isNull(assignments.deletedAt),
      notInArray(assignments.status, ASSIGNMENT_FINALIZED_STATUSES),
    ));
  if (rows.length === 0) return 0;

  // Ärvningsmedveten kvantitetsresolver — dynamisk import för att undvika cirkulärt
  // toppimport (resolvern -> metadata-queries, som i sin tur laddar denna modul lazy).
  const { resolveEffectiveArticleQuantity } = await import("../article-quantity-resolver");

  let updatedCount = 0;

  for (const a of rows) {
    const aArticles = await storage.getAssignmentArticles(a.id);
    if (aArticles.length === 0) continue;

    let anyChanged = false;
    let sumValue = 0;
    let sumCost = 0;
    let sumTime = 0;
    let primaryQty: number | null = null;

    for (const aa of aArticles) {
      const article = await storage.getArticle(aa.articleId);
      let qty = aa.quantity ?? 1;

      if (
        article &&
        ((usesQuantityMetadata(article.quantityMode) && article.quantityMetadataField) ||
          (usesQuantityFormula(article.quantityMode) && article.quantityFormula))
      ) {
        const newQty = await resolveEffectiveArticleQuantity({
          tenantId,
          article,
          baseQuantity: 1,
          objectId: a.objectId,
        });
        if (newQty !== (aa.quantity ?? 1)) {
          const unitPrice = aa.unitPrice ?? 0;
          const unitCost = aa.unitCost ?? 0;
          const unitTime = aa.unitTime ?? 0;
          await storage.updateAssignmentArticle(aa.id, a.id, {
            quantity: newQty,
            totalPrice: unitPrice * newQty,
            totalCost: unitCost * newQty,
            totalTime: unitTime * newQty,
          });
          anyChanged = true;
          qty = newQty;
          primaryQty = newQty;
        }
      }

      sumValue += (aa.unitPrice ?? 0) * qty;
      sumCost += (aa.unitCost ?? 0) * qty;
      sumTime += (aa.unitTime ?? 0) * qty;
    }

    if (anyChanged) {
      await storage.updateAssignment(a.id, tenantId, {
        quantity: primaryQty ?? a.quantity ?? 1,
        cachedValue: sumValue,
        cachedCost: sumCost,
        estimatedDuration: sumTime,
      });
      updatedCount++;
      console.log(`[metadata-change-jobs] task-qty updated assignment=${a.id} object=${a.objectId} newQty=${primaryQty}`);
    }
  }

  return updatedCount;
}

// Test-helper för synkron körning (används endast i utveckling/test).
export async function runMetadataChangeJobNow(tenantId: string, objectIds: string[]): Promise<void> {
  return runMetadataChangeJob(tenantId, objectIds);
}
