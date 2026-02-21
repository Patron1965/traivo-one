// @ts-ignore - netinfo types are loaded dynamically
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from './ThemedText';
import { Colors, Spacing, BorderRadius, FontSize } from '../constants/theme';

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(false);

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

  if (!isOffline) return null;

  return (
    <View style={styles.container}>
      <Feather name="wifi-off" size={14} color={Colors.textInverse} />
      <ThemedText variant="caption" color={Colors.textInverse} style={styles.text}>
        Offline - data sparas lokalt
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
    backgroundColor: Colors.danger,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  text: {
    fontSize: FontSize.xs,
  },
});
