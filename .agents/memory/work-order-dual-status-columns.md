---
name: work_orders dubbla status-kolumner + index-namnkollision
description: work_orders har TVÅ status-kolumner (lifecycle `status` vs Modus `order_status`); index/query måste välja rätt, och index-namn kan ge tysta no-op-migrationer.
---

# work_orders har två separata status-kolumner

`work_orders.status` = livscykel (default `active` — active/inactive/archived-aktigt), används i storage-filtrering.
`work_orders.order_status` = Modus-workflowstatus (8-stegs).

De är INTE samma sak. Query/index-kod måste medvetet välja vilken kolumn som avses.

**Why:** En perf-index-migration la `idx_work_orders_tenant_status ON work_orders(tenant_id, order_status)`. En senare migration som försökte skapa samma namn för `(tenant_id, status)` blev en **tyst no-op** eftersom `CREATE INDEX IF NOT EXISTS` matchar på *namn*, inte på kolumner. Resultat: livscykel-`status` saknade komposit-index trots att migrationen "körde grönt". Fixades med distinkt namn `idx_work_orders_tenant_lifecycle_status`.

**How to apply:** När du skapar ett index på en work_orders status-kolumn — verifiera vilken status-kolumn, och ge index ett namn som speglar kolumnen (`..._lifecycle_status` vs `..._order_status`). Lita aldrig på att `IF NOT EXISTS` "redan finns"-träff betyder att rätt index finns; den kan vara på fel kolumn med samma namn.
