---
name: /api/objects dual response shape
description: GET /api/objects returns a bare array OR a paginated {objects,total} object depending on query params — frontend consumers must normalize both.
---

# `/api/objects` returns two different shapes

`GET /api/objects` (server/routes/customerRoutes.ts) responds with:
- a **bare array** of objects for the plain/unfiltered request, but
- a **paginated object** `{ ...result, objects: enriched, total }` whenever `limit` and/or `search` query params are present.

**Why:** the route added pagination/search later via an expand path that wraps the result; the legacy array shape was kept for back-compat callers. A frontend `useQuery` typed as `Object[]` that does `res.json()` then `.map(...)` will crash with "map is not a function" the moment it passes `?limit=` or `?search=`.

**How to apply:** any new client query against `/api/objects` that uses `limit`/`search` must normalize:
`const data = await res.json(); return Array.isArray(data) ? data : (data?.objects ?? []);`
Do not assume the array shape just because other call sites get an array — check whether they pass limit/search.
