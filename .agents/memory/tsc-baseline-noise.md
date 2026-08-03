---
name: tsc baseline & typecheck-diff verification
description: How to verify a change with tsc on this large repo — use the baseline diff script; do NOT hand-triage the ~434 stable pre-existing errors. Also the background-log rollback trap.
---

# Verifying tsc on Traivo

The repo has a tracked tsc-error baseline (`typecheck-baseline.json`, ~434 errors) and a diff checker:

- **Check (fails ONLY on new errors):** `npx tsx scripts/typecheck-diff.ts` — also registered as validation step `typecheck`.
- **Refresh baseline** (only after fixing baseline errors, NEVER to hide new ones): `npx tsx scripts/typecheck-diff.ts --update`.

Key design points (don't break these):
- Baseline keys are `file|TScode|normalizedMessage` **without line numbers** (unrelated edits shift lines) with per-key occurrence counts.
- tsc prints inferred object-type members in **nondeterministic order between runs**; the script canonicalizes quoted `{...}` type literals by sorting members. Without this, ~80 keys flap per run.
- `tsconfig.json` has `target: "ES2022"` (2026-08): killed all TS2802 Set/Map-iteration noise and revealed ~73 previously-masked real errors (now in baseline).

When you fix type errors in a file, re-run the check; if it reports many baseline errors gone, shrink the baseline with `--update` in the same commit.

## Background-log rollback trap
Run tsc **synchronously in one bash call**. The `Start application` workflow restarts on file edits, and that restart **rolls back files written by backgrounded (`nohup`/`setsid`) processes** — logs in `/tmp/*.log` or `.local/*.log` disappear between bash tool calls.
