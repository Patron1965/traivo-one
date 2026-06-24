---
name: Completion-gate dual status (orderStatus utford vs executionStatus completed)
description: Server-side "on completion" logic in the work-order PATCH route must detect BOTH signals; SimpleFieldApp completes via orderStatus, not executionStatus.
---

Work orders carry two independent "done" signals that different clients use:
- `executionStatus === "completed"` (execution lifecycle; mobile bearer path `server/routes/mobile/orders.ts` maps `status==='utford'|'completed'` to this).
- `orderStatus === "utford"` (Modus order status). **SimpleFieldApp's completion PATCH `/api/work-orders/:id` sends `orderStatus:"utford"` + `completedAt` — NOT `executionStatus`.**

Any logic that must run "on completion" in `PATCH /api/work-orders/:id` (required-field enforcement, metadata writeback, system-metadata stamping, etc.) MUST treat completion as EITHER signal, computed once as a transition:
```
const wasCompleted = existing.executionStatus === "completed" || existing.orderStatus === "utford";
const nowCompleting = update.executionStatus === "completed" || update.orderStatus === "utford";
const isCompleting = nowCompleting && !wasCompleted;
```

**Why:** Logic gated only on `executionStatus === "completed"` silently never fired for SimpleFieldApp completions, so required-field enforcement was bypassable and metadata writeback was dropped on the primary mobile path. `wasCompleted` spanning both fields prevents double-firing if a later request sets the other field.

**How to apply:** Whenever adding completion-gated side effects to the work-order PATCH route, gate on a combined `isCompleting`, never on a single status column. Caveat: historical rows already `orderStatus="utford"` but `executionStatus!=="completed"` won't re-run writeback when executionStatus is later corrected — backfill if that matters.
