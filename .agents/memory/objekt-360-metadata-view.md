---
name: Objekt-360 metadata-vy
description: Designkontrakt för objekt-detaljsidans metadata-flik (ObjectMetadataForm) — källa/arv-badge och Systemgenererat-kortet.
---

# Objekt-360 metadata-vy (ObjectMetadataForm)

Metadata-fliken på objekt-detaljsidan är en sammanhållen "360"-vy: vänster
områdesnavigering + höger områdesgrupperade kort, en KÄLLA/ARV-indikator med
legend, och ett separat read-only Systemgenererat-kort.

## KÄLLA/ARV-badge har exakt 5 kanoniska states
`Egen` (direkt) · `Ärvd` (ärvt) · `Ärvd men ändrad` (ärvt men lokalt
överskrivet) · `Systemgenererad` (system/tjänst/utförande-ursprung) ·
`Borttagen` (soft-deleted).

**Why:** produktägarens mockups + arkitektgranskning fastställde dessa fem som hela
sanningsmängden för hur ett metadatavärde uppstod. Att lägga till/ta bort ett
tillstånd ändrar användarens mentala modell av var data kommer ifrån.
**How to apply:** Återanvänd `MetadataSourceBadge`/`MetadataSourceLegend` när
metadata-ursprung visas någonstans; lägg inte till en sjätte färg/etikett utan
att uppdatera legenden i lockstep.

## "Systemgenererat"-kortet byggs ENBART från riktiga objekt-kolumner
Kortet visar bara fält som faktiskt finns på objektraden (objektnummer, skapad,
status, hierarkidjup, ursprung härlett ur importBatchId). Det är skilt från
system-*ursprungs*-metadata, som stannar kvar i sina vanliga områden och räknas
in i områdesräknarna.

**Why:** Arkitektkorrigering — tidigare utkast fabricerade fält som
"version"/"ändrad av"/tidsstämplar som inte finns i datan. Påhittade systemfält
ljuger för användaren.
**How to apply:** Lägg aldrig till en rad i Systemgenererat-kortet som inte
backas av en verklig kolumn/härledning. Behöver du fler systemfakta — exponera
en riktig kolumn först.
