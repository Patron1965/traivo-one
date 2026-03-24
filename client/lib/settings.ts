import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SETTINGS_KEY = 'driver_core_settings';

export type MapApp = 'google' | 'apple' | 'waze';

export interface AppSettings {
  gpsTracking: boolean;
  notifications: boolean;
  hapticFeedback: boolean;
  offlineMode: boolean;
  darkMode: boolean;
  mapApp: MapApp;
}

export const DEFAULT_SETTINGS: AppSettings = {
  gpsTracking: true,
  notifications: true,
  hapticFeedback: true,
  offlineMode: false,
  darkMode: false,
  mapApp: 'google',
};

let globalSettings: AppSettings = { ...DEFAULT_SETTINGS };
let globalLoaded = false;
type Listener = (s: AppSettings) => void;
let listeners: Listener[] = [];

function notify() {
  const snapshot = { ...globalSettings };
  listeners.forEach(fn => fn(snapshot));
}

export async function loadGlobalSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      globalSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  globalLoaded = true;
  notify();
  return globalSettings;
}

export async function saveGlobalSettings(updated: AppSettings): Promise<void> {
  globalSettings = updated;
  notify();
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch {}
}

export function getSettings(): AppSettings {
  return globalSettings;
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(globalSettings);

  useEffect(() => {
    const listener: Listener = (s) => setSettings(s);
    listeners.push(listener);

    if (!globalLoaded) {
      loadGlobalSettings();
    } else {
      setSettings(globalSettings);
    }

    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }, []);

  const updateSetting = useCallback(async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...globalSettings, [key]: value };
    await saveGlobalSettings(updated);
  }, []);

  return { settings, updateSetting };
}
