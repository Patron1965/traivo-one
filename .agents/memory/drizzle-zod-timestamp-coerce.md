---
name: drizzle-zod timestamp coerce
description: Routes that insert/update Postgres timestamp columns must coerce ISO strings to Date in their zod schema, or every write 400s.
---

# drizzle-zod timestamp() → z.date(): coerce at the HTTP boundary

`createInsertSchema` maps a Drizzle `timestamp()` column to `z.date()` (expects a JS `Date`), but HTTP clients send timestamps as **ISO strings**. So a route schema built straight from `insertXSchema` rejects every payload with `"Expected date, received string"` (400) on the timestamp field.

**Rule:** Any route schema that accepts a timestamp column must extend it with coercion:
```ts
const createSchema = insertXSchema
  .omit({ tenantId: true, /* ... */ })
  .extend({ startAt: z.coerce.date().nullish(), endAt: z.coerce.date().nullish() });
const patchSchema = createSchema.partial(); // inherits the coercion
```
Match the original nullability: nullable+optional timestamp columns → `.nullish()`.

**Why:** This bug is invisible until a write is exercised end-to-end. In Traivo the whole personal-task write surface (POST plus every PATCH path — block moves, egentid saves) was latently broken because those flows were only ever exercised behind the Replit-Auth preview iframe, which blocked live testing. tsc is no help — the generated TS type is `Date`, and the runtime string only fails at `safeParse`.

**How to apply:**
- When adding/reviewing any POST/PATCH that writes a `timestamp()` column, verify the route schema coerces it. Quick check: `someSchema.safeParse({ ...body, ts: "2026-01-01T00:00:00Z" })` should succeed and yield a `Date`.
- This is the **write** counterpart to `raw-execute-timestamp-strings.md` (which covers reads: raw `db.execute()` returns timestamps as strings).
- Date-only `date()` columns are fine — drizzle-zod maps them to `z.string()`, so `"YYYY-MM-DD"` passes without coercion.
