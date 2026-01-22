import { 
  getOutboxItems, 
  removeFromOutbox, 
  incrementRetryCount,
  updateSyncStatus,
  getCachedWorkOrders,
  cacheWorkOrders,
  cacheObjects,
  cacheArticles,
  cacheContacts,
  getPhotosForWorkOrder,
  markPhotoAsUploaded,
  updateCachedWorkOrder,
  getCachedWorkOrderById,
  clearOldCache,
} from './offlineDatabase';
import { apiRequest } from './queryClient';

const MAX_RETRY_COUNT = 5;
const SYNC_INTERVAL_MS = 30000;
const BASE_BACKOFF_MS = 1000;

interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

interface OutboxItemWithBackoff {
  id: string;
  type: string;
  retryCount: number;
  createdAt: string;
  nextRetryAt?: string;
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;
let onlineHandler: (() => void) | null = null;

function calculateBackoffDelay(retryCount: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCount), 60000);
}

function shouldRetryNow(item: OutboxItemWithBackoff): boolean {
  if (!item.nextRetryAt) return true;
  return new Date() >= new Date(item.nextRetryAt);
}

export async function processOutbox(): Promise<SyncResult> {
  if (isSyncing) {
    return { success: false, synced: 0, failed: 0, errors: ['Sync already in progress'] };
  }
  
  if (!navigator.onLine) {
    return { success: false, synced: 0, failed: 0, errors: ['Offline'] };
  }
  
  isSyncing = true;
  const result: SyncResult = { success: true, synced: 0, failed: 0, errors: [] };
  
  try {
    const items = await getOutboxItems();
    
    for (const item of items) {
      const itemWithBackoff = item as unknown as OutboxItemWithBackoff;
      
      if (item.retryCount >= MAX_RETRY_COUNT) {
        result.failed++;
        result.errors.push(`Item ${item.id} exceeded retry limit`);
        continue;
      }
      
      if (!shouldRetryNow(itemWithBackoff)) {
        continue;
      }
      
      try {
        await apiRequest(item.method, item.endpoint, item.payload);
        await removeFromOutbox(item.id);
        result.synced++;
        
        if (item.workOrderId) {
          const cached = await getCachedWorkOrderById(item.workOrderId);
          if (cached) {
            const cachedData = cached as Record<string, unknown>;
            const payload = item.payload as Record<string, unknown>;
            await updateCachedWorkOrder(item.workOrderId, {
              ...cachedData,
              ...payload,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (error) {
        await incrementRetryCount(item.id);
        result.failed++;
        result.errors.push(`Failed to sync ${item.type}: ${error}`);
        
        const delay = calculateBackoffDelay(item.retryCount + 1);
        console.log(`Will retry ${item.id} after ${delay}ms backoff`);
      }
    }
    
    await updateSyncStatus(result.synced, result.failed);
  } catch (error) {
    result.success = false;
    result.errors.push(`Sync error: ${error}`);
  } finally {
    isSyncing = false;
  }
  
  return result;
}

export async function uploadPendingPhotos(workOrderId: string): Promise<number> {
  if (!navigator.onLine) return 0;
  
  const photos = await getPhotosForWorkOrder(workOrderId);
  const pending = photos.filter(p => !p.uploaded);
  let uploaded = 0;
  
  for (const photo of pending) {
    try {
      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();
      
      const formData = new FormData();
      formData.append('file', blob, `${photo.type}-${photo.id}.jpg`);
      formData.append('workOrderId', workOrderId);
      formData.append('type', photo.type);
      
      await fetch('/api/work-orders/photos', {
        method: 'POST',
        body: formData,
      });
      
      await markPhotoAsUploaded(photo.id);
      uploaded++;
    } catch (error) {
      console.error(`Failed to upload photo ${photo.id}:`, error);
    }
  }
  
  return uploaded;
}

export async function fetchAndCacheData(resourceId?: string): Promise<void> {
  if (!navigator.onLine) return;
  
  try {
    const [workOrdersRes, articlesRes] = await Promise.all([
      fetch('/api/work-orders'),
      fetch('/api/articles'),
    ]);
    
    if (workOrdersRes.ok) {
      const workOrders = await workOrdersRes.json();
      await cacheWorkOrders(workOrders, resourceId);
      
      const objectIds = workOrders
        .map((wo: { objectId?: string }) => wo.objectId)
        .filter(Boolean);
      
      if (objectIds.length > 0) {
        const uniqueIds = Array.from(new Set(objectIds)) as string[];
        const objectsRes = await fetch('/api/objects/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: uniqueIds }),
        });
        
        if (objectsRes.ok) {
          const objects = await objectsRes.json();
          await cacheObjects(objects);
          
          const contactsRes = await fetch('/api/object-contacts/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ objectIds: uniqueIds }),
          });
          
          if (contactsRes.ok) {
            const contacts = await contactsRes.json();
            await cacheContacts(contacts);
          }
        }
      }
    }
    
    if (articlesRes.ok) {
      const articles = await articlesRes.json();
      await cacheArticles(articles);
    }
    
    await clearOldCache(7);
  } catch (error) {
    console.error('Failed to fetch and cache data:', error);
  }
}

export function startAutoSync(resourceId?: string): void {
  if (syncIntervalId) return;
  
  fetchAndCacheData(resourceId);
  
  syncIntervalId = setInterval(async () => {
    if (navigator.onLine) {
      await processOutbox();
      await fetchAndCacheData(resourceId);
    }
  }, SYNC_INTERVAL_MS);
  
  onlineHandler = async () => {
    await processOutbox();
    await fetchAndCacheData(resourceId);
  };
  
  window.addEventListener('online', onlineHandler);
}

export function stopAutoSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
}

export async function getOfflineWorkOrders(resourceId?: string): Promise<unknown[]> {
  return getCachedWorkOrders(resourceId);
}

export async function resolveConflict(
  localData: Record<string, unknown>,
  serverData: Record<string, unknown>,
  strategy: 'local' | 'server' | 'merge' = 'server'
): Promise<Record<string, unknown>> {
  switch (strategy) {
    case 'local':
      return localData;
    case 'server':
      return serverData;
    case 'merge':
      const localUpdatedAt = localData.updatedAt as string | undefined;
      const serverUpdatedAt = serverData.updatedAt as string | undefined;
      
      if (!localUpdatedAt || !serverUpdatedAt) {
        return serverData;
      }
      
      if (new Date(localUpdatedAt) > new Date(serverUpdatedAt)) {
        return { ...serverData, ...localData };
      }
      
      return { ...localData, ...serverData };
    default:
      return serverData;
  }
}
