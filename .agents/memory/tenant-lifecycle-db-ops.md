---
name: Tenant lifecycle DB ops
description: How to safely delete a whole tenant's data and why the default-tenant→kinab rename collides; which tables are safe to prune.
---

# Deleting an entire tenant's data (dev)

**Rule:** You cannot just `DELETE FROM tenants` or naively sweep `tenant_id` tables.
- Of the FKs referencing `tenants`, only **1 is CASCADE**; **142 are NO ACTION** → plain tenant delete is blocked.
- 154 tables carry `tenant_id`, but **~23 join tables have NO `tenant_id`** and FK into tenant-scoped parents: `team_members`, `assignment_articles`, `order_concept_articles/objects`, `concept_filters`, `delivery_/invoice_/document_configurations`, `order_checklist_items`, `price_list_articles`, `resource_articles/equipment/positions/vehicles`, `portal_user_object_scopes`. There is also a **depth-2 chain**: `article_object_mappings` → `order_concept_objects`/`order_concept_articles`.

**Safe approach (one atomic transaction):**
1. `SET LOCAL session_replication_role='replica'` — supported on this Neon DB; bypasses FK trigger ordering so delete order doesn't matter.
2. `DELETE` from all 154 `tenant_id` tables `WHERE tenant_id IN (targets)`.
3. `DELETE FROM tenants WHERE id IN (targets)`.
4. **Depth-agnostic orphan sweep** over *every* no-`tenant_id` child FK, a few passes: `DELETE FROM child c WHERE c.fk IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parent p WHERE p.pk=c.fk)`. This removes only genuinely dangling rows, so global tables (`industry_packages`, `conversations`/`messages`) are untouched.
5. Verify: dangling-FK count must be **0**, and `tenants` should equal the keep-set.

**Why:** NO ACTION FKs block the delete; join tables without `tenant_id` would be orphaned by a `tenant_id`-only sweep.

**Dev recreation (cleanup is point-in-time):** demo-seed recreates `default-tenant` each boot then folds it into `kinab`; `ENABLE_REALTIME_TEST_ROUTES=true` test runs recreate `oiv2-*`/`eres-*`/`team-infer-*`. Expect them to reappear after test activity.

# default-tenant → kinab rename collision (`server/seed.ts` migrateDefaultTenantToKinab)

Unique indexes keyed `(tenant_id, natural-key)` collide when **both** tenants hold the same natural key → Postgres **23505** rolls back the whole rename **every boot**. `COLLISION_KEYS` pre-deletes redundant OLD-tenant rows before the generic UPDATE.

**Only safe to prune leaf/snapshot tables** (regenerable / one-row-per-tenant): `geocoding_missing_snapshots`, `weather_cache`, `budget_alert_log`, user notif prefs, `user_tenant_roles`, tenant-singleton configs (`tenant_branding`, `fortnox_config`, `telink_config`).
**Do NOT prune entity tables** (`customers`, `articles`, …) with FK children — they need a bespoke merge, not delete.

**Prod status (June 2026):** production has **no `default-tenant`**, so this rename/collision path is **dev-only** today; revisit only if prod ever gains a `default-tenant` alongside `kinab`.
