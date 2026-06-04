---
name: Drizzle unqualified column in correlated subquery
description: Why a sql`` fragment correlating to the outer table must reference ${table}.col, not ${table.col}, when used as a SELECT column
---

# Drizzle: correlated subquery column reference in SELECT-list context

When a `sql`` fragment contains a correlated subquery that references an outer
table's column, interpolate the **table** (`${objects}.id`), not the **column**
(`${objects.id}`).

**The bug:** `${objects.id}` renders context-dependently:
- In a **WHERE** clause → qualified `"objects"."id"` (correct).
- As a **SELECT column** in a single-table select → drizzle drops the table
  prefix and renders bare `"id"`. Inside the subquery that bare `"id"` then
  binds to the *inner* table (nearest scope, e.g. `object_payers.id`), so a
  predicate like `op.object_id = "id"` silently becomes `op.object_id = op.id`
  → always false → subquery returns NULL. No error, just wrong data.

**Why it matters here:** `primaryPayerCustomerIdSql()` is used as a SELECT
column override in `objectColumnsWithPrimaryCustomer()` (getObject /
getObjectsByIds / getObjects etc.), so every object read silently returned
`customerId = null`. Copy flows (`copyObjectTree`) depend on `getObject().customerId`
for the clone INSERT, so they 500'd on `objects.customer_id NOT NULL`.

**The fix:** write `op.object_id = ${objects}.id`. Interpolating the pgTable
object renders the bare table name `"objects"`, so `${objects}.id` → `"objects".id`,
qualified and unambiguous in BOTH select-column and where contexts.
**Caveat:** this hard-depends on the outer query NOT aliasing the table; all
current callers use `.from(objects)` unaliased (same assumption the WHERE-variant
already relies on).

**How to apply:** any time you hand-write a correlated subquery in a drizzle
`sql`` fragment that may be used as a select-column value, reference outer columns
via `${table}.colname`, and verify with `query.toSQL().sql` in both a select-list
and a where-clause context.
