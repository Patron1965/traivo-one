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
  en_route: 'På väg',
  arrived: 'Framme',
  in_progress: 'Pågår',
  completed: 'Slutförd',
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

export interface ExecutionCode {
  id: number;
  code: string;
  name: string;
}

export interface TimeRestriction {
  id: number;
  type: 'parking_ban' | 'emptying_day' | 'quiet_hours' | 'access_restriction';
  description: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  isActive: boolean;
}

export interface SubStep {
  id: number;
  name: string;
  articleName: string;
  completed: boolean;
  sortOrder: number;
}

export interface TaskDependency {
  id: number;
  dependsOnOrderId: number;
  dependsOnOrderNumber: string;
  dependsOnStatus: OrderStatus;
  isBlocking: boolean;
}

export interface OrderNote {
  id: number;
  orderId: number;
  text: string;
  createdBy: string;
  createdAt: string;
}

export type InspectionStatus = 'ok' | 'warning' | 'error' | 'not_checked';

export interface InspectionItem {
  id: number;
  category: string;
  status: InspectionStatus;
  issues: string[];
  comment: string;
}

export const INSPECTION_CATEGORIES = [
  { key: 'access', label: 'Tillgänglighet', icon: 'unlock' },
  { key: 'container', label: 'Kärl/Behållare', icon: 'box' },
  { key: 'environment', label: 'Miljö', icon: 'sun' },
  { key: 'safety', label: 'Säkerhet', icon: 'shield' },
  { key: 'cleanliness', label: 'Renlighet', icon: 'droplet' },
  { key: 'other', label: 'Övrigt', icon: 'more-horizontal' },
] as const;

export const INSPECTION_ISSUES: Record<string, string[]> = {
  access: ['Blockerad infart', 'Låst grind', 'Felaktig kod', 'Trång passage'],
  container: ['Trasigt lock', 'Skadade hjul', 'Deformerat kärl', 'Saknar märkning'],
  environment: ['Nedskräpning', 'Luktproblem', 'Läckage', 'Skadedjur'],
  safety: ['Halt underlag', 'Dålig belysning', 'Farligt gods synligt', 'Trasig markering'],
  cleanliness: ['Smutsigt område', 'Spilld vätska', 'Ej städat', 'Orena kärl'],
  other: ['Felaktig information', 'Kundklagomål', 'Saknad utrustning', 'Annat problem'],
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  ok: 'OK',
  warning: 'Varning',
  error: 'Fel',
  not_checked: 'Ej kontrollerad',
};

export const TIME_RESTRICTION_LABELS: Record<TimeRestriction['type'], string> = {
  parking_ban: 'P-förbud',
  emptying_day: 'Tömningsdag',
  quiet_hours: 'Tysta timmar',
  access_restriction: 'Tillträdesbegränsning',
};

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
  executionCodes?: ExecutionCode[];
  timeRestrictions?: TimeRestriction[];
  subSteps?: SubStep[];
  dependencies?: TaskDependency[];
  isLocked?: boolean;
  orderNotes?: OrderNote[];
  inspections?: InspectionItem[];
  creationMethod?: string;
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
  broken_container: 'Trasigt kärl',
  wrong_address: 'Felaktig adress',
  blocked_access: 'Blockerad väg',
  contamination: 'Kontaminering',
  overfilled: 'Överfyllt',
  missing_container: 'Saknat kärl',
  other: 'Övrigt',
};
