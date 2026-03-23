import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getActiveWorkSession,
  startWorkSession,
  stopWorkSession,
  pauseWorkSession,
  resumeWorkSession,
} from '../api/workSessions';
import { startGPSTracking, stopGPSTracking } from '../services/gpsTracking';
import { colors, spacing, fontSize, borderRadius } from '../theme';

export function WorkSessionScreen() {
  const queryClient = useQueryClient();
  const [elapsed, setElapsed] = useState('0:00:00');

  const { data: session, isLoading } = useQuery({
    queryKey: ['activeSession'],
    queryFn: getActiveWorkSession,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!session?.startTime || session.status !== 'active') return;

    const interval = setInterval(() => {
      const start = new Date(session.startTime).getTime();
      const now = Date.now();
      const pauseMs = (session.totalPauseMinutes || 0) * 60 * 1000;
      const diff = Math.max(0, now - start - pauseMs);
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setElapsed(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [session]);

  const invalidateSession = () => {
    queryClient.invalidateQueries({ queryKey: ['activeSession'] });
  };

  const startMutation = useMutation({
    mutationFn: startWorkSession,
    onSuccess: () => {
      invalidateSession();
      startGPSTracking();
    },
  });
  const stopMutation = useMutation({
    mutationFn: (id: string) => stopWorkSession(id),
    onSuccess: () => {
      invalidateSession();
      stopGPSTracking();
      setElapsed('0:00:00');
    },
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseWorkSession(id),
    onSuccess: () => {
      invalidateSession();
      stopGPSTracking();
    },
  });
  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeWorkSession(id),
    onSuccess: () => {
      invalidateSession();
      startGPSTracking();
    },
  });

  const handleCheckOut = () => {
    if (!session) return;
    Alert.alert('Avsluta arbetspass', 'Är du säker?', [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Ja, checka ut', onPress: () => stopMutation.mutate(session.id), style: 'destructive' },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.deepOceanBlue} />
      </View>
    );
  }

  const isActive = session && session.status === 'active';
  const isPaused = session && session.status === 'paused';

  return (
    <View style={styles.container}>
      <View style={styles.timerSection}>
        <Text style={styles.timerLabel}>
          {isActive ? 'Arbetstid' : isPaused ? 'Pausad' : 'Inte incheckad'}
        </Text>
        <Text style={styles.timer} data-testid="text-timer">{elapsed}</Text>

        {isActive && (
          <View style={styles.statusDot}>
            <View style={[styles.dot, { backgroundColor: colors.auroraGreen }]} />
            <Text style={styles.statusText}>Aktivt pass</Text>
          </View>
        )}
        {isPaused && (
          <View style={styles.statusDot}>
            <View style={[styles.dot, { backgroundColor: colors.warning }]} />
            <Text style={styles.statusText}>Pausad</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        {!session || session.status === 'completed' ? (
          <TouchableOpacity
            style={[styles.mainButton, styles.checkInButton]}
            onPress={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            data-testid="button-start-session"
          >
            {startMutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.mainButtonText}>Checka in</Text>
            )}
          </TouchableOpacity>
        ) : (
          <>
            {isActive && (
              <TouchableOpacity
                style={[styles.mainButton, styles.pauseButton]}
                onPress={() => pauseMutation.mutate(session.id)}
                disabled={pauseMutation.isPending}
                data-testid="button-pause-session"
              >
                {pauseMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.mainButtonText}>⏸ Pausa</Text>
                )}
              </TouchableOpacity>
            )}

            {isPaused && (
              <TouchableOpacity
                style={[styles.mainButton, styles.resumeButton]}
                onPress={() => resumeMutation.mutate(session.id)}
                disabled={resumeMutation.isPending}
                data-testid="button-resume-session"
              >
                {resumeMutation.isPending ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.mainButtonText}>▶ Återuppta</Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.mainButton, styles.checkOutButton]}
              onPress={handleCheckOut}
              disabled={stopMutation.isPending}
              data-testid="button-stop-session"
            >
              {stopMutation.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.mainButtonText}>Checka ut</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {session?.startTime && (
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Startad</Text>
            <Text style={styles.infoValue}>
              {new Date(session.startTime).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          {session.totalPauseMinutes > 0 && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Paus totalt</Text>
              <Text style={styles.infoValue}>{session.totalPauseMinutes} min</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
    padding: spacing.lg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerSection: {
    alignItems: 'center',
    marginTop: spacing.xxxl,
    marginBottom: spacing.xxxl,
  },
  timerLabel: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
  },
  timer: {
    fontSize: 64,
    fontWeight: 'bold',
    color: colors.deepOceanBlue,
    fontVariant: ['tabular-nums'],
  },
  statusDot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: fontSize.sm,
    color: colors.mountainGray,
    fontWeight: '500',
  },
  actions: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  mainButton: {
    paddingVertical: spacing.xl,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  checkInButton: {
    backgroundColor: colors.northernTeal,
  },
  pauseButton: {
    backgroundColor: colors.warning,
  },
  resumeButton: {
    backgroundColor: colors.northernTeal,
  },
  checkOutButton: {
    backgroundColor: colors.error,
  },
  mainButtonText: {
    color: colors.white,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
  },
  infoValue: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
});
