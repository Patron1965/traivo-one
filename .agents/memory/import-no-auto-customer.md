---
name: Ingen auto-kund vid import + kund-proveniens
description: Import kopplar aldrig kund automatiskt; Kund-metadatans skapad_av bär proveniens (system=legacy-fallback städbar, explicit-origins röres aldrig)
---

Regel: objektimport får ALDRIG auto-koppla en kund — "första aktiva kund i tenant"-fallbacken är borttagen. Kund skrivs endast vid uttryckligt val (vald kund vid körningen eller per-rad-mappad kundkolumn); kundlös interim-identitet stöds (tomt kundsegment i nyckeln).

**Proveniens:** kund-metadatarradens `skapad_av` bär ursprung: `system` = legacy auto-fallback (den enda som får städas), medan uttryckliga vägar stämplar en explicit origin (import/portal/user/copy/seed). `metod` sätts till `import` för import-origins (badge "Importerad") och `system` för övriga — badge-mappningen bor i shared/metadata-origin.ts; gamla import-explicit-rader med metod='system' restampas via cleanup-skriptets `--restamp`. Origin-parametern är avsiktligt obligatorisk så nya writes aldrig tyst defaultar till `system`.

**Why:** legacy-fallbacken fabricerade kundkopplingar; utan proveniens kan städverktyg inte skilja fallback från legitima explicita kopplingar — reviews avvisade städning som saknade den diskriminatorn.

**How to apply:** varje ny write-väg som kopplar kund måste skicka korrekt explicit origin. Städning av rader skrivna FÖRE stämpeln kräver uttrycklig avgränsning (tenant + känd fallback-kund) och dry-run-granskning med reversibel backup innan skarp radering.
