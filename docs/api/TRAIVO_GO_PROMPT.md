# UPPDRAG: Gör Traivo Go 100 % kompatibel med Traivo One

> **Hur du använder filen:** Kopiera hela innehållet nedan och klistra in det som en
> prompt i Traivo Go-projektet. Den är förankrad i Traivo Ones faktiska mobil-API
> (`server/routes/mobile/*`), auth-modellen och v2-ordershapen. Källrapporter:
> `docs/traivo-go-api-match-report.md`, `docs/traivo-go-integration-rapport.md`,
> `docs/traivo-go-v2-handover.md`, `docs/api/MOBILE_API.md`.

---

Du arbetar i **Traivo Go** (den fristående mobil-fältappen). Målet är att Go ska vara
**100 % sammankopplad och i synk med backend Traivo One**. **Traivo One är sanningskälla**
— Go ska anpassa sig efter dess faktiska mobil-API, inte tvärtom. Implementera allt nedan.
Ändra inget som står som "RÖR EJ".

## 0. Grundregler (auth, versionering, tenant)
- All mobiltrafik går **enbart** mot `/api/mobile/*`. Vanliga `/api/*` (cookie-auth) fungerar **inte** med bearer-token → 401.
- **Versionering – RÖR EJ:** appen skriver redan om `/api/mobile/X` → `/api/v1/mobile/X`. Backend strippar `/api/v1` och routar internt. Detta är korrekt, ändra inget.
- **Auth:** `POST /api/mobile/login` med antingen `{ email, pin }` eller `{ username, password }` (PIN = 4–6 siffror). Svar innehåller `token`. Skicka `Authorization: Bearer <token>` på **alla** anrop. Token gäller **24 h**.
- **Tenant härleds server-side** från den inloggade resursen. Skicka **aldrig** tenant-id från klienten.

## 1. Detta matchar redan — RÖR EJ
Inloggning (`login`/`logout`/`me`), `push-token` (POST/DELETE), `status`, `my-profiles`, WS-token, ordrar (`my-orders`, `orders/:id`, `PATCH orders/:id/status`, `v2/orders/:id`), offline-sync (`POST /api/mobile/sync`, `GET /api/mobile/sync/status`), arbetspass (`work-sessions/*`), störnings-triggers, akutjobb (`jobs/urgent/*`), AI (`ai/chat`, `ai/transcribe`, `ai/analyze-image`), team, aviseringar, GPS (`position`), weather/distance/articles/break-config/route/route-feedback. **Ändra inget av detta.**

## 2. Åtta fixar för 100 % API-match — GÖR DESSA

**Kategori A – rena namnbyten i appen (enradare):**
1. `GET /api/mobile/app/config` → **`app-config`** (`useAppConfig.ts`).
2. `GET/PATCH /api/mobile/user/preferences` → **`preferences`** (GET/PUT/PATCH, 3 ställen i `usePreferences.ts`). Svaret är **inkapslat**: läs `data.preferences` (ej platt). Tillåtna PATCH-fält: `darkMode` (bool), `fontSize` (enum), `pushCategories` (objekt) m.fl.
3. `GET /api/mobile/notifications/unread-count` → **`notifications/count`** (2 ställen i `useNotifications.ts`, inkl. queryKey). Läs **`data.unreadCount`**.

**Kategori B – peka om appen (rekommenderat) eller bygg i backend:**
4. **GPS-batch:** ingen `position/batch` finns. Skicka batchen via befintlig sync (`POST /api/mobile/sync` med `actionType:"gps"`) **eller** loopa `POST /api/mobile/position` (`useGpsTracking.ts`).
5. **Ruttoptimering:** byt async-jobb + polling till **synkron `GET /api/mobile/route-optimized`** (`useRouteOptimization.ts`).
6. **Röstkommando:** använd `POST /api/mobile/ai/transcribe` (+ `ai/chat`) i stället för `ai/voice-command` (`useVoiceCommands.ts`).
7. **AI-stream:** falla tillbaka till `POST /api/mobile/ai/chat` (ingen stream-variant finns).
8. **Ruttmetrik:** ingen `route-metrics/today`. Använd `GET /api/mobile/statistics/summary` och/eller `GET /api/mobile/route-feedback/mine`.

## 3. Order v2 — adoptera (frozen / BOM / beroenden)
Använd **`GET /api/mobile/v2/orders/:id`** (fall tillbaka till v1 vid 4xx/5xx):
- **`frozen`:** när `isFrozen=true` → visa låsikon + använd `totalPrice` (räkna inte från rader). Material-/foto-tillägg är OK men visa **"påverkar inte fakturasumma — frusen WO"**.
- **`bomChecklist`:** materialkälla per strukturartikel. Visa `totalRequired` (det upplösta antalet), **aldrig formeln**. Behandla v1:s `subSteps` som **legacy**.
- **`dependencyStatus` + `canStart` + `blockedBy`:** när `canStart=false` → **disabla "Starta jobb"**, visa "Väntar på: `<orderTitle>`" (länk till föregångaren). Tillåt ändå **"På väg"** och navigation.

## 4. Nya artikel-fält (LIVE på `articles[]` i v1 + v2) — bygg fält-rapportering
- **`files[]`** `{name,url,type}` – instruktioner/PDF, visa som bilagor.
- **`reportingType`** (`antal|status|foto|fotogalleri|text|null`) – styr inmatningen vid utförande.
- **`reportingMetadataField`** – vart värdet skrivs (metadata-nyckel). Se metadata-fallgropar §8.
- **`shouldBeReturned`** (bool) – trigga "ta med tillbaka / pant"-moment.
- **`productionTimeMinutes` / `productionTimeSource`** (`resource|list|article`) – effektiv produktionstid.
- **Föruppgifter:** `isPreTask`, `parentWorkOrderId`, `dependencyOffsetMinutes` (t.ex. −2880 = 2 dygn före). Markera tydligt (badge) och koppla visuellt till huvuduppgiften.

## 5. Säkerhet — obligatoriskt
- **Endast `/api/mobile/*`.** Anropa **aldrig** webb-rutterna `/api/checklist*`, `/api/quick-action` eller `/api/ai/*` (de är nu planner/admin-låsta). Använd mobil-varianterna: `GET|POST /api/mobile/orders/:id/checklist`, `POST /api/mobile/quick-action`, `POST /api/mobile/ai/*`.
- Skicka aldrig tenant från klienten; lita på serverns resursbindning.

## 6. UX-semantik som MÅSTE stämma med Traivo One
- **"Utförd ≠ fakturerad":** en klar order kan vara `held`/bromsad/samlingsfaktura och ännu inte fakturerad. Visa aldrig "fakturerad" bara för att jobbet är utfört.
- **Fryst pris/mottagare:** fält-tillägg ändrar inte fakturasumman — kommunicera det i UI.

## 7. Design- & ergonomi-paritet (samma känsla som Traivo One)
- **Palett (Traivo):** Deep Ocean Blue `#1B4B6B`, Arctic Ice `#E8F4F8`, Mountain Gray `#6B7C8C`, Northern Teal `#4A9B9B`, Midnight Navy `#2C3E50`, Aurora Green `#7DBFB0`. **Font:** Inter. Språk: **svenska**.
- **Ljust + mörkt läge** med en **lätt åtkomlig läge-knapp i appens header** (måne/sol). Valet ska sparas.
- **Ingen ren vit (`#FFF`) på stora ytor** i ljust läge — använd lugn off-white (mindre glare). I mörkt läge: nära-svart blå-tonad bakgrund + **mjuk off-white text** (ej ren vit).
- **Status alltid med både färg OCH text** (färgblindhet).
- **Kritisk info läsbar:** order-ID och tidsfönster i tillräcklig storlek (undvik ~10px för viktigt innehåll — sol/skakande hytt). Respektera systemets textskalning.
- **Batteri:** undvik konstant high-accuracy GPS var 15:e sekund — använd adaptiv takt (sakta vid stillastående/lågt batteri) + batterivarning för 10-timmarspass.
- **Komprimera foton före uppladdning** (spara batteri/data; servern avvisar för stora filer).

## 8. Metadata-fallgropar (om Go läser/skriver metadata)
- **Två parallella system** (engelskt `metadataDefinitions`/`objectMetadata` vs svenskt `metadataKatalog`/`metadataVarden`) — **inte** synkade. Kolla vilket en endpoint träffar.
- **`metod`** `system|tjanst|utforande` är **read-only** (auto). Writeback vid utförande måste sättas med rätt `metod`.
- **Sammansatta fält** (`fält.underfält`) grupperas till **ett** JSON-fält — behandla som objekt.
- Artiklar kopplar metadata **via NAMN, inte id** — exakt namn-matchning (`antal` ≠ `antal_matavfall`).

## 9. Klart-definition (Definition of Done)
- [ ] De 8 avvikelserna i §2 åtgärdade.
- [ ] `GET /api/mobile/v2/orders/:id` i bruk med fallback till v1.
- [ ] Start-knappen gateas på `canStart`; föruppgifter visas.
- [ ] Inga webb-rutter (`/api/checklist*`, `/api/quick-action`, `/api/ai/*`) anropas.
- [ ] Bearer-auth + `/api/v1`-prefix orört och fungerar.
- [ ] Design-paritet: Traivo-palett, Inter, ljust/mörkt med läge-knapp, off-white ytor, status med färg+text.
- [ ] "Utförd ≠ fakturerad" och "fryst pris" kommuniceras korrekt i UI.
