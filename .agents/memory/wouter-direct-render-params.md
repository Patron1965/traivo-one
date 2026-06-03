---
name: wouter useParams outside Route
description: Why public/standalone pages in App.tsx must parse path params manually instead of useParams
---

In `client/src/App.tsx` several public/standalone pages are rendered via
`if (location.startsWith("/some-prefix/")) return <Page/>` branches, NOT inside a
wouter `<Route path="...">`. wouter's `useParams()` returns `{}` in that case
because there is no matched Route to source params from.

**Symptom:** the page renders its "not found / invalid" fallback even though the
backend returns 200, because the param is `undefined` → the data query is
`enabled: !!param` (disabled) → `data` stays undefined → error/empty card shows.

**How to apply:** for any page rendered directly through a `location.startsWith`
branch (e.g. `/report/near/`, `/report/`, portal), derive the param from the path
yourself: `const [location] = useLocation(); const x = decodeURIComponent(location.split('/report/near/')[1]?.split(/[/?#]/)[0] || '')`.
Do not rely on `useParams` there.
