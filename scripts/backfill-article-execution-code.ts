// Task #1496: Engångsavstämning av artiklarnas utförandekod-fält.
//
// `articles.executionCode` är kanoniskt (läses av planering/resursmatchning/Fortnox);
// `performerCategory` var artikelformulärets legacy-fält. Skriptet:
//   1. executionCode NULL/tom men performerCategory satt → kopiera till executionCode.
//   2. Båda satta men olika → executionCode vinner; performerCategory skrivs om (rapporteras).
//   3. Nycklar (articleType/executionCode/timeCodeKey) som inte finns i respektive
//      register → rapporteras (ingen ändring; legacy-fritext tillåts på oförändrade rader).
//
// Kör: npx tsx scripts/backfill-article-execution-code.ts [--dry-run]
import { db } from "../server/db";
import {
  articles,
  articleTypeDefinitions,
  executionCodeDefinitions,
  timeCodeDefinitions,
} from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const rows = await db
    .select({
      id: articles.id,
      tenantId: articles.tenantId,
      articleNumber: articles.articleNumber,
      name: articles.name,
      articleType: articles.articleType,
      executionCode: articles.executionCode,
      performerCategory: articles.performerCategory,
      timeCodeKey: articles.timeCodeKey,
    })
    .from(articles)
    .where(isNull(articles.deletedAt));

  // Registernycklar per tenant (aktiva).
  const tenantIds = Array.from(new Set(rows.map((r) => r.tenantId)));
  const registers = new Map<string, { at: Set<string>; ec: Set<string>; tc: Set<string> }>();
  for (const t of tenantIds) {
    const [at, ec, tc] = await Promise.all([
      db.select({ key: articleTypeDefinitions.key }).from(articleTypeDefinitions)
        .where(and(eq(articleTypeDefinitions.tenantId, t), isNull(articleTypeDefinitions.deletedAt))),
      db.select({ key: executionCodeDefinitions.key }).from(executionCodeDefinitions)
        .where(and(eq(executionCodeDefinitions.tenantId, t), isNull(executionCodeDefinitions.deletedAt))),
      db.select({ key: timeCodeDefinitions.key }).from(timeCodeDefinitions)
        .where(and(eq(timeCodeDefinitions.tenantId, t), isNull(timeCodeDefinitions.deletedAt))),
    ]);
    registers.set(t, {
      at: new Set(at.map((r) => r.key)),
      ec: new Set(ec.map((r) => r.key)),
      tc: new Set(tc.map((r) => r.key)),
    });
  }

  let copied = 0, diverged = 0, unknown = 0;
  for (const r of rows) {
    const exec = r.executionCode?.trim() || null;
    const perf = r.performerCategory?.trim() || null;
    if (!exec && perf) {
      console.log(`[copy] ${r.tenantId} ${r.articleNumber} "${r.name}": executionCode ← performerCategory="${perf}"`);
      copied++;
      if (!dryRun) {
        await db.update(articles).set({ executionCode: perf })
          .where(and(eq(articles.id, r.id), eq(articles.tenantId, r.tenantId)));
      }
    } else if (exec && perf && exec !== perf) {
      console.log(`[diverge] ${r.tenantId} ${r.articleNumber} "${r.name}": executionCode="${exec}" vinner; performerCategory="${perf}" skrivs om`);
      diverged++;
      if (!dryRun) {
        await db.update(articles).set({ performerCategory: exec })
          .where(and(eq(articles.id, r.id), eq(articles.tenantId, r.tenantId)));
      }
    } else if (exec && !perf) {
      // Spegla åt andra hållet också så fälten är samstämmiga.
      if (!dryRun) {
        await db.update(articles).set({ performerCategory: exec })
          .where(and(eq(articles.id, r.id), eq(articles.tenantId, r.tenantId)));
      }
    }
    const reg = registers.get(r.tenantId)!;
    const report = (falt: string, v: string | null, set: Set<string>) => {
      if (v && !set.has(v)) {
        console.log(`[unknown-${falt}] ${r.tenantId} ${r.articleNumber} "${r.name}": "${v}" saknas i registret (lämnas orörd)`);
        unknown++;
      }
    };
    report("artikeltyp", r.articleType, reg.at);
    report("utforandekod", exec || perf, reg.ec);
    report("tidskod", r.timeCodeKey?.trim() || null, reg.tc);
  }
  console.log(`\nKlart${dryRun ? " (dry-run — inga skrivningar)" : ""}: kopierade=${copied} divergenta=${diverged} okända nycklar=${unknown} av ${rows.length} artiklar`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
