---
name: Hide-empty gates vs DB-default columns
description: "Show only when a value exists" presentation gates must treat DB-default column values as empty, or they fabricate defaults.
---

# Hide-empty presentation gates must exclude DB defaults

When building "visa endast i det förekommande fall" (show only when a value exists)
presentation, a `Boolean(obj.someColumn)` gate is WRONG for any column that has a
non-null DB default. The default value makes the gate always-true and renders a
fabricated value the product owner explicitly rejected.

Known offenders in the objects table:
- `access_type` default `"open"` → gate with `obj.accessType && obj.accessType !== "open"`.
- `condition` default `"good"` → excluded from the equipment gate for the same reason.

**Why:** PO Mats wants an object to present only real, entered data — no fabricated
"Tillgångstyp: Öppet" / "Skick: Bra" filler. The header access badge already gets this
right (`accessType !== "open"`); mirror that logic anywhere else the column is shown.

**How to apply:** For every hide-empty gate over a scalar object column, check the
column's Drizzle default in `shared/schema.ts` first. If it has a default, exclude that
default value from the "has value" test — do not just coerce to Boolean. Add a test
that feeds the default value and asserts the section stays hidden (jsdom object mocks
often omit the field, so the default path is easy to miss in tests).
