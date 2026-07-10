---
name: Generell uppgiftseditor (personal_task_schedules)
description: Hur den fria artikelvalseditorn för personliga block/tid ("kalendereditor") kopplar artikelval till produktion vs personal_tasks, och hur återkommande scheman modelleras.
---

`resolvePersonalTaskArticleFields` (server/planning/weeklyPlanEngine.ts) tar valfri `explicitArticleId`; endast artiklar med `articleType` `internal_time`/`restid` och satt `timeCodeKey` är giltiga för personal_tasks — produktionsartiklar (`tjanst`) routas istället till `work_orders` via `/api/work-orders/with-lines` (samma pipeline som andra produktionsuppgifter), aldrig personal_tasks.

**Why:** produktion och icke-produktionstid har olika downstream-pipelines (fakturering/kostnad); att blanda dem i samma tabell skulle bryta befintlig kostnads-/fakturalogik.

**How to apply:** klienten skickar bara `selectedArticleId` (aldrig `articleId`/`cachedCostOre` direkt) — servern re-härleder båda via `resolvePersonalTaskArticleFields` och kör permission-check (`isRoleAllowedForTimeCode`) på den *resolvda* kategorin, inte klientens payload (anti-spoofing).

Återkommande scheman (`personal_task_schedules`) har `recurrenceType` (`daily`/`weekly`/legacy), `daysOfWeek`, `startDate`/`endDate`, `articleId`; `materializeSchedulesForPlan` filtrerar occurrences på recurrenceType+daysOfWeek+datumintervall innan den skapar personal_tasks-rader för planen.
