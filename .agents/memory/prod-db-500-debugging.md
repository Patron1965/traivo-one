---
name: Debugging prod-only DB 500s (Drizzle err.cause + empty-string FKs)
description: How to read the real Postgres cause behind a prod-only 500, and the empty-string-optional-FK class of bugs that produces 23503.
---

# Reading the real Postgres cause behind a prod-only 500

Drizzle wraps the underlying node-postgres error in `err.cause`. Its top-level
`message` is an enormous "Failed query: insert into ... returning ..." dump that
pushes the actual cause past the deployment log viewer's line-truncation, so you
only ever see the SQL, never the SQLSTATE.

**How to apply:** in the global error middleware (`server/middleware/errorHandler.ts`)
(1) cap `message`/`stack` lengths in the error serializer, and (2) walk the
`cause` chain and hoist a compact `dbError` field (SQLSTATE `code` + `detail`,
`column`, `constraint`, `table`, `routine`) to the FRONT of the log payload. A pg
error is identifiable by a 5-char `code` matching `/^[0-9A-Z]{5}$/` or a
`severity` string. Then re-publish, retry, and read `dbError` from prod logs.

**Why:** a prod-only runtime DB error can only be diagnosed from prod logs, and
the cause is otherwise invisible. Schema diffing dev↔prod will mislead you when
the schema is actually identical (it was, in the article-create case).

# Empty-string optional FK → 23503 (the article-create bug)

Optional `varchar` foreign-key columns (e.g. `articles.replacesArticleId`,
`articles.replacementArticleId`, both self-FKs to `articles.id`) get inserted as
`""` when the frontend sends an empty string for an unselected field. Postgres
rejects `""` with `23503 foreign_key_violation` ("Key (col)=() is not present").
A route guard like `if (data.replacementArticleId)` skips the existence check for
`""` (falsy) but the empty string is still inserted.

**How to apply:** coerce `""` (and whitespace-only) → `null` at the zod boundary
with `z.preprocess`, on the insert schema in `shared/schema.ts`. This covers both
POST and PATCH (PATCH uses `insertArticleSchema.partial()`). Watch for this on
ANY nullable varchar FK field, not just articles.
