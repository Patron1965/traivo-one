---
name: Schema-drift mellan schema.ts och DB
description: Varför kolumner/tabeller i shared/schema.ts kan saknas i prod/dev och hur man hittar & täpper till
---

# Schema-drift: schema.ts definierar, men DB saknar

`npm run db:push` (drizzle-kit) kan stalla på interaktiv rename-detektering vid
strukturella column-adds, så kolumner/tabeller som finns i `shared/schema.ts`
hamnar ibland aldrig i fresh/prod/dev-DB. De kraschar tyst med "Kunde inte hämta
data" först när en vy frågar efter dem (#654, #655).

**Regel:** Varje strukturell ADD COLUMN / CREATE TABLE / CREATE INDEX måste ha en
idempotent raw-SQL-migration (`IF NOT EXISTS`) **och** registreras i
`scripts/post-merge.sh`-replaylistan. Att bara skapa migrationsfilen räcker inte —
0047 fanns men låg inte i listan, så dess kolumner saknades ändå.

**Hitta drift:** `npx tsx scripts/schema-drift-check.ts` jämför alla pgTable i
schema.ts mot `information_schema.columns` / `pg_indexes` och listar saknade
tabeller/kolumner/index. Kör efter större schemaändringar.

**Automatiskt larm:** Scriptet ger exit-kod 1 när missing > 0 (annars 0). Det körs
nu (a) sist i `scripts/post-merge.sh` efter db:push + raw-migrations (blockerar
fresh-/prod-setup vid drift) och (b) som registrerat validation-step `schema-drift`.
`--warn` / `SCHEMA_DRIFT_WARN_ONLY=true` loggar drift men behåller exit 0. Saknad
`DATABASE_URL` ⇒ skip (exit 0).

**Why:** Replays-listan i post-merge är källan till sanning för fresh-miljöer;
db:push är inte tillförlitlig för strukturella adds.

## Contract-migrationer (DROP COLUMN) måste tåla att kolumnen redan är borta

`npm run db:push` kör FÖRST i `scripts/post-merge.sh`, FÖRE raw-migrations-loopen, och
synkar DB mot `shared/schema.ts`. När ett task TAR BORT en kolumn ur schema.ts hinner
db:push DROPPA kolumnen innan replay-migrationen körs. En contract-migration som
refererar den droppade kolumnen (t.ex. `UPDATE ... SET x = old_col` eller
`WHERE old_col IN (...)`) failar då hårt med `column "..." does not exist` → post-merge
exit ≠ 0 (sett som exit 3).

**Regel:** Alla backfill-satser i en DROP-COLUMN-migration måste guardas så de blir
no-op när kolumnen saknas. Använd plpgsql `DO $$ BEGIN IF EXISTS (SELECT 1 FROM
information_schema.columns WHERE table_name=... AND column_name=...) THEN <UPDATE> END
IF; END $$;` — inuti en ej-tagen IF-gren planeras aldrig UPDATE:n, så referensen till
den saknade kolumnen kastar inte. Själva droppen ska vara `DROP COLUMN IF EXISTS`.

**Gäller även expand-fasens ALTER:** en TIDIGARE migration som gör en kolumn nullable
(`ALTER COLUMN ... DROP NOT NULL`) ligger kvar i replay-listan även efter att en SENARE
migration DROPPAR kolumnen. Eftersom db:push pre-droppar kolumnen körs den gamla
DROP-NOT-NULL-satsen mot en saknad kolumn → hårt fel (`DROP NOT NULL` har ingen
`IF EXISTS`-form). Guarda alltså inte bara backfill i drop-migrationen utan ALLA
kolumn-muterande raw-satser vars kolumn en senare migration tar bort — samma
`information_schema.columns`-guard.

**OBS data:** Eftersom db:push droppar FÖRE backfillen i denna ordning hinner backfillen
aldrig bevara data i post-merge/deploy-flödet — databevarandet måste i praktiken redan
vara gjort i ett tidigare expand-/dual-write-steg. Backfillen i contract-migrationen är
bara en best-effort säkerhetsnät för legacy-rader.
