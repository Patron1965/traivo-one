# Unicorn - AI-Driven Planeringsplattform för Kinab

**Skapad:** December 2024  
**Status:** Funktionell prototyp redo för demonstration

---

## Sammanfattning

Unicorn är en AI-driven planeringsplattform utvecklad i samarbete med Kinab AB, specifikt anpassad för avfallshantering och renhållning. Plattformen möjliggör omfattande optimering av fältserviceverksamheten - från ruttplanering och resursallokering till ekonomisk kontroll och prediktiva analyser.

**Visionen:** Bevisa värde med Kinab som pilotpartner, sedan skala till en kommersiell SaaS-lösning för nordiska serviceföretag.

---

## Nuvarande Systemkapacitet

### Data i Systemet (Live)

| Kategori | Antal | Källa |
|----------|-------|-------|
| **Kunder** | 899 | Importerade från Modus 2.0 |
| **Objekt** | 43 425 | Hierarkiskt organiserade (Område → Fastighet → Rum) |
| **Arbetsordrar** | 22 714 | Med fullständig statushantering |
| **Resurser** | 8 | Fordon och personal |

---

## Kärnfunktioner (Implementerade)

### 1. Kluster - Navet i Verksamheten

Kluster är den centrala organisationskonceptet som ger Kinab möjlighet att "se snöret" genom hela verksamhetsflödet:

- **Geografisk organisation** av objekt och ordrar
- **Visualisering på karta** med interaktiva markörer
- **Automatisk statistik** per kluster (objekt, ordrar, snittställtid, månadsvärde)
- **SLA-nivåer** (Standard, Premium, Enterprise)
- **Team-koppling** för ansvarig personal
- **Adresssökning** med autokomplettering vid skapande (OpenStreetMap)

### 2. AI-Planeringsassistent

Intelligent analysverktyg som ger konkreta förbättringsförslag:

- **"Jämna ut arbetsbelastningen"** - Föreslår omfördelning mellan resurser
- **"Planera oschemalagda ordrar"** - Identifierar ordrar utan planerad tid
- **"Gruppera ordrar för att spara körtid"** - Klusterbaserad ruttoptimering
- **"Flytta akuta ordrar till tidigare datum"** - Prioriteringsförslag

*Teknologi: OpenAI GPT-4o via Replit AI Integrations - live och fungerande*

### 3. Auto-Klustring

AI-driven geografisk analys som automatiskt föreslår optimala kluster:

- Analyserar objektens postnummer och geografi
- Genererar namnförslag baserat på stad (Östersund, Umeå, Skellefteå, etc.)
- Visar täckningsgrad för objekten
- Möjliggör snabb uppsättning av klusterstruktur

**Aktuell täckning:** 73% av objekten kan tilldelas föreslagna kluster

### 4. Väderintegration

7-dagars väderprognos med svenska beskrivningar och kapacitetspåverkan:

- **Realtidsprognos** för planeringsområdet
- **Kapacitetsmultiplikatorer** (0.4 vid svårt väder → 1.0 vid normalt)
- **Svenska väderbeskrivningar** ("Lätt duggregn", "Mestadels klart", "Molnigt")
- Stöd för väderbaserad planering och resursallokering

### 5. Orderhantering

Komplett arbetsflöde med statusspårning:

```
Skapad → Förplanerad → Resursplanerad → Låst → Utförd → Fakturerad
```

- Orderlager med 22 714 ordrar
- Filtrering och paginering
- Statusuppdatering via API

---

## Planerade Funktioner (Roadmap)

### Nästa Iteration

| Funktion | Beskrivning | Prioritet |
|----------|-------------|-----------|
| **Mobil Fältapp** | Komplett vy för fälttekniker med tidsloggning | Hög |
| **Ekonomisk Dashboard** | Lönsamhetsanalys per kluster | Hög |
| **Prenumerationsautomatik** | Automatisk ordergenerering | Medium |
| **Kundportal** | Självbetjäning för slutkunder | Medium |

---

## Teknisk Plattform

| Komponent | Teknologi |
|-----------|-----------|
| Frontend | React, TypeScript, Vite |
| Backend | Express.js, Node.js |
| Databas | PostgreSQL med Drizzle ORM |
| Kartor | Leaflet, OpenStreetMap |
| AI | OpenAI GPT-4o |
| Geocoding | OpenStreetMap Nominatim |
| Väder | Open-Meteo API |

**Multi-tenancy:** Inbyggt stöd för flera hyresgäster - redo för SaaS-skalning.

---

## Affärsvärde för Kinab

### Redan Nu (Verifierat)

| Funktion | Värde |
|----------|-------|
| **Komplett dataöversikt** | 899 kunder, 43 425 objekt synliga i ett system |
| **AI-planeringsförslag** | Balansera arbetsbelastning, identifiera oschemalagda ordrar |
| **Geografisk insikt** | 73% av objekten kan auto-klustras för effektivare planering |
| **Väderanpassning** | Planera med hänsyn till 7-dagars prognos |
| **Modus 2.0-import** | Befintlig data importerad och strukturerad |

### Konkreta Förbättringsmöjligheter

Med AI-assistentens förslag kan Kinab:
- **Jämna ut arbetsbelastning** mellan resurser → minskar övertid
- **Gruppera ordrar geografiskt** → kortare körsträckor
- **Prioritera akuta ordrar** → bättre kundnöjdhet
- **Undvika dubbelbokning** → effektivare resursutnyttjande

### Roadmap (Nästa fas)

| Tidsram | Fokus |
|---------|-------|
| **Q1 2025** | Komplett mobil fältapp, ekonomisk dashboard |
| **Q2 2025** | Ruttoptimering, prediktiv planering |
| **H2 2025** | Multi-tenant SaaS, kundportal |

---

## Nästa Steg

1. **Demo-session** - Genomgång av live-systemet med Mats
2. **Feedback** - Prioritering av funktioner utifrån Kinabs behov
3. **Pilot** - Testperiod med utvald del av verksamheten
4. **Iteration** - Vidareutveckling baserad på verklig användning

---

## Kontakt

**Plattform:** Unicorn  
**Partner:** Kinab AB  
**Status:** Redo för demonstration

*Unicorn - AI som genomsyrar hela planeringsprocessen*
