import { db } from "./db";
import { clusters, objects, customers } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

interface DbError extends Error {
  code?: string;
}

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

  try {
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
  } catch (err: unknown) {
    const dbErr = err as DbError;
    if (dbErr.code === "23505") {
      const [retry] = await db
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
      if (retry) return retry.id;
    }
    throw err;
  }
}

export async function updateClusterCache(clusterId: string): Promise<void> {
  const [totalRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(objects)
    .where(and(eq(objects.clusterId, clusterId), isNull(objects.deletedAt)));

  const [geoRow] = await db
    .select({
      avgLat: sql<number>`avg(${objects.latitude})`,
      avgLng: sql<number>`avg(${objects.longitude})`,
      geoCnt: sql<number>`count(*)::int`,
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

  const updateData: Record<string, unknown> = {
    cachedObjectCount: totalRow?.cnt ?? 0,
  };

  if (geoRow && geoRow.geoCnt > 0) {
    updateData.centerLatitude = geoRow.avgLat;
    updateData.centerLongitude = geoRow.avgLng;
  } else {
    updateData.centerLatitude = null;
    updateData.centerLongitude = null;
  }

  await db
    .update(clusters)
    .set(updateData)
    .where(eq(clusters.id, clusterId));
}

export async function ensureClusterAndAssign(
  tenantId: string,
  customerId: string,
  objectId: string
): Promise<string> {
  const [existingObj] = await db
    .select({ clusterId: objects.clusterId })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));

  const oldClusterId = existingObj?.clusterId ?? null;

  const clusterId = await ensureClusterForCustomer(tenantId, customerId);

  await db
    .update(objects)
    .set({ clusterId })
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));

  updateClusterCache(clusterId).catch((err: unknown) => {
    console.error(`Failed to update cache for cluster ${clusterId}:`, err);
  });

  if (oldClusterId && oldClusterId !== clusterId) {
    updateClusterCache(oldClusterId).catch((err: unknown) => {
      console.error(`Failed to update cache for old cluster ${oldClusterId}:`, err);
    });
  }

  return clusterId;
}
