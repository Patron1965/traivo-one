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

function regionQuery(
  stops: TemporalStop[],
  pointIdx: number,
  epsilon: number,
  distMatrix: number[][],
): number[] {
  const neighbors: number[] = [];
  for (let i = 0; i < stops.length; i++) {
    if (distMatrix[pointIdx][i] <= epsilon) {
      neighbors.push(i);
    }
  }
  return neighbors;
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

  let maxGeoDist = 1;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const d = haversineDistanceKm(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
      if (d > maxGeoDist) maxGeoDist = d;
    }
  }

  const n = stops.length;
  const distMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = combinedDistance(stops[i], stops[j], maxGeoDist, temporalWeight);
      distMatrix[i][j] = d;
      distMatrix[j][i] = d;
    }
  }

  const UNVISITED = -2;
  const NOISE = -1;
  const labels = new Array(n).fill(UNVISITED);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors = regionQuery(stops, i, epsilonKm, distMatrix);
    if (neighbors.length < minSamples) {
      labels[i] = NOISE;
      continue;
    }

    labels[i] = clusterId;
    const seedSet = neighbors.filter(idx => idx !== i);
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
      const qNeighbors = regionQuery(stops, q, epsilonKm, distMatrix);
      if (qNeighbors.length >= minSamples) {
        for (const nb of qNeighbors) {
          if (!seedSet.includes(nb)) {
            seedSet.push(nb);
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

  for (const [, members] of clusterMap) {
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

  console.log(
    `[dbscan] ${stops.length} stops → ${clusters.length} clusters, ${noiseStops.length} noise points, avg intra-cluster dist: ${avgIntraClusterDistKm.toFixed(1)} km`,
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
