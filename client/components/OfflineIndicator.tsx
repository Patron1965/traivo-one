import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from './ThemedText';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useOfflinePendingCount } from '../hooks/useOfflineSync';
import { useThemeColors } from '../context/BrandingContext';

type SyncState = 'online' | 'syncing' | 'offline';

export function OfflineIndicator() {
  useThemeColors();
  const [isOffline, setIsOffline] = useState(false);
  const pendingCount = useOfflinePendingCount();

  useEffect(() => {
    if (Platform.OS === 'web') {
      function handleOnline() { setIsOffline(false); }
      function handleOffline() { setIsOffline(true); }
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      setIsOffline(!navigator.onLine);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
    let mounted = true;
    async function checkNetwork() {
      try {
        const NetInfo = await import('@react-native-community/netinfo');
        const unsubscribe = NetInfo.default.addEventListener((state: any) => {
          if (mounted) {
            setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
          }
        });
        return () => { mounted = false; unsubscribe(); };
      } catch {
        return () => { mounted = false; };
      }
    }
    const cleanup = checkNetwork();
    return () => { mounted = false; cleanup.then((fn: any) => fn()); };
  }, []);

  const syncState: SyncState = isOffline ? 'offline' : pendingCount > 0 ? 'syncing' : 'online';

  if (syncState === 'online') return null;

  const config = {
    offline: {
      bg: Colors.danger,
      icon: 'wifi-off' as const,
      text: pendingCount > 0 ? `Offline - ${pendingCount} väntande` : 'Offline - data sparas lokalt',
    },
    syncing: {
      bg: Colors.warning,
      icon: 'refresh-cw' as const,
      text: `${pendingCount} väntande synkas...`,
    },
    online: {
      bg: Colors.accent,
      icon: 'check-circle' as const,
      text: 'Synkad',
    },
  }[syncState];

  return (
    <View style={[styles.container, { backgroundColor: config.bg }]}>
      <Feather name={config.icon} size={14} color={Colors.textInverse} />
      <ThemedText variant="caption" color={Colors.textInverse} style={styles.text}>
        {config.text}
      </ThemedText>
    </View>
  );
}

export function SyncStatusDot() {
  useThemeColors();
  const [isOffline, setIsOffline] = useState(false);
  const pendingCount = useOfflinePendingCount();

  useEffect(() => {
    if (Platform.OS === 'web') {
      function handleOnline() { setIsOffline(false); }
      function handleOffline() { setIsOffline(true); }
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      setIsOffline(!navigator.onLine);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
    let mounted = true;
    async function checkNetwork() {
      try {
        const NetInfo = await import('@react-native-community/netinfo');
        const unsubscribe = NetInfo.default.addEventListener((state: any) => {
          if (mounted) {
            setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
          }
        });
        return () => { mounted = false; unsubscribe(); };
      } catch {
        return () => { mounted = false; };
      }
    }
    const cleanup = checkNetwork();
    return () => { mounted = false; cleanup.then((fn: any) => fn()); };
  }, []);

  const color = isOffline ? Colors.danger : pendingCount > 0 ? Colors.warning : Colors.accent;
  const label = isOffline ? 'Offline' : pendingCount > 0 ? `${pendingCount} väntande` : 'Synkad';

  return (
    <View style={styles.dotContainer}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText variant="caption" color={Colors.textSecondary}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  text: {
    fontSize: FontSize.xs,
  },
  dotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
