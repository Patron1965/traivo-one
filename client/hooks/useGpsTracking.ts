import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import type { GpsPosition } from '../types';

const GPS_INTERVAL = 30000;
const GPS_ENABLED_KEY = '@gps_tracking_enabled';
const MAX_SEND_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

type TrackingStatus = 'idle' | 'traveling' | 'on_site' | 'offline';
type Listener = (state: GpsState) => void;

interface GpsState {
  isTracking: boolean;
  currentPosition: GpsPosition | null;
  trackingStatus: TrackingStatus;
  permissionGranted: boolean;
}

let globalState: GpsState = {
  isTracking: false,
  currentPosition: null,
  trackingStatus: 'idle',
  permissionGranted: false,
};
let globalIntervalId: ReturnType<typeof setInterval> | null = null;
let globalListeners: Listener[] = [];
let globalActiveCount = 0;

function notifyListeners() {
  const snapshot = { ...globalState };
  for (const listener of globalListeners) {
    listener(snapshot);
  }
}

function updateGlobalState(partial: Partial<GpsState>) {
  globalState = { ...globalState, ...partial };
  notifyListeners();
}

async function requestPermissionGlobal(): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      if (result.state === 'granted' || result.state === 'prompt') {
        updateGlobalState({ permissionGranted: true });
        return true;
      }
      console.warn('[GPS] Web geolocation permission denied');
      return false;
    } catch (err) {
      console.warn('[GPS] Web permission query failed, assuming available:', err);
      updateGlobalState({ permissionGranted: true });
      return true;
    }
  }

  try {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    const granted = status === 'granted';
    updateGlobalState({ permissionGranted: granted });
    if (!granted) {
      console.warn('[GPS] Location permission not granted, status:', status);
    }
    return granted;
  } catch (err) {
    console.error('[GPS] Failed to request location permission:', err);
    return false;
  }
}

async function getCurrentPositionGlobal(): Promise<GpsPosition | null> {
  if (Platform.OS === 'web') {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const gps: GpsPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            timestamp: pos.timestamp,
          };
          updateGlobalState({ currentPosition: gps });
          resolve(gps);
        },
        (err) => {
          console.warn('[GPS] Web getCurrentPosition failed:', err.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  try {
    const Location = await import('expo-location');
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const gps: GpsPosition = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? 0,
      speed: loc.coords.speed || undefined,
      heading: loc.coords.heading || undefined,
      timestamp: loc.timestamp,
    };
    updateGlobalState({ currentPosition: gps });
    return gps;
  } catch (err) {
    console.error('[GPS] Failed to get current position:', err);
    return null;
  }
}

async function sendPositionGlobal(position: GpsPosition, retries = MAX_SEND_RETRIES) {
  try {
    await apiRequest('POST', '/api/mobile/position', {
      latitude: position.latitude,
      longitude: position.longitude,
      speed: position.speed,
      heading: position.heading,
      accuracy: position.accuracy,
    });
  } catch (err) {
    console.error('[GPS] Failed to send position:', err);
    if (retries > 0) {
      console.warn(`[GPS] Retrying position send (${retries} attempts left)...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return sendPositionGlobal(position, retries - 1);
    }
    console.error('[GPS] All retries exhausted for position send');
  }
}

async function startTrackingGlobal() {
  if (globalState.isTracking) return;

  const hasPermission = await requestPermissionGlobal();
  if (!hasPermission) {
    console.warn('[GPS] Cannot start tracking: permission not granted');
    return;
  }

  updateGlobalState({ isTracking: true, trackingStatus: 'traveling' });
  await AsyncStorage.setItem(GPS_ENABLED_KEY, 'true');

  const pos = await getCurrentPositionGlobal();
  if (pos) sendPositionGlobal(pos);

  if (globalIntervalId) clearInterval(globalIntervalId);
  globalIntervalId = setInterval(async () => {
    const p = await getCurrentPositionGlobal();
    if (p) sendPositionGlobal(p);
  }, GPS_INTERVAL);
}

async function stopTrackingGlobal() {
  updateGlobalState({ isTracking: false, trackingStatus: 'idle' });
  await AsyncStorage.setItem(GPS_ENABLED_KEY, 'false');

  if (globalIntervalId) {
    clearInterval(globalIntervalId);
    globalIntervalId = null;
  }
}

export function useGpsTracking() {
  const [state, setState] = useState<GpsState>(globalState);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const listener: Listener = (newState) => {
      if (mountedRef.current) setState(newState);
    };

    if (!globalListeners.includes(listener)) {
      globalListeners.push(listener);
    }

    globalActiveCount++;

    if (globalActiveCount === 1) {
      (async () => {
        const stored = await AsyncStorage.getItem(GPS_ENABLED_KEY);
        if (stored === 'true' && !globalState.isTracking) {
          startTrackingGlobal();
        }
      })();
    }

    return () => {
      mountedRef.current = false;
      globalListeners = globalListeners.filter((l) => l !== listener);
      globalActiveCount--;
    };
  }, []);

  const startTracking = useCallback(() => startTrackingGlobal(), []);
  const stopTracking = useCallback(() => stopTrackingGlobal(), []);
  const requestPermission = useCallback(() => requestPermissionGlobal(), []);
  const getCurrentPosition = useCallback(() => getCurrentPositionGlobal(), []);
  const updateTrackingStatus = useCallback((status: TrackingStatus) => {
    updateGlobalState({ trackingStatus: status });
  }, []);

  return {
    isTracking: state.isTracking,
    currentPosition: state.currentPosition,
    trackingStatus: state.trackingStatus,
    permissionGranted: state.permissionGranted,
    startTracking,
    stopTracking,
    requestPermission,
    getCurrentPosition,
    updateTrackingStatus,
  };
}
