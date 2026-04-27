/**
 * In-memory TTL cache for tenant-scoped dashboard aggregations.
 *
 * Use cases (paket A): capacity-forecast, sla-risk-summary, kpis/daily, kpis/weekly.
 * - Per-tenant namespacing — never share entries across tenants.
 * - Configurable TTL per call.
 * - Manual invalidation by tenant (optionally by key prefix).
 * - Hit/miss counters for observability.
 * - Hard cap on entries to bound memory; oldest entries are evicted first.
 */

type Entry<T> = {
  value: T;
  expiresAt: number;
  insertedAt: number;
};

type Stats = {
  hits: number;
  misses: number;
  evictions: number;
  invalidations: number;
};

const MAX_ENTRIES = 5000;
const LOG_EVERY = 200;

class DashboardCache {
  private store = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  /**
   * Per-tenant generation counter. Bumped on every invalidation. Inflight
   * computes capture the generation at start time and only commit to the cache
   * if the generation hasn't moved — preventing stale writes when a mutation
   * lands while a compute is running.
   */
  private generations = new Map<string, number>();
  private stats: Stats = { hits: 0, misses: 0, evictions: 0, invalidations: 0 };
  private accessCounter = 0;

  private buildKey(tenantId: string, key: string): string {
    return `t:${tenantId}::${key}`;
  }

  private getGeneration(tenantId: string): number {
    return this.generations.get(tenantId) ?? 0;
  }

  private bumpGeneration(tenantId: string): void {
    this.generations.set(tenantId, this.getGeneration(tenantId) + 1);
  }

  /**
   * Get an entry or compute + store it. Promise de-duplication ensures concurrent
   * misses for the same key only trigger one computation.
   */
  async getOrCompute<T>(
    tenantId: string,
    key: string,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const fullKey = this.buildKey(tenantId, key);
    const now = Date.now();
    const existing = this.store.get(fullKey) as Entry<T> | undefined;
    if (existing && existing.expiresAt > now) {
      this.stats.hits++;
      this.maybeLog(key, true);
      return existing.value;
    }

    const inflight = this.inflight.get(fullKey) as Promise<T> | undefined;
    if (inflight) {
      this.stats.hits++;
      this.maybeLog(key, true);
      return inflight;
    }

    this.stats.misses++;
    this.maybeLog(key, false);

    const startGen = this.getGeneration(tenantId);
    const promise = (async () => {
      try {
        const value = await compute();
        // Only commit if the tenant generation hasn't been bumped meanwhile,
        // i.e. no invalidation occurred during the compute window.
        if (this.getGeneration(tenantId) === startGen) {
          this.setEntry(tenantId, key, ttlMs, value);
        }
        return value;
      } finally {
        this.inflight.delete(fullKey);
      }
    })();
    this.inflight.set(fullKey, promise);
    return promise;
  }

  private setEntry<T>(tenantId: string, key: string, ttlMs: number, value: T): void {
    if (this.store.size >= MAX_ENTRIES) {
      this.evictOldest();
    }
    this.store.set(this.buildKey(tenantId, key), {
      value,
      expiresAt: Date.now() + ttlMs,
      insertedAt: Date.now(),
    });
  }

  /**
   * Invalidate all cache entries for a tenant. If keyPrefix is provided,
   * only invalidate entries whose key starts with that prefix.
   */
  invalidateTenant(tenantId: string, keyPrefix?: string): number {
    const prefix = this.buildKey(tenantId, keyPrefix ?? "");
    let removed = 0;
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        removed++;
      }
    }
    // Always bump generation, even if nothing was deleted, so an inflight
    // compute that started just before we got here cannot repopulate stale data.
    this.bumpGeneration(tenantId);
    if (removed > 0) {
      this.stats.invalidations += removed;
    }
    return removed;
  }

  /**
   * Best-effort tenant invalidation when only a related entity id is known.
   * Caller passes a lookup function that returns tenantId given the id; if it
   * resolves, invalidation runs. Errors are swallowed (cache is best-effort).
   */
  async invalidateForLookup(
    keyPrefix: string,
    lookup: () => Promise<string | null | undefined>,
  ): Promise<void> {
    try {
      const tenantId = await lookup();
      if (tenantId) this.invalidateTenant(tenantId, keyPrefix);
    } catch {
      // Cache invalidation failures must never break the calling mutation.
    }
  }

  getStats(): Stats & { entries: number; inflight: number } {
    return {
      ...this.stats,
      entries: this.store.size,
      inflight: this.inflight.size,
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, entry] of this.store.entries()) {
      if (entry.insertedAt < oldestTs) {
        oldestTs = entry.insertedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      this.store.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  private maybeLog(key: string, hit: boolean): void {
    this.accessCounter++;
    if (this.accessCounter % LOG_EVERY !== 0) return;
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
    console.log(
      `[dashboardCache] ${hit ? "HIT" : "MISS"} key=${key} hits=${this.stats.hits} misses=${this.stats.misses} hitRate=${hitRate}% entries=${this.store.size}`,
    );
  }
}

export const dashboardCache = new DashboardCache();

/**
 * Helper: invalidate every cache prefix that depends on work_order or assignment data
 * for the given tenant. Used by storage mutations.
 */
export function invalidateWorkflowCaches(tenantId: string): void {
  dashboardCache.invalidateTenant(tenantId, "kpi:");
  dashboardCache.invalidateTenant(tenantId, "sla:");
  dashboardCache.invalidateTenant(tenantId, "capacity:");
}

export const DASHBOARD_CACHE_TTL = {
  CAPACITY_FORECAST_MS: 5 * 60 * 1000,
  SLA_SUMMARY_MS: 2 * 60 * 1000,
  SLA_CLUSTERS_MS: 2 * 60 * 1000,
  KPI_TODAY_MS: 60 * 1000,
  KPI_HISTORICAL_MS: 24 * 60 * 60 * 1000,
} as const;
