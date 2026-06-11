---
name: Veckoplanering-vyn (Bilaga C)
description: Decisions/gotchas for the Veckoplanering weekly-plan view — alias page, 9th category, header buttons, personal-task add flow.
---

# Veckoplanering (Bilaga C)

- **`/veckoplanering` är ALIAS för `/veckoplan`** — samma sida (`WeeklyPlanViewPage.tsx`), ingen duplikat. Bygg aldrig en separat Veckoplanering-sida.
  **Why:** Spec DEL 3 / Bilaga C = Option A = utöka befintliga sidan till 3-kolumns kollapsbar layout, inte ny sida/nya DB-tabeller.

- **Två header-knappar enligt Bilaga C:** `[Automatisk veckoplanering]` (`button-recompute`) och `[Lägg till tid]` (`button-add-time`).
  - "Automatisk veckoplanering" gör BARA `/recompute` (räknar om restid/KPI/varningar för redan placerade block) — den fördelar INTE oplanerade kandidater. Auto-placering är medvetet uppskjuten (engine saknar VRP-placering). Ändra inte label till att lova auto-fördelning förrän placerings-logik finns.
  - "Lägg till tid" öppnar `AddTimeDialog` → `POST /api/weekly-plans/:planId/personal-tasks`. `ADDABLE_TIME_CATEGORIES` exkluderar `production` (kommer från jobb) och auto-restid (härleds av motorn).

- **9:e time_category `internal_training` ("Interntid/utbildning") är frontend-styrd, inte motor-emitterad.** Den kan skapas manuellt via "Lägg till tid" (timeCategory är fri text på `personal_tasks`), renderas via `personalToBlock` + egen ikon, men recompute-switchen har `default: break` → den räknas ALDRIG in i KPI-buckets. Det är ett medvetet val (visuell platshållare/manuell post), inte död kod.
  **How to apply:** För att göra den KPI-räknad måste den läggas till i schemats styrda värdelista OCH i engine-recompute-switchen. Tokens kommer från `weekly-plan-categories.ts` (tema-tokens, ingen hex).

- **`personal_tasks.startAt/endAt` är timestamp-kolumner → kräver coerce vid HTTP-gränsen.** Se [drizzle-zod timestamp coerce](drizzle-zod-timestamp-coerce.md). Utan `.extend({startAt/endAt: z.coerce.date()})` på route-schemat avvisas ISO-strängar (400 "Expected date, received string"). Gällde latent POST + alla PATCH-flöden (moveBlock på personliga block, saveEgentid) eftersom de aldrig testats live bakom auth-iframen.

- **`toIso(date, minutes)` måste tåla minuter ≥ 1440** (natt-/helgvila över midnatt). Bygg slut-tid via Date-aritmetik (`base.setMinutes(+minutes)`), aldrig via en `HH:MM`-sträng — "30:00" ger Invalid Date och kraschar sparningen med kryptisk toast.

- **`POST /api/weekly-plans/:planId/tasks` validerar INTE att `taskId`/`teamId` tillhör tenant** före insert (pre-existing; rå insert). DnD-/quick-add-flödet bygger på detta. Möjlig IDOR — kandidat för follow-up tenant-ownership-check.
