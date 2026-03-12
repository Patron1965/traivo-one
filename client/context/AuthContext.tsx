import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import type { Resource, GpsPosition } from '../types';

const PROFILES_CACHE_KEY = '@resource_profiles';

async function fetchAndCacheProfiles(authToken: string): Promise<void> {
  try {
    const data = await apiRequest('GET', '/api/mobile/my-profiles', undefined, authToken);
    if (data.success && Array.isArray(data.assignments)) {
      await AsyncStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(data.assignments));
    }
  } catch {
  }
}

async function registerPushToken(authToken: string): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const expoPushToken = tokenData.data;

    await apiRequest('POST', '/api/mobile/push-token', {
      expoPushToken,
      platform: Platform.OS,
    }, authToken);
  } catch (e) {
    console.log('Push token registration skipped (expected in Expo Go):', e);
  }
}

async function unregisterPushToken(authToken: string | null): Promise<void> {
  try {
    await apiRequest('DELETE', '/api/mobile/push-token', {}, authToken);
  } catch (e) {
    console.log('Push token unregistration failed:', e);
  }
}

interface StartPosition {
  latitude: number;
  longitude: number;
  date: string;
}

interface AuthContextType {
  user: Resource | null;
  token: string | null;
  isLoading: boolean;
  isOnline: boolean;
  startPosition: StartPosition | null;
  setIsOnline: (online: boolean) => void;
  login: (username: string, password: string, pin?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  isOnline: false,
  startPosition: null,
  setIsOnline: () => {},
  login: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const ONLINE_STATUS_KEY = '@driver_online_status';
const START_POSITION_KEY = '@driver_start_position';

function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function captureCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  try {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Resource | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnlineState] = useState(false);
  const [startPosition, setStartPosition] = useState<StartPosition | null>(null);
  const initialLoadCompleteRef = useRef(false);

  const setIsOnline = async (online: boolean) => {
    const previousOnline = isOnline;
    if (token) {
      try {
        await apiRequest('POST', '/api/mobile/status', { online }, token);
        setIsOnlineState(online);
        await AsyncStorage.setItem(ONLINE_STATUS_KEY, JSON.stringify(online));

        if (online) {
          const today = getTodayDateString();
          const needsCapture = !startPosition || startPosition.date !== today;
          if (needsCapture) {
            const pos = await captureCurrentPosition();
            if (pos) {
              const sp: StartPosition = { latitude: pos.latitude, longitude: pos.longitude, date: today };
              setStartPosition(sp);
              await AsyncStorage.setItem(START_POSITION_KEY, JSON.stringify(sp));
            }
          }
        }
      } catch (err) {
        console.error('Failed to update online status on server:', err);
        setIsOnlineState(previousOnline);
      }
    } else {
      setIsOnlineState(online);
      await AsyncStorage.setItem(ONLINE_STATUS_KEY, JSON.stringify(online));
    }
  };

  useEffect(() => {
    loadStoredAuth();
  }, []);

  async function loadStoredAuth() {
    try {
      const onlineStored = await AsyncStorage.getItem(ONLINE_STATUS_KEY);
      if (onlineStored !== null) {
        setIsOnlineState(JSON.parse(onlineStored));
      }

      const spStored = await AsyncStorage.getItem(START_POSITION_KEY);
      if (spStored) {
        const parsed: StartPosition = JSON.parse(spStored);
        if (parsed.date === getTodayDateString()) {
          setStartPosition(parsed);
        } else {
          await AsyncStorage.removeItem(START_POSITION_KEY);
        }
      }

      const stored = await AsyncStorage.getItem('auth');
      if (stored) {
        const parsed = JSON.parse(stored);
        const storedToken = parsed.token;
        setUser(parsed.resource || parsed.user);
        setToken(storedToken);
        try {
          const meData = await apiRequest('GET', '/api/mobile/me', undefined, storedToken);
          if (meData.success && meData.resource) {
            setUser(meData.resource);
          } else if (meData.resource) {
            setUser(meData.resource);
          }
          fetchAndCacheProfiles(storedToken);
        } catch {
          setUser(null);
          setToken(null);
          await AsyncStorage.removeItem('auth');
        }
      }
    } catch (e) {
      console.error('Failed to load auth:', e);
    } finally {
      initialLoadCompleteRef.current = true;
      setIsLoading(false);
    }
  }

  async function login(username: string, password: string, pin?: string) {
    if (!initialLoadCompleteRef.current) {
      console.warn('Login called before initial auth load completed, waiting...');
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (initialLoadCompleteRef.current) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    }
    const body: any = pin ? { pin } : { username, password };
    const data = await apiRequest('POST', '/api/mobile/login', body);
    const resource = data.resource || data.user;
    setUser(resource);
    setToken(data.token);
    await AsyncStorage.setItem('auth', JSON.stringify({ resource, token: data.token }));
    registerPushToken(data.token);
    fetchAndCacheProfiles(data.token);
  }

  async function logout() {
    await unregisterPushToken(token);
    try {
      await apiRequest('POST', '/api/mobile/logout', {}, token);
    } catch (err) {
      console.error('Logout API call failed:', err);
    }
    setUser(null);
    setToken(null);
    setStartPosition(null);
    await AsyncStorage.removeItem('auth');
    await AsyncStorage.removeItem(START_POSITION_KEY);
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isOnline, startPosition, setIsOnline, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
