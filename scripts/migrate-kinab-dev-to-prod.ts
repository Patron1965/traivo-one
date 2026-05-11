#!/usr/bin/env tsx
/**
 * Migrate Kinab-tenant data from DEV → PROD (Task #423).
 *
 * Strategy: "Slim & Clean"
 *   - Konfiguration (resurser, team, artiklar, prislistor, checklistor, fortnox m.fl.)
 *   - Aktiva kunder (kunder med work_order scheduled_date >= 2024-01-01)
 *   - Deras objekt och objekt-kopplade tabeller
 *   - INGA work_orders, INGA subscriptions, INGEN historisk transaktionsdata
 *   - Före importen: radera ev. testkunder i prod
 *
 * SÄKERHET
 *   - PROD_DATABASE_URL måste sättas via Secrets — DATABASE_URL = dev (källan).
 *   - Hela migreringen körs i EN transaktion mot prod.
 *   - Utan CONFIRM=YES_MIGRATE_PROD körs en dry-run (ROLLBACK i slutet).
 *   - Idempotent: använder INSERT ... ON CONFLICT (id) DO UPDATE.
 *   - Skriver migration-report-YYYYMMDD-HHMM.md med rad-räknare.
 *
 * ANVÄNDNING
 *   PROD_DATABASE_URL=postgres://... \
 *     npx tsx scripts/migrate-kinab-dev-to-prod.ts --phase=all --dry-run
 *
 *   PROD_DATABASE_URL=postgres://... CONFIRM=YES_MIGRATE_PROD \
 *     npx tsx scripts/migrate-kinab-dev-to-prod.ts --phase=all
 *
 * Flaggor
 *   --phase=cleanup|config|customers|all   (default: all)
 *   --dry-run                              tvinga dry-run även med CONFIRM
 *   --tenant=kinab                         (default: kinab)
 *   --active-since=2024-01-01              (default: 2024-01-01)
 *   --batch=500                            insert-batch-storlek
 *   --limit=N                              kapa kund-listan till N (deterministisk via id-sort)
 *   --customer-id=id1,id2,...              selektiv import: ENBART dessa kunder
 *                                          (för senare återställning av enskilda vilande kunder)
 *
 * Env-overrides
 *   TEST_CUSTOMER_IDS=id1,id2,...   explicit lista som ska raderas i cleanup
 *
 * POST-RUN VALIDERING (innan COMMIT)
 *   Skriptet kör FK-integritets- och tenant-leak-checkar inom samma transaktion.
 *   Om någon felar → tvångs-rollback, ingen ändring persisterad.
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

const PHASE = (arg("phase", "all") || "all") as
  | "cleanup"
  | "config"
  | "customers"
  | "all";
const TENANT = arg("tenant", "kinab")!;
const ACTIVE_SINCE = arg("active-since", "2024-01-01")!;
const BATCH = parseInt(arg("batch", "500")!, 10);
const LIMIT_RAW = arg("limit");
const LIMIT: number | null = LIMIT_RAW ? parseInt(LIMIT_RAW, 10) : null;
const CUSTOMER_ID_ARG = arg("customer-id"); // komma-separerad lista, valbar
const DRY_RUN_FLAG = arg("dry-run") === "true";
const CONFIRM = process.env.CONFIRM === "YES_MIGRATE_PROD";
const DRY_RUN = DRY_RUN_FLAG || !CONFIRM;
const TEST_CUSTOMER_IDS_ENV = process.env.TEST_CUSTOMER_IDS;

// ----------------------------- env ------------------------------

if (!process.env.DATABASE_URL) {
  console.error("FEL: DATABASE_URL (dev) saknas.");
  process.exit(1);
}
if (!process.env.PROD_DATABASE_URL) {
  console.error(
    "FEL: PROD_DATABASE_URL saknas. Lägg in den som Secret innan körning.",
  );
  process.exit(1);
}
if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  console.error("FEL: DATABASE_URL och PROD_DATABASE_URL pekar på samma DB.");
  process.exit(1);
}

const dev = new Pool({ connectionString: process.env.DATABASE_URL });
const prodPool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });

// ----------------------------- helpers --------------------------

const log = (...a: unknown[]) => console.log(...a);
const counters: Record<string, { fetched: number; upserted: number; deleted: number }> =
  {};

function track(table: string) {
  if (!counters[table]) counters[table] = { fetched: 0, upserted: 0, deleted: 0 };
  return counters[table];
}

type Querier = pg.Pool | pg.PoolClient;

const pkCache = new Map<string, string | null>();
/** Returnerar single-column PK eller null om sammansatt/saknas. */
async function getPrimaryKey(qx: Querier, table: string, cacheKey: string): Promise<string | null> {
  const ck = `${cacheKey}:${table}`;
  if (pkCache.has(ck)) return pkCache.get(ck)!;
  const r = await qx.query<{ column_name: string; n: number }>(
    `SELECT kcu.column_name, count(*) OVER ()::int AS n
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
     WHERE tc.constraint_type='PRIMARY KEY'
       AND tc.table_schema='public' AND tc.table_name=$1
     ORDER BY kcu.ordinal_position`,
    [table],
  );
  const pk = r.rowCount === 1 ? r.rows[0].column_name : null;
  pkCache.set(ck, pk);
  return pk;
}

const colCache = new Map<string, string[]>();
async function getColumns(qx: Querier, table: string, cacheKey: string): Promise<string[]> {
  const ck = `${cacheKey}:${table}`;
  if (colCache.has(ck)) return colCache.get(ck)!;
  const r = await qx.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table],
  );
  const cols = r.rows.map((x) => x.column_name);
  colCache.set(ck, cols);
  return cols;
}

async function tableExists(qx: Querier, table: string, cacheKey: string): Promise<boolean> {
  return (await getColumns(qx, table, cacheKey)).length > 0;
}

/** Hämtar rader från dev och upsert:ar dem i prod via given prod-klient. */
async function copyTable(
  prod: pg.PoolClient,
  table: string,
  whereSql: string,
  params: unknown[] = [],
  opts: { conflictKey?: string } = {},
): Promise<number> {
  const t = track(table);

  const [devCols, prodCols, devPk, prodPk] = await Promise.all([
    getColumns(dev, table, "dev"),
    getColumns(prod, table, "prod"),
    getPrimaryKey(dev, table, "dev"),
    getPrimaryKey(prod, table, "prod"),
  ]);
  // Auto-detect PK; opts.conflictKey är override. Sammansatt PK → kräver explicit override.
  const conflictKey = opts.conflictKey ?? prodPk ?? devPk;
  if (!conflictKey) {
    throw new Error(
      `copyTable(${table}): kunde inte avgöra PK automatiskt (sammansatt eller saknas). ` +
        `Sätt opts.conflictKey explicit.`,
    );
  }
  if (devPk && prodPk && devPk !== prodPk) {
    throw new Error(
      `copyTable(${table}): PK-mismatch dev=${devPk} prod=${prodPk}. Schema måste synkas först.`,
    );
  }
  if (devCols.length === 0) {
    log(`  [skip] ${table}: tabell saknas i dev`);
    return 0;
  }
  if (prodCols.length === 0) {
    log(`  [skip] ${table}: tabell saknas i prod (schema-diff?)`);
    return 0;
  }
  const cols = devCols.filter((c) => prodCols.includes(c));
  if (cols.length === 0) {
    log(`  [skip] ${table}: inga gemensamma kolumner`);
    return 0;
  }

  const colList = cols.map((c) => `"${c}"`).join(", ");
  const sel = `SELECT ${colList} FROM ${table} WHERE ${whereSql}`;
  const rows = await dev.query(sel, params);
  t.fetched += rows.rowCount ?? 0;
  if (rows.rowCount === 0) {
    log(`  ${table.padEnd(40)} fetched=0`);
    return 0;
  }

  const updateCols = cols.filter((c) => c !== conflictKey);
  const setClause = updateCols.length
    ? updateCols.map((c) => `"${c}"=EXCLUDED."${c}"`).join(", ")
    : null;

  let upserted = 0;
  for (let i = 0; i < rows.rows.length; i += BATCH) {
    const slice = rows.rows.slice(i, i + BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const row of slice) {
      const tuple = cols.map(() => `$${p++}`).join(", ");
      placeholders.push(`(${tuple})`);
      for (const c of cols) values.push(row[c]);
    }
    const sql =
      `INSERT INTO ${table} (${colList}) VALUES ${placeholders.join(", ")} ` +
      (setClause
        ? `ON CONFLICT ("${conflictKey}") DO UPDATE SET ${setClause}`
        : `ON CONFLICT ("${conflictKey}") DO NOTHING`);
    const r = await prod.query(sql, values);
    upserted += r.rowCount ?? slice.length;
  }
  t.upserted += upserted;
  log(`  ${table.padEnd(40)} fetched=${rows.rowCount} upserted=${upserted}`);
  return upserted;
}

async function deleteByColumn(
  prod: pg.PoolClient,
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  if (!(await tableExists(prod, table, "prod"))) return 0;
  const cols = await getColumns(prod, table, "prod");
  if (!cols.includes(column)) return 0;
  const r = await prod.query(
    `DELETE FROM ${table} WHERE "${column}" = ANY($1::text[])`,
    [ids],
  );
  const t = track(table);
  t.deleted += r.rowCount ?? 0;
  if (r.rowCount) log(`  [del] ${table.padEnd(40)} via ${column} = ${r.rowCount}`);
  return r.rowCount ?? 0;
}

// ----------------------------- phase: cleanup --------------------

async function getProdTestCustomerIds(prod: pg.PoolClient): Promise<string[] | "skip"> {
  if (TEST_CUSTOMER_IDS_ENV) {
    return TEST_CUSTOMER_IDS_ENV.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const r = await prod.query<{ id: string }>(
    `SELECT id FROM customers WHERE tenant_id=$1 AND deleted_at IS NULL`,
    [TENANT],
  );
  // Idempotens: efter en lyckad full-migrering har prod många kunder. Då är
  // cleanup-fasen ett no-op (det finns inga testkunder kvar att rensa).
  // Den kan tvingas via TEST_CUSTOMER_IDS=... om man explicit vill.
  if (r.rowCount! > 10) {
    log(
      `  [skip] cleanup: prod har ${r.rowCount} kunder för ${TENANT} (>10). ` +
        `Antar att initial cleanup redan körts — no-op. Sätt TEST_CUSTOMER_IDS=... för att tvinga.`,
    );
    return "skip";
  }
  return r.rows.map((x) => x.id);
}

const OBJECT_CHILDREN = [
  "annual_goals",
  "assignments",
  "customer_booking_requests",
  "customer_change_requests",
  "customer_communications",
  "customer_issue_reports",
  "deviation_reports",
  "inspection_metadata",
  "iot_devices",
  "metadata_historik",
  "metadata_varden",
  "ml_feature_snapshots",
  "object_articles",
  "object_contacts",
  "object_images",
  "object_metadata",
  "object_parents",
  "object_payers",
  "object_time_restrictions",
  "order_concept_objects",
  "planning_parameters",
  "portal_user_object_scopes",
  "predictive_forecasts",
  "protocols",
  "public_issue_reports",
  "qr_code_links",
  "self_bookings",
  "setup_time_logs",
  "subscription_changes",
  "subscriptions",
  "task_metadata_updates",
  "work_order_objects",
];

const WORKORDER_CHILDREN = [
  "customer_booking_requests",
  "customer_communications",
  "deviation_reports",
  "environmental_data",
  "eta_notifications",
  "inspection_metadata",
  "invoice_recalculation_log",
  "metadata_varden",
  "ml_feature_snapshots",
  "order_checklist_items",
  "protocols",
  "setup_time_logs",
  "task_dependencies",
  "task_dependency_instances",
  "task_desired_timewindows",
  "task_information",
  "task_metadata_updates",
  "urgent_job_assignments",
  "visit_confirmations",
  "work_entries",
  "work_order_dependencies",
  "work_order_lines",
  "work_order_objects",
];

const CUSTOMER_CHILDREN = [
  "annual_goals",
  "customer_booking_requests",
  "customer_change_requests",
  "customer_communications",
  "customer_invoices",
  "customer_issue_reports",
  "customer_notification_settings",
  "customer_portal_messages",
  "customer_portal_sessions",
  "customer_portal_tokens",
  "customer_service_contracts",
  "eta_notifications",
  "fortnox_contract_suggestions",
  "manual_invoice_lines",
  "object_payers",
  "planning_parameters",
  "portal_messages",
  "portal_users",
  "price_lists",
  "procurements",
  "self_bookings",
  "subscriptions",
  "technician_ratings",
  "visit_confirmations",
];

async function cleanupTestCustomers(prod: pg.PoolClient): Promise<void> {
  log("\n=== PHASE: cleanup ===");
  const result = await getProdTestCustomerIds(prod);
  if (result === "skip") return; // idempotent rerun
  const customerIds = result;
  if (customerIds.length === 0) {
    log("  Inga testkunder att radera.");
    return;
  }
  log(`  Identifierade ${customerIds.length} kund(er): ${customerIds.join(", ")}`);

  const objR = await prod.query<{ id: string }>(
    `SELECT id FROM objects WHERE customer_id = ANY($1::text[])`,
    [customerIds],
  );
  const objectIds = objR.rows.map((r) => r.id);
  const woR = await prod.query<{ id: string }>(
    `SELECT id FROM work_orders WHERE customer_id = ANY($1::text[])`,
    [customerIds],
  );
  const woIds = woR.rows.map((r) => r.id);
  log(`  → ${objectIds.length} objekt, ${woIds.length} work_orders`);

  for (const t of WORKORDER_CHILDREN) {
    await deleteByColumn(prod, t, "work_order_id", woIds);
  }
  await deleteByColumn(prod, "task_dependencies", "depends_on_work_order_id", woIds);
  await deleteByColumn(prod, "task_dependency_instances", "parent_work_order_id", woIds);
  await deleteByColumn(prod, "task_dependency_instances", "child_work_order_id", woIds);
  await deleteByColumn(prod, "work_order_dependencies", "depends_on_work_order_id", woIds);
  await deleteByColumn(prod, "urgent_job_assignments", "order_id", woIds);

  if (woIds.length) {
    await prod.query(
      `UPDATE work_orders SET parent_work_order_id=NULL WHERE parent_work_order_id = ANY($1::text[])`,
      [woIds],
    );
    const r = await prod.query(
      `DELETE FROM work_orders WHERE id = ANY($1::text[])`,
      [woIds],
    );
    track("work_orders").deleted += r.rowCount ?? 0;
    log(`  [del] work_orders = ${r.rowCount}`);
  }

  for (const t of OBJECT_CHILDREN) {
    await deleteByColumn(prod, t, "object_id", objectIds);
  }
  await deleteByColumn(prod, "metadata_historik", "objekt_id", objectIds);
  await deleteByColumn(prod, "metadata_varden", "objekt_id", objectIds);
  await deleteByColumn(prod, "object_contacts", "inherited_from_object_id", objectIds);
  await deleteByColumn(prod, "object_parents", "parent_id", objectIds);

  if (objectIds.length) {
    await prod.query(
      `UPDATE objects SET parent_id=NULL WHERE parent_id = ANY($1::text[])`,
      [objectIds],
    );
    const r = await prod.query(
      `DELETE FROM objects WHERE id = ANY($1::text[])`,
      [objectIds],
    );
    track("objects").deleted += r.rowCount ?? 0;
    log(`  [del] objects = ${r.rowCount}`);
  }

  // Cascade: assignment_articles måste bort innan assignments
  if (objectIds.length) {
    const asgR = await prod.query<{ id: string }>(
      `SELECT id FROM assignments WHERE object_id = ANY($1::text[])`,
      [objectIds],
    );
    const asgIds = asgR.rows.map((r) => r.id);
    await deleteByColumn(prod, "assignment_articles", "assignment_id", asgIds);
  }

  // Cascade: price_list_articles innan price_lists
  const plR = await prod.query<{ id: string }>(
    `SELECT id FROM price_lists WHERE customer_id = ANY($1::text[])`,
    [customerIds],
  );
  const plIds = plR.rows.map((r) => r.id);
  await deleteByColumn(prod, "price_list_articles", "price_list_id", plIds);
  await deleteByColumn(prod, "subscriptions", "price_list_id", plIds);

  for (const t of CUSTOMER_CHILDREN) {
    await deleteByColumn(prod, t, "customer_id", customerIds);
  }
  // Nollställ root_customer_id på clusters innan kund-radering (FK action 'a')
  if (customerIds.length) {
    await prod.query(
      `UPDATE clusters SET root_customer_id=NULL WHERE root_customer_id = ANY($1::text[])`,
      [customerIds],
    );
  }

  const r = await prod.query(
    `DELETE FROM customers WHERE id = ANY($1::text[])`,
    [customerIds],
  );
  track("customers").deleted += r.rowCount ?? 0;
  log(`  [del] customers = ${r.rowCount}`);
}

// ----------------------------- phase: config ---------------------

/**
 * Kopierar clusters i config-fasen med root_customer_id forcerad till NULL.
 * Ger oss FK-mål för teams.cluster_id, order_concepts.target_cluster_id m.fl.
 * Kunder finns inte ännu — customers-fasen kör om kopian och fyller riktigt
 * root_customer_id via ON CONFLICT DO UPDATE.
 */
async function copyClustersConfigPhase(prod: pg.PoolClient): Promise<void> {
  const t = track("clusters");
  const [devCols, prodCols] = await Promise.all([
    getColumns(dev, "clusters", "dev"),
    getColumns(prod, "clusters", "prod"),
  ]);
  if (devCols.length === 0 || prodCols.length === 0) {
    log("  [skip] clusters: tabell saknas");
    return;
  }
  const cols = devCols.filter((c) => prodCols.includes(c));
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const rows = await dev.query(
    `SELECT ${colList} FROM clusters WHERE tenant_id = $1`,
    [TENANT],
  );
  t.fetched += rows.rowCount ?? 0;
  if (rows.rowCount === 0) {
    log(`  clusters (config-pass)                   fetched=0`);
    return;
  }
  const updateCols = cols.filter((c) => c !== "id" && c !== "root_customer_id");
  const setClause = updateCols
    .map((c) => `"${c}"=EXCLUDED."${c}"`)
    .join(", ");
  let upserted = 0;
  for (let i = 0; i < rows.rows.length; i += BATCH) {
    const slice = rows.rows.slice(i, i + BATCH);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const row of slice) {
      const tuple = cols
        .map((c) => (c === "root_customer_id" ? "NULL" : `$${p++}`))
        .join(", ");
      placeholders.push(`(${tuple})`);
      for (const c of cols) {
        if (c !== "root_customer_id") values.push(row[c]);
      }
    }
    const sql =
      `INSERT INTO clusters (${colList}) VALUES ${placeholders.join(", ")} ` +
      `ON CONFLICT ("id") DO UPDATE SET ${setClause}`;
    const r = await prod.query(sql, values);
    upserted += r.rowCount ?? slice.length;
  }
  t.upserted += upserted;
  log(`  clusters (config-pass, root=NULL)        fetched=${rows.rowCount} upserted=${upserted}`);
}

async function migrateConfig(prod: pg.PoolClient): Promise<void> {
  log("\n=== PHASE: config ===");

  await copyTable(prod, "tenants", `id = $1`, [TENANT]);
  await copyTable(prod, "tenant_branding", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "tenant_features", `tenant_id = $1`, [TENANT]);

  await copyTable(
    prod,
    "users",
    `id IN (SELECT user_id FROM user_tenant_roles WHERE tenant_id = $1)`,
    [TENANT],
  );
  await copyTable(prod, "user_tenant_roles", `tenant_id = $1`, [TENANT]);

  await copyTable(prod, "resources", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "resource_profiles", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "resource_profile_assignments", `tenant_id = $1`, [TENANT]);

  // CLUSTERS måste finnas innan teams (teams.cluster_id FK), order_concepts
  // (target_cluster_id FK) m.fl. Kunder finns inte ännu, så vi nullar
  // root_customer_id i config-fasen och fyller det riktiga värdet i
  // customers-fasen via ON CONFLICT UPDATE.
  await copyClustersConfigPhase(prod);

  await copyTable(prod, "teams", `tenant_id = $1`, [TENANT]);
  await copyTable(
    prod,
    "team_members",
    `team_id IN (SELECT id FROM teams WHERE tenant_id = $1)`,
    [TENANT],
  );

  await copyTable(prod, "vehicles", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "equipment", `tenant_id = $1`, [TENANT]);
  await copyTable(
    prod,
    "resource_vehicles",
    `resource_id IN (SELECT id FROM resources WHERE tenant_id = $1)`,
    [TENANT],
  );
  await copyTable(
    prod,
    "resource_equipment",
    `resource_id IN (SELECT id FROM resources WHERE tenant_id = $1)`,
    [TENANT],
  );

  await copyTable(prod, "articles", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "article_components", `tenant_id = $1`, [TENANT]);
  await copyTable(
    prod,
    "resource_articles",
    `resource_id IN (SELECT id FROM resources WHERE tenant_id = $1)`,
    [TENANT],
  );

  await copyTable(
    prod,
    "price_lists",
    `tenant_id = $1 AND customer_id IS NULL`,
    [TENANT],
  );
  await copyTable(
    prod,
    "price_list_articles",
    `price_list_id IN (SELECT id FROM price_lists WHERE tenant_id = $1 AND customer_id IS NULL)`,
    [TENANT],
  );

  await copyTable(prod, "checklist_templates", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "metadata_definitions", `tenant_id = $1`, [TENANT]);

  await copyTable(prod, "fortnox_config", `tenant_id = $1`, [TENANT]);
  await copyTable(prod, "fortnox_mappings", `tenant_id = $1`, [TENANT]);

  await copyTable(
    prod,
    "planning_parameters",
    `tenant_id = $1 AND customer_id IS NULL AND object_id IS NULL`,
    [TENANT],
  );

  if (await tableExists(dev, "order_concepts", "dev")) {
    await copyTable(prod, "order_concepts", `tenant_id = $1`, [TENANT]);
    await copyTable(
      prod,
      "delivery_schedules",
      `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = $1)`,
      [TENANT],
    );
    await copyTable(
      prod,
      "invoice_configurations",
      `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = $1)`,
      [TENANT],
    );
    await copyTable(
      prod,
      "document_configurations",
      `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = $1)`,
      [TENANT],
    );
    await copyTable(
      prod,
      "order_concept_articles",
      `order_concept_id IN (SELECT id FROM order_concepts WHERE tenant_id = $1)`,
      [TENANT],
    );
    if (await tableExists(dev, "concept_filters", "dev")) {
      await copyTable(prod, "concept_filters", `tenant_id = $1`, [TENANT]);
    }
  }
}

// ----------------------------- phase: customers ------------------

/** Skipped-rader för audit-rapport: { kind, id, reason } */
const skipped: { kind: string; id: string; reason: string }[] = [];

async function getActiveCustomerIds(): Promise<string[]> {
  // Selektiv import via --customer-id=id1,id2,... — användbart vid återställning
  // av specifika vilande kunder efter initial migrering.
  if (CUSTOMER_ID_ARG) {
    const ids = CUSTOMER_ID_ARG.split(",").map((s) => s.trim()).filter(Boolean);
    log(`  --customer-id satt: importerar ${ids.length} explicita kund(er)`);
    // Verifiera att de finns i dev under rätt tenant
    const r = await dev.query<{ id: string }>(
      `SELECT id FROM customers WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [TENANT, ids],
    );
    const found = new Set(r.rows.map((x) => x.id));
    for (const id of ids) {
      if (!found.has(id)) skipped.push({ kind: "customer", id, reason: "ej i dev under rätt tenant" });
    }
    return [...found];
  }

  const r = await dev.query<{ customer_id: string }>(
    `SELECT DISTINCT customer_id FROM work_orders
     WHERE tenant_id = $1
       AND scheduled_date >= $2
       AND customer_id IS NOT NULL`,
    [TENANT, ACTIVE_SINCE],
  );
  let ids = r.rows.map((x) => x.customer_id);

  // Audit: lista kunder som SKIPPAS (vilande, work_order < ACTIVE_SINCE)
  const dormant = await dev.query<{ id: string }>(
    `SELECT id FROM customers
     WHERE tenant_id = $1 AND id NOT IN (SELECT unnest($2::text[]))`,
    [TENANT, ids],
  );
  for (const row of dormant.rows) {
    skipped.push({ kind: "customer", id: row.id, reason: `vilande (work_order < ${ACTIVE_SINCE})` });
  }

  // --limit=N tar de N första kunderna (deterministisk via sort) — för stegvis test
  if (LIMIT && LIMIT > 0 && ids.length > LIMIT) {
    ids.sort();
    const dropped = ids.slice(LIMIT);
    for (const id of dropped) {
      skipped.push({ kind: "customer", id, reason: `--limit=${LIMIT}` });
    }
    ids = ids.slice(0, LIMIT);
    log(`  --limit=${LIMIT} satt: kapad till ${ids.length} kunder`);
  }
  return ids;
}

async function migrateCustomers(prod: pg.PoolClient): Promise<void> {
  log("\n=== PHASE: customers ===");
  const customerIds = await getActiveCustomerIds();
  log(`  Aktiva kunder (work_order >= ${ACTIVE_SINCE}): ${customerIds.length}`);
  if (customerIds.length === 0) return;

  await copyTable(
    prod,
    "customers",
    `tenant_id = $1 AND id = ANY($2::text[])`,
    [TENANT, customerIds],
  );

  await copyTable(
    prod,
    "price_lists",
    `tenant_id = $1 AND customer_id = ANY($2::text[])`,
    [TENANT, customerIds],
  );
  await copyTable(
    prod,
    "price_list_articles",
    `price_list_id IN (SELECT id FROM price_lists WHERE tenant_id = $1 AND customer_id = ANY($2::text[]))`,
    [TENANT, customerIds],
  );

  // Re-copy clusters med root_customer_id satt — i config-fasen sattes detta
  // till NULL eftersom kunderna inte fanns ännu. ON CONFLICT UPDATE fyller på.
  await copyTable(
    prod,
    "clusters",
    `tenant_id = $1 AND root_customer_id = ANY($2::text[])`,
    [TENANT, customerIds],
  );

  await copyTable(
    prod,
    "customer_notification_settings",
    `customer_id = ANY($1::text[])`,
    [customerIds],
  );
  await copyTable(
    prod,
    "customer_service_contracts",
    `customer_id = ANY($1::text[])`,
    [customerIds],
  );

  await copyTable(prod, "portal_users", `customer_id = ANY($1::text[])`, [customerIds]);

  await copyObjectsTopologically(prod, customerIds);

  const objIds = await dev.query<{ id: string }>(
    `SELECT id FROM objects WHERE tenant_id = $1 AND customer_id = ANY($2::text[])`,
    [TENANT, customerIds],
  );
  const objectIds = objIds.rows.map((r) => r.id);
  log(`  Antal objekt att hänga av: ${objectIds.length}`);

  await copyTable(prod, "object_parents", `object_id = ANY($1::text[])`, [objectIds]);
  await copyTable(prod, "object_metadata", `object_id = ANY($1::text[])`, [objectIds]);
  await copyTable(prod, "object_contacts", `object_id = ANY($1::text[])`, [objectIds]);
  // object_images SKIPPAS avsiktligt — uppladdade media är out-of-scope för
  // slim-migreringen (object-storage-artefakter följer inte med dev→prod).
  await copyTable(prod, "object_articles", `object_id = ANY($1::text[])`, [objectIds]);
  await copyTable(
    prod,
    "object_payers",
    `object_id = ANY($1::text[]) AND customer_id = ANY($2::text[])`,
    [objectIds, customerIds],
  );
  await copyTable(prod, "object_time_restrictions", `object_id = ANY($1::text[])`, [objectIds]);

  await copyTable(
    prod,
    "planning_parameters",
    `tenant_id = $1 AND (customer_id = ANY($2::text[]) OR object_id = ANY($3::text[]))`,
    [TENANT, customerIds, objectIds],
  );

  await copyTable(
    prod,
    "portal_user_object_scopes",
    `portal_user_id IN (SELECT id FROM portal_users WHERE customer_id = ANY($1::text[]))
       AND object_id = ANY($2::text[])`,
    [customerIds, objectIds],
  );

  if (await tableExists(dev, "metadata_varden", "dev")) {
    await copyTable(
      prod,
      "metadata_varden",
      `tenant_id = $1 AND objekt_id = ANY($2::text[]) AND work_order_id IS NULL`,
      [TENANT, objectIds],
    );
  }
}

/**
 * Kopierar objekt nivå-för-nivå så parent_id-FK upprätthålls.
 */
async function copyObjectsTopologically(
  prod: pg.PoolClient,
  customerIds: string[],
): Promise<void> {
  const all = await dev.query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM objects
     WHERE tenant_id = $1 AND customer_id = ANY($2::text[])`,
    [TENANT, customerIds],
  );
  const idSet = new Set(all.rows.map((r) => r.id));
  const inSetParent = (pid: string | null) => pid !== null && idSet.has(pid);

  const level = new Map<string, number>();
  const remaining = new Map(all.rows.map((r) => [r.id, r.parent_id]));
  const orphans: string[] = [];
  let pass = 0;
  while (remaining.size > 0 && pass < 50) {
    const ready: string[] = [];
    for (const [id, pid] of remaining) {
      if (!inSetParent(pid) || level.has(pid!)) ready.push(id);
    }
    if (ready.length === 0) {
      // Cykel eller orphan: nolla parent_id på dev-sidan (i minnet) för
      // återstående och kopiera dem på sista nivån. Detta säkerställer att
      // FK alltid håller; hierarkin för dessa rader får återställas manuellt.
      log(
        `  [warn] Cykel/orphan i objects-träd, ${remaining.size} kvar — sätter parent_id=NULL och kopierar.`,
      );
      for (const id of remaining.keys()) {
        // Markera dem som "rotnivå" — copyTable kommer hämta hela raden från
        // dev. Vi behöver patcha parent_id efter kopian.
        orphans.push(id);
        level.set(id, pass);
        remaining.delete(id);
      }
      break;
    }
    for (const id of ready) {
      level.set(id, pass);
      remaining.delete(id);
    }
    pass++;
  }

  const byLevel: string[][] = [];
  for (const [id, lv] of level) {
    if (!byLevel[lv]) byLevel[lv] = [];
    byLevel[lv].push(id);
  }
  log(`  Objekt-träd har ${byLevel.length} nivåer`);
  for (let lv = 0; lv < byLevel.length; lv++) {
    const ids = byLevel[lv];
    if (!ids?.length) continue;
    await copyTable(prod, "objects", `id = ANY($1::text[])`, [ids]);
  }
  // Säkerhetsnät: nolla parent_id för rader vars parent inte hamnade i prod
  // (cykler/orphans). FK håller då alltid efter COMMIT.
  if (orphans.length) {
    await prod.query(
      `UPDATE objects SET parent_id=NULL
         WHERE id = ANY($1::text[])
           AND parent_id IS NOT NULL
           AND parent_id NOT IN (SELECT id FROM objects)`,
      [orphans],
    );
    log(`  [warn] Patchade parent_id=NULL för ${orphans.length} orphan-objekt`);
  }
}

// ----------------------------- preflight -------------------------

/**
 * Pg_constraint-driven täckningskontroll: varnar om någon FK till
 * customers/objects/work_orders inte finns i våra hardcodade cleanup-listor.
 * Skydd mot framtida schema-tillägg som annars hade lett till tysta orphans
 * eller misslyckad cleanup.
 */
async function preflightFkCoverage(prod: pg.PoolClient): Promise<void> {
  log("\n=== Preflight: FK-täckningskontroll ===");
  const r = await prod.query<{
    parent_table: string;
    child_table: string;
    child_column: string;
  }>(
    `SELECT confrelid::regclass::text AS parent_table,
            conrelid::regclass::text  AS child_table,
            a.attname                  AS child_column
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
     WHERE c.contype='f'
       AND confrelid::regclass::text IN ('customers','objects','work_orders')`,
  );
  // Tabeller vi avsiktligt INTE rör (cleanup ska ej kasta för dessa).
  const ignored = new Set<string>([
    // Self-FKs hanteras explicit
    "objects.parent_id",
    "object_parents.parent_id",
    "object_contacts.inherited_from_object_id",
    "work_orders.parent_work_order_id",
    "task_dependencies.depends_on_work_order_id",
    "task_dependency_instances.parent_work_order_id",
    "task_dependency_instances.child_work_order_id",
    "work_order_dependencies.depends_on_work_order_id",
    "urgent_job_assignments.order_id",
  ]);
  const have = new Set<string>();
  for (const t of OBJECT_CHILDREN) have.add(`${t}.object_id`);
  for (const t of WORKORDER_CHILDREN) have.add(`${t}.work_order_id`);
  for (const t of CUSTOMER_CHILDREN) have.add(`${t}.customer_id`);
  // Specialnamn
  have.add("metadata_historik.objekt_id");
  have.add("metadata_varden.objekt_id");
  have.add("clusters.root_customer_id");
  have.add("objects.customer_id");
  have.add("work_orders.customer_id");
  have.add("work_orders.object_id");

  const missing: string[] = [];
  for (const row of r.rows) {
    const key = `${row.child_table}.${row.child_column}`;
    if (ignored.has(key)) continue;
    if (!have.has(key)) missing.push(`${key} → ${row.parent_table}`);
  }
  if (missing.length === 0) {
    log(`  Alla ${r.rowCount} FK till customers/objects/work_orders täcks av cleanup-listorna.`);
    return;
  }
  log(`  [WARN] ${missing.length} FK saknas i cleanup-listorna:`);
  for (const m of missing) log(`    - ${m}`);
  log(`  Lägg till dem i OBJECT_CHILDREN/WORKORDER_CHILDREN/CUSTOMER_CHILDREN ` +
      `om de innehåller data, annars ignorera-listan.`);
}

// ----------------------------- main ------------------------------

async function main() {
  log("Traivo Kinab DEV → PROD migration");
  log(`  TENANT          : ${TENANT}`);
  log(`  ACTIVE_SINCE    : ${ACTIVE_SINCE}`);
  log(`  PHASE           : ${PHASE}`);
  log(`  BATCH           : ${BATCH}`);
  log(`  DRY_RUN         : ${DRY_RUN ? "JA (rollback i slutet)" : "NEJ — committar"}`);
  log("");

  const devC = await dev.query(
    `SELECT count(*)::int AS c FROM customers WHERE tenant_id=$1`,
    [TENANT],
  );
  const prodCBefore = await prodPool.query(
    `SELECT count(*)::int AS c FROM customers WHERE tenant_id=$1`,
    [TENANT],
  );
  log(
    `  Före: dev=${devC.rows[0].c} kunder, prod=${prodCBefore.rows[0].c} kunder för ${TENANT}`,
  );

  const prod = await prodPool.connect();
  let committed = false;
  try {
    await prod.query("BEGIN");

    // Preflight: pg_constraint-driven täckningskontroll. Varnar om någon FK
    // till customers/objects/work_orders saknas i våra cleanup-listor.
    await preflightFkCoverage(prod);

    if (PHASE === "cleanup" || PHASE === "all") {
      await cleanupTestCustomers(prod);
    }
    if (PHASE === "config" || PHASE === "all") {
      await migrateConfig(prod);
    }
    if (PHASE === "customers" || PHASE === "all") {
      await migrateCustomers(prod);
    }

    // Räkna inom transaktionen
    const cAfter = await prod.query(
      `SELECT count(*)::int AS c FROM customers WHERE tenant_id=$1`,
      [TENANT],
    );
    const oAfter = await prod.query(
      `SELECT count(*)::int AS c FROM objects WHERE tenant_id=$1`,
      [TENANT],
    );
    log(
      `\n  Efter (i transaktion): prod=${cAfter.rows[0].c} kunder, ${oAfter.rows[0].c} objekt`,
    );

    // ============ Post-run validering (innan COMMIT) ============
    log("\n=== Post-run validation ===");
    const validationErrors: string[] = [];

    // 1) FK-integritet: alla objects.parent_id måste peka på existerande objekt
    const orphParents = await prod.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM objects o
       WHERE o.parent_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM objects p WHERE p.id = o.parent_id)`,
    );
    if (orphParents.rows[0].c > 0) {
      validationErrors.push(`objects.parent_id: ${orphParents.rows[0].c} orphan(s)`);
    }
    log(`  objects.parent_id orphans: ${orphParents.rows[0].c}`);

    // 2) FK-integritet: clusters.root_customer_id → customers.id
    const orphClust = await prod.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM clusters c
       WHERE c.root_customer_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = c.root_customer_id)`,
    );
    if (orphClust.rows[0].c > 0) {
      validationErrors.push(`clusters.root_customer_id: ${orphClust.rows[0].c} orphan(s)`);
    }
    log(`  clusters.root_customer_id orphans: ${orphClust.rows[0].c}`);

    // 3) FK-integritet: price_list_articles → price_lists
    const orphPla = await prod.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM price_list_articles pla
       WHERE NOT EXISTS (SELECT 1 FROM price_lists pl WHERE pl.id = pla.price_list_id)`,
    );
    if (orphPla.rows[0].c > 0) {
      validationErrors.push(`price_list_articles: ${orphPla.rows[0].c} orphan(s)`);
    }
    log(`  price_list_articles orphans: ${orphPla.rows[0].c}`);

    // 4) Tenant-leak: för varje tabell vi rört som har BÅDE tenant_id OCH
    //    customer_id/object_id, kontrollera att rader vars FK pekar på en
    //    kinab-kund/objekt också har tenant_id = kinab. Vi kan inte göra en
    //    bred check över tabellerna eftersom prod är multi-tenant och andra
    //    tenants legitimt har egna rader.
    const leakTables = await prod.query<{ table_name: string; has_cust: boolean; has_obj: boolean }>(
      `SELECT t.table_name,
              bool_or(c.column_name='customer_id') AS has_cust,
              bool_or(c.column_name='object_id')   AS has_obj
       FROM information_schema.columns c
       JOIN (SELECT DISTINCT table_name FROM information_schema.columns
             WHERE table_schema='public' AND column_name='tenant_id'
               AND table_name = ANY($1::text[])) t
         ON t.table_name=c.table_name
       WHERE c.table_schema='public'
         AND c.column_name IN ('customer_id','object_id')
       GROUP BY t.table_name`,
      [Object.keys(counters)],
    );
    let totalLeak = 0;
    for (const row of leakTables.rows) {
      const conds: string[] = [];
      if (row.has_cust) {
        conds.push(`customer_id IN (SELECT id FROM customers WHERE tenant_id = $1)`);
      }
      if (row.has_obj) {
        conds.push(`object_id IN (SELECT id FROM objects WHERE tenant_id = $1)`);
      }
      if (conds.length === 0) continue;
      const lk = await prod.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM "${row.table_name}"
         WHERE (${conds.join(" OR ")})
           AND tenant_id IS DISTINCT FROM $1`,
        [TENANT],
      );
      if (lk.rows[0].c > 0) {
        validationErrors.push(
          `tenant-leak: ${row.table_name} har ${lk.rows[0].c} rader vars FK pekar på kinab men tenant_id ≠ kinab`,
        );
        totalLeak += lk.rows[0].c;
      }
    }
    log(`  Tenant-leak check (${leakTables.rowCount} tabeller): ${totalLeak} läckor`);

    if (validationErrors.length > 0) {
      throw new Error(
        `Post-run validation FAILED:\n  - ${validationErrors.join("\n  - ")}\n` +
          `Tvångs-rollback. Fixa skriptet/datakällan och kör om.`,
      );
    }
    log("  Alla post-run-checkar OK.");

    if (DRY_RUN) {
      await prod.query("ROLLBACK");
      log("\n[DRY-RUN] Rollback klar — inga ändringar persisterade.");
    } else {
      await prod.query("COMMIT");
      committed = true;
      log("\n[COMMIT] Ändringar persisterade i prod.");
    }
  } catch (err) {
    await prod.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    prod.release();
  }

  // Räkna efter (utanför transaktion)
  const cFinal = await prodPool.query(
    `SELECT count(*)::int AS c FROM customers WHERE tenant_id=$1`,
    [TENANT],
  );
  const oFinal = await prodPool.query(
    `SELECT count(*)::int AS c FROM objects WHERE tenant_id=$1`,
    [TENANT],
  );
  log(
    `  Slutgiltigt i prod: ${cFinal.rows[0].c} kunder, ${oFinal.rows[0].c} objekt (committed=${committed})`,
  );

  // Rapport
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 13);
  const reportPath = path.join(process.cwd(), `migration-report-${stamp}.md`);
  const lines: string[] = [];
  lines.push(`# Kinab DEV → PROD migration ${stamp}`);
  lines.push("");
  lines.push(`- Tenant: ${TENANT}`);
  lines.push(`- Active since: ${ACTIVE_SINCE}`);
  lines.push(`- Phase: ${PHASE}`);
  lines.push(`- Dry-run: ${DRY_RUN}`);
  lines.push(`- Committed: ${committed}`);
  lines.push(
    `- Kunder: dev=${devC.rows[0].c}, prod före=${prodCBefore.rows[0].c}, prod efter=${cFinal.rows[0].c}`,
  );
  lines.push(`- Objekt i prod efter: ${oFinal.rows[0].c}`);
  lines.push("");
  lines.push("## Per tabell");
  lines.push("");
  lines.push("| Tabell | Hämtade | Upserterade | Raderade |");
  lines.push("|---|---:|---:|---:|");
  for (const [t, c] of Object.entries(counters).sort()) {
    lines.push(`| ${t} | ${c.fetched} | ${c.upserted} | ${c.deleted} |`);
  }
  lines.push("");
  lines.push(`## Skippade entiteter (${skipped.length})`);
  lines.push("");
  if (skipped.length === 0) {
    lines.push("Inga.");
  } else {
    lines.push("| Typ | ID | Anledning |");
    lines.push("|---|---|---|");
    // Visa max 50 + summering per anledning
    const byReason: Record<string, number> = {};
    for (const s of skipped) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
    for (const s of skipped.slice(0, 50)) {
      lines.push(`| ${s.kind} | ${s.id} | ${s.reason} |`);
    }
    if (skipped.length > 50) lines.push(`| … | … | (${skipped.length - 50} fler) |`);
    lines.push("");
    lines.push("### Summering per anledning");
    for (const [reason, n] of Object.entries(byReason).sort()) {
      lines.push(`- ${reason}: ${n}`);
    }
  }
  fs.writeFileSync(reportPath, lines.join("\n") + "\n", "utf8");
  log(`\nRapport sparad: ${reportPath}`);

  await dev.end();
  await prodPool.end();
}

main().catch(async (err) => {
  console.error("\nFEL:", err);
  await dev.end().catch(() => {});
  await prodPool.end().catch(() => {});
  process.exit(1);
});
