import { Pool } from "pg";
import * as schema from "../shared/schema";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getTableName, is } from "drizzle-orm";

// När `--warn` anges (eller SCHEMA_DRIFT_WARN_ONLY=true) loggas drift men exit-koden
// förblir 0 så att den inte blockerar. Utan flaggan ger drift (missing > 0) exit-kod 1
// så att den kan användas som blockerande validation-step / post-merge-gate.
const WARN_ONLY =
  process.argv.includes("--warn") ||
  process.env.SCHEMA_DRIFT_WARN_ONLY === "true";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[schema-drift] DATABASE_URL är inte satt — hoppar över drift-kontroll.",
    );
    process.exit(0);
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tables: PgTable[] = Object.values(schema).filter((v) =>
    is(v, PgTable),
  ) as PgTable[];

  const dbColsRes = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`,
  );
  const dbCols = new Map<string, Set<string>>();
  for (const r of dbColsRes.rows) {
    if (!dbCols.has(r.table_name)) dbCols.set(r.table_name, new Set());
    dbCols.get(r.table_name)!.add(r.column_name);
  }

  const dbIdxRes = await pool.query<{ indexname: string; tablename: string }>(
    `SELECT indexname, tablename FROM pg_indexes WHERE schemaname='public'`,
  );
  const dbIdx = new Set(dbIdxRes.rows.map((r) => r.indexname));
  const dbTablesSet = new Set(
    [...dbCols.keys()],
  );

  let missingColCount = 0;
  let missingIdxCount = 0;
  let missingTableCount = 0;

  for (const t of tables) {
    const cfg = getTableConfig(t);
    const tableName = cfg.name;
    const colsInDb = dbCols.get(tableName);
    if (!colsInDb) {
      console.log(`\n### MISSING TABLE: ${tableName}`);
      missingTableCount++;
      continue;
    }
    const missingCols: string[] = [];
    for (const col of cfg.columns) {
      if (!colsInDb.has(col.name)) {
        missingCols.push(`${col.name} (${col.getSQLType()}${col.notNull ? " NOT NULL" : ""}${col.hasDefault ? " has-default" : ""})`);
      }
    }
    if (missingCols.length) {
      console.log(`\n### TABLE ${tableName} — missing columns:`);
      for (const c of missingCols) console.log(`   - ${c}`);
      missingColCount += missingCols.length;
    }
    const missingIdx: string[] = [];
    for (const idx of cfg.indexes) {
      const name = idx.config.name;
      if (name && !dbIdx.has(name)) {
        const colNames = idx.config.columns
          .map((c: any) => c.name ?? "(expr)")
          .join(", ");
        missingIdx.push(`${name} [${colNames}]${idx.config.unique ? " UNIQUE" : ""}`);
      }
    }
    if (missingIdx.length) {
      console.log(`\n### TABLE ${tableName} — missing indexes:`);
      for (const i of missingIdx) console.log(`   - ${i}`);
      missingIdxCount += missingIdx.length;
    }
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Schema tables: ${tables.length}, DB public tables: ${dbTablesSet.size}`);
  console.log(`Missing tables: ${missingTableCount}`);
  console.log(`Missing columns: ${missingColCount}`);
  console.log(`Missing indexes: ${missingIdxCount}`);

  await pool.end();

  const totalMissing = missingTableCount + missingColCount + missingIdxCount;
  if (totalMissing > 0) {
    console.error(
      `\n[schema-drift] ⚠ Schema-drift upptäckt: ${totalMissing} saknade ` +
        `objekt (${missingTableCount} tabeller, ${missingColCount} kolumner, ` +
        `${missingIdxCount} index). DB är inte i synk med shared/schema.ts. ` +
        `Kör 'npm run db:push' och tillämpa relevanta migrations i scripts/post-merge.sh.`,
    );
    if (!WARN_ONLY) {
      process.exit(1);
    }
    console.error(
      "[schema-drift] (--warn) Drift ignoreras för exit-kod, men måste åtgärdas före merge.",
    );
  } else {
    console.log(
      "\n[schema-drift] ✓ Ingen drift — DB matchar shared/schema.ts.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
