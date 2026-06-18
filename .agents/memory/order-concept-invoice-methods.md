---
name: Orderkoncept faktureringsmetoder (avrop/schema/abonnemang)
description: Hur de tre faktureringsmetoderna skiljs åt, var PATCH-handlern bor, och hur abonnemangs-/schema-fakturering körs automatiskt utan dubbelkörning.
---

# Orderkoncept: tre faktureringsmetoder

## Kanonisk metod-resolver
`invoiceModel` (`call_off` / `schedule` / `subscription`) är den kanoniska källan för ett orderkoncepts faktureringsmetod. Legacy-kolumnen `scenario` (`avrop` / `schema` / `abonnemang`) behålls (expand-contract) och write-through:as från wizarden. **All exekverings-/preview-/validerings-logik ska gå via `getOrderConceptMethod()` i `shared/order-concept-method.ts`** (föredrar invoiceModel, faller tillbaka på scenario, default `call_off`) — annars behandlas inte de tre metoderna distinkt för äldre koncept.

**Why:** Innan detta körde Avrop och Schema samma engångs-expansion i `/execute` (identiskt beteende). Distinktionen blev bara skenbar i preview.

**How to apply:** I `/execute`, `/preview`, `/run-rolling`, `/detect-changes` och validate-routen — gren alltid på `getOrderConceptMethod(concept)`, läs aldrig `scenario`/`invoiceModel` direkt.

## PATCH-handlern bor i fortnoxRoutes, inte orderConceptRoutes
`PATCH /api/order-concepts/:id` registreras i `server/routes/fortnoxRoutes.ts` (inte i `orderConceptRoutes.ts`, som äger de flesta andra koncept-routes). Timestamp-kolumner (`deliveryStart`, `subscriptionAdjustmentDate`, `intervalStartDate`, `intervalEndDate`) måste date-coerce:as från ISO-sträng → `Date` i den handlern innan `updateOrderConcept`, annars vägrar drizzle `.set()` på timestamp-kolumner.

## Manuell `/execute` aktiverar bara — auto-runner är ENDA väg till abonnemangsfaktura
`/execute` för subscription "aktiverar" bara abonnemanget: validerar `monthlyFee`, beräknar `nextRunDate` (`computeSubscriptionNextRun`, respekterar `deliveryStart` + `billingFrequency`/`invoicePeriod`) och returnerar summor. Den skapar **noll** assignments/work_orders och **ingen** `customer_invoice` — och ska förbli så (manuell execute måste vara oförändrad).

Den faktiska faktureringen sker i en env-gateadad bakgrundsschemaläggare (`server/services/order-concept-auto-runner.ts`, gate `ORDER_CONCEPT_AUTORUN_ENABLED`). Den plockar koncept där `status=active` + `nextRunDate <= now` och grenar på `getOrderConceptMethod`: subscription skapar en `customer_invoice` per fakturakund (`state="pending"`), schema auto-expanderar via samma `generateScheduleAssignments` som `/execute`, avrop (call_off) körs ALDRIG automatiskt.

**Why:** Abonnemangs-/schema-fakturering måste rulla utan manuell handpåläggning, men subscription-fakturalogiken får INTE ligga i den delade `/execute`-grenen — då skulle ett manuellt klick också börja skapa fakturor (regression). Därför lever invoice-creation enbart i auto-runnern.

**How to apply — dubbelkörning & atomicitet (kritiskt):** En process-lokal flagga räcker INTE (samtidig manuell trigger, scheduler-överlapp, multi-instans). Varje koncept måste claimas med rad-lås: `SELECT ... FOR UPDATE` på konceptraden inuti en transaktion, re-validera `nextRunDate <= now`, och avancera `nextRunDate` — förloraren ser det framflyttade datumet och hoppar över. Subscription: lägg claim + alla fakturainsert + nextRunDate-avancering i SAMMA transaktion (annars kan en delvis lyckad körning lämna fakturor utan avancerat datum → dubbelfakturering nästa tick). Schema: claim+avancera först i en tx, expandera sen (idempotent); revert nextRunDate om expansionen är felkonfigurerad. **Försenade perioder måste catch-up:as** — iterera och fakturera VARJE missad period en gång (stega `nextRunDate` ett period-steg i taget med guard mot runaway), inte bara en period med ett framhoppat datum. Manuell verifiering: `POST /api/order-concepts/auto-run` (requireAdmin, tenant-scoped). Subscription `customer_invoice` har inga work_orders ⇒ samlingsfaktura-consolidation rör dem inte.
