# Buggfixar

## Task #15 — Buggfix: Lås-knappen fungerar inte i orderlagret
**Status:** MERGED | **Datum:** 2026-03-14

Klick på "Lås"-knappen i orderlagret (OrderStockPage) gav röd varning "Kunde inte ändra låsstatus". PATCH-request nådde aldrig servern pga route-ordning.

**Nyckelresultat:**
- Identifierad rotorsak: route-ordning i Express
- `/api/objects/tree` placerad före `/api/objects/:id`
- Verifierad lås- och upplåsfunktionalitet
