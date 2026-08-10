/**
 * scripts/restore-kinab-classification-prod.ts (Task #1502)
 *
 * Engångs-återinmatning av kinab-demons snapshotade objektklassificering
 * (docs/legacy-objektfalt-rivning-1486.md) som metadata i PROD efter att
 * legacy-kolumnerna droppats vid Publish.
 *
 * Insert-only och idempotent: hoppar över objekt som redan har NÅGON rad
 * (aktiv, arkiverad eller tombstonad) för respektive katalogfält.
 * Rör aldrig andra tenants än kinab.
 *
 * Användning:
 *   npx tsx scripts/restore-kinab-classification-prod.ts                     # dry-run
 *   npx tsx scripts/restore-kinab-classification-prod.ts --confirm KINAB-KLASSIFICERING
 */
import { Pool } from "pg";

const TENANT = "kinab";
// Snapshot 2026-08-10 (Objekttyp = object_type, Anläggningstyp = hierarchy_level)
const SNAPSHOT: Record<string, { objekttyp: string; anlaggningstyp: string }> = {
  "OBJ-001": { objekttyp: "rum", anlaggningstyp: "rum" },
  "OBJ-002": { objekttyp: "fastighet", anlaggningstyp: "fastighet" },
  "OBJ-003": { objekttyp: "karl", anlaggningstyp: "karl" },
  "OBJ-004": { objekttyp: "rum", anlaggningstyp: "rum" },
  "OBJ-005": { objekttyp: "fastighet", anlaggningstyp: "fastighet" },
  "OBJ-006": { objekttyp: "karl", anlaggningstyp: "karl" },
  "OBJ-007": { objekttyp: "rum", anlaggningstyp: "rum" },
  "OBJ-008": { objekttyp: "rum", anlaggningstyp: "rum" },
  "OBJ-010": { objekttyp: "fastighet", anlaggningstyp: "fastighet" },
  "OBJ-013": { objekttyp: "fastighet", anlaggningstyp: "fastighet" },
  "OBJ-014": { objekttyp: "fastighet", anlaggningstyp: "fastighet" },
};

const DRY_RUN = process.argv[process.argv.indexOf("--confirm") + 1] !== "KINAB-KLASSIFICERING";

async function main(): Promise<void> {
  const url = process.env.PROD_DATABASE_URL;
  if (!url) throw new Error("PROD_DATABASE_URL saknas");
  const pool = new Pool({ connectionString: url, max: 1 });
  pool.on("error", (err) => console.error("[pool]", err.message));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const katalog = (
      await client.query(
        `SELECT id, lower(namn) AS key FROM metadata_katalog
         WHERE tenant_id=$1 AND deleted_at IS NULL AND lower(namn) IN ('objekttyp','anläggningstyp')`,
        [TENANT],
      )
    ).rows as { id: string; key: string }[];
    const katObjekttyp = katalog.find((r) => r.key === "objekttyp")?.id;
    const katAnlaggning = katalog.find((r) => r.key === "anläggningstyp")?.id;
    if (!katObjekttyp || !katAnlaggning) throw new Error("Katalogfälten Objekttyp/Anläggningstyp saknas i prod för kinab");

    const objects = (
      await client.query(
        `SELECT id, object_number FROM objects
         WHERE tenant_id=$1 AND object_number = ANY($2::text[]) AND deleted_at IS NULL`,
        [TENANT, Object.keys(SNAPSHOT)],
      )
    ).rows as { id: string; object_number: string }[];

    let created = 0, skipped = 0, missing = 0;
    for (const nr of Object.keys(SNAPSHOT)) {
      const obj = objects.find((o) => o.object_number === nr);
      if (!obj) { console.log(`  ${nr}: objekt saknas i prod — hoppar över`); missing++; continue; }
      for (const [katalogId, falt, varde] of [
        [katObjekttyp, "Objekttyp", SNAPSHOT[nr].objekttyp],
        [katAnlaggning, "Anläggningstyp", SNAPSHOT[nr].anlaggningstyp],
      ] as const) {
        const existing = await client.query(
          `SELECT 1 FROM metadata_varden WHERE tenant_id=$1 AND objekt_id=$2 AND metadata_katalog_id=$3 LIMIT 1`,
          [TENANT, obj.id, katalogId],
        );
        if (existing.rows.length > 0) { skipped++; continue; }
        await client.query(
          `INSERT INTO metadata_varden (tenant_id, objekt_id, metadata_katalog_id, varde_string, metod, skapad_av, status)
           VALUES ($1,$2,$3,$4,'auto','system','aktiv')`,
          [TENANT, obj.id, katalogId, varde],
        );
        console.log(`  ${nr}: ${falt}=${varde} ${DRY_RUN ? "(dry-run)" : "skapad"}`);
        created++;
      }
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log(`DRY-RUN klar: skulle skapa ${created}, hoppade ${skipped} (befintliga), ${missing} objekt saknades.`);
      console.log(`Kör skarpt: npx tsx scripts/restore-kinab-classification-prod.ts --confirm KINAB-KLASSIFICERING`);
    } else {
      await client.query("COMMIT");
      console.log(`KLART: skapade ${created}, hoppade ${skipped} (befintliga), ${missing} objekt saknades.`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error("Misslyckades:", err); process.exit(1); });
