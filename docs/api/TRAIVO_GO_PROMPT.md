TRAIVO GO — CHAUFFÖRSAPP
========================
Projektprompt för att bygga den fristående mobilappen kopplad till Traivo-backend.


BAKGRUND
========
Traivo är en AI-driven fältserviceplattform (SaaS) för nordiska företag inom
avfallshantering och fastighetsservice. Plattformen har en fullständig backend
med 446 API-endpoints, 117 databastabeller och komplett mobilapp-API.

Traivo Go är den fristående mobilappen som fältarbetare (chaufförer, tekniker,
servicepersonal) använder dagligen. Appen ersätter papper, telefonsamtal och
manuell rapportering med ett digitalt arbetsflöde som synkar i realtid med
planerarens system.

Appen ska vara snabb, pålitlig och fungera offline. Den ska vara så enkel
att en chaufför kan lära sig den på 5 minuter.


MÅLGRUPP
========
- Chaufförer inom avfallshantering
- Fastighetstekniker
- Servicepersonal inom fältservice
- Nordiska marknaden (primärt Sverige)


TECH STACK (rekommenderad)
==========================
Framework:      React Native (Expo) eller Flutter
Språk:          TypeScript / Dart
State:          Zustand eller Riverpod
Offline:        WatermelonDB eller Hive (lokal DB)
Kartor:         react-native-maps eller Google Maps
Kamera:         expo-camera / image-picker
GPS:            expo-location med bakgrundsspårning
Push:           Firebase Cloud Messaging
Navigation:     React Navigation (stack + bottom tabs)
HTTP:           Axios med interceptors för auth
Signatur:       react-native-signature-canvas


BEFINTLIGT API (Traivo Backend)
===============================
Bas-URL: https://<traivo-domain>/api/mobile/
Auth: Bearer token via POST /api/mobile/login

AUTENTISERING
  POST   /api/mobile/login          — Inloggning med PIN eller e-post+PIN
  POST   /api/mobile/logout         — Utloggning, invalidera token
  GET    /api/mobile/me             — Hämta inloggad resurs/chaufför

ORDRAR & UPPGIFTER
  GET    /api/mobile/my-orders      — Dagens ordrar för inloggad resurs
  GET    /api/mobile/orders         — Alla ordrar (med filter)
  GET    /api/mobile/orders/:id     — Orderdetalj med objekt, artiklar, metadata
  PATCH  /api/mobile/orders/:id/status  — Uppdatera status (påbörjad/utförd/etc)
  PATCH  /api/mobile/orders/:id/substeps/:stepId — Uppdatera delsteg (strukturella uppgifter)

RAPPORTERING
  POST   /api/mobile/orders/:id/notes       — Lägg till anteckning
  POST   /api/mobile/orders/:id/deviations  — Rapportera avvikelse (typ, beskrivning, GPS, foton)
  POST   /api/mobile/orders/:id/materials   — Logga materialförbrukning
  POST   /api/mobile/orders/:id/signature   — Spara kundsignatur (base64)
  POST   /api/mobile/orders/:id/inspections — Spara inspektionsresultat

GPS & POSITION
  POST   /api/mobile/gps            — Skicka GPS-position (lat, lng, accuracy, speed)
  POST   /api/mobile/position       — Alternativ positionsendpoint

ARBETSPASS (Snöret)
  POST   /api/mobile/work-sessions/start      — Starta arbetspass (check-in)
  POST   /api/mobile/work-sessions/:id/stop   — Avsluta arbetspass (check-out)
  POST   /api/mobile/work-sessions/:id/pause  — Pausa arbetspass
  POST   /api/mobile/work-sessions/:id/resume — Återuppta arbetspass
  GET    /api/mobile/work-sessions/active      — Hämta aktivt arbetspass
  POST   /api/mobile/work-sessions/:id/entries — Skapa tidspost

AI-FUNKTIONER
  POST   /api/mobile/ai/chat           — AI-chatt (fråga om schema, kunder, m.m.)
  POST   /api/mobile/ai/transcribe     — Röst-till-text (Whisper)
  POST   /api/mobile/ai/analyze-image  — AI-bildanalys (skicka base64-bild)

SYNKRONISERING
  POST   /api/mobile/sync          — Bulk-synk av offline-köade händelser
  GET    /api/mobile/sync/status   — Synkstatus

ÖVRIGA
  GET    /api/mobile/summary       — Daglig sammanfattning (ordrar, avvikelser, tid)
  GET    /api/mobile/weather       — Väderdata (lat/lng)
  GET    /api/mobile/articles      — Artikellista
  GET    /api/mobile/orders/:id/checklist — Checklista för order
  GET    /api/mobile/notifications  — Notifieringar
  PATCH  /api/mobile/notifications/:id/read — Markera som läst
  PATCH  /api/mobile/notifications/read-all — Markera alla som lästa
  GET    /api/mobile/notifications/count    — Olästa antal
  GET    /api/mobile/route-feedback/mine    — Mina ruttbetyg
  POST   /api/mobile/route-feedback         — Betygsätt dagens rutt
  GET    /api/mobile/terminology            — Tenant-specifik terminologi

FOTOUPPLADDING
  POST   /api/field-worker/tasks/:id/upload-photo — Presigned URL-baserad fotouppladding


APPENS STRUKTUR & SIDOR
========================

1. INLOGGNINGSSKÄRM
   - PIN-inloggning (4-6 siffror) — snabb för chaufförer
   - Alternativt: e-post + PIN
   - Spara token lokalt, auto-login vid återbesök
   - Tenant-branding (logotyp, färger) om tillgängligt

2. HEMSKÄRM (Dashboard)
   - Välkomstmeddelande med namn
   - Dagens datum och väder
   - Snabbstatistik: antal ordrar idag, klara, kvar
   - Aktivt arbetspass-indikator (check-in status)
   - Check-in/check-out-knapp (stort, tydligt)
   - Olästa notifieringar-badge

3. ORDERLISTA (Dagens rutt)
   - Lista med dagens ordrar sorterade i ruttordning
   - Varje kort visar: ordernummer, adress, ordertyp, status
   - Färgkodad status (ej påbörjad / pågående / klar / avvikelse)
   - Pull-to-refresh
   - Filtrering: alla / ej startade / pågående / klara
   - Klickbar → orderdetalj

4. ORDERDETALJ
   - Fullständig orderinfo: kund, objekt, adress, artiklar
   - Planerade meddelanden från planerare (prominent visning)
   - Uppgiftsberoenden: "Gör A innan B"
   - Delsteg/checklista med avprickningsfunktion
   - Navigera-knapp → öppnar extern navigeringsapp
   - Stora tydliga actionknappar:
     a) "Starta" → sätter status till pågående
     b) "Rapportera avvikelse" → avvikelserapport
     c) "Logga material" → materialformulär
     d) "Fota" → kamera för dokumentation
     e) "Anteckning" → fritext-notering
     f) "Signatur" → kundsignatur
     g) "Inspektion" → inspektionsformulär
     h) "Klar" → sätter status till utförd

5. AVVIKELSERAPPORT
   - Typ: blockerad åtkomst / skadat objekt / fel artikel / övrigt
   - Beskrivning (fritext, eller röst-till-text via AI)
   - Fotodokumentation (kamera)
   - GPS-position bifogas automatiskt

6. MATERIALLOGGNING
   - Välj artikel från lista (sökbar)
   - Ange antal/mängd
   - Valfri kommentar

7. SIGNATURINSAMLING
   - Rityta för kundens signatur
   - Spara som base64
   - Koppling till aktuell order

8. INSPEKTIONSFORMULÄR
   - Dynamisk checklista baserad på ordertyp
   - Status per inspektionspunkt: OK / Varning / Underkänd
   - Kommentar och foto per punkt

9. RUTTBETYG (efter dagens sista order)
   - 1-5 betyg på dagens rutt
   - Orsakskategorier: för lång / för kort / logisk / ologisk / bra
   - Fritext-kommentar

10. ARBETSPASS (Snöret)
    - Check-in med GPS-position och klockslag
    - Paus/återuppta
    - Check-out
    - Visa dagens arbetstid löpande
    - Tidsposter per order (automatisk eller manuell)

11. AI-ASSISTENT
    - Chattvy för att fråga om schema, kunder, objekt
    - Röstinmatning (hold-to-talk → transkribering)
    - Fotoanalys: "Vad är fel med detta?"

12. NOTIFIERINGAR
    - Pushnotifikationer för nya ordrar, schemaändringar, meddelanden
    - In-app notifieringslista
    - Badge-räknare

13. PROFIL & INSTÄLLNINGAR
    - Visa namn, roll, kontaktinfo
    - Språkval (sv/no/fi/da/en)
    - Logga ut


OFFLINE-ARKITEKTUR (KRITISKT)
==============================
Appen MÅSTE fungera utan internetuppkoppling. Chaufförer kör i områden
med dålig täckning (skogar, tunnlar, landsbygd).

Princip: Offline-first
  1. Vid start: synka ner dagens ordrar, artiklar, terminologi till lokal DB
  2. Alla statusändringar, avvikelser, material, signaturer sparas lokalt först
  3. Bakgrundssynk skickar köade ändringar till servern när nät finns
  4. Konflikter: server wins (planeraren har sista ordet)
  5. Synkstatus-indikator synlig för chauffören (grön/gul/röd)

Offline-kö:
  Varje händelse sparas som en post i lokal kö med:
  - clientId (UUID genererad lokalt)
  - type: "status_update" | "deviation" | "material" | "gps" | "note" |
          "signature" | "inspection" | "photo"
  - payload: JSON med data
  - timestamp: när det hände
  - synced: false → true efter lyckad synk

  POST /api/mobile/sync tar emot hela kön som batch.


GPS-SPÅRNING
=============
  - Bakgrundsspårning var 30:e sekund under aktivt arbetspass
  - Skicka batch till /api/mobile/gps
  - Spara lokalt om offline
  - Visa enkel karta med dagens rutt (valfritt)


DESIGN & UX-PRINCIPER
======================
  - Stora knappar (minst 48x48dp) — handskar, solljus, stress
  - Hög kontrast — läsbart utomhus
  - Minimal text — ikoner och färger kommunicerar
  - Max 2 klick till huvudåtgärder
  - Vänsterhandsanpassat (de flesta håller telefon i vänster hand i fordon)
  - Haptic feedback vid viktiga åtgärder
  - Ingen horisontell scrollning
  - Svensk UI som standard, med stöd för norska/finska/danska/engelska

  Traivo-färgpalett:
  - Deep Ocean Blue: #1B4B6B (primär)
  - Arctic Ice: #E8F4F8 (bakgrund)
  - Mountain Gray: #6B7C8C (sekundärtext)
  - Northern Teal: #4A9B9B (accent/CTA)
  - Midnight Navy: #2C3E50 (mörka element)
  - Aurora Green: #7DBFB0 (framgång/klar)

  Statusfärger:
  - Ej påbörjad: grå
  - Pågående: blå (#1B4B6B)
  - Klar: grön (#7DBFB0)
  - Avvikelse: orange
  - Blockerad: röd

  Font: Inter (samma som Traivo web)


DATAMODELL (lokal)
==================
  Resource (inloggad användare):
    id, name, role, resourceType, email, phone, executionCodes[]

  WorkOrder (order):
    id, title, orderNumber, status, scheduledDate, scheduledStartTime,
    estimatedDuration, address, latitude, longitude, customerId,
    customerName, objectId, objectType, priority, description,
    articles[], substeps[], dependencies[], plannedNotes,
    deviations[], materialsUsed[], signature, inspections[]

  Article:
    id, name, unit, price, category

  OfflineQueueEntry:
    clientId, type, payload, timestamp, synced, retryCount

  GPSPoint:
    latitude, longitude, accuracy, speed, timestamp, synced

  WorkSession:
    id, startTime, endTime, status, pausedAt, totalPauseMinutes

  Notification:
    id, title, message, type, read, createdAt

  RouteFeedback:
    orderId, rating, reasons[], comment, date


SYNKRONISERINGSFLÖDE
====================
  Appstart:
    1. Kontrollera token → auto-login eller visa inloggning
    2. GET /api/mobile/me → verifiera resurs
    3. GET /api/mobile/my-orders → ladda ner dagens ordrar
    4. GET /api/mobile/articles → ladda ner artikellista
    5. GET /api/mobile/terminology → ladda ner terminologi
    6. GET /api/mobile/notifications/count → olästa
    7. GET /api/mobile/work-sessions/active → aktivt pass
    8. Starta bakgrundssynk av offline-kö

  Under dagen:
    - Varje statusändring/avvikelse/material → spara lokalt → köa för synk
    - GPS var 30s → samla → batch-skicka var 2 min
    - Pull-to-refresh på orderlista
    - Push-notifieringar triggar omladdning

  Kvällen:
    - Ruttbetyg-prompt efter sista ordern
    - Check-out arbetspass
    - Slutgiltig synk av all köad data


PUSH-NOTIFIERINGAR
==================
  Triggas från Traivo-backend via WebSocket/FCM:
  - Ny order tilldelad
  - Order omplanerad (resurs/dag ändrad)
  - Meddelande från planerare
  - Schemaändring
  - Systemmeddelande


SÄKERHET
========
  - Token-baserad auth (24h giltighet, förnyas vid aktiv användning)
  - PIN-inloggning (4-6 siffror, kopplad till resurs i backend)
  - Inga känsliga data cachade i klartext
  - GPS-data skickas enbart under aktivt arbetspass
  - Automatisk utloggning efter 24h inaktivitet
  - Certificate pinning (rekommenderat för produktion)


TESTFALL (minimum)
==================
  1. Inloggning med PIN → visa orderlista
  2. Starta order → status ändras till pågående
  3. Rapportera avvikelse med foto → synkas till backend
  4. Logga material → synkas till backend
  5. Samla signatur → synkas till backend
  6. Offline: gör statusändring → stäng av nät → slå på nät → verifirera synk
  7. GPS-spårning: starta arbetspass → verifiera positioner i backend
  8. Ruttbetyg: betygsätt → verifiera i backend
  9. Push: omplaner order i Traivo → notifikation i appen
  10. AI-chatt: ställ fråga → få svar


MILSTOLPAR
==========
  M1 — Grundflöde (2 veckor)
    Inloggning, orderlista, orderdetalj, statusändring, offline-kö

  M2 — Rapportering (1 vecka)
    Avvikelser, material, signatur, inspektion, foto

  M3 — Arbetspass & GPS (1 vecka)
    Check-in/out, GPS-spårning, tidsloggning

  M4 — AI & Notifieringar (1 vecka)
    AI-chatt, röstinmatning, push-notifikationer

  M5 — Polish & Release (1 vecka)
    Ruttbetyg, offline-robusthet, UX-polish, testning, app store-submission
