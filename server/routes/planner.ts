import { Router } from 'express';
import { pool } from '../db';
import { MOCK_ORDERS } from './mobile';

const router = Router();

function getWeekDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

const EXTRA_WEEK_ORDERS: any[] = [
  {
    id: 101,
    orderNumber: 'WO-2026-0461',
    status: 'planned',
    customerName: 'Volvo Cars Torslanda',
    address: 'Torslandavägen 100',
    city: 'Göteborg',
    latitude: 57.7186,
    longitude: 11.8087,
    scheduledDate: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })(),
    scheduledTimeStart: '07:00',
    scheduledTimeEnd: '08:30',
    description: 'Tömning av containrar - Industriavfall',
    priority: 'high',
    estimatedDuration: 45,
    executionCodes: [{ id: 2, code: 'HÄMT', name: 'Hämtning' }],
  },
  {
    id: 102,
    orderNumber: 'WO-2026-0462',
    status: 'planned',
    customerName: 'Liseberg AB',
    address: 'Örgrytevägen 5',
    city: 'Göteborg',
    latitude: 57.6948,
    longitude: 11.9926,
    scheduledDate: (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })(),
    scheduledTimeStart: '09:00',
    scheduledTimeEnd: '10:00',
    description: 'Tömning av kärl - Hushållsavfall och plast',
    priority: 'normal',
    estimatedDuration: 30,
    executionCodes: [{ id: 1, code: 'TÖM', name: 'Tömning' }],
  },
  {
    id: 103,
    orderNumber: 'WO-2026-0463',
    status: 'planned',
    customerName: 'Sahlgrenska Universitetssjukhuset',
    address: 'Blå stråket 5',
    city: 'Göteborg',
    latitude: 57.6838,
    longitude: 11.9618,
    scheduledDate: (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0]; })(),
    scheduledTimeStart: '06:00',
    scheduledTimeEnd: '07:00',
    description: 'Hämtning av farligt avfall - Sjukhusavfall',
    priority: 'urgent',
    estimatedDuration: 60,
    executionCodes: [{ id: 3, code: 'FARL', name: 'Farligt avfall' }],
  },
  {
    id: 104,
    orderNumber: 'WO-2026-0464',
    status: 'planned',
    customerName: 'Scandinavium Arena',
    address: 'Valhallagatan 1',
    city: 'Göteborg',
    latitude: 57.7001,
    longitude: 11.9870,
    scheduledDate: (() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toISOString().split('T')[0]; })(),
    scheduledTimeStart: '10:00',
    scheduledTimeEnd: '11:30',
    description: 'Tömning av komprimator - Kartong',
    priority: 'normal',
    estimatedDuration: 25,
    executionCodes: [{ id: 1, code: 'TÖM', name: 'Tömning' }],
  },
  {
    id: 105,
    orderNumber: 'WO-2026-0465',
    status: 'planned',
    customerName: 'Stena Line Terminal',
    address: 'Emigrantvägen 1',
    city: 'Göteborg',
    latitude: 57.7070,
    longitude: 11.9320,
    scheduledDate: (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().split('T')[0]; })(),
    scheduledTimeStart: '08:00',
    scheduledTimeEnd: '09:30',
    description: 'Tömning av kärl och containrar',
    priority: 'normal',
    estimatedDuration: 40,
    executionCodes: [{ id: 1, code: 'TÖM', name: 'Tömning' }, { id: 2, code: 'HÄMT', name: 'Hämtning' }],
  },
];

const ALL_ORDERS = [...MOCK_ORDERS, ...EXTRA_WEEK_ORDERS];

router.get('/drivers/locations', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        driver_id as "driverId",
        driver_name as "driverName",
        vehicle_reg_no as "vehicleRegNo",
        latitude,
        longitude,
        speed,
        heading,
        accuracy,
        current_order_id as "currentOrderId",
        current_order_number as "currentOrderNumber",
        status,
        updated_at as "updatedAt"
      FROM driver_locations
      WHERE updated_at > NOW() - INTERVAL '24 hours'
      ORDER BY driver_name`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching driver locations:', error);
    res.status(500).json({ error: 'Kunde inte hämta positioner' });
  }
});

router.get('/orders', (req, res) => {
  const range = (req.query.range as string) || 'today';
  const today = new Date().toISOString().split('T')[0];

  let filteredOrders: any[];
  if (range === 'week') {
    const weekDates = getWeekDates();
    filteredOrders = ALL_ORDERS.filter(o => weekDates.includes(o.scheduledDate));
  } else {
    filteredOrders = ALL_ORDERS.filter(o => o.scheduledDate === today);
  }

  const mapped = filteredOrders
    .filter(o => o.latitude != null && o.longitude != null)
    .map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      customerName: o.customerName,
      address: o.address,
      city: o.city,
      latitude: o.latitude,
      longitude: o.longitude,
      scheduledDate: o.scheduledDate,
      scheduledTimeStart: o.scheduledTimeStart,
      scheduledTimeEnd: o.scheduledTimeEnd,
      description: o.description,
      priority: o.priority,
      estimatedDuration: o.estimatedDuration,
      executionCodes: o.executionCodes || [],
    }));

  res.json(mapped);
});

export { router as plannerRoutes };
