import { Router } from 'express';
import { pool } from '../db';

const router = Router();

const KINAB_API_URL = process.env.KINAB_API_URL || '';
const IS_MOCK_MODE = !KINAB_API_URL || process.env.KINAB_MOCK_MODE === 'true';

async function kinabFetch(path: string, options: RequestInit = {}): Promise<{ status: number; data: any }> {
  const url = `${KINAB_API_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
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
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.error(`Kinab API returned non-JSON (${contentType}) for ${path}`);
      throw new Error('Kinab-servern svarade inte med JSON (kan vara nere)');
    }
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error: any) {
    clearTimeout(timeout);
    console.error(`Kinab API error (${path}):`, error.message);
    throw new Error(`Kunde inte nå Kinab-servern: ${error.message}`);
  }
}

function getAuthHeader(req: { headers: { authorization?: string } }): Record<string, string> {
  const auth = req.headers.authorization;
  return auth ? { 'Authorization': auth } : {};
}

const MOCK_RESOURCE = {
  id: 101,
  tenantId: 'kinab-demo',
  name: 'Erik Lindqvist',
  type: 'driver',
  phone: '070-111 22 33',
  email: 'erik.lindqvist@kinab.se',
  vehicleRegNo: 'ABC 123',
  homeLatitude: 57.7089,
  homeLongitude: 11.9746,
  competencies: ['ADR', 'YKB', 'C-körkort'],
  executionCodes: ['TÖM', 'HÄMT', 'FARL'],
};

const MOCK_TOKEN = 'mock-driver-token-001';

const MOCK_NOTIFICATIONS: any[] = [
  { id: 'n1', type: 'schedule_change', title: 'Ruttändring', message: 'Order WO-2026-0453 har flyttats till kl 10:00', isRead: false, createdAt: new Date(Date.now() - 3600000).toISOString(), orderId: '3' },
  { id: 'n2', type: 'urgent', title: 'Brådskande uppdrag', message: 'Nytt hämtuppdrag tillagt: Göteborgs Hamn AB', isRead: false, createdAt: new Date(Date.now() - 7200000).toISOString(), orderId: '5' },
  { id: 'n3', type: 'info', title: 'Systeminformation', message: 'Ny version av appen tillgänglig', isRead: true, createdAt: new Date(Date.now() - 86400000).toISOString() },
];

const MOCK_ORDERS: any[] = [
  {
    id: 1,
    orderNumber: 'WO-2026-0451',
    status: 'planned',
    customerName: 'BRF Solsidan',
    address: 'Storgatan 12',
    city: 'Göteborg',
    postalCode: '411 01',
    latitude: 57.7089,
    longitude: 11.9746,
    what3words: 'fest.lampa.skog',
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '08:00',
    scheduledTimeEnd: '09:00',
    description: 'Tömning av kärl - Hushållsavfall 370L',
    notes: 'Porten har kod 1234',
    objectType: 'Kärl',
    objectId: 501,
    clusterId: 10,
    clusterName: 'Centrum Norr',
    priority: 'normal',
    object: { id: 501, name: 'Sopstation Storgatan 12', address: 'Storgatan 12', latitude: 57.7089, longitude: 11.9746, what3words: 'fest.lampa.skog' },
    customer: { id: 201, name: 'BRF Solsidan', customerNumber: 'KN-2201' },
    articles: [
      { id: 1, name: 'Hushållsavfall 370L', articleNumber: 'ART-001', unit: 'st', quantity: 4, category: 'Avfall', isSeasonal: false },
      { id: 2, name: 'Matavfall 140L', articleNumber: 'ART-002', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 1, name: 'Anna Karlsson', phone: '070-123 45 67', email: 'anna@brfsolsidan.se', role: 'Fastighetsskötare' },
    ],
    estimatedDuration: 15,
    photos: [],
    deviations: [],
    sortOrder: 1,
    executionCodes: [{ id: 1, code: 'TÖM', name: 'Tömning' }],
    timeRestrictions: [],
    subSteps: [
      { id: 1, name: 'Hämta kärl från gård', articleName: 'Hushållsavfall 370L', completed: false, sortOrder: 1 },
      { id: 2, name: 'Töm i fordon', articleName: 'Hushållsavfall 370L', completed: false, sortOrder: 2 },
      { id: 3, name: 'Återställ kärl', articleName: 'Hushållsavfall 370L', completed: false, sortOrder: 3 },
      { id: 4, name: 'Hämta matavfall', articleName: 'Matavfall 140L', completed: false, sortOrder: 4 },
      { id: 5, name: 'Töm matavfall', articleName: 'Matavfall 140L', completed: false, sortOrder: 5 },
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 1, orderId: 1, text: 'Ny kod på porten sedan förra veckan', createdBy: 'Kontor', createdAt: new Date(Date.now() - 86400000).toISOString() },
    ],
    inspections: [],
    creationMethod: 'schema',
    resourceId: 101,
    tenantId: 'kinab-demo',
  },
  {
    id: 2,
    orderNumber: 'WO-2026-0452',
    status: 'planned',
    customerName: 'Fastighets AB Norden',
    address: 'Vasagatan 28',
    city: 'Göteborg',
    postalCode: '411 37',
    latitude: 57.7045,
    longitude: 11.9664,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '09:15',
    scheduledTimeEnd: '09:45',
    description: 'Tömning av kärl - Restavfall och kartong',
    notes: 'Kärlen står i gården, gå genom port till vänster',
    objectType: 'Kärl',
    objectId: 502,
    clusterId: 10,
    clusterName: 'Centrum Norr',
    priority: 'normal',
    object: { id: 502, name: 'Soprum Vasagatan', address: 'Vasagatan 28', latitude: 57.7045, longitude: 11.9664 },
    customer: { id: 202, name: 'Fastighets AB Norden', customerNumber: 'KN-2202' },
    articles: [
      { id: 3, name: 'Restavfall 660L', articleNumber: 'ART-003', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
      { id: 4, name: 'Kartong 660L', articleNumber: 'ART-004', unit: 'st', quantity: 1, category: 'Återvinning', isSeasonal: false },
    ],
    contacts: [
      { id: 2, name: 'Lars Svensson', phone: '073-456 78 90', role: 'Driftansvarig' },
    ],
    estimatedDuration: 20,
    photos: [],
    deviations: [],
    sortOrder: 2,
    executionCodes: [{ id: 1, code: 'TÖM', name: 'Tömning' }],
    timeRestrictions: [
      { id: 1, type: 'parking_ban', description: 'P-förbud vardagar 07-09', dayOfWeek: undefined, startTime: '07:00', endTime: '09:00', isActive: true },
    ],
    subSteps: [],
    dependencies: [
      { id: 1, dependsOnOrderId: 1, dependsOnOrderNumber: 'WO-2026-0451', dependsOnStatus: 'completed', isBlocking: false },
    ],
    isLocked: false,
    orderNotes: [],
    inspections: [],
    creationMethod: 'avrop',
    resourceId: 101,
    tenantId: 'kinab-demo',
  },
  {
    id: 3,
    orderNumber: 'WO-2026-0453',
    status: 'planned',
    customerName: 'Chalmers Tekniska Högskola',
    address: 'Chalmersängen 4',
    city: 'Göteborg',
    postalCode: '412 96',
    latitude: 57.6896,
    longitude: 11.9770,
    what3words: 'böcker.glas.rikt',
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '10:00',
    scheduledTimeEnd: '10:45',
    description: 'Tömning av containrar - Bygg och verksamhetsavfall',
    notes: 'Anmäl vid reception vid leveransentrén',
    objectType: 'Container',
    objectId: 503,
    clusterId: 11,
    clusterName: 'Centrum Söder',
    priority: 'high',
    object: { id: 503, name: 'Chalmers Leveransentré', address: 'Chalmersängen 4', latitude: 57.6896, longitude: 11.9770, what3words: 'böcker.glas.rikt' },
    customer: { id: 203, name: 'Chalmers Tekniska Högskola', customerNumber: 'KN-2203' },
    articles: [
      { id: 5, name: 'Byggavfall container 8m³', articleNumber: 'ART-005', unit: 'st', quantity: 1, category: 'Bygg', isSeasonal: false },
      { id: 6, name: 'Verksamhetsavfall 1100L', articleNumber: 'ART-006', unit: 'st', quantity: 3, category: 'Avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 3, name: 'Maria Berg', phone: '031-772 10 00', email: 'maria.berg@chalmers.se', role: 'Miljösamordnare' },
      { id: 4, name: 'Johan Ek', phone: '070-987 65 43', role: 'Vaktmästare' },
    ],
    estimatedDuration: 30,
    photos: [],
    deviations: [],
    sortOrder: 3,
    executionCodes: [
      { id: 2, code: 'HÄMT', name: 'Hämtning' },
      { id: 3, code: 'FARL', name: 'Farligt avfall' },
    ],
    timeRestrictions: [
      { id: 2, type: 'quiet_hours', description: 'Tysta timmar 22-07, föreläsningar pågår', startTime: '22:00', endTime: '07:00', isActive: false },
      { id: 3, type: 'access_restriction', description: 'Kräver passerkort vardagar', isActive: true },
    ],
    subSteps: [
      { id: 6, name: 'Kontrollera container', articleName: 'Byggavfall container 8m³', completed: false, sortOrder: 1 },
      { id: 7, name: 'Lyfta container', articleName: 'Byggavfall container 8m³', completed: false, sortOrder: 2 },
      { id: 8, name: 'Byt container', articleName: 'Byggavfall container 8m³', completed: false, sortOrder: 3 },
      { id: 9, name: 'Töm verksamhetsavfall', articleName: 'Verksamhetsavfall 1100L', completed: false, sortOrder: 4 },
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 2, orderId: 3, text: 'Ny parkeringsplats vid leveransentrén från mars', createdBy: 'Planerare', createdAt: new Date(Date.now() - 172800000).toISOString() },
    ],
    inspections: [],
    creationMethod: 'manual',
    resourceId: 101,
    tenantId: 'kinab-demo',
  },
  {
    id: 4,
    orderNumber: 'WO-2026-0454',
    status: 'planned',
    customerName: 'ICA Maxi Mölndal',
    address: 'Göteborgsvägen 88',
    city: 'Mölndal',
    postalCode: '431 37',
    latitude: 57.6557,
    longitude: 12.0134,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '11:00',
    scheduledTimeEnd: '11:30',
    description: 'Tömning av komprimator - Kartong och plast',
    objectType: 'Komprimator',
    objectId: 504,
    clusterId: 12,
    clusterName: 'Mölndal',
    priority: 'normal',
    object: { id: 504, name: 'ICA Maxi Komprimator', address: 'Göteborgsvägen 88', latitude: 57.6557, longitude: 12.0134 },
    customer: { id: 204, name: 'ICA Maxi Mölndal', customerNumber: 'KN-2204' },
    articles: [
      { id: 7, name: 'Kartongkomprimator', articleNumber: 'ART-007', unit: 'st', quantity: 1, category: 'Återvinning', isSeasonal: false },
      { id: 8, name: 'Plastkomprimator', articleNumber: 'ART-008', unit: 'st', quantity: 1, category: 'Återvinning', isSeasonal: false },
    ],
    contacts: [
      { id: 5, name: 'Per Nilsson', phone: '071-234 56 78', role: 'Butikschef' },
    ],
    estimatedDuration: 25,
    photos: [],
    deviations: [],
    sortOrder: 4,
    executionCodes: [{ id: 1, code: 'TÖM', name: 'Tömning' }],
    timeRestrictions: [
      { id: 4, type: 'emptying_day', description: 'Tömning endast mån, ons, fre', dayOfWeek: 1, isActive: false },
    ],
    subSteps: [],
    dependencies: [
      { id: 2, dependsOnOrderId: 3, dependsOnOrderNumber: 'WO-2026-0453', dependsOnStatus: 'dispatched', isBlocking: true },
    ],
    isLocked: true,
    orderNotes: [],
    inspections: [],
    creationMethod: 'schema',
    resourceId: 101,
    tenantId: 'kinab-demo',
  },
  {
    id: 5,
    orderNumber: 'WO-2026-0455',
    status: 'planned',
    customerName: 'Göteborgs Hamn AB',
    address: 'Terminalgatan 2',
    city: 'Göteborg',
    postalCode: '403 14',
    latitude: 57.7148,
    longitude: 11.9414,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '13:00',
    scheduledTimeEnd: '14:00',
    description: 'Hämtning av farligt avfall - Oljor och kemikalier',
    notes: 'Säkerhetsutrustning krävs. Kontakta hamnchefen vid ankomst.',
    objectType: 'Kärl',
    objectId: 505,
    priority: 'urgent',
    object: { id: 505, name: 'Hamn Terminal 2', address: 'Terminalgatan 2', latitude: 57.7148, longitude: 11.9414 },
    customer: { id: 205, name: 'Göteborgs Hamn AB', customerNumber: 'KN-2205' },
    articles: [
      { id: 9, name: 'Spillolja 200L fat', articleNumber: 'ART-009', unit: 'st', quantity: 2, category: 'Farligt avfall', isSeasonal: false },
      { id: 10, name: 'Kemikaliecontainer', articleNumber: 'ART-010', unit: 'st', quantity: 1, category: 'Farligt avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 6, name: 'Karin Holm', phone: '031-368 75 00', email: 'karin.holm@port.goteborg.se', role: 'Hamnchef' },
    ],
    estimatedDuration: 45,
    photos: [],
    deviations: [],
    sortOrder: 5,
    executionCodes: [
      { id: 3, code: 'FARL', name: 'Farligt avfall' },
      { id: 4, code: 'SPEC', name: 'Specialuppdrag' },
    ],
    timeRestrictions: [],
    subSteps: [
      { id: 10, name: 'Kontrollera säkerhetsutrustning', articleName: 'Spillolja 200L fat', completed: false, sortOrder: 1 },
      { id: 11, name: 'Dokumentera fat-ID', articleName: 'Spillolja 200L fat', completed: false, sortOrder: 2 },
      { id: 12, name: 'Lasta fat', articleName: 'Spillolja 200L fat', completed: false, sortOrder: 3 },
      { id: 13, name: 'Lasta kemikaliecontainer', articleName: 'Kemikaliecontainer', completed: false, sortOrder: 4 },
      { id: 14, name: 'Signera transportdokument', articleName: 'Kemikaliecontainer', completed: false, sortOrder: 5 },
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 3, orderId: 5, text: 'ADR-certifikat krävs för denna transport', createdBy: 'System', createdAt: new Date(Date.now() - 3600000).toISOString() },
      { id: 4, orderId: 5, text: 'Kontakta hamnchef Karin Holm minst 30 min innan ankomst', createdBy: 'Planerare', createdAt: new Date(Date.now() - 7200000).toISOString() },
    ],
    inspections: [],
    creationMethod: 'avrop',
    resourceId: 101,
    tenantId: 'kinab-demo',
  },
];

const MOCK_ARTICLES = [
  { id: 1, name: 'Hushållsavfall 140L', articleNumber: 'ART-001', unit: 'st', category: 'Avfall' },
  { id: 2, name: 'Hushållsavfall 370L', articleNumber: 'ART-002', unit: 'st', category: 'Avfall' },
  { id: 3, name: 'Matavfall 140L', articleNumber: 'ART-003', unit: 'st', category: 'Avfall' },
  { id: 4, name: 'Restavfall 660L', articleNumber: 'ART-004', unit: 'st', category: 'Avfall' },
  { id: 5, name: 'Kartong 660L', articleNumber: 'ART-005', unit: 'st', category: 'Återvinning' },
  { id: 6, name: 'Plast 660L', articleNumber: 'ART-006', unit: 'st', category: 'Återvinning' },
  { id: 7, name: 'Glas - färgat 600L', articleNumber: 'ART-007', unit: 'st', category: 'Återvinning' },
  { id: 8, name: 'Glas - ofärgat 600L', articleNumber: 'ART-008', unit: 'st', category: 'Återvinning' },
  { id: 9, name: 'Metall 240L', articleNumber: 'ART-009', unit: 'st', category: 'Återvinning' },
  { id: 10, name: 'Tidningar 660L', articleNumber: 'ART-010', unit: 'st', category: 'Återvinning' },
  { id: 11, name: 'Trädgårdsavfall 370L', articleNumber: 'ART-011', unit: 'st', category: 'Avfall' },
  { id: 12, name: 'Byggavfall container 8m³', articleNumber: 'ART-012', unit: 'st', category: 'Bygg' },
  { id: 13, name: 'Verksamhetsavfall 1100L', articleNumber: 'ART-013', unit: 'st', category: 'Avfall' },
  { id: 14, name: 'Spillolja 200L fat', articleNumber: 'ART-014', unit: 'st', category: 'Farligt avfall' },
  { id: 15, name: 'Kemikaliecontainer', articleNumber: 'ART-015', unit: 'st', category: 'Farligt avfall' },
];

const MOCK_CHECKLIST_TEMPLATES: Record<string, any> = {
  'Kärl': {
    templateId: 'tmpl-karl',
    name: 'Kärlkontroll',
    articleType: 'Kärl',
    questions: [
      { id: 'q1', text: 'Är kärlet skadat?', type: 'boolean', photoRequired: true, photoType: 'before_after' },
      { id: 'q2', text: 'Är kärlet överfyllt?', type: 'boolean', photoRequired: true, photoType: 'single' },
      { id: 'q3', text: 'Finns felsortering?', type: 'boolean', photoRequired: true, photoType: 'single' },
      { id: 'q4', text: 'Tillgänglighet', type: 'select', options: ['Bra', 'Begränsad', 'Blockerad'] },
      { id: 'q5', text: 'Kommentar', type: 'text' },
    ],
  },
  'Container': {
    templateId: 'tmpl-container',
    name: 'Containerkontroll',
    articleType: 'Container',
    questions: [
      { id: 'q1', text: 'Är containern skadad?', type: 'boolean', photoRequired: true, photoType: 'before_after' },
      { id: 'q2', text: 'Finns läckage?', type: 'boolean', photoRequired: true, photoType: 'single' },
      { id: 'q3', text: 'Fyllnadsgrad', type: 'select', options: ['Under 50%', '50-75%', '75-100%', 'Överfylld'] },
      { id: 'q4', text: 'Kommentar', type: 'text' },
    ],
  },
  'Komprimator': {
    templateId: 'tmpl-komprimator',
    name: 'Komprimatorkontroll',
    articleType: 'Komprimator',
    questions: [
      { id: 'q1', text: 'Fungerar komprimatorn?', type: 'boolean', photoRequired: true, photoType: 'single' },
      { id: 'q2', text: 'Finns hydraulikläckage?', type: 'boolean', photoRequired: true, photoType: 'single' },
      { id: 'q3', text: 'Fyllnadsgrad', type: 'select', options: ['Under 50%', '50-75%', '75-100%', 'Överfylld'] },
      { id: 'q4', text: 'Kommentar', type: 'text' },
    ],
  },
};

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapKinabStatus(kinabStatus: string, orderStatus?: string): string {
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
  return statusMap[kinabStatus] || statusMap[orderStatus || ''] || 'planned';
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

function transformKinabOrder(raw: any): any {
  const addrParts = parseAddressParts(raw.objectAddress || '');
  return {
    id: raw.id,
    orderNumber: raw.title || raw.externalReference || `ORD-${(raw.id || '').toString().slice(0, 8)}`,
    status: mapKinabStatus(raw.status, raw.orderStatus),
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
    creationMethod: raw.creationMethod || 'manual',
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

router.post('/login', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { username, password, pin } = req.body;
    if (pin) {
      if (pin.length === 4 || pin.length === 6) {
        res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
      } else {
        res.status(401).json({ success: false, error: 'Ogiltig PIN-kod' });
      }
    } else if (username && password) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else {
      res.status(401).json({ success: false, error: 'Ogiltiga inloggningsuppgifter' });
    }
    return;
  }

  try {
    const { status, data } = await kinabFetch('/api/mobile/login', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });

    if (status === 200 && data.token) {
      const resource = data.resource || data.user || {};
      res.json({
        success: true,
        token: data.token,
        resource,
      });
    } else {
      res.status(status || 401).json({
        success: false,
        error: data.error || data.message || 'Inloggningen misslyckades',
      });
    }
  } catch (error: any) {
    console.error('Login proxy error, falling back to mock login:', error.message);
    const { username, password, pin } = req.body;
    if (pin && (pin.length === 4 || pin.length === 6)) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else if (username && password) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else {
      res.status(503).json({
        success: false,
        error: 'Kunde inte nå inloggningsservern. Försök igen om en stund.',
      });
    }
  }
});

router.post('/logout', async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ success: true });
    return;
  }

  try {
    const { status, data } = await kinabFetch('/api/mobile/logout', {
      method: 'POST',
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch {
    res.json({ success: true });
  }
});

router.get('/me', async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, resource: MOCK_RESOURCE });
    } else {
      res.status(401).json({ success: false, error: 'Ej autentiserad' });
    }
    return;
  }

  try {
    const { status, data } = await kinabFetch('/api/mobile/me', {
      method: 'GET',
      headers: getAuthHeader(req),
    });

    if (status === 200) {
      if (data.success !== undefined) {
        res.json(data);
      } else {
        res.json({ success: true, resource: data });
      }
    } else {
      res.status(status).json({
        success: false,
        error: data.error || data.message || 'Ej autentiserad',
      });
    }
  } catch (error: any) {
    console.error('Me proxy error:', error.message);
    res.status(503).json({
      success: false,
      error: 'Kunde inte verifiera sessionen. Försök igen.',
    });
  }
});

router.get('/my-orders', async (req, res) => {
  if (IS_MOCK_MODE) {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const orders = MOCK_ORDERS.filter(o => o.scheduledDate === date);
    res.json(orders);
    return;
  }

  try {
    const queryString = req.query.date ? `?date=${req.query.date}` : '';
    const { status, data } = await kinabFetch(`/api/mobile/my-orders${queryString}`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    if (status === 200) {
      const rawOrders = Array.isArray(data) ? data : (data.orders || []);
      const transformed = rawOrders.map(transformKinabOrder);
      res.json(transformed);
    } else {
      res.status(status).json(data);
    }
  } catch (error: any) {
    console.error('My-orders proxy error:', error.message);
    res.status(503).json({ error: 'Kunde inte hämta ordrar. Försök igen.' });
  }
});

router.get('/orders/:id', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order hittades inte' });
    }
    return;
  }

  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    if (status === 200 && data) {
      res.json(transformKinabOrder(data));
    } else {
      res.status(status).json(data);
    }
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte hämta order. Försök igen.' });
  }
});

router.get('/orders/:id/checklist', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (!order) {
      res.status(404).json({ error: 'Order hittades inte' });
      return;
    }
    const articleTypes = [...new Set(order.articles.map((a: any) => a.category))] as string[];
    const objectTemplate = MOCK_CHECKLIST_TEMPLATES[order.objectType];
    const checklists = objectTemplate ? [objectTemplate] : [];
    res.json({ orderId: order.id.toString(), articleTypes, checklists });
    return;
  }

  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/checklist`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte hämta checklista. Försök igen.' });
  }
});

router.patch('/orders/:id/status', async (req, res) => {
  const { status: newStatus } = req.body;
  const allowedStatuses = ['planned', 'dispatched', 'on_site', 'in_progress', 'completed', 'failed', 'cancelled', 'planerad_pre', 'planerad_resurs', 'planerad_las', 'utford', 'fakturerad', 'impossible'];
  if (!newStatus || typeof newStatus !== 'string') {
    return res.status(400).json({ error: 'Status krävs' });
  }
  if (!allowedStatuses.includes(newStatus)) {
    return res.status(400).json({ error: `Ogiltig status: ${newStatus}` });
  }
  const io = (req.app as any).io;
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (order) {
      if (order.isLocked) {
        res.status(403).json({ error: 'Uppdraget är låst - beroende uppdrag ej slutförda' });
        return;
      }
      order.status = newStatus;
      if (newStatus === 'on_site' || newStatus === 'in_progress' || newStatus === 'planerad_las') {
        order.actualStartTime = order.actualStartTime || new Date().toISOString();
      }
      if (newStatus === 'completed' || newStatus === 'utford') {
        order.completedAt = new Date().toISOString();
        order.actualEndTime = new Date().toISOString();
      }
      if (newStatus === 'failed' || newStatus === 'impossible') {
        order.actualEndTime = new Date().toISOString();
        if (req.body.impossibleReason) {
          order.impossibleReason = req.body.impossibleReason;
          order.impossibleAt = new Date().toISOString();
        }
      }
      if (newStatus === 'fakturerad') {
        order.completedAt = order.completedAt || new Date().toISOString();
      }
      if (io) {
        io.emit('order:updated', { orderId: order.id, status: order.status, updatedAt: new Date().toISOString() });
      }
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order hittades inte' });
    }
    return;
  }

  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/status`, {
      method: 'PATCH',
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte uppdatera status. Försök igen.' });
  }
});

router.post('/orders/:id/deviations', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const deviation = { id: Date.now(), orderId, ...req.body, createdAt: new Date().toISOString() };
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (order) order.deviations.push(deviation);
    res.json(deviation);
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/deviations`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) { console.error('Deviation proxy error:', error?.message); res.status(503).json({ error: 'Kunde inte rapportera avvikelse.' }); }
});

router.post('/orders/:id/materials', async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ id: Date.now(), orderId: parseInt(req.params.id), ...req.body, createdAt: new Date().toISOString() });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/materials`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) { console.error('Material proxy error:', error?.message); res.status(503).json({ error: 'Kunde inte logga material.' }); }
});

router.post('/orders/:id/signature', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (order) { order.signatureUrl = req.body.signatureData; res.json({ success: true }); }
    else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/signature`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) { console.error('Signature proxy error:', error?.message); res.status(503).json({ error: 'Kunde inte spara signatur.' }); }
});

router.post('/orders/:id/notes', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (order) {
      const note = { id: Date.now(), orderId, text: req.body.text, createdBy: 'Chaufför', createdAt: new Date().toISOString() };
      if (!order.orderNotes) order.orderNotes = [];
      order.orderNotes.push(note);
      res.json(note);
    } else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/notes`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte spara anteckning.' }); }
});

router.patch('/orders/:id/substeps/:stepId', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (order && order.subSteps) {
      const step = order.subSteps.find((s: any) => s.id === parseInt(req.params.stepId));
      if (step) { step.completed = req.body.completed; res.json(step); }
      else res.status(404).json({ error: 'Delsteg hittades inte' });
    } else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/substeps/${req.params.stepId}`, {
      method: 'PATCH', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte uppdatera delsteg.' }); }
});

router.post('/orders/:id/inspections', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (order) { order.inspections = req.body.inspections; res.json({ success: true, inspections: order.inspections }); }
    else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/inspections`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte spara inspektion.' }); }
});

router.post('/orders/:id/upload-photo', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (!order) { res.status(404).json({ error: 'Order hittades inte' }); return; }
    const photoId = `photo-${Date.now()}`;
    res.json({ success: true, photoId, presignedUrl: `/api/mobile/photos/${photoId}/upload`, confirmUrl: `/api/mobile/orders/${orderId}/confirm-photo` });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/upload-photo`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hämta uppladdnings-URL.' }); }
});

router.post('/orders/:id/confirm-photo', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
    if (order) { const photoUrl = `/photos/${req.body.photoId}.jpg`; order.photos.push(photoUrl); res.json({ success: true, photoUrl }); }
    else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/orders/${req.params.id}/confirm-photo`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte bekräfta foto.' }); }
});

router.get('/notifications', async (req, res) => {
  if (IS_MOCK_MODE) { res.json(MOCK_NOTIFICATIONS); return; }
  try {
    const { status, data } = await kinabFetch('/api/mobile/notifications', { method: 'GET', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.json(MOCK_NOTIFICATIONS); }
});

router.patch('/notifications/:id/read', async (req, res) => {
  if (IS_MOCK_MODE) {
    const notification = MOCK_NOTIFICATIONS.find(n => n.id === req.params.id);
    if (notification) { notification.isRead = true; res.json(notification); }
    else res.status(404).json({ error: 'Notifikation hittades inte' });
    return;
  }
  try {
    const { status, data } = await kinabFetch(`/api/mobile/notifications/${req.params.id}/read`, {
      method: 'PATCH', headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte markera notifikation.' }); }
});

router.patch('/notifications/read-all', async (req, res) => {
  if (IS_MOCK_MODE) { MOCK_NOTIFICATIONS.forEach(n => { n.isRead = true; }); res.json({ success: true }); return; }
  try {
    const { status, data } = await kinabFetch('/api/mobile/notifications/read-all', {
      method: 'PATCH', headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch { res.json({ success: true }); }
});

router.post('/sync', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { actions } = req.body;
    if (!Array.isArray(actions)) { res.status(400).json({ error: 'actions måste vara en array' }); return; }
    const results = actions.map((action: any) => ({ clientId: action.clientId, success: true, serverTimestamp: new Date().toISOString() }));
    res.json({ success: true, results });
    return;
  }
  try {
    const { status, data } = await kinabFetch('/api/mobile/sync', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Synkronisering misslyckades.' }); }
});

router.get('/sync/status', async (req, res) => {
  res.json({ lastSync: new Date().toISOString(), pendingActions: 0 });
});

router.get('/articles', (req, res) => {
  const search = (req.query.search as string || '').toLowerCase();
  if (search) {
    res.json(MOCK_ARTICLES.filter(a => a.name.toLowerCase().includes(search)));
  } else {
    res.json(MOCK_ARTICLES);
  }
});

router.post('/position', async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy } = req.body;

  if (latitude == null || longitude == null || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Giltiga latitude och longitude krävs' });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Koordinater utanför giltigt intervall' });
  }

  if (!IS_MOCK_MODE) {
    try {
      await kinabFetch('/api/mobile/position', {
        method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
      });
    } catch (e: any) {
      console.error('Kinab position proxy error:', e.message);
    }
  }

  try {
    if (latitude != null && longitude != null) {
      const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : 'unknown';
      const driverName = IS_MOCK_MODE ? MOCK_RESOURCE.name : 'Okänd';
      const vehicleRegNo = IS_MOCK_MODE ? MOCK_RESOURCE.vehicleRegNo : '';
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, speed, heading, accuracy, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           driver_name = EXCLUDED.driver_name,
           vehicle_reg_no = EXCLUDED.vehicle_reg_no,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           speed = COALESCE(EXCLUDED.speed, driver_locations.speed),
           heading = COALESCE(EXCLUDED.heading, driver_locations.heading),
           accuracy = COALESCE(EXCLUDED.accuracy, driver_locations.accuracy),
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName, vehicleRegNo, latitude, longitude, speed || 0, heading || 0, accuracy || 0]
      );
    }
    res.json({ received: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving GPS position:', error);
    res.json({ received: true, timestamp: new Date().toISOString() });
  }
});

router.post('/status', async (req, res) => {
  const { online } = req.body;
  try {
    const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : 'unknown';
    const driverName = IS_MOCK_MODE ? MOCK_RESOURCE.name : 'Okänd';
    const vehicleRegNo = IS_MOCK_MODE ? MOCK_RESOURCE.vehicleRegNo : '';
    if (online) {
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, status, updated_at)
         VALUES ($1, $2, $3, 0, 0, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName, vehicleRegNo]
      );
    } else {
      await pool.query(
        `UPDATE driver_locations SET status = 'offline', updated_at = NOW() WHERE driver_id = $1`,
        [driverId]
      );
    }
    res.json({ success: true, online });
  } catch (error) {
    console.error('Error updating driver status:', error);
    res.json({ success: true, online });
  }
});

router.post('/gps', async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy, driverId, driverName, vehicleRegNo, currentOrderId, currentOrderNumber } = req.body;

  if (latitude == null || longitude == null || !driverId) {
    return res.status(400).json({ error: 'latitude, longitude och driverId krävs' });
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Koordinater måste vara nummer' });
  }

  try {
    if (latitude != null && longitude != null && driverId) {
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, speed, heading, accuracy, current_order_id, current_order_number, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           driver_name = EXCLUDED.driver_name,
           vehicle_reg_no = EXCLUDED.vehicle_reg_no,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           speed = COALESCE(EXCLUDED.speed, driver_locations.speed),
           heading = COALESCE(EXCLUDED.heading, driver_locations.heading),
           accuracy = COALESCE(EXCLUDED.accuracy, driver_locations.accuracy),
           current_order_id = EXCLUDED.current_order_id,
           current_order_number = EXCLUDED.current_order_number,
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName || 'Okänd', vehicleRegNo, latitude, longitude, speed || 0, heading || 0, accuracy || 0, currentOrderId, currentOrderNumber]
      );
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Error saving GPS position:', error);
    res.json({ received: true });
  }
});

router.get('/weather', async (_req, res) => {
  try {
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=57.7089&longitude=11.9746&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe/Stockholm&forecast_days=1'
    );
    const data = await response.json();
    const current = data.current;

    const weatherDescriptions: Record<number, string> = {
      0: 'Klart', 1: 'Mestadels klart', 2: 'Delvis molnigt', 3: 'Mulet',
      45: 'Dimma', 48: 'Dimma med rimfrost',
      51: 'Lätt duggregn', 53: 'Måttligt duggregn', 55: 'Kraftigt duggregn',
      61: 'Lätt regn', 63: 'Måttligt regn', 65: 'Kraftigt regn',
      71: 'Lätt snöfall', 73: 'Måttligt snöfall', 75: 'Kraftigt snöfall', 77: 'Snökorn',
      80: 'Lätta regnskurar', 81: 'Måttliga regnskurar', 82: 'Kraftiga regnskurar',
      85: 'Lätta snöbyar', 86: 'Kraftiga snöbyar',
      95: 'Åskväder', 96: 'Åskväder med hagel', 99: 'Åskväder med kraftigt hagel',
    };

    const weatherIcons: Record<number, string> = {
      0: 'sun', 1: 'sun', 2: 'cloud', 3: 'cloud',
      45: 'cloud', 48: 'cloud',
      51: 'cloud-drizzle', 53: 'cloud-drizzle', 55: 'cloud-drizzle',
      61: 'cloud-rain', 63: 'cloud-rain', 65: 'cloud-rain',
      71: 'cloud-snow', 73: 'cloud-snow', 75: 'cloud-snow', 77: 'cloud-snow',
      80: 'cloud-rain', 81: 'cloud-rain', 82: 'cloud-rain',
      85: 'cloud-snow', 86: 'cloud-snow',
      95: 'cloud-lightning', 96: 'cloud-lightning', 99: 'cloud-lightning',
    };

    const code = current.weather_code;
    const warnings: string[] = [];
    if (current.wind_speed_10m > 15) warnings.push('Blåsigt väder');
    if (current.precipitation > 5) warnings.push('Kraftig nederbörd');
    if (current.temperature_2m < 0) warnings.push('Minusgrader - halkrisk');
    if (code >= 95) warnings.push('Åskvarning');

    res.json({
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      description: weatherDescriptions[code] || 'Okänt',
      icon: weatherIcons[code] || 'cloud',
      windSpeed: Math.round(current.wind_speed_10m),
      precipitation: current.precipitation,
      warnings,
    });
  } catch (error) {
    res.json({
      temperature: 8,
      feelsLike: 5,
      description: 'Delvis molnigt',
      icon: 'cloud',
      windSpeed: 12,
      precipitation: 0,
      warnings: [],
    });
  }
});

router.get('/summary', async (req, res) => {
  if (IS_MOCK_MODE) {
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = MOCK_ORDERS.filter(o => o.scheduledDate === today);
    const remaining = todayOrders.filter(o => o.status !== 'completed' && o.status !== 'cancelled' && o.status !== 'failed');

    let totalDistance = 0;
    const sortedOrders = [...todayOrders].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 1; i < sortedOrders.length; i++) {
      const prev = sortedOrders[i - 1];
      const curr = sortedOrders[i];
      if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
        totalDistance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      }
    }

    res.json({
      totalOrders: todayOrders.length,
      completedOrders: todayOrders.filter(o => o.status === 'completed').length,
      remainingOrders: remaining.length,
      failedOrders: todayOrders.filter(o => o.status === 'failed').length,
      totalDuration: todayOrders.reduce((sum, o) => sum + o.estimatedDuration, 0),
      estimatedTimeRemaining: remaining.reduce((sum, o) => sum + o.estimatedDuration, 0),
      totalDistance: Math.round(totalDistance * 10) / 10,
    });
    return;
  }
  try {
    const { status: summaryStatus, data: summaryData } = await kinabFetch('/api/mobile/summary', {
      method: 'GET', headers: getAuthHeader(req),
    });
    if (summaryStatus === 200 && summaryData && summaryData.totalOrders !== undefined) {
      res.json(summaryData);
      return;
    }
  } catch {}
  try {
    const { status: ordersStatus, data: ordersData } = await kinabFetch('/api/mobile/my-orders', {
      method: 'GET', headers: getAuthHeader(req),
    });
    if (ordersStatus === 200) {
      const rawOrders = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
      const completed = rawOrders.filter((o: any) => o.status === 'completed').length;
      const failed = rawOrders.filter((o: any) => o.status === 'failed' || o.status === 'impossible').length;
      const cancelled = rawOrders.filter((o: any) => o.status === 'cancelled').length;
      const remaining = rawOrders.length - completed - failed - cancelled;
      res.json({
        totalOrders: rawOrders.length,
        completedOrders: completed,
        remainingOrders: remaining,
        failedOrders: failed,
        totalDuration: rawOrders.reduce((sum: number, o: any) => sum + (o.estimatedDuration || 0), 0),
        estimatedTimeRemaining: rawOrders.filter((o: any) => o.status !== 'completed' && o.status !== 'failed' && o.status !== 'cancelled')
          .reduce((sum: number, o: any) => sum + (o.estimatedDuration || 0), 0),
      });
    } else {
      res.json({ totalOrders: 0, completedOrders: 0, remainingOrders: 0, failedOrders: 0, totalDuration: 0, estimatedTimeRemaining: 0 });
    }
  } catch {
    res.json({ totalOrders: 0, completedOrders: 0, remainingOrders: 0, failedOrders: 0, totalDuration: 0, estimatedTimeRemaining: 0 });
  }
});

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

router.get('/route', async (req, res) => {
  const rawCoords = req.query.coords;
  const coords = typeof rawCoords === 'string' ? decodeURIComponent(rawCoords).trim() : '';
  console.log('[route] raw coords type:', typeof rawCoords, 'value:', JSON.stringify(rawCoords), 'decoded length:', coords.length, 'hasApiKey:', !!process.env.GEOAPIFY_API_KEY);
  if (!coords) {
    return res.status(400).json({ error: 'coords parameter required (lon1,lat1;lon2,lat2;...)' });
  }

  const parsed = parseCoordPoints(coords);
  if (!parsed || parsed.length < 2 || parsed.length > 25) {
    return res.status(400).json({ error: 'Between 2 and 25 valid coordinate pairs required' });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.warn('[route] GEOAPIFY_API_KEY not set, returning fallback');
    return res.json(buildFallbackResponse(parsed));
  }

  const waypoints = parsed.map(p => `${p.lat},${p.lon}`).join('|');
  const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&details=route_details&apiKey=${apiKey}`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    console.log('[route] Geoapify response status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('[route] Geoapify error:', response.status, text.substring(0, 300));
      return res.json(buildFallbackResponse(parsed));
    }

    const data = await response.json();
    const features = data?.features;
    if (!features || features.length === 0) {
      console.error('[route] Geoapify: no features in response');
      return res.json(buildFallbackResponse(parsed));
    }

    const feature = features[0];
    const props = feature.properties;
    const geometry = feature.geometry;

    let allCoordinates: number[][] = [];
    if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        allCoordinates = allCoordinates.concat(line);
      }
    } else if (geometry.type === 'LineString') {
      allCoordinates = geometry.coordinates;
    }

    const legs = (props.legs || []).map((leg: any) => ({
      distance: leg.distance || 0,
      duration: leg.time || 0,
      steps: (leg.steps || []).map((step: any) => ({
        geometry: step.geometry || null,
        distance: step.distance || 0,
        duration: step.time || 0,
      })),
    }));

    console.log('[route] Success: coords=', allCoordinates.length, 'dist=', props.distance, 'dur=', props.time);
    res.json({
      waypoints: parsed.map((p, i) => ({
        location: [p.lon, p.lat],
        waypointIndex: i,
        tripsIndex: 0,
      })),
      trips: [{
        geometry: { type: 'LineString', coordinates: allCoordinates },
        distance: props.distance || 0,
        duration: props.time || 0,
        legs,
      }],
    });
  } catch (error: any) {
    clearTimeout(timeout);
    console.error('[route] Geoapify fetch error:', error.message);
    res.json(buildFallbackResponse(parsed));
  }
});

router.get('/route-optimized', async (req, res) => {
  const coords = req.query.coords as string;
  if (!coords) {
    return res.status(400).json({ error: 'coords parameter required (lon1,lat1;lon2,lat2;...)' });
  }

  const parsed = parseCoordPoints(coords);
  if (!parsed || parsed.length < 2 || parsed.length > 25) {
    return res.status(400).json({ error: 'Between 2 and 25 valid coordinate pairs required' });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.warn('GEOAPIFY_API_KEY not set, returning fallback');
    return res.json(buildFallbackResponse(parsed));
  }

  const startPoint = parsed[0];
  const jobPoints = parsed.slice(1);

  const body = {
    mode: 'drive',
    agents: [{
      start_location: [startPoint.lon, startPoint.lat],
    }],
    jobs: jobPoints.map((p, i) => ({
      id: `job_${i}`,
      location: [p.lon, p.lat],
      duration: 600,
    })),
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);

  try {
    const response = await fetch(`https://api.geoapify.com/v1/routeplanner?apiKey=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      console.error('Geoapify planner error:', response.status, text.substring(0, 300));
      return res.json(buildFallbackResponse(parsed));
    }

    const data = await response.json();
    const features = data?.features;
    if (!features || features.length === 0) {
      console.error('Geoapify planner: no features');
      return res.json(buildFallbackResponse(parsed));
    }

    const agentFeature = features.find((f: any) => f.properties?.agent_index !== undefined);
    if (!agentFeature) {
      console.error('Geoapify planner: no agent feature found');
      return res.json(buildFallbackResponse(parsed));
    }

    const props = agentFeature.properties;
    const geometry = agentFeature.geometry;

    let allCoordinates: number[][] = [];
    if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        allCoordinates = allCoordinates.concat(line);
      }
    } else if (geometry.type === 'LineString') {
      allCoordinates = geometry.coordinates;
    }

    const actions = props.actions || [];
    const jobActions = actions.filter((a: any) => a.type === 'job');
    const optimizedOrder: number[] = [];
    for (const a of jobActions) {
      const jobIdx = parseInt(a.job_id?.replace('job_', '') || '-1', 10);
      if (jobIdx >= 0 && jobIdx < jobPoints.length) {
        optimizedOrder.push(jobIdx + 1);
      }
    }

    if (optimizedOrder.length === 0) {
      console.warn('Geoapify planner: no valid job actions found');
      return res.json(buildFallbackResponse(parsed));
    }

    const allIndices = [0, ...optimizedOrder];
    const reorderedWaypoints = allIndices.map((origIdx) => ({
      location: [parsed[origIdx].lon, parsed[origIdx].lat],
      waypointIndex: origIdx,
      tripsIndex: 0,
    }));

    const reorderedPoints = allIndices.map(i => parsed[i]);
    const routeWaypoints = reorderedPoints.map(p => `${p.lat},${p.lon}`).join('|');
    const routeUrl = `https://api.geoapify.com/v1/routing?waypoints=${routeWaypoints}&mode=drive&details=route_details&apiKey=${apiKey}`;

    const ctrl2 = new AbortController();
    const timeout2 = setTimeout(() => ctrl2.abort(), 15000);
    try {
      const routeResp = await fetch(routeUrl, { signal: ctrl2.signal });
      clearTimeout(timeout2);

      if (routeResp.ok) {
        const routeData = await routeResp.json();
        const routeFeature = routeData?.features?.[0];
        if (routeFeature) {
          const routeGeom = routeFeature.geometry;
          let routeCoords: number[][] = [];
          if (routeGeom.type === 'MultiLineString') {
            for (const line of routeGeom.coordinates) {
              routeCoords = routeCoords.concat(line);
            }
          } else if (routeGeom.type === 'LineString') {
            routeCoords = routeGeom.coordinates;
          }

          const routeProps = routeFeature.properties;
          const routeLegs = (routeProps.legs || []).map((leg: any) => ({
            distance: leg.distance || 0,
            duration: leg.time || 0,
            steps: (leg.steps || []).map((step: any) => ({
              geometry: step.geometry || null,
              distance: step.distance || 0,
              duration: step.time || 0,
            })),
          }));

          return res.json({
            waypoints: reorderedWaypoints,
            trips: [{
              geometry: { type: 'LineString', coordinates: routeCoords },
              distance: routeProps.distance || props.distance || 0,
              duration: routeProps.time || props.time || 0,
              legs: routeLegs,
            }],
            optimized: true,
          });
        }
      }
    } catch (routeErr: any) {
      clearTimeout(timeout2);
      console.warn('Geoapify routing for optimized order failed:', routeErr.message);
    }

    const legs = (props.legs || []).map((leg: any) => ({
      distance: leg.distance || 0,
      duration: leg.time || 0,
      steps: [],
    }));

    res.json({
      waypoints: reorderedWaypoints,
      trips: [{
        geometry: { type: 'LineString', coordinates: allCoordinates },
        distance: props.distance || 0,
        duration: props.time || 0,
        legs,
      }],
      optimized: true,
    });
  } catch (error: any) {
    clearTimeout(timeout);
    console.error('Geoapify planner fetch error:', error.message);
    res.json(buildFallbackResponse(parsed));
  }
});

export { router as mobileRoutes, MOCK_ORDERS };
