---
name: Prod operational-data reset (kinab)
description: How to safely wipe tenant operational/customer data in prod, the dry-run guarantee, the FK-scope sync rule, and a prod-replica information_schema quirk.
---

# Prod operational-data reset (tenant kinab)

Wiping all customer/operational data in prod while keeping config/master is done via
`scripts/kinab-reset-prod-operational-data.ts`. The delete scope (phases A–H, FK-safe
child-before-parent order) is the SHARED source of truth in
`scripts/kinab-reset-phases.ts` — used by BOTH the dev and prod runners. Change scope
THERE, never in a runner.

## The dry-run is a real cascade (trust it)
The script ALWAYS runs the real DELETE cascade inside one transaction; dry-run vs sharp
differs ONLY by ROLLBACK vs COMMIT at the end. So a clean dry-run (no FK error +
post-delete leftover customers/objects/work_orders = 0) proves the scope is complete and
FK-ordered against the actual prod data. ALWAYS run the dry-run before a sharp run.
Sharp run needs DOUBLE confirm: `CONFIRM=YES_RESET_PROD` env + `--confirm RENSA-KINAB-PROD`.
Safety net: take a full `pg_dump "$PROD_DATABASE_URL"` to `.local/backups/` first.

## FK-scope sync rule (the recurring failure mode)
**Why:** the dry-run failed because `metadata_editor_submissions` (FK `object_id → objects`,
NO ACTION) had been added to the schema but never added to the reset phases — deleting
objects then violated the FK.
**How to apply:** any NEW table that gets a NO ACTION / RESTRICT foreign key to
`objects` / `customers` / `work_orders` (or assignments/order_concepts/price_lists/etc.)
MUST be added to `kinab-reset-phases.ts`, deleted BEFORE its parent. CASCADE / SET NULL
children are auto-handled — only NO ACTION / RESTRICT need explicit phase entries. To
re-derive the full child set, query the FK graph from `pg_catalog` (see quirk below) and
diff against the phases.

## Prod read-replica quirk: use pg_catalog, not information_schema
**Why:** `information_schema.constraint_column_usage` (and the FK-introspection joins built
on it) are PRIVILEGE-FILTERED — on the prod read-replica role they return ZERO rows, so an
FK-graph query there silently comes back empty.
**How to apply:** introspect foreign keys via `pg_constraint` / `pg_class` / `pg_attribute`
(`contype='f'`, decode `confdeltype`: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL,
d=SET DEFAULT). This works on the replica regardless of role privileges.
