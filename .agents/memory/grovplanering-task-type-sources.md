---
name: Grovplanering uppgiftstyp-källor
description: Uppgiftstyp-registret (task_types) driver filter, grid-normalisering och admin-CRUD; heuristiken är bara fallback.
---

# Grovplanering: uppgiftstyp — registret är auktoritativt

Filtret listar typer från per-tenant-registret `task_types` via `GET /api/reference/task-types`
(returnerar ENDAST aktiva; hårdkodad `TASK_TYPE_KEYS`-fallback gäller ENBART tenants helt utan
rader — har tenanten rader men alla inaktiva returneras `[]`, defaults får aldrig återinföras).
Admin-CRUD: `/api/task-types` (seed-on-read, POST requireAdmin, key immutabel, DELETE = isActive=false,
aldrig hard-delete). UI: `/task-types` (TaskTypesPage).

Grid/export-normalisering går via `loadTaskTypeMatcher(tenantId)` (`server/grovplanering-grid.ts`):
exakt case-insensitive match på registrets key/label (inkl. INAKTIVA — historiska rader behåller
klassning+etikett), därefter fallback till heuristiken `normalizeTaskType` för fritext-`orderType`.

**Why:** Tidigare var filter (register) och grid (heuristik) osynkade; registret är nu enda källan
men fritext-orderType kräver heuristik-fallback, och inaktiverade typer får inte tappa etiketter.

**How to apply:**
- Ny konsument av uppgiftstyp: normalisera via `loadTaskTypeMatcher`, aldrig direkt `normalizeTaskType`.
- Rör du referens-endpointen: skilj "inga rader" (seed/fallback OK) från "alla inaktiva" (returnera []).
- Persisterat filter (`localStorage grovplanering.filter.v1`) kan bära nycklar utanför registret —
  de appliceras men renderas inte som checkbox; "Rensa filter" rensar dem.
