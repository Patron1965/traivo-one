---
name: Fortnox kostnadsställe/projekt-härledning + utförar-fångst
description: Var kostnadsställe (fordon/utrustning) + projekt (personer/team) fångas vid kvittering och härleds per fakturarad till Fortnox.
---

# Fortnox CostCenter (kostnadsställe) + Project (projekt) — härledning & fångst

Kanonisk härledningskedja bor i `server/services/fortnox-code-derivation.ts` (ENDA källan — återinför aldrig ad-hoc-logik):
- **CostCenter:** completedVehicle → completedEquipment → deltagar-resurs → tilldelad resurs → **team** (sista fallback).
- **Project:** deltagar-resurs → tilldelad resurs → **team** (sista fallback).
- Allt tenant-guardat: refererade fordon/utrustning/resurs/team som tillhör annan tenant ignoreras tyst (=> cross-tenant completed*-id är ofarligt, härleds bort).

**Två completion-vägar matar samma fält** (`work_orders.completedVehicleId/completedEquipmentId/completedParticipantIds`):
1. Webb-fältappen `SimpleFieldApp.tsx` kvitterar via **standard** `PATCH /api/work-orders/:id` (passthrough `...updateData` → `storage.updateWorkOrder`). Fälten är därför INTE namngivna i `workOrderRoutes.ts` — grep efter `completedEquipmentId` där ger inget träff fast de persisteras. Lät mig (och kommer luras igen) tro att fångsten saknades.
2. `PATCH /api/mobile/orders/:id/status` (`server/routes/mobile/orders.ts`) sätter samma tre fält explicit.

**Export tillämpar koderna PER RAD** (inte bara fakturahuvud): enskild WO härleder på **route-nivå** (`fortnoxRoutes.ts` resolvar costCenter/project med derive-fallback, sparar på export-recordet → `fortnox-client.ts` läser `invoiceExport.costCenter/project` per `InvoiceRow`). Konsoliderad faktura härleder per WO i `fortnox-client.ts`.

**UI för att sätta koderna:** `ExecutorRegisterPage.tsx` har inline `CodeEditor` (PATCH `/api/teams|resources|vehicles|equipment/:id`) för costCenter/projectCode. Fordon/utrustning saknar projekt (renderas "ej tillämpligt").

**Känd icke-blockerande lucka:** `PATCH /api/work-orders/:id` validerar tenant på `resourceId/teamId/customerId/objectId/clusterId` men INTE på `completedVehicleId/completedEquipmentId/completedParticipantIds` (ofarligt p.g.a. derive-tenant-guard, men defense-in-depth saknas).
