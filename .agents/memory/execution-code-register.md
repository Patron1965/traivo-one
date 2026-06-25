---
name: Utförandekod- & ikonregister
description: Tenant-scoped execution-code/icon registers vs the older execution-types page; how selectors source codes with fritext back-compat.
---

# Utförandekod-register + ikonregister

Two **distinct** "utförande"-concepts coexist — do not conflate:
- `/utforandetyper` → `ExecutionTypesPage` is a separate, older concept. Leave it alone.
- `/execution-codes` → `ExecutionCodesPage` (admin/) is the tenant-scoped **register** (table `executionCodeDefinitions`), mirroring the article-type register (`articleTypeDefinitions`). Sibling `/icons` → `iconDefinitions` (each row has a `lucideName`).

## Selectors source from register with fritext back-compat
The execution-code selectors (ArticlesExecutionTab, ResourcesExecutionTab, ResourceProfilesTab) no longer use the hardcoded `EXECUTION_CODE_OPTIONS` constant in `client/src/pages/tenant-config/shared-constants.ts`. They use the `useExecutionCodes(existingValues)` hook (`client/src/hooks/use-execution-codes.ts`).

**Why:** existing data holds free-text codes that may not exist in the register. The hook merges register entries (sorted by `sortOrder`) with any `existingValues` not in the register, marking the latter `isLegacy` (rendered with " (fritext)" suffix). This keeps already-set values selectable/readable without a hard migration.

**How to apply:** any new execution-code selector must feed current data values into `useExecutionCodes(...)` so legacy fritext stays valid. Register entries use field `key` (not `value`).

## Icon rendering
`client/src/lib/icon-registry.tsx` maps `lucideName` strings → Lucide components via `getLucideIconByName(name)` (has built-in fallback to `package`). `articles.iconKey` references `iconDefinitions.key`; the article form (ArticleFormPage) renders the icon preview through this helper.

## isSystem lock asymmetry (don't conflate the three registers)
Execution codes are **fully user-managed**: nothing is locked as "systemgenererad". Seed writes `isSystem:false`, the DELETE route has no `isSystem` guard, and the UI shows no System/Egen origin. The `executionCodeDefinitions.isSystem` column is RETAINED (expand-contract) but **inert** for execution codes — don't reintroduce a system-lock or origin badge.
**Why:** product decision — utförandekoden is the manual "who can do the job" flag; the system must never auto-mark codes undeletable.
**How to apply:** `articleTypeDefinitions` and `iconDefinitions` STILL keep their `isSystem` DELETE-guard + seed-as-system. The lock removal applies to execution codes only — treat the three registers separately.

## performerCategory is register-backed (separate from executionCode)
`articles.performerCategory` ("Utförarkategori" in ArticleFormPage) is no longer free text — it's a `useExecutionCodes([current])` Select storing an execution-code `key`, with legacy fritext back-compat. Note it is a DISTINCT column from `articles.executionCode` (edited in ArticlesExecutionTab); both can now hold execution-code keys.
`articles.competencyRequirements` ("Kompetenskrav") was removed from the article form (UI + payload gone); the column + zod insert schema are RETAINED but inert (expand-contract) so existing values survive partial PATCH. Don't re-add a competency field to the article form.
