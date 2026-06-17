---
name: Fältappen saknar redigerbart antalsfält
description: Traivo Go (SimpleFieldApp/FocusMode) har inget redigerbart antals-input för orderrader; antalslogik är display-only där.
---

Fältappen (`SimpleFieldApp.tsx` / `FocusMode.tsx`) har **inget redigerbart antals-fält** för en orderrad. Klarmarkering (`completeJobMutation`) använder befintlig `line.quantity` automatiskt — fältarbetaren ändrar aldrig antalet.

**Why:** GAP-106 ("dölj antalsfält i appen för fast antal") antog att ett redigerbart antalsfält fanns att dölja. Det fanns inte. Antal redigeras bara i planeraren (web). Server (`workOrderRoutes.ts` rad-qty PATCH) blockerar redan icke-planner-antalsändringar när `operatorCanUpdateQuantity !== true`.

**How to apply:** Antalsrelaterade artikel-flaggor (`hideQuantityInApp`, `operatorCanUpdateQuantity`) får sin fältapps-effekt via metadata-context-payloaden (`server/routes/mobile/misc.ts` → `orderArticles[]`), inte genom att dölja ett befintligt input. `hideQuantityInApp` döljer ett **read-only** antal i "Beställda artiklar"-kortet. Vill du faktiskt göra antal redigerbart i appen är det ny scope (nytt input + ny mobil-PATCH-väg), inte en justering. `hideQuantityInApp` och `operatorCanUpdateQuantity` är ömsesidigt uteslutande i artikelformuläret.
