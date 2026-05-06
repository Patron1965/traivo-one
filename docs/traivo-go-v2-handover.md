# Traivo Go — Mobile API v2 (ADR v3 / F7)

**Status:** Backend live i Traivo One. Adoption sker när Go-teamet är redo.
**Brytande ändringar:** **Inga.** v1 (`/api/mobile/orders/:id`) är oförändrad.
**Auth:** Samma som v1 — Bearer-token via `isMobileAuthenticated`.

---

## 1. Ny endpoint

```
GET /api/mobile/v2/orders/:id
Authorization: Bearer <mobile_token>
```

Returnerar samma order som v1 men med tre nya fält som aktiverar
**fryst pris-snapshot**, **BOM-checklista** och **beroende-status**.

### Response-shape

```jsonc
{
  "apiVersion": "v2",
  "orderId": "wo_abc123",
  "title": "Tömning containerpark",
  "orderStatus": "scheduled",
  "executionStatus": "not_started",
  "scheduledStart": "2026-05-07T08:00:00.000Z",
  "scheduledEnd":   "2026-05-07T10:00:00.000Z",
  "object":   { "id": "...", "name": "...", "address": "...", "latitude": 59.3, "longitude": 18.1 },
  "customer": { "id": "...", "name": "..." },

  // === NYA FÄLT ===

  "frozen": {
    "isFrozen": true,
    "quantity": 12,
    "unitPrice": 850.0,
    "unitCost": 420.0,
    "unitTime": 15,
    "frozenAt": "2026-05-06T14:32:11.000Z",
    "totalPrice": 10200.0
  },
  // när WO ej är fryst: { "isFrozen": false }

  "bomChecklist": [
    {
      "parentLineId": "line_xyz",
      "parentArticleId": "art_struct_1",
      "parentArticleName": "Standardpaket Container",
      "parentQuantity": 2,
      "items": [
        {
          "componentId": "comp_1",
          "articleId": "art_child_a",
          "articleNumber": "BOLT-M8",
          "articleName": "Bult M8x40",
          "quantityPerParent": 4,
          "totalRequired": 8,
          "unit": "st",
          "notes": null
        }
      ]
    }
  ],

  "dependencyStatus": [
    {
      "orderId": "wo_predecessor",
      "orderTitle": "Förarbete avlopp",
      "status": "in_progress",
      "type": "must_complete_first",
      "isCompleted": false,
      "isBlocking": true
    }
  ],
  "canStart": false,
  "blockedBy": ["wo_predecessor"]
}
```

---

## 2. Hur fälten ska användas i Go-appen

### `frozen` — Audit-immutabelt prislås (F5)
- När `isFrozen=true` är pris/tid **låsta** på serversidan. Order kan inte
  faktureras med annat pris än `unitPrice * quantity` (Fortnox skalar redan
  proportionellt om läggs in nya rader).
- **UI-rekommendation:** Visa en låsikon + "Fryst pris" i orderhuvudet.
  Visa `totalPrice` istället för att räkna från rader när `isFrozen=true`.
- Material-Log och Field Report **får** läggas till nya artiklar lokalt,
  men Go ska visa "påverkar inte fakturasumma — frusen WO".

### `bomChecklist` — Komponentlista per strukturartikel (F4)
- En lista per WO-rad som har en strukturartikel (`is_structure=true`).
- `totalRequired = quantityPerParent × parentQuantity` — det är **det
  totala antalet** av komponenten som behövs för hela ordern.
- **UI-rekommendation:** Ny tab "Material" eller integrera i Focus Mode
  som checklista. Spara avbockning lokalt (offline-first), synka via
  befintlig `POST /api/mobile/orders/:id/checklist` eller en framtida
  v2-checklist-endpoint (ej levererad än — säg till om ni behöver den).
- Om listan är tom finns ingen BOM på artikeln — visa inget.

### `dependencyStatus` — Beroende-status (F-pre v3)
- Befintlig `dependencies`-array i v1 var bara IDs/typ. v2 lägger till:
  - `isCompleted` — om föregångaren är klar
  - `isBlocking` — om denna dep stoppar nuvarande order
- `canStart=false` betyder: **ordern är blockerad**. UI ska:
  - Disable "Starta jobb"-knappen
  - Visa "Väntar på: <orderTitle>" med klickbar länk till föregångaren
  - Tillåt "På väg" och navigation även när blockerad — bara start blockas

---

## 3. Migrationsplan (förslag)

| Fas | Vad | Risk |
|---|---|---|
| **G1** | Lägg `apiVersion: "v2"` som feature-flag i Go. Fortsätt anropa v1. | 0 |
| **G2** | När flag är aktiv: anropa v2 istället. Fall back till v1 vid 4xx/5xx. | Låg |
| **G3** | Bygg UI för `frozen`-banner (read-only, ingen mutation). | Låg |
| **G4** | Bygg BOM-tab + offline-checklista. | Medium — kräver lokal storage. |
| **G5** | Disable Start-knapp på `canStart=false` + visa "Väntar på"-banner. | Låg |
| **G6** | Ta bort feature-flag, gör v2 default. v1 lever kvar för gamla app-versioner. | 0 |

---

## 4. Testning

Kör mot dev-instans (samma Bearer-token som ni redan använder):

```bash
TOKEN=<din-mobile-token>
ORDER_ID=<en-WO-där-du-är-resource>

curl -H "Authorization: Bearer $TOKEN" \
  https://traivo-one.dev.replit.app/api/mobile/v2/orders/$ORDER_ID | jq
```

Förväntat:
- 200 + JSON enligt schema ovan
- 401 utan Bearer
- 403 om `resourceId` inte matchar token-ägaren
- 404 om ordern inte finns

För att testa `frozen`-fältet: be Traivo One-admin köra
`POST /api/work-orders/:id/freeze` på en testorder, sedan anropa v2 igen.

---

## 5. Vad som **inte** ingår i v2 (ännu)

- Ingen v2 för listing-endpoints (`/api/mobile/my-orders`, `/api/mobile/orders`).
  Listor använder fortfarande v1-shape. Säg till om ni vill ha v2 där också.
- Ingen v2-checklist-mutation. Använd befintlig
  `POST /api/mobile/orders/:id/checklist` för avbockning.
- Inga push-notifikationer för `canStart`-state-byten. Polling räcker
  i nuvarande arkitektur.

---

## 6. Backend-referens

- Endpoint-implementation: `server/routes/mobile/orders.ts` (sista handlern)
- Schema-fält: `shared/schema.ts`
  - `frozenUnitPrice / frozenQuantity / frozenUnitCost / frozenUnitTime / frozenAt`
  - `articleComponents` (BOM-tabell)
  - `taskDependencies` (beroende-tabell)
- ADR: `.local/tasks/adr-orderkoncept-v3-sessioner-2026-05-06.md`

**Kontakt:** Backend-teamet (Traivo One). Pinga oss om ni behöver
fler fält i v2 eller v2-versioner av andra endpoints.
