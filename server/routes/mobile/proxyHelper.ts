import { pool } from '../../db';

const TRAIVO_API_URL = process.env.TRAIVO_API_URL || process.env.KINAB_API_URL || '';
const IS_MOCK_MODE = !TRAIVO_API_URL || process.env.TRAIVO_MOCK_MODE === 'true' || process.env.KINAB_MOCK_MODE === 'true';

async function traivoFetch(path: string, options: RequestInit = {}): Promise<{ status: number; data: any }> {
  const url = `${TRAIVO_API_URL}${path}`;
  const method = (options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    console.log(`  [PROXY] ${method} ${url}`);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
    });
    clearTimeout(timeout);
    console.log(`  [PROXY] ${method} ${path} → ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error(`  [PROXY] Traivo API svarade med ${contentType} istället för JSON: ${path}`);
      throw new Error('Traivo-servern svarade inte med JSON (kan vara nere)');
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error: any) {
    clearTimeout(timeout);
    const isTimeout = error.name === 'AbortError';
    const reason = isTimeout ? 'timeout (8s)' : error.message;
    console.error(`  [PROXY] FEL ${method} ${path}: ${reason}`);
    if (isTimeout) {
      throw new Error('Traivo-servern svarade inte i tid. Försök igen.');
    }
    throw new Error(`Kunde inte nå Traivo-servern: ${error.message}`);
  }
}

function getAuthHeader(req: { headers: { authorization?: string } }): Record<string, string> {
  const auth = req.headers.authorization;
  return auth ? { 'Authorization': auth } : {};
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapTraivoStatus(traivoStatus: string, orderStatus?: string): string {
  const statusMap: Record<string, string> = {
    'draft': 'planned',
    'scheduled': 'planned',
    'dispatched': 'dispatched',
    'on_site': 'on_site',
    'in_progress': 'in_progress',
    'completed': 'completed',
    'failed': 'failed',
    'cancelled': 'cancelled',
    'impossible': 'failed',
  };
  return statusMap[traivoStatus] || statusMap[orderStatus || ''] || 'planned';
}

function parseAddressParts(fullAddress: string): { address: string; city: string; postalCode: string } {
  if (!fullAddress) return { address: '', city: '', postalCode: '' };
  const parts = fullAddress.split(',').map(s => s.trim());
  return {
    address: parts[0] || fullAddress,
    city: parts[1] || '',
    postalCode: parts[2] || '',
  };
}

function transformTraivoOrder(raw: any): any {
  const addrParts = parseAddressParts(raw.objectAddress || '');
  return {
    id: raw.id,
    orderNumber: raw.title || raw.externalReference || `ORD-${(raw.id || '').toString().slice(0, 8)}`,
    status: mapTraivoStatus(raw.status, raw.orderStatus),
    customerName: raw.customerName || 'Okänd kund',
    address: addrParts.address,
    city: addrParts.city,
    postalCode: addrParts.postalCode,
    latitude: raw.taskLatitude || 0,
    longitude: raw.taskLongitude || 0,
    what3words: raw.what3words || undefined,
    scheduledDate: raw.scheduledDate ? raw.scheduledDate.split('T')[0] : new Date().toISOString().split('T')[0],
    scheduledTimeStart: raw.scheduledStartTime || undefined,
    scheduledTimeEnd: undefined,
    scheduledStartTime: raw.scheduledStartTime || undefined,
    scheduledEndTime: undefined,
    title: raw.title || '',
    description: raw.description || '',
    notes: raw.notes || raw.plannedNotes || '',
    objectType: raw.orderType || '',
    objectId: raw.objectId || '',
    clusterId: raw.clusterId || undefined,
    clusterName: undefined,
    priority: raw.priority || 'normal',
    articles: [],
    contacts: raw.customerPhone ? [{ id: 'c1', name: raw.customerName || '', phone: raw.customerPhone, role: 'Kund' }] : [],
    estimatedDuration: raw.estimatedDuration || 30,
    actualStartTime: raw.onSiteAt || undefined,
    actualEndTime: undefined,
    completedAt: raw.completedAt || undefined,
    signatureUrl: undefined,
    photos: [],
    deviations: [],
    sortOrder: 0,
    executionCodes: raw.executionCode ? [{ id: raw.executionCode, code: raw.executionCode, name: raw.executionCode }] : [],
    timeRestrictions: [],
    subSteps: [],
    dependencies: [],
    isLocked: raw.lockedAt ? true : false,
    orderNotes: [],
    inspections: [],
    executionStatus: raw.executionStatus || raw.execution_status || 'not_started',
    creationMethod: raw.creationMethod || raw.creation_method || 'manual',
    object: raw.objectName ? {
      id: raw.objectId,
      name: raw.objectName,
      address: raw.objectAddress || '',
      latitude: raw.taskLatitude || 0,
      longitude: raw.taskLongitude || 0,
      what3words: raw.what3words || undefined,
    } : undefined,
    customer: raw.customerName ? {
      id: raw.customerId,
      name: raw.customerName,
    } : undefined,
    resourceId: raw.resourceId,
    tenantId: raw.tenantId,
    metadata: raw.metadata,
  };
}

function parseCoordPoints(coords: string) {
  const points = coords.split(';');
  const parsed: { lon: number; lat: number }[] = [];
  for (const point of points) {
    const parts = point.split(',');
    if (parts.length !== 2) return null;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lon) || isNaN(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    parsed.push({ lon, lat });
  }
  return parsed;
}

function perpendicularDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = point[0] - lineStart[0];
    const ey = point[1] - lineStart[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lenSq));
  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  const ex = point[0] - projX;
  const ey = point[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function rdpSimplify(coords: number[][], epsilon: number): number[][] {
  if (coords.length <= 2) return coords;
  let maxDist = 0;
  let maxIdx = 0;
  const first = coords[0];
  const last = coords[coords.length - 1];
  for (let i = 1; i < coords.length - 1; i++) {
    const d = perpendicularDistance(coords[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(coords.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(coords.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function simplifyCoordinates(coords: number[][], maxPoints: number): number[][] {
  if (coords.length <= maxPoints) return coords;
  let lo = 0;
  let hi = 0.01;
  let result = coords;
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    result = rdpSimplify(coords, mid);
    if (result.length > maxPoints) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (result.length > maxPoints) {
    result = rdpSimplify(coords, hi);
  }
  return result;
}

function buildFallbackResponse(parsed: { lon: number; lat: number }[]) {
  return {
    waypoints: parsed.map((p, i) => ({ location: [p.lon, p.lat], waypointIndex: i, tripsIndex: 0 })),
    trips: [{
      geometry: { type: 'LineString', coordinates: parsed.map(p => [p.lon, p.lat]) },
      distance: 0,
      duration: 0,
      legs: [],
    }],
    fallback: true,
  };
}

async function handleTimeEntries(orderId: string, driverId: string, newStatus: string) {
  const now = new Date();
  try {
    if (newStatus === 'dispatched') {
      await pool.query(
        `INSERT INTO time_entries (order_id, driver_id, status, started_at) VALUES ($1, $2, 'travel', $3)`,
        [orderId, driverId, now]
      );
    } else if (newStatus === 'on_site') {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND status = 'travel' AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
      await pool.query(
        `INSERT INTO time_entries (order_id, driver_id, status, started_at) VALUES ($1, $2, 'on_site', $3)`,
        [orderId, driverId, now]
      );
    } else if (newStatus === 'in_progress') {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND status = 'on_site' AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
      await pool.query(
        `INSERT INTO time_entries (order_id, driver_id, status, started_at) VALUES ($1, $2, 'working', $3)`,
        [orderId, driverId, now]
      );
    } else if (newStatus === 'completed' || newStatus === 'utford') {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
    } else if (newStatus === 'failed' || newStatus === 'impossible' || newStatus === 'cancelled') {
      await pool.query(
        `UPDATE time_entries SET ended_at = $1, duration_seconds = EXTRACT(EPOCH FROM ($1 - started_at))::integer WHERE order_id = $2 AND driver_id = $3 AND ended_at IS NULL`,
        [now, orderId, driverId]
      );
    }
  } catch (err: any) {
    console.error('Error managing time entries:', err.message);
  }
}

export {
  TRAIVO_API_URL,
  IS_MOCK_MODE,
  traivoFetch,
  getAuthHeader,
  haversineDistance,
  mapTraivoStatus,
  parseAddressParts,
  transformTraivoOrder,
  parseCoordPoints,
  perpendicularDistance,
  rdpSimplify,
  simplifyCoordinates,
  buildFallbackResponse,
  handleTimeEntries,
};
