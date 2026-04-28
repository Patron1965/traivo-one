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

E-postmeddelandet innehåller `https://<host>/portal/verify?token=<token>`
där token är giltig i 15 minuter och kan endast användas en gång.

**Steg 2 — verifiera:**

```http
POST /api/v1/portal/auth/verify
Content-Type: application/json

{ "token": "<token-från-länken>" }
```

**Svar (200):**

```json
{
    "success": true,
    "sessionToken": "ZGVmYXVsdC1zZXNzaW9uLXRva2Vu...",
    "customer": {
      "id":    "cust_abc",
      "name":  "BRF Ekorren",
      "email": "kontakt@brfekorren.se"
    },
    "tenant": {
      "id":   "tenant_xyz",
      "name": "Acme Service AB"
    }
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

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/tenant` | Aktuell tenants grunddata. | Web-session |
| `PATCH /api/v1/tenant` | Uppdatera namn, kontakt, organisationsnummer. | Web-session |
| `GET /api/v1/tenant/settings` | Konfiguration (industry, SMS, modul-flaggor). | Web-session |
| `PATCH /api/v1/tenant/settings` | Uppdatera inställningar. | Web-session |
| `GET /api/v1/me/tenant` | Inloggad användares tenant och roll. | Web-session |
| `GET /api/v1/tenant/features` | Aktiverade modul-flaggor (feature flags). | Web-session |
| `PATCH /api/v1/tenant/features` | Slå på/av modulflaggor (admin). | Web-session (admin) |
| `GET /api/v1/tenant/features/audit` | Logg över ändringar i flaggor. | Web-session (admin) |

### 8.2 Kunder

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/customers` | Lista kunder. Stöder `?search=` och `?limit=`. | Web-session |
| `GET /api/v1/customers/:id` | Hämta kund. | Web-session |
| `POST /api/v1/customers` | Skapa kund. | Web-session |
| `PATCH /api/v1/customers/:id` | Uppdatera kund. | Web-session |
| `DELETE /api/v1/customers/:id` | Mjuk-radera kund (sätter `deletedAt`). | Web-session |
| `GET /api/v1/customers/:id/objects` | Lista alla objekt för kund. | Web-session |

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

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/objects` | Lista objekt. `?customerId=`, `?clusterId=`, `?level=`. | Web-session |
| `GET /api/v1/objects/:id` | Hämta objekt med beräknade (resolved) ärvda värden. | Web-session |
| `POST /api/v1/objects` | Skapa objekt. | Web-session |
| `PATCH /api/v1/objects/:id` | Uppdatera. | Web-session |
| `DELETE /api/v1/objects/:id` | Mjuk-radera. | Web-session |
| `GET /api/v1/objects?parentId=...` | Barn i hierarkin (filtrera på parent). | Web-session |
| `GET /api/v1/objects/:objectId/images` | Bilder kopplade till objekt. | Web-session |
| `POST /api/v1/objects/:objectId/images` | Ladda upp bild (tvåstegs — se 8.10). | Web-session |
| `GET /api/v1/objects/:objectId/contacts` | Kontaktpersoner för objekt. | Web-session |
| `POST /api/v1/objects/:objectId/contacts` | Skapa kontakt. | Web-session |
| `GET /api/v1/objects/:id/matching-articles` | Artiklar som hookar på objektet (legacy). | Web-session |
| `GET /api/v1/objects/:objectId/applicable-articles` | Tillämpbara artiklar (rekommenderas). | Web-session |
| `GET /api/v1/objects/:objectId/time-restrictions` | Tidsbegränsningar (när arbete får ske). | Web-session |

**Hierarkinivåer:** `koncern`, `brf`, `fastighet`, `rum`, `karl`.

### 8.4 Resurser, team och tilldelning

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/resources` | Lista resurser (tekniker, fordon m.m.). | Web-session |
| `GET /api/v1/resources/:id` | Hämta resurs. | Web-session |
| `POST /api/v1/resources` | Skapa resurs. | Web-session |
| `PATCH /api/v1/resources/:id` | Uppdatera. | Web-session |
| `DELETE /api/v1/resources/:id` | Mjuk-radera. | Web-session |
| `GET /api/v1/resources/active-positions` | Senaste GPS för alla aktiva resurser. | Web-session |
| `GET /api/v1/resources/:id/positions` | Position­historik. | Web-session |
| `GET /api/v1/resources/availability` | Tillgänglighet per dag/vecka. | Web-session |
| `GET /api/v1/resources/:resourceId/work-orders` | Tilldelade ordrar. | Web-session |
| `GET /api/v1/resources/:id/sms-history` | SMS-historik till resursen. | Web-session |
| `GET /api/v1/teams` | Lista team. | Web-session |
| `POST /api/v1/teams` | Skapa team. | Web-session |
| `GET /api/v1/assignments` | Tilldelningar (resurs ↔ order). | Web-session |
| `POST /api/v1/assignments` | Skapa tilldelning. | Web-session |
| `GET /api/v1/assignments/:id/candidates` | Kandidater (resurser som matchar krav). | Web-session |
| `POST /api/v1/assignments/:id/assign` | Bekräfta tilldelning. | Web-session |

### 8.5 Artiklar och prislistor

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/articles` | Lista artiklar (tjänster, varor, kontroller). | Web-session |
| `GET /api/v1/articles/:id` | Hämta artikel. | Web-session |
| `POST /api/v1/articles` | Skapa artikel. | Web-session |
| `PATCH /api/v1/articles/:id` | Uppdatera. | Web-session |
| `DELETE /api/v1/articles/:id` | Mjuk-radera. | Web-session |
| `GET /api/v1/articles/:id/matched-objects` | Objekt som artikeln hookar på. | Web-session |
| `POST /api/v1/articles/:id/test-association` | Testa hook-villkor. | Web-session |
| `GET /api/v1/structural-articles` | Strukturartiklar (paket av sub-uppgifter). | Web-session |
| `POST /api/v1/structural-articles/:parentArticleId/preview-tasks` | Förhandsgranska expansion. | Web-session |
| `GET /api/v1/price-lists` | Lista prislistor (generella, kundunika, rabattbrev). | Web-session |
| `POST /api/v1/price-lists` | Skapa prislista. | Web-session |
| `GET /api/v1/resolve-price?articleId=...&customerId=...&objectId=...` | Beräkna pris från hierarkin. | Web-session |

### 8.6 Arbetsordrar

Arbetsordrar (`workOrders`) är navet i systemet. Det finns fyra
parallella statusfält — använd `orderStatus` för Modus-flödet:

`skapad → planerad_pre → planerad_resurs → planerad_las → utford → fakturerad`

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/work-orders` | Lista. Stöder `?status=`, `?startDate=`, `?endDate=`, `?resourceId=`, `?customerId=`. Datum som `YYYY-MM-DD` eller ISO 8601. | Web-session |
| `GET /api/v1/work-orders/:id` | Hämta order med rader. | Web-session |
| `POST /api/v1/work-orders` | Skapa order. | Web-session |
| `PATCH /api/v1/work-orders/:id` | Uppdatera. | Web-session |
| `DELETE /api/v1/work-orders/:id` | Mjuk-radera. | Web-session |
| `POST /api/v1/work-orders/:id/status` | Byt status (med validering). | Web-session |
| `POST /api/v1/work-orders/:id/promote` | Promovera simulerad order till skarp. | Web-session |
| `POST /api/v1/work-orders/bulk-unschedule` | Avplanera flera. | Web-session (planerare) |
| `POST /api/v1/work-orders/carry-over` | Flytta över oavslutade till nästa dag. | Web-session |
| `POST /api/v1/work-orders/bulk-apply-lines` | Applicera artikelrader på flera ordrar. | Web-session (planerare) |
| `GET /api/v1/work-orders/:workOrderId/lines` | Orderrader (artiklar). | Web-session |
| `POST /api/v1/work-orders/:workOrderId/lines` | Lägg till rad. | Web-session |
| `PATCH /api/v1/work-order-lines/:id` | Uppdatera rad. | Web-session |
| `DELETE /api/v1/work-order-lines/:id` | Ta bort rad. | Web-session |
| `GET /api/v1/work-orders/:workOrderId/objects` | Kopplade objekt (om flera). | Web-session |
| `POST /api/v1/work-orders/:workOrderId/objects` | Lägg till objekt. | Web-session |
| `GET /api/v1/work-orders/:workOrderId/timewindows` | Tidsfönster. | Web-session |
| `POST /api/v1/work-orders/:workOrderId/timewindows` | Lägg till tidsfönster. | Web-session |
| `GET /api/v1/work-orders/:workOrderId/dependencies` | Beroenden (förkrav). | Web-session |
| `POST /api/v1/work-orders/:workOrderId/dependencies` | Lägg till beroende. | Web-session |
| `GET /api/v1/work-orders/:workOrderId/dependents` | Ordrar som beror på denna. | Web-session |
| `GET /api/v1/work-orders/:workOrderId/dependency-chain` | Hela kedjan. | Web-session |
| `POST /api/v1/work-orders/:id/expand-structural` | Expandera strukturartikel till sub-uppgifter. | Web-session |
| `GET /api/v1/work-orders/:id/sub-steps` | Sub-uppgifter från expansion. | Web-session |
| `GET /api/v1/work-orders/:workOrderId/communications` | SMS/e-post-historik för ordern. | Web-session |
| `POST /api/v1/work-orders/:workOrderId/send-sms` | Skicka manuell SMS-uppdatering. | Web-session |
| `POST /api/v1/work-orders/:workOrderId/auto-eta-sms` | Trigga automatisk ETA-SMS. | Web-session |
| `POST /api/v1/work-orders/:workOrderId/generate-pickup-tasks` | Skapa hämtuppdrag baserat på order. | Web-session |

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

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/order-concepts` | Lista koncept. | Web-session |
| `GET /api/v1/order-concepts/:id` | Hämta koncept. | Web-session |
| `POST /api/v1/order-concepts` | Skapa. | Web-session |
| `PATCH /api/v1/order-concepts/:id` | Uppdatera. | Web-session |
| `DELETE /api/v1/order-concepts/:id` | Mjuk-radera. | Web-session |
| `POST /api/v1/order-concepts/:id/preview` | Förhandsgranska kommande ordrar utan att skapa. | Web-session |
| `POST /api/v1/order-concepts/:id/execute` | Generera ordrar för en period. | Web-session |
| `POST /api/v1/order-concepts/:id/run-rolling` | Rullande generering (löpande). | Web-session |
| `POST /api/v1/order-concepts/:id/rerun` | Kör om misslyckad körning. | Web-session |
| `GET /api/v1/order-concepts/:id/subscription-calc` | Beräkna abonnemangsavgift. | Web-session |
| `POST /api/v1/order-concepts/:id/detect-changes` | Detektera ändringar i underlaget. | Web-session |
| `GET /api/v1/order-concepts/:conceptId/filters` | Aktiva objektsfilter. | Web-session |
| `POST /api/v1/order-concepts/:conceptId/filters` | Lägg till filter. | Web-session |
| `GET /api/v1/order-concept-run-logs` | Körhistorik. | Web-session |
| `GET /api/v1/subscription-changes` | Detekterade förändringar (för godkännande). | Web-session |
| `PATCH /api/v1/subscription-changes/:id` | Godkänn eller avvisa. | Web-session |

### 8.8 Schema, planering och rutt

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/schedule` | Schemavy. `?from=`, `?to=`, `?resourceId=`. | Web-session |
| `GET /api/v1/planner/orders` | Ordrar i planeringsläge med extra metadata. | Web-session |
| `GET /api/v1/planner/routes` | Beräknade rutter per resurs och dag. | Web-session |
| `GET /api/v1/planner/events` | SSE-ström med planeringsuppdateringar. | Web-session |
| `GET /api/v1/planner/drivers/locations` | Realtidsposition för alla förare. | Web-session |
| `PATCH /api/v1/planner/orders/:id/reassign` | Flytta order mellan resurser. | Web-session |
| `POST /api/v1/auto-plan-week` | Automatisk planering av vecka (förhandsgranskning). | Web-session |
| `POST /api/v1/auto-plan-week/apply` | Applicera autoplan. | Web-session |
| `POST /api/v1/route/optimize` | Optimera rutt för en lista ordrar. | Web-session |
| `POST /api/v1/route/google-maps-url` | Bygg Google Maps-länk för rutt. | Web-session |
| `POST /api/v1/route/send-to-mobile` | Skicka rutt till tekniker. | Web-session |
| `POST /api/v1/routes/optimize` | Alternativ optimerings-endpoint (legacy). | Web-session |
| `POST /api/v1/routes/directions` | Hämta vägbeskrivning. | Web-session |
| `POST /api/v1/route-geometry` | Hämta polyline för karta. | Web-session |
| `POST /api/v1/planning/what-if` | Simulera planeringsscenario. | Web-session |
| `GET /api/v1/planning/constraints` | Aktiva planeringsregler. | Web-session |
| `GET /api/v1/planning/heatmap` | Beläggnings-heatmap. | Web-session |

### 8.9 Notiser, SMS och kommunikation

| Metod & path | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/notifications` | Lista notiser för inloggad användare. | Web-session |
| `PATCH /api/v1/notifications/:id/read` | Markera som läst. | Web-session |
| `PATCH /api/v1/notifications/read-all` | Markera alla som lästa. | Web-session |
| `GET /api/v1/notifications/types` | Tillgängliga notistyper. | Web-session |
| `POST /api/v1/notifications/send` | Skicka manuell notis. | Web-session |
| `POST /api/v1/notifications/technician-on-way/:workOrderId` | "Tekniker på väg"-SMS. | Web-session |
| `POST /api/v1/notifications/job-completed/:workOrderId` | "Klart"-SMS. | Web-session |
| `POST /api/v1/notifications/send-schedule/:resourceId` | Skicka veckoschema till tekniker. | Web-session |
| `GET /api/v1/status-message-templates` | Mallar för statusmeddelanden. | Web-session |
| `POST /api/v1/status-message-templates` | Skapa mall. | Web-session |
| `GET /api/v1/telephony/lookup?phone=...` | Slå upp inkommande nummer mot kund/objekt. | Web-session |
| `GET /api/v1/telephony/lookup-with-status` | Som ovan, med aktuell orderstatus. | Web-session |

### 8.10 Mobil-API (Traivo Go)

Alla `/api/v1/mobile/*`-endpoints kräver mobil-bearer (3.2). Se
[`TRAIVO_GO_INTEGRATION_GUIDE.md`](TRAIVO_GO_INTEGRATION_GUIDE.md) för
djupare exempel.

**Auth och profil**

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `POST /api/v1/mobile/login` | Logga in med e-post + PIN (se 3.2 för fallback-varianter). | Publik |
| `POST /api/v1/mobile/logout` | Logga ut. | Mobil-bearer |
| `GET /api/v1/mobile/me` | Profil för inloggad tekniker. | Mobil-bearer |
| `GET /api/v1/mobile/preferences` | Klientpreferenser. | Mobil-bearer |
| `PUT /api/v1/mobile/preferences` | Skriv preferenser. | Mobil-bearer |
| `PATCH /api/v1/mobile/me/notification-prefs` | Notispreferenser. | Mobil-bearer |

**Mina ordrar**

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/mobile/my-orders` | Dagens/veckans tilldelade ordrar. | Mobil-bearer |
| `GET /api/v1/mobile/orders` | Alternativ lista (filter via query). | Mobil-bearer |
| `GET /api/v1/mobile/orders/:id` | Orderdetaljer. | Mobil-bearer |
| `PATCH /api/v1/mobile/orders/:id/status` | Byt status — se enum nedan. | Mobil-bearer |
| `POST /api/v1/mobile/orders/:id/notes` | Skapa anteckning. | Mobil-bearer |
| `POST /api/v1/mobile/orders/:id/deviations` | Rapportera avvikelse. | Mobil-bearer |
| `POST /api/v1/mobile/orders/:id/materials` | Registrera förbrukade material. | Mobil-bearer |
| `POST /api/v1/mobile/orders/:id/signature` | Lagra kundsignatur (base64). | Mobil-bearer |
| `POST /api/v1/mobile/orders/:id/customer-signoff` | Slutgodkännande. | Mobil-bearer |
| `POST /api/v1/mobile/orders/:id/inspections` | Spara checklist-svar. | Mobil-bearer |
| `PATCH /api/v1/mobile/orders/:id/substeps/:stepId` | Bocka av sub-uppgift. | Mobil-bearer |

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

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `POST /api/v1/mobile/work-sessions/start` | Starta arbetspass. | Mobil-bearer |
| `POST /api/v1/mobile/work-sessions/:id/pause` | Pausa. | Mobil-bearer |
| `POST /api/v1/mobile/work-sessions/:id/resume` | Återuppta. | Mobil-bearer |
| `POST /api/v1/mobile/work-sessions/:id/stop` | Avsluta. | Mobil-bearer |
| `GET /api/v1/mobile/work-sessions/active` | Aktivt pass. | Mobil-bearer |
| `POST /api/v1/mobile/work-sessions/:id/entries` | Logga tidspost. | Mobil-bearer |
| `GET /api/v1/mobile/time-summary` | Sammanställning av timmar. | Mobil-bearer |
| `POST /api/v1/mobile/gps` | Rapportera GPS-position. | Mobil-bearer |
| `POST /api/v1/mobile/position` | Alias för GPS-rapportering. | Mobil-bearer |

**Sync (offline-first)**

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `POST /api/v1/mobile/sync` | Batchsynk av lokala ändringar (status, foton, anteckningar). | Mobil-bearer |
| `GET /api/v1/mobile/sync/status` | Senaste synkstatus. | Mobil-bearer |

Sync-batchformat dokumenteras i
[`TRAIVO_API_CONTRACTS.md`](TRAIVO_API_CONTRACTS.md#sync-batchformat).

**Övrigt**

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/mobile/route` | Dagens rutt. | Mobil-bearer |
| `GET /api/v1/mobile/route-optimized` | Optimerad rutt. | Mobil-bearer |
| `POST /api/v1/mobile/disruptions/trigger/delay` | Rapportera försening. | Mobil-bearer |
| `POST /api/v1/mobile/disruptions/trigger/early-completion` | Tidigare klart. | Mobil-bearer |
| `POST /api/v1/mobile/customer-change-requests` | Skapa kunds ändringsförfrågan från fält. | Mobil-bearer |
| `POST /api/v1/mobile/push-token` | Registrera FCM/APNS-token. | Mobil-bearer |
| `DELETE /api/v1/mobile/push-token` | Avregistrera. | Mobil-bearer |
| `POST /api/v1/mobile/ai/chat` | AI-assistent (kvoterad). | Mobil-bearer |
| `POST /api/v1/mobile/ai/transcribe` | Tal-till-text. | Mobil-bearer |
| `POST /api/v1/mobile/ai/analyze-image` | Bildanalys. | Mobil-bearer |

### 8.11 Kundportalen

De flesta `/api/v1/portal/*`-endpoints kräver portal-session (3.3).
Undantag: `tenants`, `auth/request-link` och `auth/verify` är publika
eftersom de behövs *innan* sessionen finns.

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/portal/tenants` | Lista tenants kunden tillhör (för host-routing). | Publik |
| `POST /api/v1/portal/auth/request-link` | Begär magic-link. | Publik |
| `POST /api/v1/portal/auth/verify` | Verifiera token, få sessions-token. | Publik (engångstoken i body) |
| `POST /api/v1/portal/logout` | Logga ut. | Portal-bearer |
| `GET /api/v1/portal/me` | Inloggad kund + tenant. | Portal-bearer |
| `GET /api/v1/portal/orders` | Mina ordrar. | Portal-bearer |
| `GET /api/v1/portal/objects` | Mina objekt. | Portal-bearer |
| `GET /api/v1/portal/clusters` | Mina kluster. | Portal-bearer |
| `GET /api/v1/portal/invoices` | Fakturor. | Portal-bearer |
| `GET /api/v1/portal/messages` | Meddelandetråd med tjänsteleverantör. | Portal-bearer |
| `POST /api/v1/portal/messages` | Skicka meddelande. | Portal-bearer |
| `GET /api/v1/portal/messages/unread-count` | Olästa. | Portal-bearer |
| `GET /api/v1/portal/booking-options` | Bokningsbara tider. | Portal-bearer |
| `GET /api/v1/portal/booking-slots` | Tillgängliga slottar. | Portal-bearer |
| `POST /api/v1/portal/booking-requests` | Begär bokning. | Portal-bearer |
| `GET /api/v1/portal/self-bookings` | Mina självbokningar. | Portal-bearer |
| `POST /api/v1/portal/self-bookings` | Boka själv. | Portal-bearer |
| `DELETE /api/v1/portal/self-bookings/:id` | Avboka. | Portal-bearer |
| `PATCH /api/v1/portal/self-bookings/:id/cancel` | Mjukavboka. | Portal-bearer |
| `GET /api/v1/portal/issue-reports` | Mina felanmälningar. | Portal-bearer |
| `POST /api/v1/portal/issue-reports` | Skapa felanmälan. | Portal-bearer |
| `GET /api/v1/portal/visit-protocols` | Besöksprotokoll. | Portal-bearer |
| `GET /api/v1/portal/completed-jobs` | Avslutade jobb. | Portal-bearer |
| `GET /api/v1/portal/work-order-chat/:workOrderId` | Chat per order. | Portal-bearer |
| `POST /api/v1/portal/work-order-chat/:workOrderId` | Skriv i chatten. | Portal-bearer |
| `POST /api/v1/portal/visit-confirmations` | Bekräfta besök. | Portal-bearer |
| `POST /api/v1/portal/technician-ratings` | Betygsätt tekniker. | Portal-bearer |
| `GET /api/v1/portal/notification-settings` | Notispreferenser. | Portal-bearer |
| `PUT /api/v1/portal/notification-settings` | Uppdatera. | Portal-bearer |
| `GET /api/v1/portal/notifications/summary` | Sammanställning. | Portal-bearer |
| `GET /api/v1/portal/service-contracts` | Aktiva avtal. | Portal-bearer |
| `GET /api/v1/portal/roi-shared` | Delad ROI-rapport (om aktiverat). | Portal-bearer |

### 8.12 Importer

CSV/XLSX-importer används för att massmigrera kunder, objekt och
ordrar. De flesta tar en `multipart/form-data` med fält `file`.

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `POST /api/v1/import/customers/validate` | Validera CSV/XLSX innan import. | Web-session |
| `POST /api/v1/import/customers/bulk` | Importera kunder. | Web-session |
| `POST /api/v1/import/objects` | Importera objekt. | Web-session |
| `POST /api/v1/import/objects/detect-duplicates` | Hitta dubbletter. | Web-session |
| `POST /api/v1/import/resources` | Importera resurser. | Web-session |
| `POST /api/v1/import/metadata/csv` | Importera objekts-metadata. | Web-session |
| `POST /api/v1/import/suggest-mapping` | AI-förslag för kolumnmappning. | Web-session |
| `POST /api/v1/import/column-mappings` | Spara mappningsmall. | Web-session |
| `POST /api/v1/import/hierarchy-preview` | Förhandsgranska hierarki innan import. | Web-session |
| `GET /api/v1/import/progress/:jobId` | SSE-stream för importprogress. | Web-session |
| `GET /api/v1/import/history` | Importhistorik. | Web-session |
| `GET /api/v1/import/health-stats` | Datakvalitets-KPI. | Web-session |
| `GET /api/v1/import/data-quality` | Detaljerad datakvalitetsrapport. | Web-session |
| `POST /api/v1/import/rollback/:batchId` | Rulla tillbaka import (admin). | Web-session (admin) |

Modus-specifika importer (`/api/v1/import/modus/*`) finns för migrering
från Modus-systemet — se källan för exakta format.

### 8.13 Fortnox-integration

OAuth2-koppling per tenant. Importerar och exporterar kunder, artiklar,
fakturor, kostnadsställen och projekt.

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/fortnox/authorize` | Påbörja OAuth-flöde. | Web-session |
| `GET /api/v1/fortnox/callback` | OAuth-callback. | Publik (Fortnox redirect) |
| `GET /api/v1/fortnox/status` | Anslutningsstatus. | Web-session |
| `GET /api/v1/fortnox/config` | Inställningar (kontoplan, momssatser). | Web-session |
| `POST /api/v1/fortnox/config` | Skapa konfiguration. | Web-session |
| `PATCH /api/v1/fortnox/config` | Uppdatera. | Web-session |
| `GET /api/v1/fortnox/mappings` | Mappningar (artiklar, kunder). | Web-session |
| `POST /api/v1/fortnox/mappings` | Skapa mappning. | Web-session |
| `GET /api/v1/fortnox/customers/fetch` | Hämta kundlista från Fortnox. | Web-session |
| `POST /api/v1/fortnox/customers/import` | Importera valda kunder. | Web-session |
| `GET /api/v1/fortnox/articles/fetch` | Hämta artiklar. | Web-session |
| `POST /api/v1/fortnox/articles/import` | Importera artiklar. | Web-session |
| `GET /api/v1/fortnox/costcenters/fetch` | Kostnadsställen. | Web-session |
| `POST /api/v1/fortnox/costcenters/import` | Importera kostnadsställen. | Web-session |
| `GET /api/v1/fortnox/projects/fetch` | Projekt. | Web-session |
| `POST /api/v1/fortnox/projects/import` | Importera projekt. | Web-session |
| `POST /api/v1/fortnox/full-import` | Kör full import (kunder + artiklar + …). | Web-session |
| `GET /api/v1/fortnox/exports` | Exportkö (utgående fakturor). | Web-session |
| `POST /api/v1/fortnox/exports` | Skapa export. | Web-session |
| `POST /api/v1/fortnox/exports/:id/process` | Skicka till Fortnox. | Web-session |
| `POST /api/v1/fortnox/exports/:id/credit` | Skapa kreditfaktura. | Web-session |
| `POST /api/v1/invoice-preview/export-to-fortnox` | Förhandsgranska och exportera. | Web-session |
| `GET /api/v1/manual-invoice-lines` | Manuella fakturarader. | Web-session |
| `POST /api/v1/manual-invoice-lines` | Skapa manuell rad. | Web-session |

### 8.14 Rapporter, KPI:er och AI

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/dashboard/stats` | Översikts-KPI:er. | Web-session |
| `GET /api/v1/dashboard/alerts` | Aktiva varningar. | Web-session |
| `GET /api/v1/dashboard/capacity/:dateParam?` | Kapacitet för dag/vecka. | Web-session |
| `GET /api/v1/reports/roi/:customerId` | ROI-rapport per kund. | Web-session |
| `GET /api/v1/reports/roi-customers` | Kunder med ROI-data. | Web-session |
| `POST /api/v1/reports/roi/:customerId/share` | Dela ROI med kunden. | Web-session |
| `GET /api/v1/sla-risk/summary` | SLA-risköversikt. | Web-session |
| `GET /api/v1/sla-risk/jobs` | Jobb i riskzon. | Web-session |
| `GET /api/v1/sla-risk/clusters` | Kluster i riskzon. | Web-session |
| `GET /api/v1/sla-risk/settings` | Trösklar. | Web-session |
| `PUT /api/v1/sla-risk/settings` | Uppdatera trösklar. | Web-session |
| `POST /api/v1/sla-risk/recompute` | Räkna om risker. | Web-session |
| `GET /api/v1/feedback-loop/service-accuracy` | Hur väl planerad tid stämmer. | Web-session |
| `GET /api/v1/feedback-loop/article-accuracy` | Per artikel. | Web-session |
| `GET /api/v1/feedback-loop/resource-accuracy` | Per resurs. | Web-session |
| `GET /api/v1/feedback-loop/suggested-durations` | Föreslagna tidsjusteringar. | Web-session |
| `POST /api/v1/feedback-loop/apply-duration/:articleId` | Applicera förslag. | Web-session |
| `POST /api/v1/predictive/analyze` | Prediktiv analys (AI, kvoterad). | Web-session |
| `GET /api/v1/predictive/forecasts` | Befintliga prognoser. | Web-session |
| `POST /api/v1/predictive/create-order` | Skapa order från prognos. | Web-session |
| `GET /api/v1/ai/insights` | AI-genererade insikter. | Web-session |
| `POST /api/v1/ai/assisted-plan` | Planeringsassistent. | Web-session |
| `GET /api/v1/ai/eta-overview` | ETA-översikt. | Web-session |
| `POST /api/v1/ai/eta-check-delays` | Detektera försening. | Web-session |
| `GET /api/v1/ai/communications` | Kommunikationsförslag. | Web-session |
| `POST /api/v1/ai/communications/eta-update` | AI-genererat ETA-utskick. | Web-session |
| `POST /api/v1/ai/communications/send-manual` | Skicka manuellt. | Web-session |

### 8.15 Akut-jobb

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `POST /api/v1/urgent-jobs/assign` | Skapa och bjuda ut akut-jobb. | Web-session |
| `GET /api/v1/urgent-jobs` | Lista. | Web-session |
| `GET /api/v1/urgent-jobs/:id` | Hämta. | Web-session |
| `POST /api/v1/urgent-jobs/:id/reassign` | Bjud ut igen. | Web-session |
| `POST /api/v1/urgent-jobs/find-nearest` | Hitta närmaste resurs. | Web-session |
| `POST /api/v1/mobile/jobs/urgent/accept` | Acceptera (mobil). | Mobil-bearer |
| `POST /api/v1/mobile/jobs/urgent/decline` | Tacka nej (mobil). | Mobil-bearer |
| `POST /api/v1/mobile/jobs/urgent/:id/status` | Status-uppdatering. | Mobil-bearer |
| `GET /api/v1/mobile/jobs/urgent/active` | Aktiva akut-jobb. | Mobil-bearer |

Se [`TRAIVO_GO_AKUT_JOBB_INTEGRATION.md`](TRAIVO_GO_AKUT_JOBB_INTEGRATION.md)
för flödesdiagram.

### 8.16 Administration och system

| Endpoint | Beskrivning | Behörighet |
|--------------|-------------|------------|
| `GET /api/v1/admin/users` | Lista tenant-användare. | Web-session (admin) |
| `POST /api/v1/admin/users` | Bjud in användare. | Web-session (admin) |
| `PATCH /api/v1/admin/users/:id` | Uppdatera roll. | Web-session (admin) |
| `PATCH /api/v1/admin/users/bulk` | Bulkuppdatering. | Web-session (admin) |
| `DELETE /api/v1/admin/users/:id` | Ta bort. | Web-session (admin) |
| `GET /api/v1/system/api-costs/pricing` | AI/extern API-prisinfo. | Web-session (admin) |
| `GET /api/v1/system/budget-status` | Budgetstatus för aktuell tenant. | Web-session (admin) |
| `GET /api/v1/system/budget-status/all-tenants` | (system-admin) Alla tenants. | Web-session (system-admin) |
| `POST /api/v1/admin/notifications/cleanup` | Rensa gamla notiser. | Web-session (admin) |
| `GET /api/v1/version` | API-version. | Publik |

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
