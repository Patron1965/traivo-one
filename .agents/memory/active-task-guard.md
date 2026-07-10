---
name: Active-task guard (one active task per resource)
description: How "auto-close prior active task on new start" is implemented across production and personal time.
---

`server/services/active-task-guard.ts` → `closeOtherActiveWork(tenantId, resourceId, opts)` is the single place that enforces "one active task at a time" per resource. Call it right before setting a new active-start field (e.g. before `onSiteAt`/status→`paborjad`, before inserting an open `workEntries` row).

It auto-completes:
- `work_orders` rows for the resource where `onSiteAt IS NOT NULL AND completedAt IS NULL` (excluding the just-started order) → sets `orderStatus='utford'`, `executionStatus='completed'`, `completedAt=now`, `actualDuration=elapsed`, logs `logWorkOrderTransition` + a `task_events` row with `eventType: 'auto_completed'`.
- open `work_entries` rows (`endTime IS NULL`) → sets `endTime=now`, computes `durationMinutes`.

**Why:** avoids double-counted active timers when a mobile worker jumps to a new order/entry without explicitly stopping the previous one; keeps payroll/actual-time numbers honest without requiring the client to always send an explicit "stop" call.

**How to apply:** it is best-effort and never throws to the caller — call sites (`server/routes/mobile/orders.ts`, `server/routes/mobile/workSessions.ts`) treat it as a side-effect, not a blocking precondition. Deliberately excludes `travelTimeEntries` (plan-level precomputed, not a live timer) and `personalTasks` (scheduled start/end blocks, not open-ended). Only extend to a new "live timer" table if it genuinely has open-ended `endTime/completedAt IS NULL` semantics.
