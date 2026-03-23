import { sendGPSPosition } from '../api/sync';
import { addToQueue } from './offlineQueue';

const BACKGROUND_LOCATION_TASK = 'traivo-background-location';

let trackingActive = false;
let foregroundInterval: ReturnType<typeof setInterval> | null = null;
let gpsBatch: Array<{ latitude: number; longitude: number; accuracy: number; speed: number; timestamp: number }> = [];

try {
  const TaskManager = require('expo-task-manager');
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ({ data, error }: { data: { locations?: Array<{ coords: { latitude: number; longitude: number; accuracy: number; speed: number } }> }; error: unknown }) => {
    if (error || !data?.locations) return;
    for (const loc of data.locations) {
      gpsBatch.push({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy || 0,
        speed: loc.coords.speed || 0,
        timestamp: Date.now(),
      });
    }
    if (gpsBatch.length >= 4) {
      flushGPSBatch().catch(() => {});
    }
  });
} catch {
}

export async function startGPSTracking(): Promise<void> {
  if (trackingActive) return;
  trackingActive = true;

  try {
    const Location = require('expo-location');

    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      trackingActive = false;
      return;
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();

    if (bgStatus === 'granted') {
      const TaskManager = require('expo-task-manager');
      const isDefined = TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK);

      if (isDefined) {
        const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
        if (!isStarted) {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 30000,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'Traivo Go',
              notificationBody: 'GPS-spårning aktiv',
            },
          });
        }
      } else {
        startForegroundTracking();
      }
    } else {
      startForegroundTracking();
    }
  } catch {
    startForegroundTracking();
  }
}

function startForegroundTracking(): void {
  if (foregroundInterval) return;
  foregroundInterval = setInterval(async () => {
    try {
      const position = await getCurrentPosition();
      if (position) {
        gpsBatch.push({ ...position, timestamp: Date.now() });
        if (gpsBatch.length >= 4) {
          await flushGPSBatch();
        }
      }
    } catch {
    }
  }, 30000);
}

export async function stopGPSTracking(): Promise<void> {
  trackingActive = false;

  if (foregroundInterval) {
    clearInterval(foregroundInterval);
    foregroundInterval = null;
  }

  try {
    const Location = require('expo-location');
    const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
    if (isStarted) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch {
  }

  await flushGPSBatch().catch(() => {});
}

async function flushGPSBatch(): Promise<void> {
  if (gpsBatch.length === 0) return;

  const batch = [...gpsBatch];
  gpsBatch = [];

  for (const point of batch) {
    try {
      await sendGPSPosition({
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        speed: point.speed,
      });
    } catch {
      await addToQueue({
        type: 'gps',
        payload: {
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
          speed: point.speed,
        },
      });
    }
  }
}

async function getCurrentPosition(): Promise<{ latitude: number; longitude: number; accuracy: number; speed: number } | null> {
  try {
    const Location = require('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy || 0,
      speed: location.coords.speed || 0,
    };
  } catch {
    return null;
  }
}

export function isTracking(): boolean {
  return trackingActive;
}
