---
name: Koncept-expansion skriver assignments (inte work_orders)
description: Vilken tabell orderkoncept-expansion faktiskt skapar rader i, och var per-uppgift-fält måste stämplas.
---

Orderkoncept-expansion (i `server/routes/fortnoxRoutes.ts`, både huvud- och pre-task-vägen) skapar rader i tabellen `assignments`, INTE `work_orders`.

**Why:** Det var initialt otydligt — `work_orders` såg ut som den naturliga måltabellen, men expansionen materialiserar uppgifter som `assignments` (kopplade via `orderConceptId`). Att stämpla nya per-uppgift-fält på `work_orders` ger ingen synlig effekt.

**How to apply:** När en feature behöver per-uppgift- eller beroende-data (t.ex. `requiresAcknowledgment`, `dependencyCriticality`, `dependencyAcknowledgedAt`) på koncept-genererade uppgifter — lägg kolumnerna på `assignments` och stämpla dem i expansion. Schemaläggnings-varningar beräknas också på `assignments` filtrerade på `orderConceptId`. (Spegel-kolumner kan hållas på `work_orders` för bakåtkompatibilitet, men de är inte vad expansionen fyller.)
