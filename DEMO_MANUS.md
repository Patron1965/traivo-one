# Traivo One - Demo-manus

> Steg-för-steg guide vid genomgång av systemet.
> Total uppskattad tid: **45-60 minuter** (kan kortas till 25-30 min genom att hoppa över sektioner markerade med *).

---

## Innan du startar

- Logga in i systemet
- Kontrollera att det finns demodata (ordrar, objekt, resurser, kluster)
- Ha en sekundär skärm redo om du vill visa pop-out-kartläge
- Välj ljust eller mörkt tema via inställningsikonen (solikon i toppmeny)

---

## Del 1: Överblick och daglig styrning (5-7 min)

### 1.1 Dagens arbete (`/` eller `/home`)
**Navigera:** Klicka på Traivo-logotypen eller "Dagens arbete" i menyn.

**Visa:**
- Dagens uppgifter per resurs med status (planerad, pågående, utförd)
- Snabbåtgärder: skapa order, tilldela jobb

**Lyft fram:**
- "Det här är det första teknikern och planeraren ser varje morgon - en komplett bild av dagens arbete."

### 1.2 Dashboard (`/dashboard`)
**Navigera:** Klicka "Dashboard" i toppmenyn (bredvid Hem-ikonen), eller navigera direkt till `/dashboard`.

**Visa:**
- Produktionsöversikt: antal ordrar, aktiva resurser, kapacitetsutnyttjande
- Effektivitetsgrad och trender
- AI-drivna anomalivarningar
- Snabbknappar för vanliga åtgärder

**Lyft fram:**
- "Dashboarden ger realtidsöverblick utan att behöva gräva i data. AI:n flaggar automatiskt avvikelser."

---

## Del 2: Orderhantering (5-7 min)

### 2.1 Orderstock (`/order-stock`)
**Navigera:** Menyn > Ordrar > Orderstock

**Visa:**
- Sammanfattningskort: totalt antal ordrar, totalt värde (kr), total kostnad, total produktionstid
- Statusfilter-chips: Skapad, Preliminärt planerad, Resurs tilldelad, Låst, Utförd, Fakturerad, Omöjlig (med antal per status)
- AI Orderanalys (expanderbar sektion med AI-insikter)
- Sök bland ordrar med fritext
- Metadata-filter för avancerad filtrering
- Orderlista med adress, kund, värde, tid och status per order
- "Planera"-knapp per order för att tilldela resurs, team och datum
- Bulkåtgärder: markera flera ordrar → ändra status eller batch-planera
- Exportera CSV och AI Försäljningsanalys (skickas via e-post)
- Visa simulerade ordrar (toggle)
- Paginering (50 ordrar per sida)

**Lyft fram:**
- "Hela orderflödet hanteras här — från skapad till fakturerad. Varje steg är spårbart."
- "AI:n analyserar orderstocken och ger insikter direkt i vyn."

### 2.2 Abonnemang (`/subscriptions`)
**Navigera:** Menyn > Ordrar > Abonnemang

**Visa:**
- Återkommande serviceavtal med frekvens och nästa planerade datum

**Lyft fram:**
- "Abonnemang genererar ordrar automatiskt enligt schema - ingen manuell hantering."

### 2.3* Orderkoncept (`/order-concepts`)
**Navigera:** Menyn > Ordrar > Orderkoncept

**Visa:**
- Intelligenta ordergeneratorer som skapar ordrar baserat på regler
- Wizard för att skapa nya koncept

**Lyft fram:**
- "Orderkoncept automatiserar orderskapande utifrån affärsregler - skalbar orderhantering."

---

## Del 3: Planering - Hjärtat i systemet (8-12 min)

### 3.1 Veckoplanering (`/planner`)
**Navigera:** Menyn > Planering > Veckoplanering

**Visa:**
- Drag-and-drop av ordrar mellan resurser och dagar
- Dag/vecka/månadsvyer
- Oplanerade ordrar i sidopanel
- AI-förslag för optimal placering
- Konfliktindikatorer vid dubbelbokning eller kapacitetsöverskridande

**Lyft fram:**
- "Drag-and-drop gör planeringen intuitiv. AI:n föreslår automatiskt bästa placering baserat på geografi, kompetens och kapacitet."

**Wow-moment:** Dra en order till en resurs och visa hur systemet direkt beräknar påverkan.

### 3.2 Ruttplanering (`/routes`)
**Navigera:** Menyn > Planering > Ruttplanering

**Visa:**
- Välj datum och eventuellt kluster
- Klicka "Optimera rutter" - VRP-motorn beräknar optimala rutter
- "Före / Efter jämförelse"-kortet: verklig distans, tid, effektivitet
- Visa sparad körtid och distans i procent
- Expandera kartan och visa ruttgeometri

**Lyft fram:**
- "Ruttoptimeringen använder riktiga vägavstånd via OSRM och OR-Tools VRP-motor. Jämförelsen visar exakt hur mycket tid och bränsle som sparas."
- "Effektivitet = andel av dagen som är produktivt arbete vs. körtid."

**Wow-moment:** Visa före/efter-jämförelsen med verkliga besparingar i tid, distans och kostnad.

### 3.3 Väderplanering (`/weather`)
**Navigera:** Menyn > Planering > Väderplanering

**Visa:**
- Veckans väderprognos med påverkan på kapacitet
- Automatisk kapacitetsjustering vid dåligt väder
- Rekommendationer baserade på väderdata

**Lyft fram:**
- "Systemet anpassar automatiskt kapaciteten efter väder - snöstorm minskar kapaciteten, fint väder ökar den."

### 3.4* Årsplanering (`/annual-planning`)
**Navigera:** Menyn > Planering > Årsplanering

**Visa:**
- Långsiktig fördelning av besök över året
- Säsongsbaserad planering

**Lyft fram:**
- "AI:n fördelar tusentals besök optimalt över året med hänsyn till säsong och kapacitet."

---

## Del 4: Kartövervakning (3-5 min)

### 4.1 Planerarvy Karta (`/planner-map`)
**Navigera:** Menyn > Planering > Planerarvy Karta

**Visa:**
- Realtidskarta med resurser och deras positioner
- Klicka på resurser för att se deras dagliga rutt
- GPS-spårning av tekniker

**Lyft fram:**
- "Planeraren kan i realtid se var alla tekniker befinner sig och följa deras framsteg."

### 4.2* Historisk kartvy (`/historical-map`)
**Visa:**
- Historisk uppspelning av rörelsemönster
- Analys av faktiska vs. planerade rutter

**Lyft fram:**
- "Historiska data visar var det finns förbättringspotential i ruttplaneringen."

---

## Del 5: Fältarbetaren - Traivo Go (5-7 min)

### 5.1 Mobilapp (`/field`)
**Navigera:** Menyn > Fält > Mobilapp Fält (eller öppna `/field` direkt)

**Visa:**
- Dagens schema i mobilvy med stoppordning
- Starta/pausa/slutför jobb
- Fotodokumentation och signaturinsamling
- Materialloggning (artiklar och mängder)
- Avvikelserapportering med foton

**Lyft fram:**
- "Traivo Go är en PWA som fungerar offline. Teknikern ser sin rutt, dokumenterar arbetet, och allt synkas automatiskt när uppkopplingen kommer tillbaka."
- "Inga pappersprotokoll - allt digitalt direkt i fält."

**Wow-moment:** Visa offline-funktionaliteten - appen fungerar utan internet.

### 5.2 Arbetspass / Snöret (`/work-sessions`)
**Navigera:** Menyn > Fält > Arbetspass

**Visa:**
- Tidsloggning per tekniker och dag
- Start/sluttid, pauser, övertid
- Underlag för löneberäkning

**Lyft fram:**
- "Automatisk tidsregistrering kopplad till jobbstatus - inga tidrapporter att fylla i manuellt."

### 5.3* Besiktning (`/inspections`)
**Visa:**
- Sökbara besiktningsprotokoll med foton och signaturer

### 5.4* Kundportal (`/customer-portal`)
**Visa:**
- Extern portal där kunder kan se sina objekt, fakturor och rapportera ärenden
- QR-kodbaserad ärenderapportering

**Lyft fram:**
- "Kunder har sin egen portal med full insyn - minskar telefonsamtal och förbättrar servicen."

---

## Del 6: Grunddata (5-7 min)

### 6.1 Objekt (`/objects`)
**Navigera:** Menyn > Grunddata > Objekt

**Visa:**
- Lista med alla serviceobjekt (fastigheter, utrymmen)
- Klicka på ett objekt för detaljer: adress, koordinater, åtkomstkoder, nyckelhantering
- Klusterbadge som visar vilken geografisk grupp objektet tillhör
- Kartvy med alla objekt utplacerade
- Filter: status, typ, kluster, postnummer

**Lyft fram:**
- "Varje objekt har komplett information som teknikern behöver i fält - åtkomstkoder, kontaktuppgifter, historik."

### 6.2 Resurser (`/resources`)
**Navigera:** Menyn > Grunddata > Resurser

**Visa:**
- Personal med kompetenser, hemposition, tillgänglighet
- Kopplade artiklar (vad resursen kan utföra)
- Effektivitetsfaktor per resurs

**Lyft fram:**
- "Resurser har kompetenskoppling - systemet tilldelar bara jobb som teknikern faktiskt kan utföra."

### 6.3 Kluster (`/clusters`)
**Navigera:** Menyn > Grunddata > Kluster

**Visa:**
- Geografiska arbetsområden med automatisk klustring
- Klicka in på ett kluster: kartvyn, ingående objekt, SLA-mål
- Auto-kluster (`/auto-cluster`): AI-driven indelning

**Lyft fram:**
- "Kluster skapas automatiskt baserat på kundägande. AI:n grupperar objekt efter närhet och tidslogik."

### 6.4* Fordon och Fleet (`/vehicles`, `/fleet`)
**Visa:**
- Fordonsregister, bränsleförbrukning, underhållsschema

---

## Del 7: Ekonomi och analys (5-8 min)

### 7.1 Rapportering (`/reporting`)
**Navigera:** Menyn > Ekonomi & Analys > Rapportering

**Visa:**
- Produktions-KPI:er: slutförda ordrar, effektivitet, marginal
- Ruttfeedback-analys från tekniker
- Prediktionsprecision: hur väl AI-prognoser stämmer

**Lyft fram:**
- "Alla nyckeltal samlade på ett ställe. Vi mäter inte bara produktion utan även hur väl AI:ns prognoser träffar."

### 7.2 Ekonomi (`/economics`)
**Visa:**
- Intäkts- och kostnadsanalys per kund, kluster, resurs
- Marginalberäkning

### 7.3 Fakturering (`/invoicing`)
**Navigera:** Menyn > Ekonomi & Analys > Fakturering

**Visa:**
- Fakturagenerering baserad på utförda ordrar
- Fortnox-export
- Flerkund-fakturering

**Lyft fram:**
- "Fakturering är direkt kopplad till utfört arbete - ingen manuell hantering. Export till Fortnox med ett klick."

### 7.4 ROI-rapport (`/roi-report`)
**Visa:**
- Beräknad avkastning: sparad tid, bränsle, administration
- Per-kund-analys av lönsamhet

**Lyft fram:**
- "ROI-rapporten visar konkret i kronor vad optimeringen sparar - tid, bränsle och administration."

### 7.5* Proaktiv försäljning (`/proactive-sales`)
**Visa:**
- AI-identifierade försäljningsmöjligheter baserat på kunddata och historik

---

## Del 8: AI-funktioner (3-5 min)

### 8.1 AI-Assistent (`/ai-assistant`)
**Navigera:** Menyn > AI > AI-Assistent

**Visa:**
- Konversationsbaserad AI: ställ frågor om data, planeringsstöd
- Exempel: "Vilka kunder har flest ordrar denna månad?" eller "Föreslå optimering för fredag"

**Lyft fram:**
- "AI-assistenten förstår hela systemets data - ställ frågor på vanlig svenska och få svar direkt."

**Wow-moment:** Ställ en fråga och visa hur AI:n analyserar datan i realtid.

### 8.2 Prediktiv Planering (`/predictive-planning`)
**Visa:**
- AI-prognoser för framtida servicebehov
- Trendanalys baserad på historik

### 8.3* Prediktivt Underhåll (`/predictive-maintenance`)
**Visa:**
- IoT-signalbaserade prognoser för nästa servicetillfälle

---

## Del 9: Kundportalen (3-5 min)

### 9.1 Portalvy (`/portal`)
**Navigera:** Öppna `/portal` i en ny flik

**Visa:**
- Inloggning via e-post/verifiering
- Dashboard med kundspecifik översikt
- Klusteröversikt: kundens objekt och status
- Fakturor och avtal
- Ärenderapportering med foto
- ROI-rapport ur kundens perspektiv

**Lyft fram:**
- "Kundportalen ger full transparens. Kunden ser sina objekt, fakturor och kan rapportera ärenden direkt - white-label med kundens varumärke."

---

## Del 10*: Administration (2-4 min)

### 10.1 Företagsinställningar (`/tenant-config`)
**Visa:**
- Företagsinfo, varumärke/logotyp, terminologi (anpassningsbara begrepp)
- Modulhantering: aktivera/avaktivera funktioner per kund
- Etiketter, IoT-konfiguration

**Lyft fram:**
- "Multi-tenant med full white-label. Varje kund kan ha egen terminologi, logotyp och aktiverade moduler."

### 10.2 Användarhantering (`/user-management`)
**Visa:**
- Roller: Admin, Planerare, Tekniker
- Teamhantering och behörigheter

### 10.3 Import (`/import`)
**Visa:**
- CSV/Excel-import med mappning och validering
- Modus 2.0-import för befintliga system

**Lyft fram:**
- "Import från befintliga system med intelligent mappning - migrering utan manuellt arbete."

---

## Avslutning (2-3 min)

### Sammanfattning av nyckelvärden

1. **AI-driven optimering** - Ruttplanering, resursallokering och prediktiv analys
2. **Realtidsinsyn** - Kartövervakning, GPS-spårning, live dashboards
3. **Komplett fältlösning** - Traivo Go med offline-stöd, foto, signatur, protokoll
4. **Ekonomisk kontroll** - Fakturering, ROI-analys, marginalberäkning
5. **Kundportal** - Transparens och self-service för slutkunder
6. **Multi-tenant** - White-label, modulbaserat, anpassningsbar terminologi
7. **Integrationsstöd** - Fortnox, SMS, IoT, import från befintliga system

### Vanliga frågor att vara beredd på

| Fråga | Svar |
|-------|------|
| Hur hanteras offline? | Traivo Go cachar data lokalt (IndexedDB) och synkar automatiskt |
| Vilken kartdata används? | OSRM för riktiga vägavstånd, OpenStreetMap för kartor |
| Hur fungerar optimeringen? | OR-Tools VRP-motor med ALNS-förbättring, tidsfönster, kompetens och kapacitet |
| Kan kunder se sina egna data? | Ja, via kundportalen med white-label branding |
| Hur integreras med ekonomisystem? | Fortnox-export med ett klick, samt API för andra system |
| Hur snabbt kan man komma igång? | Import från befintliga system (CSV/Modus), onboarding-wizard |
| Stöd för flera företag? | Ja, full multi-tenant med isolerad data per kund |
| Hur hanteras väder? | Automatisk kapacitetsjustering baserad på Open-Meteo prognos |

---

> **Tips:** Sektioner markerade med * kan hoppas över vid kortare genomgångar.
> Anpassa ordningen efter publikens intresse - börja med det som är viktigast för dem.
