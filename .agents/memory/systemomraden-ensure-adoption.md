---
name: Systemområden adopt-or-create
description: Semantik för systemområdes-seedningen av metadata_katalog (Etapp 2) och vad den aldrig får röra.
---
Systemområdesfälten (Ekonomi/Kontakt/Åtkomst/Tid/Individ/Kärl/Bild) seedas per tenant via en idempotent adopt-or-create-ensure som körs best-effort på GET /api/metadata/types + explicit på POST /types/seed.

**Regler:**
- Matchning: case-insensitive på namn bland AKTIVA rader (deleted_at IS NULL). Arkiverade rader återupplivas aldrig — ny kanonisk rad skapas i stället.
- Adoption muterar endast strukturflaggor: sätter systemlast/area/sort_order/parentKey, fyller referens_tabell om null, flippar allowDuplicates bara false→true, adoptIsSystem för utvalda fält. Rör ALDRIG namn, datatyp eller metadata_varden.
- Fail-safe: >1 aktiv rad med samma namn = conflict + skip; Kontakt-underfält som redan pekar på annan förälder = skip (ingen ompekning). Konflikter rapporteras, inget muteras tyst.
- Föräldrar måste listas före barn i fältdefinitionslistan (idByKey-map byggs sekventiellt).

**Why:** kunddata i katalogen får aldrig skrivas över av seed (insert-only-konstraint för befintliga tenants); konflikt-skip förhindrar tyst datakorruption.

**How to apply:** nya systemfält läggs i SYSTEMOMRADEN_FALT (server/metadata-queries.ts); flaggändringar på redan seedade fält når befintliga tenants ENDAST via explicit idempotent backfill (samma mönster som metadata-seed-backfill.md). UI-låset i tenant-config visar bara isSystem — systemlast-fält ser redigerbara ut men servern (kpiRoutes) blockerar PATCH/DELETE.
