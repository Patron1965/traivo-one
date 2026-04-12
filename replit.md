# Traivo GO — Mobilapp för fältpersonal

## Översikt
Traivo GO är en React Native/Expo-mobilapp för fältpersonal (förare/tekniker) inom nordisk avfallshantering. Appen är byggd för att fungera med Traivo One-backenden och erbjuder offline-first-funktionalitet, GPS-spårning, materialloggning, avvikelserapportering, realtidsuppdateringar via WebSocket, AI-assistent och komplett akut jobbhantering.

## Användarpreferenser
- **Språk:** Svenska (sv) i hela UI:t
- **Design:** Ren nordisk estetik med Traivo-paletten: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png`
- **Tema:** Ljust tema, nordisk stil
- **Font:** Inter
- **Målgrupp:** Förare och tekniker i fält — stort, lättläst, tummvänligt

## Systemarkitektur

### Tech Stack
- **Frontend:** React Native 0.79.7, Expo SDK 54.0.33, TypeScript
- **Backend:** Express.js (port 5000) — proxy/mock-server för Traivo One API
- **Navigation:** React Navigation 7+ (Native Stack + Bottom Tabs)
- **State/Data:** TanStack React Query, AsyncStorage för offline
- **Kartor:** react-native-maps 1.18.0 (pinnad version för Expo Go)
- **UI:** Feather-ikoner (@expo/vector-icons), Card-komponent, ThemedText/ThemedView
- **Listor:** @shopify/flash-list

### Byggprocess & Deploy
- **Dev server:** Port 8081 (Expo), Port 5000 (Express backend)
- **Statisk deploy:** Förbyggda metro-bundlar per plattform (`dist-metro/ios/`, `dist-metro/android/`)
- **Bygga bundlar:** `npx expo export:embed --platform ios/android ...`
- **Bygga server:** `npm run build` → `dist/index.cjs`
- **Deploy-kommando:** `node ./dist/index.cjs`
- **OBS:** Servern har no-cache headers på bundlar för att förhindra att telefoner cachelagrar gamla versioner

### Autentisering & RBAC
- **Mock-läge:** Token `mock-driver-token-001`, driverId=101, tenantId: `traivo-demo`
- **Live-läge:** Proxy mot Traivo One `/api/mobile/login`
- **8 roller:** owner, admin, planner, technician, user, viewer, customer, reporter
- **Fältapp-roller:** technician, planner, admin, owner, user (övriga blockeras)
- **24h auto-logout**

### Skärmar (client/screens/)
| Skärm | Fil | Funktion |
|-------|-----|----------|
| Hem | HomeScreen.tsx | Dashboard med dagsstatus, nästa uppdrag, teampartner, väder |
| Uppdrag | OrdersScreen.tsx | Orderlista med datumnavigering, filter, swipe-actions |
| Orderdetalj | OrderDetailScreen.tsx | Fullständig ordervy med statusflöde, tidtagning, artiklar, priser |
| Karta | MapScreen.tsx | Kartvy över dagens uppdrag med ruttinfo |
| AI-assistent | AIAssistantScreen.tsx | Chat med AI för fältfrågor |
| Avvikelse | ReportDeviationScreen.tsx | Rapportera avvikelser med foto och kategori |
| Material | MaterialLogScreen.tsx | Logga material per order |
| Inspektion | InspectionScreen.tsx | Kontrollmall med foto (före/efter) |
| Kamera | CameraCaptureScreen.tsx | Fototagning |
| Signatur | SignatureScreen.tsx | Digital signatur |
| Kundkvittering | CustomerSignOffScreen.tsx | Kundsignering |
| Statistik | StatisticsScreen.tsx | Förarstatistik |
| Ruttbetyg | RouteFeedbackScreen.tsx | Betygsätt dagens rutt |
| Team | TeamScreen.tsx | Teamöversikt |
| Mina avvikelser | MyDeviationsScreen.tsx | Historik över rapporterade avvikelser |
| Kundrapporter | CustomerReportsScreen.tsx | Kundrapporter |
| Att göra | TodoScreen.tsx | Personlig att-göra-lista (AsyncStorage, offline) |
| Dagsrapport | DayReportScreen.tsx | Sammanfattning av dagens arbete med dela-funktion |
| Aviseringar | NotificationsScreen.tsx | Push-aviseringar |
| Inställningar | SettingsScreen.tsx | Appinställningar |
| Login | LoginScreen.tsx | Inloggning |

### Komponenter (client/components/)
- **home/**: NextOrderCard, ProgressCard, WorkTimeCard, OrderPreviewList, TeamPartnerBanner, SyncStatusRow, BreakSuggestionCard, TenMinWarningCard, CarryOverBanner, StatisticsButton, WeatherWidget (oanvänd), VoiceCommandOverlay
- **urgent/**: UrgentJobModal, UrgentJobBanner
- **UI**: Card, ThemedText, ThemedView, StatusBadge, HamburgerMenu, OfflineIndicator, MockIndicator, ScreenErrorBoundary, ErrorBoundary

### API-versionering
- **v1-prefix:** Alla endpoints använder `/api/v1/` prefix (t.ex. `/api/v1/mobile/login`)
- **Bakåtkompatibilitet:** Gamla `/api/mobile/` fungerar fortfarande men skickar deprecation-headers
- **Sunset:** Unversioned endpoints fasas ut 2027-06-01
- **Discovery:** `GET /api/version` → `{ "current": "v1", "supported": ["v1"] }`
- **App-config:** `GET /api/v1/mobile/app-config` → feature flags, version check, tenant info
- **Version-check:** `GET /api/v1/mobile/version-check?version=x.y.z`
- **Client auto-migration:** `toV1Path()` i `query-client.ts` migrerar alla `/api/mobile/` → `/api/v1/mobile/` automatiskt

### API-endpoints (server/routes/mobile/)
| Modul | Fil | Endpoints |
|-------|-----|-----------|
| Auth | auth.ts | /login, /logout, /me |
| Ordrar | orders.ts | /my-orders?date=, /orders/:id, /orders/:id/status, /orders/:id/notes |
| Synk | sync.ts | /sync, /sync/status |
| Arbetspass | workSessions.ts | /work-sessions/* |
| Team | teams.ts | /my-team |
| GPS | misc.ts | /gps, /summary, /weather |
| Notiser | notifications.ts | /notifications, /notifications/token (WS token exchange) |
| Routing | routing.ts | Ruttberäkning |
| Akutjobb | urgentJobs.ts | /urgent-jobs/* |
| AI | ../ai.ts | /ai/chat, /transcribe, /analyze-image |
| Config | app.ts | /app-config, /version-check |

### Statusflöde (Order)
**Fältförar-flöde (4 steg):**
```
Tilldelad (planerad_resurs/planerad_las) → Starta resa (dispatched) → På plats (en_route) → Starta arbete (in_progress) → Slutför arbete (utford)
```

**Server-mappning:**
| Status skickad | executionStatus | Effekt |
|---|---|---|
| dispatched | dispatched | Startar travel-timer, ETA-notis till kund |
| en_route | on_way | Sätter onWayAt, startar on_site-timer |
| in_progress/paborjad | on_site | Sätter onSiteAt, startar working-timer |
| utford/completed | completed | Beräknar actualDuration, stänger alla timers |
| impossible | avbruten | Kräver impossibleReason |

**Avslutade statusar i "Klar"-filtret:** utford, completed, avslutad, fakturerad

### WebSocket (v1)
- **Anslutning:** Token exchange via `POST /api/v1/notifications/token` → `wss://<host>/ws/notifications?token=<ws-token>`
- **Heartbeat:** Skicka `{ type: "ping" }` var 30:e sekund, svar: `{ type: "pong", timestamp }`
- **Events (server→app):** connected, pong, job_assigned, job_updated, job_cancelled, schedule_changed, priority_changed, position_update, route_update, order:updated, anomaly_alert, route_optimized, optimization_complete, optimization_failed, notification
- **Events (app→server):** ping, position_update
- **Reconnect:** Exponentiell backoff (10s → 20s → 40s, max 5 min)

### Nyckeltyper (client/types/index.ts)
- **Order:** Fullständig ordermodell med cachedValue/cachedCost (öre), artiklar med resolvedPrice
- **Article:** artikelrad med resolvedPrice (öre)
- **Deviation:** avvikelserapport med foto, GPS, kategori
- **UrgentJob:** akut jobbhantering med deadline, distans, prioritet
- **Team/TeamMember:** teamstruktur med roller (member, leader, substitute)
- **InspectionItem:** kontrollpunkt med status, foton, kommentarer
- **GpsPosition:** GPS-data med speed, heading, accuracy
- **OptimizationJob:** asynkron ruttoptimering med progress

### Hjälpfunktioner (client/lib/)
- **format.ts:** `formatPrice(öre)` → "156,56 kr", `formatDuration(minuter)` → "45 min" eller "Ej angiven"
- **query-client.ts:** `apiRequest()`, `getApiUrl()` — centraliserad API-kommunikation

### Datumnavigering (OrdersScreen)
- Dag-för-dag-navigering med vänster/höger-pilar
- Visar "Idag", "Igår", eller veckodag+datum
- Max 7 dagar framåt
- Klick på datum → hoppa till idag
- Använder `?date=YYYY-MM-DD` query parameter mot API:t

### Offline & Synk
- Offline-first arkitektur med AsyncStorage/IndexedDB
- SyncStatusRow visar synkstatus
- Offline-buffring av GPS-positioner
- Synk-endpoint: `/api/mobile/sync`

### WebSocket
- Bridge till Traivo One för realtidsuppdateringar
- Akut jobb-event: `job:urgent:assigned`
- Statusuppdateringar och notifikationer i realtid

### Prishantering (KINAB-kompatibilitet)
- Alla prisvärden lagras i **öre** i databasen
- `formatPrice()` konverterar till kronor vid visning (÷100, sv-SE locale)
- Fält: `cachedValue`, `cachedCost` (order), `resolvedPrice` (artikel)
- Tidsuppskattningar: 0 eller null visas som "Ej angiven"

## Kända begränsningar
- Kartöverlagring (popup-positionering) kan behöva finjusteras
- WeatherWidget-komponenten finns men används inte
- Röstkommandon (VoiceCommandOverlay) har ingen synlig FAB-knapp (borttagen)

## Viktiga noteringar
- **Port-konflikter:** Port 5000 kan kräva `fuser -k 5000/tcp`
- **GitHub:** `git push github main --force` → `Patron1965/traivo-one.git`
- **Bundle-cache:** Servern skickar no-cache headers — stäng appen helt på telefonen för att få ny version
- **Felhantering:** Matchar mot HTTP-statuskoder (401, 403, 404, 500), inte felmeddelande-strängar
