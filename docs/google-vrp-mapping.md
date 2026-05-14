# Google Route Optimization — VRP-mappning

`server/services/googleMapProvider.ts` översätter Geoapify-formade
VRP-requests (jobs/agents) till Googles `optimizeTours`-modell när
`MAP_PROVIDER=google` är aktiv eller när Google körs som shadow-leverantör.

Källan för Geoapify-formen är `server/route-optimizer.ts`
(`GeoapifyJob`/`GeoapifyAgent`) och `server/vrp-constraints.ts`
(`EnrichedGeoapifyJob`/`EnrichedGeoapifyAgent`).

## Fält som mappas

| Geoapify (input)            | Google `optimizeTours` (output)                                |
| --------------------------- | -------------------------------------------------------------- |
| `jobs[].location` (lng,lat) | `shipments[].deliveries[0].arrivalLocation`                    |
| `jobs[].duration` (sek)     | `shipments[].deliveries[0].duration` (`"<n>s"`)                |
| `jobs[].time_windows`       | `shipments[].deliveries[0].timeWindows[]` (absolut RFC 3339)   |
| `jobs[].priority` (0–100)   | `shipments[].penaltyCost` (linjärt `priority*1000`)            |
| `jobs[].required_skills`    | `shipments[].allowedVehicleIndices[]` (subset-test mot agents) |
| `jobs[].delivery` (vektor)  | `shipments[].deliveries[0].loadDemands.dimN.amount`            |
| `jobs[].pickup` (vektor)    | `shipments[].pickups[0].loadDemands.dimN.amount`               |
| `agents[].start_location`   | `vehicles[].startLocation`                                     |
| `agents[].end_location`     | `vehicles[].endLocation` (fallback = `start_location`)         |
| `agents[].time_windows`     | `vehicles[].startTimeWindows` + `endTimeWindows`               |
| `agents[].breaks[]`         | `vehicles[].breakRule.breakRequests[]`                         |
| `agents[].capacity` (vekt)  | `vehicles[].loadLimits.dimN.maxLoad`                           |

Tids-anchor: Geoapifys `time_windows` och `breaks.time_windows` är
sekunder sedan dagens 00:00. Vi konverterar till absoluta timestamps med
en day-anchor som default = idag 00:00 UTC. Tester och framtida
call-sites kan sätta `req.globalStartTimeSeconds` (epok-sekunder) för
deterministiska timestamps.

## Begränsningar / fallback

| Geoapify-fält / koncept            | Google-stöd                                                | Fallback                                                                                              |
| ---------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `agents[].skills` (int-set)        | Inget direkt skill-koncept                                 | Vi pre-filtrerar via `allowedVehicleIndices` på shipment. Korrekt feasibility, ej äkta skill-set.     |
| Soft-prefer time windows           | Bara hårda `timeWindows`                                   | Geoapify-pipelinen löser detta upstream som priority-boost (vrp-constraints) → bevaras via penaltyCost. |
| Per-agent-per-jobb effektivitet    | Stöds via `Vehicle.costPerHour`-varianter, ej mappat ännu  | Geoapify har samma begränsning — vi använder upstream-justerad `duration`.                            |
| Beroenden / precedence             | Stöds via `Shipment.pickups+deliveries`-länkning           | Geoapify-pipelinen löser via time-window shifting; samma `time_windows` mappas över utan ändring.     |
| Synkronisering av flera fordon     | `Shipment.allowedVehicleIndices`-trick                     | Inte mappat — kör som vanlig delivery-shipment.                                                       |
| Vehicle cost / overtime            | `costPerKilometer`, `costPerHour`, `fixedCost`             | Inte mappat — Google använder default-kostnader. Lägg till när vi vill matcha Geoapifys cost-model.   |

Vid fail-soft (`tryMapVRPRequestToGoogle` returnerar `null`) får
`googleOptimizeTours` ett `400`-svar i `ProviderVRPResult` så att
shadow-jämförelsen rapporterar fel istället för att krascha primär-pathen.

## Respons-mappning

`mapGoogleOptimizeToursResult` slår ihop `routes[].visits[]` och
`routes[].breaks[]` i kronologisk ordning så att VRP-konsumenter
(`route-optimizer.ts`) ser samma `start → job/break/... → end`-sekvens
som från Geoapify.

* `unassignedJobIndices` ← `skippedShipments[].index`
* `unassignedAgentIndices` ← fordon utan visits (matchar Geoapifys
  `properties.issues.unassignedAgents`-semantik).
* `geometry` ← `routePolyline.points` paketerat som
  `{ type: "EncodedPolyline", points }` (caller får tolka).

## Tester

`tests/api/google-vrp-mapping.test.ts` täcker:

* Full berikad request → korrekt model.shipments/vehicles inkl.
  tidsfönster, raster, kapacitet, skills, prioritet och pickup-vektor.
* Prioritets-clamping (`-50`, `9999`, default).
* Fail-soft `null` vid ogiltig shape.
* Tom respons + respons med visits + breaks + skipped shipments + tomma
  fordon (unassigned agents).

Kör: `npx vitest run tests/api/google-vrp-mapping.test.ts`.
