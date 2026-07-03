---
name: Restidsmotor (tunga fordon) & tidskod per resemoment
description: v1 restidskorrigering (hastighetstak/faktorer/vinter) + manuell tidskod som måste överleva recompute; reset-till-auto-mönstret.
---

# Restidsmotor & tidskod (finplanering, v1)

Byggd som v1-korrigering ovanpå routing-motorns råa restid. Grundparametrar bor på
`teams` med tenant-default på `planning_parameters` (expand-contract, alla nullable →
befintliga team opåverkade). Fallback-kedjan är ALLTID **team → tenant → motordefault**;
resolvern (`resolveTravelEngineParams` i `weeklyPlanEngine.ts`) tar bara `plan.teamId`
från en tenant-scoped `getWeeklyPlan`-rad, så rå `storage.getTeam(id)` läcker inte tenant.

## Korrigeringsordning (får INTE kastas om)
1. **Hastighetstak på MEDELFARTEN per resa** (km/h, inte procent): lägg bara till tid när
   `avgSpeed > cap` → `Math.max(minutes, distanceKm/cap*60)`. Ett tak sänker aldrig tiden.
2. **travelTimeFactor** (trim). `travel_commute` (inställelse/egentid) tvingas ≥ 1.0 —
   egentid trimmas ALDRIG nedåt.
3. **winterFactor** om planeringsdatum ligger i vinterperioden. Golv 1.0. Årsvändning:
   `winterStart > winterEnd` (MM-DD-strängar, lexikal jämförelse) → `d >= start || d <= end`.
   Alla faktorer clampas till [0.5, 3.0] vid resolve som försvar mot ovaliderade DB-värden.
   Hela framkalkyleringen (rå tid, km, applicerat tak, faktorer, källa) sparas i
   `travel_time_entries.correction` (jsonb) för transparens i klick-upp-panelen.

## Tidskod-kontraktet (kritiskt)
`travel_time_entries` har `timeCategory`, `timeCategoryManual`, `isAuto`.
Auto-klassning: dagens **första** resa = inställelse (`travel_commute`), resten = ställtid
(`setup`).

**Regel:** recompute/auto-klassning får ALDRIG skriva över en manuellt satt tidskod —
`patch.timeCategory` skrivs bara när `!entry.timeCategoryManual`. Vilken framtida ändring
av recompute-motorn som helst måste bevara detta.

**Reset-till-auto-mönstret:** klienten skickar `{ timeCategoryManual: false }` UTAN
`timeCategory`. Route-guarden i `PATCH /api/travel-entries/:id` tvingar manual=true ENDAST
när `data.timeCategory !== undefined`. Skickar man en tidskod utan explicit flagga → låses
(manual=true). Efter varje travel-entry-mutation körs `recomputeWeeklyPlan(..., {recomputeTravel:true})`
och svaret hämtas EFTER recompute, så klienten får det färska auto-värdet direkt.

**Why:** delade objekt/koder gör det lätt att av misstag skriva över planerarens medvetna
val vid nästa recompute; guarden + manual-flaggan är enda skyddet.
**How to apply:** rör du recompute-loopen, PATCH-guarden eller frontendens
byt-tidskod/reset-knappar — behåll "auto skriver bara när !manual" och skicka aldrig
`timeCategory` på reset.
