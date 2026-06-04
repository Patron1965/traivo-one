---
name: createObject advisory-lock transaction
description: Why object copy/bulk-create flows can't be naively wrapped in an outer DB transaction
---

`storage.createObject` opens its **own** transaction with a Postgres advisory lock
to serialize OBJ-NNN number generation.

**Why this matters:** any flow that creates many objects in a loop (e.g.
`copyObjectTree` branch-copy in `server/services/object-copy.ts`) cannot just be
wrapped in an outer `db.transaction(async tx => …)` and have each `createObject`
call participate — `createObject` doesn't accept a `tx` and nesting it inside an
outer transaction risks advisory-lock deadlock / lock-scope mismatch.

**How to apply:**
- Self-contained multi-step writes that do NOT call `createObject` (e.g.
  `moveObject` — updates `objects.parentId` + primary `object_parents` row) SHOULD
  be wrapped in `db.transaction` for atomicity. This is already done for `moveObject`.
- To make a bulk-create flow atomic, you must first refactor `createObject` to
  accept an optional `tx`, or pre-allocate the OBJ-NNN numbers, before wrapping.
  Don't naively nest.
