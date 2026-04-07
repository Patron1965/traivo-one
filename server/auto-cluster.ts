import { db } from "./db";
import { clusters, objects, customers } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

const clusterLocks = new Map<string, Promise<string>>();

export async function ensureClusterForCustomer(
  tenantId: string,
  customerId: string
): Promise<string> {
  const lockKey = `${tenantId}:${customerId}`;
  const existing = clusterLocks.get(lockKey);
  if (existing) {
    return existing;
  }

  const promise = _ensureClusterForCustomerImpl(tenantId, customerId).finally(() => {
    clusterLocks.delete(lockKey);
  });
  clusterLocks.set(lockKey, promise);
  return promise;
}

async function _ensureClusterForCustomerImpl(
  tenantId: string,
  customerId: string
): Promise<string> {
  const [existingCluster] = await db
    .select({ id: clusters.id })
    .from(clusters)
    .where(
      and(
        eq(clusters.tenantId, tenantId),
        eq(clusters.rootCustomerId, customerId),
        isNull(clusters.deletedAt)
      )
    )
    .limit(1);

  if (existingCluster) {
    return existingCluster.id;
  }

  const [customer] = await db
    .select({ name: customers.name })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));

  const clusterName = customer?.name || `Kluster (${customerId.slice(0, 8)})`;

  const [newCluster] = await db
    .insert(clusters)
    .values({
      tenantId,
      rootCustomerId: customerId,
      name: clusterName,
      status: "active",
    })
    .returning({ id: clusters.id });

  return newCluster.id;
}

export async function updateClusterGeoCenter(clusterId: string): Promise<void> {
  const result = await db
    .select({
      avgLat: sql<number>`avg(${objects.latitude})`,
      avgLng: sql<number>`avg(${objects.longitude})`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(objects)
    .where(
      and(
        eq(objects.clusterId, clusterId),
        isNull(objects.deletedAt),
        sql`${objects.latitude} IS NOT NULL`,
        sql`${objects.longitude} IS NOT NULL`
      )
    );

  const row = result[0];
  if (!row || row.cnt === 0) return;

  const totalCount = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(objects)
    .where(and(eq(objects.clusterId, clusterId), isNull(objects.deletedAt)));

  await db
    .update(clusters)
    .set({
      centerLatitude: row.avgLat,
      centerLongitude: row.avgLng,
      cachedObjectCount: totalCount[0]?.cnt ?? 0,
    })
    .where(eq(clusters.id, clusterId));
}

export async function ensureClusterAndAssign(
  tenantId: string,
  customerId: string,
  objectId: string,
  hasCoordinates: boolean = false
): Promise<string> {
  const clusterId = await ensureClusterForCustomer(tenantId, customerId);

  await db
    .update(objects)
    .set({ clusterId })
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));

  if (hasCoordinates) {
    updateClusterGeoCenter(clusterId).catch((err) => {
      console.error(`Failed to update geo center for cluster ${clusterId}:`, err);
    });
  }

  return clusterId;
}
