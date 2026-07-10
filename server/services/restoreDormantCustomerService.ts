/**
 * Shared service for restoring individual dormant customers DEV → PROD (Task #428).
 *
 * Used both by:
 *   - CLI wrapper `scripts/restore-dormant-customer.ts` (Task #427)
 *   - Admin endpoint `POST /api/admin/restore-dormant-customers/restore` (Task #428)
 *
 * Heavy lifting (transaction, FK-checks, tenant-leak-check, idempotent upsert,
 * post-run validation) is still delegated to `scripts/migrate-kinab-dev-to-prod.ts`
 * via spawn — this module only adds:
 *   1. Read-only search against the dev DB
 *   2. Dormancy preflight (refuse to restore active customers unless allowed)
 *   3. Spawn-wrapper that streams migrate output back to the caller
 *   4. Audit-log write to PROD with the requesting user_id (or NULL for CLI)
 *
 * NOTE: audit row is written AFTER the migrate transaction commits — failure to
 * persist the audit row leaves the data restored but the audit missing.
 */
import pg from "pg";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { createHash } from "node:crypto";

const { Pool, Client } = pg;

export interface SearchResultRow {
  id: string;
  name: string;
  customerNumber: string | null;
  orgNumber: string | null;
  objectCount: number;
  lastWoDate: string | null;
  isActive: boolean;
}

export interface PreflightRow {
  id: string;
  name: string;
  isActive: boolean;
  objectCount: number;
}

export interface RestoreOptions {
  ids: string[];
  tenant?: string;
  activeSince?: string;
  allowActive?: boolean;
  dryRun: boolean;
  /** When true, missing PROD_DATABASE_URL is fatal. When false, only audit is skipped. */
  requireProdUrl?: boolean;
  /** User id to record on the audit row. Null for CLI-mode. */
  userId: string | null;
  /** Free-form actor (epost/namn) for audit metadata. */
  actor: string | null;
}

export interface RestoreResult {
  preflight: PreflightRow[];
  migrateExitCode: number;
  migrateLog: string;
  auditWritten: boolean;
  dryRun: boolean;
  lockKey?: [number, number];
}

export class RestoreDormantError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "RestoreDormantError";
  }
}

const DEFAULT_TENANT = "kinab";
const DEFAULT_ACTIVE_SINCE = "2024-01-01";

function devPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new RestoreDormantError("missing_dev_url", "DATABASE_URL (dev) saknas.");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

/**
 * Read-only search in dev. Returns up to 50 customers matching id/name/customer_number/org_number.
 */
export async function searchDormantCustomers(opts: {
  query: string;
  tenant?: string;
  activeSince?: string;
}): Promise<SearchResultRow[]> {
  const tenant = opts.tenant || DEFAULT_TENANT;
  const activeSince = opts.activeSince || DEFAULT_ACTIVE_SINCE;
  const like = `%${opts.query.toLowerCase()}%`;
  const dev = devPool();
  try {
    const r = await dev.query<{
      id: string;
      name: string;
      customer_number: string | null;
      org_number: string | null;
      object_count: number;
      last_wo_date: string | null;
      is_active: boolean;
    }>(
      `SELECT c.id,
              c.name,
              c.customer_number,
              c.org_number,
              (SELECT count(*)::int FROM objects o
                JOIN metadata_varden mv ON mv.objekt_id = o.id AND COALESCE(mv.raderad, false) = false
                JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
                  AND lower(mk.namn) = 'kund' AND mk.deleted_at IS NULL
                WHERE mv.varde_referens = c.id AND o.tenant_id = $1 AND o.deleted_at IS NULL) AS object_count,
              (SELECT max(scheduled_date)::text FROM work_orders w
                WHERE w.customer_id = c.id AND w.tenant_id = $1) AS last_wo_date,
              EXISTS(
                SELECT 1 FROM work_orders w
                 WHERE w.customer_id = c.id
                   AND w.tenant_id = $1
                   AND w.scheduled_date >= $2
              ) AS is_active
       FROM customers c
       WHERE c.tenant_id = $1
         AND c.deleted_at IS NULL
         AND (LOWER(c.id) LIKE $3
              OR LOWER(c.name) LIKE $3
              OR LOWER(COALESCE(c.customer_number,'')) LIKE $3
              OR LOWER(COALESCE(c.org_number,'')) LIKE $3)
       ORDER BY is_active DESC, c.name
       LIMIT 50`,
      [tenant, activeSince, like],
    );
    return r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      customerNumber: row.customer_number,
      orgNumber: row.org_number,
      objectCount: row.object_count,
      lastWoDate: row.last_wo_date,
      isActive: row.is_active,
    }));
  } finally {
    await dev.end();
  }
}

async function preflightDormancy(
  ids: string[],
  tenant: string,
  activeSince: string,
): Promise<PreflightRow[]> {
  const dev = devPool();
  try {
    const r = await dev.query<{
      id: string;
      name: string;
      is_active: boolean;
      object_count: number;
    }>(
      `SELECT c.id,
              c.name,
              EXISTS(
                SELECT 1 FROM work_orders w
                 WHERE w.customer_id = c.id
                   AND w.tenant_id = $1
                   AND w.scheduled_date >= $2
              ) AS is_active,
              (SELECT count(*)::int FROM objects o
                JOIN metadata_varden mv ON mv.objekt_id = o.id AND COALESCE(mv.raderad, false) = false
                JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
                  AND lower(mk.namn) = 'kund' AND mk.deleted_at IS NULL
                WHERE mv.varde_referens = c.id AND o.tenant_id = $1 AND o.deleted_at IS NULL) AS object_count
       FROM customers c
       WHERE c.tenant_id = $1
         AND c.id = ANY($3::text[])`,
      [tenant, activeSince, ids],
    );
    const found = new Set(r.rows.map((x) => x.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new RestoreDormantError(
        "customer_not_found",
        `kund-id saknas i dev under tenant=${tenant}: ${missing.join(", ")}`,
        { missing },
      );
    }
    return r.rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      objectCount: row.object_count,
    }));
  } finally {
    await dev.end();
  }
}

interface SpawnResult {
  exitCode: number;
  log: string;
}

function runMigrateScript(
  customerIds: string[],
  tenant: string,
  activeSince: string,
  dryRunFlag: boolean,
): Promise<SpawnResult> {
  const scriptPath = path.join(
    process.cwd(),
    "scripts",
    "migrate-kinab-dev-to-prod.ts",
  );
  const cmdArgs = [
    "tsx",
    scriptPath,
    "--phase=customers",
    `--tenant=${tenant}`,
    `--active-since=${activeSince}`,
    `--customer-id=${customerIds.join(",")}`,
  ];
  if (dryRunFlag) cmdArgs.push("--dry-run");

  return new Promise((resolve) => {
    const child = spawn("npx", cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let buf = "";
    const append = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      // Cap at 1 MB to avoid runaway memory.
      if (buf.length > 1024 * 1024) buf = buf.slice(-1024 * 1024);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let settled = false;
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: code, log: buf });
    };
    child.on("error", (err) => {
      buf += `\nFEL: kunde inte starta migrate-skriptet: ${err.message}\n`;
      done(1);
    });
    child.on("exit", (code) => done(code ?? 1));
  });
}

/**
 * Härled två int32-nycklar (key1, key2) för pg_advisory_lock från tenant +
 * sorterade kund-ID:n. Sortering gör att två körningar med samma uppsättning
 * ID:n (oavsett ordning eller dubbletter) konkurrerar om samma lås.
 */
function advisoryLockKeys(tenant: string, ids: string[]): [number, number] {
  const normalized = Array.from(new Set(ids)).sort().join(",");
  const payload = `restore-dormant-customer|${tenant}|${normalized}`;
  const digest = createHash("sha256").update(payload).digest();
  const key1 = digest.readInt32BE(0);
  const key2 = digest.readInt32BE(4);
  return [key1, key2];
}

/**
 * Försök ta session-level advisory-lock i prod runt hela körningen
 * (migrate + audit). pg_try_advisory_lock är icke-blockerande — en parallell
 * körning av CLI eller admin-endpoint mot samma kund-ID:n fail:ar tydligt
 * istället för att vänta och producera duplicerade audit-rader.
 */
async function acquireProdAdvisoryLock(
  tenant: string,
  ids: string[],
): Promise<{ release: () => Promise<void>; key: [number, number] }> {
  const key = advisoryLockKeys(tenant, ids);
  const client = new Client({ connectionString: process.env.PROD_DATABASE_URL });
  await client.connect();
  try {
    const r = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [key[0], key[1]],
    );
    if (!r.rows[0]?.locked) {
      await client.end().catch(() => {});
      throw new RestoreDormantError(
        "lock_busy",
        `kunde inte ta advisory-lock i prod (key=${key[0]},${key[1]}). ` +
          `En annan körning av restore-dormant-customer kör redan mot samma ` +
          `tenant=${tenant} och kund-ID:n. Vänta tills den är klar och prova igen.`,
        { key },
      );
    }
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
  const release = async (): Promise<void> => {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [key[0], key[1]]);
    } catch {
      // ignorera — sessionen stängs ändå nedan vilket släpper låset
    } finally {
      await client.end().catch(() => {});
    }
  };
  return { release, key };
}

async function writeAuditRow(args: {
  rows: PreflightRow[];
  customerIds: string[];
  tenant: string;
  activeSince: string;
  userId: string | null;
  actor: string | null;
  source: "cli" | "admin_ui";
}): Promise<void> {
  if (!process.env.PROD_DATABASE_URL) {
    throw new RestoreDormantError(
      "missing_prod_url",
      "PROD_DATABASE_URL saknas — kan inte skriva audit-rad i prod.",
    );
  }
  const prodPool = new Pool({
    connectionString: process.env.PROD_DATABASE_URL,
  });
  try {
    const metadata = {
      actor: args.actor,
      userId: args.userId,
      source: args.source,
      tenant: args.tenant,
      activeSince: args.activeSince,
      customers: args.rows.map((r) => ({
        id: r.id,
        name: r.name,
        wasActiveInDev: r.isActive,
        objectCount: r.objectCount,
      })),
      requestedIds: args.customerIds,
      script: "scripts/restore-dormant-customer.ts",
    };
    await prodPool.query(
      `INSERT INTO audit_logs
         (tenant_id, user_id, action, resource_type, resource_id, changes, metadata)
       VALUES ($1, $2, $3, 'customers', $4, $5::jsonb, $6::jsonb)`,
      [
        args.tenant,
        args.userId,
        "restore_dormant_customer",
        args.customerIds.join(","),
        JSON.stringify({ restoredCustomerIds: args.customerIds }),
        JSON.stringify(metadata),
      ],
    );
  } finally {
    await prodPool.end();
  }
}

/**
 * Full restore orchestration: preflight → spawn migrate → write audit (skarp körning).
 *
 * `opts.dryRun = true` → tvingar `--dry-run` mot migrate-skriptet och hoppar audit.
 * `opts.dryRun = false` → kräver att caller har satt `CONFIRM=YES_MIGRATE_PROD`
 *  (HTTP-endpointen sätter den explicit per körning, CLI förväntar att operatören gör det).
 */
export async function restoreDormantCustomers(
  opts: RestoreOptions,
  source: "cli" | "admin_ui",
): Promise<RestoreResult> {
  const tenant = opts.tenant || DEFAULT_TENANT;
  const activeSince = opts.activeSince || DEFAULT_ACTIVE_SINCE;
  if (opts.ids.length === 0) {
    throw new RestoreDormantError("empty_ids", "ids är tom.");
  }
  if (!process.env.PROD_DATABASE_URL) {
    throw new RestoreDormantError(
      "missing_prod_url",
      "PROD_DATABASE_URL saknas. Lägg in den som Secret innan körning.",
    );
  }
  if (process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
    throw new RestoreDormantError(
      "same_db",
      "DATABASE_URL och PROD_DATABASE_URL pekar på samma DB.",
    );
  }

  const preflight = await preflightDormancy(opts.ids, tenant, activeSince);
  const active = preflight.filter((r) => r.isActive);
  if (active.length > 0 && !opts.allowActive) {
    throw new RestoreDormantError(
      "customer_active",
      `${active.length} kund(er) är AKTIVA (work_order >= ${activeSince}) och hör inte hemma här. ` +
        `Sätt allowActive för att tvinga.`,
      { active: active.map((a) => ({ id: a.id, name: a.name })) },
    );
  }

  // Ta advisory-lock i prod runt hela körningen (migrate + audit). Två
  // parallella operatörer (CLI eller admin-UI) mot samma kund-ID:n ska fail:a
  // tydligt istället för att vänta och producera duplicerade audit-rader.
  const lock = await acquireProdAdvisoryLock(tenant, opts.ids);
  try {
    const { exitCode, log } = await runMigrateScript(
      opts.ids,
      tenant,
      activeSince,
      opts.dryRun,
    );
    if (exitCode !== 0) {
      return {
        preflight,
        migrateExitCode: exitCode,
        migrateLog: log,
        auditWritten: false,
        dryRun: opts.dryRun,
        lockKey: lock.key,
      };
    }

    let auditWritten = false;
    if (!opts.dryRun) {
      await writeAuditRow({
        rows: preflight,
        customerIds: opts.ids,
        tenant,
        activeSince,
        userId: opts.userId,
        actor: opts.actor,
        source,
      });
      auditWritten = true;
    }

    return {
      preflight,
      migrateExitCode: exitCode,
      migrateLog: log,
      auditWritten,
      dryRun: opts.dryRun,
      lockKey: lock.key,
    };
  } finally {
    await lock.release();
  }
}
