import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import type { Resource, GpsPosition } from '../types';
import { FIELD_APP_ALLOWED_ROLES } from '../types';

const PROFILES_CACHE_KEY = '@resource_profiles';
const LAST_ACTIVITY_KEY = '@last_activity_timestamp';
const AUTO_LOGOUT_MS = 24 * 60 * 60 * 1000;

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
  login: (username: string, password: string, pin?: string, email?: string) => Promise<void>;
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
  const activityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const recordActivity = useCallback(async () => {
    await AsyncStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  }, []);

  const checkInactivityLogout = useCallback(async () => {
    if (!token || !user) return;
    try {
      const stored = await AsyncStorage.getItem(LAST_ACTIVITY_KEY);
      if (stored) {
        const elapsed = Date.now() - Number(stored);
        if (elapsed >= AUTO_LOGOUT_MS) {
          console.log('Auto-logout: 24h inactivity exceeded');
          await logout();
        }
      }
    } catch {}
  }, [token, user]);

  useEffect(() => {
    loadStoredAuth();
  }, []);

  useEffect(() => {
    if (!token) return;
    recordActivity();
    activityTimerRef.current = setInterval(() => {
      checkInactivityLogout();
    }, 5 * 60 * 1000);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkInactivityLogout();
        recordActivity();
      }
    });

    return () => {
      if (activityTimerRef.current) clearInterval(activityTimerRef.current);
      subscription.remove();
    };
  }, [token, checkInactivityLogout, recordActivity]);

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
        const storedResource = parsed.resource || parsed.user;
        setUser(storedResource);
        setToken(storedToken);
        try {
          const meData = await apiRequest('GET', '/api/mobile/me', undefined, storedToken);
          const freshResource = meData.resource || storedResource;
          if (meData.success && meData.resource) {
            setUser(meData.resource);
          } else if (meData.resource) {
            setUser(meData.resource);
          }
          if (isRoleAllowed(freshResource?.role)) {
            fetchAndCacheProfiles(storedToken);
          }
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

  function isRoleAllowed(role?: string): boolean {
    if (!role) return true;
    const normalized = role.toLowerCase().trim();
    return (FIELD_APP_ALLOWED_ROLES as readonly string[]).includes(normalized);
  }

  async function login(username: string, password: string, pin?: string, email?: string) {
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
    const body: any = email && pin ? { email, pin } : pin ? { pin } : { username, password };
    const data = await apiRequest('POST', '/api/mobile/login', body);
    const resource = data.resource || data.user;
    if (resource?.role && !isRoleAllowed(resource.role)) {
      setUser(resource);
      setToken(data.token);
      await AsyncStorage.setItem('auth', JSON.stringify({ resource, token: data.token }));
      return;
    }
    setUser(resource);
    setToken(data.token);
    await AsyncStorage.setItem('auth', JSON.stringify({ resource, token: data.token }));
    await AsyncStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
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
