import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Animated as RNAnimated } from 'react-native';
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
  withDelay,
  withSequence,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { triggerNotification, triggerImpact, NotificationFeedbackType, ImpactFeedbackStyle } from '../lib/haptics';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { estimateTravelMinutes, formatTravelTime } from '../lib/travel-time';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useAuth } from '../context/AuthContext';
import { useUrgentJob } from '../context/UrgentJobContext';
import type { Order, OrderStatus } from '../types';

function getStatusProgress(status: OrderStatus): number {
  const map: Record<string, number> = {
    ny: 0, planned: 0, skapad: 0, planerad: 0.1,
    dispatched: 0.2, en_route: 0.3, planerad_pre: 0.15, planerad_resurs: 0.25, planerad_las: 0.35,
    on_site: 0.5, paborjad: 0.5,
    in_progress: 0.75,
    completed: 1, utford: 1, avslutad: 1, fakturerad: 1,
    failed: 0, cancelled: 0, impossible: 0,
  };
  return map[status] ?? 0;
}

function PulsingSwipeHint({ label }: { label: string }) {
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <RNAnimated.View style={[styles.swipeHintAnimated, { opacity: pulseAnim }]}>
      <Feather name="chevrons-right" size={12} color={Colors.secondary} />
      <ThemedText variant="caption" color={Colors.secondary} style={styles.swipeHintLabel}>
        {label}
      </ThemedText>
    </RNAnimated.View>
  );
}

function TimelineSeparator() {
  return (
    <View style={styles.timelineSeparator}>
      <View style={styles.timelineLine} />
    </View>
  );
}

const SWIPE_THRESHOLD = 60;
const ACTION_WIDTH = 100;

const FILTER_OPTIONS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'Alla', value: 'all' },
  { label: 'Plan', value: 'planned' },
  { label: 'Pågår', value: 'in_progress' },
  { label: 'Klar', value: 'completed' },
  { label: 'Misslyckad', value: 'failed' },
];

function getStatusBorderColor(status: OrderStatus): string {
  switch (status) {
    case 'ny': return Colors.statusNy;
    case 'planerad': return Colors.statusPlanerad;
    case 'planerad_resurs': return Colors.statusPlaneradResurs;
    case 'paborjad': return Colors.statusPaborjad;
    case 'avslutad': return Colors.statusAvslutad;
    case 'planned': return Colors.statusPlanned;
    case 'dispatched': return Colors.statusDispatched;
    case 'en_route': return Colors.statusEnRoute;
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
    ny: 'planerad_resurs',
    planerad: 'planerad_resurs',
    planned: 'dispatched',
    dispatched: 'en_route',
    en_route: 'on_site',
    on_site: 'in_progress',
    in_progress: 'completed',
    skapad: 'planerad_pre',
    planerad_pre: 'planerad_resurs',
    planerad_resurs: 'paborjad',
    planerad_las: 'paborjad',
    paborjad: 'utford',
  };
  return flow[current] || null;
}

function getNextStatusLabel(current: OrderStatus): string {
  const labels: Record<string, string> = {
    ny: 'Starta',
    planerad: 'Starta',
    planned: 'Starta',
    dispatched: 'På väg',
    en_route: 'På plats',
    on_site: 'Börja',
    in_progress: 'Klar',
    skapad: 'Starta',
    planerad_pre: 'Starta',
    planerad_resurs: 'Starta',
    planerad_las: 'Starta',
    paborjad: 'Utför',
  };
  return labels[current] || 'Starta';
}

function isFinishedOrder(status: OrderStatus): boolean {
  return ['completed', 'utford', 'avslutad', 'fakturerad'].includes(status);
}

function canSwipe(order: Order): boolean {
  const terminalStatuses: OrderStatus[] = ['completed', 'failed', 'cancelled', 'utford', 'avslutad', 'fakturerad', 'impossible'];
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
  isFirstSwipeable,
  isEscalatedUrgent,
}: {
  order: Order;
  onPress: () => void;
  onAdvance: (orderId: number | string, nextStatus: OrderStatus) => void;
  onDeviation: (orderId: number | string) => void;
  travelTime?: string | null;
  isFirstSwipeable?: boolean;
  isEscalatedUrgent?: boolean;
}) {
  const translateX = useSharedValue(0);
  const swipeable = canSwipe(order);
  const nextStatus = getNextStatus(order.status);

  const completedSteps = order.subSteps ? order.subSteps.filter(s => s.completed).length : 0;
  const totalSteps = order.subSteps ? order.subSteps.length : 0;
  const stepProgress = totalSteps > 0 ? completedSteps / totalSteps : 0;

  const handleAdvance = useCallback(() => {
    if (nextStatus) {
      triggerNotification(NotificationFeedbackType.Success);
      onAdvance(order.id, nextStatus);
    }
  }, [nextStatus, order.id, onAdvance]);

  const handleDeviation = useCallback(() => {
    triggerImpact(ImpactFeedbackStyle.Medium);
    onDeviation(order.id);
  }, [order.id, onDeviation]);

  const triggerHaptic = useCallback(() => {
    triggerImpact(ImpactFeedbackStyle.Light);
  }, []);

  const pan = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .enabled(swipeable)
    .onUpdate((e) => {
      const clampedX = Math.max(-ACTION_WIDTH, Math.min(ACTION_WIDTH, e.translationX));
      translateX.value = clampedX;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD && nextStatus) {
        translateX.value = withSequence(
          withTiming(ACTION_WIDTH, { duration: 150 }),
          withDelay(100, withTiming(0, { duration: 250 }))
        );
        runOnJS(handleAdvance)();
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withSequence(
          withTiming(-ACTION_WIDTH, { duration: 150 }),
          withDelay(100, withTiming(0, { duration: 250 }))
        );
        runOnJS(handleDeviation)();
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
                  isFirstSwipeable={isFirstSwipeable}
                  isEscalatedUrgent={isEscalatedUrgent}
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
            isFirstSwipeable={false}
            isEscalatedUrgent={isEscalatedUrgent}
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
  isFirstSwipeable,
  isEscalatedUrgent,
}: {
  order: Order;
  completedSteps: number;
  totalSteps: number;
  stepProgress: number;
  travelTime?: string | null;
  isFirstSwipeable?: boolean;
  isEscalatedUrgent?: boolean;
}) {
  const finished = isFinishedOrder(order.status);
  const terminalStatuses: OrderStatus[] = ['failed', 'cancelled', 'impossible'];
  const showProgress = !terminalStatuses.includes(order.status);
  const effectiveProgress = totalSteps > 0 ? stepProgress : getStatusProgress(order.status);
  const progressLabel = totalSteps > 0 ? `${completedSteps}/${totalSteps}` : null;
  const swipeable = canSwipe({ status: order.status, isLocked: order.isLocked } as Order);

  const dependencyText = (() => {
    if (!order.dependencies || order.dependencies.length === 0) return null;
    if (order.isLocked) {
      const dep = order.dependencies[0];
      return dep?.dependsOnOrderNumber ? `Väntar på ${dep.dependsOnOrderNumber}` : 'Väntar på föregående';
    }
    return `Beroende: ${order.dependencies[0]?.dependsOnOrderNumber || 'annat uppdrag'}`;
  })();

  const restrictionText = (() => {
    if (!order.timeRestrictions) return null;
    const active = order.timeRestrictions.filter(r => r.isActive);
    if (active.length === 0) return null;
    const r = active[0];
    if (r.startTime && r.endTime) return `${r.startTime}-${r.endTime}`;
    if (r.endTime) return `Före ${r.endTime}`;
    if (r.startTime) return `Efter ${r.startTime}`;
    return r.description || 'Tidsbegränsning';
  })();

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
            <View style={styles.durationRow}>
              <Feather name="briefcase" size={9} color={finished ? Colors.textMuted : Colors.textSecondary} />
              <ThemedText variant="caption" color={finished ? Colors.textMuted : Colors.textSecondary} style={styles.durationText}>
                {order.estimatedDuration > 0 ? `${order.estimatedDuration} min` : 'Ej angiven'}
              </ThemedText>
            </View>
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
            <ThemedText variant="subheading" numberOfLines={2} color={finished ? Colors.textMuted : undefined}>
              {order.customerName}
            </ThemedText>
            <View style={styles.addressRow}>
              <Feather name="map-pin" size={12} color={finished ? Colors.textMuted : Colors.textSecondary} />
              <ThemedText variant="caption" numberOfLines={1} style={{ flex: 1 }} color={finished ? Colors.textMuted : undefined}>
                {order.address}, {order.city}
              </ThemedText>
              {travelTime ? (
                <View style={styles.travelBadge}>
                  <Feather name="truck" size={9} color={Colors.primary} />
                  <ThemedText variant="caption" color={Colors.primary} style={styles.travelText}>
                    {travelTime} dit
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText variant="caption" numberOfLines={2} color={Colors.textMuted}>
              {order.description}
            </ThemedText>

            {showProgress ? (
              <View style={styles.progressSection}>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${effectiveProgress * 100}%` }]} />
                </View>
                {progressLabel ? (
                  <ThemedText variant="caption" color={Colors.secondary} style={styles.progressText}>
                    {progressLabel}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            <View style={styles.badgeRow}>
              {isEscalatedUrgent ? (
                <View style={styles.escalatedTag}>
                  <Feather name="alert-triangle" size={10} color="#FFFFFF" />
                  <ThemedText variant="caption" color="#FFFFFF" style={styles.tagText}>
                    ESKALERAT
                  </ThemedText>
                </View>
              ) : order.priority === 'urgent' ? (
                <View style={styles.urgentTag}>
                  <Feather name="alert-circle" size={10} color={Colors.danger} />
                  <ThemedText variant="caption" color={Colors.danger} style={styles.tagText}>
                    BRÅDSKANDE
                  </ThemedText>
                </View>
              ) : null}

              {dependencyText ? (
                <View style={styles.dependencyTag}>
                  <Feather name={order.isLocked ? 'lock' : 'link'} size={10} color={Colors.info} />
                  <ThemedText variant="caption" color={Colors.info} style={styles.tagText}>
                    {dependencyText}
                  </ThemedText>
                </View>
              ) : null}

              {restrictionText ? (
                <View style={styles.restrictionTag}>
                  <Feather name="clock" size={10} color={Colors.warning} />
                  <ThemedText variant="caption" color={Colors.warning} style={styles.tagText}>
                    {restrictionText}
                  </ThemedText>
                </View>
              ) : null}

              {swipeable && isFirstSwipeable ? (
                <PulsingSwipeHint label={`Svep: ${getNextStatusLabel(order.status)}`} />
              ) : swipeable ? (
                <View style={styles.swipeHintSmall}>
                  <Feather name="chevrons-right" size={10} color={Colors.textMuted} />
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

interface RouteLeg {
  distance: number;
  duration: number;
  durationWithoutTraffic?: number;
}

interface RouteData {
  waypoints: { location: [number, number]; waypointIndex: number }[];
  trips: { distance: number; duration: number; durationWithoutTraffic?: number; legs?: RouteLeg[] }[];
  fallback?: boolean;
}

export function OrdersScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { currentPosition } = useGpsTracking();
  const { startPosition } = useAuth();
  const { activeJob, incomingJob } = useUrgentJob();
  const escalatedOrderId = activeJob?.orderId || incomingJob?.orderId || null;

  const { data: orders, isLoading, refetch } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const routeOrigin = useMemo(() => {
    if (startPosition) return startPosition;
    if (currentPosition?.latitude && currentPosition?.longitude) return currentPosition;
    return null;
  }, [startPosition, currentPosition?.latitude, currentPosition?.longitude]);

  const activeOrders = useMemo(
    () => (orders?.filter(o => o.status !== 'cancelled') || []).sort((a, b) => {
      if (a.scheduledStartTime && b.scheduledStartTime) {
        return a.scheduledStartTime.localeCompare(b.scheduledStartTime);
      }
      return a.sortOrder - b.sortOrder;
    }),
    [orders]
  );

  const coordsParam = useMemo(() => {
    if (activeOrders.length === 0) return null;
    const parts: string[] = [];
    if (routeOrigin?.latitude && routeOrigin?.longitude) {
      parts.push(`${routeOrigin.longitude},${routeOrigin.latitude}`);
    }
    activeOrders.forEach(o => {
      if (o.latitude && o.longitude && o.latitude !== 0 && o.longitude !== 0) {
        parts.push(`${o.longitude},${o.latitude}`);
      }
    });
    if (parts.length < 2) return null;
    return parts.join(';');
  }, [activeOrders, routeOrigin]);

  const { data: routeData } = useQuery<RouteData>({
    queryKey: ['/api/mobile/route', coordsParam],
    queryFn: async () => {
      if (!coordsParam) throw new Error('No coords');
      return apiRequest('GET', `/api/mobile/route?coords=${encodeURIComponent(coordsParam)}`);
    },
    enabled: !!coordsParam,
    staleTime: 300000,
  });

  const trafficLegMap = useMemo(() => {
    const map = new Map<number | string, { duration: number; durationWithoutTraffic?: number }>();
    if (!routeData?.trips?.[0]?.legs || activeOrders.length === 0) return map;
    const hasDriverStart = !!routeOrigin;
    const legs = routeData.trips[0].legs;
    activeOrders.forEach((order, idx) => {
      const legIdx = hasDriverStart ? idx : (idx > 0 ? idx - 1 : -1);
      if (legIdx >= 0 && legIdx < (legs?.length || 0)) {
        const leg = legs![legIdx];
        map.set(order.id, { duration: leg.duration, durationWithoutTraffic: leg.durationWithoutTraffic });
      }
    });
    return map;
  }, [routeData, activeOrders, routeOrigin]);

  const statusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: number | string; status: OrderStatus }) =>
      apiRequest('PATCH', `/api/mobile/orders/${orderId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
    },
    onError: () => {
      triggerNotification(NotificationFeedbackType.Error);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const FINISHED_STATUSES = ['utford', 'completed', 'avslutad', 'fakturerad'];

  const filteredOrders = useMemo(() => {
    const filtered = orders?.filter(o => {
      if (filter === 'all') return true;
      return o.status === filter;
    }) || [];
    const sorted = [...filtered].sort((a, b) => {
      const aFinished = FINISHED_STATUSES.includes(a.status);
      const bFinished = FINISHED_STATUSES.includes(b.status);
      if (aFinished && bFinished && a.completedAt && b.completedAt) {
        return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
      }
      if (escalatedOrderId != null) {
        const aEsc = String(a.id) === String(escalatedOrderId) ? 1 : 0;
        const bEsc = String(b.id) === String(escalatedOrderId) ? 1 : 0;
        if (aEsc !== bEsc) return bEsc - aEsc;
      }
      return 0;
    });
    return sorted;
  }, [orders, filter, escalatedOrderId]);

  const handleAdvance = useCallback((orderId: number | string, nextStatus: OrderStatus) => {
    statusMutation.mutate({ orderId, status: nextStatus });
  }, [statusMutation]);

  const handleDeviation = useCallback((orderId: number | string) => {
    navigation.navigate('ReportDeviation', { orderId });
  }, [navigation]);

  const firstSwipeableId = filteredOrders.find(o => canSwipe(o))?.id;

  const renderOrder = useCallback(({ item: order }: { item: Order }) => {
    const trafficLeg = trafficLegMap.get(order.id);
    let travelTime: string | null = null;
    if (trafficLeg) {
      const trafficMin = Math.round(trafficLeg.duration / 60);
      travelTime = formatTravelTime(trafficMin);
    } else {
      const travelMin = estimateTravelMinutes(
        currentPosition?.latitude, currentPosition?.longitude,
        order.latitude, order.longitude
      );
      travelTime = formatTravelTime(travelMin);
    }
    const isEscalated = escalatedOrderId != null && String(order.id) === String(escalatedOrderId);
    return (
      <SwipeableOrderCard
        order={order}
        onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
        onAdvance={handleAdvance}
        onDeviation={handleDeviation}
        travelTime={travelTime}
        isFirstSwipeable={order.id === firstSwipeableId}
        isEscalatedUrgent={isEscalated}
      />
    );
  }, [currentPosition, navigation, handleAdvance, handleDeviation, firstSwipeableId, trafficLegMap, escalatedOrderId]);

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
          estimatedItemSize={160}
          ItemSeparatorComponent={TimelineSeparator}
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
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 1,
  },
  durationText: {
    fontSize: 9,
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
  escalatedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dependencyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  restrictionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  swipeHintAnimated: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
  },
  swipeHintLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  swipeHintSmall: {
    marginLeft: 'auto',
    opacity: 0.4,
  },
  tagText: {
    fontSize: 9,
  },
  timelineSeparator: {
    height: 12,
    paddingLeft: 5 + Spacing.md + 25,
    justifyContent: 'center',
  },
  timelineLine: {
    width: 2,
    height: '100%',
    backgroundColor: Colors.primaryLight,
    borderRadius: 1,
    opacity: 0.5,
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
