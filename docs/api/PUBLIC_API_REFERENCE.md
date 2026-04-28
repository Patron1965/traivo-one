# Traivo One — Publik API-referens

*Version: 1 · Senast uppdaterad: 2026-04-28*

Detta dokument beskriver Traivo One:s REST-API på en nivå där en extern
utvecklare kan integrera mot plattformen utan att läsa källkoden. Alla
exempel använder verkliga endpoints och fältnamn från produktion.

För datamodeller, statusflöden, WebSocket-event och prismodell — se
[`TRAIVO_API_CONTRACTS.md`](TRAIVO_API_CONTRACTS.md). För mobilappen
(Traivo Go) finns en djupare guide i
[`TRAIVO_GO_INTEGRATION_GUIDE.md`](TRAIVO_GO_INTEGRATION_GUIDE.md).

---

## Innehåll

1. [Översikt](#1-översikt)
2. [Bas-URL och versionering](#2-bas-url-och-versionering)
3. [Autentisering](#3-autentisering)
4. [Tenant, ID:n och datatyper](#4-tenant-idn-och-datatyper)
5. [Fel, statuskoder och svarsformat](#5-fel-statuskoder-och-svarsformat)
6. [Hastighetsbegränsningar och kostnadstak](#6-hastighetsbegränsningar-och-kostnadstak)
7. [Realtid (WebSocket)](#7-realtid-websocket)
8. [Endpoint-katalog](#8-endpoint-katalog)
   - 8.1 Tenant och organisation
   - 8.2 Kunder
   - 8.3 Objekt och hierarki
   - 8.4 Resurser, team och tilldelning
   - 8.5 Artiklar och prislistor
   - 8.6 Arbetsordrar
   - 8.7 Orderkoncept (abonnemang och rullande ordrar)
   - 8.8 Schema, planering och rutt
   - 8.9 Notiser, SMS och kommunikation
   - 8.10 Mobil-API (Traivo Go)
   - 8.11 Kundportalen
   - 8.12 Importer
   - 8.13 Fortnox-integration
   - 8.14 Rapporter, KPI:er och AI
   - 8.15 Akut-jobb
   - 8.16 Administration och system
9. [End-to-end-exempel](#9-end-to-end-exempel)
10. [Versionshistorik och deprekering](#10-versionshistorik-och-deprekering)
11. [Support och kontakt](#11-support-och-kontakt)

---

## 1. Översikt

Traivo One är en SaaS-plattform för planering och utförande av
fältservice. API:et används av:

- **Webbgränssnittet** (planerare, administratörer, kundtjänst)
- **Traivo Go** — mobilappen för fälttekniker
- **Kundportalen** — slutkundens vy med magic-link-inloggning
- **Externa integrationer** — t.ex. ekonomisystem (Fortnox),
  felanmälningsportaler, IoT-system och kunders egna BI-verktyg

Tre stora dataobjekt återkommer i nästan alla flöden:

| Objekt | Beskrivning |
|--------|-------------|
| **Customer** | Den juridiska kunden (slutbeställare). |
| **Object** | Fysisk plats eller utrustning där arbete utförs. Kan vara hierarkisk (koncern → BRF → fastighet → rum → kärl). |
| **WorkOrder** | Ett konkret arbetsmoment med tid, resurs och artiklar. |

API:et exponerar både CRUD-operationer på dessa entiteter och
högre-nivå-endpoints för planering, optimering, rapportering och
notifiering.

---

## 2. Bas-URL och versionering

**Produktion:** `https://<din-tenant-domain>.traivo.app`

Varje endpoint kan anropas på två sätt:

```
https://<host>/api/<resurs>           (oversionerad — deprekerad)
https://<host>/api/v1/<resurs>        (versionerad — rekommenderad)
```

Nya integrationer ska alltid använda `/api/v1/`. Den oversionerade
varianten fungerar fortfarande, men returnerar:

```
Deprecation: true
Sunset: 2027-06-01
Link: </api/v1/<resurs>>; rel="successor-version"
```

Endpointen `GET /api/version` (oversionerad — undantagen från
deprekeringsvarning) returnerar aktuell version:

```json
{
  "current": "v1",
  "supported": ["v1"],
  "deprecatedUnversioned": true,
  "sunset": "2027-06-01"
}
```

I resten av dokumentet skrivs endpoints som `/api/v1/...`.

---

## 3. Autentisering

Traivo One har **tre separata autentiseringsspår**, ett per
användartyp. Inget av dem är JWT.

### 3.1 Webb-session (planerare och administratörer)

Webbgränssnittet använder Replit OIDC och en server-side session-cookie.
Ett externt system bör normalt inte använda detta spår; använd
mobil-bearer eller portal-session istället.

| Steg | Endpoint |
|------|----------|
| Inloggning | `GET /api/login` (302 till OIDC-provider) |
| Callback | `GET /api/callback` |
| Sessionscookie | `connect.sid` (httpOnly, secure, 7 dagars TTL) |
| Användarinfo | `GET /api/auth/user` |
| Utloggning | `GET /api/logout` |

### 3.2 Mobil-bearer (Traivo Go och fältintegrationer)

Använd när systemet agerar **som en specifik tekniker** — t.ex. för att
hämta dagens jobb eller rapportera GPS-position.

**Login:** Tre varianter accepteras i samma endpoint. Använd det första
exemplet om du integrerar nytt.

```http
POST /api/v1/mobile/login
Content-Type: application/json

{ "email": "anna@acme.se", "pin": "1234" }
```

Alternativ: `{ "username": "anna@acme.se", "password": "<pin>" }` eller
`{ "pin": "1234" }` (PIN-bara — slår upp första aktiva resurs med matchande
PIN inom tenant; rekommenderas inte för flera tekniker).

**Svar (200):**

```json
{
  "success": true,
  "token": "f3c8a91b7d2e4a13...",
  "user": {
    "id": "res_abc123",
    "name": "Anna Andersson",
    "role": "person",
    "resourceId": "res_abc123",
    "vehicleRegNo": "",
    "executionCodes": ["tvatt", "kranbil"]
  },
  "resource": {
    "id": "res_abc123",
    "tenantId": "tenant_xyz",
    "name": "Anna Andersson",
    "phone": "+46701234567",
    "email": "anna@acme.se",
    "homeLatitude": 59.3293,
    "homeLongitude": 18.0686,
    "executionCodes": ["tvatt", "kranbil"]
  }
}
```

**Användning:** Skicka `Authorization: Bearer <token>` på alla
`/api/v1/mobile/*`-anrop. Tokenet är opakt (inte en JWT), giltigt i
**24 timmar** och lagras i serverminnet — en serveromstart invaliderar
alla tokens. Klienten måste då logga in på nytt.

**Logout:** `POST /api/v1/mobile/logout`.

**Hastighetsbegränsning:** Max 10 misslyckade login-försök per IP per
15 minuter — sedan `429`.

### 3.3 Portal-session (kundportalen)

Slutkund loggar in med en magic-link skickad via e-post.

**Steg 1 — begär länk:**

```http
POST /api/v1/portal/auth/request-link
Content-Type: application/json

{
  "email": "kund@example.com",
  "tenantId": "tenant_xyz"
}
```

E-postmeddelandet innehåller `https://<host>/portal?token=<token>` där
token är giltig i 15 minuter och kan endast användas en gång.

**Steg 2 — verifiera:**

```http
POST /api/v1/portal/auth/verify
Content-Type: application/json

{ "token": "<token-från-länken>" }
```

**Svar (200):**

```json
{
  "sessionToken": "ZGVmYXVsdC1zZXNzaW9uLXRva2Vu...",
  "customer": { "id": "cust_...", "name": "BRF Ekorren" },
  "tenant":   { "id": "tenant_xyz", "name": "Acme Service AB" },
  "expiresAt": "2026-05-28T13:32:00.000Z"
}
```

**Användning:** Skicka `Authorization: Bearer <sessionToken>` på alla
`/api/v1/portal/*`-anrop. Sessionen lever i 30 dagar och förnyas
implicit vid varje access.

### 3.4 Begränsningar idag

- Det finns **ingen publik API-nyckelmekanism** för server-till-server-
  integrationer. För sådana use cases bör du tills vidare använda en
  dedikerad teknikerresurs (mobil-bearer) eller kontakta supporten.
- Webhook-utskick mot tredje part stöds inte ännu — använd WebSocket
  (avsnitt 7) eller polling.

---

## 4. Tenant, ID:n och datatyper

| Aspekt | Värde |
|--------|-------|
| **Tenant-isolering** | Varje entitet har `tenantId`. Alla endpoints filtrerar automatiskt på inloggad användares tenant. Det går aldrig att läsa eller skriva data i en annan tenant. |
| **ID-format** | UUID v4 (`gen_random_uuid()`), serialiseras som sträng. |
| **Tidsstämplar** | ISO 8601 i UTC, t.ex. `2026-04-28T13:32:00.000Z`. |
| **Datum (utan tid)** | `YYYY-MM-DD`, t.ex. `2026-04-28`. |
| **Belopp** | Heltal i **öre** (1/100 SEK). Visa som kronor genom att dela med 100. |
| **Tidslängd** | Heltal i **minuter**, om inget annat anges. |
| **GPS** | `latitude` och `longitude` som flyttal i decimalgrader (WGS84). |
| **Telefonnummer** | E.164 (`+46701234567`). |
| **Språk** | Svenska i alla användarvända textfält. Tekniska enum-värden är på svenska eller engelska — se respektive endpoint. |

---

## 5. Fel, statuskoder och svarsformat

Alla svar är JSON. Standardiserade statuskoder:

| Kod | Betydelse |
|-----|-----------|
| `200 OK` | Lyckad GET/PATCH/DELETE. |
| `201 Created` | Lyckad POST som skapade en resurs. |
| `204 No Content` | Lyckad operation utan svarskropp. |
| `400 Bad Request` | Felaktig input (typiskt Zod-validering). |
| `401 Unauthorized` | Saknar eller har ogiltig autentisering. |
| `403 Forbidden` | Autentiserad men saknar behörighet (fel roll eller tenant). |
| `404 Not Found` | Resursen finns inte i din tenant. |
| `409 Conflict` | Konflikt med befintlig data (t.ex. dubblett). |
| `422 Unprocessable Entity` | Affärsregelbrott (t.ex. orderlås). |
| `429 Too Many Requests` | Hastighetsbegränsning eller AI-budgettak. |
| `500 Internal Server Error` | Oväntat serverfel. |

**Felkroppen** följer mönstret:

```json
{
  "error": "Validation failed",
  "message": "phone must be a valid E.164 number",
  "details": [
    { "path": ["phone"], "message": "Invalid phone format" }
  ]
}
```

Vid valideringsfel innehåller `details` Zod-utdata. Vid affärsregelbrott
finns oftast bara `error` och `message` på svenska.

---

## 6. Hastighetsbegränsningar och kostnadstak

- **Generellt:** Inga hårda rate limits per IP idag.
- **AI-endpoints** (`/api/v1/ai/*`, `/api/v1/mobile/ai/*`,
  `/api/v1/predictive/*`): omfattas av tenant-budget. Vid överskridet
  tak returneras `429` med `{ "error": "AI budget exceeded" }`. Status
  kan läsas via `GET /api/v1/system/budget-status`.
- **SMS-utskick:** kvoteras per tenant i tenantens inställningar.
- **Sync** (`POST /api/v1/mobile/sync`): bör inte anropas oftare än var
  60:e sekund.

---

## 7. Realtid (WebSocket)

Server skickar push-uppdateringar via WebSocket på samma host:

```
wss://<host>/ws/notifications?token=<token>
```

Token är **kortlivad och engångsanvänd** (5 minuter, försvinner direkt
efter validering). Hämta token med en autentiserad webbsession:

```http
POST /api/v1/notifications/user-token
Cookie: connect.sid=<session>
```

Svar:

```json
{ "token": "abc...", "expiresIn": 300, "userId": "<user-id>" }
```

Anslut sedan WebSocketen med tokenet som query-parameter. Vid lyckad
anslutning skickar servern en `connected`-händelse. Klienten kan svara
med `{"type":"ping"}` för keep-alive (servern svarar med `pong`).

Token-flödet ovan är endast tillgängligt för web-användare. Mobil-klienter
får sina notiser via FCM/APNS-push (se `POST /api/v1/mobile/push-token`
i avsnitt 8.10).

Eventkatalogen — `workOrder.updated`, `resource.position`,
`schedule.published`, `urgentJob.broadcast` m.fl. — finns dokumenterad i
[`TRAIVO_API_CONTRACTS.md`](TRAIVO_API_CONTRACTS.md#websocket-event).

---

## 8. Endpoint-katalog

Tabellerna nedan listar de viktigaste endpointsen per domän. Standard­
operationer (`GET /resurs`, `GET /resurs/:id`, `POST /resurs`,
`PATCH /resurs/:id`, `DELETE /resurs/:id`) anges som "CRUD" där
beteendet är konventionellt.

### 8.1 Tenant och organisation

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/tenant` | Aktuell tenants grunddata. |
| `PATCH /api/v1/tenant` | Uppdatera namn, kontakt, organisationsnummer. |
| `GET /api/v1/tenant/settings` | Konfiguration (industry, SMS, modul-flaggor). |
| `PATCH /api/v1/tenant/settings` | Uppdatera inställningar. |
| `GET /api/v1/me/tenant` | Inloggad användares tenant och roll. |
| `GET /api/v1/tenant/features` | Aktiverade modul-flaggor (feature flags). |
| `PATCH /api/v1/tenant/features` | Slå på/av modulflaggor (admin). |
| `GET /api/v1/tenant/features/audit` | Logg över ändringar i flaggor. |

### 8.2 Kunder

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/customers` | Lista kunder. Stöder `?search=` och `?limit=`. |
| `GET /api/v1/customers/:id` | Hämta kund. |
| `POST /api/v1/customers` | Skapa kund. |
| `PATCH /api/v1/customers/:id` | Uppdatera kund. |
| `DELETE /api/v1/customers/:id` | Mjuk-radera kund (sätter `deletedAt`). |
| `GET /api/v1/customers/:id/objects` | Lista alla objekt för kund. |
| `GET /api/v1/customers/:id/work-orders` | Lista alla ordrar för kund. |
| `POST /api/v1/customers/:id/merge` | Slå ihop dubbletter. |

**Kund-skapande exempel:**

```http
POST /api/v1/customers
Authorization: Bearer <session-cookie eller mobil-token>
Content-Type: application/json

{
  "name": "BRF Ekorren",
  "orgNumber": "769600-1234",
  "contactPerson": "Eva Karlsson",
  "email": "eva@brfekorren.se",
  "phone": "+46812345678",
  "address": "Storgatan 1",
  "city": "Stockholm",
  "postalCode": "11122"
}
```

### 8.3 Objekt och hierarki

Objekt kan vara hierarkiska — koncern → BRF → fastighet → rum → kärl —
och ärver åtkomstkod, nyckel och tidspreferenser från sin förälder.

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/objects` | Lista objekt. `?customerId=`, `?clusterId=`, `?level=`. |
| `GET /api/v1/objects/:id` | Hämta objekt med beräknade (resolved) ärvda värden. |
| `POST /api/v1/objects` | Skapa objekt. |
| `PATCH /api/v1/objects/:id` | Uppdatera. |
| `DELETE /api/v1/objects/:id` | Mjuk-radera. |
| `GET /api/v1/objects?parentId=...` | Barn i hierarkin (filtrera på parent). |
| `GET /api/v1/objects/:objectId/images` | Bilder kopplade till objekt. |
| `POST /api/v1/objects/:objectId/images` | Ladda upp bild (tvåstegs — se 8.10). |
| `GET /api/v1/objects/:objectId/contacts` | Kontaktpersoner för objekt. |
| `POST /api/v1/objects/:objectId/contacts` | Skapa kontakt. |
| `GET /api/v1/objects/:id/matching-articles` | Artiklar som hookar på objektet (legacy). |
| `GET /api/v1/objects/:objectId/applicable-articles` | Tillämpbara artiklar (rekommenderas). |
| `GET /api/v1/objects/:objectId/time-restrictions` | Tidsbegränsningar (när arbete får ske). |

**Hierarkinivåer:** `koncern`, `brf`, `fastighet`, `rum`, `karl`.

### 8.4 Resurser, team och tilldelning

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/resources` | Lista resurser (tekniker, fordon m.m.). |
| `GET /api/v1/resources/:id` | Hämta resurs. |
| `POST /api/v1/resources` | Skapa resurs. |
| `PATCH /api/v1/resources/:id` | Uppdatera. |
| `DELETE /api/v1/resources/:id` | Mjuk-radera. |
| `GET /api/v1/resources/active-positions` | Senaste GPS för alla aktiva resurser. |
| `GET /api/v1/resources/:id/positions` | Position­historik. |
| `GET /api/v1/resources/availability` | Tillgänglighet per dag/vecka. |
| `GET /api/v1/resources/:resourceId/work-orders` | Tilldelade ordrar. |
| `GET /api/v1/resources/:id/sms-history` | SMS-historik till resursen. |
| `GET /api/v1/teams` | Lista team. |
| `POST /api/v1/teams` | Skapa team. |
| `GET /api/v1/assignments` | Tilldelningar (resurs ↔ order). |
| `POST /api/v1/assignments` | Skapa tilldelning. |
| `GET /api/v1/assignments/:id/candidates` | Kandidater (resurser som matchar krav). |
| `POST /api/v1/assignments/:id/assign` | Bekräfta tilldelning. |

### 8.5 Artiklar och prislistor

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/articles` | Lista artiklar (tjänster, varor, kontroller). |
| `GET /api/v1/articles/:id` | Hämta artikel. |
| `POST /api/v1/articles` | Skapa artikel. |
| `PATCH /api/v1/articles/:id` | Uppdatera. |
| `DELETE /api/v1/articles/:id` | Mjuk-radera. |
| `GET /api/v1/articles/:id/matched-objects` | Objekt som artikeln hookar på. |
| `POST /api/v1/articles/:id/test-association` | Testa hook-villkor. |
| `GET /api/v1/structural-articles` | Strukturartiklar (paket av sub-uppgifter). |
| `POST /api/v1/structural-articles/:parentArticleId/preview-tasks` | Förhandsgranska expansion. |
| `GET /api/v1/price-lists` | Lista prislistor (generella, kundunika, rabattbrev). |
| `POST /api/v1/price-lists` | Skapa prislista. |
| `GET /api/v1/resolve-price?articleId=...&customerId=...&objectId=...` | Beräkna pris från hierarkin. |

### 8.6 Arbetsordrar

Arbetsordrar (`workOrders`) är navet i systemet. Det finns fyra
parallella statusfält — använd `orderStatus` för Modus-flödet:

`skapad → planerad_pre → planerad_resurs → planerad_las → utford → fakturerad`

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/work-orders` | Lista. Stöder `?status=`, `?startDate=`, `?endDate=`, `?resourceId=`, `?customerId=`. Datum som `YYYY-MM-DD` eller ISO 8601. |
| `GET /api/v1/work-orders/:id` | Hämta order med rader. |
| `POST /api/v1/work-orders` | Skapa order. |
| `PATCH /api/v1/work-orders/:id` | Uppdatera. |
| `DELETE /api/v1/work-orders/:id` | Mjuk-radera. |
| `POST /api/v1/work-orders/:id/status` | Byt status (med validering). |
| `POST /api/v1/work-orders/:id/promote` | Promovera simulerad order till skarp. |
| `POST /api/v1/work-orders/bulk-unschedule` | Avplanera flera. |
| `POST /api/v1/work-orders/carry-over` | Flytta över oavslutade till nästa dag. |
| `POST /api/v1/work-orders/bulk-apply-lines` | Applicera artikelrader på flera ordrar. |
| `GET /api/v1/work-orders/:workOrderId/lines` | Orderrader (artiklar). |
| `POST /api/v1/work-orders/:workOrderId/lines` | Lägg till rad. |
| `PATCH /api/v1/work-order-lines/:id` | Uppdatera rad. |
| `DELETE /api/v1/work-order-lines/:id` | Ta bort rad. |
| `GET /api/v1/work-orders/:workOrderId/objects` | Kopplade objekt (om flera). |
| `POST /api/v1/work-orders/:workOrderId/objects` | Lägg till objekt. |
| `GET /api/v1/work-orders/:workOrderId/timewindows` | Tidsfönster. |
| `POST /api/v1/work-orders/:workOrderId/timewindows` | Lägg till tidsfönster. |
| `GET /api/v1/work-orders/:workOrderId/dependencies` | Beroenden (förkrav). |
| `POST /api/v1/work-orders/:workOrderId/dependencies` | Lägg till beroende. |
| `GET /api/v1/work-orders/:workOrderId/dependents` | Ordrar som beror på denna. |
| `GET /api/v1/work-orders/:workOrderId/dependency-chain` | Hela kedjan. |
| `POST /api/v1/work-orders/:id/expand-structural` | Expandera strukturartikel till sub-uppgifter. |
| `GET /api/v1/work-orders/:id/sub-steps` | Sub-uppgifter från expansion. |
| `GET /api/v1/work-orders/:workOrderId/communications` | SMS/e-post-historik för ordern. |
| `POST /api/v1/work-orders/:workOrderId/send-sms` | Skicka manuell SMS-uppdatering. |
| `POST /api/v1/work-orders/:workOrderId/auto-eta-sms` | Trigga automatisk ETA-SMS. |
| `POST /api/v1/work-orders/:workOrderId/generate-pickup-tasks` | Skapa hämtuppdrag baserat på order. |

**Skapa order — minimalt exempel:**

```http
POST /api/v1/work-orders
Authorization: ...
Content-Type: application/json

{
  "customerId": "cust_abc",
  "objectId": "obj_def",
  "title": "Tömning matavfallskärl",
  "orderType": "service",
  "priority": "normal",
  "scheduledDate": "2026-05-12T07:00:00.000Z",
  "estimatedDuration": 25,
  "lines": [
    { "articleId": "art_t100", "quantity": 1 }
  ]
}
```

### 8.7 Orderkoncept (abonnemang och rullande ordrar)

Orderkoncept genererar ordrar automatiskt enligt mönster (t.ex. "varje
tisdag jämn vecka" eller "tre gånger per år, mars/juli/november").

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/order-concepts` | Lista koncept. |
| `GET /api/v1/order-concepts/:id` | Hämta koncept. |
| `POST /api/v1/order-concepts` | Skapa. |
| `PATCH /api/v1/order-concepts/:id` | Uppdatera. |
| `DELETE /api/v1/order-concepts/:id` | Mjuk-radera. |
| `POST /api/v1/order-concepts/:id/preview` | Förhandsgranska kommande ordrar utan att skapa. |
| `POST /api/v1/order-concepts/:id/execute` | Generera ordrar för en period. |
| `POST /api/v1/order-concepts/:id/run-rolling` | Rullande generering (löpande). |
| `POST /api/v1/order-concepts/:id/rerun` | Kör om misslyckad körning. |
| `GET /api/v1/order-concepts/:id/subscription-calc` | Beräkna abonnemangsavgift. |
| `POST /api/v1/order-concepts/:id/detect-changes` | Detektera ändringar i underlaget. |
| `GET /api/v1/order-concepts/:conceptId/filters` | Aktiva objektsfilter. |
| `POST /api/v1/order-concepts/:conceptId/filters` | Lägg till filter. |
| `GET /api/v1/order-concept-run-logs` | Körhistorik. |
| `GET /api/v1/subscription-changes` | Detekterade förändringar (för godkännande). |
| `PATCH /api/v1/subscription-changes/:id` | Godkänn eller avvisa. |

### 8.8 Schema, planering och rutt

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/schedule` | Schemavy. `?from=`, `?to=`, `?resourceId=`. |
| `GET /api/v1/planner/orders` | Ordrar i planeringsläge med extra metadata. |
| `GET /api/v1/planner/routes` | Beräknade rutter per resurs och dag. |
| `GET /api/v1/planner/events` | SSE-ström med planeringsuppdateringar. |
| `GET /api/v1/planner/drivers/locations` | Realtidsposition för alla förare. |
| `PATCH /api/v1/planner/orders/:id/reassign` | Flytta order mellan resurser. |
| `POST /api/v1/auto-plan-week` | Automatisk planering av vecka (förhandsgranskning). |
| `POST /api/v1/auto-plan-week/apply` | Applicera autoplan. |
| `POST /api/v1/route/optimize` | Optimera rutt för en lista ordrar. |
| `POST /api/v1/route/google-maps-url` | Bygg Google Maps-länk för rutt. |
| `POST /api/v1/route/send-to-mobile` | Skicka rutt till tekniker. |
| `POST /api/v1/routes/optimize` | Alternativ optimerings-endpoint (legacy). |
| `POST /api/v1/routes/directions` | Hämta vägbeskrivning. |
| `POST /api/v1/route-geometry` | Hämta polyline för karta. |
| `POST /api/v1/planning/what-if` | Simulera planeringsscenario. |
| `GET /api/v1/planning/constraints` | Aktiva planeringsregler. |
| `GET /api/v1/planning/heatmap` | Beläggnings-heatmap. |

### 8.9 Notiser, SMS och kommunikation

| Metod & path | Beskrivning |
|--------------|-------------|
| `GET /api/v1/notifications` | Lista notiser för inloggad användare. |
| `PATCH /api/v1/notifications/:id/read` | Markera som läst. |
| `PATCH /api/v1/notifications/read-all` | Markera alla som lästa. |
| `GET /api/v1/notifications/types` | Tillgängliga notistyper. |
| `POST /api/v1/notifications/send` | Skicka manuell notis. |
| `POST /api/v1/notifications/technician-on-way/:workOrderId` | "Tekniker på väg"-SMS. |
| `POST /api/v1/notifications/job-completed/:workOrderId` | "Klart"-SMS. |
| `POST /api/v1/notifications/send-schedule/:resourceId` | Skicka veckoschema till tekniker. |
| `GET /api/v1/status-message-templates` | Mallar för statusmeddelanden. |
| `POST /api/v1/status-message-templates` | Skapa mall. |
| `GET /api/v1/telephony/lookup?phone=...` | Slå upp inkommande nummer mot kund/objekt. |
| `GET /api/v1/telephony/lookup-with-status` | Som ovan, med aktuell orderstatus. |

### 8.10 Mobil-API (Traivo Go)

Alla `/api/v1/mobile/*`-endpoints kräver mobil-bearer (3.2). Se
[`TRAIVO_GO_INTEGRATION_GUIDE.md`](TRAIVO_GO_INTEGRATION_GUIDE.md) för
djupare exempel.

**Auth och profil**

| Endpoint | Beskrivning |
|----------|-------------|
| `POST /api/v1/mobile/login` | Logga in med e-post + PIN (se 3.2 för fallback-varianter). |
| `POST /api/v1/mobile/logout` | Logga ut. |
| `GET /api/v1/mobile/me` | Profil för inloggad tekniker. |
| `GET /api/v1/mobile/preferences` | Klientpreferenser. |
| `PUT /api/v1/mobile/preferences` | Skriv preferenser. |
| `PATCH /api/v1/mobile/me/notification-prefs` | Notispreferenser. |

**Mina ordrar**

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/mobile/my-orders` | Dagens/veckans tilldelade ordrar. |
| `GET /api/v1/mobile/orders` | Alternativ lista (filter via query). |
| `GET /api/v1/mobile/orders/:id` | Orderdetaljer. |
| `PATCH /api/v1/mobile/orders/:id/status` | Byt status — se enum nedan. |
| `POST /api/v1/mobile/orders/:id/notes` | Skapa anteckning. |
| `POST /api/v1/mobile/orders/:id/deviations` | Rapportera avvikelse. |
| `POST /api/v1/mobile/orders/:id/materials` | Registrera förbrukade material. |
| `POST /api/v1/mobile/orders/:id/signature` | Lagra kundsignatur (base64). |
| `POST /api/v1/mobile/orders/:id/customer-signoff` | Slutgodkännande. |
| `POST /api/v1/mobile/orders/:id/inspections` | Spara checklist-svar. |
| `PATCH /api/v1/mobile/orders/:id/substeps/:stepId` | Bocka av sub-uppgift. |

**Status-enum för `PATCH /api/v1/mobile/orders/:id/status`**

Skicka `{ "status": "<värde>" }` plus eventuella metadatafält. Stödda
värden:

| Värde (alias) | Effekt |
|---------------|--------|
| `dispatched` | Tekniker tilldelad / utskickad. Sätter `onWayAt`. |
| `en_route` | På väg. Triggar ETA-notis till kund. Acceptera `enRouteAt` (ISO 8601). |
| `paborjad` / `in_progress` | Påbörjad på plats. Sätter `onSiteAt`. |
| `planned` / `assigned` | Tilldelad men ej påbörjad. |
| `utford` / `completed` | Klar. Acceptera `actualDuration` (minuter) och `notes`. Sätter `completedAt`. |
| `impossible` | Omöjlig att utföra. Acceptera `impossibleReason` och `notes`. |
| `ej_utford` / `deferred` | Uppskjuten — order tillbaka till `skapad`. Acceptera `notes`. |
| `cancelled` | Inställd. Acceptera `notes`. |

**Foton (tvåstegs)**

```
POST /api/v1/mobile/orders/:id/upload-photo  → returnerar { uploadUrl }
PUT  <uploadUrl>                              (PUT bilden direkt mot Object Storage)
POST /api/v1/mobile/orders/:id/confirm-photo  { photoKey, caption }
```

**Tid och GPS**

| Endpoint | Beskrivning |
|----------|-------------|
| `POST /api/v1/mobile/work-sessions/start` | Starta arbetspass. |
| `POST /api/v1/mobile/work-sessions/:id/pause` | Pausa. |
| `POST /api/v1/mobile/work-sessions/:id/resume` | Återuppta. |
| `POST /api/v1/mobile/work-sessions/:id/stop` | Avsluta. |
| `GET /api/v1/mobile/work-sessions/active` | Aktivt pass. |
| `POST /api/v1/mobile/work-sessions/:id/entries` | Logga tidspost. |
| `GET /api/v1/mobile/time-summary` | Sammanställning av timmar. |
| `POST /api/v1/mobile/gps` | Rapportera GPS-position. |
| `POST /api/v1/mobile/position` | Alias för GPS-rapportering. |

**Sync (offline-first)**

| Endpoint | Beskrivning |
|----------|-------------|
| `POST /api/v1/mobile/sync` | Batchsynk av lokala ändringar (status, foton, anteckningar). |
| `GET /api/v1/mobile/sync/status` | Senaste synkstatus. |

Sync-batchformat dokumenteras i
[`TRAIVO_API_CONTRACTS.md`](TRAIVO_API_CONTRACTS.md#sync-batchformat).

**Övrigt**

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/mobile/route` | Dagens rutt. |
| `GET /api/v1/mobile/route-optimized` | Optimerad rutt. |
| `POST /api/v1/mobile/disruptions/trigger/delay` | Rapportera försening. |
| `POST /api/v1/mobile/disruptions/trigger/early-completion` | Tidigare klart. |
| `POST /api/v1/mobile/customer-change-requests` | Skapa kunds ändringsförfrågan från fält. |
| `POST /api/v1/mobile/push-token` | Registrera FCM/APNS-token. |
| `DELETE /api/v1/mobile/push-token` | Avregistrera. |
| `POST /api/v1/mobile/ai/chat` | AI-assistent (kvoterad). |
| `POST /api/v1/mobile/ai/transcribe` | Tal-till-text. |
| `POST /api/v1/mobile/ai/analyze-image` | Bildanalys. |

### 8.11 Kundportalen

Alla `/api/v1/portal/*`-endpoints kräver portal-session (3.3).

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/portal/tenants` | Lista tenants kunden tillhör (för host-routing). |
| `POST /api/v1/portal/auth/request-link` | Begär magic-link. |
| `POST /api/v1/portal/auth/verify` | Verifiera token, få sessions-token. |
| `POST /api/v1/portal/logout` | Logga ut. |
| `GET /api/v1/portal/me` | Inloggad kund + tenant. |
| `GET /api/v1/portal/orders` | Mina ordrar. |
| `GET /api/v1/portal/objects` | Mina objekt. |
| `GET /api/v1/portal/clusters` | Mina kluster. |
| `GET /api/v1/portal/invoices` | Fakturor. |
| `GET /api/v1/portal/messages` | Meddelandetråd med tjänsteleverantör. |
| `POST /api/v1/portal/messages` | Skicka meddelande. |
| `GET /api/v1/portal/messages/unread-count` | Olästa. |
| `GET /api/v1/portal/booking-options` | Bokningsbara tider. |
| `GET /api/v1/portal/booking-slots` | Tillgängliga slottar. |
| `POST /api/v1/portal/booking-requests` | Begär bokning. |
| `GET /api/v1/portal/self-bookings` | Mina självbokningar. |
| `POST /api/v1/portal/self-bookings` | Boka själv. |
| `DELETE /api/v1/portal/self-bookings/:id` | Avboka. |
| `PATCH /api/v1/portal/self-bookings/:id/cancel` | Mjukavboka. |
| `GET /api/v1/portal/issue-reports` | Mina felanmälningar. |
| `POST /api/v1/portal/issue-reports` | Skapa felanmälan. |
| `GET /api/v1/portal/visit-protocols` | Besöksprotokoll. |
| `GET /api/v1/portal/completed-jobs` | Avslutade jobb. |
| `GET /api/v1/portal/work-order-chat/:workOrderId` | Chat per order. |
| `POST /api/v1/portal/work-order-chat/:workOrderId` | Skriv i chatten. |
| `POST /api/v1/portal/visit-confirmations` | Bekräfta besök. |
| `POST /api/v1/portal/technician-ratings` | Betygsätt tekniker. |
| `GET /api/v1/portal/notification-settings` | Notispreferenser. |
| `PUT /api/v1/portal/notification-settings` | Uppdatera. |
| `GET /api/v1/portal/notifications/summary` | Sammanställning. |
| `GET /api/v1/portal/service-contracts` | Aktiva avtal. |
| `GET /api/v1/portal/roi-shared` | Delad ROI-rapport (om aktiverat). |

### 8.12 Importer

CSV/XLSX-importer används för att massmigrera kunder, objekt och
ordrar. De flesta tar en `multipart/form-data` med fält `file`.

| Endpoint | Beskrivning |
|----------|-------------|
| `POST /api/v1/import/customers/validate` | Validera CSV/XLSX innan import. |
| `POST /api/v1/import/customers/bulk` | Importera kunder. |
| `POST /api/v1/import/objects` | Importera objekt. |
| `POST /api/v1/import/objects/detect-duplicates` | Hitta dubbletter. |
| `POST /api/v1/import/resources` | Importera resurser. |
| `POST /api/v1/import/metadata/csv` | Importera objekts-metadata. |
| `POST /api/v1/import/suggest-mapping` | AI-förslag för kolumnmappning. |
| `POST /api/v1/import/column-mappings` | Spara mappningsmall. |
| `POST /api/v1/import/hierarchy-preview` | Förhandsgranska hierarki innan import. |
| `GET /api/v1/import/progress/:jobId` | SSE-stream för importprogress. |
| `GET /api/v1/import/history` | Importhistorik. |
| `GET /api/v1/import/health-stats` | Datakvalitets-KPI. |
| `GET /api/v1/import/data-quality` | Detaljerad datakvalitetsrapport. |
| `POST /api/v1/import/rollback/:batchId` | Rulla tillbaka import (admin). |

Modus-specifika importer (`/api/v1/import/modus/*`) finns för migrering
från Modus-systemet — se källan för exakta format.

### 8.13 Fortnox-integration

OAuth2-koppling per tenant. Importerar och exporterar kunder, artiklar,
fakturor, kostnadsställen och projekt.

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/fortnox/authorize` | Påbörja OAuth-flöde. |
| `GET /api/v1/fortnox/callback` | OAuth-callback. |
| `GET /api/v1/fortnox/status` | Anslutningsstatus. |
| `GET /api/v1/fortnox/config` | Inställningar (kontoplan, momssatser). |
| `POST /api/v1/fortnox/config` | Skapa konfiguration. |
| `PATCH /api/v1/fortnox/config` | Uppdatera. |
| `GET /api/v1/fortnox/mappings` | Mappningar (artiklar, kunder). |
| `POST /api/v1/fortnox/mappings` | Skapa mappning. |
| `GET /api/v1/fortnox/customers/fetch` | Hämta kundlista från Fortnox. |
| `POST /api/v1/fortnox/customers/import` | Importera valda kunder. |
| `GET /api/v1/fortnox/articles/fetch` | Hämta artiklar. |
| `POST /api/v1/fortnox/articles/import` | Importera artiklar. |
| `GET /api/v1/fortnox/costcenters/fetch` | Kostnadsställen. |
| `POST /api/v1/fortnox/costcenters/import` | Importera kostnadsställen. |
| `GET /api/v1/fortnox/projects/fetch` | Projekt. |
| `POST /api/v1/fortnox/projects/import` | Importera projekt. |
| `POST /api/v1/fortnox/full-import` | Kör full import (kunder + artiklar + …). |
| `GET /api/v1/fortnox/exports` | Exportkö (utgående fakturor). |
| `POST /api/v1/fortnox/exports` | Skapa export. |
| `POST /api/v1/fortnox/exports/:id/process` | Skicka till Fortnox. |
| `POST /api/v1/fortnox/exports/:id/credit` | Skapa kreditfaktura. |
| `POST /api/v1/invoice-preview/export-to-fortnox` | Förhandsgranska och exportera. |
| `GET /api/v1/manual-invoice-lines` | Manuella fakturarader. |
| `POST /api/v1/manual-invoice-lines` | Skapa manuell rad. |

### 8.14 Rapporter, KPI:er och AI

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/dashboard/stats` | Översikts-KPI:er. |
| `GET /api/v1/dashboard/alerts` | Aktiva varningar. |
| `GET /api/v1/dashboard/capacity/:dateParam?` | Kapacitet för dag/vecka. |
| `GET /api/v1/reports/roi/:customerId` | ROI-rapport per kund. |
| `GET /api/v1/reports/roi-customers` | Kunder med ROI-data. |
| `POST /api/v1/reports/roi/:customerId/share` | Dela ROI med kunden. |
| `GET /api/v1/sla-risk/summary` | SLA-risköversikt. |
| `GET /api/v1/sla-risk/jobs` | Jobb i riskzon. |
| `GET /api/v1/sla-risk/clusters` | Kluster i riskzon. |
| `GET /api/v1/sla-risk/settings` | Trösklar. |
| `PUT /api/v1/sla-risk/settings` | Uppdatera trösklar. |
| `POST /api/v1/sla-risk/recompute` | Räkna om risker. |
| `GET /api/v1/feedback-loop/service-accuracy` | Hur väl planerad tid stämmer. |
| `GET /api/v1/feedback-loop/article-accuracy` | Per artikel. |
| `GET /api/v1/feedback-loop/resource-accuracy` | Per resurs. |
| `GET /api/v1/feedback-loop/suggested-durations` | Föreslagna tidsjusteringar. |
| `POST /api/v1/feedback-loop/apply-duration/:articleId` | Applicera förslag. |
| `POST /api/v1/predictive/analyze` | Prediktiv analys (AI, kvoterad). |
| `GET /api/v1/predictive/forecasts` | Befintliga prognoser. |
| `POST /api/v1/predictive/create-order` | Skapa order från prognos. |
| `GET /api/v1/ai/insights` | AI-genererade insikter. |
| `POST /api/v1/ai/assisted-plan` | Planeringsassistent. |
| `GET /api/v1/ai/eta-overview` | ETA-översikt. |
| `POST /api/v1/ai/eta-check-delays` | Detektera försening. |
| `GET /api/v1/ai/communications` | Kommunikationsförslag. |
| `POST /api/v1/ai/communications/eta-update` | AI-genererat ETA-utskick. |
| `POST /api/v1/ai/communications/send-manual` | Skicka manuellt. |

### 8.15 Akut-jobb

| Endpoint | Beskrivning |
|----------|-------------|
| `POST /api/v1/urgent-jobs/assign` | Skapa och bjuda ut akut-jobb. |
| `GET /api/v1/urgent-jobs` | Lista. |
| `GET /api/v1/urgent-jobs/:id` | Hämta. |
| `POST /api/v1/urgent-jobs/:id/reassign` | Bjud ut igen. |
| `POST /api/v1/urgent-jobs/find-nearest` | Hitta närmaste resurs. |
| `POST /api/v1/mobile/jobs/urgent/accept` | Acceptera (mobil). |
| `POST /api/v1/mobile/jobs/urgent/decline` | Tacka nej (mobil). |
| `POST /api/v1/mobile/jobs/urgent/:id/status` | Status-uppdatering. |
| `GET /api/v1/mobile/jobs/urgent/active` | Aktiva akut-jobb. |

Se [`TRAIVO_GO_AKUT_JOBB_INTEGRATION.md`](TRAIVO_GO_AKUT_JOBB_INTEGRATION.md)
för flödesdiagram.

### 8.16 Administration och system

| Endpoint | Beskrivning |
|----------|-------------|
| `GET /api/v1/admin/users` | Lista tenant-användare. |
| `POST /api/v1/admin/users` | Bjud in användare. |
| `PATCH /api/v1/admin/users/:id` | Uppdatera roll. |
| `PATCH /api/v1/admin/users/bulk` | Bulkuppdatering. |
| `DELETE /api/v1/admin/users/:id` | Ta bort. |
| `GET /api/v1/system/api-costs/pricing` | AI/extern API-prisinfo. |
| `GET /api/v1/system/budget-status` | Budgetstatus för aktuell tenant. |
| `GET /api/v1/system/budget-status/all-tenants` | (system-admin) Alla tenants. |
| `POST /api/v1/admin/notifications/cleanup` | Rensa gamla notiser. |
| `GET /api/v1/version` | API-version. |

---

## 9. End-to-end-exempel

Tre verkliga flöden, alla testbara med `curl`. Ersätt `<HOST>`,
`<TENANT-DOMAIN>` och token-värden.

### 9.1 Skapa kund, objekt och första order

```bash
# 1) Logga in (planerare via webbsession — eller använd ett annat
#    autentiseringsspår i en server-till-server-integration).
COOKIE="connect.sid=<din-sessions-cookie>"

# 2) Skapa kund
CUSTOMER=$(curl -s -X POST "https://<HOST>/api/v1/customers" \
  -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BRF Ekorren",
    "orgNumber": "769600-1234",
    "email": "kontakt@brfekorren.se",
    "address": "Storgatan 1",
    "city": "Stockholm",
    "postalCode": "11122"
  }')
CUSTOMER_ID=$(echo "$CUSTOMER" | jq -r .id)

# 3) Skapa fastighetsobjekt
OBJECT=$(curl -s -X POST "https://<HOST>/api/v1/objects" \
  -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"name\": \"Storgatan 1\",
    \"objectType\": \"fastighet\",
    \"hierarchyLevel\": \"fastighet\",
    \"address\": \"Storgatan 1\",
    \"city\": \"Stockholm\",
    \"postalCode\": \"11122\"
  }")
OBJECT_ID=$(echo "$OBJECT" | jq -r .id)

# 4) Skapa arbetsorder
curl -s -X POST "https://<HOST>/api/v1/work-orders" \
  -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d "{
    \"customerId\": \"$CUSTOMER_ID\",
    \"objectId\":   \"$OBJECT_ID\",
    \"title\":      \"Första besök\",
    \"orderType\":  \"service\",
    \"priority\":   \"normal\",
    \"scheduledDate\": \"2026-05-12T08:00:00.000Z\",
    \"estimatedDuration\": 60
  }"
```

### 9.2 Mobilapp-flöde — logga in, hämta jobb, rapportera klart

```bash
# 1) Logga in som tekniker
LOGIN=$(curl -s -X POST "https://<HOST>/api/v1/mobile/login" \
  -H "Content-Type: application/json" \
  -d '{ "email": "anna@acme.se", "pin": "1234" }')
TOKEN=$(echo "$LOGIN" | jq -r .token)

# 2) Hämta dagens jobb
curl -s "https://<HOST>/api/v1/mobile/my-orders?date=2026-05-12" \
  -H "Authorization: Bearer $TOKEN"

# 3) Markera "på väg" (triggar ETA-SMS till kund)
curl -s -X PATCH "https://<HOST>/api/v1/mobile/orders/<ORDER-ID>/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "en_route" }'

# 4) Markera påbörjad på plats
curl -s -X PATCH "https://<HOST>/api/v1/mobile/orders/<ORDER-ID>/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "paborjad" }'

# 5) Rapportera klart
curl -s -X PATCH "https://<HOST>/api/v1/mobile/orders/<ORDER-ID>/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "actualDuration": 25,
    "notes": "Inga avvikelser"
  }'
```

### 9.3 Kundportal — magic-link och hämta ordrar

```bash
# 1) Begär magic-link (e-post med token skickas)
curl -s -X POST "https://<HOST>/api/v1/portal/auth/request-link" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "eva@brfekorren.se",
    "tenantId": "<TENANT-ID>"
  }'

# 2) Verifiera token (från länken i e-posten)
SESSION=$(curl -s -X POST "https://<HOST>/api/v1/portal/auth/verify" \
  -H "Content-Type: application/json" \
  -d '{ "token": "<token-från-mejlet>" }')
SESSION_TOKEN=$(echo "$SESSION" | jq -r .sessionToken)

# 3) Hämta mina ordrar
curl -s "https://<HOST>/api/v1/portal/orders" \
  -H "Authorization: Bearer $SESSION_TOKEN"

# 4) Skicka meddelande till tjänsteleverantören
curl -s -X POST "https://<HOST>/api/v1/portal/messages" \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "message": "När kommer nästa besök?" }'
```

---

## 10. Versionshistorik och deprekering

| Version | Status | Sunset | Anmärkning |
|---------|--------|--------|------------|
| `v1` | **Aktuell** | — | Alla endpoints i detta dokument. |
| Oversionerad (`/api/...`) | Deprekerad | **2027-06-01** | Returnerar `Deprecation: true` och `Sunset`-header. Migrera klienter till `/api/v1/`. |

Brytande ändringar inom samma version undviks. När en endpoint ändras
inkompatibelt skapas `v2` parallellt och `v1` får en `Sunset`-header
minst 12 månader fram i tiden.

---

## 11. Support och kontakt

- **Backendkällkod (per domän):** se tabellen i
  [`README.md`](README.md#vid-frågor).
- **Datamodell och WebSocket-event:**
  [`TRAIVO_API_CONTRACTS.md`](TRAIVO_API_CONTRACTS.md).
- **Mobilappens flöden:**
  [`TRAIVO_GO_INTEGRATION_GUIDE.md`](TRAIVO_GO_INTEGRATION_GUIDE.md).
- **Sprint-historik (kronologiskt):** se länkar i README.
- **Frågor om integrationer:** kontakta din kontaktperson hos Traivo.
