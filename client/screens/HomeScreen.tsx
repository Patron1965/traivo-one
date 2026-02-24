import React, { useCallback } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Platform } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { getApiUrl } from '../lib/query-client';
import type { Order, OrderStatus, DaySummary } from '../types';

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

export function HomeScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { user } = useAuth();

  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const { data: summary } = useQuery<DaySummary>({
    queryKey: ['/api/mobile/summary'],
  });

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchOrders();
    setRefreshing(false);
  }, [refetchOrders]);

  const activeOrders = orders?.filter(o => o.status !== 'completed' && o.status !== 'cancelled') || [];
  const completedCount = orders?.filter(o => o.status === 'completed').length || 0;
  const totalCount = orders?.length || 0;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;
  const lockedCount = orders?.filter(o => o.isLocked).length || 0;

  const today = new Date();
  const dateStr = today.toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.lg, paddingBottom: tabBarHeight + Spacing.xl },
      ]}
      scrollIndicatorInsets={{ bottom: tabBarHeight }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
      }
    >
      <View style={styles.greeting}>
        <View>
          <ThemedText variant="caption" style={styles.dateText}>
            {dateStr}
          </ThemedText>
          <ThemedText variant="heading">
            Hej, {user?.name?.split(' ')[0] || 'Chauför'}
          </ThemedText>
        </View>
        {user?.vehicleRegNo ? (
          <View style={styles.vehicleBadge}>
            <Feather name="truck" size={14} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>
              {user.vehicleRegNo}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <Card style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <ThemedText variant="subheading">Dagens framsteg</ThemedText>
          <ThemedText variant="body" color={Colors.textSecondary}>
            {completedCount}/{totalCount} uppdrag
          </ThemedText>
        </View>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <ThemedText variant="heading" color={Colors.primary}>
              {summary?.totalDuration || summary?.estimatedTimeRemaining || 0}
            </ThemedText>
            <ThemedText variant="caption">min totalt</ThemedText>
          </View>
          {summary?.totalDistance ? (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText variant="heading" color={Colors.primary}>
                  {summary.totalDistance.toFixed(1)}
                </ThemedText>
                <ThemedText variant="caption">km totalt</ThemedText>
              </View>
            </>
          ) : null}
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <ThemedText variant="heading" color={Colors.danger}>
              {summary?.remainingOrders || 0}
            </ThemedText>
            <ThemedText variant="caption">återstående</ThemedText>
          </View>
          {lockedCount > 0 ? (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText variant="heading" color={Colors.warning}>
                  {lockedCount}
                </ThemedText>
                <ThemedText variant="caption">låsta</ThemedText>
              </View>
            </>
          ) : null}
        </View>
      </Card>

      {!ordersLoading && activeOrders.length > 0 ? (
        <Pressable
          style={styles.nextOrderButton}
          onPress={() => {
            const nextOrder = activeOrders.find(o => !o.isLocked) || activeOrders[0];
            navigation.navigate('OrderDetail', { orderId: nextOrder.id });
          }}
          testID="button-next-order"
        >
          <View style={styles.nextOrderLeft}>
            <View style={styles.nextOrderIconCircle}>
              <Feather name="arrow-right-circle" size={28} color={Colors.textInverse} />
            </View>
            <View>
              <ThemedText variant="subheading" color={Colors.textInverse}>
                Nästa uppdrag
              </ThemedText>
              <ThemedText variant="caption" color="rgba(255,255,255,0.8)">
                {(activeOrders.find(o => !o.isLocked) || activeOrders[0]).customerName}
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={24} color={Colors.textInverse} />
        </Pressable>
      ) : null}

      <View style={styles.sectionHeader}>
        <ThemedText variant="subheading">
          Kommande uppdrag
        </ThemedText>
        <Pressable
          onPress={() => navigation.navigate('OrdersTab')}
          testID="button-view-all-orders"
        >
          <ThemedText variant="body" color={Colors.primaryLight}>
            Visa alla
          </ThemedText>
        </Pressable>
      </View>

      {ordersLoading ? (
        <ActivityIndicator color={Colors.primary} style={styles.loader} />
      ) : (
        activeOrders.slice(0, 3).map((order) => (
          <Pressable
            key={order.id}
            onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
            testID={`card-order-${order.id}`}
          >
            <Card style={[styles.orderCard, order.isLocked ? styles.lockedCard : null]}>
              <View style={[styles.statusStripe, { backgroundColor: getStatusBorderColor(order.status) }]} />
              <View style={styles.orderInner}>
                <View style={styles.orderHeader}>
                  <View style={styles.orderInfo}>
                    <View style={styles.orderNumberRow}>
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
                    <ThemedText variant="subheading" numberOfLines={1}>
                      {order.customerName}
                    </ThemedText>
                  </View>
                  <View style={styles.statusColumn}>
                    <StatusBadge status={order.status} size="sm" />
                    {order.isLocked ? (
                      <Feather name="lock" size={14} color={Colors.danger} />
                    ) : null}
                  </View>
                </View>
                <View style={styles.orderDetails}>
                  <View style={styles.orderDetailRow}>
                    <Feather name="map-pin" size={14} color={Colors.textSecondary} />
                    <ThemedText variant="body" color={Colors.textSecondary} numberOfLines={1}>
                      {order.address}, {order.city}
                    </ThemedText>
                  </View>
                  {order.scheduledTimeStart ? (
                    <View style={styles.orderDetailRow}>
                      <Feather name="clock" size={14} color={Colors.textSecondary} />
                      <ThemedText variant="body" color={Colors.textSecondary}>
                        {order.scheduledTimeStart} - {order.scheduledTimeEnd}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>

                {order.subSteps && order.subSteps.length > 0 ? (
                  <View style={styles.progressSection}>
                    <View style={styles.progressBarSmBg}>
                      <View style={[styles.progressBarSmFill, {
                        width: `${order.subSteps.length > 0 ? (order.subSteps.filter(s => s.completed).length / order.subSteps.length) * 100 : 0}%`
                      }]} />
                    </View>
                    <ThemedText variant="caption" color={Colors.secondary} style={styles.progressSmText}>
                      {order.subSteps.filter(s => s.completed).length}/{order.subSteps.length}
                    </ThemedText>
                  </View>
                ) : null}

                <View style={styles.badgeRow}>
                  {order.priority === 'urgent' ? (
                    <View style={styles.urgentBadge}>
                      <Feather name="alert-circle" size={12} color={Colors.danger} />
                      <ThemedText variant="caption" color={Colors.danger}>Brådskande</ThemedText>
                    </View>
                  ) : order.priority === 'high' ? (
                    <View style={styles.highBadge}>
                      <Feather name="arrow-up" size={12} color={Colors.warning} />
                      <ThemedText variant="caption" color={Colors.warning}>Hög prioritet</ThemedText>
                    </View>
                  ) : null}

                  {order.dependencies && order.dependencies.length > 0 ? (
                    <View style={styles.dependencyBadge}>
                      <Feather name="link" size={12} color={Colors.info} />
                      <ThemedText variant="caption" color={Colors.info}>
                        {order.dependencies.length} beroende
                      </ThemedText>
                    </View>
                  ) : null}

                  {order.timeRestrictions && order.timeRestrictions.filter(r => r.isActive).length > 0 ? (
                    <View style={styles.restrictionBadge}>
                      <Feather name="clock" size={12} color={Colors.danger} />
                      <ThemedText variant="caption" color={Colors.danger}>
                        Tidsbegränsning
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  greeting: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  dateText: {
    textTransform: 'capitalize',
    marginBottom: Spacing.xs,
  },
  vehicleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.infoLight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  progressCard: {
    backgroundColor: Colors.surface,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: Colors.borderLight,
    borderRadius: 4,
    marginBottom: Spacing.lg,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.secondary,
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: Colors.borderLight,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  loader: {
    padding: Spacing.xxl,
  },
  nextOrderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  nextOrderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  nextOrderIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderCard: {
    padding: 0,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  statusStripe: {
    width: 5,
    borderTopLeftRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.lg,
  },
  orderInner: {
    flex: 1,
    padding: Spacing.lg,
  },
  lockedCard: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: Colors.dangerLight,
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  progressBarSmBg: {
    flex: 1,
    height: 6,
    backgroundColor: Colors.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarSmFill: {
    height: '100%',
    backgroundColor: Colors.secondary,
    borderRadius: 3,
  },
  progressSmText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    minWidth: 24,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  orderInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  orderNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  execCodesRow: {
    flexDirection: 'row',
    gap: 4,
  },
  execCodeBadge: {
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  execCodeText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
  },
  statusColumn: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  orderDetails: {
    gap: Spacing.xs,
  },
  orderDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.dangerLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  highBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.warningLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  dependencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.infoLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  restrictionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.dangerLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
});
