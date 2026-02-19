import React, { useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import type { Order, OrderStatus } from '../types';

const FILTER_OPTIONS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'Alla', value: 'all' },
  { label: 'Planerad', value: 'planned' },
  { label: 'P\u00e5g\u00e5r', value: 'in_progress' },
  { label: 'Slutf\u00f6rd', value: 'completed' },
  { label: 'Uppskjuten', value: 'deferred' },
];

export function OrdersScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const { data: orders, isLoading, refetch } = useQuery<Order[]>({
    queryKey: ['/api/mobile/orders'],
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const filteredOrders = orders?.filter(o => {
    if (filter === 'all') return true;
    return o.status === filter;
  }) || [];

  const renderOrder = ({ item: order }: { item: Order }) => (
    <Pressable
      onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
      style={styles.orderPressable}
      testID={`card-order-${order.id}`}
    >
      <Card style={styles.orderCard}>
        <View style={styles.orderRow}>
          <View style={styles.timeColumn}>
            <ThemedText variant="subheading" color={Colors.primary}>
              {order.scheduledTimeStart || '--:--'}
            </ThemedText>
            <ThemedText variant="caption">{order.estimatedDuration} min</ThemedText>
          </View>
          <View style={styles.orderContent}>
            <View style={styles.orderTopRow}>
              <ThemedText variant="label">{order.orderNumber}</ThemedText>
              <StatusBadge status={order.status} size="sm" />
            </View>
            <ThemedText variant="subheading" numberOfLines={1}>
              {order.customerName}
            </ThemedText>
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color={Colors.textSecondary} />
              <ThemedText variant="caption" numberOfLines={1}>
                {order.address}, {order.city}
              </ThemedText>
            </View>
            <ThemedText variant="caption" numberOfLines={1} color={Colors.textMuted}>
              {order.description}
            </ThemedText>
            {order.priority === 'urgent' ? (
              <View style={styles.urgentTag}>
                <Feather name="alert-circle" size={10} color={Colors.danger} />
                <ThemedText variant="caption" color={Colors.danger} style={{ fontSize: 10 }}>
                  BR\u00c5DSKANDE
                </ThemedText>
              </View>
            ) : null}
          </View>
          <Feather name="chevron-right" size={20} color={Colors.textMuted} />
        </View>
      </Card>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.filterContainer, { marginTop: headerHeight + Spacing.sm }]}>
        {FILTER_OPTIONS.map(opt => (
          <Pressable
            key={opt.value}
            style={[styles.filterChip, filter === opt.value ? styles.filterActive : null]}
            onPress={() => setFilter(opt.value)}
            testID={`button-filter-${opt.value}`}
          >
            <ThemedText
              variant="caption"
              color={filter === opt.value ? Colors.textInverse : Colors.textSecondary}
              style={styles.filterText}
            >
              {opt.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : (
        <FlashList
          data={filteredOrders}
          renderItem={renderOrder}
          estimatedItemSize={120}
          contentContainerStyle={{
            paddingHorizontal: Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="inbox" size={48} color={Colors.textMuted} />
              <ThemedText variant="body" color={Colors.textMuted}>
                Inga uppdrag att visa
              </ThemedText>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filterActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: FontSize.sm,
  },
  orderPressable: {
    marginBottom: Spacing.sm,
  },
  orderCard: {
    padding: Spacing.md,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  timeColumn: {
    alignItems: 'center',
    minWidth: 50,
  },
  orderContent: {
    flex: 1,
    gap: 2,
  },
  orderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  urgentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xxxl * 2,
  },
});
