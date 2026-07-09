---
name: VRP startuppgifter & no-fallback
description: Ruttoptimering utgår från startuppgifter + föregående uppgift; alla positions-fallbackar och default-koordinater är förbjudna.
---

# VRP startuppgifter & no-fallback (Etapp 4)

Regel: VRP-/ruttplaneringens startpunkter kommer ENBART från startuppgifter — riktiga work orders med `orderType="startpunkt"`, `taskCategory="start"` (helpers i `shared/start-task.ts`: `isStartTask`, `buildStartTaskPointMap`, `buildStartPointsForDate` i team-vehicles). Team utan startuppgift hoppas över (fail closed).

**Förbjudet (återinför aldrig):**
- Teamledar-/medlems-/team-GPS- eller klustercentrum-position som planeringsgrund (GPS = endast realtidsvisning).
- Hårdkodade default-koordinater (`18.07/59.33` Stockholm, `20.263/63.826` Umeå) som `||`-fallback i agent-byggen — filtrera bort agenten istället.

**Central gate:** `optimizeRoutesVRP` skippar `isStartTask(order)` OCH `resolveLocationRequirement(order) === "ingen"` — men alla callers (optimization-job-runner båda vägarna, optimizationRoutes, aiRoutes) filtrerar också själva; håll gaten på BÅDA nivåerna vid nya anropsvägar.

**Why:** Task-modellen (svar C): uppgiften är informationsbärare; gissade positioner gav fel rutter tyst. Fail closed + tydligt svenskt felmeddelande ("Lägg in en startuppgift…") är den valda UX:en.

**How to apply:** Ny VRP-anropsväg eller agent-bygge → ingen koordinat-default, filtrera bort platslösa agenter/uppgifter, och basera commute-/startlogik på dagens tidigaste startuppgift (usePlannerData getCommuteSummary: resurs får falla tillbaka på hem, team får INTE).

Positionsvarning i veckoplanen måste kolla BÅDE lat och lng (`taskLatitude ?? objectLatitude` OCH `taskLongitude ?? objectLongitude`).

Klumpningsmotorn: UI säger "stopp" (DB behåller `metadata.kind="clump"`); default-radie 30 m (`DEFAULT_GROUPING_RADIUS_METERS`).
