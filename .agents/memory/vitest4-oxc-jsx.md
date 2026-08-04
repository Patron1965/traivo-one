---
name: vitest 4 JSX transform compatibility
description: Client .tsx tests break under vitest 4 unless JSX is configured for BOTH possible transformers (oxc and esbuild).
---

# vitest 4 JSX: configure both `oxc.jsx` and `esbuild.jsx`

Vitest 4.x has shipped with two different transformers across patch releases:
some versions bundle rolldown-vite (oxc, ignores `esbuild` option), others use
plain vite (esbuild, ignores `oxc` option).

**Rule:** `vitest.config.ts` must keep BOTH `oxc: { jsx: { runtime: "automatic" } }`
(object form — string form is rejected) AND `esbuild: { jsx: "automatic" }`.

**Why:** with only one configured, a patch-level vitest bump silently flips the
transformer and every client `.tsx` test fails — oxc variant with JSX parse
errors, esbuild variant with `React is not defined`.

**How to apply:** if client component tests suddenly fail after a vitest bump,
check which symptom appears and verify both JSX keys are still present; never
remove one as "redundant".
