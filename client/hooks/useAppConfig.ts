import { useState, useEffect } from 'react';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CONFIG_CACHE_KEY = '@app_config';
const APP_VERSION = '2.0.0';

interface AppConfig {
  features: {
    hamburgerMenu: boolean;
    aiAssistant: boolean;
    teamFeature: boolean;
    offlineMode: boolean;
    darkMode: boolean;
    haptics: boolean;
  };
  navigation?: any;
}

export function useAppConfig() {
  const { token } = useAuth();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, [token]);

  async function loadConfig() {
    try {
      const cached = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
      if (cached) setConfig(JSON.parse(cached));

      const data = await apiRequest('GET', '/api/mobile/app/config', undefined, token);
      if (data.success) {
        setConfig(data.config);
        await AsyncStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(data.config));
      }
    } catch (e) {
      console.log('Failed to load app config:', e);
    } finally {
      setIsLoading(false);
    }
  }

  function isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
    return config?.features?.[feature] ?? true;
  }

  return { config, isLoading, isFeatureEnabled, appVersion: APP_VERSION };
}
