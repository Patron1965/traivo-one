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
