---
name: Fältappen HAR redigerbart antal (metadata-drivet)
description: Traivo Go (SimpleFieldApp) har ett redigerbart antals-fält per orderrad, men bara för metadata-drivet antal. Ersätter den gamla "saknar antalsfält"-noten.
---

Traivo Go (`client/src/components/SimpleFieldApp.tsx`, "Beställda artiklar"-kortet) **har** ett redigerbart antals-fält per orderrad — men ENDAST när antalet är metadata-drivet. Övriga rader visas read-only ("Fast antal" eller bara siffran).

**Redigerbart när (server-beräknad `editableQuantity` i metadata-context `orderArticles[]`):** ordern ej fakturalåst (ej `consolidated`/`exported`/`consolidationInvoiceId`), artikeln aktiv, `!hideQuantityInApp`, `quantityMode` använder objekt-metadata (`per_styck`/`matches_field`, via `usesQuantityMetadata`) OCH `quantityMetadataField` är satt. Formel-läge och fasta antal = read-only.

**Endpoint:** `POST /api/mobile/tasks/:id/quantity-update` (`server/routes/mobile/misc.ts`, `isMobileAuthenticated`). IDOR-skydd via ägd order (`order.resourceId === resourceId`); tenant härleds ur ordern (aldrig `req.tenantId` — bypassad mobil-yta). Skriver i ordning: (1) objektets antals-metadatafält FÖRST (`writeArticleMetadataOnObject`, metod `utforande` → auto-ursprung + historik; framtida expansioner ärver), (2) orderraden (`updateWorkOrderLine` → recalc av ordertotaler), (3) audit-rad i `taskMetadataUpdates`. Ingen delad DB-tx; metadata-skrivning är värde-idempotent så avbrott konvergerar vid nytt försök.

**Why:** Detta löser exakt fältarbetarens "justera antalet + antals-metadatan i appen" (t.ex. pantkärl: objektets `antal_karl` driver expansionen → 1 uppgift med antal N → operatören rättar N i fält). Funktionen byggdes efter att den tidigare noten ("fältappen saknar antalsfält") skrevs — den noten var stale och felaktig.

**How to apply:** App-sidans lås-spak är `hideQuantityInApp` (= "Fast antal", read-only), parallellt med webbens `operatorCanUpdateQuantity` (`workOrderRoutes.ts` rad-qty PATCH, roll-gatead). De två flaggorna är ömsesidigt uteslutande i artikelformuläret. Mobil-endpointen gateaer på `hideQuantityInApp` + metadata-drivet läge — INTE på `operatorCanUpdateQuantity`/roll (avsiktligt: fältrapportering av faktiskt antal). Vill man göra FAST antal redigerbart i appen är det ny scope.
