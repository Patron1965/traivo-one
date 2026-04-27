import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ScrollView, Switch, StyleSheet, ActivityIndicator } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { ThemedText } from '../components/ThemedText';
import { Card } from '../components/Card';
import { Colors, Spacing, FontSize, BorderRadius } from '../constants/theme';
import { apiRequest } from '../lib/query-client';
import { hapticLight } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { useThemeColors } from '../context/BrandingContext';
import type { Resource } from '../types';

interface MeResponse {
  success?: boolean;
  resource: Resource;
}

interface NotificationPrefsResponse {
  smsOnScheduleSend: boolean;
  smsOnExtraJob: boolean;
  lastSchedulePublishedAt?: string | null;
  lastSchedulePeriodStart?: string | null;
  lastSchedulePeriodEnd?: string | null;
}

type FieldKey = 'smsOnScheduleSend' | 'smsOnExtraJob';

function formatPublishedAt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString('sv-SE', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function formatPeriod(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  try {
    const s = new Date(start);
    const e = new Date(end);
    const sLabel = s.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    const eLabel = e.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
    return `${sLabel}–${eLabel}`;
  } catch {
    return null;
  }
}

export function NotificationPrefsScreen() {
  useThemeColors();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { logout } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery<MeResponse>({
    queryKey: ['/api/mobile/me'],
  });

  const resource = data?.resource;

  const [scheduleSend, setScheduleSend] = useState<boolean>(true);
  const [extraJob, setExtraJob] = useState<boolean>(true);
  const [savedFlash, setSavedFlash] = useState<boolean>(false);
  const [pendingFields, setPendingFields] = useState<Set<FieldKey>>(new Set());

  // Per-field request id — only the latest request for each field "wins".
  // Out-of-order responses from older requests are ignored.
  const reqIds = useRef<Record<FieldKey, number>>({
    smsOnScheduleSend: 0,
    smsOnExtraJob: 0,
  });

  // Synchronous source of truth for the current logical value of each field.
  // We read "previous" from these refs at the moment the request starts, so
  // rapid successive toggles always capture the up-to-date prior value
  // regardless of React render timing or stale closures.
  const currentValues = useRef<Record<FieldKey, boolean>>({
    smsOnScheduleSend: true,
    smsOnExtraJob: true,
  });

  // Sync local state from server when /me data arrives, but don't overwrite
  // values for fields that currently have an in-flight optimistic update.
  useEffect(() => {
    if (!resource) return;
    if (!pendingFields.has('smsOnScheduleSend')) {
      const v = resource.smsOnScheduleSend !== false;
      currentValues.current.smsOnScheduleSend = v;
      setScheduleSend(v);
    }
    if (!pendingFields.has('smsOnExtraJob')) {
      const v = resource.smsOnExtraJob !== false;
      currentValues.current.smsOnExtraJob = v;
      setExtraJob(v);
    }
  }, [resource?.smsOnScheduleSend, resource?.smsOnExtraJob]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }, []);

  const togglePending = useCallback((field: FieldKey, on: boolean) => {
    setPendingFields((prev) => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  }, []);

  const updateField = useCallback(async (field: FieldKey, value: boolean) => {
    hapticLight();
    // Read prior value from the synchronous ref (NOT from React state, which
    // may be stale during rapid taps before re-render commits).
    const previous = currentValues.current[field];
    const setLocal = field === 'smsOnScheduleSend' ? setScheduleSend : setExtraJob;
    const myReqId = ++reqIds.current[field];

    // Update both ref (synchronous) and state (UI) optimistically.
    currentValues.current[field] = value;
    setLocal(value);
    togglePending(field, true);

    try {
      const resp = await apiRequest('PATCH', '/api/mobile/me/notification-prefs', {
        [field]: value,
      }) as NotificationPrefsResponse;

      // Last-write-wins: a newer request superseded this one — discard response.
      if (myReqId !== reqIds.current[field]) return;

      // Apply only this field + period metadata to /me cache so we don't clobber
      // the other field if the user toggled it concurrently.
      queryClient.setQueryData<MeResponse | undefined>(['/api/mobile/me'], (prev) => {
        if (!prev?.resource) return prev;
        return {
          ...prev,
          resource: {
            ...prev.resource,
            [field]: resp[field],
            lastSchedulePublishedAt: resp.lastSchedulePublishedAt ?? prev.resource.lastSchedulePublishedAt,
            lastSchedulePeriodStart: resp.lastSchedulePeriodStart ?? prev.resource.lastSchedulePeriodStart,
            lastSchedulePeriodEnd: resp.lastSchedulePeriodEnd ?? prev.resource.lastSchedulePeriodEnd,
          },
        };
      });
      flashSaved();
    } catch (err: any) {
      // Stale failure — don't disturb newer state.
      if (myReqId !== reqIds.current[field]) return;

      if (err?.status === 401) {
        await logout();
        return;
      }

      // Per-field revert: roll BOTH ref and UI back to the value held
      // immediately before THIS specific request.
      currentValues.current[field] = previous;
      setLocal(previous);
    } finally {
      if (myReqId === reqIds.current[field]) {
        togglePending(field, false);
      }
    }
  }, [queryClient, logout, flashSaved, togglePending]);

  const handleScheduleToggle = useCallback((value: boolean) => {
    updateField('smsOnScheduleSend', value);
  }, [updateField]);

  const handleExtraToggle = useCallback((value: boolean) => {
    updateField('smsOnExtraJob', value);
  }, [updateField]);

  if (isLoading && !resource) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight + Spacing.xl }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (isError && !resource) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight + Spacing.xl }]}>
        <Feather name="wifi-off" size={48} color={Colors.textMuted} />
        <ThemedText variant="subheading" color={Colors.textMuted} style={{ marginTop: Spacing.md }}>
          Kunde inte hämta inställningar
        </ThemedText>
        <ThemedText
          variant="caption"
          color={Colors.primary}
          style={{ marginTop: Spacing.md }}
          onPress={() => refetch()}
        >
          Försök igen
        </ThemedText>
      </View>
    );
  }

  const publishedAt = formatPublishedAt(resource?.lastSchedulePublishedAt);
  const period = formatPeriod(resource?.lastSchedulePeriodStart, resource?.lastSchedulePeriodEnd);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl },
      ]}
    >
      <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
        SMS-NOTISER
      </ThemedText>
      <Card style={styles.sectionCard}>
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.accentLight }]}>
              <Feather name="calendar" size={16} color={Colors.accent} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">SMS när nytt veckoschema publiceras</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Du får ett SMS när planeraren publicerar din vecka.
              </ThemedText>
            </View>
          </View>
          <Switch
            value={scheduleSend}
            onValueChange={handleScheduleToggle}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={scheduleSend ? Colors.primary : Colors.textMuted}
            testID="switch-sms-schedule"
          />
        </View>
        <View style={styles.divider} />
        <View style={styles.settingRow}>
          <View style={styles.settingLeft}>
            <View style={[styles.iconCircle, { backgroundColor: Colors.infoLight }]}>
              <Feather name="plus" size={16} color={Colors.primary} />
            </View>
            <View style={styles.settingText}>
              <ThemedText variant="body">SMS vid extrajobb i din vecka</ThemedText>
              <ThemedText variant="caption" color={Colors.textSecondary}>
                Du får ett SMS när ett extrajobb läggs in efter att schemat publicerats.
              </ThemedText>
            </View>
          </View>
          <Switch
            value={extraJob}
            onValueChange={handleExtraToggle}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={extraJob ? Colors.primary : Colors.textMuted}
            testID="switch-sms-extra-job"
          />
        </View>
      </Card>

      <View style={styles.infoBox}>
        <Feather name="info" size={14} color={Colors.textSecondary} style={{ marginTop: 2 }} />
        <ThemedText variant="caption" color={Colors.textSecondary} style={styles.infoText}>
          Du får ändå alltid in-app-notifikationer i appen — det här styr bara SMS:en till din mobil.
        </ThemedText>
      </View>

      {publishedAt || period ? (
        <>
          <ThemedText variant="caption" color={Colors.textSecondary} style={styles.sectionLabel}>
            SENAST PUBLICERADE SCHEMA
          </ThemedText>
          <Card style={styles.sectionCard}>
            <View style={styles.infoRow}>
              <Feather name="calendar" size={16} color={Colors.textSecondary} />
              <View style={styles.infoContent}>
                <ThemedText variant="caption" color={Colors.textSecondary}>Period</ThemedText>
                <ThemedText variant="body">{period || '-'}</ThemedText>
              </View>
            </View>
            {publishedAt ? (
              <>
                <View style={styles.divider} />
                <View style={styles.infoRow}>
                  <Feather name="clock" size={16} color={Colors.textSecondary} />
                  <View style={styles.infoContent}>
                    <ThemedText variant="caption" color={Colors.textSecondary}>Publicerat</ThemedText>
                    <ThemedText variant="body">{publishedAt}</ThemedText>
                  </View>
                </View>
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      {savedFlash ? (
        <View style={styles.savedToast} testID="toast-saved">
          <Feather name="check-circle" size={14} color={Colors.success} />
          <ThemedText variant="caption" color={Colors.success}>Sparat</ThemedText>
        </View>
      ) : null}
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
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    fontSize: FontSize.xs,
  },
  sectionCard: {
    width: '100%',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    flex: 1,
    marginRight: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingText: {
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: Spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  infoContent: {
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  infoText: {
    flex: 1,
    lineHeight: 18,
  },
  savedToast: {
    position: 'absolute',
    bottom: Spacing.xl,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.successLight,
    borderRadius: BorderRadius.round,
    left: Spacing.xl,
    right: Spacing.xl,
    justifyContent: 'center',
  },
});
