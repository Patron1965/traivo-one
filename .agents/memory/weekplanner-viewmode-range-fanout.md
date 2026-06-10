---
name: WeekPlanner ViewMode range-fanout
description: Adding a new ViewMode to the planner requires updating every period-deriving function, not just the render switch.
---

# WeekPlanner ViewMode range-fanout

When adding a new `ViewMode` (e.g. quarter/year) to the planner, the render
branch + toolbar toggle is the *easy* part. The risky part: several functions in
`usePlannerData.ts` derive a date range from `viewMode` with an `else`/fallback
branch, so a new mode silently inherits week/day scope instead of erroring.

Must be updated for any new mode:
- `currentViewScheduledJobs` (drives in-view counts)
- `computeCurrentDateRange` (drives bulk send / publish range)
- `handleClearAllScheduled` (DESTRUCTIVE — bulk-unschedule range)
- `getResourceScheduleJobs` (per-resource send range)
- `ClearDialog` label text in `PlannerDialogs.tsx` (mode-aware copy)

**Why:** these use `if month / if day / else (week)` patterns. A new mode hits
the `else` and silently scopes to the wrong period — for clear-plan that means
unscheduling the wrong (often far smaller, sometimes larger) set of jobs without
telling the user.

**How to apply:** grep `usePlannerData.ts` for `viewMode ===` and audit every
range computation when introducing a ViewMode. There is no exhaustive TS switch
guarding this, so the compiler will NOT catch the omission.
