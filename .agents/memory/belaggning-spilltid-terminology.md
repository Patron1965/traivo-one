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

**How to apply:** Ny copy/label på veckoplanen som syftar på schemalagd/bokad tid MÅSTE säga "bokad arbetstid". Reservera "planerad/avtalad arbetstid" för `contractedMinutes`. Spilltid-summeringen är DERIVERAD (server: additiva fält i `WeeklyPlanSummary` + `metadata.kpi`; klient har backfill-fallback för äldre planer utan de nya kpi-nycklarna). Överlappningsregeln ("bara egentid får överlappas") vilar på befintlig prio1-vs-prio1-regel (se `tidskod-priority-conflict-rule.md`).

## Per-dag drill-down (dagskapacitet)

Vecko-spilltiden bryts ner per veckodag via `dailyBooking: DailyBooking[]` (day 0=mån..6=sön) i `WeeklyPlanSummary` + `metadata.kpi`.

- **Dagskapacitet** = `round(contractedMinutes / 5)` för mån–fre, `0` för helg. Kapaciteten är ett VECKO-budget → jämnt fördelat på 5 arbetsdagar (mån–fre-konventionen).
- **Per-dag bokad** måste spegla vecko-`workedMinutes` EXAKT: produktion (tasks) + {travel_between_jobs, travel_commute, overtime} (personalTasks) + alla travelEntries, bucketat på `plannedDate`. Lägg aldrig till/dra ifrån en kategori i bara den ena pathen.

**Why:** Planeraren behöver se VILKEN dag som är över-/underbokad för att kunna flytta block. En dag kan vara överbokad även när veckan nettar ut (10h mån + 6h tis) — det äter ändå den dagens egentid.

**How to apply:** Summan av dags-spilltid ≠ vecko-spilltid AVSIKTLIGT när helgarbete finns (helgkapacitet=0) eller odaterade block finns (faller utanför dagsvyn). Det är drill-down-semantik, inte en bugg — kanonisera per-dag-beräkningen på servern (aldrig klient-recompute, som driftar mot motorns faktor/kategori-logik). Klienten gate:ar strecket på `Array.isArray(kpi.dailyBooking)` så äldre planer döljer det tills nästa omräkning.
