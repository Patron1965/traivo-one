import React, { useCallback, useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { View, ScrollView, Pressable, RefreshControl, ActivityIndicator, Animated, Linking } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { triggerNotification, NotificationFeedbackType } from '../lib/haptics';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { fetchDrivingDistance } from '../lib/travel-time';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useTeam } from '../hooks/useTeam';
import { useOfflinePendingCount } from '../hooks/useOfflineSync';
import { useDisruptionMonitor } from '../hooks/useDisruptionMonitor';
import { SyncStatusDot } from '../components/OfflineIndicator';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { VoiceCommandOverlay } from '../components/home/VoiceCommandOverlay';
import { WeatherWidget } from '../components/home/WeatherWidget';
import { WorkTimeCard } from '../components/home/WorkTimeCard';
import { NextOrderCard } from '../components/home/NextOrderCard';
import { OrderPreviewList } from '../components/home/OrderPreviewList';
import styles from './HomeScreen.styles';
import { formatWorkTime, computeBreakSuggestion } from './HomeScreen.utils';
import type { TimeSummary } from './HomeScreen.utils';
import type { Order, DaySummary, WeatherData } from '../types';

export function HomeScreen({ navigation }: any) {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { user, isOnline, setIsOnline } = useAuth();

  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
  });

  const { data: summary, refetch: refetchSummary } = useQuery<DaySummary>({
    queryKey: ['/api/mobile/summary'],
  });

  const { data: weather } = useQuery<WeatherData>({
    queryKey: ['/api/mobile/weather'],
    staleTime: 600000,
  });

  const { data: timeSummary } = useQuery<TimeSummary>({
    queryKey: ['/api/mobile/time-summary'],
    refetchInterval: 60000,
  });

  const { data: notifData } = useQuery<{ unreadCount: number }>({
    queryKey: ['/api/mobile/notifications'],
    select: (d: any) => ({ unreadCount: d?.unreadCount || 0 }),
    refetchInterval: 30000,
  });

  const { currentPosition } = useGpsTracking();
  const { partner } = useTeam();
  const pendingCount = useOfflinePendingCount();
  useDisruptionMonitor();
  const syncBadgeOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(syncBadgeOpacity, {
      toValue: pendingCount > 0 ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [pendingCount > 0]);

  const unreadCount = notifData?.unreadCount || 0;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('Notifications')}
          style={styles.headerBellBtn}
          hitSlop={8}
          testID="button-notifications"
        >
          <Feather name="bell" size={22} color={Colors.text} />
          {unreadCount > 0 ? (
            <View style={styles.bellBadge}>
              <ThemedText variant="caption" color={Colors.textInverse} style={styles.bellBadgeText}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      ),
    });
  }, [navigation, unreadCount]);

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchOrders(), refetchSummary()]);
    setRefreshing(false);
  }, [refetchOrders, refetchSummary]);

  const activeOrders = orders?.filter(o => o.status !== 'completed' && o.status !== 'utford' && o.status !== 'avslutad' && o.status !== 'cancelled') || [];
  const nextOrder = useMemo(() => activeOrders.find(o => !o.isLocked) || activeOrders[0], [activeOrders]);

  const { data: nextOrderDistance } = useQuery({
    queryKey: ['/api/mobile/distance', currentPosition?.latitude, currentPosition?.longitude, nextOrder?.latitude, nextOrder?.longitude],
    queryFn: async () => {
      if (!currentPosition?.latitude || !currentPosition?.longitude || !nextOrder?.latitude || !nextOrder?.longitude) return null;
      return fetchDrivingDistance(currentPosition.latitude, currentPosition.longitude, nextOrder.latitude, nextOrder.longitude);
    },
    enabled: !!currentPosition?.latitude && !!nextOrder?.latitude,
    staleTime: 15 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const completedCount = orders?.filter(o => o.status === 'completed' || o.status === 'utford' || o.status === 'avslutad').length || 0;
  const totalCount = orders?.length || 0;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;
  const lockedCount = orders?.filter(o => o.isLocked).length || 0;

  const today = new Date();
  const dateStr = today.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });

  const breakSuggestion = useMemo(() => computeBreakSuggestion(orders), [orders]);
  const [breakDismissed, setBreakDismissed] = React.useState(false);

  const [carryOverDismissed, setCarryOverDismissed] = useState(false);
  const carryOverOrders = useMemo(() => {
    if (!orders) return [];
    const todayStr = new Date().toISOString().split('T')[0];
    return orders.filter(o => {
      if (!o.scheduledDate) return false;
      const scheduled = typeof o.scheduledDate === 'string' ? o.scheduledDate.split('T')[0] : '';
      return scheduled < todayStr && !['completed', 'utford', 'avslutad', 'fakturerad', 'cancelled', 'impossible'].includes(o.status);
    });
  }, [orders]);

  const [carryOverError, setCarryOverError] = useState<string | null>(null);
  const carryOverMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/mobile/work-orders/carry-over', {}),
    onSuccess: () => {
      triggerNotification(NotificationFeedbackType.Success);
      setCarryOverError(null);
      refetchOrders();
    },
    onError: () => {
      triggerNotification(NotificationFeedbackType.Error);
      setCarryOverError('Kunde inte flytta ordrar. F\u00f6rs\u00f6k igen.');
    },
  });

  const taskSummary = useMemo(() => {
    if (!orders || orders.length === 0) return null;
    const typeCounts: Record<string, number> = {};
    for (const o of orders) {
      const t = o.objectType || 'Uppdrag';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    return Object.entries(typeCounts).map(([type, count]) => `${count} ${type.toLowerCase()}`).join(', ');
  }, [orders]);

  const [tenMinWarningDismissed, setTenMinWarningDismissed] = React.useState(false);
  const tenMinWarning = useMemo(() => {
    if (!orders || orders.length === 0) return null;
    const now = Date.now();
    for (const o of orders) {
      if (o.status === 'completed' || o.status === 'utford' || o.status === 'avslutad' || o.status === 'cancelled') continue;
      const timeStr = o.scheduledTimeStart || o.scheduledStartTime;
      if (!timeStr) continue;
      const ds = o.scheduledDate ? o.scheduledDate.split('T')[0] : new Date().toISOString().split('T')[0];
      const scheduled = new Date(`${ds}T${timeStr}:00`).getTime();
      if (isNaN(scheduled)) continue;
      const diff = scheduled - now;
      if (diff > 0 && diff <= 10 * 60 * 1000) {
        return { order: o, minutesLeft: Math.ceil(diff / 60000) };
      }
    }
    return null;
  }, [orders]);

  const queryClient = useQueryClient();

  const voice = useVoiceCommands({
    navigation,
    activeOrders,
    isOnline,
    queryClient,
  });

  return (
    <View style={styles.outerContainer}>
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
            <View style={styles.greetingRow}>
              <ThemedText variant="heading">
                Hej, {user?.name?.split(' ')[0] || 'Chauff\u00f6r'}
              </ThemedText>
              <Pressable
                style={[styles.onlineToggle, { backgroundColor: isOnline ? '#E8F5E9' : '#FEF2F2', borderColor: isOnline ? '#16A34A' : '#DC2626' }]}
                onPress={() => setIsOnline(!isOnline)}
                testID="button-toggle-online"
              >
                <View style={[styles.onlineDot, isOnline ? styles.onlineDotActive : styles.onlineDotInactive]} />
                <ThemedText
                  variant="caption"
                  color={isOnline ? '#16A34A' : '#DC2626'}
                  style={styles.onlineLabel}
                >
                  {isOnline ? 'Online' : 'Offline'}
                </ThemedText>
              </Pressable>
            </View>
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

        <WeatherWidget weather={weather} />

        <View style={styles.syncStatusRow}>
          <SyncStatusDot />
          {pendingCount > 0 ? (
            <Animated.View style={[styles.syncBadge, { opacity: syncBadgeOpacity }]}>
              <Feather name="upload-cloud" size={14} color={Colors.warning} />
              <ThemedText variant="caption" color={Colors.warning} style={styles.syncBadgeText}>
                {pendingCount} v\u00e4ntande {pendingCount === 1 ? '\u00e5tg\u00e4rd' : '\u00e5tg\u00e4rder'}
              </ThemedText>
            </Animated.View>
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
              <ThemedText variant="caption">\u00e5terst\u00e5ende</ThemedText>
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

        {carryOverOrders.length > 0 && !carryOverDismissed ? (
          <Card style={styles.carryOverBanner}>
            <View style={styles.carryOverContent}>
              <View style={styles.carryOverLeft}>
                <View style={[styles.tenMinIconCircle, { backgroundColor: Colors.danger + '20' }]}>
                  <Feather name="rotate-cw" size={18} color={Colors.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText variant="label" color={Colors.danger}>
                    {carryOverOrders.length} ej slutf\u00f6rda fr\u00e5n ig\u00e5r
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
        ) : null}

        {taskSummary ? (
          <View style={styles.taskSummaryBadge}>
            <Feather name="clipboard" size={14} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>{taskSummary}</ThemedText>
          </View>
        ) : null}

        {tenMinWarning && !tenMinWarningDismissed ? (
          <Card style={styles.tenMinWarning}>
            <View style={styles.tenMinContent}>
              <View style={styles.tenMinLeft}>
                <View style={styles.tenMinIconCircle}>
                  <Feather name="clock" size={18} color={Colors.warning} />
                </View>
                <View>
                  <ThemedText variant="label" color={Colors.warning}>
                    {tenMinWarning.minutesLeft} min till n\u00e4sta jobb
                  </ThemedText>
                  <ThemedText variant="caption" color={Colors.textSecondary}>
                    {tenMinWarning.order.customerName}
                  </ThemedText>
                </View>
              </View>
              <Pressable onPress={() => setTenMinWarningDismissed(true)} hitSlop={8}>
                <Feather name="x" size={16} color={Colors.textMuted} />
              </Pressable>
            </View>
          </Card>
        ) : null}

        <WorkTimeCard timeSummary={timeSummary} formatWorkTime={formatWorkTime} />

        {partner ? (
          <Pressable
            style={styles.teamBanner}
            onPress={() => partner.phone ? Linking.openURL(`tel:${partner.phone}`) : undefined}
            testID="banner-team-partner"
          >
            <View style={styles.teamBannerLeft}>
              <View style={[styles.teamBannerDot, { backgroundColor: partner.isOnline ? Colors.success : Colors.textMuted }]} />
              <View>
                <ThemedText variant="label" color={Colors.secondary}>Teampartner</ThemedText>
                <ThemedText variant="body" color={Colors.text}>{partner.name}</ThemedText>
              </View>
            </View>
            {partner.phone ? (
              <View style={styles.teamBannerCall}>
                <Feather name="phone" size={16} color={Colors.primary} />
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {breakSuggestion && !breakDismissed ? (
          <Card style={styles.breakBanner}>
            <View style={styles.breakBannerContent} testID="banner-break-suggestion">
              <View style={styles.breakIconCircle}>
                <Feather name="coffee" size={20} color={Colors.secondary} />
              </View>
              <View style={styles.breakTextContainer}>
                <ThemedText variant="label" color={Colors.secondary}>Rastf\u00f6rslag</ThemedText>
                <ThemedText variant="body" color={Colors.textSecondary} style={styles.breakMessage}>
                  {breakSuggestion.message}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setBreakDismissed(true)}
                hitSlop={8}
                testID="button-dismiss-break"
              >
                <Feather name="x" size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
          </Card>
        ) : null}

        <NextOrderCard
          nextOrder={nextOrder}
          nextOrderDistance={nextOrderDistance}
          navigation={navigation}
          ordersLoading={ordersLoading}
          activeOrdersLength={activeOrders.length}
        />

        <Pressable
          style={styles.statisticsButton}
          onPress={() => navigation.navigate('Statistics')}
          testID="button-statistics"
        >
          <View style={styles.statisticsLeft}>
            <View style={styles.statisticsIconCircle}>
              <Feather name="bar-chart-2" size={20} color={Colors.primary} />
            </View>
            <View>
              <ThemedText variant="subheading">Statistik</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Se statistik
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={Colors.textMuted} />
        </Pressable>

        <OrderPreviewList
          orders={activeOrders}
          ordersLoading={ordersLoading}
          navigation={navigation}
          currentPosition={currentPosition}
        />
      </ScrollView>

      <VoiceCommandOverlay
        voiceRecording={voice.voiceRecording}
        voiceProcessing={voice.voiceProcessing}
        voiceFeedback={voice.voiceFeedback}
        voiceOverlayVisible={voice.voiceOverlayVisible}
        voiceTranscript={voice.voiceTranscript}
        voiceError={voice.voiceError}
        offlineQuickActions={voice.offlineQuickActions}
        pulseAnim={voice.pulseAnim}
        overlayPulseAnim={voice.overlayPulseAnim}
        tabBarHeight={tabBarHeight}
        handleVoiceCommand={voice.handleVoiceCommand}
        stopVoiceRecording={voice.stopVoiceRecording}
        retryVoiceCommand={voice.retryVoiceCommand}
        executeVoiceAction={voice.executeVoiceAction}
        setVoiceOverlayVisible={voice.setVoiceOverlayVisible}
        setVoiceError={voice.setVoiceError}
        setOfflineQuickActions={voice.setOfflineQuickActions}
        silenceTimerRef={voice.silenceTimerRef}
        HELP_TEXT={voice.HELP_TEXT}
      />
    </View>
  );
}
