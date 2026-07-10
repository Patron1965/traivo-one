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
 *   - sessions             (kept, but rows DELETEd)
 *   - __drizzle_migrations (kept untouched)
 *
 * Before any destructive work runs, the script writes a full pg_dump backup
 * to .local/backups/before-reset-<timestamp>.sql and prints the path.
 *
 * The list of tables to truncate is derived from the drizzle pgTable
 * declarations exported by shared/schema.ts (NOT from information_schema), so
 * the script always matches the application's schema source of truth.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../server/db";
import { sql, getTableName, isTable, type Table } from "drizzle-orm";
import * as schema from "../shared/schema";

const KINAB_TENANT_ID = "kinab";
const ANNA_USER_ID = "42556180";
const PATRIK_USER_ID = "11fcd575-49e3-44dd-94ac-fa73f3bc6790";

const PRESERVED_TABLES = new Set<string>([
  "sessions",
  "__drizzle_migrations",
]);

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function takeBackup(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL must be set to run pg_dump backup.");
  }
  const dir = resolve(".local/backups");
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/before-reset-${timestamp()}.sql`;
  console.log(`Writing pg_dump backup to ${file} ...`);
  // pg_dump from the local nix environment; --no-owner keeps it portable.
  execFileSync(
    "pg_dump",
    ["--no-owner", "--no-acl", "--format=plain", `--file=${file}`, dbUrl],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  const size = statSync(file).size;
  console.log(`Backup written (${size} bytes): ${file}`);
  return file;
}

function collectSchemaTableNames(): string[] {
  const names = new Set<string>();
  for (const value of Object.values(schema as Record<string, unknown>)) {
    if (isTable(value)) {
      const table: Table = value;
      names.add(getTableName(table));
    }
  }
  return Array.from(names).sort();
}

async function main() {
  if (process.env.CONFIRM_WIPE !== "yes") {
    console.error("Refusing to run: set CONFIRM_WIPE=yes to confirm.");
    process.exit(1);
  }

  // 1. Backup first.
  const backupPath = takeBackup();

  // 2. Derive table list from shared/schema.ts pgTable declarations.
  const schemaTables = collectSchemaTableNames();
  const wipeTables = schemaTables.filter((t) => !PRESERVED_TABLES.has(t));
  console.log(
    `Schema declares ${schemaTables.length} tables; wiping ${wipeTables.length}, preserving ${PRESERVED_TABLES.size}.`
  );
  if (wipeTables.length === 0) {
    throw new Error("Refusing to run: no tables to truncate (schema import returned 0).");
  }

  await db.transaction(async (tx) => {
    console.log("Disabling FK checks for this transaction...");
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);

    const quoted = wipeTables.map((t) => `"${t}"`).join(", ");
    console.log("TRUNCATE all business tables...");
    // nosemgrep: javascript.drizzle-orm.security.audit.ban-drizzle-sql-raw
    // wipeTables ar en hardkodad whitelist i denna fil — ingen user-input. TRUNCATE
    // kraver dynamiska identifierare som inte kan parameteriseras via prepared statements.
    await tx.execute(sql.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`));

    console.log("DELETE FROM sessions...");
    await tx.execute(sql`DELETE FROM sessions`);

    console.log("Re-enabling FK checks...");
    await tx.execute(sql`SET LOCAL session_replication_role = 'origin'`);

    console.log("Inserting Kinab tenant (sv-SE / Europe/Stockholm)...");
    const kinabSettings = {
      locale: "sv-SE",
      language: "sv",
      timezone: "Europe/Stockholm",
      currency: "SEK",
      country: "SE",
      dateFormat: "yyyy-MM-dd",
    };
    await tx.execute(sql`
      INSERT INTO tenants (id, name, org_number, contact_email, settings, industry, created_at)
      VALUES (
        ${KINAB_TENANT_ID},
        'Kinab',
        NULL,
        'info@kinab.se',
        ${JSON.stringify(kinabSettings)}::jsonb,
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
  console.log(`Backup retained at: ${backupPath}`);
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
