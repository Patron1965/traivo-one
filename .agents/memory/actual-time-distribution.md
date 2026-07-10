---
name: Actual-time distribution across klump sub-tasks
description: How registered actual/verklig time is split proportionally across sub-tasks and how manual overrides interact with it.
---

`server/services/actual-time-distribution.ts`:
- `distributeActualTime({ tenantId, workOrderIds, totalActualMinutes, actor })` — largest-remainder proportional split of a single registered total across the given work orders, weighted by each row's `estimatedDuration`. Writes `actualDuration` + a shared `actualTimeGroupKey` (so downstream consumers can tell "this actual time came from one combined registration"), logs `task_events` with `eventType: 'actual_time_distributed'`.
- `adjustActualTimeDistribution({ tenantId, allocations, actor })` — manual per-row override; sets `actualDurationManual=true` on the touched rows and logs `eventType: 'actual_time_adjusted'`.

**Why:** there is no persisted "klump" table yet (future Klumpmotor, tracked separately) — a klump's sub-tasks are passed explicitly as a `workOrderIds[]` array by the caller, not derived from `slot_times.assignmentGroupKey` or any grouping column.

**How to apply:** rows with `actualDurationManual=true` are treated as locked — re-running `distributeActualTime` over the same set preserves their value and only redistributes the *remaining* minutes across the unlocked rows (if the locked total already exceeds/consumes the new registered total, unlocked rows get 0, they are never pushed negative). Payroll/statistics/invoicing consumers read `actualDuration` directly and need no additional wiring since they already read it broadly (kpiRoutes, weekly-report, roiRoutes, sla-risk-engine, ai-planner, disruption-service).
