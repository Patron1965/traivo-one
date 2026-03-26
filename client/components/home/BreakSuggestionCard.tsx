import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Card } from '../Card';
import { Colors } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';

interface BreakSuggestion {
  message: string;
}

interface BreakSuggestionCardProps {
  breakSuggestion: BreakSuggestion | null;
  breakDismissed: boolean;
  setBreakDismissed: (v: boolean) => void;
}

export function BreakSuggestionCard({ breakSuggestion, breakDismissed, setBreakDismissed }: BreakSuggestionCardProps) {
  if (!breakSuggestion || breakDismissed) return null;

  return (
    <Card style={styles.breakBanner}>
      <View style={styles.breakBannerContent} testID="banner-break-suggestion">
        <View style={styles.breakIconCircle}>
          <Feather name="coffee" size={20} color={Colors.secondary} />
        </View>
        <View style={styles.breakTextContainer}>
          <ThemedText variant="label" color={Colors.secondary}>Rastf{'\u00f6'}rslag</ThemedText>
          <ThemedText variant="body" color={Colors.textSecondary} style={styles.breakMessage}>
            {breakSuggestion.message}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => setBreakDismissed(true)}
          hitSlop={8}
          testID="button-dismiss-break"
        >
          <Feather name="x" size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
    </Card>
  );
}
