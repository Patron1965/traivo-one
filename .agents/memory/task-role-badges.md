---
name: Systemuppgift roll-badges
description: Delad härledning + badge för systemskapade uppgiftsroller (hämtning/leverans/retur/resa/avisering/admin/logistik/avrop).
---

# Systemuppgift roll-badges

`client/src/components/TaskRoleBadge.tsx` är ENDA källan för hur en uppgifts
systemroll härleds och presenteras (ikon + svensk etikett + tema-token-klass).
Återanvänds i JobCard, PlannerDialogs, OrderStockPage (grovplanering) och
SimpleFieldApp (Traivo Go). Lägg ALDRIG tillbaka ad-hoc "Plockuppgift"/admin-
badges med hårdkodade färger — använd `<TaskRoleBadge task={...} />`.

## Härledningsprecedens (getTaskRole)
logisticsRole (pickup/deliver/return) → returnToWarehouse → taskCategory
(logistics/admin) → avrop (invoiceSourceType==="assignment" || creationMethod===
"assignment_invoice" || sourceAssignmentId) → text-hint (orderType/title för
resa/avisering) → legacy fallback (creationMethod==="automatic" → pickup).
EN roll per uppgift = den mest informativa.

**Why:** tidigare visades bara en grov "Plockuppgift"-badge på
`creationMethod==="automatic"`; övriga systemroller var osynliga.

## Datamodell-fällor
- `assignments` bär BARA `logisticsRole` — INTE `taskCategory`/`locationRequirement`
  (de kolumnerna finns på `orderConceptArticles` + `work_orders`, ej assignments).
  Projektionen (assignment-invoice-materializer woInsert) kan därför bara kopiera
  `logisticsRole` från uppgiften.
- Admin/logistik-artiklar (`taskCategory!=="field"`) materialiseras direkt till
  `work_orders` (fortnoxRoutes ~2779, objectId null), förbi assignment-projektionen.
- resa/avisering finns INTE som egna WO-kolumner idag; badgen härleder dem via
  text-hint (orderType/title) — bäst-effort, kan sakna träff.

## Kvarvarande synlighets-gap (ej löst här)
Schema-/abonnemangs-assignments och icke-tilldelade call_off-pickups som bor kvar
i `assignments` projiceras inte alltid till `work_orders` → syns då varken i
planner eller fält (alla läser bara work_orders). Full assignment→work_order-
projektion för alla metoder är en större arkitekturändring (se memory
`concept-calloff-invisible-to-field.md`).
