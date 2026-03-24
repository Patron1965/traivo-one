import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/query-client';
import { useSettings } from '../lib/settings';
import type { SyncAction } from '../types';

const OUTBOX_KEY = '@offline_outbox';
const CACHE_PREFIX = '@offline_cache_';
const ROUTE_CACHE_PREFIX = '@route_cache_';
const ORDER_CACHE_KEY = '@order_cache';
const SYNC_INTERVAL_NORMAL = 30000;
const SYNC_INTERVAL_OFFLINE = 120000;
const MAX_OUTBOX_ITEMS = 500;
const MAX_OUTBOX_BYTES = 5 * 1024 * 1024;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let globalPendingCount = 0;
let globalListeners: Array<(count: number) => void> = [];

let processingMutex: Promise<void> = Promise.resolve();

function notifyListeners() {
  globalListeners.forEach(fn => fn(globalPendingCount));
}

export function useOfflinePendingCount(): number {
  const [count, setCount] = useState(globalPendingCount);
  useEffect(() => {
    const listener = (c: number) => setCount(c);
    if (!globalListeners.includes(listener)) {
      globalListeners.push(listener);
    }
    return () => {
      globalListeners = globalListeners.filter(l => l !== listener);
    };
  }, []);
  return count;
}

async function getOutbox(): Promise<SyncAction[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveOutbox(actions: SyncAction[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(actions));
  globalPendingCount = actions.length;
  notifyListeners();
}

function isOnline(): boolean {
  if (Platform.OS === 'web') {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }
  return true;
}

export function useOfflineSync() {
  const queryClient = useQueryClient();
  const { settings } = useSettings();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  const enqueueAction = useCallback(async (action: Omit<SyncAction, 'clientId' | 'timestamp'>) => {
    let resolve!: () => void;
    const gate = new Promise<void>(r => { resolve = r; });
    const prev = processingMutex;
    processingMutex = prev.then(() => gate);

    try {
      await prev;

      const outbox = await getOutbox();

      if (outbox.length >= MAX_OUTBOX_ITEMS) {
        console.warn(`Offline outbox full (${MAX_OUTBOX_ITEMS} items). Dropping oldest entry.`);
        outbox.shift();
      }

      const serialized = JSON.stringify(outbox);
      if (serialized.length >= MAX_OUTBOX_BYTES) {
        console.warn(`Offline outbox approaching size limit (${MAX_OUTBOX_BYTES} bytes). Dropping oldest entries.`);
        while (outbox.length > 0 && JSON.stringify(outbox).length >= MAX_OUTBOX_BYTES) {
          outbox.shift();
        }
      }

      const syncAction: SyncAction = {
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: Date.now(),
        ...action,
      };
      outbox.push(syncAction);
      await saveOutbox(outbox);
      return syncAction.clientId;
    } finally {
      resolve();
    }
  }, []);

  const processOutbox = useCallback(async () => {
    if (!isOnline()) return;

    let resolve!: () => void;
    const gate = new Promise<void>(r => { resolve = r; });
    const prev = processingMutex;
    processingMutex = prev.then(() => gate);

    try {
      await prev;

      const outbox = await getOutbox();
      if (outbox.length === 0) return;

      setIsSyncing(true);

      const result = await apiRequest('POST', '/api/mobile/sync', { actions: outbox });

      if (result.success && result.results) {
        const successIds = new Set(
          result.results
            .filter((r: any) => r.success)
            .map((r: any) => r.clientId)
        );

        const freshOutbox = await getOutbox();
        const remaining = freshOutbox.filter(a => !successIds.has(a.clientId));
        await saveOutbox(remaining);

        const now = new Date().toISOString();
        setLastSyncTime(now);
        await AsyncStorage.setItem('@last_sync_time', now);

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
      }
    } catch (err) {
      console.warn('Offline sync failed:', err);
    } finally {
      setIsSyncing(false);
      resolve();
    }
  }, [queryClient]);

  const cacheData = useCallback(async (key: string, data: any) => {
    try {
      await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({
        data,
        cachedAt: Date.now(),
      }));
    } catch {}
  }, []);

  const getCachedData = useCallback(async (key: string): Promise<any | null> => {
    try {
      const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const age = Date.now() - parsed.cachedAt;
        if (age < 24 * 60 * 60 * 1000) {
          return parsed.data;
        }
      }
    } catch {}
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      const outbox = await getOutbox();
      globalPendingCount = outbox.length;
      notifyListeners();
      const stored = await AsyncStorage.getItem('@last_sync_time');
      if (stored) setLastSyncTime(stored);
    })();

    const syncInterval = settings.offlineMode ? SYNC_INTERVAL_OFFLINE : SYNC_INTERVAL_NORMAL;
    intervalRef.current = setInterval(async () => {
      if (globalPendingCount > 0) {
        processOutbox();
      }
    }, syncInterval);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        processOutbox();
      }
    });

    if (Platform.OS === 'web') {
      const handleOnline = () => processOutbox();
      window.addEventListener('online', handleOnline);
      return () => {
        window.removeEventListener('online', handleOnline);
        if (intervalRef.current) clearInterval(intervalRef.current);
        subscription.remove();
      };
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscription.remove();
    };
  }, [processOutbox, settings.offlineMode]);

  const cacheRouteData = useCallback(async (routeData: any) => {
    try {
      const dateKey = new Date().toISOString().split('T')[0];
      await AsyncStorage.setItem(`${ROUTE_CACHE_PREFIX}${dateKey}`, JSON.stringify({
        data: routeData,
        cachedAt: Date.now(),
      }));
      await cleanOldRouteCaches();
    } catch {}
  }, []);

  const getCachedRouteData = useCallback(async (): Promise<any | null> => {
    try {
      const dateKey = new Date().toISOString().split('T')[0];
      const raw = await AsyncStorage.getItem(`${ROUTE_CACHE_PREFIX}${dateKey}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.cachedAt < CACHE_MAX_AGE_MS) {
          return parsed.data;
        }
        await AsyncStorage.removeItem(`${ROUTE_CACHE_PREFIX}${dateKey}`);
      }
    } catch {}
    return null;
  }, []);

  const cacheOrderData = useCallback(async (orders: any[]) => {
    try {
      await AsyncStorage.setItem(ORDER_CACHE_KEY, JSON.stringify({
        data: orders,
        cachedAt: Date.now(),
      }));
    } catch {}
  }, []);

  const getCachedOrderData = useCallback(async (): Promise<any[] | null> => {
    try {
      const raw = await AsyncStorage.getItem(ORDER_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.cachedAt < CACHE_MAX_AGE_MS) {
          return parsed.data;
        }
        await AsyncStorage.removeItem(ORDER_CACHE_KEY);
      }
    } catch {}
    return null;
  }, []);

  return {
    enqueueAction,
    processOutbox,
    cacheData,
    getCachedData,
    cacheRouteData,
    getCachedRouteData,
    cacheOrderData,
    getCachedOrderData,
    isSyncing,
    lastSyncTime,
  };
}

async function cleanOldRouteCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const routeKeys = keys.filter(k => k.startsWith(ROUTE_CACHE_PREFIX));
    for (const key of routeKeys) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.cachedAt >= CACHE_MAX_AGE_MS) {
          await AsyncStorage.removeItem(key);
        }
      }
    }
  } catch {}
}
