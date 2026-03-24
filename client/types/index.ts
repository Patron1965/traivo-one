export type OrderStatus =
  | 'skapad'
  | 'planerad_pre'
  | 'planerad_resurs'
  | 'planerad_las'
  | 'utford'
  | 'fakturerad'
  | 'impossible'
  | 'planned'
  | 'dispatched'
  | 'on_site'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deferred';

export const ORDER_STATUS_LABELS: Record<string, string> = {
  skapad: 'Skapad',
  planerad_pre: 'Förplanerad',
  planerad_resurs: 'Tilldelad',
  planerad_las: 'Inlastad',
  utford: 'Utförd',
  fakturerad: 'Fakturerad',
  impossible: 'Omöjlig',
  planned: 'Planerad',
  dispatched: 'Skickad',
  on_site: 'På plats',
  in_progress: 'Pågår',
  completed: 'Slutförd',
  failed: 'Misslyckad',
  cancelled: 'Avbokad',
  deferred: 'Uppskjuten',
};

export const ORDER_STATUS_SEQUENCE: OrderStatus[] = [
  'skapad',
  'planerad_pre',
  'planerad_resurs',
  'planerad_las',
  'utford',
  'fakturerad',
];

export const IMPOSSIBLE_REASONS = {
  no_access: 'Ingen åtkomst',
  wrong_address: 'Felaktig adress',
  dangerous: 'Farlig situation',
  missing_equipment: 'Saknad utrustning',
  customer_refused: 'Kund nekade',
  weather: 'Väderförhållanden',
  other: 'Annat',
} as const;

export type ImpossibleReason = keyof typeof IMPOSSIBLE_REASONS;

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
  photos?: string[];
  beforePhoto?: string;
  afterPhoto?: string;
}

export type PhotoRequirement = 'none' | 'single' | 'before_after';

export const INSPECTION_CATEGORIES = [
  { key: 'access', label: 'Tillgänglighet', icon: 'unlock', photoRequired: false, photoType: 'none' as PhotoRequirement },
  { key: 'container', label: 'Kärl/Behållare', icon: 'box', photoRequired: true, photoType: 'before_after' as PhotoRequirement },
  { key: 'environment', label: 'Miljö', icon: 'sun', photoRequired: true, photoType: 'single' as PhotoRequirement },
  { key: 'safety', label: 'Säkerhet', icon: 'shield', photoRequired: true, photoType: 'single' as PhotoRequirement },
  { key: 'cleanliness', label: 'Renlighet', icon: 'droplet', photoRequired: false, photoType: 'none' as PhotoRequirement },
  { key: 'other', label: 'Övrigt', icon: 'more-horizontal', photoRequired: false, photoType: 'none' as PhotoRequirement },
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
  plannedNotes?: string | null;
  taskLatitude?: number | null;
  taskLongitude?: number | null;
  objectAccessCode?: string | null;
  objectKeyNumber?: string | null;
  articleId?: string | number;
  quantity?: number;
  unit?: string;
  impossibleReason?: string;
  impossibleAt?: string;
  impossibleBy?: string;
  isTeamOrder?: boolean;
  teamName?: string;
  assigneeName?: string;
  executionStatus?: ExecutionStatus;
}

export type ExecutionStatus =
  | 'not_started'
  | 'travel_started'
  | 'arrived'
  | 'work_started'
  | 'work_paused'
  | 'work_resumed'
  | 'work_completed'
  | 'signed_off';

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  not_started: 'Ej startad',
  travel_started: 'Resa startad',
  arrived: 'Framme',
  work_started: 'Arbete startat',
  work_paused: 'Pausad',
  work_resumed: 'Återupptagen',
  work_completed: 'Arbete klart',
  signed_off: 'Signerad',
};

export const EXECUTION_STATUS_SEQUENCE: ExecutionStatus[] = [
  'not_started',
  'travel_started',
  'arrived',
  'work_started',
  'work_paused',
  'work_resumed',
  'work_completed',
  'signed_off',
];

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

export const FIELD_APP_ALLOWED_ROLES = ['technician', 'planner', 'admin', 'owner', 'user'] as const;
export const FIELD_APP_BLOCKED_ROLES = ['customer', 'reporter', 'viewer'] as const;
export type UserRole = 'owner' | 'admin' | 'planner' | 'technician' | 'user' | 'viewer' | 'customer' | 'reporter';

export interface Resource {
  id: number | string;
  tenantId?: string;
  name: string;
  type?: string;
  role?: UserRole | string;
  phone?: string;
  email?: string;
  vehicleRegNo?: string;
  resourceId?: string | number;
  homeLatitude?: number;
  homeLongitude?: number;
  competencies?: string[];
  executionCodes?: string[];
  trackingStatus?: 'idle' | 'traveling' | 'on_site' | 'offline';
}

export interface ResourceProfile {
  id: number | string;
  name: string;
  color: string;
  icon: string;
  executionCodes: string[];
  equipmentTypes: string[];
  defaultCostCenter?: string;
  projectCode?: string;
}

export interface ResourceProfileAssignment {
  id: number | string;
  resourceId: number | string;
  profileId: number | string;
  profile: ResourceProfile;
  assignedAt: string;
  isPrimary?: boolean;
}

export type TeamMemberRole = 'member' | 'leader' | 'substitute';

export interface TeamMember {
  id: number | string;
  resourceId: number | string;
  name: string;
  role: TeamMemberRole;
  phone?: string;
  email?: string;
  validFrom?: string;
  validTo?: string;
  latitude?: number;
  longitude?: number;
  isOnline?: boolean;
}

export interface Team {
  id: number | string;
  name: string;
  description?: string;
  color: string;
  leaderId: number | string;
  clusterId?: number | string;
  serviceArea?: string[];
  projectCode?: string;
  status: 'active' | 'inactive';
  members: TeamMember[];
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
  actionType: 'status_update' | 'note' | 'deviation' | 'material' | 'gps' | 'inspection' | 'signature';
  payload: Record<string, any>;
  timestamp: number;
}

export interface ChecklistQuestion {
  id: string;
  text: string;
  type: 'boolean' | 'select' | 'text';
  options?: string[];
  photoRequired?: boolean;
  photoType?: PhotoRequirement;
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

export type ChangeRequestCategory =
  | 'antal_karl_andrat'
  | 'skadat_material'
  | 'tillganglighet'
  | 'skador'
  | 'rengorings_behov'
  | 'ovrigt';

export const CHANGE_REQUEST_CATEGORIES: Record<ChangeRequestCategory, string> = {
  antal_karl_andrat: 'Antal kärl ändrat',
  skadat_material: 'Skadat material',
  tillganglighet: 'Tillgänglighetsproblem',
  skador: 'Skador',
  rengorings_behov: 'Rengöringsbehov',
  ovrigt: 'Övrigt',
};

export type ChangeRequestStatus = 'new' | 'reviewed' | 'resolved' | 'rejected';

export const CHANGE_REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  new: 'Ny',
  reviewed: 'Under granskning',
  resolved: 'Löst',
  rejected: 'Avvisad',
};

export interface CustomerChangeRequest {
  id: string;
  category: ChangeRequestCategory;
  description: string;
  severity?: string;
  status: ChangeRequestStatus;
  objectId?: string;
  objectName?: string;
  customerId?: string;
  customerName?: string;
  photos?: string[];
  reportedByName: string;
  reportedByResourceId: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
}

export interface DeviationWithOrder extends Deviation {
  orderNumber?: string;
  customerName?: string;
  address?: string;
}
