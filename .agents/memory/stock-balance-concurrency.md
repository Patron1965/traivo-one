---
name: Lagersaldo concurrency-lås
description: Saldo-/rörelselogg-writes måste serialiseras med radlås
---

Regel: alla flöden som beräknar ett delta mot lagersaldo eller orderrads-netto (reconcile, inventering/absolut set) måste läsa utgångsvärdet under FOR UPDATE-lås i SAMMA tx som skriver — annars dubbelbokar parallella anrop samma delta och rörelseloggens balanceAfter blir inkonsistent.

**Why:** Architect-review av Lagermodul 2.0 fann att read-outside-tx + delta-apply-inside-tx dubbelbokade vid samtidiga reconcile-anrop; samma mönster i absolut-set gav fel delta i stock_movements.

**How to apply:** För upsert-fall: INSERT ... ON CONFLICT DO NOTHING → SELECT ... FOR UPDATE → UPDATE, allt i en tx. Drizzle: `.for("update")` på select. Rena relativa `balance = balance + delta`-upserts är redan atomära och behöver inget extra lås.
