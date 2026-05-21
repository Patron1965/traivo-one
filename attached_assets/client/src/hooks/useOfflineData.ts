import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCachedWorkOrders,
  getCachedObjects,
  getCachedArticles,
  getCachedContactsByObjectId,
  addToOutbox,
  getOutboxItems,
  getCacheStats,
  savePhotoLocally,
  getPhotosForWorkOrder,
} from '@/lib/offlineDatabase';
import {
  startAutoSync,
  stopAutoSync,
  processOutbox,
  fetchAndCacheData,
} from '@/lib/offlineSync';
import type { WorkOrderWithObject } from '@shared/schema';

interface UseOfflineDataOptions {
  resourceId?: string;
  autoSync?: boolean;
}

interface OfflineDataState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncAt: Date | null;
}

export function useOfflineData({ resourceId, autoSync = true }: UseOfflineDataOptions = {}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<OfflineDataState>({
    isOnline: navigator.onLine,
    isSyncing: false,
    pendingChanges: 0,
    lastSyncAt: null,
  });

  useEffect(() => {
    const handleOnline = () => setState(prev => ({ ...prev, isOnline: true }));
    const handleOffline = () => setState(prev => ({ ...prev, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (autoSync) {
      startAutoSync(resourceId);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      stopAutoSync();
    };
  }, [resourceId, autoSync]);

  useEffect(() => {
    const updatePendingCount = async () => {
      const items = await getOutboxItems();
      setState(prev => ({ ...prev, pendingChanges: items.length }));
    };
    
    updatePendingCount();
    const interval = setInterval(updatePendingCount, 5000);
    return () => clearInterval(interval);
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) return { success: false };
    
    setState(prev => ({ ...prev, isSyncing: true }));
    try {
      const result = await processOutbox();
      await fetchAndCacheData(resourceId);
      await queryClient.invalidateQueries();
      setState(prev => ({ 
        ...prev, 
        isSyncing: false, 
        lastSyncAt: new Date(),
        pendingChanges: result.failed,
      }));
      return result;
    } catch (error) {
      setState(prev => ({ ...prev, isSyncing: false }));
      return { success: false, error };
    }
  }, [resourceId, queryClient]);

  const queueStatusUpdate = useCallback(async (
    workOrderId: string,
    status: string,
    additionalData?: Record<string, unknown>
  ) => {
    await addToOutbox({
      type: 'status_update',
      endpoint: `/api/work-orders/${workOrderId}`,
      method: 'PATCH',
      payload: { status, ...additionalData },
      workOrderId,
    });
    setState(prev => ({ ...prev, pendingChanges: prev.pendingChanges + 1 }));
  }, []);

  const queueDeviation = useCallback(async (
    workOrderId: string,
    deviation: { category: string; description: string; severity?: number }
  ) => {
    await addToOutbox({
      type: 'deviation',
      endpoint: `/api/work-orders/${workOrderId}/deviations`,
      method: 'POST',
      payload: deviation,
      workOrderId,
    });
    setState(prev => ({ ...prev, pendingChanges: prev.pendingChanges + 1 }));
  }, []);

  const queueMaterialLog = useCallback(async (
    workOrderId: string,
    materials: Array<{ articleId: string; quantity: number; unit: string }>
  ) => {
    await addToOutbox({
      type: 'material_log',
      endpoint: `/api/work-orders/${workOrderId}/materials`,
      method: 'POST',
      payload: { materials },
      workOrderId,
    });
    setState(prev => ({ ...prev, pendingChanges: prev.pendingChanges + 1 }));
  }, []);

  const savePhoto = useCallback(async (
    workOrderId: string,
    dataUrl: string,
    type: 'before' | 'after' | 'deviation'
  ) => {
    return savePhotoLocally(workOrderId, dataUrl, type);
  }, []);

  const getLocalPhotos = useCallback(async (workOrderId: string) => {
    return getPhotosForWorkOrder(workOrderId);
  }, []);

  return {
    ...state,
    syncNow,
    queueStatusUpdate,
    queueDeviation,
    queueMaterialLog,
    savePhoto,
    getLocalPhotos,
  };
}

export function useOfflineWorkOrders(resourceId?: string) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const onlineQuery = useQuery<WorkOrderWithObject[]>({
    queryKey: ['/api/work-orders'],
    enabled: isOnline,
    staleTime: 30000,
  });

  const [offlineData, setOfflineData] = useState<WorkOrderWithObject[]>([]);

  useEffect(() => {
    if (!isOnline) {
      getCachedWorkOrders(resourceId).then(data => {
        setOfflineData(data as WorkOrderWithObject[]);
      });
    }
  }, [isOnline, resourceId]);

  return {
    data: isOnline ? onlineQuery.data : offlineData,
    isLoading: isOnline ? onlineQuery.isLoading : false,
    isOnline,
    isFromCache: !isOnline,
    refetch: onlineQuery.refetch,
  };
}

export function useOfflineObjects(ids: string[]) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineData, setOfflineData] = useState<unknown[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline && ids.length > 0) {
      getCachedObjects(ids).then(setOfflineData);
    }
  }, [isOnline, ids]);

  return {
    data: isOnline ? undefined : offlineData,
    isOnline,
    isFromCache: !isOnline,
  };
}

export function useOfflineArticles() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineData, setOfflineData] = useState<unknown[]>([]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) {
      getCachedArticles().then(setOfflineData);
    }
  }, [isOnline]);

  return {
    data: isOnline ? undefined : offlineData,
    isOnline,
    isFromCache: !isOnline,
  };
}

export function useCacheStats() {
  const [stats, setStats] = useState<{
    workOrderCount: number;
    objectCount: number;
    articleCount: number;
    contactCount: number;
    photoCount: number;
    outboxCount: number;
    pendingPhotos: number;
  } | null>(null);

  useEffect(() => {
    getCacheStats().then(setStats);
    const interval = setInterval(() => getCacheStats().then(setStats), 10000);
    return () => clearInterval(interval);
  }, []);

  return stats;
}
