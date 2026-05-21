# Degraded Mode Runbook (Task #524)

Detta dokument beskriver hur Traivo beter sig när externa integrationer går ner, hur du verifierar fallback-flöden i staging, och en checklista inför pilot.

## Översikt

En central health-service (`server/services/external-service-health.ts`) kontrollerar regelbundet:

| Integration | Severity | Vad används det till |
|-------------|----------|----------------------|
| Geoapify | critical | Routing, geokod, kart-tiles, VRP |
| Object Storage | critical | Bilder, signaturer, dokument |
| OpenAI | important | AI-förslag, protokoll, chat |
| Twilio | important | SMS-notiser till kund/tekniker |
| Resend | important | Transaktionsmail, magic-link |
| Fortnox (per tenant) | important | Fakturaexport, kund/artikel-sync |
| OSRM | optional | Fallback för rutter |

Status exponeras via `GET /api/system/integrations/health` och frontend pollar var 60:e sekund. När en `critical` eller `important` integration är `down`/`degraded`/`not_configured` visas en gul banner överst i appen med detaljer och dokumenterad fallback.

Health-check är medvetet "billig" — den verifierar att credentials är konfigurerade och (för Twilio/OSRM) att klienten kan instansieras. Den gör inte dyra live-anrop till varje API på varje request (cachas 60s) eftersom det skulle skapa onödig kostnad och rate-limit-press.

## Fallback per tjänst

### Geoapify (critical)

**Påverkade flöden:** Ruttoptimering (VRP, dagsrutter), avståndsmatris, geokod av nya adresser, kart-tiles i planneraren.

**Fallback:**
- `server/services/routing.ts` returnerar `null` när nyckel saknas — kallande kod använder Haversine-uppskattning (`server/route-optimizer.ts`, `calculateTotalDistance` → `calculateTotalDistanceHaversine`).
- Om `OSRM_BASE_URL` är satt används OSRM via `server/osrm-client.ts` som primär fallback för rutt-summaries.
- Kart-tiles faller tillbaka till OSM publik tile-server via `getMapTileConfig()`.
- VRP-anrop returnerar `{success:false, error:"Geoapify API-nyckel saknas..."}` — UI visar tydligt felmeddelande i optimeringsdialog.

**Vad fungerar:** Manuell schemaläggning, drag-and-drop i WeekPlanner, alla CRUD-operationer, mobil-appen för fältarbete.

**Vad fungerar inte:** Auto-optimerade rutter (VRP), nyskapade adresser saknar koordinater tills tjänsten är uppe, kartan visar OSM-tiles i stället för Geoapify-styling.

### Object Storage (critical)

**Påverkade flöden:** Uppladdning av foton, signaturer, fältrapporter, tenant-logos.

**Fallback:** Ingen — uppladdningsendpoints returnerar 500. Befintliga filer fortsätter att kunna läsas så länge ACL-data finns i DB.

**Vad fungerar:** All läsning av befintliga filer, jobb kan slutföras (bara foto-bevis saknas).

### OpenAI (important)

**Påverkade flöden:** AI-genererade arbetsförslag, dagsrapporter, chat-svar, kommunikationsförslag, prediktiv duration.

**Fallback:** Alla AI-routes kontrollerar nyckel — vid avsaknad returneras 503 med tydligt meddelande. UI visar "AI-tjänsten är tillfälligt otillgänglig". Inga jobb körs på spekulation.

**Vad fungerar:** All manuell planering, redigering, rapportering. Endast AI-förslag/genereringar pausas.

### Twilio (important)

**Påverkade flöden:** SMS-notiser (`unified-notifications.ts`, `customer-notifications.ts`, `extra-job-sms.ts`).

**Fallback:** `isTwilioConfigured()` kollas innan utskick. När `false` läggs `error` i resultatet utan att hela flödet kraschar. E-post via Resend skickas oavsett om båda kanalerna begärts.

**Vad fungerar:** E-postnotiser, portalmeddelanden, in-app-notifications.

### Resend (important)

**Påverkade flöden:** Transaktionsmail (bekräftelser, rapporter), magic-link-inbjudningar (`server/replit_integrations/auth/magicLinkAuth.ts`).

**Fallback:** Mail-utskick failar tyst — kallande kod loggar och fortsätter. Magic-link-inbjudningar kan inte skickas; använd Replit OIDC-login som backup för nya användare.

**Vad fungerar:** Befintliga sessioner, all in-app-funktionalitet. SMS via Twilio fortsätter.

### Fortnox (important, per tenant)

**Påverkade flöden:** Fakturaexport (`exportWorkOrderToFortnox`), kund/artikel-sync.

**Fallback:** `FortnoxClient.isConnected()` returnerar `false` när OAuth-token saknas/expirerat — export returnerar `{success:false, error:"Fortnox not connected..."}` utan att uppdatera WO-status. Arbetsordrar markeras färdiga men export-kön byggs upp för manuell omkörning.

**Vad fungerar:** All operativ verksamhet. Bara fakturaexport pausas.

### OSRM (optional)

**Påverkade flöden:** Fallback-rutter när Geoapify är nere.

**Fallback:** Haversine-uppskattning används som sista utväg. Restider blir grova.

## Verifiering i staging

Kör följande sekvens i staging för att verifiera att fallback-banner och flöden fungerar. **Kör aldrig detta i produktion.**

### 1. Geoapify nere

```bash
# Spara nyckeln
ORIG_KEY=$GEOAPIFY_API_KEY
# Avregistrera (eller sätt tom)
unset GEOAPIFY_API_KEY
# Restart workflow
```

**Förväntat:**
- Banner visas inom 60s: "Geoapify svarar inte just nu..."
- `GET /api/system/integrations/health` → `integrations[geoapify].status="not_configured"`, `overall="degraded"`
- Försök trigga VRP-optimering i planneraren → tydligt felmeddelande i dialogen, inga 500-stack-traces i UI
- Avståndsberäkningar i dagsrutt fungerar (Haversine)

**Återställ:** Sätt tillbaka `GEOAPIFY_API_KEY=$ORIG_KEY`, restart.

### 2. OpenAI nere

```bash
unset AI_INTEGRATIONS_OPENAI_API_KEY
# Restart
```

**Förväntat:**
- Banner visar OpenAI som degraderad
- Försök trigga AI-förslag → 503 med "AI-tjänsten är tillfälligt otillgänglig"
- All manuell planering fungerar

### 3. Twilio nere

I Replit Connectors-panelen: koppla bort Twilio-connector tillfälligt (eller sätt felaktiga credentials).

**Förväntat:**
- Banner visar Twilio som degraderad
- Skicka testnotis → e-post går iväg, SMS-fel loggas, ingen 500
- `checkSmsAvailability(tenantId)` → `available:false`

### 4. Resend nere

```bash
unset RESEND_API_KEY
# Restart
```

**Förväntat:**
- Banner visar Resend som degraderad
- Magic-link-formulär på `/login` returnerar 204 (säkerhetsmässigt), men ingen email skickas — logga `[magic-link] resend failed`
- Befintliga sessioner och Replit-login fungerar

### 5. Fortnox nere (per tenant)

I tenant-config → koppla bort Fortnox OAuth.

**Förväntat:**
- Banner visar Fortnox som degraderad för den tenanten
- Försök exportera arbetsorder → `{success:false, error:"Fortnox not connected..."}`
- All annan funktionalitet opåverkad

### 6. Object Storage nere

Detta är svårt att simulera utan att rivas hela bucketen. Verifiera i stället att uppladdningsendpoints returnerar 500 med tydligt felmeddelande när bucket inte finns (`PRIVATE_OBJECT_DIR` tom):

```bash
unset PRIVATE_OBJECT_DIR
# Restart
```

**Förväntat:**
- Banner visar Object Storage som degraderad
- Foto-uppladdning från mobilen → felmeddelande "Kunde inte ladda upp"
- Befintliga foton visas fortsatt

## Pilot-checklista

Kör denna lista i staging veckan innan pilot-start, dokumentera utfall, och eskalera avvikelser:

- [ ] `GET /api/system/integrations/health` returnerar `overall:"ok"` med alla tjänster gröna
- [ ] Banner visas korrekt när varje integration tas ner (steg 1–6 ovan)
- [ ] VRP-optimering fungerar end-to-end med live Geoapify
- [ ] AI-förslag genereras utan fel
- [ ] Test-SMS skickas via Twilio
- [ ] Magic-link-inbjudan tas emot
- [ ] Fortnox-export fungerar för en testfaktura
- [ ] Foto-uppladdning från mobil-appen lyckas
- [ ] Banner stängs och poll uppdaterar tillbaka till ok när tjänsten kommer tillbaka
- [ ] `/healthz` returnerar 200 med alla checks ok

## Operativa noter

- Health-status cachas 60s per integration — räkna med upp till 1 minuts fördröjning innan banner visas/försvinner.
- Banner kan stängas av användaren och förblir dold i 30 min (persistent via `localStorage`).
- Endast `critical` + `important` triggar banner. `optional` (OSRM) syns bara i detalj-vyn.
- För prod-monitoring: hooka in `/healthz` (Replit/uptime-robot) och lägg till en sekundär check mot `/api/system/integrations/health` om granulär alerting önskas.
