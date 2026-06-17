---
name: Orderkoncept fakturanivå (kundnivå vs fakturastopp)
description: Hur Step 3 fakturanivå kollapsades till kundnivå/fakturastopp, att invoiceLevel är dött, och hur de två lägena mappas på befintliga kolumner utan migration.
---

# Orderkoncept: fakturanivå = kundnivå ELLER fakturastopp

De tre hårdkodade fakturanivåerna (områdes-/fastighets-/kundnivå) togs bort från
wizardens Step 3. Nu finns bara två lägen:

- **Kundnivå** (default): fakturan rullar upp till kunden (en mottagare).
- **Fakturastopp** (samlingsfaktura): delar upp fakturan *organisatoriskt* via ett
  metadata-villkor + en faktureringsfrekvens. **Samma kund hela vägen** — fakturastopp
  ändrar aldrig *vem* som faktureras, bara hur fakturorna grupperas.

## Mappning på befintliga kolumner (INGEN migration)
- `invoiceLevel` är **dött**: wizarden persisterar alltid `"customer"`. Återinför aldrig
  operatörsstyrning av detta fält.
- Fakturanivå *härleds* från `invoiceConsolidation`:
  - `"customer"` (eller legacy `"per_job"`) ⇒ kundnivå.
  - allt annat ⇒ fakturastopp, där värdet ÄR frekvensen (`daily`/`weekly`/`monthly`/`after_completed`).
- `departmentMetadataField` = metadata-`fieldKey` att dela på (bara satt vid fakturastopp).
- `isFakturastopp = invoiceConsolidation !== "customer" && !== "per_job"` — samma
  derivering på både klient (Step3Invoicing) och i `buildConceptPatch`.

## Kanonisering vid persistering
Persisteringen kanoniseras i `buildConceptPatch` (OrderConceptWizardPage), inte bara i
state-default: kundnivå ⇒ `invoiceConsolidation="customer"` + `departmentMetadataField=null`;
fakturastopp ⇒ giltig frekvens (legacy `"department"`/okänt normaliseras till `"monthly"`).

**Why:** Annars sparade default-kundnivå råa state-värdet (t.ex. legacy `"per_job"`/`"department"`)
och bröt kontraktet "kundnivå = customer". Kanonisering i patchen gör lagringen robust
oavsett legacy-värden i in-memory state.

## Validate-routen
`/api/order-concepts/:id/validate` tappade `NO_INVOICE_LEVEL`,
`INVOICE_LEVEL_HINT_CONFLICT` och `NO_INVOICE_RECIPIENT` (falsk "Ingen fakturamottagare
i kundhierarkin") och skickar `hintLevel:null` till `resolveInvoiceRecipient`. Den
**riktiga** spärren `INVOICE_RECIPIENT_CONFLICT` (lika prioritet på samma nivå) finns kvar.

**Why:** Med en enda kund finns ingen nivå-hint längre, så hint-baserade varningar var
alltid falska. `resolveInvoiceRecipient(..., hintLevel:null)` ger `hintConflict=false`.

## Viktig lucka (runtime)
`orderConcepts.invoiceConsolidation`/`departmentMetadataField` läses idag INTE av någon
schemaläggare. Consolidation-schemaläggaren jobbar på `work_orders.invoiceQueueState` +
`invoiceConsolidationPolicies`. Att konfigurera ett fakturastopp på ett koncept har alltså
ännu **ingen runtime-effekt** — split-pipelinen var explicit out-of-scope.
