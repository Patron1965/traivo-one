TRAIVO — KOMPLETT SYSTEMSAMMANFATTNING
======================================
AI-driven fältserviceplattform för nordiska företag
Fokus: Avfallshantering & Fastighetsservice
Status: Funktionell prototyp med pilotkund live

Framtagen av: Tomas Björnberg / Nordic Routing
Datum: Mars 2026


PLATTFORMSÖVERSIKT
==================
Traivo är en SaaS-plattform som digitaliserar och AI-optimerar fältservice-
verksamhet. Systemet ersätter manuell planering med AI-driven optimering och
ger realtidsstöd för ruttplanering, resursallokering, ekonomistyrning,
produktivitet och prediktiv analys.

Målgrupp: Nordiska fältserviceföretag (avfall, fastighet, teknisk service)
Affärsmodell: Multi-tenant SaaS med modulbaserade paketnivåer
Pilotkund: Live i produktion


TEKNISK ARKITEKTUR
==================
Frontend:       React 18 + TypeScript + Vite
Backend:        Express.js med modulär routerarkitektur
Databas:        PostgreSQL med Drizzle ORM
AI:             OpenAI GPT-integration
Kartor:         Geoapify + OpenStreetMap + react-leaflet
Faktura:        Fortnox API-integration
Notifieringar:  Resend (e-post) + Twilio (SMS) + WebSocket (realtid)
Fillagring:     Replit Object Storage
Autentisering:  Replit Auth med rollbaserad åtkomstkontroll

Kodstatistik:
- 137 854 rader TypeScript/TSX-kod
- 117 databastabeller
- 446 API-endpoints
- 72 frontend-sidor
- 62 UI-komponenter
- 21 backend-routerfiler
- 20 databasmigreringar


GENOMFÖRDA UTVECKLINGSUPPGIFTER
===============================

TASK #1 — Backend prestanda & kvalitet
--------------------------------------
Standardiserad server-side paginering för alla listendpoints.
Strukturerad felhantering med konsekventa felkoder och meddelanden.
Soft deletes (mjuk radering) för att bevara datahistorik.
Databasindex för förbättrad sökprestanda.

TASK #2 — AI-funktioner förbättringar
--------------------------------------
Ersatt mock-data med riktig API-data i alla AI-funktioner.
Persistent cache för AI-svar som minskar API-kostnader.
Förbättrad feedback-loop mellan planerare och AI-förslag.
AI Cards med kontextuella insikter på dashboard.

TASK #3 — Dashboard & UX-interaktivitet
----------------------------------------
Interaktiva Recharts-diagram med drill-down-funktionalitet.
Ruttjämförelse med visuell before/after-analys.
Väderpåverkan integrerad i planeringsvyn.
KPI-kort med realtidsuppdatering.

TASK #4 — Orderkoncept-wizard & Kundportal
-------------------------------------------
9-stegs wizard för att bygga orderkoncept:
  - Avrop (engångsbeställningar)
  - Schema (återkommande schemaläggning)
  - Abonnemang (prenumerationsberäkning)
Leveransschema-builder med frekvenshantering.
Kundportal med självbokning och orderhistorik.

TASK #5 — WeekPlanner-refaktorering
-------------------------------------
Uppdelning av monolitisk WeekPlanner i hanterbara underkomponenter.
Drag-and-drop schemaläggning med resursvy.
Förbättrad renderingsprestanda och underhållbarhet.

TASK #6 — Utföranderoller / Resursprofiler
--------------------------------------------
Profilsystem som kopplar resurser till kompetenser:
  - Utförandekoder (vilka uppgifter en resurs kan utföra)
  - Utrustningskoppling
  - Kostnadsställen och projektkoder
  - Tjänsteområden (postnummerbaserat)
Profilmallar för snabb tilldelning vid auto-planering.

TASK #7 — Snöret — Arbetspass & Tidsproduktion
-------------------------------------------------
Komplett arbetstidshantering:
  - Check-in/check-out med GPS-position
  - Tidsposter per arbetsorder
  - Vecklig tidsöversikt per resurs
  - Automatisk detektering av arbetstidsregelbrott
  - CSV-export av löneunderlag till lönesystem
  - Veckomålsöversikt med progressindikatorer

TASK #8 — Utrustningsdelning & Skiftkollisionskontroll
---------------------------------------------------------
Fordons- och utrustningsbokningssystem:
  - Kollisionsdetektering vid överlappande bokningar
  - Tillgänglighetstidslinje per fordon/utrustning
  - Koppling mellan resurser och fordon
  - Visuell vy för skiftplanering

TASK #9 — Interimobjekt & Objektverifiering
----------------------------------------------
Hantering av offentliga felanmälningar som temporära objekt:
  - isInterimObject-flagga på objekt skapade via QR-felanmälan
  - Admin-gränssnitt för verifiering och godkännande
  - Konverteringsflöde från interim till permanent objekt
  - Koppling till befintliga kunder

TASK #10 — IoT-API & Automatisk Ordergenerering
--------------------------------------------------
IoT-plattform för sensorbaserad fältservice:
  - Enhetshantering (sensorer, nivåmätare, vägceller)
  - API-nyckelhantering för externa IoT-system
  - Signalmottagning och tröskelövervakning
  - Automatisk generering av arbetsordrar vid tröskelvärden
  - Dashboard för IoT-enhetsöversikt

TASK #11 — SlotPreference — Tidsönskemål
-------------------------------------------
Utökade tidsrestriktioner på objektnivå:
  - Preferensfält (fördelaktig/ofördelaktig) med motivering
  - Visuell tidslinje för objektets tidsönskemål
  - Aggregerade preferenser vid orderplacering
  - Påverkar auto-planering och manuell schemaläggning

TASK #12 — Kundidentifiering i Orderkoncept
----------------------------------------------
Koppling av kund till orderkoncept med kundläge (customerMode).
Anpassar orderskapande och prislogik per kund.
Filtrering av objekt baserat på kundtillhörighet.

TASK #13 — Rollförtydligande — Kund & Anmälare
--------------------------------------------------
Tydligare separation av kundroller och anmälarroller genom systemet.
Påverkar behörigheter, vyer och notifieringslogik.

TASK #14 — Kartvy i Kundportalen
-----------------------------------
Interaktiv kartvy (react-leaflet + OpenStreetMap) för hämtningsställen.
Toggle mellan kortvy och kartvy i kundportalen.
Markörer med popup-information per hämtningsställe.

TASK #15 — Buggfix: Låsstatus i Orderlagret
----------------------------------------------
Fix av kritiskt fel där lås-knappen i OrderStockPage inte fungerade.
Korrigerad API-anrop och felhantering.

TASK #16 — Rebranding: Nordnav One → Traivo
----------------------------------------------
Fullständig rebranding genom hela kodbasen:
  - Ny logotyp (Traivo) med transparent bakgrund
  - Uppdaterade titlar, metadata och favicon
  - Ny färgpalett: Deep Ocean Blue, Arctic Ice, Mountain Gray,
    Northern Teal, Midnight Navy, Aurora Green
  - Alla textreferenser uppdaterade

TASK #23 — Rutt-feedback
--------------------------
System för förare att betygsätta dagens rutt:
  - Daglig 1-5 betygsättning med orsakskategorier
  - Fritext för detaljerad feedback
  - Rapporterings-UI med KPI-kort och trenddiagram
  - AI-fältassistent som kan fråga feedback-data
  - Historik och aggregerad analys

TASK #24 — Data Health Scorecard
----------------------------------
Visuell kvalitetsrapport vid Modus 2.0 CSV-import:
  - Datastatus per fält (komplett/delvis/saknas)
  - Valideringsresultat med felkategorisering
  - Rekommendationer för dataförbättring
  - Progressindikator under import

TASK #25 — Tenant-terminologi
-------------------------------
Branschanpassat språk i hela gränssnittet:
  - Konfigurerbar terminologi per tenant
  - Exempel: "Kärl" vs "Objekt" vs "Fastighet"
  - Påverkar menyer, rubriker, formulär och rapporter
  - Centraliserad terminologihantering i inställningar

TASK #27 — Onboarding / Kom igång-guide
------------------------------------------
Onboarding-flöde för nya användare:
  - Interaktiv guidad tour genom systemets huvudfunktioner
  - Steg-för-steg genomgång av arbetsflöden
  - Kontextuell hjälp som kan återaktiveras

TASK #28 — Rensa Demodata
----------------------------
Administrationsverktyg för att rensa demodata:
  - Selektiv rensning av testdata från databas
  - Skyddar konfigurationsdata vid rensning
  - Förberedelse inför produktionsanvändning

TASK #29 — Login Welcome Splash
----------------------------------
Välkomstskärm efter inloggning:
  - Personligt välkomstmeddelande
  - Snabbåtkomst till vanligaste funktionerna
  - Daglig statusöversikt
  - Senaste aktiviteter

TASK #30 — Branded Demo Experience
-------------------------------------
Tenant-anpassad demo och branding:
  - Snabb branding-editor i tenant-inställningar
  - Auto-scrape av färger och logotyp från kundwebbplats
  - Live preview av brandingändringar
  - Anpassad splash-screen per tenant

TASK #31 — Åtkomstkontroll & Inbjudningssystem
--------------------------------------------------
Komplett användarhanteringssystem:
  - Admin-CRUD för användare med rollhantering
  - Teamsystem med teamtillhörighet
  - Bulkåtgärder för användaradministration
  - Inbjudningssystem med e-postverifiering
  - Förhandsgodkännande av roller

TASK #32 — Framträdande "Skapa objekt"
-----------------------------------------
Förbättrad synlighet för objektskapande:
  - Prominent knapp i huvudnavigering
  - Strömlinjeformat skapandeflöde
  - Snabbare väg från idé till registrerat objekt

TASK #33 — Årsplanering: Kalendervy
--------------------------------------
12-månaders kalenderöversikt:
  - Visuell vy av planerade besök per månad
  - Kundfiltrering och objektfiltrering
  - Färgkodning baserat på uppfyllelsegrad
  - Klickbar navigation till detaljer

TASK #34 — Årsplanering: Årsmål & Uppföljning
-------------------------------------------------
Målstyrning per kund och objekt:
  - Definiera årliga besöksmål
  - Progressindikatorer med realtidsuppföljning
  - Statusöversikt (på plan / försenad / klar)
  - Avvikelserapportering

TASK #35 — Årsplanering: AI-driven Besöksfördelning
-------------------------------------------------------
AI-modell (OpenAI) för optimal planering:
  - Föreslår månadsfördelning av arbetsordrar
  - Respekterar säsongsrestriktioner (t.ex. ingen gräsklippning vintertid)
  - Hänsyn till resurskapacitet per period
  - Planeraren granskar och godkänner AI-förslaget

TASK #36 — PDF-rapport: Årsplanering
---------------------------------------
Automatisk PDF-generering (jsPDF) av årsplaneringen:
  - Funktionsöversikt med nyckeltal
  - Kund- och objektsammanställning
  - Grafik och tabeller
  - Möjlighet att ladda ner och dela

TASK #37 — Prediktivt Underhåll (AI + IoT)
---------------------------------------------
AI-driven prediktiv underhållsmodell:
  - Analyserar IoT-signalhistorik per objekt
  - Prognostiserar nästa servicedatum
  - Konfidensbetyg (0-100%) för varje prognos
  - Dashboard med prediktiv översikt
  - Automatisk larmning vid avvikande mönster

TASK #38 — ROI-rapport per Kund
----------------------------------
Generaliserad avkastningsrapport:
  - Beräknad från verklig användningsdata
  - Kostnadsuppdelning per tjänstetyp
  - Jämförelse mot budget/avtal
  - Delbar rapport med tokenbaserad åtkomst

TASK #39 — Funktionsflaggor per Tenant
-----------------------------------------
Modulbaserat licenspaketssystem:
  - 4 paketnivåer: Bas / Standard / Premium / Anpassad
  - tenantFeatures-tabell i databas med per-tenant moduler
  - Backend-cache med 60 sekunders TTL
  - Frontend FeatureProvider som filtrerar navigation
  - ProtectedRoute som blockerar oåtkomliga moduler
  - "Moduler"-flik i företagsinställningar
  - Delad moduldefinition i shared/modules.ts

TASK #41 — Constraint Engine & Decision Trace
-------------------------------------------------
Deterministisk valideringslager för AI-schemaläggning:

  Hårda constraints (blockerar tilldelning):
  - Låsta ordrar (manuellt låsta av planerare)
  - Beroendekedjor (uppgift A måste göras före B)
  - Tidsfönster (objektets öppettider/tidsrestriktioner)
  - Resurstillgänglighet (ledighet, sjukdom)
  - Fordonsscheman (fordon bokat av annan resurs)
  - Teamtillhörighet (resurs måste tillhöra rätt team)
  - Kompetenskrav (resurs måste ha rätt utförandekoder)

  Mjuka constraints (varnar men tillåter):
  - Kapacitetsöverbelastning (för mycket jobb per dag)

  Riskberäkning:
  - Score 0-1 baserat på saknad data, portkoder,
    resurshistorik och vädervariation
  - Visuell risknivå: Låg / Måttlig / Hög

  Beslutsspårning:
  - KPI-sammanfattning (körtid, ställtid, arbetsbalans)
  - Detaljerade flytt-skäl per order
  - Constraint-överträdelser med allvarlighetsgrad
  - Loggas till planning_decision_log-tabellen

TASK #42 — Schedule Diff View (AI-transparens)
-------------------------------------------------
Visuell diff-vy som gör AI-förslag genomskinliga:

  KPI-jämförelsetabell (Före / Efter / Delta):
  - Körtid i minuter
  - Ställtid i minuter
  - Övertid i minuter
  - Arbetsbalans (procentuell fördelning)
  - Riskindex (procentuell risknivå)
  Färgkodade deltaindikatorer (grönt = förbättring, gult = försämring)

  Flytt-kort per order:
  - Från-slot: resurs, dag, klockslag
  - Till-slot: resurs, dag, klockslag
  - Konfidensbetyg (0-100%)
  - Constraint-status (giltig/varning/överträdelse)
  - Expanderbara skäl till varje flytt

  Interaktion:
  - Acceptera/avvisa individuella förslag
  - "Tillämpa alla" för bulkgodkännande
  - "Bara ändringar"-filter
  - Risk-badge med expanderbara riskfaktorer
  - Constraint-violations-panel


ÖVRIGA GENOMFÖRDA ARBETEN
=========================

Standardiserad felhantering
  Enhetlig error-hantering med strukturerade felkoder genom hela backend.
  Konsekvent felmeddelande-format till frontend.

Typsäkerhet
  Ersatt alla 'any'-typer med riktiga TypeScript-typer.
  Stärkt typkontroll genom hela kodbasen.

Refaktorering av server-routes
  Uppdelning från monolitisk routes.ts till 21 modulära routerfiler.
  Varje domän (AI, kunder, objekt, m.fl.) har egen routerfil.

Mock-data borttagen
  All mock-data ersatt med riktiga API-anrop.
  Systemet arbetar uteslutande med verklig data.

Transparent logotyp
  Processad Traivo-logotyp utan bakgrund för universell användning.

Fortnox entitetsimport
  Full import av kunder, artiklar och resurser från Fortnox.
  Mappning mellan Fortnox-entiteter och Traivo-datamodell.
  Exporthistorik och batch-hantering.

Rollvisning i Auth
  Korrigerad tenant-roll i autentiseringssvar.
  Korrekt rollvisning i hela gränssnittet.

Server-kartplattor
  Kartplattor serverade via server-proxy för förbättrad prestanda.


SYSTEMFUNKTIONER — FULLSTÄNDIG ÖVERSIKT
=========================================

1. PLANERING & SCHEMALÄGGNING
   - WeekPlanner med drag-and-drop
   - AI Auto-Scheduling med constraint-validering
   - Auto-Fill Week med klustermedveten resurstilldelning
   - Årsplanering med AI-besöksfördelning
   - Haversine-baserad restidsberäkning
   - Frekvensbaserad schemaläggning
   - Veckomålsöversikt med progressbarer

2. AI & MASKININLÄRNING
   - AI Planning Assistant (konversationell)
   - AI Auto-Scheduling med Decision Trace
   - Constraint Engine med hårda/mjuka regler
   - Prediktivt underhåll från IoT-data
   - AI Command Center
   - AI-driven årsplaneringsfördelning
   - Riskberäkning (0-1 score)
   - AI Field Assistant (mobilapp)

3. KARTOR & GEOGRAFI
   - Planner Map med realtids-förarpositon
   - Ruttgeometri via Geoapify
   - Historisk kartvy med GPS-uppspelning
   - Kluster-baserad områdesindelning (5 strategier)
   - Geocoding (Geoapify + Nominatim)
   - Kartvy i kundportal

4. RESURSHANTERING
   - Resursprofiler med kompetenskoder
   - Team- och grupphantering
   - Fordonshantering (fleet management)
   - Utrustningsdelning med kollisionskontroll
   - Tillgänglighetshantering

5. ORDERHANTERING
   - Arbetsordrar med statusflöde
   - Orderkoncept (Avrop/Schema/Abonnemang)
   - Orderlagret med lås-/upplåsningsfunktion
   - Artikelhantering med prislisteresolvering
   - Strukturella uppgifter (sammansatta)
   - Uppgiftsberoenden
   - Pickup-tasks (automatgenererade)

6. KUNDHANTERING
   - Kundregister med kontaktpersoner
   - Kundportal 2.0 (självbetjäning)
   - Självbokning med tidsslots
   - Orderhistorik och kommande besök
   - Realtids-chatt kundportal ↔ planerare
   - ROI-rapport per kund

7. OBJEKTHANTERING
   - Hierarkisk objektstruktur med multi-parent
   - EAV-metadata (dynamiska fält)
   - Tidsrestriktioner och tidsönskemål
   - QR-baserad felanmälan (publik)
   - Interimobjekt med verifieringsflöde
   - Per-objekt artikelhantering

8. MOBIL FÄLTAPP
   - Komplett REST API för Driver Core
   - Offline-first arkitektur (IndexedDB)
   - GPS-positionsspårning i realtid
   - Signaturinsamling
   - Materialloggning
   - Fotouppladding (presigned URL)
   - AI-chatt och transkribering
   - Uppgiftsberoenden-vy
   - Väderdata

9. IoT & SENSORER
   - IoT-enhetshantering
   - API-nyckelhantering
   - Signalmottagning med tröskelvärden
   - Automatisk ordergenerering vid larm
   - Prediktiv underhållsmodell

10. EKONOMI & FAKTURERING
    - Fakturaförhandsgranskning och generering
    - Fortnox-export med batch-hantering
    - Exporthistorik
    - Prislistor med artikelkoppling
    - Prisöverridning vid orderskapande
    - ROI-rapporter

11. RAPPORTERING & KPI
    - Dashboard med interaktiva diagram
    - Reporting-sida med 7 flikar
    - Miljöstatistik och CO2-spårning
    - Årliga miljöcertifikat
    - API-kostnadsövervakning (admin)
    - Rutt-feedback med trendanalys
    - Data Health Scorecard

12. MULTI-TENANCY & KONFIGURATION
    - Full tenant-isolering (databas + API)
    - Modulbaserade funktionspaket (4 nivåer)
    - Branschanpassad terminologi
    - Branded demo-upplevelse
    - Branschpaket (fördefinierade mallar)
    - Onboarding-wizard för nya tenants
    - Företagsinställningar med full konfiguration

13. ANVÄNDARHANTERING
    - Rollbaserad åtkomstkontroll
    - Inbjudningssystem med e-post
    - Teamhantering
    - Admin-CRUD med bulkåtgärder
    - Åtkomstgrind (access gate)

14. NOTIFIERINGAR & KOMMUNIKATION
    - WebSocket realtidsnotifieringar
    - E-post via Resend
    - SMS via Twilio
    - Anomalidetektering med automatiska larm
    - Planerade meddelanden till utförare

15. IMPORT & INTEGRATION
    - Modus 2.0 CSV-import med validering
    - Fortnox entitetsimport/export
    - Geoapify routing & VRP-optimering
    - Open-Meteo väderdata
    - DataClean-tjänst (extern datavalidering)


DATABASTABELLER (117 st)
=========================
Ordrar:      work_orders, work_order_lines, work_order_objects, assignments
Objekt:      objects, object_articles, object_metadata, object_contacts,
             object_images, object_parents, object_payers, object_time_restrictions
Kunder:      customers, customer_invoices, customer_service_contracts,
             customer_booking_requests, customer_communications,
             customer_notification_settings
Resurser:    resources, resource_profiles, resource_articles, resource_equipment,
             resource_vehicles, resource_positions, resource_availability
Fordon:      vehicles, vehicle_schedule, equipment, equipment_bookings,
             fuel_logs, maintenance_logs
Planering:   planning_parameters, planning_decision_log, clusters,
             simulation_scenarios, annual_goals
IoT:         iot_devices, iot_signals, iot_api_keys, predictive_forecasts
Ekonomi:     price_lists, price_list_articles, invoice_configurations,
             invoice_rules, fortnox_config, fortnox_invoice_exports
Tenant:      tenants, tenant_features, tenant_branding, tenant_labels,
             tenant_package_installations, feature_audit_log
Användare:   users, user_tenant_roles, teams, team_members, invitations
Portal:      customer_portal_tokens, customer_portal_sessions,
             customer_portal_messages, portal_messages, self_bookings
Orderkoncept: order_concepts, order_concept_articles, order_concept_objects,
              concept_filters, delivery_schedules, subscriptions
Arbetspass:  work_sessions, work_entries, time_logs
Rapporter:   protocols, deviation_reports, route_feedback,
             environmental_data, setup_time_logs
Övriga:      articles, metadata_definitions, metadata_katalog,
             metadata_varden, metadata_historik, audit_logs,
             api_usage_logs, api_budgets, public_issue_reports,
             qr_code_links, checklist_templates, branding_templates,
             industry_packages, industry_package_data,
             import_batches, offline_sync_log, conversations, messages


EXTERNA BEROENDEN
==================
PostgreSQL          — Primär databas
Drizzle ORM         — Databas-ORM
OpenAI API          — AI-planering och konversation
Geoapify            — Routing, VRP-optimering, geocoding
OpenStreetMap       — Kartunderlag via Nominatim
react-leaflet       — Interaktiva kartor
shadcn/ui           — UI-komponentbibliotek
Recharts            — Diagram och grafer
Fortnox API         — Ekonomisystem-integration
Resend              — E-postnotifieringar
Twilio              — SMS-notifieringar
Open-Meteo          — Väderdata
jsPDF               — PDF-generering
Replit Object Storage — Fillagring
Replit Auth         — Autentisering
