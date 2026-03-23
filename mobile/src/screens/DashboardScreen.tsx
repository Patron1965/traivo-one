import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import type { RootStackParamList } from '../navigation';
import { getDaySummary, getWeather } from '../api/sync';
import { getActiveWorkSession, startWorkSession, stopWorkSession, pauseWorkSession, resumeWorkSession } from '../api/workSessions';
import { getUnreadCount } from '../api/notifications';
import { getPendingCount } from '../services/offlineQueue';
import { startGPSTracking, stopGPSTracking, isTracking } from '../services/gpsTracking';
import { colors, spacing, fontSize, borderRadius } from '../theme';

const weatherCodes: Record<number, string> = {
  0: '☀️ Klart',
  1: '🌤 Mestadels klart',
  2: '⛅ Delvis molnigt',
  3: '☁️ Molnigt',
  45: '🌫 Dimma',
  48: '🌫 Rimfrost',
  51: '🌧 Lätt duggregn',
  53: '🌧 Duggregn',
  61: '🌧 Regn',
  63: '🌧 Kraftigt regn',
  71: '🌨 Snö',
  73: '🌨 Kraftigt snöfall',
  80: '🌦 Regnskurar',
  95: '⛈ Åska',
};

export function DashboardScreen() {
  const { resource } = useAuth();
  const queryClient = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [refreshing, setRefreshing] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['summary'],
    queryFn: getDaySummary,
  });

  const { data: weather } = useQuery({
    queryKey: ['weather'],
    queryFn: () => getWeather(),
    staleTime: 30 * 60 * 1000,
  });

  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: ['activeSession'],
    queryFn: getActiveWorkSession,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unreadNotifications'],
    queryFn: getUnreadCount,
    refetchInterval: 30000,
  });

  useEffect(() => {
    getPendingCount().then(setPendingSync);
  }, []);

  useEffect(() => {
    if (activeSession && activeSession.status === 'active' && !isTracking()) {
      startGPSTracking();
    } else if ((!activeSession || activeSession.status === 'stopped') && isTracking()) {
      stopGPSTracking();
    }
  }, [activeSession?.id, activeSession?.status]);

  const checkInMutation = useMutation({
    mutationFn: startWorkSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      startGPSTracking();
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (sessionId: string) => stopWorkSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      stopGPSTracking();
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (sessionId: string) => pauseWorkSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      stopGPSTracking();
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (sessionId: string) => resumeWorkSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      startGPSTracking();
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['summary'] }),
      queryClient.invalidateQueries({ queryKey: ['weather'] }),
      queryClient.invalidateQueries({ queryKey: ['activeSession'] }),
      queryClient.invalidateQueries({ queryKey: ['unreadNotifications'] }),
    ]);
    const count = await getPendingCount();
    setPendingSync(count);
    setRefreshing(false);
  }, [queryClient]);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!activeSession || activeSession.status === 'stopped') return;
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, [activeSession?.id, activeSession?.status]);

  const currentTemp = weather?.current_weather?.temperature;
  const weatherCode = weather?.current_weather?.weathercode;
  const weatherText = weatherCode !== undefined ? weatherCodes[weatherCode] || 'Okänt' : null;

  const getElapsedTime = () => {
    void tick;
    if (!activeSession?.startTime) return '0:00';
    const start = new Date(activeSession.startTime).getTime();
    const now = Date.now();
    const pauseMs = (activeSession.totalPauseMinutes || 0) * 60 * 1000;
    const elapsed = Math.max(0, now - start - pauseMs);
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  };

  const dateStr = new Date().toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.deepOceanBlue} />}
    >
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting} data-testid="text-greeting">
              Hej, {resource?.name?.split(' ')[0]}!
            </Text>
            <Text style={styles.dateText}>{dateStr}</Text>
          </View>
          <TouchableOpacity
            style={styles.notifButton}
            onPress={() => navigation.navigate('NotificationsTab')}
            data-testid="button-notifications"
          >
            <Text style={styles.notifIcon}>🔔</Text>
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {weatherText && (
          <View style={styles.weatherRow}>
            <Text style={styles.weatherText}>
              {weatherText} {currentTemp !== undefined ? `${Math.round(currentTemp)}°C` : ''}
            </Text>
          </View>
        )}
      </View>

      {pendingSync > 0 && (
        <View style={styles.syncBanner}>
          <Text style={styles.syncText}>🔄 {pendingSync} åtgärder väntar på synkning</Text>
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber} data-testid="text-total-orders">{summary?.totalOrders ?? '-'}</Text>
          <Text style={styles.statLabel}>Totalt</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.auroraGreen + '20' }]}>
          <Text style={[styles.statNumber, { color: colors.auroraGreen }]} data-testid="text-completed-orders">
            {summary?.completedOrders ?? '-'}
          </Text>
          <Text style={styles.statLabel}>Klara</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.deepOceanBlue + '15' }]}>
          <Text style={[styles.statNumber, { color: colors.deepOceanBlue }]} data-testid="text-remaining-orders">
            {summary?.remainingOrders ?? '-'}
          </Text>
          <Text style={styles.statLabel}>Kvar</Text>
        </View>
      </View>

      <View style={styles.sessionCard}>
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionTitle}>Arbetspass</Text>
          {activeSession && (
            <TouchableOpacity
              onPress={() => navigation.navigate('WorkSession')}
              data-testid="button-worksession-details"
            >
              <Text style={styles.sessionDetailLink}>Detaljer →</Text>
            </TouchableOpacity>
          )}
        </View>
        {activeSession && activeSession.status === 'active' ? (
          <>
            <Text style={styles.sessionTime} data-testid="text-session-time">{getElapsedTime()}</Text>
            <Text style={styles.sessionStatus}>Aktivt arbetspass</Text>
            <View style={styles.sessionButtonRow}>
              <TouchableOpacity
                style={[styles.sessionButton, styles.pauseButton]}
                onPress={() => pauseMutation.mutate(activeSession.id)}
                disabled={pauseMutation.isPending}
                data-testid="button-pause"
              >
                {pauseMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.sessionButtonText}>⏸ Paus</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sessionButton, styles.checkOutButton]}
                onPress={() => checkOutMutation.mutate(activeSession.id)}
                disabled={checkOutMutation.isPending}
                data-testid="button-checkout"
              >
                {checkOutMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.sessionButtonText}>Checka ut</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : activeSession && activeSession.status === 'paused' ? (
          <>
            <Text style={styles.sessionTime} data-testid="text-session-time">{getElapsedTime()}</Text>
            <Text style={[styles.sessionStatus, { color: colors.warning }]}>Pausat</Text>
            <View style={styles.sessionButtonRow}>
              <TouchableOpacity
                style={[styles.sessionButton, styles.checkInButton]}
                onPress={() => resumeMutation.mutate(activeSession.id)}
                disabled={resumeMutation.isPending}
                data-testid="button-resume"
              >
                {resumeMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.sessionButtonText}>▶ Återuppta</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sessionButton, styles.checkOutButton]}
                onPress={() => checkOutMutation.mutate(activeSession.id)}
                disabled={checkOutMutation.isPending}
                data-testid="button-checkout"
              >
                {checkOutMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.sessionButtonText}>Checka ut</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sessionStatus}>Inget aktivt pass</Text>
            <TouchableOpacity
              style={[styles.sessionButton, styles.checkInButton]}
              onPress={() => checkInMutation.mutate()}
              disabled={checkInMutation.isPending}
              data-testid="button-checkin"
            >
              {checkInMutation.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.sessionButtonText}>Checka in</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      <TouchableOpacity
        style={styles.ordersButton}
        onPress={() => navigation.navigate('OrdersTab')}
        data-testid="button-view-orders"
      >
        <Text style={styles.ordersButtonText}>
          Visa dagens ordrar ({summary?.totalOrders ?? 0})
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: {
    marginBottom: spacing.xl,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
  },
  dateText: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginTop: spacing.xs,
    textTransform: 'capitalize',
  },
  notifButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  notifIcon: {
    fontSize: 22,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: colors.error,
    borderRadius: borderRadius.full,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  weatherRow: {
    marginTop: spacing.sm,
  },
  weatherText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
  syncBanner: {
    backgroundColor: colors.warning + '20',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
  },
  syncText: {
    fontSize: fontSize.sm,
    color: colors.midnightNavy,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statNumber: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.mountainGray,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.xxl,
    marginBottom: spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.md,
  },
  sessionDetailLink: {
    fontSize: fontSize.sm,
    color: colors.deepOceanBlue,
    fontWeight: '600',
  },
  sessionTitle: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sessionTime: {
    fontSize: 48,
    fontWeight: 'bold',
    color: colors.deepOceanBlue,
    marginBottom: spacing.sm,
  },
  sessionStatus: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginBottom: spacing.lg,
  },
  sessionButtonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  sessionButton: {
    flex: 1,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  checkInButton: {
    backgroundColor: colors.northernTeal,
  },
  checkOutButton: {
    backgroundColor: colors.error,
  },
  pauseButton: {
    backgroundColor: colors.warning,
  },
  sessionButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  ordersButton: {
    backgroundColor: colors.deepOceanBlue,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    minHeight: 52,
  },
  ordersButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
});
