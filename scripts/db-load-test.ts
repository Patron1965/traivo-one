/**
 * Traivo Databasstruktur — Skala-/lasttest (Å7)
 * ------------------------------------------------
 * Seedar ~100k syntetiska objekt + metadatavärden i EN transaktion, kör
 * EXPLAIN ANALYZE på nyckelqueries (geo-bbox, parent-traversal, tenant+status,
 * metadata-join) och ROLLBACK:ar ALLTID — ingen riktig data ändras.
 *
 * Syftet är att verifiera att indexen från migration 0082 (tenant_id-täckning +
 * idx_objects_tenant_lat_lng) faktiskt används vid realistisk datavolym, och att
 * ge en grov tidsbild av bulk-skrivning.
 *
 * Kör:  npx tsx scripts/db-load-test.ts
 * Volym: LOAD_TEST_OBJECTS=100000 (default). Sätt lägre för snabb rökning.
 */
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL saknas");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const N = parseInt(process.env.LOAD_TEST_OBJECTS ?? "100000", 10);

function planUsesIndex(plan: string): boolean {
  return /Index (Only )?Scan|Bitmap Index Scan/.test(plan);
}

async function explain(
  client: import("pg").PoolClient,
  label: string,
  sql: string,
  params: any[],
): Promise<void> {
  const r = await client.query(sql, params);
  const plan = r.rows.map((row) => row["QUERY PLAN"]).join("\n");
  const usesIdx = planUsesIndex(plan);
  const seq = /Seq Scan on objects/.test(plan);
  console.log(`\n── ${label} ──`);
  console.log(plan);
  console.log(`   → ${usesIdx ? "✅ använder index" : "⚠️  inget index-scan i planen"}${seq ? " (innehåller Seq Scan på objects)" : ""}`);
}

async function main() {
  const client = await pool.connect();
  let seeded = false;
  try {
    const t = await client.query<{ tenant_id: string; customer_id: string }>(
      `SELECT c.tenant_id, c.id AS customer_id FROM customers c LIMIT 1`,
    );
    if (t.rows.length === 0) {
      throw new Error("Ingen kund/tenant i DB att testa mot — seeda demo-data först");
    }
    const { tenant_id, customer_id } = t.rows[0];
    console.log(`[load-test] tenant=${tenant_id.slice(0, 8)}… customer=${customer_id.slice(0, 8)}… seedar ${N} objekt i transaktion (ROLLBACK efteråt)`);

    await client.query("BEGIN");
    seeded = true;

    // 1. Bulk-insert objekt — sprid lat/lng över en grov Sverige-bbox.
    const tObj = Date.now();
    await client.query(
      `INSERT INTO objects (tenant_id, customer_id, name, object_type, object_level, latitude, longitude, status)
       SELECT $1::varchar, $2::varchar, 'LoadTest ' || g, 'omrade', 1,
              55 + random() * 14, 11 + random() * 13, 'active'
       FROM generate_series(1, $3::int) g`,
      [tenant_id, customer_id, N],
    );
    const seedObjMs = Date.now() - tObj;

    // 2. Metadata-katalog-rad + ett metadatavärde per seedat objekt.
    const kat = await client.query<{ id: string }>(
      `INSERT INTO metadata_katalog
         (tenant_id, namn, datatyp, ar_logisk, standard_arvs, is_system, is_required, allow_duplicates, kronologisk_visning, ar_beraknad)
       VALUES ($1, 'LoadTestAntal', 'integer', false, false, false, false, true, false, false)
       RETURNING id`,
      [tenant_id],
    );
    const katId = kat.rows[0].id;

    const tMeta = Date.now();
    await client.query(
      `INSERT INTO metadata_varden (tenant_id, objekt_id, metadata_katalog_id, varde_integer)
       SELECT $1::varchar, o.id, $2::varchar, (random() * 10)::int
       FROM objects o
       WHERE o.tenant_id = $1::varchar AND o.name LIKE 'LoadTest %'`,
      [tenant_id, katId],
    );
    const seedMetaMs = Date.now() - tMeta;

    // 3. Uppdatera planner-statistik (rullas tillbaka med transaktionen).
    await client.query("ANALYZE objects");
    await client.query("ANALYZE metadata_varden");

    const counts = await client.query<{ o: string; m: string }>(
      `SELECT (SELECT count(*) FROM objects WHERE tenant_id=$1 AND name LIKE 'LoadTest %')::text o,
              (SELECT count(*) FROM metadata_varden WHERE tenant_id=$1 AND metadata_katalog_id=$2)::text m`,
      [tenant_id, katId],
    );
    console.log(`[load-test] seedat: objekt=${counts.rows[0].o} (${seedObjMs}ms), metadata=${counts.rows[0].m} (${seedMetaMs}ms)`);

    const sample = await client.query<{ id: string }>(
      `SELECT id FROM objects WHERE tenant_id=$1 AND name LIKE 'LoadTest %' LIMIT 1`,
      [tenant_id],
    );
    const sampleId = sample.rows[0].id;

    // 4. EXPLAIN ANALYZE på nyckelqueries.
    await explain(client, "Geo-bbox inom tenant (idx_objects_tenant_lat_lng)",
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM objects
       WHERE tenant_id=$1 AND latitude BETWEEN 59 AND 60 AND longitude BETWEEN 17 AND 18 AND deleted_at IS NULL`,
      [tenant_id]);

    await explain(client, "Parent-traversal (idx på parent_id)",
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM objects WHERE parent_id=$1`,
      [sampleId]);

    await explain(client, "Tenant + status count",
      `EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM objects WHERE tenant_id=$1 AND status='active'`,
      [tenant_id]);

    await explain(client, "Metadata-join per objekt",
      `EXPLAIN (ANALYZE, BUFFERS) SELECT o.id FROM objects o
       JOIN metadata_varden mv ON mv.objekt_id=o.id
       WHERE o.tenant_id=$1 AND mv.metadata_katalog_id=$2 LIMIT 100`,
      [tenant_id, katId]);
  } finally {
    if (seeded) {
      await client.query("ROLLBACK");
      const check = await client.query<{ c: string }>(
        `SELECT count(*)::text c FROM objects WHERE name LIKE 'LoadTest %'`,
      );
      console.log(`\n[load-test] ROLLBACK klar — kvarvarande LoadTest-objekt: ${check.rows[0].c} (ska vara 0)`);
    }
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[load-test] FEL:", e);
  process.exit(1);
});
