# Traivo Go ↔ Traivo One — Integrationsrapport

**Datum:** 2026-03-25  
**Version:** 1.0  
**Syfte:** Denna rapport listar samtliga API-endpoints, WebSocket-events, datakontrakt och beroenden som Traivo One-backend måste implementera för att Traivo Go ska fungera till 100%.

---

## Innehåll

1. [Autentisering & Sessionshantering](#1-autentisering--sessionshantering)
2. [Ordrar & Orderstyrning](#2-ordrar--orderstyrning)
3. [Statushantering & Tidsstyrning](#3-statushantering--tidsstyrning)
4. [Team & Resurser](#4-team--resurser)
5. [Arbetspass (Work Sessions)](#5-arbetspass-work-sessions)
6. [Aviseringar & Push-notiser](#6-aviseringar--push-notiser)
7. [Ruttoptimering & Avstånd (R2)](#7-ruttoptimering--avstånd-r2)
8. [Disruption Triggers (R3)](#8-disruption-triggers-r3)
9. [Rastkonfiguration (R4)](#9-rastkonfiguration-r4)
10. [Feedback Loop (R5)](#10-feedback-loop-r5)
11. [Kundnotifikationer & ETA (R6)](#11-kundnotifikationer--eta-r6)
12. [Kundrappporter & Avvikelser](#12-kundrapporter--avvikelser)
13. [Övrigt (Terminologi, Sync, Karta)](#13-övrigt-terminologi-sync-karta)
14. [WebSocket-events](#14-websocket-events)
15. [Datakontrakt (TypeScript-interfaces)](#15-datakontrakt-typescript-interfaces)
16. [Databastabeller (Traivo Go-lokala)](#16-databastabeller-traivo-go-lokala)
17. [Checklista — Sammanfattning](#17-checklista--sammanfattning)

---

## 1. Autentisering & Sessionshantering

| Metod | Traivo One-endpoint | Request body | Förväntat svar |
|-------|-------------------|--------------|----------------|
| POST | `/api/mobile/login` | `{ username, password }` eller `{ pin }` | `{ token, user: { id, name, role, tenantId, resourceId } }` |
| POST | `/api/mobile/logout` | — (Bearer-token i header) | `{ success: true }` |
| GET | `/api/mobile/me` | — | Användarobjekt: `{ id, name, email, role, tenantId, resourceId, startLatitude?, startLongitude? }` |

**Viktigt:**
- `role` måste vara en av: `owner`, `admin`, `planner`, `technician`, `user`, `viewer`, `customer`, `reporter`
- Traivo Go blockerar `viewer`, `customer`, `reporter` från fältappen
- Token skickas som `Authorization: Bearer <token>` på alla efterföljande anrop
- `startLatitude`/`startLongitude` på användarobjektet används som förarens startposition på kartan

---

## 2. Ordrar & Orderstyrning

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| GET | `/api/mobile/my-orders?date=YYYY-MM-DD` | Hämtar förarens ordrar för ett datum. Returnerar array av `Order`-objekt (se avsnitt 15). |
| GET | `/api/mobile/orders/:id` | Hämtar enskild order med alla detaljobjekt (substeps, inspections, contacts, articles, deviations). |
| GET | `/api/mobile/orders/:id/checklist` | Returnerar checklista: `{ questions: ChecklistQuestion[] }` |
| GET | `/api/mobile/orders/:id/materials` | Returnerar `{ materials: Article[] }` |
| POST | `/api/mobile/orders/:id/materials` | Loggar material: `{ articleId, quantity, unit }` |
| POST | `/api/mobile/orders/:id/deviations` | Rapporterar avvikelse: `{ category, description, photoUrl?, latitude?, longitude?, photos? }` |
| POST | `/api/mobile/orders/:id/signature` | Sparar signatur: `{ signatureData: string (base64) }` |
| POST | `/api/mobile/orders/:id/notes` | Lägger till anteckning: `{ text }` |
| PATCH | `/api/mobile/orders/:id/substeps/:stepId` | Uppdaterar substeg: `{ completed: boolean }` |
| POST | `/api/mobile/orders/:id/inspections` | Sparar inspektion: `{ items: InspectionItem[] }` |
| POST | `/api/mobile/orders/:id/upload-photo` | Laddar upp foto (base64/multipart) |
| POST | `/api/mobile/orders/:id/confirm-photo` | Bekräftar fotouppladdning |
| POST | `/api/mobile/orders/:id/customer-signoff` | Kundsignering: `{ customerName, signature (base64), summary, materials?, deviations? }` |
| POST | `/api/mobile/quick-action` | Snabbåtgärd: `{ orderId, action, data? }` |

**Orderstatusar som Traivo One måste stödja:**
```
pending → assigned → dispatched → en_route → in_progress → completed
                                                         → cancelled
                                                         → impossible
```

**Order-objektet måste innehålla dessa fält:**
Se fullständigt interface i avsnitt 15. Kritiska fält:
- `clusterId`, `clusterName` — för klustergrupperig
- `actualStartTime`, `actualEndTime`, `completedAt` — för tidsuppföljning
- `actualDuration` — beräknad eller mottagen faktisk varaktighet (minuter)
- `enRouteAt` — tidsstämpel när föraren började resa
- `customerNotified` — boolean, om kund har notifierats
- `executionCodes[]` — utförandekoder
- `timeRestrictions[]` — tidsbegränsningar (parkeringsförbud, tömningsdag etc.)
- `subSteps[]` — delsteg med sorteringsordning
- `dependencies[]` — uppgiftsberoenden mellan ordrar
- `inspections[]` — inspektionsdata
- `taskLatitude`, `taskLongitude` — om uppgiften har annan position än adressen
- `objectAccessCode`, `objectKeyNumber` — åtkomstkoder

---

## 3. Statushantering & Tidsstyrning

| Metod | Traivo One-endpoint | Request body | Förväntat beteende |
|-------|-------------------|--------------|---------------------|
| PATCH | `/api/mobile/orders/:id/status` | `{ status, actualDuration?, enRouteAt?, customerNotified?, impossibleReason? }` | Uppdatera orderstatus. Se nedan. |

**Statusövergångar med sidoeffekter:**

| Ny status | Traivo One ska... |
|-----------|-------------------|
| `dispatched` | Sätta `customerNotified = true` och `enRouteAt = NOW()` |
| `en_route` | Sätta `customerNotified = true` och `enRouteAt = NOW()` (om ej redan satt) |
| `in_progress` | Notera `actualStartTime = NOW()` |
| `completed` | Beräkna `actualDuration = (completedAt - actualStartTime)` i minuter. Acceptera `actualDuration` från request body som överstyrning. Sätt `completedAt = NOW()`. |
| `impossible` | Spara `impossibleReason`, `impossibleAt = NOW()`, `impossibleBy = resourceId` |

**Traivo One måste returnera det uppdaterade orderobjektet** med alla beräknade fält (actualDuration, enRouteAt, customerNotified) i svaret.

---

## 4. Team & Resurser

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| GET | `/api/teams?memberId={resourceId}&status=active` | Hämtar aktiva team för en resurs |
| POST | `/api/teams` | Skapar team: `{ name, description?, color? }` |
| POST | `/api/teams/:id/invite` | Bjuder in medlem: `{ resourceId }` |
| POST | `/api/teams/:id/accept` | Accepterar inbjudan |
| POST | `/api/teams/:id/leave` | Lämnar team |
| DELETE | `/api/teams/:id` | Tar bort team (bara ägare) |
| GET | `/api/mobile/team-invites` | Hämtar väntande inbjudningar |
| GET | `/api/mobile/team-orders?date=YYYY-MM-DD` | Hämtar teammedlemmars ordrar |
| GET | `/api/resources/search?q={sökterm}` | Söker bland resurser/personal |

**Team-svar förväntas:**
```json
{
  "id": "team-1",
  "name": "Team Nord",
  "description": "...",
  "color": "#4A9B9B",
  "members": [
    { "id": "res-1", "name": "Erik Lindqvist", "role": "leader" }
  ]
}
```

---

## 5. Arbetspass (Work Sessions)

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| POST | `/api/mobile/work-sessions/start` | Startar arbetspass: `{ type?, startTime? }` |
| GET | `/api/mobile/work-sessions/active` | Hämtar aktivt arbetspass |
| POST | `/api/mobile/work-sessions/:id/stop` | Avslutar arbetspass |
| POST | `/api/mobile/work-sessions/:id/pause` | Pausar arbetspass |
| POST | `/api/mobile/work-sessions/:id/resume` | Återupptar arbetspass |
| POST | `/api/mobile/work-sessions/:id/entries` | Loggar tidspost: `{ type, duration }` |

**Förväntat svar för aktivt arbetspass:**
```json
{
  "id": "session-1",
  "startedAt": "2026-03-25T07:00:00Z",
  "status": "active",
  "pausedAt": null,
  "totalPausedSeconds": 0,
  "entries": []
}
```

---

## 6. Aviseringar & Push-notiser

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| GET | `/api/mobile/notifications` | Lista aviseringar (grupperade: today/yesterday/earlier) |
| GET | `/api/mobile/notifications/count` | `{ unreadCount: number }` |
| POST | `/api/mobile/notifications/:id/read` | Markera som läst |
| POST | `/api/mobile/notifications/read-all` | Markera alla som lästa |

**Notifikationstyper som Traivo One ska skicka:**
- `order_assigned` — ny order tilldelad
- `status_change` — orderstatus ändrad
- `team_invite` — teaminbjudan
- `schedule_change` — schemaändring
- `deviation_reviewed` — avvikelse granskad
- `material_update` — materialuppdatering
- `sign_off_complete` — kundsignering klar
- `system` — systemavisering

**Notifikationsobjekt:**
```json
{
  "id": "notif-1",
  "type": "order_assigned",
  "title": "Ny order tilldelad",
  "message": "Order #1234 har tilldelats dig",
  "isRead": false,
  "createdAt": "2026-03-25T08:00:00Z",
  "orderId": "order-123"
}
```

**Push-notiser:** Traivo Go registrerar Expo Push-tokens via sin egen databas. Om Traivo One vill skicka push-notiser direkt bör den stödja Expo Push API (`https://exp.host/--/api/v2/push/send`) eller delegera till Traivo Go:s mellanserver.

---

## 7. Ruttoptimering & Avstånd (R2)

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| POST | `/api/distance` | Beräkna köravstånd/tid mellan två punkter |
| POST | `/api/distance/batch` | Batch-beräkning för flera punktpar |

**Request `/api/distance`:**
```json
{
  "origin": { "lat": 57.7089, "lng": 11.9746 },
  "destination": { "lat": 57.6880, "lng": 11.9530 }
}
```

**Förväntat svar:**
```json
{
  "distanceMeters": 4200,
  "durationSeconds": 480,
  "source": "road_network"
}
```

**Request `/api/distance/batch`:**
```json
{
  "pairs": [
    { "origin": { "lat": 57.7, "lng": 11.9 }, "destination": { "lat": 57.6, "lng": 11.8 } }
  ]
}
```

**Förväntat svar:**
```json
{
  "results": [
    { "distanceMeters": 4200, "durationSeconds": 480, "source": "road_network" }
  ]
}
```

**Notera:** Traivo Go faller tillbaka på haversine-beräkning (fågelvägen) om endpoint returnerar error. Resultaten cachas 15 minuter klient-sida.

---

## 8. Disruption Triggers (R3)

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| POST | `/api/disruptions/trigger/delay` | Förare försenad >150% av estimerad tid |
| POST | `/api/disruptions/trigger/early-completion` | Alla ordrar klara med >45 min slack |
| POST | `/api/disruptions/trigger/resource-unavailable` | Sjukanmälan / ej tillgänglig |

**Request `/api/disruptions/trigger/delay`:**
```json
{
  "orderId": "order-5",
  "resourceId": "res-101",
  "estimatedDuration": 30,
  "actualElapsed": 48,
  "reason": "auto_detected"
}
```

**Request `/api/disruptions/trigger/early-completion`:**
```json
{
  "resourceId": "res-101",
  "completedOrders": 8,
  "totalOrders": 8,
  "remainingMinutes": 55,
  "reason": "all_orders_complete"
}
```

**Request `/api/disruptions/trigger/resource-unavailable`:**
```json
{
  "resourceId": "res-101",
  "type": "sick_leave",
  "message": "Sjukanmälan via appen"
}
```

**Förväntat svar (alla tre):**
```json
{ "success": true, "disruptionId": "disr-123", "acknowledged": true }
```

**Traivo One bör:**
- Logga disruptionen
- Eventuellt omfördela ordrar automatiskt
- Skicka WebSocket-event `anomaly_alert` till planerare
- Vid `resource-unavailable`: markera resursen som otillgänglig i schemaläggningen

---

## 9. Rastkonfiguration (R4)

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| GET | `/api/break-config` | Hämtar tenant-specifik rastkonfiguration |

**Förväntat svar:**
```json
{
  "enabled": true,
  "durationMinutes": 30,
  "earliestTime": "11:00",
  "latestTime": "13:00",
  "earliestSeconds": 39600,
  "latestSeconds": 46800
}
```

**Beteende i Traivo Go:**
- Om `enabled: true` visas en rastmarkering (kaffe-ikon) i ruttlegenden på kartan
- Rasten placeras vid den tidpunkt i rutten som infaller inom 11:00–13:00-fönstret
- Rasten är **informativ** — inget statusbyte eller åtgärd kopplad till den
- Om endpoint inte svarar eller `enabled: false` visas ingen rast

---

## 10. Feedback Loop (R5)

**Inga nya endpoints — utökat beteende på befintlig status-endpoint:**

Vid PATCH `/api/mobile/orders/:id/status` med `status: "completed"`:

1. Traivo Go skickar `actualDuration` (minuter) i request body
2. Om `actualDuration` saknas ska Traivo One beräkna: `(completedAt - actualStartTime)` i minuter
3. Traivo One ska lagra `actualDuration` på ordern

Vid status `dispatched` eller `en_route`:
1. Traivo One ska sätta `enRouteAt = NOW()` (om ej redan satt)
2. Traivo One ska sätta `customerNotified = true`

**Traivo Go läser tillbaka dessa fält** från orderobjektet och visar:
- "Kund notifierad ✓" badge i orderdetalj
- Faktisk tidsåtgång i statistiken

---

## 11. Kundnotifikationer & ETA (R6)

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| POST | `/api/work-orders/:id/auto-eta-sms` | Skickar automatiskt ETA-SMS till kund |
| GET | `/api/eta-notification/history?orderId={id}` | Hämtar historik för ETA-notifikationer |
| GET | `/api/eta-notification/config` | Hämtar ETA-konfiguration |

**Request `auto-eta-sms`:**
```json
{
  "orderId": "order-5",
  "estimatedArrival": "14:30"
}
```

**Förväntat svar:**
```json
{ "success": true, "message": "ETA SMS skickat till kund" }
```

**ETA-historik svar:**
```json
[
  {
    "id": "eta-1",
    "orderId": "order-5",
    "sentAt": "2026-03-25T14:00:00Z",
    "estimatedArrival": "14:30",
    "method": "sms",
    "status": "delivered"
  }
]
```

**ETA-konfiguration svar:**
```json
{
  "autoSendOnDispatch": true,
  "autoSendOnEnRoute": true,
  "smsTemplate": "Hej! Vi beräknas vara hos er ca kl {eta}.",
  "emailEnabled": false
}
```

---

## 12. Kundrapporter & Avvikelser

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| GET | `/api/mobile/customer-change-requests/mine` | Förarens kundrapporter |
| POST | `/api/mobile/customer-change-requests` | Skapa kundrapport |
| GET | `/api/mobile/deviations/mine` | Förarens avvikelsehistorik |

**Kundrapport — request:**
```json
{
  "category": "antal_karl_andrat",
  "description": "Tre kärl istället för två",
  "severity": "medium",
  "objectId": "obj-1",
  "customerId": "cust-1"
}
```

**Kategorier:** `antal_karl_andrat`, `skadat_material`, `tillganglighet`, `skador`, `rengorings_behov`, `ovrigt`  
**Statusar:** `new`, `reviewed`, `resolved`, `rejected`

**Avvikelser med order (GET mine):**
```json
[
  {
    "id": "dev-1",
    "orderId": "order-5",
    "orderNumber": "WO-2026-005",
    "customerName": "Göteborgs Stad",
    "address": "Avenyn 1",
    "category": "access_blocked",
    "description": "Väg blockerad av bygge",
    "createdAt": "2026-03-25T09:30:00Z"
  }
]
```

---

## 13. Övrigt (Terminologi, Sync, Karta)

| Metod | Traivo One-endpoint | Beskrivning |
|-------|-------------------|-------------|
| GET | `/api/mobile/terminology` | Tenant-specifik terminologi (svenska termer) |
| POST | `/api/mobile/sync` | Offline-sync: skickar buffrade åtgärder |
| POST | `/api/mobile/position` | Rapporterar GPS-position |
| GET | `/api/mobile/summary` | Daglig sammanfattning (antal ordrar, status etc.) |
| GET | `/api/mobile/map-config` | Kartkonfiguration (center, zoom, etc.) |
| POST | `/api/work-orders/carry-over` | Flytta ofärdiga ordrar till idag |
| GET | `/resource_profile_assignments?resourceId={id}` | Hämtar resursprofiltilldelningar |

**Terminologi-svar:**
```json
{
  "order": "Arbetsorder",
  "customer": "Kund",
  "deviation": "Avvikelse",
  "material": "Material",
  "inspection": "Inspektion"
}
```

**Sync — request body:**
```json
{
  "actions": [
    {
      "clientId": "uuid-v4",
      "actionType": "status_update",
      "payload": { "orderId": "order-5", "status": "completed" },
      "timestamp": 1711360000000
    }
  ]
}
```

**Position — request body:**
```json
{
  "latitude": 57.7089,
  "longitude": 11.9746,
  "speed": 45.2,
  "heading": 180,
  "accuracy": 10,
  "currentOrderId": "order-5",
  "status": "active"
}
```

**Carry-over — request body:**
```json
{
  "orderIds": ["order-1", "order-2"]
}
```

---

## 14. WebSocket-events

Traivo Go ansluter via Socket.io. Vid anslutning joinrar klienten rum:
- `resource:{resourceId}`
- `tenant:{tenantId}`
- `team:{teamId}` (om team finns)

### Events som Traivo One måste skicka:

| Event | Data | Syfte |
|-------|------|-------|
| `order:updated` | `{ orderId }` | Order uppdaterad (status/data) |
| `order:assigned` | `{ orderId }` | Ny order tilldelad |
| `job_assigned` | `{ orderId }` | Nytt jobb tilldelat (trigger notifikation) |
| `job_updated` | `{ orderId }` | Jobb uppdaterat |
| `job_cancelled` | `{ orderId }` | Jobb avbokat |
| `schedule_changed` | `{}` | Schema ändrat |
| `priority_changed` | `{ orderId }` | Prioritet ändrad |
| `anomaly_alert` | `{ type, message }` | Avvikelse/anomali upptäckt |
| `notification` | `{ notificationId }` | Ny avisering |
| `team:order_updated` | `{ orderId }` | Teammedlems order uppdaterad |
| `team:material_logged` | `{ orderId }` | Material loggat av teammedlem |
| `team:member_left` | `{ memberId }` | Teammedlem lämnade |
| `team:invite` | `{ teamId }` | Ny teaminbjudan |
| `pong` | `{}` | Svar på keepalive-ping |

### Events som Traivo Go skickar:

| Event | Data | Syfte |
|-------|------|-------|
| `join` | `{ rooms: ['resource:X', 'tenant:Y', 'team:Z'] }` | Anslut till rum |
| `ping` | `{}` | Keepalive var 30:e sekund |
| `position_update` | `{ resourceId, latitude, longitude, speed, status }` | GPS-position |

### Events som Traivo One bör broadcastra tillbaka:

| Event | Till rum | Trigger |
|-------|----------|---------|
| `position_update` | `tenant:{tenantId}` | När position tas emot — broadcastra till alla i samma tenant |

---

## 15. Datakontrakt (TypeScript-interfaces)

### Order (huvudobjekt)
```typescript
interface Order {
  id: number | string;
  orderNumber: string;
  status: 'pending' | 'assigned' | 'dispatched' | 'en_route' | 'in_progress' | 'completed' | 'cancelled' | 'impossible';
  customerName: string;
  address: string;
  city: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  what3words?: string;
  scheduledDate: string;           // "YYYY-MM-DD"
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  scheduledTimeStart?: string;     // "HH:mm"
  scheduledTimeEnd?: string;       // "HH:mm"
  title?: string;
  description: string;
  notes?: string;
  objectType: string;              // t.ex. "kärl", "container"
  objectId: number | string;
  clusterId?: number | string;
  clusterName?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  articles: Article[];
  contacts: Contact[];
  estimatedDuration: number;       // minuter
  actualStartTime?: string;        // ISO 8601
  actualEndTime?: string;
  completedAt?: string;
  actualDuration?: number;         // minuter, beräknad eller mottagen
  enRouteAt?: string;              // ISO 8601
  customerNotified?: boolean;
  signatureUrl?: string;
  photos: string[];
  deviations: Deviation[];
  sortOrder: number;
  executionCodes?: ExecutionCode[];
  timeRestrictions?: TimeRestriction[];
  subSteps?: SubStep[];
  dependencies?: TaskDependency[];
  isLocked?: boolean;
  orderNotes?: OrderNote[];
  inspections?: InspectionItem[];
  creationMethod?: string;
  object?: { id, name, address, latitude, longitude, what3words? };
  customer?: { id, name, customerNumber? };
  resourceId?: string | number;
  tenantId?: string;
  plannedNotes?: string | null;
  taskLatitude?: number | null;
  taskLongitude?: number | null;
  objectAccessCode?: string | null;
  objectKeyNumber?: string | null;
  articleId?: string | number;
  quantity?: number;
  unit?: string;
  impossibleReason?: string;
  impossibleAt?: string;
  impossibleBy?: string;
  isTeamOrder?: boolean;
  teamName?: string;
  assigneeName?: string;
  executionStatus?: 'not_started' | 'travel_started' | 'arrived' | 'work_started' | 'work_paused' | 'work_resumed' | 'work_completed' | 'signed_off';
}
```

### Artikel
```typescript
interface Article {
  id: number | string;
  name: string;
  articleNumber?: string;
  unit: string;
  quantity?: number;
  category: string;
  isSeasonal?: boolean;
}
```

### Kontakt
```typescript
interface Contact {
  id: number | string;
  name: string;
  phone: string;
  email?: string;
  role: string;
}
```

### Avvikelse
```typescript
interface Deviation {
  id: number | string;
  orderId: number | string;
  category: string;
  description: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  type?: string;
  photos?: string[];
}
```

### Substeg
```typescript
interface SubStep {
  id: number | string;
  name: string;
  articleName: string;
  completed: boolean;
  sortOrder: number;
}
```

### Uppgiftsberoende
```typescript
interface TaskDependency {
  id: number | string;
  dependsOnOrderId: number | string;
  dependsOnOrderNumber: string;
  dependsOnStatus: OrderStatus;
  isBlocking: boolean;
}
```

### Utförandekod
```typescript
interface ExecutionCode {
  id: number | string;
  code: string;
  name: string;
}
```

### Tidsbegränsning
```typescript
interface TimeRestriction {
  id: number | string;
  type: 'parking_ban' | 'emptying_day' | 'quiet_hours' | 'access_restriction';
  description: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  isActive: boolean;
}
```

### Inspektion
```typescript
interface InspectionItem {
  id: number | string;
  category: string;
  status: 'ok' | 'warning' | 'error' | 'issue' | 'not_checked';
  issues: string[];
  comment: string;
  photos?: string[];
  beforePhoto?: string;
  afterPhoto?: string;
}
```

---

## 16. Databastabeller (Traivo Go-lokala)

Dessa tabeller hanteras av Traivo Go:s egen server (ej av Traivo One):

| Tabell | Syfte | Kolumner |
|--------|-------|----------|
| `push_tokens` | Expo push-tokens | `driver_id (PK)`, `expo_push_token`, `platform`, `updated_at` |
| `time_entries` | Lokal tidloggning per order | `order_id`, `driver_id`, `status`, `started_at`, `ended_at`, `duration_seconds` |
| `inspection_photos` | Inspektionsfoton (base64) | `order_id`, `driver_id`, `category`, `photo_slot`, `base64_data` |
| `driver_locations` | GPS-spårning | `driver_id (PK)`, `latitude`, `longitude`, `speed`, `heading`, `status`, `updated_at` |
| `route_feedback` | Ruttfeedback | `driver_id`, `rating`, `reasons`, `comment`, `feedback_date` |

**OBS:** Traivo One bör **inte** försöka läsa/skriva dessa tabeller direkt. All kommunikation sker via API.

---

## 17. Checklista — Sammanfattning

### Autentisering & Användardata
- [ ] POST `/api/mobile/login` returnerar token + user med `role` och `resourceId`
- [ ] GET `/api/mobile/me` returnerar användarobjekt med `startLatitude`/`startLongitude`
- [ ] GET `/resource_profile_assignments?resourceId=X` fungerar

### Orderhantering
- [ ] GET `/api/mobile/my-orders?date=X` returnerar fullständiga Order-objekt
- [ ] GET `/api/mobile/orders/:id` returnerar order med alla relaterade objekt
- [ ] PATCH `/api/mobile/orders/:id/status` hanterar alla statusövergångar inkl. sidoeffekter
- [ ] Status `en_route` stöds fullt ut
- [ ] `actualDuration`, `enRouteAt`, `customerNotified` beräknas/sätts serverside
- [ ] Alla POST-endpoints för deviations, materials, signature, notes, substeps fungerar
- [ ] `impossibleReason`/`impossibleAt`/`impossibleBy` sparas vid status `impossible`

### Checklista & Inspektion
- [ ] GET `/api/mobile/orders/:id/checklist` returnerar checklistfrågor
- [ ] POST `/api/mobile/orders/:id/inspections` sparar inspektionsdata
- [ ] Fotouppladdning (`upload-photo`, `confirm-photo`) fungerar

### Kundsignering & ETA
- [ ] POST `/api/mobile/orders/:id/customer-signoff` sparar signatur + sammanfattning
- [ ] POST `/api/work-orders/:id/auto-eta-sms` skickar SMS
- [ ] GET `/api/eta-notification/history` och `/config` returnerar korrekt data

### Team
- [ ] CRUD för teams (skapa, bjud in, acceptera, lämna, radera)
- [ ] GET team-orders för teammedlemmars ordrar
- [ ] Resurssökning via `/api/resources/search?q=X`

### Arbetspass
- [ ] Start/stop/pause/resume fungerar korrekt
- [ ] GET active returnerar aktivt arbetspass med status

### Aviseringar
- [ ] GET/POST notification endpoints fungerar
- [ ] Alla 8 notifikationstyper kan skapas och skickas

### Ruttoptimering (R2-R6)
- [ ] POST `/api/distance` returnerar köravstånd i meter och tid i sekunder
- [ ] POST `/api/distance/batch` stödjer flera punktpar
- [ ] POST `/api/disruptions/trigger/delay` loggar förseningar
- [ ] POST `/api/disruptions/trigger/early-completion` loggar tidig färdigställning
- [ ] POST `/api/disruptions/trigger/resource-unavailable` hanterar sjukanmälan
- [ ] GET `/api/break-config` returnerar rastkonfiguration med `earliestSeconds`/`latestSeconds`

### WebSocket
- [ ] Socket.io-server med rum-hantering (`resource:X`, `tenant:X`, `team:X`)
- [ ] Alla 13 server→klient events implementerade (se avsnitt 14)
- [ ] `position_update` broadcastas till tenant-rum
- [ ] `pong` svarar på `ping`

### Övrigt
- [ ] GET `/api/mobile/terminology` returnerar tenant-specifika termer
- [ ] POST `/api/mobile/sync` hanterar offline-buffrade åtgärder
- [ ] POST `/api/mobile/position` tar emot GPS-positioner
- [ ] POST `/api/work-orders/carry-over` flyttar gamla ordrar
- [ ] GET `/api/mobile/summary` returnerar daglig sammanfattning

---

**Slutkommentar:** Alla endpoints ovan har idag mock-implementationer i Traivo Go:s mellanserver. När Traivo One-backend implementerar dessa endpoints ordentligt behöver enbart miljövariabeln `TRAIVO_API_URL` sättas till Traivo One:s bas-URL, så proxyas alla anrop automatiskt. Inga ändringar i Traivo Go:s klientkod krävs.
