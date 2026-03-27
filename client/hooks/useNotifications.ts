import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@notifications_cache';
const COUNT_CACHE_KEY = '@notifications_unread_count';

export interface AppNotification {
  id: string;
  type: 'order_assigned' | 'order_updated' | 'deviation_response' |
    'team_invite' | 'schedule_change' | 'system' | 'reminder';
  title: string;
  body: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

interface UseNotificationsReturn {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export function useNotifications(): UseNotificationsReturn {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCached();
  }, []);

  useEffect(() => {
    if (token) {
      fetchNotifications();
      fetchUnreadCount();
    }
  }, [token]);

  async function loadCached() {
    try {
      const [cached, cachedCount] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        AsyncStorage.getItem(COUNT_CACHE_KEY),
      ]);
      if (cached) setNotifications(JSON.parse(cached));
      if (cachedCount) setUnreadCount(parseInt(cachedCount, 10));
    } catch (e) {
      console.log('Failed to load cached notifications:', e);
    }
  }

  async function fetchNotifications() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiRequest('GET', '/api/mobile/notifications?limit=50', undefined, token);
      if (data.success !== false && data.notifications) {
        setNotifications(data.notifications);
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data.notifications));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchUnreadCount() {
    try {
      const data = await apiRequest('GET', '/api/mobile/notifications/unread-count', undefined, token);
      if (data.success && data.unreadCount != null) {
        setUnreadCount(data.unreadCount);
        await AsyncStorage.setItem(COUNT_CACHE_KEY, String(data.unreadCount));
      }
    } catch (e) {
      console.log('Unread count fetch failed:', e);
    }
  }

  const refresh = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchUnreadCount()]);
  }, [token]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await apiRequest('POST', `/api/mobile/notifications/${id}/read`, {}, token);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  }, [token]);

  const markAllAsRead = useCallback(async () => {
    try {
      await apiRequest('POST', '/api/mobile/notifications/read-all', {}, token);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  }, [token]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh,
    markAsRead,
    markAllAsRead,
  };
}

export function useUnreadCount(): number {
  const { unreadCount } = useNotifications();
  return unreadCount;
}
