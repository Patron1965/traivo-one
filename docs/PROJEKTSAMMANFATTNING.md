# Traivo – Sammanställning av alla projekttasks

_Senast uppdaterad: 2026-04-20_

Det här dokumentet är en tematisk översikt över alla tasks (#1–#169) som
hittills planerats eller utförts i Traivo-projektet (ursprungligen Nordnav
One; kort omdöpt till Plannix i april 2026, sedan återfört till Traivo).
Status motsvarar läget i projekttasklistan
just nu.

**Status-förkortningar**

- ✅ MERGED — implementerad och inmergead i main
- 🟡 PROPOSED — föreslagen, ännu inte påbörjad
- ❌ CANCELLED — avbruten / inte längre relevant

---

## 1. Plattform, branding & onboarding

| # | Titel | Status |
|---|-------|--------|
| #16 | Rebranding: Nordnav One → Traivo | ✅ |
| #152 | Byt namn från Traivo till Plannix (ångrad — återförd till Traivo) | ✅ |
| #18 | Transparent logga – ta bort bakgrund programmatiskt | 🟡 |
| #25 | Tenant-terminologi – branschanpassat språk | ✅ |
| #27 | Kom igång-guide för pilotkund | ✅ |
| #28 | Rensa demodata från databasen | ✅ |
| #29 | Login Welcome Splash Screen | ✅ |
| #30 | Branded Demo Experience – tenant-anpassad splash | ✅ |
| #31 | Åtkomstkontroll & Inbjudningssystem | ✅ |
| #39 | Funktionsflaggor per tenant (modul-paket) | ✅ |
| #40 | Fixa rollvisning – tenant-roll i auth-svar | ✅ |
| #117 | Språkväxlare Svenska/Engelska i TopNav | ✅ |
| #133 | Demo-manus för Traivo-systemgenomgång | ✅ |
| #134 | Funktionstest av alla "Visa"-punkter i demo-manuset | ✅ |
| #135 | Korrigera navigeringsinstruktion i demo-manuset | ✅ |
| #137 | Uppdatera produktdokument till faktisk implementation | ✅ |
| #150 | Demodata med denna veckas datum (mån–fre) | ✅ |

## 2. Backend, kvalitet & arkitektur

| # | Titel | Status |
|---|-------|--------|
| #1 | Backend prestanda & kvalitet – paginering, felhantering, soft deletes | ✅ |
| #17 | Refaktorera routes.ts (~19 850 rader → modulära routerfiler) | 🟡 |
| #19 | Ta bort mock-data – använd riktig API-data | 🟡 |
| #20 | Typsäkerhet – ersätt `any` med riktiga interfaces | 🟡 |
| #21 | Standardiserad felhantering med global error middleware | 🟡 |
| #52 | Performance-optimering | ✅ |
| #53 | Säkerhetshärdning & Tenant-isolering | ✅ |
| #54 | Frontend-optimering & Kodkvalitet | ✅ |
| #55 | Databaskonsolidering & Referensintegritet | ✅ |
| #56 | Förbättrad felhantering & UX-robusthet | ✅ |
| #142 | API-kontrakt & typbibliotek för Traivo Go | ✅ |
| #148 | WebSocket Eventkatalog – typade events med Zod | ✅ |
| #149 | API-versionering – `/api/v1/` prefix | ✅ |

## 3. Veckoplanering & WeekPlanner

| # | Titel | Status |
|---|-------|--------|
| #5 | WeekPlanner-refaktorering – uppdelning i underkomponenter | ✅ |
| #11 | SlotPreference – fördelaktiga/ofördelaktiga tider | ✅ |
| #15 | Buggfix: Lås-knappen fungerar inte i orderlagret | ✅ |
| #42 | Schedule Diff View – AI-transparens i WeekPlanner | ✅ |
| #48 | WeekPlanner Drag-and-Drop förbättringar | ✅ |
| #99 | Kompaktare planeringsvy för kontorsanvändning | ✅ |
| #101 | Fixa drag-och-släpp i veckoschemat | ✅ |
| #110 | Klickbar konfliktpanel i veckoplaneringen | ✅ |
| #111 | Restidsmedveten konfliktdetektering | ✅ |
| #140 | What-If konsekvensanalys i WeekPlanner | ✅ |
| #143 | Constraint Layer – synliga begränsningar i WeekPlanner | ✅ |
| #146 | Planner Control Tower – heatmap (beläggning & SLA-risk) | ✅ |

## 4. AI, constraint engine & beslutsstöd

| # | Titel | Status |
|---|-------|--------|
| #2 | AI-funktioner – riktig data, persistent cache, bättre feedback | ✅ |
| #41 | Constraint Engine & Decision Trace för AI-planering | ✅ |
| #43 | AI Budgetstyrning & Kapacitetshantering | ✅ |
| #45 | Dashboard – Alerts "Kräver uppmärksamhet" & Kapacitetsöversikt | ✅ |
| #46 | Smart AI-checklista & Fältvalidering före signering | ✅ |
| #51 | Smart resursallokering med AI | ✅ |
| #106 | Smart resursförslag baserat på kluster-tillhörighet | ✅ |
| #109 | AI Försäljningsanalys – e-postrapport | ✅ |
| #127 | Proaktiv försäljning – fixa datagrunden | ✅ |
| #147 | Chain Trace Panel – spårbarhet avtal→artikel→uppgift→resurs→faktura | ✅ |

## 5. Ruttoptimering, kartor & geografi

| # | Titel | Status |
|---|-------|--------|
| #14 | Kartvy för hämtningsställen i kundportalen | ✅ |
| #22 | Kartstil server-side – Geoapify-tiles i inline HTML | 🟡 |
| #23 | Rutt-feedback – förare betygsätter dagens rutt | ✅ |
| #78 | Fix Geoapify Route Planner `time_windows` NaN-bugg | ✅ |
| #79 | R1: Geografisk dagsklustring i veckoplanering | ✅ |
| #80 | R2: Geoapify Routing API i alla beslutsflöden | ✅ |
| #81 | R3: Händelsestyrd omoptimering vid störningar | ✅ |
| #82 | R4: Intelligent rastplacering i VRP | ✅ |
| #83 | R5: Feedback-loop – beräknat vs faktiskt | ✅ |
| #84 | R6: Kundnotifieringar – "vi är på väg" | ✅ |
| #85 | Polyline-verktyg synligt på kartan | ✅ |
| #92 | Ruttoptimering Fas 1: Constraint-integration i VRP | ✅ |
| #93 | Ruttoptimering Fas 2: Persistent avståndscache & geo-klustring | ✅ |
| #94 | Ruttoptimering Fas 3: Asynkrona optimeringsjobb | ✅ |
| #95 | Ruttoptimering Fas 4: Förbättrad UI & flerdagsplanering | ✅ |
| #97 | Pop-out kartövervakning | ✅ |
| #102 | Geografisk klustervalidering vid jobbtilldelning (Fas 1) | ✅ |
| #103 | Hård klusterblockering – förhindra tilldelning utanför verksamhetsområde | ✅ |
| #104 | Automatisk klustergenerering med AI-algoritm | ✅ |
| #105 | Visuell kartvy – klusterzoner & verksamhetsområden | ✅ |
| #107 | Fixa kartproblem i planerarens ruttvy (zoom + prestanda) | ✅ |
| #115 | Fix pop-out kartvy `jobsData`-krasch | ✅ |
| #120 | Kundbaserad auto-klustring från objekt | ✅ |
| #128 | OSRM-integration i optimeringsloopen | ✅ |
| #129 | DBSCAN-klustring med temporal medvetenhet | ✅ |
| #130 | Utökade ALNS-operatorer & lokal sökning (2-opt/or-opt) | ✅ |
| #131 | OSRM-optimering – geohash-cache, större L1, OSRM i besparingsberäkningar | ✅ |
| #132 | Beräkna verklig "Nuvarande"-statistik i Före/Efter-jämförelsen | ✅ |
| #153 | Fix: jobb utan koordinater syns inte i ruttvyn | ✅ |

## 6. Saknade koordinater & adressrättning (uppföljning till #153)

| # | Titel | Status |
|---|-------|--------|
| #155 | Geokodning vid skapande/uppdatering av objekt | ✅ |
| #158 | Visa varning i admin när objekt saknar koordinater | ✅ |
| #159 | Skicka notis när nya objekt fortfarande saknar koordinater | ✅ |
| #160 | Massredigera adresser direkt från listan | ✅ |
| #161 | Visa adressförslag medan du skriver | 🟡 |

## 7. Notiser (in-app, e-post, push)

| # | Titel | Status |
|---|-------|--------|
| #44 | SMS-kommunikation från orderkort & auto-notis "tekniker på väg" | ✅ |
| #154 | Batch planning status-notis | ✅ |
| #162 | Låt admin välja vilka som får notiser om saknade koordinater | ✅ |
| #163 | Visa i app när nya objekt saknar koordinater (in-app bell) | ✅ |
| #164 | Visa när och vart senaste koordinat-notisen skickades | 🟡 |
| #165 | Push viktiga notiser direkt till webbläsaren via WebSocket | ✅ |
| #166 | Egen sida som listar alla in-app-notiser med filter & historik | ✅ |
| #167 | Bestäm själv vilka notiser du vill få | 🟡 |
| #168 | Rensa gamla notiser automatiskt | ✅ |
| #169 | Visa hur mycket plats notiserna tar | ❌ |

## 8. Fältapp (Traivo Go) & SimpleFieldApp

| # | Titel | Status |
|---|-------|--------|
| #47 | Röstanteckningar (Voice-to-Text) i fältvyn | ✅ |
| #49 | Smart navigation i fältappen | ✅ |
| #50 | Snabbåtgärder i fältappen | ✅ |
| #65 | Komplettera Traivo Go – alla skärmar, offline & GPS | ✅ |
| #66 | Mobil-API för kundrapporter – Go-integration | ✅ |
| #67 | Auto-koppling: avvikelse → kundrapport | ✅ |
| #68 | SimpleFieldApp → mobil-API för avvikelser & kundrapporter | ✅ |
| #69 | SimpleFieldApp demodata – realistiska jobb | ✅ |
| #88 | Fas 1: Kritiska Traivo Go-fixar (HTTP-metoder, push-tokens, status, disruptions) | ✅ |
| #89 | Fas 2: Saknade mobil-API-endpoints (team, rutt, statistik, avstånd m.m.) | ✅ |
| #90 | Fas 3: Typsäkerhet och WebSocket för mobil-API | ✅ |
| #91 | Fas 4: Refaktorering, tester och Go-kompatibilitet | ✅ |
| #96 | Mobil-API: Preferenser, app-konfiguration & statistik-summary | ✅ |
| #136 | Att-göra-lista i Traivo Go + synk-instruktion | ✅ |
| #141 | Focus Mode i fältappen | ✅ |
| #144 | Outbox Center UI – synlig synkkö i mobilappen | ✅ |
| #145 | TimeThread Visual Timeline – visuell tidslinje i fältappen | ✅ |

## 9. Order, kundportal & säljflöde

| # | Titel | Status |
|---|-------|--------|
| #4 | Orderkoncept-wizard & kundportal – validering, bokningsalternativ | ✅ |
| #12 | Kundidentifiering – customerMode i orderkoncept | ✅ |
| #13 | Rollförtydligande – kund- & anmälarroller | ✅ |
| #32 | Framträdande "Skapa objekt" | ✅ |
| #38 | Generaliserad ROI-rapport per kund | ✅ |
| #86 | Fixa krasch på Orderstock-sidan (saknad Progress-komponent) | ✅ |
| #87 | Fix OrderStockPage-krasch – undefined komponent | ✅ |
| #100 | Snabbare akut jobbhantering – eskalering & 2-stegsflöde | ✅ |
| #118 | Prestandaoptimering orderkoncept-wizard | ✅ |
| #119 | Orderkoncept-wizard buggfixar (studsar tillbaka m.m.) | ✅ |

## 10. Resurser, skift & tidrapportering

| # | Titel | Status |
|---|-------|--------|
| #6 | Utföranderoller / Resursprofiler | ✅ |
| #7 | Snöret – Arbetspass, tidsposter & löneunderlag | ✅ |
| #8 | Utrustningsdelning & skiftkollisionskontroll | ✅ |

## 11. Årsplanering & prediktivt underhåll

| # | Titel | Status |
|---|-------|--------|
| #33 | Årsplanering – Kalendervy med 12-månadersöversikt | ✅ |
| #34 | Årsplanering – Årsmål & uppföljning per kund/objekt | ✅ |
| #35 | Årsplanering – AI-driven besöksfördelning | ✅ |
| #36 | PDF-rapport: Årsplanering – funktionsöversikt | ✅ |
| #37 | Prediktivt underhåll – AI-modell från IoT-historik | ✅ |

## 12. Objekt, fältdokumentation & kundrapporter

| # | Titel | Status |
|---|-------|--------|
| #9 | Interimobjekt & objektverifiering | ✅ |
| #10 | IoT-API & automatisk ordergenerering | ✅ |
| #57 | Byt "Interimobjekt" → "Rapporterat objekt" + tooltip | ✅ |
| #63 | Kund-fältdokumentation – QR-skanning, foto & ändringsrapporter | ✅ |
| #64 | Planerarvy & ändringshantering för kundrapporter | ✅ |
| #122 | Ta bort manuell ställtidsredigering från objektsidan | ✅ |

## 13. Import, datakvalitet & Kinab-spår

| # | Titel | Status |
|---|-------|--------|
| #24 | Data Health Scorecard – kvalitetsrapport vid import | ✅ |
| #26 | Fortnox: Importera artiklar, kostnadsställen och projekt | 🟡 |
| #58 | Förhandsgranskning & omdöpning vid import | ✅ |
| #59 | Selektiv modulär import (hoppa över / importera delar) | ✅ |
| #60 | Importöversikt med datakvalitetsvarningar efter import | ✅ |
| #61 | Byt namn Checklista-mallar → Kontrollmallar | ✅ |
| #62 | Funktionskontroll av hela importflödet | ✅ |
| #70 | Kinab Sprint 1 – Objekttyp & metadata-arkitektur | ✅ |
| #71 | Kinab Sprint 1 – Association tvåstegsfilter | ✅ |
| #72 | Kinab Sprint 2 – Artikellogik med metadata-koppling | ✅ |
| #73 | Kinab Sprint 2-3 – Trestegsimport | ✅ |
| #74 | Kinab Sprint 3 – Flerkund-fakturering & polylinje-stöd | ✅ |
| #75 | Kinab Sprint 4 – Växel-API & statusmeddelanden | ✅ |
| #76 | Kinab Sprint 5 – Växel-UI & tillgänglighetsvy | ✅ |
| #77 | Kinab Sprint 5 – Avancerad fakturahantering | ✅ |
| #108 | Åtgärda datakvalitet efter KINAB-import | ✅ |

## 14. Dashboard, navigation & UX-polish

| # | Titel | Status |
|---|-------|--------|
| #3 | Dashboard & UX – klickbara diagram, ruttjämförelse, väderpåverkan | ✅ |
| #98 | Smartare menynavigering – favoriter, rollfiltrering & badges | ✅ |
| #123 | Systematisk buggfixning och Playwright-testning | ✅ |
| #124 | Visuell polish och designkonsekvens | ✅ |

---

## Översiktlig statistik

- **Totalt:** ~135 unika tasks (#1–#169 med några överhoppade nummer)
- **MERGED:** ~115
- **PROPOSED (öppna):** 10 (#17, #18, #19, #20, #21, #22, #26, #161, #164, #167)
- **CANCELLED:** 1 (#169)

## De öppna förslagen i korthet

| # | Vad det handlar om | Varför det är kvar |
|---|--------------------|--------------------|
| #17 | Refaktor av `routes.ts` (~19 850 rader) till modulära routerfiler | Stort men inte blockerande – bättre att göra när nästa större backend-ändring ändå krävs |
| #18 | Programmatiskt göra Traivo-loggan transparent | Estetiskt, väntar på beslut om slutgiltig logga |
| #19 | Ta bort kvarvarande mock-data, använd riktig API-data överallt | Småfix, beror på vilka vyer som fortfarande har platshållare |
| #20 | Ersätt `any` i TS med riktiga interfaces | Kvalitetsförbättring, görs gradvis |
| #21 | Global error middleware med standardiserat svarsformat | Behövs när #17 görs för att inte dubbelarbeta |
| #22 | Geoapify-tiles server-side i inline HTML | Behövs först om vi vill bädda in kartor i mejl/PDF |
| #26 | Fortnox: importera artiklar, kostnadsställen och projekt | Avvaktar pilot-kund som faktiskt vill köra Fortnox-flödet |
| #161 | Adressförslag medan man skriver i listan över saknade koordinater | UX-förbättring för #160 |
| #164 | Visa när och vart senaste koordinat-notisen skickades | Komplement till #159/#162/#163 |
| #167 | Låt varje användare själv styra vilka in-app-notiser de får | Naturlig fortsättning på #163/#166 |
