---
name: Objektmall-import diff/preview
description: Hur förhandsvisningens "Ändrad"-diff hålls i synk med vad commit faktiskt skriver
---

# Objektmall-importens fält-diff

Förhandsvisningen (validateAll) bygger en per-fält-diff (changedFields {field,label,from,to})
som måste spegla EXAKT vad commit-steget skriver till DB.

**Regel:** När ett nytt importfält börjar skrivas i commit måste det också läggas till i
diff-beräkningen i validateAll — annars säger förhandsvisningen "oförändrad" medan commit
ändrar värdet (eller tvärtom).

**Why:** "Ändrad"-markeringen och fält-diffen är användarens enda chans att granska före
skarp import. Drift mellan validering och commit = osynliga ändringar.

**How to apply (enflik-modell):** Adress/ort/postnummer/anteckningar/antal kärl ligger numera
som dynamiska metadata-kolumner (kolumn F+), inte fasta kolumner. De referensnamn som mappar
mot riktiga `objects`-kolumner extraheras via den DELADE helpern `extractKnownObjectFields(metadata)`
(case-insensitiv alias-matchning) i `server/routes/objektmallImportRoutes.ts`. Anropa SAMMA helper
i både validateAll (diff) och commitImport (skrivning) — lägg aldrig in inline-mappning på ena
sidan. Helt fria metadata-värden persisteras INTE (separat följd-task); de visas bara i
metadata-kartan och ingår inte i diffen. Tomma importceller bevaras och räknas aldrig som
ändring (matchar commitens partiella patch). Adress-arv från förälder sker på create när raden
saknar egen adress och på repoint från ny förälder — den deriverade arvs-adressen syns inte i
diffen (bara explicita fältändringar gör det).

## Metadata-referensnamn: tre format (klartext/kod/hybrid)
Rad-1-referensnamn kan vara klartext (`Gatuadress`), generisk kod (`22` = beteckning ELLER
visningsnummer) eller hybrid (`22:Gatuadress`). `parseMetadataRef()` delar på FÖRSTA kolon
(vänster=kod, höger=namn). Resolvern matchar kod mot katalog (beteckning→displayNumber); vid
konflikt mellan kod och namn VINNER koden (med varning). Okända koder/namn ger varning i
torrkörningen, blockerar inte. `extractKnownObjectFields` använder namn-delen även i hybridform.
Språkmärkta namnkolumner diffas som "Namn (lang)" och skrivs till `objects.nameTranslations`.
