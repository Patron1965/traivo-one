#!/usr/bin/env tsx
/**
 * scripts/backfill-kinab-import-metadata.ts  (Task #1479)
 *
 * Backfillar Kinabs redan tappade import-metadata i PROD från de raw_rows som
 * redan ligger sparade i object_import_sessions — ingen ny fil behövs.
 *
 * Vad som backfillas (matchning via interimsnummer-metadata, kundskopat data
 * under cust-telge; skrivning hoppar alltid över objekt som redan har ett
 * AKTIVT värde för fältet → idempotent, inga dubbletter):
 *
 *  1. Typ        ← kolumnen "Objekt typ" i 892-radsfilen (session MAIN).
 *                  Skrevs aldrig: katalogfältets allowed_values saknade filens
 *                  värden (Butik/Pantkärl/Matavfallskärl/... ) och batch-
 *                  skrivaren hoppar ogiltiga värden tyst. allowed_values
 *                  utökas (union) innan skrivning.
 *  2. Område     ← kolumnen "Region" (butik-rader). Mappades till fel fält
 *                  ("Avdelning/Port/Våning") vid importen; de värdena lämnas
 *                  orörda (icke-destruktivt). Område ärver nedåt
 *                  (standard_arvs=true → arvs_nedat=true).
 *  3. Butiksnummer ← kolumnen "Nr" i "Butik"-filen (session BUTIK, aldrig
 *                  exekverad). Radordningen är verifierat 1:1 med butik-
 *                  raderna i MAIN (namn efter brand-normalisering + region
 *                  matchar 220/220); varje par korsverifieras igen här och
 *                  rader som inte matchar hoppas över med varning.
 *
 * SÄKERHET (samma mönster som kinab-reset-prod-operational-data.ts):
 *   - PROD_DATABASE_URL krävs; vägrar om DATABASE_URL === PROD_DATABASE_URL.
 *   - Allt i EN transaktion. Dry-run (ROLLBACK) är default.
 *   - Skarp körning kräver dubbel bekräftelse:
 *       env  CONFIRM=YES_BACKFILL_PROD
 *       flag --confirm BACKFILL-KINAB-METADATA
 *
 * ANVÄNDNING
 *   npx tsx scripts/backfill-kinab-import-metadata.ts                 # dry-run
 *   CONFIRM=YES_BACKFILL_PROD npx tsx scripts/backfill-kinab-import-metadata.ts \
 *     --confirm BACKFILL-KINAB-METADATA                               # skarp
 */

import pg from "pg";

const { Pool } = pg;

const TENANT = "kinab";
// Senast slutförda 892-radsimporten ("Andraimport objekt Tredo aug.xlsx", 2026-08-10).
const MAIN_SESSION = "80eb7daa-ba6d-4a1a-a8bc-acb6f8e6c7d1";
// Butik-filen (19 kolumner, aldrig exekverad) — senaste uppladdningen med 220 rader.
const BUTIK_SESSION = "4f01b057-e961-4dee-838c-097993f7bec8";
const ACTOR = "backfill-task-1479";
const BATCH_ID = `kinab-metadata-backfill-${Date.now()}`;

const args = process.argv.slice(2);
const confirmIdx = args.indexOf("--confirm");
const CONFIRM =
  process.env.CONFIRM === "YES_BACKFILL_PROD" &&
  (confirmIdx >= 0 ? args[confirmIdx + 1] : null) === "BACKFILL-KINAB-METADATA";
const DRY_RUN = !CONFIRM;

if (!process.env.PROD_DATABASE_URL) {
  console.error("FEL: PROD_DATABASE_URL saknas.");
  process.exit(1);
}
if (process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  console.error("FEL: DATABASE_URL och PROD_DATABASE_URL pekar på samma DB. Avbryter.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });
// En tappad idle-anslutning får inte krascha processen (pg-pool-error-listener).
pool.on("error", (err) => console.error("[pool error]", err.message));

type RawRow = Record<string, string>;
const trim = (v: unknown) => String(v ?? "").trim();
// Butik-filen är anonymiserad med annat varumärke än objektsfilen.
const normName = (s: string) => s.toLowerCase().replace(/tredo butik/g, "hemköp").replace(/\s+/g, " ").trim();

async function main() {
  const client = await pool.connect();
  const warnings: string[] = [];
  try {
    await client.query("BEGIN");

    // ── Källdata: raw_rows från de sparade importsessionerna ────────────────
    const loadRows = async (id: string): Promise<RawRow[]> => {
      const r = await client.query(
        `SELECT raw_rows FROM object_import_sessions WHERE id=$1 AND tenant_id=$2`,
        [id, TENANT],
      );
      if (!r.rows[0]) throw new Error(`Session ${id} saknas i prod`);
      return r.rows[0].raw_rows as RawRow[];
    };
    const mainRows = await loadRows(MAIN_SESSION);
    const butikRows = await loadRows(BUTIK_SESSION);
    console.log(`MAIN-session: ${mainRows.length} rader, BUTIK-session: ${butikRows.length} rader`);

    // ── Katalogfält (aktiva rader) ──────────────────────────────────────────
    const katalogRes = await client.query(
      `SELECT id, namn, datatyp, standard_arvs, allowed_values FROM metadata_katalog
       WHERE tenant_id=$1 AND deleted_at IS NULL AND namn = ANY($2::text[])`,
      [TENANT, ["Typ", "Område", "Butiksnummer", "interimsnummer"]],
    );
    const katalog = new Map<string, { id: string; datatyp: string; standardArvs: boolean; allowedValues: string[] | null }>();
    for (const k of katalogRes.rows) {
      if (katalog.has(k.namn)) throw new Error(`Flera aktiva katalograder för "${k.namn}" — avbryter`);
      katalog.set(k.namn, { id: k.id, datatyp: k.datatyp, standardArvs: k.standard_arvs, allowedValues: k.allowed_values });
    }
    for (const namn of ["Typ", "Område", "Butiksnummer", "interimsnummer"]) {
      if (!katalog.has(namn)) throw new Error(`Katalogfältet "${namn}" saknas aktivt i prod`);
    }
    // Typkontrakt: skrivhjälpen nedan skriver ENBART varde_string. Alla tre
    // målfält är verifierat datatyp='string' i prod — men vakta hårt så att en
    // framtida datatyp-ändring aldrig kan ge en "aktiv" rad med null i den
    // typade kolumnen (integer/decimal/boolean kräver importerarens coercion).
    for (const namn of ["Typ", "Område", "Butiksnummer"]) {
      const dt = katalog.get(namn)!.datatyp;
      if (dt !== "string") {
        throw new Error(`Katalogfältet "${namn}" har datatyp="${dt}" — skriptet stödjer bara string. Avbryter.`);
      }
    }

    // ── interim → objekt-id (endast aktiva värden på icke-raderade objekt) ──
    const interimRes = await client.query(
      `SELECT mv.varde_string AS interim, mv.objekt_id
       FROM metadata_varden mv
       JOIN objects o ON o.id = mv.objekt_id AND o.tenant_id = mv.tenant_id
       WHERE mv.tenant_id=$1 AND mv.metadata_katalog_id=$2
         AND mv.status='aktiv' AND COALESCE(mv.raderad,false)=false
         AND o.deleted_at IS NULL`,
      [TENANT, katalog.get("interimsnummer")!.id],
    );
    const interimToObj = new Map<string, string>();
    for (const r of interimRes.rows) {
      const key = trim(r.interim);
      if (!key) continue;
      if (interimToObj.has(key) && interimToObj.get(key) !== r.objekt_id) {
        throw new Error(`Interim "${key}" pekar på flera objekt — avbryter (dubblettrisk)`);
      }
      interimToObj.set(key, r.objekt_id);
    }
    console.log(`Interim-map: ${interimToObj.size} interimsnummer`);

    // ── Befintliga aktiva värden per fält (skip-set → idempotens) ───────────
    const existingFor = async (katalogId: string): Promise<Set<string>> => {
      const r = await client.query(
        `SELECT objekt_id FROM metadata_varden
         WHERE tenant_id=$1 AND metadata_katalog_id=$2 AND status='aktiv' AND COALESCE(raderad,false)=false`,
        [TENANT, katalogId],
      );
      return new Set(r.rows.map((x: any) => x.objekt_id));
    };

    // ── Skrivhjälp: metadata_varden + metadata_historik (speglar importens rad)
    const insertValue = async (objektId: string, katalogId: string, arvsNedat: boolean, value: string) => {
      const ins = await client.query(
        `INSERT INTO metadata_varden
           (tenant_id, objekt_id, metadata_katalog_id, varde_string, arvs_nedat, niva_las, skapad_av, metod)
         VALUES ($1,$2,$3,$4,$5,false,$6,'import') RETURNING id`,
        [TENANT, objektId, katalogId, value, arvsNedat, ACTOR],
      );
      await client.query(
        `INSERT INTO metadata_historik
           (tenant_id, metadata_varden_id, objekt_id, metadata_katalog_id, gammalt_varde, nytt_varde, andrad_av, andrings_metod, import_batch_id)
         VALUES ($1,$2,$3,$4,NULL,$5,$6,'import',$7)`,
        [TENANT, ins.rows[0].id, objektId, katalogId, value, ACTOR, BATCH_ID],
      );
    };

    // ════ 1) Typ ← MAIN kolumn 13 ("Objekt typ") ════
    const typ = katalog.get("Typ")!;
    const typValues = new Set<string>();
    for (const r of mainRows) if (trim(r["13"])) typValues.add(trim(r["13"]));
    const newAllowed = Array.from(
      new Set([...(typ.allowedValues ?? []), ...Array.from(typValues)]),
    );
    const addedAllowed = newAllowed.filter((v) => !(typ.allowedValues ?? []).includes(v));
    if (addedAllowed.length) {
      await client.query(`UPDATE metadata_katalog SET allowed_values=$1 WHERE id=$2 AND tenant_id=$3`, [
        newAllowed,
        typ.id,
        TENANT,
      ]);
      console.log(`Typ.allowed_values utökad med: ${addedAllowed.join(", ")}`);
    }
    let typWritten = 0, typSkippedExisting = 0, typNoObject = 0;
    {
      const existing = await existingFor(typ.id);
      for (const r of mainRows) {
        const value = trim(r["13"]);
        const interim = trim(r["1"]);
        if (!value || !interim) continue;
        const objektId = interimToObj.get(interim);
        if (!objektId) { typNoObject++; warnings.push(`Typ: interim "${interim}" saknar objekt`); continue; }
        if (existing.has(objektId)) { typSkippedExisting++; continue; }
        await insertValue(objektId, typ.id, typ.standardArvs, value);
        existing.add(objektId);
        typWritten++;
      }
    }
    console.log(`Typ: ${typWritten} skrivna, ${typSkippedExisting} hade redan värde, ${typNoObject} utan objekt`);

    // ════ 2) Område ← MAIN kolumn 6 ("Region"), endast butik-rader ════
    const omrade = katalog.get("Område")!;
    let omrWritten = 0, omrSkippedExisting = 0, omrNoObject = 0;
    {
      const existing = await existingFor(omrade.id);
      for (const r of mainRows) {
        if (trim(r["13"]) !== "Butik") continue;
        const value = trim(r["6"]);
        const interim = trim(r["1"]);
        if (!value || !interim) continue;
        const objektId = interimToObj.get(interim);
        if (!objektId) { omrNoObject++; warnings.push(`Område: interim "${interim}" saknar objekt`); continue; }
        if (existing.has(objektId)) { omrSkippedExisting++; continue; }
        await insertValue(objektId, omrade.id, omrade.standardArvs, value);
        existing.add(objektId);
        omrWritten++;
      }
    }
    console.log(`Område: ${omrWritten} skrivna, ${omrSkippedExisting} hade redan värde, ${omrNoObject} utan objekt`);

    // ════ 3) Butiksnummer ← BUTIK-filens "Nr" (kolumn 1), positionsmatchad ════
    // Butik-raderna i MAIN och raderna i BUTIK-filen är samma butiker i samma
    // ordning. Varje par korsverifieras på normaliserat namn + region innan
    // skrivning; mismatch → hoppa över med varning (aldrig gissning).
    const butiksnr = katalog.get("Butiksnummer")!;
    const mainButik = mainRows.filter((r) => trim(r["13"]) === "Butik");
    let bnWritten = 0, bnSkippedExisting = 0, bnMismatch = 0, bnNoObject = 0;
    if (mainButik.length !== butikRows.length) {
      warnings.push(
        `Butiksnummer: radantal skiljer (MAIN butik=${mainButik.length}, BUTIK-fil=${butikRows.length}) — matchar bara verifierade par`,
      );
    }
    {
      const existing = await existingFor(butiksnr.id);
      const n = Math.min(mainButik.length, butikRows.length);
      for (let i = 0; i < n; i++) {
        const obj = mainButik[i];
        const bf = butikRows[i];
        const nr = trim(bf["1"]);
        const interim = trim(obj["1"]);
        if (!nr || !/^\d+$/.test(nr)) { warnings.push(`Butiksnummer rad ${i + 1}: ogiltigt Nr "${nr}"`); continue; }
        const nameOk = normName(trim(obj["0"])) === normName(trim(bf["0"]));
        const regionOk = trim(obj["6"]).toLowerCase() === trim(bf["2"]).toLowerCase();
        if (!nameOk || !regionOk) {
          bnMismatch++;
          warnings.push(`Butiksnummer rad ${i + 1}: par matchar ej ("${trim(obj["0"])}" vs "${trim(bf["0"])}")`);
          continue;
        }
        const objektId = interimToObj.get(interim);
        if (!objektId) { bnNoObject++; warnings.push(`Butiksnummer: interim "${interim}" saknar objekt`); continue; }
        if (existing.has(objektId)) { bnSkippedExisting++; continue; }
        await insertValue(objektId, butiksnr.id, butiksnr.standardArvs, nr);
        existing.add(objektId);
        bnWritten++;
      }
    }
    console.log(
      `Butiksnummer: ${bnWritten} skrivna, ${bnSkippedExisting} hade redan värde, ${bnMismatch} par-mismatch, ${bnNoObject} utan objekt`,
    );

    // ── Verifiering innan commit ────────────────────────────────────────────
    const verify = await client.query(
      `SELECT mk.namn, count(mv.id)::int AS n
       FROM metadata_katalog mk
       LEFT JOIN metadata_varden mv ON mv.metadata_katalog_id=mk.id
         AND mv.status='aktiv' AND COALESCE(mv.raderad,false)=false
       WHERE mk.tenant_id=$1 AND mk.namn = ANY($2::text[]) AND mk.deleted_at IS NULL
       GROUP BY mk.namn ORDER BY mk.namn`,
      [TENANT, ["Typ", "Område", "Butiksnummer"]],
    );
    console.log("\nAktiva värden efter körning (inom tx):");
    for (const r of verify.rows) console.log(`  ${r.namn}: ${r.n}`);

    if (warnings.length) {
      console.log(`\nVarningar (${warnings.length}):`);
      for (const w of warnings.slice(0, 30)) console.log("  - " + w);
      if (warnings.length > 30) console.log(`  ... +${warnings.length - 30} till`);
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\nDRY-RUN: allt rullades tillbaka. Skarp körning:");
      console.log("  CONFIRM=YES_BACKFILL_PROD npx tsx scripts/backfill-kinab-import-metadata.ts --confirm BACKFILL-KINAB-METADATA");
    } else {
      await client.query("COMMIT");
      console.log(`\nCOMMIT klar. Batch: ${BATCH_ID}`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nFEL — rollback:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main();
