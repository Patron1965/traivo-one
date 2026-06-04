---
name: createObject advisory-lock transaction
description: How object copy/bulk-create flows stay atomic given createObject's OBJ-NNN advisory lock
---

`storage.createObject` serializes OBJ-NNN number generation with a Postgres
**transaction-bound** advisory lock (`pg_advisory_xact_lock`).

`createObject(insertObject, tx?)` accepts an **optional** transaction. When a `tx`
is passed it runs inside that transaction (re-acquiring the advisory lock, which
never blocks within the same transaction) instead of opening its own. This is what
makes bulk-create flows atomic.

**Why this matters:** the advisory lock is xact-scoped, so re-taking it on each
`createObject` call inside one outer transaction is safe (a transaction can't block
on a lock it already holds). MAX+1 also sees the rows inserted earlier in the same
transaction, so sequential numbering stays correct.

**How to apply:**
- To make a multi-object create flow atomic, open ONE `db.transaction` and pass `tx`
  to every `createObject` call (see `copyObjectTree` in
  `server/services/object-copy.ts`). Either the whole tree is created or nothing is.
- Keep operations that can fail non-fatally (e.g. best-effort metadata copy) OUTSIDE
  that transaction. A thrown query puts Postgres in aborted-transaction state, so a
  caught-and-continue error mid-transaction would poison all later statements.
  `copyObjectTree` therefore creates objects + primary `object_parents` rows in the
  atomic phase, then copies metadata best-effort after commit.
- Self-contained writes that don't call `createObject` (e.g. `moveObject`) are still
  wrapped in `db.transaction` directly for atomicity.
