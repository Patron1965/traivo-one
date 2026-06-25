---
name: Central icon renderer
description: How register-icons (custom emoji/image + Lucide) are rendered consistently across surfaces
---

# Central icon renderer (RegistryIcon)

`client/src/lib/icon-registry.tsx` is the single source for rendering register icons.

- `RegistryIcon({ def })` renders an icon definition by `iconType`: `image` → `<img>` with `onError`→Lucide fallback; `emoji` → the `symbol` text; otherwise the Lucide icon from `lucideName`. It ALWAYS falls back cleanly (missing/broken image or empty symbol → Lucide → `package`).
- `useIcons()` is a thin `useQuery(["/api/icons"])` wrapper — it returns the **query object**, so destructure `const { data: icons = [] } = useIcons()`, not `{ icons }`.
- `resolveIconByKey(icons, key)` looks up a definition by its stable `key`.

**Why:** before this, each surface re-implemented `getLucideIconByName(def.lucideName)`, so custom (emoji/image) icons silently rendered as Lucide everywhere except admin. Route every icon display through `RegistryIcon` so the same entity shows the same icon on every surface.

**How to apply:** never call `getLucideIconByName` directly in a feature view — pass the whole definition to `RegistryIcon`. For execution codes, use `ExecutionCodeBadge` (`client/src/components/weekplanner/ExecutionCodeBadge.tsx`): it resolves the code's linked `iconKey` to a register icon, else falls back to the text abbreviation in `EXECUTION_CODE_ICONS`. It has an icon-only mode (tooltip) and a `showLabel` badge mode.
