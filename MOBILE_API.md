# Unicorn - Mobil Fältapp API-dokumentation

*Senast uppdaterad: 2026-02-21*

## Översikt

Detta dokument beskriver REST API:et som Unicorn-plattformen exponerar för integration med det externa **Fältapp**-projektet. API:et stöder två autentiseringsvägar och ger fältarbetare tillgång till uppgifter, beroendekedjor, fotouppladdning, besiktning och metadata.

**Base URL:** `https://<unicorn-host>`

---

## 1. Autentisering

### 1.1 PIN-baserad Mobilinloggning

Fältarbetare loggar in med e-post + PIN-kod. Sessionen hanteras via cookie.

#### POST `/api/mobile/login`
**Request Body:**
```json
{
  "email": "anna@kinab.se",
  "pin": "1234"
}
```

**Response (200):**
```json
{
  "resource": {
    "id": "res_abc123",
    "name": "Anna Andersson",
    "tenantId": "tenant_kinab",
    "phone": "0701234567",
    "email": "anna@kinab.se"
  },
  "token": "session_token_xyz"
}
```

**Felkoder:**
- `401` - Ogiltigt e-post/PIN-kombination

#### POST `/api/mobile/logout`
**Headers:** Cookie med session-token (från login)

**Response (200):**
```json
{ "success": true }
```

#### GET `/api/mobile/me`
Hämtar info om inloggad resurs.

**Response (200):**
```json
{
  "id": "res_abc123",
  "name": "Anna Andersson",
  "tenantId": "tenant_kinab",
  "resourceType": "person",
  "phone": "0701234567",
  "executionCodes": ["KB", "TV"]
}
```

---

## 2. Uppgiftshantering

### 2.1 Hämta dagens uppgifter (PIN-auth)

#### GET `/api/mobile/my-orders`
Returnerar alla ordrar för inloggad resurs, filtrerat på dagens datum.

**Response (200):** Array av WorkOrder-objekt.

#### GET `/api/mobile/orders/:id`
Hämtar specifik arbetsorder med orderrader och objektinfo.

### 2.2 Hämta uppgifter med beroendeinformation (tenant-auth)

#### GET `/api/field-worker/tasks`
**Query Parameters:**
| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| `date` | string (ISO date) | Datum att filtrera på (default: idag) |
| `resourceId` | string | Filtera på specifik resurs |

**Response (200):**
```json
[
  {
    "id": "wo_123",
    "title": "Tvätt rum 201",
    "objectId": "obj_456",
    "resourceId": "res_abc",
    "scheduledDate": "2026-02-21T08:00:00Z",
    "scheduledStartTime": "08:00",
    "estimatedDuration": 30,
    "executionStatus": "scheduled",
    "status": "in_progress",
    "metadata": {},
    "dependsOn": [
      {
        "parentId": "wo_120",
        "type": "before",
        "completed": false
      }
    ],
    "isLocked": true,
    "isDependentTask": true
  }
]
```

**Viktiga fält:**
- `isLocked` (boolean) - `true` om uppgiften har olösta beroenden av typ "before"
- `dependsOn` (array) - Lista av beroenden med `parentId`, `type` ("before"/"after"/"same_day"), och `completed`
- `isDependentTask` (boolean) - `true` om uppgiften har något beroende

---

## 3. Uppgiftsflöde (Statusändringar)

### 3.1 Starta uppgift

#### POST `/api/field-worker/tasks/:id/start`
Sätter `executionStatus = "travel"` och `status = "in_progress"`.

**Response (200):** Uppdaterat WorkOrder-objekt.

**Notera:** Appen bör kontrollera `isLocked` flaggan innan start-anrop. Backend validerar tenant-tillhörighet men inte beroendelåsning - det är klientens ansvar att visa lås-indikering.

### 3.2 Slutföra uppgift

#### POST `/api/field-worker/tasks/:id/complete`
Sätter `executionStatus = "completed"`, `status = "completed"`, och `completedAt`.

**Beroendekedje-effekt:** Markerar automatiskt alla `task_dependency_instances` där denna order är `parentWorkOrderId` som `completed = true`, vilket kan låsa upp beroende uppgifter.

**Response (200):** Uppdaterat WorkOrder-objekt.

### 3.3 Uppdatera orderstatus (PIN-auth)

#### PATCH `/api/mobile/orders/:id/status`
**Request Body:**
```json
{
  "executionStatus": "on_site"
}
```

**Tillåtna executionStatus-värden:**
1. `scheduled` - Schemalagd
2. `travel` - På väg
3. `on_site` - På plats
4. `work_started` - Arbete påbörjat
5. `work_done` - Arbete klart
6. `reporting` - Rapporterar
7. `completed` - Slutförd
8. `cancelled` - Avbruten

### 3.4 Lägg till anteckning

#### POST `/api/mobile/orders/:id/notes`
**Request Body:**
```json
{
  "note": "Kunde inte nå bakdörren, kontaktade fastighetsägare."
}
```

---

## 4. Metadata-uppdatering

#### POST `/api/field-worker/tasks/:id/update-metadata`
Skriver metadata tillbaka till objektet kopplat till arbetsordern.

**Request Body:**
```json
{
  "metadata": {
    "senaste_tvatt": "2026-02-21",
    "status_dorr": "ok",
    "antal_besok": "15"
  }
}
```

Varje nyckel-värde-par sparas som en metadatapost på objektet med metod `field:{workOrderId}`.

---

## 5. Fotouppladdning

Tvåstegsprocess med presigned URL:er via Replit Object Storage.

### Steg 1: Hämta uppladdnings-URL

#### POST `/api/field-worker/tasks/:id/upload-photo`
**Request Body:** Tomt (`{}`)

**Response (200):**
```json
{
  "uploadURL": "https://storage.googleapis.com/...?X-Goog-Signature=...",
  "objectPath": "private/photos/abc123.jpg",
  "workOrderId": "wo_123"
}
```

### Steg 2: Ladda upp filen

Gör en `PUT`-request direkt till `uploadURL` med bildfilen som body:
```
PUT <uploadURL>
Content-Type: image/jpeg
Body: <binärdata>
```

### Steg 3: Bekräfta uppladdning

#### POST `/api/field-worker/tasks/:id/confirm-photo`
**Request Body:**
```json
{
  "objectPath": "private/photos/abc123.jpg",
  "category": "before"
}
```

**Tillåtna kategorier:**
- `before` - Före-bild
- `after` - Efter-bild
- `damage` - Skadedokumentation
- `general` - Övrig bild (default)

**Response (200):**
```json
{
  "success": true,
  "photoCount": 3
}
```

Fotot sparas i `workOrder.metadata.photos` som:
```json
{
  "path": "private/photos/abc123.jpg",
  "category": "before",
  "uploadedAt": "2026-02-21T10:30:00Z"
}
```

---

## 6. Besiktning (Inspection)

### 6.1 Spara besiktningsresultat

#### POST `/api/inspection-metadata`
**Request Body:**
```json
{
  "workOrderId": "wo_123",
  "objectId": "obj_456",
  "inspectionType": "door",
  "status": "warning",
  "issues": ["Knarrar", "Stängs inte"],
  "comment": "Dörren behöver justeras",
  "photoUrls": [],
  "inspectedBy": "Anna Andersson"
}
```

**Inspektionstyper och predefined issues:**

| inspectionType | Svenska | Problem-alternativ |
|----------------|---------|-------------------|
| `door` | Dörr | Knarrar, Stängs inte, Skadad, Saknar stängare |
| `lock` | Lås | Slitet, Fastnar, Saknas, Fel nyckel |
| `window` | Fönster | Sprucket, Öppnas inte, Trasig spanjolette, Kondens |
| `lighting` | Belysning | Ur funktion, Blinkar, Saknas, Felaktig armatur |
| `floor` | Golv | Skadat, Halt, Smutsigt, Sprickor |
| `ventilation` | Ventilation | Ur funktion, Oljud, Dålig luft, Blockerad |

**Status-värden:**
- `ok` - Godkänt
- `warning` - Varning
- `error` - Fel

**Response (201):** Skapad InspectionMetadata-post.

### 6.2 Hämta besiktningshistorik

#### GET `/api/inspection-metadata`
**Query Parameters:**
| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| `objectId` | string | Filtrera på objekt |

### 6.3 Sök i besiktningar

#### GET `/api/inspection-metadata/search`
**Query Parameters:**
| Parameter | Typ | Beskrivning |
|-----------|-----|-------------|
| `inspectionType` | string | Typ (door/lock/window/lighting/floor/ventilation) |
| `status` | string | Status (ok/warning/error) |
| `objectId` | string | Objekt-ID |

---

## 7. GPS-positionsrapportering

#### POST `/api/mobile/position`
Rapporterar fältarbetarens GPS-position.

**Request Body:**
```json
{
  "latitude": 59.3293,
  "longitude": 18.0686,
  "accuracy": 10.5,
  "heading": 180,
  "speed": 5.2
}
```

---

## 8. Datamodeller

### WorkOrder (Arbetsorder)
```typescript
{
  id: string;
  tenantId: string;
  customerId: string | null;
  objectId: string | null;
  resourceId: string | null;
  title: string;
  description: string | null;
  orderType: string;       // "service", "felanmalan", etc.
  priority: string;        // "low", "medium", "high", "urgent"
  status: string;          // "pending", "in_progress", "completed", "cancelled"
  executionStatus: string; // Se statusflöde ovan
  scheduledDate: Date | null;
  scheduledStartTime: string | null;
  estimatedDuration: number | null;  // minuter
  actualDuration: number | null;     // minuter
  completedAt: Date | null;
  metadata: {
    photos?: Array<{
      path: string;
      category: string;
      uploadedAt: string;
    }>;
    [key: string]: any;
  };
  notes: string | null;
}
```

### InspectionMetadata (Besiktning)
```typescript
{
  id: string;
  tenantId: string;
  workOrderId: string | null;
  objectId: string | null;
  inspectionType: string;      // "door", "lock", etc.
  status: string;              // "ok", "warning", "error"
  issues: string[];            // Predefined issue strings
  comment: string | null;
  photoUrls: string[];
  inspectedBy: string | null;
  inspectedAt: Date;
  createdAt: Date;
}
```

### TaskDependency (Beroendeinfo i tasks-response)
```typescript
{
  parentId: string;       // ID på uppgift som detta beror på
  type: string;           // "before", "after", "same_day"
  completed: boolean;     // true om beroendet är löst
}
```

---

## 9. Felhantering

Alla endpoints returnerar svenska felmeddelanden:

| HTTP-kod | Betydelse | Exempel |
|----------|-----------|---------|
| 400 | Ogiltig request | `{ "error": "objectPath krävs" }` |
| 401 | Ej autentiserad | `{ "error": "Ej inloggad" }` |
| 404 | Resurs hittades inte | `{ "error": "Uppgift hittades inte" }` |
| 500 | Serverfel | `{ "error": "Kunde inte hämta uppgifter" }` |

---

## 10. Integrationsflöde för Fältappen

### Rekommenderat startflöde:
1. `POST /api/mobile/login` → Logga in med PIN
2. `GET /api/field-worker/tasks?date=YYYY-MM-DD&resourceId=X` → Hämta dagens uppgifter
3. Visa uppgiftslista med lås/upplåst-indikatorer
4. För varje uppgift:
   a. `POST /api/field-worker/tasks/:id/start` → Starta
   b. Utför arbete + ta foton + besiktiga
   c. `POST /api/field-worker/tasks/:id/upload-photo` → Ladda upp foton
   d. `POST /api/field-worker/tasks/:id/confirm-photo` → Bekräfta foton
   e. `POST /api/inspection-metadata` → Spara besiktning
   f. `POST /api/field-worker/tasks/:id/update-metadata` → Skriv metadata
   g. `POST /api/field-worker/tasks/:id/complete` → Slutför (upplåser beroende)
5. `POST /api/mobile/position` → Rapportera GPS periodiskt

### Offline-hantering:
Appen bör cacha uppgifter lokalt och köa ändringar (outbox pattern) för att synka vid uppkoppling.
Statusändringar, foton, metadata och besiktningar kan köas och synkas sekventiellt.

---

*Se även: SYSTEM_DOCUMENTATION.md för fullständig systemöversikt.*
