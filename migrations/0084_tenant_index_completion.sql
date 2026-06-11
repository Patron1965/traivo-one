-- Å3 (komplettering): tenant_id-index på ALLA återstående tenant-skopade tabeller
-- som migration 0082 inte täckte, så att korstenant-filtrering är indexerad
-- defense-in-depth överallt (multi-tenant SaaS). Plus komposit work_orders
-- (tenant_id, status) — 0082:s rad var en no-op eftersom indexnamnet redan fanns
-- på (tenant_id, order_status); livscykel-kolumnen `status` (active/…) saknade
-- alltså egen komposit. Alla idempotenta (CREATE INDEX IF NOT EXISTS), inga
-- schema.ts-ändringar krävs (schema-drift flaggar bara index som finns i
-- schema.ts men saknas i DB).

CREATE INDEX IF NOT EXISTS idx_api_budgets_tenant ON api_budgets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_booking_requests_tenant ON customer_booking_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_issue_reports_tenant ON customer_issue_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_notification_settings_tenant ON customer_notification_settings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_portal_messages_tenant ON customer_portal_messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_tenant ON customer_portal_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_portal_tokens_tenant ON customer_portal_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_service_contracts_tenant ON customer_service_contracts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_deviation_reports_tenant ON deviation_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_environmental_data_tenant ON environmental_data (tenant_id);
CREATE INDEX IF NOT EXISTS idx_feature_audit_log_tenant ON feature_audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fuel_logs_tenant ON fuel_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_column_mappings_tenant ON import_column_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_tenant ON magic_link_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_logs_tenant ON maintenance_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_planning_decision_log_tenant ON planning_decision_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_planning_parameters_tenant ON planning_parameters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_portal_messages_tenant ON portal_messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_procurements_tenant ON procurements (tenant_id);
CREATE INDEX IF NOT EXISTS idx_protocols_tenant ON protocols (tenant_id);
CREATE INDEX IF NOT EXISTS idx_public_issue_reports_tenant ON public_issue_reports (tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_tenant ON push_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_qr_code_links_tenant ON qr_code_links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_resource_availability_tenant ON resource_availability (tenant_id);
CREATE INDEX IF NOT EXISTS idx_roi_share_tokens_tenant ON roi_share_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_self_booking_slots_tenant ON self_booking_slots (tenant_id);
CREATE INDEX IF NOT EXISTS idx_self_bookings_tenant ON self_bookings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_setup_time_logs_tenant ON setup_time_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_simulation_scenarios_tenant ON simulation_scenarios (tenant_id);
CREATE INDEX IF NOT EXISTS idx_structural_articles_tenant ON structural_articles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_technician_ratings_tenant ON technician_ratings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_schedule_tenant ON vehicle_schedule (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_visit_confirmations_tenant ON visit_confirmations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_entries_tenant ON work_entries (tenant_id);

-- Komposit på livscykel-status (skild från idx_work_orders_tenant_status som
-- ligger på order_status — Modus-workflowstatus).
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_lifecycle_status ON work_orders (tenant_id, status);
