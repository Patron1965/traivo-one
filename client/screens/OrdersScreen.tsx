import React, { useState, useCallback } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
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
  { label: 'Plan', value: 'planned' },
  { label: 'Pågår', value: 'in_progress' },
  { label: 'Klar', value: 'completed' },
  { label: 'Misslyckad', value: 'failed' },
];

function getStatusBorderColor(status: OrderStatus): string {
  switch (status) {
    case 'planned': return Colors.statusPlanned;
    case 'dispatched': return Colors.statusDispatched;
    case 'on_site': return Colors.statusOnSite;
    case 'in_progress': return Colors.statusInProgress;
    case 'completed': return Colors.statusCompleted;
    case 'failed': return Colors.statusFailed;
    case 'cancelled': return Colors.statusCancelled;
    default: return Colors.statusPlanned;
  }
}

export function OrdersScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const { data: orders, isLoading, refetch } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
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

  const renderOrder = ({ item: order }: { item: Order }) => {
    const completedSteps = order.subSteps ? order.subSteps.filter(s => s.completed).length : 0;
    const totalSteps = order.subSteps ? order.subSteps.length : 0;
    const stepProgress = totalSteps > 0 ? completedSteps / totalSteps : 0;

    return (
      <Pressable
        onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
        style={styles.orderPressable}
        testID={`card-order-${order.id}`}
      >
        <Card style={[styles.orderCard, order.isLocked ? styles.lockedCard : null]}>
          <View style={[styles.statusStripe, { backgroundColor: getStatusBorderColor(order.status) }]} />
          <View style={styles.orderInner}>
            <View style={styles.orderRow}>
              <View style={styles.timeColumn}>
                <ThemedText variant="subheading" color={Colors.primary}>
                  {order.scheduledTimeStart || '--:--'}
                </ThemedText>
                <ThemedText variant="caption">{order.estimatedDuration} min</ThemedText>
                {order.isLocked ? (
                  <Feather name="lock" size={14} color={Colors.danger} style={styles.lockIcon} />
                ) : null}
              </View>
              <View style={styles.orderContent}>
                <View style={styles.orderTopRow}>
                  <View style={styles.orderNumberWithCodes}>
                    <ThemedText variant="label">{order.orderNumber}</ThemedText>
                    {order.executionCodes && order.executionCodes.length > 0 ? (
                      <View style={styles.execCodesRow}>
                        {order.executionCodes.map(ec => (
                          <View key={ec.id} style={styles.execCodeBadge}>
                            <ThemedText variant="caption" color={Colors.primaryLight} style={styles.execCodeText}>
                              {ec.code}
                            </ThemedText>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
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

                {totalSteps > 0 ? (
                  <View style={styles.progressSection}>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${stepProgress * 100}%` }]} />
                    </View>
                    <ThemedText variant="caption" color={Colors.secondary} style={styles.progressText}>
                      {completedSteps}/{totalSteps}
                    </ThemedText>
                  </View>
                ) : null}

                <View style={styles.badgeRow}>
                  {order.priority === 'urgent' ? (
                    <View style={styles.urgentTag}>
                      <Feather name="alert-circle" size={10} color={Colors.danger} />
                      <ThemedText variant="caption" color={Colors.danger} style={styles.tagText}>
                        BRÅDSKANDE
                      </ThemedText>
                    </View>
                  ) : null}

                  {order.dependencies && order.dependencies.length > 0 ? (
                    <View style={styles.dependencyTag}>
                      <Feather name="link" size={10} color={Colors.info} />
                      <ThemedText variant="caption" color={Colors.info} style={styles.tagText}>
                        {order.isLocked ? 'LÅST' : 'BEROENDE'}
                      </ThemedText>
                    </View>
                  ) : null}

                  {order.timeRestrictions && order.timeRestrictions.filter(r => r.isActive).length > 0 ? (
                    <View style={styles.restrictionTag}>
                      <Feather name="alert-triangle" size={10} color={Colors.danger} />
                      <ThemedText variant="caption" color={Colors.danger} style={styles.tagText}>
                        BEGRÄNSNING
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
              <Feather name="chevron-right" size={20} color={Colors.textMuted} />
            </View>
          </View>
        </Card>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.filterScroll, { marginTop: headerHeight + Spacing.sm }]}
        contentContainerStyle={styles.filterContainer}
      >
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
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : (
        <FlashList
          data={filteredOrders}
          renderItem={renderOrder}
          estimatedItemSize={140}
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
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
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
    padding: 0,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  lockedCard: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: Colors.dangerLight,
  },
  statusStripe: {
    width: 5,
    borderTopLeftRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.lg,
  },
  orderInner: {
    flex: 1,
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
  lockIcon: {
    marginTop: 4,
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
  orderNumberWithCodes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  execCodesRow: {
    flexDirection: 'row',
    gap: 3,
  },
  execCodeBadge: {
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  execCodeText: {
    fontSize: 8,
    fontFamily: 'Inter_600SemiBold',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  urgentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  dependencyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  restrictionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tagText: {
    fontSize: 9,
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
  },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.secondary,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    minWidth: 24,
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
