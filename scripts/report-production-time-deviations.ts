/**
 * Avvecklingsrapport: Produktionstider-registret (production_time_lists).
 *
 * Jämför befintliga registerrader mot respektive artikels grundtid
 * (articles.production_time) och rapporterar avvikelser i loggen så att
 * artikelns tid kan justeras manuellt. Ingen data raderas — tabellen ligger
 * kvar tills contract-steget (Task 1492, expand-contract).
 *
 * Kör: npx tsx scripts/report-production-time-deviations.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = (await db.execute(sql`
    SELECT ptl.id,
           ptl.tenant_id,
           ptl.article_id,
           a.article_number,
           a.name AS article_name,
           a.production_time AS article_minutes,
           ptl.production_time_minutes AS list_minutes,
           ptl.performer_resource_id,
           ptl.equipment_id,
           ptl.valid_from,
           ptl.valid_to
    FROM production_time_lists ptl
    LEFT JOIN articles a ON a.id = ptl.article_id
    ORDER BY ptl.tenant_id, a.article_number
  `)).rows as Array<Record<string, unknown>>;

  console.log(`[produktionstider-avveckling] Totalt ${rows.length} registerrader i production_time_lists.`);
  if (rows.length === 0) {
    console.log("[produktionstider-avveckling] Inga rader — ingen manuell åtgärd behövs.");
    return;
  }

  const deviations = rows.filter((r) => {
    const articleMinutes = r.article_minutes == null ? null : Number(r.article_minutes);
    return articleMinutes !== Number(r.list_minutes);
  });

  console.log(`[produktionstider-avveckling] ${deviations.length} rader avviker från artikelns grundtid:`);
  for (const r of deviations) {
    const scope = r.performer_resource_id
      ? `utförare=${r.performer_resource_id}`
      : r.equipment_id
        ? `utrustning=${r.equipment_id}`
        : "generisk";
    console.log(
      `  - tenant=${r.tenant_id} artikel=${r.article_number ?? r.article_id} (${r.article_name ?? "okänd"}): ` +
      `register=${r.list_minutes} min vs artikel=${r.article_minutes ?? "saknas"} min [${scope}]` +
      (r.valid_from || r.valid_to ? ` giltighet=${r.valid_from ?? "-"}..${r.valid_to ?? "-"}` : ""),
    );
  }
  if (deviations.length > 0) {
    console.log("[produktionstider-avveckling] Justera artikelns tidsfält manuellt där registrets tid ska gälla.");
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[produktionstider-avveckling] Fel:", err);
  process.exit(1);
});
