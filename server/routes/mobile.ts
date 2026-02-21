import { Router } from 'express';

const router = Router();

const MOCK_USER = {
  id: 1,
  name: 'Erik Lindqvist',
  role: 'driver',
  resourceId: 101,
  vehicleRegNo: 'ABC 123',
  executionCodes: ['TÖM', 'HÄMT', 'FARL'],
};

const MOCK_TOKEN = 'mock-driver-token-001';

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
    articles: [
      { id: 1, name: 'Hushållsavfall 370L', unit: 'st', quantity: 4, category: 'Avfall', isSeasonal: false },
      { id: 2, name: 'Matavfall 140L', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
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
    articles: [
      { id: 3, name: 'Restavfall 660L', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
      { id: 4, name: 'Kartong 660L', unit: 'st', quantity: 1, category: 'Återvinning', isSeasonal: false },
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
    articles: [
      { id: 5, name: 'Byggavfall container 8m\u00b3', unit: 'st', quantity: 1, category: 'Bygg', isSeasonal: false },
      { id: 6, name: 'Verksamhetsavfall 1100L', unit: 'st', quantity: 3, category: 'Avfall', isSeasonal: false },
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
      { id: 6, name: 'Kontrollera container', articleName: 'Byggavfall container 8m\u00b3', completed: false, sortOrder: 1 },
      { id: 7, name: 'Lyfta container', articleName: 'Byggavfall container 8m\u00b3', completed: false, sortOrder: 2 },
      { id: 8, name: 'Byt container', articleName: 'Byggavfall container 8m\u00b3', completed: false, sortOrder: 3 },
      { id: 9, name: 'Töm verksamhetsavfall', articleName: 'Verksamhetsavfall 1100L', completed: false, sortOrder: 4 },
    ],
    dependencies: [],
    isLocked: false,
    orderNotes: [
      { id: 2, orderId: 3, text: 'Ny parkeringsplats vid leveransentrén från mars', createdBy: 'Planerare', createdAt: new Date(Date.now() - 172800000).toISOString() },
    ],
    inspections: [],
    creationMethod: 'manual',
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
    articles: [
      { id: 7, name: 'Kartongkomprimator', unit: 'st', quantity: 1, category: 'Återvinning', isSeasonal: false },
      { id: 8, name: 'Plastkomprimator', unit: 'st', quantity: 1, category: 'Återvinning', isSeasonal: false },
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
      { id: 2, dependsOnOrderId: 3, dependsOnOrderNumber: 'WO-2026-0453', dependsOnStatus: 'en_route', isBlocking: true },
    ],
    isLocked: true,
    orderNotes: [],
    inspections: [],
    creationMethod: 'schema',
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
    articles: [
      { id: 9, name: 'Spillolja 200L fat', unit: 'st', quantity: 2, category: 'Farligt avfall', isSeasonal: false },
      { id: 10, name: 'Kemikaliecontainer', unit: 'st', quantity: 1, category: 'Farligt avfall', isSeasonal: false },
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
  },
];

const MOCK_ARTICLES = [
  { id: 1, name: 'Hushållsavfall 140L', unit: 'st', category: 'Avfall' },
  { id: 2, name: 'Hushållsavfall 370L', unit: 'st', category: 'Avfall' },
  { id: 3, name: 'Matavfall 140L', unit: 'st', category: 'Avfall' },
  { id: 4, name: 'Restavfall 660L', unit: 'st', category: 'Avfall' },
  { id: 5, name: 'Kartong 660L', unit: 'st', category: 'Återvinning' },
  { id: 6, name: 'Plast 660L', unit: 'st', category: 'Återvinning' },
  { id: 7, name: 'Glas - färgat 600L', unit: 'st', category: 'Återvinning' },
  { id: 8, name: 'Glas - ofärgat 600L', unit: 'st', category: 'Återvinning' },
  { id: 9, name: 'Metall 240L', unit: 'st', category: 'Återvinning' },
  { id: 10, name: 'Tidningar 660L', unit: 'st', category: 'Återvinning' },
  { id: 11, name: 'Trädgårdsavfall 370L', unit: 'st', category: 'Avfall' },
  { id: 12, name: 'Byggavfall container 8m\u00b3', unit: 'st', category: 'Bygg' },
  { id: 13, name: 'Verksamhetsavfall 1100L', unit: 'st', category: 'Avfall' },
  { id: 14, name: 'Spillolja 200L fat', unit: 'st', category: 'Farligt avfall' },
  { id: 15, name: 'Kemikaliecontainer', unit: 'st', category: 'Farligt avfall' },
];

router.post('/login', (req, res) => {
  const { username, password, pin } = req.body;
  if (pin) {
    if (pin.length === 4 || pin.length === 6) {
      res.json({ user: MOCK_USER, token: MOCK_TOKEN });
    } else {
      res.status(401).json({ error: 'Ogiltig PIN-kod' });
    }
  } else if (username && password) {
    res.json({ user: MOCK_USER, token: MOCK_TOKEN });
  } else {
    res.status(401).json({ error: 'Ogiltiga inloggningsuppgifter' });
  }
});

router.get('/orders', (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(MOCK_ORDERS.filter(o => o.scheduledDate === date));
});

router.get('/orders/:id', (req, res) => {
  const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
  if (order) {
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order hittades inte' });
  }
});

router.patch('/orders/:id/status', (req, res) => {
  const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
  if (order) {
    if (order.isLocked) {
      res.status(403).json({ error: 'Uppdraget är låst - beroende uppdrag ej slutförda' });
      return;
    }
    order.status = req.body.status;
    if (req.body.status === 'completed') {
      (order as any).completedAt = new Date().toISOString();
    }
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order hittades inte' });
  }
});

router.post('/orders/:id/deviations', (req, res) => {
  const orderId = parseInt(req.params.id);
  const deviation = {
    id: Date.now(),
    orderId,
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  const order = MOCK_ORDERS.find(o => o.id === orderId);
  if (order) {
    order.deviations.push(deviation);
  }
  res.json(deviation);
});

router.post('/orders/:id/materials', (req, res) => {
  const entry = {
    id: Date.now(),
    orderId: parseInt(req.params.id),
    ...req.body,
    createdAt: new Date().toISOString(),
  };
  res.json(entry);
});

router.post('/orders/:id/signature', (req, res) => {
  const order = MOCK_ORDERS.find(o => o.id === parseInt(req.params.id));
  if (order) {
    order.signatureUrl = req.body.signatureData;
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Order hittades inte' });
  }
});

router.post('/orders/:id/notes', (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = MOCK_ORDERS.find(o => o.id === orderId);
  if (order) {
    const note = {
      id: Date.now(),
      orderId,
      text: req.body.text,
      createdBy: 'Chaufför',
      createdAt: new Date().toISOString(),
    };
    if (!order.orderNotes) order.orderNotes = [];
    order.orderNotes.push(note);
    res.json(note);
  } else {
    res.status(404).json({ error: 'Order hittades inte' });
  }
});

router.patch('/orders/:id/substeps/:stepId', (req, res) => {
  const orderId = parseInt(req.params.id);
  const stepId = parseInt(req.params.stepId);
  const order = MOCK_ORDERS.find(o => o.id === orderId);
  if (order && order.subSteps) {
    const step = order.subSteps.find((s: any) => s.id === stepId);
    if (step) {
      step.completed = req.body.completed;
      res.json(step);
    } else {
      res.status(404).json({ error: 'Delsteg hittades inte' });
    }
  } else {
    res.status(404).json({ error: 'Order hittades inte' });
  }
});

router.post('/orders/:id/inspections', (req, res) => {
  const orderId = parseInt(req.params.id);
  const order = MOCK_ORDERS.find(o => o.id === orderId);
  if (order) {
    order.inspections = req.body.inspections;
    res.json({ success: true, inspections: order.inspections });
  } else {
    res.status(404).json({ error: 'Order hittades inte' });
  }
});

router.get('/articles', (req, res) => {
  const search = (req.query.search as string || '').toLowerCase();
  if (search) {
    res.json(MOCK_ARTICLES.filter(a => a.name.toLowerCase().includes(search)));
  } else {
    res.json(MOCK_ARTICLES);
  }
});

router.post('/gps', (req, res) => {
  res.json({ received: true });
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

router.get('/summary', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = MOCK_ORDERS.filter(o => o.scheduledDate === today);
  res.json({
    totalOrders: todayOrders.length,
    completedOrders: todayOrders.filter(o => o.status === 'completed').length,
    deferredOrders: todayOrders.filter(o => o.status === 'deferred').length,
    totalDistance: 34.2,
    estimatedTimeRemaining: todayOrders
      .filter(o => o.status !== 'completed' && o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.estimatedDuration, 0),
  });
});

export { router as mobileRoutes };
