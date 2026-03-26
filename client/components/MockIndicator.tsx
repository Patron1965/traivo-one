import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from './ThemedText';
import { Colors, Spacing, FontSize } from '../constants/theme';
import { getApiUrl } from '../lib/query-client';

export function MockIndicator() {
  const [isMock, setIsMock] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function checkMode() {
      try {
        const url = new URL('/api/mobile/server-mode', getApiUrl()).toString();
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (mounted && data.mode === 'mock') {
            setIsMock(true);
          }
        }
      } catch {}
    }
    checkMode();
    return () => { mounted = false; };
  }, []);

  if (!isMock || dismissed) return null;

  return (
    <View style={styles.container}>
      <Feather name="alert-triangle" size={14} color="#7A5C00" />
      <ThemedText variant="caption" style={styles.text}>
        Testläge — Visar testdata
      </ThemedText>
      <Pressable onPress={() => setDismissed(true)} hitSlop={8} testID="dismiss-mock-banner">
        <Feather name="x" size={14} color="#7A5C00" />
      </Pressable>
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
    backgroundColor: '#FFF3CD',
  },
  text: {
    fontSize: FontSize.xs,
    color: '#7A5C00',
    flex: 1,
  },
});
