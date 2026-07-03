---
name: Beläggning/spilltid terminologi (finplanering)
description: I veckoplanen betyder "planerad/avtalad arbetstid" avtalad kapacitet, "bokad arbetstid" schemalagd tid — håll isär.
---

# Beläggning / spilltid — terminologi på veckoplanen

I `WeeklyPlanViewPage.tsx` (finplanering / `/veckoplan`) finns TVÅ distinkta storheter som lätt förväxlas:

- **"Planerad arbetstid" / "avtalad kapacitet"** = `contractedMinutes` (`contractedHours × 60`). Det är kapacitetstaket.
- **"Bokad arbetstid"** = `plannedWorkMinutes` = summan av bokade kategorier (produktion + restid + pendling + övertid).
- **Spilltid** = `bokad − planerad`, ett SIGNERAT ± koncept (>0 överbokad/tar av egentiden, <0 underbokad). Invariant: `spilltidMinutes > 0 ⟺ overContracted`.

**Why:** Spec §3 fråga 2 (`docs/uppgiftslogik-utvecklingslogg.md`) definierar beläggnings-KPI:n som "% av planerad arbetstid" = av avtalad kapacitet. Tidigare användes samma svenska fras "Planerad arbetstid" i rubrik + fotnot för att märka den BOKADE totalen, vilket kolliderade med Beläggning-kortet (samma ord = två tal på samma sida). Att återanvända frasen för bokad tid återinför den tvetydigheten.

**How to apply:** Ny copy/label på veckoplanen som syftar på schemalagd/bokad tid MÅSTE säga "bokad arbetstid". Reservera "planerad/avtalad arbetstid" för `contractedMinutes`. Spilltid-summeringen är DERIVERAD (server: 3 additiva fält i `WeeklyPlanSummary` + `metadata.kpi`; klient har backfill-fallback för äldre planer utan de nya kpi-nycklarna). Ingen ny time-code-groupKey, uppgiftstyp eller warning skapades — överlappningsregeln ("bara egentid får överlappas") vilar på befintlig prio1-vs-prio1-regel (se `tidskod-priority-conflict-rule.md`).
