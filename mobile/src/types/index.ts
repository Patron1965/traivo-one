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
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  estimatedDuration: number;
  actualDuration: number | null;
  completedAt: string | null;
  notes: string | null;
  objectName?: string;
  objectAddress?: string;
  customerName?: string;
  customerPhone?: string;
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

export type OrderStatusUpdate = 'paborjad' | 'utford' | 'ej_utford';
