import { db } from "../db";
import { sql } from "drizzle-orm";

async function verifyDataIntegrity() {
  console.log("=== Data Integrity Verification ===\n");

  const checks = [
    {
      name: "work_orders.cluster_id -> clusters.id",
      query: sql`SELECT COUNT(*) as count FROM work_orders wo WHERE wo.cluster_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clusters c WHERE c.id = wo.cluster_id)`,
    },
    {
      name: "work_orders.object_id -> objects.id",
      query: sql`SELECT COUNT(*) as count FROM work_orders wo WHERE wo.object_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.id = wo.object_id)`,
    },
    {
      name: "work_orders.resource_id -> resources.id",
      query: sql`SELECT COUNT(*) as count FROM work_orders wo WHERE wo.resource_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM resources r WHERE r.id = wo.resource_id)`,
    },
    {
      name: "environmental_data.work_order_id -> work_orders.id",
      query: sql`SELECT COUNT(*) as count FROM environmental_data ed WHERE ed.work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM work_orders wo WHERE wo.id = ed.work_order_id)`,
    },
    {
      name: "environmental_data.vehicle_id -> vehicles.id",
      query: sql`SELECT COUNT(*) as count FROM environmental_data ed WHERE ed.vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = ed.vehicle_id)`,
    },
    {
      name: "visit_confirmations.work_order_id -> work_orders.id",
      query: sql`SELECT COUNT(*) as count FROM visit_confirmations vc WHERE vc.work_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM work_orders wo WHERE wo.id = vc.work_order_id)`,
    },
    {
      name: "work_orders with invalid order_status values",
      query: sql`SELECT COUNT(*) as count FROM work_orders WHERE order_status NOT IN ('skapad', 'planerad_pre', 'planerad_resurs', 'planerad_las', 'utford', 'fakturerad', 'omojlig')`,
    },
  ];

  let allPassed = true;

  for (const check of checks) {
    const result = await db.execute(check.query);
    const rows = result.rows || result;
    const firstRow = Array.isArray(rows) ? rows[0] : rows;
    const count = Number((firstRow as Record<string, unknown>)?.count ?? 0);
    const status = count === 0 ? "PASS" : "FAIL";
    if (count > 0) allPassed = false;
    console.log(`[${status}] ${check.name}: ${count} orphaned records`);
  }

  console.log(`\n=== Result: ${allPassed ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} ===`);

  if (!allPassed) {
    console.log("\nTo fix orphaned records, run cleanup queries:");
    console.log("  UPDATE work_orders SET cluster_id = NULL WHERE cluster_id IS NOT NULL AND cluster_id NOT IN (SELECT id FROM clusters);");
    console.log("  UPDATE environmental_data SET work_order_id = NULL WHERE work_order_id IS NOT NULL AND work_order_id NOT IN (SELECT id FROM work_orders);");
    console.log("  UPDATE environmental_data SET vehicle_id = NULL WHERE vehicle_id IS NOT NULL AND vehicle_id NOT IN (SELECT id FROM vehicles);");
    console.log("  UPDATE visit_confirmations SET work_order_id = NULL WHERE work_order_id IS NOT NULL AND work_order_id NOT IN (SELECT id FROM work_orders);");
  }

  process.exit(allPassed ? 0 : 1);
}

verifyDataIntegrity().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
