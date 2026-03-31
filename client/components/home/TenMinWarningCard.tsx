import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Card } from '../Card';
import { Colors } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';
import type { Order } from '../../types';

interface TenMinWarning {
  order: Order;
  minutesLeft: number;
}

interface TenMinWarningCardProps {
  tenMinWarning: TenMinWarning | null;
  tenMinWarningDismissed: boolean;
  setTenMinWarningDismissed: (v: boolean) => void;
}

export function TenMinWarningCard({ tenMinWarning, tenMinWarningDismissed, setTenMinWarningDismissed }: TenMinWarningCardProps) {
  if (!tenMinWarning || tenMinWarningDismissed) return null;

  return (
    <Card style={styles.tenMinWarning}>
      <View style={styles.tenMinContent}>
        <View style={styles.tenMinLeft}>
          <View style={styles.tenMinIconCircle}>
            <Feather name="clock" size={18} color={Colors.warning} />
          </View>
          <View>
            <ThemedText variant="label" color={Colors.warning}>
              {tenMinWarning.minutesLeft} min till nästa jobb
            </ThemedText>
            <ThemedText variant="caption" color={Colors.textSecondary}>
              {tenMinWarning.order.customerName}
            </ThemedText>
          </View>
        </View>
        <Pressable onPress={() => setTenMinWarningDismissed(true)} hitSlop={8}>
          <Feather name="x" size={16} color={Colors.textMuted} />
        </Pressable>
      </View>
    </Card>
  );
}
