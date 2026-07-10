---
name: Tidskodregistrets regelmotor
description: Hur time_code_definitions styr payroll/ekonomi-export, GPS-krav, behörighet och fakturerbarhet — och var reglerna faktiskt tillämpas.
---

`time_code_definitions` bär rule-engine-fält (payrollExport, economyExport, requiresGps, permissionLevel, billable, exportRules). Centrala resolver-funktioner (`buildTimeCodeRuleMap`, `resolveTimeCodeRule`, `isRoleAllowedForTimeCode`) bor i `server/services/time-code-rules.ts` — enda källan, importeras av alla enforcement-punkter.

**Why:** flera helt olika ytor (löneexport, Fortnox-fakturering, veckoplanerarens personliga uppgifter, mobilens GPS-krav) behöver samma regeltolkning; en delad resolver med explicit fallback (payrollExport/economyExport=true, requiresGps=false, permissionLevel="all", billable=false) förhindrar drift mellan ytorna.

**How to apply:** `work_entries.entryType` (work/travel/setup/break/rest) är grövre än `time_code_definitions.key` — mappa via en delad `ENTRY_TYPE_TO_TIME_CODE`-konstant (finns idag duplicerad i `workSessions.ts` och `configRoutes.ts`; konsolidera till `time-code-rules.ts` om den rörs igen). Fortnox-export (`exportWorkOrderToFortnox` + `exportConsolidatedInvoiceToFortnox`) läser `workOrder.frozenTimeCode` och blockerar export fail-closed om `economyExport=false`. OB-tillägg är fortfarande helt manuellt (admin väljer OB-artikel/tidskod) — regelmotorn beräknar aldrig OB automatiskt.
