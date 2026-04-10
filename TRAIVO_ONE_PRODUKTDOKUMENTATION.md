# Traivo One — Komplett Produktdokumentation

> **Version:** 3.0  
> **Datum:** 2026-04-10  
> **Status:** Faktisk implementation (speglar kodbasen)  
> **Plattform:** Replit (initial deployment)  
> **Typ:** Enterprise-fältsystem  
> **Målgrupp:** Små, medelstora och stora bolag

---

## Innehållsförteckning

1. [Översikt & Vision](#1-översikt--vision)
2. [Traivo One som Enterprise-Fältsystem](#2-traivo-one-som-enterprise-fältsystem)
3. [Målgrupp & Användarprofil](#3-målgrupp--användarprofil)
4. [Kärnfunktionalitet — Dagplanering](#4-kärnfunktionalitet--dagplanering)
5. [Kärnfunktionalitet — Veckoplanering](#5-kärnfunktionalitet--veckoplanering)
6. [Integration Dag ↔ Veckoplanering](#6-integration-dag--veckoplanering)
7. [Ruttoptimering — Teknisk Specifikation](#7-ruttoptimering--teknisk-specifikation)
8. [Datamodell](#8-datamodell)
9. [API-specifikation](#9-api-specifikation)
10. [UI/UX-design](#10-uiux-design)
11. [Replit-specifika Överväganden](#11-replit-specifika-överväganden)
12. [Praktiska Enterprise-features](#12-praktiska-enterprise-features)
13. [Feature Roadmap](#13-feature-roadmap)
14. [Teknisk Arkitektur & Stack](#14-teknisk-arkitektur--stack)
15. [Utvecklingsplan](#15-utvecklingsplan)
16. [Jämförelse: Traivo One vs Traivo Ruttplanering](#16-jämförelse-traivo-one-vs-traivo-ruttplanering)
17. [Uppgraderingsväg & Integration](#17-uppgraderingsväg--integration)
18. [Framtidsvision](#18-framtidsvision)

---

## 1. Översikt & Vision

### Vad är Traivo One?

Traivo One är ett **enterprise-fältsystem** byggt för att ge små, medelstora och stora bolag ett komplett verktyg för fältverksamhet. Systemet hanterar hela kedjan från planering och ruttoptimering till fältexekvering, uppföljning och kundkommunikation.

Traivo One har växt långt bortom en enkel ruttplanerare. Systemet innehåller idag en **dedikerad Python OR-Tools-optimeringstjänst** med CVRPTW och ALNS-metaheuristik, 131 databastabeller, 800+ API-endpoints, AI-integrationer, kundportal, IoT-integration, fakturering med Fortnox-export, och en komplett fältapp.

### Kärnlöfte

> **"Ett komplett fältsystem som gör hela din fältverksamhet effektivare — från planering till leverans."**

Traivo One löser hela fältverksamhetens utmaningar:
- **Sparad tid** — AI-driven ruttoptimering (OR-Tools CVRPTW + ALNS) och smart resursplanering
- **Lägre kostnader** — 15–30% kortare rutter, bättre resursutnyttjande
- **Fler leveranser/uppdrag** — Bättre utnyttjad kapacitet per dag med VRP-constraints
- **Nöjdare kunder** — ETA-notiser, kundportal, proaktiv kommunikation
- **Full insyn** — Realtidsöversikt, dashboards, KPI:er, prediktiv analys
- **Enterprise-kapacitet** — Multi-tenant, rollbaserat, skalbart med moduler

### Vad Traivo One ÄR

- Ett **enterprise-fältsystem** med bred funktionalitet — 75+ sidor/vyer
- Byggt för **små, medelstora och stora bolag** med full multi-tenant-isolering
- Ruttoptimering med **OR-Tools CVRPTW + ALNS** — världsklass-algoritmer
- Plattform för **hela fältverksamheten** — inte bara rutter
- **AI-driven** med OpenAI-integration för planering och analys
- **Skalbart** med OSRM, DBSCAN-klustring och asynkron optimering

### Vad Traivo One INTE är

Traivo One är primärt fokuserat på nordisk avfallshantering och fältservice:
- Inte ett realtids-ruttoptimeringssystem med ML/RL
- Inte en EV-laddstrategiplanerare
- Inte multi-objektiv Pareto-optimering

---

## 2. Traivo One som Enterprise-Fältsystem

### 2.1 Vad innebär "Enterprise-Fältsystem"?

Traivo One är ett **komplett digitalt ekosystem för fältverksamhet** som hanterar alla aspekter av att driva en organisation med personal och fordon i fält.

```
┌──────────────────────────────────────────────────────────────────────┐
│                   TRAIVO ONE — ENTERPRISE-FÄLTSYSTEM                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ RUTT-         │  │ FÄLT-         │  │ ARBETSORDER-              │   │
│  │ OPTIMERING    │  │ PERSONAL      │  │ HANTERING                 │   │
│  │ OR-Tools VRP  │  │ Scheman       │  │ Skapa, tilldela,          │   │
│  │ ALNS + OSRM   │  │ Kompetens     │  │ följa upp, protokoll      │   │
│  │ DBSCAN-kluster│  │ Tillgängl.    │  │ Checklists, inspektioner  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ KUND-         │  │ RAPPORT-      │  │ FÄLT-APP                  │   │
│  │ HANTERING     │  │ ERING         │  │ Mobil för fält-           │   │
│  │ CRM, portal   │  │ KPI:er        │  │ personal                  │   │
│  │ Historik      │  │ Dashboards    │  │ Offline-stöd              │   │
│  │ Bokning       │  │ Prediktiv     │  │ Navigation, signatur      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ FORDONS-      │  │ KUND-         │  │ INTEGRATIONS-             │   │
│  │ HANTERING     │  │ KOMMUNIK.     │  │ PLATTFORM                 │   │
│  │ Fleet mgmt    │  │ SMS/Email     │  │ Fortnox, IoT              │   │
│  │ Inspektioner  │  │ Kundportal    │  │ REST API, webhooks        │   │
│  │ Underhåll     │  │ ETA-notiser   │  │ MCP-server                │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ AI-PLATTFORM  │  │ FAKTURERING   │  │ IOT & SENSORER            │   │
│  │ AI Planner    │  │ Fakturaunderl │  │ Automatisk order-         │   │
│  │ Auto-schedule │  │ Fortnox-exp.  │  │ generering                │   │
│  │ Command Ctr   │  │ Prisliste-    │  │ Enhetshantering           │   │
│  │ Konversation  │  │ hantering     │  │ Signalbearbetning         │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Enterprise-funktioner i Traivo One (implementerade)

| Funktionsområde | Beskrivning | Status |
|-----------------|-------------|--------|
| **Ruttoptimering** | OR-Tools CVRPTW + ALNS, OSRM/Geoapify, DBSCAN-kluster | Implementerad |
| **Fältpersonalhantering** | Schema, kompetens (executionCodes), tillgänglighet, positionering | Implementerad |
| **Arbetsorderhantering** | Skapa, tilldela, status, linjer, checklists, protokoll | Implementerad |
| **Kundhantering** | Kundregister, kontaktpersoner, servicekontrakt, betalare | Implementerad |
| **Fordonshantering** | Fleet management, fordonsinspektioner, underhållslogg, bränsle | Implementerad |
| **Rapportering & Analytics** | KPI-dashboards, ekonomi, miljö, prediktiv analys, ROI | Implementerad |
| **Kundkommunikation** | SMS (Twilio), email (Resend), ETA-notiser, kundportal, portalmeddelanden | Implementerad |
| **Mobilapp för fält** | Offline-stöd, navigation, signatur, materiallogg, dagrapport, todo-lista | Implementerad |
| **AI-planering** | AI Planning Assistant, Auto-Scheduling, Conversational Planner, AI Command Center | Implementerad |
| **Fakturering** | Fakturaunderlag, prisliste- och artikelhantering, Fortnox-export | Implementerad |
| **IoT-integration** | Sensorsignaler, automatisk ordergenerering, enhetshantering | Implementerad |
| **Multi-tenant** | Full tenant-isolering, rollbaserad åtkomst (8 roller), feature-flaggor | Implementerad |
| **Integrationsplattform** | REST API (800+ endpoints), MCP-server, Fortnox, IoT | Implementerad |

### 2.3 Varför är Traivo One "Enterprise-nivå"?

1. **Full multi-tenant-arkitektur** — Varje tenant har isolerad data, konfiguration och feature-flaggor
2. **8 roller** — owner, admin, planner, technician, user, viewer, customer, reporter — med module guards
3. **131 databastabeller** — Komplett datamodell för hela fältverksamheten
4. **AI-integration** — OpenAI för planering, auto-scheduling, konversation, analys
5. **VRP med constraints** — Tidsfönster, kompetenskrav, kapacitet, beroenden
6. **Prediktiv analys** — Prognoser, anomalier, trender
7. **Audit trail** — Loggning av alla ändringar (audit_logs-tabell)
8. **API-first design** — 800+ endpoints, MCP-server för AI-integration

### 2.4 Hur ruttoptimeringen passar in i helheten

```
Fältverksamhetens flöde i Traivo One:

  ┌──────────────────┐
  │ 1. KUNDORDER     │  Arbetsorder skapas (manuellt, CSV, Modus, IoT, portal)
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 2. PLANERING     │  AI-planering, manuell tilldelning, auto-scheduling
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 3. VRP-          │  ← OR-Tools CVRPTW + ALNS (Python FastAPI)
  │    OPTIMERING    │     OSRM → Geoapify → Haversine distanskedja
  │                  │     DBSCAN geo-temporal klustring
  │                  │     Constraint-validering (TW, skills, capacity, deps)
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 4. FÄLT-         │  Fältapp med navigation, checklists, signatur
  │    EXEKVERING    │  Offline-stöd, materiallogg, dagrapport
  └────────┬─────────┘
           ▼
  ┌──────────────────┐
  │ 5. UPPFÖLJNING   │  Dashboard, KPI, fakturering, Fortnox-export
  │                  │  Prediktiv analys, feedback loop
  └──────────────────┘
```

---

## 3. Målgrupp & Användarprofil

### Primär målgrupp

Traivo One riktar sig till **nordiska avfallshanteringsbolag och fältserviceföretag**:

| Segment | Storlek | Beskrivning | Exempel |
|---------|---------|-------------|----------|
| **Avfallshantering** | 5–50 fordon | Soptömning, container, återvinning | Kommunala bolag, privata entreprenörer |
| **Fältservice** | 10–50 tekniker | Kundbesök, installationer, service | El, VVS, fiber, IT-service |
| **Facility Management** | 5–30 team | Underhåll, inspektioner, städning | Fastighetsbolag, städfirmor |
| **Logistik & Distribution** | 5–30 fordon | Dagliga leveranser, ruttoptimering | Distributörer |
| **Enterprise med fältpersonal** | 20–200+ användare | Komplex fältverksamhet | Stora servicebolag |

### Användarroller (8 roller, implementerade i `server/routes.ts`)

| Roll | Beskrivning | Primära uppgifter |
|------|-------------|-------------------|
| **Owner** | Organisationsägare | Full kontroll, konfiguration |
| **Admin** | Systemadministratör | Användare, integrationer, inställningar |
| **Planner** | Daglig planering | Rutter, resurstilldelning, veckoplanering |
| **Technician** | Fälttekniker | Utföra uppdrag, rapportera |
| **User** | Standardanvändare | Begränsad åtkomst |
| **Viewer** | Läsåtkomst | Dashboards, rapporter |
| **Customer** | Extern kund | Kundportal, bokning, rapporter |
| **Reporter** | Anmälare | Felanmälan via QR-kod |

---

## 4. Kärnfunktionalitet — Dagplanering

### 4.1 WeekPlanner (huvudverktyg)

Traivo One:s planeringsverktyg är en **avancerad WeekPlanner** med drag-and-drop, byggd med dnd-kit. Den stödjer:

- **Veckorutnätsvy** — Resurser som kolumner, dagar som rader, med JobCards
- **Dagtidslinjevy** — Tidslinje per resurs med start/sluttider
- **Månadsvy** — Kalenderöversikt av hela månaden
- **Oplanerade uppdrag** — Sidebar med drag-and-drop till planeringsvyn
- **Konfliktindikering** — Visuella varningar vid dubbelbokning
- **AI-förslag** — Automatiska optimeringsförslag
- **Disruption panel** — Hantering av avvikelser och omplanering

### 4.2 Funktioner i detalj

#### A. Arbetsordrar

| Funktion | Beskrivning |
|----------|-------------|
| Skapa arbetsorder | Med objekt, artiklar, tidsuppskattning, prioritet |
| Tilldela resurs | Drag-and-drop eller manuell tilldelning |
| Status-flöde | aktiv → schemalagd → påbörjad → utförd → fakturerad |
| Orderrader | Artiklar med pris (i öre), mängd, radbeskrivning |
| Orderobjekt | Flera objekt per order, med metadata |
| Checklists | Konfigurerbara checklistmallar |
| Tidsfönster | Från objektrestriktioner och önskade tider |

#### B. VRP-optimering

- Resultat beroende av storlek: < 30 ordrar synkront, > 30 ordrar asynkront (bakgrundsjobb)
- CVRPTW med OR-Tools (Python) → ALNS-förbättring → 2-opt/or-opt post-processering
- OSRM för riktiga vägavstånd, med Geoapify och Haversine som fallback
- Constraint-validering: tidsfönster, kompetenskrav, fordonskapacitet, beroenden

#### C. Under dagens körning

| Åtgärd | Beskrivning |
|--------|-------------|
| Statusuppdatering | Markera som utförd, omöjlig, avbruten |
| Materiallogg | Registrera material/artiklar förbrukade |
| Signatur | Digital signaturinsamling |
| Foton | Bilduppladdning till Object Storage |
| Dagrapport | Sammanfattning av dagens arbete |
| Nästa stopp | Smart navigation med avstånd/tid |

---

## 5. Kärnfunktionalitet — Veckoplanering

### 5.1 WeekPlanner-komponentstruktur

WeekPlanner är implementerad med 14 subkomponenter i `client/src/components/weekplanner/`:

| Komponent | Ansvar |
|-----------|--------|
| `WeekGridView` | Rutnätsvy med resurser × dagar |
| `DayTimelineView` | Tidslinje med timmarker |
| `MonthView` | Kalendervy för hela månaden |
| `ResourceColumn` | Kolumn per resurs med jobbkort |
| `ResourceDetailSheet` | Detaljvy för resurs (kapacitet, schema) |
| `JobCard` | Enskilt jobbkort med drag-and-drop |
| `DndComponents` | dnd-kit wrappers (DragOverlay, etc.) |
| `UnscheduledSidebar` | Oplanerade arbetsordrar |
| `PlannerToolbar` | Verktygsfält (datum, filter, vyer) |
| `PlannerDialogs` | Dialoger för redigering, AI-förslag |
| `DisruptionPanel` | Avvikelsehantering |
| `RouteMapView` | Kartvy av planerade rutter |
| `usePlannerData` | Data-hook (react-query, SSE) |
| `usePlannerDnd` | Drag-and-drop-logik |

### 5.2 Veckoplanering

- **SSE-realtidsuppdateringar** — Automatisk uppdatering när data ändras
- **Väderintegration** — Open-Meteo API visar prognos per dag
- **Automatiserade veckorapporter** — Scheduler (`server/weekly-report.ts`) skickar rapporter via email
- **AI Auto-Scheduling** — AI fördelar oplanerade ordrar baserat på geografi, kompetens, kapacitet

### 5.3 Veckovyns nyckeldata

| Data | Beskrivning |
|------|-------------|
| Ordrar per dag | Visuell fördelning i grid |
| Resursutnyttjande | Kapacitetsbar per resurs |
| Konfliktvarningar | Dubbelbokning, överbelastning |
| Väderprognos | Temperatur och nederbörd |
| AI-rekommendationer | Föreslagna optimeringar |

---

## 6. Integration Dag ↔ Veckoplanering

### 6.1 Dataflöde

```
     ┌─────────────────────┐
     │  Arbetsorderregister │  (work_orders-tabell, 50+ fält)
     │  + Objektkopplingar   │
     └─────────┬───────────┘
               │
               ▼
     ┌─────────────────────┐
     │  AI Auto-Scheduler   │  Fördelar ordrar baserat på:
     │  + Manuell planering │  - Geografi (DBSCAN-kluster)
     │                      │  - Kompetens (executionCodes)
     └─────────┬───────────┘  - Kapacitet (fordon/resurser)
               │               - Tidsfönster
    ┌──────────┼──────────┬──────────┬──────────┐
    ▼          ▼          ▼          ▼          ▼
 ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
 │ Mån  │  │ Tis  │  │ Ons  │  │ Tor  │  │ Fre  │
 │ VRP  │  │ VRP  │  │ VRP  │  │ VRP  │  │ VRP  │
 └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘
    ▼         ▼         ▼         ▼         ▼
  OR-Tools  OR-Tools  OR-Tools  OR-Tools  OR-Tools
  CVRPTW    CVRPTW    CVRPTW    CVRPTW    CVRPTW
  + ALNS    + ALNS    + ALNS    + ALNS    + ALNS
```

### 6.2 Nyckelbeteenden

| Scenario | Automatiskt beteende |
|----------|---------------------|
| Oplanerad order | AI föreslår bästa dag baserat på geografi & kapacitet |
| Brådskande jobb | Nearest-technician-sökning + WebSocket-notis |
| Resurs otillgänglig | Disruption service föreslår omplanering |
| Återkommande uppdrag | Prenumerationssystem (subscriptions-tabell) |
| Dag överbelastad | Kapacitetsvarning i dashboard |

---

## 7. Ruttoptimering — Teknisk Specifikation

> **Kontext:** Traivo One innehåller en **avancerad, flerstegs ruttoptimeringsmotor** med en dedikerad Python-mikrotjänst (OR-Tools), ALNS-metaheuristik, OSRM-integration och deterministic constraint-validering.

### 7.1 Optimeringsarkitektur

Traivo One har en **3-lagers optimeringsarkitektur**:

| Lager | Teknik | Ansvar |
|-------|--------|--------|
| **1. Constraint-validering** | TypeScript (`vrp-constraints.ts`, 617 rader) | Berika VRP-request med tidsfönster, kompetens, kapacitet, beroenden |
| **2. CVRPTW-lösare** | Python OR-Tools (`main.py`, 650 rader) | Initial VRP-lösning med exakta constraints |
| **3. ALNS-förbättring** | Python (`alns.py`, 729 rader) | Metaheuristisk förbättring av OR-Tools-lösning |
| **4. Lokal sökning** | Python (i `alns.py`) | 2-opt + or-opt post-processering |
| **Fallback** | TypeScript (`route-optimizer.ts`, 1134 rader) | Nearest-Neighbor + Geoapify Route Planner |

### 7.2 Pipeline i detalj

```
Arbetsordrar + Resurser + Objekt
         │
         ▼
┌──────────────────────────────────────┐
│ 1. CONSTRAINT-BERIKARE (TypeScript)   │
│    vrp-constraints.ts                 │
│    ├── Tidsfönster (object_time_restrictions, task_desired_timewindows)
│    ├── Kompetenskrav (executionCodes → skills-vektor)
│    ├── Kapacitet (vehicle tons/volume → capacity-vektor)
│    ├── Beroenden (topologisk ordning → time_window-shifting)
│    ├── Slotpreferenser (soft: prioritetsboost)
│    └── Effektivitetsfaktorer (resource_articles → per-agent duration)
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ 2. PRE-KLUSTRING (vid behov)          │
│    dbscan-clustering.ts (TypeScript)  │
│    main.py (Python sklearn)           │
│    ├── DBSCAN med geo-temporal distans│
│    │   epsilon=15km, minSamples=3     │
│    │   temporalWeight=0.3             │
│    ├── K-Means fallback vid degenerat │
│    └── Noise → närmaste kluster       │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ 3. OR-TOOLS CVRPTW (Python FastAPI)   │
│    optimization-service/main.py       │
│    ├── Distansmatris (OSRM Table API) │
│    ├── RoutingIndexManager + Model    │
│    ├── Dimension: Distance, Time      │
│    ├── TimeWindows per nod            │
│    ├── Kapacitetsbegränsning          │
│    ├── Disjunctions (optional drops)  │
│    └── ~60% av tidsbudget             │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ 4. ALNS FÖRBÄTTRING (Python)          │
│    optimization-service/alns.py       │
│    ├── 3 destroy-operatorer:          │
│    │   random, worst, related removal │
│    ├── 3 repair-operatorer:           │
│    │   greedy, regret-2, regret-3     │
│    │   insertion                      │
│    ├── Simulated Annealing acceptance │
│    ├── Adaptive roulette-wheel        │
│    │   operator-selektion             │
│    └── ~40% av tidsbudget             │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│ 5. LOKAL SÖKNING (Python)             │
│    ├── 2-opt intra-rutt               │
│    └── or-opt segment-flytt           │
└──────────┬───────────────────────────┘
           │
           ▼
  Optimerade rutter (per resurs, med timing)
```

### 7.3 OSRM-integration

OSRM (Open Source Routing Machine) ger **riktiga vägavstånd** istället för fågelvägen:

```
Distanskedja (fallback):
  OSRM Table API (batch N×N) 
    → Geoapify Routing API
      → Haversine (fågelvägen × ~1.4)

OSRM-klient (server/osrm-client.ts, 283 rader):
  ├── osrmTable()      — Batch N×N distans/duration
  ├── osrmRoute()      — Enstaka par med geometri
  ├── osrmRouteMulti() — Multi-waypoint med GeoJSON
  ├── Chunking         — Automatisk uppdelning vid > 100 koordinater
  ├── Health check     — Backoff vid upprepade fel (max 5 consecutive failures)
  └── Konfigurerbar    — OSRM_BASE_URL, OSRM_TIMEOUT, OSRM_PROFILE
```

Distans-cache (`server/distance-matrix-service.ts`):
- **L1 in-memory cache** — 50k entries, 2h TTL, batch-eviction
- **L2 databas-cache** — distance_cache-tabell, 24h TTL
- **Geohash-nycklar** — Precision 9 (~5m) för stabil deduplicering

### 7.4 VRP Constraints (vrp-constraints.ts)

Fyra kategorier av constraints, alla konfigurerbara per request:

| Constraint | Källa | Modellering |
|------------|-------|-------------|
| **Tidsfönster** | object_time_restrictions, task_desired_timewindows | Hårda time_windows per jobb |
| **Kompetens** | executionCodes (order ↔ resurs) | required_skills ↔ skills-vektorer |
| **Kapacitet** | vehicles (tons, volume) → resource_vehicles | capacity + pickup-vektorer (2D) |
| **Beroenden** | task_dependencies, task_dependency_instances | Topologisk time_window-shifting |
| **Slotpreferenser** | Kundpreferenser | Prioritetsboost (soft constraint) |
| **Effektivitet** | resource_articles | Justerad jobbduration per resurs |

**Begränsningar dokumenterade i koden:**
1. Geoapify har EN duration per jobb — multi-agent: medelvärde av faktorer
2. Preferenser modelleras som prioritetsboost (ej hårda tidsfönster)
3. Beroenden via time_window-shifting (ej dynamisk restid)
4. Kapacitet opt-in (disabled by default)

### 7.5 Asynkron optimering

```
ASYNC_THRESHOLD = 30 ordrar

≤ 30 ordrar: Synkron optimering (direkt svar)
> 30 ordrar: Bakgrundsjobb (optimization_jobs-tabell)
              ├── Status: pending → running → completed/failed
              ├── SSE-uppdateringar till frontend
              └── Resultat sparas i JSON-kolumn
```

### 7.6 Prestanda

| Scenario | OR-Tools + ALNS | Nearest-Neighbor (fallback) |
|----------|-----------------|-----------------------------|
| 20 ordrar, 5 resurser | ~2–5 sek | < 100 ms |
| 50 ordrar, 10 resurser | ~10–30 sek (asynkron) | < 500 ms |
| 100 ordrar, 15 resurser | ~30–60 sek (asynkron) | < 1 sek |

**Lösningskvalitet (indikativt):** OR-Tools + ALNS ger typiskt nära optimal lösning. Nearest-Neighbor-fallback ger god men enklare lösningskvalitet.

---

## 8. Datamodell

### 8.1 Översikt — 131 tabeller

Traivo One använder **131 PostgreSQL-tabeller** (definierade via `pgTable()` i `shared/schema.ts`) med Drizzle ORM. Här är de viktigaste grupperade per domän:

#### Kärntabeller (multi-tenant)

| Tabell | Beskrivning | Nyckelrelationer |
|--------|-------------|------------------|
| `tenants` | Organisationer/hyresgäster | Rot för all data |
| `users` | Användare med Replit Auth | → tenants (via user_tenant_roles) |
| `user_tenant_roles` | Roll per tenant | → users, tenants |
| `sessions` | Autentiseringssessioner | → users |

#### Kunddomän

| Tabell | Beskrivning |
|--------|-------------|
| `customers` | Kundregister med kontaktinfo, koordinater |
| `customer_service_contracts` | Serviceavtal |
| `customer_communications` | Kommunikationshistorik |
| `customer_notification_settings` | Notis-preferenser |
| `customer_invoices` | Fakturor |
| `customer_issue_reports` | Felanmälningar |
| `customer_change_requests` | Ändringsförfrågningar |
| `customer_booking_requests` | Bokningsförfrågningar |

#### Objektdomän

| Tabell | Beskrivning |
|--------|-------------|
| `objects` | Serviceobjekt (behållare, stationer, etc.) med koordinater, hierarki |
| `object_contacts` | Kontaktpersoner per objekt |
| `object_images` | Bilder (Object Storage) |
| `object_metadata` | Dynamiska metadatafält |
| `object_parents` | Hierarkisk trädstruktur |
| `object_payers` | Betalare per objekt |
| `object_articles` | Standardartiklar per objekt |
| `object_time_restrictions` | Tidsfönster, tömningsdagar, parkeringsförbud |

#### Arbetsorderdomän

| Tabell | Beskrivning |
|--------|-------------|
| `work_orders` | Arbetsordrar (50+ kolumner: status, pris, tid, koordinater) |
| `work_order_lines` | Orderrader med artiklar och pris (öre) |
| `work_order_objects` | Koppling order ↔ objekt |
| `order_checklist_items` | Checklista per order |
| `task_desired_timewindows` | Önskade tidsfönster |
| `task_dependencies` | Beroenden mellan ordrar |
| `task_dependency_instances` | Instansierade beroenden |
| `task_information` | Extra information per task |

#### Resursdomän

| Tabell | Beskrivning |
|--------|-------------|
| `resources` | Fältpersonal med kompetens, position, schema |
| `resource_articles` | Artiklar/kompetenser per resurs |
| `resource_availability` | Tillgänglighetskalender |
| `resource_positions` | GPS-positionshistorik |
| `resource_vehicles` | Koppling resurs ↔ fordon |
| `resource_equipment` | Koppling resurs ↔ utrustning |
| `resource_profiles` | Profilkonfigurationer |
| `teams` | Arbetslag |
| `team_members` | Lagtillhörighet |

#### Fordon & Utrustning

| Tabell | Beskrivning |
|--------|-------------|
| `vehicles` | Fordon med kapacitet (ton, volym), registreringsnummer |
| `vehicle_schedule` | Fordonsscheman |
| `equipment` | Utrustning med underhållsdata |
| `equipment_bookings` | Utrustningsbokning med kollisionskontroll |
| `fuel_logs` | Bränslelogg |
| `maintenance_logs` | Underhållslogg |

#### Ekonomi & Fakturering

| Tabell | Beskrivning |
|--------|-------------|
| `articles` | Artikelregister med pris (öre) |
| `price_lists` | Prislistor per kund/segment |
| `price_list_articles` | Artikelpriser per prislista |
| `invoice_configurations` | Faktureringsinställningar |
| `invoice_rules` | Faktureringsregler |
| `manual_invoice_lines` | Manuella fakturarader |
| `fortnox_config` | Fortnox-koppling |
| `fortnox_mappings` | Fortnox kontomappning |
| `fortnox_invoice_exports` | Exporterade fakturor |

#### Kluster & Planering

| Tabell | Beskrivning |
|--------|-------------|
| `clusters` | Geografiska kluster (auto-genererade per kund) |
| `planning_parameters` | Planeringsparametrar per tenant |
| `simulation_scenarios` | Simuleringsscenarier |
| `optimization_jobs` | Asynkrona optimeringsjobb |
| `scheduling_locks` | Planeringslås |
| `annual_goals` | Årliga målsättningar |

#### Kommunikation & Notiser

| Tabell | Beskrivning |
|--------|-------------|
| `portal_messages` | Kundportalmeddelanden |
| `driver_notifications` | Förar-notiser |
| `eta_notifications` | ETA-meddelanden |
| `push_tokens` | Push-notis-tokens |
| `status_message_templates` | Statusmeddelandemallar |
| `messages` | Interna meddelanden |

#### IoT & Sensorer

| Tabell | Beskrivning |
|--------|-------------|
| `iot_devices` | IoT-enheter |
| `iot_signals` | Sensorsignaler |
| `iot_api_keys` | API-nycklar för IoT |

#### Övriga

| Tabell | Beskrivning |
|--------|-------------|
| `audit_logs` | Ändringslogg |
| `import_batches` | Importbatchar (CSV, Modus) |
| `import_column_mappings` | Kolumnmappning vid import |
| `distance_cache` | L2-cache för avstånd |
| `api_usage_logs` | API-användningsstatistik |
| `api_budgets` | API-budgetgränser |
| `metadata_definitions` | Dynamiska metadatafält |
| `tenant_features` | Feature-flaggor per tenant |
| `tenant_branding` | White-label branding |
| `tenant_labels` | Anpassade etiketter |
| `subscriptions` | Prenumerationer/återkommande uppdrag |
| `deviation_reports` | Avvikelserapporter |
| `route_feedback` | Ruttfeedback |
| `environmental_data` | Miljödata |
| `predictive_forecasts` | Prediktiva prognoser |
| `time_logs` | Tidsregistrering |
| `work_sessions` | Arbetssessioner (Snöret) |
| `work_entries` | Arbetspass |

---

## 9. API-specifikation

### 9.1 Översikt — 800+ endpoints via 26 routefiler

Traivo One har en modulär API-arkitektur med 26 routefiler plus inline-routes i `routes.ts`:

| Routefil | Domän | Typiska endpoints |
|----------|-------|-------------------|
| `customerRoutes.ts` | Kunder | CRUD, sök, kontaktpersoner |
| `objectRoutes.ts` | Objekt | CRUD, hierarki, metadata, bilder, tidrestriktioner |
| `resourceRoutes.ts` | Resurser | CRUD, kompetens, tillgänglighet, position |
| `workOrderRoutes.ts` | Arbetsordrar | CRUD, status, linjer, objekt, checklists |
| `importRoutes.ts` | Import | CSV, Modus 2.0, mappade importer, OSRM-rutter |
| `optimizationRoutes.ts` | VRP | Optimera, status, simulering |
| `plannerRoutes.ts` | Planering | AI-planering, auto-schedule, disruption |
| `aiRoutes.ts` | AI | Konversation, analys, rekommendationer |
| `clusterRoutes.ts` | Kluster | CRUD, auto-cluster, sammanslagning |
| `configRoutes.ts` | Konfiguration | Tenant-inställningar, metadata, branding |
| `kpiRoutes.ts` | KPI & Rapporter | Dashboard-statistik, trender |
| `fortnoxRoutes.ts` | Fortnox | Konfiguration, export, mappning |
| `portalRoutes.ts` | Kundportal | Auth, objekt, bokning, meddelanden |
| `mobileRoutes.ts` | Fältapp | Dagordrar, status, GPS, arbetspass |
| `iotRoutes.ts` | IoT | Signaler, enheter, automatisk ordergenerering |
| `extendedRoutes.ts` | Utökade | Inspektioner, fakturering, flotta |
| `annualGoalRoutes.ts` | Årsplanering | Mål, uppföljning |
| `predictiveRoutes.ts` | Prediktiv | Prognoser, trender |
| `roiRoutes.ts` | ROI | Avkastningsberäkning, rapport |
| `disruptionRoutes.ts` | Avvikelser | Disruption-hantering |
| `feedbackLoopRoutes.ts` | Feedback | Uppskattad vs faktisk tid |
| `etaNotificationRoutes.ts` | ETA | Notiser till kunder |
| `urgentJobRoutes.ts` | Brådskande | Nearest technician, WebSocket |
| `featureRoutes.ts` | Feature-flaggor | Modulhantering |
| `orderConceptRoutes.ts` | Orderkoncept | Mallar, automatisering |
| `helpers.ts` | Hjälpfunktioner | Validering, tenant-utils |

### 9.2 Nyckel-API:er

#### Dashboard & Stats
```
GET  /api/dashboard/stats             Sammanfattande statistik
GET  /api/dashboard/alerts            Varningar (försenade, lediga resurser, dubbelbokning)
GET  /api/dashboard/capacity/:date    Kapacitetsutnyttjande per resurs
GET  /api/nav-badges                  Navigations-badges (oplanerade, olästa)
```

#### VRP-optimering
```
POST /api/ai/optimize-vrp             OR-Tools CVRPTW + ALNS (synkron/asynkron)
POST /api/ai/optimize-vrp/apply       Applicera optimeringsresultat
GET  /api/ai/optimization-job/:jobId  Status för asynkrona jobb
POST /api/optimization/jobs           Starta optimeringsjobb
GET  /api/optimization/jobs/:id/status  Hämta jobbstatus
GET  /api/optimization/jobs/:id/result  Hämta jobbresultat
POST /api/optimization/apply/:id      Applicera jobbresultat
POST /api/route-geometry              Ruttgeometri via Geoapify
POST /api/ai/optimize-routes          Ruttoptimering (NN-baserad)
```

#### AI-planering
```
POST /api/ai/auto-schedule            Automatisk schemaläggning
POST /api/ai/auto-schedule/apply      Applicera auto-schema
POST /api/ai/planning-suggestions     AI-planeringsförslag
GET  /api/ai/planning-analysis        Planeringsanalys
POST /api/ai/planner-chat             Konversations-AI för planering
POST /api/ai/planner-chat/execute     Exekvera AI-åtgärd
POST /api/ai/workload-analysis        Arbetsbelastningsanalys
POST /api/ai/field-assistant          Fält-AI-assistent
POST /api/ai/explain-anomaly          Förklara anomali
GET  /api/ai/route-recommendations    Ruttrekommendationer
GET  /api/ai/proactive-tips           Proaktiva tips
```

#### Mobil fältapp (100+ endpoints)
```
POST /api/mobile/login                Fältinloggning
GET  /api/mobile/my-orders            Dagens ordrar för resurs
GET  /api/mobile/orders/:id           Hämta specifik order
PATCH /api/mobile/orders/:id/status   Uppdatera orderstatus
POST /api/mobile/gps                  Rapportera GPS-position
POST /api/mobile/work-sessions/start  Starta arbetspass
PATCH /api/mobile/work-sessions/:id/stop  Stoppa arbetspass
POST /api/mobile/orders/:id/signature Sparar signatur
POST /api/mobile/orders/:id/materials Registrera materialförbrukning
POST /api/mobile/orders/:id/photos    Ladda upp foto
GET  /api/mobile/route-optimized      Optimerad rutt för dagen
GET  /api/mobile/statistics           Fältstatistik
POST /api/mobile/ai/chat              AI-assistent i fält
POST /api/mobile/ai/transcribe        Röst-till-text
POST /api/mobile/ai/analyze-image     Bildanalys
POST /api/mobile/sync                 Offline-synk
```

#### Kundportal
```
POST /api/portal/auth/request-link    Begär inloggningslänk
POST /api/portal/auth/verify          Verifiera token
GET  /api/portal/me                   Portalanvändarens profil
GET  /api/portal/objects              Kundens objekt
GET  /api/portal/orders               Kundens ordrar
POST /api/portal/booking-requests     Boka service
GET  /api/portal/messages             Portal-meddelanden
POST /api/portal/messages             Skicka meddelande
POST /api/portal/issue-reports        Felanmälan
GET  /api/portal/invoices             Kundens fakturor
GET  /api/portal/service-contracts    Serviceavtal
```

#### IoT
```
POST /api/iot/signals                 Ta emot sensorsignaler
GET  /api/iot/devices                 Lista IoT-enheter
```

---

## 10. UI/UX-design

### 10.1 Sidor (75+ implementerade)

Traivo One har **75+ implementerade sidor/vyer**, inklusive:

#### Planering & Drift
- **DashboardPage** — Översikt med QuickStats, varningar, kapacitet
- **WeekPlannerPage** — Veckoplanering med dnd-kit
- **RoutesPage** — Ruttoptimering med karta
- **AssignmentsPage** — Tilldelning av ordrar
- **OptimizationPrepPage** — Förberedelse före optimering

#### Fältapp
- **MobileFieldPage** — Komplett fältapp med offline-stöd
- **MyTasksPage** — Dagens uppgifter
- **WorkSessionsPage** — Arbetssessioner (Snöret)

#### Administration
- **ObjectsPage** — Objektförvaltning med kluster-badge
- **ResourcesPage** — Resurshantering
- **VehiclesPage** — Fordonshantering
- **ArticlesPage** — Artikelregister
- **PriceListsPage** — Prislistor

#### AI & Analys
- **AICommandCenterPage** — AI-styrcenter
- **AIPlanningPage** — AI-planering
- **PredictivePlanningPage** — Prediktiv schemaläggning
- **PredictiveMaintenancePage** — Prediktivt underhåll
- **EconomicsDashboardPage** — Ekonomisk översikt
- **ReportingDashboardPage** — Rapportering och KPI

#### Kund & Portal
- **CustomerPortalPage** — Kundportal med bokning
- **CustomerReportsPage** — Kundrapporter
- **PortalMessagesPage** — Portal-meddelanden

#### Konfiguration
- **SettingsPage** — Systeminställningar
- **TenantConfigPage** — Tenant-konfiguration
- **UserManagementPage** — Användarhantering
- **FortnoxSettingsPage** — Fortnox-integration
- **MetadataSettingsPage** — Dynamiska metadatafält
- **BookingSlotsAdminPage** — Bokningsslots
- **IndustryPackagesPage** — Branschpaket

### 10.2 Designsystem

- **Traivo Color Palette:** Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Font:** Inter
- **Mörkt/ljust läge:** Full dark mode med `dark:` Tailwind-klasser
- **Sidlayout:** `p-6 space-y-6` med `text-2xl font-semibold` rubriker
- **Responsiv:** `hidden md:table-cell` / `hidden lg:table-cell`, `flex-wrap` filter
- **EmptyState:** Återanvändbar komponent med ikon, titel, beskrivning, åtgärdsknapp
- **Komponenter:** shadcn/ui, Lucide React-ikoner

### 10.3 Pop-out-vyer

- **MonitorPopoutPage** — Kartövervakning för dual-screen
- **PlannerPopoutPage** — Planering i eget fönster
- **HistoricalMapPage** — Historiska rutter på karta

---

## 11. Replit-specifika Överväganden

### 11.1 Plattform

Traivo One körs på Replit med:
- **PostgreSQL** — Replit-hanterad databas
- **Object Storage** — Replit Object Storage för filer/bilder
- **Replit Auth** — Autentisering
- **OpenAI AI Integrations** — AI-funktioner
- **Resend** — Email-utskick

### 11.2 Prestandastrategier

- **Databas-indexering** — Strategiska index på tenant_id, status, datum
- **Server-side pagination** — Alla listor paginerade
- **Lazy loading** — Kartor och tunga komponenter
- **Distance cache** — L1 in-memory (50k entries) + L2 databas
- **SSE** — Server-Sent Events för realtidsuppdateringar
- **Asynkrona jobb** — VRP > 30 ordrar körs i bakgrunden

### 11.3 Python-mikrotjänst

OR-Tools-optimeringstjänsten (`optimization-service/`) körs som en **separat Python FastAPI-process**:
- `main.py` (650 rader) — CVRPTW med OR-Tools
- `alns.py` (729 rader) — ALNS-metaheuristik
- Kommunicerar via HTTP med Express-backenden
- DBSCAN pre-klustring med sklearn

---

## 12. Praktiska Enterprise-features (implementerade)

| Feature | Beskrivning | Implementation |
|---------|-------------|----------------|
| **Modus 2.0 Import** | Import från Modus-system med kolumnmappning | CSV-parser, import_batches, auto-geocoding |
| **CSV/Excel-import** | Batch-import med mappning | Flexibel kolumnmappning, validering |
| **Multi-tenant** | Full isolering per organisation | tenant_id på alla tabeller, middleware |
| **Feature-flaggor** | Moduler per tenant | tenant_features, moduleGuardMiddleware |
| **White-label** | Branding per tenant | tenant_branding, logo, färger |
| **Auto-kluster** | Automatiska kluster per kund | ensureClusterForCustomer(), rootCustomerId |
| **QR-felanmälan** | QR-kod → publik felanmälan | qr_code_links, public_issue_reports |
| **Signaturinsamling** | Digital signatur i fältapp | Canvas-baserad, Object Storage |
| **Materiallogg** | Registrera förbrukade artiklar | assignment_articles |
| **Dagrapport** | Sammanfattning av arbetsdag | DayReport-komponent, PDF via jsPDF |
| **Veckorapport** | Automatisk veckorapport | Scheduler, email via Resend |
| **ETA-notiser** | Kund-notis om beräknad ankomst | SMS (Twilio), email (Resend) |
| **Urgent jobs** | Brådskande jobbfördelning | Nearest-technician, WebSocket |
| **Feedback loop** | Uppskattad vs faktisk tid | route_feedback, automatisk justering |
| **Disruption service** | Event-driven avvikelsehantering | Omplanering, notiser |
| **Prediktiv analys** | Prognoser och anomalidetektering | predictive_forecasts, anomaly-monitor |
| **ROI-rapport** | Avkastningsberäkning | roi_share_tokens, delbar rapport |
| **Fortnox-export** | Faktura-export till Fortnox | fortnox_config, fortnox_mappings |
| **IoT-integration** | Automatisk ordergenerering från sensorer | iot_devices, iot_signals |
| **Smart break placement** | Intelligent rastplacering i VRP | BreakConfig med tidsfönster |
| **Offline-first fältapp** | Fungerar utan internet | offline_sync_log, localStorage |
| **Interaktiv Tour Guide** | Onboarding-guide | React Joyride |
| **Årsplanering** | Årliga mål och uppföljning | annual_goals |
| **Arbetssessioner (Snöret)** | Tidsregistrering | work_sessions, work_entries |

---

## 13. Feature Roadmap

### Implementerat (Nuvarande kodbasen)

Majoriteten av de ursprungliga 40 roadmap-features har implementerats, och systemet har utökats med ytterligare moduler:

| # | Feature-grupp | Status |
|---|---------|--------|
| 1–15 | MVP-features (CRUD, geocoding, optimering, mobilvy, auth) | ✅ Implementerat |
| 16–28 | Enterprise Fas 2 (import, CRM, inspektioner, rapporter, SMS) | ✅ Implementerat |
| 29–40 | Enterprise Fas 3 (OSRM, AI, team, integrationer) | ✅ Huvudsakligen implementerat |
| 41+ | Utökade features (IoT, Fortnox, ALNS, prediktiv, disruption) | ✅ Implementerat |

### Framtida utvecklingsområden

- React Native/Expo-baserad mobilapp (Traivo Go)
- Avancerad ML-baserad ETA-prediktion
- Bredare branschanpassning (hemtjänst, facility management)
- Global skalning (multi-region, multi-språk, multi-valuta)

---

## 14. Teknisk Arkitektur & Stack

### 14.1 Tech Stack

| Lager | Teknik | Detaljer |
|-------|--------|----------|
| Frontend | React 18 + TypeScript + Vite | 75+ sidor, 56k rader |
| UI | Tailwind CSS + shadcn/ui | Traivo-designsystem, dark mode |
| Karta | Leaflet + react-leaflet | RouteMap (763 rader) med OSRM-geometri |
| Drag-and-drop | dnd-kit | WeekPlanner, sorterbara listor |
| State | TanStack Query v5 | Server-state, cache-invalidering |
| Backend | Express.js + TypeScript | 26 routefiler, 30k rader |
| ORM | Drizzle ORM | 131 tabeller, PostgreSQL |
| Databas | PostgreSQL (Replit) | Full tenant-isolering |
| Validering | Zod + drizzle-zod | End-to-end typsäkerhet |
| AI | OpenAI (via Replit AI Integration) | GPT-4 för planering/analys |
| VRP | OR-Tools (Python FastAPI) | CVRPTW + ALNS (1379 rader) |
| Routing | OSRM → Geoapify → Haversine | Verkliga vägavstånd |
| Geocoding | Geoapify → Nominatim | Adress → koordinater |
| Email | Resend | Transaktionella email |
| SMS | Twilio | SMS-notiser |
| Auth | Replit Auth | SSO |
| Filer | Replit Object Storage | Bilder, dokument |
| PDF | jsPDF | Rapporter, protokoll |
| Väder | Open-Meteo API | Väderprognos i planering |

### 14.2 Projektstruktur (faktisk)

```
traivo-one/
├── client/                     # Frontend (React + TypeScript)
│   └── src/
│       ├── components/         # 100+ komponenter
│       │   ├── weekplanner/    # 14 subkomponenter
│       │   ├── RouteMap.tsx    # 763 rader
│       │   ├── EmptyState.tsx  # Återanvändbar
│       │   └── ...
│       ├── pages/              # 75+ sidor
│       ├── hooks/              # React hooks
│       ├── lib/                # Utilities, API-klient
│       └── App.tsx             # Router (wouter)
│
├── server/                     # Backend (Express + TypeScript)
│   ├── routes/                 # 26 routefiler (30k rader)
│   ├── route-optimizer.ts      # 1134 rader (NN + Geoapify VRP)
│   ├── vrp-constraints.ts      # 617 rader
│   ├── osrm-client.ts          # 283 rader
│   ├── dbscan-clustering.ts    # 300 rader
│   ├── distance-matrix-service.ts  # L1/L2-cache
│   ├── anomaly-monitor.ts      # Anomaliovervakare
│   ├── weekly-report.ts        # Veckorapport-scheduler
│   ├── notifications.ts        # WebSocket/SSE
│   ├── auto-cluster.ts         # Auto-klustring per kund
│   ├── tenant-middleware.ts    # Tenant-isolering
│   ├── feature-flags.ts        # Module guards
│   ├── storage.ts              # IStorage-gränssnitt
│   └── db.ts                   # Drizzle-anslutning
│
├── optimization-service/       # Python OR-Tools (FastAPI)
│   ├── main.py                 # 650 rader — CVRPTW
│   └── alns.py                 # 729 rader — ALNS
│
├── shared/
│   └── schema.ts               # 4879 rader — 131 tabeller
│
├── tests/
│   └── e2e/                    # Playwright-tester
│
└── attached_assets/            # Logotyp, dokument
```

### 14.3 Kodstorlek

| Modul | Rader |
|-------|-------|
| Datamodell (schema.ts) | ~4 900 |
| Backend routes | ~30 000 |
| Backend services | ~5 000 |
| Optimeringstjänst (Python) | ~1 400 |
| Frontend sidor | ~56 000 |
| Frontend komponenter | ~30 000 |
| **Totalt** | **~130 000+** |

---

## 15. Utvecklingsplan

### Status

Den ursprungliga utvecklingsplanen (Sprint 1–5+) är till största delen genomförd. Systemet fungerar som en funktionell prototyp med de flesta enterprise-features implementerade i kodbasen.

### Pågående utveckling

- Traivo Go (React Native/Expo mobilapp)
- Prediktiv analys & ML-förbättringar
- Utökad IoT-integration
- Produktdokumentation (denna fil)

---

## 16. Jämförelse: Traivo One vs Traivo Ruttplanering

### 16.1 Övergripande positionering

| | Traivo One | Traivo Ruttplanering |
|--|-----------|---------------------|
| **Typ** | Enterprise-fältsystem | Specialiserad enterprise-ruttoptimering |
| **Fokus** | Hela fältverksamheten (VRP är en modul) | Ruttoptimering i djupet |
| **Målgrupp** | Nordiska avfalls-/fältservicebolag | Stora flottor |
| **Enterprise-nivå** | ✅ Ja — som fältsystem | ✅ Ja — som ruttoptimering |

### 16.2 Detaljerad jämförelse

| Aspekt | Traivo One | Traivo Ruttplanering |
|--------|-----------|---------------------|
| **Systemtyp** | Enterprise-fältsystem | Specialiserad ruttoptimeringsplattform |
| **Ruttoptimering — algoritm** | OR-Tools CVRPTW + ALNS | ALNS med fler operatorer + AI/ML |
| **Ruttoptimering — kvalitet** | Hög (OR-Tools + ALNS) | Mycket hög (specialiserad + AI/ML) |
| **Constraints** | Tidsfönster, kompetens, kapacitet, beroenden | Utökade (EV, hållbarhet, multi-objektiv) |
| **Fältpersonalhantering** | ✅ Komplett | Begränsad |
| **Arbetsordrar** | ✅ Komplett (50+ fält per order) | Ej fokus |
| **Kundhantering** | ✅ CRM + portal + bokning | Ej fokus |
| **AI-integration** | ✅ OpenAI (planering, analys, konversation) | GNN, RL, Transformer-ETA |
| **IoT** | ✅ Automatisk ordergenerering | Ej fokus |
| **Fakturering** | ✅ Fortnox-export | Ej fokus |
| **Datamodell** | 131 tabeller | 18+ tabeller (ruttfokuserade) |
| **API:er** | 800+ endpoints | Ruttfokuserade endpoints |
| **Kodstorlek** | ~130 000 rader | ~15 000+ rader |

### 16.3 Positionering

```
┌──────────────────────────────────────────────────────────────┐
│                  TRAIVO PRODUKTFAMILJ                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  TRAIVO ONE                      TRAIVO RUTTPLANERING         │
│  ═══════════                     ═════════════════════        │
│  Enterprise-FÄLTSYSTEM            Enterprise-RUTTOPTIMERING   │
│                                                               │
│  ┌────────────────────┐         ┌────────────────────────┐   │
│  │ OR-Tools CVRPTW     │         │ Avancerad rutt-         │   │
│  │ + ALNS              │  kan    │ optimering               │   │
│  │ + OSRM/DBSCAN       │  upp-   │ + AI/ML                  │   │
│  │                     │  grade-  │ + EV-laddstrategi        │   │
│  │ 👥 Fältpersonal     │  ras    │                          │   │
│  │ 📋 Arbetsordrar     │  till   │ 🧠 Traivo Brain (AI)     │   │
│  │ 🏢 CRM + Portal     │        │ 🔄 Living Routes         │   │
│  │ 📊 KPI + Prediktiv  │        │ 🌱 Hållbarhet            │   │
│  │ 📱 Fältapp          │        │ ⚡ EV-laddstrategi       │   │
│  │ 🏭 IoT-integration  │        │ 📊 Pareto-optimering     │   │
│  │ 💰 Fortnox-faktura  │        │                          │   │
│  │ 🤖 AI-planering     │        │                          │   │
│  └────────────────────┘         └────────────────────────┘   │
│                                                               │
│  BRETT + avancerad rutt           DJUPT ruttfokuserat         │
│  = Hela fältverksamheten         = Bästa möjliga rutter       │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 17. Uppgraderingsväg & Integration

### 17.1 Ruttoptimering — Nuvarande kapacitet

Traivo One har redan en **avancerad ruttoptimeringsmotor** med OR-Tools CVRPTW + ALNS. Uppgradering till Traivo Ruttplanering behövs främst för:
- AI/ML-baserad realtidsoptimering
- EV-laddstrategiplanering
- Multi-objektiv Pareto-optimering
- 200+ fordon

### 17.2 Vad som delas

- **Samma teknikstack** — React, Express, TypeScript, Drizzle, PostgreSQL
- **Kompatibla VRP-modeller** — OR-Tools som gemensam grund
- **Gemensam kartlösning** — Leaflet + OSRM
- **Samma API-mönster** — RESTful, Zod-validering, multi-tenant

### 17.3 Migreringsscenarier

| Scenario | Lösning |
|----------|---------|
| Behöver AI/ML-optimering | Uppgradera ruttmodul till Traivo Ruttplanering |
| Behöver realtidstrafik | Lägg till HERE/TomTom-integration |
| Behöver EV-laddstrategi | Traivo Ruttplanering-modul |
| Nöjd med nuvarande VRP, vill ha mer fältfunktionalitet | Bygg ut Traivo One:s moduler |

---

## 18. Framtidsvision

### 18.1 Traivo One — Utvecklingspotential

Traivo One har redan implementerat det mesta som planerades. Framtida utveckling fokuserar på:

#### Kort sikt (6–12 månader)
- **Traivo Go** — React Native/Expo mobilapp för fältpersonal
- **Utökad AI** — ML-baserad ETA-prediktion, automatisk resursoptimering
- **Branschanpassning** — Specifika moduler för hemtjänst, fältservice

#### Medellång sikt (12–24 månader)
- **Global skalning** — Multi-region, multi-språk, multi-valuta
- **Avancerad BI** — Business Intelligence med trender och prognoser
- **Marketplace** — Tredjepartsmoduler och plugins

#### Lång sikt (24+ månader)
- **Traivo Ecosystem** — Traivo One som nav med plugins och moduler
- **Multi-objektiv optimering** — Pareto-optimal ruttplanering
- **Autonomous scheduling** — Helautomatisk schemaläggning med ML

### 18.2 Integration Traivo One ↔ Traivo Ruttplanering

```
┌────────────────────────────────────────────────────────┐
│           TRAIVO INTEGRERAD PLATTFORM                    │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │            TRAIVO ONE (Fältsystem)                 │ │
│  │  Kundhantering → Arbetsordrar → AI-Planering →     │ │
│  │  VRP-Optimering → Fältexekvering → Fakturering     │ │
│  └────────────────────────┬──────────────────────────┘ │
│                           │                             │
│                     ┌─────▼─────┐                       │
│                     │  RUTT-API  │  Abstrakt gränssnitt  │
│                     └─────┬─────┘                       │
│                           │                             │
│               ┌───────────┼───────────┐                 │
│               ▼                       ▼                 │
│  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │ OR-Tools CVRPTW      │  │ Traivo Ruttplanering     │  │
│  │ + ALNS               │  │ (Avancerad, AI/ML)       │  │
│  │ (Standard, robust)   │  │ 50–500 fordon            │  │
│  └─────────────────────┘  └─────────────────────────┘  │
│                                                         │
│  Kunden väljer ruttmotor baserat på behov och storlek   │
└────────────────────────────────────────────────────────┘
```

---

> **Kontakt:** Traivo-teamet  
> **Version:** 3.0 — Faktisk implementation (2026-04-10)
