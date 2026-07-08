# Traivo Go — Att göra (överlämning från Traivo One-backendteamet)

> **Kopiera in den här filen i Traivo Go-projektet** (t.ex. som `TODO.md` eller `docs/att-gora.md`).
> Den är en självständig arbetslista: allt du behöver för att göra appen 100 % i synk med
> backenden **Traivo One**, plus de nya funktioner backend redan stödjer.
>
> **Källa till sanning:** Traivo One:s faktiska mobil-routes (`server/routes/mobile/*`), verifierat 2026-07-08.
> **Auth:** alla anrop går mot `/api/mobile/*` med **Bearer-token**. Appen skriver redan automatiskt
> om `/api/mobile/X` → `/api/v1/mobile/X` (`client/lib/query-client.ts` → `toV1Path`). **Rör inte den
> versions-omskrivningen** — den är korrekt.
> **Referensimplementation:** Traivo One:s in-repo-app `SimpleFieldApp.tsx` anropar redan alla nya
> endpoints nedan. Är du osäker på svarsform eller flöde — titta där.

---

## Snabböversikt — i prioordning

1. **Del A – Direkta namnbyten (3 st, enradare).** Fixa nu, ingen backend behövs. → ~1 h.
2. **Del B – Nya funktioner backend redan stödjer.** Antal i fält, metadata-gruppering,
   klarmarkering, terminologi. Bygg när ni tar nästa release.
3. **Del C – De 5 "beslut krävs"-avvikelserna (#4–#8).** Standard = peka om appen (billigast).
4. **Del D – KRITISKT: identifierare som ALDRIG får bytas.** Läs innan ni rör branding/lagring.
5. **Del E – Design-paritet.** Kopiera statusfärger/tokens/font så appen ser ut som kontoret.
6. **Del F – Öppna beslut (väntar på produktägaren).** Bygg inte förrän dessa är avgjorda.

---

## Del A — Direkta API-namnbyten (fixa i appen, inga beslut)

| # | Appen anropar idag | Ska anropa | Fil i Go | Att tänka på |
|---|---|---|---|---|
| 1 | `GET /api/mobile/app/config` | `GET /api/mobile/app-config` | `client/hooks/useAppConfig.ts` | ren sökvägsändring |
| 2 | `GET`+`PATCH /api/mobile/user/preferences` | `GET`/`PUT`/`PATCH /api/mobile/preferences` | `client/hooks/usePreferences.ts` (3 ställen) | svar är **inkapslat** → läs `data.preferences` |
| 3 | `GET /api/mobile/notifications/unread-count` | `GET /api/mobile/notifications/count` | `client/hooks/useNotifications.ts` (2 ställen, inkl. `queryKey`) | svar `{ unreadCount: number }` → läs `data.unreadCount` |

**Svarsformer att matcha:**
- **#2 preferences:** `{ "preferences": { darkMode, fontSize, … } }` (inte platt objekt). Tillåtna PATCH-fält:
  `darkMode` (bool), `fontSize` (enum), `pushCategories` (objekt) m.fl.
- **#3 count:** `{ "unreadCount": number }`.

- [ ] #1 `useAppConfig.ts`: `app/config` → `app-config`
- [ ] #2 `usePreferences.ts`: `user/preferences` → `preferences` (3 st) + läs `data.preferences`
- [ ] #3 `useNotifications.ts`: `notifications/unread-count` → `notifications/count` (2 st) + läs `data.unreadCount`

---

## Del B — Nya funktioner backend redan stödjer

### B1. Antal i fält (den gamla handboken sa "går inte att ändra" — det stämmer inte längre)

**Datakälla:** `GET /api/mobile/tasks/:id/metadata-context` → `orderArticles[]` (en rad per orderrad).
Rita antals-UI **utan egen logik** — servern skickar färdiga flaggor:

| Fält | Betydelse |
|---|---|
| `lineId`, `articleId`, `articleName`, `articleNumber` | radidentitet |
| `quantity`, `quantityUnit` | fakturerat/beställt antal |
| `quantityMode` | hur antalet styrs (`per_styck`/`matches_field`/formel/fast) |
| `hideQuantityInApp` | **true = dölj antalet** (fast/härlett — används automatiskt ändå) |
| **`editableQuantity`** | **true = visa redigerbar antals-ruta** (fakturerat antal) |
| `shouldBeReturned`, `hasStockLocation` | retur-/pantflöde + om artikeln kan ruttas till lager |
| `takenQuantity`, `wasteQuantity`, `returnedQuantity`, `quantityReconciliationNote` | taget antal + härledd svinn/retur |
| **`takenQuantityEditable`** | **true = tillåt registrering av taget antal** |

**Skriv tillbaka:**
- `POST /api/mobile/tasks/:id/quantity-update` — `{ lineId, quantity }`. Justerar **fakturerat** antal.
  Tillåts **endast** när `editableQuantity=true`. Servern skriver tillbaka på två ställen och räknar om totaler.
- `POST /api/mobile/tasks/:id/taken-quantity-update` — `{ lineId, takenQuantity, note? }`. Registrerar
  **verkligt taget/förbrukat** antal (svinn/retur). Rör aldrig det fakturerade antalet. Tillåts när
  `takenQuantityEditable=true`.

**Regler (viktigt):**
- Visa **högst EN** antalskontroll per rad. Rita redigerbart fält **bara** när `editableQuantity=true`;
  dölj helt när `hideQuantityInApp=true`.
- Bygg **ingen** egen "får jag redigera?"-logik — allt (metadata-styrt, fält valt, artikel aktiv, ej dold,
  ej fakturalåst) avgörs server-side och speglas i flaggan.
- "Taget antal" är en **separat, valfri** registrering — håll den åtskild från antalsjusteringen i UI:t.
- **Fakturalås = allt read-only.** När ordern är `consolidated`/`exported` blir båda flaggorna `false`.
  Rita read-only — servern avvisar annars.

- [ ] Ta bort ev. antagande om att antal inte kan ändras i fält.
- [ ] Antals-UI via `metadata-context` (redigerbart endast vid `editableQuantity`, dölj vid `hideQuantityInApp`, read-only vid fakturalås) + skriv via `quantity-update`.
- [ ] (Bör) "Taget antal" via `taken-quantity-update`.

### B2. Metadata i fält — familj-gruppering

`metadata-context` returnerar även `showMetadataFields[]` ("visa aktuellt värde") och
`leaveMetadataFields[]` ("lämna in nytt värde vid utförande").

| `showMetadataFields[]` | `leaveMetadataFields[]` |
|---|---|
| `articleId`, `articleName`, `metadataField`, `groupField` | `articleId`, `articleName`, `metadataField`, `groupField` |
| `clarification`, `canUpdate` | `instruction`, `required` |
| `currentValue`, `displayValue` | `currentValue`, `displayValue` |

**Skriv tillbaka:** `POST /api/mobile/tasks/:id/metadata-update` —
`{ articleId, metadataLabel, newValue, inspectionStatus?, inspectionComment?, inspectionPhoto? }`.

**Regler:**
- **Gruppera på `groupField`** (t.ex. "Kontakt") i stället för en lång platt lista.
- **Skicka alltid barnets `metadataField`, aldrig grupp-förälderns** — föräldern har inget värde och
  skrivningen avvisas.
- Obligatoriska `leaveMetadataFields` (`required=true`) **blockerar klarmarkering** (se B4, 400-flödet).
- Behandla systemgenererade/härledda värden som **read-only**; erbjud skrivning bara där `canUpdate`/
  `required` säger det.
- Bara **det svenska metadata-systemet** finns kvar — det gamla engelska är borttaget. Mobil-ytan skriver
  alltid svenska; fundera inte längre på "vilket system" en endpoint träffar.

- [ ] Gruppera metadata på `groupField`; skicka barnets `metadataField` vid skrivning.
- [ ] Behandla systemgenererade/härledda metadatavärden som read-only.

### B3. Föraren ser BARA `work_orders` (grundregel som förenklar appen)

- Backend skapar arbete via **orderkoncept** (abonnemang/schema) och **avrop** (call_off). Dessa landar i
  `assignments` och/eller `work_orders`. **Alla mobil-order-endpoints läser bara `work_orders`.**
- En uppgift syns i fält **först när den finns som work_order**. Uppgifter som bara ligger i `assignments`
  (inkl. avrop) är medvetet osynliga tills en projektion sker — det är **inte** ett appfel.

- [ ] Lita **enbart** på mobil-order-endpoints (`my-orders`, `orders/:id`, `v2/orders/:id`). Bygg **ingen**
      egen hämtning av orderkoncept eller avrop.

### B4. "Utförd ≠ fakturerad" + klarmarkering

- En utförd order kan vara **fryst** (`frozen.isFrozen`), **bromsad** (`invoiceBrake`) eller **köad**
  (`invoiceQueueState` = `held`/`consolidated`/`exported`). Anta **aldrig** att "utförd = fakturerad".
  Visa t.ex. "påverkar inte fakturasumma — frusen order" när material/foto läggs på en fryst order.
- **Klarmarkera** via `PATCH /api/mobile/orders/:id/status` med `{ status: "utford" }` (eller `"completed"`).
  Servern sätter **både** `orderStatus="utford"` och `executionStatus="completed"` och kör
  obligatorisk-kontrollen. **Skicka inget eget `executionStatus`-fält** — det finns ingen sådan parameter.
- **Offline-sync-lucka:** klarmarkering via `POST /api/mobile/sync` (`status_update`) kör **inte**
  obligatorisk-kontrollen. Ska 400-flödet för obligatoriska fält gälla — klarmarkera via PATCH när ni är online.

- [ ] Klarmarkera via `PATCH .../status` med `status:"utford"` (skicka inte egna statusfält).
- [ ] Skicka in obligatoriska `leaveMetadataFields` vid klarmarkering; undvik offline-sync-vägen om gate:t måste gälla.
- [ ] Kommunicera fakturastatus korrekt ("utförd ≠ fakturerad").

### B5. Terminologi (hårdkoda inte etiketter)

Webbnavigeringen lades om i juli 2026 (webb-only, påverkar inte `/api/mobile/*`). För att Go ska följa
samma benämningar som kontoret: hämta etiketter från **`GET /api/mobile/terminology`**
(system-default + bransch + tenant-labels, `labelKey → labelValue`, t.ex. objekt/resurs/fordon).
Spegla inte parkerade/dolda webbkoncept (Dashboard, rapporter, AI-motorer) i Go.

- [ ] Hämta terminologi/etiketter från `GET /api/mobile/terminology`; hårdkoda inte.

---

## Del C — De 5 "beslut krävs"-avvikelserna (#4–#8)

Standardrekommendation = **peka om appen** till befintlig endpoint (billigast, ingen backend-release).
Bygg backend-varianten bara om funktionen verkligen behövs.

| # | Appen anropar idag | Rekommenderad åtgärd (peka om appen) | Fil i Go | Alternativ (bygg i backend) |
|---|---|---|---|---|
| 4 | `POST /api/mobile/position/batch` | Skicka batchen via `POST /api/mobile/sync` (`actionType:"gps"`) eller loopa `POST /api/mobile/position` | `client/hooks/useGpsTracking.ts` | `POST /api/mobile/position/batch` |
| 5 | `POST /api/mobile/optimize-route` + `…/status` (async + polling) | Byt till **synkron** `GET /api/mobile/route-optimized`, ta bort pollingen | `client/hooks/useRouteOptimization.ts` | async jobb + `…/status` om kö önskas |
| 6 | `POST /api/mobile/ai/voice-command` | Låt `POST /api/mobile/ai/transcribe` vara primär (finns redan som fallback) | `client/hooks/useVoiceCommands.ts` | `ai/voice-command` |
| 7 | `POST /api/mobile/ai/chat/stream` | Falla tillbaka till `POST /api/mobile/ai/chat` (icke-streamande) | — | SSE/stream-variant |
| 8 | `GET /api/mobile/route-metrics/today` | Peka om till befintlig metrik (`route-feedback/mine`, `statistics/summary`) | — | `GET /api/mobile/route-metrics/today` |

- [ ] #4 GPS-batch  - [ ] #5 Ruttoptimering  - [ ] #6 Röstkommando  - [ ] #7 AI-stream  - [ ] #8 Ruttmetrik

---

## Del D — KRITISKT: identifierare som ALDRIG får bytas

Dessa är **stabila lagrings-/event-nycklar**, inte varumärkestext. Byter du dem (t.ex. vid framtida
logga-/namnbyte) tappar befintliga fält-användare data:

| Identifierare | Var | Varför bevara |
|---|---|---|
| `traivo-offline-db` | IndexedDB-namn | Ny tom DB → all offline-cache, osynkade foton och outbox-poster försvinner |
| `traivo-language` | localStorage | Språkval återställs annars |
| `traivo-tours-seen` | localStorage | Onboarding visas annars igen |
| `traivo-focused-resource` | localStorage | Fokuserad resurs nollställs annars |
| `traivo-resource-focus` | BroadcastChannel | Tab-synk av fokus bryts annars |
| `traivo:optimization_complete` | CustomEvent | Kod-lyssnare bryts annars |
| `@assets/traivo_logo_*.png` | import-paths | Ändra bara `alt`-texten, inte sökvägen |

**Tumregel:** versalt "Traivo"/"TRAIVO" är användarsynlig text; **lowercase** `traivo` är ofta en stabil
identifierare — inspektera innan du rör den.

- [ ] Bekräfta att ingen av ovanstående identifierare byts vid ev. branding-ändring.
- [ ] Verifiera att offline-cache + osynkade outbox-poster överlever en uppgradering (testa med en fält-användare som har osynkade jobb).

---

## Del E — Design-paritet (så appen ser ut som kontoret)

Mobil-endpoints skickar **ingen** styling. Kopiera fyra saker från Traivo One-repot:

1. **Statusfärger + status-etiketter (viktigast):** `client/src/lib/status-colors.ts` — enda källan för hur en
   status ser ut och heter (svenska 8-stegs utförandestatus + badge-mappningar för order/leverans/faktura/
   prioritet/objekt). **Kopiera filen** så en order ser likadan ut i fält som på kontoret.
2. **Färg-tokens (tema):** CSS-variablerna i `client/src/index.css` (ljust **och** mörkt) + tokens i
   `tailwind.config.ts`. Utan samma tokens fungerar inte status-colors.ts.
   Traivo-paletten: Deep Ocean Blue `#1B4B6B` · Arctic Ice `#E8F4F8` · Mountain Gray `#6B7C8C` ·
   Northern Teal `#4A9B9B` · Midnight Navy `#2C3E50` · Aurora Green `#7DBFB0`.
   **Regel:** använd **alltid** tokens (`bg-destructive`/`bg-warning`/`chart-*`/`muted`), **aldrig** råa
   färger som `bg-red-500`.
3. **Font + läge:** Inter (Google Fonts) + `.dark`-klass på `<html>`.
4. **Logga/namn:** appen heter **"Traivo Go"** och är en del av Traivo-familjen (inget separat varumärke).
   Utgå från `traivo_logo_transparent.png` tills en egen "Traivo Go"-logga tas fram.

- [ ] Kopiera `status-colors.ts` + tema-tokens (`index.css` + `tailwind.config.ts`).
- [ ] Matcha Inter-font + mörkt/ljust läge.

---

## Del F — Öppna beslut (väntar på produktägaren — bygg inte förrän avgjort)

1. **Antal i fält — går vi live i Go nu?** Backend är klart. Bygga in i nästa release eller vänta?
2. **Områdesfilter:** behöver fält-appen område-indelning/filter på metadata? `metadata-context` exponerar
   `groupField` (familj) men **inte** `area` (område) idag. Ja → additiv backend-ändring krävs. Nej → hoppa över.
3. **Utförandekoder/ikoner:** mobil-ytan skickar idag bara en **rå kod-text** (`executionCodes` = kort kod utan
   register-namn/ikon). Ska backend exponera utförandekod-registret (kod → namn + ikon) för riktiga
   etiketter/ikoner, eller räcker den korta koden i fält?
4. **Kategori B (#4–#8):** per punkt — bygga backend-endpoint eller peka om appen (standard = peka om).

---

## Master-checklista

**Måste (fakturaintegritet + korrekt fältdata):**
- [ ] Del A #1–#3 namnbyten
- [ ] Antals-UI via `metadata-context` + `quantity-update` (server-styrda flaggor)
- [ ] Endast work_orders-härledda order-endpoints (ingen koncept-/avropshämtning)
- [ ] Klarmarkering via `PATCH .../status` (`status:"utford"`) + obligatoriska fält

**Bör (rätt fältupplevelse):**
- [ ] "Taget antal" via `taken-quantity-update`
- [ ] Metadata grupperad på `groupField`; barnets `metadataField` vid skrivning
- [ ] Systemgenererade värden read-only
- [ ] Terminologi från `GET /api/mobile/terminology`
- [ ] "Utförd ≠ fakturerad" kommuniceras rätt
- [ ] Statusfärger/etiketter + tema (Del E)

**Kan (efter beslut i Del F):**
- [ ] Område-filter (kräver `area` på `metadata-context`)
- [ ] Kategori B #4–#8
- [ ] Utförandekoder/ikoner
- [ ] Full palett/mörkt läge

---

*Överlämning från Traivo One-backendteamet, verifierad mot `server/routes/mobile/*` 2026-07-08.
Referensimplementation: `SimpleFieldApp.tsx`. Rör inte `/api/v1/`-versionsprefixet — det är redan korrekt.*
