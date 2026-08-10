---
name: WorkOrder select-list drift
description: storage.ts har ~6 duplicerade explicita kolumnlistor för work_orders — nya kolumner följer INTE med automatiskt.
---

Nya work_orders-kolumner returneras INTE av storage-läsvägarna automatiskt: `getWorkOrders` m.fl. använder duplicerade explicita `db.select({...})`-listor (plus ett delat kolumnobjekt ~rad 1400). Konsumenter som läser `(wo as any).nyKolumn` får tyst `undefined → null`.

**Why:** tasksHistory (objektets "Kopplade uppgifter") fick alltid `sourceAssignmentId/orderConceptId/orderNumber = null` → dedup och käll-etikett var döda utan fel; typecheck fångade det inte p.g.a. `as any`.

**How to apply:** när en ny work_orders-kolumn ska nå en läsväg — grep:a alla select-listor i server/storage.ts (sök `etaSmsSent: workOrders.etaSmsSent`) och lägg till kolumnen i den lista som faktiskt driver konsumenten; undvik `(wo as any)` i services.
