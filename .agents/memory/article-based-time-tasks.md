---
name: Article-based time tasks (restid/intern tid)
description: How restid and internal_time (rest/lunch/semester/sjukdom/utbildning/admin/egen tid) got article-driven cost without migrating to work_orders.
---

Rather than migrating personal-time/travel into `work_orders` (would touch
mobile app, VRP, and invoicing far beyond scope), they were kept as
`personal_tasks` / `travel_time_entries` and made article-driven additively:

- `articles.articleType="restid"` uses new travel-specific columns
  (vehicle/road type, speed range, minutesPerKm) to compute travel time/cost.
- `articles.articleType="internal_time"` reuses existing `cost`/`timeCodeKey`
  (cost = öre/minut); matched to a personal task via
  `timeCodeKey === personalTasks.timeCategory`.
- Both link tables got a nullable `articleId` FK; resolution always falls
  back to legacy behavior when no matching article exists for the tenant —
  this is what keeps existing tenants working unchanged.

**Why:** `personal_tasks`/`travel_time_entries` already flow through the same
KPI/warnings/cost pipeline as production tasks (`weeklyPlanEngine.computeWeeklyPlanSummary`),
so article-linkage alone satisfies "these become article-based tasks" without
a full data-model rewrite.

**How to apply:** if extending this further (e.g. surfacing cost in
lön/fakturering), read cost from `personal_tasks.cachedCostOre` /
`travel_time_entries.travelCost`, recomputed via `resolveTravelArticle`,
`computeTravelFromArticle`, `resolveTimeCategoryArticle`,
`computePersonalTaskCostFromArticle` in `server/planning/weeklyPlanEngine.ts`.
