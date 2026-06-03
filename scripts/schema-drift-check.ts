import { Pool } from "pg";
import * as schema from "../shared/schema";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getTableName, is } from "drizzle-orm";

async function main() {
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
