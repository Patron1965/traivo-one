---
name: "Plannix" är ett dött namn — det heter Traivo / Traivo Go
description: Namnsanning för plattformen och chaufförsappen; varnar för stale rebrand-docs som säger "Plannix".
---

# Namn: Traivo (plattform) + Traivo Go (chaufförsapp). "Plannix" gäller INTE.

**Regel:** Plattformen heter **Traivo** (webb/backend = "Traivo One"), fält-/chaufförsappen
heter **Traivo Go**. Använd aldrig "Plannix" i användarvänd text, docs eller nya rapporter.

**Why:** En Traivo→Plannix-rebrand dokumenterades april 2026 men **reverterades**. Produktägaren
(Mats) bekräftade juli 2026 att "Plannix skall inte finnas — det är ett gammalt namn". Nuvarande
sanning bekräftas av `replit.md` (allt heter Traivo, logga `traivo_logo_transparent.png`) och den
körande appen.

**How to apply:**
- Följ INTE de stale rebrand-dokumenten som fortfarande säger "Plannix":
  `docs/product/PLANNIX_GO_REBRAND_SUMMARY.md`, `docs/PROJEKTSAMMANFATTNING.md`
  (+ `docs/assets/Arsplanering_Funktionsoversikt_2026.pdf` som säger "Plannix Field Service Platform").
  De speglar en övergiven rebrand, inte nuläget.
- `server/seed.ts:rebrandPlannixToKinab()` är en SEPARAT sak: en idempotent migration som byter en
  specifik tenants *visningsnamn* från "Plannix" till "Kinab". Rör inte den vid namn-städning — den
  handlar om tenant-data, inte om appens varumärke.
