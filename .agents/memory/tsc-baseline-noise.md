---
name: tsc baseline noise & verifying type-checks
description: How to verify a change with tsc on this large repo without re-triaging the stable set of pre-existing errors, and the background-log rollback trap.
---

# Verifying tsc on Traivo

`npx tsc --noEmit` on this repo emits a **stable set of pre-existing errors that are NOT regressions**. When verifying your own change, only NEW errors in files you touched matter — diff against this baseline mentally.

## Baseline noise categories (ignore unless your change caused them)
- `TS2802` Set/Map/MapIterator "can only be iterated … downlevelIteration / target es2015" — everywhere (tsconfig targets ES5). Appears in storage, configRoutes, many client pages.
- `server/storage.ts`: dozens of `TS2322` `WorkOrderWithObject[]` assignment mismatches, `Record<string, unknown>[]` → typed `Row[]` `TS2352` conversions, object-select shape mismatches. Also `searchActiveWorkOrders` IStorage mismatch.
- Inferred drizzle select types missing hand-used props: `taskAddress`, `skills`, `code`, `odometerReading`, `orderStatus`, etc. across client pages.
- Heaviest baseline files to pre-exclude when grepping: `server/storage`, `server/telephony`, `server/vrp`, `server/tenant-middleware`, `server/unified-notifications`.

## How to check fast
Run tsc **synchronously in one bash call** and grep for your touched files + new symbols, e.g.
`npx tsc --noEmit 2>&1 | grep -E "shared/schema|status-colors|<yourfiles>|<newSymbols>"`.

**Why synchronous:** the `Start application` workflow restarts on file edits, and that restart **rolls back / wipes files written by backgrounded (`nohup`/`setsid`) processes** — logs sent to `/tmp/*.log` or even `.local/*.log` disappear between bash tool calls. Backgrounding tsc to a file repeatedly lost the output. tsc is slow here but finishes within one synchronous call; just pipe and filter inline.
