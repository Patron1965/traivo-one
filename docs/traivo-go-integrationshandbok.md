# Traivo Go ↔ Traivo One — Integrationshandbok (komplett)

> **Syfte:** Detta är den fullständiga, fristående integrationsrapporten som **Traivo Go**-projektet (mobilappen) ska följa för att lira 100 % med **Traivo One** (denna backend).
> **Målgrupp:** Utvecklare i Traivo Go-repot. Kopiera in hela detta dokument i Go-projektet (t.ex. `docs/BACKEND-INTEGRATION.md`).
> **Källa till sanning:** Traivo One:s faktiska mobil-routes (`server/routes/mobile/*`). Alla kontrakt nedan är avlästa direkt ur koden.
> **Språk i API:t:** statusvärden och felmeddelanden är på svenska. UI ska vara svenskt.

Detta dokument konsoliderar och ersätter de tidigare fragmenten:
`traivo-go-integration-rapport.md`, `traivo-go-v2-handover.md` och `traivo-go-api-match-report.md`.

---

## Innehåll

1. [Snabbstart (TL;DR)](#1-snabbstart-tldr)
2. [Grundinställning: bas-URL, versionering, headers](#2-grundinställning-bas-url-versionering-headers)
3. [Autentiseringsmodell (kritiskt)](#3-autentiseringsmodell-kritiskt)
4. [Tenant & säkerhet](#4-tenant--säkerhet)
5. [Komplett endpoint-katalog](#5-komplett-endpoint-katalog)
6. [Datakontrakt i detalj](#6-datakontrakt-i-detalj)
7. [Offline-sync-protokollet](#7-offline-sync-protokollet)
8. [Realtid (WebSocket / Socket.io)](#8-realtid-websocket--socketio)
9. [Affärsregler mobilen MÅSTE respektera](#9-affärsregler-mobilen-måste-respektera)
10. [Kända avvikelser app↔backend (de 8)](#10-kända-avvikelser-appbackend-de-8)
11. [Felhantering & statuskoder](#11-felhantering--statuskoder)
12. [curl-exempel för manuell verifiering](#12-curl-exempel-för-manuell-verifiering)
13. [Checklista för Go-teamet](#13-checklista-för-go-teamet)

---

## 1. Snabbstart (TL;DR)

1. **All trafik från Traivo Go går mot `/api/mobile/*`** och autentiseras med en **Bearer-token** (ej cookies).
2. **Appen skriver om `/api/mobile/X` → `/api/v1/mobile/X`.** Backend strippar `/api/v1` och routar internt. **Rör inte denna omskrivning — den fungerar redan.**
3. **Logga in** med `POST /api/mobile/login` → få `{ token }` → skicka `Authorization: Bearer <token>` på alla efterföljande anrop. Token lever **24 h**.
4. **Hämta dagens jobb** med `GET /api/mobile/my-orders?date=YYYY-MM-DD`.
5. **Uppdatera status** med `PATCH /api/mobile/orders/:id/status`.
6. **Jobba offline:** köa allt lokalt och skicka i batch via `POST /api/mobile/sync`.
7. **Använd v2-orderdetaljen** (`GET /api/mobile/v2/orders/:id`) för fryst pris, BOM-checklista och beroendestatus (`canStart`).
8. Systemen är ~90 % i synk. De **8 avvikelserna** i avsnitt 10 ska åtgärdas för 100 %.

---

## 2. Grundinställning: bas-URL, versionering, headers

### Bas-URL
- **Utveckling:** den URL Traivo One körs på (Replit-dev-URL eller `http://localhost:5000`).
- **Produktion:** den publicerade `.replit.app`-domänen (eller egen domän).
- Lägg bas-URL i en miljövariabel i Go-appen (t.ex. `EXPO_PUBLIC_API_BASE_URL`). Hårdkoda aldrig.

### Versionering (rör ej)
Appen anropar logiskt `/api/mobile/...` men skickar fysiskt `/api/v1/mobile/...`:

```
App-kod:        GET /api/mobile/my-orders
Skickas som:    GET /api/v1/mobile/my-orders   (toV1Path i client/lib/query-client.ts)
Backend tar emot /api/v1/...  → strippar "/api/v1" (API_VERSION="v1") → /api/mobile/my-orders
```

> Detta matchar redan på båda sidor. **Ändra ingenting i versionsprefixet.**

### Obligatoriska headers
| Header | Värde | När |
|---|---|---|
| `Authorization` | `Bearer <token>` | Alla skyddade anrop |
| `Content-Type` | `application/json` | Alla `POST`/`PATCH`/`PUT` med JSON-body |

---

## 3. Autentiseringsmodell (kritiskt)

Det finns **två separata autentiseringsmodeller** i Traivo One. Traivo Go använder **enbart den första**.

| | **Traivo Go (fristående app)** | SimpleFieldApp (mobil webb-UI) |
|---|---|---|
| Auth | **Bearer-token** (`isMobileAuthenticated`) | Cookie/session |
| Endpoints | **Endast `/api/mobile/*`** | `/api/mobile/*` **och** `/api/*` |
| Tenant härleds från | `req.mobileTenantId` / mobilresursen | `req.tenantId` (tenant-middleware) |

> ⚠️ **Traivo Go får ALDRIG anropa vanliga `/api/*`-routes** (utan `/mobile/`). De kräver cookie-auth och svarar **401** för en Bearer-klient. Allt appen behöver finns under `/api/mobile/*`.

### 3.1 Inloggning

`POST /api/mobile/login` — **ingen auth**, **rate-limitad** (10 försök / 15 min per IP).

Accepterar tre varianter av body:
```jsonc
// 1) Enbart PIN
{ "pin": "1234" }

// 2) Användarnamn + lösenord
{ "username": "anna", "password": "hemligt" }

// 3) E-post + PIN
{ "email": "anna@firma.se", "pin": "1234" }
```

**Svar (200):**
```jsonc
{
  "success": true,
  "token": "<opak-token>",          // skicka som Bearer i alla vidare anrop
  "user": { "id": "...", "name": "...", "role": "...", /* ... */ },
  "resource": { "id": "...", "name": "...", /* den fältresurs användaren är */ }
}
```

- **Token-livslängd:** 24 timmar. Förnya genom att logga in igen.
- **Lagring i Go:** spara token säkert (`expo-secure-store` / Keychain), aldrig i klartext-AsyncStorage.
- **401 vid utgången token:** kasta användaren till inloggningsskärmen och rensa lokal token.

> 🔐 **Produktionsnotis:** i prod är auto-tilldelning av tenant avstängd (`resolveFallbackTenantId()` → `null` när `NODE_ENV=production`). Inloggningen kräver att tenant-kontexten kan resolvas. Stäm av med backend-teamet hur tenant pekas ut i prod (t.ex. subdomän/host) innan lansering — annars kan login fail-closa.

### 3.2 Övriga auth-endpoints
| Metod | Path | Syfte |
|---|---|---|
| `POST` | `/api/mobile/logout` | Invalidera aktuell token |
| `GET` | `/api/mobile/me` | Hämta inloggad **resurs** (resurs-objektet, inte `{user,resource}`) |
| `GET` | `/api/mobile/my-profiles` | Profiler användaren kan agera som |
| `POST` / `DELETE` | `/api/mobile/push-token` | Registrera/avregistrera push-token |
| `POST` | `/api/mobile/notifications/token` | Token för WebSocket-anslutning (se avsnitt 8) |

---

## 4. Tenant & säkerhet

- **`/api/mobile/*` går utanför den vanliga tenant-middleware-kedjan.** Backend härleder tenant från den autentiserade mobilresursen — appen ska **aldrig** skicka tenant-id som klient-parameter i förhoppning att byta tenant.
- **Säkerhetshärdning:** flera *webb*-routes (`/api/checklist*`, `/api/quick-action`, delar av `/api/ai/*`) kräver numera planner/admin-roll. En fälttekniker når dem **inte**. Använd alltid `/api/mobile/*`-motsvarigheterna (de listas i avsnitt 5).
- **Ägarskapskontroll:** ordermutationer verifierar `order.resourceId === inloggad resurs`. Försök att röra en order som inte tillhör resursen ger **403 (`Ej behörig`)**.

---

## 5. Komplett endpoint-katalog

Alla paths nedan prefixas med bas-URL och skrivs om till `/api/v1/...` av appen. Alla kräver `Authorization: Bearer <token>` om inget annat anges.

### 5.1 Auth & profil
| Metod | Path | Syfte |
|---|---|---|
| `POST` | `/api/mobile/login` | **Ingen auth.** Logga in, få token |
| `POST` | `/api/mobile/logout` | Logga ut |
| `GET` | `/api/mobile/me` | Inloggad resurs (resurs-objektet) |
| `GET` | `/api/mobile/my-profiles` | Valbara profiler |
| `POST`/`DELETE` | `/api/mobile/push-token` | Push-token |
| `POST` | `/api/mobile/notifications/token` | WS-token (5 min) |

### 5.2 Ordrar / arbetsordrar
| Metod | Path | Syfte |
|---|---|---|
| `GET` | `/api/mobile/my-orders?date=YYYY-MM-DD` | Mina ordrar (filtrera på datum) |
| `GET` | `/api/mobile/orders` | Ordrar (generell) |
| `GET` | `/api/mobile/orders/:id` | **v1** orderdetalj (berikad) |
| `GET` | `/api/mobile/v2/orders/:id` | **v2** orderdetalj (fryst pris, BOM, beroenden) |
| `PATCH` | `/api/mobile/orders/:id/status` | Uppdatera orderstatus |
| `POST` | `/api/mobile/orders/:id/notes` | Lägg till anteckning |
| `POST` | `/api/mobile/orders/:id/photos` | Ladda upp foto |
| `POST` | `/api/mobile/orders/:id/signature` | Spara signatur |
| `POST` | `/api/mobile/orders/:id/checklist` | Bocka av checklista |
| `PATCH` | `/api/mobile/orders/:id/substeps/:stepId` | Uppdatera delsteg |
| `POST` | `/api/mobile/orders/:id/deviations` | Rapportera avvikelse |
| `POST` | `/api/mobile/orders/:id/materials` | Logga materialåtgång |
| `GET` | `/api/mobile/orders/:id/materials` | Hämta materiallogg |
| `POST` | `/api/mobile/orders/:id/inspections` | Spara inspektion |
| `POST` | `/api/mobile/orders/:id/return-to-warehouse` | Markera retur till lager |
| `GET` | `/api/mobile/deviations/mine` | Mina avvikelser |
| `GET` | `/api/mobile/articles` | Artikelsök/lista |
| `PATCH` | `/api/mobile/objects/:id/location` | Uppdatera objektets position |

### 5.3 Arbetspass (work sessions)
| Metod | Path | Syfte |
|---|---|---|
| `GET` | `/api/mobile/work-sessions/active` | Aktivt pass |
| `POST` | `/api/mobile/work-sessions/start` | Starta pass |
| `POST`/`PATCH` | `/api/mobile/work-sessions/:id/stop` | Avsluta pass |
| `POST`/`PATCH` | `/api/mobile/work-sessions/:id/pause` | Pausa |
| `POST`/`PATCH` | `/api/mobile/work-sessions/:id/resume` | Återuppta |
| `POST` | `/api/mobile/work-sessions/:id/entries` | Lägg till tidspost |
| `GET` | `/api/mobile/orders/:id/time-entries` | Tidsposter för en order |
| `GET` | `/api/mobile/time-summary` | Tidssammanställning |

### 5.4 GPS & rutt
| Metod | Path | Syfte |
|---|---|---|
| `POST` | `/api/mobile/position` | Skicka **en** position |
| `POST` | `/api/mobile/gps` | GPS-punkt (alt. kanal) |
| `GET` | `/api/mobile/route` | Min rutt |
| `GET` | `/api/mobile/route-optimized` | **Synkron** ruttoptimering |
| `POST` | `/api/mobile/route-feedback` | Ruttåterkoppling |
| `GET` | `/api/mobile/route-feedback/mine` | Min ruttåterkoppling |
| `POST` | `/api/mobile/travel-times` | Restider |
| `POST` | `/api/mobile/distance` | Avstånd (en) |
| `POST` | `/api/mobile/distance/batch` | Avstånd (batch) |

### 5.5 Offline-sync
| Metod | Path | Syfte |
|---|---|---|
| `POST` | `/api/mobile/sync` | Skicka köade actions i batch |
| `GET` | `/api/mobile/sync/status` | Synkstatus |

### 5.6 Team
| Metod | Path | Syfte |
|---|---|---|
| `GET` | `/api/mobile/my-team` | Mitt team |
| `GET` | `/api/mobile/team-orders` | Teamets ordrar |
| `GET` | `/api/mobile/team-invites` | Inbjudningar |
| `POST` | `/api/mobile/teams` | Skapa team |
| `POST` | `/api/mobile/teams/:id/invite` | Bjud in |
| `POST` | `/api/mobile/teams/:id/accept` | Acceptera inbjudan |
| `POST` | `/api/mobile/teams/:id/leave` | Lämna |
| `DELETE` | `/api/mobile/teams/:id` | Ta bort team |
| `GET` | `/api/mobile/resources/search` | Sök resurser (för inbjudan) |

> ⚠️ Det finns **ingen** `GET /api/mobile/teams` (lista). Använd `GET /api/mobile/my-team`. `POST /api/mobile/teams` **skapar** ett team.

### 5.7 Aviseringar
| Metod | Path | Syfte |
|---|---|---|
| `GET` | `/api/mobile/notifications` | Lista |
| `GET` | `/api/mobile/notifications/count` | Antal olästa → `{ "unreadCount": n }` |
| `POST` | `/api/mobile/notifications/:id/read` | Markera läst |
| `POST` | `/api/mobile/notifications/read-all` | Markera alla lästa |

### 5.8 AI
| Metod | Path | Syfte |
|---|---|---|
| `POST` | `/api/mobile/ai/chat` | AI-chat (icke-streamande) |
| `POST` | `/api/mobile/ai/transcribe` | Tal → text |
| `POST` | `/api/mobile/ai/analyze-image` | Bildanalys |

### 5.9 Störningar & akutjobb
| Metod | Path | Syfte |
|---|---|---|
| `POST` | `/api/mobile/disruptions/trigger/delay` | Försening |
| `POST` | `/api/mobile/disruptions/trigger/early-completion` | Tidigt klar |
| `POST` | `/api/mobile/disruptions/trigger/resource-unavailable` | Resurs otillgänglig |
| `POST` | `/api/mobile/jobs/urgent/accept` | Acceptera akutjobb |
| `POST` | `/api/mobile/jobs/urgent/decline` | Tacka nej |
| `GET` | `/api/mobile/jobs/urgent/active` | Aktiva akutjobb |

### 5.10 Konfiguration & övrigt
| Metod | Path | Syfte |
|---|---|---|
| `GET` | `/api/mobile/app-config` | App-konfiguration |
| `GET` | `/api/mobile/map-config` | Kart-/tile-konfig |
| `GET` | `/api/mobile/terminology` | Terminologi (svenska etiketter) |
| `GET` | `/api/mobile/break-config` | Rast-konfig |
| `GET` / `PUT` / `PATCH` | `/api/mobile/preferences` | Användarpreferenser → `{ "preferences": {…} }` |
| `GET` | `/api/mobile/weather` | Väder |
| `GET` | `/api/mobile/statistics` + `/statistics/summary` | Statistik |
| `GET` | `/api/mobile/eta-notification/config` + `/history` | ETA-aviseringar |
| `GET` | `/api/mobile/tasks/:id/metadata-context` | Metadatakontext för uppgift |
| `POST` | `/api/mobile/tasks/:id/metadata-update` | Skriv metadata |
| `POST` | `/api/mobile/work-orders/:id/auto-eta-sms` | Auto-ETA-SMS |
| `POST` | `/api/mobile/work-orders/carry-over` | Överför ordrar |
| `*` | `/api/mobile/customer-change-requests*` | Kundändringsförfrågningar |

---

## 6. Datakontrakt i detalj

> Nedan kontrakt är avlästa direkt ur backend-koden. Fält i **v1-orderdetaljen** och **v2-orderdetaljen** är fullständiga; för övriga endpoints, verifiera mot live-svar.

### 6.1 v1 orderdetalj — `GET /api/mobile/orders/:id`

Berikad order (`enrichOrderForMobile`). Huvudfält:

```jsonc
{
  "id": "string",
  "orderNumber": "string",
  "status": "string",
  "executionStatus": "string",
  "customerName": "string",
  "address": "string", "city": "string", "postalCode": "string",
  "latitude": 0, "longitude": 0,
  "contactName": "string", "contactPhone": "string",
  "scheduledDate": "ISO-date",
  "scheduledTimeStart": "HH:mm", "scheduledTimeEnd": "HH:mm",
  "scheduledStart": "ISO", "scheduledEnd": "ISO",
  "description": "string",
  "priority": "string",
  "estimatedDuration": 0,
  "wasteType": "string", "containerType": "string", "containerCount": 0,
  "executionCodes": [],
  "dependencies": [],
  "timeRestrictions": {},
  "subSteps": [],
  "articles": [ /* se 6.3 */ ],
  "inspections": [],
  "orderNotes": [],
  "plannedNotes": "string",
  "notes": "string",
  "cachedValue": 0, "cachedCost": 0, "cachedProductionMinutes": 0,
  "objectId": "string", "customerId": "string", "resourceId": "string",
  "objectAccessCode": "string", "objectKeyNumber": "string",
  "enRouteAt": "ISO|null", "actualStartTime": "ISO|null", "completedAt": "ISO|null",
  "customerNotified": false,
  "isTeamOrder": false,
  "signatureUrl": "string|null"
}
```

### 6.2 v2 orderdetalj — `GET /api/mobile/v2/orders/:id`

Använd denna för fältarbete enligt ADR v3 (fryst pris, BOM-avbockning, beroendekontroll).

```jsonc
{
  "apiVersion": "v2",
  "orderId": "string",
  "title": "string",
  "orderStatus": "string",
  "executionStatus": "not_started | on_way | on_site | completed | impossible | ...",
  "scheduledStart": "ISO|null",
  "scheduledEnd": "ISO|null",
  "object":   { "id": "...", "name": "...", "address": "...", "latitude": 0, "longitude": 0 } /* | null */,
  "customer": { "id": "...", "name": "..." } /* | null */,

  // F5 — fryst prislås (audit-immutabelt). isFrozen=false ⇒ inga prisfält.
  "frozen": {
    "isFrozen": true,
    "quantity": 0,
    "unitPrice": 0,        // öre
    "unitCost": 0,         // öre | null
    "unitTime": 0,         // min | null
    "frozenAt": "ISO|null",
    "totalPrice": 0        // öre = unitPrice * quantity
  },

  "articles": [ /* se 6.3 */ ],

  // F4 — BOM-checklista (en post per strukturartikel-rad)
  "bomChecklist": [
    {
      "parentLineId": "string|null",
      "parentArticleId": "string",
      "parentArticleName": "string",
      "parentQuantity": 1,
      "items": [
        {
          "componentId": "string",
          "articleId": "string",
          "articleNumber": "string",
          "articleName": "string",
          "quantityPerParent": 1,
          "totalRequired": 1,       // quantityPerParent * parentQuantity
          "unit": "string|null",
          "notes": "string|null"
        }
      ]
    }
  ],

  // Beroendestatus — vilka ordrar som måste vara klara först
  "dependencyStatus": [
    {
      "orderId": "string",
      "orderTitle": "string",
      "status": "string",
      "type": "must_complete_first | ...",
      "isCompleted": false,
      "isBlocking": true
    }
  ],
  "canStart": false,             // false om någon blockerande dep ej är klar
  "blockedBy": ["orderId", ...]  // orderId:n som blockerar start
}
```

> **Mobilen ska:** dölja/disabla "Starta"-knappen när `canStart === false` och visa `blockedBy`. Visa `frozen.totalPrice` som det gällande priset (inte live-omräknat). Visa `bomChecklist` som avbockningsbar materiallista.

### 6.3 Artikelrad (i både v1 och v2 `articles[]`)

```jsonc
{
  "id": "string",
  "articleId": "string",
  "articleNumber": "string",
  "articleName": "string",
  "quantity": 0,
  "resolvedPrice": 0,            // öre
  "resolvedCost": 0,             // öre
  "files": [],                   // bifogade filer/instruktioner
  "reportingType": "string|null",        // styr vilken rapportering raden kräver
  "reportingMetadataField": "string|null",
  "shouldBeReturned": false,     // logistik: ska returneras till lager
  "productionTimeMinutes": 0,    // effektiv produktionstid — kan vara null
  "productionTimeSource": "resource | list | article | null"
}
```

> **Öre vs kronor:** prisfälten (`resolvedPrice`, `resolvedCost`, `frozen.*`) är i **öre**. Dela med 100 för kronor vid visning.

### 6.4 Statusuppdatering — `PATCH /api/mobile/orders/:id/status`

**Body:**
```jsonc
{
  "status": "se tabell nedan",
  "notes": "string (valfritt)",
  "actualDuration": 0,            // min (valfritt; annars beräknas från onSiteAt)
  "enRouteAt": "ISO (valfritt, för en_route)",
  "impossibleReason": "string (för impossible)",
  // Vid klarmarkering (valfria):
  "completedVehicleId": "string|null",
  "completedEquipmentId": "string|null",
  "vehicleRegNo": "string|null",
  "participantIds": ["resourceId", ...],
  // Om någon artikel kräver obligatorisk informationslämning:
  "leaveMetadataValues": { "<fält>": "<värde>" }
}
```

**Tillåtna `status`-värden (synonymer accepteras):**
| Skicka | Effekt i backend |
|---|---|
| `dispatched` | `executionStatus=dispatched`, sätter `onWayAt`, triggar ETA-avisering |
| `en_route` | `executionStatus=on_way`, sätter `onWayAt`, triggar ETA-avisering |
| `paborjad` / `in_progress` | `executionStatus=on_site`, sätter `onSiteAt` |
| `planned` / `assigned` | `executionStatus=planned_fine` |
| `utford` / `completed` | `orderStatus=utford`, `executionStatus=completed`, `completedAt` sätts |
| `impossible` | `orderStatus=avbruten`, `executionStatus=impossible`, sparar `impossibleReason` (valfritt; faller tillbaka på `notes`) |
| `ej_utford` / `deferred` | `orderStatus=skapad`, lägger `notes` som "Uppskjuten:" |
| `cancelled` | `orderStatus=avbruten`, lägger `notes` som "Inställd:" |

> ℹ️ **Okänt `status`-värde** avvisas inte med fel — det blir en no-op (inget uppdateras). Skicka endast värden ur tabellen ovan.
>
> ⚠️ **Obligatorisk informationslämning vid `utford`:** en artikelrad kan kräva informationslämning när artikeln har `leaveMetadataRequired = true` **och** ett `leaveMetadataCode`. Auto-format (`timestamp`, `boolean_true`, `counter_increment`) fylls i av systemet och blockerar **aldrig**. Om ett obligatoriskt fält varken finns på objektet eller skickas med, returneras **400**: *"Obligatorisk informationslämning saknas: &lt;koder&gt;. …"* där `<koder>` är `leaveMetadataCode`-värden.
>
> Skicka in värdena i `leaveMetadataValues` **nycklat på `leaveMetadataCode`**: `{ "<leaveMetadataCode>": "<värde>" }`. Detta **låser bara upp** klarmarkeringen — status-endpointen **persisterar inte** metadatavärdena. För att faktiskt spara ett metadatavärde, använd `POST /api/mobile/tasks/:id/metadata-update`.
>
> **OBS:** orderns `articles[]` (v1/v2) exponerar **inte** `leaveMetadata*`-fälten, så appen kan inte säkert förutse kravet i förväg från ordersvaret. Hantera 400:an **reaktivt** — felmeddelandet listar exakt vilka koder som saknas.

### 6.5 Preferenser — `GET/PUT/PATCH /api/mobile/preferences`

Svar är **inkapslat**:
```jsonc
{ "preferences": { "darkMode": false, "fontSize": "medium", "pushCategories": { /* ... */ } } }
```
Läs `data.preferences` (inte ett platt objekt). PATCH-fält: `darkMode` (bool), `fontSize` (enum), `pushCategories` (objekt) m.fl.

### 6.6 Olästa aviseringar — `GET /api/mobile/notifications/count`
```jsonc
{ "unreadCount": 0 }
```

---

## 7. Offline-sync-protokollet

Fältappen ska fungera offline. Köa alla åtgärder lokalt och skicka dem i batch när nät finns.

`POST /api/mobile/sync`
```jsonc
{
  "actions": [
    { "clientId": "lokalt-unikt-id", "actionType": "status_update", "payload": { /* ... */ } },
    { "clientId": "...",            "actionType": "gps",           "payload": { /* ... */ } }
  ]
}
```

**Giltiga `actionType`:**
| actionType | payload (typiskt) |
|---|---|
| `status_update` | samma body som `PATCH orders/:id/status` + `orderId` |
| `note` | `{ orderId, text }` |
| `deviation` | `{ orderId, ... }` |
| `material` | `{ orderId, articleId, quantity }` |
| `gps` | `{ lat, lng, timestamp }` (även för batchad GPS) |
| `inspection` | `{ orderId, ... }` |
| `signature` | `{ orderId, imageBase64 }` |
| `photo` | `{ orderId, imageBase64 }` |

**Principer:**
- **`clientId` är idempotensnyckeln.** Generera ett stabilt lokalt id per åtgärd så att en omsänd batch inte dubbelregistrerar.
- Behåll åtgärder i lokal kö tills servern bekräftat dem; ta bort först efter OK-svar per `clientId`.
- Bevara **ordningen** (särskilt status-övergångar) per order.
- `GET /api/mobile/sync/status` ger synkläge.

---

## 8. Realtid (WebSocket / Socket.io)

1. Hämta en WS-token: `POST /api/mobile/notifications/token` (Bearer-auth). Svar: `{ "token": "...", "expiresIn": 300, "resourceId": "..." }` — token lever **5 min**, hämta en ny vid behov.
2. Anslut med Socket.io: `io(API_URL, { auth: { token } })`, eller använd `?token=...` mot den äldre råa WS-endpointen `/ws/notifications`.
3. Lyssna på aviserings-/uppdateringshändelser (nya ordrar, ETA, störningar).
4. WS är ett **komplement** — vid tappad anslutning, falla tillbaka på polling (`GET /api/mobile/notifications` + `/count`).

---

## 9. Affärsregler mobilen MÅSTE respektera

- **Utförd ≠ fakturerad.** Att sätta `utford` slutför fältarbetet; fakturering sker separat i backend. Appen ska aldrig anta att klarmarkering = fakturerad.
- **Fryst pris vinner.** När `frozen.isFrozen === true` är `frozen`-värdena det gällande priset. Räkna aldrig om priser i appen.
- **Föruppgifter blockerar start.** Respektera `canStart` / `blockedBy` från v2-detaljen.
- **Obligatorisk informationslämning.** Hantera 400 vid `utford` (se 6.4) **reaktivt**: läs vilka koder som saknas ur felmeddelandet, samla in dem och skicka i `leaveMetadataValues` (nycklat på `leaveMetadataCode`). Status-endpointen sparar inte värdena — använd `tasks/:id/metadata-update` för det.
- **Metadata skrivs via mobil-endpoints.** Använd `/api/mobile/tasks/:id/metadata-context` (läs) och `/metadata-update` (skriv). Skriv aldrig metadata mot webb-`/api/*`-routes.
- **Antalsredigering finns inte i fält.** Traivo Go har medvetet inget redigerbart antalsfält — antalsflaggor är display-only.

---

## 10. Kända avvikelser app↔backend (de 8)

3 är rena namnbyten i appen; 5 kräver ett beslut (peka om appen **eller** bygg i backend).

### Kategori A — rena namnbyten (fixa i appen)
| # | Appen anropar | Backend har | Åtgärd |
|---|---|---|---|
| 1 | `GET /api/mobile/app/config` | `GET /api/mobile/app-config` | byt `app/config` → `app-config` |
| 2 | `GET/PATCH /api/mobile/user/preferences` | `GET/PUT/PATCH /api/mobile/preferences` | byt sökväg (3 ställen) + läs `data.preferences` |
| 3 | `GET /api/mobile/notifications/unread-count` | `GET /api/mobile/notifications/count` | byt sökväg (2 ställen) + läs `data.unreadCount` |

### Kategori B — saknas i backend (kräver beslut)
| # | Appen anropar | Läge | Rekommendation |
|---|---|---|---|
| 4 | `POST /api/mobile/position/batch` | Endast `position` (enstaka) + `gps` | Skicka batch via `sync` (`actionType:"gps"`) eller loopa `position` |
| 5 | `POST /api/mobile/optimize-route` + `…/:jobId/status` (async) | Backend har **synkron** `GET /api/mobile/route-optimized` | Byt till synkron `route-optimized`, ta bort polling |
| 6 | `POST /api/mobile/ai/voice-command` | Saknas | Använd `ai/transcribe` (+ `ai/chat`) som redan finns |
| 7 | `POST /api/mobile/ai/chat/stream` | Endast `ai/chat` (icke-stream) | Falla tillbaka till `ai/chat` |
| 8 | `GET /api/mobile/route-metrics/today` | Saknas | Peka om till `route-feedback/mine` / `statistics/summary` |

> Alternativet i alla B-fall är att bygga motsvarande route i Traivo One — men enklaste vägen till 100 % match är att peka om appen enligt ovan.

---

## 11. Felhantering & statuskoder

| Kod | Betydelse | Appen ska |
|---|---|---|
| `200` | OK | — |
| `400` | Valideringsfel (svenskt `message`) | Visa `message` för användaren (t.ex. saknad informationslämning) |
| `401` | Ogiltig/utgången token | Logga ut, rensa token, visa login |
| `403` | `Ej behörig` (fel resurs/roll) | Visa "Du saknar behörighet" |
| `404` | `Order hittades inte` m.m. | Visa "hittades inte" |
| `429` | Rate-limit (t.ex. login) | Visa "för många försök, försök igen senare" |
| `5xx` | Serverfel | Behåll åtgärd i offline-kö, försök igen |

Felsvar har vanligtvis formen `{ "message": "<svensk text>" }` (från den centrala felhanteraren). **Vissa endpoints — bl.a. `POST /api/mobile/login` — använder i stället `{ "error": "<svensk text>" }`.** Läs därför `message` med `error` som fallback och visa texten — den är skriven för slutanvändaren.

---

## 12. curl-exempel för manuell verifiering

```bash
BASE="https://<din-traivo-one-url>"

# 1) Logga in (PIN)
TOKEN=$(curl -s -X POST "$BASE/api/v1/mobile/login" \
  -H "Content-Type: application/json" \
  -d '{"pin":"1234"}' | jq -r .token)

# 2) Vem är jag?
curl -s "$BASE/api/v1/mobile/me" -H "Authorization: Bearer $TOKEN" | jq

# 3) Dagens ordrar
curl -s "$BASE/api/v1/mobile/my-orders?date=2026-06-23" \
  -H "Authorization: Bearer $TOKEN" | jq

# 4) v2-orderdetalj (fryst pris, BOM, beroenden)
curl -s "$BASE/api/v1/mobile/v2/orders/<ORDER_ID>" \
  -H "Authorization: Bearer $TOKEN" | jq

# 5) Sätt status "på väg"
curl -s -X PATCH "$BASE/api/v1/mobile/orders/<ORDER_ID>/status" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"en_route"}' | jq

# 6) Synka offline-kö
curl -s -X POST "$BASE/api/v1/mobile/sync" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"actions":[{"clientId":"c1","actionType":"gps","payload":{"lat":59.33,"lng":18.06,"timestamp":"2026-06-23T08:00:00Z"}}]}' | jq
```

---

## 13. Checklista för Go-teamet

**Grund (rör ej):**
- [ ] Behåll versionsomskrivningen `/api/mobile/X` → `/api/v1/mobile/X`
- [ ] All trafik mot `/api/mobile/*` med `Authorization: Bearer <token>`
- [ ] Anropa **aldrig** vanliga `/api/*`-routes (cookie-auth → 401)

**De 8 avvikelserna:**
- [ ] #1 `app/config` → `app-config`
- [ ] #2 `user/preferences` → `preferences` (3 st) + läs `data.preferences`
- [ ] #3 `notifications/unread-count` → `notifications/count` (2 st) + läs `data.unreadCount`
- [ ] #4 GPS-batch via `sync` (`actionType:"gps"`) eller loopa `position`
- [ ] #5 Byt till synkron `route-optimized`, ta bort async-polling
- [ ] #6 Röstkommando via `ai/transcribe`
- [ ] #7 AI-stream → falla till `ai/chat`
- [ ] #8 Ruttmetrik → `route-feedback/mine` / `statistics/summary`

**Affärsregler:**
- [ ] Använd `frozen.*` som gällande pris (räkna aldrig om)
- [ ] Respektera `canStart` / `blockedBy` (v2)
- [ ] Hantera 400 "obligatorisk informationslämning" vid klarmarkering
- [ ] Visa öre→kronor korrekt (dela med 100)
- [ ] Offline-kö med `clientId` som idempotensnyckel

---

*Rapport genererad mot Traivo One:s faktiska route-definitioner (`server/routes/mobile/*`). Vid framtida ändringar i mobil-routes — uppdatera detta dokument så att Traivo Go och Traivo One hålls i synk.*
