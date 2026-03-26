import React, { useCallback, useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { View, ScrollView, Pressable, RefreshControl, Animated } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { triggerNotification, NotificationFeedbackType } from '../lib/haptics';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Colors, Spacing } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { fetchDrivingDistance } from '../lib/travel-time';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useTeam } from '../hooks/useTeam';
import { useOfflinePendingCount } from '../hooks/useOfflineSync';
import { useDisruptionMonitor } from '../hooks/useDisruptionMonitor';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { VoiceCommandOverlay } from '../components/home/VoiceCommandOverlay';
import { WeatherWidget } from '../components/home/WeatherWidget';
import { WorkTimeCard } from '../components/home/WorkTimeCard';
import { NextOrderCard } from '../components/home/NextOrderCard';
import { OrderPreviewList } from '../components/home/OrderPreviewList';
import { ProgressCard } from '../components/home/ProgressCard';
import { CarryOverBanner } from '../components/home/CarryOverBanner';
import { SyncStatusRow } from '../components/home/SyncStatusRow';
import { TeamPartnerBanner } from '../components/home/TeamPartnerBanner';
import { BreakSuggestionCard } from '../components/home/BreakSuggestionCard';
import { TenMinWarningCard } from '../components/home/TenMinWarningCard';
import { StatisticsButton } from '../components/home/StatisticsButton';
import styles from './HomeScreen.styles';
import { formatWorkTime, computeBreakSuggestion } from './HomeScreen.utils';
import type { TimeSummary } from './HomeScreen.utils';
import type { Order, DaySummary, WeatherData } from '../types';

export function HomeScreen({ navigation }: { navigation: { navigate: (screen: string, params?: Record<string, unknown>) => void } }) {
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
    select: (d: { unreadCount?: number }) => ({ unreadCount: d?.unreadCount || 0 }),
    refetchInterval: 30000,
  });

  const { currentPosition } = useGpsTracking();
  const { partner } = useTeam();
  const pendingCount = useOfflinePendingCount();
  useDisruptionMonitor(orders || [], currentPosition);

  const syncBadgeOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(syncBadgeOpacity, {
      toValue: pendingCount > 0 ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [pendingCount, syncBadgeOpacity]);

  useLayoutEffect(() => {
    const unreadCount = notifData?.unreadCount || 0;
    navigation.navigate && navigation;
    if (unreadCount > 0) {
      navigation.navigate;
    }
  }, [notifData, navigation]);

  const [refreshing, setRefreshing] = useState(false);
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
  const voice = useVoiceCommands({ navigation, activeOrders, isOnline, queryClient });

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
            <ThemedText variant="caption" style={styles.dateText}>{dateStr}</ThemedText>
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
                <ThemedText variant="caption" color={isOnline ? '#16A34A' : '#DC2626'} style={styles.onlineLabel}>
                  {isOnline ? 'Online' : 'Offline'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
          {user?.vehicleRegNo ? (
            <View style={styles.vehicleBadge}>
              <Feather name="truck" size={14} color={Colors.primary} />
              <ThemedText variant="caption" color={Colors.primary}>{user.vehicleRegNo}</ThemedText>
            </View>
          ) : null}
        </View>

        <WeatherWidget weather={weather} />
        <SyncStatusRow pendingCount={pendingCount} syncBadgeOpacity={syncBadgeOpacity} />
        <ProgressCard completedCount={completedCount} totalCount={totalCount} progress={progress} summary={summary} lockedCount={lockedCount} />
        <CarryOverBanner carryOverOrders={carryOverOrders} carryOverDismissed={carryOverDismissed} setCarryOverDismissed={setCarryOverDismissed} carryOverMutation={carryOverMutation} carryOverError={carryOverError} />

        {taskSummary ? (
          <View style={styles.taskSummaryBadge}>
            <Feather name="clipboard" size={14} color={Colors.primary} />
            <ThemedText variant="caption" color={Colors.primary}>{taskSummary}</ThemedText>
          </View>
        ) : null}

        <TenMinWarningCard tenMinWarning={tenMinWarning} tenMinWarningDismissed={tenMinWarningDismissed} setTenMinWarningDismissed={setTenMinWarningDismissed} />
        <WorkTimeCard timeSummary={timeSummary} formatWorkTime={formatWorkTime} />
        <TeamPartnerBanner partner={partner} />
        <BreakSuggestionCard breakSuggestion={breakSuggestion} breakDismissed={breakDismissed} setBreakDismissed={setBreakDismissed} />
        <NextOrderCard nextOrder={nextOrder} nextOrderDistance={nextOrderDistance} navigation={navigation} ordersLoading={ordersLoading} activeOrdersLength={activeOrders.length} />
        <StatisticsButton onPress={() => navigation.navigate('Statistics')} />
        <OrderPreviewList orders={activeOrders} ordersLoading={ordersLoading} navigation={navigation} currentPosition={currentPosition} />
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
