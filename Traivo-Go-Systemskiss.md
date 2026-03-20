# TRAIVO GO — Systemskiss
### Fältservice-plattform för iOS & Android

---

## Översikt

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TRAIVO GO — Mobilapp                                   │
│                     React Native / Expo (iOS + Android)                          │
├──────────────────┬──────────────────┬──────────────────┬────────────────────────┤
│                  │                  │                  │                        │
│  Orderhantering  │  Karta & Rutt    │  AI-assistent    │  Ruttbetyg             │
│  ───────────────  │  ─────────────   │  ─────────────   │  ──────────            │
│  8-stegs flöde   │  Trafikoptimerad │  Röststyrning    │  1-5 stjärnor          │
│  Svep-gester     │  GPS-spårning    │  Chatt (GPT-5.2) │  6 orsakskategorier    │
│  Delsteg         │  Team-positioner │  Bildanalys      │  Kommentar             │
│  Beroenden       │  Klustervy       │  Offline-fallback│                        │
│                  │                  │                  │                        │
├──────────────────┼──────────────────┼──────────────────┼────────────────────────┤
│                  │                  │                  │                        │
│  Inspektion      │  Tid & Pass      │  Team & Komm.    │  Terminologi           │
│  ───────────────  │  ─────────────   │  ──────────────── │  ──────────            │
│  Checklistor     │  Arbetspass      │  Live-positioner  │  Tenant-specifik       │
│  Foto före/efter │  Auto tidslogg   │  Materialdelning  │  30+ svenska termer    │
│  Avvikelser      │  Statistik       │  Push-notiser     │  API-fallback          │
│                  │  Diagram         │  Rollhantering    │                        │
│                  │                  │                  │                        │
├──────────────────┼──────────────────┼──────────────────┴────────────────────────┤
│                  │                  │                                           │
│  Offline-first   │  Inloggning &    │  Kundsignering                            │
│  ───────────────  │  Säkerhet        │  ───────────────                           │
│  Lokal cache     │  ─────────────   │  Digital signatur                          │
│  Auto-synk       │  PIN-kod         │  Materialsammanställning                   │
│  Outbox-kö       │  E-post + PIN    │  Ordersammanfattning                       │
│  Synkstatus      │  Användare+lösen │                                           │
│  (grön/gul/röd)  │  8 roller (RBAC) │                                           │
│                  │  24h auto-logout │                                           │
│                  │                  │                                           │
└──────────────────┴──────────────────┴───────────────────────────────────────────┘
                              │
                    REST API + WebSocket
                              │
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Express.js Backend (Node.js / TypeScript)                     │
├──────────────────┬──────────────────┬──────────────────┬────────────────────────┤
│                  │                  │                  │                        │
│  PostgreSQL      │  Traivo API      │  Externa tjänster│  IoT-sensorer          │
│  ───────────────  │  ─────────────   │  ─────────────── │  ──────────            │
│  Tidsdata        │  40+ endpoints   │  OpenAI (AI/röst)│  Autoskapade ordrar    │
│  Push-tokens     │  Ordrar          │  Geoapify (rutt) │                        │
│  Inspektions-    │  Resurser        │  Open-Meteo      │                        │
│  foton           │  Schemaläggning  │  (väder)         │                        │
│  Ruttbetyg       │  Terminologi     │  Expo Push       │                        │
│                  │                  │  (notiser)       │                        │
│                  │                  │                  │                        │
└──────────────────┴──────────────────┴──────────────────┴────────────────────────┘
```

---

## Exekveringsflöde per order

```
Ej startad → Resa startad → Framme → Arbete startat → Paus → Återupptagen → Klart → Signerad
```

---

## Realtidshändelser (WebSocket)

| Händelse             | Beskrivning                          |
|----------------------|--------------------------------------|
| job_assigned         | Nytt jobb tilldelat                  |
| job_updated          | Jobb uppdaterat                      |
| job_cancelled        | Jobb avbokat                         |
| schedule_changed     | Schema ändrat                        |
| priority_changed     | Prioritet ändrad                     |
| anomaly_alert        | Avvikelse upptäckt                   |
| position_update      | Teammedlems position                 |
| team:order_updated   | Teamorder ändrad                     |
| team:material_logged | Material loggat av teammedlem        |
| ping/pong            | Keepalive                            |

---

## Roller (RBAC)

| Roll        | Åtkomst           |
|-------------|-------------------|
| owner       | Full åtkomst      |
| admin       | Full åtkomst      |
| planner     | Fältapp + planering|
| technician  | Fältapp            |
| user        | Fältapp            |
| viewer      | Blockerad          |
| customer    | Blockerad          |
| reporter    | Blockerad          |

---

## Nya funktioner (senaste uppdatering)

| Funktion                | Beskrivning                                                        |
|-------------------------|--------------------------------------------------------------------|
| Ruttbetyg               | 1-5 stjärnor, 6 orsakskategorier, kommentar. Profil → Ruttbetyg   |
| Terminologi             | GET /terminology — 30+ tenant-specifika svenska termer             |
| 24h auto-utloggning     | Inaktivitet spåras vid API-anrop, appfokus. Kollas var 5 min       |
| Synkstatus-indikator    | Grön (synkad), gul (väntande), röd (offline) — synlig på hemskärm |
| GPS dual-endpoint       | POST /gps + POST /position — båda aktiva                          |
| Substeps PATCH          | PATCH /orders/:id/substeps/:stepId — avprickning av delsteg       |

---

## Teknikstack

- **Frontend:** React Native, Expo SDK 54, TypeScript, React Navigation 7, TanStack Query
- **Backend:** Express.js, Node.js, TypeScript, Socket.io
- **Databas:** PostgreSQL (tidsdata, push-tokens, inspektionsfoton, ruttbetyg)
- **AI:** OpenAI GPT-5.2, gpt-4o-mini-transcribe
- **Kartor:** Geoapify Routing API, react-native-maps
- **Deploy:** Statiska Metro-bundles, Expo Go via QR-kod
