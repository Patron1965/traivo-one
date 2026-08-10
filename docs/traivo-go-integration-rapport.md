# Traivo Go ↔ Traivo One — Integrationsrapport

**Syfte:** Allt mobilappen (Traivo Go) behöver veta för att fungera bra ihop med
Traivo One — uppdaterad med allt som byggts sedan `traivo-go-v2-handover.md`.

**Status:** Backend live i Traivo One (KINAB-pilot i prod).
**Brytande ändringar mot mobilen:** Se §2 (säkerhetshärdning) — några **webb**-rutter
som tekniker tidigare kunde nå är nu planner/admin-låsta. Mobilens egna
`/api/mobile/*`-rutter är **oförändrade**.

> Läs först `docs/traivo-go-v2-handover.md` (frozen-pris, BOM-checklista,
> beroende-status på `GET /api/mobile/v2/orders/:id`). Denna rapport bygger
> vidare på den och beskriver vad som tillkommit.

---

## 1. Två auth-modeller — viktig grundförståelse

Det finns **två olika "mobila" klienter** i Traivo, och de autentiserar olika:

| Klient | Auth | Tenant-kontext | Endpoints |
|---|---|---|---|
| **Traivo Go** (fristående app) | **Bearer-token** (`isMobileAuthenticated`, slås upp mot `mobile_tokens`) | `req.mobileTenantId` / härleds från resursen | `/api/mobile/*` |
| **SimpleFieldApp** (mobil-UI i webbsession) | **Cookie / Replit Auth** | normal tenant-middleware (`req.tenantId`) | både `/api/mobile/*` och vanliga `/api/*` |

**Konsekvens för Go-appen:**
- Använd **enbart `/api/mobile/*`**. Dessa är de enda rutter som förstår
  bearer-token och härleder tenant från resursen.
- `/api/mobile/*` går **utanför** den normala tenant-middleware. En handler där
  läser **aldrig** `req.tenantId` — den använder `req.mobileTenantId` eller
  härleder tenant från den autentiserade mobil-resursen. Det betyder också att
  vanliga `/api/*`-rutter (cookie-auth) **inte** fungerar med en bearer-token.
- Om Go behöver data som bara finns på en cookie-auth-rutt (t.ex.
  `GET /api/objects/:id/display-names`, "släktnamn"), be backend-teamet om en
  `/api/mobile/*`-variant — annars 401.

---

## 2. Säkerhetshärdning — vad som kan slå mot mobilen (BRYTANDE på webb-rutter)

En säkerhetsgenomgång har **låst flera webb-rutter** bakom `requirePlanner`
(roll owner/admin/planner) eller lagt till `isAuthenticated`. Tekniker med
bearer-token **kan inte längre nå dessa** — de ska använda mobil-motsvarigheten.

| Tidigare öppen webb-rutt | Nytt krav | Mobil-ersättning för tekniker |
|---|---|---|
| `POST /api/quick-action` | `requirePlanner` | **`POST /api/mobile/quick-action`** |
| `POST /api/checklist/:workOrderId/items` | `requirePlanner` | `POST /api/mobile/orders/:id/checklist` (bocka av befintliga) |
| `POST /api/checklist/:workOrderId/generate` | `requirePlanner` | (planner-förberedelse — ej tekniker) |
| `GET /api/checklist/:workOrderId` | `requirePlanner` | `GET /api/mobile/orders/:id/checklist` |
| `GET/POST/PATCH /api/checklist-templates*` | `isAuthenticated` (+`requirePlanner` på write) | läs via `GET /api/mobile/orders/:id/checklist` |

**Åtgärd för Go:** Om appen någonstans anropar `/api/checklist*` eller
`/api/quick-action` direkt — byt till `/api/mobile/*`-varianten. Allt
tekniker-flöde ska gå via `/api/mobile/*`.

Utöver detta är hela AI/kund-kommunikations-kontrollplanet (`/api/ai/*`:
planning-suggestions, eta-check-delays, communications, field-assistant,
apply-setup-updates m.fl.) nu `requirePlanner`. Dessa är **inte** mobil-rutter,
men nämns så att ingen försöker nå dem från Go. Mobilens egna AI-rutter
(`/api/mobile/ai/chat|transcribe|analyze-image`) är oförändrade.

---

## 3. Ny data på order/artikel som mobilen bör visa

Sedan v2-handovern har work order- och artikel-modellen fått flera fält som är
relevanta i fält. De flesta exponeras nu på mobil-rutterna (markerat **[LIVE]**);
enstaka fält surfar bara delvis och kan behöva en framtida v2/v3-utökning
(markerat per avsnitt).

### 3.1 Frozen-pris (recap, v2)
Oförändrat sedan v2-handovern: `frozen.{isFrozen, quantity, unitPrice, unitCost,
unitTime, totalPrice, frozenAt}` på `GET /api/mobile/v2/orders/:id`. När fryst:
visa låsikon + `totalPrice`; material/foto-tillägg påverkar **inte** fakturasumman.

### 3.2 BOM-checklista (recap, v2) — och varning om gammal v1-väg
`bomChecklist` på v2 är källan för komponentlistor (byggd från
`article_components`). **OBS:** v1-detaljens `subSteps` byggs fortfarande från det
**gamla** `structuralArticleId` / `getStructuralArticlesByParent`-spåret. De
fysiska `structure_articles*`-tabellerna är borttagna (registret är nu en vy över
`articles(isStructure)` + `article_components`). Lita därför på **v2 `bomChecklist`**
för material/struktur — behandla v1 `subSteps` som legacy.

### 3.3 Föruppgifter & beroenden (utökat)
- `dependencyStatus` + `canStart` + `blockedBy` (v2) styr om "Starta jobb" ska
  vara aktiv. Recap: blockerad order → disable start, visa "Väntar på: <titel>",
  tillåt ändå "På väg"/navigation.
- **Nytt begrepp — Föruppgift:** En uppgift räknas som föruppgift (`isPreTask`)
  när artikeltypen är `"beroende"` **eller** offset-minuter är negativt.
  Genererade work orders bär `isPreTask` och `parentWorkOrderId`, plus
  `dependencyOffsetMinutes` (t.ex. −2880 = 2 dygn före huvuduppgiften).
  **UI-rekommendation:** Markera föruppgifter tydligt (t.ex. "Föruppgift"-badge)
  och koppla dem visuellt till sin huvuduppgift via `parentWorkOrderId`.

### 3.4 Artikel-fält för fält-arbete **[LIVE — exponerat på mobil]**
Dessa exponeras nu på `articles[]` i **både** `GET /api/mobile/orders/:id` (v1)
och `GET /api/mobile/v2/orders/:id`. Artikelobjektet innehåller utöver
`id/articleId/articleNumber/articleName/quantity/resolvedPrice/resolvedCost`:

- **`files`** — `{name, url, type}[]`: instruktioner/PDF/monteringsguider för
  artikeln. Bör visas som nedladdnings-/visningsbara bilagor i jobbvyn.
  (Tom array `[]` när inga filer finns.)
- **`reportingType`** — *vad* teknikern ska rapportera (`antal` | `status` |
  `foto` | `fotogalleri` | `text`, eller `null`). Styr vilken inmatning som ska
  visas vid utförande.
- **`reportingMetadataField`** — *vart* det rapporterade värdet sparas (vilken
  metadata-nyckel på objektet, eller `null`). Driver dynamisk
  återrapportering/writeback. **OBS metadata-fallgropar i §6** vid skrivning.
- **`shouldBeReturned`** — boolean: artikeln ingår i ett retur-/pantflöde. Bör
  trigga ett "ta med tillbaka / pant"-moment i fält.

`defaultMetadataAssociation` (vilket metadatafält artikeln "hakar fast på" som
standard) är planeringslogik och exponeras medvetet **inte** på mobil — säg till
om Go behöver det som kontext.

### 3.5 Komponent-nivå (`article_components`) **[surfar delvis]**
- **`quantityFormula`** — formel (t.ex. `metadata.antal * 2`) som skalar
  komponent-antalet utifrån objektets metadata. Det **upplösta** antalet hamnar i
  v2 `bomChecklist.items[].totalRequired` — visa det, inte formeln.
- **`reportingType` / `reportingMetadataField`** på komponent överskuggar
  artikelns för just den delen.

### 3.6 Produktionstid / ställtid **[LIVE — exponerat på mobil]**
Produktionstider-registret (`production_time_lists`) är **avvecklat** —
artikelns eget tidsfält (`articles.productionTime`, minuter per enhet) är den
enda källan för planerad grundtid. Fälten på `articles[]` (v1 + v2) kvarstår:

- **`productionTimeMinutes`** — artikelns produktionstid i minuter (eller `null`).
- **`productionTimeSource`** — `"article"` när artikeln har tid, annars `null`.
  (Värdena `"resource"`/`"list"` förekommer inte längre.)

Framtida utförar-/utrustningsvariationer hanteras som kapacitetsfaktor ovanpå
artikelns grundtid, inte som fristående register.

---

## 4. Orderkoncept-genererade order — nya beteenden mobilen bör känna till

Order skapas i allt högre grad av **orderkoncept-wizarden** (9 steg). Koncepten
bär nya fält som påverkar de genererade ordrarna:

- **`invoiceBrake` (Faktureringsbroms):** Säkerhetsspärr som hindrar att order
  från konceptet auto-faktureras (t.ex. vid avvikelser). Tillsammans med
  faktureringsbroms/held-logiken nedan: en order kan vara klar i fält men **inte**
  redo att faktureras. Mobilen ska aldrig anta att "utförd = fakturerad".
- **`intervalFlexDays` (± flexdagar):** Planeringsfönster ±N dagar runt
  måldatumet som ruttoptimeringen får flytta jobbet inom. Förklarar varför ett
  intervall-jobb kan landa på olika veckodagar mellan perioder.
- **Leveransrestriktioner (soft/hard):** Strukturerade metadata-villkor
  `{type:'soft'|'hard', metadataKey, operator, filterValue}`. **Hard** blockerar
  schemaläggning (vissa dagar/månader), **soft** ger varning i planeraren.
  Enforce sker i web-planerare/VRP — men om Go visar "varför är jobbet denna dag"
  är detta förklaringen.
- **`customerMetadataField` (FROM_METADATA-läge):** Kunden härleds per objekt från
  ett metadatafält i stället för att vara hårdkodad på konceptet. Påverkar vilken
  `customer` som dyker upp på ordern.

Dessa fält ligger på `order_concepts` (web/genereringstjänst) och surfar **inte**
direkt på `/api/mobile/*` — men deras *effekter* (datum, kund, fakturastatus) syns
på ordern.

---

## 5. Fakturering & frysning — vad fält-tillägg gör (och inte gör)

Mobilen lägger ofta till material/foton/anteckningar. Viktigt att kommunicera rätt
i UI:t kring fakturapåverkan:

- **Fryst WO** (`frozen.isFrozen=true`): pris/tid låsta server-side. Material-Log
  och Field Report **får** lägga till artiklar lokalt, men Go ska visa
  "påverkar inte fakturasumma — frusen WO".
- **Faktureringsbroms / samlingsfaktura:** En WO har internt en kö-status
  (NULL / `held` / `pending` / `consolidated` / `exported`). En utförd order kan
  vara **`held`** (väntar på periodslut) eller bromsad och därmed inte faktureras
  ännu. Fortnox-export refuserar held/bromsade WO. → "utförd" i fält betyder inte
  att den gått till faktura.
- **Fryst fakturamottagare:** Vid frysning låses även fakturamottagaren på WO.
  Ingen mobil-åtgärd, men förklarar varför mottagaren kan skilja sig från
  objektets nuvarande kund.

---

## 6. Metadata — fallgropar som påverkar återrapportering

Om Go börjar läsa/skriva metadata (t.ex. via `reportingMetadataField`):

- **Två parallella metadata-system:** engelskt (`metadataDefinitions` +
  `objectMetadata`) och svenskt (`metadataKatalog` + `metadataVarden` +
  `metadataHistorik`). De är **inte** synkade. Importen skriver det svenska,
  delar av exporten läser det engelska. Kolla alltid vilket system en endpoint
  faktiskt träffar innan du bygger på det.
- **Värde-ursprung (`metod`):** `system` / `tjanst` / `utforande` är **read-only**
  (auto-genererade). Tjänst-writeback vid utförande (artikel → metadata) ska
  sättas med rätt `metod` så det inte räknas som manuellt. Manuella skrivningar
  blockeras mot read-only-ursprung och `isSystem`-fält.
- **Sammansatta fält (punktnotation):** `fält.underfält`-kolumner grupperas till
  **ett** JSON-fält (`varde_json`). Behandla dem som ett objekt, inte som
  separata fält.
- **Artiklar kopplar metadata via NAMN, inte id** (text-kolumner mot
  `metadata_katalog.namn`). Var noga med exakt namn-matchning för att undvika
  generiska kollisioner (`antal` vs `antal_matavfall`).

---

## 7. Nya register som ännu **inte** finns på mobilen (FYI)

Byggt i "Session 11", endast web/admin idag:
- **Leverantörsregister** (`suppliers`) + **leverantörskopplingar**
  (`supplier_article_links`: `supplierArticleNumber`, `leadTimeDays`,
  `purchasePrice` i **öre**). Inköp/inköpsportal.
- **Produktionstidslista** (`production_time_lists`), se §3.6.
- **Strukturartikelregister** — register-yta över befintliga
  `articles(isStructure)` + `article_components` (inga nya fysiska tabeller).

Säg till om något av detta behöver exponeras mot Go.

---

## 8. Komplett mobil-endpoint-karta (nuläge)

Alla nedan kräver `isMobileAuthenticated` (bearer) om inget annat anges. Tenant
härleds från resursen / `req.mobileTenantId`.

**Auth & profil:** `POST /api/mobile/login` (ingen auth, härleder tenant) ·
`POST /api/mobile/logout` · `GET /api/mobile/me` ·
`POST /api/mobile/notifications/token` · `GET /api/mobile/app-config` ·
`GET /api/mobile/version-check` · `GET /api/mobile/terminology` ·
`GET /api/mobile/preferences` · `PUT|PATCH /api/mobile/preferences` ·
`PATCH /api/mobile/me/notification-prefs`

**Order:** `GET /api/mobile/my-orders` · `GET /api/mobile/orders/:id` ·
**`GET /api/mobile/v2/orders/:id`** (frozen/BOM/beroenden) ·
`PATCH /api/mobile/orders/:id/status` · `POST /api/mobile/orders/:id/notes` ·
`POST /api/mobile/orders/:id/photos` ·
`GET|POST /api/mobile/orders/:id/checklist` ·
`GET /api/mobile/orders/:id/time-entries` ·
`POST /api/mobile/orders/:id/customer-signoff` ·
`POST /api/mobile/work-orders/carry-over` ·
`POST /api/mobile/work-orders/:id/auto-eta-sms` · `POST /api/mobile/quick-action`

**Tid & sessioner:** `POST /api/mobile/work-sessions/start` ·
`GET /api/mobile/work-sessions/active` ·
`POST|PATCH /api/mobile/work-sessions/:id/{stop,pause,resume}` ·
`POST /api/mobile/work-sessions/:id/entries` · `GET /api/mobile/time-summary` ·
`GET /api/mobile/time-entries` · `PATCH /api/mobile/time-entries/:id`

**Position & rutt:** `POST /api/mobile/position` · `POST /api/mobile/gps` ·
`POST /api/mobile/status` · `GET /api/mobile/route` ·
`GET /api/mobile/route-optimized` · `POST /api/mobile/distance[/batch]` ·
`GET /api/mobile/break-config` · `POST /api/mobile/disruptions/trigger/*`

**Team:** `GET /api/mobile/my-profiles` · `GET /api/mobile/my-team` ·
`POST /api/mobile/teams` · `POST /api/mobile/teams/:id/invite` ·
`POST /api/mobile/teams/:id/accept` · `POST /api/mobile/teams/:id/leave` ·
`DELETE /api/mobile/teams/:id` · `GET /api/mobile/resources/search`

**Notiser & feedback:** `GET /api/mobile/notifications` ·
`PATCH|POST /api/mobile/notifications/:id/read` ·
`PATCH|POST /api/mobile/notifications/read-all` ·
`GET /api/mobile/notifications/count` · `POST|DELETE /api/mobile/push-token` ·
`GET /api/mobile/route-feedback/mine` · `POST /api/mobile/route-feedback` ·
`GET /api/mobile/eta-notification/{history,config}`

**AI & övrigt:** `POST /api/mobile/ai/chat` · `POST /api/mobile/ai/transcribe` ·
`POST /api/mobile/ai/analyze-image` · `GET /api/mobile/summary` ·
`GET /api/mobile/statistics/summary` · `GET /api/mobile/weather` (ingen auth)

---

## 9. Rekommenderade nästa steg för Go-teamet

1. **Verifiera att inga `/api/checklist*` eller `/api/quick-action` anropas
   direkt** (se §2) — byt till `/api/mobile/*`.
2. **Gå över till v2 `bomChecklist`** för material/struktur; behandla v1
   `subSteps` som legacy (§3.2).
3. **Visa föruppgifter** (`isPreTask` / `parentWorkOrderId`) och håll start-gaten
   på `canStart` (§3.3).
4. **Bygg fält-rapportering** mot de nya artikel-fälten — `files`,
   `reportingType`, `reportingMetadataField`, `shouldBeReturned` och
   `productionTimeMinutes` är nu LIVE på `articles[]` (v1 + v2), se §3.4 + §3.6.
5. **Kommunicera fakturastatus rätt:** "utförd ≠ fakturerad" pga
   frysning/broms/samlingsfaktura (§5).

**Kontakt:** Backend-teamet (Traivo One). Pinga oss för v2/v3-utökningar av fler
endpoints eller fält.
