# Scripts

## reset-and-seed-kinab.ts

**DESTRUCTIVE.** Wipes every business table in the connected Postgres database
(everything except `sessions` and `__drizzle_migrations`) and reseeds the
database with a single Kinab tenant plus Anna (owner) and Patrik (admin).

Before truncating, the script writes a full `pg_dump` snapshot to
`.local/backups/before-reset-<timestamp>.sql`.

Run it with:

```bash
CONFIRM_WIPE=yes npx tsx scripts/reset-and-seed-kinab.ts
```

Without `CONFIRM_WIPE=yes` the script aborts immediately. Restart the workflow
afterwards so the application picks up the new tenant state.

After the wipe, `server/seed.ts` will detect that a non-default tenant exists
and skip its demo seed, and `ensureDefaultTenant` in `server/routes.ts` will
not recreate the legacy `default-tenant` row.
