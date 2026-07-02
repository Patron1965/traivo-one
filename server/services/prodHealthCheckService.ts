/**
 * Task #426 — Daglig hälsokoll på prod-data efter Modus-parallelldrift
 *
 * Återanvänd logik från `scripts/verify-kinab-prod.ts` men driven från en
 * delad service som körs schemalagt mot prod-DB:n. Resultatet sparas i
 * `prod_health_check_runs` så drift kan upptäckas över tid (plötsligt tapp
 * av kunder, orphans som dyker upp). WARN/FAIL skickar notis till operatör
 * via Resend.
 *
 * Trösklar (per tenant) konfigureras via env-variabler:
 *   PROD_HEALTH_CHECK_MIN_CUSTOMERS_<TENANT>   (default 1)
 *   PROD_HEALTH_CHECK_MIN_OBJECTS_<TENANT>     (default 1)
 *   PROD_HEALTH_CHECK_MAX_ORPHANS_<TENANT>     (default 0)
 *   PROD_HEALTH_CHECK_MAX_LEAK_<TENANT>        (default 0)
 *
 * Exempel: PROD_HEALTH_CHECK_MIN_CUSTOMERS_KINAB=400
 */

import { pool } from "../db";
import type { Pool } from "pg";

export type CheckStatus = "PASS" | "FAIL" | "WARN" | "INFO";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface HealthCheckThresholds {
  minActiveCustomers: number;
  minActiveObjects: number;
  maxOrphans: number;
  maxLeakRows: number;
}

export interface HealthCheckResult {
  tenantId: string;
  status: CheckStatus; // PASS | WARN | FAIL
  passCount: number;
  warnCount: number;
  failCount: number;
  durationMs: number;
  counts: Record<string, number>;
  checks: HealthCheck[];
  thresholds: HealthCheckThresholds;
}

const DEFAULT_THRESHOLDS: HealthCheckThresholds = {
  minActiveCustomers: 1,
  minActiveObjects: 1,
  maxOrphans: 0,
  maxLeakRows: 0,
};

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getThresholdsForTenant(tenantId: string): HealthCheckThresholds {
  const upper = tenantId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    minActiveCustomers: envInt(
      `PROD_HEALTH_CHECK_MIN_CUSTOMERS_${upper}`,
      DEFAULT_THRESHOLDS.minActiveCustomers,
    ),
    minActiveObjects: envInt(
      `PROD_HEALTH_CHECK_MIN_OBJECTS_${upper}`,
      DEFAULT_THRESHOLDS.minActiveObjects,
    ),
    maxOrphans: envInt(
      `PROD_HEALTH_CHECK_MAX_ORPHANS_${upper}`,
      DEFAULT_THRESHOLDS.maxOrphans,
    ),
    maxLeakRows: envInt(
      `PROD_HEALTH_CHECK_MAX_LEAK_${upper}`,
      DEFAULT_THRESHOLDS.maxLeakRows,
    ),
  };
}

async function tableExists(p: Pool, table: string): Promise<boolean> {
  const r = await p.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return r.rows[0].n > 0;
}

async function hasColumn(p: Pool, table: string, column: string): Promise<boolean> {
  const r = await p.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rows[0].n > 0;
}

async function countWhere(
  p: Pool,
  table: string,
  whereSql: string,
  params: unknown[],
): Promise<number> {
  const r = await p.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM "${table}" WHERE ${whereSql}`,
    params,
  );
  return r.rows[0].c;
}

interface CountRow {
  label: string;
  table: string;
  whereSql: string;
  params: unknown[];
  expectNonZero?: boolean;
}

function buildCountList(tenantId: string): CountRow[] {
  const T = [tenantId];
  return [
    { label: "tenants", table: "tenants", whereSql: "id = $1", params: T, expectNonZero: true },
    { label: "tenant_branding", table: "tenant_branding", whereSql: "tenant_id = $1", params: T },
    { label: "tenant_features", table: "tenant_features", whereSql: "tenant_id = $1", params: T },
    { label: "user_tenant_roles", table: "user_tenant_roles", whereSql: "tenant_id = $1", params: T, expectNonZero: true },
    { label: "customers (aktiva)", table: "customers", whereSql: "tenant_id = $1 AND deleted_at IS NULL", params: T, expectNonZero: true },
    { label: "customers (totalt)", table: "customers", whereSql: "tenant_id = $1", params: T },
    { label: "objects (aktiva)", table: "objects", whereSql: "tenant_id = $1 AND deleted_at IS NULL", params: T, expectNonZero: true },
    { label: "clusters", table: "clusters", whereSql: "tenant_id = $1", params: T },
    { label: "resources", table: "resources", whereSql: "tenant_id = $1", params: T, expectNonZero: true },
    { label: "resource_profile_assignments", table: "resource_profile_assignments", whereSql: "tenant_id = $1", params: T },
    { label: "teams", table: "teams", whereSql: "tenant_id = $1", params: T, expectNonZero: true },
    { label: "team_members", table: "team_members", whereSql: "team_id IN (SELECT id FROM teams WHERE tenant_id = $1)", params: T, expectNonZero: true },
    { label: "articles", table: "articles", whereSql: "tenant_id = $1", params: T, expectNonZero: true },
    { label: "price_lists (tenant)", table: "price_lists", whereSql: "tenant_id = $1 AND customer_id IS NULL", params: T, expectNonZero: true },
    { label: "price_lists (kund)", table: "price_lists", whereSql: "tenant_id = $1 AND customer_id IS NOT NULL", params: T },
    { label: "price_list_articles", table: "price_list_articles", whereSql: "price_list_id IN (SELECT id FROM price_lists WHERE tenant_id = $1)", params: T, expectNonZero: true },
    { label: "checklist_templates", table: "checklist_templates", whereSql: "tenant_id = $1", params: T },
    { label: "portal_users", table: "portal_users", whereSql: "customer_id IN (SELECT id FROM customers WHERE tenant_id = $1)", params: T },
    { label: "portal_user_object_scopes", table: "portal_user_object_scopes", whereSql: "portal_user_id IN (SELECT pu.id FROM portal_users pu JOIN customers c ON c.id = pu.customer_id WHERE c.tenant_id = $1)", params: T },
    { label: "fortnox_config", table: "fortnox_config", whereSql: "tenant_id = $1", params: T },
    { label: "fortnox_mappings", table: "fortnox_mappings", whereSql: "tenant_id = $1", params: T },
    { label: "work_orders", table: "work_orders", whereSql: "tenant_id = $1", params: T },
  ];
}

export async function runProdHealthCheck(
  tenantId: string,
  options: { thresholds?: Partial<HealthCheckThresholds> } = {},
): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  const thresholds: HealthCheckThresholds = {
    ...getThresholdsForTenant(tenantId),
    ...options.thresholds,
  };
  const checks: HealthCheck[] = [];
  const counts: Record<string, number> = {};

  const record = (name: string, status: CheckStatus, detail: string) => {
    checks.push({ name, status, detail });
  };

  // --- 1. Räknesatser
  for (const row of buildCountList(tenantId)) {
    if (!(await tableExists(pool, row.table))) {
      record(`count: ${row.label}`, "WARN", `tabell ${row.table} saknas`);
      continue;
    }
    let n: number;
    try {
      n = await countWhere(pool, row.table, row.whereSql, row.params);
    } catch (err) {
      record(`count: ${row.label}`, "WARN", `query error: ${(err as Error).message}`);
      continue;
    }
    counts[row.label] = n;

    if (row.label === "customers (aktiva)") {
      if (n >= thresholds.minActiveCustomers) {
        record(`count: ${row.label}`, "PASS", `${n} (≥ ${thresholds.minActiveCustomers})`);
      } else {
        record(
          `count: ${row.label}`,
          "FAIL",
          `${n} kunder — under förväntat minimum ${thresholds.minActiveCustomers}`,
        );
      }
      continue;
    }
    if (row.label === "objects (aktiva)") {
      if (n >= thresholds.minActiveObjects) {
        record(`count: ${row.label}`, "PASS", `${n} (≥ ${thresholds.minActiveObjects})`);
      } else {
        record(
          `count: ${row.label}`,
          "FAIL",
          `${n} objekt — under förväntat minimum ${thresholds.minActiveObjects}`,
        );
      }
      continue;
    }
    if (row.expectNonZero && n === 0) {
      record(`count: ${row.label}`, "FAIL", `${n} (förväntade > 0)`);
    } else {
      record(`count: ${row.label}`, "INFO", `${n}`);
    }
  }

  // --- 2. FK-orphan-checkar (per tenant)
  const orphanChecks: Array<{ name: string; sql: string }> = [
    {
      name: "orphans: objects.parent_id",
      sql: `SELECT count(*)::int AS c FROM objects o
            WHERE o.tenant_id = $1 AND o.parent_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM objects p WHERE p.id = o.parent_id)`,
    },
    {
      // ADR v3 / Task #565: kund-koppling går via object_payers — legacy
      // objects.customer_id är på väg ut (Task #560 DROP). Probet kollar
      // istället att alla primär-payer-customer_id pekar på existerande kund.
      name: "orphans: object_payers.customer_id (primary)",
      sql: `SELECT count(*)::int AS c FROM object_payers op
            JOIN objects o ON o.id = op.object_id
            WHERE o.tenant_id = $1 AND op.is_primary = true
              AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = op.customer_id)`,
    },
    {
      name: "orphans: clusters.root_customer_id",
      sql: `SELECT count(*)::int AS c FROM clusters cl
            WHERE cl.tenant_id = $1 AND cl.root_customer_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = cl.root_customer_id)`,
    },
    {
      name: "orphans: price_lists.customer_id",
      sql: `SELECT count(*)::int AS c FROM price_lists pl
            WHERE pl.tenant_id = $1 AND pl.customer_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = pl.customer_id)`,
    },
    {
      name: "orphans: portal_user_object_scopes",
      sql: `SELECT count(*)::int AS c FROM portal_user_object_scopes s
            WHERE s.portal_user_id IN (
              SELECT pu.id FROM portal_users pu
              JOIN customers c ON c.id = pu.customer_id
              WHERE c.tenant_id = $1
            )
            AND (
              NOT EXISTS (SELECT 1 FROM portal_users pu WHERE pu.id = s.portal_user_id)
              OR NOT EXISTS (SELECT 1 FROM objects o WHERE o.id = s.object_id)
            )`,
    },
    {
      name: "orphans: team_members",
      sql: `SELECT count(*)::int AS c FROM team_members tm
            WHERE tm.team_id IN (SELECT id FROM teams WHERE tenant_id = $1)
              AND (
                NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = tm.team_id)
                OR NOT EXISTS (SELECT 1 FROM resources r WHERE r.id = tm.resource_id)
              )`,
    },
    {
      name: "orphans: work_orders.object_id",
      sql: `SELECT count(*)::int AS c FROM work_orders wo
            WHERE wo.tenant_id = $1 AND wo.object_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.id = wo.object_id)`,
    },
    {
      name: "orphans: work_orders.customer_id",
      sql: `SELECT count(*)::int AS c FROM work_orders wo
            WHERE wo.tenant_id = $1 AND wo.customer_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = wo.customer_id)`,
    },
  ];

  for (const oc of orphanChecks) {
    try {
      const r = await pool.query<{ c: number }>(oc.sql, [tenantId]);
      const c = r.rows[0].c;
      if (c <= thresholds.maxOrphans) {
        record(oc.name, "PASS", `${c} orphan(s)`);
      } else {
        record(oc.name, "FAIL", `${c} orphan(s) (max tillåtet ${thresholds.maxOrphans})`);
      }
    } catch (err) {
      // Saknad tabell/kolumn → WARN i stället för krasch
      record(oc.name, "WARN", `query error: ${(err as Error).message}`);
    }
  }

  // --- 3. Tenant-leak (FK pekar på tenant men tenant_id ≠ tenant)
  try {
    const leakTables = await pool.query<{
      table_name: string;
      has_cust: boolean;
      has_obj: boolean;
    }>(
      `SELECT t.table_name,
              bool_or(c.column_name='customer_id') AS has_cust,
              bool_or(c.column_name='object_id')   AS has_obj
       FROM information_schema.columns c
       JOIN (SELECT DISTINCT table_name FROM information_schema.columns
             WHERE table_schema='public' AND column_name='tenant_id') t
         ON t.table_name=c.table_name
       WHERE c.table_schema='public'
         AND c.column_name IN ('customer_id','object_id')
       GROUP BY t.table_name
       ORDER BY t.table_name`,
    );

    let totalLeak = 0;
    let leakingTables = 0;
    for (const row of leakTables.rows) {
      const conds: string[] = [];
      if (row.has_cust) conds.push(`customer_id IN (SELECT id FROM customers WHERE tenant_id = $1)`);
      if (row.has_obj) conds.push(`object_id   IN (SELECT id FROM objects   WHERE tenant_id = $1)`);
      if (conds.length === 0) continue;
      try {
        const lk = await pool.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM "${row.table_name}"
           WHERE (${conds.join(" OR ")})
             AND tenant_id IS DISTINCT FROM $1`,
          [tenantId],
        );
        if (lk.rows[0].c > 0) {
          record(`leak: ${row.table_name}`, "FAIL", `${lk.rows[0].c} rader`);
          totalLeak += lk.rows[0].c;
          leakingTables++;
        }
      } catch (err) {
        record(`leak: ${row.table_name}`, "WARN", `query error: ${(err as Error).message}`);
      }
    }
    if (leakingTables === 0) {
      record(
        `leak: alla ${leakTables.rowCount} kontrollerade tabeller`,
        "PASS",
        "0 läckor",
      );
    } else if (totalLeak <= thresholds.maxLeakRows) {
      record(`leak: SUMMA`, "PASS", `${totalLeak} läckande rader (≤ ${thresholds.maxLeakRows})`);
    } else {
      record(
        `leak: SUMMA`,
        "FAIL",
        `${totalLeak} läckande rader i ${leakingTables} tabell(er)`,
      );
    }
  } catch (err) {
    record(`leak: SUMMA`, "WARN", `query error: ${(err as Error).message}`);
  }

  // --- 4. Kritisk konfig
  if (await tableExists(pool, "fortnox_config")) {
    const fnHasToken = await hasColumn(pool, "fortnox_config", "access_token");
    const r = await pool.query<{ has_row: boolean; has_token: boolean }>(
      `SELECT
         (count(*) > 0) AS has_row,
         ${fnHasToken ? `bool_or(access_token IS NOT NULL AND length(access_token) > 0)` : `false`} AS has_token
       FROM fortnox_config WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = r.rows[0];
    if (!row.has_row) record("config: fortnox_config", "WARN", "ingen rad för tenant");
    else if (!row.has_token)
      record(
        "config: fortnox_config.access_token",
        "WARN",
        "rad finns men access_token saknas — Fortnox-OAuth behöver göras om",
      );
    else record("config: fortnox_config", "PASS", "rad + access_token finns");
  }

  const tn = await countWhere(pool, "tenants", "id = $1", [tenantId]);
  record(`config: tenants[id=${tenantId}]`, tn === 1 ? "PASS" : "FAIL", `${tn} rad(er)`);

  if (await tableExists(pool, "user_tenant_roles")) {
    const adminCount = (
      await pool.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM user_tenant_roles
         WHERE tenant_id = $1 AND role IN ('owner','admin')`,
        [tenantId],
      )
    ).rows[0].c;
    record(
      "config: minst en owner/admin",
      adminCount > 0 ? "PASS" : "FAIL",
      `${adminCount} owner/admin-roll(er)`,
    );
  }

  // --- Sammanfatta
  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const passCount = checks.filter((c) => c.status === "PASS").length;
  const status: CheckStatus = failCount > 0 ? "FAIL" : warnCount > 0 ? "WARN" : "PASS";

  return {
    tenantId,
    status,
    passCount,
    warnCount,
    failCount,
    durationMs: Date.now() - startedAt,
    counts,
    checks,
    thresholds,
  };
}
