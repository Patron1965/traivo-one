# TRAIVO GO — Systemskiss
### Fältservice-plattform för iOS & Android

---

## Översikt

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRAIVO GO — Mobilapp                         │
│               React Native / Expo (iOS + Android)               │
├──────────────────┬──────────────────┬───────────────────────────┤
│                  │                  │                           │
│  Orderhantering  │  Karta & Rutt    │  AI-assistent             │
│  ───────────────  │  ─────────────   │  ─────────────            │
│  8-stegs flöde   │  Trafikoptimerad │  Röststyrning (10 komm.)  │
│  Svep-gester     │  GPS-spårning    │  Chatt (GPT-5.2)          │
│  Delsteg         │  Team-positioner │  Bildanalys               │
│  Beroenden       │  Klustervy       │  Offline-fallback         │
│                  │                  │                           │
├──────────────────┼──────────────────┼───────────────────────────┤
│                  │                  │                           │
│  Inspektion      │  Tid & Pass      │  Team & Kommunikation     │
│  ───────────────  │  ─────────────   │  ─────────────────────    │
│  Checklistor     │  Arbetspass      │  Live-positioner           │
│  Foto före/efter │  Auto tidslogg   │  Materialdelning           │
│  Avvikelser      │  Statistik       │  Push-notiser              │
│                  │  Diagram         │  Rollhantering             │
│                  │                  │                           │
├──────────────────┼──────────────────┼───────────────────────────┤
│                  │                  │                           │
│  Offline-first   │  Inloggning      │  Kundsignering            │
│  ───────────────  │  ─────────────   │  ───────────────          │
│  Lokal cache     │  PIN-kod         │  Digital signatur          │
│  Auto-synk       │  E-post + PIN    │  Materialsammanställning   │
│  Outbox-kö       │  Användare+lösen │  Ordersammanfattning       │
│                  │  8 roller (RBAC) │                           │
│                  │                  │                           │
└──────────────────┴──────────────────┴───────────────────────────┘
                              │
                    REST API + WebSocket
                              │
┌─────────────────────────────────────────────────────────────────┐
│                Express.js Backend (Node.js)                     │
├──────────────────┬──────────────────┬───────────────────────────┤
│                  │                  │                           │
│  PostgreSQL      │  Traivo API      │  Externa tjänster         │
│  ───────────────  │  ─────────────   │  ─────────────────────    │
│  Tidsdata        │  40+ endpoints   │  OpenAI (AI/röst)         │
│  Push-tokens     │  Ordrar          │  Geoapify (rutt)          │
│  Inspektions-    │  Resurser        │  Open-Meteo (väder)       │
│  foton           │  Schemaläggning  │  Expo Push (notiser)      │
│                  │                  │                           │
└──────────────────┴──────────────────┴───────────────────────────┘
                                                │
                                        IoT-sensorer
                                      (autoskapade ordrar)
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

| Roll        | Åtkomst          |
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

## Teknikstack

- **Frontend:** React Native, Expo SDK 54, TypeScript, React Navigation 7, TanStack Query
- **Backend:** Express.js, Node.js, TypeScript, Socket.io
- **Databas:** PostgreSQL
- **AI:** OpenAI GPT-5.2, gpt-4o-mini-transcribe
- **Kartor:** Geoapify Routing API, react-native-maps
- **Deploy:** Statiska Metro-bundles, Expo Go via QR-kod
