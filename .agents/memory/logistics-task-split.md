---
name: Lager-/återtagssplit lever i två separata tabeller
description: Hämta+leverera-paret bor helt i assignments; leverera+retur-paret bor helt i work_orders — länka aldrig ett par tvärs över tabellerna.
---

# Logistik-uppgiftssplit: assignments vs work_orders

Orderkoncept-expansion skriver rader i `assignments`. Mobil-/fältappen läser `work_orders`. Task-dependencies (`task_dependencies`) refererar ENBART work_orders. Det finns **ingen** brygga assignment→work_order.

Därför är logistik-splittarna medvetet uppdelade på två tabeller:

- **Hämta@lager + leverera@objekt** (auto-split av varuartikel med lagerplats vid koncept-expansion): båda raderna skapas i `assignments`. Hämt-raden bär `logisticsRole='pickup'`, leverera-raden `logisticsRole='deliver'` + `parentAssignmentId=<pickup.id>`. Länken är **assignments-intern**.
- **Leverera + retur-till-lager** (fältmarkerat "ej utlämnad / ska återtas"): båda raderna är `work_orders`. Retur-WO:n bär `logisticsRole='return'` + `parentWorkOrderId` och länkas till källordern via `task_dependencies`. Länken är **work_orders-intern**.

**Regel:** länka ALDRIG ett par tvärs över tabellerna (t.ex. en pickup-assignment till en deliver-work_order). Paren är konsekventa inom sin egen tabell.

**Why:** de två lagren existerar parallellt utan join-bro; ett kors-tabell-par blir oläsbart/obrytbart för respektive konsument (planner läser assignments, fältappen work_orders) och dependency-grafen (work_orders-only) kan inte uttrycka en assignment-länk.

**How to apply:** vid ny logik kring hämt/leverera/retur — bestäm först vilket lager uppgiften lever i (expansion=assignments, fält/mobil=work_orders) och håll hela paret + dess länk i det lagret. Splittriggern är `shouldSplitForStockPickup` (varuartikel + lagerplats m. koordinater) i `server/services/logistics-task-expansion.ts` (rena, DB-fria helpers delade av båda call-sites). Pickup-assignment bär INGET artikel/pris — värdet stannar på leverera-raden så fakturering inte dubbelräknas.
