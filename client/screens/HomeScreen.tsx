import React, { useCallback, useMemo, useState, useRef } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Platform, Animated } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { getApiUrl, apiRequest } from '../lib/query-client';
import { estimateTravelMinutes, formatTravelTime } from '../lib/travel-time';
import { useGpsTracking } from '../hooks/useGpsTracking';
import type { Order, OrderStatus, DaySummary, WeatherData } from '../types';

interface BreakSuggestion {
  hoursWorked: number;
  nextJobTime: string | null;
  gapMinutes: number | null;
  message: string;
}

function computeBreakSuggestion(orders: Order[] | undefined): BreakSuggestion | null {
  if (!orders || orders.length === 0) return null;

  const startedOrders = orders.filter(o => o.actualStartTime);
  if (startedOrders.length === 0) return null;

  const startTimes = startedOrders
    .map(o => {
      const t = new Date(o.actualStartTime!);
      return isNaN(t.getTime()) ? null : t.getTime();
    })
    .filter((t): t is number => t !== null);

  if (startTimes.length === 0) return null;

  const workStartMs = Math.min(...startTimes);
  const now = Date.now();
  const hoursWorked = (now - workStartMs) / (1000 * 60 * 60);

  if (hoursWorked < 4) return null;

  const remaining = orders.filter(
    o => o.status !== 'completed' && o.status !== 'cancelled' && o.status !== 'failed'
  );

  let nextJobTime: string | null = null;
  let gapMinutes: number | null = null;

  const upcoming = remaining
    .filter(o => o.scheduledTimeStart)
    .map(o => {
      const today = new Date();
      const [h, m] = (o.scheduledTimeStart || '').split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return null;
      const jobDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
      return { time: jobDate.getTime(), label: o.scheduledTimeStart! };
    })
    .filter((x): x is { time: number; label: string } => x !== null && x.time > now)
    .sort((a, b) => a.time - b.time);

  if (upcoming.length > 0) {
    nextJobTime = upcoming[0].label;
    gapMinutes = Math.round((upcoming[0].time - now) / (1000 * 60));
  }

  const h = Math.floor(hoursWorked);
  const mins = Math.round((hoursWorked - h) * 60);
  const workedStr = mins > 0 ? `${h}h ${mins}min` : `${h}h`;

  let message = `Du har jobbat i ${workedStr}`;
  if (nextJobTime && gapMinutes !== null && gapMinutes > 10) {
    message += ` \u2014 dags f\u00f6r rast? N\u00e4sta jobb kl ${nextJobTime}, ${gapMinutes} min lucka`;
  } else {
    message += ` \u2014 dags f\u00f6r en paus?`;
  }

  return { hoursWorked, nextJobTime, gapMinutes, message };
}

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

  const { currentPosition } = useGpsTracking();

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchOrders(), refetchSummary()]);
    setRefreshing(false);
  }, [refetchOrders, refetchSummary]);

  const activeOrders = orders?.filter(o => o.status !== 'completed' && o.status !== 'cancelled') || [];
  const completedCount = orders?.filter(o => o.status === 'completed').length || 0;
  const totalCount = orders?.length || 0;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;
  const lockedCount = orders?.filter(o => o.isLocked).length || 0;

  const breakSuggestion = useMemo(() => computeBreakSuggestion(orders), [orders]);
  const [breakDismissed, setBreakDismissed] = React.useState(false);

  const queryClient = useQueryClient();
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const voiceRecorderRef = useRef<any>(null);
  const voiceChunksRef = useRef<any[]>([]);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  function showVoiceFeedback(msg: string) {
    setVoiceFeedback(msg);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 3500);
  }

  function executeVoiceAction(action: string, displayMessage: string) {
    showVoiceFeedback(displayMessage);
    switch (action) {
      case 'navigate_orders':
        navigation.navigate('OrdersTab');
        break;
      case 'start_next': {
        const next = activeOrders.find(o => !o.isLocked) || activeOrders[0];
        if (next) {
          navigation.navigate('OrderDetail', { orderId: next.id });
        } else {
          showVoiceFeedback('Inga aktiva uppdrag att starta.');
        }
        break;
      }
      case 'report_deviation': {
        const current = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site') || activeOrders[0];
        if (current) {
          navigation.navigate('ReportDeviation', { orderId: current.id });
        } else {
          showVoiceFeedback('Inget aktivt uppdrag för avvikelse.');
        }
        break;
      }
      case 'on_site': {
        const onSiteOrder = activeOrders.find(o => o.status === 'dispatched' || o.status === 'planerad_resurs') || activeOrders[0];
        if (onSiteOrder) {
          apiRequest('POST', `/api/mobile/orders/${onSiteOrder.id}/status`, { status: 'on_site' })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
              showVoiceFeedback(`Markerad som "P\u00e5 plats" f\u00f6r ${onSiteOrder.customerName}`);
            })
            .catch(() => showVoiceFeedback('Kunde inte uppdatera status.'));
        } else {
          showVoiceFeedback('Inget uppdrag att markera som p\u00e5 plats.');
        }
        break;
      }
      default:
        showVoiceFeedback('Kommandot k\u00e4ndes inte igen. F\u00f6rs\u00f6k igen.');
        break;
    }
  }

  async function handleVoiceCommand() {
    if (voiceRecording) {
      stopVoiceRecording();
      return;
    }
    startVoiceRecording();
  }

  function startPulseAnimation() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }

  function stopPulseAnimation() {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }

  async function startVoiceRecording() {
    if (Platform.OS === 'web') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        voiceChunksRef.current = [];
        mediaRecorder.ondataavailable = (e: any) => {
          if (e.data.size > 0) voiceChunksRef.current.push(e.data);
        };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(track => track.stop());
          const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm;codecs=opus' });
          const reader = new FileReader();
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            processVoiceAudio(base64);
          };
          reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        voiceRecorderRef.current = mediaRecorder;
        setVoiceRecording(true);
        startPulseAnimation();
      } catch {
        showVoiceFeedback('Kunde inte starta mikrofonen.');
      }
    } else {
      try {
        const { Audio } = require('expo-av');
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          showVoiceFeedback('Mikrofontillst\u00e5nd kr\u00e4vs.');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        voiceRecorderRef.current = recording;
        setVoiceRecording(true);
        startPulseAnimation();
      } catch (err: any) {
        console.error('Voice recording error:', err);
        showVoiceFeedback('Kunde inte starta inspelning.');
      }
    }
  }

  async function stopVoiceRecording() {
    setVoiceRecording(false);
    stopPulseAnimation();
    if (Platform.OS === 'web') {
      if (voiceRecorderRef.current) {
        voiceRecorderRef.current.stop();
        voiceRecorderRef.current = null;
      }
    } else {
      try {
        const recording = voiceRecorderRef.current;
        if (recording) {
          await recording.stopAndUnloadAsync();
          const uri = recording.getURI();
          voiceRecorderRef.current = null;
          if (uri) {
            const { readAsStringAsync, EncodingType } = require('expo-file-system');
            const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
            processVoiceAudio(base64);
          }
        }
      } catch {
        showVoiceFeedback('Kunde inte stoppa inspelningen.');
      }
    }
  }

  async function processVoiceAudio(base64: string) {
    setVoiceProcessing(true);
    try {
      const result = await apiRequest('POST', '/api/mobile/ai/voice-command', { audio: base64 });
      executeVoiceAction(result.action, result.displayMessage);
    } catch {
      showVoiceFeedback('R\u00f6stkommandot kunde inte bearbetas.');
    } finally {
      setVoiceProcessing(false);
    }
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
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
              Hej, {user?.name?.split(' ')[0] || 'Chaufor'}
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

      {weather && weather.warnings.length > 0 ? (
        <View style={styles.weatherWarnings}>
          {weather.warnings.map((w, i) => (
            <View key={i} style={styles.weatherWarningBadge}>
              <Feather name="alert-triangle" size={13} color={Colors.warning} />
              <ThemedText variant="caption" color={Colors.warning}>{w}</ThemedText>
            </View>
          ))}
        </View>
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

      <Animated.View style={[
        styles.voiceCommandRow,
        voiceRecording ? styles.voiceCommandRowActive : null,
        { transform: [{ scale: pulseAnim }] },
      ]}>
        <Pressable
          style={styles.voiceCommandPressable}
          onPress={handleVoiceCommand}
          disabled={voiceProcessing}
          testID="button-voice-command"
        >
          <View style={[styles.voiceIconCircle, voiceRecording ? styles.voiceIconCircleActive : null]}>
            {voiceProcessing ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Feather name={voiceRecording ? 'square' : 'mic'} size={16} color={Colors.textInverse} />
            )}
          </View>
          <ThemedText variant="caption" color={voiceRecording ? Colors.danger : Colors.textSecondary}>
            {voiceRecording ? 'Lyssnar... tryck för att stoppa' : 'Röstkommando'}
          </ThemedText>
        </Pressable>
      </Animated.View>

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
                    <ThemedText variant="body" color={Colors.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
                      {order.address}, {order.city}
                    </ThemedText>
                    {(() => {
                      const travelMin = estimateTravelMinutes(
                        currentPosition?.latitude, currentPosition?.longitude,
                        order.latitude, order.longitude
                      );
                      const travelStr = formatTravelTime(travelMin);
                      return travelStr ? (
                        <View style={styles.travelBadge}>
                          <Feather name="navigation" size={10} color={Colors.primary} />
                          <ThemedText variant="caption" color={Colors.primary} style={styles.travelText}>
                            {travelStr}
                          </ThemedText>
                        </View>
                      ) : null;
                    })()}
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

      {voiceFeedback ? (
        <View style={[styles.voiceFeedbackToast, { bottom: tabBarHeight + 80 }]}>
          <Feather name="info" size={16} color={Colors.textInverse} />
          <ThemedText variant="body" color={Colors.textInverse} style={styles.voiceFeedbackText}>
            {voiceFeedback}
          </ThemedText>
        </View>
      ) : null}

    </View>
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
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  onlineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  onlineDotActive: {
    backgroundColor: '#16A34A',
  },
  onlineDotInactive: {
    backgroundColor: '#DC2626',
  },
  onlineLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
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
  travelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.infoLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  travelText: {
    fontSize: 10,
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
  weatherWarnings: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  weatherWarningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.warningLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  breakBanner: {
    backgroundColor: '#E8F8F5',
    borderWidth: 1,
    borderColor: Colors.secondaryLight,
  },
  breakBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  breakIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(23, 165, 137, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  breakTextContainer: {
    flex: 1,
    gap: 2,
  },
  breakMessage: {
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  outerContainer: {
    flex: 1,
  },
  voiceCommandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  voiceCommandRowActive: {
    backgroundColor: '#FDF2F2',
  },
  voiceCommandPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    flex: 1,
  },
  voiceIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceIconCircleActive: {
    backgroundColor: Colors.danger,
  },
  voiceFeedbackToast: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  voiceFeedbackText: {
    flex: 1,
  },
});
