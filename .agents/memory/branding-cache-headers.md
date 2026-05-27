---
name: Mutable per-tenant config + HTTP cache
description: Varför mutable config-endpoints (branding, terminologi, modules) inte ska ha max-age > 0.
---

GET-endpoints som returnerar mutable per-tenant config (t.ex. `/api/system/tenant-branding`) får inte sätta `Cache-Control: max-age=N` med N > 0.

**Why:** Tidigare hade branding-endpointen `max-age=300, stale-while-revalidate=600`. Efter en PUT som uppdaterade DB:n serverade webbläsaren fortfarande den cachade versionen i upp till 5 min, så det såg ut som att "Spara" inte gjorde något. TanStack `invalidateQueries` triggar bara en ny `fetch()`, och `fetch()` går genom HTTP-cachen som ignorerar React-Query-state.

**How to apply:** För mutable per-tenant/per-user config:
- `Cache-Control: private, no-cache, must-revalidate` (ETag-baserade 304:or fungerar fortfarande, payload-besparing utan stale-risk).
- Som extra säkerhet: i mutation `onSuccess`, gör `queryClient.setQueryData(key, response)` innan invalidate — då uppdateras providers/formulär omedelbart oberoende av HTTP-cachen.

`max-age=300+` är okej för rent statisk data (templates, icke-tenant-bundna definitioner) men aldrig för data som skrivs från samma UI.
