import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Colors } from '../../constants/theme';
import { createHomeStyles } from '../../screens/HomeScreen.styles';
import { useThemedStyles } from '../../context/BrandingContext';

interface StatisticsButtonProps {
  onPress: () => void;
}

export function StatisticsButton({ onPress }: StatisticsButtonProps) {
  const styles = useThemedStyles(createHomeStyles);
  return (
    <Pressable
      style={styles.statisticsButton}
      onPress={onPress}
      testID="button-statistics"
    >
      <View style={styles.statisticsLeft}>
        <View style={styles.statisticsIconCircle}>
          <Feather name="bar-chart-2" size={20} color={Colors.primary} />
        </View>
        <View>
          <ThemedText variant="subheading">Statistik</ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>
            Se statistik
          </ThemedText>
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={Colors.textMuted} />
    </Pressable>
  );
}
