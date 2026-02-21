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
  { key: 'access', label: 'Tillg\u00e4nglighet', icon: 'unlock' },
  { key: 'container', label: 'K\u00e4rl/Beh\u00e5llare', icon: 'box' },
  { key: 'environment', label: 'Milj\u00f6', icon: 'sun' },
  { key: 'safety', label: 'S\u00e4kerhet', icon: 'shield' },
  { key: 'cleanliness', label: 'Renlighet', icon: 'droplet' },
  { key: 'other', label: '\u00d6vrigt', icon: 'more-horizontal' },
] as const;

export const INSPECTION_ISSUES: Record<string, string[]> = {
  access: ['Blockerad infart', 'L\u00e5st grind', 'Felaktig kod', 'Tr\u00e5ng passage'],
  container: ['Trasigt lock', 'Skadade hjul', 'Deformerat k\u00e4rl', 'Saknar m\u00e4rkning'],
  environment: ['Nedskr\u00e4pning', 'Luktproblem', 'L\u00e4ckage', 'Skadedjur'],
  safety: ['Halt underlag', 'D\u00e5lig belysning', 'Farligt gods synligt', 'Trasig markering'],
  cleanliness: ['Smutsigt omr\u00e5de', 'Spilld v\u00e4tska', 'Ej st\u00e4dat', 'Orena k\u00e4rl'],
  other: ['Felaktig information', 'Kundklagom\u00e5l', 'Saknad utrustning', 'Annat problem'],
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  ok: 'OK',
  warning: 'Varning',
  error: 'Fel',
  not_checked: 'Ej kontrollerad',
};

export const TIME_RESTRICTION_LABELS: Record<TimeRestriction['type'], string> = {
  parking_ban: 'P-f\u00f6rbud',
  emptying_day: 'T\u00f6mningsdag',
  quiet_hours: 'Tysta timmar',
  access_restriction: 'Tilltr\u00e4desbegr\u00e4nsning',
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
  broken_container: 'Trasigt k\u00e4rl',
  wrong_address: 'Felaktig adress',
  blocked_access: 'Blockerad v\u00e4g',
  contamination: 'Kontaminering',
  overfilled: '\u00d6verfyllt',
  missing_container: 'Saknat k\u00e4rl',
  other: '\u00d6vrigt',
};
