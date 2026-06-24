---
name: ObjectsPage filter state fan-out
description: Adding/removing a filter on the objektlista touches 8 separate places — miss one and the filter silently half-works.
---

# ObjectsPage (objektlista) filter state is duplicated across 8 places

Every filter on `client/src/pages/ObjectsPage.tsx` is wired through eight separate
spots. Changing (adding OR removing) a filter requires touching ALL of them, or the
filter silently half-works (e.g. counter wrong, chip orphaned, query ignores it):

1. `useState` declaration (+ setter)
2. the list `useQuery` queryKey
3. the queryFn param building (URLSearchParams)
4. `buildObjectFilterParams` (+ its useCallback deps)
5. `activeFilterCount` (+ its deps) — the active-filter counter
6. `clearAllFilters`
7. the filter **chips** row (active-filter badges)
8. the filter **panel** UI (the Select/Popover/Checkbox control)

Plus the empty-state condition (`totalObjects === 0 && !debouncedSearch && ...`) that
gates the "no objects yet" placeholder vs "no matches" — it ANDs every filter being
inactive, so a removed filter must be dropped from that boolean too.

**Server side** a list filter also spans: `customerRoutes.ts` GET `/api/objects`
(query parse → `hasFilters` → `filters` object) and `storage.getObjectsPaginated`
(filter type on both the `IStorage` interface signature AND the impl, plus the WHERE
block). `getObjectsPaginated` is only called from `customerRoutes.ts`.

**Why:** the state isn't centralized into one object, so the compiler won't catch a
missed spot — an orphaned chip or a stale counter compiles fine.
