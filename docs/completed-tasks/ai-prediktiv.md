# AI & Prediktiv Analys

## Task #2 — AI-funktioner — riktig data, persistent cache, bättre feedback
**Status:** MERGED | **Datum:** 2026-03-11

AI-funktioner använde delvis hårdkodad testdata. Ersatte med riktig API-data, lade till persistent cache för AI-svar och förbättrad feedback-loop.

**Nyckelresultat:**
- AI Cards med riktig operativ data
- Persistent cache för AI-svar (IndexedDB + server)
- Förbättrad feedback-mekanism
- AI Planning Assistant med faktiska schemaläggningsförslag

---

## Task #35 — Årsplanering — AI-driven besöksfördelning
**Status:** MERGED | **Datum:** 2026-03-19

AI analyserar årsmål och föreslår optimal månadsfördelning av besök. Respekterar säsongsrestriktioner, resurskapacitet och befintliga utförda ordrar.

**Nyckelresultat:**
- "AI-fördelning" tab i årsplaneringssidan
- Wizard för scope/period-val
- OpenAI-analys med jämförelse-diagram (Recharts)
- POST /api/annual-planning/ai-distribute och apply-distribution
- Säsongsvalidering vid applicering med isDateInSeason

---

## Task #37 — Prediktivt underhåll — AI-modell från IoT-historik
**Status:** IMPLEMENTED | **Datum:** 2026-03-20

AI-driven prediktiv underhållsmodell som analyserar IoT-signalhistorik och utförda arbetsordrar per objekt för att prognostisera nästa servicedatum.

**Nyckelresultat:**
- Baseline-algoritm: snittintervall mellan signaler + utförda ordrar
- Konfidensberäkning baserad på datamängd och varians
- OpenAI-berikande analys för mönsterigenkänning
- Periodisk bakgrundsjob (var 6:e timme) per tenant
- KPI-kort, filtrerbar prognostabell, ett-klicks orderskapande
- Sida: `/predictive-maintenance`
- DB-tabell: `predictive_forecasts` med migration
