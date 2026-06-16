---
name: Orderkoncept faktureringsmetoder (avrop/schema/abonnemang)
description: Hur de tre faktureringsmetoderna skiljs åt, var PATCH-handlern bor, och den saknade abonnemangs-billing-pipelinen.
---

# Orderkoncept: tre faktureringsmetoder

## Kanonisk metod-resolver
`invoiceModel` (`call_off` / `schedule` / `subscription`) är den kanoniska källan för ett orderkoncepts faktureringsmetod. Legacy-kolumnen `scenario` (`avrop` / `schema` / `abonnemang`) behålls (expand-contract) och write-through:as från wizarden. **All exekverings-/preview-/validerings-logik ska gå via `getOrderConceptMethod()` i `shared/order-concept-method.ts`** (föredrar invoiceModel, faller tillbaka på scenario, default `call_off`) — annars behandlas inte de tre metoderna distinkt för äldre koncept.

**Why:** Innan detta körde Avrop och Schema samma engångs-expansion i `/execute` (identiskt beteende). Distinktionen blev bara skenbar i preview.

**How to apply:** I `/execute`, `/preview`, `/run-rolling`, `/detect-changes` och validate-routen — gren alltid på `getOrderConceptMethod(concept)`, läs aldrig `scenario`/`invoiceModel` direkt.

## PATCH-handlern bor i fortnoxRoutes, inte orderConceptRoutes
`PATCH /api/order-concepts/:id` registreras i `server/routes/fortnoxRoutes.ts` (inte i `orderConceptRoutes.ts`, som äger de flesta andra koncept-routes). Timestamp-kolumner (`deliveryStart`, `subscriptionAdjustmentDate`, `intervalStartDate`, `intervalEndDate`) måste date-coerce:as från ISO-sträng → `Date` i den handlern innan `updateOrderConcept`, annars vägrar drizzle `.set()` på timestamp-kolumner.

## Abonnemang har INGEN billing-scheduler (viktig lucka)
`/execute` för subscription "aktiverar" bara abonnemanget: validerar `monthlyFee`, beräknar `nextRunDate` (`computeSubscriptionNextRun`, respekterar `deliveryStart` + `billingFrequency`/`invoicePeriod`) och returnerar summor. Den skapar **noll** assignments/work_orders och **ingen** `customer_invoice`.

`nextRunDate` skrivs men konsumeras aldrig av någon cron. Samlingsfaktura-flödet (`invoice-consolidation-scheduler` / `invoice-consolidation.ts`) jobbar enbart på `work_orders.invoiceQueueState/invoiceHeldUntil` — och abonnemang skapar inga work_orders. Det finns alltså **ingen väg** från ett aktiverat abonnemang till en faktura idag.

**Why:** Task #934 gjorde de tre metoderna distinkta + exponerade abonnemangskonfig, men att faktiskt materialisera abonnemangsfakturor (ny scheduler som läser nextRunDate → skapar customer_invoice → matar consolidation/Fortnox) är ett separat delsystem som inte fanns och låg utanför taskens out-of-scope ("rör ej consolidation-schemaläggaren").

**How to apply:** Om någon rapporterar "abonnemang fakturerar inte" — det är förväntat tills billing-pipelinen byggs. Bygg en scheduler som plockar koncept där `nextRunDate <= now` och `method === subscription`, skapar fakturaartefakt och avancerar nextRunDate.
