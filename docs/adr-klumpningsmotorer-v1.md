# ADR – Klumpningsmotorernas arkitektur v1

**Status:** Fastställt (Alt B vald — se §3).
**Datum:** 2026-07-20.
**Föregångare:** `adr-orderkoncept-v3.md` (arbetsordrar, orderkoncept, kluster som permanent org-struktur).

---

## 1. Bakgrund och syfte

Traivo behöver dynamisk klustring av fältuppgifter — inte permanenta organisationskluster
(som redan hanteras via `districts`/`clusters`-kolumner) utan tillfälliga, motor-beräknade
**stoppklumpar** och **ruttklumpar** som stödjer planeraren på Navet och veckoplan-nivå.

Det finns tre begreppsliga nivåer:

| Begrepp | Karaktär | Tidshorisont | Motor |
|---|---|---|---|
| **Kluster** | Permanent organisationsstruktur (ort/område) | Indefinit | Manuell |
| **Stoppklump** | Dynamisk grupp av uppgifter vid samma fysiska stopp | 1–2 veckor | Stoppklumpningsmotorn |
| **Ruttklump** | Dynamisk grupp av stopp som utförs under samma produktionsdag | Upp till 1 år (rullande) | Ruttklumpningsmotorn |

---

## 2. Beslut: separata tabeller

Befintlig `clusters`-kolumn på `work_orders`/`assignments` bevaras (expand-contract) för
bakåtkompatibilitet med VRP, planerings-UI och avståndscachning. De nya motorerna
skriver till **egna tabeller** — `stop_clusters` och `route_clusters` — av tre skäl:

1. Permanenta kluster är statiska organisationsenheter; klumpar är korta beräkningsresultat.
2. Klumpar har egna statusar, historik, beräkningstidsstämplar och regelversioner.
3. Att blanda ihop tabellerna skulle kräva att legacy-kolumner bär ny semantik → riskabelt.

---

## 3. Beslut: sekvensering (Alt B vald)

### Alternativ A — Unified tasks-tabell
Bygg en gemensam `tasks`-tabell (parallell med `assignments`) nu och häfta klump-ID:n dit.
**Förkastat:** Blockar klumpningsmotorns leverans. Unified tasks är ett separat P3-projekt
(se `docs/uppgiftsmodellen-utredning.md`).

### Alternativ B — Lägg klump-ID:n på work_orders OCH assignments ✓ VALD
`stop_cluster_id` + `route_cluster_id` + hjälpfält läggs som nullable fält på BÅDA tabellerna
(expand-contract). Fälten på assignments täcker koncept-genererade uppgifter;
fälten på work_orders täcker manuella/snabborder-uppgifter och materialiserade call_off-uppgifter.

**Valt av:** Täcker ~100% av aktiva planeringsfall utan att blockera motorns leverans.
Framtida unified tasks kan migrera fälten dit utan att schema-semantiken behöver ändras.

### Alternativ C — Enbart work_orders
Snabbast, men missar alla assignments som ännu inte materialiserats till work_orders
(~80% av koncept-genererade framtida uppgifter lever som assignments).

---

## 4. Triggerregler för inkrementell omräkning

Klumpningsmotorn körs INTE vid varje ändring — bara när relevanta fält ändras.
Fyra dimensioner trigger omräkning:

| Dimension | Fält |
|---|---|
| **När** | `scheduledDate`, `deliveryWindowStart`, `deliveryWindowEnd`, `plannedWeek`, `requestedDate` |
| **Var** | `address`, `latitude`, `longitude` |
| **Hur** | `executionCode` |
| **Status** | `status`, `orderStatus` |

Fullständig omräkning (alla uppgifter) körs enbart vid:
- Manuell begäran av planerare
- Ändring av klumpningsreglernas konfiguration

---

## 5. Geografimodell v1

- **Koordinater:** Lat/lng (WGS-84, `real` i PostgreSQL).
- **Avstånd:** Haversine-formel (`haversineDistanceKm` i `client/src/lib/geo.ts` och server-ekvivalent).
- **PostGIS:** Framtida beslut — separatas som eget ADR när volymer motiverar spatial indexering.
- **Reverse geocoding:** Via `getMapProvider()` (Geoapify/Nominatim) för ruttklumpnamn.

---

## 6. Historikmodell

Tre historiktyper spåras — alla via egna tabeller (inga jsonb-arrayer):

| Typ | Tabell | Trigger |
|---|---|---|
| Datatillhörighet | `stop_cluster_memberships` / `route_cluster_memberships` | Tilldelning / borttagning |
| Statusövergång | Egna `status`-kolumner (auto → confirmed → locked → dissolved) | Planerarbehandling |
| Beräkningshistorik | `last_calculated_at` + `clustering_rule_version` på klump-raden | Varje motorkörning |

`assigned_at` / `removed_at` + `removal_reason` på membership-raderna möjliggör spårning
av varför en uppgift bytte klump.

---

## 7. Låsningsmodell

Klumpar kan ha tre låsningslägen (fältet `cluster_lock_status` på work_order/assignment):

| Värde | Innebär |
|---|---|
| `auto` | Motorns senaste beslut. Kan skrivas om vid omräkning. |
| `confirmed` | Planeraren har bekräftat beslutet. Motorn varnar men skriver OM vid stark avvikelse (konfigurerbart). |
| `locked` | Oföränderligt. Motorn skriver ALDRIG om. Kräver explicit upplåsning. |

---

## 8. Klumpnamns-konvention

**Stoppklump:** `{Gatuadress}, {Stad}` → `Mekanivägen 2C, Tullinge`.
Extra info läggs till med `–`-separator: `Mekanivägen 2C – Miljörum västra`.

**Ruttklump:** Automatisk reverse geocoding mot klumpens geografiska tyngdpunkt,
via `getMapProvider().reverseGeocode(lat, lng)`. Flertätortiga klumpar: `{Stad1}–{Stad2}`.
Fallback om geocoding misslyckas: `Ruttklump {YYYY-MM-DD}`.

---

## 9. Konfiguration per tenant

Motorns beteende är konfigurerbart per tenant (startvärden hårdkodade, framtida UI):

```
stop_cluster_radius_meters        default: 30
stop_cluster_max_time_gap_days    default: 14
stop_cluster_horizon_days         default: 14
route_cluster_radius_km           default: 40
route_cluster_max_work_minutes    default: 480
route_cluster_horizon_days        default: 365
route_cluster_schedule_daily_hour default: 2
```

---

## 10. Gränssnittsintegration

- **Navet (Grovplaneringen):** Listvy med klump-badges per uppgift + kartvy med veckoslider.
- **Veckoplanen (Finplanering):** Klumpinfo visas som kontextuell information; restidsuppgifter skapas här.
- **Mobil (Traivo Go):** Klumpinfo är read-only (visas i uppgiftsdetaljer); planeraren styr.

Motorerna beräknar och berikar — de skapar inte en alternativ datamodell. Navet är navet.

---

## 11. Relaterade dokument

- `adr-orderkoncept-v3.md` — Objekt-neutralitet, kund-hierarki, kluster som permanent org
- `docs/uppgiftsmodellen-utredning.md` — Framtida unified tasks (P3)
- `docs/uppgiftslogik-utvecklingslogg.md` — Parkerat framtida bygge
- `shared/schema.ts` — `stopClusters`, `routeClusters`, `stopClusterMemberships`, `routeClusterMemberships`
- `server/services/clustering/triggers.ts` — `CLUSTERING_TRIGGERS`, `shouldRecluster()`
