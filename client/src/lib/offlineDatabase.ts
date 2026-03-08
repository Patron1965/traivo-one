import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface OutboxItem {
  id: string;
  type: 'status_update' | 'photo_upload' | 'deviation' | 'material_log' | 'signature' | 'note';
  endpoint: string;
  method: 'POST' | 'PATCH' | 'PUT';
  payload: unknown;
  createdAt: string;
  retryCount: number;
  workOrderId?: string;
}

interface CachedWorkOrder {
  id: string;
  data: unknown;
  cachedAt: string;
  resourceId?: string;
  scheduledDate?: string;
}

interface CachedObject {
  id: string;
  data: unknown;
  cachedAt: string;
}

interface CachedArticle {
  id: string;
  data: unknown;
  cachedAt: string;
}

interface CachedContact {
  id: string;
  objectId?: string;
  customerId?: string;
  data: unknown;
  cachedAt: string;
}

interface CachedPhoto {
  id: string;
  workOrderId: string;
  dataUrl: string;
  type: 'before' | 'after' | 'deviation';
  createdAt: string;
  uploaded: boolean;
}

interface SyncStatus {
  id: string;
  lastSyncAt: string;
  pendingCount: number;
  failedCount: number;
}

interface OfflineDBSchema extends DBSchema {
  workOrders: {
    key: string;
    value: CachedWorkOrder;
    indexes: { 'by-resourceId': string; 'by-scheduledDate': string };
  };
  objects: {
    key: string;
    value: CachedObject;
  };
  articles: {
    key: string;
    value: CachedArticle;
  };
  contacts: {
    key: string;
    value: CachedContact;
    indexes: { 'by-objectId': string; 'by-customerId': string };
  };
  photos: {
    key: string;
    value: CachedPhoto;
    indexes: { 'by-workOrderId': string; 'by-uploaded': number };
  };
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-workOrderId': string; 'by-type': string };
  };
  syncStatus: {
    key: string;
    value: SyncStatus;
  };
}

const DB_NAME = 'nordfield-offline-db';
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<OfflineDBSchema> | null = null;

export async function getOfflineDB(): Promise<IDBPDatabase<OfflineDBSchema>> {
  if (dbInstance) return dbInstance;
  
  dbInstance = await openDB<OfflineDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const workOrdersStore = db.createObjectStore('workOrders', { keyPath: 'id' });
      workOrdersStore.createIndex('by-resourceId', 'resourceId');
      workOrdersStore.createIndex('by-scheduledDate', 'scheduledDate');
      
      db.createObjectStore('objects', { keyPath: 'id' });
      db.createObjectStore('articles', { keyPath: 'id' });
      
      const contactsStore = db.createObjectStore('contacts', { keyPath: 'id' });
      contactsStore.createIndex('by-objectId', 'objectId');
      contactsStore.createIndex('by-customerId', 'customerId');
      
      const photosStore = db.createObjectStore('photos', { keyPath: 'id' });
      photosStore.createIndex('by-workOrderId', 'workOrderId');
      photosStore.createIndex('by-uploaded', 'uploaded');
      
      const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
      outboxStore.createIndex('by-workOrderId', 'workOrderId');
      outboxStore.createIndex('by-type', 'type');
      
      db.createObjectStore('syncStatus', { keyPath: 'id' });
    },
  });
  
  return dbInstance;
}

export async function cacheWorkOrders(workOrders: unknown[], resourceId?: string): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction('workOrders', 'readwrite');
  const now = new Date().toISOString();
  
  for (const wo of workOrders) {
    const workOrder = wo as { id: string; scheduledDate?: string };
    await tx.store.put({
      id: workOrder.id,
      data: wo,
      cachedAt: now,
      resourceId,
      scheduledDate: workOrder.scheduledDate,
    });
  }
  
  await tx.done;
}

export async function getCachedWorkOrders(resourceId?: string): Promise<unknown[]> {
  const db = await getOfflineDB();
  
  if (resourceId) {
    const items = await db.getAllFromIndex('workOrders', 'by-resourceId', resourceId);
    return items.map(item => item.data);
  }
  
  const items = await db.getAll('workOrders');
  return items.map(item => item.data);
}

export async function getCachedWorkOrderById(id: string): Promise<unknown | null> {
  const db = await getOfflineDB();
  const item = await db.get('workOrders', id);
  return item?.data ?? null;
}

export async function updateCachedWorkOrder(id: string, updates: unknown): Promise<void> {
  const db = await getOfflineDB();
  const existing = await db.get('workOrders', id);
  
  if (existing) {
    const currentData = existing.data as Record<string, unknown>;
    await db.put('workOrders', {
      ...existing,
      data: { ...currentData, ...updates as Record<string, unknown> },
      cachedAt: new Date().toISOString(),
    });
  }
}

export async function cacheObjects(objects: unknown[]): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction('objects', 'readwrite');
  const now = new Date().toISOString();
  
  for (const obj of objects) {
    const object = obj as { id: string };
    await tx.store.put({
      id: object.id,
      data: obj,
      cachedAt: now,
    });
  }
  
  await tx.done;
}

export async function getCachedObjects(ids?: string[]): Promise<unknown[]> {
  const db = await getOfflineDB();
  
  if (ids && ids.length > 0) {
    const results = await Promise.all(ids.map(id => db.get('objects', id)));
    return results.filter(Boolean).map(item => item!.data);
  }
  
  const items = await db.getAll('objects');
  return items.map(item => item.data);
}

export async function cacheArticles(articles: unknown[]): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction('articles', 'readwrite');
  const now = new Date().toISOString();
  
  for (const article of articles) {
    const art = article as { id: string };
    await tx.store.put({
      id: art.id,
      data: article,
      cachedAt: now,
    });
  }
  
  await tx.done;
}

export async function getCachedArticles(): Promise<unknown[]> {
  const db = await getOfflineDB();
  const items = await db.getAll('articles');
  return items.map(item => item.data);
}

export async function cacheContacts(contacts: unknown[]): Promise<void> {
  const db = await getOfflineDB();
  const tx = db.transaction('contacts', 'readwrite');
  const now = new Date().toISOString();
  
  for (const contact of contacts) {
    const c = contact as { id: string; objectId?: string; customerId?: string };
    await tx.store.put({
      id: c.id,
      objectId: c.objectId,
      customerId: c.customerId,
      data: contact,
      cachedAt: now,
    });
  }
  
  await tx.done;
}

export async function getCachedContactsByObjectId(objectId: string): Promise<unknown[]> {
  const db = await getOfflineDB();
  const items = await db.getAllFromIndex('contacts', 'by-objectId', objectId);
  return items.map(item => item.data);
}

export async function savePhotoLocally(
  workOrderId: string,
  dataUrl: string,
  type: 'before' | 'after' | 'deviation'
): Promise<string> {
  const db = await getOfflineDB();
  const id = `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  await db.put('photos', {
    id,
    workOrderId,
    dataUrl,
    type,
    createdAt: new Date().toISOString(),
    uploaded: false,
  });
  
  return id;
}

export async function getPhotosForWorkOrder(workOrderId: string): Promise<CachedPhoto[]> {
  const db = await getOfflineDB();
  return db.getAllFromIndex('photos', 'by-workOrderId', workOrderId);
}

export async function markPhotoAsUploaded(id: string): Promise<void> {
  const db = await getOfflineDB();
  const photo = await db.get('photos', id);
  if (photo) {
    await db.put('photos', { ...photo, uploaded: true });
  }
}

export async function addToOutbox(item: Omit<OutboxItem, 'id' | 'createdAt' | 'retryCount'>): Promise<string> {
  const db = await getOfflineDB();
  const id = `outbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  await db.put('outbox', {
    ...item,
    id,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  });
  
  return id;
}

export async function getOutboxItems(): Promise<OutboxItem[]> {
  const db = await getOfflineDB();
  return db.getAll('outbox');
}

export async function removeFromOutbox(id: string): Promise<void> {
  const db = await getOfflineDB();
  await db.delete('outbox', id);
}

export async function incrementRetryCount(id: string): Promise<void> {
  const db = await getOfflineDB();
  const item = await db.get('outbox', id);
  if (item) {
    await db.put('outbox', { ...item, retryCount: item.retryCount + 1 });
  }
}

export async function getOutboxCountForWorkOrder(workOrderId: string): Promise<number> {
  const db = await getOfflineDB();
  const items = await db.getAllFromIndex('outbox', 'by-workOrderId', workOrderId);
  return items.length;
}

export async function updateSyncStatus(
  pendingCount: number,
  failedCount: number
): Promise<void> {
  const db = await getOfflineDB();
  await db.put('syncStatus', {
    id: 'main',
    lastSyncAt: new Date().toISOString(),
    pendingCount,
    failedCount,
  });
}

export async function getSyncStatus(): Promise<SyncStatus | null> {
  const db = await getOfflineDB();
  const result = await db.get('syncStatus', 'main');
  return result !== undefined ? result : null;
}

export async function clearOldCache(daysOld: number = 7): Promise<void> {
  const db = await getOfflineDB();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoff = cutoffDate.toISOString();
  
  const stores: Array<'workOrders' | 'objects' | 'articles' | 'contacts' | 'photos'> = [
    'workOrders', 'objects', 'articles', 'contacts', 'photos'
  ];
  
  for (const storeName of stores) {
    const tx = db.transaction(storeName, 'readwrite');
    const items = await tx.store.getAll();
    
    for (const item of items) {
      const cacheTime = 'cachedAt' in item ? item.cachedAt : ('createdAt' in item ? item.createdAt : null);
      if (cacheTime && cacheTime < cutoff) {
        await tx.store.delete(item.id);
      }
    }
    
    await tx.done;
  }
}

export async function getCacheStats(): Promise<{
  workOrderCount: number;
  objectCount: number;
  articleCount: number;
  contactCount: number;
  photoCount: number;
  outboxCount: number;
  pendingPhotos: number;
}> {
  const db = await getOfflineDB();
  
  const [
    workOrders,
    objects,
    articles,
    contacts,
    photos,
    outbox,
  ] = await Promise.all([
    db.count('workOrders'),
    db.count('objects'),
    db.count('articles'),
    db.count('contacts'),
    db.count('photos'),
    db.count('outbox'),
  ]);
  
  const allPhotos = await db.getAll('photos');
  const pendingPhotos = allPhotos.filter(p => !p.uploaded).length;
  
  return {
    workOrderCount: workOrders,
    objectCount: objects,
    articleCount: articles,
    contactCount: contacts,
    photoCount: photos,
    outboxCount: outbox,
    pendingPhotos,
  };
}
