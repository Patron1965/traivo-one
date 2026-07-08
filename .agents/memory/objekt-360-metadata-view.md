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

## PO-förtydliganden objektform-ombygge (bekräftade)
Från produktägarens handskrivna designnoteringar på objektformuläret (bekräftade):
- **Ta bort legacy icke-metadata-element i huvudet:** "Fastighet"-typetiketten och
  "Vinjettbild"-rutan är gamla lösningar utan metadatakoppling → tas bort. Städa
  huvudet så primär förälder OCH underordnade barn syns tydligt.
- **Ta bort felplacerade/dubbla rutor:** "Importera underobjekt" (import görs på
  annan yta) och "Arkivering" (finns redan i huvudets status/historik).
- **Navigering:** ta bort dagens menyrad (Huvud/Metadata/Kopplade uppgifter) +
  vänster sidolista; ersätt med snabbmeny i huvudet → metadataområde + uppgiftslista
  (fortsatt ankar-scroll enligt arvsmodellen).
- **Metadata-historik slås ihop per fält:** ingen egen historik-ruta; ändringar
  visas per fält, nyast först, med datum + källa.
- **Fält-FAMILJ = ett kort:** ett kompositfält (punktnotation, t.ex. Kontakt =
  namn/titel/tel/e-post) presenteras som EN grupp på ETT karusellkort; hela
  familjen följer "huvudet". Se composite-metadata-import.md.
- **"+"-lägg-till-fält:** öppnar en SÖKBAR + typ-SORTERBAR fältlista (t.ex. bilder,
  kontaktuppgifter); ny rads datatyp (text/siffra/bild) styrs av fältets definition.
- **Komplettera/ändra/radera** endast "där det är tillåtet" (respektera guards:
  ärvda/legacy/system-origin fält ska ej fritt raderas).
- **Kontakter, geografi och bildmetadata** följer samma karusell-logik.
- **Kopplade uppgifter/orderkoncept/snabbordrar:** filtrerbar vy à la
  grovplanering/masterplanering, filtrerbar på alla 94 informationspaket-fält.
