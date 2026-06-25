---
name: Koncept-avrop osynligt för fält/planner
description: call_off-orderkoncept skapar assignments som ingen fält-/planner-/completion-yta läser; bron till faktura kräver assignment→work_order-projektion.
---

# Koncept-avrop (call_off) är ett planerings-only-artefakt

call_off (avrop) order-concept-expansion (`POST /api/order-concepts/:id/execute`,
fortnoxRoutes) skapar rader i **`assignments`**. Men HELA exekverings-/planerings-/
fält-ytan läser ENBART **`work_orders`**:

- `GET /api/mobile/orders` → `storage.getWorkOrders`
- `PATCH /api/mobile/orders/:id/status` (klarmarkering) → `getWorkOrder`/`updateWorkOrder`
- alla `/api/mobile/tasks/:id/*` (metadata/quantity) → `getWorkOrder`
- WeekPlanner / `plannerRoutes` → `getWorkOrders`

Ingen mobil-route läser `assignments`. Det finns **ingen handler som slutför en
assignment** (sätter `assignments.completedAt`/status completed) — `updateAssignment`
anropas bara från generisk PATCH `/api/assignments/:id` (planner-edit), `/assign`,
`/acknowledge-dependency`. De work_orders fältet faktiskt slutför föds ur
Modus-import/manuellt/logistik/mobil-retur och saknar `orderConceptId` (därför
behövde #1124 ADDERA `orderConceptId` på work_orders).

**Konsekvens:** "utförd uppgift" (completed call_off assignment) är idag ett
**onåbart event** — assignments syns aldrig för fältet och slutförs aldrig.

**Why:** upptäckt under #1124 (faktura från utförd uppgift). En WO-baserad
faktura-pipeline kan därför INTE triggas "vid assignment-completion" direkt.

**How to apply:** varje feature som behöver att koncept-arbete exekveras/slutförs/
faktureras måste **projicera assignment → work_order** (skapa/uppdatera EN länkad WO
vid assign/schemaläggning via `sourceAssignmentId`, finalisera vid WO-completion).
Anta aldrig att assignments slutförs av sig själva.
