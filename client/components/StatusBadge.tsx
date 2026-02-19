import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrderStatus, ORDER_STATUS_LABELS } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';

const STATUS_COLORS: Record<OrderStatus, { bg: string; text: string }> = {
  new: { bg: Colors.infoLight, text: Colors.statusNew },
  planned: { bg: '#F4ECF7', text: Colors.statusPlanned },
  en_route: { bg: Colors.warningLight, text: Colors.statusEnRoute },
  arrived: { bg: '#FDEBD0', text: Colors.statusArrived },
  in_progress: { bg: Colors.successLight, text: Colors.statusInProgress },
  completed: { bg: Colors.successLight, text: Colors.statusCompleted },
  deferred: { bg: Colors.dangerLight, text: Colors.statusDeferred },
  cancelled: { bg: '#F2F3F4', text: Colors.statusCancelled },
};

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.bg },
        size === 'sm' ? styles.small : null,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: colors.text }]} />
      <Text
        style={[
          styles.text,
          { color: colors.text },
          size === 'sm' ? styles.smallText : null,
        ]}
      >
        {ORDER_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    gap: Spacing.xs,
  },
  small: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: FontSize.sm,
    fontFamily: 'Inter_600SemiBold',
  },
  smallText: {
    fontSize: FontSize.xs,
  },
});
