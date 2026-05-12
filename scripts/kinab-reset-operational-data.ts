/**
 * scripts/kinab-reset-operational-data.ts
 *
 * Rensar operativt kunddata för tenant 'kinab' inför pilotstart.
 *
 * BEHÅLLER (config/master):
 *   - tenants, users, user_tenant_roles
 *   - resources, branding_templates, tenant_branding
 *   - articles, article_components, metadata_katalog
 *   - fortnox_mappings, tenant-features/moduler
 *   - audit_logs (historikbevarande)
 *
 * RADERAR (operativt):
 *   - work_orders + alla barnrader
 *   - objects + alla barnrader
 *   - customers + alla barnrader (utom audit_logs)
 *   - import_batches, fortnox_invoice_exports, notifications, ai-tips
 *
 * Användning:
 *   npx tsx scripts/kinab-reset-operational-data.ts                # dry-run
 *   npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TENANT = "kinab";
const args = process.argv.slice(2);
const confirmIdx = args.indexOf("--confirm");
const confirmToken = confirmIdx >= 0 ? args[confirmIdx + 1] : null;
const DRY_RUN = confirmToken !== "RENSA-KINAB";

// Tabeller som ska tömmas i ordning (FK-säker ordning).
// Format: [tabellnamn, where-clause]
//   - om tabellen har tenant_id används det
//   - annars används parent-FK till en redan rensad tabell (work_orders/objects)
const PHASES: Array<{ name: string; tables: Array<[string, string]> }> = [
  {
    name: "Fas A: Barn till work_orders",
    tables: [
      ["order_checklist_items", `work_order_id IN (SELECT id FROM work_orders WHERE tenant_id = '${TENANT}')`],
      ["work_order_lines", `tenant_id = '${TENANT}'`],
      ["work_order_objects", `tenant_id = '${TENANT}'`],
      ["work_order_dependencies", `tenant_id = '${TENANT}'`],
      ["task_dependencies", `tenant_id = '${TENANT}'`],
      ["task_dependency_instances", `tenant_id = '${TENANT}'`],
      ["task_desired_timewindows", `tenant_id = '${TENANT}'`],
      ["task_information", `tenant_id = '${TENANT}'`],
      ["task_metadata_updates", `tenant_id = '${TENANT}'`],
      ["work_entries", `tenant_id = '${TENANT}'`],
      ["protocols", `tenant_id = '${TENANT}'`],
      ["deviation_reports", `tenant_id = '${TENANT}'`],
      ["environmental_data", `tenant_id = '${TENANT}'`],
      ["inspection_metadata", `tenant_id = '${TENANT}'`],
      ["invoice_recalculation_log", `tenant_id = '${TENANT}'`],
      ["urgent_job_assignments", `tenant_id = '${TENANT}'`],
      ["setup_time_logs", `tenant_id = '${TENANT}'`],
      ["ml_feature_snapshots", `tenant_id = '${TENANT}'`],
      ["metadata_varden", `tenant_id = '${TENANT}'`],
      ["eta_notifications", `tenant_id = '${TENANT}'`],
      ["visit_confirmations", `tenant_id = '${TENANT}'`],
      ["customer_communications", `tenant_id = '${TENANT}'`],
      ["customer_booking_requests", `tenant_id = '${TENANT}'`],
      ["fortnox_invoice_exports", `tenant_id = '${TENANT}'`],
      ["fortnox_contract_suggestions", `tenant_id = '${TENANT}'`],
    ],
  },
  {
    name: "Fas B: work_orders",
    tables: [
      ["work_orders", `tenant_id = '${TENANT}'`],
    ],
  },
  {
    name: "Fas C: Barn till objects (utöver det som redan rensats)",
    tables: [
      ["order_concept_objects", `object_id IN (SELECT id FROM objects WHERE tenant_id = '${TENANT}')`],
      ["portal_user_object_scopes", `object_id IN (SELECT id FROM objects WHERE tenant_id = '${TENANT}')`],
      ["object_contacts", `tenant_id = '${TENANT}'`],
      ["object_images", `tenant_id = '${TENANT}'`],
      ["object_metadata", `tenant_id = '${TENANT}'`],
      ["object_articles", `tenant_id = '${TENANT}'`],
      ["object_payers", `tenant_id = '${TENANT}'`],
      ["object_time_restrictions", `tenant_id = '${TENANT}'`],
      ["object_parents", `tenant_id = '${TENANT}'`],
      ["metadata_historik", `tenant_id = '${TENANT}'`],
      ["assignments", `tenant_id = '${TENANT}'`],
      ["iot_devices", `tenant_id = '${TENANT}'`],
      ["predictive_forecasts", `tenant_id = '${TENANT}'`],
      ["qr_code_links", `tenant_id = '${TENANT}'`],
      ["public_issue_reports", `tenant_id = '${TENANT}'`],
      ["self_bookings", `tenant_id = '${TENANT}'`],
      ["subscription_changes", `tenant_id = '${TENANT}'`],
      ["subscriptions", `tenant_id = '${TENANT}'`],
      ["customer_change_requests", `tenant_id = '${TENANT}'`],
      ["customer_issue_reports", `tenant_id = '${TENANT}'`],
      ["annual_goals", `tenant_id = '${TENANT}'`],
      ["planning_parameters", `tenant_id = '${TENANT}'`],
    ],
  },
  {
    name: "Fas D: objects",
    tables: [
      ["objects", `tenant_id = '${TENANT}' AND parent_id IS NOT NULL`],
      ["objects", `tenant_id = '${TENANT}'`],
    ],
  },
  {
    name: "Fas E: Barn till customers (utöver det som redan rensats)",
    tables: [
      ["clusters", `tenant_id = '${TENANT}'`],
      ["customer_invoices", `tenant_id = '${TENANT}'`],
      ["customer_notification_settings", `tenant_id = '${TENANT}'`],
      ["customer_portal_messages", `tenant_id = '${TENANT}'`],
      ["customer_portal_sessions", `tenant_id = '${TENANT}'`],
      ["customer_portal_tokens", `tenant_id = '${TENANT}'`],
      ["customer_service_contracts", `tenant_id = '${TENANT}'`],
      ["manual_invoice_lines", `tenant_id = '${TENANT}'`],
      ["portal_messages", `tenant_id = '${TENANT}'`],
      ["portal_users", `tenant_id = '${TENANT}'`],
      ["price_lists", `tenant_id = '${TENANT}' AND customer_id IS NOT NULL`],
      ["procurements", `tenant_id = '${TENANT}'`],
      ["technician_ratings", `tenant_id = '${TENANT}'`],
    ],
  },
  {
    name: "Fas F: customers",
    tables: [
      ["customers", `tenant_id = '${TENANT}'`],
    ],
  },
  {
    name: "Fas G: Övrigt operativt skräp",
    tables: [
      ["import_batches", `tenant_id = '${TENANT}'`],
      ["notifications", `tenant_id = '${TENANT}'`],
    ],
  },
];

async function tableExists(name: string): Promise<boolean> {
  const r: any = await db.execute(
    sql`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${name} LIMIT 1`
  );
  return (r.rows ?? r).length > 0;
}

async function count(table: string, where: string): Promise<number> {
  try {
    const r: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${where}`));
    const rows = r.rows ?? r;
    return Number(rows[0]?.n ?? 0);
  } catch (e: any) {
    console.warn(`  ! kunde inte räkna ${table}: ${e.message}`);
    return -1;
  }
}

async function del(table: string, where: string): Promise<number> {
  const r: any = await db.execute(sql.raw(`DELETE FROM "${table}" WHERE ${where}`));
  return r.rowCount ?? 0;
}

async function snapshot(label: string) {
  console.log(`\n=== ${label} ===`);
  const stats = await db.execute(sql.raw(`
    SELECT
      (SELECT COUNT(*) FROM customers WHERE tenant_id='${TENANT}') AS customers,
      (SELECT COUNT(*) FROM objects WHERE tenant_id='${TENANT}') AS objects,
      (SELECT COUNT(*) FROM work_orders WHERE tenant_id='${TENANT}') AS work_orders,
      (SELECT COUNT(*) FROM import_batches WHERE tenant_id='${TENANT}') AS import_batches
  `));
  console.log((stats as any).rows ?? stats);
}

async function main() {
  console.log("=".repeat(60));
  console.log(`KINAB OPERATIONAL DATA RESET — tenant='${TENANT}'`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (ingen radering körs)" : "SKARP RADERING"}`);
  console.log("=".repeat(60));

  await snapshot("Före (nuläge)");

  let totalRows = 0;

  for (const phase of PHASES) {
    console.log(`\n--- ${phase.name} ---`);
    for (const [table, where] of phase.tables) {
      if (!(await tableExists(table))) {
        console.log(`  · ${table.padEnd(40)} (saknas — hoppar över)`);
        continue;
      }
      const n = await count(table, where);
      if (n < 0) continue;
      if (n === 0) {
        console.log(`  · ${table.padEnd(40)} 0`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  · ${table.padEnd(40)} ${n.toString().padStart(7)} (skulle raderas)`);
      } else {
        const deleted = await del(table, where);
        console.log(`  ✓ ${table.padEnd(40)} ${deleted.toString().padStart(7)} raderade`);
        totalRows += deleted;
      }
    }
  }

  if (DRY_RUN) {
    console.log("\n" + "=".repeat(60));
    console.log("DRY-RUN klar. Inget raderades.");
    console.log("För att köra skarpt:");
    console.log("  npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB");
    console.log("=".repeat(60));
  } else {
    await snapshot("Efter (resultat)");
    console.log("\n" + "=".repeat(60));
    console.log(`KLART. Totalt ${totalRows} rader raderade för tenant '${TENANT}'.`);
    console.log("=".repeat(60));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FEL:", e);
  process.exit(1);
});
