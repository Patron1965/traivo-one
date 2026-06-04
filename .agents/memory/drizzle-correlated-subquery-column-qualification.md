---
name: Drizzle correlated-subquery column qualification
description: Embedding a Column in a drizzle sql`` template renders it UNqualified, silently breaking correlated subqueries.
---

# Drizzle embeds columns UNqualified in `sql` templates → correlated-subquery shadowing

In drizzle-orm 0.45.x, `sql\`${table.col}\`` renders the column as just `"col"` (no
`"table".` prefix) even when the outer query is `.from(table)`. Verified:
`db.select({x: sql\`${objects.id}\`}).from(objects).toSQL()` → `select "id" from "objects"`.

**Why this is dangerous:** inside a correlated subquery whose inner table has a
column of the same name, the unqualified `"id"` resolves to the INNER table, not the
outer one. Example bug: a primary-payer projection wrote
`WHERE op.object_id = ${objects.id}` which rendered `op.object_id = "id"` →
Postgres bound `"id"` to `object_payers.id` (op has its own `id`), so the predicate
became `op.object_id = op.id` → never matched → the projection returned NULL for
EVERY object. This silently broke object→customer resolution app-wide (getObject
returned null customerId; `objectHasPrimaryCustomerSql`/`objectPrimaryCustomerInSql`
EXISTS filters always false → customer-filtered object lists came back empty). It
fails silently — no SQL error, just wrong/empty results.

**Fix:** write the outer reference as a literal qualified identifier inside the
template, e.g. `WHERE op.object_id = "objects"."id"`. The helpers already hardcode
the inner table name (`object_payers op`), so hardcoding `"objects"."id"` is
consistent and safe because no call site aliases the `objects` table.

**How to apply:** any time you put `${someTable.col}` inside a `sql` template that
is itself a subquery (correlated), do NOT trust drizzle to qualify it. Use an
explicit `"table"."col"` literal (or verify the inner FROM has no same-named
column). Lives in `server/services/object-customer.ts`.

**Detection:** `.toSQL().sql` shows the unqualified `"col"`; or test on real data —
the projected value comes back null/empty while a JS-side equivalent
(`getObjectPrimaryCustomerId`, which queries object_payers directly) returns the
correct value.
