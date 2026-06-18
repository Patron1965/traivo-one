---
name: Fortnox fakturarad-text parity (enskild == konsoliderad)
description: Varför fakturaraders bastext måste byggas via en enda delad helper, och vad som aldrig får bakas in i radtexten.
---

# Fakturarad-text: enskild och konsoliderad export MÅSTE ge identisk radtext

Berikade Fortnox-fakturarader (objektnamn, adress, fasadnr, kärlnr, fraktion,
utförandedatum) byggs av en DELAD resolver + formatterare i
`server/services/invoice-line-enrichment.ts`:
`formatEnrichedDescription(buildInvoiceLineBaseText(line, {useFrozen?}), refs)`.

## Regeln
- ALLA radbyggande call-sites måste gå via `buildInvoiceLineBaseText` för bastexten.
  Det finns fyra i `server/fortnox-client.ts`: enskild fritext, enskild artikel,
  konsoliderad fritext, konsoliderad artikel.
- `buildInvoiceLineBaseText` får ALDRIG bädda in WO-titel/id. Bastext-precedens:
  fritextrad (ingen artikel) = `description || notes || "Fritextrad"`;
  artikelrad = `notes || (useFrozen ? "Fryst pris (audit-snapshot)" : undefined)`.
- Kundreferens är HEADER-ONLY (Fortnox `YourReference`, max 50 tecken) — exkluderas
  medvetet ur `buildRefSegments`, syns aldrig i radtext.

**Why:** Konsoliderad export föll tidigare tillbaka på `${wo.title} (${id})` som
bastext medan enskild använde notes/"Fritextrad"/frozen-markör/undefined. Samma
WO-rad fick då OLIKA text i de två vägarna — exakt det Task #1025 skulle förhindra.
Objektidentifieringen som WO-titeln gav ersätts nu av objektreferenserna
("Objekt: … · Adress: …"), så fallbacken kunde tas bort utan informationsförlust.

**How to apply:** Lägg aldrig till en ny fakturarad-exportväg (eller preview som
ska "spegla utskicket") utan att bygga bastexten via `buildInvoiceLineBaseText`.
Återinför aldrig WO-titel/id i radtexten. Förhandsvisningens `enriched`-flagga
(orderConceptRoutes) styr om InvoicingPage döljer den separata adress-underraden —
sätt den till `Boolean(refs.adress)`, inte hårdkodat true, annars göms en adress
(från objektets adress-kolumn) som inte faktiskt bakats in i radtexten (metadata).
