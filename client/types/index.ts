export type OrderStatus =
  | 'new'
  | 'planned'
  | 'en_route'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'deferred'
  | 'cancelled';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Ny',
  planned: 'Planerad',
  en_route: 'P\u00e5 v\u00e4g',
  arrived: 'Framme',
  in_progress: 'P\u00e5g\u00e5r',
  completed: 'Slutf\u00f6rd',
  deferred: 'Uppskjuten',
  cancelled: 'Avbokad',
};

export const ORDER_STATUS_SEQUENCE: OrderStatus[] = [
  'new',
  'planned',
  'en_route',
  'arrived',
  'in_progress',
  'completed',
];

export interface Order {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  customerName: string;
  address: string;
  city: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  what3words?: string;
  scheduledDate: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  description: string;
  notes?: string;
  objectType: string;
  objectId: number;
  clusterId?: number;
  clusterName?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  articles: Article[];
  contacts: Contact[];
  estimatedDuration: number;
  completedAt?: string;
  signatureUrl?: string;
  photos: string[];
  deviations: Deviation[];
  sortOrder: number;
}

export interface Article {
  id: number;
  name: string;
  unit: string;
  quantity: number;
  category: string;
  isSeasonal: boolean;
}

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email?: string;
  role: string;
}

export interface Deviation {
  id: number;
  orderId: number;
  category: string;
  description: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

export interface Resource {
  id: number;
  name: string;
  type: string;
  vehicleRegNo?: string;
  competencies: string[];
}

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  description: string;
  icon: string;
  windSpeed: number;
  precipitation: number;
  warnings: string[];
}

export interface GpsPosition {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
  speed?: number;
}

export interface MaterialLogEntry {
  id: number;
  orderId: number;
  articleId: number;
  articleName: string;
  quantity: number;
  unit: string;
  note?: string;
  createdAt: string;
}

export interface DaySummary {
  totalOrders: number;
  completedOrders: number;
  deferredOrders: number;
  totalDistance: number;
  estimatedTimeRemaining: number;
}

export type DeviationCategory =
  | 'broken_container'
  | 'wrong_address'
  | 'blocked_access'
  | 'contamination'
  | 'overfilled'
  | 'missing_container'
  | 'other';

export const DEVIATION_CATEGORIES: Record<DeviationCategory, string> = {
  broken_container: 'Trasigt k\u00e4rl',
  wrong_address: 'Felaktig adress',
  blocked_access: 'Blockerad v\u00e4g',
  contamination: 'Kontaminering',
  overfilled: '\u00d6verfyllt',
  missing_container: 'Saknat k\u00e4rl',
  other: '\u00d6vrigt',
};
