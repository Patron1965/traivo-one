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
           migrations/0054_schema_drift_consolidation_import_batch.sql; do
    if [ -f "$f" ]; then
      echo "[post-merge] Applying $f"
      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    fi
  done
else
  echo "[post-merge] psql not available or DATABASE_URL unset — skipping raw SQL index migrations"
fi
