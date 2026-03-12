import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import type { Team, TeamMember } from '../types';

function getTeamCacheKey(userId: string | number | undefined): string {
  return userId ? `@my_team:${userId}` : '@my_team';
}

export function useTeam() {
  const { token, user } = useAuth();
  const [team, setTeam] = useState<Team | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const cacheKey = useMemo(() => getTeamCacheKey(user?.id), [user?.id]);

  const loadCached = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        setTeam(JSON.parse(raw));
      }
    } catch {}
  }, [cacheKey]);

  const fetchTeam = useCallback(async () => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await apiRequest('GET', '/api/mobile/my-team', undefined, token);
      if (data && typeof data.success === 'boolean') {
        const teamData = data.team && data.team.id && Array.isArray(data.team.members) ? data.team : null;
        setTeam(teamData);
        if (teamData) {
          await AsyncStorage.setItem(cacheKey, JSON.stringify(teamData));
        } else {
          await AsyncStorage.removeItem(cacheKey);
        }
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [token, cacheKey]);

  useEffect(() => {
    if (!user?.id) {
      setTeam(null);
      setIsLoading(false);
      return;
    }
    (async () => {
      await loadCached();
      await fetchTeam();
    })();
  }, [user?.id, loadCached, fetchTeam]);

  const resourceId = user?.resourceId || user?.id;
  const partner: TeamMember | null = team
    ? team.members.find(m => String(m.resourceId) !== String(resourceId)) || null
    : null;

  const isLeader = team
    ? String(team.leaderId) === String(resourceId)
    : false;

  return { team, partner, isLeader, isLoading, refetch: fetchTeam };
}
