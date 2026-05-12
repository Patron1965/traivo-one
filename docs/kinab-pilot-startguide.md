# Kinab pilot — Startguide för parallelldrift mot Modus

**Syfte:** Kom igång med Traivo-planering för **en kund** parallellt med Modus, utan att involvera tekniker eller påverka kund. Det här dokumentet är en checklista du följer i ordning från topp till botten.

**Scope för pilot:**
- Fokus: planering (WeekPlanner + VRP) för en kund
- Utförande: sker fortsatt via Modus
- Tekniker involveras: nej
- Kund märker: ingenting

---

## Fas 0 — Förberedelser (innan dag 1)

### 0.1 Bestäm pilotkund
Välj **en** kund som uppfyller:

- [ ] 20–100 ordrar/vecka (lagom mängd för att VRP ska bli meningsfull)
- [ ] Fasta tömningsintervall, stabila adresser (förutsägbar)
- [ ] Geografiskt sammanhängande område
- [ ] Inte er största/känsligaste kund (tålig om något skiftar)

**Vald kund:** ____________________________

**Antal förväntade ordrar/vecka:** ____________________________

### 0.2 Definiera mål med pilot
Skriv ner 1–2 konkreta frågor ni vill få svar på:

1. ____________________________________________________________
2. ____________________________________________________________

Exempel:
- *"Hittar Traivos VRP en bättre rutt än vi gör manuellt för Kund X?"*
- *"Hur mycket snabbare blir planeraren när hen lägger en hel kunds vecka?"*

### 0.3 Skriv ner sanningskällor
Sätt upp på A4 i planeringsrummet:

> **Modus** = sanning för fakturering, kundregister, avtal
> **Fortnox** = master för kund-grunddata
> **Traivo** = sanning för planering & utförande av pilotkundens ordrar
> **Synkriktning:** Modus + Fortnox → Traivo. Aldrig tillbaka under pilot.

---

## Fas 1 — Datagrund (vecka -2 till -1 innan pilotstart)

### 1.1 Aktivera Fortnox-integrationen
Fortnox blir master för kundregister.

- [ ] Verifiera att Fortnox-connectorn är aktiverad i Kinab-tenanten (finns redan installerad i miljön)
- [ ] Authentisera Fortnox-API mot kinabs konto (OAuth-flöde via integrations-skill)
- [ ] **Torrkörning först:** hämta ner 5–10 kunder till en staging-vy och titta igenom manuellt
  - [ ] Inga inaktuella/inaktiva kunder som följer med?
  - [ ] Adresserna är fysiska (inte bara postbox/c-o)?
  - [ ] Inga dubbletter (samma kund i två Fortnox-poster)?
- [ ] När torrkörning ser ren ut: kör **full kundimport** från Fortnox
- [ ] Verifiera att pilotkunden finns i Traivo med rätt orgnr

**OBS:** Importera **inte** dev-miljöns kundlista. Den innehåller seedad/syntetisk data och blir omedelbart inaktuell. Börja med tom kundtabell i prod, låt Fortnox fylla på.

### 1.2 Importera pilotkundens objekt via Modus 2.0
- [ ] Kör Modus 2.0-importen för pilotkundens objekt + kärl + tömningsintervall
- [ ] Verifiera matchning mot Fortnox-kund via orgnr/kundnummer
- [ ] Stickprov: öppna 5 objekt slumpmässigt och verifiera mot Modus

### 1.3 Datatvätt på pilotkunden
Lägg en halv dag på det här innan första planeringsveckan. Det betalar tillbaka sig 10x.

- [ ] **Geokodning:** alla pilotkundens objekt ligger på rätt plats på kartan
  - [ ] Öppna kartvyn, filtrera på kund, leta efter "udda" prickar (mitt i havet, fel stad)
- [ ] **Tömningsintervall** korrekt på varje objekt (varje vecka, varannan, månadsvis…)
- [ ] **Kärlstorlek/typ** ifyllt
- [ ] **Tidsfönster** (öppettider, "ej före 07:00" etc) inlagda där de finns
- [ ] **Servicetid per stopp** realistisk — kalibrera mot Modus-historik om möjligt
- [ ] **Leveranspreferenser** (Traivos `resolveDeliveryPreferences`) korrekta

### 1.4 Sätt upp pilot-flagga (rekommenderad)
- [ ] Markera pilotkundens ordrar med ett tydligt filter eller tagg så ni kan sortera ut dem från övriga 3 313 ordrar i systemet
- [ ] Verifiera att kund-filter i WeekPlanner fungerar (annars beställ som task)

### 1.5 Förbered jämförelseunderlag
- [ ] Skapa ett enkelt Excel/Sheets-ark "Pilot vecka X" med kolumner:
  - Vecka
  - Antal stopp (Traivo / Modus / verkligt utfört)
  - Total körsträcka (Traivo / Modus)
  - Total körtid (Traivo / Modus)
  - Avvikelser (fritext)
  - Planeringstid (minuter)
- [ ] Spara mall så ni återanvänder den varje fredag

---

## Fas 2 — Torrövning (vecka -1)

Innan ni går skarpt: planera samma vecka i båda systemen utan att påverka utförandet.

- [ ] Måndag: lägg pilotkundens vecka i Traivo (utan att skicka ut den)
- [ ] Samma vecka: notera vad Modus skulle ha planerat
- [ ] Jämför sida vid sida:
  - [ ] Hittar Traivos VRP samma rutter som planeraren manuellt skulle gjort?
  - [ ] Är ETA:erna realistiska?
  - [ ] Saknas några kunder/objekt i importen?
  - [ ] Föreslår systemet stopp i fel ordning baserat på lokal kunskap?
- [ ] Dokumentera 3 saker som funkade bra
- [ ] Dokumentera 3 saker som behöver justeras

**Beslutspunkt:** Är torrövningen tillräckligt bra för att gå skarpt nästa vecka?
- [ ] **Ja** → Fas 3
- [ ] **Nej** → Fixa avvikelserna, kör torrövning igen

---

## Fas 3 — Pilot vecka 1 (skarpt läge)

### 3.1 Veckorutin

**Måndag morgon (1–2 timmar):**
- [ ] Planera pilotkundens vecka i Traivo
- [ ] Lägg in motsvarande planering i Modus (manuellt eller via export)
- [ ] Notera planeringstid i jämförelsearket

**Tisdag–torsdag (5 min/dag):**
- [ ] Kort koll: matchar dagens utförande planeringen?
- [ ] Notera avvikelser (omplaneringar, missade stopp, kundärenden)

**Fredag eftermiddag (15 min):**
- [ ] Fyll i jämförelsearket för veckan
- [ ] Reflektion: vad sa Traivo, vad gjordes egentligen, varför skiljde det sig?

### 3.2 Avvikelseregister
För varje avvikelse, notera:

| Datum | Vad hände | Varför | Vad behöver fixas |
|-------|-----------|--------|-------------------|
|       |           |        |                   |

Exempel:
- *"Traivo missade att kunden vill ha tisdag-tömning"* → preferens-data saknades
- *"VRP visste inte att vi alltid börjar med xxx"* → constraint behöver in i systemet

**Avvikelserna är guld** — de visar vilka constraints/preferenser som behöver in i systemet.

---

## Fas 4 — Stopp-kriterier (när ni ska pausa)

Pausa piloten om något av detta inträffar:

- [ ] Datakvaliteten är så dålig att ni lägger mer tid på att fixa adresser än att planera
- [ ] VRP föreslår konsekvent orealistiska rutter
- [ ] Faktureringsfel som spårar tillbaka till Traivo-data (ska inte kunna hända i denna pilot eftersom utförande sker i Modus, men dubbelkolla)
- [ ] Planeraren tappar förtroende efter 3 veckor

**Vid paus:** dokumentera varför, fixa rotorsaken, kör om från Fas 2 (torrövning).

---

## Fas 5 — Beslutspunkt efter 3 veckor

Efter 3 pilotveckor, jämför mot målen från 0.2:

- [ ] Mötte vi mål 1?
- [ ] Mötte vi mål 2?
- [ ] Är planeraren snabbare/långsammare än med Modus?
- [ ] Litar planeraren på Traivos förslag?

**Beslut:**
- [ ] **Skala** — lägg till nästa kund (samma flöde: Fortnox-sync, Modus-import för objekt, datatvätt, torrövning, skarpt)
- [ ] **Hålla** — fortsätt med en kund i ytterligare 2–4 veckor för mer data
- [ ] **Backa** — pausa piloten, fixa större brister, kör om

---

## Bilaga A — Vad Fortnox respektive Modus äger

| Datatyp | Master-källa | Importeras till Traivo via |
|---------|--------------|----------------------------|
| Kund (namn, orgnr, faktureringsadress, betalningsvillkor) | **Fortnox** | Fortnox-API |
| Objekt / uppställningsplatser | **Modus** | Modus 2.0-import |
| Kärl (typ, storlek, antal) | **Modus** | Modus 2.0-import |
| Tömningsintervall | **Modus** | Modus 2.0-import |
| Avtal, prislistor | **Modus** | Modus 2.0-import |
| Leveranspreferenser | **Modus** + Traivo | Modus 2.0-import + manuell justering |
| GPS-koordinater | Geoapify (auto) | Geokodning vid import |
| Planering (vecka, rutt) | **Traivo** (under pilot) | — |
| Utförande / fakturering | **Modus** (under pilot) | — |

---

## Bilaga B — Tekniska tasks som kan behöva köras

Innan eller under pilot, beställ vid behov:

- [ ] Kund-filter i WeekPlanner (om det inte redan finns tillräckligt vasst)
- [ ] CSV-export "veckans planering för Kund X" (stoppordning, ETA, körsträcka, körtid)
- [ ] Pilot-flagga/tagg på ordrar för enkel filtrering
- [ ] Daglig avstämningsrapport av Modus-importen ("X nya, Y uppdaterade, Z saknade")

---

## Bilaga C — Loggbok

Använd detta för att logga större beslut och händelser:

| Datum | Händelse | Beslut | Ansvarig |
|-------|----------|--------|----------|
|       |          |        |          |
|       |          |        |          |
