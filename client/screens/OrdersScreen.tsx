import React, { useState, useCallback } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { FlashList } from '@shopify/flash-list';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { estimateTravelMinutes, formatTravelTime } from '../lib/travel-time';
import { useGpsTracking } from '../hooks/useGpsTracking';
import type { Order, OrderStatus } from '../types';

const SWIPE_THRESHOLD = 80;
const ACTION_WIDTH = 90;

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

function getNextStatus(current: OrderStatus): OrderStatus | null {
  const flow: Record<string, OrderStatus> = {
    planned: 'dispatched',
    dispatched: 'on_site',
    on_site: 'in_progress',
    in_progress: 'completed',
    skapad: 'planerad_pre',
    planerad_pre: 'planerad_resurs',
    planerad_resurs: 'planerad_las',
    planerad_las: 'utford',
  };
  return flow[current] || null;
}

function getNextStatusLabel(current: OrderStatus): string {
  const labels: Record<string, string> = {
    planned: 'Starta',
    dispatched: 'På plats',
    on_site: 'Börja',
    in_progress: 'Klar',
    skapad: 'Starta',
    planerad_pre: 'Starta',
    planerad_resurs: 'Starta',
    planerad_las: 'Utför',
  };
  return labels[current] || 'Starta';
}

function isFinishedOrder(status: OrderStatus): boolean {
  return ['completed', 'utford', 'fakturerad'].includes(status);
}

function canSwipe(order: Order): boolean {
  const terminalStatuses: OrderStatus[] = ['completed', 'failed', 'cancelled', 'utford', 'fakturerad', 'impossible'];
  if (terminalStatuses.includes(order.status)) return false;
  if (order.isLocked) return false;
  return true;
}

function SwipeableOrderCard({
  order,
  onPress,
  onAdvance,
  onDeviation,
  travelTime,
}: {
  order: Order;
  onPress: () => void;
  onAdvance: (orderId: number | string, nextStatus: OrderStatus) => void;
  onDeviation: (orderId: number | string) => void;
  travelTime?: string | null;
}) {
  const translateX = useSharedValue(0);
  const swipeable = canSwipe(order);
  const nextStatus = getNextStatus(order.status);

  const completedSteps = order.subSteps ? order.subSteps.filter(s => s.completed).length : 0;
  const totalSteps = order.subSteps ? order.subSteps.length : 0;
  const stepProgress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  const handleAdvance = useCallback(() => {
    if (nextStatus) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdvance(order.id, nextStatus);
    }
  }, [nextStatus, order.id, onAdvance]);

  const handleDeviation = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDeviation(order.id);
  }, [order.id, onDeviation]);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .enabled(swipeable)
    .onUpdate((e) => {
      const clampedX = Math.max(-ACTION_WIDTH, Math.min(ACTION_WIDTH, e.translationX));
      translateX.value = clampedX;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD && nextStatus) {
        translateX.value = withTiming(ACTION_WIDTH, { duration: 200 });
        runOnJS(handleAdvance)();
        translateX.value = withTiming(0, { duration: 300 });
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-ACTION_WIDTH, { duration: 200 });
        runOnJS(handleDeviation)();
        translateX.value = withTiming(0, { duration: 300 });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const rightActionStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD * 0.5, SWIPE_THRESHOLD],
      [0, 0.5, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      translateX.value,
      [0, SWIPE_THRESHOLD],
      [0.5, 1],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  const leftActionStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [0, -SWIPE_THRESHOLD * 0.5, -SWIPE_THRESHOLD],
      [0, 0.5, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      translateX.value,
      [0, -SWIPE_THRESHOLD],
      [0.5, 1],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ scale }] };
  });

  return (
    <View style={styles.orderPressable} testID={`card-order-${order.id}`}>
      {swipeable ? (
        <>
          <View style={styles.swipeActionsContainer}>
            {nextStatus ? (
              <Animated.View style={[styles.swipeActionRight, rightActionStyle]}>
                <Feather name="play" size={20} color={Colors.textInverse} />
                <ThemedText variant="caption" color={Colors.textInverse} style={styles.swipeActionText}>
                  {getNextStatusLabel(order.status)}
                </ThemedText>
              </Animated.View>
            ) : null}
            <Animated.View style={[styles.swipeActionLeft, leftActionStyle]}>
              <Feather name="alert-triangle" size={20} color={Colors.textInverse} />
              <ThemedText variant="caption" color={Colors.textInverse} style={styles.swipeActionText}>
                Avvikelse
              </ThemedText>
            </Animated.View>
          </View>

          <GestureDetector gesture={pan}>
            <Animated.View style={cardAnimatedStyle}>
              <Pressable onPress={onPress}>
                <OrderCardContent
                  order={order}
                  completedSteps={completedSteps}
                  totalSteps={totalSteps}
                  stepProgress={stepProgress}
                  travelTime={travelTime}
                />
              </Pressable>
            </Animated.View>
          </GestureDetector>
        </>
      ) : (
        <Pressable onPress={onPress}>
          <OrderCardContent
            order={order}
            completedSteps={completedSteps}
            totalSteps={totalSteps}
            stepProgress={stepProgress}
            travelTime={travelTime}
          />
        </Pressable>
      )}
    </View>
  );
}

function OrderCardContent({
  order,
  completedSteps,
  totalSteps,
  stepProgress,
  travelTime,
}: {
  order: Order;
  completedSteps: number;
  totalSteps: number;
  stepProgress: number;
  travelTime?: string | null;
}) {
  const finished = isFinishedOrder(order.status);
  return (
    <Card style={[styles.orderCard, order.isLocked ? styles.lockedCard : null, finished ? styles.finishedCard : null]}>
      <View style={[styles.statusStripe, { backgroundColor: getStatusBorderColor(order.status) }]} />
      {finished ? (
        <View style={styles.finishedCheckOverlay}>
          <View style={styles.finishedCheckCircle}>
            <Feather name="check" size={18} color="#fff" />
          </View>
        </View>
      ) : null}
      <View style={[styles.orderInner, finished ? styles.finishedInner : null]}>
        <View style={styles.orderRow}>
          <View style={styles.timeColumn}>
            <ThemedText variant="subheading" color={finished ? Colors.textMuted : Colors.primary}>
              {order.scheduledTimeStart || '--:--'}
            </ThemedText>
            <ThemedText variant="caption" color={finished ? Colors.textMuted : undefined}>{order.estimatedDuration} min</ThemedText>
            {order.isLocked ? (
              <Feather name="lock" size={14} color={Colors.danger} style={styles.lockIcon} />
            ) : null}
          </View>
          <View style={styles.orderContent}>
            <View style={styles.orderTopRow}>
              <View style={styles.orderNumberWithCodes}>
                <ThemedText variant="label" color={finished ? Colors.textMuted : undefined}>{order.orderNumber}</ThemedText>
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
            <ThemedText variant="subheading" numberOfLines={1} color={finished ? Colors.textMuted : undefined}>
              {order.customerName}
            </ThemedText>
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color={finished ? Colors.textMuted : Colors.textSecondary} />
              <ThemedText variant="caption" numberOfLines={1} style={{ flex: 1 }} color={finished ? Colors.textMuted : undefined}>
                {order.address}, {order.city}
              </ThemedText>
              {travelTime ? (
                <View style={styles.travelBadge}>
                  <Feather name="navigation" size={9} color={Colors.primary} />
                  <ThemedText variant="caption" color={Colors.primary} style={styles.travelText}>
                    {travelTime}
                  </ThemedText>
                </View>
              ) : null}
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

              {canSwipe({ status: order.status, isLocked: order.isLocked } as Order) ? (
                <View style={styles.swipeHint}>
                  <Feather name="chevrons-right" size={10} color={Colors.textMuted} />
                  <ThemedText variant="caption" color={Colors.textMuted} style={styles.tagText}>
                    svep
                  </ThemedText>
                </View>
              ) : null}
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={finished ? Colors.textMuted : Colors.textSecondary} />
        </View>
      </View>
    </Card>
  );
}

export function OrdersScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { currentPosition } = useGpsTracking();

  const { data: orders, isLoading, refetch } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const statusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: number | string; status: OrderStatus }) =>
      apiRequest('PATCH', `/api/mobile/orders/${orderId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
    },
    onError: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
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

  const handleAdvance = useCallback((orderId: number | string, nextStatus: OrderStatus) => {
    statusMutation.mutate({ orderId, status: nextStatus });
  }, [statusMutation]);

  const handleDeviation = useCallback((orderId: number | string) => {
    navigation.navigate('ReportDeviation', { orderId });
  }, [navigation]);

  const renderOrder = ({ item: order }: { item: Order }) => {
    const travelMin = estimateTravelMinutes(
      currentPosition?.latitude, currentPosition?.longitude,
      order.latitude, order.longitude
    );
    return (
      <SwipeableOrderCard
        order={order}
        onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
        onAdvance={handleAdvance}
        onDeviation={handleDeviation}
        travelTime={formatTravelTime(travelMin)}
      />
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
    position: 'relative',
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
  finishedCard: {
    backgroundColor: '#F0F9F4',
    opacity: 0.85,
  },
  finishedCheckOverlay: {
    position: 'absolute',
    right: 14,
    top: 10,
    zIndex: 2,
  },
  finishedCheckCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.statusCompleted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedInner: {
    opacity: 0.7,
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
  travelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  travelText: {
    fontSize: 10,
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
  swipeHint: {
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
  swipeActionsContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  swipeActionRight: {
    width: ACTION_WIDTH,
    height: '100%',
    backgroundColor: Colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: BorderRadius.lg,
    borderBottomLeftRadius: BorderRadius.lg,
    gap: 2,
  },
  swipeActionLeft: {
    width: ACTION_WIDTH,
    height: '100%',
    backgroundColor: Colors.warning,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopRightRadius: BorderRadius.lg,
    borderBottomRightRadius: BorderRadius.lg,
    gap: 2,
    marginLeft: 'auto',
  },
  swipeActionText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
});
