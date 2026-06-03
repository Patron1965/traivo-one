import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import {
  runSchemaDriftCheck,
  evaluateDrift,
  isWarnOnly,
  collectSchemaTables,
  type DriftQuerier,
} from "../../scripts/schema-drift-check";
import { objects } from "../../shared/schema";

// Bygg en fake-databas (kolumn- + index-rader) som EXAKT speglar en uppsättning
// Drizzle-tabeller. Då blir utgångsläget garanterat "ingen drift" oavsett hur
// schemat ändras över tid — varje drift-scenario muteras sedan fram från detta.
function buildDbStateFromTables(tables: PgTable[]) {
  const colRows: { table_name: string; column_name: string }[] = [];
  const idxRows: { indexname: string; tablename: string }[] = [];
  for (const t of tables) {
    const cfg = getTableConfig(t);
    for (const col of cfg.columns) {
      colRows.push({ table_name: cfg.name, column_name: col.name });
    }
    for (const idx of cfg.indexes) {
      const name = idx.config.name;
      if (name) idxRows.push({ indexname: name, tablename: cfg.name });
    }
  }
  return { colRows, idxRows };
}

// Fake-querier som svarar på de två SQL-frågorna scriptet ställer
// (information_schema.columns respektive pg_indexes).
function makeQuerier(state: {
  colRows: { table_name: string; column_name: string }[];
  idxRows: { indexname: string; tablename: string }[];
}): DriftQuerier & { ended: boolean } {
  const querier = {
    ended: false,
    async query<T extends Record<string, unknown>>(sql: string) {
      if (sql.includes("information_schema.columns")) {
        return { rows: state.colRows as unknown as T[] };
      }
      if (sql.includes("pg_indexes")) {
        return { rows: state.idxRows as unknown as T[] };
      }
      throw new Error(`Oväntad query i test: ${sql}`);
    },
    async end() {
      this.ended = true;
    },
  };
  return querier;
}

// En riktig tabell ur schemat som har minst ett index — så index-scenariot blir relevant.
const TEST_TABLES: PgTable[] = [objects];

describe("schema-drift-check", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  describe("isWarnOnly", () => {
    it("är false utan flagga/env", () => {
      expect(isWarnOnly([], {})).toBe(false);
    });
    it("är true med --warn", () => {
      expect(isWarnOnly(["node", "script", "--warn"], {})).toBe(true);
    });
    it("är true med SCHEMA_DRIFT_WARN_ONLY=true", () => {
      expect(isWarnOnly([], { SCHEMA_DRIFT_WARN_ONLY: "true" } as any)).toBe(
        true,
      );
    });
    it("är false med SCHEMA_DRIFT_WARN_ONLY=false", () => {
      expect(isWarnOnly([], { SCHEMA_DRIFT_WARN_ONLY: "false" } as any)).toBe(
        false,
      );
    });
  });

  describe("collectSchemaTables", () => {
    it("hittar tabeller i schemat (inkl. den testade)", () => {
      const tables = collectSchemaTables();
      expect(tables.length).toBeGreaterThan(0);
      const names = tables.map((t) => getTableConfig(t).name);
      expect(names).toContain(getTableConfig(objects).name);
    });
  });

  describe("evaluateDrift", () => {
    it("rapporterar 0 saknade när DB matchar schemat", () => {
      const { colRows, idxRows } = buildDbStateFromTables(TEST_TABLES);
      const dbCols = new Map<string, Set<string>>();
      for (const r of colRows) {
        if (!dbCols.has(r.table_name)) dbCols.set(r.table_name, new Set());
        dbCols.get(r.table_name)!.add(r.column_name);
      }
      const dbIdx = new Set(idxRows.map((r) => r.indexname));
      const counts = evaluateDrift(TEST_TABLES, dbCols, dbIdx);
      expect(counts).toEqual({
        missingTableCount: 0,
        missingColCount: 0,
        missingIdxCount: 0,
        extraTableCount: 0,
        extraColCount: 0,
        typeMismatchCount: 0,
      });
    });
  });

  describe("runSchemaDriftCheck — exit-koder", () => {
    it("returnerar 0 när DB är i synk med schemat", async () => {
      const state = buildDbStateFromTables(TEST_TABLES);
      const querier = makeQuerier(state);
      const code = await runSchemaDriftCheck({
        databaseUrl: "postgres://fake",
        warnOnly: false,
        tables: TEST_TABLES,
        createQuerier: () => querier,
      });
      expect(code).toBe(0);
      expect(querier.ended).toBe(true);
    });

    it("returnerar 1 vid saknad kolumn", async () => {
      const state = buildDbStateFromTables(TEST_TABLES);
      // Ta bort en kolumn från DB-state → simulerad drift.
      state.colRows.pop();
      const code = await runSchemaDriftCheck({
        databaseUrl: "postgres://fake",
        warnOnly: false,
        tables: TEST_TABLES,
        createQuerier: () => makeQuerier(state),
      });
      expect(code).toBe(1);
    });

    it("returnerar 1 vid saknad tabell", async () => {
      // Tom DB-state → hela tabellen saknas.
      const code = await runSchemaDriftCheck({
        databaseUrl: "postgres://fake",
        warnOnly: false,
        tables: TEST_TABLES,
        createQuerier: () => makeQuerier({ colRows: [], idxRows: [] }),
      });
      expect(code).toBe(1);
    });

    it("returnerar 1 vid saknat index", async () => {
      const state = buildDbStateFromTables(TEST_TABLES);
      expect(state.idxRows.length).toBeGreaterThan(0);
      // Behåll alla kolumner men ta bort alla index → index-drift.
      state.idxRows = [];
      const code = await runSchemaDriftCheck({
        databaseUrl: "postgres://fake",
        warnOnly: false,
        tables: TEST_TABLES,
        createQuerier: () => makeQuerier(state),
      });
      expect(code).toBe(1);
    });
  });

  describe("runSchemaDriftCheck — warn-only behåller exit 0", () => {
    it("returnerar 0 trots drift när warnOnly=true", async () => {
      const state = buildDbStateFromTables(TEST_TABLES);
      state.colRows.pop(); // skapa drift
      const code = await runSchemaDriftCheck({
        databaseUrl: "postgres://fake",
        warnOnly: true,
        tables: TEST_TABLES,
        createQuerier: () => makeQuerier(state),
      });
      expect(code).toBe(0);
    });
  });

  describe("runSchemaDriftCheck — saknad DATABASE_URL", () => {
    const prevUrl = process.env.DATABASE_URL;
    afterEach(() => {
      if (prevUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevUrl;
    });

    it("hoppar över och returnerar 0 utan att krascha eller fråga DB", async () => {
      delete process.env.DATABASE_URL;
      const createQuerier = vi.fn();
      const code = await runSchemaDriftCheck({
        warnOnly: false,
        tables: TEST_TABLES,
        createQuerier,
      });
      expect(code).toBe(0);
      expect(createQuerier).not.toHaveBeenCalled();
    });
  });
});
