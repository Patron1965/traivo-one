export type OrderStatus =
  | 'planned'
  | 'dispatched'
  | 'on_site'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  planned: 'Planerad',
  dispatched: 'Skickad',
  on_site: 'På plats',
  in_progress: 'Pågår',
  completed: 'Slutförd',
  failed: 'Misslyckad',
  cancelled: 'Avbokad',
};

export const ORDER_STATUS_SEQUENCE: OrderStatus[] = [
  'planned',
  'dispatched',
  'on_site',
  'in_progress',
  'completed',
];

export interface ExecutionCode {
  id: number | string;
  code: string;
  name: string;
}

export interface TimeRestriction {
  id: number | string;
  type: 'parking_ban' | 'emptying_day' | 'quiet_hours' | 'access_restriction';
  description: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  isActive: boolean;
}

export interface SubStep {
  id: number | string;
  name: string;
  articleName: string;
  completed: boolean;
  sortOrder: number;
}

export interface TaskDependency {
  id: number | string;
  dependsOnOrderId: number | string;
  dependsOnOrderNumber: string;
  dependsOnStatus: OrderStatus;
  isBlocking: boolean;
}

export interface OrderNote {
  id: number | string;
  orderId: number | string;
  text: string;
  createdBy: string;
  createdAt: string;
}

export type InspectionStatus = 'ok' | 'warning' | 'error' | 'issue' | 'not_checked';

export interface InspectionItem {
  id: number | string;
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
  container: ['Trasigt lock', 'Skadade hjul', 'Deformerat kärl', 'Saknar märkning', 'Spricka i lock'],
  environment: ['Nedskräpning', 'Luktproblem', 'Läckage', 'Skadedjur'],
  safety: ['Halt underlag', 'Dålig belysning', 'Farligt gods synligt', 'Trasig markering'],
  cleanliness: ['Smutsigt område', 'Spilld vätska', 'Ej städat', 'Orena kärl'],
  other: ['Felaktig information', 'Kundklagomål', 'Saknad utrustning', 'Annat problem'],
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  ok: 'OK',
  warning: 'Varning',
  error: 'Fel',
  issue: 'Problem',
  not_checked: 'Ej kontrollerad',
};

export const TIME_RESTRICTION_LABELS: Record<TimeRestriction['type'], string> = {
  parking_ban: 'P-förbud',
  emptying_day: 'Tömningsdag',
  quiet_hours: 'Tysta timmar',
  access_restriction: 'Tillträdesbegränsning',
};

export interface OrderObject {
  id: number | string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  what3words?: string;
}

export interface OrderCustomer {
  id: number | string;
  name: string;
  customerNumber?: string;
}

export interface Order {
  id: number | string;
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
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  title?: string;
  description: string;
  notes?: string;
  objectType: string;
  objectId: number | string;
  clusterId?: number | string;
  clusterName?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  articles: Article[];
  contacts: Contact[];
  estimatedDuration: number;
  actualStartTime?: string;
  actualEndTime?: string;
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
  object?: OrderObject;
  customer?: OrderCustomer;
  syncCount?: number;
  notificationCount?: number;
  metadata?: Record<string, any>;
  resourceId?: string | number;
  tenantId?: string;
  articleId?: string | number;
  quantity?: number;
  unit?: string;
}

export interface Article {
  id: number | string;
  name: string;
  articleNumber?: string;
  unit: string;
  quantity?: number;
  category: string;
  isSeasonal?: boolean;
}

export interface Contact {
  id: number | string;
  name: string;
  phone: string;
  email?: string;
  role: string;
}

export interface Deviation {
  id: number | string;
  orderId: number | string;
  category: string;
  description: string;
  photoUrl?: string;
  latitude?: number;
  longitude?: number;
  createdAt: string;
  type?: string;
  photos?: string[];
}

export interface Resource {
  id: number | string;
  tenantId?: string;
  name: string;
  type?: string;
  phone?: string;
  email?: string;
  vehicleRegNo?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  competencies?: string[];
  executionCodes?: string[];
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
  heading?: number;
}

export interface MaterialLogEntry {
  id: number | string;
  orderId: number | string;
  articleId: number | string;
  articleNumber?: string;
  articleName: string;
  quantity: number;
  unit: string;
  note?: string;
  createdAt: string;
}

export interface DaySummary {
  totalOrders: number;
  completedOrders: number;
  remainingOrders: number;
  failedOrders?: number;
  totalDuration: number;
  totalDistance?: number;
  estimatedTimeRemaining?: number;
}

export type DeviationCategory =
  | 'blocked_access'
  | 'damaged_container'
  | 'wrong_waste'
  | 'overloaded'
  | 'broken_container'
  | 'wrong_address'
  | 'contamination'
  | 'overfilled'
  | 'missing_container'
  | 'other';

export const DEVIATION_CATEGORIES: Record<DeviationCategory, string> = {
  blocked_access: 'Blockerad väg',
  damaged_container: 'Skadat kärl',
  wrong_waste: 'Felaktigt avfall',
  overloaded: 'Överlastat',
  broken_container: 'Trasigt kärl',
  wrong_address: 'Felaktig adress',
  contamination: 'Kontaminering',
  overfilled: 'Överfyllt',
  missing_container: 'Saknat kärl',
  other: 'Övrigt',
};

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  orderId?: string;
}

export interface SyncAction {
  clientId: string;
  actionType: 'status_update' | 'note' | 'deviation' | 'material' | 'gps' | 'inspection';
  payload: Record<string, any>;
}

export interface ChecklistQuestion {
  id: string;
  text: string;
  type: 'boolean' | 'select' | 'text';
  options?: string[];
}

export interface ChecklistTemplate {
  templateId: string;
  name: string;
  articleType: string;
  questions: ChecklistQuestion[];
}

export interface OrderChecklist {
  orderId: string;
  articleTypes: string[];
  checklists: ChecklistTemplate[];
}
