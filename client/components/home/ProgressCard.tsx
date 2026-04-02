import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { Card } from '../Card';
import { Colors } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';
import type { DaySummary } from '../../types';

interface ProgressCardProps {
  completedCount: number;
  totalCount: number;
  progress: number;
  summary: DaySummary | undefined;
  lockedCount: number;
}

export function ProgressCard({ completedCount, totalCount, progress, summary, lockedCount }: ProgressCardProps) {
  return (
    <Card style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <ThemedText variant="subheading">Dagens framsteg</ThemedText>
        <ThemedText variant="body" color={Colors.textSecondary}>
          {completedCount}/{totalCount} uppdrag
        </ThemedText>
      </View>
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <ThemedText variant="heading" color={Colors.primary}>
            {(summary?.totalDuration || summary?.estimatedTimeRemaining || 0) > 0
              ? (summary?.totalDuration || summary?.estimatedTimeRemaining || 0)
              : '–'}
          </ThemedText>
          <ThemedText variant="caption">min totalt</ThemedText>
        </View>
        {summary?.totalDistance ? (
          <>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText variant="heading" color={Colors.primary}>
                {summary.totalDistance.toFixed(1)}
              </ThemedText>
              <ThemedText variant="caption">km totalt</ThemedText>
            </View>
          </>
        ) : null}
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <ThemedText variant="heading" color={Colors.danger}>
            {summary?.remainingOrders || 0}
          </ThemedText>
          <ThemedText variant="caption">återstående</ThemedText>
        </View>
        {lockedCount > 0 ? (
          <>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <ThemedText variant="heading" color={Colors.warning}>
                {lockedCount}
              </ThemedText>
              <ThemedText variant="caption">låsta</ThemedText>
            </View>
          </>
        ) : null}
      </View>
    </Card>
  );
}
