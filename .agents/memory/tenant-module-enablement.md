---
name: Tenant module enablement (package tiers)
description: How to durably enable/disable a feature module for a tenant on a system package tier (basic/standard/premium/pilot).
---

# Enabling a module for a tenant on a system tier

To enable a feature module (e.g. `order_concepts`) for a tenant that sits on a
**system package tier** (`basic`/`standard`/`premium`/`pilot`), edit that tier's
`modules` list in `PACKAGE_DEFINITIONS` (`shared/modules.ts`) — do NOT edit the
tenant's `tenant_features.enabled_modules` DB row directly.

**Why:** A startup backfill realigns every tenant whose `packageTier` is in
`SYSTEM_TIERS = {basic, standard, premium, pilot}` so its `enabled_modules`
exactly matches `getModulesForPackage(tier)`. A direct DB-row edit is overwritten
on the next server start. The backfill runs in production too (it executes before
the demo-seed early-return), so the package-definition edit propagates on deploy.

**How to apply:**
- Module gating is per-route: `getModuleForRoute()` maps to the first path segment,
  so `/order-concepts/new` → `order_concepts`; `ProtectedRoute` shows the upgrade
  gate when `!isModuleEnabled(moduleKey)`.
- Editing a system tier affects ALL tenants on that tier. KINAB is the pilot
  tenant in production but is on `premium` in the dev DB (all modules), so a
  pilot-only gate cannot be reproduced visually in dev.
- For a one-off tenant deviation without touching others, move that tenant to the
  `custom` tier (not in `SYSTEM_TIERS`, so the backfill skips it) and set its
  modules explicitly. The KINAB pilot/premium seed helpers preserve any manually
  chosen non-default tier and won't revert it.

## Literal \u00xx escapes: JSX text vs JS strings
Literal `\u00e4` etc. inside a JS/TS **string literal** (`"P\u00e5 plats"`) is valid
and decodes at runtime — leave it. The same escape as **JSX text content**
(`<h2>Modul \u00e4r aktiverad</h2>`) renders the raw backslash-u text to users —
that is the bug. Only fix JSX-text occurrences.
