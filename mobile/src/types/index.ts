export interface Resource {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  initials: string | null;
  resourceType: string;
  phone: string | null;
  email: string | null;
  homeLocation: string | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  status: string;
  executionCodes?: string[];
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  customerId: string;
  objectId: string;
  resourceId: string | null;
  title: string;
  description: string | null;
  orderType: string;
  priority: string;
  status: string;
  orderStatus: string;
  executionStatus?: string;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  estimatedDuration: number;
  actualDuration: number | null;
  completedAt: string | null;
  notes: string | null;
  objectName?: string;
  objectAddress?: string;
  objectLatitude?: number | null;
  objectLongitude?: number | null;
  accessCode?: string | null;
  keyNumber?: string | null;
  objectNotes?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  subSteps?: SubStep[];
  dependencies?: OrderDependency[];
}

export interface SubStep {
  id: string;
  label: string;
  completed: boolean;
}

export interface OrderDependency {
  orderId: string;
  orderNumber: string;
  status: string;
  type: string;
}

export interface Customer {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface ServiceObject {
  id: string;
  customerId: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  accessCode: string | null;
  keyNumber: string | null;
  notes: string | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  resource: Resource | null;
  token: string | null;
}

export type OrderStatusUpdate = 'paborjad' | 'utford' | 'ej_utford' | 'en_route';

export interface Article {
  id: string;
  articleNumber: string;
  name: string;
  unit: string;
  category: string;
}

export interface WorkSession {
  id: string;
  startTime: string;
  endTime: string | null;
  status: 'active' | 'paused' | 'completed';
  pausedAt: string | null;
  totalPauseMinutes: number;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
  orderId?: string;
}

export type OfflineActionPayload =
  | { orderId: string; status: OrderStatusUpdate; notes?: string }
  | { orderId: string; type: string; description: string; category?: string; severity?: string; latitude?: number; longitude?: number; photos?: string[] }
  | { orderId: string; articleId: string; articleNumber?: string; articleName?: string; quantity: number }
  | { latitude: number; longitude: number; accuracy?: number; speed?: number }
  | { orderId: string; text: string }
  | { orderId: string; signature: string }
  | { orderId: string; inspections?: InspectionItem[]; checklist?: Array<{ id: string; label: string; checked: boolean; comment?: string }> }
  | { orderId: string; photos: Array<{ uri: string; caption: string }> };

export interface OfflineQueueEntry {
  clientId: string;
  type: 'status_update' | 'deviation' | 'material' | 'gps' | 'note' | 'signature' | 'inspection' | 'photo';
  payload: OfflineActionPayload;
  timestamp: number;
  synced: boolean;
  retryCount: number;
}

export interface GPSPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  timestamp: number;
  synced: boolean;
}

export interface DaySummary {
  totalOrders: number;
  completedOrders: number;
  remainingOrders: number;
  totalDuration: number;
}

export interface RouteFeedback {
  id?: string;
  date: string;
  rating: number;
  reasonCategory?: string;
  freeText?: string;
  workSessionId?: string;
}

export interface DeviationReport {
  type: string;
  description: string;
  latitude?: number;
  longitude?: number;
  photos?: string[];
}

export interface MaterialLog {
  articleId: string;
  articleNumber?: string;
  articleName?: string;
  quantity: number;
  comment?: string;
}

export interface InspectionItem {
  category: string;
  status: 'ok' | 'warning' | 'fail';
  comment?: string;
  issues?: string[];
}

export type SyncStatus = 'online' | 'syncing' | 'offline' | 'error';
