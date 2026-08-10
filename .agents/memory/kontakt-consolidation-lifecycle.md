---
name: Kontaktkort & metadata-livscykel
description: Kontaktfamiljen (area='kontakt') visas ENBART i kontaktkortet; radering/arkivering/anonymisering är tre separata flöden med serverspärrar.
---

- Kontaktfamiljen (katalog `area='kontakt'`: Namn/Titel/Telefon/E-post) renderas ALDRIG som lösa metadatarader i objektsidans grid (`ObjectMetadataBody` filtrerar `entryAreaKey==='kontakt'`); huvudvisning = Kontakt-kortet (ObjectDomainGrid → DomainCarouselCard) med redigering/kopiering.
- Kontakter paras per underfälts-index i KRONOLOGISK ordning (created_at, sedan id); redigering är rad-exakt via per-underfälts vardenId. Strukturella ändringar (lägga till saknat underfält/tömma) tillåts BARA när objektet har exakt en kontakt — annars kan indexparningen flytta värdet till fel kontakt (ingen instans-identifierare finns ännu).
- Fältinställningar (Settings2) döljs i MetadataCarousel för kontaktfält — definitionen styrs endast centralt.
- Tömning av kontaktunderfält i kortet = ARKIVERING (fält-endpointen), aldrig hård delete — även "fri" hård delete skriver historik+raderar permanent.
- Värde-mutationer (POST/PUT/inheritance/order/arkiv/restore/WO-metadata /api/metadata*) är requireMember (owner/admin/planner/technician/user — vanliga användare FÅR lägga till godkända fält); katalogdefinitioner + hård DELETE /:id är requireAdmin; viewer/customer/reporter nekas. UI-gating är inte auktorisation.
- Clerk getAuth() kastar om clerkMiddleware saknas (isolerade test-appar) — tenant-middleware använder safeGetAuth → 401 istället för hängning/500.
- Spärr-utvärdering + delete körs atomiskt i EN FOR UPDATE-tx (deleteMetadataGuarded) — pre-check utanför tx:n är race-bar mot samtidig update-historik.
- Livscykel: hård DELETE /api/metadata/:id spärras (409 USE_ARCHIVE) när `metadata_historik` har rader med `gammalt_varde IS NOT NULL` (rena skapande-rader blockerar inte) eller konceptfilter-kopplingar; arkivering = softDelete (bevarar allt); anonymisering vägrar katalognamn 'interimsnummer'/'interimnummer' (403) — interim är matchningsnyckel, ej personuppgift.

**Why:** annars dubblerad kontaktvisning, oklara raderingssemantiker och risk att interim-nyckeln förstörs av GDPR-flödet.
**How to apply:** nya raderings-/anonymiseringsytor måste återanvända samma serverspärrar; nya kontaktytor läser kontaktkortets endpoint, inte råa metadatarader.
