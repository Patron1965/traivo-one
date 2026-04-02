# Traivo GO — Teknisk rapport efter KINAB-dataimport

**Datum:** 2026-04-02 (uppdaterad)
**Gäller:** Traivo GO mobilapp (Driver Core)
**Kontext:** KINAB:s produktionsdata har importerats från Modus 2.0

---

## 1. Sammanfattning

KINAB:s fullständiga produktionsdata har importerats till Traivo-plattformen:

| Data | Antal |
|------|-------|
| Kunder | 964 |
| Objekt | 45 349 |
| Arbetsordrar | 35 631 |
| Metadata-värden | 82 024 |
| Resurser | 12 |

Historiska ordrar (35 320 st) har markerats som **utförda** (`utford`). **311 ordrar** är kvar som aktiva med status `skapad`.

---

## 2. API-ändringar gjorda efter GO-teamets synkrapport

### 2.1 Nya fält i API-svar — `articles`-array med `resolvedPrice`

GO-teamet efterfrågade `resolvedPrice` per artikelrad. Traivo One har nu uppdaterat följande endpoints:

**`GET /api/mobile/orders/:id`** — Nytt fält `articles`:
```json
{
  "articles": [
    {
      "id": "uuid",
      "articleId": "uuid",
      "articleNumber": "KT-001",
      "articleName": "Kärltvätt Standard",
      "quantity": 13,
      "resolvedPrice": 15656,
      "resolvedCost": 0
    }
  ],
  "cachedValue": 99000,
  "cachedCost": 15000,
  "cachedProductionMinutes": 0,
  "completedAt": "2025-06-15T00:00:00.000Z"
}
```

**`enrichOrderForMobile` (används av sync och andra endpoints)**:
- Samma `articles`-array med `resolvedPrice` och `resolvedCost`
- Explicit `cachedValue`, `cachedCost`, `cachedProductionMinutes` och `completedAt`

### 2.2 Bekräftade fält i `GET /api/mobile/my-orders`

Endpoint returnerar `...order` (spread) vilket inkluderar:
- `cachedValue` (öre) ✅
- `cachedCost` (öre) ✅
- `cachedProductionMinutes` ✅
- `completedAt` ✅
- `orderStatus` ✅

---

## 3. Synkverifiering mot GO-rapporten

### 3.1 Prisformatering (öre → kronor) — BEKRÄFTAT

| Fält | Enhet | Exempel | Finns i API |
|------|-------|---------|-------------|
| `cachedValue` | öre | 15656 = 156,56 kr | ✅ my-orders, orders/:id |
| `cachedCost` | öre | 10500 = 105,00 kr | ✅ my-orders, orders/:id |
| `resolvedPrice` | öre | 85000 = 850,00 kr | ✅ orders/:id → articles[] |
| `resolvedCost` | öre | 0 | ✅ orders/:id → articles[] |

GO:s `formatPrice()` som dividerar med 100 är korrekt.

### 3.2 Tidsvisning — cachedProductionMinutes: 0 — BEKRÄFTAT

- Alla importerade KINAB-ordrar har `cachedProductionMinutes: 0`
- GO:s hantering (visa "Ej angiven" istället för "0 min") är korrekt
- Fältet returneras i API-svaren ✅

### 3.3 Status "utford" — BEKRÄFTAT

GO:s filter "Klar" inkluderar `utford`, `completed`, `avslutad`, `fakturerad` — detta stämmer med Traivo One:

| GO-status | Traivo One-status | Kommentar |
|-----------|-------------------|-----------|
| `completed` | `utford` | GO skickar "completed", backend mappar till "utford" |
| `utford` | `utford` | Direktmappning fungerar |
| `fakturerad` | `fakturerad` | Steg efter utförd |
| `avslutad` | - | Finns ej i Traivo One, men är ofarlig som klient-filter |

De 35 320 historiska ordrarna med `utford` + `completedAt` syns korrekt i "Klar"-filtret ✅

### 3.4 Artikeldata i API-svar — ÅTGÄRDAT

**Tidigare:** `resolvedPrice` returnerades **inte** i mobil-API:erna.
**Nu:** Nytt `articles`-fält med komplett data (se 2.1 ovan).

GO-teamet kan nu använda `articles[]` för att visa artikelinformation med pris.

---

## 4. Fullständig API-kompatibilitetsmatris

| Endpoint | Status | Kommentar |
|----------|--------|-----------|
| `GET /api/mobile/my-orders` | ✅ OK | Inkluderar cachedValue, cachedCost, cachedProductionMinutes |
| `GET /api/mobile/orders/:id` | ✅ UPPDATERAD | Nytt `articles[]`-fält med resolvedPrice/resolvedCost |
| `PATCH /api/mobile/orders/:id/status` | ✅ OK | Hanterar utford, completed, avbruten, ej_utford |
| `POST /api/mobile/sync` | ✅ OK | enrichOrderForMobile inkluderar nu articles + cachedValue |
| `GET /api/mobile/statistics/summary` | ✅ OK | Räknar utford-ordrar korrekt |
| `GET /api/mobile/orders/:id/dependencies` | ✅ OK | Läser orderStatus från beroende ordrar |
| `GET /api/mobile/preferences` | ✅ OK | Opåverkad |
| `GET /api/mobile/app-config` | ✅ OK | Opåverkad |
| `GET /api/mobile/version-check` | ✅ OK | Opåverkad |

---

## 5. Statusövergångar — referens

```
skapad → planerad_pre → planerad_resurs → planerad_las → utford → fakturerad
```

GO-mappning:
- `"started"` / `"en_route"` → `planerad_resurs`
- `"completed"` / `"utford"` → `utford` (sätter `completedAt`)
- `"deferred"` / `"ej_utford"` → `skapad` (återställer)
- `"cancelled"` / `"avbruten"` → `avbruten`

---

## 6. Kvarvarande rekommendationer

### Hög prioritet
1. **Verifiera prisvisning** — GO:s `formatPrice()` dividerar med 100, bekräftat korrekt.
2. **Testa `articles`-arrayen** — Ny data i `/api/mobile/orders/:id`, verifiera att OrderDetail renderar korrekt.

### Normal prioritet
3. **Historikvy-paginering** — Med 35 320 utförda ordrar, överväg paginering i orderlistan vid "Klar"-filter.
4. **Offlinesynk-volym** — Med 45 349 objekt, säkerställ att IndexedDB klarar datamängden.

### Låg prioritet
5. **Metadata-visning** — 82 024 metadata-värden tillgängliga. GO kan visa dessa som extra info.

---

## 7. Kontaktinformation

Frågor om API-ändringar eller dataformat — kontakta Traivo-plattformsteamet.
