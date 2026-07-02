#!/usr/bin/env tsx
/**
 * Task #424 — Verifiera Kinab prod-data efter migrering (sista grindbeslutet
 * innan Modus-parallelldriften startar).
 *
 * Vad detta skriptet gör (READ-ONLY mot prod):
 *   1. Räknesatser per nyckeltabell (customers, objects, price_lists,
 *      price_list_articles, articles, resources, teams, team_members,
 *      resource_profile_assignments, portal_users, portal_user_object_scopes,
 *      checklist_templates, metadata_katalog).
 *   2. Närvaro av kritisk konfig: tenants, tenant_branding, tenant_features,
 *      fortnox_config (+ access_token-status), fortnox_mappings.
 *   3. FK-orphan-checkar: objects.parent_id, objects.customer_id,
 *      clusters.root_customer_id, price_list_articles.price_list_id,
 *      portal_user_object_scopes.object_id, team_members.team_id +
 *      team_members.resource_id.
 *   4. Tenant-leak: rader i berörda tabeller vars FK pekar på en kinab-kund
 *      eller -objekt men där tenant_id ≠ kinab.
 *   5. Jämförelse mot dev (om DATABASE_URL pekar på dev) — varnar om
 *      kund-/objekt-räkningarna avviker betydligt.
 *
 * Genererar `verify-prod-report-YYYYMMDD-HHMM.md` med PASS/FAIL per check,
 * räknesatser och jämförelse. Sista raden = "VERIFIKATION: PASS|FAIL".
 *
 * Säkerhet
 *   - Kör endast SELECT. Ingen BEGIN/COMMIT/skrivning.
 *   - Kräver PROD_DATABASE_URL (Secret). DATABASE_URL = dev (för diff).
 *   - Skiljer dev/prod precis som migrate-skriptet — vägrar köra om de är
 *     samma.
 *
 * Användning
 *   PROD_DATABASE_URL=postgres://... npx tsx scripts/verify-kinab-prod.ts
 *
 * Flaggor
 *   --tenant=kinab        (default)
 *   --expected-customers=486   förväntad miniminivå för aktiva kunder
 *                              (default 400 → FAIL om underskrids)
 *   --expected-objects=N       förväntad miniminivå för aktiva objekt
 *                              (default 1 → FAIL om underskrids; sätt högre
 *                              vid känd baseline, t.ex. dev-räkningen)
 *   --no-dev-diff         hoppa över jämförelse mot dev (om DATABASE_URL
 *                         saknas eller pekar på prod)
 */

import pg from "pg";
import * as fs from "node:fs";
import * as path from "node:path";

const { Pool } = pg;

// ----------------------------- args ------------------------------

const args = process.argv.slice(2);
function arg(name: string, def?: string): string | undefined {
  const m = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!m) return def;
  if (m === `--${name}`) return "true";
  return m.split("=").slice(1).join("=");
}

const TENANT = arg("tenant", "kinab")!;
const EXPECTED_MIN_CUSTOMERS = parseInt(arg("expected-customers", "400")!, 10);
const EXPECTED_MIN_OBJECTS = parseInt(arg("expected-objects", "1")!, 10);
const NO_DEV_DIFF = arg("no-dev-diff") === "true";

// ----------------------------- env ------------------------------

if (!process.env.PROD_DATABASE_URL) {
  console.error(
    "FEL: PROD_DATABASE_URL saknas. Lägg in den som Secret innan körning.",
  );
  process.exit(1);
}

const wantDevDiff =
  !NO_DEV_DIFF &&
  !!process.env.DATABASE_URL &&
  process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL;

if (
  !NO_DEV_DIFF &&
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL === process.env.PROD_DATABASE_URL
) {
  console.error(
    "FEL: DATABASE_URL och PROD_DATABASE_URL pekar på samma DB. Sätt --no-dev-diff om detta är avsiktligt.",
  );
  process.exit(1);
}

const prod = new Pool({ connectionString: process.env.PROD_DATABASE_URL });
const dev = wantDevDiff
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

// ----------------------------- helpers --------------------------

const log = (...a: unknown[]) => console.log(...a);

type CheckStatus = "PASS" | "FAIL" | "WARN" | "INFO";
interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}
const checks: Check[] = [];
function record(name: string, status: CheckStatus, detail: string) {
  checks.push({ name, status, detail });
  const sym = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "·";
  log(`  [${sym}] ${name.padEnd(48)} ${detail}`);
}

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return r.rows[0].n > 0;
}

async function hasColumn(pool: pg.Pool, table: string, column: string): Promise<boolean> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return r.rows[0].n > 0;
}

async function countWhere(
  pool: pg.Pool,
  table: string,
  whereSql: string,
  params: unknown[] = [],
): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${table} WHERE ${whereSql}`,
    params,
  );
  return r.rows[0].c;
}

// ----------------------------- counts --------------------------

interface CountRow {
  label: string;
  table: string;
  whereSql: string;
  params: unknown[];
  /** Soft-warn om antalet är 0 men configeftermigrering förväntar sig rader. */
  expectNonZero?: boolean;
}

async function buildCountList(): Promise<CountRow[]> {
  const list: CountRow[] = [
    { label: "tenants (id=$1)", table: "tenants", whereSql: "id = $1", params: [TENANT], expectNonZero: true },
    { label: "tenant_branding", table: "tenant_branding", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "tenant_features", table: "tenant_features", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "users (kinab-roller)", table: "users", whereSql: "id IN (SELECT user_id FROM user_tenant_roles WHERE tenant_id = $1)", params: [TENANT], expectNonZero: true },
    { label: "user_tenant_roles", table: "user_tenant_roles", whereSql: "tenant_id = $1", params: [TENANT], expectNonZero: true },
    { label: "customers (aktiva)", table: "customers", whereSql: "tenant_id = $1 AND deleted_at IS NULL", params: [TENANT], expectNonZero: true },
    { label: "customers (totalt)", table: "customers", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "objects (aktiva)", table: "objects", whereSql: "tenant_id = $1 AND deleted_at IS NULL", params: [TENANT], expectNonZero: true },
    { label: "clusters", table: "clusters", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "resources", table: "resources", whereSql: "tenant_id = $1", params: [TENANT], expectNonZero: true },
    { label: "resource_profiles", table: "resource_profiles", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "resource_profile_assignments", table: "resource_profile_assignments", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "teams", table: "teams", whereSql: "tenant_id = $1", params: [TENANT], expectNonZero: true },
    { label: "team_members", table: "team_members", whereSql: "team_id IN (SELECT id FROM teams WHERE tenant_id = $1)", params: [TENANT], expectNonZero: true },
    { label: "vehicles", table: "vehicles", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "equipment", table: "equipment", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "articles", table: "articles", whereSql: "tenant_id = $1", params: [TENANT], expectNonZero: true },
    { label: "article_components", table: "article_components", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "price_lists (tenant)", table: "price_lists", whereSql: "tenant_id = $1 AND customer_id IS NULL", params: [TENANT], expectNonZero: true },
    { label: "price_lists (kund)", table: "price_lists", whereSql: "tenant_id = $1 AND customer_id IS NOT NULL", params: [TENANT] },
    { label: "price_list_articles", table: "price_list_articles", whereSql: "price_list_id IN (SELECT id FROM price_lists WHERE tenant_id = $1)", params: [TENANT], expectNonZero: true },
    { label: "checklist_templates", table: "checklist_templates", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "portal_users", table: "portal_users", whereSql: "customer_id IN (SELECT id FROM customers WHERE tenant_id = $1)", params: [TENANT] },
    { label: "portal_user_object_scopes", table: "portal_user_object_scopes", whereSql: "portal_user_id IN (SELECT pu.id FROM portal_users pu JOIN customers c ON c.id = pu.customer_id WHERE c.tenant_id = $1)", params: [TENANT] },
    { label: "fortnox_config", table: "fortnox_config", whereSql: "tenant_id = $1", params: [TENANT], expectNonZero: true },
    { label: "fortnox_mappings", table: "fortnox_mappings", whereSql: "tenant_id = $1", params: [TENANT] },
    { label: "work_orders (förväntat 0)", table: "work_orders", whereSql: "tenant_id = $1", params: [TENANT] },
  ];
  return list;
}

const prodCounts: Record<string, number> = {};
const devCounts: Record<string, number> = {};

async function runCounts(): Promise<void> {
  log("\n=== 1. Räknesatser (PROD) ===");
  const list = await buildCountList();
  for (const row of list) {
    if (!(await tableExists(prod, row.table))) {
      record(`count: ${row.label}`, "WARN", `tabell ${row.table} saknas i prod`);
      continue;
    }
    const n = await countWhere(prod, row.table, row.whereSql, row.params);
    prodCounts[row.label] = n;

    if (row.label === "customers (aktiva)") {
      if (n >= EXPECTED_MIN_CUSTOMERS) {
        record(`count: ${row.label}`, "PASS", `${n} (≥ ${EXPECTED_MIN_CUSTOMERS})`);
      } else {
        record(
          `count: ${row.label}`,
          "FAIL",
          `${n} kunder — under förväntat minimum ${EXPECTED_MIN_CUSTOMERS} (~486 förväntat)`,
        );
      }
      continue;
    }
    if (row.label === "objects (aktiva)") {
      if (n >= EXPECTED_MIN_OBJECTS) {
        record(`count: ${row.label}`, "PASS", `${n} (≥ ${EXPECTED_MIN_OBJECTS})`);
      } else {
        record(
          `count: ${row.label}`,
          "FAIL",
          `${n} objekt — under förväntat minimum ${EXPECTED_MIN_OBJECTS}`,
        );
      }
      continue;
    }
    if (row.label === "work_orders (förväntat 0)") {
      if (n === 0) record(`count: ${row.label}`, "PASS", `0 (slim-migrering)`);
      else record(`count: ${row.label}`, "WARN", `${n} work_orders i prod — slim-migrering förväntar 0 före Modus-import`);
      continue;
    }
    if (row.expectNonZero && n === 0) {
      record(`count: ${row.label}`, "FAIL", `${n} (förväntade > 0)`);
    } else {
      record(`count: ${row.label}`, "INFO", `${n}`);
    }
  }
}

async function runDevDiff(): Promise<void> {
  if (!dev) {
    log("\n=== 2. Dev-diff: HOPPAD (--no-dev-diff eller DATABASE_URL saknas) ===");
    return;
  }
  log("\n=== 2. Dev/prod-diff (snabbcheck) ===");
  const focus = [
    { label: "customers (aktiva)", whereSql: "tenant_id = $1 AND deleted_at IS NULL", table: "customers" },
    { label: "objects (aktiva)", whereSql: "tenant_id = $1 AND deleted_at IS NULL", table: "objects" },
    { label: "articles", whereSql: "tenant_id = $1", table: "articles" },
    { label: "price_lists (tenant)", whereSql: "tenant_id = $1 AND customer_id IS NULL", table: "price_lists" },
    { label: "teams", whereSql: "tenant_id = $1", table: "teams" },
    { label: "resources", whereSql: "tenant_id = $1", table: "resources" },
  ];
  for (const f of focus) {
    if (!(await tableExists(dev, f.table))) continue;
    const n = await countWhere(dev, f.table, f.whereSql, [TENANT]);
    devCounts[f.label] = n;
    const p = prodCounts[f.label] ?? 0;

    // För "customers (aktiva)" tillåter vi att prod har ≥ aktiva i dev som
    // tröskel (slim-migreringen filtrerar på work_order ≥ 2024). För övriga
    // konfigtabeller ska prod vara ≥ dev (eftersom ON CONFLICT DO UPDATE
    // bevarar rader).
    if (f.label === "customers (aktiva)") {
      if (p >= EXPECTED_MIN_CUSTOMERS) {
        record(`diff: ${f.label}`, "PASS", `dev=${n}, prod=${p} (≥ ${EXPECTED_MIN_CUSTOMERS})`);
      } else if (p === 0) {
        record(`diff: ${f.label}`, "FAIL", `dev=${n}, prod=${p}`);
      } else {
        record(`diff: ${f.label}`, "WARN", `dev=${n}, prod=${p} — under förväntat min ${EXPECTED_MIN_CUSTOMERS}`);
      }
    } else {
      if (p < n) {
        record(`diff: ${f.label}`, "WARN", `dev=${n}, prod=${p} (prod < dev)`);
      } else {
        record(`diff: ${f.label}`, "PASS", `dev=${n}, prod=${p}`);
      }
    }
  }
}

// ----------------------------- FK orphans --------------------------

async function runOrphanChecks(): Promise<void> {
  log("\n=== 3. FK-orphan-checkar (PROD) ===");

  // objects.parent_id
  {
    const c = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM objects o
         WHERE o.tenant_id = $1
           AND o.parent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM objects p WHERE p.id = o.parent_id)`,
        [TENANT],
      )
    ).rows[0].c;
    record("orphans: objects.parent_id", c === 0 ? "PASS" : "FAIL", `${c} orphan(s)`);
  }

  // objects.customer_id-orphan-checken är borttagen — kolumnen finns inte längre
  // (ADR v3, kontraktsfas). Kundkoppling verifieras numera via object_payers.

  // clusters.root_customer_id
  {
    const c = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM clusters cl
         WHERE cl.tenant_id = $1
           AND cl.root_customer_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = cl.root_customer_id)`,
        [TENANT],
      )
    ).rows[0].c;
    record("orphans: clusters.root_customer_id", c === 0 ? "PASS" : "FAIL", `${c} orphan(s)`);
  }

  // price_lists.customer_id — scoped till kinab-prislistor (kund-länkade
  // måste peka på en existerande kund för samma tenant)
  {
    const c = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM price_lists pl
         WHERE pl.tenant_id = $1
           AND pl.customer_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = pl.customer_id)`,
        [TENANT],
      )
    ).rows[0].c;
    record("orphans: price_lists.customer_id", c === 0 ? "PASS" : "FAIL", `${c} orphan(s)`);
  }

  // price_list_articles.price_list_id — saknar tenant_id-kolumn, så orphans
  // kan inte tenant-scopes (om parent saknas vet vi inte vilken tenant
  // raden var avsedd för). Vi kör en global integritetskoll men rapporterar
  // som WARN om bara andra tenants berörs, FAIL endast om vi säkert vet att
  // raden tillhör kinab via article_id.
  {
    const cTotal = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM price_list_articles pla
         WHERE NOT EXISTS (SELECT 1 FROM price_lists pl WHERE pl.id = pla.price_list_id)`,
      )
    ).rows[0].c;
    if (cTotal === 0) {
      record("orphans: price_list_articles → price_lists (global)", "PASS", "0 orphan(s)");
    } else {
      const cKinab = (
        await prod.query<{ c: number }>(
          `SELECT count(*)::int AS c FROM price_list_articles pla
           WHERE NOT EXISTS (SELECT 1 FROM price_lists pl WHERE pl.id = pla.price_list_id)
             AND pla.article_id IN (SELECT id FROM articles WHERE tenant_id = $1)`,
          [TENANT],
        )
      ).rows[0].c;
      if (cKinab > 0) {
        record(
          "orphans: price_list_articles → price_lists",
          "FAIL",
          `${cKinab} kinab-orphan(s) av totalt ${cTotal}`,
        );
      } else {
        record(
          "orphans: price_list_articles → price_lists",
          "WARN",
          `${cTotal} global orphan(s), 0 berör kinab — DB-integritet bör städas`,
        );
      }
    }
  }

  // portal_user_object_scopes — scoped till kinab via portal_users → customers
  if (await tableExists(prod, "portal_user_object_scopes")) {
    const c = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM portal_user_object_scopes s
         WHERE s.portal_user_id IN (
           SELECT pu.id FROM portal_users pu
           JOIN customers c ON c.id = pu.customer_id
           WHERE c.tenant_id = $1
         )
         AND (
           NOT EXISTS (SELECT 1 FROM portal_users pu WHERE pu.id = s.portal_user_id)
           OR NOT EXISTS (SELECT 1 FROM objects o WHERE o.id = s.object_id)
         )`,
        [TENANT],
      )
    ).rows[0].c;
    record("orphans: portal_user_object_scopes (kinab)", c === 0 ? "PASS" : "FAIL", `${c} orphan(s)`);
  }

  // team_members — scoped till kinab-teams
  if (await tableExists(prod, "team_members")) {
    const c = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM team_members tm
         WHERE tm.team_id IN (SELECT id FROM teams WHERE tenant_id = $1)
           AND (
             NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = tm.team_id)
             OR NOT EXISTS (SELECT 1 FROM resources r WHERE r.id = tm.resource_id)
           )`,
        [TENANT],
      )
    ).rows[0].c;
    record("orphans: team_members (kinab)", c === 0 ? "PASS" : "FAIL", `${c} orphan(s)`);
  }
}

// ----------------------------- tenant-leak --------------------------

async function runTenantLeakChecks(): Promise<void> {
  log("\n=== 4. Tenant-leak (rader vars FK pekar på kinab men tenant_id ≠ kinab) ===");
  const leakTables = await prod.query<{ table_name: string; has_cust: boolean; has_obj: boolean }>(
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
    const lk = await prod.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM "${row.table_name}"
       WHERE (${conds.join(" OR ")})
         AND tenant_id IS DISTINCT FROM $1`,
      [TENANT],
    );
    if (lk.rows[0].c > 0) {
      record(`leak: ${row.table_name}`, "FAIL", `${lk.rows[0].c} rader`);
      totalLeak += lk.rows[0].c;
      leakingTables++;
    }
  }
  if (leakingTables === 0) {
    record(`leak: alla ${leakTables.rowCount} kontrollerade tabeller`, "PASS", "0 läckor");
  } else {
    record(`leak: SUMMA`, "FAIL", `${totalLeak} läckande rader i ${leakingTables} tabell(er)`);
  }
}

// ----------------------------- konfigstatus --------------------------

async function runConfigPresence(): Promise<void> {
  log("\n=== 5. Kritisk konfig-närvaro ===");

  // Fortnox: kontrollera att tenant har en config-rad och att access_token är satt
  if (await tableExists(prod, "fortnox_config")) {
    const fnHasToken = await hasColumn(prod, "fortnox_config", "access_token");
    const r = await prod.query<{ has_row: boolean; has_token: boolean }>(
      `SELECT
         (count(*) > 0) AS has_row,
         ${fnHasToken ? `bool_or(access_token IS NOT NULL AND length(access_token) > 0)` : `false`} AS has_token
       FROM fortnox_config WHERE tenant_id = $1`,
      [TENANT],
    );
    const row = r.rows[0];
    if (!row.has_row) record("config: fortnox_config", "FAIL", "ingen rad för tenant");
    else if (!row.has_token) record("config: fortnox_config.access_token", "WARN", "rad finns men access_token saknas — Fortnox-OAuth behöver göras om i prod");
    else record("config: fortnox_config", "PASS", "rad + access_token finns");
  }

  // Tenant-rad
  const tn = await countWhere(prod, "tenants", "id = $1", [TENANT]);
  record("config: tenants[id=kinab]", tn === 1 ? "PASS" : "FAIL", `${tn} rad(er)`);

  // Minst en admin-roll i tenant
  if (await tableExists(prod, "user_tenant_roles")) {
    const adminCount = (
      await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM user_tenant_roles
         WHERE tenant_id = $1 AND role IN ('owner','admin')`,
        [TENANT],
      )
    ).rows[0].c;
    record(
      "config: minst en owner/admin",
      adminCount > 0 ? "PASS" : "FAIL",
      `${adminCount} owner/admin-roll(er) i prod`,
    );
  }
}

// ----------------------------- main --------------------------

async function main() {
  log(`Verifierar Kinab prod-data (tenant=${TENANT})`);
  log(`PROD_DATABASE_URL: <maskerad>`);
  log(`Dev-diff: ${wantDevDiff ? "PÅ" : "AV"}`);
  log(`Förväntat min antal aktiva kunder: ${EXPECTED_MIN_CUSTOMERS}`);
  log(`Förväntat min antal aktiva objekt:  ${EXPECTED_MIN_OBJECTS}`);

  await runCounts();
  await runDevDiff();
  await runOrphanChecks();
  await runTenantLeakChecks();
  await runConfigPresence();

  // ============ Rapport ============
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 13);
  const reportPath = path.join(process.cwd(), `verify-prod-report-${stamp}.md`);

  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const pass = checks.filter((c) => c.status === "PASS").length;
  const overall: CheckStatus = fail > 0 ? "FAIL" : warn > 0 ? "WARN" : "PASS";

  const lines: string[] = [];
  lines.push(`# Kinab prod-verifikation ${stamp}`);
  lines.push("");
  lines.push(`- Tenant: \`${TENANT}\``);
  lines.push(`- Dev-diff: ${wantDevDiff ? "PÅ" : "AV"}`);
  lines.push(`- Förväntat min antal aktiva kunder: ${EXPECTED_MIN_CUSTOMERS}`);
  lines.push("");
  lines.push(`**Resultat:** ${overall} (PASS=${pass}, WARN=${warn}, FAIL=${fail})`);
  lines.push("");
  lines.push("## Räknesatser (PROD)");
  lines.push("");
  lines.push("| Tabell / mått | PROD | DEV |");
  lines.push("|---|---:|---:|");
  for (const [label, n] of Object.entries(prodCounts)) {
    const d = devCounts[label];
    lines.push(`| ${label} | ${n} | ${d ?? "–"} |`);
  }
  lines.push("");
  lines.push("## Checkar");
  lines.push("");
  lines.push("| Status | Check | Detalj |");
  lines.push("|---|---|---|");
  for (const c of checks) {
    lines.push(`| ${c.status} | ${c.name} | ${c.detail} |`);
  }
  lines.push("");
  lines.push("## Manuella efter-steg (operatör)");
  lines.push("");
  lines.push("- [ ] Logga in i prod-appen som tenant-admin för `kinab` och");
  lines.push("      bekräfta att Customers, Objekt, Resurser, Team, Artiklar,");
  lines.push("      Prislistor och Fortnox-status visas korrekt.");
  lines.push("- [ ] Ta `pg_dump` av prod-DB:n och lagra som rollback-snapshot");
  lines.push("      (Replit Publish → Database → Snapshots, eller `pg_dump");
  lines.push("      \"$PROD_DATABASE_URL\" > kinab-prod-postverify-" + stamp + ".sql`).");
  lines.push("- [ ] Säg klart till Kinab att Modus-importen kan köras skarpt.");
  lines.push("");
  lines.push(`VERIFIKATION: ${overall}`);
  lines.push("");

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  log(`\nRapport sparad: ${reportPath}`);
  log(`\nVERIFIKATION: ${overall} (PASS=${pass}, WARN=${warn}, FAIL=${fail})`);

  await prod.end();
  if (dev) await dev.end();

  process.exit(overall === "FAIL" ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nFEL:", err);
  await prod.end().catch(() => {});
  if (dev) await dev.end().catch(() => {});
  process.exit(2);
});
