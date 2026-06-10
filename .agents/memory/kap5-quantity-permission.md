---
name: Kap5 antal-behörighet server-side
description: Operatörs-behörighet att ändra orderrads-antal måste härledas från tenant-rollen, aldrig från klient-payload
---

Behörighet för "fältarbetare får ändra antal" (`articles.operatorCanUpdateQuantity`) på work-order-line PATCH avgörs av `req.tenantRole` (server-satt i tenant-middleware), INTE av en klient-flagga som `byOperator`.

**Regel:** privilegierade planeringsroller (`owner`/`admin`/`planner`) får alltid ändra antal; alla övriga roller (fältarbetare, t.ex. `technician`) får bara ändra om artikeln har `operatorCanUpdateQuantity=true`.

**Why:** en tidig implementation gated på `req.body.byOperator===true` — trivialt kringgås genom att utelämna flaggan. Code review (architect) flaggade det som blockerande EoP-risk.

**How to apply:** alla biz-rule/authz-beslut på mutationer ska läsa server-härledd identitet/roll, aldrig klient-payload. Mönstret finns redan via `(req as any).tenantRole` i `server/routes/workOrderRoutes.ts`.
