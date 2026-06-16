---
name: apiRequest throws on non-2xx — structured error bodies are unreadable
description: Why `if(!res.ok)` after apiRequest() is dead code, and how to surface a structured 400 validation body (errors/preview) to the user.
---

`client/src/lib/queryClient.ts` `apiRequest()` calls `throwIfResNotOk()` which **throws** an `ApiError` on any non-2xx response. So any mutation written as:

```
const res = await apiRequest("POST", path, body);
if (!res.ok) { /* parse body.errors ... */ }
```

has a **dead** `if(!res.ok)` block — execution never reaches it; react-query's `onError` gets the thrown `ApiError` instead.

`throwIfResNotOk` builds its message from `json.message` → else `json.error` → else falls back to `"<status>: <statusText>"`. A JSON 400 with neither field therefore surfaces as the useless `"400:"` toast (statusText is empty for fetch JSON responses).

**Two-sided rule:**
- **Server:** any endpoint that returns a structured validation 400 (e.g. `{ok:false, errors:[...], preview:[...]}`) must ALSO include a human-readable `message` so the generic client handler shows something actionable.
- **Client:** when a mutation needs the *structured* error body (per-row errors, preview) — not just a message — use a raw `fetch(versionedUrl(path), { method, headers, body, credentials: "include" })` instead of `apiRequest`, so non-2xx does not throw and you can read `res.ok` + parse the body yourself. `versionedUrl` is exported from `@/lib/queryClient` and preserves the `/api/v1` prefix + session cookies.

**Why:** the Import-Wizard "Commit steg N" button hit a validation 400 whose body had `errors`/`preview` but no `message`; apiRequest threw before the wizard could render its per-row error panel, leaving the user with an empty `"Fel 400:"` toast and no way to know which rows were invalid.

**How to apply:** reach for the raw-fetch pattern whenever a 400/409 response carries field- or row-level detail the UI must render inline; otherwise plain `apiRequest` is fine.
