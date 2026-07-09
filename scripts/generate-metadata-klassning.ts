/**
 * Task #1213 (Etapp 1, steg 6): Klassningsförslag enkelvärde/katalogvärde.
 *
 * Genererar `docs/metadata-klassningsforslag.md` — en lista över samtliga
 * befintliga katalogfält med föreslagen klassning för produktägarens
 * godkännande. Ändrar INGENTING i databasen.
 *
 * Heuristik (i prioritetsordning):
 *  1. `allow_duplicates = true` idag  → Katalogvärde (befintlig klassning behålls).
 *  2. Fält där något objekt redan har FLERA aktiva egna värden → Katalogvärde
 *     (data motsäger enkelvärde; hård auto-arkivering skulle radera information).
 *  3. Kronologisk visning (`kronologisk_visning = true`) → Katalogvärde
 *     (tidslinjefält bygger på flera poster över tid).
 *  4. Allt annat → Enkelvärde (nytt värde arkiverar automatiskt det gamla, G1).
 *
 * Körning: npx tsx scripts/generate-metadata-klassning.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

interface KatalogRow {
  tenant_id: string;
  tenant_name: string | null;
  id: string;
  namn: string;
  visningsnamn: string | null;
  datatyp: string;
  kategori: string | null;
  allow_duplicates: boolean;
  kronologisk_visning: boolean;
  ar_beraknad: boolean | null;
  deleted_at: string | null;
  aktiva_varden: string; // count
  max_per_objekt: string; // max antal aktiva egna värden på ett och samma objekt
  objekt_med_flera: string; // antal objekt med >1 aktivt eget värde
}

function escapeMd(v: string): string {
  return v.replace(/\|/g, "\\|");
}

async function main() {
  const res = await db.execute(sql`
    SELECT
      mk.tenant_id,
      t.name AS tenant_name,
      mk.id,
      mk.namn,
      mk.visningsnamn,
      mk.datatyp,
      mk.kategori,
      mk.allow_duplicates,
      mk.kronologisk_visning,
      mk.ar_beraknad,
      mk.deleted_at,
      COALESCE(v.aktiva_varden, 0)::text AS aktiva_varden,
      COALESCE(v.max_per_objekt, 0)::text AS max_per_objekt,
      COALESCE(v.objekt_med_flera, 0)::text AS objekt_med_flera
    FROM metadata_katalog mk
    LEFT JOIN tenants t ON t.id = mk.tenant_id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS aktiva_varden,
        MAX(cnt) AS max_per_objekt,
        COUNT(*) FILTER (WHERE cnt > 1) AS objekt_med_flera
      FROM (
        SELECT mv.objekt_id, COUNT(*) AS cnt
        FROM metadata_varden mv
        WHERE mv.metadata_katalog_id = mk.id
          AND mv.tenant_id = mk.tenant_id
          AND mv.status = 'aktiv'
          AND mv.raderad = false
          AND mv.objekt_id IS NOT NULL
        GROUP BY mv.objekt_id
      ) per_objekt
    ) v ON true
    WHERE mk.deleted_at IS NULL
    ORDER BY t.name NULLS LAST, mk.kategori NULLS LAST, mk.namn
  `);

  const rows = res.rows as unknown as KatalogRow[];

  const lines: string[] = [];
  lines.push(`# Klassningsförslag: enkelvärde / katalogvärde`);
  lines.push(``);
  lines.push(`> Genererad ${new Date().toISOString().slice(0, 10)} av \`scripts/generate-metadata-klassning.ts\` (Task #1213, Etapp 1).`);
  lines.push(`> Förslag för produktägarens godkännande — INGENTING är ändrat i databasen.`);
  lines.push(``);
  lines.push(`**Enkelvärde** = fältet har ett gällande värde per objekt; nytt värde arkiverar automatiskt det gamla som fullvärdig arkiverad post (G1).`);
  lines.push(`**Katalogvärde** = flera samtidiga värden av samma fält kan finnas på ett objekt (t.ex. flera ytor, flera kontakter).`);
  lines.push(``);
  lines.push(`## Heuristik`);
  lines.push(`1. \`allow_duplicates = true\` idag → **Katalogvärde** (befintlig klassning behålls).`);
  lines.push(`2. Något objekt har redan flera aktiva egna värden → **Katalogvärde** (data motsäger enkelvärde).`);
  lines.push(`3. Kronologisk visning aktiv → **Katalogvärde** (tidslinje bygger på flera poster).`);
  lines.push(`4. Övrigt → **Enkelvärde**.`);
  lines.push(``);

  const byTenant = new Map<string, KatalogRow[]>();
  for (const r of rows) {
    const key = `${r.tenant_name ?? r.tenant_id}`;
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key)!.push(r);
  }

  let totalEnkel = 0;
  let totalKatalog = 0;

  for (const [tenantName, tenantRows] of byTenant) {
    lines.push(`## Tenant: ${escapeMd(tenantName)}`);
    lines.push(``);
    lines.push(`| Fält | Datatyp | Kategori | Idag (allow_duplicates) | Aktiva värden | Objekt m. flera | Förslag | Motivering |`);
    lines.push(`|---|---|---|---|---:|---:|---|---|`);
    for (const r of tenantRows) {
      const namn = r.visningsnamn && r.visningsnamn !== r.namn
        ? `${r.visningsnamn} (\`${r.namn}\`)`
        : `\`${r.namn}\``;
      const multi = parseInt(r.objekt_med_flera, 10) > 0;
      let forslag: string;
      let motiv: string;
      if (r.allow_duplicates) {
        forslag = "Katalogvärde";
        motiv = "Redan klassat som dubblerbart";
      } else if (multi) {
        forslag = "Katalogvärde";
        motiv = `${r.objekt_med_flera} objekt har redan flera aktiva värden`;
      } else if (r.kronologisk_visning) {
        forslag = "Katalogvärde";
        motiv = "Kronologisk visning (tidslinje)";
      } else {
        forslag = "Enkelvärde";
        motiv = r.ar_beraknad ? "Beräknat fält — ett gällande värde" : "Ett gällande värde per objekt";
      }
      if (forslag === "Enkelvärde") totalEnkel++;
      else totalKatalog++;
      lines.push(
        `| ${escapeMd(namn)} | ${escapeMd(r.datatyp)} | ${escapeMd(r.kategori ?? "—")} | ${r.allow_duplicates ? "ja" : "nej"} | ${r.aktiva_varden} | ${r.objekt_med_flera} | **${forslag}** | ${escapeMd(motiv)} |`
      );
    }
    lines.push(``);
  }

  lines.push(`## Sammanfattning`);
  lines.push(``);
  lines.push(`- Totalt ${rows.length} aktiva katalogfält (arkiverade fält exkluderade).`);
  lines.push(`- Föreslagna enkelvärden: **${totalEnkel}**`);
  lines.push(`- Föreslagna katalogvärden: **${totalKatalog}**`);
  lines.push(``);
  lines.push(`Godkännande: produktägaren bockar av per rad; avvikelser ändras via Inställningar → Metadata (växeln "Katalogvärde (flera värden)").`);
  lines.push(``);

  writeFileSync("docs/metadata-klassningsforslag.md", lines.join("\n"), "utf8");
  console.log(`Skrev docs/metadata-klassningsforslag.md — ${rows.length} fält (${totalEnkel} enkelvärde, ${totalKatalog} katalogvärde).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fel vid generering:", err);
  process.exit(1);
});
