import { apiClient } from './client';
import type { OfflineQueueEntry, DaySummary, Article, RouteFeedback } from '../types';

interface SyncResponse {
  success: boolean;
  processed: number;
  completed: number;
  failed: number;
  results: Array<{ clientId: string; status: string; error?: string }>;
}

export const syncOfflineActions = async (actions: OfflineQueueEntry[]): Promise<SyncResponse> => {
  const response = await apiClient.post<SyncResponse>('/api/mobile/sync', {
    actions: actions.map(a => ({
      clientId: a.clientId,
      actionType: a.type,
      payload: a.payload,
    })),
  });
  return response.data;
};

export const getSyncStatus = async () => {
  const response = await apiClient.get('/api/mobile/sync/status');
  return response.data;
};

export const getDaySummary = async (): Promise<DaySummary> => {
  const response = await apiClient.get<DaySummary>('/api/mobile/summary');
  return response.data;
};

export const getWeather = async (lat?: number, lng?: number) => {
  const params: Record<string, number> = {};
  if (lat !== undefined) params.lat = lat;
  if (lng !== undefined) params.lon = lng;
  const response = await apiClient.get('/api/mobile/weather', { params });
  return response.data;
};

export const getArticles = async (search?: string): Promise<Article[]> => {
  const params = search ? { search } : {};
  const response = await apiClient.get<Article[]>('/api/mobile/articles', { params });
  return response.data;
};

export const submitRouteFeedback = async (feedback: RouteFeedback): Promise<{ success: boolean }> => {
  const response = await apiClient.post('/api/mobile/route-feedback', feedback);
  return response.data;
};

export const getMyRouteFeedback = async (): Promise<RouteFeedback[]> => {
  const response = await apiClient.get<RouteFeedback[]>('/api/mobile/route-feedback/mine');
  return response.data;
};

export const reportDeviation = async (orderId: string, deviation: {
  type: string;
  description: string;
  latitude?: number;
  longitude?: number;
  photos?: string[];
}) => {
  const response = await apiClient.post(`/api/mobile/orders/${orderId}/deviations`, deviation);
  return response.data;
};

export const logMaterial = async (orderId: string, material: {
  articleId: string;
  articleNumber?: string;
  articleName?: string;
  quantity: number;
}) => {
  const response = await apiClient.post(`/api/mobile/orders/${orderId}/materials`, material);
  return response.data;
};

export const submitSignature = async (orderId: string, signature: string) => {
  const response = await apiClient.post(`/api/mobile/orders/${orderId}/signature`, { signature });
  return response.data;
};

export const submitInspections = async (orderId: string, inspections: Array<{
  category: string;
  status: string;
  comment?: string;
  issues?: string[];
}>) => {
  const response = await apiClient.post(`/api/mobile/orders/${orderId}/inspections`, { inspections });
  return response.data;
};

export const sendGPSPosition = async (data: {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  currentOrderId?: string;
}) => {
  const response = await apiClient.post('/api/mobile/gps', data);
  return response.data;
};

export const getOrderChecklist = async (orderId: string): Promise<{
  orderId: string;
  articleTypes: string[];
  checklists: Array<{
    templateId: string;
    name: string;
    articleType: string;
    questions: Array<{ id?: string; text: string; required?: boolean }>;
  }>;
}> => {
  const response = await apiClient.get(`/api/mobile/orders/${orderId}/checklist`);
  return response.data;
};

export const submitChecklist = async (orderId: string, checklist: Array<{ id: string; label: string; checked: boolean; comment?: string }>): Promise<void> => {
  await apiClient.post(`/api/mobile/orders/${orderId}/checklist`, { checklist });
};

export const submitPhotos = async (orderId: string, photos: Array<{ uri: string; caption: string }>): Promise<void> => {
  await apiClient.post(`/api/mobile/orders/${orderId}/photos`, { photos });
};
