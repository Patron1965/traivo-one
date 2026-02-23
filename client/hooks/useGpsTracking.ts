import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../lib/query-client';
import type { GpsPosition } from '../types';

const GPS_INTERVAL = 30000;
const GPS_ENABLED_KEY = '@gps_tracking_enabled';

type TrackingStatus = 'idle' | 'traveling' | 'on_site' | 'offline';

export function useGpsTracking() {
  const [isTracking, setIsTracking] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<GpsPosition | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle');
  const [permissionGranted, setPermissionGranted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(GPS_ENABLED_KEY);
      if (stored === 'true') {
        startTracking();
      }
    })();

    return () => {
      stopTracking();
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === 'web') {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        if (result.state === 'granted' || result.state === 'prompt') {
          setPermissionGranted(true);
          return true;
        }
        return false;
      } catch {
        setPermissionGranted(true);
        return true;
      }
    }

    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      setPermissionGranted(granted);
      return granted;
    } catch {
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(async (): Promise<GpsPosition | null> => {
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
            setCurrentPosition(gps);
            resolve(gps);
          },
          () => resolve(null),
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
      setCurrentPosition(gps);
      return gps;
    } catch {
      return null;
    }
  }, []);

  const sendPosition = useCallback(async (position: GpsPosition) => {
    try {
      await apiRequest('POST', '/api/mobile/position', {
        latitude: position.latitude,
        longitude: position.longitude,
        speed: position.speed,
        heading: position.heading,
        accuracy: position.accuracy,
      });
    } catch {}
  }, []);

  const startTracking = useCallback(async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) return;

    setIsTracking(true);
    setTrackingStatus('traveling');
    await AsyncStorage.setItem(GPS_ENABLED_KEY, 'true');

    const pos = await getCurrentPosition();
    if (pos) sendPosition(pos);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      const p = await getCurrentPosition();
      if (p) sendPosition(p);
    }, GPS_INTERVAL);
  }, [requestPermission, getCurrentPosition, sendPosition]);

  const stopTracking = useCallback(async () => {
    setIsTracking(false);
    setTrackingStatus('idle');
    await AsyncStorage.setItem(GPS_ENABLED_KEY, 'false');

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (watchRef.current) {
      watchRef.current = null;
    }
  }, []);

  const updateTrackingStatus = useCallback((status: TrackingStatus) => {
    setTrackingStatus(status);
  }, []);

  return {
    isTracking,
    currentPosition,
    trackingStatus,
    permissionGranted,
    startTracking,
    stopTracking,
    requestPermission,
    getCurrentPosition,
    updateTrackingStatus,
  };
}
