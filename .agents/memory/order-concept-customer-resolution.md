---
name: Orderkoncept kund-härledning (HARDCODED vs FROM_METADATA)
description: Hur order-/faktureringskund resolvas per objekt vid koncept-expansion, och parity-regeln mellan /validate och /execute.
---

# Orderkoncept: order-/faktureringskund per objekt

Ett orderkoncept har `customerMode ∈ {HARDCODED, FROM_METADATA}`. Detta är
**order-/faktureringskunden** som snapshotas på `assignments.customerId` vid
expansion — INTE objektägarskap (`object_payers`, ADR v3). De två får aldrig blandas.

- **HARDCODED**: alla rader stämplas med `concept.customerId`.
- **FROM_METADATA**: kund härleds per objekt från `concept.customerMetadataField`,
  som är en nyckel i den **svenska** katalogen (`metadata_katalog.namn`) — inte ett
  engelskt `metadata_definitions.fieldKey`. Värdet läses ärvningsmedvetet via
  `getArticleMetadataForObject(objectId, field, tenantId)` (objekt saknar `.metadata`
  i koncept-/fortnox-flöden). Matchning är EXAKT: först kundnummer, sedan
  case-insensitivt namn. Inget fuzzy. Resolver: `server/services/concept-customer-resolver.ts`.

## Parity-regel: /validate måste spegla /execute EXAKT

**Regel:** FROM_METADATA-kundvalideringen i `/validate` (orderConceptRoutes) måste
gate:as på exakt samma metoder som execution kör pre-passet för. Execution
(`prepareConceptCustomerPricing` i fortnoxRoutes) kör pre-passet med
`runPrePass: conceptMethod !== "subscription"` → **subscription är undantaget**.
Validate måste därför också hoppa över FROM_METADATA-felen för subscription
(`validateMethod !== "subscription"`).

**Why:** Annars kan ett subscription-koncept rapporteras ogiltigt av /validate
trots att /execute skulle köra utan att skapa några assignments. Architect fångade
denna drift (Task #937). Samma princip som "delad resolver = preview==execute".

**How to apply:** Vid ändring av vilka metoder execution pre-passar (eller om
subscription någon gång ska tvinga kund-härledning), uppdatera BÅDA ställena i
lockstep. Whitespace-only fält = "inget fält valt" på båda ställen (trimma före
tom-kontroll, matchar resolverns `no_field`).

## Pre-pass: fail-before-write

Non-subscription FROM_METADATA: pre-passet resolvar ALLA matchande objekt och
kastar `ValidationError` FÖRE någon DB-skrivning om något objekt inte kan
resolveras (missing_value/unmatched/ambiguous/no_field). Objektlösa
admin/logistik-artiklar hoppas över + räknas under FROM_METADATA (uppfinner
aldrig en kund). Samma matchande-objekt-mängd (`resolveConceptMatchingObjects`)
används i validate och execute.
