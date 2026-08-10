---
name: Objektimport strikt matchning
description: Import 2.0 skriver ENDAST till tre kärnfält + metadatakatalogen; inga fallbacks/lazy-create.
---

Regel: Import 2.0 (`/api/import/objects-v2`) importerar ENDAST till objektets tre kärnfält (name, system_id, system_parent_id) + metadatakatalogen. Varje mappad kolumn måste spåras till exakt en AKTIV katalograd; omatchade kolumner med data, okända destinationer, saknade katalogfält och dubblettmål mot singelvärdesfält är BLOCKERANDE `column_errors` i valideringen — execute vägrar (ingen ack-förbigång).

**Why:** produktägarkrav — importen får aldrig hitta på fält eller tyst skriva legacy-objektkolumner; tidigare lazy-create i execute skapade katalogfält osynligt.

**How to apply:**
- `ensureKatalogRow` i execute får lazy-skapa/återställa ENDAST interna systemfält (interimsnummer, externt_id, kontaktperson, Objekttyp). Användarfält: arkiverad post kräver `restoreArchivedMetadataFields:true` i execute-bodyn (UI-checkbox), saknad post = hårt stopp (preflight + per-rad-säkerhetsnät).
- Explicit "Ignorera kolumn" = mappning `__empty`; kolumn helt utan mappning med data blockerar. Tester som postar egna mappningar måste mappa info-kolumner till `__empty`.
- Datatypvalidering i /validate använder samma `coerceMetadataVardeFromRaw` som skrivvägen (parity heltal/datum/boolean/allowedValues) — radfel gör raden invalid före import.
- Ren gate-logik: `computeStrictColumnErrors` i object-import-core.ts (enhetstestad utan DB). "typ" är alias för kanoniska "Objekttyp".
- Kolumn-cachen objects.objectType (klassificering) skrivs fortfarande — det är den sanktionerade enkelriktade cachen, inte primär lagring.
