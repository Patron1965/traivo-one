# Traivo — Genomförda Tasks

Sammanfattning av alla genomförda utvecklingsuppgifter i Traivo-plattformen.

---

## #1 — Backend prestanda & kvalitet
Paginering, felhantering och soft deletes. Servern fick standardiserad paginering för alla listor, bättre felmeddelanden och mjuk radering av poster.

## #2 — AI-funktioner förbättringar
Riktig data istället för mock, persistent cache för AI-svar, bättre feedback-loop i AI-planerarens förslag.

## #3 — Dashboard & UX-interaktivitet
Klickbara diagram, ruttjämförelse och väderpåverkan i dashboard. Recharts-diagram med drill-down och interaktiva KPI-kort.

## #4 — Orderkoncept-wizard & Kundportal
9-stegs wizard för orderkoncept (Avrop, Schema, Abonnemang) med validering och bokningsalternativ. Kundportal med självbokning.

## #5 — WeekPlanner-refaktorering
Uppdelning av WeekPlanner i underkomponenter för bättre underhållbarhet och prestanda.

## #6 — Utföranderoller / Resursprofiler
Profilsystem för resurser och team: utförandekoder, utrustning, kostnadsställen, projektkoder och tjänsteområden.

## #7 — Snöret — Arbetspass & Tidsproduktion
Komplett arbetspasshantering med in-/utcheckning, tidsposter, veckliga tidsöversikter, arbetslags-regelbrott och löne-CSV-export.

## #8 — Utrustningsdelning & Skiftkollisionskontroll
Spårning av fordons-/utrustningsbokningar, kollisionsdetektering och tillgänglighetstidslinje.

## #9 — Interimobjekt & Objektverifiering
`isInterimObject`-flagga för offentliga felanmälningar med admin-gränssnitt för verifiering och konvertering till permanenta objekt.

## #10 — IoT-API & Automatisk Ordergenerering
IoT-enhetshantering, API-nycklar och signaler. Automatisk generering av arbetsordrar baserat på sensorsignaler.

## #11 — SlotPreference — Fördelaktiga/Ofördelaktiga Tider
Utökade tidsrestriktioner på objektnivå med `preference` och `reason`-fält. UI för visualisering och aggregerade preferenser.

## #12 — Kundidentifiering — customerMode i Orderkoncept
Koppling av kund till orderkoncept med kundläge (customerMode) för att anpassa orderskapande per kund.

## #13 — Rollförtydligande — Kund & Anmälarroller
Tydligare separation av kundroller och anmälarroller genom hela systemet.

## #14 — Kartvy för Hämtningsställen i Kundportalen
Toggle mellan kortvy och kartvy (react-leaflet) för att visa hämtningsställen med markörer på OpenStreetMap.

## #15 — Buggfix: Lås-knappen i Orderlagret
Fix av "Kunde inte ändra låsstatus"-fel vid klick på lås-knappen i OrderStockPage.

## #16 — Rebranding: Nordnav One → Traivo
Fullständig rebranding genom hela kodbasen — logotyper, titlar, metadata, favicon och alla textreferenser.

## #23 — Rutt-feedback
Förare betygsätter dagens rutt med orsakskategorier, fritext och rapporterings-UI med KPI-kort och diagram. AI-fältassistent-verktyg för att fråga feedback-data.

## #24 — Data Health Scorecard
Visuell kvalitetsrapport vid Modus 2.0-import som visar datastatus, saknade fält och valideringsresultat.

## #25 — Tenant-terminologi
Branschanpassat språk i gränssnittet — konfigurerbar terminologi per tenant (t.ex. "Kärl" vs "Objekt").

## #27 — Kom igång-guide (Onboarding)
Onboarding-anpassat gränssnitt med guidad tour för nya användare och pilotkunder.

## #28 — Rensa Demodata
Verktyg för att rensa demodata från databasen inför produktionsanvändning.

## #29 — Login Welcome Splash Screen
Välkomstskärm efter inloggning med snabbåtkomst till vanliga funktioner.

## #30 — Branded Demo Experience
Tenant-anpassad splash och snabb branding med auto-scrape från kundwebbplatser. Live preview i inställningar.

## #31 — Åtkomstkontroll & Inbjudningssystem
Användarhantering med admin-CRUD, teamsystem, bulkåtgärder och inbjudningssystem med rollfördelning.

## #32 — Framträdande "Skapa objekt"
Mer synlig knapp och flöde för att skapa nya objekt direkt från huvudvyn.

## #33 — Årsplanering — Kalendervy
12-månadersöversikt med kalendervy för att visualisera årlig planering per kund/objekt.

## #34 — Årsplanering — Årsmål & Uppföljning
Uppföljning av årsmål per kund/objekt med progress-indikatorer och statusöversikt.

## #35 — Årsplanering — AI-driven Besöksfördelning
AI-modell (OpenAI) som föreslår optimal månadsfördelning av arbetsordrar med hänsyn till säsongsrestriktioner och resurskapacitet.

## #36 — PDF-rapport: Årsplanering
Generering av PDF-rapport med funktionsöversikt för årsplaneringen via jsPDF.

## #37 — Prediktivt Underhåll — AI-modell från IoT-historik
AI-driven prediktiv underhållsmodell som prognostiserar nästa servicedatum med konfidensbetyg baserat på IoT-signalhistorik.

## #38 — ROI-rapport per Kund
Generaliserad ROI-rapport beräknad från verklig användningsdata per kund.

## #39 — Funktionsflaggor per Tenant (Modul-paket)
Modulbaserat funktionspaket med 4 nivåer (Bas/Standard/Premium/Anpassad). `tenantFeatures`-tabell, backend-cache, frontend FeatureProvider och ProtectedRoute.

## #41 — Constraint Engine & Decision Trace
Deterministisk constraint-validering för AI-schemaläggarens förslag. Hårda constraints (låsta ordrar, beroendekedjor, tidsfönster, resurs­tillgänglighet, fordonsscheman, team, kompetens) och mjuka constraints (kapacitetsöverbelastning). Risk­score-kalkylator (0–1). Beslutsspår med KPI-sammanfattning, flytt-detaljer, constraint-överträdelser och riskfaktorer. Allt loggas till `planning_decision_log`-tabellen.

## #42 — Schedule Diff View — AI-transparens
Visuell diff-vy i WeekPlanner som visar AI-schemaläggarens förslag med:
- KPI-jämförelsetabell (Före/Efter/Delta) för körtid, ställtid, övertid, arbetsbalans och riskindex
- Flytt-kort med från/till-slot (resurs, dag, tid), konfidens, constraint-status och expanderbara skäl
- Risk-badge med per-faktor-ikoner och constraint-violations-panel
- Per-flytt acceptera/avvisa utan att rensa hela förslaget
- "Bara ändringar"-filter

---

## Övriga genomförda arbeten (utan task-nummer)

- **Standardiserad felhantering** — Enhetlig error-hantering genom hela backend
- **Typsäkerhet** — Ersatt `any` med riktiga TypeScript-typer
- **Refaktorera routes.ts** — Modulära routerfiler istället för monolitisk routes.ts
- **Ta bort mock-data** — Övergång till riktig API-data
- **Transparent logga** — Processad logotyp utan bakgrund
- **Fortnox entitetsimport** — Full import av kunder, artiklar och resurser från Fortnox
- **Fixa rollvisning** — Tenant-roll i auth-svar
- **Server-kartplattor** — Kartplattor via server-proxy
