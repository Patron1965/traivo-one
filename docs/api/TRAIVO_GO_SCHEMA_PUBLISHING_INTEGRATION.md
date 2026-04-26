# Traivo One → Traivo Go: Integrationsrapport — Schemautskick & Extrajobb-SMS

**Datum:** 2026-04-26
**System:** Traivo One (planerarsystem)
**Motpart:** Traivo Go (mobilapp för fältpersonal)
**Status:** Implementerad i Traivo One (task #264 + #266), redo för integration
**Format:** Samma som `TRAIVO_GO_AKUT_JOBB_INTEGRATION.md`

---

## 1. Sammanfattning

Traivo One har nu ett komplett flöde för "skicka veckoschema till tekniker"
plus automatiska SMS när planeraren lägger till eller flyttar jobb inom en
redan publicerad period. Tekniker kan slå av båda kanalerna individuellt
direkt från mobilappen.

**Tre nya saker händer i bakgrunden när en planerare publicerar ett schema:**

1. Veckoschemat skickas via e-post och/eller SMS till varje tekniker (en
   sammanfattning per resurs och period).
2. På resursen lagras `lastSchedulePublishedAt`, `lastSchedulePeriodStart`
   och `lastSchedulePeriodEnd` så att efterföljande tilldelningar kan
   detektera om de hamnar **inom** den redan publicerade veckan.
3. Om planeraren senare tilldelar (eller flyttar) ett jobb in i den redan
   publicerade veckan triggas ett "extrajobb"-SMS till teknikern. Om
   jobbet flyttas **från** en tekniker triggas ett cancellation-SMS.

Allt loggas som driver-notifikationer (`/api/mobile/notifications`-feeden)
så att teknikern och planeraren har samma historik. Traivo Go behöver
inte trigga något själv — flödet är helt server-styrt — men appen ska:

1. **Visa publiceringsstatus** ("Vecka 17 publicerad: tisdag 14:32") på
   "Min vecka"-vyn.
2. **Visa SMS-historiken** (ny endpoint, se §6) på resurskortet.
3. **Erbjuda två toggles** för opt-out av SMS-kanalerna.
4. **Visa nya notifikations-typer** i in-app notifieringslistan med rätt
   ikon och färg.

---

## 2. Nya fält på Resource-objektet

`GET /api/mobile/me` (oförändrad endpoint) returnerar redan dessa fält
via `...resource`-spread. Inga separata anrop behövs.

| Fält | Typ | Default | Beskrivning |
|------|-----|---------|-------------|
| `smsOnScheduleSend` | `boolean` | `true` | Får teknikern SMS när planeraren publicerar ett nytt veckoschema? |
| `smsOnExtraJob` | `boolean` | `true` | Får teknikern SMS när ett jobb läggs till eller flyttas inom redan publicerad vecka? Samma flagga styr cancellation-SMS. |
| `lastSchedulePublishedAt` | `string (ISO 8601) \| null` | `null` | När senaste publicering skedde till denna resurs. |
| `lastSchedulePeriodStart` | `string ("YYYY-MM-DD") \| null` | `null` | Startdatum för senast publicerade period. |
| `lastSchedulePeriodEnd` | `string ("YYYY-MM-DD") \| null` | `null` | Slutdatum för senast publicerade period. |

### Exempel-payload (utdrag från `/api/mobile/me`)

```json
{
  "id": "res-tomas",
  "name": "Tomas Nordin",
  "phone": "+46701234567",
  "email": "tomas@kinab.se",
  "smsOnScheduleSend": true,
  "smsOnExtraJob": true,
  "lastSchedulePublishedAt": "2026-04-21T13:32:00.000Z",
  "lastSchedulePeriodStart": "2026-04-27",
  "lastSchedulePeriodEnd": "2026-05-03",
  "executionCodes": ["KB", "TV"]
}
```

### Hur Go ska tolka periodfälten

- Visa "Vecka X publicerad" om `lastSchedulePublishedAt` finns och dagens
  datum ligger mellan `lastSchedulePeriodStart` och `lastSchedulePeriodEnd`.
- Visa "Ej publicerad ännu" om `lastSchedulePeriodStart` saknas eller om
  dagens datum ligger **efter** `lastSchedulePeriodEnd` (förra perioden
  är slut, ny ej skickad).
- Visa "Nästa vecka publicerad" om `lastSchedulePeriodStart` ligger i
  framtiden (planeraren har redan skickat nästa vecka i förväg).

---

## 3. Nya driver-notifikationstyper

Följande fyra typer dyker upp i `GET /api/mobile/notifications`-feeden
(skickas via samma `driver_notifications`-tabell som tidigare typer).
Appen ska hantera dem med passande ikon, färg och eventuell deeplink.

| `type` | Trigger | Föreslagen ikon | Färg | Deeplink |
|--------|---------|-----------------|------|----------|
| `schedule_published` | Planeraren skickade veckoschemat (e-post/SMS gick fram på minst en kanal) | `calendar-check` | grön (#7DBFB0) | "Min vecka"-vyn |
| `schedule_send_failed` | Planeraren försökte skicka veckoschemat men både e-post och SMS misslyckades | `alert-triangle` | röd (#EF4444) | Profil/inställningar (kontrollera kontaktuppgifter) |
| `extra_job_sms` | SMS skickades om ett extrajobb i redan publicerad vecka | `plus-square` | blå (#1B4B6B) | Orderdetalj (`orderId` finns i toppen av notisen) |
| `cancel_job_sms` | SMS skickades om att ett jobb togs bort från teknikerns rutt | `x-circle` | orange (#F97316) | Orderdetalj |

### 3.1 Exempel-payload — `schedule_published`

```json
{
  "id": "notif_1745234567890_a3f9",
  "tenantId": "tenant_kinab",
  "resourceId": "res-tomas",
  "type": "schedule_published",
  "title": "Schema skickat",
  "message": "Schemat för 2026-04-27 – 2026-05-03: e-post → tomas@kinab.se, SMS → +46701234567 (12 jobb)",
  "orderId": null,
  "data": {
    "dateRange": { "start": "2026-04-27", "end": "2026-05-03" },
    "totalJobs": 12,
    "channels": {
      "email": { "success": true, "recipient": "tomas@kinab.se" },
      "sms": { "success": true, "recipient": "+46701234567" }
    }
  },
  "isRead": false,
  "createdAt": "2026-04-21T13:32:00.000Z"
}
```

### 3.2 Exempel-payload — `schedule_send_failed`

```json
{
  "id": "notif_1745234600000_b7c2",
  "tenantId": "tenant_kinab",
  "resourceId": "res-tomas",
  "type": "schedule_send_failed",
  "title": "Schemautskick misslyckades",
  "message": "Schemat för 2026-04-27 – 2026-05-03: e-post ✗ tomas@kinab.se (rejected), SMS ✗ +46701234567 (twilio_error_30003) (12 jobb)",
  "orderId": null,
  "data": {
    "dateRange": { "start": "2026-04-27", "end": "2026-05-03" },
    "totalJobs": 12,
    "channels": {
      "email": { "success": false, "error": "rejected", "recipient": "tomas@kinab.se" },
      "sms": { "success": false, "error": "twilio_error_30003", "recipient": "+46701234567" }
    }
  },
  "isRead": false,
  "createdAt": "2026-04-21T13:32:05.000Z"
}
```

### 3.3 Exempel-payload — `extra_job_sms`

```json
{
  "id": "notif_1745310000000_d9e1",
  "tenantId": "tenant_kinab",
  "resourceId": "res-tomas",
  "type": "extra_job_sms",
  "title": "Extrajobb-SMS skickat",
  "message": "SMS skickades till +46701234567 om \"Tömning Solnavägen 42\" (ny tilldelning)",
  "orderId": "wo-901",
  "data": {
    "reason": "assigned",
    "phone": "+46701234567",
    "messageId": "SM1234567890abcdef"
  },
  "isRead": false,
  "createdAt": "2026-04-22T09:14:00.000Z"
}
```

`reason` är antingen `"assigned"` (helt nytt jobb in i veckan) eller
`"rescheduled"` (jobb flyttat in från annan tekniker eller annan vecka).

### 3.4 Exempel-payload — `cancel_job_sms`

```json
{
  "id": "notif_1745311000000_f2a4",
  "tenantId": "tenant_kinab",
  "resourceId": "res-anna",
  "type": "cancel_job_sms",
  "title": "Jobbet borttaget – SMS skickat",
  "message": "SMS skickades till +46707654321 om att \"Tömning Solnavägen 42\" tagits bort från rutten",
  "orderId": "wo-901",
  "data": {
    "phone": "+46707654321",
    "messageId": "SM0987654321fedcba"
  },
  "isRead": false,
  "createdAt": "2026-04-22T09:14:01.000Z"
}
```

---

## 4. SMS-mallar (referens — appen visar inte själva SMS:et)

Servern bygger texten själv. Mallarna lever i `server/extra-job-sms.ts`
respektive `server/customer-notifications.ts`. De följer dessa regler:

- **Språk:** Svenska. Tilltal med teknikerns förnamn.
- **Avsändare:** Tenantens namn (t.ex. "Kinab").
- **Längd:** Max 320 tecken (trunkeras med `...` om längre).
- **Avslut:** Alltid hänvisning till "Se Traivo Go" (mobilappens varumärke).

### 4.1 Extrajobb (assigned/rescheduled)

```
{Företag}: Hej {Förnamn}, extrajobb tillagt {dag DD MMM} {HH:MM?}.
{Jobbtitel} – {Objektnamn} • {Objektadress}. Se Traivo Go.
```

### 4.2 Cancellation

```
{Företag}: Hej {Förnamn}, jobbet {dag DD MMM} {HH:MM?} ({Jobbtitel})
är borttaget från din rutt. Se Traivo Go.
```

### 4.3 Schemautskick (vecka)

Innehåller en kort sammanfattning ("X jobb v17, första {datum} {tid}") plus
länk till webbschemat. Exakt format byggs av planerar-tjänsten och varierar
per tenant — appen behöver inte återskapa texten.

---

## 5. PATCH /api/mobile/me/notification-prefs (NY)

Mobil-säker endpoint för att toggla SMS-preferenserna. Använder samma
bearer-token-auth som övriga `/api/mobile/*`-endpoints (opaque token från
`POST /api/mobile/login`, skickas i `Authorization: Bearer <token>`).

```
PATCH /api/mobile/me/notification-prefs
Authorization: Bearer <mobile-token>
Content-Type: application/json
```

### Request

Minst ett av fälten måste finnas:

```json
{
  "smsOnScheduleSend": false,
  "smsOnExtraJob": true
}
```

| Fält | Typ | Krävs | Beskrivning |
|------|-----|:---:|-------------|
| `smsOnScheduleSend` | `boolean` | nej | Slår av/på veckoschema-SMS för inloggad resurs. |
| `smsOnExtraJob` | `boolean` | nej | Slår av/på extrajobb- och cancellation-SMS för inloggad resurs. |

### Response (200)

```json
{
  "success": true,
  "smsOnScheduleSend": false,
  "smsOnExtraJob": true,
  "lastSchedulePublishedAt": "2026-04-21T13:32:00.000Z",
  "lastSchedulePeriodStart": "2026-04-27",
  "lastSchedulePeriodEnd": "2026-05-03"
}
```

### Felkoder

| Kod | Orsak |
|-----|-------|
| `400` | Tomt body eller fält av fel typ |
| `401` | Saknar/ogiltig `Authorization: Bearer`-token |
| `404` | Resursen kunde inte hittas (token pekar på borttagen resurs) |

### Exempel-anrop

```bash
curl -X PATCH https://traivo.app/api/mobile/me/notification-prefs \
  -H "Authorization: Bearer $MOBILE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"smsOnScheduleSend": false}'
```

> **Notera:** Webb-fältappen i Traivo One uppdaterar fortfarande hela
> resursen via `PATCH /api/resources/:id` (admin-auth), men native-appen
> ska aldrig anropa den endpointen — använd `/api/mobile/me/notification-prefs`.

---

## 6. GET /api/resources/:id/sms-history (för admin/debug, ej obligatorisk i Go)

Planerar-webben använder denna för att visa SMS-historik per resurs på
ResourceDetailSheet (task #266). Den är **admin-auth** och hör inte hemma
i mobilappen, men listas här för kompletthet.

```
GET /api/resources/:id/sms-history?limit=20
Authorization: session cookie (admin)
```

Returnerar de senaste driver-notifikationerna av typerna
`schedule_published`, `schedule_send_failed`, `extra_job_sms`,
`cancel_job_sms`. Om Traivo Go senare vill bygga en motsvarande vy åt
teknikern själv, lägg till en mobil-version under `/api/mobile/me/sms-history`
(ej implementerad ännu — be backend-teamet).

---

## 7. Statuslivscykel

```
Planerare trycker "Skicka veckoschema"
        │
        ▼
   [Servern bygger e-post + SMS per resurs]
        │
   ┌────┴─────┐
   ▼          ▼
[email OK?] [sms OK?]
   │          │
   └──┬──┬────┘
      │  │
      ▼  ▼
  Minst en kanal lyckas?
      │
   ┌──┴──┐
   ▼     ▼
  JA    NEJ
   │     │
   ▼     ▼
 Sätt:  driver_notification
 lastSchedulePublishedAt   type=schedule_send_failed
 lastSchedulePeriodStart   (ingen periodfält uppdateras)
 lastSchedulePeriodEnd
   │
   ▼
 driver_notification
 type=schedule_published
   │
   ▼
[Flera dagar senare]
   │
   ▼
Planerare lägger nytt jobb i veckan
   │
   ▼
isWithinPublishedPeriod(scheduledDate, periodStart, periodEnd)?
   │
 ┌─┴──┐
 ▼    ▼
JA   NEJ → ingen SMS, vanligt jobb
 │
 ▼
resource.smsOnExtraJob === true?
 │
 ▼
Skicka SMS via Twilio + driver_notification (extra_job_sms eller cancel_job_sms)
```

---

## 8. Rekommenderad implementation i Traivo Go

### 8.1 "Min vecka"-vyn

- Hämta `/api/mobile/me` vid app-start och vid pull-to-refresh.
- Visa en pill längst upp:
  - Grön "Vecka X publicerad {tid}" om `lastSchedulePublishedAt` finns
    och dagens datum är inom `lastSchedulePeriodStart..End`.
  - Grå "Ej publicerad ännu" annars.
- Klick på pillen → öppna informationsdrawer med:
  - Datum för senaste publicering
  - Period (start–slut)
  - Länk "Visa SMS-historik" (om/när mobilversion av endpointen finns)

### 8.2 Inställnings-skärmen (Profil → Notifieringar)

Lägg två togglar i ett "SMS"-block:

| Toggle-text | Beskrivning under | Default |
|-------------|-------------------|---------|
| "SMS när nytt veckoschema publiceras" | "Du får ett SMS när planeraren skickar din nya vecka." | På |
| "SMS vid extrajobb i din vecka" | "Du får ett SMS om planeraren lägger in eller tar bort jobb i en vecka som redan är publicerad." | På |

Vid toggle: anropa `PATCH /api/mobile/me/notification-prefs` med
{ smsOnScheduleSend?, smsOnExtraJob? }. Visa toast vid lyckad uppdatering.

### 8.3 Notifieringslistan

Lägg till hantering för de fyra nya `type`-värdena enligt tabellen i §3.
Klick på `extra_job_sms` / `cancel_job_sms` → öppna orderdetalj via
`orderId`. Klick på `schedule_published` → öppna "Min vecka". Klick på
`schedule_send_failed` → öppna profilskärmen med toast "Kontrollera dina
kontaktuppgifter".

### 8.4 Offline / Sync

Inga skrivande anrop händer från fältet i detta flöde — appen är passiv
mottagare. Notifikationer kommer in via `/api/mobile/notifications`-pull
(samma som tidigare) och behöver ingen offline-kö. Toggling av prefs
kan köas offline om så önskas men det är lågt prio.

---

## 9. TypeScript-typer (kopiera in i Traivo Go)

```typescript
type SchedulePublishingNotificationType =
  | 'schedule_published'
  | 'schedule_send_failed'
  | 'extra_job_sms'
  | 'cancel_job_sms';

interface SchedulePublishedData {
  dateRange: { start: string; end: string };
  totalJobs: number;
  channels: {
    email?: { success: boolean; error?: string; recipient?: string };
    sms?: { success: boolean; error?: string; recipient?: string };
  };
}

interface ExtraJobSmsData {
  reason: 'assigned' | 'rescheduled';
  phone: string;
  messageId?: string;
  error?: string;
}

interface CancelJobSmsData {
  phone: string;
  messageId?: string;
  error?: string;
}

interface ResourcePublishingFields {
  smsOnScheduleSend: boolean;
  smsOnExtraJob: boolean;
  lastSchedulePublishedAt: string | null;
  lastSchedulePeriodStart: string | null; // "YYYY-MM-DD"
  lastSchedulePeriodEnd: string | null;   // "YYYY-MM-DD"
}

interface NotificationPrefsRequest {
  smsOnScheduleSend?: boolean;
  smsOnExtraJob?: boolean;
}
```

---

## 10. Sammanfattning: Vad Traivo Go behöver bygga

| Nr | Funktion | Prioritet | Beskrivning |
|----|----------|-----------|-------------|
| 1 | "Min vecka"-statuspill | 🟠 Hög | Visa publiceringsstatus baserat på `lastSchedulePublishedAt` + period |
| 2 | Notifikations-typer (4 nya) | 🟠 Hög | Hantera ikon/färg/deeplink per typ i feeden |
| 3 | Inställnings-togglar (2) | 🟠 Hög | `PATCH /api/mobile/me/notification-prefs` på toggling |
| 4 | Pull-to-refresh på "Min vecka" | 🟡 Medium | Säkerställ att period-fälten uppdateras vid varje refresh |
| 5 | SMS-historik-vy | 🟢 Låg | Vänta på mobilversion av `/api/resources/:id/sms-history` |

---

## 11. Testscenarier

1. **Toggle off och försök publicera:** Sätt `smsOnScheduleSend=false`,
   låt planeraren skicka schemat — verifiera att INGEN SMS kommer men
   att `schedule_published`-notifikation ändå dyker upp om e-post gick fram.
2. **Extrajobb in i vecka:** Publicera v17, planeraren tilldelar nytt jobb
   med `scheduledDate` 2026-04-29 → verifiera SMS + `extra_job_sms`-notis.
3. **Extrajobb utanför vecka:** Publicera v17, tilldela jobb med datum
   2026-05-15 → verifiera att INGEN extrajobb-SMS skickas.
4. **Flytta jobb mellan tekniker:** Publicera v17 för Anna och Tomas,
   flytta ett jobb från Anna → Tomas → verifiera `cancel_job_sms` för Anna
   och `extra_job_sms` för Tomas.
5. **Toggle off extrajobb:** Anna sätter `smsOnExtraJob=false`, planeraren
   flyttar jobb från Anna → verifiera att Anna INTE får cancellation-SMS
   men att Tomas fortfarande får extrajobb-SMS.

---

## 12. Kontakt

Vid frågor om payload-fält, SMS-mallar eller filterregler för
publicerings-perioden, kontakta Traivo One backend-teamet. Server-koden
ligger i:

- `server/customer-notifications.ts` (schemautskick)
- `server/extra-job-sms.ts` (extrajobb + cancellation)
- `server/routes/mobile/preferences.ts` (PATCH-endpoint)
- `server/routes/resourceRoutes.ts` (admin SMS-historik)

*Dokumentet skrivet utifrån task #264 (publishing/extra-job) och task
#266 (sms-history per resurs).*
