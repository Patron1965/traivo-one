import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Dev/web-only helper that throws a render-time error when the configured
 * DOM event is dispatched on `window`. Used by automated UI tests to verify
 * that ErrorBoundary / ScreenErrorBoundary fallbacks react to live brand
 * colour changes (task #26 / follow-up #27).
 *
 * No-op in production bundles (`__DEV__` is false) and on native (where
 * `window` does not exist) — so it cannot be triggered by end users.
 */
export function TestCrashTrigger({ eventName }: { eventName: string }) {
  const [shouldCrash, setShouldCrash] = useState(false);

  useEffect(() => {
    if (!__DEV__) return;
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const handler = () => setShouldCrash(true);
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }, [eventName]);

  if (!__DEV__) return null;
  if (Platform.OS !== 'web') return null;
  if (shouldCrash) {
    throw new Error(`TestCrashTrigger:${eventName}`);
  }
  return null;
}
