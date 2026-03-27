import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { apiRequest } from '../lib/query-client';

const QUEUE_KEY = '@offline_queue';

interface QueuedAction {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: any;
  createdAt: string;
  retries: number;
}

class OfflineQueue {
  private queue: QueuedAction[] = [];
  private processing = false;

  async init() {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (stored) this.queue = JSON.parse(stored);
    } catch (e) {
      console.log('Failed to load offline queue:', e);
    }

    NetInfo.addEventListener(state => {
      if (state.isConnected && this.queue.length > 0) {
        this.processQueue();
      }
    });
  }

  async add(action: Omit<QueuedAction, 'id' | 'createdAt' | 'retries'>) {
    const item: QueuedAction = {
      ...action,
      id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      createdAt: new Date().toISOString(),
      retries: 0,
    };
    this.queue.push(item);
    await this.save();
  }

  async processQueue(authToken?: string | null) {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      this.processing = false;
      return;
    }

    const toProcess = [...this.queue];
    const failed: QueuedAction[] = [];

    for (const action of toProcess) {
      try {
        await apiRequest(action.method, action.url, action.body, authToken);
        console.log(`[OfflineQueue] Processed: ${action.method} ${action.url}`);
      } catch (e) {
        action.retries += 1;
        if (action.retries < 5) {
          failed.push(action);
        } else {
          console.warn(`[OfflineQueue] Dropped after 5 retries: ${action.url}`);
        }
      }
    }

    this.queue = failed;
    await this.save();
    this.processing = false;
  }

  private async save() {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

export const offlineQueue = new OfflineQueue();
