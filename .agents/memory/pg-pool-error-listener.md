---
name: pg Pool error listener is mandatory
description: Why every long-lived node-postgres Pool must register pool.on('error'), or a dropped idle connection crashes the whole server.
---

Any shared, long-lived node-postgres `Pool` (e.g. `server/db.ts`) MUST register a
`pool.on('error', ...)` listener that logs and absorbs the error.

**Why:** When managed Postgres drops an *idle* connection server-side (routine
maintenance / scaling / idle-reaping — SQLSTATE `57P01`
"terminating connection due to administrator command"), node-postgres emits an
`'error'` event on the pool's idle client. With no listener, Node treats it as an
unhandled `EventEmitter` error and escalates to `uncaughtException`. This repo's
`process.on('uncaughtException')` in `server/index.ts` calls `process.exit(1)`,
so a single idle-connection drop took the **entire** server down for ~60s. During
that window every request (including login / magic-link) was served by the Replit
edge as plain-text `Internal Server Error`, and the client's `res.json()` failed
with a cryptic `Unexpected token 'I', "Internal S"... is not valid JSON`.

**How to apply:** The listener only needs to log + continue — the pool transparently
discards the dead connection and opens a new one on the next query. Pair it with
`keepAlive: true` and a modest `idleTimeoutMillis` to recycle idle connections
before the managed DB reaps them. This applies to ANY new pool/connection added
later, not just the main one.

Related client lesson: a non-JSON error body (gateway/edge plain text during a
restart) should be mapped to a friendly localized message in `throwIfResNotOk`
(`client/src/lib/queryClient.ts`), never surfaced as raw text or a JSON.parse error.
