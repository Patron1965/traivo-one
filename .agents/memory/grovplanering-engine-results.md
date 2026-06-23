---
name: Grovplanering motor-vy datakälla
description: Varför "Motorns förslag"-vyn i Grovplanering läser slot_times och inte work_orders.
---

# Grovplanering: motor-vy är separat datakälla

Grovplanerings-rutnätet listar `work_orders`. Tids- & geografimotorn opererar på
`assignments` och skriver resultat till `slot_times` (source=`tidsmotor`). Dessa två
är **separata** datakällor utan direkt FK mellan work_orders och assignments.

**Why:** "Motorns förslag"-fliken kan därför inte återanvända work_order-grid-endpointen.
Den läser en dedikerad endpoint `GET /api/rough-planning/engine-results` som joinar
slot_times → assignments → objects → customers.

**How to apply:** Klumpuppgifter = slot_times-rader med `metadata.kind="clump"`
(assignmentId=null, assignmentGroupKey satt, summerade värden i metadata). Vanliga
uppgifter = slot_times med assignmentId satt. Demo-DB har 0 assignments/0 slot_times
→ motor-vyn MÅSTE ha graciös tom-state. Motorkörning: `POST /api/time-geo-engine/run`
(requireAdmin). Beräkning + slot-registret byggs i #1038/#1037, inte i UI-tasken.
