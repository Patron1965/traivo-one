# Testplan: Unicorn Systemgenomgång

**Version:** 1.0  
**Datum:** 2026-01-05  
**Deltagare:** Mats, [Ditt namn]

---

## Syfte

Denna testplan är utformad för att systematiskt gå igenom Unicorn-plattformen, verifiera funktionalitet, identifiera buggar och dokumentera förbättringsförslag.

---

## DEL 1: Grundläggande Navigation (5 min)

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 1.1 | Öppna applikationen | Dashboard visas | ☐ | |
| 1.2 | Klicka på varje länk i sidomenyn | Varje sida laddas utan fel | ☐ | |
| 1.3 | Växla mellan ljust/mörkt läge | Färger anpassas korrekt | ☐ | |
| 1.4 | Testa på mobil/surfplatta | Responsiv layout fungerar | ☐ | |

---

## DEL 2: Kluster-flödet (Mats fokus) (15 min)

### 2.1 Skapa kluster
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 2.1.1 | Gå till `/clusters` | Klusterlista visas | ☐ | |
| 2.1.2 | Klicka "Skapa kluster" | Formulär öppnas | ☐ | |
| 2.1.3 | Fyll i namn, beskrivning, region | Fält accepterar input | ☐ | |
| 2.1.4 | Spara kluster | Kluster visas i listan | ☐ | |

### 2.2 Hantera kluster
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 2.2.1 | Klicka på ett kluster för att redigera | Redigeringsläge aktiveras | ☐ | |
| 2.2.2 | Ändra namn och spara | Ändringen sparas | ☐ | |
| 2.2.3 | Ta bort ett testkluster | Kluster försvinner från listan | ☐ | |
| 2.2.4 | Öppna kartvy för kluster | Kluster visas geografiskt | ☐ | |

### 2.3 Objekthierarki (Område → Fastighet → Rum)
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 2.3.1 | Gå till `/objects` | Objektlista visas | ☐ | |
| 2.3.2 | Skapa ett Område | Område skapas | ☐ | |
| 2.3.3 | Skapa Fastighet under Område | Fastighet kopplas till Område | ☐ | |
| 2.3.4 | Skapa Rum under Fastighet | Rum kopplas till Fastighet | ☐ | |
| 2.3.5 | Lägg till kontaktinfo på Område | Info sparas | ☐ | |
| 2.3.6 | Verifiera att Fastighet ärver kontaktinfo | Arv fungerar (falling) | ☐ | |
| 2.3.7 | Testa "fixed" informationsfält | Fixed-fält ärvs inte | ☐ | |

---

## DEL 3: Arbetsordrar & Planering (20 min)

### 3.1 Skapa arbetsorder
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 3.1.1 | Gå till `/orders` | Orderlista visas | ☐ | |
| 3.1.2 | Klicka "Skapa order" | Formulär öppnas | ☐ | |
| 3.1.3 | Fyll i orderdetaljer | Fält accepterar input | ☐ | |
| 3.1.4 | Koppla order till objekt | Objekt kan väljas | ☐ | |
| 3.1.5 | Koppla order till artikel | Artikel kan väljas | ☐ | |
| 3.1.6 | Tilldela till resurs | Resurs kan väljas | ☐ | |
| 3.1.7 | Spara order | Order visas i listan | ☐ | |

### 3.2 Veckoplaneraren
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 3.2.1 | Gå till `/planner` | Veckoplanerare visas | ☐ | |
| 3.2.2 | Navigera framåt/bakåt i veckor | Datum uppdateras | ☐ | |
| 3.2.3 | Klicka "Idag" | Hoppar till dagens datum | ☐ | |
| 3.2.4 | Drag-and-drop en order till annan dag | Order flyttas | ☐ | |
| 3.2.5 | Tilldela order till resurs | Resurs visas på order | ☐ | |
| 3.2.6 | Filtrera på resurs | Endast vald resurs visas | ☐ | |

### 3.3 Ruttvy (NY FUNKTION)

**Förutsättning:** Välj datum **4 januari 2026** och resurs **YCJ61D** eller **ADO237**

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 3.3.1 | Klicka "Rutt" i vyväljaren | Ruttvy visas | ☐ | |
| 3.3.2 | Välj resurs i dropdown | Jobb laddas på kartan | ☐ | |
| 3.3.3 | Verifiera numrerade markörer | Stopp visas med nummer 1, 2, 3... | ☐ | |
| 3.3.4 | Klicka på markör | Popup med jobbinfo visas | ☐ | |
| 3.3.5 | Klicka "Optimera rutt" | Rutten beräknas om | ☐ | |
| 3.3.6 | Verifiera total körtid/sträcka | Statistik uppdateras | ☐ | |
| 3.3.7 | Klicka "Google Maps" | Rutt öppnas i ny flik | ☐ | |
| 3.3.8 | Klicka "Skriv ut" | PDF genereras | ☐ | |
| 3.3.9 | Klicka "Skicka till mobil" | Bekräftelse visas | ☐ | |

---

## DEL 4: Artiklar & Prissättning (10 min)

### 4.1 Artikelhantering
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 4.1.1 | Gå till `/articles` | Artikellista visas | ☐ | |
| 4.1.2 | Skapa ny artikel | Formulär öppnas | ☐ | |
| 4.1.3 | Fyll i artikeldetaljer + pris | Fält accepterar input | ☐ | |
| 4.1.4 | Spara artikel | Artikel visas i listan | ☐ | |

### 4.2 Prissystem (3 nivåer)
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 4.2.1 | Sätt generellt pris på artikel | Pris sparas | ☐ | |
| 4.2.2 | Sätt kundspecifikt pris | Kundpris överskrider generellt | ☐ | |
| 4.2.3 | Skapa rabattbrev | Rabatt appliceras korrekt | ☐ | |

### 4.3 Fasthakning (Article Hooks)
| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 4.3.1 | Gå till artikelkopplings-sidan | Hook-formulär visas | ☐ | |
| 4.3.2 | Koppla artikel till objekttyp | Koppling sparas | ☐ | |
| 4.3.3 | Skapa order på kopplat objekt | Artikel föreslås automatiskt | ☐ | |

---

## DEL 5: Resurser & Fordon (10 min)

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 5.1 | Gå till `/resources` | Resurslista visas | ☐ | |
| 5.2 | Skapa ny resurs | Formulär öppnas | ☐ | |
| 5.3 | Fyll i namn och fordonsinfo | Fält accepterar input | ☐ | |
| 5.4 | Lägg till kompetenser | Kompetenser visas | ☐ | |
| 5.5 | Ställ in tillgänglighet/schema | Schema sparas | ☐ | |
| 5.6 | Spara resurs | Resurs visas i listan | ☐ | |

---

## DEL 6: Mobilvy för fältarbetare (10 min)

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 6.1 | Gå till `/mobile-field-app` | Mobilvy laddas | ☐ | |
| 6.2 | Logga in som fältarbetare | Autentisering fungerar | ☐ | |
| 6.3 | Visa dagens jobb | Jobblista visas | ☐ | |
| 6.4 | Klicka på ett jobb | Jobbdetaljer visas | ☐ | |
| 6.5 | Markera jobb som påbörjat | Status ändras | ☐ | |
| 6.6 | Signera med signatur-funktionen | Signatur sparas | ☐ | |
| 6.7 | Logga material | Material registreras | ☐ | |
| 6.8 | Markera jobb som slutfört | Status ändras till slutförd | ☐ | |

---

## DEL 7: Import (Modus 2.0) (10 min)

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 7.1 | Gå till `/import` | Importsida visas | ☐ | |
| 7.2 | Ladda upp en test-CSV | Fil laddas | ☐ | |
| 7.3 | Granska fältmappning | Kolumner mappas till systemfält | ☐ | |
| 7.4 | Verifiera validering | Fel markeras tydligt | ☐ | |
| 7.5 | Kör import | Data importeras | ☐ | |
| 7.6 | Verifiera importerad data | Data finns i systemet | ☐ | |

---

## DEL 8: AI-funktioner (5 min)

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 8.1 | Öppna dashboard | AI-kort visas | ☐ | |
| 8.2 | Klicka på AI-suggestion | Förslag expanderas | ☐ | |
| 8.3 | Gå till planeraren | AI-hjälpikon visas | ☐ | |
| 8.4 | Be om AI-planering | AI ger optimeringsförslag | ☐ | |
| 8.5 | Verifiera väderdata | Väderprognos visas | ☐ | |

---

## DEL 9: Fortnox-integration (Om konfigurerad) (5 min)

| Steg | Åtgärd | Förväntat resultat | OK? | Kommentar |
|------|--------|-------------------|-----|-----------|
| 9.1 | Gå till Fortnox-inställningar | Inställningssida visas | ☐ | |
| 9.2 | Verifiera OAuth-status | Anslutningsstatus visas | ☐ | |
| 9.3 | Synka artiklar | Artiklar hämtas | ☐ | |
| 9.4 | Exportera faktura | Faktura skapas i Fortnox | ☐ | |

---

## Buggrapport

| # | Sida/Funktion | Problem | Steg för att reproducera | Prioritet | Status |
|---|---------------|---------|--------------------------|-----------|--------|
| 1 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 2 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 3 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 4 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 5 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 6 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 7 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 8 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 9 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |
| 10 | | | | ☐ Hög ☐ Med ☐ Låg | ☐ Ej fixad |

---

## Förbättringsförslag

| # | Område | Förslag | Prioritet | Kommentar |
|---|--------|---------|-----------|-----------|
| 1 | | | ☐ Hög ☐ Med ☐ Låg | |
| 2 | | | ☐ Hög ☐ Med ☐ Låg | |
| 3 | | | ☐ Hög ☐ Med ☐ Låg | |
| 4 | | | ☐ Hög ☐ Med ☐ Låg | |
| 5 | | | ☐ Hög ☐ Med ☐ Låg | |

---

## Kända begränsningar

1. **GPS-koordinater:** Jobb utan GPS-koordinater visas inte på ruttkartan
2. **Fortnox:** Kräver aktiv API-nyckel för full funktionalitet
3. **Testdata:** Ruttoptimering fungerar med resurser YCJ61D och ADO237 på datum 4 januari 2026

---

## Planerade förbättringar (Roadmap)

### Kortsiktigt (nästa sprint)
- [ ] Drag-and-drop för att ändra ruttordning
- [ ] Beräknad ankomsttid per stopp
- [ ] Automatisk geocoding av adresser

### Mellansiktigt
- [ ] Trafikdata-integration
- [ ] Flera rutter per dag (för-/eftermiddag)
- [ ] Historik för körda rutter

### Långsiktigt
- [ ] Live GPS-spårning på ruttkartan
- [ ] Kapacitetsplanering för fordon
- [ ] Optimering med tidsfönster

---

## Sammanfattning

**Testdatum:** ________________

**Antal fungerande funktioner:** ____ / ____

**Antal buggar funna:** ____

**Kritiska problem:** 
- 

**Nästa steg:**
- 

**Signatur testare 1:** ________________

**Signatur testare 2:** ________________
