---
name: Uppgiftsnav panelfilter & filterbibliotek
description: Grovplaneringens huvudfilterpanel — valbart datumfält, tidskod/kund/resurs-filter och sparade filter via saved_filters-scope "uppgiftsnav-panel".
---

# Uppgiftsnavets panelfilter

**Regel:** Grovplaneringens filterbibliotek återanvänder den generiska `saved_filters`-infran (Task #1240-infra) med scope `"uppgiftsnav-panel"` — `definition` = klientens FilterState (INTE filtermotorns villkorsträd som scope `"uppgiftsnav"` använder). Skapa ALDRIG en separat tabell för sparade panel-filter.

**Why:** En parallell `planner_saved_filters`-tabell byggdes och revs samma session — den dubblerade befintlig CRUD, roll-scoping och delnings-logik.

**How to apply:**
- Nya scopes läggs i `savedFilterScopeValues` (shared/filter-engine.ts); servern validerar bara scope, definition är fri jsonb.
- Klienten MÅSTE runtime-normalisera definition vid apply (typer/enums kan vara stale) och får bara PATCH/DELETE egna rader (`row.userId === user.id`) — delade filter från andra ⇒ POST egen rad.
- Grid-periodfiltret har valbart datumfält (`dateField`: onskad|skapad|planerad|utford, default onskad = överlapp mot önskad leveranstid; planerad = överlapp mot planned_window; skapad/utford = punktdatum). Nya GridFilters-fält: timeCodes (frozen_time_code), customerIds, resourceIds.
- Alla grid-läsvägar (grid/export/group-rows) delar parseGridQuery — nya filterparametrar läggs där, inte per route.
