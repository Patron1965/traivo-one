import React, { useCallback, useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { View, ScrollView, Pressable, StyleSheet, RefreshControl, ActivityIndicator, Platform, Animated, Linking, Modal } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { triggerNotification, triggerImpact, NotificationFeedbackType, ImpactFeedbackStyle } from '../lib/haptics';
import * as Speech from 'expo-speech';
import { useAuth } from '../context/AuthContext';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Colors, Spacing, FontSize, BorderRadius, Shadows } from '../constants/theme';
import { getApiUrl, apiRequest } from '../lib/query-client';
import { estimateTravelMinutes, formatTravelTime, fetchDrivingDistance } from '../lib/travel-time';
import { useGpsTracking } from '../hooks/useGpsTracking';
import { useTeam } from '../hooks/useTeam';
import { useOfflinePendingCount } from '../hooks/useOfflineSync';
import { useDisruptionMonitor } from '../hooks/useDisruptionMonitor';
import { openMapNavigation } from '../lib/navigation-links';
import { SyncStatusDot } from '../components/OfflineIndicator';
import type { Order, OrderStatus, DaySummary, WeatherData } from '../types';

interface TimeSummary {
  totalSeconds: number;
  travelSeconds: number;
  onSiteSeconds: number;
  workingSeconds: number;
  entries: number;
}

function formatWorkTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

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
    o => o.status !== 'completed' && o.status !== 'utford' && o.status !== 'avslutad' && o.status !== 'cancelled' && o.status !== 'failed'
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
    case 'ny': return Colors.statusNy;
    case 'planerad': return Colors.statusPlanerad;
    case 'planerad_resurs': return Colors.statusPlaneradResurs;
    case 'paborjad': return Colors.statusPaborjad;
    case 'utford': return Colors.statusUtford;
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
    const today = new Date().toISOString().split('T')[0];
    return orders.filter(o => {
      if (!o.scheduledDate) return false;
      const scheduled = typeof o.scheduledDate === 'string' ? o.scheduledDate.split('T')[0] : '';
      return scheduled < today && !['completed', 'utford', 'avslutad', 'fakturerad', 'cancelled', 'impossible'].includes(o.status);
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
      setCarryOverError('Kunde inte flytta ordrar. Försök igen.');
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
      const dateStr = o.scheduledDate ? o.scheduledDate.split('T')[0] : new Date().toISOString().split('T')[0];
      const scheduled = new Date(`${dateStr}T${timeStr}:00`).getTime();
      if (isNaN(scheduled)) continue;
      const diff = scheduled - now;
      if (diff > 0 && diff <= 10 * 60 * 1000) {
        return { order: o, minutesLeft: Math.ceil(diff / 60000) };
      }
    }
    return null;
  }, [orders]);

  const queryClient = useQueryClient();
    const [voiceRecording, setVoiceRecording] = useState(false);
    const [voiceProcessing, setVoiceProcessing] = useState(false);
    const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
    const [voiceOverlayVisible, setVoiceOverlayVisible] = useState(false);
    const [voiceTranscript, setVoiceTranscript] = useState<string>('');
    const [voiceError, setVoiceError] = useState(false);
    const [offlineQuickActions, setOfflineQuickActions] = useState(false);
    const voiceRecorderRef = useRef<any>(null);
    const isStoppingVoiceRef = useRef(false);
    const voiceChunksRef = useRef<any[]>([]);
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const audioContextRef = useRef<any>(null);
    const analyserRef = useRef<any>(null);
    const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const overlayPulseAnim = useRef(new Animated.Value(1)).current;
  const localTranscriptRef = useRef<string>('');
    const speechRecognitionRef = useRef<any>(null);
  
    useEffect(() => {
      return () => {
        if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        if (silenceCheckRef.current) clearInterval(silenceCheckRef.current);
        if (audioContextRef.current) {
          try { audioContextRef.current.close(); } catch {}
        }
        overlayPulseAnim.stopAnimation();
        pulseAnim.stopAnimation();
      };
    }, []);

  
    const SILENCE_THRESHOLD = 0.01;
    const SILENCE_DURATION_MS = 1500;

    const HELP_TEXT = 'Tillgängliga kommandon: Visa jobb, Starta nästa, På plats, Markera klar, Navigera dit, Ring kunden, Ta rast, Visa statistik, Rapportera avvikelse, Hjälp.';

    const OFFLINE_KEYWORDS: Record<string, { action: string; displayMessage: string }> = {
      'klar': { action: 'complete_order', displayMessage: 'Markerar uppdraget som klart.' },
      'färdig': { action: 'complete_order', displayMessage: 'Markerar uppdraget som klart.' },
      'nästa': { action: 'start_next', displayMessage: 'Öppnar nästa uppdrag.' },
      'på plats': { action: 'on_site', displayMessage: 'Markerar som på plats.' },
      'framme': { action: 'on_site', displayMessage: 'Markerar som på plats.' },
      'avvikelse': { action: 'report_deviation', displayMessage: 'Öppnar avvikelserapportering.' },
      'rast': { action: 'start_break', displayMessage: 'Tar rast.' },
      'paus': { action: 'start_break', displayMessage: 'Tar rast.' },
      'hjälp': { action: 'help', displayMessage: HELP_TEXT },
      'statistik': { action: 'navigate_statistics', displayMessage: 'Öppnar statistik.' },
      'jobb': { action: 'navigate_orders', displayMessage: 'Visar dina uppdrag.' },
      'ordrar': { action: 'navigate_orders', displayMessage: 'Visar dina uppdrag.' },
      'ring': { action: 'call_customer', displayMessage: 'Ringer kunden.' },
      'navigera': { action: 'navigate_to', displayMessage: 'Öppnar navigation.' },
    };

    function matchOfflineKeyword(text: string): { action: string; displayMessage: string } | null {
      const lower = text.toLowerCase().trim();
      for (const [keyword, result] of Object.entries(OFFLINE_KEYWORDS)) {
        if (lower.includes(keyword)) return result;
      }
      return null;
    }

    function speakConfirmation(message: string) {
      if (Platform.OS === 'web') return;
      Speech.speak(message, { language: 'sv-SE', rate: 1.0 });
    }

    function triggerHaptic(type: 'start' | 'stop' | 'error') {
      if (Platform.OS === 'web') return;
      switch (type) {
        case 'start':
          triggerImpact(ImpactFeedbackStyle.Heavy);
          break;
        case 'stop':
          triggerImpact(ImpactFeedbackStyle.Light);
          break;
        case 'error':
          triggerNotification(NotificationFeedbackType.Error);
          break;
      }
    }

    function showVoiceFeedback(msg: string) {
      setVoiceFeedback(msg);
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setVoiceFeedback(null), 3500);
    }

    function executeVoiceAction(action: string, displayMessage: string) {
      if (action !== 'help') {
        showVoiceFeedback(displayMessage);
        speakConfirmation(displayMessage);
      }
      switch (action) {
        case 'navigate_orders':
          navigation.navigate('OrdersTab');
          break;
        case 'start_next': {
          const next = activeOrders.find(o => !o.isLocked) || activeOrders[0];
          if (next) {
            navigation.navigate('OrderDetail', { orderId: next.id });
          } else {
            const msg = 'Inga aktiva uppdrag att starta.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
          break;
        }
        case 'report_deviation': {
          const current = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site') || activeOrders[0];
          if (current) {
            navigation.navigate('ReportDeviation', { orderId: current.id });
          } else {
            const msg = 'Inget aktivt uppdrag för avvikelse.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
          break;
        }
        case 'on_site': {
          const onSiteOrder = activeOrders.find(o => o.status === 'dispatched' || o.status === 'planerad_resurs') || activeOrders[0];
          if (onSiteOrder) {
            apiRequest('POST', `/api/mobile/orders/${onSiteOrder.id}/status`, { status: 'on_site' })
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
                const msg = `På plats markerat för ${onSiteOrder.customerName}`;
                showVoiceFeedback(msg);
                speakConfirmation(msg);
              })
              .catch(() => {
                const msg = 'Kunde inte uppdatera status.';
                showVoiceFeedback(msg);
                speakConfirmation(msg);
              });
          } else {
            const msg = 'Inget uppdrag att markera som på plats.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
          break;
        }
        case 'complete_order': {
          const currentOrder = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site') || activeOrders[0];
          if (currentOrder) {
            apiRequest('POST', `/api/mobile/orders/${currentOrder.id}/status`, { status: 'completed' })
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
                queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
                const msg = `Uppdrag ${currentOrder.orderNumber} markerat som klart.`;
                showVoiceFeedback(msg);
                speakConfirmation(msg);
              })
              .catch(() => {
                const msg = 'Kunde inte markera uppdraget som klart.';
                showVoiceFeedback(msg);
                speakConfirmation(msg);
              });
          } else {
            const msg = 'Inget aktivt uppdrag att markera som klart.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
          break;
        }
        case 'navigate_to': {
          const navOrder = activeOrders.find(o => o.status === 'dispatched' || o.status === 'planerad_resurs' || o.status === 'on_site') || activeOrders[0];
          if (navOrder && navOrder.latitude && navOrder.longitude) {
            openMapNavigation(navOrder.latitude, navOrder.longitude, navOrder.address);
            const msg = `Navigerar till ${navOrder.address}.`;
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          } else {
            const msg = 'Inget uppdrag att navigera till.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
          break;
        }
        case 'call_customer': {
          const callOrder = activeOrders.find(o => o.status === 'in_progress' || o.status === 'on_site' || o.status === 'dispatched') || activeOrders[0];
          if (callOrder && callOrder.contacts && callOrder.contacts.length > 0) {
            const phone = callOrder.contacts[0].phone;
            if (phone) {
              Linking.openURL(`tel:${phone}`).catch(() => {});
              const msg = `Ringer ${callOrder.contacts[0].name || 'kunden'}.`;
              showVoiceFeedback(msg);
              speakConfirmation(msg);
            } else {
              const msg = 'Inget telefonnummer tillgängligt.';
              showVoiceFeedback(msg);
              speakConfirmation(msg);
            }
          } else {
            const msg = 'Ingen kontakt att ringa.';
            showVoiceFeedback(msg);
            speakConfirmation(msg);
          }
          break;
        }
        case 'start_break': {
          const msg = 'Rast startad. Vila dig!';
          showVoiceFeedback(msg);
          speakConfirmation(msg);
          break;
        }
        case 'navigate_statistics':
          navigation.navigate('Statistics');
          break;
        case 'help':
          speakConfirmation(HELP_TEXT);
          showVoiceFeedback(HELP_TEXT);
          break;
        default:
          handleUnknownCommand();
          break;
      }
    }

    function retryVoiceCommand() {
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
      setVoiceError(false);
      setVoiceOverlayVisible(false);
      setTimeout(() => {
        startVoiceRecording();
      }, 300);
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

    function startOverlayPulseAnimation() {
      Animated.loop(
        Animated.sequence([
          Animated.timing(overlayPulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
          Animated.timing(overlayPulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    }

    function stopPulseAnimation() {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      overlayPulseAnim.stopAnimation();
      overlayPulseAnim.setValue(1);
    }

    function startLocalSpeechRecognition() {
      if (Platform.OS !== 'web') return;
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        const recognition = new SpeechRecognition();
        recognition.lang = 'sv-SE';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          localTranscriptRef.current = transcript;
          setVoiceTranscript(transcript);
        };
        recognition.onerror = () => {};
        recognition.onend = () => {};
        recognition.start();
        speechRecognitionRef.current = recognition;
      } catch {}
    }

    function stopLocalSpeechRecognition() {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
        speechRecognitionRef.current = null;
      }
    }

      function startSilenceDetectionWeb(stream: MediaStream) {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        let silenceStart: number | null = null;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        silenceCheckRef.current = setInterval(() => {
          if (isStoppingVoiceRef.current || !voiceRecorderRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length / 255;

          if (avg < SILENCE_THRESHOLD) {
            if (!silenceStart) silenceStart = Date.now();
            if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
              stopVoiceRecording();
            }
          } else {
            silenceStart = null;
          }
        }, 100);
      } catch {
      }
    }

    function stopSilenceDetection() {
      if (silenceCheckRef.current) {
        clearInterval(silenceCheckRef.current);
        silenceCheckRef.current = null;
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    }

    async function startVoiceRecording() {
      if (voiceRecording || isStoppingVoiceRef.current) return;
      setVoiceError(false);
      setVoiceTranscript('');
      localTranscriptRef.current = '';

      setVoiceOverlayVisible(true);
      triggerHaptic('start');
      startOverlayPulseAnimation();

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
            stopSilenceDetection();
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
          startSilenceDetectionWeb(stream);
        startLocalSpeechRecognition();
        } catch {
          stopPulseAnimation();
          showVoiceFeedback('Kunde inte starta mikrofonen.');
          setVoiceOverlayVisible(false);
        }
      } else {
        try {
          const permission = await Audio.requestPermissionsAsync();
          if (!permission.granted) {
            stopPulseAnimation();
            showVoiceFeedback('Mikrofontillstånd krävs.');
            setVoiceOverlayVisible(false);
            return;
          }
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync({
            ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
            isMeteringEnabled: true,
          });
          voiceRecorderRef.current = recording;
          setVoiceRecording(true);
          startPulseAnimation();

          let nativeSilenceStart: number | null = null;
          const NATIVE_SILENCE_DB = -60;
          const recordingStartedAt = Date.now();
          const MIN_RECORDING_MS = 2000;
          silenceCheckRef.current = setInterval(async () => {
            try {
              if (isStoppingVoiceRef.current || !voiceRecorderRef.current) return;
              if (Date.now() - recordingStartedAt < MIN_RECORDING_MS) return;
              const status = await recording.getStatusAsync();
              if (isStoppingVoiceRef.current) return;
              if (status.isRecording && status.metering !== undefined) {
                if (status.metering < NATIVE_SILENCE_DB) {
                  if (!nativeSilenceStart) nativeSilenceStart = Date.now();
                  if (Date.now() - nativeSilenceStart >= SILENCE_DURATION_MS) {
                    stopVoiceRecording();
                  }
                } else {
                  nativeSilenceStart = null;
                }
              }
            } catch {}
          }, 200);

          silenceTimerRef.current = setTimeout(() => {
            if (voiceRecorderRef.current && !isStoppingVoiceRef.current) {
              stopVoiceRecording();
            }
          }, 15000);
        } catch (err: any) {
          console.error('Voice recording error:', err);
          showVoiceFeedback('Kunde inte starta inspelning.');
          setVoiceOverlayVisible(false);
        }
      }
    }

    async function stopVoiceRecording() {
      if (isStoppingVoiceRef.current) return;
      isStoppingVoiceRef.current = true;

      setVoiceRecording(false);
      stopPulseAnimation();
      stopSilenceDetection();
      stopLocalSpeechRecognition();
      triggerHaptic('stop');

      try {
        if (Platform.OS === 'web') {
          const recorder = voiceRecorderRef.current;
          voiceRecorderRef.current = null;
          if (recorder && recorder.state === 'recording') {
            recorder.stop();
          }
        } else {
          const recording = voiceRecorderRef.current;
          voiceRecorderRef.current = null;
          if (recording) {
            try {
              await recording.stopAndUnloadAsync();
            } catch {
              setVoiceOverlayVisible(false);
              return;
            }
            const uri = recording.getURI();
            if (uri) {
              try {
                const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                processVoiceAudio(base64);
              } catch {
                setVoiceOverlayVisible(false);
              }
            } else {
              setVoiceOverlayVisible(false);
            }
          }
        }
      } catch {
        setVoiceOverlayVisible(false);
      } finally {
        isStoppingVoiceRef.current = false;
      }
    }

    function handleUnknownCommand() {
      setVoiceOverlayVisible(true);
      setVoiceError(true);
      triggerHaptic('error');
      const msg = 'Kommandot kändes inte igen.';
      showVoiceFeedback(msg);
      speakConfirmation(msg + ' Försök igen.');
      silenceTimerRef.current = setTimeout(() => {
        setVoiceError(false);
        setVoiceOverlayVisible(false);
        startVoiceRecording();
      }, 1500);
    }

  function tryLocalKeywordMatch(spokenText: string): boolean {
    const match = matchOfflineKeyword(spokenText);
    if (match) {
      setVoiceOverlayVisible(false);
      executeVoiceAction(match.action, match.displayMessage);
      return true;
    }
    return false;
  }

  async function processVoiceAudio(base64: string) {
    setVoiceProcessing(true);
    setVoiceTranscript('Bearbetar...');

    const localText = localTranscriptRef.current;
    localTranscriptRef.current = '';

    if (localText) {
      setVoiceTranscript(localText);
      const quickMatch = matchOfflineKeyword(localText);
      if (quickMatch) {
        setVoiceOverlayVisible(false);
        executeVoiceAction(quickMatch.action, quickMatch.displayMessage);
        setVoiceProcessing(false);
        return;
      }
    }

    const networkAvailable = Platform.OS === 'web'
      ? navigator.onLine !== false
      : isOnline;

    if (!networkAvailable) {
      setOfflineQuickActions(true);
      setVoiceOverlayVisible(true);
      setVoiceTranscript('Offline \u2013 v\u00e4lj kommando:');
      triggerHaptic('error');
      speakConfirmation('Ingen n\u00e4tanslutning. V\u00e4lj ett snabbkommando.');
      setVoiceProcessing(false);
      return;
    }

    try {
      const result = await apiRequest('POST', '/api/mobile/ai/voice-command', { audio: base64 });
      const transcript = result.transcript || '';
      setVoiceTranscript(transcript);
      setVoiceOverlayVisible(false);
      if (result.action === 'unknown') {
        if (!tryLocalKeywordMatch(transcript)) {
          handleUnknownCommand();
        }
      } else {
        executeVoiceAction(result.action, result.displayMessage);
      }
    } catch {
      try {
        const transcribeResult = await apiRequest('POST', '/api/mobile/ai/transcribe', { audio: base64 });
        const transcript = transcribeResult.text || '';
        setVoiceTranscript(transcript);
        if (transcript && tryLocalKeywordMatch(transcript)) {
          return;
        }
        handleUnknownCommand();
      } catch {
        handleUnknownCommand();
      }
    } finally {
      setVoiceProcessing(false);
    }
  }

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
              Hej, {user?.name?.split(' ')[0] || 'Chaufför'}
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

      {weather ? (
        <View style={styles.weatherSection}>
          <View style={styles.weatherCurrent}>
            <Feather name={weather.icon as any} size={18} color={Colors.primary} />
            <ThemedText variant="body" style={styles.weatherTemp}>{weather.temperature}°C</ThemedText>
            <ThemedText variant="caption" color={Colors.textMuted}>{weather.description}</ThemedText>
            {weather.windSpeed > 0 ? (
              <View style={styles.weatherDetail}>
                <Feather name="wind" size={12} color={Colors.textMuted} />
                <ThemedText variant="caption" color={Colors.textMuted}>{weather.windSpeed} m/s</ThemedText>
              </View>
            ) : null}
            {weather.precipitation > 0 ? (
              <View style={styles.weatherDetail}>
                <Feather name="cloud-rain" size={12} color={Colors.textMuted} />
                <ThemedText variant="caption" color={Colors.textMuted}>{weather.precipitation} mm</ThemedText>
              </View>
            ) : null}
          </View>
          {weather.warnings.length > 0 ? (
            <View style={styles.weatherWarnings}>
              {weather.warnings.map((w, i) => (
                <View key={i} style={styles.weatherWarningBadge}>
                  <Feather name="alert-triangle" size={13} color={Colors.warning} />
                  <ThemedText variant="caption" color={Colors.warning}>{w}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.syncStatusRow}>
        <SyncStatusDot />
        {pendingCount > 0 ? (
          <Animated.View style={[styles.syncBadge, { opacity: syncBadgeOpacity }]}>
            <Feather name="upload-cloud" size={14} color={Colors.warning} />
            <ThemedText variant="caption" color={Colors.warning} style={styles.syncBadgeText}>
              {pendingCount} väntande {pendingCount === 1 ? 'åtgärd' : 'åtgärder'}
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

      {carryOverOrders.length > 0 && !carryOverDismissed ? (
        <Card style={styles.carryOverBanner}>
          <View style={styles.carryOverContent}>
            <View style={styles.carryOverLeft}>
              <View style={[styles.tenMinIconCircle, { backgroundColor: Colors.error + '20' }]}>
                <Feather name="rotate-cw" size={18} color={Colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText variant="label" color={Colors.error}>
                  {carryOverOrders.length} ej slutförda från igår
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
            <ThemedText variant="caption" color={Colors.error} style={{ marginTop: Spacing.xs }}>
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
                  {tenMinWarning.minutesLeft} min till nästa jobb
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

      {timeSummary && timeSummary.totalSeconds > 0 ? (
        <Card style={styles.workTimeCard}>
          <View style={styles.workTimeHeader}>
            <Feather name="clock" size={16} color={Colors.primary} />
            <ThemedText variant="subheading">Arbetstid idag</ThemedText>
            <ThemedText variant="heading" color={Colors.primary} style={styles.workTimeTotal} testID="text-work-time-total">
              {formatWorkTime(timeSummary.totalSeconds)}
            </ThemedText>
          </View>
          <View style={styles.workTimeBreakdown}>
            {timeSummary.travelSeconds > 0 ? (
              <View style={styles.workTimeItem}>
                <View style={[styles.workTimeDot, { backgroundColor: Colors.info }]} />
                <ThemedText variant="caption" color={Colors.textSecondary}>Körning</ThemedText>
                <ThemedText variant="body" color={Colors.info}>{formatWorkTime(timeSummary.travelSeconds)}</ThemedText>
              </View>
            ) : null}
            {timeSummary.onSiteSeconds > 0 ? (
              <View style={styles.workTimeItem}>
                <View style={[styles.workTimeDot, { backgroundColor: Colors.primaryLight }]} />
                <ThemedText variant="caption" color={Colors.textSecondary}>På plats</ThemedText>
                <ThemedText variant="body" color={Colors.primaryLight}>{formatWorkTime(timeSummary.onSiteSeconds)}</ThemedText>
              </View>
            ) : null}
            {timeSummary.workingSeconds > 0 ? (
              <View style={styles.workTimeItem}>
                <View style={[styles.workTimeDot, { backgroundColor: Colors.secondary }]} />
                <ThemedText variant="caption" color={Colors.textSecondary}>Arbete</ThemedText>
                <ThemedText variant="body" color={Colors.secondary}>{formatWorkTime(timeSummary.workingSeconds)}</ThemedText>
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

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

      {!ordersLoading && activeOrders.length > 0 && nextOrder ? (() => {
        return (
          <View>
            <Pressable
              style={styles.nextOrderButton}
              onPress={() => navigation.navigate('OrderDetail', { orderId: nextOrder.id })}
              testID="button-next-order"
            >
              <View style={styles.nextOrderLeft}>
                <View style={styles.nextOrderIconCircle}>
                  <Feather name="arrow-right-circle" size={28} color={Colors.textInverse} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText variant="subheading" color={Colors.textInverse}>
                    Nästa uppdrag
                  </ThemedText>
                  <ThemedText variant="caption" color="rgba(255,255,255,0.8)">
                    {nextOrder.customerName}
                  </ThemedText>
                  {nextOrder.address ? (
                    <ThemedText variant="caption" color="rgba(255,255,255,0.6)" numberOfLines={1}>
                      {nextOrder.address}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
              <Feather name="chevron-right" size={24} color={Colors.textInverse} />
            </Pressable>
            {nextOrder.taskLatitude && nextOrder.taskLongitude ? (
              <View style={styles.nextOrderActions}>
                <Pressable
                  style={styles.nextOrderNavButton}
                  onPress={() => {
                    const lat = nextOrder.taskLatitude;
                    const lng = nextOrder.taskLongitude;
                    if (lat && lng) {
                      openMapNavigation(lat, lng, nextOrder.customerName || 'Destination');
                    }
                  }}
                  testID="button-navigate-next"
                >
                  <Feather name="navigation" size={14} color={Colors.primary} />
                  <ThemedText variant="caption" color={Colors.primary}>Navigera</ThemedText>
                </Pressable>
                {nextOrderDistance?.durationMin ? (
                  <View style={styles.nextOrderEta}>
                    <Feather name="clock" size={12} color={Colors.textMuted} />
                    <ThemedText variant="caption" color={Colors.textMuted}>
                      ca {nextOrderDistance.durationMin} min ({nextOrderDistance.distanceKm} km)
                    </ThemedText>
                  </View>
                ) : (nextOrder as any).estimatedMinutes ? (
                  <View style={styles.nextOrderEta}>
                    <Feather name="clock" size={12} color={Colors.textMuted} />
                    <ThemedText variant="caption" color={Colors.textMuted}>
                      ca {(nextOrder as any).estimatedMinutes} min
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })() : null}



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

      <Animated.View style={[
          styles.voiceFab,
          { bottom: tabBarHeight + 20 },
          { transform: [{ scale: voiceRecording ? pulseAnim : 1 }] },
        ]}>
          <Pressable
            style={[styles.voiceFabButton, voiceRecording ? styles.voiceFabButtonActive : null]}
            onPress={handleVoiceCommand}
            disabled={voiceProcessing}
            testID="button-voice-command"
          >
            {voiceProcessing ? (
              <ActivityIndicator size="small" color={Colors.textInverse} />
            ) : (
              <Feather name={voiceRecording ? 'square' : 'mic'} size={28} color={Colors.textInverse} />
            )}
          </Pressable>
        </Animated.View>

        <Modal
          visible={voiceOverlayVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (voiceRecording) stopVoiceRecording();
            if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
            setVoiceOverlayVisible(false);
            setVoiceError(false);
            setOfflineQuickActions(false);
          }}
        >
          <View style={styles.voiceOverlay}>
            <View style={styles.voiceOverlayContent}>
              {offlineQuickActions ? (
                <>
                  <View style={styles.voiceOverlayErrorIcon}>
                    <Feather name="wifi-off" size={48} color={Colors.warning} />
                  </View>
                  <ThemedText variant="subheading" color={Colors.textInverse} style={styles.voiceOverlayTitle}>
                    Offline – snabbkommandon
                  </ThemedText>
                  <View style={styles.offlineGrid}>
                    {[
                      { label: 'Klar', action: 'complete_order', msg: 'Order markerad som klar' },
                      { label: 'N\u00e4sta', action: 'start_next', msg: 'Visar n\u00e4sta order' },
                      { label: 'P\u00e5 plats', action: 'on_site', msg: 'Ankomst registrerad' },
                      { label: 'Avvikelse', action: 'report_deviation', msg: 'Rapportera avvikelse' },
                      { label: 'Rast', action: 'start_break', msg: 'Rast startad' },
                      { label: 'Hj\u00e4lp', action: 'help', msg: HELP_TEXT },
                    ].map((item) => (
                      <Pressable
                        key={item.action}
                        style={styles.offlineBtn}
                        onPress={() => {
                          setOfflineQuickActions(false);
                          setVoiceOverlayVisible(false);
                          executeVoiceAction(item.action, item.msg);
                        }}
                      >
                        <ThemedText variant="label" color={Colors.textInverse}>{item.label}</ThemedText>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable
                    style={styles.voiceOverlayCloseBtn}
                    onPress={() => {
                      setOfflineQuickActions(false);
                      setVoiceOverlayVisible(false);
                    }}
                    testID="button-offline-close"
                  >
                    <ThemedText variant="label" color="rgba(255,255,255,0.7)">St\u00e4ng</ThemedText>
                  </Pressable>
                </>
              ) : voiceError ? (
                <>
                  <View style={styles.voiceOverlayErrorIcon}>
                    <Feather name="alert-circle" size={48} color={Colors.danger} />
                  </View>
                  <ThemedText variant="subheading" color={Colors.textInverse} style={styles.voiceOverlayTitle}>
                    Kommandot kändes inte igen
                  </ThemedText>
                  <ThemedText variant="body" color="rgba(255,255,255,0.7)" style={styles.voiceOverlaySubtitle}>
                    Försök igen eller säg "hjälp" för att höra tillgängliga kommandon
                  </ThemedText>
                  <View style={styles.voiceOverlayActions}>
                    <Pressable style={styles.voiceOverlayRetryBtn} onPress={retryVoiceCommand} testID="button-voice-retry">
                      <Feather name="mic" size={20} color={Colors.textInverse} />
                      <ThemedText variant="label" color={Colors.textInverse}>Försök igen</ThemedText>
                    </Pressable>
                    <Pressable
                      style={styles.voiceOverlayCloseBtn}
                      onPress={() => {
                        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
                        setVoiceOverlayVisible(false); setVoiceError(false);
                      }}
                      testID="button-voice-close"
                    >
                      <ThemedText variant="label" color="rgba(255,255,255,0.7)">Stäng</ThemedText>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Animated.View style={[styles.voiceOverlayMicCircle, { transform: [{ scale: overlayPulseAnim }] }]}>
                    <Feather name="mic" size={48} color={Colors.textInverse} />
                  </Animated.View>
                  <ThemedText variant="subheading" color={Colors.textInverse} style={styles.voiceOverlayTitle}>
                    {voiceRecording ? 'Lyssnar...' : voiceProcessing ? 'Bearbetar...' : 'Röstkommando'}
                  </ThemedText>
                  {voiceTranscript ? (
                    <ThemedText variant="body" color="rgba(255,255,255,0.8)" style={styles.voiceOverlayTranscript}>
                      {voiceTranscript}
                    </ThemedText>
                  ) : null}
                  {voiceRecording ? (
                    <Pressable
                      style={styles.voiceOverlayStopBtn}
                      onPress={stopVoiceRecording}
                    >
                      <Feather name="square" size={16} color={Colors.textInverse} />
                      <ThemedText variant="caption" color={Colors.textInverse}>Stoppa</ThemedText>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </View>
        </Modal>

        {voiceFeedback ? (
          <View style={[styles.voiceFeedbackToast, { bottom: tabBarHeight + 90 }]}>
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
  headerBellBtn: {
    padding: Spacing.xs,
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
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
  nextOrderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  nextOrderNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  nextOrderEta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskSummaryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary + '12',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    alignSelf: 'flex-start',
    marginBottom: Spacing.sm,
  },
  carryOverBanner: {
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.error,
  },
  carryOverContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  carryOverLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  carryOverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  carryOverBtn: {
    backgroundColor: Colors.error,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.round,
  },
  tenMinWarning: {
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: Colors.warning,
  },
  tenMinContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tenMinLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  tenMinIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.warning + '20',
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
  weatherSection: {
    marginBottom: Spacing.sm,
  },
  weatherCurrent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.cardElevated,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  weatherTemp: {
    fontWeight: '600' as const,
    color: Colors.text,
  },
  weatherDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
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
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF8E1',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  syncBadgeText: {
    fontFamily: 'Inter_500Medium',
  },
  teamBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.secondary + '12',
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.secondary + '30',
  },
  teamBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  teamBannerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  teamBannerCall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight + '15',
    justifyContent: 'center',
    alignItems: 'center',
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
  voiceFab: {
      position: 'absolute',
      right: Spacing.lg,
      zIndex: 100,
    },
    voiceFabButton: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: Colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...Shadows.lg,
    },
    voiceFabButtonActive: {
      backgroundColor: Colors.danger,
    },
    voiceOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.85)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    voiceOverlayContent: {
      alignItems: 'center',
      paddingHorizontal: Spacing.xxl,
      width: '100%',
    },
    voiceOverlayMicCircle: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: Colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.xl,
    },
    voiceOverlayTitle: {
      textAlign: 'center' as const,
      marginBottom: Spacing.md,
    },
    voiceOverlayTranscript: {
      textAlign: 'center' as const,
      marginBottom: Spacing.lg,
      fontStyle: 'italic' as const,
    },
    voiceOverlaySubtitle: {
      textAlign: 'center' as const,
      marginBottom: Spacing.xl,
      lineHeight: 22,
    },
    voiceOverlayStopBtn: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Spacing.sm,
      backgroundColor: 'rgba(255,255,255,0.15)',
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.round,
      marginTop: Spacing.md,
    },
    voiceOverlayErrorIcon: {
      marginBottom: Spacing.lg,
    },
    voiceOverlayActions: {
      flexDirection: 'row' as const,
      gap: Spacing.md,
      marginTop: Spacing.md,
    },
    voiceOverlayRetryBtn: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Spacing.sm,
      backgroundColor: Colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.round,
    },
    voiceOverlayCloseBtn: {
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.round,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
    },
    offlineGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.md,
      marginBottom: Spacing.lg,
    },
    offlineBtn: {
      backgroundColor: 'rgba(255,255,255,0.15)',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.25)',
      minWidth: 100,
      alignItems: 'center',
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
      zIndex: 99,
    },
    voiceFeedbackText: {
      flex: 1,
    },
  workTimeCard: {
    backgroundColor: Colors.surface,
  },
  workTimeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  workTimeTotal: {
    marginLeft: 'auto',
  },
  workTimeBreakdown: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  workTimeItem: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  workTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statisticsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  statisticsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  statisticsIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
