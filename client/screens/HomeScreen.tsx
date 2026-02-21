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
import type { Order, DaySummary, WeatherData } from '../types';

export function HomeScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { user } = useAuth();

  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/orders'],
  });

  const { data: summary } = useQuery<DaySummary>({
    queryKey: ['/api/mobile/summary'],
  });

  const { data: weather } = useQuery<WeatherData>({
    queryKey: ['/api/mobile/weather'],
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
            Hej, {user?.name?.split(' ')[0] || 'Chauf\u00f6r'}
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

      {weather ? (
        <Card style={styles.weatherCard}>
          <View style={styles.weatherRow}>
            <View style={styles.weatherMain}>
              <Feather
                name={weather.icon as any}
                size={28}
                color={Colors.primaryLight}
              />
              <ThemedText variant="heading" style={styles.tempText}>
                {weather.temperature}\u00b0
              </ThemedText>
              <View>
                <ThemedText variant="body">{weather.description}</ThemedText>
                <ThemedText variant="caption">
                  K\u00e4nns som {weather.feelsLike}\u00b0 | Vind {weather.windSpeed} m/s
                </ThemedText>
              </View>
            </View>
          </View>
          {weather.warnings.length > 0 ? (
            <View style={styles.warningsContainer}>
              {weather.warnings.map((w, i) => (
                <View key={i} style={styles.warningBadge}>
                  <Feather name="alert-triangle" size={12} color={Colors.warning} />
                  <ThemedText variant="caption" color={Colors.warning}>
                    {w}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

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
              {summary?.estimatedTimeRemaining || 0}
            </ThemedText>
            <ThemedText variant="caption">min kvar</ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <ThemedText variant="heading" color={Colors.primary}>
              {summary?.totalDistance?.toFixed(1) || '0'}
            </ThemedText>
            <ThemedText variant="caption">km totalt</ThemedText>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <ThemedText variant="heading" color={Colors.danger}>
              {summary?.deferredOrders || 0}
            </ThemedText>
            <ThemedText variant="caption">uppskjutna</ThemedText>
          </View>
          {lockedCount > 0 ? (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <ThemedText variant="heading" color={Colors.warning}>
                  {lockedCount}
                </ThemedText>
                <ThemedText variant="caption">l\u00e5sta</ThemedText>
              </View>
            </>
          ) : null}
        </View>
      </Card>

      <View style={styles.sectionHeader}>
        <ThemedText variant="subheading">
          N\u00e4sta uppdrag
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

              <View style={styles.badgeRow}>
                {order.priority === 'urgent' ? (
                  <View style={styles.urgentBadge}>
                    <Feather name="alert-circle" size={12} color={Colors.danger} />
                    <ThemedText variant="caption" color={Colors.danger}>Br\u00e5dskande</ThemedText>
                  </View>
                ) : order.priority === 'high' ? (
                  <View style={styles.highBadge}>
                    <Feather name="arrow-up" size={12} color={Colors.warning} />
                    <ThemedText variant="caption" color={Colors.warning}>H\u00f6g prioritet</ThemedText>
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
                      Tidsbegr\u00e4nsning
                    </ThemedText>
                  </View>
                ) : null}

                {order.subSteps && order.subSteps.length > 0 ? (
                  <View style={styles.subStepBadge}>
                    <Feather name="list" size={12} color={Colors.secondary} />
                    <ThemedText variant="caption" color={Colors.secondary}>
                      {order.subSteps.filter(s => s.completed).length}/{order.subSteps.length}
                    </ThemedText>
                  </View>
                ) : null}
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
  weatherCard: {
    backgroundColor: Colors.surface,
  },
  weatherRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weatherMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  tempText: {
    fontSize: FontSize.xxxl,
  },
  warningsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  warningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.warningLight,
    paddingHorizontal: Spacing.sm,
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
  orderCard: {
    backgroundColor: Colors.surface,
  },
  lockedCard: {
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: Colors.dangerLight,
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
  subStepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.successLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
});
