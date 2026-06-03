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

// Infra-tabeller som hanteras utanför shared/schema.ts (migrations etc.) och
// därför inte ska flaggas som "extra" objekt i DB.
const IGNORED_DB_TABLES = new Set<string>([
  "__drizzle_migrations",
  "drizzle_migrations",
]);

// Normaliserar både Drizzles getSQLType() och information_schema.data_type till
// en gemensam kanonisk token så att uppenbara mismatchar kan jämföras.
// Returnerar null för typer som inte säkert kan jämföras (arrays, enums/
// USER-DEFINED, okända typer) — dessa hoppas över för att undvika false positives.
function canonicalizeType(raw: string): string | null {
  let t = raw.trim().toLowerCase();
  // Arrays kan inte jämföras tillförlitligt (element-typ vs "ARRAY").
  if (t === "array" || t.endsWith("[]")) return null;
  // Enums (Drizzle returnerar enum-namnet, DB returnerar "USER-DEFINED").
  if (t === "user-defined") return null;
  // Strippa längd/precision, t.ex. varchar(255) -> varchar, numeric(10, 2) -> numeric.
  t = t.replace(/\(.*\)/, "").trim();
  const map: Record<string, string> = {
    // heltal
    integer: "int",
    int: "int",
    int4: "int",
    serial: "int",
    serial4: "int",
    bigint: "bigint",
    int8: "bigint",
    bigserial: "bigint",
    serial8: "bigint",
    smallint: "smallint",
    int2: "smallint",
    smallserial: "smallint",
    serial2: "smallint",
    // flyttal / decimal
    numeric: "numeric",
    decimal: "numeric",
    "double precision": "double",
    float8: "double",
    real: "real",
    float4: "real",
    // text
    text: "text",
    varchar: "varchar",
    "character varying": "varchar",
    char: "char",
    character: "char",
    bpchar: "char",
    // övrigt
    boolean: "bool",
    bool: "bool",
    json: "json",
    jsonb: "jsonb",
    uuid: "uuid",
    date: "date",
    timestamp: "timestamp",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamptz",
    timestamptz: "timestamptz",
    time: "time",
    "time without time zone": "time",
    "time with time zone": "timetz",
    timetz: "timetz",
  };
  return map[t] ?? null;
}

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
    data_type: string;
  }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'`,
  );
  // table -> column -> data_type
  const dbCols = new Map<string, Set<string>>();
  const dbColTypes = new Map<string, Map<string, string>>();
  for (const r of dbColsRes.rows) {
    if (!dbCols.has(r.table_name)) {
      dbCols.set(r.table_name, new Set());
      dbColTypes.set(r.table_name, new Map());
    }
    dbCols.get(r.table_name)!.add(r.column_name);
    dbColTypes.get(r.table_name)!.set(r.column_name, r.data_type);
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
  let extraColCount = 0;
  let typeMismatchCount = 0;

  // Tabeller som koden känner till -> set av kolumner koden definierar
  // (används för att hitta "extra" kolumner i DB som saknas i schema.ts).
  const schemaTableCols = new Map<string, Set<string>>();

  for (const t of tables) {
    const cfg = getTableConfig(t);
    const tableName = cfg.name;
    const colsInDb = dbCols.get(tableName);
    const typesInDb = dbColTypes.get(tableName);
    const schemaCols = new Set<string>(cfg.columns.map((c) => c.name));
    schemaTableCols.set(tableName, schemaCols);
    if (!colsInDb) {
      console.log(`\n### MISSING TABLE: ${tableName}`);
      missingTableCount++;
      continue;
    }
    const missingCols: string[] = [];
    const typeMismatches: string[] = [];
    for (const col of cfg.columns) {
      if (!colsInDb.has(col.name)) {
        missingCols.push(`${col.name} (${col.getSQLType()}${col.notNull ? " NOT NULL" : ""}${col.hasDefault ? " has-default" : ""})`);
        continue;
      }
      // Typjämförelse för kolumner som finns på båda sidor.
      const dbType = typesInDb?.get(col.name);
      if (dbType) {
        const codeCanon = canonicalizeType(col.getSQLType());
        const dbCanon = canonicalizeType(dbType);
        // Hoppa över om någon sida inte säkert kan jämföras (array/enum/okänd).
        if (codeCanon && dbCanon && codeCanon !== dbCanon) {
          typeMismatches.push(
            `${col.name}: kod=${col.getSQLType()} (${codeCanon}) vs DB=${dbType} (${dbCanon})`,
          );
        }
      }
    }
    if (missingCols.length) {
      console.log(`\n### TABLE ${tableName} — missing columns:`);
      for (const c of missingCols) console.log(`   - ${c}`);
      missingColCount += missingCols.length;
    }
    if (typeMismatches.length) {
      console.log(`\n### TABLE ${tableName} — TYPE MISMATCH (informativt):`);
      for (const m of typeMismatches) console.log(`   - ${m}`);
      typeMismatchCount += typeMismatches.length;
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

  // --- Omvänd drift (informativt): objekt som finns i DB men inte i schema.ts ---
  const schemaTableNames = new Set(schemaTableCols.keys());
  const extraTables: string[] = [];
  for (const dbTable of dbCols.keys()) {
    if (schemaTableNames.has(dbTable)) continue;
    if (IGNORED_DB_TABLES.has(dbTable)) continue;
    extraTables.push(dbTable);
  }

  // Extra kolumner per känd tabell (tabeller som finns i schema.ts).
  const extraColsByTable = new Map<string, string[]>();
  for (const [tableName, schemaCols] of schemaTableCols) {
    const colsInDb = dbCols.get(tableName);
    const typesInDb = dbColTypes.get(tableName);
    if (!colsInDb) continue;
    const extras: string[] = [];
    for (const dbCol of colsInDb) {
      if (!schemaCols.has(dbCol)) {
        const dt = typesInDb?.get(dbCol);
        extras.push(`${dbCol}${dt ? ` (${dt})` : ""}`);
      }
    }
    if (extras.length) {
      extraColsByTable.set(tableName, extras);
      extraColCount += extras.length;
    }
  }

  if (extraTables.length || extraColCount > 0) {
    console.log(
      `\n\n=== OMVÄND DRIFT (informativt — finns i DB men inte i shared/schema.ts) ===`,
    );
    if (extraTables.length) {
      console.log(`\n### EXTRA TABLES i DB (${extraTables.length}):`);
      for (const tname of extraTables.sort()) console.log(`   - ${tname}`);
    }
    for (const [tableName, extras] of extraColsByTable) {
      console.log(`\n### TABLE ${tableName} — extra columns i DB:`);
      for (const c of extras) console.log(`   - ${c}`);
    }
    console.log(
      `\n[schema-drift] ℹ Omvänd drift är informativ och blockerar inte. ` +
        `Övergivna kolumner/tabeller bör städas med en migration när de är ` +
        `bekräftat oanvända.`,
    );
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Schema tables: ${tables.length}, DB public tables: ${dbTablesSet.size}`);
  console.log(`Missing tables: ${missingTableCount}`);
  console.log(`Missing columns: ${missingColCount}`);
  console.log(`Missing indexes: ${missingIdxCount}`);
  console.log(`--- informativt (blockerar ej) ---`);
  console.log(`Extra tables i DB: ${extraTables.length}`);
  console.log(`Extra columns i DB: ${extraColCount}`);
  console.log(`Type mismatches: ${typeMismatchCount}`);

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
