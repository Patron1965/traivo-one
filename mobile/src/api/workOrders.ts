import { apiClient } from './client';
import type { WorkOrder, OrderStatusUpdate } from '../types';

export interface WorkOrdersResponse {
  orders: WorkOrder[];
  total: number;
}

export const getMyWorkOrders = async (date?: string): Promise<WorkOrdersResponse> => {
  const params = date ? { date } : {};
  const response = await apiClient.get<WorkOrdersResponse>('/api/mobile/my-orders', { params });
  return response.data;
};

export const getWorkOrderDetails = async (orderId: string): Promise<WorkOrder> => {
  const response = await apiClient.get<WorkOrder>(`/api/mobile/orders/${orderId}`);
  return response.data;
};

export const updateOrderStatus = async (
  orderId: string,
  status: OrderStatusUpdate,
  notes?: string
): Promise<WorkOrder> => {
  const response = await apiClient.patch<WorkOrder>(`/api/mobile/orders/${orderId}/status`, {
    status,
    notes,
  });
  return response.data;
};

export const addOrderNote = async (orderId: string, note: string): Promise<WorkOrder> => {
  const response = await apiClient.post<WorkOrder>(`/api/mobile/orders/${orderId}/notes`, {
    note,
  });
  return response.data;
};
