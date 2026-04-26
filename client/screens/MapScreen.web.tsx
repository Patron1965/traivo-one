import React from 'react';
import { View, StyleSheet, Pressable, Text, ScrollView } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { useThemedStyles } from '../context/BrandingContext';
import type { Order } from '../types';

function getMarkerColor(order: Order): string {
  if (order.status === 'completed' || order.status === 'utford' || order.status === 'avslutad') return Colors.success;
  if (order.status === 'in_progress' || order.status === 'on_site' || order.status === 'paborjad') return Colors.secondary;
  if (order.status === 'dispatched' || order.status === 'en_route') return Colors.warning;
  if (order.status === 'failed') return Colors.danger;
  if (order.priority === 'urgent') return Colors.danger;
  return Colors.primary;
}

export function MapScreen({ navigation }: any) {
  const styles = useThemedStyles(createMapWebStyles);
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const activeOrders = orders?.filter(o => o.status !== 'cancelled') || [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.xl, paddingBottom: tabBarHeight + Spacing.xl },
      ]}
    >
      <View style={styles.webFallback}>
        <Feather name="map" size={48} color={Colors.textMuted} />
        <ThemedText variant="heading" style={styles.fallbackTitle}>
          Kartvy
        </ThemedText>
        <ThemedText variant="body" color={Colors.textSecondary} style={styles.fallbackText}>
          Kartan visas i Expo Go.{'\n'}Dagens rutt:
        </ThemedText>
        {activeOrders.sort((a, b) => a.sortOrder - b.sortOrder).map((order, idx) => (
          <Pressable
            key={order.id}
            style={styles.webOrderItem}
            onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
            testID={`card-map-order-${order.id}`}
          >
            <View style={[styles.webOrderNumber, { backgroundColor: getMarkerColor(order) }]}>
              <Text style={styles.webOrderNumberText}>{idx + 1}</Text>
            </View>
            <View style={styles.webOrderInfo}>
              <ThemedText variant="body" numberOfLines={1}>{order.customerName}</ThemedText>
              <ThemedText variant="caption" numberOfLines={1}>{order.address}, {order.city}</ThemedText>
            </View>
            <StatusBadge status={order.status} size="sm" />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// Themed style factory: see useThemedStyles in BrandingContext.
const createMapWebStyles = () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  webFallback: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  fallbackTitle: {
    marginTop: Spacing.md,
  },
  fallbackText: {
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  webOrderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  webOrderNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webOrderNumberText: {
    color: Colors.textInverse,
    fontFamily: 'Inter_700Bold',
    fontSize: FontSize.sm,
  },
  webOrderInfo: {
    flex: 1,
  },
});
