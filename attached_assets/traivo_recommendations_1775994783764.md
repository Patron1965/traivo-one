# Traivo – integrerad teknisk analys, Replit-prompt och förbättringsplan

## 1) Integrerad teknisk analys (repo + systemuppdatering)

### Sammanfattning
Traivo-landskapet består idag av två närliggande produkter:

- **traivo-one**: mer enterprise-orienterad, modulär backend, tydlig route/urgent-job-logik, WebSocket bridge mot upstream-system, fler operativa styrfunktioner.
- **traivo-go**: mer kompakt och snabbfotad mobilfokuserad implementation med stark och synlig AI-integration i användarflöden.

Båda bygger på:
- **Frontend**: React Native + Expo + TypeScript
- **Backend**: Express + Socket.IO
- **Data**: PostgreSQL + Drizzle (och mock-lägen)

Det bifogade dokumentet ("Traivo sytem uppdate") beskriver en målarkitektur som i praktiken är en **domändriven operativ styrmodell** (objekt, kluster, metadata, tidssnören, beroenden, exekvering, spårbarhet, fakturering).

### Hur dokumentets modeller mappar till nuvarande implementation

#### Struktur- och objektsmodell
- **Object Nexus™, AutoCluster Engine™, MetaMatrix™, Association Grid™**
- **Nuvarande läge:** Delvis implementerat via order/object-fält, kluster-ID, metadata-fält, team/tenant-room i WebSocket, samt ordertransformering i backend.
- **Gap:** Saknar en tydlig central domänmodell med versionerade regler för objekt/arv/associationer.

#### Tids- och planeringsmotor
- **TimeThread Engine™, Dynamic Time Shift™, Multi-Window Scheduler™, AutoLock Guard™**
- **Nuvarande läge:** Tid loggas via `time_entries`, statusflöden finns, route-optimering och disruption-trigger finns.
- **Gap:** Ingen enhetlig “time-thread” per resurs där segment, konflikter, lås och omräkning hanteras i samma kärna.

#### Order- och tjänstemodell
- **OrderConcept Builder™, Article Core™, Service Blueprint™, MetaTask Generator™**
- **Nuvarande läge:** Ordrar/artiklar/checklistor finns och fungerar operativt.
- **Gap:** Generering av uppgifter från regelstyrda orderkoncept är mer implicit än explicit versionerad modell.

#### Exekvering och resurskoppling
- **Execution Type Model™, Resource Thread Manager™, Execution Flow™**
- **Nuvarande läge:** Stark i båda repo (statusar, team, GPS, start/paus/slut, sign-off, mediaevidence).
- **Gap:** Regelmotor för utförandetyp och kapabilitetsval är inte centraliserad.

#### Optimering, avvikelse och spårbarhet
- **GeoFlow Optimizer™, Route Integrity Check™, Deviation Engine™, Association Trace™**
- **Nuvarande läge:** Route-optimering finns, avvikelser finns, notiser och feedback finns.
- **Gap:** End-to-end-spårbarhet (avtal→artikel→uppgift→resurs→utfall→fakturaunderlag) bör standardiseras och göras querybar.

### Övergripande teknisk slutsats
Nuvarande kodbas har hög funktionell bredd men innehåller parallella implementationsspår. Nästa mognadssteg är att gå från “feature collections” till **ett gemensamt domänkärna-lager** med tydliga kontrakt för:
- objekt/kluster/associationer
- tidssegment och omplanering
- uppgiftsgenerering
- spårbarhet och faktureringskoppling

---

## 2) Professionell Replit-prompt (copy/paste)

```markdown
Du är senior fullstackutvecklare och produktarkitekt. Hjälp mig vidareutveckla Traivo-plattformen i Replit med fokus på robust, modulär, produktionsredo implementation.

## Projektets syfte och vision
Traivo är ett operativt styrsystem för fältservice där affärsregler, objektstruktur, planering och exekvering binds ihop i realtid.
Målet är att:
1) optimera planering och utförande,
2) ge fälttekniker ett snabbt och pålitligt mobilflöde,
3) ge planerare hög överblick och styrbarhet,
4) skapa full spårbarhet från avtal/artikel till utfört arbete och faktureringsunderlag.

## Systemarkitektur
- Frontend (mobil): React Native + Expo + TypeScript
- Backend/API: Express + Socket.IO
- Databas: PostgreSQL + Drizzle ORM
- Realtid: Socket.IO event-rooms (tenant/resource/team)
- Integration: proxy/live mode mot Traivo API + mock mode

## Huvudfunktioner och komponenter
- Orderhantering: listor, detaljer, statusflöden, checklists, sign-off
- Tidsrapportering: work sessions + time entries
- Geografi/rutt: karta, route-beräkning, optimering, störningshantering
- Avvikelser och dokumentation: foto, rapport, kundförändringar
- Team och samarbete: teamvyer, invites, notifieringar
- AI-stöd: chat, röstkommandon, transkribering, bildanalys
- Offline-first: lokal cache, outbox/sync, nätverksresiliens

## Teknisk stack
- Mobile: Expo SDK 54, React Navigation, TanStack Query, AsyncStorage
- Backend: Node/Express, Socket.IO, Drizzle, pg
- API: REST + realtidsevents
- Kvalitet: TypeScript strict mode, enhetliga API-kontrakt, central felhantering

## Kom igång i Replit
1. Installera beroenden:
   - `npm install`
2. Starta backend/mobil runtime enligt repo:
   - traivo-one: `npm run dev`
   - traivo-go: `npm run start` (Expo)
3. Sätt miljövariabler:
   - `DATABASE_URL`
   - `TRAIVO_API_URL` (för live mode)
   - ev. `TRAIVO_MOCK_MODE=true` (för mock)
4. Verifiera hälsa:
   - `GET /api/health`
5. Kör databasmigrering vid behov:
   - `npm run db:push` (repo där script finns)

## Viktiga filer och mappar
- App-entry:
  - `App.tsx`
- Mobil klient:
  - `client/screens/*`
  - `client/navigation/*`
  - `client/hooks/*`
  - `client/lib/query-client.ts`
  - `client/types/index.ts`
- Backend:
  - `server/app.ts`
  - `server/routes/mobile/*`
  - `server/routes/ai.ts`
  - `server/routes/planner.ts`
  - `server/db.ts`
- Drift/build:
  - `package.json`
  - `scripts/*`
  - `replit.md`

## Utvecklingsworkflow
1. Läs alltid `replit.md` och befintliga routes/hooks innan ändringar.
2. Implementera i små, testbara steg med tydliga commits.
3. Håll API-kontrakt bakåtkompatibla.
4. Separera domänlogik från UI/transport-lager.
5. Lägg till loggning + felhantering kring kritiska flöden (sync, ws, statusändringar).
6. Verifiera manuellt:
   - orderflöde
   - offline/online synk
   - websocket events
   - route/tid/status
7. Uppdatera dokumentation efter varje större ändring.

## Arkitekturprinciper att följa
- En sann domänmodell (Object/Cluster/Task/TimeThread/Dependency)
- API-first och kontraktsdriven utveckling
- Offline-first i mobilappen
- Eventdriven realtid med tydlig idempotens
- Spårbarhet från plan till utfall till faktureringsunderlag
```

---

## 3) UX-förbättringsförslag

### A. Fälttekniker (mobilapp)

#### Nuvarande smärtpunkter
1. Många status-/delsteg ger kognitiv belastning under stress.
2. Offline-läge och synkstatus är inte alltid tillräckligt handlingsstyrande.
3. Orderdetaljvyer kan bli informationsmässigt tunga på små skärmar.
4. Tidsrapportering upplevs som implicit (risk för osäkerhet kring vad som faktiskt loggas).
5. Akuta jobb och omläggningar kan störa huvudflödet utan tydlig prioriteringsdialog.

#### Konkreta förbättringar (actionable)
- **Mobil “Focus Mode” per order**
  - Visa endast nästa kritiska handling + 1 sekundär handling.
  - Dölj avancerad metadata bakom "Mer info".
- **Tydlig offline-inkorg (Outbox Center)**
  - Egen skärm: väntande poster, felorsak, antal retry-försök, "skicka nu".
- **Tidslinje för arbete (TimeThread UI lite-version)**
  - Visa travel/on-site/work i enkel, visuell sekvens med manuell korrigering.
- **Akutjobb med konsekvenspreview**
  - Vid accept: visa påverkan på befintligt schema + ETA-förändring.
- **Röstkommandon med säkra bekräftelser**
  - “Du är offline, vill du köa denna åtgärd?”
  - “Detta ändrar status till Påbörjad, bekräfta?”
- **Snabbpanel i orderkort**
  - 3 primära CTA: Starta / Navigera / Rapportera avvikelse.

#### KPI:er att mäta
- Tid till “start task”
- Antal felaktiga statusändringar
- Andel lyckade first-try syncs
- Tid i app per order (mål: kortare men säkrare)

### B. Planerare

#### Nuvarande smärtpunkter
1. Översikten över resurser, beroenden och tidsfönster är fragmenterad.
2. Omläggningar saknar ibland tydlig påverkan-analys i förväg.
3. Prioriteringsregler (akut, låsta tider, beroenden) kan vara svåra att jämföra i samma vy.
4. Spårbarhet till affär/fakturering är inte tillräckligt direkt i planeringsgränssnittet.

#### Konkreta förbättringar (actionable)
- **Planner Control Tower-vy**
  - Samlad heatmap: beläggning, risk för SLA-brott, avvikelsetäthet.
- **What-if-omplanering**
  - Simulera flytt av jobb innan commit (visar konsekvens på ETA, kapacitet, resväg).
- **Constraint Layer**
  - Tydlig overlay för tidsfönster, beroenden, accesskrav, nyckelvillkor.
- **Resource Match-score**
  - Rankning av bäst resurs utifrån kapabilitet, geografi, belastning.
- **Chain Trace-panel**
  - Ett klick: avtal→artikel→uppgift→resurs→utfall→fakturaunderlag.

#### KPI:er att mäta
- Antal manuella omplaneringar per dag
- % uppdrag i tid (SLA)
- Planerartid per omplaneringsärende
- Andel jobb med korrekt resurstilldelning vid första planering

---

## 4) Rekommendationer för minskad systemkomplexitet

### 4.1 Konsolidering av traivo-one och traivo-go
1. **Definiera målbild: “One Core, Two Experiences”**
   - Gemensam domänkärna + API-kontrakt
   - Separata UX-lager vid behov (fält vs avancerad enterprise)
2. **Feature governance**
   - Klassificera features: Core / Optional / Experimental
3. **Gemensamt typbibliotek**
   - Flytta centrala typer (Order, Task, TimeSegment, Deviation, UrgentJob) till shared package.
4. **En WebSocket-eventkatalog**
   - Versionerade eventnamn och payloadschema.

### 4.2 Förenkling av dataflöden
1. **Canonical data model** för Order/Task/Resource/Object.
2. **En transform-layer** vid integration mot externa API:er.
3. **Idempotenta statusändringar** med operationId.
4. **Outbox pattern** standard i mobil för alla skrivoperationer.

### 4.3 Förbättrad dokumentation
1. **Living architecture docs** (C4 + domänmodeller + sekvensdiagram).
2. **Runbooks** för incidenter (sync-fel, ws-avbrott, API-timeouts).
3. **Feature cards** med syfte, dependencies, API, UX-konsekvens.
4. **Glossary**: svensk domänordlista (objekt, artikel, uppgift, tidsnöre osv).

### 4.4 Standardisering av API:er
1. **Konsekvent endpointdesign** (`/api/mobile/*`, `/api/planner/*`).
2. **Gemensam felmodell** (kod, användarmeddelande, debugId).
3. **Schema-validering** (Zod) på request/response i alla kritiska endpoints.
4. **API-versionering** för brytande ändringar.

### 4.5 Modularisering

#### Föreslagen modulindelning (alignad med systemuppdateringen)
- `domain-object` (Object Nexus, kluster, metadata, association)
- `domain-order` (OrderConcept, articles, services, task generation)
- `domain-time` (TimeThread, segment, dynamic shift, windows, locks)
- `domain-execution` (execution types, resource assignment, completion evidence)
- `domain-optimization` (routing, capacity, performance, disruption)
- `domain-billing-trace` (billing basis + association trace)

#### Leveransordning (90-dagarsplan)
- **Fas 1 (0–30 dagar):** kontrakt/typer/eventkatalog + gemensam felmodell
- **Fas 2 (31–60 dagar):** shared domänkärna för order/task/time + outbox-standard
- **Fas 3 (61–90 dagar):** planner control tower + chain trace + legacy cleanup

---

## 5) Prioriterad genomförandeplan (kort)

### Högsta prioritet (nu)
1. Gemensam datamodell och API-kontrakt.
2. Outbox/synk-standard för mobil.
3. Eventkatalog och WS-versionering.

### Nästa steg
1. TimeThread-kärna (segment + omräkning + konfliktlogik).
2. Planner “what-if” och constraint-vy.
3. Full chain-trace till faktureringsunderlag.

### Risker att hantera
- Dubbel implementation av samma logik i två repo.
- Skillnader i statusmapping mellan system.
- Växande teknisk skuld i mock/live-förgreningar.

---

## 6) Slutsats
Traivo har redan ett starkt operativt fundament. Den bifogade systemuppdateringen ger en tydlig målmodell för att ta nästa steg: från funktionsrik appsvit till en sammanhållen, domändriven plattform. Med konsoliderad kärna, standardiserade kontrakt och rollanpassad UX kan ni öka leveranshastighet, minska komplexitet och förbättra användarupplevelsen för både fälttekniker och planerare.
