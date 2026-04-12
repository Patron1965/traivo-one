# Traivo API-kontrakt

> Gemensamt kontraktsdokument för Traivo One (webb) och Traivo Go (mobil).
> Version: 1.0 · Senast uppdaterad: 2026-04-12

---

## Innehåll

1. [Kärntyper](#1-kärntyper)
2. [Statusflöden](#2-statusflöden)
3. [WebSocket-eventkatalog](#3-websocket-eventkatalog)
4. [Prismodell](#4-prismodell)
5. [Sync-batchformat](#5-sync-batchformat-mobil)

---

## 1. Kärntyper

Alla ID:n är `string` (UUID v4). Alla tidsstämplar är ISO 8601-strängar i JSON-svar.
Alla entiteter har `tenantId: string` för fullständig dataisolering.

### 1.1 WorkOrder

Huvudentitet — en planerad eller utförd arbetsuppgift.

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID, auto-genererad |
| `tenantId` | `string` | ✓ | Tenant-koppling |
| `customerId` | `string` | ✓ | FK → Customer |
| `objectId` | `string` | ✓ | FK → Object |
| `clusterId` | `string \| null` | | FK → Cluster |
| `resourceId` | `string \| null` | | FK → Resource (tilldelad utförare) |
| `teamId` | `string \| null` | | FK → Team (förplanering) |
| `title` | `string` | ✓ | Rubrik |
| `description` | `string \| null` | | Beskrivning |
| `orderType` | `OrderType` | ✓ | `"service"` (default), `"tvatt"`, `"besiktning"`, `"kontroll"`, `"etablering"`, `"tomning"`, `"reparation"`, `"installation"` |
| `priority` | `string` | ✓ | `"low"`, `"normal"` (default), `"high"`, `"urgent"` |
| `orderStatus` | `OrderStatus` | ✓ | Se §2.1 |
| `executionStatus` | `ExecutionStatus` | | Se §2.2 |
| `scheduledDate` | `timestamp \| null` | | Planerat datum |
| `scheduledStartTime` | `string \| null` | | HH:MM |
| `plannedWindowStart` | `timestamp \| null` | | Optimerat tidsfönster start |
| `plannedWindowEnd` | `timestamp \| null` | | Optimerat tidsfönster slut |
| `estimatedDuration` | `integer` | | Beräknad tid i minuter (default 60) |
| `actualDuration` | `integer \| null` | | Verklig tid i minuter |
| `executionCode` | `string \| null` | | Kompetensmatchning: `"kranbil"`, `"tvatt"`, `"sug"` osv. |
| `creationMethod` | `string` | | `"manual"`, `"import"`, `"external_report"`, `"performer"`, `"automatic"` |
| `externalReference` | `string \| null` | | Extern referens (portalID, felanmälan) |
| `notes` | `string \| null` | | Fritext-anteckningar |
| `plannedNotes` | `string \| null` | | Planerarens meddelande till utföraren |
| `cachedValue` | `integer` | | Ordervärde i öre (se §4) |
| `cachedCost` | `integer` | | Orderkostnad i öre |
| `cachedProductionMinutes` | `integer` | | Beräknad produktionstid |
| `isSimulated` | `boolean` | | Simuleringsorder (visas ej i produktion) |
| `impossibleReason` | `ImpossibleReason \| null` | | Se enum nedan |
| `impossibleReasonText` | `string \| null` | | Fritext om omöjlig |
| `etaSmsSent` | `boolean` | | Om ETA-SMS skickats |
| `taskLatitude` | `number \| null` | | GPS lat (om annan än objektets) |
| `taskLongitude` | `number \| null` | | GPS lng |
| `onWayAt` | `timestamp \| null` | | Tidsstämpel: på väg |
| `onSiteAt` | `timestamp \| null` | | Tidsstämpel: på plats |
| `completedAt` | `timestamp \| null` | | Tidsstämpel: utförd |
| `lockedAt` | `timestamp \| null` | | Tidsstämpel: låst |
| `invoicedAt` | `timestamp \| null` | | Tidsstämpel: fakturerad |
| `inspectedAt` | `timestamp \| null` | | Tidsstämpel: kontrollerad |
| `createdAt` | `timestamp` | ✓ | Skapad |
| `deletedAt` | `timestamp \| null` | | Mjuk radering |

**ImpossibleReason enum:**
`"locked_gate"` | `"no_access"` | `"wrong_address"` | `"obstacle"` | `"customer_absent"` | `"weather"` | `"equipment_issue"` | `"other"`

### 1.2 Object

Fysiskt objekt i kundernas hierarki (fastighet, rum, kärl).

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `customerId` | `string` | ✓ | FK → Customer |
| `clusterId` | `string \| null` | | FK → Cluster |
| `parentId` | `string \| null` | | FK → Object (förälder i hierarki) |
| `name` | `string` | ✓ | |
| `objectNumber` | `string \| null` | | Externt ID |
| `objectType` | `string` | ✓ | `"omrade"` (default), `"matavfall"`, `"atervinning"` m.fl. |
| `hierarchyLevel` | `ObjectHierarchyLevel` | | `"koncern"`, `"brf"`, `"fastighet"`, `"rum"`, `"karl"` |
| `objectLevel` | `integer` | | Numerisk nivå (1 = överst, 5 = kärl) |
| `address` | `string \| null` | | |
| `city` | `string \| null` | | |
| `postalCode` | `string \| null` | | |
| `latitude` | `number \| null` | | WGS84 |
| `longitude` | `number \| null` | | WGS84 |
| `entranceLatitude` | `number \| null` | | Entrékoordinater |
| `entranceLongitude` | `number \| null` | | |
| `accessType` | `string` | | `"open"` (default), `"code"`, `"key"` |
| `accessCode` | `string \| null` | | Portkod |
| `keyNumber` | `string \| null` | | Nyckelnummer |
| `accessInfo` | `object` | | `{ gateCode?, keyLocation?, parking?, specialInstructions? }` |
| `containerCount` | `integer` | | Antal kärl (K1) |
| `containerCountK2` | `integer` | | Kärl K2 |
| `containerCountK3` | `integer` | | Kärl K3 |
| `containerCountK4` | `integer` | | Kärl K4 |
| `serialNumber` | `string \| null` | | Unikt serienummer (individkärl) |
| `articleId` | `string \| null` | | Kopplad artikeltyp |
| `condition` | `string` | | `"good"`, `"fair"`, `"poor"`, `"damaged"` |
| `resolvedAccessCode` | `string \| null` | | Ärvt/beräknat |
| `resolvedKeyNumber` | `string \| null` | | Ärvt/beräknat |
| `resolvedPreferredTime1` | `string \| null` | | Ärvt/beräknat |
| `resolvedPreferredTime2` | `string \| null` | | Ärvt/beräknat |
| `hierarchyDepth` | `integer` | | 0 = rot |
| `hierarchyPath` | `string[]` | | Array av object-ID:n från rot |
| `status` | `string` | ✓ | `"active"` (default), `"inactive"` |
| `isInterimObject` | `boolean` | | Skapad via kundportal (interim) |
| `createdAt` | `timestamp` | ✓ | |
| `deletedAt` | `timestamp \| null` | | |

### 1.3 Resource

Utförare (person eller enhet).

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `userId` | `string \| null` | | FK → User |
| `name` | `string` | ✓ | |
| `initials` | `string \| null` | | |
| `resourceType` | `string` | ✓ | `"person"` (default) |
| `phone` | `string \| null` | | |
| `email` | `string \| null` | | |
| `pin` | `string \| null` | | PIN för mobilapp-inloggning (4-6 siffror) |
| `homeLocation` | `string \| null` | | Beskrivning av utgångsplats |
| `homeLatitude` | `number \| null` | | GPS lat |
| `homeLongitude` | `number \| null` | | GPS lng |
| `currentLatitude` | `number \| null` | | Realtidsposition |
| `currentLongitude` | `number \| null` | | |
| `lastPositionUpdate` | `timestamp \| null` | | |
| `trackingStatus` | `string` | | `"offline"` (default), `"idle"`, `"traveling"`, `"on_site"` |
| `weeklyHours` | `integer` | | Default 40 |
| `competencies` | `string[]` | | T.ex. `["tvatt", "kranbil"]` |
| `executionCodes` | `string[]` | | Matchar WorkOrder.executionCode |
| `serviceArea` | `string[]` | | Postnummer |
| `efficiencyFactor` | `number` | | 1.0 = normal |
| `drivingFactor` | `number` | | 1.0 = normal |
| `costCenter` | `string \| null` | | Ekonomisystem |
| `projectCode` | `string \| null` | | |
| `isOnline` | `boolean` | | |
| `status` | `string` | ✓ | `"active"`, `"inactive"` |
| `createdAt` | `timestamp` | ✓ | |
| `deletedAt` | `timestamp \| null` | | |

### 1.4 Article

Artikel — tjänst, vara, kontroll eller beroende.

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `articleNumber` | `string` | ✓ | Unikt per tenant |
| `name` | `string` | ✓ | |
| `description` | `string \| null` | | |
| `articleType` | `string` | ✓ | `"tjanst"` (default), `"felanmalan"`, `"kontroll"`, `"vara"`, `"beroende"` |
| `objectTypes` | `string[]` | | Vilka objekttyper artikeln gäller |
| `hookLevel` | `ArticleHookLevel \| null` | | `"koncern"`, `"brf"`, `"fastighet"`, `"rum"`, `"karl"`, `"karl_mat"`, `"karl_rest"`, `"karl_plast"`, `"kod"` |
| `productionTime` | `integer` | | Minuter |
| `cost` | `integer` | | Intern kostnad i öre |
| `listPrice` | `integer` | | Listpris i öre |
| `executionCode` | `string \| null` | | Krävd kompetens |
| `unit` | `string` | | `"st"` (default), `"tim"`, `"m2"` |
| `limitationType` | `string` | | `"unlimited"` (default), `"one_per_object"`, `"one_per_address"`, `"one_per_customer"` |
| `status` | `string` | ✓ | `"active"`, `"inactive"` |
| `createdAt` | `timestamp` | ✓ | |
| `deletedAt` | `timestamp \| null` | | |

### 1.5 Cluster

Geografiskt eller kundbaserat kluster av objekt.

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `rootCustomerId` | `string \| null` | | FK → Customer |
| `name` | `string` | ✓ | |
| `description` | `string \| null` | | |
| `primaryTeamId` | `string \| null` | | FK → Team |
| `slaLevel` | `string` | | `"standard"` (default), `"premium"`, `"enterprise"` |
| `defaultPeriodicity` | `string` | | `"vecka"` (default), `"manad"`, `"kvartal"` |
| `color` | `string` | | Hex-färg (default `#3B82F6`) |
| `centerLatitude` | `number \| null` | | Geo-center |
| `centerLongitude` | `number \| null` | | |
| `radiusKm` | `number` | | Default 5 |
| `postalCodes` | `string[]` | | Postnummer i klustret |
| `cachedObjectCount` | `integer` | | Auto-beräknat |
| `cachedActiveOrders` | `integer` | | |
| `cachedMonthlyValue` | `integer` | | I öre |
| `status` | `string` | ✓ | `"active"`, `"inactive"` |
| `createdAt` | `timestamp` | ✓ | |
| `deletedAt` | `timestamp \| null` | | |

### 1.6 Deviation (DeviationReport)

Avvikelse rapporterad i fält.

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `workOrderId` | `string \| null` | | FK → WorkOrder |
| `protocolId` | `string \| null` | | FK → Protocol |
| `objectId` | `string` | ✓ | FK → Object |
| `category` | `string` | ✓ | Avvikelsekategori |
| `title` | `string` | ✓ | |
| `description` | `string \| null` | | |
| `severityLevel` | `SeverityLevel` | ✓ | `"low"`, `"medium"` (default), `"high"`, `"critical"` |
| `reportedBy` | `string \| null` | | FK → User |
| `reportedByName` | `string \| null` | | |
| `reportedAt` | `timestamp` | ✓ | |
| `latitude` | `number \| null` | | GPS vid upptäckt |
| `longitude` | `number \| null` | | |
| `photos` | `string[]` | | URL:er till bilder |
| `suggestedAction` | `string \| null` | | Föreslagen åtgärd |
| `estimatedCost` | `integer \| null` | | SEK (heltal) |
| `requiresImmediateAction` | `boolean` | | Default false |
| `actionDeadline` | `timestamp \| null` | | |
| `status` | `string` | ✓ | `"reported"`, `"acknowledged"`, `"in_progress"`, `"resolved"`, `"cancelled"` |
| `resolvedAt` | `timestamp \| null` | | |
| `resolvedBy` | `string \| null` | | FK → User |
| `resolutionNotes` | `string \| null` | | |
| `linkedActionOrderId` | `string \| null` | | Åtgärdsorder |
| `createdAt` | `timestamp` | ✓ | |

### 1.7 TimeEntry (WorkEntry)

Tidregistrering kopplad till en WorkSession.

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `workSessionId` | `string` | ✓ | FK → WorkSession |
| `resourceId` | `string` | ✓ | FK → Resource |
| `entryType` | `string` | ✓ | `"work"` (default), `"travel"`, `"break"`, `"rest"`, `"setup"` |
| `workOrderId` | `string \| null` | | FK → WorkOrder |
| `startTime` | `timestamp` | ✓ | |
| `endTime` | `timestamp \| null` | | |
| `durationMinutes` | `integer \| null` | | Beräknas: end−start |
| `latitude` | `number \| null` | | GPS |
| `longitude` | `number \| null` | | |
| `notes` | `string \| null` | | |
| `createdAt` | `timestamp` | ✓ | |

### 1.8 WorkSession

Arbetspass — daglig container för tidposter.

| Fält | Typ | Obligatorisk | Beskrivning |
|------|-----|:---:|-------------|
| `id` | `string` | ✓ | UUID |
| `tenantId` | `string` | ✓ | |
| `teamId` | `string \| null` | | FK → Team |
| `resourceId` | `string` | ✓ | FK → Resource |
| `date` | `timestamp` | ✓ | Arbetsdatum |
| `startTime` | `timestamp` | ✓ | Passstart |
| `endTime` | `timestamp \| null` | | Passslut |
| `status` | `string` | ✓ | `"active"` (default), `"paused"`, `"completed"` |
| `notes` | `string \| null` | | |
| `createdAt` | `timestamp` | ✓ | |
| `updatedAt` | `timestamp` | ✓ | |

---

## 2. Statusflöden

### 2.1 OrderStatus

Administrativ status för orderns livscykel.

```
┌──────────┐
│  skapad  │────────────────────────────────────────┐
└────┬─────┘                                        │
     │ tilldela team                                │
     ▼                                              │
┌──────────────┐                                    │
│ planerad_pre │ (grovplanerad)                     │
└────┬─────────┘                                    │
     │ tilldela resurs                              │
     ▼                                              │
┌────────────────┐                                  │
│ planerad_resurs│ (finplanerad)                    │
└────┬───────────┘                                  │
     │ lås schema                                   │
     ▼                                              │
┌──────────────┐                                    │
│ planerad_las │ (låst)                             │
└────┬─────────┘                                    │
     │ utfört av fältarbetare                       │
     ▼                                              │
┌────────┐                                          │
│ utford │                                          │
└────┬───┘                                          │
     │ fakturera                                    │
     ▼                                              │
┌────────────┐                                      │
│ fakturerad │                                      │
└────────────┘                                      │
                                                    │
Avbrottsflöden (från alla tillstånd utom fakturerad):│
     ──────────────────────────────────►  avbruten  │
     ──────────────────────────────────►  omojlig  ◄┘
```

**OrderStatus enum:**

| Värde | Svenska | Beskrivning |
|-------|---------|-------------|
| `skapad` | Skapad | Ny order, ej planerad |
| `planerad_pre` | Grovplanerad | Tilldelad vecka/team |
| `planerad_resurs` | Finplanerad | Tilldelad resurs |
| `planerad_las` | Låst | Låst för redigering |
| `utford` | Utförd | Slutförd av fältarbetare |
| `fakturerad` | Fakturerad | Faktura skapad |
| `omojlig` | Omöjlig | Kan ej utföras (med anledning) |
| `avbruten` | Avbruten | Avbruten/inställd |

### 2.2 ExecutionStatus

8-stegs utförandestatus som spårar arbetsflödet mer detaljerat.

```
not_planned → planned_rough → planned_fine → on_way → on_site → completed → inspected → invoiced
```

| Värde | Svenska | Trigger |
|-------|---------|---------|
| `not_planned` | Ej planerad | Default vid skapande |
| `planned_rough` | Grovplanerad | Tilldelad vecka/team |
| `planned_fine` | Finplanerad | Tilldelad specifik resurs |
| `on_way` | På väg | Fältarbetare startar resa |
| `on_site` | På plats | Fältarbetare anländer |
| `completed` | Utförd | Arbete slutfört |
| `inspected` | Kontrollerad | Kvalitetskontroll klar |
| `invoiced` | Fakturerad | Faktura skapad |

**Koppling OrderStatus ↔ ExecutionStatus vid mobilapp-åtgärder:**

| Mobilapp-action | orderStatus → | executionStatus → |
|-----------------|---------------|-------------------|
| Starta resa | (oförändrad) | `on_way` |
| Anlända | `planerad_resurs` | `on_site` |
| Slutför | `utford` | `completed` |
| Uppskjuten | `skapad` | (oförändrad) |
| Avbryt | `avbruten` | (oförändrad) |

---

## 3. WebSocket-eventkatalog

### 3.1 Anslutning

| Egenskap | Värde |
|----------|-------|
| Endpoint | `wss://<host>/ws/notifications` |
| Autentisering | Token-baserad: `?token=<auth_token>` |
| Token-livslängd | 5 minuter, engångs |
| Heartbeat | Client skickar `{ type: "ping" }`, server svarar `{ type: "pong" }` |

Token erhålls via REST: `POST /api/ws/auth` → `{ token: string }`.

### 3.2 Server → Client events

Alla events har formen:

```typescript
{
  id: string;          // "notif_<timestamp>_<random>"
  type: NotificationType;
  title: string;
  message: string;
  orderId?: string;
  resourceId?: string;
  timestamp: string;   // ISO 8601
  data?: Record<string, unknown>;
}
```

| Event-typ | Routing | Beskrivning | data-payload |
|-----------|---------|-------------|--------------|
| `connected` | Broadcast till ansluten client | Bekräftelse vid anslutning | — |
| `job_assigned` | `sendToResource(resourceId)` | Order tilldelad resursen | `{ orderId, orderTitle, scheduledDate, priority }` |
| `job_updated` | `sendToResource(resourceId)` | Order uppdaterad (anteckningar, beskrivning, status) | `{ orderId, changeDescription }` |
| `job_cancelled` | `sendToResource(resourceId)` | Order borttagen/ändrad resurs | `{ orderId }` |
| `schedule_changed` | `sendToResource(resourceId)` | Datum ändrat | `{ orderId, oldDate, newDate }` |
| `priority_changed` | `sendToResource(resourceId)` | Prioritet ändrad | `{ orderId, oldPriority, newPriority }` |
| `position_update` | `broadcastToAll` | Resursposition uppdaterad | `{ resourceId, latitude, longitude, speed, heading, status }` |
| `route_update` | `broadcastToAll` | Ruttinformation | `{ resourceId, routeData }` |
| `anomaly_alert` | `broadcastToAll` | Anomali upptäckt | `{ anomalyType, severity, details }` |
| `order:updated` | `sendToResource(resourceId)` | Synkbekräftelse | `{ status, executionStatus, source: "sync" }` |
| `notification` | `sendToResource(resourceId)` | Generell notifikation | Fritt |

### 3.3 Client → Server events

| Event-typ | Beskrivning | Payload |
|-----------|-------------|---------|
| `ping` | Heartbeat | `{}` |
| `position_update` | GPS-position från mobil | `{ latitude, longitude, speed?, heading?, accuracy?, status?, workOrderId? }` |

### 3.4 Idempotens

- Varje event har unikt `id` (`notif_<timestamp>_<random9>`).
- Klienter bör deduplera baserat på `id` vid reconnect.
- Position-broadcast throttlas till max 1 per 30 sekunder per resurs.

---

## 4. Prismodell

### 4.1 Valutaenhet

**Alla belopp lagras i öre (1/100 SEK).** Vid visning divideras med 100.

```
10000 öre = 100,00 SEK
```

Gäller fälten: `listPrice`, `cost`, `resolvedPrice`, `resolvedCost`, `cachedValue`, `cachedCost`, `cachedMonthlyValue`.

### 4.2 Prisupplösningskedja

När en orderrad skapas löses priset upp genom följande prioritetsordning (högsta först):

```
1. Rabattbrev    (priceListType = "rabattbrev", kundspecifik)
   └─ Procentuell rabatt på listpris
2. Kundunik      (priceListType = "kundunik", kundspecifik)
   └─ Fast pris per artikel för kunden
3. Generell      (priceListType = "generell")
   └─ Standardpris per artikel
4. Listpris      (article.listPrice)
   └─ Artikelns grundpris
```

Upplösningen sker i `storage.resolveArticlePrice(tenantId, articleId, customerId)`.

### 4.3 PriceSource-fält

Orderraden (`WorkOrderLine`) registrerar vilken källa som användes:

| `priceSource` | Beskrivning |
|----------------|-------------|
| `"rabattbrev"` | Pris från rabattbrev |
| `"kundunik"` | Kundspecifik prislista |
| `"generell"` | Generell prislista |
| `"listprice"` | Artikelns listpris (fallback) |

### 4.4 WorkOrderLine

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `id` | `string` | UUID |
| `tenantId` | `string` | |
| `workOrderId` | `string` | FK → WorkOrder |
| `articleId` | `string` | FK → Article |
| `quantity` | `integer` | Default 1 |
| `resolvedPrice` | `integer` | Pris i öre (uppöst) |
| `resolvedCost` | `integer` | Kostnad i öre |
| `resolvedProductionMinutes` | `integer` | |
| `priceListIdUsed` | `string \| null` | Vilken prislista |
| `priceSource` | `string \| null` | Se ovan |
| `discountPercent` | `integer` | Default 0 |
| `isOptional` | `boolean` | Valfri rad |
| `notes` | `string \| null` | |

### 4.5 Orderaggregat

WorkOrder-tabellen cachar aggregerade värden (`cachedValue`, `cachedCost`, `cachedProductionMinutes`) som uppdateras via `storage.recalculateWorkOrderTotals(workOrderId)` varje gång en rad läggs till, ändras eller tas bort.

---

## 5. Sync-batchformat (mobil)

### 5.1 Endpoint

```
POST /api/mobile/sync
Authorization: X-Resource-Pin / session
```

### 5.2 Request-format

```typescript
{
  actions: SyncAction[];
}

interface SyncAction {
  clientId: string;    // Unikt ID genererat av klienten (idempotens-nyckel)
  actionType: string;  // Se tabell nedan
  payload: object;     // Action-specifik data
}
```

### 5.3 Response-format

```typescript
{
  success: boolean;
  processed: number;    // Totalt antal actions
  completed: number;    // Lyckade
  failed: number;       // Misslyckade
  results: Array<{
    clientId: string;
    status: "completed" | "error";
    error?: string;
  }>;
}
```

### 5.4 ActionTypes

| actionType | Beskrivning | payload |
|------------|-------------|---------|
| `status_update` | Ändra orderstatus | `{ orderId: string, status: string, notes?: string }` |
| `note` | Lägg till anteckning | `{ orderId: string, text: string }` |
| `deviation` | Rapportera avvikelse | `{ orderId: string, description?: string, severity?: string, category?: string }` |
| `material` | Logga materialanvändning | `{ orderId: string, articleId: string, quantity?: number, comment?: string }` |
| `gps` | Skicka GPS-position | `{ latitude: number, longitude: number, speed?: number, heading?: number, accuracy?: number }` |
| `inspection` | Spara besiktningsdata | `{ orderId: string, inspections?: object[], checklist?: object[] }` |
| `signature` | Spara signatur | `{ orderId: string, signature: string }` |
| `photo` | Ladda upp foton | `{ orderId: string, photos: Array<{ uri: string, caption?: string }> }` |

### 5.5 Status-mappning vid sync

Mobilappen skickar förenklade statusvärden som mappas till orderStatus + executionStatus:

| Skickat status-värde | → orderStatus | → executionStatus | Extra åtgärder |
|---------------------|---------------|-------------------|----------------|
| `en_route` | (oförändrad) | `on_way` | Triggar ETA-notifikation |
| `paborjad` / `in_progress` | `planerad_resurs` | `on_site` | Sätter `onSiteAt` |
| `planned` | (oförändrad) | `planned_fine` | |
| `utford` / `completed` | `utford` | `completed` | Sätter `completedAt` |
| `ej_utford` / `deferred` | `skapad` | (oförändrad) | Lägger till anteckning |
| `cancelled` | `avbruten` | (oförändrad) | Lägger till anteckning |

### 5.6 Idempotens

Varje action loggas med `clientId` i `offline_sync_logs`-tabellen. Klienten bör generera ett unikt `clientId` per åtgärd och kan kontrollera status via:

```
GET /api/mobile/sync/status
```

### 5.7 Work Session API (komplement)

| Endpoint | Metod | Beskrivning |
|----------|-------|-------------|
| `/api/mobile/work-sessions/start` | POST | Starta arbetspass |
| `/api/mobile/work-sessions/active` | GET | Hämta aktivt pass |
| `/api/mobile/work-sessions/:id/stop` | PATCH/POST | Avsluta pass |
| `/api/mobile/work-sessions/:id/pause` | PATCH/POST | Pausa pass |
| `/api/mobile/work-sessions/:id/resume` | PATCH/POST | Återuppta pass |
| `/api/mobile/work-sessions/:id/entries` | POST | Lägg till tidspost |

Work Session-objekt (in-memory på resource.metadata):

```typescript
{
  id: string;             // "ws-<timestamp>-<random>"
  startTime: string;      // ISO 8601
  endTime: string | null;
  status: "active" | "paused" | "completed";
  pausedAt: string | null;
  totalPauseMinutes: number;
}
```
