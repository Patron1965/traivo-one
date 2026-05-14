# Task #490 — benchmark-sammanfattning

Mätvärden från `npx tsx scripts/benchmark-route-optimizer.ts` (Node.js v20,
Replit container, 14 maj 2026). Råjson: `docs/benchmark-route-optimizer.json`.

## DBSCAN pre-clustering (grid spatial index vs O(N²) matrix)

| N stopp | Matrix (ms) | Grid (ms) | Speedup | Kluster |
| ------: | ----------: | --------: | ------: | ------: |
|     100 |           7 |         4 |    1.8× |       4 |
|     250 |          33 |        16 |    2.1× |       4 |
|     500 |          22 |        18 |    1.2× |       4 |
|    1000 |         103 |        81 |    1.3× |       4 |
|    2000 |         457 |       278 |    1.6× |       4 |

Mål: **DBSCAN 1000 punkter < 500 ms** → uppnått (81 ms grid / 103 ms matrix).
Vid 2000 punkter går matrisen från 457 ms → 278 ms; här börjar grid-fördelen
synas tydligare. Kluster-output är bit-identisk grid-vs-matrix
(verifierat i `tests/api/dbscan-clustering.test.ts`).

## Cluster-VRP-fanout (simulerad Geoapify-latency 1500 ms/anrop)

| Antal kluster | Concurrency | Seriell (ms) | Parallell (ms) | Speedup |
| ------------: | ----------: | -----------: | -------------: | ------: |
|             4 |           4 |         6005 |           1501 |    4.0× |
|             6 |           4 |         9007 |           3004 |    3.0× |
|            10 |           4 |        15014 |           4508 |    3.3× |
|            10 |           4 |        15014 |           4508 |    3.3× |

Mål: **200-orderoptimering 2× snabbare** → uppfyllt i fanout-modellen
(verklig Geoapify-latency dominerar 200-order-pipelinen). Backout via
`VRP_PARALLEL_CLUSTERS=false` återgår till seriell körning (verifierat
med `maxInFlight=1`-assertion i `tests/api/route-optimizer-vrp.test.ts`).

## L2 cache-batchning

`getBatchDistances` gör nu **en** SQL-fråga (`WHERE id IN (...)` chunkad till
1000) per anrop i stället för N round-trips. På bekräftade L2-misses
används `fetchAndStoreUncached()` direkt så att inget extra `getL2()`-anrop
sker per pair (skulle annars återinföra N²-DB-trycket).

## Backout-flaggor

| Variabel                      | Default | Effekt vid avstängning                    |
| ----------------------------- | :-----: | ----------------------------------------- |
| `DBSCAN_USE_KDTREE=false`     | `true`  | Faller tillbaka till O(N²)-matrix-loop    |
| `VRP_PARALLEL_CLUSTERS=false` | `true`  | Seriell cluster-VRP-loop som tidigare     |
| `VRP_PARALLEL_CONCURRENCY=N`  |   `4`   | Maxantal samtidiga Geoapify-anrop         |

## Uppföljning

Verklig wall-clock från produktion bör mätas via en ny telemetri som
loggar fas-tid (`dbscan`, `matrix`, `vrp_calls`) per `optimization_job`
— se uppföljningstask #493 (CI-benchmark för 200-order end-to-end).
