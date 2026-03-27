# Traivo Go → Traivo One: Integrationsrapport — Akut Jobbhantering

**Datum:** 2026-03-27
**System:** Traivo Go (mobilapp)
**Motpart:** Traivo One (planerarsystem)
**Status:** Implementerad i Traivo Go, redo för integration

---

## 1. Sammanfattning

Traivo Go har nu stöd för att ta emot, visa och hantera akuta jobb tilldelade av planeraren i Traivo One. Systemet använder WebSocket-events för realtidskommunikation och REST API:er för statusuppdateringar.

**Traivo One behöver:**
1. Skicka ett WebSocket-event när planeraren tilldelar ett akut jobb
2. Ta emot accept/decline-svar via WebSocket eller REST
3. Visa teknikerns statusuppdateringar i realtid

---

## 2. WebSocket-event: Tilldela akut jobb

### Event: `job:urgent:assigned`

Traivo One skickar detta event till teknikerns WebSocket-room när ett akut jobb tilldelas.

**Room:** `resource:{resourceId}`

**Payload:**
```json
{
  "job": {
    "id": "urgent-abc123",
    "orderId": 9901,
    "type": "Containerbyte",
    "address": "Solnavägen 42, Solna",
    "city": "Solna",
    "latitude": 59.3600,
    "longitude": 18.0000,
    "distance": "1.2 km",
    "estimatedMinutes": 4,
    "deadline": "2026-03-27T14:30:00.000Z",
    "deadlineLabel": "om 1h",
    "customerName": "AB Bygg",
    "customerPhone": "08-123 456",
    "notes": "Full container, arbete blockerat",
    "assignedBy": "Lisa P. (planerare)",
    "assignedAt": "2026-03-27T13:30:00.000Z",
    "priority": "urgent",
    "articles": "Container 6m³ → töm+byt"
  },
  "previousOrderId": 1234
}
```

### Fält i `job`-objektet

| Fält | Typ | Obligatoriskt | Beskrivning |
|------|-----|--------------|-------------|
| `id` | string | Ja | Unikt ID för det akuta jobbet |
| `orderId` | number | Ja | Kopplat order-ID i systemet |
| `type` | string | Ja | Typ av jobb, t.ex. "Containerbyte", "Nödhämtning" |
| `address` | string | Ja | Full adress |
| `city` | string | Nej | Stad |
| `latitude` | number | Ja | GPS latitude |
| `longitude` | number | Ja | GPS longitude |
| `distance` | string | Nej | Avstånd från teknikern, t.ex. "1.2 km" |
| `estimatedMinutes` | number | Nej | Beräknad restid i minuter |
| `deadline` | string (ISO) | Nej | Deadline som ISO 8601 timestamp |
| `deadlineLabel` | string | Nej | Läsbar deadline, t.ex. "om 1h", "14:30" |
| `customerName` | string | Ja | Kundnamn |
| `customerPhone` | string | Nej | Kundens telefonnummer |
| `notes` | string | Nej | Planerare/kundanteckning |
| `assignedBy` | string | Nej | Planerarens namn |
| `assignedAt` | string (ISO) | Ja | Tidpunkt för tilldelning |
| `priority` | "urgent" | Ja | Alltid "urgent" |
| `articles` | string | Nej | Artikelbeskrivning |

### Fält i wrapper-objektet

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `job` | UrgentJob | Jobbdata (se ovan) |
| `previousOrderId` | number (opt) | Teknikerns nuvarande order som pausas |

---

## 3. WebSocket-events: Svar från tekniker

### Event: `job:urgent:accept`
Teknikern accepterar jobbet.

```json
{
  "jobId": "urgent-abc123",
  "startNavigation": true
}
```

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `jobId` | string | ID på det akuta jobbet |
| `startNavigation` | boolean | Om teknikern vill starta GPS-navigering direkt |

### Event: `job:urgent:decline`
Teknikern avböjer jobbet.

```json
{
  "jobId": "urgent-abc123",
  "reason": "Kan inte avbryta nuvarande jobb"
}
```

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `jobId` | string | ID på det akuta jobbet |
| `reason` | string | Anledning till avböjning |

**Möjliga reasons:**
- `"Kan inte avbryta nuvarande jobb"`
- `"Fordon fullt/olämpligt"`
- `"Personligt skäl"`
- `"Annat: [fritext]"` (format: "Annat: användarens text")

### Event: `job:urgent:response:ack`
Traivo One bör bekräfta att svaret mottogs:

```json
{
  "jobId": "urgent-abc123",
  "status": "accepted"
}
```

---

## 4. REST API-endpoints (Traivo Go → Traivo One)

Traivo Go anropar dessa endpoints (proxyas genom Traivo Go-servern till Traivo One i live-läge):

### POST `/api/mobile/jobs/urgent/accept`

**Request body:**
```json
{
  "jobId": "urgent-abc123",
  "startNavigation": true
}
```

**Response:**
```json
{
  "success": true,
  "status": "accepted",
  "jobId": "urgent-abc123"
}
```

### POST `/api/mobile/jobs/urgent/decline`

**Request body:**
```json
{
  "jobId": "urgent-abc123",
  "reason": "Fordon fullt/olämpligt"
}
```

**Response:**
```json
{
  "success": true,
  "status": "declined",
  "jobId": "urgent-abc123"
}
```

### POST `/api/mobile/jobs/urgent/:id/status`

Statusuppdateringar under jobbets livscykel.

**Request body:**
```json
{
  "status": "en_route"
}
```

**Giltiga statusvärden:**
- `en_route` — Teknikern är på väg
- `arrived` — Teknikern har anlänt (GPS-geofence 50m eller manuellt)
- `in_progress` — Jobbet har påbörjats
- `completed` — Jobbet är slutfört
- `issue_reported` — Problem rapporterat

**Response:**
```json
{
  "success": true,
  "jobId": "urgent-abc123",
  "status": "en_route"
}
```

### GET `/api/mobile/jobs/urgent/active`

Hämtar aktivt akut jobb (för recovery vid app-omstart/reconnect).

**Response:**
```json
{
  "success": true,
  "activeJob": {
    "id": "urgent-abc123",
    "orderId": 9901,
    "resourceId": 101,
    "status": "en_route",
    "acceptedAt": "2026-03-27T13:31:00.000Z",
    "startNavigation": true,
    "createdAt": "2026-03-27T13:30:00.000Z"
  }
}
```

Returnerar `"activeJob": null` om inget aktivt jobb finns.

---

## 5. Statuslivscykel

```
Planeraren tilldelar jobb
        │
        ▼
    [pending] ──── Teknikern ser modal ────┐
        │                                  │
    ┌───┴───┐                              │
    ▼       ▼                              │
[accepted] [declined]                      │
    │           │                          │
    ▼           ▼                          │
[en_route]  Planeraren notifieras          │
    │       → kan tilldela annan           │
    ▼                                      │
[arrived]  (GPS 50m auto / manuellt)       │
    │                                      │
    ▼                                      │
[in_progress]                              │
    │                                      │
    ├──────────────┐                       │
    ▼              ▼                       │
[completed]  [issue_reported]              │
    │              │                       │
    ▼              ▼                       │
  Klar!      Planeraren hanterar           │
                                           │
[reassigned] ◄─── Planeraren omtilldelar ──┘
  (om timeout / tekniker offline > 5 min)
```

---

## 6. Vad Traivo One behöver implementera

### 6.1 Planerarvy — "Tilldela akut jobb"
- Knapp/action i planervyn för att markera ett jobb som akut
- Välj tekniker (baserat på närhet, tillgänglighet)
- Skicka WebSocket-event `job:urgent:assigned` till vald tekniker
- Beräkna och skicka med `distance` och `estimatedMinutes`

### 6.2 Realtidsvisning
- Visa teknikerns svar (accept/decline) inom 3 sekunder
- Vid decline: visa anledning, erbjud omtilldelning till annan tekniker
- Vid accept: visa teknikerns status (på väg, framme, pågår, klar)
- Vid ingen respons > 60 sek: visa varning, erbjud omtilldelning

### 6.3 WebSocket-rooms
Traivo Go ansluter till dessa rooms:
- `resource:{resourceId}` — Teknikerns personliga room
- `tenant:{tenantId}` — Tenant-wide events
- `team:{teamId}` — Team events

Akut jobb-event ska skickas till `resource:{resourceId}`.

### 6.4 Offline-hantering
- Om teknikern är offline (ingen WebSocket-anslutning):
  - Visa "Offline sedan X min" i planeraryn
  - Om offline > 5 min: automatisk omtilldelning eller manuell
  - När teknikern återansluter: GET `/jobs/urgent/active` hämtar missade jobb

### 6.5 Backend-endpoints att implementera
Traivo One behöver exponera dessa endpoints som Traivo Go-servern proxar till:
- `POST /api/mobile/jobs/urgent/accept` — Ta emot accept
- `POST /api/mobile/jobs/urgent/decline` — Ta emot decline med reason
- `POST /api/mobile/jobs/urgent/:id/status` — Ta emot statusuppdateringar
- `GET /api/mobile/jobs/urgent/active` — Returnera aktivt jobb för en resurs

---

## 7. TypeScript-typer (kopiera in i Traivo One)

```typescript
interface UrgentJob {
  id: string;
  orderId: number;
  type: string;
  address: string;
  city?: string;
  latitude: number;
  longitude: number;
  distance?: string;
  estimatedMinutes?: number;
  deadline?: string;
  deadlineLabel?: string;
  customerName: string;
  customerPhone?: string;
  notes?: string;
  assignedBy?: string;
  assignedAt: string;
  priority: 'urgent';
  articles?: string;
}

interface UrgentJobAssignment {
  job: UrgentJob;
  previousOrderId?: number;
}

type UrgentJobStatus =
  | 'pending'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'reassigned'
  | 'issue_reported';

const DECLINE_REASONS = [
  { id: 'cannot_interrupt', label: 'Kan inte avbryta nuvarande jobb' },
  { id: 'vehicle_unsuitable', label: 'Fordon fullt/olämpligt' },
  { id: 'personal_reason', label: 'Personligt skäl' },
  { id: 'other', label: 'Annat' },
];
```

---

## 8. Exempel: Skicka akut jobb från Traivo One

```typescript
// I Traivo One planerarbackend
function assignUrgentJob(resourceId: number, jobData: UrgentJob) {
  // Spara i databas
  const urgentAssignment = await db.insert(urgentJobs).values({
    id: jobData.id,
    orderId: jobData.orderId,
    resourceId,
    status: 'pending',
    createdAt: new Date(),
  });

  // Skicka WebSocket-event till teknikern
  io.to(`resource:${resourceId}`).emit('job:urgent:assigned', {
    job: jobData,
    previousOrderId: getCurrentOrderForResource(resourceId),
  });

  // Starta timeout-timer (60 sek)
  setTimeout(async () => {
    const current = await db.query.urgentJobs.findFirst({
      where: eq(urgentJobs.id, jobData.id),
    });
    if (current?.status === 'pending') {
      // Ingen respons — visa varning för planeraren
      io.to(`tenant:${tenantId}`).emit('urgent:no_response', {
        jobId: jobData.id,
        resourceId,
        resourceName: getResourceName(resourceId),
      });
    }
  }, 60000);
}
```

---

## 9. Databasschema-förslag (Traivo One)

```sql
CREATE TABLE urgent_job_assignments (
  id VARCHAR(64) PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  tenant_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  decline_reason TEXT,
  start_navigation BOOLEAN DEFAULT false,
  assigned_by INTEGER REFERENCES resources(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMP,
  declined_at TIMESTAMP,
  arrived_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_urgent_jobs_resource ON urgent_job_assignments(resource_id, status);
CREATE INDEX idx_urgent_jobs_tenant ON urgent_job_assignments(tenant_id, status);
```
