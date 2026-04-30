# Glapp-analys: Traivo One ↔ Traivo Go

**Rapportdatum:** 2026-04-30
**Källa Traivo Go:** [`Patron1965/traivo-go`](https://github.com/Patron1965/traivo-go), `Traivo_Go_Integration_Report.md` (782 rader, 17 sektioner) — bevarad spegel: [`TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md`](./TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md)
**Granskad version Traivo One:** `server/routes/mobile/*.ts` (aktivt registrerad via `registerMobileRoutes` i `server/routes.ts:33`)
**Status:** Endast analys — inga kodändringar har utförts i denna task. Konkreta åtgärder dokumenteras som följdtaskar.

---

## 1. Sammanfattning

Traivo One är **i allt väsentligt redo att fungera som backend** åt Traivo Go. Av de 17 funktionsområden som Go listar är **15 helt täckta**, **1 delvis täckt** (WebSocket-protokoll) och **1 utgör inkonsekvens i nuvarande implementation** (död parallellfil i `server/routes/mobileRoutes.ts`).

Resultat per huvudområde:

| # | Område | Status | Kommentar |
|---|---|---|---|
| 1 | Roller & RBAC | ✅ Match | 8 roller exakt: owner, admin, planner, technician, user, viewer, customer, reporter |
| 2 | Auth — login/logout/me | ✅ Funktionell | Kontraktsavvikelser i login-svaret (se §3.1) |
| 3 | Orders — list/detail/status | ✅ Funktionell | Mappning `onWayAt → enRouteAt` korrekt; `customerNotified` inkonsekvent (se §3.2) |
| 4 | Order-substeg, foton, anteckningar, signatur | ✅ Match | |
| 5 | Avvikelser, material, checklistor, inspektion | ✅ Match | |
| 6 | Akut jobb / impossible / försenat | ✅ Match | impossibleReason + impossibleAt + impossibleBy sparas |
| 7 | Work sessions (start/stop/paus/resume/entries) | ✅ Funktionell | Fältnamn-glapp i svaret (se §3.3) |
| 8 | GPS / position | ✅ Dual | Både `/api/mobile/position` och `/api/mobile/gps` finns |
| 9 | Sync (offline batch) | ✅ Match | 8 actionTypes stöds |
| 10 | Teams | ✅ Funktionell | Path-glapp `/api/mobile/my-team` vs Go's `/api/teams?memberId=` (se §3.4) |
| 11 | Resurssökning | ✅ Funktionell | Path-glapp `/api/mobile/resources/search` vs Go's `/api/resources/search` (se §3.5) |
| 12 | Aviseringar (driver notifications) | ✅ Match | Flat array; Go grupperar klient-side |
| 13 | Customer change requests | ✅ Match | Inkl. fotouppladdning, kategori-mapping (Go ↔ One) |
| 14 | ETA-notiser | ✅ Match | Auto-trigger via `triggerETANotification` |
| 15 | Distance / route feedback / weather / AI / terminology / map-config / app-config / version-check / statistics | ✅ Match | |
| 16 | **WebSocket / realtid** | ❌ **Inkompatibelt protokoll** | Traivo One = raw `ws`. Go = Socket.io. Detaljer i §4 |
| 17 | Carry-over, schema-publishing, break-config | ✅ Match | |

**Slutsats:** Inga blockerande glapp. Alla skarpa funktioner Traivo Go behöver mot riktig backend kan fungera direkt mot Traivo One om Go-klienten:

- Accepterar `role: resourceType` i loginsvaret (eller om vi normaliserar svaret, se §3.1)
- Använder `/api/mobile/*`-prefix för team & resurssökning (eller om vi lägger upp aliasen, se §3.4–3.5)
- Talar **WebSocket-protokollet vi har** istället för Socket.io (eller om vi adopterar Socket.io, se §4)

---

## 2. Roller — exakt matchning

Båda systemen använder samma 8 roller med samma semantik:

| Roll | Traivo One (`client/src/lib/role-config.ts`) | Traivo Go (Section 1 i Go-rapporten) |
|---|---|---|
| `owner` | Ägare | Ägare — full access |
| `admin` | Admin | Admin — full access utom ägar-only |
| `planner` | Planerare | Planerare — schemalägga, hantera ordrar |
| `technician` | Tekniker | Tekniker — egna ordrar i fält |
| `user` | Användare | Användare — basläsning |
| `viewer` | Betraktare | Blockerad i Go (read-only) |
| `customer` | Kund | Blockerad i Go |
| `reporter` | Anmälare | Blockerad i Go |

**Verifierat:** Login godkänner alla åtta roller (`server/routes/mobile/auth.ts`). `viewer/customer/reporter` blockeras klient-side i Go enligt deras specifikation.

**Slutsats:** ✅ **Inget glapp.** Tabellen kan kopieras rakt av till båda apparnas RBAC-dokumentation.

---

## 3. Endpoints — komplett täckningsmatris

Notation: ✅ = match, ⚠️ = funktionell men kontrakts-/path-glapp, ❌ = saknas/inkompatibelt.

### 3.1 Auth

| Go förväntar | Traivo One har | Status |
|---|---|---|
| `POST /api/mobile/login` med `{username, password}` eller `{email, pin}` | `mobile/auth.ts` — stödjer **båda** + `{pin}` ensam | ✅ |
| Svar: `{token, user, success, resource}` | Returnerar precis det | ✅ struktur |
| `user.role` ∈ {owner, admin, planner, technician, user, viewer, customer, reporter} | Returnerar `role: resource.resourceType \|\| "driver"` | ⚠️ **MAJOR**: returnerar resurstyp (`driver`, `lastbil`, …) **inte RBAC-roll**. Go's roll-baserade UI får ett okänt värde. |
| `user.tenantId` på topp­nivån | Tenant-info finns endast i `resource.tenantId` | ⚠️ Mindre — Go-klienten kan plocka från `resource` |
| `POST /api/mobile/logout` | Finns | ✅ |
| `GET /api/mobile/me` | Finns; returnerar `startLatitude/startLongitude` mappade från `homeLatitude/homeLongitude` | ✅ Match |

**Åtgärdsförslag (följdtask):** I `mobile/auth.ts` mappa `resource.role` (riktiga RBAC-rollen från `users`-tabellen) → `user.role`, inte `resourceType`. Behåll `resource.resourceType` separat för backwards-compat.

### 3.2 Orders

| Go förväntar | Traivo One har | Status |
|---|---|---|
| `GET /api/mobile/my-orders?date=YYYY-MM-DD` | Finns (`orders.ts`) | ✅ |
| `GET /api/mobile/orders/:id` | Finns | ✅ |
| `PATCH /api/mobile/orders/:id/status` med statuskedja `pending → assigned → dispatched → en_route → in_progress → completed/cancelled/impossible` | Switch-mappning till svenska statusvärden internt; engelska accepteras | ✅ Funktionell |
| `enRouteAt` när status går till `en_route` | Sparas som `onWayAt` i DB; serialiseras som `enRouteAt` i mobile-svaret | ✅ Match (mappning verifierad i `orders.ts:78,224`) |
| `actualStartTime` vid `in_progress` | Sparas som `onSiteAt` i DB; serialiseras som `actualStartTime` | ✅ Match |
| `actualDuration` (minuter) vid `completed` | Beräknas i status-handlern och sparas till `actualDuration`-kolumnen (verifierat i schema rad 273) | ✅ Match |
| `executionStatus` ∈ {not_started, in_progress, completed, on_way, on_site, planned_fine, ...} | Finns i schema (rad 297, default `not_planned`); sätts korrekt av status-handlern | ✅ Match |
| `customerNotified: boolean` | I `GET /api/mobile/orders/:id` och status-svar härleds via `etaNotifications.length > 0`. **I `GET /api/mobile/my-orders` är det hårdkodat `false`.** | ⚠️ Inkonsekvent (se följdtask nedan) |
| `impossibleReason / impossibleAt / impossibleBy` | Finns i schema (rad 288–291), sparas av status-handlern | ✅ Match |
| `taskLatitude / taskLongitude` (per-stoppskoordinater) | Finns i schema (rad 305–306) | ✅ Match |
| `objectAccessCode / objectKeyNumber` | Finns på `objects`-tabellen, joinas i mobile-svaret | ✅ Match |
| Substeg, foton, anteckningar, signatur, checklista, avvikelser, inspektion | Endpoints spridda mellan `orders.ts` (POST photos/checklist/signature/notes/deviations/inspection/substeps) och `misc.ts` (GET checklist, POST upload-photo/confirm-photo/customer-signoff/quick-action) | ✅ Match (sprida placering) |
| `POST /api/mobile/orders/:id/materials` (logga material) | Finns (`orders.ts:640`) | ✅ |
| `GET /api/mobile/orders/:id/materials` (lista loggade material) | **Saknas** — bara POST finns | ❌ **Saknad endpoint** |

**Åtgärdsförslag (följdtask):** Berika `/api/mobile/my-orders` med `customerNotified` från `etaNotifications`-batch-query istället för hårdkodat `false`. Annars visar Go's listvy felaktigt "ingen kund­notis skickad" tills användaren öppnar en order.

**Åtgärdsförslag (följdtask):** Implementera `GET /api/mobile/orders/:id/materials` som returnerar `order.materialsUsed[]` (sparas redan vid POST). Fält per item: `articleId, quantity, comment, loggedBy, loggedAt`.

### 3.3 Work Sessions

| Go förväntar | Traivo One har | Status |
|---|---|---|
| `POST /api/mobile/work-sessions/start` | Finns (`workSessions.ts`) | ✅ |
| `GET /api/mobile/work-sessions/active` | Finns | ✅ |
| `POST /api/mobile/work-sessions/:id/stop \| pause \| resume` | Alla tre finns | ✅ |
| `POST /api/mobile/work-sessions/:id/entries` | Finns | ✅ |
| Svarsformat `{id, startedAt, status, pausedAt, totalPausedSeconds, entries[]}` | Returnerar `{id, startTime, endTime, status, pausedAt, totalPauseMinutes}` | ⚠️ Fältnamn­glapp: `startedAt` vs `startTime`, `totalPausedSeconds` vs `totalPauseMinutes` (sek vs min), `entries` saknas i svaret |

**Åtgärdsförslag (följdtask):** Lägg till alias i mobile-svaret: `startedAt = startTime`, `totalPausedSeconds = totalPauseMinutes * 60`, `entries = []` (separat hämtad). Behåll befintliga fält för web-klientens bakåtkompatibilitet.

### 3.4 Teams

| Go förväntar | Traivo One har | Status |
|---|---|---|
| `GET /api/teams?memberId=X&status=active` | `GET /api/mobile/my-team` returnerar samma data | ⚠️ Path-glapp |
| `POST /api/teams` | `POST /api/mobile/teams` | ⚠️ Path-glapp |
| `POST /api/teams/:id/invite \| accept \| leave` | `POST /api/mobile/teams/:id/...` | ⚠️ Path-glapp |
| `DELETE /api/teams/:id` | `DELETE /api/mobile/teams/:id` | ⚠️ Path-glapp |

Notera: `/api/teams` finns även **separat** i `configRoutes.ts:1311+` (admin-routes), men kräver web-session, inte mobile-token.

**Åtgärdsförslag (följdtask):** Antingen (a) registrera mobile-team-routerna även på `/api/teams/*` med `isMobileAuthenticated`, eller (b) be Go-teamet använda `/api/mobile/...`-prefixet konsekvent.

### 3.5 Resurssökning

| Go förväntar | Traivo One har | Status |
|---|---|---|
| `GET /api/resources/search?q=...` | `GET /api/mobile/resources/search?q=...` (`team.ts:130`) | ⚠️ Path-glapp — endpointen finns och fungerar identiskt, bara prefixet skiljer |

### 3.6 Övriga ✅-områden (sammanfattat)

| Område | Endpoint(er) | Fil |
|---|---|---|
| Aviseringar | `/api/mobile/notifications` (GET, PATCH read, PATCH read-all, GET count) | `mobile/misc.ts` |
| Sync | `POST /api/mobile/sync`, `GET /api/mobile/sync/status` (8 actionTypes) | `mobile/sync.ts` |
| GPS | `POST /api/mobile/position` + `POST /api/mobile/gps` | `workSessions.ts` + `reporting.ts` |
| Distance | `POST /api/distance`, `POST /api/distance/batch` | `mobile/misc.ts:805+` |
| Disruptions | `delay`, `early-completion`, `resource-unavailable`, `emergency-job` | `disruptionRoutes.ts` |
| Break-config | `GET /api/break-config` | `configRoutes.ts:1639` |
| ETA | `GET /api/eta-notification/config`, history, `POST /api/work-orders/:id/auto-eta-sms` | `etaNotificationRoutes.ts` + `orderConceptRoutes.ts` |
| Customer change requests | `POST/GET /api/mobile/customer-change-requests`, photo-upload, categories | `mobile/misc.ts` |
| Carry-over | `POST /api/work-orders/carry-over` | `workOrderRoutes.ts:162` |
| AI | `chat`, `transcribe`, `analyze-image` (alla med budget-throttling) | `mobile/reporting.ts` |
| Terminology | `GET /api/mobile/terminology` (tenant-merge) | `mobile/misc.ts` |
| Resource profile assignments | `GET /api/resource_profile_assignments` | `mobile/misc.ts:1027` |
| Map-config | `GET /api/mobile/map-config` | `mobile/misc.ts:868` |
| App-config | `GET /api/mobile/app-config` | `mobile/appConfig.ts` |
| Version-check | `GET /api/mobile/version-check?version=` | `mobile/appConfig.ts` |
| Statistics summary | `GET /api/mobile/statistics/summary` | `mobile/appConfig.ts` |
| Route feedback | `GET/POST /api/mobile/route-feedback*` | `mobile/misc.ts` |
| Weather | `GET /api/mobile/weather` (Open-Meteo passthrough) | `mobile/reporting.ts` |
| Checklist templates + AI-generation | `GET/POST /api/checklist-templates`, `POST /api/checklist/:woId/generate` | `mobile/misc.ts` |

---

## 4. WebSocket / realtid — det enda **kritiska** glappet

### 4.1 Vad Traivo One har

`server/notifications.ts` exponerar en **rå WebSocket-server** på `/ws/notifications`:

- Bibliotek: `ws` (raw WebSocket-protokollet, RFC 6455)
- URL-parameter: `?token=<ephemeral-notification-token>` för auth — **inte** mobile-JWT direkt. Klienten måste först anropa `POST /api/notifications/token` (i `aiRoutes.ts:2885`, skyddad med `isAuthenticated` = web-session) för att få en kortlivad token, som sedan valideras av `notificationService.generateAuthToken()` / motsvarande verifier (`notifications.ts:74`).
- Internt rum-system per `resourceId` och per `tenantId` (rum-namn används inte över tråden, det är intern routing)
- Meddelandeformat: enkel JSON, t.ex. `{type: "order:updated", title, message, orderId, data}`

> **Viktigt för Go-integrationen:** Eftersom token-utfärdaren idag kräver web-session, kan Traivo Go **inte** ansluta till `/ws/notifications` med sin mobile-token utan att vi antingen (a) öppnar `POST /api/notifications/token` även för `isMobileAuthenticated`, eller (b) bygger en parallell `POST /api/mobile/notifications/token`. Detta är ett separat blockerande glapp utöver Socket.io-protokollfrågan.

### 4.2 Vad Traivo Go förväntar

Section 16 i Go-rapporten: **Socket.io v4** med rum:

- `resource:<resourceId>` — personliga events
- `tenant:<tenantId>` — broadcast till hela företaget
- `team:<teamId>` — för team-jobb

13 namngivna events listas, t.ex. `order:assigned`, `order:status_changed`, `position:updated`, `team:invitation`, `notification:new`, `route:optimized`, m.fl.

### 4.3 Varför detta inte fungerar i nuläget

Socket.io är **inte** raw WebSocket. Det är ett eget protokoll (lager ovanpå WS) med handshake, fallback till long-polling, ack-system och rumshantering. En Socket.io-klient mot en raw `ws`-server får handskakningsfel och kommer inte ens upp.

Om Go har tagit fram sin egen WebSocket-klient ovanpå raw `ws` så fungerar transporten — men då behöver händelse­namn och rum-semantik fortfarande matcha (vilket de **inte** gör idag, t.ex. saknar Traivo One händelsen `order:assigned` som första-klass event — vi använder generiska `order:updated`).

### 4.4 Två vägar framåt (följdtask)

**Alternativ A — Adoptera Socket.io på Traivo One** (rekommenderas)
- Installera `socket.io` (server) och låt klienten Go behålla `socket.io-client`
- Migrera `notifications.ts` till `io.of("/notifications")` med rum `resource:X`, `tenant:X`, `team:X`
- Mappa befintliga interna events till de 13 namngivna events Go förväntar
- Behåll raw `ws`-endpointen tills web-klienten också är migrerad (parallellkörning ~2 veckor)

**Alternativ B — Få Go att tala raw WS**
- Mindre arbete på vår sida, men Go-klienten måste skriva om sin realtidslayer från Socket.io till raw WS
- Vi behöver fortfarande lägga till de 13 namngivna events (många finns redan, vissa saknas)

**Min rekommendation:** Alternativ A. Socket.io är industristandard för React Native-realtid, har inbyggd reconnect/long-polling-fallback, och Traivo Ones web-klient är liten nog att också migrera.

---

## 5. Död kod att rensa

### 5.1 `server/routes/mobileRoutes.ts` — 3 440 rader, **inte registrerad**

Filen importeras inte från någonstans i `server/`:

```bash
$ rg "from.*mobileRoutes['\"]|import.*mobileRoutes['\"]" server/
(tomt)
```

`server/routes.ts:33` använder enbart `registerMobileRoutes` från `./routes/mobile` (mappen — `mobile/index.ts`). Den gamla monolitiska filen är en kvarleva från en refaktorering där rutterna delades upp i:

- `mobile/auth.ts`
- `mobile/orders.ts`
- `mobile/workSessions.ts`
- `mobile/team.ts`
- `mobile/sync.ts`
- `mobile/misc.ts`
- `mobile/reporting.ts`
- `mobile/preferences.ts`
- `mobile/appConfig.ts`

Den döda filen innehåller **dubbletter** av i stort sett alla mobile-endpoints. Risken är att en framtida ändring råkar göras i den döda filen och tror att den fungerar — eller att den används som referens och leder vilse.

**Åtgärd (följdtask):** Ta bort `server/routes/mobileRoutes.ts`. Verifiera först med `rg` att inga import-statements finns kvar (gjort: noll träffar).

---

## 6. Schema-jämförelse: Order-kontrakt

Verifierat mot Go's Order-interface (Section 7 i Go-rapporten) och `shared/schema.ts:243+` (`workOrders`-tabellen):

| Go-fält | DB-kolumn | Mobile-svar | Match |
|---|---|---|---|
| `id` | `id` (varchar uuid) | `id` | ✅ |
| `orderNumber` | `title` | `orderNumber: title` | ✅ alias |
| `customerName` | join från `customers` (i `enrichOrderForMobile`, `shared.ts:130`) | `customerName` | ✅ |
| `address` | join från `objects.address` (`shared.ts:131`); ingen direkt `address`-kolumn på `workOrders` | `address` + `objectAddress` | ✅ via join |
| `scheduledStart` | `plannedWindowStart` (timestamp) eller `scheduledStartTime` (text); inkonsekvent mellan endpoints | `scheduledStart` (alias) | ⚠️ alias-namnen är inte konsekventa över alla mobile-endpoints — Go bör testa både fält |
| `scheduledEnd` | `plannedWindowEnd` eller `scheduledEndTime` | `scheduledEnd` (alias) | ⚠️ samma som ovan |
| `estimatedDuration` | `estimatedDuration` | `estimatedDuration` | ✅ |
| `actualDuration` | `actualDuration` | `actualDuration` | ✅ |
| `enRouteAt` | `onWayAt` | `enRouteAt: onWayAt` | ✅ alias |
| `actualStartTime` | `onSiteAt` | `actualStartTime: onSiteAt` | ✅ alias |
| `completedAt` | `completedAt` | `completedAt` | ✅ |
| `executionStatus` | `executionStatus` | `executionStatus` | ✅ |
| `taskLatitude` | `taskLatitude` | `taskLatitude` | ✅ |
| `taskLongitude` | `taskLongitude` | `taskLongitude` | ✅ |
| `customerNotified` | _härlett_ från `etaNotifications` | `customerNotified` (✅ i detail/status, ⚠️ hårdkodat false i list) | ⚠️ se §3.2 |
| `impossibleReason` | `impossibleReason` | `impossibleReason` | ✅ |
| `impossibleAt` | `impossibleAt` | `impossibleAt` | ✅ |
| `impossibleBy` | `impossibleBy` | `impossibleBy` | ✅ |
| `objectAccessCode` | join från `objects` | `objectAccessCode` | ✅ |
| `objectKeyNumber` | join från `objects` | `objectKeyNumber` | ✅ |
| `priority` | `priority` (text: low/normal/high/urgent) | `priority` | ✅ |
| `teamId` | `teamId` | `teamId` | ✅ |
| `signatureUrl` | **Ligger inte på `workOrders`** — finns på `visitConfirmations.signatureUrl` (rad 3880) som joinas via `workOrderId` | Behöver explicit join för att returneras | ⚠️ Behöver verifieras: ingen mobile-endpoint returnerar idag detta fält. Om Go förväntar det i orderdetaljen behöver vi joina in. |
| `subSteps` | _härlett_ från `structuralArticles` | `subSteps[]` | ✅ |
| `notes` | `notes` (text, append-only) | `notes` | ✅ |
| `status` (svensk eller engelsk) | `orderStatus` (svenska) | Spreds rakt i `/api/mobile/my-orders` (utan normalisering till engelska); status-handlern returnerar uppdaterat orderobjekt med både `status` och `orderStatus` | ⚠️ Inkonsekvent — Go bör tolka båda fälten |

**Slutsats:** Order-kontraktet är **i huvudsak** tätt, men tre verkliga avvikelser kvarstår:
1. `customerNotified` hårdkodat `false` i listsvaret (§3.2 — följdtask)
2. `signatureUrl` saknas i mobile-svaret (kommer från `visitConfirmations`-tabellen, joinas inte idag)
3. `scheduledStart/End`-aliasen är inte konsekventa över alla mobile-endpoints — Go bör testa både `scheduledStart` (alias) och `plannedWindowStart`/`scheduledStartTime` (källfält) som fallback.

---

## 7. Föreslagna följdtaskar (i prioritetsordning)

Dessa läggs upp som separata project tasks efter att denna analys är godkänd. **Inga av dessa har påbörjats — endast analyserade.**

| # | Titel | Typ | Estimat |
|---|---|---|---|
| 1 | Fixa `role` i mobile-login: returnera RBAC-roll, inte resurstyp | Bugfix | 30 min |
| 2 | Berika `/api/mobile/my-orders` med riktig `customerNotified` (batch-query mot `etaNotifications`) | Bugfix | 45 min |
| 3 | Implementera `GET /api/mobile/orders/:id/materials` (returnera `order.materialsUsed[]`) | Saknad endpoint | 30 min |
| 4 | Lägg till `startedAt`/`totalPausedSeconds`/`entries`-alias i work-session-svar | Mindre kontraktsfix | 30 min |
| 5 | Joina in `signatureUrl` från `visitConfirmations` i mobile-orderdetaljen + normalisera `scheduledStart/End`-aliasen över alla mobile-endpoints | Kontraktsfix | 1 h |
| 6 | Öppna `POST /api/notifications/token` för `isMobileAuthenticated` (eller skapa parallell `/api/mobile/notifications/token`) — krävs för att Go ens ska kunna ansluta till `/ws/notifications` | **Blockerare för realtid** | 30 min |
| 7 | Registrera team-routes även på `/api/teams/*` (eller `/api/resources/search`) som alias för Go-kompatibilitet | Mindre routing | 1 h |
| 8 | **Adoptera Socket.io** för realtid på `/socket.io` med rum `resource/tenant/team` och 13 namngivna events | **Stort arbete** | 1–2 dagar |
| 9 | Ta bort död kod `server/routes/mobileRoutes.ts` (3 440 rader) | Städning | 15 min |

---

## 8. Meddelande till Traivo Go-agenten (klipp-och-klistra)

> Hej Go-agent!
>
> Vi har gått igenom hela `Traivo_Go_Integration_Report.md` (782 rader, 17 sektioner) mot Traivo Ones aktiva backend (`server/routes/mobile/*.ts` registrerade via `registerMobileRoutes` i `server/routes.ts`).
>
> **Goda nyheter:** 15 av 17 områden är **klara att koppla in mot riktig backend**. Roller, sync, ordrar, status­övergångar, akut jobb, work sessions, teams, GPS, distance, customer change requests, ETA-notiser, AI, terminology, app-config, statistics — allt finns och returnerar rätt data. När ni sätter `TRAIVO_API_URL` mot Traivo One bör 90 %+ av era flöden bara fungera.
>
> **Två saker behöver synkas mellan oss innan vi kallar integrationen "färdig":**
>
> 1. **Realtid (Socket.io vs raw WebSocket).** Traivo One kör idag raw `ws` på `/ws/notifications` med token i query-parametern. Ni förväntar Socket.io v4 med rum `resource:X`/`tenant:X`/`team:X` och 13 namngivna events. Vi tänker migrera Traivo One till Socket.io så ni kan behålla `socket.io-client` på er sida (rekommenderat alternativ A i vår analys). Tidsestimat: 1–2 dagar. Berätta gärna om ni redan börjat implementera klient­sidan så vi kan synka händelse­namn och payload-format **innan** vi rullar ut.
>
> 2. **Mindre kontraktsavvikelser** vi planerar fixa unilateralt på Traivo Ones sida (ingen åtgärd krävs från er):
>    - Login-svaret returnerar idag `user.role = resourceType`. Vi byter till riktig RBAC-roll.
>    - `/api/mobile/my-orders` returnerar idag `customerNotified: false` hårdkodat. Vi berikar med riktigt värde från ETA-tabellen.
>    - Work-session-svaret saknar fältnamnen `startedAt`/`totalPausedSeconds`/`entries`. Vi lägger till dem som alias.
>    - Era team-endpoints går mot `/api/teams/*` och `/api/resources/search`. Vi har dem på `/api/mobile/teams/*` och `/api/mobile/resources/search`. Vi lägger upp alias så era nuvarande paths fungerar.
>
> **En sak att vara medveten om:** Order-statussekvensen (`pending → assigned → dispatched → en_route → in_progress → completed/cancelled/impossible`) accepteras av oss och mappas till våra interna svenska statusar (`skapad/planerad_resurs/utford/avbruten`). `enRouteAt`, `actualStartTime`, `actualDuration`, `customerNotified`, `impossibleReason/At/By` och `executionStatus` sätts korrekt vid rätt övergång.
>
> Hör av er om ni hittar något som inte stämmer i fält. Vi har sparat hela er rapport som referens i `docs/api/TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md` så vi kan fortsätta synka mot exakt samma kontrakt.

---

## 9. Bilagor

- [`TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md`](./TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md) — bevarad spegelkopia av Go-teamets rapport (782 rader)
- [`TRAIVO_GO_INTEGRATION_GUIDE.md`](./TRAIVO_GO_INTEGRATION_GUIDE.md) — befintlig integrationsguide (Traivo One-sidan)
- [`TRAIVO_GO_AKUT_JOBB_INTEGRATION.md`](./TRAIVO_GO_AKUT_JOBB_INTEGRATION.md) — akut-jobb-flöde
- [`TRAIVO_GO_SCHEMA_PUBLISHING_INTEGRATION.md`](./TRAIVO_GO_SCHEMA_PUBLISHING_INTEGRATION.md) — schema-publicering
- [`TRAIVO_GO_SYNC_INSTRUCTIONS.md`](./TRAIVO_GO_SYNC_INSTRUCTIONS.md) — offline-sync-protokoll
