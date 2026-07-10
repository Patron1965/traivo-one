---
name: Article-based time tasks (restid/intern tid)
description: How non-production time (travel, rest, lunch, leave, training, admin) became article-driven without migrating to work_orders.
---

Non-production time categories (travel/rest/lunch/leave/sick/training/admin)
were made article-driven by extending the existing lightweight tables
(`personal_tasks`, `travel_time_entries`) rather than migrating them into
`work_orders` — a full migration would touch mobile app, VRP, and invoicing
far beyond a reasonable scope for one change.

Pattern: give the link tables a nullable `articleId`; resolve the matching
article server-side (by category key for internal time, by
vehicle/road-type/speed specificity for travel); always fall back to the
prior legacy computation when no article matches, so existing tenants keep
working unchanged.

**Why:** these tables already flow through the same KPI/cost/warnings
pipeline as production tasks, so article-linkage alone satisfies
"article-based task" behavior without a data-model rewrite.

**How to apply:** when computing cost/duration for such a linked task, always
derive the effective duration the same way the summary/engine does (explicit
duration field OR start/end diff) — computing it only from one representation
leaves cached costs null/stale for tasks that use the other representation.
