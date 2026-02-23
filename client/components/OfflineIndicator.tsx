import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from './ThemedText';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';
import { useOfflinePendingCount } from '../hooks/useOfflineSync';

export function OfflineIndicator() {
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

  if (!isOffline && pendingCount === 0) return null;

  return (
    <View style={[styles.container, isOffline ? styles.offline : styles.syncing]}>
      <Feather
        name={isOffline ? 'wifi-off' : 'refresh-cw'}
        size={14}
        color={Colors.textInverse}
      />
      <ThemedText variant="caption" color={Colors.textInverse} style={styles.text}>
        {isOffline
          ? `Offline${pendingCount > 0 ? ` - ${pendingCount} väntande` : ' - data sparas lokalt'}`
          : `${pendingCount} väntande synkas...`}
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
  offline: {
    backgroundColor: Colors.danger,
  },
  syncing: {
    backgroundColor: Colors.warning,
  },
  text: {
    fontSize: FontSize.xs,
  },
});
