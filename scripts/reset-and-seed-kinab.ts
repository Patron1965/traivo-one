/**
 * scripts/reset-and-seed-kinab.ts
 *
 * DESTRUCTIVE: Wipes ALL business data from the database and seeds it with a
 * single tenant ("Kinab") plus the two known Kinab users.
 *
 * Usage:
 *   CONFIRM_WIPE=yes tsx scripts/reset-and-seed-kinab.ts
 *
 * Tables preserved:
 *   - sessions            (kept, but rows DELETEd)
 *   - __drizzle_migrations (kept untouched)
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const KINAB_TENANT_ID = "kinab";
const ANNA_USER_ID = "42556180";
const PATRIK_USER_ID = "11fcd575-49e3-44dd-94ac-fa73f3bc6790";

const PRESERVED_TABLES = new Set<string>([
  "sessions",
  "__drizzle_migrations",
]);

async function main() {
  if (process.env.CONFIRM_WIPE !== "yes") {
    console.error("Refusing to run: set CONFIRM_WIPE=yes to confirm.");
    process.exit(1);
  }

  console.log("Fetching list of all public tables...");
  const tablesResult = await db.execute(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  `);
  const allTables = (tablesResult.rows as Array<{ tablename: string }>).map(
    (r) => r.tablename
  );
  const wipeTables = allTables.filter((t) => !PRESERVED_TABLES.has(t));
  console.log(
    `Found ${allTables.length} tables; wiping ${wipeTables.length}, preserving ${PRESERVED_TABLES.size}.`
  );

  await db.transaction(async (tx) => {
    console.log("Disabling FK checks for this transaction...");
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);

    const quoted = wipeTables.map((t) => `"${t}"`).join(", ");
    console.log("TRUNCATE all business tables...");
    await tx.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`));

    console.log("DELETE FROM sessions...");
    await tx.execute(sql`DELETE FROM sessions`);

    console.log("Re-enabling FK checks...");
    await tx.execute(sql`SET LOCAL session_replication_role = 'origin'`);

    console.log("Inserting Kinab tenant...");
    await tx.execute(sql`
      INSERT INTO tenants (id, name, org_number, contact_email, settings, industry, created_at)
      VALUES (
        ${KINAB_TENANT_ID},
        'Kinab',
        NULL,
        'info@kinab.se',
        '{}'::jsonb,
        'fastighetsservice',
        NOW()
      )
    `);

    console.log("Inserting users (Anna, Patrik)...");
    await tx.execute(sql`
      INSERT INTO users (id, email, first_name, last_name, role, is_active, created_at, updated_at)
      VALUES
        (${ANNA_USER_ID},   'anna@kinab.se',             'Anna',   'Andersson', 'admin', true, NOW(), NOW()),
        (${PATRIK_USER_ID}, 'patrik.rosengren@kinab.se', 'Patrik', 'Rosengren', 'admin', true, NOW(), NOW())
    `);

    console.log("Linking users to Kinab tenant...");
    await tx.execute(sql`
      INSERT INTO user_tenant_roles (user_id, tenant_id, role, is_active, created_at)
      VALUES
        (${ANNA_USER_ID},   ${KINAB_TENANT_ID}, 'owner', true, NOW()),
        (${PATRIK_USER_ID}, ${KINAB_TENANT_ID}, 'admin', true, NOW())
    `);

    console.log("Creating default tenant_features row...");
    await tx.execute(sql`
      INSERT INTO tenant_features (tenant_id, package_tier, enabled_modules, custom_overrides, updated_at)
      VALUES (
        ${KINAB_TENANT_ID},
        'premium',
        ARRAY['core','iot','annual_planning','ai_planning','fleet','environmental','customer_portal','invoicing','predictive','work_sessions','order_concepts','inspections','sms','route_feedback','equipment_sharing','roi_reports']::text[],
        '{}'::jsonb,
        NOW()
      )
    `);

    console.log("Creating default tenant_branding row...");
    await tx.execute(sql`
      INSERT INTO tenant_branding (tenant_id, version, is_published, primary_color, secondary_color, accent_color, success_color, error_color, font_family, company_name, dark_mode_enabled, created_at, updated_at)
      VALUES (
        ${KINAB_TENANT_ID},
        1,
        true,
        '#3B82F6',
        '#6366F1',
        '#F59E0B',
        '#22C55E',
        '#EF4444',
        'Inter',
        'Kinab',
        true,
        NOW(),
        NOW()
      )
    `);
  });

  console.log("\n=== Reset complete ===");
  const counts = await db.execute(sql`
    SELECT 'tenants' AS t, COUNT(*)::int AS c FROM tenants
    UNION ALL SELECT 'users', COUNT(*)::int FROM users
    UNION ALL SELECT 'user_tenant_roles', COUNT(*)::int FROM user_tenant_roles
    UNION ALL SELECT 'tenant_features', COUNT(*)::int FROM tenant_features
    UNION ALL SELECT 'tenant_branding', COUNT(*)::int FROM tenant_branding
    UNION ALL SELECT 'customers', COUNT(*)::int FROM customers
    UNION ALL SELECT 'objects', COUNT(*)::int FROM objects
    UNION ALL SELECT 'work_orders', COUNT(*)::int FROM work_orders
    UNION ALL SELECT 'resources', COUNT(*)::int FROM resources
    UNION ALL SELECT 'clusters', COUNT(*)::int FROM clusters
    UNION ALL SELECT 'sessions', COUNT(*)::int FROM sessions
  `);
  for (const row of counts.rows as Array<{ t: string; c: number }>) {
    console.log(`  ${row.t.padEnd(22)} ${row.c}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
