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
           migrations/0064_work_order_lines_freetext.sql \
           migrations/0065_order_concept_7step.sql \
           migrations/0066_session11_registers.sql \
           migrations/0067_order_concept_customer_metadata_field.sql \
           migrations/0068_invoice_brake.sql \
           migrations/0069_order_concept_interval_flex_days.sql \
           migrations/0070_articles_session13_fields.sql \
           migrations/0071_weekly_planning_foundation.sql \
           migrations/0072_object_import_sessions.sql \
           migrations/0073_object_import_rows.sql \
           migrations/0074_article_types_and_extern_info.sql \
           migrations/0075_article_association_rules.sql \
           migrations/0076_article_phase3_time_structure.sql \
           migrations/0077_article_geo_dependent.sql \
           migrations/0078_article_quantity_perm_required_leave.sql \
           migrations/0079_disruptions.sql \
           migrations/0080_order_concept_delivery_time_metadata_field.sql \
           migrations/0081_unique_business_numbers.sql \
           migrations/0082_perf_tenant_geo_indexes.sql \
           migrations/0083_object_hierarchy_cycle_guard.sql \
           migrations/0084_tenant_index_completion.sql \
           migrations/0085_task_types.sql \
           migrations/0086_article_layout_spec_fields.sql \
           migrations/0087_article_quantity_formula.sql \
           migrations/0088_import_sessions_customer_nullable.sql \
           migrations/0089_objects_customer_nullable.sql \
           migrations/0090_reversible_import_actions.sql \
           migrations/0091_order_concept_target_object_ids.sql \
           migrations/0091_work_order_completed_resources.sql \
           migrations/0092_article_freight_warehouse_cost.sql \
           migrations/0093_execution_code_icon_registers.sql \
           migrations/0094_assignments_customer_id.sql \
           migrations/0095_article_hide_quantity_in_app.sql \
           migrations/0096_metadata_editors.sql \
           migrations/0097_invoice_flow_segmentation.sql \
           migrations/0098_order_concept_main_delivery_windows.sql \
           migrations/0099_logistics_pickup_return.sql \
           migrations/0100_objects_location_type.sql \
           migrations/0101_teams_cost_center.sql \
           migrations/0101_frozen_time_rules.sql \
           migrations/0102_order_concept_wizard_step_version.sql \
           migrations/0103_slot_times.sql \
           migrations/0104_planning_parameters_grouping_radius.sql \
           migrations/0105_slot_times_planner_decision.sql; do
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

# Task #835: paritetstest mellan legacy-fasthakning och den nya regelbaserade resolvern.
# Körs efter migration 0075 (back-fill av association_rules). Icke-blockerande: rapporterar
# avvikelser HÖGT i loggen utan att brick:a reconciliationen. Eventuella avvikelser måste
# utredas innan gamla kolumner tas bort (Fas 3, Task #836).
if [ -n "$DATABASE_URL" ]; then
  echo "[post-merge] Running article association parity check (Task #835)"
  npx tsx scripts/article-association-parity-check.ts \
    || echo "[post-merge] ⚠⚠ ARTIKEL-ASSOCIATION PARITET: avvikelser upptäckta — se loggen ovan. Blockerar ej, men måste utredas före Fas 3."
fi

# Task #992: backfilla det avvecklade ENGELSKA metadata-systemet (object_metadata)
# in i den kanoniska SVENSKA katalogen (metadata_varden) så att import,
# villkorsfilter, arv och export läser EN källa. Idempotent: skriver aldrig över
# befintliga svenska värden och hoppar över rader som redan migrerats, så
# upprepade körningar (varje merge/deploy) är säkra. Icke-blockerande.
if [ -n "$DATABASE_URL" ]; then
  echo "[post-merge] Backfilling legacy English metadata into Swedish katalog (Task #992)"
  npx tsx scripts/backfill-english-metadata-to-swedish.ts --confirm \
    || echo "[post-merge] ⚠ METADATA-BACKFILL misslyckades — se loggen ovan. Blockerar ej, men måste utredas."
fi
