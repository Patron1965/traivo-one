import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineQueueEntry, SyncStatus } from '../types';
import { syncOfflineActions } from '../api/sync';

const QUEUE_KEY = '@offline_queue';
const GPS_QUEUE_KEY = '@gps_queue';

function generateId(): string {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export async function getQueue(): Promise<OfflineQueueEntry[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function addToQueue(entry: Omit<OfflineQueueEntry, 'clientId' | 'timestamp' | 'synced' | 'retryCount'>): Promise<void> {
  const queue = await getQueue();
  queue.push({
    ...entry,
    clientId: generateId(),
    timestamp: Date.now(),
    synced: false,
    retryCount: 0,
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function syncQueue(): Promise<{ completed: number; failed: number }> {
  const queue = await getQueue();
  const pending = queue.filter(e => !e.synced);

  if (pending.length === 0) return { completed: 0, failed: 0 };

  try {
    const result = await syncOfflineActions(pending);

    const updatedQueue = queue.map(entry => {
      const syncResult = result.results.find(r => r.clientId === entry.clientId);
      if (syncResult && syncResult.status === 'completed') {
        return { ...entry, synced: true };
      }
      if (syncResult && syncResult.status === 'error') {
        return { ...entry, retryCount: entry.retryCount + 1 };
      }
      return entry;
    });

    const cleaned = updatedQueue.filter(e => !e.synced || (Date.now() - e.timestamp < 24 * 60 * 60 * 1000));
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(cleaned));

    return { completed: result.completed, failed: result.failed };
  } catch {
    return { completed: 0, failed: pending.length };
  }
}

export async function clearSyncedEntries(): Promise<void> {
  const queue = await getQueue();
  const pending = queue.filter(e => !e.synced);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(pending));
}

export async function getPendingCount(): Promise<number> {
  const queue = await getQueue();
  return queue.filter(e => !e.synced).length;
}

export async function addGPSPoints(points: Array<{ latitude: number; longitude: number; accuracy: number; speed: number }>): Promise<void> {
  for (const point of points) {
    await addToQueue({
      type: 'gps',
      payload: point,
    });
  }
}

export function getSyncStatus(pendingCount: number, isOnline: boolean): SyncStatus {
  if (!isOnline) return 'offline';
  if (pendingCount > 0) return 'syncing';
  return 'online';
}
