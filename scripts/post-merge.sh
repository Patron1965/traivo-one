#!/bin/bash
set -e
npm install
npm run db:push

# Apply raw SQL migrations that drizzle-kit push cannot reliably express
# (pg_trgm GIN / JSONB expression indexes, plus structural column adds that
# push's interactive rename-detection can stall on). All statements are
# idempotent (ADD COLUMN / CREATE INDEX ... IF NOT EXISTS) so re-runs are safe.
if command -v psql >/dev/null 2>&1 && [ -n "$DATABASE_URL" ]; then
  for f in migrations/0029_kinab_search_indexes.sql \
           migrations/0030_objects_search_indexes.sql \
           migrations/0032_perf_dashboard_indexes.sql \
           migrations/0033_drop_raw_trgm_indexes.sql \
           migrations/0047_import_batch_id_payers_recipients.sql \
           migrations/0053_customer_invoices_consolidation.sql \
           migrations/0054_schema_drift_consolidation_import_batch.sql \
           migrations/0055_drop_customer_invoices_created_at.sql \
           migrations/0056_metadata_parent.sql \
           migrations/0057_metadata_katalog_customers.sql \
           migrations/0058_import_templates.sql \
           migrations/0059_order_type_metadata_links.sql \
           migrations/0060_metadata_formula.sql \
           migrations/0061_metadata_areas.sql \
           migrations/0062_metadata_inheritance_core.sql \
           migrations/0063_archive_soft_delete.sql \
           migrations/0064_work_order_lines_freetext.sql; do
    if [ -f "$f" ]; then
      echo "[post-merge] Applying $f"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    fi
  done
else
  echo "[post-merge] psql not available or DATABASE_URL unset — skipping raw SQL index migrations"
fi

# Verify the live DB matches shared/schema.ts after push + raw migrations.
# Fails the post-merge run (exit != 0) if any tables/columns/indexes are missing,
# so schema-drift is caught here instead of surfacing as "Kunde inte hämta data"
# in production. See scripts/schema-drift-check.ts (registered validation: schema-drift).
if [ -n "$DATABASE_URL" ]; then
  echo "[post-merge] Running schema-drift check"
  npx tsx scripts/schema-drift-check.ts
else
  echo "[post-merge] DATABASE_URL unset — skipping schema-drift check"
fi
