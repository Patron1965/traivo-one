/**
 * scripts/kinab-reset-phases.ts
 *
 * Delad sanning för operativ-reset-scopet (KINAB). Importeras av både:
 *   - scripts/kinab-reset-operational-data.ts        (kör mot DEV / DATABASE_URL)
 *   - scripts/kinab-reset-prod-operational-data.ts   (kör mot PROD / PROD_DATABASE_URL)
 *
 * Denna modul har INGA sidoeffekter (ingen DB-anslutning, ingen main()).
 * Ändra raderingsscopet HÄR — aldrig på två ställen — så att dev och prod
 * alltid rensar exakt samma sak.
 *
 * BEHÅLLER (config/master): tenants, users, user_tenant_roles, resources,
 *   branding_templates, tenant_branding, articles, article_components,
 *   metadata_katalog, fortnox-config, tenant-features/moduler, audit_logs,
 *   tenant-prislistor (customer_id IS NULL).
 * RADERAR (operativt): work_orders + barn, objects + barn, customers + barn,
 *   import_batches, fortnox_invoice_exports, notifications, ai-tips, kund-prislistor.
 */

export interface ResetPhase {
  name: string;
  /** [tabellnamn, where-clause]. where körs ordagrant som `DELETE FROM "tabell" WHERE <where>`. */
  tables: Array<[string, string]>;
}

/** Demo-resurser som seedDatabase() annars återskapar (städas i Fas H). */
export const DEMO_RESOURCE_IDS = ["res-tomas", "res-anna"] as const;

/**
 * Bygger fas-listan (FK-säker raderingsordning: barn före föräldrar) för en
 * given tenant. `tenant` interpoleras in i SQL och MÅSTE vara en betrodd
 * literal (aldrig användarinput) — anropas alltid med "kinab".
 */
export function buildResetPhases(tenant: string): ResetPhase[] {
  const demoIds = DEMO_RESOURCE_IDS.map((id) => `'${id}'`).join(",");
  return [
    {
      name: "Fas A: Barn till work_orders",
      tables: [
        // Måste raderas FÖRE deviation_reports (FK linked_deviation_id → deviation_reports, NO ACTION).
        ["customer_change_requests", `tenant_id = '${tenant}'`],
        ["public_issue_reports", `tenant_id = '${tenant}'`],
        ["order_checklist_items", `work_order_id IN (SELECT id FROM work_orders WHERE tenant_id = '${tenant}')`],
        ["work_order_lines", `tenant_id = '${tenant}'`],
        ["work_order_objects", `tenant_id = '${tenant}'`],
        ["work_order_dependencies", `tenant_id = '${tenant}'`],
        ["task_dependencies", `tenant_id = '${tenant}'`],
        ["task_dependency_instances", `tenant_id = '${tenant}'`],
        ["task_desired_timewindows", `tenant_id = '${tenant}'`],
        ["task_information", `tenant_id = '${tenant}'`],
        ["task_metadata_updates", `tenant_id = '${tenant}'`],
        ["work_entries", `tenant_id = '${tenant}'`],
        ["protocols", `tenant_id = '${tenant}'`],
        ["deviation_reports", `tenant_id = '${tenant}'`],
        ["environmental_data", `tenant_id = '${tenant}'`],
        ["inspection_metadata", `tenant_id = '${tenant}'`],
        ["invoice_recalculation_log", `tenant_id = '${tenant}'`],
        ["urgent_job_assignments", `tenant_id = '${tenant}'`],
        ["setup_time_logs", `tenant_id = '${tenant}'`],
        ["ml_feature_snapshots", `tenant_id = '${tenant}'`],
        ["metadata_varden", `tenant_id = '${tenant}'`],
        ["eta_notifications", `tenant_id = '${tenant}'`],
        ["visit_confirmations", `tenant_id = '${tenant}'`],
        ["customer_communications", `tenant_id = '${tenant}'`],
        ["customer_booking_requests", `tenant_id = '${tenant}'`],
        ["fortnox_invoice_exports", `tenant_id = '${tenant}'`],
        ["fortnox_contract_suggestions", `tenant_id = '${tenant}'`],
      ],
    },
    {
      name: "Fas B: work_orders",
      tables: [["work_orders", `tenant_id = '${tenant}'`]],
    },
    {
      name: "Fas C: Barn till objects (utöver det som redan rensats)",
      tables: [
        ["order_concept_objects", `object_id IN (SELECT id FROM objects WHERE tenant_id = '${tenant}')`],
        ["portal_user_object_scopes", `object_id IN (SELECT id FROM objects WHERE tenant_id = '${tenant}')`],
        ["object_contacts", `tenant_id = '${tenant}'`],
        ["object_images", `tenant_id = '${tenant}'`],
        ["object_metadata", `tenant_id = '${tenant}'`],
        ["metadata_editor_submissions", `object_id IN (SELECT id FROM objects WHERE tenant_id = '${tenant}')`],
        ["object_articles", `tenant_id = '${tenant}'`],
        ["object_payers", `tenant_id = '${tenant}'`],
        ["object_time_restrictions", `tenant_id = '${tenant}'`],
        ["object_parents", `tenant_id = '${tenant}'`],
        ["metadata_historik", `tenant_id = '${tenant}'`],
        ["assignment_articles", `assignment_id IN (SELECT id FROM assignments WHERE tenant_id = '${tenant}')`],
        ["assignments", `tenant_id = '${tenant}'`],
        ["iot_signals", `tenant_id = '${tenant}'`],
        ["iot_devices", `tenant_id = '${tenant}'`],
        ["predictive_forecasts", `tenant_id = '${tenant}'`],
        ["qr_code_links", `tenant_id = '${tenant}'`],
        ["self_bookings", `tenant_id = '${tenant}'`],
        ["subscription_changes", `tenant_id = '${tenant}'`],
        ["subscriptions", `tenant_id = '${tenant}'`],
        ["customer_issue_reports", `tenant_id = '${tenant}'`],
        ["annual_goals", `tenant_id = '${tenant}'`],
        ["planning_parameters", `tenant_id = '${tenant}'`],
        // Orderkoncept (operativa tjänste-definitioner) — raderas EFTER assignments
        // (FK assignments.order_concept_id) men FÖRE clusters/price_lists (Fas E).
        // CASCADE-barn (order_concept_articles, *_configurations, delivery_schedules)
        // försvinner automatiskt; concept_filters/invoice_rules/order_concept_run_logs
        // är NO ACTION och måste raderas explicit först.
        ["concept_filters", `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = '${tenant}')`],
        ["invoice_rules", `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = '${tenant}')`],
        ["order_concept_run_logs", `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = '${tenant}')`],
        ["order_concepts", `tenant_id = '${tenant}'`],
      ],
    },
    {
      name: "Fas D: objects",
      tables: [
        ["objects", `tenant_id = '${tenant}' AND parent_id IS NOT NULL`],
        ["objects", `tenant_id = '${tenant}'`],
      ],
    },
    {
      name: "Fas E: Barn till customers (utöver det som redan rensats)",
      tables: [
        // Kund-barn med hård FK → customers/invoice_recipients. Raderas FÖRE customers (Fas F).
        // invoice_consolidation_policies FÖRE invoice_recipients (FK invoice_recipient_id, NO ACTION).
        ["invoice_consolidation_policies", `tenant_id = '${tenant}'`],
        ["invoice_recipients", `tenant_id = '${tenant}'`],
        ["customer_import_mappings", `tenant_id = '${tenant}'`],
        ["import_sessions", `tenant_id = '${tenant}'`],
        ["clusters", `tenant_id = '${tenant}'`],
        ["customer_invoices", `tenant_id = '${tenant}'`],
        ["customer_notification_settings", `tenant_id = '${tenant}'`],
        ["customer_portal_messages", `tenant_id = '${tenant}'`],
        ["customer_portal_sessions", `tenant_id = '${tenant}'`],
        ["customer_portal_tokens", `tenant_id = '${tenant}'`],
        ["customer_service_contracts", `tenant_id = '${tenant}'`],
        ["manual_invoice_lines", `tenant_id = '${tenant}'`],
        ["portal_messages", `tenant_id = '${tenant}'`],
        ["portal_users", `tenant_id = '${tenant}'`],
        ["price_list_articles", `price_list_id IN (SELECT id FROM price_lists WHERE tenant_id = '${tenant}' AND customer_id IS NOT NULL)`],
        ["price_lists", `tenant_id = '${tenant}' AND customer_id IS NOT NULL`],
        ["procurements", `tenant_id = '${tenant}'`],
        ["technician_ratings", `tenant_id = '${tenant}'`],
      ],
    },
    {
      name: "Fas F: customers",
      tables: [["customers", `tenant_id = '${tenant}'`]],
    },
    {
      name: "Fas G: Övrigt operativt skräp",
      tables: [
        ["import_batches", `tenant_id = '${tenant}'`],
        ["notifications", `tenant_id = '${tenant}'`],
      ],
    },
    {
      // Demo-resurser/-kluster som annars återskapas av seedDatabase() samt
      // föräldralösa Fortnox-mappningar (kund-mappningar blir orphans när alla
      // kunder raderats). Giltiga article/resource-mappningar lämnas i fred.
      name: "Fas H: Demo-rester + föräldralösa mappningar",
      tables: [
        ["team_members", `resource_id IN (${demoIds})`],
        ["resource_articles", `resource_id IN (${demoIds})`],
        ["resource_vehicles", `resource_id IN (${demoIds})`],
        ["resource_equipment", `resource_id IN (${demoIds})`],
        ["resource_availability", `resource_id IN (${demoIds})`],
        ["resource_positions", `resource_id IN (${demoIds})`],
        ["resource_profile_assignments", `resource_id IN (${demoIds})`],
        ["push_tokens", `resource_id IN (${demoIds})`],
        ["mobile_user_preferences", `resource_id IN (${demoIds})`],
        ["recurring_slot_patterns", `resource_id IN (${demoIds})`],
        ["equipment_bookings", `resource_id IN (${demoIds})`],
        ["work_sessions", `resource_id IN (${demoIds})`],
        ["time_logs", `resource_id IN (${demoIds})`],
        ["self_booking_slots", `resource_id IN (${demoIds})`],
        ["resources", `tenant_id = '${tenant}' AND id IN (${demoIds})`],
        ["clusters", `tenant_id = '${tenant}' AND (id LIKE 'cluster-telge-%' OR id = 'cluster-kommun')`],
        [
          "fortnox_mappings",
          `tenant_id = '${tenant}' AND (
            (entity_type = 'customer' AND unicorn_id NOT IN (SELECT id FROM customers WHERE tenant_id = '${tenant}')) OR
            (entity_type = 'article'  AND unicorn_id NOT IN (SELECT id FROM articles  WHERE tenant_id = '${tenant}')) OR
            (entity_type = 'resource' AND unicorn_id NOT IN (SELECT id FROM resources WHERE tenant_id = '${tenant}'))
          )`,
        ],
      ],
    },
  ];
}

/**
 * Nollställer dingande FK-pekare FRÅN behållen config (teams, users) till rader
 * som raderas i faserna. Måste köras FÖRE fas-DELETE:erna eftersom dessa FK är
 * NO ACTION (ingen auto-null sker). teams/users BEHÅLLS — bara pekarna nollas:
 *   - teams.cluster_id  → clusters som raderas i Fas E
 *   - teams.leader_id   → demo-resurser som raderas i Fas H
 *   - users.resource_id → demo-resurser som raderas i Fas H
 */
export function buildPreDeleteUpdates(tenant: string): Array<{ label: string; sql: string }> {
  const demoIds = DEMO_RESOURCE_IDS.map((id) => `'${id}'`).join(",");
  return [
    {
      label: "teams.cluster_id (→ raderade kluster)",
      sql: `UPDATE "teams" SET cluster_id = NULL WHERE tenant_id = '${tenant}' AND cluster_id IS NOT NULL`,
    },
    {
      label: "teams.leader_id (→ demo-resurser)",
      sql: `UPDATE "teams" SET leader_id = NULL WHERE tenant_id = '${tenant}' AND leader_id IN (${demoIds})`,
    },
    {
      label: "users.resource_id (→ demo-resurser)",
      sql: `UPDATE "users" SET resource_id = NULL WHERE resource_id IN (${demoIds})`,
    },
  ];
}
