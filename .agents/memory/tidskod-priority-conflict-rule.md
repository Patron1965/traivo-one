---
name: Tidskod prio-konfliktregel (finplanering)
description: Överlapp/TIME_CONFLICT-semantiken i weeklyPlanEngine efter tidskod-bygget — bara BÅDA prio1 = konflikt; prio2/3 får överlappa.
---

# Tidskod-prioritet & överlappsregel i finplaneringen

**Regel:** I `server/planning/weeklyPlanEngine.ts` raisas `TIME_CONFLICT` (överlapps-varning
mellan tidsblock) ENDAST när båda överlappande blocken resolvar till `priority === 1`.
Block på prio 2 eller 3 får överlappa tyst — ingen varning.

**Prioritets-resolvering (kedja, högst→lägst prio-källa):**
1. Per-block override: `personal_tasks.priority` (t.ex. läkarbesök som höjs till prio 1).
2. Registret: `time_code_definitions.priority` via `storage.getTimeCodeDefinitions` → `priorityMap`
   (tenant- + `deletedAt`-scopat).
3. Inbyggd `DEFAULT_CODE_PRIORITY`-map (seed-nycklar).
4. `FALLBACK_CODE_PRIORITY` = 2 för okänd/saknad kod → resulterar i INGEN hård konflikt.

**Why:** PO-spec — prio 1 = "aldrig överlapp" (produktion + kritisk egentid), prio 3 =
"får överbokas". Detta är en medveten INVERTERING av tidigare beteende där alla överlapp
flaggades. En framtida utvecklare kan lätt missta `if (a.priority!==1||b.priority!==1) continue;`
för en bugg och "fixa" den → återinför falska överlapps-varningar.

**How to apply:**
- Rör du överlapp/varnings-logiken: behåll både-prio1-guarden och degradera saknad kod till
  FALLBACK(2), krascha aldrig på okänd kod.
- prio2-vs-prio2-överlapp ger INGEN varning by design — bekräfta scope med PO innan du ändrar det.
- Egentid kan höjas till prio 1 (via `personal_tasks.priority` eller registret) och beter sig
  då som ett jobb-block som aldrig får överlappas.
