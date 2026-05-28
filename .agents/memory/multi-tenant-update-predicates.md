---
name: Multi-tenant UPDATE predicates
description: Alla UPDATE/DELETE och räkne-querys i Traivo måste ha tenant_id i WHERE, även när en pre-check redan validerat ägarskap.
---

# Regel
Alla `db.update(table).where(...)` och `db.execute(sql\`UPDATE/DELETE/SELECT COUNT...\`)` måste inkludera `tenant_id` i predikatet, även när handler-koden precis innan har hämtat raden med tenant-filter.

**Why:** Defense-in-depth. En pre-check som SELECT:ar med tenant-filter skyddar mot åtkomst men inte mot race conditions där cluster_id/object_id flyttas mellan tenants under requesten. Code review fångade upprepat fall där pre-check fanns men UPDATE/COUNT körde på enbart `id` — multi-tenant-invarianten måste upprätthållas på varje skrivning, inte bara på inläsningen.

**How to apply:**
- I drizzle: `where(and(eq(table.id, id), eq(table.tenantId, tenantId)))` — aldrig bara `eq(table.id, id)`.
- I raw SQL preflights/counts: `WHERE tenant_id = ${tenantId} AND ...` på *varje* tabell, inte bara root-tabellen.
- Gäller även `COUNT(*)`-querys i preflight/risk-bedömning — annars kan en användare se räkningar för objekt över tenant-gränser.
