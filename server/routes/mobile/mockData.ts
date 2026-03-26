const MOCK_RESOURCE = {
  id: 101,
  tenantId: 'traivo-demo',
  name: 'Erik Lindqvist',
  type: 'driver',
  role: 'technician',
  phone: '070-111 22 33',
  email: 'erik.lindqvist@traivo.se',
  vehicleRegNo: 'ABC 123',
  homeLatitude: 59.1950,
  homeLongitude: 17.6260,
  competencies: ['ADR', 'YKB', 'C-körkort'],
  executionCodes: ['TÖM', 'HÄMT', 'FARL'],
};

const MOCK_TOKEN = 'mock-driver-token-001';

const MOCK_PROFILES = [
  {
    id: 'rpa-1',
    resourceId: MOCK_RESOURCE.id,
    profileId: 'rp-1',
    profile: {
      id: 'rp-1',
      name: 'Körprofil Lastbil',
      color: '#1B4B6B',
      icon: 'truck',
      executionCodes: ['TÖM', 'HÄMT'],
      equipmentTypes: ['Lastbil', 'Kranbil'],
      defaultCostCenter: 'KS-4010',
      projectCode: 'PROJ-2026-A',
    },
    assignedAt: '2026-01-15T08:00:00Z',
    isPrimary: true,
  },
  {
    id: 'rpa-2',
    resourceId: MOCK_RESOURCE.id,
    profileId: 'rp-2',
    profile: {
      id: 'rp-2',
      name: 'Handplock',
      color: '#4A9B9B',
      icon: 'package',
      executionCodes: ['FARL', 'SPEC'],
      equipmentTypes: ['Handkärra'],
      defaultCostCenter: 'KS-5020',
      projectCode: 'PROJ-2026-B',
    },
    assignedAt: '2026-02-01T08:00:00Z',
    isPrimary: false,
  },
];

const MOCK_TEAM: any = {
  id: 'team-1',
  name: 'Team Södertälje',
  description: 'Kranbilsteam för Södertälje',
  color: '#4A9B9B',
  leaderId: MOCK_RESOURCE.id,
  clusterId: 'cluster-gw',
  serviceArea: ['41101', '41102', '41103'],
  projectCode: 'PROJ-2026-A',
  profileId: MOCK_PROFILES[0]?.profileId || null,
  status: 'active' as const,
  members: [
    {
      id: 'tm-1',
      resourceId: MOCK_RESOURCE.id,
      name: MOCK_RESOURCE.name,
      role: 'leader' as const,
      phone: MOCK_RESOURCE.phone,
      email: MOCK_RESOURCE.email,
      isOnline: true,
      latitude: 59.1950,
      longitude: 17.6260,
    },
    {
      id: 'tm-2',
      resourceId: 202,
      name: 'Anna Johansson',
      role: 'member' as const,
      phone: '070-222 33 44',
      email: 'anna.johansson@traivo.se',
      isOnline: true,
      latitude: 59.1900,
      longitude: 17.6350,
    },
  ],
};

const MOCK_RESOURCES = [
  MOCK_RESOURCE,
  { id: 202, name: 'Anna Johansson', phone: '070-222 33 44', email: 'anna.johansson@traivo.se', type: 'driver' },
  { id: 303, name: 'Karl Eriksson', phone: '070-333 44 55', email: 'karl.eriksson@traivo.se', type: 'driver' },
  { id: 404, name: 'Maria Nilsson', phone: '070-444 55 66', email: 'maria.nilsson@traivo.se', type: 'driver' },
];

const MOCK_TEAM_INVITES: any[] = [];

const MOCK_MATERIAL_LOGS: any[] = [];
const MOCK_MAX_LOGS = 500;

const MOCK_NOTIFICATIONS_LEGACY: any[] = [
  { id: 'n1', type: 'schedule_change', title: 'Ruttändring', message: 'Order WO-2026-0453 har flyttats till kl 10:00', isRead: false, createdAt: new Date(Date.now() - 3600000).toISOString(), orderId: '3' },
  { id: 'n2', type: 'urgent', title: 'Brådskande uppdrag', message: 'Nytt hämtuppdrag tillagt: Södertälje Hamn AB', isRead: false, createdAt: new Date(Date.now() - 7200000).toISOString(), orderId: '5' },
  { id: 'n3', type: 'info', title: 'Systeminformation', message: 'Ny version av appen tillgänglig', isRead: true, createdAt: new Date(Date.now() - 86400000).toISOString() },
];

const MOCK_ORDERS: any[] = [
  {
    id: 1,
    orderNumber: 'WO-2026-0451',
    status: 'planerad_resurs',
    customerName: 'BRF Sjöutsikten',
    address: 'Storgatan 15',
    city: 'Södertälje',
    postalCode: '151 72',
    latitude: 59.1955,
    longitude: 17.6253,
    what3words: 'fest.lampa.skog',
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '08:00',
    scheduledTimeEnd: '09:00',
    description: 'Tömning av kärl - Hushållsavfall 370L',
    notes: 'Porten har kod 1234',
    objectType: 'Kärl',
    objectId: 501,
    clusterId: 10,
    clusterName: 'Södertälje Centrum',
    priority: 'normal',
    executionStatus: 'not_started',
    object: { id: 501, name: 'Sopstation Storgatan 15', address: 'Storgatan 15', latitude: 59.1955, longitude: 17.6253, what3words: 'fest.lampa.skog' },
    customer: { id: 201, name: 'BRF Sjöutsikten', customerNumber: 'KN-2201' },
    articles: [
      { id: 1, name: 'Hushållsavfall 370L', articleNumber: 'ART-001', unit: 'st', quantity: 4, category: 'Avfall', isSeasonal: false },
      { id: 2, name: 'Matavfall 140L', articleNumber: 'ART-002', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 1, name: 'Anna Karlsson', phone: '070-123 45 67', email: 'anna@brfsjoutsikten.se', role: 'Fastighetsskötare' },
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
    tenantId: 'traivo-demo',
    plannedNotes: 'Porten har ny kod sedan 15 mars. Ring kunden om den inte fungerar.',
    taskLatitude: 59.1955,
    taskLongitude: 17.6253,
    objectAccessCode: '1234',
    objectKeyNumber: null,
    metadata: { fieldNotes: [], materialNeeds: [] },
  },
  {
    id: 2,
    orderNumber: 'WO-2026-0452',
    status: 'planerad_resurs',
    customerName: 'Telge Bostäder AB',
    address: 'Nyköpingsvägen 42',
    city: 'Södertälje',
    postalCode: '151 73',
    latitude: 59.1872,
    longitude: 17.6318,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '09:15',
    scheduledTimeEnd: '09:45',
    description: 'Tömning av kärl - Restavfall och kartong',
    notes: 'Kärlen står i gården, gå genom port till vänster',
    objectType: 'Kärl',
    objectId: 502,
    clusterId: 10,
    clusterName: 'Södertälje Centrum',
    priority: 'normal',
    executionStatus: 'not_started',
    object: { id: 502, name: 'Soprum Nyköpingsvägen', address: 'Nyköpingsvägen 42', latitude: 59.1872, longitude: 17.6318 },
    customer: { id: 202, name: 'Telge Bostäder AB', customerNumber: 'KN-2202' },
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
    tenantId: 'traivo-demo',
    plannedNotes: null,
    taskLatitude: 59.1872,
    taskLongitude: 17.6318,
    objectAccessCode: null,
    objectKeyNumber: 'N-42',
    metadata: { fieldNotes: [], materialNeeds: [] },
  },
  {
    id: 3,
    orderNumber: 'WO-2026-0453',
    status: 'planerad_resurs',
    customerName: 'AstraZeneca Södertälje',
    address: 'Forskargatan 18',
    city: 'Södertälje',
    postalCode: '151 85',
    latitude: 59.1783,
    longitude: 17.6456,
    what3words: 'böcker.glas.rikt',
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '10:00',
    scheduledTimeEnd: '10:45',
    description: 'Tömning av containrar - Bygg och verksamhetsavfall',
    notes: 'Anmäl vid reception vid leveransentrén',
    objectType: 'Container',
    objectId: 503,
    clusterId: 11,
    clusterName: 'Södertälje Syd',
    priority: 'high',
    executionStatus: 'not_started',
    object: { id: 503, name: 'AstraZeneca Leveransentré', address: 'Forskargatan 18', latitude: 59.1783, longitude: 17.6456, what3words: 'böcker.glas.rikt' },
    customer: { id: 203, name: 'AstraZeneca Södertälje', customerNumber: 'KN-2203' },
    articles: [
      { id: 5, name: 'Byggavfall container 8m³', articleNumber: 'ART-005', unit: 'st', quantity: 1, category: 'Bygg', isSeasonal: false },
      { id: 6, name: 'Verksamhetsavfall 1100L', articleNumber: 'ART-006', unit: 'st', quantity: 3, category: 'Avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 3, name: 'Maria Berg', phone: '08-553 260 00', email: 'maria.berg@astrazeneca.com', role: 'Miljösamordnare' },
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
      { id: 2, type: 'quiet_hours', description: 'Tysta timmar 22-07', startTime: '22:00', endTime: '07:00', isActive: false },
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
    tenantId: 'traivo-demo',
    plannedNotes: 'Ny parkeringsplats vid leveransentrén från mars. Använd södra infarten.',
    taskLatitude: 59.1783,
    taskLongitude: 17.6456,
    objectAccessCode: null,
    objectKeyNumber: null,
    metadata: { fieldNotes: [], materialNeeds: [] },
  },
  {
    id: 4,
    orderNumber: 'WO-2026-0454',
    status: 'planerad_resurs',
    customerName: 'ICA Maxi Södertälje',
    address: 'Morabergsvägen 25',
    city: 'Södertälje',
    postalCode: '151 48',
    latitude: 59.2018,
    longitude: 17.6147,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '11:00',
    scheduledTimeEnd: '11:30',
    description: 'Tömning av komprimator - Kartong och plast',
    objectType: 'Komprimator',
    objectId: 504,
    clusterId: 12,
    clusterName: 'Södertälje Norr',
    priority: 'normal',
    executionStatus: 'not_started',
    object: { id: 504, name: 'ICA Maxi Komprimator', address: 'Morabergsvägen 25', latitude: 59.2018, longitude: 17.6147 },
    customer: { id: 204, name: 'ICA Maxi Södertälje', customerNumber: 'KN-2204' },
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
    tenantId: 'traivo-demo',
    plannedNotes: null,
    taskLatitude: null,
    taskLongitude: null,
    objectAccessCode: '5678',
    objectKeyNumber: null,
    metadata: { fieldNotes: [], materialNeeds: [] },
  },
  {
    id: 5,
    orderNumber: 'WO-2026-0455',
    status: 'planerad_resurs',
    customerName: 'Södertälje Hamn AB',
    address: 'Slussvägen 8',
    city: 'Södertälje',
    postalCode: '151 38',
    latitude: 59.2092,
    longitude: 17.6382,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '13:00',
    scheduledTimeEnd: '14:00',
    description: 'Hämtning av farligt avfall - Oljor och kemikalier',
    notes: 'Säkerhetsutrustning krävs. Kontakta hamnchefen vid ankomst.',
    objectType: 'Kärl',
    objectId: 505,
    priority: 'urgent',
    executionStatus: 'not_started',
    object: { id: 505, name: 'Hamn Slussen', address: 'Slussvägen 8', latitude: 59.2092, longitude: 17.6382 },
    customer: { id: 205, name: 'Södertälje Hamn AB', customerNumber: 'KN-2205' },
    articles: [
      { id: 9, name: 'Spillolja 200L fat', articleNumber: 'ART-009', unit: 'st', quantity: 2, category: 'Farligt avfall', isSeasonal: false },
      { id: 10, name: 'Kemikaliecontainer', articleNumber: 'ART-010', unit: 'st', quantity: 1, category: 'Farligt avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 6, name: 'Karin Holm', phone: '08-550 222 00', email: 'karin.holm@sodertaljehamn.se', role: 'Hamnchef' },
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
    tenantId: 'traivo-demo',
    plannedNotes: 'ADR-certifikat krävs. Kontakta hamnchef Karin Holm 30 min innan ankomst.',
    taskLatitude: 59.2092,
    taskLongitude: 17.6382,
    objectAccessCode: null,
    objectKeyNumber: 'H-99',
    metadata: { fieldNotes: [], materialNeeds: [] },
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

let MOCK_WORK_SESSION: any = null;
let MOCK_WORK_SESSION_ENTRIES: any[] = [];

const CHANGE_REQUEST_CATEGORIES = [
  { id: 'antal_karl_andrat', name: 'Antal kärl ändrat', icon: 'package' },
  { id: 'skadat_material', name: 'Skadat material', icon: 'alert-triangle' },
  { id: 'tillganglighet', name: 'Tillgänglighetsproblem', icon: 'map-pin' },
  { id: 'skador', name: 'Skador', icon: 'alert-circle' },
  { id: 'rengorings_behov', name: 'Rengöringsbehov', icon: 'droplet' },
  { id: 'ovrigt', name: 'Övrigt', icon: 'more-horizontal' },
];

const MOCK_CHANGE_REQUESTS: any[] = [
  {
    id: 'cr-1', category: 'skadat_material', description: 'Kärlet har spricka i sidan, läcker vid regn.',
    severity: 'high', status: 'new', objectId: 'obj-101', objectName: 'Kärl 240L - BRF Solsidan',
    customerId: 'cust-1', customerName: 'BRF Solsidan', photos: [],
    reportedByName: 'Erik Lindqvist', reportedByResourceId: '101',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'cr-2', category: 'tillganglighet', description: 'Parkerade bilar blockerar regelbundet infartsvägen till kärlutrymmet.',
    severity: 'medium', status: 'reviewed', objectId: 'obj-202', objectName: 'Container 8m³ - Fastighets AB Norden',
    customerId: 'cust-2', customerName: 'Fastighets AB Norden', photos: [],
    reportedByName: 'Erik Lindqvist', reportedByResourceId: '101',
    reviewedBy: 'Lisa Plansson', reviewedAt: new Date(Date.now() - 86400000).toISOString(),
    reviewNotes: 'Kontaktat fastighetsägaren, skyltar beställda.',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
  {
    id: 'cr-3', category: 'antal_karl_andrat', description: 'Behöver ett extra 370L kärl för trädgårdsavfall.',
    severity: 'low', status: 'resolved', objectId: 'obj-101', objectName: 'Kärl 240L - BRF Solsidan',
    customerId: 'cust-1', customerName: 'BRF Solsidan', photos: [],
    reportedByName: 'Erik Lindqvist', reportedByResourceId: '101',
    reviewedBy: 'Lisa Plansson', reviewedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    reviewNotes: 'Arbetsorder skapad: WO-2026-0500',
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
  },
];

const MOCK_DISRUPTIONS: any[] = [];

interface MockNotification {
  id: number;
  type: 'order_assigned' | 'status_change' | 'team_invite' | 'schedule_change' | 'deviation_reviewed' | 'material_update' | 'sign_off_complete' | 'system';
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  relatedOrderId?: number;
  relatedTeamId?: number;
  metadata?: Record<string, any>;
}

const now = new Date();
const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3600000).toISOString();

const MOCK_NOTIFICATIONS: MockNotification[] = [
  { id: 1, type: 'order_assigned', title: 'Nytt uppdrag tilldelat', body: 'WO-2026-0456 — Volvo Lundby har tilldelats dig.', read: false, createdAt: h(0.5), relatedOrderId: 1 },
  { id: 2, type: 'schedule_change', title: 'Schema ändrat', body: 'Ordningen på dina uppdrag har uppdaterats av planeraren.', read: false, createdAt: h(1.2) },
  { id: 3, type: 'team_invite', title: 'Teaminbjudan', body: 'Anna Svensson har bjudit in dig till Team Södertälje Öst.', read: false, createdAt: h(2) },
  { id: 4, type: 'deviation_reviewed', title: 'Avvikelse granskad', body: 'Din avvikelse "Blockerad infart" på WO-2026-0452 har godkänts.', read: true, createdAt: h(5), relatedOrderId: 2 },
  { id: 5, type: 'status_change', title: 'Order uppdaterad', body: 'WO-2026-0453 har ändrats till "Pågår" av planeraren.', read: true, createdAt: h(8), relatedOrderId: 3 },
  { id: 6, type: 'sign_off_complete', title: 'Kundkvittering mottagen', body: 'Kunden har signerat WO-2026-0451.', read: true, createdAt: h(24), relatedOrderId: 1 },
  { id: 7, type: 'material_update', title: 'Materiallager uppdaterat', body: 'Artikeln "Plastkärl 370L" har fyllts på i lagret.', read: true, createdAt: h(26) },
  { id: 8, type: 'system', title: 'Appuppdatering tillgänglig', body: 'Traivo Go v2.4 finns nu tillgänglig med förbättrad GPS-precision.', read: true, createdAt: h(48) },
  { id: 9, type: 'order_assigned', title: 'Nytt uppdrag tilldelat', body: 'WO-2026-0455 — Södertälje Hamn har tilldelats dig.', read: true, createdAt: h(50), relatedOrderId: 5 },
  { id: 10, type: 'schedule_change', title: 'Prioritet ändrad', body: 'WO-2026-0454 har fått högre prioritet.', read: true, createdAt: h(72), relatedOrderId: 4 },
];

function findMockOrder(idParam: string) {
  return MOCK_ORDERS.find(o => o.id === parseInt(idParam) || o.orderNumber === idParam || o.id.toString() === idParam);
}

export {
  MOCK_RESOURCE,
  MOCK_TOKEN,
  MOCK_PROFILES,
  MOCK_TEAM,
  MOCK_RESOURCES,
  MOCK_TEAM_INVITES,
  MOCK_MATERIAL_LOGS,
  MOCK_MAX_LOGS,
  MOCK_NOTIFICATIONS_LEGACY,
  MOCK_ORDERS,
  MOCK_ARTICLES,
  MOCK_CHECKLIST_TEMPLATES,
  MOCK_WORK_SESSION,
  MOCK_WORK_SESSION_ENTRIES,
  MOCK_CHANGE_REQUESTS,
  CHANGE_REQUEST_CATEGORIES,
  MOCK_DISRUPTIONS,
  MOCK_NOTIFICATIONS,
  MOCK_WORK_SESSION as _MOCK_WORK_SESSION_REF,
  findMockOrder,
};

export function setMockWorkSession(val: any) {
  MOCK_WORK_SESSION = val;
}

export function setMockWorkSessionEntries(val: any[]) {
  MOCK_WORK_SESSION_ENTRIES = val;
}

export function getMockWorkSession() {
  return MOCK_WORK_SESSION;
}

export function getMockWorkSessionEntries() {
  return MOCK_WORK_SESSION_ENTRIES;
}
