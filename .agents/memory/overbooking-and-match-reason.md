---
name: Överbokning-overlay & matchningsorsak
description: Var "överbokad" lever (planerar-overlay, ej status) och var koncept-matchningsorsak fångas/persistas.
---

# Överbokning = planerar-härledd overlay på resurs-dag-nivå

Överbokning (bokad tid > kapacitet) modelleras ENBART som en klient-härledd overlay i
WeekPlanner (`overbookedResourceDays` i `usePlannerData.ts`, härledd ur
`resourceDayJobMap.hours` mot `HOURS_IN_DAY`). Den läggs på berörda uppgiftskort via
`jobConflicts` (→ `JobCard.hasConflict`) och stylas med theme-tokens.

**Why:** Överbokning är en egenskap hos en resurs-dag (flyttar man en annan uppgift ändras
den), inte en enskild uppgifts inneboende livscykel-status. Den får ALDRIG in i den låsta
`deriveUppgiftStatus()` (shared/uppgift-contract.ts) — det skulle krocka med de riktiga
statusarna. Kontraktsraden "Överbokad" är medvetet `live-compute`, utanför status-kedjan.

**How to apply:** Nya överboknings-ytor ska läsa `overbookedResourceDays`/
`isResourceDayOverbooked` — inför aldrig ett status-värde för det. Styling via
`getOverbookingWarning()` i `client/src/lib/status-colors.ts` (warning-token, ej destructive/röd).

# Matchningsorsak (varför objekt hakades på koncept) fångas vid expansion

`match_reason` (nullable text) finns på BÅDE `work_orders` och `assignments` (koncept-tasks
bor i assignments — se concept-expansion-target-table). Fångas vid koncept-expansion/execute
i `fortnoxRoutes.ts` via `buildMatchReasonsForObjects()` (order-concept-targeting.ts), som
återanvänder `matchesFilter`/villkors-resolvern. Historiska tasks utan orsak → visas "—".

**How to apply:** Alla nya koncept→task-skrivvägar (createAssignment/stock-pickup/pre-task)
måste stämpla `matchReason` från samma per-objekt-Map, annars blir orsaken tyst NULL.
