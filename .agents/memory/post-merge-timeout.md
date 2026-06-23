---
name: Post-merge timeout
description: Varför [postMerge].timeoutMs är 300s och vad som driver post-merge-körtiden.
---

# Post-merge timeout (scripts/post-merge.sh)

`.replit` `[postMerge].timeoutMs` är satt till **300000 (5 min)**. Ändra ENDAST via
`setPostMergeConfig` (code_execution-callback i `post_merge_setup`-skillen) — direkta
`.replit`-edits är blockerade av plattformen ("Direct edits to .replit ... not allowed").

## Regel
Sänk aldrig timeouten under ~240s utan att först mäta en dependency-ändrande merge.

**Why:** `scripts/post-merge.sh` har **bimodal körtid**:
- Steady-state (inga dep-ändringar): ~55s — `npm install` är no-op, `db:push` hittar inga ändringar.
- Dep-ändrande merge: ~120–150s — `npm install` gör verkligt arbete (t.ex. vitest/vite-major-
  upgrade med peer-dep-churn) OCH `db:push` (drizzle-kit pull/introspektion av ~190 tabeller).
  Den gamla 90s-timeouten dödade scriptet MITT I `db:push` (raden direkt efter `npm install`),
  alltså FÖRE migrations-loopen — schemat hann ändå appliceras men post-merge rapporterades failad.

**How to apply:** Vid post-merge-timeout → höj timeouten. Optimera INTE migrations-loopen
(de ~60 idempotenta psql-`-f`-anropen ligger EFTER flaskhalsen och hjälper inte körtiden här).
Den verkliga flaskhalsen är `npm install` + `db:push`. Verifiera fix med `runPostMergeSetup()`.
