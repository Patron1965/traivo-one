import React from 'react';
import { View, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { SyncStatusDot } from '../OfflineIndicator';
import { Colors } from '../../constants/theme';
import { createHomeStyles } from '../../screens/HomeScreen.styles';
import { useThemedStyles } from '../../context/BrandingContext';

interface SyncStatusRowProps {
  pendingCount: number;
  syncBadgeOpacity: Animated.Value;
}

export function SyncStatusRow({ pendingCount, syncBadgeOpacity }: SyncStatusRowProps) {
  const styles = useThemedStyles(createHomeStyles);
  return (
    <View style={styles.syncStatusRow}>
      <SyncStatusDot />
      {pendingCount > 0 ? (
        <Animated.View style={[styles.syncBadge, { opacity: syncBadgeOpacity }]}>
          <Feather name="upload-cloud" size={14} color={Colors.warning} />
          <ThemedText variant="caption" color={Colors.warning} style={styles.syncBadgeText}>
            {pendingCount} väntande {pendingCount === 1 ? 'åtgärd' : 'åtgärder'}
          </ThemedText>
        </Animated.View>
      ) : null}
    </View>
  );
}
