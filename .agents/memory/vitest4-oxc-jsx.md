---
name: vitest 4 oxc JSX transform
description: Why client .tsx tests fail to parse under vitest 4 and how the vitest config must configure JSX.
---

# vitest 4 bundles rolldown-vite (oxc) — JSX needs the `oxc` option, not `esbuild`

Vitest 4.x ships its OWN bundled vite (rolldown-vite, vite 8 + oxc) under
`node_modules/vitest/node_modules/vite`. This transformer **ignores** the
top-level `esbuild` option (it prints "Both esbuild and oxc options were set.
oxc options will be used and esbuild options will be ignored").

**Symptom:** every client `.tsx` file (test files AND imported components like
`client/src/components/ui/tooltip.tsx`) fails with `RolldownError: Parse failure:
Unexpected JSX expression`. Plain `.ts` tests pass. oxc parses `.tsx` as plain
TS and chokes on JSX unless JSX is explicitly enabled.

**Fix:** in `vitest.config.ts` set the top-level `oxc` option:
```ts
export default defineConfig({
  oxc: { jsx: "automatic" },
  ...
})
```
This restores JSX transform for all `.tsx` files in the test pipeline.

**Why:** `@vitejs/plugin-react` (babel-based) does NOT engage under rolldown-vite
— the correct plugin would be `@vitejs/plugin-react-oxc`, which is not installed,
and adding it would require a package.json change (forbidden in fullstack-js).
Configuring `oxc.jsx` is the no-dependency fix.

**How to apply:** if client `.tsx`/component tests suddenly fail to parse JSX
after a vitest major bump, check for the bundled rolldown-vite and add `oxc.jsx`.
The `esbuild` block is redundant once `oxc` is set (oxc supersedes it).
