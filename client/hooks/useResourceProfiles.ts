import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import type { ResourceProfile, ResourceProfileAssignment } from '../types';

const PROFILES_KEY = '@resource_profiles';

export function useResourceProfiles() {
  const { token } = useAuth();
  const [assignments, setAssignments] = useState<ResourceProfileAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadCached = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(PROFILES_KEY);
      if (raw) {
        setAssignments(JSON.parse(raw));
      }
    } catch {}
  }, []);

  const fetchProfiles = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiRequest('GET', '/api/mobile/my-profiles', undefined, token);
      if (data.success && Array.isArray(data.assignments)) {
        setAssignments(data.assignments);
        await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(data.assignments));
      }
    } catch {
      // offline — keep cached data
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    (async () => {
      await loadCached();
      await fetchProfiles();
    })();
  }, [loadCached, fetchProfiles]);

  const profiles: ResourceProfile[] = assignments.map(a => a.profile);
  const primaryAssignment = assignments.find(a => a.isPrimary) || assignments[0] || null;
  const primaryProfile: ResourceProfile | null = primaryAssignment ? primaryAssignment.profile : null;

  return { assignments, profiles, primaryProfile, isLoading, refetch: fetchProfiles };
}
