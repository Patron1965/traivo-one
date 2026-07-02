---
name: Uppgiftslogik v1 scope-beslut
description: Produktägarens beslut om fakturalås, fastpris-nivåer, geografi, abonnemang och taget antal — v1 vs v2 scope. Framtida arbete måste vara konsistent med dessa.
---

Beslut fattade av produktägaren vid genomgången av "Uppgiftslogik/informationspaket"-matrisen (kolumner A–CJ) + de 9 motorerna. Detta är SCOPE-beslut, inte implementation. Respektera dem tills produktägaren ändrar dem.

## 1. Fakturalås — slå ihop BY + CE till ETT fält
Matrisens BY ("allt måste vara klart, ej delleverans, för fakturaskapande") och CE ("fakturalåsning, allt slutfört innan faktura skapas/släpps") är samma regel → **ett fält**.
Lås på **orderkonceptets uppgiftslista per objekt** (hela beställningen från orderkonceptet).
**Öppen delfråga produktägaren kastade tillbaka:** definitionen av "vad är vad" när ETT orderkoncept skapar FLERA fakturor — vad utgör då "allt klart"-enheten (hela ordern vs per faktura-referens/objekt).
**Why:** eliminera redundanta fält som säger samma sak; undvik faktura som släpps innan jobbet är klart.

## 2. Fastpris finns på TVÅ nivåer, båda = efterfakturering
- **Artikelnivå** (artikelns debiteringsmodell / fastpris) OCH **ordernivå** (hela ordern ett fast pris, t.ex. 200 000 kr för renovering av 5 stugor oavsett antal rum/objekt).
- Båda betraktas som **efterfakturering** (arrears), fast pris ≠ dynamiskt pris. När fakturan skickas är en smaksak för användaren.
- Ordernivå-fastpris → efterkalkyl (tid+materialredovisning) för lönsamhetsanalys.
- **Redan i koden:** `fixed_price_basis = per_concept` motsvarar ordernivå-fastpris; `per_object`/`per_task` motsvarar artikel/objekt-nivå. Bygg vidare på detta, inför inte parallell modell.
**Why:** ordernivå-fastpris (paketpris för hel order över flera objekt) är ett distinkt fall från artikel-fastpris.

## 3. Geografi — punkt räcker för v1, förbered v2 utan att låsa fast
- v1: pinpointad port-/adressposition räcker. **Prioritera INTE yta/linje nu.**
- v2.0: system måste kunna hantera **yta** (polyyta) och **linje** (polylinje, t.ex. gasledning flera mil).
- Produktägarens modell: geografi uttrycks via **metadatafält** (numeriska/alfanumeriska/bilder). Frågan för oss: hur definierar man ett metadatafält som polylinje/polyyta INOM befintlig metadatalogik. Yta/linje hanteras positionellt via **tyngdpunkt/representativ position**.
**Why:** får inte bygga in en låsning som gör att systemet bara kan hantera pinpoint-adresser och slår i taket senare.

## 4. Abonnemang (motor 5) — motorn byggs SENARE, men artikel-taggning behövs nu
- **Abonnemangsmotorn utvecklas INTE i v1** (separat UI/modul senare).
- MEN orderkonceptet ska kunna **skapa/definiera artiklar som ingår i abonnemang** nu (matrisens W "Artikel ingår i abonnemang").
- Modell för senare: månadsfaktura via en **fast artikel** (kontering som kundfordran i Fortnox); när abonnemangsuppgift slutförs sammanställs den på ett **avräkningsunderlag med kvittningsartikel** → nollfaktura till kund (kund ser utfört arbete, antal stämmer, kostar 0) + nollar kundfordran i ekonomisystemet. Statistik (antal producerade artiklar) mäts ALLTID oavsett abonnemang — abonnemang styr bara NÄR/HUR betalt.
- Kvittningsartikelns scope (global per tenant vs per abonnemang) är fortfarande öppen men **ej blockerande** eftersom motorn är deferrad.
**Why:** v1 behöver bara kunna märka abonnemangsartiklar; den affärslogiska motorn är ett eget senare projekt.

## 5. Taget antal (kolumn T) — INFÖR, och det påverkar lager (ej bara logg)
Antalskedja (prioritet lägst→högst): planerat antal på orderkoncept → matchat från objekt-metadatafält (artikelnivå) → utförarens verkliga antal (uppdaterar både metadata OCH ordervärde). Lås via "får ändras"-flagga på artikel-/konceptnivå.
**Taget antal ≥ fakturerat/levererat antal.** Differensen = svinn/förbrukning som träffar lagret men INTE fakturan.
- Underförbrukning: plockat 10, använt/levererat 8 → fakturera 8, **2 återförs till lagret**.
- Svinn/skada: taget 2 extra som slarvats bort/skadats → redovisas som **förbrukning på ordern mot ekonomi- + lagersystem ("vi tar dem"), faktureras EJ**.
- Hänger ihop med motor 7 (fysiska artiklar): överskott ska tillbaka till lager (serviceföretag vill inte ha sidolager i servicebilar = obetalt kapital).
- Utförarappen: sista antalet gäller i huvudvyn; **expansionsfunktion** för att se historik / justera taget antal (ej plats för 5 antal på telefonskärm).
**Why:** standardlogik i svenska service-/teknikaffärssystem; behövs för korrekt fakturering + lagersaldo när verkligt åtgångsantal ≠ planerat.

## 6. Genomgång 2026-07-02 → utvecklingslogg
Produktägaren gick punkt-för-punkt genom uppgiftsmodell-analysen (två röst-sessioner + Excel-matrisen) och bekräftade/utvecklade. Fullständiga beslut + parkerat framtida arbete ligger i **`docs/uppgiftslogik-utvecklingslogg.md`**. Nyckelbeslut att vara konsistent med:
- **Allt är uppgifter** byggda av artiklar; produktion/restid/egentid/spilltid = olika uppgiftstyper med olika utförandekod. Egentid/restid/personal → **rapporter, inte fakturor**.
- **Över- + underbokning slås ihop** till ETT koncept ("spilltid", namn ej spikat). Överlappningsregel: **endast egentid** får överlappas; produktionstid och restid **aldrig**. Systemet **bokar inte** i v1 (manuell planerare, ingen inlärning); auto-/AI-bokning är deferrad.
- **Ej-utförd orsak** = systemskapad metadata på objektet (orsak + ursprung + tidpunkt) + filter/rapport.
- **Kontering:** team + kostnadsställe + projekt måste följa med i uppgiftens informationspaket → fakturan (föds ur team-uppsättningen).
- **Leveranstider** = INTE en "trio" utan N tidsfönster (hård/mjuk, positiv/negativ) + SLA-trendvarning.
- **Deferrade motorer (utvecklingslogg):** kapacitets-/fyllnadsmotor (vatten/lakvatten/avfall), arbetstids-/lönemodul (flextidsbank/beordrad övertid/tidskoder, steg 2), geografisk yta/linje-motor, tvåstegs-navigation i fältappen, metadata på fakturarad.
- **Tids- & statushistorik (tillägg 2026-07-02, utvecklingslogg §4 U8):** produktägaren vill ha en frågbar **append-only** logg över uppgiftens tidsdimensioner (önskad/planerad/kalkylerad/verkligt utfall) + **varje** statusövergång med tidsstämpel + dwell-tid + antal **återgångar** (finplanering↔grovplanering). VIKTIGT: milstolpe-tidsstämplar finns redan på `work_orders`/`assignments` (onWayAt/onSiteAt/completedAt/startedAt/actualDuration…) men de är **enkelvärda och skrivs över** → kan ej räkna bounces/dwell. Nytt = händelselogg + genomloppstids-/tidsdriftsanalys (kalkyl vs utfall per utförarkod/team).
**Why:** produktägaren betonade att grunderna inte får ha frågetecken och bad uttryckligen om en utvecklingslogg för senare bygge.
