---
name: Grovplanering uppgiftstyp-källor
description: Två oberoende källor för "uppgiftstyp" i grovplaneringen (registret för filtret vs normalize för grid-raderna) kan divergera.
---

# Grovplanering: uppgiftstyp har två oberoende källor

Filtret i grovplaneringen listar uppgiftstyper från det per-tenant **registret** `task_types`
(via `GET /api/reference/task-types`; backend faller tillbaka till de 8 standardtyperna i
`TASK_TYPE_KEYS`/`TASK_TYPE_LABELS` ENBART för oseedade tenants). Klienten har INGEN hårdkodad
fallback längre — `taskTypeOptions = taskTypeData ?? []` i `RoughFilterPanel.tsx`.

Grid-radernas `taskType` härleds däremot SEPARAT via `normalizeTaskType(orderType)`
(`server/grovplanering-grid.ts`) som mappar fritext-`orderType` till de 8 kontrollerade
nycklarna + `"ovrigt"`.

**Why:** De två källorna är inte synkroniserade. Konsekvenser att vara medveten om:
- En registertyp vars nyckel aldrig produceras av `normalizeTaskType` matchar inga grid-rader.
- Grid-rader som blir `"ovrigt"` får aldrig en filter-checkbox (om "ovrigt" inte ligger i registret).
- Persisterat filter (`localStorage` `grovplanering.filter.v1`) kan innehålla nycklar som inte
  längre finns i registret → de appliceras men renderas inte som checkbox; "Rensa filter" rensar dem.

**How to apply:** Rör du filtret eller registret — håll registrets nycklar i linje med
`normalizeTaskType`-utdata, eller inför en explicit mappning. Sanera helst persisterade
`taskTypes` mot registret efter att `/api/reference/task-types` laddats.
