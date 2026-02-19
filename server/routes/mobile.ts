import { Router } from 'express';

const router = Router();

const MOCK_USER = {
  id: 1,
  name: 'Erik Lindqvist',
  role: 'driver',
  resourceId: 101,
  vehicleRegNo: 'ABC 123',
};

const MOCK_TOKEN = 'mock-driver-token-001';

const MOCK_ORDERS = [
  {
    id: 1,
    orderNumber: 'WO-2026-0451',
    status: 'planned',
    customerName: 'BRF Solsidan',
    address: 'Storgatan 12',
    city: 'G\u00f6teborg',
    postalCode: '411 01',
    latitude: 57.7089,
    longitude: 11.9746,
    what3words: 'fest.lampa.skog',
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '08:00',
    scheduledTimeEnd: '09:00',
    description: 'T\u00f6mning av k\u00e4rl - Hush\u00e5llsavfall 370L',
    notes: 'Porten har kod 1234',
    objectType: 'K\u00e4rl',
    objectId: 501,
    clusterId: 10,
    clusterName: 'Centrum Norr',
    priority: 'normal',
    articles: [
      { id: 1, name: 'Hush\u00e5llsavfall 370L', unit: 'st', quantity: 4, category: 'Avfall', isSeasonal: false },
      { id: 2, name: 'Matavfall 140L', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 1, name: 'Anna Karlsson', phone: '070-123 45 67', email: 'anna@brfsolsidan.se', role: 'Fastighetssk\u00f6tare' },
    ],
    estimatedDuration: 15,
    photos: [],
    deviations: [],
    sortOrder: 1,
  },
  {
    id: 2,
    orderNumber: 'WO-2026-0452',
    status: 'planned',
    customerName: 'Fastighets AB Norden',
    address: 'Vasagatan 28',
    city: 'G\u00f6teborg',
    postalCode: '411 37',
    latitude: 57.7045,
    longitude: 11.9664,
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '09:15',
    scheduledTimeEnd: '09:45',
    description: 'T\u00f6mning av k\u00e4rl - Restavfall och kartong',
    notes: 'K\u00e4rlen st\u00e5r i g\u00e5rden, g\u00e5 genom port till v\u00e4nster',
    objectType: 'K\u00e4rl',
    objectId: 502,
    clusterId: 10,
    clusterName: 'Centrum Norr',
    priority: 'normal',
    articles: [
      { id: 3, name: 'Restavfall 660L', unit: 'st', quantity: 2, category: 'Avfall', isSeasonal: false },
      { id: 4, name: 'Kartong 660L', unit: 'st', quantity: 1, category: '\u00c5tervinning', isSeasonal: false },
    ],
    contacts: [
      { id: 2, name: 'Lars Svensson', phone: '073-456 78 90', role: 'Driftansvarig' },
    ],
    estimatedDuration: 20,
    photos: [],
    deviations: [],
    sortOrder: 2,
  },
  {
    id: 3,
    orderNumber: 'WO-2026-0453',
    status: 'planned',
    customerName: 'Chalmers Tekniska H\u00f6gskola',
    address: 'Chalmers\u00e4ngen 4',
    city: 'G\u00f6teborg',
    postalCode: '412 96',
    latitude: 57.6896,
    longitude: 11.9770,
    what3words: 'b\u00f6cker.glas.rikt',
    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledTimeStart: '10:00',
    scheduledTimeEnd: '10:45',
    description: 'T\u00f6mning av containrar - Bygg och verksamhetsavfall',
    notes: 'Anm\u00e4l vid reception vid leveransentr\u00e9n',
    objectType: 'Container',
    objectId: 503,
    clusterId: 11,
    clusterName: 'Centrum S\u00f6der',
    priority: 'high',
    articles: [
      { id: 5, name: 'Byggavfall container 8m\u00b3', unit: 'st', quantity: 1, category: 'Bygg', isSeasonal: false },
      { id: 6, name: 'Verksamhetsavfall 1100L', unit: 'st', quantity: 3, category: 'Avfall', isSeasonal: false },
    ],
    contacts: [
      { id: 3, name: 'Maria Berg', phone: '031-772 10 00', email: 'maria.berg@chalmers.se', role: 'Milj\u00f6samordnare' },
      { id: 4, name: 'Johan Ek', phone: '070-987 65 43', role: 'Vaktm\u00e4stare' },
    ],
    estimatedDuration: 30,
    photos: [],
    deviations: [],
    sortOrder: 3,
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
  const { username, password } = req.body;
  if (username && password) {
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
    order.status = req.body.status;
    if (req.body.status === 'completed') {
      order.completedAt = new Date().toISOString();
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
      0: 'Klart',
      1: 'Mestadels klart',
      2: 'Delvis molnigt',
      3: 'Mulet',
      45: 'Dimma',
      48: 'Dimma med rimfrost',
      51: 'L\u00e4tt duggregn',
      53: 'M\u00e5ttligt duggregn',
      55: 'Kraftigt duggregn',
      61: 'L\u00e4tt regn',
      63: 'M\u00e5ttligt regn',
      65: 'Kraftigt regn',
      71: 'L\u00e4tt sn\u00f6fall',
      73: 'M\u00e5ttligt sn\u00f6fall',
      75: 'Kraftigt sn\u00f6fall',
      77: 'Sn\u00f6korn',
      80: 'L\u00e4tta regnskurar',
      81: 'M\u00e5ttliga regnskurar',
      82: 'Kraftiga regnskurar',
      85: 'L\u00e4tta sn\u00f6byar',
      86: 'Kraftiga sn\u00f6byar',
      95: '\u00c5skv\u00e4der',
      96: '\u00c5skv\u00e4der med hagel',
      99: '\u00c5skv\u00e4der med kraftigt hagel',
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
    if (current.wind_speed_10m > 15) warnings.push('Bl\u00e5sigt v\u00e4der');
    if (current.precipitation > 5) warnings.push('Kraftig nederb\u00f6rd');
    if (current.temperature_2m < 0) warnings.push('Minusgrader - halkrisk');
    if (code >= 95) warnings.push('\u00c5skvarning');

    res.json({
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      description: weatherDescriptions[code] || 'Ok\u00e4nt',
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
