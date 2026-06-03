import { Pool } from "pg";
import * as schema from "../shared/schema";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";

// När `--warn` anges (eller SCHEMA_DRIFT_WARN_ONLY=true) loggas drift men exit-koden
// förblir 0 så att den inte blockerar. Utan flaggan ger drift (missing > 0) exit-kod 1
// så att den kan användas som blockerande validation-step / post-merge-gate.
export function isWarnOnly(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return argv.includes("--warn") || env.SCHEMA_DRIFT_WARN_ONLY === "true";
}

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
export function canonicalizeType(raw: string): string | null {
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

// Minimal query-interface så att kontrollen kan köras mot en injicerad databas
// (riktig pg.Pool i prod/post-merge, en fake i tester).
export interface DriftQuerier {
  query<T extends Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: T[] }>;
  end?: () => Promise<void>;
}

export interface DriftCounts {
  // Blockerande (saknas i DB jämfört med schema.ts).
  missingTableCount: number;
  missingColCount: number;
  missingIdxCount: number;
  // Informativt (blockerar ej): finns i DB men inte i schema.ts, samt typavvikelser.
  extraTableCount: number;
  extraColCount: number;
  typeMismatchCount: number;
}

export function collectSchemaTables(): PgTable[] {
  return Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
}

/**
 * Jämför Drizzle-schemat mot databasens faktiska kolumner/index och loggar drift.
 * Returnerar antal saknade tabeller/kolumner/index (blockerande) samt informativa
 * räknare för omvänd drift (extra objekt i DB) och typavvikelser. Ingen process.exit
 * här — det sköts av anroparen baserat på counts + warn-only.
 *
 * `dbColTypes` (table -> column -> data_type) är valfri; utan den hoppas typjämförelser
 * över (t.ex. i tester som inte simulerar data_type).
 */
export function evaluateDrift(
  tables: PgTable[],
  dbCols: Map<string, Set<string>>,
  dbIdx: Set<string>,
  dbColTypes?: Map<string, Map<string, string>>,
): DriftCounts {
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
    const typesInDb = dbColTypes?.get(tableName);
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
        missingCols.push(
          `${col.name} (${col.getSQLType()}${col.notNull ? " NOT NULL" : ""}${col.hasDefault ? " has-default" : ""})`,
        );
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
        missingIdx.push(
          `${name} [${colNames}]${idx.config.unique ? " UNIQUE" : ""}`,
        );
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
    const typesInDb = dbColTypes?.get(tableName);
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

  return {
    missingTableCount,
    missingColCount,
    missingIdxCount,
    extraTableCount: extraTables.length,
    extraColCount,
    typeMismatchCount,
  };
}

/**
 * Kör hela drift-kontrollen och returnerar en exit-kod (0 = ok/skip, 1 = drift).
 * Ingen process.exit — så den kan köras i tester. CLI-wrappern nedan applicerar koden.
 */
export async function runSchemaDriftCheck(opts?: {
  databaseUrl?: string;
  warnOnly?: boolean;
  tables?: PgTable[];
  createQuerier?: (databaseUrl: string) => DriftQuerier;
}): Promise<number> {
  const databaseUrl =
    opts?.databaseUrl ?? process.env.DATABASE_URL ?? undefined;
  const warnOnly = opts?.warnOnly ?? isWarnOnly();

  if (!databaseUrl) {
    console.error(
      "[schema-drift] DATABASE_URL är inte satt — hoppar över drift-kontroll.",
    );
    return 0;
  }

  const createQuerier =
    opts?.createQuerier ??
    ((url: string) => new Pool({ connectionString: url }) as DriftQuerier);
  const pool = createQuerier(databaseUrl);

  const tables = opts?.tables ?? collectSchemaTables();

  try {
    const dbColsRes = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'`,
    );
    // table -> column-set, samt table -> column -> data_type
    const dbCols = new Map<string, Set<string>>();
    const dbColTypes = new Map<string, Map<string, string>>();
    for (const r of dbColsRes.rows) {
      if (!dbCols.has(r.table_name)) {
        dbCols.set(r.table_name, new Set());
        dbColTypes.set(r.table_name, new Map());
      }
      dbCols.get(r.table_name)!.add(r.column_name);
      if (r.data_type !== undefined && r.data_type !== null) {
        dbColTypes.get(r.table_name)!.set(r.column_name, r.data_type);
      }
    }

    const dbIdxRes = await pool.query<{
      indexname: string;
      tablename: string;
    }>(`SELECT indexname, tablename FROM pg_indexes WHERE schemaname='public'`);
    const dbIdx = new Set(dbIdxRes.rows.map((r) => r.indexname));
    const dbTablesSet = new Set([...dbCols.keys()]);

    const {
      missingTableCount,
      missingColCount,
      missingIdxCount,
      extraTableCount,
      extraColCount,
      typeMismatchCount,
    } = evaluateDrift(tables, dbCols, dbIdx, dbColTypes);

    console.log(`\n\n=== SUMMARY ===`);
    console.log(
      `Schema tables: ${tables.length}, DB public tables: ${dbTablesSet.size}`,
    );
    console.log(`Missing tables: ${missingTableCount}`);
    console.log(`Missing columns: ${missingColCount}`);
    console.log(`Missing indexes: ${missingIdxCount}`);
    console.log(`--- informativt (blockerar ej) ---`);
    console.log(`Extra tables i DB: ${extraTableCount}`);
    console.log(`Extra columns i DB: ${extraColCount}`);
    console.log(`Type mismatches: ${typeMismatchCount}`);

    const totalMissing = missingTableCount + missingColCount + missingIdxCount;
    if (totalMissing > 0) {
      console.error(
        `\n[schema-drift] ⚠ Schema-drift upptäckt: ${totalMissing} saknade ` +
          `objekt (${missingTableCount} tabeller, ${missingColCount} kolumner, ` +
          `${missingIdxCount} index). DB är inte i synk med shared/schema.ts. ` +
          `Kör 'npm run db:push' och tillämpa relevanta migrations i scripts/post-merge.sh.`,
      );
      if (!warnOnly) {
        return 1;
      }
      console.error(
        "[schema-drift] (--warn) Drift ignoreras för exit-kod, men måste åtgärdas före merge.",
      );
    } else {
      console.log(
        "\n[schema-drift] ✓ Ingen drift — DB matchar shared/schema.ts.",
      );
    }
    return 0;
  } finally {
    if (pool.end) await pool.end();
  }
}

// Kör endast som CLI när filen exekveras direkt (inte vid import i tester).
const isDirectRun =
  typeof process.argv[1] === "string" &&
  /schema-drift-check\.(ts|js|cjs|mjs)$/.test(process.argv[1]);

if (isDirectRun) {
  runSchemaDriftCheck()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
