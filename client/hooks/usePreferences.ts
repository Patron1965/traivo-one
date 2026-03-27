import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFS_CACHE_KEY = '@user_preferences';

export interface UserPreferences {
  menuOrder?: string[];
  favoriteScreens?: string[];
  pushEnabled?: boolean;
  pushCategories?: {
    orderAssigned?: boolean;
    scheduleChange?: boolean;
    teamUpdates?: boolean;
    deviationResponse?: boolean;
    systemMessages?: boolean;
  };
  darkMode?: boolean;
  fontSize?: 'small' | 'medium' | 'large';
  hapticFeedback?: boolean;
  mapType?: 'standard' | 'satellite' | 'hybrid';
  showTraffic?: boolean;
  autoNavigate?: boolean;
  autoStartSession?: boolean;
  breakReminders?: boolean;
  breakIntervalMinutes?: number;
}

interface UsePreferencesReturn {
  preferences: UserPreferences;
  isLoading: boolean;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => Promise<void>;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_PREFS: UserPreferences = {
  pushEnabled: true,
  darkMode: false,
  fontSize: 'medium',
  hapticFeedback: true,
  mapType: 'standard',
  showTraffic: true,
  autoNavigate: false,
  breakReminders: true,
  breakIntervalMinutes: 120,
};

export function usePreferences(): UsePreferencesReturn {
  const { token } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCachedPreferences();
    if (token) fetchPreferences();
  }, [token]);

  async function loadCachedPreferences() {
    try {
      const cached = await AsyncStorage.getItem(PREFS_CACHE_KEY);
      if (cached) {
        setPreferences({ ...DEFAULT_PREFS, ...JSON.parse(cached) });
      }
    } catch (e) {
      console.log('Failed to load cached preferences:', e);
    }
  }

  async function fetchPreferences() {
    try {
      setIsLoading(true);
      const data = await apiRequest('GET', '/api/mobile/user/preferences', undefined, token);
      if (data.success) {
        const prefs = { ...DEFAULT_PREFS, ...data.preferences };
        setPreferences(prefs);
        await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
      }
    } catch (e) {
      console.error('Failed to fetch preferences:', e);
    } finally {
      setIsLoading(false);
    }
  }

  const updatePreference = useCallback(async <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });

    try {
      await apiRequest('PATCH', '/api/mobile/user/preferences', { [key]: value }, token);
    } catch (e) {
      console.error('Failed to update preference:', e);
      await fetchPreferences();
    }
  }, [token]);

  const updatePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
    setPreferences(prev => {
      const updated = { ...prev, ...updates };
      AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });

    try {
      await apiRequest('PATCH', '/api/mobile/user/preferences', updates, token);
    } catch (e) {
      console.error('Failed to update preferences:', e);
      await fetchPreferences();
    }
  }, [token]);

  const refresh = useCallback(async () => {
    await fetchPreferences();
  }, [token]);

  return { preferences, isLoading, updatePreference, updatePreferences, refresh };
}
