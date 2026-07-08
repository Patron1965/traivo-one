---
name: Abonnemang 0-faktura & kvittning (net-zero-invariant)
description: Abonnemangstäckta uppgifter kvittas till netto 0 med en kvittningsartikel; net-0 enforced i två lager; fail-closed om artikel/Fortnox-mapping saknas.
---

# Abonnemang: 0-faktura & kvittning

En abonnemangskoncept fakturerar periodavgiften som intäkt. En uppgift som utförs UNDER
abonnemanget får ALDRIG dubbelfaktureras: när dess work_order slutförs läggs en NEGATIV
kvittningsrad (på tenantens kvitteringsartikel = `order_concepts.settlementArticleId`) som
nettar WO:n till exakt 0. Avgiften tas separat via abonnemanget.

## Regel
- WO markeras `subscriptionCovered` DIREKT vid kvittning/projektion (inte bara vid finalize),
  så guards skyddar oavsett vilken completion-väg (web `/status`, mobil sync, mobil orders/misc)
  som körde.
- Kvittningsraden är idempotent på ARTIKEL-ID (en befintlig negativ rad PÅ kvittningsartikeln
  = redan kvittad). Matcha ALDRIG "någon negativ rad" — en legitim kreditrad på en annan artikel
  skulle annars undertrycka kvittningen och lämna WO:n i netto ≠ 0.
- Net-0-invarianten enforced i TVÅ lager (defense-in-depth): (1) consolidation `woAmount()` ger 0
  för täckt WO (ingen positiv cachedValue-fallback); (2) fortnox-radbyggarens `enforceNetZero` kastar
  vid export om de byggda debiteringsraderna inte summerar till 0 (t.ex. om ett payer-artikelfilter
  eller en saknad mapping tappat kvittningsraden men behållit den positiva).

## Fail-closed
Saknas kvittningsartikel ELLER dess Fortnox-koppling → `invoiceBlockedReason` sätts
(`abonnemang_saknar_kvittningsartikel` / `kvittningsartikel_saknar_fortnox_koppling`),
`{settled:false}` returneras och finalize köar ALDRIG WO:n. Uppgiften stämplas
completed-men-ej-fakturerad och kan retrias när artikeln/kopplingen finns.

## Why
Utan kvittning skulle en täckt uppgift faktureras till fullt pris OCH abonnemangsavgiften tas ut
= dubbeldebitering. Två-lagers-invarianten gör dubbelfakturering omöjlig även om en enskild path
missar guarden.

## How to apply
Vid ändring av completion-vägar, consolidation-summeringen eller Fortnox-radbyggaren: bevara
BÅDA lagren i lockstep. Lägg aldrig till ett payer-/artikelfilter som kan droppa kvittningsraden
utan att också nolla den positiva. Kvittningsartikeln väljs per koncept i wizardens
abonnemangssteg (Step3Invoicing).
