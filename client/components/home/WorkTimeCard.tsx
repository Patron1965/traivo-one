import React from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Card } from '../Card';
import { Colors } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';

interface TimeSummary {
  totalSeconds: number;
  travelSeconds: number;
  onSiteSeconds: number;
  workingSeconds: number;
  entries: number;
}

interface WorkTimeCardProps {
  timeSummary: TimeSummary | undefined;
  formatWorkTime: (seconds: number) => string;
}

export function WorkTimeCard({ timeSummary, formatWorkTime }: WorkTimeCardProps) {
  if (!timeSummary || timeSummary.totalSeconds <= 0) return null;

  return (
    <Card style={styles.workTimeCard}>
      <View style={styles.workTimeHeader}>
        <Feather name="clock" size={16} color={Colors.primary} />
        <ThemedText variant="subheading">Arbetstid idag</ThemedText>
        <ThemedText variant="heading" color={Colors.primary} style={styles.workTimeTotal} testID="text-work-time-total">
          {formatWorkTime(timeSummary.totalSeconds)}
        </ThemedText>
      </View>
      <View style={styles.workTimeBreakdown}>
        {timeSummary.travelSeconds > 0 ? (
          <View style={styles.workTimeItem}>
            <View style={[styles.workTimeDot, { backgroundColor: Colors.info }]} />
            <ThemedText variant="caption" color={Colors.textSecondary}>K\u00f6rning</ThemedText>
            <ThemedText variant="body" color={Colors.info}>{formatWorkTime(timeSummary.travelSeconds)}</ThemedText>
          </View>
        ) : null}
        {timeSummary.onSiteSeconds > 0 ? (
          <View style={styles.workTimeItem}>
            <View style={[styles.workTimeDot, { backgroundColor: Colors.primaryLight }]} />
            <ThemedText variant="caption" color={Colors.textSecondary}>P\u00e5 plats</ThemedText>
            <ThemedText variant="body" color={Colors.primaryLight}>{formatWorkTime(timeSummary.onSiteSeconds)}</ThemedText>
          </View>
        ) : null}
        {timeSummary.workingSeconds > 0 ? (
          <View style={styles.workTimeItem}>
            <View style={[styles.workTimeDot, { backgroundColor: Colors.secondary }]} />
            <ThemedText variant="caption" color={Colors.textSecondary}>Arbete</ThemedText>
            <ThemedText variant="body" color={Colors.secondary}>{formatWorkTime(timeSummary.workingSeconds)}</ThemedText>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
