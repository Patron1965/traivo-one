import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrderStatus, ORDER_STATUS_LABELS } from '../types';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  ny: { bg: '#F2F3F4', text: Colors.statusNy },
  skapad: { bg: '#F2F3F4', text: Colors.statusSkapad },
  planerad: { bg: '#F4ECF7', text: Colors.statusPlanerad },
  planerad_pre: { bg: '#F4ECF7', text: Colors.statusPlaneradPre },
  planerad_resurs: { bg: Colors.infoLight, text: Colors.statusPlaneradResurs },
  planerad_las: { bg: '#FDEBD0', text: Colors.statusPlaneradLas },
  paborjad: { bg: Colors.infoLight, text: Colors.statusPaborjad },
  utford: { bg: Colors.successLight, text: Colors.statusUtford },
  avslutad: { bg: Colors.successLight, text: Colors.statusAvslutad },
  fakturerad: { bg: '#E8F8F5', text: Colors.statusFakturerad },
  impossible: { bg: Colors.dangerLight, text: Colors.statusImpossible },

  planned: { bg: '#F4ECF7', text: Colors.statusPlanned },
  dispatched: { bg: Colors.infoLight, text: Colors.statusDispatched },
  en_route: { bg: '#FFF3E0', text: Colors.statusEnRoute },
  on_site: { bg: '#FDEBD0', text: Colors.statusOnSite },
  in_progress: { bg: Colors.successLight, text: Colors.statusInProgress },
  completed: { bg: Colors.successLight, text: Colors.statusCompleted },
  failed: { bg: Colors.dangerLight, text: Colors.statusFailed },
  cancelled: { bg: '#F2F3F4', text: Colors.statusCancelled },
  deferred: { bg: '#FFF3E0', text: '#E65100' },
};

interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const colors = STATUS_COLORS[status] || { bg: '#F2F3F4', text: '#95A5A6' };
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
        {ORDER_STATUS_LABELS[status] || status}
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
