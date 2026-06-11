---
name: Veckoplanering-vyn (Bilaga C)
description: Decisions/gotchas for the Veckoplanering weekly-plan view — alias page, 9th category placeholder, recompute button semantics.
---

# Veckoplanering (Bilaga C)

- **`/veckoplanering` är ALIAS för `/veckoplan`** — samma sida (`WeeklyPlanViewPage.tsx`), ingen duplikat. Bygg aldrig en separat Veckoplanering-sida.
  **Why:** Spec DEL 3 / Bilaga C = Option A = utöka befintliga sidan till 3-kolumns kollapsbar layout, inte ny sida/nya DB-tabeller.

- **9:e time_category `internal_training` ("Interntid/utbildning") finns ENBART i frontend** (`client/src/lib/weekly-plan-categories.ts`). Schemats styrda värdelista (`shared/schema.ts` ~6723) och `weeklyPlanEngine` emitterar bara 8 värden → den 9:e är en visuell legend-platshållare (spec kräver 9 block-typer), inte död kod att städa bort.
  **How to apply:** För att göra den "riktig" måste engine emittera värdet OCH det läggas till i schema-värdelistan + engine-switchen (`weeklyPlanEngine.ts` ~204). Tokens: `accent`/`accent-foreground` (samma mönster som `personal_time` använder `muted`).

- **Knappen "Automatisk veckoplanering" (`data-testid="button-recompute"`) gör BARA `/recompute`** (räknar om restid/KPI/varningar för redan placerade block) — den fördelar INTE oplanerade kandidater. Auto-placering är medvetet uppskjuten (engine saknar VRP-placering av kandidater). Label har tooltip som klargör detta.
  **Why:** Task sa "wire till recompute(+travel); bygg auto-placering bara om engine saknar det (separat, sist)". Ändra inte label till att lova auto-fördelning förrän placerings-logik finns.

- **`POST /api/weekly-plans/:planId/tasks` validerar INTE att `taskId`/`teamId` tillhör tenant** före insert (pre-existing; `createWeeklyPlanTask` insertar rått). DnD-/quick-add-flödet bygger på detta. Möjlig IDOR — kandidat för follow-up tenant-ownership-check.
