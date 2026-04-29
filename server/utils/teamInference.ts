import { db } from "../db";
import { teamMembers, teams } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

type TenantCacheEntry = {
  resourceTeamsMap: Map<string, string[]>;
  teamClusterMap: Map<string, string | null>;
  expiresAt: number;
};

const TTL_MS = 30_000;
const cache = new Map<string, TenantCacheEntry>();

async function loadCache(tenantId: string): Promise<TenantCacheEntry> {
  const allTeams = await db
    .select({ id: teams.id, clusterId: teams.clusterId })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)));
  const teamClusterMap = new Map<string, string | null>();
  for (const t of allTeams) teamClusterMap.set(t.id, t.clusterId ?? null);

  const memberRows = await db
    .select({ resourceId: teamMembers.resourceId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)));

  const resourceTeamsMap = new Map<string, string[]>();
  for (const tm of memberRows) {
    const arr = resourceTeamsMap.get(tm.resourceId);
    if (arr) {
      if (!arr.includes(tm.teamId)) arr.push(tm.teamId);
    } else {
      resourceTeamsMap.set(tm.resourceId, [tm.teamId]);
    }
  }
  return { resourceTeamsMap, teamClusterMap, expiresAt: Date.now() + TTL_MS };
}

async function getCache(tenantId: string): Promise<TenantCacheEntry> {
  const entry = cache.get(tenantId);
  if (entry && entry.expiresAt > Date.now()) return entry;
  const fresh = await loadCache(tenantId);
  cache.set(tenantId, fresh);
  return fresh;
}

export async function inferTeamIdForResource(
  tenantId: string,
  resourceId: string,
  clusterId?: string | null,
): Promise<string | null> {
  if (!tenantId || !resourceId) return null;
  const { resourceTeamsMap, teamClusterMap } = await getCache(tenantId);
  const teamIds = resourceTeamsMap.get(resourceId);
  if (!teamIds || teamIds.length === 0) return null;
  if (clusterId) {
    const matching = teamIds.find((tid) => teamClusterMap.get(tid) === clusterId);
    if (matching) return matching;
  }
  return teamIds[0];
}

export function buildResourceTeamsMap(
  resourceTeams: Map<string, string[]>,
  teamClusters: Map<string, string | null>,
) {
  return (resourceId: string, clusterId?: string | null): string | null => {
    const teamIds = resourceTeams.get(resourceId);
    if (!teamIds || teamIds.length === 0) return null;
    if (clusterId) {
      const matching = teamIds.find((tid) => teamClusters.get(tid) === clusterId);
      if (matching) return matching;
    }
    return teamIds[0];
  };
}

export function invalidateTeamInferenceCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export function _resetTeamInferenceCacheForTests(): void {
  cache.clear();
}
