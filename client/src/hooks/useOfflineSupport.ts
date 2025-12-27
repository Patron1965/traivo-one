import { useState, useEffect, useCallback } from "react";

interface OfflineSupportOptions {
  onOnline?: () => void;
  onOffline?: () => void;
}

export function useOfflineSupport(options: OfflineSupportOptions = {}) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isFromCache, setIsFromCache] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      options.onOnline?.();
    };

    const handleOffline = () => {
      setIsOnline(false);
      options.onOffline?.();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [options.onOnline, options.onOffline]);

  const cacheWorkOrders = useCallback((workOrders: unknown[]) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_WORK_ORDERS',
        workOrders
      });
    }
  }, []);

  const clearCache = useCallback(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage('clearCache');
    }
  }, []);

  const checkIfFromCache = useCallback((response: Response) => {
    const fromCache = response.headers.get('X-From-Cache') === 'true';
    setIsFromCache(fromCache);
    return fromCache;
  }, []);

  return {
    isOnline,
    isFromCache,
    cacheWorkOrders,
    clearCache,
    checkIfFromCache
  };
}
