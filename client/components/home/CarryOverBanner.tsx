import React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';
import { Card } from '../Card';
import { Colors, Spacing } from '../../constants/theme';
import styles from '../../screens/HomeScreen.styles';
import type { UseMutationResult } from '@tanstack/react-query';

interface CarryOverBannerProps {
  carryOverOrders: { id: string | number }[];
  carryOverDismissed: boolean;
  setCarryOverDismissed: (v: boolean) => void;
  carryOverMutation: UseMutationResult<unknown, unknown, void, unknown>;
  carryOverError: string | null;
}

export function CarryOverBanner({ carryOverOrders, carryOverDismissed, setCarryOverDismissed, carryOverMutation, carryOverError }: CarryOverBannerProps) {
  if (carryOverOrders.length === 0 || carryOverDismissed) return null;

  return (
    <Card style={styles.carryOverBanner}>
      <View style={styles.carryOverContent}>
        <View style={styles.carryOverLeft}>
          <View style={[styles.tenMinIconCircle, { backgroundColor: Colors.danger + '20' }]}>
            <Feather name="rotate-cw" size={18} color={Colors.danger} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText variant="label" color={Colors.danger}>
              {carryOverOrders.length} ej slutf{'\u00f6'}rda fr{'\u00e5'}n ig{'\u00e5'}r
            </ThemedText>
            <ThemedText variant="caption" color={Colors.textSecondary}>
              Flytta till dagens lista?
            </ThemedText>
          </View>
        </View>
        <View style={styles.carryOverActions}>
          <Pressable
            style={styles.carryOverBtn}
            onPress={() => carryOverMutation.mutate()}
            disabled={carryOverMutation.isPending}
            testID="button-carry-over"
          >
            {carryOverMutation.isPending ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <ThemedText variant="caption" color={Colors.textInverse}>Flytta</ThemedText>
            )}
          </Pressable>
          <Pressable onPress={() => setCarryOverDismissed(true)} hitSlop={8}>
            <Feather name="x" size={16} color={Colors.textMuted} />
          </Pressable>
        </View>
      </View>
      {carryOverError ? (
        <ThemedText variant="caption" color={Colors.danger} style={{ marginTop: Spacing.xs }}>
          {carryOverError}
        </ThemedText>
      ) : null}
    </Card>
  );
}
