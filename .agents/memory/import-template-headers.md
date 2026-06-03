---
name: Importmall-headers ↔ import-matchning
description: Genererade Excel-importmall-headers måste härledas med samma regel som importens kolumn-matchning, annars matchar inte kolumnerna.
---

# Importmall-headers måste matcha importens kolumn-uppslag

Namngivna importmallar (admin väljer metadata-katalogfält → systemet genererar
en objektmall-Excel) lagrar **katalog-ID:n** (`import_templates.fieldIds`), inte
färdiga header-strängar. Headern härleds vid generering.

**Regel:** Header för ett fält = `deriveMetadataDotKey(type, byId) ?? type.namn`
(dvs. punktnotation `förälder.barn` för underfält, annars `namn`). Detta är
exakt samma regel som `buildMetadataTypeLookup` (`server/metadata-queries.ts`)
använder när importen matchar en CSV/Excel-kolumn-header mot ett katalogfält.

**Why:** Om generatorn och importens lookup härleder header olika (t.ex. en lagrar
`namn` och den andra punktnotation) hamnar kolumnerna fel eller ignoreras tyst vid
import — mallen ser korrekt ut men datan landar inte. Att lagra ID och härleda
vid gen-tid (i stället för att frysa header-strängen) gör att mallar också följer
med när katalogfält döps om.

**How to apply:** Använd `resolveTemplateFieldHeaders(tenantId, fieldIds)` som
enda källa för header-härledning vid mall-generering. Raderade/okända ID:n hoppas
tyst över; dubblett-headers filtreras (case-insensitivt). Om matchningsregeln i
`buildMetadataTypeLookup` någonsin ändras måste `resolveTemplateFieldHeaders`
ändras i lockstep.
