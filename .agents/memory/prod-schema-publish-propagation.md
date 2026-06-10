---
name: Prod schema reaches production only via Publish
description: Why a newly-added column can make the published app throw raw "Failed query" insert errors while dev and the prod read-replica already show the column.
---

When you add a column to `shared/schema.ts`, it reaches **production** ONLY through Replit's Publish flow (publish diffs dev↔prod and applies it). Dev gets it via `db:push` / post-merge raw SQL; the read replica that `executeSql({environment:"production"})` reads reflects prod *after* the diff is applied.

**Symptom:** the published app throws a 500 `ERR_INTERNAL` with a Drizzle `Failed query: insert into "X" (...) values (...)` whose underlying PG cause (`42703 undefined_column`) is **truncated** by Drizzle's wrapper, so the log never names the missing column. Re-publishing repeatedly "doesn't help" if the failing attempts happen before the diff lands / before the running instance is current.

**How to diagnose (no prod writes needed):**
- Prove the code path is fine: a direct insert with the exact logged params succeeds on dev; the insert schema (drizzle-zod) rejects `''` for integer columns with a zod 400 *before* the DB, so empty-string-to-integer is never the cause of a raw DB error (that would be a 400, not a 500).
- Compare prod-replica vs dev for the table: columns, `is_nullable`, `column_default`, `pg_constraint`, `pg_trigger`. If they are identical AND the column is present in the replica, the failure was prod missing the column *at error time* — a later publish has since applied it.

**Why:** prod schema is not the application's responsibility; only Publish mutates it.

**How to apply / fix:** re-publish (the supported path). NEVER "self-heal" prod with startup-time DDL, deploy-build hooks (`.replit [deployment].build` running `db:push`), or `executeSql` DDL against prod — all explicitly forbidden by the `database` skill.

**Already done (don't re-investigate):** `server/middleware/errorHandler.ts` now has `serializeError()` that walks `err.cause` and extracts node-postgres fields (`code`, `detail`, `column`, `constraint`, ...) into the server log, and 5xx responses return a generic Swedish message instead of raw Drizzle SQL. So next recurrence: read deployment logs for the real PG `code`/`column` instead of guessing.

**Note on DB identity:** the app connects via the global `DATABASE_URL` *secret* (`server/db.ts`); dev → `heliumdb`, prod deployment → `neondb`. `executeSql` dev/prod targets line up with these. Confirmed `neondb` has `is_geo_dependent` (63 cols, identical schema to dev) — so the article-insert failures were a propagation-timing artifact, not a permanent prod schema gap.
