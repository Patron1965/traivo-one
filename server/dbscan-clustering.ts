import { haversineDistanceKm, geographicPreCluster } from "./distance-matrix-service";

export interface TemporalStop {
  id: string;
  lat: number;
  lng: number;
  timeWindows?: [number, number][];
}

export interface DBSCANConfig {
  epsilonKm: number;
  minSamples: number;
  temporalWeight: number;
}

export const DEFAULT_DBSCAN_CONFIG: DBSCANConfig = {
  epsilonKm: 15,
  minSamples: 3,
  temporalWeight: 0.3,
};

export interface DBSCANCluster {
  centroid: { lat: number; lng: number };
  stops: TemporalStop[];
}

export interface DBSCANResult {
  clusters: DBSCANCluster[];
  noise: TemporalStop[];
  stats: {
    numClusters: number;
    numNoise: number;
    avgIntraClusterDistKm: number;
  };
}

function temporalDistance(a: TemporalStop, b: TemporalStop): number {
  const twA = a.timeWindows;
  const twB = b.timeWindows;

  if (!twA || twA.length === 0 || !twB || twB.length === 0) {
    return 0;
  }

  let totalOverlap = 0;
  let totalSpanA = 0;
  let totalSpanB = 0;

  for (const [aStart, aEnd] of twA) {
    totalSpanA += aEnd - aStart;
    for (const [bStart, bEnd] of twB) {
      const overlapStart = Math.max(aStart, bStart);
      const overlapEnd = Math.min(aEnd, bEnd);
      if (overlapEnd > overlapStart) {
        totalOverlap += overlapEnd - overlapStart;
      }
    }
  }
  for (const [bStart, bEnd] of twB) {
    totalSpanB += bEnd - bStart;
  }

  const maxSpan = Math.max(totalSpanA, totalSpanB);
  if (maxSpan === 0) return 0;

  const overlapRatio = totalOverlap / maxSpan;
  return 1 - overlapRatio;
}

function combinedDistance(
  a: TemporalStop,
  b: TemporalStop,
  maxGeoDistKm: number,
  temporalWeight: number,
): number {
  const geoDist = haversineDistanceKm(a.lat, a.lng, b.lat, b.lng);
  const normalizedGeo = geoDist / maxGeoDistKm;
  const tempDist = temporalDistance(a, b);
  const geoWeight = 1 - temporalWeight;
  return (geoWeight * normalizedGeo + temporalWeight * tempDist) * maxGeoDistKm;
}

// =============================================================================
// Spatial grid index (Task #490)
//
// Tidigare körde DBSCAN en O(N²) full distansmatris och en O(N) regionQuery per
// punkt — vilket totalt blev O(N²) i tid och minne. För 1000 stopp ≈ 1 M
// haversine-anrop + 8 MB allokering. Vi byter den fasen mot en lokal
// equirectangular-projektion + uniform grid-hash. Då blir radius-queries
// förväntat O(k) per punkt (k = grannar i 3x3-cell), totalt O(N+E) där E är
// antalet faktiska grannskap.
//
// Säkerhetsmarginal: combined_distance(a,b) = (1-tw)*geoDist + tw*tempDist*maxGeo.
// Eftersom tempDist >= 0 gäller alltid (1-tw)*geoDist <= combined. Punkter med
// combined <= eps måste därför ha geoDist <= eps/(1-tw) → trygg radie för
// kandidatfiltret. Exakt combinedDistance beräknas sedan på kandidaterna,
// så grid-versionen ger bit-identiska kluster som matrix-versionen (kontrolleras
// av `tests/api/dbscan-clustering.test.ts`).
//
// Backout-flagga: sätt `DBSCAN_USE_KDTREE=false` för att tvinga gamla matrisen.
// =============================================================================

const KM_PER_DEG_LAT = 111.0;

interface SpatialIndex {
  /**
   * Returnerar index för alla stopp vars geografiska avstånd från `stops[idx]`
   * är <= `radiusKm` (med en liten cell-marginal — false positives är OK,
   * caller filtrerar exakt). Inkluderar alltid `idx` själv.
   */
  query(idx: number, radiusKm: number): number[];
}

function buildSpatialIndex(stops: TemporalStop[]): SpatialIndex {
  const n = stops.length;
  // Equirectangular projektion runt medel-latitud för Sverige-skalig data.
  // För globala dataset blir det skevt, men kandidat-filtret är konservativt
  // (vi söker större radie än nödvändigt) och den exakta haversine-checken
  // i regionQuery säkerställer korrekthet ändå.
  let sumLat = 0;
  for (let i = 0; i < n; i++) sumLat += stops[i].lat;
  const refLat = n > 0 ? sumLat / n : 0;
  const cosLat = Math.max(0.01, Math.cos((refLat * Math.PI) / 180));
  const kmPerDegLng = KM_PER_DEG_LAT * cosLat;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = stops[i].lng * kmPerDegLng;
    ys[i] = stops[i].lat * KM_PER_DEG_LAT;
  }

  // Cell-storlek: för stora dataset → större celler så att 3x3-grannar rymmer
  // typisk eps-radie. Default 5 km matchar typiska eps på 15-25 km bra.
  const CELL_KM = 5;
  const cells = new Map<number, number[]>();
  // Pack (cx, cy) into a single int32-key. cx/cy ryms i ±32k för Sveriges yta.
  const keyOf = (cx: number, cy: number) => ((cx + 0x8000) << 17) | (cy + 0x8000);

  for (let i = 0; i < n; i++) {
    const cx = Math.floor(xs[i] / CELL_KM);
    const cy = Math.floor(ys[i] / CELL_KM);
    const key = keyOf(cx, cy);
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(i);
  }

  return {
    query(idx: number, radiusKm: number): number[] {
      if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
        // Degenerate: tw=1 (helt temporal). Returnera alla → exakt-checken
        // i caller hanterar resten. Sällsynt; default tw=0.3.
        const all: number[] = new Array(n);
        for (let i = 0; i < n; i++) all[i] = i;
        return all;
      }
      const cx = Math.floor(xs[idx] / CELL_KM);
      const cy = Math.floor(ys[idx] / CELL_KM);
      const r = Math.ceil(radiusKm / CELL_KM);
      const out: number[] = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const bucket = cells.get(keyOf(cx + dx, cy + dy));
          if (bucket) {
            for (let k = 0; k < bucket.length; k++) out.push(bucket[k]);
          }
        }
      }
      return out;
    },
  };
}

function regionQueryMatrix(
  n: number,
  pointIdx: number,
  epsilon: number,
  distMatrix: number[][],
): number[] {
  const neighbors: number[] = [];
  const row = distMatrix[pointIdx];
  for (let i = 0; i < n; i++) {
    if (row[i] <= epsilon) neighbors.push(i);
  }
  return neighbors;
}

function regionQueryIndexed(
  stops: TemporalStop[],
  pointIdx: number,
  epsilon: number,
  maxGeoDist: number,
  temporalWeight: number,
  index: SpatialIndex,
): number[] {
  // Säker över-skattning: combined_distance >= (1-tw)*geoDist (eftersom
  // tempDist >= 0). Punkter med combined <= eps måste ha geoDist <= eps/(1-tw).
  const tw = temporalWeight;
  const geoRadius = tw < 1 ? epsilon / (1 - tw) : Infinity;

  const candidates = index.query(pointIdx, geoRadius);
  const out: number[] = [];
  const a = stops[pointIdx];
  for (let k = 0; k < candidates.length; k++) {
    const j = candidates[k];
    if (j === pointIdx) {
      out.push(j);
      continue;
    }
    const d = combinedDistance(a, stops[j], maxGeoDist, temporalWeight);
    if (d <= epsilon) out.push(j);
  }
  return out;
}

function shouldUseSpatialIndex(): boolean {
  return (process.env.DBSCAN_USE_KDTREE ?? "true").toLowerCase() !== "false";
}

export function dbscanCluster(
  stops: TemporalStop[],
  config: Partial<DBSCANConfig> = {},
): DBSCANResult {
  const { epsilonKm, minSamples, temporalWeight } = { ...DEFAULT_DBSCAN_CONFIG, ...config };

  if (stops.length === 0) {
    return { clusters: [], noise: [], stats: { numClusters: 0, numNoise: 0, avgIntraClusterDistKm: 0 } };
  }

  if (stops.length <= minSamples) {
    const lat = stops.reduce((s, st) => s + st.lat, 0) / stops.length;
    const lng = stops.reduce((s, st) => s + st.lng, 0) / stops.length;
    return {
      clusters: [{ centroid: { lat, lng }, stops: [...stops] }],
      noise: [],
      stats: { numClusters: 1, numNoise: 0, avgIntraClusterDistKm: 0 },
    };
  }

  const tStart = Date.now();
  const useIndex = shouldUseSpatialIndex();
  const n = stops.length;

  // maxGeoDist behåller exakt O(N²) skalär-loop — billig (ingen allokering)
  // och krävs för att normalisera tempDist mot geo-skalan. Att approximera
  // med bbox-diagonalen ändrar kluster-kanter, vilket bryter behavior-parity.
  let maxGeoDist = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineDistanceKm(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
      if (d > maxGeoDist) maxGeoDist = d;
    }
  }

  let regionQuery: (idx: number) => number[];
  let indexBuildMs = 0;

  if (useIndex) {
    const tIdx = Date.now();
    const spatial = buildSpatialIndex(stops);
    indexBuildMs = Date.now() - tIdx;
    regionQuery = (idx: number) =>
      regionQueryIndexed(stops, idx, epsilonKm, maxGeoDist, temporalWeight, spatial);
  } else {
    const distMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = combinedDistance(stops[i], stops[j], maxGeoDist, temporalWeight);
        distMatrix[i][j] = d;
        distMatrix[j][i] = d;
      }
    }
    regionQuery = (idx: number) => regionQueryMatrix(n, idx, epsilonKm, distMatrix);
  }

  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array(n).fill(UNVISITED);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors = regionQuery(i);
    if (neighbors.length < minSamples) {
      labels[i] = NOISE;
      continue;
    }

    labels[i] = clusterId;
    const seedSet = neighbors.filter(idx => idx !== i);
    const inSeed = new Set<number>(seedSet);
    let seedIdx = 0;

    while (seedIdx < seedSet.length) {
      const q = seedSet[seedIdx];
      if (labels[q] === NOISE) {
        labels[q] = clusterId;
      }
      if (labels[q] !== UNVISITED) {
        seedIdx++;
        continue;
      }
      labels[q] = clusterId;
      const qNeighbors = regionQuery(q);
      if (qNeighbors.length >= minSamples) {
        for (const nb of qNeighbors) {
          if (!inSeed.has(nb)) {
            seedSet.push(nb);
            inSeed.add(nb);
          }
        }
      }
      seedIdx++;
    }

    clusterId++;
  }

  const clusterMap = new Map<number, TemporalStop[]>();
  const noiseStops: TemporalStop[] = [];

  for (let i = 0; i < n; i++) {
    if (labels[i] === NOISE) {
      noiseStops.push(stops[i]);
    } else {
      const list = clusterMap.get(labels[i]) || [];
      list.push(stops[i]);
      clusterMap.set(labels[i], list);
    }
  }

  const clusters: DBSCANCluster[] = [];
  let totalIntraDist = 0;
  let intraPairs = 0;

  for (const [, members] of Array.from(clusterMap)) {
    const lat = members.reduce((s, st) => s + st.lat, 0) / members.length;
    const lng = members.reduce((s, st) => s + st.lng, 0) / members.length;
    clusters.push({ centroid: { lat, lng }, stops: members });

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        totalIntraDist += haversineDistanceKm(members[i].lat, members[i].lng, members[j].lat, members[j].lng);
        intraPairs++;
      }
    }
  }

  const avgIntraClusterDistKm = intraPairs > 0 ? totalIntraDist / intraPairs : 0;
  const totalMs = Date.now() - tStart;

  console.log(
    `[dbscan] ${stops.length} stops → ${clusters.length} clusters, ${noiseStops.length} noise points, avg intra-cluster dist: ${avgIntraClusterDistKm.toFixed(1)} km (mode=${useIndex ? "grid" : "matrix"}, ${totalMs} ms${useIndex ? `, index=${indexBuildMs} ms` : ""})`,
  );

  return {
    clusters,
    noise: noiseStops,
    stats: {
      numClusters: clusters.length,
      numNoise: noiseStops.length,
      avgIntraClusterDistKm: Math.round(avgIntraClusterDistKm * 10) / 10,
    },
  };
}

export function assignNoiseToNearestCluster(
  result: DBSCANResult,
  temporalWeight = DEFAULT_DBSCAN_CONFIG.temporalWeight,
): DBSCANCluster[] {
  if (result.noise.length === 0) return result.clusters;
  if (result.clusters.length === 0) {
    const lat = result.noise.reduce((s, st) => s + st.lat, 0) / result.noise.length;
    const lng = result.noise.reduce((s, st) => s + st.lng, 0) / result.noise.length;
    return [{ centroid: { lat, lng }, stops: [...result.noise] }];
  }

  const clusters = result.clusters.map(c => ({
    centroid: { ...c.centroid },
    stops: [...c.stops],
  }));

  for (const noisePoint of result.noise) {
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let ci = 0; ci < clusters.length; ci++) {
      const centroidStop: TemporalStop = {
        id: "__centroid__",
        lat: clusters[ci].centroid.lat,
        lng: clusters[ci].centroid.lng,
        timeWindows: clusters[ci].stops[0]?.timeWindows,
      };

      let maxGeo = 1;
      for (const s of clusters[ci].stops) {
        const d = haversineDistanceKm(noisePoint.lat, noisePoint.lng, s.lat, s.lng);
        if (d > maxGeo) maxGeo = d;
      }

      const d = combinedDistance(noisePoint, centroidStop, maxGeo, temporalWeight);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = ci;
      }
    }

    clusters[bestIdx].stops.push(noisePoint);
  }

  for (const c of clusters) {
    c.centroid.lat = c.stops.reduce((s, st) => s + st.lat, 0) / c.stops.length;
    c.centroid.lng = c.stops.reduce((s, st) => s + st.lng, 0) / c.stops.length;
  }

  return clusters;
}

export function dbscanPreCluster(
  stops: TemporalStop[],
  targetNumGroups: number,
  config: Partial<DBSCANConfig> = {},
): DBSCANCluster[] {
  const effectiveConfig = { ...DEFAULT_DBSCAN_CONFIG, ...config };

  const result = dbscanCluster(stops, effectiveConfig);

  if (result.clusters.length === 0 || result.clusters.length === 1) {
    console.log(`[dbscan] DBSCAN produced ${result.clusters.length} cluster(s), falling back to K-Means`);
    const plainStops = stops.map(s => ({ id: s.id, lat: s.lat, lng: s.lng }));
    const kmClusters = geographicPreCluster(plainStops, targetNumGroups);
    return kmClusters.map((kc) => ({
      centroid: kc.centroid,
      stops: kc.stops.map((s) => {
        const orig = stops.find(st => st.id === s.id);
        return orig || { id: s.id, lat: s.lat, lng: s.lng };
      }),
    }));
  }

  return assignNoiseToNearestCluster(result, effectiveConfig.temporalWeight);
}
