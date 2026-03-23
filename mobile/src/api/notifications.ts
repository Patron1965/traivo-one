import { apiClient } from './client';
import type { Notification } from '../types';

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
}

export const getNotifications = async (unreadOnly = false): Promise<NotificationsResponse> => {
  const response = await apiClient.get<NotificationsResponse>('/api/mobile/notifications', {
    params: { unread: unreadOnly ? 'true' : 'false' },
  });
  return response.data;
};

export const markNotificationRead = async (notificationId: string): Promise<Notification> => {
  const response = await apiClient.patch<Notification>(`/api/mobile/notifications/${notificationId}/read`);
  return response.data;
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await apiClient.patch('/api/mobile/notifications/read-all');
};

export const getUnreadCount = async (): Promise<number> => {
  const response = await apiClient.get<{ unreadCount: number }>('/api/mobile/notifications/count');
  return response.data.unreadCount;
};
