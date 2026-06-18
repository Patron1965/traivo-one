---
name: Frozen tidsregel-paket (Tidsmotor)
description: Hur viktade tidsregler fryses vid expansion och matas in i optimeraren; hård vs mjuk-beslutet.
---

# Frozen tidsregel-paket (Tidsmotor)

Orderkoncept-restriktioner (`order_concepts.delivery_restrictions`, modell i
`shared/delivery-restrictions.ts`) bär `enforcement: "hard"|"soft"` +
`polarity: "positive"|"negative"` + `weight`. Vid expansion fryses HELA det
viktade paketet per objekt på uppgiften (`frozen_time_rules` jsonb på både
`assignments` och `work_orders`).

## Hård vs mjuk — kärnbeslutet
**Hårda regler fryses ENDAST (snapshot), de injiceras INTE nytt i VRP.** De
"fortsätter blockera som idag" via befintliga `time_windows`-mekanismer
(`applyTimeRestrictions`/`applyTaskTimewindows` i `server/vrp-constraints.ts`).
Endast MJUKA regler får den nya optimerar-injektionen: en begränsad
prioritetsjustering (`softPriorityDelta(softPreferenceScore(pkg, weekday))`,
±SOFT_PRIORITY_CAP=20, SOFT_PRIORITY_UNIT=5 ⇒ speglar befintlig +5/preferens).
**Why:** undvika dubbelräkning av hårda begränsningar och behålla nuvarande
hård-blockering oförändrad.
**How to apply:** rör aldrig hård-grenen i optimeraren när du jobbar med
tidsregler; lägg bara på `pkg.soft`.

## Frys-omfattning (scope-beslut, drift)
Frysning sker bara på HUVUDLEVERANS-uppgifterna (call_off-loop + scheduled i
`server/routes/fortnoxRoutes.ts`), INTE på föruppgifter eller hämt-uppgifter
(pickup). De har avsiktligt förskjuten timing (offset/ledtid) och delar inte
leveransfönstrets preferens.
**How to apply:** om en framtida task vill frysa fler uppgiftstyper, lägg till
stämpling där men inse att soft-poängen utgår från leveransdagens veckodag.

## Konsistens-regel (frys ⇄ display ⇄ optimering)
Villkors-utvärderingen MÅSTE använda samma `matchesFilter` + `meta[r.metadataKey]`
(ingen baskolumn-fallback) som `delivery-restriction-notes` och steg-4-inpekningen.
Optimeraren live-härleder paket per objekt när uppgiften saknar fryst paket
(work_orders fryses inte vid expansion → `computeTimeRulePackagesByObject`).
Veckodag: 0=Sön…6=Lör (JS `getDay()`), samma som `weekdays`-fältet.
