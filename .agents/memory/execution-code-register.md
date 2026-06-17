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
